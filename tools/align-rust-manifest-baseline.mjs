#!/usr/bin/env node
/**
 * Aligns SDKWork Rust workspace manifests with the RUST_CODE_SPEC.md section 13
 * "Manifest And Toolchain Configuration" baseline.
 *
 * What it enforces:
 *   * a workspace root declares [workspace.package] with edition + rust-version
 *   * a workspace root declares the [workspace.lints] baseline
 *   * every member crate wires [lints] workspace = true
 *   * every member crate inherits rust-version.workspace = true, and inherits
 *     edition.workspace = true when it declares no edition of its own
 *
 * Root and member edits are applied in the SAME run on purpose. Declaring
 * rust-version on a root without wiring its members turns one warning into one
 * warning per member, so a root-only pass makes the fleet strictly worse.
 *
 * Usage:
 *   node tools/align-rust-manifest-baseline.mjs --workspace E:/sdkwork-space [--dry-run] [--json]
 *   node tools/align-rust-manifest-baseline.mjs --root E:/sdkwork-space/sdkwork-order [--dry-run]
 *
 * --dry-run reports the planned edits and writes nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Fleet MSRV. RUST_CODE_SPEC.md section 13 requires rust-version to match the CI
 * toolchain; the fleet CI toolchain is `stable` (rust-toolchain.toml), and
 * edition 2024 members require at least 1.85, so 1.85 is the shared floor.
 */
const FLEET_MSRV = '1.85';
const FALLBACK_EDITION = '2021';

const LINT_BASELINE = [
  '[workspace.lints.rust]',
  '# RUST_CODE_SPEC.md section 13 baseline.',
  '# Deny-tier lints (unsafe_code, panic, unwrap_used, expect_used, pedantic) are',
  '# promoted per crate together with their cleanup: enabling them fleet-wide',
  '# today floods or fails builds that have not paid that debt yet.',
  'unsafe_op_in_unsafe_fn = "warn"',
  'trivial_casts = "warn"',
  'trivial_numeric_casts = "warn"',
  '',
  '[workspace.lints.clippy]',
  'dbg_macro = "warn"',
  'todo = "warn"',
  'unimplemented = "warn"',
  'exit = "warn"',
];

const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  'out',
  'coverage',
  'external',
  'vendor',
  'third_party',
]);

const SECTION_HEADER = /^\s*\[([^\]]+)\]\s*$/u;

function usage() {
  return [
    'Usage: node tools/align-rust-manifest-baseline.mjs --workspace <workspace-root> [--dry-run] [--json] [--concurrency N]',
    '       node tools/align-rust-manifest-baseline.mjs --root <repo> [--dry-run] [--json]',
    '',
    'Aligns Rust workspace manifests with RUST_CODE_SPEC.md section 13.',
  ].join('\n');
}

function readManifest(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const text = bom ? raw.slice(1) : raw;
  // Split AFTER each terminator so every line keeps its own ending. The fleet
  // holds mixed-EOL manifests (76 Cargo.toml at the time of writing, with
  // core.autocrlf=true in the working copy): splitting on a single dominant EOL
  // glues LF lines onto the next line and silently destroys every section
  // header, while normalising rewrites the whole file. Keeping the terminator
  // per line fixes both.
  const lines = text.length === 0 ? [''] : text.split(/(?<=\n)/u);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { bom, eol, lines };
}

function writeManifest(file, manifest) {
  fs.writeFileSync(file, manifest.bom + manifest.lines.join(''), 'utf8');
}

function sectionRange(lines, header) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const match = SECTION_HEADER.exec(lines[i]);
    if (match && match[1].trim() === header) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = SECTION_HEADER.exec(lines[i]);
    if (match) { end = i; break; }
  }
  return { start, end };
}

function hasSectionPrefix(lines, prefix) {
  return lines.some((line) => {
    const match = SECTION_HEADER.exec(line);
    return match ? match[1].trim() === prefix || match[1].trim().startsWith(`${prefix}.`) : false;
  });
}

function keyPattern(key) {
  // `edition` must not match `edition.workspace` or `some-edition`.
  return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*=`, 'u');
}

function findKeyLine(lines, range, key) {
  const pattern = keyPattern(key);
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (pattern.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Cargo accepts `<key>.workspace = true` as the inheriting form of `<key>`, and
 * the two are mutually exclusive. Treating only `<key> = ...` as "already
 * declared" is what once produced duplicate `edition.workspace` keys here, so
 * every presence check goes through this helper.
 */
function inheritedKeyLine(lines, range, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`^\\s*${escaped}\\.workspace\\s*=`, 'u');
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (pattern.test(lines[i])) return i;
  }
  return -1;
}

function declaresKey(lines, range, key) {
  return findKeyLine(lines, range, key) !== -1 || inheritedKeyLine(lines, range, key) !== -1;
}

function insertAfterHeader(lines, range, entries) {
  const insertAt = range.start + 1;
  lines.splice(insertAt, 0, ...entries);
}

/** Newly inserted text adopts the manifest's dominant ending, never a stray one. */
function terminated(lines, eol) {
  return lines.map((line) => (line === '' || line.endsWith('\n') ? line : line + eol));
}

function applyRootBaseline(lines, eol, changes, fileLabel) {
  const workspaceRange = sectionRange(lines, 'workspace');
  if (!workspaceRange) return;

  // --- [workspace.package] edition + rust-version -------------------------
  let pkgRange = sectionRange(lines, 'workspace.package');
  if (!pkgRange) {
    const block = terminated(['', '[workspace.package]', `edition = "${FALLBACK_EDITION}"`, `rust-version = "${FLEET_MSRV}"`], eol);
    // Insert AFTER the [workspace] table, never right below its header: a new
    // section header terminates the current table, so inserting there would
    // move `members`/`exclude` into [workspace.package] and leave the workspace
    // with no members. The TOML stays syntactically valid, which is why only a
    // semantic check catches it.
    lines.splice(workspaceRange.end, 0, ...block);
    changes.push(`${fileLabel}: added [workspace.package] (edition ${FALLBACK_EDITION}, rust-version ${FLEET_MSRV})`);
    pkgRange = sectionRange(lines, 'workspace.package');
  } else {
    const entries = [];
    if (!declaresKey(lines, pkgRange, 'edition')) {
      entries.push(`edition = "${FALLBACK_EDITION}"`);
      changes.push(`${fileLabel}: [workspace.package] + edition ${FALLBACK_EDITION}`);
    }
    if (!declaresKey(lines, pkgRange, 'rust-version')) {
      entries.push(`rust-version = "${FLEET_MSRV}"`);
      changes.push(`${fileLabel}: [workspace.package] + rust-version ${FLEET_MSRV}`);
    }
    if (entries.length > 0) insertAfterHeader(lines, pkgRange, terminated(entries, eol));
  }

  // --- [workspace.lints] baseline ----------------------------------------
  if (!hasSectionPrefix(lines, 'workspace.lints')) {
    const anchor = sectionRange(lines, 'workspace.package');
    const insertAt = anchor ? anchor.end : workspaceRange.end;
    lines.splice(insertAt, 0, ...terminated(LINT_BASELINE, eol), '');
    changes.push(`${fileLabel}: added [workspace.lints] baseline`);
  }
}

function applyMemberBaseline(lines, eol, changes, fileLabel, { isNestedWorkspaceRoot, allowWorkspaceInheritance }) {
  const pkgRange = sectionRange(lines, 'package');
  if (!pkgRange) return;

  if (isNestedWorkspaceRoot) {
    // A manifest that declares its own [workspace] is exempt from the enclosing
    // workspace; it needs its own root baseline before its own keys can inherit.
    applyRootBaseline(lines, eol, changes, fileLabel);
  }

  if (!allowWorkspaceInheritance) {
    changes.push(`${fileLabel}: MANUAL — not a workspace member; cannot inherit [workspace.package]/[workspace.lints]`);
    return;
  }

  const entries = [];
  if (!declaresKey(lines, pkgRange, 'edition')) {
    entries.push('edition.workspace = true');
    changes.push(`${fileLabel}: [package] + edition.workspace = true`);
  }

  const rustVersionInheritedLine = inheritedKeyLine(lines, pkgRange, 'rust-version');
  const rustVersionOwnLine = findKeyLine(lines, pkgRange, 'rust-version');
  if (rustVersionInheritedLine === -1 && rustVersionOwnLine === -1) {
    entries.push('rust-version.workspace = true');
    changes.push(`${fileLabel}: [package] + rust-version.workspace = true`);
  } else if (rustVersionInheritedLine === -1 && rustVersionOwnLine !== -1) {
    // A locally pinned MSRV would shadow the workspace declaration; the spec
    // requires inheritance, so replace the pin instead of duplicating the key.
    const previous = lines[rustVersionOwnLine].trim();
    const previousEol = lines[rustVersionOwnLine].endsWith('\r\n') ? '\r\n' : eol;
    lines[rustVersionOwnLine] = `rust-version.workspace = true${previousEol}`;
    changes.push(`${fileLabel}: [package] rust-version "${previous}" -> rust-version.workspace = true`);
  }
  if (entries.length > 0) insertAfterHeader(lines, pkgRange, terminated(entries, eol));

  // --- [lints] workspace = true ------------------------------------------
  const lintsRange = sectionRange(lines, 'lints');
  const lintsWired = lintsRange
    && lines.slice(lintsRange.start + 1, lintsRange.end).some((l) => /^\s*workspace\s*=\s*true/u.test(l));
  if (lintsWired) return;

  if (lintsRange) {
    lines.splice(lintsRange.start + 1, 0, 'workspace = true');
    changes.push(`${fileLabel}: [lints] + workspace = true`);
    return;
  }

  // Cargo allows `[lints] workspace = true` OR local `[lints.<tool>]` overrides,
  // never both: re-declaring `[lints]` after `[lints.rust]` is a hard parse
  // error and the reverse order is a Cargo resolution error. A crate that
  // declares local overrides therefore needs a human decision.
  if (hasSectionPrefix(lines, 'lints')) {
    changes.push(`${fileLabel}: MANUAL — declares local [lints.*] overrides; cannot also inherit the workspace baseline`);
    return;
  }

  const anchor = sectionRange(lines, 'package');
  const insertAt = anchor ? anchor.end : lines.length;
  lines.splice(insertAt, 0, ...terminated(['', '[lints]', 'workspace = true'], eol));
  changes.push(`${fileLabel}: added [lints] workspace = true`);
}

/**
 * Expands the workspace `members` / `exclude` globs into concrete directories.
 *
 * This exists so the tool never wires `edition.workspace = true` into a manifest
 * that is not actually a workspace member: such a manifest fails to build with
 * "edition.workspace was specified, but no workspace root was found". A warning
 * that survives is strictly better than a broken build.
 */
function workspaceMemberDirs(rootManifestData, repoRoot) {
  const lines = rootManifestData.lines;
  const range = sectionRange(lines, 'workspace');
  if (!range) return { members: null, exclude: new Set() };

  const body = lines.slice(range.start + 1, range.end).join('\n');
  const readArray = (key) => {
    const match = new RegExp(`${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'u').exec(body);
    if (!match) return null;
    return [...match[1].matchAll(/"([^"]*)"/gu)].map((m) => m[1].trim()).filter(Boolean);
  };

  const patterns = readArray('members');
  const exclude = new Set(readArray('exclude') ?? []);
  if (!patterns) return { members: null, exclude };

  const globToRegExp = (glob) => new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
      .replace(/\*\*/gu, '\u0000')
      .replace(/\*/gu, '[^/]*')
      .replace(/\u0000/gu, '.*')}$`,
    'u',
  );

  const members = new Set();
  const regexps = patterns.map(globToRegExp);
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIPPED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(repoRoot, abs).replaceAll('\\', '/');
      if (patterns.includes(rel) || regexps.some((re) => re.test(rel))) members.add(abs);
      walk(abs);
    }
  })(repoRoot);

  return { members, exclude };
}

/**
 * Semantic guard for the [workspace] table. A new section header inserted in
 * the wrong place silently re-homes `members` / `exclude` into another table
 * while leaving syntactically valid TOML behind, and the workspace then builds
 * with no members. Text comparison catches that class of corruption where a
 * TOML parse would not.
 */
function workspaceTableSignature(lines) {
  const range = sectionRange(lines, 'workspace');
  if (!range) return '';
  return lines.slice(range.start + 1, range.end).join('\n').replace(/\s+/gu, ' ').trim();
}

function collectManifestFiles(root) {
  const files = [];
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (entry.name === 'Cargo.toml') files.push(path.join(dir, entry.name));
    }
  })(root);
  return files.sort();
}

function hasInlineWorkspaceLints(lines) {
  return lines.some((line) => /^\s*\[workspace\.lints/u.test(line));
}

function alignRepo(repoRoot, { write }) {
  const rootManifest = path.join(repoRoot, 'Cargo.toml');
  if (!fs.existsSync(rootManifest)) return { repo: path.basename(repoRoot), skipped: 'no Cargo.toml', changes: [], files: 0 };

  const rootManifestData = readManifest(rootManifest);
  if (!sectionRange(rootManifestData.lines, 'workspace')) {
    return { repo: path.basename(repoRoot), skipped: 'not a workspace root', changes: [], files: 0 };
  }

  const changes = [];
  const touched = new Map();

  const manifests = collectManifestFiles(repoRoot);
  const parsed = new Map();
  for (const file of manifests) {
    try {
      parsed.set(file, readManifest(file));
    } catch { /* an unreadable manifest cannot be aligned */ }
  }

  // Every workspace root in the repository, nearest-first. The fleet nests
  // workspaces (Tauri hosts, apps/<app>-pc), and a nested root owns its own
  // members: resolving membership against the repository root alone marks every
  // nested member as unwireable.
  const roots = [];
  for (const [file, data] of parsed) {
    if (!sectionRange(data.lines, 'workspace')) continue;
    const dir = path.dirname(file);
    const { members, exclude } = workspaceMemberDirs(data, dir);
    roots.push({ dir, file, members, exclude });
  }
  roots.sort((a, b) => b.dir.length - a.dir.length);
  const nearestRoot = (dir) => roots.find((r) => dir === r.dir || dir.startsWith(`${r.dir}${path.sep}`)) ?? null;

  // Root baselines. Virtual manifests (workspace-only, no [package]) are roots
  // too and must not be skipped just because they have no [package] table.
  for (const root of roots) {
    const data = parsed.get(root.file);
    if (!data) continue;
    const label = path.relative(repoRoot, root.file).replaceAll('\\', '/');
    const before = workspaceTableSignature(data.lines);
    applyRootBaseline(data.lines, data.eol, changes, label);
    if (workspaceTableSignature(data.lines) !== before) {
      return {
        repo: path.basename(repoRoot),
        skipped: null,
        error: 'ABORTED — [workspace] table content changed; refusing to write an unverifiable manifest',
        changes: [],
        files: 0,
      };
    }
    touched.set(root.file, data);
  }

  for (const file of manifests) {
    const data = parsed.get(file);
    if (!data) continue;
    if (!sectionRange(data.lines, 'package')) continue; // virtual manifest: nothing to wire
    const label = path.relative(repoRoot, file).replaceAll('\\', '/');
    if (hasInlineWorkspaceLints(data.lines)) {
      // A module owning [workspace.lints] is a spec violation; report it rather
      // than silently rewriting a nested workspace's intent.
      changes.push(`${label}: MANUAL — defines [workspace.lints] outside the root`);
      continue;
    }

    const crateDir = path.dirname(file);
    const isNestedWorkspaceRoot = Boolean(sectionRange(data.lines, 'workspace'));
    const owner = nearestRoot(crateDir);
    const isOwnRoot = Boolean(owner && owner.dir === crateDir);
    const memberOfOwner = Boolean(owner && owner.members !== null && owner.members.has(crateDir));
    const excluded = Boolean(owner && owner.exclude.has(crateDir));
    // A root resolves inherited keys against its own [workspace.package]; a
    // descendant resolves them against its nearest enclosing workspace root.
    const allowWorkspaceInheritance = !excluded && (isOwnRoot || memberOfOwner);

    applyMemberBaseline(data.lines, data.eol, changes, label, { isNestedWorkspaceRoot, allowWorkspaceInheritance });
    touched.set(file, data);
  }

  if (write) {
    for (const [file, data] of touched) writeManifest(file, data);
  }

  return { repo: path.basename(repoRoot), skipped: null, changes, files: touched.size };
}

function discoverRepos(wsRoot) {
  const repos = [];
  for (const entry of fs.readdirSync(wsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (!entry.name.startsWith('sdkwork-')) continue;
    const dir = path.join(wsRoot, entry.name);
    if (fs.existsSync(path.join(dir, 'Cargo.toml'))) repos.push(dir);
  }
  return repos.sort();
}

/**
 * TOML validity gate. A manifest edit that produces invalid TOML would break
 * every build in that repository, so every written file is re-parsed before the
 * run is allowed to report success.
 */
function verifyToml(files) {
  return new Promise((resolve) => {
    // The fleet has ~1.7k manifests; passing them as argv blows the Windows
    // command-line limit (ENAMETOOLONG), so the list travels through a file.
    const listFile = path.join(SPECS_ROOT, '.tmp', `align-toml-verify-${process.pid}.txt`);
    fs.mkdirSync(path.dirname(listFile), { recursive: true });
    fs.writeFileSync(listFile, files.join('\n'), 'utf8');
    const script = [
      'import sys, tomllib',
      // Several SDKWork manifests carry a UTF-8 BOM. tomllib does not strip it,
      // so decode explicitly rather than treating a pre-existing BOM as a
      // regression introduced by this run.
      'bad = []',
      'with open(sys.argv[1], encoding="utf-8") as lf:',
      '    files = [line.strip() for line in lf if line.strip()]',
      'for f in files:',
      '    try:',
      '        with open(f, "rb") as fh: raw = fh.read()',
      '        if raw.startswith(b"\\xef\\xbb\\xbf"): raw = raw[3:]',
      '        tomllib.loads(raw.decode("utf-8"))',
      '    except Exception as e:',
      '        bad.append(f + " :: " + str(e))',
      'for b in bad: print(b)',
      'sys.exit(1 if bad else 0)',
    ].join('\n');
    execFile('python', ['-c', script, listFile], { maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      try {
        fs.rmSync(listFile, { force: true });
      } catch { /* best effort */ }
      resolve({ ok: !error, output: stdout.trim(), checked: files.length });
    });
  });
}

async function main() {
  const parsed = parseArgs({
    options: {
      root: { type: 'string' },
      workspace: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'skip-toml-verify': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    console.log(usage());
    return 0;
  }

  const write = !parsed.values['dry-run'];
  const repos = parsed.values.workspace
    ? discoverRepos(path.resolve(parsed.values.workspace))
    : [path.resolve(parsed.values.root ?? '.')];

  const reports = [];
  for (const repo of repos) reports.push(alignRepo(repo, { write }));

  const changed = reports.filter((r) => r.changes.length > 0);
  const errored = reports.filter((r) => r.error);
  const touchedFiles = reports.reduce((sum, r) => sum + r.files, 0);
  const totalChanges = reports.reduce((sum, r) => sum + r.changes.length, 0);

  let toml = { ok: true, output: '' };
  if (write && !parsed.values['skip-toml-verify'] && changed.length > 0) {
    const files = changed.map((r) => path.join(path.resolve(parsed.values.workspace ?? parsed.values.root ?? '.'), r.repo, 'Cargo.toml'));
    // Verify every manifest the run touched, not only the repo roots.
    const allFiles = [];
    for (const repo of repos) {
      for (const file of collectManifestFiles(repo)) allFiles.push(file);
    }
    toml = await verifyToml(allFiles.length > 0 ? allFiles : files);
  }

  if (parsed.values.json) {
    console.log(JSON.stringify({ scope: write ? 'write' : 'dry-run', repos: reports.length, changedRepos: changed.length, erroredRepos: errored.length, touchedFiles, totalChanges, tomlValid: toml.ok, tomlOutput: toml.output, reports }, null, 2));
  } else {
    console.log(`\n[align-rust-manifest-baseline] ${write ? 'WRITE' : 'DRY-RUN'} — ${repos.length} repos, ${changed.length} need changes, ${totalChanges} edits across ${touchedFiles} manifests`);
    for (const report of errored) console.error(`  ERROR ${report.repo}: ${report.error}`);
    for (const report of changed) {
      console.log(`  ${report.repo} (${report.changes.length})`);
      for (const change of report.changes.slice(0, 8)) console.log(`      - ${change}`);
      if (report.changes.length > 8) console.log(`      ... ${report.changes.length - 8} more`);
    }
    if (write && !toml.ok) {
      console.error('TOML VERIFY FAILED — a written manifest is invalid:');
      console.error(toml.output);
      return 1;
    }
    if (write) console.log(toml.ok ? '  toml validity: OK' : '  toml validity: FAILED');
  }

  return (write && !toml.ok) || errored.length > 0 ? 1 : 0;
}

process.exitCode = await main();
