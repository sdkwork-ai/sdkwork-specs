import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApplicationAccessToken } from './app-access-token.mjs';
import { checkReleaseAccessTokenEnv } from './check-release-access-token-env.mjs';

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
