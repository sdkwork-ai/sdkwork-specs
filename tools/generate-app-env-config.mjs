#!/usr/bin/env node

/**
 * Generate a typed `EnvConfig` module from one committed client env profile.
 *
 * Authority: `APP_RUNTIME_ENV_SPEC.md` §3.1. Packaged surfaces (Flutter,
 * mini program, Harmony/native) project the selected profile into a typed
 * class at build time so runtime code never parses raw JSON or calls
 * `String.fromEnvironment` per key.
 *
 * Supported formats:
 *   --format typescript  -> `ENV_CONFIG` + `AppEnvConfig` type
 *   --format dart        -> `AppEnvConfig` class with static const fields
 *   --format arkts       -> `AppEnvConfig` class with static readonly fields
 *
 * Input is one flat `SDKWORK_*` JSON profile (Flutter `env/sdkwork.<id>.json`
 * or mini program `config/mini-program/runtime-env.<id>.json`). HarmonyOS uses
 * its own nested-template generator, which must expose the same fields.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FORMATS = new Set(['typescript', 'dart', 'arkts']);
const PROFILE_ID_PATTERN = /^(?:standalone|cloud)\.(?:development|test|staging|demo|production)$/u;

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    profile: '',
    format: '',
    input: '',
    output: '',
    appId: '',
    check: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check') {
      options.check = true;
      continue;
    }
    if (['--root', '--profile', '--format', '--input', '--output', '--app-id'].includes(token)) {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }
      const key = token === '--app-id' ? 'appId' : token.slice(2);
      options[key] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported env config generator option: ${token}`);
  }
  if (!PROFILE_ID_PATTERN.test(options.profile)) {
    throw new Error('--profile must be <standalone|cloud>.<environment>.');
  }
  if (!FORMATS.has(options.format)) {
    throw new Error('--format must be typescript, dart, or arkts.');
  }
  options.root = path.resolve(options.root);
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function firstValue(values, keys) {
  for (const key of keys) {
    const value = String(values[key] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function findSuffixValue(values, suffix) {
  const match = Object.keys(values).find((key) => key.endsWith(suffix) && String(values[key] ?? '').trim());
  return match ? String(values[match]).trim() : '';
}

function resolveInputPath(options) {
  if (options.input) {
    return path.resolve(options.root, options.input);
  }
  if (options.format === 'dart') {
    return path.join(options.root, 'env', `sdkwork.${options.profile}.json`);
  }
  if (options.format === 'arkts') {
    throw new Error('--input is required for arkts; the Harmony nested profile has no flat default path.');
  }
  return path.join(options.root, 'config', 'mini-program', `runtime-env.${options.profile}.json`);
}

function resolveOutputPath(options) {
  if (options.output) {
    return path.resolve(options.root, options.output);
  }
  if (options.format === 'dart') {
    return path.join(options.root, 'lib', 'generated', 'env_config.dart');
  }
  if (options.format === 'arkts') {
    return path.join(options.root, 'entry', 'src', 'main', 'ets', 'generated', 'EnvConfig.ets');
  }
  return path.join(options.root, 'src', 'generated', 'envConfig.ts');
}

function decodeToken(token, profile) {
  const parts = String(token ?? '').trim().split('.');
  if (parts.length !== 3) {
    throw new Error('SDKWORK_ACCESS_TOKEN must be a three-part JWT.');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error(`SDKWORK_ACCESS_TOKEN payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const [deploymentProfile, environment] = profile.split('.');
  if (String(payload.environment ?? '') !== environment) {
    throw new Error(`SDKWORK_ACCESS_TOKEN environment=${payload.environment} does not match ${profile}.`);
  }
  if (String(payload.deployment_profile ?? '') !== deploymentProfile) {
    throw new Error(`SDKWORK_ACCESS_TOKEN deployment_profile=${payload.deployment_profile} does not match ${profile}.`);
  }
  return payload;
}

function buildEnvRecord(options) {
  const inputPath = resolveInputPath(options);
  if (!existsSync(inputPath)) {
    throw new Error(`Env profile does not exist: ${inputPath}. Run the client env materializer first.`);
  }
  const values = readJson(inputPath);
  const accessToken = String(values.SDKWORK_ACCESS_TOKEN ?? '').trim();
  if (!accessToken) {
    throw new Error(`${inputPath} is missing SDKWORK_ACCESS_TOKEN.`);
  }
  const payload = decodeToken(accessToken, options.profile);
  if (options.appId && String(payload.app_id ?? '') !== options.appId) {
    throw new Error(`SDKWORK_ACCESS_TOKEN app_id=${payload.app_id} does not match ${options.appId}.`);
  }

  const [deploymentProfile, environment] = options.profile.split('.');
  const record = {
    environment,
    deploymentProfile,
    profileId: options.profile,
    runtimeTarget: firstValue(values, ['SDKWORK_RUNTIME_TARGET', 'SDKWORK_IM_RUNTIME_TARGET']),
    accessToken,
    applicationPublicHttpUrl: findSuffixValue(values, '_APPLICATION_PUBLIC_HTTP_URL'),
    applicationPublicWebSocketUrl: findSuffixValue(values, '_APPLICATION_PUBLIC_WEBSOCKET_URL'),
    platformApiGatewayHttpUrl: findSuffixValue(values, '_PLATFORM_API_GATEWAY_HTTP_URL'),
    iamAppApiBaseUrl: firstValue(values, ['SDKWORK_IAM_APP_API_BASE_URL']),
  };
  if (!record.runtimeTarget) {
    throw new Error(`${inputPath} is missing SDKWORK_RUNTIME_TARGET.`);
  }
  if (!record.applicationPublicHttpUrl) {
    throw new Error(`${inputPath} is missing an *_APPLICATION_PUBLIC_HTTP_URL value.`);
  }
  return { inputPath, record };
}

function renderTypeScript(record) {
  const fields = Object.entries(record);
  const interfaceFields = fields
    .map(([key]) => `  readonly ${key}: string;`)
    .join('\n');
  const values = fields
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`)
    .join('\n');
  return `/* eslint-disable */
// GENERATED FILE - DO NOT EDIT.
// Source: APP_RUNTIME_ENV_SPEC.md §3.1 and the selected committed env profile.
// Regenerate with: node <sdkwork-specs>/tools/generate-app-env-config.mjs

export interface AppEnvConfig {
${interfaceFields}
}

export const ENV_CONFIG: AppEnvConfig = {
${values}
};

export function getEnvConfig(): AppEnvConfig {
  return ENV_CONFIG;
}
`;
}

function renderDart(record) {
  const fields = Object.entries(record)
    .map(([key, value]) => {
      const oneLine = `  static const String ${key} = ${JSON.stringify(value)};`;
      if (oneLine.length <= 80) {
        return oneLine;
      }
      return `  static const String ${key} =\n      ${JSON.stringify(value)};`;
    })
    .join('\n');
  return `// GENERATED FILE - DO NOT EDIT.
// Source: APP_RUNTIME_ENV_SPEC.md §3.1 and the selected committed env profile.
// Regenerate with: node <sdkwork-specs>/tools/generate-app-env-config.mjs

class AppEnvConfig {
${fields}

  const AppEnvConfig._();
}
`;
}

function renderArkTs(record) {
  const fields = Object.entries(record)
    .map(([key, value]) => `  static readonly ${key}: string = ${JSON.stringify(value)};`)
    .join('\n');
  return `/**
 * GENERATED FILE - DO NOT EDIT.
 * Source: APP_RUNTIME_ENV_SPEC.md §3.1 and the selected committed env profile.
 * Regenerate with: node <sdkwork-specs>/tools/generate-app-env-config.mjs
 */
export class AppEnvConfig {
${fields}

  private constructor() {}
}
`;
}

function render(options, record) {
  if (options.format === 'dart') {
    return renderDart(record);
  }
  if (options.format === 'arkts') {
    return renderArkTs(record);
  }
  return renderTypeScript(record);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { inputPath, record } = buildEnvRecord(options);
  const outputPath = resolveOutputPath(options);
  const content = render(options, record);
  if (options.check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== content) {
      throw new Error(`${outputPath} is missing or stale; regenerate it from ${inputPath}.`);
    }
    console.log(`EnvConfig verified: ${path.relative(options.root, outputPath)}`);
    return;
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, 'utf8');
  console.log(`EnvConfig generated: ${path.relative(options.root, outputPath)}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
