#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDatabaseFramework } from './check-database-framework-standard.mjs';
import {
  classifyRepo,
  ownsRepositorySqlxCrate,
} from './audit-database-framework-workspace.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TOOL_DIR, '../..');
const forumRoot = path.join(WORKSPACE_ROOT, 'sdkwork-forum');

if (fs.existsSync(forumRoot)) {
  const forum = validateDatabaseFramework(forumRoot);
  assert.equal(typeof forum.ok, 'boolean');
  assert.ok(Array.isArray(forum.failures));
}

// ---------------------------------------------------------------------------
// Database-ownership predicate: repository-local crate vs cross-repo consumer.
//
// Regression guard: `sdkwork-birdcoder` is an application shell that only declares
// `sdkwork-models-user-config-repository-sqlx = { path = "../sdkwork-models/crates/..." }`.
// A raw substring test on `repository-sqlx` classified it as a database owner and emitted a
// bogus `missing:db:validate,db:plan,...` finding for a module that owns no database.
// ---------------------------------------------------------------------------
{
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'db-owner-predicate-'));

  const writeCargo = (name, body) => {
    const root = path.join(fixtureRoot, name);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'Cargo.toml'), body, 'utf8');
    return root;
  };

  const foreignOnly = writeCargo(
    'consumer',
    [
      '[workspace.dependencies]',
      'sdkwork-models-user-config-repository-sqlx = { path = "../sdkwork-models/crates/sdkwork-models-user-config-repository-sqlx" }',
      '',
    ].join('\n'),
  );
  assert.equal(
    ownsRepositorySqlxCrate(foreignOnly),
    false,
    'a path dependency escaping the repository is consumption, not ownership',
  );
  assert.equal(
    classifyRepo('consumer', foreignOnly).ownsDb,
    false,
    'a pure cross-repo sqlx consumer must not be classified as a database owner',
  );

  const localPathDep = writeCargo(
    'owner-local-path',
    [
      '[dependencies]',
      'sdkwork_account_repository_sqlx = { path = "crates/sdkwork-account-repository-sqlx", package = "sdkwork-account-repository-sqlx" }',
      '',
    ].join('\n'),
  );
  assert.equal(ownsRepositorySqlxCrate(localPathDep), true, 'a repository-local path dependency is ownership');
  assert.equal(classifyRepo('owner-local-path', localPathDep).ownsDb, true);

  const localMember = writeCargo(
    'owner-member',
    ['[workspace]', 'members = [', '  "crates/sdkwork-account-repository-sqlx",', '  "crates/sdkwork-account-service"', ']', ''].join('\n'),
  );
  assert.equal(ownsRepositorySqlxCrate(localMember), true, 'a workspace member crate inside the repository is ownership');
  assert.equal(classifyRepo('owner-member', localMember).ownsDb, true);

  const noCargo = path.join(fixtureRoot, 'no-manifest');
  fs.mkdirSync(noCargo, { recursive: true });
  assert.equal(ownsRepositorySqlxCrate(noCargo), false, 'a repository without Cargo.toml owns no SQLx crate');

  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Fleet invariants
// ---------------------------------------------------------------------------
const { spawnSync } = await import('node:child_process');
const audit = spawnSync(
  process.execPath,
  [path.join(TOOL_DIR, 'audit-database-framework-workspace.mjs'), '--workspace', WORKSPACE_ROOT],
  { encoding: 'utf8' },
);
assert.ok([0, 1].includes(audit.status), audit.stdout || audit.stderr);
assert.match(audit.stdout, /Database framework workspace audit/, audit.stdout || audit.stderr);
assert.match(audit.stdout, /Repos scanned: \d+/, audit.stdout || audit.stderr);
assert.match(audit.stdout, /DB owners: \d+/, audit.stdout || audit.stderr);
assert.match(audit.stdout, /Compliant: \d+/, audit.stdout || audit.stderr);
if (fs.existsSync(forumRoot)) {
  assert.match(
    audit.stdout,
    /sdkwork-forum: (?:compliant|partial|legacy-only)/,
    audit.stdout || audit.stderr,
  );
}

// Every database owner must be accounted for by exactly one compliance bucket: the listed rows
// are the owners, so the three buckets must partition them. A mismatch means an owner is reported
// with `compliance: none` while still being counted.
{
  const owners = Number(audit.stdout.match(/DB owners: (\d+)/)?.[1] ?? '-1');
  const compliant = Number(audit.stdout.match(/Compliant: (\d+)/)?.[1] ?? '-1');
  const partial = Number(audit.stdout.match(/Partial: (\d+)/)?.[1] ?? '-1');
  const legacyOnly = Number(audit.stdout.match(/Legacy-only: (\d+)/)?.[1] ?? '-1');
  assert.ok(owners >= 0 && compliant >= 0 && partial >= 0 && legacyOnly >= 0, audit.stdout);
  const listedRows = audit.stdout
    .split('\n')
    .filter((line) => /^sdkwork-[a-z0-9-]+: /.test(line)).length;
  assert.equal(
    listedRows,
    owners,
    `reported owner rows (${listedRows}) must equal the DB owner count (${owners})`,
  );
  assert.ok(
    compliant + partial + legacyOnly <= owners,
    `compliance buckets (${compliant}+${partial}+${legacyOnly}) must not exceed owners (${owners})`,
  );
}

// The application shell that only consumes a sibling module's sqlx crate must never be listed as
// a database owner: doing so fabricates a `missing:db:*` finding for a module with no database.
assert.doesNotMatch(
  audit.stdout,
  /^sdkwork-birdcoder: /m,
  'sdkwork-birdcoder owns no database and must not be reported as a database owner',
);

process.stdout.write('audit-database-framework-workspace.test.mjs passed\n');
