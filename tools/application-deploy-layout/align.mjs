import fs from 'node:fs';
import path from 'node:path';

import { discoverRepos, readTopology, runtimeCodeFromTopology } from './discover.mjs';
import { inspectRepo } from './inspect.mjs';
import {
  PROFILE_IDS,
  renderMinimalAppConfig,
  renderMinimalDeploymentIndex,
  renderMinimalProfileEnv,
  renderMinimalTopology,
} from './bootstrap.mjs';
import {
  renderConfigTomlExample,
  renderDeployYaml,
  renderDisabledWebserverCommon,
  renderLayoutReadmeSection,
  renderWebserverProfile,
  upsertLayoutSection,
} from './render.mjs';

function writeIfMissing(targetPath, content, dryRun) {
  if (fs.existsSync(targetPath)) return false;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
  }
  return true;
}

function bootstrapCoreArtifacts(repoRoot, appId, runtimeCode, dryRun) {
  const written = [];
  const appConfigPath = path.join(repoRoot, 'sdkwork.app.config.json');
  if (writeIfMissing(appConfigPath, renderMinimalAppConfig(appId, runtimeCode), dryRun)) {
    written.push('sdkwork.app.config.json');
  }

  const topologyPath = path.join(repoRoot, 'specs/topology.spec.json');
  if (writeIfMissing(topologyPath, `${JSON.stringify(renderMinimalTopology(appId, runtimeCode), null, 2)}\n`, dryRun)) {
    written.push('specs/topology.spec.json');
  }

  const deploymentIndexPath = path.join(repoRoot, 'etc/sdkwork.deployment.config.json');
  if (!fs.existsSync(deploymentIndexPath)) {
    if (writeIfMissing(deploymentIndexPath, renderMinimalDeploymentIndex(appId), dryRun)) {
      written.push('etc/sdkwork.deployment.config.json');
    }
  }

  for (const profileId of PROFILE_IDS) {
    const envPath = path.join(repoRoot, 'etc/topology', `${profileId}.env`);
    if (writeIfMissing(envPath, renderMinimalProfileEnv(profileId, runtimeCode), dryRun)) {
      written.push(`etc/topology/${profileId}.env`);
    }
  }

  return written;
}

function writeOrUpdateReadme(repoRoot, section, dryRun) {
  const readmePath = path.join(repoRoot, 'etc/README.md');
  const existing = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
  const appId = path.basename(repoRoot);
  const header = existing ? existing : `# ${appId} Source Configuration\n\n`;
  const next = upsertLayoutSection(header, section, `${appId} Source Configuration`);
  if (next === existing) return false;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(readmePath), { recursive: true });
    fs.writeFileSync(readmePath, next, 'utf8');
  }
  return true;
}

export function alignRepo(repoRoot, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const bootstrap = options.bootstrap !== false;
  const appId = path.basename(repoRoot);
  let runtimeCode = runtimeCodeFromTopology(readTopology(repoRoot), repoRoot);
  const written = [];

  if (bootstrap) {
    written.push(...bootstrapCoreArtifacts(repoRoot, appId, runtimeCode, dryRun));
  }

  const topology = readTopology(repoRoot);
  runtimeCode = runtimeCodeFromTopology(topology, repoRoot);
  const before = inspectRepo(repoRoot);

  if (writeOrUpdateReadme(
    repoRoot,
    renderLayoutReadmeSection({ appId, runtimeCode }),
    dryRun,
  )) {
    written.push('etc/README.md');
  }

  const examplePath = path.join(repoRoot, 'etc/examples/config.toml.example');
  if (writeIfMissing(examplePath, renderConfigTomlExample({ runtimeCode, appId }), dryRun)) {
    written.push('etc/examples/config.toml.example');
  }

  const deployPath = path.join(repoRoot, 'deployments/deploy.yaml');
  if (topology && writeIfMissing(deployPath, renderDeployYaml({ topology, appId }), dryRun)) {
    written.push('deployments/deploy.yaml');
  }

  const webserverDir = path.join(repoRoot, 'deployments/webserver');
  const commonPath = path.join(webserverDir, 'server.common.toml');
  if (writeIfMissing(commonPath, renderDisabledWebserverCommon({ runtimeCode, appId }), dryRun)) {
    written.push('deployments/webserver/server.common.toml');
  }
  const standalonePath = path.join(webserverDir, 'server.standalone.toml');
  if (writeIfMissing(standalonePath, renderWebserverProfile('standalone'), dryRun)) {
    written.push('deployments/webserver/server.standalone.toml');
  }
  const cloudPath = path.join(webserverDir, 'server.cloud.toml');
  if (writeIfMissing(cloudPath, renderWebserverProfile('cloud'), dryRun)) {
    written.push('deployments/webserver/server.cloud.toml');
  }

  const after = inspectRepo(repoRoot);
  return { appId, runtimeCode, written, before, after };
}

export function alignWorkspace(workspaceRoot, options = {}) {
  const repos = discoverRepos(workspaceRoot);
  return repos.map((repoRoot) => alignRepo(repoRoot, options));
}
