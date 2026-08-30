#!/usr/bin/env node
/**
 * Validates sdkwork.workflow.json dependency list completeness against the
 * repository's native build-tool workspace sibling references.
 *
 * DEPENDENCY_MANAGEMENT_SPEC.md §4: every sibling SDKWork repository
 * referenced by the consuming workspace root (Cargo `path = "../sdkwork-*"`,
 * `pnpm-workspace.yaml` `../sdkwork-*` members, pubspec `dependency_overrides`
 * paths) MUST have a matching `sdkwork.workflow.json` `dependencies[]` entry,
 * so CI/release checkouts materialize the same `../<id>` layout as local
 * development.
 *
 * Usage:
 *   node tools/check-dependency-list-completeness.mjs --root <repository-root>
 *   node tools/check-dependency-list-completeness.mjs --workspace <sdkwork-space-root>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIBLING_RE = /(?:path\s*=\s*|packages:\s*[\s\S]*?)(?:"|')((?:\.\.\/)+)sdkwork-([a-z0-9][a-z0-9-]*)(?:\/|"|')/g;

function usage() {
  return [
    'Usage:',
    '  node tools/check-dependency-list-completeness.mjs --root <repository-root>',
    '  node tools/check-dependency-list-completeness.mjs --workspace <sdkwork-space-root>',
    '',
    'Checks that every sibling sdkwork-* repository referenced by the native',
    'build-tool workspace (Cargo path / pnpm-workspace member / pubspec path)',
    'has a matching sdkwork.workflow.json dependencies[] entry.',
  ].join('\n');
}

function fail(message, details = []) {
  console.error(`dependency list completeness failed: ${message}`);
  for (const detail of details.slice(0, 300)) {
    console.error(`- ${detail}`);
  }
  if (details.length > 300) {
    console.error(`- ... and ${details.length - 300} more`);
  }
  process.exit(1);
}

function collectCargoSiblings(repoRoot) {
  const siblings = new Set();
  // Prefer the real resolution closure: cargo metadata lists every package
  // consumed by the workspace, including transitive path dependencies into
  // sibling repositories. Fall back to scanning Cargo.toml files when the
  // cargo toolchain is unavailable (e.g. minimal CI containers).
  const metadata = cargoMetadata(repoRoot);
  if (metadata) {
    const repoName = path.basename(repoRoot);
    for (const pkg of metadata.packages ?? []) {
      if (typeof pkg?.manifest_path !== 'string') continue;
      const normalized = pkg.manifest_path.split('\\').join('/');
      // manifest_path is absolute; every segment that names a sibling
      // repository under the workspace root is a consumed sibling.
      for (const match of normalized.matchAll(/(?:^|\/)(sdkwork-[a-z0-9][a-z0-9-]*)(?=\/)/g)) {
        const id = match[1];
        if (id === repoName) continue;
        if (fs.existsSync(path.join(repoRoot, '..', id)) && fs.existsSync(path.join(repoRoot, 'crates', id))) {
          continue; // internal crate directory
        }
        if (fs.existsSync(path.join(repoRoot, '..', id))) {
          siblings.add(id);
        }
      }
    }
    return siblings;
  }
  const files = [];
  const rootCargo = path.join(repoRoot, 'Cargo.toml');
  if (fs.existsSync(rootCargo)) {
    files.push(rootCargo);
  }
  const cratesDir = path.join(repoRoot, 'crates');
  if (fs.existsSync(cratesDir)) {
    for (const entry of fs.readdirSync(cratesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const memberCargo = path.join(cratesDir, entry.name, 'Cargo.toml');
        if (fs.existsSync(memberCargo)) {
          files.push(memberCargo);
        }
      }
    }
  }
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/path\s*=\s*"((?:\.\.\/)+)sdkwork-([a-z0-9][a-z0-9-]*)/g)) {
      if (match[2] === undefined) {
        continue;
      }
      const id = `sdkwork-${match[2]}`;
      // References like `../sdkwork-api-terminal-assembly` from a member crate
      // resolve inside the repository's own crates/ directory; they are not
      // external sibling repositories.
      if (fs.existsSync(path.join(repoRoot, 'crates', id))) {
        continue;
      }
      siblings.add(id);
    }
  }
  return siblings;
}

function cargoMetadata(repoRoot) {
  if (!fs.existsSync(path.join(repoRoot, 'Cargo.toml'))) {
    return null;
  }
  const result = spawnSync('cargo', ['metadata', '--format-version', '1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    return null;
  }
  try {
    return JSON.parse(String(result.stdout ?? ''));
  } catch {
    return null;
  }
}

function collectPnpmSiblings(repoRoot) {
  const siblings = new Set();
  const workspaceFile = path.join(repoRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspaceFile)) {
    return siblings;
  }
  const source = fs.readFileSync(workspaceFile, 'utf8');
  for (const match of source.matchAll(/("|')((?:\.\.\/)+)sdkwork-([a-z0-9][a-z0-9-]*)(\/|"|')/g)) {
    if (match[3] !== undefined) {
      siblings.add(`sdkwork-${match[3]}`);
    }
  }
  return siblings;
}

function collectPubspecSiblings(repoRoot) {
  const siblings = new Set();
  const pubspec = path.join(repoRoot, 'pubspec.yaml');
  if (!fs.existsSync(pubspec)) {
    return siblings;
  }
  const source = fs.readFileSync(pubspec, 'utf8');
  for (const match of source.matchAll(/(?:path\s*:\s*)("|')((?:\.\.\/)+)sdkwork-([a-z0-9][a-z0-9-]*)(\/|"|')/g)) {
    if (match[3] !== undefined) {
      siblings.add(`sdkwork-${match[3]}`);
    }
  }
  return siblings;
}

function workflowDependencyIds(repoRoot) {
  const workflowFile = path.join(repoRoot, 'sdkwork.workflow.json');
  if (!fs.existsSync(workflowFile)) {
    return new Set();
  }
  const workflow = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
  const ids = new Set();
  for (const dependency of workflow.dependencies ?? []) {
    if (typeof dependency?.id === 'string' && dependency.id.trim()) {
      ids.add(dependency.id);
    }
  }
  return ids;
}

function checkRepository(repoRoot) {
  const repoName = path.basename(repoRoot);
  const hasWorkflow = fs.existsSync(path.join(repoRoot, 'sdkwork.workflow.json'));
  if (!hasWorkflow) {
    // Repositories without a release/package workflow do not declare release
    // dependencies; completeness applies only when packaging or release
    // checks out siblings (DEPENDENCY_MANAGEMENT_SPEC.md §4).
    return { repoName, missing: [], hasWorkflow: false };
  }
  const referenced = new Set([
    ...collectCargoSiblings(repoRoot),
    ...collectPnpmSiblings(repoRoot),
    ...collectPubspecSiblings(repoRoot),
  ]);
  if (referenced.size === 0) {
    return { repoName, missing: [], hasWorkflow: true };
  }
  const declared = workflowDependencyIds(repoRoot);
  const missing = [...referenced].filter((id) => !declared.has(id)).sort();
  return { repoName, missing, hasWorkflow: true };
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      workspace: { type: 'string' },
    },
  });
  if (!values.root && !values.workspace) {
    console.error(usage());
    process.exit(2);
  }
  if (values.root && values.workspace) {
    console.error(usage());
    process.exit(2);
  }

  const repoRoots = values.root
    ? [path.resolve(values.root)]
    : fs.readdirSync(values.workspace, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^sdkwork-[a-z0-9-]+$/.test(entry.name))
        .map((entry) => path.join(values.workspace, entry.name));

  const failures = [];
  const missingAny = [];
  for (const repoRoot of repoRoots.sort()) {
    const result = checkRepository(repoRoot);
    if (result.missing.length > 0) {
      failures.push(`${result.repoName}: missing dependencies[] entries: ${result.missing.join(', ')}`);
      missingAny.push(result.repoName);
    }
  }

  if (failures.length > 0) {
    fail(`workspace sibling references without sdkwork.workflow.json dependencies[] entries`, failures);
  }
  console.log(`[dependency-list-completeness] ok: ${repoRoots.length} repositories checked`);
}

main();
