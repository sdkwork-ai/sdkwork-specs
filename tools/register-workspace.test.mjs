import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findWorkspaceModules, parseWorkspaceArgs } from './register-workspace.mjs';

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-ws-'));
  fs.mkdirSync(path.join(root, 'sdkwork-root'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sdkwork-root', 'agent.app.config.json'), '{}\n');
  fs.mkdirSync(path.join(root, 'sdkwork-surface', 'apps', 'sdkwork-surface-web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sdkwork-surface', 'apps', 'sdkwork-surface-web', 'agent.app.config.json'), '{}\n');
  fs.mkdirSync(path.join(root, 'sdkwork-empty'), { recursive: true });
  fs.mkdirSync(path.join(root, 'not-a-module'), { recursive: true });
  return root;
}

test('discovers root-manifest and surface-only modules', () => {
  const root = workspace();
  assert.deepEqual(findWorkspaceModules(root).map((moduleRoot) => path.basename(moduleRoot)), [
    'sdkwork-root',
    'sdkwork-surface',
  ]);
});

test('parseWorkspaceArgs forwards operator/OEM flags and keeps wrapper flags local', () => {
  const options = parseWorkspaceArgs([
    '--workspace', '..', '--module', 'sdkwork-a', '--dry-run',
    '--auth', 'operator', '--api-domain', 'api.example.com', '--domain-suffix', 'example.com',
    '--print-audiences',
  ]);
  assert.equal(options.dryRun, true);
  assert.equal(options.printAudiences, true);
  assert.deepEqual(options.modules, ['sdkwork-a']);
  assert.deepEqual(options.forward, [
    '--dry-run', '--auth', 'operator', '--api-domain', 'api.example.com',
    '--domain-suffix', 'example.com',
  ]);
});
