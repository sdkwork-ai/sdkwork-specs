import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkClientHostPackages } from './check-client-host-packages.mjs';

/**
 * Ecosystem manifest of a client root, keyed by the root directory suffix.
 *
 * A client root uses the package manager of its target ecosystem, so the fixture
 * must not hand every package a `package.json`: doing that is what made an earlier
 * revision of the gate report five false findings against Harmony roots, which
 * have no `package.json` at all.
 */
const MANIFEST_BY_SUFFIX = [
  ['-harmony-mobile', 'oh-package.json5'],
  ['-flutter-mobile', 'pubspec.yaml'],
  ['-android-mobile', 'build.gradle.kts'],
  ['-ios-mobile', 'Package.swift'],
];

/** Manifest filename a client root of this name expects in each of its packages. */
function manifestNameOf(appRoot) {
  for (const [suffix, manifest] of MANIFEST_BY_SUFFIX) {
    if (appRoot.endsWith(suffix)) return manifest;
  }
  return 'package.json';
}

/**
 * Build a throwaway workspace from a `repo -> client root -> host package` spec
 * and return the workspace root.
 *
 * @param {Record<string, Record<string, string[]>>} spec
 *   e.g. { 'sdkwork-shop': { 'sdkwork-shop-pc': ['sdkwork-shop-pc-tauri'] } }
 *   A package name wrapped in `( )` is created with no ecosystem manifest at all.
 *   A package name prefixed with `+` is created with its ecosystem manifest plus an
 *   extra `package.json`, modelling the inert duplicate manifest case.
 */
function fixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-host-'));
  for (const [repo, roots] of Object.entries(spec)) {
    fs.mkdirSync(path.join(root, repo, '.git'), { recursive: true });
    for (const [appRoot, hosts] of Object.entries(roots)) {
      for (const declared of hosts) {
        const bare = declared.startsWith('(') && declared.endsWith(')');
        const extraManifest = declared.startsWith('+');
        const name = bare
          ? declared.slice(1, -1)
          : extraManifest
            ? declared.slice(1)
            : declared;
        const dir = path.join(root, repo, 'apps', appRoot, 'packages', name);
        fs.mkdirSync(dir, { recursive: true });
        const payload = JSON.stringify({ name });
        if (!bare) {
          fs.writeFileSync(path.join(dir, manifestNameOf(appRoot)), payload, 'utf8');
        }
        if (extraManifest) {
          fs.writeFileSync(path.join(dir, 'package.json'), payload, 'utf8');
        }
      }
    }
  }
  return root;
}

function scan(spec) {
  const workspaceRoot = fixture(spec);
  try {
    return checkClientHostPackages({ workspaceRoot });
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const messages = (result, severity) => result.violations
  .filter((v) => (severity ? v.severity === severity : true))
  .map((v) => v.message);

test('accepts every canonical host name', () => {
  const result = scan({
    'sdkwork-shop': {
      'sdkwork-shop-pc': ['sdkwork-shop-pc-tauri', 'sdkwork-shop-pc-electron', 'sdkwork-shop-pc-capacitor'],
      'sdkwork-shop-h5': ['sdkwork-shop-h5-capacitor'],
      'sdkwork-shop-mini-program': ['sdkwork-shop-mp-host'],
      'sdkwork-shop-harmony-mobile': ['sdkwork-shop-harmony-mobile-host'],
      'sdkwork-shop-common': [],
    },
  });
  assert.deepEqual(result.violations, []);
});

test('reports the retired -pc-desktop alias as migration debt, not an error', () => {
  const result = scan({ 'sdkwork-shop': { 'sdkwork-shop-pc': ['sdkwork-shop-pc-desktop'] } });
  assert.equal(messages(result, 'error').length, 0);
  assert.equal(messages(result, 'debt').length, 1);
  assert.match(messages(result, 'debt')[0], /rename to 'sdkwork-shop-pc-tauri'/u);
});

test('rejects a generic -pc-host and a generic -h5-host', () => {
  const pc = scan({ 'sdkwork-shop': { 'sdkwork-shop-pc': ['sdkwork-shop-pc-host'] } });
  assert.ok(messages(pc, 'error').some((m) => /generic '-pc-host' is non-canonical/u.test(m)));

  const h5 = scan({ 'sdkwork-shop': { 'sdkwork-shop-h5': ['sdkwork-shop-h5-host'] } });
  assert.ok(messages(h5, 'error').some((m) => /generic '-h5-host' is non-canonical/u.test(m)));
});

test('rejects a host package owned by a client root that defines no host', () => {
  const result = scan({
    'sdkwork-shop': { 'sdkwork-shop-flutter-mobile': ['sdkwork-shop-flutter-mobile-host'] },
  });
  assert.ok(messages(result, 'error').some((m) => /defines no native host/u.test(m)));
});

test('requires the manifest of the root ecosystem, not package.json', () => {
  // A Harmony root has no `package.json` at all; `oh-package.json5` is its manifest.
  const missing = scan({
    'sdkwork-shop': { 'sdkwork-shop-harmony-mobile': ['(sdkwork-shop-harmony-mobile-host)'] },
  });
  assert.ok(messages(missing, 'error').some((m) => /has no oh-package\.json5/u.test(m)));
  // `/package\.json/` alone would also match the tail of `oh-package.json5`, which is
  // exactly the substring confusion this whole rule exists to avoid.
  assert.equal(messages(missing, 'error').some((m) => /has no package\.json$/u.test(m)), false);

  // A JavaScript-family root is still held to `package.json`.
  const pcMissing = scan({
    'sdkwork-shop': { 'sdkwork-shop-pc': ['(sdkwork-shop-pc-tauri)'] },
  });
  assert.ok(messages(pcMissing, 'error').some((m) => /has no package\.json/u.test(m)));
});

test('accepts a Harmony host package that carries only oh-package.json5', () => {
  const result = scan({
    'sdkwork-shop': { 'sdkwork-shop-harmony-mobile': ['sdkwork-shop-harmony-mobile-host'] },
  });
  assert.deepEqual(result.violations, []);
});

test('reports an inert package.json inside a native host package as migration debt', () => {
  const result = scan({
    'sdkwork-shop': { 'sdkwork-shop-harmony-mobile': ['+sdkwork-shop-harmony-mobile-host'] },
  });
  assert.equal(messages(result, 'error').length, 0);
  assert.equal(messages(result, 'debt').length, 1);
  assert.match(messages(result, 'debt')[0], /inert 'package\.json'/u);
});

test('rejects two host packages for the same architecture in one client root', () => {
  const result = scan({
    'sdkwork-shop': { 'sdkwork-shop-pc': ['sdkwork-shop-pc-tauri', 'sdkwork-shop-pc-desktop'] },
  });
  assert.ok(messages(result, 'error').some((m) => /duplicate host package for architecture 'tauri'/u.test(m)));
});

test('rejects a host package that does not carry its application code', () => {
  const result = scan({
    'sdkwork-video-cut': { 'sdkwork-video-cut-pc': ['sdkwork-autocut-desktop'] },
  });
  assert.ok(messages(result, 'error')
    .some((m) => /does not carry the application code 'video-cut'/u.test(m)));
});

test('ignores client roots without a packages directory and non-client roots', () => {
  const workspaceRoot = fixture({ 'sdkwork-shop': { 'sdkwork-shop-pc': [] } });
  try {
    fs.mkdirSync(path.join(workspaceRoot, 'sdkwork-shop', 'apps', 'sdkwork-shop-common', 'packages', 'sdkwork-shop-common-host'), { recursive: true });
    const result = checkClientHostPackages({ workspaceRoot });
    assert.deepEqual(result.scanned, []);
    assert.deepEqual(result.violations, []);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('scans a single repository passed as --root', () => {
  const workspaceRoot = fixture({ 'sdkwork-shop': { 'sdkwork-shop-pc': ['sdkwork-shop-pc-desktop'] } });
  try {
    const result = checkClientHostPackages({
      repoRoots: [path.join(workspaceRoot, 'sdkwork-shop')],
    });
    assert.equal(result.scanned.length, 1);
    assert.equal(result.violations.length, 1);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('exits 2 instead of reporting a clean run for a workspace root with no repository', () => {
  const cli = fileURLToPath(new URL('./check-client-host-packages.mjs', import.meta.url));
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'client-host-empty-'));
  try {
    let status = 0;
    let output = '';
    try {
      execFileSync(process.execPath, [cli, '--workspace', emptyRoot], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      status = error.status;
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    assert.equal(status, 2);
    assert.match(output, /no governed repository found/u);

    // The same root passes once it actually holds a governed repository.
    fs.mkdirSync(path.join(emptyRoot, 'sdkwork-shop', '.git'), { recursive: true });
    const ok = execFileSync(process.execPath, [cli, '--workspace', emptyRoot], { encoding: 'utf8', stdio: 'pipe' });
    assert.match(ok, /OK \(0 client host package/u);
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});
