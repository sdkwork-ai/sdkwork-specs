import fs from 'node:fs';
import path from 'node:path';

import {
  KNOWN_SIBLING_REPO_ALIASES,
  parseWorkspacePackageLine,
} from './workspace-federation-path-patterns.mjs';

/**
 * Mandatory TypeScript strictness floor for every repository that participates in cross-repository
 * source federation (see TYPESCRIPT_CODE_SPEC.md §13).
 *
 * `verbatimModuleSyntax`, `isolatedModules`, and `skipLibCheck` are deliberately excluded: they are
 * emit/style decisions that repositories may legitimately differ on, and forcing them would couple
 * federation to unrelated formatting churn.
 */
export const STRICTNESS_FLOOR = Object.freeze([
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noUnusedLocals',
  'noUnusedParameters',
  'noImplicitOverride',
  'noFallthroughCasesInSwitch',
]);

/**
 * Tracked location: the list is part of the repository contract, so it must not live in a
 * gitignored state directory such as `.sdkwork/`.
 */
export const DEFAULT_MIGRATION_LIST_RELATIVE_PATH = 'specs/typescript-federation-migration.json';

/**
 * Repository-root trees that hold read-only upstream source (AGENTS_SPEC: "external/, third_party/,
 * vendor/: optional read-only upstream source dependencies; ... agents and SDKWork tooling must
 * never modify their contents").
 *
 * The strictness floor is a contract between SDKWork-authored repositories, so it cannot be
 * enforced inside an upstream boundary: those defects belong to the upstream revision, and the only
 * legal remedy is a vendored-sync, not a local patch. Counting them as `own` debt would pressure a
 * maintainer into editing files the specification forbids editing.
 *
 * Matching is limited to the first path segment on purpose. A nested `packages/<pkg>/vendor/`
 * directory is SDKWork-authored code and must stay inside the contract.
 */
export const UPSTREAM_BOUNDARY_DIRECTORIES = Object.freeze(['vendor', 'third_party', 'external']);

/** True when a repository-relative path lives inside a root-level upstream boundary tree. */
export function isUpstreamBoundaryPath(relativePath) {
  const [firstSegment] = String(relativePath).replace(/\\/g, '/').split('/');
  return UPSTREAM_BOUNDARY_DIRECTORIES.includes(firstSegment);
}

/**
 * `tsconfig.base*.json` files are shared fragments: they exist to be extended by leaf configs and
 * are never compiled on their own. Pointing tsc at one makes it resolve that config's `paths`
 * entries as program inputs and emit spurious TS2877 ("will not be rewritten during emit"), so a
 * fragment is not a program and must not be typechecked as one.
 */
export const BASE_FRAGMENT_TSCONFIG_PATTERN = /^tsconfig\.base(?:\..+)?\.json$/u;

export function isBaseFragmentTsconfig(filePath) {
  return BASE_FRAGMENT_TSCONFIG_PATTERN.test(path.basename(String(filePath)));
}

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.runtime',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'target',
]);

const TSCONFIG_FILE_PATTERN = /^tsconfig.*\.json$/u;
const MAX_TSCONFIG_DEPTH = 5;
const SIBLING_ENTRY_PATTERN = /^\.\.\/(?!\.)([^/]+)\/(.+)$/u;
const REPO_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const FILE_LIKE_SUFFIX = /\.(?:tsx?|ts|mts|cts|d\.ts|jsx?)$/u;

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(targetPath) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Removes `//` and `/* *\/` comments while preserving string literals, so `tsconfig` JSONC files
 * that ship with explanatory comments stay parseable.
 */
export function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let quote = '';
  let inLineComment = false;
  let inBlockComment = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        out += char;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 2;
        continue;
      }
      if (char === '\n') {
        out += char;
      }
      index += 1;
      continue;
    }

    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === quote) {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      out += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 2;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** Removes trailing commas before `}` / `]` while preserving string literals. */
export function stripTrailingCommas(text) {
  let out = '';
  let inString = false;
  let quote = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      out += char;
      if (char === '\\') {
        out += text[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      out += char;
      continue;
    }

    if (char === ',') {
      let cursor = index + 1;
      while (cursor < text.length && /\s/u.test(text[cursor])) {
        cursor += 1;
      }
      if (text[cursor] === '}' || text[cursor] === ']') {
        continue;
      }
    }

    out += char;
  }

  return out;
}

/** Parses a JSONC document (comments and trailing commas allowed). Returns `null` on failure. */
export function parseJsonc(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(stripTrailingCommas(stripJsonComments(text).replace(/^﻿/u, '')));
  } catch {
    return null;
  }
}

export function readJsoncFile(filePath) {
  const parsed = parseJsonc(readText(filePath));
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function resolveExtendsTarget(baseDir, spec) {
  if (typeof spec !== 'string' || spec.trim() === '') {
    return null;
  }

  const normalized = spec.replace(/\\/g, '/');
  const candidates = [];

  if (normalized.startsWith('.')) {
    candidates.push(normalized);
    if (!normalized.endsWith('.json')) {
      candidates.push(`${normalized}.json`);
      candidates.push(`${normalized}/tsconfig.json`);
    }
  } else {
    candidates.push(`node_modules/${normalized}`);
    candidates.push(`node_modules/${normalized}/tsconfig.json`);
    if (!normalized.endsWith('.json')) {
      candidates.push(`node_modules/${normalized}.json`);
    }
  }

  for (const candidate of candidates) {
    const absolute = path.resolve(baseDir, candidate);
    if (isFile(absolute)) {
      return absolute;
    }
  }

  if (normalized.startsWith('.')) {
    return null;
  }

  let dir = baseDir;
  while (true) {
    const base = path.join(dir, 'node_modules', normalized);
    for (const candidate of [base, `${base}.json`, path.join(base, 'tsconfig.json')]) {
      if (isFile(candidate)) {
        return candidate;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function collectExtendsChain(tsconfigPath, seen = new Set(), out = []) {
  const absolute = path.resolve(tsconfigPath);
  if (seen.has(absolute)) {
    return out;
  }
  seen.add(absolute);

  const json = readJsoncFile(absolute);
  if (!json) {
    return out;
  }

  const specs = Array.isArray(json.extends)
    ? json.extends
    : typeof json.extends === 'string'
      ? [json.extends]
      : [];

  for (const spec of specs) {
    const target = resolveExtendsTarget(path.dirname(absolute), spec);
    if (target) {
      collectExtendsChain(target, seen, out);
    }
  }

  out.push({ path: absolute, json });
  return out;
}

/**
 * Resolves a `tsconfig` file to its effective `compilerOptions`, following the `extends` chain so a
 * leaf project that inherits strictness from a shared base is judged on what it actually compiles
 * with, not on what it declares locally.
 */
export function readEffectiveCompilerOptions(tsconfigPath) {
  const chain = collectExtendsChain(tsconfigPath);
  if (chain.length === 0) {
    return { chain: [], compilerOptions: {} };
  }

  let compilerOptions = {};
  for (const entry of chain) {
    const own = entry.json.compilerOptions;
    if (own && typeof own === 'object') {
      compilerOptions = { ...compilerOptions, ...own };
    }
  }

  return { chain: chain.map((entry) => entry.path), compilerOptions };
}

/** Flags that are not explicitly `true` in the given `compilerOptions`. */
export function missingStrictnessFlags(compilerOptions, required = STRICTNESS_FLOOR) {
  return required.filter((flag) => compilerOptions?.[flag] !== true);
}

/** Flags that are explicitly turned off — an active relaxation, not an omission. */
export function relaxedStrictnessFlags(compilerOptions, required = STRICTNESS_FLOOR) {
  return required.filter((flag) => compilerOptions?.[flag] === false);
}

function normalizeSiblingRepoName(repoName) {
  return KNOWN_SIBLING_REPO_ALIASES[repoName] ?? repoName;
}

function siblingRepoNameFromEntry(entry) {
  const normalized = entry.replace(/\\/g, '/');
  const match = normalized.match(SIBLING_ENTRY_PATTERN);
  if (!match || !REPO_NAME_PATTERN.test(match[1])) {
    return null;
  }
  return normalizeSiblingRepoName(match[1]);
}

function directoryForEntry(contextDir, entry) {
  const absolute = path.resolve(contextDir, entry.replace(/\\/g, '/'));
  return FILE_LIKE_SUFFIX.test(entry.replace(/\\/g, '/')) ? path.dirname(absolute) : absolute;
}

/**
 * Collects the concrete directories the consumer is coupled to, from both federation surfaces:
 * `pnpm-workspace.yaml` package entries and `tsconfig` `compilerOptions.paths` mappings.
 *
 * Federation is defined as exactly one directory level up (`../<repo>/...`); deeper escapes such as
 * `../../` are not sibling repositories and are ignored.
 */
export function collectFederatedTargets(repoRoot) {
  const targets = [];

  const record = (entry, contextDir, source) => {
    const repoName = siblingRepoNameFromEntry(entry);
    if (!repoName || repoName === path.basename(repoRoot)) {
      return;
    }
    const supplierRoot = path.resolve(repoRoot, '..', repoName);
    if (!isDirectory(supplierRoot)) {
      return;
    }
    const globIndex = entry.replace(/\\/g, '/').indexOf('*');
    const baseEntry = globIndex >= 0 ? entry.slice(0, globIndex) : entry;
    const absolute = directoryForEntry(contextDir, baseEntry);
    if (absolute !== supplierRoot && !absolute.startsWith(`${supplierRoot}${path.sep}`)) {
      return;
    }
    targets.push({ repoName, supplierRoot, entry, absolute, source });
  };

  const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
  for (const line of readText(workspacePath).split(/\r?\n/u)) {
    const parsed = parseWorkspacePackageLine(line);
    if (parsed) {
      record(parsed.entry, repoRoot, 'pnpm-workspace.yaml');
    }
  }

  for (const tsconfigPath of listTsconfigFiles(repoRoot)) {
    const json = readJsoncFile(tsconfigPath);
    const paths = json?.compilerOptions?.paths;
    if (!paths || typeof paths !== 'object') {
      continue;
    }
    const baseUrl = json?.compilerOptions?.baseUrl;
    const contextDir = typeof baseUrl === 'string' && baseUrl.trim() !== ''
      ? path.resolve(path.dirname(tsconfigPath), baseUrl.replace(/\\/g, '/'))
      : path.dirname(tsconfigPath);
    const relative = path.relative(repoRoot, tsconfigPath).replace(/\\/g, '/');

    for (const entries of Object.values(paths)) {
      if (!Array.isArray(entries)) {
        continue;
      }
      for (const entry of entries) {
        if (typeof entry === 'string') {
          record(entry, contextDir, relative);
        }
      }
    }
  }

  return targets;
}

/**
 * Finds the tsconfig that actually governs a federated directory: the nearest enclosing one, so the
 * gate judges the project the consumer really compiles instead of every config in the tree.
 */
export function findGoverningTsconfig(targetDir, supplierRoot) {
  return findEnclosing(targetDir, supplierRoot, 'tsconfig.json')
    ?? findEnclosing(targetDir, supplierRoot, 'tsconfig.base.json');
}

function findEnclosing(targetDir, supplierRoot, fileName) {
  let current = path.resolve(targetDir);
  const floor = path.resolve(supplierRoot);
  while (true) {
    const absolute = path.join(current, fileName);
    if (isFile(absolute) && readJsoncFile(absolute)) {
      return absolute;
    }
    if (current === floor) {
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/** Groups federated targets by supplier repository, resolving the tsconfig each one compiles under. */
export function listFederatedSupplierRepos(repoRoot) {
  const byName = new Map();

  for (const target of collectFederatedTargets(repoRoot)) {
    let supplier = byName.get(target.repoName);
    if (!supplier) {
      supplier = { name: target.repoName, root: target.supplierRoot, sources: [], targets: [] };
      byName.set(target.repoName, supplier);
    }
    if (!supplier.sources.includes(target.source)) {
      supplier.sources.push(target.source);
    }
    const governing = findGoverningTsconfig(target.absolute, target.supplierRoot);
    if (governing && !supplier.targets.some((item) => item.tsconfig === governing)) {
      supplier.targets.push({
        tsconfig: governing,
        entry: target.entry,
        source: target.source,
      });
    }
  }

  return [...byName.values()]
    .map((supplier) => ({
      ...supplier,
      sources: supplier.sources.sort(),
      targets: supplier.targets.sort((left, right) => left.tsconfig.localeCompare(right.tsconfig)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Enumerates `tsconfig` files that actually define a compilation program. */
export function listTsconfigFiles(repoRoot, maxDepth = MAX_TSCONFIG_DEPTH) {
  const results = [];

  function walk(currentDir, depth) {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || !TSCONFIG_FILE_PATTERN.test(entry.name)) {
        continue;
      }

      const json = readJsoncFile(absolute);
      if (!json) {
        continue;
      }
      const declaresProgram = Boolean(json.include || json.files)
        || Boolean(json.compilerOptions && Object.keys(json.compilerOptions).length > 0);
      const isSolutionOnly = Array.isArray(json.references) && !declaresProgram;
      if (isSolutionOnly) {
        continue;
      }
      results.push(absolute);
    }
  }

  walk(repoRoot, 0);
  return results.sort();
}

function readPackageJson(repoRoot) {
  const parsed = readJsoncFile(path.join(repoRoot, 'package.json'));
  return parsed ?? {};
}

/** Locates the consumer's authoritative root `tsconfig`, preferring the shared base. */
export function resolveConsumerTsconfig(repoRoot) {
  for (const candidate of ['tsconfig.base.json', 'tsconfig.json']) {
    const absolute = path.join(repoRoot, candidate);
    if (isFile(absolute) && readJsoncFile(absolute)) {
      return absolute;
    }
  }
  return null;
}

export function readMigrationList(filePath) {
  if (!filePath || !isFile(filePath)) {
    return { path: filePath, entries: [] };
  }
  const parsed = readJsoncFile(filePath);
  const raw = Array.isArray(parsed?.repos)
    ? parsed.repos
    : Array.isArray(parsed)
      ? parsed
      : [];

  const entries = raw
    .filter((entry) => entry && typeof entry.repo === 'string')
    .map((entry) => ({
      repo: entry.repo,
      reason: typeof entry.reason === 'string' ? entry.reason : '',
      owner: typeof entry.owner === 'string' ? entry.owner : '',
      expires: typeof entry.expires === 'string' ? entry.expires : null,
    }));

  return { path: filePath, entries };
}

function isExpired(entry, today) {
  if (!entry.expires) {
    return false;
  }
  const expiresAt = Date.parse(`${entry.expires}T00:00:00Z`);
  if (Number.isNaN(expiresAt)) {
    return false;
  }
  return Date.parse(`${today}T00:00:00Z`) > expiresAt;
}

function toIsoDate(date) {
  return date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
}

/**
 * Static gate for the cross-repository source federation strictness contract.
 *
 * The consumer's own strictness is the baseline: every federated supplier must declare a superset of
 * it and expose a `typecheck` script, because the consumer's `tsc` compiles supplier `src/` files
 * with the consumer's flags.
 */
export function scanTypeScriptFederationStrictness(repoRoot, options = {}) {
  const migrationListPath = options.migrationList
    ?? path.join(repoRoot, DEFAULT_MIGRATION_LIST_RELATIVE_PATH);
  const today = toIsoDate(options.today ?? new Date());
  const issues = [];

  const consumerTsconfig = resolveConsumerTsconfig(repoRoot);
  const consumer = {
    tsconfigPath: consumerTsconfig,
    relativePath: consumerTsconfig
      ? path.relative(repoRoot, consumerTsconfig).replace(/\\/g, '/')
      : null,
    flags: {},
    belowFloor: [],
    relaxed: [],
    baseline: [...STRICTNESS_FLOOR],
  };

  if (consumerTsconfig) {
    const { compilerOptions } = readEffectiveCompilerOptions(consumerTsconfig);
    consumer.flags = Object.fromEntries(STRICTNESS_FLOOR.map((flag) => [flag, compilerOptions[flag]]));
    consumer.belowFloor = missingStrictnessFlags(compilerOptions, STRICTNESS_FLOOR);
    consumer.relaxed = relaxedStrictnessFlags(compilerOptions, STRICTNESS_FLOOR);
    consumer.baseline = STRICTNESS_FLOOR.filter((flag) => compilerOptions[flag] === true);

    for (const flag of consumer.belowFloor) {
      issues.push({
        kind: consumer.relaxed.includes(flag)
          ? 'consumer-strictness-relaxed'
          : 'consumer-strictness-below-floor',
        severity: 'error',
        repo: path.basename(repoRoot),
        path: consumer.relativePath,
        entry: flag,
        detail: consumer.relaxed.includes(flag)
          ? `consumer sets "${flag}": false; a federated consumer MUST NOT relax the strictness floor to accommodate a supplier`
          : `consumer tsconfig does not enable "${flag}"; the strictness floor requires it`,
      });
    }
  } else {
    issues.push({
      kind: 'consumer-baseline-fallback',
      severity: 'warning',
      repo: path.basename(repoRoot),
      path: 'tsconfig.base.json',
      entry: STRICTNESS_FLOOR.join(','),
      detail: 'no root tsconfig found; falling back to the strictness floor as the federation baseline',
    });
  }

  const baseline = consumer.baseline.length > 0 ? consumer.baseline : [...STRICTNESS_FLOOR];
  const migration = readMigrationList(migrationListPath);
  const migrationByName = new Map(migration.entries.map((entry) => [entry.repo, entry]));

  const suppliers = [];
  for (const supplier of listFederatedSupplierRepos(repoRoot)) {
    const governed = supplier.targets.map((target) => target.tsconfig);
    const fallback = governed.length === 0 ? listTsconfigFiles(supplier.root) : [];
    const tsconfigs = [...new Set([...governed, ...fallback])].map((tsconfigPath) => {
      const { compilerOptions } = readEffectiveCompilerOptions(tsconfigPath);
      return {
        path: path.relative(supplier.root, tsconfigPath).replace(/\\/g, '/'),
        missing: missingStrictnessFlags(compilerOptions, baseline),
      };
    });

    const manifest = readPackageJson(supplier.root);
    const scripts = manifest.scripts ?? {};
    const hasTypecheck = typeof scripts.typecheck === 'string' && scripts.typecheck.trim() !== '';

    const supplierIssues = [];
    for (const tsconfig of tsconfigs) {
      if (tsconfig.missing.length > 0) {
        supplierIssues.push({
          kind: 'supplier-strictness-missing',
          severity: 'error',
          repo: supplier.name,
          path: tsconfig.path,
          entry: tsconfig.missing.join(','),
          detail: `federated supplier tsconfig does not declare ${tsconfig.missing.join(', ')}; `
            + 'the consumer compiles this source with those flags enabled',
        });
      }
    }

    if (tsconfigs.length === 0) {
      supplierIssues.push({
        kind: 'supplier-tsconfig-missing',
        severity: 'error',
        repo: supplier.name,
        path: 'tsconfig.json',
        entry: supplier.name,
        detail: 'no tsconfig governs the federated directories of this supplier; '
          + 'its strictness cannot be verified',
      });
    }

    if (!hasTypecheck) {
      supplierIssues.push({
        kind: 'supplier-typecheck-script-missing',
        severity: 'error',
        repo: supplier.name,
        path: 'package.json',
        entry: 'typecheck',
        detail: 'federated supplier has no "typecheck" script, so it cannot self-detect strictness drift',
      });
    }

    const entry = migrationByName.get(supplier.name);
    const nonCompliant = supplierIssues.length > 0;
    if (nonCompliant && entry) {
      for (const issue of supplierIssues) {
        issues.push({
          ...issue,
          severity: 'warning',
          kind: 'migrating-supplier',
          detail: `${issue.detail} (migration list entry: ${entry.reason || 'no reason recorded'})`,
        });
      }
    } else if (nonCompliant) {
      issues.push(...supplierIssues);
    }

    suppliers.push({
      name: supplier.name,
      root: supplier.root,
      sources: supplier.sources,
      targets: supplier.targets,
      tsconfigs,
      hasTypecheck,
      compliant: !nonCompliant,
      migrating: Boolean(nonCompliant && entry),
    });
  }

  const federatedNames = new Set(suppliers.map((supplier) => supplier.name));
  const stale = [];
  const expired = [];
  for (const entry of migration.entries) {
    if (!federatedNames.has(entry.repo)) {
      stale.push(entry.repo);
      issues.push({
        kind: 'stale-migration-entry',
        severity: 'error',
        repo: entry.repo,
        path: path.relative(repoRoot, migrationListPath).replace(/\\/g, '/'),
        entry: entry.repo,
        detail: 'migration list references a repository that is not federated by this consumer',
      });
      continue;
    }
    const supplier = suppliers.find((candidate) => candidate.name === entry.repo);
    if (supplier?.compliant) {
      stale.push(entry.repo);
      issues.push({
        kind: 'stale-migration-entry',
        severity: 'error',
        repo: entry.repo,
        path: path.relative(repoRoot, migrationListPath).replace(/\\/g, '/'),
        entry: entry.repo,
        detail: 'migration list entry is obsolete: the supplier is compliant and must be removed',
      });
      continue;
    }
    if (isExpired(entry, today)) {
      expired.push(entry.repo);
      issues.push({
        kind: 'expired-migration-entry',
        severity: 'error',
        repo: entry.repo,
        path: path.relative(repoRoot, migrationListPath).replace(/\\/g, '/'),
        entry: entry.expires,
        detail: `migration grace period expired on ${entry.expires}; the supplier must comply now`,
      });
    }
  }

  return {
    repoRoot,
    today,
    baseline,
    consumer,
    suppliers,
    migration: { ...migration, stale, expired },
    issues,
    failures: issues.filter((issue) => issue.severity === 'error'),
    warnings: issues.filter((issue) => issue.severity === 'warning'),
  };
}
