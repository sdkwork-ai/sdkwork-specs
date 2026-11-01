// env-naming:allow-file — the fixtures assert retired spellings are rejected from packages

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validatePackageContent } from './check-package-content-standard.mjs';

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-content-check-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
  return root;
}

function write(root, relative, content = 'x') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('passes an empty workspace with no container packaging', () => {
  const root = makeWorkspace();
  const issues = validatePackageContent(root);
  assert.deepEqual(issues, []);
});

test('flags container packaging without dockerignore', () => {
  const root = makeWorkspace();
  write(root, 'Dockerfile', 'FROM debian\nCOPY . /opt/app\n');
  const issues = validatePackageContent(root);
  assert.ok(issues.some((issue) => issue.includes('without .dockerignore')));
});

test('accepts container packaging with dockerignore', () => {
  const root = makeWorkspace();
  write(root, 'Dockerfile', 'FROM debian\nCOPY . /opt/app\n');
  write(root, '.dockerignore', 'target\nnode_modules\n.git\n');
  const issues = validatePackageContent(root);
  assert.deepEqual(issues, []);
});

test('flags forbidden content in staging directory', () => {
  const root = makeWorkspace();
  write(root, 'dist/install-package-staging/bin/cloudrouter', 'binary');
  write(root, 'dist/install-package-staging/node_modules/pkg/index.js', 'x');
  write(root, 'dist/install-package-staging/.git/HEAD', 'ref');
  write(root, 'dist/install-package-staging/.env.release.local', 'TOKEN=x');
  const issues = validatePackageContent(root);
  assert.ok(issues.some((issue) => issue.includes('node_modules/pkg')));
  assert.ok(issues.some((issue) => issue.includes('.git/HEAD')));
  assert.ok(issues.some((issue) => issue.includes('.env.release.local')));
});

test('flags forbidden entries listed in install manifest', () => {
  const root = makeWorkspace();
  write(root, 'dist/install-packages/install-manifest.json', JSON.stringify({
    packageId: 'linux-x64-container',
    version: '1.0.0',
    entries: ['bin/cloudrouter', 'node_modules/pkg/index.js', '.env.release'],
  }));
  const issues = validatePackageContent(root);
  assert.ok(issues.some((issue) => issue.includes('node_modules/pkg/index.js')));
  assert.ok(issues.some((issue) => issue.includes('.env.release')));
  assert.ok(!issues.some((issue) => issue.includes('bin/cloudrouter')));
});

test('flags invalid manifest JSON', () => {
  const root = makeWorkspace();
  write(root, 'dist/container-image.json', '{not json');
  const issues = validatePackageContent(root);
  assert.ok(issues.some((issue) => issue.includes('not valid JSON')));
});

test('accepts clean package manifest', () => {
  const root = makeWorkspace();
  write(root, 'dist/install-packages/install-manifest.json', JSON.stringify({
    packageId: 'linux-x64-container',
    version: '1.0.0',
    entries: ['bin/cloudrouter', 'config/cloudrouter.toml.example', 'portal/dist/index.html'],
  }));
  const issues = validatePackageContent(root);
  assert.deepEqual(issues, []);
});

test('ignores node_modules present only in the repository (not staged)', () => {
  const root = makeWorkspace();
  write(root, 'node_modules/some-pkg/index.js', 'x');
  const issues = validatePackageContent(root);
  assert.deepEqual(issues, []);
});

test('allows .example template files in staging', () => {
  const root = makeWorkspace();
  write(root, 'dist/install-package-staging/.env.release.example', 'TOKEN=');
  write(root, 'dist/install-package-staging/config/cloudrouter.toml.example', 'x');
  const issues = validatePackageContent(root);
  assert.deepEqual(issues, []);
});

test('accepts nested package.id/package.version manifest shape', () => {
  const root = makeWorkspace();
  write(root, 'dist/install-packages/install-manifest.json', JSON.stringify({
    schemaVersion: '2026-05-15.install-manifest.v1',
    package: {
      id: 'linux-x64-container',
      version: '0.3.0',
      entries: ['bin/cloudrouter', 'portal/dist/index.html'],
    },
  }));
  const issues = validatePackageContent(root);
  assert.deepEqual(issues, []);
});

test('flags forbidden entries in nested package.entries shape', () => {
  const root = makeWorkspace();
  write(root, 'dist/install-packages/install-manifest.json', JSON.stringify({
    package: {
      id: 'linux-x64-container',
      version: '0.3.0',
      entries: ['bin/cloudrouter', 'target/release/cloudrouter'],
    },
  }));
  const issues = validatePackageContent(root);
  assert.ok(issues.some((issue) => issue.includes('target/release/cloudrouter')));
});
