#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_MIGRATION_LIST_RELATIVE_PATH,
  STRICTNESS_FLOOR,
  scanTypeScriptFederationStrictness,
} from './lib/typescript-federation-strictness.mjs';

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    migrationList: null,
    writeMigrationList: false,
    expiresDays: 90,
    strict: false,
    help: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      args.root = path.resolve(argv[++index]);
    } else if (arg === '--migration-list') {
      args.migrationList = path.resolve(argv[++index]);
    } else if (arg === '--write-migration-list') {
      args.writeMigrationList = true;
    } else if (arg === '--expires-days') {
      args.expiresDays = Number(argv[++index]);
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node tools/check-typescript-federation-strictness.mjs --root <repository-root> [options]',
    '',
    'Verifies the cross-repository source federation strictness contract',
    '(TYPESCRIPT_CODE_SPEC.md section 13): the consumer must not relax its own strictness,',
    'and every federated supplier repository must declare a superset of the consumer',
    'strictness baseline in its tsconfig and expose a "typecheck" script.',
    '',
    'Options:',
    '  --root <path>                Repository to check (default: current directory).',
    '  --migration-list <path>      Migration list location',
    `                               (default: <root>/${DEFAULT_MIGRATION_LIST_RELATIVE_PATH}).`,
    '  --write-migration-list       Rewrite the migration list from the current scan result.',
    '  --expires-days <n>           Grace period applied to generated entries (default: 90).',
    '  --strict                     Treat warnings (migrating suppliers) as failures.',
    '  -h, --help                   Show this help.',
    '',
    `Strictness floor: ${STRICTNESS_FLOOR.join(', ')}`,
  ].join('\n');
}

function writeMigrationList(filePath, result, repoRoot, expiresDays) {
  const expires = Number.isFinite(expiresDays) && expiresDays > 0
    ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : null;

  const entries = result.suppliers
    .filter((supplier) => !supplier.compliant)
    .map((supplier) => ({
      repo: supplier.name,
      reason: supplier.hasTypecheck
        ? 'supplier tsconfig below federation strictness baseline'
        : 'supplier missing tsconfig strictness flags and typecheck self-check entry',
      owner: '',
      expires,
    }));

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    version: 1,
    note: 'Repositories allowed to federate source before they satisfy the strictness contract. '
      + 'Entries MUST shrink: the gate fails on stale or expired entries.',
    generatedBy: 'tools/check-typescript-federation-strictness.mjs --write-migration-list',
    consumer: path.basename(repoRoot),
    baseline: result.baseline,
    repos: entries,
  }, null, 2)}\n`);

  return entries;
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log(usage());
  process.exit(0);
}

const result = scanTypeScriptFederationStrictness(args.root, {
  migrationList: args.migrationList,
});

if (args.writeMigrationList) {
  const migrationListPath = args.migrationList
    ?? path.join(args.root, DEFAULT_MIGRATION_LIST_RELATIVE_PATH);
  const entries = writeMigrationList(migrationListPath, result, args.root, args.expiresDays);
  console.log(`wrote ${entries.length} migration entr(ies) to ${migrationListPath}`);
  process.exit(0);
}

const relativeMigration = result.migration.path
  ? path.relative(args.root, result.migration.path).replace(/\\/g, '/')
  : DEFAULT_MIGRATION_LIST_RELATIVE_PATH;

console.log(
  `federation strictness: baseline=[${result.baseline.join(', ')}] `
  + `suppliers=${result.suppliers.length} `
  + `compliant=${result.suppliers.filter((supplier) => supplier.compliant).length} `
  + `migrating=${result.suppliers.filter((supplier) => supplier.migrating).length} `
  + `migration-list=${relativeMigration}`,
);

const failures = args.strict ? result.issues : result.failures;

if (failures.length === 0) {
  const warnings = result.warnings.length;
  console.log(
    warnings === 0
      ? 'typescript federation strictness passed'
      : `typescript federation strictness passed with ${warnings} migration warning(s)`,
  );
  if (warnings > 0) {
    for (const issue of result.warnings) {
      console.log(`- warning ${issue.kind}: [${issue.repo}] ${issue.path}: ${issue.entry} — ${issue.detail}`);
    }
  }
  process.exit(0);
}

console.error(`typescript federation strictness failed: ${failures.length} issue(s)`);
for (const issue of failures) {
  console.error(`- error ${issue.kind}: [${issue.repo}] ${issue.path}: ${issue.entry} — ${issue.detail}`);
}
console.error('');
console.error('Fix by raising the supplier tsconfig to the baseline and adding a "typecheck" script;');
console.error('never by relaxing the consumer. To record an intentional migration window, run:');
console.error(`  node tools/check-typescript-federation-strictness.mjs --root ${args.root} --write-migration-list`);
process.exit(1);
