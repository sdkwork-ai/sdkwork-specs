#!/usr/bin/env node

/**
 * Enforce that declared cross-repo `workspace:*` dependencies are actually
 * materialized as `node_modules` links (PNPM_WORKSPACE_DEPENDENCY_SPEC.md).
 *
 * WHY THIS EXISTS
 *
 * `audit-undeclared-workspace-imports.mjs` answers one question: "does this
 * package import an `@sdkwork/*` specifier it never declared?" This check
 * answers the *inverse* question, which nothing covered before:
 *
 *   "this package declares an `@sdkwork/*` dependency — is it actually
 *    present in `node_modules`?"
 *
 * The two failure modes are disjoint, and the second one is silent:
 *
 *   1. import without declaration  -> caught by audit-undeclared-*
 *   2. declaration without install -> caught HERE
 *
 * A `pnpm install` is required after editing a `package.json`. When it is
 * skipped, the declaration and the workspace topology disagree: the package
 * sits in `.pnpm/` (so any version/lockfile inspection looks healthy) while the
 * `node_modules/@sdkwork/<dep>` link the resolver actually needs was never
 * created. The symptom surfaces much later, in a different tool:
 *
 *   [plugin:vite:import-analysis] Failed to resolve import "@sdkwork/x" ...
 *
 * That is a 3-day-old `package.json` edit masquerading as a Vite problem, and
 * it was hit independently in sdkwork-skills, sdkwork-mcp and sdkwork-drive on
 * 2026-09-20 — each diagnosed from scratch, each with a different wrong first
 * hypothesis. This check turns that into one line of output.
 *
 * WHAT COUNTS AS INSTALLED
 *
 * The decisive signal is the repository's own install marker
 * `<repo>/node_modules/.modules.yaml` (PNPM writes it on every completed
 * install). If it is absent the repository was never installed, and missing
 * links are expected rather than broken — reporting them would drown the real
 * findings in noise, because in this workspace the vast majority of repos are
 * intentionally uninstalled.
 *
 * So the scope rule is:
 *
 *   - repo NOT installed          -> skipped entirely   (reported as skipped)
 *   - repo installed, link absent -> violation          (exit 1)
 *
 * Within an installed repo, link presence is judged *per declaring package*,
 * not per repository root: pnpm materializes links next to the importer that
 * declares them, so a deep package legitimately lacks the link while its app
 * root has it. Checking only the repo root would both miss real violations and
 * invent fake ones.
 *
 * TWO DISTINCT CAUSES, TWO DISTINCT FIXES
 *
 * A missing link inside an installed repository has exactly two possible
 * causes, and they are not interchangeable — reporting the wrong remedy is
 * worse than reporting nothing:
 *
 *   `install-pending`     The manifest is inside the workspace globs, so pnpm
 *                         *would* link it — it just has not run since the edit.
 *                         Fix: `pnpm install`.
 *
 *   `workspace-uncovered` The manifest is NOT matched by any
 *                         `pnpm-workspace.yaml` glob, so it is not a workspace
 *                         member at all. `pnpm install` can never link it, no
 *                         matter how many times it runs. Fix: extend
 *                         `pnpm-workspace.yaml` (or drop the `workspace:*`
 *                         specifier if the package is deliberately standalone).
 *
 * Usage:
 *   node tools/check-workspace-link-materialization.mjs --workspace ..
 *                                                     [--repo <dir> …]
 *                                                     [--json] [--list-skipped]
 *
 * Exit codes: 0 clean, 1 violations found, 2 usage error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { listWorkspaceRepositoryRoots } from './lib/workspace-check-runner.mjs';
import {
  CAUSE_INSTALL_PENDING,
  CAUSE_WORKSPACE_UNCOVERED,
  validateRepository,
} from './lib/workspace-link-materialization.mjs';

const { values, positionals } = parseArgs({
  options: {
    workspace: { type: 'string' },
    repo: { type: 'string', multiple: true },
    json: { type: 'boolean', default: false },
    'list-skipped': { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const explicitRepos = [...(values.repo ?? []), ...positionals];
const workspaceRoot = values.workspace ? path.resolve(values.workspace) : undefined;

let repoRoots;
if (explicitRepos.length > 0) {
  repoRoots = explicitRepos
    .map((entry) => path.resolve(entry))
    .filter((entry) => fs.existsSync(path.join(entry, 'AGENTS.md')));
} else if (workspaceRoot) {
  repoRoots = listWorkspaceRepositoryRoots(workspaceRoot);
} else {
  console.error('usage: node tools/check-workspace-link-materialization.mjs --workspace <dir> [--repo <dir> …]');
  process.exit(2);
}

const results = repoRoots.map(validateRepository);
const violations = results.flatMap((result) => result.violations);
const installedRepos = results.filter((result) => result.installed);
const skippedRepos = results.filter((result) => !result.installed);

if (values.json) {
  console.log(JSON.stringify({
    repositoriesScanned: results.length,
    repositoriesInstalled: installedRepos.length,
    repositoriesSkipped: skippedRepos.length,
    violations,
  }, null, 2));
} else {
  console.log(`repositories scanned: ${results.length}`);
  console.log(`repositories installed: ${installedRepos.length}`);
  console.log(`repositories skipped (never installed): ${skippedRepos.length}`);
  console.log(`unmaterialized workspace dependencies: ${violations.length}`);

  if (values['list-skipped']) {
    for (const result of skippedRepos) {
      console.log(`  skipped: ${result.repoName}`);
    }
  }

  let currentRepo = undefined;
  for (const violation of violations) {
    if (violation.repoName !== currentRepo) {
      currentRepo = violation.repoName;
      console.log(`\n- ${violation.repoName}`);
    }
    console.log(`    ${violation.packageDir} (${violation.packageName})`);
    console.log(`        ${violation.dependency} (${violation.field}, ${violation.specifier})`);
    console.log(`        cause: ${violation.cause}`);
  }

  const pending = violations.filter((violation) => violation.cause === CAUSE_INSTALL_PENDING);
  const uncovered = violations.filter((violation) => violation.cause === CAUSE_WORKSPACE_UNCOVERED);

  if (pending.length > 0) {
    const repos = [...new Set(pending.map((violation) => violation.repoName))].sort();
    console.log('\n[install-pending] The manifest is a workspace member, so pnpm can link it —');
    console.log('the declaration simply postdates the last install. Fix with:');
    for (const repoName of repos) {
      console.log(`    (cd ../${repoName} && pnpm install)`);
    }
  }

  if (uncovered.length > 0) {
    console.log('\n[workspace-uncovered] These manifests are NOT matched by any');
    console.log('`pnpm-workspace.yaml` glob, so `pnpm install` can never create their');
    console.log('link. Either add a member glob, or drop the `workspace:*` specifier.');
    const uncoveredDirs = [...new Set(
      uncovered.map((violation) => `${violation.repoName}/${violation.packageDir}`),
    )].sort();
    for (const entry of uncoveredDirs) {
      const [repoName, ...rest] = entry.split('/');
      console.log(`    ../${repoName}/pnpm-workspace.yaml   <- ${rest.join('/')}`);
    }
  }
}

process.exit(violations.length > 0 ? 1 : 0);
