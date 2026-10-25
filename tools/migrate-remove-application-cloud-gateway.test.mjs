import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateApplicationCloudGateway } from './migrate-remove-application-cloud-gateway.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-remove-cloud-gateway-'));
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agent.app.config.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {
    'gateway:package:cloud': 'node package-cloud.mjs',
    'gateway:cloud:bundle': 'node package-cloud.mjs',
    'gateway:package:platform-config': 'node package-cloud.mjs',
    dev: 'pnpm dev:standalone',
  } }, null, 2));
  fs.writeFileSync(path.join(root, 'etc', 'sdkwork-api-cloud-gateway.demo.development.toml'), 'name = "sdkwork-api-cloud-gateway"\n');
  fs.writeFileSync(path.join(root, 'scripts', 'gateway-cloud-bundle.mjs'), 'console.log("legacy bundle");\n');
  fs.writeFileSync(path.join(root, 'scripts', 'sdkwork-command.mjs'), 'const helper = "gateway-cloud-bundle.mjs";\n');
  fs.writeFileSync(path.join(root, 'tests', 'topology.test.mjs'), 'const helper = "gateway-cloud-bundle";\n');
  fs.writeFileSync(path.join(root, 'specs', 'component.spec.json'), JSON.stringify({
    integration: {
      foundationApiGateway: { targetMode: 'shared-gateway' },
    },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'specs', 'topology.spec.json'), JSON.stringify({
    cloudIngress: { strategy: 'platform-collapsed', platformGateway: 'sdkwork-api-cloud-gateway' },
    components: { cloudGateway: { crate: 'sdkwork-api-cloud-gateway' } },
    envKeys: { cloudGatewayBind: 'SDKWORK_API_CLOUD_GATEWAY_BIND' },
    surfaces: { 'platform.api-gateway': { owner: 'sdkwork-api-cloud-gateway', httpUrlEnv: 'SDKWORK_PLATFORM_URL' } },
    scripts: { gatewayCloudBundle: 'scripts/gateway-cloud-bundle.mjs' },
    orchestration: { profiles: { 'cloud.production': { processes: [
      { id: 'platform', role: 'platform-gateway', crate: 'sdkwork-api-cloud-gateway' },
    ] } } },
  }, null, 2));
  return root;
}

test('dry run reports cleanup without modifying application files', () => {
  const root = fixture();
  const result = migrateApplicationCloudGateway(root, { dryRun: true });
  assert.ok(result.actions.length >= 5);
  assert.ok(result.actions.includes('manual repair required for scripts/gateway-cloud-bundle.mjs'));
  assert.ok(result.actions.includes('manual repair required for scripts/sdkwork-command.mjs'));
  assert.ok(result.actions.includes('manual repair required for tests/topology.test.mjs'));
  assert.ok(result.actions.includes('manual repair required for specs/component.spec.json'));
  assert.equal(fs.existsSync(path.join(root, 'etc', 'sdkwork-api-cloud-gateway.demo.development.toml')), true);
});

test('removes exact application-owned cloud gateway metadata and config', () => {
  const root = fixture();
  migrateApplicationCloudGateway(root);
  const topology = JSON.parse(fs.readFileSync(path.join(root, 'specs', 'topology.spec.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(topology.cloudIngress, undefined);
  assert.equal(topology.components.cloudGateway, undefined);
  assert.equal(topology.scripts.gatewayCloudBundle, undefined);
  assert.equal(topology.orchestration.profiles['cloud.production'].processes.length, 0);
  assert.equal(pkg.scripts['gateway:package:cloud'], undefined);
  assert.equal(pkg.scripts['gateway:cloud:bundle'], undefined);
  assert.equal(pkg.scripts['gateway:package:platform-config'], undefined);
  assert.equal(fs.existsSync(path.join(root, 'etc', 'sdkwork-api-cloud-gateway.demo.development.toml')), false);
});

test('never mutates the platform cloud gateway owner repository', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-platform-gateway-owner-'));
  const root = path.join(workspace, 'sdkwork-api-cloud-gateway');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'agent.app.config.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {
    'gateway:package:cloud': 'node package-cloud.mjs',
  } }, null, 2));

  const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const result = migrateApplicationCloudGateway(root);
  assert.equal(result.skipped, true);
  assert.deepEqual(result.actions, []);
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before);
});

test('topology-only migration preserves public scripts and config files', () => {
  const root = fixture();
  migrateApplicationCloudGateway(root, { topologyOnly: true });
  const topology = JSON.parse(fs.readFileSync(path.join(root, 'specs', 'topology.spec.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(topology.cloudIngress, undefined);
  assert.equal(topology.components.cloudGateway, undefined);
  assert.equal(pkg.scripts['gateway:package:cloud'], 'node package-cloud.mjs');
  assert.equal(fs.existsSync(path.join(root, 'etc', 'sdkwork-api-cloud-gateway.demo.development.toml')), true);
});

test('scripts-only migration removes cloud gateway commands without changing topology or config', () => {
  const root = fixture();
  const topologyPath = path.join(root, 'specs', 'topology.spec.json');
  const topologyBefore = fs.readFileSync(topologyPath, 'utf8');
  const result = migrateApplicationCloudGateway(root, { scriptsOnly: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.deepEqual(result.actions.sort(), [
    'remove package.json script gateway:cloud:bundle',
    'remove package.json script gateway:package:cloud',
    'remove package.json script gateway:package:platform-config',
  ]);
  assert.equal(pkg.scripts['gateway:package:cloud'], undefined);
  assert.equal(pkg.scripts['gateway:cloud:bundle'], undefined);
  assert.equal(pkg.scripts['gateway:package:platform-config'], undefined);
  assert.equal(fs.readFileSync(topologyPath, 'utf8'), topologyBefore);
  assert.equal(fs.existsSync(path.join(root, 'etc', 'sdkwork-api-cloud-gateway.demo.development.toml')), true);
});
