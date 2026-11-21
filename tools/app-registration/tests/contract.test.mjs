#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPLOY_APP_CREATE_IDEMPOTENCY_KEY_PREFIX,
  DEPLOY_APP_KINDS,
  DEPLOY_IDEMPOTENCY_KEY_MAX_LEN,
  MANIFEST_APP_TYPES,
  NEW_REGISTRATION_DEPLOY_APP_KINDS,
  RegistrationConfigurationError,
  assertDeployApplicationAnchor,
  buildDeployAppCreateBody,
  buildInstallationProvisionBody,
  defaultDeploymentProfile,
  deployAppCreateIdempotencyKey,
  deriveProvisioningIdempotencyKey,
  describeSurfaceNameMismatch,
  environmentUpsertIdempotencyKey,
  expandPrimaryDomainPattern,
  normalizeEnvironment,
  normalizePrimaryDomain,
  readDeployAppItem,
  readInstallationItem,
  replaceManifestAppType,
  resolveDeployAppSurface,
  resolveDeploySlug,
  resolvePrimaryDomain,
  resolveRegistrationSettings,
  tenantApplicationInstanceKey,
  verifyDeployAppKind,
} from '../contract.mjs';

test('the deploy kind and manifest app type vocabularies are closed', () => {
  assert.deepEqual(
    [...DEPLOY_APP_KINDS].sort(),
    [
      'ANDROID_APP', 'API_SERVICE', 'DESKTOP_APP', 'DOUYIN_MINIPROGRAM', 'FLUTTER_APP',
      'H5_WEB', 'HARMONYOS_APP', 'IOS_APP', 'PC_WEB', 'SPA_WEB', 'STATIC_WEB',
      'WECHAT_MINIPROGRAM',
    ],
  );
  assert.equal(NEW_REGISTRATION_DEPLOY_APP_KINDS.includes('SPA_WEB'), false);
  assert.equal(NEW_REGISTRATION_DEPLOY_APP_KINDS.length, DEPLOY_APP_KINDS.length - 1);
  for (const appType of ['NONE', 'SDK', 'APP_HTML', 'APP_FLUTTER', 'APP_UNIAPP', 'APP_REACT', 'APP_HARMONY']) {
    assert.ok(MANIFEST_APP_TYPES.includes(appType), `${appType} must be a manifest app type`);
  }
});

test('the surface resolver reads the runtime facts, not app.appType', () => {
  const cases = [
    {
      name: 'flutter root',
      input: { appType: 'APP_FLUTTER', runtimeFamily: 'mobile', runtimeFramework: 'flutter', publishPlatforms: ['APP_IOS', 'APP_ANDROID'] },
      kind: 'FLUTTER_APP',
      applicationType: 'flutter',
      canonicalAppType: 'APP_FLUTTER',
    },
    {
      name: 'wechat mini program',
      input: { appType: 'NONE', runtimeFamily: 'mini-program', runtimeFramework: 'weixin-mini-program', publishPlatforms: ['MP_WEIXIN'] },
      kind: 'WECHAT_MINIPROGRAM',
      applicationType: 'miniprogram',
      canonicalAppType: '',
    },
    {
      name: 'uni-app mini program',
      input: { appType: 'APP_UNIAPP', runtimeFamily: 'mini-program', runtimeFramework: 'uni-app', publishPlatforms: ['MP_WEIXIN'] },
      kind: 'WECHAT_MINIPROGRAM',
      applicationType: 'miniprogram',
      canonicalAppType: 'APP_UNIAPP',
    },
    {
      name: 'native wechat mini program framework',
      input: { appType: 'NONE', runtimeFamily: 'mini-program', runtimeFramework: 'mp-weixin', publishPlatforms: ['MP_WEIXIN'] },
      kind: 'WECHAT_MINIPROGRAM',
      applicationType: 'miniprogram',
      canonicalAppType: '',
    },
    {
      name: 'douyin mini program',
      input: { appType: 'APP_UNIAPP', runtimeFamily: 'mini-program', runtimeFramework: 'mp-douyin', publishPlatforms: ['MP_DOUYIN'] },
      kind: 'DOUYIN_MINIPROGRAM',
      applicationType: 'miniprogram',
      canonicalAppType: '',
    },
    {
      name: 'harmony native',
      input: { appType: 'APP_HARMONY', runtimeFamily: 'mobile', runtimeFramework: 'harmony-native', publishPlatforms: ['APP_HARMONY'] },
      kind: 'HARMONYOS_APP',
      applicationType: 'harmonyos',
      canonicalAppType: 'APP_HARMONY',
    },
    {
      name: 'h5 root',
      input: { appType: 'APP_REACT', runtimeFamily: 'mobile', runtimeFramework: 'react-h5', publishPlatforms: ['H5'] },
      kind: 'H5_WEB',
      applicationType: 'h5',
    },
    {
      name: 'capacitor h5 root',
      input: { appType: 'APP_REACT', runtimeFamily: 'mobile', runtimeFramework: 'react-capacitor', publishPlatforms: ['H5', 'APP_IOS', 'APP_ANDROID'] },
      kind: 'H5_WEB',
      applicationType: 'h5',
    },
    {
      name: 'pc web root',
      input: { appType: 'APP_REACT', runtimeFamily: 'web', runtimeFramework: 'react', publishPlatforms: ['WEB'] },
      kind: 'PC_WEB',
      applicationType: 'pc',
    },
    {
      name: 'tauri desktop root',
      input: { appType: 'APP_REACT', runtimeFamily: 'desktop', runtimeFramework: 'react-tauri', publishPlatforms: ['DESKTOP_WINDOWS'] },
      kind: 'DESKTOP_APP',
      applicationType: 'desktop',
    },
    {
      name: 'static site',
      input: { appType: 'APP_HTML', runtimeFamily: 'web', runtimeFramework: 'static-html', publishPlatforms: ['WEB'] },
      kind: 'STATIC_WEB',
      applicationType: 'pc',
    },
    {
      name: 'api server',
      input: { appType: 'SDK', runtimeFamily: 'server', runtimeFramework: 'rust-axum' },
      kind: 'API_SERVICE',
      applicationType: 'api',
    },
    {
      name: 'native android',
      input: { appType: 'APP_REACT', runtimeFamily: 'mobile', runtimeFramework: 'android-native', publishPlatforms: ['APP_ANDROID'] },
      kind: 'ANDROID_APP',
      applicationType: 'android',
    },
    {
      name: 'native ios',
      input: { appType: 'APP_REACT', runtimeFamily: 'mobile', runtimeFramework: 'ios-native', publishPlatforms: ['APP_IOS'] },
      kind: 'IOS_APP',
      applicationType: 'ios',
    },
  ];
  for (const testCase of cases) {
    const resolved = resolveDeployAppSurface(testCase.input);
    assert.equal(resolved.deployAppKind, testCase.kind, `${testCase.name}: kind`);
    assert.equal(resolved.applicationType, testCase.applicationType, `${testCase.name}: IAM type`);
    if (testCase.canonicalAppType !== undefined) {
      assert.equal(resolved.canonicalAppType, testCase.canonicalAppType, `${testCase.name}: appType`);
    }
    assert.deepEqual(resolved.defects, [], `${testCase.name}: no defect`);
  }
  // The same declared app type resolves differently when the surface differs:
  // that is the bug class this resolver exists to prevent.
  const asH5 = resolveDeployAppSurface({ appType: 'APP_REACT', runtimeFamily: 'mobile', runtimeFramework: 'react-h5' });
  const asPc = resolveDeployAppSurface({ appType: 'APP_REACT', runtimeFamily: 'web', runtimeFramework: 'react' });
  assert.equal(asH5.applicationType, 'h5');
  assert.equal(asPc.applicationType, 'pc');
  assert.notEqual(asH5.deployAppKind, asPc.deployAppKind);
});

test('the surface resolver fails closed instead of defaulting to an API service', () => {
  const unknown = resolveDeployAppSurface({ appType: 'APP_REACT' });
  assert.equal(unknown.deployAppKind, '');
  assert.equal(unknown.applicationType, '');
  assert.match(unknown.defects.join(' '), /cannot derive the deploy application kind/u);

  const unknownPlatform = resolveDeployAppSurface({
    runtimeFamily: 'mini-program',
    runtimeFramework: 'alipay-mini-program',
    publishPlatforms: ['MP_ALIPAY'],
  });
  assert.equal(unknownPlatform.deployAppKind, '');
  assert.match(unknownPlatform.defects.join(' '), /no canonical deploy application kind/u);

  const multiApp = resolveDeployAppSurface({
    runtimeFamily: 'mobile',
    runtimeFramework: 'uni-app-x',
    clientArchitectures: ['uniappx'],
    publishPlatforms: ['APP_ANDROID', 'APP_IOS', 'APP_HARMONY'],
  });
  assert.equal(multiApp.deployAppKind, '');
  assert.match(multiApp.defects.join(' '), /uni-app delivers/u);

  const bothMiniPrograms = resolveDeployAppSurface({
    runtimeFamily: 'mini-program',
    runtimeFramework: 'multi-mini-program',
    publishPlatforms: ['MP_WEIXIN', 'MP_DOUYIN'],
  });
  assert.equal(bothMiniPrograms.deployAppKind, 'WECHAT_MINIPROGRAM');
});

test('a root that lists several architectures is classified by its framework', () => {
  const resolved = resolveDeployAppSurface({
    appType: 'APP_REACT',
    runtimeFamily: 'web',
    runtimeFramework: 'react',
    clientArchitectures: ['pc-web', 'h5', 'flutter', 'mini-program'],
    publishPlatforms: ['WEB', 'H5', 'MP_WEIXIN'],
  });
  assert.equal(resolved.deployAppKind, 'PC_WEB');
  assert.match(resolved.notes.join(' '), /publish\.platforms also declares/u);
});

test('an H5-only delivery is H5, while WEB plus H5 stays the browser surface', () => {
  const h5Only = resolveDeployAppSurface({
    appType: 'APP_REACT',
    runtimeFamily: 'web',
    runtimeFramework: 'react',
    publishPlatforms: ['H5'],
  });
  assert.equal(h5Only.deployAppKind, 'H5_WEB');
  assert.equal(h5Only.applicationType, 'h5');

  const both = resolveDeployAppSurface({
    appType: 'APP_REACT',
    runtimeFamily: 'web',
    runtimeFramework: 'react',
    publishPlatforms: ['WEB', 'H5'],
  });
  assert.equal(both.deployAppKind, 'PC_WEB');
  assert.equal(both.applicationType, 'pc');
});

test('app.appType contradictions are reported, and missing values only warn', () => {
  const contradiction = resolveDeployAppSurface({
    appType: 'APP_HTML',
    runtimeFamily: 'mobile',
    runtimeFramework: 'flutter',
  });
  assert.equal(contradiction.canonicalAppType, 'APP_FLUTTER');
  assert.equal(contradiction.appTypeDeclared, 'APP_HTML');
  const none = resolveDeployAppSurface({
    appType: 'NONE',
    runtimeFamily: 'mini-program',
    runtimeFramework: 'weixin-mini-program',
    publishPlatforms: ['MP_WEIXIN'],
  });
  assert.equal(none.appTypeWarning, true);
  assert.equal(none.canonicalAppType, '');
});

test('replaceManifestAppType patches only the appType value', () => {
  const text = `{\n  "app": {\n    "key": "demo",\n    "appType": "APP_HTML",\n    "name": "Demo"\n  },\n  "runtime": {\n    "appType": "APP_HTML"\n  }\n}\n`;
  const patched = replaceManifestAppType(text, 'APP_FLUTTER');
  assert.ok(patched);
  assert.equal(patched.previous, 'APP_HTML');
  assert.equal(patched.text, text.replace('"appType": "APP_HTML",\n    "name"', '"appType": "APP_FLUTTER",\n    "name"'));
  assert.equal(replaceManifestAppType(text, ''), null);
  assert.equal(replaceManifestAppType('{}', 'APP_FLUTTER'), null);
});

test('verifyDeployAppKind refuses an immutable kind mismatch', () => {
  assert.equal(verifyDeployAppKind({ slug: 'demo', appKind: 'FLUTTER_APP' }, 'FLUTTER_APP', 'demo'), '');
  assert.equal(verifyDeployAppKind({ slug: 'demo', appKind: '' }, 'FLUTTER_APP', 'demo'), '');
  const mismatch = verifyDeployAppKind({ slug: 'demo', appKind: 'API_SERVICE' }, 'FLUTTER_APP', 'demo');
  assert.match(mismatch, /stored as API_SERVICE/u);
  assert.match(mismatch, /resolves to FLUTTER_APP/u);
  assert.match(mismatch, /immutable/u);
});

test('describeSurfaceNameMismatch flags a directory whose surface disagrees', () => {
  assert.match(
    describeSurfaceNameMismatch('apps/sdkwork-image-flutter-mobile', 'API_SERVICE'),
    /names a flutter surface/u,
  );
  assert.equal(describeSurfaceNameMismatch('apps/sdkwork-image-flutter-mobile', 'FLUTTER_APP'), '');
  assert.equal(describeSurfaceNameMismatch('apps/sdkwork-cloudrouter-pc', 'PC_WEB'), '');
  assert.equal(describeSurfaceNameMismatch('.', 'PC_WEB'), '');
});

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

test('the apps.create body is deterministic and requires a resolved kind', () => {
  const body = buildDeployAppCreateBody({
    slug: 'sdkwork-im-pc',
    name: 'SDKWork IM PC',
    appKind: 'PC_WEB',
    environment: 'development',
    metadata: { 'sdkwork.io/source-repository': 'sdkwork-im' },
  });
  assert.deepEqual(body, {
    name: 'SDKWork IM PC',
    slug: 'sdkwork-im-pc',
    appKind: 'PC_WEB',
    defaultEnvironment: 'development',
    metadata: { 'sdkwork.io/source-repository': 'sdkwork-im' },
  });
  assert.deepEqual(body, buildDeployAppCreateBody({
    slug: 'sdkwork-im-pc',
    name: 'SDKWork IM PC',
    appKind: 'PC_WEB',
    environment: 'development',
    metadata: { 'sdkwork.io/source-repository': 'sdkwork-im' },
  }));
  // No silent fallback: the retired behavior registered every unknown surface as
  // an API service.
  assert.throws(
    () => buildDeployAppCreateBody({ slug: 'sdkwork-im-pc', name: 'SDKWork IM PC' }),
    (error) => error instanceof RegistrationConfigurationError && /appKind is required/u.test(error.message),
  );
  assert.throws(
    () => buildDeployAppCreateBody({ slug: 'sdkwork-im-pc', name: 'SDKWork IM PC', appKind: 'SPA_WEB' }),
    (error) => error instanceof RegistrationConfigurationError && /legacy-only/u.test(error.message),
  );
  assert.throws(
    () => buildDeployAppCreateBody({ slug: 'sdkwork-im-pc', name: 'SDKWork IM PC', appKind: 'NOT_A_KIND' }),
    (error) => error instanceof RegistrationConfigurationError,
  );
});

test('the provisioning body binds the anchor, not the manifest runtime app id', () => {
  const body = buildInstallationProvisionBody({
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
  const body = buildInstallationProvisionBody({
    deployApplicationId: '900123',
    applicationType: 'api',
    environment: 'production',
    tenantId: '100001',
    organizationId: '0',
    accessPermissions: [],
  });
  assert.deepEqual(body.accessPermissions, []);
  const omitted = buildInstallationProvisionBody({
    deployApplicationId: '900123',
    applicationType: 'api',
    environment: 'production',
    tenantId: '100001',
    organizationId: '0',
  });
  assert.equal('accessPermissions' in omitted, false);
  assert.throws(
    () => buildInstallationProvisionBody({
      deployApplicationId: '900123',
      applicationType: 'browser-desktop',
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
    readInstallationItem({ id: 'ta-1', status: 'enabled', deployApplicationId: '900123' })
      .installationId,
    'ta-1',
  );
  assert.equal(
    readInstallationItem({ installationId: 'ta-2', status: 'draft' })
      .installationId,
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

test('the settings carry the optional dual-token management credentials', () => {
  const base = {
    SDKWORK_DEPLOY_BACKEND_API_BASE_URL: 'http://127.0.0.1:3902',
    SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN: 'access',
    SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN: 'auth',
    SDKWORK_IAM_BACKEND_API_BASE_URL: 'http://127.0.0.1:3901',
    SDKWORK_IAM_BOOTSTRAP_OPERATOR_USERNAME: 'admin',
    SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD: 'secret',
  };
  const withOperatorPassword = resolveRegistrationSettings(base);
  assert.deepEqual(withOperatorPassword.iam.management, {
    accessToken: '',
    authToken: '',
    username: 'admin',
    password: 'secret',
  });

  const explicit = resolveRegistrationSettings({
    ...base,
    SDKWORK_IAM_MANAGEMENT_ACCESS_TOKEN: 'mgmt-access',
    SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN: 'mgmt-auth',
  });
  assert.equal(explicit.iam.management.accessToken, 'mgmt-access');
  assert.equal(explicit.iam.management.authToken, 'mgmt-auth');

  const aliases = resolveRegistrationSettings({
    ...base,
    SDKWORK_IAM_BACKEND_ACCESS_TOKEN: 'alias-access',
    SDKWORK_IAM_BACKEND_AUTH_TOKEN: 'alias-auth',
  });
  assert.equal(aliases.iam.management.accessToken, 'alias-access');
  assert.equal(aliases.iam.management.authToken, 'alias-auth');
});

test('a domain is normalized into the absolute hostname IAM stores', () => {
  assert.equal(normalizePrimaryDomain('https://Demo.SDKWork.com'), 'demo.sdkwork.com');
  assert.equal(normalizePrimaryDomain('http://127.0.0.1:4734'), '127.0.0.1');
  assert.equal(normalizePrimaryDomain('demo.sdkwork.com/api/v1?x=1'), 'demo.sdkwork.com');
  assert.equal(normalizePrimaryDomain('user@demo.sdkwork.com:8443'), 'demo.sdkwork.com');
  assert.equal(normalizePrimaryDomain('demo.sdkwork.com.'), 'demo.sdkwork.com');
  assert.equal(normalizePrimaryDomain('localhost'), 'localhost');
  for (const invalid of [
    '',
    '   ',
    'demo sdkwork.com',
    '*.sdkwork.com',
    'https://',
    '[::1]',
    'demo..sdkwork.com',
    '-demo.sdkwork.com',
    `${'a'.repeat(64)}.sdkwork.com`,
  ]) {
    assert.throws(
      () => normalizePrimaryDomain(invalid),
      (error) => error instanceof RegistrationConfigurationError
        && /absolute hostname/u.test(error.message),
      `${JSON.stringify(invalid)} must be refused`,
    );
  }
});

test('the --primary-domain pattern expands {env} and {slug} and rejects other tokens', () => {
  assert.equal(
    expandPrimaryDomainPattern('{slug}.{env}.sdkwork.test', {
      environment: 'development',
      slug: 'sdkwork-im-pc',
    }),
    'sdkwork-im-pc.development.sdkwork.test',
  );
  assert.equal(
    expandPrimaryDomainPattern('app.sdkwork.test', { environment: 'production', slug: 'x' }),
    'app.sdkwork.test',
    'a pattern without placeholders is used verbatim',
  );
  assert.throws(
    () => expandPrimaryDomainPattern('{tenant}.sdkwork.test', { environment: 'test', slug: 'x' }),
    (error) => error instanceof RegistrationConfigurationError
      && /unsupported placeholder \{tenant\}/u.test(error.message),
  );
  assert.throws(
    () => expandPrimaryDomainPattern('{slug}.sdkwork.test', { environment: 'test', slug: '' }),
    (error) => error instanceof RegistrationConfigurationError && /no deploy slug/u.test(error.message),
  );
});

test('the primary domain resolves from the documented sources in order', () => {
  const entry = {
    environments: {
      development: {
        accessUrl: 'http://127.0.0.1:4734',
        deployUrl: 'https://deploy.sdkwork.test',
      },
    },
    backendPrimaryDomain: 'backend.sdkwork.test',
    backendDomain: 'domain.sdkwork.test',
  };
  assert.deepEqual(
    resolvePrimaryDomain({ entry, environment: 'development', slug: 'sdkwork-im' }),
    {
      domain: '127.0.0.1',
      source: 'environments.development.accessUrl',
      checked: [
        'environments.development.accessUrl',
        'environments.development.deployUrl',
        'backend.primaryDomain',
        'backend.domain',
      ],
    },
  );
  assert.equal(
    resolvePrimaryDomain({
      entry: { ...entry, environments: { development: { deployUrl: 'https://deploy.sdkwork.test' } } },
      environment: 'development',
    }).source,
    'environments.development.deployUrl',
  );
  assert.equal(
    resolvePrimaryDomain({ entry: { backendDomain: 'domain.sdkwork.test' }, environment: 'development' })
      .source,
    'backend.domain',
  );
  assert.deepEqual(
    resolvePrimaryDomain({
      entry: { backendPrimaryDomain: 'backend.sdkwork.test' },
      environment: 'production',
      pattern: 'app-{slug}.{env}.sdkwork.test',
      slug: 'sdkwork-im',
    }),
    {
      domain: 'app-sdkwork-im.production.sdkwork.test',
      source: '--primary-domain',
      checked: [
        '--primary-domain',
        'environments.production.accessUrl',
        'environments.production.deployUrl',
        'backend.primaryDomain',
        'backend.domain',
      ],
    },
  );
  const none = resolvePrimaryDomain({ entry: {}, environment: 'staging' });
  assert.equal(none.domain, '');
  assert.equal(none.source, '');
  assert.deepEqual(none.checked, [
    'environments.staging.accessUrl',
    'environments.staging.deployUrl',
    'backend.primaryDomain',
    'backend.domain',
  ]);
  // A present-but-invalid higher-precedence source fails instead of falling
  // through to a domain nobody authored for this application.
  assert.throws(
    () => resolvePrimaryDomain({
      entry: {
        environments: { development: { accessUrl: 'not a url' } },
        backendDomain: 'domain.sdkwork.test',
      },
      environment: 'development',
    }),
    (error) => error instanceof RegistrationConfigurationError
      && /environments\.development\.accessUrl/u.test(error.message),
  );
});

test('the environment upsert key is deterministic per installation row', () => {
  const first = environmentUpsertIdempotencyKey('100001', 'ta-1', 'development');
  assert.equal(first, environmentUpsertIdempotencyKey('100001', 'ta-1', 'development'));
  assert.notEqual(first, environmentUpsertIdempotencyKey('100001', 'ta-1', 'production'));
  assert.notEqual(first, environmentUpsertIdempotencyKey('100001', 'ta-2', 'development'));
  const longKey = environmentUpsertIdempotencyKey('100001', 'x'.repeat(200), 'development');
  assert.ok(longKey.length <= DEPLOY_IDEMPOTENCY_KEY_MAX_LEN, `key too long: ${longKey.length}`);
  assert.equal(longKey, environmentUpsertIdempotencyKey('100001', 'x'.repeat(200), 'development'));
});

