#!/usr/bin/env node
// Enforce the database-backed HTTP service registry migration ratchet.
//
// DISCOVERY_SPEC.md section 12.1 / APP_SDK_INTEGRATION_SPEC.md section 5.2:
// backend Rust modules that construct a generated HTTP SDK must resolve the
// base URL through `sdkwork_utils_rust::service_base_url` (registry-first), not
// from an ad-hoc environment read. Existing call sites are baselined while they
// migrate; any NEW file is a hard failure so the pattern cannot spread.
//
// Usage:
//   node sdkwork-specs/tools/check-http-registry-resolution.mjs --workspace <sdkwork-space-root>

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const workspaceRoot = path.resolve(option('--workspace') ?? '.');
if (!existsSync(workspaceRoot)) {
  console.error(`workspace not found: ${workspaceRoot}`);
  process.exit(2);
}

// Legacy call sites that still construct an SDK from a configured base URL.
// The migration is complete: every detected production site resolves through
// the registry. Keep this set empty; a new entry needs an owner, a date, and a
// removal plan in the same change.
const BASELINED = new Set([]);

const CONSTRUCTOR = /(?:SdkworkConfig::new\(|new_with_base_url\()/u;
const REGISTRY_MARKERS = [
  'service_base_url',
  'registry_base_url_or',
  'registry_http_target',
  'install_resolver_from_env',
  'HttpServiceRegistry',
  'cloudrouter_base_url',
];

const SKIP_SEGMENTS = new Set([
  'target',
  'target-win',
  'node_modules',
  '.git',
  'dist',
  'generated',
  'sdks',
  'tests',
  'test',
  'benches',
]);

function walk(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (SKIP_SEGMENTS.has(entry)) continue;
    const full = path.join(directory, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (stat.isFile() && entry.endsWith('.rs')) {
      files.push(full);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(workspaceRoot, file).split(path.sep).join('/');
}

const cratesRoot = path.join(workspaceRoot, 'crates');
const files = [];
if (existsSync(cratesRoot)) {
  walk(cratesRoot, files);
} else {
  // Workspace root: scan each sibling repository's crates/ tree only. Walking
  // the whole workspace would descend into app node_modules and build caches.
  for (const entry of readdirSync(workspaceRoot)) {
    if (!entry.startsWith('sdkwork-')) continue;
    if (entry === 'sdkwork-specs' || entry === 'sdkwork-sdk-generator') continue;
    const childCrates = path.join(workspaceRoot, entry, 'crates');
    if (existsSync(childCrates)) walk(childCrates, files);
  }
}

const violations = [];
const baselined = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!CONSTRUCTOR.test(content)) continue;
  // Explicit, reviewable exemption for a test-only loopback stub or a
  // generated-test double. The marker must appear in the file; it is not a
  // baseline entry and carries no production authority.
  if (content.includes('registry:allow')) continue;
  const name = relative(file);
  if (REGISTRY_MARKERS.some((marker) => content.includes(marker))) continue;
  if (BASELINED.has(name)) {
    baselined.push(name);
  } else {
    violations.push(name);
  }
}

const infra = [
  ['sdkwork-utils/packages/sdkwork-utils-rust/src/service_base_url.rs', 'pub trait HttpServiceRegistry'],
  ['sdkwork-discovery/crates/sdkwork-discovery-client/src/registry.rs', 'uk_discovery_service_instance_identity'],
  ['sdkwork-discovery/crates/sdkwork-discovery-client/src/selection.rs', 'pub enum LoadBalanceStrategy'],
  ['sdkwork-discovery/crates/sdkwork-discovery-client/src/resolver.rs', 'select_target_with'],
  ['sdkwork-specs/DISCOVERY_SPEC.md', '### 12.1 Database-Backed HTTP Service Registry For Backend SDKs'],
  ['sdkwork-specs/APP_SDK_INTEGRATION_SPEC.md', '### 5.4 Backend SDK Call Framework'],
];
const missingInfra = infra.filter(([file, marker]) => {
  const full = path.join(workspaceRoot, file);
  return !existsSync(full) || !readFileSync(full, 'utf8').includes(marker);
});

// Standalone service hosts must install the resolver themselves; embedded
// consumers inherit the composition root's installation.
const standaloneHosts = [
  'sdkwork-webserver/crates/sdkwork-api-webserver-standalone-gateway/src/main.rs',
  'sdkwork-webserver/crates/sdkwork-webserver-agent/src/main.rs',
];
const missingStandaloneBootstrap = standaloneHosts.filter((file) => {
  const full = path.join(workspaceRoot, file);
  return existsSync(full) && !readFileSync(full, 'utf8').includes('install_resolver_from_env');
});
if (missingStandaloneBootstrap.length > 0) {
  console.error('Standalone service hosts must install the HTTP service registry resolver:');
  for (const file of missingStandaloneBootstrap) {
    console.error(`  - ${file} is missing install_resolver_from_env`);
  }
  process.exit(1);
}

// The gateway must register its instance/port before it serves traffic, and
// deregister on graceful shutdown.
const gatewayMain = path.join(
  workspaceRoot,
  'sdkwork-api-cloud-gateway/crates/sdkwork-api-cloud-gateway/src/listener_main.rs',
);
if (existsSync(gatewayMain)) {
  const content = readFileSync(gatewayMain, 'utf8');
  const start = content.indexOf('ServiceRegistryRuntime::start');
  const serve = content.indexOf('axum::serve');
  const problems = [];
  if (start < 0) problems.push('missing ServiceRegistryRuntime::start');
  if (serve >= 0 && start > serve) problems.push('registration must run before axum::serve');
  if (!content.includes('service_registry.shutdown')) problems.push('missing graceful deregistration');
  if (problems.length > 0) {
    console.error('Gateway startup registration contract is broken:');
    for (const problem of problems) console.error(`  - listener_main.rs: ${problem}`);
    process.exit(1);
  }
}

if (missingInfra.length > 0) {
  console.error('HTTP service registry infrastructure is missing:');
  for (const [file, marker] of missingInfra) {
    console.error(`  - ${file} must contain: ${marker}`);
  }
  process.exit(1);
}

if (baselined.length > 0) {
  console.warn(
    `[warn] ${baselined.length} legacy HTTP SDK construction site(s) still bypass the registry; migrate them and remove the baseline entry:`,
  );
  for (const name of baselined) console.warn(`  - ${name}`);
}

if (violations.length > 0) {
  console.error(
    `[error] ${violations.length} new HTTP SDK construction site(s) bypass the database registry (DISCOVERY_SPEC.md section 12.1):`,
  );
  for (const name of violations) console.error(`  - ${name}`);
  console.error(
    'Resolve the base URL through sdkwork_utils_rust::service_base_url (registry_base_url_or / resolve) or install the resolver with sdkwork_discovery_client::install_resolver_from_env.',
  );
  process.exit(1);
}

console.log(
  `HTTP registry resolution gate passed (${files.length} Rust files scanned, ${baselined.length} baselined).`,
);
