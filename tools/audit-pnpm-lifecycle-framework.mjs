#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REQUIRED_SCRIPTS = ['dev', 'stop', 'build', 'test', 'check', 'verify', 'clean'];
const DELEGATED_REQUIRED_SCRIPTS = ['dev', 'stop'];
const RELEASE_PHASES = new Set([
  'preflight', 'plan', 'build', 'stage', 'package', 'validate', 'publish',
]);
const IGNORED_DIRECTORIES = new Set([
  '.git', '.pnpm-store', '.runtime', 'node_modules', 'target', 'dist', 'build',
  'vendor', 'coverage', 'tmp',
]);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
  } catch {
    return null;
  }
}

function findApplicationRoots(workspace) {
  const roots = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)
          && !entry.name.startsWith('_sdkwork-agents-local-archive')) walk(full);
      } else if (entry.name === 'sdkwork.app.config.json') {
        roots.push(directory);
      }
    }
  };
  walk(workspace);
  return [...new Set(roots)].sort();
}

function scriptNamesMatching(scripts, prefix) {
  return Object.keys(scripts).filter((name) => name.startsWith(prefix));
}

function publicReleasePhaseScripts(scripts) {
  return Object.entries(scripts).filter(([name]) => {
    const parts = name.split(':');
    return parts[0] === 'release'
      && RELEASE_PHASES.has(parts[1])
      && parts.at(-1) !== 'check';
  });
}

function delegatesReleasePhase(name, command) {
  const phase = name.split(':')[1];
  const value = String(command ?? '').trim();
  if (!value) return false;
  if (value.includes('sdkwork-app') && value.includes(` release:${phase}`)) return true;
  if (value.includes('sdkwork-workflow')) return true;
  const alias = value.match(/^pnpm\s+(?:run\s+)?(release:[^\s]+)(?:\s+--.*)?$/u)?.[1];
  return Boolean(alias && alias !== name && alias.split(':')[1] === phase);
}

function hasDelegatedLifecycleFacade(scripts) {
  const invokesParent = (name, command) => {
    const value = String(command ?? '').trim();
    return value.includes('sdkwork-app') && value.includes(` ${name}`) && /(?:^|\s)--root(?:\s|=)/u.test(value);
  };
  return invokesParent('dev', scripts['dev:standalone'])
    && invokesParent('dev', scripts['dev:cloud'])
    && invokesParent('stop', scripts.stop);
}

function waveFor(entry) {
  if (entry.foundationDependency) return 0;
  if (entry.topology && entry.workflow && entry.deployManifest) return 1;
  if (entry.topology && entry.workflow) return 2;
  if (entry.topology) return 3;
  if (entry.packageManifest) return 4;
  return 5;
}

function resolveApplicationFramework(appManifest) {
  const candidates = [
    appManifest?.runtime?.framework,
    appManifest?.app?.runtime?.framework,
    appManifest?.application?.runtime?.framework,
    appManifest?.architecture,
  ];
  const framework = candidates.find((value) => typeof value === 'string' && value.trim());
  return String(framework ?? '').trim().toLowerCase();
}

export function inspectApplicationRoot(workspace, root) {
  const relativeRoot = path.relative(workspace, root).replaceAll('\\', '/');
  const packagePath = path.join(root, 'package.json');
  const packageManifestExists = fs.existsSync(packagePath);
  const packageManifest = packageManifestExists ? readJson(packagePath) : null;
  const appManifest = readJson(path.join(root, 'sdkwork.app.config.json'));
  const nativeFramework = resolveApplicationFramework(appManifest);
  const nativeApplication = nativeFramework === 'flutter'
    || nativeFramework.includes('android-native')
    || nativeFramework.includes('ios-native')
    || nativeFramework.includes('harmony-native');
  const pnpmManaged = packageManifestExists || !nativeApplication;
  const deploymentConfig = readJson(path.join(root, 'etc', 'sdkwork.deployment.config.json'));
  const parentTopologySpec = deploymentConfig?.kind === 'sdkwork.component-deployment'
    && typeof deploymentConfig.parentTopologySpec === 'string'
    ? path.resolve(root, 'etc', deploymentConfig.parentTopologySpec)
    : null;
  const parentDeploymentConfig = deploymentConfig?.kind === 'sdkwork.component-deployment'
    && typeof deploymentConfig.parentDeploymentConfig === 'string'
    ? path.resolve(root, 'etc', deploymentConfig.parentDeploymentConfig)
    : null;
  const delegatedSurface = deploymentConfig?.kind === 'sdkwork.component-deployment';
  const topologyPath = path.join(root, 'specs', 'topology.spec.json');
  const topologyFileExists = fs.existsSync(topologyPath);
  const topologyManifest = topologyFileExists ? readJson(topologyPath) : null;
  const ownsTopology = topologyManifest?.schemaVersion === 5;
  const parentTopologyManifest = parentTopologySpec && fs.existsSync(parentTopologySpec)
    ? readJson(parentTopologySpec)
    : null;
  const parentTopologyValid = parentTopologyManifest?.schemaVersion === 5;
  const parentDeploymentValid = Boolean(parentDeploymentConfig && fs.existsSync(parentDeploymentConfig));
  const delegatesTopology = Boolean(
    parentTopologyValid && parentDeploymentValid,
  );
  const scripts = packageManifest?.scripts ?? {};
  const workflowPath = path.join(root, 'sdkwork.workflow.json');
  const workflowManifest = fs.existsSync(workflowPath) ? readJson(workflowPath) : null;
  const readmePath = path.join(root, 'README.md');
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
  const foundationDependency = /repository-kind:\s*foundation-dependency/iu.test(readme);
  const lifecycleFacadePattern = /sdkwork-app(?:\.mjs)?|@sdkwork\/app-topology\/lifecycle/iu;
  const allScriptText = Object.values(scripts).join('\n');
  const entry = {
    root: relativeRoot || '.',
    applicationId: appManifest?.app?.key ?? path.basename(root),
    foundationDependency,
    delegatedSurface,
    packageManifest: packageManifestExists,
    packageManifestValid: Boolean(packageManifest),
    pnpmManaged,
    topology: ownsTopology || delegatesTopology,
    topologyOwnership: ownsTopology
      ? 'owned'
      : delegatesTopology
        ? 'delegated'
        : topologyFileExists
          ? 'invalid'
          : 'missing',
    workflow: fs.existsSync(workflowPath),
    deployManifest: fs.existsSync(path.join(root, 'deployments', 'deploy.yaml')),
    lifecycleFacade: delegatesTopology
      ? hasDelegatedLifecycleFacade(scripts)
      : lifecycleFacadePattern.test(allScriptText),
    scripts: {
      required: Object.fromEntries(REQUIRED_SCRIPTS.map((name) => [name, typeof scripts[name] === 'string'])),
      devStandalone: typeof scripts['dev:standalone'] === 'string',
      devCloud: typeof scripts['dev:cloud'] === 'string',
      devDelegatesStandalone: /^(?:pnpm\s+(?:run\s+)?dev:standalone|node\s+.*sdkwork-app(?:\.mjs)?\s+dev(?:\s+.*)?--deployment-profile\s+standalone)$/u.test(String(scripts.dev ?? '').trim()),
      releaseCommands: scriptNamesMatching(scripts, 'release:'),
      deployCommands: scriptNamesMatching(scripts, 'deploy:'),
    },
    debt: [],
  };
  if (packageManifestExists && !packageManifest) entry.debt.push('invalid-package-manifest-json');
  if (!appManifest) entry.debt.push('invalid-app-manifest-json');
  if (pnpmManaged) {
    if (!entry.packageManifest) entry.debt.push('missing-package-manifest');
    const requiredScripts = delegatedSurface ? DELEGATED_REQUIRED_SCRIPTS : REQUIRED_SCRIPTS;
    for (const name of requiredScripts) {
      if (!entry.scripts.required[name]) entry.debt.push(`missing-script:${name}`);
    }
    if (!entry.scripts.devStandalone) entry.debt.push('missing-script:dev:standalone');
    if (!entry.scripts.devCloud) entry.debt.push('missing-script:dev:cloud');
    if (entry.scripts.required.dev && !entry.scripts.devDelegatesStandalone) {
      entry.debt.push('dev-does-not-delegate-standalone');
    }
  }
  if (scripts['_sdkwork:stop']) entry.debt.push('private-stop-bypasses-framework');
  if (topologyFileExists && !ownsTopology) entry.debt.push('invalid-topology-v5-contract');
  if (!topologyFileExists && !entry.topology && !foundationDependency) {
    entry.debt.push('missing-topology-v5-contract');
  }
  if (topologyFileExists && deploymentConfig?.parentTopologySpec) {
    entry.debt.push('competing-topology-authorities');
  }
  if (deploymentConfig?.kind === 'sdkwork.component-deployment' && !parentTopologyValid) {
    entry.debt.push('invalid-parent-topology-spec');
  }
  if (deploymentConfig?.kind === 'sdkwork.component-deployment'
    && !parentDeploymentValid) {
    entry.debt.push('invalid-parent-deployment-config');
  }
  if (!entry.workflow && (entry.scripts.releaseCommands.length > 0 || entry.scripts.deployCommands.length > 0)) {
    entry.debt.push('lifecycle-commands-without-workflow-contract');
  }
  if (entry.workflow) {
    const releaseScripts = publicReleasePhaseScripts(scripts);
    for (const [name, command] of releaseScripts) {
      if (!delegatesReleasePhase(name, command)) {
        entry.debt.push(`public-release-bypasses-workflow:${name}`);
      }
    }
    const delegatedPhases = new Set(
      releaseScripts
        .filter(([name, command]) => delegatesReleasePhase(name, command))
        .map(([name]) => name.split(':')[1]),
    );
    for (const phase of delegatedPhases) {
      if (phase === 'plan') continue;
      const lifecycle = workflowManifest?.lifecycle?.[phase];
      if (!Array.isArray(lifecycle) || lifecycle.length === 0) {
        entry.debt.push(`release-workflow-missing-phase:${phase}`);
      }
    }
  }
  if (pnpmManaged && !entry.lifecycleFacade && packageManifest) entry.debt.push('not-using-lifecycle-facade');
  entry.wave = waveFor(entry);
  return entry;
}

export function auditPnpmLifecycleWorkspace(workspace) {
  const root = path.resolve(workspace);
  const applications = findApplicationRoots(root).map((appRoot) => inspectApplicationRoot(root, appRoot));
  const counts = (predicate) => applications.filter(predicate).length;
  return {
    schemaVersion: 1,
    kind: 'sdkwork.pnpm-lifecycle-audit',
    workspace: root,
    generatedAt: new Date().toISOString(),
    summary: {
      applications: applications.length,
      packageManifests: counts((entry) => entry.packageManifest),
      pnpmApplications: counts((entry) => entry.pnpmManaged),
      topologyContracts: counts((entry) => entry.topology),
      workflowContracts: counts((entry) => entry.workflow),
      deployManifests: counts((entry) => entry.deployManifest),
      devProfilePairs: counts((entry) => entry.pnpmManaged && entry.scripts.devStandalone && entry.scripts.devCloud),
      lifecycleFacadeAdopters: counts((entry) => entry.pnpmManaged && entry.lifecycleFacade),
      debtFree: counts((entry) => entry.debt.length === 0),
    },
    applications,
  };
}

function printReport(report) {
  const summary = report.summary;
  console.log(`SDKWork package lifecycle audit: ${summary.applications} application roots`);
  console.log(`package=${summary.packageManifests} pnpm-app=${summary.pnpmApplications} topology=${summary.topologyContracts} workflow=${summary.workflowContracts} deploy=${summary.deployManifests}`);
  console.log(`dev-pair=${summary.devProfilePairs} lifecycle-facade=${summary.lifecycleFacadeAdopters} debt-free=${summary.debtFree}`);
  for (let wave = 0; wave <= 5; wave += 1) {
    const entries = report.applications.filter((entry) => entry.wave === wave);
    if (entries.length === 0) continue;
    console.log(`\nwave ${wave} (${entries.length})`);
    for (const entry of entries) {
      console.log(`- ${entry.root}: ${entry.debt.length === 0 ? 'ok' : entry.debt.join(', ')}`);
    }
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string', default: '..' },
      json: { type: 'boolean', default: false },
      'fail-on-debt': { type: 'boolean', default: false },
    },
  });
  const report = auditPnpmLifecycleWorkspace(values.workspace);
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  if (values['fail-on-debt'] && report.summary.debtFree !== report.summary.applications) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
