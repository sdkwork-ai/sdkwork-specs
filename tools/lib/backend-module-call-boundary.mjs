// Backend module call boundary (MODULE_SPEC.md §4.2).
//
// A SDKWork backend module MUST reach a sibling module in-process (a Cargo
// dependency on its service/contract/repository port), never through that
// module's own HTTP surface. The incident this check exists for: the order
// module called the account module over loopback HTTP, needed
// `SDKWORK_ACCESS_TOKEN`, the deployment had neither a token nor an account
// HTTP service, and every coupon redemption returned HTTP 500 *after* the
// coupon had already been consumed.
//
// The check is deliberately narrow: it only looks at environment variables that
// name a sibling module's URL, read from non-client Rust backend code. That is
// the precise shape of the anti-pattern; a generic "crate uses reqwest" rule
// would drown in legitimate external-provider integrations.

import fs from 'node:fs';
import path from 'node:path';

/** Module names an SDKWork repository can own as a sibling. */
const SIBLING_MODULE_SEGMENTS = new Set([
  'account',
  'agents',
  'appbase',
  'appstore',
  'billing',
  'canvas',
  'cms',
  'community',
  'company',
  'course',
  'customer',
  'customerservice',
  'directory',
  'discovery',
  'drive',
  'feeds',
  'files',
  'github',
  'iam',
  'image',
  'im',
  'inventory',
  'invoice',
  'knowledgebase',
  'llm',
  'mail',
  'manager',
  'membership',
  'memory',
  'messaging',
  'models',
  'news',
  'notes',
  'notary',
  'order',
  'partner',
  'payment',
  'portal',
  'promotion',
  'recharge',
  'rtc',
  'search',
  'settings',
  'shop',
  'tts',
  'voice',
  'webserver',
]);

/** Third-party endpoints are legitimate outbound HTTP and never a violation. */
const EXTERNAL_VENDOR_SEGMENTS = new Set([
  'acme',
  'alipay',
  'anythingllm',
  'anthropic',
  'apns',
  'aws',
  'azure',
  'chroma',
  'dify',
  'facebook',
  'fcm',
  'flowise',
  'gemini',
  'google',
  'haystack',
  'jaeger',
  'kafka',
  'letsencrypt',
  'loki',
  'minio',
  'nats',
  'openai',
  'openwebui',
  'oss',
  'onyx',
  'otel',
  'otlp',
  'paypal',
  'prometheus',
  'qdrant',
  'rabbitmq',
  'ragflow',
  's3',
  'searxng',
  'sentry',
  'smtp',
  'stripe',
  'tempo',
  'tencent',
  'twilio',
  'weaviate',
  'wechat',
]);

/**
 * Segments that name a URL the module *publishes* (redirect target, issuer,
 * login page, JWKS, webhook receiver) rather than a sibling module it *calls*.
 */
const NON_CALL_SEGMENTS = new Set([
  'audience',
  'callback',
  'code',
  'consent',
  'cookie',
  'cors',
  'domain',
  'health',
  'host',
  'issuer',
  'jwks',
  'login',
  'oauth',
  'public',
  'readiness',
  'redirect',
  'return',
  'webhook',
]);

/** Suffixes that turn a name into an addressable HTTP endpoint. */
const ENDPOINT_SUFFIXES = ['_BASE_URL', '_URL', '_ORIGIN', '_ENDPOINT', '_BASEURI'];

const ALLOWLIST_FILE_NAMES = [
  'specs/backend-module-call-boundary.allow.json',
  'backend-module-call-boundary.allow.json',
];

const ENV_READ = /env::var(?:_os)?\(\s*"([A-Z0-9_]+)"\s*\)/g;
const ENDPOINT_LITERAL = /"([A-Z][A-Z0-9_]*_(?:BASE_URL|URL|ORIGIN|ENDPOINT|BASEURI))"/g;

/**
 * Second detection mode: backend code that speaks a sibling module's HTTP
 * surface directly instead of only reading an endpoint variable. It fires when
 * one file both builds an outbound HTTP client and names a sibling API surface.
 * Route crates are excluded — they *serve* those paths.
 */
const OUTBOUND_CLIENT = /reqwest::Client|ureq::(?:agent|get|post)|hyper::Client|hyper_util::client/;
const SIBLING_SURFACE_PATH = /\/(?:app|backend|internal|open)\/v3\/api\//;
const GENERATED_SDK_CLIENT =
  /use\s+sdkwork_[a-z0-9_]+_sdk\b|SdkworkAppClient::|SdkworkBackendClient::|sdkwork_[a-z0-9_]+_sdk::[A-Za-z]*Client/;

/** Crates that serve a surface rather than call one. */
const ROUTE_CRATE_PATTERN = /-routes-/;

/**
 * Crates that are clients of the platform, not backends: desktop/mobile hosts,
 * CLIs, generated SDK wrappers, and client-local bridges. They legitimately
 * speak HTTP to the gateway, so mode 2 does not scan them.
 */
const CLIENT_SIDE_CRATE_PATTERN = /-(bridge|client|cli|desktop|tauri|tool|tools|tool-[a-z0-9-]+)$/;

/**
 * Synthetic "endpoint" names reported by the second detection mode. They let an
 * allowlist entry target one detection shape (`"envVar": "(inline surface path)"`
 * or `"(generated sdk client)"`), while the documented file-scoped entry — the
 * one without `envVar` — covers both. A written reason is still required.
 */
const INLINE_SURFACE_ENV_VAR = '(inline surface path)';
const GENERATED_SDK_ENV_VAR = '(generated sdk client)';

const SKIPPED_DIR_NAMES = new Set(['node_modules', 'target', 'external', 'dist', 'build']);

/** Crates that are clients/tools/hosts: they legitimately speak HTTP. */
const CLIENT_CRATE_PATTERN = /-(client|cli|sdk|tool|tools|tool-[a-z0-9-]+|desktop|tauri)(-|$)/;

function segmentsOf(name) {
  return name
    .toLowerCase()
    .split('_')
    .filter(Boolean);
}

function endpointSuffixOf(name) {
  return ENDPOINT_SUFFIXES.find((suffix) => name.endsWith(suffix));
}

/**
 * Classifies one environment variable name.
 *
 * Returns `null` when the name is not a sibling-module endpoint, otherwise
 * `{ module }`.
 *
 * @param {string} name environment variable name
 * @param {string} [owningModule] module that owns the crate, when known; a
 *   module publishing its own public URL is not a cross-module call.
 */
export function classifyModuleEndpointEnvVar(name, owningModule) {
  const suffix = endpointSuffixOf(name);
  if (!suffix) {
    return null;
  }
  // Browser-bundle variables are read to hand a URL to a client, not called.
  if (name.startsWith('VITE_') || name.startsWith('PUBLIC_')) {
    return null;
  }
  const segments = segmentsOf(name);
  // RPC endpoints are a separate, spec-governed transport (RPC_SPEC.md);
  // service discovery is infrastructure, not a module call.
  if (segments.some((segment) => ['rpc', 'discovery', 'grpc'].includes(segment))) {
    return null;
  }
  if (segments.some((segment) => EXTERNAL_VENDOR_SEGMENTS.has(segment))) {
    return null;
  }
  // A published URL (redirect target, issuer, JWKS, health probe) is not a call.
  if (segments.some((segment) => NON_CALL_SEGMENTS.has(segment))) {
    return null;
  }
  // Never treat the shared infrastructure as a module endpoint.
  if (segments.some((segment) => ['database', 'redis', 'sqlite', 'migration', 'lock'].includes(segment))) {
    return null;
  }
  // The *target* module is the last sibling segment before the endpoint suffix:
  // `APPSTORE_DRIVE_BASE_URL` is appstore calling drive, not appstore itself.
  const module = [...segments].reverse().find((segment) => SIBLING_MODULE_SEGMENTS.has(segment));
  if (!module) {
    return null;
  }
  // Self-reference: the module addressing its own surface.
  if (owningModule && stringModuleOf(owningModule) === module) {
    return null;
  }
  return { module };
}

/** Normalises a repository/directory name to its module token. */
function stringModuleOf(value) {
  const normalized = String(value ?? '').toLowerCase().replace(/^sdkwork-/, '');
  const segments = normalized.split(/[-_]/).filter(Boolean);
  // The last known sibling segment, so `sdkwork-api-canvas-assembly` -> canvas.
  return [...segments].reverse().find((segment) => SIBLING_MODULE_SEGMENTS.has(segment)) ?? normalized;
}

/** Module token owned by a repository directory (`sdkwork-feeds` -> feeds). */
function repoModule(repoRoot) {
  return stringModuleOf(path.basename(repoRoot));
}

function isClientCrate(crateDir) {
  return CLIENT_CRATE_PATTERN.test(path.basename(crateDir));
}

function walkRustFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      walkRustFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.rs')) {
      out.push(full);
    }
  }
}

function candidateCrateDirs(repoRoot) {
  const dirs = [];
  for (const parent of ['crates', 'packages', 'services']) {
    const parentDir = path.join(repoRoot, parent);
    let entries;
    try {
      entries = fs.readdirSync(parentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIPPED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      const crateDir = path.join(parentDir, entry.name);
      const srcDir = path.join(crateDir, 'src');
      if (fs.existsSync(srcDir)) {
        dirs.push({ crateDir, srcDir });
      }
    }
  }
  return dirs;
}

function loadAllowlist(repoRoot) {
  for (const relative of ALLOWLIST_FILE_NAMES) {
    const file = path.join(repoRoot, relative);
    if (!fs.existsSync(file)) {
      continue;
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entries = Array.isArray(parsed.allow) ? parsed.allow : [];
    return entries.map((entry) => ({
      file: String(entry.file ?? '').replace(/\\/g, '/'),
      envVar: entry.envVar ? String(entry.envVar) : undefined,
      module: entry.module ? String(entry.module) : undefined,
      reason: String(entry.reason ?? ''),
    }));
  }
  return [];
}

function isAllowed(allowlist, relativeFile, envVar, module) {
  return allowlist.some((entry) => {
    if (entry.file && !relativeFile.endsWith(entry.file)) {
      return false;
    }
    if (entry.envVar && entry.envVar !== envVar) {
      return false;
    }
    if (entry.module && entry.module !== module) {
      return false;
    }
    // An entry must carry a written justification; an empty reason is not an allowlist.
    return entry.reason.trim().length > 0;
  });
}

/**
 * Validates one repository root.
 *
 * @param {string} repoRoot absolute repository root
 * @returns {Array<{file:string,line:number,envVar:string,module:string,message:string}>}
 */
export function validateBackendModuleCallBoundary(repoRoot) {
  const allowlist = loadAllowlist(repoRoot);
  const issues = [];
  const owningModule = repoModule(repoRoot);
  for (const { crateDir, srcDir } of candidateCrateDirs(repoRoot)) {
    if (isClientCrate(crateDir)) {
      continue;
    }
    const files = [];
    walkRustFiles(srcDir, files);
    for (const file of files) {
      const relativeFile = path.relative(repoRoot, file).replace(/\\/g, '/');
      const source = fs.readFileSync(file, 'utf8');
      if (!/"[A-Z][A-Z0-9_]*_(BASE_URL|URL|ORIGIN|ENDPOINT|BASEURI)"/.test(source)) {
        continue;
      }
      const lines = source.split(/\r?\n/);
      // Tests legitimately fake environment variables, so everything after the
      // first `#[cfg(test)]` marker is out of scope.
      const testMarker = source.search(/#\[cfg\(test\)\]/);
      const testStartLine = testMarker < 0
        ? Number.POSITIVE_INFINITY
        : source.slice(0, testMarker).split(/\r?\n/).length;
      for (const [index, line] of lines.entries()) {
        if (index + 1 >= testStartLine) {
          break;
        }
        if (line.trimStart().startsWith('//')) {
          continue;
        }
        // Any endpoint-shaped string literal counts, not just `env::var(...)`:
        // a wrapper such as `env("SDKWORK_X_BACKEND_API_BASE_URL")` reads the
        // same endpoint and must be caught.
        ENDPOINT_LITERAL.lastIndex = 0;
        let match;
        while ((match = ENDPOINT_LITERAL.exec(line)) !== null) {
          const envVar = match[1];
          const classification = classifyModuleEndpointEnvVar(envVar, owningModule);
          if (!classification || isAllowed(allowlist, relativeFile, envVar, classification.module)) {
            continue;
          }
          issues.push({
            file: relativeFile,
            line: index + 1,
            envVar,
            module: classification.module,
            message:
              `${relativeFile}:${index + 1} reads ${envVar} — backend code must call the ` +
              `"${classification.module}" module in-process (MODULE_SPEC.md §4.2), not over its HTTP surface`,
          });
        }
      }
    }
  }
  // Second mode: backend code that speaks a sibling HTTP surface directly
  // (an outbound client plus a sibling API path, or a generated SDK client).
  for (const { crateDir, srcDir } of candidateCrateDirs(repoRoot)) {
    if (
      isClientCrate(crateDir) ||
      ROUTE_CRATE_PATTERN.test(path.basename(crateDir)) ||
      CLIENT_SIDE_CRATE_PATTERN.test(path.basename(crateDir))
    ) {
      continue;
    }
    const files = [];
    walkRustFiles(srcDir, files);
    for (const file of files) {
      const relativeFile = path.relative(repoRoot, file).replace(/\\/g, '/');
      if (relativeFile.includes('/tests/') || relativeFile.endsWith('/tests.rs')) {
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      const cfg = source.search(/#\[cfg\(test\)\]/);
      const body = cfg < 0 ? source : source.slice(0, cfg);
      if (!OUTBOUND_CLIENT.test(body)) {
        continue;
      }
      const surface = body.match(SIBLING_SURFACE_PATH);
      if (surface) {
        // The same allowlist contract as the env-var mode: a deliberate
        // exception is recorded in the repository's
        // `backend-module-call-boundary.allow.json`. Opt-in split-deployment
        // adapters live in an explicit `*_http_adapter` module and are
        // recorded file-scoped (no `envVar`) with a written reason.
        if (!isAllowed(allowlist, relativeFile, INLINE_SURFACE_ENV_VAR, 'sibling')) {
          issues.push({
            file: relativeFile,
            line: 1,
            envVar: INLINE_SURFACE_ENV_VAR,
            module: 'sibling',
            message:
              `${relativeFile}: builds an outbound HTTP client and names ${surface[0]} — ` +
              'backend code must call the sibling module in-process (MODULE_SPEC.md §4.2)',
          });
        }
        continue;
      }
      if (
        GENERATED_SDK_CLIENT.test(body) &&
        !isAllowed(allowlist, relativeFile, GENERATED_SDK_ENV_VAR, 'sibling')
      ) {
        issues.push({
          file: relativeFile,
          line: 1,
          envVar: GENERATED_SDK_ENV_VAR,
          module: 'sibling',
          message:
            `${relativeFile}: constructs or imports a sibling generated SDK client — ` +
            'backend code must call the sibling module in-process (MODULE_SPEC.md §4.2)',
        });
      }
    }
  }

  return issues;
}
