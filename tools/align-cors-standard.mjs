#!/usr/bin/env node

// Aligns CORS origin carriers to CORS_SPEC.md.
//
// The allowlist is a derived artifact: this tool re-materialises it from the
// registered base domains, the module's own topology, and the profile's
// browser-reachable development binds. It also removes retired
// application-scoped allowlist keys.
//
// Usage:
//   node tools/align-cors-standard.mjs --workspace <workspace-root> --check
//   node tools/align-cors-standard.mjs --workspace <workspace-root> --fix
//   node tools/align-cors-standard.mjs --root <module-root> --fix
//   node tools/align-cors-standard.mjs --workspace <root> --module sdkwork-im --fix
//
// `--root <module-root>` aligns exactly one application root, which is the form
// a repository runs from its own checkout.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { auditModule, auditWorkspace, isCanonicalCorsKey } from './cors/scan.mjs';
import { parseEnvDocument, applyEnvUpdates } from './cors/env-file.mjs';
import {
  CORS_SHARED_ORIGINS_ENV_KEY,
  formatOrigins,
  isEnvironmentInvalidOrigin,
  splitOrigins,
} from './cors/registry.mjs';

function parseArgs(argv) {
  const args = { root: null, workspace: null, module: null, check: false, fix: false };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--root') args.root = argv[i + 1];
    else if (flag === '--workspace') args.workspace = argv[i + 1];
    else if (flag === '--module') args.module = argv[i + 1];
    else if (flag === '--check') args.check = true;
    else if (flag === '--fix') args.fix = true;
  }
  return args;
}

const RETIRED = /^SDKWORK_(?!CORS$)[A-Z0-9_]+_ALLOWED_ORIGINS$/u;

const args = parseArgs(process.argv);
if (!args.check && !args.fix) {
  console.error('align-cors-standard: pass --check (dry run) or --fix (write)');
  process.exit(2);
}

const target = path.resolve(args.workspace ?? args.root ?? process.cwd());
const perRepository = args.root !== null && args.workspace === null && args.module === null;

let results;
if (perRepository) {
  const single = auditModule(target);
  // A `--root` that names a workspace still aligns every module beneath it.
  results = single.module === null ? auditWorkspace(target).results : single.results;
} else {
  results = auditWorkspace(target).results;
  if (args.module) results = results.filter((result) => result.module.name === args.module);
}

const eligible = results.filter((result) => result.environment !== null
  && (result.canonical !== null || result.environment));

let changedCarriers = 0;

for (const result of eligible) {
  const { carrier } = result;
  const text = readFileSync(carrier.absolutePath, 'utf8');
  const document = parseEnvDocument(text);

  const updates = new Map();
  const droppedEntries = [];
  for (const key of document.byKey.keys()) {
    if (key === CORS_SHARED_ORIGINS_ENV_KEY) continue;
    if (!RETIRED.test(key)) continue;
    if (key.startsWith('SDKWORK_MODULE_')) continue;
    updates.set(key, null);
    droppedEntries.push(`${key} (retired)`);
  }

  // Canonical allowlists owned by another mechanism (gateway sidecar,
  // module-gateway attach) are not derived here, but they must not carry an
  // origin their environment forbids.
  for (const [key, entry] of document.byKey) {
    if (key === CORS_SHARED_ORIGINS_ENV_KEY) continue;
    if (!/_ALLOWED_ORIGINS$/u.test(key)) continue;
    if (!isCanonicalCorsKey(key) || /_CONSOLE_HOST_/u.test(key)) continue;
    const origins = splitOrigins(entry.value);
    const removed = origins.filter((origin) => isEnvironmentInvalidOrigin(origin, result.environment));
    if (removed.length === 0) continue;
    updates.set(key, formatOrigins(origins.filter((origin) => !isEnvironmentInvalidOrigin(origin, result.environment))));
    droppedEntries.push(`${key} − [${removed.join(' ')}]`);
  }

  if (result.canonical !== null) {
    updates.set(CORS_SHARED_ORIGINS_ENV_KEY, formatOrigins(result.canonical));
  }

  const { text: nextText, changed } = applyEnvUpdates(document, updates);
  if (!changed) continue;

  const parts = [result.canonical === null ? '' : `${result.origins.length} → ${result.canonical.length} origins`];
  if (droppedEntries.length > 0) parts.push(`cleaned ${droppedEntries.length}: ${droppedEntries.join('; ')}`);
  const detail = parts.filter((part) => part.length > 0).join(' | ');

  if (args.fix) {
    writeFileSync(carrier.absolutePath, nextText, 'utf8');
    changedCarriers += 1;
    console.log(`aligned  ${carrier.relativePath}  ${detail}`);
  } else {
    changedCarriers += 1;
    console.log(`drift    ${carrier.relativePath}  ${detail}`);
  }
}

const skippedCarriers = results.length - eligible.length;

if (args.fix) {
  console.log(
    `align-cors-standard: ${changedCarriers} carrier(s) rewritten, ${skippedCarriers} carrier(s) not topology-derived, `
    + `${new Set(eligible.map((r) => r.module.name)).size} module(s) touched`,
  );
} else {
  console.log(
    `align-cors-standard (check): ${changedCarriers} carrier(s) not canonical, ${skippedCarriers} carrier(s) not topology-derived`,
  );
  process.exitCode = changedCarriers > 0 ? 1 : 0;
}
