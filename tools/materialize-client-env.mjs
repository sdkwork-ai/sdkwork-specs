#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  cloudSdkBaseUrlMaterializationValue,
  resolveCloudApiOriginListForRepository,
} from './browser-cloud-api-base.mjs';

export const CLIENT_ENV_DEPLOYMENT_PROFILES = ['standalone', 'cloud'];
export const CLIENT_ENVIRONMENTS = ['development', 'test', 'staging', 'demo', 'production'];
export const CLIENT_ENV_PROFILE_IDS = CLIENT_ENV_DEPLOYMENT_PROFILES.flatMap(
  (deploymentProfile) => CLIENT_ENVIRONMENTS.map(
    (environment) => `${deploymentProfile}.${environment}`,
  ),
);

const SECRET_KEY_PATTERN = /(?:ACCESS|AUTH|REFRESH|INGRESS|UPLOAD|API)_TOKEN(?:_|$)|PASSWORD|SECRET|PRIVATE_KEY|DATABASE_URL|REDIS_URL|CREDENTIAL/u;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const DEFAULT_CONFIG_PATH = 'etc/client-env.materialization.json';

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    config: DEFAULT_CONFIG_PATH,
    check: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check') {
      options.check = true;
      continue;
    }
    if (token === '--root' || token === '--config') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }
      options[token.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported client env materialization option: ${token}`);
  }
  return options;
}

function ensureInsideRoot(rootDir, candidatePath, label) {
  const relativePath = path.relative(rootDir, candidatePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside ${rootDir}.`);
  }
  return candidatePath;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

export function parseClientEnvDotenv(source) {
  const values = {};
  for (const rawLine of String(source ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid dotenv line: ${rawLine}`);
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function assertSupportedProfileId(profileId) {
  if (!CLIENT_ENV_PROFILE_IDS.includes(profileId)) {
    throw new Error(`Unsupported client env profile id: ${profileId}.`);
  }
  const [deploymentProfile, environment] = profileId.split('.');
  return { deploymentProfile, environment, profileId };
}

function firstValue(sourceValues, sources) {
  for (const source of sources) {
    const value = String(sourceValues[source] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizeBinding(binding) {
  if (typeof binding === 'string') {
    return { sources: [binding], required: true };
  }
  if (Array.isArray(binding)) {
    return { sources: binding, required: true };
  }
  return {
    sources: Array.isArray(binding?.sources) ? binding.sources : [],
    required: binding?.required !== false,
  };
}

function assertSafeClientKey(key) {
  if (SECRET_KEY_PATTERN.test(key)) {
    throw new Error(`Client env output must not contain secret-bearing key ${key}.`);
  }
}

function assertCloudClientUrls(values, profile) {
  if (profile.deploymentProfile !== 'cloud') {
    return;
  }
  const development = profile.environment === 'development';
  for (const [key, value] of Object.entries(values)) {
    if (!/(?:_URL|_HTTP_URL|_BASE_URL)$/u.test(key) || !value) {
      continue;
    }
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${profile.profileId} ${key} must be an absolute public URL.`);
    }
    if (LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new Error(`${profile.profileId} ${key} must use a remote public host.`);
    }
    if (!development && !['https:', 'wss:'].includes(parsed.protocol)) {
      throw new Error(`${profile.profileId} ${key} must use an explicit remote HTTPS/WSS URL.`);
    }
    if (development && !['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
      throw new Error(`${profile.profileId} ${key} must use an HTTP(S)/WS(S) URL.`);
    }
  }
}

/**
 * Vite dotenv surfaces are dev/runtime conveniences consumed by `vite dev`
 * (`loadEnv` + dev proxy) and by `vite build --mode <profile>`. They must carry
 * single-origin URL values: the ';'-joined multi-origin cloud API materialization
 * is a build/deploy runtime document concern (ENVIRONMENT_SPEC §5.1.0.1) and is
 * not parseable by URL-consuming dev surfaces (vite proxy targets, SDK base URL
 * readers).
 *
 * Cloud profiles therefore keep their topology source values (single origins)
 * except:
 * - cloud.development binds every platform gateway / router application base
 *   URL to the locally started sdkwork-api-cloud-gateway (`pnpm dev`, bind
 *   127.0.0.1:3900) declared via SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL,
 *   so `pnpm dev:cloud` quick-starts and debugs against the local gateway.
 * - higher cloud environments fold the primary (first) registered origin so
 *   stale multi-origin values never leak into dotenv surfaces.
 */
export function applyViteSurfaceCloudValues(values, sourceValues, profile) {
  if (profile.deploymentProfile !== 'cloud') {
    return values;
  }
  const localGatewayUrl = String(sourceValues.SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL ?? '').trim();
  const projected = { ...values };
  for (const [key, value] of Object.entries(projected)) {
    const isGatewayOrApplicationUrl = /PLATFORM_API_GATEWAY_HTTP_URL$|ROUTER_APPLICATION_(?:PUBLIC|OPEN|BACKEND)_HTTP_URL$/u.test(key);
    if (isGatewayOrApplicationUrl && profile.environment === 'development' && localGatewayUrl) {
      projected[key] = localGatewayUrl;
      continue;
    }
    const raw = String(value ?? '');
    if (raw.includes(';')) {
      const primaryOrigin = raw.split(';')[0]?.trim();
      if (primaryOrigin) {
        projected[key] = primaryOrigin;
      }
    }
  }
  return projected;
}

function applyCloudGatewayProjection(values, deploymentIndex, profile, repositoryRoot) {
  if (profile.deploymentProfile !== 'cloud') {
    return values;
  }
  const materialized = cloudSdkBaseUrlMaterializationValue(
    resolveCloudApiOriginListForRepository({
      repositoryRoot,
      environment: profile.environment,
      deployment: deploymentIndex,
      preferTopology: true,
    }),
  );
  const projected = { ...values };
  for (const key of Object.keys(projected)) {
    if (!shouldExpandCloudGatewayKey(key)) {
      continue;
    }
    const value = String(projected[key] ?? '').trim();
    if (!/^https?:\/\//u.test(value)) {
      continue;
    }
    projected[key] = materialized;
  }
  return projected;
}

function shouldExpandCloudGatewayKey(key) {
  if (/(?:APPLICATION_PUBLIC|H5_APPLICATION_PUBLIC|OPEN_API|WEBSOCKET)/u.test(key)) {
    return false;
  }
  if (/PLATFORM_API_GATEWAY/u.test(key)) {
    return true;
  }
  return /(?:_APP_API_BASE_URL|_API_BASE_URL|_SDK_BASE_URL)$/u.test(key);
}

function expandCloudGatewayUrls(sourceValues, deploymentIndex, profile, repositoryRoot) {
  if (profile.deploymentProfile !== 'cloud') {
    return sourceValues;
  }
  const origins = resolveCloudApiOriginListForRepository({
    repositoryRoot,
    environment: profile.environment,
    deployment: deploymentIndex,
    preferTopology: true,
  });
  const materialized = cloudSdkBaseUrlMaterializationValue(origins);
  const expanded = { ...sourceValues };
  for (const [key, value] of Object.entries(expanded)) {
    if (!shouldExpandCloudGatewayKey(key)) {
      continue;
    }
    if (typeof value !== 'string' || !/^https?:\/\//u.test(value.trim())) {
      continue;
    }
    expanded[key] = materialized;
  }
  return expanded;
}

function identityValues(surface, profile) {
  const basePrefix = surface.format === 'vite' ? 'VITE_SDKWORK' : 'SDKWORK';
  const values = {
    [`${basePrefix}_ENVIRONMENT`]: profile.environment,
    [`${basePrefix}_DEPLOYMENT_PROFILE`]: profile.deploymentProfile,
    [`${basePrefix}_PROFILE_ID`]: profile.profileId,
    [`${basePrefix}_RUNTIME_TARGET`]: surface.runtimeTarget,
  };
  for (const prefix of surface.identityPrefixes ?? []) {
    values[`${prefix}_ENVIRONMENT`] = profile.environment;
    values[`${prefix}_DEPLOYMENT_PROFILE`] = profile.deploymentProfile;
    values[`${prefix}_PROFILE_ID`] = profile.profileId;
    values[`${prefix}_RUNTIME_TARGET`] = surface.runtimeTarget;
  }
  return values;
}

export function createClientSurfaceValues({ surface, sourceValues, profile }) {
  const values = {};
  for (const prefix of surface.includePrefixes ?? []) {
    for (const [key, value] of Object.entries(sourceValues)) {
      if (key.startsWith(prefix)) {
        assertSafeClientKey(key);
        values[key] = value;
      }
    }
  }
  for (const key of surface.includeKeys ?? []) {
    assertSafeClientKey(key);
    const value = String(sourceValues[key] ?? '').trim();
    if (value) {
      values[key] = value;
    }
  }
  for (const [targetKey, rawBinding] of Object.entries(surface.bindings ?? {})) {
    assertSafeClientKey(targetKey);
    const binding = normalizeBinding(rawBinding);
    const value = firstValue(sourceValues, binding.sources);
    if (!value && binding.required) {
      throw new Error(
        `${profile.profileId} is missing ${targetKey}; expected one of ${binding.sources.join(', ')}.`,
      );
    }
    if (value) {
      values[targetKey] = value;
    }
  }
  for (const [key, value] of Object.entries(surface.constants ?? {})) {
    assertSafeClientKey(key);
    values[key] = String(value);
  }
  Object.assign(values, identityValues(surface, profile));

  const expectedNamespace = surface.format === 'vite' ? 'VITE_' : 'SDKWORK_';
  for (const key of Object.keys(values)) {
    if (!key.startsWith(expectedNamespace)) {
      throw new Error(`${surface.id} output key ${key} must use ${expectedNamespace}.`);
    }
  }
  for (const requiredKey of surface.requiredOutputKeys ?? []) {
    if (!String(values[requiredKey] ?? '').trim()) {
      throw new Error(`${profile.profileId} ${surface.id} requires ${requiredKey}.`);
    }
  }
  assertCloudClientUrls(values, profile);
  return values;
}

function resolveSurfaceOutputPath(rootDir, surface, profileId) {
  const appRoot = ensureInsideRoot(
    rootDir,
    path.resolve(rootDir, surface.root),
    `${surface.id} root`,
  );
  if (surface.format === 'vite') {
    return path.join(appRoot, `.env.${profileId}`);
  }
  if (surface.format === 'flutter') {
    return path.join(appRoot, 'env', `sdkwork.${profileId}.json`);
  }
  if (surface.format === 'mini-program') {
    return path.join(appRoot, 'config', 'mini-program', `runtime-env.${profileId}.json`);
  }
  throw new Error(`${surface.id} uses unsupported materialization format ${surface.format}.`);
}

function serializeDotenv({ values, sourcePath, rootDir, profileId, command }) {
  const source = path.relative(rootDir, sourcePath).replaceAll('\\', '/');
  const lines = [
    `# Generated from ${source} (${profileId}).`,
    `# Regenerate with: ${command}`,
  ];
  for (const [key, value] of Object.entries(values).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${key}=${value}`);
  }
  return `${lines.join('\n')}\n`;
}

function serializeJson(values) {
  return `${JSON.stringify(
    Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))),
    null,
    2,
  )}\n`;
}

function loadMaterializationConfig(rootDir, configPath) {
  const absolutePath = ensureInsideRoot(
    rootDir,
    path.resolve(rootDir, configPath),
    'Client env materialization config',
  );
  const config = readJson(absolutePath);
  if (config.schemaVersion !== 1 || config.kind !== 'sdkwork.client-env-materialization') {
    throw new Error(`${configPath} must be an sdkwork.client-env-materialization v1 document.`);
  }
  if (!Array.isArray(config.surfaces) || config.surfaces.length === 0) {
    throw new Error(`${configPath} must declare at least one client surface.`);
  }
  return { absolutePath, config };
}

function loadSourceProfile({ rootDir, etcDir, deploymentIndex, config, profileId }) {
  const entry = deploymentIndex.profiles?.[profileId];
  const configuredPath = String(entry?.config ?? '').trim();
  if (!configuredPath) {
    throw new Error(`Deployment profile ${profileId} is not declared.`);
  }
  const sourcePath = ensureInsideRoot(
    etcDir,
    path.resolve(etcDir, configuredPath),
    `Deployment profile ${profileId}`,
  );
  if (!existsSync(sourcePath)) {
    throw new Error(`Deployment profile file is missing: ${path.relative(rootDir, sourcePath)}.`);
  }
  const values = parseClientEnvDotenv(readFileSync(sourcePath, 'utf8'));
  const profile = assertSupportedProfileId(profileId);
  const identity = config.sourceIdentity;
  const declaredDeploymentProfile = firstValue(values, identity.deploymentProfileKeys);
  const declaredEnvironment = firstValue(values, identity.environmentKeys);
  const declaredProfileId = firstValue(values, identity.profileIdKeys);
  if (declaredDeploymentProfile !== profile.deploymentProfile) {
    throw new Error(`${profileId} declares inconsistent deploymentProfile=${declaredDeploymentProfile}.`);
  }
  if (declaredEnvironment !== profile.environment) {
    throw new Error(`${profileId} declares inconsistent environment=${declaredEnvironment}.`);
  }
  if (declaredProfileId !== profileId) {
    throw new Error(`${profileId} declares inconsistent profileId=${declaredProfileId}.`);
  }
  return { profile, sourcePath, values };
}

export function materializeClientEnv({
  rootDir = process.cwd(),
  configPath = DEFAULT_CONFIG_PATH,
  check = false,
} = {}) {
  const normalizedRoot = path.resolve(rootDir);
  const { config } = loadMaterializationConfig(normalizedRoot, configPath);
  const etcDir = path.join(normalizedRoot, 'etc');
  const deploymentConfigPath = path.join(
    etcDir,
    config.deploymentConfig ?? 'sdkwork.deployment.config.json',
  );
  const deploymentIndex = readJson(deploymentConfigPath);
  const profileIds = config.profiles ?? CLIENT_ENV_PROFILE_IDS;
  const results = [];

  for (const profileId of profileIds) {
    const sourceProfile = loadSourceProfile({
      rootDir: normalizedRoot,
      etcDir,
      deploymentIndex,
      config,
      profileId,
    });
    const sourceValues = expandCloudGatewayUrls(
      sourceProfile.values,
      deploymentIndex,
      sourceProfile.profile,
      normalizedRoot,
    );
    for (const surface of config.surfaces) {
      const outputPath = resolveSurfaceOutputPath(normalizedRoot, surface, profileId);
      // Vite dotenv surfaces consume raw single-origin topology values plus the
      // cloud dev-local gateway override; non-vite (build runtime document)
      // surfaces keep the full ';'-joined cloud API origin materialization.
      const isViteSurface = surface.format === 'vite';
      const surfaceSourceValues = isViteSurface
        ? sourceProfile.values
        : expandCloudGatewayUrls(sourceValues, deploymentIndex, sourceProfile.profile, normalizedRoot);
      const surfaceValues = createClientSurfaceValues({
        surface,
        sourceValues: surfaceSourceValues,
        profile: sourceProfile.profile,
      });
      const values = isViteSurface
        ? applyViteSurfaceCloudValues(surfaceValues, sourceProfile.values, sourceProfile.profile)
        : applyCloudGatewayProjection(
            surfaceValues,
            deploymentIndex,
            sourceProfile.profile,
            normalizedRoot,
          );
      const content = surface.format === 'vite'
        ? serializeDotenv({
            values,
            sourcePath: sourceProfile.sourcePath,
            rootDir: normalizedRoot,
            profileId,
            command: config.command ?? 'pnpm workflow:materialize-client-env',
          })
        : serializeJson(values);
      if (check) {
        const actual = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
        if (actual !== content) {
          throw new Error(
            `${path.relative(normalizedRoot, outputPath)} is missing or stale. Run ${config.command ?? 'the client env materializer'}.`,
          );
        }
      } else {
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, content, 'utf8');
      }
      results.push(outputPath);
    }
  }
  return results;
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const files = materializeClientEnv({
    rootDir: options.root,
    configPath: options.config,
    check: options.check,
  });
  console.log(`SDKWork client env profiles ${options.check ? 'verified' : 'materialized'}: ${files.length} files.`);
}

const entryPath = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1] ?? '') === entryPath) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
