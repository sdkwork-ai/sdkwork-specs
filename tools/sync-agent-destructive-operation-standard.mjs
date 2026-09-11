#!/usr/bin/env node
// sync-agent-destructive-operation-standard.mjs
//
// Propagates the normative destructive-operation discipline from
// DESTRUCTIVE_OPERATION_SPEC.md into every repository (and, with --recursive,
// every nested component) AGENTS.md.
//
// The block is managed between SDKWORK-DESTRUCTIVE-OPERATION-STANDARD markers,
// so the tool is idempotent: re-running it replaces the previous copy instead of
// duplicating it.
//
// The verification command inside the block is generated per file with the
// correct relative path from that AGENTS.md to sdkwork-specs, so nested
// component entrypoints stay runnable.
//
// Usage:
//   node sync-agent-destructive-operation-standard.mjs --workspace E:/sdkwork-space --check
//   node sync-agent-destructive-operation-standard.mjs --workspace E:/sdkwork-space --apply
//   node sync-agent-destructive-operation-standard.mjs --root E:/sdkwork-space/sdkwork-order --apply
//   node sync-agent-destructive-operation-standard.mjs --workspace E:/sdkwork-space --recursive --check
//
// Exit codes: 0 = aligned, 1 = one or more AGENTS.md files are out of date.

import { readdirSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';

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

const MARKER_START = '<!-- SDKWORK-DESTRUCTIVE-OPERATION-STANDARD: v1 -->';
const MARKER_END = '<!-- /SDKWORK-DESTRUCTIVE-OPERATION-STANDARD: v1 -->';

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
  const verify = `node ${specsRel}/tools/sync-agent-destructive-operation-standard.mjs --root . --check`;
  return `${MARKER_START}
## Destructive Operation Safety

Authority: \`${specsRel}/DESTRUCTIVE_OPERATION_SPEC.md\`.

Deletion must be explicit, enumerated, and reviewable. Deleting by pattern instead of by named
path is forbidden. Wildcards are for read-only commands only.

- \`git rm -r\`, \`git rm\` over a directory or pattern, and \`git clean -f\`/\`-fd\`/\`-fdx\` are
  FORBIDDEN. A recursive \`git rm\` stages many deletions in one index transaction; if the process
  is interrupted (SIGTERM, timeout, sandbox kill, crash) entries are already gone from disk while
  the index is only half-written, which is silent non-atomic mass data loss.
- Delete tracked files with \`rm <exact/path>\` on each named path, let \`git status --short\`
  record the \`D\` entries, then stage only the enumerated paths. Commit the deletion separately
  from functional changes.
- Shell and script deletion by wildcard is FORBIDDEN: \`rm -rf\`/\`rm -r\`/\`rm -f\` with
  \`*\`/\`**\`/\`?\`/\`[...]\`/brace expansion, \`find ... -delete\`, \`find ... -exec rm\`,
  \`find ... | xargs rm\`, \`for f in *; do rm ...\`, \`del /S /Q\`, \`rd /S /Q\`,
  \`Remove-Item -Recurse -Force\` on a glob, \`shutil.rmtree\`, \`fs.rm(dir, { recursive: true })\`,
  and \`rimraf\` over a glob.
- A deletion MUST NOT be combined in one shell invocation with a build, install, network, or
  publish step, and MUST NOT derive its targets from an unvalidated argument, environment
  variable, or configuration value.
- Permitted narrow deletion: \`rm <exact/path>\`; a short literal path list owned by the tool that
  declares it; the module's own generated artifacts through its owning tool
  (\`pnpm clean\`, \`cargo clean\`) per \`CODE_STYLE_SPEC.md\` §7; and
  \`git restore --worktree --source=HEAD -- <exact paths>\`.
- Required sequence before any deletion: enumerate exact paths; confirm every path resolves inside
  the active repository or module root; classify tracked/generated/cached/unknown; prefer \`rm\`
  plus tracked \`git status\`; delete in batches of 20 or fewer with a status check between
  batches; report the removed paths and the authorizing decision.
- Request explicit human confirmation before deleting any git-tracked path, any directory tree,
  any path resolving outside the active repository root, or more than 20 paths.
- Recovery after an accidental mass deletion: clear a stale \`.git/index.lock\`, write the path
  list to a file INSIDE the repository (never \`/tmp\` on Windows, where the Git Bash path space
  and the native tool path space disagree), and run a single
  \`git restore --worktree --pathspec-from-file=<repo-relative-list>\`. Never loop one
  version-control call per path; the same termination cause interrupts the loop part-way.

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
