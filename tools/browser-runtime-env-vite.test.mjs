import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBrowserRuntimeEnvVitePlugin,
  serializeBrowserRuntimeEnvScript,
} from './browser-runtime-env-vite.mjs';

function createMockServer() {
  const handlers = [];
  const responses = [];
  return {
    handlers,
    responses,
    server: {
      middlewares: {
        use(handler) {
          handlers.push(handler);
        },
      },
    },
    async request(url) {
      const responsesForRequest = [];
      const response = {
        statusCode: undefined,
        headers: {},
        body: undefined,
        setHeader(name, value) {
          this.headers[name] = value;
        },
        end(body) {
          this.body = body;
          responsesForRequest.push(this);
        },
      };
      let called = false;
      for (const handler of handlers) {
        let nextCalled = false;
        handler({ url }, response, () => {
          nextCalled = true;
        });
        if (!nextCalled) {
          called = true;
          break;
        }
      }
      responses.push(...responsesForRequest);
      return called ? response : undefined;
    },
  };
}

test('JSON document plugin serves the dev document with no-store and passes everything else through', async () => {
  const calls = [];
  const plugin = createBrowserRuntimeEnvVitePlugin({
    name: 'test-runtime-env-document',
    path: '/runtime-env.json',
    resolveServeDocument: () => {
      calls.push('serve');
      return '{"browserOriginMode":"same-origin"}';
    },
  });
  assert.equal(plugin.name, 'test-runtime-env-document');
  assert.equal(plugin.generateBundle, undefined);
  assert.equal(plugin.transformIndexHtml, undefined);

  const mock = createMockServer();
  plugin.configureServer(mock.server);
  assert.equal(mock.handlers.length, 1);

  const hit = await mock.request('/runtime-env.json');
  assert.ok(hit, 'document request must be handled');
  assert.equal(hit.statusCode, 200);
  assert.equal(hit.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(hit.headers['Cache-Control'], 'no-store');
  assert.equal(hit.body, '{"browserOriginMode":"same-origin"}');

  const missQuery = await mock.request('/runtime-env.json?v=2');
  assert.ok(missQuery, 'query-string request must still match the document path');

  const miss = await mock.request('/index.html');
  assert.equal(miss, undefined, 'non-document requests pass through');
});

test('script plugin emits the build asset and registers the post-order html transform', async () => {
  let buildCalls = 0;
  const plugin = createBrowserRuntimeEnvVitePlugin({
    path: '/runtime-env.js',
    resolveServeDocument: () => 'globalThis.SDKWORK_RUNTIME_ENV = Object.freeze({});\n',
    resolveBuildAsset: () => {
      buildCalls += 1;
      return 'globalThis.SDKWORK_RUNTIME_ENV = Object.freeze({"VITE_API_BASE_URL":"/v1"});\n';
    },
    transformIndexHtml: (html) => `${html}<script type="module" src="/runtime-env.js"></script>`,
  });

  assert.equal(typeof plugin.generateBundle, 'function');
  assert.deepEqual(plugin.transformIndexHtml, {
    order: 'post',
    handler: plugin.transformIndexHtml.handler,
  });

  const emitted = [];
  const context = {
    emitFile(asset) {
      emitted.push(asset);
    },
  };
  plugin.generateBundle.call(context);
  assert.equal(buildCalls, 1);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'asset');
  assert.equal(emitted[0].fileName, 'runtime-env.js');
  assert.match(emitted[0].source, /VITE_API_BASE_URL/u);

  assert.equal(
    plugin.transformIndexHtml.handler('<html></html>'),
    '<html></html><script type="module" src="/runtime-env.js"></script>',
  );
});

test('the factory fails closed on missing resolvers and bad paths', () => {
  assert.throws(() => createBrowserRuntimeEnvVitePlugin({}), /resolveServeDocument/u);
  assert.throws(
    () => createBrowserRuntimeEnvVitePlugin({
      path: 'runtime-env.json',
      resolveServeDocument: () => '',
    }),
    /root-relative/u,
  );
  assert.throws(
    () => createBrowserRuntimeEnvVitePlugin({
      path: '/runtime-env.yaml',
      resolveServeDocument: () => '',
    }),
    /\.js or \.json/u,
  );
});

test('script serializer escapes html-breaking characters and freezes every global', () => {
  const script = serializeBrowserRuntimeEnvScript([
    ['window.__APP_ENV__', { VITE_A: '</script><script>alert(1)</script>' }],
    ['globalThis.SDKWORK_RUNTIME_ENV', { aliasOf: 'window.__APP_ENV__' }],
  ]);
  assert.match(script, /^window\.__APP_ENV__ = Object\.freeze\(/u);
  assert.match(script, /globalThis\.SDKWORK_RUNTIME_ENV = window\.__APP_ENV__;\n$/u);
  assert.ok(!script.includes('</script>'), 'closing script tags must be escaped');
  assert.ok(script.includes('\\u003C/script\\u003E'), 'escaped closing tags present');
  assert.ok(!script.includes('\u2028'), 'U+2028 must be escaped');
});
