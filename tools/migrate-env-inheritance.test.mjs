import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { migrateEnvInheritance } from './migrate-env-inheritance.mjs';
import { parseClientEnvDotenv } from './materialize-client-env.mjs';
import { materializeTopologyEnv } from './materialize-topology-env.mjs';

function write(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

function createLegacyRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-env-migrate-'));
  const profiles = [
    'standalone.development',
    'standalone.test',
    'cloud.development',
    'cloud.test',
  ];
  write(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    profiles: Object.fromEntries(profiles.map((profile) => [profile, { config: `topology/${profile}.env` }])),
  }, null, 2));
  write(root, 'specs/topology.spec.json', JSON.stringify({
    envKeys: {
      deploymentProfile: 'SDKWORK_IM_DEPLOYMENT_PROFILE',
      environment: 'SDKWORK_IM_ENVIRONMENT',
      profileId: 'SDKWORK_IM_PROFILE_ID',
    },
  }, null, 2));
  for (const profile of profiles) {
    const [deploymentProfile, environment] = profile.split('.');
    write(root, `etc/topology/${profile}.env`, [
      'COMMON=1',
      `ENV_VALUE=${environment}`,
      `DEPLOY_VALUE=${deploymentProfile}`,
      `ONLY_${environment.toUpperCase()}=1`,
      `SDKWORK_IM_DEPLOYMENT_PROFILE=${deploymentProfile}`,
      `SDKWORK_IM_ENVIRONMENT=${environment}`,
      `SDKWORK_IM_PROFILE_ID=${profile}`,
      ...(profile === 'standalone.development' ? ['PRIVATE_TOKEN=secret'] : []),
      '',
    ].join('\n'));
  }
  return { root, profiles };
}

test('migrates a flat profile set without changing the resolved values', () => {
  const { root, profiles } = createLegacyRoot();
  try {
    const originals = Object.fromEntries(profiles.map((profile) => [
      profile,
      parseClientEnvDotenv(readFileSync(path.join(root, 'etc', 'topology', `${profile}.env`), 'utf8')),
    ]));
    migrateEnvInheritance({ root });
    const base = parseClientEnvDotenv(readFileSync(path.join(root, 'etc', 'topology', 'base.env'), 'utf8'));
    assert.equal(base.COMMON, '1');
    assert.equal(base.PRIVATE_TOKEN, undefined);
    const envBase = parseClientEnvDotenv(readFileSync(path.join(root, 'etc', 'topology', 'environments', 'development.base.env'), 'utf8'));
    assert.equal(envBase.ENV_VALUE, 'development');
    const profileBase = parseClientEnvDotenv(readFileSync(path.join(root, 'etc', 'topology', 'standalone.base.env'), 'utf8'));
    assert.equal(profileBase.DEPLOY_VALUE, 'standalone');
    const override = parseClientEnvDotenv(readFileSync(path.join(root, 'etc', 'topology', 'overrides', 'standalone.development.env'), 'utf8'));
    assert.equal(override.PRIVATE_TOKEN, 'secret');
    for (const profile of profiles) {
      const resolved = parseClientEnvDotenv(readFileSync(path.join(root, 'etc', 'topology', `${profile}.env`), 'utf8'));
      assert.deepEqual(resolved, originals[profile]);
    }
    materializeTopologyEnv({ root, check: true });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
