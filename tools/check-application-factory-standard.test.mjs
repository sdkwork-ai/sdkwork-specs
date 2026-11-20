/**
 * Self-test for tools/check-application-factory-standard.mjs.
 *
 * Each case builds a throwaway standards root plus the module fixtures the checker reads, so the
 * gate is proven to fail on the specific drift it exists to catch instead of only on the real
 * workspace's current state. The fixture always nests the standards root inside a fake workspace,
 * mirroring the real `sdkwork-specs` + sibling `sdkwork-*` layout.
 *
 *   node --test tools/check-application-factory-standard.test.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MIN_SECTION_13_ROWS,
  REQUIRED_HEADINGS,
  parseSection13Rows,
  runChecks,
} from './check-application-factory-standard.mjs';

const CHECKER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'check-application-factory-standard.mjs',
);

const FACTORY_SPEC = 'APPLICATION_FACTORY_DEPLOYMENT_SPEC.md';
const IDENTITY_SPEC = 'APPLICATION_IDENTITY_SPEC.md';

const BASE_HEADINGS = [
  '## 1. Normative Language And Authority',
  ...REQUIRED_HEADINGS.filter((heading) => !heading.startsWith('## 13.')),
  '## 13. Landing Status And Known Gaps',
];

/** The five concepts plus the delivery-source boundary the vocabulary check looks for. */
const REQUIRED_TERMS = [
  'Deploy application',
  'Installation',
  'Hosting carrier',
  'Scaffold',
  'deploy_app_source_spec',
];

const BASELINE_TOKENS = [
  'CREATE TABLE IF NOT EXISTS deploy_app (',
  'CREATE TABLE IF NOT EXISTS deploy_app_source (',
  'CREATE TABLE IF NOT EXISTS deploy_app_platform_target (',
  'CREATE TABLE IF NOT EXISTS deploy_app_environment (',
  'CREATE TABLE IF NOT EXISTS deploy_application_scaffold (',
  "CONSTRAINT chk_deploy_app_status CHECK (app_status <> ''),",
  "CONSTRAINT chk_deploy_app_app_kind CHECK (app_kind <> ''),",
  "CONSTRAINT chk_deploy_deployment_environment CHECK (environment <> ''),",
  "CONSTRAINT chk_deploy_app_uninstall_status CHECK (uninstall_status <> ''),",
  "CONSTRAINT chk_deploy_app_environment_env_key CHECK (env_key <> ''),",
];

const LIFECYCLE_GUARD_TOKENS = [
  "CONSTRAINT chk_deploy_deployment_environment CHECK (environment <> ''),",
  "CONSTRAINT chk_deploy_app_environment_env_key CHECK (env_key <> ''),",
  "CONSTRAINT chk_deploy_app_uninstall_status CHECK (uninstall_status <> ''),",
  "CONSTRAINT chk_deploy_app_app_surface CHECK (app_surface <> ''),",
];

const REMIX_TOKENS = [
  'CREATE UNIQUE INDEX uk_deploy_app_source_app ON deploy_app_source (deploy_app_id);',
  "ALTER TABLE deploy_app_source ADD CONSTRAINT chk_deploy_app_source_kind CHECK (source_kind <> '');",
  "ALTER TABLE deploy_app_source ADD CONSTRAINT chk_deploy_app_source_pointer CHECK (source_pointer IS NOT NULL);",
];

const IAM_0043_TOKENS = [
  'ALTER TABLE iam_application_installation ADD CONSTRAINT uk_iam_application_installation_deploy UNIQUE (deploy_application_id);',
];

const IAM_0044_TOKENS = [
  "ALTER TABLE iam_application_installation ADD CONSTRAINT chk_iam_application_installation_ownership_scope CHECK (ownership_scope <> '');",
  "ALTER TABLE iam_application_installation ADD CONSTRAINT chk_iam_application_installation_ownership_alignment CHECK (owner_user_id IS NOT NULL);",
];

const WEBSERVER_0031_TOKENS = [
  'CREATE UNIQUE INDEX uk_webserver_application_deploy_application_id ON webserver_application (deploy_application_id);',
];

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/** A fake workspace holding a nested `sdkwork-specs` root, like the real checkout layout. */
function tempFixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-factory-standard-'));
  return { workspace, root: path.join(workspace, 'sdkwork-specs') };
}

/** Render a SQL fixture body, dropping any token a case wants to be missing. */
function sqlFixture(tokens, omitted = []) {
  return tokens.filter((token) => !omitted.includes(token)).join('\n');
}

/**
 * Write the module repositories the checker reads. `omit` removes individual SQL tokens so a
 * case can prove the checker names the exact missing artifact; `modules` leaves a repository
 * absent so a case can prove the absence is a skip rather than a failure.
 */
function writeModules(workspace, { omit = [], modules = ['deployments', 'iam', 'webserver'] } = {}) {
  if (modules.includes('deployments')) {
    write(
      path.join(workspace, 'sdkwork-deployments/database/ddl/baseline/postgres/0001_deploy_baseline.sql'),
      `${sqlFixture(BASELINE_TOKENS, omit)}\n`,
    );
    write(
      path.join(workspace, 'sdkwork-deployments/database/migrations/postgres/0011_deploy_app_remix_source.up.sql'),
      `${sqlFixture(REMIX_TOKENS, omit)}\n`,
    );
    write(
      path.join(
        workspace,
        'sdkwork-deployments/database/migrations/postgres/0015_application_factory_lifecycle_guards.up.sql',
      ),
      `${sqlFixture(LIFECYCLE_GUARD_TOKENS, omit)}\n`,
    );
  }
  if (modules.includes('iam')) {
    write(
      path.join(workspace, 'sdkwork-iam/database/migrations/postgres/0043_rename_tenant_application_to_application_installation.up.sql'),
      `${sqlFixture(IAM_0043_TOKENS, omit)}\n`,
    );
    write(
      path.join(workspace, 'sdkwork-iam/database/migrations/postgres/0044_application_installation_ownership_scope.up.sql'),
      `${sqlFixture(IAM_0044_TOKENS, omit)}\n`,
    );
  }
  if (modules.includes('webserver')) {
    write(
      path.join(workspace, 'sdkwork-webserver/database/migrations/postgres/0031_webserver_application_deploy_application_id.up.sql'),
      `${sqlFixture(WEBSERVER_0031_TOKENS, omit)}\n`,
    );
  }
}

/**
 * Write a minimal standards root: the factory spec with a valid section-13 table, the identity
 * spec it references, and nothing else. `rows` supplies the reviewed cell of each data row.
 */
function writeStandardsRoot({
  root,
  headings = BASE_HEADINGS,
  terms = REQUIRED_TERMS,
  rows = Array.from({ length: MIN_SECTION_13_ROWS }, () => '2026-11-20'),
  extraRowCells = null,
  identityText = '# Application Identity\n\nThe runtime identity is the deploy application.\n',
  references = [IDENTITY_SPEC],
}) {
  const sections = ['# Application Factory Deployment\n', `Terms: ${terms.join(', ')}.\n`];
  for (const heading of headings) {
    sections.push(heading);
    sections.push('');
    if (!heading.startsWith('## 13.')) {
      sections.push(`Prose for \`${heading.slice(3)}\`.`);
      sections.push('');
      continue;
    }
    sections.push('| Area | Current evidence | Gap or boundary | Reviewed |');
    sections.push('| --- | --- | --- | --- |');
    let index = 0;
    for (const reviewed of rows) {
      index += 1;
      const cells = extraRowCells ? extraRowCells(reviewed, index) : ['Anchors', '`deploy_app`', 'a gap', reviewed];
      sections.push(`| ${cells.join(' | ')} |`);
    }
    sections.push('');
  }
  sections.push(`References: ${references.map((name) => `\`${name}\``).join(', ')}.\n`);

  write(path.join(root, FACTORY_SPEC), `${sections.join('\n')}\n`);
  write(path.join(root, IDENTITY_SPEC), identityText);
  return root;
}

/** Build a fixture and return both halves so a case can place modules or run the CLI. */
function fixture(options = {}) {
  const { workspace, root } = tempFixture();
  writeStandardsRoot({ root, ...options });
  return { root, workspace };
}

function messages(outcome) {
  return outcome.failures.map((failure) => `${failure.file}: ${failure.message}`);
}

function runCli(args) {
  const result = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('section 13 parser reports four cells per data row and the reviewed column', () => {
  const { root } = fixture();
  const text = fs.readFileSync(path.join(root, FACTORY_SPEC), 'utf8');
  const parsed = parseSection13Rows(text);
  assert.equal(parsed.headerCells.length, 4);
  assert.equal(parsed.headerCells[3], 'Reviewed');
  assert.equal(parsed.rows.length, MIN_SECTION_13_ROWS);
  assert.ok(parsed.rows.every((row) => row.cells.length === 4));
});

test('a clean fixture with no module repositories passes and reports skips', () => {
  const { root, workspace } = fixture();
  const outcome = runChecks({ root, workspace });

  assert.deepEqual(messages(outcome), []);
  assert.equal(outcome.ok, true);
  // Only the standards repository is checked out: each module is skipped, never failed.
  assert.equal(outcome.skips.length, 3);
  assert.ok(outcome.skips.includes('sdkwork-iam repository not present'));

  const cli = runCli(['--root', root, '--workspace', workspace]);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /\[ok\] section headings: 4 check\(s\) passed/);
  assert.match(cli.stdout, /\[skip\] sdkwork-deployments repository not present/);
});

test('a clean fixture with every module artifact present passes', () => {
  const { root, workspace } = fixture();
  writeModules(workspace);

  const outcome = runChecks({ root, workspace });
  assert.deepEqual(messages(outcome), []);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.skips.length, 0);
  assert.equal(runCli(['--root', root, '--workspace', workspace]).status, 0);
});

test('a missing module repository is a skip, not a failure', () => {
  const { root, workspace } = fixture();
  // Only deployments and webserver are checked out; iam stays absent.
  writeModules(workspace, { modules: ['deployments', 'webserver'] });

  const outcome = runChecks({ root, workspace });
  assert.equal(outcome.ok, true);
  assert.deepEqual(messages(outcome), []);
  assert.ok(outcome.skips.includes('sdkwork-iam repository not present'));
});

test('a fixture missing uk_deploy_app_source_app fails and names the constraint', () => {
  const { root, workspace } = fixture();
  writeModules(workspace, {
    omit: ['CREATE UNIQUE INDEX uk_deploy_app_source_app ON deploy_app_source (deploy_app_id);'],
  });

  const outcome = runChecks({ root, workspace });
  assert.equal(outcome.ok, false);
  const failureText = messages(outcome).join('\n');
  assert.match(failureText, /0011_deploy_app_remix_source\.up\.sql/);
  assert.match(failureText, /uk_deploy_app_source_app/);

  const cli = runCli(['--root', root, '--workspace', workspace]);
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /\[fail\] sdkwork-deployments\/database\/migrations\/postgres\/0011_deploy_app_remix_source\.up\.sql: missing `uk_deploy_app_source_app`/);
});

test('a section 13 row without a reviewed date fails', () => {
  // Four cells, but the reviewed column carries a status word instead of a date.
  const { root } = fixture({
    extraRowCells: (_reviewed, index) =>
      index === 2 ? ['Anchors', '`deploy_app`', 'a gap', 'pending'] : ['Anchors', '`deploy_app`', 'a gap', '2026-11-20'],
  });
  const outcome = runChecks({ root, workspace: path.dirname(root) });
  assert.equal(outcome.ok, false);
  assert.ok(messages(outcome).some((message) => /reviewed cell `pending` is not a YYYY-MM-DD date/.test(message)));
});

test('a section 13 row that drops the reviewed cell entirely fails', () => {
  // Three cells: the reviewed column is gone, so the row cannot carry evidence.
  const { root } = fixture({
    extraRowCells: (_reviewed, index) =>
      index === 3 ? ['Anchors', '`deploy_app`', 'a gap'] : ['Anchors', '`deploy_app`', 'a gap', '2026-11-20'],
  });
  const outcome = runChecks({ root, workspace: path.dirname(root) });
  assert.equal(outcome.ok, false);
  assert.ok(messages(outcome).some((message) => /row has 3 cells, expected 4/.test(message)));
});

test('a section 13 table shorter than six rows fails', () => {
  const { root } = fixture({
    rows: Array.from({ length: MIN_SECTION_13_ROWS - 1 }, () => '2026-11-20'),
  });
  const outcome = runChecks({ root, workspace: path.dirname(root) });
  assert.equal(outcome.ok, false);
  assert.ok(messages(outcome).some((message) => /expected at least 6/.test(message)));
});

test('a fixture using Product application in the identity standard fails', () => {
  const { root } = fixture({
    identityText: '# Application Identity\n\nProduct application identifiers are retired.\n',
  });
  const outcome = runChecks({ root, workspace: path.dirname(root) });
  assert.equal(outcome.ok, false);
  assert.ok(messages(outcome).some((message) => /retired term `Product application` is still present/.test(message)));
});

test('a fixture using Blueprint in the identity standard fails', () => {
  const { root } = fixture({
    identityText: '# Application Identity\n\nA Blueprint table is forbidden.\n',
  });
  const outcome = runChecks({ root, workspace: path.dirname(root) });
  assert.equal(outcome.ok, false);
  assert.ok(messages(outcome).some((message) => /retired term `Blueprint` is still present/.test(message)));
});

test('a missing required heading fails with the heading text', () => {
  const { root } = fixture({
    headings: BASE_HEADINGS.filter((heading) => !heading.startsWith('## 9.')),
  });
  const outcome = runChecks({ root, workspace: path.dirname(root) });
  assert.equal(outcome.ok, false);
  assert.ok(messages(outcome).some((message) => /missing section heading `## 9\. Failure And Compensation Semantics`/.test(message)));
});

test('a missing required vocabulary term fails', () => {
  const { root } = fixture({
    terms: REQUIRED_TERMS.filter((term) => term !== 'deploy_app_source_spec'),
  });
  const outcome = runChecks({ root, workspace: path.dirname(root) });
  assert.equal(outcome.ok, false);
  assert.ok(messages(outcome).some((message) => /missing required vocabulary `deploy_app_source_spec`/.test(message)));
});

test('a backticked spec reference that does not exist fails', () => {
  const { root } = fixture({ references: [IDENTITY_SPEC, 'RETIRED_FACTORY_SPEC.md'] });
  const outcome = runChecks({ root, workspace: path.dirname(root) });
  assert.equal(outcome.ok, false);
  assert.ok(messages(outcome).some((message) => /references missing spec `RETIRED_FACTORY_SPEC\.md`/.test(message)));
});

test('an unusable standards root exits 2', () => {
  const { workspace } = tempFixture();
  const cli = runCli(['--root', path.join(workspace, 'not-a-root')]);
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /standards root is not a directory/);
});

test('an unusable workspace root exits 2 instead of reporting missing modules', () => {
  const { root, workspace } = fixture();
  const cli = runCli(['--root', root, '--workspace', path.join(workspace, 'not-a-workspace')]);
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /workspace root is not a directory/);
});
