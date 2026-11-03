import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditAppAccessTokenWorkspace } from './audit-app-access-token-workspace.mjs';

const PROFILES = ['standalone', 'cloud'].flatMap(
  (deploymentProfile) => ['development', 'test', 'staging', 'demo', 'production'].map(
    (environment) => `${deploymentProfile}.${environment}`,
  ),
);

function write(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

test('classifies complete and partial app token coverage', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-token-audit-'));
  try {
    write(root, 'repo/apps/demo-pc/agent.app.config.json', JSON.stringify({
      runtime: { framework: 'react-tauri' },
    }));
    for (const profile of PROFILES) {
      write(root, `repo/apps/demo-pc/.env.${profile}`, 'SDKWORK_ACCESS_TOKEN=public.token.value\n');
    }
    write(root, 'repo/apps/demo-h5/agent.app.config.json', JSON.stringify({
      runtime: { framework: 'react-h5' },
    }));
    for (const profile of PROFILES.slice(0, 5)) {
      write(root, `repo/apps/demo-h5/.env.${profile}`, 'SDKWORK_ACCESS_TOKEN=public.token.value\n');
    }

    const result = auditAppAccessTokenWorkspace(root);
    assert.equal(result.complete, 1);
    assert.equal(result.partial, 1);
    assert.deepEqual(
      result.apps.map((app) => [app.app, app.status]),
      [['demo-h5', 'partial'], ['demo-pc', 'complete']],
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
