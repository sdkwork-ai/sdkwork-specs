#!/usr/bin/env node

/**
 * Workspace env file shape check: canonical key names, no duplicate keys, no
 * unresolved `${...}` interpolation. Secret values are owned by
 * `validate-access-token-files.mjs` and deployment secret managers.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', '.tmp']);

function parseArgs(argv) {
  const options = { workspace: process.cwd(), check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check') {
      options.check = true;
      continue;
    }
    if (token === '--workspace') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) throw new Error('--workspace requires a value.');
      options.workspace = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported env file standard option: ${token}`);
  }
  return options;
}

export function checkEnvFileStandard(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const issues = [];
  let files = 0;
  const walk = (dir, depth) => {
    if (depth > 7) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name.includes('.example')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }
      if (!(entry.name.startsWith('.env') || entry.name.endsWith('.env'))) continue;
      const relative = path.relative(root, fullPath).replaceAll('\\', '/');
      files += 1;
      const seen = new Map();
      const lines = readFileSync(fullPath, 'utf8').split(/\r?\n/u);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex].replace(/^export\s+/u, '');
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
        if (!match) continue;
        const [, key, value] = match;
        if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
          issues.push({ file: relative, line: lineIndex + 1, kind: 'invalid-key', key });
        }
        if (seen.has(key)) {
          issues.push({ file: relative, line: lineIndex + 1, kind: 'duplicate-key', key, firstLine: seen.get(key) });
        } else {
          seen.set(key, lineIndex + 1);
        }
        if (value.includes('${')) {
          issues.push({ file: relative, line: lineIndex + 1, kind: 'unresolved-interpolation', key });
        }
      }
    }
  };
  walk(root, 0);
  return { root, files, issues };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = checkEnvFileStandard(options.workspace);
  console.log(`env file standard: ${result.files} file(s), ${result.issues.length} issue(s)`);
  for (const issue of result.issues.slice(0, 100)) {
    console.log(`  ${issue.file}:${issue.line} ${issue.kind} ${issue.key}${issue.firstLine ? ` (first ${issue.firstLine})` : ''}`);
  }
  if (options.check && result.issues.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
