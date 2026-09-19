import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { planTopologyDelegation } from './align-app-topology-delegation.mjs';

function fixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-topology-delegation-'));
  const app = path.join(repo, 'apps', 'sdkwork-demo-pc');
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'etc'), { recursive: true });
  fs.mkdirSync(path.join(app, 'etc'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'specs', 'topology.spec.json'), JSON.stringify({ schemaVersion: 5 }));
  fs.writeFileSync(path.join(repo, 'etc', 'sdkwork.deployment.config.json'), '{}');
  fs.writeFileSync(path.join(app, 'sdkwork.app.config.json'), JSON.stringify({ app: { key: 'sdkwork-demo-pc' } }));
  fs.writeFileSync(path.join(app, 'etc', 'browser.runtime.json'), '{}');
  return { app, repo };
}

test('creates a component deployment reference to the unique enclosing topology', () => {
  const { repo } = fixture();
  const [plan] = planTopologyDelegation(repo);

  assert.deepEqual(plan.config, {
    schemaVersion: 1,
    kind: 'sdkwork.component-deployment',
    application: 'sdkwork-demo-pc',
    parentDeploymentConfig: '../../../etc/sdkwork.deployment.config.json',
    parentTopologySpec: '../../../specs/topology.spec.json',
    runtimeConfig: 'browser.runtime.json',
  });
  assert.equal(plan.configNeedsWrite, true);
  assert.equal(plan.readmeNeedsWrite, true);
  assert.match(plan.readme, /shares the enclosing application deployment unit/u);
});

test('reports a conflict instead of replacing another deployment config kind', () => {
  const { app, repo } = fixture();
  fs.writeFileSync(path.join(app, 'etc', 'sdkwork.deployment.config.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.deployment-reference',
  }));

  const [plan] = planTopologyDelegation(repo);

  assert.match(plan.conflict, /sdkwork\.deployment-reference/u);
  assert.deepEqual(plan.actions, []);
});

test('explicitly migrates a retired deployment reference to the enclosing authorities', () => {
  const { app, repo } = fixture();
  fs.writeFileSync(path.join(app, 'etc', 'sdkwork.deployment.config.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.deployment-reference',
    application: 'sdkwork-demo-pc',
    authority: '../../etc/sdkwork.deployment.config.json',
    runtimeConfig: 'browser.runtime.json',
  }));

  const [plan] = planTopologyDelegation(repo, { migrateRetiredReferences: true });

  assert.equal(plan.conflict, null);
  assert.deepEqual(plan.config, {
    schemaVersion: 1,
    kind: 'sdkwork.component-deployment',
    application: 'sdkwork-demo-pc',
    parentDeploymentConfig: '../../../etc/sdkwork.deployment.config.json',
    parentTopologySpec: '../../../specs/topology.spec.json',
    runtimeConfig: 'browser.runtime.json',
  });
  assert.equal(plan.configNeedsWrite, true);
});

test('refuses delegation when the enclosing deployment authority is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-topology-delegation-missing-parent-'));
  const repo = path.join(root, 'sdkwork-demo');
  const app = path.join(repo, 'apps', 'sdkwork-demo-pc');
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(repo, 'specs', 'topology.spec.json'), '{"schemaVersion":5}\n');
  fs.writeFileSync(path.join(app, 'sdkwork.app.config.json'), '{"app":{"key":"sdkwork-demo-pc"}}\n');

  const plans = planTopologyDelegation(repo);
  assert.equal(plans.length, 1);
  assert.match(plans[0].conflict, /missing etc\/sdkwork\.deployment\.config\.json/u);
  assert.deepEqual(plans[0].actions, []);
});

test('reports a competing child topology that also declares a parent spec', () => {
  const { app, repo } = fixture();
  fs.mkdirSync(path.join(app, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(app, 'specs', 'topology.spec.json'), '{"schemaVersion":5}\n');
  fs.writeFileSync(path.join(app, 'etc', 'sdkwork.deployment.config.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.component-deployment',
    parentTopologySpec: '../../../specs/topology.spec.json',
  }));

  const [plan] = planTopologyDelegation(repo);

  assert.match(plan.conflict, /competes with the declared parentTopologySpec/u);
  assert.deepEqual(plan.actions, []);
});

test('leaves a self-authoritative child root that owns its topology alone', () => {
  const { app, repo } = fixture();
  fs.mkdirSync(path.join(app, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(app, 'specs', 'topology.spec.json'), '{"schemaVersion":5}\n');

  assert.deepEqual(planTopologyDelegation(repo), []);
});

test('preserves surface-owned keys the aligner does not own', () => {
  const { app, repo } = fixture();
  const materialization = {
    authority: '../../../etc/sdkwork.deployment.config.json',
    command: 'pnpm workflow:materialize-client-env',
    format: 'json',
    profiles: ['standalone.development'],
  };
  fs.writeFileSync(path.join(app, 'etc', 'sdkwork.deployment.config.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.component-deployment',
    application: 'sdkwork-demo-pc',
    parentDeploymentConfig: '../../../etc/sdkwork.deployment.config.json',
    parentTopologySpec: '../../../specs/topology.spec.json',
    runtimeConfig: 'browser.runtime.json',
    materialization,
  }));

  const [plan] = planTopologyDelegation(repo);

  assert.equal(plan.configNeedsWrite, false);
  assert.deepEqual(plan.config.materialization, materialization);
});
