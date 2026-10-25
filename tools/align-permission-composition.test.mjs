import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ALIGNER = path.resolve(import.meta.dirname, 'align-permission-composition.mjs');
const CHECKER = path.resolve(import.meta.dirname, 'check-permission-composition.mjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createCoreSpec(root) {
  const appRoot = path.join(root, 'apps/sdkwork-shop-h5');
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    schemaVersion: 1,
    applicationCode: 'shop',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-shop-h5-core/package.json'), {
    name: '@sdkwork/shop-h5-core',
    version: '0.0.0',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-shop-h5-core/specs/component.spec.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.component.spec',
    component: {
      name: '@sdkwork/shop-h5-core',
      type: 'react-package',
      root: 'apps/sdkwork-shop-h5/packages/sdkwork-shop-h5-core',
      domain: 'shop',
      capability: 'core',
      surface: 'app',
      languages: ['typescript', 'react'],
      generated: false,
    },
    contracts: {
      sdkDependencies: [
        {
          workspace: 'sdkwork-shop-app-sdk',
          surface: 'app-api',
          credentialMode: 'authenticated-app-api',
        },
        {
          workspace: 'sdkwork-drive-app-sdk',
          surface: 'app-api',
          credentialMode: 'authenticated-app-api',
        },
      ],
      permissionComposition: {
        applicationModule: {
          manifestRef: '../../../specs/iam.module.manifest.json',
        },
        moduleCatalogRefs: [
          {
            moduleId: 'retired-module',
            manifestRef: '../../../../../../sdkwork-retired/specs/iam.module.manifest.json',
            inheritPermissions: true,
            inheritRoles: true,
          },
        ],
      },
    },
  });
}

test('aligner materializes permissionComposition from HTTP sdkDependencies', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-permission-align-'));
  const root = path.join(workspace, 'sdkwork-shop');
  createCoreSpec(root);
  writeJson(path.join(root, 'specs/iam.module.manifest.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.iam.module',
    moduleId: 'shop',
    domain: 'shop',
    permissions: { catalog: [{ code: 'shop.orders.read' }] },
  });
  writeJson(path.join(workspace, 'sdkwork-drive/iam/modules/drive/iam.module.manifest.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.iam.module',
    moduleId: 'drive',
    domain: 'drive',
    permissions: { catalog: [] },
  });
  writeJson(path.join(workspace, 'sdkwork-drive/specs/component.spec.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.component.spec',
    component: { name: 'sdkwork-drive', domain: 'drive' },
    integration: {
      permissionManifest: 'iam/modules/drive/iam.module.manifest.json',
    },
  });

  const align = spawnSync(process.execPath, [ALIGNER, '--root', root, '--write'], {
    encoding: 'utf8',
  });

  assert.equal(align.status, 0, align.stderr);
  assert.match(align.stdout, /aligned permissionComposition/u);

  const check = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stderr);

  const spec = JSON.parse(
    fs.readFileSync(
      path.join(root, 'apps/sdkwork-shop-h5/packages/sdkwork-shop-h5-core/specs/component.spec.json'),
      'utf8',
    ),
  );
  assert.equal(spec.contracts.permissionComposition.inheritanceMode, 'module-catalog-with-overrides');
  assert.deepEqual(
    spec.contracts.permissionComposition.moduleCatalogRefs.map((entry) => entry.moduleId).sort(),
    ['drive', 'shop'],
  );
  assert.equal(
    spec.contracts.permissionComposition.applicationModule.manifestRef,
    '../../../../specs/iam.module.manifest.json',
  );
  assert.equal(
    spec.contracts.permissionComposition.moduleCatalogRefs.some(
      (entry) => entry.moduleId === 'retired-module',
    ),
    false,
  );
});

test('aligner resolves SDK dependency to sibling IMF module identity', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-permission-align-sibling-'));
  const root = path.join(workspace, 'sdkwork-cloudrouter');
  const appRoot = path.join(root, 'apps/sdkwork-cloudrouter-pc');
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    schemaVersion: 1,
    applicationCode: 'cloudrouter',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-cloudrouter-pc-core/package.json'), {
    name: '@sdkwork/cloudrouter-pc-core',
    version: '0.0.0',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-cloudrouter-pc-core/specs/component.spec.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.component.spec',
    component: {
      name: '@sdkwork/cloudrouter-pc-core',
      type: 'react-package',
      domain: 'cloudrouter',
      capability: 'core',
      surface: 'app',
    },
    contracts: {
      sdkDependencies: [
        {
          workspace: 'sdkwork-models-app-sdk',
          surface: 'app-api',
          credentialMode: 'authenticated-app-api',
        },
      ],
    },
  });
  writeJson(path.join(workspace, 'sdkwork-models/specs/iam.module.manifest.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.iam.module',
    moduleId: 'intelligence-catalog',
    domain: 'intelligence',
    permissions: { catalog: [{ code: 'intelligence.models.read' }] },
  });

  const align = spawnSync(process.execPath, [ALIGNER, '--root', root, '--write'], {
    encoding: 'utf8',
  });

  assert.equal(align.status, 0, align.stderr);
  const spec = JSON.parse(
    fs.readFileSync(
      path.join(appRoot, 'packages/sdkwork-cloudrouter-pc-core/specs/component.spec.json'),
      'utf8',
    ),
  );
  assert.deepEqual(spec.contracts.permissionComposition.moduleCatalogRefs, [
    {
      moduleId: 'intelligence-catalog',
      manifestRef: '../../../../../sdkwork-models/specs/iam.module.manifest.json',
      inheritPermissions: true,
      inheritRoles: true,
    },
  ]);
});

test('aligner ignores temporary .sdkwork permission manifests', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-permission-align-metadata-'));
  const root = path.join(workspace, 'sdkwork-shop');
  createCoreSpec(root);
  writeJson(path.join(root, 'specs/iam.module.manifest.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.iam.module',
    moduleId: 'shop',
    domain: 'shop',
    permissions: { catalog: [] },
  });
  writeJson(path.join(workspace, 'sdkwork-drive/specs/iam.module.manifest.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.iam.module',
    moduleId: 'drive',
    domain: 'drive',
    permissions: { catalog: [] },
  });
  writeJson(path.join(workspace, '.sdkwork/tmp/sdkwork-drive-rebuild/specs/iam.module.manifest.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.iam.module',
    moduleId: 'drive',
    domain: 'drive',
    permissions: { catalog: [] },
  });

  const align = spawnSync(process.execPath, [ALIGNER, '--root', root, '--write'], {
    encoding: 'utf8',
  });

  assert.equal(align.status, 0, align.stderr);
  const spec = JSON.parse(
    fs.readFileSync(
      path.join(root, 'apps/sdkwork-shop-h5/packages/sdkwork-shop-h5-core/specs/component.spec.json'),
      'utf8',
    ),
  );
  const driveRef = spec.contracts.permissionComposition.moduleCatalogRefs.find(
    (entry) => entry.moduleId === 'drive',
  );
  assert.equal(driveRef?.manifestRef, '../../../../../sdkwork-drive/specs/iam.module.manifest.json');
  assert.equal(driveRef?.manifestRef.includes('.sdkwork'), false);
});
