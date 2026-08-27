#!/usr/bin/env node
// Ensure SDKWORK_ACCESS_TOKEN for an Adaptive Web build (ENVIRONMENT_SPEC §6.1).
//
// Usage:
//   node tools/ensure-build-access-token.mjs --app-root apps/demo-pc --environment development
//   node tools/ensure-build-access-token.mjs --app-root apps/demo-pc --environment development -- pnpm exec vite build
//
// Behavior:
//   - Prefer an already-provisioned process.env.SDKWORK_ACCESS_TOKEN
//   - development / test: generate a disposable local JWT via IAM credential-entry
//   - staging / production: never auto-sign; return the provisioned secret or empty
//     (browser staging/prod artifacts remain credential-free per ENVIRONMENT_SPEC)

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {
    allowTestTokenGeneration: true,
    appRoot: null,
    environment: 'development',
    command: '',
    commandArgs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--app-root') {
      options.appRoot = path.resolve(argv[++index]);
    } else if (arg === '--environment') {
      options.environment = argv[++index];
    } else if (arg === '--allow-test-token-generation') {
      options.allowTestTokenGeneration = true;
    } else if (arg === '--no-allow-test-token-generation') {
      options.allowTestTokenGeneration = false;
    } else if (arg === '--') {
      options.command = argv[index + 1] ?? '';
      options.commandArgs = argv.slice(index + 2);
      break;
    } else {
      throw new Error(`unsupported option: ${arg}`);
    }
  }
  return options;
}

function resolveManifest(appRoot) {
  for (const candidate of [
    path.join(appRoot, 'sdkwork.app.config.json'),
    path.join(appRoot, '..', '..', 'sdkwork.app.config.json'),
  ]) {
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, 'utf8'));
    }
  }
  throw new Error(`application manifest not found under ${appRoot}`);
}

function resolveCredentialEntryCore(appRoot) {
  const repositoryRoot = path.resolve(appRoot, '..', '..');
  const candidates = [
    path.join(
      repositoryRoot,
      '..',
      'sdkwork-iam',
      'apps',
      'sdkwork-iam-common',
      'packages',
      'sdkwork-iam-credential-entry',
      'src',
      'bootstrap-access-token-core.mjs',
    ),
    path.join(
      SPECS_ROOT,
      '..',
      'sdkwork-iam',
      'apps',
      'sdkwork-iam-common',
      'packages',
      'sdkwork-iam-credential-entry',
      'src',
      'bootstrap-access-token-core.mjs',
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('missing canonical IAM credential-entry bootstrap core');
}

function normalizeExistingToken(value) {
  const normalized = String(value ?? '').trim();
  return normalized || '';
}

/**
 * Resolve a private bootstrap access token for one Adaptive Web app surface.
 * @param {{ appRoot: string, environment?: string, allowTestTokenGeneration?: boolean }} options
 * @returns {Promise<string>}
 */
export async function ensureBuildAccessToken({
  appRoot,
  environment = 'development',
  allowTestTokenGeneration = true,
}) {
  const existing = normalizeExistingToken(process.env.SDKWORK_ACCESS_TOKEN);
  if (existing) {
    return existing;
  }

  const corePath = resolveCredentialEntryCore(appRoot);
  const core = await import(pathToFileURL(corePath).href);
  const normalize = core.normalizeBootstrapEnvironment
    ?? ((value) => {
      const token = String(value ?? '').trim().toLowerCase();
      if (token === 'dev') return 'development';
      if (token === 'prod') return 'production';
      return token;
    });
  const lifecycleEnvironment = normalize(environment);

  if (lifecycleEnvironment === 'staging' || lifecycleEnvironment === 'production') {
    // Staging/production browser builds must stay credential-free unless the
    // operator provisioned SDKWORK_ACCESS_TOKEN from a private secret source.
    return '';
  }

  if (lifecycleEnvironment === 'test' && allowTestTokenGeneration === false) {
    return '';
  }

  const manifest = resolveManifest(appRoot);
  if (typeof core.buildBootstrapAccessTokenEnvRecord === 'function') {
    const record = core.buildBootstrapAccessTokenEnvRecord('', {
      allowTestTokenGeneration: lifecycleEnvironment === 'test' ? true : allowTestTokenGeneration,
      environment: lifecycleEnvironment,
      manifest,
    });
    return normalizeExistingToken(record?.[core.SDKWORK_ACCESS_TOKEN_ENV_KEY ?? 'SDKWORK_ACCESS_TOKEN']);
  }

  return normalizeExistingToken(
    core.createDevBootstrapAccessTokenJwt({
      environment: lifecycleEnvironment,
      manifest,
    }),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.appRoot) {
    console.error(
      'usage: ensure-build-access-token.mjs --app-root <app> [--environment <env>] [-- command...]',
    );
    process.exit(2);
  }
  const token = await ensureBuildAccessToken({
    allowTestTokenGeneration: options.allowTestTokenGeneration,
    appRoot: options.appRoot,
    environment: options.environment,
  });
  if (options.command) {
    const result = spawnSync(options.command, options.commandArgs, {
      cwd: options.appRoot,
      encoding: 'utf8',
      env: { ...process.env, SDKWORK_ACCESS_TOKEN: token },
      stdio: 'inherit',
      timeout: 30 * 60 * 1000,
    });
    process.exit(result.status ?? 1);
  }
  process.stdout.write(token);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
