#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import { createIamApplicationClient } from '../iam-client.mjs';

function jsonResponse(status, document) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return document;
    },
    async text() {
      return JSON.stringify(document);
    },
  };
}

function routes(handler) {
  return async (url, init) => handler(String(url), init);
}

test('auto transport retries the legacy installation route after a canonical 404', async () => {
  const calls = [];
  const fetchImpl = routes((url) => {
    calls.push(url);
    if (url.endsWith('/backend/v3/api/iam/installations')) {
      return jsonResponse(404, { code: '40401', message: 'route is not registered' });
    }
    if (url.includes('/applications?page=1')) {
      return jsonResponse(200, {
        data: { items: [{ tenantApplicationId: 'tapp_1', deployApplicationId: '1', status: 'pending_config' }] },
      });
    }
    return jsonResponse(200, { data: { item: { installationId: 'tapp_1', status: 'pending_config' } } });
  });
  const client = createIamApplicationClient({
    baseUrl: 'https://api.example.com',
    auth: { authToken: 'operator' },
    management: { accessToken: 'session-access', authToken: 'session-auth' },
    transport: 'auto',
    fetchImpl,
  });
  const item = await client.provisionInstallation({ tenantId: '100001', deployApplicationId: '1' });
  assert.equal(item.installationId, 'tapp_1');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/backend\/v3\/api\/iam\/tenants\/100001\/applications(\?|$)/u);
});

test('auto transport retries the legacy enable and environment routes', async () => {
  const calls = [];
  const fetchImpl = routes((url) => {
    calls.push(url);
    if (url.includes('/installations/')) {
      return jsonResponse(404, { code: '40401' });
    }
    return jsonResponse(200, { data: { item: { installationId: 'tapp_1', envKey: 'production' } } });
  });
  const client = createIamApplicationClient({
    baseUrl: 'https://api.example.com',
    auth: { authToken: 'operator' },
    management: { accessToken: 'session-access', authToken: 'session-auth' },
    transport: 'auto',
    fetchImpl,
  });
  const enabled = await client.enableInstallation('tapp_1', { tenantId: '100001' });
  assert.equal(enabled.installationId, 'tapp_1');
  const environment = await client.upsertInstallationEnvironment({
    tenantId: '100001',
    installationId: 'tapp_1',
    envKey: 'production',
    primaryDomain: 'app.example.com',
  });
  assert.equal(environment.envKey, 'production');
  assert.equal(calls.some((url) => url.endsWith('/tenants/100001/applications/tapp_1/enable')), true);
  assert.equal(
    calls.some((url) => url.endsWith('/tenants/100001/applications/tapp_1/environments/production')),
    true,
  );
});

test('legacy transport skips the canonical route entirely', async () => {
  const calls = [];
  const fetchImpl = routes((url) => {
    calls.push(url);
    return jsonResponse(200, { data: { item: { installationId: 'tapp_2' } } });
  });
  const client = createIamApplicationClient({
    baseUrl: 'https://api.example.com',
    auth: { authToken: 'operator' },
    management: { accessToken: 'session-access', authToken: 'session-auth' },
    transport: 'legacy',
    fetchImpl,
  });
  await client.enableInstallation('tapp_2', { tenantId: '100001' });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/tenants\/100001\/applications\/tapp_2\/enable$/u);
});
