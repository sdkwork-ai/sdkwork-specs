#!/usr/bin/env node

/**
 * Enforce PC/H5 Vite build.outDir = dist/{dev|test|staging|prod}.
 * Authority: APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md §2.2,
 * FRONTEND_CODE_SPEC.md §7, tools/browser-dist-layout.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  BROWSER_DIST_ENV_ALIASES,
  resolveBrowserDistOutDir,
} from './browser-dist-layout.mjs';

const OUTDIR_HELPER = /resolveBrowserDistOutDir\s*\(/u;
const OUTDIR_LITERAL = /outDir\s*:\s*['"`]dist\/(dev|test|staging|prod)['"`]/u;
const BARE_DIST = /outDir\s*:\s*['"`]dist['"`]/u;
const BARE_DIST_JOIN = /outDir\s*:\s*path\.join\([^)]*['"`]dist['"`]\s*\)/u;

function listBrowserAppRoots(root) {
  const appsDir = path.join(root, 'apps');
  if (!fs.existsSync(appsDir)) {
    return [];
  }
  return fs.readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => (
      name.startsWith('sdkwork-')
      && (name.endsWith('-pc') || name.endsWith('-h5'))
      && fs.existsSync(path.join(appsDir, name, 'package.json'))
    ))
    .map((name) => ({
      name,
      architecture: name.endsWith('-h5') ? 'h5' : 'pc-web',
      root: path.join(appsDir, name),
      relative: `apps/${name}`,
    }));
}

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

function findViteConfig(appRoot) {
  for (const name of VITE_CONFIG_NAMES) {
    const candidate = path.join(appRoot, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  const packagesDir = path.join(appRoot, 'packages');
  if (!fs.existsSync(packagesDir)) {
    return null;
  }
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    for (const name of VITE_CONFIG_NAMES) {
      const candidate = path.join(packagesDir, entry.name, name);
      if (fs.existsSync(candidate)) {
        const source = fs.readFileSync(candidate, 'utf8');
        if (/\blib\s*:\s*\{/u.test(source)) {
          continue;
        }
        return candidate;
      }
    }
  }
  return null;
}

function checkViteConfig(filePath, label, issues) {
  const source = fs.readFileSync(filePath, 'utf8');
  if (BARE_DIST.test(source) || BARE_DIST_JOIN.test(source)) {
    issues.push(
      `${label}: bare dist/ outDir is forbidden; use dist/{dev|test|staging|prod} via resolveBrowserDistOutDir (FRONTEND_CODE_SPEC.md §7)`,
    );
    return;
  }
  if (OUTDIR_HELPER.test(source) || OUTDIR_LITERAL.test(source)) {
    return;
  }
  if (!/\boutDir\b/u.test(source)) {
    issues.push(
      `${label}: Vite build.outDir missing; MUST resolve to dist/<envAlias> (${Object.values(BROWSER_DIST_ENV_ALIASES).join('|')})`,
    );
    return;
  }
  issues.push(
    `${label}: build.outDir must use resolveBrowserDistOutDir(environment) or a literal dist/{dev|test|staging|prod}`,
  );
}

export function checkBrowserDistLayout(root) {
  const issues = [];
  const apps = listBrowserAppRoots(root);
  const hasPc = apps.some((app) => app.architecture === 'pc-web');
  const hasH5 = apps.some((app) => app.architecture === 'h5');
  if (hasPc && hasH5) {
    const pcRoots = new Set(apps.filter((app) => app.architecture === 'pc-web').map((app) => app.relative));
    const h5Roots = new Set(apps.filter((app) => app.architecture === 'h5').map((app) => app.relative));
    for (const pc of pcRoots) {
      for (const h5 of h5Roots) {
        if (pc === h5) {
          issues.push('PC and H5 application roots must remain distinct directories');
        }
      }
    }
  }
  for (const app of apps) {
    const viteConfig = findViteConfig(app.root);
    if (!viteConfig) {
      continue;
    }
    checkViteConfig(viteConfig, `${app.relative} (${path.relative(root, viteConfig)})`, issues);
  }
  // Sanity: helper aliases stay stable.
  for (const [environment, alias] of Object.entries(BROWSER_DIST_ENV_ALIASES)) {
    const expected = `dist/${alias}`;
    if (resolveBrowserDistOutDir(environment) !== expected) {
      issues.push(`browser-dist-layout helper mismatch for ${environment}`);
    }
  }
  return issues;
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      root: { type: 'string', default: '.' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/check-browser-dist-layout.mjs --root <deployable-root>');
    return;
  }
  const root = path.resolve(values.root);
  const issues = checkBrowserDistLayout(root);
  if (issues.length > 0) {
    console.error(`browser dist layout failed for ${root}`);
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }
  console.log(`browser dist layout passed for ${root}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
