import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLIENT_ENV_PROFILE_IDS,
  createClientSurfaceValues,
  parseClientEnvDotenv,
} from './materialize-client-env.mjs';

test('canonical client profile matrix contains both deployment profiles and four environments', () => {
  assert.deepEqual(CLIENT_ENV_PROFILE_IDS, [
    'standalone.development',
    'standalone.test',
    'standalone.staging',
    'standalone.production',
    'cloud.development',
    'cloud.test',
    'cloud.staging',
    'cloud.production',
  ]);
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
