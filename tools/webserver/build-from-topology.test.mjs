import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveEnvHosts,
  hostsForSurface,
  buildWebserverDocs,
  webserverSurfaces,
} from './build-from-topology.mjs';

import {
  DEFAULT_PRODUCT_BASE_DOMAINS,
  hostsForRoleAcrossBases,
  expandSurfaceMultiBase,
  isPublicHostCompliant,
} from './host-registry.mjs';

test('hostsForRoleAcrossBases covers every registered base domain', () => {
  assert.equal(hostsForRoleAcrossBases('im', 'production').length, DEFAULT_PRODUCT_BASE_DOMAINS.length);
  assert.deepEqual(hostsForRoleAcrossBases('im', 'production'), [
    'im.sdkwork.com',
    'im.birdcoder.com',
    'im.dtupay.com',
    'im.sdkwork.cn',
    'im.birdcoder.cn',
    'im.dtupay.cn',
    'im.skubc.com',
    'im.skubc.cn',
    'im.zowalk.com',
    'im.zowalk.cn',
    'im.offer86.com',
    'im.offer86.cn',
    'im.86offer.com',
    'im.86offer.cn',
  ]);
  assert.deepEqual(hostsForRoleAcrossBases('im', 'test'), [
    'im-test.sdkwork.com',
    'im-test.birdcoder.com',
    'im-test.dtupay.com',
    'im-test.sdkwork.cn',
    'im-test.birdcoder.cn',
    'im-test.dtupay.cn',
    'im-test.skubc.com',
    'im-test.skubc.cn',
    'im-test.zowalk.com',
    'im-test.zowalk.cn',
    'im-test.offer86.com',
    'im-test.offer86.cn',
    'im-test.86offer.com',
    'im-test.86offer.cn',
  ]);
});

test('expandSurfaceMultiBase materializes environments for all base domains', () => {
  const surface = expandSurfaceMultiBase({}, 'drive');
  assert.equal(surface.httpHost, 'drive.sdkwork.com');
  assert.equal(surface.httpHosts.length, DEFAULT_PRODUCT_BASE_DOMAINS.length);
  assert.equal(surface.environments.test.httpHosts.length, DEFAULT_PRODUCT_BASE_DOMAINS.length);
  assert.ok(isPublicHostCompliant('drive.zowalk.cn'));
});

test('deriveEnvHosts applies lifecycle suffixes', () => {
  assert.deepEqual(deriveEnvHosts(['im.sdkwork.com'], 'development'), ['im-dev.sdkwork.com']);
  assert.deepEqual(deriveEnvHosts(['im.sdkwork.com'], 'test'), ['im-test.sdkwork.com']);
  assert.deepEqual(deriveEnvHosts(['router.sdkwork.com', 'router.birdcoder.com'], 'staging'), [
    'router-staging.sdkwork.com',
    'router-staging.birdcoder.com',
  ]);
});

test('hostsForSurface reads topology environment variants', () => {
  const surface = {
    httpHost: 'drive.sdkwork.com',
    environments: {
      development: { httpHost: 'drive-dev.sdkwork.com' },
      test: { httpHost: 'drive-test.sdkwork.com' },
    },
  };
  assert.deepEqual(hostsForSurface(surface, 'production'), ['drive.sdkwork.com']);
  assert.deepEqual(hostsForSurface(surface, 'development'), ['drive-dev.sdkwork.com']);
  assert.deepEqual(hostsForSurface(surface, 'staging'), ['drive-staging.sdkwork.com']);
});

test('buildWebserverDocs ignores non-compliant deploy.yaml expose domains', () => {
  const topology = {
    applicationCode: 'im',
    defaults: { gatewayBind: '127.0.0.1:18079' },
    cloudPublicHosts: {
      'application.public-ingress': {
        httpHost: 'im.sdkwork.com',
        environments: {
          development: { httpHost: 'im-dev.sdkwork.com' },
          test: { httpHost: 'im-test.sdkwork.com' },
          staging: { httpHost: 'im-staging.sdkwork.com' },
        },
      },
    },
  };
  const docs = buildWebserverDocs({ appId: 'sdkwork-im', topology, moduleRoot: '/nonexistent' });
  const productionNames = docs.environments.production.http.server.flatMap((s) => s.serverName);
  assert.deepEqual(productionNames, ['im.sdkwork.com']);
  assert.ok(!productionNames.some((name) => name.includes('internal.example')));
});

test('buildWebserverDocs splits production TLS by base domain', () => {
  const topology = {
    applicationCode: 'im',
    defaults: { gatewayBind: '127.0.0.1:18079' },
    cloudPublicHosts: {
      'application.public-ingress': expandSurfaceMultiBase({}, 'im'),
    },
  };
  const docs = buildWebserverDocs({ appId: 'sdkwork-im', topology });
  const production = docs.environments.production.http.server;
  assert.equal(production.length, DEFAULT_PRODUCT_BASE_DOMAINS.length);
  assert.deepEqual(production[0].serverName, ['im.sdkwork.com']);
  assert.equal(production[0].tls.cert, 'sdkwork.com');
  assert.deepEqual(production[1].serverName, ['im.birdcoder.com']);
  assert.deepEqual(production[3].serverName, ['im.sdkwork.cn']);
  assert.equal(production[3].tls.cert, 'sdkwork.cn');
  assert.equal(docs.common.http.server, undefined);
  assert.deepEqual(webserverSurfaces('sdkwork-api-cloud-gateway', {
    cloudPublicHosts: {
      'platform.api-gateway': { httpHost: 'api.sdkwork.com' },
      'application.public-ingress': { httpHost: 'ignored.sdkwork.com' },
    },
  }), ['platform.api-gateway']);
});
