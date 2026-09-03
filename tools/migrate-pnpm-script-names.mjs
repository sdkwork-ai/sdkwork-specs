#!/usr/bin/env node
// @sdkwork-script-standard-exempt retired-name-migration
// This tool's rename map must quote the retired script names verbatim (that
// inventory is the tool's input), so the runner-script name scan is waived.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE = path.resolve(TOOL_DIR, '../..');
const IGNORED_DIRECTORIES = new Set([
  '.dart_tool', '.git', '.mimocode', '.pnpm', '.pnpm-store', '.runtime', '.vite', 'artifacts',
  'bak', 'build', 'dist', 'external', 'generated', 'node_modules', 'target', 'third_party', 'vendor',
]);
const IGNORED_PATH_PARTS = new Set([
  '.sdkwork/manual-backups',
  'data/app',
  'docs/archive',
  'docs/release',
  'docs/review',
  'docs/superpowers',
  'src-tauri/gen',
]);
const TEXT_EXTENSIONS = new Set([
  '.cjs', '.js', '.json', '.md', '.mjs', '.toml', '.ts', '.tsx', '.yaml', '.yml',
]);

export const PNPM_SCRIPT_RENAMES = new Map([
  ['gateway:assembly:materialize', 'api:assembly:materialize'],
  ['gateway:assembly:validate', 'api:assembly:validate'],
  ['dev:browser:mobile', 'dev:browser:postgres:standalone:local'],
  ['dev:server:sqlite:cloud', 'dev:server:cloud'],
  ['dev:tauri-web', 'dev:browser'],
  ['dev:gateway', 'dev:server'],
  ['dev:h5', 'dev:browser'],
  ['dev:pc', 'dev:desktop'],
  ['dev:web', 'dev:browser'],
  ['dev:renderer', 'dev:browser:local'],
  ['run:debug-console', 'dev:test-runner:debug'],
  ['dev:bootstrap', 'install:bootstrap'],
  ['server:dev', 'dev:server'],
  ['server:build', 'build:server'],
  ['h5:dev', 'dev:browser'],
  ['h5:build', 'build:browser'],
  ['app:update-create', 'app-store:update-create'],
  ['preflight:deps', 'install:dependencies'],
  ['repair:deps', 'install:repair'],
  ['deps:check', 'check:dependencies'],
  ['audit:services:policy:review-gate', 'check:services:policy:review-gate'],
  ['audit:services:policy', 'check:services:policy'],
  ['audit:services:report', 'check:services:report'],
  ['audit:services', 'check:services'],
  ['generate:api-route-catalog', 'api:materialize:route-catalog'],
  ['verify:tauri:embedded-assets', 'verify:desktop:embedded-assets'],
  ['tauri:bundle:verified', 'verify:desktop:bundle'],
  ['tauri:bundle', 'build:desktop:bundle'],
  ['tauri:build:prod', 'release:package:desktop'],
  ['cdn:download', 'downloads:cdn'],
  ['zip:code', 'build:archive:code'],
  ['zip:report', 'build:archive:report'],
  ['zip:tgz', 'build:archive:tgz'],
  ['zip', 'build:archive'],
  ['fmt:rust:check', 'format:check'],
  ['fmt:rust', 'format'],
  ['route-manifest:export', 'api:materialize:route-manifest'],
  ['route-manifest:check', 'api:check:route-manifest'],
  ['plugin:validate', 'check:plugin'],
  ['specs:generate', 'build:component-specs'],
  ['scaffold', 'install:workspace'],
  ['materialize:openapi', 'api:materialize'],
  ['validate:contracts', 'api:check'],
  ['openapi:align', 'api:materialize:envelope'],
  ['openapi:export', 'api:materialize:openapi'],
  ['package:server:validate', 'release:validate:server'],
  ['package:server', 'release:package:server'],
  ['audit:appbase', 'check:appbase'],
  ['ci:prepare-deps', 'install:ci-dependencies'],
  ['generate:local-runtime-sdk', 'sdk:generate:local-runtime'],
  ['generate:sdk:typescript', 'sdk:generate:typescript'],
  ['generate:sdk', 'sdk:generate'],
  ['terminal:dev:cloud', 'dev:desktop:cloud'],
  ['terminal:dev:web', 'dev:browser'],
  ['terminal:dev', 'dev:desktop'],
  ['terminal:build:self-hosted', 'build:desktop:standalone'],
  ['terminal:build', 'build:desktop:cloud'],
  ['tauri:before-dev', 'install:desktop'],
  ['tauri:dev', 'dev:desktop'],
  ['tauri:build', 'build:desktop'],
  ['tauri:check', 'check:desktop'],
  ['acceptance:smart-slice-baidunetdisk', 'test:acceptance:smart-slice-baidunetdisk'],
  ['baseline:generic-real-media-slice', 'perf:baseline:generic-real-media-slice'],
  ['baseline:large-media-stt', 'perf:baseline:large-media-stt'],
  ['baseline:large-media', 'perf:baseline:large-media'],
  ['benchmark:smart-slice-performance', 'perf:benchmark:smart-slice-performance'],
  ['prepare:ffmpeg-sidecar', 'build:sidecar:ffmpeg'],
  ['prepare:release-sidecars', 'build:sidecar:release'],
  ['prepare:speech-gpu-runtime', 'build:sidecar:speech-gpu-runtime'],
  ['prepare:speech-sidecar', 'build:sidecar:speech'],
  ['align:model-capabilities', 'models:align:capabilities'],
  ['align:model-pricing', 'models:align:pricing'],
  ['sync:catalog', 'models:sync'],
  ['seed:video-profiles', 'models:seed:video-profiles'],
  ['evidence:stamp', 'models:evidence:stamp'],
  ['openapi:materialize', 'api:materialize:models'],
  ['dev:browser:postgres:unified-process:standalone:local', 'dev:browser:postgres:standalone:local'],
  ['dev:browser:postgres:split-services:standalone:local', 'dev:browser:postgres:standalone:local'],
  ['dev:browser:postgres:unified-process:standalone', 'dev:browser:postgres:standalone'],
  ['dev:browser:sqlite:unified-process:standalone', 'dev:browser:postgres:standalone'],
  ['dev:desktop:postgres:unified-process:standalone', 'dev:desktop:postgres:standalone'],
  ['dev:desktop:sqlite:unified-process:standalone', 'dev:desktop:sqlite:standalone'],
  ['dev:server:postgres:unified-process:standalone', 'dev:server:postgres:standalone'],
  ['dev:server:sqlite:unified-process:standalone', 'dev:server:postgres:standalone'],
  ['dev:browser:postgres:split-services:standalone', 'dev:browser:postgres:standalone'],
  ['dev:browser:postgres:cloud:debug', 'dev:browser:cloud:debug'],
  ['dev:server:postgres:split-services:cloud', 'dev:server:cloud'],
  ['dev:browser:postgres:split-services:cloud', 'dev:browser:cloud'],
  ['dev:browser:postgres:cloud', 'dev:browser:cloud'],
  ['dev:server:postgres:cloud', 'dev:server:cloud'],
  ['dev:browser:split-services', 'dev:browser'],
]);

export const PREFER_CANONICAL_RENAMES = new Set([
  'dev:gateway',
]);
const PREFER_MAPPED_RENAMES = new Set([
  'tauri:build',
]);

const ROOT_SCOPED_SCRIPT_RENAMES = new Map([
  ['sdkwork-cloudrouter', new Map([
    ['size', 'check:size'],
  ])],
  ['sdkwork-codebox', new Map([
    ['tauri', 'exec tauri'],
  ])],
  ['magic-studio', new Map([
    ['vitest', 'exec vitest'],
    ['dev:git-sdk:staging', 'sdk:preview:staging'],
    ['dev:git-sdk:prod', 'sdk:preview:production'],
    ['dev:git-sdk:test', 'sdk:test'],
    ['dev:git-sdk', 'sdk:dev'],
    ['dev:staging', 'preview:browser:staging'],
    ['dev:prod', 'preview:browser:production'],
    ['dev:test', 'test:browser'],
    ['build:git-sdk:staging', 'sdk:build:staging'],
    ['build:git-sdk:dev', 'sdk:build:development'],
    ['build:git-sdk:test', 'sdk:build:test'],
    ['build:git-sdk', 'sdk:build'],
    ['build:npm-sdk', 'sdk:build:npm'],
    ['build:staging', 'build:browser:staging'],
    ['build:prod', 'build:browser:production'],
    ['build:dev', 'build:browser:development'],
    ['build:test', 'build:browser:test'],
    ['tauri:dev', 'dev:desktop:local'],
    ['tauri', 'dev:desktop:local'],
  ])],
  ['sdkwork-github-workflow', new Map([
    ['matrix:example', 'workflow:matrix:example'],
    ['validate:example', 'check:example'],
    ['validate', 'check'],
  ])],
  ['sdkwork-models', new Map([
    ['audit', 'models:audit'],
    ['freshness', 'models:freshness'],
    ['diff', 'models:diff'],
    ['validate', 'models:validate'],
  ])],
]);
const PREFERRED_SOURCE_BY_TARGET = new Map([
  ['dev:desktop:local', 'tauri:dev'],
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function scriptRenamesFor(root) {
  return new Map([
    ...PNPM_SCRIPT_RENAMES,
    ...(ROOT_SCOPED_SCRIPT_RENAMES.get(path.basename(root)) ?? []),
  ]);
}

function replaceScriptReference(value, before, after) {
  const token = escapeRegExp(before);
  if (before.includes(':')) {
    return value.replace(
      new RegExp(`(?<![A-Za-z0-9_:./-])${token}(?=$|[^A-Za-z0-9_:./-])`, 'gu'),
      after,
    );
  }
  return value.replace(
    new RegExp(`(\\b(?:pnpm|npm|yarn)(?:\\s+run)?\\s+)${token}(?=$|[\\s"'\\x60&|])`, 'gu'),
    `$1${after}`,
  );
}

function replaceTokens(value, renames) {
  let next = value;
  const orderedRenames = [...renames].sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [before, after] of orderedRenames) {
    next = replaceScriptReference(next, before, after);
  }
  return next
    .replaceAll('pnpm run exec vitest', 'pnpm exec vitest')
    .replaceAll('pnpm.cmd run exec vitest', 'pnpm.cmd exec vitest')
    .replaceAll('release:release:package:server', 'release:package:server')
    .replaceAll('standalone.unified-process.', 'standalone.')
    .replaceAll('standalone.split-services.', 'standalone.')
    .replaceAll('cloud.split-services.', 'cloud.')
    .replaceAll(', `unified-process`,', ',')
    .replaceAll('standalone unified-process topology', 'standalone topology')
    .replaceAll('standalone unified-process development', 'standalone development')
    .replaceAll('cloud split-services development', 'cloud development')
    .replaceAll('local unified-process verification', 'local standalone verification')
    .replaceAll(' with --service-layout split-services', '')
    .replace(/[ \t]+--service-layout(?:=|[ \t]+)(?:split-services|unified-process)/gu, '')
    .replace(/--hosting(?:=|[ \t]+)self-hosted/gu, '--deployment-profile standalone')
    .replace(/--hosting(?:=|[ \t]+)cloud-hosted/gu, '--deployment-profile cloud');
}

function transformJson(value, label, renames) {
  if (typeof value === 'string') return replaceTokens(value, renames);
  if (Array.isArray(value)) return value.map((item) => transformJson(item, label, renames));
  if (!value || typeof value !== 'object') return value;

  const transformed = {};
  const overriddenTargets = new Set();
  for (const [key, child] of Object.entries(value)) {
    const nextKey = renames.get(key) ?? key;
    const preferredSource = PREFERRED_SOURCE_BY_TARGET.get(nextKey);
    if (preferredSource && key !== preferredSource && Object.hasOwn(value, preferredSource)) continue;
    if (PREFER_CANONICAL_RENAMES.has(key) && Object.hasOwn(value, nextKey)) continue;
    const nextChild = transformJson(child, label, renames);
    if (PREFER_MAPPED_RENAMES.has(key) && Object.hasOwn(value, nextKey)) {
      transformed[nextKey] = nextChild;
      overriddenTargets.add(nextKey);
      continue;
    }
    if (key === nextKey && overriddenTargets.has(key)) continue;
    if (Object.hasOwn(transformed, nextKey)) {
      if (isDeepStrictEqual(transformed[nextKey], nextChild)) continue;
      throw new Error(`${label}: script rename collides at ${nextKey}`);
    }
    transformed[nextKey] = nextChild;
  }
  return transformed;
}

function isCommandReference(value) {
  return /\b(?:pnpm(?:\.cmd)?|npm|yarn|sdkwork-run-pnpm(?:\.cmd)?)\b/iu.test(value)
    || /(?:scripts\s*\[|scripts\.)["'\x60]?[a-z0-9]/iu.test(value)
    || /\b(?:scriptName|commandName)\b/u.test(value)
    || /package\.json script/iu.test(value)
    || /run-pnpm-cli\.mjs/iu.test(value);
}

function transformReferenceJson(value, renames) {
  if (typeof value === 'string') {
    return isCommandReference(value) ? replaceTokens(value, renames) : value;
  }
  if (Array.isArray(value)) return value.map((item) => transformReferenceJson(item, renames));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, transformReferenceJson(child, renames)]),
  );
}

function transformTextReferences(value, renames) {
  return value
    .split(/(?<=\n)/u)
    .map((line) => (isCommandReference(line) ? replaceTokens(line, renames) : line))
    .join('');
}

function collectFiles(root, { packageJsonOnly = false } = {}) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const relative = path.relative(root, absolute).replaceAll('\\', '/');
        if (
          !IGNORED_DIRECTORIES.has(entry.name)
          && !entry.name.startsWith('target-')
          && ![...IGNORED_PATH_PARTS].some(
            (part) => relative === part
              || relative.startsWith(`${part}/`)
              || relative.endsWith(`/${part}`)
              || relative.includes(`/${part}/`),
          )
        ) walk(absolute);
      } else if (
        packageJsonOnly
          ? entry.name === 'package.json'
          : TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(absolute);
      }
    }
  };
  walk(root);
  return files.sort();
}

function transformFile(file, root, renames) {
  const before = fs.readFileSync(file, 'utf8');
  const hasMigrationToken = [...renames.keys()].some((token) => before.includes(token));
  const hasRetiredText = [
    'release:release:package:server',
  ].some((token) => before.includes(token));
  if (!hasMigrationToken && !hasRetiredText) {
    return null;
  }

  let after;
  if (path.extname(file).toLowerCase() === '.json') {
    const parsed = JSON.parse(before.replace(/^\uFEFF/u, ''));
    const label = path.relative(root, file).replaceAll('\\', '/');
    const transformed = path.basename(file) === 'package.json'
      ? transformJson(parsed, label, renames)
      : transformReferenceJson(parsed, renames);
    if (isDeepStrictEqual(parsed, transformed)) return null;
    after = `${JSON.stringify(transformed, null, 2)}\n`;
  } else {
    after = transformTextReferences(before, renames);
  }
  return before === after ? null : after;
}

export function migratePnpmScriptNames(root, { dryRun = false, packageJsonOnly = false } = {}) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(path.join(resolved, 'package.json'))) {
    return { root: resolved, actions: [], skipped: true };
  }

  const changes = [];
  const renames = scriptRenamesFor(resolved);
  for (const file of collectFiles(resolved, { packageJsonOnly })) {
    const content = transformFile(file, resolved, renames);
    if (content === null) continue;
    changes.push({
      action: `update ${path.relative(resolved, file).replaceAll('\\', '/')}`,
      content,
      file,
    });
  }
  if (!dryRun) {
    for (const change of changes) fs.writeFileSync(change.file, change.content, 'utf8');
  }
  return { root: resolved, actions: changes.map((change) => change.action), skipped: false };
}

export function workspaceRoots(workspace, repo) {
  if (repo) return [path.join(workspace, repo)];
  return fs.readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name !== 'sdkwork-specs')
    .map((entry) => path.join(workspace, entry.name))
    .filter((root) => fs.existsSync(path.join(root, 'package.json')))
    .filter((root) => path.basename(root).startsWith('sdkwork-')
      || fs.existsSync(path.join(root, 'sdkwork.app.config.json')));
}

function main() {
  const { values } = parseArgs({ options: {
    workspace: { type: 'string', default: DEFAULT_WORKSPACE },
    repo: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'package-json-only': { type: 'boolean', default: false },
  } });
  const workspace = path.resolve(values.workspace);
  let total = 0;
  for (const root of workspaceRoots(workspace, values.repo)) {
    const result = migratePnpmScriptNames(root, {
      dryRun: values['dry-run'],
      packageJsonOnly: values['package-json-only'],
    });
    for (const action of result.actions) {
      console.log(`${values['dry-run'] ? '[dry-run] ' : ''}${path.basename(root)}: ${action}`);
    }
    total += result.actions.length;
  }
  console.log(`PNPM script name migration actions: ${total}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
