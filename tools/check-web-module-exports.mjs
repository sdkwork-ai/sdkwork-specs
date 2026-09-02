#!/usr/bin/env node
// Verifies every `pub use <module>::{... web_module* ...}` in the workspace
// resolves to a module that actually defines that function. The codemod
// appended the new exports to the crate's first `pub use` line, which is not
// always the file that owns the generated factory.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE = process.argv[2] || 'E:/sdkwork-space';

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (['target', 'node_modules', '.git', '.workbuddy'].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.name === 'lib.rs') yield abs;
  }
}

function moduleSource(libPath, name, source) {
  const dir = path.dirname(libPath);
  // `#[path = "bootstrap.rs"] mod assembly_entry;` rebases the module file.
  const aliased = source.match(
    new RegExp(`#\\[path\\s*=\\s*"([^"]+)"\\]\\s*(?:pub\\s+)?mod\\s+${name}\\s*;`),
  );
  if (aliased) {
    try {
      return readFileSync(path.join(dir, aliased[1]), 'utf8');
    } catch {
      return null;
    }
  }
  for (const candidate of [
    path.join(dir, `${name}.rs`),
    path.join(dir, name, 'mod.rs'),
  ]) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      /* keep looking */
    }
  }
  return null;
}

const problems = [];
let checked = 0;

for (const libPath of walk(WORKSPACE)) {
  if (!/[/\\]crates[/\\]/.test(libPath)) continue;
  const source = readFileSync(libPath, 'utf8');
  const useRe = /pub\s+use\s+([A-Za-z_][\w]*)::\{([^}]*)\}\s*;/g;
  let match;
  while ((match = useRe.exec(source))) {
    const [, module, names] = match;
    const wanted = names
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /^web_module\w*$/.test(item));
    if (wanted.length === 0) continue;
    checked += wanted.length;
    const body = moduleSource(libPath, module, source);
    if (body === null) {
      problems.push(`${path.relative(WORKSPACE, libPath)}: module '${module}' not found (${wanted.join(', ')})`);
      continue;
    }
    for (const name of wanted) {
      if (!new RegExp(`(pub\\s+)?(async\\s+)?fn\\s+${name}\\s*[(\\<]`).test(body)) {
        problems.push(
          `${path.relative(WORKSPACE, libPath)}: '${module}' does not define ${name}`,
        );
      }
    }
  }
}

console.log(`Web module export resolution: ${checked} export(s) checked`);
if (problems.length === 0) {
  console.log('Web module export resolution check passed');
} else {
  console.log(`${problems.length} problem(s):`);
  for (const item of problems) console.log(`  ${item}`);
  process.exitCode = 1;
}
