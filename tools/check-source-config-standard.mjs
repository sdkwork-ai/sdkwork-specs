#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const SECRET_KEY = /(?:password|private[_-]?key|signing[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key)$/iu;
const SAFE_SECRET_REFERENCE = /(?:file|path|ref|reference)$/iu;
const PRODUCTION_LIKE_ENVIRONMENT = /^(?:prod|production|stage|staging|demo|live)$/iu;
const PROFILE_ID = /^(standalone|cloud)\.(development|test|staging|demo|production)$/u;

function findRepositoryRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveParentContract(configPath, value, field, repositoryRoot, issues) {
  if (typeof value !== 'string' || value.trim() === '' || path.isAbsolute(value)) {
    issues.push(`etc/sdkwork.deployment.config.json#/${field}: must be a non-empty relative path`);
    return null;
  }
  const resolved = path.resolve(path.dirname(configPath), value);
  if (repositoryRoot && !isPathInside(repositoryRoot, resolved)) {
    issues.push(`etc/sdkwork.deployment.config.json#/${field}: must stay within repository root`);
    return null;
  }
  if (!fs.existsSync(resolved)) {
    issues.push(`etc/sdkwork.deployment.config.json#/${field}: target does not exist (${value})`);
    return null;
  }
  return resolved;
}

function inspectComponentDeploymentConfig(resolvedRoot, configPath, config, issues) {
  if (config?.kind !== 'sdkwork.component-deployment') return;
  const repositoryRoot = findRepositoryRoot(resolvedRoot);
  resolveParentContract(
    configPath,
    config.parentDeploymentConfig,
    'parentDeploymentConfig',
    repositoryRoot,
    issues,
  );
  const topologyPath = resolveParentContract(
    configPath,
    config.parentTopologySpec,
    'parentTopologySpec',
    repositoryRoot,
    issues,
  );
  if (topologyPath) {
    try {
      const topology = JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
      if (topology.schemaVersion !== 5 || topology.kind !== 'sdkwork.app.topology') {
        issues.push('etc/sdkwork.deployment.config.json#/parentTopologySpec: target must be a topology v5 contract');
      }
    } catch (error) {
      issues.push(`etc/sdkwork.deployment.config.json#/parentTopologySpec: invalid JSON (${error.message})`);
    }
  }
  if (config.parentTopologySpec && fs.existsSync(path.join(resolvedRoot, 'specs', 'topology.spec.json'))) {
    issues.push('specs/topology.spec.json: component root must not own a second topology when parentTopologySpec is declared');
  }
}

function envValue(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}=([^\\r\\n]*)$`, 'mu'));
  return match?.[1]?.trim() ?? '';
}

function applicationEnvPrefix(application) {
  return String(application ?? '')
    .replace(/^sdkwork-/u, '')
    .replace(/[^a-z0-9]+/giu, '_')
    .replace(/^_+|_+$/gu, '')
    .toUpperCase();
}

function profileIdentityFromFile(file, application) {
  if (file.endsWith('.json')) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const runtime = value.runtime && typeof value.runtime === 'object'
      ? value.runtime
      : {};
    return {
      environment: value.environment ?? value.SDKWORK_ENVIRONMENT ?? runtime.environment,
      deploymentProfile: value.deploymentProfile
        ?? value.SDKWORK_DEPLOYMENT_PROFILE
        ?? runtime.deploymentProfile
        ?? runtime.deployment_profile,
      profileId: value.profileId
        ?? value.SDKWORK_PROFILE_ID
        ?? runtime.profileId
        ?? runtime.profile_id,
    };
  }
  const source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.toml')) {
    const runtimeSource = tomlSection(source, 'runtime');
    return {
      environment: parseTomlString(runtimeSource, 'environment'),
      deploymentProfile: parseTomlString(runtimeSource, 'deployment_profile')
        || parseTomlString(runtimeSource, 'deploymentProfile'),
      profileId: parseTomlString(runtimeSource, 'profile_id')
        || parseTomlString(runtimeSource, 'profileId'),
    };
  }
  if (file.endsWith('.yaml') || file.endsWith('.yml')) {
    return {
      environment: yamlScalarValue(source, 'environment'),
      deploymentProfile: yamlScalarValue(source, 'deploymentProfile')
        || yamlScalarValue(source, 'deployment-profile'),
      profileId: yamlScalarValue(source, 'profileId')
        || yamlScalarValue(source, 'profile-id'),
    };
  }
  const prefix = applicationEnvPrefix(application);
  const scoped = prefix ? `SDKWORK_${prefix}` : '';
  return {
    environment: envValue(source, 'SDKWORK_ENVIRONMENT')
      || (scoped ? envValue(source, `${scoped}_ENVIRONMENT`) : ''),
    deploymentProfile: envValue(source, 'SDKWORK_DEPLOYMENT_PROFILE')
      || (scoped ? envValue(source, `${scoped}_DEPLOYMENT_PROFILE`) : ''),
    profileId: envValue(source, 'SDKWORK_PROFILE_ID')
      || (scoped ? envValue(source, `${scoped}_PROFILE_ID`) : ''),
  };
}

function yamlScalarValue(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = source.match(new RegExp(`^\\s*${escapedKey}\\s*:\\s*["']?([^"'\\s#]+)["']?\\s*(?:#.*)?$`, 'mu'));
  return match?.[1]?.trim() ?? '';
}

function tomlSection(source, section) {
  const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const heading = new RegExp(`^\\s*\\[${escapedSection}\\]\\s*$`, 'miu');
  const match = heading.exec(source);
  if (!match) return '';
  const remainder = source.slice(match.index + match[0].length);
  const nextSection = remainder.search(/^\s*\[/mu);
  return nextSection >= 0 ? remainder.slice(0, nextSection) : remainder;
}

function inspectDeploymentIndex(resolvedRoot, configPath, config, issues, { enforceProfileIdentity }) {
  if (config?.kind !== 'sdkwork.deployment-index') return;
  if (config.schemaVersion !== 1) {
    issues.push('etc/sdkwork.deployment.config.json#/schemaVersion: deployment index must use version 1');
  }
  if (!config.profiles || typeof config.profiles !== 'object' || Array.isArray(config.profiles)) {
    issues.push('etc/sdkwork.deployment.config.json#/profiles: deployment index requires a profile map');
    return;
  }
  const entries = Object.entries(config.profiles);
  if (entries.length === 0) {
    issues.push('etc/sdkwork.deployment.config.json#/profiles: at least one canonical profile is required');
  }
  if (typeof config.defaultProfile !== 'string' || !config.profiles[config.defaultProfile]) {
    issues.push('etc/sdkwork.deployment.config.json#/defaultProfile: must name a declared profile');
  }
  for (const [profileId, entry] of entries) {
    const match = profileId.match(PROFILE_ID);
    if (!match) {
      issues.push(`etc/sdkwork.deployment.config.json#/profiles/${profileId}: profile id must use <standalone|cloud>.<development|test|staging|demo|production>`);
      continue;
    }
    if (!entry || typeof entry !== 'object' || typeof entry.config !== 'string' || !entry.config.trim()) {
      issues.push(`etc/sdkwork.deployment.config.json#/profiles/${profileId}/config: non-empty relative path is required`);
      continue;
    }
    const target = path.resolve(path.dirname(configPath), entry.config);
    if (!isPathInside(path.dirname(configPath), target)) {
      issues.push(`etc/sdkwork.deployment.config.json#/profiles/${profileId}/config: must stay within etc/`);
      continue;
    }
    if (!fs.existsSync(target)) {
      issues.push(`etc/sdkwork.deployment.config.json#/profiles/${profileId}/config: target does not exist (${entry.config})`);
      continue;
    }
    try {
      const identity = profileIdentityFromFile(target, config.application);
      const [, deploymentProfile, environment] = match;
      const declaredIdentityFields = Object.values(identity).filter(Boolean).length;
      if (declaredIdentityFields === 0 && !enforceProfileIdentity) continue;
      if (!identity.environment) {
        issues.push(`${path.relative(resolvedRoot, target).replaceAll(path.sep, '/')}#environment: canonical profile identity is required`);
      }
      if (!identity.deploymentProfile) {
        issues.push(`${path.relative(resolvedRoot, target).replaceAll(path.sep, '/')}#deploymentProfile: canonical profile identity is required`);
      }
      if (!identity.profileId) {
        issues.push(`${path.relative(resolvedRoot, target).replaceAll(path.sep, '/')}#profileId: canonical profile identity is required`);
      }
      if (identity.environment !== environment) {
        issues.push(`${path.relative(resolvedRoot, target).replaceAll(path.sep, '/')}#environment: must equal ${environment}`);
      }
      if (identity.deploymentProfile !== deploymentProfile) {
        issues.push(`${path.relative(resolvedRoot, target).replaceAll(path.sep, '/')}#deploymentProfile: must equal ${deploymentProfile}`);
      }
      if (identity.profileId !== profileId) {
        issues.push(`${path.relative(resolvedRoot, target).replaceAll(path.sep, '/')}#profileId: must equal ${profileId}`);
      }
    } catch (error) {
      issues.push(`${path.relative(resolvedRoot, target).replaceAll(path.sep, '/')}: invalid profile config (${error.message})`);
    }
  }
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function inspectJsonSecrets(value, pointer, issues) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectJsonSecrets(entry, `${pointer}/${index}`, issues));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const childPointer = `${pointer}/${key}`;
    if (
      SECRET_KEY.test(key)
      && !SAFE_SECRET_REFERENCE.test(key)
      && typeof entry === 'string'
      && entry.trim()
    ) {
      issues.push(`${childPointer}: committed etc config must not contain a secret value`);
    }
    inspectJsonSecrets(entry, childPointer, issues);
  }
}

function parseTomlString(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'mu'));
  return match?.[1]?.trim() ?? '';
}

function parseTomlBoolean(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`, 'miu'));
  return match ? match[1].toLowerCase() === 'true' : undefined;
}

function parseTomlStringArray(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'mu'));
  if (!match) return undefined;
  return Array.from(match[1].matchAll(/"([^"]*)"/gu), (entry) => entry[1].trim());
}

function isExactHttpOrigin(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin === value
      && !value.includes('*')
      && url.username === ''
      && url.password === ''
    );
  } catch {
    return false;
  }
}

function isExactDesktopOrigin(value) {
  try {
    const url = new URL(value);
    const reconstructed = `${url.protocol}//${url.host}`;
    return (
      (url.protocol === 'app:' || url.protocol === 'tauri:')
      && reconstructed === value
      && !value.includes('*')
      && url.username === ''
      && url.password === ''
      && (url.pathname === '' || url.pathname === '/')
      && url.search === ''
      && url.hash === ''
    );
  } catch {
    return false;
  }
}

function inspectGatewayCors(file, relative, issues) {
  const source = fs.readFileSync(file, 'utf8');
  const environment = parseTomlString(source, 'environment');
  if (!PRODUCTION_LIKE_ENVIRONMENT.test(environment)) return;

  const exposesAppSurface = Array.from(
    source.matchAll(/^\s*surface\s*=\s*"([^"]+)"\s*$/gmiu),
    (entry) => entry[1].trim().toLowerCase(),
  ).includes('app');
  if (!exposesAppSurface) return;

  if (parseTomlBoolean(source, 'allowAnyOrigin') !== false) {
    issues.push(`${relative}#[cors].allowAnyOrigin: production-like app-api ingress must set false`);
  }
  const allowedOrigins = parseTomlStringArray(source, 'allowedOrigins');
  if (!allowedOrigins?.length) {
    issues.push(`${relative}#[cors].allowedOrigins: production-like app-api ingress requires at least one exact origin`);
    return;
  }
  if (!allowedOrigins.some((origin) => isExactHttpOrigin(origin))) {
    issues.push(`${relative}#[cors].allowedOrigins: production-like app-api ingress requires at least one exact HTTP(S) origin`);
  }
  for (const origin of allowedOrigins) {
    if (!isExactHttpOrigin(origin) && !isExactDesktopOrigin(origin)) {
      issues.push(`${relative}#[cors].allowedOrigins: invalid exact origin ${JSON.stringify(origin)}`);
    }
  }
}

export function checkSourceConfigStandard(root, { deployable, enforceProfileIdentity = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const manifestPath = path.join(resolvedRoot, 'sdkwork.app.config.json');
  const isDeployable = deployable ?? fs.existsSync(manifestPath);
  const issues = [];
  if (!isDeployable) return issues;

  const etcRoot = path.join(resolvedRoot, 'etc');
  if (!fs.existsSync(etcRoot)) {
    return ['etc/: independently deployable root must own source configuration'];
  }
  if (!fs.existsSync(path.join(etcRoot, 'README.md'))) {
    issues.push('etc/README.md: source configuration discovery documentation is required');
  }
  const deploymentConfigPath = path.join(etcRoot, 'sdkwork.deployment.config.json');
  if (!fs.existsSync(deploymentConfigPath)) {
    issues.push('etc/sdkwork.deployment.config.json: deployment profile index is required');
  } else {
    try {
      const deploymentConfig = JSON.parse(fs.readFileSync(deploymentConfigPath, 'utf8'));
      inspectComponentDeploymentConfig(
        resolvedRoot,
        deploymentConfigPath,
        deploymentConfig,
        issues,
      );
      inspectDeploymentIndex(
        resolvedRoot,
        deploymentConfigPath,
        deploymentConfig,
        issues,
        { enforceProfileIdentity },
      );
    } catch {
      // The generic JSON scan below reports the parse error once.
    }
  }
  if (fs.existsSync(path.join(resolvedRoot, 'configs'))) {
    issues.push('configs/: retired runtime/deployment config directory must be migrated to etc/');
  }

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.environments) {
      issues.push('sdkwork.app.config.json#/environments: concrete environment config belongs in etc/');
    }
    const envBindings = manifest.envBindings;
    if (envBindings && typeof envBindings === 'object') {
      for (const key of Object.keys(envBindings)) {
        if (/byEnv(?:ironment)?$/iu.test(key)) {
          issues.push(`sdkwork.app.config.json#/envBindings/${key}: per-environment values belong in etc/`);
        }
      }
    }
  }

  for (const file of walkFiles(etcRoot)) {
    const relative = path.relative(resolvedRoot, file).replaceAll(path.sep, '/');
    if (/\.local\./u.test(relative) || relative.startsWith('etc/secrets/')) {
      issues.push(`${relative}: local/private source config must not be committed`);
      continue;
    }
    if (file.endsWith('.json')) {
      try {
        inspectJsonSecrets(JSON.parse(fs.readFileSync(file, 'utf8')), relative, issues);
      } catch (error) {
        issues.push(`${relative}: invalid JSON (${error.message})`);
      }
    }
  }
  const gatewayConfigRoots = [etcRoot, path.join(resolvedRoot, 'configs')];
  const inspectedGatewayFiles = new Set();
  for (const configRoot of gatewayConfigRoots) {
    for (const file of walkFiles(configRoot)) {
      if (!/api-cloud-gateway.*\.toml$/iu.test(path.basename(file))) continue;
      const absolute = path.resolve(file);
      if (inspectedGatewayFiles.has(absolute)) continue;
      inspectedGatewayFiles.add(absolute);
      const relative = path.relative(resolvedRoot, file).replaceAll(path.sep, '/');
      inspectGatewayCors(file, relative, issues);
    }
  }
  return issues;
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      root: { type: 'string', default: '.' },
      deployable: { type: 'boolean' },
      'enforce-profile-identity': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/check-source-config-standard.mjs --root <deployable-root> [--deployable] [--enforce-profile-identity]');
    return;
  }
  const root = path.resolve(values.root);
  const issues = checkSourceConfigStandard(root, {
    deployable: values.deployable,
    enforceProfileIdentity: values['enforce-profile-identity'],
  });
  if (issues.length > 0) {
    console.error(`source config standard failed for ${root}`);
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }
  console.log(`source config standard passed for ${root}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
