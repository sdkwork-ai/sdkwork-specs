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
 *  10. single operator channel  — no parallel deploy entrypoints (MODULE_BIN_SPEC.md §1)
 *
 * Scope (OPERATIONS_SPEC.md §7.2): items 4-7 standardise the standalone
 * *container* install path. When a module's standalone profiles all deliver
 * host packages and the module ships no bundle, those items report `N/A` with
 * the posture as the reason instead of `FAIL`. A module that ships a bundle,
 * or that declares a standalone container delivery, stays fully in scope.
 * `N/A` never counts as a failure (exit code is driven by `FAIL` only).
 *
 * Usage:
 *   node check-operations-conformance.mjs --root <module-root> [--json]
 *   node check-operations-conformance.mjs --workspace <workspace-root> [--json] [--concurrency N]
 *
 * `--workspace` audits every module repository below the workspace root in a
 * single pass. A *module* is a repository that follows the fleet repo-name
 * convention (`sdkwork-*`) and carries the module manifest
 * `sdkwork.app.config.json` at its root. Two kinds of directory are therefore
 * reported as skipped rather than failed:
 *
 *   - tooling / spec / doc repositories — no manifest, so they are not modules
 *     (the spec repo itself, for example);
 *   - manifest-carrying repositories outside the `sdkwork-*` name convention —
 *     standalone product repos. The platform's own repo discovery
 *     (`tools/application-deploy-layout/discover.mjs`) filters on the same
 *     prefix, and no platform inventory references them, so the operations
 *     lifecycle standard does not govern them either. `--include-off-fleet`
 *     audits them anyway for a manual look.
 *
 * Exit codes: 0 = no FAIL, 1 = at least one FAIL (blocks the release train),
 * 2 = usage error.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
let root = '';
let workspace = '';
let concurrency = 8;
let includeOffFleet = false;
let asJson = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--root') { root = requireValue(args, ++i, args[i]); }
  else if (args[i] === '--workspace') { workspace = requireValue(args, ++i, args[i]); }
  else if (args[i] === '--concurrency') { concurrency = Math.max(1, Number(requireValue(args, ++i, args[i])) || 8); }
  else if (args[i] === '--include-off-fleet') { includeOffFleet = true; }
  else if (args[i] === '--json') { asJson = true; }
  else if (args[i] === '-h' || args[i] === '--help') { usage(); process.exit(0); }
  else { usage(); process.exit(2); }
}
if (!root && !workspace) { usage(); process.exit(2); }
if (root && workspace) { console.error('pass either --root or --workspace, not both'); process.exit(2); }
if (workspace) process.exit(await runWorkspace(path.resolve(workspace), concurrency, asJson, includeOffFleet));
root = path.resolve(root);
if (!existsSync(root)) { console.error(`root does not exist: ${root}`); process.exit(2); }

function usage() {
  console.error('usage: node check-operations-conformance.mjs --root <module-root> [--json]');
  console.error('       node check-operations-conformance.mjs --workspace <workspace-root> [--json] [--concurrency N] [--include-off-fleet]');
}
function requireValue(argv, index, value) {
  if (!value || value.startsWith('--')) {
    console.error(`option '${argv[index - 1]}' requires a value`);
    process.exit(2);
  }
  return value;
}

/**
 * Workspace regression: audit every module repository below `wsRoot` in one
 * pass. Each module is audited by a child process running this same file in
 * `--root` mode, so the per-module logic has exactly one implementation and
 * the workspace report cannot drift from the single-root report.
 *
 * The child pool keeps the pass to a few seconds on a Windows/MSYS workspace
 * where node startup dominates (99 sequential spawns exceed the usual tool
 * timeout; 8-way parallel does not).
 */
async function runWorkspace(wsRoot, limit, json, offFleet) {
  if (!existsSync(wsRoot)) { console.error(`workspace does not exist: ${wsRoot}`); return 2; }
  const self = fileURLToPath(import.meta.url);
  const manifests = [];
  const offFleetManifests = [];
  const skipped = [];
  for (const entry of readdirSync(wsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const dir = path.join(wsRoot, entry.name);
    if (!existsSync(path.join(dir, 'sdkwork.app.config.json'))) { skipped.push(entry.name); continue; }
    // Fleet convention: the platform's repo discovery filters on the same
    // `sdkwork-` prefix (tools/application-deploy-layout/discover.mjs).
    if (entry.name.startsWith('sdkwork-')) manifests.push(dir);
    else { offFleetManifests.push(entry.name); if (offFleet) manifests.push(dir); }
  }
  manifests.sort();

  const audits = new Array(manifests.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= manifests.length) return;
      audits[index] = await auditOne(manifests[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, manifests.length) }, worker));

  const failed = audits.filter((a) => a.fails > 0);
  const warned = audits.filter((a) => a.fails === 0 && a.warns > 0);
  const clean = audits.filter((a) => a.fails === 0 && a.warns === 0);
  const naTotal = audits.reduce((sum, a) => sum + a.na, 0);

  if (json) {
    console.log(JSON.stringify({
      workspace: wsRoot,
      modules: audits.length,
      clean: clean.length,
      warned: warned.length,
      failed: failed.length,
      na: naTotal,
      skippedNotModules: skipped.sort(),
      offFleet: offFleetManifests.sort(),
      audits,
    }, null, 2));
    return failed.length > 0 ? 1 : 0;
  }

  console.log(`\n[ops-conformance] workspace ${wsRoot}`);
  console.log(`  modules: ${audits.length}   clean: ${clean.length}   failed: ${failed.length}   not-applicable checks: ${naTotal}`);
  if (skipped.length > 0) console.log(`  skipped (not a module — no sdkwork.app.config.json): ${skipped.sort().join(', ')}`);
  if (offFleetManifests.length > 0) {
    console.log(`  skipped (manifest outside the sdkwork-* fleet convention, not audited${offFleet ? ' — audited via --include-off-fleet' : ''}): ${offFleetManifests.sort().join(', ')}`);
  }
  for (const a of failed) {
    const items = a.results.filter((r) => r.status === 'FAIL').map((r) => r.check).join('; ');
    console.log(`  FAIL  ${a.module}  — ${items}`);
  }
  for (const a of warned) {
    const items = a.results.filter((r) => r.status === 'WARN').map((r) => r.check).join('; ');
    console.log(`  WARN  ${a.module}  — ${items}`);
  }
  if (failed.length === 0) {
    console.log('  all modules satisfy the operations lifecycle standard' + (warned.length === 0 ? ' (no warnings)' : ''));
  }
  return failed.length > 0 ? 1 : 0;
}

function auditOne(moduleRoot) {
  return new Promise((resolve) => {
    execFile(process.execPath, [fileURLToPath(import.meta.url), '--root', moduleRoot, '--json'],
      { maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({
            module: path.basename(moduleRoot),
            root: moduleRoot,
            fails: 1,
            warns: 0,
            na: 0,
            results: [{ check: 'audit harness', status: 'FAIL', detail: error ? String(error.message) : 'no parseable report' }],
          });
        }
      });
  });
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

// --- delivery posture (OPERATIONS_SPEC.md §7.2) --------------------------------------
// The bundle/compose/env-example checks and the container-only wiring hooks
// standardise the standalone *container* install path. A module whose
// standalone profiles all deliver host packages is out of scope for them —
// unless it has already opted in by shipping a bundle, in which case the
// bundle must stay conformant. Scope is never inferred from absence alone.
let standaloneDelivery = '';
let declaresStandaloneContainer = false;
const deployYamlPath = path.join(root, 'deployments', 'deploy.yaml');
if (existsSync(deployYamlPath)) {
  const text = readFileSync(deployYamlPath, 'utf8');
  const kinds = new Set();
  const blocks = [...text.matchAll(/^  standalone\.[a-z]+:[\s\S]*?^      deliveryKind: ([\w-]+)$/gm)];
  for (const [, kind] of blocks) kinds.add(kind);
  standaloneDelivery = [...kinds].join(', ');
  declaresStandaloneContainer = kinds.size > 0 && [...kinds].every((k) => k.startsWith('container-image'));
}
let bundleDir = '';
for (const c of ['deployments/docker/bundle', 'scripts/docker/bundle']) {
  const p = path.join(root, c);
  if (existsSync(path.join(p, 'deploy.sh'))) { bundleDir = p; break; }
}
const bundleInScope = Boolean(bundleDir) || declaresStandaloneContainer;
const bundleScopeNote = `standalone delivery is \`${standaloneDelivery || 'undeclared'}\`, not a standalone container install — the bundle stage is not in scope (OPERATIONS_SPEC.md §7.2)`;

// --- 3. module wiring hooks ------------------------------------------------------
if (!existsSync(moduleShPath)) {
  record('module wiring hooks', 'FAIL', 'bin/lib/module.sh missing');
} else {
  const text = readFileSync(moduleShPath, 'utf8');
  const coreHooks = [
    ['SDKWORK_MODULE_ID=', 'module id'],
    ['SDKWORK_IMAGE_NAME=', 'image name'],
    ['SDKWORK_PRIMARY_SERVICE=', 'primary service'],
    ['SDKWORK_HEALTH_PATH=', 'health path'],
    ['sdkwork_image_build()', 'image build hook'],
    ['sdkwork_build_app()', 'app build hook'],
    ['sdkwork_package_app()', 'app package hook'],
    ['sdkwork_deploy_app()', 'app deploy hook'],
  ];
  // Container-only hooks drive the compose/container install path
  // (config.sh env chain, docker health probes) — see OPERATIONS_SPEC.md §7.2.
  const containerHooks = [
    ['sdkwork_module_health_port()', 'health port hook'],
    ['sdkwork_module_local_env_dir()', 'local env dir hook'],
    ['sdkwork_module_config_validate()', 'config validate hook'],
  ];
  const missing = coreHooks.filter(([needle]) => !text.includes(needle)).map(([, label]) => label);
  if (missing.length > 0) {
    record('module wiring hooks', 'FAIL', `missing: ${missing.join(', ')}`);
  } else if (!bundleInScope) {
    const containerMissing = containerHooks.filter(([needle]) => !text.includes(needle)).map(([, label]) => label);
    const detail = containerMissing.length > 0
      ? `core hooks declared; container-only hooks not required here (${bundleScopeNote}): ${containerMissing.join(', ')}`
      : 'all MODULE_BIN_SPEC §3 hooks declared';
    record('module wiring hooks', 'PASS', detail);
  } else {
    const allMissing = containerHooks.filter(([needle]) => !text.includes(needle)).map(([, label]) => label);
    if (allMissing.length === 0) record('module wiring hooks', 'PASS', 'all MODULE_BIN_SPEC §3 hooks declared');
    else record('module wiring hooks', 'FAIL', `missing: ${allMissing.join(', ')}`);
  }
  const secretDup = /SDKWORK_SECRET_[A-Z_]+\s*=/.test(text);
  if (secretDup) record('secret constants duplication', 'FAIL', 'module.sh re-declares SDKWORK_SECRET_* (must live only in sdkwork-common.sh)');
  else record('secret constants duplication', 'PASS', 'no SDKWORK_SECRET_* duplication');
}

// --- 4/5. bundle deploy + release channel -----------------------------------------
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
} else if (bundleInScope) {
  record('bundle deploy entrypoint', 'FAIL', 'no bundle deploy.sh under deployments/docker/bundle or scripts/docker/bundle');
  record('bundle release channel (§1.2)', 'FAIL', 'no bundle → no release channel');
} else {
  record('bundle deploy entrypoint', 'N/A', bundleScopeNote);
  record('bundle release channel (§1.2)', 'N/A', bundleScopeNote);
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
    // `external/` holds vendored third-party stacks (thingsboard, hermes-agent,
    // openclaw, …): the §2.3 rotation rule governs our own compose files, and
    // patching vendor trees would be lost on the next vendor sync.
    if (s.isDirectory()) { if (name !== 'node_modules' && name !== 'external') walkCompose(p, depth + 1); }
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
if (composeChecked === 0) {
  record('compose log rotation (§2.3)', bundleInScope ? 'WARN' : 'N/A',
    bundleInScope ? 'no compose files with services: found' : bundleScopeNote);
} else if (composeBad.length === 0) record('compose log rotation (§2.3)', 'PASS', `${composeChecked} compose file(s) cover every service with logging`);
else record('compose log rotation (§2.3)', 'FAIL', `services without logging: ${composeBad.join('; ')}`);

// --- 7. env examples ------------------------------------------------------------------
const envDirs = [path.join(root, 'deployments', 'docker', 'env'), path.join(root, 'docker', 'env'), path.join(bundleDir ? path.join(root, bundleDir) : root, 'env')];
const envExampleCount = new Set();
for (const d of envDirs) {
  if (!existsSync(d)) continue;
  for (const name of readdirSync(d)) if (/\.example$/.test(name)) envExampleCount.add(`${rel(d)}/${name}`);
}
const topologyDir = path.join(root, 'etc', 'topology');
if (envExampleCount.size >= 3) {
  record('environment env examples (§3.1)', 'PASS', `${envExampleCount.size} example env file(s)`);
} else if (!bundleInScope) {
  // Scope note: items 4-7 key on the same condition — the bundle stage being in
  // scope. A module that ships no standalone container install has no
  // `deployments/docker/env/` contract to satisfy: host-package modules keep
  // their environments in `etc/topology/`, and framework / assembly-only repos
  // materialise no per-environment file at all. The topology count is reported
  // when present, but its absence is not by itself a §3.1 defect and therefore
  // must not turn this check into a FAIL.
  const topologyNote = existsSync(topologyDir)
    ? `; host-package environments live in etc/topology (${readdirSync(topologyDir).filter((n) => n.endsWith('.env')).length} file(s))`
    : '; the repository materialises no per-environment files';
  record('environment env examples (§3.1)', 'N/A', `container-install env examples are not in scope (${bundleScopeNote})${topologyNote}`);
} else record('environment env examples (§3.1)', 'FAIL', `found ${envExampleCount.size} (need ≥3 across deployments/docker/env, docker/env, or bundle env/)`);

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

// --- 10. single operator channel (MODULE_BIN_SPEC.md §1) ---------------------------------
// bin/ is the only operator surface: no package.json wrapper may invoke a bundle
// executor or remote-deploy helper directly, and no operator-facing document may
// present direct executor invocation as an operator path.
const channelViolations = [];
const pkgPath = path.join(root, 'package.json');
if (existsSync(pkgPath)) {
  try {
    const scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts || {};
    for (const [name, cmd] of Object.entries(scripts)) {
      if (!/^(deploy|release|install):/.test(name)) continue;
      if (/bin[\\/]docker-(deploy|image)\.sh/.test(cmd)) continue; // bin/ aliases are compliant
      if (/(bundle\/)?(deploy|release)\.sh|remote-deploy|deploy-docker-environment|deploy\/apply\.(sh|ps1)/.test(cmd)) {
        channelViolations.push(`package.json#${name} → ${cmd}`);
      }
    }
  } catch { /* malformed package.json is not this check's concern */ }
}
const operatorDocDirs = [root, path.join(root, 'docs', 'runbooks'), path.join(root, 'docs', 'guides', 'operator'), path.join(root, 'docs', 'sites', 'deployment')];
for (const dir of operatorDocDirs) {
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name.startsWith('RUNBOOK-')) continue;
    const text = readFileSync(path.join(dir, entry.name), 'utf8');
    const rel = path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/');
    for (const m of text.matchAll(/^\s*(?:sudo )?bash (?:\.\/)?(?:[\w./-]*\/)?(deploy|release)\.sh\b.*$/gm)) {
      channelViolations.push(`${rel}: direct executor call (${m[0].trim().slice(0, 60)}…)`);
    }
  }
}
if (channelViolations.length === 0) record('single operator channel (§1)', 'PASS', 'no parallel deploy entrypoints in package.json or operator docs');
else record('single operator channel (§1)', 'FAIL', `${channelViolations.length} parallel entrypoint(s): ${channelViolations.slice(0, 4).join(' | ')}`);

// --- report ------------------------------------------------------------------------------
const fails = results.filter((r) => r.status === 'FAIL').length;
const warns = results.filter((r) => r.status === 'WARN').length;
const naCount = results.filter((r) => r.status === 'N/A').length;
if (asJson) {
  console.log(JSON.stringify({ module: appId, root, fails, warns, na: naCount, results }, null, 2));
} else {
  console.log(`\n[ops-conformance] ${appId} (${root})`);
  if (containerImageHint) console.log(`  container image: ${containerImageHint}`);
  for (const r of results) {
    const icon = r.status === 'PASS' ? 'PASS' : r.status === 'WARN' ? 'WARN' : r.status === 'N/A' ? 'N/A ' : 'FAIL';
    console.log(`  ${icon}  ${r.check}  — ${r.detail}`);
  }
  console.log(`  summary: ${results.length - fails - warns - naCount} passed, ${warns} warned, ${fails} failed, ${naCount} not-applicable`);
  if (fails > 0) console.log('  → fix the FAIL items before the release train (OPERATIONS_SPEC.md §8).');
}
process.exit(fails > 0 ? 1 : 0);
