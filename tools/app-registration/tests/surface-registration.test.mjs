#!/usr/bin/env node

/**
 * Per-surface registration: one deploy application, one anchor, and one token
 * carrier per endpoint surface (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §5, §11).
 *
 * The suites drive the real registrar against the loopback Deploy/IAM fake and
 * the real client-env materializer in-process, so a regression in the anchor
 * plumbing (surface-scoped variable, `--surface` filter, idempotency) fails here
 * instead of silently baking one surface's anchor into another surface's carrier.
 *
 * @module app-registration/tests/surface-registration
 */

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseClientEnvArgs,
  parseClientEnvDotenv,
  materializeClientEnv,
} from '../../materialize-client-env.mjs';
import { materializeTopologyEnv } from '../../materialize-topology-env.mjs';
import { decodeApplicationAccessToken } from '../../app-access-token.mjs';
import { DEPLOY_APPLICATION_ID_ENV } from '../contract.mjs';
import { buildRegistrationInventory } from '../inventory.mjs';
import { registerApplications } from '../register.mjs';
import { startFakeStack } from './fake-stack.mjs';

const PC_ANCHOR_ENV = 'SDKWORK_DEPLOY_APPLICATION_ID_SDKWORK_IM_PC';
const FLUTTER_ANCHOR_ENV = 'SDKWORK_DEPLOY_APPLICATION_ID_SDKWORK_IM_FLUTTER_MOBILE';

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
      key: 'chat',
      name: 'chat',
      displayName: 'Sdkwork IM',
      appType: 'APP_API',
      ...(overrides.app ?? {}),
    },
    backend: {
      appId: 'sdkwork-im-pc',
      tenantId: '100001',
      organizationId: '0',
      accessTokenPermissionScope: ['iam:self'],
      ...(overrides.backend ?? {}),
    },
    environments: {
      development: { accessUrl: 'http://127.0.0.1:4734' },
      production: { accessUrl: 'https://chat.sdkwork.test' },
      ...(overrides.environments ?? {}),
    },
  };
}

const VITE_SURFACE_DECLARATION = {
  id: 'sdkwork-im-pc',
  root: 'apps/sdkwork-im-pc',
  format: 'vite',
  runtimeTarget: 'browser',
  identityPrefixes: ['VITE_SDKWORK_IM'],
  accessToken: {
    appIdEnv: DEPLOY_APPLICATION_ID_ENV,
    tenantId: '100001',
    organizationId: '0',
    permissionScope: ['iam:self'],
  },
  bindings: {
    VITE_SDKWORK_IM_APPLICATION_PUBLIC_HTTP_URL: 'SDKWORK_IM_APPLICATION_PUBLIC_HTTP_URL',
  },
};

const FLUTTER_SURFACE_DECLARATION = {
  id: 'sdkwork-im-flutter-mobile',
  root: 'apps/sdkwork-im-flutter-mobile',
  format: 'flutter',
  runtimeTarget: 'flutter-android',
  identityPrefixes: ['SDKWORK_IM'],
  accessToken: {
    appIdEnv: DEPLOY_APPLICATION_ID_ENV,
    tenantId: '100001',
    organizationId: '0',
    permissionScope: ['iam:self'],
  },
  bindings: {
    SDKWORK_IM_APPLICATION_PUBLIC_HTTP_URL: 'SDKWORK_IM_APPLICATION_PUBLIC_HTTP_URL',
  },
};

/**
 * A repository shaped like `sdkwork-im`: a repository-root manifest plus one
 * manifest per endpoint surface, and a client-env declaration naming each surface.
 * @param options - surface declarations to use and which manifests to write
 * @returns workspace handle
 */
function createMultiSurfaceWorkspace(options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-surface-registration-'));
  const repoRoot = path.join(root, 'sdkwork-im');
  const surfaces = options.surfaces ?? [
    VITE_SURFACE_DECLARATION,
    FLUTTER_SURFACE_DECLARATION,
  ];
  const manifests = options.manifests ?? [
    ['agent.app.config.json', manifest({ app: { appType: 'APP_API' } })],
    ['apps/sdkwork-im-pc/agent.app.config.json', manifest({
      app: { key: 'sdkwork-im-pc', name: 'Sdkwork IM PC', displayName: 'Sdkwork IM PC', appType: 'APP_REACT' },
      environments: {
        development: { accessUrl: 'https://pc-dev.sdkwork.test' },
        production: { accessUrl: 'https://pc.sdkwork.test' },
      },
    })],
    ['apps/sdkwork-im-flutter-mobile/agent.app.config.json', manifest({
      app: {
        key: 'sdkwork-im-flutter-mobile',
        name: 'Sdkwork IM Mobile',
        displayName: 'Sdkwork IM Mobile',
        appType: 'APP_FLUTTER',
      },
      environments: {
        development: { accessUrl: 'https://flutter-dev.sdkwork.test' },
        production: { accessUrl: 'https://flutter.sdkwork.test' },
      },
    })],
  ];
  for (const [relativePath, value] of manifests) {
    writeJson(path.join(repoRoot, relativePath), value);
  }
  writeJson(path.join(repoRoot, 'etc', 'client-env.materialization.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.client-env-materialization',
    application: 'sdkwork-im',
    command: 'pnpm workflow:materialize-client-env',
    // The production matrix is covered by the lifecycle-filter suites; these
    // suites materialize one lifecycle so the fixture stays small.
    profiles: ['standalone.development'],
    sourceIdentity: {
      deploymentProfileKeys: ['SDKWORK_DEPLOYMENT_PROFILE'],
      environmentKeys: ['SDKWORK_ENVIRONMENT'],
      profileIdKeys: ['SDKWORK_PROFILE_ID'],
    },
    surfaces,
  });
  writeJson(path.join(repoRoot, 'etc', 'sdkwork.deployment.config.json'), {
    profiles: {
      'standalone.development': { config: 'topology/standalone.development.env' },
    },
  });
  writeText(
    path.join(repoRoot, 'etc', 'topology', 'overrides', 'standalone.development.env'),
    'SDKWORK_ENVIRONMENT=development\n'
    + 'SDKWORK_IM_APPLICATION_PUBLIC_HTTP_URL=http://127.0.0.1:4734\n',
  );
  return {
    root,
    repoRoot,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Runner that executes the real topology and client-env materializers
 * in-process, recording the exact argv and environment the registrar passes.
 * @returns recording runner
 */
function materializingRunner() {
  const calls = [];
  return {
    calls,
    materializeCalls() {
      return calls.filter((call) => call.script === 'materialize-client-env.mjs');
    },
    topologyCalls() {
      return calls.filter((call) => call.script === 'materialize-topology-env.mjs');
    },
    async run({ script, args, env }) {
      const name = path.basename(script);
      calls.push({ script: name, args: [...args], env: { ...env } });
      if (name === 'materialize-topology-env.mjs') {
        const rootIndex = args.indexOf('--root');
        const profileIndex = args.indexOf('--profile');
        materializeTopologyEnv({
          root: args[rootIndex + 1],
          profile: args[profileIndex + 1],
        });
        return { code: 0 };
      }
      if (name === 'materialize-client-env.mjs') {
        const options = parseClientEnvArgs(args);
        materializeClientEnv({
          rootDir: options.root,
          environments: options.environments,
          surfaces: options.surfaces,
          env,
        });
        return { code: 0 };
      }
      return { code: 0 };
    },
  };
}

function settingsFor(stack) {
  return {
    deploy: {
      baseUrl: stack.baseUrl,
      accessToken: 'access-token',
      authToken: 'auth-token',
      timeoutMs: 2_000,
    },
    iam: {
      baseUrl: stack.baseUrl,
      auth: { authToken: 'operator-token' },
      management: { accessToken: 'management-access', authToken: 'management-auth' },
      timeoutMs: 2_000,
    },
    tenantId: '100001',
    organizationId: '0',
  };
}

async function runRegistration({ workspaceRoot, stack, environment = 'development', overrides = {} }) {
  const runner = materializingRunner();
  const sleeps = [];
  const report = await registerApplications(
    {
      workspaceRoot,
      environment,
      settings: settingsFor(stack),
      retryDelayMs: 0,
      ...overrides,
    },
    {
      inventory: buildRegistrationInventory({ workspaceRoot }),
      runNodeScript: runner.run,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      jitter: () => 0,
    },
  );
  return { report, runner, sleeps };
}

function readDotenvToken(filePath) {
  return parseClientEnvDotenv(readFileSync(filePath, 'utf8')).SDKWORK_ACCESS_TOKEN;
}

function readJsonToken(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8')).SDKWORK_ACCESS_TOKEN;
}

function tokenAppId(token) {
  return decodeApplicationAccessToken(token).payload.app_id;
}

/** Every file under one directory with its exact bytes. */
function snapshotTree(directory) {
  const files = new Map();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      files.set(
        path.relative(directory, fullPath).replaceAll('\\', '/'),
        readFileSync(fullPath, 'utf8'),
      );
    }
  };
  walk(directory);
  return files;
}

test('scope=all anchors each surface with its own deploy application and carrier', async () => {
  const workspace = createMultiSurfaceWorkspace();
  const stack = await startFakeStack();
  try {
    const { report, runner } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { scope: 'all' },
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries.map((entry) => entry.error)));
    assert.equal(report.counts.planned, 3, 'the repository root plus two surface manifests');
    assert.equal(report.counts.created, 3);
    assert.equal(report.counts.materializeConflict, 0, 'per-surface anchors no longer collide');
    assert.equal(report.counts.materializeFailed, 0);
    assert.equal(report.counts.surfaceMaterialized, 2);

    const byId = new Map(report.entries.map((entry) => [entry.id, entry]));
    const root = byId.get('sdkwork-im');
    const pc = byId.get('sdkwork-im/apps/sdkwork-im-pc');
    const flutter = byId.get('sdkwork-im/apps/sdkwork-im-flutter-mobile');

    assert.equal(root.anchorGroup, 'surface');
    assert.equal(
      root.materialize.status,
      'not-applicable',
      'the repository-root manifest owns no declared surface of its own',
    );
    assert.match(root.materialize.reason, /one anchor per surface/u);

    const anchors = [root.deployApplicationId, pc.deployApplicationId, flutter.deployApplicationId];
    assert.equal(new Set(anchors).size, 3, 'every manifest root owns its own deploy application');
    assert.equal(stack.apps.size, 3);

    assert.equal(pc.anchorGroup, 'surface');
    assert.equal(flutter.anchorGroup, 'surface');
    assert.equal(pc.materialize.status, 'materialized');
    assert.equal(pc.materialize.mode, 'surface');
    assert.deepEqual(pc.materialize.surfaces, ['sdkwork-im-pc']);
    assert.deepEqual(pc.materialize.args, [
      '--root', workspace.repoRoot,
      '--environment', 'development',
      '--surface', 'sdkwork-im-pc',
    ]);
    assert.deepEqual(pc.materialize.anchorVariables, [PC_ANCHOR_ENV]);
    assert.deepEqual(flutter.materialize.args, [
      '--root', workspace.repoRoot,
      '--environment', 'development',
      '--surface', 'sdkwork-im-flutter-mobile',
    ]);
    assert.deepEqual(flutter.materialize.anchorVariables, [FLUTTER_ANCHOR_ENV]);

    // Each surface carrier carries its own anchor — never the root's, never the
    // other surface's.
    const pcTokenFile = path.join(
      workspace.repoRoot,
      'apps/sdkwork-im-pc/.env.standalone.development',
    );
    const flutterTokenFile = path.join(
      workspace.repoRoot,
      'apps/sdkwork-im-flutter-mobile/env/sdkwork.standalone.development.json',
    );
    assert.equal(tokenAppId(readDotenvToken(pcTokenFile)), pc.deployApplicationId);
    assert.equal(tokenAppId(readJsonToken(flutterTokenFile)), flutter.deployApplicationId);
    assert.notEqual(pc.deployApplicationId, flutter.deployApplicationId);
    assert.notEqual(pc.deployApplicationId, root.deployApplicationId);

    // The authored env layer records one identity per surface next to the
    // repository-level identity, so nothing is overwritten.
    const overrideEnv = readFileSync(
      path.join(workspace.repoRoot, 'etc/topology/overrides/standalone.development.env'),
      'utf8',
    );
    const envValues = parseClientEnvDotenv(overrideEnv);
    assert.equal(envValues[DEPLOY_APPLICATION_ID_ENV], root.deployApplicationId);
    assert.equal(envValues[PC_ANCHOR_ENV], pc.deployApplicationId);
    assert.equal(envValues[FLUTTER_ANCHOR_ENV], flutter.deployApplicationId);
    assert.equal(
      report.counts.surfaceAnchorsWritten,
      2,
      'both surface-scoped anchor records were created',
    );

    // Two surface materializer runs (one per surface), and one topology
    // regeneration per (repository, profile) even though three items wrote to
    // the same authored layer.
    assert.equal(runner.materializeCalls().length, 2);
    assert.equal(runner.topologyCalls().length, 1);
    assert.equal(
      runner.materializeCalls().filter((call) => call.args.includes('--surface')).length,
      2,
      'the hand-off never materializes the unfiltered matrix for a surface registration',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a repeated surface registration changes nothing and reuses every application', async () => {
  const workspace = createMultiSurfaceWorkspace();
  const stack = await startFakeStack();
  try {
    const first = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { scope: 'all' },
    });
    assert.equal(first.report.counts.failed, 0);
    const before = snapshotTree(workspace.repoRoot);
    const firstIdempotencyKeys = first.report.entries.map(
      (entry) => [entry.id, entry.deploy.idempotencyKey],
    );
    const createsAfterFirst = stack.requestsFor('POST', '/app/v3/api/apps').length;
    assert.equal(createsAfterFirst, 3);

    const second = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { scope: 'all' },
    });
    assert.equal(second.report.counts.failed, 0, JSON.stringify(
      second.report.entries.map((entry) => entry.error),
    ));
    assert.equal(second.report.counts.created, 0, 'every application is reused');
    assert.equal(second.report.counts.reused, 3);
    assert.equal(
      stack.requestsFor('POST', '/app/v3/api/apps').length,
      createsAfterFirst,
      'a repeated run creates no second application',
    );
    assert.equal(second.report.counts.surfaceAnchorsWritten, 0);
    assert.equal(second.report.counts.anchorsAlreadyPresent, 3);
    assert.deepEqual(
      second.report.entries.map((entry) => [entry.id, entry.deploy.idempotencyKey]),
      firstIdempotencyKeys,
      'the deterministic idempotency keys are stable across runs',
    );
    for (const entry of second.report.entries) {
      assert.deepEqual(entry.anchor.written, [], `${entry.id} wrote no anchor`);
    }
    assert.deepEqual(
      [...snapshotTree(workspace.repoRoot).entries()],
      [...before.entries()],
      'the whole repository is byte-identical after the repeated run',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a single-surface repository keeps the one-anchor-per-repository hand-off', async () => {
  const workspace = createMultiSurfaceWorkspace({
    surfaces: [VITE_SURFACE_DECLARATION],
    manifests: [
      ['agent.app.config.json', manifest({ app: { appType: 'APP_API' } })],
      ['apps/sdkwork-im-pc/agent.app.config.json', manifest({
        app: { key: 'sdkwork-im-pc', name: 'Sdkwork IM PC', appType: 'APP_REACT' },
        environments: {
          development: { accessUrl: 'https://pc-dev.sdkwork.test' },
          production: { accessUrl: 'https://pc.sdkwork.test' },
        },
      })],
    ],
  });
  const stack = await startFakeStack();
  try {
    // The default scope registers one application per repository.
    const { report, runner } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    assert.equal(report.counts.planned, 1);
    const [entry] = report.entries;
    assert.equal(entry.anchorGroup, 'repository');
    assert.equal(entry.materialize.mode, 'repository');
    assert.deepEqual(entry.materialize.args, [
      '--root', workspace.repoRoot,
      '--environment', 'development',
    ]);
    assert.deepEqual(entry.materialize.anchorVariables, [DEPLOY_APPLICATION_ID_ENV]);
    const tokenFile = path.join(
      workspace.repoRoot,
      'apps/sdkwork-im-pc/.env.standalone.development',
    );
    assert.equal(tokenAppId(readDotenvToken(tokenFile)), entry.deployApplicationId);
    const envValues = parseClientEnvDotenv(readFileSync(
      path.join(workspace.repoRoot, 'etc/topology/overrides/standalone.development.env'),
      'utf8',
    ));
    assert.equal(envValues[DEPLOY_APPLICATION_ID_ENV], entry.deployApplicationId);
    assert.equal(envValues[PC_ANCHOR_ENV], undefined, 'no surface variable in repository mode');
    assert.equal(runner.materializeCalls().length, 1);
    assert.equal(runner.materializeCalls()[0].args.includes('--surface'), false);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a 429 during a surface registration waits for Retry-After and still registers every surface', async () => {
  const workspace = createMultiSurfaceWorkspace();
  const stack = await startFakeStack();
  try {
    stack.failNextOnce({
      method: 'POST',
      path: '/app/v3/api/apps',
      status: 429,
      headers: { 'retry-after': '1' },
      body: { status: 429, code: 42901, detail: 'too many requests' },
    });
    const { report, sleeps } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { scope: 'all', maxAttempts: 5, retryDelayMs: 100 },
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries.map((entry) => entry.error)));
    assert.equal(report.counts.created, 3);
    assert.ok(sleeps.length >= 1, 'the throttled create must wait before retrying');
    assert.ok(sleeps[0] >= 1_000, `the wait must honour Retry-After (1000ms), got ${sleeps[0]}ms`);
    assert.equal(stack.apps.size, 3);
    assert.equal(
      report.entries.filter((entry) => entry.materialize.status === 'materialized').length,
      2,
      'both surface carriers were materialized',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('each surface create carries its own deterministic idempotency key', async () => {
  const workspace = createMultiSurfaceWorkspace();
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { scope: 'all' },
    });
    assert.equal(report.counts.failed, 0);
    const created = stack.requestsFor('POST', '/app/v3/api/apps');
    const keys = created.map((request) => request.headers['idempotency-key']);
    assert.equal(new Set(keys).size, 3, 'one key per surface, none shared');
    for (const key of keys) {
      assert.match(key, /^sdkwork-app-register:development:/u);
    }
    for (const entry of report.entries) {
      assert.equal(
        entry.deploy.idempotencyKey,
        `sdkwork-app-register:development:${entry.slug}`,
      );
    }
    const hashes = created.map((request) => request.headers['x-content-sha256']);
    assert.ok(hashes.every((hash) => /^[0-9a-f]{64}$/u.test(hash)), 'every create sends the body digest');
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('two declared surfaces that would share one anchor variable fail at plan time', async () => {
  const workspace = createMultiSurfaceWorkspace({
    surfaces: [
      {
        ...VITE_SURFACE_DECLARATION,
        id: 'sdkwork-im-pc',
        root: 'apps/sdkwork-im-pc',
      },
      {
        ...FLUTTER_SURFACE_DECLARATION,
        id: 'sdkwork-im_pc',
        root: 'apps/sdkwork-im-flutter-mobile',
      },
    ],
  });
  const stack = await startFakeStack();
  try {
    const { report, runner } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { scope: 'all' },
    });
    const pc = report.entries.find((entry) => entry.id === 'sdkwork-im/apps/sdkwork-im-pc');
    assert.equal(pc.status, 'failed');
    assert.equal(pc.errorKind, 'plan');
    assert.match(pc.error, /would share the anchor variable .*SDKWORK_DEPLOY_APPLICATION_ID_SDKWORK_IM_PC/u);
    assert.equal(runner.materializeCalls().length, 0, 'a plan defect never reaches the materializer');
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('the inventory records each surface anchor sink and its profile file set', () => {
  const workspace = createMultiSurfaceWorkspace();
  try {
    const inventory = buildRegistrationInventory({ workspaceRoot: workspace.root });
    const pc = inventory.entries.find((entry) => entry.id === 'sdkwork-im/apps/sdkwork-im-pc');
    assert.equal(pc.surfaceAnchors.length, 1);
    const [anchor] = pc.surfaceAnchors;
    assert.equal(anchor.id, 'sdkwork-im-pc');
    assert.equal(anchor.baseAnchorEnvName, DEPLOY_APPLICATION_ID_ENV);
    assert.equal(anchor.surfaceAnchorEnvName, PC_ANCHOR_ENV);
    assert.deepEqual(
      anchor.profileFiles.map((file) => file.path).filter((file) => file.endsWith('standalone.development')),
      ['apps/sdkwork-im-pc/.env.standalone.development'],
    );
    assert.equal(anchor.profileFiles.length, 10, 'the full standalone/cloud × lifecycle matrix');

    const root = inventory.entries.find((entry) => entry.id === 'sdkwork-im');
    assert.deepEqual(
      root.surfaceAnchors,
      [],
      'the repository-root manifest owns no surface rooted at the repository root',
    );
    assert.equal(
      root.tokenCarrier.repositorySurfaces.length,
      2,
      'the repository-level view still lists every declared surface',
    );
    assert.deepEqual(
      root.tokenCarrier.repositorySurfaces.map((surface) => surface.surfaceAnchorEnvName),
      [PC_ANCHOR_ENV, FLUTTER_ANCHOR_ENV],
    );
    assert.equal(inventory.counts.surfaceAnchors, 2);
    assert.equal(inventory.counts.entriesWithSurfaceAnchor, 2);
  } finally {
    workspace.cleanup();
  }
});
