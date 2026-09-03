import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLIENT_ENV_PROFILE_IDS,
  applyViteSurfaceCloudValues,
  createClientSurfaceValues,
  parseClientEnvDotenv,
} from './materialize-client-env.mjs';

test('canonical client profile matrix contains both deployment profiles and five environments', () => {
  assert.deepEqual(CLIENT_ENV_PROFILE_IDS, [
    'standalone.development',
    'standalone.test',
    'standalone.staging',
    'standalone.demo',
    'standalone.production',
    'cloud.development',
    'cloud.test',
    'cloud.staging',
    'cloud.demo',
    'cloud.production',
  ]);
});

test('vite cloud dev surface binds gateway and application URLs to the local gateway', () => {
  const sourceValues = {
    SDKWORK_CLOUDROUTER_ROUTER_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-dev.sdkwork.com',
    SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_HTTP_URL: 'http://router-dev.sdkwork.com:3905',
    SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL: 'http://127.0.0.1:3900',
  };
  const values = applyViteSurfaceCloudValues(
    {
      VITE_SDKWORK_CLOUDROUTER_ROUTER_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-dev.sdkwork.com;https://api-dev.birdcoder.com',
      VITE_SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_HTTP_URL: 'http://router-dev.sdkwork.com:3905',
      VITE_SDKWORK_DRIVE_BACKEND_API_BASE_URL: 'https://drive-dev.sdkwork.com;https://drive-dev.birdcoder.com',
    },
    sourceValues,
    { deploymentProfile: 'cloud', environment: 'development', profileId: 'cloud.development' },
  );
  assert.equal(values.VITE_SDKWORK_CLOUDROUTER_ROUTER_PLATFORM_API_GATEWAY_HTTP_URL, 'http://127.0.0.1:3900');
  assert.equal(values.VITE_SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_HTTP_URL, 'http://127.0.0.1:3900');
  // Dependency surface (drive) has its own edge host: it is not gateway-attached,
  // so it keeps a single-origin remote value and never receives the local bind.
  assert.equal(values.VITE_SDKWORK_DRIVE_BACKEND_API_BASE_URL, 'https://drive-dev.sdkwork.com');
});

test('vite cloud dev surface rewrites gateway-attached SDK base URLs on the gateway host', () => {
  const values = applyViteSurfaceCloudValues(
    {
      VITE_SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-dev.sdkwork.com',
      VITE_SDKWORK_DRIVE_APP_API_BASE_URL: 'https://api-dev.sdkwork.com',
      VITE_SDKWORK_AGENTS_APP_API_BASE_URL: 'https://agents-dev.sdkwork.com',
    },
    {
      SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-dev.sdkwork.com',
      SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL: 'http://127.0.0.1:3900',
    },
    { deploymentProfile: 'cloud', environment: 'development', profileId: 'cloud.development' },
  );
  assert.equal(values.VITE_SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL, 'http://127.0.0.1:3900');
  // Same-host as the deployed gateway: gateway-attached, binds local.
  assert.equal(values.VITE_SDKWORK_DRIVE_APP_API_BASE_URL, 'http://127.0.0.1:3900');
  // Separate service edge host: stays remote.
  assert.equal(values.VITE_SDKWORK_AGENTS_APP_API_BASE_URL, 'https://agents-dev.sdkwork.com');
  // Browser-visible anchor for frontend SDK integrations (SDK_SPEC section 5.1).
  assert.equal(values.VITE_SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL, 'http://127.0.0.1:3900');
});

test('vite cloud higher-environment surface omits the browser local gateway anchor', () => {
  const values = applyViteSurfaceCloudValues(
    { VITE_SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-test.sdkwork.com' },
    {
      SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-test.sdkwork.com',
      SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL: 'http://127.0.0.1:3900',
    },
    { deploymentProfile: 'cloud', environment: 'test', profileId: 'cloud.test' },
  );
  assert.equal(values.VITE_SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL, 'https://api-test.sdkwork.com');
  assert.equal(values.VITE_SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL, undefined);
});

test('vite cloud higher-environment surface folds to the primary single origin', () => {
  const values = applyViteSurfaceCloudValues(
    {
      VITE_SDKWORK_CLOUDROUTER_ROUTER_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-test.sdkwork.com;https://api-test.birdcoder.com',
    },
    {},
    { deploymentProfile: 'cloud', environment: 'test', profileId: 'cloud.test' },
  );
  assert.equal(values.VITE_SDKWORK_CLOUDROUTER_ROUTER_PLATFORM_API_GATEWAY_HTTP_URL, 'https://api-test.sdkwork.com');
});

test('vite standalone surface is untouched by cloud value projection', () => {
  const values = applyViteSurfaceCloudValues(
    { VITE_SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_HTTP_URL: 'http://127.0.0.1:3905' },
    {},
    { deploymentProfile: 'standalone', environment: 'development', profileId: 'standalone.development' },
  );
  assert.equal(values.VITE_SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_HTTP_URL, 'http://127.0.0.1:3905');
});

test('vite projection emits generic and application-scoped identity', () => {
  const values = createClientSurfaceValues({
    surface: {
      id: 'demo-pc',
      format: 'vite',
      runtimeTarget: 'browser',
      identityPrefixes: ['VITE_SDKWORK_DEMO'],
      bindings: {
        VITE_SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL: 'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL',
      },
    },
    sourceValues: {
      SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL: 'https://demo-dev.example.com',
    },
    profile: {
      deploymentProfile: 'cloud',
      environment: 'development',
      profileId: 'cloud.development',
    },
  });
  assert.equal(values.VITE_SDKWORK_PROFILE_ID, 'cloud.development');
  assert.equal(values.VITE_SDKWORK_DEMO_PROFILE_ID, 'cloud.development');
  assert.equal(values.VITE_SDKWORK_RUNTIME_TARGET, 'browser');
});

test('client projection rejects secrets and cloud loopback URLs', () => {
  assert.throws(
    () => createClientSurfaceValues({
      surface: {
        id: 'demo-pc',
        format: 'vite',
        runtimeTarget: 'browser',
        includeKeys: ['VITE_SDKWORK_ACCESS_TOKEN'],
      },
      sourceValues: { VITE_SDKWORK_ACCESS_TOKEN: 'secret' },
      profile: {
        deploymentProfile: 'standalone',
        environment: 'development',
        profileId: 'standalone.development',
      },
    }),
    /secret-bearing key/u,
  );
  assert.throws(
    () => createClientSurfaceValues({
      surface: {
        id: 'demo-flutter',
        format: 'flutter',
        runtimeTarget: 'flutter-android',
        bindings: {
          SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL: 'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL',
        },
      },
      sourceValues: { SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL: 'http://127.0.0.1:8080' },
      profile: {
        deploymentProfile: 'cloud',
        environment: 'test',
        profileId: 'cloud.test',
      },
    }),
    /remote public host|explicit remote HTTPS\/WSS URL/u,
  );
});

test('dotenv parser preserves URL values and ignores comments', () => {
  assert.deepEqual(
    parseClientEnvDotenv('# demo\nSDKWORK_PROFILE_ID=cloud.production\nURL=https://example.com/a?b=c\n'),
    {
      SDKWORK_PROFILE_ID: 'cloud.production',
      URL: 'https://example.com/a?b=c',
    },
  );
});
