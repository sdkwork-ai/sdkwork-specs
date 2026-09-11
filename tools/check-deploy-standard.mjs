#!/usr/bin/env node

/**
 * Validate a repository's deployments/deploy.yaml against DEPLOYMENT_SPEC.md.
 *
 * Two invocation modes:
 *
 *   node tools/check-deploy-standard.mjs [--root <repo-root>] [--deployment-profile <standalone|cloud>]
 *     Per-module CI. Defaults to the current working directory. The exit code is
 *     the verdict for that one repository.
 *
 *   node tools/check-deploy-standard.mjs --workspace <workspace-root> [--json] [--concurrency N] [--include-off-fleet]
 *     Fleet regression. Discovers every module carrying deployments/deploy.yaml
 *     and audits each through the same validate implementation in a child
 *     process.
 *
 * Fleet predicate (identical to check-operations-conformance.mjs,
 * check-module-bin.mjs and the platform's own repo discovery): a *module* is a
 * directory named sdkwork-* carrying sdkwork.app.config.json at its root.
 *
 * The fleet mode exists because the absence of one is why the standard drifted:
 * this check was only ever run one repository at a time, so 45 manifests
 * accumulated non-deployable profiles without anyone noticing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { validateDeploy } from './deploy/validate.mjs';

function auditRepo(repoRoot) {
  const result = validateDeploy(repoRoot, process.env.SDKWORK_DEPLOY_PROFILE);
  return {
    module: path.basename(repoRoot),
    root: repoRoot,
    ok: result.ok,
    profileId: result.profileId ?? null,
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
  };
}

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
    if (!fs.existsSync(path.join(dir, 'deployments', 'deploy.yaml'))) { skipped.push(entry.name); continue; }
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
      skippedNotModules: skipped.sort(),
      offFleet: offFleetManifests.sort(),
      reports,
    }, null, 2));
    return failed.length > 0 ? 1 : 0;
  }

  console.log(`\n[deploy-standard] workspace ${wsRoot}`);
  console.log(`  modules: ${reports.length}   passed: ${reports.length - failed.length}   failed: ${failed.length}`);
  if (offFleetManifests.length > 0) {
    console.log(`  skipped (manifest outside the sdkwork-* fleet convention, not audited${offFleet ? ' — audited via --include-off-fleet' : ''}): ${offFleetManifests.sort().join(', ')}`);
  }
  for (const r of failed) {
    console.log(`  FAIL  ${r.module}  (${r.errors.length} error(s))`);
    for (const error of r.errors.slice(0, 3)) console.log(`          - ${error}`);
    if (r.errors.length > 3) console.log(`          … ${r.errors.length - 3} more`);
  }
  if (failed.length === 0) console.log('  every module satisfies the deployment manifest standard');
  return failed.length > 0 ? 1 : 0;
}

function auditOne(moduleRoot) {
  return new Promise((resolve) => {
    execFile(process.execPath, [fileURLToPath(import.meta.url), '--root', moduleRoot, '--json'],
      { maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        try {
          const parsed = JSON.parse(stdout);
          if (Array.isArray(parsed.errors)) resolve(parsed);
          else resolve({ module: path.basename(moduleRoot), root: moduleRoot, ok: false, errors: ['no parseable report'], warnings: [] });
        } catch {
          // A repository that cannot even emit a report is itself a failure.
          resolve({
            module: path.basename(moduleRoot),
            root: moduleRoot,
            ok: false,
            errors: [`audit harness: ${error ? String(error.message) : 'no parseable report'}`],
            warnings: [],
          });
        }
      });
  });
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
      // Accepted for backward compatibility with the per-repository npm scripts
      // (`deploy:validate:standalone` / `:cloud`); profile selection is driven
      // by SDKWORK_DEPLOY_PROFILE and the manifest's defaultProfile.
      'deployment-profile': { type: 'string' },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/check-deploy-standard.mjs [--root <repo-root>] [--deployment-profile <standalone|cloud>]');
    console.log('       node tools/check-deploy-standard.mjs --workspace <workspace-root> [--json] [--concurrency N] [--include-off-fleet]');
    return 0;
  }

  if (values.workspace) {
    const limit = Math.max(1, Number(values.concurrency) || 8);
    return runWorkspace(path.resolve(values.workspace), limit, values.json, values['include-off-fleet']);
  }

  const repoRoot = path.resolve(values.root ?? process.cwd());
  const report = auditRepo(repoRoot);

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  for (const warning of report.warnings) console.warn(`warning: ${warning}`);
  if (!report.ok) {
    for (const error of report.errors) console.error(`error: ${error}`);
    return 1;
  }
  console.log(`check-deploy-standard ok (${report.profileId})`);
  return 0;
}

process.exitCode = await main();
