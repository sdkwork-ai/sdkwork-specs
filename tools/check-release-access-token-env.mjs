#!/usr/bin/env node

/**
 * Fail fast when a release/test/demo deployment profile has no valid public
 * application access token.
 *
 * Usage:
 *   node <sdkwork-specs>/tools/check-release-access-token-env.mjs --root <repo>
 *   node <sdkwork-specs>/tools/check-release-access-token-env.mjs --root <repo> --profiles test,demo
 *
 * The check reads `etc/sdkwork.deployment.config.json` and the client env
 * surface files declared by `etc/client-env.materialization.json`. It never
 * reads a secret or prints a token.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { assertApplicationAccessToken } from './app-access-token.mjs';

const DEFAULT_RELEASE_ENVIRONMENTS = ['test', 'staging', 'demo', 'production'];
const PROFILE_PATTERN = /^(?:standalone|cloud)\.(development|test|staging|demo|production)$/u;

function parseArgs(argv) {
  const options = { root: process.cwd(), profiles: [], json: false, allowNoSurfaces: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--allow-no-surfaces') {
      options.allowNoSurfaces = true;
      continue;
    }
    if (token === '--root') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) throw new Error('--root requires a value.');
      options.root = path.resolve(value);
      index += 1;
      continue;
    }
    if (token === '--profiles') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) throw new Error('--profiles requires a value.');
      options.profiles = value.split(',').map((profile) => profile.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported release access token option: ${token}`);
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function readDotenv(filePath) {
  const values = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u.exec(line);
    if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/gu, '');
  }
  return values;
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

function readToken(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const jsonMatch = /"SDKWORK_ACCESS_TOKEN"\s*:\s*"([^"]+)"/u.exec(text);
  if (jsonMatch) return jsonMatch[1].trim();
  const envMatch = /^SDKWORK_ACCESS_TOKEN=(.*)$/mu.exec(text);
  return envMatch ? envMatch[1].trim().replace(/^["']|["']$/gu, '') : '';
}

function readSurfaces(root) {
  const configPath = path.join(root, 'etc', 'client-env.materialization.json');
  if (!existsSync(configPath)) return null;
  const config = readJson(configPath);
  return (config.surfaces ?? []).map((surface) => ({
    ...surface,
    format: String(surface.format ?? '').trim(),
  }));
}

export function checkReleaseAccessTokenEnv(rootDir, { environments = DEFAULT_RELEASE_ENVIRONMENTS, allowNoSurfaces = false } = {}) {
  const root = path.resolve(rootDir);
  const deploymentPath = path.join(root, 'etc', 'sdkwork.deployment.config.json');
  if (!existsSync(deploymentPath)) {
    return {
      root,
      checked: [],
      failures: [{ profileId: '<config>', reason: 'etc/sdkwork.deployment.config.json is missing' }],
    };
  }
  const deployment = readJson(deploymentPath);
  const declared = Object.keys(deployment.profiles ?? {});
  const releaseProfiles = declared.filter((profileId) => {
    const match = PROFILE_PATTERN.exec(profileId);
    return match && environments.includes(match[1]);
  });
  const surfaces = readSurfaces(root);
  const checked = [];
  const failures = [];

  if (!surfaces || surfaces.length === 0) {
    failures.push({
      profileId: '<surfaces>',
      reason: 'etc/client-env.materialization.json declares no client surface to carry the access token',
    });
    return { root, checked, failures };
  }
  const clientSurfaces = surfaces.filter((surface) => surface.format !== 'none');
  if (clientSurfaces.length === 0) {
    // A repository that declares only format=none surfaces is server-only; it
    // has no browser/mobile document to carry a public application token.
    return { root, checked, failures, skipped: true };
  }

  for (const surface of clientSurfaces) {
    const appRoot = path.join(root, String(surface.root ?? ''));
    const manifestPath = path.join(appRoot, 'agent.app.config.json');
    let format = surface.format;
    let manifest = null;
    if (existsSync(manifestPath)) {
      try {
        manifest = readJson(manifestPath);
      } catch {
        manifest = null;
      }
      if (!format || format === 'auto') format = formatFromManifest(manifest);
    }
    if (!format) format = 'vite';
    if (format === 'harmony-native' || format === 'android-native' || format === 'ios-native') {
      format = 'native';
    }
    const excluded = new Set(surface.excludeProfiles ?? []);
    for (const profileId of releaseProfiles) {
      const filePath = profilePath(appRoot, format, profileId);
      if (excluded.has(profileId) && !existsSync(filePath)) {
        continue;
      }
      if (!existsSync(filePath)) {
        failures.push({
          profileId: `${surface.id}/${profileId}`,
          reason: `missing ${path.relative(root, filePath).replaceAll('\\', '/')}`,
        });
        continue;
      }
      const token = readToken(filePath);
      if (!token) {
        failures.push({ profileId: `${surface.id}/${profileId}`, reason: 'SDKWORK_ACCESS_TOKEN is missing or empty' });
        continue;
      }
      const expectedAppId = surface.accessToken?.appId
        ?? manifest?.backend?.appId
        ?? manifest?.app?.key;
      try {
        assertApplicationAccessToken(token, {
          environment: profileId.split('.')[1],
          deploymentProfile: profileId.split('.')[0],
          ...(expectedAppId ? { appId: expectedAppId } : {}),
        });
        checked.push(`${surface.id}/${profileId}`);
      } catch (error) {
        failures.push({
          profileId: `${surface.id}/${profileId}`,
          reason: error instanceof Error ? error.message.split('\n')[0] : String(error),
        });
      }
    }
  }

  if (checked.length === 0 && failures.length === 0) {
    failures.push({
      profileId: '<matrix>',
      reason: `no client surface covers ${environments.join(', ')}`,
    });
  }
  return { root, checked, failures };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const environments = options.profiles.length > 0
    ? options.profiles.map((profile) => profile.split('.').pop())
    : DEFAULT_RELEASE_ENVIRONMENTS;
  const result = checkReleaseAccessTokenEnv(options.root, {
    environments,
    allowNoSurfaces: options.allowNoSurfaces,
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.failures.length === 0) {
      console.log(`release access-token preflight passed: ${result.checked.length} surface/profile pair(s)`);
    } else {
      console.error('release access-token preflight failed:');
      for (const failure of result.failures) {
        console.error(`  - ${failure.profileId}: ${failure.reason}`);
      }
      console.error('Configure a valid public application access token in every release profile before building or deploying.');
    }
  }
  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
