#!/usr/bin/env node
/**
 * Flutter HTTPS trust checker per FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md
 * section 9.1, DART_CODE_SPEC.md section 17, and SECURITY_SPEC.md section 6.2.
 *
 * Every Flutter application root in the workspace must:
 * - vendor `lib/bootstrap/sdkwork_tls_trust.dart` byte-identical to
 *   `templates/flutter/sdkwork_tls_trust.dart`;
 * - vendor `test/bootstrap/sdkwork_tls_trust_test.dart` byte-identical to
 *   `templates/flutter/sdkwork_tls_trust_test.dart`;
 * - install the layer from `main()` before the binding and before `runApp`;
 * - keep certificate overrides out of application code (only the vendored
 *   template may touch `badCertificateCallback` or `HttpOverrides.global`).
 *
 * Usage:
 *   node <specs>/tools/check-flutter-tls-trust.mjs --workspace <workspace-root>
 *   node <specs>/tools/check-flutter-tls-trust.mjs --workspace . --fix
 *   node <specs>/tools/check-flutter-tls-trust.mjs --workspace . --json
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = path.join(SPECS_ROOT, 'templates', 'flutter');
const TEMPLATE_LIB = 'sdkwork_tls_trust.dart';
const TEMPLATE_TEST = 'sdkwork_tls_trust_test.dart';
const VENDORED_LIB = path.join('lib', 'bootstrap', TEMPLATE_LIB);
const VENDORED_TEST = path.join('test', 'bootstrap', TEMPLATE_TEST);
const INSTALL_PATTERN = /SdkworkTlsTrust\.install(ForApp|FromEnvironment)?\s*\(/;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function discoverApps(workspace) {
  const apps = [];
  for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) continue;
    const appsDir = path.join(workspace, entry.name, 'apps');
    if (!fs.existsSync(appsDir)) continue;
    for (const app of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (!app.isDirectory()) continue;
      const appRoot = path.join(appsDir, app.name);
      const pubspec = path.join(appRoot, 'pubspec.yaml');
      if (!fs.existsSync(pubspec)) continue;
      const body = fs.readFileSync(pubspec, 'utf8');
      if (!/^\s{2}flutter:/m.test(body)) continue;
      apps.push(appRoot);
    }
  }
  return apps.sort();
}

function readTemplate(name) {
  const file = path.join(TEMPLATE_DIR, name);
  if (!fs.existsSync(file)) {
    throw new Error(`missing template: ${file}`);
  }
  return fs.readFileSync(file, 'utf8');
}

function checkApp(appRoot, templates) {
  const problems = [];
  const status = { app: appRoot, problems, status: 'ok' };

  const mainPath = path.join(appRoot, 'lib', 'main.dart');
  if (!fs.existsSync(mainPath)) {
    return { ...status, status: 'no-runtime' };
  }

  for (const [relPath, template] of [
    [VENDORED_LIB, templates.lib],
    [VENDORED_TEST, templates.test],
  ]) {
    const file = path.join(appRoot, relPath);
    if (!fs.existsSync(file)) {
      problems.push({ code: 'missing-vendored-file', file: relPath });
      continue;
    }
    if (sha256(fs.readFileSync(file, 'utf8')) !== sha256(template)) {
      problems.push({ code: 'stale-vendored-file', file: relPath });
    }
  }

  const main = fs.readFileSync(mainPath, 'utf8');
  if (!main.includes("bootstrap/sdkwork_tls_trust.dart")) {
    problems.push({ code: 'missing-trust-import', file: 'lib/main.dart' });
  }
  const installMatch = main.match(INSTALL_PATTERN);
  if (!installMatch) {
    problems.push({ code: 'missing-install-call', file: 'lib/main.dart' });
  } else {
    const installAt = installMatch.index ?? 0;
    for (const anchor of ['runApp(', 'WidgetsFlutterBinding.ensureInitialized(']) {
      const anchorAt = main.indexOf(anchor);
      if (anchorAt >= 0 && anchorAt < installAt) {
        problems.push({
          code: 'trust-installed-after-startup',
          file: 'lib/main.dart',
          detail: `${anchor} runs before the trust layer is installed`,
        });
      }
    }
  }

  if (problems.length > 0) status.status = 'fail';
  return status;
}

function auditApplicationOverrides(workspace, apps) {
  const findings = [];
  const allowed = new Set(
    apps.map((app) => path.resolve(app, VENDORED_LIB)),
  );
  for (const app of apps) {
    const libDir = path.join(app, 'lib');
    if (!fs.existsSync(libDir)) continue;
    const stack = [libDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(file);
          continue;
        }
        if (!entry.name.endsWith('.dart')) continue;
        if (allowed.has(path.resolve(file))) continue;
        const body = fs.readFileSync(file, 'utf8');
        if (/badCertificateCallback\s*=|HttpOverrides\.global\s*=/.test(body)) {
          findings.push({
            code: 'certificate-override-outside-template',
            file: path.relative(workspace, file),
          });
        }
      }
    }
  }
  return findings;
}

function repairApp(appRoot, templates) {
  const repairs = [];
  for (const [relPath, template] of [
    [VENDORED_LIB, templates.lib],
    [VENDORED_TEST, templates.test],
  ]) {
    const file = path.join(appRoot, relPath);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === template) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, template);
    repairs.push(relPath);
  }
  return repairs;
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string', default: process.cwd() },
      fix: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(
      'check-flutter-tls-trust --workspace <root> [--fix] [--json]\n' +
        'Verifies every Flutter app vendors and installs the SDKWork HTTPS trust layer.',
    );
    return 0;
  }

  const workspace = path.resolve(values.workspace);
  const apps = discoverApps(workspace);
  const templates = { lib: readTemplate(TEMPLATE_LIB), test: readTemplate(TEMPLATE_TEST) };
  const results = [];
  const repaired = [];

  for (const app of apps) {
    if (values.fix) {
      const fixes = repairApp(app, templates);
      if (fixes.length > 0) repaired.push({ app, files: fixes });
    }
    results.push(checkApp(app, templates));
  }

  for (const finding of auditApplicationOverrides(workspace, apps)) {
    const owner = results.find((result) => finding.file.startsWith(
      path.relative(workspace, result.app) + path.sep,
    ));
    if (owner) {
      owner.problems.push(finding);
      owner.status = 'fail';
    }
  }

  if (values.json) {
    console.log(JSON.stringify({ workspace, apps: results.length, results, repaired }, null, 2));
  } else {
    for (const result of results) {
      const label = path.relative(workspace, result.app);
      if (result.status === 'no-runtime') {
        console.log(`SKIP  ${label} (no lib/main.dart)`);
        continue;
      }
      if (result.status === 'ok') {
        console.log(`OK    ${label}`);
        continue;
      }
      console.log(`FAIL  ${label}`);
      for (const problem of result.problems) {
        const detail = problem.detail ? ` - ${problem.detail}` : '';
        console.log(`        ${problem.code}: ${problem.file}${detail}`);
      }
    }
    for (const repair of repaired) {
      console.log(`FIXED ${path.relative(workspace, repair.app)}: ${repair.files.join(', ')}`);
    }
    const failed = results.filter((result) => result.status === 'fail');
    const skipped = results.filter((result) => result.status === 'no-runtime');
    console.log(
      `\n${results.length} flutter apps: ${results.length - failed.length - skipped.length} ok, ` +
        `${failed.length} failing, ${skipped.length} without a runtime entrypoint.`,
    );
  }

  return results.some((result) => result.status === 'fail') ? 1 : 0;
}

process.exit(main());
