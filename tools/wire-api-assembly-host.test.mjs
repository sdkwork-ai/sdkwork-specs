import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { wireHostFrameworkMain } from './wire-api-assembly-host.mjs';

const WIRE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'wire-api-assembly-host.mjs');

test('API assembly keeps Web Framework as the single CORS authority', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-assembly-'));
  const mainPath = path.join(root, 'main.rs');
  fs.writeFileSync(mainPath, `use axum::Router;
use sdkwork_routes_example_app_api::build_example_app_router_with_framework;
use sdkwork_routes_example_backend_api::build_example_backend_router_with_framework;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

async fn main() {
    let host = Arc::new(ExampleServiceHost::new().await);
    let business = Router::new()
        .merge(build_example_app_router_with_framework(host.clone()).await)
        .merge(build_example_backend_router_with_framework(host).await)
        .layer(CorsLayer::permissive());
}
`, 'utf8');

  try {
    assert.equal(wireHostFrameworkMain(mainPath, 'example'), true);
    const updated = fs.readFileSync(mainPath, 'utf8');
    assert.match(updated, /assemble_api_router\(host\)\.await\.router;/u);
    assert.doesNotMatch(updated, /application_cors_layer_from_env|CorsLayer/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires one explicit mutation scope', () => {
  const missing = spawnSync(process.execPath, [WIRE], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  const conflicting = spawnSync(
    process.execPath,
    [WIRE, '--root', '.', '--workspace', '..'],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  );

  assert.equal(missing.status, 2);
  assert.equal(conflicting.status, 2);
  assert.match(missing.stdout, /--root <application> \| --workspace <workspace>/u);
});
