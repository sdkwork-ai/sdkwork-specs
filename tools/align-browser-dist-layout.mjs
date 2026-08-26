#!/usr/bin/env node

/**
 * Align Vite outDir to dist/{dev,test,staging,prod} for Adaptive Web app roots.
 * Authority: FRONTEND_CODE_SPEC.md §7.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { discoverBrowserAppRoots } from './build-browser-client.mjs';
import { checkBrowserDistLayout } from './check-browser-dist-layout.mjs';

const SPECS_RELATIVE = '../../../../sdkwork-specs/tools/browser-dist-layout.mjs';
const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.web.ts',
  'vite.config.web.mjs',
  'vite.config.browser.ts',
  'vite.config.browser.mjs',
];

function computeImportPath(appRoot) {
  const specsPath = path.join(appRoot, SPECS_RELATIVE);
  if (fs.existsSync(specsPath)) {
    return SPECS_RELATIVE;
  }
  return path.relative(appRoot, path.join(appRoot, '..', '..', '..', 'sdkwork-specs', 'tools', 'browser-dist-layout.mjs')).replaceAll('\\', '/');
}

function alignViteConfig(appRoot, dryRun) {
  const viteConfig = VITE_CONFIG_NAMES
    .map((name) => path.join(appRoot, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!viteConfig) {
    return false;
  }

  let source = fs.readFileSync(viteConfig, 'utf8');
  const hasOutDirHelper = /resolveBrowserDistOutDir\s*\(/u.test(source);
  if (hasOutDirHelper && /\boutDir\b/u.test(source)) {
    return false;
  }

  const importPath = computeImportPath(appRoot);
  const importLine = `import { resolveBrowserDistOutDir } from '${importPath}';\n`;
  const helper = `function resolveViteEnvironment(mode: string | undefined, processEnv = process.env) {
  const profileMatch = /^(standalone|cloud)\\.(development|test|staging|production)$/u.exec(mode ?? '');
  return profileMatch?.[2]
    ?? (['development', 'test', 'staging', 'production'].includes(processEnv.SDKWORK_ENVIRONMENT ?? '')
      ? (processEnv.SDKWORK_ENVIRONMENT ?? 'production')
      : 'production');
}

function resolveViteDeploymentProfile(mode, processEnv = process.env) {
  const profileMatch = /^(standalone|cloud)\\./u.exec(mode ?? '');
  return profileMatch?.[1]
    ?? processEnv.SDKWORK_DEPLOYMENT_PROFILE
    ?? 'standalone';
}
`;

  let changed = false;
  if (!source.includes('resolveBrowserDistOutDir')) {
    source = `${importLine}${helper}${source}`;
    changed = true;
  }

  if (/outDir\s*:\s*['"`]dist['"`]/u.test(source)) {
    source = source.replace(
      /outDir\s*:\s*['"`]dist['"`]/u,
      'outDir: resolveBrowserDistOutDir(resolveViteEnvironment(mode, process.env), resolveViteDeploymentProfile(mode, process.env))',
    );
    changed = true;
  } else if (!/\boutDir\b/u.test(source)) {
    if (/build\s*:\s*\{/u.test(source)) {
      source = source.replace(
        /build\s*:\s*\{/u,
        'build: {\n      outDir: resolveBrowserDistOutDir(resolveViteEnvironment(mode, process.env), resolveViteDeploymentProfile(mode, process.env)),',
      );
      changed = true;
    } else if (/return\s*\{/u.test(source)) {
      source = source.replace(
        /return\s*\{/u,
        'return {\n    build: {\n      outDir: resolveBrowserDistOutDir(resolveViteEnvironment(mode, process.env), resolveViteDeploymentProfile(mode, process.env)),\n      emptyOutDir: true,\n    },',
      );
      changed = true;
    } else if (/export default defineConfig\(\{/u.test(source)) {
      source = source.replace(
        /export default defineConfig\(\{/u,
        'export default defineConfig({\n  build: {\n    outDir: resolveBrowserDistOutDir(resolveViteEnvironment(undefined, process.env), resolveViteDeploymentProfile(undefined, process.env)),\n    emptyOutDir: true,\n  },',
      );
      changed = true;
    }
  }

  if (!changed) {
    return false;
  }
  if (!dryRun) {
    fs.writeFileSync(viteConfig, source, 'utf8');
  }
  return true;
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
      root: { type: 'string' },
      workspace: { type: 'string' },
    },
  });

  if (values.help) {
    console.log('Usage: node tools/align-browser-dist-layout.mjs --workspace <sdkwork-space-root>');
    console.log('       node tools/align-browser-dist-layout.mjs --root <repo-root>');
    return;
  }

  const targets = [];
  if (values.workspace) {
    const workspaceRoot = path.resolve(values.workspace);
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) {
        continue;
      }
      const repoRoot = path.join(workspaceRoot, entry.name);
      if (discoverBrowserAppRoots(repoRoot).length > 0) {
        targets.push(repoRoot);
      }
    }
  } else if (values.root) {
    targets.push(path.resolve(values.root));
  } else {
    throw new Error('--root or --workspace is required');
  }

  let changedCount = 0;
  for (const target of targets.sort()) {
    const apps = discoverBrowserAppRoots(target);
    for (const app of apps) {
      if (alignViteConfig(app.root, values['dry-run'])) {
        changedCount += 1;
        console.log(`${path.basename(target)} ${app.relative}: vite outDir aligned`);
      }
    }
    const remaining = checkBrowserDistLayout(target);
    if (remaining.length > 0) {
      console.log(`${path.basename(target)}: ${remaining.length} dist layout issue(s) remain`);
    }
  }

  if (changedCount === 0) {
    console.log('no vite outDir changes required');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
