/**
 * PC application packager (React + Tauri / React + Electron / React + Capacitor).
 *
 * Build targets:
 *  - `web`:      `pnpm run _sdkwork:build` (Vite build + esbuild server) → `dist/`
 *  - `windows` / `macos` / `linux`: native desktop bundle via the app's
 *    `build:desktop:local` (Tauri host), `build:desktop:electron:local`
 *    (Electron host), or `build:desktop:capacitor:local` (Capacitor host)
 *    script when present. The host kind is read from the app manifest
 *    `artifacts.installConfig.packages[].clientArchitecture`
 *    (`tauri` | `electron` | `capacitor`).
 *
 * Artifacts:
 *  - web:   `dist/` archived as `web-universal.zip`
 *  - desktop (Tauri): installers under `src-tauri/target/release/bundle/`
 *    (`.exe`/`.msi`, `.dmg`, `.AppImage`/`.deb`).
 *  - desktop (Electron): installers under `release/`, `out/`, or `dist/`
 *    (`.exe`/`.msi`, `.dmg`, `.AppImage`/`.deb`, `.blockmap`).
 *  - desktop (Capacitor): installers under the Capacitor host `electron/`
 *    scaffold output (`electron/release`, `electron/dist`, `electron/out`).
 *
 * Authority: APP_PC_ARCHITECTURE_SPEC.md, APP_PC_REACT_UI_SPEC.md,
 * DESKTOP_APP_ARCHITECTURE_SPEC.md §5.1/§5.3/§5.4, RELEASE_SPEC.md §2.
 */
import fs from 'node:fs';
import path from 'node:path';

import { archiveDirectory, collectFiles, readJson, runCommand } from '../util.mjs';
import { artifactPackages, resolveBuildScript, stagingDir } from './shared.mjs';

export const architecture = 'pc';
export const defaultPlatforms = ['web', 'windows', 'macos', 'linux'];
export const registry = 'github';

const DESKTOP_HOST_KINDS = new Set(['tauri', 'electron', 'capacitor']);
const DESKTOP_BUILD_SCRIPTS = {
  tauri: 'build:desktop:local',
  electron: 'build:desktop:electron:local',
  capacitor: 'build:desktop:capacitor:local',
};
const TAURI_BUNDLE_ROOT = path.join('src-tauri', 'target', 'release', 'bundle');
const ELECTRON_BUNDLE_ROOTS = ['release', 'out', 'dist'];
const CAPACITOR_BUNDLE_ROOTS = [
  path.join('electron', 'release'),
  path.join('electron', 'dist'),
  path.join('electron', 'out'),
];

/** Resolve the desktop host kind from the app manifest, defaulting to tauri. */
function desktopHostKind(appRoot, appConfig) {
  const config = appConfig ?? readJson(path.join(appRoot, 'sdkwork.app.config.json')) ?? {};
  const pkgs = config?.artifacts?.installConfig?.packages;
  if (Array.isArray(pkgs)) {
    for (const p of pkgs) {
      const kind = String(p?.clientArchitecture ?? p?.metadata?.clientArchitecture ?? '').toLowerCase();
      if (DESKTOP_HOST_KINDS.has(kind)) return kind;
    }
  }
  return 'tauri';
}

function firstExistingRoot(appRoot, candidates) {
  const existing = candidates
    .map((dir) => path.join(appRoot, dir))
    .find((dir) => fs.existsSync(dir));
  return existing ?? path.join(appRoot, candidates[0]);
}

function electronBundleRoot(appRoot) {
  return firstExistingRoot(appRoot, ELECTRON_BUNDLE_ROOTS);
}

function capacitorBundleRoot(appRoot) {
  return firstExistingRoot(appRoot, CAPACITOR_BUNDLE_ROOTS);
}

/**
 * @returns {{ appKey: string, version: string, appRoot: string, platforms: string[] } | null}
 */
export function detect(appRoot, appConfig, { platformFilter } = {}) {
  const pkg = readJson(path.join(appRoot, 'package.json'));
  if (!pkg || !pkg.name) return null;

  const appKey = appConfig?.app?.key ?? path.basename(appRoot);
  const version = pkg.version || appConfig?.release?.currentVersion || '0.0.0';

  // Resolve target platforms from the manifest artifact matrix.
  let platforms = artifactPackages(appConfig).map((p) => normalizePlatform(p.platform));
  platforms = Array.from(new Set(platforms)).filter(Boolean);
  if (platforms.length === 0) platforms = ['web'];

  if (platformFilter) {
    platforms = platforms.filter((p) => p === platformFilter || (platformFilter === 'desktop' && p !== 'web'));
    if (platforms.length === 0) return null;
  }
  if (platforms.length === 0) return null;

  return { appKey, version, appRoot, platforms };
}

function normalizePlatform(token) {
  const t = String(token || '').toLowerCase();
  if (t === 'web') return 'web';
  if (t === 'desktop_windows' || t === 'windows') return 'windows';
  if (t === 'desktop_macos' || t === 'macos') return 'macos';
  if (t === 'desktop_linux' || t === 'linux') return 'linux';
  if (t === 'desktop') return 'desktop';
  return null;
}

/**
 * @returns {{ ok: boolean, detail: string }}
 */
export function build(appRoot, { skipBuild, platform, env } = {}) {
  if (skipBuild) return { ok: true, detail: 'skipped build' };

  if (platform === 'web') {
    const script = resolveBuildScript(appRoot);
    if (!script) return { ok: true, detail: 'no build script' };
    const r = runCommand('pnpm', ['-C', appRoot, 'run', script], { cwd: appRoot, env });
    if (r.error || r.status !== 0) {
      return { ok: false, detail: `web build failed (status ${r.status ?? 'null'})` };
    }
    return { ok: true, detail: 'web built' };
  }

  if (platform === 'windows' || platform === 'macos' || platform === 'linux') {
    // Desktop builds are native host builds; they run on the matching host
    // runner. The app exposes `build:desktop:local` (Tauri),
    // `build:desktop:electron:local` (Electron), or
    // `build:desktop:capacitor:local` (Capacitor) when desktop packaging is
    // wired. A host without its own script falls back to the Tauri script name.
    const pkg = readJson(path.join(appRoot, 'package.json')) ?? {};
    const scripts = (pkg.scripts ?? {});
    const kind = desktopHostKind(appRoot);
    const hostScript = DESKTOP_BUILD_SCRIPTS[kind];
    const script = typeof scripts[hostScript] === 'string'
      ? hostScript
      : DESKTOP_BUILD_SCRIPTS.tauri;
    if (typeof scripts[script] !== 'string') {
      return { ok: false, detail: `no ${script} script for ${platform} desktop` };
    }
    const r = runCommand('pnpm', ['-C', appRoot, 'run', script], { cwd: appRoot, env });
    if (r.error || r.status !== 0) {
      return { ok: false, detail: `desktop build failed for ${platform} (status ${r.status ?? 'null'})` };
    }
    return { ok: true, detail: `${platform} desktop built` };
  }

  return { ok: false, detail: `unknown pc platform: ${platform}` };
}

/**
 * @returns {Array<{ path: string, name: string, platform: string, packageId?: string, label?: string }>}
 */
export function collectArtifacts(appRoot, { appKey, version, platform, appConfig } = {}) {
  const stage = stagingDir(appRoot);

  if (platform === 'web') {
    const distDir = path.join(appRoot, 'dist');
    if (!fs.existsSync(distDir)) return [];
    const out = path.join(stage, `${appKey}-${version}-web.zip`);
    const zipped = archiveDirectory(distDir, out);
    if (!zipped) return [];
    const pkg = artifactPackages(appConfig, 'web')[0];
    return [{ path: zipped, name: 'web-universal.zip', platform: 'web', packageId: pkg?.id, label: 'Web Bundle' }];
  }

  if (platform === 'windows' || platform === 'macos' || platform === 'linux') {
    const kind = desktopHostKind(appRoot, appConfig);
    const bundleRoot = kind === 'electron'
      ? electronBundleRoot(appRoot)
      : kind === 'capacitor'
        ? capacitorBundleRoot(appRoot)
        : path.join(appRoot, TAURI_BUNDLE_ROOT);
    if (!fs.existsSync(bundleRoot)) return [];
    const patterns = {
      windows: /\.(exe|msi|blockmap)$/i,
      macos: /\.(dmg|zip|blockmap)$/i,
      linux: /\.(AppImage|deb|blockmap)$/i,
    };
    const found = collectFiles(bundleRoot, patterns[platform]);
    if (found.length === 0) return [];
    const pkg = artifactPackages(appConfig, platform)[0];
    return found.slice(-1).map((p) => ({
      path: p,
      name: path.basename(p),
      platform,
      packageId: pkg?.id,
      label: `${platform} desktop installer (${kind})`,
    }));
  }

  return [];
}
