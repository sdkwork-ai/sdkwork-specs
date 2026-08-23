#!/usr/bin/env node
// Align deployments/webserver layout v3 from specs/topology.spec.json across modules.
// Usage:
//   node tools/align-webserver-workspace.mjs --workspace <sdkwork-space-root>
//   node tools/align-webserver-workspace.mjs --root <module-root>

import fs from 'node:fs';
import path from 'node:path';

import {
  buildWebserverDocs,
  splitLegacyCommonIntoEnvironments,
  writeWebserverLayout,
  LIFECYCLE_ENVIRONMENTS,
} from './webserver/build-from-topology.mjs';
import { parseTomlSubset } from './webserver/toml.mjs';
import { validateWebserverDir } from './webserver/validate.mjs';

const FRAMEWORK_SKIP = new Set([
  'sdkwork-utils',
  'sdkwork-web-framework',
  'sdkwork-rpc-framework',
  'sdkwork-database',
  'sdkwork-id',
  'sdkwork-catalog',
  'sdkwork-log',
  'sdkwork-github-workflow',
]);

function disabledLayoutDocs(appId) {
  const runtimeCode = appId.replace(/^sdkwork-/u, '');
  return {
    enabled: false,
    common: {
      specVersion: 1,
      kind: 'sdkwork.webserver.server',
      id: runtimeCode,
      enabled: false,
      description: `${appId} webserver placeholder`,
    },
    environments: Object.fromEntries(
      LIFECYCLE_ENVIRONMENTS.map((environment) => [environment, { environment }]),
    ),
    standalone: { profile: 'standalone' },
    cloud: { profile: 'cloud' },
  };
}

function parseArgs(argv) {
  const args = { workspace: null, root: null, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--workspace') args.workspace = argv[i + 1];
    else if (argv[i] === '--root') args.root = argv[i + 1];
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

function loadTopology(moduleRoot) {
  const tp = path.join(moduleRoot, 'specs', 'topology.spec.json');
  try {
    return JSON.parse(fs.readFileSync(tp, 'utf8'));
  } catch {
    return null;
  }
}

function readProfileDoc(moduleRoot, profile) {
  const filePath = path.join(moduleRoot, 'deployments', 'webserver', `server.${profile}.toml`);
  if (!fs.existsSync(filePath)) {
    return { profile, http: { upstream: [{ name: 'gateway', target: [{ address: '127.0.0.1:3900', weight: 1 }] }] } };
  }
  try {
    return parseTomlSubset(fs.readFileSync(filePath, 'utf8'), `server.${profile}.toml`);
  } catch {
    return { profile };
  }
}

function alignModule(moduleRoot, { dryRun = false } = {}) {
  const name = path.basename(moduleRoot);
  if (FRAMEWORK_SKIP.has(name)) {
    if (!dryRun && fs.existsSync(path.join(moduleRoot, 'deployments', 'webserver'))) {
      writeWebserverLayout(moduleRoot, disabledLayoutDocs(name));
    }
    return { name, status: 'skipped', reason: 'framework repo (disabled layout v3 written)' };
  }
  if (!fs.existsSync(path.join(moduleRoot, 'deployments'))) {
    return { name, status: 'skipped', reason: 'no deployments/' };
  }

  const topology = loadTopology(moduleRoot);
  const commonPath = path.join(moduleRoot, 'deployments', 'webserver', 'server.common.toml');
  let docs;

  if (topology) {
    docs = buildWebserverDocs({ appId: name, topology, moduleRoot });
  } else if (fs.existsSync(commonPath)) {
    const common = parseTomlSubset(fs.readFileSync(commonPath, 'utf8'), 'server.common.toml');
    if (!common.http?.server?.length) {
      docs = disabledLayoutDocs(name);
    } else {
      const split = splitLegacyCommonIntoEnvironments(common);
      docs = {
        enabled: common.enabled !== false,
        common: split.common,
        environments: split.environments,
        standalone: readProfileDoc(moduleRoot, 'standalone'),
        cloud: readProfileDoc(moduleRoot, 'cloud'),
        moduleRoot,
      };
    }
  } else {
    docs = disabledLayoutDocs(name);
  }

  if (!dryRun) {
    writeWebserverLayout(moduleRoot, docs);
  }

  const validation = validateWebserverDir(moduleRoot);
  return {
    name,
    status: docs.enabled ? 'aligned' : 'disabled',
    validationOk: validation.ok,
    errors: validation.errors ?? [],
    warnings: validation.warnings ?? [],
  };
}

function discoverModules(workspaceRoot) {
  return fs
    .readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((moduleRoot) => fs.existsSync(path.join(moduleRoot, 'deployments')));
}

const args = parseArgs(process.argv);
const targets = args.root
  ? [path.resolve(args.root)]
  : args.workspace
    ? discoverModules(path.resolve(args.workspace))
    : [];

if (targets.length === 0) {
  console.error('align-webserver-workspace: pass --workspace <root> or --root <module>');
  process.exit(1);
}

let errorCount = 0;
for (const moduleRoot of targets.sort()) {
  const result = alignModule(moduleRoot, { dryRun: args.dryRun });
  const prefix = args.dryRun ? 'dry-run' : result.status;
  console.log(`${prefix.padEnd(10)} ${result.name}${result.reason ? ` (${result.reason})` : ''}`);
  for (const warning of result.warnings ?? []) console.warn(`  warning: ${warning}`);
  for (const error of result.errors ?? []) {
    console.error(`  error: ${error}`);
    errorCount += 1;
  }
  if (result.validationOk === false && result.errors?.length === 0) errorCount += 1;
}

console.log(
  `align-webserver-workspace: ${targets.length} module(s)${args.dryRun ? ' (dry-run)' : ''}, ${errorCount} validation error(s)`,
);
process.exit(errorCount > 0 ? 1 : 0);
