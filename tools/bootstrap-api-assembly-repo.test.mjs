import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { bootstrapApiAssemblyRepo } from './bootstrap-api-assembly-repo.mjs';
import { validateApiAssembly } from './validate-api-assembly.mjs';

const BOOTSTRAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'bootstrap-api-assembly-repo.mjs');

function workspaceFixture(t, { withRoute = false } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-bootstrap-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const specsRoot = path.join(workspace, 'sdkwork-specs');
  const root = path.join(workspace, 'sdkwork-demo');
  fs.mkdirSync(path.join(specsRoot, 'tools'), { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'sdkwork.app.config.json'),
    `${JSON.stringify({ backend: { appId: 'sdkwork-demo' } }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{}}\n');

  const members = withRoute ? '"crates/sdkwork-routes-catalog-app-api"' : '';
  fs.writeFileSync(
    path.join(root, 'Cargo.toml'),
    `[workspace]\nmembers = [${members}]\nresolver = "2"\n\n[workspace.package]\nedition = "2021"\nversion = "0.1.0"\nlicense = "MIT"\n`,
  );

  if (withRoute) {
    const routeRoot = path.join(root, 'crates', 'sdkwork-routes-catalog-app-api');
    fs.mkdirSync(path.join(routeRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(routeRoot, 'specs'), { recursive: true });
    fs.writeFileSync(
      path.join(routeRoot, 'Cargo.toml'),
      '[package]\nname = "sdkwork-routes-catalog-app-api"\nversion = "0.1.0"\nedition = "2021"\n',
    );
    fs.writeFileSync(
      path.join(routeRoot, 'src', 'lib.rs'),
      'pub fn gateway_mount() -> axum::Router { axum::Router::new().route("/catalog", axum::routing::get(|| async {})) }\n',
    );
    fs.writeFileSync(
      path.join(routeRoot, 'specs', 'component.spec.json'),
      `${JSON.stringify({ contracts: { routeManifest: 'route-manifest.json' } }, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(routeRoot, 'route-manifest.json'), '{}\n');
  }

  return { root, specsRoot };
}

test('bootstraps apiMode none applications without wrapper scripts', (t) => {
  const { root, specsRoot } = workspaceFixture(t);

  const result = bootstrapApiAssemblyRepo(root, { specsRoot });

  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.apiMode, 'none');
  assert.equal(result.routeCrates, 0);
  assert.equal(result.workspaceMemberAdded, true);
  assert.equal(result.packageScriptsAdded, true);
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'gateway')), false);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, result.crateDir, 'assembly-manifest.json'), 'utf8'),
  );
  assert.equal(manifest.apiMode, 'none');
  assert.deepEqual(manifest.routeCrates, []);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(
    pkg.scripts['api:assembly:materialize'],
    'node ../sdkwork-specs/tools/materialize-api-assembly.mjs --root .',
  );
  assert.equal(
    pkg.scripts['api:assembly:validate'],
    'node ../sdkwork-specs/tools/validate-api-assembly.mjs --root .',
  );
  assert.equal(validateApiAssembly(root).ok, true);

  const manifestBefore = fs.readFileSync(
    path.join(root, result.crateDir, 'assembly-manifest.json'),
    'utf8',
  );
  const repeated = bootstrapApiAssemblyRepo(root, { specsRoot });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.workspaceMemberAdded, false);
  assert.equal(repeated.packageScriptsAdded, false);
  assert.equal(
    fs.readFileSync(path.join(root, result.crateDir, 'assembly-manifest.json'), 'utf8'),
    manifestBefore,
  );
});

test('bootstraps capability-named routes into a served assembly', (t) => {
  const { root, specsRoot } = workspaceFixture(t, { withRoute: true });

  const result = bootstrapApiAssemblyRepo(root, { specsRoot });

  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.apiMode, 'served');
  assert.equal(result.routeCrates, 1);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, result.crateDir, 'assembly-manifest.json'), 'utf8'),
  );
  assert.deepEqual(
    manifest.routeCrates.map((route) => route.packageName),
    ['sdkwork-routes-catalog-app-api'],
  );
});

test('skips non-application roots and the platform cloud gateway', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-bootstrap-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const libraryRoot = path.join(workspace, 'sdkwork-library');
  const platformRoot = path.join(workspace, 'sdkwork-api-cloud-gateway');
  fs.mkdirSync(libraryRoot, { recursive: true });
  fs.mkdirSync(platformRoot, { recursive: true });

  const library = bootstrapApiAssemblyRepo(libraryRoot, { specsRoot: workspace });
  const platform = bootstrapApiAssemblyRepo(platformRoot, { specsRoot: workspace });

  assert.equal(library.skipped, true);
  assert.equal(library.reason, 'not-application-root');
  assert.equal(platform.skipped, true);
  assert.equal(platform.reason, 'platform-cloud-gateway');
});

test('requires an explicit application root for the mutating CLI', () => {
  const result = spawnSync(process.execPath, [BOOTSTRAP], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 2);
  assert.match(result.stdout, /--root <application>/u);
});

test('fails closed instead of deriving assembly identity from manifest fields', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-bootstrap-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const root = path.join(workspace, 'application-root');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'sdkwork.app.config.json'),
    '{"app":{"key":"sdkwork-demo"},"backend":{"appId":"sdkwork-demo-pc"}}\n',
  );

  const result = bootstrapApiAssemblyRepo(root, { specsRoot: workspace });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /must be sdkwork-<application-code>/u);
});
