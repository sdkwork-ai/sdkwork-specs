// Workspace CORS carrier discovery (CORS_SPEC.md section 6).
//
// A carrier is an env file that materialises an allowlist for one deployment
// profile. Only `etc/topology` profiles are topology-derived; deploy-bundle env
// directories are scanned for console-host pattern and scheme invariants.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import {
  CORS_CONSOLE_HOST_ENV_KEYS,
  CORS_MODULE_GATEWAY_ORIGINS_ENV_KEY,
  CORS_SHARED_ORIGINS_ENV_KEY,
  CORS_ORIGIN_KEY,
  LIFECYCLE_ENVIRONMENTS,
  browserBindValuesFromEnv,
  canonicalCorsOrigins,
  inspectCorsOrigins,
  inspectPlainOrigins,
  isProductionLikeEnvironment,
  profileIdParts,
  registeredEnvironmentSuffix,
  splitOrigins,
} from './registry.mjs';
import { parseEnvDocument } from './env-file.mjs';

/** Env directories that hold CORS carriers, in scan order. */
export const CARRIER_DIRS = Object.freeze([
  'etc/topology',
  'docker/env',
  'deployments/docker/env',
]);

const DEPLOYMENT_PROFILES = new Set(['standalone', 'cloud']);

/** Canonical repository-level gate script that audits this repository's carriers. */
export const CORS_GATE_SCRIPT = 'check:cors-standard';

/** Aggregates, in preference order, that may host the CORS gate step. */
export const CORS_GATE_ANCHORS = Object.freeze(['_sdkwork:verify', 'verify', 'check']);

/** A carrier is either a deployment value file or its source-controlled template. */
export function isCarrierFileName(fileName) {
  return fileName.endsWith('.env') || fileName.endsWith('.env.example');
}

/**
 * Resolve the deployment profile and environment of a carrier file name.
 *
 * `standalone.production.env`       → standalone / production
 * `production.env` / `.env.example` → (none) / production
 * `production.i1.env`               → (none) / production   (instance variant)
 */
export function profileFromFileName(fileName) {
  const stem = fileName.endsWith('.env.example')
    ? fileName.slice(0, -'.env.example'.length)
    : fileName.endsWith('.env') ? fileName.slice(0, -'.env'.length) : null;
  if (stem === null) return null;
  const segments = stem.split('.');
  if (segments.length === 0 || segments[0] === '') return null;
  const last = segments[segments.length - 1];
  if (LIFECYCLE_ENVIRONMENTS.includes(last)) {
    const previous = segments.length >= 2 ? segments[segments.length - 2] : null;
    return {
      deploymentProfile: previous && DEPLOYMENT_PROFILES.has(previous) ? previous : null,
      environment: last,
      variant: previous && !DEPLOYMENT_PROFILES.has(previous) ? previous : null,
    };
  }
  // Instance-variant naming: the lifecycle environment is not the last segment.
  const environment = segments.find((segment) => LIFECYCLE_ENVIRONMENTS.includes(segment));
  if (!environment) return null;
  const deploymentProfile = segments.find((segment) => DEPLOYMENT_PROFILES.has(segment)) ?? null;
  return {
    deploymentProfile,
    environment,
    variant: segments.filter((segment) => segment !== environment && segment !== deploymentProfile).join('.') || null,
  };
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function readTopology(moduleDir) {
  const path = join(moduleDir, 'specs', 'topology.spec.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Browser-facing surfaces the topology publishes, i.e. surfaces that own origins. */
export function browserFacingSurfaces(topology) {
  const hosts = topology?.cloudPublicHosts ?? {};
  const owned = [];
  for (const surfaceId of [
    'application.public-ingress',
    'application.app-http',
    'application.backend-http',
    'application.admin-http',
    'application.open-http',
    'edge.device-ingress',
  ]) {
    if (hosts[surfaceId]) owned.push(surfaceId);
  }
  return owned;
}

/**
 * Collect the CORS carriers of one module directory, in scan order.
 * `relativeBase` only shapes the reported `relativePath`; a per-repository gate
 * passes the module root so messages read `etc/topology/production.env`.
 */
export function collectCarriers(moduleDir, relativeBase = moduleDir) {
  const carriers = [];
  for (const dir of CARRIER_DIRS) {
    const abs = join(moduleDir, dir);
    if (!isDirectory(abs)) continue;
    for (const file of readdirSync(abs).sort()) {
      if (!isCarrierFileName(file)) continue;
      const isTemplate = file.endsWith('.env.example');
      carriers.push({
        kind: dir === 'etc/topology' ? 'topology' : isTemplate ? 'template' : 'bundle',
        dir,
        fileName: file,
        template: isTemplate,
        absolutePath: join(abs, file),
        relativePath: relative(relativeBase, join(abs, file)).split('\\').join('/'),
      });
    }
  }
  return carriers;
}

/**
 * Build the module record for a single application root, or `null` when the
 * directory holds no carrier at all. This is the unit a per-repository gate
 * audits, so it must not depend on a sibling workspace layout.
 */
export function readModule(moduleDir, options = {}) {
  const dir = resolve(moduleDir);
  if (!isDirectory(dir)) return null;
  const carriers = collectCarriers(dir, options.relativeBase ?? dir);
  if (carriers.length === 0) return null;
  const topology = readTopology(dir);
  return {
    name: options.name ?? basename(dir),
    moduleDir: dir,
    topologyPath: join(dir, 'specs', 'topology.spec.json'),
    topology,
    ownedSurfaces: browserFacingSurfaces(topology),
    carriers,
    scripts: readScripts(dir),
  };
}

/** `package.json` scripts of one repository, or `null` when it has no manifest. */
export function readScripts(moduleDir) {
  const manifestPath = join(moduleDir, 'package.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')).scripts ?? {};
  } catch {
    return null;
  }
}

/** Whether a repository declares the CORS gate and references it from an aggregate. */
export function corsGateState(scripts) {
  if (scripts === null) return { declared: false, anchor: null, hasAggregate: false };
  return {
    declared: typeof scripts[CORS_GATE_SCRIPT] === 'string' && scripts[CORS_GATE_SCRIPT].trim() !== '',
    anchor: CORS_GATE_ANCHORS.find(
      (name) => typeof scripts[name] === 'string' && scripts[name].includes(CORS_GATE_SCRIPT),
    ) ?? null,
    hasAggregate: CORS_GATE_ANCHORS.some(
      (name) => typeof scripts[name] === 'string' && scripts[name].trim() !== '',
    ),
  };
}

/**
 * Module-level conformance of the per-repository gate. A repository that
 * materialises an allowlist must be able to fail its own build when the
 * allowlist drifts, so the gate is required wherever an aggregate can host it.
 * A repository without any verify aggregate is a PNPM_SCRIPT_SPEC gap, reported
 * as a warning because the workspace gate still audits its carriers.
 */
export function auditGateWiring(modules) {
  const issues = [];
  for (const module of modules) {
    const state = corsGateState(module.scripts);
    if (state.declared && state.anchor !== null) continue;
    if (module.scripts === null) {
      issues.push({
        module: module.name,
        level: 'warning',
        message: `${module.name}: no package.json, so ${CORS_GATE_SCRIPT} cannot run in this repository`,
      });
      continue;
    }
    if (!state.hasAggregate) {
      issues.push({
        module: module.name,
        level: 'warning',
        message: `${module.name}: no ${CORS_GATE_ANCHORS.join('/')} aggregate to host ${CORS_GATE_SCRIPT}; see PNPM_SCRIPT_SPEC.md`,
      });
      continue;
    }
    const head = state.declared
      ? `${CORS_GATE_SCRIPT} is declared but never referenced`
      : `${CORS_GATE_SCRIPT} is missing`;
    issues.push({
      module: module.name,
      level: 'error',
      message: `${module.name}: ${head}; declare "node ../sdkwork-specs/tools/check-cors-standard.mjs --root ." `
        + `and reference it from ${CORS_GATE_ANCHORS.join('/')}`,
    });
  }
  return issues;
}

/**
 * Discover every module that has any carrier directory.
 * Returns modules in stable name order.
 */
export function discoverModules(workspaceRoot) {
  const root = resolve(workspaceRoot);
  if (!isDirectory(root)) return [];
  const modules = [];
  for (const name of readdirSync(root).sort()) {
    if (!name.startsWith('sdkwork-')) continue;
    const module = readModule(join(root, name), { name, relativeBase: root });
    if (module) modules.push(module);
  }
  return modules;
}

/** Console host pattern keys found in a parsed document. */
export function consoleKeysOf(document) {
  const found = {};
  for (const [field, key] of Object.entries(CORS_CONSOLE_HOST_ENV_KEYS)) {
    const entry = document.byKey.get(key);
    if (entry) found[field] = entry.value;
  }
  return found;
}

/**
 * Keys this spec recognises. Everything else that looks like a CORS key is
 * either a retired application-scoped allowlist or an ad-hoc module mechanism
 * that must migrate to the shared key or the console host pattern.
 */
const CANONICAL_CORS_KEYS = new Set([
  CORS_SHARED_ORIGINS_ENV_KEY,
  CORS_MODULE_GATEWAY_ORIGINS_ENV_KEY,
  'GATEWAY_CORS_ALLOWED_ORIGINS',
  ...Object.values(CORS_CONSOLE_HOST_ENV_KEYS),
]);

export function isCanonicalCorsKey(key) {
  if (CANONICAL_CORS_KEYS.has(key)) return true;
  if (key.startsWith('SDKWORK_MODULE_API_GATEWAY_')) return true;
  if (key.startsWith('GATEWAY_CORS_CONSOLE_HOST_')) return true;
  return false;
}

/**
 * Expected console host pattern of one environment.
 * Production carries no suffix and `https` only.
 */
export function expectedConsolePattern(environment) {
  return {
    suffix: registeredEnvironmentSuffix(environment),
    schemes: environment === 'production' ? 'https' : 'http,https',
  };
}

/**
 * Audit one carrier file.
 *
 * `topology` carriers are derived from §4 and must match exactly.
 * `bundle` carriers are not topology-derived: they are checked for the console
 * host pattern invariants, for retired keys, and for loopback leakage into a
 * production-like environment.
 */
export function auditCarrier(module, carrier, options = {}) {
  const { baseDomains } = options;
  const text = readFileSync(carrier.absolutePath, 'utf8');
  const document = parseEnvDocument(text);
  const errors = [];
  const warnings = [];

  const profile = profileFromFileName(carrier.fileName);
  const deploymentProfile = profile?.deploymentProfile ?? null;
  const environment = profile?.environment ?? null;
  if (!profile) {
    errors.push(`${carrier.relativePath}: file name must be <environment>.env or <deployment-profile>.<environment>.env`);
    return { carrier, profileId: carrier.fileName, environment: null, errors, warnings, canonical: null, origins: [] };
  }
  // A bundle carrier declares only an environment; the origin set depends on the
  // environment alone, so resolve it under the standalone matrix by default and
  // keep the declared name for reporting.
  const profileId = deploymentProfile ? `${deploymentProfile}.${environment}` : `standalone.${environment}`;
  const declaredProfileId = deploymentProfile ? profileId : environment;
  const parts = profileIdParts(profileId);
  if (!parts) {
    errors.push(`${carrier.relativePath}: file name must be <environment>.env or <deployment-profile>.<environment>.env`);
    return { carrier, profileId: declaredProfileId, environment, errors, warnings, canonical: null, origins: [] };
  }

  const corsKeys = [...document.byKey.keys()].filter((key) => CORS_ORIGIN_KEY.test(key));
  for (const key of corsKeys) {
    if (key === CORS_SHARED_ORIGINS_ENV_KEY) continue;
    if (isCanonicalCorsKey(key)) {
      // A canonical non-shared allowlist (gateway sidecar, module-gateway attach,
      // host-side GATEWAY_* prefix) is not derived here, but its entries must
      // still be structurally valid for the environment.
      if (!/_CONSOLE_HOST_/u.test(key)) {
        errors.push(...inspectPlainOrigins(splitOrigins(document.byKey.get(key).value), parts.environment)
          .map((issue) => `${carrier.relativePath}: ${key}: ${issue}`));
      }
      continue;
    }
    if (key.startsWith('SDKWORK_') && /_ALLOWED_ORIGINS$/u.test(key)) {
      errors.push(`${carrier.relativePath}: retired application-scoped key ${key}; use ${CORS_SHARED_ORIGINS_ENV_KEY}`);
    } else {
      warnings.push(`${carrier.relativePath}: non-canonical CORS key ${key}`);
    }
  }

  const consoleKeys = consoleKeysOf(document);
  if (Object.keys(consoleKeys).length > 0) {
    const expected = expectedConsolePattern(parts.environment);
    if (consoleKeys.suffix !== undefined && consoleKeys.suffix !== expected.suffix) {
      errors.push(`${carrier.relativePath}: ${CORS_CONSOLE_HOST_ENV_KEYS.suffix} must be ${JSON.stringify(expected.suffix)} in ${parts.environment}`);
    }
    if (consoleKeys.schemes !== undefined && consoleKeys.schemes !== expected.schemes) {
      errors.push(`${carrier.relativePath}: ${CORS_CONSOLE_HOST_ENV_KEYS.schemes} must be ${expected.schemes} in ${parts.environment}`);
    }
    const declared = ['labels', 'suffix', 'schemes'].filter((field) => consoleKeys[field] !== undefined);
    if (declared.length > 0 && declared.length < 3) {
      errors.push(`${carrier.relativePath}: console host pattern is fail-closed; declare labels, suffix and schemes together (found ${declared.join(', ')})`);
    }
  }

  const rawValue = document.byKey.get(CORS_SHARED_ORIGINS_ENV_KEY)?.value ?? null;
  const origins = rawValue === null ? [] : splitOrigins(rawValue);
  const required = carrier.kind === 'topology' && moduleOwnsBrowserSurface(module, parts.deploymentProfile);
  const bindValues = browserBindValuesFromEnv(Object.fromEntries(document.entries.map((e) => [e.key, e.value])));
  const canonical = (required || origins.length > 0)
    ? canonicalCorsOrigins(module.topology, profileId, { existingOrigins: origins, baseDomains, loopbackBindValues: bindValues })
    : null;

  if (rawValue === null) {
    if (required) {
      errors.push(`${carrier.relativePath}: missing ${CORS_SHARED_ORIGINS_ENV_KEY} for profile ${declaredProfileId}`);
    }
    if (Object.keys(consoleKeys).length === 0) {
      if (required) {
        errors.push(`${carrier.relativePath}: no CORS carrier at all (neither an exact allowlist nor a console host pattern)`);
      } else {
        warnings.push(`${carrier.relativePath}: no CORS carrier; correct only when the file is a partial override or the profile has no browser-facing surface`);
      }
    }
    return { carrier, profileId: declaredProfileId, environment: parts.environment, errors, warnings, canonical, origins, required };
  }

  if (required || origins.length > 0) {
    errors.push(...inspectCorsOrigins(origins, module.topology, profileId, {
      baseDomains,
      loopbackBindValues: bindValues,
      checkOrder: true,
    }).map((issue) => `${carrier.relativePath}: ${issue}`));
  }

  return {
    carrier,
    profileId: declaredProfileId,
    environment: parts.environment,
    errors,
    warnings,
    canonical,
    origins,
    required,
    productionLike: isProductionLikeEnvironment(parts.environment),
  };
}

/**
 * A module owns browser-facing surfaces in a deployment profile when the
 * topology declares at least one browser-facing `cloudPublicHosts` entry and the
 * profile is part of the declared matrix. A module with only
 * `platform.api-gateway` serves no origin of its own and needs no allowlist.
 */
export function moduleOwnsBrowserSurface(module, deploymentProfile) {
  if (module.ownedSurfaces.length === 0) return false;
  if (deploymentProfile === null) return true;
  const profiles = module.topology?.orchestration?.profiles;
  if (!profiles || typeof profiles !== 'object') return true;
  return Object.keys(profiles).some((id) => id.startsWith(`${deploymentProfile}.`));
}

/** Full workspace audit. */
export function auditWorkspace(workspaceRoot, options = {}) {
  const modules = discoverModules(workspaceRoot);
  const results = [];
  for (const module of modules) {
    for (const carrier of module.carriers) {
      results.push({ module, ...auditCarrier(module, carrier, options) });
    }
  }
  return { modules, results, wiring: auditGateWiring(modules) };
}

/**
 * Audit exactly one application root. Returns `{ module: null, results: [] }`
 * when the directory carries no allowlist, which a per-repository gate reports
 * as "this repository has no CORS carrier" rather than a failure.
 */
export function auditModule(moduleDir, options = {}) {
  const module = readModule(moduleDir, options);
  if (module === null) return { module: null, results: [] };
  return {
    module,
    results: module.carriers.map((carrier) => ({ module, ...auditCarrier(module, carrier, options) })),
  };
}
