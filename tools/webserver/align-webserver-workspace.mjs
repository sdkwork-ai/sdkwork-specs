#!/usr/bin/env node
// Workspace-wide webserver alignment: topology hosts → layout v3 TOML.
import fs from 'node:fs';
import path from 'node:path';

import { alignCloudPublicHosts } from './host-registry.mjs';
import {
  buildWebserverDocs,
  writeWebserverLayout,
  webserverSurfaces,
  hostsForSurface,
  certNameFromHost,
} from './build-from-topology.mjs';
import { isPublicHostCompliant, normalizeHost } from './host-registry.mjs';
import { scanWebserverCompliance } from './validate.mjs';
import { renderModuleNginxSidecars } from './render-nginx-sidecars.mjs';
import { auditCommercialReadiness } from './audit-commercial-readiness.mjs';

let yaml = null;
try {
  ({ default: yaml } = await import('js-yaml'));
} catch {
  yaml = null;
}

const workspace = path.resolve(
  process.argv.find((arg) => arg.startsWith('--workspace='))?.slice('--workspace='.length)
  ?? process.argv[2]
  ?? 'E:/sdkwork-space',
);

const CLIENT_ONLY_MODULES = {
  'sdkwork-mall': 'mall',
  'sdkwork-music': 'music',
  'sdkwork-sandbox': 'sandbox',
  'sdkwork-web-framework': 'web_framework',
};

function syntheticTopology(appId) {
  if (appId === 'sdkwork-webserver') {
    return {
      appId: 'sdkwork-webserver',
      applicationCode: 'webserver',
      defaults: { gatewayBind: '127.0.0.1:3900' },
      surfaces: {
        'application.public-ingress': { connectivityPlane: 'application', protocols: ['http'] },
        'application.app-http': { connectivityPlane: 'application', protocols: ['http'] },
        'application.backend-http': { connectivityPlane: 'application', protocols: ['http'] },
      },
      cloudPublicHosts: {},
    };
  }
  const applicationCode = CLIENT_ONLY_MODULES[appId];
  if (!applicationCode) return null;
  return {
    schemaVersion: 5,
    kind: 'sdkwork.app.topology',
    appId,
    applicationCode,
    archetype: 'application-client-root',
    archetypeNotes: 'No owned HTTP public-ingress; nginx webserver profile remains disabled.',
    cloudPublicHosts: {},
  };
}

function loadTopology(name, moduleRoot) {
  const topologyPath = path.join(moduleRoot, 'specs', 'topology.spec.json');
  if (fs.existsSync(topologyPath)) {
    return JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
  }
  return syntheticTopology(name);
}

function ensureTopologyFile(name, moduleRoot, topology) {
  if (!topology || CLIENT_ONLY_MODULES[name] === undefined) return false;
  const specsDir = path.join(moduleRoot, 'specs');
  const topologyPath = path.join(specsDir, 'topology.spec.json');
  if (fs.existsSync(topologyPath)) return false;
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(topologyPath, `${JSON.stringify(topology, null, 2)}\n`);
  return true;
}

function syncDeployExposeFromTopology(moduleRoot, topology, appId) {
  if (!yaml || !topology?.cloudPublicHosts) return false;
  const deployPath = path.join(moduleRoot, 'deployments', 'deploy.yaml');
  if (!fs.existsSync(deployPath)) return false;
  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(deployPath, 'utf8'));
  } catch {
    return false;
  }
  if (!parsed?.profiles) return false;

  const surfaces = webserverSurfaces(appId, topology);
  let mutated = false;

  for (const [profileId, block] of Object.entries(parsed.profiles)) {
    if (!profileId.includes('.')) continue;
    const environment = profileId.split('.').pop();
    if (!['development', 'test', 'staging', 'production'].includes(environment)) continue;

    const registeredHosts = [...new Set(
      surfaces.flatMap((surfaceId) => hostsForSurface(topology.cloudPublicHosts[surfaceId], environment)),
    )].filter(isPublicHostCompliant);

    if (registeredHosts.length === 0) {
      if (Array.isArray(block.expose) && block.expose.length > 0) {
        delete block.expose;
        mutated = true;
      }
      continue;
    }

    const existing = Array.isArray(block.expose) ? block.expose : [];
    const template = existing.find((item) => typeof item === 'object' && item?.domain) ?? {
      tls: 'sdkwork.com',
      mode: 'web',
      web: 'adaptive',
    };

    const groups = new Map();
    for (const host of registeredHosts) {
      const cert = certNameFromHost(host);
      if (!groups.has(cert)) groups.set(cert, []);
      groups.get(cert).push(host);
    }

    const nextExpose = [];
    for (const [cert, groupHosts] of groups) {
      const sorted = [...groupHosts].sort((a, b) => a.localeCompare(b));
      const [domain, ...aliases] = sorted;
      const prior = existing.find(
        (item) => normalizeHost(typeof item === 'string' ? item : item?.domain) === normalizeHost(domain),
      );
      const baseItem = prior && typeof prior === 'object'
        ? { ...prior, domain, tls: cert }
        : { ...template, domain, tls: cert };
      if (aliases.length > 0) baseItem.aliases = aliases;
      else delete baseItem.aliases;
      nextExpose.push(baseItem);
    }

    const before = JSON.stringify(existing);
    const after = JSON.stringify(nextExpose);
    if (before !== after) {
      block.expose = nextExpose;
      mutated = true;
    }
  }

  if (mutated) {
    fs.writeFileSync(deployPath, yaml.dump(parsed, { lineWidth: 120, noRefs: true }));
  }
  return mutated;
}

let topologyUpdates = 0;
let deployUpdates = 0;
let webserverUpdates = 0;
let sidecarUpdates = 0;
let sidecarSkipped = 0;

for (const name of fs.readdirSync(workspace)) {
  if (!name.startsWith('sdkwork-')) continue;
  if (!fs.existsSync(path.join(workspace, name, 'deployments'))) continue;
  const moduleRoot = path.join(workspace, name);
  let topology = loadTopology(name, moduleRoot);
  if (!topology) continue;

  if (ensureTopologyFile(name, moduleRoot, topology)) topologyUpdates += 1;

  const topologyPath = path.join(moduleRoot, 'specs', 'topology.spec.json');
  const before = fs.existsSync(topologyPath) ? fs.readFileSync(topologyPath, 'utf8') : null;
  if (!CLIENT_ONLY_MODULES[name]) {
    alignCloudPublicHosts(topology);
  }
  if (fs.existsSync(topologyPath)) {
    const after = `${JSON.stringify(topology, null, 2)}\n`;
    if (after !== before) {
      fs.writeFileSync(topologyPath, after);
      topologyUpdates += 1;
    }
  }

  if (syncDeployExposeFromTopology(moduleRoot, topology, name)) deployUpdates += 1;

  const docs = buildWebserverDocs({ appId: name, topology, moduleRoot });
  writeWebserverLayout(moduleRoot, docs, { writeAppRoots: name !== 'sdkwork-webserver', appId: name, topology });
  webserverUpdates += 1;

  const sidecarResult = renderModuleNginxSidecars(moduleRoot, { quiet: true });
  if (sidecarResult.skipped) sidecarSkipped += 1;
  else sidecarUpdates += 1;
}

const { modules, errorCount } = scanWebserverCompliance(workspace);
const hostViolations = [];
for (const module of modules) {
  if (module.missing) continue;
  for (const message of [...(module.errors ?? []), ...(module.warnings ?? [])]) {
    if (message.includes('(W24)')) hostViolations.push(`${module.name}: ${message}`);
  }
}

console.log(
  `align-webserver-workspace: topology=${topologyUpdates}, deploy=${deployUpdates}, webserver=${webserverUpdates}, sidecars=${sidecarUpdates}, sidecarsSkipped=${sidecarSkipped}`,
);
console.log(`validation: ${modules.length} modules, ${errorCount} error(s), ${hostViolations.length} W24 host issue(s)`);
if (hostViolations.length > 0) {
  for (const line of hostViolations.slice(0, 20)) console.log(`  ${line}`);
}

const commercial = auditCommercialReadiness(workspace);
console.log(
  `commercial-readiness: ${commercial.critical.length} critical, ${commercial.warnings.length} warnings, ${commercial.optimizations.length} optimizations`,
);
if (commercial.critical.length > 0) {
  for (const { module, message } of commercial.critical.slice(0, 10)) {
    console.log(`  ${module}: ${message}`);
  }
}

process.exit(errorCount > 0 || commercial.critical.length > 0 ? 1 : 0);
