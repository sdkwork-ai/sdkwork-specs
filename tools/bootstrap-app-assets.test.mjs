import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bootstrapAppAssets } from './bootstrap-app-assets.mjs';
import { APP_TYPE_MEDIA, APP_TYPES } from './app-assets-lib.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-app-assets-scaffold-'));
}

test('scaffolds an assets root for every application type', () => {
  for (const appType of APP_TYPES) {
    const root = tempRoot();
    const report = bootstrapAppAssets({ root, appType, appKey: 'sample-app' });
    assert.equal(report.appType, appType);
    assert.ok(fs.existsSync(path.join(root, 'assets', 'README.md')), `${appType} README`);
    assert.ok(fs.existsSync(path.join(root, 'assets', '.gitignore')), `${appType} gitignore`);
    assert.ok(fs.existsSync(path.join(root, 'assets', 'resources')), `${appType} resources`);
    const capture = path.join(root, 'assets', 'capture', 'capture.config.json');
    const typeInfo = APP_TYPE_MEDIA[appType];
    if (typeInfo.capture) {
      assert.ok(fs.existsSync(capture), `${appType} capture config`);
      const config = JSON.parse(fs.readFileSync(capture, 'utf8'));
      assert.equal(config.appKey, 'sample-app');
      assert.ok(config.surfaces.length > 0, `${appType} surfaces`);
      assert.ok(
        fs.existsSync(path.join(root, 'assets', 'media', 'covers', 'en-US')),
        `${appType} cover directory`,
      );
    } else {
      assert.equal(fs.existsSync(capture), false, `${appType} has no capture config`);
    }
    const second = bootstrapAppAssets({ root, appType, appKey: 'sample-app' });
    assert.ok(second.files.every((entry) => entry.status === 'skipped'), `${appType} scaffold is idempotent`);
  }
});

test('uses the manifest identity and delivery platforms when present', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'agent.app.config.json'), JSON.stringify({
    app: { key: 'fixture-app', appType: 'APP_FLUTTER' },
    publish: { platforms: ['APP_IOS', 'APP_ANDROID'] },
    media: { metadata: { defaultLocale: 'zh-CN' } },
    release: { currentVersion: '2.1.0' },
  }, null, 2));
  const report = bootstrapAppAssets({ root });
  assert.equal(report.appType, 'APP_FLUTTER');
  assert.equal(report.appKey, 'fixture-app');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'capture', 'capture.config.json'), 'utf8'));
  assert.equal(config.appVersion, '2.1.0');
  assert.deepEqual(config.surfaces.map((surface) => surface.platform), ['APP_IOS', 'APP_ANDROID']);
  assert.deepEqual(config.capture.locales, ['zh-CN']);
});
