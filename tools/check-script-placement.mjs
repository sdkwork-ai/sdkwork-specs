#!/usr/bin/env node

/**
 * Enforce the SDKWORK script placement contract (MODULE_BIN_SPEC.md §2.1).
 *
 * ONE rule, no exception table:
 *
 *   Every authored script lives under a `bin/` directory.
 *
 * Anything that must exist *inside* an artifact — a container image, an
 * install bundle, an OS package — is produced by the build copying it out of
 * `bin/`, so the artifact copy is a build output rather than a second source.
 * Generated tool output (node_modules, Flutter/IDE generators, SDK generator
 * output) and build state (dist, build contexts, caches) are not sources and
 * are not audited.
 *
 * Scratch workspaces are tolerated only while git ignores them: a scratch
 * script showing up as `??` in `git status` is one `git add .` away from being
 * committed — that is how ~250 ad-hoc scripts accumulated in sdkwork-webserver.
 * Nothing under a scratch directory may be referenced by documentation,
 * runbooks, package.json, or CI.
 *
 * Usage:
 *   node tools/check-script-placement.mjs --root <dir> [--root <dir2> …]
 *                                        [--workspace <dir>] [--json]
 *                                        [--include-scratch-list]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { listWorkspaceRepositoryRoots } from './lib/workspace-check-runner.mjs';

/** Build state and generated tool output: not authored sources. */
const DEFAULT_EXCLUDES = Object.freeze([
  'node_modules', 'external', 'vendor', 'target',
  'dist', 'build', 'out', 'bak', 'coverage', '.next',
  'snapshots', '.git',
]);

/** Directory-name prefixes that are always generated state. */
const GENERATED_DIR_PREFIXES = Object.freeze(['node_modules.']);

/** Generated files that tools emit into the source tree. */
const GENERATED_FILE_PATTERNS = Object.freeze([
  /(^|\/)ios\/Flutter\/flutter_export_environment\.sh$/,
  /(^|\/)macos\/Flutter\/ephemeral\//,
  /(^|\/)\.dart_tool\//,
  /(^|\/)node_modules\./,
]);

/** Scratch workspaces: allowed to hold scripts only while git ignores them. */
const SCRATCH_DIRS = Object.freeze([
  '.workbuddy', '.sdkwork', '.tmp', 'tmp', '.wsl-tmp', '.cache',
]);
const SCRATCH_DIR_PATTERNS = Object.freeze([
  /^\.tmp[-_].*/,
]);

const SCRIPT_SUFFIXES = Object.freeze([
  '.sh', '.bash', '.zsh', '.ksh', '.ps1',
]);

function isScript(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.spec.template')) return false;
  if (lower.endsWith('.sh.template')) return true;
  return SCRIPT_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * Extension-less scripts. `MODULE_BIN_SPEC.md` §2.1 names the container
 * `ENTRYPOINT` as a `bin/container/` resident, and both the Docker ecosystem
 * (`entrypoint`, `docker-entrypoint`, `*-entrypoint`) and this fleet ship them
 * without a suffix — a suffix-only test cannot see them, which is how an
 * authored entrypoint sat at a repository root outside `bin/`. A file whose
 * name carries no dot and whose first two bytes are `#!` is an authored script
 * (a LICENSE/VERSION/CHANGELOG has no shebang, so it is not).
 */
function hasShebang(absPath) {
  let handle;
  try {
    handle = fs.openSync(absPath, 'r');
    const buffer = Buffer.alloc(2);
    const read = fs.readSync(handle, buffer, 0, 2, 0);
    return read === 2 && buffer[0] === 0x23 && buffer[1] === 0x21;
  } catch {
    return false;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

/**
 * Generated build-tool wrappers. `gradlew` / `mvnw` are emitted verbatim by
 * their build tool and re-emitted on upgrade, so they are tool output rather
 * than authored module scripts — the same category the generated-file patterns
 * above already exempt. Naming them here keeps the shebang rule (which is what
 * catches an un-suffixed authored `entrypoint`) free of those false positives.
 */
const TOOL_WRAPPER_NAMES = Object.freeze(['gradlew', 'mvnw']);

function isScriptFile(name, absPath) {
  if (isScript(name)) return true;
  if (name.includes('.')) return false;
  if (TOOL_WRAPPER_NAMES.includes(name)) return false;
  return hasShebang(absPath);
}

function isScratchDir(name) {
  return SCRATCH_DIRS.includes(name) || SCRATCH_DIR_PATTERNS.some((re) => re.test(name));
}

function isGenerated(relPath) {
  return GENERATED_FILE_PATTERNS.some((re) => re.test(relPath));
}

/** The single rule: the script must sit under a `bin/` directory. */
function isSanctioned(relPath) {
  return relPath.startsWith('bin/') || relPath.includes('/bin/');
}

/**
 * Single walk. Scripts found outside any scratch directory are placement
 * candidates (`out`); scripts found inside a scratch directory — at any depth,
 * not just at the root — are collected separately (`scratchOut`) because only
 * the git-ignore contract applies to them.
 *
 * Auditing nested scratch is deliberate: a scratch dir that is not git-ignored
 * is exactly the leak this gate exists to catch, and a root-only scan would
 * silently miss `apps/<app>/.sdkwork/*.sh`.
 */
function walk(dir, rel, excludes, out, scratchOut, inScratch = false, ignoredDirs = null, ignoredFiles = null) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (excludes.includes(entry.name)) continue;
      if (GENERATED_DIR_PREFIXES.some((p) => entry.name.startsWith(p))) continue;
      const childScratch = inScratch || isScratchDir(entry.name);
      // A git-ignored tree is build state or an extracted runtime, never an
      // authored source. Scratch directories are exempt from this skip so the
      // git-ignore contract itself stays auditable.
      if (!childScratch && ignoredDirs && isUnderIgnoredDir(childRel, ignoredDirs)) continue;
      walk(abs, childRel, excludes, out, scratchOut, childScratch, ignoredDirs, ignoredFiles);
    } else if (entry.isFile() && isScriptFile(entry.name, abs)) {
      if (inScratch) scratchOut.push(childRel);
      // A git-ignored file is build state or generated tool output, which the
      // contract does not audit (`MODULE_BIN_SPEC.md` §2.1). Scratch is checked
      // first so the git-ignore contract on scratch dirs stays auditable.
      else if (ignoredFiles && ignoredFiles.has(childRel)) continue;
      else out.push(childRel);
    }
  }
}

/**
 * Everything git reports as ignored, in one call per repository: directories
 * (reported with a trailing slash because of `--directory`) and loose files.
 * Used to prune build products and extracted runtimes — e.g. a downloaded Node
 * toolchain under an application's `.desktop-build` directory — from the main
 * walk, so the fleet migration never tries to "fix" an artifact.
 */
function listIgnoredPaths(root) {
  const dirs = new Set();
  const files = new Set();
  try {
    const out = execFileSync(
      'git',
      ['-C', root, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
    );
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const isDir = line.endsWith('/');
      const rel = line.trim().replace(/\/+$/, '').split(path.sep).join('/');
      if (!rel) continue;
      if (isDir) dirs.add(rel);
      else files.add(rel);
    }
  } catch {
    // Not a repository, or git unavailable: no pruning, the walk still runs.
  }
  return { dirs, files };
}

function isUnderIgnoredDir(relDir, ignoredDirs) {
  if (ignoredDirs.has(relDir)) return true;
  let cursor = relDir;
  while (cursor.includes('/')) {
    cursor = cursor.slice(0, cursor.lastIndexOf('/'));
    if (ignoredDirs.has(cursor)) return true;
  }
  return false;
}

function gitIgnored(root, relPath) {
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '-q', relPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isGitRepo(root) {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Audit one module root. */
export function auditRoot(root, options = {}) {
  const excludes = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])];
  const module = path.basename(path.resolve(root));
  const violations = [];
  const scratchScripts = [];
  const generated = [];
  let scripts = 0;

  const fail = (reason, detail) => ({
    root: module,
    path: root,
    reason,
    detail,
  });

  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    return {
      root,
      module,
      scripts: 0,
      generated,
      scratchScripts,
      violations: [fail('UNREADABLE-ROOT', 'root does not exist or cannot be read (SILENT PASS REFUSED)')],
    };
  }
  if (!stat.isDirectory()) {
    return {
      root,
      module,
      scripts: 0,
      generated,
      scratchScripts,
      violations: [fail('UNREADABLE-ROOT', 'root is not a directory (SILENT PASS REFUSED)')],
    };
  }

  const gitRepo = isGitRepo(root);
  const ignored = gitRepo ? listIgnoredPaths(root) : null;
  const moduleFiles = [];
  walk(root, '', excludes, moduleFiles, scratchScripts, false, ignored?.dirs ?? null, ignored?.files ?? null);

  for (const rel of moduleFiles) {
    const n = rel.split(path.sep).join('/');
    if (isGenerated(n)) {
      generated.push(n);
      continue;
    }
    scripts += 1;
    if (!isSanctioned(n)) {
      violations.push({
        root: module,
        path: n,
        reason: 'PLACEMENT',
        detail: 'authored script outside bin/ — move the source under bin/ and let the build copy it into the artifact, or delete it',
      });
    }
  }

  // Scratch: only the git-ignore contract is enforced.
  for (const rel of scratchScripts) {
    const n = rel.split(path.sep).join('/');
    scripts += 1;
    if (gitRepo && !gitIgnored(root, n)) {
      violations.push({
        root: module,
        path: n,
        reason: 'SCRATCH-NOT-IGNORED',
        detail: "scratch script is not git-ignored; it would be committed by 'git add .'",
      });
    }
  }

  return { root, module, scripts, generated, scratchScripts, violations };
}

/**
 * Fleet enumeration is AGENTS-keyed, not manifest-keyed.
 *
 * The authoritative governed-repository predicate is
 * `listWorkspaceRepositoryRoots()`: a directory named `sdkwork-*` that carries a
 * root `AGENTS.md`. `sdkwork.app.config.json` declares *product identity*, not
 * governance — 21 governed repositories (catalog, core, database, id, log,
 * specs, ui, utils, …) ship no manifest and were therefore invisible to every
 * manifest-keyed gate. Manifest-only enumeration silently under-reports the
 * fleet; a governed repo without a manifest is still audited here.
 */
function findModules(workspace) {
  const modules = [];
  const offFleet = [];
  const governed = new Set(
    listWorkspaceRepositoryRoots(workspace).map((repoRoot) => path.basename(repoRoot)),
  );
  for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (DEFAULT_EXCLUDES.includes(entry.name)) continue;
    const dir = path.join(workspace, entry.name);
    const hasManifest = fs.existsSync(path.join(dir, 'sdkwork.app.config.json'));
    if (entry.name.startsWith('sdkwork-')) {
      if (governed.has(entry.name) || hasManifest) modules.push(dir);
      continue;
    }
    // Off-fleet product repositories (a manifest but no governed prefix) are
    // listed, never audited.
    if (hasManifest) offFleet.push(entry.name);
  }
  return { modules: modules.sort(), offFleet: offFleet.sort() };
}

export function formatText(report) {
  const lines = [];
  lines.push('SDKWORK script placement (MODULE_BIN_SPEC.md §2.1)');
  lines.push('  rule: every authored script lives under bin/');
  lines.push(`  roots audited:   ${report.roots.length}`);
  lines.push(`  scripts audited: ${report.scripts}`);
  lines.push(`  violations:      ${report.violations.length}`);
  if (report.roots.length > 1) {
    lines.push(`  modules aligned: ${report.modules}/${report.fleetTotal}`);
  }

  // Group by owning module so a workspace-wide run is actionable: the same
  // relative path can appear in several modules.
  const byModule = new Map();
  for (const v of report.violations) {
    const key = v.root ?? '<root>';
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(v);
  }
  for (const [module, list] of [...byModule.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`  ${module} (${list.length})`);
    for (const v of list) lines.push(`    - ${v.reason} ${v.path}`);
  }

  if (report.offFleet.length) {
    lines.push(`  not governed (manifest but no sdkwork- prefix, listed only): ${report.offFleet.join(', ')}`);
  }
  return lines.join('\n');
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', multiple: true, default: [] },
      workspace: { type: 'string' },
      json: { type: 'boolean', default: false },
      exclude: { type: 'string', default: '' },
      'include-scratch-list': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (!values.root.length && !values.workspace) {
    console.log('Usage: node tools/check-script-placement.mjs --root <dir> [--root <dir2> …] [--workspace <dir>] [--json]');
    process.exit(2);
  }

  const roots = [...values.root];
  let offFleet = [];
  let fleetTotal = 0;
  if (values.workspace) {
    const found = findModules(path.resolve(values.workspace));
    roots.push(...found.modules);
    offFleet = found.offFleet;
    fleetTotal = found.modules.length;
  }

  const exclude = values.exclude.split(',').map((s) => s.trim()).filter(Boolean);
  const results = roots.map((root) => auditRoot(path.resolve(root), { exclude }));
  const violations = results.flatMap((r) => r.violations);

  const report = {
    roots: results.map((r) => r.root),
    modules: results.filter((r) => r.violations.length === 0).length,
    fleetTotal: fleetTotal || results.length,
    scripts: results.reduce((sum, r) => sum + r.scripts, 0),
    generated: results.reduce((sum, r) => sum + r.generated.length, 0),
    violations,
    offFleet,
    scratch: values['include-scratch-list'] ? results.flatMap((r) => r.scratchScripts) : undefined,
  };

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatText(report));
    if (values['include-scratch-list'] && report.scratch) {
      console.log(`  scratch scripts (${report.scratch.length}, git-ignored only):`);
      for (const s of report.scratch.slice(0, 40)) console.log(`    ${s}`);
      if (report.scratch.length > 40) console.log(`    … ${report.scratch.length - 40} more`);
    }
  }
  process.exit(violations.length ? 1 : 0);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'check-script-placement.mjs') {
  main();
}
