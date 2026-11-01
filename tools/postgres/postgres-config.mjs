import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_PREFIX = 'SDKWORK_DATABASE_';
const WORKSPACE_ADMIN_PREFIX = 'SDKWORK_DATABASE_ADMIN_';

function normalizeField(value) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function stripInlineComment(value) {
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? '' : quote || char;
      continue;
    }
    if (char === '#' && !quote && /\s/u.test(value[index - 1] ?? ' ')) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function unquoteConfigValue(value) {
  const trimmed = stripInlineComment(String(value ?? '').trim());
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? inner.replaceAll('\\"', '"').replaceAll('\\\\', '\\')
      : inner.replaceAll("''", "'");
  }
  return trimmed;
}

export function parseDotEnv(text) {
  const result = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const normalizedLine = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const equalsIndex = normalizedLine.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }
    const key = normalizedLine.slice(0, equalsIndex).trim();
    const value = normalizedLine.slice(equalsIndex + 1);
    result[key] = unquoteConfigValue(value);
  }
  return result;
}

function resolveConfigPath(configPath, repoRoot) {
  if (!configPath) {
    return undefined;
  }
  return path.isAbsolute(configPath) ? configPath : path.resolve(repoRoot, configPath);
}

function decodePostgresDatabasePath(pathname) {
  return decodeURIComponent(String(pathname ?? '').replace(/^\//u, ''));
}

function parsePostgresDatabaseUrl(value, schema) {
  const normalized = normalizeField(value);
  if (!normalized) {
    return undefined;
  }
  if (!/^postgres(?:ql)?:\/\//iu.test(normalized)) {
    throw new Error(`unsupported PostgreSQL database URL: ${sanitizePostgresDatabaseUrl(normalized)}`);
  }
  const parsed = new URL(normalized);
  return {
    database: decodePostgresDatabasePath(parsed.pathname),
    host: parsed.hostname,
    password: decodeURIComponent(parsed.password || ''),
    port: parsed.port || '5432',
    schema: normalizeField(schema) ?? decodePostgresDatabasePath(parsed.pathname),
    sslmode: parsed.searchParams.get('sslmode') ?? undefined,
    username: decodeURIComponent(parsed.username || ''),
  };
}

function readEnvValue(env, keys) {
  for (const key of keys) {
    const value = normalizeField(env[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function rejectRetiredDatabaseKeys(env) {
  const retiredKeys = Object.keys(env).filter((key) => (
    /^SDKWORK_(?!DATABASE_)[A-Z0-9_]+_DATABASE_[A-Z0-9_]+$/u.test(key)
    || /^(?:DOCUMENTS|DATABASE)_DATABASE_[A-Z0-9_]+$/u.test(key)
    || /^(?:DATABASE_URL|DATABASE_PROVIDER|DATABASE_SSLMODE)$/u.test(key)
    || /^SDKWORK_DATABASE_(?:PROVIDER|(?:ADMIN_)?SSLMODE)$/u.test(key)
  ));
  if (retiredKeys.length > 0) {
    throw new Error(
      `retired database configuration ${retiredKeys.sort().join(', ')}; use SDKWORK_DATABASE_*`,
    );
  }
}

function buildConnectionFromEnv(env, {
  urlKeys = [`${WORKSPACE_PREFIX}URL`],
  hostKeys = [`${WORKSPACE_PREFIX}HOST`],
  portKeys = [`${WORKSPACE_PREFIX}PORT`],
  databaseKeys = [`${WORKSPACE_PREFIX}NAME`],
  schemaKeys = [`${WORKSPACE_PREFIX}SCHEMA`, `${WORKSPACE_PREFIX}NAME`],
  usernameKeys = [`${WORKSPACE_PREFIX}USERNAME`],
  passwordKeys = [`${WORKSPACE_PREFIX}PASSWORD`],
  sslModeKeys = [`${WORKSPACE_PREFIX}SSL_MODE`],
} = {}) {
  const fromUrl = parsePostgresDatabaseUrl(
    readEnvValue(env, urlKeys),
    readEnvValue(env, schemaKeys),
  );
  if (fromUrl) {
    return fromUrl;
  }

  return {
    database: readEnvValue(env, databaseKeys),
    host: readEnvValue(env, hostKeys),
    password: readEnvValue(env, passwordKeys),
    port: readEnvValue(env, portKeys) ?? '5432',
    schema: readEnvValue(env, schemaKeys),
    sslmode: readEnvValue(env, sslModeKeys),
    username: readEnvValue(env, usernameKeys),
  };
}

function buildAdminFromEnv(env, database) {
  const adminFromUrl = parsePostgresDatabaseUrl(
    readEnvValue(env, [`${WORKSPACE_ADMIN_PREFIX}URL`]),
    undefined,
  );
  if (adminFromUrl) {
    return adminFromUrl;
  }

  return {
    database: readEnvValue(env, [`${WORKSPACE_ADMIN_PREFIX}DATABASE`]) ?? 'postgres',
    host: readEnvValue(env, [`${WORKSPACE_ADMIN_PREFIX}HOST`]) ?? database.host,
    password: readEnvValue(env, [`${WORKSPACE_ADMIN_PREFIX}PASSWORD`]),
    port: readEnvValue(env, [`${WORKSPACE_ADMIN_PREFIX}PORT`]) ?? database.port,
    sslmode: readEnvValue(env, [`${WORKSPACE_ADMIN_PREFIX}SSL_MODE`]) ?? database.sslmode,
    username: readEnvValue(env, [`${WORKSPACE_ADMIN_PREFIX}USERNAME`]) ?? 'postgres',
  };
}

function validateDatabaseConfig(database) {
  const missing = [];
  const fieldKeys = {
    database: 'NAME',
    host: 'HOST',
    password: 'PASSWORD',
    username: 'USERNAME',
  };
  for (const field of ['host', 'database', 'username', 'password']) {
    if (!normalizeField(database[field])) {
      missing.push(`SDKWORK_DATABASE_${fieldKeys[field]}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`PostgreSQL configuration requires ${missing.join(', ')}`);
  }
  validateWorkspacePostgresIdentity(database);
}

function canonicalDatabaseProfile(database) {
  if (database === 'sdkwork_ai_dev') {
    return { environment: 'development', username: 'sdkwork_ai_dev' };
  }
  if (database === 'sdkwork_ai_test') {
    return { environment: 'test', username: 'sdkwork_ai_test' };
  }
  if (/^sdkwork_ai_test_[A-Za-z0-9_]+$/u.test(database)) {
    return { environment: 'test', username: 'sdkwork_ai_test' };
  }
  if (database === 'sdkwork_ai_staging') {
    return { environment: 'staging', username: 'sdkwork_ai_staging' };
  }
  if (database === 'sdkwork_ai_prod') {
    return { environment: 'production', username: 'sdkwork_ai_prod' };
  }
  return undefined;
}

export function validateWorkspacePostgresIdentity({ database, schema, username }) {
  const profile = canonicalDatabaseProfile(database);
  if (!profile) {
    throw new Error(
      `PostgreSQL database ${JSON.stringify(database)} is not a canonical SDKWork workspace identity`,
    );
  }
  if (schema !== database) {
    throw new Error(
      `SDKWORK_DATABASE_SCHEMA must equal workspace database ${JSON.stringify(database)}, got ${JSON.stringify(schema)}`,
    );
  }
  if (username !== profile.username) {
    throw new Error(
      `${profile.environment} database ${JSON.stringify(database)} requires username ${JSON.stringify(profile.username)}, got ${JSON.stringify(username)}`,
    );
  }
}

function validateAdminConfig(admin) {
  const missing = [];
  for (const field of ['host', 'database', 'username']) {
    if (!normalizeField(admin[field])) {
      missing.push(`SDKWORK_DATABASE_ADMIN_${field.toUpperCase()}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`PostgreSQL initialization requires ${missing.join(', ')}`);
  }
}

export function validateAdminExecutionConfig(admin) {
  validateAdminConfig(admin);
  if (!normalizeField(admin.password)) {
    throw new Error(
      'PostgreSQL initialization requires SDKWORK_DATABASE_ADMIN_PASSWORD or SDKWORK_DATABASE_ADMIN_URL',
    );
  }
}

export function parseWorkspacePostgresConfig({
  configPath = 'config/host/postgres.env',
  configText,
  repoRoot = process.cwd(),
} = {}) {
  const resolvedConfigPath = resolveConfigPath(configPath, repoRoot);
  const sourceText = configText ?? fs.readFileSync(resolvedConfigPath, 'utf8');
  const env = parseDotEnv(sourceText);
  rejectRetiredDatabaseKeys(env);
  const database = buildConnectionFromEnv(env);
  const admin = buildAdminFromEnv(env, database);
  const config = {
    admin,
    database,
    source: {
      format: 'env',
      path: resolvedConfigPath,
    },
  };
  validateDatabaseConfig(config.database);
  validateAdminConfig(config.admin);
  return config;
}

function encodePostgresDatabaseName(database) {
  return encodeURIComponent(database).replaceAll('%2F', '/');
}

export function buildPostgresDatabaseUrl(database) {
  const host = normalizeField(database.host);
  const dbName = normalizeField(database.database);
  const username = normalizeField(database.username);
  const password = normalizeField(database.password);
  const port = normalizeField(database.port);
  const credentials = `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}`;
  const authority = `${credentials}@${host}${port ? `:${port}` : ''}`;
  const params = new URLSearchParams();
  if (normalizeField(database.sslmode)) {
    params.set('sslmode', normalizeField(database.sslmode));
  }
  const query = params.toString();
  return `postgresql://${authority}/${encodePostgresDatabaseName(dbName)}${query ? `?${query}` : ''}`;
}

export function sanitizePostgresDatabaseUrl(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return String(value ?? '').replace(/(:\/\/[^:\s]+:)([^@\s]+)(@)/u, '$1***$3');
  }
}

export function workspaceDatabaseEnvFromConfig(config) {
  const database = config.database;
  validateDatabaseConfig(database);
  const url = buildPostgresDatabaseUrl(database);
  return {
    SDKWORK_DATABASE_ENGINE: 'postgresql',
    SDKWORK_DATABASE_HOST: database.host,
    SDKWORK_DATABASE_PORT: database.port,
    SDKWORK_DATABASE_NAME: database.database,
    SDKWORK_DATABASE_SCHEMA: database.schema ?? database.database,
    SDKWORK_DATABASE_USERNAME: database.username,
    SDKWORK_DATABASE_PASSWORD: database.password,
    SDKWORK_DATABASE_SSL_MODE: database.sslmode ?? 'disable',
    SDKWORK_DATABASE_URL: url,
  };
}
