import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  classifyModuleEndpointEnvVar,
  validateBackendModuleCallBoundary,
} from './lib/backend-module-call-boundary.mjs';

const CHECKER = path.resolve(import.meta.dirname, 'check-backend-module-call-boundary.mjs');

function createRepo({ crateName, source, allowlist }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-call-boundary-'));
  const srcDir = path.join(root, 'crates', crateName, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'lib.rs'), source, 'utf8');
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  if (allowlist) {
    fs.writeFileSync(
      path.join(root, 'specs', 'backend-module-call-boundary.allow.json'),
      JSON.stringify({ allow: allowlist }, null, 2),
      'utf8',
    );
  }
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('classifies sibling module endpoints and ignores external vendors', () => {
  assert.deepEqual(classifyModuleEndpointEnvVar('SDKWORK_ORDER_BACKEND_API_BASE_URL'), {
    module: 'order',
  });
  assert.deepEqual(classifyModuleEndpointEnvVar('SDKWORK_ACCOUNT_BACKEND_API_ORIGIN'), {
    module: 'account',
  });
  assert.deepEqual(classifyModuleEndpointEnvVar('APPSTORE_DRIVE_BASE_URL'), { module: 'drive' });

  // External providers and shared infrastructure are never violations.
  assert.equal(classifyModuleEndpointEnvVar('SDKWORK_OPENAI_API_BASE_URL'), null);
  assert.equal(classifyModuleEndpointEnvVar('STRIPE_WEBHOOK_BASE_URL'), null);
  assert.equal(classifyModuleEndpointEnvVar('SDKWORK_DATABASE_URL'), null);
  // Not an endpoint at all.
  assert.equal(classifyModuleEndpointEnvVar('SDKWORK_ORDER_EXPIRATION_BATCH_SIZE'), null);
});

test('flags backend code that calls a sibling module over HTTP', () => {
  const root = createRepo({
    crateName: 'sdkwork-community-service',
    source: [
      'pub fn order_base_url() -> Option<String> {',
      '    std::env::var("SDKWORK_ORDER_BACKEND_API_BASE_URL").ok()',
      '}',
    ].join('\n'),
  });
  try {
    const issues = validateBackendModuleCallBoundary(root);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].envVar, 'SDKWORK_ORDER_BACKEND_API_BASE_URL');
    assert.equal(issues[0].line, 2);
    assert.match(issues[0].message, /in-process/);
  } finally {
    cleanup(root);
  }
});

test('client and tool crates may speak HTTP to the gateway', () => {
  const root = createRepo({
    crateName: 'sdkwork-agents-tool-cloudrouter',
    source: 'fn f() { let _ = std::env::var("SDKWORK_CLOUDROUTER_BACKEND_API_BASE_URL"); }',
  });
  try {
    assert.deepEqual(validateBackendModuleCallBoundary(root), []);
  } finally {
    cleanup(root);
  }
});

test('an allowlist entry needs a written reason', () => {
  const source = 'fn f() { let _ = std::env::var("SDKWORK_ACCOUNT_BACKEND_API_ORIGIN"); }';
  const withReason = createRepo({
    crateName: 'sdkwork-order-integration-account',
    source,
    allowlist: [
      {
        file: 'crates/sdkwork-order-integration-account/src/lib.rs',
        envVar: 'SDKWORK_ACCOUNT_BACKEND_API_ORIGIN',
        reason: 'opt-in split deployment; the default mode is in-process',
      },
    ],
  });
  const withoutReason = createRepo({
    crateName: 'sdkwork-order-integration-account',
    source,
    allowlist: [
      {
        file: 'crates/sdkwork-order-integration-account/src/lib.rs',
        envVar: 'SDKWORK_ACCOUNT_BACKEND_API_ORIGIN',
        reason: '   ',
      },
    ],
  });
  try {
    assert.deepEqual(validateBackendModuleCallBoundary(withReason), []);
    assert.equal(validateBackendModuleCallBoundary(withoutReason).length, 1);
  } finally {
    cleanup(withReason);
    cleanup(withoutReason);
  }
});

test('the CLI exits 1 on a violation and 0 when clean', () => {
  const dirty = createRepo({
    crateName: 'sdkwork-feeds-source-news',
    source: 'fn f() { let _ = std::env::var("SDKWORK_NEWS_OPEN_API_BASE_URL"); }',
  });
  const clean = createRepo({
    crateName: 'sdkwork-feeds-source-news',
    source: 'fn f() { let _ = 1; }',
  });
  try {
    const failed = spawnSync(process.execPath, [CHECKER, '--root', dirty], { encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stderr, /cross-module HTTP calls found/);

    const passed = spawnSync(process.execPath, [CHECKER, '--root', clean], { encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.stdout, /check passed/);
  } finally {
    cleanup(dirty);
    cleanup(clean);
  }
});
