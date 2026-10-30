#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  auditWorkspaceBootstrapLifecycle,
  validateIamBootstrapAuthProfileSpec,
  validateRepositoryBootstrapLifecycle,
  validateWorkspaceBootstrapInfrastructure,
} from './lib/bootstrap-access-token-lifecycle-standard.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function runBootstrapAccessTokenLifecycleCheck(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string' },
      workspace: { type: 'string' },
      report: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    return {
      help: [
        'Usage:',
        '  node tools/check-bootstrap-access-token-lifecycle-standard.mjs --root <repository-root>',
        '  node tools/check-bootstrap-access-token-lifecycle-standard.mjs --workspace <workspace-root> [--report]',
      ].join('\n'),
      issues: [],
    };
  }
  if (values.root && values.workspace) {
    return { issues: ['use either --root or --workspace, not both'] };
  }

  if (values.workspace) {
    const workspaceRoot = path.resolve(values.workspace);
    const audit = auditWorkspaceBootstrapLifecycle(workspaceRoot);
    if (values.report) {
      const rows = audit.repositories.map((repository) => ({
        repository: repository.repository,
        git: repository.isGitRepository ? 'yes' : 'no',
        token: repository.requiresBootstrapToken ? 'required' : 'not-required',
        lifecycleOwner: repository.hasLifecycleOwner ? 'yes' : 'no',
        gitignore: repository.hasEnvironmentScopedArtifact ? 'yes' : 'no',
        issues: repository.issues.length,
      }));
      return { issues: audit.issues, report: rows };
    }
    return { issues: audit.issues };
  }

  const root = path.resolve(values.root ?? process.cwd());
  const workspaceRoot = path.resolve(root, '..');
  return {
    issues: [
      ...validateIamBootstrapAuthProfileSpec(SPECS_ROOT),
      ...validateWorkspaceBootstrapInfrastructure(workspaceRoot),
      ...validateRepositoryBootstrapLifecycle(root),
    ],
  };
}

function main() {
  const result = runBootstrapAccessTokenLifecycleCheck();
  if (result.help) {
    console.log(result.help);
    return;
  }
  if (result.report) {
    for (const row of result.report) {
      console.log(`${row.issues === 0 ? 'ok' : 'FAIL'} ${row.repository} git=${row.git} token=${row.token} owner=${row.lifecycleOwner} gitignore=${row.gitignore} issues=${row.issues}`);
    }
  }
  if (result.issues.length > 0) {
    console.error('bootstrap access-token lifecycle standard check failed:');
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('bootstrap access-token lifecycle standard check passed');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
