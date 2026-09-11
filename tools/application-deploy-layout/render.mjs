import path from 'node:path';

import { PROFILE_ID_PATTERN } from '../deploy/schema-validate.mjs';
import { resolveWebMode } from '../deploy/web.mjs';
import { LAYOUT_MARKER_END, LAYOUT_MARKER_START } from './constants.mjs';
import { envPrefixFromCode } from './discover.mjs';

export function renderLayoutReadmeSection({ appId, runtimeCode }) {
  const prefix = envPrefixFromCode(runtimeCode);
  const configRoot = `/etc/sdkwork/${runtimeCode}/`;
  return `${LAYOUT_MARKER_START}
## Installed Runtime Paths

Authority: \`APPLICATION_DEPLOY_LAYOUT_SPEC.md\` (\`../sdkwork-specs/\`).

| Item | Value |
| --- | --- |
| \`appId\` | \`${appId}\` |
| \`runtimeCode\` | \`${runtimeCode}\` |
| Config root | \`${configRoot}\` |
| Runtime TOML | \`${configRoot}config.toml\` |
| Secrets | \`${configRoot}secrets/\` |
| Override | \`SDKWORK_${prefix}_CONFIG_FILE\` |

Source profiles live under \`etc/\` (\`sdkwork.deployment.config.json\` index). Deploy manifest: \`deployments/deploy.yaml\`. Web data-plane source: \`deployments/webserver/\` (\`SDKWORK_WEBSERVER_SPEC.md\` layout v3).

\`\`\`bash
node ../sdkwork-specs/tools/check-source-config-standard.mjs --root .
node ../sdkwork-specs/tools/check-application-deploy-layout.mjs --root .
node ../sdkwork-specs/tools/check-webserver-toml-standard.mjs --root deployments/webserver
\`\`\`
${LAYOUT_MARKER_END}
`;
}

export function renderConfigTomlExample({ runtimeCode, appId }) {
  const prefix = envPrefixFromCode(runtimeCode);
  return `# Example runtime config for ${appId}. Installers write ${`/etc/sdkwork/${runtimeCode}/config.toml`}.
# Development: SDKWORK_${prefix}_CONFIG_FILE=etc/examples/config.toml.example

[profile]
deployment_profile = "standalone"
environment = "development"
profile_id = "standalone.development"

[database]
engine = "postgresql"
host = "127.0.0.1"
port = 5432
password_file = ".sdkwork/runtime/secrets/database.secret"
ssl_mode = "disable"
auto_migrate = true
`;
}

export function renderDisabledWebserverCommon({ runtimeCode, appId }) {
  return `specVersion = 1
kind = "sdkwork.webserver.server"
id = "${runtimeCode}"
enabled = false
description = "${appId} webserver placeholder (align-application-deploy-layout)"
`;
}

export function renderWebserverProfile(profile) {
  return `profile = "${profile}"\n`;
}

function primaryHostForProfile(topology, profileId) {
  const envSuffix = profileId.split('.').pop();
  const hosts = topology?.cloudPublicHosts?.['application.public-ingress'];
  if (!hosts) return null;
  if (typeof hosts === 'string') return hosts;
  if (hosts.httpHost) {
    if (envSuffix === 'production') return hosts.httpHost;
    const base = hosts.httpHost.replace(/\.sdkwork\.com$/u, '');
    if (envSuffix === 'development') return `${base}-dev.sdkwork.com`;
    if (envSuffix === 'test') return `${base}-test.sdkwork.com`;
    if (envSuffix === 'staging') return `${base}-staging.sdkwork.com`;
    return hosts.httpHost;
  }
  if (hosts[envSuffix]?.httpHost) return hosts[envSuffix].httpHost;
  return null;
}

export function renderDeployYaml({ topology, appId, moduleRoot = null }) {
  // A deployment manifest may only declare deployable profiles. The topology
  // vocabulary is wider (it also covers development and demo, which are local
  // lifecycle environments), so emitting every topology profile produced a
  // manifest that immediately failed check-deploy-standard — the bug that gave
  // newly bootstrapped repositories an invalid deployments/deploy.yaml.
  const profileIds = Object.keys(topology?.profileFiles ?? topology?.profiles ?? {})
    .filter((id) => PROFILE_ID_PATTERN.test(id))
    .sort();
  if (profileIds.length === 0) {
    profileIds.push('cloud.production');
  }

  // A public domain may only advertise a web edge when the application ships a
  // web surface. An API-only application (no apps/<app>-pc/, no -h5/, no static
  // fallback) must expose `api`, or the manifest fails web-surface validation.
  const webMode = moduleRoot ? resolveWebMode(moduleRoot, appId, 'adaptive') : null;
  const hasWebSurface = webMode ? (webMode.errors ?? []).length === 0 : true;
  const defaultProfile =
    topology?.defaults?.productionProfileId ??
    profileIds.find((id) => id.endsWith('.production')) ??
    profileIds[0];

  const lines = ['version: 2', `defaultProfile: ${defaultProfile}`, '', 'profiles:'];
  for (const profileId of profileIds) {
    const [deploymentProfile, environment] = profileId.split('.');
    const isCloud = deploymentProfile === 'cloud';
    const domain = primaryHostForProfile(topology, profileId) ?? `${runtimeCodeFromProfile(appId)}.internal.example`;
    const envPath =
      topology?.profileFiles?.[profileId] ??
      `etc/topology/${profileId}.env`;
    const normalizedEnv = envPath.replace(/^configs\//u, 'etc/');

    lines.push(`  ${profileId}:`);
    lines.push('    deployment:');
    lines.push(`      deploymentProfile: ${deploymentProfile}`);
    lines.push(`      environment: ${environment}`);
    lines.push(
      `      deliveryKind: ${isCloud ? 'container-image' : 'host-package'}`,
    );
    lines.push(
      `      deploymentDriver: ${isCloud ? 'kubernetes' : 'host-service'}`,
    );
    lines.push(
      `      managementModel: ${isCloud ? 'sdkwork-managed' : 'customer-managed'}`,
    );
    lines.push(
      `      tenancyModel: ${isCloud ? 'multi-tenant' : 'single-tenant'}`,
    );
    lines.push(
      `      isolationModel: ${isCloud ? 'shared' : 'dedicated'}`,
    );
    lines.push(
      `      networkExposure: ${isCloud ? 'public' : 'private'}`,
    );
    lines.push(
      `      rolloutStrategy: ${isCloud ? 'rolling' : 'recreate'}`,
    );
    lines.push(
      `      availabilityMode: ${isCloud ? 'high-availability' : 'single-instance'}`,
    );
    lines.push('    install:');
    lines.push('      layout: binary-package');
    if (domain && !domain.includes('internal.example')) {
      lines.push('    expose:');
      lines.push(`      - domain: ${domain}`);
      lines.push('        tls: sdkwork.com');
      if (hasWebSurface) {
        lines.push('        mode: web+api');
        lines.push('        web: adaptive');
      } else {
        lines.push('        mode: api');
      }
    } else {
      lines.push('    expose: []');
    }
    lines.push('    packages: []');
    lines.push('    overrides:');
    lines.push('      topology:');
    lines.push('        spec: specs/topology.spec.json');
    lines.push(`        profile: ${profileId}`);
    lines.push(`        env: ${normalizedEnv}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function runtimeCodeFromProfile(appId) {
  return appId.replace(/^sdkwork-/u, '');
}

/**
 * Insert or replace the deploy-layout section of `etc/README.md`.
 *
 * This MUST be idempotent: the workspace aligner is run repeatedly
 * (align-application-deploy-layout.mjs --workspace), and its contract is that a
 * repo already in the canonical shape reports no change. The previous
 * implementation re-appended the suffix after the end marker verbatim while
 * `section` already carried the newline that terminated the marker line, so
 * every run appended one more newline to the file, forever — a spurious diff
 * in every repository on every invocation. Both the section and the file tail
 * are therefore normalised to a single canonical shape here.
 */
export function upsertLayoutSection(existing, section, title = 'Source Configuration') {
  const block = section.replace(/\s+$/u, '');
  if (!existing) return `# ${title}\n\n${block}\n`;
  if (existing.includes(LAYOUT_MARKER_START)) {
    const start = existing.indexOf(LAYOUT_MARKER_START);
    const end = existing.indexOf(LAYOUT_MARKER_END);
    if (end > start) {
      const before = existing.slice(0, start).replace(/\s+$/u, '');
      const after = existing
        .slice(end + LAYOUT_MARKER_END.length)
        .replace(/^\s+/u, '')
        .replace(/\s+$/u, '');
      if (!after) return `${before}\n\n${block}\n`;
      return `${before}\n\n${block}\n\n${after}\n`;
    }
  }
  return `${existing.replace(/\s+$/u, '')}\n\n${block}\n`;
}
