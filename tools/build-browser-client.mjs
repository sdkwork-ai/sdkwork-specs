#!/usr/bin/env node

/**
 * Canonical Adaptive Web PC/H5 Vite production build runner.
 * Authority: PNPM_SCRIPT_SPEC.md §4.2, FRONTEND_CODE_SPEC.md §7.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  attachCloudApiBaseUrls,
  cloudSdkBaseUrlMaterializationValue,
  readCloudApiOriginListFromDeployment,
  resolveCloudApiOriginListForRepository,
  SDK_BASE_URL_KEYS,
  validateCloudApiOriginForEnvironment,
} from './browser-cloud-api-base.mjs';
import {
  LIFECYCLE_ENVIRONMENTS,
  resolveBrowserDistOutDir,
} from './browser-dist-layout.mjs';
import { ensureBuildAccessToken } from './ensure-build-access-token.mjs';

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

/**
 * Prefer the app/build tsconfig for production typecheck so e2e/scripts
 * harnesses do not block Adaptive Web dist builds.
 * Order: tsconfig.build.json → tsconfig.app.json → tsconfig.json.
 *
 * @param {string} appRoot
 * @returns {string|null} absolute path or null when none exist
 */
export function resolveBrowserTypecheckTsconfig(appRoot) {
  for (const name of ['tsconfig.build.json', 'tsconfig.app.json', 'tsconfig.json']) {
    const candidate = path.join(appRoot, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

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

function isTransientToolchainCrash(result) {
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`;
  if (/Fatal error in|unreachable code|SIGTRAP|SIGSEGV|was killed with SIG/i.test(combined)) {
    return true;
  }
  if (result.signal && ['SIGTRAP', 'SIGSEGV', 'SIGABRT', 'SIGILL'].includes(result.signal)) {
    return true;
  }
  return false;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ retries?: number, inherit?: boolean }} [options]
 */
function runCommand(command, args, cwd, env = process.env, options = {}) {
  const retries = Math.max(0, Number(options.retries ?? 0));
  const inherit = options.inherit !== false;
  let attempt = 0;
  let lastResult;
  while (attempt <= retries) {
    attempt += 1;
    if (attempt > 1) {
      console.warn(
        `[build-browser-client] retrying ${command} ${args.join(' ')} (attempt ${attempt}/${retries + 1}) after transient toolchain crash`,
      );
    }
    lastResult = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      env,
      shell: process.platform === 'win32',
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (lastResult.status === 0 && !lastResult.error) {
      if (!inherit) {
        if (lastResult.stdout) {
          process.stdout.write(lastResult.stdout.endsWith('\n') ? lastResult.stdout : `${lastResult.stdout}\n`);
        }
        if (lastResult.stderr) {
          process.stderr.write(lastResult.stderr.endsWith('\n') ? lastResult.stderr : `${lastResult.stderr}\n`);
        }
      }
      return;
    }
    if (!inherit) {
      if (lastResult.stdout) {
        process.stdout.write(lastResult.stdout.endsWith('\n') ? lastResult.stdout : `${lastResult.stdout}\n`);
      }
      if (lastResult.stderr) {
        process.stderr.write(lastResult.stderr.endsWith('\n') ? lastResult.stderr : `${lastResult.stderr}\n`);
      }
    }
    if (attempt <= retries && isTransientToolchainCrash(lastResult)) {
      continue;
    }
    break;
  }
  throw new Error(`${command} ${args.join(' ')} failed with exit ${lastResult?.status ?? lastResult?.signal ?? 'unknown'}`);
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


function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Materialize and validate the deploy-time browser runtime document from the
 * app-level deployment config (ENVIRONMENT_SPEC.md §5.1.0.1):
 *   apps/<app>/etc/sdkwork.deployment.config.json -> profiles[profileId].source
 *   -> public/runtime-env.json.
 * standalone sources must use the same-origin root `/` for every SDK base URL;
 * cloud sources must equal the environment's unified `cloudApiBaseUrl` origin
 * (`api-dev.<domain>` … `api.<domain>`) declared by the repository deployment
 * config. Apps with a local scripts/materialize-runtime-env.mjs keep their own
 * materialization (checked before this fallback).
 */
export function materializeBrowserRuntimeEnv({ appRoot, deploymentProfile, environment, repositoryRoot, check = false }) {
  const profileId = `${deploymentProfile}.${environment}`;
  const deploymentConfigPath = path.join(appRoot, 'etc', 'sdkwork.deployment.config.json');
  if (!existsSync(deploymentConfigPath)) {
    throw new Error(`app deployment config is missing: ${deploymentConfigPath}`);
  }
  const deployment = readJson(deploymentConfigPath, deploymentConfigPath);
  const sourceRelative = deployment.profiles?.[profileId]?.source;
  if (typeof sourceRelative !== 'string' || sourceRelative.length === 0) {
    throw new Error(`app deployment config does not declare browser source for ${profileId}`);
  }
  const sourcePath = path.resolve(path.dirname(deploymentConfigPath), sourceRelative);
  if (!existsSync(sourcePath)) {
    throw new Error(`browser runtime source does not exist for ${profileId}: ${sourcePath}`);
  }
  const value = readJson(sourcePath, sourcePath);

  if (value.deploymentProfile !== deploymentProfile
    || value.environment !== environment
    || value.profileId !== profileId
    || value.runtimeTarget !== 'browser') {
    throw new Error(`browser runtime source identity does not match ${profileId}: ${sourcePath}`);
  }

  if (deploymentProfile === 'standalone') {
    if (value.browserOriginMode !== 'same-origin') {
      throw new Error(`${profileId}.browserOriginMode must equal same-origin`);
    }
    for (const key of SDK_BASE_URL_KEYS) {
      if (value[key] !== undefined && value[key] !== '/') {
        throw new Error(`${profileId}.${key} must use the canonical same-origin root /`);
      }
    }
  } else {
    if (value.browserOriginMode !== 'cross-origin') {
      throw new Error(`${profileId}.browserOriginMode must equal cross-origin`);
    }
    const deployment = readJson(path.join(repositoryRoot, 'etc', 'sdkwork.deployment.config.json'), 'deployment config');
    const cloudApiOrigins = resolveCloudApiOriginListForRepository({
      repositoryRoot,
      environment,
      deployment,
      preferTopology: true,
    });
    const expectedMaterialized = cloudSdkBaseUrlMaterializationValue(cloudApiOrigins);
    for (const key of SDK_BASE_URL_KEYS) {
      const raw = String(value[key] ?? '').trim();
      if (!raw) continue;
      if (raw.includes(',') || raw.includes(';')) {
        if (raw !== expectedMaterialized) {
          throw new Error(
            `${profileId}.${key} must equal the declared cloud API edge set ${expectedMaterialized} (ENVIRONMENT_SPEC §5.1.0.1)`,
          );
        }
        continue;
      }
      let origin;
      try {
        origin = new URL(raw).origin;
      } catch {
        throw new Error(`${profileId}.${key} must be an absolute HTTP(S) URL`);
      }
      validateCloudApiOriginForEnvironment(origin, environment);
      if (!cloudApiOrigins.includes(origin)) {
        throw new Error(
          `${profileId}.${key} origin ${origin} must be one of ${cloudApiOrigins.join('; ')} (ENVIRONMENT_SPEC §5.1.0.1)`,
        );
      }
    }
    attachCloudApiBaseUrls(value, cloudApiOrigins);
  }

  const output = deployment.materialization?.output;
  if (typeof output !== 'string' || output.length === 0) {
    // dotenv-style surfaces (materialization.format = "dotenv" with committed
    // .env.<profile>.<environment> inputs) do not materialize a JSON runtime
    // document; the source validation above still guards the profile values.
    return value;
  }
  const outputPath = path.resolve(path.dirname(deploymentConfigPath), output);
  const desired = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current !== desired) {
      throw new Error(`${outputPath} is stale for ${profileId}; rerun the browser build`);
    }
    return value;
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, desired, 'utf8');
  console.log(
    `[build-browser-client] materialized ${profileId} from ${path.relative(appRoot, sourcePath).replaceAll('\\', '/')}`,
  );
  return value;
}

export async function buildBrowserClient(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? options.root ?? '.');
  const architecture = String(options.architecture ?? '').trim();
  const environment = normalizeEnvironmentAlias(options.environment ?? 'prod');
  const deploymentProfile = String(options.deploymentProfile ?? 'standalone').trim();
  const dryRun = options.dryRun === true;
  const skipTypecheck = options.skipTypecheck === true;

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

  let bootstrapAccessToken = '';
  try {
    bootstrapAccessToken = await ensureBuildAccessToken({
      // development + test builds get a disposable local JWT; staging/production
      // keep any privately provisioned SDKWORK_ACCESS_TOKEN and otherwise stay
      // credential-free (ENVIRONMENT_SPEC §6.1).
      allowTestTokenGeneration: true,
      appRoot: app.root,
      environment,
    });
  } catch (error) {
    console.warn(
      `[build-browser-client] bootstrap access token unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (bootstrapAccessToken) {
    buildEnv.SDKWORK_ACCESS_TOKEN = bootstrapAccessToken;
  } else if (environment === 'development' || environment === 'test') {
    console.warn(
      `[build-browser-client] SDKWORK_ACCESS_TOKEN empty for ${deploymentProfile}.${environment}; protected SDK calls may fail before login`,
    );
  }

  console.log(
    `[build-browser-client] START ${app.relative} ${architecture} ${deploymentProfile}.${environment} -> ${outDir}/`,
  );
  maybeRunLocalScript(app.root, 'scripts/verify-build-sources.mjs', []);
  const localMaterialize = path.join(app.root, 'scripts', 'materialize-runtime-env.mjs');
  if (existsSync(localMaterialize)) {
    console.log(`[build-browser-client] materialize runtime env (local script)`);
    runNodeScript(localMaterialize, [
      '--deployment-profile',
      deploymentProfile,
      '--environment',
      environment,
    ], app.root);
  } else {
    // Canonical materialization: apps without a local runtime-env script still
    // get the validated deploy-time document (standalone same-origin / cloud
    // unified api-* edge) before Vite runs.
    console.log(`[build-browser-client] materialize runtime env (canonical)`);
    materializeBrowserRuntimeEnv({
      appRoot: app.root,
      deploymentProfile,
      environment,
      repositoryRoot,
    });
  }

  const tsconfigPath = resolveBrowserTypecheckTsconfig(app.root);
  if (tsconfigPath && !skipTypecheck) {
    const tsconfigRel = path.basename(tsconfigPath);
    console.log(`[build-browser-client] typecheck pnpm exec tsc -p ${tsconfigRel} --noEmit`);
    // Capture + retry: Node/V8 can SIGTRAP mid-tsc on large graphs under WSL/NTFS.
    runCommand('pnpm', ['exec', 'tsc', '-p', tsconfigRel, '--noEmit'], app.root, buildEnv, {
      inherit: false,
      retries: 2,
    });
  } else if (skipTypecheck) {
    console.log(`[build-browser-client] typecheck skipped (--skip-typecheck)`);
  } else {
    console.log(`[build-browser-client] typecheck skipped (no tsconfig.json)`);
  }

  const viteConfig = findViteConfig(app.root);
  const viteArgs = ['exec', 'vite', 'build', '--mode', viteMode];
  if (viteConfig) {
    const configName = path.basename(viteConfig);
    if (!DEFAULT_VITE_CONFIG_NAMES.has(configName)) {
      viteArgs.push('--config', path.relative(app.root, viteConfig).replaceAll('\\', '/'));
    }
  }
  console.log(`[build-browser-client] bundle pnpm ${viteArgs.join(' ')}`);
  runCommand('pnpm', viteArgs, app.root, buildEnv);

  const outputIndex = path.join(app.root, outDir, 'index.html');
  if (!existsSync(outputIndex)) {
    throw new Error(`build completed but ${outputIndex} is missing`);
  }

  console.log(
    `[build-browser-client] PASS ${app.relative} ${architecture} ${deploymentProfile}.${environment} -> ${outDir}/ (FRONTEND_CODE_SPEC.md §7 / SDKWORK_WEBSERVER_SPEC.md §17.1)`,
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

export async function buildBrowserClientFromAppSurface(options) {
  const appRoot = path.resolve(options.appRoot ?? options.root ?? '.');
  const architecture = String(options.architecture ?? inferArchitectureFromAppRoot(appRoot)).trim();
  return buildBrowserClient({
    architecture,
    deploymentProfile: options.deploymentProfile,
    dryRun: options.dryRun,
    environment: options.environment,
    repositoryRoot: path.resolve(options.repositoryRoot ?? path.join(appRoot, '..', '..')),
    skipTypecheck: options.skipTypecheck === true,
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

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'app-root': { type: 'string' },
      architecture: { type: 'string' },
      'deployment-profile': { type: 'string', default: 'standalone' },
      'dry-run': { type: 'boolean', default: false },
      'skip-typecheck': { type: 'boolean', default: false },
      environment: { type: 'string', default: 'prod' },
      help: { type: 'boolean', short: 'h' },
      root: { type: 'string', default: '.' },
    },
  });

  if (values.help) {
    console.log('Usage: node tools/build-browser-client.mjs --root <repo> --architecture pc|h5 --environment dev|test|staging|prod [--deployment-profile standalone|cloud] [--skip-typecheck]');
    console.log('       node tools/build-browser-client.mjs --app-root <apps/...> --environment dev|test|staging|prod [--deployment-profile standalone|cloud]');
    return;
  }

  if (values['app-root']) {
    await buildBrowserClientFromAppSurface({
      appRoot: values['app-root'],
      deploymentProfile: values['deployment-profile'],
      dryRun: values['dry-run'],
      environment: values.environment,
      skipTypecheck: values['skip-typecheck'],
    });
    return;
  }

  if (!values.architecture) {
    throw new Error('--architecture pc|h5 is required when --app-root is omitted');
  }

  await buildBrowserClient({
    architecture: values.architecture,
    deploymentProfile: values['deployment-profile'],
    dryRun: values['dry-run'],
    environment: values.environment,
    repositoryRoot: values.root,
    skipTypecheck: values['skip-typecheck'],
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`[build-browser-client] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
