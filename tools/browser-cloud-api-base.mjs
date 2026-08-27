#!/usr/bin/env node

/**
 * Cloud browser API base URL helpers (ENVIRONMENT_SPEC §5.1.0.1,
 * APP_RUNTIME_TOPOLOGY_NAMING.md §9).
 *
 * Supports comma/semicolon-separated `cloudApiBaseUrl` values in deployment
 * config and host-aware resolution: im.sdkwork.com -> api.sdkwork.com,
 * im-dev.sdkwork.cn -> api-dev.sdkwork.cn.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { baseDomainFromHost, environmentSuffix, hostsForRoleAcrossBases, PLATFORM_GATEWAY_ROLE } from './webserver/host-registry.mjs';
import { hostsForSurface } from './webserver/build-from-topology.mjs';

export const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

export const CLOUD_API_BASE_URL_SEPARATORS = /[,;]+/u;
export const SDK_BASE_URL_KEYS = [
  'appApiBaseUrl',
  'backendApiBaseUrl',
  'driveAppApiBaseUrl',
  'appbaseAppApiBaseUrl',
  'deployAppApiBaseUrl',
  'openApiBaseUrl',
  'sdkBaseUrl',
];

const NON_PRODUCTION_SUFFIXES = ['-dev', '-test', '-staging'];

export function splitCloudApiBaseUrlList(raw) {
  return String(raw ?? '')
    .split(CLOUD_API_BASE_URL_SEPARATORS)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function normalizeCloudApiOrigin(value) {
  const token = String(value ?? '').trim();
  if (!token) {
    throw new Error('cloud API base URL must be a non-empty absolute HTTP(S) URL');
  }
  let parsed;
  try {
    parsed = new URL(token);
  } catch {
    throw new Error(`cloud API base URL is not a valid URL: ${token}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`cloud API base URL must use HTTP(S): ${token}`);
  }
  return parsed.origin;
}

export function normalizeCloudApiOriginList(raw) {
  const entries = splitCloudApiBaseUrlList(raw);
  if (entries.length === 0) {
    throw new Error('cloudApiBaseUrl must declare at least one absolute HTTP(S) URL');
  }
  const origins = entries.map((entry) => normalizeCloudApiOrigin(entry));
  return [...new Set(origins)];
}

export function serializeCloudApiOriginList(origins) {
  return normalizeCloudApiOriginList(origins.join(';')).join(';');
}

export function expectedPlatformGatewayHost(environment, baseDomain) {
  const suffix = environmentSuffix(environment);
  return `${PLATFORM_GATEWAY_ROLE}${suffix}.${baseDomain}`;
}

export function validateCloudApiOriginForEnvironment(origin, environment) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`cloud API origin is not a valid URL: ${origin}`);
  }
  const baseDomain = baseDomainFromHost(parsed.hostname);
  if (!baseDomain) {
    throw new Error(`cloud API origin hostname must include a base domain: ${origin}`);
  }
  const expectedHost = expectedPlatformGatewayHost(environment, baseDomain);
  if (parsed.hostname !== expectedHost) {
    throw new Error(
      `cloud API origin ${origin} must use host ${expectedHost} for environment ${environment}`,
    );
  }
  return origin;
}

export function validateCloudApiOriginListForEnvironment(origins, environment) {
  const normalized = normalizeCloudApiOriginList(origins);
  for (const origin of normalized) {
    validateCloudApiOriginForEnvironment(origin, environment);
  }
  const bases = normalized.map((origin) => baseDomainFromHost(new URL(origin).hostname));
  if (new Set(bases).size !== bases.length) {
    throw new Error('cloudApiBaseUrl entries must not repeat the same base domain');
  }
  return normalized;
}

export function cloudApiOriginFromHost(host, environment) {
  const normalized = String(host ?? '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('cloud API host must be non-empty');
  }
  const protocol = environment === 'development' ? 'https' : 'https';
  return normalizeCloudApiOrigin(`${protocol}://${normalized}`);
}

export function deriveCloudApiOriginsFromTopology(topology, environment) {
  const gateway = topology?.cloudPublicHosts?.['platform.api-gateway'];
  let hosts = gateway ? hostsForSurface(gateway, environment) : [];
  if (hosts.length === 0) {
    hosts = hostsForRoleAcrossBases(PLATFORM_GATEWAY_ROLE, environment);
  }
  if (hosts.length === 0) {
    throw new Error('topology does not declare platform.api-gateway hosts');
  }
  return validateCloudApiOriginListForEnvironment(
    hosts.map((host) => cloudApiOriginFromHost(host, environment)),
    environment,
  );
}

export function deriveCloudApiBaseUrlFromTopology(topology, environment) {
  return cloudSdkBaseUrlMaterializationValue(deriveCloudApiOriginsFromTopology(topology, environment));
}

export function resolveTopologySpecPath(repositoryRoot, deployment) {
  const relative = String(deployment?.topology ?? '../specs/topology.spec.json').trim();
  return path.resolve(path.dirname(path.join(repositoryRoot, 'etc', 'sdkwork.deployment.config.json')), relative);
}

export function readRepositoryTopology(repositoryRoot, deployment) {
  const topologyPath = resolveTopologySpecPath(repositoryRoot, deployment);
  if (!existsSync(topologyPath)) {
    throw new Error(`topology spec is missing: ${topologyPath}`);
  }
  return JSON.parse(readFileSync(topologyPath, 'utf8'));
}

export function mergeCloudApiOriginLists(primary, supplemental) {
  const merged = normalizeCloudApiOriginList(
    [...normalizeCloudApiOriginList(primary), ...normalizeCloudApiOriginList(supplemental)].join(';'),
  );
  return merged;
}

export function resolveCloudApiOriginListForRepository({
  repositoryRoot,
  environment,
  deployment,
  topology,
  preferTopology = false,
}) {
  let deploymentConfig = deployment;
  if (!deploymentConfig) {
    const deploymentPath = path.join(repositoryRoot, 'etc', 'sdkwork.deployment.config.json');
    if (!existsSync(deploymentPath)) {
      throw new Error(`repository deployment config is missing: ${deploymentPath}`);
    }
    deploymentConfig = JSON.parse(readFileSync(deploymentPath, 'utf8'));
  }
  const topologySpec = topology ?? readRepositoryTopology(repositoryRoot, deploymentConfig);
  const topologyOrigins = deriveCloudApiOriginsFromTopology(topologySpec, environment);
  if (preferTopology) {
    return topologyOrigins;
  }
  const raw = deploymentConfig?.environments?.[environment]?.cloudApiBaseUrl;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return topologyOrigins;
  }
  const deploymentOrigins = validateCloudApiOriginListForEnvironment(raw, environment);
  const topologyBases = new Set(
    topologyOrigins.map((origin) => baseDomainFromHost(new URL(origin).hostname)),
  );
  const deploymentBases = new Set(
    deploymentOrigins.map((origin) => baseDomainFromHost(new URL(origin).hostname)),
  );
  for (const base of topologyBases) {
    if (!deploymentBases.has(base)) {
      return mergeCloudApiOriginLists(deploymentOrigins, topologyOrigins);
    }
  }
  return deploymentOrigins;
}

export function readCloudApiOriginListFromDeployment(deployment, environment, options = {}) {
  if (options.repositoryRoot) {
    return resolveCloudApiOriginListForRepository({
      repositoryRoot: options.repositoryRoot,
      environment,
      deployment,
      topology: options.topology,
      preferTopology: options.preferTopology === true,
    });
  }
  const raw = deployment?.environments?.[environment]?.cloudApiBaseUrl;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(
      `repository deployment config must declare environments.${environment}.cloudApiBaseUrl`,
    );
  }
  return validateCloudApiOriginListForEnvironment(raw, environment);
}

export function derivePlatformGatewayHostFromPageHost(pageHost, environment) {
  const hostname = String(pageHost ?? '').trim().toLowerCase();
  const baseDomain = baseDomainFromHost(hostname);
  if (!baseDomain) {
    return null;
  }
  const roleLabel = hostname.slice(0, -(baseDomain.length + 1));
  let envSuffix = '';
  for (const suffix of NON_PRODUCTION_SUFFIXES) {
    if (roleLabel.endsWith(suffix)) {
      envSuffix = suffix;
      break;
    }
  }
  const configuredSuffix = environmentSuffix(environment);
  if (envSuffix !== configuredSuffix) {
    return null;
  }
  return expectedPlatformGatewayHost(environment, baseDomain);
}

export function resolveCloudApiOriginForHost(configuredOrigins, pageHost, environment) {
  const origins = normalizeCloudApiOriginList(
    Array.isArray(configuredOrigins) ? configuredOrigins.join(';') : configuredOrigins,
  );
  const hostname = String(pageHost ?? '').trim().toLowerCase();
  const pageBaseDomain = baseDomainFromHost(hostname);
  const expectedApiHost = pageBaseDomain
    ? expectedPlatformGatewayHost(environment, pageBaseDomain)
    : null;
  if (expectedApiHost) {
    const exact = origins.find((origin) => new URL(origin).hostname === expectedApiHost);
    if (exact) {
      return exact;
    }
  }
  if (pageBaseDomain) {
    const matched = origins.find((origin) => baseDomainFromHost(new URL(origin).hostname) === pageBaseDomain);
    if (matched) {
      return matched;
    }
  }
  const derivedHost = derivePlatformGatewayHostFromPageHost(hostname, environment);
  if (derivedHost) {
    const derived = origins.find((origin) => new URL(origin).hostname === derivedHost);
    if (derived) {
      return derived;
    }
    const protocol = origins[0] ? new URL(origins[0]).protocol : 'https:';
    return `${protocol}//${derivedHost}`;
  }
  return origins[0];
}

export function resolveBrowserCloudSdkBaseUrl(configuredValue, options = {}) {
  const value = String(configuredValue ?? '').trim();
  if (!value || value === '/') {
    return value;
  }
  if (!CLOUD_API_BASE_URL_SEPARATORS.test(value)) {
    return value;
  }
  const pageHost = options.pageHost
    ?? (typeof globalThis !== 'undefined'
      && globalThis.window
      && typeof globalThis.window.location?.hostname === 'string'
      ? globalThis.window.location.hostname
      : undefined);
  if (!pageHost) {
    return normalizeCloudApiOriginList(value)[0];
  }
  const environment = String(options.environment ?? '').trim() || inferEnvironmentFromPageHost(pageHost);
  return resolveCloudApiOriginForHost(value, pageHost, environment);
}

function inferEnvironmentFromPageHost(pageHost) {
  const hostname = String(pageHost ?? '').trim().toLowerCase();
  const baseDomain = baseDomainFromHost(hostname);
  if (!baseDomain) {
    return 'production';
  }
  const roleLabel = hostname.slice(0, -(baseDomain.length + 1));
  if (roleLabel.endsWith('-dev')) return 'development';
  if (roleLabel.endsWith('-test')) return 'test';
  if (roleLabel.endsWith('-staging')) return 'staging';
  return 'production';
}

export function cloudSdkBaseUrlMaterializationValue(origins) {
  const normalized = normalizeCloudApiOriginList(
    Array.isArray(origins) ? origins.join(';') : origins,
  );
  if (normalized.length === 1) {
    return normalized[0];
  }
  return serializeCloudApiOriginList(normalized);
}

export function attachCloudApiBaseUrls(runtimeDocument, origins) {
  const normalized = normalizeCloudApiOriginList(
    Array.isArray(origins) ? origins.join(';') : origins,
  );
  runtimeDocument.cloudApiBaseUrls = normalized;
  const materialized = cloudSdkBaseUrlMaterializationValue(normalized);
  for (const key of SDK_BASE_URL_KEYS) {
    if (runtimeDocument[key] !== undefined) {
      runtimeDocument[key] = materialized;
    }
  }
  return runtimeDocument;
}
