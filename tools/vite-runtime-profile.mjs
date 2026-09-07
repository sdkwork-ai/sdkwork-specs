/**
 * Shared Vite runtime-profile resolution for Adaptive Web PC/H5 applications.
 * NOTE: this is a library module imported by vite.config.ts files — it MUST
 * NOT carry a `#!` shebang. Vite's config loader inlines imported modules
 * into the config bundle and a shebang there becomes a syntax error
 * (observed as `Syntax error "!"` at the import site).
 * Authority: ENVIRONMENT_SPEC.md §5.1.0.2 (Build-Serve Profile Coherence),
 * PNPM_SCRIPT_SPEC.md §4.2.
 *
 * Every PC/H5 application vite.config.ts MUST import `resolveViteEnvironment`
 * from this module instead of re-declaring a local copy of the mode parser.
 * Local copies have historically drifted (the `demo` lifecycle environment was
 * missing from 70+ apps, silently routing `cloud.demo` builds into
 * `dist/cloud/prod`).
 *
 * This module is the single cohesion point for:
 *   - Vite `--mode <deploymentProfile>.<environment>` parsing;
 *   - the lifecycle environment vocabulary (including `demo`);
 *   - lucide-react ESM entry discovery (entry filename changed across
 *     major versions: `lucide-react.js` → `lucide-react.mjs`); hard-coding
 *     the filename broke every cloud build (UNLOADABLE_DEPENDENCY).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

const LIFECYCLE_ENVIRONMENTS = Object.freeze([
  'development',
  'test',
  'staging',
  'demo',
  'production',
]);

const DEPLOYMENT_PROFILES = Object.freeze(['standalone', 'cloud']);

const PROFILE_ID_PATTERN = /^(standalone|cloud)\.(development|test|staging|demo|production)$/u;

/**
 * Parse a Vite mode (or the build runner's injected SDKWORK_ENVIRONMENT)
 * into the lifecycle environment name. Falls back to `production` outside
 * recognized values, matching the historical build-runner default.
 */
export function resolveViteEnvironment(mode, processEnv = undefined) {
  const profileMatch = PROFILE_ID_PATTERN.exec(mode ?? '');
  if (profileMatch?.[2]) {
    return profileMatch[2];
  }
  const fromEnv = String(processEnv?.SDKWORK_ENVIRONMENT ?? '').trim();
  if (LIFECYCLE_ENVIRONMENTS.includes(fromEnv)) {
    return fromEnv;
  }
  if (LIFECYCLE_ENVIRONMENTS.has(String(mode ?? '').trim())) {
    return String(mode).trim();
  }
  return 'production';
}

/**
 * Full runtime profile: deployment profile + environment from a Vite mode.
 * The build runner (`build-browser-client.mjs`) injects
 * `SDKWORK_DEPLOYMENT_PROFILE`/`SDKWORK_ENVIRONMENT` into the Vite process;
 * process env wins so the dev runner can override the mode when needed.
 */
export function resolveViteRuntimeProfile(mode, processEnv = {}) {
  const profileMatch = PROFILE_ID_PATTERN.exec(mode ?? '');
  const deploymentProfile = String(
    processEnv.SDKWORK_DEPLOYMENT_PROFILE ?? profileMatch?.[1] ?? 'standalone',
  ).trim();
  const environment = resolveViteEnvironment(mode, processEnv);
  if (!DEPLOYMENT_PROFILES.includes(deploymentProfile)) {
    throw new Error(`unsupported Vite deployment profile: ${deploymentProfile}`);
  }
  return { deploymentProfile, environment, profileId: `${deploymentProfile}.${environment}` };
}

/**
 * Resolve the installed lucide-react ESM entry for a given app root.
 * lucide-react renamed its ESM bundle across major versions
 * (`dist/esm/lucide-react.js` in ≤0.x lines, `dist/esm/lucide-react.mjs`
 * in the 1.x line). Probing the package directory keeps the alias stable.
 * Falls back to the package specifier itself (undefined) when lucide-react
 * is not installed locally — the caller can then omit the alias.
 */
export function resolveLucideReactEntry(appRoot, candidates = undefined) {
  const probed = candidates ?? [
    'node_modules/lucide-react/dist/esm/lucide-react.mjs',
    'node_modules/lucide-react/dist/esm/lucide-react.js',
  ];
  for (const relative of probed) {
    const absolute = path.resolve(appRoot, relative);
    if (existsSync(absolute)) {
      return absolute;
    }
  }
  return undefined;
}

export { LIFECYCLE_ENVIRONMENTS, DEPLOYMENT_PROFILES, PROFILE_ID_PATTERN };
