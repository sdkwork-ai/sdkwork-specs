#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { discoverRepos, readTopology } from './application-deploy-layout/discover.mjs';
import { inspectRepo } from './application-deploy-layout/inspect.mjs';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: process.cwd() },
    workspace: { type: 'string' },
  },
});

const targetRoot = path.resolve(values.root);
const workspaceRoot = values.workspace ? path.resolve(values.workspace) : targetRoot;

let repos;
if (
  !values.workspace &&
  requireExists(path.join(targetRoot, 'Cargo.toml')) &&
  requireExists(path.join(targetRoot, 'agent.app.config.json'))
) {
  repos = [targetRoot];
} else {
  repos = discoverRepos(workspaceRoot);
}

function requireExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}
let failures = 0;
let warnings = 0;

for (const repoRoot of repos) {
  const report = inspectRepo(repoRoot);
  if (!report.ok) {
    failures += 1;
    console.error(`FAIL ${report.appId} (${report.runtimeCode})`);
    for (const item of report.missing) {
      console.error(`  missing: ${item}`);
    }
  } else {
    console.log(`ok   ${report.appId} (${report.runtimeCode}) -> ${report.configRoot}config.toml`);
  }
  for (const warning of report.warnings) {
    warnings += 1;
    console.warn(`warn ${report.appId}: ${warning}`);
  }
}

console.log(`\ncheck-application-deploy-layout: ${repos.length} repos, ${failures} failing, ${warnings} warnings`);
process.exit(failures > 0 ? 1 : 0);
