#!/usr/bin/env node
/**
 * Verify standalone + cloud deployment profile coverage in application topology specs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WORKSPACE = path.resolve(SPECS_ROOT, '..');
const RETIRED_PROFILE_TOKENS = new Set(['unified-process', 'split-services']);
const LOCAL_CLOUD_PROCESS_PATTERN = /(?:api(?:-server)?|gateway|public-ingress|database|postgres|redis|migrat|seed)/iu;
const PROCESS_ROLES = new Set([
  'client', 'api-standalone-gateway',
  'edge-runtime', 'database', 'redis', 'migration',
  'seed', 'worker', 'tunnel',
]);
const CLIENT_ARCHITECTURES = new Set([
  'pc-web', 'h5', 'capacitor', 'flutter', 'tauri', 'electron',
  'android-native', 'ios-native', 'harmony-native', 'mini-program',
]);
const BROWSER_API_CONFIG_KEY = /(?:sdk|api)baseurl$|applicationpublichttpurl$/iu;
const BROWSER_API_ENV_KEY = /(?:_SDK_BASE_URL|_(?:OPEN|APP|BACKEND)_API_BASE_URL|_APPLICATION_PUBLIC_HTTP_URL)$/u;
const BROWSER_ORIGIN_MODE_ENV_KEY = /_BROWSER_ORIGIN_MODE$/u;

function readEnv(file) {
  const values = new Map();
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    values.set(match[1], match[2].trim().replace(/^(['"])(.*)\1$/u, '$2'));
  }
  return values;
}

function isLoopbackUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1';
  } catch {
    return false;
  }
}

function isPlaceholderUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.endsWith('.example')
      || hostname.endsWith('.invalid')
      || hostname === 'example.com'
      || hostname.endsWith('.example.com');
  } catch {
    return true;
  }
}

function isPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative));
}

function originFromUrl(value, label, issues) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    return url.origin;
  } catch {
    issues.push(`${label} must be an absolute HTTP(S) URL`);
    return null;
  }
}

function originFromBind(value, label, issues) {
  const binding = String(value ?? '').trim();
  const bracketed = /^\[([^\]]+)\]:(\d+)$/u.exec(binding);
  const plain = /^([^:]+):(\d+)$/u.exec(binding);
  const match = bracketed ?? plain;
  if (!match) {
    issues.push(`${label} must resolve to <host>:<port>`);
    return null;
  }
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push(`${label} must resolve to a valid TCP port`);
    return null;
  }
  const rawHost = match[1];
  const host = ['0.0.0.0', '::'].includes(rawHost) ? '127.0.0.1' : rawHost;
  const formattedHost = host.includes(':') ? `[${host}]` : host;
  return `http://${formattedHost}:${port}`;
}

function isBrowserClient(process) {
  return process?.role === 'client'
    && Array.isArray(process.runtimeTargets)
    && process.runtimeTargets.includes('browser')
    && Array.isArray(process.clientArchitectures)
    && process.clientArchitectures.length > 0
    && typeof process.applicationRoot === 'string'
    && process.applicationRoot.trim() !== '';
}

function sameStringSet(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value) => right.includes(value));
}

function collectJsonBrowserApiValues(value, prefix = '', results = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return results;
  for (const [key, entry] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === 'string' && BROWSER_API_CONFIG_KEY.test(key)) {
      results.push({ key: field, value: entry });
      continue;
    }
    collectJsonBrowserApiValues(entry, field, results);
  }
  return results;
}

function emptyBrowserRuntimeSource() {
  return { apiValues: [], browserOriginMode: null };
}

function readBrowserRuntimeSource(repoRoot, applicationRoot, profileId, rel, issues) {
  const appRoot = path.resolve(repoRoot, applicationRoot);
  if (!isPathInside(repoRoot, appRoot) || !fs.existsSync(appRoot)) {
    issues.push(`${rel}: ${profileId} browser applicationRoot must exist inside the repository: ${applicationRoot}`);
    return emptyBrowserRuntimeSource();
  }
  const deploymentPath = path.join(appRoot, 'etc', 'sdkwork.deployment.config.json');
  if (!fs.existsSync(deploymentPath)) {
    issues.push(`${rel}: ${profileId} browser application ${applicationRoot} requires etc/sdkwork.deployment.config.json`);
    return emptyBrowserRuntimeSource();
  }
  let deployment;
  try {
    deployment = readJson(deploymentPath);
  } catch (error) {
    issues.push(`${rel}: ${profileId} browser deployment config is invalid JSON (${error.message})`);
    return emptyBrowserRuntimeSource();
  }
  const entry = deployment.profiles?.[profileId];
  const sourcePath = String(entry?.source ?? entry?.config ?? '').trim();
  if (!sourcePath) {
    issues.push(`${rel}: ${profileId} browser application ${applicationRoot} must declare a public runtime source`);
    return emptyBrowserRuntimeSource();
  }
  const etcRoot = path.dirname(deploymentPath);
  const source = path.resolve(etcRoot, sourcePath);
  if (!isPathInside(etcRoot, source) || !fs.existsSync(source)) {
    issues.push(`${rel}: ${profileId} browser runtime source must exist inside ${applicationRoot}/etc: ${sourcePath}`);
    return emptyBrowserRuntimeSource();
  }
  try {
    if (source.endsWith('.json')) {
      const config = readJson(source);
      return {
        apiValues: collectJsonBrowserApiValues(config),
        browserOriginMode: String(config.browserOriginMode ?? '').trim() || null,
      };
    }
    const values = readEnv(source);
    const originMode = [...values.entries()]
      .find(([key]) => BROWSER_ORIGIN_MODE_ENV_KEY.test(key));
    return {
      apiValues: [...values.entries()]
        .filter(([key]) => BROWSER_API_ENV_KEY.test(key))
        .map(([key, value]) => ({ key, value })),
      browserOriginMode: String(originMode?.[1] ?? '').trim() || null,
    };
  } catch (error) {
    issues.push(`${rel}: ${profileId} browser runtime source cannot be parsed (${error.message})`);
    return emptyBrowserRuntimeSource();
  }
}

function validateBrowserApiValues({
  repoRoot,
  applicationRoot,
  profileId,
  browserOrigin,
  apiTargetOrigin,
  rel,
  issues,
}) {
  if (!browserOrigin) return;
  const runtimeSource = readBrowserRuntimeSource(
    repoRoot,
    applicationRoot,
    profileId,
    rel,
    issues,
  );
  if (runtimeSource.browserOriginMode !== 'same-origin') {
    issues.push(`${rel}: ${profileId} browser runtime must declare browserOriginMode same-origin`);
  }
  for (const entry of runtimeSource.apiValues) {
    const raw = String(entry.value ?? '').trim();
    if (!raw) continue;
    let resolved = null;
    try {
      const url = new URL(raw, browserOrigin);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
      resolved = url.origin;
    } catch {
      issues.push(`${rel}: ${profileId} browser runtime ${entry.key} must be a root-relative same-origin path`);
      continue;
    }
    if (!raw.startsWith('/') || raw.startsWith('//') || resolved !== browserOrigin) {
      const targetDetail = resolved === apiTargetOrigin && apiTargetOrigin !== browserOrigin
        ? ' (it exposes the internal API listener origin)'
        : '';
      issues.push(`${rel}: ${profileId} browser runtime ${entry.key} must use a root-relative same-origin path, not ${raw}${targetDetail}`);
    }
  }
}

function validateStandaloneBrowserDeliveries(repoRoot, spec, rel, issues) {
  if (spec.schemaVersion !== 5) return;
  const profiles = spec.orchestration?.profiles ?? {};
  const devProfile = profiles['standalone.development'];
  const devBrowserClients = (devProfile?.processes ?? []).filter(isBrowserClient);
  const devRoots = new Set(devBrowserClients.map((process) => process.applicationRoot));
  const devArchitectures = new Map();
  for (const client of devBrowserClients) {
    const architectures = devArchitectures.get(client.applicationRoot) ?? new Set();
    client.clientArchitectures.forEach((architecture) => architectures.add(architecture));
    devArchitectures.set(client.applicationRoot, architectures);
  }

  for (const [profileId, profile] of Object.entries(profiles)) {
    if (!profileId.startsWith('standalone.')) continue;
    const profilePath = spec.profileFiles?.[profileId];
    const profileEnv = profilePath && fs.existsSync(path.join(repoRoot, profilePath))
      ? readEnv(path.join(repoRoot, profilePath))
      : new Map();
    const deliveries = profile.browserDeliveries ?? [];
    const deliveryIds = new Set();
    for (const delivery of deliveries) {
      if (!delivery?.id || deliveryIds.has(delivery.id)) {
        issues.push(`${rel}: ${profileId} browser delivery ids must be non-empty and unique`);
        continue;
      }
      deliveryIds.add(delivery.id);
      if (delivery.originMode !== 'same-origin') {
        issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} must use originMode same-origin`);
      }
      if (!Array.isArray(delivery.clientArchitectures)
        || delivery.clientArchitectures.length === 0
        || new Set(delivery.clientArchitectures).size !== delivery.clientArchitectures.length
        || delivery.clientArchitectures.some((value) => !CLIENT_ARCHITECTURES.has(value))) {
        issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} requires non-empty unique canonical clientArchitectures`);
      }
      if (delivery.apiSurfaceId !== 'application.public-ingress') {
        issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} must use apiSurfaceId application.public-ingress`);
      }
      const applicationRoot = String(delivery.applicationRoot ?? '').trim();
      const appRoot = path.resolve(repoRoot, applicationRoot);
      if (!applicationRoot || !isPathInside(repoRoot, appRoot) || !fs.existsSync(appRoot)) {
        issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} applicationRoot must exist inside the repository`);
      }
      const apiSurface = spec.surfaces?.['application.public-ingress'];
      const apiUrl = apiSurface?.httpUrlEnv ? profileEnv.get(apiSurface.httpUrlEnv) : null;
      if (!apiUrl) {
        issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} must resolve application.public-ingress`);
      }
      const apiTargetOrigin = apiUrl
        ? originFromUrl(apiUrl, `${rel}: ${profileId} application.public-ingress`, issues)
        : null;

      if (profileId === 'standalone.development'
        && delivery.deliveryMode !== 'dev-server-proxy') {
        issues.push(`${rel}: standalone.development browser delivery ${delivery.id} must use dev-server-proxy`);
      }
      if (profileId === 'standalone.production'
        && delivery.deliveryMode !== 'gateway-static') {
        issues.push(`${rel}: standalone.production browser delivery ${delivery.id} must use gateway-static`);
      }

      if (delivery.deliveryMode === 'dev-server-proxy') {
        for (const field of ['hostProcessId', 'buildOutput', 'runtimeRootEnv', 'mountPath', 'spaFallback']) {
          if (delivery[field] !== undefined) {
            issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} dev-server-proxy must not declare ${field}`);
          }
        }
        const client = (profile.processes ?? []).find((process) => process.id === delivery.clientProcessId);
        if (!isBrowserClient(client) || client.applicationRoot !== applicationRoot || !client.bindEnv) {
          issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} must reference its browser client process with bindEnv`);
          continue;
        }
        if (!sameStringSet(delivery.clientArchitectures, client.clientArchitectures)) {
          issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} clientArchitectures must match client process ${client.id}`);
        }
        if (delivery.preserveCanonicalPaths !== true) {
          issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} must set preserveCanonicalPaths=true`);
        }
        const browserOrigin = originFromBind(
          profileEnv.get(client.bindEnv),
          `${rel}: ${profileId} ${client.bindEnv}`,
          issues,
        );
        if (apiSurface?.clientHttpEnv && profileEnv.has(apiSurface.clientHttpEnv)) {
          const publicOrigin = originFromUrl(
            profileEnv.get(apiSurface.clientHttpEnv),
            `${rel}: ${profileId} ${apiSurface.clientHttpEnv}`,
            issues,
          );
          if (publicOrigin && browserOrigin && publicOrigin !== browserOrigin) {
            issues.push(`${rel}: ${profileId} ${apiSurface.clientHttpEnv} must resolve to browser origin ${browserOrigin}`);
          }
        }
        validateBrowserApiValues({
          repoRoot,
          applicationRoot,
          profileId,
          browserOrigin,
          apiTargetOrigin,
          rel,
          issues,
        });
        continue;
      }

      if (delivery.deliveryMode === 'gateway-static') {
        for (const field of ['clientProcessId', 'preserveCanonicalPaths']) {
          if (delivery[field] !== undefined) {
            issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} gateway-static must not declare ${field}`);
          }
        }
        const host = (profile.processes ?? []).find((process) => process.id === delivery.hostProcessId);
        if (!host || host.role !== 'api-standalone-gateway') {
          issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} must reference an api-standalone-gateway host process`);
        }
        const buildOutput = path.resolve(repoRoot, String(delivery.buildOutput ?? ''));
        if (!delivery.buildOutput || !isPathInside(appRoot, buildOutput)) {
          issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} buildOutput must stay inside applicationRoot`);
        }
        if (!/^[A-Z][A-Z0-9_]+$/u.test(String(delivery.runtimeRootEnv ?? ''))
          || !profileEnv.get(delivery.runtimeRootEnv)) {
          issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} runtimeRootEnv must resolve in its source profile`);
        }
        if (delivery.mountPath !== '/' || delivery.spaFallback !== '/index.html') {
          issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} must mount / with SPA fallback /index.html`);
        }
        validateBrowserApiValues({
          repoRoot,
          applicationRoot,
          profileId,
          browserOrigin: apiTargetOrigin,
          apiTargetOrigin,
          rel,
          issues,
        });
        continue;
      }

      issues.push(`${rel}: ${profileId} browser delivery ${delivery.id} uses unsupported deliveryMode ${delivery.deliveryMode}`);
    }

    if (profileId === 'standalone.development') {
      for (const client of devBrowserClients) {
        const matches = deliveries.filter((delivery) => (
          delivery.deliveryMode === 'dev-server-proxy'
          && delivery.clientProcessId === client.id
          && delivery.applicationRoot === client.applicationRoot
          && sameStringSet(delivery.clientArchitectures, client.clientArchitectures)
        ));
        if (matches.length !== 1) {
          issues.push(`${rel}: standalone.development browser client ${client.id} requires exactly one same-origin dev-server-proxy delivery`);
        }
      }
    }
  }

  if (devRoots.size > 0 && spec.vocabulary?.environment?.allowed?.includes('production')) {
    const production = profiles['standalone.production'];
    if (!production || !spec.profileFiles?.['standalone.production']) {
      issues.push(`${rel}: standalone browser clients require a standalone.production topology profile`);
      return;
    }
    for (const applicationRoot of devRoots) {
      for (const architecture of devArchitectures.get(applicationRoot) ?? []) {
        const matches = (production.browserDeliveries ?? []).filter((delivery) => (
          delivery.deliveryMode === 'gateway-static'
          && delivery.applicationRoot === applicationRoot
          && delivery.clientArchitectures?.includes(architecture)
        ));
        if (matches.length !== 1) {
          issues.push(`${rel}: standalone.production browser application ${applicationRoot} architecture ${architecture} requires exactly one same-origin gateway-static delivery`);
        }
      }
    }
  }
}

function declaredDeploymentProfiles(repoRoot, spec, issues) {
  const manifestPath = path.join(repoRoot, 'agent.app.config.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const declared = readJson(manifestPath).runtime?.supportedDeploymentProfiles;
      if (Array.isArray(declared) && declared.length > 0) {
        const invalid = declared.filter((profile) => !['standalone', 'cloud'].includes(profile));
        for (const profile of invalid) {
          issues.push(`${path.relative(repoRoot, manifestPath)}: unsupported deployment profile ${profile}`);
        }
        return new Set(declared.filter((profile) => ['standalone', 'cloud'].includes(profile)));
      }
    } catch (error) {
      issues.push(`${path.relative(repoRoot, manifestPath)}: invalid JSON (${error.message})`);
    }
  }

  const topologyProfiles = spec.vocabulary?.deploymentProfile?.allowed
    ?? spec.vocabulary?.hosting?.allowed
    ?? [];
  const normalized = topologyProfiles.map((profile) => {
    if (profile === 'self-hosted') return 'standalone';
    if (profile === 'cloud-hosted') return 'cloud';
    return profile;
  });
  return new Set(normalized.length > 0 ? normalized : ['standalone', 'cloud']);
}

function requiredProfiles(spec, deploymentProfiles) {
  const profiles = [...deploymentProfiles];
  const environments = spec.vocabulary?.environment?.allowed ?? ['development', 'production'];
  const required = [];
  if (profiles.includes('standalone') && environments.includes('development')) {
    required.push('standalone.development');
  }
  if (profiles.includes('cloud')) {
    if (environments.includes('production')) {
      required.push('cloud.production');
    }
    if (environments.includes('development')) {
      required.push('cloud.development');
    }
  }
  return required;
}

function fail(message, details = []) {
  console.error(`topology deployment profile check failed: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hasRetiredProfileToken(value) {
  return String(value)
    .split('.')
    .some((part) => RETIRED_PROFILE_TOKENS.has(part));
}

function pushProfileIdIssues(profileId, rel, issues) {
  if (hasRetiredProfileToken(profileId)) {
    issues.push(`${rel}: retired profile id ${profileId}; use <deploymentProfile>.<environment>`);
    return;
  }
  const parts = profileId.split('.');
  if (parts.length !== 2) {
    issues.push(`${rel}: profile id ${profileId} must use <deploymentProfile>.<environment>`);
    return;
  }
  const [deploymentProfile, environment] = parts;
  if (!['standalone', 'cloud'].includes(deploymentProfile)) {
    issues.push(`${rel}: profile id ${profileId} uses invalid deployment profile ${deploymentProfile}`);
  }
  if (!environment) {
    issues.push(`${rel}: profile id ${profileId} is missing environment segment`);
  }
}

function pushRetiredTopologyIssues(spec, rel, issues) {
  if (spec.vocabulary?.serviceLayout) {
    issues.push(`${rel}: retired vocabulary.serviceLayout is not allowed`);
  }
  if (String(spec.profilePattern ?? '').includes('serviceLayout')) {
    issues.push(`${rel}: profilePattern must not contain retired serviceLayout`);
  }
  if (spec.envKeys?.serviceLayout) {
    issues.push(`${rel}: envKeys.serviceLayout is retired and must be removed`);
  }
  for (const [key, value] of Object.entries(spec.defaults ?? {})) {
    if (typeof value === 'string' && hasRetiredProfileToken(value)) {
      issues.push(`${rel}: defaults.${key} uses retired profile id ${value}`);
    }
  }
}

function checkSpec(repoRoot, specPath) {
  const issues = [];
  const rel = path.relative(repoRoot, specPath);
  const spec = readJson(specPath);
  if (![4, 5].includes(spec.schemaVersion)) {
    issues.push(`${rel}: schemaVersion must be 4 (migration) or 5 (current)`);
  }
  pushRetiredTopologyIssues(spec, rel, issues);

  const deploymentProfiles = declaredDeploymentProfiles(repoRoot, spec, issues);
  const supportsStandalone = deploymentProfiles.has('standalone');
  const supportsCloud = deploymentProfiles.has('cloud');

  const profiles =
    spec.vocabulary?.deploymentProfile?.allowed ?? spec.vocabulary?.hosting?.allowed ?? [];
  if (supportsStandalone && !profiles.includes('standalone') && !profiles.includes('self-hosted')) {
    issues.push(`${rel}: missing standalone/self-hosted deployment profile in vocabulary`);
  }
  if (supportsCloud && !profiles.includes('cloud') && !profiles.includes('cloud-hosted')) {
    issues.push(`${rel}: missing cloud/cloud-hosted deployment profile in vocabulary`);
  }
  if (spec.vocabulary?.hosting && !spec.vocabulary?.deploymentProfile) {
    issues.push(`${rel}: retired vocabulary.hosting still active; run align-app-topology-deployment-profiles.mjs`);
  }
  if (profiles.includes('self-hosted') || profiles.includes('cloud-hosted')) {
    issues.push(`${rel}: retired hosting deployment values remain in vocabulary`);
  }
  for (const profile of profiles) {
    const normalized = profile === 'self-hosted'
      ? 'standalone'
      : profile === 'cloud-hosted'
        ? 'cloud'
        : profile;
    if (['standalone', 'cloud'].includes(normalized) && !deploymentProfiles.has(normalized)) {
      issues.push(`${rel}: topology vocabulary declares unsupported deployment profile ${normalized}`);
    }
  }

  if (spec.schemaVersion === 5 && spec.cloudIngress) {
    issues.push(`${rel}: schema v5 application topology must not declare retired cloudIngress implementation metadata`);
  }

  const platformSurface = spec.surfaces?.['platform.api-gateway'];
  if (supportsCloud) {
    if (!platformSurface) {
      issues.push(`${rel}: cloud deployment capability requires platform.api-gateway surface`);
    } else {
      if (!spec.cloudPublicHosts?.['platform.api-gateway']?.httpHost
        && !(Array.isArray(spec.cloudPublicHosts?.['platform.api-gateway']?.httpHosts)
          && spec.cloudPublicHosts['platform.api-gateway'].httpHosts.length > 0)) {
        issues.push(`${rel}: cloud deployment capability requires a platform.api-gateway cloud public host`);
      }
      if (!platformSurface.httpUrlEnv
        || spec.envKeys?.apiGatewayBaseUrl !== platformSurface.httpUrlEnv) {
        issues.push(`${rel}: cloud deployment capability requires envKeys.apiGatewayBaseUrl to match platform.api-gateway httpUrlEnv`);
      }
      if (platformSurface.clientHttpEnv
        && spec.envKeys?.clientApiGatewayBaseUrl !== platformSurface.clientHttpEnv) {
        issues.push(`${rel}: cloud deployment capability requires envKeys.clientApiGatewayBaseUrl to match platform.api-gateway clientHttpEnv`);
      }
    }
  } else {
    if (platformSurface) {
      issues.push(`${rel}: standalone-only deployment capability must not declare platform.api-gateway surface`);
    }
    if (spec.cloudPublicHosts?.['platform.api-gateway']) {
      issues.push(`${rel}: standalone-only deployment capability must not declare a platform.api-gateway cloud public host`);
    }
    if (spec.envKeys?.apiGatewayBaseUrl || spec.envKeys?.clientApiGatewayBaseUrl) {
      issues.push(`${rel}: standalone-only deployment capability must not declare platform API gateway env-key aliases`);
    }
  }
  if (spec.schemaVersion === 5 && (
    spec.components?.cloudGateway
    || spec.envKeys?.cloudGatewayBind
    || spec.envKeys?.cloudGatewayConfig
    || spec.envKeys?.gatewayAutostart
    || platformSurface?.owner
    || platformSurface?.bindEnv
    || platformSurface?.autostartEnv
  )) {
    issues.push(`${rel}: application topology must not declare platform cloud gateway implementation details`);
  }

  for (const profileId of Object.keys(spec.profileFiles ?? {})) {
    pushProfileIdIssues(profileId, rel, issues);
    const deploymentProfile = profileId.split('.')[0];
    if (['standalone', 'cloud'].includes(deploymentProfile)
      && !deploymentProfiles.has(deploymentProfile)) {
      issues.push(`${rel}: profileFiles declares unsupported deployment profile ${profileId}`);
    }
  }
  for (const profileId of Object.keys(spec.orchestration?.profiles ?? {})) {
    pushProfileIdIssues(profileId, rel, issues);
    const deploymentProfile = profileId.split('.')[0];
    if (['standalone', 'cloud'].includes(deploymentProfile)
      && !deploymentProfiles.has(deploymentProfile)) {
      issues.push(`${rel}: orchestration declares unsupported deployment profile ${profileId}`);
    }
  }
  for (const [key, profileId] of Object.entries(spec.defaults ?? {})) {
    if (typeof profileId !== 'string' || !key.endsWith('ProfileId')) continue;
    const deploymentProfile = profileId.split('.')[0];
    if (['standalone', 'cloud'].includes(deploymentProfile)
      && !deploymentProfiles.has(deploymentProfile)) {
      issues.push(`${rel}: defaults.${key} selects unsupported deployment profile ${profileId}`);
    }
  }

  for (const profileId of requiredProfiles(spec, deploymentProfiles)) {
    if (!spec.profileFiles?.[profileId]) {
      issues.push(`${rel}: missing profileFiles entry for ${profileId}`);
    } else {
      const envPath = path.join(repoRoot, spec.profileFiles[profileId]);
      if (!fs.existsSync(envPath)) {
        issues.push(`${rel}: missing env file ${spec.profileFiles[profileId]}`);
      }
    }
  }

  const cloudDev = spec.orchestration?.profiles?.['cloud.development'];
  if (supportsCloud && !cloudDev) {
    issues.push(`${rel}: missing cloud.development orchestration profile`);
  } else if (supportsCloud) {
    if (spec.schemaVersion === 5) {
      for (const process of cloudDev.processes ?? []) {
        if (PROCESS_ROLES.has(process.role) && !['client', 'tunnel'].includes(process.role)) {
          issues.push(`${rel}: cloud.development forbids local process role ${process.role}`);
        }
      }
    }
    const localProcesses = spec.schemaVersion === 5
      ? []
      : (cloudDev.processes ?? []).filter((process) => {
      const id = String(process.id ?? process.name ?? process.binary ?? '');
      const explicitTunnel = /(?:tunnel|proxy)/iu.test(id) && !LOCAL_CLOUD_PROCESS_PATTERN.test(id.replace(/(?:tunnel|proxy)/giu, ''));
      return !explicitTunnel && LOCAL_CLOUD_PROCESS_PATTERN.test(id);
      });
    for (const process of localProcesses) {
      const id = process.id ?? process.name ?? process.binary ?? '<unknown>';
      issues.push(`${rel}: cloud.development must not autostart local API/dependency process ${id}`);
    }
  }

  if (spec.schemaVersion === 5) {
    for (const [profileId, orchestration] of Object.entries(spec.orchestration?.profiles ?? {})) {
      for (const process of orchestration.processes ?? []) {
        if (!String(process.id ?? '').trim()) {
          issues.push(`${rel}: ${profileId} process id is required`);
        }
        if (!PROCESS_ROLES.has(process.role)) {
          issues.push(`${rel}: ${profileId} process ${process.id ?? '<unknown>'} requires a canonical role`);
        }
        if (process.role === 'edge-runtime') {
          if (!/^_sdkwork:runtime:[a-z0-9][a-z0-9:-]*$/u.test(String(process.script ?? ''))) {
            issues.push(`${rel}: ${profileId} edge-runtime ${process.id ?? '<unknown>'} requires an _sdkwork:runtime:* script`);
          }
          const decisionRef = String(process.decisionRef ?? '');
          if (!/^docs\/(?:adr|architecture\/decisions)\/[A-Za-z0-9._/-]+\.md$/u.test(decisionRef)) {
            issues.push(`${rel}: ${profileId} edge-runtime ${process.id ?? '<unknown>'} requires a canonical decisionRef`);
          } else if (!fs.existsSync(path.resolve(repoRoot, decisionRef))) {
            issues.push(`${rel}: ${profileId} edge-runtime ${process.id ?? '<unknown>'} decisionRef does not exist: ${decisionRef}`);
          }
        }
      }
    }
    const standaloneDev = spec.orchestration?.profiles?.['standalone.development'];
    if (standaloneDev && spec.surfaces?.['application.public-ingress']) {
      const gatewayCount = (standaloneDev.processes ?? [])
        .filter((process) => process.role === 'api-standalone-gateway').length;
      if (gatewayCount !== 1) {
        issues.push(`${rel}: standalone.development requires exactly one api-standalone-gateway role; found ${gatewayCount}`);
      }
    }
  }

  for (const [profileId, profilePath] of Object.entries(spec.profileFiles ?? {})) {
    if (!profileId.startsWith('standalone.')) continue;
    const envPath = path.join(repoRoot, profilePath);
    if (!fs.existsSync(envPath)) continue;
    const standaloneEnv = readEnv(envPath);
    const forbiddenPlatformKeys = new Set([
      platformSurface?.httpUrlEnv,
      platformSurface?.clientHttpEnv,
      spec.envKeys?.apiGatewayBaseUrl,
      spec.envKeys?.clientApiGatewayBaseUrl,
    ].filter(Boolean));
    for (const key of standaloneEnv.keys()) {
      if (forbiddenPlatformKeys.has(key) || /_PLATFORM_API_GATEWAY_/u.test(key)) {
        issues.push(
          `${rel}: ${profileId} must not define ${key}; embedded dependency APIs use application.public-ingress`,
        );
      }
    }
  }

  const standaloneDevPath = spec.profileFiles?.['standalone.development'];
  const standaloneDev = spec.orchestration?.profiles?.['standalone.development'];
  if (standaloneDevPath && fs.existsSync(path.join(repoRoot, standaloneDevPath))) {
    const standaloneEnv = readEnv(path.join(repoRoot, standaloneDevPath));
    for (const surfaceId of standaloneDev?.healthSurfaces ?? []) {
      const surface = spec.surfaces?.[surfaceId];
      if (!surface?.protocols?.includes('http')) continue;
      if (!surface.httpUrlEnv) {
        issues.push(`${rel}: ${surfaceId} must declare httpUrlEnv for standalone.development health checks`);
        continue;
      }
      const value = standaloneEnv.get(surface.httpUrlEnv);
      if (!value || isPlaceholderUrl(value)) {
        issues.push(`${rel}: standalone.development required health surface ${surfaceId} must resolve ${surface.httpUrlEnv} to a concrete URL`);
      }
    }
  }

  const cloudDevPath = spec.profileFiles?.['cloud.development'];
  if (supportsCloud && cloudDevPath && fs.existsSync(path.join(repoRoot, cloudDevPath))) {
    const cloudDevEnv = readEnv(path.join(repoRoot, cloudDevPath));
    const requiredSurfaceIds = ['application.public-ingress', 'platform.api-gateway']
      .filter((surfaceId) => spec.surfaces?.[surfaceId]?.protocols?.includes('http'));
    const hasExplicitTunnel = (cloudDev?.processes ?? []).some((process) =>
      /(?:tunnel|proxy)/iu.test(String(process.id ?? process.name ?? process.binary ?? '')),
    );
    for (const surfaceId of requiredSurfaceIds) {
      const surface = spec.surfaces[surfaceId];
      if (!surface.httpUrlEnv) {
        issues.push(`${rel}: ${surfaceId} must declare httpUrlEnv for cloud.development`);
        continue;
      }
      const value = cloudDevEnv.get(surface.httpUrlEnv);
      if (!value) {
        issues.push(`${rel}: cloud.development missing explicit ${surface.httpUrlEnv} for ${surfaceId}`);
        continue;
      }
      if (isPlaceholderUrl(value)) {
        issues.push(`${rel}: cloud.development ${surface.httpUrlEnv} must be a concrete deployed URL, not a placeholder`);
      }
      if (isLoopbackUrl(value) && !hasExplicitTunnel) {
        issues.push(`${rel}: cloud.development ${surface.httpUrlEnv} must not use loopback without an explicit tunnel/proxy process`);
      }
      if (surface.autostartEnv && /^(?:1|true|yes|on)$/iu.test(cloudDevEnv.get(surface.autostartEnv) ?? '')) {
        issues.push(`${rel}: cloud.development ${surface.autostartEnv} must disable remote surface autostart`);
      }
    }
  }

  const orch = spec.orchestration?.profiles ?? {};
  const hasStandaloneOrch = Object.keys(orch).some((id) => id.startsWith('standalone.'));
  const hasCloudOrch = Object.keys(orch).some((id) => id.startsWith('cloud.'));
  if (supportsStandalone && !hasStandaloneOrch) {
    issues.push(`${rel}: missing standalone orchestration profile`);
  }
  if (supportsCloud && !hasCloudOrch) {
    issues.push(`${rel}: missing cloud orchestration profile`);
  }

  for (const [profileId, profile] of Object.entries(orch)) {
    if (!profileId.startsWith('standalone.')) continue;
    for (const process of profile.processes ?? []) {
      if (process.id === 'platform.api-gateway') {
        issues.push(`${rel}: ${profileId} must not start platform.api-gateway; dependency APIs are embedded behind application.public-ingress`);
      }
    }
    if ((profile.healthSurfaces ?? []).includes('platform.api-gateway')) {
      issues.push(`${rel}: ${profileId} must not require platform.api-gateway as a health surface`);
    }
  }

  if (
    supportsCloud &&
    (spec.archetype === 'application-http-gateway' ||
      spec.archetype === 'realtime-application-platform') &&
    !spec.surfaces?.['platform.api-gateway']
  ) {
    issues.push(`${rel}: missing platform.api-gateway surface`);
  }

  validateStandaloneBrowserDeliveries(repoRoot, spec, rel, issues);

  return issues;
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      workspace: { type: 'string', default: DEFAULT_WORKSPACE },
      repo: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/check-topology-deployment-profiles.mjs [--root <application> | --workspace <path> [--repo <name>]]');
    return;
  }
  if (values.root && values.repo) {
    console.error('--root and --repo are mutually exclusive');
    process.exitCode = 2;
    return;
  }

  const workspace = path.resolve(values.workspace);
  const repos = values.root
    ? [path.resolve(values.root)]
    : values.repo
      ? [path.join(workspace, values.repo)]
      : fs
        .readdirSync(workspace)
        .filter((name) => name.startsWith('sdkwork-'))
        .map((name) => path.join(workspace, name))
        .filter(
          (repo) => fs.existsSync(path.join(repo, 'specs/topology.spec.json')),
        );

  const allIssues = [];
  for (const repoRoot of repos) {
    const name = path.basename(repoRoot);
    if (name === 'sdkwork-deployments' || name === 'sdkwork-api-cloud-gateway') continue;
    const issues = checkSpec(repoRoot, path.join(repoRoot, 'specs/topology.spec.json'));
    allIssues.push(...issues.map((issue) => values.root || values.repo ? issue : `${name}/${issue}`));
  }

  if (allIssues.length > 0) fail(`found ${allIssues.length} issue(s)`, allIssues);
  console.log(`topology deployment profile check passed (${repos.length} repositories scanned)`);
}

main();
