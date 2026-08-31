#!/usr/bin/env node
// check-rust-manifest-standard.mjs
//
// Validates RUST_CODE_SPEC.md section 13 (Manifest And Toolchain Configuration):
//   * workspace root declares [workspace.package] with edition + rust-version
//   * workspace root declares [workspace.lints] (the lint baseline)
//   * member crates inherit edition/rust-version via `edition.workspace = true` /
//     `rust-version.workspace = true` when the root defines them
//   * member crates wire the baseline with `[lints] workspace = true`
//   * `[lints] workspace = true` never points at a missing `[workspace.lints]`
//
// Exit codes: 0 = no errors, 1 = errors found (warnings do not fail).
//
// Usage:
//   node check-rust-manifest-standard.mjs --workspace E:/sdkwork-space
//   node check-rust-manifest-standard.mjs --root E:/sdkwork-space/sdkwork-order
//   node check-rust-manifest-standard.mjs --workspace E:/sdkwork-space --json

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index < 0) return fallback;
  const hit = args[index];
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const next = args[index + 1];
  return next && !next.startsWith('--') ? next : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const WORKSPACE = getArg('workspace', 'E:/sdkwork-space');
const ROOT = getArg('root', null);
const AS_JSON = hasFlag('json');

const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'external', 'dist', 'build', '.next', 'vendor', 'third_party', '.tmp']);

// ---------------------------------------------------------------------------
// Minimal Cargo.toml reader
// ---------------------------------------------------------------------------
function parseManifest(text) {
  const sections = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[{1,2}([^\]]+)\]{1,2}$/);
    if (header) {
      current = { name: header[1], lines: [], start: sections.length };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  const section = (name) => sections.find((s) => s.name === name);
  const hasSectionPrefix = (prefix) => sections.some((s) => s.name === prefix || s.name.startsWith(`${prefix}.`));
  const value = (sectionName, key) => {
    const sec = section(sectionName);
    if (!sec) return null;
    for (const line of sec.lines) {
      const m = line.match(new RegExp(`^${key}\\s*=\\s*(.+)$`));
      if (m) return m[1].trim().replace(/^"|"$/g, '');
    }
    return null;
  };
  const hasKey = (sectionName, key) => {
    const sec = section(sectionName);
    if (!sec) return false;
    return sec.lines.some((l) => l.startsWith(key) || l.startsWith(`${key}.`) || l.includes(`${key} =`));
  };
  return { sections, section, hasSectionPrefix, value, hasKey, text };
}

function walkManifests(dir, out, depth = 0) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 8) continue;
      walkManifests(p, out, depth + 1);
    } else if (e.name === 'Cargo.toml') {
      out.push(p);
    }
  }
}

function targetRepos() {
  if (ROOT) return [ROOT.replace(/\\/g, '/')];
  const out = [];
  for (const e of readdirSync(WORKSPACE, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith('sdkwork-')) continue;
    const repo = join(WORKSPACE, e.name);
    if (existsSync(join(repo, '.git'))) out.push(repo);
  }
  return out.sort();
}

const repos = targetRepos();
const findings = [];
const add = (repo, level, code, message, file) =>
  findings.push({
    repo: basename(repo),
    level,
    code,
    message,
    file: file ? file.replace(/\\/g, '/').replace('E:/sdkwork-space/', '') : null,
  });

for (const repo of repos) {
  const rootManifestPath = join(repo, 'Cargo.toml');
  if (!existsSync(rootManifestPath)) continue;
  const rootText = readFileSync(rootManifestPath, 'utf8');
  const root = parseManifest(rootText);
  const isWorkspaceRoot = !!root.section('workspace');
  if (!isWorkspaceRoot) continue; // single-crate repos without [workspace] are out of scope for baseline wiring

  // Workspace root baseline declarations
  const pkgSec = root.section('workspace.package');
  const edition = pkgSec ? root.value('workspace.package', 'edition') : null;
  const rustVersion = pkgSec ? root.value('workspace.package', 'rust-version') : null;
  const hasLints = root.hasSectionPrefix('workspace.lints');
  const hasPkg = root.hasSectionPrefix('workspace.package');

  if (!hasPkg) {
    add(repo, 'warn', 'rust.manifest.workspace-package-missing', `workspace root has no [workspace.package]; declare edition and rust-version (RUST_CODE_SPEC.md section 13)`, rootManifestPath);
  } else {
    if (!edition) add(repo, 'warn', 'rust.manifest.edition-missing', `[workspace.package] declares no edition`, rootManifestPath);
    if (!rustVersion) add(repo, 'warn', 'rust.manifest.rust-version-missing', `[workspace.package] declares no rust-version; declare the MSRV matching CI (RUST_CODE_SPEC.md section 13)`, rootManifestPath);
  }
  if (!hasLints) {
    add(repo, 'warn', 'rust.manifest.workspace-lints-missing', `workspace root has no [workspace.lints]; declare the RUST_CODE_SPEC.md section 13 baseline`, rootManifestPath);
  }

  // Member inheritance checks
  const members = [];
  walkManifests(repo, members);
  for (const file of members) {
    if (file === rootManifestPath) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const manifest = parseManifest(text);
    if (!manifest.section('package')) continue; // not a package manifest
    const pkgName = manifest.value('package', 'name');
    if (!pkgName) continue;

    const pkgSection = manifest.section('package');
    const editionDeclared = manifest.value('package', 'edition');
    const editionInherited = pkgSection?.lines.some((l) => /^edition\.workspace\s*=\s*true/.test(l));
    const rustVersionInherited = pkgSection?.lines.some((l) => /^rust-version\.workspace\s*=\s*true/.test(l));
    const lintsWired = manifest.section('lints')?.lines.some((l) => /^workspace\s*=\s*true/.test(l));

    if (edition && !editionDeclared && !editionInherited) {
      add(repo, 'warn', 'rust.manifest.edition-not-inherited', `crate "${pkgName}" does not inherit edition.workspace = true`, file);
    }
    if (rustVersion && !rustVersionInherited) {
      add(repo, 'warn', 'rust.manifest.rust-version-not-inherited', `crate "${pkgName}" does not inherit rust-version.workspace = true`, file);
    }
    if (hasLints && !lintsWired) {
      add(repo, 'warn', 'rust.manifest.lints-not-wired', `crate "${pkgName}" does not declare [lints] workspace = true; it bypasses the workspace lint baseline`, file);
    }
    if (lintsWired && !hasLints) {
      add(repo, 'error', 'rust.manifest.lints-dangling', `crate "${pkgName}" declares [lints] workspace = true but the workspace root has no [workspace.lints]; add the baseline or remove the wiring`, file);
    }
    if (manifest.section('workspace.lints')) {
      add(repo, 'error', 'rust.manifest.lints-in-member', `crate "${pkgName}" defines [workspace.lints] locally; the baseline belongs only in the workspace root`, file);
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const errors = findings.filter((f) => f.level === 'error');
const warnings = findings.filter((f) => f.level === 'warn');

if (AS_JSON) {
  console.log(JSON.stringify({ findings, errors: errors.length, warnings: warnings.length }, null, 2));
} else {
  for (const item of findings.slice(0, 120)) {
    console.log(`  [${item.level}] ${item.code}: ${item.message}`);
    if (item.file) console.log(`      ${item.file}`);
  }
  if (findings.length > 120) console.log(`  ... ${findings.length - 120} more`);
  const codes = new Map();
  for (const f of findings) codes.set(f.code, (codes.get(f.code) || 0) + 1);
  console.log(`\n--- summary ---`);
  console.log(`repos scanned : ${repos.length}`);
  console.log(`errors        : ${errors.length}`);
  console.log(`warnings      : ${warnings.length}`);
  console.log('by code:');
  for (const [code, count] of [...codes].sort((a, b) => b[1] - a[1])) console.log(`  ${count.toString().padStart(5)}  ${code}`);
}

process.exit(errors.length > 0 ? 1 : 0);
