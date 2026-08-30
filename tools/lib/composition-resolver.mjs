#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import {
  findCorePackages,
  isCompositionConsumerExempt,
  isCompositionExemptRepo,
  listClientAppRoots,
  normalizeSdkDependencies,
  readJson,
  toPosix,
} from './app-composition.mjs';
import {
  listComponentPortBindingSpecs,
} from './component-port-bindings.mjs';
import {
  listFrontendAppRoots,
  listFrontendPackages,
} from './frontend-composition.mjs';
import {
  collectRouteRegistry,
} from './route-registry.mjs';
import {
  parseRustCargoManifest,
} from './rust-backend-composition.mjs';
import { loadSdkFamilyManifestForWorkspaceConsumer } from './sdk-manifest-standard.mjs';

const APP_API_PREFIX = '/app/v3/api';
const BACKEND_API_PREFIX = '/backend/v3/api';
const INTERNAL_API_PREFIX = '/internal/v3/api';

const SKIP_ARCHITECTURE_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build']);
const ALLOWED_INTEGRATION_OVERRIDE_KEYS = new Set(['baseUrl', 'runtimeMode']);

export const RUNTIME_MODES = new Set([
  'same-origin-embedded',
  'external-via-platform-surface',
  'external-via-declared-upstream',
]);

function isPlatformRuntimeDependency(dep) {
  const mode = String(dep?.dependencyMode ?? '').toLowerCase();
  if (mode === 'platform-framework' || mode === 'platform-kernel') return true;
  // A dependency that explicitly forbids generated transport and names no API
  // surface is carrying no SDK connectivity; treat it as platform linkage only
  // when it is explicitly declared as a platform/util mode.
  return mode.startsWith('platform-');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function domainFromSdkWorkspace(workspace) {
  const match = String(workspace).match(/^sdkwork-([^-]+)-(?:app|backend|internal)-sdk$/u);
  if (match) return match[1];
  const openMatch = String(workspace).match(/^sdkwork-([^-]+)-sdk$/u);
  if (openMatch) return openMatch[1];
  return null;
}

function surfaceFromWorkspace(workspace) {
  if (/-backend-sdk$/u.test(workspace)) return 'backend-api';
  if (/-app-sdk$/u.test(workspace)) return 'app-api';
  if (/-internal-sdk$/u.test(workspace)) return 'internal-api';
  return 'open-api';
}

function defaultCredentialMode(surface) {
  if (surface === 'backend-api') return 'authenticated-backend-admin';
  if (surface === 'app-api') return 'authenticated-app-api';
  if (surface === 'internal-api') return 'ingress-token';
  return 'protected-open-api-flexible';
}

function defaultPrefix(surface, manifestDiscovery) {
  if (manifestDiscovery?.apiPrefix) return manifestDiscovery.apiPrefix;
  if (surface === 'backend-api') return BACKEND_API_PREFIX;
  if (surface === 'app-api') return APP_API_PREFIX;
  if (surface === 'internal-api') return INTERNAL_API_PREFIX;
  return null;
}

function findSiblingRepoRoot(repoRoot, domain) {
  const candidate = path.resolve(repoRoot, '..', `sdkwork-${domain}`);
  if (fs.existsSync(path.join(candidate, 'specs', 'component.spec.json'))) {
    return candidate;
  }
  if (domain === 'iam' || domain === 'appbase') {
    const iamRoot = path.resolve(repoRoot, '..', 'sdkwork-iam');
    if (fs.existsSync(path.join(iamRoot, 'specs', 'component.spec.json'))) {
      return iamRoot;
    }
  }
  return null;
}

function loadSdkFamilyManifest(repoRoot, workspace) {
  return loadSdkFamilyManifestForWorkspaceConsumer(repoRoot, workspace);
}

function isCanonicalApiEdgeRoot(value) {
  const normalized = String(value ?? '').trim().replace(/\/+$/u, '') || '/';
  if (normalized === '/') return true;
  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
    return pathname === '/';
  } catch {
    return false;
  }
}

function isBrowserSameOriginApiEdgeAllowed(value, {
  allowBrowserSameOriginApiEdge = false,
  canonicalRoutePrecedenceVerified = false,
} = {}) {
  return allowBrowserSameOriginApiEdge
    && canonicalRoutePrecedenceVerified
    && isCanonicalApiEdgeRoot(value);
}

function loadConsumerSdkOwner(repoRoot) {
  const appManifest = readJsonIfExists(path.join(repoRoot, 'sdkwork.app.config.json'));
  if (appManifest?.app?.key) return appManifest.app.key;
  if (appManifest?.applicationCode) {
    return String(appManifest.applicationCode).startsWith('sdkwork-')
      ? appManifest.applicationCode
      : `sdkwork-${appManifest.applicationCode}`;
  }
  return null;
}

function loadDependencyIntegration(repoRoot, workspace) {
  const domain = domainFromSdkWorkspace(workspace);
  if (!domain) return null;
  const siblingRoot = findSiblingRepoRoot(repoRoot, domain);
  if (!siblingRoot) return null;
  const componentSpec = readJsonIfExists(path.join(siblingRoot, 'specs', 'component.spec.json'));
  return componentSpec?.integration ?? null;
}

function loadLegacyDependencySurface(repoRoot, workspace) {
  const manifestPath = path.join(repoRoot, 'specs', 'dependency-api-surfaces.json');
  const manifest = readJsonIfExists(manifestPath);
  if (!manifest?.dependencies) return null;
  return manifest.dependencies.find((entry) => entry.workspace === workspace) ?? null;
}

function resolvePermissionManifestRef(repoRoot, workspace, dependencyIntegration) {
  if (dependencyIntegration?.permissionManifest) {
    const domain = domainFromSdkWorkspace(workspace);
    const siblingRoot = domain ? findSiblingRepoRoot(repoRoot, domain) : null;
    if (siblingRoot) {
      return toPosix(path.relative(repoRoot, path.join(siblingRoot, dependencyIntegration.permissionManifest)));
    }
    return dependencyIntegration.permissionManifest;
  }

  const domain = domainFromSdkWorkspace(workspace);
  if (!domain) return null;
  const siblingRoot = findSiblingRepoRoot(repoRoot, domain);
  if (!siblingRoot) return null;

  const candidates = [
    path.join(siblingRoot, 'specs', 'iam.module.manifest.json'),
    path.join(siblingRoot, 'iam', 'modules', 'iam-kernel', 'iam.module.manifest.json'),
    path.join(siblingRoot, 'iam', 'modules', domain, 'iam.module.manifest.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return toPosix(path.relative(repoRoot, candidate));
    }
  }
  return null;
}

function mapLegacyRuntimeMode(legacySurface) {
  const runtime = legacySurface?.runtimeIntegration;
  if (!runtime) return null;
  if (runtime.mode === 'same-origin-mounted') return 'same-origin-embedded';
  if (runtime.mode === 'external-service') return 'external-via-platform-surface';
  return null;
}

function resolveRuntimeMode({
  dependencyIntegration,
  legacySurface,
  connectivityPlane,
}) {
  const override = normalizeDeclaredRuntimeMode(dependencyIntegration?.defaultRuntimeMode);
  if (override) return override;

  const legacyMode = mapLegacyRuntimeMode(legacySurface);
  if (legacyMode) {
    const mountStatus = legacySurface?.runtimeIntegration?.mountCoverage?.status;
    if (legacyMode === 'same-origin-embedded' && mountStatus !== 'verified') {
      return 'external-via-platform-surface';
    }
    return legacyMode;
  }

  if (connectivityPlane === 'platform') return 'external-via-platform-surface';
  return 'same-origin-embedded';
}

function resolveOwnershipConnectivityPlane({ sdkOwner, consumerSdkOwner }) {
  if (!sdkOwner || !consumerSdkOwner) return null;
  return sdkOwner === consumerSdkOwner ? 'application' : 'platform';
}

function normalizeDeclaredRuntimeMode(mode) {
  if (!mode) return null;
  if (
    mode === 'platform-gateway'
    || mode === 'platform-surface'
    || mode === 'external-via-platform-gateway'
  ) {
    return 'external-via-platform-surface';
  }
  if (mode === 'same-origin-mounted') return 'same-origin-embedded';
  return mode;
}

function baseUrlEnvKey(workspace) {
  const domain = domainFromSdkWorkspace(workspace);
  const surface = surfaceFromWorkspace(workspace);
  if (!domain) return null;
  const domainKey = domain === 'iam' ? 'APPBASE' : domain.toUpperCase().replace(/-/g, '_');
  if (surface === 'backend-api') return `VITE_SDKWORK_${domainKey}_BACKEND_API_BASE_URL`;
  if (surface === 'app-api') return `VITE_SDKWORK_${domainKey}_APP_API_BASE_URL`;
  if (surface === 'internal-api') return `SDKWORK_${domainKey}_INTERNAL_API_BASE_URL`;
  return `VITE_SDKWORK_${domainKey}_OPEN_API_BASE_URL`;
}

function collectConsumerSdkDependencies(repoRoot) {
  const entries = [];
  for (const clientRoot of listClientAppRoots(repoRoot)) {
    for (const core of findCorePackages(clientRoot.appRoot)) {
      for (const dep of normalizeSdkDependencies(core.componentSpec)) {
        entries.push({
          ...dep,
          corePackage: core.componentName,
          coreSurface: core.surface,
          source: toPosix(path.relative(repoRoot, core.componentSpecPath)),
        });
      }
    }
  }

  const repoComponent = readJsonIfExists(path.join(repoRoot, 'specs', 'component.spec.json'));
  if (repoComponent) {
    for (const dep of normalizeSdkDependencies(repoComponent)) {
      entries.push({
        ...dep,
        corePackage: repoComponent.component?.name ?? 'repository-root',
        coreSurface: 'repository',
        source: 'specs/component.spec.json',
      });
    }
  }

  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.workspace}:${entry.corePackage}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function loadCompositionOverrides(repoRoot) {
  const overrides = {};
  for (const clientRoot of listClientAppRoots(repoRoot)) {
    for (const core of findCorePackages(clientRoot.appRoot)) {
      const composition = core.componentSpec?.contracts?.composition;
      if (!composition?.overrides) continue;
      overrides[core.componentName] = composition.overrides;
    }
  }
  const repoComponent = readJsonIfExists(path.join(repoRoot, 'specs', 'component.spec.json'));
  if (repoComponent?.contracts?.composition?.overrides) {
    overrides['repository-root'] = repoComponent.contracts.composition.overrides;
  }
  return overrides;
}

function listCargoTomlFiles(repoRoot) {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_ARCHITECTURE_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.name === 'Cargo.toml') files.push(full);
    }
  };
  walk(repoRoot);
  return files.sort((a, b) => a.localeCompare(b));
}

function buildArchitectureSummary(repoRoot) {
  const componentRecords = listComponentPortBindingSpecs(repoRoot);
  const components = componentRecords.map((record) => {
    const contracts = record.spec.contracts ?? {};
    return {
      name: record.spec.component?.name ?? null,
      type: record.spec.component?.type ?? null,
      root: record.spec.component?.root ?? null,
      domain: record.spec.component?.domain ?? null,
      capability: record.spec.component?.capability ?? null,
      surface: record.spec.component?.surface ?? null,
      languages: record.spec.component?.languages ?? [],
      source: record.relativePath,
      layerRole: contracts.layerRole ?? null,
      publicExports: contracts.publicExports ?? [],
      providedPorts: contracts.providedPorts ?? [],
      requiredPorts: contracts.requiredPorts ?? [],
      sdkDependencies: normalizeSdkDependencies(record.spec),
      routeManifest: contracts.routeManifest ?? null,
      runtimeEntrypoints: contracts.runtimeEntrypoints ?? [],
      dependencyApiSurfaces: contracts.dependencyApiSurfaces ?? [],
    };
  });

  const frontendPackages = [];
  for (const appRoot of listFrontendAppRoots(repoRoot)) {
    for (const pkg of listFrontendPackages(appRoot.appRoot)) {
      frontendPackages.push({
        appRoot: toPosix(path.relative(repoRoot, appRoot.appRoot)),
        architecture: appRoot.architecture?.id ?? null,
        directoryName: pkg.directoryName,
        name: pkg.name,
        role: pkg.role,
      });
    }
  }

  const crates = listCargoTomlFiles(repoRoot)
    .map((cargoPath) => {
      const manifest = parseRustCargoManifest(cargoPath);
      return {
        packageName: manifest.packageName,
        manifest: toPosix(path.relative(repoRoot, cargoPath)),
        dependencies: manifest.dependencies.map((dep) => dep.name),
      };
    })
    .filter((crate) => crate.packageName);

  const routeManifestMap = new Map();
  for (const route of collectRouteRegistry(repoRoot)) {
    if (route.sourceKind !== 'route-manifest') continue;
    const key = route.source;
    const existing = routeManifestMap.get(key) ?? {
      source: route.source,
      packageName: route.routeCrate ?? null,
      surface: route.surface ?? null,
      routeCount: 0,
    };
    existing.routeCount += 1;
    existing.packageName ??= route.routeCrate ?? null;
    existing.surface ??= route.surface ?? null;
    routeManifestMap.set(key, existing);
  }

  const dependencyApiSurfaces = [];
  for (const component of components) {
    for (const surface of component.dependencyApiSurfaces) {
      dependencyApiSurfaces.push({
        component: component.name,
        source: component.source,
        ...surface,
      });
    }
  }

  return {
    components,
    frontend: {
      packages: frontendPackages,
    },
    rust: {
      crates,
    },
    routes: {
      manifests: [...routeManifestMap.values()].sort((a, b) => a.source.localeCompare(b.source)),
    },
    runtime: {
      dependencyApiSurfaces,
    },
  };
}

function findIntegrationOverride(overridesByCore, workspace) {
  for (const overrides of Object.values(overridesByCore)) {
    const integration = overrides?.integrations?.[workspace];
    if (integration) return integration;
  }
  return null;
}

function findVerifiedEmbeddedSurface(architecture, workspace, surface) {
  return architecture.runtime.dependencyApiSurfaces.find((candidate) => {
    if (candidate.sdkFamily !== workspace || candidate.surface !== surface) return false;
    if (!['same-origin', 'same-origin-mounted'].includes(candidate.runtimeMode)) return false;
    if (!candidate.cargoDependency || !candidate.embeddedExecutableExport) return false;
    if (!Array.isArray(candidate.coverageEvidence) || candidate.coverageEvidence.length === 0) return false;
    const cargoDependency = candidate.cargoDependency.replaceAll('_', '-');
    return architecture.rust.crates.some((crate) => crate.dependencies.includes(cargoDependency));
  }) ?? null;
}

export function resolveComposition(repoRoot, options = {}) {
  const issues = [];
  const integrations = [];
  const inheritedManifests = [];
  const env = {};
  let requiresPlatformApiSurface = false;

  const sdkDependencies = collectConsumerSdkDependencies(repoRoot);
  const overridesByCore = loadCompositionOverrides(repoRoot);
  const architecture = buildArchitectureSummary(repoRoot);
  const consumerSdkOwner = loadConsumerSdkOwner(repoRoot);

  if (sdkDependencies.length > 0 && !consumerSdkOwner) {
    issues.push('consumer application SDK owner is missing from sdkwork.app.config.json#app.key');
  }

  for (const dep of sdkDependencies) {
    const workspace = dep.workspace;
    // Platform runtime dependencies (dependencyMode: platform-framework /
    // platform-kernel) are native package linkage, not HTTP API surface
    // consumers. They must not be required to resolve SDK ownership or a
    // connectivity plane, and they contribute no API integration.
    if (isPlatformRuntimeDependency(dep)) continue;
    const sdkFamilyManifest = loadSdkFamilyManifest(repoRoot, workspace);
    const manifestDiscovery = sdkFamilyManifest?.discoverySurface ?? null;
    const dependencyIntegration = loadDependencyIntegration(repoRoot, workspace);
    const legacySurface = loadLegacyDependencySurface(repoRoot, workspace);
    const integrationOverride = findIntegrationOverride(overridesByCore, workspace);

    const surface = dep.surface ?? surfaceFromWorkspace(workspace);
    const embeddedSurface = findVerifiedEmbeddedSurface(architecture, workspace, surface);
    const apiPrefix = embeddedSurface?.apiPrefix ?? defaultPrefix(surface, manifestDiscovery);
    const ownershipConnectivityPlane = resolveOwnershipConnectivityPlane({
      sdkOwner: sdkFamilyManifest?.sdkOwner,
      consumerSdkOwner,
    });
    const connectivityPlane = embeddedSurface
      ? 'application'
      : ownershipConnectivityPlane ?? dependencyIntegration?.defaultConnectivityPlane ?? null;
    const requestedRuntimeMode = normalizeDeclaredRuntimeMode(integrationOverride?.runtimeMode);
    const dependencyOwned = Boolean(
      sdkFamilyManifest?.sdkOwner
      && consumerSdkOwner
      && sdkFamilyManifest.sdkOwner !== consumerSdkOwner,
    );
    let runtimeMode;
    if (embeddedSurface) {
      runtimeMode = 'same-origin-embedded';
    } else if (requestedRuntimeMode === 'same-origin-embedded' && dependencyOwned) {
      issues.push(`${workspace}: dependency-owned same-origin runtime requires verified embedded assembly evidence`);
      runtimeMode = 'external-via-platform-surface';
    } else if (requestedRuntimeMode) {
      runtimeMode = requestedRuntimeMode;
    } else if (dependencyOwned) {
      runtimeMode = 'external-via-platform-surface';
    } else {
      runtimeMode = resolveRuntimeMode({ dependencyIntegration, legacySurface, connectivityPlane });
    }

    if (!sdkFamilyManifest) {
      issues.push(`${workspace}: sdk-manifest.json is required to resolve SDK ownership`);
    } else if (!sdkFamilyManifest.sdkOwner || !sdkFamilyManifest.apiAuthority) {
      issues.push(`${workspace}: sdk-manifest.json must declare sdkOwner and apiAuthority`);
    }
    if (!connectivityPlane) {
      issues.push(`${workspace}: connectivity plane is unresolved without SDK ownership metadata`);
    }
    for (const key of Object.keys(integrationOverride ?? {})) {
      if (!ALLOWED_INTEGRATION_OVERRIDE_KEYS.has(key)) {
        issues.push(`${workspace}: unsupported composition integration override ${key}; only baseUrl and runtimeMode are allowed`);
      }
    }
    if (!RUNTIME_MODES.has(runtimeMode)) {
      issues.push(`${workspace}: unsupported runtimeMode ${runtimeMode}`);
    }
    const permissionManifestRef = resolvePermissionManifestRef(
      repoRoot,
      workspace,
      dependencyIntegration,
    );

    if (permissionManifestRef) {
      inheritedManifests.push({
        workspace,
        manifestRef: permissionManifestRef,
        inheritPermissions: true,
      });
    }

    const envKey = embeddedSurface ? null : baseUrlEnvKey(workspace);
    const mountStatus = embeddedSurface
      ? 'verified'
      : legacySurface?.runtimeIntegration?.mountCoverage?.status ?? null;
    const forbidApplicationSameOriginFallback = runtimeMode === 'external-via-platform-surface'
      && connectivityPlane === 'platform';

    if (runtimeMode === 'external-via-platform-surface') {
      requiresPlatformApiSurface = true;
    }

    if (forbidApplicationSameOriginFallback) {
      integrations.push({
        workspace,
        surface,
        apiPrefix,
        connectivityPlane,
        runtimeMode,
        mountStatus,
        envKey,
        forbidApplicationSameOriginFallback: true,
        sdkOwner: sdkFamilyManifest?.sdkOwner ?? null,
        apiAuthority: sdkFamilyManifest?.apiAuthority ?? null,
        consumerSdkOwner,
        corePackage: dep.corePackage,
        source: dep.source,
      });
      continue;
    }

    integrations.push({
      workspace,
      surface,
      apiPrefix,
      connectivityPlane,
      runtimeMode,
      mountStatus,
      envKey,
      forbidApplicationSameOriginFallback: false,
      sdkOwner: sdkFamilyManifest?.sdkOwner ?? null,
      apiAuthority: sdkFamilyManifest?.apiAuthority ?? null,
      consumerSdkOwner,
      corePackage: dep.corePackage,
      source: dep.source,
    });

    if (integrationOverride?.baseUrl && envKey) {
      env[envKey] = integrationOverride.baseUrl;
    }
  }

  const compositionExempt = isCompositionExemptRepo(repoRoot)
    || listClientAppRoots(repoRoot).some((clientRoot) =>
      findCorePackages(clientRoot.appRoot).some((core) =>
        isCompositionConsumerExempt(core.componentSpec),
      ),
    );

  if (sdkDependencies.length === 0 && !compositionExempt) {
    issues.push('no sdkDependencies found in consumer core component.spec.json files');
  }

  for (const integration of integrations) {
    if (integration.forbidApplicationSameOriginFallback && !integration.envKey) {
      issues.push(`${integration.workspace}: external platform dependency missing env key convention`);
    }
  }

  return {
    schemaVersion: 1,
    kind: 'sdkwork.composition.resolved',
    repository: path.basename(repoRoot),
    integrations,
    permissions: {
      inheritanceMode: 'module-catalog-with-overrides',
      inheritedManifests,
    },
    architecture,
    env,
    requiresPlatformApiSurface,
    issues,
    meta: {
      resolver: 'sdkwork-specs/tools/lib/composition-resolver.mjs',
      credentialModes: Object.fromEntries(
        sdkDependencies.map((dep) => [
          dep.workspace,
          dep.credentialMode ?? defaultCredentialMode(dep.surface ?? surfaceFromWorkspace(dep.workspace)),
        ]),
      ),
    },
  };
}

export function validateCompositionResolution(resolution, {
  observedEnv = {},
  applicationAppApiBaseUrl,
  allowBrowserSameOriginApiEdge = false,
  canonicalRoutePrecedenceVerified = false,
} = {}) {
  const issues = [];

  for (const integration of resolution.integrations ?? []) {
    if (!integration.forbidApplicationSameOriginFallback || !integration.envKey) continue;
    const observed = observedEnv[integration.envKey];
    if (!observed) continue;
    if (applicationAppApiBaseUrl && observed === applicationAppApiBaseUrl) {
      if (!isBrowserSameOriginApiEdgeAllowed(observed, {
        allowBrowserSameOriginApiEdge,
        canonicalRoutePrecedenceVerified,
      })) {
        issues.push(
          `${integration.envKey} must not fall back to application same-origin base URL (${applicationAppApiBaseUrl}); use the declared platform API surface or a verified browser same-origin API edge for ${integration.workspace}`,
        );
      }
    }
    if (observed === '/app/v3/api' && integration.connectivityPlane === 'platform') {
      issues.push(
        `${integration.envKey} must not use application app-api surface path for platform dependency ${integration.workspace}; use an API edge root with canonical route precedence or the declared platform API surface`,
      );
    }
    if (/^\/(?:__sdkwork|proxy|gateway|platform)(?:\/|$)/u.test(String(observed))) {
      issues.push(
        `${integration.envKey} must not expose proxy or gateway selector path ${observed}; client-visible SDK base URLs must preserve canonical API paths for ${integration.workspace}`,
      );
    }
  }

  return issues;
}

export function deriveFoundationEnvFromResolution(resolution, {
  platformApiOrigin,
  applicationAppApiBaseUrl,
  applicationBackendApiBaseUrl,
}) {
  const env = { ...(resolution.env ?? {}) };

  for (const integration of resolution.integrations ?? []) {
    if (!integration.envKey || env[integration.envKey]) continue;

    if (integration.runtimeMode === 'external-via-platform-surface') {
      const prefix = integration.apiPrefix ?? APP_API_PREFIX;
      env[integration.envKey] = `${String(platformApiOrigin).replace(/\/+$/u, '')}${prefix}`;
      continue;
    }

    if (integration.surface === 'backend-api') {
      env[integration.envKey] = applicationBackendApiBaseUrl;
      continue;
    }

    env[integration.envKey] = applicationAppApiBaseUrl;
  }

  return env;
}
