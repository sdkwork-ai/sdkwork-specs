#!/usr/bin/env node
// Materialize one module's deployments/webserver from specs/topology.spec.json.
//
// Usage:
//   node tools/materialize-webserver-module.mjs --root <module-root> [--dry-run]
//
// Why a dedicated entrypoint instead of `aligner && renderer`:
// `align-webserver-workspace.mjs` validates sidecars it does NOT write, so a
// stale sidecar makes step 1 exit non-zero and a shell `&&` chain breaks before
// step 2 can ever refresh it. The two steps must run unconditionally in order.
//
// The aligner is a pure CLI script (no exports, calls process.exit), so it is
// spawned as a child process; the renderer exposes a function, so it is imported.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderModuleNginxSidecars } from './webserver/render-nginx-sidecars.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALIGNER = path.join(HERE, 'align-webserver-workspace.mjs');

const argv = process.argv.slice(2);
const rootIndex = argv.indexOf('--root');
const rootFlag = argv.find((arg) => arg.startsWith('--root='))?.slice('--root='.length)
  ?? (rootIndex >= 0 ? argv[rootIndex + 1] : null);
const dryRun = argv.includes('--dry-run');

if (!rootFlag) {
  console.error('usage: node tools/materialize-webserver-module.mjs --root <module-root> [--dry-run]');
  process.exit(2);
}

const moduleRoot = path.resolve(rootFlag);
console.log(`[materialize] module: ${moduleRoot}${dryRun ? ' (dry-run)' : ''}`);

// Step 1 — TOML / snippets / README / app-roots.
const args = [ALIGNER, '--root', moduleRoot];
if (dryRun) args.push('--dry-run');
const step1 = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: HERE });
if (step1.status !== 0 && !dryRun) {
  // Expected whenever sidecars are stale: the aligner validates sidecars it does
  // not write. Step 2 is what refreshes them, so keep going.
  console.log(`[materialize] step 1 exited ${step1.status} (stale sidecars); continuing to step 2`);
}
if (step1.error) {
  console.error(`[materialize] step 1 failed to spawn: ${step1.error.message}`);
  process.exit(1);
}

if (dryRun) {
  console.log('[materialize] dry-run: stopping before sidecar render');
  process.exit(0);
}

// Step 2 — sidecars + validation. Runs even when step 1 was non-zero.
const rendered = renderModuleNginxSidecars(moduleRoot, { validate: true });
if (rendered?.skipped) {
  console.log(`[materialize] sidecar render skipped: ${rendered.reason}`);
  process.exit(1);
}

console.log('[materialize] done');
