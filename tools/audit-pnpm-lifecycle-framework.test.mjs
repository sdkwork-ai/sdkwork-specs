import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditPnpmLifecycleWorkspace } from './audit-pnpm-lifecycle-framework.mjs';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('classifies framework adoption and migration waves', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-lifecycle-audit-'));
  const app = path.join(workspace, 'sdkwork-demo');
  writeJson(path.join(app, 'agent.app.config.json'), { app: { key: 'sdkwork-demo' } });
  writeJson(path.join(app, 'specs', 'topology.spec.json'), { schemaVersion: 5 });
  writeJson(path.join(app, 'sdkwork.workflow.json'), { schemaVersion: 1 });
  fs.mkdirSync(path.join(app, 'deployments'), { recursive: true });
  fs.writeFileSync(path.join(app, 'deployments', 'deploy.yaml'), 'version: 2\n');
  writeJson(path.join(app, 'package.json'), {
    scripts: {
      dev: 'pnpm dev:standalone',
      'dev:standalone': 'node ../sdkwork-app-topology/scripts/sdkwork-app.mjs dev --deployment-profile standalone',
      'dev:cloud': 'node ../sdkwork-app-topology/scripts/sdkwork-app.mjs dev --deployment-profile cloud',
      stop: 'node ../sdkwork-app-topology/scripts/sdkwork-app.mjs stop',
      build: 'node ../sdkwork-app-topology/scripts/sdkwork-app.mjs build',
      test: 'node ../sdkwork-app-topology/scripts/sdkwork-app.mjs test',
      check: 'node ../sdkwork-app-topology/scripts/sdkwork-app.mjs check',
      verify: 'node ../sdkwork-app-topology/scripts/sdkwork-app.mjs verify',
      clean: 'node ../sdkwork-app-topology/scripts/sdkwork-app.mjs clean',
    },
  });

  const report = auditPnpmLifecycleWorkspace(workspace);
  assert.equal(report.summary.applications, 1);
  assert.equal(report.summary.devProfilePairs, 1);
  assert.equal(report.summary.lifecycleFacadeAdopters, 1);
  assert.equal(report.summary.debtFree, 1);
  assert.equal(report.applications[0].wave, 1);
});

test('reports missing cloud development and facade debt', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-lifecycle-audit-'));
  const app = path.join(workspace, 'sdkwork-demo');
  writeJson(path.join(app, 'agent.app.config.json'), { app: { key: 'sdkwork-demo' } });
  writeJson(path.join(app, 'package.json'), { scripts: { dev: 'vite' } });
  const report = auditPnpmLifecycleWorkspace(workspace);
  assert.ok(report.applications[0].debt.includes('missing-script:dev:cloud'));
  assert.ok(report.applications[0].debt.includes('not-using-lifecycle-facade'));
  assert.equal(report.applications[0].wave, 4);
});

test('distinguishes an invalid topology contract from a missing topology contract', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-lifecycle-audit-'));
  const app = path.join(workspace, 'sdkwork-demo');
  writeJson(path.join(app, 'agent.app.config.json'), { app: { key: 'sdkwork-demo' } });
  writeJson(path.join(app, 'specs', 'topology.spec.json'), { schemaVersion: 4 });
  writeJson(path.join(app, 'package.json'), { scripts: {} });

  const report = auditPnpmLifecycleWorkspace(workspace);

  assert.equal(report.summary.topologyContracts, 0);
  assert.equal(report.applications[0].topologyOwnership, 'invalid');
  assert.ok(report.applications[0].debt.includes('invalid-topology-v5-contract'));
  assert.equal(report.applications[0].debt.includes('missing-topology-v5-contract'), false);
});

test('reports public release phases that bypass the shared workflow facade', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-lifecycle-audit-'));
  const app = path.join(workspace, 'sdkwork-demo');
  writeJson(path.join(app, 'agent.app.config.json'), { app: { key: 'sdkwork-demo' } });
  writeJson(path.join(app, 'sdkwork.workflow.json'), { schemaVersion: 1 });
  writeJson(path.join(app, 'package.json'), {
    scripts: {
      dev: 'pnpm dev:standalone',
      'dev:standalone': 'pnpm exec sdkwork-app dev --deployment-profile standalone',
      'dev:cloud': 'pnpm exec sdkwork-app dev --deployment-profile cloud',
      stop: 'pnpm exec sdkwork-app stop',
      build: 'pnpm exec sdkwork-app build',
      test: 'pnpm exec sdkwork-app test',
      check: 'pnpm exec sdkwork-app check',
      verify: 'pnpm exec sdkwork-app verify',
      clean: 'pnpm exec sdkwork-app clean',
      'release:package': 'pnpm release:package:standalone',
      'release:package:standalone': 'node scripts/package.mjs',
      'release:package:cloud': 'pnpm exec sdkwork-app release:package --deployment-profile cloud',
      'release:package:check': 'node scripts/package.mjs --check',
      'release:validate': 'node scripts/validate.mjs',
    },
  });

  const report = auditPnpmLifecycleWorkspace(workspace);

  assert.deepEqual(
    report.applications[0].debt.filter((issue) => issue.startsWith('public-release-')),
    [
      'public-release-bypasses-workflow:release:package:standalone',
      'public-release-bypasses-workflow:release:validate',
    ],
  );
  assert.ok(report.applications[0].debt.includes('release-workflow-missing-phase:package'));
  assert.equal(report.summary.debtFree, 0);
});

test('records malformed application manifests as debt instead of aborting the workspace audit', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-lifecycle-audit-'));
  const app = path.join(workspace, 'sdkwork-broken');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'agent.app.config.json'), '{ broken\n');
  fs.writeFileSync(path.join(app, 'package.json'), '{ broken\n');

  const report = auditPnpmLifecycleWorkspace(workspace);
  assert.equal(report.summary.applications, 1);
  assert.ok(report.applications[0].debt.includes('invalid-app-manifest-json'));
  assert.ok(report.applications[0].debt.includes('invalid-package-manifest-json'));
});

test('recognizes an app surface that explicitly delegates topology to its enclosing application', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-lifecycle-audit-'));
  const repository = path.join(workspace, 'sdkwork-demo');
  const app = path.join(repository, 'apps', 'sdkwork-demo-pc');
  writeJson(path.join(repository, 'specs', 'topology.spec.json'), {
    schemaVersion: 5,
    kind: 'sdkwork.app.topology',
  });
  writeJson(path.join(repository, 'etc', 'sdkwork.deployment.config.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.deployment-config',
  });
  writeJson(path.join(app, 'agent.app.config.json'), { app: { key: 'sdkwork-demo-pc' } });
  writeJson(path.join(app, 'etc', 'sdkwork.deployment.config.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.component-deployment',
    parentDeploymentConfig: '../../../etc/sdkwork.deployment.config.json',
    parentTopologySpec: '../../../specs/topology.spec.json',
  });
  const facade = 'pnpm exec sdkwork-app';
  writeJson(path.join(app, 'package.json'), {
    scripts: {
      dev: 'pnpm dev:standalone',
      'dev:standalone': `${facade} dev --root ../.. --deployment-profile standalone`,
      'dev:cloud': `${facade} dev --root ../.. --deployment-profile cloud`,
      stop: `${facade} stop --root ../..`,
    },
  });

  const report = auditPnpmLifecycleWorkspace(workspace);
  assert.equal(report.summary.applications, 1);
  assert.equal(report.summary.topologyContracts, 1);
  assert.equal(report.summary.debtFree, 1);
  assert.equal(report.applications[0].delegatedSurface, true);
  assert.equal(report.applications[0].debt.some((issue) => issue.startsWith('missing-script:')), false);
  assert.equal(report.applications[0].topologyOwnership, 'delegated');
  assert.equal(report.applications[0].wave, 3);
});

test('does not require pnpm lifecycle scripts for a native Flutter application root', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-lifecycle-audit-'));
  const repository = path.join(workspace, 'sdkwork-demo');
  const app = path.join(repository, 'apps', 'sdkwork-demo-flutter-mobile');
  writeJson(path.join(repository, 'specs', 'topology.spec.json'), { schemaVersion: 5 });
  writeJson(path.join(repository, 'etc', 'sdkwork.deployment.config.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.deployment-index',
  });
  writeJson(path.join(app, 'agent.app.config.json'), {
    app: { key: 'sdkwork-demo-flutter-mobile' },
    runtime: { family: 'mobile', framework: 'flutter' },
  });
  writeJson(path.join(app, 'etc', 'sdkwork.deployment.config.json'), {
    schemaVersion: 1,
    kind: 'sdkwork.component-deployment',
    parentDeploymentConfig: '../../../etc/sdkwork.deployment.config.json',
    parentTopologySpec: '../../../specs/topology.spec.json',
  });

  const report = auditPnpmLifecycleWorkspace(workspace);

  assert.equal(report.applications[0].pnpmManaged, false);
  assert.equal(report.applications[0].debt.includes('missing-package-manifest'), false);
  assert.equal(report.applications[0].debt.some((issue) => issue.startsWith('missing-script:')), false);
  assert.equal(report.applications[0].debt.length, 0);
});

test('recognizes Flutter framework declarations across supported application manifest shapes', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-lifecycle-audit-'));
  const manifests = {
    'top-level-architecture': {
      applicationCode: 'sdkwork-image-flutter-mobile',
      architecture: 'flutter',
    },
    'app-runtime': {
      app: {
        id: 'sdkwork-mail-flutter-mobile',
        runtime: { framework: 'flutter' },
      },
    },
    'application-runtime': {
      application: {
        code: 'sdkwork-search-flutter-mobile',
        runtime: { framework: 'flutter' },
      },
    },
  };

  for (const [name, manifest] of Object.entries(manifests)) {
    writeJson(path.join(workspace, name, 'agent.app.config.json'), manifest);
  }

  const report = auditPnpmLifecycleWorkspace(workspace);

  assert.equal(report.summary.applications, 3);
  for (const application of report.applications) {
    assert.equal(application.pnpmManaged, false, application.root);
    assert.equal(application.debt.includes('missing-package-manifest'), false, application.root);
    assert.equal(
      application.debt.some((issue) => issue.startsWith('missing-script:')),
      false,
      application.root,
    );
  }
});
