#!/usr/bin/env node
// Normalizes indentation of the `ApiModuleRegistry` blocks emitted by the
// web-module codemod. Some hosts were rewritten in expression position, where
// the generated `module_registry.add_modules(..)` / `Ok(` lines landed at
// column 0 while the rest of the chain kept the original indent.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE = process.argv[2] || 'E:/sdkwork-space';
const APPLY = process.env.WM_REPAIR_APPLY !== '0';

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'target' || entry.name === 'node_modules' || entry.name === '.git') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.name.endsWith('.rs')) yield abs;
  }
}

const repaired = [];

for (const file of walk(WORKSPACE)) {
  const source = readFileSync(file, 'utf8');
  if (!/ApiModuleRegistry/.test(source)) continue;

  const lines = source.split('\n');
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([ \t]*)let\s+mut\s+module_registry\s*=\s*ApiModuleRegistry::new\(\);\s*$/);
    if (!match) continue;
    const indent = match[1];

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim() === '') continue;
      // Stop once we reach a line that already carries the block indent.
      if (line.startsWith(indent) && line.trim() !== '') {
        if (/^\s*[)\]}]/.test(line)) break;
        if (line.startsWith(`${indent}    `) || line.startsWith(`${indent}\t`)) break;
      }
      if (!/^(?:module_registry\s*\..*|Ok\(\s*)$/.test(line)) break;
      lines[cursor] = indent + line;
      changed = true;
    }
  }

  if (!changed) continue;
  const updated = lines.join('\n');
  if (updated === source) continue;
  repaired.push(path.relative(WORKSPACE, file));
  if (APPLY) writeFileSync(file, updated);
}

if (repaired.length === 0) {
  console.log('Web module indent repair: nothing to fix');
} else {
  console.log(`Web module indent repair: ${repaired.length} file(s) fixed${APPLY ? '' : ' (dry run)'}`);
  for (const item of repaired) console.log(`  ${item}`);
}
