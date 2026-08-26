export declare const LIFECYCLE_ENVIRONMENTS: readonly [
  'development',
  'test',
  'staging',
  'production',
];

export declare const BROWSER_DIST_ENV_ALIASES: Readonly<{
  development: 'dev';
  test: 'test';
  staging: 'staging';
  production: 'prod';
}>;

export declare const BROWSER_DEPLOYMENT_PROFILES: readonly ['standalone', 'cloud'];

export declare function normalizeBrowserDeploymentProfile(
  deploymentProfile?: string,
  processEnv?: Readonly<Record<string, string | undefined>>,
): string;

export declare function browserDistEnvAlias(environment: string): string;

export declare function resolveBrowserDistOutDir(
  environment: string,
  deploymentProfile?: string,
  processEnv?: Readonly<Record<string, string | undefined>>,
): string;

export declare function resolveBrowserDistAbsoluteRoot(
  applicationRoot: string,
  environment: string,
  deploymentProfile?: string,
): string;

export declare function resolveInstalledBrowserWebRoot(
  runtimeCode: string,
  architecture: 'pc' | 'h5' | 'static',
): string;
