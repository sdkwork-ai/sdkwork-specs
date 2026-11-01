#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  parseWorkspacePostgresConfig,
  sanitizePostgresDatabaseUrl,
  validateAdminExecutionConfig,
} from './postgres-config.mjs';
import { executePostgresInitWithNode } from './postgres-init-node.mjs';
import { ensurePostgresDevEnvFile } from './postgres-dev-profile.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const result = {
    configPath: 'config/host/postgres.env',
    dryRun: false,
    help: false,
    mode: 'init',
    repoRoot: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    if (arg === '--mode') {
      result.mode = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--config') {
      result.configPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--app-root') {
      result.repoRoot = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function printHelp() {
  process.stdout.write(`Usage: node postgres-db-cli.mjs [options]

Workspace-standard PostgreSQL role/database/schema initialization (no psql required).

Options:
  --mode <init|plan>     Default: init
  --config <path>        Default: config/host/postgres.env
  --app-root <path>      Application root (default: cwd)
  --dry-run              Print plan only
  --help, -h
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!['init', 'plan'].includes(args.mode)) {
    throw new Error(`unsupported mode: ${args.mode}; use init or plan`);
  }

  ensurePostgresDevEnvFile(args.repoRoot);
  const config = parseWorkspacePostgresConfig({
    configPath: args.configPath,
    repoRoot: args.repoRoot,
  });
  validateAdminExecutionConfig(config.admin);

  const targetUrl = sanitizePostgresDatabaseUrl(
    `postgresql://${config.database.username}@${config.database.host}:${config.database.port}/${config.database.database}`,
  );

  if (args.dryRun || args.mode === 'plan') {
    process.stdout.write(
      `SDKWork PostgreSQL init plan\n`
      + `config: ${config.source.path}\n`
      + `target: ${targetUrl}\n`
      + `schema: ${config.database.schema}\n`
      + `runtime: node (pg)\n`,
    );
    return;
  }

  process.stdout.write(
    `[sdkwork-postgres] initializing role, database, and schema from ${config.source.path}\n`,
  );
  const result = await executePostgresInitWithNode(config);
  process.stdout.write(
    `[sdkwork-postgres] init complete: ${sanitizePostgresDatabaseUrl(result.databaseUrl)}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[sdkwork-postgres] ${message}\n`);
  process.exit(1);
});
