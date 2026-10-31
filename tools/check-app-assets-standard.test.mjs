import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bootstrapAppAssets } from './bootstrap-app-assets.mjs';
import {
  APP_ASSETS_STANDARD,
  decodeMediaBytes,
  shippedUiFamilies,
  validateAppAssets,
} from './app-assets-lib.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-app-assets-'));
}

function writePng(file, width, height, colorType = 2) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buffer = Buffer.alloc(33);
  PNG_SIGNATURE.copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = colorType;
  fs.writeFileSync(file, buffer);
}

function writeJpeg(file, width, height) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buffer = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
  fs.writeFileSync(file, buffer);
}

function writeMp4(file, seconds) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buffer = Buffer.alloc(160);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  buffer.writeUInt32BE(0, 12);
  buffer.write('isom', 16, 'ascii');
  buffer.write('mp41', 20, 'ascii');
  buffer.writeUInt32BE(108, 24);
  buffer.write('mvhd', 28, 'ascii');
  buffer[32] = 0;
  buffer.writeUInt32BE(1000, 44);
  buffer.writeUInt32BE(seconds * 1000, 48);
  fs.writeFileSync(file, buffer);
}

function assetFrom(root, relativePath, overrides = {}) {
  const file = path.join(root, relativePath);
  const buffer = fs.readFileSync(file);
  const facts = decodeMediaBytes(buffer);
  const asset = {
    path: relativePath,
    width: facts.width,
    height: facts.height,
    format: facts.format,
    alphaChannel: facts.alpha ?? false,
    fileSizeBytes: buffer.length,
    ...overrides,
  };
  if (facts.durationSeconds !== undefined) asset.durationSeconds = facts.durationSeconds;
  return asset;
}

function iconAsset(root, relativePath = 'assets/media/icons/icon-1024.png', overrides = {}) {
  return {
    id: 'sample-app-icon',
    type: 'ICON',
    purpose: 'PRIMARY',
    ...assetFrom(root, relativePath),
    locale: 'en-US',
    enabled: true,
    ...overrides,
  };
}

function coverAsset(root, relativePath = 'assets/media/covers/en-US/cover-1920x1080.png', overrides = {}) {
  return {
    id: 'sample-app-cover',
    type: 'COVER',
    purpose: 'CATALOG_COVER',
    platform: 'WEB',
    locale: 'en-US',
    sortOrder: 0,
    enabled: true,
    metadata: { altText: 'Sample catalog cover', focalPoint: { x: 0.5, y: 0.5 }, cropAnchor: 'center' },
    ...assetFrom(root, relativePath),
    ...overrides,
  };
}

function screenshotAsset(root, relativePath, overrides = {}) {
  return {
    id: overrides.id ?? `sample-app-${overrides.displayType?.toLowerCase() ?? 'web'}-screenshot`,
    type: 'SCREENSHOT',
    purpose: 'CATALOG_SCREENSHOT',
    platform: 'WEB',
    deviceClass: 'BROWSER',
    displayType: 'DESKTOP_16_9',
    locale: 'en-US',
    sortOrder: 0,
    enabled: true,
    metadata: {
      altText: 'Sample screenshot',
      capture: {
        tool: 'playwright',
        version: '1.0.0',
        appVersion: '1.0.0',
        commit: 'deadbee',
        capturedAt: '2026-10-25T00:00:00Z',
        locale: 'en-US',
        displayType: overrides.displayType ?? 'DESKTOP_16_9',
      },
    },
    ...assetFrom(root, relativePath),
    ...overrides,
  };
}

function makeManifest({ appType = 'APP_REACT', platforms = ['WEB'], media, status = 'ACTIVE', stores, targetPlatforms, packages = [] }) {
  return {
    schemaVersion: 3,
    kind: 'agent.app',
    app: {
      key: 'sample-app',
      name: 'sample-app',
      displayName: 'Sample App',
      officialWebsiteUrl: 'https://sdkwork.com/apps/sample-app',
      appType,
    },
    backend: {},
    runtime: {
      family: appType === 'SDK' || appType === 'NONE' ? 'server' : 'web',
      framework: 'react',
      supportedDeploymentProfiles: ['standalone'],
      defaultDeploymentProfile: 'standalone',
      ...(targetPlatforms ? { targetPlatforms } : {}),
    },
    media,
    publish: { status, platforms, ...(stores ? { stores } : {}) },
    artifacts: { installConfig: { packages } },
    release: { currentVersion: '1.0.0', notes: [{ version: '1.0.0', current: true, packageIds: [] }] },
    security: {},
    metadata: { deploymentConfig: 'etc/sdkwork.deployment.config.json' },
  };
}

function emptyMedia(marker = APP_ASSETS_STANDARD) {
  return {
    metadata: marker ? { standard: marker, defaultLocale: 'en-US' } : { defaultLocale: 'en-US' },
    icons: { primary: {}, platform: [] },
    screenshots: [],
    previews: [],
  };
}

function check(manifest, root, options = {}) {
  return validateAppAssets({ manifest, appRoot: root, label: 'fixture', ...options });
}

function assertIncludes(issues, fragment) {
  assert.ok(issues.some((issue) => issue.includes(fragment)), `expected an issue containing "${fragment}", got:\n${issues.join('\n')}`);
}

test('accepts a catalog-ready APP_REACT application with a cover and screenshot', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'APP_REACT', appKey: 'sample-app', platforms: ['WEB'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/screenshots/web/desktop-16-9/en-US/01-home.png'), 1920, 1080, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.screenshots = [screenshotAsset(root, 'assets/media/screenshots/web/desktop-16-9/en-US/01-home.png')];
  media.previews = [coverAsset(root)];
  assert.deepEqual(check(makeManifest({ media }), root), []);
});

test('requires three slide previews for PPT', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'PPT', appKey: 'sample-app', platforms: ['WEB'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/previews/web/slide-16-9/en-US/01-title.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/previews/web/slide-16-9/en-US/02-agenda.png'), 1920, 1080, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.previews = [
    coverAsset(root),
    { ...assetFrom(root, 'assets/media/previews/web/slide-16-9/en-US/01-title.png'), id: 'slide-1', type: 'PREVIEW_IMAGE', purpose: 'SLIDE_PREVIEW', platform: 'WEB', displayType: 'SLIDE_16_9', locale: 'en-US', sortOrder: 0, enabled: true },
    { ...assetFrom(root, 'assets/media/previews/web/slide-16-9/en-US/02-agenda.png'), id: 'slide-2', type: 'PREVIEW_IMAGE', purpose: 'SLIDE_PREVIEW', platform: 'WEB', displayType: 'SLIDE_16_9', locale: 'en-US', sortOrder: 1, enabled: true },
  ];
  const issues = check(makeManifest({ appType: 'PPT', media }), root);
  assertIncludes(issues, '3 slide previews are required');
});

test('requires a poster and preview video for VIDEO', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'VIDEO', appKey: 'sample-app', platforms: ['WEB'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/previews/web/poster-16-9/en-US/poster.png'), 1920, 1080, 2);
  writeMp4(path.join(root, 'assets/media/previews/video/en-US/trailer.mp4'), 20);
  const poster = { ...assetFrom(root, 'assets/media/previews/web/poster-16-9/en-US/poster.png'), id: 'sample-poster', type: 'POSTER', purpose: 'CONTENT_POSTER', platform: 'WEB', displayType: 'VIDEO_16_9', locale: 'en-US', sortOrder: 0, enabled: true };
  const video = { ...assetFrom(root, 'assets/media/previews/video/en-US/trailer.mp4'), id: 'sample-trailer', type: 'PREVIEW_VIDEO', purpose: 'CONTENT_TRAILER', platform: 'WEB', displayType: 'VIDEO_16_9', locale: 'en-US', sortOrder: 0, enabled: true, metadata: { posterAssetId: 'sample-poster' } };
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.previews = [coverAsset(root), poster, video];
  assert.deepEqual(check(makeManifest({ appType: 'VIDEO', media }), root), []);
  const withoutTrailer = { ...media, previews: [coverAsset(root), poster] };
  assertIncludes(check(makeManifest({ appType: 'VIDEO', media: withoutTrailer }), root), 'PREVIEW_VIDEO is required');
});

test('requires a poster for POSTER applications', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'POSTER', appKey: 'sample-app', platforms: ['WEB'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/previews/web/poster/en-US/poster.png'), 1440, 2160, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.previews = [
    coverAsset(root),
    { ...assetFrom(root, 'assets/media/previews/web/poster/en-US/poster.png'), id: 'sample-poster', type: 'POSTER', purpose: 'CONTENT_POSTER', platform: 'WEB', displayType: 'POSTER_MASTER', locale: 'en-US', sortOrder: 0, enabled: true },
  ];
  assert.deepEqual(check(makeManifest({ appType: 'POSTER', media }), root), []);
});

test('requires a catalog screenshot for every shipped Flutter platform', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'APP_FLUTTER', appKey: 'sample-app', platforms: ['APP_IOS', 'APP_ANDROID'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/screenshots/app-ios/iphone-6-9/en-US/01-home.png'), 1320, 2868, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.screenshots = [screenshotAsset(root, 'assets/media/screenshots/app-ios/iphone-6-9/en-US/01-home.png', {
    id: 'ios-home', platform: 'APP_IOS', deviceClass: 'IPHONE', displayType: 'IPHONE_6_9',
  })];
  media.previews = [coverAsset(root)];
  const issues = check(makeManifest({ appType: 'APP_FLUTTER', platforms: ['APP_IOS', 'APP_ANDROID'], media }), root);
  assertIncludes(issues, 'android UI surface');
  writePng(path.join(root, 'assets/media/screenshots/app-android/android-phone/en-US/01-home.png'), 1080, 1920, 2);
  media.screenshots.push(screenshotAsset(root, 'assets/media/screenshots/app-android/android-phone/en-US/01-home.png', {
    id: 'android-home', platform: 'APP_ANDROID', deviceClass: 'ANDROID_PHONE', displayType: 'ANDROID_PHONE',
  }));
  assert.deepEqual(check(makeManifest({ appType: 'APP_FLUTTER', platforms: ['APP_IOS', 'APP_ANDROID'], media }), root), []);
});

test('requires a tablet screenshot when targetPlatforms ships a tablet', () => {
  const root = tempRoot();
  bootstrapAppAssets({
    root,
    appType: 'APP_REACT',
    appKey: 'sample-app',
    platforms: ['APP_IOS'],
    targetPlatforms: ['ipados'],
  });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/screenshots/app-ios/ipad-13/en-US/01-home.png'), 2048, 2732, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.screenshots = [screenshotAsset(root, 'assets/media/screenshots/app-ios/ipad-13/en-US/01-home.png', {
    id: 'ipad-catalog',
    platform: 'APP_IOS',
    deviceClass: 'IPAD',
    displayType: 'IPAD_13',
  })];
  media.previews = [coverAsset(root)];
  const manifest = makeManifest({
    platforms: ['APP_IOS'],
    targetPlatforms: ['ipados'],
    media,
  });
  assert.deepEqual(check(manifest, root), []);

  media.screenshots = [];
  assertIncludes(check(manifest, root), 'IPAD_13');
});

test('accepts an iPad-only Apple submission without a phone screenshot', () => {
  const root = tempRoot();
  bootstrapAppAssets({
    root,
    appType: 'APP_REACT',
    appKey: 'sample-app',
    platforms: ['APP_IOS'],
    targetPlatforms: ['ipados'],
  });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/store/apple-app-store/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/screenshots/app-ios/ipad-13/en-US/01-home.png'), 2048, 2732, 2);
  writePng(path.join(root, 'assets/media/store/apple-app-store/screenshots/ipad-13/en-US/01-home.png'), 2048, 2732, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.icons.platform = [{
    ...assetFrom(root, 'assets/media/store/apple-app-store/icon-1024.png'),
    id: 'apple-icon', type: 'ICON', purpose: 'STORE_LISTING', storePlatform: 'APPLE_APP_STORE', locale: 'en-US', enabled: true,
  }];
  media.screenshots = [
    screenshotAsset(root, 'assets/media/screenshots/app-ios/ipad-13/en-US/01-home.png', {
      id: 'ipad-catalog', platform: 'APP_IOS', deviceClass: 'IPAD', displayType: 'IPAD_13',
    }),
    screenshotAsset(root, 'assets/media/store/apple-app-store/screenshots/ipad-13/en-US/01-home.png', {
      id: 'ipad-store', platform: 'APP_IOS', deviceClass: 'IPAD', displayType: 'IPAD_13', storePlatform: 'APPLE_APP_STORE', purpose: 'STORE_SUBMISSION',
    }),
  ];
  media.previews = [coverAsset(root)];
  const manifest = makeManifest({
    platforms: ['APP_IOS'],
    stores: [{ marketId: 'APPLE_APP_STORE' }],
    targetPlatforms: ['ipados'],
    media,
  });
  assert.deepEqual(check(manifest, root), []);
});

test('validates an Apple App Store submission set', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'APP_REACT', appKey: 'sample-app', platforms: ['APP_IOS'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/store/apple-app-store/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/screenshots/app-ios/iphone-6-9/en-US/01-home.png'), 1320, 2868, 2);
  writePng(path.join(root, 'assets/media/store/apple-app-store/screenshots/iphone-6-9/en-US/01-home.png'), 1320, 2868, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.icons.platform = [{
    ...assetFrom(root, 'assets/media/store/apple-app-store/icon-1024.png'),
    id: 'apple-icon', type: 'ICON', purpose: 'STORE_LISTING', storePlatform: 'APPLE_APP_STORE', locale: 'en-US', enabled: true,
  }];
  media.screenshots = [screenshotAsset(root, 'assets/media/screenshots/app-ios/iphone-6-9/en-US/01-home.png', {
    id: 'ios-catalog', platform: 'APP_IOS', deviceClass: 'IPHONE', displayType: 'IPHONE_6_9',
  }), screenshotAsset(root, 'assets/media/store/apple-app-store/screenshots/iphone-6-9/en-US/01-home.png', {
    id: 'ios-store', platform: 'APP_IOS', deviceClass: 'IPHONE', displayType: 'IPHONE_6_9', storePlatform: 'APPLE_APP_STORE', purpose: 'STORE_SUBMISSION',
  })];
  media.previews = [coverAsset(root)];
  const manifest = makeManifest({
    platforms: ['APP_IOS'], stores: [{ marketId: 'APPLE_APP_STORE' }], targetPlatforms: ['ios'], media,
  });
  assert.deepEqual(check(manifest, root), []);
  writePng(path.join(root, 'assets/media/store/apple-app-store/icon-512.png'), 512, 512, 2);
  media.icons.platform = [{
    ...assetFrom(root, 'assets/media/store/apple-app-store/icon-512.png'),
    id: 'apple-icon', type: 'ICON', purpose: 'STORE_LISTING', storePlatform: 'APPLE_APP_STORE', locale: 'en-US', enabled: true,
  }];
  assertIncludes(check(manifest, root), 'is not an accepted size');
});

test('validates a Google Play submission set and YouTube preview rule', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'APP_REACT', appKey: 'sample-app', platforms: ['APP_ANDROID'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/store/google-play/icon-512.png'), 512, 512, 6);
  writePng(path.join(root, 'assets/media/store/google-play/feature-graphic-1024x500.png'), 1024, 500, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/screenshots/app-android/android-phone/en-US/01-home.png'), 1080, 1920, 2);
  writePng(path.join(root, 'assets/media/store/google-play/screenshots/android-phone/en-US/01-home.png'), 1080, 1920, 2);
  writePng(path.join(root, 'assets/media/store/google-play/screenshots/android-phone/en-US/02-detail.png'), 1080, 1920, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.icons.platform = [{
    ...assetFrom(root, 'assets/media/store/google-play/icon-512.png'),
    id: 'google-icon', type: 'ICON', purpose: 'STORE_LISTING', storePlatform: 'GOOGLE_PLAY', locale: 'en-US', enabled: true,
  }];
  media.screenshots = [screenshotAsset(root, 'assets/media/screenshots/app-android/android-phone/en-US/01-home.png', {
    id: 'android-catalog', platform: 'APP_ANDROID', deviceClass: 'ANDROID_PHONE', displayType: 'ANDROID_PHONE',
  }), screenshotAsset(root, 'assets/media/store/google-play/screenshots/android-phone/en-US/01-home.png', {
    id: 'google-shot-1', platform: 'APP_ANDROID', deviceClass: 'ANDROID_PHONE', displayType: 'ANDROID_PHONE', storePlatform: 'GOOGLE_PLAY', purpose: 'STORE_SUBMISSION', sortOrder: 0,
  }), screenshotAsset(root, 'assets/media/store/google-play/screenshots/android-phone/en-US/02-detail.png', {
    id: 'google-shot-2', platform: 'APP_ANDROID', deviceClass: 'ANDROID_PHONE', displayType: 'ANDROID_PHONE', storePlatform: 'GOOGLE_PLAY', purpose: 'STORE_SUBMISSION', sortOrder: 1,
  })];
  media.previews = [coverAsset(root), {
    ...assetFrom(root, 'assets/media/store/google-play/feature-graphic-1024x500.png'),
    id: 'google-feature', type: 'FEATURE_GRAPHIC', purpose: 'FEATURE_GRAPHIC', storePlatform: 'GOOGLE_PLAY', locale: 'en-US', enabled: true,
  }, {
    id: 'google-trailer', type: 'PREVIEW_VIDEO', purpose: 'STORE_SUBMISSION', storePlatform: 'GOOGLE_PLAY', platform: 'APP_ANDROID', displayType: 'ANDROID_PHONE', locale: 'en-US', external: true, url: 'https://www.youtube.com/watch?v=abc123', enabled: true, metadata: { posterAssetId: 'sample-app-cover' },
  }];
  const manifest = makeManifest({
    platforms: ['APP_ANDROID'], stores: [{ marketId: 'GOOGLE_PLAY' }], targetPlatforms: ['android'], media,
  });
  assert.deepEqual(check(manifest, root), []);
  media.previews.splice(1, 1);
  assertIncludes(check(manifest, root), 'FEATURE_GRAPHIC asset is required');
  const trailer = media.previews.find((entry) => entry.type === 'PREVIEW_VIDEO');
  trailer.external = false;
  assertIncludes(check(manifest, root), 'must be external');
});

test('rejects decoded dimension, alpha channel, format, and file size mismatches', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'APP_REACT', appKey: 'sample-app', platforms: ['WEB'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 6);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/screenshots/web/desktop-16-9/en-US/01-home.png'), 1920, 1080, 2);
  const media = emptyMedia();
  media.icons.primary = {
    ...iconAsset(root, 'assets/media/icons/icon-1024.png', { width: 512, alphaChannel: false, fileSizeBytes: 999 }),
  };
  media.previews = [coverAsset(root, 'assets/media/covers/en-US/cover-1920x1080.png', { format: 'JPEG' })];
  media.screenshots = [screenshotAsset(root, 'assets/media/screenshots/web/desktop-16-9/en-US/01-home.png')];
  const issues = check(makeManifest({ media }), root);
  assertIncludes(issues, 'width 512 does not match the file width 1024');
  assertIncludes(issues, 'alphaChannel false does not match the file alpha channel true');
  assertIncludes(issues, 'fileSizeBytes 999 does not match the file size');
  assertIncludes(issues, 'format JPEG does not match');
});

test('rejects unsafe, escaping, and missing asset paths', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'APP_REACT', appKey: 'sample-app', platforms: ['WEB'] });
  fs.writeFileSync(path.join(root, 'agent.app.config.json'), '{}');
  const media = emptyMedia();
  media.icons.primary = {
    id: 'sample-app-icon', type: 'ICON', purpose: 'PRIMARY',
    path: 'assets/../agent.app.config.json', width: 1024, height: 1024, format: 'PNG', fileSizeBytes: 1, alphaChannel: false, locale: 'en-US', enabled: true,
  };
  media.previews = [{
    id: 'missing-cover', type: 'COVER', purpose: 'CATALOG_COVER', path: 'assets/media/covers/en-US/missing.png',
    width: 1920, height: 1080, format: 'PNG', fileSizeBytes: 1, alphaChannel: false, locale: 'en-US', enabled: true,
  }];
  media.screenshots = [{
    id: 'absolute-shot', type: 'SCREENSHOT', purpose: 'CATALOG_SCREENSHOT', path: 'other/shot.png',
    width: 1920, height: 1080, format: 'PNG', fileSizeBytes: 1, alphaChannel: false, locale: 'en-US', platform: 'WEB', deviceClass: 'BROWSER', displayType: 'DESKTOP_16_9', enabled: true,
  }];
  const issues = check(makeManifest({ media }), root);
  assertIncludes(issues, 'is not repository-relative');
  assertIncludes(issues, 'does not exist');
  assertIncludes(issues, 'must live under assets/');
});

test('rejects enabled placeholders for a catalog-ready application but allows a draft', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'APP_REACT', appKey: 'sample-app', platforms: ['WEB'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root, 'assets/media/icons/icon-1024.png', { metadata: { placeholder: true } });
  const draft = check(makeManifest({ media, status: 'DRAFT' }), root);
  assert.ok(!draft.some((issue) => issue.includes('placeholder')), draft.join('\n'));
  const issues = check(makeManifest({ media, status: 'ACTIVE' }), root);
  assertIncludes(issues, 'enabled placeholder media');
});

test('keeps legacy manifests non-blocking unless the standard is required or a deadline passed', () => {
  const root = tempRoot();
  const media = emptyMedia(null);
  media.icons.primary = {
    id: 'legacy-icon', type: 'ICON', purpose: 'PRIMARY', url: 'https://cdn.sdkwork.com/apps/sample/icon-1024.png',
    width: 1024, height: 1024, format: 'PNG', fileSizeBytes: 1024, alphaChannel: false, locale: 'en-US', enabled: true,
  };
  const manifest = makeManifest({ appType: 'APP_HTML', media });
  assert.deepEqual(check(manifest, root), []);
  assertIncludes(check(manifest, root, { requireStandard: true }), 'media.metadata.standard');
  manifest.media.metadata.assetsMigration = { target: APP_ASSETS_STANDARD, due: '2020-01-01' };
  assertIncludes(check(manifest, root), 'migration deadline 2020-01-01');
});

test('rejects capture configuration that omits a shipped surface', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'APP_REACT', appKey: 'sample-app', platforms: ['WEB'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/screenshots/web/desktop-16-9/en-US/01-home.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/screenshots/h5/h5-9-16/en-US/01-home.png'), 390, 844, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.previews = [coverAsset(root)];
  media.screenshots = [
    screenshotAsset(root, 'assets/media/screenshots/web/desktop-16-9/en-US/01-home.png'),
    screenshotAsset(root, 'assets/media/screenshots/h5/h5-9-16/en-US/01-home.png', {
      id: 'h5-home', platform: 'H5', deviceClass: 'MOBILE', displayType: 'H5_9_16',
    }),
  ];
  const issues = check(makeManifest({ platforms: ['WEB', 'H5'], media }), root);
  assertIncludes(issues, 'no surface for the shipped h5 UI surface');
});

test('rejects a store lane without a known media profile', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'APP_REACT', appKey: 'sample-app', platforms: ['WEB'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root, 'assets/media/icons/icon-1024.png', {
    type: 'ICON', purpose: 'PRIMARY', path: undefined, url: 'https://cdn.sdkwork.com/apps/sample/icon-1024.png',
  });
  const issues = check(makeManifest({ media, stores: [{ marketId: 'UNKNOWN_STORE' }] }), root);
  assertIncludes(issues, 'without a store media profile');
});

const MATRIX_PLATFORMS = {
  NONE: [],
  SDK: [],
  PPT: ['WEB'],
  VIDEO: ['WEB'],
  POSTER: ['WEB'],
  APP_HTML: ['WEB'],
  APP_VUE: ['WEB'],
  APP_REACT: ['WEB'],
  APP_FLUTTER: ['APP_IOS', 'APP_ANDROID'],
  APP_UNIAPP: ['H5', 'MP_WEIXIN'],
  APP_UNITY: ['DESKTOP_WINDOWS', 'WEB'],
  APP_HARMONY: ['APP_HARMONY'],
};

const SURFACE_SIZES = {
  DESKTOP_16_9: { width: 1920, height: 1080 },
  H5_9_16: { width: 390, height: 844 },
  IPHONE_6_9: { width: 1320, height: 2868 },
  ANDROID_PHONE: { width: 1080, height: 1920 },
  HARMONY_PHONE: { width: 1080, height: 1920 },
  MINI_PROGRAM_9_16: { width: 375, height: 667 },
  MOBILE_9_16: { width: 1080, height: 1920 },
};

function addScreenshot(root, media, platform, displayType, deviceClass, id) {
  const size = SURFACE_SIZES[displayType] ?? { width: 1920, height: 1080 };
  const relativePath = `assets/media/screenshots/${platform.toLowerCase().replaceAll('_', '-')}/${displayType.toLowerCase().replaceAll('_', '-')}/en-US/01-home.png`;
  writePng(path.join(root, relativePath), size.width, size.height, 2);
  media.screenshots.push(screenshotAsset(root, relativePath, { id, platform, deviceClass, displayType }));
}

function validFixture(appType) {
  const platforms = MATRIX_PLATFORMS[appType];
  const root = tempRoot();
  bootstrapAppAssets({ root, appType, appKey: 'sample-app', platforms });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  const media = emptyMedia();
  media.icons.primary = iconAsset(root);
  media.previews = [coverAsset(root)];
  for (const [family, descriptor] of shippedUiFamilies(platforms)) {
    addScreenshot(root, media, descriptor.platforms[0], descriptor.displayType, descriptor.deviceClass, `${family}-home`);
  }
  if (appType === 'PPT') {
    for (let index = 0; index < 3; index += 1) {
      const relativePath = `assets/media/previews/web/slide-16-9/en-US/0${index + 1}.png`;
      writePng(path.join(root, relativePath), 1920, 1080, 2);
      media.previews.push({
        ...assetFrom(root, relativePath), id: `slide-${index + 1}`, type: 'PREVIEW_IMAGE', purpose: 'SLIDE_PREVIEW',
        platform: 'WEB', displayType: 'SLIDE_16_9', locale: 'en-US', sortOrder: index, enabled: true,
      });
    }
  }
  if (appType === 'VIDEO') {
    writePng(path.join(root, 'assets/media/previews/web/poster-16-9/en-US/poster.png'), 1920, 1080, 2);
    media.previews.push({
      ...assetFrom(root, 'assets/media/previews/web/poster-16-9/en-US/poster.png'), id: 'video-poster', type: 'POSTER',
      purpose: 'CONTENT_POSTER', platform: 'WEB', displayType: 'VIDEO_16_9', locale: 'en-US', sortOrder: 0, enabled: true,
    });
    writeMp4(path.join(root, 'assets/media/previews/video/en-US/trailer.mp4'), 20);
    media.previews.push({
      ...assetFrom(root, 'assets/media/previews/video/en-US/trailer.mp4'), id: 'video-trailer', type: 'PREVIEW_VIDEO',
      purpose: 'CONTENT_TRAILER', platform: 'WEB', displayType: 'VIDEO_16_9', locale: 'en-US', sortOrder: 0, enabled: true,
      metadata: { posterAssetId: 'video-poster' },
    });
  }
  if (appType === 'POSTER') {
    writePng(path.join(root, 'assets/media/previews/web/poster/en-US/poster.png'), 1440, 2160, 2);
    media.previews.push({
      ...assetFrom(root, 'assets/media/previews/web/poster/en-US/poster.png'), id: 'poster-master', type: 'POSTER',
      purpose: 'CONTENT_POSTER', platform: 'WEB', displayType: 'POSTER_MASTER', locale: 'en-US', sortOrder: 0, enabled: true,
    });
  }
  return { root, manifest: makeManifest({ appType, platforms, media }) };
}

test('validates the media matrix for every application type', () => {
  assert.equal(Object.keys(MATRIX_PLATFORMS).length, 12);
  for (const appType of Object.keys(MATRIX_PLATFORMS)) {
    const { root, manifest } = validFixture(appType);
    assert.deepEqual(check(manifest, root), [], `${appType} should be catalog-ready`);
  }
});

test('requires an explicit source and accessible capture evidence for marker media', () => {
  const root = tempRoot();
  bootstrapAppAssets({ root, appType: 'APP_REACT', appKey: 'sample-app', platforms: ['WEB'] });
  writePng(path.join(root, 'assets/media/icons/icon-1024.png'), 1024, 1024, 2);
  writePng(path.join(root, 'assets/media/covers/en-US/cover-1920x1080.png'), 1920, 1080, 2);
  writePng(path.join(root, 'assets/media/screenshots/web/desktop-16-9/en-US/01-home.png'), 1920, 1080, 2);
  const media = emptyMedia();
  media.icons.primary = {
    ...iconAsset(root), path: undefined, url: 'https://cdn.sdkwork.com/apps/sample/icon-1024.png',
  };
  media.previews = [coverAsset(root, 'assets/media/covers/en-US/cover-1920x1080.png', { metadata: {} })];
  media.screenshots = [screenshotAsset(root, 'assets/media/screenshots/web/desktop-16-9/en-US/01-home.png', {
    metadata: { altText: 'Home screen' },
  })];
  const issues = check(makeManifest({ media }), root);
  assertIncludes(issues, 'requires path, driveUri, resource, or external: true');
  assertIncludes(issues, 'requires localized metadata.altText');
  assertIncludes(issues, 'requires metadata.capture');
});

test('decodes PNG, JPEG, and MP4 source facts', () => {
  const root = tempRoot();
  const png = path.join(root, 'icon.png');
  const jpeg = path.join(root, 'shot.jpg');
  const video = path.join(root, 'trailer.mp4');
  writePng(png, 1024, 1024, 6);
  writeJpeg(jpeg, 1920, 1080);
  writeMp4(video, 24);
  const pngFacts = decodeMediaBytes(fs.readFileSync(png));
  assert.equal(pngFacts.format, 'PNG');
  assert.equal(pngFacts.width, 1024);
  assert.equal(pngFacts.alpha, true);
  const jpegFacts = decodeMediaBytes(fs.readFileSync(jpeg));
  assert.equal(jpegFacts.format, 'JPEG');
  assert.equal(jpegFacts.width, 1920);
  assert.equal(jpegFacts.height, 1080);
  assert.equal(jpegFacts.alpha, false);
  const videoFacts = decodeMediaBytes(fs.readFileSync(video));
  assert.equal(videoFacts.format, 'MP4');
  assert.equal(Math.round(videoFacts.durationSeconds), 24);
});
