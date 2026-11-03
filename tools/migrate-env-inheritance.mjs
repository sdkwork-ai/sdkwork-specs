#!/usr/bin/env node

/**
 * Migrate a legacy flat topology profile set into inherited env layers.
 *
 * Authority: `ENVIRONMENT_SPEC.md` §5.1.7.1.
 *
 * Input:  etc/topology/<profile-id>.env for every declared profile.
 * Output: etc/topology/base.env
 *         etc/topology/environments/<environment>.base.env
 *         etc/topology/<deployment-profile>.base.env
 *         etc/topology/overrides/<profile-id>.env
 *         regenerated etc/topology/<profile-id>.env
 *
 * The migration is semantic: the merged layers must produce exactly the same
 * key/value map as the original profile before any file is written. Secret
 * values are never hoisted into a base layer; they stay in overrides.
 *
 * Usage:
 *   node <sdkwork-specs>/tools/migrate-env-inheritance.mjs --root <repo> [--dry-run] [--force]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseClientEnvDotenv } from './materialize-client-env.mjs';
import {
  materializeTopologyEnv,
  mergeTopologyLayers,
  resolveTopologyIdentityKeys,
} from './materialize-topology-env.mjs';

const PROFILE_ID_PATTERN = /^(?:standalone|cloud)\.(?:development|test|staging|demo|production)$/u;
const SECRET_KEY_PATTERN = /(?:^|_)(?:ACCESS_TOKEN|AUTH_TOKEN|REFRESH_TOKEN|API_KEY|SECRET|PASSWORD|PRIVATE_KEY|DATABASE_URL|REDIS_URL)(?:$|_)/u;
const SECRET_FILE_SUFFIX = /_(?:FILE|PATH)$/u;

function parseArgs(argv) {
  const options = { root: process.cwd(), dryRun: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token === '--force') {
      options.force = true;
      continue;
    }
    if (token === '--root') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error('--root requires a value.');
      }
      options.root = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported env inheritance migration option: ${token}`);
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function isSecretKey(key) {
  if (SECRET_FILE_SUFFIX.test(key)) {
    return false;
  }
  return SECRET_KEY_PATTERN.test(key);
}

function readProfiles(rootDir) {
  const configPath = path.join(rootDir, 'etc', 'sdkwork.deployment.config.json');
  if (!existsSync(configPath)) {
    throw new Error(`Deployment config is missing: ${configPath}.`);
  }
  const deployment = readJson(configPath);
  const profiles = Object.keys(deployment.profiles ?? {}).filter((id) => PROFILE_ID_PATTERN.test(id));
  if (profiles.length === 0) {
    throw new Error(`${configPath} declares no <deployment-profile>.<environment> profiles.`);
  }
  const topologyDir = path.join(rootDir, 'etc', 'topology');
  const identityKeys = resolveTopologyIdentityKeys(rootDir);
  const identityKeySet = new Set(Object.values(identityKeys));
  const values = {};
  for (const profileId of profiles) {
    const filePath = path.join(topologyDir, `${profileId}.env`);
    if (!existsSync(filePath)) {
      throw new Error(`Legacy profile is missing: ${path.relative(rootDir, filePath)}.`);
    }
    const [deploymentProfile, environment] = profileId.split('.');
    const profileValues = parseClientEnvDotenv(readFileSync(filePath, 'utf8'));
    // Remove identity keys injected by an earlier migration into a repository
    // whose topology spec uses a different application prefix.
    for (const key of [
      'SDKWORK_IM_DEPLOYMENT_PROFILE',
      'SDKWORK_IM_ENVIRONMENT',
      'SDKWORK_IM_PROFILE_ID',
    ]) {
      if (!identityKeySet.has(key)) {
        delete profileValues[key];
      }
    }
    // Migration canonicalizes the three identity keys. Legacy aliases such as
    // `dev`/`prod` or a stale profile id are corrected here, not preserved.
    profileValues[identityKeys.deploymentProfile] = deploymentProfile;
    profileValues[identityKeys.environment] = environment;
    profileValues[identityKeys.profileId] = profileId;
    values[profileId] = profileValues;
  }
  return { deployment, profiles, topologyDir, identityKeys, values };
}

function majorityValue(profileIds, values, key, threshold) {
  if (!profileIds.every((profile) => Object.hasOwn(values[profile], key))) {
    return undefined;
  }
  const counts = new Map();
  for (const profile of profileIds) {
    const value = values[profile][key];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const [value, count] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return count >= threshold ? value : undefined;
}

function commonLayer(profileIds, values) {
  if (profileIds.length === 0) {
    return {};
  }
  const threshold = profileIds.length === 1
    ? 1
    : Math.max(2, Math.floor(profileIds.length / 2) + 1);
  const first = values[profileIds[0]];
  const result = {};
  for (const key of Object.keys(first)) {
    if (isSecretKey(key)) {
      continue;
    }
    const value = majorityValue(profileIds, values, key, threshold);
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function keyOrder(profiles, values, keys) {
  const wanted = new Set(keys);
  const seen = new Set();
  const order = [];
  for (const profile of profiles) {
    for (const key of Object.keys(values[profile])) {
      if (wanted.has(key) && !seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  return order;
}

function renderLayer(header, layer, order) {
  const lines = [`# ${header}`];
  for (const key of order) {
    if (Object.hasOwn(layer, key)) {
      lines.push(`${key}=${layer[key]}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function computeLayers(profiles, values) {
  const base = commonLayer(profiles, values);
  const environments = [...new Set(profiles.map((profile) => profile.split('.')[1]))];
  const envBases = {};
  for (const environment of environments) {
    const members = profiles.filter((profile) => profile.endsWith(`.${environment}`));
    envBases[environment] = commonLayer(members, values);
    // A value already equal to the base layer needs no second declaration.
    for (const key of Object.keys(envBases[environment])) {
      if (base[key] === envBases[environment][key]) {
        delete envBases[environment][key];
      }
    }
  }
  const deploymentProfiles = [...new Set(profiles.map((profile) => profile.split('.')[0]))];
  const profileBases = {};
  for (const deploymentProfile of deploymentProfiles) {
    const members = profiles.filter((profile) => profile.startsWith(`${deploymentProfile}.`));
    profileBases[deploymentProfile] = commonLayer(members, values);
    // Drop values already supplied by the base or the environment layer.
    for (const key of Object.keys(profileBases[deploymentProfile])) {
      const value = profileBases[deploymentProfile][key];
      const inherited = base[key] ?? Object.values(envBases)
        .map((layer) => layer[key])
        .find((candidate) => candidate !== undefined);
      if (inherited === value) {
        delete profileBases[deploymentProfile][key];
      }
    }
  }
  const overrides = {};
  for (const profile of profiles) {
    const [deploymentProfile, environment] = profile.split('.');
    const inherited = {
      ...base,
      ...envBases[environment],
      ...profileBases[deploymentProfile],
    };
    const override = {};
    for (const [key, value] of Object.entries(values[profile])) {
      if (inherited[key] !== value) {
        override[key] = value;
      }
    }
    overrides[profile] = override;
  }
  return { base, envBases, profileBases, overrides };
}

function verifyLayers(profiles, values, layers, identityKeys) {
  const allowedGenerated = new Set(Object.values(identityKeys));
  for (const profile of profiles) {
    const [deploymentProfile, environment] = profile.split('.');
    const resolved = {
      ...layers.base,
      ...layers.envBases[environment],
      ...layers.profileBases[deploymentProfile],
      ...layers.overrides[profile],
    };
    const original = values[profile];
    for (const [key, value] of Object.entries(original)) {
      if (resolved[key] !== value) {
        throw new Error(
          `${profile}: migration would change ${key} from ${JSON.stringify(value)} to ${JSON.stringify(resolved[key])}.`,
        );
      }
    }
    for (const key of Object.keys(resolved)) {
      if (!Object.hasOwn(original, key) && !allowedGenerated.has(key)) {
        throw new Error(`${profile}: migration would add unexpected key ${key}.`);
      }
    }
  }
}

function validateIdentityBeforeWrite(profiles, layers, identityKeys) {
  for (const profile of profiles) {
    const [deploymentProfile, environment] = profile.split('.');
    const syntheticLayers = [
      { label: 'base.env', keys: Object.keys(layers.base), values: layers.base },
      {
        label: `environments/${environment}.base.env`,
        keys: Object.keys(layers.envBases[environment]),
        values: layers.envBases[environment],
      },
      {
        label: `${deploymentProfile}.base.env`,
        keys: Object.keys(layers.profileBases[deploymentProfile]),
        values: layers.profileBases[deploymentProfile],
      },
      {
        label: `overrides/${profile}.env`,
        keys: Object.keys(layers.overrides[profile]),
        values: layers.overrides[profile],
      },
    ].filter((layer) => layer.keys.length > 0);
    mergeTopologyLayers(syntheticLayers, profile, identityKeys);
  }
}

export function migrateEnvInheritance({ root = process.cwd(), dryRun = false, force = false } = {}) {
  const rootDir = path.resolve(root);
  const { profiles, topologyDir, identityKeys, values } = readProfiles(rootDir);
  const basePath = path.join(topologyDir, 'base.env');
  if (existsSync(basePath) && !force) {
    throw new Error(`${path.relative(rootDir, basePath)} already exists; pass --force to migrate again.`);
  }
  const layers = computeLayers(profiles, values);
  verifyLayers(profiles, values, layers, identityKeys);
  validateIdentityBeforeWrite(profiles, layers, identityKeys);

  const planned = [
    basePath,
    ...Object.keys(layers.envBases).map((environment) => path.join(topologyDir, 'environments', `${environment}.base.env`)),
    ...Object.keys(layers.profileBases).map((deploymentProfile) => path.join(topologyDir, `${deploymentProfile}.base.env`)),
    ...profiles.map((profile) => path.join(topologyDir, 'overrides', `${profile}.env`)),
  ];
  if (dryRun) {
    return { profiles, layers, planned, written: [] };
  }

  mkdirSync(path.join(topologyDir, 'environments'), { recursive: true });
  mkdirSync(path.join(topologyDir, 'overrides'), { recursive: true });
  writeFileSync(
    basePath,
    renderLayer('SDKWork topology base defaults (all profiles)', layers.base, keyOrder(profiles, values, Object.keys(layers.base))),
    'utf8',
  );
  for (const [environment, layer] of Object.entries(layers.envBases)) {
    writeFileSync(
      path.join(topologyDir, 'environments', `${environment}.base.env`),
      renderLayer(`SDKWork ${environment} defaults (both deployment profiles)`, layer, keyOrder(profiles, values, Object.keys(layer))),
      'utf8',
    );
  }
  for (const [deploymentProfile, layer] of Object.entries(layers.profileBases)) {
    writeFileSync(
      path.join(topologyDir, `${deploymentProfile}.base.env`),
      renderLayer(`SDKWork ${deploymentProfile} topology defaults`, layer, keyOrder(profiles, values, Object.keys(layer))),
      'utf8',
    );
  }
  for (const profile of profiles) {
    writeFileSync(
      path.join(topologyDir, 'overrides', `${profile}.env`),
      renderLayer(`SDKWork ${profile} overrides (edit this file, not the resolved profile)`, layers.overrides[profile], keyOrder(profiles, values, Object.keys(layers.overrides[profile]))),
      'utf8',
    );
  }
  materializeTopologyEnv({ root: rootDir });
  return { profiles, layers, planned, written: planned };
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const result = migrateEnvInheritance(options);
  const baseKeys = Object.keys(result.layers.base).length;
  const envKeys = Object.values(result.layers.envBases).reduce((sum, layer) => sum + Object.keys(layer).length, 0);
  const profileKeys = Object.values(result.layers.profileBases).reduce((sum, layer) => sum + Object.keys(layer).length, 0);
  console.log(
    `env inheritance migration ${options.dryRun ? 'planned' : 'complete'}: ${result.profiles.length} profiles, `
    + `base=${baseKeys} environment=${envKeys} deployment-profile=${profileKeys} files=${result.planned.length}`,
  );
  for (const file of result.planned) {
    console.log(`  ${options.dryRun ? 'would write' : 'wrote'} ${path.relative(options.root, file)}`);
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
