#!/usr/bin/env node
/**
 * Heuristic pagination smell checker per PAGINATION_SPEC.md sections 2, 10.2, and 12.
 * Reports likely in-process pagination, interactive listAll usage, and OpenAPI wire-alias debt;
 * not a substitute for review.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RUST_SMELLS = [
  {
    id: 'rust-collect-then-skip',
    pattern: /collect::<Vec[^>]*>\(\)[\s\S]{0,240}?\.(skip|take)\(/g,
    message: 'collect into Vec then skip/take — likely in-process pagination',
  },
  {
    id: 'rust-list-window',
    pattern: /\blist_window\s*\(/g,
    message: 'list_window helper on materialized collection',
  },
  {
    id: 'rust-per-request-inbox-collect',
    pattern: /collect_inbox_entries_for_principal_kind/g,
    message: 'per-request inbox projection rebuild before paging (§2.3)',
    debtId: 'PAG-001',
  },
  {
    id: 'rust-per-request-contact-collect',
    pattern: /collect_contacts_for_owner/g,
    message: 'per-request contacts projection rebuild before paging (§2.3)',
    debtId: 'PAG-002',
  },
  {
    id: 'rust-member-directory-overfetch',
    pattern: /limit\.saturating_mul\(4\)/g,
    message: 'member directory over-fetch then filter/take',
    debtId: 'PAG-003',
  },
];

// `listAll*` helpers that are spec-compliant batch loads (owner/admin management
// of a small bounded domain-configuration set). The checker cannot infer this from
// the usage site, so these are explicitly declared compliant rather than treated
// as client-side aggregation debt (PAGINATION_SPEC reserves listAll* for batch).
const COMPLIANT_BATCH_LIST_ALL = new Set(['listAllMembershipTiers']);

// Interactive UI directories. The `ts-client-slice-pagination` heuristic should
// only fire on list-pagination inside interactive UI; backend services, ports,
// mocks and background batch modules slice materialized windows legitimately.
function isInteractiveUiFile(rel) {
  return /(?:^|\/)(?:pages|screens|views|components)\//u.test(rel.replace(/\\/g, '/'));
}

// Detects whether the receiver of a `.slice(...)` call is a string (string slicing
// is never pagination) by resolving the direct receiver identifier and checking for
// a nearby `name : string` type declaration.
function isStringSlice(text, matchIndex) {
  let i = matchIndex - 1;
  while (i >= 0 && /[A-Za-z0-9_$]/u.test(text[i])) i -= 1;
  const name = text.slice(i + 1, matchIndex);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)) {
    return false;
  }
  const windowStart = Math.max(0, matchIndex - 600);
  const windowText = text.slice(windowStart, matchIndex);
  const pattern = new RegExp(`\\b${name}\\s*:\\s*string(?:\\b|\\[|\\])`, 'u');
  return pattern.test(windowText);
}

const TS_SMELLS = [
  {
    id: 'ts-list-all-helper',
    pattern: /\blistAll[A-Z][A-Za-z0-9]*\s*\(/g,
    message: 'listAll* aggregation helper — reserve for export/batch only',
    suppress(file, rel, text, match) {
      if (isTestLikePath(rel)) {
        return true;
      }
      const helperMatch = /\blistAll[A-Z][A-Za-z0-9]*/u.exec(match[0]);
      return helperMatch !== null && COMPLIANT_BATCH_LIST_ALL.has(helperMatch[0]);
    },
  },
  {
    id: 'ts-client-slice-pagination',
    pattern: /\.slice\s*\(\s*(?:offset|start|page)/gi,
    message: 'client slice with offset/page — likely client-side pagination',
    suppress(file, rel, text, match) {
      if (isTestLikePath(rel)) {
        return true;
      }
      if (!isInteractiveUiFile(rel) || isStringSlice(text, match.index)) {
        return true;
      }
      return false;
    },
  },
  {
    id: 'ts-get-contacts-interactive',
    pattern: /contactService\.getContacts\s*\(/g,
    message: 'getContacts() loads first page only — prefer listContactsPage in interactive UI',
    pathsOnly: ['apps/'],
    suppress(file, rel) {
      return isTestLikePath(rel);
    },
  },
];

const OPENAPI_QUERY_SMELLS = [
  {
    id: 'openapi-query-page-size-camel',
    parameterName: 'pageSize',
    message: 'pageSize query parameter is forbidden; use page_size on HTTP GET wire and pageSize only in JSON bodies/responses',
  },
  {
    id: 'openapi-query-limit-alias',
    parameterName: 'limit',
    message: 'limit query alias is forbidden for list/search pagination; use page_size',
  },
  {
    id: 'openapi-query-page-no-snake-alias',
    parameterName: 'page_no',
    message: 'page_no query alias is forbidden for list/search pagination; use page',
  },
  {
    id: 'openapi-query-page-no-camel-alias',
    parameterName: 'pageNo',
    message: 'pageNo query alias is forbidden for list/search pagination; use page',
  },
  {
    id: 'openapi-query-per-page-alias',
    parameterName: 'per_page',
    message: 'per_page query alias is forbidden for list/search pagination; use page_size',
  },
  {
    id: 'openapi-query-size-alias',
    parameterName: 'size',
    message: 'size query alias is forbidden for list/search pagination; use page_size',
  },
];

const FORBIDDEN_PAGINATION_QUERY_FIELDS = [
  'pageSize',
  'limit',
  'page_no',
  'pageNo',
  'per_page',
  'size',
];

const DOC_AND_TEST_EXTENSIONS = ['.md', '.rs', '.ts', '.tsx', '.js', '.mjs', '.dart', '.java', '.kt', '.cs', '.go', '.swift', '.py'];
const GENERATED_SDK_EXTENSIONS = ['.ts', '.js', '.cs', '.java', '.kt', '.dart', '.go', '.rs', '.py', '.swift'];
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);
const EXTERNAL_ONLY_SDK_FAMILY_CACHE = new Map();

function usage() {
  return [
    'Usage:',
    '  node tools/check-pagination.mjs --workspace <sdkwork-space-or-repo-root>',
    '',
    'Scans child repositories when workspace root is given; otherwise scans the repo root.',
  ].join('\n');
}

function fail(message, details = []) {
  console.error(`pagination check failed: ${message}`);
  for (const detail of details.slice(0, 200)) {
    console.error(`- ${detail}`);
  }
  if (details.length > 200) {
    console.error(`- ... and ${details.length - 200} more`);
  }
  process.exit(1);
}

function isIgnoredDir(name) {
  return (
    name === 'node_modules'
    || name === 'target'
    || name === 'dist'
    || name === 'generated'
    || name === '.git'
    || name === 'build'
  );
}

function walkFiles(root, extensions) {
  const files = [];
  if (!fs.existsSync(root)) {
    return files;
  }
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }
      const ext = path.extname(entry.name);
      if (extensions.includes(ext)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function walkFilesIncludingGenerated(root, extensions) {
  const files = [];
  if (!fs.existsSync(root)) {
    return files;
  }
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name !== 'node_modules'
          && entry.name !== 'target'
          && entry.name !== 'dist'
          && entry.name !== '.git'
          && entry.name !== 'build'
        ) {
          stack.push(fullPath);
        }
        continue;
      }
      if (extensions.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function hasRepoManifest(root) {
  return fs.existsSync(path.join(root, 'Cargo.toml')) || fs.existsSync(path.join(root, 'package.json'));
}

/**
 * SDKWork pagination governance boundary. A repo is governed when it is either
 * a first-party SDKWork repo (sdkwork-* prefix) or its AGENTS.md references the
 * SDKWork spec system (sdkwork-specs). Independent tools vendored into the
 * workspace (e.g. hermes-agent, deepseek-harness) that run their own private
 * server surface are NOT governed by SDKWork pagination conventions.
 */
function isGovernedRepo(repoRoot) {
  const name = path.basename(repoRoot);
  if (name.startsWith('sdkwork-')) {
    return true;
  }
  try {
    const agentsText = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    return /sdkwork-specs|PAGINATION_SPEC\.md/u.test(agentsText);
  } catch {
    return false;
  }
}

function isDirectoryLike(entry, fullPath) {
  if (entry.isDirectory()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  try {
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

function pushRepoRoot(roots, seen, repoRoot) {
  let realRoot;
  try {
    realRoot = fs.realpathSync.native(repoRoot);
  } catch {
    realRoot = path.resolve(repoRoot);
  }
  if (seen.has(realRoot)) {
    return;
  }
  seen.add(realRoot);
  roots.push(repoRoot);
}

function discoverDataRepoRoots(workspaceRoot, roots, seen) {
  const dataRoot = path.join(workspaceRoot, 'data');
  let entries = [];
  try {
    entries = fs.readdirSync(dataRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(dataRoot, entry.name);
    if (
      isDirectoryLike(entry, child)
      && hasRepoManifest(child)
      && fs.existsSync(path.join(child, 'AGENTS.md'))
      && isGovernedRepo(child)
    ) {
      pushRepoRoot(roots, seen, child);
    }
  }
}

function discoverRepoRoots(workspaceRoot) {
  const roots = [];
  const seen = new Set();
  if (hasRepoManifest(workspaceRoot)) {
    pushRepoRoot(roots, seen, workspaceRoot);
  }
  let entries = [];
  try {
    entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  } catch {
    return roots.length > 0 ? roots : [workspaceRoot];
  }
  for (const entry of entries) {
    const child = path.join(workspaceRoot, entry.name);
    if (!isDirectoryLike(entry, child) || isIgnoredDir(entry.name)) {
      continue;
    }
    if (hasRepoManifest(child) && isGovernedRepo(child)) {
      pushRepoRoot(roots, seen, child);
    }
  }
  discoverDataRepoRoots(workspaceRoot, roots, seen);
  return roots.length > 0 ? roots : [workspaceRoot];
}

function scanFile(file, repoRoot, smells, issues) {
  const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  for (const smell of smells) {
    if (smell.pathsOnly && !smell.pathsOnly.some((prefix) => rel.startsWith(prefix))) {
      continue;
    }
    if (smell.invert) {
      if (!smell.pattern.test(text)) {
        issues.push(`${rel}: ${smell.message}`);
      }
      smell.pattern.lastIndex = 0;
      continue;
    }
    let match;
    const pattern = new RegExp(smell.pattern.source, smell.pattern.flags);
    while ((match = pattern.exec(text)) !== null) {
      if (smell.suppress && smell.suppress(file, rel, text, match)) {
        continue;
      }
      const line = text.slice(0, match.index).split('\n').length;
      issues.push(`${rel}:${line}: [${smell.debtId ?? smell.id}] ${smell.message}`);
      if (!smell.pattern.global) {
        break;
      }
    }
  }
}

function isLikelyOpenApiFile(file) {
  const normalized = file.replace(/\\/g, '/');
  const basename = path.basename(normalized).toLowerCase();
  return (
    normalized.includes('/apis/')
    || normalized.includes('/sdks/')
  ) && (
    basename.includes('openapi')
    || basename.endsWith('.openapi.yaml')
    || basename.endsWith('.openapi.yml')
    || basename.endsWith('.openapi.json')
  );
}

function parseJsonOpenApi(text) {
  try {
    const document = JSON.parse(text);
    if (document && typeof document.openapi === 'string' && document.openapi.startsWith('3.')) {
      return document;
    }
  } catch {
    return null;
  }
  return null;
}

function isExternalOperation(operation) {
  return (
    operation
    && operation['x-sdkwork-wire-protocol'] === 'external'
    && typeof operation['x-sdkwork-external-protocol-id'] === 'string'
    && operation['x-sdkwork-external-protocol-id'].trim().length > 0
  );
}

function listOpenApiOperations(document) {
  const operations = [];
  if (!document || typeof document !== 'object' || !document.paths || typeof document.paths !== 'object') {
    return operations;
  }
  for (const [apiPath, pathItem] of Object.entries(document.paths)) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }
    const pathParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const [method, operation] of Object.entries(pathItem)) {
      const normalizedMethod = method.toLowerCase();
      if (!HTTP_METHODS.has(normalizedMethod) || !operation || typeof operation !== 'object') {
        continue;
      }
      const operationParameters = Array.isArray(operation.parameters) ? operation.parameters : [];
      operations.push({
        apiPath,
        method: normalizedMethod,
        operation,
        parameters: [...pathParameters, ...operationParameters],
      });
    }
  }
  return operations;
}

function pageSizeQueryHasCompliantMaximum(parameter) {
  const maximum = Number(parameter?.schema?.maximum);
  return Number.isFinite(maximum) && maximum <= 200;
}

function pageSizeExceptionIssue(operation, parameter) {
  const maximum = Number(parameter?.schema?.maximum);
  if (!Number.isFinite(maximum)) {
    return 'page_size query parameter must declare maximum 200';
  }
  const exception = operation?.['x-sdkwork-pagination-exception'];
  if (!exception || typeof exception !== 'object' || Array.isArray(exception)) {
    return 'page_size maximum above 200 requires x-sdkwork-pagination-exception';
  }
  const requiredTextFields = [
    'id',
    'spec',
    'rule',
    'owner',
    'reason',
    'risk',
    'expiresAt',
    'removalPlan',
  ];
  const missingField = requiredTextFields.find((field) => (
    typeof exception[field] !== 'string' || exception[field].trim().length === 0
  ));
  if (missingField) {
    return `x-sdkwork-pagination-exception.${missingField} must be a non-empty string`;
  }
  if (!Array.isArray(exception.controls) || exception.controls.length === 0 || exception.controls.some((control) => (
    typeof control !== 'string' || control.trim().length === 0
  ))) {
    return 'x-sdkwork-pagination-exception.controls must be a non-empty string array';
  }
  if (!Number.isInteger(maximum) || maximum <= 200) {
    return 'page_size exception requires an integer maximum above 200';
  }
  if (exception.maximumPageSize !== maximum) {
    return 'x-sdkwork-pagination-exception.maximumPageSize must equal page_size maximum';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(exception.expiresAt)) {
    return 'x-sdkwork-pagination-exception.expiresAt must use YYYY-MM-DD';
  }
  const expiresAt = Date.parse(`${exception.expiresAt}T23:59:59.999Z`);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return 'x-sdkwork-pagination-exception is expired';
  }
  return null;
}

function hasPageInfoWithoutModeInJson(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'pageInfo')) {
    const pageInfo = value.pageInfo;
    if (
      pageInfo
      && typeof pageInfo === 'object'
      && !pageInfo.$ref
      && pageInfo.properties
      && typeof pageInfo.properties === 'object'
      && (Object.prototype.hasOwnProperty.call(pageInfo.properties, 'hasMore')
        || Object.prototype.hasOwnProperty.call(pageInfo.properties, 'nextCursor'))
      && !Object.prototype.hasOwnProperty.call(pageInfo.properties, 'mode')
    ) {
      return true;
    }
  }
  if (value.properties && typeof value.properties === 'object' && Object.prototype.hasOwnProperty.call(value.properties, 'pageInfo')) {
    const pageInfo = value.properties.pageInfo;
    if (
      pageInfo
      && typeof pageInfo === 'object'
      && !pageInfo.$ref
      && pageInfo.properties
      && typeof pageInfo.properties === 'object'
      && (Object.prototype.hasOwnProperty.call(pageInfo.properties, 'hasMore')
        || Object.prototype.hasOwnProperty.call(pageInfo.properties, 'nextCursor'))
      && !Object.prototype.hasOwnProperty.call(pageInfo.properties, 'mode')
    ) {
      return true;
    }
  }
  for (const child of Object.values(value)) {
    if (hasPageInfoWithoutModeInJson(child)) {
      return true;
    }
  }
  return false;
}

function hasQueryParameterNamed(text, parameterName) {
  const escaped = parameterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const yamlNameThenIn = new RegExp(
    `(?:^|\\n)\\s*-?\\s*name:\\s*['"]?${escaped}['"]?\\s*(?:\\r?\\n[\\s\\S]{0,240}?\\b)?in:\\s*['"]?query['"]?`,
    'u',
  );
  const yamlInThenName = new RegExp(
    `(?:^|\\n)\\s*-?\\s*in:\\s*['"]?query['"]?\\s*(?:\\r?\\n[\\s\\S]{0,240}?\\b)?name:\\s*['"]?${escaped}['"]?`,
    'u',
  );
  const jsonNameThenIn = new RegExp(
    `"name"\\s*:\\s*"${escaped}"[\\s\\S]{0,240}?"in"\\s*:\\s*"query"`,
    'u',
  );
  const jsonInThenName = new RegExp(
    `"in"\\s*:\\s*"query"[\\s\\S]{0,240}?"name"\\s*:\\s*"${escaped}"`,
    'u',
  );
  return (
    yamlNameThenIn.test(text)
    || yamlInThenName.test(text)
    || jsonNameThenIn.test(text)
    || jsonInThenName.test(text)
  );
}

function queryParameterBlocks(text, parameterName) {
  const escaped = parameterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blocks = [];
  const namePattern = new RegExp(`(?:^|\\n)\\s*-?\\s*name:\\s*['"]?${escaped}['"]?`, 'gu');
  let match;
  while ((match = namePattern.exec(text)) !== null) {
    const start = match.index;
    const next = text.slice(start + 1).search(/\n\s*-\s*name:\s*/u);
    const end = next === -1 ? Math.min(text.length, start + 900) : start + 1 + next;
    const block = text.slice(start, end);
    if (/\bin:\s*['"]?query['"]?/u.test(block)) {
      blocks.push(block);
    }
  }
  return blocks;
}

function pageSizeQueryHasMaximum200(text) {
  return queryParameterBlocks(text, 'page_size').every((block) => /maximum:\s*200\b/u.test(block));
}

function yamlOperationBlocks(text) {
  const lines = text.split(/\r?\n/u);
  const operations = [];
  let pathsIndent = null;
  let currentPath = null;
  let currentPathIndent = null;
  let currentOperation = null;
  const finishOperation = (end) => {
    if (!currentOperation) return;
    operations.push({
      ...currentOperation,
      text: lines.slice(currentOperation.start, end).join('\n'),
    });
    currentOperation = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (pathsIndent === null) {
      if (trimmed === 'paths:') pathsIndent = indent;
      continue;
    }
    if (trimmed && indent <= pathsIndent && trimmed !== 'paths:') {
      finishOperation(index);
      break;
    }
    const pathMatch = trimmed.match(/^(['"]?)(\/[^'"]*)\1:\s*$/u);
    if (pathMatch && indent > pathsIndent) {
      finishOperation(index);
      currentPath = pathMatch[2];
      currentPathIndent = indent;
      continue;
    }
    const methodMatch = trimmed.match(/^([a-z]+):\s*$/u);
    if (
      currentPath
      && currentPathIndent !== null
      && indent > currentPathIndent
      && methodMatch
      && HTTP_METHODS.has(methodMatch[1])
    ) {
      finishOperation(index);
      currentOperation = {
        apiPath: currentPath,
        method: methodMatch[1],
        indent,
        start: index,
      };
      continue;
    }
    if (currentOperation && trimmed && indent <= currentOperation.indent) {
      finishOperation(index);
    }
  }
  finishOperation(lines.length);
  return operations;
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function yamlPaginationException(operationText) {
  const lines = operationText.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\s*x-sdkwork-pagination-exception:\s*$/u.test(line));
  if (start < 0) return null;
  const exceptionIndent = lines[start].length - lines[start].trimStart().length;
  const exception = {};
  let controlsIndent = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= exceptionIndent) break;
    if (controlsIndent !== null && indent > controlsIndent && trimmed.startsWith('- ')) {
      exception.controls.push(unquoteYamlScalar(trimmed.slice(2)));
      continue;
    }
    controlsIndent = null;
    const fieldMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u);
    if (!fieldMatch) continue;
    const [, field, rawValue] = fieldMatch;
    if (field === 'controls') {
      exception.controls = [];
      controlsIndent = indent;
    } else if (field === 'maximumPageSize') {
      exception[field] = Number(rawValue);
    } else {
      exception[field] = unquoteYamlScalar(rawValue);
    }
  }
  return exception;
}

function yamlPageSizeParameters(operationText) {
  return queryParameterBlocks(operationText, 'page_size').map((block) => {
    const maximum = block.match(/\bmaximum:\s*(\d+)\b/u)?.[1];
    return {
      name: 'page_size',
      in: 'query',
      schema: maximum ? { maximum: Number(maximum) } : {},
    };
  });
}

function hasInlinePageInfoWithoutMode(text) {
  const yamlPattern = /pageInfo:\s*\n[\s\S]{0,700}?(?:hasMore:|nextCursor:)/gu;
  let yamlMatch;
  while ((yamlMatch = yamlPattern.exec(text)) !== null) {
    const block = yamlMatch[0];
    if (!/\bmode:\s*/u.test(block) && !/\$ref:\s*['"]?#\/components\/schemas\/PageInfo['"]?/u.test(block)) {
      return true;
    }
  }
  const jsonPattern = /"pageInfo"\s*:\s*\{[\s\S]{0,700}?"(?:hasMore|nextCursor)"\s*:/gu;
  let jsonMatch;
  while ((jsonMatch = jsonPattern.exec(text)) !== null) {
    if (!/"mode"\s*:/u.test(jsonMatch[0])) {
      return true;
    }
  }
  return false;
}

function scanOpenApiFile(file, repoRoot, issues) {
  if (!isLikelyOpenApiFile(file)) {
    return;
  }
  const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const jsonDocument = parseJsonOpenApi(text);
  if (jsonDocument) {
    const operations = listOpenApiOperations(jsonDocument);
    const sdkworkOwnedOperations = operations.filter(({ operation }) => !isExternalOperation(operation));
    for (const { operation, parameters } of sdkworkOwnedOperations) {
      for (const parameter of parameters) {
        if (!parameter || parameter.in !== 'query') {
          continue;
        }
        for (const smell of OPENAPI_QUERY_SMELLS) {
          if (parameter.name === smell.parameterName) {
            issues.push(`${rel}: [${smell.id}] ${smell.message}`);
          }
        }
        if (parameter.name === 'page_size' && !pageSizeQueryHasCompliantMaximum(parameter)) {
          const exceptionIssue = pageSizeExceptionIssue(operation, parameter);
          if (exceptionIssue) {
            issues.push(`${rel}: [openapi-query-page-size-max] ${exceptionIssue}`);
          }
        }
      }
    }
    if (sdkworkOwnedOperations.length > 0 && hasPageInfoWithoutModeInJson(jsonDocument)) {
      issues.push(`${rel}: [openapi-page-info-mode] pageInfo schema must include mode`);
    }
    return;
  }
  if (!/\bopenapi\s*[:"]\s*["']?3\./iu.test(text)) {
    return;
  }
  const yamlOperations = yamlOperationBlocks(text);
  if (yamlOperations.length > 0) {
    for (const { text: operationText } of yamlOperations) {
      if (isExternalOperation({
        'x-sdkwork-wire-protocol': operationText.match(/x-sdkwork-wire-protocol:\s*['"]?([^'"\s]+)/u)?.[1],
        'x-sdkwork-external-protocol-id': operationText.match(/x-sdkwork-external-protocol-id:\s*['"]?([^'"\s]+)/u)?.[1],
      })) {
        continue;
      }
      for (const smell of OPENAPI_QUERY_SMELLS) {
        if (hasQueryParameterNamed(operationText, smell.parameterName)) {
          issues.push(`${rel}: [${smell.id}] ${smell.message}`);
        }
      }
      for (const parameter of yamlPageSizeParameters(operationText)) {
        if (!pageSizeQueryHasCompliantMaximum(parameter)) {
          const exceptionIssue = pageSizeExceptionIssue(
            { 'x-sdkwork-pagination-exception': yamlPaginationException(operationText) },
            parameter,
          );
          if (exceptionIssue) {
            issues.push(`${rel}: [openapi-query-page-size-max] ${exceptionIssue}`);
          }
        }
      }
    }
  } else {
    for (const smell of OPENAPI_QUERY_SMELLS) {
      if (hasQueryParameterNamed(text, smell.parameterName)) {
        issues.push(`${rel}: [${smell.id}] ${smell.message}`);
      }
    }
    if (hasQueryParameterNamed(text, 'page_size') && !pageSizeQueryHasMaximum200(text)) {
      issues.push(`${rel}: [openapi-query-page-size-max] page_size query parameter must declare maximum 200`);
    }
  }
  if (hasInlinePageInfoWithoutMode(text)) {
    issues.push(`${rel}: [openapi-page-info-mode] pageInfo schema must include mode`);
  }
}

function findSdkFamilyRoot(file, repoRoot) {
  const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
  const segments = rel.split('/');
  const sdksIndex = segments.indexOf('sdks');
  if (sdksIndex < 0 || segments.length <= sdksIndex + 1) {
    return null;
  }
  return path.join(repoRoot, ...segments.slice(0, sdksIndex + 2));
}

function sdkFamilyHasOnlyExternalOperations(sdkFamilyRoot) {
  if (EXTERNAL_ONLY_SDK_FAMILY_CACHE.has(sdkFamilyRoot)) {
    return EXTERNAL_ONLY_SDK_FAMILY_CACHE.get(sdkFamilyRoot);
  }
  const openapiRoot = path.join(sdkFamilyRoot, 'openapi');
  let operationCount = 0;
  let allExternal = true;
  for (const openapiFile of walkFiles(openapiRoot, ['.json'])) {
    const document = parseJsonOpenApi(fs.readFileSync(openapiFile, 'utf8'));
    if (!document) {
      continue;
    }
    for (const { operation } of listOpenApiOperations(document)) {
      operationCount += 1;
      if (!isExternalOperation(operation)) {
        allExternal = false;
      }
    }
  }
  const result = operationCount > 0 && allExternal;
  EXTERNAL_ONLY_SDK_FAMILY_CACHE.set(sdkFamilyRoot, result);
  return result;
}

function scanDocsAndTestsFile(file, repoRoot, issues) {
  const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const checks = [
    { pattern: /[?&]pageSize=/u, message: 'forbidden pageSize query string; use page_size' },
    { pattern: /[?&]limit=/u, message: 'forbidden limit query string; use page_size' },
    { pattern: /[?&](?:page_no|pageNo)=/u, message: 'forbidden page_no/pageNo query string; use page' },
    { pattern: /[?&](?:per_page|size)=/u, message: 'forbidden per_page/size query string; use page_size' },
    { pattern: /[?&]cursor=\d+(?:[&"'`\s]|$)/u, message: 'forbidden numeric cursor query string; use opaque cursor or page/page_size' },
  ];
  const lines = text.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (isExternalProtocolUrlLine(line) || isExternalProtocolQueryFragment(lines, index)) {
      continue;
    }
    for (const check of checks) {
      if (check.pattern.test(line)) {
        if (isForbiddenPaginationAliasRejectionTest(rel, lines, index)) {
          continue;
        }
        issues.push(`${rel}:${index + 1}: [pagination-url-alias] ${check.message}`);
        break;
      }
    }
  }
}

function isTestLikePath(rel) {
  const normalized = rel.replace(/\\/g, '/');
  return (
    normalized.includes('/tests/')
    || /\.test\.[cm]?[jt]sx?$/u.test(normalized)
    || /\.spec\.[cm]?[jt]sx?$/u.test(normalized)
    || /_test\.rs$/u.test(normalized)
  );
}

function isForbiddenPaginationAliasRejectionTest(rel, lines, index) {
  if (!isTestLikePath(rel)) {
    return false;
  }
  const contextStart = Math.max(0, index - 16);
  const contextEnd = Math.min(lines.length, index + 17);
  const context = lines.slice(contextStart, contextEnd).join('\n');
  const statesRejectionIntent = /rejects?|rejected|forbidden|invalid/iu.test(context);
  const namesPaginationAlias = /\b(?:pagination|alias|pageSize|limit|page_no|pageNo|per_page|size|cursor)\b/iu.test(context);
  const assertsInvalidParameter = /\bStatusCode::BAD_REQUEST\b|\bBAD_REQUEST\b|\bINVALID_PARAMETER\b|\b40003\b|\.toBe\(\s*400\s*\)|\.toEqual\(\s*400\s*\)|status(?:Code)?\s*[:=]\s*400\b/iu.test(context);
  return statesRejectionIntent && namesPaginationAlias && assertsInvalidParameter;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function rustQueryExtractorTypes(text) {
  const types = new Set();
  const pattern = /\bQuery\s*\(\s*(?:mut\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\)\s*:\s*Query\s*<\s*([A-Za-z_][A-Za-z0-9_]*)\s*>/gu;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    types.add(match[1]);
  }
  return types;
}

function rustStructBodyRange(text, structName) {
  const structPattern = new RegExp(`\\bstruct\\s+${escapeRegExp(structName)}\\s*\\{`, 'u');
  const match = structPattern.exec(text);
  if (!match) {
    return null;
  }
  const bodyStart = match.index + match[0].length;
  let depth = 1;
  for (let index = bodyStart; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          start: bodyStart,
          end: index,
          body: text.slice(bodyStart, index),
        };
      }
    }
  }
  return null;
}

function rustQueryStructContainsForbiddenField(body, fieldName) {
  const field = escapeRegExp(fieldName);
  const directFieldPattern = new RegExp(`(?:^|\\n)\\s*(?:pub(?:\\([^)]*\\))?\\s+)?${field}\\s*:`, 'u');
  const serdeWirePattern = new RegExp(`#\\s*\\[\\s*serde\\s*\\([^\\]]*(?:rename|alias)\\s*=\\s*["']${field}["'][^\\]]*\\)\\s*\\]`, 'u');
  return directFieldPattern.test(body) || serdeWirePattern.test(body);
}

function scanRustHttpQueryAliases(file, repoRoot, issues) {
  const text = fs.readFileSync(file, 'utf8');
  const queryTypes = rustQueryExtractorTypes(text);
  if (queryTypes.size === 0) {
    return;
  }
  const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
  for (const queryType of queryTypes) {
    const range = rustStructBodyRange(text, queryType);
    if (!range) {
      continue;
    }
    for (const fieldName of FORBIDDEN_PAGINATION_QUERY_FIELDS) {
      if (!rustQueryStructContainsForbiddenField(range.body, fieldName)) {
        continue;
      }
      const line = lineNumberForIndex(text, range.start);
      issues.push(`${rel}:${line}: [rust-http-query-pagination-alias] Rust HTTP Query DTO ${queryType} exposes forbidden pagination query field ${fieldName}; use page_size`);
    }
  }
}

function isExternalProtocolUrlLine(line) {
  return (
    /(?:^|["'`(=\s])(?:https?:\/\/[^"'`\s]+)?\/v1\//u.test(line)
    || /(?:^|["'`(=\s])(?:https?:\/\/[^"'`\s]+)?\/google\/v1(?:alpha|beta|beta1)?\//u.test(line)
    || /(?:^|["'`(=\s])(?:https?:\/\/[^"'`\s]+)?\/anthropic\//u.test(line)
    || /https?:\/\/api\.stripe\.com\/v1\//u.test(line)
  );
}

function isSdkworkBusinessApiLine(line) {
  return /(?:^|["'`(=\s])(?:https?:\/\/[^"'`\s]+)?\/(?:app|backend)\/v3\/api\//u.test(line);
}

function isExternalProtocolQueryFragment(lines, index) {
  const line = lines[index];
  if (isSdkworkBusinessApiLine(line)) {
    return false;
  }
  const contextStart = Math.max(0, index - 24);
  for (let lineIndex = contextStart; lineIndex <= index; lineIndex += 1) {
    if (isExternalProtocolUrlLine(lines[lineIndex])) {
      return true;
    }
  }
  return false;
}

function scanGeneratedSdkTransportFile(file, repoRoot, issues) {
  const normalized = file.replace(/\\/g, '/');
  if (!normalized.includes('/sdks/') || !normalized.includes('/generated/')) {
    return;
  }
  const sdkFamilyRoot = findSdkFamilyRoot(file, repoRoot);
  if (sdkFamilyRoot && sdkFamilyHasOnlyExternalOperations(sdkFamilyRoot)) {
    return;
  }
  const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const checks = [
    { name: 'pageSize', pattern: /(?:QueryParameterSpec|query(?:Params|Parameters)?|append|set|URLSearchParams)[\s\S]{0,160}["'`]pageSize["'`]/u },
    { name: 'limit', pattern: /(?:QueryParameterSpec|query(?:Params|Parameters)?|append|set|URLSearchParams)[\s\S]{0,160}["'`]limit["'`]/u },
    { name: 'page_no', pattern: /(?:QueryParameterSpec|query(?:Params|Parameters)?|append|set|URLSearchParams)[\s\S]{0,160}["'`]page_no["'`]/u },
    { name: 'pageNo', pattern: /(?:QueryParameterSpec|query(?:Params|Parameters)?|append|set|URLSearchParams)[\s\S]{0,160}["'`]pageNo["'`]/u },
    { name: 'per_page', pattern: /(?:QueryParameterSpec|query(?:Params|Parameters)?|append|set|URLSearchParams)[\s\S]{0,160}["'`]per_page["'`]/u },
    { name: 'size', pattern: /(?:QueryParameterSpec|query(?:Params|Parameters)?|append|set|URLSearchParams)[\s\S]{0,160}["'`]size["'`]/u },
  ];
  for (const check of checks) {
    const match = check.pattern.exec(text);
    if (match) {
      const line = text.slice(0, match.index).split('\n').length;
      issues.push(`${rel}:${line}: [generated-sdk-pagination-wire] generated SDK transport emits ${check.name} query; fix OpenAPI/generator input, do not hand-edit generated output`);
    }
  }
}

function scanRepo(repoRoot) {
  const issues = [];
  for (const file of walkFiles(path.join(repoRoot, 'services'), ['.rs'])) {
    scanFile(file, repoRoot, RUST_SMELLS, issues);
    scanRustHttpQueryAliases(file, repoRoot, issues);
  }
  for (const file of walkFiles(path.join(repoRoot, 'adapters'), ['.rs'])) {
    scanFile(file, repoRoot, RUST_SMELLS, issues);
    scanRustHttpQueryAliases(file, repoRoot, issues);
  }
  for (const file of walkFiles(path.join(repoRoot, 'crates'), ['.rs'])) {
    scanFile(file, repoRoot, RUST_SMELLS, issues);
    scanRustHttpQueryAliases(file, repoRoot, issues);
  }
  for (const file of walkFiles(path.join(repoRoot, 'apps'), ['.ts', '.tsx'])) {
    scanFile(file, repoRoot, TS_SMELLS, issues);
  }
  for (const file of walkFiles(path.join(repoRoot, 'apis'), ['.yaml', '.yml', '.json'])) {
    scanOpenApiFile(file, repoRoot, issues);
  }
  for (const file of walkFiles(path.join(repoRoot, 'sdks'), ['.yaml', '.yml', '.json'])) {
    scanOpenApiFile(file, repoRoot, issues);
  }
  for (const file of walkFiles(path.join(repoRoot, 'docs'), DOC_AND_TEST_EXTENSIONS)) {
    scanDocsAndTestsFile(file, repoRoot, issues);
  }
  for (const file of walkFiles(path.join(repoRoot, 'tests'), DOC_AND_TEST_EXTENSIONS)) {
    scanDocsAndTestsFile(file, repoRoot, issues);
  }
  for (const file of walkFiles(path.join(repoRoot, 'services'), DOC_AND_TEST_EXTENSIONS)) {
    scanDocsAndTestsFile(file, repoRoot, issues);
  }
  for (const file of walkFiles(path.join(repoRoot, 'apps'), DOC_AND_TEST_EXTENSIONS)) {
    scanDocsAndTestsFile(file, repoRoot, issues);
  }
  for (const file of walkFilesIncludingGenerated(path.join(repoRoot, 'sdks'), GENERATED_SDK_EXTENSIONS)) {
    scanGeneratedSdkTransportFile(file, repoRoot, issues);
  }
  return issues;
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      root: { type: 'string' },
      'allow-known-debt': { type: 'boolean', default: false },
    },
  });
  const workspace = values.workspace ?? values.root;
  if (!workspace) {
    fail(usage());
  }
  const workspaceRoot = path.resolve(workspace);
  const repoRoots = discoverRepoRoots(workspaceRoot);
  const allIssues = [];
  const knownDebt = [];
  for (const repoRoot of repoRoots) {
    const repoName = path.basename(repoRoot);
    for (const issue of scanRepo(repoRoot)) {
      const entry = `${repoName}/${issue}`;
      if (values['allow-known-debt'] && /\[PAG-00[123]\]/.test(issue)) {
        knownDebt.push(entry);
        continue;
      }
      allIssues.push(entry);
    }
  }
  if (knownDebt.length > 0) {
    console.warn(`pagination known debt (${knownDebt.length}):`);
    for (const entry of knownDebt) {
      console.warn(`- ${entry}`);
    }
  }
  if (allIssues.length > 0) {
    fail(`found ${allIssues.length} pagination smell(s)`, allIssues);
  }
  console.log(`pagination check passed (${repoRoots.length} repo root(s))`);
}

main();
