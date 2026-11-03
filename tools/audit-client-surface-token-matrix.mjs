#!/usr/bin/env node

/**
 * Per-surface access-token matrix audit.
 *
 * Discovers every declared client surface plus every app manifest, then checks
 * the canonical ten profiles (or the surface's declared profile list) for a
 * present, valid public application access token with matching scope claims.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { assertApplicationAccessToken } from './app-access-token.mjs';

const ALL_PROFILES = ['standalone', 'cloud'].flatMap(
  (deploymentProfile) => ['development', 'test', 'staging', 'demo', 'production'].map(
    (environment) => `${deploymentProfile}.${environment}`,
  ),
);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function formatFromManifest(manifest) {
  const framework = String(manifest?.runtime?.framework ?? '').trim();
  if (framework.includes('rust') || framework.includes('node-service') || framework.includes('server')) return 'none';
  if (framework.includes('flutter')) return 'flutter';
  if (framework.includes('arkts') || framework.includes('harmony')) return 'native';
  if (framework === 'android-native' || framework === 'ios-native') return 'native';
  if (framework.startsWith('mp-') || framework.includes('mini-program') || framework === 'multi-mini-program') {
    return 'mini-program';
  }
  return 'vite';
}

function profilePath(appRoot, format, profileId) {
  if (format === 'flutter') return path.join(appRoot, 'env', `sdkwork.${profileId}.json`);
  if (format === 'mini-program') return path.join(appRoot, 'config', 'mini-program', `runtime-env.${profileId}.json`);
  if (format === 'native' || format === 'harmony-native') {
    return path.join(appRoot, 'config', 'app', `runtime-env.${profileId}.json`);
  }
  return path.join(appRoot, `.env.${profileId}`);
}

function readToken(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const jsonMatch = /"SDKWORK_ACCESS_TOKEN"\s*:\s*"([^"]+)"/u.exec(text);
  if (jsonMatch) return jsonMatch[1].trim();
  const envMatch = /^SDKWORK_ACCESS_TOKEN=(.*)$/mu.exec(text);
  return envMatch ? envMatch[1].trim().replace(/^["']|["']$/gu, '') : '';
}

function discoverSurfaces(root) {
  const surfaces = [];
  const seen = new Set();
  for (const repoEntry of readdirSync(root, { withFileTypes: true })) {
    if (!repoEntry.isDirectory() || repoEntry.name.startsWith('.') || repoEntry.name === 'node_modules') continue;
    const repoRoot = path.join(root, repoEntry.name);
    const configPath = path.join(repoRoot, 'etc', 'client-env.materialization.json');
    let repoProfiles = ALL_PROFILES;
    if (existsSync(configPath)) {
      try {
        const config = readJson(configPath);
        repoProfiles = config.profiles ?? ALL_PROFILES;
        for (const surface of config.surfaces ?? []) {
          if (surface.format === 'none') continue;
          const key = `${repoEntry.name}:${surface.root}`;
          if (seen.has(key)) continue;
          seen.add(key);
          surfaces.push({ repo: repoEntry.name, ...surface, source: 'config', profiles: config.profiles ?? ALL_PROFILES });
        }
      } catch {
        // Keep the app-manifest fallback below.
      }
    }
    const appsDir = path.join(repoRoot, 'apps');
    if (!existsSync(appsDir)) continue;
    for (const appEntry of readdirSync(appsDir, { withFileTypes: true })) {
      if (!appEntry.isDirectory()) continue;
      const appRoot = path.join(appsDir, appEntry.name);
      const manifestPath = path.join(appRoot, 'agent.app.config.json');
      if (!existsSync(manifestPath)) continue;
      const relativeRoot = `apps/${appEntry.name}`;
      const key = `${repoEntry.name}:${relativeRoot}`;
      if (seen.has(key)) continue;
      let manifest;
      try {
        manifest = readJson(manifestPath);
      } catch {
        continue;
      }
      seen.add(key);
      const fallbackFormat = formatFromManifest(manifest);
      if (fallbackFormat === 'none' || fallbackFormat === 'native') {
        continue;
      }
      surfaces.push({
        repo: repoEntry.name,
        id: appEntry.name,
        root: relativeRoot,
        format: fallbackFormat,
        source: 'manifest',
        runtimeTarget: manifest.runtime?.runtimeTarget,
        profiles: repoProfiles,
        manifest,
      });
    }
  }
  return surfaces;
}

export function auditClientSurfaceTokenMatrix(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const rows = [];
  for (const surface of discoverSurfaces(root)) {
    const appRoot = path.join(root, surface.repo, String(surface.root));
    const manifest = surface.manifest
      ?? (existsSync(path.join(appRoot, 'agent.app.config.json'))
        ? readJson(path.join(appRoot, 'agent.app.config.json'))
        : null);
    const format = surface.format && surface.format !== 'auto'
      ? surface.format
      : formatFromManifest(manifest);
    const expectedAppId = surface.accessToken?.appId ?? manifest?.backend?.appId ?? manifest?.app?.key;
    const profiles = Array.isArray(surface.profiles) && surface.profiles.length > 0
      ? surface.profiles
      : ALL_PROFILES;
    const missing = [];
    const invalid = [];
    for (const profileId of profiles) {
      const filePath = profilePath(appRoot, format, profileId);
      if (!existsSync(filePath)) {
        missing.push(profileId);
        continue;
      }
      const token = readToken(filePath);
      if (!token) {
        invalid.push(`${profileId}: empty`);
        continue;
      }
      try {
        assertApplicationAccessToken(token, {
          appId: expectedAppId,
          environment: profileId.split('.')[1],
          deploymentProfile: profileId.split('.')[0],
          runtimeTarget: surface.runtimeTarget,
        });
      } catch (error) {
        invalid.push(`${profileId}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      }
    }
    const status = missing.length === 0 && invalid.length === 0
      ? 'complete'
      : missing.length === profiles.length
        ? 'missing'
        : 'partial';
    rows.push({
      repo: surface.repo,
      surface: surface.id ?? path.basename(String(surface.root)),
      source: surface.source ?? 'manifest',
      format,
      profiles: profiles.length,
      status,
      missing,
      invalid,
    });
  }
  rows.sort((left, right) => `${left.repo}/${left.surface}`.localeCompare(`${right.repo}/${right.surface}`));
  const complete = rows.filter((row) => row.status === 'complete').length;
  const partial = rows.filter((row) => row.status === 'partial').length;
  const missing = rows.filter((row) => row.status === 'missing').length;
  return { workspace: root, surfaces: rows, complete, partial, missing };
}

function main() {
  const workspaceIndex = process.argv.indexOf('--workspace');
  const workspace = workspaceIndex >= 0
    ? path.resolve(process.argv[workspaceIndex + 1])
    : process.cwd();
  const result = auditClientSurfaceTokenMatrix(workspace);
  console.log(`client surface token matrix: ${result.complete} complete, ${result.partial} partial, ${result.missing} missing`);
  for (const row of result.surfaces) {
    if (row.status === 'complete') continue;
    const detail = row.missing.length > 0 ? `missing=${row.missing.length}` : '';
    const invalid = row.invalid.length > 0 ? ` invalid=${row.invalid.length}` : '';
    console.log(`  ${row.status.padEnd(7)} ${row.repo}/${row.surface} [${row.source}:${row.format}]${detail}${invalid}`);
    for (const entry of row.invalid.slice(0, 3)) console.log(`    ${entry}`);
  }
  process.exitCode = result.partial > 0 || result.missing > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
