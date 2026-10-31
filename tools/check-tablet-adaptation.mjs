#!/usr/bin/env node

/**
 * check-tablet-adaptation.mjs
 *
 * Enforces the tablet adaptation contract in `APP_PAD_ARCHITECTURE_SPEC.md`
 * section 5.12 and section 13 for pad roots and for PC roots that ship
 * `tablet-ipados` or `tablet-android` targets.
 *
 * Rules:
 *   1. A pad root (`apps/*-pad`) and a PC root whose manifest declares a tablet
 *      `runtimeTarget` MUST provide `specs/tablet-adaptation.spec.json`.
 *   2. The spec MUST match `schemas/sdkwork.tablet-adaptation.spec.schema.v1.json`.
 *   3. All four window classes MUST be supported, with ascending breakpoints.
 *   4. Both portrait and landscape orientations MUST be declared.
 *   5. iPadOS targets MUST enable Split View and Slide Over; Android tablet
 *      targets MUST enable freeform multi-window.
 *   6. Touch, pointer, and hardware-keyboard input MUST be declared supported.
 *   7. The test matrix MUST cover every declared target, window class,
 *      orientation, and claimed multitasking mode, plus full-screen.
 *   8. Evidence paths MUST resolve to tracked directories inside the app root.
 *
 * Usage:
 *   node sdkwork-specs/tools/check-tablet-adaptation.mjs --root <repository-root>
 *   node sdkwork-specs/tools/check-tablet-adaptation.mjs --workspace <workspace-root>
 *
 * Exit codes: 0 clean, 1 violations, 2 bad usage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const PAD_TARGETS = new Set(['tablet-ipados', 'tablet-android']);
export const WINDOW_CLASSES = ['compact', 'medium', 'expanded', 'large'];
export const ORIENTATIONS = ['portrait', 'landscape'];
export const MATRIX_MODES = new Set([
  'full-screen',
  'split-view',
  'slide-over',
  'stage-manager',
  'freeform',
  'external-display',
]);
export const CAPABILITIES = new Set([
  'multitasking',
  'externalDisplay',
  'windowControls',
  'keyboardShortcuts',
  'stylus',
  'filePicker',
  'shareSheet',
  'camera',
  'qrScanner',
  'secureStorage',
  'pushNotifications',
  'biometric',
  'networkStatus',
  'appLifecycle',
  'clipboard',
  'deepLinks',
]);

const MULTITASKING_TO_MATRIX = {
  splitView: 'split-view',
  slideOver: 'slide-over',
  stageManager: 'stage-manager',
  androidFreeform: 'freeform',
  externalDisplay: 'external-display',
};

const MODE_TARGETS = {
  'split-view': ['tablet-ipados'],
  'slide-over': ['tablet-ipados'],
  'stage-manager': ['tablet-ipados'],
  freeform: ['tablet-android'],
  'external-display': ['tablet-ipados', 'tablet-android'],
};

const WINDOW_CLASS_RANGE = {
  compact: [320, 599],
  medium: [600, 839],
  expanded: [840, 1199],
  large: [1200, Number.POSITIVE_INFINITY],
};

const SPEC_KEYS = new Set([
  '$schema',
  'schemaVersion',
  'applicationCode',
  'runtimeTargets',
  'windowClasses',
  'orientations',
  'multitasking',
  'input',
  'capabilities',
  'testMatrix',
  'evidence',
]);

const MULTITASKING_KEYS = ['splitView', 'slideOver', 'stageManager', 'androidFreeform', 'externalDisplay'];
const INPUT_KEYS = ['touch', 'pointer', 'trackpad', 'hardwareKeyboard', 'stylus'];
const EVIDENCE_KEYS = ['screenshots', 'tests'];
const TEST_CASE_KEYS = ['runtimeTarget', 'windowClass', 'orientation', 'multitasking'];

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isDirectory(value) {
  return fs.existsSync(value) && fs.statSync(value).isDirectory();
}

function listAppRoots(repoRoot) {
  const appsDir = path.join(repoRoot, 'apps');
  if (!isDirectory(appsDir)) return [];
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      dir: path.join(appsDir, entry.name),
    }));
}

function collectRuntimeTargets(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectRuntimeTargets(item, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'runtimeTarget' && typeof child === 'string') {
      out.add(child);
    } else {
      collectRuntimeTargets(child, out);
    }
  }
  return out;
}

function tabletTargetsOf(manifest) {
  return [...collectRuntimeTargets(manifest)].filter((target) => PAD_TARGETS.has(target));
}

function packageEntries(manifest) {
  const packages = manifest?.artifacts?.installConfig?.packages;
  return Array.isArray(packages) ? packages : [];
}

function validatePadManifest(manifest, label, issues, manifestTargets) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    issues.push(`${label}: agent.app.config.json must be a JSON object`);
    return;
  }
  if (manifest.app?.appType !== 'APP_REACT') {
    issues.push(`${label}: pad root app.appType must be APP_REACT`);
  }
  if (manifest.runtime?.family !== 'desktop') {
    issues.push(`${label}: pad root runtime.family must be desktop`);
  }
  if (manifest.runtime?.framework !== 'react-tauri') {
    issues.push(`${label}: pad root runtime.framework must be react-tauri`);
  }
  const clientArchitectures = manifest.runtime?.clientArchitectures ?? manifest.clientArchitectures;
  if (!Array.isArray(clientArchitectures)
    || clientArchitectures.length !== 1
    || clientArchitectures[0] !== 'tauri') {
    issues.push(`${label}: pad root runtime.clientArchitectures must be ["tauri"]`);
  }
  if (manifestTargets.length === 0) {
    issues.push(`${label}: pad root manifest must declare at least one tablet runtimeTarget`);
  }
  const packages = packageEntries(manifest);
  if (packages.length === 0) {
    issues.push(`${label}: pad root manifest must declare artifacts.installConfig.packages`);
  }
  for (const pkg of packages) {
    if (pkg?.runtimeTarget === 'test-runner') continue;
    if (!PAD_TARGETS.has(pkg?.runtimeTarget)) {
      issues.push(`${label}: pad root package "${pkg?.id ?? 'unknown'}" must use a tablet runtimeTarget`);
    }
    if (pkg?.clientArchitecture && pkg.clientArchitecture !== 'tauri') {
      issues.push(`${label}: pad root package "${pkg?.id ?? 'unknown'}" clientArchitecture must be tauri`);
    }
  }
  const targetPlatforms = manifest.runtime?.targetPlatforms ?? manifest.targetPlatforms;
  if (!Array.isArray(targetPlatforms)) {
    issues.push(`${label}: pad root runtime.targetPlatforms must be an array`);
  } else {
    for (const target of manifestTargets) {
      const platform = target === 'tablet-ipados' ? 'ipados' : 'android-tablet';
      if (!targetPlatforms.includes(platform)) {
        issues.push(`${label}: runtime.targetPlatforms must include "${platform}" for ${target}`);
      }
    }
  }
  const publishPlatforms = manifest.publish?.platforms;
  if (!Array.isArray(publishPlatforms)) {
    issues.push(`${label}: pad root publish.platforms must be an array`);
  } else {
    if (manifestTargets.includes('tablet-ipados') && !publishPlatforms.includes('APP_IOS')) {
      issues.push(`${label}: publish.platforms must include APP_IOS for tablet-ipados`);
    }
    if (manifestTargets.includes('tablet-android') && !publishPlatforms.includes('APP_ANDROID')) {
      issues.push(`${label}: publish.platforms must include APP_ANDROID for tablet-android`);
    }
  }
}

function validatePcTabletManifest(manifest, label, issues) {
  for (const pkg of packageEntries(manifest)) {
    if (!PAD_TARGETS.has(pkg?.runtimeTarget)) continue;
    if (pkg?.clientArchitecture === 'electron' || pkg?.clientArchitecture === 'capacitor') {
      issues.push(`${label}: tablet package "${pkg?.id ?? 'unknown'}" must not use electron or capacitor`);
    }
  }
}

function applicationCodeOf(appRootName) {
  return appRootName
    .replace(/^sdkwork-/u, '')
    .replace(/-(?:pad|pc)$/u, '');
}

function normalizeRelativePath(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/') : '';
}

function isInsideRoot(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || path.isAbsolute(normalized)) return false;
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  return resolved !== rootResolved && resolved.startsWith(`${rootResolved}${path.sep}`);
}

function validateWindowClasses(spec, issue) {
  const classes = spec.windowClasses;
  if (!classes || typeof classes !== 'object' || Array.isArray(classes)) {
    issue('windowClasses must be an object with compact, medium, expanded, and large');
    return;
  }
  for (const key of Object.keys(classes)) {
    if (!WINDOW_CLASSES.includes(key)) issue(`windowClasses contains unknown class "${key}"`);
  }
  for (const windowClass of WINDOW_CLASSES) {
    const entry = classes[windowClass];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issue(`windowClasses.${windowClass} is required`);
      continue;
    }
    if (entry.supported !== true) {
      issue(`windowClasses.${windowClass}.supported must be true`);
    }
    if (!Number.isInteger(entry.minWidth)) {
      issue(`windowClasses.${windowClass}.minWidth must be an integer`);
    } else {
      const [min, max] = WINDOW_CLASS_RANGE[windowClass];
      if (entry.minWidth < min || entry.minWidth > max) {
        issue(
          `windowClasses.${windowClass}.minWidth must be between ${min} and ${max === Number.POSITIVE_INFINITY ? 'infinity' : max}`,
        );
      }
    }
    if (typeof entry.layout !== 'string' || !entry.layout.trim()) {
      issue(`windowClasses.${windowClass}.layout must be a non-empty string`);
    }
  }
  const widths = WINDOW_CLASSES
    .map((windowClass) => classes[windowClass]?.minWidth)
    .filter((width) => Number.isInteger(width));
  for (let index = 1; index < widths.length; index += 1) {
    if (widths[index] <= widths[index - 1]) {
      issue('windowClasses breakpoints must increase from compact to large');
      break;
    }
  }
}

function validateMultitasking(spec, targets, issue) {
  const value = spec.multitasking;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue('multitasking must be an object');
    return;
  }
  for (const key of MULTITASKING_KEYS) {
    if (typeof value[key] !== 'boolean') {
      issue(`multitasking.${key} must be a boolean`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!MULTITASKING_KEYS.includes(key)) issue(`multitasking contains unknown key "${key}"`);
  }
  if (targets.has('tablet-ipados')) {
    if (value.splitView !== true) issue('tablet-ipados requires multitasking.splitView = true');
    if (value.slideOver !== true) issue('tablet-ipados requires multitasking.slideOver = true');
  }
  if (targets.has('tablet-android') && value.androidFreeform !== true) {
    issue('tablet-android requires multitasking.androidFreeform = true');
  }
}

function validateInput(spec, issue) {
  const value = spec.input;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue('input must be an object');
    return;
  }
  for (const key of INPUT_KEYS) {
    if (typeof value[key] !== 'boolean') {
      issue(`input.${key} must be a boolean`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!INPUT_KEYS.includes(key)) issue(`input contains unknown key "${key}"`);
  }
  for (const key of ['touch', 'pointer', 'hardwareKeyboard']) {
    if (value[key] !== true) issue(`input.${key} must be true`);
  }
}

function validateCapabilities(spec, issue) {
  const value = spec.capabilities;
  if (!Array.isArray(value)) {
    issue('capabilities must be an array');
    return;
  }
  const seen = new Set();
  for (const capability of value) {
    if (typeof capability !== 'string' || !CAPABILITIES.has(capability)) {
      issue(`capabilities contains unknown capability "${String(capability)}"`);
    }
    if (seen.has(capability)) issue(`capabilities contains duplicate "${capability}"`);
    seen.add(capability);
  }
  if (!seen.has('secureStorage')) {
    issue('capabilities must include secureStorage for token persistence');
  }
  if (spec.multitasking?.externalDisplay === true && !seen.has('externalDisplay')) {
    issue('capabilities must include externalDisplay when multitasking.externalDisplay is true');
  }
  if (spec.input?.stylus === true && !seen.has('stylus')) {
    issue('capabilities must include stylus when input.stylus is true');
  }
}

function validateTestMatrix(spec, targets, issue) {
  const rows = spec.testMatrix;
  if (!Array.isArray(rows) || rows.length === 0) {
    issue('testMatrix must be a non-empty array');
    return;
  }

  const targetSet = new Set(spec.runtimeTargets);
  for (const [index, row] of rows.entries()) {
    const pointer = `testMatrix[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      issue(`${pointer} must be an object`);
      continue;
    }
    for (const key of Object.keys(row)) {
      if (!TEST_CASE_KEYS.includes(key)) issue(`${pointer} contains unknown key "${key}"`);
    }
    if (!targetSet.has(row.runtimeTarget)) {
      issue(`${pointer}.runtimeTarget must be one of the declared runtimeTargets`);
    }
    if (!WINDOW_CLASSES.includes(row.windowClass)) {
      issue(`${pointer}.windowClass is not a supported window class`);
    }
    if (!ORIENTATIONS.includes(row.orientation)) {
      issue(`${pointer}.orientation must be portrait or landscape`);
    }
    if (!MATRIX_MODES.has(row.multitasking)) {
      issue(`${pointer}.multitasking is not a standard mode`);
    }
  }

  if (!rows.some((row) => row.multitasking === 'full-screen')) {
    issue('testMatrix must include a full-screen case');
  }

  for (const target of targetSet) {
    const targetRows = rows.filter((row) => row.runtimeTarget === target);
    if (targetRows.length === 0) {
      issue(`testMatrix must cover runtimeTarget "${target}"`);
      continue;
    }
    for (const windowClass of WINDOW_CLASSES) {
      if (!targetRows.some((row) => row.windowClass === windowClass)) {
        issue(`testMatrix must cover ${target} / ${windowClass}`);
      }
    }
    for (const orientation of ORIENTATIONS) {
      if (!targetRows.some((row) => row.orientation === orientation)) {
        issue(`testMatrix must cover ${target} / ${orientation}`);
      }
    }
    for (const [key, mode] of Object.entries(MULTITASKING_TO_MATRIX)) {
      const modeTargets = MODE_TARGETS[mode] ?? [];
      if (spec.multitasking?.[key] === true
        && modeTargets.includes(target)
        && !targetRows.some((row) => row.multitasking === mode)) {
        issue(`testMatrix must cover ${target} / ${mode}`);
      }
    }
  }
}

function validateEvidence(spec, root, issue) {
  const evidence = spec.evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    issue('evidence must be an object with screenshots and tests');
    return;
  }
  for (const key of Object.keys(evidence)) {
    if (!EVIDENCE_KEYS.includes(key)) issue(`evidence contains unknown key "${key}"`);
  }
  for (const key of EVIDENCE_KEYS) {
    const relative = evidence[key];
    if (typeof relative !== 'string' || !relative.trim()) {
      issue(`evidence.${key} must be a non-empty relative path`);
      continue;
    }
    if (!isInsideRoot(root, relative)) {
      issue(`evidence.${key} must resolve inside the application root`);
      continue;
    }
    const resolved = path.resolve(root, relative);
    if (!isDirectory(resolved)) {
      issue(`evidence.${key} directory does not exist: ${relative}`);
    }
  }
}

export function validateTabletAdaptationSpec(spec, { root, manifestTargets = [] } = {}) {
  const issues = [];
  const issue = (message) => issues.push(message);

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return ['spec must be a JSON object'];
  }
  for (const key of Object.keys(spec)) {
    if (!SPEC_KEYS.has(key)) issue(`unknown top-level key "${key}"`);
  }
  if (spec.schemaVersion !== 1) issue('schemaVersion must be 1');
  if (typeof spec.applicationCode !== 'string' || !KEBAB_CASE.test(spec.applicationCode)) {
    issue('applicationCode must be lower kebab-case');
  } else if (root) {
    const expected = applicationCodeOf(path.basename(root));
    if (expected && spec.applicationCode !== expected) {
      issue(`applicationCode must match the application root code "${expected}"`);
    }
  }

  const targets = Array.isArray(spec.runtimeTargets) ? spec.runtimeTargets : [];
  if (targets.length === 0) {
    issue('runtimeTargets must be a non-empty array');
  }
  const targetSet = new Set();
  for (const target of targets) {
    if (!PAD_TARGETS.has(target)) {
      issue(`runtimeTargets contains unsupported target "${String(target)}"`);
    }
    if (targetSet.has(target)) issue(`runtimeTargets contains duplicate "${target}"`);
    targetSet.add(target);
  }
  const declaredManifestTargets = [...new Set(manifestTargets)].filter((target) => PAD_TARGETS.has(target));
  if (declaredManifestTargets.length > 0) {
    for (const target of declaredManifestTargets) {
      if (!targetSet.has(target)) issue(`manifest ships ${target} but the spec does not declare it`);
    }
    for (const target of targetSet) {
      if (!declaredManifestTargets.includes(target)) {
        issue(`spec declares ${target} but the manifest does not ship it`);
      }
    }
  }

  validateWindowClasses(spec, issue);

  const orientations = Array.isArray(spec.orientations) ? spec.orientations : [];
  if (orientations.length !== new Set(orientations).size) issue('orientations must not contain duplicates');
  for (const orientation of ORIENTATIONS) {
    if (!orientations.includes(orientation)) issue(`orientations must include ${orientation}`);
  }
  for (const orientation of orientations) {
    if (!ORIENTATIONS.includes(orientation)) issue(`orientations contains unsupported value "${orientation}"`);
  }

  validateMultitasking(spec, targetSet, issue);
  validateInput(spec, issue);
  validateCapabilities(spec, issue);
  validateTestMatrix(spec, targetSet, issue);
  if (root) validateEvidence(spec, root, issue);

  return issues;
}

export function checkTabletAdaptation({ repoRoots = [], workspaceRoot = null } = {}) {
  const roots = [];
  if (workspaceRoot) {
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
    const repoName = path.basename(repoRoot);
    for (const appRoot of listAppRoots(repoRoot)) {
      const manifestPath = path.join(appRoot.dir, 'agent.app.config.json');
      const manifestExists = fs.existsSync(manifestPath);
      const manifest = readJson(manifestPath);
      const manifestTargets = tabletTargetsOf(manifest ?? {});
      const isPadRoot = appRoot.name.endsWith('-pad');
      if (!isPadRoot && manifestTargets.length === 0) continue;

      const specPath = path.join(appRoot.dir, 'specs', 'tablet-adaptation.spec.json');
      const label = `${repoName}/apps/${appRoot.name}`;
      scanned.push({ repo: repoName, app: appRoot.name, specPath });

      if (isPadRoot) {
        if (!manifestExists) {
          issues.push(`${label}: missing agent.app.config.json`);
        } else if (manifest === null) {
          issues.push(`${label}: agent.app.config.json is not valid JSON`);
        } else {
          validatePadManifest(manifest, label, issues, manifestTargets);
        }
      } else {
        validatePcTabletManifest(manifest ?? {}, label, issues);
      }

      if (!fs.existsSync(specPath)) {
        issues.push(`${label}: missing specs/tablet-adaptation.spec.json`);
        continue;
      }
      const spec = readJson(specPath);
      if (spec === null) {
        issues.push(`${label}: specs/tablet-adaptation.spec.json is not valid JSON`);
        continue;
      }
      for (const message of validateTabletAdaptationSpec(spec, {
        root: appRoot.dir,
        manifestTargets,
      })) {
        issues.push(`${label}: ${message}`);
      }
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
    console.error('Usage: node tools/check-tablet-adaptation.mjs --root <repository-root>');
    console.error('       node tools/check-tablet-adaptation.mjs --workspace <workspace-root>');
    process.exit(2);
  }

  const workspaceRoot = values.workspace ? path.resolve(values.workspace) : null;
  const repoRoots = values.root ? [path.resolve(values.root)] : [];

  if (workspaceRoot && !fs.existsSync(workspaceRoot)) {
    console.error(`check-tablet-adaptation: workspace root not found: ${workspaceRoot}`);
    process.exit(2);
  }
  for (const repoRoot of repoRoots) {
    if (!fs.existsSync(repoRoot)) {
      console.error(`check-tablet-adaptation: repository root not found: ${repoRoot}`);
      process.exit(2);
    }
  }

  const { scanned, issues, repos } = checkTabletAdaptation({ workspaceRoot, repoRoots });

  if (workspaceRoot && repos.length === 0) {
    console.error(
      `check-tablet-adaptation: no governed repository found under ${workspaceRoot}; `
      + 'refusing to report a clean run for an empty or mis-targeted workspace root',
    );
    process.exit(2);
  }

  for (const issue of issues) console.error(`[error] ${issue}`);

  if (issues.length > 0) {
    console.error(`check-tablet-adaptation: ${issues.length} violation(s) found`);
    process.exit(1);
  }
  console.log(`check-tablet-adaptation: OK (${scanned.length} tablet application root(s) checked)`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
