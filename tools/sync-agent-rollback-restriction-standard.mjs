#!/usr/bin/env node
// sync-agent-rollback-restriction-standard.mjs
//
// Propagates the normative no-rollback / fix-forward discipline from
// ROLLBACK_RESTRICTION_SPEC.md into every repository (and, with --recursive,
// every nested component) AGENTS.md.
//
// The block is managed between SDKWORK-ROLLBACK-RESTRICTION-STANDARD markers,
// so the tool is idempotent: re-running it replaces the previous copy instead of
// duplicating it.
//
// The verification command inside the block is generated per file with the
// correct relative path from that AGENTS.md to sdkwork-specs, so nested
// component entrypoints stay runnable.
//
// Usage:
//   node sync-agent-rollback-restriction-standard.mjs --workspace E:/sdkwork-space --check
//   node sync-agent-rollback-restriction-standard.mjs --workspace E:/sdkwork-space --apply
//   node sync-agent-rollback-restriction-standard.mjs --root E:/sdkwork-space/sdkwork-order --apply
//   node sync-agent-rollback-restriction-standard.mjs --workspace E:/sdkwork-space --recursive --check
//
// Exit codes: 0 = aligned, 1 = one or more AGENTS.md files are out of date.

import { readdirSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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
const RECURSIVE = args.includes('--recursive');

const MARKER_START = '<!-- SDKWORK-ROLLBACK-RESTRICTION-STANDARD: v1 -->';
const MARKER_END = '<!-- /SDKWORK-ROLLBACK-RESTRICTION-STANDARD: v1 -->';

// Directories never scanned in --recursive mode. Mirrors the exclusion set used by
// align-agents-progressive-loading.mjs: tests, fixtures, snapshots, notes, and
// generated/build output are not authored agent entrypoints and must never receive
// a managed block.
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
  const verify = `node ${specsRel}/tools/sync-agent-rollback-restriction-standard.mjs --root . --check`;
  return `${MARKER_START}
## Rollback Restriction And Fix-Forward Discipline

Authority: \`${specsRel}/ROLLBACK_RESTRICTION_SPEC.md\`.

Errors are fixed forward. Version-control history is never rewound to make an error disappear.

- A rollback is any operation that moves a ref, resets the index or the working tree to an earlier
  state, discards uncommitted or committed work, or rewrites published history. It is FORBIDDEN as
  the remedy for a defect — a build failure, a type error, a lint failure, a failing test, a merge
  conflict, a runtime regression, a bad refactor, or an unclear diff. Repair forward instead, by
  adding, editing, or restoring content through a new commit.
- FORBIDDEN by an agent or a human-issued command: \`git reset --hard\` in any form;
  \`git reset --merge\`/\`--keep\`; \`git reset <ref>\` that discards staged or working-tree content;
  \`git checkout -f\`, \`git switch -f\`, \`git restore --source=<ref> --worktree .\`;
  \`git revert\` as a reflex error remedy; \`git stash drop\`/\`clear\` and \`git stash pop\` over a
  conflict; \`git branch -D\` on a branch with unmerged work; \`git update-ref -d\` and direct
  \`.git/refs/\` edits; \`git reflog expire\`, \`git gc --prune=now\`, \`git prune\`;
  \`git commit --amend\` over a pushed commit; \`git rebase\`, \`git rebase -i\`, \`git rebase --onto\`;
  \`git filter-branch\`; \`git push --force\`, \`git push --force-with-lease\`, and
  \`git push --delete\`.
- A rollback is never inferred from context or tone. "Fix it", "it's broken", "this is a mess",
  "start over", "just revert it", and "退回" are not rollback instructions. If the intent is
  ambiguous, STOP and ask — including whether the instruction means to discard work or to restore
  lost work, because that distinction decides the permissible operation.
- Discarding work requires a separate, explicit, human-issued instruction that names the operation,
  the target ref, the discarded span, and the reason, and that acknowledges the loss. The
  authorization must be quoted in the commit message. A standing authorization is not accepted.
- Recovery is ADDITIVE: \`git restore --worktree --source=<ref> -- <exact paths>\`, or
  \`git checkout <good-ref> --pathspec-from-file=<repo-relative-list>\` with the list written inside
  the repository. The pathspec must be an explicit enumerated list — never a directory, glob, brace
  expansion, or the repository root — and a restore is never combined with a build, install,
  publish, or commit step in the same shell invocation.
- Before a bulk restore: commit any local modification as a checkpoint; create a backup branch AND a
  tag AND a patch file and verify they point at the pre-restore state; produce a written
  three-snapshot blob comparison (damaged revision vs its parent vs the candidate older snapshot)
  that separates REPLACED files from files the damaged revision legitimately AUTHORED; restore the
  relative complement, not the whole tree; and keep the files the damaged revision added.
- Never treat a local tracking ref as evidence about a remote. Confirm with
  \`git ls-remote <remote> <branch>\` and record the returned object id.
- After a restore, verify by content hash rather than by reading files, re-run the gates that cover
  the restored surface, and classify each remaining failure as caused-by-the-restore or
  pre-existing. A pre-existing claim must be proven by showing the same failure at the prior
  revision with \`git show <ref>:<path>\`, not reasoned about. Fix forward. Never un-restore.
- Never bypass a hook, signature, or gate with \`--force\`, \`--no-verify\`, or \`--no-gpg-sign\` to
  land a repair.

Verification (from the repository root):

\`\`\`bash
${verify}
\`\`\`
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
