/**
 * Shared helpers for app packagers.
 *
 * Packagers are per-architecture (pc / h5 / flutter-mobile / mini-program).
 * Each owns build + artifact collection; the upload transport is shared via
 * uploaders.mjs. This module centralizes the app-manifest artifact-matrix
 * lookup so packagers stay focused on build commands and output discovery.
 */
import path from 'node:path';

import { readJson } from '../util.mjs';

/**
 * Read the publishable artifact package entries declared in
 * `agent.app.config.json#artifacts.installConfig.packages[]`.
 *
 * Each entry shape (SDKWork App Standard v3):
 *   { id, name, packageFormat, platform, architecture,
 *     deploymentProfile, runtimeTarget, url, enabled, metadata }
 *
 * Entries with `enabled: false` are still returned — they describe the
 * intended release matrix; the packager decides whether the build actually
 * produced the artifact. `metadata.releaseBuildDeferred: true` means the
 * package is declared but not yet built.
 *
 * @param {object} appConfig - parsed agent.app.config.json
 * @param {string} [platform] - optional platform filter (e.g. 'web', 'windows')
 * @returns {object[]}
 */
export function artifactPackages(appConfig, platform) {
  const pkgs = appConfig?.artifacts?.installConfig?.packages;
  if (!Array.isArray(pkgs)) return [];
  return pkgs.filter((p) => {
    if (platform && p.platform && !platformMatches(p.platform, platform)) return false;
    return true;
  });
}

/**
 * Match a manifest platform token against a requested platform.
 * Manifest tokens: WEB, DESKTOP, DESKTOP_WINDOWS, DESKTOP_MACOS, DESKTOP_LINUX,
 * ANDROID, IOS, WEIXIN.
 */
function platformMatches(token, requested) {
  const t = String(token).toLowerCase();
  const r = String(requested).toLowerCase();
  if (t === r) return true;
  // `desktop` umbrella matches desktop_* tokens.
  if (r === 'desktop' && t.startsWith('desktop')) return true;
  if (r === 'windows' && t === 'desktop_windows') return true;
  if (r === 'macos' && t === 'desktop_macos') return true;
  if (r === 'linux' && t === 'desktop_linux') return true;
  if (r === 'web' && t === 'web') return true;
  if (r === 'android' && t === 'android') return true;
  if (r === 'ios' && t === 'ios') return true;
  if (r === 'weixin' && (t === 'weixin' || t === 'mini_program')) return true;
  return false;
}

/**
 * Resolve the canonical build command for an app root.
 *
 * Priority:
 *  1. `package.json#scripts._sdkwork:build` — the SDKWork-standard app build.
 *  2. `package.json#scripts.build` — generic fallback.
 *
 * Returns the script NAME to run via `pnpm run <name>`, or null when no build
 * script exists.
 *
 * @param {string} appRoot
 * @param {string} [preferred] - preferred script name override
 * @returns {string|null}
 */
export function resolveBuildScript(appRoot, preferred) {
  const pkg = readJson(path.join(appRoot, 'package.json'));
  if (!pkg || !pkg.scripts) return null;
  if (preferred && typeof pkg.scripts[preferred] === 'string') return preferred;
  if (typeof pkg.scripts['_sdkwork:build'] === 'string') return '_sdkwork:build';
  if (typeof pkg.scripts['build'] === 'string') return 'build';
  return null;
}

/**
 * Resolve the staging directory for an app build. Defaults to `<appRoot>/.sdkwork/dist`.
 * @param {string} appRoot
 * @returns {string}
 */
export function stagingDir(appRoot) {
  return path.join(appRoot, '.sdkwork', 'dist');
}
