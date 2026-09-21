#!/usr/bin/env node

/**
 * Workspace adoption tracker for the app runtime-env standard
 * (APP_RUNTIME_ENV_SPEC.md, BROWSER_RUNTIME_ENV_SPEC.md).
 *
 * Runs `tools/check-browser-runtime-env-standard.mjs` against every sibling
 * `sdkwork-*` repository that declares browser surfaces (any `apps/<app>`
 * vite config) and classifies each result:
 *
 * - `ok`           — the repository passes the standard checker.
 * - `environment`  — failures are ONLY dependency-install noise (the checkout
 *                    has no resolvable `@sdkwork/sdk-common`), not code debt;
 *                    rerun after `pnpm install`.
 * - `code-gap`     — real contract debt (no canonical tooling consumption, no
 *                    client-env materialization surfaces, checked-in or
 *                    unshadowed `public/runtime-env.json` artifacts).
 *
 * Modes:
 * - default (strict rollout gate): exit 1 when any `code-gap` exists.
 * - `--report`: always exit 0 and print the matrix (rollout tracking during
 *   the install-gated adoption campaign).
 *
 * The per-repo contract logic lives in the standard checker; this tool only
 * aggregates and classifies.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_TOOLS_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENVIRONMENTAL_PATTERN = /sdk-common is not resolvable/u;

function listBrowserSurfaceRepos(workspaceRoot) {
  const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^sdkwork-/u.test(entry.name))
    .map((entry) => path.join(workspaceRoot, entry.name));
  return entries.filter((repoRoot) => {
    const appsDir = path.join(repoRoot, 'apps');
    if (!fs.existsSync(appsDir)) return false;
    return fs.readdirSync(appsDir, { withFileTypes: true })
      .some((entry) => entry.isDirectory() && fs.existsSync(path.join(appsDir, entry.name, 'vite.config.ts')));
  });
}

function classifyRepository(repoRoot) {
  const result = spawnSync(
    process.execPath,
    [path.join(SPECS_TOOLS_ROOT, 'check-browser-runtime-env-standard.mjs'), '--root', repoRoot],
    { encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status === 0) {
    return { repoRoot, classification: 'ok', failures: [] };
  }
  const failures = output
    .split(/\r?\n/u)
    .filter((line) => line.includes('FAIL:'))
    .map((line) => line.replace(/^.*FAIL: /u, '').trim());
  const codeGaps = failures.filter((failure) => !ENVIRONMENTAL_PATTERN.test(failure));
  return {
    repoRoot,
    classification: codeGaps.length > 0 ? 'code-gap' : 'environment',
    failures: codeGaps,
    environmentalCount: failures.length - codeGaps.length,
  };
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      workspace: { type: 'string', default: path.resolve(SPECS_TOOLS_ROOT, '..', '..') },
      report: { type: 'boolean', default: false },
    },
  });
  const workspaceRoot = path.resolve(values.workspace);
  if (!fs.existsSync(workspaceRoot)) {
    throw new Error(`workspace root does not exist: ${workspaceRoot}`);
  }
  const repos = listBrowserSurfaceRepos(workspaceRoot);
  const results = repos.map((repoRoot) => classifyRepository(repoRoot));

  const ok = results.filter((entry) => entry.classification === 'ok');
  const environmental = results.filter((entry) => entry.classification === 'environment');
  const gaps = results.filter((entry) => entry.classification === 'code-gap');

  for (const entry of ok) {
    process.stdout.write(`[app-runtime-env] ok           ${path.basename(entry.repoRoot)}\n`);
  }
  for (const entry of environmental) {
    process.stdout.write(
      `[app-runtime-env] environment  ${path.basename(entry.repoRoot)} `
      + `(deps not installed; rerun after pnpm install — ${entry.environmentalCount} environmental failure(s))\n`,
    );
  }
  for (const entry of gaps) {
    process.stderr.write(`[app-runtime-env] code-gap     ${path.basename(entry.repoRoot)}\n`);
    for (const failure of entry.failures) {
      process.stderr.write(`[app-runtime-env]   - ${failure}\n`);
    }
  }

  process.stdout.write(
    `[app-runtime-env] workspace ${workspaceRoot}: ${ok.length} ok, `
    + `${environmental.length} environment-blocked, ${gaps.length} code-gap(s) `
    + `(${repos.length} browser-surface repositories)\n`,
  );
  if (gaps.length > 0 && !values.report) {
    process.exitCode = 1;
  }
}

main();
