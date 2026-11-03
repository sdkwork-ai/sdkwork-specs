#!/usr/bin/env node

/**
 * Insert the public application access token into existing app profile files.
 *
 * Use this for apps whose profile files already exist but predate the token
 * standard. It never creates a missing profile file; `audit-app-access-token`
 * still reports those as missing.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createApplicationAccessToken } from './app-access-token.mjs';

const PROFILE_IDS = ['standalone', 'cloud'].flatMap(
  (deploymentProfile) => ['development', 'test', 'staging', 'demo', 'production'].map(
    (environment) => `${deploymentProfile}.${environment}`,
  ),
);

function parseArgs(argv) {
  const options = { workspace: process.cwd(), dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
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
    throw new Error(`Unsupported token-file adoption option: ${token}`);
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function formatFromManifest(manifest) {
  const framework = String(manifest?.runtime?.framework ?? '').trim();
  if (framework === 'flutter') return 'flutter';
  if (framework === 'harmony-native' || framework === 'android-native' || framework === 'ios-native') return 'native';
  if (framework.startsWith('mp-') || framework.includes('mini-program') || framework === 'multi-mini-program') {
    return 'mini-program';
  }
  return 'vite';
}

function profilePath(appRoot, format, profileId) {
  if (format === 'flutter') return path.join(appRoot, 'env', `sdkwork.${profileId}.json`);
  if (format === 'mini-program') return path.join(appRoot, 'config', 'mini-program', `runtime-env.${profileId}.json`);
  if (format === 'native') return path.join(appRoot, 'config', 'app', `runtime-env.${profileId}.json`);
  return path.join(appRoot, `.env.${profileId}`);
}

function runtimeTarget(format, values) {
  const declared = String(values?.SDKWORK_RUNTIME_TARGET ?? '').trim();
  if (declared) return declared;
  if (format === 'flutter') return 'flutter-android';
  if (format === 'mini-program') return 'mini-program';
  if (format === 'native') return 'harmony-native';
  return 'browser';
}

function tokenFor(manifest, profileId, format, values) {
  const backend = manifest.backend ?? {};
  const [deploymentProfile, environment] = profileId.split('.');
  return createApplicationAccessToken({
    appId: String(backend.appId ?? manifest.app?.key ?? '').trim(),
    tenantId: String(backend.tenantId ?? '100001').trim(),
    organizationId: String(backend.organizationId ?? '0').trim(),
    environment,
    deploymentProfile,
    runtimeTarget: runtimeTarget(format, values),
    permissionScope: Array.isArray(backend.accessTokenPermissionScope) && backend.accessTokenPermissionScope.length > 0
      ? backend.accessTokenPermissionScope
      : ['iam:self'],
  });
}

function updateDotenv(filePath, token) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u);
  let replaced = false;
  const next = lines.map((line) => {
    if (/^SDKWORK_ACCESS_TOKEN=/u.test(line)) {
      replaced = true;
      return `SDKWORK_ACCESS_TOKEN=${token}`;
    }
    return line;
  });
  if (!replaced) {
    while (next.length > 0 && next[next.length - 1] === '') {
      next.pop();
    }
    next.push(`SDKWORK_ACCESS_TOKEN=${token}`, '');
  }
  return next.join('\n');
}

function updateJson(filePath, token) {
  const values = readJson(filePath);
  if (String(values.SDKWORK_ACCESS_TOKEN ?? '') === token) {
    return null;
  }
  values.SDKWORK_ACCESS_TOKEN = token;
  return `${JSON.stringify(values, null, 2)}\n`;
}

export function adoptTokenFilesInWorkspace(workspaceRoot, { dryRun = false } = {}) {
  const root = path.resolve(workspaceRoot);
  const results = [];
  const repoEntries = readdirSyncSafe(root);
  for (const repoEntry of repoEntries) {
    if (!repoEntry.isDirectory() || repoEntry.name.startsWith('.') || repoEntry.name === 'node_modules') {
      continue;
    }
    const appsDir = path.join(root, repoEntry.name, 'apps');
    if (!existsSync(appsDir)) {
      continue;
    }
    for (const appEntry of readdirSyncSafe(appsDir)) {
      if (!appEntry.isDirectory()) {
        continue;
      }
      const appRoot = path.join(appsDir, appEntry.name);
      const manifestPath = path.join(appRoot, 'agent.app.config.json');
      if (!existsSync(manifestPath)) {
        continue;
      }
      const manifest = readJson(manifestPath);
      if (!String(manifest.backend?.appId ?? manifest.app?.key ?? '').trim()) {
        continue;
      }
      const format = formatFromManifest(manifest);
      let updated = 0;
      for (const profileId of PROFILE_IDS) {
        const filePath = profilePath(appRoot, format, profileId);
        if (!existsSync(filePath)) {
          continue;
        }
        const values = format === 'vite' ? null : (() => {
          try { return readJson(filePath); } catch { return null; }
        })();
        const token = tokenFor(manifest, profileId, format, values);
        if (dryRun) {
          updated += 1;
          continue;
        }
        const content = format === 'vite'
          ? updateDotenv(filePath, token)
          : updateJson(filePath, token);
        if (content !== null) {
          writeFileSync(filePath, content, 'utf8');
          updated += 1;
        }
      }
      if (updated > 0) {
        results.push({ repo: repoEntry.name, app: appEntry.name, format, updated });
      }
    }
  }
  return results;
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = adoptTokenFilesInWorkspace(options.workspace, { dryRun: options.dryRun });
  let total = 0;
  for (const result of results) {
    total += result.updated;
    console.log(`${options.dryRun ? 'PLAN' : 'OK  '} ${result.repo}/${result.app} [${result.format}] files=${result.updated}`);
  }
  console.log(`token-file adoption ${options.dryRun ? 'planned' : 'complete'}: ${total} files in ${results.length} apps`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
