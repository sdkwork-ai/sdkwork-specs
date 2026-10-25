import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildWorkspacePackages,
  parsePnpmWorkspaceCatalog,
  parsePnpmWorkspacePackages,
  renderPnpmWorkspace,
} from './lib/workspace-registry.mjs';
import {
  isForbiddenCapabilitySdkImport,
  listClientAppRoots,
  normalizeSdkDependencies,
  validateCapabilitySdkImportBoundary,
  validateBackendReleaseComposition,
  validateSdkDependenciesContract,
} from './lib/app-composition.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY_REPO = path.join(SPECS_ROOT, 'tools', 'verify-repo.mjs');

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('listClientAppRoots discovers hybrid pc-react app roots', () => {
  const roots = listClientAppRoots(path.resolve(SPECS_ROOT, '..', 'sdkwork-notes'));
  assert.ok(roots.some((root) => root.appRootName === 'sdkwork-notes-pc-react'));
});

test('normalizeSdkDependencies accepts string and object entries', () => {
  const deps = normalizeSdkDependencies({
    contracts: {
      sdkDependencies: [
        'sdkwork-foo-app-sdk-typescript',
        { workspace: 'sdkwork-bar-backend-sdk-typescript', surface: 'backend-api', credentialMode: 'authenticated-backend-admin' },
      ],
    },
  });
  assert.equal(deps.length, 2);
  assert.equal(deps[0].workspace, 'sdkwork-foo-app-sdk-typescript');
});

test('validateSdkDependenciesContract rejects backend-api on app core', () => {
  const issues = validateSdkDependenciesContract(
    {
      surface: 'app',
      componentName: 'sdkwork-demo-pc-core',
      componentSpec: {
        contracts: {
          sdkDependencies: [{ workspace: 'sdkwork-demo-backend-sdk-typescript', surface: 'backend-api' }],
        },
      },
    },
    'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-core',
  );
  assert.ok(issues.some((issue) => issue.includes('backend-api')));
});

test('isForbiddenCapabilitySdkImport blocks generated SDK imports', () => {
  assert.equal(isForbiddenCapabilitySdkImport('sdkwork-im-generated-app-sdk'), true);
  assert.equal(isForbiddenCapabilitySdkImport('@sdkwork/demo-pc-core/composition'), false);
});

test('validateCapabilitySdkImportBoundary allows backend-admin SDK wrapper packages only', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-composition-'));
  try {
    const appRoot = path.join(tempRoot, 'apps', 'sdkwork-demo-pc');
    const adminSdkSrc = path.join(appRoot, 'packages', 'sdkwork-demo-pc-admin-sdk', 'src');
    const capabilitySrc = path.join(appRoot, 'packages', 'sdkwork-demo-pc-chat', 'src');
    mkdirSync(adminSdkSrc, { recursive: true });
    mkdirSync(capabilitySrc, { recursive: true });
    writeFileSync(
      path.join(adminSdkSrc, 'index.ts'),
      "import { createClient } from '@sdkwork/iam-backend-sdk';\nexport { createClient };\n",
    );
    writeFileSync(
      path.join(capabilitySrc, 'index.ts'),
      "import { createClient } from '@sdkwork/iam-backend-sdk';\nexport { createClient };\n",
    );

    const issues = validateCapabilitySdkImportBoundary(appRoot, 'apps/sdkwork-demo-pc');

    assert.ok(
      issues.some((issue) => issue.includes('sdkwork-demo-pc-chat')),
      'ordinary capability packages must still be blocked from generated backend SDK imports',
    );
    assert.equal(
      issues.some((issue) => issue.includes('sdkwork-demo-pc-admin-sdk')),
      false,
      'backend-admin SDK wrapper packages are an approved backend SDK boundary',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildWorkspacePackages preserves local packages and adds foundation paths', () => {
  const packages = buildWorkspacePackages(['apps/*', 'packages/*'], 'sdkwork-im');
  assert.ok(packages.includes('apps/*'));
  assert.ok(packages.includes('packages/*'));
  assert.ok(packages.some((entry) => entry.includes('sdkwork-utils-typescript')));
});

test('renderPnpmWorkspace round-trips package list parsing', () => {
  const rendered = renderPnpmWorkspace({
    packages: ['apps/*', '../sdkwork-utils/packages/sdkwork-utils-typescript'],
    catalog: { react: '^19.2.4' },
  });
  const parsed = parsePnpmWorkspacePackages(rendered);
  assert.deepEqual(parsed, ['apps/*', '../sdkwork-utils/packages/sdkwork-utils-typescript']);
});

test('backend-only App Standard v3 roots use the root component SDK inventory', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-backend-v3-composition-'));
  try {
    writeJson(path.join(tempRoot, 'agent.app.config.json'), {
      schemaVersion: 3,
      backend: {},
    });
    writeJson(path.join(tempRoot, 'specs/component.spec.json'), {
      contracts: { sdkDependencies: [] },
    });

    assert.deepEqual(validateBackendReleaseComposition(tempRoot), []);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('backend-only App Standard v3 roots fail without component SDK inventory', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-backend-v3-composition-'));
  try {
    writeJson(path.join(tempRoot, 'agent.app.config.json'), {
      schemaVersion: 3,
      backend: {},
    });

    assert.match(
      validateBackendReleaseComposition(tempRoot).join('\n'),
      /component\.spec\.json#contracts\.sdkDependencies/u,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('renderPnpmWorkspace quotes and round-trips catalog ranges containing spaces', () => {
  const rendered = renderPnpmWorkspace({
    packages: ['apps/*'],
    catalog: { 'react-router': '>=6.0.0 <8.0.0' },
  });

  assert.match(rendered, /react-router: ">=6\.0\.0 <8\.0\.0"/u);
  assert.deepEqual(parsePnpmWorkspaceCatalog(rendered), {
    'react-router': '>=6.0.0 <8.0.0',
  });
});

test('verify-repo reports duplicate route path collisions', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-verify-route-collision-'));
  try {
    writeJson(path.join(tempRoot, 'apis/app-api/users/openapi.json'), {
      openapi: '3.1.2',
      info: { title: 'users', version: '1.0.0' },
      paths: {
        '/app/v3/api/users/{userId}': {
          get: { operationId: 'users.retrieve', responses: { 200: { description: 'ok' } } },
        },
      },
    });
    writeJson(path.join(tempRoot, 'apis/app-api/profiles/openapi.json'), {
      openapi: '3.1.2',
      info: { title: 'profiles', version: '1.0.0' },
      paths: {
        '/app/v3/api/users/:id': {
          get: { operationId: 'profiles.retrieve', responses: { 200: { description: 'ok' } } },
        },
      },
    });

    const result = spawnSync(process.execPath, [VERIFY_REPO, '--root', tempRoot], { encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicate-route-path/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('verify-repo reports missing permissionComposition for HTTP sdkDependencies', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-verify-permission-composition-'));
  try {
    const appRoot = path.join(tempRoot, 'apps/sdkwork-shop-h5');
    writeJson(path.join(appRoot, 'agent.app.config.json'), {
      schemaVersion: 1,
      applicationCode: 'shop',
    });
    writeJson(path.join(appRoot, 'packages/sdkwork-shop-h5-core/package.json'), {
      name: '@sdkwork/shop-h5-core',
      version: '0.0.0',
    });
    mkdirSync(path.join(appRoot, 'packages/sdkwork-shop-h5-core/src/composition'), { recursive: true });
    writeJson(path.join(appRoot, 'packages/sdkwork-shop-h5-core/specs/component.spec.json'), {
      component: {
        name: '@sdkwork/shop-h5-core',
        type: 'frontend-core',
      },
      contracts: {
        sdkDependencies: [
          {
            workspace: 'sdkwork-shop-app-sdk',
            surface: 'app-api',
            credentialMode: 'authenticated-app-api',
          },
        ],
      },
    });

    const result = spawnSync(process.execPath, [VERIFY_REPO, '--root', tempRoot], { encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing contracts\.permissionComposition/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
