#!/usr/bin/env node

/**
 * Shared scanning helpers for the env-file naming contract of
 * `ENVIRONMENT_SPEC.md` section 5.1.7.
 *
 * Used by `check-env-file-naming.mjs` (the gate) and
 * `migrate-env-file-naming.mjs` (the workspace migration), so both agree on
 * what counts as a violation and on which trees are in scope.
 *
 * Scope rules:
 * - A directory that holds its own `.git` entry below the scan root is a
 *   separate checkout (submodule or vendored copy) and is skipped: its own
 *   repository owns its gate run.
 * - `.workbuddy`, `.zcode`, `node_modules` and build outputs never hold
 *   authoritative sources.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Deployment profiles of `ENVIRONMENT_SPEC.md` section 5.1. */
export const DEPLOYMENT_PROFILES = new Set(['standalone', 'cloud']);

/** Lifecycle environments of `ENVIRONMENT_SPEC.md` section 5.1; `production` is the online environment. */
export const ENVIRONMENTS = new Set(['development', 'test', 'staging', 'demo', 'production']);

/** Directories that never hold authoritative repository sources. */
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.pnpm',
  'target',
  'dist',
  'lib',
  'build',
  'artifacts',
  'coverage',
  '.cache',
  '.next',
  '.turbo',
  '.workbuddy',
  '.zcode',
  '.venv',
  'venv',
  '.runtime',
  '.storages',
  'tmp',
  'tmp-build',
]);

/** Source extensions whose literals may name a retired env file. */
export const CODE_EXTENSIONS = new Set([
  '.mjs',
  '.cjs',
  '.js',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.rs',
  '.toml',
  '.yml',
  '.yaml',
  '.sh',
  '.ps1',
  '.py',
]);

/** Inline marker that exempts a line from the reference scan. */
export const REFERENCE_ALLOW_MARKER = 'env-naming:allow';

/**
 * File-level marker for a module whose job is to reject retired names. Such a
 * module must name them in its diagnostics, so the whole file is exempt.
 */
export const REFERENCE_ALLOW_FILE_MARKER = 'env-naming:allow-file';

/**
 * One retired reference found in source text.
 * @typedef {{ file: string, line: number, text: string, name: string }} ReferenceHit
 */

/**
 * One env file found on disk.
 * @typedef {{ file: string, base: string, dir: string, absolute: string }} EnvFileHit
 */

/**
 * Is this basename inside the reserved `.env` namespace?
 * @param basename - candidate file name.
 * @returns true for `.env`, `.env.example`, and every `.env.<suffix>`.
 */
export function isEnvFileName(basename) {
  return basename === '.env' || basename === '.env.example' || basename.startsWith('.env.');
}

/**
 * Classify one basename against the canonical env-file shape.
 *
 * The canonical shape is `.env`, `.env.example`, or
 * `.env.<deployment-profile>.<environment>` (optionally with a `.example`
 * template suffix). Everything else is a violation.
 *
 * @param basename - the candidate file name.
 * @returns `undefined` when canonical, otherwise the violation reason.
 */
export function classifyEnvFileName(basename) {
  if (!isEnvFileName(basename)) return undefined;
  if (basename === '.env' || basename === '.env.example') return undefined;

  const segments = basename.slice('.env.'.length).split('.');
  const canonicalParts = segments.at(-1) === 'example' ? segments.slice(0, -1) : segments;
  if (canonicalParts.length === 2) {
    const [profile, environment] = canonicalParts;
    if (DEPLOYMENT_PROFILES.has(profile) && ENVIRONMENTS.has(environment)) {
      return undefined;
    }
  }
  if (canonicalParts.length === 1) {
    const [only] = canonicalParts;
    if (only === 'local') {
      return '`.env.local` is retired: private values live in the credential bundle or the host config file';
    }
    if (ENVIRONMENTS.has(only)) {
      return '`.env.' + only + '` is one-dimensional: name the deployment profile, `.env.<profile>.' + only + '`';
    }
    if (only === 'postgres' || only === 'sqlite') {
      return `\`.env.${only}\` is a host profile, not a Vite env file: use \`config/host/${only}.env\``;
    }
    if (only === 'release') {
      return '`.env.release` is retired: releases use the `production` environment (`--mode <profile>.production`)';
    }
    if (['windows', 'macos', 'linux'].includes(only)) {
      return `\`.env.${only}\` is desktop packaging host config: use \`packaging/${only}.env\``;
    }
  }
  if (segments.some(segment => segment === 'local' || segment === 'bootstrap')) {
    return 'composed private overlay is retired: the token lives in `~/.sdkwork/<application-code>/credentials/<profile-id>.json`';
  }
  return 'not one of `.env`, `.env.example`, `.env.<profile>.<environment>`';
}

/**
 * Is this directory a git checkout root (working tree or submodule)?
 * @param directory - absolute directory.
 * @returns true when a `.git` entry exists.
 */
export function isGitCheckout(directory) {
  try {
    return fs.existsSync(path.join(directory, '.git'));
  } catch {
    return false;
  }
}

/**
 * Enumerate the repositories below one workspace root.
 *
 * @param root - absolute workspace directory.
 * @returns the root itself when it is a checkout, plus every direct child that
 *   is a checkout, sorted by name.
 */
export function discoverRepositories(root) {
  const repositories = [];
  if (isGitCheckout(root)) {
    repositories.push({ name: path.basename(root), root, kind: 'root' });
  }
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return repositories;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (!isGitCheckout(absolute)) continue;
    repositories.push({ name: entry.name, root: absolute, kind: 'child' });
  }
  return repositories;
}

/**
 * Walk one repository, skipping build outputs and nested checkouts.
 * @param repoRoot - absolute repository root.
 * @param visit - callback receiving `(absolute, relative)` for every file.
 */
export function walkRepositoryFiles(repoRoot, visit) {
  const stack = [{ directory: repoRoot, depth: 0 }];
  while (stack.length > 0) {
    const { directory, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        // A nested `.git` marks a submodule or vendored checkout: it owns its
        // own gate run, so the parent never reports on it.
        if (isGitCheckout(absolute)) continue;
        stack.push({ directory: absolute, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
      visit(absolute, relative);
    }
  }
}

/**
 * Collect env files and retired references under one repository root.
 *
 * @param repoRoot - absolute repository root.
 * @param options - `references` enables the source-literal scan.
 * @returns env files seen, violations, and reference hits (all repo-relative).
 */
export function scanRepository(repoRoot, options = {}) {
  const { references = true } = options;
  const envFiles = [];
  const violations = [];
  const referenceHits = [];
  walkRepositoryFiles(repoRoot, (absolute, relative) => {
    const base = path.basename(absolute);
    if (isEnvFileName(base)) {
      if (base.endsWith('.tsbuildinfo')) return;
      envFiles.push(relative);
      const reason = classifyEnvFileName(base);
      if (reason !== undefined) violations.push({ kind: 'file', file: relative, detail: reason });
      return;
    }
    if (!references) return;
    if (!CODE_EXTENSIONS.has(path.extname(base))) return;
    let text;
    try {
      text = fs.readFileSync(absolute, 'utf8');
    } catch {
      return;
    }
    if (!text.includes('.env')) return;
    if (text.includes(REFERENCE_ALLOW_FILE_MARKER)) return;
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      // A reader that rejects a retired name must name it in its diagnostic,
      // which is legitimate source text. Accept the marker on the same line or
      // on the line immediately above the literal.
      if (line.includes(REFERENCE_ALLOW_MARKER)) continue;
      if ((lines[index - 1] ?? '').includes(REFERENCE_ALLOW_MARKER)) continue;
      // A file reference starts a token. `object.env.NAME` is a property
      // chain, not an env file, so `]`, `)` and identifier characters before
      // `.env.` disqualify the match.
      const match = /(?:^|[\s'"`(<[{,=:/])(\.env\.[A-Za-z0-9_.-]+)/u.exec(line);
      if (match === null) continue;
      const name = (match[1] ?? '').replace(/[`'")\]]+$/u, '');
      if (name === '.env.example' || name === '.env') continue;
      // A template literal such as `.env.standalone.${environment}` is a
      // canonical name assembled at run time, not a retired spelling.
      if (name.endsWith('.')) continue;
      if (classifyEnvFileName(name) === undefined) continue;
      referenceHits.push({ file: relative, line: index + 1, name, text: line.trim().slice(0, 160) });
    }
  });
  return { envFiles: envFiles.sort(), violations, references: referenceHits };
}
