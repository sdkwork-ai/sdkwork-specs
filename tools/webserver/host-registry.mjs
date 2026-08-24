// Public host naming per APP_RUNTIME_TOPOLOGY_NAMING.md §9.

import { deriveEnvHosts, productionHostsForSurface, surfaceSupportsHttpWebserver } from './build-from-topology.mjs';

export const LIFECYCLE_ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

/** Default base domain set for SDKWork-managed cloud products (§9.3). */
export const DEFAULT_PRODUCT_BASE_DOMAINS = [
  'sdkwork.com',
  'birdcoder.com',
  'dtupay.com',
  'sdkwork.cn',
  'birdcoder.cn',
  'dtupay.cn',
  'skubc.com',
  'skubc.cn',
  'zowalk.com',
  'zowalk.cn',
  'offer86.com',
  'offer86.cn',
  '86offer.com',
  '86offer.cn',
];

export const REGISTERED_BASE_DOMAINS = new Set(DEFAULT_PRODUCT_BASE_DOMAINS);

export const PLATFORM_GATEWAY_ROLE = 'api';

export const PLATFORM_GATEWAY_PRODUCTION_HOST = `${PLATFORM_GATEWAY_ROLE}.sdkwork.com`;

/** Explicit role hosts from APP_RUNTIME_TOPOLOGY_NAMING.md §9.2 (production bare role). */
export const REGISTERED_APP_ROLE_HOSTS = {
  'sdkwork-im': 'im',
  'sdkwork-drive': 'drive',
  'sdkwork-cloudrouter': 'router',
  'sdkwork-knowledgebase': 'knowledgebase',
  'sdkwork-birdcoder': 'code',
  'sdkwork-appstore': 'appstore',
  'sdkwork-manager': 'admin',
  'sdkwork-webserver': 'server',
};

const NON_PRODUCTION_SUFFIXES = ['-dev', '-test', '-staging'];

const RETIRED_PREFIX_SUFFIX = /^(dev|test|staging)-/u;
const RETIRED_PROD_SUFFIX = /-(prod|production)\./u;

/** Reserved placeholder TLDs — not valid public cloud hosts. */
const PLACEHOLDER_HOST = /(?:^|\.)internal\.example$|\.local$/iu;

export function normalizeHost(host) {
  return typeof host === 'string' ? host.trim().toLowerCase() : '';
}

export function baseDomainFromHost(host) {
  const parts = normalizeHost(host).split('.');
  if (parts.length < 2) return null;
  return parts.slice(-2).join('.');
}

export function isRegisteredBaseDomain(host) {
  const base = baseDomainFromHost(host);
  return base !== null && REGISTERED_BASE_DOMAINS.has(base);
}

export function environmentSuffix(environment) {
  if (environment === 'production') return '';
  if (environment === 'development') return '-dev';
  if (environment === 'test') return '-test';
  if (environment === 'staging') return '-staging';
  return '';
}

export function roleHostForBase(roleLabel, baseDomain, environment) {
  const suffix = environmentSuffix(environment);
  return `${roleLabel}${suffix}.${baseDomain}`;
}

export function hostsForRoleAcrossBases(
  roleLabel,
  environment,
  baseDomains = DEFAULT_PRODUCT_BASE_DOMAINS,
) {
  return baseDomains.map((baseDomain) => roleHostForBase(roleLabel, baseDomain, environment));
}

/**
 * Whether a host satisfies APP_RUNTIME_TOPOLOGY_NAMING.md §9.1 public host rules.
 */
export function isPublicHostCompliant(host) {
  const normalized = normalizeHost(host);
  if (!normalized || normalized.includes('_')) return false;
  if (PLACEHOLDER_HOST.test(normalized)) return false;
  if (normalized !== host.trim().toLowerCase() && /[A-Z]/.test(host)) return false;
  if (RETIRED_PREFIX_SUFFIX.test(normalized)) return false;
  if (RETIRED_PROD_SUFFIX.test(normalized)) return false;
  if (!isRegisteredBaseDomain(normalized)) return false;

  const labels = normalized.split('.');
  const roleLabel = labels[0];
  if (!roleLabel || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/u.test(roleLabel)) return false;

  for (const suffix of NON_PRODUCTION_SUFFIXES) {
    if (roleLabel.endsWith(suffix)) {
      const bare = roleLabel.slice(0, -suffix.length);
      if (!bare || bare.endsWith('-')) return false;
    }
  }
  return true;
}

export function filterCompliantHosts(hosts) {
  return [...new Set((hosts ?? []).map(normalizeHost).filter(isPublicHostCompliant))];
}

export function registeredRoleHost(appId, applicationCode) {
  if (REGISTERED_APP_ROLE_HOSTS[appId]) return REGISTERED_APP_ROLE_HOSTS[appId];
  return String(applicationCode ?? appId.replace(/^sdkwork-/u, '')).replace(/_/gu, '-');
}

export function auxiliarySurfaceRoleHost(primaryRoleHost, surfaceId) {
  if (surfaceId === 'application.app-http') return `${primaryRoleHost}-app`;
  if (surfaceId === 'application.admin-http' || surfaceId === 'application.backend-http') {
    return `${primaryRoleHost}-admin`;
  }
  if (surfaceId === 'application.open-http') {
    if (primaryRoleHost === 'knowledgebase') return 'knowledge';
    return `${primaryRoleHost}-open`;
  }
  if (surfaceId === 'edge.device-ingress') return `edge.${primaryRoleHost}`;
  return null;
}

export function roleLabelForSurface(surfaceId, primaryRole) {
  if (surfaceId === 'platform.api-gateway') return PLATFORM_GATEWAY_ROLE;
  if (surfaceId === 'application.public-ingress') return primaryRole;
  return auxiliarySurfaceRoleHost(primaryRole, surfaceId) ?? primaryRole;
}

function mergeAliasHosts(expanded, existing, roleLabel, environment) {
  const expandedSet = new Set(expanded.map(normalizeHost));
  const aliases = existing.filter((host) => {
    if (expandedSet.has(normalizeHost(host))) return false;
    const base = baseDomainFromHost(host);
    if (!base) return false;
    const expected = roleHostForBase(roleLabel, base, environment);
    return normalizeHost(host) !== normalizeHost(expected);
  });
  return [...new Set([...expanded, ...aliases.map(normalizeHost)])];
}

export function expandSurfaceMultiBase(
  surfaceConfig,
  roleLabel,
  baseDomains = DEFAULT_PRODUCT_BASE_DOMAINS,
) {
  const config = surfaceConfig && typeof surfaceConfig === 'object' ? surfaceConfig : {};
  const existingProduction = filterCompliantHosts(productionHostsForSurface(config));

  const productionExpanded = hostsForRoleAcrossBases(roleLabel, 'production', baseDomains);
  const productionMerged = mergeAliasHosts(productionExpanded, existingProduction, roleLabel, 'production');

  config.httpHost = productionMerged[0];
  if (productionMerged.length > 1) {
    config.httpHosts = productionMerged;
  } else {
    delete config.httpHosts;
  }

  config.environments ??= {};
  for (const environment of ['development', 'test', 'staging']) {
    const existingEnv = filterCompliantHosts([
      ...(config.environments[environment]?.httpHosts ?? []),
      ...(config.environments[environment]?.httpHost ? [config.environments[environment].httpHost] : []),
    ]);
    const expanded = hostsForRoleAcrossBases(roleLabel, environment, baseDomains);
    const merged = mergeAliasHosts(expanded, existingEnv, roleLabel, environment);
    if (merged.length === 1) {
      config.environments[environment] = { httpHost: merged[0] };
    } else {
      config.environments[environment] = { httpHosts: merged };
    }
  }
  return config;
}

export function ensureSurfaceEnvironments(surfaceConfig) {
  if (!surfaceConfig || typeof surfaceConfig !== 'object') return surfaceConfig;
  const production = filterCompliantHosts(productionHostsForSurface(surfaceConfig));
  if (production.length === 0) return surfaceConfig;

  if (production.length === 1 && !surfaceConfig.httpHost) {
    surfaceConfig.httpHost = production[0];
    delete surfaceConfig.httpHosts;
  } else if (production.length > 1) {
    surfaceConfig.httpHosts = production;
    if (!surfaceConfig.httpHost) surfaceConfig.httpHost = production[0];
  }

  surfaceConfig.environments ??= {};
  for (const environment of ['development', 'test', 'staging']) {
    const variant = surfaceConfig.environments[environment];
    const variantHosts = filterCompliantHosts([
      ...(variant?.httpHosts ?? []),
      ...(variant?.httpHost ? [variant.httpHost] : []),
    ]);
    if (variantHosts.length > 0) {
      if (variantHosts.length === 1) {
        surfaceConfig.environments[environment] = { ...variant, httpHost: variantHosts[0] };
        delete surfaceConfig.environments[environment].httpHosts;
      } else {
        surfaceConfig.environments[environment] = { ...variant, httpHosts: variantHosts };
      }
      continue;
    }
    const derived = filterCompliantHosts(deriveEnvHosts(production, environment));
    if (derived.length === 1) {
      surfaceConfig.environments[environment] = { httpHost: derived[0] };
    } else if (derived.length > 1) {
      surfaceConfig.environments[environment] = { httpHosts: derived };
    }
  }
  return surfaceConfig;
}

function surfaceUsesPlatformGatewayHost(surfaceConfig) {
  const hosts = productionHostsForSurface(surfaceConfig);
  return hosts.some((host) => {
    const role = normalizeHost(host).split('.')[0];
    return role === PLATFORM_GATEWAY_ROLE || normalizeHost(host) === PLATFORM_GATEWAY_PRODUCTION_HOST;
  });
}

/**
 * Align cloudPublicHosts to naming registry: multi-base hosts, environments, fix mis-assigned api.* surfaces.
 */
export function alignCloudPublicHosts(spec) {
  const appId = spec.appId ?? '';
  const applicationCode = spec.applicationCode ?? appId.replace(/^sdkwork-/u, '');
  const primaryRole = registeredRoleHost(appId, applicationCode);
  const baseDomains = DEFAULT_PRODUCT_BASE_DOMAINS;
  spec.cloudPublicHosts ??= {};

  if (spec.surfaces?.['application.public-ingress'] && surfaceSupportsHttpWebserver(spec, 'application.public-ingress')) {
    const ingress = spec.cloudPublicHosts['application.public-ingress'] ?? {};
    spec.cloudPublicHosts['application.public-ingress'] = expandSurfaceMultiBase(
      ingress,
      primaryRole,
      baseDomains,
    );
  } else {
    delete spec.cloudPublicHosts['application.public-ingress'];
  }

  const auxiliarySurfaceIds = [
    'application.app-http',
    'application.backend-http',
    'application.admin-http',
    'application.open-http',
    'edge.device-ingress',
  ];
  for (const surfaceId of auxiliarySurfaceIds) {
    if (!spec.surfaces?.[surfaceId] || !surfaceSupportsHttpWebserver(spec, surfaceId)) {
      delete spec.cloudPublicHosts[surfaceId];
      continue;
    }
    const auxRole = auxiliarySurfaceRoleHost(primaryRole, surfaceId);
    if (!auxRole) continue;
    const surfaceConfig = spec.cloudPublicHosts[surfaceId] ?? {};
    spec.cloudPublicHosts[surfaceId] = expandSurfaceMultiBase(surfaceConfig, auxRole, baseDomains);
  }

  for (const [surfaceId, surfaceConfig] of Object.entries({ ...spec.cloudPublicHosts })) {
    if (surfaceId === 'platform.api-gateway') continue;
    if (!surfaceConfig) continue;
    if (!surfaceSupportsHttpWebserver(spec, surfaceId)) {
      delete spec.cloudPublicHosts[surfaceId];
      continue;
    }

    let roleLabel = roleLabelForSurface(surfaceId, primaryRole);
    if (appId !== 'sdkwork-api-cloud-gateway' && surfaceUsesPlatformGatewayHost(surfaceConfig)) {
      const auxRole = auxiliarySurfaceRoleHost(primaryRole, surfaceId);
      if (!auxRole) {
        delete spec.cloudPublicHosts[surfaceId];
        continue;
      }
      roleLabel = auxRole;
    }

    const expanded = expandSurfaceMultiBase(surfaceConfig, roleLabel, baseDomains);
    const compliant = filterCompliantHosts(productionHostsForSurface(expanded));
    if (compliant.length === 0) {
      delete spec.cloudPublicHosts[surfaceId];
      continue;
    }
    spec.cloudPublicHosts[surfaceId] = expanded;
  }

  const gateway = spec.cloudPublicHosts['platform.api-gateway'];
  if (gateway && spec.surfaces?.['platform.api-gateway']) {
    spec.cloudPublicHosts['platform.api-gateway'] = expandSurfaceMultiBase(
      gateway,
      PLATFORM_GATEWAY_ROLE,
      baseDomains,
    );
  }

  return spec;
}
