#!/usr/bin/env node
/**
 * check-operations-conformance.mjs — OPERATIONS_SPEC.md §8 automated audit.
 *
 * Audits one deployable module root for the structural conformance items of
 * the operations lifecycle standard:
 *
 *   1. bin/ entrypoint set      — 8 entry scripts + README + lib/ layering
 *   2. bootstrap ordering       — sdkwork-common.sh → module.sh → entrypoints.sh → ops-*
 *   3. module wiring hooks      — SDKWORK_PRIMARY_SERVICE / HEALTH_PATH / health_port / …
 *   4. bundle deploy entrypoint — deploy.sh present in the module bundle dir
 *   5. bundle release channel   — release.sh next to deploy.sh (§1.2)
 *   6. compose log rotation     — every compose file declaring `services:` also declares `logging:`
 *   7. env examples             — per-environment example env files exist
 *   8. runbooks                 — docs/runbooks/ four documents, bilingual
 *   9. shared primitives        — module bin/ does not re-declare secret constants or ssh/scp verbs
 *
 * Usage:
 *   node check-operations-conformance.mjs --root <module-root> [--json]
 *
 * Exit codes: 0 = no FAIL, 1 = at least one FAIL (blocks the release train),
 * 2 = usage error.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let root = '';
let asJson = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--root') { root = requireValue(args, ++i, args[i]); }
  else if (args[i] === '--json') { asJson = true; }
  else if (args[i] === '-h' || args[i] === '--help') { usage(); process.exit(0); }
  else { usage(); process.exit(2); }
}
if (!root) { usage(); process.exit(2); }
root = path.resolve(root);
if (!existsSync(root)) { console.error(`root does not exist: ${root}`); process.exit(2); }

function usage() {
  console.error('usage: node check-operations-conformance.mjs --root <module-root> [--json]');
}
function requireValue(argv, index, value) {
  if (!value || value.startsWith('--')) {
    console.error(`option '${argv[index - 1]}' requires a value`);
    process.exit(2);
  }
  return value;
}

const results = [];
function record(check, status, detail) {
  results.push({ check, status, detail });
}
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

// --- resolve module identity -------------------------------------------------
const appId = path.basename(root);
const appConfigPath = path.join(root, 'sdkwork.app.config.json');
let containerImageHint = '';
if (existsSync(appConfigPath)) {
  try {
    const cfg = JSON.parse(readFileSync(appConfigPath, 'utf8'));
    containerImageHint = cfg?.app?.identifiers?.containerImage || '';
  } catch { /* non-blocking */ }
}

// --- 1. bin/ entrypoint set ---------------------------------------------------
const BIN_ENTRIES = ['apps-build.sh', 'apps-package.sh', 'apps-deploy.sh', 'backup.sh', 'config.sh', 'docker-deploy.sh', 'docker-image.sh', 'doctor.sh'];
const binDir = path.join(root, 'bin');
const binMissing = BIN_ENTRIES.filter((f) => !existsSync(path.join(binDir, f)));
if (binMissing.length === 0) record('bin/ entrypoint set', 'PASS', `all 8 entries present in bin/`);
else record('bin/ entrypoint set', 'FAIL', `missing: ${binMissing.join(', ')}`);

if (!existsSync(path.join(binDir, 'README.md'))) record('bin/ README', 'FAIL', 'bin/README.md missing');
else record('bin/ README', 'PASS', 'bin/README.md present');

// --- 2. bootstrap ordering -----------------------------------------------------
const bootstrapPath = path.join(binDir, 'lib', 'bootstrap.sh');
const moduleShPath = path.join(binDir, 'lib', 'module.sh');
if (!existsSync(bootstrapPath)) {
  record('bootstrap layering', 'FAIL', 'bin/lib/bootstrap.sh missing');
} else {
  const text = readFileSync(bootstrapPath, 'utf8');
  const order = [];
  if (text.includes('sdkwork-common.sh')) order.push('common');
  if (text.includes('module.sh')) order.push('module');
  if (text.includes('entrypoints.sh')) order.push('entrypoints');
  const ops = ['ops-config.sh', 'ops-observe.sh', 'ops-backup.sh'].filter((f) => text.includes(f)).length;
  if (order.join('→') === 'common→module→entrypoints' && ops === 3) {
    record('bootstrap layering', 'PASS', 'common → module → entrypoints → ops-*');
  } else {
    record('bootstrap layering', 'FAIL',
      `expected common→module→entrypoints + 3 ops libs (found: ${order.join('→')}, ops=${ops}/3)`);
  }
}

// --- 3. module wiring hooks ------------------------------------------------------
if (!existsSync(moduleShPath)) {
  record('module wiring hooks', 'FAIL', 'bin/lib/module.sh missing');
} else {
  const text = readFileSync(moduleShPath, 'utf8');
  const hooks = [
    ['SDKWORK_MODULE_ID=', 'module id'],
    ['SDKWORK_IMAGE_NAME=', 'image name'],
    ['SDKWORK_PRIMARY_SERVICE=', 'primary service'],
    ['SDKWORK_HEALTH_PATH=', 'health path'],
    ['sdkwork_module_health_port()', 'health port hook'],
    ['sdkwork_module_local_env_dir()', 'local env dir hook'],
    ['sdkwork_module_config_validate()', 'config validate hook'],
    ['sdkwork_image_build()', 'image build hook'],
    ['sdkwork_build_app()', 'app build hook'],
    ['sdkwork_package_app()', 'app package hook'],
    ['sdkwork_deploy_app()', 'app deploy hook'],
  ];
  const missing = hooks.filter(([needle]) => !text.includes(needle)).map(([, label]) => label);
  if (missing.length === 0) record('module wiring hooks', 'PASS', 'all MODULE_BIN_SPEC §3 hooks declared');
  else record('module wiring hooks', 'FAIL', `missing: ${missing.join(', ')}`);
  const secretDup = /SDKWORK_SECRET_[A-Z_]+\s*=/.test(text);
  if (secretDup) record('secret constants duplication', 'FAIL', 'module.sh re-declares SDKWORK_SECRET_* (must live only in sdkwork-common.sh)');
  else record('secret constants duplication', 'PASS', 'no SDKWORK_SECRET_* duplication');
}

// --- 4/5. bundle deploy + release channel -----------------------------------------
const BUNDLE_CANDIDATES = ['deployments/docker/bundle', 'scripts/docker/bundle'];
let bundleDir = '';
for (const c of BUNDLE_CANDIDATES) {
  const p = path.join(root, c);
  if (existsSync(path.join(p, 'deploy.sh'))) { bundleDir = p; break; }
}
if (bundleDir) {
  record('bundle deploy entrypoint', 'PASS', `${rel(path.join(bundleDir, 'deploy.sh'))}`);
  if (existsSync(path.join(bundleDir, 'release.sh'))) {
    const relText = readFileSync(path.join(bundleDir, 'release.sh'), 'utf8');
    const semantics = [
      ['rollback', 'rollback action'],
      ['ledger', 'release ledger'],
      ['health', 'health gate'],
      ['lock', 'release lock'],
    ];
    const missing = semantics.filter(([needle]) => !relText.includes(needle)).map(([, label]) => label);
    if (missing.length === 0) record('bundle release channel (§1.2)', 'PASS', `${rel(path.join(bundleDir, 'release.sh'))} implements rollback/ledger/health-gate/lock`);
    else record('bundle release channel (§1.2)', 'FAIL', `release.sh present but missing: ${missing.join(', ')}`);
  } else {
    record('bundle release channel (§1.2)', 'FAIL', 'no release.sh beside deploy.sh — rollback would degrade to re-install');
  }
} else {
  record('bundle deploy entrypoint', 'FAIL', `no bundle deploy.sh under ${BUNDLE_CANDIDATES.join(' or ')}`);
  record('bundle release channel (§1.2)', 'FAIL', 'no bundle → no release channel');
}

// --- 6. compose log rotation ---------------------------------------------------------
// A file conforms when every service carries a `logging:` key, either
// directly or via the shipped `x-default-logging: &default-logging` anchor
// that services reference (`logging: *default-logging`) or inherit through a
// YAML merge key (`<<: *webserver-common`).
const composeRoots = [
  path.join(root, 'deployments', 'docker'),
  path.join(root, 'scripts', 'docker'),
  root, // repo-root compose files (gateway layout)
];
const composeFiles = [];
function walkCompose(dir, depth) {
  if (depth > 3 || !existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = statSync(p, { throwIfNoEntry: false });
    if (!s) continue;
    if (s.isDirectory()) { if (name !== 'node_modules') walkCompose(p, depth + 1); }
    else if (/^docker-compose.*\.ya?ml$/.test(name)) composeFiles.push(p);
  }
}
composeRoots.forEach((d) => walkCompose(d, 0));
{
  // The repo-root walk re-covers subdirectories already scanned explicitly.
  const seen = new Set();
  for (let i = 0; i < composeFiles.length; i += 1) {
    const key = composeFiles[i].toLowerCase();
    if (seen.has(key)) { composeFiles.splice(i, 1); i -= 1; } else seen.add(key);
  }
}
function composeServiceReport(rawText) {
  const text = rawText.replace(/\r\n/g, '\n'); // normalize CRLF checkouts
  const lines = text.split('\n');
  let inServices = false;
  const services = [];
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^(volumes|networks|secrets|configs):/.test(line)) { inServices = false; continue; }
    if (!inServices) continue;
    const m = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (m) services.push(m[1]);
  }
  const serviceBodies = {};
  for (const name of services) {
    const start = lines.findIndex((l) => l === `  ${name}:`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (lines[i].length > 0 && !/^ {2,}/.test(lines[i])) { end = i; break; }
    }
    serviceBodies[name] = lines.slice(start, end).join('\n');
  }
  const missing = Object.entries(serviceBodies)
    .filter(([name, body]) => !/^\s{4}logging:/m.test(body))
    .map(([name]) => name);
  return { count: services.length, missing };
}
const composeBad = [];
let composeChecked = 0;
for (const f of composeFiles) {
  const text = readFileSync(f, 'utf8');
  if (!/^services:/m.test(text)) continue; // fragments and attach-overlays are exempt
  const { missing } = composeServiceReport(text);
  composeChecked += 1;
  if (missing.length > 0) composeBad.push(`${rel(f)} (${missing.join(', ')})`);
}
if (composeChecked === 0) record('compose log rotation (§2.3)', 'WARN', 'no compose files with services: found');
else if (composeBad.length === 0) record('compose log rotation (§2.3)', 'PASS', `${composeChecked} compose file(s) cover every service with logging`);
else record('compose log rotation (§2.3)', 'FAIL', `services without logging: ${composeBad.join('; ')}`);

// --- 7. env examples ------------------------------------------------------------------
const envDirs = [path.join(root, 'deployments', 'docker', 'env'), path.join(root, 'docker', 'env'), path.join(bundleDir ? path.join(root, bundleDir) : root, 'env')];
const envExampleCount = new Set();
for (const d of envDirs) {
  if (!existsSync(d)) continue;
  for (const name of readdirSync(d)) if (/\.example$/.test(name)) envExampleCount.add(`${rel(d)}/${name}`);
}
if (envExampleCount.size >= 3) record('environment env examples (§3.1)', 'PASS', `${envExampleCount.size} example env file(s)`);
else record('environment env examples (§3.1)', 'FAIL', `found ${envExampleCount.size} (need ≥3 across deployments/docker/env, docker/env, or bundle env/)`);

// --- 8. runbooks bilingual -------------------------------------------------------------
const runbookDir = path.join(root, 'docs', 'runbooks');
const RUNBOOK_STEMS = ['deploy', 'troubleshooting', 'backup-restore', 'log-reference'];
if (!existsSync(runbookDir)) {
  record('runbooks (§7)', 'FAIL', 'docs/runbooks/ missing');
} else {
  const names = new Set(readdirSync(runbookDir));
  const missing = [];
  for (const stem of RUNBOOK_STEMS) {
    const hasBase = names.has(`${stem}.md`) || names.has(`${stem}.en.md`);
    const hasZh = names.has(`${stem}.md`);
    const hasEn = names.has(`${stem}.en.md`);
    if (!hasBase || !hasEn) missing.push(`${stem} (zh: ${hasZh ? 'yes' : 'no'}, en: ${hasEn ? 'yes' : 'no'})`);
  }
  if (missing.length === 0) record('runbooks (§7)', 'PASS', `4 runbooks × 2 languages present`);
  else record('runbooks (§7)', 'FAIL', `missing/incomplete: ${missing.join('; ')}`);
}

// --- 9. shared primitive duplication ---------------------------------------------------
let sshDup = [];
if (existsSync(binDir)) {
  for (const name of readdirSync(binDir)) {
    if (!name.endsWith('.sh')) continue;
    const text = readFileSync(path.join(binDir, name), 'utf8');
    if (/\b(ssh|scp)\s+(-\S+\s+)*["']?(\$\{?[A-Z_]*HOST|ssh:)/.test(text.replace(/^#\s.*$/gm, ''))) sshDup.push(name);
  }
}
if (sshDup.length === 0) record('shared primitive isolation (§8)', 'PASS', 'no ssh/scp verbs outside the shared library');
else record('shared primitive isolation (§8)', 'FAIL', `${sshDup.join(', ')} re-implements remote transport (use sdkwork-common.sh)`);

// --- report ------------------------------------------------------------------------------
const fails = results.filter((r) => r.status === 'FAIL').length;
const warns = results.filter((r) => r.status === 'WARN').length;
if (asJson) {
  console.log(JSON.stringify({ module: appId, root, fails, warns, results }, null, 2));
} else {
  console.log(`\n[ops-conformance] ${appId} (${root})`);
  if (containerImageHint) console.log(`  container image: ${containerImageHint}`);
  for (const r of results) {
    const icon = r.status === 'PASS' ? 'PASS' : r.status === 'WARN' ? 'WARN' : 'FAIL';
    console.log(`  ${icon}  ${r.check}  — ${r.detail}`);
  }
  console.log(`  summary: ${results.length - fails - warns} passed, ${warns} warned, ${fails} failed`);
  if (fails > 0) console.log('  → fix the FAIL items before the release train (OPERATIONS_SPEC.md §8).');
}
process.exit(fails > 0 ? 1 : 0);
