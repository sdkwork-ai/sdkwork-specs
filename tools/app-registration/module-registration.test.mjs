import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  auditModule,
  discoverModuleRoots,
  expandOemDomainPattern,
  loginUserSession,
  moduleRegistrationIds,
  parseModuleArgs,
  readSessionIdentity,
  registerModule,
  resolveModuleOemSettings,
} from './module-registration.mjs';
import { buildInstallationProvisionBody } from './contract.mjs';

function temporaryModule() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-module-'));
  const moduleRoot = path.join(workspace, 'sdkwork-demo');
  fs.mkdirSync(path.join(moduleRoot, 'apps', 'sdkwork-demo-web'), { recursive: true });
  fs.mkdirSync(path.join(moduleRoot, 'apps', 'sdkwork-demo-h5'), { recursive: true });
  fs.mkdirSync(path.join(moduleRoot, 'apps', 'not-an-app'), { recursive: true });
  for (const file of [
    'agent.app.config.json',
    'apps/sdkwork-demo-web/agent.app.config.json',
    'apps/sdkwork-demo-h5/agent.app.config.json',
  ]) {
    fs.writeFileSync(path.join(moduleRoot, file), '{"app":{"key":"demo"}}\n', 'utf8');
  }
  return { workspace, moduleRoot };
}

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.sig`;
}

test('discovers the root manifest and every app surface, skipping plain directories', () => {
  const { moduleRoot } = temporaryModule();
  assert.deepEqual(discoverModuleRoots(moduleRoot), ['.', 'apps/sdkwork-demo-h5', 'apps/sdkwork-demo-web']);
  assert.deepEqual(moduleRegistrationIds(moduleRoot), [
    'sdkwork-demo',
    'sdkwork-demo/apps/sdkwork-demo-h5',
    'sdkwork-demo/apps/sdkwork-demo-web',
  ]);
});

test('a module without a root manifest is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-empty-'));
  assert.throws(() => discoverModuleRoots(dir), /agent\.app\.config\.json/u);
});

test('OEM placeholders expand and the API domain becomes both endpoints', () => {
  assert.equal(
    expandOemDomainPattern('{app}.{env}.{brand}.{suffix}', { brand: 'acme', suffix: 'example.com' }),
    '{slug}.{env}.acme.example.com',
  );
  const settings = resolveModuleOemSettings({
    apiDomain: 'api.example.com',
    brand: 'acme',
    domainSuffix: 'example.com',
    env: {},
  });
  assert.equal(settings.deployBaseUrl, 'https://api.example.com');
  assert.equal(settings.iamBaseUrl, 'https://api.example.com');
  assert.equal(settings.primaryDomainPattern, '{slug}.{env}.example.com');
});

test('explicit and config values win over the environment, and a scheme is kept', () => {
  const settings = resolveModuleOemSettings({
    apiDomain: '',
    domainPattern: '{slug}.{env}.acme.test',
    env: { SDKWORK_OEM_API_DOMAIN: 'api.acme.test' },
  });
  assert.equal(settings.deployBaseUrl, 'https://api.acme.test');
  assert.equal(settings.primaryDomainPattern, '{slug}.{env}.acme.test');

  const explicit = resolveModuleOemSettings({
    apiDomain: 'https://api.internal:8443',
    oemConfig: { domainPattern: '{slug}.{env}.internal' },
    env: {},
  });
  assert.equal(explicit.deployBaseUrl, 'https://api.internal:8443');
  assert.equal(explicit.primaryDomainPattern, '{slug}.{env}.internal');
});

test('a session token names the user who owns a USER installation', () => {
  const identity = readSessionIdentity(jwt({ tenant_id: '100001', user_id: '375120000000000001', organization_id: '0' }));
  assert.deepEqual(identity, {
    userId: '375120000000000001',
    tenantId: '100001',
    organizationId: '0',
  });
  assert.equal(readSessionIdentity('not-a-jwt').userId, '');
});

test('password login sends the app credential and returns the dual-token session', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: {
            accessToken: jwt({ tenant_id: '100001', user_id: '42' }),
            authToken: 'session-auth',
          },
        };
      },
    };
  };
  const session = await loginUserSession({
    baseUrl: 'https://api.example.com',
    accessToken: 'app-public-token',
    username: 'alice',
    password: 'secret',
    deviceId: 'module-user',
    fetchImpl,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/app/v3/api/auth/sessions');
  assert.equal(calls[0].init.headers['access-token'], 'app-public-token');
  assert.equal(calls[0].init.headers['x-content-sha256'].length > 0, true);
  assert.match(String(calls[0].init.body), /"grantType":"password"/u);
  assert.equal(session.authToken, 'session-auth');
  assert.equal(session.identity.userId, '42');
});

test('parseModuleArgs accepts the user and OEM flags', () => {
  const options = parseModuleArgs([
    '--auth', 'user',
    '--username', 'alice',
    '--password', 'secret',
    '--access-token', 'app-token',
    '--operator-username', 'operator',
    '--operator-password', 'op-secret',
    '--api-domain', 'api.example.com',
    '--domain-suffix', 'example.com',
    '--module-root', '.',
    '--dry-run',
  ]);
  assert.equal(options.auth, 'user');
  assert.equal(options.username, 'alice');
  assert.equal(options.operatorUsername, 'operator');
  assert.equal(options.apiDomain, 'api.example.com');
  assert.equal(options.domainSuffix, 'example.com');
  assert.equal(options.dryRun, true);
  assert.throws(() => parseModuleArgs(['--nope']), /unsupported option/u);
});

test('the IAM provision body carries USER ownership only with an owner user id', () => {
  const base = {
    deployApplicationId: '382418217538162688',
    applicationType: 'pc',
    environment: 'production',
    tenantId: '100001',
    organizationId: '0',
    displayName: 'Demo',
  };
  const user = buildInstallationProvisionBody({
    ...base,
    ownershipScope: 'USER',
    ownerUserId: '375120000000000001',
  });
  assert.equal(user.ownershipScope, 'USER');
  assert.equal(user.ownerUserId, '375120000000000001');
  assert.throws(
    () => buildInstallationProvisionBody({ ...base, ownershipScope: 'USER' }),
    /ownerUserId/u,
  );
  const tenant = buildInstallationProvisionBody(base);
  assert.equal(tenant.ownershipScope, undefined);
});

test('audit classifies the module roots without credentials', () => {
  const { moduleRoot } = temporaryModule();
  const audit = auditModule(moduleRoot);
  assert.equal(audit.counts.roots, 3);
  assert.equal(audit.counts.missingApplicationType, 3);
  assert.equal(audit.entries.length, 3);
});

test('organization ownership requires an operator and a positive organization id', async () => {
  const { moduleRoot } = temporaryModule();
  await assert.rejects(
    registerModule({ moduleRoot, auth: 'operator', ownership: 'organization', dryRun: true }),
    /positive --organization-id/u,
  );
  await assert.rejects(
    registerModule({ moduleRoot, auth: 'user', ownership: 'organization', organizationId: '100002', dryRun: true }),
    /requires --auth operator/u,
  );
  await assert.rejects(
    registerModule({ moduleRoot, auth: 'operator', ownership: 'user', ownerUserId: '1', dryRun: true }),
    /requires --auth user/u,
  );
});

test('parse accepts ownership, fallback, and audit flags', () => {
  const options = parseModuleArgs([
    '--ownership', 'organization', '--organization-id', '100002',
    '--default-app-type', 'pc', '--default-permission-scope', 'iam:self,iam:users.read',
    '--audit', '--iam-transport', 'legacy',
  ]);
  assert.equal(options.ownership, 'organization');
  assert.equal(options.organizationId, '100002');
  assert.equal(options.defaultApplicationType, 'pc');
  assert.deepEqual(options.defaultPermissionScope, ['iam:self', 'iam:users.read']);
  assert.equal(options.audit, true);
  assert.equal(options.iamTransport, 'legacy');
});

test('the provision body carries ORGANIZATION ownership for a non-zero organization', () => {
  const organization = buildInstallationProvisionBody({
    deployApplicationId: '382418217538162688',
    applicationType: 'pc',
    environment: 'production',
    tenantId: '100001',
    organizationId: '100002',
    displayName: 'Org Demo',
    ownershipScope: 'ORGANIZATION',
  });
  assert.equal(organization.organizationId, '100002');
  assert.equal(organization.ownershipScope, 'ORGANIZATION');
});
