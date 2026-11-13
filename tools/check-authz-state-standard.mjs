#!/usr/bin/env node
/**
 * AUTHORIZATION_STATE_SPEC.md enforcement checker.
 *
 * Rejects a workspace that reintroduces login-time-only authorization:
 *   - the authorization epoch table, session version column, and grant-table
 *     triggers must exist in the baseline DDL and in a migration;
 *   - the session resolver must compare the session snapshot version with the
 *     current epoch and re-resolve a stale snapshot in place;
 *   - local session tokens must not embed the expanded permission scope;
 *   - the wildcard matcher must remain the shared authorization primitive.
 *
 * Usage: node check-authz-state-standard.mjs --root <sdkwork-iam root>
 * Exit codes: 0 conforming, 1 violations, 2 unusable input.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: process.cwd() },
    json: { type: 'boolean', default: false },
  },
});

const root = path.resolve(values.root);
const failures = [];
const passes = [];

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  try {
    return fs.readFileSync(absolute, 'utf8');
  } catch {
    failures.push(`missing required file: ${relativePath}`);
    return null;
  }
}

function expect(condition, message) {
  if (condition) {
    passes.push(message);
  } else {
    failures.push(message);
  }
}

const baselinePath = 'database/ddl/baseline/postgres/0001_iam_baseline.sql';
const baseline = read(baselinePath);
if (baseline) {
  expect(
    baseline.includes('CREATE TABLE IF NOT EXISTS iam_authz_epoch'),
    `${baselinePath}: declares iam_authz_epoch (AUTHORIZATION_STATE_SPEC 3.3)`,
  );
  expect(
    /CREATE TABLE IF NOT EXISTS iam_session \([\s\S]*?authz_epoch BIGINT/.test(baseline),
    `${baselinePath}: iam_session carries authz_epoch (AUTHORIZATION_STATE_SPEC 3.3)`,
  );
  for (const table of [
    'iam_role',
    'iam_role_permission',
    'iam_permission',
    'iam_role_binding',
    'iam_role_exclusion',
    'iam_catalog_materialization',
  ]) {
    expect(
      baseline.includes(`ON ${table}\n  FOR EACH STATEMENT EXECUTE FUNCTION iam_bump_authz_epoch()`) ||
        baseline.includes(`ON ${table}\r\n  FOR EACH STATEMENT EXECUTE FUNCTION iam_bump_authz_epoch()`),
      `${baselinePath}: ${table} advances the authorization epoch on every write (AUTHORIZATION_STATE_SPEC 3.3)`,
    );
  }
}

const migrationsDir = path.join(root, 'database/migrations/postgres');
let authzMigration = null;
try {
  authzMigration = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('_iam_authz_epoch.up.sql'))
    .sort()
    .at(-1);
} catch {
  failures.push(`missing migration directory: database/migrations/postgres`);
}
if (authzMigration) {
  const migration = read(`database/migrations/postgres/${authzMigration}`);
  if (migration) {
    expect(
      migration.includes('iam_bump_authz_epoch'),
      `migration ${authzMigration}: installs the epoch trigger function`,
    );
    expect(
      migration.includes('ADD COLUMN IF NOT EXISTS authz_epoch'),
      `migration ${authzMigration}: versions existing session snapshots`,
    );
    expect(
      /--\s*reversible:/.test(migration),
      `migration ${authzMigration}: declares a reversible/rollback contract`,
    );
  }
} else {
  failures.push('no *_iam_authz_epoch.up.sql migration found (AUTHORIZATION_STATE_SPEC 3.3)');
}

const sessionPath = 'crates/sdkwork-iam-web-adapter/src/iam_session.rs';
const session = read(sessionPath);
if (session) {
  expect(
    session.includes('current_authz_epoch'),
    `${sessionPath}: session read carries the current authorization epoch`,
  );
  expect(
    session.includes('session_authz_epoch'),
    `${sessionPath}: session read carries the snapshot version`,
  );
  expect(
    session.includes('refresh_session_authorization_if_stale'),
    `${sessionPath}: stale snapshots are refreshed without re-authentication (AUTHORIZATION_STATE_SPEC 3.4)`,
  );
  expect(
    /UPDATE iam_session[\s\S]{0,200}authz_epoch = \$4/.test(session),
    `${sessionPath}: refresh persists the snapshot version with the scopes`,
  );
  expect(
    /fn refresh_session_authorization_if_stale[\s\S]{0,1200}?principal_kind != IamPrincipalKind::User/.test(
      session,
    ),
    `${sessionPath}: service-account/API-key scopes are not widened by a session refresh (AUTHORIZATION_STATE_SPEC 3.7)`,
  );
}

const tokenPath = 'crates/sdkwork-iam-web-adapter/src/access_token_issue.rs';
const tokenIssuer = read(tokenPath);
if (tokenIssuer) {
  const payloadStart = tokenIssuer.indexOf('fn sign_local_session_token_with_ttl');
  const payloadEnd = payloadStart < 0 ? -1 : tokenIssuer.indexOf('\nfn ', payloadStart + 10);
  const payloadBody =
    payloadStart < 0
      ? ''
      : tokenIssuer.slice(payloadStart, payloadEnd < 0 ? tokenIssuer.length : payloadEnd);
  expect(
    payloadBody.length > 0 && !payloadBody.includes('permission_scope'),
    `${tokenPath}: local session tokens do not embed the expanded permission scope (AUTHORIZATION_STATE_SPEC 3.1)`,
  );
  expect(
    tokenIssuer.includes('permission_scope should not be embedded'),
    `${tokenPath}: regression test locks the identity-only token payload`,
  );
}

const matcherPath = 'crates/sdkwork-iam-context-service/src/permission_standard.rs';
const matcher = read(matcherPath);
if (matcher) {
  expect(
    matcher.includes('pub fn permission_matches'),
    `${matcherPath}: shared wildcard matcher exists (AUTHORIZATION_STATE_SPEC 3.5)`,
  );
  expect(
    /if granted == "\*"/.test(matcher) &&
      /strip_suffix\("\.\*"\)/.test(matcher) &&
      /strip_prefix\("\*\."\)/.test(matcher),
    `${matcherPath}: matcher implements *, {domain}.*, *.{action}`,
  );
}

if (values.json) {
  process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, passes, failures }, null, 2)}\n`);
} else {
  for (const message of passes) {
    process.stdout.write(`ok   ${message}\n`);
  }
  for (const message of failures) {
    process.stderr.write(`FAIL ${message}\n`);
  }
  process.stdout.write(
    `\n${failures.length === 0 ? 'check-authz-state-standard: passed' : `check-authz-state-standard: ${failures.length} violation(s)`} (${passes.length} checks)\n`,
  );
}

process.exit(failures.length === 0 ? 0 : 1);
