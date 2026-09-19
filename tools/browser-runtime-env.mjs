/**
 * Canonical browser runtime-env helpers (BROWSER_RUNTIME_ENV_SPEC.md).
 *
 * Every SDKWork browser surface serves ONE dev runtime document that pins the
 * same-origin API contract, and publishes it to the `SDKWORK_RUNTIME_ENV`
 * global so shared SDK packages (`@sdkwork/sdk-common` base-url derivation,
 * deployment-mode detection) can read runtime values inside the browser.
 *
 * Applications own their surface-specific key vocabulary (e.g. the app's
 * `VITE_*_SDK_BASE_URL` names); this module owns the cross-app invariants:
 *
 * - dev documents use same-origin RELATIVE API bases (the deployment profile
 *   changes only the server-side fan-out target, never the document shape);
 * - process-only topology bindings (per-surface `_HTTP_URL` bindings and
 *   platform gateway binds) never enter a browser document;
 * - loopback absolutes are rejected unconditionally: the dev ingress fronts
 *   every router-owned surface;
 * - federated sibling edges keep their declared remote origins (explicit
 *   absolute candidates win over derivation).
 *
 * Consumed through the workspace-relative path
 * `../../sdkwork-specs/tools/browser-runtime-env.mjs` (or the specs self-root
 * `tools/browser-runtime-env.mjs`); do not fork copies into application
 * repositories.
 */

/** Global under which browser surfaces publish their runtime document. */
export const BROWSER_RUNTIME_ENV_GLOBAL_KEY = 'SDKWORK_RUNTIME_ENV';

/** Canonical SDKWork API prefixes for same-origin dev documents. */
export const BROWSER_SAME_ORIGIN_API_BASES = Object.freeze({
  appApi: '/app/v3/api',
  backendApi: '/backend/v3/api',
  openApi: '/v1',
});

/**
 * Process-only topology URL bindings. They route dev-server proxies and name
 * deployment identity; a browser must never see them (they would invite
 * direct loopback / remote-edge access that bypasses the dev ingress).
 */
export const BROWSER_PROCESS_ONLY_URL_KEY_PATTERN =
  /(?:^|VITE_)SDKWORK_[A-Z0-9_]+_(?:APPLICATION_(?:PUBLIC|OPEN|BACKEND)_HTTP_URL|PLATFORM_API_GATEWAY_HTTP_URL)$/u;

function normalizeText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') {
    return true;
  }
  const octets = normalized.split('.');
  return octets.length === 4
    && octets.every((octet) => /^\d+$/u.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
    && Number(octets[0]) === 127;
}

/** True for absolute http(s)/ws(s) URLs pointed at a loopback host. */
export function isLoopbackAbsoluteUrl(value) {
  if (!value?.startsWith('http://') && !value?.startsWith('https://') && !value?.startsWith('ws://') && !value?.startsWith('wss://')) {
    return false;
  }
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * Build the canonical dev runtime document for a `<deploymentProfile>.<environment>`
 * profile id. Profile identity is derived from the profile id unless
 * overridden; the deployment profile changes only the server-side fan-out
 * target, never the browser-visible shape.
 */
export function buildBrowserDevRuntimeEnvDocument({
  profileId,
  deploymentProfile,
  environment,
  sameOriginBases = BROWSER_SAME_ORIGIN_API_BASES,
} = {}) {
  const normalizedProfileId = normalizeText(profileId) ?? 'standalone.development';
  const [derivedProfile = 'standalone', derivedEnvironment = 'development'] = normalizedProfileId.split('.');
  return Object.freeze({
    environment: normalizeText(environment) ?? derivedEnvironment,
    deploymentProfile: normalizeText(deploymentProfile) ?? derivedProfile,
    profileId: normalizedProfileId,
    browserOriginMode: 'same-origin',
    appApiBaseUrl: sameOriginBases.appApi,
    backendApiBaseUrl: sameOriginBases.backendApi,
    openApiBaseUrl: sameOriginBases.openApi,
  });
}

/**
 * Force canonical same-origin SDK base entries onto a dev document/bag.
 * Dev dotenv files are shared with `vite build` and legitimately carry
 * deploy-time domain values, so the dev contract must OVERRIDE them, not
 * merely fill gaps.
 *
 * @param {Record<string, string>} runtimeEnv document/bag to update (mutated).
 * @param {Array<[string, string]>} baseEntries `[key, sameOriginValue]` pairs.
 */
export function authorSameOriginSdkBaseUrls(runtimeEnv = {}, baseEntries = []) {
  const authored = { ...runtimeEnv };
  for (const [key, value] of baseEntries) {
    authored[key] = value;
  }
  return authored;
}

/**
 * Reusable alignment gate for every dev runtime document a browser surface
 * serves. Generic invariants (enforced always):
 * - `browserOriginMode` is `same-origin` when present;
 * - process-only topology keys never appear;
 * - no loopback absolute origin appears.
 *
 * Canonical same-origin bases are enforced per SURFACE via
 * `options.sameOriginBaseEntries` (`[key, expectedValue]` pairs using JSON
 * field names or app-specific Vite key names) — dependency surfaces (feeds,
 * drive, models, ...) own their own canonical prefixes, so a generic suffix
 * match would misjudge them. `options.requireSameOriginBases` (default true)
 * additionally enforces the three JSON field names for JSON-shaped documents.
 */
export function assertBrowserDevRuntimeEnvDocument(document, {
  profileId,
  sameOriginBaseEntries = [],
  requireSameOriginBases = true,
} = {}) {
  const failures = [];
  const reject = (message) => failures.push(message);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('browser dev runtime-env document must be a plain object');
  }
  if (document.browserOriginMode !== undefined && document.browserOriginMode !== 'same-origin') {
    reject(`browserOriginMode must be "same-origin", got ${JSON.stringify(document.browserOriginMode)}`);
  }
  for (const [key, value] of Object.entries(document)) {
    if (typeof value !== 'string') {
      continue;
    }
    if (BROWSER_PROCESS_ONLY_URL_KEY_PATTERN.test(key)) {
      reject(`process-only topology key ${key} must never enter a browser document`);
    }
    if (isLoopbackAbsoluteUrl(value) || value.startsWith('//')) {
      reject(`${key} must never target a loopback origin from the browser document, got ${JSON.stringify(value)}`);
    }
  }
  const baseEntries = [...sameOriginBaseEntries];
  if (requireSameOriginBases) {
    baseEntries.push(
      ['appApiBaseUrl', BROWSER_SAME_ORIGIN_API_BASES.appApi],
      ['backendApiBaseUrl', BROWSER_SAME_ORIGIN_API_BASES.backendApi],
      ['openApiBaseUrl', BROWSER_SAME_ORIGIN_API_BASES.openApi],
    );
  }
  for (const [key, expected] of baseEntries) {
    if (document[key] !== expected) {
      reject(`${key} must be ${JSON.stringify(expected)}, got ${JSON.stringify(document[key])}`);
    }
  }
  if (profileId !== undefined && document.profileId !== undefined && document.profileId !== profileId) {
    reject(`profileId must be ${JSON.stringify(profileId)}, got ${JSON.stringify(document.profileId)}`);
  }
  if (failures.length > 0) {
    throw new Error(`browser dev runtime-env contract violated:\n  - ${failures.join('\n  - ')}`);
  }
  return document;
}

/**
 * Bridge a dev document into the `SDKWORK_RUNTIME_ENV` global so shared SDK
 * packages can read runtime values inside the browser (deployment-mode
 * detection, base-url derivation). Adds the deployment-profile aliases the
 * shared resolvers inspect, in both plain and Vite-prefixed forms.
 */
export function buildBrowserRuntimeEnvGlobalBridge(document, { deploymentProfile } = {}) {
  const bridge = {
    ...document,
  };
  const mode = normalizeText(deploymentProfile)
    ?? normalizeText(document?.deploymentProfile)
    ?? normalizeText(document?.VITE_SDKWORK_DEPLOYMENT_PROFILE);
  if (mode) {
    bridge.SDKWORK_DEPLOYMENT_PROFILE = mode;
    bridge.SDKWORK_DEPLOY_MODE = mode;
    bridge.VITE_SDKWORK_DEPLOYMENT_PROFILE = mode;
    bridge.VITE_SDKWORK_DEPLOY_MODE = mode;
  }
  return Object.freeze(bridge);
}

/**
 * JavaScript statement assigning the bridge to the canonical global, for
 * `/runtime-env.js` bags and inline bootstrap snippets.
 */
export function buildBrowserRuntimeEnvGlobalScript(bridge) {
  const serialized = JSON.stringify(bridge)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `globalThis.${BROWSER_RUNTIME_ENV_GLOBAL_KEY} = Object.freeze(${serialized});\n`;
}
