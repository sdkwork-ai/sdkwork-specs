import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  buildPostgresDatabaseUrl,
  parseDotEnv,
  parseWorkspacePostgresConfig,
  workspaceDatabaseEnvFromConfig,
} from './postgres-config.mjs';

export const POSTGRES_DEV_ENV_FILENAME = 'config/host/postgres.env';
export const POSTGRES_DEV_ENV_EXAMPLE_FILENAME = 'config/host/postgres.env.example';

const DATABASE_ENV_PREFIXES = ['SDKWORK_DATABASE_'];

function isDatabaseEnvKey(key) {
  return DATABASE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    || /^SDKWORK_[A-Z0-9_]+_DATABASE_/u.test(key);
}

function rejectRetiredRuntimeDatabaseKeys(env) {
  const keys = Object.keys(env).filter((key) => (
    /^SDKWORK_(?!DATABASE_)[A-Z0-9_]+_DATABASE_[A-Z0-9_]+$/u.test(key)
  ));
  if (keys.length > 0) {
    throw new Error(`retired database configuration ${keys.sort().join(', ')}; use SDKWORK_DATABASE_*`);
  }
}

export function resolvePostgresDevEnvFilePath(repoRoot) {
  return path.resolve(repoRoot, POSTGRES_DEV_ENV_FILENAME);
}

export function resolvePostgresDevEnvExamplePath(repoRoot) {
  return path.resolve(repoRoot, POSTGRES_DEV_ENV_EXAMPLE_FILENAME);
}

export function ensurePostgresDevEnvFile(repoRoot, {
  stdout = process.stdout,
} = {}) {
  const envFilePath = resolvePostgresDevEnvFilePath(repoRoot);
  if (fs.existsSync(envFilePath)) {
    return envFilePath;
  }
  const examplePath = resolvePostgresDevEnvExamplePath(repoRoot);
  if (!fs.existsSync(examplePath)) {
    throw new Error(
      `PostgreSQL dev env is missing (${envFilePath}) and no example file exists at ${examplePath}`,
    );
  }
  fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
  fs.copyFileSync(examplePath, envFilePath);
  stdout.write(
    `[sdkwork-postgres] created ${POSTGRES_DEV_ENV_FILENAME} from ${POSTGRES_DEV_ENV_EXAMPLE_FILENAME}; `
    + 'edit database credentials there once, then app startup and db:* commands stay aligned\n',
  );
  return envFilePath;
}

export function readPostgresDevFileEnv(repoRoot, {
  ensureFile = true,
  stdout = process.stdout,
} = {}) {
  const configPath = ensureFile
    ? ensurePostgresDevEnvFile(repoRoot, { stdout })
    : resolvePostgresDevEnvFilePath(repoRoot);
  if (!fs.existsSync(configPath)) {
    return { configPath, fileEnv: {} };
  }
  return {
    configPath,
    fileEnv: parseDotEnv(fs.readFileSync(configPath, 'utf8')),
  };
}

export function mergePostgresDevRuntimeEnv({
  env = process.env,
  fileEnv,
  extraEnv = {},
}) {
  rejectRetiredRuntimeDatabaseKeys(env);
  rejectRetiredRuntimeDatabaseKeys(extraEnv);
  const runtimeWithoutDatabase = { ...env };
  for (const key of Object.keys(runtimeWithoutDatabase)) {
    if (isDatabaseEnvKey(key)) {
      delete runtimeWithoutDatabase[key];
    }
  }
  return {
    ...runtimeWithoutDatabase,
    ...fileEnv,
    ...extraEnv,
  };
}

export function resolvePostgresDevProfile({
  env = process.env,
  extraEnv = {},
  repoRoot,
  ensureFile = true,
  stdout = process.stdout,
} = {}) {
  if (!repoRoot) {
    throw new Error('resolvePostgresDevProfile requires repoRoot');
  }
  const { configPath, fileEnv } = readPostgresDevFileEnv(repoRoot, { ensureFile, stdout });
  const mergedEnv = mergePostgresDevRuntimeEnv({ env, fileEnv, extraEnv });
  const config = parseWorkspacePostgresConfig({
    configPath,
    repoRoot,
  });
  const databaseUrl = buildPostgresDatabaseUrl(config.database);
  return {
    config,
    configPath,
    databaseUrl,
    env: {
      ...mergedEnv,
      ...workspaceDatabaseEnvFromConfig(config),
    },
    fileEnv,
  };
}

export function isPostgresDevProfile(env = process.env) {
  const engine = String(
    env.SDKWORK_DATABASE_ENGINE
    ?? '',
  ).trim();
  if (!engine) {
    return true;
  }
  return /^postgres(?:ql)?$/iu.test(engine);
}
