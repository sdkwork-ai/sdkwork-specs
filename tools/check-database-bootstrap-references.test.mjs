#!/usr/bin/env node
/**
 * Regression contract for `check-database-bootstrap-references.mjs`.
 *
 * The gate must catch a consolidated baseline whose recorded provenance points at
 * a sibling baseline that no longer exists (the debt left behind by a baseline
 * rename), while NOT flagging provenance that records consolidation sources.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  checkBaselineDir,
  shouldSkipDir,
  walkSourceFiles,
} from './check-database-bootstrap-references.mjs';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-check-dbboot-'));
const baselineDir = path.join(repoRoot, 'database/ddl/baseline/postgres');
fs.mkdirSync(baselineDir, { recursive: true });
const baselinePath = path.join(baselineDir, '0001_demo_baseline.sql');
const DDL = 'CREATE TABLE demo (id BIGINT PRIMARY KEY);';

// --- a stale sibling reference is reported -------------------------------------------------
fs.writeFileSync(
  baselinePath,
  `-- baseline source: ddl/baseline/postgres/0001_demo_legacy_baseline.sql\n${DDL}\n`,
  'utf8',
);
const stale = [];
checkBaselineDir(repoRoot, 'postgres', stale);
assert.deepEqual(
  stale,
  ['postgres/0001_demo_baseline.sql: provenance reference does not exist: ddl/baseline/postgres/0001_demo_legacy_baseline.sql'],
  'a provenance reference to a renamed sibling must be reported',
);

// --- canonical provenance and historical consolidation sources pass ------------------------
fs.writeFileSync(
  baselinePath,
  [
    '-- baseline source: ddl/baseline/postgres/0001_demo_baseline.sql',
    '-- source: database/ddl/baseline/postgres/0001_demo_baseline.sql#section-a',
    '-- source: crates/sdkwork-demo-repository-sqlx/migrations/0001_demo_foundation.sql',
    '-- source: migrations/001_create_demo.sql',
    '-- source: crates/sdkwork-demo-storage/migrations/*.sql',
    DDL,
    '',
  ].join('\n'),
  'utf8',
);
const clean = [];
checkBaselineDir(repoRoot, 'postgres', clean);
assert.deepEqual(
  clean,
  [],
  'self-referential and historical consolidation provenance must both pass',
);

// --- a non-retired supplemental baseline is still reported ---------------------------------
fs.writeFileSync(path.join(baselineDir, '0002_extra.sql'), `CREATE TABLE extra (id BIGINT);\n`, 'utf8');
const supplemental = [];
checkBaselineDir(repoRoot, 'postgres', supplemental);
assert.deepEqual(
  supplemental,
  ['postgres/0002_extra.sql: supplemental baseline must be retired stub without CREATE TABLE'],
  'the pre-existing supplemental-baseline rule must keep working',
);
fs.rmSync(path.join(baselineDir, '0002_extra.sql'));

// --- generated and scratch trees are out of scope for the walk -----------------------------
for (const name of ['.sdkwork', '.tmp', '.tmp-merge', '.pnpm-store', 'node_modules']) {
  assert.ok(shouldSkipDir(name), `${name} must be out of scope`);
}
for (const name of ['crates', 'database', 'sdks', 'tools']) {
  assert.ok(!shouldSkipDir(name), `${name} must remain in scope`);
}

fs.mkdirSync(path.join(repoRoot, 'crates/demo/src'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'crates/demo/src/lib.rs'), 'pub fn demo() {}\n', 'utf8');
fs.mkdirSync(path.join(repoRoot, '.sdkwork/runtime/copy'), { recursive: true });
fs.writeFileSync(
  path.join(repoRoot, '.sdkwork/runtime/copy/0001_demo_baseline.sql'),
  `${DDL}\n`,
  'utf8',
);
fs.mkdirSync(path.join(repoRoot, '.tmp-merge'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, '.tmp-merge/note.sql'), `${DDL}\n`, 'utf8');

const walked = walkSourceFiles(repoRoot).map((filePath) => path.relative(repoRoot, filePath).split(path.sep).join('/'));
assert.ok(walked.includes('crates/demo/src/lib.rs'), 'Rust sources must stay in scope');
assert.ok(
  walked.includes('database/ddl/baseline/postgres/0001_demo_baseline.sql'),
  '`.sql` must be walked — provenance lives in SQL headers',
);
assert.ok(
  !walked.some((relative) => relative.startsWith('.sdkwork/')),
  'generated .sdkwork runtime copies must stay out of scope',
);
assert.ok(
  !walked.some((relative) => relative.startsWith('.tmp-merge/')),
  'scratch trees must stay out of scope',
);

fs.rmSync(repoRoot, { recursive: true, force: true });

process.stdout.write('check-database-bootstrap-references.test.mjs passed\n');
