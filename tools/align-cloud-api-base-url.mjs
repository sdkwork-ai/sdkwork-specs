#!/usr/bin/env node

/**
 * Align etc/sdkwork.deployment.config.json cloudApiBaseUrl values to every
 * registered platform.api-gateway host declared in specs/topology.spec.json
 * (same host set as deployments/webserver nginx sidecars).
 *
 * Usage:
 *   node tools/align-cloud-api-base-url.mjs --workspace <sdkwork-space-root>
 *   node tools/align-cloud-api-base-url.mjs --root <repo> [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  deriveCloudApiBaseUrlFromTopology,
  ENVIRONMENTS,
  readRepositoryTopology,
} from './browser-cloud-api-base.mjs';
import { discoverBrowserAppRoots } from './build-browser-client.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function alignCloudApiBaseUrl(repositoryRoot, options = {}) {
  const dryRun = options.dryRun === true;
  const deploymentPath = path.join(repositoryRoot, 'etc', 'sdkwork.deployment.config.json');
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`deployment config missing: ${deploymentPath}`);
  }
  const deployment = readJson(deploymentPath);
  const topology = readRepositoryTopology(repositoryRoot, deployment);
  deployment.environments ??= {};
  const changes = [];

  for (const environment of ENVIRONMENTS) {
    const desired = deriveCloudApiBaseUrlFromTopology(topology, environment);
    const current = String(deployment.environments[environment]?.cloudApiBaseUrl ?? '').trim();
    if (current !== desired) {
      deployment.environments[environment] ??= {};
      deployment.environments[environment].cloudApiBaseUrl = desired;
      changes.push(`${environment}: ${current || '(missing)'} -> ${desired}`);
    }
  }

  if (changes.length > 0 && !dryRun) {
    writeJson(deploymentPath, deployment);
  }
  return changes;
}

function shouldAlignRepository(repositoryRoot) {
  if (!fs.existsSync(path.join(repositoryRoot, 'etc', 'sdkwork.deployment.config.json'))) {
    return false;
  }
  if (!fs.existsSync(path.join(repositoryRoot, 'deployments', 'webserver'))) {
    return false;
  }
  return discoverBrowserAppRoots(repositoryRoot).length > 0 || fs.existsSync(path.join(repositoryRoot, 'apps'));
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
    console.log('Usage: node tools/align-cloud-api-base-url.mjs --workspace <sdkwork-space-root>');
    console.log('       node tools/align-cloud-api-base-url.mjs --root <repo> [--dry-run]');
    return;
  }

  const targets = [];
  if (values.workspace) {
    const workspaceRoot = path.resolve(values.workspace);
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) continue;
      const repoRoot = path.join(workspaceRoot, entry.name);
      if (shouldAlignRepository(repoRoot)) targets.push(repoRoot);
    }
  } else if (values.root) {
    targets.push(path.resolve(values.root));
  } else {
    throw new Error('--root or --workspace is required');
  }

  let total = 0;
  for (const target of targets.sort()) {
    try {
      const changes = alignCloudApiBaseUrl(target, { dryRun: values['dry-run'] });
      if (changes.length === 0) continue;
      total += changes.length;
      console.log(`${path.basename(target)}: ${values['dry-run'] ? 'would update' : 'updated'} ${changes.length} environment(s)`);
      for (const change of changes) {
        console.log(`  - ${change}`);
      }
    } catch (error) {
      console.log(`${path.basename(target)}: SKIPPED (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (total === 0) {
    console.log('no cloudApiBaseUrl changes required');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
