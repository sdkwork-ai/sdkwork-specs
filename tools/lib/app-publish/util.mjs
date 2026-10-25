/**
 * Shared helpers for app publish tooling.
 *
 * Conventions mirror lib/sdk-publish/util.mjs:
 *  - All packagers receive normalized absolute paths.
 *  - Commands run via `runCommand`, which uses a shell on Windows so that
 *    `pnpm`, `flutter`, `node`, `gh`, `git` resolve via PATHEXT.
 *  - Logs are emitted through `log`/`warn` so the orchestrator can prefix them.
 *
 * Apps are private application surfaces, never npm packages. "Publish" here
 * means: build platform-specific distributable artifacts and upload them to a
 * release destination (GitHub Release / local archive). See
 * APP_*_ARCHITECTURE_SPEC.md and RELEASE_SPEC.md §2 (application release type).
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Run a command, inheriting stdio by default. Returns the full result.
 *
 * @param {string} command - executable name, e.g. `pnpm`, `flutter`, `node`
 * @param {string[]} args - arguments
 * @param {object} [options]
 * @param {string} [options.cwd] - working directory
 * @param {object} [options.env] - merged into process.env
 * @param {'inherit'|'pipe'|'ignored'} [options.stdio] - default `inherit`
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export function runCommand(command, args, options = {}) {
  const { cwd, env, stdio = 'inherit' } = options;
  return spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio,
    shell: process.platform === 'win32',
  });
}

/**
 * Read JSON safely; returns `null` when missing or unparseable.
 * @param {string} filePath
 * @returns {object|null}
 */
export function readJson(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Read text safely; returns `null` when missing.
 * @param {string} filePath
 * @returns {string|null}
 */
export function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Normalize a path for cross-platform display (forward slashes).
 * @param {string} p
 * @returns {string}
 */
export function toDisplayPath(p) {
  return String(p).replace(/\\/g, '/');
}

/**
 * Whether a version string looks like a pre-release.
 * Treats `0.x` and any SemVer pre-release suffix (`-rc.1`, `-beta`, `-alpha-1`)
 * as pre-release. Build metadata (`+build`) is ignored.
 * @param {string} version
 * @returns {boolean}
 */
export function isPreRelease(version) {
  const core = String(version).split('+')[0];
  if (core.includes('-')) return true;
  return /^0\./.test(core);
}

/**
 * Compute the SHA-256 checksum of a file. Returns a hex digest, or `null`
 * when the file cannot be read. Required by `agent.app.config.json#security`
 * when `checksumRequired: true`.
 * @param {string} filePath
 * @returns {string|null}
 */
export function sha256File(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Resolve the human-friendly size label for a file.
 * @param {string} filePath
 * @returns {string}
 */
export function fileSizeLabel(filePath) {
  try {
    const bytes = fs.statSync(filePath).size;
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  } catch {
    return '0B';
  }
}

/**
 * Ensure a directory exists.
 * @param {string} dir
 */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Recursively collect files under `dir` whose basename matches `pattern`.
 * Returns absolute paths sorted by relative path. Used by packagers to locate
 * built artifacts when the build tool emits into nested output trees.
 *
 * @param {string} dir - absolute directory to walk
 * @param {RegExp} pattern - matched against basename
 * @returns {string[]}
 */
export function collectFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (pattern.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  out.sort();
  return out;
}

/**
 * Archive a directory into a zip file using the system `tar` (bsdtar on
 * Windows 10+ and macOS, GNU tar + `-a` elsewhere). Returns the output file
 * path on success or `null` on failure. Used by packagers to turn a built
 * `dist/` tree into a single release asset.
 *
 * @param {string} srcDir - directory to archive (must exist)
 * @param {string} outFile - destination `.zip` path
 * @returns {string|null} outFile on success, null on failure
 */
export function archiveDirectory(srcDir, outFile) {
  if (!fs.existsSync(srcDir)) return null;
  const parent = path.dirname(srcDir);
  const base = path.basename(srcDir);
  ensureDir(path.dirname(outFile));
  // Remove a stale archive so the result reflects the current build.
  try { fs.unlinkSync(outFile); } catch { /* ignore */ }
  const r = runCommand('tar', ['-caf', outFile, '-C', parent, base], { stdio: 'pipe' });
  if (r.status !== 0 || !fs.existsSync(outFile)) return null;
  return outFile;
}

/**
 * Resolve the GitHub `owner/repo` slug from the git remote of a repository.
 * Returns `null` when no `origin` remote points at github.com.
 * @param {string} repoRoot
 * @returns {string|null}
 */
export function detectGithubRepoSlug(repoRoot) {
  const r = runCommand('git', ['remote', 'get-url', 'origin'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  const url = (r.stdout || '').toString().trim();
  if (!url) return null;
  // git@github.com:owner/repo.git  |  https://github.com/owner/repo.git
  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;
  const https = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (https) return `${https[1]}/${https[2]}`;
  return null;
}

/**
 * Build the release tag for an app version. Scoped per app to avoid collisions
 * across the workspace: `<appKey>-v<version>` (e.g. `sdkwork-im-pc-v1.2.0`).
 * @param {string} appKey
 * @param {string} version
 * @returns {string}
 */
export function releaseTag(appKey, version) {
  return `${appKey}-v${version}`;
}

/** Console wrapper so callers can swap sinks if needed. */
export const log = (...args) => console.log(...args);
export const warn = (...args) => console.warn(...args);
