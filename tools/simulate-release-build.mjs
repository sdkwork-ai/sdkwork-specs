#!/usr/bin/env node
/**
 * Local CI packaging rehearsal (DEPENDENCY_MANAGEMENT_SPEC.md §5.2).
 *
 * Rehearse the release/packaging flow locally in the exact layout CI uses:
 *   1. clone this repository into a throwaway parent directory
 *   2. clone every sibling referenced by sdkwork.workflow.json dependencies[]
 *      from the local ../sdkwork-* checkout at the pinned ref (or local HEAD)
 *   3. install with the frozen lockfile
 *   4. run the requested package/build step
 * It passes only if the full step passes in that layout — the same layout the
 * GitHub workflows build (setup-sdkwork-siblings / checkout-dependencies
 * materialize ../<id> beside the checkout on runners).
 *
 * Reference: sdkwork-birdcoder2/scripts/simulate-ci-build.mjs
 *
 * Usage:
 *   node tools/simulate-release-build.mjs --root <repository-root> [--steps <pnpm script|node file>]
 * Default steps: <repository package script> if one is declared in package.json
 * scripts under the keys gateway:package / package / build:package, else `build`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

function usage() {
  return [
    'Usage:',
    '  node tools/simulate-release-build.mjs --root <repository-root> [--steps <step>]',
    '',
    '  --steps <value>   pnpm script name (e.g. gateway:package:standalone) or',
    '                    a node script path to run in the rehearsal checkout.',
    '                    Default: first declared package script among',
    '                    gateway:package / gateway:package:* / package / build:package.',
  ].join('\n');
}

function run(command, args, cwd, shell = false) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function defaultStep(packageJson) {
  const scripts = packageJson?.scripts ?? {};
  const candidates = [
    'gateway:package',
    'gateway:package:standalone',
    'package',
    'build:package',
    'build',
  ];
  for (const candidate of candidates) {
    if (typeof scripts[candidate] === 'string') {
      return candidate;
    }
  }
  return 'build';
}

function resolveSiblingRef(repoRoot, dependency) {
  // Pinned commit SHA wins; otherwise fall back to the local sibling HEAD so
  // the rehearsal mirrors the workflow ref resolution without GitHub access.
  const ref = dependency.ref;
  if (typeof ref === 'string' && /^[0-9a-f]{40}$/i.test(ref)) {
    return ref;
  }
  const siblingRoot = path.join(repoRoot, '..', dependency.id);
  if (existsSync(path.join(siblingRoot, '.git'))) {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: siblingRoot, encoding: 'utf8' });
    if (result.status === 0) {
      return String(result.stdout ?? '').trim();
    }
  }
  return null;
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      steps: { type: 'string' },
    },
  });
  if (!values.root) {
    console.error(usage());
    process.exit(2);
  }

  const repoRoot = path.resolve(values.root);
  const repoName = path.basename(repoRoot);
  const workflowFile = path.join(repoRoot, 'sdkwork.workflow.json');
  const packageFile = path.join(repoRoot, 'package.json');
  const packageJson = existsSync(packageFile) ? JSON.parse(readFileSync(packageFile, 'utf8')) : {};
  const steps = values.steps ?? defaultStep(packageJson);
  const dependencies = existsSync(workflowFile)
    ? (JSON.parse(readFileSync(workflowFile, 'utf8')).dependencies ?? [])
    : [];

  const parent = mkdtempSync(path.join(tmpdir(), `${repoName}-ci-sim-`));
  const checkout = path.join(parent, repoName);
  let failed = false;
  try {
    console.log(`[ci-sim] checkout: ${checkout}`);
    if (run('git', ['clone', '--quiet', '--no-hardlinks', repoRoot, checkout], parent) !== 0) {
      throw new Error('failed to clone this repository');
    }

    const skipped = [];
    for (const dependency of dependencies) {
      const source = path.join(repoRoot, '..', dependency.id);
      const dest = path.join(parent, dependency.id);
      if (!existsSync(path.join(source, '.git'))) {
        skipped.push(dependency.id);
        continue;
      }
      const commit = resolveSiblingRef(repoRoot, dependency);
      if (!commit) {
        throw new Error(`cannot resolve ref for sibling ${dependency.id}`);
      }
      if (run('git', ['init', '--quiet', dest], parent) !== 0) {
        throw new Error(`failed to init ${dependency.id}`);
      }
      if (run('git', ['remote', 'add', 'origin', source], dest) !== 0) {
        throw new Error(`failed to add remote for ${dependency.id}`);
      }
      if (run('git', ['fetch', '--quiet', '--depth', '1', 'origin', commit], dest) !== 0) {
        throw new Error(`failed to fetch ${dependency.id} @ ${commit}`);
      }
      if (run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], dest) !== 0) {
        throw new Error(`failed to check out ${dependency.id} @ ${commit}`);
      }
      console.log(`[ci-sim] sibling ${dependency.id} @ ${commit.slice(0, 12)}`);
    }
    if (skipped.length > 0) {
      console.log(`[ci-sim] skipped missing local siblings: ${skipped.join(', ')}`);
    }

    const frozenInstall = run('pnpm', ['install', '--frozen-lockfile'], checkout, process.platform === 'win32');
    if (frozenInstall !== 0) {
      // Cargo-only repositories may not have a pnpm workspace, and the
      // rehearsal step may not need node_modules at all. Treat a failed frozen
      // install as a warning here; the requested step still decides whether it
      // actually needs the node tree.
      console.warn('[ci-sim] pnpm frozen install failed; continuing (step may not need node_modules)');
    }

    console.log(`[ci-sim] running: ${steps}`);
    const isScript = typeof packageJson?.scripts?.[steps] === 'string';
    const status = isScript
      ? run('pnpm', ['run', steps], checkout, process.platform === 'win32')
      : run('node', [steps], checkout);
    if (status !== 0) {
      failed = true;
      console.error(`[ci-sim] FAILED: ${steps} exited ${status}`);
      process.exitCode = status;
    } else {
      console.log(`[ci-sim] PASSED: ${steps}`);
    }
  } catch (error) {
    failed = true;
    console.error(`[ci-sim] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    if (failed) {
      console.log(`[ci-sim] tree kept for inspection at ${parent}`);
    } else {
      rmSync(parent, { recursive: true, force: true });
      console.log('[ci-sim] rehearsal tree removed');
    }
  }
}

main();
