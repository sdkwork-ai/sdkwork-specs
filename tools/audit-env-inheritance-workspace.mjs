#!/usr/bin/env node

/**
 * Audit env inheritance adoption across a SDKWork workspace.
 *
 * A repository is `inherited` when it declares
 * `etc/sdkwork.deployment.config.json` and has `etc/topology/base.env`.
 * `legacy` means it still has only flat per-profile files.
 *
 * Default mode is a report (exit 0). `--check` exits 1 when any declared
 * repository is still legacy, which is the rollout gate.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const options = { workspace: process.cwd(), check: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check') {
      options.check = true;
      continue;
    }
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--workspace') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error('--workspace requires a value.');
      }
      options.workspace = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported workspace audit option: ${token}`);
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

export function auditEnvInheritanceWorkspace(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const repos = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const repoRoot = path.join(root, entry.name);
    const deploymentConfig = path.join(repoRoot, 'etc', 'sdkwork.deployment.config.json');
    if (!existsSync(deploymentConfig)) {
      continue;
    }
    let profiles = [];
    try {
      profiles = Object.keys(readJson(deploymentConfig).profiles ?? {});
    } catch (error) {
      repos.push({
        repo: entry.name,
        status: 'invalid',
        profiles: 0,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const topologyDir = path.join(repoRoot, 'etc', 'topology');
    const base = existsSync(path.join(topologyDir, 'base.env'));
    const missingProfiles = profiles.filter(
      (profile) => !existsSync(path.join(topologyDir, `${profile}.env`)),
    );
    const overrideDir = path.join(topologyDir, 'overrides');
    const overrides = existsSync(overrideDir)
      ? readdirSync(overrideDir).filter((name) => name.endsWith('.env')).length
      : 0;
    const status = profiles.length === 0
      ? 'not-applicable'
      : missingProfiles.length > 0
        ? 'invalid'
        : base
          ? 'inherited'
          : 'legacy';
    repos.push({
      repo: entry.name,
      status,
      profiles: profiles.length,
      missingProfiles,
      overrides,
      base,
    });
  }
  repos.sort((left, right) => left.repo.localeCompare(right.repo));
  const inherited = repos.filter((repo) => repo.status === 'inherited').length;
  const legacy = repos.filter((repo) => repo.status === 'legacy').length;
  const invalid = repos.filter((repo) => repo.status === 'invalid').length;
  const notApplicable = repos.filter((repo) => repo.status === 'not-applicable').length;
  return { workspace: root, repos, inherited, legacy, invalid, notApplicable };
}

function printReport(result) {
  console.log(
    `env inheritance audit: ${result.inherited} inherited, ${result.legacy} legacy, `
    + `${result.invalid} invalid, ${result.notApplicable} not-applicable`,
  );
  for (const repo of result.repos) {
    const suffix = repo.status === 'inherited'
      ? `profiles=${repo.profiles} overrides=${repo.overrides}`
      : repo.status === 'invalid'
        ? `missing=${repo.missingProfiles.join(',')}`
        : repo.reason ?? '';
    console.log(`  ${repo.status.padEnd(13)} ${repo.repo}${suffix ? ` (${suffix})` : ''}`);
  }
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const result = auditEnvInheritanceWorkspace(options.workspace);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }
  if (
    options.check
    && (result.legacy > 0 || result.invalid > 0 || result.repos.some((repo) => repo.status === 'invalid'))
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
