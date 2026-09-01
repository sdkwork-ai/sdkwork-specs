#!/usr/bin/env node

/**
 * Ensure region deployment keys across every sdkwork-space application that
 * declares a v5 topology spec.
 *
 * For each application root (directories named sdkwork-* under the workspace
 * root) with a `specs/topology.spec.json`, this tool injects the region
 * deployment dimension into every profile env file (`etc/topology/` or
 * `configs/topology/`):
 *
 *   SDKWORK_<APPLICATION_CODE>_REGION_CODE=global
 *   SDKWORK_DATABASE_SEED_LOCALE=zh-CN
 *
 * The region is orthogonal to the deployment profile (REGION_SPEC.md): the
 * profile file keeps the default `global` and deployments override it through
 * an explicit region layer. Existing keys are left untouched (idempotent).
 *
 * Usage:
 *   node tools/ensure-region-keys.mjs [--workspace <root>] [--dry-run] [--root <repo>...]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');

function parseArgs(argv) {
  const settings = {
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
    dryRun: false,
    roots: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      settings.workspaceRoot = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--dry-run') {
      settings.dryRun = true;
    } else if (arg === '--root') {
      settings.roots.push(path.resolve(argv[index + 1]));
      index += 1;
    }
  }
  return settings;
}

function applicationCode(spec) {
  return String(spec?.applicationCode ?? spec?.appId ?? 'APP').toUpperCase();
}

// Env variable names must not contain hyphens (ENVIRONMENT_SPEC naming), so
// application codes such as `api-gateway` normalize to `API_GATEWAY` for the
// `SDKWORK_<APPLICATION_CODE>_REGION_CODE` key.
function envKeyCode(applicationCode) {
  return applicationCode.replaceAll('-', '_');
}

function regionKeys(applicationCode) {
  return [
    `SDKWORK_${envKeyCode(applicationCode)}_REGION_CODE=global`,
    'SDKWORK_DATABASE_SEED_LOCALE=zh-CN',
  ];
}

function profileRootsFor(repoRoot) {
  const candidates = ['etc/topology', 'configs/topology'];
  return candidates
    .map((relative) => path.join(repoRoot, relative))
    .filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
}

// Any valid `SDKWORK_*_REGION_CODE=` line counts as the region dimension
// (applications may declare an application-specific key such as
// `SDKWORK_CLOUDROUTER_ROUTER_REGION_CODE`), so the injector never duplicates
// an existing region declaration.
function hasRegionKey(lines) {
  return lines.some((line) => /^SDKWORK_[A-Z0-9_]+_REGION_CODE=/.test(line));
}

function injectRegionKeys(envFilePath, keys, dryRun) {
  let content = fs.readFileSync(envFilePath, 'utf8');
  const lines = content.split('\n');
  const missing = keys.filter((key) => {
    const name = key.split('=')[0];
    if (name.endsWith('_REGION_CODE')) {
      return !hasRegionKey(lines);
    }
    return !lines.some((line) => line.startsWith(name));
  });
  if (missing.length === 0) {
    return 0;
  }
  const block = [
    '',
    '# Region deployment dimension (REGION_SPEC.md): orthogonal to deployment profile and environment.',
    ...keys,
    '',
  ].join('\n');
  // Insert after the identity header block (first blank line).
  let insertAt = lines.length;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '') {
      insertAt = index + 1;
      break;
    }
  }
  // Drop stale hyphenated region keys (`SDKWORK_API-GATEWAY_REGION_CODE`) so a
  // repaired file keeps exactly one valid env-var region key.
  const cleaned = lines.filter(
    (line) => !/^SDKWORK_[A-Za-z0-9-]+_REGION_CODE=/.test(line) || /^SDKWORK_[A-Z0-9_]+_REGION_CODE=/.test(line),
  );
  cleaned.splice(insertAt, 0, block);
  const updated = cleaned.join('\n');
  if (!dryRun) {
    fs.writeFileSync(envFilePath, updated);
  }
  return missing.length;
}

function findTopologyApplications(workspaceRoot) {
  if (!fs.existsSync(workspaceRoot)) return [];
  return fs
    .readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((repoRoot) =>
      fs.existsSync(path.join(repoRoot, 'specs', 'topology.spec.json')),
    );
}

function main() {
  const settings = parseArgs(process.argv.slice(2));
  const roots = settings.roots.length > 0
    ? settings.roots
    : findTopologyApplications(settings.workspaceRoot);
  const summary = { applications: 0, envFiles: 0, injectedKeys: 0, dryRun: settings.dryRun };
  for (const repoRoot of roots) {
    const specPath = path.join(repoRoot, 'specs', 'topology.spec.json');
    if (!fs.existsSync(specPath)) {
      console.log(`[skip] no topology spec: ${path.basename(repoRoot)}`);
      continue;
    }
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const code = applicationCode(spec);
    const keys = regionKeys(code);
    const profileRoots = profileRootsFor(repoRoot);
    if (profileRoots.length === 0) {
      console.log(`[warn] no profile env dir: ${path.basename(repoRoot)}`);
      continue;
    }
    summary.applications += 1;
    for (const dir of profileRoots) {
      for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.env'))) {
        const envFilePath = path.join(dir, file);
        const injected = injectRegionKeys(envFilePath, keys, settings.dryRun);
        summary.envFiles += 1;
        summary.injectedKeys += injected;
        if (injected > 0) {
          console.log(
            `[${settings.dryRun ? 'plan' : 'updated'}] ${path.basename(repoRoot)}/${path.basename(dir)}/${file} +${injected} region keys`,
          );
        }
      }
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}

main();
