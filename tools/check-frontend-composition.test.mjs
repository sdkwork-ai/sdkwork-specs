import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  listFrontendPackages,
  validateFrontendComposition,
} from './lib/frontend-composition.mjs';
import { findCorePackages } from './lib/app-composition.mjs';

const CHECKER = path.resolve(import.meta.dirname, 'check-frontend-composition.mjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function createClientRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-frontend-composition-'));
  const appRoot = path.join(root, 'apps/sdkwork-demo-pc');
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    schemaVersion: 1,
    applicationCode: 'demo',
  });
  return { root, appRoot };
}

test('core packages must expose the standard composition subpaths', () => {
  const { root, appRoot } = createClientRoot();
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/package.json'), {
    name: '@sdkwork/demo-pc-core',
    version: '0.0.0',
    exports: {
      '.': './src/index.ts',
      './sdk': './src/sdk.ts',
    },
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/specs/component.spec.json'), {
    component: { name: '@sdkwork/demo-pc-core', type: 'frontend-core' },
    contracts: { sdkDependencies: [] },
  });

  const issues = validateFrontendComposition(root);

  assert.ok(issues.some((issue) => issue.includes('missing package.json exports["./composition"]')));
});

test('package discovery ignores empty directories left by package renames', () => {
  const { appRoot } = createClientRoot();
  fs.mkdirSync(path.join(appRoot, 'packages/sdkwork-demo-pc-core/src'), {
    recursive: true,
  });

  assert.deepEqual(findCorePackages(appRoot), []);
  assert.deepEqual(listFrontendPackages(appRoot), []);
});

test('feature packages must not import generated SDK packages directly', () => {
  const { root, appRoot } = createClientRoot();
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/package.json'), {
    name: '@sdkwork/demo-pc-core',
    version: '0.0.0',
    exports: {
      '.': './src/index.ts',
      './sdk': './src/sdk.ts',
      './modules': './src/modules.ts',
      './host': './src/host.ts',
      './session': './src/session.ts',
      './composition': './src/composition/index.ts',
    },
  });
  fs.mkdirSync(path.join(appRoot, 'packages/sdkwork-demo-pc-core/src/composition'), { recursive: true });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-chat/package.json'), {
    name: '@sdkwork/demo-pc-chat',
    version: '0.0.0',
    dependencies: {
      'sdkwork-demo-app-sdk-generated-typescript': 'workspace:*',
    },
  });
  writeText(
    path.join(appRoot, 'packages/sdkwork-demo-pc-chat/src/service.ts'),
    "import { createClient } from 'sdkwork-demo-app-sdk-generated-typescript';\nexport { createClient };\n",
  );

  const issues = validateFrontendComposition(root);

  assert.ok(issues.some((issue) => issue.includes('must not import generated SDK module')));
});

test('core and commons packages must not depend on capability packages', () => {
  const { root, appRoot } = createClientRoot();
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/package.json'), {
    name: '@sdkwork/demo-pc-core',
    version: '0.0.0',
    dependencies: {
      '@sdkwork/demo-pc-chat': 'workspace:*',
    },
    exports: {
      '.': './src/index.ts',
      './sdk': './src/sdk.ts',
      './modules': './src/modules.ts',
      './host': './src/host.ts',
      './session': './src/session.ts',
      './composition': './src/composition/index.ts',
    },
  });
  fs.mkdirSync(path.join(appRoot, 'packages/sdkwork-demo-pc-core/src/composition'), { recursive: true });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-chat/package.json'), {
    name: '@sdkwork/demo-pc-chat',
    version: '0.0.0',
  });

  const issues = validateFrontendComposition(root);

  assert.ok(issues.some((issue) => issue.includes('core package must not depend on capability package @sdkwork/demo-pc-chat')));
});

test('host packages must not declare business API SDK dependencies', () => {
  const { root, appRoot } = createClientRoot();
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-host/package.json'), {
    name: '@sdkwork/demo-pc-host',
    version: '0.0.0',
    dependencies: {
      '@sdkwork/demo-app-sdk': 'workspace:*',
    },
  });

  const issues = validateFrontendComposition(root);

  assert.ok(issues.some((issue) => issue.includes('host package must not depend on business SDK')));
});

test('CLI reports frontend composition violations', () => {
  const { root, appRoot } = createClientRoot();
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-host/package.json'), {
    name: '@sdkwork/demo-pc-host',
    version: '0.0.0',
    dependencies: {
      '@sdkwork/demo-app-sdk': 'workspace:*',
    },
  });

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /host package must not depend on business SDK/u);
});

test('CLI scans child repositories with --workspace', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-frontend-composition-workspace-'));
  const repoRoot = path.join(workspace, 'sdkwork-demo');
  writeText(path.join(repoRoot, 'AGENTS.md'), '# Repository Guidelines\n');
  const appRoot = path.join(repoRoot, 'apps/sdkwork-demo-pc');
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    schemaVersion: 1,
    applicationCode: 'demo',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-host/package.json'), {
    name: '@sdkwork/demo-pc-host',
    version: '0.0.0',
    dependencies: {
      '@sdkwork/demo-app-sdk': 'workspace:*',
    },
  });

  const result = spawnSync(process.execPath, [CHECKER, '--workspace', workspace], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sdkwork-demo/u);
  assert.match(result.stderr, /host package must not depend on business SDK/u);
});
