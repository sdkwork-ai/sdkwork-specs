export declare const BROWSER_RUNTIME_ENV_GLOBAL_KEY: 'SDKWORK_RUNTIME_ENV';

export declare const BROWSER_SAME_ORIGIN_API_BASES: Readonly<{
  appApi: '/app/v3/api';
  backendApi: '/backend/v3/api';
  openApi: '/v1';
}>;

export declare const BROWSER_PROCESS_ONLY_URL_KEY_PATTERN: RegExp;

export declare function isLoopbackAbsoluteUrl(value: unknown): boolean;

export declare function buildBrowserDevRuntimeEnvDocument(options?: {
  profileId?: string;
  deploymentProfile?: string;
  environment?: string;
  sameOriginBases?: Readonly<Record<string, string>>;
}): Readonly<{
  environment: string;
  deploymentProfile: string;
  profileId: string;
  browserOriginMode: 'same-origin';
  appApiBaseUrl: string;
  backendApiBaseUrl: string;
  openApiBaseUrl: string;
}>;

export declare function authorSameOriginSdkBaseUrls(
  runtimeEnv?: Record<string, unknown>,
  baseEntries?: ReadonlyArray<readonly [string, string]>,
): Record<string, unknown>;

export declare function assertBrowserDevRuntimeEnvDocument(
  document: unknown,
  options?: {
    profileId?: string;
    sameOriginBaseEntries?: ReadonlyArray<readonly [string, string]>;
    requireSameOriginBases?: boolean;
  },
): asserts document;

export declare function buildBrowserRuntimeEnvGlobalBridge(
  document: Record<string, unknown>,
  options?: { deploymentProfile?: string },
): Readonly<Record<string, unknown>>;

export declare function buildBrowserRuntimeEnvGlobalScript(
  bridge: Record<string, unknown>,
): string;
