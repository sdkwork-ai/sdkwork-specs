#!/usr/bin/env node
// CLI wrapper for the APPLICATION_GATEWAY_SPEC §2.3 embedded self-loop audit.
// The validation logic lives in tools/lib/embedded-self-loop.mjs so it can be
// unit tested and reused by verify-repo.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateEmbeddedSelfLoop } from './lib/embedded-self-loop.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: path.resolve(SPECS_ROOT, '..') },
    root: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Usage: node tools/check-embedded-self-loop.mjs [--workspace <root>] [--root <repo>]

  --workspace  SDKWork workspace root (default: the parent of sdkwork-specs)
  --root       repository path; narrows reporting but keeps the workspace-wide
               ingress index required by the cross-repository rules`);
  process.exit(0);
}

const WORKSPACE = path.resolve(values.workspace);
const onlyRepo = values.root ? path.basename(path.resolve(values.root)) : null;

const { findings, repositories, profiles } = validateEmbeddedSelfLoop(WORKSPACE, { onlyRepo });

console.log(`Embedded self-loop audit for ${WORKSPACE}`);
console.log(`  repositories: ${repositories}, deployment profiles: ${profiles}`);
if (findings.length > 0) {
  console.error(`  violations: ${findings.length}`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log('Embedded self-loop audit passed');
