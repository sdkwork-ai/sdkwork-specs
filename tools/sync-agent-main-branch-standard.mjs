#!/usr/bin/env node
// sync-agent-main-branch-standard.mjs
//
// Propagates the normative main-branch development discipline from
// REPOSITORY_BASELINE_SPEC.md section 1 into every repository (and, with
// --recursive, every nested component) AGENTS.md.
//
// The block is managed between SDKWORK-MAIN-BRANCH-STANDARD markers, so the tool
// is idempotent: re-running it replaces the previous copy instead of duplicating
// it.
//
// The verification commands inside the block are generated per file with the
// correct relative path from that AGENTS.md to sdkwork-specs, so nested component
// entrypoints stay runnable.
//
// Usage:
//   node sync-agent-main-branch-standard.mjs --workspace <workspace-root> --check
//   node sync-agent-main-branch-standard.mjs --workspace <workspace-root> --apply
//   node sync-agent-main-branch-standard.mjs --root <workspace-root>/sdkwork-order --apply
//   node sync-agent-main-branch-standard.mjs --workspace <workspace-root> --recursive --check
//
// Exit codes: 0 = aligned, 1 = one or more AGENTS.md files are out of date.

import { readdirSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DEFAULT_WORKSPACE_ROOT } from './lib/workspace-root.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index < 0) return fallback;
  const hit = args[index];
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const next = args[index + 1];
  return next && !next.startsWith('--') ? next : fallback;
};

const WORKSPACE = getArg('workspace', DEFAULT_WORKSPACE_ROOT);
const ROOT = getArg('root', null);
const APPLY = args.includes('--apply');
const CHECK = args.includes('--check');
const RECURSIVE = args.includes('--recursive');

const MARKER_START = '<!-- SDKWORK-MAIN-BRANCH-STANDARD: v1 -->';
const MARKER_END = '<!-- /SDKWORK-MAIN-BRANCH-STANDARD: v1 -->';

// Directories never scanned in --recursive mode. Mirrors the exclusion set used by
// align-agents-progressive-loading.mjs and sync-agent-rollback-restriction-standard.mjs:
// tests, fixtures, snapshots, notes, and generated/build output are not authored agent
// entrypoints and must never receive a managed block.
const EXCLUDED_SEGMENTS = new Set([
  '.agents',
  '.cache',
  '.git',
  '.next',
  '.pnpm',
  '.turbo',
  '__fixtures__',
  '__tests__',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'external',
  'fixture',
  'fixtures',
  'gen',
  'generated',
  'node_modules',
  'out',
  'snapshots',
  'target',
  'test',
  'test-data',
  'testdata',
  'tests',
  'third-party',
  'third_party',
  'upstream',
  'vendor',
]);

function buildBlock(specsRel) {
  return `${MARKER_START}
## Main-Branch Development

Authority: \`${specsRel}/REPOSITORY_BASELINE_SPEC.md\` section 1.

Development happens on \`main\`. Everything authored in this repository is committed onto \`main\`.

- A working tree that receives authored content MUST have \`main\` checked out as its current branch
  for the whole time that work is in progress. Commit onto \`main\` directly; do not commit onto a
  branch a later merge is expected to bring in.
- A detached HEAD MUST NOT be used as a development venue. A commit created while HEAD is detached
  from every branch is reachable only through the reflog — absent from every branch history, from a
  fresh \`git clone\` of this repository, and from every other working tree — so the work it carries
  is one \`git gc\` away from being unrecoverable. Do not check out a bare commit, a tag, or an older
  ref in order to "get a clean starting point" and commit there.
- A side branch MUST NOT be used as a development venue either. There is no long-lived feature,
  release, maintenance, or personal branch, and this repository MUST NOT accumulate local commits
  that \`main\` cannot reach: making them findable would then depend on a merge that may never happen.
- A checkout off \`main\` is legitimate only while it stays read-only — a dependency or SDK pinned to
  an explicit commit, a release artifact checkout, or a bisect. No authored change is committed there.
- A working tree found detached, or on a branch other than \`main\`, with work in it is a STOP, not a
  cleanup. Do not move refs, do not rewrite history, and do not discard the commits. Report the
  branch, the commits, and the state, and let a human decide: moving commits onto \`main\` and
  discarding work are both governed by \`${specsRel}/DESTRUCTIVE_OPERATION_SPEC.md\` and
  \`${specsRel}/ROLLBACK_RESTRICTION_SPEC.md\`.

Verification (from the repository root):

\`\`\`bash
node ${specsRel}/tools/audit-repository-baseline.mjs --root . --only branch-main
node ${specsRel}/tools/sync-agent-main-branch-standard.mjs --root . --check
\`\`\`

The first fails when the current branch is anything other than \`main\`, and reports a detached HEAD
as \`detached\`. The second fails when this block is out of date.
${MARKER_END}`;
}

function toPosix(value) {
  return value.split(sep).join('/');
}

const noGit = [];

function repoRoots() {
  if (ROOT) return [ROOT.replace(/\\/g, '/')];
  const out = [];
  for (const e of readdirSync(WORKSPACE, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith('sdkwork-')) continue;
    const repo = join(WORKSPACE, e.name);
    const hasGit = existsSync(join(repo, '.git'));
    const hasAgents = existsSync(join(repo, 'AGENTS.md'));
    if (!hasGit && !hasAgents) continue;
    if (!hasGit) noGit.push(e.name);
    out.push(repo);
  }
  return out.sort();
}

function walkAgents(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (EXCLUDED_SEGMENTS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkAgents(full, out);
    } else if (e.isFile() && e.name === 'AGENTS.md') {
      out.push(full);
    }
  }
}

function targetFiles() {
  const roots = repoRoots();
  const files = [];
  for (const repo of roots) {
    const top = join(repo, 'AGENTS.md');
    if (existsSync(top)) files.push(top);
    if (RECURSIVE) {
      const nested = [];
      walkAgents(repo, nested);
      for (const f of nested) {
        if (toPosix(f) !== toPosix(top)) files.push(f);
      }
    }
  }
  return files.sort();
}

// Relative path from the AGENTS.md directory to sdkwork-specs.
function specsRelative(agentsPath) {
  const dir = agentsPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const specs = join(WORKSPACE, 'sdkwork-specs').replace(/\\/g, '/');
  const rel = toPosix(relative(dir, specs));
  if (!rel || rel === '.') return '.';
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function blockRegion(text, block) {
  const normalized = text.replace(/\r\n/g, '\n');
  const start = normalized.indexOf(MARKER_START);
  if (start < 0) return null;
  const end = normalized.indexOf(MARKER_END, start);
  if (end < 0) return null;
  return normalized.slice(start, end + MARKER_END.length);
}

function applyBlock(text, block) {
  const start = text.indexOf(MARKER_START);
  if (start < 0) {
    const trimmed = text.replace(/\s+$/, '');
    return `${trimmed}\n\n${block}\n`;
  }
  const end = text.indexOf(MARKER_END, start);
  if (end < 0) {
    // Corrupted marker pair: replace from the start marker to the end of file.
    return `${text.slice(0, start).replace(/\s+$/, '')}\n\n${block}\n`;
  }
  const before = text.slice(0, start).replace(/\s+$/, '');
  const after = text.slice(end + MARKER_END.length).replace(/^\s+/, '');
  return after ? `${before}\n\n${block}\n\n${after}` : `${before}\n\n${block}\n`;
}

const files = targetFiles();
const missing = [];
const outdated = [];
const ok = [];

for (const agentsPath of files) {
  let current;
  try {
    if (!statSync(agentsPath).isFile()) continue;
    current = readFileSync(agentsPath, 'utf8');
  } catch {
    missing.push(agentsPath);
    continue;
  }
  const block = buildBlock(specsRelative(agentsPath));
  const region = blockRegion(current, block);
  if (region && region === block) {
    ok.push(agentsPath);
    continue;
  }
  const next = applyBlock(current, block);
  if (next === current) {
    ok.push(agentsPath);
    continue;
  }
  outdated.push(agentsPath);
  if (APPLY) writeFileSync(agentsPath, next);
}

const rel = (p) => toPosix(relative(WORKSPACE, p));
const mode = APPLY ? 'applied' : CHECK ? 'check' : 'dry-run';
console.log(`mode      : ${mode}`);
console.log(`recursive : ${RECURSIVE}`);
console.log(`targets   : ${files.length}`);
console.log(`aligned   : ${ok.length}`);
console.log(`updated   : ${outdated.length}`);
console.log(`unreadable: ${missing.length}`);
console.log(`no .git   : ${noGit.length}`);
if (noGit.length) console.log(`  missing .git: ${noGit.join(', ')}`);
if (missing.length) console.log(`  unreadable: ${missing.map(rel).join(', ')}`);
if (outdated.length && !APPLY) console.log(`  needs update: ${outdated.map(rel).join(', ')}`);
if (outdated.length && APPLY) console.log(`  updated: ${outdated.map(rel).join(', ')}`);

process.exit(outdated.length > 0 || missing.length > 0 ? 1 : 0);
