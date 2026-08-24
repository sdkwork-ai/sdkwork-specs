import fs from 'node:fs';
import path from 'node:path';

import {
  LAYOUT_MARKER_END,
  LAYOUT_MARKER_START,
  REQUIRED_ARTIFACTS,
  WEBSERVER_FILES,
} from './constants.mjs';
import {
  envPrefixFromCode,
  readTopology,
  runtimeCodeFromTopology,
} from './discover.mjs';
import { repoTopologyDebt } from './migrate-legacy.mjs';

function fileExists(repoRoot, relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function readmeHasLayoutSection(repoRoot) {
  const readmePath = path.join(repoRoot, 'etc/README.md');
  if (!fs.existsSync(readmePath)) return false;
  const text = fs.readFileSync(readmePath, 'utf8');
  return text.includes(LAYOUT_MARKER_START) && text.includes('config.toml');
}

export function inspectRepo(repoRoot) {
  const appId = path.basename(repoRoot);
  const topology = readTopology(repoRoot);
  const runtimeCode = runtimeCodeFromTopology(topology, repoRoot);
  const missing = [];
  const warnings = [];

  for (const artifact of REQUIRED_ARTIFACTS) {
    if (!fileExists(repoRoot, artifact)) missing.push(artifact);
  }

  for (const artifact of WEBSERVER_FILES) {
    if (!fileExists(repoRoot, artifact)) missing.push(artifact);
  }

  if (!readmeHasLayoutSection(repoRoot)) {
    missing.push('etc/README.md (deploy layout section)');
  }

  if (!fileExists(repoRoot, 'etc/examples/config.toml.example')) {
    missing.push('etc/examples/config.toml.example');
  }

  if (topology && !topology.applicationCode?.trim()) {
    missing.push('topology.applicationCode must be set');
  }

  if (topology?.schemaVersion !== 5) {
    missing.push(`topology.schemaVersion must be 5 (found ${topology?.schemaVersion ?? 'none'})`);
  }

  for (const debt of repoTopologyDebt(repoRoot)) {
    missing.push(debt);
  }

  if (topology?.profileRoot?.startsWith('configs/')) {
    missing.push(`topology.profileRoot uses retired configs/ (${topology.profileRoot})`);
  }

  if (fs.existsSync(path.join(repoRoot, 'configs/topology'))) {
    missing.push('retired configs/topology/ directory must be removed');
  }

  const legacyWebserverToml = path.join(repoRoot, 'deployments/webserver/server.toml');
  if (fs.existsSync(legacyWebserverToml)) {
    missing.push('retired deployments/webserver/server.toml must be removed (use layout v3 files)');
  }

  return {
    appId,
    runtimeCode,
    envPrefix: envPrefixFromCode(runtimeCode),
    configRoot: `/etc/sdkwork/${runtimeCode}/`,
    missing,
    warnings,
    ok: missing.length === 0,
  };
}

export function inspectWorkspace(workspaceRoot) {
  return { workspaceRoot, repos: [] };
}
