#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateBackendModuleCallBoundary } from './lib/backend-module-call-boundary.mjs';
import { collectWorkspaceValidationIssues } from './lib/workspace-check-runner.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return [
    'Usage:',
    '  node tools/check-backend-module-call-boundary.mjs [--root <repo>]',
    '  node tools/check-backend-module-call-boundary.mjs --workspace <sdkwork-space-root>',
    '',
    'Fails when Rust backend code addresses a sibling SDKWork module through an',
    'environment-provided HTTP endpoint instead of an in-process dependency',
    '(MODULE_SPEC.md §4.2).',
    '',
    'Deliberate exceptions live in specs/backend-module-call-boundary.allow.json:',
    '  { "allow": [ { "file": "crates/x/src/http_adapter.rs", "envVar": "SDKWORK_Y_BACKEND_API_ORIGIN",',
    '                "reason": "opt-in split deployment; defaults to in-process" } ] }',
  ].join('\n');
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      workspace: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const issues = values.workspace
    ? collectWorkspaceValidationIssues(
      path.resolve(values.workspace),
      (repoRoot) => validateBackendModuleCallBoundary(repoRoot).map((issue) => issue.message),
    )
    : validateBackendModuleCallBoundary(path.resolve(values.root ?? SPECS_ROOT))
      .map((issue) => issue.message);

  if (issues.length > 0) {
    console.error('backend module call boundary check failed: cross-module HTTP calls found');
    for (const issue of issues.slice(0, 200)) {
      console.error(`- ${issue}`);
    }
    if (issues.length > 200) {
      console.error(`- ... and ${issues.length - 200} more`);
    }
    process.exit(1);
  }

  console.log('backend module call boundary check passed');
}

main();
