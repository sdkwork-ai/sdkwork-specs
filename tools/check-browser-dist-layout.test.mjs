#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkBrowserDistLayout } from './check-browser-dist-layout.mjs';

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-browser-dist-'));
  fs.mkdirSync(path.join(root, 'apps', 'sdkwork-demo-pc'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'sdkwork-demo-h5'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'sdkwork-demo-pc', 'package.json'), '{"name":"@sdkwork/demo-pc"}');
  fs.writeFileSync(path.join(root, 'apps', 'sdkwork-demo-h5', 'package.json'), '{"name":"@sdkwork/demo-h5"}');
  return root;
}

test('passes when outDir uses resolveBrowserDistOutDir', () => {
  const root = fixtureRoot();
  fs.writeFileSync(
    path.join(root, 'apps', 'sdkwork-demo-pc', 'vite.config.ts'),
    'export default { build: { outDir: resolveBrowserDistOutDir(environment, deploymentProfile) } };\n',
  );
  fs.writeFileSync(
    path.join(root, 'apps', 'sdkwork-demo-h5', 'vite.config.ts'),
    "export default { build: { outDir: 'dist/cloud/prod' } };\n",
  );
  assert.deepEqual(checkBrowserDistLayout(root), []);
});

test('fails on bare dist outDir', () => {
  const root = fixtureRoot();
  fs.writeFileSync(
    path.join(root, 'apps', 'sdkwork-demo-pc', 'vite.config.ts'),
    "export default { build: { outDir: 'dist' } };\n",
  );
  const issues = checkBrowserDistLayout(root);
  assert.ok(issues.some((issue) => /bare dist\//u.test(issue)));
});

test('fails on environment-only dist outDir literal', () => {
  const root = fixtureRoot();
  fs.writeFileSync(
    path.join(root, 'apps', 'sdkwork-demo-pc', 'vite.config.ts'),
    "export default { build: { outDir: 'dist/prod' } };\n",
  );
  const issues = checkBrowserDistLayout(root);
  assert.ok(issues.some((issue) => /outDir/u.test(issue)));
});
