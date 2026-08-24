// Resolve deploy.yaml expose.mode for edge nginx wiring (SDKWORK_DEPLOY_SPEC.md §8).

import fs from 'node:fs';
import path from 'node:path';

let yaml = null;
try {
  ({ default: yaml } = await import('js-yaml'));
} catch {
  yaml = null;
}

/** Product / platform edges that reverse-proxy; Adaptive Web is in-process or N/A (W23). */
const EDGE_PROXY_ONLY_MODULES = new Set([
  'sdkwork-webserver',
  'sdkwork-api-cloud-gateway',
]);

export function isEdgeProxyOnlyModule(appId) {
  return EDGE_PROXY_ONLY_MODULES.has(appId);
}

function collectExposeModes(deployDoc) {
  const modes = new Set();
  const profiles = deployDoc?.profiles;
  if (profiles && typeof profiles === 'object') {
    for (const block of Object.values(profiles)) {
      for (const item of block?.expose ?? []) {
        if (typeof item === 'object' && item?.mode) modes.add(String(item.mode));
      }
    }
  }
  for (const item of deployDoc?.expose ?? []) {
    if (typeof item === 'object' && item?.mode) modes.add(String(item.mode));
  }
  return modes;
}

/**
 * True when edge nginx must serve Adaptive Web PC/H5 on production hosts.
 * @param {string} moduleRoot
 * @param {string} appId
 */
export function moduleUsesAdaptiveWebEdge(moduleRoot, appId) {
  if (isEdgeProxyOnlyModule(appId)) return false;
  if (!yaml) return false;
  const deployPath = path.join(moduleRoot, 'deployments', 'deploy.yaml');
  if (!fs.existsSync(deployPath)) return false;
  try {
    const deployDoc = yaml.load(fs.readFileSync(deployPath, 'utf8'));
    const modes = collectExposeModes(deployDoc);
    return modes.has('web') || modes.has('web+api');
  } catch {
    return false;
  }
}

export function readDeployYaml(moduleRoot) {
  if (!yaml) return null;
  const deployPath = path.join(moduleRoot, 'deployments', 'deploy.yaml');
  if (!fs.existsSync(deployPath)) return null;
  try {
    return yaml.load(fs.readFileSync(deployPath, 'utf8'));
  } catch {
    return null;
  }
}
