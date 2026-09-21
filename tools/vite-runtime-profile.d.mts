export declare const LIFECYCLE_ENVIRONMENTS: readonly [
  'development',
  'test',
  'staging',
  'demo',
  'production',
];

export declare const DEPLOYMENT_PROFILES: readonly ['standalone', 'cloud'];

export declare const PROFILE_ID_PATTERN: RegExp;

export declare function resolveViteEnvironment(
  mode?: string,
  processEnv?: Readonly<Record<string, string | undefined>> | NodeJS.ProcessEnv,
): string;

export declare function resolveViteRuntimeProfile(
  mode?: string,
  processEnv?: Readonly<Record<string, string | undefined>> | NodeJS.ProcessEnv,
): { deploymentProfile: string; environment: string; profileId: string };

export declare function resolveLucideReactEntry(
  appRoot: string,
  candidates?: readonly string[],
): string | undefined;
