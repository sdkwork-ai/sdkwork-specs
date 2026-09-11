#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { alignConsumerSdkAliasPaths } from './lib/align-consumer-sdk-alias-paths.mjs';
import { materializeMissingComposedFacades } from './lib/materialize-composed-sdk-facades.mjs';
import {
  findViolationsInText,
  isConsumerSourcePath,
  listWorkspaceRepos,
  walkFiles,
} from './lib/app-sdk-consumer-import-patterns.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findMissingComposedFacades(workspace) {
  const missing = [];
  for (const repoRoot of listWorkspaceRepos(workspace)) {
    const sdksDir = path.join(repoRoot, 'sdks');
    if (!fs.existsSync(sdksDir)) continue;
    for (const family of fs.readdirSync(sdksDir, { withFileTypes: true })) {
      if (!family.isDirectory()) continue;
      const familyRoot = path.join(sdksDir, family.name);
      for (const entry of fs.readdirSync(familyRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.endsWith('-typescript')) continue;
        const typescriptRoot = path.join(familyRoot, entry.name);
        const packageJsonPath = path.join(typescriptRoot, 'package.json');
        const facadePath = path.join(typescriptRoot, 'src/index.ts');
        if (!fs.existsSync(packageJsonPath) || fs.existsSync(facadePath)) continue;
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (!String(pkg.name ?? '').startsWith('@sdkwork/')) continue;
        missing.push({ file: facadePath, legacy: pkg.name, scoped: `${typescriptRoot}/src/index.ts`, kind: 'missing-composed-facade' });
      }
    }
  }
  return missing;
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string', default: path.resolve(SPECS_ROOT, '..') },
      repo: { type: 'string' },
      'align-alias-paths': { type: 'boolean', default: false },
      'materialize-facades': { type: 'boolean', default: false },
    },
  });

  const workspace = path.resolve(values.workspace);
  const repos = values.repo
    ? [path.resolve(values.repo)]
    : listWorkspaceRepos(workspace);

  if (values['materialize-facades']) {
    const created = materializeMissingComposedFacades(workspace);
    for (const filePath of created) console.log(`materialized ${filePath}`);
    console.log(`materialized ${created.length} composed facade(s)`);
  }

  if (values['align-alias-paths']) {
    const changed = alignConsumerSdkAliasPaths(workspace);
    for (const filePath of changed) console.log(`aligned ${filePath}`);
    console.log(`aligned ${changed.length} consumer alias file(s)`);
  }

  const violations = [...findMissingComposedFacades(workspace)];
  const unreadable = [];
  for (const repoRoot of repos) {
    for (const filePath of walkFiles(repoRoot, isConsumerSourcePath)) {
      // A directory listing can yield entries that cannot be opened: dangling pnpm workspace
      // links, and build artifacts removed by a concurrent build. `readFileSync` used to throw
      // here, which aborted the whole gate with an unhandled ENOENT — and because
      // `check-sdk-standard.mjs` spawns this tool, it aborted that gate too, turning a
      // measurable finding list into a stack trace. An unreadable file is reported, not fatal.
      let text;
      try {
        text = fs.readFileSync(filePath, 'utf8');
      } catch (error) {
        unreadable.push(`${filePath}: ${error.code ?? error.message}`);
        continue;
      }
      violations.push(...findViolationsInText(text, filePath));
    }
  }

  if (unreadable.length > 0) {
    console.error(`skipped ${unreadable.length} unreadable path(s) (dangling link or removed artifact):`);
    for (const entry of unreadable.slice(0, 10)) console.error(`  ${entry}`);
  }

  if (violations.length === 0) {
    console.log('app SDK consumer import checks passed');
    return;
  }

  console.error(`app SDK consumer import checks failed (${violations.length} violation(s)):`);
  for (const violation of violations.slice(0, 100)) {
    console.error(`- ${violation.file}: [${violation.kind}] ${violation.legacy} -> use ${violation.scoped}`);
  }
  if (violations.length > 100) {
    console.error(`... and ${violations.length - 100} more`);
  }
  process.exit(1);
}

main();
