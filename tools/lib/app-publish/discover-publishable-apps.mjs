/**
 * Multi-architecture app discovery for the publish orchestrator.
 *
 * Mirrors lib/sdk-publish/discover-publishable-sdks.mjs: it scans every
 * repository's `apps/<app>/` directory, resolves the app architecture from
 * `agent.app.config.json#runtime` plus the conventional directory suffix
 * (`-pc`, `-h5`, `-flutter-mobile`, `-mini-program`), and produces
 * publishable app records.
 *
 * Authority: APPLICATION_SPEC.md, APP_PC_ARCHITECTURE_SPEC.md,
 * APP_H5_ARCHITECTURE_SPEC.md, FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md,
 * MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md, RELEASE_SPEC.md §2.
 */
import fs from 'node:fs';
import path from 'node:path';

import { listWorkspaceRepos } from '../app-sdk-consumer-import-patterns.mjs';
import { readJson, toDisplayPath } from './util.mjs';

/**
 * App architectures (runtime families) supported by the publish orchestrator.
 * Order matters for `--architecture all` dry-run reports.
 *
 * Each architecture owns a packager in ./packagers/<architecture>.mjs.
 */
export const SUPPORTED_ARCHITECTURES = ['pc', 'h5', 'flutter-mobile', 'mini-program'];

/**
 * Map an `agent.app.config.json#runtime.framework` value to a canonical
 * architecture. Falls back to `null` when the framework is not one of the
 * supported app runtime families.
 */
const FRAMEWORK_TO_ARCH = {
  'react-tauri': 'pc',
  'react-tauri-desktop': 'pc',
  react: 'h5',
  'react-web': 'h5',
  flutter: 'flutter-mobile',
  'mp-weixin': 'mini-program',
  'wechat-miniprogram': 'mini-program',
};

/**
 * @typedef {Object} PublishableApp
 * @property {string} repoRoot        - absolute repo root containing `apps/`
 * @property {string} repoName        - basename of repoRoot
 * @property {string} appRoot         - absolute `apps/<app>` path
 * @property {string} appKey          - app key (manifest app.key or dir name)
 * @property {string} architecture    - one of SUPPORTED_ARCHITECTURES
 * @property {string} version         - version (from package.json)
 * @property {string} appName         - package.json#name (e.g. @sdkwork/im-pc)
 * @property {object} appConfig       - parsed agent.app.config.json (may be {})
 * @property {string} appConfigPath   - absolute path to agent.app.config.json
 * @property {object} packageJson     - parsed package.json
 * @property {boolean} manifestDriven - true when arch came from manifest
 */

/**
 * Discover publishable apps across the workspace.
 *
 * @param {string} workspaceRoot
 * @returns {PublishableApp[]}
 */
export function discoverPublishableApps(workspaceRoot) {
  const out = [];
  for (const repoRoot of listWorkspaceRepos(workspaceRoot)) {
    out.push(...discoverRepoApps(repoRoot));
  }
  return out.sort((a, b) => {
    const r = a.repoName.localeCompare(b.repoName);
    if (r !== 0) return r;
    return a.appKey.localeCompare(b.appKey);
  });
}

/**
 * Discover publishable apps in one repository by scanning `apps/<app>/`.
 *
 * @param {string} repoRoot
 * @returns {PublishableApp[]}
 */
export function discoverRepoApps(repoRoot) {
  const appsDir = path.join(repoRoot, 'apps');
  if (!fs.existsSync(appsDir)) return [];

  const out = [];
  for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const appRoot = path.join(appsDir, entry.name);
    const resolved = resolveApp(repoRoot, appRoot, entry.name);
    if (resolved) out.push(resolved);
  }
  return out;
}

/**
 * Resolve a single app directory into a publishable record.
 * Returns `null` when the directory has no `package.json`, no recognizable
 * architecture, or when the app manifest declares no publishable artifact
 * packages.
 *
 * Architecture resolution order:
 *  1. `agent.app.config.json#runtime.framework` (declared)
 *  2. Conventional directory suffix (`-pc`, `-h5`, `-flutter-mobile`,
 *     `-mini-program`)
 *
 * @param {string} repoRoot
 * @param {string} appRoot
 * @param {string} appDirName
 * @returns {PublishableApp|null}
 */
export function resolveApp(repoRoot, appRoot, appDirName) {
  const pkgPath = path.join(appRoot, 'package.json');
  const packageJson = readJson(pkgPath);
  if (!packageJson || !packageJson.name) return null;

  const appConfigPath = path.join(appRoot, 'agent.app.config.json');
  const appConfig = readJson(appConfigPath) ?? {};

  const appKey = appConfig?.app?.key ?? appDirName;
  const version = resolveVersion(packageJson, appConfig);

  // Declared architecture from manifest runtime.framework.
  let architecture = null;
  let manifestDriven = false;
  const framework = appConfig?.runtime?.framework;
  if (framework && FRAMEWORK_TO_ARCH[framework]) {
    architecture = FRAMEWORK_TO_ARCH[framework];
    manifestDriven = true;
  }

  // Fallback: conventional directory suffix.
  if (!architecture) {
    architecture = architectureFromDirName(appDirName);
    manifestDriven = false;
  }
  if (!architecture || !SUPPORTED_ARCHITECTURES.includes(architecture)) return null;

  return {
    repoRoot,
    repoName: path.basename(repoRoot),
    appRoot,
    appKey,
    architecture,
    version,
    appName: packageJson.name,
    appConfig,
    appConfigPath,
    packageJson,
    manifestDriven,
  };
}

/**
 * Resolve the publishable version. `agent.app.config.json#app.versionSource`
 * is `package.json` by default; we honor that and fall back to the release
 * block only when package.json has no version.
 */
function resolveVersion(packageJson, appConfig) {
  if (typeof packageJson.version === 'string' && packageJson.version) {
    return packageJson.version;
  }
  const fromRelease = appConfig?.release?.currentVersion;
  if (typeof fromRelease === 'string' && fromRelease) return fromRelease;
  return '0.0.0';
}

/**
 * Derive an architecture from a conventional app directory name suffix.
 * @param {string} dirName
 * @returns {string|null}
 */
export function architectureFromDirName(dirName) {
  if (dirName.endsWith('-flutter-mobile')) return 'flutter-mobile';
  if (dirName.endsWith('-mini-program')) return 'mini-program';
  if (dirName.endsWith('-pc')) return 'pc';
  if (dirName.endsWith('-h5')) return 'h5';
  return null;
}

/**
 * Filter the discovered list by repo / app / architecture selectors.
 *
 * @param {PublishableApp[]} all
 * @param {{repo?: string, app?: string, architecture?: string}} filters
 * @returns {PublishableApp[]}
 */
export function filterPublishable(all, { repo, app, architecture } = {}) {
  return all.filter((item) => {
    if (repo && item.repoName !== repo) return false;
    if (app && item.appKey !== app && item.appName !== app) return false;
    if (architecture && architecture !== 'all' && item.architecture !== architecture) return false;
    return true;
  });
}

/** Pretty-print a discovered record for dry-run output. */
export function describePublishable(item) {
  return `${item.repoName}/${item.appKey} [${item.architecture}] @ ${toDisplayPath(item.appRoot)}`;
}
