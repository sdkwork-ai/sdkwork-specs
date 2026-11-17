#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEPLOY_APPLICATION_ID_ENV } from '../contract.mjs';
import { buildRegistrationInventory } from '../inventory.mjs';
import { registerApplications } from '../register.mjs';
import { runMain } from '../register-applications.mjs';
import { startFakeStack } from './fake-stack.mjs';

const SECRET_OMIT = Symbol('omit');

/**
 * Build a throwaway workspace with the env configuration the registrar writes.
 * @param options - repositories to create
 * @returns workspace root and cleanup
 */
function createWorkspace(options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-registration-'));
  for (const repo of options.repositories ?? []) {
    const repoRoot = path.join(root, repo.name);
    mkdirSync(repoRoot, { recursive: true });
    writeFileSync(
      path.join(repoRoot, 'agent.app.config.json'),
      `${JSON.stringify(repo.manifest, null, 2)}\n`,
      'utf8',
    );
    if (repo.clientEnv) {
      mkdirSync(path.join(repoRoot, 'etc'), { recursive: true });
      writeFileSync(
        path.join(repoRoot, 'etc', 'client-env.materialization.json'),
        `${JSON.stringify(repo.clientEnv, null, 2)}\n`,
        'utf8',
      );
    }
    for (const appDir of repo.apps ?? []) {
      mkdirSync(path.join(repoRoot, appDir), { recursive: true });
    }
    const overrides = path.join(repoRoot, 'etc', 'topology', 'overrides');
    mkdirSync(overrides, { recursive: true });
    for (const environment of ['development', 'production']) {
      const deploymentProfile = environment === 'development' ? 'standalone' : 'cloud';
      writeFileSync(
        path.join(overrides, `${deploymentProfile}.${environment}.env`),
        `# authored override layer\nSDKWORK_ENVIRONMENT=${environment}\n`,
        'utf8',
      );
    }
    if (repo.envAnchor) {
      writeFileSync(
        path.join(overrides, `${repo.envAnchor.profile}.${repo.envAnchor.environment}.env`),
        `SDKWORK_ENVIRONMENT=${repo.envAnchor.environment}\n`
        + `${DEPLOY_APPLICATION_ID_ENV}=${repo.envAnchor.anchor}\n`,
        'utf8',
      );
    }
  }
  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 3,
    kind: 'agent.app',
    app: {
      key: 'sdkwork-demo',
      name: 'SDKWork Demo',
      displayName: 'SDKWork Demo',
      appType: 'APP_REACT',
      ...(overrides.app ?? {}),
    },
    backend: {
      appId: 'sdkwork-demo',
      tenantId: '100001',
      organizationId: '0',
      accessTokenPermissionScope: ['iam:self'],
      ...(overrides.backend ?? {}),
    },
    environments: {
      development: { accessUrl: 'http://127.0.0.1:4734' },
      production: { accessUrl: 'https://demo.sdkwork.com' },
      ...(overrides.environments ?? {}),
    },
  };
}

function clientEnv() {
  return {
    schemaVersion: 1,
    kind: 'sdkwork.client-env-materialization',
    application: 'sdkwork-demo',
    surfaces: [{
      id: 'sdkwork-demo-pc',
      root: '.',
      format: 'vite',
      runtimeTarget: 'browser',
      accessToken: { appIdEnv: DEPLOY_APPLICATION_ID_ENV },
    }],
  };
}

function settingsFor(stack, options = {}) {
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
      management: options.management === false
        ? { accessToken: '', authToken: '', username: '', password: '' }
        : { accessToken: 'management-access', authToken: 'management-auth' },
      timeoutMs: 2_000,
    },
    tenantId: '100001',
    organizationId: '0',
  };
}

function recordingRunner() {
  const calls = [];
  return {
    calls,
    async run({ script, args, env }) {
      calls.push({ script: path.basename(script), args, anchor: env?.[DEPLOY_APPLICATION_ID_ENV] ?? '' });
      return { code: 0 };
    },
  };
}

async function runRegistration({
  workspaceRoot,
  stack,
  environment = 'development',
  overrides = {},
  management = true,
}) {
  const runner = recordingRunner();
  const sleeps = [];
  const inventory = buildRegistrationInventory({ workspaceRoot });
  const report = await registerApplications(
    {
      workspaceRoot,
      environment,
      settings: settingsFor(stack, { management }),
      retryDelayMs: 0,
      regenerateTopologyEnv: false,
      materialize: true,
      ...overrides,
    },
    {
      inventory,
      runNodeScript: runner.run,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      jitter: () => 0,
    },
  );
  return { report, runner, sleeps };
}

function readEnv(filePath) {
  return readFileSync(filePath, 'utf8');
}

test('a missing application is created, anchored, and materialized', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    const { report, runner } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    assert.equal(report.counts.created, 1);
    const entry = report.entries[0];
    assert.equal(entry.status, 'created');
    assert.equal(entry.slug, 'sdkwork-demo');
    assert.match(entry.deployApplicationId, /^[0-9]+$/u);
    assert.equal(entry.anchorSource, 'deploy-response', 'the create response is the anchor source');
    assert.equal(
      entry.deployApplicationId,
      String(stack.apps.get('sdkwork-demo').deployApplicationId),
      'the anchor is the created deploy row\'s decimal id',
    );
    assert.equal(entry.deployApplicationUuid, 'uuid-1');
    assert.equal(entry.iam.status, 'enabled');
    assert.equal(entry.iam.deployApplicationId, entry.deployApplicationId);
    assert.equal(entry.iam.anchorVerified, true);

    const envFile = path.join(
      workspace.root,
      'sdkwork-demo/etc/topology/overrides/standalone.development.env',
    );
    const content = readEnv(envFile);
    assert.match(content, new RegExp(`^${DEPLOY_APPLICATION_ID_ENV}=${entry.deployApplicationId}$`, 'mu'));
    assert.match(content, /^SDKWORK_DEPLOY_APPLICATION_UUID=uuid-1$/mu);
    assert.match(content, /^SDKWORK_ENVIRONMENT=development$/mu, 'existing lines are preserved');
    assert.equal(entry.anchor.written.length, 1);

    assert.equal(runner.calls.length, 1);
    assert.equal(runner.calls[0].script, 'materialize-client-env.mjs');
    assert.equal(runner.calls[0].anchor, entry.deployApplicationId);
    assert.deepEqual(
      runner.calls[0].args,
      ['--root', path.join(workspace.root, 'sdkwork-demo'), '--environment', 'development'],
      'the materializer is scoped to the lifecycle being registered',
    );
    assert.equal(entry.materialize.status, 'materialized');
    assert.equal(stack.apps.size, 1);
    assert.equal(stack.installations.size, 1);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('an existing application and installation are reused without a second create', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack({
    apps: [{
      uuid: 'uuid-existing',
      deployApplicationId: '900777',
      slug: 'sdkwork-demo',
      name: 'SDKWork Demo',
    }],
    installations: [{
      tenantApplicationId: 'ta-existing',
      id: 'ta-existing',
      appId: 'app-runtime-900777',
      deployApplicationId: '900777',
      instanceKey: '900777_dev',
      applicationType: 'pc',
      status: 'enabled',
    }],
  });
  try {
    const { report } = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    assert.equal(report.counts.reused, 1);
    const entry = report.entries[0];
    assert.equal(entry.deployApplicationId, '900777');
    assert.equal(entry.anchorSource, 'deploy-response', 'the reused row supplies the anchor');
    assert.equal(entry.deployApplicationUuid, 'uuid-existing');
    assert.equal(entry.iam.tenantApplicationId, 'ta-existing');
    assert.equal(entry.iam.enabledNow, false);
    assert.equal(stack.requestsFor('POST', '/app/v3/api/apps').length, 0);
    assert.equal(
      stack.requestsFor('POST', '/backend/v3/api/iam/tenant_applications/ta-existing/enable').length,
      0,
      'an enabled installation is not re-enabled',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a repeated run creates nothing and reuses the same identity', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    const first = await runRegistration({ workspaceRoot: workspace.root, stack });
    const second = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(first.report.counts.created, 1);
    assert.equal(second.report.counts.reused, 1);
    assert.equal(stack.apps.size, 1, 'one deploy application across two runs');
    assert.equal(stack.installations.size, 1, 'one IAM installation across two runs');
    assert.equal(second.report.entries[0].deployApplicationId, first.report.entries[0].deployApplicationId);

    const creates = stack.requestsFor('POST', '/app/v3/api/apps');
    assert.equal(creates.length, 1);
    const provisions = stack.requestsFor('POST', '/backend/v3/api/iam/tenant_applications');
    assert.equal(provisions.length, 2, 'provision is the idempotent reconcile call');
    assert.equal(
      provisions[0].body.provisioningIdempotencyKey,
      provisions[1].body.provisioningIdempotencyKey,
      'the provisioning key is deterministic across runs',
    );
    assert.equal(creates[0].body.slug, 'sdkwork-demo');
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a transient IAM failure is recorded and a retry converges', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    stack.failNextOnce({
      method: 'POST',
      path: '/backend/v3/api/iam/tenant_applications',
      status: 503,
    });
    const failed = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { maxAttempts: 1 },
    });
    assert.equal(failed.report.counts.failed, 1);
    assert.equal(failed.report.entries[0].errorKind, 'rejected');
    assert.match(failed.report.entries[0].error, /HTTP 503/u);

    const retried = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(retried.report.counts.failed, 0, JSON.stringify(retried.report.entries[0]?.error));
    assert.equal(retried.report.entries[0].status, 'reused');
    assert.equal(stack.apps.size, 1, 'the retry adopted the app created by the first run');
    const creates = stack.requestsFor('POST', '/app/v3/api/apps');
    assert.equal(creates.length, 1);
    assert.equal(
      creates[0].headers['idempotency-key'],
      'sdkwork-app-register:development:sdkwork-demo',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a retryable failure inside one attempt is retried with the same idempotency key', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    stack.failNextOnce({ method: 'POST', path: '/app/v3/api/apps', status: 500 });
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { maxAttempts: 2 },
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    assert.equal(report.entries[0].status, 'created');
    const creates = stack.requestsFor('POST', '/app/v3/api/apps');
    assert.equal(creates.length, 2);
    assert.equal(
      creates[0].headers['idempotency-key'],
      creates[1].headers['idempotency-key'],
      'a retry must reuse the deterministic key',
    );
    assert.equal(stack.apps.size, 1);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a conflicting anchor between the environment and the deploy row fails closed', async () => {
  const workspace = createWorkspace({
    repositories: [{
      name: 'sdkwork-demo',
      manifest: manifest(),
      clientEnv: clientEnv(),
      envAnchor: { profile: 'standalone', environment: 'development', anchor: '111' },
    }],
  });
  const stack = await startFakeStack({
    apps: [{
      uuid: 'uuid-existing',
      deployApplicationId: '222',
      slug: 'sdkwork-demo',
      name: 'SDKWork Demo',
    }],
  });
  try {
    const { report } = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(report.counts.failed, 1);
    assert.match(report.entries[0].error, /conflicting deploy application anchors/u);
    assert.equal(
      stack.requestsFor('POST', '/backend/v3/api/iam/tenant_applications').length,
      0,
      'an ambiguous identity must not reach IAM',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('an IAM response that cannot prove the binding is refused', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack({
    hooks: [{
      method: 'POST',
      path: '/backend/v3/api/iam/tenant_applications',
      handle: ({ installations }) => {
        // The stand-in installation must be real enough that the environment
        // upsert that now runs before enable finds it; the point of this test is
        // the missing anchor echo, not the environment row.
        installations.set('900100', {
          tenantApplicationId: 'ta-x',
          id: 'ta-x',
          appId: 'app-runtime-x',
          status: 'draft',
          primaryDomain: '127.0.0.1',
          applicationType: 'pc',
          instanceKey: 'x_dev',
        });
        return {
          status: 201,
          body: {
            code: 0,
            data: {
              item: {
                tenantApplicationId: 'ta-x',
                id: 'ta-x',
                appId: 'app-runtime-x',
                status: 'enabled',
                applicationType: 'pc',
                instanceKey: 'x_dev',
              },
            },
            traceId: 't',
          },
        };
      },
    }],
  });
  try {
    const strict = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(strict.report.counts.failed, 1);
    assert.match(strict.report.entries[0].error, /did not echo deployApplicationId/u);

    const permissive = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { allowUnverifiedIamBinding: true },
    });
    assert.equal(
      permissive.report.counts.failed,
      0,
      JSON.stringify(permissive.report.entries[0]?.error),
    );
    assert.equal(permissive.report.entries[0].iam.anchorVerified, false);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a deploy response without deployApplicationId fails closed', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack({ exposeDecimalId: false });
  try {
    const decimal = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(decimal.report.counts.failed, 1);
    assert.match(decimal.report.entries[0].error, /no deployApplicationId/u);
    assert.equal(decimal.report.entries[0].deployApplicationId, '');
    assert.equal(stack.installations.size, 0, 'an unanchored row must never reach IAM');

    // The field is required on every app response, so the uuid anchor kind does
    // not bypass the check: a response that cannot name its decimal anchor fails.
    const uuidMode = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { anchorKind: 'deploy-application-uuid' },
    });
    assert.equal(uuidMode.report.counts.failed, 1);
    assert.match(uuidMode.report.entries[0].error, /no deployApplicationId/u);
    assert.equal(stack.installations.size, 0);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a deploy response whose deployApplicationId is not decimal fails closed', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack({
    hooks: [{
      method: 'GET',
      path: '/app/v3/api/apps',
      handle: () => ({
        status: 200,
        body: {
          code: 0,
          data: {
            items: [{
              id: 'uuid-1',
              deployApplicationId: 'uuid-1',
              slug: 'sdkwork-demo',
              name: 'SDKWork Demo',
              appStatus: 'DRAFT',
            }],
          },
          traceId: 't',
        },
      }),
    }],
  });
  try {
    const { report } = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(report.counts.failed, 1);
    assert.match(report.entries[0].error, /not the decimal/u);
    assert.equal(report.entries[0].deployApplicationId, '');
    assert.equal(stack.installations.size, 0);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('--anchor-kind=deploy-application-uuid still binds the uuid on purpose', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { anchorKind: 'deploy-application-uuid' },
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    const entry = report.entries[0];
    assert.equal(entry.anchorSource, 'deploy-uuid');
    assert.equal(entry.deployApplicationId, entry.deployApplicationUuid);
    assert.equal(entry.iam.deployApplicationId, entry.deployApplicationUuid);
    assert.equal(stack.installations.size, 1);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('the CLI maps unusable configuration onto exit code 2', async () => {
  const logged = [];
  const originalError = console.error;
  console.error = (line) => {
    logged.push(String(line));
  };
  try {
    assert.equal(await runMain(['--environment', 'qa']), 2, 'an unknown lifecycle is configuration');
    assert.equal(await runMain(['--environment', 'development', '--bogus']), 2, 'an unknown option is configuration');
  } finally {
    console.error = originalError;
  }
  assert.ok(logged.length > 0);
  assert.ok(logged.every((line) => line.includes('[register-applications]')));
});

test('dry-run plans every item and performs no request or write', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    const inventory = buildRegistrationInventory({ workspaceRoot: workspace.root });
    const before = readEnv(
      path.join(workspace.root, 'sdkwork-demo/etc/topology/overrides/standalone.development.env'),
    );
    const report = await registerApplications(
      { workspaceRoot: workspace.root, environment: 'development', dryRun: true },
      { inventory, sleep: async () => {} },
    );
    assert.equal(stack.requests.length, 0);
    assert.equal(report.counts.planned, 1);
    assert.equal(report.entries[0].status, 'planned');
    assert.equal(
      report.entries[0].plan.deployCreateIdempotencyKey,
      'sdkwork-app-register:development:sdkwork-demo',
    );
    assert.deepEqual(report.entries[0].plan.iam.accessPermissions, ['iam:self']);
    assert.equal(report.entries[0].plan.iam.instanceKey, '(deploy-application-id)_dev');
    assert.equal(
      readEnv(path.join(workspace.root, 'sdkwork-demo/etc/topology/overrides/standalone.development.env')),
      before,
      'dry-run must not touch the environment configuration',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a manifest without a permission scope fails instead of being skipped', async () => {
  const workspace = createWorkspace({
    repositories: [{
      name: 'sdkwork-demo',
      manifest: manifest({ backend: { accessTokenPermissionScope: [] } }),
      clientEnv: clientEnv(),
    }],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(report.counts.failed, 1);
    assert.match(report.entries[0].error, /accessTokenPermissionScope/u);
    assert.equal(stack.requests.length, 0);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a server-only root is skipped with its reason instead of failing on a scope it cannot have', async () => {
  const workspace = createWorkspace({
    repositories: [{
      name: 'sdkwork-notes',
      manifest: manifest({
        app: { key: 'sdkwork-notes', name: 'SDKWork Notes' },
        backend: { accessTokenPermissionScope: [] },
      }),
    }],
  });
  const stack = await startFakeStack();
  try {
    const inventory = buildRegistrationInventory({ workspaceRoot: workspace.root });
    assert.equal(inventory.entries[0].permissionScopeRequirement.kind, 'notApplicable');

    const dryRun = await registerApplications(
      { workspaceRoot: workspace.root, environment: 'development', dryRun: true },
      { inventory, sleep: async () => {} },
    );
    assert.equal(dryRun.counts.planned, 1);
    assert.equal(dryRun.counts.invalid, 0, 'a server-only root is not a scope defect');
    assert.equal(dryRun.counts.skipped, 1);
    const dryEntry = dryRun.entries[0];
    assert.equal(dryEntry.status, 'skipped');
    assert.equal(dryEntry.skipKind, 'serversOnly');
    assert.match(dryEntry.skipReason, /skipped as server-only/u);
    assert.match(dryEntry.skipReason, /--include-servers-only/u);
    assert.equal(dryEntry.serversOnly, true);
    assert.deepEqual(dryEntry.defects, []);

    const real = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(real.report.counts.skipped, 1);
    assert.equal(real.report.counts.failed, 0, 'nothing was attempted, so nothing failed');
    const entry = real.report.entries[0];
    assert.equal(entry.status, 'skipped');
    assert.equal(entry.skipKind, 'serversOnly');
    assert.equal(entry.materialize.status, 'skipped');
    assert.equal(entry.deployApplicationId, '');
    assert.equal(stack.requests.length, 0, 'a skipped root must not reach Deploy or IAM');
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('--include-servers-only registers a server-only root on purpose', async () => {
  const workspace = createWorkspace({
    repositories: [{
      name: 'sdkwork-notes',
      manifest: manifest({
        app: { key: 'sdkwork-notes', name: 'SDKWork Notes' },
        backend: { accessTokenPermissionScope: [] },
      }),
    }],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { includeServersOnly: true },
    });
    assert.equal(report.counts.skipped, 0);
    assert.equal(
      report.entries[0].status,
      'failed',
      'the explicit override restores the historical scope requirement',
    );
    assert.match(report.entries[0].error, /accessTokenPermissionScope is empty/u);
    assert.equal(stack.requests.length, 0);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a client face without a materialization fails on that configuration, not on a scope', async () => {
  const workspace = createWorkspace({
    repositories: [{
      name: 'sdkwork-doctor',
      manifest: manifest({
        app: { key: 'sdkwork-doctor', name: 'SDKWork Doctor' },
        backend: { accessTokenPermissionScope: [] },
      }),
      apps: ['apps/sdkwork-doctor-pc', 'apps/sdkwork-doctor-h5'],
    }],
  });
  const stack = await startFakeStack();
  try {
    const inventory = buildRegistrationInventory({ workspaceRoot: workspace.root });
    assert.equal(inventory.entries[0].permissionScopeRequirement.kind, 'missingClientEnvConfiguration');

    const dryRun = await registerApplications(
      { workspaceRoot: workspace.root, environment: 'development', dryRun: true },
      { inventory, sleep: async () => {} },
    );
    assert.equal(dryRun.counts.invalid, 1);
    assert.equal(dryRun.counts.skipped, 0, 'a client face is not a server-only skip');
    const dryEntry = dryRun.entries[0];
    assert.equal(dryEntry.status, 'invalid');
    assert.equal(dryEntry.permissionScopeRequirement, 'missingClientEnvConfiguration');
    assert.equal(dryEntry.defects.length, 1);
    assert.match(dryEntry.defects[0], /client-env\.materialization\.json/u);
    assert.match(dryEntry.defects[0], /missing client env configuration/u);
    assert.doesNotMatch(
      dryEntry.defects[0],
      /accessTokenPermissionScope is empty/u,
      'the scope error would point the operator at the wrong file',
    );

    const real = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(real.report.counts.failed, 1);
    assert.equal(real.report.entries[0].errorKind, 'plan');
    assert.match(real.report.entries[0].error, /client-env\.materialization\.json/u);
    assert.equal(stack.requests.length, 0);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a client face that declares a scope still registers', async () => {
  const workspace = createWorkspace({
    repositories: [{
      name: 'sdkwork-drama',
      manifest: manifest({ app: { key: 'sdkwork-drama', name: 'SDKWork Drama' } }),
      apps: ['apps/sdkwork-drama-h5'],
    }],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    assert.equal(report.counts.created, 1);
    const entry = report.entries[0];
    assert.equal(entry.permissionScopeRequirement, 'declared');
    assert.equal(
      entry.materialize.status,
      'not-applicable',
      'no materialization declaration means no client token is minted, which does not block the run',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});


test('the default scope registers one anchor per repository', async () => {
  const workspace = createWorkspace({
    repositories: [
      {
        name: 'sdkwork-demo',
        manifest: manifest(),
        clientEnv: clientEnv(),
      },
      {
        name: 'sdkwork-demo/apps/sdkwork-demo-h5',
        manifest: manifest({ app: { key: 'sdkwork-demo-h5', name: 'SDKWork Demo H5' } }),
      },
    ],
  });
  const stack = await startFakeStack();
  try {
    const primary = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(primary.report.scope, 'repository');
    assert.equal(primary.report.counts.planned, 1);
    assert.equal(primary.report.entries[0].appDir, '.', 'the repository manifest wins');
    assert.equal(primary.report.counts.failed, 0, JSON.stringify(primary.report.entries[0]?.error));
    assert.equal(primary.report.entries[0].materialize.status, 'materialized');
    assert.equal(primary.runner.calls.filter((call) => call.script === 'materialize-client-env.mjs').length, 1);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('scope=all registers every manifest root and reports the materializer conflict', async () => {
  const workspace = createWorkspace({
    repositories: [
      {
        name: 'sdkwork-demo',
        manifest: manifest(),
        clientEnv: clientEnv(),
      },
      {
        name: 'sdkwork-demo/apps/sdkwork-demo-h5',
        manifest: manifest({
          app: { key: 'sdkwork-demo-h5', name: 'SDKWork Demo H5' },
          // Each installation environment row owns a unique domain: IAM keeps
          // `(tenant_id, primary_domain)` unique across live rows, so two apps
          // cannot both claim the shared development ingress host.
          environments: { development: { accessUrl: 'https://h5.sdkwork-demo.test' } },
        }),
      },
    ],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { scope: 'all' },
    });
    assert.equal(report.counts.planned, 2);
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries.map((entry) => entry.error)));
    assert.equal(report.counts.created, 2, 'both manifest roots are registered');
    const anchors = new Set(report.entries.map((entry) => entry.deployApplicationId));
    assert.equal(anchors.size, 2, 'each manifest root owns its own deploy application');
    const conflicts = report.entries.filter((entry) => entry.materialize.status === 'conflict');
    assert.equal(
      conflicts.length,
      2,
      'one repository cannot bake two anchors in one materializer run; the conflict is reported',
    );
    assert.equal(report.counts.materializeConflict, 2);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('every authored env layer of the environment receives the anchor', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  // Development alternates between both deployment profiles, and the anchor
  // belongs to the application, so both authored layers are written.
  writeFileSync(
    path.join(workspace.root, 'sdkwork-demo/etc/topology/overrides/cloud.development.env'),
    'SDKWORK_ENVIRONMENT=development\n',
    'utf8',
  );
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { regenerateTopologyEnv: true },
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    const entry = report.entries[0];
    assert.deepEqual(
      entry.anchor.outcomes.map((outcome) => outcome.outcome),
      ['updated', 'updated'],
    );
    assert.equal(entry.anchor.written.length, 2);
    for (const file of [
      'sdkwork-demo/etc/topology/overrides/standalone.development.env',
      'sdkwork-demo/etc/topology/overrides/cloud.development.env',
    ]) {
      assert.match(
        readEnv(path.join(workspace.root, file)),
        new RegExp(`^${DEPLOY_APPLICATION_ID_ENV}=${entry.deployApplicationId}$`, 'mu'),
        file,
      );
    }
    const regenerated = report.entries[0].anchor.topologyRegenerated ?? [];
    assert.deepEqual(
      regenerated.map((run) => run.profileId).sort(),
      ['cloud.development', 'standalone.development'],
    );
    assert.ok(regenerated.every((run) => run.code === 0));
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('--deployment-profile narrows the hand-off to one authored layer', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  writeFileSync(
    path.join(workspace.root, 'sdkwork-demo/etc/topology/overrides/cloud.development.env'),
    'SDKWORK_ENVIRONMENT=development\n',
    'utf8',
  );
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { deploymentProfile: 'cloud' },
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    assert.equal(report.entries[0].anchor.written.length, 1);
    assert.match(report.entries[0].anchor.written[0], /cloud\.development\.env$/u);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('one installation serves every lifecycle; each lifecycle is an environment row', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    const development = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(development.report.counts.failed, 0, JSON.stringify(development.report.entries[0]?.error));
    const devEntry = development.report.entries[0];
    assert.equal(devEntry.status, 'created');
    assert.equal(devEntry.iam.status, 'enabled');
    assert.equal(devEntry.installationEnvironment.envKey, 'development');
    assert.equal(devEntry.installationEnvironment.status, 'active');
    assert.equal(devEntry.installationEnvironment.primaryDomain, '127.0.0.1');

    const production = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      environment: 'production',
    });
    assert.equal(production.report.counts.failed, 0, JSON.stringify(production.report.entries[0]?.error));
    const prodEntry = production.report.entries[0];
    assert.equal(prodEntry.status, 'reused', 'the production run adopts the development deploy app');
    assert.equal(prodEntry.deployApplicationUuid, devEntry.deployApplicationUuid);
    assert.equal(
      prodEntry.deployApplicationId,
      devEntry.deployApplicationId,
      'one deploy app means one anchor, not one anchor per lifecycle',
    );
    assert.equal(prodEntry.iam.tenantApplicationId, devEntry.iam.tenantApplicationId);
    assert.equal(prodEntry.iam.status, 'enabled');
    assert.equal(prodEntry.installationEnvironment.envKey, 'production');
    assert.equal(prodEntry.installationEnvironment.status, 'active');
    assert.equal(prodEntry.installationEnvironment.primaryDomain, 'demo.sdkwork.com');

    assert.equal(stack.apps.size, 1, 'one deploy application across lifecycles');
    assert.equal(stack.installations.size, 1, 'one installation across lifecycles');
    assert.equal(stack.environmentRows.size, 2, 'one environment row per registered lifecycle');
    assert.deepEqual(
      [...stack.environmentRows.values()].map((row) => `${row.environmentKey}:${row.status}`).sort(),
      ['development:active', 'production:active'],
    );
    assert.equal(stack.requestsFor('POST', '/app/v3/api/apps').length, 1);
    assert.equal(stack.environmentRequests().length, 2);

    const repeatedProduction = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      environment: 'production',
    });
    assert.equal(repeatedProduction.report.counts.reused, 1);
    assert.equal(stack.apps.size, 1);
    assert.equal(stack.installations.size, 1);
    assert.equal(stack.environmentRows.size, 2, 'a repeated run rewrites the row instead of adding one');
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('the environment row is written before the installation is enabled', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    const provisionIndex = stack.requests.findIndex(
      (entry) => entry.method === 'POST' && entry.path === '/backend/v3/api/iam/tenant_applications',
    );
    const environmentIndex = stack.requests.findIndex(
      (entry) => entry.method === 'PUT' && entry.path.includes('/environments/'),
    );
    const enableIndex = stack.requests.findIndex(
      (entry) => entry.method === 'POST' && entry.path.endsWith('/enable'),
    );
    assert.ok(provisionIndex >= 0 && environmentIndex >= 0 && enableIndex >= 0);
    assert.ok(
      provisionIndex < environmentIndex,
      'the installation id that addresses the row comes from the provision response',
    );
    assert.ok(
      environmentIndex < enableIndex,
      'enable must not publish an installation whose environment row does not exist yet',
    );
    const [environmentRequest] = stack.environmentRequests();
    assert.deepEqual(environmentRequest.body, {
      primaryDomain: '127.0.0.1',
      envStatus: 'active',
    });
    assert.match(
      environmentRequest.path,
      /^\/backend\/v3\/api\/iam\/tenants\/100001\/applications\/ta-1\/environments\/development$/u,
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a repository with no primary domain source fails at plan time and touches nothing', async () => {
  const workspace = createWorkspace({
    repositories: [{
      name: 'sdkwork-demo',
      manifest: manifest({ environments: { development: { accessUrl: '' }, production: { accessUrl: '' } } }),
      clientEnv: clientEnv(),
    }],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(report.counts.failed, 1);
    assert.equal(report.counts.planned, 1);
    const entry = report.entries[0];
    assert.equal(entry.errorKind, 'plan');
    assert.match(entry.error, /no primaryDomain source for development/u);
    assert.match(entry.error, /--primary-domain/u);
    assert.match(entry.error, /backend\.primaryDomain/u);
    assert.equal(stack.requests.length, 0, 'a plan defect must not reach Deploy or IAM');
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('--primary-domain expands {env} and {slug} and wins over the manifest', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { primaryDomainPattern: 'app-{slug}.{env}.sdkwork.test' },
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    const entry = report.entries[0];
    assert.equal(entry.primaryDomain, 'app-sdkwork-demo.development.sdkwork.test');
    assert.equal(entry.primaryDomainSource, '--primary-domain');
    const [provision] = stack.requestsFor('POST', '/backend/v3/api/iam/tenant_applications');
    assert.equal(provision.body.primaryDomain, 'app-sdkwork-demo.development.sdkwork.test');
    assert.equal(
      stack.environmentRequests()[0].body.primaryDomain,
      'app-sdkwork-demo.development.sdkwork.test',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('--primary-domain rejects an unknown placeholder instead of sending it', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { primaryDomainPattern: 'app-{tenant}.sdkwork.test' },
    });
    assert.equal(report.counts.failed, 1);
    assert.match(report.entries[0].error, /unsupported placeholder \{tenant\}/u);
    assert.equal(stack.requests.length, 0);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('surfaces that resolve to one installation write one environment row', async () => {
  const workspace = createWorkspace({
    repositories: [
      { name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() },
      {
        name: 'sdkwork-demo/apps/sdkwork-demo-h5',
        // The same app.key keeps both manifest roots on one deploy slug, which is
        // the multi-surface case: one installation, one environment row.
        manifest: manifest({ app: { key: 'sdkwork-demo', name: 'SDKWork Demo H5' } }),
      },
    ],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { scope: 'all' },
    });
    assert.equal(report.counts.planned, 2);
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries.map((entry) => entry.error)));
    assert.equal(stack.apps.size, 1, 'both surfaces share one deploy application');
    assert.equal(stack.installations.size, 1, 'both surfaces share one installation');
    assert.equal(stack.environmentRows.size, 1, 'the environment row is created once');
    assert.equal(stack.environmentRequests().length, 1, 'no second PUT for the same row');
    assert.equal(
      report.counts.environmentsDeduplicated,
      1,
      'the second surface records the shared row instead of re-upserting it',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('a 429 on a command waits at least Retry-After before the retry', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    stack.failNextOnce({
      method: 'POST',
      path: '/backend/v3/api/iam/tenant_applications',
      status: 429,
      headers: { 'retry-after': '2' },
      body: { status: 429, code: 42901, detail: 'too many requests' },
    });
    const { report, sleeps } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { maxAttempts: 5, retryDelayMs: 100 },
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    assert.ok(sleeps.length >= 1, 'the throttled call must wait before retrying');
    assert.ok(
      sleeps[0] >= 2_000,
      `the wait must honour Retry-After (2000ms), got ${sleeps[0]}ms`,
    );
    assert.equal(stack.requestsFor('POST', '/backend/v3/api/iam/tenant_applications').length, 2);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('without a dual-token session the item fails before enable leaves the installation unusable', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      management: false,
    });
    assert.equal(report.counts.failed, 1);
    assert.match(report.entries[0].error, /dual-token operator session/u);
    assert.equal(stack.environmentRequests().length, 0);
    assert.equal(
      stack.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/enable')).length,
      0,
      'an installation whose environment row cannot be written must not be enabled',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('two applications claiming one domain fail at plan time instead of racing a 409', async () => {
  const workspace = createWorkspace({
    repositories: [
      {
        name: 'sdkwork-demo',
        manifest: manifest({
          backend: { domain: 'shared.sdkwork.test' },
          environments: { development: {}, production: {} },
        }),
        clientEnv: clientEnv(),
      },
      {
        name: 'sdkwork-demo-two',
        manifest: manifest({
          app: { key: 'sdkwork-demo-two', name: 'SDKWork Demo Two' },
          backend: { domain: 'shared.sdkwork.test' },
          environments: { development: {}, production: {} },
        }),
      },
    ],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({ workspaceRoot: workspace.root, stack });
    assert.equal(report.counts.planned, 2);
    assert.equal(report.counts.failed, 2);
    for (const entry of report.entries) {
      assert.equal(entry.errorKind, 'plan');
      assert.match(entry.error, /primaryDomain shared\.sdkwork\.test/u);
      assert.match(entry.error, /also claimed by/u);
    }
    assert.equal(stack.requests.length, 0);
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});

test('--no-register-environments is the explicit downgrade path', async () => {
  const workspace = createWorkspace({
    repositories: [{ name: 'sdkwork-demo', manifest: manifest(), clientEnv: clientEnv() }],
  });
  const stack = await startFakeStack();
  try {
    const { report } = await runRegistration({
      workspaceRoot: workspace.root,
      stack,
      overrides: { registerEnvironments: false },
    });
    assert.equal(report.counts.failed, 0, JSON.stringify(report.entries[0]?.error));
    assert.equal(report.entries[0].installationEnvironment.status, 'skipped');
    assert.equal(report.counts.environmentsSkipped, 1);
    assert.equal(stack.environmentRequests().length, 0);
    assert.equal(
      stack.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/enable')).length,
      1,
      'the downgrade path still enables the installation',
    );
  } finally {
    await stack.close();
    workspace.cleanup();
  }
});
