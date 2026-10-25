#!/usr/bin/env node
/**
 * Bootstrap one application root onto the canonical API assembly contract:
 * - deterministic assembly source and manifest
 * - Cargo workspace membership
 * - direct package.json api:assembly:* tool delegation
 * - immediate read-only validation
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  assemblyCrateDir,
  discoverRouteCrates,
  ensureCargoWorkspaceMember,
  readText,
  resolveApplicationCode,
} from './api-assembly-lib.mjs';
import { materializeApiAssembly } from './materialize-api-assembly.mjs';
import { validateApiAssembly } from './validate-api-assembly.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function relativeToolCommand(root, specsRoot, toolName) {
  const toolPath = path.join(specsRoot, 'tools', toolName);
  const relative = path.relative(root, toolPath).replaceAll('\\', '/');
  if (path.isAbsolute(relative)) {
    throw new Error('application root and sdkwork-specs must share a portable workspace-relative path');
  }
  const commandPath = relative.startsWith('.') ? relative : `./${relative}`;
  return `node ${commandPath} --root .`;
}

function ensurePackageScripts(root, specsRoot) {
  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return false;
  }
  const pkg = JSON.parse(readText(packagePath).replace(/^\uFEFF/u, ''));
  pkg.scripts ??= {};
  let changed = false;
  const materializeCommand = relativeToolCommand(root, specsRoot, 'materialize-api-assembly.mjs');
  const validateCommand = relativeToolCommand(root, specsRoot, 'validate-api-assembly.mjs');
  if (pkg.scripts['api:assembly:materialize'] !== materializeCommand) {
    pkg.scripts['api:assembly:materialize'] = materializeCommand;
    changed = true;
  }
  if (pkg.scripts['api:assembly:validate'] !== validateCommand) {
    pkg.scripts['api:assembly:validate'] = validateCommand;
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  }
  return changed;
}

export function bootstrapApiAssemblyRepo(root, { specsRoot = SPECS_ROOT } = {}) {
  const resolved = path.resolve(root);
  if (path.basename(resolved) === 'sdkwork-api-cloud-gateway') {
    return { ok: true, skipped: true, applicationCode: null, reason: 'platform-cloud-gateway' };
  }
  let applicationCode;
  try {
    applicationCode = resolveApplicationCode(root);
  } catch (error) {
    return { ok: false, applicationCode: null, errors: [error.message], warnings: [] };
  }
  const routeCrates = discoverRouteCrates(root, applicationCode);
  const isApplicationRoot = fs.existsSync(path.join(root, 'agent.app.config.json'));
  if (!isApplicationRoot && routeCrates.length === 0) {
    return { ok: true, skipped: true, applicationCode, reason: 'not-application-root' };
  }

  const materialized = materializeApiAssembly(root);
  if (!materialized.ok) {
    return { ...materialized, routeCrates: routeCrates.length };
  }
  const workspaceMemberAdded = ensureCargoWorkspaceMember(
    root,
    assemblyCrateDir(applicationCode),
  );
  const packageScriptsAdded = ensurePackageScripts(root, path.resolve(specsRoot));
  const validation = validateApiAssembly(root);

  return {
    ok: validation.ok,
    applicationCode,
    routeCrates: routeCrates.length,
    apiMode: routeCrates.length === 0 ? 'none' : 'served',
    crateDir: materialized.crateDir,
    workspaceMemberAdded,
    packageScriptsAdded,
    errors: validation.errors ?? [],
    warnings: validation.warnings ?? [],
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || !values.root) {
    console.log('Usage: node tools/bootstrap-api-assembly-repo.mjs --root <application>');
    if (!values.help) process.exitCode = 2;
    return;
  }

  const root = path.resolve(values.root);
  const result = bootstrapApiAssemblyRepo(root);
  if (result.skipped) {
    console.log(`bootstrap-api-assembly skipped for ${path.basename(root)} (${result.reason})`);
    process.exit(0);
  }
  if (!result.ok) {
    for (const error of result.errors ?? [result.message]) {
      console.error(`error: ${error}`);
    }
    process.exit(1);
  }
  console.log(
    `bootstrap-api-assembly ${path.basename(root)}: mode=${result.apiMode} routes=${result.routeCrates} member=${result.workspaceMemberAdded} package=${result.packageScriptsAdded}`,
  );
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  main();
}
