import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ALIGNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'align-app-topology-deployment-profiles.mjs');
const TOPOLOGY_VALIDATOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-topology-deployment-profiles.mjs');

function makeWorkspace({ supportedDeploymentProfiles = ['standalone', 'cloud'] } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-align-topology-'));
  const repoRoot = path.join(workspace, 'sdkwork-demo');
  fs.mkdirSync(path.join(repoRoot, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'etc', 'topology'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'sdkwork.app.config.json'),
    `${JSON.stringify({
      schemaVersion: 3,
      kind: 'sdkwork.app',
      app: { key: 'sdkwork-demo', name: 'Demo' },
      runtime: { supportedDeploymentProfiles },
    }, null, 2)}\n`,
  );
  return { workspace, repoRoot };
}

function installStandaloneGateway(repoRoot) {
  const gatewayRoot = path.join(repoRoot, 'crates', 'sdkwork-api-demo-standalone-gateway');
  fs.mkdirSync(gatewayRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'Cargo.toml'), [
    '[workspace]',
    'members = [',
    '  "crates/sdkwork-api-demo-standalone-gateway",',
    ']',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(gatewayRoot, 'Cargo.toml'), [
    '[package]',
    'name = "sdkwork-api-demo-standalone-gateway"',
    '[[bin]]',
    'name = "sdkwork-api-demo-standalone-gateway"',
    'path = "src/main.rs"',
    '',
  ].join('\n'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runAligner(workspace, repo = 'sdkwork-demo', extraArgs = []) {
  return spawnSync(
    process.execPath,
    [ALIGNER, '--workspace', workspace, '--repo', repo, ...extraArgs],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  );
}

function runTopologyValidator(repoRoot) {
  return spawnSync(
    process.execPath,
    [TOPOLOGY_VALIDATOR, '--root', repoRoot],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  );
}

test('migrates topology specs from retired serviceLayout profiles to two-segment profiles', () => {
  const { workspace, repoRoot } = makeWorkspace();
  const appManifestPath = path.join(repoRoot, 'sdkwork.app.config.json');
  const appManifest = JSON.parse(fs.readFileSync(appManifestPath, 'utf8'));
  appManifest.runtime.supportedDeploymentProfiles = ['self-hosted', 'cloud-hosted'];
  fs.writeFileSync(appManifestPath, `${JSON.stringify(appManifest, null, 2)}\n`);
  fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'scripts/gateway-cloud-bundle.mjs'), '');
  writeJson(path.join(repoRoot, 'package.json'), { scripts: {} });
  writeJson(path.join(repoRoot, 'specs', 'topology.spec.json'), {
    schemaVersion: 2,
    kind: 'sdkwork.app.topology',
    appId: 'sdkwork-demo',
    applicationCode: 'demo',
    profileRoot: 'etc/topology',
    profilePattern: '{deploymentProfile}.{serviceLayout}.{environment}.env',
    vocabulary: {
      deploymentProfile: { allowed: ['standalone', 'cloud'] },
      serviceLayout: { allowed: ['unified-process', 'split-services'] },
      environment: { allowed: ['development', 'production'] },
    },
    defaults: {
      developmentProfileId: 'standalone.unified-process.development',
      productionProfileId: 'cloud.split-services.production',
      desktopBuildProfileId: 'standalone.unified-process.production',
    },
    profileFiles: {
      'standalone.unified-process.development': 'etc/topology/standalone.unified-process.development.env',
      'cloud.split-services.production': 'etc/topology/cloud.split-services.production.env',
    },
    envKeys: {
      deploymentProfile: 'SDKWORK_DEMO_DEPLOYMENT_PROFILE',
      serviceLayout: 'SDKWORK_DEMO_SERVICE_LAYOUT',
      environment: 'SDKWORK_DEMO_ENVIRONMENT',
      profileId: 'SDKWORK_DEMO_PROFILE_ID',
    },
    components: {
      standaloneGateway: {
        crate: 'sdkwork-api-demo-standalone-gateway',
        binary: 'sdkwork-api-demo-standalone-gateway',
      },
    },
    surfaces: {
      'application.public-ingress': {
        connectivityPlane: 'application',
        protocols: ['http'],
        bindEnv: 'SDKWORK_DEMO_APPLICATION_PUBLIC_INGRESS_BIND',
        httpUrlEnv: 'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL',
        clientHttpEnv: 'VITE_SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL',
      },
      'application.backend-http': {
        connectivityPlane: 'application',
        protocols: ['http'],
        httpUrlEnv: 'SDKWORK_DEMO_APPLICATION_BACKEND_HTTP_URL',
        clientHttpEnv: 'VITE_SDKWORK_DEMO_APPLICATION_BACKEND_HTTP_URL',
      },
    },
    cloudPublicHosts: {
      'application.public-ingress': { httpHost: 'demo.sdkwork.com' },
    },
    orchestration: {
      profiles: {
        'standalone.unified-process.development': {
          processes: [
            {
              id: 'application.public-ingress',
              crate: 'sdkwork-api-demo-standalone-gateway',
              binary: 'sdkwork-api-demo-standalone-gateway',
            },
            {
              id: 'demo-browser',
              role: 'client',
              script: '_sdkwork:client:browser:standalone',
              applicationRoot: 'apps/sdkwork-demo-pc',
              bindEnv: 'SDKWORK_DEMO_BROWSER_BIND',
              runtimeTargets: ['browser'],
              clientArchitectures: ['pc-web'],
              required: true,
            },
          ],
          browserDeliveries: [
            {
              id: 'demo-browser',
              applicationRoot: 'apps/sdkwork-demo-pc',
              clientArchitectures: ['pc-web'],
              originMode: 'same-origin',
              deliveryMode: 'dev-server-proxy',
              apiSurfaceId: 'platform.api-gateway',
              clientProcessId: 'demo-browser',
              preserveCanonicalPaths: true,
            },
          ],
          healthSurfaces: ['application.public-ingress', 'platform.api-gateway'],
        },
      },
    },
  });
  fs.writeFileSync(
    path.join(repoRoot, 'etc/topology/standalone.unified-process.development.env'),
    [
      '# standalone.unified-process.development',
      'SDKWORK_DEMO_DEPLOYMENT_PROFILE=standalone',
      'SDKWORK_DEMO_SERVICE_LAYOUT=unified-process',
      'SDKWORK_DEMO_ENVIRONMENT=development',
      'SDKWORK_DEMO_PROFILE_ID=standalone.unified-process.development',
      'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=http://127.0.0.1:3900',
      'VITE_SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=http://127.0.0.1:3900',
      '',
    ].join('\r\n'),
  );
  fs.writeFileSync(
    path.join(repoRoot, 'etc/topology/cloud.split-services.production.env'),
    [
      '# cloud.split-services.production',
      'SDKWORK_DEMO_DEPLOYMENT_PROFILE=cloud',
      'SDKWORK_DEMO_SERVICE_LAYOUT=split-services',
      'SDKWORK_DEMO_ENVIRONMENT=production',
      'SDKWORK_DEMO_PROFILE_ID=cloud.split-services.production',
      '',
    ].join('\n'),
  );

  const result = runAligner(workspace);

  assert.equal(result.status, 0, result.stderr);
  const topology = JSON.parse(fs.readFileSync(path.join(repoRoot, 'specs/topology.spec.json'), 'utf8'));
  assert.equal(topology.schemaVersion, 5);
  assert.equal(topology.cloudIngress, undefined);
  assert.equal(topology.components?.cloudGateway, undefined);
  assert.deepEqual(topology.vocabulary.deploymentProfile.allowed, ['standalone', 'cloud']);
  assert.equal(topology.vocabulary.serviceLayout, undefined);
  assert.equal(topology.retired?.vocabulary?.serviceLayout, undefined);
  assert.notEqual(topology.retired?.envKeys?.includes('SDKWORK_DEMO_SERVICE_LAYOUT'), true);
  assert.equal(topology.profilePattern, '{deploymentProfile}.{environment}.env');
  assert.deepEqual(Object.keys(topology.profileFiles).sort(), [
    'cloud.development',
    'cloud.production',
    'standalone.development',
    'standalone.production',
  ]);
  assert.equal(topology.envKeys.serviceLayout, undefined);
  assert.equal(topology.defaults.developmentProfileId, 'standalone.development');
  assert.equal(topology.defaults.productionProfileId, 'cloud.production');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(appManifestPath, 'utf8')).runtime.supportedDeploymentProfiles,
    ['standalone', 'cloud'],
  );
  assert.ok(topology.surfaces['platform.api-gateway']);
  assert.equal(
    topology.envKeys.apiGatewayBaseUrl,
    'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL',
  );
  assert.ok(topology.orchestration.profiles['standalone.development']);
  assert.equal(
    topology.orchestration.profiles['standalone.development'].processes[0].role,
    'api-standalone-gateway',
  );
  assert.ok(topology.orchestration.profiles['cloud.production']);
  for (const profileId of ['standalone.development', 'standalone.production']) {
    const profile = topology.orchestration.profiles[profileId];
    assert.doesNotMatch(JSON.stringify(profile), /platform\.api-gateway/u);
    assert.equal(profile.browserDeliveries[0].apiSurfaceId, 'application.public-ingress');
  }
  assert.equal(fs.existsSync(path.join(repoRoot, 'etc/topology/standalone.unified-process.development.env')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'etc/topology/cloud.split-services.production.env')), false);
  const standaloneEnv = fs.readFileSync(path.join(repoRoot, 'etc/topology/standalone.development.env'), 'utf8');
  assert.doesNotMatch(standaloneEnv, /\r/u);
  assert.match(standaloneEnv, /SDKWORK_DEMO_PROFILE_ID=standalone\.development/);
  assert.doesNotMatch(standaloneEnv, /SERVICE_LAYOUT|unified-process|split-services/);
  assert.doesNotMatch(standaloneEnv, /PLATFORM_API_GATEWAY|:3900/u);
  const standaloneProductionEnv = fs.readFileSync(
    path.join(repoRoot, 'etc/topology/standalone.production.env'),
    'utf8',
  );
  assert.doesNotMatch(standaloneProductionEnv, /PLATFORM_API_GATEWAY|:3900/u);
  const cloudDevelopmentEnv = fs.readFileSync(
    path.join(repoRoot, 'etc/topology/cloud.development.env'),
    'utf8',
  );
  assert.doesNotMatch(cloudDevelopmentEnv, /\r/u);
  assert.match(cloudDevelopmentEnv, /SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https:\/\/demo\.sdkwork\.com/);
  assert.doesNotMatch(cloudDevelopmentEnv, /SDKWORK_DEMO_APPLICATION_BACKEND_HTTP_URL=/);
  assert.match(cloudDevelopmentEnv, /SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https:\/\/api\.sdkwork\.com/);
  assert.doesNotMatch(cloudDevelopmentEnv, /PLATFORM_API_GATEWAY_AUTOSTART/);
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['gateway:package:cloud'], undefined);
  assert.equal(packageJson.scripts['gateway:validate:cloud'], undefined);

  topology.orchestration.profiles['cloud.development'].processes = [
    {
      id: 'demo-h5',
      role: 'client',
      script: '_sdkwork:client:h5:cloud',
      runtimeTargets: ['browser'],
      clientArchitectures: ['h5'],
      required: true,
    },
    {
      id: 'demo-flutter-android',
      role: 'client',
      script: '_sdkwork:client:flutter-android:cloud',
      runtimeTargets: ['flutter-android'],
      clientArchitectures: ['flutter'],
      required: true,
    },
  ];
  writeJson(path.join(repoRoot, 'specs/topology.spec.json'), topology);

  const topologyAfterFirstRun = fs.readFileSync(
    path.join(repoRoot, 'specs/topology.spec.json'),
    'utf8',
  );
  const secondResult = runAligner(workspace);
  assert.equal(secondResult.status, 0, secondResult.stderr);
  assert.equal(
    fs.readFileSync(path.join(repoRoot, 'specs/topology.spec.json'), 'utf8'),
    topologyAfterFirstRun,
  );
  assert.match(secondResult.stdout, /Total actions: 0/u);
});

test('retires topology database config without mutating unrelated topology contracts', () => {
  const { workspace, repoRoot } = makeWorkspace();
  const topologyPath = path.join(repoRoot, 'specs', 'topology.spec.json');
  const original = {
    schemaVersion: 5,
    kind: 'sdkwork.app.topology',
    appId: 'sdkwork-demo',
    applicationCode: 'router',
    database: { appPrefix: 'SDKWORK_DEMO' },
    envKeys: {
      deploymentProfile: 'SDKWORK_ROUTER_DEPLOYMENT_PROFILE',
    },
    customContract: {
      preserve: true,
    },
  };
  const originalText = JSON.stringify(original, null, 2)
    .replace(
      /  "database": \{\n    "appPrefix": "SDKWORK_DEMO"\n  \},/u,
      '  "database": { "appPrefix": "SDKWORK_DEMO" },',
    )
    .replace(
      /  "customContract": \{\n    "preserve": true\n  \}/u,
      '  "customContract": { "preserve": true }',
    );
  fs.writeFileSync(topologyPath, `\uFEFF${originalText}\n`);

  const args = ['--retire-database-config-only', '--no-bootstrap-missing'];
  const result = runAligner(workspace, 'sdkwork-demo', args);

  assert.equal(result.status, 0, result.stderr);
  const topologyText = fs.readFileSync(topologyPath, 'utf8');
  const topology = JSON.parse(topologyText);
  assert.equal(topology.applicationCode, 'router');
  assert.equal(topology.database, undefined);
  assert.deepEqual(topology.customContract, { preserve: true });
  assert.equal(topologyText.startsWith('\uFEFF'), false);
  assert.match(topologyText, /"customContract": \{ "preserve": true \}/u);
  assert.ok(topologyText.indexOf('"applicationCode"') > topologyText.indexOf('"appId"'));
  assert.ok(topologyText.indexOf('"applicationCode"') < topologyText.indexOf('"envKeys"'));

  const secondResult = runAligner(workspace, 'sdkwork-demo', args);
  assert.equal(secondResult.status, 0, secondResult.stderr);
  assert.match(secondResult.stdout, /Total actions: 0/u);
  assert.equal(fs.readFileSync(topologyPath, 'utf8'), topologyText);
});

test('database-only migration does not bootstrap a missing topology', () => {
  const { workspace, repoRoot } = makeWorkspace();
  installStandaloneGateway(repoRoot);

  const result = runAligner(workspace, 'sdkwork-demo', [
    '--retire-database-config-only',
    '--no-bootstrap-missing',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Total actions: 0/u);
  assert.equal(fs.existsSync(path.join(repoRoot, 'specs', 'topology.spec.json')), false);
});

test('database-only migration refuses to guess applicationCode from appId', () => {
  const { workspace, repoRoot } = makeWorkspace();
  const topologyPath = path.join(repoRoot, 'specs', 'topology.spec.json');
  writeJson(topologyPath, {
    schemaVersion: 5,
    kind: 'sdkwork.app.topology',
    appId: 'sdkwork-demo',
  });
  const before = fs.readFileSync(topologyPath, 'utf8');

  const result = runAligner(workspace, 'sdkwork-demo', [
    '--retire-database-config-only',
    '--no-bootstrap-missing',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must declare a valid applicationCode explicitly/u);
  assert.equal(fs.readFileSync(topologyPath, 'utf8'), before);
});

test('does not invent a v5 executable gateway for an explicitly declared domain library', () => {
  const { workspace, repoRoot } = makeWorkspace();
  const topology = {
    schemaVersion: 4,
    kind: 'sdkwork.app.topology',
    appId: 'sdkwork-demo',
    components: {
      appApiRouter: {
        crate: 'sdkwork-routes-demo-app-api',
        library: 'sdkwork_routes_demo_app_api',
      },
      cloudGateway: {
        crate: 'sdkwork-api-cloud-gateway',
        binary: 'sdkwork-api-cloud-gateway',
      },
    },
    orchestration: {
      profiles: {
        'standalone.development': { processes: [] },
        'standalone.production': { processes: [] },
      },
    },
    retired: {
      notes: 'sdkwork-demo is a domain library. Host applications own executable gateways.',
    },
  };
  writeJson(path.join(repoRoot, 'specs', 'topology.spec.json'), topology);
  const before = fs.readFileSync(path.join(repoRoot, 'specs', 'topology.spec.json'), 'utf8');

  const result = runAligner(workspace);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Total actions: 0/u);
  assert.equal(fs.readFileSync(path.join(repoRoot, 'specs', 'topology.spec.json'), 'utf8'), before);
});

test('bootstraps standalone-only topology without platform gateway configuration', () => {
  const { workspace, repoRoot } = makeWorkspace({
    supportedDeploymentProfiles: ['standalone'],
  });
  installStandaloneGateway(repoRoot);

  const result = runAligner(workspace);

  assert.equal(result.status, 0, result.stderr);
  const topology = JSON.parse(fs.readFileSync(path.join(repoRoot, 'specs', 'topology.spec.json'), 'utf8'));
  assert.deepEqual(topology.components.applicationServer, {
    crate: 'sdkwork-api-demo-standalone-gateway',
    binary: 'sdkwork-api-demo-standalone-gateway',
  });
  assert.deepEqual(topology.vocabulary.deploymentProfile.allowed, ['standalone']);
  assert.deepEqual(Object.keys(topology.profileFiles).sort(), [
    'standalone.development',
    'standalone.production',
  ]);
  assert.equal(topology.surfaces['platform.api-gateway'], undefined);
  assert.equal(topology.cloudPublicHosts['platform.api-gateway'], undefined);
  assert.equal(topology.envKeys.apiGatewayBaseUrl, undefined);
  assert.equal(topology.envKeys.clientApiGatewayBaseUrl, undefined);

  for (const profileId of ['standalone.development', 'standalone.production']) {
    const source = fs.readFileSync(
      path.join(repoRoot, `etc/topology/${profileId}.env`),
      'utf8',
    );
    assert.match(source, /SDKWORK_DEMO_APPLICATION_PUBLIC_INGRESS_BIND=127\.0\.0\.1:8080/u);
    assert.match(source, /SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=http:\/\/127\.0\.0\.1:8080/u);
    assert.doesNotMatch(source, /PLATFORM_API_GATEWAY|:3900/u);
    assert.doesNotMatch(
      JSON.stringify(topology.orchestration.profiles[profileId]),
      /platform\.api-gateway/u,
    );
  }

  const topologyAfterFirstRun = fs.readFileSync(
    path.join(repoRoot, 'specs/topology.spec.json'),
    'utf8',
  );
  const secondResult = runAligner(workspace);
  assert.equal(secondResult.status, 0, secondResult.stderr);
  assert.equal(
    fs.readFileSync(path.join(repoRoot, 'specs/topology.spec.json'), 'utf8'),
    topologyAfterFirstRun,
  );
  assert.match(secondResult.stdout, /Total actions: 0/u);
});

test('keeps mixed cloud capability isolated from standalone profiles and passes validation', () => {
  const { workspace, repoRoot } = makeWorkspace();
  installStandaloneGateway(repoRoot);

  const result = runAligner(workspace);
  assert.equal(result.status, 0, result.stderr);

  const topology = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'specs/topology.spec.json'), 'utf8'),
  );
  assert.ok(topology.surfaces['platform.api-gateway']);
  assert.equal(
    topology.envKeys.apiGatewayBaseUrl,
    'SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL',
  );
  for (const profileId of ['standalone.development', 'standalone.production']) {
    assert.doesNotMatch(
      JSON.stringify(topology.orchestration.profiles[profileId]),
      /platform\.api-gateway/u,
    );
    const source = fs.readFileSync(
      path.join(repoRoot, `etc/topology/${profileId}.env`),
      'utf8',
    );
    assert.doesNotMatch(source, /PLATFORM_API_GATEWAY|:3900/u);
  }
  const cloudDevelopmentEnv = fs.readFileSync(
    path.join(repoRoot, 'etc/topology/cloud.development.env'),
    'utf8',
  );
  assert.match(
    cloudDevelopmentEnv,
    /SDKWORK_DEMO_PLATFORM_API_GATEWAY_HTTP_URL=https:\/\/api\.sdkwork\.com/u,
  );

  const validation = runTopologyValidator(repoRoot);
  assert.equal(validation.status, 0, validation.stderr);

  const topologyAfterFirstRun = fs.readFileSync(
    path.join(repoRoot, 'specs/topology.spec.json'),
    'utf8',
  );
  const secondResult = runAligner(workspace);
  assert.equal(secondResult.status, 0, secondResult.stderr);
  assert.equal(
    fs.readFileSync(path.join(repoRoot, 'specs/topology.spec.json'), 'utf8'),
    topologyAfterFirstRun,
  );
  assert.match(secondResult.stdout, /Total actions: 0/u);
});
