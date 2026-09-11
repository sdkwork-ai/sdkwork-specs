#!/usr/bin/env node

// Validates CORS origin carriers per CORS_SPEC.md.
// Usage:
//   node tools/check-cors-standard.mjs --workspace <workspace-root>
//   node tools/check-cors-standard.mjs --root <module-root>
//   node tools/check-cors-standard.mjs --workspace <root> --json
//
// `--root <module-root>` audits exactly one application root and is the form a
// repository wires into its own `check:cors-standard` script.

import fs from 'node:fs';
import path from 'node:path';

import { auditModule, auditWorkspace, CARRIER_DIRS } from './cors/scan.mjs';

function parseArgs(argv) {
  const args = { root: null, workspace: null, json: false, quiet: false };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--root') args.root = argv[i + 1];
    else if (flag === '--workspace') args.workspace = argv[i + 1];
    else if (flag === '--json') args.json = true;
    else if (flag === '--quiet') args.quiet = true;
  }
  return args;
}

const args = parseArgs(process.argv);
const perRepository = args.root !== null && args.workspace === null;
const target = path.resolve(args.workspace ?? args.root ?? process.cwd());

// Fail closed. `discoverModules` returns `[]` both for a path that is not a
// directory and for a workspace holding no `sdkwork-*` checkout; in either case
// every count below is zero, so the gate printed a passing line — "0 modules,
// 0 carriers, 0 carriers with issues, 0 required allowlists missing, 0 gate wiring
// errors, 0 warnings" — for a scan that read nothing. QUALITY_GATE_SPEC.md: a gate
// that reports success without reading source is worse than no gate at all, because
// it occupies a contract slot while enforcing nothing.
if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  console.error(`check-cors-standard: refusing to report success: not a directory: ${target}`);
  process.exit(2);
}
if (!perRepository && fs.readdirSync(target).every((name) => !name.startsWith('sdkwork-'))) {
  console.error(`check-cors-standard: refusing to report success: no sdkwork-* checkout under ${target}`);
  process.exit(2);
}

let modules;
let results;
let scope;
let wiring = [];
if (perRepository) {
  const audit = auditModule(target);
  if (audit.module === null) {
    console.error(
      `check-cors-standard: ${target} declares no CORS carrier `
      + `(${CARRIER_DIRS.join(', ')}); remove the gate or align the repository`,
    );
    process.exit(1);
  }
  modules = [audit.module];
  results = audit.results;
  scope = target;
} else {
  const audit = auditWorkspace(target);
  modules = audit.modules;
  results = audit.results;
  wiring = audit.wiring;
  scope = target;
}

const failing = results.filter((result) => result.errors.length > 0);
const missingAllowlist = results.filter((result) => result.required && result.canonical === null);
const wiringErrors = wiring.filter((issue) => issue.level === 'error');
const wiringWarnings = wiring.filter((issue) => issue.level === 'warning');

if (args.json) {
  console.log(JSON.stringify({
    scope,
    modules: modules.length,
    carriers: results.length,
    failingCarriers: failing.length,
    issues: failing.flatMap((result) => result.errors),
    wiring,
  }, null, 2));
  process.exitCode = failing.length > 0 || wiringErrors.length > 0 ? 1 : 0;
} else {
  if (!args.quiet) {
    for (const result of results) {
      if (result.errors.length === 0) continue;
      console.error(`ERROR ${result.carrier.relativePath}`);
      for (const error of result.errors) console.error(`  ${error.replace(`${result.carrier.relativePath}: `, '')}`);
    }
    for (const issue of wiring) {
      console.error(`${issue.level === 'error' ? 'ERROR' : 'WARN '} ${issue.message}`);
    }
  }
  if (failing.length > 0) {
    console.error('');
    console.error(perRepository
      ? 'Fix with: node ../sdkwork-specs/tools/align-cors-standard.mjs --root . --fix'
      : 'Fix with: node tools/align-cors-standard.mjs --workspace <workspace-root> --fix');
  }
  console.log(
    `check-cors-standard: ${modules.length} modules, ${results.length} carriers, `
    + `${failing.length} carriers with issues, ${missingAllowlist.length} required allowlists missing, `
    + `${wiringErrors.length} gate wiring errors, ${wiringWarnings.length} warnings`,
  );
  process.exitCode = failing.length > 0 || wiringErrors.length > 0 ? 1 : 0;
}
