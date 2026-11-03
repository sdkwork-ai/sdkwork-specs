import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertApplicationAccessToken,
  createApplicationAccessToken,
  decodeApplicationAccessToken,
} from './app-access-token.mjs';

const identity = {
  appId: 'sdkwork-im-pc',
  tenantId: '100001',
  organizationId: '0',
  environment: 'production',
  deploymentProfile: 'cloud',
  runtimeTarget: 'browser',
};

test('generates a deterministic three-part public application token', () => {
  const first = createApplicationAccessToken(identity);
  const second = createApplicationAccessToken(identity);
  assert.equal(first, second);
  assert.equal(first.split('.').length, 3);
  assert.match(first, /\.public$/u);
  const { header, payload } = decodeApplicationAccessToken(first);
  assert.deepEqual(header, { alg: 'none', kid: 'public-app-token', typ: 'JWT' });
  assert.equal(payload.token_class, 'application');
  assert.equal(payload.token_type, 'access');
  assert.equal(payload.iss, 'sdkwork-iam-public');
  assert.equal(payload.app_id, identity.appId);
  assert.equal(payload.environment, 'production');
  assert.equal(payload.deployment_profile, 'cloud');
  assert.equal(payload.runtime_target, 'browser');
});

test('rejects a token whose app_id does not match the expected identity', () => {
  const token = createApplicationAccessToken(identity);
  assert.throws(
    () => assertApplicationAccessToken(token, { ...identity, appId: 'another-app' }),
    /app_id/u,
  );
});

test('distinguishes tenant-level and organization-level tokens', () => {
  const tenant = createApplicationAccessToken({ ...identity, organizationId: '0' });
  const organization = createApplicationAccessToken({ ...identity, organizationId: '42' });
  assert.equal(decodeApplicationAccessToken(tenant).payload.login_scope, 'TENANT');
  assert.equal(decodeApplicationAccessToken(organization).payload.login_scope, 'ORGANIZATION');
  assert.equal(decodeApplicationAccessToken(organization).payload.organization_id, '42');
  assert.throws(
    () => createApplicationAccessToken({ ...identity, organizationId: '42', accessScope: 'tenant' }),
    /tenant-level/u,
  );
  assert.throws(
    () => createApplicationAccessToken({ ...identity, organizationId: '0', accessScope: 'organization' }),
    /organization-level/u,
  );
  assert.throws(
    () => assertApplicationAccessToken(tenant, { ...identity, loginScope: 'ORGANIZATION' }),
    /login_scope/u,
  );
});
