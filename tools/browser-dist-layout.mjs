
/**
 * Canonical browser PC/H5 Vite build output layout helpers.
 * Authority: APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md §2.2,
 * FRONTEND_CODE_SPEC.md §7, ENVIRONMENT_SPEC.md §5.1.
 */

export const LIFECYCLE_ENVIRONMENTS = Object.freeze([
  'development',
  'test',
  'staging',
  'production',
]);

/** Dist directory segment aliases (not profile-id substitutes). */
export const BROWSER_DIST_ENV_ALIASES = Object.freeze({
  development: 'dev',
  test: 'test',
  staging: 'staging',
  production: 'prod',
});

/** Deployment profiles that select a browser dist layout variant. */
export const BROWSER_DEPLOYMENT_PROFILES = Object.freeze(['standalone', 'cloud']);

export function normalizeBrowserDeploymentProfile(deploymentProfile, processEnv = process.env) {
  const profile = String(
    deploymentProfile
      ?? processEnv.SDKWORK_DEPLOYMENT_PROFILE
      ?? processEnv.SDKWORK_WEBSERVER_DEPLOYMENT_PROFILE
      ?? 'standalone',
  ).trim();
  if (!BROWSER_DEPLOYMENT_PROFILES.includes(profile)) {
    throw new Error(
      `browser deployment profile must be one of ${BROWSER_DEPLOYMENT_PROFILES.join(', ')}`,
    );
  }
  return profile;
}

export function browserDistEnvAlias(environment) {
  const alias = BROWSER_DIST_ENV_ALIASES[String(environment ?? '').trim()];
  if (!alias) {
    throw new Error(
      `browser dist environment must be one of ${LIFECYCLE_ENVIRONMENTS.join(', ')}`,
    );
  }
  return alias;
}

/**
 * Relative Vite `build.outDir` for one browser application root.
 * Every deployment profile owns its own environment subtree so `standalone`
 * and `cloud` builds coexist without overwriting each other:
 * `dist/<deploymentProfile>/<envAlias>` — for example `dist/standalone/dev`,
 * `dist/standalone/prod`, `dist/cloud/dev`, `dist/cloud/prod`.
 * Never a bare `dist/`.
 */
export function resolveBrowserDistOutDir(environment, deploymentProfile, processEnv = process.env) {
  const alias = browserDistEnvAlias(environment);
  const profile = normalizeBrowserDeploymentProfile(deploymentProfile, processEnv);
  return `dist/${profile}/${alias}`;
}

/**
 * Absolute build output directory under an application root.
 */
export function resolveBrowserDistAbsoluteRoot(
  applicationRoot,
  environment,
  deploymentProfile = 'standalone',
) {
  return `${String(applicationRoot).replace(/[\\/]+$/u, '')}/${resolveBrowserDistOutDir(environment, deploymentProfile)}`;
}

/**
 * Installed Adaptive Web SPA roots (binary-package). Environment is selected
 * at packaging time; install paths do not retain dist/{alias} segments.
 */
export function resolveInstalledBrowserWebRoot(runtimeCode, architecture) {
  const code = String(runtimeCode ?? '').trim();
  const arch = String(architecture ?? '').trim();
  if (!code) {
    throw new Error('runtimeCode is required');
  }
  if (arch !== 'pc' && arch !== 'h5' && arch !== 'static') {
    throw new Error('architecture must be pc, h5, or static');
  }
  return `/usr/share/sdkwork/${code}/web/${arch}`;
}
