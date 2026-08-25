#!/usr/bin/env node

/**
 * Validate Adaptive Web build:pc:* / build:h5:* and app-surface build:* scripts.
 * Authority: PNPM_SCRIPT_SPEC.md §4.2.
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

const BUILD_RUNNER = 'build-browser-client.mjs';
const DEPLOYMENT_PROFILES = Object.freeze(['standalone', 'cloud']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function usesCanonicalRunner(commandText) {
  return String(commandText).includes(BUILD_RUNNER);
}

export function checkBrowserBuildScripts(root) {
  const issues = [];
  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return [`missing package.json at ${root}`];
  }

  const apps = discoverBrowserAppRoots(root);
  if (apps.length === 0) {
    return [];
  }

  const manifest = readJson(packagePath);
  const scripts = manifest.scripts ?? {};
  const architectures = [...new Set(apps.map((app) => app.architecture))];

  for (const architecture of architectures) {
    for (const environmentAlias of STANDARD_ENVIRONMENT_ALIASES) {
      for (const deploymentProfile of DEPLOYMENT_PROFILES) {
        const scriptName = standardRootBuildScript(architecture, environmentAlias, deploymentProfile);
        const expected = canonicalRootBuildCommand(root, architecture, environmentAlias, deploymentProfile);
        if (!scripts[scriptName]) {
          issues.push(`missing required root script "${scriptName}" (${deploymentProfile} profile)`);
          continue;
        }
        const commandText = String(scripts[scriptName]);
        if (!usesCanonicalRunner(commandText)) {
          issues.push(`${scriptName}: must delegate to ${BUILD_RUNNER}`);
        } else if (!commandText.includes(`--architecture ${architecture}`) || !commandText.includes(`--environment ${environmentAlias}`)) {
          issues.push(`${scriptName}: canonical runner flags must include --architecture ${architecture} --environment ${environmentAlias}`);
        } else if (deploymentProfile !== 'standalone' && !commandText.includes(`--deployment-profile ${deploymentProfile}`)) {
          issues.push(`${scriptName}: canonical runner flags must include --deployment-profile ${deploymentProfile}`);
        }
      }
    }
  }

  for (const app of apps) {
    const appPackagePath = path.join(app.root, 'package.json');
    const appManifest = readJson(appPackagePath);
    const appScripts = appManifest.scripts ?? {};
    for (const environmentAlias of STANDARD_ENVIRONMENT_ALIASES) {
      for (const deploymentProfile of DEPLOYMENT_PROFILES) {
        const scriptName = deploymentProfile === 'standalone'
          ? `build:${environmentAlias}`
          : `build:${environmentAlias}:${deploymentProfile}`;
        const expected = canonicalAppSurfaceBuildCommand(app.root, environmentAlias, deploymentProfile);
        if (!appScripts[scriptName]) {
          issues.push(`${app.relative}: missing required app-surface script "${scriptName}" (${deploymentProfile} profile)`);
          continue;
        }
        const commandText = String(appScripts[scriptName]);
        if (!usesCanonicalRunner(commandText)) {
          issues.push(`${app.relative}#${scriptName}: must delegate to ${BUILD_RUNNER}`);
        } else if (!commandText.includes(`--environment ${environmentAlias}`)) {
          issues.push(`${app.relative}#${scriptName}: canonical runner must include --environment ${environmentAlias}`);
        } else if (deploymentProfile !== 'standalone' && !commandText.includes(`--deployment-profile ${deploymentProfile}`)) {
          issues.push(`${app.relative}#${scriptName}: canonical runner must include --deployment-profile ${deploymentProfile}`);
        }
      }
    }
  }

  return issues;
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h' },
      root: { type: 'string', default: '.' },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/check-browser-build-scripts.mjs --root <deployable-root>');
    return;
  }
  const root = path.resolve(values.root);
  const issues = checkBrowserBuildScripts(root);
  if (issues.length > 0) {
    console.error(`browser build scripts failed for ${root}`);
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }
  console.log(`browser build scripts passed for ${root}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
