/**
 * TypeScript publisher.
 *
 * Publishes the composed consumer package (`@sdkwork/*`) to npmjs.com.
 * The transport package (`*-generated-typescript` under `generated/server-openapi/`)
 * is NEVER published — see SDK_PACKAGE_NAMING_SPEC.md §1.1.
 *
 * Credentials: `NPM_TOKEN` (preferred). Falls back to a logged-in `.npmrc`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bumpVersion, readJson, runCommand, toDisplayPath } from '../util.mjs';

export const language = 'typescript';
export const registry = 'npm';

/**
 * Detect a publishable TypeScript consumer package.
 * Returns `{ packageName, version, packagePath }` or `null`.
 */
export function detect(familyRoot, manifest) {
  const stem = path.basename(familyRoot);
  const candidates = [
    manifest?.typescript?.composedRoot
      ? path.join(familyRoot, manifest.typescript.composedRoot)
      : null,
    path.join(familyRoot, `${stem}-typescript`),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const pkgPath = path.join(candidate, 'package.json');
    const pkg = readJson(pkgPath);
    if (!pkg || !pkg.name) continue;

    // Hard rule: never publish generated transport packages.
    if (pkg.name.endsWith('-generated-typescript')) continue;
    // Only SDKWork consumer packages are in scope.
    if (!pkg.name.startsWith('@sdkwork/')) continue;
    // Skip packages explicitly marked private.
    if (pkg.private === true) continue;

    return {
      packageName: pkg.name,
      version: pkg.version,
      packagePath: candidate,
      packageJsonPath: pkgPath,
    };
  }
  return null;
}

export function build(pkgPath, { skipBuild }) {
  if (skipBuild) return { ok: true, detail: 'skipped build' };
  const pkg = readJson(path.join(pkgPath, 'package.json')) ?? {};
  const hasBuildScript = pkg.scripts && typeof pkg.scripts.build === 'string';
  if (!hasBuildScript) return { ok: true, detail: 'no build script' };

  const r = runCommand('pnpm', ['-C', pkgPath, 'run', 'build'], { cwd: pkgPath });
  if (r.error || r.status !== 0) {
    return { ok: false, detail: `build failed (status ${r.status ?? 'null'})` };
  }
  return { ok: true, detail: 'built' };
}

/**
 * Bump the version in the package.json (in place) and return the new version.
 * Used when re-publishing a previously broken release: npm forbids overwriting
 * an already-published version, so callers pass `--bump patch` to republish
 * at 0.1.1 instead of failing on the existing 0.1.0.
 *
 * @param {string} pkgPath
 * @param {'patch'|'minor'|'major'} level
 * @returns {{ ok: true, version: string } | { ok: false, detail: string }}
 */
export function bumpPackageVersion(pkgPath, level) {
  const pkgJsonPath = path.join(pkgPath, 'package.json');
  const pkg = readJson(pkgJsonPath);
  if (!pkg || !pkg.version) {
    return { ok: false, detail: 'package.json missing version field' };
  }
  // bumpVersion imported at top of file from ../util.mjs
  const next = bumpVersion(pkg.version, level);
  pkg.version = next;
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return { ok: true, version: next };
}

export function publish(pkgPath, { tag = 'latest', access = 'public', env = {} }) {
  // IMPORTANT: use `pnpm publish`, not `npm publish`.
  // pnpm publish resolves `workspace:*` protocol specifiers to the actual
  // version of the referenced workspace package before publishing, so the
  // published package.json contains concrete versions (e.g. `^1.0.5`) instead
  // of `workspace:*` (which external consumers cannot resolve). See
  // SDK_PACKAGE_NAMING_SPEC.md §1.1 and pnpm docs on workspace protocol.
  const args = [
    'publish',
    '--access', access,
    '--tag', tag,
    '--no-git-checks',
  ];

  // Write a temporary .npmrc in the package directory so the package manager
  // picks up the correct token. This is necessary because ~/.npmrc may contain
  // a stale token, and the package manager may stop searching for .npmrc at
  // submodule boundaries.
  // The token comes from NPM_TOKEN env var or the workspace-level .npmrc.
  const token = env.NPM_TOKEN || process.env.NPM_TOKEN;
  const tempNpmrc = path.join(pkgPath, '.npmrc');
  let wroteTempNpmrc = false;
  if (token) {
    fs.writeFileSync(
      tempNpmrc,
      `//registry.npmjs.org/:_authToken=${token}\nalways-auth=true\n`,
      'utf8',
    );
    wroteTempNpmrc = true;
  }

  try {
    const r = runCommand('pnpm', args, { cwd: pkgPath, env });
    if (r.error || r.status !== 0) {
      return { ok: false, detail: `pnpm publish exit ${r.status ?? 'null'} at ${toDisplayPath(pkgPath)}` };
    }
    return { ok: true, detail: `published to npm (${tag})` };
  } finally {
    // Always clean up the temporary .npmrc so it never gets committed.
    if (wroteTempNpmrc) {
      try { fs.unlinkSync(tempNpmrc); } catch { /* ignore */ }
    }
  }
}

export function credentialName() {
  return 'NPM_TOKEN or ~/.npmrc authToken';
}

export function hasCredentials(env) {
  if (env.NPM_TOKEN || env.NODE_AUTH_TOKEN) return true;
  // Fallback: a logged-in ~/.npmrc (global or project-local) is also valid auth.
  try {
    for (const candidate of [path.join(os.homedir(), '.npmrc'), '.npmrc']) {
      if (fs.existsSync(candidate)) {
        const text = fs.readFileSync(candidate, 'utf8');
        if (/_authToken\s*=/.test(text)) return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}
