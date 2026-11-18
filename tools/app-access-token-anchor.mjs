#!/usr/bin/env node

/**
 * Per-surface resolution of a public application token's deployment anchor.
 *
 * Every shipped surface registers as its own deploy application
 * (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §5/§11), so one repository may hold
 * one anchor per surface. The materializer reads a surface's anchor from the
 * surface-scoped variable `<BASE>_<SURFACE>` in the process environment, then
 * from the same variable recorded in the resolved deployment profile, then from
 * the repository-level `<BASE>` variable (`materialize-client-env.mjs`
 * `resolveSurfaceAccessTokenAppId`). This module exposes that exact resolution to
 * verification gates, so a gate can never disagree with the materializer about
 * which anchor a surface is expected to carry.
 *
 * Read-only: it never rewrites a token or an env file.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  resolveApplicationAccessTokenAppId,
  resolveApplicationAccessTokenEnvName,
  surfaceApplicationTokenEnvName,
} from './app-access-token.mjs';
import {
  parseClientEnvDotenv,
  resolveSurfaceAccessTokenAppId,
} from './materialize-client-env.mjs';

export const DEFAULT_DEPLOYMENT_CONFIG_PATH = 'etc/sdkwork.deployment.config.json';

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function relativeTo(rootDir, filePath) {
  return path.relative(rootDir, filePath).replaceAll('\\', '/');
}

/**
 * Env files that may record one profile's surface anchor.
 *
 * The resolved profile file named by `etc/sdkwork.deployment.config.json` is
 * first because it is the exact file the materializer reads; the authored
 * override layer is where a per-surface registration records the anchor before
 * the resolved file is regenerated. Both are non-recursive by construction.
 * @param rootDir - repository root.
 * @param profileId - `<deployment-profile>.<environment>`.
 * @param deploymentConfigPath - repository-relative deployment index path.
 * @returns candidate absolute file paths, highest precedence first.
 */
export function surfaceAnchorEnvFiles(
  rootDir,
  profileId,
  deploymentConfigPath = DEFAULT_DEPLOYMENT_CONFIG_PATH,
) {
  const root = path.resolve(rootDir);
  const files = [];
  const configFile = path.resolve(root, deploymentConfigPath);
  if (existsSync(configFile)) {
    const config = readJson(configFile);
    const configured = String(config?.profiles?.[profileId]?.config ?? '').trim();
    if (configured) {
      const profileFile = path.resolve(root, 'etc', configured);
      const relative = path.relative(root, profileFile);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        files.push(profileFile);
      }
    }
  }
  files.push(path.join(root, 'etc', 'topology', 'overrides', `${profileId}.env`));
  return [...new Set(files)];
}

/**
 * Read one recorded anchor variable out of a profile's env layer.
 *
 * The resolved deployment profile wins over the authored override layer, which
 * mirrors the materializer's single-source read (`loadSourceProfile`). A missing
 * file or variable yields an empty value, so the caller can fall back to the
 * repository-level variable.
 * @param rootDir - repository root.
 * @param profileId - profile whose env layer is read.
 * @param envName - anchor variable name.
 * @param deploymentConfigPath - repository-relative deployment index path.
 * @returns the recorded value plus the repository-relative source file.
 * @throws when a candidate layer is not valid dotenv.
 */
export function readRecordedSurfaceAnchor(
  rootDir,
  profileId,
  envName,
  deploymentConfigPath = DEFAULT_DEPLOYMENT_CONFIG_PATH,
) {
  for (const filePath of surfaceAnchorEnvFiles(rootDir, profileId, deploymentConfigPath)) {
    if (!existsSync(filePath)) {
      continue;
    }
    const values = parseClientEnvDotenv(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
    const value = String(values[envName] ?? '').trim();
    if (value) {
      return { value, source: relativeTo(path.resolve(rootDir), filePath) };
    }
  }
  return { value: '', source: '' };
}

/**
 * Expected anchor of one (surface, profile) pair, plus the layer it came from.
 *
 * The value is resolved by the materializer's own
 * `resolveSurfaceAccessTokenAppId`, so the precedence cannot drift:
 *   1. the surface-scoped variable in the process environment;
 *   2. the same variable recorded in the resolved profile env layer, then in the
 *      authored `etc/topology/overrides/<profile>.env` layer;
 *   3. the declared repository-level variable.
 * The returned `source` is reporting metadata only; it names the layer that won.
 * @param options - repository root, declared surface, profile, env bag, deployment index path.
 * @returns the expected app id plus variable and layer provenance.
 * @throws {MissingAppIdEnvironmentError} when no layer carries an anchor.
 */
export function resolveSurfaceAnchor({
  rootDir,
  surface,
  profileId,
  env = process.env,
  deploymentConfigPath = DEFAULT_DEPLOYMENT_CONFIG_PATH,
} = {}) {
  const surfaceId = String(surface?.id ?? '').trim();
  const spec = surface?.accessToken;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`${surfaceId || 'surface'}: accessToken is required.`);
  }
  const baseEnvName = resolveApplicationAccessTokenEnvName(spec);
  const root = path.resolve(rootDir);
  if (!baseEnvName) {
    // A literal `accessToken.appId` is repository-owned: it takes no environment
    // anchor and is compared as declared.
    const { appId } = resolveApplicationAccessTokenAppId(spec, env);
    return {
      surfaceId,
      appId,
      baseEnvName: '',
      surfaceEnvName: '',
      envName: '',
      source: 'literal',
      sourceFile: '',
    };
  }
  const surfaceEnvName = surfaceApplicationTokenEnvName(baseEnvName, surfaceId);
  if (!surfaceEnvName) {
    throw new Error(
      `${surfaceId || 'surface'}: surface id must yield a surface-scoped anchor variable; `
      + 'the declared id has no name characters',
    );
  }
  const recorded = readRecordedSurfaceAnchor(root, profileId, surfaceEnvName, deploymentConfigPath);
  const explicit = String(env?.[surfaceEnvName] ?? '').trim();
  const repository = String(env?.[baseEnvName] ?? '').trim();
  let source = '';
  if (explicit) {
    source = 'environment';
  } else if (recorded.value) {
    source = 'recorded';
  } else if (repository) {
    source = 'repository';
  }
  const appId = resolveSurfaceAccessTokenAppId(
    surface,
    env,
    recorded.value ? { [surfaceEnvName]: recorded.value } : {},
  );
  return {
    surfaceId,
    appId,
    baseEnvName,
    surfaceEnvName,
    envName: source === 'repository' ? baseEnvName : surfaceEnvName,
    source,
    sourceFile: source === 'recorded' ? recorded.source : '',
  };
}

