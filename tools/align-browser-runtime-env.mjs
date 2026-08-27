#!/usr/bin/env node

/**
 * Align every Adaptive Web app surface to the standard browser runtime-env
 * matrix (ENVIRONMENT_SPEC.md §5.1.0.1):
 *   apps/<app>/etc/browser/runtime-env.<deploymentProfile>.<environment>.json
 * for all eight profile×environment combinations (standalone/cloud ×
 * development/test/staging/production), wired through the app-level
 * etc/sdkwork.deployment.config.json `profiles` map.
 *
 * Values per profile:
 *   standalone -> browserOriginMode same-origin, every SDK API base URL `/`
 *   cloud      -> browserOriginMode cross-origin, every SDK API base URL equal
 *                 to the repository deployment config's environment
 *                 `cloudApiBaseUrl` origin (`api-dev.<domain>` … `api.<domain>`)
 *
 * Existing runtime-env files are migrated: SDK base URL keys are normalized to
 * the profile standard, non-SDK keys (navigation URLs, locales) are preserved
 * from the first existing source.
 *
 * Usage:
 *   node tools/align-browser-runtime-env.mjs --workspace <sdkwork-space-root>
 *   node tools/align-browser-runtime-env.mjs --root <repo> [--dry-run]
 *
 * Run `align-cloud-api-base-url.mjs` first when topology/webserver hosts change.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  attachCloudApiBaseUrls,
  cloudSdkBaseUrlMaterializationValue,
  ENVIRONMENTS,
  resolveCloudApiOriginListForRepository,
  SDK_BASE_URL_KEYS,
} from './browser-cloud-api-base.mjs';
import { discoverBrowserAppRoots } from './build-browser-client.mjs';

const LIFECYCLE_ENVIRONMENTS = [...ENVIRONMENTS];
const PROFILES = ['standalone', 'cloud'];
const PROFILE_MATRIX = PROFILES.flatMap((profile) =>
  LIFECYCLE_ENVIRONMENTS.map((environment) => `${profile}.${environment}`),
);
const COMPONENT_DEPLOYMENT_SCHEMA = {
  schemaVersion: 1,
  kind: 'sdkwork.component-deployment',
  parentDeploymentConfig: '../../../etc/sdkwork.deployment.config.json',
  parentTopologySpec: '../../../specs/topology.spec.json',
  runtimeTarget: 'browser',
  materialization: {
    authority: '../../../etc/sdkwork.deployment.config.json',
    command: 'node scripts/materialize-runtime-env.mjs',
    format: 'json',
    output: '../public/runtime-env.json',
    checkMode: '--check',
  },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function findBrowserRuntimeEnvDir(appRoot) {
  for (const relative of ['etc/browser', 'config/browser']) {
    const candidate = path.join(appRoot, relative);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return path.join(appRoot, 'etc', 'browser');
}

function resolveCloudApiBaseUrlByEnvironment(repositoryRoot) {
  const deploymentIndex = path.join(repositoryRoot, 'etc', 'sdkwork.deployment.config.json');
  if (!fs.existsSync(deploymentIndex)) {
    return null;
  }
  let deployment;
  try {
    deployment = readJson(deploymentIndex);
  } catch {
    return null;
  }
  const result = {};
  for (const environment of LIFECYCLE_ENVIRONMENTS) {
    try {
      result[environment] = resolveCloudApiOriginListForRepository({
        repositoryRoot,
        environment,
        deployment,
        preferTopology: true,
      });
    } catch {
      return null;
    }
  }
  return result;
}

const NON_SDK_KEYS = new Set([
  'environment',
  'deploymentProfile',
  'profileId',
  'runtimeTarget',
  'browserOriginMode',
]);

/**
 * Preserve non-SDK fields from an existing runtime source (navigation URLs,
 * locales, feature flags). Exact profileId matches win; otherwise the first
 * source for the same environment; otherwise any source (missing fields only).
 */
function collectPreservedFields(existingSources, profileId) {
  const byProfile = existingSources.find((entry) => entry.value.profileId === profileId);
  const byEnvironment = byProfile
    ?? existingSources.find((entry) => entry.value.environment === profileId.split('.')[1]);
  const primary = byProfile ?? byEnvironment;
  const preserved = {};
  if (primary) {
    for (const [key, value] of Object.entries(primary.value)) {
      if (SDK_BASE_URL_KEYS.includes(key) || NON_SDK_KEYS.has(key)) continue;
      preserved[key] = value;
    }
  }
  if (!byProfile) {
    // Fill any missing keys from any other source (never overrides primary).
    for (const entry of existingSources) {
      if (entry === primary) continue;
      for (const [key, value] of Object.entries(entry.value)) {
        if (SDK_BASE_URL_KEYS.includes(key) || NON_SDK_KEYS.has(key)) continue;
        if (preserved[key] === undefined) {
          preserved[key] = value;
        }
      }
    }
  }
  return preserved;
}

function existingRuntimeEnvSources(browserDir) {
  if (!fs.existsSync(browserDir)) {
    return [];
  }
  return fs.readdirSync(browserDir)
    .filter((name) => name.startsWith('runtime-env.') && name.endsWith('.json'))
    .map((name) => {
      try {
        return { name, value: readJson(path.join(browserDir, name)) };
      } catch {
        return null;
      }
    })
    .filter((entry) => entry !== null);
}

export function alignBrowserRuntimeEnv(repositoryRoot, options = {}) {
  const dryRun = options.dryRun === true;
  const changes = [];
  const apps = discoverBrowserAppRoots(repositoryRoot);
  const cloudApiBaseUrl = resolveCloudApiBaseUrlByEnvironment(repositoryRoot);
  if (!cloudApiBaseUrl) {
    throw new Error(
      `repository deployment config must declare environments.<env>.cloudApiBaseUrl for every environment: ${repositoryRoot}/etc/sdkwork.deployment.config.json`,
    );
  }

  // Respect a standalone-only declaration (for example sdkwork-webserver,
  // SDKWORK_WEBSERVER_SPEC.md §17.4): only the standalone matrix is aligned.
  const manifestPath = path.join(repositoryRoot, 'sdkwork.app.config.json');
  const manifestProfiles = fs.existsSync(manifestPath)
    ? readJson(manifestPath).runtime?.supportedDeploymentProfiles
    : undefined;
  const profiles = Array.isArray(manifestProfiles) && manifestProfiles.length > 0
    ? [...new Set(manifestProfiles.map((profile) => String(profile).trim()))]
        .filter((profile) => PROFILES.includes(profile))
    : PROFILES;
  const profileMatrix = profiles.flatMap((profile) =>
    LIFECYCLE_ENVIRONMENTS.map((environment) => `${profile}.${environment}`),
  );

  for (const app of apps) {
    const deploymentConfigPath = path.join(app.root, 'etc', 'sdkwork.deployment.config.json');
    const browserDir = findBrowserRuntimeEnvDir(app.root);
    const existing = existingRuntimeEnvSources(browserDir);
    const written = [];
    const profileMap = {};

    for (const profile of profiles) {
      for (const environment of LIFECYCLE_ENVIRONMENTS) {
        const profileId = `${profile}.${environment}`;
        const sameOrigin = profile === 'standalone';
        const sdkUrl = sameOrigin ? '/' : cloudSdkBaseUrlMaterializationValue(cloudApiBaseUrl[environment]);
        const doc = {
          environment,
          deploymentProfile: profile,
          profileId,
          runtimeTarget: 'browser',
          browserOriginMode: sameOrigin ? 'same-origin' : 'cross-origin',
          ...collectPreservedFields(existing, profileId),
        };
        for (const key of SDK_BASE_URL_KEYS) {
          doc[key] = sdkUrl;
        }
        if (!sameOrigin) {
          attachCloudApiBaseUrls(doc, cloudApiBaseUrl[environment]);
        }
        const fileName = `runtime-env.${profileId}.json`;
        const targetPath = path.join(browserDir, fileName);
        profileMap[profileId] = {
          source: path.relative(path.dirname(deploymentConfigPath), targetPath).replaceAll('\\', '/'),
        };
        const desired = `${JSON.stringify(doc, null, 2)}\n`;
        const current = fs.existsSync(targetPath)
          ? fs.readFileSync(targetPath, 'utf8').replace(/\r\n/g, '\n')
          : null;
        if (current !== desired) {
          written.push(fileName);
          if (!dryRun) {
            fs.mkdirSync(browserDir, { recursive: true });
            fs.writeFileSync(targetPath, desired, 'utf8');
          }
        }
      }
    }

    // Remove legacy or non-declared runtime-env files.
    const canonicalNames = new Set(profileMatrix.map((profileId) => `runtime-env.${profileId}.json`));
    for (const entry of existing) {
      if (!canonicalNames.has(entry.name) && !dryRun) {
        fs.rmSync(path.join(browserDir, entry.name));
        written.push(`removed ${entry.name}`);
      }
    }

    let deploymentChanged = false;
    if (fs.existsSync(deploymentConfigPath)) {
      const deployment = readJson(deploymentConfigPath);
      deploymentChanged = JSON.stringify(deployment.profiles ?? {}) !== JSON.stringify(profileMap);
      deployment.profiles = profileMap;
      if (!deployment.materialization) {
        deployment.materialization = COMPONENT_DEPLOYMENT_SCHEMA.materialization;
        deployment.parentDeploymentConfig ??= COMPONENT_DEPLOYMENT_SCHEMA.parentDeploymentConfig;
        deployment.parentTopologySpec ??= COMPONENT_DEPLOYMENT_SCHEMA.parentTopologySpec;
        deployment.runtimeTarget ??= COMPONENT_DEPLOYMENT_SCHEMA.runtimeTarget;
        deploymentChanged = true;
      }
      if (deploymentChanged && !dryRun) writeJson(deploymentConfigPath, deployment);
    } else {
      deploymentChanged = true;
      if (!dryRun) {
        fs.mkdirSync(path.dirname(deploymentConfigPath), { recursive: true });
        writeJson(deploymentConfigPath, {
          ...COMPONENT_DEPLOYMENT_SCHEMA,
          application: app.name,
          profiles: profileMap,
        });
      }
    }

    if (written.length > 0 || deploymentChanged) {
      changes.push(`${app.relative}: ${written.length} runtime-env file(s) ${dryRun ? 'would be' : ''} aligned, deployment config ${deploymentChanged ? 'updated' : 'ok'}`);
    }
  }
  return changes;
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
      root: { type: 'string' },
      workspace: { type: 'string' },
    },
  });

  if (values.help) {
    console.log('Usage: node tools/align-browser-runtime-env.mjs --workspace <sdkwork-space-root>');
    console.log('       node tools/align-browser-runtime-env.mjs --root <repo> [--dry-run]');
    return;
  }

  const targets = [];
  if (values.workspace) {
    const workspaceRoot = path.resolve(values.workspace);
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) {
        continue;
      }
      const repoRoot = path.join(workspaceRoot, entry.name);
      if (discoverBrowserAppRoots(repoRoot).length > 0) {
        targets.push(repoRoot);
      }
    }
  } else if (values.root) {
    targets.push(path.resolve(values.root));
  } else {
    throw new Error('--root or --workspace is required');
  }

  let totalChanges = 0;
  for (const target of targets.sort()) {
    try {
      const changes = alignBrowserRuntimeEnv(target, { dryRun: values['dry-run'] });
      if (changes.length === 0) {
        continue;
      }
      totalChanges += changes.length;
      console.log(`${path.basename(target)}: ${values['dry-run'] ? 'would update' : 'updated'} ${changes.length} app(s)`);
      changes.forEach((change) => console.log(`  - ${change}`));
    } catch (error) {
      console.log(`${path.basename(target)}: SKIPPED (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (totalChanges === 0) {
    console.log('no browser runtime-env changes required');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
