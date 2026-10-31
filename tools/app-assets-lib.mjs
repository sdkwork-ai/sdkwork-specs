#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STANDARDS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const APP_ASSETS_STANDARD = 'sdkwork-app-assets.v1';
export const CAPTURE_CONFIG_KIND = 'sdkwork.app-assets.capture';

export const APP_TYPES = Object.freeze([
  'NONE', 'SDK', 'PPT', 'APP_HTML', 'APP_VUE', 'APP_FLUTTER', 'APP_UNIAPP',
  'APP_REACT', 'APP_UNITY', 'APP_HARMONY', 'VIDEO', 'POSTER',
]);

export const ASSET_TYPES = Object.freeze([
  'ICON', 'COVER', 'SCREENSHOT', 'PREVIEW_IMAGE', 'PREVIEW_VIDEO', 'FEATURE_GRAPHIC', 'POSTER',
]);

export const ASSET_PURPOSES = Object.freeze([
  'PRIMARY', 'CATALOG_COVER', 'CATALOG_SCREENSHOT', 'CATALOG_PREVIEW', 'STORE_LISTING',
  'STORE_SUBMISSION', 'STORE_APP_PREVIEW', 'SLIDE_PREVIEW', 'CONTENT_POSTER',
  'CONTENT_TRAILER', 'FEATURE_GRAPHIC', 'DOCS_PREVIEW',
]);

export const ROLE_PURPOSES = Object.freeze({
  ICON: ['PRIMARY', 'STORE_LISTING'],
  COVER: ['CATALOG_COVER'],
  SCREENSHOT: ['CATALOG_SCREENSHOT', 'STORE_SUBMISSION', 'STORE_LISTING'],
  PREVIEW_IMAGE: ['SLIDE_PREVIEW', 'DOCS_PREVIEW', 'STORE_LISTING', 'CATALOG_PREVIEW'],
  PREVIEW_VIDEO: ['CONTENT_TRAILER', 'STORE_SUBMISSION', 'STORE_LISTING', 'STORE_APP_PREVIEW'],
  FEATURE_GRAPHIC: ['FEATURE_GRAPHIC'],
  POSTER: ['CONTENT_POSTER', 'STORE_LISTING'],
});

export const MEDIA_FORMATS = Object.freeze(['PNG', 'JPG', 'JPEG', 'WEBP', 'MP4', 'MOV', 'M4V']);

export const STORE_PLATFORMS = Object.freeze([
  'SDKWORK_APPSTORE', 'APPLE_APP_STORE', 'GOOGLE_PLAY', 'HUAWEI_APPGALLERY', 'MICROSOFT_STORE',
]);

export const DEVICE_CLASSES = Object.freeze([
  'BROWSER', 'DESKTOP', 'ANDROID_PHONE', 'ANDROID_TABLET', 'IPHONE', 'IPAD',
  'HARMONY_PHONE', 'HARMONY_TABLET', 'MINI_PROGRAM', 'MOBILE', 'CONTENT',
]);

export const CAPTURE_TOOLS = Object.freeze([
  'playwright', 'host-webview', 'flutter-integration-test', 'android-instrumentation',
  'ios-xctest', 'harmony-test', 'mini-program-automator', 'unity-recorder',
  'render-pipeline', 'manual',
]);

const CONTENT_APP_TYPES = new Set(['PPT', 'VIDEO', 'POSTER']);

const UI_PLATFORMS = Object.freeze({
  WEB: { family: 'web', deviceClass: 'BROWSER', displayType: 'DESKTOP_16_9' },
  H5: { family: 'h5', deviceClass: 'MOBILE', displayType: 'H5_9_16' },
  H5_WEIXIN: { family: 'h5', deviceClass: 'MOBILE', displayType: 'H5_9_16' },
  DESKTOP: { family: 'desktop', deviceClass: 'DESKTOP', displayType: 'DESKTOP_16_9' },
  DESKTOP_WINDOWS: { family: 'desktop', deviceClass: 'DESKTOP', displayType: 'DESKTOP_16_9' },
  DESKTOP_MACOS: { family: 'desktop', deviceClass: 'DESKTOP', displayType: 'DESKTOP_16_9' },
  DESKTOP_LINUX: { family: 'desktop', deviceClass: 'DESKTOP', displayType: 'DESKTOP_16_9' },
  APP_IOS: { family: 'ios', deviceClass: 'IPHONE', displayType: 'IPHONE_6_9' },
  APP_ANDROID: { family: 'android', deviceClass: 'ANDROID_PHONE', displayType: 'ANDROID_PHONE' },
  APP_HARMONY: { family: 'harmony', deviceClass: 'HARMONY_PHONE', displayType: 'HARMONY_PHONE' },
  APP: { family: 'mobile', deviceClass: 'MOBILE', displayType: 'MOBILE_9_16' },
  APP_PLUS: { family: 'mobile', deviceClass: 'MOBILE', displayType: 'MOBILE_9_16' },
});

export const APP_TYPE_MEDIA = Object.freeze({
  NONE: { resources: [], capture: null, screenshots: false },
  SDK: { resources: [], capture: null, screenshots: false },
  PPT: { resources: ['deck', 'slides'], capture: 'render-pipeline', screenshots: false, slidePreviews: 3 },
  VIDEO: { resources: ['video', 'poster', 'storyboard'], capture: 'render-pipeline', screenshots: false, poster: true, previewVideo: true },
  POSTER: { resources: ['poster'], capture: 'render-pipeline', screenshots: false, poster: true },
  APP_HTML: { resources: ['ui'], capture: 'playwright', screenshots: true },
  APP_VUE: { resources: ['ui'], capture: 'playwright', screenshots: true },
  APP_REACT: { resources: ['ui'], capture: 'playwright', screenshots: true },
  APP_FLUTTER: { resources: ['ui'], capture: 'flutter-integration-test', screenshots: true },
  APP_UNIAPP: { resources: ['ui'], capture: 'mini-program-automator', screenshots: true },
  APP_UNITY: { resources: ['game', 'ui'], capture: 'unity-recorder', screenshots: true },
  APP_HARMONY: { resources: ['ui'], capture: 'harmony-test', screenshots: true },
});

export const CATALOG_READY_STATUSES = Object.freeze([
  'ACTIVE', 'BETA', 'INTERNAL', 'LISTED', 'PUBLISHED',
]);

const EXTENSIONS_BY_FORMAT = Object.freeze({
  PNG: ['png'],
  JPG: ['jpg', 'jpeg'],
  JPEG: ['jpg', 'jpeg'],
  WEBP: ['webp'],
  MP4: ['mp4'],
  MOV: ['mov'],
  M4V: ['m4v'],
});

const LISTABLE_STATUSES = new Set(CATALOG_READY_STATUSES);
const KEBAB_SEGMENT = /^[a-z0-9][a-z0-9.-]*$/u;
const LOCALE_SEGMENT = /^[a-z]{2,3}(?:-[A-Z]{2}|-[A-Z][a-z]{3})?$/u;
const LOCALE_VALUE = /^[a-z]{2,3}(?:-[A-Z]{2}|-[A-Z][a-z]{3})?$/u;

export function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

let cachedProfiles;

export function loadStoreProfiles() {
  if (!cachedProfiles) {
    const file = path.join(STANDARDS_ROOT, 'schemas', 'sdkwork.app-assets.profiles.v1.json');
    cachedProfiles = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
    if (!isObject(cachedProfiles.profiles)) throw new Error(`invalid store profile catalog: ${file}`);
    for (const [marketId, profile] of Object.entries(cachedProfiles.profiles)) {
      if (!STORE_PLATFORMS.includes(marketId)) {
        throw new Error(`store profile catalog contains an unknown market id: ${marketId}`);
      }
      if (!isObject(profile.assets)) {
        throw new Error(`store profile ${marketId} must declare assets`);
      }
      for (const role of Object.keys(profile.assets)) {
        if (!ASSET_TYPES.includes(role)) {
          throw new Error(`store profile ${marketId} declares an unknown asset role: ${role}`);
        }
      }
    }
  }
  return cachedProfiles;
}

export function standardOf(manifest) {
  const standard = manifest?.media?.metadata?.standard;
  return typeof standard === 'string' ? standard : undefined;
}

export function hasAssetsStandard(manifest) {
  return standardOf(manifest) === APP_ASSETS_STANDARD;
}

export function defaultLocaleOf(manifest) {
  const declared = manifest?.media?.metadata?.defaultLocale;
  if (typeof declared === 'string' && LOCALE_VALUE.test(declared)) return declared;
  return 'en-US';
}

export function isCatalogReady(manifest) {
  const status = String(manifest?.publish?.status ?? '').toUpperCase();
  if (LISTABLE_STATUSES.has(status)) return true;
  if (manifest?.publish?.listed === true) return true;
  if (Array.isArray(manifest?.publish?.stores) && manifest.publish.stores.length > 0) return true;
  return false;
}

export function surfaceFamily(platform) {
  if (typeof platform !== 'string') return undefined;
  if (UI_PLATFORMS[platform]) return UI_PLATFORMS[platform].family;
  if (platform.startsWith('MP_')) return 'mini-program';
  if (platform.startsWith('QUICKAPP')) return 'quickapp';
  return undefined;
}

export function shippedUiFamilies(platforms) {
  const families = new Map();
  for (const platform of Array.isArray(platforms) ? platforms : []) {
    let descriptor = UI_PLATFORMS[platform];
    if (!descriptor && typeof platform === 'string' && platform.startsWith('MP_')) {
      descriptor = { family: 'mini-program', deviceClass: 'MINI_PROGRAM', displayType: 'MINI_PROGRAM_9_16' };
    }
    if (!descriptor && typeof platform === 'string' && platform.startsWith('QUICKAPP')) {
      descriptor = { family: 'quickapp', deviceClass: 'MOBILE', displayType: 'MOBILE_9_16' };
    }
    if (!descriptor) continue;
    if (!families.has(descriptor.family)) {
      families.set(descriptor.family, { family: descriptor.family, deviceClass: descriptor.deviceClass, displayType: descriptor.displayType, platforms: [] });
    }
    families.get(descriptor.family).platforms.push(platform);
  }
  return families;
}

export function normalizeStoreLane(store) {
  const raw = store?.marketId ?? store?.storePlatform ?? store?.id;
  return typeof raw === 'string' ? raw.trim().toUpperCase() : undefined;
}

export function storeLanes(manifest) {
  return (Array.isArray(manifest?.publish?.stores) ? manifest.publish.stores : [])
    .map(normalizeStoreLane)
    .filter(Boolean);
}

export function targetPlatformsOf(manifest) {
  const values = new Set();
  for (const value of Array.isArray(manifest?.runtime?.targetPlatforms) ? manifest.runtime.targetPlatforms : []) {
    if (typeof value === 'string' && value.trim()) values.add(value.trim());
  }
  for (const pkg of Array.isArray(manifest?.artifacts?.installConfig?.packages) ? manifest.artifacts.installConfig.packages : []) {
    if (typeof pkg?.targetPlatform === 'string' && pkg.targetPlatform.trim()) values.add(pkg.targetPlatform.trim());
    if (pkg?.runtimeTarget === 'tablet-ipados') values.add('ipados');
    if (pkg?.runtimeTarget === 'tablet-android') values.add('android-tablet');
  }
  return [...values];
}

export function mediaAssetsOf(manifest) {
  const media = isObject(manifest?.media) ? manifest.media : {};
  const icons = isObject(media.icons) ? media.icons : {};
  const assets = [];
  if (isObject(icons.primary)) {
    assets.push({
      ...icons.primary,
      type: 'ICON',
      declaredType: icons.primary.type,
      purpose: icons.primary.purpose ?? 'PRIMARY',
      container: 'icons.primary',
    });
  }
  for (const [index, asset] of (Array.isArray(icons.platform) ? icons.platform : []).entries()) {
    if (isObject(asset)) assets.push({ ...asset, container: `icons.platform[${index}]` });
  }
  for (const [index, asset] of (Array.isArray(media.screenshots) ? media.screenshots : []).entries()) {
    if (isObject(asset)) assets.push({ ...asset, container: `screenshots[${index}]` });
  }
  for (const [index, asset] of (Array.isArray(media.previews) ? media.previews : []).entries()) {
    if (isObject(asset)) assets.push({ ...asset, container: `previews[${index}]` });
  }
  return assets;
}

export function enabledAssets(assets) {
  return assets.filter((asset) => asset.enabled !== false);
}

export function catalogAssetsOf(assets) {
  return assets.filter((asset) => !asset.storePlatform || asset.storePlatform === 'SDKWORK_APPSTORE');
}

export function storeAssetsOf(assets, storePlatform) {
  return assets.filter((asset) => asset.storePlatform === storePlatform);
}

function normalizeImageFormat(format) {
  if (typeof format !== 'string') return undefined;
  const upper = format.toUpperCase();
  return upper === 'JPG' ? 'JPEG' : upper;
}

function formatFamily(format) {
  const canonical = normalizeImageFormat(format);
  return canonical === 'MP4' || canonical === 'MOV' || canonical === 'M4V' ? 'VIDEO' : canonical;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  let alpha = colorType === 4 || colorType === 6;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'tRNS') alpha = true;
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return { format: 'PNG', width, height, alpha };
}

function decodeJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error('not a JPEG file');
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        format: 'JPEG',
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
        alpha: false,
      };
    }
    offset += 2 + length;
  }
  throw new Error('JPEG frame header not found');
}

function decodeWebp(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('not a WebP file');
  }
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      format: 'WEBP',
      width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
      height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
      alpha: (buffer[20] & 0x10) !== 0,
    };
  }
  if (chunk === 'VP8 ') {
    return {
      format: 'WEBP',
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      alpha: false,
    };
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return {
      format: 'WEBP',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      alpha: ((bits >> 28) & 0x1) === 1,
    };
  }
  throw new Error('unsupported WebP chunk');
}

function decodeVideoDuration(buffer) {
  const offset = buffer.indexOf(Buffer.from('mvhd', 'ascii'));
  if (offset < 0 || offset + 24 > buffer.length) return undefined;
  const version = buffer[offset + 4];
  if (version === 1) {
    if (offset + 36 > buffer.length) return undefined;
    const timescale = buffer.readUInt32BE(offset + 24);
    const duration = Number(buffer.readBigUInt64BE(offset + 28));
    return timescale > 0 ? duration / timescale : undefined;
  }
  const timescale = buffer.readUInt32BE(offset + 16);
  const duration = buffer.readUInt32BE(offset + 20);
  return timescale > 0 ? duration / timescale : undefined;
}

function decodeVideo(buffer) {
  if (buffer.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') throw new Error('not an ISO BMFF video file');
  const brand = buffer.toString('ascii', 8, 12);
  const format = brand.startsWith('qt') ? 'MOV' : brand === 'M4V ' ? 'M4V' : 'MP4';
  return { format, kind: 'VIDEO', durationSeconds: decodeVideoDuration(buffer) };
}

export function decodeMediaBytes(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return decodePng(buffer);
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return decodeJpeg(buffer);
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return decodeWebp(buffer);
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return decodeVideo(buffer);
  throw new Error('unsupported media signature');
}

function readHead(file, maxBytes = 8 * 1024 * 1024) {
  const size = fs.statSync(file).size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(file, 'r');
  try {
    fs.readSync(descriptor, buffer, 0, length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return { buffer, size };
}

export function decodeMediaFile(file, declaredFormat) {
  const { buffer, size } = readHead(file);
  const facts = decodeMediaBytes(buffer);
  const declaredFamily = formatFamily(declaredFormat);
  const factsFamily = facts.kind === 'VIDEO' ? 'VIDEO' : facts.format;
  return { ...facts, size, matchesDeclaredFormat: !declaredFamily || declaredFamily === factsFamily };
}

function safeAssetPath(appRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return { error: 'path is empty' };
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized) || normalized.includes('..')) {
    return { error: `path ${relativePath} is not repository-relative` };
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.')) return { error: `path ${relativePath} has an empty segment` };
  if (segments[0] !== 'assets') return { error: `path ${relativePath} must live under assets/` };
  for (const segment of segments.slice(1)) {
    if (!KEBAB_SEGMENT.test(segment) && !LOCALE_SEGMENT.test(segment)) {
      return { error: `path ${relativePath} has a non-canonical segment ${segment}` };
    }
    if (segment !== segment.toLowerCase() && !LOCALE_SEGMENT.test(segment)) {
      return { error: `path ${relativePath} must be lower kebab-case except locales` };
    }
  }
  const absolute = path.resolve(appRoot, normalized);
  const root = path.resolve(appRoot);
  if (!absolute.startsWith(`${root}${path.sep}`)) return { error: `path ${relativePath} escapes the application root` };
  let stats;
  try {
    stats = fs.lstatSync(absolute);
  } catch {
    return { error: `path ${relativePath} does not exist` };
  }
  if (stats.isSymbolicLink()) return { error: `path ${relativePath} must not be a symlink` };
  if (!stats.isFile()) return { error: `path ${relativePath} is not a regular file` };
  return { absolute, stats, normalized };
}

function validateAssetFacts(asset, appRoot, label, pointer, issues, { strict }) {
  const declaredFormat = typeof asset.format === 'string' ? asset.format : undefined;
  if (declaredFormat && !MEDIA_FORMATS.includes(declaredFormat)) {
    issues.push(`${label}: ${pointer}.format is not canonical`);
  }
  let fileInfo;
  if (typeof asset.path === 'string') {
    const resolved = safeAssetPath(appRoot, asset.path);
    if (resolved.error) issues.push(`${label}: ${pointer}.${resolved.error}`);
    else {
      const extension = path.extname(resolved.normalized).slice(1).toLowerCase();
      const allowed = declaredFormat ? EXTENSIONS_BY_FORMAT[declaredFormat] ?? [] : [];
      if (declaredFormat && !allowed.includes(extension)) {
        issues.push(`${label}: ${pointer}.format ${declaredFormat} does not match the .${extension} extension`);
      }
      try {
        fileInfo = decodeMediaFile(resolved.absolute, declaredFormat);
      } catch (error) {
        issues.push(`${label}: ${pointer}.path cannot be decoded (${error.message})`);
      }
      if (fileInfo) {
        if (!fileInfo.matchesDeclaredFormat) {
          issues.push(`${label}: ${pointer}.format ${declaredFormat} does not match the decoded bytes (${fileInfo.format})`);
        }
        if (asset.width !== undefined && asset.width !== fileInfo.width) {
          issues.push(`${label}: ${pointer}.width ${asset.width} does not match the file width ${fileInfo.width}`);
        }
        if (asset.height !== undefined && asset.height !== fileInfo.height) {
          issues.push(`${label}: ${pointer}.height ${asset.height} does not match the file height ${fileInfo.height}`);
        }
        if (asset.alphaChannel !== undefined && fileInfo.alpha !== undefined && asset.alphaChannel !== fileInfo.alpha) {
          issues.push(`${label}: ${pointer}.alphaChannel ${asset.alphaChannel} does not match the file alpha channel ${fileInfo.alpha}`);
        }
        if (asset.fileSizeBytes !== undefined && asset.fileSizeBytes !== fileInfo.size) {
          issues.push(`${label}: ${pointer}.fileSizeBytes ${asset.fileSizeBytes} does not match the file size ${fileInfo.size}`);
        }
        if (asset.durationSeconds !== undefined && fileInfo.durationSeconds !== undefined
          && Math.abs(asset.durationSeconds - fileInfo.durationSeconds) > 1) {
          issues.push(`${label}: ${pointer}.durationSeconds ${asset.durationSeconds} does not match the decoded duration ${Math.round(fileInfo.durationSeconds)}`);
        }
        if (strict && fileInfo.format !== 'MP4' && fileInfo.format !== 'MOV' && fileInfo.format !== 'M4V') {
          if (asset.width === undefined || asset.height === undefined) {
            issues.push(`${label}: ${pointer} requires width and height`);
          }
          if (asset.alphaChannel === undefined) issues.push(`${label}: ${pointer} requires alphaChannel`);
        }
        if (strict && (fileInfo.format === 'MP4' || fileInfo.format === 'MOV' || fileInfo.format === 'M4V')) {
          if (asset.durationSeconds === undefined) issues.push(`${label}: ${pointer} requires durationSeconds`);
        }
        if (strict && asset.fileSizeBytes === undefined) issues.push(`${label}: ${pointer} requires fileSizeBytes`);
      }
    }
  }
  if (asset.url !== undefined) {
    try {
      const parsed = new URL(asset.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    } catch {
      issues.push(`${label}: ${pointer}.url must be an HTTP(S) URL`);
    }
  }
  if (strict) {
    if (typeof asset.id !== 'string' || !asset.id.trim()) issues.push(`${label}: ${pointer}.id is required`);
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(asset.id)) issues.push(`${label}: ${pointer}.id must be lower kebab-case`);
    if (typeof asset.caption === 'string' && asset.caption.length > 160) {
      issues.push(`${label}: ${pointer}.caption exceeds 160 characters`);
    }
    if (!ASSET_TYPES.includes(asset.type)) issues.push(`${label}: ${pointer}.type is not a canonical asset role`);
    if (!ASSET_PURPOSES.includes(asset.purpose)) issues.push(`${label}: ${pointer}.purpose is not a canonical purpose`);
    else if (ROLE_PURPOSES[asset.type] && !ROLE_PURPOSES[asset.type].includes(asset.purpose)) {
      issues.push(`${label}: ${pointer}.purpose is not compatible with role ${asset.type}`);
    }
    if (asset.container === 'icons.primary') {
      if (asset.declaredType !== undefined && asset.declaredType !== 'ICON') {
        issues.push(`${label}: ${pointer}.type must be ICON`);
      }
      if (asset.purpose !== 'PRIMARY') issues.push(`${label}: ${pointer}.purpose must be PRIMARY`);
    }
    if (asset.type === 'SCREENSHOT') {
      if (typeof asset.platform !== 'string' || !asset.platform.trim()) issues.push(`${label}: ${pointer}.platform is required`);
      if (!DEVICE_CLASSES.includes(asset.deviceClass)) issues.push(`${label}: ${pointer}.deviceClass is required`);
      if (typeof asset.displayType !== 'string' || !asset.displayType.trim()) issues.push(`${label}: ${pointer}.displayType is required`);
      const capture = asset.metadata?.capture;
      if (!isObject(capture) || typeof capture.tool !== 'string' || !capture.tool.trim()
        || typeof capture.appVersion !== 'string' || !capture.appVersion.trim()
        || typeof capture.capturedAt !== 'string' || !capture.capturedAt.trim()) {
        issues.push(`${label}: ${pointer} requires metadata.capture with tool, appVersion, and capturedAt`);
      }
    }
    if (asset.type === 'PREVIEW_VIDEO') {
      if (typeof asset.platform !== 'string' || !asset.platform.trim()) issues.push(`${label}: ${pointer}.platform is required`);
      if (typeof asset.displayType !== 'string' || !asset.displayType.trim()) issues.push(`${label}: ${pointer}.displayType is required`);
      if (asset.external !== true && asset.durationSeconds === undefined) {
        issues.push(`${label}: ${pointer}.durationSeconds is required for an uploaded preview video`);
      }
    }
    if (asset.format === undefined) {
      if (asset.external !== true) issues.push(`${label}: ${pointer}.format is required`);
    } else if (!MEDIA_FORMATS.includes(asset.format)) {
      issues.push(`${label}: ${pointer}.format is required`);
    }
    if (asset.enabled !== undefined && typeof asset.enabled !== 'boolean') {
      issues.push(`${label}: ${pointer}.enabled must be a boolean`);
    }
    if ((asset.type === 'COVER' || asset.type === 'SCREENSHOT')
      && (typeof asset.metadata?.altText !== 'string' || !asset.metadata.altText.trim())) {
      issues.push(`${label}: ${pointer} requires localized metadata.altText`);
    }
    if (typeof asset.locale !== 'string' || !LOCALE_VALUE.test(asset.locale)) {
      issues.push(`${label}: ${pointer}.locale is required`);
    }
    if (asset.storePlatform !== undefined && !STORE_PLATFORMS.includes(asset.storePlatform)) {
      issues.push(`${label}: ${pointer}.storePlatform is not canonical`);
    }
    if (['ICON', 'COVER', 'SCREENSHOT', 'PREVIEW_IMAGE', 'FEATURE_GRAPHIC', 'POSTER'].includes(asset.type)) {
      if (asset.width === undefined || asset.height === undefined) issues.push(`${label}: ${pointer} requires width and height`);
      if (asset.alphaChannel === undefined) issues.push(`${label}: ${pointer} requires alphaChannel`);
    }
    if (asset.path === undefined && asset.driveUri === undefined && asset.resource === undefined && asset.external !== true) {
      issues.push(`${label}: ${pointer} requires path, driveUri, resource, or external: true`);
    }
    if (asset.external !== undefined && typeof asset.external !== 'boolean') {
      issues.push(`${label}: ${pointer}.external must be a boolean`);
    }
    if (asset.url === undefined && asset.path === undefined && asset.driveUri === undefined && asset.resource === undefined) {
      issues.push(`${label}: ${pointer} has no usable media source`);
    }
  }
  return fileInfo;
}

function assetGroupKey(asset, { includePlatform = false } = {}) {
  const platform = includePlatform ? asset.platform ?? '' : '';
  return `${platform}|${asset.displayType ?? asset.deviceClass ?? 'default'}|${asset.locale ?? ''}`;
}

function checkExactSizes(asset, sizes, label, pointer, issues) {
  if (!Array.isArray(sizes) || sizes.length === 0) return;
  if (asset.width === undefined || asset.height === undefined) return;
  const matches = sizes.some(([width, height]) => width === asset.width && height === asset.height);
  if (!matches) {
    const rendered = sizes.map(([width, height]) => `${width}x${height}`).join(', ');
    issues.push(`${label}: ${pointer} ${asset.width}x${asset.height} is not an accepted size (${rendered})`);
  }
}

function evaluateRoleAssets({
  role, config, assets, label, targetPlatforms, requiredLocales, groupKey, issues,
}) {
  const screenshotGroupKey = (asset) => (groupKey ? groupKey(asset) : assetGroupKey(asset));
  const roleAssets = assets.filter((asset) => asset.type === role);
  if (config.required && roleAssets.length === 0) {
    issues.push(`${label}: the ${role} asset is required`);
  }
  for (const asset of roleAssets) {
    const pointer = `${role.toLowerCase()} ${asset.id ?? '<no-id>'}`;
    if (config.formats && asset.format && !config.formats.includes(asset.format)) {
      issues.push(`${label}: ${pointer} format ${asset.format} is not accepted (${config.formats.join(', ')})`);
    }
    if (config.alpha === false && asset.alphaChannel === true) {
      issues.push(`${label}: ${pointer} must not contain an alpha channel`);
    }
    if (config.maxBytes && asset.fileSizeBytes && asset.fileSizeBytes > config.maxBytes) {
      issues.push(`${label}: ${pointer} exceeds the ${config.maxBytes} byte limit`);
    }
    if (config.exactSizes) checkExactSizes(asset, config.exactSizes, label, pointer, issues);
    if (config.minSide && asset.width !== undefined && asset.height !== undefined
      && Math.min(asset.width, asset.height) < config.minSide) {
      issues.push(`${label}: ${pointer} short side is below ${config.minSide}px`);
    }
    if (config.maxSide && asset.width !== undefined && asset.height !== undefined
      && Math.max(asset.width, asset.height) > config.maxSide) {
      issues.push(`${label}: ${pointer} long side exceeds ${config.maxSide}px`);
    }
    if (config.maxAspect && asset.width !== undefined && asset.height !== undefined
      && Math.max(asset.width / asset.height, asset.height / asset.width) > config.maxAspect) {
      issues.push(`${label}: ${pointer} exceeds the ${config.maxAspect}:1 aspect ratio limit`);
    }
    if (config.minDuration !== undefined && asset.durationSeconds !== undefined && asset.durationSeconds < config.minDuration) {
      issues.push(`${label}: ${pointer} is shorter than ${config.minDuration}s`);
    }
    if (config.maxDuration !== undefined && asset.durationSeconds !== undefined && asset.durationSeconds > config.maxDuration) {
      issues.push(`${label}: ${pointer} is longer than ${config.maxDuration}s`);
    }
    if (config.external) {
      if (asset.external !== true) issues.push(`${label}: ${pointer} must be external`);
      if (asset.path !== undefined) issues.push(`${label}: ${pointer} must not carry a repository path`);
      if (config.urlHosts && asset.url) {
        try {
          const host = new URL(asset.url).hostname.toLowerCase();
          if (!config.urlHosts.includes(host)) {
            issues.push(`${label}: ${pointer} must use an accepted host (${config.urlHosts.join(', ')})`);
          }
        } catch {
          // URL validity is reported by the structural check.
        }
      }
    }
    if (!config.external && asset.external === true) {
      issues.push(`${label}: ${pointer} must not be external`);
    }
  }
  if (role === 'COVER' && config.perLocale) {
    const counts = new Map();
    for (const asset of roleAssets) {
      const locale = asset.locale ?? '';
      const theme = asset.metadata?.theme === 'dark' ? 'dark' : 'light';
      const key = `${locale}|${theme}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      if (count > config.perLocale) issues.push(`${label}: cover ${key} has ${count} entries; at most ${config.perLocale} is allowed per locale and theme`);
    }
  }
  if (role === 'SCREENSHOT') {
    if (isObject(config.groups)) {
      const counts = new Map();
      for (const asset of roleAssets) {
        const displayType = asset.displayType;
        const definition = displayType ? config.groups[displayType] : undefined;
        if (!definition) {
          issues.push(`${label}: screenshot ${asset.id ?? '<no-id>'} uses unsupported displayType ${displayType ?? '<none>'}`);
          continue;
        }
        if (definition.sizes) checkExactSizes(asset, definition.sizes, label, `screenshot ${asset.id ?? '<no-id>'}`, issues);
        const key = `${displayType}|${asset.locale ?? ''}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [displayType, definition] of Object.entries(config.groups)) {
        const requiredPlatform = definition.requiresTargetPlatform ?? definition.requiredWhenTargetPlatform;
        const platformApplies = !requiredPlatform
          || targetPlatforms.includes(requiredPlatform)
          || (targetPlatforms.length === 0 && (definition.min ?? 0) > 0);
        const minimum = requiredPlatform
          ? (platformApplies ? Math.max(definition.min ?? 0, 1) : 0)
          : definition.min ?? 0;
        const maximum = definition.max;
        const applicableLocales = new Set([...requiredLocales, ...[...counts.keys()]
          .filter((key) => key.startsWith(`${displayType}|`))
          .map((key) => key.split('|')[1])]);
        for (const locale of applicableLocales) {
          const count = counts.get(`${displayType}|${locale}`) ?? 0;
          if (count < minimum) {
            const noun = minimum === 1 ? 'screenshot' : 'screenshots';
            issues.push(`${label}: screenshot group ${displayType}/${locale || '<none>'} needs at least ${minimum} ${noun}, found ${count}`);
          }
          if (maximum !== undefined && count > maximum) {
            issues.push(`${label}: screenshot group ${displayType}/${locale || '<none>'} exceeds ${maximum} screenshots`);
          }
        }
      }
    } else {
      const counts = new Map();
      for (const asset of roleAssets) {
        const key = screenshotGroupKey(asset);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, count] of counts) {
        if (config.min !== undefined && count < config.min) {
          issues.push(`${label}: screenshot group ${key || '<none>'} needs at least ${config.min} screenshots, found ${count}`);
        }
        if (config.max !== undefined && count > config.max) {
          issues.push(`${label}: screenshot group ${key || '<none>'} exceeds ${config.max} screenshots`);
        }
      }
    }
  }
  if (role === 'PREVIEW_VIDEO' && config.maxPerGroup) {
    const counts = new Map();
    for (const asset of roleAssets) {
      const key = groupKey(asset);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      if (count > config.maxPerGroup) issues.push(`${label}: preview video group ${key} exceeds ${config.maxPerGroup} videos`);
    }
  }
}

export function evaluateProfileAssets({
  assets, profile, roles, label, targetPlatforms = [], requiredLocales = ['en-US'], includePlatformInGroup = false,
}) {
  const issues = [];
  if (!isObject(profile?.assets)) return issues;
  for (const role of roles) {
    const config = profile.assets[role];
    if (!config) continue;
    evaluateRoleAssets({
      role,
      config,
      assets,
      label,
      targetPlatforms,
      requiredLocales,
      groupKey: (asset) => assetGroupKey(asset, { includePlatform: includePlatformInGroup }),
      issues,
    });
  }
  return issues;
}

export function validateStoreMediaAssets(manifest, label = 'agent.app.config.json') {
  const issues = [];
  const stores = storeLanes(manifest);
  if (stores.length === 0) return issues;
  const profiles = loadStoreProfiles().profiles;
  const assets = enabledAssets(mediaAssetsOf(manifest));
  const targetPlatforms = targetPlatformsOf(manifest);
  const requiredLocales = [defaultLocaleOf(manifest)];
  for (const store of stores) {
    const profile = profiles[store];
    if (!profile) {
      issues.push(`${label}: publish.stores declares ${store} without a store media profile`);
      continue;
    }
    const scoped = storeAssetsOf(assets, store);
    issues.push(...evaluateProfileAssets({
      assets: scoped,
      profile,
      roles: Object.keys(profile.assets),
      label: `${label}: ${store}`,
      targetPlatforms,
      requiredLocales,
    }));
  }
  return issues;
}

function validateGroupOrdering(assets, label, issues) {
  const groups = new Map();
  for (const asset of enabledAssets(assets)) {
    if (!['SCREENSHOT', 'PREVIEW_IMAGE', 'PREVIEW_VIDEO'].includes(asset.type)) continue;
    const key = `${asset.type}|${asset.storePlatform ?? ''}|${asset.platform ?? ''}|${asset.displayType ?? ''}|${asset.locale ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(asset);
  }
  for (const [key, entries] of groups) {
    for (const entry of entries) {
      if (entry.sortOrder !== undefined && (!Number.isInteger(entry.sortOrder) || entry.sortOrder < 0)) {
        issues.push(`${label}: ${entry.id ?? '<no-id>'}.sortOrder must be a non-negative integer`);
      }
    }
    const orders = entries.map((entry) => entry.sortOrder).filter((value) => Number.isInteger(value));
    if (new Set(orders).size !== orders.length) issues.push(`${label}: ${key} has duplicate sortOrder values`);
    if (entries.every((entry) => Number.isInteger(entry.sortOrder))) {
      const sorted = [...orders].sort((a, b) => a - b);
      if (sorted.some((value, index) => value !== index)) {
        issues.push(`${label}: ${key} sortOrder must be contiguous from 0`);
      }
    }
  }
}

function validateCaptureConfig({ manifest, appRoot, label, issues, families, appType }) {
  const configPath = path.join(appRoot, 'assets', 'capture', 'capture.config.json');
  if (!fs.existsSync(configPath)) {
    issues.push(`${label}: assets/capture/capture.config.json is required for this app type`);
    return;
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/u, ''));
  } catch (error) {
    issues.push(`${label}: assets/capture/capture.config.json is not valid JSON (${error.message})`);
    return;
  }
  if (!isObject(config)) {
    issues.push(`${label}: capture.config.json must be an object`);
    return;
  }
  if (config.schemaVersion !== 1) issues.push(`${label}: capture.config.json schemaVersion must be 1`);
  if (config.kind !== CAPTURE_CONFIG_KIND) issues.push(`${label}: capture.config.json kind must be ${CAPTURE_CONFIG_KIND}`);
  if (config.appKey !== manifest.app?.key) issues.push(`${label}: capture.config.json appKey must match app.key`);
  if (!Array.isArray(config.surfaces) || config.surfaces.length === 0) {
    issues.push(`${label}: capture.config.json surfaces must be a non-empty array`);
    return;
  }
  const ids = new Set();
  const surfaceFamilies = new Set();
  for (const [index, surface] of config.surfaces.entries()) {
    const pointer = `capture.surfaces[${index}]`;
    if (!isObject(surface)) {
      issues.push(`${label}: ${pointer} must be an object`);
      continue;
    }
    if (typeof surface.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(surface.id)) {
      issues.push(`${label}: ${pointer}.id must be lower kebab-case`);
    } else if (ids.has(surface.id)) {
      issues.push(`${label}: ${pointer}.id duplicates ${surface.id}`);
    } else {
      ids.add(surface.id);
    }
    if (!['ui', 'device', 'content'].includes(surface.kind)) issues.push(`${label}: ${pointer}.kind is not canonical`);
    if (surface.tool !== undefined && !CAPTURE_TOOLS.includes(surface.tool)) {
      issues.push(`${label}: ${pointer}.tool is not a canonical adapter`);
    }
    if (!DEVICE_CLASSES.includes(surface.deviceClass)) issues.push(`${label}: ${pointer}.deviceClass is not canonical`);
    if (typeof surface.displayType !== 'string' || !/^[A-Z][A-Z0-9_]*$/u.test(surface.displayType)) {
      issues.push(`${label}: ${pointer}.displayType must be an upper-snake display token`);
    }
    if (!Array.isArray(surface.locales) || surface.locales.length === 0) {
      issues.push(`${label}: ${pointer}.locales must be a non-empty array`);
    } else {
      for (const locale of surface.locales) {
        if (!LOCALE_VALUE.test(locale)) issues.push(`${label}: ${pointer}.locales contains invalid locale ${locale}`);
      }
    }
    if (surface.kind === 'ui') {
      if (!isObject(surface.viewport)
        || !Number.isInteger(surface.viewport.width) || surface.viewport.width < 1
        || !Number.isInteger(surface.viewport.height) || surface.viewport.height < 1
        || typeof surface.viewport.deviceScaleFactor !== 'number' || surface.viewport.deviceScaleFactor < 0.5) {
        issues.push(`${label}: ${pointer}.viewport is required for a ui surface`);
      }
    }
    const family = surfaceFamily(surface.platform);
    if (family) surfaceFamilies.add(family);
  }
  if (!isObject(config.capture)) {
    issues.push(`${label}: capture.config.json capture must be an object`);
    return;
  }
  if (!CAPTURE_TOOLS.includes(config.capture.tool)) issues.push(`${label}: capture.tool is not a canonical adapter`);
  if (typeof config.capture.command !== 'string' || !config.capture.command.trim()) {
    issues.push(`${label}: capture.command is required`);
  }
  if (typeof config.capture.outputRoot !== 'string' || !config.capture.outputRoot.trim()) {
    issues.push(`${label}: capture.outputRoot is required`);
  }
  const locales = Array.isArray(config.capture.locales) ? config.capture.locales : [];
  if (!locales.includes(defaultLocaleOf(manifest))) {
    issues.push(`${label}: capture.locales must include the default locale ${defaultLocaleOf(manifest)}`);
  }
  const coverLocales = (Array.isArray(manifest.media?.previews) ? manifest.media.previews : [])
    .filter((asset) => asset?.type === 'COVER' && asset.enabled !== false && typeof asset.locale === 'string')
    .map((asset) => asset.locale);
  for (const locale of new Set(coverLocales)) {
    if (!locales.includes(locale)) {
      issues.push(`${label}: capture.locales must include cover locale ${locale}`);
    }
  }
  if (families) {
    for (const family of families.keys()) {
      if (!surfaceFamilies.has(family)) {
        issues.push(`${label}: capture.config.json has no surface for the shipped ${family} UI surface`);
      }
    }
  }
  if (CONTENT_APP_TYPES.has(appType) && !config.surfaces.some((surface) => surface?.kind === 'content')) {
    issues.push(`${label}: capture.config.json requires a content surface for ${appType}`);
  }
}

function validateMediaStructure({ manifest, appRoot, label, issues, strict }) {
  const assets = mediaAssetsOf(manifest);
  const idCounts = new Map();
  for (const [index, asset] of assets.entries()) {
    const pointer = `media ${asset.container ?? `[${index}]`}`;
    if (asset.id) {
      idCounts.set(asset.id, (idCounts.get(asset.id) ?? 0) + 1);
    }
    validateAssetFacts(asset, appRoot, label, pointer, issues, { strict: strict || Boolean(asset.storePlatform) });
  }
  for (const [id, count] of idCounts) {
    if (count > 1) issues.push(`${label}: media id ${id} is not unique`);
  }
  if (strict) validateGroupOrdering(assets, label, issues);
  return assets;
}

function validatePosterReferences(assets, label, issues) {
  const enabledById = new Map(enabledAssets(assets).filter((asset) => asset.id).map((asset) => [asset.id, asset]));
  for (const asset of enabledAssets(assets)) {
    if (asset.type !== 'PREVIEW_VIDEO') continue;
    const posterId = asset.metadata?.posterAssetId;
    if (typeof posterId !== 'string' || !posterId) {
      issues.push(`${label}: preview video ${asset.id ?? '<no-id>'} requires metadata.posterAssetId`);
      continue;
    }
    const poster = enabledById.get(posterId);
    if (!poster) issues.push(`${label}: preview video ${asset.id ?? '<no-id>'} references unknown poster ${posterId}`);
    else if (!['POSTER', 'PREVIEW_IMAGE', 'COVER'].includes(poster.type)) {
      issues.push(`${label}: preview video ${asset.id ?? '<no-id>'} poster ${posterId} must be POSTER, PREVIEW_IMAGE, or COVER`);
    }
  }
}

function validateMarkerRoot({ appRoot, manifest, label, typeInfo, issues, families }) {
  const assetsRoot = path.join(appRoot, 'assets');
  if (!fs.existsSync(assetsRoot)) {
    issues.push(`${label}: assets/ directory is required by ${APP_ASSETS_STANDARD}`);
    return;
  }
  const rootStats = fs.lstatSync(assetsRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    issues.push(`${label}: assets/ must be a real directory, not a symlink or file`);
    return;
  }
  const readme = path.join(assetsRoot, 'README.md');
  if (!fs.existsSync(readme)) issues.push(`${label}: assets/README.md is required`);
  else if (fs.readFileSync(readme, 'utf8').trim().length < 80) {
    issues.push(`${label}: assets/README.md must document ownership, source flow, rights basis, capture, and update procedure`);
  }
  if (!fs.existsSync(path.join(assetsRoot, '.gitignore'))) issues.push(`${label}: assets/.gitignore is required`);
  if (!fs.existsSync(path.join(assetsRoot, 'resources'))) issues.push(`${label}: assets/resources/ is required`);
  for (const resource of typeInfo.resources ?? []) {
    if (!fs.existsSync(path.join(assetsRoot, 'resources', resource))) {
      issues.push(`${label}: assets/resources/${resource}/ is required for this app type`);
    }
  }
  if (typeInfo.capture) validateCaptureConfig({ manifest, appRoot, label, issues, families, appType: manifest.app?.appType });
}

function validateMatrix({ manifest, assets, label, issues, catalogReady, families }) {
  const type = manifest.app?.appType;
  const typeInfo = APP_TYPE_MEDIA[type] ?? APP_TYPE_MEDIA.NONE;
  const catalog = enabledAssets(catalogAssetsOf(assets));
  const icons = catalog.filter((asset) => asset.type === 'ICON');
  if (icons.length === 0) issues.push(`${label}: an enabled ICON is required`);
  if (!catalogReady) return;
  const covers = catalog.filter((asset) => asset.type === 'COVER');
  const defaultLocale = defaultLocaleOf(manifest);
  if (covers.length === 0) issues.push(`${label}: a catalog COVER is required for the default locale`);
  else if (!covers.some((asset) => asset.locale === defaultLocale)) {
    issues.push(`${label}: a catalog COVER is required for the default locale ${defaultLocale}`);
  }
  if (typeInfo.screenshots && families && families.size > 0) {
    const targetPlatforms = new Set(targetPlatformsOf(manifest));
    for (const [family, descriptor] of families) {
      const requirements = [];
      if (family === 'ios') {
        const hasPhone = targetPlatforms.size === 0 || targetPlatforms.has('ios');
        const hasTablet = targetPlatforms.has('ipados');
        if (hasPhone) requirements.push({ deviceClass: descriptor.deviceClass, displayType: descriptor.displayType, label: descriptor.displayType });
        if (hasTablet) requirements.push({ deviceClass: 'IPAD', displayType: 'IPAD_13', label: 'IPAD_13' });
      } else if (family === 'android') {
        const hasPhone = targetPlatforms.size === 0 || targetPlatforms.has('android');
        const hasTablet = targetPlatforms.has('android-tablet');
        if (hasPhone) requirements.push({ deviceClass: descriptor.deviceClass, displayType: descriptor.displayType, label: descriptor.displayType });
        if (hasTablet) requirements.push({ deviceClass: 'ANDROID_TABLET', displayType: 'ANDROID_TABLET', label: 'ANDROID_TABLET' });
      } else {
        requirements.push({ deviceClass: descriptor.deviceClass, displayType: descriptor.displayType, label: descriptor.displayType });
      }
      for (const requirement of requirements) {
        const match = catalog.find((asset) => {
          if (asset.type !== 'SCREENSHOT' || surfaceFamily(asset.platform) !== family) return false;
          if (asset.deviceClass !== requirement.deviceClass) return false;
          if (requirement.deviceClass === 'IPAD') return String(asset.displayType ?? '').startsWith('IPAD_');
          if (requirement.deviceClass === 'ANDROID_TABLET') return String(asset.displayType ?? '').startsWith('ANDROID_TABLET');
          return asset.displayType === requirement.displayType;
        });
        if (!match) {
          issues.push(`${label}: a catalog SCREENSHOT is required for the ${family} UI surface (${descriptor.platforms.join(', ')}, ${requirement.label})`);
        }
      }
    }
  }
  if (typeInfo.slidePreviews) {
    const slides = catalog.filter((asset) => asset.type === 'PREVIEW_IMAGE' && asset.purpose === 'SLIDE_PREVIEW');
    if (slides.length < typeInfo.slidePreviews) {
      issues.push(`${label}: ${typeInfo.slidePreviews} slide previews are required for ${type}, found ${slides.length}`);
    }
  }
  if (typeInfo.poster && !catalog.some((asset) => asset.type === 'POSTER')) {
    issues.push(`${label}: a POSTER is required for ${type}`);
  }
  if (typeInfo.previewVideo && !catalog.some((asset) => asset.type === 'PREVIEW_VIDEO')) {
    issues.push(`${label}: a PREVIEW_VIDEO is required for ${type}`);
  }
}

function validatePlaceholders({ manifest, assets, label, issues, enabled }) {
  if (!enabled) return;
  if (!isCatalogReady(manifest)) return;
  const placeholders = enabledAssets(assets).filter((asset) => asset.metadata?.placeholder === true || asset.metadata?.generatedPlaceholder === true);
  for (const asset of placeholders) {
    issues.push(`${label}: enabled placeholder media ${asset.id ?? '<no-id>'} is not allowed for a catalog-ready application`);
  }
}

export function validateAppAssets({
  manifest, appRoot, label = 'agent.app.config.json', requireStandard = false, now = new Date(),
}) {
  const issues = [];
  if (!isObject(manifest)) return [`${label}: manifest must be an object`];
  const standard = standardOf(manifest);
  const marked = standard === APP_ASSETS_STANDARD;
  if (standard !== undefined && !marked) {
    issues.push(`${label}: media.metadata.standard must be ${APP_ASSETS_STANDARD}`);
  }
  if (!marked) {
    if (requireStandard) issues.push(`${label}: media.metadata.standard must be ${APP_ASSETS_STANDARD}`);
    const due = manifest.media?.metadata?.assetsMigration?.due;
    if (typeof due === 'string' && due.trim()) {
      const deadline = new Date(due);
      if (!Number.isNaN(deadline.valueOf()) && deadline <= now) {
        issues.push(`${label}: assets migration deadline ${due} has passed without ${APP_ASSETS_STANDARD}`);
      }
    }
  }
  const appType = manifest.app?.appType;
  if (!APP_TYPES.includes(appType)) issues.push(`${label}: app.appType must use a PlusProjectType value`);
  const typeInfo = APP_TYPE_MEDIA[appType] ?? APP_TYPE_MEDIA.NONE;
  const families = shippedUiFamilies(manifest.publish?.platforms);
  const catalogReady = isCatalogReady(manifest);
  const stores = storeLanes(manifest);

  const assets = validateMediaStructure({
    manifest,
    appRoot,
    label,
    issues,
    strict: marked || stores.length > 0,
  });
  if (marked || stores.length > 0) validatePosterReferences(assets, label, issues);
  validatePlaceholders({ manifest, assets, label, issues, enabled: marked });

  if (marked) {
    const defaultLocale = manifest.media?.metadata?.defaultLocale;
    if (typeof defaultLocale !== 'string' || !LOCALE_VALUE.test(defaultLocale)) {
      issues.push(`${label}: media.metadata.defaultLocale is required`);
    }
    validateMarkerRoot({ appRoot, manifest, label, typeInfo, issues, families });
    validateMatrix({ manifest, assets, label, issues, catalogReady, families });
  }

  if (marked) {
    const profiles = loadStoreProfiles().profiles;
    const catalogProfile = profiles.SDKWORK_APPSTORE;
    const requiredLocales = [...new Set([defaultLocaleOf(manifest), ...enabledAssets(assets).map((asset) => asset.locale).filter(Boolean)])];
    const roles = ['ICON', 'COVER', 'PREVIEW_IMAGE', 'POSTER', 'PREVIEW_VIDEO', 'FEATURE_GRAPHIC'];
    if (families.size > 0 && typeInfo.screenshots) roles.push('SCREENSHOT');
    issues.push(...evaluateProfileAssets({
      assets: enabledAssets(catalogAssetsOf(assets)),
      profile: catalogProfile,
      roles: catalogReady ? roles : roles.filter((role) => role === 'ICON'),
      label: `${label}: SDKWORK_APPSTORE`,
      targetPlatforms: targetPlatformsOf(manifest),
      requiredLocales,
      includePlatformInGroup: true,
    }));
  }

  if (stores.length > 0) issues.push(...validateStoreMediaAssets(manifest, label));
  return [...new Set(issues)];
}

export function validateAppAssetsFile(file, options = {}) {
  const appRoot = path.dirname(file);
  const label = options.label ?? path.basename(appRoot);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
  } catch (error) {
    return [`${label}: invalid JSON (${error.message})`];
  }
  return validateAppAssets({ ...options, manifest, appRoot, label });
}

export function findAppManifests(root) {
  const files = [];
  const ignored = new Set(['.git', '.sdkwork', 'node_modules', 'target', 'dist', 'build', 'vendor', '.dart_tool', 'oh_modules']);
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && !entry.name.startsWith('_sdkwork-agents-local-archive')) walk(full);
      } else if (entry.name === 'agent.app.config.json') {
        files.push(full);
      }
    }
  };
  walk(path.resolve(root));
  return files.sort();
}

export function captureToolForPlatform(platform) {
  const family = surfaceFamily(platform);
  const familyTools = {
    web: 'playwright',
    h5: 'playwright',
    desktop: 'host-webview',
    ios: 'ios-xctest',
    android: 'android-instrumentation',
    harmony: 'harmony-test',
    'mini-program': 'mini-program-automator',
    quickapp: 'android-instrumentation',
    mobile: 'host-webview',
  };
  return familyTools[family];
}

export function captureSurfacesForType(appType, platforms, targetPlatforms = []) {
  const typeInfo = APP_TYPE_MEDIA[appType] ?? APP_TYPE_MEDIA.NONE;
  if (!typeInfo.capture) return { tool: undefined, surfaces: [] };
  if (CONTENT_APP_TYPES.has(appType)) {
    return {
      tool: 'render-pipeline',
      surfaces: [{
        id: 'content',
        kind: 'content',
        tool: 'render-pipeline',
        platform: 'WEB',
        deviceClass: 'CONTENT',
        displayType: appType === 'PPT' ? 'SLIDE_16_9' : appType === 'VIDEO' ? 'VIDEO_16_9' : 'POSTER_MASTER',
        locales: ['en-US'],
      }],
    };
  }
  const families = shippedUiFamilies(platforms);
  const surfaces = [];
  const sizes = {
    web: { platform: 'WEB', width: 1920, height: 1080, scale: 1 },
    h5: { platform: 'H5', width: 390, height: 844, scale: 3 },
    desktop: { platform: 'DESKTOP', width: 1920, height: 1080, scale: 1 },
    ios: { platform: 'APP_IOS', width: 440, height: 956, scale: 3 },
    android: { platform: 'APP_ANDROID', width: 540, height: 960, scale: 2 },
    harmony: { platform: 'APP_HARMONY', width: 540, height: 960, scale: 2 },
    mobile: { platform: 'APP', width: 390, height: 844, scale: 3 },
    'mini-program': { platform: 'MP_WEIXIN', width: 375, height: 667, scale: 2 },
    quickapp: { platform: 'QUICKAPP', width: 390, height: 844, scale: 3 },
  };
  for (const [family, descriptor] of families) {
    const size = sizes[family];
    if (!size) continue;
    const pushSurface = (id, platform, deviceClass, displayType, viewport) => {
      surfaces.push({
        id,
        kind: 'ui',
        tool: captureToolForPlatform(platform),
        platform,
        deviceClass,
        displayType,
        viewport,
        locales: ['en-US'],
        routes: [{ id: `${manifestRoutePrefix(appType)}.home`, path: '/' }],
        theme: 'light',
        readySelector: '[data-sdkwork-app-ready]',
      });
    };
    if (family === 'ios') {
      const hasPhone = targetPlatforms.length === 0 || targetPlatforms.includes('ios');
      const hasTablet = targetPlatforms.includes('ipados');
      if (hasPhone) {
        pushSurface(`${family}-primary`, size.platform, descriptor.deviceClass, descriptor.displayType, {
          width: size.width, height: size.height, deviceScaleFactor: size.scale,
        });
      }
      if (hasTablet) {
        pushSurface(`${family}-tablet`, 'APP_IOS', 'IPAD', 'IPAD_13', {
          width: 1024, height: 1366, deviceScaleFactor: 2,
        });
      }
    } else if (family === 'android') {
      const hasPhone = targetPlatforms.length === 0 || targetPlatforms.includes('android');
      const hasTablet = targetPlatforms.includes('android-tablet');
      if (hasPhone) {
        pushSurface(`${family}-primary`, size.platform, descriptor.deviceClass, descriptor.displayType, {
          width: size.width, height: size.height, deviceScaleFactor: size.scale,
        });
      }
      if (hasTablet) {
        pushSurface(`${family}-tablet`, 'APP_ANDROID', 'ANDROID_TABLET', 'ANDROID_TABLET', {
          width: 1280, height: 800, deviceScaleFactor: 1,
        });
      }
    } else {
      pushSurface(`${family}-primary`, size.platform, descriptor.deviceClass, descriptor.displayType, {
        width: size.width, height: size.height, deviceScaleFactor: size.scale,
      });
    }
  }
  if (surfaces.length === 0) {
    const platform = Array.isArray(platforms) && platforms[0] ? platforms[0] : 'WEB';
    const descriptor = UI_PLATFORMS[platform] ?? { deviceClass: 'BROWSER', displayType: 'DESKTOP_16_9' };
    surfaces.push({
      id: 'primary',
      kind: 'ui',
      tool: captureToolForPlatform(platform),
      platform,
      deviceClass: descriptor.deviceClass,
      displayType: descriptor.displayType,
      viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
      locales: ['en-US'],
      routes: [{ id: `${manifestRoutePrefix(appType)}.home`, path: '/' }],
      theme: 'light',
      readySelector: '[data-sdkwork-app-ready]',
    });
  }
  const tool = surfaces[0].tool ?? typeInfo.capture;
  return { tool, surfaces };
}

function manifestRoutePrefix(appType) {
  const map = {
    APP_HTML: 'app', APP_VUE: 'app', APP_REACT: 'app', APP_FLUTTER: 'app', APP_UNIAPP: 'app', APP_UNITY: 'app', APP_HARMONY: 'app',
  };
  return map[appType] ?? 'app';
}
