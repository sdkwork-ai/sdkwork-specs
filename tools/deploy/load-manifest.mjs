import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml-resolver.mjs';

const DEPLOY_FILE = 'deployments/deploy.yaml';

export function loadDeployManifest(repoRoot) {
  const deployPath = path.join(repoRoot, DEPLOY_FILE);
  if (!fs.existsSync(deployPath)) {
    throw new Error(`missing ${DEPLOY_FILE}`);
  }
  const raw = fs.readFileSync(deployPath, 'utf8');
  const doc = parseYaml(raw, repoRoot);
  if (!doc || typeof doc !== 'object') {
    throw new Error(`${DEPLOY_FILE} must parse to an object`);
  }
  return { doc, deployPath };
}

export function loadTopology(repoRoot) {
  const topologyPath = path.join(repoRoot, 'specs/topology.spec.json');
  if (!fs.existsSync(topologyPath)) {
    throw new Error('missing specs/topology.spec.json');
  }
  return JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
}

export function loadAppConfig(repoRoot) {
  const configPath = path.join(repoRoot, 'agent.app.config.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function resolveProfileBlock(doc, profileId, options = {}) {
  const allowDefault = options.allowDefault !== false;
  if (doc.profiles && typeof doc.profiles === 'object') {
    const forbiddenRootKeys = ['deployment', 'expose', 'packages', 'overrides', 'install', 'profile'];
    for (const key of forbiddenRootKeys) {
      if (doc[key] !== undefined) {
        throw new Error(
          `profiles mode forbids root-level "${key}"; use profiles.<profile-id> instead`,
        );
      }
    }
    const selected = profileId ?? (allowDefault ? doc.defaultProfile : undefined);
    if (!selected) {
      throw new Error('explicit --profile is required for this operation');
    }
    const block = doc.profiles[selected];
    if (!block) {
      throw new Error(`unknown profile "${selected}"`);
    }
    return { profileId: selected, block };
  }

  const selected = profileId ?? (allowDefault ? doc.profile : undefined);
  if (!selected) {
    throw new Error('explicit --profile is required for this operation');
  }
  return {
    profileId: selected,
    block: {
      install: doc.install,
      deployment: doc.deployment,
      expose: doc.expose,
      packages: doc.packages,
      overrides: doc.overrides,
    },
  };
}
