#!/usr/bin/env node
// Per-module alignment audit: topology multi-base, webserver TOML, validation.
import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_PRODUCT_BASE_DOMAINS } from './host-registry.mjs';
import { buildWebserverDocs, webserverSurfaces } from './build-from-topology.mjs';
import { validateWebserverDir } from './validate.mjs';
import { LAYOUT_V3_FILES } from './layout-v3.mjs';

const workspaceArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const workspace = path.resolve(
  workspaceArg && fs.existsSync(workspaceArg) && fs.statSync(workspaceArg).isDirectory()
    ? workspaceArg
    : 'E:/sdkwork-space',
);
const verbose = process.argv.includes('--verbose');
const expectedBases = DEFAULT_PRODUCT_BASE_DOMAINS.length;

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
        'application.public-ingress': { protocols: ['http'] },
        'application.app-http': { protocols: ['http'] },
        'application.backend-http': { protocols: ['http'] },
      },
      cloudPublicHosts: {},
    };
  }
  const applicationCode = CLIENT_ONLY_MODULES[appId];
  if (!applicationCode) return null;
  return {
    appId,
    applicationCode,
    archetype: 'application-client-root',
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

function countHosts(block) {
  if (!block) return 0;
  if (Array.isArray(block.httpHosts) && block.httpHosts.length > 0) return block.httpHosts.length;
  if (block.httpHost) return 1;
  return 0;
}

const rows = [];
let okCount = 0;
let issueCount = 0;

for (const name of fs.readdirSync(workspace).filter((n) => n.startsWith('sdkwork-')).sort()) {
  const moduleRoot = path.join(workspace, name);
  if (!fs.existsSync(path.join(moduleRoot, 'deployments'))) continue;

  const issues = [];
  const hasTopologyFile = fs.existsSync(path.join(moduleRoot, 'specs/topology.spec.json'));
  const missingLayout = LAYOUT_V3_FILES.filter(
    (file) => !fs.existsSync(path.join(moduleRoot, 'deployments/webserver', file)),
  );
  if (missingLayout.length > 0) issues.push(`missing layout: ${missingLayout.join(', ')}`);

  const validation = validateWebserverDir(moduleRoot);
  if (!validation.ok) {
    for (const error of validation.errors.slice(0, 3)) issues.push(error);
    if (validation.errors.length > 3) issues.push(`... +${validation.errors.length - 3} validation errors`);
  }
  for (const warning of (validation.warnings ?? []).filter((w) => w.includes('(W18)'))) {
    issues.push(warning);
  }

  const topology = loadTopology(name, moduleRoot);
  const docs = topology?.cloudPublicHosts
    ? buildWebserverDocs({ appId: name, topology, moduleRoot })
    : { enabled: false, environments: {} };
  const webserverState = docs.enabled ? 'enabled' : 'disabled';

  let prodBases = 0;
  let prodHosts = 0;
  let topoBases = 0;
  let envParity = 'ok';

  if (docs.enabled) {
    const prodServers = docs.environments.production?.http?.server ?? [];
    const names = prodServers.flatMap((s) => s.serverName ?? []);
    prodHosts = names.length;
    prodBases = new Set(names.map((h) => h.split('.').slice(-2).join('.'))).size;
    if (topology?.surfaces?.['application.public-ingress'] && prodBases < expectedBases) {
      issues.push(`webserver production base domains: ${prodBases}/${expectedBases}`);
    }
    for (const environment of ['development', 'test', 'staging']) {
      const envNames = (docs.environments[environment]?.http?.server ?? [])
        .flatMap((s) => s.serverName ?? []);
      const envBases = new Set(envNames.map((h) => h.split('.').slice(-2).join('.'))).size;
      if (prodBases > 0 && envBases !== prodBases) {
        envParity = `${environment}:${envBases}/${prodBases}`;
        issues.push(`environment parity ${environment}: ${envBases}/${prodBases} base domains`);
      }
    }
  }

  const ingress = topology?.cloudPublicHosts?.['application.public-ingress'];
  if (ingress) {
    topoBases = countHosts(ingress);
    const devBases = countHosts(ingress.environments?.development);
    if (topoBases > 0 && topoBases < expectedBases) {
      issues.push(`topology production hosts: ${topoBases}/${expectedBases}`);
    }
    if (devBases > 0 && devBases < expectedBases) {
      issues.push(`topology development hosts: ${devBases}/${expectedBases}`);
    }
  }

  const surfaces = topology ? webserverSurfaces(name, topology).length : 0;
  const status = issues.length === 0 ? 'ok' : 'issue';
  if (status === 'ok') okCount += 1;
  else issueCount += 1;

  rows.push({
    name,
    status,
    webserver: webserverState,
    topology: hasTopologyFile ? 'yes' : 'synthetic',
    surfaces,
    prodBases: docs.enabled ? prodBases : '-',
    prodHosts: docs.enabled ? prodHosts : '-',
    envParity: docs.enabled ? envParity : '-',
    issues,
  });
}

console.log(`audit-modules: ${rows.length} modules, ${okCount} ok, ${issueCount} with issues`);
console.log(`expected base domains per HTTP surface: ${expectedBases}\n`);
console.log('MODULE                          STATUS  WEBSERVER  TOPO   SURF  BASES  HOSTS  ENVS');
for (const row of rows) {
  const label = row.name.padEnd(30);
  const line = `${label}  ${row.status.padEnd(5)}  ${row.webserver.padEnd(9)}  ${String(row.topology).padEnd(5)}  ${String(row.surfaces).padEnd(4)}  ${String(row.prodBases).padEnd(5)}  ${String(row.prodHosts).padEnd(5)}  ${String(row.envParity).padEnd(5)}`;
  console.log(line);
  if (row.issues.length > 0) {
    for (const issue of row.issues) console.log(`${' '.repeat(32)}- ${issue}`);
  } else if (verbose && row.webserver === 'enabled') {
    console.log(`${' '.repeat(32)}  multi-base aligned (${row.prodBases} certificates)`);
  }
}

process.exit(issueCount > 0 ? 1 : 0);
