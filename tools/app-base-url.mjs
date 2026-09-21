/**
 * Canonical application SDK base-URL resolution for build/dev tooling.
 * Authority: ENVIRONMENT_SPEC.md §5.1.4.0 / §6.2.1 (Base-URL Lifecycle Matrix),
 * APP_RUNTIME_ENV_SPEC.md (all application surfaces), BROWSER_RUNTIME_ENV_SPEC.md
 * (browser document shape).
 *
 * This module is the SINGLE node-side implementation of the lifecycle matrix:
 *
 *   |              | dev (pnpm dev / dev:standalone / dev:cloud)        | build (per-environment artifact)                     |
 *   |--------------|----------------------------------------------------|------------------------------------------------------|
 *   | standalone   | same-origin relative `/` (page origin is the API   | same-origin with the serving application edge        |
 *   |              | origin ip+port; the dev ingress fans canonical API | (page `https://im-dev.sdkwork.com`, SDK base `/`;    |
 *   |              | paths server-side to the module standalone gateway)| transport surfaces use `https://im-dev.sdkwork.com`) |
 *   | cloud        | browser documents stay same-origin relative `/`    | cross-origin unified `api-<suffix>.<base-domain>`    |
 *   |              | (server-side fan-out); transport surfaces use the  | family (`https://api-dev.sdkwork.com;...`), primary  |
 *   |              | local `sdkwork-api-cloud-gateway` ip+port          | origin first, full family materialized               |
 *
 * Two surface styles exist because one matrix serves every application family:
 * - `browser-document`: the shape a web surface materializes into its runtime
 *   document / Vite bag (BROWSER_RUNTIME_ENV_SPEC.md §1-§3).
 * - `transport`: the absolute origin a surface WITHOUT a same-origin proxy
 *   must call — desktop renderers, Flutter, mini-program runtimes, and the
 *   dev-server proxy upstream itself.
 *
 * The browser/runtime counterpart of this matrix is `resolveBaseUrl` in
 * `@sdkwork/sdk-common` (ENVIRONMENT_SPEC.md §6.3). Application repositories
 * consume this module through the workspace-relative path
 * `../../sdkwork-specs/tools/app-base-url.mjs`; do not fork the matrix into
 * per-app helpers.
 */

import {
  cloudApiOriginFromHost,
  cloudSdkBaseUrlMaterializationValue,
  normalizeCloudApiOriginList,
  resolveCloudApiOriginForHost,
  resolveCloudApiOriginListForRepository,
} from './browser-cloud-api-base.mjs';

/** Deployment profiles of the lifecycle matrix. */
export const APP_DEPLOYMENT_PROFILES = Object.freeze(['standalone', 'cloud']);

/** Lifecycle environments of the lifecycle matrix (includes `demo`). */
export const APP_LIFECYCLE_ENVIRONMENTS = Object.freeze([
  'development',
  'test',
  'staging',
  'demo',
  'production',
]);

/** Tooling phases: dev runners versus built artifacts. */
export const APP_BASE_URL_PHASES = Object.freeze(['dev', 'build']);

/** Surface styles the matrix resolves for (see module doc). */
export const APP_BASE_URL_SURFACES = Object.freeze(['browser-document', 'transport']);

/** Dev-process env key binding the locally started `sdkwork-api-cloud-gateway`. */
export const LOCAL_PLATFORM_API_GATEWAY_HTTP_URL_ENV_KEY =
  'SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL';

/**
 * Same-origin SDK base used by every standalone browser document and every
 * dev browser document (both profiles): the page origin fronts the API.
 */
export const APP_SAME_ORIGIN_BASE = '/';

function normalizeText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function assertProfile(deploymentProfile, environment) {
  if (!APP_DEPLOYMENT_PROFILES.includes(deploymentProfile)) {
    throw new Error(
      `deploymentProfile must be one of ${APP_DEPLOYMENT_PROFILES.join(', ')}, got ${JSON.stringify(deploymentProfile)}`,
    );
  }
  if (!APP_LIFECYCLE_ENVIRONMENTS.includes(environment)) {
    throw new Error(
      `environment must be one of ${APP_LIFECYCLE_ENVIRONMENTS.join(', ')}, got ${JSON.stringify(environment)}`,
    );
  }
}

function assertPhase(phase) {
  if (!APP_BASE_URL_PHASES.includes(phase)) {
    throw new Error(`phase must be one of ${APP_BASE_URL_PHASES.join(', ')}, got ${JSON.stringify(phase)}`);
  }
}

function assertSurface(surface) {
  if (!APP_BASE_URL_SURFACES.includes(surface)) {
    throw new Error(
      `surface must be one of ${APP_BASE_URL_SURFACES.join(', ')}, got ${JSON.stringify(surface)}`,
    );
  }
}

function parseHttpOrigin(value, label, { allowPort = true } = {}) {
  const raw = normalizeText(value);
  if (!raw) {
    return undefined;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) origin, got ${JSON.stringify(raw)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must be an absolute HTTP(S) origin, got ${JSON.stringify(raw)}`);
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an origin without path, query, or hash`);
  }
  if (!allowPort && parsed.port) {
    throw new Error(`${label} must be a domain origin without a port, got ${JSON.stringify(raw)}`);
  }
  return parsed.origin;
}

/**
 * Split a multi-origin base-url configuration value (`;`/`,`-joined) into its
 * entries. Accepts a raw string or an already-split array.
 */
export function splitBaseUrls(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? '').trim()).filter((entry) => entry.length > 0);
  }
  return normalizeCloudApiOriginListJoinAware(value);
}

function normalizeCloudApiOriginListJoinAware(value) {
  const raw = String(value ?? '');
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/[,;]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Serialize base URL entries into the canonical `;`-joined multi-origin
 * materialization value (single entry collapses to the bare origin).
 */
export function serializeBaseUrls(entries) {
  const list = splitBaseUrls(entries);
  if (list.length <= 1) {
    return list[0] ?? '';
  }
  return list.join(';');
}

/**
 * Auto-adapting multi-domain selection: given a candidate base-url list and
 * the page/API host a surface runs on, pick the matching origin.
 *
 * - `standalone`: the page host IS the API origin (same-origin); the resolved
 *   URL is the page origin itself and candidates are ignored.
 * - `cloud`: exact environment gateway match first, then same base-domain
 *   match, then derivation of `api-<suffix>.<base-domain>` from the page host
 *   (`im-dev.sdkwork.com` -> `https://api-dev.sdkwork.com`), then the first
 *   candidate (delegates to `resolveCloudApiOriginForHost`).
 *
 * Mini-program/desktop runtimes without a location must pass their declared
 * host through `pageHost` (ENVIRONMENT_SPEC.md §6.3); a missing page host in
 * cloud mode falls back to the first candidate.
 */
export function selectBaseUrlForPageHost(baseUrls, {
  pageHost,
  environment = 'production',
  deploymentProfile = 'cloud',
} = {}) {
  assertProfile(deploymentProfile, environment);
  if (deploymentProfile === 'standalone') {
    const host = normalizeText(pageHost);
    return {
      originMode: 'same-origin',
      url: host ? cloudApiOriginFromHost(host, environment) : '',
      reason: host ? 'standalone-page-origin' : 'standalone-empty-host',
    };
  }
  return {
    originMode: 'cross-origin',
    url: resolveCloudApiOriginForHost(splitBaseUrls(baseUrls), pageHost, environment),
    reason: 'cloud-gateway-host-match',
  };
}

function cloudBuildBaseUrls(options) {
  const explicit = options.cloudApiBaseUrls;
  if (explicit !== undefined && normalizeText(explicit)) {
    const entries = Array.isArray(explicit) ? explicit : splitBaseUrls(explicit);
    if (entries.length === 0) {
      throw new Error('cloudApiBaseUrls must declare at least one absolute HTTP(S) origin');
    }
    return entries;
  }
  if (options.repositoryRoot) {
    return resolveCloudApiOriginListForRepository({
      repositoryRoot: options.repositoryRoot,
      environment: options.environment,
      deployment: options.deployment,
      topology: options.topology,
      preferTopology: true,
    });
  }
  throw new Error(
    'cloud build requires either cloudApiBaseUrls or repositoryRoot (to derive the registered api-<suffix> family)',
  );
}

/**
 * Resolve the SDK base URL contract for one point of the lifecycle matrix.
 *
 * @param {object} options
 * @param {'standalone'|'cloud'} options.deploymentProfile deployment profile.
 * @param {string} options.environment lifecycle environment (development/test/staging/demo/production).
 * @param {'dev'|'build'} options.phase dev runner versus built artifact.
 * @param {'browser-document'|'transport'} [options.surface] defaults to `browser-document`.
 * @param {string} [options.localPlatformApiGatewayHttpUrl] cloud dev transport
 *   origin of the locally started `sdkwork-api-cloud-gateway` (ip+port).
 *   Fails closed when a cloud dev transport surface omits it.
 * @param {string} [options.applicationPublicHttpUrl] standalone transport
 *   origin of the serving application edge (`https://im-dev.sdkwork.com`).
 *   Fails closed when a standalone transport surface omits it.
 * @param {string|readonly string[]} [options.cloudApiBaseUrls] explicit cloud
 *   build candidate family (`;`/`,`-joined or array). Derived from the
 *   repository deployment/topology when omitted and `repositoryRoot` is given.
 * @param {string} [options.repositoryRoot] repository root for cloud build
 *   family derivation through the registered topology/deployment config.
 * @param {object} [options.deployment] parsed deployment config (skips re-read).
 * @param {object} [options.topology] parsed topology spec (skips re-read).
 * @returns {object} resolution with `primaryBaseUrl`, `baseUrls`,
 *   `browserOriginMode`, `sameOrigin`, and the selection `reason`.
 */
export function resolveBaseUrl(options = {}) {
  const deploymentProfile = options.deploymentProfile;
  const environment = options.environment;
  const phase = options.phase ?? 'build';
  const surface = options.surface ?? 'browser-document';
  assertProfile(deploymentProfile, environment);
  assertPhase(phase);
  assertSurface(surface);

  const profileId = `${deploymentProfile}.${environment}`;
  const base = {
    profileId,
    deploymentProfile,
    environment,
    phase,
    surface,
  };

  if (deploymentProfile === 'standalone') {
    if (surface === 'browser-document') {
      // Browser documents never hardcode the serving domain: relative `/` IS
      // the same-origin contract and resolves against whichever registered
      // edge (dev ingress ip+port or per-environment domain) serves the page.
      return Object.freeze({
        ...base,
        browserOriginMode: 'same-origin',
        sameOrigin: true,
        primaryBaseUrl: APP_SAME_ORIGIN_BASE,
        baseUrls: [APP_SAME_ORIGIN_BASE],
        reason: phase === 'dev' ? 'standalone-dev-same-origin' : 'standalone-build-same-origin',
      });
    }
    // Dev pages are ip+port (the dev ingress); built artifacts are domains
    // without ports (the serving application edge terminates TLS).
    const pageOrigin = parseHttpOrigin(
      options.applicationPublicHttpUrl,
      `standalone ${profileId} transport requires applicationPublicHttpUrl`,
      { allowPort: phase === 'dev' },
    );
    if (!pageOrigin) {
      throw new Error(
        `standalone ${profileId} transport requires applicationPublicHttpUrl (the serving application edge)`,
      );
    }
    if (phase !== 'dev' && pageOrigin.startsWith('http://')) {
      throw new Error(
        `standalone ${profileId} transport must use an HTTPS application edge domain, got ${pageOrigin}`,
      );
    }
    return Object.freeze({
      ...base,
      browserOriginMode: 'same-origin',
      sameOrigin: true,
      primaryBaseUrl: pageOrigin,
      baseUrls: [pageOrigin],
      reason: phase === 'dev' ? 'standalone-dev-page-origin' : 'standalone-build-page-origin',
    });
  }

  if (phase === 'dev') {
    if (surface === 'browser-document') {
      // Same document shape as standalone dev (BROWSER_RUNTIME_ENV_SPEC §1):
      // the dev ingress fronts every gateway-attached surface and fans
      // canonical API paths server-side to the local cloud gateway.
      return Object.freeze({
        ...base,
        browserOriginMode: 'same-origin',
        sameOrigin: true,
        primaryBaseUrl: APP_SAME_ORIGIN_BASE,
        baseUrls: [APP_SAME_ORIGIN_BASE],
        reason: 'cloud-dev-same-origin-document',
      });
    }
    const gatewayOrigin = parseHttpOrigin(
      options.localPlatformApiGatewayHttpUrl,
      `cloud ${profileId} transport requires localPlatformApiGatewayHttpUrl`,
    );
    if (!gatewayOrigin) {
      throw new Error(
        `cloud ${profileId} transport requires localPlatformApiGatewayHttpUrl (${LOCAL_PLATFORM_API_GATEWAY_HTTP_URL_ENV_KEY}); `
        + 'domain edges are never contacted from a cloud dev surface',
      );
    }
    return Object.freeze({
      ...base,
      browserOriginMode: 'cross-origin',
      sameOrigin: false,
      primaryBaseUrl: gatewayOrigin,
      baseUrls: [gatewayOrigin],
      reason: 'cloud-dev-local-gateway',
    });
  }

  const family = cloudBuildBaseUrls({ ...options, environment });
  const primary = family[0];
  const materialized = family.length === 1 ? primary : serializeBaseUrls(family);
  return Object.freeze({
    ...base,
    browserOriginMode: 'cross-origin',
    sameOrigin: false,
    primaryBaseUrl: primary,
    baseUrls: Object.freeze([...family]),
    materialized,
    // A single registered edge materializes as a bare origin; a multi-domain
    // family keeps the full `;`-joined list in runtime documents (§5.1.0.1).
    primaryBaseUrlMaterialized: materialized,
    reason: 'cloud-build-domain-family',
  });
}

/**
 * Materialization value for one runtime-document key given a resolution:
 * standalone browser documents pin `/`; cloud documents carry the `;`-joined
 * family in BOTH surfaces (browser-document and transport — mini-program /
 * Flutter / desktop runtimes keep the full candidate list so shared resolvers
 * can auto-select the page's same-brand gateway, §5.1.0.1); standalone
 * transport surfaces carry the page origin.
 */
export function baseUrlsMaterializationValue(resolution) {
  if (resolution.sameOrigin && resolution.surface === 'browser-document') {
    return APP_SAME_ORIGIN_BASE;
  }
  if (!resolution.sameOrigin && resolution.baseUrls.length > 1) {
    return resolution.materialized ?? serializeBaseUrls(resolution.baseUrls);
  }
  return resolution.primaryBaseUrl;
}

/**
 * Convenience: the cloud dev transport origin declared by a topology profile
 * env bag, or `undefined` when the profile does not override it.
 */
export function readLocalPlatformApiGatewayHttpUrl(env = {}) {
  return normalizeText(env[LOCAL_PLATFORM_API_GATEWAY_HTTP_URL_ENV_KEY]);
}

/**
 * Convenience: fold a candidate topology env application-edge value to its
 * registered primary origin (multi-origin lists keep their first entry).
 */
export function primaryOriginFromEnvValue(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return undefined;
  }
  const first = raw.split(/[,;]/u)[0]?.trim();
  return first || undefined;
}

/** Materialization helper retained for cloud build document writers. */
export { cloudSdkBaseUrlMaterializationValue };
