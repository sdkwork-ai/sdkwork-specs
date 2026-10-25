import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { materializeApiAssembly } from './materialize-api-assembly.mjs';
import { materializeStandaloneGateway } from './materialize-standalone-gateway.mjs';

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-standalone-gateway-'));
  const root = path.join(workspace, 'sdkwork-demo');
  const routeRoot = path.join(root, 'crates', 'sdkwork-routes-demo-app-api');
  fs.mkdirSync(path.join(routeRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(routeRoot, 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'agent.app.config.json'),
    JSON.stringify({ kind: 'agent.app', app: { key: 'sdkwork-demo' } }, null, 2),
  );
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = [\n    "crates/sdkwork-routes-demo-app-api",\n]\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\nlicense = "MIT"\n\n[workspace.dependencies]\naxum = "0.8"\n',
  );
  fs.writeFileSync(
    path.join(routeRoot, 'Cargo.toml'),
    '[package]\nname = "sdkwork-routes-demo-app-api"\nversion.workspace = true\nedition.workspace = true\n\n[dependencies]\naxum.workspace = true\n',
  );
  fs.writeFileSync(
    path.join(routeRoot, 'src', 'lib.rs'),
    'pub fn gateway_mount() -> axum::Router { axum::Router::new().route("/demo", axum::routing::get(|| async {})) }\n',
  );
  fs.writeFileSync(
    path.join(routeRoot, 'specs', 'component.spec.json'),
    JSON.stringify({ contracts: { routeManifest: 'route-manifest.json' } }, null, 2),
  );
  fs.writeFileSync(path.join(routeRoot, 'route-manifest.json'), '{}\n');
  assert.equal(materializeApiAssembly(root).ok, true);
  return root;
}

test('materializes a thin Web Framework standalone host from a zero-argument assembly', () => {
  const root = fixture();

  const result = materializeStandaloneGateway(root, { write: true });

  assert.equal(result.skipped, false);
  const gatewayRoot = path.join(root, 'crates', 'sdkwork-api-demo-standalone-gateway');
  const cargo = fs.readFileSync(path.join(gatewayRoot, 'Cargo.toml'), 'utf8');
  const main = fs.readFileSync(path.join(gatewayRoot, 'src', 'main.rs'), 'utf8');
  assert.match(cargo, /sdkwork-api-demo-assembly\.workspace = true/u);
  assert.match(cargo, /sdkwork-web-bootstrap\.workspace = true/u);
  assert.match(main, /service_router/u);
  assert.match(main, /sdkwork_web_bootstrap::serve/u);
  assert.match(main, /init_tracing_from_env/u);
  assert.doesNotMatch(main, /TcpListener::bind/u);
  assert.match(
    fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8'),
    /members = \[\n    "crates\/sdkwork-api-demo-standalone-gateway",\n/u,
  );
  assert.match(
    fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8'),
    /^tokio = \{ version = "1\.48", features = \["macros", "rt-multi-thread"\] \}/mu,
  );
});

test('deduplicates an existing canonical gateway Cargo workspace member', () => {
  const root = fixture();
  materializeStandaloneGateway(root, { write: true });
  const cargoPath = path.join(root, 'Cargo.toml');
  const member = 'crates/sdkwork-api-demo-standalone-gateway';
  const cargo = fs.readFileSync(cargoPath, 'utf8').replace(
    `    "${member}",`,
    `    "${member}",\n    "${member}",`,
  );
  fs.writeFileSync(cargoPath, cargo);

  const result = materializeStandaloneGateway(root, { write: true });

  assert.equal(result.skipped, false);
  const repaired = fs.readFileSync(cargoPath, 'utf8');
  assert.equal(repaired.match(new RegExp(`"${member}"`, 'gu')).length, 1);
});

test('updates a previously generated scaffold and then becomes idempotent', () => {
  const root = fixture();
  materializeStandaloneGateway(root, { write: true });
  const mainPath = path.join(
    root,
    'crates',
    'sdkwork-api-demo-standalone-gateway',
    'src',
    'main.rs',
  );
  fs.writeFileSync(
    mainPath,
    'use sdkwork_api_demo_assembly as api_assembly;\nfn main() { let _ = api_assembly::assembly_route_count(); }\n',
  );

  const updated = materializeStandaloneGateway(root, { write: true });
  const repeated = materializeStandaloneGateway(root, { write: true });

  assert.equal(updated.skipped, false);
  assert.equal(repeated.skipped, true);
  assert.match(fs.readFileSync(mainPath, 'utf8'), /sdkwork_web_bootstrap::serve/u);
});

test('refuses to host a served assembly backed only by descriptor mounts', () => {
  const root = fixture();
  fs.writeFileSync(
    path.join(root, 'crates', 'sdkwork-routes-demo-app-api', 'src', 'lib.rs'),
    'pub fn gateway_mount() -> axum::Router { axum::Router::new() }\n',
  );

  assert.throws(
    () => materializeStandaloneGateway(root, { write: true }),
    /gateway_mount is descriptor-only/u,
  );
  assert.equal(
    fs.existsSync(path.join(root, 'crates', 'sdkwork-api-demo-standalone-gateway')),
    false,
  );
});

test('refuses to guess application-specific assembly context parameters', () => {
  const root = fixture();
  const bootstrapPath = path.join(root, 'crates', 'sdkwork-api-demo-assembly', 'src', 'bootstrap.rs');
  const bootstrap = fs.readFileSync(bootstrapPath, 'utf8').replace(
    'assemble_api_router()',
    'assemble_api_router(context: DemoContext)',
  );
  fs.writeFileSync(bootstrapPath, bootstrap);

  assert.throws(
    () => materializeStandaloneGateway(root, { write: true }),
    /requires application-specific wiring/u,
  );
});

test('skips non-Cargo application roots instead of inventing a Rust host', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "sdkwork-demo"\nversion = "0.1.0"\n');

  const result = materializeStandaloneGateway(root, { write: true });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'non-cargo-application');
  assert.equal(
    fs.existsSync(path.join(root, 'crates', 'sdkwork-api-demo-standalone-gateway')),
    false,
  );
});
