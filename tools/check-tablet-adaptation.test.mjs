import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  checkTabletAdaptation,
  validateTabletAdaptationSpec,
} from './check-tablet-adaptation.mjs';

const WINDOW_CLASSES = ['compact', 'medium', 'expanded', 'large'];
const ORIENTATIONS = ['portrait', 'landscape'];
const TARGETS = ['tablet-ipados', 'tablet-android'];

function validSpec() {
  const testMatrix = [];
  for (const runtimeTarget of TARGETS) {
    for (const windowClass of WINDOW_CLASSES) {
      for (const orientation of ORIENTATIONS) {
        testMatrix.push({ runtimeTarget, windowClass, orientation, multitasking: 'full-screen' });
      }
    }
    if (runtimeTarget === 'tablet-ipados') {
      testMatrix.push({ runtimeTarget, windowClass: 'expanded', orientation: 'landscape', multitasking: 'split-view' });
      testMatrix.push({ runtimeTarget, windowClass: 'compact', orientation: 'portrait', multitasking: 'slide-over' });
      testMatrix.push({ runtimeTarget, windowClass: 'large', orientation: 'landscape', multitasking: 'stage-manager' });
    } else {
      testMatrix.push({ runtimeTarget, windowClass: 'expanded', orientation: 'landscape', multitasking: 'freeform' });
    }
  }
  return {
    schemaVersion: 1,
    applicationCode: 'demo',
    runtimeTargets: [...TARGETS],
    windowClasses: {
      compact: { supported: true, minWidth: 320, layout: 'single-column' },
      medium: { supported: true, minWidth: 600, layout: 'rail-and-content' },
      expanded: { supported: true, minWidth: 840, layout: 'master-detail' },
      large: { supported: true, minWidth: 1200, layout: 'three-pane' },
    },
    orientations: [...ORIENTATIONS],
    multitasking: {
      splitView: true,
      slideOver: true,
      stageManager: true,
      androidFreeform: true,
      externalDisplay: false,
    },
    input: {
      touch: true,
      pointer: true,
      trackpad: true,
      hardwareKeyboard: true,
      stylus: false,
    },
    capabilities: [
      'multitasking',
      'windowControls',
      'keyboardShortcuts',
      'secureStorage',
      'networkStatus',
      'appLifecycle',
      'clipboard',
      'deepLinks',
    ],
    testMatrix,
    evidence: {
      screenshots: 'assets/capture/tablet/',
      tests: 'tests/tablet/',
    },
  };
}

function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createRepo({ appRoot = 'sdkwork-demo-pad', spec = validSpec(), manifestTargets = TARGETS, withSpec = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-tablet-adaptation-'));
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const app = path.join(root, 'apps', appRoot);
  write(app, 'agent.app.config.json', JSON.stringify({
    app: { key: 'demo', appType: 'APP_REACT' },
    runtime: {
      family: 'desktop',
      framework: 'react-tauri',
      clientArchitectures: ['tauri'],
      targetPlatforms: ['ipados', 'android-tablet'],
    },
    publish: { platforms: ['APP_IOS', 'APP_ANDROID'] },
    artifacts: {
      installConfig: {
        packages: manifestTargets.map((runtimeTarget, index) => ({
          id: `pkg-${index}`,
          runtimeTarget,
          clientArchitecture: 'tauri',
        })),
      },
    },
  }, null, 2));
  if (withSpec) {
    write(app, 'specs/tablet-adaptation.spec.json', JSON.stringify(spec, null, 2));
  }
  fs.mkdirSync(path.join(app, 'assets/capture/tablet'), { recursive: true });
  fs.mkdirSync(path.join(app, 'tests/tablet'), { recursive: true });
  return root;
}

function scan(root) {
  return checkTabletAdaptation({ repoRoots: [root] });
}

test('accepts a complete pad-root tablet adaptation spec', () => {
  const root = createRepo();
  try {
    const result = scan(root);
    assert.deepEqual(result.issues, []);
    assert.equal(result.scanned.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires a spec for a pad root and for a PC root with tablet targets', () => {
  const pad = createRepo({ withSpec: false });
  const pc = createRepo({ appRoot: 'sdkwork-demo-pc', withSpec: false });
  try {
    assert.ok(scan(pad).issues.some((issue) => issue.includes('missing specs/tablet-adaptation.spec.json')));
    assert.ok(scan(pc).issues.some((issue) => issue.includes('missing specs/tablet-adaptation.spec.json')));
  } finally {
    fs.rmSync(pad, { recursive: true, force: true });
    fs.rmSync(pc, { recursive: true, force: true });
  }
});

test('requires all four window classes with ascending breakpoints', () => {
  const missing = validSpec();
  delete missing.windowClasses.compact;
  assert.ok(validateTabletAdaptationSpec(missing, { root: 'D:/demo-pad' })
    .some((issue) => issue.includes('windowClasses.compact')));

  const badOrder = validSpec();
  badOrder.windowClasses.medium.minWidth = 320;
  assert.ok(validateTabletAdaptationSpec(badOrder, { root: 'D:/demo-pad' })
    .some((issue) => issue.includes('breakpoints must increase')));
});

test('requires both orientations and input parity', () => {
  const oneOrientation = validSpec();
  oneOrientation.orientations = ['portrait'];
  assert.ok(validateTabletAdaptationSpec(oneOrientation, { root: 'D:/demo-pad' })
    .some((issue) => issue.includes('orientations must include landscape')));

  const noPointer = validSpec();
  noPointer.input.pointer = false;
  assert.ok(validateTabletAdaptationSpec(noPointer, { root: 'D:/demo-pad' })
    .some((issue) => issue.includes('input.pointer must be true')));
});

test('requires iPadOS multitasking and secure storage capability', () => {
  const noSplit = validSpec();
  noSplit.multitasking.splitView = false;
  assert.ok(validateTabletAdaptationSpec(noSplit, { root: 'D:/demo-pad' })
    .some((issue) => issue.includes('tablet-ipados requires multitasking.splitView')));

  const noSecureStorage = validSpec();
  noSecureStorage.capabilities = noSecureStorage.capabilities.filter((value) => value !== 'secureStorage');
  assert.ok(validateTabletAdaptationSpec(noSecureStorage, { root: 'D:/demo-pad' })
    .some((issue) => issue.includes('capabilities must include secureStorage')));
});

test('requires test-matrix coverage of every target, window class, orientation, and claimed mode', () => {
  const missingClass = validSpec();
  missingClass.testMatrix = missingClass.testMatrix.filter((row) => !(row.windowClass === 'compact' && row.runtimeTarget === 'tablet-android'));
  assert.ok(validateTabletAdaptationSpec(missingClass, { root: 'D:/demo-pad' })
    .some((issue) => issue.includes('testMatrix must cover tablet-android / compact')));

  const missingMode = validSpec();
  missingMode.testMatrix = missingMode.testMatrix.filter((row) => row.multitasking !== 'freeform');
  assert.ok(validateTabletAdaptationSpec(missingMode, { root: 'D:/demo-pad' })
    .some((issue) => issue.includes('testMatrix must cover tablet-android / freeform')));
});

test('rejects unsupported runtime targets and manifest/spec drift', () => {
  const badTarget = validSpec();
  badTarget.runtimeTargets = ['tablet-ipados', 'browser'];
  assert.ok(validateTabletAdaptationSpec(badTarget, { root: 'D:/demo-pad' })
    .some((issue) => issue.includes('unsupported target "browser"')));

  const spec = validSpec();
  const issues = validateTabletAdaptationSpec(spec, {
    root: 'D:/demo-pad',
    manifestTargets: ['tablet-ipados'],
  });
  assert.equal(issues.some((issue) => issue.includes('manifest ships tablet-ipados but')), false);
  assert.ok(issues.some((issue) => issue.includes('spec declares tablet-android but the manifest does not ship it')));
});

test('requires a valid pad-root manifest and PC-consistent tablet host', () => {
  const root = createRepo();
  try {
    const manifestPath = path.join(root, 'apps/sdkwork-demo-pad/agent.app.config.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.runtime.framework = 'react-h5';
    manifest.artifacts.installConfig.packages[0].runtimeTarget = 'browser';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const issues = scan(root).issues;
    assert.ok(issues.some((issue) => issue.includes('runtime.framework must be react-tauri')));
    assert.ok(issues.some((issue) => issue.includes('must use a tablet runtimeTarget')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an Electron or Capacitor tablet package in a PC root', () => {
  const root = createRepo({ appRoot: 'sdkwork-demo-pc' });
  try {
    const manifestPath = path.join(root, 'apps/sdkwork-demo-pc/agent.app.config.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.artifacts.installConfig.packages[0].clientArchitecture = 'capacitor';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    assert.ok(scan(root).issues.some((issue) => issue.includes('must not use electron or capacitor')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires a pad-root manifest', () => {
  const root = createRepo();
  try {
    fs.rmSync(path.join(root, 'apps/sdkwork-demo-pad/agent.app.config.json'));
    assert.ok(scan(root).issues.some((issue) => issue.includes('missing agent.app.config.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires evidence directories inside the application root', () => {
  const root = createRepo();
  try {
    fs.rmSync(path.join(root, 'apps/sdkwork-demo-pad/assets/capture/tablet'), { recursive: true, force: true });
    assert.ok(scan(root).issues.some((issue) => issue.includes('evidence.screenshots directory does not exist')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an evidence path that escapes the application root', () => {
  const root = createRepo();
  try {
    const spec = validSpec();
    spec.evidence.screenshots = '../outside';
    write(root, 'apps/sdkwork-demo-pad/specs/tablet-adaptation.spec.json', JSON.stringify(spec, null, 2));
    assert.ok(scan(root).issues.some((issue) => issue.includes('evidence.screenshots must resolve inside the application root')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
