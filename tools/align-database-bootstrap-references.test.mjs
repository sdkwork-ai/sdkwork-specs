#!/usr/bin/env node
/**
 * Regression contract for `align-database-bootstrap-references.mjs`.
 *
 * Two defects are pinned here:
 *  1. The fixer's mapping table contains the legacy literals it rewrites, so its
 *     own source matches its own patterns. Without a self-exclusion a workspace
 *     run rewrites the fixer and corrupts every later run.
 *  2. The legacy literals live in `.sql` baseline headers, but `.sql` was missing
 *     from the scanned extensions, which made every run a no-op.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  alignWorkspace,
  applyReplacements,
  shouldSkipDir,
  walkFiles,
} from './align-database-bootstrap-references.mjs';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const selfPath = path.resolve(toolDir, 'align-database-bootstrap-references.mjs');
const selfTestPath = path.resolve(toolDir, 'align-database-bootstrap-references.test.mjs');
assert.ok(fs.existsSync(selfPath), 'the fixer source must exist next to its test');

// --- the fixer never walks its own source -------------------------------------------------
const toolFiles = walkFiles(toolDir).map((filePath) => path.resolve(filePath));
assert.ok(
  !toolFiles.includes(selfPath),
  'walkFiles must exclude the fixer source so its own mapping table is never rewritten',
);
assert.ok(
  !toolFiles.includes(selfTestPath),
  'walkFiles must exclude the fixer test, which asserts on the same legacy literals',
);
assert.ok(
  toolFiles.some((filePath) => path.basename(filePath) === 'check-database-bootstrap-references.mjs'),
  'siblings in the same directory must stay in scope — only the fixer itself is excluded',
);

// --- generated and scratch trees are out of scope -----------------------------------------
for (const name of ['.sdkwork', '.tmp', '.tmp-merge', '.cache', 'external', 'node_modules']) {
  assert.ok(shouldSkipDir(name), `${name} must be out of scope`);
}
for (const name of ['database', 'src', 'crates', 'tools']) {
  assert.ok(!shouldSkipDir(name), `${name} must remain in scope`);
}

// --- replacement table is correct and idempotent ------------------------------------------
assert.equal(
  applyReplacements('0001_videocut_legacy_baseline'),
  '0001_videocut_baseline',
  'legacy migration id strings must collapse to the canonical id',
);
assert.equal(
  applyReplacements('-- baseline source: ddl/baseline/postgres/0001_aiot_legacy_baseline.sql'),
  '-- baseline source: ddl/baseline/postgres/0001_aiot_baseline.sql',
  'the consolidated baseline provenance header must resolve to the canonical baseline name',
);
assert.equal(
  applyReplacements('-- baseline source: ddl/baseline/postgres/0001_sdkwork_models_catalog_baseline.sql'),
  '-- baseline source: ddl/baseline/postgres/0001_sdkwork-models_baseline.sql',
  'the models catalog baseline must map to its canonical hyphenated name',
);

const canonical = '-- baseline source: ddl/baseline/postgres/0001_aiot_baseline.sql';
assert.equal(applyReplacements(canonical), canonical, 'applyReplacements must be idempotent');

// --- the notary rename is confined to baseline paths --------------------------------------
// `0001_notary_foundation.sql` is *also* the retired crate-local migration that
// sdkwork-notary asserts is gone. Rewriting that guard would make it check for a file
// that never existed, so a bare-basename mapping must never be introduced here.
assert.equal(
  applyReplacements('ddl/baseline/postgres/0001_notary_foundation.sql'),
  'ddl/baseline/postgres/0001_notary_baseline.sql',
  'baseline provenance must follow the notary rename',
);
assert.equal(
  applyReplacements('crates/sdkwork-notary-case-repository-sqlx/migrations/0001_notary_foundation.sql'),
  'crates/sdkwork-notary-case-repository-sqlx/migrations/0001_notary_foundation.sql',
  'the retired crate-local migration name must survive verbatim — it is asserted absent',
);

// --- workspace run rewrites `.sql` provenance and stays idempotent ------------------------
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-bootstrap-'));
const repoRoot = path.join(workspace, 'sdkwork-demo');
fs.mkdirSync(path.join(repoRoot, 'database/ddl/baseline/postgres'), { recursive: true });
const stalePath = path.join(repoRoot, 'database/ddl/baseline/postgres/0001_demo_baseline.sql');
fs.writeFileSync(
  stalePath,
  '-- baseline source: ddl/baseline/postgres/0001_demo_legacy_baseline.sql\nCREATE TABLE demo (id BIGINT PRIMARY KEY);\n',
  'utf8',
);

// Vendored and generated copies must never be rewritten.
fs.mkdirSync(path.join(repoRoot, 'node_modules'), { recursive: true });
const vendoredPath = path.join(repoRoot, 'node_modules/0001_demo_baseline.sql');
const vendoredSource = '-- baseline source: ddl/baseline/postgres/0001_demo_legacy_baseline.sql\n';
fs.writeFileSync(vendoredPath, vendoredSource, 'utf8');

fs.mkdirSync(path.join(repoRoot, '.sdkwork/runtime/copy'), { recursive: true });
const generatedPath = path.join(repoRoot, '.sdkwork/runtime/copy/0001_demo_baseline.sql');
const generatedSource = '-- baseline source: ddl/baseline/postgres/0001_demo_legacy_baseline.sql\n';
fs.writeFileSync(generatedPath, generatedSource, 'utf8');

const dryRun = alignWorkspace(workspace, { dryRun: true });
assert.deepEqual(dryRun, [stalePath], 'dry-run must report the authored baseline exactly once');
assert.ok(
  fs.readFileSync(stalePath, 'utf8').includes('0001_demo_legacy_baseline'),
  'dry-run must not mutate the file',
);

const written = alignWorkspace(workspace);
assert.deepEqual(written, [stalePath], 'workspace run must rewrite the authored baseline');
const migrated = fs.readFileSync(stalePath, 'utf8');
assert.ok(
  migrated.includes('-- baseline source: ddl/baseline/postgres/0001_demo_baseline.sql'),
  'the provenance header must be rewritten to the canonical baseline name',
);
assert.ok(!migrated.includes('legacy_baseline'), 'no legacy literal may survive the rewrite');
assert.ok(
  migrated.includes('CREATE TABLE demo'),
  'the fixer must only rewrite the reference and leave DDL untouched',
);
assert.equal(
  fs.readFileSync(vendoredPath, 'utf8'),
  vendoredSource,
  'node_modules must stay out of scope',
);
assert.equal(
  fs.readFileSync(generatedPath, 'utf8'),
  generatedSource,
  'generated .sdkwork runtime copies must stay out of scope',
);

assert.deepEqual(alignWorkspace(workspace), [], 'the fixer must be idempotent');

fs.rmSync(workspace, { recursive: true, force: true });

process.stdout.write('align-database-bootstrap-references.test.mjs passed\n');
