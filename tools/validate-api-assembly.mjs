#!/usr/bin/env node
/**
 * Validate API assembly parity and thin-gateway merge rules.
 * Authority: API_ASSEMBLY_SPEC.md sections 5 and 10, TEST_SPEC.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  assemblyCrateDir,
  buildAssemblyManifest,
  discoverRouteCrates,
  findAuthoredRustHttpRouterEvidence,
  findGatewaySourceFiles,
  readJson,
  readText,
  resolveApplicationCode,
  scanAssemblyInfraMergeViolations,
  scanForbiddenGatewayMerges,
  assemblyMountRouteCrates,
  usesKernelBridgeAssembly,
} from './api-assembly-lib.mjs';
import { classifyRouteRegistry } from './lib/route-registry.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ROOT = path.resolve(SPECS_ROOT, '..');

function usage() {
  return [
    'Usage: node tools/validate-api-assembly.mjs [--root <repo>] [--strict]',
    '',
    'Fails when an application root lacks its assembly crate, route ownership is incomplete,',
    'assembly-manifest.json drifts, or gateway hosts hand-merge sdkwork route crates.',
  ].join('\n');
}

function compareManifests(expected, actual) {
  const errors = [];
  const expectedPackages = expected.routeCrates.map((item) => item.packageName).sort();
  const actualPackages = (actual?.routeCrates ?? []).map((item) => item.packageName).sort();
  if (JSON.stringify(expectedPackages) !== JSON.stringify(actualPackages)) {
    errors.push(
      `assembly-manifest.json route crate list drift (expected ${expectedPackages.length}, got ${actualPackages.length})`,
    );
  }
  if (actual?.packageName && actual.packageName !== expected.packageName) {
    errors.push(`assembly-manifest.json packageName mismatch: ${actual.packageName}`);
  }
  if (actual?.applicationCode !== expected.applicationCode) {
    errors.push(`assembly-manifest.json applicationCode mismatch: expected ${expected.applicationCode}`);
  }
  if (actual?.kind !== 'sdkwork.api.assembly') {
    errors.push('assembly-manifest.json kind must be sdkwork.api.assembly');
  }
  if (actual?.apiMode !== expected.apiMode) {
    errors.push(`assembly-manifest.json apiMode mismatch: expected ${expected.apiMode}`);
  }
  if (actual?.crateDir !== expected.crateDir) {
    errors.push(`assembly-manifest.json crateDir mismatch: expected ${expected.crateDir}`);
  }
  if (Object.hasOwn(actual ?? {}, 'generatedAt')) {
    errors.push('assembly-manifest.json must not contain nondeterministic generatedAt');
  }
  for (const route of actual?.routeCrates ?? []) {
    if (!['app-api', 'backend-api', 'open-api', 'internal-api'].includes(route.surface)) {
      errors.push(`assembly-manifest.json invalid route surface: ${route.surface ?? '<missing>'}`);
    }
    for (const field of ['componentRef', 'routeManifestRef', 'sourceRef']) {
      if (typeof route[field] !== 'string' || !route[field].trim()) {
        errors.push(`assembly-manifest.json ${route.packageName ?? '<route>'} missing ${field}`);
      }
    }
  }
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, normalize(value[key])]),
      );
    }
    return value;
  };
  if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(expected))) {
    errors.push('assembly-manifest.json content drift (run api:assembly:materialize)');
  }
  return errors;
}

const REQUIRED_ASSEMBLY_FIELDS = [
  'router',
  'route_manifest',
  'openapi',
  'permission_catalog',
  'domain_context_injectors',
  'readiness_check',
];

function validateAssemblyContributionContract(crateRoot, bootstrapSource) {
  const errors = [];
  const sharedAlias = /pub\s+type\s+ApiAssembly\s*=\s*(?:sdkwork_web_bootstrap::)?ApiAssemblyContribution\s*;/u
    .test(bootstrapSource);
  const structBody = /pub\s+struct\s+ApiAssembly\s*\{([^}]*)\}/u
    .exec(bootstrapSource)?.[1];
  if (!sharedAlias && !structBody) {
    errors.push(
      'default ApiAssembly export is missing; export the indivisible assembly contribution contract',
    );
    return errors;
  }
  const completeContributionField = structBody
    && /\bpub\s+contribution\s*:\s*(?:sdkwork_web_bootstrap::)?ApiAssemblyContribution\b/u
      .test(structBody);
  if (!sharedAlias && !completeContributionField) {
    const missing = REQUIRED_ASSEMBLY_FIELDS.filter(
      (field) => !new RegExp(`\\bpub\\s+${field}\\s*:`, 'u').test(structBody),
    );
    if (missing.length > 0) {
      errors.push(
        `default ApiAssembly is router-only or incomplete; missing contribution fields: ${missing.join(', ')}`,
      );
    }
  }

  const libSource = readText(path.join(crateRoot, 'src', 'lib.rs'));
  if (!/\bassemble_api_router\b/u.test(libSource)) {
    errors.push('crate root must export assemble_api_router');
  }
  return errors;
}

export function validateApiAssembly(root, { strict = false } = {}) {
  const repositoryName = path.basename(path.resolve(root));
  if (repositoryName === 'sdkwork-api-cloud-gateway') {
    return {
      ok: true,
      skipped: true,
      applicationCode: null,
      message: 'platform cloud gateway consumes application assemblies',
    };
  }

  let applicationCode;
  try {
    applicationCode = resolveApplicationCode(root);
  } catch (error) {
    return {
      ok: false,
      applicationCode: null,
      errors: [error.message],
      warnings: [],
    };
  }
  const routeCrates = discoverRouteCrates(root, applicationCode);
  const crateDir = assemblyCrateDir(applicationCode);
  const crateRoot = path.join(root, crateDir);
  if (
    routeCrates.length === 0
    && !fs.existsSync(path.join(root, 'agent.app.config.json'))
    && !fs.existsSync(crateRoot)
  ) {
    return { ok: true, skipped: true, applicationCode, message: 'no route crates' };
  }

  const errors = [];
  const warnings = [];
  if (routeCrates.length === 0) {
    const authoredHttpRouters = findAuthoredRustHttpRouterEvidence(root, applicationCode);
    if (authoredHttpRouters.length > 0) {
      errors.push(
        `apiMode none contradicts executable authored HTTP routing in ${authoredHttpRouters.join(', ')}; `
        + 'migrate the routes into canonical sdkwork-routes-<capability>-{open,app,backend,internal}-api crates',
      );
    }
  }
  for (const routeCrate of routeCrates) {
    if (!routeCrate.hasComponentSpec) {
      errors.push(`${routeCrate.memberDir} missing specs/component.spec.json ownership contract`);
    }
    if (!routeCrate.routeManifestInsideRoot) {
      errors.push(
        `${routeCrate.packageName} route manifest escapes the application root: ${routeCrate.routeManifestRef}`,
      );
    } else if (!routeCrate.routeManifestExists) {
      errors.push(
        `${routeCrate.packageName} route manifest does not exist: ${routeCrate.routeManifestRef}`,
      );
    }
    if (!routeCrate.packageName.match(/-(?:http-auth|http-shared|shared|support)$/u)
      && routeCrate.hasDescriptorOnlyGatewayMount) {
      errors.push(
        `${routeCrate.packageName} gateway_mount is descriptor-only (Router::new()); `
        + 'served route crates must mount executable handlers',
      );
    } else if (!routeCrate.packageName.match(/-(?:http-auth|http-shared|shared|support)$/u)
      && routeCrate.hasDelegatedDescriptorOnlyGatewayMount) {
      errors.push(
        `${routeCrate.packageName} gateway_mount resolves through delegated builders to Router::new(); `
        + 'served route crates must mount executable handlers',
      );
    } else if (!routeCrate.packageName.match(/-(?:http-auth|http-shared|shared|support)$/u)
      && routeCrate.hasGatewayMount
      && !routeCrate.hasExecutableGatewayMount) {
      errors.push(
        `${routeCrate.packageName} gateway_mount returns ${routeCrate.gatewayMountReturn ?? '<missing>'}; `
        + 'served route crates must return an executable axum::Router (directly or through Result)',
      );
    }
  }
  if (!fs.existsSync(crateRoot)) {
    errors.push(`missing ${crateDir}`);
    return { ok: false, applicationCode, errors, warnings };
  }

  const manifestPath = path.join(crateRoot, 'assembly-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    errors.push(`missing ${crateDir}/assembly-manifest.json (run api:assembly:materialize)`);
  } else {
    const expected = buildAssemblyManifest(root, applicationCode, routeCrates);
    try {
      const actual = readJson(manifestPath);
      errors.push(...compareManifests(expected, actual));
    } catch (error) {
      errors.push(`invalid ${crateDir}/assembly-manifest.json: ${error.message}`);
    }
  }

  const bootstrapPath = path.join(crateRoot, 'src', 'bootstrap.rs');
  const bootstrapSource = readText(bootstrapPath);
  if (routeCrates.length > 0) {
    errors.push(...validateAssemblyContributionContract(crateRoot, bootstrapSource));
  }
  if (routeCrates.length === 0) {
    const staleRouteReferences = [
      ...new Set(bootstrapSource.match(/sdkwork_routes_[a-z0-9_]+/gu) ?? []),
    ];
    if (staleRouteReferences.length > 0) {
      errors.push(
        `apiMode none assembly bootstrap references undeclared route crates: ${staleRouteReferences.join(', ')}`,
      );
    }
  }

  const withoutMount = assemblyMountRouteCrates(routeCrates).filter(
    (crate) => !crate.hasGatewayMount && !bootstrapSource.includes(crate.libName),
  );
  const kernelBridge = usesKernelBridgeAssembly(bootstrapSource);
  if (withoutMount.length > 0 && !kernelBridge) {
    warnings.push(
      `${withoutMount.length} route crates missing gateway_mount: ${withoutMount
        .map((crate) => crate.packageName)
        .join(', ')}`,
    );
  } else if (withoutMount.length > 0 && kernelBridge) {
    warnings.push(
      `${withoutMount.length} route crates use kernel-bridge composition instead of gateway_mount (approved for sdkwork-agents)`,
    );
  }

  const gatewayFiles = findGatewaySourceFiles(root, applicationCode);
  const mergeHits = scanForbiddenGatewayMerges(gatewayFiles, crateDir);
  for (const hit of mergeHits) {
    errors.push(`forbidden hand route merge in gateway source: ${hit}`);
  }

  if (bootstrapSource.trim()) {
    errors.push(...scanAssemblyInfraMergeViolations(bootstrapSource, routeCrates));
  }

  errors.push(...classifyRouteRegistry(root).map((issue) => `${issue.kind}: ${issue.detail}`));

  if (strict && warnings.length > 0) {
    errors.push(...warnings.map((warning) => `strict: ${warning}`));
  }

  return {
    ok: errors.length === 0,
    applicationCode,
    routeCrates: routeCrates.length,
    errors,
    warnings,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: DEFAULT_ROOT },
      strict: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const root = path.resolve(values.root);
  const result = validateApiAssembly(root, { strict: values.strict });
  if (result.skipped) {
    console.log(`api-assembly:validate skipped for ${root} (${result.message})`);
    process.exit(0);
  }

  for (const warning of result.warnings) {
    console.warn(`warning: ${warning}`);
  }

  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`error: ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `api-assembly:validate passed for sdkwork-api-${result.applicationCode}-assembly (${result.routeCrates} route crates)`,
  );
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  main();
}
