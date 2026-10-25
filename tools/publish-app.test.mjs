/**
 * Unit tests for publish-app orchestrator.
 * Run with: node --test tools/publish-app.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  discoverRepoApps,
  resolveApp,
  filterPublishable,
  architectureFromDirName,
  SUPPORTED_ARCHITECTURES,
} from './lib/app-publish/discover-publishable-apps.mjs';
import { getPackager } from './lib/app-publish/packager-registry.mjs';
import { getUploader, SUPPORTED_REGISTRIES, distPackageName } from './lib/app-publish/uploaders.mjs';
import { ReportBuilder } from './lib/app-publish/report.mjs';
import {
  isPreRelease,
  toDisplayPath,
  releaseTag,
  sha256File,
  archiveDirectory,
} from './lib/app-publish/util.mjs';

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-app-pub-'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

test('SUPPORTED_ARCHITECTURES lists all four app architectures', () => {
  assert.deepEqual(SUPPORTED_ARCHITECTURES, ['pc', 'h5', 'flutter-mobile', 'mini-program']);
});

test('SUPPORTED_REGISTRIES lists github, local, and npm', () => {
  assert.deepEqual(SUPPORTED_REGISTRIES, ['github', 'local', 'npm']);
});

test('isPreRelease detects 0.x and -rc / -beta', () => {
  assert.equal(isPreRelease('0.1.0'), true);
  assert.equal(isPreRelease('1.0.0-rc.1'), true);
  assert.equal(isPreRelease('2.3.0-beta'), true);
  assert.equal(isPreRelease('1.0.0'), false);
});

test('toDisplayPath normalizes backslashes', () => {
  assert.equal(toDisplayPath('a\\b\\c'), 'a/b/c');
  assert.equal(toDisplayPath('a/b/c'), 'a/b/c');
});

test('releaseTag scopes per app key', () => {
  assert.equal(releaseTag('sdkwork-im-pc', '1.2.0'), 'sdkwork-im-pc-v1.2.0');
});

test('sha256File returns hex digest or null', () => {
  const ws = makeTempWorkspace();
  const f = path.join(ws, 'a.txt');
  fs.writeFileSync(f, 'hello');
  const digest = sha256File(f);
  assert.ok(digest && /^[0-9a-f]{64}$/.test(digest));
  assert.equal(sha256File(path.join(ws, 'missing')), null);
});

test('archiveDirectory produces a zip via tar', () => {
  const ws = makeTempWorkspace();
  const distDir = path.join(ws, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'), '<html/>');
  const out = path.join(ws, 'web.zip');
  const result = archiveDirectory(distDir, out);
  if (result === null) {
    // tar not available in this environment; skip assertion.
    return;
  }
  assert.equal(result, out);
  assert.ok(fs.existsSync(out));
  assert.ok(fs.statSync(out).size > 0);
});

test('architectureFromDirName resolves conventional suffixes', () => {
  assert.equal(architectureFromDirName('sdkwork-im-pc'), 'pc');
  assert.equal(architectureFromDirName('sdkwork-im-h5'), 'h5');
  assert.equal(architectureFromDirName('sdkwork-im-flutter-mobile'), 'flutter-mobile');
  assert.equal(architectureFromDirName('sdkwork-mail-mini-program'), 'mini-program');
  assert.equal(architectureFromDirName('sdkwork-unknown'), null);
});

test('resolveApp picks up architecture from manifest runtime.framework', () => {
  const ws = makeTempWorkspace();
  const repoRoot = path.join(ws, 'sdkwork-fake');
  const appRoot = path.join(repoRoot, 'apps', 'sdkwork-fake-pc');
  fs.mkdirSync(appRoot, { recursive: true });
  writeJson(path.join(appRoot, 'package.json'), { name: '@sdkwork/fake-pc', version: '1.0.0' });
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    schemaVersion: 3,
    kind: 'agent.app',
    app: { key: 'sdkwork-fake-pc', versionSource: 'package.json' },
    runtime: { family: 'desktop', framework: 'react-tauri' },
    artifacts: {
      installConfig: {
        packages: [
          { id: 'web-zip', platform: 'WEB', packageFormat: 'ZIP' },
          { id: 'win-zip', platform: 'DESKTOP_WINDOWS', packageFormat: 'ZIP' },
        ],
      },
    },
  });

  const resolved = resolveApp(repoRoot, appRoot, 'sdkwork-fake-pc');
  assert.ok(resolved);
  assert.equal(resolved.architecture, 'pc');
  assert.equal(resolved.manifestDriven, true);
  assert.equal(resolved.version, '1.0.0');
  assert.equal(resolved.appKey, 'sdkwork-fake-pc');
});

test('resolveApp falls back to directory suffix when manifest is silent', () => {
  const ws = makeTempWorkspace();
  const repoRoot = path.join(ws, 'sdkwork-fake2');
  const appRoot = path.join(repoRoot, 'apps', 'sdkwork-fake2-h5');
  fs.mkdirSync(appRoot, { recursive: true });
  writeJson(path.join(appRoot, 'package.json'), { name: '@sdkwork/fake2-h5', version: '0.4.0' });
  // No agent.app.config.json present.

  const resolved = resolveApp(repoRoot, appRoot, 'sdkwork-fake2-h5');
  assert.ok(resolved);
  assert.equal(resolved.architecture, 'h5');
  assert.equal(resolved.manifestDriven, false);
  assert.equal(resolved.version, '0.4.0');
});

test('resolveApp returns null for unknown architecture', () => {
  const ws = makeTempWorkspace();
  const repoRoot = path.join(ws, 'sdkwork-fake3');
  const appRoot = path.join(repoRoot, 'apps', 'sdkwork-fake3-unknown');
  fs.mkdirSync(appRoot, { recursive: true });
  writeJson(path.join(appRoot, 'package.json'), { name: '@sdkwork/fake3', version: '1.0.0' });

  assert.equal(resolveApp(repoRoot, appRoot, 'sdkwork-fake3-unknown'), null);
});

test('discoverRepoApps scans apps/<app> directories', () => {
  const ws = makeTempWorkspace();
  const repoRoot = path.join(ws, 'sdkwork-multi');
  const pcRoot = path.join(repoRoot, 'apps', 'sdkwork-multi-pc');
  const h5Root = path.join(repoRoot, 'apps', 'sdkwork-multi-h5');
  fs.mkdirSync(pcRoot, { recursive: true });
  fs.mkdirSync(h5Root, { recursive: true });
  writeJson(path.join(pcRoot, 'package.json'), { name: '@sdkwork/multi-pc', version: '1.0.0' });
  writeJson(path.join(h5Root, 'package.json'), { name: '@sdkwork/multi-h5', version: '1.0.0' });

  const items = discoverRepoApps(repoRoot);
  assert.equal(items.length, 2);
  const archs = items.map((i) => i.architecture).sort();
  assert.deepEqual(archs, ['h5', 'pc']);
});

test('filterPublishable respects repo / app / architecture', () => {
  const items = [
    { repoName: 'sdkwork-a', appKey: 'a-pc', appName: '@sdkwork/a-pc', architecture: 'pc' },
    { repoName: 'sdkwork-a', appKey: 'a-h5', appName: '@sdkwork/a-h5', architecture: 'h5' },
    { repoName: 'sdkwork-b', appKey: 'b-pc', appName: '@sdkwork/b-pc', architecture: 'pc' },
  ];
  assert.equal(filterPublishable(items, { repo: 'sdkwork-a' }).length, 2);
  assert.equal(filterPublishable(items, { app: 'a-h5' }).length, 1);
  assert.equal(filterPublishable(items, { app: '@sdkwork/b-pc' }).length, 1);
  assert.equal(filterPublishable(items, { architecture: 'pc' }).length, 2);
  assert.equal(filterPublishable(items, { architecture: 'all' }).length, 3);
  assert.equal(filterPublishable(items, {}).length, 3);
});

test('pc packager detect resolves platform matrix from manifest', () => {
  const ws = makeTempWorkspace();
  const appRoot = path.join(ws, 'apps', 'sdkwork-fake-pc');
  fs.mkdirSync(appRoot, { recursive: true });
  writeJson(path.join(appRoot, 'package.json'), { name: '@sdkwork/fake-pc', version: '1.0.0' });
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    runtime: { framework: 'react-tauri' },
    artifacts: { installConfig: { packages: [
      { id: 'web', platform: 'WEB' },
      { id: 'win', platform: 'DESKTOP_WINDOWS' },
    ] } },
  });

  const packager = getPackager('pc');
  const detected = packager.detect(appRoot, readJsonLocal(path.join(appRoot, 'agent.app.config.json')), {});
  assert.ok(detected);
  assert.equal(detected.appKey, 'sdkwork-fake-pc');
  assert.ok(detected.platforms.includes('web'));
  assert.ok(detected.platforms.includes('windows'));
});

test('pc packager detect filters by platform', () => {
  const ws = makeTempWorkspace();
  const appRoot = path.join(ws, 'apps', 'sdkwork-fake-pc');
  fs.mkdirSync(appRoot, { recursive: true });
  writeJson(path.join(appRoot, 'package.json'), { name: '@sdkwork/fake-pc', version: '1.0.0' });
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    runtime: { framework: 'react-tauri' },
    artifacts: { installConfig: { packages: [
      { id: 'web', platform: 'WEB' },
      { id: 'win', platform: 'DESKTOP_WINDOWS' },
    ] } },
  });

  const packager = getPackager('pc');
  const detected = packager.detect(appRoot, readJsonLocal(path.join(appRoot, 'agent.app.config.json')), { platformFilter: 'web' });
  assert.ok(detected);
  assert.deepEqual(detected.platforms, ['web']);
});

test('pc packager build with skipBuild returns ok', () => {
  const ws = makeTempWorkspace();
  const appRoot = path.join(ws, 'apps', 'sdkwork-fake-pc');
  fs.mkdirSync(appRoot, { recursive: true });
  const packager = getPackager('pc');
  const r = packager.build(appRoot, { skipBuild: true, platform: 'web' });
  assert.equal(r.ok, true);
});

test('h5 packager collectArtifacts archives dist', () => {
  const ws = makeTempWorkspace();
  const appRoot = path.join(ws, 'apps', 'sdkwork-fake-h5');
  const distDir = path.join(appRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'), '<html/>');
  writeJson(path.join(appRoot, 'package.json'), { name: '@sdkwork/fake-h5', version: '1.0.0' });

  const packager = getPackager('h5');
  const artifacts = packager.collectArtifacts(appRoot, { appKey: 'sdkwork-fake-h5', version: '1.0.0', appConfig: {} });
  // archiveDirectory may be unavailable if tar is missing; tolerate that.
  if (artifacts.length === 0) return;
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].name, 'web-universal.zip');
  assert.equal(artifacts[0].platform, 'web');
  assert.ok(fs.existsSync(artifacts[0].path));
});

test('flutter-mobile packager detect requires pubspec.yaml', () => {
  const ws = makeTempWorkspace();
  const appRoot = path.join(ws, 'apps', 'sdkwork-fake-flutter-mobile');
  fs.mkdirSync(appRoot, { recursive: true });
  writeJson(path.join(appRoot, 'package.json'), { name: '@sdkwork/fake-flutter', version: '1.0.0' });

  const packager = getPackager('flutter-mobile');
  assert.equal(packager.detect(appRoot, {}, {}), null, 'without pubspec.yaml it must not detect');

  writeText(path.join(appRoot, 'pubspec.yaml'), 'name: fake\n');
  const detected = packager.detect(appRoot, {}, {});
  assert.ok(detected);
  assert.deepEqual(detected.platforms.sort(), ['android', 'ios']);
});

test('mini-program packager detect resolves weixin platform', () => {
  const ws = makeTempWorkspace();
  const appRoot = path.join(ws, 'apps', 'sdkwork-fake-mini-program');
  fs.mkdirSync(appRoot, { recursive: true });
  writeJson(path.join(appRoot, 'package.json'), { name: '@sdkwork/fake-mp', version: '0.1.0' });
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    runtime: { framework: 'mp-weixin' },
    artifacts: { installConfig: { packages: [{ id: 'wx', platform: 'WEIXIN' }] } },
  });

  const packager = getPackager('mini-program');
  const detected = packager.detect(appRoot, readJsonLocal(path.join(appRoot, 'agent.app.config.json')), {});
  assert.ok(detected);
  assert.deepEqual(detected.platforms, ['weixin']);
});

test('getPackager returns null for unknown architecture', () => {
  assert.equal(getPackager('mainframe'), null);
});

test('local uploader stages artifacts with a manifest', () => {
  const ws = makeTempWorkspace();
  const appRoot = path.join(ws, 'app');
  fs.mkdirSync(appRoot, { recursive: true });
  const artifactPath = path.join(appRoot, 'web.zip');
  fs.writeFileSync(artifactPath, 'zip-contents');

  const uploader = getUploader('local');
  assert.equal(uploader.hasCredentials({}), true);
  const outDir = path.join(ws, 'releases');
  const r = uploader.upload(
    [{ path: artifactPath, name: 'web.zip', platform: 'web' }],
    { appKey: 'sdkwork-fake-h5', version: '1.0.0', outDir },
  );
  assert.equal(r.ok, true);
  const staged = path.join(outDir, 'sdkwork-fake-h5', '1.0.0', 'web.zip');
  assert.ok(fs.existsSync(staged));
  const manifestPath = path.join(outDir, 'sdkwork-fake-h5', '1.0.0', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].sha256.length, 64);
});

test('local uploader fails without out-dir', () => {
  const uploader = getUploader('local');
  const r = uploader.upload([{ path: 'x', name: 'x', platform: 'web' }], { appKey: 'a', version: '1.0.0' });
  assert.equal(r.ok, false);
});

test('distPackageName derives @sdkwork/<app-base>-dist-<platform>', () => {
  assert.equal(distPackageName('@sdkwork/im-pc', 'web'), '@sdkwork/im-pc-dist-web');
  assert.equal(distPackageName('@sdkwork/im-h5', 'web'), '@sdkwork/im-h5-dist-web');
  assert.equal(distPackageName('@sdkwork/mail-mini-program', 'weixin'), '@sdkwork/mail-mini-program-dist-weixin');
  // Falls back to appKey when appName lacks the scope prefix.
  assert.equal(distPackageName('sdkwork-im-pc', 'web'), '@sdkwork/sdkwork-im-pc-dist-web');
  assert.equal(distPackageName('', 'web'), '@sdkwork/app-dist-web');
});

test('npm uploader hasCredentials honors NPM_TOKEN and ~/.npmrc', () => {
  const uploader = getUploader('npm');
  // Env tokens always satisfy the credential gate.
  assert.equal(uploader.hasCredentials({ NPM_TOKEN: 'x' }), true);
  assert.equal(uploader.hasCredentials({ NODE_AUTH_TOKEN: 'x' }), true);
  // When no env token is present, the gate falls back to ~/.npmrc. On dev
  // machines with a logged-in npm that returns true; in a clean CI it returns
  // false. We only assert the env-token path here; the ~/.npmrc path is
  // exercised end-to-end by the real publish flow.
});

test('npm uploader fails when artifact is missing', () => {
  const uploader = getUploader('npm');
  const r = uploader.upload(
    [{ path: '/nonexistent/missing.zip', name: 'web.zip', platform: 'web' }],
    { appKey: 'sdkwork-fake-pc', appName: '@sdkwork/fake-pc', version: '1.0.0', env: { NPM_TOKEN: 'x' } },
  );
  assert.equal(r.ok, false);
  assert.match(r.detail, /artifact missing/);
});

test('npm uploader synthesizes a dist package and runs npm publish', () => {
  const ws = makeTempWorkspace();
  const artifactPath = path.join(ws, 'web.zip');
  fs.writeFileSync(artifactPath, 'zip-contents');

  const uploader = getUploader('npm');
  // Point npm to a dummy registry to avoid touching npmjs.com. The publish
  // will fail at the registry level, but we verify the synthesized package
  // shape by intercepting before the call is considered a hard failure.
  const r = uploader.upload(
    [{ path: artifactPath, name: 'web.zip', platform: 'web', label: 'Web Bundle' }],
    {
      appKey: 'sdkwork-fake-pc',
      appName: '@sdkwork/fake-pc',
      version: '1.0.0',
      access: 'public',
      tag: 'latest',
      env: { NPM_TOKEN: 'dummy-token', npm_config_registry: 'http://127.0.0.1:0' },
    },
  );
  // Publish against a dead registry must fail, but the error must reference
  // the synthesized dist package name, proving the package was assembled.
  assert.equal(r.ok, false);
  assert.match(r.detail, /@sdkwork\/fake-pc-dist-web@1\.0\.0/);
});

test('getUploader returns null for unknown registry', () => {
  assert.equal(getUploader('ftp'), null);
});

test('ReportBuilder accumulates and summarizes items', () => {
  const r = new ReportBuilder({ mode: 'publish', workspace: '/x', startedAt: '2026-08-16T00:00:00Z' });
  r.add({ repo: 'a', app: 'a-pc', architecture: 'pc', platform: 'web', artifactName: 'web.zip', version: '1.0.0', status: 'success', durationMs: 1 });
  r.add({ repo: 'b', app: 'b-h5', architecture: 'h5', platform: 'web', artifactName: 'web.zip', version: '1.0.0', status: 'skipped', durationMs: 0, reason: 'exists' });
  r.add({ repo: 'c', app: 'c-pc', architecture: 'pc', platform: 'windows', artifactName: 'app.exe', version: '1.0.0', status: 'failed', durationMs: 0, reason: 'err' });

  const s = r.summary();
  assert.equal(s.total, 3);
  assert.equal(s.success, 1);
  assert.equal(s.skipped, 1);
  assert.equal(s.failed, 1);

  const json = r.toJSON();
  assert.equal(json.mode, 'publish');
  assert.equal(json.items.length, 3);
});

test('ReportBuilder writes a JSON file', () => {
  const ws = makeTempWorkspace();
  const r = new ReportBuilder({ mode: 'dry-run', workspace: ws, startedAt: '2026-08-16T00:00:00Z' });
  r.add({ repo: 'a', app: 'a-pc', architecture: 'pc', platform: 'web', artifactName: '', version: '1.0.0', status: 'dry-run', durationMs: 0 });
  const out = path.join(ws, 'report.json');
  r.write(out);
  assert.ok(fs.existsSync(out));
  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(parsed.summary.dryRun, 1);
});

function readJsonLocal(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
