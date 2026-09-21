#!/usr/bin/env node

/**
 * Browser runtime-env standard checker (BROWSER_RUNTIME_ENV_SPEC.md).
 *
 * Verifies for one application repository:
 *  1. The workspace `@sdkwork/sdk-common` carries the framework fixes: the
 *     `SDKWORK_RUNTIME_ENV` browser bridge in `readRuntimeEnv` and the
 *     relative-base same-origin passthrough in `resolveBaseUrl`.
 *  2. Browser surfaces (`apps/<app>/vite.config.ts`) import the canonical
 *     runtime env tooling from `sdkwork-specs/tools/` directly or through a
 *     repository contract library that re-exports it: the dev-document
 *     builders (`browser-runtime-env.mjs`) or the shared Vite integration
 *     factory (`browser-runtime-env-vite.mjs`, APP_RUNTIME_ENV_SPEC.md §6).
 *  3. No browser app carries a checked-in `public/runtime-env.json` (deploy
 *     artifacts are materialized per build and would poison the dev server).
 *
 * Usage: node tools/check-browser-runtime-env-standard.mjs --root <repo>
 * Exit 0 on compliance, 1 with one line per violation.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function listBrowserSurfaceConfigs(repoRoot) {
  const appsDir = path.join(repoRoot, 'apps');
  if (!fs.existsSync(appsDir)) return [];
  return fs.readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsDir, entry.name, 'vite.config.ts'))
    .filter((filePath) => fs.existsSync(filePath));
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { root: { type: 'string' } },
  });
  const repoRoot = path.resolve(values.root ?? process.cwd());
  const failures = [];
  const notes = [];

  // 1. Framework fixes present in the resolved @sdkwork/sdk-common.
  const sdkCommonCandidates = [
    path.join(repoRoot, 'node_modules', '@sdkwork', 'sdk-common', 'src', 'utils', 'url.ts'),
    path.join(repoRoot, 'node_modules', '@sdkwork', 'sdk-common', 'src', 'utils', 'url.js'),
  ];
  const sdkCommonSource = sdkCommonCandidates.map(readIfExists).find(Boolean);
  if (!sdkCommonSource) {
    failures.push('@sdkwork/sdk-common is not resolvable from the repository root (expected node_modules/@sdkwork/sdk-common/src/utils/url.{ts,js}).');
  } else {
    if (!sdkCommonSource.includes('SDKWORK_RUNTIME_ENV')) {
      failures.push('@sdkwork/sdk-common readRuntimeEnv does not read the SDKWORK_RUNTIME_ENV browser bridge (BROWSER_RUNTIME_ENV_SPEC.md section 4).');
    }
    if (!sdkCommonSource.includes("'same-origin-relative'")) {
      failures.push("@sdkwork/sdk-common resolveBaseUrl lacks the relative-base 'same-origin-relative' passthrough (BROWSER_RUNTIME_ENV_SPEC.md section 5).");
    }
  }

  // 2. Canonical tool consumption by browser surfaces (directly or through a
  //    repository contract library), OR transport-style adoption through the
  //    canonical client-env materializer (APP_RUNTIME_ENV_SPEC.md §3): a
  //    repository declaring `etc/client-env.materialization.json` surfaces
  //    (vite/flutter/mini-program) materializes its base URLs from the same
  //    canonical matrix and resolves them at runtime through
  //    @sdkwork/sdk-common resolveBaseUrl (ENVIRONMENT_SPEC.md §6.3) —
  //    compliance for those repositories is owned by
  //    `tools/materialize-client-env.mjs --check` and
  //    `tools/check-base-url-resolution.mjs`, not by a dev-document import.
  const configPaths = listBrowserSurfaceConfigs(repoRoot);
  const surfaceSources = configPaths
    .map((filePath) => ({ filePath, content: fs.readFileSync(filePath, 'utf8') }));
  const canonicalToolPattern = /browser-runtime-env(?:-vite)?\.mjs/u;
  const contractLibDir = path.join(repoRoot, 'scripts', 'lib');
  const contractLibSource = fs.existsSync(contractLibDir)
    ? fs.readdirSync(contractLibDir)
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => readIfExists(path.join(contractLibDir, name)))
      .filter((content) => content && canonicalToolPattern.test(content))
    : [];
  const materializationConfig = readIfExists(
    path.join(repoRoot, 'etc', 'client-env.materialization.json'),
  );
  const materializerSurfaces = (() => {
    if (!materializationConfig) return [];
    try {
      const config = JSON.parse(materializationConfig);
      if (config.schemaVersion !== 1 || config.kind !== 'sdkwork.client-env-materialization') {
        return [];
      }
      return (config.surfaces ?? []).filter((surface) => surface?.format && surface.format !== 'none');
    } catch {
      return [];
    }
  })();
  if (contractLibSource.length === 0) {
    const directSurface = surfaceSources.some(({ content }) => canonicalToolPattern.test(content));
    if (!directSurface && materializerSurfaces.length === 0) {
      failures.push('No browser surface or scripts/lib contract library imports the canonical runtime env tooling (sdkwork-specs/tools/browser-runtime-env.mjs or browser-runtime-env-vite.mjs), and no etc/client-env.materialization.json transport surfaces are declared.');
    } else if (directSurface) {
      notes.push('browser surfaces import the canonical runtime env tooling directly.');
    } else {
      notes.push(`transport-style adoption through etc/client-env.materialization.json (${materializerSurfaces.length} surface(s)); dev runtime documents remain the recommended browser shape (BROWSER_RUNTIME_ENV_SPEC.md section 2).`);
    }
  } else {
    notes.push(`contract library re-exports the canonical runtime env tooling (${contractLibSource.length} module(s)).`);
  }
  if (configPaths.length === 0) {
    notes.push('no apps/*/vite.config.ts surfaces found; surface checks skipped.');
  }

  // 3. public/runtime-env.json is a per-build artifact: it must be
  //    git-ignored, and any app that keeps one on disk must shadow it in dev
  //    through a serve-only runtime-env middleware (configureServer).
  const gitignore = readIfExists(path.join(repoRoot, '.gitignore')) ?? '';
  const gitignoreCovers = /public\/runtime-env\.json/u.test(gitignore);
  const appsDir = path.join(repoRoot, 'apps');
  if (fs.existsSync(appsDir)) {
    for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const artifact = path.join(appsDir, entry.name, 'public', 'runtime-env.json');
      if (!fs.existsSync(artifact)) continue;
      if (!gitignoreCovers) {
        failures.push(`${path.relative(repoRoot, artifact)} exists but the repository .gitignore does not cover public/runtime-env.json (BROWSER_RUNTIME_ENV_SPEC.md section 3).`);
        continue;
      }
      const viteConfig = readIfExists(path.join(appsDir, entry.name, 'vite.config.ts')) ?? '';
      // The dev shadow is either an inline configureServer middleware or the
      // shared integration factory (APP_RUNTIME_ENV_SPEC.md §6,
      // tools/browser-runtime-env-vite.mjs).
      const devShadowed = (viteConfig.includes('configureServer') && /runtime-env/iu.test(viteConfig))
        || viteConfig.includes('browser-runtime-env-vite.mjs');
      if (!devShadowed) {
        failures.push(`${path.relative(repoRoot, artifact)} exists but ${entry.name}/vite.config.ts has no serve-only runtime-env middleware; a stale deploy-time document would poison the dev server (BROWSER_RUNTIME_ENV_SPEC.md sections 2-3).`);
      }
    }
  }

  for (const note of notes) {
    process.stdout.write(`[browser-runtime-env] ${note}\n`);
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`[browser-runtime-env] FAIL: ${failure}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`[browser-runtime-env] standard ok: ${repoRoot}\n`);
}

main();
