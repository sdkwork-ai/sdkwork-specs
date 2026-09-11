import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { auditGatewayAlignmentRepo } from './audit-gateway-alignment-repo.mjs';
import { bootstrapApiAssemblyRepo } from './bootstrap-api-assembly-repo.mjs';

const CHECKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'audit-gateway-alignment-repo.mjs');

function emptyApplication(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-gateway-audit-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const specsRoot = path.join(workspace, 'sdkwork-specs');
  const root = path.join(workspace, 'sdkwork-demo');
  fs.mkdirSync(path.join(specsRoot, 'tools'), { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'sdkwork.app.config.json'), '{"backend":{"appId":"sdkwork-demo"}}\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{}}\n');
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = []\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\nlicense = "MIT"\n',
  );
  return { root, specsRoot };
}

test('audits apiMode none application roots instead of skipping them', (t) => {
  const { root } = emptyApplication(t);

  const result = auditGatewayAlignmentRepo(root);

  assert.equal(result.score, 'fail');
  assert.equal(result.category, 'application-api-mode-none');
  assert.match(result.issues.join('\n'), /missing crates\/sdkwork-api-demo-assembly/u);
  assert.equal(
    result.issues.filter((issue) => issue === 'missing crates/sdkwork-api-demo-assembly').length,
    1,
  );
});

test('reports standalone host readiness separately after assembly bootstrap', (t) => {
  const { root, specsRoot } = emptyApplication(t);
  const bootstrap = bootstrapApiAssemblyRepo(root, { specsRoot });
  assert.equal(bootstrap.ok, true, bootstrap.errors?.join('\n'));

  const result = auditGatewayAlignmentRepo(root);

  assert.equal(result.score, 'warn');
  assert.equal(result.category, 'application-api-mode-none');
  assert.deepEqual(result.issues, []);
  assert.match(result.warnings.join('\n'), /missing canonical standalone gateway/u);

  const strict = spawnSync(
    process.execPath,
    [CHECKER, '--root', root, '--strict'],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  );
  assert.notEqual(strict.status, 0);
  assert.match(strict.stdout, /missing canonical standalone gateway/u);
});

test('still skips non-application roots without route crates', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-gateway-audit-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const result = auditGatewayAlignmentRepo(workspace);

  assert.equal(result.score, 'skip');
  assert.equal(result.category, 'non-application-no-route-crates');
});

test('does not skip a non-application repository with a stale served assembly', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-gateway-audit-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const root = path.join(workspace, 'sdkwork-demo');
  const assemblyRoot = path.join(root, 'crates', 'sdkwork-api-demo-assembly');
  fs.mkdirSync(path.join(assemblyRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = ["crates/sdkwork-api-demo-assembly"]\nresolver = "2"\n',
  );
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

  const result = auditGatewayAlignmentRepo(root);

  assert.equal(result.score, 'fail');
  assert.notEqual(result.category, 'non-application-no-route-crates');
  assert.match(result.issues.join('\n'), /route crate list drift/u);
});
