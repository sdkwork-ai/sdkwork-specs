/**
 * Shared Vite integration for browser runtime-env documents
 * (APP_RUNTIME_ENV_SPEC.md §6, BROWSER_RUNTIME_ENV_SPEC.md §2/§6).
 *
 * Every SDKWork browser surface serves ONE dev runtime document through a
 * serve-only middleware (Vite `configureServer`) — never as a static file in
 * `public/` — and build paths emit the deploy-time document. The document
 * VALUES stay application-owned (each app authors its key vocabulary through
 * its contract library); this factory owns the cross-app Vite machinery:
 *
 * - the serve-only middleware (exact-path match, `Cache-Control: no-store`,
 *   pass-through for every other request);
 * - the build-time asset emit (`generateBundle`) so statically hosted
 *   artifacts carry the same document the dev server served;
 * - the post-order `transformIndexHtml` hook for `/runtime-env.js` script
 *   injection;
 * - content-type selection for the `.js` bag and `.json` document shapes.
 *
 * This module is imported by vite.config.ts files and MUST NOT carry a
 * `#!` shebang (Vite inlines imported config modules into the config bundle).
 * Applications consume it through the workspace-relative path
 * `../../sdkwork-specs/tools/browser-runtime-env-vite.mjs`; do not re-declare
 * the middleware/emit/injection wiring per app.
 */

const CONTENT_TYPES = Object.freeze({
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
});

function contentTypeForPath(documentPath) {
  const extension = documentPath.slice(documentPath.lastIndexOf('.'));
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    throw new Error(
      `browser runtime-env document path must end in .js or .json, got ${JSON.stringify(documentPath)}`,
    );
  }
  return contentType;
}

/**
 * Create the shared runtime-env Vite plugin.
 *
 * @param {object} options
 * @param {string} [options.name] plugin name (`configureServer` visibility in
 *   logs and align checks).
 * @param {string} [options.path] serve path — `/runtime-env.json` (JSON
 *   document surfaces) or `/runtime-env.js` (global-bag surfaces).
 * @param {() => string} options.resolveServeDocument builds the DEV document
 *   body per request (dev-process env wins over the shared dotenv file).
 * @param {() => string} [options.resolveBuildAsset] builds the BUILD document
 *   body; when provided the plugin emits it as a static asset at
 *   `generateBundle` so statically hosted artifacts carry the deploy-time
 *   document.
 * @param {(html: string) => string} [options.transformIndexHtml] optional
 *   post-order HTML transform (script-tag injection for `.js` surfaces).
 */
export function createBrowserRuntimeEnvVitePlugin({
  name = 'sdkwork-browser-runtime-env',
  path = '/runtime-env.json',
  resolveServeDocument,
  resolveBuildAsset,
  transformIndexHtml,
} = {}) {
  if (typeof resolveServeDocument !== 'function') {
    throw new Error('createBrowserRuntimeEnvVitePlugin requires resolveServeDocument');
  }
  if (!path.startsWith('/')) {
    throw new Error(`browser runtime-env document path must be root-relative, got ${JSON.stringify(path)}`);
  }
  const contentType = contentTypeForPath(path);
  const assetFileName = path.replace(/^\//u, '');

  const plugin = {
    name,
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?', 1)[0] !== path) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', contentType);
        response.setHeader('Cache-Control', 'no-store');
        response.end(resolveServeDocument());
      });
    },
  };

  if (resolveBuildAsset) {
    plugin.generateBundle = function generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: assetFileName,
        source: resolveBuildAsset(),
      });
    };
  }

  if (transformIndexHtml) {
    plugin.transformIndexHtml = {
      order: 'post',
      handler: transformIndexHtml,
    };
  }

  return plugin;
}

/**
 * Serialize a runtime-env bag into the JavaScript document served at
 * `/runtime-env.js`: one assignment per global target with JSON escaped
 * against `</script>` breakouts and U+2028/2029 line separators
 * (BROWSER_RUNTIME_ENV_SPEC.md §4).
 *
 * An assignment value may be a plain document (serialized and frozen) or
 * `{ aliasOf: '<globalExpression>' }` to publish the SAME frozen document to
 * a second global by reference instead of inlining it twice.
 *
 * @param {Array<[string, object | { aliasOf: string }]>} globalAssignments.
 */
export function serializeBrowserRuntimeEnvScript(globalAssignments) {
  const escape = (value) => JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return globalAssignments
    .map(([globalExpression, document]) => {
      if (document && typeof document === 'object' && !Array.isArray(document)
        && typeof document.aliasOf === 'string') {
        return `${globalExpression} = ${document.aliasOf};\n`;
      }
      return `${globalExpression} = Object.freeze(${escape(document)});\n`;
    })
    .join('');
}
