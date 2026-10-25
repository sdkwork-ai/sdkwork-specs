#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listClientAppRoots, hasClientAppSurfaceDirectories } from './lib/app-composition.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/u, ''));
}

const missingCheck = [];
const missingWire = [];
const missingBackendSdkDeps = [];

for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) continue;
  const repoRoot = path.join(workspace, entry.name);
  const pkgPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = readJson(pkgPath);
  const hasApps = fs.existsSync(path.join(repoRoot, 'apps'));
  const hasClient = hasApps || listClientAppRoots(repoRoot).length > 0;

  if (hasClient && !pkg.scripts?.['check:app-composition']) {
    missingCheck.push(entry.name);
  }
  if (pkg.scripts?.['check:app-composition']) {
    for (const scriptName of ['check', 'verify']) {
      if (pkg.scripts[scriptName] && !pkg.scripts[scriptName].includes('check:app-composition')) {
        missingWire.push(`${entry.name}:${scriptName}`);
      }
    }
  }

  const manifestPath = path.join(repoRoot, 'agent.app.config.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  if (!manifest.backend) continue;
  const clientRoots = listClientAppRoots(repoRoot);
  if (clientRoots.length > 0 || hasClientAppSurfaceDirectories(repoRoot)) continue;
  const componentSpecPath = path.join(repoRoot, 'specs/component.spec.json');
  const componentSpec = fs.existsSync(componentSpecPath) ? readJson(componentSpecPath) : null;
  const hasBackendSdkInventory = manifest.schemaVersion >= 3
    ? Array.isArray(componentSpec?.contracts?.sdkDependencies)
    : Array.isArray(manifest.sdkDependencies);
  if (!hasBackendSdkInventory) {
    missingBackendSdkDeps.push(entry.name);
  }
}

console.log('missing check:app-composition:', missingCheck.length, missingCheck.join(', ') || '(none)');
console.log('missing wire in check/verify:', missingWire.length, missingWire.join(', ') || '(none)');
console.log('backend-only missing sdkDependencies:', missingBackendSdkDeps.length, missingBackendSdkDeps.join(', ') || '(none)');
