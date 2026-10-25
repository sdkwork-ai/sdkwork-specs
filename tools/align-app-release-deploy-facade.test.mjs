import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { planReleaseDeployFacadeAlignment } from './align-app-release-deploy-facade.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-release-deploy-facade-'));
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'deployments'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'topology.spec.json'), JSON.stringify({ schemaVersion: 5 }));
  fs.writeFileSync(path.join(root, 'agent.workflow.json'), '{}');
  fs.writeFileSync(path.join(root, 'deployments', 'deploy.yaml'), 'version: 1\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { '@sdkwork/app-topology': 'workspace:*' },
    scripts: {
      'release:plan': 'node scripts/legacy-plan.mjs',
      'release:plan:standalone': 'node scripts/legacy-standalone-plan.mjs',
      'release:package': 'node scripts/legacy-package.mjs',
      'deploy:validate': 'node scripts/legacy-deploy-validate.mjs',
    },
  }));
  return root;
}

test('adds paired profile entrypoints and delegates them to sdkwork-app', () => {
  const root = fixture();
  const plan = planReleaseDeployFacadeAlignment(root);

  assert.equal(plan.manifest.scripts['release:plan:standalone'], 'pnpm exec sdkwork-app release:plan --deployment-profile standalone');
  assert.equal(plan.manifest.scripts['release:plan:cloud'], 'pnpm exec sdkwork-app release:plan --deployment-profile cloud');
  assert.equal(plan.manifest.scripts['release:package:standalone'], 'pnpm exec sdkwork-app release:package --deployment-profile standalone');
  assert.equal(plan.manifest.scripts['release:package:cloud'], 'pnpm exec sdkwork-app release:package --deployment-profile cloud');
  assert.equal(plan.manifest.scripts['deploy:validate:standalone'], 'pnpm exec sdkwork-app deploy:validate --deployment-profile standalone');
  assert.equal(plan.manifest.scripts['deploy:validate:cloud'], 'pnpm exec sdkwork-app deploy:validate --deployment-profile cloud');
  assert.equal(plan.manifest.scripts['_sdkwork:release:plan:standalone'], 'node scripts/legacy-standalone-plan.mjs');
  assert.equal(plan.manifest.scripts['release:plan'], 'node scripts/legacy-plan.mjs');
});

test('is idempotent when profile entrypoints already use the facade', () => {
  const root = fixture();
  const first = planReleaseDeployFacadeAlignment(root);
  fs.writeFileSync(first.packagePath, `${JSON.stringify(first.manifest, null, 2)}\n`);

  const second = planReleaseDeployFacadeAlignment(root);

  assert.deepEqual(second.actions, []);
});

test('only creates release variants supported by fixed workflow targets', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'agent.workflow.json'), JSON.stringify({
    targets: [{ deploymentProfile: 'cloud' }],
  }));

  const plan = planReleaseDeployFacadeAlignment(root);

  assert.equal(plan.manifest.scripts['release:package:cloud'], 'pnpm exec sdkwork-app release:package --deployment-profile cloud');
  assert.equal(plan.manifest.scripts['release:package:standalone'], undefined);
});

test('delegates a bare release phase when workflow ownership and one profile are unambiguous', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'agent.workflow.json'), JSON.stringify({
    lifecycle: {
      package: [{ run: 'node scripts/workflow-package.mjs' }],
      validate: [{ run: 'node scripts/workflow-validate.mjs' }],
    },
    targets: [{ deploymentProfile: 'cloud' }],
  }));
  const packagePath = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  manifest.scripts['release:validate'] = 'node scripts/legacy-validate.mjs';
  fs.writeFileSync(packagePath, JSON.stringify(manifest));

  const plan = planReleaseDeployFacadeAlignment(root);

  assert.equal(plan.manifest.scripts['release:package'], 'pnpm release:package:cloud');
  assert.equal(plan.manifest.scripts['_sdkwork:release:package'], 'node scripts/legacy-package.mjs');
  assert.equal(plan.manifest.scripts['release:validate'], 'pnpm release:validate:cloud');
  assert.equal(plan.manifest.scripts['_sdkwork:release:validate'], 'node scripts/legacy-validate.mjs');
});

test('delegates only runtime target release scripts with an explicit supported profile', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'agent.workflow.json'), JSON.stringify({
    lifecycle: {
      package: [{ run: 'node scripts/workflow-package.mjs' }],
    },
    targets: [
      { deploymentProfile: 'standalone', runtimeTarget: 'desktop' },
      { deploymentProfile: 'cloud', runtimeTarget: 'browser' },
    ],
  }));
  const packagePath = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  manifest.scripts['release:package:desktop'] = 'node scripts/package-desktop.mjs';
  manifest.scripts['release:package:browser:cloud'] = 'node scripts/package-browser.mjs';
  manifest.scripts['release:package:desktop:debug'] = 'node scripts/package-debug.mjs';
  manifest.scripts['release:package:server'] = 'node scripts/package-server.mjs';
  fs.writeFileSync(packagePath, JSON.stringify(manifest));

  const plan = planReleaseDeployFacadeAlignment(root);

  assert.equal(plan.manifest.scripts['release:package:desktop'], 'node scripts/package-desktop.mjs');
  assert.equal(
    plan.manifest.scripts['release:package:browser:cloud'],
    'pnpm exec sdkwork-app release:package --deployment-profile cloud --runtime-target browser',
  );
  assert.equal(plan.manifest.scripts['_sdkwork:release:package:desktop'], undefined);
  assert.equal(plan.manifest.scripts['release:package:desktop:debug'], 'node scripts/package-debug.mjs');
  assert.equal(plan.manifest.scripts['release:package:server'], 'node scripts/package-server.mjs');
});

test('creates profile variants when only runtime-target release commands exist', () => {
  const root = fixture();
  const packagePath = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  delete manifest.scripts['release:package'];
  manifest.scripts['release:package:desktop'] = 'node scripts/package-desktop.mjs';
  fs.writeFileSync(packagePath, JSON.stringify(manifest));

  const plan = planReleaseDeployFacadeAlignment(root);
  assert.equal(
    plan.manifest.scripts['release:package:standalone'],
    'pnpm exec sdkwork-app release:package --deployment-profile standalone',
  );
  assert.equal(
    plan.manifest.scripts['release:package:cloud'],
    'pnpm exec sdkwork-app release:package --deployment-profile cloud',
  );
  assert.equal(
    plan.manifest.scripts['release:package:desktop'],
    'node scripts/package-desktop.mjs',
  );
});

test('can align release scripts without changing deploy governance', () => {
  const root = fixture();
  const plan = planReleaseDeployFacadeAlignment(root, { scope: 'release' });

  assert.equal(plan.manifest.scripts['release:package:standalone'], 'pnpm exec sdkwork-app release:package --deployment-profile standalone');
  assert.equal(plan.manifest.scripts['deploy:validate:standalone'], undefined);
  assert.equal(plan.manifest.scripts['deploy:validate'], 'node scripts/legacy-deploy-validate.mjs');
});
