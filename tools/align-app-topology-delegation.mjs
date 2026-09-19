#!/usr/bin/env node
/** Align nested application roots with their enclosing repository topology authority. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WORKSPACE = path.resolve(SPECS_ROOT, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build', 'vendor', '.runtime']);
const COMPONENT_DEPLOYMENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'application',
  'parentDeploymentConfig',
  'parentTopologySpec',
]);
// `authority` belongs to the retired `sdkwork.deployment-reference` envelope.
const RETIRED_REFERENCE_KEYS = new Set(['authority']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function relativePosix(from, to) {
  const relative = path.relative(from, to).replaceAll('\\', '/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function nestedApplicationRoots(repoRoot) {
  const roots = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const child = path.join(directory, entry.name);
      if (fs.existsSync(path.join(child, 'sdkwork.app.config.json'))) roots.push(child);
      walk(child);
    }
  }
  walk(repoRoot);
  return roots;
}

function runtimeConfigName(etcRoot, current) {
  if (typeof current?.runtimeConfig === 'string') return current.runtimeConfig;
  if (!fs.existsSync(etcRoot)) return undefined;
  const candidates = fs.readdirSync(etcRoot)
    .filter((name) => name.endsWith('.runtime.json'))
    .sort();
  return candidates.length === 1 ? candidates[0] : undefined;
}

function componentDeploymentReadme(config) {
  return [
    '# Component Deployment',
    '',
    'This application surface shares the enclosing application deployment unit.',
    `Deployment profiles are owned by \`${config.parentDeploymentConfig}\`; runtime process topology is owned by \`${config.parentTopologySpec}\`.`,
    'Surface-local build and test commands stay in this application root.',
    '',
  ].join('\n');
}

export function planTopologyDelegation(repoRoot, { migrateRetiredReferences = false } = {}) {
  const topologyPath = path.join(repoRoot, 'specs', 'topology.spec.json');
  if (!fs.existsSync(topologyPath)) return [];
  const plans = [];
  for (const appRoot of nestedApplicationRoots(repoRoot)) {
    const etcRoot = path.join(appRoot, 'etc');
    const configPath = path.join(etcRoot, 'sdkwork.deployment.config.json');
    const current = fs.existsSync(configPath) ? readJson(configPath) : null;
    if (fs.existsSync(path.join(appRoot, 'specs', 'topology.spec.json'))) {
      // A root that owns its own topology is self-authoritative, so delegating it would create
      // the contradictory state `check-source-config-standard.mjs` rejects. Reporting the
      // combination is the only safe action: a stale duplicate and a real authority are
      // indistinguishable from the enclosing repository's point of view.
      if (typeof current?.parentTopologySpec === 'string') {
        plans.push({
          actions: [],
          appRoot,
          configPath,
          conflict: 'specs/topology.spec.json competes with the declared parentTopologySpec;'
            + ' remove the competing topology or the delegation',
        });
      }
      continue;
    }
    const appManifest = readJson(path.join(appRoot, 'sdkwork.app.config.json'));
    const isRetiredReference = current?.kind === 'sdkwork.deployment-reference';
    if (
      current
      && current.kind !== 'sdkwork.component-deployment'
      && !(isRetiredReference && migrateRetiredReferences)
    ) {
      plans.push({
        actions: [],
        appRoot,
        conflict: `${path.relative(repoRoot, configPath)} declares ${current.kind ?? 'an unknown kind'}`,
      });
      continue;
    }
    const parentDeploymentPath = path.join(repoRoot, 'etc', 'sdkwork.deployment.config.json');
    if (!fs.existsSync(parentDeploymentPath)) {
      plans.push({
        actions: [],
        appRoot,
        configPath,
        conflict: 'enclosing application is missing etc/sdkwork.deployment.config.json',
      });
      continue;
    }
    const next = {
      schemaVersion: 1,
      kind: 'sdkwork.component-deployment',
      application: appManifest?.app?.key ?? path.basename(appRoot),
      parentDeploymentConfig: relativePosix(etcRoot, parentDeploymentPath),
      parentTopologySpec: relativePosix(etcRoot, topologyPath),
      ...(runtimeConfigName(etcRoot, current)
        ? { runtimeConfig: runtimeConfigName(etcRoot, current) }
        : {}),
      // Keys this aligner does not own are preserved: `SOURCE_CONFIG_SPEC.md` fixes the required
      // envelope, not an exhaustive schema, so a surface may carry extra materialization or
      // profile-source declarations that a replace-style rewrite would silently drop.
      ...Object.fromEntries(
        Object.entries(current ?? {}).filter(([key]) => (
          !COMPONENT_DEPLOYMENT_KEYS.has(key)
          && key !== 'runtimeConfig'
          && !(isRetiredReference && RETIRED_REFERENCE_KEYS.has(key))
        )),
      ),
    };
    const configNeedsWrite = JSON.stringify(current) !== JSON.stringify(next);
    const readmePath = path.join(etcRoot, 'README.md');
    const readmeNeedsWrite = !fs.existsSync(readmePath);
    const actions = [
      ...(configNeedsWrite ? [`write ${path.relative(repoRoot, configPath).replaceAll('\\', '/')}`] : []),
      ...(readmeNeedsWrite ? [`write ${path.relative(repoRoot, readmePath).replaceAll('\\', '/')}`] : []),
    ];
    plans.push({
      actions,
      appRoot,
      configPath,
      config: next,
      configNeedsWrite,
      readmePath,
      readme: componentDeploymentReadme(next),
      readmeNeedsWrite,
      conflict: null,
    });
  }
  return plans;
}

function main() {
  const { values } = parseArgs({ options: {
    workspace: { type: 'string', default: DEFAULT_WORKSPACE },
    repo: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'migrate-retired-references': { type: 'boolean', default: false },
  } });
  const workspace = path.resolve(values.workspace);
  const repos = values.repo
    ? [path.join(workspace, values.repo)]
    : fs.readdirSync(workspace, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(workspace, entry.name));
  let total = 0;
  let conflicts = 0;
  for (const repoRoot of repos) {
    for (const plan of planTopologyDelegation(repoRoot, {
      migrateRetiredReferences: values['migrate-retired-references'],
    })) {
      if (plan.conflict) {
        console.error(`[conflict] ${path.relative(workspace, plan.appRoot).replaceAll('\\', '/')}: ${plan.conflict}`);
        conflicts += 1;
        continue;
      }
      if (plan.actions.length === 0) continue;
      for (const action of plan.actions) console.log(`${values['dry-run'] ? '[dry-run] ' : ''}${path.basename(repoRoot)}: ${action}`);
      total += plan.actions.length;
      if (!values['dry-run']) {
        if (plan.configNeedsWrite) writeJson(plan.configPath, plan.config);
        if (plan.readmeNeedsWrite) fs.writeFileSync(plan.readmePath, plan.readme, 'utf8');
      }
    }
  }
  console.log(`Topology delegation actions: ${total}; conflicts: ${conflicts}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
