import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditEnvInheritanceWorkspace } from './audit-env-inheritance-workspace.mjs';

function write(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

test('classifies inherited and legacy repositories', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-env-audit-'));
  try {
    write(root, 'repo-inherited/etc/sdkwork.deployment.config.json', JSON.stringify({
      profiles: {
        'standalone.development': { config: 'topology/standalone.development.env' },
        'cloud.production': { config: 'topology/cloud.production.env' },
      },
    }));
    write(root, 'repo-inherited/etc/topology/base.env', 'SHARED=1\n');
    write(root, 'repo-inherited/etc/topology/overrides/standalone.development.env', 'A=1\n');
    write(root, 'repo-inherited/etc/topology/standalone.development.env', 'A=1\n');
    write(root, 'repo-inherited/etc/topology/cloud.production.env', 'B=1\n');

    write(root, 'repo-legacy/etc/sdkwork.deployment.config.json', JSON.stringify({
      profiles: {
        'standalone.development': { config: 'topology/standalone.development.env' },
      },
    }));
    write(root, 'repo-legacy/etc/topology/standalone.development.env', 'A=1\n');

    const result = auditEnvInheritanceWorkspace(root);
    assert.equal(result.inherited, 1);
    assert.equal(result.legacy, 1);
    assert.deepEqual(
      result.repos.map((repo) => [repo.repo, repo.status]),
      [['repo-inherited', 'inherited'], ['repo-legacy', 'legacy']],
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
