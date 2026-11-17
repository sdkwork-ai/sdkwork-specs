#!/usr/bin/env node

/**
 * CLI: register every application of this workspace into Deploy and IAM.
 *
 * Usage:
 *   node sdkwork-specs/tools/register-applications.mjs --inventory out.json
 *   node sdkwork-specs/tools/register-applications.mjs --environment development --dry-run
 *   node sdkwork-specs/tools/register-applications.mjs --environment production --report out.json
 *
 * Exit codes:
 *   0  every selected item is created or reused, and the hand-off succeeded
 *   1  at least one item failed (count is reported; failures are never skipped)
 *   2  configuration is unusable (missing variables are named)
 *   3  no application matched the selection
 *
 * @module app-registration/cli
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  DEPLOY_APPLICATION_ID_ENV,
  REGISTRATION_ENVIRONMENTS,
  REGISTRATION_SETTINGS_ENV,
  RegistrationConfigurationError,
  normalizeEnvironment,
  resolveRegistrationSettings,
} from './contract.mjs';
import { buildRegistrationInventory } from './inventory.mjs';
import { RegistrationAbortedError, registerApplications } from './register.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');

const HELP = `register-applications — register every app into Deploy and IAM

Usage:
  register-applications [options]

Selection:
  --workspace <dir>          Workspace root that contains the sdkwork-* repositories
                             (default: ${DEFAULT_WORKSPACE_ROOT})
  --environment <name>       ${REGISTRATION_ENVIRONMENTS.join('|')} (aliases: dev, local, prod)
  --scope repository|all|repo-root|surfaces
                             repository (default): one anchor per repository — the root
                             manifest, else the first surface manifest. The client-env
                             materializer bakes one anchor per repository, so per-surface
                             anchors cannot survive materialization. all: every manifest root.
  --filter <regex>           Restrict by app id, app key, app name, or slug
  --only <id>                Register one application root (repeatable)
  --deployment-profile <p>   standalone|cloud override for env-file selection
                             (default: standalone for development/test, cloud otherwise)

Execution:
  --dry-run                  Print the plan; no request, no file write
  --report <path>            Write the JSON report
  --json                     Print the whole report as JSON
  --inventory <path>         Write the registration inventory and exit
  --retries <n>              Attempts per item for retryable failures (default: 2)
  --retry-delay <ms>         Base backoff between attempts (default: 250)
  --anchor-kind <kind>       deploy-application-id (default) | deploy-application-uuid
  --anchor-map <path>        JSON map of "<app-id>@<environment>" -> decimal deploy application id
  --allow-unverified-iam-binding  Accept an IAM response that does not echo deployApplicationId
  --no-write-anchor          Do not write ${DEPLOY_APPLICATION_ID_ENV} into the env configuration
  --no-record-deploy-uuid    Do not write SDKWORK_DEPLOY_APPLICATION_UUID bookkeeping
  --no-regenerate-topology   Do not re-run materialize-topology-env.mjs after writing the anchor
  --no-materialize           Do not re-run materialize-client-env.mjs (no profile token update)
  --help                     Show this help

Environment (required unless --dry-run / --inventory):
  ${REGISTRATION_SETTINGS_ENV.deploy.baseUrl}    Deploy app-api origin
  ${REGISTRATION_SETTINGS_ENV.deploy.accessToken}       Deploy Access-Token
  ${REGISTRATION_SETTINGS_ENV.deploy.authToken}         Deploy Bearer auth token
  ${REGISTRATION_SETTINGS_ENV.iam.baseUrlCandidates[0]}   IAM backend origin
  ${REGISTRATION_SETTINGS_ENV.iam.authTokenCandidates[0]} or
  ${REGISTRATION_SETTINGS_ENV.iam.usernameCandidates[0]} +
  ${REGISTRATION_SETTINGS_ENV.iam.passwordCandidates[0]}
  ${REGISTRATION_SETTINGS_ENV.tenantId} / ${REGISTRATION_SETTINGS_ENV.organizationId}
                             Optional tenant scope (manifest values otherwise)
`;

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

/**
 * Parse command-line arguments.
 * @param argv - arguments without the node/script prefix
 * @returns the options
 */
export function parseArgs(argv) {
  const options = {
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
    environment: '',
    scope: 'repository',
    filterPattern: '',
    only: [],
    deploymentProfile: '',
    dryRun: false,
    reportPath: '',
    inventoryPath: '',
    json: false,
    maxAttempts: 2,
    retryDelayMs: 250,
    anchorKind: 'deploy-application-id',
    anchorMapPath: '',
    allowUnverifiedIamBinding: false,
    writeAnchor: true,
    recordDeployUuid: true,
    regenerateTopologyEnv: true,
    materialize: true,
    help: false,
  };
  const valueOf = (index, name) => {
    const value = String(argv[index + 1] ?? '').trim();
    if (!value) {
      throw new RegistrationConfigurationError(`${name} requires a value`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--workspace':
        options.workspaceRoot = path.resolve(valueOf(index, arg));
        index += 1;
        break;
      case '--environment':
        options.environment = valueOf(index, arg);
        index += 1;
        break;
      case '--scope':
        options.scope = valueOf(index, arg);
        index += 1;
        break;
      case '--filter':
        options.filterPattern = valueOf(index, arg);
        index += 1;
        break;
      case '--only':
        options.only.push(valueOf(index, arg));
        index += 1;
        break;
      case '--deployment-profile':
        options.deploymentProfile = valueOf(index, arg);
        index += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--report':
        options.reportPath = path.resolve(valueOf(index, arg));
        index += 1;
        break;
      case '--inventory':
        options.inventoryPath = path.resolve(valueOf(index, arg));
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '--retries':
        options.maxAttempts = Number(valueOf(index, arg));
        index += 1;
        break;
      case '--retry-delay':
        options.retryDelayMs = Number(valueOf(index, arg));
        index += 1;
        break;
      case '--anchor-kind':
        options.anchorKind = valueOf(index, arg);
        index += 1;
        break;
      case '--anchor-map':
        options.anchorMapPath = path.resolve(valueOf(index, arg));
        index += 1;
        break;
      case '--allow-unverified-iam-binding':
        options.allowUnverifiedIamBinding = true;
        break;
      case '--no-write-anchor':
        options.writeAnchor = false;
        break;
      case '--no-record-deploy-uuid':
        options.recordDeployUuid = false;
        break;
      case '--no-regenerate-topology':
        options.regenerateTopologyEnv = false;
        break;
      case '--no-materialize':
        options.materialize = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new RegistrationConfigurationError(`unsupported option: ${arg}`);
    }
  }
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new RegistrationConfigurationError('--retries must be a positive integer');
  }
  if (!Number.isInteger(options.retryDelayMs) || options.retryDelayMs < 0) {
    throw new RegistrationConfigurationError('--retry-delay must be a non-negative integer');
  }
  return options;
}

/**
 * Load an explicit anchor map.
 *
 * Accepted shapes:
 * - `{ "<app-id>@<environment>": "1234" }`
 * - `{ "anchors": [{ "app": "...", "environment": "...", "deployApplicationId": "1234" }] }`
 * @param filePath - absolute path
 * @returns flat `app@environment` map
 */
export function loadAnchorMap(filePath) {
  const document = readJsonFile(filePath);
  const map = {};
  const records = Array.isArray(document?.anchors) ? document.anchors : [];
  for (const record of records) {
    const app = String(record?.app ?? '').trim();
    const environment = String(record?.environment ?? '').trim();
    const anchor = String(record?.deployApplicationId ?? record?.anchor ?? '').trim();
    if (!app || !environment || !anchor) {
      continue;
    }
    map[`${app}@${environment}`] = anchor;
  }
  for (const [key, value] of Object.entries(document ?? {})) {
    if (key === 'anchors' || key === 'schemaVersion' || key === 'kind') {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      map[key] = String(value).trim();
    }
  }
  return map;
}

function writeReport(filePath, report) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printItemLines(report) {
  for (const entry of report.entries) {
    if (entry.status === 'planned' || entry.status === 'invalid') {
      const defects = entry.defects?.length ? `  defects=${entry.defects.length}` : '';
      console.log(`[${entry.status}] ${entry.label} slug=${entry.slug}${defects}`);
      continue;
    }
    const anchor = entry.deployApplicationId || '-';
    const iam = entry.iam?.status ? `iam=${entry.iam.status}` : 'iam=-';
    const written = (entry.anchor?.written ?? []).length;
    const materialized = entry.materialize?.status ?? '-';
    const line = `[${entry.status}] ${entry.label} anchor=${anchor} uuid=${
      entry.deployApplicationUuid || '-'
    } ${iam} anchorFiles=${written} materialize=${materialized}`;
    console.log(entry.status === 'failed' ? `${line}\n    error: ${entry.error}` : line);
  }
}

function printDeforests(report) {
  const blocking = report.entries.filter((entry) => entry.status === 'invalid');
  for (const entry of blocking) {
    for (const defect of entry.defects ?? []) {
      console.error(`  invalid: ${defect}`);
    }
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  if (options.inventoryPath) {
    const inventory = buildRegistrationInventory({ workspaceRoot: options.workspaceRoot });
    writeReport(options.inventoryPath, inventory);
    console.log(
      `inventory: ${inventory.counts.applicationRoots} application root(s) in `
      + `${inventory.counts.repositories} repository(ies); `
      + `${inventory.counts.withClientTokenCarrier} with a client token carrier; `
      + `${inventory.counts.duplicateSlugs} slug collision group(s)`,
    );
    console.log(`inventory written: ${options.inventoryPath}`);
    return 0;
  }

  if (!options.environment) {
    throw new RegistrationConfigurationError(
      `--environment is required (one of ${REGISTRATION_ENVIRONMENTS.join(', ')}); `
      + 'a registration run always targets exactly one lifecycle',
    );
  }
  const environment = normalizeEnvironment(options.environment);
  const anchorOverrides = options.anchorMapPath ? loadAnchorMap(options.anchorMapPath) : {};

  let settings;
  let settingsError;
  try {
    settings = resolveRegistrationSettings(process.env);
  } catch (error) {
    settingsError = error;
  }
  if (settingsError && !options.dryRun) {
    throw settingsError;
  }
  if (settingsError && options.dryRun) {
    console.error(`[register-applications] dry-run without credentials: ${settingsError.message}`);
  }

  const report = await registerApplications({
    ...options,
    workspaceRoot: options.workspaceRoot,
    environment,
    settings: settings ?? {
      deploy: { baseUrl: '', accessToken: '', authToken: '', timeoutMs: 10_000 },
      iam: { baseUrl: '', auth: {}, timeoutMs: 10_000 },
      tenantId: '',
      organizationId: '',
    },
    anchorOverrides,
  });

  if (options.reportPath) {
    writeReport(options.reportPath, report);
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printItemLines(report);
    printDeforests(report);
    const counts = report.counts;
    console.log(
      `\nregister-applications ${environment}: planned=${counts.planned} created=${counts.created} `
      + `reused=${counts.reused} failed=${counts.failed}${counts.invalid ? ` invalid=${counts.invalid}` : ''} `
      + `anchorWritten=${counts.anchorWritten} materialized=${counts.materialized}`
      + `${counts.materializeFailed ? ` materializeFailed=${counts.materializeFailed}` : ''}`
      + `${counts.materializeConflict ? ` materializeConflict=${counts.materializeConflict}` : ''}`,
    );
    console.log(
      `selection: scope=${report.scope} deploymentProfile=${report.deploymentProfile} `
      + `anchorKind=${report.anchorKind} dryRun=${report.dryRun}`,
    );
    if (options.reportPath) {
      console.log(`report written: ${options.reportPath}`);
    }
  }

  if (!options.dryRun) {
    if (report.counts.failed > 0) {
      return 1;
    }
    if (report.counts.materializeFailed > 0 || report.counts.materializeConflict > 0) {
      return 1;
    }
  }
  return 0;
}

/**
 * Run the CLI and map failures onto the documented exit codes.
 *
 * Both entrypoints (`tools/register-applications.mjs` and this module) share
 * this mapping so the canonical invocation keeps exit code `2` for unusable
 * configuration and `3` for an empty selection instead of collapsing every
 * failure into `1`.
 * @param argv - arguments without the node/script prefix
 * @returns the process exit code
 */
export async function runMain(argv) {
  try {
    return await main(argv);
  } catch (error) {
    if (error instanceof RegistrationAbortedError) {
      console.error(`[register-applications] ${error.message}`);
      return 3;
    }
    if (error instanceof RegistrationConfigurationError) {
      console.error(`[register-applications] ${error.message}`);
      return 2;
    }
    console.error(
      `[register-applications] ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
    return 1;
  }
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    });
}

export { main, HELP };
