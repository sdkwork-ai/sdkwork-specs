import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const CHECKER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'check-tenant-isolation-sql.mjs',
);

function write(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

function makeWorkspace() {
  return mkdtempSync(path.join(os.tmpdir(), 'sdkwork-tenant-isolation-sql-'));
}

function runChecker(workspace) {
  return spawnSync(process.execPath, [CHECKER, '--workspace', workspace], {
    encoding: 'utf8',
  });
}

describe('check-tenant-isolation-sql tenant and organization binding rules', () => {
  it('fails when a statement admits NULL as an organization scope', () => {
    const workspace = makeWorkspace();
    write(
      workspace,
      'sdkwork-demo/crates/demo-repository-sqlx/src/store.rs',
      `
pub const SQL: &str = "SELECT id FROM demo WHERE tenant_id = $1 AND (organization_id = $2 OR organization_id IS NULL)";
`,
    );

    const result = runChecker(workspace);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DB090/u);
  });

  it('fails when a nullable parameter makes the organization predicate optional', () => {
    const workspace = makeWorkspace();
    write(
      workspace,
      'sdkwork-demo/crates/demo-repository-sqlx/src/store.rs',
      `
pub const SQL: &str = "SELECT id FROM demo WHERE tenant_id = $1 AND ($2 IS NULL OR organization_id = $2)";
`,
    );

    const result = runChecker(workspace);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DB091/u);
  });

  it('fails when an empty parameter branch does the same', () => {
    const workspace = makeWorkspace();
    write(
      workspace,
      'sdkwork-demo/crates/demo-service/src/lib.rs',
      `
pub const SQL: &str = "DELETE FROM demo WHERE tenant_id = $1 AND ($2 = '' OR organization_id = $2)";
`,
    );

    const result = runChecker(workspace);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DB091/u);
  });

  it('accepts a statement that binds the resolved scope exactly', () => {
    const workspace = makeWorkspace();
    write(
      workspace,
      'sdkwork-demo/crates/demo-repository-sqlx/src/store.rs',
      `
pub const SQL: &str = "SELECT id FROM demo WHERE tenant_id = $1 AND organization_id = $2";
`,
    );

    const result = runChecker(workspace);
    assert.equal(result.status, 0, result.stderr);
  });

  it('accepts the declared tenant-global sentinel visibility rule', () => {
    const workspace = makeWorkspace();
    write(
      workspace,
      'sdkwork-demo/crates/demo-repository-sqlx/src/store.rs',
      `
pub const SQL: &str = "SELECT id FROM demo WHERE tenant_id = $1 AND (organization_id = $2 OR organization_id = '0')";
`,
    );

    const result = runChecker(workspace);
    assert.equal(result.status, 0, result.stderr);
  });

  it('ignores migration and seed SQL, which handle the sentinel backfill', () => {
    const workspace = makeWorkspace();
    write(
      workspace,
      'sdkwork-demo/database/migrations/postgres/0001_organization_id_not_null.up.sql',
      'UPDATE demo SET organization_id = \'0\' WHERE organization_id IS NULL;\n',
    );
    write(
      workspace,
      'sdkwork-demo/database/seeds/common/001_bootstrap.sql',
      "UPDATE demo SET organization_id = '0' WHERE organization_id IS NULL;\n",
    );

    const result = runChecker(workspace);
    assert.equal(result.status, 0, result.stderr);
  });

  it('reports a missing workspace instead of passing on nothing', () => {
    const result = runChecker(path.join(os.tmpdir(), 'sdkwork-tenant-isolation-missing-root'));
    assert.equal(result.status, 2);
  });
});
