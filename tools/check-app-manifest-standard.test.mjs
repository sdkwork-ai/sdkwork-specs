import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findAppManifests,
  validateAppManifest,
  validateAppManifestFiles,
} from './check-app-manifest-standard.mjs';

function validManifest() {
  return {
    schemaVersion: 3,
    kind: 'sdkwork.app',
    app: {
      key: 'sdkwork-demo',
      name: 'sdkwork-demo',
      displayName: 'SDKWork Demo',
      officialWebsiteUrl: 'https://demo.sdkwork.com',
      appType: 'APP_REACT',
    },
    backend: {},
    runtime: {
      family: 'desktop',
      framework: 'react-tauri',
      supportedDeploymentProfiles: ['standalone', 'cloud'],
      defaultDeploymentProfile: 'standalone',
    },
    media: {
      icons: {
        primary: {
          id: 'primary-icon', width: 1024, height: 1024, format: 'PNG',
          url: 'https://cdn.sdkwork.com/demo/icon.png',
        },
        platform: [],
      },
      screenshots: [],
      previews: [],
    },
    publish: {},
    environments: {},
    artifacts: {
      installConfig: {
        defaultPackageId: 'windows-x64-dual-desktop-msi',
        packages: [{
          id: 'windows-x64-dual-desktop-msi',
          name: 'SDKWork Demo Windows',
          sourceType: 'BINARY_URL',
          packageFormat: 'MSI',
          platform: 'DESKTOP_WINDOWS',
          architecture: 'x64',
          profileBinding: 'runtime-configurable',
          supportedDeploymentProfiles: ['standalone', 'cloud'],
          defaultDeploymentProfile: 'standalone',
          runtimeTarget: 'desktop',
          targetPlatform: 'windows',
          clientArchitecture: 'tauri',
          url: 'https://downloads.sdkwork.com/demo/windows-x64.msi',
        }],
      },
    },
    release: {
      notes: [{ version: '1.0.0', current: true, packageIds: ['windows-x64-dual-desktop-msi'] }],
    },
    security: {},
  };
}

test('accepts a complete v3 manifest and composes deployment validation', () => {
  assert.deepEqual(validateAppManifest(validManifest()), []);
});

test('accepts an etc deployment index instead of a legacy environment map', () => {
  const manifest = validManifest();
  delete manifest.environments;
  manifest.metadata = { deploymentConfig: 'etc/sdkwork.deployment.config.json' };
  assert.deepEqual(validateAppManifest(manifest), []);
  manifest.metadata.deploymentConfig = 'configs/deployments.json';
  assert.ok(validateAppManifest(manifest).some((issue) => issue.includes('metadata.deploymentConfig')));
});

test('keeps the app type vocabulary aligned with the published schema', () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(import.meta.dirname, '..', 'schemas', 'sdkwork.app.config.schema.v3.json'),
    'utf8',
  ));
  const declared = schema.properties.app.properties.appType.enum;
  assert.ok(declared.includes('APP_HARMONY'));

  for (const appType of declared) {
    const manifest = validManifest();
    manifest.app.appType = appType;
    assert.ok(
      !validateAppManifest(manifest).some((issue) => issue.includes('app.appType')),
      `schema-declared appType ${appType} must be accepted by the validator`,
    );
  }

  const unknown = validManifest();
  unknown.app.appType = 'APP_ARKTS';
  assert.ok(validateAppManifest(unknown).some((issue) => issue.includes('app.appType')));
});

test('rejects unknown top-level fields, secrets, and broken release references', () => {
  const manifest = validManifest();
  manifest.environments.production = { apiKey: 'secret-value' };
  manifest.legacyConfig = {};
  manifest.release.notes[0].packageIds = ['missing-package'];
  const issues = validateAppManifest(manifest);
  assert.ok(issues.some((issue) => issue.includes('unknown top-level field')));
  assert.ok(issues.some((issue) => issue.includes('credential-like')));
  assert.ok(issues.some((issue) => issue.includes('references unknown')));
});

test('workspace discovery rejects duplicate global app keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-app-manifests-'));
  for (const name of ['sdkwork-one', 'sdkwork-two']) {
    const appRoot = path.join(root, name);
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(
      path.join(appRoot, 'sdkwork.app.config.json'),
      JSON.stringify(validManifest()),
    );
  }
  const files = findAppManifests(root);
  assert.equal(files.length, 2);
  assert.ok(validateAppManifestFiles(files, root).some((issue) => issue.includes('duplicates')));
});

test('workspace discovery excludes local application archives', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-app-manifest-archives-'));
  const activeRoot = path.join(root, 'sdkwork-active');
  const archiveRoot = path.join(root, '_sdkwork-agents-local-archive-20260718', 'sdkwork-active.bak');
  fs.mkdirSync(activeRoot, { recursive: true });
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.writeFileSync(
    path.join(activeRoot, 'sdkwork.app.config.json'),
    JSON.stringify(validManifest()),
  );
  fs.writeFileSync(
    path.join(archiveRoot, 'sdkwork.app.config.json'),
    JSON.stringify(validManifest()),
  );

  assert.deepEqual(findAppManifests(root), [
    path.join(activeRoot, 'sdkwork.app.config.json'),
  ]);
});

test('workspace validation reports malformed manifests and continues checking valid files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-invalid-app-manifests-'));
  const invalidRoot = path.join(root, 'sdkwork-invalid');
  const validRoot = path.join(root, 'sdkwork-valid');
  fs.mkdirSync(invalidRoot, { recursive: true });
  fs.mkdirSync(validRoot, { recursive: true });
  fs.writeFileSync(path.join(invalidRoot, 'sdkwork.app.config.json'), '');
  const manifest = validManifest();
  manifest.legacyConfig = {};
  fs.writeFileSync(
    path.join(validRoot, 'sdkwork.app.config.json'),
    JSON.stringify(manifest),
  );

  const issues = validateAppManifestFiles(findAppManifests(root), root);
  assert.ok(issues.includes('sdkwork-invalid/sdkwork.app.config.json: invalid JSON'));
  assert.ok(issues.some((issue) => (
    issue.includes('sdkwork-valid/sdkwork.app.config.json')
    && issue.includes('unknown top-level field')
  )));
});

test('enforces store media dimensions and immutable container URLs', () => {
  const manifest = validManifest();
  manifest.publish.stores = [{ marketId: 'GOOGLE_PLAY' }];
  manifest.media.icons.platform = [{
    id: 'google-icon', type: 'ICON', storePlatform: 'GOOGLE_PLAY', width: 512, height: 512,
    url: 'https://cdn.sdkwork.com/icon.png',
  }];
  manifest.artifacts.installConfig.packages[0].sourceType = 'CONTAINER_IMAGE';
  manifest.artifacts.installConfig.packages[0].packageFormat = 'DOCKER_IMAGE';
  manifest.artifacts.installConfig.packages[0].runtimeTarget = 'container';
  manifest.artifacts.installConfig.packages[0].id = 'container-x64-cloud-container-oci';
  manifest.artifacts.installConfig.packages[0].url = 'https://registry.sdkwork.com/demo:latest';
  const issues = validateAppManifest(manifest);
  assert.ok(issues.some((issue) => issue.includes('feature graphic')));
  assert.ok(issues.some((issue) => issue.includes('at least two screenshots')));
  assert.ok(issues.some((issue) => issue.includes('immutable OCI')));
});

test('allows a disabled deferred package to omit release checksums', () => {
  const manifest = validManifest();
  manifest.security.checksumRequired = true;
  manifest.artifacts.installConfig.packages[0].enabled = false;
  const issues = validateAppManifest(manifest);
  assert.ok(!issues.some((issue) => issue.includes('checksum is required')));
});

test('requires static checksums for direct distribution but not build scripts', () => {
  const scriptManifest = validManifest();
  scriptManifest.security.checksumRequired = true;
  scriptManifest.artifacts.installConfig.packages[0].sourceType = 'SCRIPT';
  assert.ok(
    !validateAppManifest(scriptManifest).some((issue) => issue.includes('checksum is required')),
  );

  const directManifest = validManifest();
  directManifest.security.checksumRequired = true;
  directManifest.artifacts.installConfig.packages[0].sourceType = 'BINARY_URL';
  assert.ok(
    validateAppManifest(directManifest).some((issue) => issue.includes('checksum is required')),
  );
});
