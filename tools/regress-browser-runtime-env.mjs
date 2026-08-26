#!/usr/bin/env node

/**
 * Regression: materialize + validate every Adaptive Web app profile across a
 * workspace (standalone same-origin `/`; cloud unified `api-*` edge), and
 * dry-run the canonical build command for each declared profile.
 *
 * Usage:
 *   node tools/regress-browser-runtime-env.mjs --workspace <sdkwork-space-root>
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { buildBrowserClient, discoverBrowserAppRoots, materializeBrowserRuntimeEnv } from './build-browser-client.mjs';

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function declaredProfiles(repositoryRoot) {
  const manifestPath = path.join(repositoryRoot, 'sdkwork.app.config.json');
  if (fs.existsSync(manifestPath)) {
    const profiles = readJson(manifestPath).runtime?.supportedDeploymentProfiles;
    if (Array.isArray(profiles) && profiles.length > 0) {
      const normalized = [...new Set(profiles.map((profile) => String(profile).trim()))]
        .filter((profile) => ['standalone', 'cloud'].includes(profile));
      if (normalized.length > 0) return normalized;
    }
  }
  return ['standalone', 'cloud'];
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h' },
      workspace: { type: 'string', required: true },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/regress-browser-runtime-env.mjs --workspace <sdkwork-space-root>');
    return;
  }
  const workspaceRoot = path.resolve(values.workspace);
  const failures = [];
  let appsChecked = 0;
  let profilesValidated = 0;
  let buildsPlanned = 0;

  for (const repo of fs.readdirSync(workspaceRoot).filter((name) => name.startsWith('sdkwork-')).sort()) {
    const repositoryRoot = path.join(workspaceRoot, repo);
    if (!fs.existsSync(path.join(repositoryRoot, 'apps'))) continue;
    const profiles = declaredProfiles(repositoryRoot);
    const appEntries = discoverBrowserAppRoots(repositoryRoot);
    if (appEntries.length === 0) continue;
    for (const app of appEntries) {
      const appRoot = app.root;
      const appName = app.name;
      const depCfgPath = path.join(appRoot, 'etc', 'sdkwork.deployment.config.json');
      if (!fs.existsSync(depCfgPath)) {
        failures.push(`${repo}/${appName}: missing app deployment config`);
        continue;
      }
      const declared = Object.keys(readJson(depCfgPath).profiles ?? {});
      const expected = profiles.flatMap((profile) =>
        ENVIRONMENTS.map((environment) => `${profile}.${environment}`),
      );
      for (const profileId of expected) {
        if (!declared.includes(profileId)) {
          failures.push(`${repo}/${appName}: missing profile ${profileId}`);
          continue;
        }
        const [deploymentProfile, environment] = profileId.split('.');
        try {
          materializeBrowserRuntimeEnv({
            appRoot,
            deploymentProfile,
            environment,
            repositoryRoot,
          });
          profilesValidated += 1;
        } catch (error) {
          failures.push(`${repo}/${appName} ${profileId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      appsChecked += 1;
      for (const deploymentProfile of profiles) {
        try {
          buildBrowserClient({
            architecture: appName.endsWith('-h5') ? 'h5' : 'pc',
            deploymentProfile,
            dryRun: true,
            environment: 'prod',
            repositoryRoot,
          });
          buildsPlanned += 1;
        } catch (error) {
          failures.push(`${repo}/${appName} dry-run ${deploymentProfile}.production: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  console.log(`apps checked: ${appsChecked}`);
  console.log(`profiles materialized + validated: ${profilesValidated}`);
  console.log(`build plans dry-run: ${buildsPlanned}`);
  console.log(`failures: ${failures.length}`);
  for (const failure of failures.slice(0, 50)) {
    console.log(`  - ${failure}`);
  }
  process.exitCode = failures.length > 0 ? 1 : 0;
}

main();
