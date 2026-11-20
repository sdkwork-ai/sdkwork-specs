#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collectWorkspaceValidationIssues } from './lib/workspace-check-runner.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'external',
  'generated',
  'node_modules',
  'target',
  'third_party',
  'vendor',
]);

const SOURCE_EXTENSIONS = new Set(['.java', '.js', '.jsx', '.ts', '.tsx']);
const TEST_FILE_RE = /(?:^|[/\\])(?:__tests__|tests?|fixtures?)(?:[/\\])|[._-](?:test|spec)\.(?:[cm]?[jt]sx?|java)$/u;
const JAVA_HTTP_IMPORT_RE = /^(?:org\.springframework\.(?:http|web)\.|jakarta\.servlet\.|javax\.servlet\.|sdkwork\.web\.)/u;
const RAW_HTTP_CALL_RE =
  /(?<![.\w$])(?:fetch|got)\s*\(|\bky\s*[.(]|\baxios\s*\.|\bnew\s+XMLHttpRequest\s*\(/u;
// A page-local method named `fetch` (for example `fetch(page)` on a Page
// object) is not an HTTP client call. Strip its declaration before probing for
// bare `fetch(`/`got(`/`ky(` call expressions; member calls such as
// `this.fetch(...)` or `port.fetch(...)` are excluded by the negative
// lookbehind above.
const LOCAL_HTTP_HELPER_DEF_RE =
  /(?:^|\n)\s*(?:(?:public|private|protected|static|async|override)\s+)*fetch\s*\([^)]*\)\s*(?::[^{]+)?\{/gu;

function hasRawHttpCall(source) {
  const withoutLocalHelpers = String(source).replace(LOCAL_HTTP_HELPER_DEF_RE, '\n');
  return RAW_HTTP_CALL_RE.test(withoutLocalHelpers);
}
const SDK_CREATE_CLIENT_IMPORT_RE = /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*['"]@sdkwork\/[a-z0-9-]+-(?:app|backend)-sdk(?:\/[^'"]*)?['"]/u;

function usage() {
  return [
    'Usage:',
    '  node tools/check-application-layering.mjs [--root <repo>]',
    '  node tools/check-application-layering.mjs --workspace <sdkwork-space-root>',
    '',
    'Fails when application API/service/repository/frontend layering violates SDKWork boundaries.',
  ].join('\n');
}

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/');
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function walkSourceFiles(rootDir) {
  const files = [];
  if (!fs.existsSync(rootDir)) return files;

  const stack = [rootDir];
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
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (TEST_FILE_RE.test(fullPath)) continue;
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function pathSegments(rel) {
  return rel.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
}

function hasSegment(segments, names) {
  return segments.some((segment) => names.has(segment));
}

function hasSequence(segments, sequence) {
  return segments.some((_, index) => sequence.every((part, offset) => segments[index + offset] === part));
}

function extractJavaImports(source) {
  return [...source.matchAll(/^\s*import\s+(?:static\s+)?([A-Za-z0-9_.]+)(?:\.\*)?\s*;/gmu)]
    .map((match) => match[1]);
}

function isJavaController(rel, source) {
  const segments = pathSegments(rel);
  const base = path.posix.basename(rel).toLowerCase();
  return hasSegment(segments, new Set(['api', 'controller', 'controllers']))
    || base.endsWith('controller.java')
    || /@(RestController|Controller)\b/u.test(source);
}

function isJavaRepository(rel) {
  const segments = pathSegments(rel);
  return hasSegment(segments, new Set(['repository', 'repositories', 'persistence']))
    || hasSequence(segments, ['infrastructure', 'persistence']);
}

function isFrontendUi(rel) {
  const segments = pathSegments(rel);
  if (!hasSegment(segments, new Set(['apps', 'packages', 'src']))) return false;
  return hasSegment(segments, new Set([
    'components',
    'pages',
    'screens',
    'views',
    'widgets',
  ]));
}

function isFrontendService(rel) {
  const segments = pathSegments(rel);
  if (!hasSegment(segments, new Set(['apps', 'packages', 'src']))) return false;
  return hasSegment(segments, new Set(['service', 'services']));
}

function validateJavaFile({ rel, source, issues }) {
  const imports = extractJavaImports(source);

  if (isJavaController(rel, source)) {
    const forbiddenImport = imports.find((specifier) => (
      specifier.includes('.repository.')
      || specifier.includes('.repositories.')
      || specifier.includes('.infrastructure.')
      || specifier.includes('.persistence.')
    ));
    if (forbiddenImport) {
      issues.push(`${rel}: controller must depend on application services or ports, not repository/infrastructure import ${forbiddenImport}`);
    }
    if (/@Transactional\b/u.test(source) || imports.includes('org.springframework.transaction.annotation.Transactional')) {
      issues.push(`${rel}: transactions belong in service/use-case layer; controllers and HTTP adapters must not own transaction boundaries`);
    }
  }

  if (isJavaRepository(rel)) {
    const httpImport = imports.find((specifier) => JAVA_HTTP_IMPORT_RE.test(specifier));
    if (httpImport) {
      issues.push(`${rel}: repository layer must not depend on HTTP framework types (${httpImport}); keep HTTP mapping in API adapters`);
    }
  }
}

function validateFrontendFile({ rel, source, issues }) {
  if (isFrontendUi(rel) && hasRawHttpCall(source)) {
    issues.push(`${rel}: UI layer must not call raw HTTP; call package services and injected SDK clients`);
  }

  if (isFrontendService(rel)) {
    if (hasRawHttpCall(source)) {
      issues.push(`${rel}: service layer must not call raw HTTP; use injected SDK clients or typed service ports`);
    }
    if (SDK_CREATE_CLIENT_IMPORT_RE.test(source) && /\bcreateClient\s*\(/u.test(source)) {
      issues.push(`${rel}: services must receive injected SDK clients; SDK construction belongs in runtime/bootstrap/core`);
    }
  }
}

export function validateApplicationLayering(repoRoot) {
  const issues = [];
  const absoluteRoot = path.resolve(repoRoot);

  for (const filePath of walkSourceFiles(absoluteRoot)) {
    const rel = toPosix(path.relative(absoluteRoot, filePath));
    const source = readText(filePath);
    const ext = path.extname(filePath);

    if (ext === '.java') {
      validateJavaFile({ rel, source, issues });
      continue;
    }

    validateFrontendFile({ rel, source, issues });
  }

  return issues;
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: SPECS_ROOT },
      workspace: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const issues = values.workspace
    ? collectWorkspaceValidationIssues(
      path.resolve(values.workspace),
      (repoRoot) => validateApplicationLayering(repoRoot),
    )
    : validateApplicationLayering(path.resolve(values.root));

  if (issues.length > 0) {
    console.error('application layering check failed: violations found');
    for (const issue of issues.slice(0, 200)) {
      console.error(`- ${issue}`);
    }
    if (issues.length > 200) {
      console.error(`- ... and ${issues.length - 200} more`);
    }
    process.exit(1);
  }

  console.log('application layering check passed');
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main();
}
