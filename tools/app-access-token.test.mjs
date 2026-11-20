import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_OWNERSHIP_SCOPE_ENV,
  APPLICATION_OWNER_USER_ID_ENV,
  PUBLIC_APP_ACCESS_TOKEN_NO_EXPIRY,
  assertApplicationAccessToken,
  createApplicationAccessToken,
  decodeApplicationAccessToken,
  isApplicationAccessTokenExpiryPermanent,
  resolveApplicationAccessTokenScope,
  resolveApplicationOwnershipScope,
} from './app-access-token.mjs';

const identity = {
  appId: 'sdkwork-im-pc',
  tenantId: '100001',
  organizationId: '0',
  environment: 'production',
  deploymentProfile: 'cloud',
  runtimeTarget: 'browser',
};

function tokenWith(payloadPatch) {
  const token = createApplicationAccessToken(identity);
  const [header, payload, signature] = token.split('.');
  const claims = { ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), ...payloadPatch };
  const encoded = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${header}.${encoded}.${signature}`;
}

function tokenWithoutOwnershipScope() {
  const token = createApplicationAccessToken(identity);
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  delete claims.ownership_scope;
  const encoded = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${header}.${encoded}.${signature}`;
}

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
  const organization = createApplicationAccessToken({
    ...identity,
    organizationId: '42',
    ownershipScope: 'ORGANIZATION',
  });
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

test('stamps the release scope on the token in all three states', () => {
  const tenant = decodeApplicationAccessToken(createApplicationAccessToken(identity)).payload;
  assert.equal(tenant.ownership_scope, 'TENANT');
  assert.equal(tenant.organization_id, '0');
  assert.equal(tenant.login_scope, 'TENANT');
  assert.equal(tenant.user_id, '0');

  const organization = decodeApplicationAccessToken(createApplicationAccessToken({
    ...identity,
    organizationId: '42',
    ownershipScope: 'ORGANIZATION',
  })).payload;
  assert.equal(organization.ownership_scope, 'ORGANIZATION');
  assert.equal(organization.organization_id, '42');
  assert.equal(organization.user_id, '0');

  const user = decodeApplicationAccessToken(createApplicationAccessToken({
    ...identity,
    ownershipScope: 'USER',
    userId: 'user-42',
  })).payload;
  assert.equal(user.ownership_scope, 'USER');
  assert.equal(user.organization_id, '0');
  assert.equal(user.login_scope, 'TENANT');
  assert.equal(user.user_id, 'user-42');
});

test('refuses a release scope that contradicts the organization claim', () => {
  assert.throws(
    () => createApplicationAccessToken({ ...identity, ownershipScope: 'ORGANIZATION' }),
    /ownership_scope=ORGANIZATION requires a non-zero organization_id/u,
  );
  assert.throws(
    () => createApplicationAccessToken({ ...identity, organizationId: '42', ownershipScope: 'TENANT' }),
    /ownership_scope=TENANT is a tenant-level release/u,
  );
  assert.throws(
    () => createApplicationAccessToken({
      ...identity,
      organizationId: '42',
      ownershipScope: 'USER',
      userId: 'user-42',
    }),
    /ownership_scope=USER is a tenant-level release/u,
  );
});

test('a USER release requires its owner user id and names the missing source', () => {
  assert.throws(
    () => createApplicationAccessToken({ ...identity, ownershipScope: 'USER' }),
    /user_id claim.*accessToken\.ownerUserId.*SDKWORK_APPLICATION_OWNER_USER_ID/u,
  );
  assert.throws(
    () => createApplicationAccessToken({ ...identity, ownershipScope: 'USER', userId: '0' }),
    /user_id claim.*accessToken\.ownerUserId.*SDKWORK_APPLICATION_OWNER_USER_ID/u,
  );
});

test('an unknown release scope fails closed instead of defaulting', () => {
  assert.throws(
    () => createApplicationAccessToken({ ...identity, ownershipScope: 'GLOBAL' }),
    /GLOBAL is not a release scope; expected one of TENANT, ORGANIZATION, USER/u,
  );
  assert.throws(
    () => decodeApplicationAccessToken(tokenWith({ ownership_scope: 'GLOBAL' })),
    /ownership_scope=GLOBAL is not a release scope/u,
  );
});

test('a USER token without its user_id claim is rejected on decode', () => {
  const token = createApplicationAccessToken({
    ...identity,
    ownershipScope: 'USER',
    userId: 'user-42',
  });
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  delete claims.user_id;
  const encoded = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  assert.throws(
    () => decodeApplicationAccessToken(`${header}.${encoded}.${signature}`),
    /ownership_scope=USER must carry the installation owner in its user_id claim/u,
  );
});

test('assertApplicationAccessToken compares the declared release scope', () => {
  const tenant = createApplicationAccessToken(identity);
  const user = createApplicationAccessToken({
    ...identity,
    ownershipScope: 'USER',
    userId: 'user-42',
  });
  assert.throws(
    () => assertApplicationAccessToken(user, { ...identity, ownershipScope: 'TENANT' }),
    /claim ownership_scope=USER does not match TENANT/u,
  );
  assert.throws(
    () => assertApplicationAccessToken(tenant, { ...identity, ownershipScope: 'USER' }),
    /claim ownership_scope=TENANT does not match USER/u,
  );
  assert.equal(
    assertApplicationAccessToken(user, { ...identity, ownershipScope: 'USER', ownerUserId: 'user-42' })
      .user_id,
    'user-42',
  );
  assert.throws(
    () => assertApplicationAccessToken(user, { ...identity, ownerUserId: 'user-7' }),
    /claim user_id=user-42 does not match user-7/u,
  );
});

test('an absent claim is only valid for a TENANT surface', () => {
  const legacy = tokenWithoutOwnershipScope();
  // Legacy tenant token: the derivation is TENANT, so a TENANT surface passes.
  assert.equal(
    assertApplicationAccessToken(legacy, { ...identity, ownershipScope: 'TENANT' }).ownership_scope,
    undefined,
  );
  assert.throws(
    () => assertApplicationAccessToken(legacy, { ...identity, ownershipScope: 'ORGANIZATION' }),
    /missing claim ownership_scope=ORGANIZATION/u,
  );
  assert.throws(
    () => assertApplicationAccessToken(legacy, { ...identity, ownershipScope: 'USER' }),
    /missing claim ownership_scope=USER/u,
  );
});

test('release scope resolution prefers the environment, then the declaration, then the organization binding', () => {
  assert.deepEqual(
    resolveApplicationOwnershipScope({ ownershipScope: 'organization', organizationId: '42' }, {}),
    { ownershipScope: 'ORGANIZATION', source: 'declaration' },
  );
  // A deployment-provided value outranks the declaration, and it still has to
  // agree with the organization binding.
  assert.deepEqual(resolveApplicationOwnershipScope({ ownershipScope: 'TENANT' }, {
    [APPLICATION_OWNERSHIP_SCOPE_ENV]: 'USER',
  }), {
    ownershipScope: 'USER',
    source: 'environment',
  });
  assert.deepEqual(resolveApplicationOwnershipScope({}, {}), {
    ownershipScope: 'TENANT',
    source: 'default',
  });
  // The organization binding is the same fact as the level: declaring only the
  // organization id is enough for an organization-level surface.
  assert.deepEqual(resolveApplicationOwnershipScope({ organizationId: '42' }, {}), {
    ownershipScope: 'ORGANIZATION',
    source: 'organization-binding',
  });
  assert.deepEqual(resolveApplicationOwnershipScope({ organizationId: '0' }, {}), {
    ownershipScope: 'TENANT',
    source: 'default',
  });
  assert.throws(
    () => resolveApplicationOwnershipScope({ ownershipScope: 'GLOBAL' }, {}),
    /accessToken\.ownershipScope=GLOBAL is not a release scope/u,
  );
});

test('a release scope that contradicts the organization binding fails closed', () => {
  assert.throws(
    () => resolveApplicationOwnershipScope({ ownershipScope: 'ORGANIZATION' }, {}),
    /ownership_scope=ORGANIZATION \(from declaration\) requires a non-zero organizationId/u,
  );
  assert.throws(
    () => resolveApplicationOwnershipScope({ organizationId: '42' }, {
      [APPLICATION_OWNERSHIP_SCOPE_ENV]: 'TENANT',
    }),
    /ownership_scope=TENANT \(from environment\) is tenant-level, so organizationId must be 0/u,
  );
  assert.throws(
    () => resolveApplicationOwnershipScope({}, {
      [APPLICATION_OWNERSHIP_SCOPE_ENV]: 'ORGANIZATION',
    }),
    /ownership_scope=ORGANIZATION \(from environment\) requires a non-zero organizationId/u,
  );
});

test('the declared access scope guard must agree with the organization binding', () => {
  assert.deepEqual(
    resolveApplicationOwnershipScope({ scope: 'tenant', organizationId: '0' }, {}),
    { ownershipScope: 'TENANT', source: 'default' },
  );
  assert.deepEqual(
    resolveApplicationOwnershipScope({ scope: 'organization', organizationId: '42' }, {}),
    { ownershipScope: 'ORGANIZATION', source: 'organization-binding' },
  );
  assert.throws(
    () => resolveApplicationOwnershipScope({ scope: 'organization', organizationId: '0' }, {}),
    /accessToken\.scope=organization conflicts with organizationId=0/u,
  );
  assert.throws(
    () => resolveApplicationOwnershipScope({ scope: 'tenant', organizationId: '42' }, {}),
    /accessToken\.scope=tenant conflicts with organizationId=42/u,
  );
  assert.throws(
    () => resolveApplicationOwnershipScope({ scope: 'platform' }, {}),
    /accessToken\.scope=platform must be tenant or organization/u,
  );
});

test('the USER scope takes its owner user id from the environment or the declaration', () => {
  assert.deepEqual(resolveApplicationAccessTokenScope({ ownershipScope: 'USER', ownerUserId: 'user-1' }, {}), {
    ownershipScope: 'USER',
    source: 'declaration',
    userId: 'user-1',
    userIdSource: 'declaration',
  });
  assert.deepEqual(resolveApplicationAccessTokenScope(
    { ownershipScope: 'USER', ownerUserId: 'user-1' },
    { [APPLICATION_OWNER_USER_ID_ENV]: 'user-2' },
  ), {
    ownershipScope: 'USER',
    source: 'declaration',
    userId: 'user-2',
    userIdSource: 'environment',
  });
  assert.deepEqual(resolveApplicationAccessTokenScope({ ownershipScope: 'TENANT' }, {
    [APPLICATION_OWNER_USER_ID_ENV]: 'user-2',
  }), {
    ownershipScope: 'TENANT',
    source: 'declaration',
    userId: '0',
    userIdSource: 'not-applicable',
  }, 'a non-USER release is never affected by the owner variable');
  assert.throws(
    () => resolveApplicationAccessTokenScope({ ownershipScope: 'USER' }, {}),
    /ownership_scope=USER requires the owner user id/u,
  );
  assert.throws(
    () => resolveApplicationAccessTokenScope(
      { ownershipScope: 'USER', ownerUserId: 'user-1' },
      { [APPLICATION_OWNER_USER_ID_ENV]: '0' },
    ),
    /SDKWORK_APPLICATION_OWNER_USER_ID must not be the tenant sentinel 0/u,
  );
});

test('a committed token is permanent by default', () => {
  const { payload } = decodeApplicationAccessToken(createApplicationAccessToken(identity));
  assert.equal(payload.exp, PUBLIC_APP_ACCESS_TOKEN_NO_EXPIRY);
  assert.equal(payload.exp, 0);
  assert.equal(isApplicationAccessTokenExpiryPermanent(payload.exp), true);
  assert.equal(isApplicationAccessTokenExpiryPermanent(undefined), true);
  assert.equal(isApplicationAccessTokenExpiryPermanent(4102444800), false);
});

test('a concrete rotation deadline must be in the future', () => {
  const rotation = createApplicationAccessToken({ ...identity, expiresAt: 4102444800 });
  assert.equal(decodeApplicationAccessToken(rotation).payload.exp, 4102444800);
  assert.throws(
    () => createApplicationAccessToken({ ...identity, expiresAt: 1 }),
    /must be after the token's issuedAt/u,
  );
});

test('a permanent token survives any check instant while an elapsed deadline fails', () => {
  const permanent = createApplicationAccessToken(identity);
  assert.doesNotThrow(() => assertApplicationAccessToken(permanent, { ...identity, now: 4_102_444_800 }));
  const rotation = createApplicationAccessToken({ ...identity, expiresAt: 4_102_444_800 });
  assert.doesNotThrow(() => assertApplicationAccessToken(rotation, { ...identity, now: 4_102_444_799 }));
  assert.throws(
    () => assertApplicationAccessToken(rotation, { ...identity, now: 4_102_444_800 }),
    /expired at 4102444800/u,
  );
  // Only the lifetime decision changes with the clock; a malformed deadline is
  // refused before any comparison.
  assert.throws(
    () => assertApplicationAccessToken(tokenWith({ exp: 'soon' }), { ...identity }),
    /exp claim must be a non-negative integer/u,
  );
});
