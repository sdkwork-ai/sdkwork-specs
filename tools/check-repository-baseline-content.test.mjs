#!/usr/bin/env node

/**
 * Pin the contract of check-repository-baseline-content.mjs.
 *
 * The gate exists because the two content checks in audit-repository-baseline.mjs were
 * fail-open. A replacement gate that is itself fail-open would be worse than the gap it
 * closes, so the load-bearing test here is not "does it detect emit" - it is
 * "does run-gate-matrix.mjs READ the failure". A guardrail tier judges a gate by
 * `countItems(output) > baseline`, and the audit's own PASS/FAIL lines score 0 under that
 * reader, which is exactly how registering the audit directly in gates.manifest.json would
 * have produced a green matrix over a red fleet. The `countItems` assertions below fail if
 * this wrapper's output shape ever stops being readable.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { countItems, looksLikeCrash } from './run-gate-matrix.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, 'check-repository-baseline-content.mjs');

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', ...options });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { status: result.status, output };
}

function git(repo, args) {
  return execFileSync('git', ['-c', 'user.email=gate@test', '-c', 'user.name=gate', ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** A repository shaped enough for the audit's repository-wide predicates. */
function makeRepo(root, name, files) {
  const repo = path.join(root, name);
  fs.mkdirSync(repo, { recursive: true });
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(repo, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, 'utf8');
  }
  git(repo, ['init', '-q', '-b', 'main', '.']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'fixture']);
  return repo;
}

function tempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `baseline-content-${label}-`));
}

test('a repository with emit beside its source is reported, counted, and failed', () => {
  const root = tempRoot('red');
  const repo = makeRepo(root, 'sdkwork-fixture', {
    'AGENTS.md': '# fixture\n',
    'src/foo.ts': 'export const a = 1;\n',
    'src/foo.js': 'export const a = 1;\n',
    'src/foo.d.ts': 'export declare const a: number;\n',
    // Authored ambient: no same-stem .ts sibling, so the rule must leave it alone.
    'src/authored.d.ts': 'declare module "x" { }\n',
  });

  const { status, output } = run(['--root', repo]);
  assert.equal(status, 1, `expected exit 1, got ${status}\n${output}`);
  assert.match(output, /FAIL sdkwork-fixture: tracked-compiler-emit/);
  assert.match(output, /violations : 1/);
  assert.doesNotMatch(output, /authored\.d\.ts/, 'an authored ambient declaration was reported');
  assert.equal(looksLikeCrash(output), false, 'the gate printed something crash-shaped');

  // The reason the wrapper exists: the matrix reader must see this failure.
  assert.ok(countItems(output) > 0, 'run-gate-matrix would score this failure as 0 items');
});

test('a clean repository is not reported', () => {
  const root = tempRoot('green');
  const repo = makeRepo(root, 'sdkwork-fixture', {
    'AGENTS.md': '# fixture\n',
    'src/foo.ts': 'export const a = 1;\n',
    'src/authored.d.ts': 'declare module "x" { }\n',
  });

  const { status, output } = run(['--root', repo]);
  assert.equal(status, 0, `expected exit 0, got ${status}\n${output}`);
  assert.match(output, /violations : 0/);
  assert.equal(countItems(output), 0, 'a clean run must score 0 items so baseline 0 holds');
});

test('forbidden tracked paths are reported too', () => {
  const root = tempRoot('dist');
  const repo = makeRepo(root, 'sdkwork-fixture', {
    'AGENTS.md': '# fixture\n',
    'src/foo.ts': 'export const a = 1;\n',
    'dist/foo.js': 'export const a = 1;\n',
  });

  const { status, output } = run(['--root', repo]);
  assert.equal(status, 1, `expected exit 1, got ${status}\n${output}`);
  assert.match(output, /forbidden-tracked/);
  assert.ok(countItems(output) > 0);
});

test('workspace mode scans only sdkwork-* checkouts and aggregates', () => {
  const root = tempRoot('workspace');
  makeRepo(root, 'sdkwork-red', {
    'AGENTS.md': '# red\n',
    'src/foo.ts': 'export const a = 1;\n',
    'src/foo.js': 'export const a = 1;\n',
  });
  makeRepo(root, 'sdkwork-clean', { 'AGENTS.md': '# clean\n', 'src/foo.ts': '1\n' });
  // Not a repository the platform governs: no AGENTS.md, and a second offender inside it that
  // must not be counted.
  const ignored = path.join(root, 'not-a-repo');
  fs.mkdirSync(path.join(ignored, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ignored, 'src', 'foo.ts'), '1\n', 'utf8');
  fs.writeFileSync(path.join(ignored, 'src', 'foo.js'), '1\n', 'utf8');

  const { status, output } = run(['--workspace', root]);
  assert.equal(status, 1, `expected exit 1, got ${status}\n${output}`);
  assert.match(output, /Scanned 2 repositories/);
  assert.match(output, /FAIL sdkwork-red: tracked-compiler-emit/);
  assert.doesNotMatch(output, /FAIL sdkwork-clean/);
  assert.match(output, /violations : 1/);
  assert.ok(countItems(output) > 0);
});

test('the gate refuses to report success when it could not read anything', () => {
  const empty = tempRoot('empty');

  const noCheckout = run(['--workspace', empty]);
  assert.equal(noCheckout.status, 2, `expected exit 2\n${noCheckout.output}`);
  assert.match(noCheckout.output, /refusing to report success/);

  const notADirectory = run(['--workspace', path.join(empty, 'missing')]);
  assert.equal(notADirectory.status, 2);

  const notARepo = path.join(empty, 'plain');
  fs.mkdirSync(notARepo, { recursive: true });
  assert.equal(run(['--root', notARepo]).status, 2);

  assert.equal(run(['--workspace', empty, '--root', empty]).status, 2);
});
