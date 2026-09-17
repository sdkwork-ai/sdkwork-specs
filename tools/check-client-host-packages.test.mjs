import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkClientHostPackages } from './check-client-host-packages.mjs';

/**
 * Build a throwaway workspace from a `repo -> client root -> host package` spec
 * and return the workspace root.
 *
 * @param {Record<string, Record<string, string[]>>} spec
 *   e.g. { 'sdkwork-shop': { 'sdkwork-shop-pc': ['sdkwork-shop-pc-tauri'] } }
 *   A package name wrapped in `( )` is created without a package.json.
 */
function fixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-host-'));
  for (const [repo, roots] of Object.entries(spec)) {
    fs.mkdirSync(path.join(root, repo, '.git'), { recursive: true });
    for (const [appRoot, hosts] of Object.entries(roots)) {
      for (const declared of hosts) {
        const bare = declared.startsWith('(') && declared.endsWith(')');
        const name = bare ? declared.slice(1, -1) : declared;
        const dir = path.join(root, repo, 'apps', appRoot, 'packages', name);
        fs.mkdirSync(dir, { recursive: true });
        if (!bare) {
          fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }), 'utf8');
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

test('rejects a host package without a package.json', () => {
  const result = scan({ 'sdkwork-shop': { 'sdkwork-shop-harmony-mobile': ['(sdkwork-shop-harmony-mobile-host)'] } });
  assert.ok(messages(result, 'error').some((m) => /has no package\.json/u.test(m)));
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
