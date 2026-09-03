#!/usr/bin/env node
/**
 * SDKWork SDK publish orchestrator.
 *
 * Discovers SDK families across the workspace, filters by repo / family /
 * language, runs build + version-check + publish for each, and emits a JSON
 * report as release evidence (RELEASE_SPEC.md §4).
 *
 * Authority:
 *  - SDK_SPEC.md §1 (owner-first, generated-only)
 *  - SDK_MANIFEST_SPEC.md §3 (family-root manifest SSOT)
 *  - SDK_PACKAGE_NAMING_SPEC.md §1.1 (consumer-only publish; transport forbidden)
 *  - RELEASE_SPEC.md §2 (SDK release type) §4 (release evidence)
 *
 * Usage:
 *   pnpm release:sdk:publish -- --dry-run
 *   pnpm release:sdk:publish -- --repo sdkwork-iam --language typescript
 *   pnpm release:sdk:publish -- --family sdkwork-im-app-sdk --language all
 *   node bin/publish-all-sdks.mjs --repo sdkwork-iam --dry-run
 *
 * Credentials are read from the environment, never from manifest or config:
 *   NPM_TOKEN, CARGO_REGISTRY_TOKEN, MAVEN_USERNAME, MAVEN_PASSWORD,
 *   MAVEN_GPG_PASSPHRASE, PUB_DEV_TOKEN, PYPI_TOKEN, GITHUB_TOKEN
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  discoverPublishableSdks,
  filterPublishable,
  describePublishable,
  SUPPORTED_LANGUAGES,
} from './lib/sdk-publish/discover-publishable-sdks.mjs';
import { getPublisher } from './lib/sdk-publish/publisher-registry.mjs';
import { checkRemoteVersion } from './lib/sdk-publish/version-check.mjs';
import { ReportBuilder } from './lib/sdk-publish/report.mjs';
import { isPreRelease, toDisplayPath } from './lib/sdk-publish/util.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WORKSPACE = path.resolve(SPECS_ROOT, '..');

/**
 * @param {string[]} argv
 */
function parseCli(argv) {
  /** @type {{
   *   workspace: string,
   *   repos: string[],
   *   filter: string | null,
   *   family: string | null,
   *   language: string,
   *   dryRun: boolean,
   *   list: boolean,
   *   tag: string,
   *   access: string,
   *   skipBuild: boolean,
   *   allowPreRelease: boolean,
   *   skipStandardCheck: boolean,
   *   bump: string | null,
   *   report: string | null,
   *   help: boolean,
   * }} */
  const options = {
    workspace: DEFAULT_WORKSPACE,
    repos: [],
    filter: null,
    family: null,
    language: 'all',
    dryRun: false,
    list: false,
    tag: 'latest',
    access: 'public',
    skipBuild: false,
    allowPreRelease: false,
    skipStandardCheck: false,
    bump: null,
    report: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '-n') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--list') {
      options.list = true;
      continue;
    }
    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }
    if (arg === '--allow-pre-release') {
      options.allowPreRelease = true;
      continue;
    }
    if (arg === '--skip-standard-check') {
      options.skipStandardCheck = true;
      continue;
    }
    if (arg === '--workspace') {
      options.workspace = path.resolve(argv[index + 1] ?? DEFAULT_WORKSPACE);
      index += 1;
      continue;
    }
    if (arg === '--repo') {
      const value = argv[index + 1] ?? '';
      options.repos.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg === '--filter') {
      options.filter = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--family') {
      options.family = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--language') {
      options.language = argv[index + 1] ?? 'all';
      index += 1;
      continue;
    }
    if (arg === '--tag') {
      options.tag = argv[index + 1] ?? 'latest';
      index += 1;
      continue;
    }
    if (arg === '--access') {
      options.access = argv[index + 1] ?? 'public';
      index += 1;
      continue;
    }
    if (arg === '--bump') {
      options.bump = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--report') {
      options.report = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      console.error(`unknown option: ${arg}`);
      printHelp();
      process.exit(2);
    }
    options.repos.push(arg);
  }

  return options;
}

function printHelp() {
  console.log(`sdkwork publish-sdk — multi-language SDK publish orchestrator

Usage:
  node tools/publish-sdk.mjs [options] [repo...]
  node bin/publish-all-sdks.mjs [options] [repo...]
  pnpm release:sdk:publish -- [options]

Options:
  --workspace <path>            workspace root (default: parent of sdkwork-specs)
  --repo <name[,name...]>       limit to one or more repositories
  --filter <prefix>             limit to repositories whose name starts with <prefix>
  --family <stem>               limit to one SDK family (e.g. sdkwork-iam-app-sdk)
  --language <lang|all>         one of: ${SUPPORTED_LANGUAGES.join(', ')}, or all (default)
  --list                        list discovered packages without publishing
  --dry-run, -n                 discover + version-check, skip publish
  --tag <npm-dist-tag>          npm dist-tag (default: latest)
  --access <public|restricted>  npm scoped package access (default: public)
  --skip-build                  skip per-package build step
  --allow-pre-release           allow publishing 0.x / -rc / -beta versions
  --skip-standard-check         skip pre-publish check-sdk-standard gate
  --bump <patch|minor|major>    bump version before publishing (writes package.json)
  --report <path>               write JSON report to this path
  --help, -h                    show usage

Credentials (env):
  NPM_TOKEN                     TypeScript (npmjs.com)
  CARGO_REGISTRY_TOKEN          Rust (crates.io)
  MAVEN_USERNAME                Java (Maven Central)
  MAVEN_PASSWORD                Java (Maven Central)
  MAVEN_GPG_PASSPHRASE          Java (Maven Central signing)
  PUB_DEV_TOKEN                 Flutter/Dart (pub.dev)
  PYPI_TOKEN                    Python (PyPI)
  GITHUB_TOKEN                  Go (GitHub Release, optional)

Examples:
  pnpm release:sdk:publish -- --dry-run
  pnpm release:sdk:publish -- --repo sdkwork-iam --language typescript
  node bin/publish-all-sdks.mjs --repo sdkwork-order,sdkwork-membership --dry-run
  node bin/publish-all-sdks.mjs --filter sdkwork-knowledge --list
  pnpm release:sdk:publish -- --family sdkwork-im-app-sdk --language all --report ./publish-report.json
`);
}

/**
 * @param {string} workspace
 * @returns {boolean}
 */
function runStandardCheck(workspace) {
  console.log('Running check-sdk-standard...');
  const script = path.join(SPECS_ROOT, 'tools', 'check-sdk-standard.mjs');
  const result = spawnSync(process.execPath, [script, '--workspace', workspace], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(`check-sdk-standard failed to start: ${result.error.message}`);
    return false;
  }
  return result.status === 0;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseCli(argv);
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.language !== 'all' && !SUPPORTED_LANGUAGES.includes(opts.language)) {
    console.error(`unknown language: ${opts.language}`);
    console.error(`supported: ${SUPPORTED_LANGUAGES.join(', ')}`);
    process.exit(2);
  }

  if (opts.bump && !['patch', 'minor', 'major'].includes(opts.bump)) {
    console.error(`invalid --bump value: ${opts.bump} (must be patch|minor|major)`);
    process.exit(2);
  }

  const workspace = path.resolve(opts.workspace);
  const mode = opts.list ? 'list' : (opts.dryRun ? 'dry-run' : 'publish');
  const startedAt = new Date().toISOString();
  const report = new ReportBuilder({ mode, workspace, startedAt });
  const hasExplicitRepoSelection = opts.repos.length > 0 || opts.filter !== null;
  const hasExplicitSelection = hasExplicitRepoSelection || Boolean(opts.family);

  console.log(`sdkwork publish-sdk (${mode})`);
  console.log(`  workspace: ${toDisplayPath(workspace)}`);
  const repoLabel = opts.repos.length > 0 ? opts.repos.join(',') : (opts.filter ?? '*');
  console.log(`  filters:   repo=${repoLabel} family=${opts.family ?? '*'} language=${opts.language}`);

  const all = discoverPublishableSdks(workspace);
  const targets = filterPublishable(all, {
    repos: opts.repos,
    filter: opts.filter,
    family: opts.family ?? undefined,
    language: opts.language,
  });

  console.log(`  discovered: ${all.length} package(s), ${targets.length} after filters`);

  if (hasExplicitRepoSelection && targets.length === 0) {
    const repoMatches = filterPublishable(all, { repos: opts.repos, filter: opts.filter });
    if (repoMatches.length === 0) {
      console.error('No repositories matched the requested selection.');
      process.exit(1);
    }
    console.error('Matched repositories declare no publishable SDK packages for the current filters.');
    process.exit(1);
  }

  if (opts.family && targets.length === 0) {
    console.error(`No publishable packages matched family ${opts.family}.`);
    process.exit(1);
  }

  if (opts.list) {
    if (targets.length === 0) {
      console.log('No publishable SDK packages discovered for the selected filters.');
      process.exit(0);
    }
    for (const item of targets) {
      console.log(describePublishable(item));
    }
    console.log(`\n${targets.length} package(s)`);
    process.exit(0);
  }

  if (targets.length === 0) {
    console.log('nothing to publish');
    report.printConsole();
    if (opts.report) report.write(path.resolve(opts.report));
    process.exit(0);
  }

  if (!opts.skipStandardCheck) {
    if (!runStandardCheck(workspace)) {
      console.error('Aborting publish: check-sdk-standard failed.');
      process.exit(1);
    }
  }

  for (const item of targets) {
    console.log('');
    console.log(`• ${describePublishable(item)}`);
    await processOne(item, opts, report);
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

async function processOne(item, opts, report) {
  const publisher = getPublisher(item.language);
  if (!publisher) {
    report.add(makeItem(item, '', '', 'failed', 'no publisher registered', 0));
    return;
  }

  const detected = publisher.detect(item.familyRoot, item.manifest);
  if (!detected) {
    report.add(makeItem(item, '', '', 'skipped', 'no publishable package detected', 0));
    console.log('  skipped: no publishable package detected');
    return;
  }

  const { packageName, version: detectedVersion, packagePath } = detected;
  console.log(`  package: ${packageName}@${detectedVersion}`);

  let version = detectedVersion;
  if (opts.bump) {
    if (typeof publisher.bumpPackageVersion !== 'function') {
      report.add(makeItem(item, packageName, version, 'failed', `publisher does not support --bump (${item.language})`, 0));
      console.log(`  failed: --bump not supported for ${item.language}`);
      return;
    }
    const bumpResult = publisher.bumpPackageVersion(packagePath, opts.bump);
    if (!bumpResult.ok) {
      report.add(makeItem(item, packageName, version, 'failed', bumpResult.detail, 0));
      console.log(`  failed: bump failed: ${bumpResult.detail}`);
      return;
    }
    version = bumpResult.version;
    console.log(`  bumped:  ${detectedVersion} → ${version}`);
  }

  if (!opts.allowPreRelease && isPreRelease(version)) {
    report.add(makeItem(item, packageName, version, 'skipped', 'pre-release version (use --allow-pre-release)', 0));
    console.log('  skipped: pre-release version');
    return;
  }

  if (!publisher.hasCredentials(process.env) && !opts.dryRun) {
    report.add(makeItem(item, packageName, version, 'skipped', `missing credential: ${publisher.credentialName()}`, 0));
    console.log(`  skipped: missing credential (${publisher.credentialName()})`);
    return;
  }

  const probe = await checkRemoteVersion(item.language, packageName, version, {
    repoUrl: detected.repoUrl,
  });
  if (probe.exists === true) {
    report.add(makeItem(item, packageName, version, 'skipped', `already published on ${publisher.registry}`, 0));
    console.log(`  skipped: ${version} already published on ${publisher.registry}`);
    return;
  }
  if (probe.exists === null) {
    console.log(`  warn: version probe inconclusive (${probe.detail ?? 'unknown'})`);
  }

  if (opts.dryRun) {
    report.add(makeItem(item, packageName, version, 'dry-run', `${publisher.registry} publish (dry-run)`, 0));
    console.log(`  dry-run: would publish to ${publisher.registry}`);
    return;
  }

  const buildStart = Date.now();
  const buildResult = publisher.build(packagePath, { skipBuild: opts.skipBuild });
  const buildMs = Date.now() - buildStart;
  if (!buildResult.ok) {
    report.add(makeItem(item, packageName, version, 'failed', buildResult.detail, buildMs));
    console.log(`  failed: ${buildResult.detail}`);
    return;
  }
  console.log(`  build:   ${buildResult.detail} (${buildMs}ms)`);

  const pubStart = Date.now();
  const pubResult = publisher.publish(packagePath, {
    tag: opts.tag,
    access: opts.access,
    version,
    env: process.env,
  });
  const pubMs = Date.now() - pubStart;
  if (!pubResult.ok) {
    report.add(makeItem(item, packageName, version, 'failed', pubResult.detail, pubMs));
    console.log(`  failed: ${pubResult.detail}`);
    return;
  }
  report.add(makeItem(item, packageName, version, 'success', pubResult.detail, pubMs, publisher.registry));
  console.log(`  ok:      ${pubResult.detail} (${pubMs}ms)`);
}

function makeItem(item, packageName, version, status, reason, durationMs, registry) {
  return {
    repo: item.repoName,
    family: item.sdkFamily,
    language: item.language,
    packageName,
    version,
    status,
    registry,
    durationMs,
    reason,
    languageRoot: toDisplayPath(item.languageRoot),
  };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  main().catch((err) => {
    console.error('publish-sdk fatal:', err);
    process.exit(1);
  });
}
