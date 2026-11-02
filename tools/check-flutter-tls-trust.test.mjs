import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CHECKER = path.resolve(import.meta.dirname, 'check-flutter-tls-trust.mjs');

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-flutter-tls-'));
  const template = path.join(
    path.resolve(import.meta.dirname, '..'),
    'templates',
    'flutter',
  );
  writeText(
    path.join(root, 'sdkwork-specs', 'templates', 'flutter', 'sdkwork_tls_trust.dart'),
    fs.readFileSync(path.join(template, 'sdkwork_tls_trust.dart'), 'utf8'),
  );
  writeText(
    path.join(root, 'sdkwork-specs', 'templates', 'flutter', 'sdkwork_tls_trust_test.dart'),
    fs.readFileSync(path.join(template, 'sdkwork_tls_trust_test.dart'), 'utf8'),
  );
  return root;
}

function makeApp(root, { name = 'sdkwork-demo-flutter-mobile', body } = {}) {
  const app = path.join(root, 'sdkwork-demo', 'apps', name);
  writeText(
    path.join(app, 'pubspec.yaml'),
    'name: demo\n\ndependencies:\n  flutter:\n    sdk: flutter\n',
  );
  writeText(
    path.join(app, 'lib', 'main.dart'),
    body ??
      "import 'package:flutter/material.dart';\n\n" +
        "import 'bootstrap/sdkwork_tls_trust.dart';\n\n" +
        'void main() {\n' +
        '  SdkworkTlsTrust.installForApp();\n' +
        '  runApp(const SizedBox());\n' +
        '}\n',
  );
  return app;
}

function run(args) {
  return spawnSync(process.execPath, [CHECKER, ...args], {
    encoding: 'utf8',
  });
}

test('accepts an app that vendors and installs the trust layer', () => {
  const root = makeWorkspace();
  const app = makeApp(root);
  const specs = path.join(root, 'sdkwork-specs');

  const fixes = run(['--workspace', root, '--fix']);
  assert.equal(fixes.status, 0, fixes.stdout + fixes.stderr);

  assert.ok(fs.existsSync(path.join(app, 'lib', 'bootstrap', 'sdkwork_tls_trust.dart')));
  assert.ok(fs.existsSync(path.join(app, 'test', 'bootstrap', 'sdkwork_tls_trust_test.dart')));

  const check = run(['--workspace', root, '--json']);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const payload = JSON.parse(check.stdout);
  assert.equal(payload.results[0].status, 'ok');
  assert.ok(fs.existsSync(path.join(specs, 'templates', 'flutter', 'sdkwork_tls_trust.dart')));
});

test('fails when the install call is missing from main', () => {
  const root = makeWorkspace();
  makeApp(root, {
    body: "import 'package:flutter/material.dart';\n\nvoid main() {\n  runApp(const SizedBox());\n}\n",
  });
  run(['--workspace', root, '--fix']);

  const check = run(['--workspace', root]);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /missing-install-call|missing-trust-import/);
});

test('fails when the trust layer is installed after the binding', () => {
  const root = makeWorkspace();
  makeApp(root, {
    body:
      "import 'package:flutter/material.dart';\n\n" +
      "import 'bootstrap/sdkwork_tls_trust.dart';\n\n" +
      'void main() {\n' +
      '  WidgetsFlutterBinding.ensureInitialized();\n' +
      '  SdkworkTlsTrust.installForApp();\n' +
      '  runApp(const SizedBox());\n' +
      '}\n',
  });
  run(['--workspace', root, '--fix']);

  const check = run(['--workspace', root]);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /trust-installed-after-startup/);
});

test('fails when a vendored copy drifts from the template', () => {
  const root = makeWorkspace();
  const app = makeApp(root);
  run(['--workspace', root, '--fix']);
  const vendored = path.join(app, 'lib', 'bootstrap', 'sdkwork_tls_trust.dart');
  fs.writeFileSync(vendored, `${fs.readFileSync(vendored, 'utf8')}\n// local drift\n`);

  const check = run(['--workspace', root]);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /stale-vendored-file/);

  const fixed = run(['--workspace', root, '--fix']);
  assert.equal(fixed.status, 0, fixed.stdout);
});

test('fails when application code overrides certificate validation', () => {
  const root = makeWorkspace();
  const app = makeApp(root);
  run(['--workspace', root, '--fix']);
  writeText(
    path.join(app, 'lib', 'services', 'legacy_http.dart'),
    "import 'dart:io';\n\nHttpClient build() => HttpClient()..badCertificateCallback = (c, h, p) => true;\n",
  );

  const check = run(['--workspace', root]);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /certificate-override-outside-template/);
});

test('reports apps without a runtime entrypoint instead of failing them', () => {
  const root = makeWorkspace();
  const app = makeApp(root);
  fs.rmSync(path.join(app, 'lib', 'main.dart'));
  run(['--workspace', root, '--fix']);

  const check = run(['--workspace', root, '--json']);
  assert.equal(check.status, 0, check.stdout);
  assert.equal(JSON.parse(check.stdout).results[0].status, 'no-runtime');
});
