#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  alignRepositoryTailwindIntegration,
  scanRepositoryTailwindIntegration,
} from './lib/tailwind-integration-patterns.mjs';
import { listWorkspaceRepositoryRoots } from './lib/workspace-check-runner.mjs';

function parseArgs(argv) {
  const args = { mode: 'root', target: process.cwd(), fix: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      args.mode = 'root';
      args.target = path.resolve(argv[++index]);
    } else if (arg === '--workspace') {
      args.mode = 'workspace';
      args.target = path.resolve(argv[++index]);
    } else if (arg === '--fix') {
      args.fix = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node tools/align-tailwind-integration.mjs --workspace <multi-repo-checkout-root> [--fix]',
    '  node tools/align-tailwind-integration.mjs --root <repository-root> [--fix]',
  ].join('\n');
}

function listWorkspaceRepositories(workspaceRoot) {
  // Only governed `sdkwork-*` repositories (those carrying an AGENTS.md) are
  // candidates; third-party checkouts in the workspace root are never rewritten.
  return listWorkspaceRepositoryRoots(workspaceRoot);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const repoRoots = args.mode === 'workspace'
    ? listWorkspaceRepositories(args.target)
    : [args.target];

  const changedFiles = [];
  for (const repoRoot of repoRoots) {
    if (args.fix) {
      changedFiles.push(...alignRepositoryTailwindIntegration(repoRoot).map((file) => `${path.basename(repoRoot)}/${file}`));
    }
  }

  const remainingIssues = [];
  for (const repoRoot of repoRoots) {
    remainingIssues.push(...scanRepositoryTailwindIntegration(repoRoot).map((issue) => ({
      ...issue,
      detail: `[${path.basename(repoRoot)}] ${issue.detail}`,
    })));
  }

  if (changedFiles.length > 0) {
    console.log(`aligned tailwind dependencies in ${changedFiles.length} package manifest(s):`);
    for (const file of changedFiles) {
      console.log(`- ${file}`);
    }
  }

  if (remainingIssues.length > 0) {
    console.error(`tailwind integration failed: found ${remainingIssues.length} issue(s)`);
    for (const issue of remainingIssues) {
      console.error(`- ${issue.kind}: ${issue.detail}`);
    }
    process.exit(1);
  }

  console.log(`tailwind integration aligned (${repoRoots.length} repository root(s))`);
}

main();
