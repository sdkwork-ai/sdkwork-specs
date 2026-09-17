#!/usr/bin/env node

/**
 * check-client-host-packages.mjs
 *
 * Enforces the SDKWork client native-host package naming and ownership rules:
 *   - `APP_PC_ARCHITECTURE_SPEC.md` section 3 and section 11
 *   - `APP_H5_ARCHITECTURE_SPEC.md` section 8
 *   - `DESKTOP_APP_ARCHITECTURE_SPEC.md` section 4
 *   - `NAMING_SPEC.md` section 3.1
 *
 * A native host package is a package directory whose name ends in a host token
 * (`-tauri`, `-electron`, `-capacitor`, `-desktop`, `-host`) under a client
 * root's `packages/` directory.
 *
 * Rules:
 *   1. The host name `MUST` be architecture-explicit. A generic `-pc-host` or
 *      `-h5-host` is non-canonical and is reported as an error.
 *   2. A PC root host `MUST` be `sdkwork-<code>-pc-<architecture>` with
 *      `<architecture>` in `tauri`, `electron`, `capacitor`. The retired alias
 *      `-pc-desktop` is reported as migration debt for the Tauri host.
 *   3. An H5 root host `MUST` be `sdkwork-<code>-h5-capacitor`. A root that
 *      ships no Capacitor platform `MUST NOT` carry an H5 host package.
 *   4. One host architecture has exactly one host package per client root.
 *   5. A host package name `MUST` carry its owning client root name.
 *   6. A host package `MUST` carry the manifest of its own ecosystem, not pnpm's:
 *      `package.json` for PC / H5 / mini program, `oh-package.json5` for a Harmony
 *      root (`HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md` section 4), `pubspec.yaml`
 *      for Flutter, `build.gradle[.kts]` for native Android, `Package.swift` or an
 *      `.xcodeproj` for native iOS. Demanding `package.json` of every root
 *      reported five false findings before this rule was written: the Harmony
 *      ecosystem has no `package.json` at all.
 *   7. A `package.json` inside a native (non-JavaScript) host package is reported
 *      as migration debt. No SDKWork standard defines one; the file is inert.
 *   8. A `--workspace` scan that discovers no governed repository exits 2 rather
 *      than reporting a clean run, so a mistargeted root cannot pass silently.
 *
 * Usage:
 *   node sdkwork-specs/tools/check-client-host-packages.mjs --workspace <workspace-root>
 *   node sdkwork-specs/tools/check-client-host-packages.mjs --root <repository-root>
 *   node sdkwork-specs/tools/check-client-host-packages.mjs --workspace <ws> --strict
 *
 * Exit codes: 0 clean, 1 violations, 2 bad usage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Client-root directory suffix -> canonical host package suffix pattern. */
const ROOT_KINDS = [
  { kind: 'pc', test: /-pc$/u },
  { kind: 'h5', test: /-h5$/u },
  { kind: 'mini-program', test: /-mini-program$/u },
  { kind: 'android-mobile', test: /-android-mobile$/u },
  { kind: 'ios-mobile', test: /-ios-mobile$/u },
  { kind: 'harmony-mobile', test: /-harmony-mobile$/u },
  { kind: 'flutter-mobile', test: /-flutter-mobile$/u },
];

/** Canonical host suffix per client-root kind. `null` means "this root owns no host". */
const CANONICAL_HOST = {
  pc: /-pc-(?:tauri|electron|capacitor)$/u,
  h5: /-h5-capacitor$/u,
  'mini-program': /-mp-host$/u,
  'android-mobile': /-android-mobile-host$/u,
  'ios-mobile': /-ios-mobile-host$/u,
  'harmony-mobile': /-harmony-mobile-host$/u,
  'flutter-mobile': null,
};

const RETIRED_ALIAS = {
  pc: { pattern: /-pc-desktop$/u, replacement: '-pc-tauri', owner: 'tauri' },
};

/**
 * Manifest a host package is expected to carry, per client-root kind.
 *
 * SDKWork client roots use the package manager of their target ecosystem, so a
 * single `package.json` requirement is wrong for every native root. Each spec
 * already states the form in its own `Package Internal Shape` section; this table
 * is the executable mirror of those sections.
 */
const HOST_MANIFEST = {
  pc: { candidates: ['package.json'], label: 'package.json', native: false },
  h5: { candidates: ['package.json'], label: 'package.json', native: false },
  'mini-program': { candidates: ['package.json'], label: 'package.json', native: false },
  'harmony-mobile': { candidates: ['oh-package.json5'], label: 'oh-package.json5', native: true },
  'flutter-mobile': { candidates: ['pubspec.yaml'], label: 'pubspec.yaml', native: true },
  'android-mobile': { candidates: ['build.gradle.kts', 'build.gradle'], label: 'build.gradle.kts', native: true },
  'ios-mobile': { candidates: ['Package.swift'], label: 'Package.swift', native: true },
};

const HOST_TOKEN = /-(?:tauri|electron|capacitor|desktop|host)$/u;
const GENERIC_HOST = /-(?:pc|h5)-host$/u;
const ARCHITECTURE_TOKEN = /-(tauri|electron|capacitor|desktop)$/u;

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function classifyRoot(rootDirName) {
  for (const entry of ROOT_KINDS) {
    if (entry.test.test(rootDirName)) return entry.kind;
  }
  return null;
}

/** The application code of a client root: its name with the client-kind suffix stripped. */
function applicationCodeOf(rootDirName, kind) {
  const suffix = ROOT_KINDS.find((entry) => entry.kind === kind)?.test.source.replace(/\$$/u, '');
  const stripped = rootDirName.replace(new RegExp(`${suffix}$`, 'u'), '');
  return stripped.replace(/^sdkwork-/u, '');
}

/** Architecture key used for the one-package-per-architecture rule. */
function architectureKey(packageName) {
  const match = ARCHITECTURE_TOKEN.exec(packageName);
  if (match) return match[1] === 'desktop' ? 'tauri' : match[1];
  if (/-mp-host$/u.test(packageName)) return 'mini-program';
  if (/-android-mobile-host$/u.test(packageName)) return 'android-native';
  if (/-ios-mobile-host$/u.test(packageName)) return 'ios-native';
  if (/-harmony-mobile-host$/u.test(packageName)) return 'harmony-native';
  return 'unknown';
}

function listAppRoots(repoRoot) {
  const appsDir = path.join(repoRoot, 'apps');
  if (!fs.existsSync(appsDir)) return [];
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, dir: path.join(appsDir, e.name) }));
}

/** True when the package directory carries the manifest its ecosystem requires. */
function hostManifestPresent(packageDir, kind) {
  const manifest = HOST_MANIFEST[kind];
  if (!manifest) return true;
  for (const candidate of manifest.candidates) {
    if (fs.existsSync(path.join(packageDir, candidate))) return true;
  }
  // A native iOS package may ship a SwiftPM manifest or an Xcode project instead.
  if (kind === 'ios-mobile') {
    return fs
      .readdirSync(packageDir, { withFileTypes: true })
      .some((e) => e.isDirectory() && e.name.endsWith('.xcodeproj'));
  }
  return false;
}

export function checkClientHostPackages({ workspaceRoot = null, repoRoots = [] } = {}) {
  const violations = [];
  const scanned = [];

  const roots = [];
  if (workspaceRoot) {
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const candidate = path.join(workspaceRoot, entry.name);
      if (fs.existsSync(path.join(candidate, '.git'))) roots.push(candidate);
    }
  }
  roots.push(...repoRoots);

  for (const repoRoot of roots) {
    const repoName = path.basename(repoRoot);
    for (const appRoot of listAppRoots(repoRoot)) {
      const kind = classifyRoot(appRoot.name);
      if (kind === null) continue; // `-common` and other non-client roots own no host.

      const packagesDir = path.join(appRoot.dir, 'packages');
      if (!fs.existsSync(packagesDir)) continue;

      const hostPackages = fs
        .readdirSync(packagesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && HOST_TOKEN.test(e.name))
        .map((e) => e.name);

      if (hostPackages.length === 0) continue;
      scanned.push({ repo: repoName, root: appRoot.name, kind, hosts: [...hostPackages] });

      const seenArchitectures = new Map();
      const canonical = CANONICAL_HOST[kind];
      const alias = RETIRED_ALIAS[kind];

      for (const pkg of hostPackages) {

        if (!KEBAB_CASE.test(pkg)) {
          violations.push({
            repo: repoName,
            root: appRoot.name,
            package: pkg,
            severity: 'error',
            message: `host package name is not lowercase kebab-case`,
          });
        }

        // Rule 5: the host package name must carry its owning client root's
        // application code (the root name with the client-kind suffix stripped).
        // Kind suffixes are not required verbatim because `mini-program` roots
        // use the shorter `mp` token (`NAMING_SPEC.md` section 3.1).
        const applicationCode = applicationCodeOf(appRoot.name, kind);
        if (!pkg.startsWith('sdkwork-')) {
          violations.push({
            repo: repoName,
            root: appRoot.name,
            package: pkg,
            severity: 'error',
            message: `host package name is not SDKWork-namespaced; expected sdkwork-<application-code>-<host>`,
          });
        } else if (applicationCode && !pkg.includes(applicationCode)) {
          violations.push({
            repo: repoName,
            root: appRoot.name,
            package: pkg,
            severity: 'error',
            message: `host package name does not carry the application code '${applicationCode}' of client root '${appRoot.name}'`,
          });
        }

        // Rule 1: no generic `-pc-host` / `-h5-host`.
        if (GENERIC_HOST.test(pkg)) {
          violations.push({
            repo: repoName,
            root: appRoot.name,
            package: pkg,
            severity: 'error',
            message: `generic '${pkg.endsWith('-pc-host') ? '-pc-host' : '-h5-host'}' is non-canonical; name the native architecture explicitly (NAMING_SPEC.md section 3.1)`,
          });
        }

        // Rule 2: retired `-pc-desktop` alias.
        if (alias && alias.pattern.test(pkg)) {
          violations.push({
            repo: repoName,
            root: appRoot.name,
            package: pkg,
            severity: 'debt',
            message: `retired migration alias for the ${alias.owner} host; rename to '${pkg.replace(alias.pattern, alias.replacement)}'`,
          });
        } else if (canonical === null) {
          violations.push({
            repo: repoName,
            root: appRoot.name,
            package: pkg,
            severity: 'error',
            message: `client root '${appRoot.name}' defines no native host; a host package MUST NOT exist here`,
          });
        } else if (!canonical.test(pkg)) {
          violations.push({
            repo: repoName,
            root: appRoot.name,
            package: pkg,
            severity: 'error',
            message: `host package is not canonical for a ${kind} root; expected the '${appRoot.name}-<host>' family (${canonical.source})`,
          });
        }

        // Rule 6: a host package must be a real package, carrying the manifest of
        // its own ecosystem. Rule 7: a native root has no use for a package.json.
        const packageDir = path.join(packagesDir, pkg);
        const manifest = HOST_MANIFEST[kind];
        if (!hostManifestPresent(packageDir, kind)) {
          violations.push({
            repo: repoName,
            root: appRoot.name,
            package: pkg,
            severity: 'error',
            message: `host package has no ${manifest.label}`,
          });
        } else if (manifest.native && fs.existsSync(path.join(packageDir, 'package.json'))) {
          violations.push({
            repo: repoName,
            root: appRoot.name,
            package: pkg,
            severity: 'debt',
            message: `native host package carries an inert 'package.json'; its ecosystem manifest is '${manifest.label}' and no SDKWork standard defines a host-package package.json`,
          });
        }

        // Rule 4: one host package per architecture.
        const architecture = architectureKey(pkg);
        if (seenArchitectures.has(architecture)) {
          violations.push({
            repo: repoName,
            root: appRoot.name,
            package: pkg,
            severity: 'error',
            message: `duplicate host package for architecture '${architecture}'; already owned by '${seenArchitectures.get(architecture)}'`,
          });
        } else {
          seenArchitectures.set(architecture, pkg);
        }
      }
    }
  }

  return { violations, scanned, repos: roots };
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      root: { type: 'string' },
      strict: { type: 'boolean', default: false },
    },
  });

  if (!values.workspace && !values.root) {
    console.error('Usage: node tools/check-client-host-packages.mjs --workspace <workspace-root>');
    console.error('       node tools/check-client-host-packages.mjs --root <repository-root> [--strict]');
    process.exit(2);
  }

  const workspaceRoot = values.workspace ? path.resolve(values.workspace) : null;
  const repoRoots = values.root ? [path.resolve(values.root)] : [];

  if (workspaceRoot && !fs.existsSync(workspaceRoot)) {
    console.error(`check-client-host-packages: workspace root not found: ${workspaceRoot}`);
    process.exit(2);
  }
  for (const repoRoot of repoRoots) {
    if (!fs.existsSync(repoRoot)) {
      console.error(`check-client-host-packages: repository root not found: ${repoRoot}`);
      process.exit(2);
    }
  }

  const { violations, scanned, repos } = checkClientHostPackages({ workspaceRoot, repoRoots });

  // A workspace root that is not the one the caller meant used to report a clean
  // run, because it simply contained no governed repository. Report it instead.
  if (workspaceRoot && repos.length === 0) {
    console.error(
      `check-client-host-packages: no governed repository found under ${workspaceRoot}; `
      + `refusing to report a clean run for an empty or mis-targeted workspace root`,
    );
    process.exit(2);
  }

  const effective = violations.filter((v) => values.strict || v.severity === 'error');

  const hostCount = scanned.reduce((total, entry) => total + entry.hosts.length, 0);
  for (const v of violations) {
    console.error(`[${v.severity}] ${v.repo}/apps/${v.root}/packages/${v.package}: ${v.message}`);
  }

  const debt = violations.filter((v) => v.severity === 'debt').length;
  if (effective.length > 0) {
    console.error(`check-client-host-packages: ${effective.length} violation(s) found (${debt} migration debt item(s) reported)`);
    process.exit(1);
  }
  console.log(`check-client-host-packages: OK (${hostCount} client host package(s) aligned across ${scanned.length} client root(s); ${debt} migration debt item(s) reported)`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
