#!/usr/bin/env node
// sync-agent-sdk-generation-standard.mjs
//
// Propagates the "generated SDK output is generator-owned" discipline from
// SDK_SPEC.md and SDK_WORKSPACE_GENERATION_SPEC.md into every repository
// AGENTS.md as a managed block.
//
// The block is managed between SDKWORK-SDK-GENERATION-STANDARD markers, so the
// tool is idempotent: re-running it replaces the previous copy instead of
// duplicating it.
//
// Usage:
//   node sync-agent-sdk-generation-standard.mjs --workspace E:/sdkwork-space --check
//   node sync-agent-sdk-generation-standard.mjs --workspace E:/sdkwork-space --apply
//   node sync-agent-sdk-generation-standard.mjs --root E:/sdkwork-space/sdkwork-order --apply
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

const MARKER_START = '<!-- SDKWORK-SDK-GENERATION-STANDARD: v1 -->';
const MARKER_END = '<!-- /SDKWORK-SDK-GENERATION-STANDARD: v1 -->';

const BLOCK = `${MARKER_START}
## Generated SDK Output Is Generator-Owned

Authority: \`../sdkwork-specs/SDK_SPEC.md\` and \`../sdkwork-specs/SDK_WORKSPACE_GENERATION_SPEC.md\`.

Everything generated under \`sdks/\` — \`generated/server-openapi/\` trees, generated language
workspaces, \`dist/\` build output, generated \`sdkwork-sdk.json\`, generated
\`.sdkwork/sdkwork-generator-*\` reports, and standardizer-synced OpenAPI snapshots — is produced by
the canonical SDK generator \`../sdkwork-sdk-generator/bin/sdkgen.js\` (\`@sdkwork/sdk-generator\`).

- Do not hand-edit generated SDK files, including type definitions, dist bundles, and generated
  package metadata. Manual edits are overwritten by the next generation run and break
  reproducibility and contract audits.
- When generated or compiled SDK output does not meet a contract or standard, fix the upstream
  source — authored API contract, route manifest, OpenAPI authority, derived \`*.sdkgen.*\` input,
  generator profile, or \`custom/\` runtime build scripts — then regenerate through the standard
  generation command. Do not patch generated output in place.
- Remove stale generated files by re-running the family generation command, which owns cleanup of
  disappeared routes and models; do not hand-prune generated trees.
- The only approved handwritten surfaces are \`custom/\` roots inside generated workspaces and
  authored \`composed/\` facades outside \`generated/server-openapi\`.

Verification:

\`\`\`bash
node ../sdkwork-specs/tools/sync-agent-sdk-generation-standard.mjs --root . --check
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
