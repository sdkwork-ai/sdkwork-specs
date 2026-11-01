#!/usr/bin/env node

/**
 * Contract tests for the env-file naming gate and its migrator
 * (`ENVIRONMENT_SPEC.md` section 5.1.7).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyEnvFileName, scanRepository } from './env-naming-lib.mjs';

const TOOLS_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(TOOLS_ROOT, 'check-env-file-naming.mjs');
const MIGRATE = path.join(TOOLS_ROOT, 'migrate-env-file-naming.mjs');

/**
 * Create a throwaway directory tree.
 * @param files - map of repo-relative path to contents.
 * @returns absolute fixture root.
 */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'env-naming-'));
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  }
  return root;
}

test('classifyEnvFileName accepts the canonical shapes only', () => {
  for (const name of [
    '.env',
    '.env.example',
    '.env.standalone.development',
    '.env.standalone.production',
    '.env.cloud.production',
    '.env.cloud.staging.example',
    '.env.cloud.demo',
    '.env.cloud.test',
    'config/host/postgres.env',
    'README.md',
  ]) {
    assert.equal(classifyEnvFileName(path.basename(name)), undefined, name);
  }
});

test('classifyEnvFileName rejects composed, one-dimensional, and host names', () => {
  assert.match(classifyEnvFileName('.env.local'), /retired/u);
  assert.match(classifyEnvFileName('.env.development'), /one-dimensional/u);
  assert.match(classifyEnvFileName('.env.production.example'), /one-dimensional/u);
  assert.match(classifyEnvFileName('.env.postgres'), /config\/host\/postgres\.env/u);
  assert.match(classifyEnvFileName('.env.sqlite.example'), /config\/host\/sqlite\.env/u);
  assert.match(classifyEnvFileName('.env.windows'), /packaging\/windows\.env/u);
  assert.match(classifyEnvFileName('.env.release'), /production/u);
  assert.match(
    classifyEnvFileName('.env.standalone.production.bootstrap.local'),
    /credential bundle|credentials/u,
  );
  assert.match(
    classifyEnvFileName('.env.development.local'),
    /credential bundle|credentials/u,
  );
  assert.match(classifyEnvFileName('.env.standalone.docker'), /not one of/u);
});

test('scanRepository reports retired files and ignores nested checkouts', () => {
  const root = fixture({
    '.env.standalone.production': 'A=1\n',
    '.env.postgres.example': 'B=2\n',
    'apps/demo/.env.development': 'C=3\n',
    'external/infra/.git': 'gitdir: ../.git/modules/infra\n',
    'external/infra/.env.local': 'D=4\n',
  });
  const result = scanRepository(root);
  const flagged = result.violations.map(violation => violation.file).sort();
  assert.deepEqual(flagged, ['.env.postgres.example', 'apps/demo/.env.development']);
  assert.ok(!result.envFiles.some(file => file.startsWith('external/')), 'nested checkout is out of scope');
});

test('scanRepository reports retired literals and honours the allow markers', () => {
  const root = fixture({
    'scripts/read.mjs': [
      "const name = '.env.development';",
      'const other = `.env.release`;',
      "// env-naming:allow `.env.local` is retired and must be named here",
      "const retired = '.env.local';",
      "const canonical = `.env.standalone.${environment}`;",
      "const property = config.env.production;",
      '',
    ].join('\n'),
    'scripts/reject.mjs': '// env-naming:allow-file\nconst retired = [".env.postgres"];\n',
  });
  const names = scanRepository(root).references.map(hit => hit.name).sort();
  assert.deepEqual(names, ['.env.development', '.env.release']);
});

test('the gate exits non-zero on a retired name and zero once migrated', () => {
  const root = fixture({ '.env.standalone.production': 'A=1\n', '.env.postgres': 'B=2\n' });
  const failing = spawnSync(process.execPath, [CHECK, '--root', root, '--single'], { encoding: 'utf8' });
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /FAIL \.env\.postgres/u);

  const clean = fixture({ '.env.standalone.production': 'A=1\n', 'config/host/postgres.env': 'B=2\n' });
  const passing = spawnSync(process.execPath, [CHECK, '--root', clean, '--single'], { encoding: 'utf8' });
  assert.equal(passing.status, 0, passing.stdout);
  assert.match(passing.stdout, /ok: every env file name matches/u);
});

test('the migrator plans the host rule without touching the tree', () => {
  const root = fixture({
    '.env.postgres': 'SDKWORK_DATABASE_HOST=127.0.0.1\n',
    '.env.postgres.example': '# Copy this file to .env.postgres\n',
    '.gitignore': '.env.postgres\n!.env.postgres.example\n',
  });
  const planned = spawnSync(
    process.execPath,
    [MIGRATE, '--root', root, '--single', '--rule', 'host', '--json'],
    { encoding: 'utf8' },
  );
  assert.equal(planned.status, 1, planned.stderr);
  const plan = JSON.parse(planned.stdout).repositories[0];
  assert.deepEqual(
    plan.moves.map(move => `${move.from}->${move.to}`).sort(),
    [
      '.env.postgres->config/host/postgres.env',
      '.env.postgres.example->config/host/postgres.env.example',
    ],
  );
  assert.ok(fs.existsSync(path.join(root, '.env.postgres')), 'dry run keeps the file in place');
});

test('the migrator moves host files and rewrites every reference', () => {
  const root = fixture({
    '.env.postgres': 'SDKWORK_DATABASE_HOST=127.0.0.1\n',
    '.env.postgres.example': '# Copy this file to .env.postgres and edit it.\n',
    '.gitignore': '.env.postgres\n!.env.postgres.example\n',
    'scripts/read.mjs': "export const file = '.env.postgres';\n",
    'README.md': 'Create `.env.postgres` from `.env.postgres.example`.\n',
  });
  const applied = spawnSync(
    process.execPath,
    [MIGRATE, '--root', root, '--single', '--rule', 'host', '--apply'],
    { encoding: 'utf8' },
  );
  assert.equal(applied.status, 0, applied.stderr);

  assert.equal(fs.existsSync(path.join(root, '.env.postgres')), false);
  assert.equal(
    fs.readFileSync(path.join(root, 'config/host/postgres.env'), 'utf8'),
    'SDKWORK_DATABASE_HOST=127.0.0.1\n',
  );
  assert.match(
    fs.readFileSync(path.join(root, 'config/host/postgres.env.example'), 'utf8'),
    /Copy this file to config\/host\/postgres\.env and edit it/u,
  );
  assert.equal(
    fs.readFileSync(path.join(root, '.gitignore'), 'utf8'),
    'config/host/postgres.env\n!config/host/postgres.env.example\n',
  );
  assert.match(fs.readFileSync(path.join(root, 'scripts/read.mjs'), 'utf8'), /config\/host\/postgres\.env/u);
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /`config\/host\/postgres\.env`/u);

  const gate = spawnSync(process.execPath, [CHECK, '--root', root, '--single'], { encoding: 'utf8' });
  assert.equal(gate.status, 0, gate.stdout);
  assert.equal(gate.stdout.includes('retired env-file reference'), false, 'no reference warning remains');
});
