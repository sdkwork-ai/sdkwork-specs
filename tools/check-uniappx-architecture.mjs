#!/usr/bin/env node

/**
 * check-uniappx-architecture.mjs
 *
 * Enforces `UNIAPP_X_APP_ARCHITECTURE_SPEC.md` for uni-app x application roots.
 *
 * Rules:
 *   1. Root directory names use `apps/sdkwork-<application-code>-uniappx/`.
 *   2. The root carries `manifest.json` with the mandatory `uni-app-x` node,
 *      `App.uvue`, `main.uts`, `pages.json`, `.sdkwork/`, config, bootstrap,
 *      packages, specs, sdks, scripts, and tests.
 *   3. Exactly one Vue mode is declared and the same `vapor`/`vdom` value appears
 *      in `manifest.json` `uni-app-x.vapor`, `agent.app.config.json`
 *      `runtime.uniappxMode`, and `specs/uniappx-mode.spec.json`.
 *   4. Declared minimum platform versions satisfy the selected mode.
 *   5. Packages use the `uniappx` segment and reserved roles; exactly one
 *      `-uniappx-host` package exists.
 *   6. Pages are `.uvue`; `.vue` pages and `.vue` page entries are forbidden.
 *   7. `VUE3-VAPOR` conditions stay in the host package and bootstrap.
 *   8. Feature packages do not call `uni.request` for business APIs and do not
 *      use Options API, mixins, Vuex, or `:deep`-style selectors.
 *
 * Usage:
 *   node sdkwork-specs/tools/check-uniappx-architecture.mjs --root <repository-root>
 *   node sdkwork-specs/tools/check-uniappx-architecture.mjs --workspace <workspace-root>
 *
 * Exit codes: 0 clean, 1 violations, 2 bad usage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const ARCH_SEGMENT = 'uniappx';
export const MODES = new Set(['vapor', 'vdom']);
export const MODE_MINIMUMS = {
  vapor: { android: 23, ios: 15, harmony: 20 },
  vdom: { android: 21, ios: 12, harmony: 14 },
};
export const REQUIRED_FILES = [
  'agent.app.config.json',
  'manifest.json',
  'App.uvue',
  'main.uts',
  'pages.json',
  'package.json',
];
export const REQUIRED_DIRECTORIES = [
  '.sdkwork',
  'bootstrap',
  'config',
  'config/host',
  'packages',
  'sdks',
  'scripts',
  'specs',
  'tests',
];
export const TARGET_TO_MANIFEST = {
  APP_ANDROID: { node: 'app-android', key: 'minSdkVersion', minimum: 'android' },
  APP_IOS: { node: 'app-ios', key: 'minimumOSVersion', minimum: 'ios' },
  APP_HARMONY: { node: 'app-harmony', key: 'compatibleSdkVersion', minimum: 'harmony' },
};
const RESERVED_ROLES = new Set([
  'core',
  'commons',
  'shell',
  'host',
]);
const ROOT_NAME = /^sdkwork-[a-z0-9]+(?:-[a-z0-9]+)*-uniappx$/u;
const PACKAGE_NAME = /^sdkwork-[a-z0-9]+(?:-[a-z0-9]+)*-uniappx(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/u;
const FORBIDDEN_SEGMENT = /(uniapp-x|uni-app-x|uni_app_x)/u;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function isDirectory(absolutePath) {
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();
}

function isFile(absolutePath) {
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
}

function listDirectories(absolutePath) {
  if (!isDirectory(absolutePath)) return [];
  return fs
    .readdirSync(absolutePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listFilesRecursive(absolutePath) {
  const files = [];
  if (!isDirectory(absolutePath)) return files;
  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    const child = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'unpackage') continue;
      files.push(...listFilesRecursive(child));
    } else {
      files.push(child);
    }
  }
  return files;
}

function toRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function parseInteger(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const parenthesized = value.match(/\((\d+)\)/u);
    if (parenthesized) return Number.parseInt(parenthesized[1], 10);
    const leading = value.match(/(\d+)/u);
    if (leading) return Number.parseInt(leading[1], 10);
  }
  return null;
}

function packageRole(name) {
  const prefix = 'sdkwork-';
  const marker = `-${ARCH_SEGMENT}-`;
  const index = name.indexOf(marker);
  if (index < 0) return null;
  return name.slice(index + marker.length);
}

function isCapabilityRole(role) {
  if (RESERVED_ROLES.has(role)) return true;
  if (role === 'console-core' || role === 'console-shell' || role === 'admin-core' || role === 'admin-shell') {
    return true;
  }
  if (role.startsWith('console-') || role.startsWith('admin-')) {
    const capability = role.replace(/^(console|admin)-/u, '');
    return capability.length > 0;
  }
  return !['console', 'admin', 'manager', 'backend', 'common', 'misc'].includes(role);
}

function scanSourceHygiene(root, issues, label) {
  const packagesDir = path.join(root, 'packages');
  const hostPackage = listDirectories(packagesDir).find((name) => name.endsWith(`-${ARCH_SEGMENT}-host`));
  const bootstrapDir = path.join(root, 'bootstrap');

  const allFiles = listFilesRecursive(root);
  const files = allFiles.filter((file) => /\.(uvue|uts|ts)$/u.test(file));
  for (const file of files) {
    const relative = toRelative(root, file);
    if (relative.startsWith('tests/') || relative.startsWith('docs/')) continue;
    const text = readText(file);
    const inHost = hostPackage
      && relative.startsWith(`packages/${hostPackage}/`);
    const inBootstrap = relative.startsWith('bootstrap/') || relative === 'main.uts';
    const inCore = relative.startsWith(`packages/`) && relative.includes(`-${ARCH_SEGMENT}-core/`);

    if (/export\s+default\s*\{/u.test(text) && /\bdata\s*\(\s*\)\s*\{/u.test(text)) {
      issues.push(`${label}: ${relative}: Options API is forbidden in uni-app x; use <script setup>`);
    }
    if (/\bmixins\s*:/u.test(text)) {
      issues.push(`${label}: ${relative}: mixins are forbidden in uni-app x`);
    }
    if (/\bcreateStore\s*\(/u.test(text)) {
      issues.push(`${label}: ${relative}: Vuex is forbidden; use Pinia`);
    }
    if (/:deep\s*\(|::v-deep|>>>/u.test(text)) {
      issues.push(`${label}: ${relative}: complex selectors/deep selectors are forbidden; use BEM class selectors`);
    }
    if (!inHost && !inBootstrap && /#(?:ifdef|ifndef)\s+VUE3-VAPOR/u.test(text)) {
      issues.push(`${label}: ${relative}: VUE3-VAPOR conditions must stay in the host package and bootstrap`);
    }
    if (!inHost && !inBootstrap && !inCore && /\buni\.request\s*\(/u.test(text)) {
      issues.push(`${label}: ${relative}: uni.request business calls are forbidden outside the host package and core transport adapter`);
    }
    if (/\bv-for\s*=/u.test(text) && !/\bv-for\s*=[^\n]*:key\s*=/u.test(text)) {
      issues.push(`${label}: ${relative}: v-for is missing a stable :key`);
    }
  }

  const vuePages = allFiles.filter((file) => {
    const relative = toRelative(root, file);
    return relative.endsWith('.vue') && (relative.startsWith('pages/') || relative.includes('/pages/'));
  });
  for (const file of vuePages) {
    issues.push(`${label}: ${toRelative(root, file)}: .vue pages are forbidden; use .uvue`);
  }
}

function validateModeSpec(spec, mode, targets, issues, label) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    issues.push(`${label}: specs/uniappx-mode.spec.json must be an object`);
    return;
  }
  if (spec.schemaVersion !== 1) {
    issues.push(`${label}: specs/uniappx-mode.spec.json schemaVersion must be 1`);
  }
  if (spec.mode !== mode) {
    issues.push(`${label}: specs/uniappx-mode.spec.json mode "${String(spec.mode)}" disagrees with declared mode "${mode}"`);
  }
  if (!Array.isArray(spec.targets) || spec.targets.length === 0) {
    issues.push(`${label}: specs/uniappx-mode.spec.json targets must be a non-empty array`);
  }
  const minimums = spec.minimumVersions;
  if (!minimums || typeof minimums !== 'object') {
    issues.push(`${label}: specs/uniappx-mode.spec.json minimumVersions is required`);
  } else {
    const expected = MODE_MINIMUMS[mode];
    for (const key of ['android', 'ios', 'harmony']) {
      const value = parseInteger(minimums[key]);
      if (value === null) {
        issues.push(`${label}: specs/uniappx-mode.spec.json minimumVersions.${key} cannot be parsed`);
      } else if (value < expected[key]) {
        issues.push(`${label}: ${mode} mode requires minimumVersions.${key} >= ${expected[key]}`);
      }
    }
  }
  const classification = spec.runtimeClassification;
  if (!classification || typeof classification !== 'object') {
    issues.push(`${label}: specs/uniappx-mode.spec.json runtimeClassification is required`);
  } else {
    for (const target of targets) {
      const runtime = classification[target];
      if (runtime === undefined) {
        issues.push(`${label}: specs/uniappx-mode.spec.json runtimeClassification is missing "${target}"`);
        continue;
      }
      if (mode === 'vdom' && runtime !== 'vdom') {
        issues.push(`${label}: vdom root target "${target}" must declare runtimeClassification "vdom"`);
      }
      if (mode === 'vapor' && target.startsWith('APP_') && runtime !== 'vapor') {
        issues.push(`${label}: vapor root App target "${target}" must declare runtimeClassification "vapor"`);
      }
      if (mode === 'vapor' && !target.startsWith('APP_') && runtime !== 'vdom') {
        issues.push(`${label}: vapor root target "${target}" runs VDOM on Web/mini program; declare runtimeClassification "vdom"`);
      }
    }
  }
  if (!spec.evidence || typeof spec.evidence !== 'object') {
    issues.push(`${label}: specs/uniappx-mode.spec.json evidence is required`);
  } else if (typeof spec.evidence.modeDecision !== 'string' || !spec.evidence.modeDecision.trim()) {
    issues.push(`${label}: specs/uniappx-mode.spec.json evidence.modeDecision is required`);
  }
}

function validateManifestMode(manifest, mode, issues, label) {
  const node = manifest['uni-app-x'];
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    issues.push(`${label}: manifest.json is missing the mandatory "uni-app-x" node`);
    return;
  }
  if (typeof node.vapor !== 'boolean') {
    issues.push(`${label}: manifest.json uni-app-x.vapor must be a boolean`);
  } else if (String(node.vapor) !== String(mode === 'vapor')) {
    issues.push(`${label}: manifest.json uni-app-x.vapor "${String(node.vapor)}" disagrees with runtime.uniappxMode "${mode}"`);
  }
  if (node.styleIsolationVersion !== '2') {
    issues.push(`${label}: manifest.json uni-app-x.styleIsolationVersion must be "2"`);
  }
}

function validateManifestMinimums(manifest, mode, targets, issues, label) {
  const expected = MODE_MINIMUMS[mode];
  for (const target of targets) {
    const mapping = TARGET_TO_MANIFEST[target];
    if (!mapping) continue;
    const node = manifest[mapping.node];
    if (!node || typeof node !== 'object') {
      issues.push(`${label}: manifest.json ${mapping.node} is required for delivered target ${target}`);
      continue;
    }
    const value = parseInteger(node[mapping.key]);
    if (value === null) {
      issues.push(`${label}: manifest.json ${mapping.node}.${mapping.key} is missing or unparsable`);
    } else if (value < expected[mapping.minimum]) {
      issues.push(`${label}: ${mode} mode requires ${mapping.node}.${mapping.key} >= ${expected[mapping.minimum]} (found ${value})`);
    }
  }
}

export function validateUniappxRoot(rootDir) {
  const issues = [];
  const label = path.basename(rootDir);
  const name = path.basename(rootDir);

  if (!ROOT_NAME.test(name)) {
    issues.push(`${label}: uni-app x root must be named sdkwork-<application-code>-uniappx`);
  }
  if (FORBIDDEN_SEGMENT.test(name)) {
    issues.push(`${label}: root name must use the single token "uniappx"`);
  }

  for (const file of REQUIRED_FILES) {
    if (!isFile(path.join(rootDir, file))) issues.push(`${label}: missing ${file}`);
  }
  for (const directory of REQUIRED_DIRECTORIES) {
    if (!isDirectory(path.join(rootDir, directory))) issues.push(`${label}: missing ${directory}/`);
  }
  const enabledConfig = ['browser', 'mini-program', 'app']
    .filter((name) => isDirectory(path.join(rootDir, 'config', name)));
  if (enabledConfig.length === 0) {
    issues.push(`${label}: at least one of config/browser, config/mini-program, or config/app must exist`);
  }

  const packagesDir = path.join(rootDir, 'packages');
  const packageNames = listDirectories(packagesDir);
  if (packageNames.length === 0) {
    issues.push(`${label}: packages/ must contain SDKWork uni-app x packages`);
  }
  const hosts = packageNames.filter((name) => name.endsWith(`-${ARCH_SEGMENT}-host`));
  if (hosts.length !== 1) {
    issues.push(`${label}: exactly one sdkwork-<application-code>-uniappx-host package is required (found ${hosts.length})`);
  }
  for (const packageName of packageNames) {
    if (!PACKAGE_NAME.test(packageName)) {
      issues.push(`${label}: package "${packageName}" must use sdkwork-<application-code>-uniappx-<role>`);
      continue;
    }
    const role = packageRole(packageName);
    if (!role || !isCapabilityRole(role)) {
      issues.push(`${label}: package "${packageName}" uses a non-capability/placeholder role`);
    } else if (role !== 'host' && role.startsWith('host-')) {
      issues.push(`${label}: package "${packageName}" is invalid; exactly one sdkwork-<application-code>-uniappx-host package is allowed`);
    }
  }

  const manifestPath = path.join(rootDir, 'manifest.json');
  const manifest = isFile(manifestPath) ? readJson(manifestPath) : null;
  if (isFile(manifestPath) && manifest === null) {
    issues.push(`${label}: manifest.json is not valid JSON`);
  }

  const agentConfigPath = path.join(rootDir, 'agent.app.config.json');
  const agentConfig = isFile(agentConfigPath) ? readJson(agentConfigPath) : null;
  if (isFile(agentConfigPath) && agentConfig === null) {
    issues.push(`${label}: agent.app.config.json is not valid JSON`);
  }
  const runtime = agentConfig?.runtime ?? {};
  const mode = runtime.uniappxMode;
  if (!MODES.has(mode)) {
    issues.push(`${label}: agent.app.config.json runtime.uniappxMode must be "vapor" or "vdom"`);
  }
  if (runtime.framework !== 'uni-app-x') {
    issues.push(`${label}: agent.app.config.json runtime.framework must be "uni-app-x"`);
  }
  if (!Array.isArray(runtime.clientArchitectures) || !runtime.clientArchitectures.includes(ARCH_SEGMENT)) {
    issues.push(`${label}: agent.app.config.json runtime.clientArchitectures must include "uniappx"`);
  }

  const specPath = path.join(rootDir, 'specs', 'uniappx-mode.spec.json');
  const modeSpec = isFile(specPath) ? readJson(specPath) : null;
  if (!isFile(specPath)) {
    issues.push(`${label}: missing specs/uniappx-mode.spec.json`);
  } else if (modeSpec === null) {
    issues.push(`${label}: specs/uniappx-mode.spec.json is not valid JSON`);
  }

  if (manifest && MODES.has(mode)) {
    validateManifestMode(manifest, mode, issues, label);
  }
  if (modeSpec && MODES.has(mode)) {
    const targets = Array.isArray(modeSpec.targets) ? modeSpec.targets.filter((target) => typeof target === 'string') : [];
    validateModeSpec(modeSpec, mode, targets, issues, label);
    if (manifest) validateManifestMinimums(manifest, mode, targets, issues, label);
  }

  const pagesPath = path.join(rootDir, 'pages.json');
  if (isFile(pagesPath)) {
    const pages = readJson(pagesPath);
    if (pages === null) {
      issues.push(`${label}: pages.json is not valid JSON`);
    } else {
      const entries = [
        ...(Array.isArray(pages.pages) ? pages.pages : []),
        ...(Array.isArray(pages.subPackages) ? pages.subPackages.flatMap((item) => item.pages ?? []) : []),
      ];
      for (const entry of entries) {
        const pagePath = typeof entry === 'string' ? entry : entry?.path;
        if (typeof pagePath === 'string' && pagePath.endsWith('.vue')) {
          issues.push(`${label}: pages.json declares a .vue page "${pagePath}"; pages must be .uvue`);
        }
      }
    }
  }

  scanSourceHygiene(rootDir, issues, label);

  return issues;
}

export function checkUniappxArchitecture({ repoRoots = [], workspaceRoot = null } = {}) {
  const roots = [];
  if (workspaceRoot && isDirectory(workspaceRoot)) {
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const candidate = path.join(workspaceRoot, entry.name);
      if (fs.existsSync(path.join(candidate, '.git'))) roots.push(candidate);
    }
  }
  roots.push(...repoRoots);

  const scanned = [];
  const issues = [];

  for (const repoRoot of roots) {
    const appsDir = path.join(repoRoot, 'apps');
    if (!isDirectory(appsDir)) continue;
    for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (!entry.name.endsWith(`-${ARCH_SEGMENT}`)) continue;
      const appRoot = path.join(appsDir, entry.name);
      scanned.push({ repo: path.basename(repoRoot), app: entry.name, root: appRoot });
      issues.push(...validateUniappxRoot(appRoot));
    }
  }

  return { scanned, issues, repos: roots };
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      root: { type: 'string' },
    },
  });

  if (!values.workspace && !values.root) {
    console.error('Usage: node tools/check-uniappx-architecture.mjs --root <repository-root>');
    console.error('       node tools/check-uniappx-architecture.mjs --workspace <workspace-root>');
    process.exit(2);
  }

  const workspaceRoot = values.workspace ? path.resolve(values.workspace) : null;
  const repoRoots = values.root ? [path.resolve(values.root)] : [];

  if (workspaceRoot && !isDirectory(workspaceRoot)) {
    console.error(`check-uniappx-architecture: workspace root not found: ${workspaceRoot}`);
    process.exit(2);
  }
  for (const repoRoot of repoRoots) {
    if (!isDirectory(repoRoot)) {
      console.error(`check-uniappx-architecture: repository root not found: ${repoRoot}`);
      process.exit(2);
    }
  }

  const { scanned, issues, repos } = checkUniappxArchitecture({ workspaceRoot, repoRoots });

  if (workspaceRoot && repos.length === 0) {
    console.error(
      `check-uniappx-architecture: no governed repository found under ${workspaceRoot}; `
      + 'refusing to report a clean run for an empty or mis-targeted workspace root',
    );
    process.exit(2);
  }

  for (const issue of issues) console.error(`[error] ${issue}`);

  if (issues.length > 0) {
    console.error(`check-uniappx-architecture: ${issues.length} violation(s) found`);
    process.exit(1);
  }
  console.log(`check-uniappx-architecture: OK (${scanned.length} uni-app x application root(s) checked)`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
