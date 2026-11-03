#!/usr/bin/env node
/**
 * Tenant and organization isolation SQL gate (`DATABASE_SPEC.md` §16, DB087–DB091).
 *
 * `DATABASE_SPEC.md` §16 requires a static repository isolation gate that fails on
 * executable SQL whose tenant or organization scope is not bound to exactly one
 * resolved value. The DDL half of the contract (DB086/DB089 — `tenant_id` present,
 * `organization_id NOT NULL DEFAULT '0'`) is enforced by
 * `check-database-framework-standard.mjs`; this tool covers the runtime half.
 *
 * The resolved scope has exactly one representation after `API_SPEC.md` §10.4:
 * `tenant_id` from the verified credential, and the organization sentinel `0` for
 * a tenant-level credential or the verified organization id otherwise. A predicate
 * that also admits `NULL`, or that switches scope with a nullable/empty parameter
 * branch, therefore admits a third, unauthorised state:
 *
 *   DB090  `tenant_id IS NULL` / `organization_id IS NULL` is never a valid scope.
 *          A statement that matches `NULL` rows treats "no scope" as a real scope,
 *          so legacy `NULL` rows leak into a scoped result set.
 *   DB091  A nullable/empty parameter branch (`$n IS NULL` / `$n = ''`) used as
 *          the scope switch means the bound scope is not the credential scope; it
 *          is an inference from the *absence* of a value.
 *
 * The DDL half of DB093 (`COALESCE(organization_id, '0')` in indexes and
 * constraints) is owned by `check-database-framework-standard.mjs`; a
 * `COALESCE` in an insert projection is not a scope predicate and is allowed.
 *
 * Scope: statements that already reference the scope column. Statements that omit
 * it entirely are owned by the repository-local machine contract
 * (`DATABASE_SPEC.md` §16, DB102) because deciding whether a table is
 * organization-scoped requires its declared classification; this gate never
 * guesses.
 *
 * Usage:
 *   node check-tenant-isolation-sql.mjs [--workspace <dir>] [--root <repo>] [--json]
 *
 * `--workspace` names the directory that holds the `sdkwork-*` repositories.
 * `--root` narrows the scan to one repository (default: the workspace).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const SPECS_ROOT = path.resolve(TOOL_DIR, '..');

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'target',
  'dist',
  '.git',
  'external',
  'artifacts',
  'backups',
  '.sdkwork',
]);

const SQL_VERB = /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/u;

/**
 * Migration and baseline DDL deliberately mention `organization_id IS NULL`:
 * DB092 requires backfilling the sentinel and asserting `NOT NULL`, and DB089
 * validates the resulting column contract. Those are schema-change statements,
 * not runtime scope predicates, so the runtime gate excludes them.
 */
const NON_RUNTIME_PATH_MARKERS = [
  '/migrations/',
  '/ddl/',
  '/database/contract/',
  '/database/seeds/',
  '/.sdkwork/',
  '/backups/',
  '/tmp/',
];


/** Rust string literals: `r#"..."#` raw strings and ordinary `"..."` strings. */
const RUST_STRING_LITERAL = /\br(#*)?"([\s\S]*?)"\1|"(?:[^"\\\n]|\\.)*"/gu;

const RULES = [
  {
    id: 'DB090',
    reason:
      'organization_id IS NULL is never a valid scope; bind the resolved scope (sentinel 0 or the claim value)',
    pattern: /\borganization_id\s+is\s+null\b/iu,
  },
  {
    id: 'DB090',
    reason:
      'tenant_id IS NULL is never a valid scope; bind the verified tenant instead',
    pattern: /\btenant_id\s+is\s+null\b/iu,
  },
  {
    id: 'DB091',
    reason:
      'a nullable/empty parameter makes the organization predicate optional, so an absent value reads every organization; bind the resolved scope instead',
    pattern:
      /\$\d+(?:\s*::\s*\w+)?\s+is\s+null\s+or\s+(?:\w+\.)?organization_id\s*=\s*\$\d+/iu,
  },
  {
    id: 'DB091',
    reason:
      'a nullable/empty parameter makes the tenant predicate optional, so an absent value reads every tenant; bind the verified tenant instead',
    pattern:
      /\$\d+(?:\s*::\s*\w+)?\s+is\s+null\s+or\s+(?:\w+\.)?tenant_id\s*=\s*\$\d+/iu,
  },
  {
    id: 'DB091',
    reason:
      'an empty-value parameter makes the organization predicate optional, so an absent value reads every organization; bind the resolved scope instead',
    pattern: /\$\d+\s*(?:::?\s*\w+)?\s*=\s*''\s+or\s+(?:\w+\.)?organization_id\s*=\s*\$\d+/iu,
  },
  {
    id: 'DB091',
    reason:
      'an empty-value parameter makes the tenant predicate optional, so an absent value reads every tenant; bind the verified tenant instead',
    pattern: /\$\d+\s*(?:::?\s*\w+)?\s*=\s*''\s+or\s+(?:\w+\.)?tenant_id\s*=\s*\$\d+/iu,
  },
];

function usage() {
  process.stdout.write(
    [
      'Usage: node check-tenant-isolation-sql.mjs [--workspace <dir>] [--root <repo>] [--json]',
      '',
      'Fails when executable SQL binds a tenant or organization scope through a NULL',
      'or empty-value branch instead of the resolved scope (DATABASE_SPEC §16).',
      '',
    ].join('\n'),
  );
}

function walk(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
      continue;
    }
    if (/\.(rs|sql)$/u.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

function lineOf(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < text.length; cursor += 1) {
    if (text[cursor] === '\n') {
      line += 1;
    }
  }
  return line;
}

/** Returns `{ start, sql }` fragments for one file. */
function sqlFragments(file, text) {
  const fragments = [];
  if (file.endsWith('.sql')) {
    fragments.push({ start: 0, sql: text });
    return fragments;
  }
  RUST_STRING_LITERAL.lastIndex = 0;
  let match;
  while ((match = RUST_STRING_LITERAL.exec(text)) !== null) {
    const literal = match[0];
    const body = match[2] ?? literal.slice(1, -1);
    if (!SQL_VERB.test(body)) {
      continue;
    }
    fragments.push({ start: match.index, sql: body });
  }
  return fragments;
}

function scanFile(file, relative, failures) {
  const text = fs.readFileSync(file, 'utf8');
  for (const fragment of sqlFragments(file, text)) {
    if (!/organization_id/iu.test(fragment.sql)) {
      continue;
    }
    const line = lineOf(text, fragment.start);
    for (const rule of RULES) {
      if (!rule.pattern.test(fragment.sql)) {
        continue;
      }
      failures.push({
        rule: rule.id,
        file: relative,
        line,
        reason: rule.reason,
      });
      break;
    }
  }
}

export function runTenantIsolationSqlCheck(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      workspace: { type: 'string' },
      root: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    usage();
    return 0;
  }

  const workspaceRoot = path.resolve(values.workspace ?? path.resolve(SPECS_ROOT, '..'));
  if (!fs.existsSync(workspaceRoot)) {
    console.error(`tenant isolation SQL check: workspace not found: ${workspaceRoot}`);
    return 2;
  }

  const scanRoots = values.root
    ? [path.resolve(values.root)]
    : fs
        .readdirSync(workspaceRoot, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith('sdkwork-') &&
            !SKIP_DIR_NAMES.has(entry.name),
        )
        .map((entry) => path.join(workspaceRoot, entry.name));

  const failures = [];
  for (const scanRoot of scanRoots) {
    if (!fs.existsSync(scanRoot)) {
      console.error(`tenant isolation SQL check: root not found: ${scanRoot}`);
      return 2;
    }
    for (const file of walk(scanRoot)) {
      if (path.basename(file).startsWith('check-tenant-isolation-sql')) {
        continue;
      }
      const relative = path.relative(workspaceRoot, file).replaceAll('\\', '/');
      if (NON_RUNTIME_PATH_MARKERS.some((marker) => `/${relative}`.includes(marker))) {
        continue;
      }
      scanFile(file, relative, failures);
    }
  }

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ failures }, null, 2)}\n`);
  }

  if (failures.length > 0) {
    console.error(`tenant isolation SQL failures: ${failures.length}`);
    for (const failure of failures.slice(0, 200)) {
      console.error(
        `- ${failure.file}:${failure.line}: ${failure.rule} ${failure.reason}`,
      );
    }
    if (failures.length > 200) {
      console.error(`... and ${failures.length - 200} more`);
    }
    return 1;
  }

  if (!values.json) {
    console.log(
      `tenant isolation SQL standard ok (${scanRoots.length} root(s) scanned)`,
    );
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runTenantIsolationSqlCheck());
}
