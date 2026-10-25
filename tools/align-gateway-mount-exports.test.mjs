import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignGatewayMountExports } from './align-gateway-mount-exports.mjs';

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function createRouteRepo(libRs) {
  const root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-gateway-mount-')),
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
      '  "crates/sdkwork-routes-agents-app-api"',
      ']',
      '',
    ].join('\n'),
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-agents-app-api/Cargo.toml'),
    '[package]\nname = "sdkwork-routes-agents-app-api"\nversion = "0.0.0"\n[dependencies]\n',
  );
  writeText(path.join(root, 'crates/sdkwork-routes-agents-app-api/src/lib.rs'), libRs);
  return root;
}

test('aligner does not double-qualify axum router return types', () => {
  const root = createRouteRepo(
    [
      'pub struct AgentHttpState;',
      'pub async fn build_served_router(state: AgentHttpState) -> axum::Router {',
      '    let _ = state;',
      '    axum::Router::new()',
      '}',
      '',
    ].join('\n'),
  );

  const report = alignGatewayMountExports(root);

  assert.equal(report.results[0].status, 'updated');
  const libRs = fs.readFileSync(
    path.join(root, 'crates/sdkwork-routes-agents-app-api/src/lib.rs'),
    'utf8',
  );
  assert.match(libRs, /pub async fn gateway_mount\(state: AgentHttpState\) -> axum::Router/u);
  assert.doesNotMatch(libRs, /axum::axum::Router/u);
  assert.doesNotMatch(libRs, /^use axum::Router;$/mu);
});

test('aligner repairs existing double-qualified gateway mount signatures', () => {
  const root = createRouteRepo(
    [
      'pub fn gateway_mount() -> axum::axum::Router {',
      '    axum::Router::new()',
      '}',
      '',
    ].join('\n'),
  );

  const report = alignGatewayMountExports(root);

  assert.equal(report.results[0].status, 'updated-existing');
  const libRs = fs.readFileSync(
    path.join(root, 'crates/sdkwork-routes-agents-app-api/src/lib.rs'),
    'utf8',
  );
  assert.match(libRs, /pub fn gateway_mount\(\) -> axum::Router/u);
  assert.doesNotMatch(libRs, /axum::axum::Router/u);
});

test('aligner emits descriptor-only mounts for manifest-only route crates', () => {
  const root = createRouteRepo(
    [
      'pub mod http_route_manifest;',
      'pub use http_route_manifest::app_route_manifest;',
      '',
    ].join('\n'),
  );
  writeText(
    path.join(
      root,
      'crates/sdkwork-routes-agents-app-api/src/http_route_manifest.rs',
    ),
    [
      'pub fn app_route_manifest() -> sdkwork_web_core::HttpRouteManifest {',
      '    unimplemented!()',
      '}',
      '',
    ].join('\n'),
  );

  const report = alignGatewayMountExports(root);

  assert.equal(report.results[0].status, 'updated');
  const libRs = fs.readFileSync(
    path.join(root, 'crates/sdkwork-routes-agents-app-api/src/lib.rs'),
    'utf8',
  );
  assert.match(
    libRs,
    /pub fn gateway_mount\(\) -> sdkwork_web_core::HttpRouteManifest/u,
  );
  assert.doesNotMatch(libRs, /Router::new/u);
});

test('aligner rejects route crates without a router builder or manifest', () => {
  const root = createRouteRepo('pub fn route_definitions() {}\n');

  const report = alignGatewayMountExports(root);

  assert.equal(report.results[0].status, 'failed');
  const libRs = fs.readFileSync(
    path.join(root, 'crates/sdkwork-routes-agents-app-api/src/lib.rs'),
    'utf8',
  );
  assert.doesNotMatch(libRs, /gateway_mount/u);
});
