import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  checkUniappxArchitecture,
  validateUniappxRoot,
} from './check-uniappx-architecture.mjs';

const APP = 'demo';

function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(root, relativePath, value) {
  write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function modeValues(mode) {
  return {
    android: mode === 'vapor' ? 23 : 21,
    ios: mode === 'vapor' ? 15 : 12,
    harmony: mode === 'vapor' ? 20 : 14,
  };
}

function makeRoot({ mode = 'vapor', targets = ['APP_ANDROID'], rootName = `sdkwork-${APP}-uniappx` } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-uniappx-'));
  const root = path.join(repo, 'apps', rootName);
  const minimums = modeValues(mode);

  for (const directory of [
    '.sdkwork',
    'bootstrap',
    'config/app',
    'config/host',
    'packages/sdkwork-demo-uniappx-core',
    'packages/sdkwork-demo-uniappx-host',
    'sdks',
    'scripts',
    'specs',
    'tests',
    'pages/index',
  ]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }

  write(root, 'App.uvue', '<template><view class="app" /></template>\n<script setup>\nconst ready = ref(true)\n</script>\n');
  write(root, 'main.uts', 'export function createApp() {\n  return true\n}\n');
  write(root, 'static/README.md', '# static\n');
  write(root, 'bootstrap/runtime.uts', 'export const bootstrapped = true\n');
  write(root, 'pages/index/index.uvue', '<template><view /></template>\n');
  write(root, 'packages/sdkwork-demo-uniappx-core/src/index.uts', 'export const core = true\n');
  write(root, 'packages/sdkwork-demo-uniappx-host/src/index.uts', 'export const host = true\n');

  writeJson(root, 'pages.json', {
    pages: [{ path: 'pages/index/index', style: { navigationBarTitleText: 'Demo' } }],
  });

  writeJson(root, 'manifest.json', {
    name: APP,
    appid: '__UNI__DEMO',
    'uni-app-x': {
      vapor: mode === 'vapor',
      styleIsolationVersion: '2',
    },
    'app-android': { minSdkVersion: minimums.android },
    'app-ios': { minimumOSVersion: minimums.ios },
    'app-harmony': { compatibleSdkVersion: `${mode === 'vapor' ? '6.0.0' : '5.0.0'}(${minimums.harmony})` },
  });

  writeJson(root, 'agent.app.config.json', {
    schemaVersion: 3,
    kind: 'agent.app',
    app: { key: `${APP}-uniappx`, name: APP, displayName: APP, officialWebsiteUrl: 'https://example.com', appType: 'APP_UNIAPP' },
    runtime: {
      family: 'mobile',
      framework: 'uni-app-x',
      uniappxMode: mode,
      clientArchitectures: ['uniappx'],
      supportedDeploymentProfiles: ['standalone', 'cloud'],
      defaultDeploymentProfile: 'standalone',
    },
  });

  writeJson(root, 'specs/uniappx-mode.spec.json', {
    schemaVersion: 1,
    applicationCode: APP,
    mode,
    targets,
    minimumVersions: minimums,
    runtimeClassification: Object.fromEntries(
      targets.map((target) => [target, mode === 'vapor' && target.startsWith('APP_') ? 'vapor' : 'vdom']),
    ),
    evidence: { modeDecision: 'docs/architecture/mode.md' },
  });

  writeJson(root, 'package.json', { name: `sdkwork-${APP}-uniappx`, private: true, version: '0.1.0' });

  return { repo, root };
}

function withRepo(run) {
  const { repo, root } = makeRoot();
  try {
    run({ repo, root });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

test('a valid vapor root passes', () => {
  withRepo(({ root }) => {
    assert.deepEqual(validateUniappxRoot(root), []);
  });
});

test('a valid vdom root passes', () => {
  const { repo, root } = makeRoot({ mode: 'vdom' });
  try {
    assert.deepEqual(validateUniappxRoot(root), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the mandatory manifest node is required', () => {
  withRepo(({ root }) => {
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest['uni-app-x'];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const issues = validateUniappxRoot(root);
    assert.ok(issues.some((issue) => issue.includes('mandatory "uni-app-x" node')));
  });
});

test('manifest and agent mode must agree', () => {
  withRepo(({ root }) => {
    const configPath = path.join(root, 'agent.app.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.runtime.uniappxMode = 'vdom';
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const issues = validateUniappxRoot(root);
    assert.ok(issues.some((issue) => issue.includes('uni-app-x.vapor')));
    assert.ok(issues.some((issue) => issue.includes('disagrees with declared mode')));
  });
});

test('.vue pages are rejected', () => {
  withRepo(({ root }) => {
    write(root, 'pages/legacy/index.vue', '<template><view /></template>\n');
    writeJson(root, 'pages.json', { pages: [{ path: 'pages/legacy/index.vue' }] });
    const issues = validateUniappxRoot(root);
    assert.ok(issues.some((issue) => issue.includes('.vue pages are forbidden')));
    assert.ok(issues.some((issue) => issue.includes('pages must be .uvue')));
  });
});

test('vapor minimum versions are enforced', () => {
  withRepo(({ root }) => {
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest['app-android'].minSdkVersion = 21;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const issues = validateUniappxRoot(root);
    assert.ok(issues.some((issue) => issue.includes('app-android.minSdkVersion >= 23')));
  });
});

test('exactly one host package is required', () => {
  withRepo(({ root }) => {
    fs.mkdirSync(path.join(root, 'packages/sdkwork-demo-uniappx-host-android'), { recursive: true });
    const issues = validateUniappxRoot(root);
    assert.ok(issues.some((issue) => issue.includes('exactly one')));
  });
});

test('the uniapp-x token is rejected in package names', () => {
  withRepo(({ root }) => {
    fs.mkdirSync(path.join(root, 'packages/sdkwork-demo-uniapp-x-order'), { recursive: true });
    const issues = validateUniappxRoot(root);
    assert.ok(issues.some((issue) => issue.includes('uniapp-x') || issue.includes('must use sdkwork-<application-code>-uniappx-<role>')));
  });
});

test('VUE3-VAPOR conditions stay in the host package', () => {
  withRepo(({ root }) => {
    write(root, 'packages/sdkwork-demo-uniappx-order/src/page.uvue', '<template><view /></template>\n// #ifdef VUE3-VAPOR\nexport const vapor = true\n// #endif\n');
    const issues = validateUniappxRoot(root);
    assert.ok(issues.some((issue) => issue.includes('VUE3-VAPOR conditions must stay')));
  });
});

test('uni.request business calls are rejected outside the host and core', () => {
  withRepo(({ root }) => {
    write(root, 'packages/sdkwork-demo-uniappx-order/src/service.uts', 'export function load() {\n  return uni.request({ url: "/app/v3/api/orders" })\n}\n');
    const issues = validateUniappxRoot(root);
    assert.ok(issues.some((issue) => issue.includes('uni.request business calls are forbidden')));
  });
});

test('Options API and mixins are rejected', () => {
  withRepo(({ root }) => {
    write(root, 'packages/sdkwork-demo-uniappx-order/src/legacy.uvue', '<script>\nexport default {\n  mixins: [],\n  data() { return {} }\n}\n</script>\n');
    const issues = validateUniappxRoot(root);
    assert.ok(issues.some((issue) => issue.includes('Options API')));
    assert.ok(issues.some((issue) => issue.includes('mixins')));
  });
});

test('a missing mode spec is reported', () => {
  withRepo(({ root }) => {
    fs.rmSync(path.join(root, 'specs/uniappx-mode.spec.json'));
    const issues = validateUniappxRoot(root);
    assert.ok(issues.some((issue) => issue.includes('missing specs/uniappx-mode.spec.json')));
  });
});

test('workspace scanning finds the uni-app x root', () => {
  const { repo } = makeRoot();
  try {
    const { scanned, issues } = checkUniappxArchitecture({ repoRoots: [repo] });
    assert.equal(scanned.length, 1);
    assert.deepEqual(issues, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
