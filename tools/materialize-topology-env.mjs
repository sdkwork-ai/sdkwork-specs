#!/usr/bin/env node

/**
 * Materialize inherited topology env layers into the resolved per-profile file.
 *
 * Authority: `ENVIRONMENT_SPEC.md` §5.1.7.1.
 *
 * Layers, lowest precedence first:
 *   etc/topology/base.env
 *   etc/topology/<deployment-profile>.base.env
 *   etc/topology/overrides/<deployment-profile>.<environment>.env
 *
 * Output:
 *   etc/topology/<deployment-profile>.<environment>.env
 *
 * The output is generated and must not be hand-edited. Every existing consumer
 * (dev runner, server loader, client env materializer) keeps reading the resolved
 * file, so inheritance is a source-authoring concern only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseClientEnvDotenv } from './materialize-client-env.mjs';

const PROFILE_ID_PATTERN = /^(?:standalone|cloud)\.(?:development|test|staging|demo|production)$/u;
const DEFAULT_IDENTITY_KEYS = {
  deploymentProfile: 'SDKWORK_DEPLOYMENT_PROFILE',
  environment: 'SDKWORK_ENVIRONMENT',
  profileId: 'SDKWORK_PROFILE_ID',
};
const SECRET_KEY_PATTERN = /(?:^|_)(?:ACCESS_TOKEN|AUTH_TOKEN|REFRESH_TOKEN|API_KEY|SECRET|PASSWORD|PRIVATE_KEY|DATABASE_URL|REDIS_URL)(?:$|_)/u;
const SECRET_FILE_SUFFIX = /_(?:FILE|PATH)$/u;
const INTERPOLATION_PATTERN = /\$\{([A-Z0-9_]+)\}/gu;

function parseArgs(argv) {
  const options = { root: process.cwd(), profile: '', check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check') {
      options.check = true;
      continue;
    }
    if (token === '--root' || token === '--profile') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }
      options[token.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported topology env option: ${token}`);
  }
  options.root = path.resolve(options.root);
  if (options.profile && !PROFILE_ID_PATTERN.test(options.profile)) {
    throw new Error('--profile must be <standalone|cloud>.<environment>.');
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function readLayer(filePath, label, { allowMissing = false } = {}) {
  if (!existsSync(filePath)) {
    if (allowMissing) {
      return null;
    }
    throw new Error(`Required env layer is missing: ${label} (${filePath}).`);
  }
  const contents = readFileSync(filePath, 'utf8');
  const values = parseClientEnvDotenv(contents);
  const seen = new Set();
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
    if (seen.has(key)) {
      throw new Error(`${label} declares ${key} more than once; put the value in exactly one layer.`);
    }
    seen.add(key);
  }
  return { label, path: filePath, contents, values, keys: Object.keys(values) };
}

function isSecretKey(key) {
  if (SECRET_FILE_SUFFIX.test(key)) {
    return false;
  }
  return SECRET_KEY_PATTERN.test(key);
}

function assertNoSecretsInBase(layer) {
  const offenders = layer.keys.filter(isSecretKey);
  if (offenders.length > 0) {
    throw new Error(
      `${layer.label} is a base layer and must not contain secrets: ${offenders.join(', ')}. `
      + 'Move the value to the profile override or a protected deployment secret.',
    );
  }
}

function expandInterpolation(values, label) {
  const expanded = {};
  const resolving = new Set();
  const resolveValue = (key) => {
    if (Object.hasOwn(expanded, key)) {
      return expanded[key];
    }
    if (resolving.has(key)) {
      throw new Error(`${label} has a ${'${...}'} cycle involving ${key}.`);
    }
    const raw = String(values[key] ?? '');
    resolving.add(key);
    const value = raw.replace(INTERPOLATION_PATTERN, (_, reference) => {
      if (!Object.hasOwn(values, reference)) {
        throw new Error(`${label} references $${`{${reference}}`} from ${key}, but ${reference} is not defined.`);
      }
      return resolveValue(reference);
    });
    resolving.delete(key);
    expanded[key] = value;
    return value;
  };
  for (const key of Object.keys(values)) {
    resolveValue(key);
  }
  return expanded;
}

export function resolveTopologyIdentityKeys(rootDir) {
  const specPath = path.join(rootDir, 'specs', 'topology.spec.json');
  if (!existsSync(specPath)) {
    return { ...DEFAULT_IDENTITY_KEYS };
  }
  const spec = readJson(specPath);
  const envKeys = spec.envKeys ?? {};
  return {
    deploymentProfile: String(envKeys.deploymentProfile ?? DEFAULT_IDENTITY_KEYS.deploymentProfile).trim(),
    environment: String(envKeys.environment ?? DEFAULT_IDENTITY_KEYS.environment).trim(),
    profileId: String(envKeys.profileId ?? DEFAULT_IDENTITY_KEYS.profileId).trim(),
  };
}

export function mergeTopologyLayers(layers, profileId, identityKeys = DEFAULT_IDENTITY_KEYS) {
  const [deploymentProfile, environment] = profileId.split('.');
  const merged = {};
  const winningLayer = {};
  for (const layer of layers) {
    for (const key of layer.keys) {
      merged[key] = layer.values[key];
      winningLayer[key] = layer.label;
    }
  }
  // A profile needs no override file when it has no deltas. The identity keys
  // are generated from the profile id and the repository's topology spec; an
  // explicit conflicting value in a layer still fails below.
  for (const [key, expected] of Object.entries({
    [identityKeys.deploymentProfile]: deploymentProfile,
    [identityKeys.environment]: environment,
    [identityKeys.profileId]: profileId,
  })) {
    if (!Object.hasOwn(merged, key)) {
      merged[key] = expected;
      winningLayer[key] = '<profile-id>';
    }
  }
  for (const [key, expected] of Object.entries({
    [identityKeys.deploymentProfile]: deploymentProfile,
    [identityKeys.environment]: environment,
    [identityKeys.profileId]: profileId,
  })) {
    const actual = String(merged[key] ?? '').trim();
    if (actual !== expected) {
      throw new Error(`${profileId} resolved ${key}=${actual || '<empty>'}, expected ${expected}.`);
    }
  }
  const expanded = expandInterpolation(merged, profileId);
  return { expanded, winningLayer, layers };
}

function serializeValue(value) {
  const text = String(value ?? '');
  if (text.length === 0 || /[\s#'"]/u.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function renderResolved({ profileId, expanded, winningLayer, layers }, { relativeTo }) {
  const lines = [
    '# GENERATED FILE - DO NOT EDIT.',
    `# Profile: ${profileId}`,
    '# Layers (lowest to highest):',
    ...layers.map((layer) => `#   ${path.relative(relativeTo, layer.path).replaceAll('\\', '/')}`),
    '# Regenerate with: node <sdkwork-specs>/tools/materialize-topology-env.mjs --root <repository>',
  ];
  for (const layer of layers) {
    const owned = layer.keys.filter((key) => winningLayer[key] === layer.label);
    if (owned.length === 0) {
      continue;
    }
    lines.push('', `# --- ${layer.label} ---`);
    for (const key of owned) {
      lines.push(`${key}=${serializeValue(expanded[key])}`);
    }
  }
  const generatedKeys = Object.keys(winningLayer).filter((key) => winningLayer[key] === '<profile-id>');
  if (generatedKeys.length > 0) {
    lines.push('', '# --- profile-id (generated) ---');
    for (const key of generatedKeys) {
      lines.push(`${key}=${serializeValue(expanded[key])}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function materializeTopologyEnv({ root = process.cwd(), profile = '', check = false } = {}) {
  const rootDir = path.resolve(root);
  const etcDir = path.join(rootDir, 'etc');
  const deploymentConfigPath = path.join(etcDir, 'sdkwork.deployment.config.json');
  if (!existsSync(deploymentConfigPath)) {
    throw new Error(`Deployment config is missing: ${deploymentConfigPath}.`);
  }
  const deployment = readJson(deploymentConfigPath);
  const declaredProfiles = Object.keys(deployment.profiles ?? {}).filter((id) => PROFILE_ID_PATTERN.test(id));
  if (declaredProfiles.length === 0) {
    throw new Error(`${deploymentConfigPath} declares no <deployment-profile>.<environment> profiles.`);
  }
  const profiles = profile ? [profile] : declaredProfiles;
  if (profile && !declaredProfiles.includes(profile)) {
    throw new Error(`Profile ${profile} is not declared in ${deploymentConfigPath}.`);
  }

  const topologyDir = path.join(etcDir, 'topology');
  const identityKeys = resolveTopologyIdentityKeys(rootDir);
  const results = [];
  for (const profileId of profiles) {
    const [deploymentProfile, environment] = profileId.split('.');
    const layerSpecs = [
      { file: path.join(topologyDir, 'base.env'), label: 'base.env', allowMissing: true, base: true },
      {
        file: path.join(topologyDir, 'environments', `${environment}.base.env`),
        label: `environments/${environment}.base.env`,
        allowMissing: true,
        base: true,
      },
      {
        file: path.join(topologyDir, `${deploymentProfile}.base.env`),
        label: `${deploymentProfile}.base.env`,
        allowMissing: true,
        base: true,
      },
      {
        file: path.join(topologyDir, 'overrides', `${profileId}.env`),
        label: `overrides/${profileId}.env`,
        allowMissing: true,
      },
    ];
    const layers = [];
    for (const spec of layerSpecs) {
      const layer = readLayer(spec.file, spec.label, { allowMissing: spec.allowMissing });
      if (!layer) {
        continue;
      }
      if (spec.base) {
        assertNoSecretsInBase(layer);
      }
      layers.push(layer);
    }
    const merged = mergeTopologyLayers(layers, profileId, identityKeys);
    const content = renderResolved({ ...merged, profileId }, { relativeTo: rootDir });
    const outputPath = path.join(topologyDir, `${profileId}.env`);
    if (check) {
      const actual = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
      if (actual !== content) {
        throw new Error(`${path.relative(rootDir, outputPath)} is missing or stale. Run the topology env materializer.`);
      }
    } else {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, content, 'utf8');
    }
    results.push(outputPath);
  }
  return results;
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const files = materializeTopologyEnv(options);
  console.log(`SDKWork topology env profiles ${options.check ? 'verified' : 'materialized'}: ${files.length} files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
