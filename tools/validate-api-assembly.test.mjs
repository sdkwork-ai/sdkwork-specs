import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { materializeApiAssembly } from './materialize-api-assembly.mjs';
import { validateApiAssembly } from './validate-api-assembly.mjs';

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-'));
  const root = path.join(workspace, 'sdkwork-demo');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'agent.app.config.json'),
    JSON.stringify({ backend: { appId: 'sdkwork-demo' } }, null, 2),
  );
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = ["crates/sdkwork-routes-demo-app-api"]\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\nlicense = "MIT"\n\n[workspace.dependencies]\naxum = "0.8"\n',
  );
  const routeRoot = path.join(root, 'crates', 'sdkwork-routes-demo-app-api');
  fs.mkdirSync(path.join(routeRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(routeRoot, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(routeRoot, 'Cargo.toml'), '[package]\nname = "sdkwork-routes-demo-app-api"\nversion = "0.1.0"\nedition = "2021"\n');
  fs.writeFileSync(
    path.join(routeRoot, 'src', 'lib.rs'),
    'pub fn gateway_mount() -> axum::Router { axum::Router::new().route("/demo", axum::routing::get(|| async {})) }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
  );
  fs.writeFileSync(
    path.join(routeRoot, 'specs', 'component.spec.json'),
    JSON.stringify({ contracts: { routeManifest: 'route-manifest.json' } }, null, 2),
  );
  fs.writeFileSync(path.join(routeRoot, 'route-manifest.json'), '{}\n');
  return root;
}

test('materializes a deterministic canonical API assembly manifest', () => {
  const root = fixture();
  assert.equal(materializeApiAssembly(root).ok, true);
  const manifestPath = path.join(root, 'crates', 'sdkwork-api-demo-assembly', 'assembly-manifest.json');
  const first = fs.readFileSync(manifestPath, 'utf8');
  assert.equal(materializeApiAssembly(root).ok, true);
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), first);
  const manifest = JSON.parse(first);
  assert.equal(manifest.kind, 'sdkwork.api.assembly');
  assert.equal(manifest.packageName, 'sdkwork-api-demo-assembly');
  assert.equal(Object.hasOwn(manifest, 'generatedAt'), false);
  assert.equal(validateApiAssembly(root).ok, true);
});

test('normalizes application-root route manifest declarations without traversal segments', () => {
  const root = fixture();
  const componentPath = path.join(
    root,
    'crates',
    'sdkwork-routes-demo-app-api',
    'specs',
    'component.spec.json',
  );
  fs.writeFileSync(
    componentPath,
    JSON.stringify({
      contracts: {
        routeManifest: 'sdks/_route-manifests/app-api/sdkwork-routes-demo-app-api.route-manifest.json',
      },
    }, null, 2),
  );
  const routeManifestPath = path.join(
    root,
    'sdks',
    '_route-manifests',
    'app-api',
    'sdkwork-routes-demo-app-api.route-manifest.json',
  );
  fs.mkdirSync(path.dirname(routeManifestPath), { recursive: true });
  fs.writeFileSync(routeManifestPath, '{}\n');

  assert.equal(materializeApiAssembly(root).ok, true);
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(root, 'crates', 'sdkwork-api-demo-assembly', 'assembly-manifest.json'),
      'utf8',
    ),
  );
  assert.equal(
    manifest.routeCrates[0].routeManifestRef,
    'sdks/_route-manifests/app-api/sdkwork-routes-demo-app-api.route-manifest.json',
  );
  assert.doesNotMatch(manifest.routeCrates[0].routeManifestRef, /(?:^|\/)\.\.?\//u);
  assert.equal(validateApiAssembly(root).ok, true);
});

test('accepts a Rust route manifest source reference with an exported function symbol', () => {
  const root = fixture();
  const componentPath = path.join(
    root,
    'crates',
    'sdkwork-routes-demo-app-api',
    'specs',
    'component.spec.json',
  );
  fs.writeFileSync(
    componentPath,
    JSON.stringify({
      contracts: {
        routeManifest: 'src/manifest.rs#demo_route_manifest',
      },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(root, 'crates', 'sdkwork-routes-demo-app-api', 'src', 'manifest.rs'),
    'pub fn demo_route_manifest() {}\n',
  );

  assert.equal(materializeApiAssembly(root).ok, true);
  assert.equal(validateApiAssembly(root).ok, true);
});

test('rejects a declared route manifest that does not exist', () => {
  const root = fixture();
  const componentPath = path.join(
    root,
    'crates',
    'sdkwork-routes-demo-app-api',
    'specs',
    'component.spec.json',
  );
  fs.writeFileSync(
    componentPath,
    JSON.stringify({
      contracts: {
        routeManifest: 'sdks/_route-manifests/app-api/missing.route-manifest.json',
      },
    }, null, 2),
  );

  const materialized = materializeApiAssembly(root);
  assert.equal(materialized.ok, false);
  assert.match(materialized.message, /route manifest contract is unresolved/u);

  const result = validateApiAssembly(root);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /route manifest does not exist/u);
});

test('rejects a retired gateway assembly manifest kind', () => {
  const root = fixture();
  const materialized = materializeApiAssembly(root);
  assert.equal(materialized.ok, true, materialized.message);
  const manifestPath = path.join(root, materialized.crateDir, 'assembly-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.kind = 'sdkwork.gateway.assembly';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = validateApiAssembly(root);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /kind must be sdkwork\.api\.assembly/u);
});

test('accepts UTF-8 BOM in application and component JSON inputs', () => {
  const root = fixture();
  for (const filePath of [
    path.join(root, 'agent.app.config.json'),
    path.join(root, 'crates', 'sdkwork-routes-demo-app-api', 'specs', 'component.spec.json'),
  ]) {
    const value = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(filePath, `\uFEFF${value}`, 'utf8');
  }

  assert.equal(materializeApiAssembly(root).ok, true);
  assert.equal(validateApiAssembly(root).ok, true);
});

test('does not require an application assembly from the platform cloud gateway repository', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-'));
  const root = path.join(workspace, 'sdkwork-api-cloud-gateway');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'agent.app.config.json'),
    JSON.stringify({ backend: { appId: 'sdkwork-api-cloud-gateway' } }, null, 2),
  );

  const result = validateApiAssembly(root);

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.match(result.message, /consumes application assemblies/u);
});

test('rejects a router-only default API assembly contribution', () => {
  const root = fixture();
  assert.equal(materializeApiAssembly(root).ok, true);
  const bootstrapPath = path.join(
    root,
    'crates',
    'sdkwork-api-demo-assembly',
    'src',
    'bootstrap.rs',
  );
  fs.writeFileSync(
    bootstrapPath,
    'pub struct ApiAssembly { pub router: axum::Router }\npub fn assemble_api_router() -> ApiAssembly { ApiAssembly { router: axum::Router::new() } }\n',
  );

  const result = validateApiAssembly(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /router-only or incomplete|default ApiAssembly export is missing/u);
  assert.match(result.errors.join('\n'), /route_manifest/u);
});

test('accepts a runtime bundle with an exact complete contribution field', () => {
  const root = fixture();
  assert.equal(materializeApiAssembly(root).ok, true);
  const bootstrapPath = path.join(
    root,
    'crates',
    'sdkwork-api-demo-assembly',
    'src',
    'bootstrap.rs',
  );
  fs.writeFileSync(
    bootstrapPath,
    [
      'use sdkwork_web_bootstrap::ApiAssemblyContribution;',
      'pub struct ApiAssemblyRuntime;',
      'pub struct ApiAssembly {',
      '  pub contribution: ApiAssemblyContribution,',
      '  pub runtime: ApiAssemblyRuntime,',
      '}',
      'pub fn assemble_api_router() -> Result<ApiAssembly, String> { unimplemented!() }',
      '',
    ].join('\n'),
  );

  const result = validateApiAssembly(root);

  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('rejects complete manifest drift, including application identity', () => {
  const root = fixture();
  const materialized = materializeApiAssembly(root);
  assert.equal(materialized.ok, true, materialized.message);
  const manifestPath = path.join(root, materialized.crateDir, 'assembly-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.applicationCode = 'other';
  manifest.routeCrates[0].mountOrder = 99;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = validateApiAssembly(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /applicationCode mismatch/u);
  assert.match(result.errors.join('\n'), /content drift/u);
});

test('API assembly schema reserves the platform cloud gateway identity', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, '..', 'schemas', 'sdkwork.api.assembly.schema.v1.json'),
      'utf8',
    ),
  );
  assert.equal(new RegExp(schema.properties.applicationCode.pattern, 'u').test('birdcoder'), true);
  assert.equal(new RegExp(schema.properties.applicationCode.pattern, 'u').test('api-cloud-gateway'), false);
  assert.equal(
    new RegExp(schema.properties.packageName.pattern, 'u').test('sdkwork-api-api-cloud-gateway-assembly'),
    false,
  );
});

test('rejects route crates without component ownership contracts', () => {
  const root = fixture();
  const materialized = materializeApiAssembly(root);
  assert.equal(materialized.ok, true, materialized.message);
  fs.rmSync(
    path.join(root, 'crates', 'sdkwork-routes-demo-app-api', 'specs', 'component.spec.json'),
  );

  const result = validateApiAssembly(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /missing specs\/component\.spec\.json ownership contract/u);
});

test('rejects served route crates whose gateway mount is descriptor-only', () => {
  const root = fixture();
  const routeLib = path.join(root, 'crates', 'sdkwork-routes-demo-app-api', 'src', 'lib.rs');
  fs.writeFileSync(
    routeLib,
    'pub fn gateway_mount() -> axum::Router { axum::Router::new() }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
  );
  assert.equal(materializeApiAssembly(root).ok, true);

  const result = validateApiAssembly(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /gateway_mount is descriptor-only/u);
  assert.match(result.errors.join('\n'), /must mount executable handlers/u);
});

test('rejects served route crates whose gateway mount delegates to an empty router builder', () => {
  const root = fixture();
  const routeRoot = path.join(root, 'crates', 'sdkwork-routes-demo-app-api');
  fs.writeFileSync(
    path.join(routeRoot, 'src', 'lib.rs'),
    [
      'mod routes;',
      'use axum::Router;',
      'pub async fn gateway_mount() -> Router { routes::build_router_with_framework().await }',
      'pub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(routeRoot, 'src', 'routes.rs'),
    [
      'use axum::Router;',
      'pub async fn build_router_with_framework() -> Router { build_router() }',
      'pub fn build_router() -> Router { Router::new() }',
      '',
    ].join('\n'),
  );
  assert.equal(materializeApiAssembly(root).ok, true);

  const result = validateApiAssembly(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /delegated builders to Router::new/u);
  assert.match(result.errors.join('\n'), /must mount executable handlers/u);
});

test('rejects served route crates whose gateway mount returns a route manifest', () => {
  const root = fixture();
  const routeLib = path.join(root, 'crates', 'sdkwork-routes-demo-app-api', 'src', 'lib.rs');
  fs.writeFileSync(
    routeLib,
    'pub struct RouterApiRouteManifest;\npub fn gateway_mount() -> RouterApiRouteManifest { RouterApiRouteManifest }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
  );
  assert.equal(materializeApiAssembly(root).ok, true);

  const result = validateApiAssembly(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /gateway_mount returns RouterApiRouteManifest/u);
  assert.match(result.errors.join('\n'), /must return an executable axum::Router/u);
});

test('accepts executable gateway mounts returned through Result', () => {
  const root = fixture();
  const routeLib = path.join(root, 'crates', 'sdkwork-routes-demo-app-api', 'src', 'lib.rs');
  fs.writeFileSync(
    routeLib,
    'pub async fn gateway_mount() -> Result<axum::Router, String> { Ok(axum::Router::new().route("/demo", axum::routing::get(|| async {}))) }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
  );
  assert.equal(materializeApiAssembly(root).ok, true);

  const result = validateApiAssembly(root);

  assert.equal(result.ok, true, result.errors?.join('\n'));
});

test('accepts executable gateway mounts with generic parameters and a where clause', () => {
  const root = fixture();
  const routeLib = path.join(root, 'crates', 'sdkwork-routes-demo-app-api', 'src', 'lib.rs');
  fs.writeFileSync(
    routeLib,
    'pub fn gateway_mount<R>(service: Service<R>) -> axum::Router\nwhere\n    R: Repository,\n{ axum::Router::new().route("/demo", axum::routing::get(|| async {})) }\npub fn gateway_route_manifest() -> sdkwork_web_core::HttpRouteManifest { sdkwork_web_core::HttpRouteManifest::from_owned_routes(Vec::new()) }\n',
  );
  assert.equal(materializeApiAssembly(root).ok, true);

  const result = validateApiAssembly(root);

  assert.equal(result.ok, true, result.errors?.join('\n'));
});

test('rejects apiMode none when authored production Rust sources mount HTTP routes', () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'crates', 'sdkwork-routes-demo-app-api'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = []\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\nlicense = "MIT"\n',
  );
  const serviceSource = path.join(root, 'services', 'demo', 'src');
  fs.mkdirSync(serviceSource, { recursive: true });
  fs.writeFileSync(
    path.join(serviceSource, 'router.rs'),
    'use axum::{routing::get, Router};\n\npub fn router() -> Router {\n    Router::new().route("/healthz", get(|| async { "ok" }))\n}\n',
  );
  assert.equal(materializeApiAssembly(root).ok, true);

  const result = validateApiAssembly(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /apiMode none contradicts executable authored HTTP routing/u);
  assert.match(result.errors.join('\n'), /services\/demo\/src\/router\.rs/u);
});

test('accepts apiMode none when Rust routing evidence exists only in test fixtures', () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'crates', 'sdkwork-routes-demo-app-api'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = []\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\nlicense = "MIT"\n',
  );
  const fixtureSource = path.join(root, 'services', 'demo', 'tests', 'fixtures');
  fs.mkdirSync(fixtureSource, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureSource, 'router.rs'),
    'use axum::{routing::get, Router};\nfn router() -> Router { Router::new().route("/fixture", get(|| async {})) }\n',
  );
  assert.equal(materializeApiAssembly(root).ok, true);

  const result = validateApiAssembly(root);

  assert.equal(result.ok, true, result.errors?.join('\n'));
});

test('accepts apiMode none for canonical process infrastructure routes only', () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'crates', 'sdkwork-routes-demo-app-api'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = []\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\nlicense = "MIT"\n',
  );
  const serviceSource = path.join(root, 'services', 'demo', 'src');
  fs.mkdirSync(serviceSource, { recursive: true });
  fs.writeFileSync(
    path.join(serviceSource, 'probe.rs'),
    'use axum::{routing::get, Router};\nuse sdkwork_web_bootstrap::{mount_infra_routes, ServiceRouterConfig};\n\npub fn probe_router() -> Router {\n    mount_infra_routes(Router::new(), ServiceRouterConfig::default()).route("/metrics", get(|| async { "ok" }))\n}\n',
  );
  assert.equal(materializeApiAssembly(root).ok, true);

  const result = validateApiAssembly(root);

  assert.equal(result.ok, true, result.errors?.join('\n'));
});

test('rejects business routes mixed into canonical process infrastructure', () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'crates', 'sdkwork-routes-demo-app-api'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = []\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\nlicense = "MIT"\n',
  );
  const serviceSource = path.join(root, 'services', 'demo', 'src');
  fs.mkdirSync(serviceSource, { recursive: true });
  fs.writeFileSync(
    path.join(serviceSource, 'router.rs'),
    'use axum::{routing::get, Router};\nuse sdkwork_web_bootstrap::{mount_infra_routes, ServiceRouterConfig};\n\npub fn router() -> Router {\n    mount_infra_routes(Router::new(), ServiceRouterConfig::default()).route("/app/v3/api/demo", get(|| async { "ok" }))\n}\n',
  );
  assert.equal(materializeApiAssembly(root).ok, true);

  const result = validateApiAssembly(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /apiMode none contradicts executable authored HTTP routing/u);
});

test('rejects apiMode none assemblies with stale route crate bootstrap references', () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'crates', 'sdkwork-routes-demo-app-api'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = []\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\nlicense = "MIT"\n',
  );
  assert.equal(materializeApiAssembly(root).ok, true);
  fs.writeFileSync(
    path.join(root, 'crates', 'sdkwork-api-demo-assembly', 'src', 'bootstrap.rs'),
    'pub fn assemble_api_router() { sdkwork_routes_demo_app_api::gateway_mount(); }\n',
  );

  const result = validateApiAssembly(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /references undeclared route crates/u);
  assert.match(result.errors.join('\n'), /sdkwork_routes_demo_app_api/u);
});

test('does not skip a non-application repository whose served assembly references missing route crates', () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'agent.app.config.json'));
  fs.rmSync(path.join(root, 'crates', 'sdkwork-routes-demo-app-api'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = ["crates/sdkwork-api-demo-assembly"]\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\nlicense = "MIT"\n',
  );
  const assemblyRoot = path.join(root, 'crates', 'sdkwork-api-demo-assembly');
  fs.mkdirSync(path.join(assemblyRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(assemblyRoot, 'assembly-manifest.json'),
    `${JSON.stringify({
      kind: 'sdkwork.api.assembly',
      schemaVersion: 1,
      applicationCode: 'demo',
      apiMode: 'served',
      packageName: 'sdkwork-api-demo-assembly',
      crateDir: 'crates/sdkwork-api-demo-assembly',
      routeCrates: [{
        packageName: 'sdkwork-routes-demo-app-api',
        memberDir: 'crates/sdkwork-routes-demo-app-api',
        libName: 'sdkwork_routes_demo_app_api',
        surface: 'app-api',
        pathPrefix: '/app/v3/api',
        mountOrder: 0,
        componentRef: 'crates/sdkwork-routes-demo-app-api/specs/component.spec.json',
        routeManifestRef: 'crates/sdkwork-routes-demo-app-api/route-manifest.json',
        sourceRef: 'crates/sdkwork-routes-demo-app-api/Cargo.toml',
      }],
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(assemblyRoot, 'src', 'bootstrap.rs'),
    'pub fn assemble_api_router() { sdkwork_routes_demo_app_api::gateway_mount(); }\n',
  );

  const result = validateApiAssembly(root);

  assert.equal(result.skipped, undefined);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /route crate list drift/u);
  assert.match(result.errors.join('\n'), /references undeclared route crates/u);
});
