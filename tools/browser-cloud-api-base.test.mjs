#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloudSdkBaseUrlMaterializationValue,
  normalizeCloudApiOriginList,
  resolveCloudApiOriginForHost,
  resolveBrowserCloudSdkBaseUrl,
  splitCloudApiBaseUrlList,
  validateCloudApiOriginListForEnvironment,
} from './browser-cloud-api-base.mjs';

test('splitCloudApiBaseUrlList accepts comma and semicolon separators', () => {
  assert.deepEqual(
    splitCloudApiBaseUrlList('https://api.sdkwork.com, https://api.sdkwork.cn;https://api.birdcoder.com'),
    ['https://api.sdkwork.com', 'https://api.sdkwork.cn', 'https://api.birdcoder.com'],
  );
});

test('validateCloudApiOriginListForEnvironment enforces api-* host formula', () => {
  assert.deepEqual(
    validateCloudApiOriginListForEnvironment(
      'https://api.sdkwork.com;https://api.sdkwork.cn',
      'production',
    ),
    ['https://api.sdkwork.com', 'https://api.sdkwork.cn'],
  );
  assert.throws(
    () => validateCloudApiOriginListForEnvironment('https://api-dev.sdkwork.com', 'production'),
    /must use host api\.sdkwork\.com/u,
  );
});

test('resolveCloudApiOriginForHost maps page host base domain to api origin', () => {
  const productionOrigins = ['https://api.sdkwork.com', 'https://api.sdkwork.cn'];
  assert.equal(
    resolveCloudApiOriginForHost(productionOrigins, 'im.sdkwork.com', 'production'),
    'https://api.sdkwork.com',
  );
  assert.equal(
    resolveCloudApiOriginForHost(productionOrigins, 'im.sdkwork.cn', 'production'),
    'https://api.sdkwork.cn',
  );
  const developmentOrigins = ['https://api-dev.sdkwork.com', 'https://api-dev.sdkwork.cn'];
  assert.equal(
    resolveCloudApiOriginForHost(developmentOrigins, 'im-dev.sdkwork.com', 'development'),
    'https://api-dev.sdkwork.com',
  );
});

test('resolveBrowserCloudSdkBaseUrl selects configured origin without window', () => {
  assert.equal(
    resolveBrowserCloudSdkBaseUrl('https://api.sdkwork.com;https://api.sdkwork.cn', {
      pageHost: 'im.birdcoder.com',
      environment: 'production',
    }),
    'https://api.birdcoder.com',
  );
});

test('cloudSdkBaseUrlMaterializationValue preserves multi-origin delimiter', () => {
  assert.equal(
    cloudSdkBaseUrlMaterializationValue(['https://api.sdkwork.com', 'https://api.sdkwork.cn']),
    'https://api.sdkwork.com;https://api.sdkwork.cn',
  );
  assert.equal(
    cloudSdkBaseUrlMaterializationValue(['https://api.sdkwork.com']),
    'https://api.sdkwork.com',
  );
});

test('normalizeCloudApiOriginList deduplicates origins', () => {
  assert.deepEqual(
    normalizeCloudApiOriginList('https://api.sdkwork.com/, https://api.sdkwork.com'),
    ['https://api.sdkwork.com'],
  );
});
