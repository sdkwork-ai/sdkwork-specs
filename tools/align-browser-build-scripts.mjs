#!/usr/bin/env node

/**
 * Align repository and app-surface browser build scripts to PNPM_SCRIPT_SPEC.md §4.2.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  STANDARD_ENVIRONMENT_ALIASES,
  canonicalAppSurfaceBuildCommand,
  canonicalRootBuildCommand,
  discoverBrowserAppRoots,
  standardRootBuildScript,
} from './build-browser-client.mjs';
import { declaredDeploymentProfiles } from './check-browser-build-scripts.mjs';
import { checkBrowserDistLayout } from './check-browser-dist-layout.mjs';

const VITE_OUTDIR_IMPORT = "import { resolveBrowserDistOutDir } from '../../../../sdkwork-specs/tools/browser-dist-layout.mjs';\n";
const VITE_OUTDIR_HELPER = `function resolveViteEnvironment(mode: string | undefined, processEnv = process.env) {
  const profileMatch = /^(standalone|cloud)\\.(development|test|staging|demo|production)$/u.exec(mode ?? '');
  const environment = profileMatch?.[2]
    ?? (['development', 'test', 'staging', 'demo', 'production'].includes(processEnv.SDKWORK_ENVIRONMENT ?? '')
      ? (processEnv.SDKWORK_ENVIRONMENT ?? 'production')
      : 'production');
  return environment;
}

function resolveViteDeploymentProfile(mode, processEnv = process.env) {
  const profileMatch = /^(standalone|cloud)\\./u.exec(mode ?? '');
  return profileMatch?.[1]
    ?? processEnv.SDKWORK_DEPLOYMENT_PROFILE
    ?? 'standalone';
}
`;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function findViteConfig(appRoot) {
  for (const name of ['vite.config.ts', 'vite.config.mjs', 'vite.config.js']) {
    const candidate = path.join(appRoot, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function alignViteOutDir(appRoot, dryRun) {
  const viteConfig = findViteConfig(appRoot);
  if (!viteConfig) {
    return false;
  }
  let source = fs.readFileSync(viteConfig, 'utf8');
  if (/resolveBrowserDistOutDir\s*\(/u.test(source)) {
    return false;
  }
  if (/outDir\s*:\s*['"`]dist['"`]/u.test(source)) {
    if (!source.includes('resolveBrowserDistOutDir')) {
      source = `${VITE_OUTDIR_IMPORT}\n${source}`;
    }
    if (!source.includes('function resolveViteEnvironment')) {
      source = source.replace(
        /export default defineConfig\(\(\{ command, mode \}\) => \{/u,
        `${VITE_OUTDIR_HELPER}\nexport default defineConfig(({ command, mode }) => {`,
      );
    }
    source = source.replace(
      /outDir\s*:\s*['"`]dist['"`]/u,
      'outDir: resolveBrowserDistOutDir(resolveViteEnvironment(mode, env), resolveViteDeploymentProfile(mode, env))',
    );
    if (!dryRun) {
      fs.writeFileSync(viteConfig, source, 'utf8');
    }
    return true;
  }
  return false;
}

function ensureCheckScript(rootScripts, root) {
  const scriptName = 'check:browser-build-scripts';
  if (rootScripts[scriptName]) {
    return false;
  }
  const siblingSpecs = path.join(root, '..', 'sdkwork-specs', 'tools', 'check-browser-build-scripts.mjs');
  const nestedSpecs = path.join(root, 'sdkwork-specs', 'tools', 'check-browser-build-scripts.mjs');
  if (fs.existsSync(siblingSpecs)) {
    rootScripts[scriptName] = 'node ../sdkwork-specs/tools/check-browser-build-scripts.mjs --root .';
  } else if (fs.existsSync(nestedSpecs)) {
    rootScripts[scriptName] = 'node sdkwork-specs/tools/check-browser-build-scripts.mjs --root .';
  } else {
    rootScripts[scriptName] = 'node ../sdkwork-specs/tools/check-browser-build-scripts.mjs --root .';
  }
  return true;
}

export function alignBrowserBuildScripts(root, options = {}) {
  const dryRun = options.dryRun === true;
  const changes = [];
  const apps = discoverBrowserAppRoots(root);
  if (apps.length === 0) {
    return changes;
  }

  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return changes;
  }
  const manifest = readJson(packagePath);
  manifest.scripts ??= {};
  let rootChanged = false;

  const architectures = [...new Set(apps.map((app) => app.architecture))];
  const profiles = declaredDeploymentProfiles(root);
  for (const architecture of architectures) {
    for (const environmentAlias of STANDARD_ENVIRONMENT_ALIASES) {
      for (const deploymentProfile of profiles) {
        const scriptName = standardRootBuildScript(architecture, environmentAlias, deploymentProfile);
        const command = canonicalRootBuildCommand(root, architecture, environmentAlias, deploymentProfile);
        if (manifest.scripts[scriptName] !== command) {
          manifest.scripts[scriptName] = command;
          rootChanged = true;
          changes.push(`${scriptName}`);
        }
      }
    }
  }

  if (ensureCheckScript(manifest.scripts, root)) {
    rootChanged = true;
    changes.push('check:browser-build-scripts');
  }

  if (rootChanged && !dryRun) {
    writeJson(packagePath, manifest);
  }

  for (const app of apps) {
    const appPackagePath = path.join(app.root, 'package.json');
    const appManifest = readJson(appPackagePath);
    appManifest.scripts ??= {};
    let appChanged = false;
    for (const environmentAlias of STANDARD_ENVIRONMENT_ALIASES) {
      for (const deploymentProfile of profiles) {
        const scriptName = deploymentProfile === 'standalone'
          ? `build:${environmentAlias}`
          : `build:${environmentAlias}:${deploymentProfile}`;
        const command = canonicalAppSurfaceBuildCommand(app.root, environmentAlias, deploymentProfile);
        if (appManifest.scripts[scriptName] !== command) {
          appManifest.scripts[scriptName] = command;
          appChanged = true;
          changes.push(`${app.relative}#${scriptName}`);
        }
      }
    }
    if (alignViteOutDir(app.root, dryRun)) {
      appChanged = true;
      changes.push(`${app.relative}/vite.config.* outDir`);
    }
    if (appChanged && !dryRun) {
      writeJson(appPackagePath, appManifest);
    }
  }

  return changes;
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
      root: { type: 'string', default: '.' },
      workspace: { type: 'string' },
    },
  });

  if (values.help) {
    console.log('Usage: node tools/align-browser-build-scripts.mjs --root <repo>');
    console.log('       node tools/align-browser-build-scripts.mjs --workspace <sdkwork-space-root>');
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
  } else {
    targets.push(path.resolve(values.root));
  }

  let totalChanges = 0;
  for (const target of targets.sort()) {
    const changes = alignBrowserBuildScripts(target, { dryRun: values['dry-run'] });
    if (changes.length === 0) {
      continue;
    }
    totalChanges += changes.length;
    console.log(`${path.basename(target)}: ${values['dry-run'] ? 'would update' : 'updated'} ${changes.length} item(s)`);
    changes.forEach((change) => console.log(`  - ${change}`));
    const distIssues = checkBrowserDistLayout(target);
    if (distIssues.length > 0) {
      console.log(`  ! dist layout still needs manual fix (${distIssues.length} issue(s))`);
    }
  }

  if (totalChanges === 0) {
    console.log('no browser build script changes required');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
