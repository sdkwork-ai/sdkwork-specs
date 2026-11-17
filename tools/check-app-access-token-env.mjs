#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  PUBLIC_APP_ACCESS_TOKEN_KEY,
  assertApplicationAccessToken,
  isMissingAppIdEnvironmentError,
  resolveApplicationAccessTokenAppId,
} from './app-access-token.mjs';

const DEFAULT_CONFIG_PATH = 'etc/client-env.materialization.json';
const DEFAULT_PROFILE_IDS = ['standalone', 'cloud'].flatMap(
  (deploymentProfile) => ['development', 'test', 'staging', 'demo', 'production'].map(
    (environment) => ({ deploymentProfile, environment, profileId: `${deploymentProfile}.${environment}` }),
  ),
);

function parseArgs(argv) {
  const options = { root: process.cwd(), config: DEFAULT_CONFIG_PATH, profileId: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root' || token === '--config' || token === '--profile') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }
      options[token === '--profile' ? 'profileId' : token.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported app access token check option: ${token}`);
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function readTokenFromDotenv(filePath) {
  const contents = readFileSync(filePath, 'utf8');
  const tokens = [];
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (key === PUBLIC_APP_ACCESS_TOKEN_KEY) {
      tokens.push(line.slice(separatorIndex + 1).trim());
    }
  }
  return tokens;
}

function readTokenFromJson(filePath) {
  const values = readJson(filePath);
  return [String(values[PUBLIC_APP_ACCESS_TOKEN_KEY] ?? '').trim()].filter(Boolean);
}

function resolveProfilePath(root, surface, profileId) {
  const appRoot = path.resolve(root, surface.root);
  if (surface.format === 'vite') {
    return path.join(appRoot, `.env.${profileId}`);
  }
  if (surface.format === 'flutter') {
    return path.join(appRoot, 'env', `sdkwork.${profileId}.json`);
  }
  if (surface.format === 'mini-program') {
    return path.join(appRoot, 'config', 'mini-program', `runtime-env.${profileId}.json`);
  }
  if (surface.format === 'harmony-native') {
    return path.join(appRoot, 'config', 'app', `runtime-env.${profileId}.json`);
  }
  throw new Error(`${surface.id} uses unsupported format ${surface.format}.`);
}

/**
 * Validate every committed public application access token profile.
 *
 * The expected app id is resolved with the materializer's own logic: a literal
 * `accessToken.appId`, or the deployment anchor named by `accessToken.appIdEnv`.
 * When an `appIdEnv`-sourced anchor is unavailable on this machine (no
 * deployment configuration), the check reports `skipped: <ENV> not set` and
 * returns 0 — it cannot compare against an identity that does not exist here,
 * and it must not fall back to a retired literal.
 * @param {object} options - root, config path, optional profile filter, env bag.
 * @returns {{checked: number, files: string[], skipped?: boolean, reason?: string}}
 */
export function checkAppAccessTokenEnv({
  root = process.cwd(),
  config = DEFAULT_CONFIG_PATH,
  profileId = '',
  env = process.env,
} = {}) {
  const rootDir = path.resolve(root);
  const configPath = path.resolve(rootDir, config);
  const materialization = readJson(configPath);
  const surfaces = Array.isArray(materialization.surfaces) ? materialization.surfaces : [];
  if (surfaces.length === 0) {
    throw new Error(`${config} must declare at least one client surface.`);
  }
  const profiles = profileId
    ? DEFAULT_PROFILE_IDS.filter((entry) => entry.profileId === profileId)
    : DEFAULT_PROFILE_IDS;
  if (profiles.length === 0) {
    throw new Error(`Unsupported profile id ${profileId}; expected <deployment-profile>.<environment>.`);
  }

  const files = [];
  const failures = [];
  const expectedAppIds = new Map();
  for (const surface of surfaces) {
    if (surface.format === 'none') {
      continue;
    }
    const accessToken = surface.accessToken;
    if (!accessToken || typeof accessToken !== 'object' || Array.isArray(accessToken)) {
      failures.push(`${surface.id}: accessToken is required.`);
      continue;
    }
    try {
      expectedAppIds.set(surface.id, resolveApplicationAccessTokenAppId(accessToken, env));
    } catch (error) {
      if (isMissingAppIdEnvironmentError(error)) {
        return {
          checked: 0,
          files: [],
          skipped: true,
          reason: `skipped: ${error.envName} not set; set ${error.envName} to this installation's `
            + 'deploy application id to verify the committed public application tokens',
        };
      }
      failures.push(`${surface.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const surface of surfaces) {
    if (surface.format === 'none' || !expectedAppIds.has(surface.id)) {
      continue;
    }
    const accessToken = surface.accessToken;
    const { appId } = expectedAppIds.get(surface.id);
    for (const profile of profiles) {
      // The materializer owns only the declared matrix; a profile listed in
      // `excludeProfiles` is generated by another owner and cannot be compared
      // against this surface's token identity.
      if (Array.isArray(surface.excludeProfiles) && surface.excludeProfiles.includes(profile.profileId)) {
        continue;
      }
      const filePath = resolveProfilePath(rootDir, surface, profile.profileId);
      const relativePath = path.relative(rootDir, filePath).replaceAll('\\', '/');
      if (!existsSync(filePath)) {
        failures.push(`${surface.id}: missing ${relativePath}.`);
        continue;
      }
      let tokens;
      try {
        tokens = surface.format === 'vite'
          ? readTokenFromDotenv(filePath)
          : readTokenFromJson(filePath);
      } catch (error) {
        failures.push(`${surface.id}: ${relativePath} is unreadable (${error instanceof Error ? error.message : String(error)}).`);
        continue;
      }
      if (tokens.length !== 1) {
        failures.push(`${surface.id}: ${relativePath} must contain exactly one ${PUBLIC_APP_ACCESS_TOKEN_KEY}; found ${tokens.length}.`);
        continue;
      }
      try {
        assertApplicationAccessToken(tokens[0], {
          appId,
          tenantId: accessToken.tenantId ?? '100001',
          organizationId: accessToken.organizationId ?? '0',
          environment: profile.environment,
          deploymentProfile: profile.deploymentProfile,
          runtimeTarget: surface.runtimeTarget,
        });
      } catch (error) {
        failures.push(`${surface.id}: ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      files.push(filePath);
    }
  }

  if (failures.length > 0) {
    const error = new Error(
      `Public application access token env check failed (${failures.length}):\n${failures.join('\n')}\n`
      + `Repair: node <sdkwork-specs>/tools/materialize-client-env.mjs --root ${rootDir}`,
    );
    error.failures = failures;
    throw error;
  }
  return { checked: files.length, files };
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const result = checkAppAccessTokenEnv(options);
  if (result.skipped) {
    console.log(result.reason);
    return;
  }
  console.log(`SDKWork public application access tokens verified: ${result.checked} profile files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
