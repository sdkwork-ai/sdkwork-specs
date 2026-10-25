import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  planDeploymentIndex,
  writeDeploymentIndex,
} from './materialize-deployment-index.mjs';

function fixture({ profileRoot = 'etc/topology', manifestAppId = 'sdkwork-demo' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-deployment-index-'));
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'agent.app.config.json'),
    `${JSON.stringify({ app: { key: manifestAppId } }, null, 2)}\n`,
  );
  const profileFiles = {
    'standalone.development': `${profileRoot}/standalone.development.env`,
    'cloud.development': `${profileRoot}/cloud.development.env`,
  };
  fs.writeFileSync(
    path.join(root, 'specs', 'topology.spec.json'),
    `${JSON.stringify({
      schemaVersion: 5,
      kind: 'sdkwork.app.topology',
      appId: 'sdkwork-demo',
      defaults: { developmentProfileId: 'standalone.development' },
      profileFiles,
    }, null, 2)}\n`,
  );
  for (const sourcePath of Object.values(profileFiles)) {
    fs.mkdirSync(path.dirname(path.join(root, sourcePath)), { recursive: true });
    fs.writeFileSync(path.join(root, sourcePath), 'SDKWORK_ENVIRONMENT=development\n');
  }
  return root;
}

test('derives a minimal deployment index without copying concrete URLs', () => {
  const root = fixture();
  const plan = planDeploymentIndex(root);

  assert.equal(plan.conflict, null);
  assert.deepEqual(plan.config, {
    schemaVersion: 1,
    kind: 'sdkwork.deployment-index',
    application: 'sdkwork-demo',
    defaultProfile: 'standalone.development',
    profiles: {
      'cloud.development': { config: 'topology/cloud.development.env' },
      'standalone.development': { config: 'topology/standalone.development.env' },
    },
  });
  assert.equal(fs.existsSync(plan.configPath), false);
});

test('writes only after an explicit write call', () => {
  const root = fixture();
  const plan = planDeploymentIndex(root);

  assert.equal(writeDeploymentIndex(plan), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(plan.configPath, 'utf8')), plan.config);
});

test('rejects retired profile roots outside etc', () => {
  const plan = planDeploymentIndex(fixture({ profileRoot: 'configs/topology' }));

  assert.match(plan.conflict, /outside etc/u);
  assert.deepEqual(plan.actions, []);
});

test('rejects application identity drift', () => {
  const plan = planDeploymentIndex(fixture({ manifestAppId: 'sdkwork-other' }));

  assert.match(plan.conflict, /application identity mismatch/u);
  assert.deepEqual(plan.actions, []);
});
