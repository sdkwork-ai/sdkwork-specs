import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const CHECKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-topology-deployment-profiles.mjs');

function makeWorkspace(repoName, topology, files = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-topology-profiles-'));
  const repoRoot = path.join(workspace, repoName);
  fs.mkdirSync(path.join(repoRoot, 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'specs', 'topology.spec.json'),
    `${JSON.stringify(topology, null, 2)}\n`,
  );
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return { workspace, repoRoot };
}

function runChecker(workspace, repo = 'sdkwork-demo') {
  return spawnSync(
    process.execPath,
    [CHECKER, '--workspace', workspace, '--repo', repo],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  );
}

function runRootChecker(root) {
  return spawnSync(
    process.execPath,
    [CHECKER, '--root', root],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  );
}

function standardTopology() {
  return {
    schemaVersion: 4,
    kind: 'sdkwork.app.topology',
    appId: 'sdkwork-demo',
    vocabulary: {
      deploymentProfile: { allowed: ['standalone', 'cloud'] },
      environment: { allowed: ['development', 'production'] },
    },
    profileFiles: {
      'standalone.development': 'etc/topology/standalone.development.env',
      'cloud.development': 'etc/topology/cloud.development.env',
      'cloud.production': 'etc/topology/cloud.production.env',
    },
    surfaces: {
      'application.public-ingress': {
        protocols: ['http'],
        httpUrlEnv: 'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL',
      },
      'platform.api-gateway': {
        protocols: ['http'],
        httpUrlEnv: 'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL',
        clientHttpEnv: 'VITE_DEMO_PLATFORM_API_GATEWAY_HTTP_URL',
      },
    },
    envKeys: {
      apiGatewayBaseUrl: 'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL',
      clientApiGatewayBaseUrl: 'VITE_DEMO_PLATFORM_API_GATEWAY_HTTP_URL',
    },
    cloudPublicHosts: {
      'platform.api-gateway': { httpHost: 'api.sdkwork.com' },
    },
    orchestration: {
      profiles: {
        'standalone.development': { processes: [] },
        'cloud.development': {
          processes: [],
          healthSurfaces: ['application.public-ingress', 'platform.api-gateway'],
        },
        'cloud.production': { processes: [] },
      },
    },
  };
}

function sameOriginBrowserTopology() {
  return {
    schemaVersion: 5,
    kind: 'sdkwork.app.topology',
    appId: 'sdkwork-demo',
    vocabulary: {
      deploymentProfile: { allowed: ['standalone', 'cloud'] },
      environment: { allowed: ['development', 'production'] },
    },
    profileFiles: {
      'standalone.development': 'etc/topology/standalone.development.env',
      'standalone.production': 'etc/topology/standalone.production.env',
      'cloud.development': 'etc/topology/cloud.development.env',
      'cloud.production': 'etc/topology/cloud.production.env',
    },
    surfaces: {
      'application.public-ingress': {
        connectivityPlane: 'application',
        protocols: ['http'],
        httpUrlEnv: 'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL',
      },
      'platform.api-gateway': {
        connectivityPlane: 'platform',
        protocols: ['http'],
        httpUrlEnv: 'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL',
        clientHttpEnv: 'VITE_DEMO_PLATFORM_API_GATEWAY_HTTP_URL',
      },
    },
    envKeys: {
      apiGatewayBaseUrl: 'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL',
      clientApiGatewayBaseUrl: 'VITE_DEMO_PLATFORM_API_GATEWAY_HTTP_URL',
    },
    cloudPublicHosts: {
      'platform.api-gateway': { httpHost: 'api.sdkwork.com' },
    },
    orchestration: {
      profiles: {
        'standalone.development': {
          processes: [
            { id: 'application.public-ingress', role: 'api-standalone-gateway' },
            {
              id: 'demo-pc-browser',
              role: 'client',
              applicationRoot: 'apps/sdkwork-demo-pc',
              bindEnv: 'SDKWORK_DEMO_PC_DEV_BIND',
              runtimeTargets: ['browser'],
              clientArchitectures: ['pc-web'],
            },
          ],
          healthSurfaces: ['application.public-ingress'],
          browserDeliveries: [{
            id: 'demo-pc',
            applicationRoot: 'apps/sdkwork-demo-pc',
            clientArchitectures: ['pc-web'],
            originMode: 'same-origin',
            deliveryMode: 'dev-server-proxy',
            clientProcessId: 'demo-pc-browser',
            apiSurfaceId: 'application.public-ingress',
            preserveCanonicalPaths: true,
          }],
        },
        'standalone.production': {
          processes: [
            { id: 'application.public-ingress', role: 'api-standalone-gateway' },
          ],
          healthSurfaces: ['application.public-ingress'],
          browserDeliveries: [{
            id: 'demo-pc',
            applicationRoot: 'apps/sdkwork-demo-pc',
            clientArchitectures: ['pc-web'],
            originMode: 'same-origin',
            deliveryMode: 'gateway-static',
            hostProcessId: 'application.public-ingress',
            apiSurfaceId: 'application.public-ingress',
            buildOutput: 'apps/sdkwork-demo-pc/dist',
            runtimeRootEnv: 'SDKWORK_DEMO_PC_STATIC_ROOT',
            mountPath: '/',
            spaFallback: '/index.html',
          }],
        },
        'cloud.development': {
          processes: [],
          healthSurfaces: ['application.public-ingress', 'platform.api-gateway'],
        },
        'cloud.production': { processes: [] },
      },
    },
  };
}

function sameOriginBrowserFiles({
  developmentApiBaseUrl = '/',
  developmentBrowserOriginMode = 'same-origin',
  productionApiBaseUrl = '/',
  productionBrowserOriginMode = 'same-origin',
} = {}) {
  return {
    'etc/topology/standalone.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=http://127.0.0.1:3800',
      'SDKWORK_DEMO_PC_DEV_BIND=127.0.0.1:5182',
      '',
    ].join('\n'),
    'etc/topology/standalone.production.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=http://127.0.0.1:3800',
      'SDKWORK_DEMO_PC_STATIC_ROOT=apps/sdkwork-demo-pc/dist',
      '',
    ].join('\n'),
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'apps/sdkwork-demo-pc/etc/sdkwork.deployment.config.json': JSON.stringify({
      schemaVersion: 1,
      kind: 'sdkwork.component-deployment',
      profiles: {
        'standalone.development': { source: 'browser/runtime-env.development.json' },
        'standalone.production': { source: 'browser/runtime-env.production.json' },
      },
    }),
    'apps/sdkwork-demo-pc/etc/browser/runtime-env.development.json': JSON.stringify({
      environment: 'development',
      deploymentProfile: 'standalone',
      browserOriginMode: developmentBrowserOriginMode,
      appApiBaseUrl: developmentApiBaseUrl,
    }),
    'apps/sdkwork-demo-pc/etc/browser/runtime-env.production.json': JSON.stringify({
      environment: 'production',
      deploymentProfile: 'standalone',
      browserOriginMode: productionBrowserOriginMode,
      appApiBaseUrl: productionApiBaseUrl,
    }),
  };
}

function appManifestFile(supportedDeploymentProfiles) {
  return {
    'sdkwork.app.config.json': JSON.stringify({
      runtime: { supportedDeploymentProfiles },
    }),
  };
}

function standaloneOnlyBrowserTopology() {
  const topology = sameOriginBrowserTopology();
  topology.vocabulary.deploymentProfile.allowed = ['standalone'];
  delete topology.profileFiles['cloud.development'];
  delete topology.profileFiles['cloud.production'];
  delete topology.surfaces['platform.api-gateway'];
  delete topology.envKeys.apiGatewayBaseUrl;
  delete topology.envKeys.clientApiGatewayBaseUrl;
  delete topology.cloudPublicHosts['platform.api-gateway'];
  delete topology.orchestration.profiles['cloud.development'];
  delete topology.orchestration.profiles['cloud.production'];
  return topology;
}

test('accepts a manifest-declared standalone-only same-origin topology', () => {
  const files = {
    ...sameOriginBrowserFiles(),
    ...appManifestFile(['standalone']),
  };
  delete files['etc/topology/cloud.development.env'];
  delete files['etc/topology/cloud.production.env'];
  const { workspace } = makeWorkspace(
    'sdkwork-demo',
    standaloneOnlyBrowserTopology(),
    files,
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('rejects stale cloud profile declarations from a standalone-only manifest', () => {
  const topology = standaloneOnlyBrowserTopology();
  topology.vocabulary.deploymentProfile.allowed.push('cloud');
  topology.profileFiles['cloud.development'] = 'etc/topology/cloud.development.env';
  topology.orchestration.profiles['cloud.development'] = {
    processes: [],
    healthSurfaces: [],
  };
  topology.defaults ??= {};
  topology.defaults.productionProfileId = 'cloud.production';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    ...sameOriginBrowserFiles(),
    ...appManifestFile(['standalone']),
    'etc/topology/cloud.development.env': '',
  });

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /topology vocabulary declares unsupported deployment profile cloud/u);
  assert.match(result.stderr, /profileFiles declares unsupported deployment profile cloud\.development/u);
  assert.match(result.stderr, /orchestration declares unsupported deployment profile cloud\.development/u);
  assert.match(result.stderr, /defaults\.productionProfileId selects unsupported deployment profile cloud\.production/u);
});

test('accepts mixed capability while standalone profiles remain platform-isolated', () => {
  const { workspace } = makeWorkspace('sdkwork-demo', sameOriginBrowserTopology(), {
    ...sameOriginBrowserFiles(),
    ...appManifestFile(['standalone', 'cloud']),
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('rejects declared cloud capability without its platform surface contract', () => {
  const topology = sameOriginBrowserTopology();
  delete topology.surfaces['platform.api-gateway'];
  delete topology.cloudPublicHosts['platform.api-gateway'];
  delete topology.envKeys.apiGatewayBaseUrl;
  delete topology.envKeys.clientApiGatewayBaseUrl;
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    ...sameOriginBrowserFiles(),
    ...appManifestFile(['standalone', 'cloud']),
  });

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cloud deployment capability requires platform\.api-gateway surface/u);
});

test('rejects platform references from standalone profiles in a mixed-capability app', () => {
  const topology = sameOriginBrowserTopology();
  const standalone = topology.orchestration.profiles['standalone.development'];
  standalone.processes.push({ id: 'platform.api-gateway', role: 'client' });
  standalone.healthSurfaces.push('platform.api-gateway');
  standalone.browserDeliveries[0].apiSurfaceId = 'platform.api-gateway';
  const files = {
    ...sameOriginBrowserFiles(),
    ...appManifestFile(['standalone', 'cloud']),
  };
  files['etc/topology/standalone.development.env'] +=
    'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=http://127.0.0.1:3900\n';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, files);

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /standalone\.development must not start platform\.api-gateway/u);
  assert.match(result.stderr, /standalone\.development must not require platform\.api-gateway as a health surface/u);
  assert.match(result.stderr, /must use apiSurfaceId application\.public-ingress/u);
  assert.match(result.stderr, /standalone\.development must not define SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL/u);
});

test('accepts standalone and cloud two-segment topology profiles', () => {
  const { workspace } = makeWorkspace('sdkwork-demo', standardTopology(), {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({
      scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' },
    }),
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('accepts the canonical --root single-application interface', () => {
  const { repoRoot } = makeWorkspace('sdkwork-demo', standardTopology(), {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
  });

  const result = runRootChecker(repoRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 repositories scanned/u);
});

test('accepts standalone browser same-origin dev proxy and production static evidence', () => {
  const { workspace } = makeWorkspace(
    'sdkwork-demo',
    sameOriginBrowserTopology(),
    sameOriginBrowserFiles(),
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('rejects a standalone browser client without same-origin delivery evidence', () => {
  const topology = sameOriginBrowserTopology();
  delete topology.orchestration.profiles['standalone.development'].browserDeliveries;
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /browser client demo-pc-browser requires exactly one same-origin dev-server-proxy delivery/u);
});

test('rejects browser delivery with the wrong origin mode', () => {
  const topology = sameOriginBrowserTopology();
  topology.orchestration.profiles['standalone.development']
    .browserDeliveries[0].originMode = 'cross-origin';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use originMode same-origin/u);
});

test('rejects browser delivery that targets a non-application API surface', () => {
  const topology = sameOriginBrowserTopology();
  topology.orchestration.profiles['standalone.development']
    .browserDeliveries[0].apiSurfaceId = 'platform.api-gateway';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use apiSurfaceId application.public-ingress/u);
});

test('rejects dev proxy delivery that references the wrong client process', () => {
  const topology = sameOriginBrowserTopology();
  topology.orchestration.profiles['standalone.development']
    .browserDeliveries[0].clientProcessId = 'missing-browser';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must reference its browser client process with bindEnv/u);
});

test('rejects browser runtime config that exposes the internal standalone API listener', () => {
  const { workspace } = makeWorkspace(
    'sdkwork-demo',
    sameOriginBrowserTopology(),
    sameOriginBrowserFiles({ developmentApiBaseUrl: 'http://127.0.0.1:3800' }),
  );

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use a root-relative same-origin path, not http:\/\/127\.0\.0\.1:3800 \(it exposes the internal API listener origin\)/u);
});

test('rejects an absolute browser-origin URL in standalone public runtime config', () => {
  const { workspace } = makeWorkspace(
    'sdkwork-demo',
    sameOriginBrowserTopology(),
    sameOriginBrowserFiles({ developmentApiBaseUrl: 'http://127.0.0.1:5182' }),
  );

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use a root-relative same-origin path, not http:\/\/127\.0\.0\.1:5182/u);
});

test('rejects a production loopback URL in standalone public runtime config', () => {
  const { workspace } = makeWorkspace(
    'sdkwork-demo',
    sameOriginBrowserTopology(),
    sameOriginBrowserFiles({ productionApiBaseUrl: 'http://127.0.0.1:3800' }),
  );

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /standalone\.production browser runtime appApiBaseUrl must use a root-relative same-origin path/u);
});

test('rejects a standalone browser runtime without same-origin mode', () => {
  const { workspace } = makeWorkspace(
    'sdkwork-demo',
    sameOriginBrowserTopology(),
    sameOriginBrowserFiles({ developmentBrowserOriginMode: 'cross-origin' }),
  );

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /browser runtime must declare browserOriginMode same-origin/u);
});

test('rejects browser delivery architecture drift from its development client', () => {
  const topology = sameOriginBrowserTopology();
  topology.orchestration.profiles['standalone.development']
    .browserDeliveries[0].clientArchitectures = ['h5'];
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /clientArchitectures must match client process demo-pc-browser/u);
});

test('rejects a dev proxy that does not preserve canonical API paths', () => {
  const topology = sameOriginBrowserTopology();
  topology.orchestration.profiles['standalone.development']
    .browserDeliveries[0].preserveCanonicalPaths = false;
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must set preserveCanonicalPaths=true/u);
});

test('rejects browser deliveries that mix dev-proxy and gateway-static fields', () => {
  const topology = sameOriginBrowserTopology();
  topology.orchestration.profiles['standalone.development']
    .browserDeliveries[0].hostProcessId = 'application.public-ingress';
  topology.orchestration.profiles['standalone.production']
    .browserDeliveries[0].clientProcessId = 'demo-pc-browser';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dev-server-proxy must not declare hostProcessId/u);
  assert.match(result.stderr, /gateway-static must not declare clientProcessId/u);
});

test('rejects missing standalone production static and SPA delivery evidence', () => {
  const topology = sameOriginBrowserTopology();
  delete topology.orchestration.profiles['standalone.production'].browserDeliveries;
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /architecture pc-web requires exactly one same-origin gateway-static delivery/u);
});

test('rejects production static delivery with an unresolved runtime root', () => {
  const files = sameOriginBrowserFiles();
  files['etc/topology/standalone.production.env'] =
    'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=http://127.0.0.1:3800\n';
  const { workspace } = makeWorkspace('sdkwork-demo', sameOriginBrowserTopology(), files);

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtimeRootEnv must resolve in its source profile/u);
});

test('rejects production browser delivery with the wrong delivery mode', () => {
  const topology = sameOriginBrowserTopology();
  topology.orchestration.profiles['standalone.production']
    .browserDeliveries[0].deliveryMode = 'dev-server-proxy';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /standalone\.production browser delivery demo-pc must use gateway-static/u);
});

test('rejects production static delivery with a non-gateway host', () => {
  const topology = sameOriginBrowserTopology();
  topology.orchestration.profiles['standalone.production'].processes.push({
    id: 'static-worker',
    role: 'worker',
  });
  topology.orchestration.profiles['standalone.production']
    .browserDeliveries[0].hostProcessId = 'static-worker';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must reference an api-standalone-gateway host process/u);
});

test('rejects production static delivery outside its app root or canonical SPA mount', () => {
  const topology = sameOriginBrowserTopology();
  const delivery = topology.orchestration.profiles['standalone.production'].browserDeliveries[0];
  delivery.buildOutput = 'dist/sdkwork-demo-pc';
  delivery.mountPath = '/pc';
  delivery.spaFallback = '/shell.html';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, sameOriginBrowserFiles());

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /buildOutput must stay inside applicationRoot/u);
  assert.match(result.stderr, /must mount \/ with SPA fallback \/index\.html/u);
});

test('rejects standalone server and browser platform gateway URL keys', () => {
  const topology = standardTopology();
  topology.surfaces['platform.api-gateway'].clientHttpEnv = 'VITE_DEMO_PLATFORM_API_GATEWAY_HTTP_URL';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': [
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=http://127.0.0.1:3900',
      'VITE_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=http://127.0.0.1:3900',
      '',
    ].join('\n'),
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
  });

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /standalone\.development must not define SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL/u);
  assert.match(result.stderr, /standalone\.development must not define VITE_DEMO_PLATFORM_API_GATEWAY_HTTP_URL/u);
});

test('rejects platform gateway URL keys from standalone production profiles', () => {
  const topology = sameOriginBrowserTopology();
  topology.surfaces['platform.api-gateway'].clientHttpEnv =
    'VITE_DEMO_PLATFORM_API_GATEWAY_HTTP_URL';
  const files = sameOriginBrowserFiles();
  files['etc/topology/standalone.production.env'] = [
    'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=http://127.0.0.1:3800',
    'SDKWORK_DEMO_PC_STATIC_ROOT=apps/sdkwork-demo-pc/dist',
    'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=http://127.0.0.1:3900',
    'VITE_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=http://127.0.0.1:3900',
    '',
  ].join('\n');
  const { workspace } = makeWorkspace('sdkwork-demo', topology, files);

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /standalone\.production must not define SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL/u);
  assert.match(result.stderr, /standalone\.production must not define VITE_DEMO_PLATFORM_API_GATEWAY_HTTP_URL/u);
});

test('does not require an HTTP URL for a gRPC-only public ingress', () => {
  const topology = standardTopology();
  topology.surfaces['application.public-ingress'] = {
    protocols: ['grpc'],
    grpcUrlEnv: 'SDKWORK_DEMO_APPLICATION_PUBLIC_GRPC_URL',
  };
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({
      scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' },
    }),
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('rejects a required standalone HTTP health surface without a concrete URL', () => {
  const topology = standardTopology();
  topology.orchestration.profiles['standalone.development'].healthSurfaces = ['application.public-ingress'];
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({ scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' } }),
  });

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required health surface application\.public-ingress/u);
});

test('rejects retired serviceLayout vocabulary and three-segment profile ids', () => {
  const legacy = standardTopology();
  legacy.vocabulary.serviceLayout = { allowed: ['unified-process', 'split-services'] };
  legacy.profileFiles = {
    'standalone.unified-process.development': 'etc/topology/standalone.unified-process.development.env',
    'cloud.split-services.production': 'etc/topology/cloud.split-services.production.env',
  };
  legacy.orchestration.profiles = {
    'standalone.unified-process.development': { processes: [] },
    'cloud.split-services.production': { processes: [] },
  };
  const { workspace } = makeWorkspace('sdkwork-demo', legacy, {
    'etc/topology/standalone.unified-process.development.env': '',
    'etc/topology/cloud.split-services.production.env': '',
  });

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /retired vocabulary\.serviceLayout/);
  assert.match(result.stderr, /retired profile id standalone\.unified-process\.development/);
});

test('rejects pre-v4 topology specs', () => {
  const legacy = standardTopology();
  legacy.schemaVersion = 2;
  const { workspace } = makeWorkspace('sdkwork-demo', legacy, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({
      scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' },
    }),
  });

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /schemaVersion must be 4 \(migration\) or 5/);
});

test('schema v5 accepts explicit remote surfaces without gateway implementation metadata', () => {
  const topology = standardTopology();
  topology.schemaVersion = 5;
  topology.orchestration.profiles['standalone.development'].processes = [
    { id: 'standalone-gateway', role: 'api-standalone-gateway' },
  ];
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({ scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' } }),
  });

  const result = runChecker(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('schema v5 uses process roles instead of process-name heuristics', () => {
  const topology = standardTopology();
  topology.schemaVersion = 5;
  topology.orchestration.profiles['standalone.development'].processes = [
    { id: 'standalone-gateway', role: 'api-standalone-gateway' },
  ];
  topology.orchestration.profiles['cloud.development'].processes = [
    { id: 'api-client', role: 'client' },
  ];
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://api.dev.sdkwork.com/app',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({ scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' } }),
  });

  const result = runChecker(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('schema v5 accepts a declared standalone edge runtime', () => {
  const topology = standardTopology();
  topology.schemaVersion = 5;
  topology.orchestration.profiles['standalone.development'].processes = [
    { id: 'standalone-gateway', role: 'api-standalone-gateway' },
    {
      id: 'edge.device-ingress',
      role: 'edge-runtime',
      script: '_sdkwork:runtime:device-edge',
      decisionRef: 'docs/adr/001-device-edge-runtime.md',
    },
  ];
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'docs/adr/001-device-edge-runtime.md': '# Device edge runtime\n',
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://api.dev.sdkwork.com/app',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
  });

  const result = runChecker(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('schema v5 rejects edge runtimes in cloud development and ambiguous edge hooks', () => {
  const topology = standardTopology();
  topology.schemaVersion = 5;
  topology.orchestration.profiles['standalone.development'].processes = [
    { id: 'standalone-gateway', role: 'api-standalone-gateway' },
  ];
  topology.orchestration.profiles['cloud.development'].processes = [
    {
      id: 'edge.device.ingress',
      role: 'edge-runtime',
      script: '_sdkwork:gateway:edge',
      decisionRef: 'docs/adr/missing.md',
    },
  ];
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://api.dev.sdkwork.com/app',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
  });

  const result = runChecker(workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cloud\.development forbids local process role edge-runtime/u);
  assert.match(result.stderr, /requires an _sdkwork:runtime:\* script/u);
  assert.match(result.stderr, /decisionRef does not exist/u);
});

test('schema v5 allows application and platform surfaces to use different deployed origins', () => {
  const topology = standardTopology();
  topology.schemaVersion = 5;
  topology.orchestration.profiles['standalone.development'].processes = [
    { id: 'standalone-gateway', role: 'api-standalone-gateway' },
  ];
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({ scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' } }),
  });

  const result = runChecker(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('schema v5 rejects retired cloud ingress implementation metadata', () => {
  const topology = standardTopology();
  topology.schemaVersion = 5;
  topology.cloudIngress = {
    strategy: 'edge-split',
    platformGateway: 'sdkwork-api-cloud-gateway',
    edgeGateway: 'sdkwork-demo-edge-gateway',
    decisionRef: 'ADR-20260719-demo-edge-ingress',
  };
  topology.orchestration.profiles['standalone.development'].processes = [
    { id: 'standalone-gateway', role: 'api-standalone-gateway' },
  ];
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://edge.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({ scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' } }),
  });

  const result = runChecker(workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not declare retired cloudIngress/u);
});

test('schema v5 rejects retired dedicated application cloud ingress metadata', () => {
  const topology = standardTopology();
  topology.schemaVersion = 5;
  topology.orchestration.profiles['standalone.development'].processes = [
    { id: 'standalone-gateway', role: 'api-standalone-gateway' },
  ];
  topology.cloudIngress = {
    strategy: 'dedicated-application',
    platformGateway: 'another-gateway',
  };
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({ scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' } }),
  });

  const result = runChecker(workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not declare retired cloudIngress/u);
});

test('schema v5 rejects role-less processes and cloud backend roles', () => {
  const topology = standardTopology();
  topology.schemaVersion = 5;
  topology.orchestration.profiles['standalone.development'].processes = [
    { name: 'legacy-standalone-gateway' },
  ];
  topology.orchestration.profiles['cloud.development'].processes = [
    { id: 'remote-api-helper', role: 'api-listener' },
  ];
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({ scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' } }),
  });

  const result = runChecker(workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /process id is required/);
  assert.match(result.stderr, /requires a canonical role/);
  assert.match(result.stderr, /remote-api-helper requires a canonical role/);
  assert.match(result.stderr, /requires exactly one api-standalone-gateway role; found 0/);
});

test('topology schema v5 forbids cloudIngress and the retired api-listener role', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, '..', 'schemas', 'sdkwork.app.topology.schema.v5.json'),
      'utf8',
    ),
  );
  assert.deepEqual(schema.not, { required: ['cloudIngress'] });
  const roles = schema.properties.orchestration.properties.profiles.patternProperties[
    '^(standalone|cloud)\\.[a-z0-9-]+$'
  ].properties.processes.items.properties.role.enum;
  assert.equal(roles.includes('api-listener'), false);
  assert.equal(roles.includes('api-standalone-gateway'), true);
  assert.equal(roles.includes('edge-runtime'), true);
  const browserDelivery = schema.properties.orchestration.properties.profiles.patternProperties[
    '^(standalone|cloud)\\.[a-z0-9-]+$'
  ].properties.browserDeliveries.items;
  assert.equal(
    schema.properties.orchestration.properties.profiles.patternProperties[
      '^(standalone|cloud)\\.[a-z0-9-]+$'
    ].properties.browserDeliveries.minItems,
    1,
  );
  assert.ok(browserDelivery.required.includes('clientArchitectures'));
  assert.deepEqual(browserDelivery.properties.originMode, { const: 'same-origin' });
  assert.deepEqual(
    browserDelivery.properties.deliveryMode.enum,
    ['dev-server-proxy', 'gateway-static'],
  );
});

test('rejects cloud development that starts local API and gateway processes', () => {
  const topology = standardTopology();
  topology.orchestration.profiles['cloud.development'].processes = [
    { id: 'application.public-ingress', required: true },
    { id: 'platform.api-gateway', required: true },
  ];
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=true',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({
      scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' },
    }),
  });

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cloud\.development must not autostart local API\/dependency process application\.public-ingress/);
  assert.match(result.stderr, /cloud\.development must not autostart local API\/dependency process platform\.api-gateway/);
});

test('rejects application-owned platform cloud gateway implementation details', () => {
  const topology = standardTopology();
  topology.schemaVersion = 5;
  topology.orchestration.profiles['standalone.development'].processes = [
    { id: 'standalone-gateway', role: 'api-standalone-gateway' },
  ];
  topology.components = {
    cloudGateway: { crate: 'sdkwork-api-cloud-gateway' },
  };
  topology.surfaces['platform.api-gateway'].autostartEnv = 'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART';
  const { workspace } = makeWorkspace('sdkwork-demo', topology, {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.com',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https://api.dev.sdkwork.com',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
  });

  const result = runChecker(workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not declare platform cloud gateway implementation details/u);
});

test('rejects cloud development loopback URLs without an explicit tunnel', () => {
  const { workspace } = makeWorkspace('sdkwork-demo', standardTopology(), {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=http://127.0.0.1:8080',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=http://127.0.0.1:3900',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({
      scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' },
    }),
  });

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not use loopback without an explicit tunnel\/proxy process/);
});

test('rejects missing and placeholder cloud development URLs', () => {
  const { workspace } = makeWorkspace('sdkwork-demo', standardTopology(), {
    'etc/topology/standalone.development.env': '',
    'etc/topology/cloud.development.env': [
      'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.dev.sdkwork.example',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_AUTOSTART=false',
      '',
    ].join('\n'),
    'etc/topology/cloud.production.env': '',
    'etc/sdkwork-api-cloud-gateway.demo.development.toml': '',
    'etc/sdkwork-api-cloud-gateway.demo.production.toml': '',
    'package.json': JSON.stringify({
      scripts: { 'gateway:package:cloud': 'node scripts/package.mjs' },
    }),
  });

  const result = runChecker(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APPLICATION_PUBLIC_HTTP_URL must be a concrete deployed URL, not a placeholder/);
  assert.match(result.stderr, /missing explicit SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL/);
});
