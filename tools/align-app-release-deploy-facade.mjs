#!/usr/bin/env node
/** Align profile-aware release/deploy entrypoints with the sdkwork-app facade. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WORKSPACE = path.resolve(SPECS_ROOT, '..');
const PROFILES = ['standalone', 'cloud'];
// Mirrors PNPM_SCRIPT_SPEC.md section 8. Kept identical to
// check-pnpm-script-standard.mjs and audit-pnpm-lifecycle-framework.mjs so the
// three tools cannot drift into disagreeing about what a release phase is.
const RELEASE_PHASES = new Set([
  'preflight', 'plan', 'build', 'stage', 'package', 'sign', 'notarize', 'validate', 'publish', 'submit',
]);
const DEPLOY_PHASES = new Set(['plan', 'apply', 'rollback', 'validate']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function facadeCommand(kind, phase, profile) {
  return `pnpm exec sdkwork-app ${kind}:${phase} --deployment-profile ${profile}`;
}

function releaseProfiles(workflow) {
  if (!Array.isArray(workflow?.targets) || workflow.targets.length === 0) return PROFILES;
  const profiles = new Set();
  for (const target of workflow.targets) {
    if (target?.profileBinding === 'runtime-configurable') {
      for (const profile of target.supportedDeploymentProfiles ?? PROFILES) profiles.add(profile);
    } else if (PROFILES.includes(target?.deploymentProfile)) {
      profiles.add(target.deploymentProfile);
    }
  }
  return profiles.size > 0 ? PROFILES.filter((profile) => profiles.has(profile)) : PROFILES;
}

function alignPhaseVariants(scripts, kind, phases, profiles, actions) {
  for (const phase of phases) {
    const bare = `${kind}:${phase}`;
    const phaseExposed = Object.keys(scripts).some(
      (name) => name === bare || name.startsWith(`${bare}:`),
    );
    if (!phaseExposed) continue;
    for (const profile of profiles) {
      const publicName = `${bare}:${profile}`;
      const command = facadeCommand(kind, phase, profile);
      if (scripts[publicName] === command) continue;
      if (scripts[publicName]) {
        const privateName = `_sdkwork:${publicName}`;
        scripts[privateName] ??= scripts[publicName];
        actions.push(`preserve ${publicName} as ${privateName}`);
      }
      scripts[publicName] = command;
      actions.push(`delegate ${publicName} to sdkwork-app`);
    }
  }
}

function alignSingleProfileBareReleasePhases(scripts, workflow, profiles, actions) {
  if (profiles.length !== 1) return;
  const profile = profiles[0];
  for (const phase of RELEASE_PHASES) {
    const bare = `release:${phase}`;
    const command = scripts[bare];
    const lifecycle = workflow.lifecycle?.[phase];
    if (!command || !Array.isArray(lifecycle) || lifecycle.length === 0) continue;
    const delegatedCommand = `pnpm ${bare}:${profile}`;
    if (command === delegatedCommand || String(command).includes('sdkwork-app')) continue;
    const privateName = `_sdkwork:${bare}`;
    if (!scripts[privateName]) {
      scripts[privateName] = command;
      actions.push(`preserve ${bare} as ${privateName}`);
    }
    scripts[bare] = delegatedCommand;
    actions.push(`delegate ${bare} to the single ${profile} release profile`);
  }
}

function targetDeploymentProfiles(workflow, runtimeTarget) {
  const profiles = new Set();
  for (const target of workflow.targets ?? []) {
    if (target?.runtimeTarget !== runtimeTarget) continue;
    if (target.profileBinding === 'runtime-configurable') {
      for (const profile of target.supportedDeploymentProfiles ?? PROFILES) {
        if (PROFILES.includes(profile)) profiles.add(profile);
      }
    } else if (PROFILES.includes(target.deploymentProfile)) {
      profiles.add(target.deploymentProfile);
    }
  }
  return PROFILES.filter((profile) => profiles.has(profile));
}

function alignRuntimeTargetReleasePhases(scripts, workflow, actions) {
  const runtimeTargets = new Set(
    (workflow.targets ?? []).map((target) => target?.runtimeTarget).filter(Boolean),
  );
  for (const [name, command] of Object.entries(scripts)) {
    const parts = name.split(':');
    if (parts[0] !== 'release' || !RELEASE_PHASES.has(parts[1])) continue;
    if (parts.length !== 4) continue;
    const [, phase, runtimeTarget, explicitProfile] = parts;
    if (!runtimeTargets.has(runtimeTarget)) continue;
    if (!PROFILES.includes(explicitProfile)) continue;
    const lifecycle = workflow.lifecycle?.[phase];
    if (!Array.isArray(lifecycle) || lifecycle.length === 0) continue;
    const profiles = targetDeploymentProfiles(workflow, runtimeTarget);
    if (!profiles.includes(explicitProfile)) continue;
    const delegatedCommand = `${facadeCommand('release', phase, explicitProfile)} --runtime-target ${runtimeTarget}`;
    if (command === delegatedCommand || String(command).includes('sdkwork-app')) continue;
    const privateName = `_sdkwork:${name}`;
    if (!scripts[privateName]) {
      scripts[privateName] = command;
      actions.push(`preserve ${name} as ${privateName}`);
    }
    scripts[name] = delegatedCommand;
    actions.push(`delegate ${name} to ${runtimeTarget}/${explicitProfile} workflow targets`);
  }
}

export function planReleaseDeployFacadeAlignment(repoRoot, { scope = 'all' } = {}) {
  const packagePath = path.join(repoRoot, 'package.json');
  const topologyPath = path.join(repoRoot, 'specs', 'topology.spec.json');
  if (!fs.existsSync(packagePath) || !fs.existsSync(topologyPath)) return null;
  const topology = readJson(topologyPath);
  if (topology.schemaVersion !== 5) return null;
  const manifest = readJson(packagePath);
  const topologyVersion = manifest.dependencies?.['@sdkwork/app-topology']
    ?? manifest.devDependencies?.['@sdkwork/app-topology'];
  if (topologyVersion !== 'workspace:*') return null;

  const nextManifest = structuredClone(manifest);
  nextManifest.scripts ??= {};
  const actions = [];
  const workflowPath = path.join(repoRoot, 'sdkwork.workflow.json');
  if (scope !== 'deploy' && fs.existsSync(workflowPath)) {
    const workflow = readJson(workflowPath);
    const profiles = releaseProfiles(workflow);
    alignPhaseVariants(nextManifest.scripts, 'release', RELEASE_PHASES, profiles, actions);
    alignSingleProfileBareReleasePhases(nextManifest.scripts, workflow, profiles, actions);
    alignRuntimeTargetReleasePhases(nextManifest.scripts, workflow, actions);
  }
  if (scope !== 'release' && fs.existsSync(path.join(repoRoot, 'deployments', 'deploy.yaml'))) {
    alignPhaseVariants(nextManifest.scripts, 'deploy', DEPLOY_PHASES, PROFILES, actions);
  }
  return { actions, manifest: nextManifest, packagePath };
}

function main() {
  const { values } = parseArgs({ options: {
    workspace: { type: 'string', default: DEFAULT_WORKSPACE },
    repo: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    scope: { type: 'string', default: 'all' },
  } });
  if (!['all', 'release', 'deploy'].includes(values.scope)) {
    throw new Error(`unsupported alignment scope ${values.scope}`);
  }
  const workspace = path.resolve(values.workspace);
  const repos = values.repo
    ? [path.join(workspace, values.repo)]
    : fs.readdirSync(workspace, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(workspace, entry.name));
  let total = 0;
  for (const repoRoot of repos) {
    const plan = planReleaseDeployFacadeAlignment(repoRoot, { scope: values.scope });
    if (!plan || plan.actions.length === 0) continue;
    console.log(`\n${path.basename(repoRoot)}${values['dry-run'] ? ' (dry-run)' : ''}:`);
    for (const action of plan.actions) console.log(`  - ${action}`);
    total += plan.actions.length;
    if (!values['dry-run']) writeJson(plan.packagePath, plan.manifest);
  }
  console.log(`\nTotal release/deploy facade actions: ${total}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
