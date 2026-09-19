import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBrowserDevRuntimeEnvDocument,
  authorSameOriginSdkBaseUrls,
  BROWSER_PROCESS_ONLY_URL_KEY_PATTERN,
  buildBrowserDevRuntimeEnvDocument,
  buildBrowserRuntimeEnvGlobalBridge,
  buildBrowserRuntimeEnvGlobalScript,
  isLoopbackAbsoluteUrl,
} from './browser-runtime-env.mjs';

test('buildBrowserDevRuntimeEnvDocument derives identity from the profile id', () => {
  assert.deepEqual(buildBrowserDevRuntimeEnvDocument({ profileId: 'cloud.development' }), {
    environment: 'development',
    deploymentProfile: 'cloud',
    profileId: 'cloud.development',
    browserOriginMode: 'same-origin',
    appApiBaseUrl: '/app/v3/api',
    backendApiBaseUrl: '/backend/v3/api',
    openApiBaseUrl: '/v1',
  });
});

test('assertBrowserDevRuntimeEnvDocument accepts Vite bag and JSON shapes', () => {
  assertBrowserDevRuntimeEnvDocument(
    buildBrowserDevRuntimeEnvDocument({ profileId: 'standalone.development' }),
    { profileId: 'standalone.development' },
  );
  // Vite bag shape: the surface declares its canonical base entries explicitly
  // (dependency surfaces like feeds/drive own their own prefixes).
  assertBrowserDevRuntimeEnvDocument({
    VITE_CLOUDROUTER_APP_API_BASE_URL: '/app/v3/api',
    VITE_CLOUDROUTER_BACKEND_API_BASE_URL: '/backend/v3/api',
    VITE_CLOUDROUTER_OPEN_API_BASE_URL: '/v1',
    VITE_SDKWORK_DEPLOYMENT_PROFILE: 'standalone',
  }, {
    requireSameOriginBases: false,
    sameOriginBaseEntries: [
      ['VITE_CLOUDROUTER_APP_API_BASE_URL', '/app/v3/api'],
      ['VITE_CLOUDROUTER_BACKEND_API_BASE_URL', '/backend/v3/api'],
      ['VITE_CLOUDROUTER_OPEN_API_BASE_URL', '/v1'],
    ],
  });
  // Dependency surfaces keep their own canonical prefixes without tripping the
  // canonical three.
  assertBrowserDevRuntimeEnvDocument({
    VITE_SDKWORK_FEEDS_OPEN_API_BASE_URL: '/feeds/v3/api',
    VITE_SDKWORK_DRIVE_BACKEND_API_BASE_URL: 'https://drive-dev.sdkwork.com',
  }, { requireSameOriginBases: false });
});

test('assertBrowserDevRuntimeEnvDocument rejects loopback absolutes and process-only keys', () => {
  assert.throws(
    () => assertBrowserDevRuntimeEnvDocument({
      appApiBaseUrl: 'http://127.0.0.1:3910/app/v3/api',
      backendApiBaseUrl: '/backend/v3/api',
      openApiBaseUrl: '/v1',
    }),
    /loopback origin/u,
  );
  assert.throws(
    () => assertBrowserDevRuntimeEnvDocument({
      appApiBaseUrl: '/app/v3/api',
      backendApiBaseUrl: '/backend/v3/api',
      openApiBaseUrl: '/v1',
      VITE_SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_BACKEND_HTTP_URL: 'http://127.0.0.1:18081',
    }),
    /process-only topology key/u,
  );
  assert.throws(
    () => assertBrowserDevRuntimeEnvDocument({
      appApiBaseUrl: 'https://api-dev.sdkwork.com',
      backendApiBaseUrl: '/backend/v3/api',
      openApiBaseUrl: '/v1',
    }),
    /appApiBaseUrl must be "\/app\/v3\/api"/u,
  );
});

test('BROWSER_PROCESS_ONLY_URL_KEY_PATTERN matches multi-token application codes', () => {
  assert.equal(
    BROWSER_PROCESS_ONLY_URL_KEY_PATTERN.test('VITE_SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_HTTP_URL'),
    true,
  );
  assert.equal(
    BROWSER_PROCESS_ONLY_URL_KEY_PATTERN.test('SDKWORK_IM_PLATFORM_API_GATEWAY_HTTP_URL'),
    true,
  );
  assert.equal(
    BROWSER_PROCESS_ONLY_URL_KEY_PATTERN.test('VITE_CLOUDROUTER_APP_API_BASE_URL'),
    false,
  );
});

test('authorSameOriginSdkBaseUrls forces the given base entries', () => {
  const authored = authorSameOriginSdkBaseUrls(
    { VITE_CLOUDROUTER_APP_API_BASE_URL: 'https://api-dev.sdkwork.com' },
    [
      ['VITE_CLOUDROUTER_APP_API_BASE_URL', '/app/v3/api'],
      ['VITE_CLOUDROUTER_BACKEND_API_BASE_URL', '/backend/v3/api'],
    ],
  );
  assert.equal(authored.VITE_CLOUDROUTER_APP_API_BASE_URL, '/app/v3/api');
  assert.equal(authored.VITE_CLOUDROUTER_BACKEND_API_BASE_URL, '/backend/v3/api');
});

test('global bridge carries deployment-mode aliases for shared SDK resolvers', () => {
  const bridge = buildBrowserRuntimeEnvGlobalBridge(
    buildBrowserDevRuntimeEnvDocument({ profileId: 'cloud.development' }),
  );
  assert.equal(bridge.SDKWORK_DEPLOYMENT_PROFILE, 'cloud');
  assert.equal(bridge.VITE_SDKWORK_DEPLOY_MODE, 'cloud');
  assert.equal(bridge.profileId, 'cloud.development');

  const script = buildBrowserRuntimeEnvGlobalScript(bridge);
  assert.match(script, /^globalThis\.SDKWORK_RUNTIME_ENV = Object\.freeze\(/u);
  // HTML-sensitive characters must be escaped for inline usage.
  assert.doesNotMatch(script, /<script/u);
});

test('isLoopbackAbsoluteUrl covers http/https/ws/wss loopback forms', () => {
  assert.equal(isLoopbackAbsoluteUrl('http://127.0.0.1:3910/app/v3/api'), true);
  assert.equal(isLoopbackAbsoluteUrl('https://localhost/v1'), true);
  assert.equal(isLoopbackAbsoluteUrl('ws://[::1]/ws'), true);
  assert.equal(isLoopbackAbsoluteUrl('https://api-dev.sdkwork.com'), false);
  assert.equal(isLoopbackAbsoluteUrl('/app/v3/api'), false);
});
