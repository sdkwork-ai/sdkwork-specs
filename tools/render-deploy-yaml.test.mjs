import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { renderDeployYaml } from './application-deploy-layout/render.mjs';
import { parseYaml } from './deploy/yaml-resolver.mjs';
import { validateDeploySchema } from './deploy/schema-validate.mjs';

/**
 * Topology as it exists for most applications: five lifecycle environments
 * across the two deployment profiles. Only three of those environments are
 * deployable, and check-deploy-standard.test.mjs locks in that a manifest
 * declaring `development` is rejected — so the generator must filter.
 *
 * Regression: renderDeployYaml used to emit every topology profile, which gave
 * any newly bootstrapped repository an invalid deployments/deploy.yaml (seen
 * on sdkwork-drama and sdkwork-terminal, both carrying all ten profiles).
 */
const TOPOLOGY = {
  schemaVersion: 5,
  appId: 'sdkwork-drama',
  profileFiles: {
    'standalone.development': 'etc/topology/standalone.development.env',
    'standalone.test': 'etc/topology/standalone.test.env',
    'standalone.staging': 'etc/topology/standalone.staging.env',
    'standalone.demo': 'etc/topology/standalone.demo.env',
    'standalone.production': 'etc/topology/standalone.production.env',
    'cloud.development': 'etc/topology/cloud.development.env',
    'cloud.test': 'etc/topology/cloud.test.env',
    'cloud.staging': 'etc/topology/cloud.staging.env',
    'cloud.demo': 'etc/topology/cloud.demo.env',
    'cloud.production': 'etc/topology/cloud.production.env',
  },
  defaults: { productionProfileId: 'cloud.production' },
  cloudPublicHosts: {
    'application.public-ingress': { httpHost: 'drama.sdkwork.com' },
  },
};

function profileIds(yaml) {
  return [...yaml.matchAll(/^ {2}([a-z]+\.[a-z]+):$/gmu)].map((m) => m[1]);
}

test('renderDeployYaml emits only deployable profiles', () => {
  const yaml = renderDeployYaml({ topology: TOPOLOGY, appId: 'sdkwork-drama' });
  const ids = profileIds(yaml);

  assert.deepEqual(ids, [
    'cloud.production',
    'cloud.staging',
    'cloud.test',
    'standalone.production',
    'standalone.staging',
    'standalone.test',
  ]);
  for (const id of ids) {
    assert.ok(!/\.(?:development|demo)$/u.test(id), `${id} is not a deployable profile`);
  }
});

test('the generated manifest passes the deploy schema', () => {
  const yaml = renderDeployYaml({ topology: TOPOLOGY, appId: 'sdkwork-drama' });
  const doc = parseYaml(yaml, process.cwd());

  assert.deepEqual(validateDeploySchema(doc), []);
});

test('renderDeployYaml stays valid for a topology with no deployable profiles', () => {
  const yaml = renderDeployYaml({
    topology: { profileFiles: { 'standalone.development': 'etc/topology/standalone.development.env' } },
    appId: 'sdkwork-example',
  });

  assert.deepEqual(profileIds(yaml), ['cloud.production']);
  assert.deepEqual(validateDeploySchema(parseYaml(yaml, process.cwd())), []);
});

/**
 * Regression: the manifest advertised `mode: web+api` for every domain, so an
 * API-only application produced a manifest that failed web-surface validation
 * ("no web surfaces found ... expected apps/<app>-pc/ or apps/<app>-h5/").
 * Observed on sdkwork-drama, which ships no web application.
 */
test('renderDeployYaml exposes api only when the application has no web surface', () => {
  const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-api-only-'));
  const yaml = renderDeployYaml({ topology: TOPOLOGY, appId: 'sdkwork-drama', moduleRoot });

  assert.ok(!/mode: web\+api/u.test(yaml), 'must not advertise a web edge');
  assert.ok(/mode: api/u.test(yaml));
  assert.ok(!/^ {8}web: adaptive$/mu.test(yaml), 'must not carry a web block');
  assert.deepEqual(validateDeploySchema(parseYaml(yaml, process.cwd())), []);
});

test('renderDeployYaml keeps the web edge when a pc surface exists', () => {
  const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-web-'));
  fs.mkdirSync(path.join(moduleRoot, 'apps', 'sdkwork-drama-pc'), { recursive: true });
  const yaml = renderDeployYaml({ topology: TOPOLOGY, appId: 'sdkwork-drama', moduleRoot });

  assert.ok(/mode: web\+api/u.test(yaml));
  assert.ok(/^ {8}web: adaptive$/mu.test(yaml));
  assert.deepEqual(validateDeploySchema(parseYaml(yaml, process.cwd())), []);
});
