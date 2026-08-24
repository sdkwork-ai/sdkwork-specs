#!/usr/bin/env node

/**
 * Workspace sweep for Adaptive Web PC/H5 build script and dist layout compliance.
 * Authority: PNPM_SCRIPT_SPEC.md §4.2–§4.3, FRONTEND_CODE_SPEC.md §7.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { discoverBrowserAppRoots } from './build-browser-client.mjs';
import { checkBrowserBuildScripts } from './check-browser-build-scripts.mjs';
import { checkBrowserDistLayout } from './check-browser-dist-layout.mjs';

function listWorkspaceRepos(workspaceRoot) {
  return fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((repoRoot) => discoverBrowserAppRoots(repoRoot).length > 0)
    .sort();
}

export function sweepBrowserBuildWorkspace(workspaceRoot) {
  const repos = listWorkspaceRepos(workspaceRoot);
  const failures = [];
  for (const repoRoot of repos) {
    const name = path.basename(repoRoot);
    const scriptIssues = checkBrowserBuildScripts(repoRoot);
    const distIssues = checkBrowserDistLayout(repoRoot);
    if (scriptIssues.length === 0 && distIssues.length === 0) {
      continue;
    }
    failures.push({
      distIssues,
      name,
      repoRoot,
      scriptIssues,
    });
  }
  return { failures, repos };
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h' },
      workspace: { type: 'string', default: '.' },
    },
  });

  if (values.help) {
    console.log('Usage: node tools/sweep-browser-build-workspace.mjs --workspace <sdkwork-space-root>');
    return;
  }

  const workspaceRoot = path.resolve(values.workspace);
  const { failures, repos } = sweepBrowserBuildWorkspace(workspaceRoot);
  console.log(`browser build sweep: ${repos.length} module(s) with Adaptive Web surfaces`);
  if (failures.length === 0) {
    console.log('all modules passed build script and dist layout checks');
    return;
  }

  for (const failure of failures) {
    console.error(`\n${failure.name}:`);
    for (const issue of failure.scriptIssues) {
      console.error(`  [scripts] ${issue}`);
    }
    for (const issue of failure.distIssues) {
      console.error(`  [dist] ${issue}`);
    }
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
