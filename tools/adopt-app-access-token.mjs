#!/usr/bin/env node

/**
 * Adopt the public application access token in a repository's client env
 * materialization config.
 *
 * For every surface without `accessToken`, read `apps/<surface>/agent.app.config.json`
 * and add the manifest identity, then regenerate the client env profiles.
 *
 * Usage:
 *   node <sdkwork-specs>/tools/adopt-app-access-token.mjs --root <repo> [--dry-run]
 *   node <sdkwork-specs>/tools/adopt-app-access-token.mjs --workspace <workspace> [--dry-run]
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { materializeClientEnv } from './materialize-client-env.mjs';

function parseArgs(argv) {
  const options = { root: '', workspace: '', dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token === '--root' || token === '--workspace') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }
      options[token.slice(2)] = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported access-token adoption option: ${token}`);
  }
  if (!options.root && !options.workspace) {
    throw new Error('Provide --root or --workspace.');
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function resolveManifest(repoRoot, surface) {
  const surfaceRoot = String(surface.root ?? '').trim();
  if (!surfaceRoot) {
    return null;
  }
  const manifestPath = path.join(repoRoot, surfaceRoot, 'agent.app.config.json');
  if (!existsSync(manifestPath)) {
    return null;
  }
  return { manifestPath, manifest: readJson(manifestPath) };
}

export function adoptAppAccessTokenInRepo(repoRoot, { dryRun = false } = {}) {
  const root = path.resolve(repoRoot);
  const configPath = path.join(root, 'etc', 'client-env.materialization.json');
  if (!existsSync(configPath)) {
    return { root, adopted: [], skipped: [], error: 'no client-env.materialization.json' };
  }
  const originalText = readFileSync(configPath, 'utf8');
  const config = JSON.parse(originalText.replace(/^\uFEFF/u, ''));
  const adopted = [];
  const skipped = [];
  for (const surface of config.surfaces ?? []) {
    if (surface.format === 'none') {
      continue;
    }
    if (surface.accessToken?.appId) {
      continue;
    }
    const resolved = resolveManifest(root, surface);
    if (!resolved) {
      skipped.push(`${surface.id}: manifest missing`);
      continue;
    }
    const backend = resolved.manifest.backend ?? {};
    const appId = String(backend.appId ?? resolved.manifest.app?.key ?? '').trim();
    if (!appId) {
      skipped.push(`${surface.id}: backend.appId missing`);
      continue;
    }
    const permissionScope = Array.isArray(backend.accessTokenPermissionScope)
      && backend.accessTokenPermissionScope.length > 0
      ? backend.accessTokenPermissionScope
      : ['iam:self'];
    surface.accessToken = {
      appId,
      tenantId: String(backend.tenantId ?? '100001').trim(),
      organizationId: String(backend.organizationId ?? '0').trim(),
      permissionScope,
    };
    adopted.push(`${surface.id}:${appId}`);
  }
  if (adopted.length === 0) {
    return { root, adopted, skipped, error: null };
  }
  if (dryRun) {
    return { root, adopted, skipped, error: null, dryRun: true };
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  try {
    materializeClientEnv({ rootDir: root });
  } catch (error) {
    writeFileSync(configPath, originalText, 'utf8');
    return {
      root,
      adopted,
      skipped,
      error: error instanceof Error ? error.message.split('\n')[0] : String(error),
    };
  }
  return { root, adopted, skipped, error: null };
}

function listRepos(workspaceRoot) {
  return readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((repoRoot) => existsSync(path.join(repoRoot, 'etc', 'client-env.materialization.json')));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repos = options.root ? [options.root] : listRepos(options.workspace);
  const results = [];
  for (const repoRoot of repos) {
    const result = adoptAppAccessTokenInRepo(repoRoot, { dryRun: options.dryRun });
    if (result.adopted.length > 0 || result.error) {
      results.push(result);
    }
  }
  let adopted = 0;
  for (const result of results) {
    adopted += result.adopted.length;
    console.log(
      `${result.error ? 'ERROR' : options.dryRun ? 'PLAN ' : 'OK   '} ${path.basename(result.root)} `
      + `adopted=${result.adopted.length} skipped=${result.skipped.length}`
      + `${result.error ? ` :: ${result.error}` : ''}`,
    );
    for (const entry of result.adopted) {
      console.log(`  + ${entry}`);
    }
  }
  console.log(`access-token adoption ${options.dryRun ? 'planned' : 'complete'}: ${adopted} surface(s) in ${results.length} repo(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
