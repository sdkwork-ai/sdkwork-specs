#!/usr/bin/env node

/**
 * Audit public application access token coverage across a SDKWork workspace.
 *
 * Every manifest-bearing app root is expected to carry a non-empty
 * `SDKWORK_ACCESS_TOKEN` in all ten canonical profiles
 * (`APP_ACCESS_TOKEN_SPEC.md` §2). This tool reports complete / partial /
 * missing coverage without rewriting anything.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROFILE_IDS = ['standalone', 'cloud'].flatMap(
  (deploymentProfile) => ['development', 'test', 'staging', 'demo', 'production'].map(
    (environment) => `${deploymentProfile}.${environment}`,
  ),
);

function parseArgs(argv) {
  const options = { workspace: process.cwd(), json: false, check: false };
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
    if (token === '--workspace') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error('--workspace requires a value.');
      }
      options.workspace = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported access-token audit option: ${token}`);
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function formatFromManifest(manifest, appRoot = '') {
  if (appRoot) {
    if (existsSync(path.join(appRoot, 'pubspec.yaml'))) return 'flutter';
    if (existsSync(path.join(appRoot, 'oh-package.json5'))) return 'native';
    if (existsSync(path.join(appRoot, 'app.json')) || existsSync(path.join(appRoot, 'project.config.json'))) {
      return 'mini-program';
    }
  }
  const directory = path.basename(appRoot);
  if (directory.includes('flutter')) return 'flutter';
  if (directory.includes('harmony')) return 'native';
  if (directory.includes('mini-program')) return 'mini-program';
  if (directory.includes('uniappx') || directory.includes('uni-app-x')) return 'native';
  const framework = String(manifest?.runtime?.framework ?? '').trim();
  if (framework.includes('flutter')) return 'flutter';
  if (framework.includes('harmony') || framework.includes('arkts')) return 'native';
  if (framework.includes('uni-app-x') || framework.includes('uniappx')) return 'native';
  if (
    framework.startsWith('mp-')
    || framework.includes('mini-program')
    || framework === 'multi-mini-program'
  ) {
    return 'mini-program';
  }
  return 'vite';
}

function profilePath(appRoot, format, profileId) {
  if (format === 'flutter') return path.join(appRoot, 'env', `sdkwork.${profileId}.json`);
  if (format === 'mini-program') {
    return path.join(appRoot, 'config', 'mini-program', `runtime-env.${profileId}.json`);
  }
  if (format === 'native') return path.join(appRoot, 'config', 'app', `runtime-env.${profileId}.json`);
  return path.join(appRoot, `.env.${profileId}`);
}

function readToken(filePath, format) {
  if (!existsSync(filePath)) {
    return { exists: false, token: '' };
  }
  const contents = readFileSync(filePath, 'utf8');
  if (format === 'vite') {
    const match = contents.match(/^SDKWORK_ACCESS_TOKEN=(.*)$/mu);
    return { exists: true, token: match ? match[1].trim().replace(/^["']|["']$/gu, '') : '' };
  }
  try {
    const values = JSON.parse(contents.replace(/^\uFEFF/u, ''));
    return { exists: true, token: String(values.SDKWORK_ACCESS_TOKEN ?? '').trim() };
  } catch {
    return { exists: true, token: '' };
  }
}

function readDeclaredProfiles(repoRoot) {
  const configPath = path.join(repoRoot, 'etc', 'sdkwork.deployment.config.json');
  if (!existsSync(configPath)) {
    return PROFILE_IDS;
  }
  try {
    const profiles = Object.keys(readJson(configPath).profiles ?? {})
      .filter((profileId) => /^(?:standalone|cloud)\.(?:development|test|staging|demo|production)$/u.test(profileId));
    return profiles.length > 0 ? profiles : PROFILE_IDS;
  } catch {
    return PROFILE_IDS;
  }
}

function readSurfaceRoots(repoRoot) {
  const configPath = path.join(repoRoot, 'etc', 'client-env.materialization.json');
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const config = readJson(configPath);
    return new Set(
      (config.surfaces ?? [])
        .filter((surface) => surface.format !== 'none')
        .map((surface) => String(surface.root ?? '').replaceAll('\\', '/')),
    );
  } catch {
    return null;
  }
}

export function auditAppAccessTokenWorkspace(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const apps = [];
  for (const repoEntry of readdirSync(root, { withFileTypes: true })) {
    if (!repoEntry.isDirectory() || repoEntry.name.startsWith('.') || repoEntry.name === 'node_modules') {
      continue;
    }
    const repoRoot = path.join(root, repoEntry.name);
    const appsDir = path.join(repoRoot, 'apps');
    if (!existsSync(appsDir)) {
      continue;
    }
    const declaredProfiles = readDeclaredProfiles(repoRoot);
    const surfaceRoots = readSurfaceRoots(repoRoot);
    for (const appEntry of readdirSync(appsDir, { withFileTypes: true })) {
      if (!appEntry.isDirectory()) {
        continue;
      }
      const appRoot = path.join(appsDir, appEntry.name);
      const manifestPath = path.join(appRoot, 'agent.app.config.json');
      if (!existsSync(manifestPath)) {
        continue;
      }
      let manifest;
      try {
        manifest = readJson(manifestPath);
      } catch (error) {
        apps.push({
          repo: repoEntry.name,
          app: appEntry.name,
          format: 'unknown',
          status: 'invalid',
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const format = formatFromManifest(manifest, appRoot);
      const relativeRoot = `apps/${appEntry.name}`;
      const hasDeclaredSurface = surfaceRoots === null ? false : surfaceRoots.has(relativeRoot);
      const missing = [];
      const empty = [];
      for (const profileId of declaredProfiles) {
        const filePath = profilePath(appRoot, format, profileId);
        const { exists, token } = readToken(filePath, format);
        if (!exists) {
          missing.push(profileId);
        } else if (!token) {
          empty.push(profileId);
        }
      }
      const hasAnyProfileFile = missing.length < declaredProfiles.length;
      const status = !hasDeclaredSurface && !hasAnyProfileFile
        ? 'not-applicable'
        : missing.length === 0 && empty.length === 0
          ? 'complete'
          : missing.length === declaredProfiles.length
            ? 'missing'
            : 'partial';
      apps.push({
        repo: repoEntry.name,
        app: appEntry.name,
        format,
        status,
        missing,
        empty,
      });
    }
  }
  apps.sort((left, right) => `${left.repo}/${left.app}`.localeCompare(`${right.repo}/${right.app}`));
  const complete = apps.filter((app) => app.status === 'complete').length;
  const partial = apps.filter((app) => app.status === 'partial').length;
  const missing = apps.filter((app) => app.status === 'missing').length;
  const notApplicable = apps.filter((app) => app.status === 'not-applicable').length;
  return { workspace: root, apps, complete, partial, missing, notApplicable };
}

function printReport(result) {
  console.log(
    `app access-token audit: ${result.complete} complete, ${result.partial} partial, `
    + `${result.missing} missing, ${result.notApplicable} not-applicable`,
  );
  for (const app of result.apps) {
    if (app.status === 'complete') {
      continue;
    }
    const detail = app.status === 'partial'
      ? `missing=${app.missing.length} empty=${app.empty.length}`
      : app.status === 'invalid'
        ? app.reason
        : app.status === 'missing'
          ? 'no profile files'
          : 'no declared client surface';
    console.log(`  ${app.status.padEnd(8)} ${app.repo}/${app.app} [${app.format}]${detail ? ` (${detail})` : ''}`);
  }
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const result = auditAppAccessTokenWorkspace(options.workspace);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }
  if (options.check && (result.partial > 0 || result.missing > 0)) {
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
