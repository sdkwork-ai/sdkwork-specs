#!/usr/bin/env node
// sync-agent-dependency-standard.mjs
//
// Propagates the normative pnpm workspace dependency and package-import block
// from PNPM_WORKSPACE_DEPENDENCY_SPEC.md into every module AGENTS.md.
//
// The block is managed between SDKWORK-PNPM-WORKSPACE-STANDARD markers, so the
// tool is idempotent: re-running it replaces the previous copy instead of
// duplicating it.
//
// Usage:
//   node sync-agent-dependency-standard.mjs --workspace E:/sdkwork-space --check
//   node sync-agent-dependency-standard.mjs --workspace E:/sdkwork-space --apply
//   node sync-agent-dependency-standard.mjs --root E:/sdkwork-space/sdkwork-order --apply
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

const MARKER_START = '<!-- SDKWORK-PNPM-WORKSPACE-STANDARD: v1 -->';
const MARKER_END = '<!-- /SDKWORK-PNPM-WORKSPACE-STANDARD: v1 -->';

const BLOCK = `${MARKER_START}
## pnpm Workspace Dependency And Package Import

Authority: \`../sdkwork-specs/PNPM_WORKSPACE_DEPENDENCY_SPEC.md\` (companion to
\`../sdkwork-specs/DEPENDENCY_MANAGEMENT_SPEC.md\`).

Sibling SDKWork repositories are consumed through a dual-track model that MUST stay consistent:

- **Local development** (\`pnpm dev\`, \`pnpm build\`): pnpm workspace protocol. Each sibling
  package is declared ONCE in this repository root \`pnpm-workspace.yaml\` \`packages:\` as a
  \`../sdkwork-*\` relative path, and consumed with \`workspace:*\` in \`package.json\`. Never use
  \`file:\`/\`link:\`/git-URL specifiers for SDKWork sibling packages in any environment.
- **CI / release packaging**: git-repository dependency checkout. Every sibling referenced by the
  local workspace MUST have a matching \`dependencies[]\` entry in \`sdkwork.workflow.json\` so CI
  clones the sibling into the same \`../sdkwork-*\` relative layout (\`GITHUB_WORKFLOW_SPEC.md\`).
  \`package.json\` is never rewritten for CI.

Import rules for sibling SDKWork packages:

- Import by package name only: \`import { X } from "@sdkwork/package-name"\`. The specifier MUST
  equal the target package's \`package.json\` \`name\` exactly - no shortening, renaming, or alias.
- Forbidden: relative imports that cross a package boundary into another SDKWork repository or
  another workspace package's \`src/\` (for example \`import ... from "../../sdkwork-appbase/.../src/..."\`).
- Consume only the public \`exports\` surface of a package; never deep-import sibling \`src/\` internals.
- Every non-relative import in a workspace member MUST resolve to that member's own
  \`dependencies\`/\`devDependencies\`/\`peerDependencies\` (import closure).
- Vite aliases MUST NOT rename or redirect \`@sdkwork/*\` packages, MUST NOT be added to make a
  resolution error pass, and are allowed only for documented bootstrap/SDK-generation entrypoints.
- Fix a resolution failure by correcting the workspace declaration or the package \`exports\`,
  not by adding an alias.

Verification:

\`\`\`bash
node ../sdkwork-specs/tools/verify-repo.mjs --root .
node ../sdkwork-specs/tools/check-workspace-member-protocol.mjs --root .
node ../sdkwork-specs/tools/check-dependency-list-completeness.mjs --target <repo-name>
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
