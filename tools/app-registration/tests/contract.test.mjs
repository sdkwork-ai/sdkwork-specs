#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPLOY_APP_CREATE_IDEMPOTENCY_KEY_PREFIX,
  DEPLOY_IDEMPOTENCY_KEY_MAX_LEN,
  RegistrationConfigurationError,
  assertDeployApplicationAnchor,
  buildDeployAppCreateBody,
  buildTenantApplicationProvisionBody,
  defaultDeploymentProfile,
  deployAppCreateIdempotencyKey,
  deployAppKindForApplicationType,
  deriveProvisioningIdempotencyKey,
  mapManifestAppTypeToApplicationType,
  normalizeEnvironment,
  readDeployAppItem,
  readTenantApplicationItem,
  resolveDeploySlug,
  resolveRegistrationSettings,
  tenantApplicationInstanceKey,
} from '../contract.mjs';

test('environments normalize and reject anything outside the lifecycle', () => {
  assert.equal(normalizeEnvironment('dev'), 'development');
  assert.equal(normalizeEnvironment('LOCAL'), 'development');
  assert.equal(normalizeEnvironment('prod'), 'production');
  assert.equal(normalizeEnvironment('production'), 'production');
  assert.throws(
    () => normalizeEnvironment('qa'),
    (error) => error instanceof RegistrationConfigurationError && /unsupported environment/u.test(error.message),
  );
  assert.equal(defaultDeploymentProfile('development'), 'standalone');
  assert.equal(defaultDeploymentProfile('production'), 'cloud');
});

test('manifest app types map onto the IAM provisioning vocabulary', () => {
  assert.equal(mapManifestAppTypeToApplicationType('APP_HTML'), 'h5');
  assert.equal(mapManifestAppTypeToApplicationType('APP_FLUTTER'), 'flutter');
  assert.equal(mapManifestAppTypeToApplicationType('APP_REACT'), 'pc');
  assert.equal(mapManifestAppTypeToApplicationType('APP_API'), 'api');
  assert.equal(mapManifestAppTypeToApplicationType('SOMETHING_ELSE'), 'other');
  assert.equal(mapManifestAppTypeToApplicationType(''), '');
});

test('slug derives from app.key, then app.name, then the directory', () => {
  const entry = { id: 'r/apps/a', repo: 'r', appDir: 'apps/a', appKey: 'SDKWork-App', appName: 'App' };
  assert.deepEqual(resolveDeploySlug(entry, [entry]), {
    slug: 'sdkwork-app',
    slugSource: 'app.key',
    disambiguated: false,
  });
  const noKey = { id: 'r/apps/b', repo: 'r', appDir: 'apps/b', appKey: '', appName: 'My App 2' };
  assert.equal(resolveDeploySlug(noKey, [noKey]).slug, 'my-app-2');
  const onlyDir = { id: 'r/apps/c', repo: 'r', appDir: 'apps/c', appKey: '', appName: '' };
  assert.equal(resolveDeploySlug(onlyDir, [onlyDir]).slug, 'c');
});

test('a fork that kept its upstream app.key is disambiguated with the repository', () => {
  const upstream = { id: 'sdkwork-birdcoder2', repo: 'sdkwork-birdcoder2', appDir: '.', appKey: 'sdkwork-birdcoder2', appName: 'BirdCoder' };
  const fork = { id: 'sdkwork-daxuedazi', repo: 'sdkwork-daxuedazi', appDir: '.', appKey: 'sdkwork-birdcoder2', appName: 'BirdCoder' };
  const entries = [upstream, fork];
  const upstreamSlug = resolveDeploySlug(upstream, entries);
  const forkSlug = resolveDeploySlug(fork, entries);
  assert.equal(upstreamSlug.slug, 'sdkwork-birdcoder2-sdkwork-birdcoder2');
  assert.equal(forkSlug.slug, 'sdkwork-daxuedazi-sdkwork-birdcoder2');
  assert.notEqual(upstreamSlug.slug, forkSlug.slug);
  assert.equal(upstreamSlug.disambiguated, true);
  // Stable across runs and independent of the subclass ordering.
  assert.deepEqual(resolveDeploySlug(fork, [...entries].reverse()), forkSlug);
});

test('the apps.create idempotency key is deterministic per environment and slug', () => {
  const first = deployAppCreateIdempotencyKey('development', 'sdkwork-im-pc');
  const second = deployAppCreateIdempotencyKey('development', 'sdkwork-im-pc');
  assert.equal(first, second);
  assert.equal(first, `${DEPLOY_APP_CREATE_IDEMPOTENCY_KEY_PREFIX}development:sdkwork-im-pc`);
  assert.notEqual(first, deployAppCreateIdempotencyKey('production', 'sdkwork-im-pc'));
  assert.notEqual(first, deployAppCreateIdempotencyKey('development', 'sdkwork-im-h5'));
  const longSlug = 'a'.repeat(120);
  const longKey = deployAppCreateIdempotencyKey('production', longSlug);
  assert.ok(longKey.length <= DEPLOY_IDEMPOTENCY_KEY_MAX_LEN, `key too long: ${longKey.length}`);
  assert.equal(longKey, deployAppCreateIdempotencyKey('production', longSlug));
});

test('the IAM provisioning key is byte-compatible with the bootstrap framework', () => {
  // sha256("100001\n0\n900123\nh5\n900123_dev\ndevelopment")[0..40]
  const key = deriveProvisioningIdempotencyKey({
    tenantId: '100001',
    organizationId: '0',
    deployApplicationId: '900123',
    applicationType: 'h5',
    instanceKey: '900123_dev',
    environment: 'development',
  });
  assert.equal(key, 'iam-bootstrap-f2d6dfb8d9b169ce46a0e9b6d89af366fb625921');
  assert.equal(
    key,
    deriveProvisioningIdempotencyKey({
      tenantId: '100001',
      organizationId: '0',
      deployApplicationId: '900123',
      applicationType: 'h5',
      instanceKey: '900123_dev',
      environment: 'development',
    }),
  );
});

test('instance keys collapse development and production like the embedded bootstrap', () => {
  assert.equal(tenantApplicationInstanceKey('900123', 'development'), '900123_dev');
  assert.equal(tenantApplicationInstanceKey('900123', 'dev'), '900123_dev');
  assert.equal(tenantApplicationInstanceKey('900123', 'production'), '900123_prod');
  assert.equal(tenantApplicationInstanceKey('900123', 'staging'), '900123_staging');
  assert.equal(tenantApplicationInstanceKey('a-b', 'test'), 'a_b_test');
});

test('the anchor must be the decimal deploy application id', () => {
  assert.equal(assertDeployApplicationAnchor(' 900123 '), '900123');
  for (const invalid of [
    '',
    '   ',
    '0f8b7f26-2d7c-4f43-8a4b-0c5a51e1f0aa',
    'sdkwork-im-pc',
    '90012a',
    '900\n123',
  ]) {
    assert.throws(
      () => assertDeployApplicationAnchor(invalid),
      (error) => error instanceof RegistrationConfigurationError
        && /decimal/u.test(error.message),
      `${JSON.stringify(invalid)} must be refused`,
    );
  }
});

test('the apps.create body is deterministic and carries only derived fields', () => {
  const body = buildDeployAppCreateBody({
    slug: 'sdkwork-im-pc',
    name: 'SDKWork IM PC',
    appKind: 'SPA_WEB',
    environment: 'development',
    metadata: { 'sdkwork.io/source-repository': 'sdkwork-im' },
  });
  assert.deepEqual(body, {
    name: 'SDKWork IM PC',
    slug: 'sdkwork-im-pc',
    appKind: 'SPA_WEB',
    defaultEnvironment: 'development',
    metadata: { 'sdkwork.io/source-repository': 'sdkwork-im' },
  });
  assert.deepEqual(body, buildDeployAppCreateBody({
    slug: 'sdkwork-im-pc',
    name: 'SDKWork IM PC',
    appKind: 'SPA_WEB',
    environment: 'development',
    metadata: { 'sdkwork.io/source-repository': 'sdkwork-im' },
  }));
  assert.equal(deployAppKindForApplicationType('h5'), 'SPA_WEB');
  assert.equal(deployAppKindForApplicationType('api'), 'API_SERVICE');
});

test('the provisioning body binds the anchor, not the manifest runtime app id', () => {
  const body = buildTenantApplicationProvisionBody({
    deployApplicationId: '900123',
    applicationType: 'h5',
    environment: 'development',
    tenantId: '100001',
    organizationId: '0',
    appKey: 'sdkwork-im-pc',
    displayName: 'SDKWork IM PC',
    accessPermissions: ['iam:self'],
  });
  assert.equal(body.deployApplicationId, '900123');
  assert.equal(body.applicationType, 'h5');
  assert.equal(body.instanceKey, '900123_dev');
  assert.equal(body.environment, 'development');
  assert.equal(body.provisioningIdempotencyKey, 'iam-bootstrap-f2d6dfb8d9b169ce46a0e9b6d89af366fb625921');
  assert.deepEqual(body.accessPermissions, ['iam:self']);
  assert.equal(body.appKey, undefined, 'the retired appKey field must never be sent');
  assert.equal(body.templateId, undefined);
});

test('an explicit empty permission scope survives as an explicit choice', () => {
  const body = buildTenantApplicationProvisionBody({
    deployApplicationId: '900123',
    applicationType: 'api',
    environment: 'production',
    tenantId: '100001',
    organizationId: '0',
    accessPermissions: [],
  });
  assert.deepEqual(body.accessPermissions, []);
  const omitted = buildTenantApplicationProvisionBody({
    deployApplicationId: '900123',
    applicationType: 'api',
    environment: 'production',
    tenantId: '100001',
    organizationId: '0',
  });
  assert.equal('accessPermissions' in omitted, false);
  assert.throws(
    () => buildTenantApplicationProvisionBody({
      deployApplicationId: '900123',
      applicationType: 'desktop',
      environment: 'production',
      tenantId: '100001',
      organizationId: '0',
    }),
    /not a tenant application type/u,
  );
});

test('deploy response parsing keeps the uuid and the decimal anchor apart', () => {
  const item = readDeployAppItem({
    id: 'uuid-1',
    slug: 'sdkwork-im-pc',
    appStatus: 'DRAFT',
    tenantId: '100001',
    deployApplicationId: '900123',
  });
  assert.equal(item.uuid, 'uuid-1');
  assert.equal(item.deployApplicationId, '900123');
  // A response without the anchor field fails closed: the uuid is never
  // promoted into the anchor position.
  assert.throws(
    () => readDeployAppItem({ id: 'uuid-2', slug: 'x', appStatus: 'DRAFT' }),
    (error) => error instanceof RegistrationConfigurationError
      && /no deployApplicationId/u.test(error.message),
  );
  // A non-decimal value is not the anchor either.
  assert.throws(
    () => readDeployAppItem({ id: 'uuid-3', deployApplicationId: 'uuid-3' }),
    (error) => error instanceof RegistrationConfigurationError && /decimal/u.test(error.message),
  );
  assert.throws(
    () => readDeployAppItem({ id: 'uuid-4', deployApplicationId: '' }),
    (error) => error instanceof RegistrationConfigurationError
      && /no deployApplicationId/u.test(error.message),
  );
  assert.throws(() => readDeployAppItem(null), RegistrationConfigurationError);
});

test('tenant application parsing tolerates both id spellings', () => {
  assert.equal(
    readTenantApplicationItem({ id: 'ta-1', status: 'enabled', deployApplicationId: '900123' })
      .tenantApplicationId,
    'ta-1',
  );
  assert.equal(
    readTenantApplicationItem({ tenantApplicationId: 'ta-2', status: 'draft' })
      .tenantApplicationId,
    'ta-2',
  );
});

test('settings resolution names every missing variable at once', () => {
  assert.throws(
    () => resolveRegistrationSettings({}),
    (error) => {
      assert.ok(error instanceof RegistrationConfigurationError);
      assert.match(error.message, /SDKWORK_DEPLOY_BACKEND_API_BASE_URL/u);
      assert.match(error.message, /SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN/u);
      assert.match(error.message, /SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN/u);
      assert.match(error.message, /SDKWORK_IAM_BACKEND_API_BASE_URL/u);
      assert.match(error.message, /SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN/u);
      assert.equal(error.details.missing.length, 5);
      return true;
    },
  );
});

test('settings resolution accepts either IAM auth shape and validates URLs', () => {
  const base = {
    SDKWORK_DEPLOY_BACKEND_API_BASE_URL: 'http://127.0.0.1:3902/',
    SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN: 'access',
    SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN: 'auth',
    SDKWORK_IAM_BACKEND_API_BASE_URL: 'http://127.0.0.1:3901/backend/v3/api',
    SDKWORK_IAM_BOOTSTRAP_OPERATOR_USERNAME: 'admin',
    SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD: 'secret',
    SDKWORK_TENANT_ID: '100001',
    SDKWORK_ORGANIZATION_ID: '0',
  };
  const settings = resolveRegistrationSettings(base);
  assert.equal(settings.deploy.baseUrl, 'http://127.0.0.1:3902');
  assert.equal(settings.iam.baseUrl, 'http://127.0.0.1:3901/backend/v3/api');
  assert.deepEqual(settings.iam.auth, { username: 'admin', password: 'secret' });
  assert.equal(settings.tenantId, '100001');
  assert.equal(settings.organizationId, '0');

  const tokenSettings = resolveRegistrationSettings({
    ...base,
    SDKWORK_IAM_BOOTSTRAP_OPERATOR_USERNAME: '',
    SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD: '',
    SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN: 'operator-jwt',
  });
  assert.deepEqual(tokenSettings.iam.auth, { authToken: 'operator-jwt' });

  assert.throws(
    () => resolveRegistrationSettings({ ...base, SDKWORK_DEPLOY_BACKEND_API_BASE_URL: '127.0.0.1:3902' }),
    /must be an absolute http\(s\) URL/u,
  );
  assert.throws(
    () => resolveRegistrationSettings({ ...base, SDKWORK_DEPLOY_BACKEND_TIMEOUT_MS: '5' }),
    /500\.\.60000/u,
  );
});
