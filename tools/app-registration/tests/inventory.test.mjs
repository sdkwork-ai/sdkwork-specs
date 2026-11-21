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
  slugifyAppKey,
} from '../inventory.mjs';
import { resolveDeployAppSurface } from '../contract.mjs';

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
    runtime: {
      family: 'web',
      framework: 'react',
      ...(overrides.runtime ?? {}),
    },
    publish: {
      platforms: ['WEB'],
      ...(overrides.publish ?? {}),
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
      ...(overrides.environments ?? {}),
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

test('the inventory resolves each surface kind from its runtime facts', () => {
  createWorkspace((root) => {
    writeJson(path.join(root, 'sdkwork-demo', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-demo-h5', appType: 'APP_REACT' },
      runtime: { family: 'mobile', framework: 'react-h5' },
      publish: { platforms: ['H5'] },
    }));
    writeJson(path.join(root, 'sdkwork-demo', 'apps', 'sdkwork-demo-flutter-mobile', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-demo-flutter-mobile', appType: 'APP_FLUTTER' },
      runtime: { family: 'mobile', framework: 'flutter' },
      publish: { platforms: ['APP_IOS', 'APP_ANDROID'] },
    }));
    writeJson(path.join(root, 'sdkwork-demo', 'apps', 'sdkwork-demo-mini-program', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-demo-mini-program', appType: 'NONE' },
      runtime: { family: 'mini-program', framework: 'weixin-mini-program' },
      publish: { platforms: ['MP_WEIXIN'] },
    }));
    const inventory = buildRegistrationInventory({ workspaceRoot: root });
    const byId = Object.fromEntries(inventory.entries.map((entry) => [entry.id, entry]));
    assert.equal(byId['sdkwork-demo'].deployAppKind, 'H5_WEB');
    assert.equal(byId['sdkwork-demo'].applicationType, 'h5');
    assert.equal(byId['sdkwork-demo/apps/sdkwork-demo-flutter-mobile'].deployAppKind, 'FLUTTER_APP');
    assert.equal(byId['sdkwork-demo/apps/sdkwork-demo-flutter-mobile'].applicationType, 'flutter');
    assert.equal(byId['sdkwork-demo/apps/sdkwork-demo-mini-program'].deployAppKind, 'WECHAT_MINIPROGRAM');
    assert.equal(byId['sdkwork-demo/apps/sdkwork-demo-mini-program'].applicationType, 'miniprogram');
    assert.equal(byId['sdkwork-demo/apps/sdkwork-demo-mini-program'].appTypeWarning, true);
    assert.equal(inventory.counts.missingDeployAppKind, 0);
    assert.deepEqual(inventory.counts.deployAppKinds, {
      FLUTTER_APP: 1,
      H5_WEB: 1,
      WECHAT_MINIPROGRAM: 1,
    });
  });
});

test('a manifest without runtime facts fails the surface resolution', () => {
  const resolved = resolveDeployAppSurface({ appType: 'APP_REACT' });
  assert.equal(resolved.deployAppKind, '');
  assert.match(resolved.defects.join(' '), /cannot derive the deploy application kind/u);
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
    assert.equal(
      repoEntry.tokenCarrier.mintsPublicToken,
      true,
      'the declared surface carries accessToken, so a public client token is minted',
    );
    assert.equal(repoEntry.permissionScopeRequirement.kind, 'materialized');
    assert.equal(repoEntry.permissionScopeRequirement.requiresPermissionScope, true);
    assert.equal(repoEntry.serversOnly, false);

    const surfaceEntry = inventory.entries.find((entry) => entry.id === 'sdkwork-im/apps/sdkwork-im-pc');
    assert.equal(surfaceEntry.tokenCarrier.kind, 'client-env-materializer');
    assert.equal(surfaceEntry.tokenCarrier.surfaces.length, 1);
    assert.equal(surfaceEntry.tokenCarrier.surfaces[0].appIdEnv, 'SDKWORK_DEPLOY_APPLICATION_ID');
    assert.deepEqual(surfaceEntry.tokenCarrier.surfaces[0].profiles.present, ['standalone.development']);
    assert.equal(surfaceEntry.tokenCarrier.surfaces[0].profiles.missing.length, 9);
    assert.equal(surfaceEntry.environments.development.domain, 'http://127.0.0.1:4734');
    assert.equal(
      surfaceEntry.environments.development.domainSource,
      'environments.development.accessUrl',
      'the scan names the source the registrar will normalize',
    );
    assert.equal(surfaceEntry.environments.development.accessUrl, 'http://127.0.0.1:4734');
    assert.equal(surfaceEntry.environments.development.deployUrl, '');
    assert.equal(surfaceEntry.environments.production.domain, 'https://im.sdkwork.com');
    assert.deepEqual(
      surfaceEntry.environments.development.anchorSinks.map((sink) => sink.kind),
      ['topology-override'],
    );
  });
});

test('the scan keeps accessUrl, deployUrl, and the backend fallback apart', () => {
  createWorkspace((root) => {
    writeJson(path.join(root, 'sdkwork-im', 'agent.app.config.json'), manifest({
      environments: {
        development: { deployUrl: 'https://deploy-dev.sdkwork.test' },
        test: { accessUrl: '', deployUrl: '' },
      },
      backend: { primaryDomain: 'im.sdkwork.test' },
    }));
    const inventory = buildRegistrationInventory({ workspaceRoot: root });
    const entry = inventory.entries[0];
    assert.equal(
      entry.environments.development.domain,
      'https://deploy-dev.sdkwork.test',
      'deployUrl is the second source when accessUrl is absent',
    );
    assert.equal(entry.environments.development.domainSource, 'environments.development.deployUrl');
    assert.equal(
      entry.environments.test.domain,
      'im.sdkwork.test',
      'the manifest-wide backend.primaryDomain is the fallback',
    );
    assert.equal(entry.environments.test.domainSource, 'backend.primaryDomain');
    assert.equal(entry.backendPrimaryDomain, 'im.sdkwork.test');
    assert.equal(entry.environments.staging.domain, 'im.sdkwork.test');
  });
});

test('a manifest with no domain source at all reports an empty candidate', () => {
  createWorkspace((root) => {
    writeJson(path.join(root, 'sdkwork-im', 'agent.app.config.json'), manifest({
      environments: { development: {}, production: {} },
    }));
    const inventory = buildRegistrationInventory({ workspaceRoot: root });
    assert.equal(inventory.entries[0].environments.development.domain, '');
    assert.equal(inventory.entries[0].environments.development.domainSource, '');
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

test('the scope requirement follows the client token carrier, not the manifest', () => {
  createWorkspace((root) => {
    // materialized: the materializer declares an accessToken surface.
    writeJson(path.join(root, 'sdkwork-materialized', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-materialized' },
    }));
    writeJson(
      path.join(root, 'sdkwork-materialized', 'etc', 'client-env.materialization.json'),
      {
        schemaVersion: 1,
        kind: 'sdkwork.client-env-materialization',
        application: 'sdkwork-materialized',
        surfaces: [{
          id: 'sdkwork-materialized',
          root: '.',
          format: 'vite',
          runtimeTarget: 'browser',
          accessToken: { appIdEnv: 'SDKWORK_DEPLOY_APPLICATION_ID' },
        }],
      },
    );
    // declared: no carrier at all, but the manifest states its own scope.
    writeJson(path.join(root, 'sdkwork-declared', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-declared' },
    }));
    // missingClientEnvConfiguration: client dirs, no materialization, no scope.
    writeJson(path.join(root, 'sdkwork-clientface', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-clientface' },
      backend: { accessTokenPermissionScope: [] },
    }));
    mkdirSync(path.join(root, 'sdkwork-clientface', 'apps', 'sdkwork-clientface-pc'), { recursive: true });
    // notApplicable: no client dirs, no carrier, no scope.
    writeJson(path.join(root, 'sdkwork-server', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-server' },
      backend: { accessTokenPermissionScope: [] },
    }));
    // A server-profile materialization (format none, no accessToken) mints no
    // public token, so it is still server-only for the scope requirement.
    writeJson(path.join(root, 'sdkwork-serverprofile', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-serverprofile' },
      backend: { accessTokenPermissionScope: [] },
    }));
    writeJson(
      path.join(root, 'sdkwork-serverprofile', 'etc', 'client-env.materialization.json'),
      {
        schemaVersion: 1,
        kind: 'sdkwork.client-env-materialization',
        application: 'sdkwork-serverprofile',
        surfaces: [{ id: 'sdkwork-serverprofile', root: '.', format: 'none', runtimeTarget: 'server' }],
      },
    );

    const inventory = buildRegistrationInventory({ workspaceRoot: root });
    const byId = new Map(inventory.entries.map((entry) => [entry.id, entry]));

    const materialized = byId.get('sdkwork-materialized');
    assert.equal(materialized.permissionScopeRequirement.kind, 'materialized');
    assert.equal(materialized.permissionScopeRequirement.requiresPermissionScope, true);
    assert.equal(materialized.serversOnly, false);

    const declared = byId.get('sdkwork-declared');
    assert.equal(declared.permissionScopeRequirement.kind, 'declared');
    assert.equal(
      declared.permissionScopeRequirement.requiresPermissionScope,
      false,
      'a manifest that states its own scope is not asked for one because of a carrier it lacks',
    );
    assert.equal(declared.serversOnly, false);

    const clientFace = byId.get('sdkwork-clientface');
    assert.equal(clientFace.permissionScopeRequirement.kind, 'missingClientEnvConfiguration');
    assert.equal(
      clientFace.permissionScopeRequirement.requiresClientEnvMaterialization,
      true,
      'the actionable prerequisite is the materialization declaration',
    );
    assert.deepEqual(clientFace.clientSurface.directories, ['apps/sdkwork-clientface-pc']);
    assert.equal(clientFace.serversOnly, false, 'a client face is not a server-only root');

    const server = byId.get('sdkwork-server');
    assert.equal(server.permissionScopeRequirement.kind, 'notApplicable');
    assert.equal(server.serversOnly, true);
    assert.equal(server.permissionScopeRequirement.requiresPermissionScope, false);

    const serverProfile = byId.get('sdkwork-serverprofile');
    assert.equal(
      serverProfile.permissionScopeRequirement.kind,
      'notApplicable',
      'a format:none server surface carries no accessToken, so it requires no scope',
    );
    assert.equal(serverProfile.tokenCarrier.mintsPublicToken, false);

    assert.deepEqual(inventory.counts.scopeRequirement, {
      materialized: 1,
      declared: 1,
      missingClientEnvConfiguration: 1,
      notApplicable: 2,
    });
    assert.equal(inventory.counts.missingClientEnvConfiguration, 1);
    assert.equal(inventory.counts.serversOnly, 2);
    assert.equal(
      inventory.counts.missingPermissionScopeRequired,
      0,
      'an empty scope is only a defect where a public token is actually minted',
    );
  });
});

test('a client face that declares its own scope keeps a note instead of a defect', () => {
  createWorkspace((root) => {
    writeJson(path.join(root, 'sdkwork-clientface', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-clientface' },
    }));
    mkdirSync(path.join(root, 'sdkwork-clientface', 'apps', 'sdkwork-clientface-h5'), { recursive: true });
    const inventory = buildRegistrationInventory({ workspaceRoot: root });
    const entry = inventory.entries[0];
    assert.equal(entry.permissionScopeRequirement.kind, 'declared');
    assert.equal(entry.permissionScopeRequirement.requiresClientEnvMaterialization, false);
    assert.equal(entry.permissionScopeRequirement.notes.length, 1);
    assert.match(entry.permissionScopeRequirement.notes[0], /client-env\.materialization\.json/u);
  });
});

test('a profile carrier file alone keeps the scope requirement, without a declaration', () => {
  createWorkspace((root) => {
    writeJson(path.join(root, 'sdkwork-carrier', 'agent.app.config.json'), manifest({
      app: { key: 'sdkwork-carrier' },
    }));
    writeText(
      path.join(root, 'sdkwork-carrier', '.env.standalone.development'),
      'SDKWORK_ACCESS_TOKEN=header.payload.signature\n',
    );
    const inventory = buildRegistrationInventory({ workspaceRoot: root });
    const entry = inventory.entries[0];
    assert.equal(entry.permissionScopeRequirement.kind, 'materialized');
    assert.equal(entry.permissionScopeRequirement.requiresPermissionScope, true);
    assert.deepEqual(
      entry.permissionScopeRequirement.carrier.profileFiles.map((file) => file.profileId),
      ['standalone.development'],
    );
  });
});

