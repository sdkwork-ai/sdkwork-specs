#!/usr/bin/env node

/**
 * Point each workspace module at the shared release access-token pre-commit
 * hook. Existing custom hooksPath values are left untouched unless --force.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = path.resolve(process.argv[2] ?? '..');
const force = process.argv.includes('--force');
const specsHooks = path.join(workspace, 'sdkwork-specs', '.githooks');
if (!existsSync(specsHooks)) {
  console.error(`shared hooks directory is missing: ${specsHooks}`);
  process.exit(1);
}

let installed = 0;
let skipped = 0;
for (const entry of readdirSync(workspace, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'sdkwork-specs') continue;
  const repoRoot = path.join(workspace, entry.name);
  if (!existsSync(path.join(repoRoot, '.git'))) continue;
  if (!existsSync(path.join(repoRoot, 'etc', 'sdkwork.deployment.config.json'))) continue;
  const current = (() => {
    try {
      return execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  })();
  if (current && !force) {
    skipped += 1;
    continue;
  }
  execFileSync('git', ['config', 'core.hooksPath', '../sdkwork-specs/.githooks'], { cwd: repoRoot, stdio: 'ignore' });
  installed += 1;
}
console.log(`release-token hooks: installed=${installed} skipped=${skipped}`);
