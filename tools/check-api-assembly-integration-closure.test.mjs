import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseCargoFeatures,
  validateApiAssemblyIntegrationClosure,
} from './lib/api-assembly-integration-closure.mjs';

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function cloudGatewayFixture({ featureDependencies, runtimeDependencies = '', sourceCall = true, root }) {
  root ??= fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-assembly-closure-'));
  write(
    path.join(root, 'crates/sdkwork-api-cloud-gateway/Cargo.toml'),
    `[package]\nname = "sdkwork-api-cloud-gateway"\nversion = "0.0.0"\n\n[features]\nfoundation-demo = [${featureDependencies.map((value) => `"${value}"`).join(', ')}]\n\n[dependencies]\nsdkwork-api-demo-assembly = { workspace = true, optional = true }\n${runtimeDependencies}`,
  );
  write(
    path.join(root, 'crates/sdkwork-api-cloud-gateway/src/lib.rs'),
    sourceCall ? 'fn build() { sdkwork_api_demo_assembly::assemble_api_router_with_pool(); }\n' : 'fn build() {}\n',
  );
  write(
    path.join(root, 'specs/component.spec.json'),
    JSON.stringify({
      gatewayIntegration: {
        assemblyIntegrationPoint: {
          databaseLifecycleOwner: 'sdkwork-api-<application-code>-assembly',
        },
      },
      dependencies: [{
        cargoFeature: 'foundation-demo',
        workspace: 'sdkwork-demo',
        cargoDependency: 'sdkwork-api-demo-assembly',
        executableExport: 'sdkwork_api_demo_assembly::assemble_api_router_with_pool',
      }],
    }),
  );
  return root;
}

test('Cargo feature parser handles inline and multiline arrays', () => {
  const features = parseCargoFeatures(`[features]\ninline = ["dep:a"]\nmulti = [\n  "dep:b",\n  "other",\n]\n\n[dependencies]\n`);
  assert.deepEqual(features.get('inline'), ['dep:a']);
  assert.deepEqual(features.get('multi'), ['dep:b', 'other']);
});

test('platform gateway passes with one owner assembly integration point', () => {
  const root = cloudGatewayFixture({ featureDependencies: ['dep:sdkwork-api-demo-assembly'] });
  assert.deepEqual(validateApiAssemblyIntegrationClosure(root), []);
});

test('platform release parity validates each selected owner standalone gateway', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-selected-parity-'));
  const gatewayRoot = cloudGatewayFixture({
    featureDependencies: ['dep:sdkwork-api-demo-assembly'],
    root: path.join(workspaceRoot, 'sdkwork-api-cloud-gateway'),
  });
  const ownerRoot = path.join(workspaceRoot, 'sdkwork-demo');
  write(
    path.join(ownerRoot, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-standalone-gateway"\nversion = "0.0.0"\n\n[dependencies]\nsdkwork-api-demo-assembly = "0"\n',
  );
  write(
    path.join(ownerRoot, 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs'),
    'fn main() { sdkwork_api_demo_assembly::assemble_api_router(); }\n',
  );
  const issues = validateApiAssemblyIntegrationClosure(gatewayRoot, {
    strictSelectedStandaloneParity: true,
  });
  assert.ok(issues.some((issue) => issue.includes('sdkwork-demo:')));
  assert.ok(issues.some((issue) => issue.includes('ComposedApiAssembly::try_compose')));
});

test('platform release parity rejects a selected owner without standalone ingress', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-selected-parity-'));
  const gatewayRoot = cloudGatewayFixture({
    featureDependencies: ['dep:sdkwork-api-demo-assembly'],
    root: path.join(workspaceRoot, 'sdkwork-api-cloud-gateway'),
  });
  fs.mkdirSync(path.join(workspaceRoot, 'sdkwork-demo'), { recursive: true });
  const issues = validateApiAssemblyIntegrationClosure(gatewayRoot, {
    strictSelectedStandaloneParity: true,
  });
  assert.ok(issues.some((issue) => issue.includes('has no sdkwork-api-<application-code>-standalone-gateway')));
});

test('gateway rejects direct database host and service dependencies', () => {
  const root = cloudGatewayFixture({
    featureDependencies: [
      'dep:sdkwork-api-demo-assembly',
      'dep:sdkwork-demo-database-host',
      'dep:sdkwork-demo-service',
    ],
    runtimeDependencies: [
      'sdkwork-demo-database-host = { workspace = true, optional = true }',
      'sdkwork-demo-service = { workspace = true, optional = true }',
      '',
    ].join('\n'),
  });
  const issues = validateApiAssemblyIntegrationClosure(root);
  assert.ok(issues.some((issue) => issue.includes('sdkwork-demo-database-host')));
  assert.ok(issues.some((issue) => issue.includes('sdkwork-demo-service')));
});

test('gateway rejects direct provider adapter dependencies', () => {
  const root = cloudGatewayFixture({
    featureDependencies: [
      'dep:sdkwork-api-demo-assembly',
      'dep:sdkwork-demo-provider-secret-adapter',
    ],
    runtimeDependencies: 'sdkwork-demo-provider-secret-adapter = { workspace = true, optional = true }\n',
  });
  const issues = validateApiAssemblyIntegrationClosure(root);
  assert.ok(issues.some((issue) => issue.includes('sdkwork-demo-provider-secret-adapter')));
});

test('platform gateway rejects source-level owner lifecycle bypasses', () => {
  const root = cloudGatewayFixture({ featureDependencies: ['dep:sdkwork-api-demo-assembly'] });
  write(
    path.join(root, 'crates/sdkwork-api-cloud-gateway/src/lib.rs'),
    [
      'fn build() {',
      '  sdkwork_api_demo_assembly::assemble_api_router_with_pool();',
      '  sdkwork_demo_database_host::bootstrap_demo_database();',
      '}',
      '',
    ].join('\n'),
  );
  const issues = validateApiAssemblyIntegrationClosure(root);
  assert.ok(issues.some((issue) => issue.includes('sdkwork_demo_database_host::')));
});

test('platform gateway aligns process pool consumers with owner assemblies', () => {
  const root = cloudGatewayFixture({ featureDependencies: ['dep:sdkwork-api-demo-assembly'] });
  write(
    path.join(root, 'specs/process-database-pool.spec.json'),
    JSON.stringify({
      processes: [{
        id: 'sdkwork-api-cloud-gateway',
        consumers: [{
          module: 'sdkwork-demo',
          ownerAssembly: 'sdkwork-api-wrong-assembly',
          evidence: ['crates/sdkwork-api-cloud-gateway/src/embedded_database_bootstrap.rs'],
        }],
      }],
    }),
  );
  const issues = validateApiAssemblyIntegrationClosure(root);
  assert.ok(issues.some((issue) => issue.includes('ownerAssembly must be sdkwork-api-demo-assembly')));
  assert.ok(issues.some((issue) => issue.includes('evidence must point to the owner assembly bootstrap')));
});

test('platform gateway validates nested owner assembly lifecycle evidence', () => {
  const root = cloudGatewayFixture({ featureDependencies: ['dep:sdkwork-api-demo-assembly'] });
  write(
    path.join(root, 'specs/process-database-pool.spec.json'),
    JSON.stringify({
      processes: [{
        id: 'sdkwork-api-cloud-gateway',
        consumers: [{
          module: 'sdkwork-demo',
          ownerAssembly: 'sdkwork-api-demo-assembly',
          evidence: ['crates/sdkwork-api-cloud-gateway/src/embedded_dependency_routes.rs'],
        }],
        nestedLifecycleDependencies: [{
          ownerAssembly: 'sdkwork-api-demo-assembly',
          dependencyAssembly: 'sdkwork-api-child-assembly',
          evidence: 'crates/sdkwork-api-demo-assembly/src/bootstrap.rs',
        }],
      }],
    }),
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-assembly/src/bootstrap.rs'),
    'fn bootstrap() {}\n',
  );
  const issues = validateApiAssemblyIntegrationClosure(root);
  assert.ok(issues.some((issue) => issue.includes('must call sdkwork-api-child-assembly')));
});

test('foundation feature must call its component-declared owner entrypoint', () => {
  const root = cloudGatewayFixture({
    featureDependencies: ['dep:sdkwork-api-demo-assembly'],
    sourceCall: false,
  });
  const issues = validateApiAssemblyIntegrationClosure(root);
  assert.ok(issues.some((issue) => issue.includes('must call declared owner entrypoint')));
});

test('standalone gateway rejects route implementation dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-closure-'));
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-standalone-gateway"\nversion = "0.0.0"\n\n[dependencies]\nsdkwork-api-demo-assembly = "0"\nsdkwork-routes-demo-app-api = "0"\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs'),
    'fn main() { sdkwork_api_demo_assembly::assemble(); ComposedApiAssembly::try_compose(); value.into_hosted(); }\n',
  );
  const issues = validateApiAssemblyIntegrationClosure(root);
  assert.ok(issues.some((issue) => issue.includes('sdkwork-routes-demo-app-api')));
});

test('standalone gateway rejects router-only assembly projection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-closure-'));
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-standalone-gateway"\nversion = "0.0.0"\n\n[dependencies]\nsdkwork-api-demo-assembly = "0"\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs'),
    'fn main() { let router = sdkwork_api_demo_assembly::assemble().router; }\n',
  );
  const issues = validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true });
  assert.ok(issues.some((issue) => issue.includes('ComposedApiAssembly::try_compose')));
  assert.ok(issues.some((issue) => issue.includes('through into_hosted')));
});

/**
 * Minimal process contract for a standalone gateway whose only assembly
 * dependency is its own owner assembly.
 *
 * `validateStandaloneNestedLifecycle` requires the contract file to exist and to
 * declare the process before it validates anything else, so a fixture that
 * means to exercise the *hosting* rules still has to carry one. (Two such
 * fixtures were missing it and had been failing since the contract requirement
 * landed; the rules they assert were never exercised.)
 */
function writeSoloProcessContract(root, processId) {
  write(
    path.join(root, 'specs/process-database-pool.spec.json'),
    JSON.stringify({ processes: [{ id: processId, consumers: [] }] }),
  );
}

/**
 * Standalone-gateway fixture with one **nested** lifecycle dependency, used by
 * the R5 repair-closure test.
 *
 * Layout: the gateway composes `sdkwork-api-child-assembly` (routes + lifecycle
 * on the serve path) and owns an explicit migration command whose body lives in
 * `src/lifecycle.rs`. `runMigrations` decides whether that command still
 * converges the child; `withClosure` decides whether the contract declares the
 * closure at all.
 */
function standaloneNestedFixture({ withClosure = true, migrationsConvergeChild = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-nested-'));
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-standalone-gateway"\nversion = "0.0.0"\n\n[dependencies]\nsdkwork-api-demo-assembly = "0"\nsdkwork-api-child-assembly = "0"\n',
  );
  // The serve path converges the child; the entrypoint also dispatches the
  // literal the closure names, so R5a has something real to verify.
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs'),
    'fn main() { match arg { Some("migrate-now") => run_migrations(), _ => serve() } }\n'
      + 'fn serve() { sdkwork_api_demo_assembly::assemble_api_router(); sdkwork_api_child_assembly::bootstrap_database_with_pool(); ApiModuleRegistry::new().add_module(m).try_compose().into_hosted(); }\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/specs/component.spec.json'),
    JSON.stringify({
      component: {
        name: 'sdkwork-api-demo-standalone-gateway',
        type: 'rust-api-standalone-gateway',
      },
      contracts: {
        requiredPorts: [
          {
            name: 'applicationApiAssembly',
            export: 'sdkwork_api_demo_assembly::assemble_api_router',
          },
          {
            name: 'childApiAssembly',
            export: 'sdkwork_api_child_assembly::bootstrap_database_with_pool',
          },
        ],
        runtimeEntrypoints: ['src/main.rs', 'src/lifecycle.rs'],
      },
    }),
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/src/lifecycle.rs'),
    migrationsConvergeChild
      ? 'pub async fn run_migrations() {\n    sdkwork_api_child_assembly::bootstrap_database_with_pool();\n}\n'
      : 'pub async fn run_migrations() {\n    // regression: the child was dropped from the repair path\n}\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-child-assembly/src/bootstrap.rs'),
    'pub async fn bootstrap_database_with_pool(pool: DatabasePool) -> Result<(), String> {\n'
      + '    sdkwork_child_database_host::bootstrap_child_database(pool).await\n}\n',
  );
  // The owning module host is what actually performs the three stages (R3b).
  write(
    path.join(root, 'crates/sdkwork-api-child-database-host/src/lib.rs'),
    'pub async fn bootstrap_child_database(pool: DatabasePool) -> Result<(), String> {\n'
      + '    let orchestrator = LifecycleOrchestrator::new(pool.clone(), module.clone());\n'
      + '    orchestrator.init().await?;\n'
      + '    if options.auto_migrate { orchestrator.migrate().await?; }\n'
      + '    let drift = DriftEngine::new(pool.clone(), module.clone()).analyze().await?;\n'
      + '    if drift.summary.error > 0 { return Err("drift".to_string()); }\n'
      + '    Ok(())\n}\n',
  );
  write(
    path.join(root, 'specs/process-database-pool.spec.json'),
    JSON.stringify({
      processes: [{
        id: 'sdkwork-api-demo-standalone-gateway',
        entrypoint: 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs',
        consumers: [{
          module: 'sdkwork-child',
          ownerAssembly: 'sdkwork-api-child-assembly',
          evidence: ['crates/sdkwork-api-demo-standalone-gateway/src/main.rs'],
        }],
        nestedLifecycleDependencies: [{
          dependencyAssembly: 'sdkwork-api-child-assembly',
          module: 'sdkwork-child',
          order: 'child-before-serve',
          invokedVia: 'gateway',
          stages: ['init', 'migrate', 'drift'],
          lifecycleEntrypoint: 'bootstrap_database_with_pool',
          servePathEvidence: ['crates/sdkwork-api-demo-standalone-gateway/src/main.rs'],
          evidence: ['crates/sdkwork-api-child-assembly/src/bootstrap.rs'],
          hostEvidence: ['crates/sdkwork-api-child-database-host/src/lib.rs'],
          migrationPath: {
            entrypoint: 'sdkwork_api_child_assembly::bootstrap_database_with_pool',
            evidence: ['crates/sdkwork-api-demo-standalone-gateway/src/lifecycle.rs'],
          },
        }],
        ...(withClosure
          ? {
            migrationClosure: {
              command: 'migrate-now',
              scope: 'run_migrations',
              evidence: ['crates/sdkwork-api-demo-standalone-gateway/src/lifecycle.rs'],
            },
          }
          : {}),
      }],
    }),
  );
  return root;
}

test('standalone gateway accepts the complete hosted assembly contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-closure-'));
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-standalone-gateway"\nversion = "0.0.0"\n\n[dependencies]\nsdkwork-api-demo-assembly = "0"\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs'),
    'fn main() { let value = sdkwork_api_demo_assembly::assemble_api_router(); ComposedApiAssembly::try_compose().into_hosted(); }\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/specs/component.spec.json'),
    JSON.stringify({
      component: {
        name: 'sdkwork-api-demo-standalone-gateway',
        type: 'rust-api-standalone-gateway',
      },
      contracts: {
        requiredPorts: [{
          name: 'applicationApiAssembly',
          export: 'sdkwork_api_demo_assembly::assemble_api_router',
        }],
        runtimeEntrypoints: ['src/main.rs'],
      },
    }),
  );
  writeSoloProcessContract(root, 'sdkwork-api-demo-standalone-gateway');
  assert.deepEqual(
    validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true }),
    [],
  );
});

test('standalone gateway accepts the ApiModuleRegistry add_module front door', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-closure-'));
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-standalone-gateway"\nversion = "0.0.0"\n\n[dependencies]\nsdkwork-api-demo-assembly = "0"\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs'),
    'fn main() { let module = sdkwork_api_demo_assembly::assemble_api_router(); let mut registry = ApiModuleRegistry::new(); registry.add_module(module); registry.try_compose("SDKWork").into_hosted(); }\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/specs/component.spec.json'),
    JSON.stringify({
      component: {
        name: 'sdkwork-api-demo-standalone-gateway',
        type: 'rust-api-standalone-gateway',
      },
      contracts: {
        requiredPorts: [{
          name: 'applicationApiAssembly',
          export: 'sdkwork_api_demo_assembly::assemble_api_router',
        }],
        runtimeEntrypoints: ['src/main.rs'],
      },
    }),
  );
  writeSoloProcessContract(root, 'sdkwork-api-demo-standalone-gateway');
  assert.deepEqual(
    validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true }),
    [],
  );
});

test('standalone gateway accepts a nested lifecycle relation converged on both paths', () => {
  const root = standaloneNestedFixture();
  assert.deepEqual(
    validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true }),
    [],
  );
});

test('standalone gateway requires the explicit migration command to converge every nested relation', () => {
  // The 2026-09-23 defect: the relation is converged by `serve`, but the repair
  // command silently omits it, so the fail-closed drift gate names a command
  // that cannot fix it.
  const root = standaloneNestedFixture({ migrationsConvergeChild: false });
  const issues = validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true });
  assert.ok(
    issues.some((issue) => issue.includes('migrationClosure never invokes sdkwork_api_child_assembly::bootstrap_database_with_pool')),
    `expected a repair-closure issue, got: ${JSON.stringify(issues)}`,
  );
});

test('standalone gateway requires a declared migration closure', () => {
  const root = standaloneNestedFixture({ withClosure: false });
  const issues = validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true });
  assert.ok(issues.some((issue) => issue.includes('must declare migrationClosure')));
});

test('strict standalone hosting rejects Web Framework installation inside owner assembly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-closure-'));
  write(
    path.join(root, 'crates/sdkwork-api-demo-assembly/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-assembly"\nversion = "0.0.0"\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-assembly/src/lib.rs'),
    'fn assemble(router: Router) { wrap_router_with_web_framework_from_env(router); }\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-standalone-gateway"\nversion = "0.0.0"\n\n[dependencies]\nsdkwork-api-demo-assembly = "0"\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs'),
    'fn main() { sdkwork_api_demo_assembly::assemble_api_router(); ComposedApiAssembly::try_compose().into_hosted(); }\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/specs/component.spec.json'),
    JSON.stringify({
      component: {
        name: 'sdkwork-api-demo-standalone-gateway',
        type: 'rust-api-standalone-gateway',
      },
      contracts: {
        requiredPorts: [{
          name: 'applicationApiAssembly',
          export: 'sdkwork_api_demo_assembly::assemble_api_router',
        }],
        runtimeEntrypoints: ['src/main.rs'],
      },
    }),
  );

  const issues = validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true });
  assert.ok(issues.some((issue) => issue.includes('must not install Web Framework')));
});

test('strict standalone hosting permits an unused compatibility wrapper definition', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-closure-'));
  write(
    path.join(root, 'crates/sdkwork-api-demo-assembly/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-assembly"\nversion = "0.0.0"\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-assembly/src/web_bootstrap.rs'),
    'pub async fn wrap_router_with_web_framework_from_env(router: Router) -> Router { router }\n',
  );
  assert.deepEqual(
    validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true }),
    [],
  );
});

test('strict standalone hosting requires a crate-local component contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-closure-'));
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-standalone-gateway"\nversion = "0.0.0"\n\n[dependencies]\nsdkwork-api-demo-assembly = "0"\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs'),
    'fn main() { sdkwork_api_demo_assembly::assemble(); ComposedApiAssembly::try_compose().into_hosted(); }\n',
  );
  const issues = validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true });
  assert.ok(issues.some((issue) => issue.includes('crate-local specs/component.spec.json')));
});

test('strict standalone hosting requires every owner assembly port declaration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-closure-'));
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-standalone-gateway"\nversion = "0.0.0"\n\n[dependencies]\nsdkwork-api-demo-assembly = "0"\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs'),
    'fn main() { sdkwork_api_demo_assembly::assemble(); ComposedApiAssembly::try_compose().into_hosted(); }\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/specs/component.spec.json'),
    JSON.stringify({
      component: {
        name: 'sdkwork-api-demo-standalone-gateway',
        type: 'rust-api-standalone-gateway',
      },
      contracts: { requiredPorts: [], runtimeEntrypoints: ['src/main.rs'] },
    }),
  );
  const issues = validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true });
  assert.ok(issues.some((issue) => issue.includes('requiredPorts must declare owner assembly')));
});

test('strict standalone hosting calls the component-declared owner entrypoint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-closure-'));
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    '[package]\nname = "sdkwork-api-demo-standalone-gateway"\nversion = "0.0.0"\n\n[dependencies]\nsdkwork-api-demo-assembly = "0"\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/src/main.rs'),
    'fn main() { sdkwork_api_demo_assembly::assemble(); ComposedApiAssembly::try_compose().into_hosted(); }\n',
  );
  write(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/specs/component.spec.json'),
    JSON.stringify({
      component: {
        name: 'sdkwork-api-demo-standalone-gateway',
        type: 'rust-api-standalone-gateway',
      },
      contracts: {
        requiredPorts: [{
          name: 'applicationApiAssembly',
          export: 'sdkwork_api_demo_assembly::assemble_declared',
        }],
        runtimeEntrypoints: ['src/main.rs'],
      },
    }),
  );
  const issues = validateApiAssemblyIntegrationClosure(root, { strictStandaloneHosting: true });
  assert.ok(issues.some((issue) => issue.includes('component-declared owner entrypoint')));
});
