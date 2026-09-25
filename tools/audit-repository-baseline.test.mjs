#!/usr/bin/env node

/**
 * Pin the section-2 emit predicate in audit-repository-baseline.mjs.
 *
 * Three properties matter and each has broken a plausible reading of the rule:
 *   1. suffix stripping is iterative - `foo.js.d.ts` is the declaration emitted FOR the emitted
 *      `foo.js`, and it must resolve to the source `foo.ts`. A single strip looks for
 *      `foo.js.ts`, finds nothing, and reports the file as authored.
 *   2. the extension family is closed - a `.mjs` beside a `.ts` is an in-tree transpile artifact
 *      that this fleet's tracked `package.json` / `vite.config.mjs` often imports at runtime with
 *      no `.ts`->`.mjs` step to regenerate it, so it is deliberately out of scope. Flagging it
 *      would demand a code migration rather than an untrack.
 *   3. an authored ambient declaration (no same-stem source sibling) is never an offender.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, 'audit-repository-baseline.mjs');

function git(repo, args) {
  return execFileSync('git', ['-c', 'user.email=gate@test', '-c', 'user.name=gate', ...args], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-audit-'));
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, 'utf8');
  }
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'fixture']);
  return root;
}

/** The offender list the audit prints for tracked-compiler-emit. */
function offenders(root) {
  const run = spawnSync(process.execPath, [TOOL, '--root', root, '--only', 'tracked-compiler-emit'], {
    encoding: 'utf8',
  });
  assert.match(run.stdout, /^(?:PASS|FAIL) tracked-compiler-emit/um, run.stdout + run.stderr);
  const line = run.stdout.split(/\r?\n/u).find((entry) => entry.startsWith('PASS ') || entry.startsWith('FAIL '));
  const match = /\((\[.*\])\)$/u.exec(line);
  return JSON.parse(match ? match[1] : '[]');
}

test('iterative suffix stripping resolves emit-of-emit to its source', () => {
  const root = fixture({
    'src/foo.ts': 'export const a = 1;\n',
    'src/foo.js': 'export const a = 1;\n',
    'src/foo.js.d.ts': 'export declare const a: number;\n',
    'src/foo.d.ts': 'export declare const a: number;\n',
  });
  const found = offenders(root).sort();
  assert.deepEqual(found, ['src/foo.d.ts', 'src/foo.js', 'src/foo.js.d.ts'].sort());
});

test('map files are emit by definition, with or without a sibling', () => {
  const root = fixture({
    'src/with-source.ts': 'export const a = 1;\n',
    'src/with-source.js.map': '{}\n',
    'src/with-source.d.ts.map': '{}\n',
    'src/no-source.js.map': '{}\n',
  });
  const found = offenders(root).sort();
  // `no-source.js.map` strips to `no-source`, which has no .ts sibling, so it is NOT reported:
  // the sibling test still gates the map family. That is the shipped behaviour, pinned here so a
  // later change to it is a decision rather than an accident.
  assert.deepEqual(found, ['src/with-source.d.ts.map', 'src/with-source.js.map'].sort());
});

test('a .mjs beside its .ts source is out of scope on purpose', () => {
  const root = fixture({
    'scripts/shared-sdk-mode.ts': 'export const a = 1;\n',
    'scripts/shared-sdk-mode.mjs': 'export const a = 1;\n',
    'scripts/shared-sdk-mode.mjs.d.ts': 'export declare const a: number;\n',
    'scripts/shared-sdk-mode.d.ts': 'export declare const a: number;\n',
  });
  const found = offenders(root).sort();
  // The `.mjs` pair is an in-tree transpile artifact referenced at runtime; only the plain
  // `.d.ts`, which strips straight to `shared-sdk-mode`, is compiler emit.
  assert.deepEqual(found, ['scripts/shared-sdk-mode.d.ts']);
});

test('authored ambient declarations are never reported', () => {
  const root = fixture({
    'src/vite-env.d.ts': '/// <reference types="vite/client" />\n',
    'src/theme/sdkworkUiTheme.d.ts': 'declare module "@sdkwork/ui-pc-react/theme" { }\n',
    'src/plain.ts': 'export const a = 1;\n',
  });
  assert.deepEqual(offenders(root), []);
});
