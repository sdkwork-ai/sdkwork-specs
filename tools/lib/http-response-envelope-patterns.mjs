/**
 * Shared patterns for SdkWork HTTP response envelope validation.
 * See API_SPEC.md §15.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyOperationWireProtocolMarkers,
  isExternalProtocolOperation,
  openApiOperationEntriesFromText,
} from './openapi-operation-utils.mjs';

export const LEGACY_ENVELOPE_SCHEMAS = [
  'PlusApiResult',
  'AppbaseApiResult',
  'StoreApiResult',
  'CommunityApiResult',
  'CatalogApiResult',
  'SdkWorkResponse',
];

export const LEGACY_ENVELOPE_PATTERN = new RegExp(
  `\\b(${LEGACY_ENVELOPE_SCHEMAS.join('|')}|\\w+ApiResult)\\b`,
);

export const FORBIDDEN_REQUEST_ID_PATTERN = /(?:["']requestId["']|\brequestId)\s*:/;

export const LEGACY_STRING_RESULT_CODE_PATTERN =
  /enum:\s*\[(?:ok|created|accepted|updated|deleted|validation_error|not_found|internal_error)/;

export const PROBLEM_DETAIL_PATTERN = /ProblemDetail|application\/problem\+json/;

export const SDKWORK_API_RESPONSE_PATTERN =
  /SdkWorkApiResponse|SdkWorkResourceData|SdkWorkPageData|SdkWorkCommandData/;

export const AGENTS_SECTION_HEADING = '## HTTP API Response Envelope';

export const AGENTS_SECTION_BODY = `${AGENTS_SECTION_HEADING}

All L2+ SDKWork-owned custom HTTP contracts, including \`app-api\`, \`backend-api\`, and SDKWork-owned business \`open-api\`, \`MUST\` follow \`API_SPEC.md\` section 4.5, section 14, and section 15:

- **Default classification:** omitted \`x-sdkwork-wire-protocol\` means SDKWork-owned custom API (\`sdkwork-v3\`); only operation-level \`x-sdkwork-wire-protocol: external\` plus \`x-sdkwork-external-protocol-id\` identifies a third-party compatibility \`open-api\` operation.
- **Input:** typed request bodies, section 14.1 list/search/command input, \`SdkWorkListQuery\`, and \`q\` for free-text search.
- **Success output:** \`SdkWorkApiResponse\` with \`{ "code": 0, "data": <payload>, "traceId": "<server-uuid>" }\`.
- **Error output:** HTTP 4xx/5xx \`application/problem+json\` (\`ProblemDetail\`) with numeric \`code\` and \`traceId\`; SDKWork-owned errors may include \`i18nKey\` and \`locale\` presentation metadata.
- Success \`code\` is numeric \`int32\`; HTTP 2xx JSON bodies \`MUST\` use \`0\` only. REST semantics remain on HTTP status (\`201\`, \`202\`, etc.).
- Platform error codes are numeric non-zero values per section 15.3 (\`40001\`, \`40101\`, \`40401\`, …).
- Single resource: \`data.item\`
- Lists: \`data.items\` + \`data.pageInfo\` (\`PageInfo.mode\` is \`offset\` or \`cursor\`)
- Commands: \`data.accepted\` plus optional \`resourceId\` / \`status\`
- Async accept (\`202\`): \`data.operationId\`, \`data.status\`, optional \`pollUrl\`
- Operation patterns: retrieve/list/search/create/update/delete/command/async/bulk semantics follow \`API_SPEC.md\` section 15.4; create uses \`201\`, delete uses \`204\` with no JSON body, and \`PUT\`/\`PATCH\` use SDK action \`update\`.

Vendor compatibility \`open-api\` routes that mirror upstream tool or provider wire (for example OpenAI \`/v1/*\`, Anthropic/Claude \`/anthropic/v1/*\`, Google/Gemini \`/google/v1beta/*\`, Claude Code, or Codex) \`MAY\` opt out only when every exempt operation declares operation-level \`x-sdkwork-wire-protocol: external\` and \`x-sdkwork-external-protocol-id\` per \`API_SPEC.md\` section 4.5.2. SDKWork-owned business \`open-api\` operations \`MUST NOT\` opt out. Mixed OpenAPI documents are validated per operation; one external operation never exempts SDKWork-owned operations in the same document.

Errors \`MUST\` use HTTP 4xx/5xx with \`application/problem+json\` (\`ProblemDetail\`) including required numeric \`code\` and \`traceId\`. Optional \`i18nKey\` and \`locale\` are display metadata only. Business failures \`MUST NOT\` use HTTP 2xx with non-zero \`code\`, string wire codes, \`success\`, or human \`message\`.

Forbidden legacy envelopes and fields: \`PlusApiResult\`, \`AppbaseApiResult\`, \`StoreApiResult\`, \`SdkWorkResponse\`, per-domain \`*ApiResult\`, wire field \`requestId\`, bare domain DTOs at the HTTP root, and top-level \`{ items, pageInfo, traceId }\` without \`data\`.

Handlers \`MUST\` serialize success and map errors through \`sdkwork-web-framework\` response mapping. Generated HTTP SDKs (\`--standard-profile sdkwork-v3\`) unwrap \`data\` by default and expose typed numeric \`ProblemDetail.code\` / \`traceId\` and returned localization metadata on errors; use \`.raw\` when the full envelope is required.

Before completing API contract, SDK generation, or frontend service work, run:

\`\`\`bash
node <sdkwork-specs>/tools/check-api-operation-patterns.mjs --workspace <workspace-root>
node <sdkwork-specs>/tools/check-api-response-envelope.mjs --workspace <workspace-root>
\`\`\`

Authority: \`sdkwork-specs/API_SPEC.md\` section 4.5 and sections 14–16, \`SDK_SPEC.md\` section 4.2, \`FRONTEND_SPEC.md\`, \`MIGRATION_SPEC.md\` section 4.2.
`;

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'artifacts',
  'target',
  '.runtime',
  'dist',
  'build',
  '.pnpm-store',
  '.tmp',
  '.turbo',
  'coverage',
]);

export function isIgnoredGeneratedOrRuntimeDir(name) {
  return IGNORE_DIRS.has(name) || /^target[-_].+/u.test(name);
}

export function repoNameFromPath(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const sdkParts = parts.filter((p) => /^sdkwork-/.test(p));
  const appRepo = sdkParts.find((p) => p !== 'sdkwork-space' && p !== 'sdkwork-specs');
  return appRepo || sdkParts[sdkParts.length - 1] || 'unknown';
}

export function isAppOrBackendApiOpenApi(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  if (/\/generated\/sdks\//i.test(norm)) return false;
  const hasAuthoritySurface =
    /(open-api|app-api|backend-api)/i.test(norm) ||
    /\/sdks\/[^/]+-(?:open|app|backend)-sdk\/openapi\/[^/]+\.openapi\.(?:ya?ml|json)$/i.test(norm);
  return hasAuthoritySurface && /openapi\.(ya?ml|json)$/i.test(norm);
}

export function isExternalProtocolOpenApi(text) {
  const { entries } = openApiOperationEntriesFromText(text);
  return entries.length > 0 && entries.every(({ operation }) => isExternalProtocolOperation(operation));
}

export function preferredAuthorityScore(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  if (norm.includes('/sdks/') && norm.includes('/openapi/')) return 3;
  if (norm.includes('/apis/')) return 2;
  if (norm.includes('/generated/openapi/')) return 1;
  return 0;
}

export function walkOpenApiFiles(root, acc = []) {
  if (!fs.existsSync(root)) return acc;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (isIgnoredGeneratedOrRuntimeDir(ent.name)) continue;
    const full = path.join(root, ent.name);
    let stat;
    try {
      // lstat, not stat: dependency managers leave junction/symlink cycles in
      // place (pnpm `node_modules.__stale__donor*` debris), and following them
      // makes this walk revisit the same physical tree under ever-growing
      // logical paths. OpenAPI authorities are never reached through a
      // symlink, so symlinked entries are skipped outright.
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walkOpenApiFiles(full, acc);
    else if (isAppOrBackendApiOpenApi(full)) acc.push(full);
  }
  return acc;
}

export function classifyOpenApiWireProtocolMarkers(text) {
  const { document, entries } = openApiOperationEntriesFromText(text);
  const issues = [];
  if (document) {
    const info = document.info && typeof document.info === 'object' ? document.info : {};
    if (info['x-sdkwork-wire-protocol'] === 'external' && !info['x-sdkwork-external-protocol-id']) {
      issues.push({
        kind: 'incomplete-vendor-wire-protocol',
        detail: 'document-level x-sdkwork-wire-protocol: external requires x-sdkwork-external-protocol-id',
      });
    }
  }
  issues.push(...classifyOperationWireProtocolMarkers(entries));
  if (
    entries.length === 0 &&
    /x-sdkwork-wire-protocol["']?\s*:\s*["']?external["']?/i.test(text) &&
    !/x-sdkwork-external-protocol-id["']?\s*:/i.test(text)
  ) {
    issues.push({
      kind: 'incomplete-vendor-wire-protocol',
      detail:
        'x-sdkwork-wire-protocol: external requires x-sdkwork-external-protocol-id on the same document or operation',
    });
  }
  return issues;
}

export function classifyOpenApiEnvelope(text) {
  const parsed = openApiOperationEntriesFromText(text);
  if (parsed.entries.length > 0) {
    return classifyStructuredOpenApiEnvelope(text, parsed);
  }

  const issues = [];
  const legacyMatch = text.match(LEGACY_ENVELOPE_PATTERN);
  if (legacyMatch && !text.includes('Forbidden legacy')) {
    issues.push({ kind: 'legacy-envelope', detail: `uses ${legacyMatch[0]}` });
  }
  if (FORBIDDEN_REQUEST_ID_PATTERN.test(text)) {
    issues.push({ kind: 'forbidden-request-id', detail: 'response schema still declares requestId' });
  }
  if (LEGACY_STRING_RESULT_CODE_PATTERN.test(text)) {
    issues.push({
      kind: 'legacy-string-result-code',
      detail: 'result code still uses forbidden string enum tokens',
    });
  }
  if (
    /\bsuccess\s*:\s*\{?\s*type:\s*boolean/.test(text) ||
    /"success"\s*:\s*\{[^}]*"type"\s*:\s*"boolean"/.test(text)
  ) {
    if (/StoreApiResult|CommandResult/.test(text)) {
      issues.push({ kind: 'success-boolean-envelope', detail: 'success boolean in response schema' });
    }
  }
  if (!PROBLEM_DETAIL_PATTERN.test(text)) {
    issues.push({ kind: 'missing-problem-detail', detail: 'no ProblemDetail or application/problem+json' });
  }
  const hasModern =
    SDKWORK_API_RESPONSE_PATTERN.test(text) ||
    (/required:\s*\[(?:code,\s*)?data,\s*traceId\]/i.test(text) &&
      /traceId:/.test(text) &&
      /code:/.test(text) &&
      !LEGACY_ENVELOPE_PATTERN.test(text));
  if (!hasModern) {
    issues.push({
      kind: 'missing-sdkwork-api-response',
      detail: 'no SdkWorkApiResponse or canonical code+data+traceId envelope',
    });
  }
  return issues;
}

function classifyStructuredOpenApiEnvelope(text, parsed) {
  const issues = [];
  const ownedEntries = parsed.entries.filter(({ operation }) => !isExternalProtocolOperation(operation));
  if (ownedEntries.length === 0) {
    return issues;
  }

  const legacyMatch = text.match(LEGACY_ENVELOPE_PATTERN);
  if (legacyMatch && !text.includes('Forbidden legacy')) {
    issues.push({ kind: 'legacy-envelope', detail: `uses ${legacyMatch[0]}` });
  }
  if (FORBIDDEN_REQUEST_ID_PATTERN.test(text)) {
    issues.push({ kind: 'forbidden-request-id', detail: 'response schema still declares requestId' });
  }
  if (LEGACY_STRING_RESULT_CODE_PATTERN.test(text)) {
    issues.push({
      kind: 'legacy-string-result-code',
      detail: 'result code still uses forbidden string enum tokens',
    });
  }
  if (
    /\bsuccess\s*:\s*\{?\s*type:\s*boolean/.test(text) ||
    /"success"\s*:\s*\{[^}]*"type"\s*:\s*"boolean"/.test(text)
  ) {
    if (/StoreApiResult|CommandResult/.test(text)) {
      issues.push({ kind: 'success-boolean-envelope', detail: 'success boolean in response schema' });
    }
  }
  if (!PROBLEM_DETAIL_PATTERN.test(text)) {
    issues.push({ kind: 'missing-problem-detail', detail: 'no ProblemDetail or application/problem+json' });
  }

  for (const entry of ownedEntries) {
    const responses = entry.operation.responses && typeof entry.operation.responses === 'object'
      ? entry.operation.responses
      : {};
    for (const [status, response] of Object.entries(responses)) {
      if (!isJsonSuccessStatus(status) || !responseDeclaresJsonBody(response, parsed.document)) {
        continue;
      }
      if (!responseUsesSdkWorkApiResponse(response, parsed.document)) {
        issues.push({
          kind: 'missing-sdkwork-api-response',
          detail: `${entry.method.toUpperCase()} ${entry.routePath} HTTP ${status} does not return SdkWorkApiResponse`,
        });
      }
    }
  }
  return issues;
}

export function openApiAuthorityEntries(files) {
  return files
    .map((file) => {
      const norm = file.replace(/\\/g, '/');
      const surface = norm.includes('backend-api') || /-backend-sdk\/openapi\//i.test(norm)
        ? 'backend-api'
        : norm.includes('open-api') || /-open-sdk\/openapi\//i.test(norm)
          ? 'open-api'
          : 'app-api';
      return {
        file,
        repo: repoNameFromPath(file),
        score: preferredAuthorityScore(file),
        surface,
      };
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

function isJsonSuccessStatus(status) {
  return /^2[0-9][0-9]$/u.test(String(status)) && String(status) !== '204';
}

function responseDeclaresJsonBody(response, document) {
  const resolvedResponse = resolveResponse(response, document);
  if (!resolvedResponse || typeof resolvedResponse !== 'object') {
    return false;
  }
  const content = resolvedResponse.content && typeof resolvedResponse.content === 'object'
    ? resolvedResponse.content
    : {};
  return Object.keys(content).some((mediaType) => /json/iu.test(mediaType));
}

function responseUsesSdkWorkApiResponse(response, document) {
  const resolvedResponse = resolveResponse(response, document);
  if (!resolvedResponse || typeof resolvedResponse !== 'object') {
    return false;
  }
  if (containsSdkWorkApiResponse(resolvedResponse, document)) {
    return true;
  }
  const content = resolvedResponse.content && typeof resolvedResponse.content === 'object' ? resolvedResponse.content : {};
  return Object.entries(content).some(([mediaType, media]) => {
    if (!/json/iu.test(mediaType)) {
      return false;
    }
    const schema = media?.schema;
    return containsSdkWorkApiResponse(schema, document);
  });
}

function resolveResponse(response, document) {
  if (!response || typeof response !== 'object') {
    return null;
  }
  if (typeof response.$ref === 'string' && document) {
    const resolved = resolveLocalRef(document, response.$ref);
    return resolved && typeof resolved === 'object' ? resolved : response;
  }
  return response;
}

function containsSdkWorkApiResponse(value, document, seenRefs = new Set()) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (isInlineSdkWorkApiResponseSchema(value)) {
    return true;
  }
  if (typeof value.$ref === 'string') {
    if (/SdkWorkApiResponse|SdkWorkResourceData|SdkWorkPageData|SdkWorkCommandData/u.test(value.$ref)) {
      return true;
    }
    if (document && !seenRefs.has(value.$ref)) {
      seenRefs.add(value.$ref);
      const resolved = resolveLocalRef(document, value.$ref);
      if (containsSdkWorkApiResponse(resolved, document, seenRefs)) {
        return true;
      }
    }
  }
  const encoded = JSON.stringify(value);
  if (/SdkWorkApiResponse|SdkWorkResourceData|SdkWorkPageData|SdkWorkCommandData/u.test(encoded)) {
    return true;
  }
  return Object.values(value).some((child) => containsSdkWorkApiResponse(child, document, seenRefs));
}

function isInlineSdkWorkApiResponseSchema(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (
    Array.isArray(value.required)
    && ['code', 'data', 'traceId'].every((field) => value.required.includes(field))
    && value.properties
    && typeof value.properties === 'object'
    && ['code', 'data', 'traceId'].every((field) => Object.prototype.hasOwnProperty.call(value.properties, field))
  ) {
    return true;
  }
  return Object.values(value).some((child) => isInlineSdkWorkApiResponseSchema(child));
}

function resolveLocalRef(document, ref) {
  if (!ref.startsWith('#/')) {
    return null;
  }
  return ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'))
    .reduce((current, segment) => {
      if (!current || typeof current !== 'object') {
        return null;
      }
      return current[segment];
    }, document);
}

export function walkAgentsFiles(root, acc = []) {
  if (!fs.existsSync(root)) return acc;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (isIgnoredGeneratedOrRuntimeDir(ent.name)) continue;
    const full = path.join(root, ent.name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walkAgentsFiles(full, acc);
    else if (ent.name === 'AGENTS.md') acc.push(full);
  }
  return acc;
}

export function upsertAgentsEnvelopeSection(content) {
  const headingRegex = /^## HTTP API Response Envelope\b/m;
  if (headingRegex.test(content)) {
    const idx = content.search(headingRegex);
    const before = content.slice(0, idx).trimEnd();
    const tail = removeAgentsEnvelopeSections(content.slice(idx));
    return `${before}\n\n${AGENTS_SECTION_BODY.trim()}\n\n${tail.replace(/^\n+/, '')}`;
  }
  const humanReview = '\n## Human Review Rules';
  if (content.includes(humanReview)) {
    return content.replace(humanReview, `\n${AGENTS_SECTION_BODY.trim()}\n${humanReview}`);
  }
  return `${content.trimEnd()}\n\n${AGENTS_SECTION_BODY.trim()}\n`;
}

function removeAgentsEnvelopeSections(content) {
  const headings = Array.from(content.matchAll(/^## [^\r\n]*$/gm));
  let result = '';
  let cursor = 0;
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const sectionStart = heading.index ?? 0;
    const sectionEnd = headings[i + 1]?.index ?? content.length;
    if (/^## HTTP API Response Envelope\b/u.test(heading[0])) {
      result += content.slice(cursor, sectionStart);
      cursor = sectionEnd;
    }
  }
  result += content.slice(cursor);
  return result;
}
