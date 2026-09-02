#!/usr/bin/env node
// Aligns declarative owner entrypoints with the module-factory contract
// (API_ASSEMBLY_SPEC §4.1.1): `executableExport` / requiredPorts exports must
// name a `web_module*` factory, not a legacy `assemble_*` factory.
//
// The repair is gate-driven, never name-guessed: it runs the integration-closure
// gate, collects only the entrypoints that gate actually rejected, and rewrites
// each one to the `web_module*` factory the gateway source really calls. Owners
// that expose zero or several `web_module*` factories are reported, not guessed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { validateApiAssemblyIntegrationClosure } from './lib/api-assembly-integration-closure.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: 'E:\\sdkwork-space' },
    apply: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log('Usage: node tools/repair-component-executable-exports.mjs [--workspace <root>] [--apply]');
  process.exit(0);
}

const WORKSPACE = path.resolve(values.workspace);
const APPLY = values.apply;

const GATEWAY_ISSUE = /gateway source must call declared owner entrypoint (\S+)$/;
const FACTORY_CALL = /\b([a-z][a-z0-9_]*_assembly)::([a-z_][a-z0-9_]*)/g;

function listRustFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'target' || entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listRustFiles(full, out);
    else if (entry.name.endsWith('.rs')) out.push(full);
  }
  return out;
}

function collectFactoryCalls(root) {
  const calls = new Map();
  for (const file of listRustFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(FACTORY_CALL)) {
      if (!calls.has(match[1])) calls.set(match[1], new Set());
      calls.get(match[1]).add(match[2]);
    }
  }
  return calls;
}

function resolveModuleFactory(factories) {
  const matches = [...factories].filter((name) => name.startsWith('web_module'));
  if (matches.length === 0) return { error: 'owner exposes no web_module* factory' };
  if (matches.length > 1) return { error: `owner exposes multiple web_module* factories (${matches.join(', ')})` };
  return { factory: matches[0] };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  const text = JSON.stringify(value, null, 2);
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

// Every repository that owns a `crates/` tree is a candidate; the closure gate
// is what decides which ones actually carry stale declarations.
function listRepos() {
  return fs.readdirSync(WORKSPACE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => path.join(WORKSPACE, entry.name))
    .filter((root) => fs.existsSync(path.join(root, 'crates')));
}

const applied = [];
const unresolved = [];

for (const repoRoot of listRepos()) {
  let issues = [];
  try {
    issues = validateApiAssemblyIntegrationClosure(repoRoot, {});
  } catch (error) {
    unresolved.push(`${path.relative(WORKSPACE, repoRoot)}: closure gate failed (${error.message})`);
    continue;
  }

  const stale = new Set();
  for (const issue of issues) {
    const match = GATEWAY_ISSUE.exec(issue);
    if (match) stale.add(match[1]);
  }
  if (stale.size === 0) continue;

  const calls = collectFactoryCalls(path.join(repoRoot, 'crates'));
  const replacement = new Map();
  for (const exportName of stale) {
    const separator = exportName.indexOf('::');
    if (separator <= 0) {
      unresolved.push(`${exportName}: not a crate::factory entrypoint`);
      continue;
    }
    const crate = exportName.slice(0, separator);
    const factories = calls.get(crate);
    if (!factories) {
      unresolved.push(`${exportName}: no source call evidence for ${crate}`);
      continue;
    }
    const resolved = resolveModuleFactory(factories);
    if (resolved.error) {
      unresolved.push(`${exportName}: ${resolved.error}`);
      continue;
    }
    replacement.set(exportName, `${crate}::${resolved.factory}`);
  }
  if (replacement.size === 0) continue;

  const specPath = path.join(repoRoot, 'specs', 'component.spec.json');
  if (!fs.existsSync(specPath)) {
    unresolved.push(`${path.relative(WORKSPACE, repoRoot)}: no root component.spec.json to repair`);
    continue;
  }
  const spec = readJson(specPath);
  let dirty = false;
  for (const row of spec?.dependencies ?? []) {
    if (!row || typeof row !== 'object') continue;
    const next = replacement.get(row.executableExport);
    if (!next) continue;
    applied.push(`${path.relative(WORKSPACE, specPath)}: ${row.executableExport} -> ${next}`);
    row.executableExport = next;
    dirty = true;
  }
  if (dirty && APPLY) writeJson(specPath, spec);
}

console.log(`Owner entrypoint repair for ${WORKSPACE}`);
console.log(`  rewritten: ${applied.length}`);
for (const line of applied) console.log(`    ${line}`);
if (unresolved.length > 0) {
  console.log(`  unresolved: ${unresolved.length}`);
  for (const line of unresolved) console.log(`    ${line}`);
}
console.log(APPLY ? 'Applied.' : 'Dry run — re-run with --apply to write.');
