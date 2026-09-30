#!/usr/bin/env node
/**
 * Materialize sdkwork-api-<application-code>-assembly from workspace discovery.
 * Authority: API_ASSEMBLY_SPEC.md sections 4-7.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  assemblyCrateDir,
  assemblyPackageName,
  buildAssemblyManifest,
  discoverGatewayBusinessMounts,
  discoverGatewayMounts,
  discoverRouteCrates,
  readText,
  resolveApplicationCode,
} from './api-assembly-lib.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ROOT = path.resolve(SPECS_ROOT, '..');

function usage() {
  return [
    'Usage: node tools/materialize-api-assembly.mjs [--root <repo>]',
    '',
    'Discovers every application-owned app/backend/open/internal route crate from component ownership',
    'and Cargo workspace evidence, including capability-named route crates, then writes',
    'crates/sdkwork-api-<application-code>-assembly/assembly-manifest.json plus',
    'generated Cargo.toml when the assembly crate does not yet exist.',
  ].join('\n');
}

function writeFileEnsuringDir(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function extractPreservedDependencies(cargoToml, applicationCode, routePackageNames = new Set()) {
  const depsSection = /\[dependencies\]([\s\S]*?)(?:\n\[|$)/u.exec(cargoToml);
  if (!depsSection) {
    return '';
  }
  return depsSection[1]
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return false;
      }
      if (/^\s*axum(?:\.workspace)?\s*=/u.test(line)) {
        return false;
      }
      if (/^\s*tokio(?:\.workspace)?\s*=/u.test(line)) {
        return false;
      }
      const dependencyKey = /^\s*([^\s#=]+?)(?:\.workspace)?\s*=/u.exec(line)?.[1];
      if (dependencyKey && routePackageNames.has(dependencyKey)) {
        return false;
      }
      return true;
    })
    .join('\n');
}

function extractPreservedBuildDependencies(cargoToml) {
  const section = /\[build-dependencies\]([\s\S]*?)(?:\n\[|$)/u.exec(cargoToml);
  return section
    ? section[1].split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
    : '';
}

function extractPreservedDevDependencies(cargoToml) {
  const section = /\[dev-dependencies\]([\s\S]*?)(?:\n\[|$)/u.exec(cargoToml);
  return section
    ? section[1].split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
    : '';
}

function dedupeDependencyLines(lines) {
  const seen = new Set();
  const result = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const key = /^([^\s#=]+?)(?:\.workspace)?\s*=/u.exec(trimmed)?.[1];
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    result.push(trimmed);
  }
  return result;
}

function readWorkspacePackageFields(repoRoot) {
  const cargoPath = path.join(repoRoot, 'Cargo.toml');
  if (!fs.existsSync(cargoPath)) {
    return {};
  }
  const raw = fs.readFileSync(cargoPath, 'utf8').replace(/^\uFEFF/u, '');
  const fields = {};
  const section = raw.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/u);
  if (!section) {
    return fields;
  }
  for (const line of section[1].split('\n')) {
    const match = line.match(/^([\w-]+)\s*=/u);
    if (match) {
      fields[match[1]] = true;
    }
  }
  return fields;
}

function resolveAssemblyBootstrapDeps(mounts, workspaceDepNames) {
  const lines = [];
  const withMount = mounts.filter((item) => item.mount);
  const paramBlob = withMount.map((item) => item.mount.params).join(',');
  if (paramBlob.includes('sqlx::AnyPool') && workspaceDepNames.has('sqlx')) {
    lines.push('sqlx.workspace = true');
  }
  if (paramBlob.includes('AccountServiceHost')) {
    if (workspaceDepNames.has('sdkwork-account-service-host')) {
      lines.push('sdkwork-account-service-host = { workspace = true }');
    }
  }
  return lines;
}

function readWorkspaceDependencyNames(repoRoot) {
  const cargoPath = path.join(repoRoot, 'Cargo.toml');
  if (!fs.existsSync(cargoPath)) {
    return new Set();
  }
  const raw = fs.readFileSync(cargoPath, 'utf8').replace(/^\uFEFF/u, '');
  const section = raw.match(/\[workspace\.dependencies\]([\s\S]*?)(?:\n\[|$)/u);
  if (!section) {
    return new Set();
  }
  const names = new Set();
  for (const line of section[1].split('\n')) {
    const match = line.match(/^([^\s#=]+)\s*=/u);
    if (match) {
      names.add(match[1]);
    }
  }
  return names;
}

function renderCargoToml(
  applicationCode,
  routeCrates,
  preservedDeps = '',
  workspaceFields = {},
  bootstrapDeps = [],
  workspaceDepNames = new Set(),
  preservedBuildDeps = '',
  preservedDevDeps = '',
) {
  const packageName = assemblyPackageName(applicationCode);
  const licenseLine = workspaceFields.license ? 'license.workspace = true\n' : '';
  const editionLine = workspaceFields.edition ? 'edition.workspace = true' : 'edition = "2021"';
  const versionLine = workspaceFields.version ? 'version.workspace = true' : 'version = "0.1.0"';
  const rustVersionLine = workspaceFields['rust-version'] ? 'rust-version.workspace = true\n' : '';
  const depLines = routeCrates
    .map((crate) => {
      const relPath = path.posix.relative(assemblyCrateDir(applicationCode), crate.memberDir);
      if (workspaceDepNames.has(crate.packageName)) {
        return `${crate.packageName}.workspace = true`;
      }
      return `${crate.packageName} = { path = "${relPath}" }`;
    })
    .join('\n');
  const tokioLine = workspaceDepNames.has('tokio')
    ? 'tokio.workspace = true'
    : 'tokio = { version = "1.48", features = ["macros", "rt-multi-thread"] }';
  const axumLine = workspaceDepNames.has('axum') ? 'axum.workspace = true' : 'axum = "0.8"';
  const webBootstrapLine = workspaceDepNames.has('sdkwork-web-bootstrap')
    ? 'sdkwork-web-bootstrap.workspace = true'
    : 'sdkwork-web-bootstrap = { path = "../../../sdkwork-web-framework/crates/sdkwork-web-bootstrap" }';
  const webCoreLine = workspaceDepNames.has('sdkwork-web-core')
    ? 'sdkwork-web-core.workspace = true'
    : 'sdkwork-web-core = { path = "../../../sdkwork-web-framework/crates/sdkwork-web-core" }';
  const dependencyLines = dedupeDependencyLines([
    axumLine,
    tokioLine,
    webBootstrapLine,
    webCoreLine,
    ...bootstrapDeps,
    ...preservedDeps.split('\n'),
    ...depLines.split('\n'),
  ]).join('\n');

  const extraSections = [
    preservedDevDeps ? `[dev-dependencies]\n${preservedDevDeps}` : '',
    preservedBuildDeps ? `[build-dependencies]\n${preservedBuildDeps}` : '',
  ].filter(Boolean).join('\n\n');

  return `[package]
name = "${packageName}"
${rustVersionLine}${editionLine}
${licenseLine}${versionLine}
description = "Generated API assembly for sdkwork-${applicationCode} application HTTP plane."

[lints]
workspace = true

[lib]
name = "${packageName.replace(/-/gu, '_')}"
path = "src/lib.rs"

[dependencies]
${dependencyLines}${extraSections ? `\n\n${extraSections}` : ''}
`;
}

function renderLibRs(applicationCode, routeCrates, bootstrapExists, bootstrapSource = '') {
  if (bootstrapExists) {
    const exports = [
      /pub\s+(?:async\s+)?fn\s+assemble_api_business_router\b/u.test(bootstrapSource)
        ? 'assemble_api_business_router'
        : null,
      'assemble_api_router',
      'ApiAssembly',
      /pub\s+struct\s+ApiAssemblyContext\b/u.test(bootstrapSource)
        ? 'ApiAssemblyContext'
        : null,
      /pub\s+(?:async\s+)?fn\s+assemble_app_api_contribution\b/u.test(bootstrapSource)
        ? 'assemble_app_api_contribution'
        : null,
      /pub\s+(?:async\s+)?fn\s+assemble_backend_api_contribution\b/u.test(bootstrapSource)
        ? 'assemble_backend_api_contribution'
        : null,
      /pub\s+(?:async\s+)?fn\s+assemble_open_api_contribution\b/u.test(bootstrapSource)
        ? 'assemble_open_api_contribution'
        : null,
      /pub\s+(?:async\s+)?fn\s+assemble_internal_api_contribution\b/u.test(bootstrapSource)
        ? 'assemble_internal_api_contribution'
        : null,
      /pub\s+(?:async\s+)?fn\s+assemble_business_routes\b/u.test(bootstrapSource)
        ? 'assemble_business_routes'
        : null,
      /pub\s+struct\s+DomainCertificateBlocks\b/u.test(bootstrapSource)
        ? 'DomainCertificateBlocks'
        : null,
      /pub\s+(?:async\s+)?fn\s+assemble_domain_certificate_blocks\b/u.test(bootstrapSource)
        ? 'assemble_domain_certificate_blocks'
        : null,
      /pub\s+(?:async\s+)?fn\s+migrate_database_from_env\b/u.test(bootstrapSource)
        ? 'migrate_database_from_env'
        : null,
    ].filter(Boolean).join(', ');
    return `//! API assembly for sdkwork-${applicationCode}.
//! Application bootstrap lives in \`bootstrap.rs\`; route inventory is in \`assembly-manifest.json\`.

mod bootstrap;
mod generated;

pub use bootstrap::{${exports}};

pub fn assembly_route_count() -> usize {
    generated::ROUTE_CRATE_COUNT
}
`;
  }

  const mountLines = routeCrates
    .filter((crate) => crate.hasGatewayMount)
    .map((crate) => `    router = router.merge(${crate.libName}::gateway_mount());`)
    .join('\n');

  if (mountLines) {
    return `//! Generated API assembly for sdkwork-${applicationCode}.

mod generated;

pub struct ApiAssembly {
    pub router: axum::Router,
}

pub async fn assemble_api_router() -> ApiAssembly {
    let mut router = axum::Router::new();
${mountLines}
    ApiAssembly { router }
}

pub fn assembly_route_count() -> usize {
    generated::ROUTE_CRATE_COUNT
}
`;
  }

  return `//! API assembly scaffold for sdkwork-${applicationCode}.
//! Implement \`bootstrap.rs\` with application-specific service wiring until every route crate exports \`gateway_mount\`.

mod bootstrap;
mod generated;

pub use bootstrap::{assemble_api_router, ApiAssembly};

pub fn assembly_route_count() -> usize {
    generated::ROUTE_CRATE_COUNT
}
`;
}

function renderGeneratedRs(routeCrates) {
  const names = routeCrates.map((crate) => `    "${crate.packageName}",`).join('\n');
  const packages = names ? `&[\n${names}\n]` : '&[]';
  return `//! Generated route inventory. Do not edit by hand; run pnpm api:assembly:materialize.

pub const ROUTE_CRATE_COUNT: usize = ${routeCrates.length};

#[allow(dead_code)]
pub const ROUTE_CRATE_PACKAGES: &[&str] = ${packages};
`;
}

function ensureAssemblyComponentSpecs(root, applicationCode) {
  const packageName = assemblyPackageName(applicationCode);
  const crateDir = assemblyCrateDir(applicationCode);
  const specsDir = path.join(root, crateDir, 'specs');
  const componentPath = path.join(specsDir, 'component.spec.json');
  const readmePath = path.join(specsDir, 'README.md');

  if (!fs.existsSync(componentPath)) {
    const component = {
      schemaVersion: 1,
      kind: 'sdkwork.component.spec',
      component: {
        name: packageName,
        displayName: `SDKWork ${applicationCode} API Assembly`,
        version: '0.1.0',
        type: 'rust-api-assembly',
        root: `${path.basename(root)}/${crateDir}`,
        domain: 'application',
        capability: 'api-assembly',
        surface: 'api-assembly',
        languages: ['rust'],
        generated: false,
        manifests: ['Cargo.toml', 'assembly-manifest.json'],
      },
      canonicalSpecs: [
        {
          file: 'COMPONENT_SPEC.md',
          path: '../../../sdkwork-specs/COMPONENT_SPEC.md',
          purpose: 'Component identity, layer role, ports, and integration contract rules.',
        },
        {
          file: 'API_ASSEMBLY_SPEC.md',
          path: '../../../sdkwork-specs/API_ASSEMBLY_SPEC.md',
          purpose: 'API ownership, host-neutral composition, and verification rules.',
        },
        {
          file: 'APPLICATION_GATEWAY_SPEC.md',
          path: '../../../sdkwork-specs/APPLICATION_GATEWAY_SPEC.md',
          purpose: 'Standalone and cloud gateway host boundaries.',
        },
        {
          file: 'WEB_FRAMEWORK_SPEC.md',
          path: '../../../sdkwork-specs/WEB_FRAMEWORK_SPEC.md',
          purpose: 'Typed request context and HTTP framework composition rules.',
        },
        {
          file: 'DATABASE_FRAMEWORK_SPEC.md',
          path: '../../../sdkwork-specs/DATABASE_FRAMEWORK_SPEC.md',
          purpose: 'Database lifecycle bootstrap ownership for embedded assemblies.',
        },
        {
          file: 'APP_RUNTIME_TOPOLOGY_SPEC.md',
          path: '../../../sdkwork-specs/APP_RUNTIME_TOPOLOGY_SPEC.md',
          purpose: 'Standalone and cloud host topology ownership.',
        },
        {
          file: 'CODE_STYLE_SPEC.md',
          path: '../../../sdkwork-specs/CODE_STYLE_SPEC.md',
          purpose: 'Authored source and generated artifact boundaries.',
        },
        {
          file: 'NAMING_SPEC.md',
          path: '../../../sdkwork-specs/NAMING_SPEC.md',
          purpose: 'Canonical API assembly package and export naming.',
        },
        {
          file: 'RUST_CODE_SPEC.md',
          path: '../../../sdkwork-specs/RUST_CODE_SPEC.md',
          purpose: 'Rust crate structure and dependency rules.',
        },
        {
          file: 'TEST_SPEC.md',
          path: '../../../sdkwork-specs/TEST_SPEC.md',
          purpose: 'Assembly contract and integration verification.',
        },
      ],
      contracts: {
        layerRole: 'runtime-composition',
        publicExports: ['.'],
        providedPorts: [{ name: `${applicationCode}ApiAssembly`, export: '.' }],
        requiredPorts: [],
        runtimeEntrypoints: [],
        sdkClients: [],
        sdkDependencies: [],
        dependencyApiExports: [],
        dependencyApiSurfaces: [],
        events: [],
        configKeys: [],
      },
      verification: {
        commands: [
          'pnpm run api:assembly:validate',
          `cargo check -p ${packageName}`,
        ],
      },
    };
    writeFileEnsuringDir(componentPath, `${JSON.stringify(component, null, 2)}\n`);
  }

  if (!fs.existsSync(readmePath)) {
    writeFileEnsuringDir(
      readmePath,
      `# ${packageName} Specs\n\nComponent root: \`${crateDir}\`\n\nAPI assembly manifest, business-router composition, and verification contract.\n`,
    );
  }
}

function bootstrapHasTodoMacro(bootstrapSource) {
  return bootstrapSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .some((line) => /todo!\s*\(/u.test(line));
}

function normalizeMountParams(params) {
  return params
    .split(',')
    .map((part) => part.trim().replace(/,\s*$/u, ''))
    .filter(Boolean)
    .join(', ');
}

function bootstrapNeedsRegeneration(bootstrapSource) {
  if (!bootstrapSource.trim() || bootstrapHasTodoMacro(bootstrapSource)) {
    return true;
  }
  if (!/Generated (?:gateway|API assembly) bootstrap/u.test(bootstrapSource)) {
    return false;
  }
  const signatureMatch = /fn\s+assemble_api_router\s*\(([^)]*)\)/u.exec(bootstrapSource);
  const signatureParams = signatureMatch
    ? signatureMatch[1]
        .split(',')
        .map((part) => part.trim().split(':')[0].trim())
        .filter(Boolean)
    : [];
  const mountCalls = [...bootstrapSource.matchAll(/gateway_mount\(([^)]*)\)/gu)];
  for (const match of mountCalls) {
    const args = match[1]
      .split(',')
      .map((part) => part.trim().split('.')[0].trim())
      .filter(Boolean);
    for (const arg of args) {
      if (arg && !signatureParams.includes(arg)) {
        return true;
      }
    }
  }
  if (
    /gateway_mount\(pool\)\.await/u.test(bootstrapSource)
    && /gateway_mount\(pool\.clone\(\)\)/u.test(bootstrapSource)
  ) {
    return true;
  }
  return false;
}

function shouldPreserveBootstrap(bootstrapPath) {
  if (!fs.existsSync(bootstrapPath)) {
    return false;
  }
  const bootstrap = readText(bootstrapPath);
  if (/^\/\/! Generated (?:API assembly|gateway) bootstrap/mu.test(bootstrap)) {
    return false;
  }
  if (bootstrapNeedsRegeneration(bootstrap)) {
    return false;
  }
  return bootstrap.trim().length > 0;
}

function renderBootstrapRs(applicationCode, mounts, root, routeCrates) {
  const withMount = mounts.filter((item) => item.mount);
  if (withMount.length === 0) {
    return renderBootstrapEmpty(applicationCode);
  }

  const businessMounts = discoverGatewayBusinessMounts(root, routeCrates).filter(
    (item) => item.mount,
  );
  const useBusinessMounts = businessMounts.length === withMount.length && withMount.length > 0;
  const activeMounts = useBusinessMounts ? businessMounts : withMount;
  const mountFn = useBusinessMounts ? 'gateway_mount_business' : 'gateway_mount';

  const paramSets = [
    ...new Set(activeMounts.map((item) => normalizeMountParams(item.mount.params))),
  ];
  if (paramSets.length > 1 && paramSets.some(Boolean)) {
    const signatures = activeMounts
      .map((item) => `${item.packageName ?? item.libName}(${normalizeMountParams(item.mount.params)})`)
      .join(', ');
    throw new Error(
      `route gateway_mount parameters are incompatible for generated assembly bootstrap: ${signatures}; add an authored bootstrap that resolves application context explicitly`,
    );
  }
  const sharedParams = paramSets.length === 1 ? paramSets[0] : '';
  const extraUses = new Set();
  for (const item of activeMounts) {
    const libPath = path.join(root, item.memberDir, 'src', 'lib.rs');
    const libRs = fs.existsSync(libPath) ? readText(libPath) : '';
    for (const typeChunk of item.mount.params.split(',')) {
      if (typeChunk.includes('sqlx::AnyPool')) {
        extraUses.add('use sqlx::AnyPool;');
      }
      const hostType = /Arc<([A-Za-z0-9_]+)>/u.exec(typeChunk)?.[1];
      if (hostType) {
        const importMatch = new RegExp(
          `^use\\s+([A-Za-z0-9_]+::${hostType})\\s*;`,
          'mu',
        ).exec(libRs);
        if (importMatch) {
          extraUses.add(`use ${importMatch[1]};`);
        } else {
          const hostCrate = `sdkwork_${applicationCode.replace(/-/gu, '_')}_service_host`;
          extraUses.add(`use ${hostCrate}::${hostType};`);
        }
      }
      if (typeChunk.includes('AccountServiceHost')) {
        extraUses.add('use sdkwork_account_service_host::AccountServiceHost;');
      }
    }
  }

  const missingManifestAccessors = activeMounts.filter(
    (item) => !item.hasHttpRouteManifestAccessor,
  );
  if (missingManifestAccessors.length > 0) {
    throw new Error(
      `route crates must export gateway_route_manifest() -> HttpRouteManifest before automatic assembly materialization: ${missingManifestAccessors
        .map((item) => item.packageName)
        .join(', ')}`,
    );
  }

  const renderContributionBody = (selectedMounts, contributionTitle) => {
    const selectedParamNames = [
      ...new Set(selectedMounts.flatMap((item) => item.mount.paramNames)),
    ];
    const destructuredFields = [
      ...selectedParamNames,
      'domain_context_injectors',
      'readiness_check',
    ].join(', ');
    const ignoreRemainingFields = selectedParamNames.length
      < (sharedParams ? activeMounts[0].mount.paramNames.length : 0);
    const destructure = `    let ApiAssemblyContext { ${destructuredFields}${ignoreRemainingFields ? ', ..' : ''} } = context;`;
    const mergeLines = selectedMounts.map((item) => {
    const args = item.mount.paramNames
      .map((name) => {
        if (!sharedParams) {
          return name;
        }
        const occurrences = activeMounts.filter((other) =>
          other.mount.paramNames.includes(name),
        ).length;
        if (occurrences > 1) {
          return `${name}.clone()`;
        }
        return name;
      })
      .join(', ');
    const call = item.mount.async
      ? `${item.libName}::${mountFn}(${args}).await`
      : `${item.libName}::${mountFn}(${args})`;
    const resolved = /\bResult\s*</u.test(item.gatewayMountReturn ?? '')
      ? `${call}.map_err(|error| error.to_string())?`
      : call;
    return `    router = router.merge(${resolved});`;
    });
    const manifestLines = selectedMounts.map(
      (item) => `    routes.extend_from_slice(${item.libName}::gateway_route_manifest().routes());`,
    );
    return `${destructure}
    let mut router = Router::new();
${mergeLines.join('\n')}
    let mut routes = Vec::new();
${manifestLines.join('\n')}
    ApiAssemblyContribution::from_manifest(
        "sdkwork-${applicationCode}",
        "${contributionTitle}",
        router,
        HttpRouteManifest::from_owned_routes(routes),
        domain_context_injectors,
        readiness_check,
    )`;
  };

  const surfaceFunctionNames = new Map([
    ['app-api', 'assemble_app_api_contribution'],
    ['backend-api', 'assemble_backend_api_contribution'],
    ['open-api', 'assemble_open_api_contribution'],
    ['internal-api', 'assemble_internal_api_contribution'],
  ]);
  const surfaceTitles = new Map([
    ['app-api', 'App API'],
    ['backend-api', 'Backend API'],
    ['open-api', 'Open API'],
    ['internal-api', 'Internal API'],
  ]);
  const surfaceFunctions = [...surfaceFunctionNames.entries()]
    .map(([surface, functionName]) => {
      const selectedMounts = activeMounts.filter((item) => item.surface === surface);
      if (selectedMounts.length === 0) return '';
      return `
pub async fn ${functionName}(context: ApiAssemblyContext) -> Result<ApiAssembly, String> {
${renderContributionBody(
  selectedMounts,
  `SDKWork ${applicationCode} ${surfaceTitles.get(surface)}`,
)}
}
`;
    })
    .filter(Boolean)
    .join('');

  const contextFields = sharedParams
    ? sharedParams.split(',').map((field) => `    pub ${field.trim()},`).join('\n')
    : '';
  const extraUseBlock = [...extraUses].sort().join('\n');

  return `//! Generated API assembly bootstrap for sdkwork-${applicationCode}.
//! Regenerated by pnpm api:assembly:materialize.
//!
//! Multi-surface merges mount shared infrastructure routes once at the assembly layer
//! so \`/healthz\`, \`/livez\`, \`/readyz\`, and \`/metrics\` are not duplicated per surface.

use axum::Router;
use std::sync::Arc;
use sdkwork_web_bootstrap::{ApiAssemblyContribution, ReadinessCheck};
use sdkwork_web_core::{DomainContextInjector, HttpRouteManifest};
${extraUseBlock ? `${extraUseBlock}\n` : ''}
pub type ApiAssembly = ApiAssemblyContribution;

pub struct ApiAssemblyContext {
${contextFields ? `${contextFields}\n` : ''}    pub domain_context_injectors: Vec<Arc<dyn DomainContextInjector>>,
    pub readiness_check: Arc<dyn ReadinessCheck>,
}

pub async fn assemble_api_router(context: ApiAssemblyContext) -> Result<ApiAssembly, String> {
${renderContributionBody(activeMounts, `SDKWork ${applicationCode} API`)}
}
${surfaceFunctions}
`;
}

function renderBootstrapEmpty(applicationCode) {
  return `//! API assembly bootstrap for sdkwork-${applicationCode}.

use axum::Router;
use std::sync::Arc;
use sdkwork_web_bootstrap::{ApiAssemblyContribution, ReadinessCheck};
use sdkwork_web_core::{DomainContextInjector, HttpRouteManifest};

pub type ApiAssembly = ApiAssemblyContribution;

pub struct ApiAssemblyContext {
    pub domain_context_injectors: Vec<Arc<dyn DomainContextInjector>>,
    pub readiness_check: Arc<dyn ReadinessCheck>,
}

pub async fn assemble_api_router(context: ApiAssemblyContext) -> Result<ApiAssembly, String> {
    ApiAssemblyContribution::from_manifest(
        "sdkwork-${applicationCode}",
        "SDKWork ${applicationCode} API",
        Router::new(),
        HttpRouteManifest::from_owned_routes(Vec::new()),
        context.domain_context_injectors,
        context.readiness_check,
    )
}
`;
}

export function materializeApiAssembly(root) {
  if (path.basename(path.resolve(root)) === 'sdkwork-api-cloud-gateway') {
    return {
      ok: false,
      skipped: true,
      applicationCode: null,
      message: 'platform cloud gateway consumes application assemblies',
    };
  }
  let applicationCode;
  try {
    applicationCode = resolveApplicationCode(root);
  } catch (error) {
    return { ok: false, applicationCode: null, message: error.message };
  }
  const routeCrates = discoverRouteCrates(root, applicationCode);
  if (routeCrates.length === 0 && !fs.existsSync(path.join(root, 'sdkwork.app.config.json'))) {
    return {
      ok: false,
      applicationCode,
      message: 'not an application root and no HTTP route crates found',
    };
  }

  const invalidRouteManifests = routeCrates.filter(
    (crate) => !crate.routeManifestRef.includes('#')
      && (!crate.routeManifestInsideRoot || !crate.routeManifestExists),
  );
  if (invalidRouteManifests.length > 0) {
    return {
      ok: false,
      applicationCode,
      message: `route manifest contract is unresolved: ${invalidRouteManifests
        .map((crate) => `${crate.packageName} -> ${crate.routeManifestRef}`)
        .join(', ')}`,
    };
  }

  const crateDir = path.join(root, assemblyCrateDir(applicationCode));
  const bootstrapPath = path.join(crateDir, 'src', 'bootstrap.rs');
  const preserveBootstrap = shouldPreserveBootstrap(bootstrapPath);
  const existingCargoToml = readText(path.join(crateDir, 'Cargo.toml'));
  const preservedDeps = extractPreservedDependencies(
    existingCargoToml,
    applicationCode,
    new Set(routeCrates.flatMap((crate) => [crate.packageName, crate.libName])),
  );
  const preservedBuildDeps = extractPreservedBuildDependencies(existingCargoToml);
  const preservedDevDeps = extractPreservedDevDependencies(existingCargoToml);
  const manifest = buildAssemblyManifest(root, applicationCode, routeCrates);
  const mounts = discoverGatewayMounts(root, routeCrates);
  const workspaceDeps = readWorkspaceDependencyNames(root);
  const bootstrapDeps = resolveAssemblyBootstrapDeps(mounts, workspaceDeps);
  const authoredBootstrapSource = readText(bootstrapPath);
  const generatedBootstrapSource = preserveBootstrap
    ? null
    : renderBootstrapRs(applicationCode, mounts, root, routeCrates);

  writeFileEnsuringDir(path.join(crateDir, 'assembly-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileEnsuringDir(
    path.join(crateDir, 'Cargo.toml'),
    renderCargoToml(
      applicationCode,
      routeCrates,
      preservedDeps,
      readWorkspacePackageFields(root),
      bootstrapDeps,
      workspaceDeps,
      preservedBuildDeps,
      preservedDevDeps,
    ),
  );
  writeFileEnsuringDir(path.join(crateDir, 'src', 'generated.rs'), renderGeneratedRs(routeCrates));
  ensureAssemblyComponentSpecs(root, applicationCode);
  const bootstrapSource = generatedBootstrapSource ?? authoredBootstrapSource;
  const bootstrapReady =
    bootstrapSource.trim().length > 0
    && (generatedBootstrapSource !== null || !bootstrapNeedsRegeneration(bootstrapSource));
  const libPath = path.join(crateDir, 'src', 'lib.rs');
  const existingLib = readText(libPath);
  const preserveAuthoredLib = existingLib.includes('SDKWORK-ASSEMBLY-LIB-CUSTOM');
  writeFileEnsuringDir(
    libPath,
    preserveAuthoredLib
      ? existingLib
      : renderLibRs(applicationCode, routeCrates, bootstrapReady, bootstrapSource),
  );

  if (generatedBootstrapSource !== null) {
    writeFileEnsuringDir(bootstrapPath, generatedBootstrapSource);
  }

  return {
    ok: true,
    applicationCode,
    crateDir: assemblyCrateDir(applicationCode),
    routeCrates: routeCrates.length,
    bootstrapPreserved: preserveBootstrap,
    bootstrapRegenerated: !preserveBootstrap,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: DEFAULT_ROOT },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const root = path.resolve(values.root);
  const result = materializeApiAssembly(root);
  if (!result.ok) {
    const action = result.skipped ? 'skipped' : 'failed';
    console.error(`api-assembly:materialize ${action} for ${root}: ${result.message}`);
    process.exit(result.skipped ? 0 : 1);
  }

  console.log(
    `api-assembly:materialize wrote ${result.crateDir} (${result.routeCrates} route crates${
      result.bootstrapPreserved ? ', bootstrap preserved' : ''
    })`,
  );
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  main();
}
