import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  CLIENT_ENV_PROFILE_IDS,
  applyViteSurfaceCloudValues,
  createClientSurfaceValues,
  filterClientEnvProfileIds,
  filterClientEnvSurfaces,
  materializeClientEnv,
  parseClientEnvArgs,
  parseClientEnvDotenv,
  surfaceAnchorEnvironment,
  surfaceAnchorEnvNames,
} from './materialize-client-env.mjs';
import { decodeApplicationAccessToken } from './app-access-token.mjs';

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

function accessTokenSurface(appIdInput) {
  return {
    id: 'demo-app',
    format: 'mini-program',
    runtimeTarget: 'mini-program',
    accessToken: {
      ...appIdInput,
      tenantId: '100001',
      organizationId: '0',
      permissionScope: ['iam:self'],
    },
  };
}

const CLOUD_PRODUCTION_PROFILE = Object.freeze({
  deploymentProfile: 'cloud',
  environment: 'production',
  profileId: 'cloud.production',
});

test('env-sourced appId reads the deployment anchor instead of a literal id', () => {
  const values = createClientSurfaceValues({
    surface: accessTokenSurface({ appIdEnv: 'SDKWORK_DEPLOY_APPLICATION_ID' }),
    sourceValues: {},
    profile: CLOUD_PRODUCTION_PROFILE,
    env: { SDKWORK_DEPLOY_APPLICATION_ID: ' app-anchor-1 ' },
  });
  const { payload } = decodeApplicationAccessToken(values.SDKWORK_ACCESS_TOKEN);
  assert.equal(payload.app_id, 'app-anchor-1');
  assert.equal(payload.aud, 'app-anchor-1');
});

test('an inline ${ENV_VAR} placeholder is an equivalent env source', () => {
  const values = createClientSurfaceValues({
    surface: accessTokenSurface({ appId: '${SDKWORK_DEPLOY_APPLICATION_ID}' }),
    sourceValues: {},
    profile: CLOUD_PRODUCTION_PROFILE,
    env: { SDKWORK_DEPLOY_APPLICATION_ID: 'app-anchor-2' },
  });
  const { payload } = decodeApplicationAccessToken(values.SDKWORK_ACCESS_TOKEN);
  assert.equal(payload.app_id, 'app-anchor-2');
  assert.equal(payload.aud, 'app-anchor-2');
});

test('env-sourced appId fails and names the variable when the anchor is unavailable', () => {
  for (const env of [{}, { SDKWORK_DEPLOY_APPLICATION_ID: '' }, { SDKWORK_DEPLOY_APPLICATION_ID: '   ' }]) {
    assert.throws(
      () => createClientSurfaceValues({
        surface: accessTokenSurface({ appIdEnv: 'SDKWORK_DEPLOY_APPLICATION_ID' }),
        sourceValues: {},
        profile: CLOUD_PRODUCTION_PROFILE,
        env,
      }),
      /SDKWORK_DEPLOY_APPLICATION_ID is not set/u,
    );
  }
});

test('accessToken rejects declaring both a literal appId and an appIdEnv source', () => {
  assert.throws(
    () => createClientSurfaceValues({
      surface: accessTokenSurface({
        appId: 'sdkwork-cloudrouter',
        appIdEnv: 'SDKWORK_DEPLOY_APPLICATION_ID',
      }),
      sourceValues: {},
      profile: CLOUD_PRODUCTION_PROFILE,
      env: { SDKWORK_DEPLOY_APPLICATION_ID: 'app-anchor-1' },
    }),
    /either appIdEnv or appId, not both/u,
  );
});

test('client projection rejects secrets and cloud loopback URLs', () => {  assert.throws(
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
    assert.equal(decodeApplicationAccessToken(values.SDKWORK_ACCESS_TOKEN).payload.app_id, 'demo-app');
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

test('the lifecycle filter keeps both deployment profiles of one environment', () => {
  assert.deepEqual(
    filterClientEnvProfileIds(CLIENT_ENV_PROFILE_IDS, ['development']),
    ['standalone.development', 'cloud.development'],
  );
  assert.deepEqual(
    filterClientEnvProfileIds(CLIENT_ENV_PROFILE_IDS, ['prod']),
    ['standalone.production', 'cloud.production'],
  );
  assert.deepEqual(
    filterClientEnvProfileIds(CLIENT_ENV_PROFILE_IDS, ['development', 'production']),
    ['standalone.development', 'standalone.production', 'cloud.development', 'cloud.production'],
  );
  assert.deepEqual(
    filterClientEnvProfileIds(CLIENT_ENV_PROFILE_IDS, []),
    CLIENT_ENV_PROFILE_IDS,
    'no filter means the full matrix',
  );
  assert.throws(() => filterClientEnvProfileIds(CLIENT_ENV_PROFILE_IDS, ['qa']), /not a lifecycle/u);
});

test('the CLI accepts --environment as a repeatable or comma-separated filter', () => {
  assert.deepEqual(parseClientEnvArgs(['--environment', 'development']).environments, ['development']);
  assert.deepEqual(
    parseClientEnvArgs(['--environment', 'development,production']).environments,
    ['development', 'production'],
  );
  assert.deepEqual(
    parseClientEnvArgs(['--environment', 'development', '--environment', 'test']).environments,
    ['development', 'test'],
  );
  assert.throws(() => parseClientEnvArgs(['--unknown']), /Unsupported/u);
});

test('the CLI accepts --surface as a repeatable or comma-separated filter', () => {
  assert.deepEqual(parseClientEnvArgs([]).surfaces, [], 'no filter means every surface');
  assert.deepEqual(parseClientEnvArgs(['--surface', 'demo-pc']).surfaces, ['demo-pc']);
  assert.deepEqual(
    parseClientEnvArgs(['--surface', 'demo-pc,demo-h5']).surfaces,
    ['demo-pc', 'demo-h5'],
  );
  assert.deepEqual(
    parseClientEnvArgs([
      '--surface', 'demo-pc',
      '--surface', 'demo-h5',
      '--environment', 'development',
    ]),
    {
      root: process.cwd(),
      config: 'etc/client-env.materialization.json',
      check: false,
      environments: ['development'],
      surfaces: ['demo-pc', 'demo-h5'],
    },
  );
  assert.throws(() => parseClientEnvArgs(['--surface']), /requires a value/u);
});

function createSurfaceFilterRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-client-env-surfaces-'));
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
    'SDKWORK_DEPLOY_APPLICATION_ID=1001',
    '',
  ].join('\n'));
  writeFixture(root, 'etc/client-env.materialization.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.client-env-materialization',
    command: 'materialize',
    profiles: ['standalone.development'],
    sourceIdentity: {
      deploymentProfileKeys: ['SDKWORK_IM_DEPLOYMENT_PROFILE'],
      environmentKeys: ['SDKWORK_IM_ENVIRONMENT'],
      profileIdKeys: ['SDKWORK_IM_PROFILE_ID'],
    },
    surfaces: [
      {
        id: 'demo-pc',
        root: 'apps/demo-pc',
        format: 'vite',
        runtimeTarget: 'browser',
        identityPrefixes: ['VITE_SDKWORK_DEMO'],
        accessToken: {
          appIdEnv: 'SDKWORK_DEPLOY_APPLICATION_ID',
          tenantId: '100001',
          organizationId: '0',
          permissionScope: ['iam:self'],
        },
        bindings: {
          VITE_SDKWORK_DEMO_HTTP_URL: 'SDKWORK_DEMO_HTTP_URL',
        },
      },
      {
        id: 'demo-flutter',
        root: 'apps/demo-flutter',
        format: 'flutter',
        runtimeTarget: 'flutter-android',
        identityPrefixes: ['SDKWORK_DEMO'],
        accessToken: {
          appIdEnv: 'SDKWORK_DEPLOY_APPLICATION_ID',
          tenantId: '100001',
          organizationId: '0',
          permissionScope: ['iam:self'],
        },
        bindings: {
          SDKWORK_DEMO_HTTP_URL: 'SDKWORK_DEMO_HTTP_URL',
        },
      },
    ],
  }, null, 2));
  return root;
}

function readSurfaceAppId(root, surfaceFile) {
  const filePath = path.join(root, surfaceFile);
  const text = readFileSync(filePath, 'utf8');
  const token = surfaceFile.endsWith('.json')
    ? JSON.parse(text).SDKWORK_ACCESS_TOKEN
    : parseClientEnvDotenv(text).SDKWORK_ACCESS_TOKEN;
  return decodeApplicationAccessToken(token).payload.app_id;
}

test('--surface materializes only the selected surface profile files', () => {
  const root = createSurfaceFilterRoot();
  try {
    const written = materializeClientEnv({
      rootDir: root,
      environments: ['development'],
      surfaces: ['demo-pc'],
      env: { SDKWORK_DEPLOY_APPLICATION_ID: '5001' },
    });
    assert.deepEqual(written.map((file) => path.relative(root, file).replaceAll('\\', '/')), [
      'apps/demo-pc/.env.standalone.development',
    ]);
    assert.equal(readSurfaceAppId(root, 'apps/demo-pc/.env.standalone.development'), '5001');
    assert.equal(
      existsSync(path.join(root, 'apps/demo-flutter/env/sdkwork.standalone.development.json')),
      false,
      'an unselected surface is not written',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a per-surface anchor variable never overwrites another surface carrier', () => {
  const root = createSurfaceFilterRoot();
  try {
    materializeClientEnv({
      rootDir: root,
      environments: ['development'],
      surfaces: ['demo-pc'],
      env: { SDKWORK_DEPLOY_APPLICATION_ID_DEMO_PC: '6001' },
    });
    const before = readFileSync(path.join(root, 'apps/demo-pc/.env.standalone.development'), 'utf8');
    assert.equal(readSurfaceAppId(root, 'apps/demo-pc/.env.standalone.development'), '6001');

    materializeClientEnv({
      rootDir: root,
      environments: ['development'],
      surfaces: ['demo-flutter'],
      // The repository-level variable still names the other surface's anchor;
      // the selected surface takes its own variable, so the first carrier is
      // neither read nor rewritten.
      env: {
        SDKWORK_DEPLOY_APPLICATION_ID: '1001',
        SDKWORK_DEPLOY_APPLICATION_ID_DEMO_FLUTTER: '6002',
      },
    });
    assert.equal(
      readSurfaceAppId(root, 'apps/demo-flutter/env/sdkwork.standalone.development.json'),
      '6002',
    );
    assert.equal(readSurfaceAppId(root, 'apps/demo-pc/.env.standalone.development'), '6001');
    assert.equal(
      readFileSync(path.join(root, 'apps/demo-pc/.env.standalone.development'), 'utf8'),
      before,
      'the other surface carrier is byte-identical after the second run',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the default materialization keeps one repository anchor for every surface', () => {
  const root = createSurfaceFilterRoot();
  try {
    const written = materializeClientEnv({
      rootDir: root,
      environments: ['development'],
      env: { SDKWORK_DEPLOY_APPLICATION_ID: '7001' },
    });
    assert.equal(written.length, 2, 'no --surface filter writes the whole declared matrix');
    assert.equal(readSurfaceAppId(root, 'apps/demo-pc/.env.standalone.development'), '7001');
    assert.equal(
      readSurfaceAppId(root, 'apps/demo-flutter/env/sdkwork.standalone.development.json'),
      '7001',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--surface refuses an undeclared surface id instead of writing nothing', () => {
  const root = createSurfaceFilterRoot();
  try {
    assert.throws(
      () => materializeClientEnv({ rootDir: root, surfaces: ['demo-h5'] }),
      /--surface demo-h5 is not declared .*demo-pc, demo-flutter/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the per-surface anchor variable wins over the repository anchor', () => {
  const surface = {
    id: 'demo-pc',
    format: 'vite',
    runtimeTarget: 'browser',
    accessToken: { appIdEnv: 'SDKWORK_DEPLOY_APPLICATION_ID' },
  };
  assert.deepEqual(surfaceAnchorEnvNames(surface), {
    baseEnvName: 'SDKWORK_DEPLOY_APPLICATION_ID',
    surfaceEnvName: 'SDKWORK_DEPLOY_APPLICATION_ID_DEMO_PC',
  });
  const resolved = surfaceAnchorEnvironment(
    surface,
    {
      SDKWORK_DEPLOY_APPLICATION_ID: '1001',
      SDKWORK_DEPLOY_APPLICATION_ID_DEMO_PC: '2002',
    },
    {},
  );
  assert.equal(resolved.SDKWORK_DEPLOY_APPLICATION_ID, '2002');
  assert.equal(
    surfaceAnchorEnvironment(surface, { SDKWORK_DEPLOY_APPLICATION_ID: '1001' }, {})
      .SDKWORK_DEPLOY_APPLICATION_ID,
    '1001',
    'a surface without its own variable keeps the repository anchor',
  );
});

test('a surface anchor recorded in the resolved profile feeds the token without an exported anchor', () => {
  const root = createSurfaceFilterRoot();
  try {
    // The registration records the surface anchor in the deployment profile; the
    // materializer must then be able to regenerate that surface's token without
    // the variable being exported into the process environment.
    writeFixture(root, 'etc/topology/standalone.development.env', [
      'SDKWORK_IM_DEPLOYMENT_PROFILE=standalone',
      'SDKWORK_IM_ENVIRONMENT=development',
      'SDKWORK_IM_PROFILE_ID=standalone.development',
      'SDKWORK_DEMO_HTTP_URL=http://127.0.0.1:10240',
      'SDKWORK_DEPLOY_APPLICATION_ID=1001',
      'SDKWORK_DEPLOY_APPLICATION_ID_DEMO_PC=8001',
      '',
    ].join('\n'));
    materializeClientEnv({
      rootDir: root,
      environments: ['development'],
      surfaces: ['demo-pc'],
      env: {},
    });
    assert.equal(readSurfaceAppId(root, 'apps/demo-pc/.env.standalone.development'), '8001');
    // The process environment still wins over the recorded value.
    materializeClientEnv({
      rootDir: root,
      environments: ['development'],
      surfaces: ['demo-pc'],
      env: { SDKWORK_DEPLOY_APPLICATION_ID_DEMO_PC: '8002' },
    });
    assert.equal(readSurfaceAppId(root, 'apps/demo-pc/.env.standalone.development'), '8002');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two surface ids deriving one anchor variable are refused', () => {
  const surfaces = [
    {
      id: 'demo-pc',
      format: 'vite',
      runtimeTarget: 'browser',
      accessToken: { appIdEnv: 'SDKWORK_DEPLOY_APPLICATION_ID' },
    },
    {
      id: 'demo_pc',
      format: 'vite',
      runtimeTarget: 'browser',
      accessToken: { appIdEnv: 'SDKWORK_DEPLOY_APPLICATION_ID' },
    },
  ];
  assert.throws(
    () => filterClientEnvSurfaces(surfaces, ['demo-pc']),
    /SDKWORK_DEPLOY_APPLICATION_ID_DEMO_PC would be the anchor variable of demo-pc and demo_pc/u,
  );
});

test('only env-sourced surfaces get a per-surface anchor variable', () => {
  assert.deepEqual(
    surfaceAnchorEnvNames({
      id: 'demo-pc',
      accessToken: { appId: 'sdkwork-demo-pc' },
    }),
    { baseEnvName: '', surfaceEnvName: '' },
    'a literal appId is repository-owned and reads no variable',
  );
  assert.deepEqual(
    surfaceAnchorEnvNames({
      id: 'demo-pc',
      accessToken: { appId: '${SDKWORK_DEPLOY_APPLICATION_ID}' },
    }),
    {
      baseEnvName: 'SDKWORK_DEPLOY_APPLICATION_ID',
      surfaceEnvName: 'SDKWORK_DEPLOY_APPLICATION_ID_DEMO_PC',
    },
    'the inline placeholder form is an equivalent env source',
  );
});

const LANGUAGE_ANCHOR_ENV = 'SDKWORK_DEPLOY_APPLICATION_ID';

const LANGUAGE_PROFILE_FILES = {
  vite: 'apps/pc/.env.standalone.development',
  flutter: 'apps/flutter/env/sdkwork.standalone.development.json',
  'mini-program': 'apps/mp/config/mini-program/runtime-env.standalone.development.json',
  'harmony-native': 'apps/harmony/config/app/runtime-env.standalone.development.json',
};

function createLanguageMatrixRoot(accessToken = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-client-env-languages-'));
  writeFixture(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    profiles: {
      'standalone.development': { config: 'topology/standalone.development.env' },
    },
  }, null, 2));
  writeFixture(root, 'etc/topology/standalone.development.env', [
    'SDKWORK_IM_DEPLOYMENT_PROFILE=standalone',
    'SDKWORK_IM_ENVIRONMENT=development',
    'SDKWORK_IM_PROFILE_ID=standalone.development',
    `${LANGUAGE_ANCHOR_ENV}=9001`,
    '',
  ].join('\n'));
  const surface = (id, rootPath, format, runtimeTarget) => ({
    id,
    root: rootPath,
    format,
    runtimeTarget,
    accessToken: {
      appIdEnv: LANGUAGE_ANCHOR_ENV,
      tenantId: '100001',
      organizationId: '0',
      permissionScope: ['iam:self'],
      ...accessToken,
    },
  });
  writeFixture(root, 'etc/client-env.materialization.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.client-env-materialization',
    command: 'materialize',
    profiles: ['standalone.development'],
    sourceIdentity: {
      deploymentProfileKeys: ['SDKWORK_IM_DEPLOYMENT_PROFILE'],
      environmentKeys: ['SDKWORK_IM_ENVIRONMENT'],
      profileIdKeys: ['SDKWORK_IM_PROFILE_ID'],
    },
    surfaces: [
      surface('demo-pc', 'apps/pc', 'vite', 'browser'),
      surface('demo-flutter', 'apps/flutter', 'flutter', 'flutter-android'),
      surface('demo-mp', 'apps/mp', 'mini-program', 'mini-program'),
      surface('demo-harmony', 'apps/harmony', 'harmony-native', 'harmony-native'),
    ],
  }, null, 2));
  // Harmony runtime config is a hand-authored template the materializer edits
  // in place; it must exist before the first run.
  writeFixture(
    root,
    LANGUAGE_PROFILE_FILES['harmony-native'],
    JSON.stringify({ app: { name: 'demo' } }, null, 2),
  );
  return root;
}

function readLanguageToken(root, format) {
  const filePath = path.join(root, LANGUAGE_PROFILE_FILES[format]);
  const text = readFileSync(filePath, 'utf8');
  const token = format === 'vite'
    ? parseClientEnvDotenv(text).SDKWORK_ACCESS_TOKEN
    : JSON.parse(text).SDKWORK_ACCESS_TOKEN;
  return decodeApplicationAccessToken(token);
}

function assertEveryLanguageCarries(root, expected) {
  for (const format of Object.keys(LANGUAGE_PROFILE_FILES)) {
    const { payload } = readLanguageToken(root, format);
    assert.equal(payload.ownership_scope, expected.ownershipScope, `${format} ownership_scope`);
    assert.equal(payload.user_id, expected.userId, `${format} user_id`);
    assert.equal(payload.organization_id, expected.organizationId, `${format} organization_id`);
  }
}

test('the release scope reaches every language form', () => {
  const root = createLanguageMatrixRoot({ ownershipScope: 'USER', ownerUserId: 'user-42' });
  try {
    materializeClientEnv({
      rootDir: root,
      env: { [LANGUAGE_ANCHOR_ENV]: '9001' },
    });
    assertEveryLanguageCarries(root, {
      ownershipScope: 'USER',
      userId: 'user-42',
      organizationId: '0',
    });
    // The harmony template keeps its authored shape and receives the same token.
    const harmony = JSON.parse(readFileSync(
      path.join(root, LANGUAGE_PROFILE_FILES['harmony-native']),
      'utf8',
    ));
    assert.equal(harmony.app.name, 'demo');
    assert.equal(harmony.profileId, 'standalone.development');
    assert.equal(harmony.SDKWORK_ACCESS_TOKEN.split('.').length, 3);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('the process environment overrides a declared release scope', () => {
  const root = createLanguageMatrixRoot({ ownershipScope: 'TENANT' });
  try {
    materializeClientEnv({
      rootDir: root,
      env: {
        [LANGUAGE_ANCHOR_ENV]: '9001',
        SDKWORK_APPLICATION_OWNERSHIP_SCOPE: 'USER',
        SDKWORK_APPLICATION_OWNER_USER_ID: 'user-9',
      },
    });
    assertEveryLanguageCarries(root, {
      ownershipScope: 'USER',
      userId: 'user-9',
      organizationId: '0',
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a surface without a declaration or override defaults to TENANT', () => {
  const values = createClientSurfaceValues({
    surface: accessTokenSurface({ appId: 'demo-app' }),
    sourceValues: {},
    profile: CLOUD_PRODUCTION_PROFILE,
    env: {},
  });
  const { payload } = decodeApplicationAccessToken(values.SDKWORK_ACCESS_TOKEN);
  assert.equal(payload.ownership_scope, 'TENANT');
  assert.equal(payload.user_id, '0');
});

test('an organization surface stamps its organization claim', () => {
  const values = createClientSurfaceValues({
    surface: {
      id: 'demo-org',
      format: 'vite',
      runtimeTarget: 'browser',
      accessToken: {
        appId: 'demo-app',
        tenantId: '100001',
        organizationId: '42',
        ownershipScope: 'ORGANIZATION',
        permissionScope: ['iam:self'],
      },
    },
    sourceValues: {},
    profile: CLOUD_PRODUCTION_PROFILE,
    env: {},
  });
  const { payload } = decodeApplicationAccessToken(values.SDKWORK_ACCESS_TOKEN);
  assert.equal(payload.ownership_scope, 'ORGANIZATION');
  assert.equal(payload.organization_id, '42');
  assert.equal(payload.login_scope, 'ORGANIZATION');
});

test('a USER surface fails naming the missing owner user id source', () => {
  const surface = {
    id: 'demo-user',
    format: 'vite',
    runtimeTarget: 'browser',
    accessToken: {
      appId: 'demo-app',
      tenantId: '100001',
      organizationId: '0',
      ownershipScope: 'USER',
      permissionScope: ['iam:self'],
    },
  };
  assert.throws(
    () => createClientSurfaceValues({
      surface,
      sourceValues: {},
      profile: CLOUD_PRODUCTION_PROFILE,
      env: {},
    }),
    /ownership_scope=USER requires the owner user id.*accessToken\.ownerUserId.*SDKWORK_APPLICATION_OWNER_USER_ID/u,
  );
  assert.throws(
    () => createClientSurfaceValues({
      surface,
      sourceValues: {},
      profile: CLOUD_PRODUCTION_PROFILE,
      env: { SDKWORK_APPLICATION_OWNER_USER_ID: '0' },
    }),
    /SDKWORK_APPLICATION_OWNER_USER_ID must not be the tenant sentinel 0/u,
  );
});

test('an ORGANIZATION surface without a non-zero organization fails generation', () => {
  assert.throws(
    () => createClientSurfaceValues({
      surface: {
        id: 'demo-org',
        format: 'vite',
        runtimeTarget: 'browser',
        accessToken: {
          appId: 'demo-app',
          tenantId: '100001',
          organizationId: '0',
          ownershipScope: 'ORGANIZATION',
        },
      },
      sourceValues: {},
      profile: CLOUD_PRODUCTION_PROFILE,
      env: {},
    }),
    /ownership_scope=ORGANIZATION requires a non-zero organization_id/u,
  );
});
