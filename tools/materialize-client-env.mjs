#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  baseUrlsMaterializationValue,
  resolveBaseUrl as resolveAppBaseUrl,
} from './app-base-url.mjs';
import {
  createApplicationAccessToken,
  PUBLIC_APP_ACCESS_TOKEN_KEY,
  resolveApplicationAccessTokenAppId,
  resolveApplicationAccessTokenScope,
  resolveApplicationAccessTokenEnvName,
  surfaceApplicationTokenEnvName,
} from './app-access-token.mjs';

export const CLIENT_ENV_DEPLOYMENT_PROFILES = ['standalone', 'cloud'];
export const CLIENT_ENVIRONMENTS = ['development', 'test', 'staging', 'demo', 'production'];
export const CLIENT_ENV_PROFILE_IDS = CLIENT_ENV_DEPLOYMENT_PROFILES.flatMap(
  (deploymentProfile) => CLIENT_ENVIRONMENTS.map(
    (environment) => `${deploymentProfile}.${environment}`,
  ),
);

const SECRET_KEY_PATTERN = /(?:ACCESS|AUTH|REFRESH|INGRESS|UPLOAD|API)_TOKEN(?:_|$)|PASSWORD|SECRET|PRIVATE_KEY|DATABASE_URL|REDIS_URL|CREDENTIAL/u;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const DEFAULT_CONFIG_PATH = 'etc/client-env.materialization.json';
const REWRITABLE_URL_VALUE_PATTERN = /^(?:https?|wss?):\/\//iu;

function parseUrlHost(value) {
  try {
    return new URL(String(value ?? '').trim()).host;
  } catch {
    return '';
  }
}

export function parseClientEnvArgs(argv) {
  const options = {
    root: process.cwd(),
    config: DEFAULT_CONFIG_PATH,
    check: false,
    environments: [],
    surfaces: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check') {
      options.check = true;
      continue;
    }
    if (token === '--environment' || token === '--surface') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }
      const key = token === '--environment' ? 'environments' : 'surfaces';
      options[key].push(
        ...value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0),
      );
      index += 1;
      continue;
    }
    if (token === '--root' || token === '--config') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }
      options[token.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported client env materialization option: ${token}`);
  }
  return options;
}

const CLIENT_ENVIRONMENT_ALIASES = new Map([
  ['dev', 'development'],
  ['local', 'development'],
  ['development', 'development'],
  ['test', 'test'],
  ['staging', 'staging'],
  ['demo', 'demo'],
  ['prod', 'production'],
  ['production', 'production'],
]);

/**
 * Restrict a profile-id list to the requested lifecycles.
 *
 * A client profile id is `<deployment-profile>.<environment>`; selecting one
 * lifecycle keeps both of its deployment profiles and drops every other
 * environment. The registrar uses this so registering `development` cannot bake
 * the development anchor into the profile files of another environment — every
 * environment is a separate deployment with its own deploy application anchor.
 * @param profileIds - declared or canonical profile ids
 * @param environments - requested lifecycles (aliases accepted)
 * @returns the profile ids whose environment was requested
 * @throws when a requested value is not a lifecycle
 */
export function filterClientEnvProfileIds(profileIds, environments = []) {
  if (!Array.isArray(environments) || environments.length === 0) {
    return [...profileIds];
  }
  const wanted = new Set();
  for (const raw of environments) {
    const normalized = CLIENT_ENVIRONMENT_ALIASES.get(String(raw ?? '').trim().toLowerCase());
    if (!normalized) {
      throw new Error(
        `--environment ${JSON.stringify(String(raw ?? ''))} is not a lifecycle `
        + `(expected one of ${CLIENT_ENVIRONMENTS.join(', ')})`,
      );
    }
    wanted.add(normalized);
  }
  return profileIds.filter((profileId) => wanted.has(profileId.slice(profileId.indexOf('.') + 1)));
}

function ensureInsideRoot(rootDir, candidatePath, label) {
  const relativePath = path.relative(rootDir, candidatePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside ${rootDir}.`);
  }
  return candidatePath;
}

function surfaceIdOf(surface) {
  return String(surface?.id ?? '').trim();
}

/**
 * The declared anchor variable of one surface, plus its surface-scoped form.
 *
 * Every shipped surface registers as its own deploy application
 * (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §5), so one repository may hold one
 * anchor per surface. The declaration keeps naming the base variable; the
 * per-surface record and the materializer use `<base>_<SURFACE>` for a surface
 * that has its own deployment anchor.
 * @param surface - declared client surface.
 * @returns the base and surface-scoped variable names (`''` when not env-sourced)
 */
export function surfaceAnchorEnvNames(surface) {
  const base = resolveApplicationAccessTokenEnvName(surface?.accessToken);
  if (!base) {
    return { baseEnvName: '', surfaceEnvName: '' };
  }
  return {
    baseEnvName: base,
    surfaceEnvName: surfaceApplicationTokenEnvName(base, surfaceIdOf(surface)),
  };
}

/**
 * Fail when two declared surfaces would read the same anchor variable.
 *
 * Two surfaces sharing one anchor variable cannot carry independent deployment
 * anchors, and a filtered run would silently use the other surface's value. The
 * collision is a declaration defect, so it is refused instead of guessed.
 * @param surfaces - declared client surfaces
 */
function assertDistinctSurfaceAnchorEnvNames(surfaces) {
  const byEnvName = new Map();
  for (const surface of surfaces) {
    const id = surfaceIdOf(surface);
    const { surfaceEnvName } = surfaceAnchorEnvNames(surface);
    if (!surfaceEnvName) {
      continue;
    }
    const bucket = byEnvName.get(surfaceEnvName) ?? [];
    bucket.push(id || '(surface without id)');
    byEnvName.set(surfaceEnvName, bucket);
  }
  for (const [envName, ids] of byEnvName) {
    if (ids.length > 1) {
      throw new Error(
        `${envName} would be the anchor variable of ${ids.join(' and ')}; surface ids must derive `
        + 'distinct anchor variables so each surface can carry its own deployment anchor',
      );
    }
  }
}

/**
 * Restrict the declared client surfaces to the requested surface ids.
 *
 * A selected surface keeps its declaration order, and the surface anchor
 * variables are validated across the whole declaration (not only the selection),
 * because a filtered run is exactly where a shared variable would silently pick
 * up another surface's anchor.
 * @param surfaces - declared client surfaces
 * @param surfaceIds - requested surface ids (empty means every surface)
 * @returns the selected surfaces, in declaration order
 * @throws when a requested id is not declared or two surfaces share an anchor variable
 */
export function filterClientEnvSurfaces(surfaces, surfaceIds = []) {
  const declared = Array.isArray(surfaces) ? surfaces : [];
  if (!Array.isArray(surfaceIds) || surfaceIds.length === 0) {
    return [...declared];
  }
  const wanted = [...new Set(surfaceIds.map((value) => String(value ?? '').trim()).filter(Boolean))];
  const known = new Set(declared.map(surfaceIdOf));
  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `--surface ${unknown.join(', ')} is not declared in etc/client-env.materialization.json; `
      + `declared surface(s): ${[...known].join(', ')}`,
    );
  }
  assertDistinctSurfaceAnchorEnvNames(declared);
  const selected = wanted.filter((id) => known.has(id));
  return declared.filter((surface) => selected.includes(surfaceIdOf(surface)));
}

/**
 * Environment one surface resolves its deployment anchor from.
 *
 * Precedence, highest first:
 *   1. the per-surface anchor variable in the process environment
 *      (`<base>_<SURFACE>`) — the registrar passes it when it materializes one
 *      surface, and a deployment may inject it;
 *   2. the same variable in the resolved deployment profile, which is where the
 *      registration records the surface's anchor
 *      (`etc/topology/<profile>.<environment>.env`);
 *   3. the declared base variable (`SDKWORK_DEPLOY_APPLICATION_ID`), the
 *      one-anchor-per-repository behavior every existing profile relies on.
 *
 * Only a surface whose `accessToken` is environment-sourced takes part; a literal
 * `appId` surface is repository-owned and reads nothing.
 * @param surface - declared client surface
 * @param env - process environment bag
 * @param sourceValues - resolved deployment profile values
 * @returns the environment bag with the resolved anchor under the base name
 */
export function surfaceAnchorEnvironment(surface, env = process.env, sourceValues = {}) {
  const { baseEnvName, surfaceEnvName } = surfaceAnchorEnvNames(surface);
  if (!surfaceEnvName) {
    return env;
  }
  const explicit = String(env?.[surfaceEnvName] ?? '').trim();
  const recorded = String(sourceValues?.[surfaceEnvName] ?? '').trim();
  const value = explicit || recorded;
  if (!value) {
    return env;
  }
  let projected;
  try {
    projected = { ...env };
  } catch {
    projected = {};
  }
  projected[baseEnvName] = value;
  return projected;
}

/**
 * Resolve one surface's public token `app_id` from its deployment anchor.
 * @param surface - declared client surface
 * @param env - process environment bag
 * @param sourceValues - resolved deployment profile values
 * @returns the app id
 * @throws {MissingAppIdEnvironmentError} when the anchor is absent everywhere
 */
export function resolveSurfaceAccessTokenAppId(surface, env = process.env, sourceValues = {}) {
  const spec = surface?.accessToken;
  if (!spec || typeof spec !== 'object') {
    throw new Error(
      `${surfaceIdOf(surface) || 'surface'} must declare accessToken.appIdEnv (a deployment anchor `
      + 'env var) or accessToken.appId.',
    );
  }
  const { appId } = resolveApplicationAccessTokenAppId(
    spec,
    surfaceAnchorEnvironment(surface, env, sourceValues),
  );
  return appId;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

export function parseClientEnvDotenv(source) {
  const values = {};
  for (const rawLine of String(source ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid dotenv line: ${rawLine}`);
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function assertSupportedProfileId(profileId) {
  if (!CLIENT_ENV_PROFILE_IDS.includes(profileId)) {
    throw new Error(`Unsupported client env profile id: ${profileId}.`);
  }
  const [deploymentProfile, environment] = profileId.split('.');
  return { deploymentProfile, environment, profileId };
}

function firstValue(sourceValues, sources) {
  for (const source of sources) {
    const value = String(sourceValues[source] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizeBinding(binding) {
  if (typeof binding === 'string') {
    return { sources: [binding], required: true };
  }
  if (Array.isArray(binding)) {
    return { sources: binding, required: true };
  }
  return {
    sources: Array.isArray(binding?.sources) ? binding.sources : [],
    required: binding?.required !== false,
  };
}

function assertSafeClientKey(key) {
  if (key === PUBLIC_APP_ACCESS_TOKEN_KEY) {
    return;
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    throw new Error(`Client env output must not contain secret-bearing key ${key}.`);
  }
}

function assertCloudClientUrls(values, profile) {
  if (profile.deploymentProfile !== 'cloud') {
    return;
  }
  const development = profile.environment === 'development';
  for (const [key, value] of Object.entries(values)) {
    if (!/(?:_URL|_HTTP_URL|_BASE_URL)$/u.test(key) || !value) {
      continue;
    }
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${profile.profileId} ${key} must be an absolute public URL.`);
    }
    if (LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new Error(`${profile.profileId} ${key} must use a remote public host.`);
    }
    if (!development && !['https:', 'wss:'].includes(parsed.protocol)) {
      throw new Error(`${profile.profileId} ${key} must use an explicit remote HTTPS/WSS URL.`);
    }
    if (development && !['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
      throw new Error(`${profile.profileId} ${key} must use an HTTP(S)/WS(S) URL.`);
    }
  }
}

/**
 * Vite dotenv surfaces are shared by `vite build --mode <profile>` and
 * `vite dev`. They MUST carry only the deployed domain edges (ENVIRONMENT_SPEC
 * §5.1.0.1, APP_RUNTIME_TOPOLOGY_SPEC §3):
 *   - gateway/SDK/API base URL keys -> the primary cloud `api-*` edge
 *     (scheme-matched: plain-HTTP development edge -> `http://`, TLS
 *     environments -> `https://`), single origin;
 *   - realtime WebSocket keys -> the same api-* edge with `ws:`/`wss:`;
 *   - application public HTTP keys -> the application web ingress edge
 *     without any dev port;
 *   - no local gateway override (`SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL`)
 *     and no dev-process port (`:3801`/`:3900`) may leak into the surface.
 * `pnpm dev` binds local ports through dev-process env injection instead
 * (the `sdkwork-app dev` command derives renderer env from the topology
 * profile; vite gives process env precedence over .env files), so the shared
 * dotenv surface stays deploy-safe for every environment.
 *
 * The ';'-joined multi-origin cloud API materialization is a build/deploy
 * runtime document concern (ENVIRONMENT_SPEC §5.1.0.1) and is not parseable by
 * URL-consuming dev surfaces; dotenv values fold to the primary registered
 * origin.
 */
export function applyViteSurfaceCloudValues(values, sourceValues, profile, { repositoryRoot, deployment, origins } = {}) {
  if (profile.deploymentProfile !== 'cloud') {
    return values;
  }
  const primaryEdge = origins
    ? String(origins[0] ?? '').trim()
    : resolveAppBaseUrl({
        deploymentProfile: 'cloud',
        environment: profile.environment,
        phase: 'build',
        surface: 'transport',
        repositoryRoot,
        deployment,
      }).primaryBaseUrl;
  if (!primaryEdge) {
    throw new Error(`${profile.profileId} has no registered cloud API origin for dotenv normalization.`);
  }
  const development = profile.environment === 'development';
  const apiEdge = development ? primaryEdge.replace(/^https:/u, 'http:') : primaryEdge;
  const wsEdge = development ? apiEdge.replace(/^http:/u, 'ws:') : primaryEdge.replace(/^https:/u, 'wss:');
  const gatewayAttachedKey = /(?:PLATFORM_API_GATEWAY_HTTP_URL|_API_BASE_URL|_SDK_BASE_URL)$/u;
  const applicationPublicKey = /(?:^|_)APPLICATION_PUBLIC_HTTP_URL$/u;
  const websocketKey = /WEBSOCKET_URL$/u;
  const projected = {};
  for (const [key, rawValue] of Object.entries(values)) {
    // The local gateway override is a dev-process concern; it never appears in
    // the shared dotenv build surface (SDK_SPEC §5.1, PNPM_SCRIPT_SPEC §3).
    if (/(?:^|_)LOCAL_PLATFORM_API_GATEWAY_HTTP_URL$/u.test(key)) {
      continue;
    }
    let raw = String(rawValue ?? '').trim();
    if (raw.includes(';')) {
      // Fold stale multi-origin lists to the primary registered origin first:
      // URL-consuming dev surfaces cannot parse ';'-joined origin lists.
      raw = raw.split(';')[0]?.trim() ?? '';
    }
    if (websocketKey.test(key) && REWRITABLE_URL_VALUE_PATTERN.test(raw)) {
      projected[key] = wsEdge;
      continue;
    }
    if (gatewayAttachedKey.test(key) && REWRITABLE_URL_VALUE_PATTERN.test(raw)) {
      projected[key] = apiEdge;
      continue;
    }
    if (applicationPublicKey.test(key) && REWRITABLE_URL_VALUE_PATTERN.test(raw)) {
      // Application public HTTP keys carry no dev port: the :3801 web dev
      // ingress binding is a dev-process concern (SDKWORK_IM_WEB_DEV_INGRESS_BIND).
      try {
        const parsedUrl = new URL(raw);
        parsedUrl.port = '';
        projected[key] = parsedUrl.toString().replace(/\/+$/u, '');
      } catch {
        projected[key] = raw;
      }
      continue;
    }
    projected[key] = raw;
  }
  return projected;
}

/**
 * The registered cloud build family materialization for one profile, derived
 * through the canonical lifecycle-matrix resolver (APP_RUNTIME_ENV_SPEC.md
 * §4, tools/app-base-url.mjs `resolveBaseUrl`) — the single decision entry
 * point; do not re-derive the family inline.
 */
function cloudBuildMaterializationValue(profile, deploymentIndex, repositoryRoot) {
  return baseUrlsMaterializationValue(resolveAppBaseUrl({
    deploymentProfile: 'cloud',
    environment: profile.environment,
    phase: 'build',
    surface: 'transport',
    repositoryRoot,
    deployment: deploymentIndex,
  }));
}

function applyCloudGatewayProjection(values, deploymentIndex, profile, repositoryRoot, sourceValues = {}) {
  if (profile.deploymentProfile !== 'cloud') {
    return values;
  }
  // APP_RUNTIME_TOPOLOGY_SPEC section 4.2: dev:cloud binds local for every
  // surface, including non-vite JSON runtime env (flutter, mini-program).
  // The registered domain families stay available for builds through
  // cloudApiBaseUrls and the deployment index, not through dev runtime keys.
  const localGatewayUrl = String(sourceValues.SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL ?? values.SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL ?? '').trim();
  if (profile.environment === 'development' && REWRITABLE_URL_VALUE_PATTERN.test(localGatewayUrl)) {
    const projected = { ...values };
    for (const key of Object.keys(projected)) {
      if (!shouldExpandCloudGatewayKey(key)) {
        continue;
      }
      const value = String(projected[key] ?? '').trim();
      if (!REWRITABLE_URL_VALUE_PATTERN.test(value)) {
        continue;
      }
      const primaryOrigin = value.includes(';') ? value.split(';')[0].trim() : value;
      let parsed;
      try {
        parsed = new URL(primaryOrigin);
      } catch {
        continue;
      }
      const localParsed = new URL(localGatewayUrl);
      const scheme = /^wss?:\/\//iu.test(value) ? (localGatewayUrl.startsWith('https') ? 'wss' : 'ws') : localParsed.protocol.replace(':', '');
      projected[key] = `${scheme}://${localParsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
    }
    return projected;
  }
  const materialized = cloudBuildMaterializationValue(profile, deploymentIndex, repositoryRoot);
  const projected = { ...values };
  for (const key of Object.keys(projected)) {
    if (!shouldExpandCloudGatewayKey(key)) {
      continue;
    }
    const value = String(projected[key] ?? '').trim();
    if (!/^https?:\/\//u.test(value)) {
      continue;
    }
    projected[key] = materialized;
  }
  return projected;
}

function shouldExpandCloudGatewayKey(key) {
  if (/(?:APPLICATION_PUBLIC|H5_APPLICATION_PUBLIC|OPEN_API|WEBSOCKET)/u.test(key)) {
    return false;
  }
  if (/PLATFORM_API_GATEWAY/u.test(key)) {
    return true;
  }
  return /(?:_APP_API_BASE_URL|_API_BASE_URL|_SDK_BASE_URL)$/u.test(key);
}

function expandCloudGatewayUrls(sourceValues, deploymentIndex, profile, repositoryRoot) {
  if (profile.deploymentProfile !== 'cloud') {
    return sourceValues;
  }
  const materialized = cloudBuildMaterializationValue(profile, deploymentIndex, repositoryRoot);
  const expanded = { ...sourceValues };
  for (const [key, value] of Object.entries(expanded)) {
    if (!shouldExpandCloudGatewayKey(key)) {
      continue;
    }
    if (typeof value !== 'string' || !/^https?:\/\//u.test(value.trim())) {
      continue;
    }
    expanded[key] = materialized;
  }
  return expanded;
}

function identityValues(surface, profile) {
  const basePrefix = surface.format === 'vite' ? 'VITE_SDKWORK' : 'SDKWORK';
  const values = {
    [`${basePrefix}_ENVIRONMENT`]: profile.environment,
    [`${basePrefix}_DEPLOYMENT_PROFILE`]: profile.deploymentProfile,
    [`${basePrefix}_PROFILE_ID`]: profile.profileId,
    [`${basePrefix}_RUNTIME_TARGET`]: surface.runtimeTarget,
  };
  const suffixes = Array.isArray(surface.identitySuffixes)
    ? new Set(surface.identitySuffixes.map((suffix) => String(suffix).trim().toUpperCase()))
    : null;
  const emit = (suffix) => suffixes === null || suffixes.has(suffix);
  for (const prefix of surface.identityPrefixes ?? []) {
    if (emit('ENVIRONMENT')) values[`${prefix}_ENVIRONMENT`] = profile.environment;
    if (emit('DEPLOYMENT_PROFILE')) values[`${prefix}_DEPLOYMENT_PROFILE`] = profile.deploymentProfile;
    if (emit('PROFILE_ID')) values[`${prefix}_PROFILE_ID`] = profile.profileId;
    if (emit('RUNTIME_TARGET')) values[`${prefix}_RUNTIME_TARGET`] = surface.runtimeTarget;
  }
  return values;
}

/**
 * Build one surface's public application access token for a profile.
 *
 * The deployment anchor resolves the app id, and the release scope resolves the
 * `ownership_scope` claim (process environment
 * `SDKWORK_APPLICATION_OWNERSHIP_SCOPE`, then `accessToken.ownershipScope`, then
 * `TENANT`). A `USER` surface additionally requires its owner user id
 * (`SDKWORK_APPLICATION_OWNER_USER_ID` or `accessToken.ownerUserId`), so a
 * personal installation never emits a token IAM would reject for carrying no
 * user (`APP_ACCESS_TOKEN_SPEC.md` §3.2.1,
 * `APPLICATION_IDENTITY_SPEC.md` §4.1).
 * @param surface - declared client surface
 * @param profile - deployment profile and environment
 * @param env - process environment bag
 * @param sourceValues - resolved deployment profile values, for the anchor
 * @returns the JWT compact serialization
 */
function createSurfaceApplicationAccessToken(surface, profile, env, sourceValues) {
  const spec = surface.accessToken;
  const { appId } = resolveApplicationAccessTokenAppId(
    spec,
    surfaceAnchorEnvironment(surface, env, sourceValues),
  );
  const { ownershipScope, userId } = resolveApplicationAccessTokenScope(spec, env);
  return createApplicationAccessToken({
    appId,
    tenantId: String(spec.tenantId ?? '100001').trim(),
    organizationId: String(spec.organizationId ?? '0').trim(),
    accessScope: spec.scope,
    environment: profile.environment,
    deploymentProfile: profile.deploymentProfile,
    runtimeTarget: surface.runtimeTarget,
    permissionScope: spec.permissionScope,
    ownershipScope,
    userId,
  });
}

function applicationAccessTokenValues(surface, profile, env = process.env, sourceValues = {}) {
  const spec = surface.accessToken;
  if (!spec || typeof spec !== 'object') {
    return {};
  }
  // `appIdEnv` reads the deployment anchor from the environment; a missing
  // variable fails generation here and names it. Never fall back to a
  // compiled-in app id (`APP_ACCESS_TOKEN_SPEC.md` §3.1.1). A surface that owns
  // its own deployment anchor records it under the surface-scoped variable, so
  // `surfaceAnchorEnvironment` resolves that one first.
  return {
    [PUBLIC_APP_ACCESS_TOKEN_KEY]: createSurfaceApplicationAccessToken(
      surface,
      profile,
      env,
      sourceValues,
    ),
  };
}

export function createClientSurfaceValues({ surface, sourceValues, profile, env = process.env }) {
  const values = {};
  for (const prefix of surface.includePrefixes ?? []) {
    for (const [key, value] of Object.entries(sourceValues)) {
      if (key.startsWith(prefix)) {
        assertSafeClientKey(key);
        values[key] = value;
      }
    }
  }
  for (const key of surface.includeKeys ?? []) {
    assertSafeClientKey(key);
    const value = String(sourceValues[key] ?? '').trim();
    if (value) {
      values[key] = value;
    }
  }
  for (const [targetKey, rawBinding] of Object.entries(surface.bindings ?? {})) {
    assertSafeClientKey(targetKey);
    const binding = normalizeBinding(rawBinding);
    const value = firstValue(sourceValues, binding.sources);
    if (!value && binding.required) {
      throw new Error(
        `${profile.profileId} is missing ${targetKey}; expected one of ${binding.sources.join(', ')}.`,
      );
    }
    if (value) {
      values[targetKey] = value;
    }
  }
  for (const [key, value] of Object.entries(surface.constants ?? {})) {
    assertSafeClientKey(key);
    values[key] = String(value);
  }
  Object.assign(values, identityValues(surface, profile));
  Object.assign(values, applicationAccessTokenValues(surface, profile, env, sourceValues));

  const expectedNamespace = surface.format === 'vite' ? 'VITE_' : 'SDKWORK_';
  for (const key of Object.keys(values)) {
    if (key === PUBLIC_APP_ACCESS_TOKEN_KEY) {
      continue;
    }
    if (!key.startsWith(expectedNamespace)) {
      throw new Error(`${surface.id} output key ${key} must use ${expectedNamespace}.`);
    }
  }
  for (const requiredKey of surface.requiredOutputKeys ?? []) {
    if (!String(values[requiredKey] ?? '').trim()) {
      throw new Error(`${profile.profileId} ${surface.id} requires ${requiredKey}.`);
    }
  }
  assertCloudClientUrls(values, profile);
  return values;
}

function readOptionalDotenvLayer(filePath, label) {
  if (!existsSync(filePath)) {
    return null;
  }
  const contents = readFileSync(filePath, 'utf8');
  const values = parseClientEnvDotenv(contents);
  const seen = new Set();
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (seen.has(key)) {
      throw new Error(`${label} declares ${key} more than once.`);
    }
    seen.add(key);
  }
  return values;
}

/**
 * Optional application env overlay (`ENVIRONMENT_SPEC.md` §5.1.7.1):
 *   apps/<app>/etc/env.base.env
 *   apps/<app>/etc/env.<profile-id>.env
 * Later file wins. Values are merged after the repository topology and surface
 * bindings, so an application can override a shared default for its own surface.
 */
function readApplicationEnvOverlay(rootDir, surface, profileId) {
  const etcDir = path.join(rootDir, surface.root, 'etc');
  const base = readOptionalDotenvLayer(
    path.join(etcDir, 'env.base.env'),
    `${surface.id} etc/env.base.env`,
  );
  const profile = readOptionalDotenvLayer(
    path.join(etcDir, `env.${profileId}.env`),
    `${surface.id} etc/env.${profileId}.env`,
  );
  if (!base && !profile) {
    return {};
  }
  const merged = { ...(base ?? {}), ...(profile ?? {}) };
  for (const key of Object.keys(merged)) {
    if (key === PUBLIC_APP_ACCESS_TOKEN_KEY) {
      throw new Error(
        `${surface.id} etc env overlay must not define ${PUBLIC_APP_ACCESS_TOKEN_KEY}; the token is generated per application and profile.`,
      );
    }
    assertSafeClientKey(key);
    const expectedPrefix = surface.format === 'vite' ? 'VITE_' : 'SDKWORK_';
    if (!key.startsWith(expectedPrefix)) {
      throw new Error(`${surface.id} etc env overlay key ${key} must use ${expectedPrefix}.`);
    }
  }
  return merged;
}

function resolveSurfaceOutputPath(rootDir, surface, profileId) {
  const appRoot = ensureInsideRoot(
    rootDir,
    path.resolve(rootDir, surface.root),
    `${surface.id} root`,
  );
  if (surface.format === 'vite') {
    return path.join(appRoot, `.env.${profileId}`);
  }
  if (surface.format === 'flutter') {
    return path.join(appRoot, 'env', `sdkwork.${profileId}.json`);
  }
  if (surface.format === 'mini-program') {
    return path.join(appRoot, 'config', 'mini-program', `runtime-env.${profileId}.json`);
  }
  if (surface.format === 'harmony-native') {
    return path.join(appRoot, 'config', 'app', `runtime-env.${profileId}.json`);
  }
  throw new Error(`${surface.id} uses unsupported materialization format ${surface.format}.`);
}

function serializeDotenvValue(value) {
  const text = String(value ?? '');
  if (text.length === 0 || /[\s#'"]/u.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function serializeDotenv({ values, sourcePath, rootDir, profileId, command }) {
  const source = path.relative(rootDir, sourcePath).replaceAll('\\', '/');
  const lines = [
    `# Generated from ${source} (${profileId}).`,
    `# Regenerate with: ${command}`,
  ];
  for (const [key, value] of Object.entries(values).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${key}=${serializeDotenvValue(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

function serializeJson(values) {
  return `${JSON.stringify(
    Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))),
    null,
    2,
  )}\n`;
}

function loadMaterializationConfig(rootDir, configPath) {
  const absolutePath = ensureInsideRoot(
    rootDir,
    path.resolve(rootDir, configPath),
    'Client env materialization config',
  );
  const config = readJson(absolutePath);
  if (config.schemaVersion !== 1 || config.kind !== 'sdkwork.client-env-materialization') {
    throw new Error(`${configPath} must be an sdkwork.client-env-materialization v1 document.`);
  }
  if (!Array.isArray(config.surfaces) || config.surfaces.length === 0) {
    throw new Error(`${configPath} must declare at least one client surface.`);
  }
  return { absolutePath, config };
}

function loadSourceProfile({ rootDir, etcDir, deploymentIndex, config, profileId }) {
  const entry = deploymentIndex.profiles?.[profileId];
  const configuredPath = String(entry?.config ?? '').trim();
  if (!configuredPath) {
    throw new Error(`Deployment profile ${profileId} is not declared.`);
  }
  const sourcePath = ensureInsideRoot(
    etcDir,
    path.resolve(etcDir, configuredPath),
    `Deployment profile ${profileId}`,
  );
  if (!existsSync(sourcePath)) {
    throw new Error(`Deployment profile file is missing: ${path.relative(rootDir, sourcePath)}.`);
  }
  const values = parseClientEnvDotenv(readFileSync(sourcePath, 'utf8'));
  const profile = assertSupportedProfileId(profileId);
  const identity = config.sourceIdentity;
  const declaredDeploymentProfile = firstValue(values, identity.deploymentProfileKeys);
  const declaredEnvironment = firstValue(values, identity.environmentKeys);
  const declaredProfileId = firstValue(values, identity.profileIdKeys);
  if (declaredDeploymentProfile !== profile.deploymentProfile) {
    throw new Error(`${profileId} declares inconsistent deploymentProfile=${declaredDeploymentProfile}.`);
  }
  if (declaredEnvironment !== profile.environment) {
    throw new Error(`${profileId} declares inconsistent environment=${declaredEnvironment}.`);
  }
  if (declaredProfileId !== profileId) {
    throw new Error(`${profileId} declares inconsistent profileId=${declaredProfileId}.`);
  }
  return { profile, sourcePath, values };
}

export function materializeClientEnv({
  rootDir = process.cwd(),
  configPath = DEFAULT_CONFIG_PATH,
  check = false,
  environments = [],
  surfaces = [],
  env = process.env,
} = {}) {
  const normalizedRoot = path.resolve(rootDir);
  const { config } = loadMaterializationConfig(normalizedRoot, configPath);
  const etcDir = path.join(normalizedRoot, 'etc');
  const deploymentConfigPath = path.join(
    etcDir,
    config.deploymentConfig ?? 'sdkwork.deployment.config.json',
  );
  const deploymentIndex = readJson(deploymentConfigPath);
  const profileIds = filterClientEnvProfileIds(
    config.profiles ?? CLIENT_ENV_PROFILE_IDS,
    environments,
  );
  if (profileIds.length === 0) {
    throw new Error(
      `no client profile matches --environment ${environments.join(',')}; `
      + `the repository declares ${(config.profiles ?? CLIENT_ENV_PROFILE_IDS).join(', ')}`,
    );
  }
  // A surface filter writes only the selected surfaces' profile files, so a
  // registration that anchors each surface separately cannot bake one surface's
  // anchor into another surface's carrier. No filter keeps the full matrix.
  const selectedSurfaces = filterClientEnvSurfaces(config.surfaces, surfaces);
  if (selectedSurfaces.length === 0) {
    throw new Error(
      `no client surface matches --surface ${surfaces.join(',')}; the repository declares `
      + `${config.surfaces.map((surface) => surfaceIdOf(surface)).join(', ')}`,
    );
  }
  const results = [];

  for (const profileId of profileIds) {
    const sourceProfile = loadSourceProfile({
      rootDir: normalizedRoot,
      etcDir,
      deploymentIndex,
      config,
      profileId,
    });
    const sourceValues = expandCloudGatewayUrls(
      sourceProfile.values,
      deploymentIndex,
      sourceProfile.profile,
      normalizedRoot,
    );
    for (const surface of selectedSurfaces) {
      // Server-only repositories declare a "none" surface: they keep the
      // profile vocabulary validated by loadSourceProfile but materialize no
      // client artifacts.
      if (surface.format === 'none') {
        continue;
      }
      if (Array.isArray(surface.excludeProfiles) && surface.excludeProfiles.includes(profileId)) {
        continue;
      }
      const outputPath = resolveSurfaceOutputPath(normalizedRoot, surface, profileId);
      if (surface.format === 'harmony-native') {
        // Harmony runtime config is a nested, hand-authored template. Preserve
        // its shape and inject only the profile identity and public token.
        if (!existsSync(outputPath)) {
          throw new Error(`${surface.id} runtime template is missing: ${path.relative(normalizedRoot, outputPath)}.`);
        }
        const existing = readJson(outputPath);
        const spec = surface.accessToken;
        if (!spec || typeof spec !== 'object') {
          throw new Error(
            `${surface.id} must declare accessToken.appIdEnv (a deployment anchor env var) or accessToken.appId.`,
          );
        }
        existing.environment = sourceProfile.profile.environment;
        existing.deploymentProfile = sourceProfile.profile.deploymentProfile;
        existing.profileId = profileId;
        existing.runtimeTarget = surface.runtimeTarget;
        existing[PUBLIC_APP_ACCESS_TOKEN_KEY] = createSurfaceApplicationAccessToken(
          surface,
          sourceProfile.profile,
          env,
          sourceProfile.values,
        );
        const content = `${JSON.stringify(existing, null, 2)}\n`;
        if (check) {
          const actual = readFileSync(outputPath, 'utf8');
          if (actual !== content) {
            throw new Error(
              `${path.relative(normalizedRoot, outputPath)} is missing or stale. Run ${config.command ?? 'the client env materializer'}.`,
            );
          }
        } else {
          writeFileSync(outputPath, content, 'utf8');
        }
        results.push(outputPath);
        continue;
      }
      // Vite dotenv surfaces consume raw single-origin topology values plus the
      // cloud dev-local gateway override; non-vite (build runtime document)
      // surfaces keep the full ';'-joined cloud API origin materialization.
      const isViteSurface = surface.format === 'vite';
      const surfaceSourceValues = isViteSurface
        ? sourceProfile.values
        : expandCloudGatewayUrls(sourceValues, deploymentIndex, sourceProfile.profile, normalizedRoot);
      const surfaceValues = createClientSurfaceValues({
        surface,
        sourceValues: surfaceSourceValues,
        profile: sourceProfile.profile,
        env,
      });
      const values = isViteSurface
        ? applyViteSurfaceCloudValues(surfaceValues, sourceProfile.values, sourceProfile.profile, {
            repositoryRoot: normalizedRoot,
            deployment: deploymentIndex,
          })
        : applyCloudGatewayProjection(
            surfaceValues,
            deploymentIndex,
            sourceProfile.profile,
            normalizedRoot,
            sourceProfile.values,
          );
      // The application overlay is the highest-precedence source; apply it after
      // topology projection so an app-specific value can replace a derived one.
      Object.assign(values, readApplicationEnvOverlay(normalizedRoot, surface, profileId));
      if (isViteSurface) {
        assertCloudClientUrls(values, sourceProfile.profile);
      }
      const content = surface.format === 'vite'
        ? serializeDotenv({
            values,
            sourcePath: sourceProfile.sourcePath,
            rootDir: normalizedRoot,
            profileId,
            command: config.command ?? 'pnpm workflow:materialize-client-env',
          })
        : serializeJson(values);
      if (check) {
        const actual = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
        if (actual !== content) {
          throw new Error(
            `${path.relative(normalizedRoot, outputPath)} is missing or stale. Run ${config.command ?? 'the client env materializer'}.`,
          );
        }
      } else {
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, content, 'utf8');
      }
      results.push(outputPath);
    }
  }
  return results;
}

function runCli() {
  const options = parseClientEnvArgs(process.argv.slice(2));
  const files = materializeClientEnv({
    rootDir: options.root,
    configPath: options.config,
    check: options.check,
    environments: options.environments,
    surfaces: options.surfaces,
  });
  const scope = [
    options.environments.length > 0 ? `environments: ${options.environments.join(', ')}` : '',
    options.surfaces.length > 0 ? `surfaces: ${options.surfaces.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  console.log(
    `SDKWork client env profiles ${options.check ? 'verified' : 'materialized'}: `
    + `${files.length} files${scope ? ` (${scope})` : ''}.`,
  );
}

const entryPath = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1] ?? '') === entryPath) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
