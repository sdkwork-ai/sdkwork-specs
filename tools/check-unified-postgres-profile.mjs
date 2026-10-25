#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_WORKSPACE_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
  '..',
);
let scanRoot = DEFAULT_WORKSPACE_ROOT;

const CANONICAL_CONNECTION_DATABASES = new Set([
  'sdkwork_ai_dev',
  'sdkwork_ai_staging',
  'sdkwork_ai_prod',
]);
const CANONICAL_CONNECTION_USERS = new Set([
  'sdkwork_ai_dev',
  'sdkwork_ai_test',
  'sdkwork_ai_staging',
  'sdkwork_ai_prod',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'target',
  'dist',
  'artifacts',
  'external',
  '.pnpm',
  '.runtime',
  'generated',
  'archive',
  'archives',
  'superpowers',
  'target-test-fixtures',
]);
const SKIP_FILES = new Set([
  path.normalize(path.join(DEFAULT_WORKSPACE_ROOT, 'sdkwork-specs/tools/unify-postgres-profile.mjs')),
  path.normalize(path.join(DEFAULT_WORKSPACE_ROOT, 'sdkwork-specs/tools/check-unified-postgres-profile.mjs')),
]);

const SCAN_SUFFIXES = [
  '.env.example',
  '.env.postgres.example',
  '.toml.example',
  '.yaml.example',
  '.yml.example',
];
const SCAN_DIRS = [
  'configs/topology',
  'etc/topology',
  'deployments/templates',
  'config/server',
  'config/container',
  'config/desktop',
];
const RUNTIME_SCAN_DIRS = [
  '.github',
  'apps',
  'config',
  'crates',
  'deployments',
  'docs',
  'etc',
  'packages',
  'scripts',
  'services',
  'specs',
  'src',
  'tools',
];
const RUNTIME_SCAN_EXTENSIONS = new Set([
  '.bat',
  '.cjs',
  '.cmd',
  '.env',
  '.go',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.kts',
  '.md',
  '.mjs',
  '.ps1',
  '.py',
  '.rs',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const RUNTIME_ROOT_FILES = new Set([
  'package.json',
  'agent.app.config.json',
  'agent.workflow.json',
]);
const RUNTIME_ROOT_SCRIPT_EXTENSIONS = new Set(['.bat', '.cmd', '.ps1', '.sh']);
const TEST_FILE_PATTERN = /(?:^|[.\-_])(?:spec|test|tests)(?:[.\-_]|$)/iu;
const RETIRED_RUNTIME_DATABASE_KEY = /SDKWORK_(?!DATABASE_)(?:[A-Z0-9]+_)+DATABASE_(?:ACQUIRE_TIMEOUT|AUTO_MIGRATE|AUTO_SEED|ENGINE|FILE|HOST|IDLE_TIMEOUT|MAX_CONNECTIONS|MAX_LIFETIME|MIN_CONNECTIONS|MODE|NAME|PASSWORD|PASSWORD_FILE|PATH|PORT|SCHEMA|SEED_LOCALE|SEED_ON_BOOT|SEED_PROFILE|SQLITE_URL|SSL_MODE|SSLMODE|TABLE_PREFIX|URL|USERNAME)\b/gu;
const RETIRED_LEGACY_DATABASE_KEY = /\b(?!SDKWORK_DATABASE_)(?:[A-Z0-9]+_)+DATABASE_(?:ACQUIRE_TIMEOUT|AUTO_MIGRATE|AUTO_SEED|ENGINE|FILE|HOST|IDLE_TIMEOUT|MAX_CONNECTIONS|MAX_LIFETIME|MIN_CONNECTIONS|MODE|NAME|PASSWORD|PASSWORD_FILE|PATH|PORT|SCHEMA|SEED_LOCALE|SEED_ON_BOOT|SEED_PROFILE|SQLITE_URL|SSL_MODE|SSLMODE|TABLE_PREFIX|URL|USERNAME)\b/gu;
const INVALID_WORKSPACE_DATABASE_KEY = /SDKWORK_DATABASE_(?:MODE|TABLE_PREFIX)\b/gu;
const RETIRED_WORKSPACE_DATABASE_PATH_ALIAS = /SDKWORK_DATABASE_PATH\b/gu;
const RETIRED_WORKSPACE_DATABASE_SSLMODE_ALIAS = /SDKWORK_DATABASE_SSLMODE\b/gu;
// SDKWORK_DATABASE_SQLITE_URL is the live client-local connection key
// (ENVIRONMENT_SPEC §7.2), not a retired alias: runtime desktop/native client
// code reads and sets it, and PostgreSQL profile files must not carry it.
const SYMBOLIC_RUNTIME_DATABASE_KEY = /SDKWORK_<[A-Z0-9_-]+>(?:_[A-Z0-9]+)*_DATABASE_/gu;
const DYNAMIC_RUNTIME_DATABASE_KEY = /SDKWORK_(?:\$\{[^}\r\n]+\}|\{[^}\r\n]*\})(?:_[A-Z0-9]+)*_DATABASE_/gu;
const CONCATENATED_RUNTIME_DATABASE_KEY = /SDKWORK_["'`]\s*\+[^;\r\n]+["'`]_[A-Z0-9_]*DATABASE_/gu;
const RETIRED_TEST_POSTGRES_KEY = /\b(?!SDKWORK_DATABASE_TEST_POSTGRES_URL\b)(?:SDKWORK_(?!DATABASE_)[A-Z0-9_]+_(?:TEST_POSTGRES_URL|POSTGRES_TEST_URL)|[A-Z0-9_]+_TEST_POSTGRES_URL)\b/gu;
const RETIRED_RUNTIME_POSTGRES_KEY = /\bSDKWORK_(?!DATABASE_)[A-Z0-9_]+_RUNTIME_POSTGRES_(?:URL|URI)\b/gu;
const RETIRED_KEY_REJECTION_MARKER = 'sdkwork-retired-database-key-rejection';
// Workspace database configuration directory standard (ENVIRONMENT_SPEC §7.3):
// production/staging database config resolves from /etc/sdkwork/database/ on
// Linux (macOS: /Library/Application Support/sdkwork/database, Windows:
// %ProgramData%\sdkwork\database). Per-application paths such as
// /etc/sdkwork/<app>/database.secret are dated migration fallbacks only.
const WORKSPACE_DATABASE_CONFIG_DIR_PATTERN = /\/etc\/sdkwork\/database(?:\/|$|\b)/iu;
const PER_APP_DATABASE_CONFIG_PATH = /\/etc\/sdkwork\/([a-z0-9_-]+)\/(?:[a-z0-9_-]+\.)?database\.(?:secret|toml|env)\b/iu;

function isCheckedInConfigFile(filePath) {
  const normalized = path.normalize(filePath);
  if (SKIP_FILES.has(normalized)) {
    return false;
  }
  const base = path.basename(filePath);
  if (SCAN_SUFFIXES.some((suffix) => base.endsWith(suffix))) {
    return true;
  }
  if (base === '.env.postgres.example') {
    return true;
  }
  if (
    (
      filePath.includes(`${path.sep}etc${path.sep}topology${path.sep}`)
      || filePath.includes(`${path.sep}configs${path.sep}topology${path.sep}`)
    )
    && base.endsWith('.env')
  ) {
    return true;
  }
  if (filePath.includes(`${path.sep}deployments${path.sep}templates${path.sep}`)) {
    return true;
  }
  if (filePath.includes(`${path.sep}bin${path.sep}init-config-server.`)) {
    return true;
  }
  for (const dir of SCAN_DIRS) {
    if (filePath.includes(`${path.sep}${dir.replace('/', path.sep)}${path.sep}`) && base.endsWith('.example')) {
      return true;
    }
  }
  return false;
}

export function shouldSkipDirectory(name, parentDir = '') {
  return SKIP_DIRS.has(name)
    || name.startsWith('node_modules.')
    || (
      path.basename(parentDir).toLowerCase() === '.sdkwork'
      && name.toLowerCase() === 'runtime'
    );
}

function collectFiles(dir, files = []) {
  if (!fs.existsSync(dir)) {
    return files;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkipDirectory(entry.name, dir)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, files);
      continue;
    }
    if (isCheckedInConfigFile(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function isTestSourceFile(filePath) {
  const normalized = filePath.replace(/\\/gu, '/');
  if (/(?:^|\/)tests?(?:\/|$)/iu.test(normalized)) {
    return true;
  }
  return TEST_FILE_PATTERN.test(path.basename(filePath));
}

export function isRuntimeSourceFile(filePath) {
  if (isCheckedInConfigFile(filePath) || isTestSourceFile(filePath)) {
    return false;
  }
  const base = path.basename(filePath);
  if (RUNTIME_ROOT_FILES.has(base)) {
    return true;
  }
  if (base.toLowerCase() === 'dockerfile' || base.toLowerCase().startsWith('dockerfile.')) {
    return true;
  }
  return RUNTIME_SCAN_EXTENSIONS.has(path.extname(base).toLowerCase());
}

export function isRuntimeRootScriptFile(filePath) {
  return RUNTIME_ROOT_SCRIPT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function collectRuntimeSourceFiles(repoRoot) {
  if (path.basename(repoRoot) === 'sdkwork-specs') {
    return [];
  }
  const files = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (shouldSkipDirectory(entry.name, dir)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && isRuntimeSourceFile(fullPath)) {
        files.push(fullPath);
      }
    }
  };

  for (const relativeDir of RUNTIME_SCAN_DIRS) {
    visit(path.join(repoRoot, relativeDir));
  }
  for (const fileName of RUNTIME_ROOT_FILES) {
    const filePath = path.join(repoRoot, fileName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      files.push(filePath);
    }
  }
  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    const filePath = path.join(repoRoot, entry.name);
    if (entry.isFile() && isRuntimeRootScriptFile(filePath)) {
      files.push(filePath);
    }
  }
  return [...new Set(files.map((filePath) => path.normalize(filePath)))];
}

export function inspectRuntimeSourceLine(line, filePath = '') {
  if (line.includes(RETIRED_KEY_REJECTION_MARKER)) {
    return null;
  }
  for (const [pattern, message] of [
    [RETIRED_RUNTIME_DATABASE_KEY, 'retired application/module-prefixed database key; use SDKWORK_DATABASE_*'],
    [RETIRED_WORKSPACE_DATABASE_PATH_ALIAS, 'retired workspace database alias; use SDKWORK_DATABASE_FILE or SDKWORK_DATABASE_SQLITE_URL'],
    [RETIRED_WORKSPACE_DATABASE_SSLMODE_ALIAS, 'retired workspace database alias; use SDKWORK_DATABASE_SSL_MODE'],
    [INVALID_WORKSPACE_DATABASE_KEY, 'unsupported workspace database key; mode and table ownership are module contracts, not connection env'],
    [SYMBOLIC_RUNTIME_DATABASE_KEY, 'symbolic application/module-prefixed database key is forbidden'],
    [DYNAMIC_RUNTIME_DATABASE_KEY, 'dynamic application/module-prefixed database key construction is forbidden'],
    [CONCATENATED_RUNTIME_DATABASE_KEY, 'concatenated application/module-prefixed database key construction is forbidden'],
    [RETIRED_TEST_POSTGRES_KEY, 'retired test PostgreSQL key; use SDKWORK_DATABASE_TEST_POSTGRES_URL'],
    [RETIRED_RUNTIME_POSTGRES_KEY, 'retired runtime PostgreSQL key; use SDKWORK_DATABASE_URL'],
  ]) {
    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (match) {
      return `${message}: ${match[0]}`;
    }
  }

  RETIRED_LEGACY_DATABASE_KEY.lastIndex = 0;
  for (const match of line.matchAll(RETIRED_LEGACY_DATABASE_KEY)) {
    const token = match[0];
    const index = match.index ?? 0;
    const before = line[index - 1];
    const after = line[index + token.length];
    const quoted = ['"', "'", '`'].includes(before) && after === before;
    const assignmentSuffix = line.slice(index + token.length).trimStart();
    const assigned = line.slice(0, index).trim() === ''
      && (assignmentSuffix.startsWith('=') || assignmentSuffix.startsWith(':'));
    if (quoted || assigned) {
      return `retired legacy database key; use SDKWORK_DATABASE_*: ${token}`;
    }
  }

  const trimmed = line.trim();
  const postgresIdentityIssue = inspectPostgresIdentityAssignment(trimmed, filePath);
  if (postgresIdentityIssue) {
    return postgresIdentityIssue;
  }

  const isYaml = ['.yaml', '.yml'].includes(path.extname(filePath).toLowerCase());
  const yamlDatabaseAssignment = isYaml
    ? trimmed.match(/^(SDKWORK_DATABASE_[A-Z0-9_]+):\s*(.+)$/u)
    : null;
  if (isYaml && yamlDatabaseAssignment) {
    return inspectLine(
      `${yamlDatabaseAssignment[1]}=${yamlDatabaseAssignment[2]}`,
      filePath,
    );
  }
  const databaseConfigPathIssue = inspectWorkspaceDatabaseConfigPath(line, filePath);
  if (databaseConfigPathIssue) {
    return databaseConfigPathIssue;
  }
  return null;
}

function inspectRuntimeSourceFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
  const issues = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const issue = inspectRuntimeSourceLine(line, filePath);
    if (issue) {
      issues.push(`${path.relative(scanRoot, filePath)}:${index + 1}: ${issue}`);
    }
  }
  return issues;
}

function isWorkspaceTestIdentity(value) {
  return value === 'sdkwork_ai_test_<run_id>'
    || /^sdkwork_ai_test(?:_[a-z0-9]+(?:_[a-z0-9]+)*)?$/u.test(value);
}

function isCanonicalWorkspaceDatabase(value) {
  return CANONICAL_CONNECTION_DATABASES.has(value) || isWorkspaceTestIdentity(value);
}

function expectedConnectionIdentity(filePath) {
  const normalized = filePath.replace(/\\/gu, '/').toLowerCase();
  if (normalized.includes('/.github/workflows/')) {
    return {
      isTest: true,
      label: 'sdkwork_ai_test or sdkwork_ai_test_<run_id>',
      username: 'sdkwork_ai_test',
    };
  }
  if (normalized.includes('production')) {
    return {
      database: 'sdkwork_ai_prod',
      label: 'sdkwork_ai_prod',
      schema: 'sdkwork_ai_prod',
      username: 'sdkwork_ai_prod',
    };
  }
  if (normalized.includes('staging')) {
    return {
      database: 'sdkwork_ai_staging',
      label: 'sdkwork_ai_staging',
      schema: 'sdkwork_ai_staging',
      username: 'sdkwork_ai_staging',
    };
  }
  if (normalized.includes('test')) {
    return {
      isTest: true,
      label: 'sdkwork_ai_test or sdkwork_ai_test_<run_id>',
      username: 'sdkwork_ai_test',
    };
  }
  if (
    normalized.includes('development')
    || ['.env.example', '.env.postgres.example'].includes(path.basename(filePath).toLowerCase())
  ) {
    return {
      database: 'sdkwork_ai_dev',
      label: 'sdkwork_ai_dev',
      schema: 'sdkwork_ai_dev',
      username: 'sdkwork_ai_dev',
    };
  }
  return null;
}

function matchesExpectedConnection(value, expected, field = 'database') {
  if (!expected) {
    return field === 'username'
      ? CANONICAL_CONNECTION_USERS.has(value)
      : isCanonicalWorkspaceDatabase(value);
  }
  if (expected.isTest) {
    return field === 'username'
      ? value === expected.username
      : isWorkspaceTestIdentity(value);
  }
  return value === expected[field];
}

function unquoteValue(value) {
  const trimmed = String(value ?? '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function inspectPostgresIdentityAssignment(line, filePath) {
  const match = line.match(/^POSTGRES_(DB|USER)\s*[:=]\s*["']?([^"'#\s]+)["']?/u);
  if (!match || match[2].includes('${')) {
    return null;
  }
  const [, field, value] = match;
  const expected = expectedConnectionIdentity(filePath);
  const normalizedField = field === 'DB' ? 'database' : 'username';
  if (matchesExpectedConnection(value, expected, normalizedField)) {
    return null;
  }
  const expectedValue = expected?.[normalizedField]
    ?? expected?.label
    ?? 'a canonical workspace PostgreSQL identity';
  return `non-canonical POSTGRES_${field}=${value}; expected ${expectedValue}`;
}

// Repository names whose canonical application code differs from the
// sdkwork-<name> derivation (RUNTIME_DIRECTORY_SPEC.md section 3).
const REPO_APP_CODE_OVERRIDES = {
  'sdkwork-cloudrouter': 'router',
  'sdkwork-im': 'im',
};

function repoAppCodeFor(filePath) {
  const segments = String(filePath).split(/[\\/]/u).filter(Boolean);
  const repoSegment = segments
    .filter((segment) => /^sdkwork-/iu.test(segment))
    .at(-1);
  if (repoSegment) {
    const repoName = repoSegment.toLowerCase();
    return REPO_APP_CODE_OVERRIDES[repoName] ?? repoSegment.replace(/^sdkwork-/iu, '');
  }
  return path.basename(scanRoot).replace(/^sdkwork-/, '');
}

function inspectWorkspaceDatabaseConfigPath(line, filePath) {
  const normalized = String(line).replace(/\\/gu, '/');
  if (!/\/etc\/sdkwork\//iu.test(normalized)) {
    return null;
  }
  if (WORKSPACE_DATABASE_CONFIG_DIR_PATTERN.test(normalized)) {
    return null;
  }
  if (normalized.includes('/run/secrets/')) {
    return null;
  }
  PER_APP_DATABASE_CONFIG_PATH.lastIndex = 0;
  const match = PER_APP_DATABASE_CONFIG_PATH.exec(normalized);
  if (!match) {
    return null;
  }
  const referenced = match[1].toLowerCase();
  if (referenced === 'database') {
    return null;
  }
  const appCode = repoAppCodeFor(filePath);
  if (referenced === appCode) {
    return 'per-application database secret path is a dated migration fallback; use /etc/sdkwork/database/database.secret (ENVIRONMENT_SPEC section 7.3)';
  }
  return `cross-application database secret path references ${referenced}; use /etc/sdkwork/database/database.secret (ENVIRONMENT_SPEC section 7.3)`;
}

function inspectProductionDatabasePassword(line, filePath, { section } = {}) {
  const trimmed = String(line).trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  if (/^(?:SDKWORK_DATABASE_PASSWORD|password)\s*[:=]\s*"?DEPLOY_INJECT:/iu.test(trimmed)) {
    return 'inline DEPLOY_INJECT database password; use SDKWORK_DATABASE_PASSWORD_FILE=/etc/sdkwork/database/database.secret';
  }
  const normalized = filePath.replace(/\\/gu, '/').toLowerCase();
  if (!/production|staging/u.test(normalized)) {
    return null;
  }
  const normalizedSection = String(section ?? '').trim().toLowerCase();
  const isDatabaseSection = !normalizedSection || normalizedSection === 'database';
  if (
    isDatabaseSection
    && /^password\s*=\s*"/u.test(trimmed)
    && !/change-me|REPLACE|placeholder|DEPLOY_INJECT/iu.test(trimmed)
  ) {
    return 'inline database password in production/staging config; use password_file = "/etc/sdkwork/database/database.secret"';
  }
  return null;
}

function retiredDatabaseKey(line) {
  const candidate = line.trim().replace(/^#\s*/u, '');
  const sdkworkMatch = candidate.match(
    /^(SDKWORK_(?!DATABASE_)([A-Z0-9_]+)_DATABASE_([A-Z0-9_]+))\s*=/u,
  );
  if (sdkworkMatch) {
    return `retired application/module-prefixed database key ${sdkworkMatch[1]}; use SDKWORK_DATABASE_*`;
  }
  RETIRED_LEGACY_DATABASE_KEY.lastIndex = 0;
  const legacyMatch = RETIRED_LEGACY_DATABASE_KEY.exec(candidate);
  if (legacyMatch && candidate.slice(legacyMatch.index + legacyMatch[0].length).trimStart().startsWith('=')) {
    return `retired legacy database key ${legacyMatch[0]}; use SDKWORK_DATABASE_*`;
  }
  return null;
}

export function inspectLine(line, filePath, { section } = {}) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const retiredKeyIssue = retiredDatabaseKey(trimmed);
  if (retiredKeyIssue) {
    return retiredKeyIssue;
  }

  const databaseConfigPathIssue = inspectWorkspaceDatabaseConfigPath(line, filePath);
  if (databaseConfigPathIssue) {
    return databaseConfigPathIssue;
  }

  if (trimmed.startsWith('#')) {
    return null;
  }

  const productionPasswordIssue = inspectProductionDatabasePassword(line, filePath, { section });
  if (productionPasswordIssue) {
    return productionPasswordIssue;
  }

  if (trimmed.includes('${') || trimmed.includes('DEPLOY_INJECT:') || /sqlite:\/\//u.test(trimmed)) {
    return null;
  }

  if (/^SDKWORK_DATABASE_SSLMODE\s*=/u.test(trimmed)) {
    return 'retired SDKWORK_DATABASE_SSLMODE key; use SDKWORK_DATABASE_SSL_MODE';
  }
  if (/^(?:DATABASE_PROVIDER|DATABASE_SSLMODE)\s*=/u.test(trimmed)) {
    return 'retired database key; use SDKWORK_DATABASE_ENGINE or SDKWORK_DATABASE_SSL_MODE';
  }

  const postgresIdentityIssue = inspectPostgresIdentityAssignment(trimmed, filePath);
  if (postgresIdentityIssue) {
    return postgresIdentityIssue;
  }

  const workspaceIdentity = trimmed.match(
    /^SDKWORK_DATABASE_(NAME|SCHEMA|USERNAME)\s*=\s*(.+)$/u,
  );
  if (workspaceIdentity) {
    const field = workspaceIdentity[1];
    const value = unquoteValue(workspaceIdentity[2]);
    const normalizedField = field === 'NAME' ? 'database' : field.toLowerCase();
    const expected = expectedConnectionIdentity(filePath);
    const isAllowed = matchesExpectedConnection(value, expected, normalizedField);
    if (!isAllowed) {
      return `non-canonical SDKWORK_DATABASE_${field}=${value}; expected ${expected?.label ?? 'sdkwork_ai_dev, sdkwork_ai_test, sdkwork_ai_staging, or sdkwork_ai_prod'}`;
    }
  }

  const schemaFallback = trimmed.match(
    /^SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC\s*=\s*(.+)$/u,
  );
  if (schemaFallback) {
    const value = unquoteValue(schemaFallback[1]).toLowerCase();
    const requiresCanonicalLiteral = path.basename(filePath).toLowerCase()
      === '.env.postgres.example';
    if (
      (requiresCanonicalLiteral && value !== 'false')
      || (!requiresCanonicalLiteral && !['0', 'false', 'no'].includes(value))
    ) {
      return 'SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC must be false for canonical-only schema resolution';
    }
  }

  const normalizedSection = String(section ?? '').trim().toLowerCase();
  const isDatabaseSection = !normalizedSection || normalizedSection === 'database';
  const isDatabaseAdminSection = normalizedSection.startsWith('database.admin')
    || normalizedSection.startsWith('database_admin');

  const dbMatch = isDatabaseSection && trimmed.match(/^database = "([^"]+)"/u);
  if (dbMatch) {
    const value = dbMatch[1];
    const expected = expectedConnectionIdentity(filePath);
    if (!matchesExpectedConnection(value, expected, 'database')) {
      return `non-canonical database = "${value}"; expected ${expected?.label ?? 'a canonical workspace PostgreSQL database'}`;
    }
  }

  const userMatch = isDatabaseSection && trimmed.match(/^username = "([^"]+)"/u);
  if (userMatch) {
    const value = userMatch[1];
    const expected = expectedConnectionIdentity(filePath);
    if (!matchesExpectedConnection(value, expected, 'username')) {
      return `non-canonical username = "${value}"; expected ${expected?.username ?? 'a canonical workspace PostgreSQL user'}`;
    }
  }

  const schemaMatch = isDatabaseSection && trimmed.match(/^schema = "([^"]+)"/u);
  if (schemaMatch) {
    const value = schemaMatch[1];
    const expected = expectedConnectionIdentity(filePath);
    if (!matchesExpectedConnection(value, expected, 'schema')) {
      return `non-canonical schema = "${value}"; expected ${expected?.label ?? 'a canonical workspace PostgreSQL schema'}`;
    }
  }

  const databaseUrlMatch = !isDatabaseAdminSection && trimmed.match(
    /^(?:SDKWORK_DATABASE_URL|SDKWORK_[A-Z0-9_]+_DATABASE_URL|url)\s*[:=]\s*"?postgres(?:ql)?:\/\/[^/\s"]+\/([^?&\s"]+)/iu,
  );
  if (databaseUrlMatch) {
    const value = decodeURIComponent(databaseUrlMatch[1]);
    const expected = expectedConnectionIdentity(filePath);
    if (
      (expected && !matchesExpectedConnection(value, expected, 'database'))
      || (
        !expected
        && !isCanonicalWorkspaceDatabase(value)
      )
    ) {
      return `non-canonical PostgreSQL URL database=${value}; expected ${expected?.label ?? 'a canonical workspace PostgreSQL database'}`;
    }
  }

  const isDatabaseAssignment = /^(?:[A-Z0-9_]*(?:DATABASE|POSTGRES)[A-Z0-9_]*|database|username)\s*=/u
    .test(trimmed);
  if (
    isDatabaseAssignment
    && /sdkwork_(?!ai_(?:dev|test|staging|prod)(?:\b|_))[a-z0-9_]+_(?:dev|test|staging|prod)\b/iu.test(trimmed)
  ) {
    return 'application-specific database identity; use the workspace sdkwork_ai_<environment> identity';
  }
  if (
    isDatabaseAssignment
    && /sdkwork_chat_prod|sdkwork_knowledgebase_(dev|prod)|sdkwork_news_dev|sdkwork_forum_dev|sdkwork_discovery|sdkwork_documents(_dev)?|sdkwork_rtc|sdkwork_ai_prod_ai_dev/u.test(trimmed)
  ) {
    return 'legacy per-app database identity';
  }

  if (/sdkworkprod(@|%40)2026(\+\+|%2B%2B)/u.test(trimmed)) {
    return 'legacy mistaken password-as-username profile';
  }

  if (/^SDKWORK_DATABASE_(NAME|USERNAME|SCHEMA)=sdkwork$/u.test(trimmed)) {
    return 'legacy bare sdkwork production identity';
  }

  if (/^database = "sdkwork"$/u.test(trimmed) || /^username = "sdkwork"$/u.test(trimmed)) {
    return 'legacy bare sdkwork production identity';
  }

  if (/^SDKWORK_DATABASE_SCHEMA=public$/u.test(trimmed)) {
    return 'legacy public schema production profile';
  }

  if (/^SDKWORK_DATABASE_HOST=\[::1\]$/u.test(trimmed)) {
    return 'non-canonical loopback host; use 127.0.0.1 per env.postgres.example';
  }

  if (/^schema = "public"$/u.test(trimmed) && /production|\.production\./u.test(filePath)) {
    return 'legacy public schema production profile';
  }

  return null;
}

const REQUIRED_WORKSPACE_ENV_KEYS = [
  'SDKWORK_DATABASE_ENGINE',
  'SDKWORK_DATABASE_HOST',
  'SDKWORK_DATABASE_PORT',
  'SDKWORK_DATABASE_NAME',
  'SDKWORK_DATABASE_SCHEMA',
  'SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC',
  'SDKWORK_DATABASE_USERNAME',
  'SDKWORK_DATABASE_SSL_MODE',
  'SDKWORK_DATABASE_MAX_CONNECTIONS',
  'SDKWORK_DATABASE_ADMIN_HOST',
  'SDKWORK_DATABASE_ADMIN_PORT',
  'SDKWORK_DATABASE_ADMIN_USERNAME',
  'SDKWORK_DATABASE_ADMIN_PASSWORD',
  'SDKWORK_DATABASE_ADMIN_DATABASE',
  'SDKWORK_DATABASE_ADMIN_SSL_MODE',
];

const ALLOWED_WORKSPACE_ENV_KEYS = new Set([
  ...REQUIRED_WORKSPACE_ENV_KEYS,
  'SDKWORK_DATABASE_PASSWORD',
  'SDKWORK_DATABASE_URL',
  'SDKWORK_DATABASE_FILE',
  'SDKWORK_DATABASE_PASSWORD_FILE',
  'SDKWORK_DATABASE_MIN_CONNECTIONS',
  'SDKWORK_DATABASE_ACQUIRE_TIMEOUT',
  'SDKWORK_DATABASE_IDLE_TIMEOUT',
  'SDKWORK_DATABASE_MAX_LIFETIME',
  'SDKWORK_DATABASE_MODULE_ID',
  'SDKWORK_DATABASE_AUTO_MIGRATE',
  'SDKWORK_DATABASE_AUTO_SEED',
  'SDKWORK_DATABASE_SEED_ON_BOOT',
  'SDKWORK_DATABASE_SEED_LOCALE',
  'SDKWORK_DATABASE_SEED_PROFILE',
  'SDKWORK_DATABASE_SEED_I18N_VERSION',
  'SDKWORK_DATABASE_DRIFT_INTERVAL_SEC',
  'SDKWORK_DATABASE_TEMPORARY_ANY_POOL_EXCEPTION',
  'SDKWORK_DATABASE_TEMPORARY_DRIVER_POOL_COUNT',
  'SDKWORK_DATABASE_ADMIN_URL',
  'SDKWORK_DATABASE_ADMIN_PASSWORD_FILE',
]);

export function inspectPostgresExampleFile(filePath, content) {
  const issues = [];
  if (path.basename(filePath) !== '.env.postgres.example') {
    return issues;
  }
  const keys = new Set();
  const keyCounts = new Map();
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const issue = inspectLine(line, filePath);
    if (issue) {
      issues.push(`${path.relative(scanRoot, filePath)}: ${issue}`);
    }
    if (trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^([A-Z0-9_]+)=/u);
    if (match) {
      keys.add(match[1]);
      keyCounts.set(match[1], (keyCounts.get(match[1]) ?? 0) + 1);
      if (match[1].startsWith('SDKWORK_DATABASE_') && !ALLOWED_WORKSPACE_ENV_KEYS.has(match[1])) {
        issues.push(
          `${path.relative(scanRoot, filePath)}: unsupported workspace database key ${match[1]}`,
        );
      }
    }
  }
  for (const requiredKey of REQUIRED_WORKSPACE_ENV_KEYS) {
    if (!keys.has(requiredKey)) {
      issues.push(
        `${path.relative(scanRoot, filePath)}: missing required ${requiredKey}`,
      );
    }
  }
  if (!keys.has('SDKWORK_DATABASE_PASSWORD') && !keys.has('SDKWORK_DATABASE_PASSWORD_FILE')) {
    issues.push(
      `${path.relative(scanRoot, filePath)}: missing database credential; define SDKWORK_DATABASE_PASSWORD or SDKWORK_DATABASE_PASSWORD_FILE`,
    );
  }
  for (const [key, count] of keyCounts) {
    if (count > 1) {
      issues.push(`${path.relative(scanRoot, filePath)}: duplicate ${key}`);
    }
  }
  return issues;
}

function inspectConfigFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (path.basename(filePath) === '.env.postgres.example') {
    return inspectPostgresExampleFile(filePath, content);
  }
  const issues = [];
  let section = '';
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const sectionMatch = line.trim().match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const issue = inspectLine(line, filePath, { section });
    if (issue) {
      issues.push(`${path.relative(scanRoot, filePath)}:${index + 1}: ${issue}`);
    }
  }
  return issues;
}

function inspectPostgresInitScripts(repoRoots) {
  const issues = [];
  for (const repoRoot of repoRoots) {
    const repoName = path.basename(repoRoot);
    const envExample = path.join(repoRoot, '.env.postgres.example');
    if (!fs.existsSync(envExample)) {
      continue;
    }
    const packageJsonPath = path.join(repoRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      issues.push(`${repoName}: has .env.postgres.example but no package.json`);
      continue;
    }
    const packageJsonSource = fs
      .readFileSync(packageJsonPath, 'utf8')
      .replace(/^\uFEFF/u, '');
    const pkg = JSON.parse(packageJsonSource);
    const scripts = pkg.scripts ?? {};
    if (!scripts['db:postgres:init']) {
      issues.push(`${repoName}: missing package.json script db:postgres:init`);
    }
    if (!scripts['db:postgres:plan']) {
      issues.push(`${repoName}: missing package.json script db:postgres:plan`);
    }
  }
  return issues;
}

function resolveScanRoot(args) {
  const rootIndex = args.indexOf('--root');
  if (rootIndex === -1) {
    return DEFAULT_WORKSPACE_ROOT;
  }
  const value = args[rootIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--root requires a repository or workspace path');
  }
  return path.resolve(process.cwd(), value);
}

function repositoryRoots(root) {
  const rootName = path.basename(root);
  const childRepositories = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name.startsWith('sdkwork-') || entry.name === 'sdkwork-specs')
    .map((entry) => path.join(root, entry.name));
  if (childRepositories.length === 0) {
    return [root];
  }
  if (rootName === 'sdkwork-specs') {
    return [root];
  }
  return [root, ...childRepositories];
}

function main(args = process.argv.slice(2)) {
  scanRoot = resolveScanRoot(args);
  if (!fs.existsSync(scanRoot) || !fs.statSync(scanRoot).isDirectory()) {
    throw new Error(`scan root is not a directory: ${scanRoot}`);
  }
  const repoRoots = repositoryRoots(scanRoot);
  const violations = [];
  for (const repoRoot of repoRoots) {
    for (const filePath of collectFiles(repoRoot)) {
      violations.push(...inspectConfigFile(filePath));
    }
    for (const filePath of collectRuntimeSourceFiles(repoRoot)) {
      violations.push(...inspectRuntimeSourceFile(filePath));
    }
  }
  violations.push(...inspectPostgresInitScripts(repoRoots));

  const uniqueViolations = [...new Set(violations)];

  if (uniqueViolations.length > 0) {
    process.stderr.write('Unified PostgreSQL profile violations found:\n');
    for (const violation of uniqueViolations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.stderr.write('\nCanonical dev: sdkwork_ai_dev / SDKWORK_DATABASE_*\n');
    process.stderr.write('Canonical test: sdkwork_ai_test or sdkwork_ai_test_<run_id> / SDKWORK_DATABASE_*\n');
    process.stderr.write('Canonical staging: sdkwork_ai_staging / SDKWORK_DATABASE_*\n');
    process.stderr.write('Canonical prod: sdkwork_ai_prod / SDKWORK_DATABASE_*\n');
    process.stderr.write('Production database config directory: /etc/sdkwork/database/ (ENVIRONMENT_SPEC section 7.3; macOS /Library/Application Support/sdkwork/database, Windows %ProgramData%\\sdkwork\\database)\n');
    process.stderr.write('Templates: sdkwork-specs/templates/env.postgres.example and env.postgres.production.example\n');
    process.exit(1);
  }

  process.stdout.write('Unified PostgreSQL profile check passed.\n');
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
