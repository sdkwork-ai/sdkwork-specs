#!/usr/bin/env node
// sync-agent-rust-code-standard.mjs
//
// Propagates a concise Rust code standard block from RUST_CODE_SPEC.md into the
// AGENTS.md of every module that owns SDKWork-authored Rust crates (a root
// Cargo.toml, a crates/ tree, or a src-tauri/ host). Modules without authored
// Rust are skipped so language specs stay on-demand (AGENTS_SPEC.md section 4).
//
// The block is managed between SDKWORK-RUST-CODE-STANDARD markers, so the tool
// is idempotent: re-running it replaces the previous copy instead of duplicating it.
//
// Usage:
//   node sync-agent-rust-code-standard.mjs --workspace E:/sdkwork-space --check
//   node sync-agent-rust-code-standard.mjs --workspace E:/sdkwork-space --apply
//   node sync-agent-rust-code-standard.mjs --root E:/sdkwork-space/sdkwork-order --apply
//
// Exit codes: 0 = aligned, 1 = one or more modules are out of date.

import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index < 0) return fallback;
  const hit = args[index];
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const next = args[index + 1];
  return next && !next.startsWith('--') ? next : fallback;
};

const WORKSPACE = getArg('workspace', 'E:/sdkwork-space');
const ROOT = getArg('root', null);
const APPLY = args.includes('--apply');
const CHECK = args.includes('--check');

const MARKER_START = '<!-- SDKWORK-RUST-CODE-STANDARD: v1 -->';
const MARKER_END = '<!-- /SDKWORK-RUST-CODE-STANDARD: v1 -->';

const BLOCK = `${MARKER_START}
## Rust Code Standard

Authority: \`../sdkwork-specs/RUST_CODE_SPEC.md\` (v2, industry-best baseline); package/crate
naming and dependency declaration are normative in \`../sdkwork-specs/NAMING_SPEC.md\` section 3.1
and 3.2.

- Crates are responsibility-shaped: service, repository-sqlx, routes, service-host, native-host,
  worker, assembly, gateway. No generic \`core\`/\`common\`/\`backend\`/\`runtime\` suffixes.
- Errors are typed enums (\`thiserror\`) implementing \`std::error::Error\` with a \`source\` chain.
  \`anyhow\` only at binary/CLI/test boundaries, never in lib \`[dependencies]\`.
- No \`unsafe\` without a \`// SAFETY:\` comment; crates default to \`unsafe_code = "forbid"\`.
  No \`unwrap\`/\`expect\`/\`panic!\`/\`todo!\`/\`dbg!\` in library code reachable from public API.
- No lock guard held across \`.await\`; every external await has a timeout; spawned tasks are
  awaited/detached with a documented owner; retries are bounded, jittered, and idempotent.
- Public API is minimal, documented, \`#[must_use]\` where applicable, and semver-clean. Leaking
  framework types (\`sqlx::Row\`, axum extractors) through public signatures is forbidden.
- Workspace root declares \`[workspace.package]\` (edition, rust-version) and \`[workspace.lints]\`
  (RUST_CODE_SPEC.md section 13 baseline); every member inherits both with
  \`edition.workspace = true\` and \`[lints] workspace = true\`.

Verification:

\`\`\`bash
node ../sdkwork-specs/tools/check-rust-crate-naming-standard.mjs --root .
node ../sdkwork-specs/tools/check-rust-manifest-standard.mjs --root .
# when service/repository/route/gateway dependencies change:
node ../sdkwork-specs/tools/check-rust-backend-composition.mjs --root .
\`\`\`
${MARKER_END}`;

// ---------------------------------------------------------------------------
// Rust ownership detection
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'external', 'dist', 'build', '.next', 'vendor', 'third_party', '.tmp']);

function hasAuthoredRust(repo) {
  if (existsSync(join(repo, 'Cargo.toml'))) return true; // workspace root or single crate
  if (existsSync(join(repo, 'src-tauri', 'Cargo.toml'))) return true;
  const cratesDir = join(repo, 'crates');
  if (!existsSync(cratesDir)) return false;
  const stack = [cratesDir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(join(cur, e.name));
      } else if (e.name === 'Cargo.toml') {
        return true;
      }
    }
  }
  return false;
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

function blockRegion(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const start = normalized.indexOf(MARKER_START);
  if (start < 0) return null;
  const end = normalized.indexOf(MARKER_END, start);
  if (end < 0) return null;
  return normalized.slice(start, end + MARKER_END.length);
}

function isAligned(text) {
  const region = blockRegion(text);
  return !!region && region === BLOCK;
}

function applyBlock(text) {
  const start = text.indexOf(MARKER_START);
  if (start < 0) {
    const trimmed = text.replace(/\s+$/, '');
    return `${trimmed}\n\n${BLOCK}\n`;
  }
  const end = text.indexOf(MARKER_END, start);
  if (end < 0) {
    // Corrupted marker pair: replace from the start marker to the end of file.
    return `${text.slice(0, start).replace(/\s+$/, '')}\n\n${BLOCK}\n`;
  }
  const before = text.slice(0, start).replace(/\s+$/, '');
  const after = text.slice(end + MARKER_END.length).replace(/^\s+/, '');
  return after ? `${before}\n\n${BLOCK}\n\n${after}` : `${before}\n\n${BLOCK}\n`;
}

const repos = targetRepos();
const rustRepos = repos.filter(hasAuthoredRust);
const skipped = repos.filter((r) => !hasAuthoredRust(r)).map((r) => basename(r));
const missing = [];
const outdated = [];
const ok = [];

for (const repo of rustRepos) {
  const agentsPath = join(repo, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    missing.push(basename(repo));
    continue;
  }
  const current = readFileSync(agentsPath, 'utf8');
  if (isAligned(current)) {
    ok.push(basename(repo));
    continue;
  }
  const next = applyBlock(current);
  if (next === current) {
    ok.push(basename(repo));
    continue;
  }
  outdated.push(basename(repo));
  if (APPLY) writeFileSync(agentsPath, next);
}

const mode = APPLY ? 'applied' : CHECK ? 'check' : 'dry-run';
console.log(`mode      : ${mode}`);
console.log(`rust repos: ${rustRepos.length} (${skipped.length} non-Rust skipped)`);
console.log(`aligned   : ${ok.length}`);
console.log(`updated   : ${outdated.length}`);
console.log(`no AGENTS : ${missing.length}`);
if (missing.length) console.log(`  missing: ${missing.join(', ')}`);
if (outdated.length && !APPLY) console.log(`  needs update: ${outdated.join(', ')}`);
if (outdated.length && APPLY) console.log(`  updated: ${outdated.join(', ')}`);

process.exit(outdated.length > 0 || missing.length > 0 ? 1 : 0);
