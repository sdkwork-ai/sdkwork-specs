#!/usr/bin/env node

/**
 * Canonical Adaptive Web PC/H5 Vite production build runner.
 * Authority: PNPM_SCRIPT_SPEC.md §4.2, FRONTEND_CODE_SPEC.md §7.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  LIFECYCLE_ENVIRONMENTS,
  resolveBrowserDistOutDir,
} from './browser-dist-layout.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENVIRONMENT_ALIASES = Object.freeze({
  dev: 'development',
  test: 'test',
  staging: 'staging',
  prod: 'production',
});
const CLIENT_ARCHITECTURES = new Set(['pc', 'h5']);
const DEPLOYMENT_PROFILES = new Set(['standalone', 'cloud']);
const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.web.ts',
  'vite.config.web.mjs',
  'vite.config.browser.ts',
  'vite.config.browser.mjs',
];

export function normalizeEnvironmentAlias(value) {
  const token = String(value ?? '').trim();
  if (LIFECYCLE_ENVIRONMENTS.includes(token)) {
    return token;
  }
  const normalized = ENVIRONMENT_ALIASES[token];
  if (!normalized) {
    throw new Error(
      `environment must be one of ${Object.keys(ENVIRONMENT_ALIASES).join(', ')} or ${LIFECYCLE_ENVIRONMENTS.join(', ')}`,
    );
  }
  return normalized;
}

const DEFAULT_VITE_CONFIG_NAMES = new Set([
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.cjs',
]);

export function findViteConfig(appRoot) {
  for (const name of VITE_CONFIG_NAMES) {
    const candidate = path.join(appRoot, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  const packagesDir = path.join(appRoot, 'packages');
  if (!existsSync(packagesDir)) {
    return null;
  }
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    for (const name of VITE_CONFIG_NAMES) {
      const candidate = path.join(packagesDir, entry.name, name);
      if (existsSync(candidate)) {
        const source = readFileSync(candidate, 'utf8');
        if (/\blib\s*:\s*\{/u.test(source)) {
          continue;
        }
        return candidate;
      }
    }
  }
  return null;
}

export function discoverBrowserAppRoots(repositoryRoot) {
  const appsDir = path.join(repositoryRoot, 'apps');
  if (!existsSync(appsDir)) {
    return [];
  }
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith('sdkwork-') && existsSync(path.join(appsDir, name, 'package.json')))
    .map((name) => ({
      architecture: name.endsWith('-h5') ? 'h5' : name.endsWith('-pc') ? 'pc' : null,
      name,
      root: path.join(appsDir, name),
      relative: `apps/${name}`,
    }))
    .filter((entry) => entry.architecture && findViteConfig(entry.root));
}

export function resolveBrowserAppRoot({ repositoryRoot, architecture }) {
  const matches = discoverBrowserAppRoots(repositoryRoot).filter(
    (entry) => entry.architecture === architecture,
  );
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length === 0) {
    throw new Error(`no ${architecture} browser app root with Vite config under ${repositoryRoot}/apps`);
  }
  throw new Error(`multiple ${architecture} browser app roots under ${repositoryRoot}/apps`);
}

function resolveSpecsRelativeTool(repositoryRoot, toolName) {
  const candidates = [
    path.join(repositoryRoot, 'sdkwork-specs', 'tools', toolName),
    path.join(repositoryRoot, '..', 'sdkwork-specs', 'tools', toolName),
    path.join(SPECS_ROOT, 'tools', toolName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`unable to locate ${toolName}`);
}

function runCommand(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 'unknown'}`);
  }
}

function runNodeScript(scriptPath, args, cwd) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} failed with exit ${result.status ?? 'unknown'}`);
  }
}

function maybeRunLocalScript(appRoot, relativeScript, args) {
  const scriptPath = path.join(appRoot, relativeScript);
  if (!existsSync(scriptPath)) {
    return;
  }
  runNodeScript(scriptPath, args, appRoot);
}

export function buildBrowserClient(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? options.root ?? '.');
  const architecture = String(options.architecture ?? '').trim();
  const environment = normalizeEnvironmentAlias(options.environment ?? 'prod');
  const deploymentProfile = String(options.deploymentProfile ?? 'standalone').trim();
  const dryRun = options.dryRun === true;

  if (!CLIENT_ARCHITECTURES.has(architecture)) {
    throw new Error('architecture must be pc or h5');
  }
  if (!DEPLOYMENT_PROFILES.has(deploymentProfile)) {
    throw new Error('deploymentProfile must be standalone or cloud');
  }

  const app = resolveBrowserAppRoot({ repositoryRoot, architecture });
  const viteMode = `${deploymentProfile}.${environment}`;
  const outDir = resolveBrowserDistOutDir(environment, deploymentProfile);
  const buildEnv = {
    ...process.env,
    SDKWORK_DEPLOYMENT_PROFILE: deploymentProfile,
    SDKWORK_ENVIRONMENT: environment,
    SDKWORK_PROFILE_ID: viteMode,
  };

  const plan = {
    appRoot: app.root,
    architecture,
    deploymentProfile,
    environment,
    outDir,
    viteMode,
  };

  if (dryRun) {
    return plan;
  }

  maybeRunLocalScript(app.root, 'scripts/verify-build-sources.mjs', []);
  maybeRunLocalScript(app.root, 'scripts/materialize-runtime-env.mjs', [
    '--deployment-profile',
    deploymentProfile,
    '--environment',
    environment,
  ]);

  const tsconfigPath = path.join(app.root, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    runCommand('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'], app.root, buildEnv);
  }

  const viteConfig = findViteConfig(app.root);
  const viteArgs = ['exec', 'vite', 'build', '--mode', viteMode];
  if (viteConfig) {
    const configName = path.basename(viteConfig);
    if (!DEFAULT_VITE_CONFIG_NAMES.has(configName)) {
      viteArgs.push('--config', path.relative(app.root, viteConfig).replaceAll('\\', '/'));
    }
  }
  runCommand('pnpm', viteArgs, app.root, buildEnv);

  const outputIndex = path.join(app.root, outDir, 'index.html');
  if (!existsSync(outputIndex)) {
    throw new Error(`build completed but ${outputIndex} is missing`);
  }

  console.log(
    `[build-browser-client] ${app.relative} ${architecture} ${deploymentProfile}.${environment} -> ${outDir}/`,
  );
  return plan;
}

function inferArchitectureFromAppRoot(appRoot) {
  const base = path.basename(appRoot);
  if (base.endsWith('-h5')) {
    return 'h5';
  }
  if (base.endsWith('-pc')) {
    return 'pc';
  }
  throw new Error(`unable to infer browser architecture from ${base}`);
}

export function buildBrowserClientFromAppSurface(options) {
  const appRoot = path.resolve(options.appRoot ?? options.root ?? '.');
  const architecture = String(options.architecture ?? inferArchitectureFromAppRoot(appRoot)).trim();
  return buildBrowserClient({
    architecture,
    deploymentProfile: options.deploymentProfile,
    dryRun: options.dryRun,
    environment: options.environment,
    repositoryRoot: path.resolve(options.repositoryRoot ?? path.join(appRoot, '..', '..')),
  });
}

export const STANDARD_ENVIRONMENT_ALIASES = Object.freeze(Object.keys(ENVIRONMENT_ALIASES));

export function standardRootBuildScript(architecture, environmentAlias, deploymentProfile = 'standalone') {
  const suffix = deploymentProfile === 'standalone'
    ? environmentAlias
    : `${environmentAlias}:${deploymentProfile}`;
  return `build:${architecture}:${suffix}`;
}

export function canonicalRootBuildCommand(repositoryRoot, architecture, environmentAlias, deploymentProfile = 'standalone') {
  const tool = resolveSpecsRelativeTool(repositoryRoot, 'build-browser-client.mjs');
  const relativeTool = path.relative(repositoryRoot, tool).replaceAll('\\', '/');
  const args = [
    '--root',
    '.',
    '--architecture',
    architecture,
    '--environment',
    environmentAlias,
  ];
  if (deploymentProfile !== 'standalone') {
    args.push('--deployment-profile', deploymentProfile);
  }
  return `node ${relativeTool} ${args.join(' ')}`;
}

export function canonicalAppSurfaceBuildCommand(appRoot, environmentAlias, deploymentProfile = 'standalone') {
  const repositoryRoot = path.join(appRoot, '..', '..');
  const tool = resolveSpecsRelativeTool(repositoryRoot, 'build-browser-client.mjs');
  const relativeTool = path.relative(appRoot, tool).replaceAll('\\', '/');
  const args = [
    '--app-root',
    '.',
    '--environment',
    environmentAlias,
  ];
  if (deploymentProfile !== 'standalone') {
    args.push('--deployment-profile', deploymentProfile);
  }
  return `node ${relativeTool} ${args.join(' ')}`;
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'app-root': { type: 'string' },
      architecture: { type: 'string' },
      'deployment-profile': { type: 'string', default: 'standalone' },
      'dry-run': { type: 'boolean', default: false },
      environment: { type: 'string', default: 'prod' },
      help: { type: 'boolean', short: 'h' },
      root: { type: 'string', default: '.' },
    },
  });

  if (values.help) {
    console.log('Usage: node tools/build-browser-client.mjs --root <repo> --architecture pc|h5 --environment dev|test|staging|prod [--deployment-profile standalone|cloud]');
    console.log('       node tools/build-browser-client.mjs --app-root <apps/...> --environment dev|test|staging|prod [--deployment-profile standalone|cloud]');
    return;
  }

  if (values['app-root']) {
    buildBrowserClientFromAppSurface({
      appRoot: values['app-root'],
      deploymentProfile: values['deployment-profile'],
      dryRun: values['dry-run'],
      environment: values.environment,
    });
    return;
  }

  if (!values.architecture) {
    throw new Error('--architecture pc|h5 is required when --app-root is omitted');
  }

  buildBrowserClient({
    architecture: values.architecture,
    deploymentProfile: values['deployment-profile'],
    dryRun: values['dry-run'],
    environment: values.environment,
    repositoryRoot: values.root,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[build-browser-client] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
