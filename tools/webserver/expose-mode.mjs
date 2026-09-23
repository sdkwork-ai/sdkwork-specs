// Resolve deploy.yaml expose.mode for edge nginx wiring (SDKWORK_DEPLOY_SPEC.md §8).

import fs from 'node:fs';
import path from 'node:path';

// js-yaml ships two shapes: CJS-default (<=4.x) and ESM named-only (>=5.x).
// Resolving only `default` silently yields `undefined` on the ESM build, and
// destructuring a missing property does NOT throw — so the old try/catch could
// never catch it. Resolve whichever shape is present.
let yaml = null;
let yamlResolutionError = null;
try {
  const mod = await import('js-yaml');
  yaml = mod?.load ? mod : (mod?.default?.load ? mod.default : null);
  if (!yaml) {
    yamlResolutionError = 'js-yaml resolved but exposes no load(); unexpected module shape';
  }
} catch (error) {
  yamlResolutionError = `js-yaml is not installed in sdkwork-specs: ${error?.message ?? error}`;
}

function yamlUnavailableError(moduleRoot) {
  return new Error(
    `${yamlResolutionError}\n`
      + `Refusing to guess expose.mode for ${moduleRoot || '(unknown module)'}.\n`
      + 'Remediation: run `pnpm install` in sdkwork-specs.\n'
      + 'A silent "false" here is NOT harmless: it disables the W29 rule, the\n'
      + 'commercial-readiness adaptive branch, and makes the materializer prune\n'
      + "production `adaptive-web.*` includes.",
  );
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
 *
 * Fail-closed contract: an absent `deployments/deploy.yaml` is a legitimate
 * "no adaptive web" declaration and returns false. But a `deploy.yaml` that
 * EXISTS and cannot be read/parsed must throw — returning false would silently
 * disable W29, blind the commercial-readiness audit, and let the materializer
 * prune production `adaptive-web.*` includes.
 *
 * @param {string} moduleRoot
 * @param {string} appId
 */
export function moduleUsesAdaptiveWebEdge(moduleRoot, appId) {
  if (isEdgeProxyOnlyModule(appId)) return false;
  const deployPath = path.join(moduleRoot, 'deployments', 'deploy.yaml');
  if (!fs.existsSync(deployPath)) return false;
  if (!yaml) throw yamlUnavailableError(moduleRoot);
  let deployDoc;
  try {
    deployDoc = yaml.load(fs.readFileSync(deployPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `cannot parse ${deployPath}: ${error?.message ?? error}\n`
        + 'Refusing to guess expose.mode — a wrong "false" prunes production edge wiring.',
    );
  }
  const modes = collectExposeModes(deployDoc);
  return modes.has('web') || modes.has('web+api');
}

/**
 * Read a module's deploy.yaml when it exists.
 * Returns null only for a genuinely absent file; throws when present-but-unreadable.
 */
export function readDeployYaml(moduleRoot) {
  const deployPath = path.join(moduleRoot, 'deployments', 'deploy.yaml');
  if (!fs.existsSync(deployPath)) return null;
  if (!yaml) throw yamlUnavailableError(moduleRoot);
  try {
    return yaml.load(fs.readFileSync(deployPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot parse ${deployPath}: ${error?.message ?? error}`);
  }
}
