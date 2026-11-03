import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { materializeTopologyEnv } from './materialize-topology-env.mjs';

function write(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

function createRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-topology-env-'));
  write(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    profiles: {
      'standalone.development': { config: 'topology/standalone.development.env' },
      'cloud.production': { config: 'topology/cloud.production.env' },
    },
  }, null, 2));
  write(root, 'specs/topology.spec.json', JSON.stringify({
    envKeys: {
      deploymentProfile: 'SDKWORK_IM_DEPLOYMENT_PROFILE',
      environment: 'SDKWORK_IM_ENVIRONMENT',
      profileId: 'SDKWORK_IM_PROFILE_ID',
    },
  }, null, 2));
  write(root, 'etc/topology/base.env', 'SHARED=base\nREGION=cn\n');
  write(root, 'etc/topology/environments/development.base.env', 'ENV_ONLY=dev\nREGION=dev-region\n');
  write(root, 'etc/topology/standalone.base.env', 'PROFILE_ONLY=standalone\n');
  write(root, 'etc/topology/overrides/standalone.development.env', [
    'SDKWORK_IM_DEPLOYMENT_PROFILE=standalone',
    'SDKWORK_IM_ENVIRONMENT=development',
    'SDKWORK_IM_PROFILE_ID=standalone.development',
    'SHARED=override',
    'URL=${PROFILE_ONLY}/api',
    '',
  ].join('\n'));
  write(root, 'etc/topology/overrides/cloud.production.env', [
    'SDKWORK_IM_DEPLOYMENT_PROFILE=cloud',
    'SDKWORK_IM_ENVIRONMENT=production',
    'SDKWORK_IM_PROFILE_ID=cloud.production',
    '',
  ].join('\n'));
  return root;
}

test('merges layers in order and expands ${KEY} after the merge', () => {
  const root = createRoot();
  try {
    materializeTopologyEnv({ root });
    const resolved = readFileSync(path.join(root, 'etc', 'topology', 'standalone.development.env'), 'utf8');
    assert.match(resolved, /^# GENERATED FILE - DO NOT EDIT\.$/mu);
    assert.match(resolved, /^SHARED=override$/mu);
    assert.match(resolved, /^ENV_ONLY=dev$/mu);
    assert.match(resolved, /^REGION=dev-region$/mu);
    assert.match(resolved, /^URL=standalone\/api$/mu);
    assert.doesNotMatch(resolved, /^SHARED=base$/mu);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('rejects a secret in a base layer', () => {
  const root = createRoot();
  try {
    write(root, 'etc/topology/base.env', 'SHARED=base\nSDKWORK_ACCESS_TOKEN=public-token\n');
    assert.throws(
      () => materializeTopologyEnv({ root }),
      /base layer and must not contain secrets: SDKWORK_ACCESS_TOKEN/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('rejects a duplicate key inside one layer', () => {
  const root = createRoot();
  try {
    write(root, 'etc/topology/base.env', 'SHARED=one\nSHARED=two\n');
    assert.throws(
      () => materializeTopologyEnv({ root }),
      /declares SHARED more than once/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('rejects an unresolved interpolation reference', () => {
  const root = createRoot();
  try {
    write(root, 'etc/topology/overrides/standalone.development.env', [
      'SDKWORK_IM_DEPLOYMENT_PROFILE=standalone',
      'SDKWORK_IM_ENVIRONMENT=development',
      'SDKWORK_IM_PROFILE_ID=standalone.development',
      'URL=${MISSING_KEY}/api',
      '',
    ].join('\n'));
    assert.throws(
      () => materializeTopologyEnv({ root }),
      /MISSING_KEY is not defined/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('resolves a profile with no override layer using generated identity', () => {
  const root = createRoot();
  try {
    rmSync(path.join(root, 'etc', 'topology', 'overrides', 'cloud.production.env'), { force: true });
    materializeTopologyEnv({ root });
    const resolved = readFileSync(path.join(root, 'etc', 'topology', 'cloud.production.env'), 'utf8');
    assert.match(resolved, /^# --- profile-id \(generated\) ---$/mu);
    assert.match(resolved, /^SDKWORK_IM_DEPLOYMENT_PROFILE=cloud$/mu);
    assert.match(resolved, /^SDKWORK_IM_ENVIRONMENT=production$/mu);
    assert.match(resolved, /^SDKWORK_IM_PROFILE_ID=cloud\.production$/mu);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('check mode detects a stale resolved profile', () => {
  const root = createRoot();
  try {
    materializeTopologyEnv({ root });
    write(root, 'etc/topology/standalone.development.env', 'STALE=1\n');
    assert.throws(
      () => materializeTopologyEnv({ root, check: true }),
      /is missing or stale/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
