#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { auditAgentsProgressiveLoading } from './lib/agents-progressive-loading.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE = path.resolve(TOOL_DIR, '..', '..');

function usage() {
  return [
    'Usage: node tools/audit-agents-progressive-loading.mjs --workspace <dir> --output <manifest.json>',
    '',
    'Builds a deterministic, read-only AGENTS.md progressive-loading audit manifest.',
    'Discovery is limited to the workspace root, direct sdkwork-* .gitmodules roots,',
    'tracked agent.app.config.json roots, and tracked direct apps/* application roots.',
  ].join('\n');
}

function fail(message) {
  process.stderr.write(`agents progressive-loading audit failed: ${message}\n`);
  process.exit(1);
}

const parsed = parseArgs({
  options: {
    workspace: { type: 'string', default: DEFAULT_WORKSPACE },
    output: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
});

if (parsed.values.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

if (!parsed.values.output) {
  fail(`--output is required\n\n${usage()}`);
}

const outputPath = path.resolve(parsed.values.output);
if (path.basename(outputPath).toLowerCase() === 'agents.md') {
  fail('--output must not target AGENTS.md');
}
if (fs.existsSync(outputPath)) {
  const outputStat = fs.lstatSync(outputPath);
  if (outputStat.isSymbolicLink()) {
    fail('--output must not be a symbolic link');
  }
  const outputRealpath = fs.realpathSync(outputPath);
  if (path.basename(outputRealpath).toLowerCase() === 'agents.md') {
    fail('--output must not target AGENTS.md');
  }
}
if (path.extname(outputPath).toLowerCase() !== '.json') {
  fail('--output must name a JSON manifest');
}
if (!fs.existsSync(path.dirname(outputPath))) {
  fail(`output directory does not exist: ${path.dirname(outputPath)}`);
}

try {
  const manifest = auditAgentsProgressiveLoading(parsed.values.workspace);
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `agents progressive-loading audit wrote ${outputPath} `
    + `(${manifest.summary.repositoryCount} repositories, ${manifest.summary.targetCount} targets)\n`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
