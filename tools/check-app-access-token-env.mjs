#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  PUBLIC_APP_ACCESS_TOKEN_KEY,
  PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID,
  assertApplicationAccessToken,
  decodeApplicationAccessToken,
  isApplicationAccessTokenPendingAppId,
  isMissingAppIdEnvironmentError,
  resolveApplicationAccessTokenEnvName,
  resolveApplicationOwnershipScope,
  resolveApplicationOwnerUserId,
  surfaceApplicationTokenEnvName,
} from './app-access-token.mjs';
import {
  DEFAULT_DEPLOYMENT_CONFIG_PATH,
  resolveSurfaceAnchor,
} from './app-access-token-anchor.mjs';
import { filterClientEnvSurfaces, assertSurfaceAccessTokenIdentity } from './materialize-client-env.mjs';

const DEFAULT_CONFIG_PATH = 'etc/client-env.materialization.json';
const DEFAULT_PROFILE_IDS = ['standalone', 'cloud'].flatMap(
  (deploymentProfile) => ['development', 'test', 'staging', 'demo', 'production'].map(
    (environment) => ({ deploymentProfile, environment, profileId: `${deploymentProfile}.${environment}` }),
  ),
);

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    config: DEFAULT_CONFIG_PATH,
    profileId: '',
    surfaceIds: [],
    requireAnchor: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--require-anchor') {
      options.requireAnchor = true;
      continue;
    }
    if (token === '--root' || token === '--config' || token === '--profile' || token === '--surface') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }
      if (token === '--surface') {
        options.surfaceIds.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
      } else {
        options[token === '--profile' ? 'profileId' : token.slice(2)] = value;
      }
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
  if (surface.format === 'vite' || surface.format === 'dotenv-root') {
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

function anchorVariables(error, surfaceId) {
  const surfaceEnvName = surfaceApplicationTokenEnvName(error.envName, surfaceId);
  return surfaceEnvName ? `${surfaceEnvName} (or ${error.envName})` : error.envName;
}

/**
 * Validate every committed public application access token profile.
 *
 * Each surface resolves its own deployment anchor, highest precedence first:
 * the surface-scoped variable in the process environment, the same variable
 * recorded in the profile's env layer (resolved profile file, then the authored
 * override layer), then the repository-level variable. Resolution is delegated
 * to the materializer's own `resolveSurfaceAccessTokenAppId`, so the gate and the
 * generator cannot disagree (`APP_ACCESS_TOKEN_SPEC.md` §3.1.1).
 *
 * A surface with no anchor on this machine is skipped: the check cannot compare
 * against an identity that does not exist here, and it must not fall back to a
 * retired literal. `requireAnchor` turns that skip into a failure for packaging
 * gate use. A committed `__SDKWORK_DEPLOY_APPLICATION_ID__` token is reported as
 * needing materialization, and refused under `requireAnchor` too.
 * @param {object} options - root, config path, optional profile/surface filters, env bag, strict mode.
 * @returns {{checked: number, files: string[], pending: object[], skippedSurfaces: object[], surfaceAnchors: object[], skipped?: boolean, reason?: string}}
 */
export function checkAppAccessTokenEnv({
  root = process.cwd(),
  config = DEFAULT_CONFIG_PATH,
  profileId = '',
  surfaceIds = [],
  env = process.env,
  requireAnchor = false,
} = {}) {
  const rootDir = path.resolve(root);
  const configPath = path.resolve(rootDir, config);
  const materialization = readJson(configPath);
  const declaredSurfaces = Array.isArray(materialization.surfaces) ? materialization.surfaces : [];
  if (declaredSurfaces.length === 0) {
    throw new Error(`${config} must declare at least one client surface.`);
  }
  // The materializer resolves `deploymentConfig` relative to `etc/`, so the gate
  // reads the same file it would.
  const configuredDeploymentConfig = String(materialization.deploymentConfig ?? '').trim();
  const deploymentConfigPath = configuredDeploymentConfig
    ? path.join('etc', configuredDeploymentConfig)
    : DEFAULT_DEPLOYMENT_CONFIG_PATH;
  const profiles = profileId
    ? DEFAULT_PROFILE_IDS.filter((entry) => entry.profileId === profileId)
    : DEFAULT_PROFILE_IDS;
  if (profiles.length === 0) {
    throw new Error(`Unsupported profile id ${profileId}; expected <deployment-profile>.<environment>.`);
  }
  const selectedSurfaces = filterClientEnvSurfaces(declaredSurfaces, surfaceIds);

  const files = [];
  const failures = [];
  const pending = [];
  const skippedSurfaces = [];
  const surfaceAnchors = [];
  const invalidSurfaces = new Set();
  for (const surface of declaredSurfaces) {
    if (surface.format === 'none') {
      continue;
    }
    const accessToken = surface.accessToken;
    if (!accessToken || typeof accessToken !== 'object' || Array.isArray(accessToken)) {
      failures.push(`${surface.id}: accessToken is required.`);
      invalidSurfaces.add(String(surface?.id ?? '').trim());
    }
  }

  for (const surface of selectedSurfaces) {
    const surfaceId = String(surface?.id ?? '').trim();
    if (surface.format === 'none' || invalidSurfaces.has(surfaceId)) {
      continue;
    }
    const accessToken = surface.accessToken;
    try {
      // The declaration must agree with the root's own manifest identity, so a
      // surface cannot verify a token for another tenant or an organization the
      // application is not bound to (`APP_ACCESS_TOKEN_SPEC.md` §3).
      assertSurfaceAccessTokenIdentity({ rootDir, surface, accessToken });
    } catch (error) {
      failures.push(`${surfaceId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const baseEnvName = resolveApplicationAccessTokenEnvName(accessToken);
    const surfaceEnvName = surfaceApplicationTokenEnvName(baseEnvName, surfaceId);
    // The expected release scope is resolved exactly as the materializer
    // resolves it, so the gate and the generator cannot disagree: process
    // environment `SDKWORK_APPLICATION_OWNERSHIP_SCOPE`, then the surface
    // declaration, then `TENANT` (`APP_ACCESS_TOKEN_SPEC.md` §3.2.1).
    let ownershipScope;
    let ownerUserId = '';
    try {
      ({ ownershipScope } = resolveApplicationOwnershipScope(accessToken, env));
      if (ownershipScope === 'USER') {
        ({ userId: ownerUserId } = resolveApplicationOwnerUserId(accessToken, env));
      }
    } catch (error) {
      failures.push(`${surfaceId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const excluded = new Set(Array.isArray(surface.excludeProfiles) ? surface.excludeProfiles : []);
    const anchors = [];
    let verified = 0;
    for (const profile of profiles) {
      // The materializer owns only the declared matrix; a profile listed in
      // `excludeProfiles` is generated by another owner and cannot be compared
      // against this surface's token identity.
      if (excluded.has(profile.profileId)) {
        continue;
      }
      let resolution;
      try {
        resolution = resolveSurfaceAnchor({
          rootDir,
          surface,
          profileId: profile.profileId,
          env,
          deploymentConfigPath,
        });
      } catch (error) {
        if (isMissingAppIdEnvironmentError(error)) {
          const reason = `${anchorVariables(error, surfaceId)} is required to verify this surface's public application token`;
          if (requireAnchor) {
            failures.push(`${surfaceId}: ${profile.profileId}: ${reason}`);
          } else {
            skippedSurfaces.push({
              surfaceId,
              profileId: profile.profileId,
              envName: error.envName,
              surfaceEnvName,
            });
          }
          continue;
        }
        failures.push(`${surfaceId}: ${profile.profileId}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      anchors.push({
        profileId: profile.profileId,
        appId: resolution.appId,
        variable: resolution.envName,
        source: resolution.source,
        file: resolution.sourceFile,
      });
      const filePath = resolveProfilePath(rootDir, surface, profile.profileId);
      const relativePath = path.relative(rootDir, filePath).replaceAll('\\', '/');
      if (!existsSync(filePath)) {
        failures.push(`${surfaceId}: missing ${relativePath}.`);
        continue;
      }
      let tokens;
      try {
        tokens = surface.format === 'vite' || surface.format === 'dotenv-root'
          ? readTokenFromDotenv(filePath)
          : readTokenFromJson(filePath);
      } catch (error) {
        failures.push(`${surfaceId}: ${relativePath} is unreadable (${error instanceof Error ? error.message : String(error)}).`);
        continue;
      }
      if (tokens.length !== 1) {
        failures.push(`${surfaceId}: ${relativePath} must contain exactly one ${PUBLIC_APP_ACCESS_TOKEN_KEY}; found ${tokens.length}.`);
        continue;
      }
      let payload;
      try {
        ({ payload } = decodeApplicationAccessToken(tokens[0]));
      } catch (error) {
        failures.push(`${surfaceId}: ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (
        isApplicationAccessTokenPendingAppId(payload.app_id, resolution.baseEnvName)
        || isApplicationAccessTokenPendingAppId(payload.aud, resolution.baseEnvName)
      ) {
        pending.push({ surfaceId, profileId: profile.profileId, file: relativePath });
        if (requireAnchor) {
          failures.push(
            `${surfaceId}: ${relativePath}: needs materialization; it still carries the `
            + `${PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID} placeholder instead of ${resolution.appId} `
            + `(from ${resolution.envName}=${resolution.appId})`,
          );
        }
        continue;
      }
      try {
        assertApplicationAccessToken(tokens[0], {
          appId: resolution.appId,
          tenantId: accessToken.tenantId ?? '100001',
          organizationId: accessToken.organizationId ?? '0',
          environment: profile.environment,
          deploymentProfile: profile.deploymentProfile,
          runtimeTarget: surface.runtimeTarget,
          ownershipScope,
          ...(ownerUserId ? { ownerUserId } : {}),
        });
      } catch (error) {
        failures.push(`${surfaceId}: ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      verified += 1;
      files.push(filePath);
    }
    surfaceAnchors.push({ surfaceId, baseEnvName, surfaceEnvName, anchors, verified });
  }

  if (failures.length > 0) {
    const error = new Error(
      `Public application access token env check failed (${failures.length}):\n${failures.join('\n')}\n`
      + `Repair: node <sdkwork-specs>/tools/materialize-client-env.mjs --root ${rootDir} `
      + '--surface <surface-id> with the deployment anchor set',
    );
    error.failures = failures;
    throw error;
  }
  const anchored = surfaceAnchors.some(
    (surface) => surface.verified > 0 || surface.anchors.length > 0,
  );
  if (files.length === 0 && pending.length === 0 && !anchored && skippedSurfaces.length > 0) {
    const envName = skippedSurfaces[0].envName;
    return {
      checked: 0,
      files: [],
      pending,
      skippedSurfaces,
      surfaceAnchors,
      skipped: true,
      reason: `skipped: ${envName} not set; set ${envName} to this installation's deploy application id, `
        + `or its per-surface form <${envName}>_<SURFACE>, or record that variable in the deployment `
        + 'profile env layer, to verify the committed public application tokens',
    };
  }
  return { checked: files.length, files, pending, skippedSurfaces, surfaceAnchors };
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const result = checkAppAccessTokenEnv(options);
  if (result.skipped) {
    console.log(result.reason);
    return;
  }
  console.log(`SDKWork public application access tokens verified: ${result.checked} profile files.`);
  for (const skip of result.skippedSurfaces ?? []) {
    console.log(`  - skipped ${skip.surfaceId}/${skip.profileId}: ${skip.envName} not set`);
  }
  for (const entry of result.pending ?? []) {
    console.log(`  - needs materialization: ${entry.file} (${PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID} placeholder)`);
  }
  for (const surface of result.surfaceAnchors ?? []) {
    if (surface.anchors.length === 0) {
      continue;
    }
    const values = [...new Set(surface.anchors.map((anchor) => `${anchor.variable}=${anchor.appId}`))];
    console.log(`  - ${surface.surfaceId}: ${values.join(', ')}`);
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
