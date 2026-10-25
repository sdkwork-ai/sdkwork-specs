import fs from 'node:fs';
import path from 'node:path';

import { FRAMEWORK_REPOS } from './constants.mjs';

export function isDeployableRepo(repoRoot) {
  const name = path.basename(repoRoot);
  if (FRAMEWORK_REPOS.has(name)) return false;
  if (!fs.existsSync(path.join(repoRoot, 'Cargo.toml'))) return false;
  if (fs.existsSync(path.join(repoRoot, 'agent.app.config.json'))) return true;
  const cratesDir = path.join(repoRoot, 'crates');
  if (!fs.existsSync(cratesDir)) return false;
  return fs.readdirSync(cratesDir).some((entry) => /assembly|standalone-gateway|gateway-assembly/iu.test(entry));
}

export function discoverRepos(workspaceRoot, options = {}) {
  const includeAppConfigOnly = Boolean(options.includeAppConfigOnly);
  const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  const repos = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) continue;
    const repoRoot = path.join(workspaceRoot, entry.name);
    if (isDeployableRepo(repoRoot)) {
      repos.push(repoRoot);
      continue;
    }
    if (
      includeAppConfigOnly &&
      fs.existsSync(path.join(repoRoot, 'agent.app.config.json'))
    ) {
      repos.push(repoRoot);
    }
  }
  return repos.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

export function readTopology(repoRoot) {
  const topologyPath = path.join(repoRoot, 'specs/topology.spec.json');
  if (!fs.existsSync(topologyPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
  } catch {
    return null;
  }
}

export function runtimeCodeFromTopology(topology, repoRoot) {
  const code = topology?.applicationCode?.trim();
  if (code) return code;
  return path.basename(repoRoot).replace(/^sdkwork-/u, '').replace(/-/gu, '_');
}

export function envPrefixFromCode(runtimeCode) {
  return runtimeCode.replace(/[^a-z0-9]+/giu, '_').replace(/^_+|_+$/gu, '').toUpperCase();
}
