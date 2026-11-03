#!/usr/bin/env node

/**
 * Workspace-wide env configuration compliance audit.
 *
 * Per repository:
 *   - deployment profile matrix and resolved profile files
 *   - inherited topology layers
 *   - resolved profile freshness (`materialize-topology-env --check`)
 *   - source-config standard
 *   - client env freshness (when the repository declares a surface)
 *   - retired `configs/` and composed `.env.*.local` names
 *   - public application access token coverage (warning until rollout completes)
 *
 * `--check` fails on structural errors; `--strict` also fails on token warnings.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { auditEnvInheritanceWorkspace } from './audit-env-inheritance-workspace.mjs';
import { auditAppAccessTokenWorkspace } from './audit-app-access-token-workspace.mjs';
import { validateAccessTokenFiles } from './validate-access-token-files.mjs';
import { materializeClientEnv } from './materialize-client-env.mjs';
import { materializeTopologyEnv } from './materialize-topology-env.mjs';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = { workspace: process.cwd(), json: false, check: false, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--check') {
      options.check = true;
      continue;
    }
    if (token === '--strict') {
      options.strict = true;
      options.check = true;
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
    throw new Error(`Unsupported env standard audit option: ${token}`);
  }
  return options;
}

function listRepos(workspaceRoot) {
  return readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((repoRoot) => existsSync(path.join(repoRoot, 'etc')) || existsSync(path.join(repoRoot, 'agent.app.config.json')));
}

function findRetiredEnvNames(repoRoot) {
  const offenders = [];
  if (existsSync(path.join(repoRoot, 'configs'))) {
    offenders.push('configs/');
  }
  const queue = [{ dir: repoRoot, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > 2) {
      continue;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'target') {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.workbuddy' || entry.name === 'dist' || entry.name === 'build') {
          continue;
        }
        queue.push({ dir: fullPath, depth: depth + 1 });
        continue;
      }
      if (/^\.env\..+\.local$/u.test(entry.name) || entry.name === '.env.local') {
        offenders.push(path.relative(repoRoot, fullPath).replaceAll('\\', '/'));
      }
    }
  }
  return offenders;
}

function runSourceConfig(repoRoot) {
  const result = spawnSync(process.execPath, [
    path.join(TOOLS_DIR, 'check-source-config-standard.mjs'),
    '--root',
    repoRoot,
  ], { encoding: 'utf8', windowsHide: true });
  return {
    ok: result.status === 0,
    message: result.status === 0 ? '' : String(result.stderr || result.stdout || '').trim().split(/\r?\n/u).filter(Boolean).slice(-1)[0] ?? 'failed',
  };
}

export function auditEnvStandardWorkspace(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const inheritance = auditEnvInheritanceWorkspace(root);
  const tokens = auditAppAccessTokenWorkspace(root);
  const tokenFiles = validateAccessTokenFiles(root);
  const invalidTokenFilesByRepo = new Map();
  for (const entry of tokenFiles.invalid) {
    const repo = entry.file.split('/')[0];
    const list = invalidTokenFilesByRepo.get(repo) ?? [];
    list.push(entry);
    invalidTokenFilesByRepo.set(repo, list);
  }
  const tokenByRepo = new Map();
  for (const app of tokens.apps) {
    const current = tokenByRepo.get(app.repo) ?? { complete: 0, partial: 0, missing: 0 };
    current[app.status] = (current[app.status] ?? 0) + 1;
    tokenByRepo.set(app.repo, current);
  }
  const appsByRepo = new Map();
  for (const app of tokens.apps) {
    appsByRepo.set(app.repo, (appsByRepo.get(app.repo) ?? 0) + 1);
  }

  const repos = [];
  for (const inheritanceRepo of inheritance.repos) {
    const repoRoot = path.join(root, inheritanceRepo.repo);
    const errors = [];
    const warnings = [];

    if (inheritanceRepo.status === 'legacy') {
      errors.push('topology: legacy flat profiles (run migrate-env-inheritance)');
    }
    if (inheritanceRepo.status === 'invalid') {
      errors.push(`topology: missing profiles ${inheritanceRepo.missingProfiles.join(',')}`);
    }
    if (inheritanceRepo.status === 'inherited') {
      try {
        materializeTopologyEnv({ root: repoRoot, check: true });
      } catch (error) {
        errors.push(`topology: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      }
    }

    if (existsSync(path.join(repoRoot, 'etc', 'client-env.materialization.json'))) {
      try {
        materializeClientEnv({ rootDir: repoRoot, check: true });
      } catch (error) {
        errors.push(`client-env: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      }
    }

    const source = runSourceConfig(repoRoot);
    if (!source.ok) {
      errors.push(`source-config: ${source.message}`);
    }

    const retired = findRetiredEnvNames(repoRoot);
    if (retired.length > 0) {
      errors.push(`retired names: ${retired.slice(0, 3).join(', ')}${retired.length > 3 ? ` (+${retired.length - 3})` : ''}`);
    }

    const invalidTokenFiles = invalidTokenFilesByRepo.get(inheritanceRepo.repo) ?? [];
    if (invalidTokenFiles.length > 0) {
      errors.push(`access-token-files: ${invalidTokenFiles.slice(0, 3).map((entry) => `${entry.file} (${entry.issues.join(',')})`).join('; ')}`);
    }

    const tokenStats = tokenByRepo.get(inheritanceRepo.repo) ?? { complete: 0, partial: 0, missing: 0 };
    const appCount = appsByRepo.get(inheritanceRepo.repo) ?? 0;
    if (appCount > 0 && (tokenStats.partial > 0 || tokenStats.missing > 0)) {
      warnings.push(`access-token: ${tokenStats.complete}/${appCount} complete, ${tokenStats.partial} partial, ${tokenStats.missing} missing`);
    }

    repos.push({
      repo: inheritanceRepo.repo,
      status: errors.length === 0 ? (warnings.length === 0 ? 'ok' : 'warn') : 'error',
      errors,
      warnings,
    });
  }

  const ok = repos.filter((repo) => repo.status === 'ok').length;
  const warn = repos.filter((repo) => repo.status === 'warn').length;
  const error = repos.filter((repo) => repo.status === 'error').length;
  return { workspace: root, repos, ok, warn, error };
}

function printReport(result) {
  console.log(`env standard audit: ${result.ok} ok, ${result.warn} warn, ${result.error} error`);
  for (const repo of result.repos) {
    if (repo.status === 'ok') {
      continue;
    }
    console.log(`  ${repo.status.padEnd(5)} ${repo.repo}`);
    for (const error of repo.errors) {
      console.log(`    ERROR ${error}`);
    }
    for (const warning of repo.warnings) {
      console.log(`    WARN  ${warning}`);
    }
  }
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const result = auditEnvStandardWorkspace(options.workspace);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }
  if (options.check && result.error > 0) {
    process.exitCode = 1;
  }
  if (options.strict && result.warn > 0) {
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
