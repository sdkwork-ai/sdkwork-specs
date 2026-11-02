#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAppComposition, listClientAppRoots } from './lib/app-composition.mjs';
import { resolveComposition, validateCompositionResolution } from './lib/composition-resolver.mjs';
import { classifyPermissionComposition } from './lib/permission-composition.mjs';
import { classifyRouteRegistry } from './lib/route-registry.mjs';
import { validateComponentPortBindings } from './lib/component-port-bindings.mjs';
import { validateFrontendComposition } from './lib/frontend-composition.mjs';
import { validateRustBackendComposition } from './lib/rust-backend-composition.mjs';
import { validateApiAssemblyIntegrationClosure } from './lib/api-assembly-integration-closure.mjs';
import { validateI18nStandard } from './check-i18n-standard.mjs';
import { validateApplicationLayering } from './check-application-layering.mjs';
import { validateFlutterTlsTrust } from './check-flutter-tls-trust.mjs';
import { specsRoot } from './lib/workspace-registry.mjs';
import { validateWorkspaceMemberProtocol } from './lib/workspace-member-protocol.mjs';
import { validateWorkspaceLayout } from './lib/workspace-layout.mjs';

const SPECS_ROOT = specsRoot();

function parseArgs(argv) {
  const args = { root: process.cwd(), specsOnly: false, strictImportClosure: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = path.resolve(argv[++i]);
    else if (arg === '--specs-only') args.specsOnly = true;
    else if (arg === '--strict-import-closure') args.strictImportClosure = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`Usage: node tools/verify-repo.mjs [--root <repo-path>] [--specs-only] [--strict-import-closure]

Verify native composition architecture alignment for a repository.
Use --strict-import-closure to enforce package.json import closure on all workspace members.`);
}

function verifySpecsGovernance() {
  const issues = [];
  const required = [
    'APP_COMPOSITION_SPEC.md',
    'APP_INTEGRATION_CONVENTIONS.md',
    'docs/architecture/decisions/ADR-20260629-native-composition-architecture.md',
  ];
  const forbidden = [
    'APP_DEPENDENCY_COMPOSITION_SPEC.md',
    'tools/check-dependency-composition.mjs',
    'tools/align-dependency-composition.mjs',
    'tools/lib/dependency-composition.mjs',
  ];

  for (const rel of required) {
    if (!fs.existsSync(path.join(SPECS_ROOT, rel))) {
      issues.push(`sdkwork-specs missing required file ${rel}`);
    }
  }
  for (const rel of forbidden) {
    if (fs.existsSync(path.join(SPECS_ROOT, rel))) {
      issues.push(`sdkwork-specs forbidden artifact still present: ${rel}`);
    }
  }

  const agentsPath = path.join(SPECS_ROOT, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    const agents = fs.readFileSync(agentsPath, 'utf8');
    if (agents.includes('check-dependency-composition.mjs')) {
      issues.push('sdkwork-specs/AGENTS.md still references check-dependency-composition.mjs');
    }
    if (!agents.includes('verify-repo.mjs')) {
      issues.push('sdkwork-specs/AGENTS.md must reference verify-repo.mjs');
    }
  }

  const normativeHits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full.includes(`${path.sep}docs${path.sep}`)) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (text.includes('dependency.composition.json') && !full.endsWith('APP_COMPOSITION_SPEC.md')) {
        normativeHits.push(path.relative(SPECS_ROOT, full));
      }
    }
  };
  walk(SPECS_ROOT);
  for (const hit of normativeHits) {
    issues.push(`normative spec ${hit} still references dependency.composition.json`);
  }

  if (!fs.existsSync(path.join(SPECS_ROOT, 'tools/sync-workspace.mjs'))) {
    issues.push('sdkwork-specs missing tools/sync-workspace.mjs');
  }

  return issues;
}

function validateCompositionResolver(repoRoot) {
  const issues = [];
  if (listClientAppRoots(repoRoot).length === 0) {
    return issues;
  }

  const resolution = resolveComposition(repoRoot);
  issues.push(...resolution.issues);
  issues.push(...validateCompositionResolution(resolution));
  return issues;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }

  const issues = [];
  const isSpecsRepo = path.resolve(args.root) === path.resolve(SPECS_ROOT);

  if (isSpecsRepo || args.specsOnly) {
    issues.push(...verifySpecsGovernance());
  }

  if (!args.specsOnly) {
    issues.push(...validateWorkspaceLayout(args.root).map((issue) => `${issue.kind}: ${issue.path} - ${issue.detail}`));
    issues.push(...validateAppComposition(args.root, {
      strictImportClosure: args.strictImportClosure,
    }));
    issues.push(...classifyPermissionComposition(args.root));
    issues.push(...classifyRouteRegistry(args.root).map((issue) => `${issue.kind}: ${issue.detail}`));
    issues.push(...validateComponentPortBindings(args.root));
    issues.push(...validateApplicationLayering(args.root));
    issues.push(...validateFlutterTlsTrust(args.root));
    issues.push(...validateFrontendComposition(args.root));
    issues.push(...validateRustBackendComposition(args.root));
    issues.push(...validateApiAssemblyIntegrationClosure(args.root));
    issues.push(...validateI18nStandard(args.root));
    issues.push(...validateWorkspaceMemberProtocol(args.root, {
      repoName: path.basename(args.root),
    }));
    issues.push(...validateCompositionResolver(args.root));
  }

  if (issues.length > 0) {
    console.error('verify-repo failed:');
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }

  console.log(`verify-repo passed for ${args.root}`);
}

main();
