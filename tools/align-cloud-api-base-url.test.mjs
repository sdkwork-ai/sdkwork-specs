#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  deriveCloudApiBaseUrlFromTopology,
  deriveCloudApiOriginsFromTopology,
} from './browser-cloud-api-base.mjs';
import { expandSurfaceMultiBase, PLATFORM_GATEWAY_ROLE } from './webserver/host-registry.mjs';
import { alignCloudApiBaseUrl } from './align-cloud-api-base-url.mjs';

test('deriveCloudApiOriginsFromTopology expands every registered base domain', () => {
  const topology = {
    cloudPublicHosts: {
      'platform.api-gateway': expandSurfaceMultiBase({}, PLATFORM_GATEWAY_ROLE),
    },
  };
  const productionOrigins = deriveCloudApiOriginsFromTopology(topology, 'production');
  assert.ok(productionOrigins.length >= 14);
  assert.ok(productionOrigins.includes('https://api.sdkwork.com'));
  assert.ok(productionOrigins.includes('https://api.birdcoder.cn'));
  const developmentOrigins = deriveCloudApiOriginsFromTopology(topology, 'development');
  assert.ok(developmentOrigins.includes('https://api-dev.sdkwork.cn'));
  assert.equal(
    deriveCloudApiBaseUrlFromTopology(topology, 'production').split(';').length,
    productionOrigins.length,
  );
});

test('alignCloudApiBaseUrl writes all topology gateway origins into deployment config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-cloud-api-align-'));
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'deployments', 'webserver'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'sdkwork-demo-pc'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'sdkwork-demo-pc', 'package.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'apps', 'sdkwork-demo-pc', 'vite.config.ts'), 'export default {};\n');
  const topology = {
    cloudPublicHosts: {
      'platform.api-gateway': expandSurfaceMultiBase({}, PLATFORM_GATEWAY_ROLE),
    },
  };
  fs.writeFileSync(path.join(root, 'specs', 'topology.spec.json'), `${JSON.stringify(topology, null, 2)}\n`);
  fs.writeFileSync(
    path.join(root, 'etc', 'sdkwork.deployment.config.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'sdkwork.deployment-index',
      application: 'sdkwork-demo',
      topology: '../specs/topology.spec.json',
      environments: {
        production: { cloudApiBaseUrl: 'https://api.sdkwork.com' },
      },
      profiles: {},
    }, null, 2)}\n`,
  );

  const changes = alignCloudApiBaseUrl(root);
  assert.ok(changes.length >= 1);
  const deployment = JSON.parse(fs.readFileSync(path.join(root, 'etc', 'sdkwork.deployment.config.json'), 'utf8'));
  assert.match(deployment.environments.production.cloudApiBaseUrl, /api\.sdkwork\.com/u);
  assert.match(deployment.environments.production.cloudApiBaseUrl, /api\.birdcoder\.com/u);
});
