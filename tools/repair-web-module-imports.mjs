#!/usr/bin/env node
// Repairs `use` lines that the first codemod pass deleted wholesale instead of
// surgically removing `ComposedApiAssembly` from the brace list.
//
// For every git-tracked .rs file with local modifications it compares the
// working copy against HEAD, finds removed `use <path>::{a, b, ...};` lines and
// reinstates every name that is no longer imported in the working copy.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE = process.argv[2] || 'E:/sdkwork-space';
const APPLY = process.env.WM_REPAIR_APPLY !== '0';

function git(repo, args) {
  try {
    return execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

function listRepos() {
  return readdirSync(WORKSPACE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(WORKSPACE, entry.name))
    .filter((repo) => existsSync(path.join(repo, '.git')));
}

const USE_LINE = /^-use\s+([\w:]+)::\{([^}]*)\};\s*$/;
const USE_LINE_SINGLE = /^-use\s+([\w:]+)::([\w]+);\s*$/;
// A `use` spanning several lines is removed as
//   -use path::{
//   -    a, b,
//   -};
// so the brace list has to be accumulated across consecutive removed lines.
const USE_BLOCK_OPEN = /^-use\s+([\w:]+)::\{\s*$/;
const USE_BLOCK_CLOSE = /^-\s*\};\s*$/;

function remember(lost, file, mod, name) {
  if (!name) return;
  if (!lost.has(file)) lost.set(file, new Set());
  lost.get(file).add(`${mod}::${name}`);
}

const report = [];

for (const repo of listRepos()) {
  const status = git(repo, ['status', '--porcelain', '--', '*.rs']);
  if (!status.trim()) continue;

  const diff = git(repo, ['diff', '-U0', '--', '*.rs']);
  if (!diff.trim()) continue;

  const lost = new Map(); // file -> Set("path::name")
  let current = null;
  let block = null; // module path while accumulating a multi-line `use`
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice(6);
      block = null;
      continue;
    }
    if (line.startsWith('+++ ') || !line.startsWith('-')) {
      if (block) block = null;
      continue;
    }
    if (line.startsWith('---')) continue;
    if (!current) continue;

    if (block) {
      if (USE_BLOCK_CLOSE.test(line)) {
        block = null;
      } else {
        for (const raw of line.slice(1).split(',')) {
          remember(lost, current, block, raw.trim().replace(/^pub\s+/, ''));
        }
      }
      continue;
    }
    const blockOpen = line.match(USE_BLOCK_OPEN);
    if (blockOpen) {
      block = blockOpen[1];
      continue;
    }

    const braced = line.match(USE_LINE);
    if (braced) {
      const [, mod, names] = braced;
      for (const raw of names.split(',')) {
        const name = raw.trim().replace(/^pub\s+/, '');
        if (!name) continue;
        if (!lost.has(current)) lost.set(current, new Set());
        lost.get(current).add(`${mod}::${name}`);
      }
      continue;
    }
    const single = line.match(USE_LINE_SINGLE);
    if (single) {
      const [, mod, name] = single;
      if (!lost.has(current)) lost.set(current, new Set());
      lost.get(current).add(`${mod}::${name}`);
    }
  }

  for (const [file, names] of lost) {
    const abs = path.join(repo, file);
    if (!existsSync(abs)) continue;
    const source = readFileSync(abs, 'utf8');

    // Keep only the names that are referenced in the body but no longer imported.
    const missing = [];
    for (const item of names) {
      const idx = item.lastIndexOf('::');
      const mod = item.slice(0, idx);
      const name = item.slice(idx + 2);
      if (name === 'ComposedApiAssembly') continue;
      if (!new RegExp(`\\b${name}\\b`).test(source)) continue;
      if (new RegExp(`^use\\s+${mod.replace(/::/g, '::')}::\\{[^}]*\\b${name}\\b[^}]*\\};`, 'm').test(source))
        continue;
      if (new RegExp(`^use\\s+${mod}::${name}\\s*;`, 'm').test(source)) continue;
      missing.push(`${mod}::${name}`);
    }
    if (missing.length === 0) continue;

    const byModule = new Map();
    for (const item of missing) {
      const idx = item.lastIndexOf('::');
      const mod = item.slice(0, idx);
      const name = item.slice(idx + 2);
      if (!byModule.has(mod)) byModule.set(mod, new Set());
      byModule.get(mod).add(name);
    }

    let updated = source;
    for (const [mod, addNames] of byModule) {
      const escaped = mod.replace(/[:]/g, ':');
      const bracedRe = new RegExp(`^use\\s+${escaped}::\\{([^}]*)\\};\\s*$`, 'm');
      if (bracedRe.test(updated)) {
        updated = updated.replace(bracedRe, (full, list) => {
          const merged = [
            ...list
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
            ...addNames,
          ];
          merged.sort((a, b) => a.localeCompare(b));
          return `use ${mod}::{${merged.join(', ')}};`;
        });
        continue;
      }
      const singleRe = new RegExp(`^use\\s+${escaped}::(\\w+);\\s*$`, 'm');
      const singleMatch = updated.match(singleRe);
      if (singleMatch) {
        const merged = [singleMatch[1], ...addNames];
        merged.sort((a, b) => a.localeCompare(b));
        updated = updated.replace(singleRe, `use ${mod}::{${merged.join(', ')}};`);
        continue;
      }
      const anchor = updated.match(/^use [^\n;]*;\n/m);
      const sorted = [...addNames].sort((a, b) => a.localeCompare(b));
      const line = `use ${mod}::{${sorted.join(', ')}};\n`;
      updated = anchor
        ? updated.slice(0, anchor.index) + line + updated.slice(anchor.index)
        : line + updated;
    }

    if (updated === source) continue;
    report.push({ repo: path.basename(repo), file, names: [...missing] });
    if (APPLY) writeFileSync(abs, updated);
  }
}

if (report.length === 0) {
  console.log('Web module import repair: nothing to fix');
} else {
  console.log(`Web module import repair: ${report.length} file(s) repaired${APPLY ? '' : ' (dry run)'}`);
  for (const item of report) {
    console.log(`  ${item.repo}/${item.file}: ${item.names.join(', ')}`);
  }
}
