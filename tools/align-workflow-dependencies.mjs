#!/usr/bin/env node
/**
 * Align sdkwork.workflow.json dependencies[] with native build-tool sibling
 * references (DEPENDENCY_MANAGEMENT_SPEC.md §4 completeness rule).
 *
 * For every repository under --workspace that has a sdkwork.workflow.json,
 * adds a dependencies[] entry for each sibling sdkwork-* repository that the
 * Cargo workspace / pnpm workspace / pubspec dependency_overrides reference
 * but the workflow does not yet declare. Entries only reference repositories
 * that exist as local siblings with a GitHub remote; unresolved references are
 * reported as warnings and left untouched.
 *
 * Usage:
 *   node tools/align-workflow-dependencies.mjs --workspace <sdkwork-space-root> [--apply]
 *   Without --apply the tool prints the plan without writing files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

function usage() {
  return [
    'Usage:',
    '  node tools/align-workflow-dependencies.mjs --workspace <root> [--apply]',
    '',
    '  --apply   write workflow.json files (default: dry-run plan only).',
  ].join('\n');
}

function gitOutput(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) return null;
  return String(result.stdout ?? '').trim();
}

function resolveRepository(repoRoot, id) {
  const sibling = path.join(repoRoot, '..', id);
  if (!fs.existsSync(path.join(sibling, '.git'))) {
    return null;
  }
  const url = gitOutput(sibling, ['remote', 'get-url', 'origin']);
  if (!url) {
    return null;
  }
  const match = /github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);
  if (!match) {
    return null;
  }
  return match[1];
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

function collectSiblingIds(repoRoot) {
  const ids = new Set();
  // Prefer the real resolution closure from cargo metadata (transitive path
  // dependencies included); fall back to scanning manifests when cargo is not
  // available.
  const metadata = cargoMetadata(repoRoot);
  if (metadata) {
    const repoName = path.basename(repoRoot);
    for (const pkg of metadata.packages ?? []) {
      if (typeof pkg?.manifest_path !== 'string') continue;
      const normalized = pkg.manifest_path.split('\\').join('/');
      for (const match of normalized.matchAll(/(?:^|\/)(sdkwork-[a-z0-9][a-z0-9-]*)(?=\/)/g)) {
        const id = match[1];
        if (id === repoName) continue;
        if (fs.existsSync(path.join(repoRoot, 'crates', id))) continue; // internal crate
        if (fs.existsSync(path.join(repoRoot, '..', id))) {
          ids.add(id);
        }
      }
    }
    return ids;
  }
  const files = [];
  if (fs.existsSync(path.join(repoRoot, 'Cargo.toml'))) {
    files.push(path.join(repoRoot, 'Cargo.toml'));
  }
  const cratesDir = path.join(repoRoot, 'crates');
  if (fs.existsSync(cratesDir)) {
    for (const entry of fs.readdirSync(cratesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const member = path.join(cratesDir, entry.name, 'Cargo.toml');
        if (fs.existsSync(member)) files.push(member);
      }
    }
  }
  const pnpmWorkspace = path.join(repoRoot, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmWorkspace)) files.push(pnpmWorkspace);
  const pubspec = path.join(repoRoot, 'pubspec.yaml');
  if (fs.existsSync(pubspec)) files.push(pubspec);

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:path\s*=\s*|path\s*:\s*|"|')((?:\.\.\/)+)sdkwork-([a-z0-9][a-z0-9-]*)/g)) {
      if (!match[2]) continue;
      const id = `sdkwork-${match[2]}`;
      // `../sdkwork-*` from a member crate that resolves inside this
      // repository's own crates/ directory is not an external sibling.
      if (fs.existsSync(path.join(repoRoot, 'crates', id))) continue;
      ids.add(id);
    }
  }
  return ids;
}

function main() {
  const { values } = parseArgs({ options: { workspace: { type: 'string' }, apply: { type: 'boolean' } } });
  if (!values.workspace) {
    console.error(usage());
    process.exit(2);
  }
  const workspace = path.resolve(values.workspace);
  const repos = fs.readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^sdkwork-[a-z0-9-]+$/.test(entry.name))
    .map((entry) => path.join(workspace, entry.name))
    .sort();

  const plan = [];
  const warnings = [];
  let changed = 0;
  for (const repoRoot of repos) {
    const workflowFile = path.join(repoRoot, 'sdkwork.workflow.json');
    if (!fs.existsSync(workflowFile)) continue;
    const repoName = path.basename(repoRoot);
    const referenced = collectSiblingIds(repoRoot);
    if (referenced.size === 0) continue;
    const workflow = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
    const declared = new Set((workflow.dependencies ?? []).map((d) => d.id));
    const missing = [...referenced].filter((id) => !declared.has(id)).sort();
    if (missing.length === 0) continue;

    const additions = [];
    for (const id of missing) {
      const repository = resolveRepository(repoRoot, id);
      if (!repository) {
        warnings.push(`${repoName}: skip ${id} (no local sibling with GitHub remote)`);
        continue;
      }
      const refInput = `${id.toUpperCase().replace(/-/g, '_')}_REF`;
      additions.push({ id, repository, refInput, tokenSecret: 'SDKWORK_RELEASE_TOKEN' });
    }
    if (additions.length === 0) continue;

    plan.push({ repoName, additions });
    if (values.apply) {
      workflow.dependencies = [...(workflow.dependencies ?? []), ...additions];
      workflow.dependencies.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      fs.writeFileSync(workflowFile, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
      changed += 1;
      console.log(`[align] ${repoName}: +${additions.length} dependencies`);
    }
  }

  if (!values.apply) {
    for (const item of plan) {
      console.log(`[plan] ${item.repoName}: +${item.additions.map((a) => a.id).join(', ')}`);
    }
  }
  for (const warning of warnings) {
    console.warn(`[warn] ${warning}`);
  }
  console.log(`[align] ${values.apply ? `applied to ${changed} repositories` : `dry-run: ${plan.length} repositories need changes`}`);
}

main();
