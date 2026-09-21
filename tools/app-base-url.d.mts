export declare const APP_DEPLOYMENT_PROFILES: readonly ['standalone', 'cloud'];

export declare const APP_LIFECYCLE_ENVIRONMENTS: readonly [
  'development',
  'test',
  'staging',
  'demo',
  'production',
];

export declare const APP_BASE_URL_PHASES: readonly ['dev', 'build'];

export declare const APP_BASE_URL_SURFACES: readonly ['browser-document', 'transport'];

export declare const LOCAL_PLATFORM_API_GATEWAY_HTTP_URL_ENV_KEY: 'SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL';

export declare const APP_SAME_ORIGIN_BASE: '/';

export interface AppBaseUrlResolution {
  profileId: string;
  deploymentProfile: 'standalone' | 'cloud';
  environment: string;
  phase: 'dev' | 'build';
  surface: 'browser-document' | 'transport';
  browserOriginMode: 'same-origin' | 'cross-origin';
  sameOrigin: boolean;
  primaryBaseUrl: string;
  baseUrls: readonly string[];
  materialized?: string;
  primaryBaseUrlMaterialized?: string;
  reason:
    | 'standalone-dev-same-origin'
    | 'standalone-build-same-origin'
    | 'standalone-dev-page-origin'
    | 'standalone-build-page-origin'
    | 'cloud-dev-same-origin-document'
    | 'cloud-dev-local-gateway'
    | 'cloud-build-domain-family';
}

export declare function resolveBaseUrl(options: {
  deploymentProfile: 'standalone' | 'cloud';
  environment: string;
  phase?: 'dev' | 'build';
  surface?: 'browser-document' | 'transport';
  localPlatformApiGatewayHttpUrl?: string;
  applicationPublicHttpUrl?: string;
  cloudApiBaseUrls?: string | readonly string[];
  repositoryRoot?: string;
  deployment?: unknown;
  topology?: unknown;
}): AppBaseUrlResolution;

export declare function baseUrlsMaterializationValue(resolution: AppBaseUrlResolution): string;

export declare function splitBaseUrls(value: string | readonly string[]): string[];

export declare function serializeBaseUrls(entries: string | readonly string[]): string;

export declare function selectBaseUrlForPageHost(
  baseUrls: string | readonly string[],
  options?: { pageHost?: string; environment?: string; deploymentProfile?: string },
): { originMode: 'same-origin' | 'cross-origin'; url: string; reason: string };

export declare function readLocalPlatformApiGatewayHttpUrl(
  env?: Readonly<Record<string, string | undefined>>,
): string | undefined;

export declare function primaryOriginFromEnvValue(value: unknown): string | undefined;

export declare function cloudSdkBaseUrlMaterializationValue(origins: string | readonly string[]): string;
