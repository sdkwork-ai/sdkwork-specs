#!/usr/bin/env node
/**
 * SDKWork app publish orchestrator.
 *
 * Discovers application surfaces across the workspace (apps/<app>/), filters
 * by repo / app / architecture / platform, runs build + artifact-collection +
 * upload for each platform, and emits a JSON report as release evidence
 * (RELEASE_SPEC.md §2 application release type, §4 release evidence).
 *
 * Mirrors tools/publish-sdk.mjs structure. Apps are private application
 * surfaces (never npm packages): "publish" means build platform-specific
 * distributable artifacts and upload them to a release destination.
 *
 * Authority:
 *  - APPLICATION_SPEC.md, APP_*_ARCHITECTURE_SPEC.md
 *  - RELEASE_SPEC.md §2 (application release type) §4 (release evidence)
 *  - GITHUB_WORKFLOW_SPEC.md (when wired into CI)
 *
 * Usage:
 *   pnpm release:app:publish -- --dry-run
 *   pnpm release:app:publish -- --repo sdkwork-im --architecture pc
 *   pnpm release:app:publish -- --app sdkwork-im-pc --platform web --registry local --out-dir ./releases
 *   pnpm release:app:publish -- --architecture h5 --registry github
 *
 * Credentials are read from the environment, never from manifest or config:
 *   GITHUB_TOKEN            GitHub Release upload (gh CLI or token)
 */
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  discoverPublishableApps,
  filterPublishable,
  describePublishable,
  SUPPORTED_ARCHITECTURES,
} from './lib/app-publish/discover-publishable-apps.mjs';
import { getPackager } from './lib/app-publish/packager-registry.mjs';
import { getUploader, SUPPORTED_REGISTRIES, distPackageName } from './lib/app-publish/uploaders.mjs';
import { checkRemoteVersion } from './lib/app-publish/version-check.mjs';
import { ReportBuilder } from './lib/app-publish/report.mjs';
import { detectGithubRepoSlug, isPreRelease, releaseTag, toDisplayPath } from './lib/app-publish/util.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseCli() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string', default: path.resolve(SPECS_ROOT, '..') },
      repo: { type: 'string' },
      app: { type: 'string' },
      architecture: { type: 'string', default: 'all' },
      platform: { type: 'string' },
      registry: { type: 'string', default: 'github' },
      'out-dir': { type: 'string' },
      'repo-slug': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      channel: { type: 'string', default: 'stable' },
      access: { type: 'string', default: 'public' },
      tag: { type: 'string', default: 'latest' },
      'skip-build': { type: 'boolean', default: false },
      'allow-pre-release': { type: 'boolean', default: false },
      report: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowNegative: true,
  });
  return values;
}

function printHelp() {
  console.log(`sdkwork publish-app — multi-architecture app publish orchestrator

Usage:
  node tools/publish-app.mjs [options]
  pnpm release:app:publish -- [options]

Options:
  --workspace <path>            workspace root (default: parent of sdkwork-specs)
  --repo <name>                 limit to one repository (e.g. sdkwork-im)
  --app <key|name>              limit to one app (e.g. sdkwork-im-pc)
  --architecture <arch|all>     one of: ${SUPPORTED_ARCHITECTURES.join(', ')}, or all (default)
  --platform <target>           narrow artifact matrix (web, windows, macos, linux, android, ios, weixin, desktop)
  --registry <github|local|npm>  release destination (default: github)
  --out-dir <path>              local staging dir (required for --registry local)
  --repo-slug <owner/repo>      override github repo slug (default: detect from origin remote)
  --dry-run                     discover + version-check, skip build + upload
  --channel <stable|beta|rc>    release channel (default: stable)
  --access <public|restricted>  npm scoped package access (default: public)
  --tag <npm-dist-tag>          npm dist-tag (default: latest)
  --skip-build                  skip per-platform build step
  --allow-pre-release           allow publishing 0.x / -rc / -beta versions
  --report <path>               write JSON report to this path
  --help                        show usage

Credentials (env):
  GITHUB_TOKEN                  GitHub Release upload (or an authenticated gh CLI)
  NPM_TOKEN                     npm registry upload (--registry npm)

npm registry:
  Publishes each built artifact as an independent dist package named
  '@sdkwork/<app-base>-dist-<platform>' (e.g. @sdkwork/im-pc-dist-web).
  The private app source package is never published.

Examples:
  pnpm release:app:publish -- --dry-run
  pnpm release:app:publish -- --architecture pc --platform web --registry local --out-dir ./releases
  pnpm release:app:publish -- --app sdkwork-im-pc --platform web --registry github
  pnpm release:app:publish -- --repo sdkwork-im --architecture all
  pnpm release:app:publish -- --architecture pc --platform web --registry npm --tag latest
  pnpm release:app:publish -- --architecture h5 --platform web --registry npm
`);
}

async function main() {
  const opts = parseCli();
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.architecture !== 'all' && !SUPPORTED_ARCHITECTURES.includes(opts.architecture)) {
    console.error(`unknown architecture: ${opts.architecture}`);
    console.error(`supported: ${SUPPORTED_ARCHITECTURES.join(', ')}`);
    process.exit(2);
  }
  if (!SUPPORTED_REGISTRIES.includes(opts.registry)) {
    console.error(`unknown registry: ${opts.registry}`);
    console.error(`supported: ${SUPPORTED_REGISTRIES.join(', ')}`);
    process.exit(2);
  }

  const workspace = path.resolve(opts.workspace);
  const mode = opts['dry-run'] ? 'dry-run' : 'publish';
  const startedAt = new Date().toISOString();
  const report = new ReportBuilder({ mode, workspace, startedAt });
  const uploader = getUploader(opts.registry);

  console.log(`sdkwork publish-app (${mode})`);
  console.log(`  workspace: ${toDisplayPath(workspace)}`);
  console.log(`  filters:   repo=${opts.repo ?? '*'} app=${opts.app ?? '*'} architecture=${opts.architecture} platform=${opts.platform ?? '*'} registry=${opts.registry}`);

  const all = discoverPublishableApps(workspace);
  const targets = filterPublishable(all, {
    repo: opts.repo,
    app: opts.app,
    architecture: opts.architecture,
  });

  console.log(`  discovered: ${all.length} app(s), ${targets.length} after filters`);
  if (targets.length === 0) {
    console.log('nothing to publish');
    report.printConsole();
    if (opts.report) report.write(path.resolve(opts.report));
    process.exit(0);
  }

  for (const item of targets) {
    await processApp(item, opts, report, uploader);
  }

  report.printConsole();
  if (opts.report) {
    const reportPath = path.resolve(opts.report);
    report.write(reportPath);
    console.log(`\nreport written: ${toDisplayPath(reportPath)}`);
  }

  const s = report.summary();
  process.exit(s.failed > 0 ? 1 : 0);
}

async function processApp(item, opts, report, uploader) {
  const packager = getPackager(item.architecture);
  if (!packager) {
    report.add(makeItem(item, '', '', '', 'failed', 'no packager registered', 0));
    return;
  }

  console.log('');
  console.log(`• ${describePublishable(item)}`);

  const detected = packager.detect(item.appRoot, item.appConfig, { platformFilter: opts.platform });
  if (!detected) {
    report.add(makeItem(item, '', '', '', 'skipped', 'no publishable target for platform filter', 0));
    console.log(`  skipped: no publishable target for platform=${opts.platform ?? '*'}`);
    return;
  }

  const { appKey, version, platforms } = detected;
  console.log(`  app:      ${appKey}@${version}`);
  console.log(`  platforms: ${platforms.join(', ')}`);

  if (!opts['allow-pre-release'] && isPreRelease(version)) {
    report.add(makeItem(item, appKey, version, platforms.join('+'), 'skipped', 'pre-release version (use --allow-pre-release)', 0));
    console.log(`  skipped: pre-release version`);
    return;
  }

  // Per-app context shared across platforms.
  const repoSlug = opts['repo-slug'] || detectGithubRepoSlug(item.repoRoot) || '';
  const notes = `Release ${appKey} ${version} (architecture: ${item.architecture})`;

  for (const platform of platforms) {
    await processPlatform(item, { appKey, appName: item.appName, version, platform, repoSlug, notes, appConfig: item.appConfig }, opts, report, uploader, packager);
  }
}

async function processPlatform(item, ctx, opts, report, uploader, packager) {
  const { appKey, appName, version, platform, repoSlug, notes, appConfig } = ctx;

  // For npm registry, derive the dist package name so the version probe can
  // check whether this (name, version) pair is already published.
  const npmName = opts.registry === 'npm' ? distPackageName(appName || appKey, platform) : undefined;

  // Remote version probe.
  const probe = await checkRemoteVersion(opts.registry, {
    appKey,
    version,
    repoSlug,
    outDir: opts['out-dir'] ? path.resolve(opts['out-dir']) : undefined,
    artifactUrl: artifactUrlFor(appConfig, platform),
    npmName,
  });
  if (probe.exists === true) {
    report.add(makeItem(item, appKey, version, platform, 'skipped', `already published (${opts.registry})`, 0));
    console.log(`  ${platform}: skipped, ${version} already published on ${opts.registry}`);
    return;
  }
  if (probe.exists === null) {
    console.log(`  ${platform}: warn, version probe inconclusive (${probe.detail ?? 'unknown'})`);
  }

  // Dry-run stops here.
  if (opts['dry-run']) {
    const detail = opts.registry === 'npm' && npmName
      ? `npm publish (dry-run): ${npmName}@${version}`
      : `${opts.registry} publish (dry-run)`;
    report.add(makeItem(item, appKey, version, platform, 'dry-run', detail, 0));
    console.log(`  ${platform}: dry-run, would publish to ${opts.registry}${opts.registry === 'npm' && npmName ? ` as ${npmName}@${version}` : ''}`);
    return;
  }

  if (!opts['dry-run'] && !uploader.hasCredentials(process.env)) {
    report.add(makeItem(item, appKey, version, platform, 'skipped', `missing credential: ${uploader.credentialName()}`, 0));
    console.log(`  ${platform}: skipped, missing credential (${uploader.credentialName()})`);
    return;
  }

  // Build.
  const buildStart = Date.now();
  const buildResult = packager.build(item.appRoot, {
    skipBuild: opts['skip-build'],
    platform,
    env: {},
  });
  const buildMs = Date.now() - buildStart;
  if (!buildResult.ok) {
    report.add(makeItem(item, appKey, version, platform, 'failed', buildResult.detail, buildMs));
    console.log(`  ${platform}: build failed — ${buildResult.detail}`);
    return;
  }
  console.log(`  ${platform}: build ok (${buildResult.detail}, ${buildMs}ms)`);

  // Collect artifacts.
  const artifacts = packager.collectArtifacts(item.appRoot, { appKey, version, platform, appConfig });
  if (artifacts.length === 0) {
    report.add(makeItem(item, appKey, version, platform, 'failed', 'no artifacts produced by build', buildMs));
    console.log(`  ${platform}: failed, no artifacts produced`);
    return;
  }

  // Upload.
  const pubStart = Date.now();
  const pubResult = uploader.upload(artifacts, {
    appKey,
    appName,
    version,
    repoSlug,
    channel: opts.channel,
    notes,
    outDir: opts['out-dir'] ? path.resolve(opts['out-dir']) : undefined,
    access: opts.access,
    tag: opts.tag,
    env: {},
  });
  const pubMs = Date.now() - pubStart;
  if (!pubResult.ok) {
    report.add(makeItem(item, appKey, version, platform, 'failed', pubResult.detail, buildMs + pubMs, artifacts[0].name));
    console.log(`  ${platform}: upload failed — ${pubResult.detail}`);
    return;
  }
  report.add(makeItem(item, appKey, version, platform, 'success', pubResult.detail, buildMs + pubMs, opts.registry, artifacts[0].name));
  console.log(`  ${platform}: ok — ${pubResult.detail} (${pubMs}ms)`);
}

function artifactUrlFor(appConfig, platform) {
  const pkgs = appConfig?.artifacts?.installConfig?.packages ?? [];
  const match = pkgs.find((p) => String(p.platform || '').toLowerCase().includes(platform.toLowerCase()));
  return match?.url || '';
}

function makeItem(item, appKey, version, platform, status, reason, durationMs, registry, artifactName) {
  return {
    repo: item.repoName,
    app: appKey || item.appKey,
    architecture: item.architecture,
    platform,
    artifactName: artifactName || '',
    version,
    status,
    registry,
    durationMs,
    reason,
    appRoot: toDisplayPath(item.appRoot),
  };
}

main().catch((err) => {
  console.error('publish-app fatal:', err);
  process.exit(1);
});
