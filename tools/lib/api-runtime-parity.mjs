import fs from 'node:fs';
import path from 'node:path';

export const API_RUNTIME_PARITY_KIND = 'sdkwork.api-runtime-parity-evidence';
export const API_RUNTIME_PARITY_SCHEMA_VERSION = 1;

export const INVENTORY_NAMES = Object.freeze([
  'executableRouter',
  'boundManifest',
  'servedOpenapi',
  'sdkAuthority',
]);

const SURFACES = new Set([
  'app-api',
  'backend-api',
  'gateway-api',
  'internal-api',
  'open-api',
]);

const METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
const AUTH_PROFILES = new Set([
  'agent-token',
  'anonymous',
  'api-key',
  'compatibility',
  'credential-entry-bootstrap',
  'dual-token',
  'ingress-token',
  'oauth',
  'open-api-flexible',
  'refresh-token',
]);

const SOURCE_KINDS = Object.freeze({
  executableRouter: new Set(['framework-route-registry', 'runtime-probe']),
  boundManifest: new Set(['framework-bound-manifest']),
  servedOpenapi: new Set(['runtime-http-openapi']),
  sdkAuthority: new Set(['sdk-generation-authority']),
});

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.runtime',
  '.turbo',
  'coverage',
  'dist',
  'external',
  'generated',
  'node_modules',
  'target',
]);

function issueAt(origin, message) {
  return origin ? `${origin}: ${message}` : message;
}

const PARAM_SEGMENT = /^\{[a-z][A-Za-z0-9_]*\}$/u;
// API_SPEC.md section 5.1: an SDKWork custom method suffix (`:<action>`, `:search`,
// `:bulk<Action>`) is permitted only on the final path segment, expressed in
// lowerCamelCase. API_SPEC.md section 4.5.2 additionally requires vendor compatibility
// routes to preserve the upstream platform path verbatim, and section 5.1 makes the
// published authority URI the transport contract, so the suffix stays part of the
// comparison key rather than being stripped.
//
// Grammar accepted on the final segment only:
//   `{param}:<action>`  e.g. `{entryId}:publish`, `{model}:generateContent`
//   `<segment>:<action>` e.g. `users:search`, `users:bulkCreate`, `entries:resolve`
const METHOD_SUFFIX = /^[a-z][A-Za-z0-9]*$/u;
const PARAM_NAME = /^[a-z][A-Za-z0-9_]*$/u;
const PARAM_HEAD = PARAM_NAME;
const PARAM_WITH_METHOD_SUFFIX = /^\{([a-z][A-Za-z0-9_]*)\}:([A-Za-z][A-Za-z0-9]*)$/u;
const COLLECTION_WITH_METHOD_SUFFIX = /^([A-Za-z0-9_\-]+):([A-Za-z][A-Za-z0-9]*)$/u;

export function normalizeApiRoutePath(input) {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes('?') || trimmed.includes('#') || trimmed.includes('\\')) {
    return undefined;
  }
  const normalized = trimmed.replace(/^\/+|\/+$/gu, '');
  if (!normalized) return '/';
  const withRoot = `/${normalized}`;
  if (withRoot.includes('//')) return undefined;
  const rawSegments = withRoot.split('/');
  const lastIndex = rawSegments.length - 1;
  const hasParameter = rawSegments.some((segment) => (
    segment.includes(':') || segment.includes('{') || segment.includes('}')
  ));
  const segments = [];
  for (let index = 0; index < rawSegments.length; index += 1) {
    const segment = rawSegments[index];
    if (!segment.includes(':')) {
      // A `{...}` group outside the strict OpenAPI parameter form is invalid whenever
      // the path uses route templates at all; a plain literal is kept verbatim.
      if ((segment.includes('{') || segment.includes('}')) && !PARAM_SEGMENT.test(segment)) {
        return undefined;
      }
      segments.push(segment);
      continue;
    }
    const isFinal = index === lastIndex;
    // OpenAPI parameter marker: `:param` as a whole segment.
    if (segment.startsWith(':')) {
      const marked = segment.slice(1);
      if (!PARAM_NAME.test(marked)) return undefined;
      segments.push(`{${marked}}`);
      continue;
    }
    if (!isFinal) return undefined;
    const paramMatch = PARAM_WITH_METHOD_SUFFIX.exec(segment);
    if (paramMatch) {
      if (!METHOD_SUFFIX.test(paramMatch[2])) return undefined;
      segments.push(`{${paramMatch[1]}}:${paramMatch[2]}`);
      continue;
    }
    const collectionMatch = COLLECTION_WITH_METHOD_SUFFIX.exec(segment);
    if (collectionMatch) {
      if (!METHOD_SUFFIX.test(collectionMatch[2])) return undefined;
      segments.push(segment);
      continue;
    }
    return undefined;
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) return undefined;
  if (segments.some((segment) => {
    const withoutParams = segment.replace(/\{[a-z][A-Za-z0-9_]*\}/gu, '');
    return withoutParams.includes('{') || withoutParams.includes('}');
  })) return undefined;
  return segments.join('/') || '/';
}

function normalizeInventoryEntry(entry, inventoryName, index, origin, issues) {
  const label = `${inventoryName}[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    issues.push(issueAt(origin, `${label} must be an object`));
    return undefined;
  }
  const surface = entry.surface;
  if (!SURFACES.has(surface)) {
    issues.push(issueAt(origin, `${label}.surface must be a canonical API surface`));
  }
  const method = typeof entry.method === 'string' ? entry.method.toUpperCase() : undefined;
  if (!METHODS.has(method)) {
    issues.push(issueAt(origin, `${label}.method must be one of ${[...METHODS].join(', ')}`));
  }
  const normalizedPath = normalizeApiRoutePath(entry.normalizedPath);
  if (!normalizedPath) {
    issues.push(issueAt(origin, `${label}.normalizedPath is not a valid normalized route path`));
  }
  const operationId = typeof entry.operationId === 'string' ? entry.operationId.trim() : '';
  if (!operationId) {
    issues.push(issueAt(origin, `${label}.operationId must be a non-empty string`));
  }
  const authProfile = entry.authProfile;
  if (!AUTH_PROFILES.has(authProfile)) {
    issues.push(issueAt(origin, `${label}.authProfile must be a canonical authentication profile`));
  }
  if (!SURFACES.has(surface) || !METHODS.has(method) || !normalizedPath || !operationId
    || !AUTH_PROFILES.has(authProfile)) return undefined;
  return { surface, method, normalizedPath, operationId, authProfile };
}

function routeKey(entry) {
  return `${entry.surface} ${entry.method} ${entry.normalizedPath}`;
}

function validateSource(source, inventoryName, origin, issues) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    issues.push(issueAt(origin, `sources.${inventoryName} must be an object`));
    return;
  }
  if (!SOURCE_KINDS[inventoryName].has(source.kind)) {
    issues.push(issueAt(
      origin,
      `sources.${inventoryName}.kind must be one of ${[...SOURCE_KINDS[inventoryName]].join(', ')}`,
    ));
  }
  if (typeof source.location !== 'string' || !source.location.trim()) {
    issues.push(issueAt(origin, `sources.${inventoryName}.location must be a non-empty string`));
  }
  if (source.sha256 !== undefined && !/^[a-f0-9]{64}$/u.test(source.sha256)) {
    issues.push(issueAt(origin, `sources.${inventoryName}.sha256 must be lowercase SHA-256 hex`));
  }
}

function compareInventories(reference, candidate, candidateName, origin, issues) {
  const referenceByRoute = new Map(reference.map((entry) => [routeKey(entry), entry]));
  const candidateByRoute = new Map(candidate.map((entry) => [routeKey(entry), entry]));
  for (const [key, expected] of referenceByRoute) {
    const actual = candidateByRoute.get(key);
    if (!actual) {
      issues.push(issueAt(origin, `${candidateName} is missing route ${key}`));
      continue;
    }
    if (actual.operationId !== expected.operationId) {
      issues.push(issueAt(
        origin,
        `${candidateName} operationId mismatch for ${key}: expected ${expected.operationId}, found ${actual.operationId}`,
      ));
    }
    if (actual.authProfile !== expected.authProfile) {
      issues.push(issueAt(
        origin,
        `${candidateName} authProfile mismatch for ${key}: expected ${expected.authProfile}, found ${actual.authProfile}`,
      ));
    }
  }
  for (const key of candidateByRoute.keys()) {
    if (!referenceByRoute.has(key)) {
      issues.push(issueAt(origin, `${candidateName} has extra route ${key}`));
    }
  }
}

export function validateApiRuntimeParityEvidence(evidence, { origin = '' } = {}) {
  const issues = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return [issueAt(origin, 'evidence must be a JSON object')];
  }
  if (evidence.schemaVersion !== API_RUNTIME_PARITY_SCHEMA_VERSION) {
    issues.push(issueAt(origin, `schemaVersion must be ${API_RUNTIME_PARITY_SCHEMA_VERSION}`));
  }
  if (evidence.kind !== API_RUNTIME_PARITY_KIND) {
    issues.push(issueAt(origin, `kind must be ${API_RUNTIME_PARITY_KIND}`));
  }
  for (const field of ['application', 'profile']) {
    if (typeof evidence[field] !== 'string' || !evidence[field].trim()) {
      issues.push(issueAt(origin, `${field} must be a non-empty string`));
    }
  }
  if (!['none', 'served'].includes(evidence.apiMode)) {
    issues.push(issueAt(origin, 'apiMode must be served or none'));
  }
  if (!evidence.sources || typeof evidence.sources !== 'object') {
    issues.push(issueAt(origin, 'sources must be an object'));
  }
  if (!evidence.inventories || typeof evidence.inventories !== 'object') {
    issues.push(issueAt(origin, 'inventories must be an object'));
    return issues;
  }

  const normalized = {};
  for (const inventoryName of INVENTORY_NAMES) {
    validateSource(evidence.sources?.[inventoryName], inventoryName, origin, issues);
    const entries = evidence.inventories[inventoryName];
    if (!Array.isArray(entries)) {
      issues.push(issueAt(origin, `inventories.${inventoryName} must be an array`));
      normalized[inventoryName] = [];
      continue;
    }
    normalized[inventoryName] = entries
      .map((entry, index) => normalizeInventoryEntry(
        entry,
        `inventories.${inventoryName}`,
        index,
        origin,
        issues,
      ))
      .filter(Boolean);
    const seen = new Set();
    for (const entry of normalized[inventoryName]) {
      const key = routeKey(entry);
      if (seen.has(key)) {
        issues.push(issueAt(origin, `inventories.${inventoryName} contains duplicate route ${key}`));
      }
      seen.add(key);
    }
  }

  const reference = normalized.executableRouter;
  if (evidence.apiMode === 'served' && reference.length === 0) {
    issues.push(issueAt(origin, 'served API evidence must contain executable routes'));
  }
  if (evidence.apiMode === 'none' && INVENTORY_NAMES.some((name) => normalized[name].length > 0)) {
    issues.push(issueAt(origin, 'apiMode none requires all four inventories to be empty'));
  }
  for (const inventoryName of INVENTORY_NAMES.slice(1)) {
    compareInventories(reference, normalized[inventoryName], inventoryName, origin, issues);
  }
  return issues;
}

export function validateApiRuntimeParityFile(filePath) {
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
  } catch (error) {
    return [`${filePath}: unable to read API runtime parity evidence: ${error.message}`];
  }
  return validateApiRuntimeParityEvidence(evidence, { origin: filePath });
}

export function discoverApiRuntimeParityEvidence(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  const pending = [path.resolve(root)];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (
        entry.isFile()
        && /^api-runtime-parity(?:\.[a-z0-9-]+)?\.evidence\.json$/u.test(entry.name)
      ) found.push(entryPath);
    }
  }
  return found.sort((left, right) => left.localeCompare(right));
}
