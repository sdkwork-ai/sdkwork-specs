import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  migratePnpmScriptNames,
  PNPM_SCRIPT_RENAMES,
  workspaceRoots,
} from './migrate-pnpm-script-names.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-pnpm-script-names-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {
    check: 'pnpm gateway:assembly:validate',
    'gateway:assembly:materialize': 'node scripts/materialize.mjs',
    'gateway:assembly:validate': 'node scripts/validate.mjs',
  } }, null, 2));
  fs.writeFileSync(path.join(root, 'docs', 'README.md'), 'pnpm gateway:assembly:validate\n');
  fs.writeFileSync(path.join(root, 'specs', 'component.spec.json'), JSON.stringify({
    verification: ['pnpm run gateway:assembly:validate'],
  }, null, 2));
  return root;
}

test('dry run reports exact files without modifying them', () => {
  const root = fixture();
  const packagePath = path.join(root, 'package.json');
  const before = fs.readFileSync(packagePath, 'utf8');
  const result = migratePnpmScriptNames(root, { dryRun: true });
  assert.deepEqual(result.actions, [
    'update docs/README.md',
    'update package.json',
    'update specs/component.spec.json',
  ]);
  assert.equal(fs.readFileSync(packagePath, 'utf8'), before);
});

test('renames API assembly commands and every active reference idempotently', () => {
  const root = fixture();
  migratePnpmScriptNames(root);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const component = JSON.parse(fs.readFileSync(path.join(root, 'specs', 'component.spec.json'), 'utf8'));
  assert.equal(pkg.scripts['gateway:assembly:validate'], undefined);
  assert.equal(pkg.scripts['api:assembly:validate'], 'node scripts/validate.mjs');
  assert.equal(pkg.scripts.check, 'pnpm api:assembly:validate');
  assert.deepEqual(component.verification, ['pnpm run api:assembly:validate']);
  assert.equal(fs.readFileSync(path.join(root, 'docs', 'README.md'), 'utf8'), 'pnpm api:assembly:validate\n');
  assert.deepEqual(migratePnpmScriptNames(root).actions, []);
});

test('workspace discovery excludes the standards authority repository', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-pnpm-migration-workspace-'));
  for (const name of ['magic-studio', 'random-package', 'sdkwork-demo', 'sdkwork-specs']) {
    const root = path.join(workspace, name);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
    if (name === 'magic-studio') fs.writeFileSync(path.join(root, 'agent.app.config.json'), '{}\n');
  }
  assert.deepEqual(workspaceRoots(workspace), [
    path.join(workspace, 'magic-studio'),
    path.join(workspace, 'sdkwork-demo'),
  ]);
});

test('collapses equivalent legacy and canonical script keys', () => {
  const root = fixture();
  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.scripts['api:assembly:validate'] = pkg.scripts['gateway:assembly:validate'];
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));

  migratePnpmScriptNames(root);
  const migrated = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(migrated.scripts['gateway:assembly:validate'], undefined);
  assert.equal(migrated.scripts['api:assembly:validate'], 'node scripts/validate.mjs');
});

test('rejects target key collisions before writing files', () => {
  const root = fixture();
  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.scripts['api:assembly:validate'] = 'node another-validator.mjs';
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
  const before = fs.readFileSync(packagePath, 'utf8');
  assert.throws(
    () => migratePnpmScriptNames(root),
    /script rename collides at api:assembly:validate/u,
  );
  assert.equal(fs.readFileSync(packagePath, 'utf8'), before);
});

test('covers canonical root command migration families', () => {
  const expected = new Map([
    ['dev:h5', 'dev:browser'],
    ['fmt:rust:check', 'format:check'],
    ['route-manifest:export', 'api:materialize:route-manifest'],
    ['package:server', 'release:package:server'],
    ['terminal:dev:cloud', 'dev:desktop:cloud'],
    ['tauri:build', 'build:desktop'],
    ['baseline:large-media', 'perf:baseline:large-media'],
    ['align:model-pricing', 'models:align:pricing'],
    ['deps:check', 'check:dependencies'],
  ]);
  for (const [legacy, canonical] of expected) {
    assert.equal(PNPM_SCRIPT_RENAMES.get(legacy), canonical);
  }
});

test('drops an explicitly retired alias when its canonical command already exists', () => {
  const root = fixture();
  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.scripts['dev:gateway'] = 'cargo run -p retired-gateway';
  pkg.scripts['dev:server'] = 'pnpm exec sdkwork-app dev --runtime-target server';
  pkg.scripts.docs = 'pnpm dev:gateway';
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));

  migratePnpmScriptNames(root);
  const migrated = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(migrated.scripts['dev:gateway'], undefined);
  assert.equal(migrated.scripts['dev:server'], 'pnpm exec sdkwork-app dev --runtime-target server');
  assert.equal(migrated.scripts.docs, 'pnpm dev:server');
});

test('does not rewrite implementation filenames that contain a short script name', () => {
  const root = fixture();
  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.scripts.verify = 'node scripts/validate.mjs && pnpm gateway:assembly:validate';
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));

  migratePnpmScriptNames(root);
  const migrated = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(
    migrated.scripts.verify,
    'node scripts/validate.mjs && pnpm api:assembly:validate',
  );
});

test('prefers the native desktop build when a renderer command used the canonical name', () => {
  const root = fixture();
  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.scripts['build:desktop'] = 'vite build';
  pkg.scripts['tauri:build'] = 'tauri build';
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));

  migratePnpmScriptNames(root);
  const migrated = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(migrated.scripts['tauri:build'], undefined);
  assert.equal(migrated.scripts['build:desktop'], 'tauri build');
});

test('does not remigrate a canonical name that contains a legacy suffix', () => {
  const root = fixture();
  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.scripts.docs = 'pnpm release:package:server';
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));

  migratePnpmScriptNames(root);
  const migrated = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(migrated.scripts.docs, 'pnpm release:package:server');
  assert.deepEqual(migratePnpmScriptNames(root).actions, []);
});

test('leaves non-command domain values unchanged outside package manifests', () => {
  const root = fixture();
  const contractPath = path.join(root, 'specs', 'domain.contract.json');
  const before = '{"operation":"audit:services","label":"{{size}}"}\n';
  fs.writeFileSync(contractPath, before);

  const result = migratePnpmScriptNames(root);

  assert.equal(fs.readFileSync(contractPath, 'utf8'), before);
  assert.ok(!result.actions.includes(contractPath));
});
