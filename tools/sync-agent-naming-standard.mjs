#!/usr/bin/env node
// sync-agent-naming-standard.mjs
//
// Propagates the normative Rust naming and dependency-declaration block from
// NAMING_SPEC.md section 3.1 / 3.2 into every module AGENTS.md.
//
// The block is managed between SDKWORK-NAMING-STANDARD markers, so the tool is
// idempotent: re-running it replaces the previous copy instead of duplicating it.
//
// Usage:
//   node sync-agent-naming-standard.mjs --workspace E:/sdkwork-space --check
//   node sync-agent-naming-standard.mjs --workspace E:/sdkwork-space --apply
//   node sync-agent-naming-standard.mjs --root E:/sdkwork-space/sdkwork-order --apply
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

const MARKER_START = '<!-- SDKWORK-NAMING-STANDARD: v1 -->';
const MARKER_END = '<!-- /SDKWORK-NAMING-STANDARD: v1 -->';

const BLOCK = `${MARKER_START}
## Rust Naming And Dependency Declaration

Authority: \`../sdkwork-specs/NAMING_SPEC.md\` section 3.1 and section 3.2.

Two identifier planes exist in every Rust crate and they MUST NOT be mixed: the package plane
(Cargo, filesystem, lock file) uses kebab-case, and the crate plane (lib target, modules, source
imports) uses snake_case.

- \`[package].name\`, the crate directory, \`[features]\` keys, and \`[[bin]].name\` use kebab-case.
- \`[lib].name\`, module files, module directories, and Rust imports use snake_case.
- A crate whose \`[package].name\` contains a hyphen SHOULD declare \`[lib].name\` explicitly
  (default: package name with every \`-\` replaced by \`_\`). A shorter lib name is allowed only
  when declared explicitly and used consistently by every consumer.
- Cargo dependency keys, \`[workspace.dependencies]\` keys, and \`Cargo.lock\` entries use the
  dependency package name. Use \`package = "..."\` when an alias is required.
- Every external crate referenced by \`src/\` MUST be declared in that crate's \`[dependencies]\`.
  Test-only crates belong in \`[dev-dependencies]\`; \`build.rs\` crates belong in
  \`[build-dependencies]\`.
- Never delete a dependency line, and never demote one from \`[dependencies]\` to
  \`[dev-dependencies]\`, while \`src/\` still imports it. Verify manifest cleanups with the
  command below before committing them.
- Regenerate and commit \`Cargo.lock\` in the same change as any dependency table edit.

Verification:

\`\`\`bash
node ../sdkwork-specs/tools/check-rust-crate-naming-standard.mjs --root .
\`\`\`
${MARKER_END}`;

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
const missing = [];
const outdated = [];
const ok = [];

for (const repo of repos) {
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
console.log(`mode     : ${mode}`);
console.log(`repos    : ${repos.length}`);
console.log(`aligned  : ${ok.length}`);
console.log(`updated  : ${outdated.length}`);
console.log(`no AGENTS: ${missing.length}`);
if (missing.length) console.log(`  missing: ${missing.join(', ')}`);
if (outdated.length && !APPLY) console.log(`  needs update: ${outdated.join(', ')}`);
if (outdated.length && APPLY) console.log(`  updated: ${outdated.join(', ')}`);

process.exit(outdated.length > 0 || missing.length > 0 ? 1 : 0);
