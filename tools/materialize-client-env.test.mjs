import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CLIENT_ENV_PROFILE_IDS,
  applyViteSurfaceCloudValues,
  createClientSurfaceValues,
  materializeClientEnv,
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

test('vite cloud dev surface normalizes every URL key to the deployed domain edges', () => {
  const options = { origins: ['https://api-dev.sdkwork.com', 'https://api-dev.birdcoder.com'] };
  const values = applyViteSurfaceCloudValues(
    {
      VITE_SDKWORK_CLOUDROUTER_ROUTER_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-dev.sdkwork.com;https://api-dev.birdcoder.com',
      VITE_SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_HTTP_URL: 'http://router-dev.sdkwork.com:3905',
      VITE_SDKWORK_DRIVE_BACKEND_API_BASE_URL: 'https://drive-dev.sdkwork.com;https://drive-dev.birdcoder.com',
      VITE_SDKWORK_IM_APPLICATION_PUBLIC_WEBSOCKET_URL: 'ws://api-dev.sdkwork.com',
      VITE_SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL: 'http://127.0.0.1:3900',
    },
    {},
    { deploymentProfile: 'cloud', environment: 'development', profileId: 'cloud.development' },
    options,
  );
  // Gateway-attached keys ride the primary api-* edge, scheme-matched to the
  // plain-HTTP development edge (no ports, no local gateway in the build surface).
  assert.equal(values.VITE_SDKWORK_CLOUDROUTER_ROUTER_PLATFORM_API_GATEWAY_HTTP_URL, 'http://api-dev.sdkwork.com');
  assert.equal(values.VITE_SDKWORK_DRIVE_BACKEND_API_BASE_URL, 'http://api-dev.sdkwork.com');
  // Application public keys keep their own edge host and carry no dev port.
  assert.equal(values.VITE_SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_HTTP_URL, 'http://router-dev.sdkwork.com');
  // Realtime WebSocket rides the api-* edge with ws:// for the HTTP dev edge.
  assert.equal(values.VITE_SDKWORK_IM_APPLICATION_PUBLIC_WEBSOCKET_URL, 'ws://api-dev.sdkwork.com');
  // The local gateway override never leaks into the build surface.
  assert.equal(values.VITE_SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL, undefined);
});

test('vite cloud dev surface does not emit the local gateway anchor', () => {
  const values = applyViteSurfaceCloudValues(
    {
      VITE_SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-dev.sdkwork.com',
      VITE_SDKWORK_DRIVE_APP_API_BASE_URL: 'https://api-dev.sdkwork.com',
    },
    {
      SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-dev.sdkwork.com',
      SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL: 'http://127.0.0.1:3900',
    },
    { deploymentProfile: 'cloud', environment: 'development', profileId: 'cloud.development' },
    { origins: ['https://api-dev.sdkwork.com'] },
  );
  assert.equal(values.VITE_SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL, 'http://api-dev.sdkwork.com');
  assert.equal(values.VITE_SDKWORK_DRIVE_APP_API_BASE_URL, 'http://api-dev.sdkwork.com');
  // Dev-process binding is injected by `sdkwork-app dev` (process env
  // precedence over .env files), never baked into the shared dotenv surface.
  assert.equal(values.VITE_SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL, undefined);
});

test('vite cloud TLS environments normalize to https edges and wss websocket', () => {
  const values = applyViteSurfaceCloudValues(
    {
      VITE_SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-test.sdkwork.com',
      VITE_SDKWORK_IM_APPLICATION_PUBLIC_WEBSOCKET_URL: 'wss://api-test.sdkwork.com',
      VITE_SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_HTTP_URL: 'https://router-test.sdkwork.com',
    },
    {},
    { deploymentProfile: 'cloud', environment: 'test', profileId: 'cloud.test' },
    { origins: ['https://api-test.sdkwork.com'] },
  );
  assert.equal(values.VITE_SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL, 'https://api-test.sdkwork.com');
  assert.equal(values.VITE_SDKWORK_IM_APPLICATION_PUBLIC_WEBSOCKET_URL, 'wss://api-test.sdkwork.com');
  assert.equal(values.VITE_SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_HTTP_URL, 'https://router-test.sdkwork.com');
});

test('vite cloud higher-environment surface folds to the primary single origin', () => {
  const values = applyViteSurfaceCloudValues(
    {
      VITE_SDKWORK_CLOUDROUTER_ROUTER_PLATFORM_API_GATEWAY_HTTP_URL: 'https://api-test.sdkwork.com;https://api-test.birdcoder.com',
    },
    {},
    { deploymentProfile: 'cloud', environment: 'test', profileId: 'cloud.test' },
    { origins: ['https://api-test.sdkwork.com'] },
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

function writeFixture(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

function createOverlayRoot(overlay = '') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-client-env-overlay-'));
  writeFixture(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    profiles: {
      'standalone.development': { config: 'topology/standalone.development.env' },
    },
  }, null, 2));
  writeFixture(root, 'etc/topology/standalone.development.env', [
    'SDKWORK_IM_DEPLOYMENT_PROFILE=standalone',
    'SDKWORK_IM_ENVIRONMENT=development',
    'SDKWORK_IM_PROFILE_ID=standalone.development',
    'SDKWORK_DEMO_HTTP_URL=http://127.0.0.1:10240',
    '',
  ].join('\n'));
  writeFixture(root, 'etc/client-env.materialization.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.client-env-materialization',
    command: 'materialize',
    sourceIdentity: {
      deploymentProfileKeys: ['SDKWORK_IM_DEPLOYMENT_PROFILE'],
      environmentKeys: ['SDKWORK_IM_ENVIRONMENT'],
      profileIdKeys: ['SDKWORK_IM_PROFILE_ID'],
    },
    profiles: ['standalone.development'],
    surfaces: [{
      id: 'demo-app',
      root: 'apps/demo',
      format: 'mini-program',
      runtimeTarget: 'mini-program',
      identityPrefixes: ['SDKWORK_DEMO'],
      accessToken: {
        appId: 'demo-app',
        tenantId: '100001',
        organizationId: '0',
        permissionScope: ['iam:self'],
      },
      bindings: {
        SDKWORK_DEMO_HTTP_URL: ['SDKWORK_DEMO_HTTP_URL'],
      },
    }],
  }, null, 2));
  if (overlay) {
    writeFixture(root, 'apps/demo/etc/env.base.env', overlay);
  }
  return root;
}

function readOverlayOutput(root) {
  return JSON.parse(readFileSync(
    path.join(root, 'apps', 'demo', 'config', 'mini-program', 'runtime-env.standalone.development.json'),
    'utf8',
  ));
}

test('applies an application env overlay after the repository topology', () => {
  const root = createOverlayRoot('SDKWORK_DEMO_HTTP_URL=https://overlay.example.com\n');
  try {
    materializeClientEnv({ rootDir: root });
    const values = readOverlayOutput(root);
    assert.equal(values.SDKWORK_DEMO_HTTP_URL, 'https://overlay.example.com');
    assert.equal(values.SDKWORK_ACCESS_TOKEN.split('.').length, 3);
    assert.equal(values.SDKWORK_DEMO_PROFILE_ID, 'standalone.development');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('app overlay cannot define the generated access token', () => {
  const root = createOverlayRoot('SDKWORK_ACCESS_TOKEN=hand-written\n');
  try {
    assert.throws(
      () => materializeClientEnv({ rootDir: root }),
      /must not define SDKWORK_ACCESS_TOKEN/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('check mode detects a stale app overlay output', () => {
  const root = createOverlayRoot();
  try {
    materializeClientEnv({ rootDir: root });
    writeFixture(
      root,
      'apps/demo/config/mini-program/runtime-env.standalone.development.json',
      '{"stale":true}\n',
    );
    assert.throws(
      () => materializeClientEnv({ rootDir: root, check: true }),
      /is missing or stale/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
