#!/usr/bin/env node

/**
 * Fail fast when a release/test/demo deployment profile has no valid public
 * application access token.
 *
 * Usage:
 *   node <sdkwork-specs>/tools/check-release-access-token-env.mjs --root <repo>
 *   node <sdkwork-specs>/tools/check-release-access-token-env.mjs --root <repo> --profiles test,demo
 *   node <sdkwork-specs>/tools/check-release-access-token-env.mjs --root <repo> --surface <id>[,<id>]
 *
 * The check reads `etc/sdkwork.deployment.config.json` and the client env
 * surface files declared by `etc/client-env.materialization.json`. Each surface
 * resolves its own deployment anchor: the surface-scoped variable in the process
 * environment, the same variable recorded in the profile env layer, then the
 * repository-level variable (`app-access-token-anchor.mjs`,
 * `APP_ACCESS_TOKEN_SPEC.md` §3.1.1). It never reads a secret or prints a token.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID,
  assertApplicationAccessToken,
  decodeApplicationAccessToken,
  isApplicationAccessTokenPendingAppId,
  isMissingAppIdEnvironmentError,
  resolveApplicationOwnershipScope,
  resolveApplicationOwnerUserId,
  surfaceApplicationTokenEnvName,
} from './app-access-token.mjs';
import {
  DEFAULT_DEPLOYMENT_CONFIG_PATH,
  resolveSurfaceAnchor,
} from './app-access-token-anchor.mjs';
import { assertSurfaceAccessTokenIdentity, filterClientEnvSurfaces } from './materialize-client-env.mjs';

const DEFAULT_RELEASE_ENVIRONMENTS = ['test', 'staging', 'demo', 'production'];
const PROFILE_PATTERN = /^(?:standalone|cloud)\.(development|test|staging|demo|production)$/u;

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    profiles: [],
    json: false,
    allowNoSurfaces: false,
    requireAnchor: false,
    surfaceIds: [],
  };
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
    // Packaging passes this so a missing anchor is a release failure; a source
    // checkout has no anchor yet, so the check reports it and skips.
    if (token === '--require-anchor') {
      options.requireAnchor = true;
      continue;
    }
    if (token === '--root' || token === '--profiles' || token === '--surface') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) throw new Error(`${token} requires a value.`);
      if (token === '--root') {
        options.root = path.resolve(value);
      } else if (token === '--profiles') {
        options.profiles = value.split(',').map((profile) => profile.trim()).filter(Boolean);
      } else {
        options.surfaceIds.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
      }
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

function formatFromManifest(manifest) {
  const framework = String(manifest?.runtime?.framework ?? '').trim();
  if (framework === 'flutter') return 'flutter';
  if (framework === 'harmony-native' || framework === 'android-native' || framework === 'ios-native') return 'native';
  // uni-app x / uniappx apps use the native JSON runtime profile
  // (`config/app/runtime-env.<profile>.json`, UNIAPP_X_APP_ARCHITECTURE_SPEC §12).
  if (framework.includes('uni-app-x') || framework.includes('uniappx')) return 'native';
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

function anchorVariables(error, surfaceId) {
  const surfaceEnvName = surfaceApplicationTokenEnvName(error.envName, surfaceId);
  return surfaceEnvName ? `${surfaceEnvName} (or ${error.envName})` : error.envName;
}

function resolveSurfaceFormat(surface, root) {
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
  return { appRoot, manifest, format };
}

export function checkReleaseAccessTokenEnv(
  rootDir,
  {
    environments = DEFAULT_RELEASE_ENVIRONMENTS,
    allowNoSurfaces = false,
    requireAnchor = false,
    surfaceIds = [],
    env = process.env,
  } = {},
) {
  const root = path.resolve(rootDir);
  const deploymentPath = path.join(root, 'etc', 'sdkwork.deployment.config.json');
  if (!existsSync(deploymentPath)) {
    return {
      root,
      checked: [],
      pending: [],
      skippedSurfaces: [],
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
  const pending = [];
  const skippedSurfaces = [];
  const failures = [];

  if (!surfaces || surfaces.length === 0) {
    // Server-only repositories have no client document to carry a public
    // token; the pre-commit hook opts out explicitly with `--allow-no-surfaces`.
    if (allowNoSurfaces) return { root, checked, pending, skippedSurfaces, failures, skipped: true };
    failures.push({
      profileId: '<surfaces>',
      reason: 'etc/client-env.materialization.json declares no client surface to carry the access token',
    });
    return { root, checked, pending, skippedSurfaces, failures };
  }
  const selectedSurfaces = filterClientEnvSurfaces(surfaces, surfaceIds);
  const clientSurfaces = selectedSurfaces.filter((surface) => surface.format !== 'none');
  if (clientSurfaces.length === 0) {
    // A repository that declares only format=none surfaces is server-only; it
    // has no browser/mobile document to carry a public application token.
    return { root, checked, pending, skippedSurfaces, failures, skipped: true };
  }

  for (const surface of clientSurfaces) {
    const surfaceId = String(surface?.id ?? '').trim();
    const { appRoot, manifest, format } = resolveSurfaceFormat(surface, root);
    const usesAnchor = surface.accessToken
      && typeof surface.accessToken === 'object'
      && !Array.isArray(surface.accessToken);
    // The release scope is resolved the way the materializer resolves it
    // (`SDKWORK_APPLICATION_OWNERSHIP_SCOPE`, then `accessToken.ownershipScope`,
    // then `TENANT`), so a packaged token must carry the installation's scope
    // (`APP_ACCESS_TOKEN_SPEC.md` §3.2.1).
    let ownershipScope;
    let ownerUserId = '';
    if (usesAnchor) {
      try {
        // The declaration must agree with the root's manifest identity
        // (`APP_ACCESS_TOKEN_SPEC.md` §3): a release token cannot resolve another
        // tenant, or an organization the application is not bound to.
        assertSurfaceAccessTokenIdentity({ rootDir: root, surface, accessToken: surface.accessToken });
      } catch (error) {
        failures.push({
          profileId: surfaceId,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      try {
        ({ ownershipScope } = resolveApplicationOwnershipScope(surface.accessToken, env));
        if (ownershipScope === 'USER') {
          ({ userId: ownerUserId } = resolveApplicationOwnerUserId(surface.accessToken, env));
        }
      } catch (error) {
        failures.push({
          profileId: surfaceId,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    // A legacy surface without an `accessToken` input has no deployment anchor;
    // its manifest identity is compared instead.
    const manifestAppId = manifest?.backend?.appId ?? manifest?.app?.key;
    const excluded = new Set(surface.excludeProfiles ?? []);
    for (const profileId of releaseProfiles) {
      const filePath = profilePath(appRoot, format, profileId);
      if (excluded.has(profileId) && !existsSync(filePath)) {
        continue;
      }
      let appId = manifestAppId;
      let resolution = null;
      if (usesAnchor) {
        try {
          resolution = resolveSurfaceAnchor({
            rootDir: root,
            surface,
            profileId,
            env,
            deploymentConfigPath: DEFAULT_DEPLOYMENT_CONFIG_PATH,
          });
          appId = resolution.appId;
        } catch (error) {
          if (isMissingAppIdEnvironmentError(error)) {
            const entry = {
              profileId: `${surfaceId}/${profileId}`,
              reason: `${anchorVariables(error, surfaceId)} is required to verify this release surface's public application token`,
            };
            if (requireAnchor) {
              failures.push(entry);
            } else {
              skippedSurfaces.push(entry);
            }
            continue;
          }
          failures.push({
            profileId: `${surfaceId}/${profileId}`,
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }
      if (!existsSync(filePath)) {
        failures.push({
          profileId: `${surfaceId}/${profileId}`,
          reason: `missing ${path.relative(root, filePath).replaceAll('\\', '/')}`,
        });
        continue;
      }
      const token = readToken(filePath);
      if (!token) {
        failures.push({ profileId: `${surfaceId}/${profileId}`, reason: 'SDKWORK_ACCESS_TOKEN is missing or empty' });
        continue;
      }
      let payload;
      try {
        ({ payload } = decodeApplicationAccessToken(token));
      } catch (error) {
        failures.push({
          profileId: `${surfaceId}/${profileId}`,
          reason: error instanceof Error ? error.message.split('\n')[0] : String(error),
        });
        continue;
      }
      if (
        isApplicationAccessTokenPendingAppId(payload.app_id, resolution?.baseEnvName)
        || isApplicationAccessTokenPendingAppId(payload.aud, resolution?.baseEnvName)
      ) {
        const file = path.relative(root, filePath).replaceAll('\\', '/');
        pending.push({ profileId: `${surfaceId}/${profileId}`, file });
        if (requireAnchor) {
          const provenance = resolution ? ` (from ${resolution.envName}=${appId})` : '';
          failures.push({
            profileId: `${surfaceId}/${profileId}`,
            reason: `needs materialization: ${file} still carries the ${PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID} `
              + `placeholder instead of ${appId}${provenance}`,
          });
        }
        continue;
      }
      try {
        const environment = profileId.split('.')[1];
        const deploymentProfile = profileId.split('.')[0];
        // The decode above only classifies the pending placeholder; reuse the
        // token validator for the claim checks.
        assertApplicationAccessToken(token, {
          environment,
          deploymentProfile,
          ...(appId ? { appId } : {}),
          // The materializer derives `organization_id` from the surface
          // declaration, so the release gate compares the same value instead of
          // assuming a tenant-level (0) token.
          ...(usesAnchor
            ? { organizationId: String(surface.accessToken.organizationId ?? '0').trim() }
            : {}),
          ...(ownershipScope ? { ownershipScope } : {}),
          ...(ownerUserId ? { ownerUserId } : {}),
        });
        checked.push(`${surfaceId}/${profileId}`);
      } catch (error) {
        failures.push({
          profileId: `${surfaceId}/${profileId}`,
          reason: error instanceof Error ? error.message.split('\n')[0] : String(error),
        });
      }
    }
  }

  if (
    checked.length === 0
    && failures.length === 0
    && skippedSurfaces.length === 0
    && pending.length === 0
  ) {
    failures.push({
      profileId: '<matrix>',
      reason: `no client surface covers ${environments.join(', ')}`,
    });
  }
  return { root, checked, pending, skippedSurfaces, failures };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const environments = options.profiles.length > 0
    ? options.profiles.map((profile) => profile.split('.').pop())
    : DEFAULT_RELEASE_ENVIRONMENTS;
  const result = checkReleaseAccessTokenEnv(options.root, {
    environments,
    allowNoSurfaces: options.allowNoSurfaces,
    requireAnchor: options.requireAnchor,
    surfaceIds: options.surfaceIds,
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.failures.length === 0) {
      console.log(`release access-token preflight passed: ${result.checked.length} surface/profile pair(s)`);
      for (const entry of result.skippedSurfaces ?? []) {
        console.log(`  - skipped ${entry.profileId}: ${entry.reason}`);
      }
      for (const entry of result.pending ?? []) {
        console.log(`  - needs materialization: ${entry.profileId} (${entry.file})`);
      }
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
