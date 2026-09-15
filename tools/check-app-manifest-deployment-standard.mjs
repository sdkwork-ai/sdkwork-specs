#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEPLOYMENT_PROFILES = new Set(['standalone', 'cloud']);
const RUNTIME_TARGETS = new Set([
  'browser', 'desktop', 'tablet-ipados', 'tablet-android',
  'capacitor-ios', 'capacitor-android', 'flutter-ios', 'flutter-android',
  'android-native', 'ios-native', 'harmony-native', 'mini-program',
  'server', 'container', 'test-runner',
]);
const CLIENT_TARGETS = new Set([
  'browser', 'desktop', 'tablet-ipados', 'tablet-android',
  'capacitor-ios', 'capacitor-android', 'flutter-ios', 'flutter-android',
  'android-native', 'ios-native', 'harmony-native', 'mini-program',
]);
const SOURCE_TYPES = new Set([
  'GIT_REPOSITORY', 'BINARY_URL', 'APP_STORE', 'CONTAINER_IMAGE',
  'MINI_PROGRAM', 'WEB_URL', 'SCRIPT',
]);
const CLIENT_ARCHITECTURES = new Set([
  'pc-web', 'h5', 'capacitor', 'flutter', 'tauri', 'electron',
  'android-native', 'ios-native', 'harmony-native', 'mini-program',
]);
const TARGET_PLATFORM_PATTERN = /^(?:web|h5|h5-weixin|windows|macos|linux|ios|ipados|android|android-tablet|harmony|mp-[a-z0-9-]+)$/u;
const TARGET_RULES = {
  browser: { platforms: new Set(['web', 'h5', 'h5-weixin']), architectures: new Set(['pc-web', 'h5']) },
  desktop: { platforms: new Set(['windows', 'macos', 'linux']), architectures: new Set(['tauri', 'electron', 'capacitor']) },
  'tablet-ipados': { platforms: new Set(['ipados']), architectures: new Set(['tauri', 'ios-native']) },
  'tablet-android': { platforms: new Set(['android-tablet']), architectures: new Set(['tauri', 'android-native']) },
  'capacitor-ios': { platforms: new Set(['ios']), architectures: new Set(['capacitor']) },
  'capacitor-android': { platforms: new Set(['android']), architectures: new Set(['capacitor']) },
  'flutter-ios': { platforms: new Set(['ios']), architectures: new Set(['flutter']) },
  'flutter-android': { platforms: new Set(['android']), architectures: new Set(['flutter']) },
  'android-native': { platforms: new Set(['android']), architectures: new Set(['android-native']) },
  'ios-native': { platforms: new Set(['ios']), architectures: new Set(['ios-native']) },
  'harmony-native': { platforms: new Set(['harmony']), architectures: new Set(['harmony-native']) },
  'mini-program': { platformPattern: /^mp-[a-z0-9-]+$/u, architectures: new Set(['mini-program']) },
};

function uniqueStrings(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === 'string')
    && new Set(value).size === value.length;
}

export function validateAppManifestDeployment(manifest, label = 'sdkwork.app.config.json') {
  const issues = [];
  const runtime = manifest?.runtime ?? {};
  const supported = runtime.supportedDeploymentProfiles;
  if (!uniqueStrings(supported) || supported.some((item) => !DEPLOYMENT_PROFILES.has(item))) {
    issues.push(`${label}: runtime.supportedDeploymentProfiles must be a non-empty unique subset of standalone, cloud`);
  }
  if (!DEPLOYMENT_PROFILES.has(runtime.defaultDeploymentProfile)
    || !supported?.includes(runtime.defaultDeploymentProfile)) {
    issues.push(`${label}: runtime.defaultDeploymentProfile must be supported`);
  }

  const packages = manifest?.artifacts?.installConfig?.packages ?? [];
  if (!Array.isArray(packages)) {
    issues.push(`${label}: artifacts.installConfig.packages must be an array`);
    return issues;
  }

  const declaredProfiles = new Set();
  const enabledProfiles = new Set();
  for (const [index, item] of packages.entries()) {
    const pointer = `${label}: artifacts.installConfig.packages[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push(`${pointer} must be an object`);
      continue;
    }
    if (!RUNTIME_TARGETS.has(item.runtimeTarget)) {
      issues.push(`${pointer}.runtimeTarget must use the canonical runtime target vocabulary`);
    }
    if (item.sourceType && !SOURCE_TYPES.has(item.sourceType)) {
      issues.push(`${pointer}.sourceType "${item.sourceType}" is not canonical`);
    }
    if (CLIENT_TARGETS.has(item.runtimeTarget)) {
      if (!item.targetPlatform || !TARGET_PLATFORM_PATTERN.test(item.targetPlatform)) {
        issues.push(`${pointer}.targetPlatform is required and must be canonical for client targets`);
      }
      if (!item.clientArchitecture || !CLIENT_ARCHITECTURES.has(item.clientArchitecture)) {
        issues.push(`${pointer}.clientArchitecture is required and must be canonical for client targets`);
      }
      const rule = TARGET_RULES[item.runtimeTarget];
      if (rule?.platforms && item.targetPlatform && !rule.platforms.has(item.targetPlatform)) {
        issues.push(`${pointer}.targetPlatform contradicts runtimeTarget ${item.runtimeTarget}`);
      }
      if (rule?.platformPattern && item.targetPlatform && !rule.platformPattern.test(item.targetPlatform)) {
        issues.push(`${pointer}.targetPlatform contradicts runtimeTarget ${item.runtimeTarget}`);
      }
      if (rule?.architectures && item.clientArchitecture && !rule.architectures.has(item.clientArchitecture)) {
        issues.push(`${pointer}.clientArchitecture contradicts runtimeTarget ${item.runtimeTarget}`);
      }
    }

    const inferredBinding = item.profileBinding
      ?? (item.deploymentProfile ? 'fixed' : undefined);
    if (!['fixed', 'runtime-configurable', 'non-deployable'].includes(inferredBinding)) {
      issues.push(`${pointer}.profileBinding must be fixed, runtime-configurable, or non-deployable`);
      continue;
    }

    if (inferredBinding === 'non-deployable') {
      if (item.runtimeTarget !== 'test-runner') {
        issues.push(`${pointer}: non-deployable binding is limited to test-runner artifacts`);
      }
      if (item.deploymentProfile !== undefined
        || item.supportedDeploymentProfiles !== undefined
        || item.defaultDeploymentProfile !== undefined) {
        issues.push(`${pointer}: non-deployable binding forbids deployment profile fields`);
      }
      if (typeof item.id !== 'string' || !item.id.split('-').includes('test')) {
        issues.push(`${pointer}.id must contain the test package profile token`);
      }
      continue;
    }

    if (inferredBinding === 'fixed') {
      if (!DEPLOYMENT_PROFILES.has(item.deploymentProfile)) {
        issues.push(`${pointer}.deploymentProfile must be standalone or cloud for fixed binding`);
      } else if (!supported?.includes(item.deploymentProfile)) {
        issues.push(`${pointer}.deploymentProfile must be included in runtime.supportedDeploymentProfiles`);
      }
      if (DEPLOYMENT_PROFILES.has(item.deploymentProfile)) {
        if (item.enabled !== false || item.metadata?.releaseBuildDeferred === true) {
          declaredProfiles.add(item.deploymentProfile);
        }
        if (item.enabled !== false) enabledProfiles.add(item.deploymentProfile);
      }
      if (item.supportedDeploymentProfiles !== undefined || item.defaultDeploymentProfile !== undefined) {
        issues.push(`${pointer}: fixed binding forbids supported/default package profile fields`);
      }
      if (typeof item.id === 'string' && item.deploymentProfile
        && !item.id.split('-').includes(item.deploymentProfile)) {
        issues.push(`${pointer}.id must include fixed deployment profile ${item.deploymentProfile}`);
      }
      continue;
    }

    if (!CLIENT_TARGETS.has(item.runtimeTarget)) {
      issues.push(`${pointer}: runtime-configurable binding is limited to client runtime targets`);
    }
    if (item.deploymentProfile !== undefined) {
      issues.push(`${pointer}: runtime-configurable binding forbids deploymentProfile`);
    }
    const itemSupported = item.supportedDeploymentProfiles;
    if (!uniqueStrings(itemSupported)
      || itemSupported.length !== 2
      || itemSupported.some((profile) => !DEPLOYMENT_PROFILES.has(profile))) {
      issues.push(`${pointer}.supportedDeploymentProfiles must contain exactly standalone and cloud`);
    } else if (itemSupported.some((profile) => !supported?.includes(profile))) {
      issues.push(`${pointer}.supportedDeploymentProfiles must be included in runtime support`);
    }
    if (!itemSupported?.includes(item.defaultDeploymentProfile)) {
      issues.push(`${pointer}.defaultDeploymentProfile must be supported by the package`);
    }
    if (Array.isArray(itemSupported)) {
      for (const profile of itemSupported) {
        if (!DEPLOYMENT_PROFILES.has(profile)) continue;
        if (item.enabled !== false || item.metadata?.releaseBuildDeferred === true) {
          declaredProfiles.add(profile);
        }
        if (item.enabled !== false) enabledProfiles.add(profile);
      }
    }
    if (typeof item.id !== 'string' || !item.id.split('-').includes('dual')) {
      issues.push(`${pointer}.id must contain the dual artifact-binding token`);
    }
  }
  if (packages.length > 0 && Array.isArray(supported)) {
    const activePublication = manifest?.publish?.status === 'ACTIVE';
    const coveredProfiles = activePublication ? enabledProfiles : declaredProfiles;
    for (const profile of supported) {
      if (!coveredProfiles.has(profile)) {
        const qualifier = activePublication ? 'enabled ' : '';
        issues.push(`${label}: no ${qualifier}package covers deployment profile ${profile}`);
      }
    }
  }
  return issues;
}

export function validateAppManifestWorkflowAlignment(
  manifest,
  workflow,
  manifestLabel = 'sdkwork.app.config.json',
  workflowLabel = 'sdkwork.workflow.json',
) {
  const issues = [];
  const packages = new Map(
    (manifest?.artifacts?.installConfig?.packages ?? [])
      .filter((item) => item && typeof item.id === 'string')
      .map((item) => [item.id, item]),
  );
  const targets = new Map();
  for (const target of workflow?.targets ?? []) {
    if (!target || !Array.isArray(target.formats) || target.formats.length !== 1) continue;
    const packageId = target.packageId ?? target.id;
    if (typeof packageId === 'string') targets.set(packageId, target);
  }
  const currentNotes = (manifest?.release?.notes ?? []).filter((note) => note?.current === true);
  for (const note of currentNotes) {
    for (const packageId of note.packageIds ?? []) {
      const packageEntry = packages.get(packageId);
      if (!packageEntry || packageEntry.enabled === false) continue;
      const target = targets.get(packageId);
      if (!target) {
        issues.push(
          `${manifestLabel}: current release package ${packageId} has no exact single-format target in ${workflowLabel}`,
        );
        continue;
      }
      for (const field of ['runtimeTarget', 'deploymentProfile', 'architecture']) {
        if (packageEntry[field] !== undefined && target[field] !== packageEntry[field]) {
          issues.push(
            `${workflowLabel}: target ${packageId}.${field} must equal ${manifestLabel} package value ${packageEntry[field]}`,
          );
        }
      }
    }
  }
  return issues;
}

function main() {
  const parsed = parseArgs({
    options: {
      root: { type: 'string' },
      config: { type: 'string' },
      'strict-release-targets': { type: 'boolean', default: false },
      workflow: { type: 'string' },
    },
    allowPositionals: false,
  });
  const root = path.resolve(parsed.values.root ?? '.');
  const configPath = path.resolve(root, parsed.values.config ?? 'sdkwork.app.config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`app manifest deployment check failed: missing ${configPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const manifestLabel = path.relative(root, configPath);
  const issues = validateAppManifestDeployment(manifest, manifestLabel);
  if (parsed.values['strict-release-targets']) {
    const workflowPath = path.resolve(root, parsed.values.workflow ?? 'sdkwork.workflow.json');
    if (!fs.existsSync(workflowPath)) {
      issues.push(`${manifestLabel}: strict release target alignment requires ${path.relative(root, workflowPath)}`);
    } else {
      const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
      issues.push(...validateAppManifestWorkflowAlignment(
        manifest,
        workflow,
        manifestLabel,
        path.relative(root, workflowPath),
      ));
    }
  }
  if (issues.length > 0) {
    console.error('app manifest deployment check failed:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  console.log(`app manifest deployment standard ok: ${configPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
