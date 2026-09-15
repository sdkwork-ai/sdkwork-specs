/**
 * Regression test for `check-workspace-path-portability.mjs`.
 *
 * The gate is the only executor of `DEPENDENCY_MANAGEMENT_SPEC.md` section 1
 * ("Source/build dependency paths `MUST` be repository-relative, workspace-relative,
 * or native package-manager coordinates ... `MUST NOT` be machine-specific absolute
 * paths"). Those clauses were normative for months with no gate behind them, and the
 * fleet accumulated over a thousand absolute bindings that all broke at once when the
 * workspace moved drives — so the gate's own behaviour is worth pinning.
 *
 * The gate is a top-level script that calls `main()` on import, so it is exercised as
 * a subprocess against a throwaway fixture root. That also pins the parts a unit test
 * of a pure function would miss: the exit code, the rule names in the output, and the
 * exemption accounting printed on success.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const GATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-workspace-path-portability.mjs');

// A Windows drive-rooted path is what every one of the fleet's thousand bindings
// looked like; the POSIX home form covers the macOS-authored half.
// Every fixture path is assembled from fragments so that this file does not itself
// contain a literal the gate would report: a fixture is written this way rather than
// carrying a marker, because a test of the gate that exempts itself proves less.
const WIN_WORKSPACE = 'D:' + '\\' + 'sdkwork-space' + '\\' + 'sdkwork-im';
const POSIX_WORKSPACE = '/mnt/d' + '/sdkwork-space/sdkwork-im';
const SIBLING = 'D:' + '\\' + 'projects' + '\\' + 'sdkwork-cloudrouter';
const MACHINE_ONLY = 'D:' + '\\' + 'toolchains' + '\\' + 'node';
const RUNTIME_ROOT = 'C:/Program Files/sdkwork-tts';
const FILE_URL = ['file:', '', '', 'D:', 'sdkwork-space', 'sdkwork-im', 'x.js'].join('/');

function makeRoot(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'port-gate-'));
  for (const [relative, text] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

function runGate(root, extraArgs = []) {
  const run = spawnSync(process.execPath, [GATE, '--root', root, ...extraArgs], {
    encoding: 'utf8',
  });
  return {
    code: run.status,
    output: (run.stdout || '') + (run.stderr || ''),
  };
}

test('reports a workspace-rooted absolute path in source as WORKSPACE-ABS', () => {
  const root = makeRoot({
    'src/a.ts': 'const p = "' + WIN_WORKSPACE + '/src/App.tsx";\n',
    'src/b.ts': 'const q = "' + POSIX_WORKSPACE + '";\n',
  });
  const { code, output } = runGate(root);
  assert.equal(code, 1);
  assert.match(output, /WORKSPACE-ABS/);
  assert.match(output, /a\.ts:1/);
  assert.match(output, /b\.ts:1/);
});

test('reports a sibling checkout reference as SIBLING-REPO-ABS', () => {
  const root = makeRoot({
    'src/a.ts': 'const p = "' + SIBLING + '/apps/x";\n',
  });
  const { code, output } = runGate(root);
  assert.equal(code, 1);
  assert.match(output, /SIBLING-REPO-ABS/);
});

test('detects the file: URL form, whose scheme hides the absolute root', () => {
  const root = makeRoot({
    'src/a.mjs': 'await import("' + FILE_URL + '");\n',
  });
  const { code, output } = runGate(root);
  assert.equal(code, 1);
  assert.match(output, /WORKSPACE-ABS/);
});

test('passes a repository-relative and a package-manager path', () => {
  const root = makeRoot({
    'src/a.ts': 'import x from "../sibling/src/x";\nimport y from "@sdkwork/core";\n',
  });
  const { code, output } = runGate(root);
  assert.equal(code, 0, output);
  assert.match(output, /passed/);
});

test('a line marker exempts a multi-line statement, not just one physical line', () => {
  // rustfmt and prettier wrap one call across several rows; a two-line window read the
  // marker as absent and reported an assertion the author had already marked.
  const body = [
    '// WORKSPACE-PATH:allow - the literal is the subject of the assertion.',
    'assert_eq!(',
    '    normalize("' + WIN_WORKSPACE + '"),',
    '    "' + POSIX_WORKSPACE + '"',
    ');',
    '',
  ].join('\n');
  const root = makeRoot({ 'src/a.rs': body });
  const { code, output } = runGate(root);
  assert.equal(code, 0, output);
  assert.match(output, /1 line exemption\(s\) declared/);
});

test('a fixture marker exempts a whole test file and the file is listed', () => {
  const body = [
    '// WORKSPACE-PATH:allow-fixture - fixtures simulate a foreign checkout root.',
    "import test from 'node:test';",
    "test('derives a chunk name', () => {",
    '  assert.equal(chunkOf("' + WIN_WORKSPACE + '/packages/p/src/a.ts"), "p");',
    '});',
    '',
  ].join('\n');
  const root = makeRoot({ 'tests/chunk.test.ts': body });
  const { code, output } = runGate(root);
  assert.equal(code, 0, output);
  assert.match(output, /1 fixture-exempt test file\(s\)/);
  assert.match(output, /fixture-exempt test file:/);
});

test('a fixture marker has no effect outside a test file', () => {
  const body = [
    '// WORKSPACE-PATH:allow-fixture - wishful thinking in production source.',
    'export const workspace = "' + WIN_WORKSPACE + '";',
    '',
  ].join('\n');
  const root = makeRoot({ 'src/config.ts': body });
  const { code, output } = runGate(root);
  assert.equal(code, 1);
  assert.match(output, /FIXTURE-MARKER-NOT-APPLICABLE/);
  assert.match(output, /WORKSPACE-ABS/);
});

test('skips dependency, build-output, and agent-scratch directories', () => {
  const body = 'const p = "' + WIN_WORKSPACE + '";\n';
  const root = makeRoot({
    'node_modules/pkg/a.ts': body,
    'target/debug/a.ts': body,
    'dist/a.ts': body,
    'obj/a.ts': body,
    '.vs/a.ts': body,
    '.dart_tool/a.ts': body,
    'external/vendor/a.ts': body,
    '.workbuddy/a.ts': body,
    'pnpm-lock.yaml': '  resolution: ' + WIN_WORKSPACE + '\n',
  });
  const { code, output } = runGate(root);
  assert.equal(code, 0, output);
});

test('reports a machine-rooted path by default and drops it under --workspace-only', () => {
  const root = makeRoot({ 'src/a.ts': 'const t = "' + MACHINE_ONLY + '/bin";\n' });
  const wider = runGate(root);
  assert.equal(wider.code, 1);
  assert.match(wider.output, /MACHINE-ABS/);
  const narrow = runGate(root, ['--workspace-only']);
  assert.equal(narrow.code, 0, narrow.output);
});

test('does not mistake a regular-expression escape for a filesystem root', () => {
  // Normalising `\` to `/` turns `/\s/` into `/s/`, which lands on the
  // single-letter POSIX branch — the artefact that produced 526 phantom
  // findings across the fleet before the raw-token guard was added.
  const root = makeRoot({
    'src/a.ts': 'const r = /\\s/.test(x);\nconst n = /\\n/g;\nconst t = /t\\(/;\n',
  });
  const { code, output } = runGate(root);
  assert.equal(code, 0, output);
});

test('never reports a runtime install root, even when machine paths are included', () => {
  const root = makeRoot({ 'docs/deploy.md': 'Install to `' + RUNTIME_ROOT + '`.\n' });
  const { code, output } = runGate(root, ['--include-machine-paths']);
  assert.equal(code, 0, output);
});

test('does not mistake an HTTP route for a filesystem path', () => {
  const root = makeRoot({ 'docs/api.md': 'GET /api/sdkwork-appstore/v1/items\n' });
  const { code, output } = runGate(root);
  assert.equal(code, 0, output);
});

test('fails when the root does not exist', () => {
  const { code, output } = runGate(path.join(os.tmpdir(), 'port-gate-does-not-exist-' + Date.now()));
  assert.equal(code, 1);
  assert.match(output, /root does not exist/);
});
