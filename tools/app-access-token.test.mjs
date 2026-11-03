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
