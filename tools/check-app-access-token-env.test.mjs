import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkAppAccessTokenEnv } from './check-app-access-token-env.mjs';
import { createApplicationAccessToken } from './app-access-token.mjs';

const ANCHOR_ENV = 'SDKWORK_DEPLOY_APPLICATION_ID';

function writeFixture(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

function createRoot({ accessToken, tokenAppId = 'demo-app' }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-access-token-check-'));
  writeFixture(root, 'etc/client-env.materialization.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.client-env-materialization',
    surfaces: [{
      id: 'demo-app',
      root: 'apps/demo',
      format: 'mini-program',
      runtimeTarget: 'mini-program',
      accessToken,
    }],
  }, null, 2));
  writeFixture(
    root,
    'apps/demo/config/mini-program/runtime-env.standalone.development.json',
    JSON.stringify({
      SDKWORK_ACCESS_TOKEN: createApplicationAccessToken({
        appId: tokenAppId,
        tenantId: '100001',
        organizationId: '0',
        environment: 'development',
        deploymentProfile: 'standalone',
        runtimeTarget: 'mini-program',
        permissionScope: ['iam:self'],
      }),
    }, null, 2),
  );
  return root;
}

test('env-sourced appId is skipped when the deployment anchor is unavailable', () => {
  const root = createRoot({ accessToken: { appIdEnv: ANCHOR_ENV } });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: {},
    });
    assert.equal(result.skipped, true);
    assert.equal(result.checked, 0);
    assert.match(result.reason, new RegExp(`skipped: ${ANCHOR_ENV} not set`, 'u'));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('env-sourced appId compares the token against the deployment anchor', () => {
  const root = createRoot({
    accessToken: { appIdEnv: ANCHOR_ENV },
    tokenAppId: 'app-anchor-1',
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: { [ANCHOR_ENV]: 'app-anchor-1' },
    });
    assert.equal(result.skipped, undefined);
    assert.equal(result.checked, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('env-sourced appId fails when the token carries a different app id', () => {
  const root = createRoot({ accessToken: { appIdEnv: ANCHOR_ENV } });
  try {
    assert.throws(
      () => checkAppAccessTokenEnv({
        root,
        profileId: 'standalone.development',
        env: { [ANCHOR_ENV]: 'app-anchor-1' },
      }),
      /app_id=demo-app does not match app-anchor-1/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('literal appId keeps comparing without any environment variable', () => {
  const root = createRoot({ accessToken: { appId: 'demo-app' } });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: {},
    });
    assert.equal(result.checked, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('excluded profiles are not compared against this surface identity', () => {
  const root = createRoot({
    accessToken: { appIdEnv: ANCHOR_ENV },
    tokenAppId: 'dev-owned-token',
  });
  try {
    writeFixture(root, 'etc/client-env.materialization.json', JSON.stringify({
      schemaVersion: 1,
      kind: 'sdkwork.client-env-materialization',
      surfaces: [{
        id: 'demo-app',
        root: 'apps/demo',
        format: 'mini-program',
        runtimeTarget: 'mini-program',
        excludeProfiles: ['standalone.development'],
        accessToken: { appIdEnv: ANCHOR_ENV },
      }],
    }, null, 2));
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: { [ANCHOR_ENV]: 'app-anchor-1' },
    });
    assert.equal(result.checked, 0);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
