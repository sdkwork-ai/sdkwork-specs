#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  REGISTRATION_ENVIRONMENTS,
  buildRegistrationInventory,
  discoverApplicationRoots,
  mapManifestAppTypeToApplicationType,
  slugifyAppKey,
} from '../inventory.mjs';

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 3,
    kind: 'agent.app',
    app: {
      key: 'sdkwork-im',
      name: 'SDKWork IM',
      displayName: 'SDKWork IM',
      appType: 'APP_REACT',
      ...(overrides.app ?? {}),
    },
    backend: {
      appId: 'sdkwork-im',
      tenantId: '100001',
      organizationId: '0',
      accessTokenPermissionScope: ['iam:self'],
      ...(overrides.backend ?? {}),
    },
    environments: {
      development: { accessUrl: 'http://127.0.0.1:4734' },
      production: { accessUrl: 'https://im.sdkwork.com' },
    },
  };
}

function createWorkspace(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-inventory-'));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('slugify matches the deploy slug rules', () => {
  assert.equal(slugifyAppKey('SDKWork IM PC'), 'sdkwork-im-pc');
  assert.equal(slugifyAppKey('  --A B--  '), 'a-b');
  assert.equal(slugifyAppKey('放大'), '');
  assert.equal(slugifyAppKey(''), '');
  assert.ok(slugifyAppKey('a'.repeat(400)).length <= 120);
});

test('app types map onto the IAM vocabulary', () => {
  assert.equal(mapManifestAppTypeToApplicationType('APP_HTML'), 'h5');
  assert.equal(mapManifestAppTypeToApplicationType('APP_FLUTTER'), 'flutter');
  assert.equal(mapManifestAppTypeToApplicationType(undefined), '');
});

test('the scan finds repository-root and apps/* manifests only', () => {
  createWorkspace((root) => {
    writeJson(path.join(root, 'sdkwork-im', 'agent.app.config.json'), manifest());
    writeJson(path.join(root, 'sdkwork-im', 'apps', 'sdkwork-im-pc', 'agent.app.config.json'), manifest({ app: { key: 'sdkwork-im-pc' } }));
    // Ignored locations.
    writeJson(path.join(root, 'sdkwork-im', 'node_modules', 'x', 'agent.app.config.json'), manifest());
    writeJson(path.join(root, 'sdkwork-im', 'dist', 'agent.app.config.json'), manifest());
    writeJson(path.join(root, 'not-a-repo', 'agent.app.config.json'), manifest());
    const roots = discoverApplicationRoots(root).map((entry) => path.relative(root, entry).split(path.sep).join('/'));
    assert.deepEqual(roots, ['sdkwork-im', 'sdkwork-im/apps/sdkwork-im-pc']);
  });
});

test('the inventory records surfaces, environments, sinks, and token carriers', () => {
  createWorkspace((root) => {
    writeJson(path.join(root, 'sdkwork-im', 'agent.app.config.json'), manifest());
    writeJson(
      path.join(root, 'sdkwork-im', 'etc', 'client-env.materialization.json'),
      {
        schemaVersion: 1,
        kind: 'sdkwork.client-env-materialization',
        application: 'sdkwork-im',
        surfaces: [
          {
            id: 'sdkwork-im-pc',
            root: 'apps/sdkwork-im-pc',
            format: 'vite',
            runtimeTarget: 'browser',
            accessToken: { appIdEnv: 'SDKWORK_DEPLOY_APPLICATION_ID' },
          },
        ],
      },
    );
    for (const environment of REGISTRATION_ENVIRONMENTS) {
      writeText(
        path.join(root, 'sdkwork-im', 'etc', 'topology', 'overrides', `standalone.${environment}.env`),
        `SDKWORK_ENVIRONMENT=${environment}\n`,
      );
    }
    writeJson(
      path.join(root, 'sdkwork-im', 'apps', 'sdkwork-im-pc', 'agent.app.config.json'),
      manifest({ app: { key: 'sdkwork-im-pc', name: 'SDKWork IM PC' } }),
    );
    writeText(
      path.join(root, 'sdkwork-im', 'apps', 'sdkwork-im-pc', '.env.standalone.development'),
      'SDKWORK_ACCESS_TOKEN=header.payload.signature\n',
    );

    const inventory = buildRegistrationInventory({ workspaceRoot: root });
    assert.equal(inventory.counts.applicationRoots, 2);
    assert.equal(inventory.counts.repositories, 1);
    assert.equal(inventory.counts.duplicateSlugs, 0);

    const repoEntry = inventory.entries.find((entry) => entry.id === 'sdkwork-im');
    assert.equal(repoEntry.appKey, 'sdkwork-im');
    assert.equal(repoEntry.applicationType, 'pc');
    assert.equal(repoEntry.slug, 'sdkwork-im');
    assert.equal(repoEntry.slugSource, 'app.key');
    assert.equal(
      repoEntry.tokenCarrier.kind,
      'client-env-materializer',
      'the repository materializes one anchor into its declared surfaces',
    );
    assert.equal(repoEntry.tokenCarrier.surfaces.length, 0, 'no surface is rooted at the repo root');
    assert.equal(repoEntry.tokenCarrier.repositorySurfaces.length, 1);

    const surfaceEntry = inventory.entries.find((entry) => entry.id === 'sdkwork-im/apps/sdkwork-im-pc');
    assert.equal(surfaceEntry.tokenCarrier.kind, 'client-env-materializer');
    assert.equal(surfaceEntry.tokenCarrier.surfaces.length, 1);
    assert.equal(surfaceEntry.tokenCarrier.surfaces[0].appIdEnv, 'SDKWORK_DEPLOY_APPLICATION_ID');
    assert.deepEqual(surfaceEntry.tokenCarrier.surfaces[0].profiles.present, ['standalone.development']);
    assert.equal(surfaceEntry.tokenCarrier.surfaces[0].profiles.missing.length, 9);
    assert.equal(surfaceEntry.environments.development.domain, 'http://127.0.0.1:4734');
    assert.equal(surfaceEntry.environments.production.domain, 'https://im.sdkwork.com');
    assert.deepEqual(
      surfaceEntry.environments.development.anchorSinks.map((sink) => sink.kind),
      ['topology-override'],
    );
  });
});

test('a fork that kept the upstream app key is reported as a slug collision', () => {
  createWorkspace((root) => {
    writeJson(path.join(root, 'sdkwork-birdcoder2', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-birdcoder2', name: 'BirdCoder' },
    }));
    writeJson(path.join(root, 'sdkwork-daxuedazi', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-birdcoder2', name: 'BirdCoder' },
    }));
    const inventory = buildRegistrationInventory({ workspaceRoot: root });
    assert.equal(inventory.counts.duplicateSlugs, 1);
    assert.deepEqual(
      inventory.duplicateSlugs[0].ids.sort(),
      ['sdkwork-birdcoder2', 'sdkwork-daxuedazi'],
    );
  });
});

test('a malformed manifest is listed with its parse error instead of aborting', () => {
  createWorkspace((root) => {
    writeText(path.join(root, 'sdkwork-broken', 'agent.app.config.json'), '{ not json');
    writeJson(path.join(root, 'sdkwork-fine', 'agent.app.config.json'), manifest());
    const inventory = buildRegistrationInventory({ workspaceRoot: root });
    assert.equal(inventory.counts.applicationRoots, 2);
    assert.equal(inventory.counts.parseErrors, 1);
    const broken = inventory.entries.find((entry) => entry.repo === 'sdkwork-broken');
    assert.match(broken.parseError, /JSON/u);
  });
});
