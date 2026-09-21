#!/usr/bin/env node
/**
 * Validates SDKWork HTTP operation pattern alignment.
 * See API_SPEC.md section 15.4.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  classifyOpenApiOperationPatterns,
} from './lib/api-operation-patterns.mjs';
import {
  openApiAuthorityEntries,
  walkOpenApiFiles,
} from './lib/http-response-envelope-patterns.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return [
    'Usage:',
    '  node tools/check-api-operation-patterns.mjs [--root <specs-or-repo>]',
    '  node tools/check-api-operation-patterns.mjs --workspace <sdkwork-space-root>',
    '',
    'Modes:',
    '  --root .            scan normative specs and optional repo OpenAPI authorities',
    '  --workspace ..      scan all child repositories under the workspace',
  ].join('\n');
}

function fail(message, details = []) {
  console.error(`api operation patterns failed: ${message}`);
  for (const detail of details.slice(0, 200)) {
    console.error(`- ${detail}`);
  }
  if (details.length > 200) {
    console.error(`- ... and ${details.length - 200} more`);
  }
  process.exit(1);
}

function scanSpecsNormative(root) {
  const issues = [];
  const apiSpec = path.join(root, 'API_SPEC.md');
  if (!fs.existsSync(apiSpec)) {
    issues.push('API_SPEC.md missing');
    return issues;
  }
  const text = fs.readFileSync(apiSpec, 'utf8');
  for (const required of [
    '### 15.4 Operation Input And Output Contract Matrix',
    '### 13.2 Monetary Amount And Unit Contract',
    '### 13.6 Int64 Wire String Standard',
    'x-sdkwork-money-unit',
    'Create',
    'Replace',
    'Patch',
    'Command',
    'Bulk command',
    'Idempotency-Key',
    'If-Match',
  ]) {
    if (!text.includes(required)) {
      issues.push(`API_SPEC.md missing operation-pattern standard marker: ${required}`);
    }
  }
  return issues;
}

function scanOpenApiAuthorities(root) {
  const issues = [];
  const files = openApiAuthorityEntries(walkOpenApiFiles(root));
  for (const { file, repo, surface } of files) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file).replace(/\\/g, '/');
    for (const issue of classifyOpenApiOperationPatterns(text)) {
      issues.push(`${repo}/${surface} (${rel}): ${issue.kind} - ${issue.detail}`);
    }
  }
  return issues;
}

function scanWorkspace(workspaceRoot) {
  const issues = [];
  if (!fs.existsSync(workspaceRoot)) {
    return [`workspace root not found: ${workspaceRoot}`];
  }
  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }
    issues.push(...scanOpenApiAuthorities(path.join(workspaceRoot, entry.name)));
  }
  return issues;
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: SPECS_ROOT },
      workspace: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const root = path.resolve(values.root);
  const issues = [...scanSpecsNormative(SPECS_ROOT)];
  if (values.workspace) {
    issues.push(...scanWorkspace(path.resolve(values.workspace)));
  } else if (root !== SPECS_ROOT) {
    issues.push(...scanOpenApiAuthorities(root));
  }
  if (issues.length > 0) {
    fail('operation pattern violations found', issues);
  }
  console.log('api operation patterns check passed');
}

main();
