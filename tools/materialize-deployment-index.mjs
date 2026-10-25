#!/usr/bin/env node
/** Materialize the deployment profile index from an existing topology v5 authority. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WORKSPACE = path.resolve(SPECS_ROOT, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

function relativePosix(from, to) {
  return path.relative(from, to).replaceAll('\\', '/');
}

function existingApplicationId(repoRoot) {
  const manifestPath = path.join(repoRoot, 'agent.app.config.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = readJson(manifestPath);
  return manifest?.app?.key ?? manifest?.backend?.appId ?? null;
}

export function planDeploymentIndex(repoRoot) {
  const root = path.resolve(repoRoot);
  const topologyPath = path.join(root, 'specs', 'topology.spec.json');
  const configPath = path.join(root, 'etc', 'sdkwork.deployment.config.json');
  if (!fs.existsSync(topologyPath) || !fs.existsSync(path.join(root, 'agent.app.config.json'))) {
    return { root, skipped: true, actions: [], conflict: null };
  }
  if (fs.existsSync(configPath)) {
    return { root, configPath, skipped: true, actions: [], conflict: null };
  }

  const topology = readJson(topologyPath);
  if (topology?.schemaVersion !== 5 || topology?.kind !== 'sdkwork.app.topology') {
    return {
      root,
      configPath,
      skipped: false,
      actions: [],
      conflict: 'topology authority is not sdkwork.app.topology schemaVersion 5',
    };
  }
  const application = topology.appId;
  const manifestApplication = existingApplicationId(root);
  if (!application || (manifestApplication && manifestApplication !== application)) {
    return {
      root,
      configPath,
      skipped: false,
      actions: [],
      conflict: `application identity mismatch: topology=${application ?? 'missing'}, manifest=${manifestApplication ?? 'missing'}`,
    };
  }

  const profileEntries = Object.entries(topology.profileFiles ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (profileEntries.length === 0) {
    return {
      root,
      configPath,
      skipped: false,
      actions: [],
      conflict: 'topology profileFiles is empty',
    };
  }
  const etcRoot = path.join(root, 'etc');
  const profiles = {};
  for (const [profileId, sourcePath] of profileEntries) {
    if (typeof sourcePath !== 'string') {
      return {
        root,
        configPath,
        skipped: false,
        actions: [],
        conflict: `topology profile ${profileId} does not declare a string file path`,
      };
    }
    const absoluteProfile = path.resolve(root, sourcePath);
    const relativeFromEtc = relativePosix(etcRoot, absoluteProfile);
    if (relativeFromEtc.startsWith('../') || relativeFromEtc === '..') {
      return {
        root,
        configPath,
        skipped: false,
        actions: [],
        conflict: `topology profile ${profileId} is outside etc/: ${sourcePath}`,
      };
    }
    if (!fs.existsSync(absoluteProfile)) {
      return {
        root,
        configPath,
        skipped: false,
        actions: [],
        conflict: `topology profile ${profileId} is missing: ${sourcePath}`,
      };
    }
    profiles[profileId] = { config: relativeFromEtc };
  }

  const defaultProfile = topology?.defaults?.developmentProfileId;
  if (!defaultProfile || !profiles[defaultProfile]) {
    return {
      root,
      configPath,
      skipped: false,
      actions: [],
      conflict: `development default profile is missing from profileFiles: ${defaultProfile ?? 'missing'}`,
    };
  }
  const config = {
    schemaVersion: 1,
    kind: 'sdkwork.deployment-index',
    application,
    defaultProfile,
    profiles,
  };
  return {
    root,
    configPath,
    config,
    skipped: false,
    actions: [`write ${relativePosix(root, configPath)}`],
    conflict: null,
  };
}

export function writeDeploymentIndex(plan) {
  if (plan.conflict || plan.skipped || !plan.config) return false;
  fs.mkdirSync(path.dirname(plan.configPath), { recursive: true });
  fs.writeFileSync(plan.configPath, `${JSON.stringify(plan.config, null, 2)}\n`, 'utf8');
  return true;
}

function main() {
  const { values } = parseArgs({ options: {
    workspace: { type: 'string', default: DEFAULT_WORKSPACE },
    repo: { type: 'string' },
    write: { type: 'boolean', default: false },
  } });
  const workspace = path.resolve(values.workspace);
  const repos = values.repo
    ? [path.resolve(workspace, values.repo)]
    : fs.readdirSync(workspace, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(workspace, entry.name));
  let actions = 0;
  let conflicts = 0;
  for (const repoRoot of repos) {
    const plan = planDeploymentIndex(repoRoot);
    if (plan.conflict) {
      console.error(`[conflict] ${path.basename(repoRoot)}: ${plan.conflict}`);
      conflicts += 1;
      continue;
    }
    for (const action of plan.actions) {
      console.log(`${values.write ? '' : '[preview] '}${path.basename(repoRoot)}: ${action}`);
      actions += 1;
    }
    if (values.write) writeDeploymentIndex(plan);
  }
  console.log(`Deployment index actions: ${actions}; conflicts: ${conflicts}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
