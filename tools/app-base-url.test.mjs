import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APP_SAME_ORIGIN_BASE,
  baseUrlsMaterializationValue,
  primaryOriginFromEnvValue,
  readLocalPlatformApiGatewayHttpUrl,
  resolveBaseUrl,
  selectBaseUrlForPageHost,
  serializeBaseUrls,
  splitBaseUrls,
} from './app-base-url.mjs';

test('lifecycle matrix: standalone dev browser document is same-origin relative', () => {
  const dev = resolveBaseUrl({
    deploymentProfile: 'standalone',
    environment: 'development',
    phase: 'dev',
  });
  assert.equal(dev.browserOriginMode, 'same-origin');
  assert.equal(dev.sameOrigin, true);
  assert.equal(dev.primaryBaseUrl, '/');
  assert.deepEqual(dev.baseUrls, ['/']);
  assert.equal(dev.reason, 'standalone-dev-same-origin');
  assert.equal(dev.profileId, 'standalone.development');
});

test('lifecycle matrix: standalone build browser document is same-origin relative for every environment', () => {
  for (const environment of ['development', 'test', 'staging', 'demo', 'production']) {
    const built = resolveBaseUrl({
      deploymentProfile: 'standalone',
      environment,
      phase: 'build',
    });
    assert.equal(built.browserOriginMode, 'same-origin');
    assert.equal(built.primaryBaseUrl, '/');
    assert.equal(built.reason, 'standalone-build-same-origin');
  }
});

test('lifecycle matrix: standalone transport resolves the serving application edge domain', () => {
  const built = resolveBaseUrl({
    deploymentProfile: 'standalone',
    environment: 'development',
    phase: 'build',
    surface: 'transport',
    applicationPublicHttpUrl: 'https://im-dev.sdkwork.com',
  });
  assert.equal(built.sameOrigin, true);
  assert.equal(built.primaryBaseUrl, 'https://im-dev.sdkwork.com');
  assert.equal(built.reason, 'standalone-build-page-origin');
});

test('standalone transport without an application edge fails closed', () => {
  assert.throws(
    () => resolveBaseUrl({
      deploymentProfile: 'standalone',
      environment: 'production',
      phase: 'build',
      surface: 'transport',
    }),
    /applicationPublicHttpUrl/u,
  );
});

test('standalone dev transport allows the ip+port dev ingress; build rejects it', () => {
  const dev = resolveBaseUrl({
    deploymentProfile: 'standalone',
    environment: 'development',
    phase: 'dev',
    surface: 'transport',
    applicationPublicHttpUrl: 'http://127.0.0.1:4734',
  });
  assert.equal(dev.primaryBaseUrl, 'http://127.0.0.1:4734');
  assert.equal(dev.reason, 'standalone-dev-page-origin');

  assert.throws(
    () => resolveBaseUrl({
      deploymentProfile: 'standalone',
      environment: 'development',
      phase: 'build',
      surface: 'transport',
      applicationPublicHttpUrl: 'http://127.0.0.1:4734',
    }),
    /without a port/u,
  );
  assert.throws(
    () => resolveBaseUrl({
      deploymentProfile: 'standalone',
      environment: 'development',
      phase: 'build',
      surface: 'transport',
      applicationPublicHttpUrl: 'http://im-dev.sdkwork.com',
    }),
    /HTTPS application edge domain/u,
  );
});

test('standalone transport rejects port-bearing and non-http edges', () => {
  assert.throws(
    () => resolveBaseUrl({
      deploymentProfile: 'standalone',
      environment: 'production',
      phase: 'build',
      surface: 'transport',
      applicationPublicHttpUrl: 'https://im.sdkwork.com:3905',
    }),
    /without a port/u,
  );
  assert.throws(
    () => resolveBaseUrl({
      deploymentProfile: 'standalone',
      environment: 'production',
      phase: 'build',
      surface: 'transport',
      applicationPublicHttpUrl: 'ftp://im.sdkwork.com',
    }),
    /HTTP\(S\)/u,
  );
});

test('lifecycle matrix: cloud dev browser document keeps the same-origin shape', () => {
  const dev = resolveBaseUrl({
    deploymentProfile: 'cloud',
    environment: 'development',
    phase: 'dev',
  });
  assert.equal(dev.browserOriginMode, 'same-origin');
  assert.equal(dev.primaryBaseUrl, '/');
  assert.equal(dev.reason, 'cloud-dev-same-origin-document');
});

test('lifecycle matrix: cloud dev transport resolves the local platform gateway ip+port', () => {
  const dev = resolveBaseUrl({
    deploymentProfile: 'cloud',
    environment: 'development',
    phase: 'dev',
    surface: 'transport',
    localPlatformApiGatewayHttpUrl: 'http://127.0.0.1:3900',
  });
  assert.equal(dev.browserOriginMode, 'cross-origin');
  assert.equal(dev.sameOrigin, false);
  assert.equal(dev.primaryBaseUrl, 'http://127.0.0.1:3900');
  assert.equal(dev.reason, 'cloud-dev-local-gateway');
});

test('cloud dev transport fails closed without the local gateway binding', () => {
  assert.throws(
    () => resolveBaseUrl({
      deploymentProfile: 'cloud',
      environment: 'development',
      phase: 'dev',
      surface: 'transport',
    }),
    /SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL/u,
  );
});

test('lifecycle matrix: cloud build resolves the registered multi-domain api family', () => {
  const family = [
    'https://api-dev.sdkwork.com',
    'https://api-dev.birdcoder.com',
    'https://api-dev.sdkwork.cn',
  ];
  const built = resolveBaseUrl({
    deploymentProfile: 'cloud',
    environment: 'development',
    phase: 'build',
    cloudApiBaseUrls: family.join(';'),
  });
  assert.equal(built.browserOriginMode, 'cross-origin');
  assert.equal(built.sameOrigin, false);
  assert.equal(built.primaryBaseUrl, 'https://api-dev.sdkwork.com');
  assert.deepEqual(built.baseUrls, family);
  assert.equal(
    built.materialized,
    'https://api-dev.sdkwork.com;https://api-dev.birdcoder.com;https://api-dev.sdkwork.cn',
  );
  assert.equal(built.reason, 'cloud-build-domain-family');
});

test('cloud build accepts an explicit comma-separated list and single-origin family', () => {
  const comma = resolveBaseUrl({
    deploymentProfile: 'cloud',
    environment: 'production',
    phase: 'build',
    cloudApiBaseUrls: 'https://api.example.com, https://api.example.cn',
  });
  assert.deepEqual(comma.baseUrls, ['https://api.example.com', 'https://api.example.cn']);

  const single = resolveBaseUrl({
    deploymentProfile: 'cloud',
    environment: 'production',
    phase: 'build',
    cloudApiBaseUrls: 'https://api.example.com',
  });
  assert.equal(single.materialized, 'https://api.example.com');
  assert.deepEqual(single.baseUrls, ['https://api.example.com']);
});

test('cloud build without candidates or repository root fails closed', () => {
  assert.throws(
    () => resolveBaseUrl({
      deploymentProfile: 'cloud',
      environment: 'production',
      phase: 'build',
    }),
    /cloudApiBaseUrls or repositoryRoot/u,
  );
});

test('cloud build derives the family from the repository deployment config', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const specsToolsRoot = path.dirname(fileURLToPath(import.meta.url));
  const cloudrouterRoot = path.resolve(specsToolsRoot, '..', '..', 'sdkwork-cloudrouter');
  const deploymentPath = path.join(cloudrouterRoot, 'etc', 'sdkwork.deployment.config.json');
  if (!existsSync(deploymentPath)) {
    // The family-derivation path is covered by browser-cloud-api-base.test.mjs;
    // this convergence test only applies when the sibling checkout exists.
    return;
  }
  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8'));
  const built = resolveBaseUrl({
    deploymentProfile: 'cloud',
    environment: 'production',
    phase: 'build',
    repositoryRoot: cloudrouterRoot,
    deployment,
  });
  assert.equal(built.primaryBaseUrl, 'https://api.sdkwork.com');
  assert.ok(built.baseUrls.length >= 2);
});

test('matrix vocabulary is enforced', () => {
  assert.throws(
    () => resolveBaseUrl({ deploymentProfile: 'hybrid', environment: 'development', phase: 'dev' }),
    /deploymentProfile/u,
  );
  assert.throws(
    () => resolveBaseUrl({ deploymentProfile: 'standalone', environment: 'beta', phase: 'dev' }),
    /environment/u,
  );
  assert.throws(
    () => resolveBaseUrl({ deploymentProfile: 'standalone', environment: 'development', phase: 'preview' }),
    /phase/u,
  );
  assert.throws(
    () => resolveBaseUrl({
      deploymentProfile: 'standalone',
      environment: 'development',
      phase: 'dev',
      surface: 'native',
    }),
    /surface/u,
  );
});

test('splitBaseUrls and serializeBaseUrls round-trip the multi-domain family', () => {
  assert.deepEqual(
    splitBaseUrls('https://a.example.com; https://b.example.com,https://c.example.com'),
    ['https://a.example.com', 'https://b.example.com', 'https://c.example.com'],
  );
  assert.deepEqual(
    splitBaseUrls(['https://a.example.com', 'https://b.example.com']),
    ['https://a.example.com', 'https://b.example.com'],
  );
  assert.equal(serializeBaseUrls(['https://a.example.com']), 'https://a.example.com');
  assert.equal(
    serializeBaseUrls(['https://a.example.com', 'https://b.example.com']),
    'https://a.example.com;https://b.example.com',
  );
});

test('selectBaseUrlForPageHost maps module hosts onto their environment gateway', () => {
  const family = 'https://api.sdkwork.com;https://api-dev.sdkwork.com;https://api.sdkwork.cn;https://api-dev.sdkwork.cn';
  assert.deepEqual(
    selectBaseUrlForPageHost(family, {
      pageHost: 'im-dev.sdkwork.com',
      environment: 'development',
      deploymentProfile: 'cloud',
    }),
    { originMode: 'cross-origin', url: 'https://api-dev.sdkwork.com', reason: 'cloud-gateway-host-match' },
  );
  assert.deepEqual(
    selectBaseUrlForPageHost(family, {
      pageHost: 'im.sdkwork.cn',
      environment: 'production',
      deploymentProfile: 'cloud',
    }),
    { originMode: 'cross-origin', url: 'https://api.sdkwork.cn', reason: 'cloud-gateway-host-match' },
  );
});

test('selectBaseUrlForPageHost standalone is the page origin itself', () => {
  assert.deepEqual(
    selectBaseUrlForPageHost('/', {
      pageHost: 'im-dev.sdkwork.com',
      environment: 'development',
      deploymentProfile: 'standalone',
    }),
    { originMode: 'same-origin', url: 'https://im-dev.sdkwork.com', reason: 'standalone-page-origin' },
  );
  assert.deepEqual(
    selectBaseUrlForPageHost('/', {
      pageHost: '127.0.0.1:4178',
      environment: 'development',
      deploymentProfile: 'standalone',
    }),
    { originMode: 'same-origin', url: 'https://127.0.0.1:4178', reason: 'standalone-page-origin' },
  );
  assert.equal(
    selectBaseUrlForPageHost('/', { deploymentProfile: 'standalone', environment: 'development' }).url,
    '',
  );
});

test('cloud selection falls back to the first candidate without a page host', () => {
  assert.deepEqual(
    selectBaseUrlForPageHost('https://api.sdkwork.com;https://api-dev.sdkwork.com', {
      environment: 'production',
      deploymentProfile: 'cloud',
    }),
    { originMode: 'cross-origin', url: 'https://api.sdkwork.com', reason: 'cloud-gateway-host-match' },
  );
});

test('baseUrlsMaterializationValue pins the per-surface materialization shape', () => {
  const standaloneDoc = resolveBaseUrl({
    deploymentProfile: 'standalone',
    environment: 'development',
    phase: 'dev',
  });
  assert.equal(baseUrlsMaterializationValue(standaloneDoc), APP_SAME_ORIGIN_BASE);

  const standaloneTransport = resolveBaseUrl({
    deploymentProfile: 'standalone',
    environment: 'development',
    phase: 'build',
    surface: 'transport',
    applicationPublicHttpUrl: 'https://im-dev.sdkwork.com',
  });
  assert.equal(baseUrlsMaterializationValue(standaloneTransport), 'https://im-dev.sdkwork.com');

  const cloudFamily = resolveBaseUrl({
    deploymentProfile: 'cloud',
    environment: 'development',
    phase: 'build',
    cloudApiBaseUrls: 'https://api-dev.sdkwork.com;https://api-dev.birdcoder.com',
  });
  assert.equal(
    baseUrlsMaterializationValue(cloudFamily),
    'https://api-dev.sdkwork.com;https://api-dev.birdcoder.com',
  );

  // Cloud build materializes the FULL family in both surfaces: transport
  // runtimes (mini-program/Flutter/desktop) keep the candidate list so shared
  // resolvers auto-select the page's same-brand gateway.
  const cloudTransport = resolveBaseUrl({
    deploymentProfile: 'cloud',
    environment: 'production',
    phase: 'build',
    surface: 'transport',
    cloudApiBaseUrls: 'https://api.sdkwork.com;https://api.birdcoder.com',
  });
  assert.equal(
    baseUrlsMaterializationValue(cloudTransport),
    'https://api.sdkwork.com;https://api.birdcoder.com',
  );
});

test('convergence: the dev document builder agrees with the matrix for every profile id', async () => {
  const { buildBrowserDevRuntimeEnvDocument, BROWSER_SAME_ORIGIN_API_BASES } =
    await import('./browser-runtime-env.mjs');
  for (const deploymentProfile of ['standalone', 'cloud']) {
    for (const environment of ['development', 'test', 'staging', 'demo', 'production']) {
      const document = buildBrowserDevRuntimeEnvDocument({ profileId: `${deploymentProfile}.${environment}` });
      const resolution = resolveBaseUrl({
        deploymentProfile,
        environment,
        phase: 'dev',
        surface: 'browser-document',
      });
      assert.equal(document.browserOriginMode, resolution.browserOriginMode, `${deploymentProfile}.${environment}`);
      assert.equal(document.appApiBaseUrl, BROWSER_SAME_ORIGIN_API_BASES.appApi);
      assert.equal(document.backendApiBaseUrl, BROWSER_SAME_ORIGIN_API_BASES.backendApi);
      assert.equal(document.openApiBaseUrl, BROWSER_SAME_ORIGIN_API_BASES.openApi);
      assert.equal(resolution.sameOrigin, true);
      assert.equal(resolution.primaryBaseUrl, '/');
    }
  }
});

test('convergence: cloud build family matches the browser-cloud-api-base derivation', async () => {
  const { cloudSdkBaseUrlMaterializationValue } = await import('./browser-cloud-api-base.mjs');
  const family = resolveBaseUrl({
    deploymentProfile: 'cloud',
    environment: 'staging',
    phase: 'build',
    cloudApiBaseUrls: 'https://api-staging.sdkwork.com;https://api-staging.sdkwork.cn',
  });
  assert.equal(
    baseUrlsMaterializationValue(family),
    cloudSdkBaseUrlMaterializationValue(family.baseUrls),
  );
});

test('env helpers read the local gateway binding and fold multi-origin lists', () => {
  assert.equal(
    readLocalPlatformApiGatewayHttpUrl({ SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL: ' http://127.0.0.1:3900 ' }),
    'http://127.0.0.1:3900',
  );
  assert.equal(readLocalPlatformApiGatewayHttpUrl({}), undefined);
  assert.equal(
    primaryOriginFromEnvValue('https://router-dev.sdkwork.com;https://router-dev.birdcoder.com'),
    'https://router-dev.sdkwork.com',
  );
  assert.equal(primaryOriginFromEnvValue('  '), undefined);
});
