export declare function createBrowserRuntimeEnvVitePlugin(options: {
  name?: string;
  path?: '/runtime-env.json' | '/runtime-env.js' | (string & {});
  resolveServeDocument: () => string;
  resolveBuildAsset?: () => string;
  transformIndexHtml?: (html: string) => string;
}): {
  name: string;
  configureServer(server: unknown): void;
  generateBundle?(this: { emitFile(asset: { type: 'asset'; fileName: string; source: string }): void }): void;
  transformIndexHtml?: { order: 'post'; handler: (html: string) => string };
};

export declare function serializeBrowserRuntimeEnvScript(
  globalAssignments: ReadonlyArray<readonly [string, Record<string, unknown> | { aliasOf: string }]>,
): string;
