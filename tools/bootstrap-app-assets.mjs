#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  APP_ASSETS_STANDARD,
  APP_TYPE_MEDIA,
  APP_TYPES,
  CAPTURE_CONFIG_KIND,
  captureSurfacesForType,
  isObject,
} from './app-assets-lib.mjs';

const DEFAULT_PLATFORMS = {
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
  APP_UNITY: ['DESKTOP_WINDOWS'],
  APP_HARMONY: ['APP_HARMONY'],
};

function readManifest(root) {
  const file = path.join(root, 'agent.app.config.json');
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeGeneratedFile(file, content, force) {
  if (fs.existsSync(file) && !force) return 'skipped';
  const existed = fs.existsSync(file);
  ensureDirectory(path.dirname(file));
  fs.writeFileSync(file, content, 'utf8');
  return existed ? 'rewritten' : 'created';
}

function touchPlaceholder(directory, force) {
  const file = path.join(directory, '.gitkeep');
  if (fs.existsSync(file) && !force) return 'skipped';
  ensureDirectory(directory);
  fs.writeFileSync(file, '', 'utf8');
  return 'created';
}

function readmeContent({ appKey, appType, platforms, typeInfo, surfaces }) {
  const roles = ['`ICON` 1024 x 1024 PNG, no alpha channel', '`COVER` 1920 x 1080, one per locale'];
  if (typeInfo.screenshots) roles.push('`SCREENSHOT` for every shipped UI surface');
  if (typeInfo.slidePreviews) roles.push(`${typeInfo.slidePreviews} \`PREVIEW_IMAGE\` entries with \`purpose = SLIDE_PREVIEW\``);
  if (typeInfo.poster) roles.push('`POSTER` at the content aspect ratio');
  if (typeInfo.previewVideo) roles.push('`PREVIEW_VIDEO` with a poster reference');
  const surfaceRows = surfaces.length > 0
    ? surfaces.map((surface) => `- ${surface.id}: ${surface.platform} / ${surface.displayType} / ${surface.locales.join(', ')}`).join('\n')
    : '- none (this type has no screenshots)';

  return `# ${appKey} app assets

Owner: ${appKey} maintainers
Standard: \`${APP_ASSETS_STANDARD}\` (\`sdkwork-specs/APP_ASSETS_SPEC.md\`)
Catalog: \`agent.app.config.json#media\`

App type: \`${appType}\`
Delivery surfaces: ${platforms.length > 0 ? platforms.join(', ') : 'none declared'}

## Required media

${roles.map((role) => `- ${role}`).join('\n')}

## Capture surfaces

${surfaceRows}

The machine contract is \`assets/capture/capture.config.json\`. The capture command
must be deterministic, must fail closed when a declared surface cannot be
captured, and must write raw output to \`.sdkwork/tmp/assets-capture\` (or another
ignored directory). Curated files are committed under \`assets/media/\`.

## Layout

- \`resources/\` — runtime or content resources owned by the application or content
- \`media/\` — catalog and store media; never imported by application source
- \`media/store/\` — store-specific derivatives
- \`capture/\` — capture configuration and evidence metadata
- \`source/\` — optional editable design masters

## Rights and privacy

Record the license or rights basis for every photograph, illustration, font, and
footage used here. Screenshots and covers must not contain personal data, live
credentials, internal URLs, or customer content. Strip EXIF/GPS metadata before
committing.

## Update procedure

1. Update the source master (design tool or authored content).
2. Run the capture command for changed surfaces.
3. Replace the curated file under \`assets/media/\` and update the manifest entry
   (\`path\`, dimensions, format, file size, alpha, capture metadata).
4. Run \`node ../sdkwork-specs/tools/check-app-assets-standard.mjs --root .\`.
5. Upload through Drive on release; keep \`path\` as provenance.
`;
}

function captureReadmeContent() {
  return `# Capture configuration

\`capture.config.json\` is the machine contract for screenshot and content media
capture. It follows \`schemas/sdkwork.app-assets.capture.schema.v1.json\` and
\`APP_ASSETS_SPEC.md\` section 6.

Rules:

- Every shipped UI surface has one surface entry.
- The capture command is non-interactive and fails when a surface cannot be captured.
- Raw output stays out of \`assets/media/\`.
- Captures record tool, version, application version, commit, locale, and display type.
`;
}

export function bootstrapAppAssets({
  root, appType, appKey, platforms, force = false,
}) {
  const appRoot = path.resolve(root);
  if (!fs.existsSync(appRoot) || !fs.statSync(appRoot).isDirectory()) {
    throw new Error(`application root does not exist: ${appRoot}`);
  }
  const manifest = readManifest(appRoot);
  const resolvedType = appType ?? manifest?.app?.appType ?? 'APP_REACT';
  if (!APP_TYPES.includes(resolvedType)) {
    throw new Error(`--app-type must be one of ${APP_TYPES.join(', ')}`);
  }
  const resolvedKey = appKey ?? manifest?.app?.key ?? path.basename(appRoot);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(resolvedKey)) {
    throw new Error(`app key must be lower kebab-case: ${resolvedKey}`);
  }
  const declaredPlatforms = Array.isArray(platforms) && platforms.length > 0
    ? platforms
    : Array.isArray(manifest?.publish?.platforms) && manifest.publish.platforms.length > 0
      ? manifest.publish.platforms
      : DEFAULT_PLATFORMS[resolvedType] ?? [];
  const typeInfo = APP_TYPE_MEDIA[resolvedType];
  const assetsRoot = path.join(appRoot, 'assets');
  const report = { appRoot, appType: resolvedType, appKey: resolvedKey, platforms: declaredPlatforms, files: [] };

  const record = (file, status) => report.files.push({ path: path.relative(appRoot, file).replaceAll('\\', '/'), status });

  ensureDirectory(assetsRoot);
  ensureDirectory(path.join(assetsRoot, 'media'));
  ensureDirectory(path.join(assetsRoot, 'media', 'icons'));
  ensureDirectory(path.join(assetsRoot, 'media', 'covers'));
  ensureDirectory(path.join(assetsRoot, 'media', 'screenshots'));
  ensureDirectory(path.join(assetsRoot, 'media', 'previews'));
  ensureDirectory(path.join(assetsRoot, 'media', 'previews', 'video'));
  ensureDirectory(path.join(assetsRoot, 'media', 'store'));
  ensureDirectory(path.join(assetsRoot, 'source'));
  ensureDirectory(path.join(assetsRoot, 'resources'));

  const locale = manifest?.media?.metadata?.defaultLocale ?? 'en-US';
  const { tool, surfaces } = captureSurfacesForType(resolvedType, declaredPlatforms);
  const captureConfig = {
    $schema: 'https://sdkwork.com/schemas/sdkwork.app-assets.capture.schema.v1.json',
    schemaVersion: 1,
    kind: CAPTURE_CONFIG_KIND,
    appKey: resolvedKey,
    appVersion: manifest?.release?.currentVersion ?? '0.1.0',
    surfaces: surfaces.map((surface) => ({ ...surface, locales: [locale] })),
    capture: {
      tool: tool ?? 'render-pipeline',
      command: 'node tools/capture-app-assets.mjs',
      outputRoot: '.sdkwork/tmp/assets-capture',
      locales: [locale],
      freezeAnimations: true,
      maskSelectors: [],
      seed: 'app-assets-demo',
    },
  };

  record(path.join(assetsRoot, 'README.md'), writeGeneratedFile(
    path.join(assetsRoot, 'README.md'),
    readmeContent({ appKey: resolvedKey, appType: resolvedType, platforms: declaredPlatforms, typeInfo, surfaces }),
    force,
  ));
  record(path.join(assetsRoot, '.gitignore'), writeGeneratedFile(
    path.join(assetsRoot, '.gitignore'),
    'capture/raw/\n*.tmp\n.DS_Store\nThumbs.db\n',
    force,
  ));

  report.files.push({
    path: 'assets/resources/README.md',
    status: writeGeneratedFile(
      path.join(assetsRoot, 'resources', 'README.md'),
      `# Resources\n\nRuntime and content resources for ${resolvedKey}. These files may be bundled by the application;\ncatalog media under \`assets/media/\` must not be bundled.\n`,
      force,
    ),
  });
  for (const resource of typeInfo.resources) {
    ensureDirectory(path.join(assetsRoot, 'resources', resource));
    record(path.join(assetsRoot, 'resources', resource, '.gitkeep'), touchPlaceholder(path.join(assetsRoot, 'resources', resource), force));
  }

  record(path.join(assetsRoot, 'source', 'README.md'), writeGeneratedFile(
    path.join(assetsRoot, 'source', 'README.md'),
    '# Design sources\n\nOptional editable masters (deck sources, layered files, Figma exports). Large binaries may use Git LFS.\n',
    force,
  ));

  record(path.join(assetsRoot, 'media', 'covers', locale, '.gitkeep'), touchPlaceholder(path.join(assetsRoot, 'media', 'covers', locale), force));
  for (const directory of [
    path.join(assetsRoot, 'media'),
    path.join(assetsRoot, 'media', 'icons'),
    path.join(assetsRoot, 'media', 'screenshots'),
    path.join(assetsRoot, 'media', 'previews'),
    path.join(assetsRoot, 'media', 'store'),
  ]) {
    record(path.join(directory, '.gitkeep'), touchPlaceholder(directory, force));
  }
  for (const surface of surfaces.filter((entry) => entry.kind !== 'content')) {
    const display = surface.displayType.toLowerCase().replaceAll('_', '-');
    const platform = String(surface.platform).toLowerCase().replaceAll('_', '-');
    const directory = path.join(assetsRoot, 'media', 'screenshots', platform, display, locale);
    ensureDirectory(directory);
    record(path.join(directory, '.gitkeep'), touchPlaceholder(directory, force));
  }
  record(path.join(assetsRoot, 'media', 'previews', 'video', locale, '.gitkeep'), touchPlaceholder(path.join(assetsRoot, 'media', 'previews', 'video', locale), force));

  if (typeInfo.capture) {
    ensureDirectory(path.join(assetsRoot, 'capture'));
    record(path.join(assetsRoot, 'capture', 'capture.config.json'), writeGeneratedFile(
      path.join(assetsRoot, 'capture', 'capture.config.json'),
      `${JSON.stringify(captureConfig, null, 2)}\n`,
      force,
    ));
    record(path.join(assetsRoot, 'capture', 'README.md'), writeGeneratedFile(
      path.join(assetsRoot, 'capture', 'README.md'),
      captureReadmeContent(),
      force,
    ));
  }

  report.manifestPatch = {
    media: {
      metadata: {
        standard: APP_ASSETS_STANDARD,
        defaultLocale: locale,
      },
    },
  };
  return report;
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: '.' },
      'app-type': { type: 'string' },
      'app-key': { type: 'string' },
      platforms: { type: 'string' },
      force: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });
  const platforms = values.platforms
    ? values.platforms.split(',').map((entry) => entry.trim()).filter(Boolean)
    : undefined;
  const report = bootstrapAppAssets({
    root: values.root,
    appType: values['app-type'],
    appKey: values['app-key'],
    platforms,
    force: values.force,
  });
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const created = report.files.filter((entry) => entry.status !== 'skipped').length;
  console.log(`app assets scaffolded: ${created} file(s) created or rewritten under ${path.relative(process.cwd(), report.appRoot) || '.'}`);
  console.log(`app type ${report.appType}; add media.metadata.standard = "${APP_ASSETS_STANDARD}" to agent.app.config.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`app assets bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  }
}
