import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORS_CLIENT_ORIGINS,
  CORS_CONSOLE_HOST_ENV_KEYS,
  browserBindValuesFromEnv,
  canonicalCorsOrigins,
  corsHostOriginsForProfile,
  corsLoopbackOrigins,
  edgeLoopbackSeedOrigins,
  formatOrigins,
  inspectCorsOrigins,
  inspectPlainOrigins,
  isClientOrigin,
  isExactOrigin,
  isLocalExtraOrigin,
  isProductionLikeEnvironment,
  isRegisteredHostOrigin,
  loopbackOriginForms,
  profileIdParts,
  splitOrigins,
} from './registry.mjs';
import { applyEnvUpdates, parseEnvDocument, rewriteEnvOrigins } from './env-file.mjs';
import { expectedConsolePattern, isCanonicalCorsKey, profileFromFileName } from './scan.mjs';

/** Topology with two browser-facing surfaces and a materialised multi-base host list. */
function demoTology() {
  return {
    appId: 'sdkwork-demo',
    applicationCode: 'demo',
    surfaces: {},
    cloudPublicHosts: {
      'application.public-ingress': {
        httpHost: 'demo.sdkwork.com',
        httpHosts: ['demo.sdkwork.com', 'demo.birdcoder.com', 'demo.dtupay.com'],
        environments: {
          development: { httpHosts: ['demo-dev.sdkwork.com'] },
          production: { httpHosts: ['demo.sdkwork.com', 'demo.birdcoder.com', 'demo.dtupay.com'] },
        },
      },
      'application.backend-http': {
        httpHost: 'demo-admin.sdkwork.com',
        httpHosts: ['demo-admin.sdkwork.com', 'demo-admin.birdcoder.com', 'demo-admin.dtupay.com'],
        environments: {
          development: { httpHosts: ['demo-admin-dev.sdkwork.com'] },
          production: { httpHosts: ['demo-admin.sdkwork.com', 'demo-admin.birdcoder.com', 'demo-admin.dtupay.com'] },
        },
      },
    },
  };
}

test('profileIdParts accepts <deployment-profile>.<environment> only', () => {
  assert.deepEqual(profileIdParts('cloud.production'), { deploymentProfile: 'cloud', environment: 'production' });
  assert.equal(profileIdParts('production'), null);
  assert.equal(profileIdParts('cloud.production.extra'), null);
  assert.equal(profileIdParts(''), null);
});

test('splitOrigins trims, drops blanks, and tolerates non-strings', () => {
  assert.deepEqual(splitOrigins(' a , b ,, c '), ['a', 'b', 'c']);
  assert.deepEqual(splitOrigins(''), []);
  assert.deepEqual(splitOrigins(undefined), []);
});

test('isExactOrigin rejects wildcards, paths, queries, fragments, userinfo and ports on console hosts', () => {
  for (const valid of ['https://im.sdkwork.com', 'http://127.0.0.1:5173', 'app://dsh', 'tauri://localhost', 'https://servicewechat.com']) {
    assert.equal(isExactOrigin(valid), true, `${valid} should be exact`);
  }
  for (const invalid of ['*', 'https://*.sdkwork.com', 'https://im.sdkwork.com/app', 'https://im.sdkwork.com?a=1', 'https://im.sdkwork.com#x', 'https://u@im.sdkwork.com', 'https://im.sdkwork.com ', 'im.sdkwork.com']) {
    assert.equal(isExactOrigin(invalid), false, `${invalid} should not be exact`);
  }
});

test('isRegisteredHostOrigin requires a registered base domain and no port', () => {
  assert.equal(isRegisteredHostOrigin('https://im-dev.sdkwork.com'), true);
  assert.equal(isRegisteredHostOrigin('http://server-app.birdcoder.cn'), true);
  assert.equal(isRegisteredHostOrigin('http://server.sdkwork.com:18080'), false);
  assert.equal(isRegisteredHostOrigin('https://im.example.com'), false);
});

test('isClientOrigin and isLocalExtraOrigin separate the two extra families', () => {
  assert.equal(isClientOrigin('app://dsh'), true);
  assert.equal(isClientOrigin('http://localhost:5173'), false);
  assert.equal(isLocalExtraOrigin('http://localhost:5173'), true);
  assert.equal(isLocalExtraOrigin('http://127.0.0.1:1520'), true);
  assert.equal(isLocalExtraOrigin('tauri://localhost'), true);
  assert.equal(isLocalExtraOrigin('http://evil.example.com'), false);
});

test('loopbackOriginForms emits both loopback spellings and rejects bad binds', () => {
  assert.deepEqual(loopbackOriginForms('127.0.0.1:5182'), ['http://127.0.0.1:5182', 'http://localhost:5182']);
  assert.deepEqual(loopbackOriginForms('0.0.0.0:1520'), ['http://127.0.0.1:1520', 'http://localhost:1520']);
  assert.deepEqual(loopbackOriginForms(':5182'), []);
  assert.deepEqual(loopbackOriginForms('127.0.0.1'), []);
  assert.deepEqual(loopbackOriginForms('127.0.0.1:99999'), []);
});

test('corsLoopbackOrigins sorts ports and is empty for production-like environments', () => {
  assert.deepEqual(
    corsLoopbackOrigins('development', ['127.0.0.1:5173', '127.0.0.1:1520', '127.0.0.1:1520']),
    ['http://127.0.0.1:1520', 'http://localhost:1520', 'http://127.0.0.1:5173', 'http://localhost:5173'],
  );
  for (const environment of ['test', 'staging', 'demo', 'production']) {
    assert.equal(isProductionLikeEnvironment(environment), true);
    assert.deepEqual(corsLoopbackOrigins(environment, ['127.0.0.1:5173']), []);
  }
});

test('browserBindValuesFromEnv keeps browser binds and drops process binds and internal dev ports', () => {
  const values = browserBindValuesFromEnv({
    SDKWORK_DEMO_WEB_DEV_INGRESS_BIND: '127.0.0.1:5173',
    SDKWORK_DEMO_PC_DESKTOP_DEV_BIND: '127.0.0.1:1520',
    SDKWORK_DEMO_PC_INTERNAL_DEV_PORT: '5175',
    SDKWORK_DEMO_H5_INTERNAL_DEV_PORT: '5176',
    SDKWORK_DEMO_SERVER_BIND: '0.0.0.0:18095',
    SDKWORK_DEMO_APPLICATION_PUBLIC_INGRESS_BIND: '0.0.0.0:10240',
  });
  assert.deepEqual(values.sort(), ['127.0.0.1:1520', '127.0.0.1:5173']);
});

test('corsHostOriginsForProfile expands every browser-facing surface across every published base domain', () => {
  const topology = demoTology();
  const production = corsHostOriginsForProfile(topology, 'standalone.production');
  assert.equal(production.length, 6, 'two surfaces x three base domains, https only');
  assert.equal(production.filter((origin) => origin.startsWith('http://')).length, 0);
  assert.equal(production.includes('https://demo.dtupay.com'), true);
  assert.equal(production.includes('https://demo-admin.birdcoder.com'), true);

  const development = corsHostOriginsForProfile(topology, 'standalone.development');
  assert.deepEqual(development, [
    'https://demo-dev.sdkwork.com',
    'http://demo-dev.sdkwork.com',
    'https://demo-admin-dev.sdkwork.com',
    'http://demo-admin-dev.sdkwork.com',
  ]);
});

test('canonicalCorsOrigins orders seeds, hosts, client origins, then registered extras', () => {
  const topology = demoTology();
  const origins = canonicalCorsOrigins(topology, 'standalone.development', {
    existingOrigins: ['https://api-dev.sdkwork.com', 'http://localhost:9999', 'https://evil.example.com'],
    loopbackBindValues: ['127.0.0.1:5173'],
  });
  assert.deepEqual(origins.slice(0, 4), [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'https://demo-dev.sdkwork.com',
    'http://demo-dev.sdkwork.com',
  ]);
  assert.equal(origins.includes('https://api-dev.sdkwork.com'), true, 'registered-family extra is preserved');
  assert.equal(origins.includes('http://localhost:9999'), false, 'undeclared loopback is drift, not an extra');
  assert.equal(origins.includes('https://evil.example.com'), false, 'out-of-family extra is dropped');
  for (const client of CORS_CLIENT_ORIGINS) assert.equal(origins.includes(client), true);
  assert.equal(formatOrigins(['a', 'b']), 'a,b');
});

test('canonicalCorsOrigins drops loopback and plain-http extras in a production-like profile', () => {
  const topology = demoTology();
  const origins = canonicalCorsOrigins(topology, 'standalone.production', {
    existingOrigins: ['http://server.sdkwork.com:18080', 'http://127.0.0.1:18080', 'https://api.sdkwork.com'],
    loopbackBindValues: ['127.0.0.1:5173'],
  });
  assert.equal(origins.includes('http://127.0.0.1:18080'), false);
  assert.equal(origins.includes('http://server.sdkwork.com:18080'), false);
  assert.equal(origins.includes('https://api.sdkwork.com'), true);
});

test('inspectCorsOrigins reports every structural defect', () => {
  const topology = demoTology();
  const issues = inspectCorsOrigins(
    [
      'https://demo.sdkwork.com',
      'https://demo.sdkwork.com',
      'http://127.0.0.1:18080',
      'https://evil.example.com',
      'http://demo.skubc.com',
    ],
    topology,
    'standalone.production',
  );
  const joined = issues.join('\n');
  assert.match(joined, /duplicated origin https:\/\/demo\.sdkwork\.com/u);
  assert.match(joined, /must not allow the development origin http:\/\/127\.0\.0\.1:18080/u);
  assert.match(joined, /outside the registered product domain family/u);
  assert.match(joined, /production origin http:\/\/demo\.skubc\.com must use https/u);
  assert.match(joined, /missing derived origin https:\/\/demo-admin\.sdkwork\.com/u);
  assert.match(joined, /missing client origin app:\/\/dsh/u);
});

test('inspectCorsOrigins accepts the canonical allowlist and flags order only when asked', () => {
  const topology = demoTology();
  const canonical = canonicalCorsOrigins(topology, 'standalone.production');
  assert.deepEqual(inspectCorsOrigins(canonical, topology, 'standalone.production'), []);
  assert.deepEqual(inspectCorsOrigins(canonical, topology, 'standalone.production', { checkOrder: true }), []);

  const shuffled = [...canonical.slice(1), canonical[0]];
  assert.deepEqual(inspectCorsOrigins(shuffled, topology, 'standalone.production'), []);
  assert.match(
    inspectCorsOrigins(shuffled, topology, 'standalone.production', { checkOrder: true }).join('\n'),
    /order is not canonical/u,
  );
});

test('edge loopback seeds stay legal in a production plain allowlist', () => {
  // The edge allowlists keep one loopback seed per environment so an operator can
  // reach the deployed edge locally; those seeds must survive the https rule.
  assert.deepEqual(edgeLoopbackSeedOrigins('production'), ['http://localhost:3913', 'http://127.0.0.1:3913']);
  assert.deepEqual(
    inspectPlainOrigins(['https://demo.sdkwork.com', ...edgeLoopbackSeedOrigins('production')], 'production'),
    [],
  );
  assert.deepEqual(inspectPlainOrigins(edgeLoopbackSeedOrigins('demo'), 'demo'), []);
  // A port that is not this environment's edge seed is still development leakage,
  // and a production seed must not be leaned on by a non-production profile.
  assert.match(
    inspectPlainOrigins(['http://localhost:18080'], 'production').join('\n'),
    /must not allow the development origin/u,
  );
  assert.match(
    inspectPlainOrigins(['http://localhost:3913'], 'demo').join('\n'),
    /must not allow the development origin/u,
  );
});

test('profileFromFileName resolves deployment profiles, instance variants and templates', () => {
  assert.deepEqual(profileFromFileName('standalone.production.env'), { deploymentProfile: 'standalone', environment: 'production', variant: null });
  assert.deepEqual(profileFromFileName('cloud.demo.env'), { deploymentProfile: 'cloud', environment: 'demo', variant: null });
  assert.deepEqual(profileFromFileName('production.env'), { deploymentProfile: null, environment: 'production', variant: null });
  assert.deepEqual(profileFromFileName('production.i1.env'), { deploymentProfile: null, environment: 'production', variant: 'i1' });
  assert.deepEqual(profileFromFileName('production.env.example'), { deploymentProfile: null, environment: 'production', variant: null });
  assert.deepEqual(profileFromFileName('standalone.test.env.example'), { deploymentProfile: 'standalone', environment: 'test', variant: null });
  assert.equal(profileFromFileName('production.example'), null);
  assert.equal(profileFromFileName('.env'), null);
});

test('expectedConsolePattern pins suffix and schemes per environment', () => {
  assert.deepEqual(expectedConsolePattern('production'), { suffix: '', schemes: 'https' });
  assert.deepEqual(expectedConsolePattern('development'), { suffix: '-dev', schemes: 'http,https' });
  assert.deepEqual(expectedConsolePattern('staging'), { suffix: '-staging', schemes: 'http,https' });
  assert.deepEqual(expectedConsolePattern('demo'), { suffix: '-demo', schemes: 'http,https' });
});

test('isCanonicalCorsKey accepts the shared, entrypoint, console and gateway keys', () => {
  assert.equal(isCanonicalCorsKey('SDKWORK_CORS_ALLOWED_ORIGINS'), true);
  assert.equal(isCanonicalCorsKey(CORS_CONSOLE_HOST_ENV_KEYS.labels), true);
  assert.equal(isCanonicalCorsKey('SDKWORK_MODULE_API_GATEWAY_CORS_ALLOWED_ORIGINS'), true);
  assert.equal(isCanonicalCorsKey('SDKWORK_MODULE_API_GATEWAY_CORS_CONSOLE_HOST_LABELS'), true);
  assert.equal(isCanonicalCorsKey('GATEWAY_CORS_ALLOWED_ORIGINS'), true);
  assert.equal(isCanonicalCorsKey('GATEWAY_CORS_CONSOLE_HOST_SUFFIX'), true);
  assert.equal(isCanonicalCorsKey('SDKWORK_BIRDCODER_ALLOWED_ORIGINS'), false);
  assert.equal(isCanonicalCorsKey('GAMES_CORS_ALLOW_ORIGINS'), false);
});

test('parseEnvDocument keeps line order, comments and CRLF, and flags duplicate keys', () => {
  const document = parseEnvDocument('# header\r\nA=1\r\nB=2\r\nA=3\r\n');
  assert.equal(document.eol, '\r\n');
  assert.deepEqual(document.entries.map((entry) => entry.key), ['A', 'B', 'A']);
  assert.equal(document.byKey.get('A').duplicate, true);
  assert.equal(document.byKey.get('A').value, '1', 'the first assignment wins, as a shell would');
});

test('applyEnvUpdates replaces in place, inserts after the anchor, and deletes retired keys', () => {
  const text = '# header\nSDKWORK_ENVIRONMENT=production\nSDKWORK_BIRDCODER_ALLOWED_ORIGINS=http://x\nSDKWORK_PROFILE_ID=standalone.production\n';
  const document = parseEnvDocument(text);
  const { text: next, changed } = applyEnvUpdates(document, new Map([
    ['SDKWORK_BIRDCODER_ALLOWED_ORIGINS', null],
    ['SDKWORK_CORS_ALLOWED_ORIGINS', 'https://im.sdkwork.com'],
    ['SDKWORK_ENVIRONMENT', 'production'],
  ]));
  assert.equal(changed, true);
  assert.equal(next, [
    '# header',
    'SDKWORK_ENVIRONMENT=production',
    'SDKWORK_CORS_ALLOWED_ORIGINS=https://im.sdkwork.com',
    'SDKWORK_PROFILE_ID=standalone.production',
    '',
  ].join('\n'));
});

test('applyEnvUpdates appends a missing key before the file terminator', () => {
  assert.equal(applyEnvUpdates(parseEnvDocument('A=1\n'), new Map([['B', '2']])).text, 'A=1\nB=2\n');
  assert.equal(applyEnvUpdates(parseEnvDocument('A=1'), new Map([['B', '2']])).text, 'A=1\nB=2');
  assert.equal(applyEnvUpdates(parseEnvDocument('A=1\r\n'), new Map([['B', '2']])).text, 'A=1\r\nB=2\r\n');
});

test('applyEnvUpdates does not shift a later replacement when an earlier key is deleted', () => {
  const text = 'A=1\nDELETE_ME=2\nB=3\n';
  const document = parseEnvDocument(text);
  const { text: next } = applyEnvUpdates(document, new Map([
    ['DELETE_ME', null],
    ['B', '30'],
  ]));
  assert.equal(next, 'A=1\nB=30\n');
});

test('applyEnvUpdates reports no change when the file is already canonical', () => {
  const text = 'SDKWORK_CORS_ALLOWED_ORIGINS=https://im.sdkwork.com\n';
  const { changed } = rewriteEnvOrigins(text, new Map([['SDKWORK_CORS_ALLOWED_ORIGINS', 'https://im.sdkwork.com']]));
  assert.equal(changed, false);
});
