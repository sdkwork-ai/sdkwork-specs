#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  buildWorkspaceCatalog,
  buildWorkspacePackages,
  parsePnpmWorkspaceCatalog,
  parsePnpmWorkspaceSettings,
  parsePnpmWorkspacePackages,
  renderPnpmWorkspace,
  isSiblingPackageEntry,
} from './lib/workspace-registry.mjs';

function parseArgs(argv) {
  const args = { repo: null, root: null, dryRun: false, check: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') args.repo = argv[++i];
    else if (arg === '--root') args.root = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--check') args.check = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`Usage: node tools/sync-workspace.mjs --repo <repo-name> [--root <path>] [--dry-run] [--check]

Synchronize repo-root pnpm-workspace.yaml sibling packages from sdkwork-specs/workspace registry.
Local packages (non ../ entries) are preserved.

--check  Fail when pnpm-workspace.yaml would change (idempotent materialization gate).`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.repo) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const repoRoot = path.resolve(args.root ?? path.join(process.cwd(), '..', args.repo));
  const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspacePath)) {
    console.error(`Missing pnpm-workspace.yaml at ${workspacePath}`);
    process.exit(1);
  }

  const existing = fs.readFileSync(workspacePath, 'utf8');
  const existingPackages = parsePnpmWorkspacePackages(existing);
  const localPackages = existingPackages.filter((entry) => !isSiblingPackageEntry(entry));
  const existingCatalog = parsePnpmWorkspaceCatalog(existing);
  // Everything besides packages/catalog is repo-owned policy; hand it back
  // to the renderer verbatim so sync never deletes it.
  const settings = parsePnpmWorkspaceSettings(existing);

  const packages = buildWorkspacePackages(localPackages, args.repo);
  const catalog = buildWorkspaceCatalog(existingCatalog, args.repo);
  const rendered = renderPnpmWorkspace({ packages, catalog, settings });

  if (args.check) {
    const currentPackages = [...existingPackages].sort();
    const nextPackages = [...packages].sort();
    const packagesChanged = JSON.stringify(currentPackages) !== JSON.stringify(nextPackages);
    if (packagesChanged) {
      console.error(`sync-workspace check failed for ${workspacePath}`);
      console.error('  packages: drift from sdkwork-specs/workspace registry');
      console.error(`  run: node ../sdkwork-specs/tools/sync-workspace.mjs --repo ${args.repo} --root ${path.relative(process.cwd(), repoRoot) || '.'}`);
      process.exit(1);
    }
    console.log(`sync-workspace check ok (${workspacePath})`);
    return;
  }

  if (args.dryRun) {
    process.stdout.write(rendered);
    return;
  }

  fs.writeFileSync(workspacePath, rendered);
  console.log(`Updated ${workspacePath}`);
}

main();
