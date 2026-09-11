#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { collectLegacyProviderSessionIdentity } from './lib/provider-session-identity.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: path.resolve(SPECS_ROOT, '..') },
  },
});

const workspace = path.resolve(values.workspace);

// Fail closed. Walking a path that does not exist yields zero violations, so without this
// guard a misspelled or nonexistent root produced "check passed" with exit 0 — the gate
// reported success while examining nothing.
if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
  console.error(`provider Session identity terminology check cannot run: not a directory: ${workspace}`);
  process.exit(2);
}

const violations = collectLegacyProviderSessionIdentity(workspace);
if (violations.length === 0) {
  console.log('provider Session identity terminology check passed');
  process.exit(0);
}

console.error(`provider Session identity terminology check failed (${violations.length} violation(s)):`);
for (const violation of violations.slice(0, 200)) {
  const location = violation.line > 0 ? `:${violation.line}` : '';
  console.error(`- ${path.relative(workspace, violation.filePath)}${location}: ${violation.legacy}`);
}
if (violations.length > 200) {
  console.error(`... and ${violations.length - 200} more`);
}
process.exit(1);
