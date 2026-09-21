#!/usr/bin/env node

/**
 * Link materialization rules for the SDKWORK workspace
 * (PNPM_WORKSPACE_DEPENDENCY_SPEC.md).
 *
 * See `tools/check-workspace-link-materialization.mjs` for the full rationale.
 * This module holds the pure decision logic so it can be unit-tested without
 * touching a real repository.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Never descended into: generated state, vendored code, VCS metadata. */
export const SKIP_DIRS = Object.freeze(new Set([
  'node_modules', 'external', 'vendor', 'target', 'dist', 'build', 'out',
  'coverage', '.git', '.sdkwork', '.workbuddy', 'generated', 'snapshots',
]));

/** PNPM's own install-freshness marker. */
export const INSTALL_MARKER = path.join('node_modules', '.modules.yaml');

/** The dependency key shape this check governs. */
export const WORKSPACE_SCOPE = '@sdkwork/';

/** A missing link is either recoverable by install, or a declaration bug. */
export const CAUSE_INSTALL_PENDING = 'install-pending';
export const CAUSE_WORKSPACE_UNCOVERED = 'workspace-uncovered';

/**
 * Parse one manifest file, tolerating a UTF-8 BOM.
 *
 * `JSON.parse` rejects a leading U+FEFF, so a BOM-prefixed `package.json` would
 * otherwise be *silently invisible* to this check — the worst possible failure
 * mode, because the package it declares simply vanishes from the member set and
 * every dependency it owns goes unreported. Strip the BOM, never swallow it.
 */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
}

/** Read a manifest, tolerating a UTF-8 BOM (same policy as {@link readJson}). */
export function readManifest(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

/** Depth-first walk collecting every `package.json` outside generated dirs. */
export function collectPackageManifests(repoRoot) {
  const manifests = [];
  const stack = [repoRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(path.join(dir, entry.name));
        }
        continue;
      }
      if (entry.name !== 'package.json') {
        continue;
      }
      const manifest = readJson(path.join(dir, entry.name));
      // A manifest without a `name` is not a workspace package; its dependency
      // block is not ours to police.
      if (manifest?.name) {
        manifests.push({ dir, manifest });
      }
    }
  }
  return manifests;
}

/**
 * Declared workspace dependencies of one manifest, restricted to the ones that
 * must resolve through `node_modules`.
 *
 * Only `workspace:` specifiers are inspected. A plain range such as `^1.0.2` is
 * fetched from the registry, so the absence of a local link is correct for it —
 * flagging those would be a false positive.
 *
 * Two specifier shapes are legal and both must be understood:
 *   `workspace:*` / `workspace:^1.2.3`  — the link name IS the package name.
 *   `workspace:sdkwork-drive-pc-drive@*` — an *alias*: pnpm materializes the
 *   link under the key (`@sdkwork/drive-pc-drive`) but the package it points to
 *   is the unscoped name before the `@`. Reading the key as the package name
 *   would send a repairer looking for a package that does not exist.
 *
 * `optionalDependencies` is included: pnpm materializes those links the same way,
 * and omitting the field would let them rot unreported.
 */
export function declaredWorkspaceDependencies(manifest) {
  const declared = new Map();
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith(WORKSPACE_SCOPE)) {
        continue;
      }
      if (typeof specifier !== 'string' || !specifier.startsWith('workspace:')) {
        continue;
      }
      declared.set(name, {
        name,
        specifier,
        field,
        targetPackage: workspaceSpecifierTarget(name, specifier),
      });
    }
  }
  return [...declared.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The package a `workspace:` specifier resolves to.
 *
 * For the alias form `workspace:<pkg>@<range>` this is `<pkg>`; for every other
 * form it is the dependency key itself. The range suffix is only treated as an
 * alias marker when a non-range name precedes it — `workspace:^1.2.3` and
 * `workspace:*` must fall through to the key.
 */
export function workspaceSpecifierTarget(dependencyName, specifier) {
  const value = specifier.slice('workspace:'.length);
  const at = value.lastIndexOf('@');
  if (at <= 0) {
    return dependencyName;
  }
  const candidate = value.slice(0, at);
  if (candidate.length === 0 || /^[~^]?\d/.test(candidate) || candidate === '*') {
    return dependencyName;
  }
  return candidate;
}

/** True when `<dir>/node_modules/<name>` exists, following symlinks. */
export function linkExists(importerDir, dependencyName) {
  const link = path.join(importerDir, 'node_modules', ...dependencyName.split('/'));
  try {
    fs.lstatSync(link);
    return true;
  } catch {
    return false;
  }
}

/**
 * Expand one `pnpm-workspace.yaml` glob into a RegExp over repo-relative POSIX
 * directories. `*` matches within a path segment only, per pnpm's semantics.
 */
export function workspaceGlobToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Member globs from `pnpm-workspace.yaml`, as RegExps over repo-relative paths.
 * Returns `undefined` when the repository has no workspace manifest.
 *
 * Only the `packages:` section is read: the `catalog:` block is cut off first,
 * and globs pointing outside the repository (`../sibling-repo/...`) are kept —
 * they simply never match a local relative path, which is the correct outcome
 * because a `../` member is always materialized in *its own* repository.
 *
 * A member entry need not contain a slash: `packages: ["sdkwork-modelkit-pc-react"]`
 * is a legal way to declare a single subdirectory as a workspace member. Such an
 * entry has no wildcard and no parent segment, so it must be kept — dropping it
 * would make that directory look non-member and misfile every dependency it
 * declares as `workspace-uncovered` (advice that install can never satisfy).
 */
export function workspaceMemberGlobs(repoRoot) {
  const manifestPath = path.join(repoRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  const text = fs.readFileSync(manifestPath, 'utf8');
  const packagesSection = text.split(/^catalog:/mu)[0];
  return [...packagesSection.matchAll(/^\s*-\s*["']?([^"'\n#]+?)["']?\s*$/gmu)]
    .map((match) => match[1].trim())
    .filter((entry) => isPathLikeEntry(entry))
    .map(workspaceGlobToRegExp);
}

/**
 * Whether a `packages:` entry is a usable member pattern.
 *
 * Rejects the shapes that a `catalog:`-style key/value line would produce if the
 * section split ever misfires (`key: value`) and any entry containing characters
 * that cannot appear in a path. A bare directory name is accepted.
 */
function isPathLikeEntry(entry) {
  if (entry.length === 0) {
    return false;
  }
  if (entry.includes(':')) {
    return false;
  }
  return !/[\s*?[\]{}]/.test(entry.replace(/\*/g, ''));
}

/**
 * Inspect one repository.
 *
 * Returns `installed: false` (and no violations) when the repository has never
 * been installed — missing links are expected there, and reporting them would
 * bury the real findings under the ~85 intentionally-uninstalled repositories.
 */
export function validateRepository(repoRoot) {
  const repoName = path.basename(repoRoot);
  const installed = fs.existsSync(path.join(repoRoot, INSTALL_MARKER));
  if (!installed) {
    return { repoName, repoRoot, installed: false, violations: [] };
  }

  const memberGlobs = workspaceMemberGlobs(repoRoot) ?? [];
  const violations = [];
  for (const { dir, manifest } of collectPackageManifests(repoRoot)) {
    const relativeDir = path.relative(repoRoot, dir).split(path.sep).join('/');
    // The repository root is always an implicit workspace member: pnpm treats
    // the root manifest as a project regardless of the `packages:` globs. A
    // missing link there is therefore install-pending, never uncovered.
    const isMember = relativeDir === '' || memberGlobs.some((glob) => glob.test(relativeDir));
    for (const dependency of declaredWorkspaceDependencies(manifest)) {
      if (linkExists(dir, dependency.name)) {
        continue;
      }
      violations.push({
        repoName,
        packageName: manifest.name,
        packageDir: relativeDir || '.',
        dependency: dependency.name,
        targetPackage: dependency.targetPackage,
        specifier: dependency.specifier,
        field: dependency.field,
        cause: isMember ? CAUSE_INSTALL_PENDING : CAUSE_WORKSPACE_UNCOVERED,
      });
    }
  }

  violations.sort((a, b) => (
    a.packageDir.localeCompare(b.packageDir) || a.dependency.localeCompare(b.dependency)
  ));
  return { repoName, repoRoot, installed: true, violations };
}

/**
 * Index every `@sdkwork/*` package name in a workspace to its directory.
 *
 * Callers use this to tell "the declaration points at a package that exists but
 * is not a workspace member" (add a glob) apart from "the declaration points at
 * nothing at all" (the declaration is wrong).
 */
export function indexWorkspacePackages(workspaceRoot) {
  const index = new Map();
  const repoDirs = fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => path.join(workspaceRoot, entry.name));
  for (const repoRoot of repoDirs) {
    for (const { dir, manifest } of collectPackageManifests(repoRoot)) {
      if (!index.has(manifest.name)) {
        index.set(manifest.name, dir);
      }
    }
  }
  return index;
}
