#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import { DeployApiError, createDeployApplicationClient, findAppBySlug } from '../deploy-client.mjs';
import { IamApiError, createIamApplicationClient, resolveIamOrigin } from '../iam-client.mjs';
import { startFakeStack } from './fake-stack.mjs';

function deployClient(baseUrl, overrides = {}) {
  return createDeployApplicationClient({
    baseUrl,
    accessToken: 'access-token',
    authToken: 'auth-token',
    timeoutMs: 2_000,
    ...overrides,
  });
}

function iamClient(baseUrl, overrides = {}) {
  return createIamApplicationClient({
    baseUrl,
    auth: { authToken: 'operator-token' },
    timeoutMs: 2_000,
    ...overrides,
  });
}

test('deploy list finds the exact slug and ignores mere LIKE hits', async () => {
  const stack = await startFakeStack({
    apps: [
      { uuid: 'uuid-a', deployApplicationId: '1001', slug: 'sdkwork-im-pc', name: 'IM PC' },
      { uuid: 'uuid-b', deployApplicationId: '1002', slug: 'sdkwork-im-pc-extra', name: 'IM PC Extra' },
    ],
  });
  try {
    const client = deployClient(stack.baseUrl);
    const exact = await findAppBySlug(client, 'sdkwork-im-pc');
    assert.equal(exact.id, 'uuid-a');
    assert.equal(exact.deployApplicationId, '1001', 'the list row carries its decimal anchor');
    assert.equal(exact.slug, 'sdkwork-im-pc');
    const missing = await findAppBySlug(client, 'sdkwork-im-pcx');
    assert.equal(missing, null);
    const calls = stack.requestsFor('GET', '/app/v3/api/apps');
    assert.equal(calls.length, 2);
    assert.match(calls[0].search, /keyword=sdkwork-im-pc/u);
    assert.equal(calls[0].headers['access-token'], 'access-token');
    assert.match(String(calls[0].headers.authorization), /^Bearer auth-token$/u);
  } finally {
    await stack.close();
  }
});

test('deploy create sends the deterministic Idempotency-Key and replays on retry', async () => {
  const stack = await startFakeStack();
  try {
    const client = deployClient(stack.baseUrl);
    const body = { name: 'SDKWork IM PC', slug: 'sdkwork-im-pc', appKind: 'SPA_WEB' };
    const first = await client.createApp(body, { idempotencyKey: 'sdkwork-app-register:development:sdkwork-im-pc' });
    const second = await client.createApp(body, { idempotencyKey: 'sdkwork-app-register:development:sdkwork-im-pc' });
    assert.equal(first.id, second.id, 'a repeated key must replay the recorded row');
    assert.match(first.id, /^uuid-/u, 'id remains the addressable uuid');
    assert.match(first.deployApplicationId, /^[0-9]+$/u, 'create returns the decimal anchor');
    assert.equal(first.deployApplicationId, second.deployApplicationId);
    const posts = stack.requestsFor('POST', '/app/v3/api/apps');
    assert.equal(posts.length, 2);
    assert.deepEqual(
      posts.map((entry) => entry.headers['idempotency-key']),
      [
        'sdkwork-app-register:development:sdkwork-im-pc',
        'sdkwork-app-register:development:sdkwork-im-pc',
      ],
    );
    assert.equal(stack.apps.size, 1, 'one row for two calls');
  } finally {
    await stack.close();
  }
});

test('deploy create refuses to run without an idempotency key', async () => {
  const stack = await startFakeStack();
  try {
    const client = deployClient(stack.baseUrl);
    await assert.rejects(
      () => client.createApp({ name: 'x', slug: 'x', appKind: 'SPA_WEB' }),
      (error) => error instanceof DeployApiError && /Idempotency-Key/u.test(error.message),
    );
    assert.equal(stack.requestsFor('POST', '/app/v3/api/apps').length, 0);
  } finally {
    await stack.close();
  }
});

test('deploy retrieve answers null for a 404 and an item for a hit', async () => {
  const stack = await startFakeStack({
    apps: [{ uuid: 'uuid-a', deployApplicationId: '1001', slug: 'a', name: 'A' }],
  });
  try {
    const client = deployClient(stack.baseUrl);
    const hit = await client.retrieveApp('uuid-a');
    assert.equal(hit.slug, 'a');
    assert.equal(hit.deployApplicationId, '1001');
    const miss = await client.retrieveApp('uuid-missing');
    assert.equal(miss, null);
  } finally {
    await stack.close();
  }
});

test('deploy errors classify retryable and non-retryable failures', async () => {
  const stack = await startFakeStack();
  try {
    const client = deployClient(stack.baseUrl);
    stack.failNextOnce({ method: 'GET', path: '/app/v3/api/apps', status: 403 });
    await assert.rejects(
      () => client.listApps({ keyword: 'x' }),
      (error) => error instanceof DeployApiError
        && error.status === 403
        && error.retryable === false
        && /HTTP 403/u.test(error.message),
    );
    stack.failNextOnce({ method: 'GET', path: '/app/v3/api/apps', status: 503 });
    await assert.rejects(
      () => client.listApps({ keyword: 'x' }),
      (error) => error instanceof DeployApiError && error.status === 503 && error.retryable === true,
    );
  } finally {
    await stack.close();
  }
});

test('deploy refuses to guess between two rows carrying the same slug', async () => {
  const stack = await startFakeStack({
    hooks: [{
      method: 'GET',
      path: '/app/v3/api/apps',
      handle: () => ({
        status: 200,
        body: {
          code: 0,
          data: {
            items: [
              { id: 'u1', deployApplicationId: '7001', slug: 'dup', name: 'Dup', appStatus: 'DRAFT' },
              { id: 'u2', deployApplicationId: '7002', slug: 'dup', name: 'Dup 2', appStatus: 'DRAFT' },
            ],
          },
          traceId: 't',
        },
      }),
    }],
  });
  try {
    const client = deployClient(stack.baseUrl);
    await assert.rejects(
      () => findAppBySlug(client, 'dup'),
      (error) => error instanceof DeployApiError && error.kind === 'conflict',
    );
  } finally {
    await stack.close();
  }
});

test('deploy refuses a list row without the decimal deployApplicationId', async () => {
  const stack = await startFakeStack({
    hooks: [{
      method: 'GET',
      path: '/app/v3/api/apps',
      handle: () => ({
        status: 200,
        body: {
          code: 0,
          data: {
            items: [{ id: 'uuid-no-anchor', slug: 'no-anchor', name: 'No Anchor', appStatus: 'DRAFT' }],
          },
          traceId: 't',
        },
      }),
    }],
  });
  try {
    const client = deployClient(stack.baseUrl);
    await assert.rejects(
      () => client.listApps({ keyword: 'no-anchor' }),
      (error) => error instanceof DeployApiError
        && error.kind === 'unreadable'
        && /no deployApplicationId/u.test(error.message),
    );
  } finally {
    await stack.close();
  }
});

test('deploy refuses a create response whose deployApplicationId is not decimal', async () => {
  const stack = await startFakeStack({
    hooks: [{
      method: 'POST',
      path: '/app/v3/api/apps',
      handle: () => ({
        status: 201,
        body: {
          code: 0,
          data: {
            item: {
              id: 'uuid-not-decimal',
              deployApplicationId: 'uuid-not-decimal',
              slug: 'not-decimal',
              name: 'Not Decimal',
              appStatus: 'DRAFT',
            },
          },
          traceId: 't',
        },
      }),
    }],
  });
  try {
    const client = deployClient(stack.baseUrl);
    await assert.rejects(
      () => client.createApp(
        { name: 'Not Decimal', slug: 'not-decimal', appKind: 'SPA_WEB' },
        { idempotencyKey: 'sdkwork-app-register:development:not-decimal' },
      ),
      (error) => error instanceof DeployApiError
        && error.kind === 'unreadable'
        && /not the decimal/u.test(error.message),
    );
  } finally {
    await stack.close();
  }
});

test('deploy rejects a non-envelope body instead of treating it as an item', async () => {
  const stack = await startFakeStack({
    hooks: [{
      method: 'GET',
      path: '/app/v3/api/apps/uuid-x',
      handle: () => ({ status: 200, body: { slug: 'x' } }),
    }],
  });
  try {
    const client = deployClient(stack.baseUrl);
    await assert.rejects(
      () => client.retrieveApp('uuid-x'),
      (error) => error instanceof DeployApiError && error.kind === 'unreadable',
    );
  } finally {
    await stack.close();
  }
});

test('IAN origin strips the backend prefix so paths join once', () => {
  assert.equal(resolveIamOrigin('http://127.0.0.1:3901/'), 'http://127.0.0.1:3901');
  assert.equal(
    resolveIamOrigin('http://127.0.0.1:3901/backend/v3/api'),
    'http://127.0.0.1:3901',
  );
  assert.throws(() => resolveIamOrigin('127.0.0.1:3901'), IamApiError);
});

test('IAM provision and enable drive the bootstrap-body routes', async () => {
  const stack = await startFakeStack();
  try {
    const client = iamClient(stack.baseUrl);
    const provisioned = await client.provisionTenantApplication({
      deployApplicationId: '1001',
      provisioningIdempotencyKey: 'iam-bootstrap-key',
      applicationType: 'pc',
      tenantId: '100001',
      organizationId: '0',
      instanceKey: '1001_dev',
      displayName: 'IM PC',
      environment: 'development',
      accessPermissions: ['iam:self'],
    });
    assert.equal(provisioned.deployApplicationId, '1001');
    assert.equal(provisioned.status, 'draft');
    const posts = stack.requestsFor('POST', '/backend/v3/api/iam/tenant_applications');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.authToken, 'operator-token');
    assert.equal(posts[0].body.deployApplicationId, '1001');

    const enabled = await client.enableTenantApplication(provisioned.tenantApplicationId, {
      tenantId: '100001',
    });
    assert.equal(enabled.status, 'enabled');
    const enables = stack.requestsFor(
      'POST',
      `/backend/v3/api/iam/tenant_applications/${provisioned.tenantApplicationId}/enable`,
    );
    assert.equal(enables.length, 1);
  } finally {
    await stack.close();
  }
});

test('IAM client refuses a body-only client without bootstrap credentials', () => {
  assert.throws(
    () => createIamApplicationClient({ baseUrl: 'http://127.0.0.1:1', auth: {} }),
    /SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN/u,
  );
});

test('IAM failures keep the status and the problem detail', async () => {
  const stack = await startFakeStack();
  try {
    const client = iamClient(stack.baseUrl);
    stack.failNextOnce({
      method: 'POST',
      path: '/backend/v3/api/iam/tenant_applications',
      status: 409,
      body: { status: 409, code: 40903, detail: 'anchor already claimed by another installation' },
    });
    await assert.rejects(
      () => client.provisionTenantApplication({ deployApplicationId: '1001' }),
      (error) => error instanceof IamApiError
        && error.status === 409
        && /anchor already claimed/u.test(error.message),
    );
  } finally {
    await stack.close();
  }
});
