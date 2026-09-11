#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';

import { isApplicationCloudGatewayScript } from './lib/application-cloud-gateway.mjs';
import { resolveRepositoryKind } from './lib/packages-layout-patterns.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_ASSEMBLY_SCRIPT_TOOLS = new Map([
  ['api:assembly:materialize', 'materialize-api-assembly.mjs'],
  ['api:assembly:validate', 'validate-api-assembly.mjs'],
]);

const REQUIRED_ROOT_SCRIPTS = [
  'dev',
  'dev:standalone',
  'dev:cloud',
  'build',
  'test',
  'check',
  'verify',
  'clean',
];

const ALLOWED_FIRST_SEGMENTS = new Set([
  'dev',
  'start',
  'stop',
  'preview',
  'build',
  'test',
  'check',
  'verify',
  'align',
  'clean',
  'typecheck',
  'lint',
  'format',
  'release',
  'deploy',
  'up',
  'down',
  'desktop',
  'db',
  'api',
  'sdk',
  'gateway',
  'topology',
  'workflow',
  'sbom',
  'nginx',
  'import',
  'docs',
  'perf',
  'migrate',
  'install',
  'admin',
  'models',
  'downloads',
  'skills',
  'app-store',
  'smoke',
]);

const RETIRED_SCRIPT_TOKENS = new Set([
  'self-hosted',
  'cloud-hosted',
  'hosting',
  'deploymentMode',
  'unified-process',
  'split-services',
]);
const RETIRED_COMMAND_VALUE_PATTERNS = [
  ['--hosting', /(?:^|\s)--hosting(?:\s|=|$)/iu],
  ['service-layout', /(?:^|\s)--service-layout(?:\s|=|$)/iu],
  ['self-hosted', /\bself-hosted\b/iu],
  ['cloud-hosted', /\bcloud-hosted\b/iu],
  ['unified-process', /\bunified-process\b/iu],
  ['split-services', /\bsplit-services\b/iu],
  ['serviceLayout', /\bserviceLayout\b/iu],
  ['deploymentMode', /\bdeploymentMode\b/iu],
];
const DEPLOYMENT_PROFILES = new Set(['standalone', 'cloud']);
const RELEASE_PHASES = new Set([
  'preflight',
  'plan',
  'build',
  'stage',
  'package',
  'validate',
  'publish',
]);
const DEPLOY_PHASES = new Set(['plan', 'apply', 'rollback', 'validate']);
const RUNTIME_TARGETS = new Set([
  'browser',
  'desktop',
  'server',
  'container',
  'tablet-ipados',
  'tablet-android',
  'capacitor-ios',
  'capacitor-android',
  'flutter-ios',
  'flutter-android',
  'android-native',
  'ios-native',
  'harmony-native',
  'mini-program',
  'test-runner',
]);
const DATABASE_ALIASES = new Set(['postgres', 'sqlite']);
const QUALITY_TIERS = new Set([
  'fast',
  'precommit',
  'full',
  'parallel',
  'smoke',
  'debug',
  'local',
  'check',
  'required',
  'docker',
]);
const BROWSER_CLIENT_ARCHITECTURES = new Set(['pc', 'h5']);
const BROWSER_BUILD_ENV_ALIASES = new Set(['dev', 'test', 'staging', 'demo', 'prod']);
const DEV_AXIS_VALUES = new Set([
  ...RUNTIME_TARGETS,
  ...DATABASE_ALIASES,
  ...DEPLOYMENT_PROFILES,
  ...QUALITY_TIERS,
]);
const ACTION_FIRST_RUNTIME_TARGET_ALIASES = new Map([
  ['browser', 'browser'],
  ['desktop', 'desktop'],
  ['tauri', 'desktop'],
  ['electron', 'desktop'],
  ['docker', 'container'],
  ['android', 'android-native'],
  ['ios', 'ios-native'],
  ['harmony', 'harmony-native'],
  ['flutter', 'flutter-android'],
  ['mini-program', 'mini-program'],
]);
const RETIRED_RUNTIME_TARGET_ALIASES = new Map([
  ['tauri', 'desktop'],
  ['electron', 'desktop'],
]);

const DESKTOP_HOST_FAMILY_ACTIONS = new Set([
  'dev',
  'build',
  'check',
  'test',
  'release',
  'package',
  'preview',
  'smoke',
]);
const DESKTOP_HOST_FAMILY_AXES = new Set([
  'electron',
  'tauri',
  'standalone',
  'cloud',
  'postgres',
  'sqlite',
  'development',
  'staging',
  'prod',
  'production',
  'local',
]);

function isDesktopHostFamilyCommand(scriptName) {
  const parts = scriptName.split(':');
  if (parts[0] !== 'desktop' || parts.length < 2) return false;
  if (!DESKTOP_HOST_FAMILY_ACTIONS.has(parts[1])) return false;
  return parts.slice(2).every((part) => DESKTOP_HOST_FAMILY_AXES.has(part));
}
const RETIRED_LOCAL_FIRST_SEGMENTS = new Set([
  'server',
  'service',
  'portal',
  'product',
  'alignment',
  'apis',
  'file-sdk',
  'prepare',
]);
const DOC_FILE_EXTENSIONS = new Set(['.md', '.mdx']);
const RUNNER_SCRIPT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.sh', '.ps1', '.cmd', '.bat']);
const RUNNER_SCRIPT_ROOTS = new Set(['scripts', 'tools']);
const COMMAND_JSON_FILENAMES = new Set(['sdkwork.app.config.json', 'sdkwork.workflow.json', 'tauri.conf.json']);
const PNPM_NATIVE_COMMANDS = new Set([
  'add',
  'approve-builds',
  'audit',
  'config',
  'create',
  'dlx',
  'env',
  'exec',
  'import',
  'init',
  'install',
  'link',
  'list',
  'outdated',
  'pack',
  'patch',
  'publish',
  'remove',
  'run',
  'setup',
  'store',
  'unlink',
  'update',
  'why',
]);
const PNPM_PROSE_WORDS = new Set([
  'command',
  'commands',
  'child-process',
  'catalog',
  'dependency',
  'global',
  'lockfile',
  'modules',
  'package',
  'packagemanager',
  'script',
  'scripts',
  'standard',
  'tab',
  'workspace',
  'workspaces',
]);
const NPM_LIFECYCLE_HOOK_PATTERN = /^(?:pre|post)(?:dev|start|stop|preview|build|test|check|verify|clean|typecheck|lint|format|pack|publish|install)$/u;
const NPM_LIFECYCLE_HOOKS = new Set([
  'prepare',
  'prepublishOnly',
]);
const IGNORED_DIRS = new Set([
  '.git',
  '.mimocode',
  '.pnpm',
  '.vite',
  // `.tmp/` is the workspace scratch convention (every repository's `.gitignore`
  // covers it, usually as `.tmp*/` or `*.tmp`), and seven sibling spec tools
  // already skip it. Local scratch here holds merge outputs and sandbox
  // package.json copies, so auditing them reports a violation against a file no
  // developer authored and no repository ships.
  '.tmp',
  // `website/` keeps its build output in dot-prefixed siblings of the same
  // concept: scanning them duplicates every finding already reported against the
  // authored source, and the generated copy cannot be fixed by hand.
  '.dist',
  '.generated',
  'external',
  'node_modules',
  'target',
  'dist',
  'generated',
  'third_party',
  'vendor',
]);
const IGNORED_DOCUMENT_PATH_PARTS = new Set([
  '.zcode',
  '.agents/notes/archived',
  // Completed work notes are dated records of what was done, exactly like the
  // `archived` set: their command examples describe history, not the standard.
  '.agents/notes/implemented',
  // Proposal drafts describe what MAY become the standard, not the standard.
  // The gate governs active documents (`PNPM_SCRIPT_SPEC.md` section 10 lists
  // "active runbook examples"), so an unapproved proposal is out of scope.
  '.agents/notes/proposed',
  // Local per-machine AI workspace metadata (AGENTS.md local dictionary), never
  // a shipped document.
  '.sdkwork',
  // The WorkBuddy-side equivalent of `.sdkwork`: git-ignored, never tracked, and
  // holding agent memory logs plus scratch probes. Its prose names command
  // placeholders ("follow `pnpm run <script>`"), which are not examples a reader
  // can run; validating them produces findings nobody can act on, and an
  // unactionable gate stops being read.
  '.workbuddy',
  'artifacts',
  'docs/archive',
  'docs/release',
  'docs/review',
  'docs/superpowers',
  '.sdkwork/manual-backups',
]);

/**
 * Scratch directories carry the `.tmp` prefix in practice (`.tmp`, `.tmp-merge`)
 * because that is how the fleet's `.gitignore` files spell it. Matching the
 * prefix rather than a fixed name keeps the skip rule aligned with the ignore
 * rule instead of drifting one rename behind it.
 */
function isIgnoredDirectoryName(name) {
  return IGNORED_DIRS.has(name) || name.startsWith('.tmp-');
}

function usage() {
  return [
    'Usage: node tools/check-pnpm-script-standard.mjs --root <repo> [--json] [--application-code-prefix a,b,c]',
    '       node tools/check-pnpm-script-standard.mjs --workspace <workspace-root> [--json] [--concurrency N] [--include-off-fleet]',
    '',
    'Validates SDKWork repository root package.json scripts against PNPM_SCRIPT_SPEC.md.',
    '',
    'The --workspace form is the fleet regression: it discovers every sdkwork-*',
    'repository that owns a root package.json and audits each one through the same',
    '--root code path, so the fleet verdict cannot drift from the per-repository one.',
  ].join('\n');
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '');
  return JSON.parse(text);
}

function readJsonIfValid(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function isApplicationRepositoryRoot(root) {
  const componentPath = path.join(root, 'specs', 'component.spec.json');
  const component = fs.existsSync(componentPath) ? readJsonIfValid(componentPath) : null;
  const componentType = String(component?.component?.type ?? '').trim().toLowerCase();
  if (new Set(['domain-library', 'node-package']).has(componentType)) return false;

  const appPath = path.join(root, 'sdkwork.app.config.json');
  const app = fs.existsSync(appPath) ? readJsonIfValid(appPath) : null;
  if (String(app?.runtime?.family ?? '').trim().toLowerCase() === 'library') return false;

  return new Set([
    'application',
    'legacy-application',
    'unknown',
  ]).has(resolveRepositoryKind(root));
}

function isDelegatedApplicationSurface(root) {
  const deploymentPath = path.join(root, 'etc', 'sdkwork.deployment.config.json');
  if (!fs.existsSync(deploymentPath)) return false;
  return readJsonIfValid(deploymentPath)?.kind === 'sdkwork.component-deployment';
}

function canonicalApiAssemblyCommand(root, toolName) {
  const toolPath = path.join(SPECS_ROOT, 'tools', toolName);
  const relative = path.relative(root, toolPath).replaceAll('\\', '/');
  const commandPath = path.isAbsolute(relative) || /^[a-z]:\//iu.test(relative)
    ? relative
    : relative.startsWith('.') ? relative : `./${relative}`;
  return `node ${commandPath} --root .`;
}

function pushApiAssemblyCommandIssues(root, scripts, issues) {
  for (const [scriptName, toolName] of API_ASSEMBLY_SCRIPT_TOOLS) {
    if (!scripts[scriptName]) {
      issues.push(`missing required API assembly script "${scriptName}"`);
      continue;
    }

    const expected = canonicalApiAssemblyCommand(root, toolName);
    if (String(scripts[scriptName]).trim() !== expected) {
      issues.push(
        `${scriptName}: must directly invoke the canonical sdkwork-specs tool as "${expected}"; application-owned wrappers are forbidden`,
      );
    }
  }
}

function splitCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Terminal validation failure. Throwing instead of exiting keeps the
 * single-repository and fleet code paths on one implementation: main() catches
 * it to print and set the exit code, while the fleet runner catches it per
 * repository and records the verdict. A shared flag or an early exit would let
 * the two verdicts drift.
 */
class ScriptStandardFailure extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ScriptStandardFailure';
    this.details = details;
  }
}

function fail(message, details = []) {
  throw new ScriptStandardFailure(message, details);
}

function isPackageJsonGenerated(packagePath) {
  const normalized = packagePath.replaceAll(path.sep, '/');
  return normalized.includes('/generated/') || normalized.includes('/.sdkwork/manual-backups/');
}

function pushGatewayNameIssues(scriptName, issues, prefix = '') {
  const parts = scriptName.split(':');
  if (parts[0] !== 'gateway' || parts.length < 3) return;
  if (DEPLOYMENT_PROFILES.has(parts[1])) {
    issues.push(
      `${prefix}${scriptName}: use gateway:<action>[:deploymentProfile], for example gateway:${parts[2]}:${parts[1]}`,
    );
  }
}

function pushRuntimeNamespaceBoundaryIssues(scriptName, commandText, issues, prefix = '') {
  const isGatewayNamespace = scriptName.startsWith('gateway:')
    || scriptName.startsWith('_sdkwork:gateway:');
  if (isGatewayNamespace && /\bsdkwork-[a-z0-9-]+-edge-runtime\b/iu.test(commandText)) {
    issues.push(
      `${prefix}${scriptName}: edge runtime targets belong to _sdkwork:runtime:* and release/build composition, not gateway commands`,
    );
  }

  if (scriptName.startsWith('_sdkwork:runtime:')
    && /\bsdkwork-api-(?:cloud|[a-z0-9-]+-standalone)-gateway\b/iu.test(commandText)) {
    issues.push(
      `${prefix}${scriptName}: canonical API gateway targets belong to _sdkwork:gateway:*`,
    );
  }
}

function pushLifecycleProfileOrderIssues(scriptName, issues, prefix = '') {
  const parts = scriptName.split(':');
  const [namespace, second] = parts;
  if (!['release', 'deploy'].includes(namespace) || parts.length < 3) return;

  if (DEPLOYMENT_PROFILES.has(second)) {
    issues.push(
      `${prefix}${scriptName}: use ${namespace}:<phase>[:runtimeTarget]:<deploymentProfile>; for example ${namespace}:${parts[2]}:${second}`,
    );
    return;
  }

  if (namespace === 'deploy') {
    const profileIndex = parts.findIndex((part) => DEPLOYMENT_PROFILES.has(part));
    if (profileIndex > 0 && profileIndex !== 2) {
      issues.push(
        `${prefix}${scriptName}: deploy profile must immediately follow the phase; use deploy:<phase>:<deploymentProfile>[:provider]`,
      );
    }
    return;
  }

  const profileIndex = parts.findIndex((part) => DEPLOYMENT_PROFILES.has(part));
  if (profileIndex > 3) {
    issues.push(
      `${prefix}${scriptName}: release profile must follow the phase or one runtime target; use release:<phase>[:runtimeTarget]:<deploymentProfile>`,
    );
  }
}

function pushBrowserBuildIssues(scriptName, issues, prefix = '') {
  const parts = scriptName.split(':');
  if (parts[0] !== 'build' || parts.length < 3) {
    return;
  }
  const architecture = parts[1];
  if (!BROWSER_CLIENT_ARCHITECTURES.has(architecture)) {
    return;
  }
  const environmentAlias = parts[2];
  if (!BROWSER_BUILD_ENV_ALIASES.has(environmentAlias)) {
    issues.push(
      `${prefix}${scriptName}: browser build environment must be one of ${[...BROWSER_BUILD_ENV_ALIASES].join(', ')}`,
    );
  }
  if (parts.length > 3 && !DEPLOYMENT_PROFILES.has(parts[3])) {
    issues.push(
      `${prefix}${scriptName}: optional browser build deployment profile must be standalone or cloud`,
    );
  }
  if (parts.length > 4) {
    issues.push(
      `${prefix}${scriptName}: browser build grammar is build:<pc|h5>:<dev|test|staging|demo|prod>[:standalone|cloud]`,
    );
  }
}

function pushAppSurfaceBrowserBuildIssues(scriptName, issues, prefix = '') {
  const parts = scriptName.split(':');
  if (parts[0] !== 'build' || parts.length < 2 || BROWSER_CLIENT_ARCHITECTURES.has(parts[1])) {
    return;
  }
  const environmentAlias = parts[1];
  if (!BROWSER_BUILD_ENV_ALIASES.has(environmentAlias)) {
    return;
  }
  if (parts.length > 2 && !DEPLOYMENT_PROFILES.has(parts[2])) {
    issues.push(
      `${prefix}${scriptName}: optional browser build deployment profile must be standalone or cloud`,
    );
  }
  if (parts.length > 3) {
    issues.push(
      `${prefix}${scriptName}: app-surface browser build grammar is build:<dev|test|staging|demo|prod>[:standalone|cloud]`,
    );
  }
}
function pushActionFirstRuntimeTargetIssues(scriptName, issues, prefix = '') {
  if (isDesktopHostFamilyCommand(scriptName)) return;
  const parts = scriptName.split(':');
  const runtimeTarget = ACTION_FIRST_RUNTIME_TARGET_ALIASES.get(parts[0]);
  if (!runtimeTarget || parts.length < 2) return;

  issues.push(
    `${prefix}${scriptName}: use action-first runtime target script names such as ${parts[1]}:${runtimeTarget}`,
  );
}

function pushRuntimeTargetAliasIssues(scriptName, issues, prefix = '') {
  if (isDesktopHostFamilyCommand(scriptName)) return;
  const parts = scriptName.split(':');
  for (const [index, part] of parts.entries()) {
    const runtimeTarget = RETIRED_RUNTIME_TARGET_ALIASES.get(part);
    if (!runtimeTarget) continue;
    if (parts[0] === 'dev' && parts[1] === 'desktop' && (part === 'electron' || part === 'tauri')) {
      continue;
    }
    const action = index > 0 ? parts[0] : parts[1] || 'dev';
    issues.push(
      `${prefix}${scriptName}: use runtime target "${runtimeTarget}" instead of tool alias "${part}", for example ${action}:${runtimeTarget}`,
    );
  }
}

function pushDevAxisIssues(scriptName, issues, prefix = '') {
  const parts = scriptName.split(':');
  if (parts[0] !== 'dev' || parts.length < 2) {
    return;
  }

  for (const part of parts.slice(1)) {
    if (DEV_AXIS_VALUES.has(part)) {
      continue;
    }
    if (parts[1] === 'desktop' && (part === 'electron' || part === 'tauri')) {
      continue;
    }
    if (RUNTIME_TARGETS.has(parts[1])) {
      issues.push(
        `${prefix}${scriptName}: "${part}" is not a standard dev axis value; use runtimeTarget, database, deploymentProfile, or tier suffixes`,
      );
    } else {
      issues.push(
        `${prefix}${scriptName}: "${part}" is not a standard dev runtime target; use one of ${[...RUNTIME_TARGETS].join(', ')}`,
      );
    }
  }

  if (parts.includes('cloud') && parts.some((part) => DATABASE_ALIASES.has(part))) {
    issues.push(
      `${prefix}${scriptName}: cloud development consumes deployed APIs and must not include a database axis`,
    );
  }
  if (parts.includes('sqlite') && parts[1] !== 'desktop') {
    issues.push(
      `${prefix}${scriptName}: sqlite is client-local and is allowed only on an explicit dev:desktop:sqlite profile`,
    );
  }
}

function isIgnoredPathPart(filePath, ignoredParts) {
  const normalized = filePath.replaceAll(path.sep, '/');
  for (const part of ignoredParts) {
    if (normalized.includes(`/${part}/`) || normalized.endsWith(`/${part}`)) {
      return true;
    }
  }
  return false;
}

function scriptNameHasSegment(scriptName, segment) {
  return scriptName.split(':').includes(segment);
}

function commandHasFlagValue(commandText, flagName, value) {
  const escapedFlag = flagName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(
    `(?:^|\\s)--${escapedFlag}(?:\\s+|=)${escapedValue}(?:\\s|$)`,
    'iu',
  );
  return pattern.test(commandText);
}

function commandUsesRetiredHostingAxis(commandText) {
  return getRetiredCommandValueTokens(commandText).some((token) => (
    token === '--hosting' || token === 'self-hosted' || token === 'cloud-hosted'
  ));
}

function getRetiredCommandValueTokens(commandText) {
  const tokens = [];
  for (const [token, pattern] of RETIRED_COMMAND_VALUE_PATTERNS) {
    if (pattern.test(commandText)) {
      tokens.push(token);
    }
  }
  return tokens;
}

function pushRetiredCommandValueIssues(commandLabel, commandText, issues, prefix = '') {
  for (const token of getRetiredCommandValueTokens(commandText)) {
    issues.push(`${prefix}${commandLabel}: command value uses retired deployment token "${token}"`);
  }
}

function pushRetiredCommandExampleIssues(commandLabel, commandText, issues, prefix = '') {
  for (const token of getRetiredCommandValueTokens(commandText)) {
    issues.push(`${prefix}${commandLabel}: command example uses retired deployment token "${token}"`);
  }
}

function resolveRootScriptDelegation(scriptName, scripts) {
  const trace = [];
  const seen = new Set();
  let currentName = scriptName;

  while (scripts[currentName] && !seen.has(currentName)) {
    seen.add(currentName);
    const commandText = String(scripts[currentName]);
    trace.push({ commandText, scriptName: currentName });

    const delegation = commandText.match(
      /^\s*pnpm(?:\.cmd)?(?:\s+run)?\s+([a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)*)\b/iu,
    );
    if (!delegation) {
      break;
    }

    const delegatedScriptName = delegation[1];
    if (!scripts[delegatedScriptName] || delegatedScriptName === currentName) {
      break;
    }

    currentName = delegatedScriptName;
  }

  return trace;
}

function directDelegatedScriptName(commandText) {
  return commandText.match(
    /^\s*pnpm(?:\.cmd)?(?:\s+run)?\s+([a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)*)\s*$/iu,
  )?.[1];
}

function resolvedProfileState(scriptName, scripts) {
  const trace = resolveRootScriptDelegation(scriptName, scripts);
  const scriptNames = trace.map((entry) => entry.scriptName);
  const commandText = trace.map((entry) => entry.commandText).join('\n');
  return {
    commandText,
    hasCloud: scriptNames.some((name) => scriptNameHasSegment(name, 'cloud'))
      || commandHasFlagValue(commandText, 'deployment-profile', 'cloud'),
    hasDevelopment: commandHasFlagValue(commandText, 'environment', 'development')
      || /(?:^|\s)sdkwork-app\s+dev(?:\s|$)/mu.test(commandText),
    hasPostgres: scriptNames.some((name) => scriptNameHasSegment(name, 'postgres'))
      || commandHasFlagValue(commandText, 'database', 'postgres'),
    hasSqlite: scriptNames.some((name) => scriptNameHasSegment(name, 'sqlite'))
      || commandHasFlagValue(commandText, 'database', 'sqlite'),
    hasStandalone: scriptNames.some((name) => scriptNameHasSegment(name, 'standalone'))
      || commandHasFlagValue(commandText, 'deployment-profile', 'standalone'),
  };
}

function pushProfileDevelopmentEntrypointIssues(scripts, issues) {
  if (scripts.dev && directDelegatedScriptName(String(scripts.dev)) !== 'dev:standalone') {
    issues.push('dev: bare dev must directly delegate to "dev:standalone"');
  }

  if (scripts['dev:standalone']) {
    const state = resolvedProfileState('dev:standalone', scripts);
    if (!state.hasStandalone || state.hasCloud) {
      issues.push('dev:standalone: must resolve only to deployment profile "standalone"');
    }
    if (!state.hasDevelopment) {
      issues.push('dev:standalone: must resolve to environment "development"');
    }
  }

  if (scripts['dev:cloud']) {
    const state = resolvedProfileState('dev:cloud', scripts);
    if (!state.hasCloud || state.hasStandalone) {
      issues.push('dev:cloud: must resolve only to deployment profile "cloud"');
    }
    if (!state.hasDevelopment) {
      issues.push('dev:cloud: must resolve to environment "development"');
    }
    if (state.hasPostgres || state.hasSqlite || /(?:^|\s)--database(?:\s|=|$)/iu.test(state.commandText)) {
      issues.push('dev:cloud: remote cloud development must not select or bootstrap a local database');
    }
  }
  if (scripts['_sdkwork:stop']) {
    issues.push('private _sdkwork:stop is forbidden; declare owned bindings and managed resources in topology');
  }
}

function workflowReleaseProfiles(root) {
  const workflowPath = path.join(root, 'sdkwork.workflow.json');
  if (!fs.existsSync(workflowPath)) return new Set(['standalone', 'cloud']);
  // Optional manifest: a malformed or empty file must degrade to lifecycle
  // debt, never crash the audit (a single bad manifest used to take down the
  // whole fleet run because this read threw).
  const workflow = readJsonIfValid(workflowPath);
  if (!Array.isArray(workflow?.targets) || workflow.targets.length === 0) {
    return new Set(['standalone', 'cloud']);
  }
  const profiles = new Set();
  for (const target of workflow.targets) {
    if (target?.profileBinding === 'runtime-configurable') {
      for (const profile of target.supportedDeploymentProfiles ?? ['standalone', 'cloud']) profiles.add(profile);
    } else if (target?.deploymentProfile === 'standalone' || target?.deploymentProfile === 'cloud') {
      profiles.add(target.deploymentProfile);
    }
  }
  return profiles.size > 0 ? profiles : new Set(['standalone', 'cloud']);
}

function supportedDeploymentProfiles(root) {
  const profiles = workflowReleaseProfiles(root);
  const appConfigPath = path.join(root, 'sdkwork.app.config.json');
  if (fs.existsSync(appConfigPath)) {
    const appConfig = readJsonIfValid(appConfigPath);
    const declared = appConfig?.runtime?.supportedDeploymentProfiles;
    if (Array.isArray(declared) && declared.length > 0) {
      for (const profile of declared) {
        if (profile === 'standalone' || profile === 'cloud') profiles.add(profile);
      }
      // A repository that explicitly declares its supported deployment
      // profiles owns the authority: do not union with workflow-derived
      // defaults that would resurrect a retired profile.
      const declaredProfiles = new Set(
        declared.filter((profile) => profile === 'standalone' || profile === 'cloud'),
      );
      if (declaredProfiles.size > 0) return declaredProfiles;
    }
  }
  return profiles;
}

function pushPairedLifecycleProfileIssues(root, scripts, issues) {
  const names = Object.keys(scripts);
  for (const [namespace, phases] of [
    ['release', RELEASE_PHASES],
    ['deploy', DEPLOY_PHASES],
  ]) {
    for (const phase of phases) {
      const phasePrefix = `${namespace}:${phase}`;
      const exposed = names.filter((name) => name === phasePrefix || name.startsWith(`${phasePrefix}:`));
      if (exposed.length === 0) continue;

      const hasStandalone = exposed.some((name) => scriptNameHasSegment(name, 'standalone'));
      const hasCloud = exposed.some((name) => scriptNameHasSegment(name, 'cloud'));
      const hasRuntimeConfigurable = namespace === 'release'
        && exposed.some((name) => scriptNameHasSegment(name, 'runtime-configurable'));
      if (hasRuntimeConfigurable) continue;
      const requiredProfiles = supportedDeploymentProfiles(root);
      if (requiredProfiles.has('standalone') && !hasStandalone) {
        issues.push(`${phasePrefix}: exposed lifecycle phase must provide a standalone profile variant`);
      }
      if (requiredProfiles.has('cloud') && !hasCloud) {
        issues.push(`${phasePrefix}: exposed lifecycle phase must provide a cloud profile variant`);
      }
    }
  }
}

function pushDefaultDevRuntimeIssues(defaultScriptName, scripts, issues) {
  if (!scripts[defaultScriptName]) {
    return;
  }

  const trace = resolveRootScriptDelegation(defaultScriptName, scripts);
  const scriptNames = trace.map((entry) => entry.scriptName);
  const commandText = trace.map((entry) => entry.commandText).join('\n');

  const hasPostgres = scriptNames.some((scriptName) => scriptNameHasSegment(scriptName, 'postgres'))
    || commandHasFlagValue(commandText, 'database', 'postgres');
  const hasSqlite = scriptNames.some((scriptName) => scriptNameHasSegment(scriptName, 'sqlite'))
    || commandHasFlagValue(commandText, 'database', 'sqlite');
  const hasStandalone = scriptNames.some((scriptName) => scriptNameHasSegment(scriptName, 'standalone'))
    || commandHasFlagValue(commandText, 'deployment-profile', 'standalone');
  const hasCloud = scriptNames.some((scriptName) => scriptNameHasSegment(scriptName, 'cloud'))
    || commandHasFlagValue(commandText, 'deployment-profile', 'cloud');
  if (commandUsesRetiredHostingAxis(commandText)) {
    issues.push(
      `${defaultScriptName}: default dev runtime must use --deployment-profile standalone instead of retired --hosting`,
    );
  }
  if (hasSqlite || !hasPostgres) {
    issues.push(
      `${defaultScriptName}: default dev runtime must resolve to database "postgres" through script suffix or --database postgres`,
    );
  }
  if (hasCloud || !hasStandalone) {
    issues.push(
      `${defaultScriptName}: default dev runtime must resolve to deployment profile "standalone" through script suffix or --deployment-profile standalone`,
    );
  }
}

function pushDefaultDevelopmentRuntimeIssues(scripts, issues) {
  pushDefaultDevRuntimeIssues('dev:browser', scripts, issues);
  pushDefaultDevRuntimeIssues('dev:desktop', scripts, issues);
}

function pushCommandNameIssues(
  scriptName,
  issues,
  productPrefixes,
  prefix = '',
  productPrefixMessage = 'application-code-prefixed public root scripts are forbidden',
) {
  if (NPM_LIFECYCLE_HOOKS.has(scriptName) || NPM_LIFECYCLE_HOOK_PATTERN.test(scriptName)) {
    return;
  }
  if (scriptName.startsWith('_sdkwork:')) {
    if (!/^_sdkwork:(dev:(standalone|cloud)|build|test|check|verify|clean|release:[a-z0-9:-]+|deploy:[a-z0-9:-]+|client(?::[a-z0-9-]+)*|gateway(?::[a-z0-9-]+)*|runtime(?::[a-z0-9-]+)*)$/u.test(scriptName)) {
      issues.push(`${prefix}${scriptName}: private SDKWork hooks must use an approved _sdkwork lifecycle or topology namespace`);
    }
    return;
  }
  const first = scriptName.split(':')[0];
  if (!ALLOWED_FIRST_SEGMENTS.has(first)) {
    issues.push(`${prefix}${scriptName}: first segment "${first}" is not a standard public namespace`);
  }
  if (productPrefixes.includes(first) && !ALLOWED_FIRST_SEGMENTS.has(first)) {
    issues.push(`${prefix}${scriptName}: ${productPrefixMessage}`);
  }
  pushActionFirstRuntimeTargetIssues(scriptName, issues, prefix);
  pushRuntimeTargetAliasIssues(scriptName, issues, prefix);
  pushDevAxisIssues(scriptName, issues, prefix);
  for (const token of scriptName.split(':')) {
    if (RETIRED_SCRIPT_TOKENS.has(token)) {
      issues.push(`${prefix}${scriptName}: retired token "${token}" must not appear in public scripts`);
    }
  }
  pushGatewayNameIssues(scriptName, issues, prefix);
  pushLifecycleProfileOrderIssues(scriptName, issues, prefix);
  pushBrowserBuildIssues(scriptName, issues, prefix);
  pushAppSurfaceBrowserBuildIssues(scriptName, issues, prefix);
}

function validateRootScripts(root, productPrefixes) {
  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) {
    fail(`missing root package.json at ${packagePath}`);
  }

  const manifest = readJson(packagePath);
  const scripts = manifest.scripts || {};
  const scriptNames = Object.keys(scripts).sort();
  const issues = [];
  const applicationRepository = isApplicationRepositoryRoot(root);
  const delegatedSurface = isDelegatedApplicationSurface(root);
  const independentApplicationRoot = applicationRepository && !delegatedSurface;

  if (independentApplicationRoot) {
    const profiles = supportedDeploymentProfiles(root);
    for (const required of REQUIRED_ROOT_SCRIPTS) {
      // Standalone-only repositories retired the cloud dev entrypoint; the
      // dev:cloud requirement follows each repository's declared profiles.
      if (required === 'dev:cloud' && !profiles.has('cloud')) continue;
      if (!scripts[required]) {
        issues.push(`missing required root script "${required}"`);
      }
    }

    if (scripts.dev && !scripts.stop) {
      issues.push('stop: repository roots with dev must expose a scoped stop command');
    }
  } else if (delegatedSurface) {
    const profiles = supportedDeploymentProfiles(root);
    for (const required of ['dev', 'dev:standalone', 'dev:cloud', 'stop']) {
      if (required === 'dev:cloud' && !profiles.has('cloud')) continue;
      if (!scripts[required]) {
        issues.push(`missing required delegated surface script "${required}"`);
      }
    }

    if (scripts.dev && !scripts.stop) {
      issues.push('stop: delegated surfaces with dev must expose a parent-scoped stop command');
    }
  }

  for (const scriptName of scriptNames) {
    pushCommandNameIssues(scriptName, issues, productPrefixes);
    pushRuntimeNamespaceBoundaryIssues(scriptName, String(scripts[scriptName]), issues);
    if (!scriptName.startsWith('_sdkwork:')) {
      pushRetiredCommandValueIssues(scriptName, String(scripts[scriptName]), issues);
    }
  }
  const isPlatformCloudGateway = path.basename(path.resolve(root)) === 'sdkwork-api-cloud-gateway';
  if (!isPlatformCloudGateway) {
    for (const scriptName of scriptNames) {
      if (isApplicationCloudGatewayScript(scriptName)) {
        issues.push(`${scriptName}: application roots must not expose platform cloud gateway commands`);
      }
      if (scriptName.startsWith('gateway:assembly:')) {
        issues.push(`${scriptName}: use api:assembly:materialize or api:assembly:validate`);
      }
    }
    const cargo = fs.existsSync(path.join(root, 'Cargo.toml'))
      ? fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8')
      : '';
    const ownsHttpRoutes = /crates\/sdkwork-routes-[^"\s]+-(?:app|backend|open)-api/u.test(cargo)
      || fs.existsSync(path.join(root, 'crates'))
        && fs.readdirSync(path.join(root, 'crates')).some((name) => /^sdkwork-api-[a-z0-9-]+-assembly$/u.test(name));
    const isApplicationRoot = independentApplicationRoot
      && fs.existsSync(path.join(root, 'sdkwork.app.config.json'));
    if (ownsHttpRoutes || isApplicationRoot) {
      pushApiAssemblyCommandIssues(root, scripts, issues);
    }
  }
  if (independentApplicationRoot || delegatedSurface) {
    pushDefaultDevelopmentRuntimeIssues(scripts, issues);
    pushProfileDevelopmentEntrypointIssues(scripts, issues);
  }
  pushPairedLifecycleProfileIssues(root, scripts, issues);

  if (issues.length > 0) {
    fail(`${path.relative(process.cwd(), packagePath)} is not compliant`, issues);
  }

  return { packagePath, scriptCount: scriptNames.length };
}

function validatePackageLocalScripts(root) {
  const packagePaths = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (entry.name === 'package.json') {
        packagePaths.push(path.join(dir, entry.name));
      }
    }
  }

  walk(root);
  const issues = [];

  for (const packagePath of packagePaths) {
    if (packagePath === path.join(root, 'package.json')) continue;
    if (isPackageJsonGenerated(packagePath)) continue;

    const manifest = readJson(packagePath);
    const scripts = manifest.scripts || {};
    for (const scriptName of Object.keys(scripts)) {
      if (scriptName.startsWith('_sdkwork:')) continue;
      const first = scriptName.split(':')[0];
      if (RETIRED_LOCAL_FIRST_SEGMENTS.has(first)) {
        issues.push(
          `${path.relative(root, packagePath)}#${scriptName}: first segment "${first}" is not a standard local namespace`,
        );
      }
      pushActionFirstRuntimeTargetIssues(scriptName, issues, `${path.relative(root, packagePath)}#`);
      pushRuntimeTargetAliasIssues(scriptName, issues, `${path.relative(root, packagePath)}#`);
      pushDevAxisIssues(scriptName, issues, `${path.relative(root, packagePath)}#`);
      for (const token of scriptName.split(':')) {
        if (RETIRED_SCRIPT_TOKENS.has(token)) {
          issues.push(`${path.relative(root, packagePath)}#${scriptName}: retired token "${token}"`);
        }
      }
      pushRetiredCommandValueIssues(
        scriptName,
        String(scripts[scriptName]),
        issues,
        `${path.relative(root, packagePath)}#`,
      );
    }
  }

  if (issues.length > 0) {
    fail('package-local scripts are not compliant', issues);
  }

  return packagePaths.length;
}

function collectDocumentationFiles(root) {
  const docPaths = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName(entry.name)) continue;
        if (isIgnoredPathPart(entryPath, IGNORED_DOCUMENT_PATH_PARTS)) continue;
        walk(entryPath);
        continue;
      }

      if (DOC_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        docPaths.push(entryPath);
      }
    }
  }

  walk(root);
  return docPaths;
}

function extractPnpmCommands(line) {
  return extractPnpmCommandExamples(line).map((command) => command.scriptName);
}

function extractPnpmCommandExamples(line) {
  const commands = [];
  const pattern = /\bpnpm(?:\.cmd)?(\s+run)?\s+([a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)*)/gi;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    const usedRun = Boolean(match[1]);
    const scriptName = match[2];
    if (!usedRun && PNPM_PROSE_WORDS.has(scriptName.toLowerCase())) {
      continue;
    }
    if (!usedRun && (/^\d/.test(scriptName) || PNPM_NATIVE_COMMANDS.has(scriptName))) {
      continue;
    }
    commands.push({ commandText: line.slice(match.index), scriptName });
  }
  return commands;
}

/**
 * Authored prose constantly contains the word "pnpm" — "pnpm would then…",
 * "pnpm cannot…", "pnpm keeps…". Treating those as command references produces
 * findings nobody can act on, which is exactly how a gate stops being read.
 *
 * A command reference is only real in a code context: inside a fenced block, or
 * inside an inline code span.
 *
 * Each context is evaluated on its own and contexts are never concatenated.
 * Joining the inline spans of one line fabricates adjacency the document never
 * expressed: `` `pnpm.cmd` … `pnpm.ps1` `` becomes the command "pnpm pnpm",
 * `` `pnpm` and `cargo` verification `` becomes "pnpm cargo", and
 * `` the root `pnpm` commands … `target/dev/x.sqlite` `` becomes "pnpm target".
 */
function inlineCodeSpans(line) {
  return [...line.matchAll(/`([^`]+)`/gu)].map((m) => m[1]);
}

function validateDocumentationExamples(root, productPrefixes) {
  const docPaths = collectDocumentationFiles(root);
  const issues = [];

  for (const docPath of docPaths) {
    const text = fs.readFileSync(docPath, 'utf8');
    const lines = text.split(/\r?\n/);
    let inFence = false;
    for (const [index, line] of lines.entries()) {
      if (/^\s*(?:```|~~~)/u.test(line)) {
        inFence = !inFence;
        continue;
      }
      // Candidate contexts are evaluated one at a time. A fenced line is code in
      // full; outside a fence only a single inline code span is a code context.
      // Concatenating the spans of one line invents commands that the document
      // never contained.
      const contexts = inFence ? [line] : inlineCodeSpans(line);
      for (const context of contexts) {
        for (const { commandText, scriptName } of extractPnpmCommandExamples(context)) {
          const prefix = `${path.relative(root, docPath)}:${index + 1}: pnpm `;
          pushCommandNameIssues(
            scriptName,
            issues,
            productPrefixes,
            prefix,
            'application-code-prefixed command examples are forbidden',
          );
          pushRetiredCommandExampleIssues(scriptName, commandText, issues, prefix);
        }
      }
    }
  }

  if (issues.length > 0) {
    fail('documentation pnpm command examples are not compliant', issues);
  }

  return docPaths.length;
}

function collectCommandJsonFiles(root) {
  const jsonPaths = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName(entry.name)) continue;
        if (isIgnoredPathPart(entryPath, IGNORED_DOCUMENT_PATH_PARTS)) continue;
        walk(entryPath);
        continue;
      }

      if (
        COMMAND_JSON_FILENAMES.has(entry.name) ||
        (entry.name.endsWith('.json') && entryPath.replaceAll(path.sep, '/').includes('/specs/'))
      ) {
        jsonPaths.push(entryPath);
      }
    }
  }

  walk(root);
  return jsonPaths;
}

function collectStringValues(value, pointer = '', output = []) {
  if (typeof value === 'string') {
    output.push([pointer || '$', value]);
    return output;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectStringValues(item, `${pointer}.${index}`, output);
    }
    return output;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectStringValues(item, pointer ? `${pointer}.${key}` : key, output);
    }
  }
  return output;
}

function validateJsonCommandExamples(root, productPrefixes) {
  const jsonPaths = collectCommandJsonFiles(root);
  const issues = [];

  for (const jsonPath of jsonPaths) {
    // Command-example scanning is advisory: these files are discovered by
    // extension, so a malformed one (or a non-JSON payload living at a .json
    // path) is skipped instead of aborting the audit.
    const manifest = readJsonIfValid(jsonPath);
    if (manifest === null) continue;
    for (const [pointer, text] of collectStringValues(manifest)) {
      for (const { commandText, scriptName } of extractPnpmCommandExamples(text)) {
        const prefix = `${path.relative(root, jsonPath)}: ${pointer}: pnpm `;
        pushCommandNameIssues(
          scriptName,
          issues,
          productPrefixes,
          prefix,
          'application-code-prefixed command examples are forbidden',
        );
        pushRetiredCommandExampleIssues(scriptName, commandText, issues, prefix);
      }
    }
  }

  if (issues.length > 0) {
    fail('manifest/workflow pnpm command examples are not compliant', issues);
  }

  return jsonPaths.length;
}

function collectRunnerScriptFiles(root) {
  const runnerPaths = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName(entry.name)) continue;
        if (isIgnoredPathPart(entryPath, IGNORED_DOCUMENT_PATH_PARTS)) continue;
        walk(entryPath);
        continue;
      }

      const relativePath = path.relative(root, entryPath);
      const normalized = relativePath.replaceAll(path.sep, '/');
      const firstPart = normalized.split('/')[0];
      const extension = path.extname(entry.name).toLowerCase();
      if (!RUNNER_SCRIPT_ROOTS.has(firstPart) || !RUNNER_SCRIPT_EXTENSIONS.has(extension)) {
        continue;
      }
      if (/\.(?:test|spec)\.[cm]?[jt]s$/iu.test(entry.name)) {
        continue;
      }
      runnerPaths.push(entryPath);
    }
  }

  walk(root);
  return runnerPaths;
}

function extractQuotedScriptNames(line, productPrefixes) {
  const commands = [];
  const pattern = /["'`]([a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)+)["'`]/giu;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    const scriptName = match[1];
    if (!isRiskyRunnerScriptReference(scriptName, productPrefixes)) {
      continue;
    }
    commands.push(scriptName);
  }
  return commands;
}

function isRiskyRunnerScriptReference(scriptName, productPrefixes) {
  const parts = scriptName.split(':');
  const first = parts[0];
  if (parts.length < 2) {
    return false;
  }
  return (
    productPrefixes.includes(first)
    || first === 'dev'
    || ACTION_FIRST_RUNTIME_TARGET_ALIASES.has(first)
    || RETIRED_LOCAL_FIRST_SEGMENTS.has(first)
    || RETIRED_RUNTIME_TARGET_ALIASES.has(first)
    || first === 'gateway'
    || first === 'api'
    || first === 'apis'
  );
}

// File-level exemption marker for runner scripts whose content must quote
// retired or non-standard script names (for example a one-shot migration tool
// whose rename map IS the retired-name inventory). The marker must appear in
// the file header as a comment with a short hyphenated reason token:
//   // @sdkwork-script-standard-exempt retired-name-migration
// Exempted files skip both the command-example scan and the quoted-script-name
// inventory scan: a migration tool's rename map must quote the retired names
// verbatim in both forms.
const RUNNER_SCRIPT_EXEMPTION_MARKER_PATTERN =
  /^\s*(?:\/\/|[*#]|<!--)*\s*@sdkwork-script-standard-exempt\s+([a-z0-9-]+)\s*$/iu;

// A comment-only line cannot execute anything, so a pnpm or script-name
// reference inside it is prose, not a command. The gate's own explanatory
// comments are the first casualty of scanning them: a docstring that names the
// false-positive words it exists to suppress would fail the gate it documents.
// Only whole-line comments are skipped; a trailing comment stays in scope, which
// keeps the rule conservative for real one-liners.
const RUNNER_COMMENT_ONLY_LINE_PATTERN = /^\s*(?:\/\/|\/\*|\*|#|::|REM(?:\s|$))/iu;

function getRunnerScriptExemption(text) {
  for (const line of text.split(/\r?\n/).slice(0, 20)) {
    const match = RUNNER_SCRIPT_EXEMPTION_MARKER_PATTERN.exec(line);
    if (match) return match[1];
  }
  return null;
}

function validateRunnerScriptExamples(root, productPrefixes) {
  const runnerPaths = collectRunnerScriptFiles(root);
  const issues = [];

  for (const runnerPath of runnerPaths) {
    const text = fs.readFileSync(runnerPath, 'utf8');
    const exemption = getRunnerScriptExemption(text);
    if (exemption) {
      // Diagnostics belong on stderr: stdout carries the machine-readable
      // report in --json mode, and a stray stdout line makes the fleet runner
      // fail to parse the child report.
      console.error(`runner script standard exemption: ${path.relative(root, runnerPath)} (${exemption})`);
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (RUNNER_COMMENT_ONLY_LINE_PATTERN.test(line)) continue;
      const prefix = `${path.relative(root, runnerPath)}:${index + 1}: pnpm `;
      for (const { commandText, scriptName } of extractPnpmCommandExamples(line)) {
        pushCommandNameIssues(
          scriptName,
          issues,
          productPrefixes,
          prefix,
          'application-code-prefixed command examples are forbidden',
        );
        pushRetiredCommandExampleIssues(scriptName, commandText, issues, prefix);
      }
      for (const scriptName of extractQuotedScriptNames(line, productPrefixes)) {
        if (productPrefixes.includes(scriptName.split(':')[0])) {
          pushCommandNameIssues(
            scriptName,
            issues,
            productPrefixes,
            prefix,
            'application-code-prefixed command examples are forbidden',
          );
          continue;
        }
        pushCommandNameIssues(
          scriptName,
          issues,
          productPrefixes,
          prefix,
          'application-code-prefixed command examples are forbidden',
        );
      }
    }
  }

  if (issues.length > 0) {
    fail('runner script pnpm command references are not compliant', issues);
  }

  return runnerPaths.length;
}

/**
 * Runs every validator for one repository and returns a report instead of
 * exiting on the first failure. The scope label is preserved so a fleet report
 * points at the same five scopes the single-repository path names.
 */
function auditRoot(root, applicationCodePrefixes) {
  const issues = [];
  let packagePath = path.join(root, 'package.json');
  let scriptCount = 0;
  let packageCount = 0;
  let docCount = 0;
  let jsonCount = 0;
  let runnerCount = 0;

  const scopes = [
    ['root-scripts', () => {
      const result = validateRootScripts(root, applicationCodePrefixes);
      packagePath = result.packagePath;
      scriptCount = result.scriptCount;
    }],
    ['package-local-scripts', () => { packageCount = validatePackageLocalScripts(root); }],
    ['documentation-examples', () => { docCount = validateDocumentationExamples(root, applicationCodePrefixes); }],
    ['command-json-examples', () => { jsonCount = validateJsonCommandExamples(root, applicationCodePrefixes); }],
    ['runner-script-examples', () => { runnerCount = validateRunnerScriptExamples(root, applicationCodePrefixes); }],
  ];

  for (const [scope, run] of scopes) {
    try {
      run();
    } catch (error) {
      if (!(error instanceof ScriptStandardFailure)) throw error;
      issues.push({ scope, message: error.message, details: error.details });
    }
  }

  return {
    repository: path.basename(root),
    root,
    packagePath,
    ok: issues.length === 0,
    scriptCount,
    packageCount,
    docCount,
    jsonCount,
    runnerCount,
    issues,
  };
}

function printReport(report) {
  console.error(`pnpm script standard failed: ${report.issues.length} scope(s) not compliant in ${report.repository}`);
  for (const issue of report.issues) {
    console.error(`pnpm script standard failed [${issue.scope}]: ${issue.message}`);
    for (const detail of issue.details) console.error(`- ${detail}`);
  }
}

/**
 * Fleet regression. Children reuse the --root code path, so the workspace
 * verdict cannot drift from the per-repository one. The worker pool exists for
 * the same reason as in check-module-bin.mjs: on a Windows/MSYS workspace node
 * startup dominates, and ~87 sequential spawns exceed a typical tool timeout
 * while 8-way parallel finishes in seconds.
 */
async function runWorkspace(wsRoot, limit, json, offFleet, applicationCodePrefixes) {
  if (!fs.existsSync(wsRoot)) {
    console.error(`workspace does not exist: ${wsRoot}`);
    return 2;
  }

  const repositories = [];
  const offFleetRepositories = [];
  const skippedNoPackage = [];
  for (const entry of fs.readdirSync(wsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const dir = path.join(wsRoot, entry.name);
    if (!fs.existsSync(path.join(dir, 'package.json'))) { skippedNoPackage.push(entry.name); continue; }
    if (entry.name.startsWith('sdkwork-')) repositories.push(dir);
    else { offFleetRepositories.push(entry.name); if (offFleet) repositories.push(dir); }
  }
  repositories.sort();

  const reports = new Array(repositories.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= repositories.length) return;
      reports[index] = await auditOne(repositories[index], applicationCodePrefixes);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, repositories.length) }, worker));

  const failed = reports.filter((report) => !report.ok);

  if (json) {
    console.log(JSON.stringify({
      workspace: wsRoot,
      repositories: reports.length,
      passed: reports.length - failed.length,
      failed: failed.length,
      skippedNoRootPackageJson: skippedNoPackage.sort(),
      offFleet: offFleetRepositories.sort(),
      reports,
    }, null, 2));
    return failed.length > 0 ? 1 : 0;
  }

  console.log(`\n[pnpm-script-standard] workspace ${wsRoot}`);
  console.log(`  repositories: ${reports.length}   passed: ${reports.length - failed.length}   failed: ${failed.length}`);
  if (skippedNoPackage.length > 0) {
    console.log(`  skipped (no root package.json): ${skippedNoPackage.sort().join(', ')}`);
  }
  if (offFleetRepositories.length > 0) {
    console.log(`  skipped (outside the sdkwork-* fleet convention, not audited${offFleet ? ' — audited via --include-off-fleet' : ''}): ${offFleetRepositories.sort().join(', ')}`);
  }
  for (const report of failed) {
    console.log(`  FAIL  ${report.repository}`);
    for (const issue of report.issues) {
      console.log(`          - [${issue.scope}] ${issue.message}`);
      issue.details.forEach((detail) => console.log(`            - ${detail}`));
    }
  }
  if (failed.length === 0) console.log('  every repository satisfies the pnpm script standard');
  return failed.length > 0 ? 1 : 0;
}

function auditOne(repositoryRoot, applicationCodePrefixes) {
  return new Promise((resolve) => {
    const args = [fileURLToPath(import.meta.url), '--root', repositoryRoot, '--json'];
    for (const prefix of applicationCodePrefixes) args.push('--application-code-prefix', prefix);
    execFile(process.execPath, args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        // A child that cannot even emit a report is itself a failure — never
        // a silent pass.
        resolve({
          repository: path.basename(repositoryRoot),
          root: repositoryRoot,
          ok: false,
          issues: [{
            scope: 'audit-harness',
            message: error ? String(error.message) : 'no parseable report',
            details: [],
          }],
        });
      }
    });
  });
}

async function main() {
  const parsed = parseArgs({
    options: {
      root: { type: 'string' },
      workspace: { type: 'string' },
      json: { type: 'boolean', default: false },
      concurrency: { type: 'string' },
      'include-off-fleet': { type: 'boolean', default: false },
      'application-code-prefix': { type: 'string', multiple: true },
      'product-prefix': { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    console.log(usage());
    return 0;
  }

  const applicationCodePrefixes = [
    ...(parsed.values['application-code-prefix']
      ? parsed.values['application-code-prefix'].flatMap(splitCsv)
      : []),
    ...(parsed.values['product-prefix'] ? parsed.values['product-prefix'].flatMap(splitCsv) : []),
  ];

  if (parsed.values.workspace) {
    const limit = Math.max(1, Number(parsed.values.concurrency) || 8);
    return runWorkspace(
      path.resolve(parsed.values.workspace),
      limit,
      parsed.values.json,
      parsed.values['include-off-fleet'],
      applicationCodePrefixes,
    );
  }

  const root = path.resolve(parsed.values.root || process.cwd());
  const report = auditRoot(root, applicationCodePrefixes);

  if (parsed.values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!report.ok) {
    printReport(report);
  } else {
    const relativePackage = path.relative(process.cwd(), report.packagePath) || report.packagePath;
    console.log(
      `pnpm script standard ok: ${relativePackage} (${report.scriptCount} root scripts, ${report.packageCount} package manifests scanned, ${report.docCount} docs scanned, ${report.jsonCount} command json files scanned, ${report.runnerCount} runner scripts scanned)`,
    );
  }
  return report.ok ? 0 : 1;
}

process.exitCode = await main();
