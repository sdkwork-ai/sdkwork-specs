import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { materializeApiAssembly } from './materialize-api-assembly.mjs';

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

test('API assembly materializer preserves custom library modules and exports byte-for-byte', () => {
  const root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-')),
    'sdkwork-demo',
  );
  writeText(path.join(root, 'agent.app.config.json'), '{}\n');
  writeText(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = []\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\n',
  );
  const crateRoot = path.join(root, 'crates', 'sdkwork-api-demo-assembly');
  const customLib = [
    '//! API assembly for sdkwork-demo.',
    '// SDKWORK-ASSEMBLY-LIB-CUSTOM',
    '',
    'mod bootstrap;',
    'mod generated;',
    'mod generated_open_http_route_manifest;',
    '',
    'pub use bootstrap::{assemble_api_router, ApiAssembly, ApiAssemblyContext};',
    '',
  ].join('\n');
  writeText(path.join(crateRoot, 'src', 'lib.rs'), customLib);
  writeText(
    path.join(crateRoot, 'src', 'bootstrap.rs'),
    [
      'pub struct ApiAssembly;',
      'pub struct ApiAssemblyContext;',
      'pub async fn assemble_api_router(_: ApiAssemblyContext) -> Result<ApiAssembly, String> {',
      '    Ok(ApiAssembly)',
      '}',
      '',
    ].join('\n'),
  );
  writeText(
    path.join(crateRoot, 'src', 'generated_open_http_route_manifest.rs'),
    'pub fn http_route_manifest() {}\n',
  );

  const result = materializeApiAssembly(root);

  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(path.join(crateRoot, 'src', 'lib.rs'), 'utf8'), customLib);
  assert.match(
    fs.readFileSync(path.join(crateRoot, 'src', 'generated.rs'), 'utf8'),
    /ROUTE_CRATE_COUNT: usize = 0/u,
  );
});

test('API assembly Cargo dependencies use workspace declarations when root owns route crates', () => {
  const root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-')),
    'sdkwork-agents',
  );
  writeText(
    path.join(root, 'agent.app.config.json'),
    `${JSON.stringify({ backend: { appId: 'sdkwork-agents' } }, null, 2)}\n`,
  );
  writeText(
    path.join(root, 'Cargo.toml'),
    [
      '[workspace]',
      'members = [',
      '  "crates/sdkwork-routes-agents-app-api",',
      '  "crates/sdkwork-routes-agents-http-shared"',
      ']',
      '',
      '[workspace.dependencies]',
      'axum = "0.8"',
      'tokio = { version = "1", features = ["macros", "rt-multi-thread"] }',
      'sdkwork-routes-agents-app-api = { path = "crates/sdkwork-routes-agents-app-api" }',
      'sdkwork-routes-agents-http-shared = { path = "crates/sdkwork-routes-agents-http-shared" }',
      '',
    ].join('\n'),
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-agents-app-api/Cargo.toml'),
    '[package]\nname = "sdkwork-routes-agents-app-api"\nversion = "0.0.0"\n',
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-agents-app-api/src/lib.rs'),
    [
      'pub const APP_API_PREFIX: &str = "/app/v3/api/agents";',
      'pub fn gateway_mount() -> axum::Router { axum::Router::new() }',
      'pub fn gateway_mount_business() -> axum::Router { axum::Router::new() }',
      'pub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }',
      '',
    ].join('\n'),
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-agents-http-shared/Cargo.toml'),
    '[package]\nname = "sdkwork-routes-agents-http-shared"\nversion = "0.0.0"\n',
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-agents-http-shared/src/lib.rs'),
    'pub const ROUTE_MANIFEST_KIND: &str = "sdkwork.route.manifest";\n',
  );

  const result = materializeApiAssembly(root);

  assert.equal(result.ok, true);
  const cargoToml = fs.readFileSync(
    path.join(root, 'crates/sdkwork-api-agents-assembly/Cargo.toml'),
    'utf8',
  );
  assert.match(cargoToml, /^tokio\.workspace = true$/mu);
  assert.match(cargoToml, /^edition = "2021"$/mu);
  assert.match(cargoToml, /^version = "0\.1\.0"$/mu);
  assert.match(cargoToml, /^sdkwork-routes-agents-app-api\.workspace = true$/mu);
  assert.match(cargoToml, /^sdkwork-web-core = \{ path = /mu);
  assert.doesNotMatch(cargoToml, /^sdkwork-routes-agents-http-shared(?:\.workspace)?\s*=/mu);
  assert.doesNotMatch(cargoToml, /sdkwork_routes_agents_app_api\s*=/u);
  assert.doesNotMatch(cargoToml, /sdkwork_routes_agents_http_shared\s*=/u);
  assert.doesNotMatch(cargoToml, /package = "sdkwork-routes-agents-app-api"/u);
  assert.doesNotMatch(cargoToml, /package = "sdkwork-routes-agents-http-shared"/u);
  assert.equal(
    fs.existsSync(
      path.join(root, 'crates/sdkwork-api-agents-assembly/specs/component.spec.json'),
    ),
    true,
  );
  const componentSpec = JSON.parse(
    fs.readFileSync(
      path.join(root, 'crates/sdkwork-api-agents-assembly/specs/component.spec.json'),
      'utf8',
    ),
  );
  assert.equal(componentSpec.contracts.layerRole, 'runtime-composition');
  assert.equal(componentSpec.contracts.routeManifest, undefined);
  assert.deepEqual(componentSpec.contracts.providedPorts, [
    { name: 'agentsApiAssembly', export: '.' },
  ]);
  for (const requiredSpec of [
    'COMPONENT_SPEC.md',
    'API_ASSEMBLY_SPEC.md',
    'APPLICATION_GATEWAY_SPEC.md',
    'WEB_FRAMEWORK_SPEC.md',
    'DATABASE_FRAMEWORK_SPEC.md',
    'APP_RUNTIME_TOPOLOGY_SPEC.md',
    'CODE_STYLE_SPEC.md',
    'NAMING_SPEC.md',
    'RUST_CODE_SPEC.md',
    'TEST_SPEC.md',
  ]) {
    assert.ok(
      componentSpec.canonicalSpecs.some(({ file }) => file === requiredSpec),
      `generated component spec must reference ${requiredSpec}`,
    );
  }
  const libRs = fs.readFileSync(
    path.join(root, 'crates/sdkwork-api-agents-assembly/src/lib.rs'),
    'utf8',
  );
  assert.match(libRs, /^mod bootstrap;$/mu);
  assert.match(libRs, /assemble_api_router/u);
  assert.match(libRs, /assemble_app_api_contribution/u);
  assert.match(libRs, /ApiAssemblyContext/u);
  assert.doesNotMatch(libRs, /router\.merge\(sdkwork_routes_/u);
  const bootstrapRs = fs.readFileSync(
    path.join(root, 'crates/sdkwork-api-agents-assembly/src/bootstrap.rs'),
    'utf8',
  );
  assert.match(bootstrapRs, /use sdkwork_web_core::\{DomainContextInjector, HttpRouteManifest\};/u);
  assert.match(bootstrapRs, /pub async fn assemble_app_api_contribution/u);
  assert.match(
    bootstrapRs,
    /sdkwork_routes_agents_app_api::gateway_mount_business\(\)/u,
  );
  assert.doesNotMatch(
    bootstrapRs,
    /sdkwork_routes_agents_app_api::gateway_mount\(\)/u,
  );
});

test('API assembly discovers aggregate subdomain routes when app-code routes are absent', () => {
  const root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-')),
    'sdkwork-deployments',
  );
  writeText(
    path.join(root, 'agent.app.config.json'),
    `${JSON.stringify({ backend: { appId: 'sdkwork-deployments' } }, null, 2)}\n`,
  );
  writeText(
    path.join(root, 'Cargo.toml'),
    [
      '[workspace]',
      'members = [',
      '  "crates/sdkwork-routes-deploy-app-api",',
      '  "crates/sdkwork-routes-deploy-backend-api",',
      '  "crates/sdkwork-routes-health-app-api"',
      ']',
      '',
      '[workspace.package]',
      'edition = "2021"',
      'version = "0.1.0"',
      '',
      '[workspace.dependencies]',
      'axum = "0.8"',
      'tokio = { version = "1", features = ["macros", "rt-multi-thread"] }',
      'sdkwork-routes-deploy-app-api = { path = "crates/sdkwork-routes-deploy-app-api" }',
      'sdkwork-routes-deploy-backend-api = { path = "crates/sdkwork-routes-deploy-backend-api" }',
      '',
    ].join('\n'),
  );
  for (const packageName of [
    'sdkwork-routes-deploy-app-api',
    'sdkwork-routes-deploy-backend-api',
    'sdkwork-routes-health-app-api',
  ]) {
    const crateRoot = path.join(root, 'crates', packageName);
    writeText(
      path.join(crateRoot, 'Cargo.toml'),
      `[package]\nname = "${packageName}"\nversion = "0.0.0"\n`,
    );
    writeText(
      path.join(crateRoot, 'src/lib.rs'),
      'pub fn gateway_mount() -> axum::Router { axum::Router::new() }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
    );
  }

  const result = materializeApiAssembly(root);

  assert.equal(result.ok, true);
  assert.equal(result.routeCrates, 2);
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(root, 'crates/sdkwork-api-deployments-assembly/assembly-manifest.json'),
      'utf8',
    ),
  );
  assert.deepEqual(
    manifest.routeCrates.map((entry) => entry.packageName),
    ['sdkwork-routes-deploy-app-api', 'sdkwork-routes-deploy-backend-api'],
  );

  const secondResult = materializeApiAssembly(root);
  assert.equal(secondResult.ok, true);
  const cargoToml = fs.readFileSync(
    path.join(root, 'crates/sdkwork-api-deployments-assembly/Cargo.toml'),
    'utf8',
  );
  assert.equal(
    (cargoToml.match(/^sdkwork-routes-deploy-app-api(?:\.workspace)?\s*=/gmu) ?? []).length,
    1,
  );
  assert.equal(
    (cargoToml.match(/^sdkwork-routes-deploy-backend-api(?:\.workspace)?\s*=/gmu) ?? []).length,
    1,
  );
});

test('API assembly dependency rendering deduplicates preserved Cargo keys', () => {
  const root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-')),
    'sdkwork-agents',
  );
  writeText(
    path.join(root, 'agent.app.config.json'),
    `${JSON.stringify({ backend: { appId: 'sdkwork-agents' } }, null, 2)}\n`,
  );
  writeText(
    path.join(root, 'Cargo.toml'),
    [
      '[workspace]',
      'members = ["crates/sdkwork-routes-agents-app-api"]',
      '',
      '[workspace.package]',
      'edition = "2021"',
      'version = "0.1.0"',
      '',
      '[workspace.dependencies]',
      'axum = "0.8"',
      'tokio = "1"',
      '',
    ].join('\n'),
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-agents-app-api/Cargo.toml'),
    '[package]\nname = "sdkwork-routes-agents-app-api"\nversion = "0.0.0"\n',
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-agents-app-api/src/lib.rs'),
    'pub fn gateway_mount() -> axum::Router { axum::Router::new() }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
  );
  writeText(
    path.join(root, 'crates/sdkwork-api-agents-assembly/Cargo.toml'),
    [
      '[package]',
      'name = "sdkwork-api-agents-assembly"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[dependencies]',
      'axum = "0.8"',
      'tokio = "1"',
      'serde = "1"',
      '',
      '[dev-dependencies]',
      'tower = "0.5"',
      '',
    ].join('\n'),
  );

  const result = materializeApiAssembly(root);
  assert.equal(result.ok, true);
  const cargoToml = fs.readFileSync(
    path.join(root, 'crates/sdkwork-api-agents-assembly/Cargo.toml'),
    'utf8',
  );
  assert.equal((cargoToml.match(/^axum(?:\.workspace)?\s*=/gmu) ?? []).length, 1);
  assert.equal((cargoToml.match(/^tokio(?:\.workspace)?\s*=/gmu) ?? []).length, 1);
  assert.equal((cargoToml.match(/^serde(?:\.workspace)?\s*=/gmu) ?? []).length, 1);
  assert.match(cargoToml, /^\[dev-dependencies\]$/mu);
  assert.equal((cargoToml.match(/^tower(?:\.workspace)?\s*=/gmu) ?? []).length, 1);
});

test('API assembly materializer never writes an assembly for the platform cloud gateway', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-'));
  const root = path.join(workspace, 'sdkwork-api-cloud-gateway');
  writeText(path.join(root, 'agent.app.config.json'), '{}\n');

  const result = materializeApiAssembly(root);

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(
    fs.existsSync(path.join(root, 'crates', 'sdkwork-api-api-cloud-gateway-assembly')),
    false,
  );
});

test('replaces a legacy generated gateway bootstrap after route crates are retired', () => {
  const root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-')),
    'sdkwork-agents',
  );
  writeText(path.join(root, 'agent.app.config.json'), '{}\n');
  writeText(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = []\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\n',
  );
  const bootstrapPath = path.join(root, 'crates', 'sdkwork-api-agents-assembly', 'src', 'bootstrap.rs');
  writeText(
    bootstrapPath,
    '//! Generated gateway bootstrap for sdkwork-agents.\npub fn assemble_api_router() { sdkwork_routes_agents_app_api::gateway_mount(); }\n',
  );

  const result = materializeApiAssembly(root);

  assert.equal(result.ok, true);
  const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
  assert.doesNotMatch(bootstrap, /sdkwork_routes_agents_app_api/u);
  assert.match(bootstrap, /Router::new\(\)/u);
  const generated = fs.readFileSync(
    path.join(root, 'crates', 'sdkwork-api-agents-assembly', 'src', 'generated.rs'),
    'utf8',
  );
  assert.match(generated, /ROUTE_CRATE_PACKAGES: &\[&str\] = &\[\];/u);
});

test('API assembly includes application-code and capability-named route members together', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-'));
  const root = path.join(workspace, 'sdkwork-demo');
  writeText(path.join(root, 'agent.app.config.json'), '{}\n');
  writeText(
    path.join(root, 'Cargo.toml'),
    [
      '[workspace]',
      'members = [',
      '  "crates/sdkwork-routes-demo-app-api",',
      '  "crates/sdkwork-routes-membership-backend-api"',
      ']',
      '',
    ].join('\n'),
  );
  for (const packageName of [
    'sdkwork-routes-demo-app-api',
    'sdkwork-routes-membership-backend-api',
  ]) {
    writeText(
      path.join(root, 'crates', packageName, 'Cargo.toml'),
      `[package]\nname = "${packageName}"\nversion = "0.0.0"\n`,
    );
    writeText(
      path.join(root, 'crates', packageName, 'src', 'lib.rs'),
      'pub fn gateway_mount() -> axum::Router { axum::Router::new() }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
    );
  }

  const result = materializeApiAssembly(root);
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(root, 'crates', 'sdkwork-api-demo-assembly', 'assembly-manifest.json'),
      'utf8',
    ),
  );

  assert.equal(result.routeCrates, 2);
  assert.deepEqual(
    manifest.routeCrates.map((route) => route.packageName),
    ['sdkwork-routes-demo-app-api', 'sdkwork-routes-membership-backend-api'],
  );
});

test('API assembly discovers internal-api route crates for application ingress', () => {
  const root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-')),
    'sdkwork-drive',
  );
  writeText(path.join(root, 'agent.app.config.json'), '{}\n');
  writeText(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = ["crates/sdkwork-routes-drive-internal-api"]\n',
  );
  const routeRoot = path.join(root, 'crates', 'sdkwork-routes-drive-internal-api');
  writeText(
    path.join(routeRoot, 'Cargo.toml'),
    '[package]\nname = "sdkwork-routes-drive-internal-api"\nversion = "0.1.0"\n',
  );
  writeText(
    path.join(routeRoot, 'src', 'lib.rs'),
    'mod routes;\npub use routes::*;\n',
  );
  writeText(
    path.join(routeRoot, 'src', 'routes.rs'),
    'pub async fn gateway_mount() -> axum::Router { axum::Router::new() }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
  );
  writeText(
    path.join(routeRoot, 'specs', 'component.spec.json'),
    `${JSON.stringify({
      component: { surface: 'internal-api' },
      contracts: { routeManifest: 'route-manifest.json' },
    })}\n`,
  );
  writeText(path.join(routeRoot, 'route-manifest.json'), '{}\n');

  const result = materializeApiAssembly(root);
  assert.equal(result.ok, true);
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(root, 'crates', 'sdkwork-api-drive-assembly', 'assembly-manifest.json'),
      'utf8',
    ),
  );
  assert.equal(manifest.routeCrates.length, 1);
  assert.equal(manifest.routeCrates[0].surface, 'internal-api');
  assert.equal(manifest.routeCrates[0].packageName, 'sdkwork-routes-drive-internal-api');
});

test('refuses incompatible route mount parameters before writing an assembly', () => {
  const root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-')),
    'sdkwork-demo',
  );
  writeText(path.join(root, 'agent.app.config.json'), '{}\n');
  writeText(
    path.join(root, 'Cargo.toml'),
    [
      '[workspace]',
      'members = [',
      '  "crates/sdkwork-routes-demo-app-api",',
      '  "crates/sdkwork-routes-demo-backend-api"',
      ']',
      '',
    ].join('\n'),
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-demo-app-api/Cargo.toml'),
    '[package]\nname = "sdkwork-routes-demo-app-api"\nversion = "0.0.0"\n',
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-demo-app-api/src/lib.rs'),
    'pub async fn gateway_mount(pool: sqlx::SqlitePool) -> axum::Router { axum::Router::new() }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-demo-backend-api/Cargo.toml'),
    '[package]\nname = "sdkwork-routes-demo-backend-api"\nversion = "0.0.0"\n',
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-demo-backend-api/src/lib.rs'),
    'pub async fn gateway_mount(host: std::sync::Arc<DemoServiceHost>) -> axum::Router { axum::Router::new() }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
  );

  assert.throws(
    () => materializeApiAssembly(root),
    /gateway_mount parameters are incompatible/u,
  );
  assert.equal(
    fs.existsSync(path.join(root, 'crates/sdkwork-api-demo-assembly')),
    false,
  );
});
