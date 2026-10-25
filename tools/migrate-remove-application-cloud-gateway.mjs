#!/usr/bin/env node
/**
 * Remove application-owned sdkwork-api-cloud-gateway metadata and config.
 * Authority: MIG-2026-0720-api-assembly-gateway-hosting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { checkApplicationCloudGatewayBoundary } from './check-application-cloud-gateway-boundary.mjs';
import { isApplicationCloudGatewayScript } from './lib/application-cloud-gateway.mjs';

const PLATFORM_GATEWAY = 'sdkwork-api-cloud-gateway';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function processUsesPlatformGateway(process) {
  return [process.id, process.name, process.crate, process.binary, process.repository]
    .some((value) => String(value ?? '').includes(PLATFORM_GATEWAY))
    || ['application-cloud-gateway', 'platform-gateway'].includes(process.role);
}

function collectGatewayBundleReferences(root) {
  const references = [];
  const extensions = new Set(['.json', '.md', '.mjs']);
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(filePath);
        continue;
      }
      if (!extensions.has(path.extname(entry.name))) continue;
      if (path.relative(root, filePath).replaceAll('\\', '/') === 'specs/topology.spec.json') continue;
      const text = fs.readFileSync(filePath, 'utf8');
      if (entry.name === 'gateway-cloud-bundle.mjs' || text.includes('gateway-cloud-bundle')) {
        references.push(path.relative(root, filePath).replaceAll('\\', '/'));
      }
    }
  }
  for (const relativeRoot of ['scripts', 'specs', 'tests']) walk(path.join(root, relativeRoot));
  return references.sort();
}

export function migrateApplicationCloudGateway(root, {
  dryRun = false,
  scriptsOnly = false,
  topologyOnly = false,
} = {}) {
  const resolved = path.resolve(root);
  if (path.basename(resolved) === PLATFORM_GATEWAY) {
    return { root: resolved, actions: [], skipped: true };
  }
  const actions = [];
  const topologyPath = path.join(resolved, 'specs', 'topology.spec.json');
  if (!scriptsOnly && fs.existsSync(topologyPath)) {
    const topology = readJson(topologyPath);
    if (topology.cloudIngress) {
      delete topology.cloudIngress;
      actions.push('remove specs/topology.spec.json cloudIngress');
    }
    if (topology.components?.cloudGateway) {
      delete topology.components.cloudGateway;
      actions.push('remove specs/topology.spec.json components.cloudGateway');
    }
    for (const key of ['cloudGatewayBind', 'cloudGatewayConfig', 'gatewayAutostart']) {
      if (topology.envKeys?.[key]) {
        delete topology.envKeys[key];
        actions.push(`remove specs/topology.spec.json envKeys.${key}`);
      }
    }
    const platformSurface = topology.surfaces?.['platform.api-gateway'];
    for (const key of ['owner', 'bindEnv', 'autostartEnv']) {
      if (platformSurface?.[key]) {
        delete platformSurface[key];
        actions.push(`remove platform.api-gateway.${key}`);
      }
    }
    for (const [profileId, profile] of Object.entries(topology.orchestration?.profiles ?? {})) {
      const before = profile.processes ?? [];
      const after = before.filter((process) => !processUsesPlatformGateway(process));
      if (after.length !== before.length) {
        profile.processes = after;
        actions.push(`remove ${profileId} platform cloud gateway process`);
      }
    }
    if (Array.isArray(topology.packaging?.cloudConfigFiles)) {
      const before = topology.packaging.cloudConfigFiles;
      topology.packaging.cloudConfigFiles = before.filter((file) => !String(file).includes(PLATFORM_GATEWAY));
      if (topology.packaging.cloudConfigFiles.length !== before.length) {
        actions.push('remove packaging.cloudConfigFiles platform gateway entries');
      }
    }
    if (topology.scripts?.gatewayCloudBundle) {
      delete topology.scripts.gatewayCloudBundle;
      actions.push('remove specs/topology.spec.json scripts.gatewayCloudBundle');
    }
    if (!dryRun && actions.length > 0) writeJson(topologyPath, topology);
  }

  const packagePath = path.join(resolved, 'package.json');
  if (!topologyOnly && fs.existsSync(packagePath)) {
    const pkg = readJson(packagePath);
    let changed = false;
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      if (isApplicationCloudGatewayScript(name)) {
        delete pkg.scripts[name];
        actions.push(`remove package.json script ${name}`);
        changed = true;
      } else if (!scriptsOnly && (
        String(command).includes(PLATFORM_GATEWAY)
        || String(command).includes('gateway-cloud-bundle.mjs')
      )) {
        actions.push(`manual repair required for package.json script ${name}`);
      }
    }
    if (!dryRun && changed) writeJson(packagePath, pkg);
  }

  if (!topologyOnly && !scriptsOnly) {
    for (const relativePath of collectGatewayBundleReferences(resolved)) {
      actions.push(`manual repair required for ${relativePath}`);
    }
    const boundary = checkApplicationCloudGatewayBoundary(resolved);
    const scheduledConfigPattern = /^etc\/sdkwork-api-cloud-gateway\..+\.toml$/u;
    for (const relativePath of [...new Set(boundary.findings.map((finding) => finding.file))].sort()) {
      if (relativePath === 'package.json'
        || relativePath === 'specs/topology.spec.json'
        || scheduledConfigPattern.test(relativePath)) {
        continue;
      }
      actions.push(`manual repair required for ${relativePath}`);
    }
  }

  const etcRoot = path.join(resolved, 'etc');
  if (!topologyOnly && !scriptsOnly && fs.existsSync(etcRoot)) {
    for (const entry of fs.readdirSync(etcRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(`${PLATFORM_GATEWAY}.`) || !entry.name.endsWith('.toml')) continue;
      actions.push(`remove etc/${entry.name}`);
      if (!dryRun) fs.rmSync(path.join(etcRoot, entry.name));
    }
  }

  return { root: resolved, actions: [...new Set(actions)] };
}

function rootsFromArgs(values) {
  if (values.root) return [path.resolve(values.root)];
  const workspace = path.resolve(values.workspace);
  return fs.readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => path.join(workspace, entry.name))
    .filter((root) => fs.existsSync(path.join(root, 'agent.app.config.json')))
    .filter((root) => path.basename(root) !== PLATFORM_GATEWAY)
    .filter((root) => !values.repo || path.basename(root) === values.repo);
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      workspace: { type: 'string' },
      repo: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'scripts-only': { type: 'boolean', default: false },
      'topology-only': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || Boolean(values.root) === Boolean(values.workspace)) {
    console.log('Usage: node tools/migrate-remove-application-cloud-gateway.mjs (--root <app> | --workspace <workspace> [--repo <name>]) [--dry-run] [--scripts-only|--topology-only]');
    if (!values.help) process.exitCode = 2;
    return;
  }
  for (const root of rootsFromArgs(values)) {
    const result = migrateApplicationCloudGateway(root, {
      dryRun: values['dry-run'],
      scriptsOnly: values['scripts-only'],
      topologyOnly: values['topology-only'],
    });
    for (const action of result.actions) console.log(`${path.basename(root)}: ${action}`);
  }
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) main();
