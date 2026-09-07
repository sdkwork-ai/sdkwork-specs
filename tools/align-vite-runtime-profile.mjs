#!/usr/bin/env node
/**
 * Aligns every Adaptive Web PC/H5 vite.config.ts with the shared
 * sdkwork-specs runtime-profile module (ENVIRONMENT_SPEC §5.1.0.2).
 *
 * Replaces local `resolveViteEnvironment` copies (which drifted — 70+ apps
 * missed the `demo` lifecycle environment) with an import from
 * `sdkwork-specs/tools/vite-runtime-profile.mjs`, and replaces hard-coded
 * lucide-react entry filenames with the probing resolver.
 *
 * Usage:
 *   node align-vite-runtime-profile.mjs --workspace E:/sdkwork-space           # dry-run report
 *   node align-vite-runtime-profile.mjs --workspace E:/sdkwork-space --write   # apply
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = { workspace: process.cwd(), write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--write') options.write = true;
    else if (token === '--workspace') { options.workspace = path.resolve(argv[index + 1]); index += 1; }
    else throw new Error(`unsupported option: ${token}`);
  }
  return options;
}

// Relative depth from apps/<app>/vite.config.ts to sdkwork-specs/tools.
function specsImportPath(appDir, workspaceRoot) {
  const rel = path.relative(appDir, path.join(workspaceRoot, 'sdkwork-specs', 'tools'));
  return rel.replaceAll('\\', '/') || '.';
}

function transformSource(src, relSpecsPath, appDir) {
  let changed = src;
  const notes = [];

  // 1. Replace local resolveViteEnvironment with shared import.
  const localFn = /function\s+resolveViteEnvironment\s*\([^)]*\)\s*\{[\s\S]*?\n\}/u;
  const hasLocal = localFn.test(changed);
  const hasImport = /from\s+'[^']*vite-runtime-profile\.mjs'/u.test(changed)
    || /from\s+"[^"]*vite-runtime-profile\.mjs"/u.test(changed);
  if (hasLocal && !hasImport) {
    const importLine = `import { resolveViteEnvironment, resolveLucideReactEntry } from '${relSpecsPath}/vite-runtime-profile.mjs';\n`;
    changed = changed.replace(localFn, '');
    // Insert the import after the first existing import line (or at top).
    const firstImport = /^import\s[^;]+;\s*$/mu.exec(changed);
    if (firstImport) {
      const idx = firstImport.index;
      changed = changed.slice(0, idx) + importLine + changed.slice(idx);
    } else {
      changed = importLine + changed;
    }
    notes.push('replaced local resolveViteEnvironment with shared module import');
  }

  // 2. Replace hard-coded lucide-react entry with probing resolver.
  const lucideDecl = /const\s+appLucideReactEntry\s*=\s*path\.resolve\(\s*__dirname,\s*'node_modules\/lucide-react\/dist\/esm\/lucide-react\.(?:js|mjs)',?\s*\);/u;
  if (lucideDecl.test(changed)) {
    const replacement = hasLucideResolver(changed)
      ? undefined
      : `const appLucideReactEntry = resolveLucideReactEntry(__dirname);`;
    if (replacement) {
      changed = changed.replace(lucideDecl, replacement);
      notes.push('lucide-react entry now probed via resolveLucideReactEntry');
    }
  }
  return { changed, notes };
}

function hasLucideResolver(src) {
  return /resolveLucideReactEntry\(/u.test(src);
}

function main() {
  const { workspace, write } = parseArgs(process.argv.slice(2));
  const repos = readdirSync(workspace)
    .filter(n => n.startsWith('sdkwork-') && statSync(path.join(workspace, n)).isDirectory());
  const changedFiles = [];
  for (const repo of repos) {
    const appsDir = path.join(workspace, repo, 'apps');
    if (!existsSync(appsDir)) continue;
    for (const app of readdirSync(appsDir)) {
      const appDir = path.join(appsDir, app);
      const cfg = path.join(appDir, 'vite.config.ts');
      if (!existsSync(cfg)) continue;
      const src = readFileSync(cfg, 'utf8');
      const relSpecsPath = specsImportPath(appDir, workspace);
      const { changed, notes } = transformSource(src, relSpecsPath, appDir);
      if (changed !== src) {
        if (write) writeFileSync(cfg, changed, 'utf8');
        changedFiles.push(`${repo}/apps/${app}: ${notes.join('; ')}`);
      }
    }
  }
  console.log(changedFiles.join('\n'));
  console.log(`\n${changedFiles.length} files ${write ? 'updated' : 'need update'} (workspace: ${workspace}, mode: ${write ? 'WRITE' : 'DRY-RUN'})`);
}

main();
