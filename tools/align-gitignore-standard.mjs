#!/usr/bin/env node
/**
 * Remove `.gitignore` entries that ignore canonical authored content (see
 * `check-gitignore-standard.mjs` for the authority and the measured fleet impact).
 *
 * Only the exact offending rule line is removed: no other entry, comment, blank line, or line
 * ending changes. Files are matched CRLF-aware and written back with their original EOL.
 *
 *   node tools/align-gitignore-standard.mjs --workspace E:/sdkwork-space            # plan
 *   node tools/align-gitignore-standard.mjs --workspace E:/sdkwork-space --fix      # apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listWorkspaceRepositoryRoots } from './lib/workspace-check-runner.mjs';
import { CANONICAL_CONTENT_IGNORE_RULES, parseArgs as parseCheckArgs } from './check-gitignore-standard.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TOOL_DIR, '../..');

export function planRepository(repoRoot) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return { root: repoRoot, path: gitignorePath, removed: [], changed: false };
  }
  const original = fs.readFileSync(gitignorePath, 'utf8');
  const removed = [];
  const kept = [];
  for (const rawLine of original.split(/\r?\n/u)) {
    const entry = rawLine.trim();
    const isOffender = entry.length > 0
      && !entry.startsWith('#')
      && !entry.startsWith('!')
      && CANONICAL_CONTENT_IGNORE_RULES.some((rule) => rule.match.test(entry));
    if (isOffender) {
      removed.push(entry);
    } else {
      kept.push(rawLine);
    }
  }
  return {
    root: repoRoot,
    path: gitignorePath,
    removed,
    changed: removed.length > 0,
    next: kept.join(original.includes('\r\n') ? '\r\n' : '\n'),
  };
}

export function applyRepository(plan) {
  if (!plan.changed) {
    return false;
  }
  const before = fs.readFileSync(plan.path, 'utf8');
  fs.writeFileSync(plan.path, plan.next, 'utf8');
  const after = fs.readFileSync(plan.path, 'utf8');
  if (after === before) {
    throw new Error(`align-gitignore-standard: write did not change ${plan.path}`);
  }
  return true;
}

function main() {
  const argv = process.argv.slice(2);
  const fix = argv.includes('--fix');
  const { workspace, root } = parseCheckArgs(argv.filter((token) => token !== '--fix'));

  let roots;
  if (root) {
    roots = [root];
  } else if (workspace) {
    roots = listWorkspaceRepositoryRoots(workspace);
  } else {
    process.stderr.write('align-gitignore-standard: pass --workspace <dir> or --root <repo> [--fix]\n');
    process.exit(2);
    return;
  }
  if (roots.length === 0) {
    process.stderr.write('align-gitignore-standard: resolved 0 repositories\n');
    process.exit(2);
    return;
  }

  const plans = roots.map((repoRoot) => planRepository(repoRoot)).filter((plan) => plan.changed);
  let applied = 0;
  const lines = [];
  for (const plan of plans) {
    const relative = path.relative(WORKSPACE_ROOT, plan.path).replaceAll('\\', '/');
    lines.push(`${fix && applyRepository(plan) ? 'removed' : 'would remove'} ${plan.removed.length} entr(ies) from ${relative}: ${plan.removed.join(', ')}`);
    if (fix) {
      applied += 1;
    }
  }

  const totalEntries = plans.reduce((sum, plan) => sum + plan.removed.length, 0);
  const summary = fix
    ? `align-gitignore-standard: rewrote ${applied} file(s), removed ${totalEntries} over-reaching entr(ies)`
    : `align-gitignore-standard: ${plans.length} file(s) would change, ${totalEntries} over-reaching entr(ies) (dry run; pass --fix)`;
  process.stdout.write(`${lines.join('\n')}${lines.length > 0 ? '\n' : ''}${summary}\n`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (import.meta.url === entryUrl) {
  main();
}
