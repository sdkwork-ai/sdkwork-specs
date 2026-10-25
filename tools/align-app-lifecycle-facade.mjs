#!/usr/bin/env node
/**
 * Move stable application lifecycle commands behind the shared sdkwork-app facade.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WORKSPACE = path.resolve(SPECS_ROOT, '..');
const IMPLEMENTATION_PHASES = ['build', 'test', 'check', 'verify', 'clean'];
const REPLACED_PUBLIC_SCRIPTS = new Set([
  'dev', 'dev:standalone', 'dev:cloud', 'stop', ...IMPLEMENTATION_PHASES,
]);
const FACADE = 'pnpm exec sdkwork-app';
const DATABASE_ALIASES = new Set(['postgres', 'sqlite']);
const DEPLOYMENT_PROFILES = new Set(['standalone', 'cloud']);
const RETIRED_LAYOUTS = new Set(['split-services', 'unified-process']);
const RUNTIME_TARGETS = new Set([
  'android-native', 'browser', 'capacitor-android', 'capacitor-ios', 'container',
  'desktop', 'flutter-android', 'flutter-ios', 'harmony-native', 'ios-native',
  'mini-program', 'server', 'tablet-android', 'tablet-ipados', 'test-runner',
]);
const SKIP_DIRECTORIES = new Set([
  '.git', '.runtime', 'build', 'coverage', 'dist', 'node_modules', 'target', 'vendor',
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function topologyRootScriptReferences(spec, scripts) {
  const references = new Set();
  for (const profile of Object.values(spec.orchestration?.profiles ?? {})) {
    for (const process of profile.processes ?? []) {
      if (!process.package && process.script && Object.hasOwn(scripts, process.script)) {
        references.add(process.script);
      }
    }
  }
  return [...references].filter((name) => REPLACED_PUBLIC_SCRIPTS.has(name)).sort();
}

function dependencyDeclared(manifest) {
  return Boolean(
    manifest.dependencies?.['@sdkwork/app-topology']
      || manifest.devDependencies?.['@sdkwork/app-topology'],
  );
}

function normalizeDevScriptName(name) {
  const parts = name.split(':');
  if (parts[0] !== 'dev') return name;
  const normalized = parts
    .map((part) => part === 'self-hosted' ? 'standalone' : part)
    .map((part) => part === 'cloud-hosted' ? 'cloud' : part)
    .filter((part) => !RETIRED_LAYOUTS.has(part));
  if (normalized.includes('cloud')) {
    return normalized.filter((part) => !DATABASE_ALIASES.has(part)).join(':');
  }
  const runtimeTarget = normalized[1];
  if (normalized.includes('sqlite') && runtimeTarget !== 'desktop') {
    return normalized.map((part) => part === 'sqlite' ? 'postgres' : part).join(':');
  }
  return normalized.join(':');
}

function sanitizeRetiredDevCommand(command) {
  return String(command)
    .replace(/\s+--service-layout(?:=|\s+)(?:split-services|unified-process)/gu, '')
    .replace(/--hosting(?:=|\s+)self-hosted/gu, '--deployment-profile standalone')
    .replace(/--hosting(?:=|\s+)cloud-hosted/gu, '--deployment-profile cloud')
    .replaceAll(':split-services', '')
    .replaceAll(':unified-process', '')
    .replaceAll('cloud.split-services.', 'cloud.')
    .replaceAll('standalone.unified-process.', 'standalone.');
}

function facadeDevCommand(name, currentCommand, rootArg) {
  const parts = name.split(':');
  const runtimeTarget = RUNTIME_TARGETS.has(parts[1]) ? parts[1] : null;
  if (parts.length === 2 && ['browser', 'desktop'].includes(runtimeTarget)) return null;
  const standardAxes = new Set([
    'dev', runtimeTarget, ...DATABASE_ALIASES, ...DEPLOYMENT_PROFILES,
  ]);
  if (!runtimeTarget || parts.some((part) => !standardAxes.has(part))) return null;
  if (/--target\s+(?:h5|browser-only)(?:\s|$)/u.test(String(currentCommand))) return null;
  const database = parts.find((part) => DATABASE_ALIASES.has(part));
  if (database === 'sqlite') return null;
  const deploymentProfile = parts.find((part) => DEPLOYMENT_PROFILES.has(part)) ?? 'standalone';
  const rootOption = rootArg ? ` --root ${rootArg}` : '';
  return `${FACADE} dev${rootOption} --runtime-target ${runtimeTarget} --deployment-profile ${deploymentProfile}`;
}

function alignDevTargetScripts(scripts, actions, rootArg) {
  for (const name of Object.keys(scripts)) {
    if (!name.startsWith('dev:')) continue;
    const normalizedName = normalizeDevScriptName(name);
    if (normalizedName === name) continue;
    if (!Object.hasOwn(scripts, normalizedName)) {
      scripts[normalizedName] = scripts[name];
      actions.push(`rename ${name} to ${normalizedName}`);
    } else {
      actions.push(`remove retired ${name} alias`);
    }
    delete scripts[name];
  }

  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith('dev:')) continue;
    const facadeCommand = facadeDevCommand(name, command, rootArg);
    const nextCommand = facadeCommand ?? sanitizeRetiredDevCommand(command);
    if (command === nextCommand) continue;
    scripts[name] = nextCommand;
    actions.push(`align ${name} development delegation`);
  }

  for (const runtimeTarget of ['browser', 'desktop']) {
    const defaultName = `dev:${runtimeTarget}`;
    if (!scripts[defaultName]) continue;
    const postgresName = `dev:${runtimeTarget}:postgres:standalone`;
    const rootOption = rootArg ? ` --root ${rootArg}` : '';
    const postgresCommand = `${FACADE} dev${rootOption} --runtime-target ${runtimeTarget} --deployment-profile standalone`;
    if (scripts[postgresName] !== postgresCommand) {
      scripts[postgresName] = postgresCommand;
      actions.push(`define ${postgresName} facade target`);
    }
    const defaultCommand = `pnpm ${postgresName}`;
    if (scripts[defaultName] !== defaultCommand) {
      scripts[defaultName] = defaultCommand;
      actions.push(`delegate ${defaultName} to ${postgresName}`);
    }
  }
}

function alignApiAssemblyScripts(scripts, actions) {
  const commands = {
    'api:assembly:materialize': 'node ../sdkwork-specs/tools/materialize-api-assembly.mjs --root .',
    'api:assembly:validate': 'node ../sdkwork-specs/tools/validate-api-assembly.mjs --root .',
  };
  for (const [name, command] of Object.entries(commands)) {
    if (scripts[name] === command) continue;
    scripts[name] = command;
    actions.push(`delegate ${name} to the canonical sdkwork-specs tool`);
  }
}

function delegatedTestCandidates(scripts) {
  return Object.keys(scripts)
    .filter((name) => name.startsWith('test:'))
    .filter((name) => !/^test:(?:e2e|watch|ui)(?::|$)/u.test(name))
    .sort();
}

function inferDelegatedTestScript(scripts) {
  const candidates = delegatedTestCandidates(scripts);
  if (candidates.length === 0) return null;
  const aggregate = candidates.find((candidate) => {
    const command = String(scripts[candidate]);
    const leaves = candidates.filter((name) => name !== candidate);
    return leaves.length > 0 && leaves.every((name) => command.includes(name));
  });
  if (aggregate) return `pnpm run ${aggregate}`;
  return candidates.map((name) => `pnpm run ${name}`).join(' && ');
}

function alignDelegatedLocalLifecycle(scripts, actions) {
  if (!scripts.test) {
    const inferredTest = inferDelegatedTestScript(scripts);
    if (inferredTest) {
      scripts.test = inferredTest;
      actions.push('define local test aggregate from non-E2E test scripts');
    }
  }
  if (!scripts.check && scripts.typecheck && scripts.test && scripts.build) {
    scripts.check = 'pnpm typecheck && pnpm test && pnpm build';
    actions.push('define local check aggregate');
  }
  if (scripts.check && scripts.test) {
    const desiredVerify = String(scripts.check).includes('pnpm test')
      ? 'pnpm check'
      : 'pnpm check && pnpm test';
    const managedVerify = !scripts.verify
      || scripts.verify === 'pnpm check'
      || scripts.verify === 'pnpm check && pnpm test';
    if (managedVerify && scripts.verify !== desiredVerify) {
      scripts.verify = desiredVerify;
      actions.push('define local verify aggregate');
    }
  }
  if (!scripts.clean && /(?:^|&&|\s)vite\s+build(?:\s|$)/u.test(String(scripts.build ?? ''))) {
    scripts.clean = 'node -e "require(\'node:fs\').rmSync(\'dist\',{recursive:true,force:true})"';
    actions.push('define exact local dist clean');
  }
}

function relativePosix(from, to) {
  const relative = path.relative(from, to).replaceAll('\\', '/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function delegatedApplicationRoots(repoRoot) {
  const roots = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRECTORIES.has(entry.name)) continue;
      const child = path.join(directory, entry.name);
      if (fs.existsSync(path.join(child, 'agent.app.config.json'))
        && fs.existsSync(path.join(child, 'package.json'))
        && fs.existsSync(path.join(child, 'etc', 'sdkwork.deployment.config.json'))) {
        roots.push(child);
      }
      walk(child);
    }
  }
  walk(repoRoot);
  return roots.sort();
}

export function planDelegatedLifecycleAlignment(appRoot) {
  const packagePath = path.join(appRoot, 'package.json');
  const deploymentConfigPath = path.join(appRoot, 'etc', 'sdkwork.deployment.config.json');
  if (!fs.existsSync(packagePath) || !fs.existsSync(deploymentConfigPath)) {
    return { eligible: false, reasons: ['missing package.json or component deployment config'] };
  }
  const manifest = readJson(packagePath);
  const deploymentConfig = readJson(deploymentConfigPath);
  const reasons = [];
  if (deploymentConfig.kind !== 'sdkwork.component-deployment') {
    reasons.push(`deployment config kind is ${deploymentConfig.kind ?? 'missing'}`);
  }
  if (fs.existsSync(path.join(appRoot, 'specs', 'topology.spec.json'))) {
    reasons.push('delegated application also owns a topology spec');
  }
  const etcRoot = path.dirname(deploymentConfigPath);
  const parentTopologyPath = typeof deploymentConfig.parentTopologySpec === 'string'
    ? path.resolve(etcRoot, deploymentConfig.parentTopologySpec)
    : null;
  const parentDeploymentPath = typeof deploymentConfig.parentDeploymentConfig === 'string'
    ? path.resolve(etcRoot, deploymentConfig.parentDeploymentConfig)
    : null;
  if (!parentTopologyPath || !fs.existsSync(parentTopologyPath)) {
    reasons.push('missing valid parentTopologySpec');
  }
  if (!parentDeploymentPath || !fs.existsSync(parentDeploymentPath)) {
    reasons.push('missing valid parentDeploymentConfig');
  }
  const parentRoot = parentDeploymentPath
    ? path.dirname(path.dirname(parentDeploymentPath))
    : null;
  if (parentRoot && parentTopologyPath
    && path.resolve(path.dirname(path.dirname(parentTopologyPath))) !== path.resolve(parentRoot)) {
    reasons.push('parent deployment and topology authorities resolve to different roots');
  }
  const parentPackagePath = parentRoot ? path.join(parentRoot, 'package.json') : null;
  const parentManifest = parentPackagePath && fs.existsSync(parentPackagePath)
    ? readJson(parentPackagePath)
    : null;
  if (!parentManifest || !dependencyDeclared(parentManifest)) {
    reasons.push('parent root is missing @sdkwork/app-topology dependency');
  }
  const parentTopology = parentTopologyPath && fs.existsSync(parentTopologyPath)
    ? readJson(parentTopologyPath)
    : null;
  if (parentTopology?.schemaVersion !== 5) reasons.push('parent topology schemaVersion is not 5');
  if (reasons.length > 0) return { eligible: false, reasons };

  const next = structuredClone(manifest);
  next.scripts ??= {};
  const rootArg = relativePosix(appRoot, parentRoot);
  const publicScripts = {
    dev: 'pnpm dev:standalone',
    'dev:standalone': `${FACADE} dev --root ${rootArg} --deployment-profile standalone`,
    'dev:cloud': `${FACADE} dev --root ${rootArg} --deployment-profile cloud`,
    stop: `${FACADE} stop --root ${rootArg}`,
  };
  const actions = [];
  for (const [name, value] of Object.entries(publicScripts)) {
    if (next.scripts[name] === value) continue;
    next.scripts[name] = value;
    actions.push(`delegate ${name} to parent sdkwork-app`);
  }
  alignDevTargetScripts(next.scripts, actions, rootArg);
  alignDelegatedLocalLifecycle(next.scripts, actions);
  return { eligible: true, packagePath, manifest: next, actions, parentRoot };
}

export function planLifecycleAlignment(repoRoot) {
  const packagePath = path.join(repoRoot, 'package.json');
  const topologyPath = path.join(repoRoot, 'specs', 'topology.spec.json');
  if (!fs.existsSync(packagePath) || !fs.existsSync(topologyPath)) {
    return { eligible: false, reasons: ['missing package.json or specs/topology.spec.json'] };
  }
  const manifest = readJson(packagePath);
  const topology = readJson(topologyPath);
  const scripts = manifest.scripts ?? {};
  const reasons = [];
  if (topology.schemaVersion !== 5) reasons.push('topology schemaVersion is not 5');
  if (!dependencyDeclared(manifest)) reasons.push('missing @sdkwork/app-topology dependency');
  const missingPhases = IMPLEMENTATION_PHASES.filter(
    (phase) => !scripts[phase] && !scripts[`_sdkwork:${phase}`],
  );
  if (missingPhases.length > 0) reasons.push(`missing lifecycle implementations: ${missingPhases.join(', ')}`);
  const rootReferences = topologyRootScriptReferences(topology, scripts);
  if (rootReferences.length > 0) {
    reasons.push(`topology references public lifecycle scripts: ${rootReferences.join(', ')}`);
  }
  if (reasons.length > 0) return { eligible: false, reasons };

  const next = structuredClone(manifest);
  next.scripts ??= {};
  const actions = [];
  for (const phase of IMPLEMENTATION_PHASES) {
    const privateName = `_sdkwork:${phase}`;
    if (!next.scripts[privateName]) {
      next.scripts[privateName] = next.scripts[phase];
      actions.push(`preserve ${phase} as ${privateName}`);
    }
    const publicValue = `${FACADE} ${phase}`;
    if (next.scripts[phase] !== publicValue) {
      next.scripts[phase] = publicValue;
      actions.push(`delegate ${phase} to sdkwork-app`);
    }
  }
  const publicScripts = {
    dev: 'pnpm dev:standalone',
    'dev:standalone': `${FACADE} dev --deployment-profile standalone`,
    'dev:cloud': `${FACADE} dev --deployment-profile cloud`,
    stop: `${FACADE} stop`,
  };
  for (const [name, value] of Object.entries(publicScripts)) {
    if (next.scripts[name] === value) continue;
    next.scripts[name] = value;
    actions.push(`delegate ${name} to sdkwork-app`);
  }
  alignDevTargetScripts(next.scripts, actions);
  alignApiAssemblyScripts(next.scripts, actions);
  return { eligible: true, manifest: next, actions };
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string', default: DEFAULT_WORKSPACE },
      repo: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/align-app-lifecycle-facade.mjs [--workspace <path>] [--repo <name>] [--dry-run]');
    return;
  }
  const workspace = path.resolve(values.workspace);
  const repos = values.repo
    ? [path.join(workspace, values.repo)]
    : fs.readdirSync(workspace, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(workspace, entry.name));
  let totalActions = 0;
  let eligibleRepos = 0;
  let eligibleDelegatedApps = 0;
  for (const repoRoot of repos) {
    const plan = planLifecycleAlignment(repoRoot);
    if (!plan.eligible) {
      if (values.repo || fs.existsSync(path.join(repoRoot, 'specs', 'topology.spec.json'))) {
        console.log(`${path.basename(repoRoot)} skipped: ${plan.reasons.join('; ')}`);
      }
    } else {
      eligibleRepos += 1;
      if (plan.actions.length > 0) {
        console.log(`\n${path.basename(repoRoot)}${values['dry-run'] ? ' (dry-run)' : ''}:`);
        for (const action of plan.actions) console.log(`  - ${action}`);
        totalActions += plan.actions.length;
        if (!values['dry-run']) writeJson(path.join(repoRoot, 'package.json'), plan.manifest);
      }
    }

    for (const appRoot of delegatedApplicationRoots(repoRoot)) {
      const delegatedPlan = planDelegatedLifecycleAlignment(appRoot);
      const label = path.relative(workspace, appRoot).replaceAll('\\', '/');
      if (!delegatedPlan.eligible) {
        console.log(`${label} skipped: ${delegatedPlan.reasons.join('; ')}`);
        continue;
      }
      eligibleDelegatedApps += 1;
      if (delegatedPlan.actions.length === 0) continue;
      console.log(`\n${label}${values['dry-run'] ? ' (dry-run)' : ''}:`);
      for (const action of delegatedPlan.actions) console.log(`  - ${action}`);
      totalActions += delegatedPlan.actions.length;
      if (!values['dry-run']) writeJson(delegatedPlan.packagePath, delegatedPlan.manifest);
    }
  }
  console.log(`\nEligible repositories: ${eligibleRepos}`);
  console.log(`Eligible delegated applications: ${eligibleDelegatedApps}`);
  console.log(`Total lifecycle actions: ${totalActions}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
