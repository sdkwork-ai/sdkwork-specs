import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkSourceConfigStandard } from './check-source-config-standard.mjs';

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-source-config-'));
}

function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function writeDeploymentIndex(root, profiles = ['standalone.development']) {
  const entries = {};
  for (const profileId of profiles) {
    const [deploymentProfile, environment] = profileId.split('.');
    const relative = `topology/${profileId}.env`;
    entries[profileId] = { config: relative };
    write(root, `etc/${relative}`, [
      `SDKWORK_ENVIRONMENT=${environment}`,
      `SDKWORK_DEPLOYMENT_PROFILE=${deploymentProfile}`,
      `SDKWORK_PROFILE_ID=${profileId}`,
      '',
    ].join('\n'));
  }
  write(root, 'etc/sdkwork.deployment.config.json', `${JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.deployment-index',
    application: 'sdkwork-demo',
    defaultProfile: profiles[0],
    profiles: entries,
  }, null, 2)}\n`);
}

test('accepts a deployable root with etc authority', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{"schemaVersion":3,"kind":"agent.app"}\n');
  write(root, 'etc/README.md', '# Config\n');
  writeDeploymentIndex(root);
  assert.deepEqual(checkSourceConfigStandard(root), []);
});

test('accepts the complete canonical profile matrix', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{"schemaVersion":3,"kind":"agent.app"}\n');
  write(root, 'etc/README.md', '# Config\n');
  writeDeploymentIndex(root, [
    'standalone.development',
    'standalone.test',
    'standalone.staging',
    'standalone.production',
    'cloud.development',
    'cloud.test',
    'cloud.staging',
    'cloud.production',
  ]);
  assert.deepEqual(checkSourceConfigStandard(root), []);
});

test('rejects invalid profile ids, missing files, and identity drift', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'etc/topology/cloud.production.env', [
    'SDKWORK_ENVIRONMENT=staging',
    'SDKWORK_DEPLOYMENT_PROFILE=standalone',
    'SDKWORK_PROFILE_ID=standalone.staging',
    '',
  ].join('\n'));
  write(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.deployment-index',
    defaultProfile: 'cloud.production',
    profiles: {
      'cloud.production': { config: 'topology/cloud.production.env' },
      'saas.prod': { config: 'topology/missing.env' },
      'standalone.test': { config: 'topology/missing.env' },
    },
  }));
  const issues = checkSourceConfigStandard(root);
  assert.ok(issues.some((issue) => issue.includes('profile id must use')));
  assert.ok(issues.some((issue) => issue.includes('target does not exist')));
  assert.ok(issues.some((issue) => issue.includes('#environment')));
  assert.ok(issues.some((issue) => issue.includes('#deploymentProfile')));
  assert.ok(issues.some((issue) => issue.includes('#profileId')));
});

test('rejects deployment profile paths that escape etc', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'outside.env', 'SDKWORK_ENVIRONMENT=development\n');
  write(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.deployment-index',
    defaultProfile: 'standalone.development',
    profiles: {
      'standalone.development': { config: '../outside.env' },
    },
  }));
  assert.ok(checkSourceConfigStandard(root).some((issue) => issue.includes('must stay within etc/')));
});

test('supports legacy identity-free profiles only outside strict migration mode', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'etc/topology/standalone.development.env', 'PORT=10240\n');
  write(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.deployment-index',
    defaultProfile: 'standalone.development',
    profiles: {
      'standalone.development': { config: 'topology/standalone.development.env' },
    },
  }));
  assert.deepEqual(checkSourceConfigStandard(root), []);
  const strictIssues = checkSourceConfigStandard(root, { enforceProfileIdentity: true });
  assert.ok(strictIssues.some((issue) => issue.includes('canonical profile identity is required')));
});

test('accepts canonical identity in TOML, nested JSON, and YAML profiles', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'etc/topology/standalone.development.toml', `
[runtime]
environment = "development"
deployment_profile = "standalone"
profile_id = "standalone.development"
runtime_target = "server"
`);
  write(root, 'etc/topology/cloud.test.json', `${JSON.stringify({
    runtime: {
      environment: 'test',
      deployment_profile: 'cloud',
      profile_id: 'cloud.test',
      runtime_target: 'server',
    },
  }, null, 2)}\n`);
  write(root, 'etc/topology/cloud.staging.yml', `
sdkwork:
  environment: staging
  deployment-profile: cloud
  profile-id: cloud.staging
`);
  write(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.deployment-index',
    defaultProfile: 'standalone.development',
    profiles: {
      'standalone.development': { config: 'topology/standalone.development.toml' },
      'cloud.test': { config: 'topology/cloud.test.json' },
      'cloud.staging': { config: 'topology/cloud.staging.yml' },
    },
  }));
  assert.deepEqual(
    checkSourceConfigStandard(root, { enforceProfileIdentity: true }),
    [],
  );
});

test('rejects manifest environment debt and retired configs', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{"environments":{"development":{"accessUrl":"http://localhost"}}}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'etc/sdkwork.deployment.config.json', '{}\n');
  write(root, 'configs/topology/dev.env', 'PORT=1\n');
  const issues = checkSourceConfigStandard(root);
  assert.ok(issues.some((issue) => issue.startsWith('configs/')));
  assert.ok(issues.some((issue) => issue.includes('#/environments')));
});

test('rejects committed secret values', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'etc/sdkwork.deployment.config.json', '{"database":{"password":"secret"}}\n');
  assert.ok(checkSourceConfigStandard(root).some((issue) => issue.includes('secret value')));
});

test('accepts an exact production app-api origin allowlist', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'etc/sdkwork.deployment.config.json', '{}\n');
  write(root, 'etc/sdkwork-api-cloud-gateway.production.toml', `
[service]
environment = "production"
[[dependencySurfaces]]
surface = "app"
[cors]
allowAnyOrigin = false
allowedOrigins = ["https://app.sdkwork.com"]
`);
  assert.deepEqual(checkSourceConfigStandard(root), []);
});

test('rejects empty or permissive production app-api CORS', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'etc/sdkwork.deployment.config.json', '{}\n');
  write(root, 'etc/sdkwork-api-cloud-gateway.production.toml', `
[service]
environment = "production"
[[dependencySurfaces]]
surface = "app"
[cors]
allowAnyOrigin = true
allowedOrigins = []
`);
  const issues = checkSourceConfigStandard(root);
  assert.ok(issues.some((issue) => issue.includes('allowAnyOrigin')));
  assert.ok(issues.some((issue) => issue.includes('requires at least one exact origin')));
});

test('rejects wildcard and path-bearing production origins', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'etc/sdkwork.deployment.config.json', '{}\n');
  write(root, 'etc/sdkwork-api-cloud-gateway.staging.toml', `
[service]
environment = "staging"
[[dependencySurfaces]]
surface = "app"
[cors]
allowAnyOrigin = false
allowedOrigins = ["https://*.sdkwork.com", "https://app.sdkwork.com/login"]
`);
  const issues = checkSourceConfigStandard(root);
  assert.equal(issues.filter((issue) => issue.includes('invalid exact origin')).length, 2);
});

test('accepts production-like desktop custom-scheme origins beside HTTP(S)', () => {
  const root = fixture();
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'etc/sdkwork.deployment.config.json', '{}\n');
  write(root, 'etc/sdkwork-api-cloud-gateway.production.toml', `
[service]
environment = "production"
[[dependencySurfaces]]
surface = "app"
[cors]
allowAnyOrigin = false
allowedOrigins = ["https://api.sdkwork.com", "app://dsh"]
`);
  assert.deepEqual(checkSourceConfigStandard(root), []);
});

test('accepts an app surface that delegates deployment and topology to its enclosing application', () => {
  const repository = fixture();
  const root = path.join(repository, 'apps', 'sdkwork-demo-pc');
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(repository, 'etc/sdkwork.deployment.config.json', '{"kind":"sdkwork.deployment-index"}\n');
  write(repository, 'specs/topology.spec.json', '{"schemaVersion":5,"kind":"sdkwork.app.topology"}\n');
  write(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.component-deployment',
    parentDeploymentConfig: '../../../etc/sdkwork.deployment.config.json',
    parentTopologySpec: '../../../specs/topology.spec.json',
  }));
  assert.deepEqual(checkSourceConfigStandard(root), []);
});

test('rejects missing or competing component topology authorities', () => {
  const repository = fixture();
  const root = path.join(repository, 'apps', 'sdkwork-demo-pc');
  write(root, 'agent.app.config.json', '{}\n');
  write(root, 'etc/README.md', '# Config\n');
  write(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.component-deployment',
    parentDeploymentConfig: '../../../etc/missing.json',
    parentTopologySpec: '../../../specs/missing.json',
  }));
  write(root, 'specs/topology.spec.json', '{"schemaVersion":5,"kind":"sdkwork.app.topology"}\n');
  const issues = checkSourceConfigStandard(root);
  assert.ok(issues.some((issue) => issue.includes('parentDeploymentConfig')));
  assert.ok(issues.some((issue) => issue.includes('parentTopologySpec')));
  assert.ok(issues.some((issue) => issue.includes('second topology')));
});
