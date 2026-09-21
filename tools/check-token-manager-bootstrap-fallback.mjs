#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Regression guard for APP_SDK_INTEGRATION_SPEC §4 "Bootstrap Access-Token
// fallback is mandatory in every TokenManager that generated SDK transports
// read." and IAM_CREDENTIAL_ENTRY_SPEC §2/§5.
//
// Why this gate exists
// --------------------
// Generated SDK transports resolve `Access-Token` exclusively from
// `tokenManager.getAccessToken()` and throw
// `access-token-only request requires Access-Token before request dispatch`
// when it is empty. A session-scoped TokenManager adapter that layers session
// persistence over the login manager previously had no bootstrap fallback, so
// every protected surface threw before dispatch even when a valid private
// bootstrap artifact existed. The defect was invisible to unit tests that only
// exercised the post-login path, and it recurred because the same adapter is
// independently forked across several application roots.
//
// This gate asserts two rules:
//   1. Every `create*TokenManager` implementation that builds a session-scoped
//      manager resolves a bootstrap Access-Token fallback through the shared
//      IAM credential-entry workflow.
//   2. No application package forks its own `SDKWORK_ACCESS_TOKEN` reader
//      outside `@sdkwork/iam-credential-entry`.

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.tmp',
  'external',
  'third_party',
  'vendor',
  '.sdkwork',
  'pin-freeze',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts']);

/**
 * Rule 2 does not apply to the transport-side credential provider of the
 * web framework itself: `DevSessionTokenProvider` deliberately reads the
 * `define`-baked `process.env.SDKWORK_ACCESS_TOKEN` as an E2E convenience and is
 * paired with `RuntimeCredentialsTokenProvider` for production
 * (`SECURITY_SPEC.md` §1/§4: tokens MUST NOT be baked into production bundles).
 * It is a consumer, not a handoff fork.
 */
const RULE2_EXEMPT_PATH_SEGMENTS = [
  '/sdkwork-web-framework-pc/src/sdk/auth/',
];

/**
 * Scaffold-only app roots whose `src/bootstrap/` modules are stubs returning
 * `{}` with no importer anywhere in the root. They carry no credential
 * authority, so neither rule applies until the real runtime is wired. Each
 * exemption must name the file precisely and carry an in-file SCAFFOLD
 * PLACEHOLDER note; remove the entry once the runtime lands.
 */
const SCAFFOLD_EXEMPT_PATHS = [
  '/sdkwork-search-h5/src/bootstrap/tokenManager.ts',
];

/**
 * Tests legitimately construct TokenManager doubles and assert on the
 * dispatch-time throw, so they are exempt from both rules. They are not a
 * shipped surface and cannot regress the runtime fallback.
 */
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|mts)$|(^|\/)(__tests__|__mocks__|tests)\//u;

/** The canonical owner of bootstrap env parsing. */
const CANONICAL_BOOTSTRAP_OWNER = 'sdkwork-iam-credential-entry';

/**
 * Files that legitimately define the canonical bootstrap reader or the
 * bootstrap Vite handoff. Everything else must consume the shared package.
 */
const CANONICAL_BOOTSTRAP_READER_ALLOWLIST = [
  `/${CANONICAL_BOOTSTRAP_OWNER}/`,
  '/sdkwork-iam-application-bootstrap/',
];

/**
 * A session-scoped TokenManager factory is identified by producing a manager
 * whose `getAccessToken` resolves through session state. These markers catch
 * the known forked shape across application roots without pinning a single
 * function name.
 *
 * The negative lookahead excludes client-inventory factories such as
 * `createSdkworkXxxSdkClientsWithTokenManager` — those *consume* a TokenManager
 * parameter rather than producing one, so the bootstrap obligation belongs to
 * their caller.
 */
const SESSION_MANAGER_FACTORY_PATTERN =
  /export\s+function\s+create\w*TokenManager\s*\(/u;

/** A client inventory factory that takes a manager; not a manager definition. */
const CLIENT_INVENTORY_FACTORY_PATTERN =
  /export\s+function\s+create\w*SdkClientsWithTokenManager\s*\(/u;

/**
 * A generic TokenManager **container** takes the credential getter as a
 * parameter and owns no credential state:
 *
 *   export function createTokenManager(getAccessToken: () => string | undefined)
 *
 * It is not the credential authority — the caller that supplies the getter is.
 * Requiring the bootstrap reader here would forbid the canonical
 * `@sdkwork/sdk-common` container shape, so these are exempt from rule 1.
 * The obligation lands on the binding module that supplies the getter.
 */
const GENERIC_CONTAINER_FACTORY_PATTERN =
  /export\s+function\s+create\w*TokenManager\s*\(\s*\w+(?:\s*:\s*\([^)]*\)\s*=>\s*[^,)]+)?\s*[,)]/u;

/**
 * A manager that wraps `createTokenManager(...)` from `@sdkwork/sdk-common` and
 * hydrates it from session state is a **binding**. It must populate the
 * container from the bootstrap artifact when no session token exists
 * (`APP_SDK_INTEGRATION_SPEC.md` §4).
 */
const SDK_COMMON_CONTAINER_BINDING_PATTERN =
  /createTokenManager\s*\(\s*\)|createTokenManager\s*\(\s*tokens/iu;

/** Evidence that a binding hydrates its container, not just constructs it. */
const CONTAINER_HYDRATION_PATTERN = /\.setTokens\s*\(|setAccessToken\s*\(/u;

/** The fallback must come from the shared package, not a local env read. */
const SHARED_FALLBACK_IMPORT_PATTERN =
  /import\s*\{[^}]*readBootstrapAccessTokenFromProcessEnv[^}]*\}\s*from\s*['"]@sdkwork\/iam-credential-entry['"]/u;

/** How the fallback is actually applied inside the manager. */
const FALLBACK_APPLICATION_PATTERN =
  /readBootstrapAccessTokenFromProcessEnv\s*\(/u;

/** Forbidden: a package-local bootstrap env read. */
const LOCAL_ENV_READ_PATTERN =
  /process\?\.\s*env\s*[?.[\]]\s*['"]SDKWORK_ACCESS_TOKEN['"]|env\?\.\s*SDKWORK_ACCESS_TOKEN|process\.env\.SDKWORK_ACCESS_TOKEN/u;

/**
 * Reading `SDKWORK_ACCESS_TOKEN` is legitimate only when the value is handed to
 * the sanctioned credential-entry handoff — either the IAM Vite plugin or one
 * of the shared merge/read helpers (`mergeRepoBootstrapAccessTokenEnv` and its
 * `mergeRepoDevBootstrapAccessTokenEnv` convenience wrapper,
 * `readRepoBootstrapAccessToken`, `readBootstrapAccessTokenFromProcessEnv`).
 * Merely passing the value along is not a fork; parsing, serializing, or
 * injecting it locally is.
 */
const SANCTIONED_HANDOFF_PATTERN =
  /createSdkworkCredentialEntryBootstrapVitePlugin|mergeRepo(?:Dev)?BootstrapAccessTokenEnv|readBootstrapAccessTokenFromProcessEnv|readRepoBootstrapAccessToken/u;

/**
 * The shared `define`-key registry that the sanctioned mechanism itself
 * publishes (`SDKWORK_VITE_PRIVATE_ENV_DEFINE_KEYS` +
 * `buildSdkworkVitePrivateEnvDefine`). It *names* the define key rather than
 * injecting a credential, and `sdkwork-core` already pairs it with
 * `stripForbiddenCredentialEnvEntries`. It is the definition surface of the
 * sanctioned mechanism, not a fork of it.
 */
const PRIVATE_ENV_REGISTRY_PATTERN =
  /SDKWORK_VITE_PRIVATE_ENV_DEFINE_KEYS|buildSdkworkVitePrivateEnvDefine/u;

/**
 * Hand-rolled credential injection — a fork regardless of where the token came from.
 *
 * Two shapes count:
 *  1. The canonical credential global, assigned or read by hand. The sanctioned
 *     plugin owns that global; nothing else may name it.
 *  2. A local `transformIndexHtml` hook whose body actually handles a credential.
 *     This is deliberately scoped to the hook body rather than matching the hook
 *     by itself: `transformIndexHtml` is also the normal way to inject an
 *     unrelated `<script src="runtime-env.js">` tag (BROWSER_RUNTIME_ENV_SPEC),
 *     and flagging that would condemn a legitimate browser-runtime-env
 *     integration. Only a hook that touches a bootstrap/access token is a fork.
 */
const CREDENTIAL_GLOBAL_PATTERN = /__SDKWORK_CREDENTIAL_ENTRY_BOOTSTRAP_ACCESS_TOKEN__/u;
const TRANSFORM_INDEX_HTML_PATTERN = /transformIndexHtml\s*:/u;
const CREDENTIAL_VALUE_PATTERN = /SDKWORK_ACCESS_TOKEN|bootstrapAccessToken|bootstrap-access-token/u;

/**
 * Rule 3: the plugin's `environment` option must receive a LIFECYCLE name
 * (`development` / `test` / `staging` / `demo` / `production`), never Vite's raw
 * `mode`.
 *
 * Vite passes `mode` as whatever `--mode` said. `pnpm dev` omits the flag so
 * `mode === 'development'` happens to work, but every canonical **build** passes
 * `--mode <deploymentProfile>.<environment>` (see
 * `sdkwork-specs/tools/build-browser-client.mjs`, `viteMode = \`${deploymentProfile}.${environment}\``),
 * so `mode` is a profile id such as `standalone.development`. The plugin's gate
 * is `environment === 'development'`, which a profile id silently fails: the
 * plugin returns `undefined`, no bootstrap script is injected, and every
 * generated SDK transport throws
 * "access-token-only request requires Access-Token before request dispatch".
 *
 * The fix is always `resolveViteEnvironment(mode, process.env)` from
 * `sdkwork-specs/tools/vite-runtime-profile.mjs`, which normalizes the profile
 * id (and the `dev`/`prod` aliases) down to the lifecycle.
 */
const CREDENTIAL_PLUGIN_CALL_PATTERN = /createSdkworkCredentialEntryBootstrapVitePlugin\s*\(/u;
const RAW_MODE_ENVIRONMENT_PATTERN = /environment\s*:\s*mode\b/u;
const LIFECYCLE_NORMALIZATION_PATTERN = /resolveViteEnvironment\s*\(/u;

/**
 * Rule 4: no fabricated credential *values*.
 *
 * SECURITY_SPEC.md: "Login success ... `MUST NOT` be mocked or synthesized from
 * user/profile data ... SDKWork app/backend authenticated state requires a
 * validated appbase IAM session with non-empty `authToken` and `accessToken`;
 * incomplete or user-only results fail closed."
 *
 * A literal like `accessToken: "dev-access-token"` defeats that: it is not a
 * validated session, it is a fabricated one. When such a literal seeds a default
 * session object the login form pre-fills it and the app persists it to storage,
 * so an unauthenticated browser reports itself as logged in.
 *
 * Precision matters more than breadth here. The property name alone is far too
 * blunt: across this workspace the shape `accessToken: "<string>"`
 * legitimately carries
 *   - an HTTP header name      (`accessToken: "Access-Token"`),
 *   - a storage key            (`accessToken: "sdkwork.promotion.accessToken"`),
 *   - a `define` key           (`accessToken: "process.env.SDKWORK_ACCESS_TOKEN"`),
 *   - a doc placeholder        (`authToken: "YOUR_TOKEN"`),
 *   - a TS type annotation     (`accessToken: string`).
 * Flagging those would drown the real signal. So the rule requires the value to
 * *look like an actual token*: token-ish vocabulary (dev/mock/test/demo/fake/
 * sample + token/secret/jwt/bearer), and not an identifier-shaped dotted key,
 * not a header name, not a placeholder, not an env-var reference.
 */
const CREDENTIAL_PROPERTY_NAME = String.raw`\b(?:accessToken|authToken|access_token|auth_token)\s*[:=]\s*`;
const CREDENTIAL_LITERAL_VALUE = String.raw`(['"])([^'"\n]{1,80})\1`;
const HARDCODED_CREDENTIAL_LITERAL_PATTERN = new RegExp(
  `${CREDENTIAL_PROPERTY_NAME}${CREDENTIAL_LITERAL_VALUE}`,
  'gu',
);

/**
 * A value is a *fabricated credential* only when it is token-ish vocabulary that
 * is not one of the legitimate non-credential shapes listed above.
 */
const FABRICATED_CREDENTIAL_VALUE_PATTERN =
  /\b(?:dev|mock|fake|dummy|sample|example|test|stub|placeholder)[-_]?(?:access[-_]?|auth[-_]?)?(?:token|secret|jwt|bearer|credential)\b|\b(?:token|secret|jwt|bearer)\b.*\b(?:dev|mock|fake|dummy|sample|example|test)\b/iu;

/**
 * Values that look credential-ish but are not a fabricated credential.
 *
 * NOTE the ordering hazard this list encodes: an over-broad "bare identifier"
 * pattern such as `/^[A-Za-z-]+$/` also matches real credentials like
 * `dev-access-token`, silently whitelisting the exact thing the rule exists to
 * catch. Bare header names are therefore matched by their *known vocabulary*
 * rather than by character class.
 */
const HARDCODED_CREDENTIAL_LITERAL_ALLOWLIST = [
  /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9_-]*)+$/u, // dotted storage key
  /^(?:Access-Token|Authorization|Authentication|X-Access-Token|x-access-token)$/u, // HTTP header name
  /^(?:string|String|unknown|never|any|number|boolean)$/u, // type annotation
  /^process\.env\./u, // env reference, not a value
  /\$\{|\{\{|<[A-Za-z]|\[[A-Za-z]/u, // placeholder interpolation
  /^(?:YOUR|MY|REPLACE|INSERT|CHANGE|PUT|ADD)[-_]/u, // doc placeholder (YOUR_TOKEN)
];

/**
 * Rule 5: the bootstrap artifact location must be reachable by the sanctioned
 * reader.
 *
 * `IAM_CREDENTIAL_ENTRY_SPEC.md` §5 requires every application to resolve the
 * bootstrap token through the shared IAM workflow. Historically the artifact
 * *writers* (per-application dev runners) placed the file at the **app root**
 * while the shared *reader* searched the **repo root**, so a real artifact matched
 * no candidate path, the plugin resolved `undefined`, and the failure only
 * surfaced at the first authenticated request.
 *
 * The reader now accepts both spellings and the plugin walks ancestors, so the
 * invariant this rule protects is narrower and checkable: **when a bootstrap
 * artifact exists for an app, the sanctioned reader must be able to find it.**
 * A hand-written path outside those spellings is the drift this catches.
 */
const LOCAL_BOOTSTRAP_PATH_PATTERN =
  /['"][^'"]*\.env\.[^'"]*bootstrap\.local['"]/gu;

/**
 * True when the source hand-rolls credential injection. See the note above: the
 * `transformIndexHtml` arm requires a credential reference inside the hook's own
 * body so that an unrelated runtime-env script injection is not reported as a
 * fork. The body is delimited by brace matching rather than a fixed character
 * window, so a later helper that legitimately reads the token cannot leak in.
 */
function forksCredentialInjection(code) {
  if (CREDENTIAL_GLOBAL_PATTERN.test(code)) {
    return true;
  }
  const hook = TRANSFORM_INDEX_HTML_PATTERN.exec(code);
  if (!hook) {
    return false;
  }
  const body = readHookBody(code, hook.index);
  return CREDENTIAL_VALUE_PATTERN.test(body);
}

/** Slice the balanced-brace body that follows a `transformIndexHtml` property. */
function readHookBody(code, hookIndex) {
  const open = code.indexOf('{', hookIndex);
  if (open === -1) {
    return '';
  }
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return code.slice(open, i + 1);
      }
    }
  }
  return code.slice(open);
}

function* walkSourceFiles(rootDir) {
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
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        stack.push(absolute);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        yield absolute;
      }
    }
  }
}

function normalizeRelative(root, absolute) {
  return `/${path.relative(root, absolute).split(path.sep).join('/')}`;
}

/**
 * Strips comments before pattern matching so that explanatory prose — which
 * legitimately quotes the forbidden global key and the retired `define` handoff
 * to document why they are retired — cannot be mistaken for live code.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gu, '$1 ');
}

/**
 * Collects every `.ts`/`.tsx` source under the workspace root and validates the
 * two TokenManager rules. Returns a list of human-readable issue strings.
 */
export function validateTokenManagerBootstrapFallback(workspaceRoot, stats = {}) {
  const issues = [];
  let scannedFiles = 0;
  let sessionManagers = 0;
  let bootstrapConsumers = 0;
  let lifecycleMismatches = 0;
  let credentialLiterals = 0;

  for (const absolute of walkSourceFiles(workspaceRoot)) {
    const relative = normalizeRelative(workspaceRoot, absolute);
    let content;
    try {
      content = fs.readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    scannedFiles += 1;

    const code = stripComments(content);

    // Test doubles are exempt: they assert on the dispatch throw rather than
    // shipping the fallback. Unwired scaffold stubs are exempt too.
    if (TEST_FILE_PATTERN.test(relative)
      || SCAFFOLD_EXEMPT_PATHS.some((segment) => relative.endsWith(segment))) {
      continue;
    }

    const isCanonicalOwner = CANONICAL_BOOTSTRAP_READER_ALLOWLIST
      .some((segment) => relative.includes(segment));

    // Rule 1: session-scoped TokenManager factories must carry the fallback.
    // A generic container (getter passed in) is exempt — the binding module owns
    // the obligation instead. A client-inventory factory consumes a manager
    // rather than producing one, so it is exempt as well.
    if (SESSION_MANAGER_FACTORY_PATTERN.test(code)
      && !CLIENT_INVENTORY_FACTORY_PATTERN.test(code)
      && !GENERIC_CONTAINER_FACTORY_PATTERN.test(code)) {
      if (!isCanonicalOwner) {
        sessionManagers += 1;
        const hasSharedImport = SHARED_FALLBACK_IMPORT_PATTERN.test(code);
        const appliesFallback = FALLBACK_APPLICATION_PATTERN.test(code);
        const bindsSdkCommonContainer = SDK_COMMON_CONTAINER_BINDING_PATTERN.test(code)
          && CONTAINER_HYDRATION_PATTERN.test(code);
        if (!hasSharedImport && !bindsSdkCommonContainer) {
          issues.push(
            `${relative}: TokenManager factory does not import `
            + `readBootstrapAccessTokenFromProcessEnv from '@sdkwork/iam-credential-entry'. `
            + 'A session-scoped TokenManager must resolve the private bootstrap Access-Token '
            + 'artifact (APP_SDK_INTEGRATION_SPEC §4), otherwise every generated SDK transport '
            + 'throws "access-token-only request requires Access-Token before request dispatch" '
            + 'before a login session exists.',
          );
        } else if (hasSharedImport && !appliesFallback) {
          issues.push(
            `${relative}: imports the shared bootstrap reader but never calls it in `
            + 'getAccessToken(). The import alone does not restore the fallback.',
          );
        }
      }
    }

    // Rule 2: no package-local bootstrap env parsing outside the owner.
    // Reading the value to hand it to the sanctioned plugin is not a fork;
    // parsing it locally or injecting it with hand-rolled HTML/global
    // serialization is.
    const isRule2Exempt = RULE2_EXEMPT_PATH_SEGMENTS
      .some((segment) => relative.includes(segment));
    if (!isCanonicalOwner && !isRule2Exempt && LOCAL_ENV_READ_PATTERN.test(code)) {
      bootstrapConsumers += 1;
      const usesSanctionedHandoff = SANCTIONED_HANDOFF_PATTERN.test(code)
        || PRIVATE_ENV_REGISTRY_PATTERN.test(code);
      const forksInjection = forksCredentialInjection(code);
      if (!usesSanctionedHandoff || forksInjection) {
        issues.push(
          `${relative}: resolves SDKWORK_ACCESS_TOKEN without the sanctioned credential-entry `
          + 'handoff. Use `createSdkworkCredentialEntryBootstrapVitePlugin` from '
          + '@sdkwork/iam-credential-entry/vite (or the shared merge helper) instead of local '
          + 'parsing or hand-rolled global/HTML injection (IAM_CREDENTIAL_ENTRY_SPEC §2/§5, '
          + 'APP_SDK_INTEGRATION_SPEC §4).',
        );
      }
    }

    // Rule 3: the credential plugin's `environment` option must be a lifecycle
    // name, not Vite's raw `mode`. See RAW_MODE_ENVIRONMENT_PATTERN.
    if (CREDENTIAL_PLUGIN_CALL_PATTERN.test(code)
      && RAW_MODE_ENVIRONMENT_PATTERN.test(code)
      && !LIFECYCLE_NORMALIZATION_PATTERN.test(code)) {
      lifecycleMismatches += 1;
      issues.push(
        `${relative}: passes Vite's raw \`mode\` as the credential-entry plugin's \`environment\`. `
        + '`mode` is a deployment profile id (`standalone.development`, `cloud.development`), '
        + 'not a lifecycle name, so the plugin\'s `environment === \'development\'` gate fails and '
        + 'no bootstrap Access-Token is injected (IAM_CREDENTIAL_ENTRY_SPEC §4/§5). '
        + 'Use `resolveViteEnvironment(mode, process.env)` from '
        + 'sdkwork-specs/tools/vite-runtime-profile.mjs.',
      );
    }

    // Rule 4: no fabricated credential literals. Comments are stripped first so
    // that documentation quoting the forbidden shape is not reported as code.
    // Two-stage: find `credentialProp: "<literal>"`, then require the value to be
    // token-ish AND not one of the legitimate non-credential shapes.
    const codeOnly = stripComments(content);
    for (const match of codeOnly.matchAll(HARDCODED_CREDENTIAL_LITERAL_PATTERN)) {
      const literal = match[2];
      if (HARDCODED_CREDENTIAL_LITERAL_ALLOWLIST.some((allowed) => allowed.test(literal))) {
        continue;
      }
      if (!FABRICATED_CREDENTIAL_VALUE_PATTERN.test(literal)) {
        continue;
      }
      credentialLiterals += 1;
      issues.push(
        `${relative}: hard-codes a fabricated credential value (\`${match[0].trim()}\`). `
        + 'A literal is not a validated session — SECURITY_SPEC.md requires SDKWork '
        + 'authenticated state to come from a validated appbase IAM session with '
        + 'non-empty authToken and accessToken, and forbids synthesizing login '
        + 'success. Default these fields to an empty string; let the login form (or '
        + 'the private bootstrap artifact) supply the real value.',
      );
      break;
    }
  }

  stats.scannedFiles = (stats.scannedFiles ?? 0) + scannedFiles;
  stats.sessionManagers = (stats.sessionManagers ?? 0) + sessionManagers;
  stats.bootstrapConsumers = (stats.bootstrapConsumers ?? 0) + bootstrapConsumers;
  stats.lifecycleMismatches = (stats.lifecycleMismatches ?? 0) + lifecycleMismatches;
  stats.credentialLiterals = (stats.credentialLiterals ?? 0) + credentialLiterals;
  return issues;
}

function usage() {
  return [
    'Usage: node check-token-manager-bootstrap-fallback.mjs [options]',
    '',
    'Options:',
    '  --workspace <dir>  Scan a multi-repository workspace root (default: specs parent)',
    '  --root <dir>       Scan a single repository root',
    '  --list             Print every violation as `<path>\\t<rule>` and exit 0 (triage mode)',
    '  --help             Show this message',
  ].join('\n');
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      root: { type: 'string' },
      list: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const targetRoot = path.resolve(values.workspace ?? values.root ?? path.dirname(SPECS_ROOT));
  if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
    console.error(`token manager bootstrap fallback check cannot run: not a directory: ${targetRoot}`);
    process.exit(2);
  }

  const stats = {};
  const issues = validateTokenManagerBootstrapFallback(targetRoot, stats);

  if (values.list) {
    for (const issue of issues) {
      const separator = issue.indexOf(': ');
      const file = separator === -1 ? issue : issue.slice(0, separator);
      const rule = issue.includes('TokenManager factory') ? 'rule1-token-manager'
        : issue.includes('sanctioned credential-entry') ? 'rule2-env-fork'
          : issue.includes("raw `mode`") ? 'rule3-raw-mode-as-environment'
            : issue.includes('fabricated credential value') ? 'rule4-fabricated-credential'
              : 'other';
      console.log(`${file}\t${rule}`);
    }
    console.error(
      `triaged ${issues.length} violation(s) across ${stats.scannedFiles} file(s) `
      + `(${stats.sessionManagers} session token manager(s))`,
    );
    process.exit(0);
  }

  if (issues.length > 0) {
    console.error('token manager bootstrap fallback check failed: violations found');
    for (const issue of issues.slice(0, 200)) {
      console.error(`- ${issue}`);
    }
    if (issues.length > 200) {
      console.error(`- ... and ${issues.length - 200} more`);
    }
    process.exit(1);
  }

  // "passed" over zero files is a fail-open gate, not a green one.
  if ((stats.scannedFiles ?? 0) === 0) {
    console.error('token manager bootstrap fallback check cannot run: scanned 0 files');
    process.exit(2);
  }

  console.log(
    `token manager bootstrap fallback check passed `
    + `(${stats.scannedFiles} file(s) scanned, ${stats.sessionManagers} session token manager(s))`,
  );
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main();
}
