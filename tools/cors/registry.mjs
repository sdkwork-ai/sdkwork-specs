// Public CORS origin derivation authority (CORS_SPEC.md section 4).
//
// The registered product base-domain family, the lifecycle environment suffixes
// and the role-label expansion all live in `webserver/host-registry.mjs`. This
// module derives the CORS allowlist of a topology profile from that registry so
// no repository has to hand-enumerate console hosts: adding a base domain, an
// environment or a console role label is a registry edit, then
// `align-cors-standard.mjs` re-materialises every carrier.

import {
  DEFAULT_PRODUCT_BASE_DOMAINS,
  LIFECYCLE_ENVIRONMENTS,
  auxiliarySurfaceRoleHost,
  environmentSuffix,
  isRegisteredBaseDomain,
  normalizeHost,
  registeredRoleHost,
  roleLabelForSurface,
} from '../webserver/host-registry.mjs';
import { hostsForSurface, surfaceSupportsHttpWebserver } from '../webserver/build-from-topology.mjs';

export { LIFECYCLE_ENVIRONMENTS, DEFAULT_PRODUCT_BASE_DOMAINS };

/** Shared allowlist key every lifecycle profile projects exact origins into. */
export const CORS_SHARED_ORIGINS_ENV_KEY = 'SDKWORK_CORS_ALLOWED_ORIGINS';

/** Gateway sidecar allowlist consumed by an embedding web server. */
export const CORS_MODULE_GATEWAY_ORIGINS_ENV_KEY = 'SDKWORK_MODULE_API_GATEWAY_CORS_ALLOWED_ORIGINS';

/** Registered console host pattern keys (CORS_SPEC.md section 5). */
export const CORS_CONSOLE_HOST_ENV_KEYS = Object.freeze({
  labels: 'SDKWORK_CORS_CONSOLE_HOST_LABELS',
  suffix: 'SDKWORK_CORS_CONSOLE_HOST_SUFFIX',
  schemes: 'SDKWORK_CORS_CONSOLE_HOST_SCHEMES',
  baseDomains: 'SDKWORK_CORS_CONSOLE_HOST_BASE_DOMAINS',
});

/**
 * Application-scoped `SDKWORK_<APPLICATION>_ALLOWED_ORIGINS` keys are retired:
 * they duplicated `SDKWORK_CORS_ALLOWED_ORIGINS` verbatim and drifted from it.
 */
export const RETIRED_APP_ORIGINS_KEY = /^SDKWORK_(?!CORS$|MODULE_)[A-Z0-9_]+_ALLOWED_ORIGINS$/u;

/** Any key whose name ends in `_ALLOWED_ORIGINS` or carries a `CORS` segment. */
export const CORS_ORIGIN_KEY = /^[A-Z0-9_]*(?:CORS|ALLOWED_ORIGINS)[A-Z0-9_]*$/u;

/**
 * Non-browser origins every lifecycle environment must carry, production
 * included: desktop WebView shells, the Mini Program runtime, and the
 * first-party `dsh` shell (WEB_FRAMEWORK_SPEC.md section 12).
 */
export const CORS_CLIENT_ORIGINS = Object.freeze([
  'app://dsh',
  'app://birdcoder',
  'app://sdkwork',
  'app://dtupay',
  'tauri://localhost',
  'https://servicewechat.com',
]);

/** Surfaces that terminate browser traffic and therefore own CORS origins. */
export const BROWSER_FACING_SURFACES = Object.freeze([
  'application.public-ingress',
  'application.app-http',
  'application.backend-http',
  'application.admin-http',
  'application.open-http',
  'edge.device-ingress',
]);

/**
 * Environment-key suffixes whose value is a browser-reachable development bind.
 * Only these produce loopback origins. `_PC_INTERNAL_DEV_PORT` /
 * `_H5_INTERNAL_DEV_PORT` are private Vite renderers, and `_SERVER_BIND` /
 * `_APPLICATION_PUBLIC_INGRESS_BIND` are process binds: none of them is a
 * browser origin, and promoting one into an allowlist is drift.
 */
export const CORS_BROWSER_BIND_ENV_SUFFIXES = Object.freeze([
  '_WEB_DEV_INGRESS_BIND',
  '_PC_DESKTOP_DEV_BIND',
]);

/** Bind suffixes that must never become CORS origins. */
export const CORS_NON_BROWSER_BIND_ENV_SUFFIXES = Object.freeze([
  '_PC_INTERNAL_DEV_PORT',
  '_H5_INTERNAL_DEV_PORT',
  '_SERVER_BIND',
  '_APPLICATION_PUBLIC_INGRESS_BIND',
]);

/**
 * Host port of the platform edge per lifecycle environment. Operators reach the
 * edge locally on this port, and the edge allowlist keeps the matching loopback
 * pair in every environment (CORS_SPEC.md section 4.3.1).
 */
export const EDGE_HOST_PORTS = Object.freeze({
  development: 3910,
  test: 3911,
  staging: 3912,
  demo: 3914,
  production: 3913,
});

/**
 * Operator loopback seeds of the edge allowlist. Unlike a development bind seed
 * these are **not** environment-restricted: the platform edge and its embedding
 * host keep them in production so an operator can smoke-test the deployed edge
 * locally. They belong to the edge allowlist keys only, never to a module's own
 * derived surface list.
 */
export function edgeLoopbackSeedOrigins(environment) {
  const port = EDGE_HOST_PORTS[environment];
  if (!port) return [];
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

export function isEdgeLoopbackSeedOrigin(origin, environment) {
  return edgeLoopbackSeedOrigins(environment).includes(origin);
}

/** Environments whose profiles are production-like and fail closed (SOURCE_CONFIG_SPEC.md). */
export const PRODUCTION_LIKE_ENVIRONMENTS = Object.freeze(['test', 'staging', 'demo', 'production']);

const EXACT_HTTP_ORIGIN = /^https?:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/u;
const EXACT_CUSTOM_SCHEME_ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[a-z0-9][a-z0-9.-]*$/u;
const DESKTOP_OR_CUSTOM_SCHEME = /^(?:app|tauri):\/\//u;
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?$/u;

export function isProductionEnvironment(environment) {
  return environment === 'production';
}

export function isProductionLikeEnvironment(environment) {
  return PRODUCTION_LIKE_ENVIRONMENTS.includes(environment);
}

export function profileIdParts(profileId) {
  const [deploymentProfile, environment, ...rest] = String(profileId ?? '').split('.');
  if (!deploymentProfile || !environment || rest.length > 0) return null;
  return { deploymentProfile, environment };
}

/** Split a comma-separated allowlist value, dropping blanks. */
export function splitOrigins(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** An exact origin carries no wildcard, credentials, path, query, or fragment. */
export function isExactOrigin(origin) {
  if (typeof origin !== 'string' || origin.length === 0) return false;
  if (origin !== origin.trim()) return false;
  if (/[*?#'\s]/u.test(origin)) return false;
  if (origin.includes('@')) return false;
  const schemeEnd = origin.indexOf('://');
  if (schemeEnd === -1) return false;
  if (origin.indexOf('/', schemeEnd + 3) !== -1) return false;
  if (EXACT_HTTP_ORIGIN.test(origin)) return true;
  return EXACT_CUSTOM_SCHEME_ORIGIN.test(origin);
}

export function isClientOrigin(origin) {
  return CORS_CLIENT_ORIGINS.includes(origin);
}

/**
 * Whether an exact origin is an `http(s)` host of the registered product family,
 * i.e. a carrier of the expanded console host set rather than a local extra.
 */
export function isRegisteredHostOrigin(origin) {
  if (!/^https?:\/\//u.test(origin)) return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.port !== '') return false;
  return isRegisteredBaseDomain(url.hostname);
}

/** Loopback or custom-scheme origin allowed as a profile-local development extra. */
export function isLocalExtraOrigin(origin) {
  if (DESKTOP_OR_CUSTOM_SCHEME.test(origin)) return true;
  return LOOPBACK_ORIGIN.test(origin);
}

/** `127.0.0.1:5182` → `http://127.0.0.1:5182` and `http://localhost:5182`. */
export function loopbackOriginForms(hostPort) {
  const match = /^(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d{1,5})$/u.exec(String(hostPort ?? '').trim());
  if (!match) return [];
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return [];
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/**
 * Loopback origins of a non-production profile.
 *
 * `bindValues` is the list of browser-reachable development bind values
 * (`<host>:<port>`) collected from `CORS_BROWSER_BIND_ENV_SUFFIXES` keys.
 * Ports are emitted in ascending order, each as `127.0.0.1` then `localhost`.
 * Production-like profiles carry no loopback origin.
 */
export function corsLoopbackOrigins(environment, bindValues = []) {
  if (isProductionLikeEnvironment(environment)) return [];
  const ports = new Set();
  for (const value of bindValues) {
    const match = /^(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d{1,5})$/u.exec(String(value ?? '').trim());
    if (!match) continue;
    const port = Number(match[1]);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b).flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

/** Collect browser-reachable development bind values from profile env entries. */
export function browserBindValuesFromEnv(envEntries) {
  const values = [];
  for (const [key, value] of Object.entries(envEntries ?? {})) {
    if (!CORS_BROWSER_BIND_ENV_SUFFIXES.some((suffix) => key.endsWith(suffix))) continue;
    if (CORS_NON_BROWSER_BIND_ENV_SUFFIXES.some((suffix) => key.endsWith(suffix))) continue;
    if (typeof value === 'string' && value.trim().length > 0) values.push(value.trim());
  }
  return values;
}

/**
 * Canonical host block of a profile: for every browser-facing surface the
 * topology publishes public hosts for, in registry order, one `https` origin
 * per registered base domain — plus the `http` counterpart outside production,
 * because the non-production edge also terminates plain HTTP.
 *
 * The selector is `cloudPublicHosts`, not `orchestration.profiles[].healthSurfaces`:
 * a published public host is reachable by browsers whether or not that profile
 * also exposes it as a health probe surface.
 */
export function corsHostOriginsForProfile(topology, profileId, baseDomains = DEFAULT_PRODUCT_BASE_DOMAINS) {
  const parts = profileIdParts(profileId);
  if (!parts) return [];
  const { environment } = parts;
  const surfaceIds = BROWSER_FACING_SURFACES.filter(
    (surfaceId) => topology?.cloudPublicHosts?.[surfaceId]
      && surfaceSupportsHttpWebserver(topology, surfaceId),
  );

  const origins = [];
  for (const surfaceId of surfaceIds) {
    const hosts = sortHostsByBaseDomain(
      hostsForSurface(topology.cloudPublicHosts[surfaceId], environment),
      baseDomains,
    );
    for (const host of hosts) {
      origins.push(`https://${host}`);
      if (!isProductionEnvironment(environment)) origins.push(`http://${host}`);
    }
  }
  return origins;
}

function sortHostsByBaseDomain(hosts, baseDomains) {
  const normalized = [...new Set(hosts.map(normalizeHost))].filter((host) => host.length > 0);
  const ordered = [];
  for (const baseDomain of baseDomains) {
    for (const host of normalized) {
      if (host.endsWith(`.${baseDomain}`) && !ordered.includes(host)) ordered.push(host);
    }
  }
  for (const host of normalized) {
    if (!ordered.includes(host)) ordered.push(host);
  }
  return ordered;
}

/**
 * Full canonical allowlist of a profile.
 *
 * Order: loopback seeds, host block, client origins, then preserved extras.
 * Extras are origins the profile already carried that are neither derived nor
 * client origins — for example the platform gateway hosts of a module that is
 * also served from `api.<base-domain>`. Extras that are structurally invalid
 * (`inspectCorsOrigins` errors) are not preserved.
 */
export function canonicalCorsOrigins(topology, profileId, options = {}) {
  const {
    existingOrigins = [],
    baseDomains = DEFAULT_PRODUCT_BASE_DOMAINS,
    loopbackBindValues = [],
  } = options;
  const parts = profileIdParts(profileId);
  const environment = parts?.environment ?? 'production';
  const seeds = corsLoopbackOrigins(environment, loopbackBindValues);
  const hostOrigins = corsHostOriginsForProfile(topology, profileId, baseDomains);
  const known = new Set([...seeds, ...hostOrigins, ...CORS_CLIENT_ORIGINS]);
  const extras = [...new Set(existingOrigins.map((origin) => String(origin).trim()).filter((origin) => origin.length > 0))]
    .filter((origin) => !known.has(origin) && isExactOrigin(origin) && !isInvalidExtra(origin, environment));
  return [...seeds, ...hostOrigins, ...CORS_CLIENT_ORIGINS, ...extras];
}

/**
 * An extra origin a profile must never carry. Registered-family extras — for
 * example the platform gateway hosts of a module also served from
 * `api.<base-domain>` — are permitted and preserved.
 */
function isInvalidExtra(origin, environment) {
  if (!isRegisteredHostOrigin(origin)) return true;
  if (isProductionLikeEnvironment(environment) && LOOPBACK_ORIGIN.test(origin)) return true;
  if (isProductionEnvironment(environment) && !origin.startsWith('https://')) return true;
  return false;
}

export function formatOrigins(origins) {
  return origins.join(',');
}

/**
 * Environment-specific violation of a single origin, or `null` when the origin
 * is acceptable for that environment. `duplicated origin` is reported separately
 * because it is a property of the list, not of one entry.
 */
export function originEnvironmentViolation(origin, environment) {
  if (!isExactOrigin(origin)) return `origin ${JSON.stringify(origin)} is not an exact origin`;
  if (isProductionLikeEnvironment(environment) && LOOPBACK_ORIGIN.test(origin)
    && !isEdgeLoopbackSeedOrigin(origin, environment)) {
    return `${environment} profile must not allow the development origin ${origin}`;
  }
  // The edge loopback seeds are the one sanctioned plain-http exception: an operator
  // smoke-tests the deployed edge through `http://localhost:<edge-port>`, and the web
  // framework only relaxes loopback handling when such a sentinel is present.
  if (isProductionEnvironment(environment) && !isClientOrigin(origin) && !origin.startsWith('https://')
    && !isEdgeLoopbackSeedOrigin(origin, environment)) {
    return `production origin ${origin} must use https`;
  }
  if (isClientOrigin(origin) || isLocalExtraOrigin(origin)) return null;
  if (!isRegisteredHostOrigin(origin)) return `origin ${origin} is outside the registered product domain family`;
  return null;
}

/** Whether an origin must be dropped from an allowlist of this environment. */
export function isEnvironmentInvalidOrigin(origin, environment) {
  return originEnvironmentViolation(origin, environment) !== null;
}

/**
 * Structural audit of a plain allowlist for one environment: exactness,
 * duplication, development-only leakage, production scheme, and family
 * membership. Used both for the derived shared allowlist and for canonical
 * allowlists owned by another mechanism (gateway sidecar, module-gateway
 * attach), whose completeness is not derived here.
 */
export function inspectPlainOrigins(origins, environment) {
  const issues = [];
  for (const [index, origin] of origins.entries()) {
    if (origins.indexOf(origin) !== index) {
      issues.push(`duplicated origin ${origin}`);
      continue;
    }
    const violation = originEnvironmentViolation(origin, environment);
    if (violation !== null) issues.push(violation);
  }
  return issues;
}

/**
 * Structural audit of one profile allowlist against CORS_SPEC.md section 4.
 * Returns human-readable errors; an empty array means the profile is canonical.
 * Set `options.checkOrder` to also report a non-canonical entry order.
 */
export function inspectCorsOrigins(origins, topology, profileId, options = {}) {
  const { baseDomains = DEFAULT_PRODUCT_BASE_DOMAINS, loopbackBindValues = [], checkOrder = false } = options;
  const parts = profileIdParts(profileId);
  if (!parts) return [`${profileId}: profile id must be <deployment-profile>.<environment>`];
  const { environment } = parts;
  const issues = inspectPlainOrigins(origins, environment)
    .map((issue) => `${profileId}: ${issue}`);

  const hostOrigins = corsHostOriginsForProfile(topology, profileId, baseDomains);
  const present = new Set(origins);
  for (const origin of hostOrigins) {
    if (!present.has(origin)) issues.push(`${profileId}: missing derived origin ${origin}`);
  }

  for (const origin of CORS_CLIENT_ORIGINS) {
    if (!present.has(origin)) issues.push(`${profileId}: missing client origin ${origin}`);
  }

  if (checkOrder) {
    const expected = canonicalCorsOrigins(topology, profileId, {
      existingOrigins: origins,
      baseDomains,
      loopbackBindValues,
    });
    if (expected.join(',') !== origins.join(',')) {
      issues.push(`${profileId}: allowlist order is not canonical; run align-cors-standard.mjs`);
    }
  }
  return issues;
}

/** Role labels a module publishes, used when auditing console host pattern keys. */
export function moduleRoleLabels(topology) {
  const appId = topology?.appId ?? '';
  const primaryRole = registeredRoleHost(appId, topology?.applicationCode);
  const labels = new Set([primaryRole]);
  for (const surfaceId of BROWSER_FACING_SURFACES) {
    if (!topology?.cloudPublicHosts?.[surfaceId]) continue;
    const label = roleLabelForSurface(surfaceId, primaryRole);
    if (label) labels.add(label);
  }
  return [...labels];
}

export function auxiliaryRoleLabel(primaryRole, surfaceId) {
  return auxiliarySurfaceRoleHost(primaryRole, surfaceId);
}

export function registeredEnvironmentSuffix(environment) {
  return environmentSuffix(environment);
}
