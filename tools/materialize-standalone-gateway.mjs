#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { listWorkspaceRepositories } from './align-repository-docs-lib.mjs';
import {
  assemblyCrateDir,
  ensureCargoWorkspaceMember,
  readText,
  resolveApplicationCode,
} from './api-assembly-lib.mjs';
import { validateApiAssembly } from './validate-api-assembly.mjs';

function assemblySignature(root, applicationCode) {
  const source = readText(path.join(root, assemblyCrateDir(applicationCode), 'src', 'bootstrap.rs'));
  const match = /pub\s+(async\s+)?fn\s+assemble_api_router\s*\(([^)]*)\)\s*(?:->\s*([^\n{]+))?/u.exec(source);
  if (!match) return null;
  return {
    async: Boolean(match[1]),
    params: match[2].trim(),
    result: String(match[3] ?? '').includes('Result<'),
  };
}

function ensureWorkspaceDependency(root, packageName, declaration, write) {
  const cargoPath = path.join(root, 'Cargo.toml');
  const cargo = readText(cargoPath);
  if (cargo.split(/\r?\n/u).some((line) => line.trimStart().startsWith(`${packageName} =`))) {
    return false;
  }
  if (!cargo.includes('[workspace.dependencies]')) {
    throw new Error('Cargo workspace is missing [workspace.dependencies]');
  }
  const updated = cargo.replace(
    /\[workspace\.dependencies\]\s*\r?\n/u,
    `[workspace.dependencies]\n${packageName} = ${declaration}\n`,
  );
  if (write) fs.writeFileSync(cargoPath, updated, 'utf8');
  return true;
}

function renderMain(applicationCode, signature) {
  const libName = `sdkwork_api_${applicationCode.replaceAll('-', '_')}_assembly`;
  const envCode = applicationCode.replaceAll('-', '_').toUpperCase();
  const assemblyExpression = signature.result
    ? `api_assembly::assemble_api_router()${signature.async ? '\n        .await' : ''}\n        .map_err(|error| std::io::Error::other(error.to_string()))?`
    : `api_assembly::assemble_api_router()${signature.async ? '.await' : ''}`;
  return `use ${libName} as api_assembly;
use sdkwork_web_bootstrap::{service_router, ServiceRouterConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    sdkwork_web_bootstrap::init_tracing_from_env();
    let bind_address = std::env::var("SDKWORK_${envCode}_APPLICATION_PUBLIC_INGRESS_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_owned());
    let assembly = ${assemblyExpression};
    let app = service_router(
        assembly.router,
        ServiceRouterConfig::default().with_always_ready(),
    );
    let bind_address = bind_address.parse()?;
    println!("sdkwork-api-${applicationCode}-standalone-gateway listening on http://{bind_address}");
    sdkwork_web_bootstrap::serve(app, bind_address).await?;
    Ok(())
}
`;
}

function renderCargo(root, applicationCode) {
  const rootCargo = readText(path.join(root, 'Cargo.toml'));
  const packageName = `sdkwork-api-${applicationCode}-standalone-gateway`;
  const licenseLine = /\[workspace\.package\][\s\S]*?^license\s*=/mu.test(rootCargo)
    ? 'license.workspace = true\n'
    : '';
  return `[package]
name = "${packageName}"
version.workspace = true
edition.workspace = true
${licenseLine}
[dependencies]
sdkwork-api-${applicationCode}-assembly.workspace = true
sdkwork-web-bootstrap.workspace = true
tokio.workspace = true
`;
}

function renderComponent(applicationCode) {
  const packageName = `sdkwork-api-${applicationCode}-standalone-gateway`;
  return {
    schemaVersion: 1,
    kind: 'sdkwork.component.spec',
    component: {
      name: packageName,
      displayName: `SDKWork ${applicationCode} Standalone API Gateway`,
      version: '0.1.0',
      type: 'rust-api-standalone-gateway',
      root: `crates/${packageName}`,
      domain: applicationCode,
      capability: 'api-gateway',
      surface: 'gateway-api',
      languages: ['rust'],
      generated: false,
      manifests: ['Cargo.toml'],
    },
    canonicalSpecs: [
      ['API_ASSEMBLY_SPEC.md', 'Host-neutral application API composition.'],
      ['APPLICATION_GATEWAY_SPEC.md', 'Standalone gateway process and dependency boundaries.'],
      ['WEB_FRAMEWORK_SPEC.md', 'Process-wide HTTP infrastructure ownership.'],
      ['WEB_BACKEND_SPEC.md', 'HTTP backend host rules.'],
      ['RUST_CODE_SPEC.md', 'Rust host implementation rules.'],
      ['APP_RUNTIME_TOPOLOGY_SPEC.md', 'Application ingress and development topology.'],
      ['TEST_SPEC.md', 'Gateway composition verification.'],
    ].map(([file, purpose]) => ({ file, path: `../../../sdkwork-specs/${file}`, purpose })),
    contracts: {
      layerRole: 'runtime-gateway',
      publicExports: [],
      providedPorts: [],
      requiredPorts: [{ name: 'applicationApiAssembly', export: 'sdkwork-api-assembly' }],
      runtimeEntrypoints: ['src/main.rs'],
      routeManifest: null,
      sdkClients: [],
      sdkDependencies: [],
      dependencyApiExports: [],
      dependencyApiSurfaces: [],
      events: [],
      configKeys: [],
    },
    verification: { commands: [`cargo check -p ${packageName}`] },
  };
}

function isManagedScaffold(target, applicationCode) {
  const libName = `sdkwork_api_${applicationCode.replaceAll('-', '_')}_assembly`;
  const main = readText(path.join(target, 'src', 'main.rs'));
  const componentPath = path.join(target, 'specs', 'component.spec.json');
  let component = null;
  try {
    component = JSON.parse(readText(componentPath).replace(/^\uFEFF/u, ''));
  } catch {
    return false;
  }
  return main.includes(`use ${libName} as api_assembly;`)
    && component?.component?.type === 'rust-api-standalone-gateway';
}

function writeIfChanged(filePath, content, write) {
  if (readText(filePath) === content) return false;
  if (write) fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

export function materializeStandaloneGateway(root, { write = false } = {}) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(path.join(resolved, 'agent.app.config.json'))) {
    return { root: resolved, skipped: true, reason: 'not-application-root', actions: [] };
  }
  if (path.basename(resolved) === 'sdkwork-api-cloud-gateway') {
    return { root: resolved, skipped: true, reason: 'platform-cloud-gateway', actions: [] };
  }
  const applicationCode = resolveApplicationCode(resolved);
  const rootCargo = readText(path.join(resolved, 'Cargo.toml'));
  if (!rootCargo.includes('[workspace]') || !rootCargo.includes('[workspace.package]')) {
    return {
      root: resolved,
      applicationCode,
      skipped: true,
      reason: 'non-cargo-application',
      actions: [],
    };
  }
  const packageName = `sdkwork-api-${applicationCode}-standalone-gateway`;
  const member = `crates/${packageName}`;
  const target = path.join(resolved, member);
  const targetExists = fs.existsSync(target);
  if (targetExists && !isManagedScaffold(target, applicationCode)) {
    const workspaceChanged = ensureCargoWorkspaceMember(resolved, member, { write });
    return {
      root: resolved,
      applicationCode,
      skipped: !workspaceChanged,
      reason: 'authored-host-exists',
      actions: workspaceChanged ? [`deduplicate Cargo workspace member ${member}`] : [],
    };
  }
  const validation = validateApiAssembly(resolved);
  if (!validation.ok) {
    throw new Error(`API assembly validation failed: ${validation.errors.join('; ')}`);
  }
  const signature = assemblySignature(resolved, applicationCode);
  if (!signature) throw new Error('assembly does not export an authored assemble_api_router signature');
  if (signature.params) throw new Error(`assemble_api_router requires application-specific wiring: ${signature.params}`);
  const actions = [];
  const workspaceChanged = ensureCargoWorkspaceMember(resolved, member, { write });
  if (workspaceChanged) actions.push(`add Cargo workspace member ${member}`);
  if (ensureWorkspaceDependency(
    resolved,
    `sdkwork-api-${applicationCode}-assembly`,
    `{ path = "crates/sdkwork-api-${applicationCode}-assembly" }`,
    write,
  )) {
    actions.push('add API assembly workspace dependency');
  }
  if (ensureWorkspaceDependency(
    resolved,
    'sdkwork-web-bootstrap',
    '{ path = "../sdkwork-web-framework/crates/sdkwork-web-bootstrap" }',
    write,
  )) {
    actions.push('add Web Framework bootstrap workspace dependency');
  }
  if (ensureWorkspaceDependency(
    resolved,
    'tokio',
    '{ version = "1.48", features = ["macros", "rt-multi-thread"] }',
    write,
  )) {
    actions.push('add Tokio workspace dependency');
  }
  const cargo = renderCargo(resolved, applicationCode);
  const main = renderMain(applicationCode, signature);
  const component = `${JSON.stringify(renderComponent(applicationCode), null, 2)}\n`;
  const generatedFilesChanged = [
    [path.join(target, 'Cargo.toml'), cargo],
    [path.join(target, 'src', 'main.rs'), main],
    [path.join(target, 'specs', 'component.spec.json'), component],
  ].some(([filePath, content]) => readText(filePath) !== content);
  if (generatedFilesChanged) {
    actions.push(`${targetExists ? 'update' : 'create'} ${member}`);
  }
  if (write) {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.mkdirSync(path.join(target, 'specs'), { recursive: true });
    writeIfChanged(path.join(target, 'Cargo.toml'), cargo, true);
    writeIfChanged(path.join(target, 'src', 'main.rs'), main, true);
    writeIfChanged(path.join(target, 'specs', 'component.spec.json'), component, true);
  }
  return {
    root: resolved,
    applicationCode,
    skipped: actions.length === 0,
    reason: actions.length === 0 ? 'already-aligned' : undefined,
    actions,
  };
}

function usage() {
  return 'Usage: node tools/materialize-standalone-gateway.mjs (--root <application> | --workspace <workspace>) [--write]';
}

function main() {
  const { values } = parseArgs({ options: {
    root: { type: 'string' }, workspace: { type: 'string' }, write: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
  } });
  if (values.help || Boolean(values.root) === Boolean(values.workspace)) {
    console.log(usage()); process.exitCode = values.help ? 0 : 2; return;
  }
  const roots = values.root ? [path.resolve(values.root)] : listWorkspaceRepositories(path.resolve(values.workspace), { prefix: 'sdkwork-' });
  let count = 0; const failures = [];
  for (const root of roots) {
    try {
      const result = materializeStandaloneGateway(root, { write: values.write });
      if (result.skipped) continue;
      count += 1;
      console.log(`${values.write ? 'create' : 'would create'} ${path.basename(root)}: ${result.actions.join('; ')}`);
    } catch (error) { failures.push(`${path.basename(root)}: ${error.message}`); }
  }
  console.log(`\nStandalone gateways ${values.write ? 'created' : 'planned'}: ${count}`);
  console.log(`Failures: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) main();
