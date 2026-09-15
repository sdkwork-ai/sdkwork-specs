#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateAppManifestDeployment } from './check-app-manifest-deployment-standard.mjs';

const TOP_LEVEL_FIELDS = new Set([
  '$schema', 'schemaVersion', 'kind', 'app', 'backend', 'runtime', 'media',
  'publish', 'environments', 'artifacts', 'release', 'security', 'devApp',
  'metadata',
]);
const REQUIRED_SECTIONS = [
  'app', 'backend', 'runtime', 'media', 'publish', 'artifacts',
  'release', 'security',
];
const APP_TYPES = new Set([
  'NONE', 'SDK', 'PPT', 'APP_HTML', 'APP_VUE', 'APP_FLUTTER', 'APP_UNIAPP',
  'APP_REACT', 'APP_UNITY', 'VIDEO', 'POSTER',
]);
const RUNTIME_FAMILIES = new Set([
  'web', 'mobile', 'desktop', 'server', 'cli', 'mini-program', 'library', 'plugin',
]);
const PACKAGE_FORMATS = new Set([
  'SOURCE_CODE', 'JAR', 'WAR', 'ZIP', 'TAR_GZ', 'APK', 'AAB', 'IPA', 'HAP',
  'HARMONY_APP', 'EXE', 'MSI', 'DMG', 'APPIMAGE', 'DEB', 'RPM', 'DOCKER_IMAGE',
  'MINI_PROGRAM_PACKAGE', 'OTHER',
]);
const PLATFORM_VALUES = new Set([
  'WEB', 'H5', 'H5_WEIXIN', 'APP', 'APP_PLUS', 'APP_ANDROID', 'APP_IOS',
  'APP_HARMONY', 'DESKTOP', 'DESKTOP_WINDOWS', 'DESKTOP_MACOS', 'DESKTOP_LINUX',
  'MP', 'MP_WEIXIN', 'MP_ALIPAY', 'MP_BAIDU', 'MP_TOUTIAO', 'MP_LARK', 'MP_QQ',
  'MP_KUAISHOU', 'MP_JD', 'MP_360', 'MP_DINGTALK', 'MP_ALI', 'ADMIN', 'CLI',
  'API', 'OTHER',
]);
const MEDIA_FORMATS = new Set(['PNG', 'JPG', 'JPEG', 'WEBP', 'MP4', 'MOV']);
const DIRECT_DISTRIBUTION_SOURCE_TYPES = new Set([
  'GIT_REPOSITORY', 'BINARY_URL', 'WEB_URL', 'CONTAINER_IMAGE', 'MINI_PROGRAM',
]);
const SECRET_KEY_PATTERN = /(?:password|access[-_]?token|refresh[-_]?token|api[-_]?key|private[-_]?key|client[-_]?secret|credential)/iu;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function containsSecret(value, trail = []) {
  if (Array.isArray(value)) {
    return value.some((item, index) => containsSecret(item, [...trail, String(index)]));
  }
  if (!object(value)) return false;
  return Object.entries(value).some(([key, nested]) => {
    if (SECRET_KEY_PATTERN.test(key) && typeof nested === 'string' && nested.trim()) return true;
    return containsSecret(nested, [...trail, key]);
  });
}

function validateStoreMedia(manifest, label, issues) {
  const assets = [
    ...(manifest.media?.icons?.platform ?? []),
    ...(manifest.media?.screenshots ?? []),
    ...(manifest.media?.previews ?? []),
  ];
  const stores = new Set((manifest.publish?.stores ?? []).map((store) => store?.marketId ?? store?.storePlatform));
  if (stores.has('GOOGLE_PLAY')) {
    const google = assets.filter((asset) => asset?.storePlatform === 'GOOGLE_PLAY');
    const icon = google.find((asset) => asset.type === 'ICON');
    if (!icon) issues.push(`${label}: Google Play requires an icon`);
    else if (icon.width !== 512 || icon.height !== 512) issues.push(`${label}: Google Play icon must be 512x512`);
    const feature = google.find((asset) => asset.type === 'FEATURE_GRAPHIC');
    if (!feature) issues.push(`${label}: Google Play requires a feature graphic`);
    else if (feature.width !== 1024 || feature.height !== 500) issues.push(`${label}: Google Play feature graphic must be 1024x500`);
    const screenshots = google.filter((asset) => asset.type === 'SCREENSHOT');
    if (screenshots.length < 2) issues.push(`${label}: Google Play requires at least two screenshots`);
    for (const asset of screenshots) {
      if (asset.width < 320 || asset.width > 3840 || asset.height < 320 || asset.height > 3840
        || Math.max(asset.width / asset.height, asset.height / asset.width) > 2) {
        issues.push(`${label}: Google Play screenshot dimensions/aspect ratio are invalid`);
      }
    }
  }
  if (stores.has('APPLE_APP_STORE')) {
    const apple = assets.filter((asset) => asset?.storePlatform === 'APPLE_APP_STORE');
    const icon = apple.find((asset) => asset.type === 'ICON');
    if (!icon) issues.push(`${label}: Apple App Store requires an icon`);
    else if (icon.width !== 1024 || icon.height !== 1024) issues.push(`${label}: Apple App Store icon must be 1024x1024`);
    const screenshots = apple.filter((asset) => asset.type === 'SCREENSHOT');
    if (screenshots.length < 1) issues.push(`${label}: Apple App Store requires at least one screenshot`);
    const videos = apple.filter((asset) => asset.type === 'PREVIEW_VIDEO');
    const videoGroups = new Map();
    for (const video of videos) {
      const key = `${video.displayType ?? ''}|${video.locale ?? ''}`;
      videoGroups.set(key, (videoGroups.get(key) ?? 0) + 1);
    }
    for (const [key, count] of videoGroups) if (count > 3) issues.push(`${label}: Apple preview video group ${key} exceeds three videos`);
  }
}

export function validateAppManifest(manifest, label = 'sdkwork.app.config.json') {
  const issues = [];
  if (!object(manifest)) return [`${label}: manifest must be an object`];
  for (const field of Object.keys(manifest)) {
    if (!TOP_LEVEL_FIELDS.has(field)) issues.push(`${label}: unknown top-level field ${field}`);
  }
  if (manifest.schemaVersion !== 3) issues.push(`${label}: schemaVersion must be 3`);
  if (manifest.kind !== 'sdkwork.app') issues.push(`${label}: kind must be sdkwork.app`);
  for (const section of REQUIRED_SECTIONS) {
    if (!object(manifest[section])) issues.push(`${label}: ${section} must be an object`);
  }
  const hasLegacyEnvironmentMap = Object.hasOwn(manifest, 'environments');
  const deploymentConfig = manifest.metadata?.deploymentConfig;
  if (hasLegacyEnvironmentMap && !object(manifest.environments)) {
    issues.push(`${label}: environments must be an object`);
  }
  if (!hasLegacyEnvironmentMap && deploymentConfig !== 'etc/sdkwork.deployment.config.json') {
    issues.push(`${label}: metadata.deploymentConfig must point to etc/sdkwork.deployment.config.json when environments is omitted`);
  }

  const app = manifest.app ?? {};
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(app.key ?? '')) {
    issues.push(`${label}: app.key must be lower kebab-case`);
  }
  if (typeof app.name !== 'string' || !app.name.trim()) issues.push(`${label}: app.name is required`);
  if (typeof app.displayName !== 'string' || !app.displayName.trim()) {
    issues.push(`${label}: app.displayName is required`);
  }
  try {
    const website = new URL(app.officialWebsiteUrl);
    if (!['http:', 'https:'].includes(website.protocol)) throw new Error('unsupported protocol');
  } catch {
    issues.push(`${label}: app.officialWebsiteUrl must be an HTTP(S) URL`);
  }
  if (!APP_TYPES.has(app.appType)) issues.push(`${label}: app.appType must use a PlusProjectType value`);

  const runtime = manifest.runtime ?? {};
  if (!RUNTIME_FAMILIES.has(runtime.family)) {
    issues.push(`${label}: runtime.family must use the canonical family vocabulary`);
  }
  if (manifest.release?.currentVersion && !SEMVER_PATTERN.test(manifest.release.currentVersion)) {
    issues.push(`${label}: release.currentVersion must use SemVer`);
  }
  if (!Array.isArray(manifest.release?.notes) || manifest.release.notes.length === 0) {
    issues.push(`${label}: release.notes must contain one current release entry`);
  }
  validateStoreMedia(manifest, label, issues);

  for (const field of ['platforms', 'installPlatforms']) {
    for (const [index, platform] of (manifest.publish?.[field] ?? []).entries()) {
      if (!PLATFORM_VALUES.has(platform)) issues.push(`${label}: publish.${field}[${index}] is not a canonical PlusPlatform`);
    }
  }

  const mediaItems = [
    ...(manifest.media?.icons?.platform ?? []),
    ...(manifest.media?.screenshots ?? []),
    ...(manifest.media?.previews ?? []),
  ];
  if (!object(manifest.media?.icons?.primary)) issues.push(`${label}: media.icons.primary is required`);
  else mediaItems.push({ ...manifest.media.icons.primary, type: 'ICON', purpose: 'PRIMARY' });
  if (!Array.isArray(manifest.media?.icons?.platform)) issues.push(`${label}: media.icons.platform must be an array`);
  if (!Array.isArray(manifest.media?.screenshots)) issues.push(`${label}: media.screenshots must be an array`);
  if (!Array.isArray(manifest.media?.previews)) issues.push(`${label}: media.previews must be an array`);
  const mediaIds = new Set();
  for (const [index, asset] of mediaItems.entries()) {
    const pointer = `${label}: media[${index}]`;
    if (!object(asset)) {
      issues.push(`${pointer} must be an object`);
      continue;
    }
    if (!asset.id) issues.push(`${pointer}.id is required`);
    else {
      if (mediaIds.has(asset.id)) issues.push(`${pointer}.id must be unique`);
      mediaIds.add(asset.id);
    }
    if (asset.type && !['ICON', 'SCREENSHOT', 'PREVIEW_IMAGE', 'PREVIEW_VIDEO', 'FEATURE_GRAPHIC'].includes(asset.type)) {
      issues.push(`${pointer}.type is not canonical`);
    }
    if (asset.format && !MEDIA_FORMATS.has(asset.format)) issues.push(`${pointer}.format is not canonical`);
    if (asset.width !== undefined && (!Number.isInteger(asset.width) || asset.width < 1)) issues.push(`${pointer}.width must be a positive integer`);
    if (asset.height !== undefined && (!Number.isInteger(asset.height) || asset.height < 1)) issues.push(`${pointer}.height must be a positive integer`);
    if (asset.type === 'ICON' && asset.purpose === 'PRIMARY'
      && (asset.width !== undefined || asset.height !== undefined)
      && (asset.width !== 1024 || asset.height !== 1024)) {
      issues.push(`${pointer}: primary icon must be 1024x1024`);
    }
    if (asset.url !== undefined) {
      try {
        const url = new URL(asset.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      } catch {
        issues.push(`${pointer}.url must be an HTTP(S) URL`);
      }
    }
    if (!asset.url && !asset.driveUri && !asset.resource) issues.push(`${pointer}: media requires url, driveUri, or resource`);
  }
  if (typeof runtime.framework !== 'string' || !runtime.framework.trim()) {
    issues.push(`${label}: runtime.framework is required`);
  }

  const packages = manifest.artifacts?.installConfig?.packages;
  if (!Array.isArray(packages)) {
    issues.push(`${label}: artifacts.installConfig.packages must be an array`);
  } else {
    const ids = new Set();
    for (const [index, pkg] of packages.entries()) {
      const pointer = `${label}: artifacts.installConfig.packages[${index}]`;
      if (!object(pkg)) continue;
      for (const required of ['id', 'name', 'sourceType', 'packageFormat', 'platform', 'architecture', 'profileBinding', 'runtimeTarget']) {
        if (typeof pkg[required] !== 'string' || !pkg[required].trim()) {
          issues.push(`${pointer}.${required} is required`);
        }
      }
      if (ids.has(pkg.id)) issues.push(`${pointer}.id must be unique`);
      ids.add(pkg.id);
      if (pkg.packageFormat && !PACKAGE_FORMATS.has(pkg.packageFormat)) {
        issues.push(`${pointer}.packageFormat is not canonical`);
      }
      if (pkg.platform && !PLATFORM_VALUES.has(pkg.platform)) issues.push(`${pointer}.platform is not a canonical PlusPlatform`);
      if (['BINARY_URL', 'WEB_URL', 'CONTAINER_IMAGE', 'MINI_PROGRAM', 'APP_STORE'].includes(pkg.sourceType)) {
        if (typeof pkg.url !== 'string' || !/^https?:\/\//iu.test(pkg.url)) {
          issues.push(`${pointer}.url must be an HTTP(S) URL for ${pkg.sourceType}`);
        }
      }
      if (pkg.sourceType === 'CONTAINER_IMAGE' && pkg.url && !/@sha256:[a-f0-9]{64}$/iu.test(pkg.url)) {
        issues.push(`${pointer}.url must contain an immutable OCI @sha256 digest`);
      }
      if (manifest.security?.checksumRequired && pkg.enabled !== false
        && DIRECT_DISTRIBUTION_SOURCE_TYPES.has(pkg.sourceType)
        && (!pkg.checksumAlgorithm || !pkg.checksum)) {
        issues.push(`${pointer}: checksum is required by security.checksumRequired`);
      }
    }
    const defaultPackageId = manifest.artifacts?.installConfig?.defaultPackageId;
    if (defaultPackageId && !ids.has(defaultPackageId)) {
      issues.push(`${label}: artifacts.installConfig.defaultPackageId must reference a package`);
    }
    const notes = manifest.release?.notes;
    if (Array.isArray(notes) && notes.length > 0) {
      if (notes.filter((note) => note?.current === true).length !== 1) {
        issues.push(`${label}: release.notes must contain exactly one current entry`);
      }
      for (const [index, note] of notes.entries()) {
        if (note?.version && !SEMVER_PATTERN.test(note.version)) {
          issues.push(`${label}: release.notes[${index}].version must use SemVer`);
        }
        for (const packageId of note?.packageIds ?? []) {
          if (!ids.has(packageId)) {
            issues.push(`${label}: release.notes[${index}].packageIds references unknown ${packageId}`);
          }
        }
      }
    }
  }

  if (containsSecret(manifest)) issues.push(`${label}: manifest contains a credential-like value`);
  issues.push(...validateAppManifestDeployment(manifest, label));
  return [...new Set(issues)];
}

export function findAppManifests(root) {
  const files = [];
  const ignored = new Set(['.git', '.sdkwork', 'node_modules', 'target', 'dist', 'build', 'vendor']);
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          !ignored.has(entry.name)
          && !entry.name.startsWith('_sdkwork-agents-local-archive')
        ) {
          walk(full);
        }
      } else if (entry.name === 'sdkwork.app.config.json') {
        files.push(full);
      }
    }
  };
  walk(path.resolve(root));
  return files.sort();
}

export function validateAppManifestFiles(files, root) {
  const issues = [];
  const keys = new Map();
  for (const file of files) {
    const label = path.relative(root, file).replaceAll('\\', '/');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
    } catch {
      issues.push(`${label}: invalid JSON`);
      continue;
    }
    issues.push(...validateAppManifest(manifest, label));
    if (typeof manifest.app?.key === 'string') {
      const previous = keys.get(manifest.app.key);
      if (previous) issues.push(`${label}: app.key ${manifest.app.key} duplicates ${previous}`);
      else keys.set(manifest.app.key, label);
    }
  }
  return [...new Set(issues)];
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: '.' },
      config: { type: 'string', default: 'sdkwork.app.config.json' },
      workspace: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  const root = path.resolve(values.workspace ?? values.root);
  const files = values.workspace
    ? findAppManifests(root)
    : [path.resolve(root, values.config)];
  if (files.length === 0) throw new Error(`no sdkwork.app.config.json files found under ${root}`);
  for (const file of files) if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const issues = validateAppManifestFiles(files, root);
  if (values.json) console.log(JSON.stringify({ valid: issues.length === 0, manifests: files.length, issues }, null, 2));
  if (issues.length > 0) {
    if (!values.json) for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }
  if (!values.json) console.log(`app manifest standard ok: ${files.length} manifest(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`app manifest check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
