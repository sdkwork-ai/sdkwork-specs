/**
 * Regression test for `run-gate-matrix.mjs`.
 *
 * The matrix is the workspace's only answer to "how many gates are red, and by how much", so
 * its two load-bearing pieces are tested directly:
 *   1. `countItems` must be deterministic and must read the three output shapes the fleet
 *      actually emits (rule tallies, "N finding(s)" summaries, bullet lists).
 *   2. The manifest must stay a valid registry: real tools, valid scopes, documented tiers,
 *      and a `check:`-prefixed id so the entries can be promoted into root scripts verbatim.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { countItems, looksLikeCrash } from './run-gate-matrix.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const SPECS_ROOT = path.resolve(TOOL_DIR, '..');

test('countItems reads a "N finding(s)" summary', () => {
  assert.equal(countItems('theme-conformance: 51 finding(s)\n'), 51);
  assert.equal(countItems('base-url resolution check failed: 24 finding(s) across 2 repo(s)\n'), 24);
});

test('countItems reads a "violations : N" summary', () => {
  const output = 'scanned files : 1137\nviolations    : 3\n';
  assert.equal(countItems(output), 3);
});

test('countItems reads the "N issue(s)" form', () => {
  assert.equal(countItems('workspace layout failed (1 issue(s)):\n'), 1);
});

test('countItems sums rule tallies', () => {
  const output = '             2  rust.module-file-case\n             1  rust.dependency-undeclared\n';
  assert.equal(countItems(output), 3);
});

test('countItems counts bullet evidence lines at any indent level', () => {
  const output = '- a/b.ts:1 bad\n- c/d.ts:2 bad\n  - nested/e.ts:3 bad\n';
  assert.equal(countItems(output), 3);
});

test('countItems ignores non-violation labels such as scan sizes', () => {
  // Only violation-ish labels become debt; "scanned files" must not be read as an item count.
  assert.equal(countItems('scanned files : 1137\n'), 0);
  assert.equal(countItems('files scanned: 0\nsubpath imports without exports coverage: 0\n'), 0);
});

test('countItems is deterministic and zero on clean output', () => {
  assert.equal(countItems('application layering check passed\n'), 0);
  assert.equal(countItems(''), 0);
  const sample = 'violations : 3\n12 some.rule\n- x\n';
  assert.equal(countItems(sample), countItems(sample));
});

test('countItems takes the maximum reading rather than double counting', () => {
  // Both a summary and bullets are present; the total must not be their sum.
  const output = 'violations    : 3\n  a/b.sh:1  [rm-pattern] nope\n  c/d.sh:2  [rm-pattern] nope\n  e/f.sh:3  [rm-pattern] nope\n';
  assert.equal(countItems(output), 3);
});

test('looksLikeCrash detects an unhandled exception dump', () => {
  // Real capture: check-sdk-standard died on a missing build artifact and its stack trace was
  // miscounted as 486 items, which would have been recorded as a debt baseline.
  const realCrash = [
    'node:internal/modules/cjs/loader:1215',
    '  throw err;',
    '  ^',
    '',
    "Error: ENOENT: no such file or directory, open 'E:\\\\sdkwork-space\\\\a\\\\lib\\\\types\\\\client\\\\platform.js'",
    '    at Module._extensions..js (node:internal/modules/cjs/loader:1435:10)',
    '    at Module.load (node:internal/modules/cjs/loader:1207:32)',
    '  errno: -4058,',
    "  code: 'ENOENT',",
    "  syscall: 'open',",
    '}',
    'Node.js v22.22.2',
  ].join('\n');
  assert.equal(looksLikeCrash(realCrash), true);
});

test('looksLikeCrash is false for ordinary gate output', () => {
  assert.equal(looksLikeCrash('theme-conformance: 51 finding(s)\n'), false);
  assert.equal(looksLikeCrash('violations    : 3\n'), false);
  assert.equal(looksLikeCrash('check-discovery-standard: ok\n'), false);
  // A gate legitimately mentioning "error" in a finding must not be mistaken for a crash.
  assert.equal(looksLikeCrash('- a/b.ts:1 typed error not handled\n'), false);
});

test('looksLikeCrash ignores a finding that quotes source text', () => {
  // Regression: an earlier version keyed on the bare phrase `throw new Error`, so a gate that
  // merely PRINTED a matched source line containing it was flagged as crashed. That wrongly
  // reported check-identity-naming as crashed in 13 repositories that were reporting findings.
  const quotedFinding = [
    'identity naming failed: found 1 identity naming issue(s)',
    '- crates/sdkwork-x-runtime/Cargo.toml:3: forbidden generic Rust runtime crate',
    '- apps/demo/src/boot.ts:12: transport must not throw new Error("x") in the bootstrap path',
  ].join('\n');
  assert.equal(looksLikeCrash(quotedFinding), false);
});

test('looksLikeCrash still catches the real crash capture', () => {
  // The genuine shape: version banner and/or Node frames plus an errno block.
  assert.equal(looksLikeCrash('Node.js v22.22.2\n'), true);
  assert.equal(
    looksLikeCrash('    at Object.readFileSync (node:fs:440:20)\n  errno: -4058,\n  code: ENOENT,\n'),
    true,
  );
  // Frames alone without an errno block are not conclusive.
  assert.equal(looksLikeCrash('    at Object.readFileSync (node:fs:440:20)\n'), false);
  // A non-Node frame is a user-code frame, not the fatal signature.
  assert.equal(looksLikeCrash('    at main (file:///E:/x/tool.mjs:72:23)\n  errno: -4058,\n'), false);
});

test('the gate manifest is a valid registry', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SPECS_ROOT, 'gates.manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.gates) && manifest.gates.length > 0);
  const ids = new Set();
  for (const gate of manifest.gates) {
    assert.match(gate.id, /^check:[a-z0-9-]+$/u, `${gate.id} must be a promotable check: script id`);
    assert.ok(!ids.has(gate.id), `duplicate gate id: ${gate.id}`);
    ids.add(gate.id);
    assert.ok(['workspace', 'repo', 'roots', 'fixed'].includes(gate.scope), `${gate.id} has an unsupported scope: ${gate.scope}`);
    assert.ok(['contract', 'guardrail'].includes(gate.tier), `${gate.id} has an unsupported tier: ${gate.tier}`);
    assert.equal(typeof gate.baseline, 'number', `${gate.id} must record a numeric baseline`);
    assert.ok(Array.isArray(gate.argv), `${gate.id} must record its argv`);
    assert.ok(
      fs.existsSync(path.join(SPECS_ROOT, 'tools', gate.tool)),
      `${gate.id} references a missing tool: ${gate.tool}`,
    );
    if (gate.scope === 'workspace') {
      assert.ok(gate.argv.includes('--workspace'), `${gate.id} is workspace-scoped but never passes --workspace`);
      assert.ok(gate.argv.includes('{workspace}'), `${gate.id} must template the workspace root`);
    }
    if (gate.scope === 'repo') {
      assert.ok(gate.argv.includes('{repo}'), `${gate.id} is repo-scoped but never templates the repo root`);
    }
    // A batched gate must declare the flag it repeats, otherwise the expansion silently drops
    // every repository and the gate reports a clean fleet run it never performed.
    if (gate.scope === 'roots') {
      assert.ok(gate.argv.includes('{roots}'), `${gate.id} is roots-scoped but never templates the repo list`);
      assert.ok(
        typeof gate.rootsFlag === 'string' && gate.rootsFlag.startsWith('--'),
        `${gate.id} is roots-scoped but declares no repeatable flag`,
      );
    }
    // `fixed` gates assert a hardcoded target, so they must say so. Without a note they read as
    // fleet coverage, which is exactly the misunderstanding this scope exists to prevent.
    if (gate.scope === 'fixed') {
      assert.ok(
        !gate.argv.some((value) => value.includes('{')),
        `${gate.id} is fixed-scoped and must not template a root`,
      );
      assert.ok(typeof gate.note === 'string' && gate.note.length > 0, `${gate.id} is fixed-scoped and must explain why`);
    }
  }
});

test('no manifest gate is already part of the check:all contract', () => {
  // `check:all` is the single source of truth for the contract tier; duplicating an entry in
  // the manifest would give the same fact two authorities that can drift apart.
  const workspace = path.resolve(SPECS_ROOT, '..');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
  const chain = rootPkg.scripts['check:all'];
  const contractGates = new Set([...chain.matchAll(/pnpm run ([a-z0-9:-]+)/giu)].map((m) => m[1]));
  const manifest = JSON.parse(fs.readFileSync(path.join(SPECS_ROOT, 'gates.manifest.json'), 'utf8'));
  for (const gate of manifest.gates) {
    assert.ok(
      !contractGates.has(gate.id),
      `${gate.id} is both in check:all and in the manifest; keep exactly one authority`,
    );
  }
});
