#!/usr/bin/env node

/**
 * Validate a module's bin/ entrypoint family against MODULE_BIN_SPEC.md.
 *
 * Two invocation modes:
 *
 *   node tools/check-module-bin.mjs --root <module-root> [--json]
 *     Per-module CI. The exit code is the verdict for that one module.
 *
 *   node tools/check-module-bin.mjs --workspace <workspace-root> [--json] [--concurrency N] [--include-off-fleet]
 *     Fleet regression. Discovers every module in the workspace, audits each
 *     through the same --root implementation in a child process, and fails if
 *     any module fails.
 *
 * Fleet predicate (identical to check-operations-conformance.mjs and to the
 * platform's own repo discovery in tools/application-deploy-layout/discover.mjs):
 * a *module* is a directory named sdkwork-* that carries sdkwork.app.config.json
 * at its root. Directories without a manifest are reported as skipped; a
 * manifest outside the sdkwork-* convention (a product repo such as
 * hub-installer) is reported separately and audited only with
 * --include-off-fleet, because the fleet convention does not claim it.
 *
 * Unlike the operations gate there is no N/A here: every module owns a bin/
 * family, so the verdict is binary.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REQUIRED_SCRIPTS = Object.freeze([
  'docker-image.sh',
  'docker-deploy.sh',
  'apps-build.sh',
  'apps-package.sh',
  'apps-deploy.sh',
  'apps-pkg-installer.sh',
  'config.sh',
  'doctor.sh',
  'backup.sh',
]);

// A thin wrapper is a 2-statement dispatch; anything longer means generic
// logic leaked out of the shared library (MODULE_BIN_SPEC.md §2).
const MAX_WRAPPER_LINES = 8;

// Generic concerns that MUST live in sdkwork-specs/bin/lib/sdkwork-common.sh.
// Finding one of these in a module wrapper is a coupling violation.
const FORBIDDEN_IN_MODULE_SH = Object.freeze([
  { pattern: /\b(ssh|scp)\s/, issue: 'raw ssh/scp (use sdkwork_remote / sdkwork_push_dir)' },
  { pattern: /sha256sum/, issue: 'sha256sum (use sdkwork_write_checksum)' },
  { pattern: /tar\s+-[^\s]*c/, issue: 'tar create (use sdkwork_tar_artifact)' },
  { pattern: /docker\s+(save|push|load|pull)\b/, issue: 'raw docker transport (use the docker-image entrypoint)' },
  { pattern: /^SDKWORK_IMAGE_TAG_DEFAULT=/m, issue: 'hardcoded SDKWORK_IMAGE_TAG_DEFAULT (the tag comes from sdkwork.app.config.json release.currentVersion)' },
]);

function checkModuleBin(root) {
  const issues = [];
  const warnings = [];
  const binDir = path.join(root, 'bin');
  if (!fs.existsSync(binDir)) {
    return { issues: [`missing bin/ directory (MODULE_BIN_SPEC.md §2)`], warnings };
  }

  for (const script of REQUIRED_SCRIPTS) {
    const p = path.join(binDir, script);
    if (!fs.existsSync(p)) {
      issues.push(`missing required bin/${script}`);
      continue;
    }
    try {
      fs.accessSync(p, fs.constants.X_OK);
    } catch {
      issues.push(`bin/${script} is not executable`);
    }
    const text = fs.readFileSync(p, 'utf8');
    if (!text.includes('lib/bootstrap.sh')) {
      issues.push(`bin/${script} must bootstrap through bin/lib/bootstrap.sh (thin wrapper rule, §2)`);
    }
    const bodyLines = text.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
    if (bodyLines.length > MAX_WRAPPER_LINES) {
      issues.push(
        `bin/${script} has ${bodyLines.length} code lines; thin wrappers must stay <= ${MAX_WRAPPER_LINES} (§2)`,
      );
    }
  }

  // §2.1 — no generic grouping subdirectory. Intent is declared by the script
  // name (§2.2); an opaque bin/bundle/ (or bin/docker/, bin/misc/) wrapper that
  // hides what each script does is exactly the pattern v1.4 removed. Bundle
  // executors live flat as bin/docker-bundle-deploy.sh / -release.sh and are
  // copied to the bundle root by the module's packager.
  for (const group of ['bundle', 'docker', 'misc']) {
    const p = path.join(binDir, group);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      issues.push(
        `bin/${group}/ is a generic grouping subdirectory (MODULE_BIN_SPEC.md §2.1); move its scripts flat into bin/ and name them by family (§2.2, e.g. bin/docker-bundle-deploy.sh)`,
      );
    }
  }

  // §2.2 — family membership for every hand-maintained script directly in bin/.
  // Reported as warnings, not issues: the fleet still carries legacy names
  // (sdkwork-im's host-service family, sdkwork-webserver's build-apps-static.sh)
  // and the debt must stay visible without silently drifting. Promote to
  // `issues` once the fleet is clean.
  const NAMING_FAMILIES = [
    /^docker-[a-z0-9]+(?:-[a-z0-9]+)*\.(sh|ps1|cmd)$/,
    /^apps-[a-z0-9]+(?:-[a-z0-9]+)*\.(sh|ps1|cmd)$/,
    /^(config|doctor|backup)\.(sh|ps1|cmd)$/,
  ];
  for (const entry of fs.readdirSync(binDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(sh|ps1|cmd)$/.test(entry.name)) continue;
    // Internal shims are called by other scripts, never by an operator.
    if (entry.name.startsWith('_')) continue;
    if (!NAMING_FAMILIES.some((re) => re.test(entry.name))) {
      warnings.push(
        `bin/${entry.name} matches no §2.2 name family (docker-* | apps-* | config.sh/doctor.sh/backup.sh); rename it into one, or move it out of bin/`,
      );
    }
  }

  const moduleSh = path.join(binDir, 'lib', 'module.sh');
  if (!fs.existsSync(moduleSh)) {
    issues.push('missing bin/lib/module.sh (module wiring, §3)');
  } else {
    const text = fs.readFileSync(moduleSh, 'utf8');
    for (const key of ['SDKWORK_MODULE_ID', 'SDKWORK_IMAGE_NAME', 'SDKWORK_APP_TYPES']) {
      if (!text.includes(key)) {
        issues.push(`bin/lib/module.sh does not declare ${key}`);
      }
    }
    for (const hook of ['sdkwork_build_app', 'sdkwork_package_app', 'sdkwork_deploy_app', 'sdkwork_image_build', 'sdkwork_installer_app']) {
      if (!text.includes(hook)) {
        issues.push(`bin/lib/module.sh does not implement hook ${hook}`);
      }
    }
    for (const { pattern, issue } of FORBIDDEN_IN_MODULE_SH) {
      if (pattern.test(text)) {
        issues.push(`bin/lib/module.sh reimplements a shared concern: ${issue} (§3)`);
      }
    }
  }

  const bootstrap = path.join(binDir, 'lib', 'bootstrap.sh');
  if (fs.existsSync(bootstrap)) {
    const text = fs.readFileSync(bootstrap, 'utf8');
    for (const marker of ['SDKWORK_SPECS_ROOT', 'sdkwork-common.sh', 'entrypoints.sh']) {
      if (!text.includes(marker)) {
        issues.push(`bin/lib/bootstrap.sh does not reference ${marker} (§3 resolution order)`);
      }
    }
    // Operations lifecycle (OPERATIONS_SPEC.md §3-§5) ships as shared libraries;
    // a bootstrap that omits them forces the module to reimplement.
    for (const lib of ['ops-config.sh', 'ops-observe.sh', 'ops-backup.sh']) {
      if (!text.includes(lib)) {
        issues.push(`bin/lib/bootstrap.sh does not source ${lib} (OPERATIONS_SPEC.md §3-§5)`);
      }
    }
    if (!text.includes('sdkwork_init')) {
      issues.push('bin/lib/bootstrap.sh must call sdkwork_init (guards, defaults, evidence trap, §3)');
    }
  } else {
    issues.push('missing bin/lib/bootstrap.sh');
  }

  const readme = path.join(binDir, 'README.md');
  if (!fs.existsSync(readme)) {
    issues.push('missing bin/README.md (usage card, §2)');
  }

  return { issues, warnings };
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      root: { type: 'string' },
      workspace: { type: 'string' },
      json: { type: 'boolean', default: false },
      concurrency: { type: 'string' },
      'include-off-fleet': { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/check-module-bin.mjs --root <module-root> [--json]');
    console.log('       node tools/check-module-bin.mjs --workspace <workspace-root> [--json] [--concurrency N] [--include-off-fleet]');
    return 0;
  }

  if (values.workspace) {
    const limit = Math.max(1, Number(values.concurrency) || 8);
    return runWorkspace(path.resolve(values.workspace), limit, values.json, values['include-off-fleet']);
  }

  const root = path.resolve(values.root ?? '.');
  const { issues, warnings } = checkModuleBin(root);
  const report = { module: path.basename(root), root, ok: issues.length === 0, issues, warnings };

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (issues.length > 0) {
    console.error(`module bin standard failed for ${root}`);
    issues.forEach((issue) => console.error(`- ${issue}`));
    warnings.forEach((issue) => console.error(`warn: ${issue}`));
  } else {
    console.log(`module bin standard passed for ${root}`);
    if (warnings.length > 0) {
      console.log(`  ${warnings.length} naming warning(s) (MODULE_BIN_SPEC.md §2.2):`);
      warnings.forEach((issue) => console.log(`  - ${issue}`));
    }
  }
  return issues.length > 0 ? 1 : 0;
}

/**
 * Fleet regression. Child processes reuse the --root code path above, so the
 * workspace verdict cannot drift from the per-module one. The worker pool
 * exists for the same reason as in check-operations-conformance.mjs: on a
 * Windows/MSYS workspace node startup dominates, and 79 sequential spawns
 * exceed a typical tool timeout while 8-way parallel finishes in seconds.
 */
async function runWorkspace(wsRoot, limit, json, offFleet) {
  if (!fs.existsSync(wsRoot)) {
    console.error(`workspace does not exist: ${wsRoot}`);
    return 2;
  }
  const manifests = [];
  const offFleetManifests = [];
  const skipped = [];
  for (const entry of fs.readdirSync(wsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const dir = path.join(wsRoot, entry.name);
    if (!fs.existsSync(path.join(dir, 'sdkwork.app.config.json'))) { skipped.push(entry.name); continue; }
    if (entry.name.startsWith('sdkwork-')) manifests.push(dir);
    else { offFleetManifests.push(entry.name); if (offFleet) manifests.push(dir); }
  }
  manifests.sort();

  const reports = new Array(manifests.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= manifests.length) return;
      reports[index] = await auditOne(manifests[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, manifests.length) }, worker));

  const failed = reports.filter((r) => !r.ok);

  if (json) {
    console.log(JSON.stringify({
      workspace: wsRoot,
      modules: reports.length,
      passed: reports.length - failed.length,
      failed: failed.length,
      modulesWithNamingWarnings: reports.filter((r) => (r.warnings?.length ?? 0) > 0).length,
      skippedNotModules: skipped.sort(),
      offFleet: offFleetManifests.sort(),
      reports,
    }, null, 2));
    return failed.length > 0 ? 1 : 0;
  }

  console.log(`\n[module-bin] workspace ${wsRoot}`);
  console.log(`  modules: ${reports.length}   passed: ${reports.length - failed.length}   failed: ${failed.length}`);
  // A `violations : N` line is the shape `run-gate-matrix.mjs#countItems` reads,
  // so a guardrail entry can measure this gate. Without it the matrix recorded
  // 0 for every run and the gate could never fail — the placement gates were
  // unwired from both tiers entirely before this line existed.
  console.log(`  violations:      ${failed.reduce((n, r) => n + (r.issues?.length ?? 0), 0)}`);
  if (skipped.length > 0) console.log(`  skipped (not a module — no sdkwork.app.config.json): ${skipped.sort().join(', ')}`);
  if (offFleetManifests.length > 0) {
    console.log(`  skipped (manifest outside the sdkwork-* fleet convention, not audited${offFleet ? ' — audited via --include-off-fleet' : ''}): ${offFleetManifests.sort().join(', ')}`);
  }
  for (const r of failed) {
    console.log(`  FAIL  ${r.module}`);
    r.issues.forEach((issue) => console.log(`          - ${issue}`));
  }
  // §2.2 naming debt is reported but never blocks: the point is that it cannot
  // drift silently. Promote to a failure once the fleet carries no warnings.
  const warned = reports.filter((r) => r.ok && (r.warnings?.length ?? 0) > 0);
  if (warned.length > 0) {
    const total = warned.reduce((n, r) => n + r.warnings.length, 0);
    console.log(`  WARN  ${total} naming warning(s) (MODULE_BIN_SPEC.md §2.2) across ${warned.length} module(s) — visible debt, not a gate failure:`);
    for (const r of warned) console.log(`          ${r.module}: ${r.warnings.length}`);
  }
  if (failed.length === 0) console.log('  every module satisfies the bin/ entrypoint standard');
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
          // A child that cannot even emit a report is itself a failure — never
          // a silent pass.
          resolve({
            module: path.basename(moduleRoot),
            root: moduleRoot,
            ok: false,
            issues: [`audit harness: ${error ? String(error.message) : 'no parseable report'}`],
          });
        }
      });
  });
}

process.exitCode = await main();
