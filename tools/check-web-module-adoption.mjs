#!/usr/bin/env node
// Checks Web Module adoption across an SDKWork workspace (API_ASSEMBLY_SPEC §4.1.1).
//
// Pass 1 (module definitions): every served owner assembly crate
// `crates/sdkwork-api-*-assembly` must export the canonical module factory
// `web_module` (and `web_module_with_pool` when it exposes a pool-based
// contribution factory).
//
// Pass 2 (host integration): every standalone gateway crate
// (`crates/*standalone*`, name ends with `-standalone-gateway` or contains
// `standalone`) must install routes through `ApiModuleRegistry::add_module`.
//
// Usage:
//   node tools/check-web-module-adoption.mjs --workspace ..
//   node tools/check-web-module-adoption.mjs --workspace .. --strict
//   node tools/check-web-module-adoption.mjs --workspace .. --json

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: '.' },
    strict: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log('Usage: node tools/check-web-module-adoption.mjs --workspace <root> [--strict] [--json]');
  process.exit(0);
}

const workspace = path.resolve(values.workspace);
const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  'dist',
  '.git',
  '.workbuddy',
  '.sdkwork',
  'generated',
  'coverage',
]);

function collectSources(root) {
  const sources = [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return sources;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      sources.push(...collectSources(full));
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      sources.push(full);
    }
  }
  return sources;
}

function readSources(crateDir) {
  return collectSources(crateDir)
    .map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))
    .filter(({ text }) => text.trim().length > 0);
}

function isStandaloneCrate(name) {
  return /standalone/.test(name);
}

export function checkWorkspaceWebModuleAdoption(workspaceRoot) {
  const modules = [];
  const hosts = [];
  let repos;
  try {
    repos = fs
      .readdirSync(workspaceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !SKIP_DIRS.has(name) && fs.existsSync(path.join(workspaceRoot, name, 'crates')));
  } catch {
    return { modules, hosts };
  }

  for (const repo of repos.sort()) {
    const cratesRoot = path.join(workspaceRoot, repo, 'crates');
    let crateDirs;
    try {
      crateDirs = fs
        .readdirSync(cratesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const crate of crateDirs.sort()) {
      const crateDir = path.join(cratesRoot, crate);
      if (crate.startsWith('sdkwork-api-') && crate.endsWith('-assembly')) {
        const text = readSources(crateDir)
          .map(({ text }) => text)
          .join('\n');
        if (!text.trim()) continue;
        modules.push({
          repo,
          crate,
          hasWebModule: /pub (?:async )?fn web_module\b/.test(text),
          hasPoolModule: /pub (?:async )?fn web_module_with_pool\b/.test(text),
          exposesPoolEntry: /pub (?:async )?fn assemble_api_router_with_pool\b/.test(text),
        });
        continue;
      }
      if (isStandaloneCrate(crate)) {
        const text = readSources(crateDir)
          .map(({ text }) => text)
          .join('\n');
        if (!text.trim()) continue;
        // Only HTTP-serving standalones compose route modules; CLIs/workers
        // (agents, certificate workers, edge runtimes) do not.
        const servesRoutes =
          /ApiAssemblyContribution|ApiModuleRegistry|ComposedApiAssembly|assemble_/.test(text);
        if (!servesRoutes) continue;
        hosts.push({
          repo,
          crate,
          usesRegistry: /ApiModuleRegistry/.test(text) && /\.add_module/.test(text),
        });
      }
    }
  }
  return { modules, hosts };
}

const { modules, hosts } = checkWorkspaceWebModuleAdoption(workspace);
const moduleIssues = modules
  .filter((module) => !module.hasWebModule || (module.exposesPoolEntry && !module.hasPoolModule))
  .map((module) => `${module.repo}/${module.crate}: missing web_module (web_module_with_pool: ${module.hasPoolModule})`);
const hostIssues = hosts
  .filter((host) => !host.usesRegistry)
  .map((host) => `${host.repo}/${host.crate}: standalone route composition does not use ApiModuleRegistry::add_module`);
const issues = [...moduleIssues, ...hostIssues];

if (values.json) {
  console.log(
    JSON.stringify(
      {
        workspace,
        modules: {
          total: modules.length,
          aligned: modules.length - moduleIssues.length,
          pending: moduleIssues,
        },
        hosts: { total: hosts.length, aligned: hosts.length - hostIssues.length, pending: hostIssues },
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Web module adoption for ${workspace}`);
  console.log(`  module definitions: ${modules.length - moduleIssues.length}/${modules.length} aligned`);
  console.log(`  standalone hosts:   ${hosts.length - hostIssues.length}/${hosts.length} aligned`);
  for (const issue of issues.slice(0, 200)) console.log(`  - ${issue}`);
  if (issues.length > 200) console.log(`  … ${issues.length - 200} more`);
}

if (values.strict && issues.length > 0) {
  console.error(`Web module adoption check failed with ${issues.length} issue(s)`);
  process.exit(1);
}
if (!values.json) console.log('Web module adoption check passed');
