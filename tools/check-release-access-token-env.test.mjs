import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID,
  createApplicationAccessToken,
} from './app-access-token.mjs';
import { checkReleaseAccessTokenEnv } from './check-release-access-token-env.mjs';

const ANCHOR_ENV = 'SDKWORK_DEPLOY_APPLICATION_ID';
const PC_ANCHOR_ENV = `${ANCHOR_ENV}_DEMO_PC`;
const H5_ANCHOR_ENV = `${ANCHOR_ENV}_DEMO_H5`;

function write(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-release-token-'));
  write(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    profiles: {
      'standalone.development': { config: 'topology/standalone.development.env' },
      'cloud.production': { config: 'topology/cloud.production.env' },
    },
  }));
  write(root, 'etc/client-env.materialization.json', JSON.stringify({
    surfaces: [{
      id: 'demo-pc',
      root: 'apps/demo-pc',
      format: 'vite',
      accessToken: { appId: 'demo-app' },
    }],
  }));
  write(root, 'apps/demo-pc/agent.app.config.json', JSON.stringify({
    app: { key: 'demo-app' },
    backend: { appId: 'demo-app' },
    runtime: { framework: 'react-vite' },
  }));
  return root;
}

function createToken(appId, {
  environment = 'production',
  deploymentProfile = 'cloud',
  runtimeTarget = 'browser',
} = {}) {
  return createApplicationAccessToken({
    appId,
    tenantId: '100001',
    organizationId: '0',
    environment,
    deploymentProfile,
    runtimeTarget,
    permissionScope: ['iam:self'],
  });
}

function viteSurface(id, rootPath) {
  return {
    id,
    root: rootPath,
    format: 'vite',
    runtimeTarget: 'browser',
    accessToken: { appIdEnv: ANCHOR_ENV },
  };
}

function createSurfaceRoot({ surfaces, files = {}, deploymentProfiles = ['cloud.production'] }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-release-token-surface-'));
  write(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    profiles: Object.fromEntries(deploymentProfiles.map((profileId) => [
      profileId,
      { config: `topology/${profileId}.env` },
    ])),
  }));
  write(root, 'etc/client-env.materialization.json', JSON.stringify({ surfaces }));
  for (const [relativePath, contents] of Object.entries(files)) {
    write(root, relativePath, contents);
  }
  return root;
}

test('fails when a release profile has no access token', () => {
  const root = fixture();
  try {
    write(root, 'apps/demo-pc/.env.cloud.production', 'VITE_API_BASE_URL=/v1\n');
    const result = checkReleaseAccessTokenEnv(root);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].reason, /SDKWORK_ACCESS_TOKEN is missing/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('passes when every release profile carries a matching public token', () => {
  const root = fixture();
  try {
    const token = createApplicationAccessToken({
      appId: 'demo-app',
      tenantId: '100001',
      organizationId: '0',
      environment: 'production',
      deploymentProfile: 'cloud',
      runtimeTarget: 'browser',
    });
    write(root, 'apps/demo-pc/.env.cloud.production', `SDKWORK_ACCESS_TOKEN=${token}\n`);
    const result = checkReleaseAccessTokenEnv(root);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.checked, ['demo-pc/cloud.production']);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('skips a server-only repository when allowNoSurfaces is set', () => {
  const root = fixture();
  try {
    rmSync(path.join(root, 'etc/client-env.materialization.json'));
    const result = checkReleaseAccessTokenEnv(root, { allowNoSurfaces: true });
    assert.deepEqual(result.failures, []);
    assert.equal(result.skipped, true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('each release surface verifies against its own surface-scoped anchor', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc'), viteSurface('demo-h5', 'apps/h5')],
    files: {
      'apps/pc/.env.cloud.production': `SDKWORK_ACCESS_TOKEN=${createToken('app-pc')}\n`,
      'apps/h5/.env.cloud.production': `SDKWORK_ACCESS_TOKEN=${createToken('app-h5')}\n`,
    },
  });
  try {
    const result = checkReleaseAccessTokenEnv(root, {
      env: { [PC_ANCHOR_ENV]: 'app-pc', [H5_ANCHOR_ENV]: 'app-h5' },
    });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.checked, ['demo-pc/cloud.production', 'demo-h5/cloud.production']);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a release surface verified against another surface anchor fails', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc'), viteSurface('demo-h5', 'apps/h5')],
    files: {
      'apps/pc/.env.cloud.production': `SDKWORK_ACCESS_TOKEN=${createToken('app-h5')}\n`,
      'apps/h5/.env.cloud.production': `SDKWORK_ACCESS_TOKEN=${createToken('app-h5')}\n`,
    },
  });
  try {
    const result = checkReleaseAccessTokenEnv(root, {
      env: { [PC_ANCHOR_ENV]: 'app-pc', [H5_ANCHOR_ENV]: 'app-h5' },
    });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].profileId, /^demo-pc\/cloud\.production$/u);
    assert.match(result.failures[0].reason, /app_id=app-h5 does not match app-pc/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a surface anchor recorded in the resolved profile layer is verified without a process variable', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc')],
    files: {
      'apps/pc/.env.cloud.production': `SDKWORK_ACCESS_TOKEN=${createToken('app-pc')}\n`,
      'etc/topology/cloud.production.env': `${PC_ANCHOR_ENV}=app-pc\n`,
    },
  });
  try {
    const result = checkReleaseAccessTokenEnv(root, { env: {} });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.checked, ['demo-pc/cloud.production']);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('the repository-level variable remains the fallback for a release surface', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc')],
    files: {
      'apps/pc/.env.cloud.production': `SDKWORK_ACCESS_TOKEN=${createToken('app-shared')}\n`,
    },
  });
  try {
    const result = checkReleaseAccessTokenEnv(root, { env: { [ANCHOR_ENV]: 'app-shared' } });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.checked, ['demo-pc/cloud.production']);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('--surface limits the release check to the selected surface', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc'), viteSurface('demo-h5', 'apps/h5')],
    files: {
      'apps/pc/.env.cloud.production': `SDKWORK_ACCESS_TOKEN=${createToken('app-pc')}\n`,
    },
  });
  try {
    const result = checkReleaseAccessTokenEnv(root, {
      surfaceIds: ['demo-pc'],
      env: { [PC_ANCHOR_ENV]: 'app-pc', [H5_ANCHOR_ENV]: 'app-h5' },
    });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.checked, ['demo-pc/cloud.production']);
    assert.throws(
      () => checkReleaseAccessTokenEnv(root, {
        surfaceIds: ['demo-missing'],
        env: { [PC_ANCHOR_ENV]: 'app-pc' },
      }),
      /is not declared/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a committed placeholder token needs materialization and fails under --require-anchor', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc')],
    files: {
      'apps/pc/.env.cloud.production':
        `SDKWORK_ACCESS_TOKEN=${createToken(PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID)}\n`,
    },
  });
  try {
    const result = checkReleaseAccessTokenEnv(root, { env: { [PC_ANCHOR_ENV]: 'app-pc' } });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.pending, [{
      profileId: 'demo-pc/cloud.production',
      file: 'apps/pc/.env.cloud.production',
    }]);
    const strict = checkReleaseAccessTokenEnv(root, {
      env: { [PC_ANCHOR_ENV]: 'app-pc' },
      requireAnchor: true,
    });
    assert.equal(strict.failures.length, 1);
    assert.match(strict.failures[0].reason, /needs materialization/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('no anchor at all keeps the release check a skip, not a failure', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc')],
    files: {
      'apps/pc/.env.cloud.production': `SDKWORK_ACCESS_TOKEN=${createToken('app-pc')}\n`,
    },
  });
  try {
    const result = checkReleaseAccessTokenEnv(root, { env: {} });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.checked, []);
    assert.equal(result.skippedSurfaces.length, 1);
    assert.match(result.skippedSurfaces[0].reason, /is required to verify/u);
    const strict = checkReleaseAccessTokenEnv(root, { env: {}, requireAnchor: true });
    assert.equal(strict.failures.length, 1);
    assert.match(strict.failures[0].reason, /is required to verify/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
