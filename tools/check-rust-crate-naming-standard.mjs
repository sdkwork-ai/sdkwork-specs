#!/usr/bin/env node
// check-rust-crate-naming-standard.mjs
//
// Validates NAMING_SPEC.md section 3.1 (Rust package, directory, crate, and module
// naming) and section 3.2 (Rust dependency declaration integrity).
//
// Two identifier planes must never be mixed:
//   * package / directory / feature / binary -> kebab-case
//   * crate lib target / module / source import -> snake_case
//
// Scope: this checker validates SDKWork-authored crates only. It scans `sdkwork-*` repositories
// and never renames or re-cases third-party dependencies: registry/git/upstream crates keep their
// published names verbatim (NAMING_SPEC.md section 3.1 rule 11). Registry (version) dependencies
// are not validated offline, and unknown upstream crate names in `use` statements are ignored, so
// third-party imports are never reported as naming violations.
//
// Usage:
//   node check-rust-crate-naming-standard.mjs --workspace E:/sdkwork-space
//   node check-rust-crate-naming-standard.mjs --root E:/sdkwork-space/sdkwork-order
//   node check-rust-crate-naming-standard.mjs --workspace E:/sdkwork-space --json
//
// Exit codes: 0 = clean, 1 = violations found.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname, relative, resolve } from 'node:path';

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

const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  '.git',
  'external',
  'dist',
  'build',
  '.next',
  'vendor',
  'third_party',
  '.cargo-target-agents-check',
  '.tmp',
]);

// Host-embedded and generated crate roots legitimately use a fixed directory
// name that differs from the package name.
const HOST_DIR_EXCEPTIONS = new Set(['src-tauri', 'src-host', 'src', 'rust', 'converters', 'native', 'tauri-rust']);

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAKE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

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
  const value = (sectionName, key) => {
    const sec = section(sectionName);
    if (!sec) return null;
    for (const line of sec.lines) {
      const m = line.match(new RegExp(`^${key}\\s*=\\s*(.+)$`));
      if (m) return m[1].trim().replace(/^"|"$/g, '');
    }
    return null;
  };
  return { sections, section, value, text };
}

function dependencyEntries(manifest) {
  const out = [];
  for (const sec of manifest.sections) {
    if (!/^(dependencies|dev-dependencies|build-dependencies)$/.test(sec.name) && !sec.name.startsWith('target.')) {
      continue;
    }
    for (const line of sec.lines) {
      const m = line.match(/^([A-Za-z0-9_.\-]+)\s*(?:=|\.|\{)/);
      if (!m) continue;
      const key = m[1].split('.')[0];
      const pkgAlias = line.match(/package\s*=\s*"([^"]+)"/);
      const path = line.match(/path\s*=\s*"([^"]+)"/);
      out.push({
        table: sec.name,
        key,
        packageName: pkgAlias ? pkgAlias[1] : key,
        path: path ? path[1] : null,
        line,
      });
    }
  }
  return out;
}

function featureNames(manifest) {
  const out = [];
  for (const sec of manifest.sections) {
    if (sec.name !== 'features') continue;
    for (const line of sec.lines) {
      const m = line.match(/^([A-Za-z0-9_.\-]+)\s*=/);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

function binaryNames(manifest) {
  const out = [];
  for (const sec of manifest.sections) {
    if (!/^bin$/.test(sec.name)) continue;
    const name = sec.lines.find((l) => l.startsWith('name '))?.match(/^name\s*=\s*"([^"]+)"/);
    if (name) out.push(name[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source scanning helpers
// ---------------------------------------------------------------------------
function collectRs(dir, out = []) {
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const p = join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.rs')) out.push(p);
    }
  }
  return out;
}

function localModuleNames(crateDir) {
  const names = new Set();
  const srcDir = join(crateDir, 'src');
  if (!existsSync(srcDir)) return names;

  // Every file stem and directory under src/ can be a module path segment.
  const stack = [srcDir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (e.isDirectory()) {
        names.add(e.name);
        stack.push(join(cur, e.name));
      } else if (e.name.endsWith('.rs')) {
        names.add(e.name.replace(/\.rs$/, ''));
      }
    }
  }

  // Explicit `mod name;` / `mod name {` declarations.
  for (const file of collectRs(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:^|\s)(?:pub(?:\([^)]*\))?\s+)?mod\s+([a-z_][A-Za-z0-9_]*)\s*[;{]/gm)) {
      names.add(m[1]);
    }
  }
  return names;
}

const RUST_RESERVED = new Set([
  'self',
  'super',
  'crate',
  'std',
  'core',
  'alloc',
  'Self',
  'cfg',
  'feature',
  'doc',
  'test',
  'derive',
  'allow',
  'deny',
  'warn',
  'path',
  'str',
  'u8',
  'u16',
  'u32',
  'u64',
  'usize',
  'i32',
  'i64',
  'f64',
  'bool',
  'String',
  'Vec',
  'Option',
  'Result',
  'Box',
]);

// Removes line/block comments and string literals (including raw strings) from
// Rust source before import scanning, so generated-code templates and prose do
// not create phantom crate references.
function stripRustNoise(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') i += 1;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i = Math.min(n, i + 2);
    } else if (c === 'r' && d === '#') {
      let j = i + 2;
      while (j < n && !(text[j] === '"' && text[j + 1] === '#')) j += 1;
      i = Math.min(n, j + 2);
    } else if (c === '"') {
      i += 1;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Pass 1: global package index
// ---------------------------------------------------------------------------
const repos = targetRepos();
const manifests = [];
for (const repo of repos) {
  const found = [];
  walkManifests(repo, found);
  manifests.push(...found);
}

const packageIndex = new Map(); // packageName -> { path, libName }
const knownCrateNames = new Set(); // every package name + lib name + dependency key seen anywhere

function readManifestSummary(file) {
  const text = readFileSync(file, 'utf8');
  const manifest = parseManifest(text);
  const pkg = manifest.value('package', 'name');
  if (!pkg) return null;
  const libName = manifest.value('lib', 'name');
  return { file, manifest, pkg, libName, dir: dirname(file) };
}

const summaries = [];
for (const file of manifests) {
  let summary;
  try {
    summary = readManifestSummary(file);
  } catch {
    continue;
  }
  if (!summary) continue;
  summaries.push(summary);
  const derivedLib = libNameOf(summary.pkg);
  packageIndex.set(summary.pkg, { path: summary.dir, libName: summary.libName || derivedLib });
  knownCrateNames.add(summary.pkg);
  knownCrateNames.add(summary.libName || derivedLib);
  for (const dep of dependencyEntries(summary.manifest)) {
    knownCrateNames.add(dep.key);
    knownCrateNames.add(dep.packageName);
  }
}

function libNameOf(packageName) {
  return packageName.replace(/-/g, '_');
}

// Workspace dependency tables: directory -> declared keys. A crate resolves its
// `workspace = true` dependencies against the nearest ancestor workspace.
const workspaceDependencyKeysByDir = new Map();
for (const summary of summaries) {
  const sec = summary.manifest.section('workspace.dependencies');
  if (!sec) continue;
  const keys = new Set();
  for (const line of sec.lines) {
    const m = line.match(/^([A-Za-z0-9_.\-]+)\s*(?:=|\.)/);
    if (m) keys.add(m[1].split('.')[0]);
  }
  workspaceDependencyKeysByDir.set(summary.dir.replace(/\\/g, '/'), keys);
}

function workspaceDependencyKeysFor(crateDir) {
  let dir = crateDir.replace(/\\/g, '/');
  for (;;) {
    if (workspaceDependencyKeysByDir.has(dir)) return workspaceDependencyKeysByDir.get(dir);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// Pass 2: per-crate checks
// ---------------------------------------------------------------------------
const findings = [];
const add = (repo, level, code, message, file) =>
  findings.push({
    repo: basename(repo),
    level,
    code,
    message,
    file: file ? file.replace(/\\/g, '/').replace('E:/sdkwork-space/', '') : null,
  });

for (const summary of summaries) {
  const repo = repos.find((r) => summary.file.replace(/\\/g, '/').startsWith(r + '/')) || dirname(summary.file);
  const crateDir = summary.dir;
  const relManifest = summary.file.replace(/\\/g, '/').replace('E:/sdkwork-space/', '');
  const { pkg, libName, manifest } = summary;

  // 3.1.1 package name must be kebab-case
  if (!KEBAB.test(pkg)) {
    add(repo, 'error', 'rust.package-name-case', `[package].name "${pkg}" must use kebab-case`, summary.file);
  }

  // 3.1.2 crate directory must match the package name (host-embedded roots excepted)
  const dir = basename(crateDir);
  if (dir !== pkg && !HOST_DIR_EXCEPTIONS.has(dir) && !/\/generated\//.test(relManifest)) {
    add(
      repo,
      'warn',
      'rust.directory-name-mismatch',
      `crate directory "${dir}" does not match [package].name "${pkg}"`,
      summary.file,
    );
  }

  // 3.1.3 [lib].name must be snake_case and derive from the package name
  const hasLibSection = !!manifest.section('lib');
  if (hasLibSection && libName) {
    if (!SNAKE.test(libName)) {
      add(repo, 'error', 'rust.lib-name-case', `[lib].name "${libName}" must use snake_case`, summary.file);
    } else if (libName !== libNameOf(pkg)) {
      add(
        repo,
        'warn',
        'rust.lib-name-derivation',
        `[lib].name "${libName}" does not derive from [package].name "${pkg}" (expected "${libNameOf(pkg)}")`,
        summary.file,
      );
    }
  } else if (pkg.includes('-')) {
    add(
      repo,
      'warn',
      'rust.lib-name-undeclared',
      `[package].name "${pkg}" contains hyphens but [lib].name is not declared; declare name = "${libNameOf(pkg)}" to make the import name reviewable (required when a shorter lib name is used)`,
      summary.file,
    );
  }

  // 3.1.4 binary and feature names must be kebab-case
  for (const bin of binaryNames(manifest)) {
    if (!KEBAB.test(bin)) {
      add(repo, 'error', 'rust.bin-name-case', `[[bin]].name "${bin}" must use kebab-case`, summary.file);
    }
  }
  for (const feature of featureNames(manifest)) {
    if (!KEBAB.test(feature)) {
      add(repo, 'error', 'rust.feature-name-case', `[features] "${feature}" must use kebab-case`, summary.file);
    }
  }

  // 3.1.5 Rust module file names must be snake_case
  const srcDir = join(crateDir, 'src');
  if (existsSync(srcDir)) {
    for (const file of collectRs(srcDir)) {
      const stem = basename(file).replace(/\.rs$/, '');
      if (['lib', 'main', 'mod', 'build'].includes(stem)) continue;
      if (!SNAKE.test(stem)) {
        add(repo, 'warn', 'rust.module-file-case', `module file "${basename(file)}" must use snake_case`, file);
      }
    }
  }

  // 3.2 dependency declaration integrity
  const deps = dependencyEntries(manifest);
  const declaredByTable = new Map();
  for (const dep of deps) {
    if (!declaredByTable.has(dep.packageName)) declaredByTable.set(dep.packageName, new Set());
    declaredByTable.get(dep.packageName).add(dep.table);
  }

  // Rust source imports the lib name, which may differ from the package name
  // (sdkwork-community-storage-sqlx-rust -> sdkwork_community_storage_sqlx).
  const declaredLibNames = new Set();
  for (const dep of deps) {
    const info = packageIndex.get(dep.packageName);
    declaredLibNames.add(info ? info.libName : libNameOf(dep.packageName));
    declaredLibNames.add(dep.packageName);
  }

  // 3.2.1 declared dependency keys must resolve to a real package.
  // Registry (version) dependencies cannot be validated offline, so only path
  // and workspace dependencies are checked.
  for (const dep of deps) {
    if (dep.path) {
      const target = resolve(crateDir, dep.path);
      const targetManifest = join(target, 'Cargo.toml');
      if (!existsSync(targetManifest)) {
        add(repo, 'error', 'rust.dependency-path-missing', `dependency "${dep.key}" path does not exist: ${dep.path}`, summary.file);
      } else {
        try {
          const targetSummary = readManifestSummary(targetManifest);
          if (targetSummary && targetSummary.pkg !== dep.packageName) {
            add(
              repo,
              'error',
              'rust.dependency-key-mismatch',
              `dependency key "${dep.key}" does not match target package "${targetSummary.pkg}"`,
              summary.file,
            );
          }
        } catch {
          /* unreadable target manifest is reported by other checks */
        }
      }
    } else if (dep.line.includes('workspace = true')) {
      const workspaceDeps = workspaceDependencyKeysFor(crateDir);
      if (workspaceDeps && !workspaceDeps.has(dep.key)) {
        add(
          repo,
          'error',
          'rust.dependency-workspace-key-missing',
          `dependency "${dep.key}" uses workspace = true but the workspace root does not declare it`,
          summary.file,
        );
      }
    }
  }

  // 3.2.2 every external crate used by src/ must be declared in [dependencies]
  const locals = localModuleNames(crateDir);
  const ownLib = libName || libNameOf(pkg);
  const undeclared = new Map();
  // Module aliases are computed per source file; record() consults the active one.
  let activeAliases = new Map();
  const record = (file, name) => {
    if (RUST_RESERVED.has(name)) return;
    if (name === ownLib) return;
    if (locals.has(name)) return;
    if (declaredLibNames.has(name)) return;
    if (declaredByTable.has(name) || declaredByTable.has(name.replace(/_/g, '-'))) return;
    // `time::interval(...)` where `use tokio::time::{self, ...}` aliases it.
    if (activeAliases.has(name)) {
      const target = activeAliases.get(name);
      if (declaredLibNames.has(target) || declaredByTable.has(target)) return;
    }
    if (!knownCrateNames.has(name) && !knownCrateNames.has(name.replace(/_/g, '-'))) return;
    if (!undeclared.has(name)) undeclared.set(name, new Set());
    undeclared.get(name).add(file.replace(/\\/g, '/').replace('E:/sdkwork-space/', ''));
  };

  // `use` statements: only the first path segment can name an external crate.
  // Everything after it (including multi-line brace groups such as
  // `use axum::{http::Request, ...}`) belongs to that crate.
  const useStatement = /(?:^|\n)[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+([^;]+);/g;
  const externCrate = /(?:^|\n)[ \t]*extern[ \t]+crate[ \t]+([a-z_][A-Za-z0-9_]*)/g;
  const leadingPath = /(?:^|[^A-Za-z0-9_:.`'"])([a-z][a-z0-9_]*)\s*::/g;
  for (const file of collectRs(srcDir)) {
    const raw = readFileSync(file, 'utf8');
    // Drop comments and string literals so generated-code templates and prose
    // do not create phantom imports.
    const text = stripRustNoise(raw);

    // Module aliases: `use a::b::{self, ...}` / `use a::b;` / `use a::b as c;`
    // bring `b` (or `c`) into scope as an alias of crate `a`.
    const aliases = new Map();
    for (const m of text.matchAll(useStatement)) {
      const stmt = m[1].trim();
      const parts = stmt.split('::');
      const first = parts[0].replace(/^\{/, '').trim();
      if (!first) continue;
      for (let i = 1; i < parts.length; i += 1) {
        for (const rawSeg of parts[i].split(/[{},]/)) {
          const seg = rawSeg.trim();
          if (seg && seg !== 'self') aliases.set(seg, first);
        }
      }
      const asName = stmt.match(/\bas\s+([a-z_][A-Za-z0-9_]*)\s*$/);
      if (asName) aliases.set(asName[1], first);
    }
    activeAliases = aliases;

    for (const m of text.matchAll(useStatement)) {
      const first = m[1].trim().split('::')[0].replace(/^\{/, '').trim();
      if (first) record(file, first);
    }
    for (const m of text.matchAll(externCrate)) record(file, m[1]);
    // Remaining inline paths, with every `use` statement removed.
    for (const m of text.replace(useStatement, '\n').matchAll(leadingPath)) record(file, m[1]);
  }
  for (const [name, files] of undeclared) {
    add(
      repo,
      'error',
      'rust.dependency-undeclared',
      `src/ references crate "${name}" but it is not declared in [dependencies] (used in ${files.size} file(s): ${[...files].slice(0, 2).join(', ')})`,
      summary.file,
    );
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
  const byRepo = new Map();
  for (const f of findings) {
    if (!byRepo.has(f.repo)) byRepo.set(f.repo, []);
    byRepo.get(f.repo).push(f);
  }
  for (const [repo, items] of [...byRepo].sort((a, b) => b[1].length - a[1].length)) {
    const e = items.filter((i) => i.level === 'error').length;
    const w = items.filter((i) => i.level === 'warn').length;
    console.log(`\n=== ${repo} (${e} error, ${w} warn) ===`);
    for (const item of items.slice(0, 40)) {
      console.log(`  [${item.level}] ${item.code}: ${item.message}`);
      if (item.file) console.log(`      ${item.file}`);
    }
    if (items.length > 40) console.log(`  ... ${items.length - 40} more`);
  }

  const codes = new Map();
  for (const f of findings) codes.set(f.code, (codes.get(f.code) || 0) + 1);
  console.log(`\n--- summary ---`);
  console.log(`repos scanned : ${repos.length}`);
  console.log(`crates scanned: ${summaries.length}`);
  console.log(`errors        : ${errors.length}`);
  console.log(`warnings      : ${warnings.length}`);
  console.log('by code:');
  for (const [code, count] of [...codes].sort((a, b) => b[1] - a[1])) console.log(`  ${count.toString().padStart(5)}  ${code}`);
}

process.exit(errors.length > 0 ? 1 : 0);
