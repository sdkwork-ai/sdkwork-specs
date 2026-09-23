#!/usr/bin/env node

/**
 * Enforce the content-integrity half of the L1 repository baseline, fleet-wide.
 *
 * Why this exists. `audit-repository-baseline.mjs` owns two checks that are about
 * content rather than scaffolding:
 *
 *   - `tracked-compiler-emit` (REPOSITORY_BASELINE_SPEC.md section 2)
 *   - `forbidden-tracked`     (REPOSITORY_BASELINE_SPEC.md section 5)
 *
 * Both are fail-open by construction: they run only when named through `--only`, and
 * every runnable command line the specs hand out passes `--only branch-main`. The spec
 * body asks for the whole audit (section 5: "Run `node tools/audit-repository-baseline.mjs
 * --root <repo>` before claiming repository baseline completion"; section 6 lists
 * "`audit-repository-baseline.mjs` passes for the repository root"), but no pipeline ever
 * ran it, so a stale `.js`/`.d.ts` pair dropped beside its source stayed green forever.
 *
 * Why a wrapper instead of a manifest entry on the audit itself. `run-gate-matrix.mjs`
 * judges a guardrail by `countItems(output) > baseline`. The audit prints
 * `PASS <name> ([...])` / `FAIL <name> ([...])` lines, none of which any of the four
 * countItems readings recognise, so registering it directly would score 0 items for a
 * red repository — a second fail-open hiding behind the first. This wrapper reports in a
 * shape countItems can read and keeps the audit's own output contract untouched, so the
 * referenced-command lines in the specs keep parsing.
 *
 * Usage:
 *   node tools/check-repository-baseline-content.mjs --workspace <workspace-root>
 *   node tools/check-repository-baseline-content.mjs --root <repo-root>
 *   node tools/check-repository-baseline-content.mjs --workspace .. --json
 *
 * Fleet discovery is the platform's own: `listWorkspaceRepositoryRoots`, the same helper
 * `run-gate-matrix.mjs` uses, so this gate governs exactly the repositories the matrix
 * governs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { listWorkspaceRepositoryRoots } from './lib/workspace-check-runner.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_TOOL = path.join(TOOL_DIR, 'audit-repository-baseline.mjs');

/** The two checks that describe repository content rather than L1 scaffolding. */
const CHECKS = ['tracked-compiler-emit', 'forbidden-tracked'];

function auditOne(repoRoot) {
  const run = spawnSync(process.execPath, [AUDIT_TOOL, '--root', repoRoot, '--only', CHECKS.join(',')], {
    cwd: TOOL_DIR,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

  // A child that produced no parsable verdict is a failure, never a pass: an audit that
  // could not read the repository has not established that the repository is clean.
  const verdicts = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^(PASS|FAIL) ([a-z-]+)(?: \((.*)\))?$/u.exec(line.trim());
    if (match) verdicts.push({ status: match[1], name: match[2] });
  }
  if (verdicts.length !== CHECKS.length) {
    return {
      repository: path.basename(repoRoot),
      root: repoRoot,
      failures: [`audit harness: expected ${CHECKS.length} verdicts, read ${verdicts.length}`
        + `${run.error ? ` (${run.error.message})` : ''}`],
      raw: output.trim(),
    };
  }

  return {
    repository: path.basename(repoRoot),
    root: repoRoot,
    failures: verdicts.filter((verdict) => verdict.status === 'FAIL').map((verdict) => verdict.name),
    raw: output.trim(),
  };
}

function report(repos, { json }) {
  const results = repos.map((repoRoot) => auditOne(repoRoot));
  const failed = results.filter((result) => result.failures.length > 0);
  const violations = failed.reduce((total, result) => total + result.failures.length, 0);

  if (json) {
    console.log(JSON.stringify({
      checks: CHECKS,
      repositories: results.length,
      violations,
      failed: failed.map((result) => ({ repository: result.repository, failures: result.failures })),
    }));
    return violations === 0 ? 0 : 1;
  }

  console.log(`Repository baseline content gate (${CHECKS.join(', ')})`);
  console.log(results.length === 1
    ? `Scanned 1 repository: ${results[0].root}`
    : `Scanned ${results.length} repositories`);
  for (const result of failed) {
    // Deliberately not a bulleted line: run-gate-matrix counts `- ` lines as findings, and a
    // per-repository detail line must not inflate a count that means "failed checks".
    console.log(`  FAIL ${result.repository}: ${result.failures.join(', ')}`);
    if (result.raw) {
      for (const line of result.raw.split(/\r?\n/u)) {
        if (line.startsWith('FAIL')) console.log(`       ${line}`);
      }
    }
  }
  if (failed.length === 0) {
    console.log('  every repository satisfies REPOSITORY_BASELINE_SPEC.md sections 2 and 5');
  }
  console.log(`violations : ${violations}`);
  return violations === 0 ? 0 : 1;
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      root: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const json = values.json === true;
  if (values.workspace !== undefined && values.root !== undefined) {
    console.error('check-repository-baseline-content: pass either --workspace or --root, not both');
    process.exitCode = 2;
    return;
  }

  if (values.root !== undefined) {
    const repoRoot = path.resolve(values.root);
    if (!fs.existsSync(path.join(repoRoot, '.git'))) {
      console.error(`check-repository-baseline-content: refusing to report success: not a git repository: ${repoRoot}`);
      process.exitCode = 2;
      return;
    }
    process.exitCode = report([repoRoot], { json });
    return;
  }

  const workspace = path.resolve(values.workspace ?? path.join(TOOL_DIR, '..', '..'));
  // Fail closed. A missing or empty workspace would report "0 repositories, no violations",
  // which is the exact shape of a gate that occupies a contract slot while enforcing nothing.
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    console.error(`check-repository-baseline-content: refusing to report success: not a directory: ${workspace}`);
    process.exitCode = 2;
    return;
  }
  const repos = listWorkspaceRepositoryRoots(workspace);
  if (repos.length === 0) {
    console.error(`check-repository-baseline-content: refusing to report success: no sdkwork-* checkout under ${workspace}`);
    process.exitCode = 2;
    return;
  }

  process.exitCode = report(repos, { json });
}

// Only run as a program. Importing this module (the test harness does) must not scan the
// fleet as a side effect.
const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (import.meta.url === entryUrl) {
  main();
}

export { CHECKS, auditOne, report };
