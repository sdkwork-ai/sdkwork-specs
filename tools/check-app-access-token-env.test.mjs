import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkAppAccessTokenEnv } from './check-app-access-token-env.mjs';
import {
  PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID,
  createApplicationAccessToken,
  decodeApplicationAccessToken,
} from './app-access-token.mjs';

const ANCHOR_ENV = 'SDKWORK_DEPLOY_APPLICATION_ID';
const PC_ANCHOR_ENV = `${ANCHOR_ENV}_DEMO_PC`;
const H5_ANCHOR_ENV = `${ANCHOR_ENV}_DEMO_H5`;

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

function createToken(appId, {
  environment = 'development',
  deploymentProfile = 'standalone',
  runtimeTarget = 'browser',
  organizationId = '0',
  ownershipScope,
  userId,
} = {}) {
  return createApplicationAccessToken({
    appId,
    tenantId: '100001',
    organizationId,
    environment,
    deploymentProfile,
    runtimeTarget,
    permissionScope: ['iam:self'],
    ...(ownershipScope ? { ownershipScope } : {}),
    ...(userId ? { userId } : {}),
  });
}

function withoutOwnershipScope(token) {
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  delete claims.ownership_scope;
  const encoded = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${header}.${encoded}.${signature}`;
}

function viteSurface(id, rootPath, appIdEnv = ANCHOR_ENV) {
  return {
    id,
    root: rootPath,
    format: 'vite',
    runtimeTarget: 'browser',
    accessToken: { appIdEnv },
  };
}

function createSurfaceRoot({ surfaces, files = {}, deploymentProfiles = ['standalone.development'] }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-access-token-surface-'));
  writeFixture(root, 'etc/client-env.materialization.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.client-env-materialization',
    deploymentConfig: 'sdkwork.deployment.config.json',
    surfaces,
  }, null, 2));
  writeFixture(root, 'etc/sdkwork.deployment.config.json', JSON.stringify({
    profiles: Object.fromEntries(deploymentProfiles.map((profileId) => [
      profileId,
      { config: `topology/${profileId}.env` },
    ])),
  }, null, 2));
  for (const [relativePath, contents] of Object.entries(files)) {
    writeFixture(root, relativePath, contents);
  }
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

test('each surface resolves its own surface-scoped anchor', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc'), viteSurface('demo-h5', 'apps/h5')],
    files: {
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-pc')}\n`,
      'apps/h5/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-h5')}\n`,
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: { [PC_ANCHOR_ENV]: 'app-pc', [H5_ANCHOR_ENV]: 'app-h5' },
    });
    assert.equal(result.checked, 2);
    assert.equal(result.skipped, undefined);
    assert.deepEqual(
      result.surfaceAnchors.map((surface) => [surface.surfaceId, surface.anchors[0].appId, surface.anchors[0].source]),
      [['demo-pc', 'app-pc', 'environment'], ['demo-h5', 'app-h5', 'environment']],
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a surface verified against another surface anchor fails', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc'), viteSurface('demo-h5', 'apps/h5')],
    files: {
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-h5')}\n`,
      'apps/h5/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-h5')}\n`,
    },
  });
  try {
    assert.throws(
      () => checkAppAccessTokenEnv({
        root,
        profileId: 'standalone.development',
        env: { [PC_ANCHOR_ENV]: 'app-pc', [H5_ANCHOR_ENV]: 'app-h5' },
      }),
      /demo-pc: apps\/pc\/\.env\.standalone\.development: Public application access token claim app_id=app-h5 does not match app-pc/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('the resolved profile layer records each surface anchor', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc'), viteSurface('demo-h5', 'apps/h5')],
    files: {
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-pc')}\n`,
      'apps/h5/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-h5')}\n`,
      'etc/topology/standalone.development.env': [
        `${PC_ANCHOR_ENV}=app-pc`,
        `${H5_ANCHOR_ENV}=app-h5`,
      ].join('\n'),
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: {},
    });
    assert.equal(result.checked, 2);
    assert.equal(result.skipped, undefined);
    for (const surface of result.surfaceAnchors) {
      assert.equal(surface.anchors[0].source, 'recorded');
      assert.equal(surface.anchors[0].file, 'etc/topology/standalone.development.env');
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('the authored override layer records a surface anchor without a deployment index file', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc')],
    files: {
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-pc')}\n`,
      'etc/topology/overrides/standalone.development.env': `${PC_ANCHOR_ENV}=app-pc\n`,
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: {},
    });
    assert.equal(result.checked, 1);
    assert.equal(result.surfaceAnchors[0].anchors[0].source, 'recorded');
    assert.equal(
      result.surfaceAnchors[0].anchors[0].file,
      'etc/topology/overrides/standalone.development.env',
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('the repository-level variable is the fallback for every surface', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc'), viteSurface('demo-h5', 'apps/h5')],
    files: {
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-shared')}\n`,
      'apps/h5/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-shared')}\n`,
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: { [ANCHOR_ENV]: 'app-shared' },
    });
    assert.equal(result.checked, 2);
    assert.deepEqual(
      result.surfaceAnchors.map((surface) => [surface.anchors[0].appId, surface.anchors[0].source]),
      [['app-shared', 'repository'], ['app-shared', 'repository']],
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('--surface limits the check to the selected surface', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc'), viteSurface('demo-h5', 'apps/h5')],
    files: {
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-pc')}\n`,
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      surfaceIds: ['demo-pc'],
      env: { [PC_ANCHOR_ENV]: 'app-pc' },
    });
    assert.equal(result.checked, 1);
    assert.deepEqual(result.surfaceAnchors.map((surface) => surface.surfaceId), ['demo-pc']);
    assert.throws(
      () => checkAppAccessTokenEnv({
        root,
        profileId: 'standalone.development',
        surfaceIds: ['demo-missing'],
        env: { [PC_ANCHOR_ENV]: 'app-pc' },
      }),
      /is not declared/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a committed placeholder token is reported as needing materialization', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc')],
    files: {
      'apps/pc/.env.standalone.development':
        `SDKWORK_ACCESS_TOKEN=${createToken(PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID)}\n`,
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: { [PC_ANCHOR_ENV]: 'app-pc' },
    });
    assert.equal(result.checked, 0);
    assert.equal(result.pending.length, 1);
    assert.equal(result.pending[0].surfaceId, 'demo-pc');
    assert.throws(
      () => checkAppAccessTokenEnv({
        root,
        profileId: 'standalone.development',
        env: { [PC_ANCHOR_ENV]: 'app-pc' },
        requireAnchor: true,
      }),
      /needs materialization/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('--require-anchor fails when no layer carries the anchor', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc')],
    files: {
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-pc')}\n`,
    },
  });
  try {
    assert.throws(
      () => checkAppAccessTokenEnv({
        root,
        profileId: 'standalone.development',
        env: {},
        requireAnchor: true,
      }),
      /SDKWORK_DEPLOY_APPLICATION_ID_DEMO_PC \(or SDKWORK_DEPLOY_APPLICATION_ID\) is required/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a USER surface verifies the personal release claim and its owner', () => {
  const surface = {
    ...viteSurface('demo-pc', 'apps/pc'),
    accessToken: {
      appIdEnv: ANCHOR_ENV,
      ownershipScope: 'USER',
      ownerUserId: 'user-7',
    },
  };
  const root = createSurfaceRoot({
    surfaces: [surface],
    files: {
      'apps/pc/.env.standalone.development':
        `SDKWORK_ACCESS_TOKEN=${createToken('app-pc', { ownershipScope: 'USER', userId: 'user-7' })}\n`,
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: { [ANCHOR_ENV]: 'app-pc' },
    });
    assert.equal(result.checked, 1);
    assert.equal(result.skipped, undefined);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a tenant token fails a USER surface that requires the personal claim', () => {
  const surface = {
    ...viteSurface('demo-pc', 'apps/pc'),
    accessToken: {
      appIdEnv: ANCHOR_ENV,
      ownershipScope: 'USER',
      ownerUserId: 'user-7',
    },
  };
  const root = createSurfaceRoot({
    surfaces: [surface],
    files: {
      'apps/pc/.env.standalone.development':
        `SDKWORK_ACCESS_TOKEN=${createToken('app-pc', { ownershipScope: 'TENANT' })}\n`,
    },
  });
  try {
    assert.throws(
      () => checkAppAccessTokenEnv({
        root,
        profileId: 'standalone.development',
        env: { [ANCHOR_ENV]: 'app-pc' },
      }),
      /claim ownership_scope=TENANT does not match USER/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('an ORGANIZATION surface requires the explicit claim', () => {
  const surface = {
    ...viteSurface('demo-pc', 'apps/pc'),
    accessToken: {
      appIdEnv: ANCHOR_ENV,
      organizationId: '42',
      ownershipScope: 'ORGANIZATION',
    },
  };
  const token = createToken('app-pc', { ownershipScope: 'ORGANIZATION', organizationId: '42' });
  const root = createSurfaceRoot({
    surfaces: [surface],
    files: {
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${token}\n`,
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: { [ANCHOR_ENV]: 'app-pc' },
    });
    assert.equal(result.checked, 1);

    // Same claims, but the legacy token omits the claim: only a TENANT surface
    // may accept that derivation.
    writeFixture(
      root,
      'apps/pc/.env.standalone.development',
      `SDKWORK_ACCESS_TOKEN=${withoutOwnershipScope(token)}\n`,
    );
    assert.throws(
      () => checkAppAccessTokenEnv({
        root,
        profileId: 'standalone.development',
        env: { [ANCHOR_ENV]: 'app-pc' },
      }),
      /missing claim ownership_scope=ORGANIZATION; an absent claim is only valid for TENANT/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a legacy tenant token without the claim still verifies a TENANT surface', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc')],
    files: {
      'apps/pc/.env.standalone.development':
        `SDKWORK_ACCESS_TOKEN=${withoutOwnershipScope(createToken('app-pc'))}\n`,
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: { [ANCHOR_ENV]: 'app-pc' },
    });
    assert.equal(result.checked, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('an ORGANIZATION surface derives its expected scope from the organization binding', () => {
  // Only the organization id is declared: the gate must expect ORGANIZATION
  // (`organization-binding`) and verify the organization-level token, not
  // default to TENANT and reject it.
  const surface = {
    id: 'demo-pc',
    root: 'apps/pc',
    format: 'vite',
    runtimeTarget: 'browser',
    accessToken: { appIdEnv: ANCHOR_ENV, organizationId: '42' },
  };
  const token = createToken('app-pc', { ownershipScope: 'ORGANIZATION', organizationId: '42' });
  const root = createSurfaceRoot({
    surfaces: [surface],
    files: {
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${token}\n`,
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: { [ANCHOR_ENV]: 'app-pc' },
    });
    assert.equal(result.checked, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a declaration that names another tenant than the root manifest fails the gate', () => {
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc')],
    files: {
      'apps/pc/agent.app.config.json': JSON.stringify({
        backend: { tenantId: '100002', organizationId: '0' },
      }, null, 2),
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${createToken('app-pc')}\n`,
    },
  });
  try {
    assert.throws(
      () => checkAppAccessTokenEnv({
        root,
        profileId: 'standalone.development',
        env: { [ANCHOR_ENV]: 'app-pc' },
      }),
      /accessToken\.tenantId=100001 contradicts the manifest backend\.tenantId=100002/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a packaged token is permanently valid and an elapsed rotation deadline fails', () => {
  const token = createToken('app-pc');
  assert.equal(
    decodeApplicationAccessToken(token).payload.exp,
    0,
    'the committed token ships permanent (exp=0)',
  );
  const root = createSurfaceRoot({
    surfaces: [viteSurface('demo-pc', 'apps/pc')],
    files: {
      'apps/pc/.env.standalone.development': `SDKWORK_ACCESS_TOKEN=${token}\n`,
    },
  });
  try {
    const result = checkAppAccessTokenEnv({
      root,
      profileId: 'standalone.development',
      env: { [ANCHOR_ENV]: 'app-pc' },
    });
    assert.equal(result.checked, 1);

    // A rotation deadline that already elapsed cannot keep shipping: the gate
    // names it instead of letting a dead credential reach a package.
    const elapsed = createApplicationAccessToken({
      appId: 'app-pc',
      tenantId: '100001',
      organizationId: '0',
      environment: 'development',
      deploymentProfile: 'standalone',
      runtimeTarget: 'browser',
      expiresAt: 1_780_000_000,
    });
    writeFixture(root, 'apps/pc/.env.standalone.development', `SDKWORK_ACCESS_TOKEN=${elapsed}\n`);
    assert.throws(
      () => checkAppAccessTokenEnv({
        root,
        profileId: 'standalone.development',
        env: { [ANCHOR_ENV]: 'app-pc' },
      }),
      /expired at 1780000000/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
