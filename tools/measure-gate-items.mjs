#!/usr/bin/env node

/**
 * Measure one gate's item count with the matrix's own counter.
 *
 * `run-gate-matrix.mjs --update-baseline` can only refresh the whole tier, and the
 * `guardrail` tier includes gates that take minutes (`check-shell-portability`
 * measured 459s). Paying ten minutes to re-measure one gate is how a registry
 * baseline quietly drifts out of date.
 *
 * This tool runs a single gate and reports `countItems(output)` from
 * `run-gate-matrix.mjs`, so the number is produced by exactly the function the
 * matrix compares against `baseline`. Re-implementing the count here would let
 * the two drift, which is why nothing is re-implemented: the counter is imported.
 *
 * Usage:
 *   node tools/measure-gate-items.mjs <tool-file> [gate args...]
 *
 * Example:
 *   node tools/measure-gate-items.mjs check-pnpm-script-standard.mjs --workspace .
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countItems, looksLikeCrash } from './run-gate-matrix.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = path.resolve(SPECS_ROOT, '..');

function usage() {
  return [
    'Usage: node tools/measure-gate-items.mjs <tool-file> [gate args...]',
    '',
    'Prints the item count the gate matrix would compare against `baseline`.',
    'Run from the workspace root; pass the workspace with `--workspace .`.',
  ].join('\n');
}

function main() {
  const [toolFile, ...gateArgs] = process.argv.slice(2);
  if (!toolFile || toolFile === '--help' || toolFile === '-h') {
    console.log(usage());
    process.exit(toolFile ? 0 : 2);
  }

  const toolPath = path.isAbsolute(toolFile) ? toolFile : path.join(SPECS_ROOT, 'tools', toolFile);
  if (!fs.existsSync(toolPath)) {
    console.error(`measure-gate-items cannot run: no such tool: ${toolPath}`);
    process.exit(2);
  }

  // `--workspace .` is relative to the caller's cwd, so the child inherits the
  // workspace root rather than the specs directory.
  const result = spawnSync(process.execPath, [toolPath, ...gateArgs], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    console.error(`measure-gate-items cannot run: ${result.error.message}`);
    process.exit(2);
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const crashed = looksLikeCrash(output);

  console.log(`tool      : ${toolFile}`);
  console.log(`exit      : ${result.status}`);
  console.log(`crashed   : ${crashed}`);
  // A crashed gate reports 0 items; recording that as a baseline would hide the
  // real debt behind a stack trace. Refuse instead (see the skill's "崩溃 != 条目").
  console.log(`countItems: ${crashed ? 0 : countItems(output)}`);
  if (crashed) {
    console.error('gate crashed; the item count is not a debt baseline');
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
