#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepositoryTailwindIntegration } from './lib/tailwind-integration-patterns.mjs';
import { listWorkspaceRepositoryRoots } from './lib/workspace-check-runner.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { mode: 'root', target: process.cwd() };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      args.mode = 'root';
      args.target = path.resolve(argv[++index]);
    } else if (arg === '--workspace') {
      args.mode = 'workspace';
      args.target = path.resolve(argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node tools/check-tailwind-integration.mjs --root <repository-root>',
    '  node tools/check-tailwind-integration.mjs --workspace <multi-repo-checkout-root>',
  ].join('\n');
}

function listWorkspaceRepositories(workspaceRoot) {
  // Governed repositories are `sdkwork-*` checkouts that carry an AGENTS.md; this
  // is the same enumeration every other fleet gate uses. Third-party checkouts
  // that merely sit in the workspace root (for example the NousResearch
  // `hermes-agent` clone or `deepseek-harness-*`) are not SDKWork repositories
  // and MUST NOT be governed by the SDKWork Tailwind integration standard.
  return listWorkspaceRepositoryRoots(workspaceRoot);
}

function fail(message, details = []) {
  console.error(`tailwind integration failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail.kind}: ${detail.detail}`);
  }
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const specPath = path.join(SPECS_ROOT, 'TAILWIND_CSS_INTEGRATION_SPEC.md');
  if (!fs.existsSync(specPath)) {
    fail('missing TAILWIND_CSS_INTEGRATION_SPEC.md');
  }

  const repoRoots = args.mode === 'workspace'
    ? listWorkspaceRepositories(args.target)
    : [args.target];

  const allIssues = [];
  for (const repoRoot of repoRoots) {
    allIssues.push(...scanRepositoryTailwindIntegration(repoRoot).map((issue) => ({
      ...issue,
      detail: `[${path.basename(repoRoot)}] ${issue.detail}`,
    })));
  }

  if (allIssues.length > 0) {
    fail(`found ${allIssues.length} issue(s)`, allIssues);
  }

  console.log(`tailwind integration passed (${repoRoots.length} repository root(s))`);
}

main();
