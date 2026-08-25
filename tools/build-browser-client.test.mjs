#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildBrowserClient,
  canonicalRootBuildCommand,
  discoverBrowserAppRoots,
  normalizeEnvironmentAlias,
} from './build-browser-client.mjs';
import { checkBrowserBuildScripts } from './check-browser-build-scripts.mjs';

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-browser-build-'));
  const pcRoot = path.join(root, 'apps', 'sdkwork-demo-pc');
  fs.mkdirSync(pcRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: {} }, null, 2));
  fs.writeFileSync(path.join(pcRoot, 'package.json'), JSON.stringify({ name: '@sdkwork/demo-pc', scripts: {} }, null, 2));
  fs.writeFileSync(path.join(pcRoot, 'vite.config.ts'), "export default { build: { outDir: 'dist/prod' } };\n");
  return root;
}

test('normalizeEnvironmentAlias maps dev and prod', () => {
  assert.equal(normalizeEnvironmentAlias('dev'), 'development');
  assert.equal(normalizeEnvironmentAlias('prod'), 'production');
});

test('discoverBrowserAppRoots finds pc and h5 vite apps', () => {
  const root = fixtureRoot();
  const h5Root = path.join(root, 'apps', 'sdkwork-demo-h5');
  fs.mkdirSync(h5Root, { recursive: true });
  fs.writeFileSync(path.join(h5Root, 'package.json'), JSON.stringify({ name: '@sdkwork/demo-h5' }, null, 2));
  fs.writeFileSync(path.join(h5Root, 'vite.config.ts'), "export default {};\n");
  const apps = discoverBrowserAppRoots(root);
  assert.equal(apps.length, 2);
});

test('canonicalRootBuildCommand references build-browser-client.mjs', () => {
  const root = fixtureRoot();
  const siblingSpecs = path.join(root, '..', 'sdkwork-specs', 'tools', 'build-browser-client.mjs');
  if (!fs.existsSync(siblingSpecs)) {
    return;
  }
  const command = canonicalRootBuildCommand(root, 'pc', 'dev');
  assert.match(command, /build-browser-client\.mjs/u);
  assert.match(command, /--architecture pc/u);
  assert.match(command, /--environment dev/u);
});

test('buildBrowserClient dry-run resolves dist alias', () => {
  const root = fixtureRoot();
  const plan = buildBrowserClient({
    architecture: 'pc',
    dryRun: true,
    environment: 'dev',
    repositoryRoot: root,
  });
  assert.equal(plan.outDir, 'dist/standalone/dev');
  assert.equal(plan.deploymentProfile, 'standalone');
  assert.equal(plan.viteMode, 'standalone.development');
});

test('buildBrowserClient cloud dry-run resolves profile dist alias', () => {
  const root = fixtureRoot();
  const plan = buildBrowserClient({
    architecture: 'pc',
    deploymentProfile: 'cloud',
    dryRun: true,
    environment: 'prod',
    repositoryRoot: root,
  });
  assert.equal(plan.outDir, 'dist/cloud/prod');
  assert.equal(plan.deploymentProfile, 'cloud');
  assert.equal(plan.viteMode, 'cloud.production');
});

test('checkBrowserBuildScripts reports missing root scripts', () => {
  const root = fixtureRoot();
  const issues = checkBrowserBuildScripts(root);
  assert.ok(issues.some((issue) => issue.includes('build:pc:dev')));
});

test('findViteConfig discovers vite.config.web.mjs', async () => {
  const { findViteConfig } = await import('./build-browser-client.mjs');
  const root = fixtureRoot();
  const pcRoot = path.join(root, 'apps', 'sdkwork-demo-pc');
  fs.writeFileSync(path.join(pcRoot, 'vite.config.web.mjs'), "export default {};\n");
  fs.rmSync(path.join(pcRoot, 'vite.config.ts'));
  const configPath = findViteConfig(pcRoot);
  assert.equal(path.basename(configPath), 'vite.config.web.mjs');
});
