#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'de-DE', 'fr-FR', 'ru-RU', 'ko-KR'];
const REQUIRED_DB_SCRIPTS = [
  'db:validate',
  'db:plan',
  'db:init',
  'db:migrate',
  'db:seed',
  'db:status',
  'db:drift',
  'db:drift:check',
];
const AUTHORITATIVE_DB_SCRIPTS = ['db:materialize:contract', 'db:bootstrap'];
const MANIFEST_SCHEMA_VERSION = 2;
const AUTHORITATIVE_ROLE = 'authoritative-server';
const CLIENT_LOCAL_ROLE = 'client-local';
const CLIENT_LOCAL_MODES = new Set(['cache', 'offline-projection', 'local-only']);
const BASELINE_STRATEGIES = new Set([
  'migrations-only',
  'baseline-plus-migrations',
  'baseline-only-dev',
]);
const SEMVER_PATTERN = new RegExp(
  [
    '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)',
    '(?:-(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)',
    '(?:\\.(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*))*)?',
    '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
  ].join(''),
  'u',
);
const FORBIDDEN_APPLICATION_PROVISIONING_SQL = /\b(?:CREATE|DROP|ALTER)\s+(?:DATABASE|SCHEMA)\b/iu;

function parseArgs(argv) {
  const args = { root: process.cwd(), layout: 'application' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      args.root = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (token === '--layout') {
      args.layout = argv[index + 1] ?? 'application';
      index += 1;
    }
  }
  return args;
}

function existsAt(baseDir, relativePath) {
  return fs.existsSync(path.join(baseDir, relativePath));
}

function directoryContainsFiles(directory) {
  if (!fs.existsSync(directory)) return false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && directoryContainsFiles(path.join(directory, entry.name))) return true;
  }
  return false;
}

function readJsonAt(baseDir, relativePath) {
  const absolutePath = path.join(baseDir, relativePath);
  return parseJsonFile(absolutePath);
}

function parseJsonFile(absolutePath) {
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function primaryManifestPrefix(manifest) {
  if (Array.isArray(manifest.tablePrefixes) && manifest.tablePrefixes.length > 0) {
    return manifest.tablePrefixes[0];
  }
  return manifest.tablePrefix ?? null;
}

/**
 * Section 6.1: a root declares its owned prefix families either as a single
 * `tablePrefix` or as a non-empty `tablePrefixes` array whose first entry is
 * primary. Every declared family must be registered in `prefix-registry.json`.
 */
function declaredManifestPrefixes(manifest) {
  if (Array.isArray(manifest.tablePrefixes) && manifest.tablePrefixes.length > 0) {
    return manifest.tablePrefixes.filter(isNonEmptyString);
  }
  return isNonEmptyString(manifest.tablePrefix) ? [manifest.tablePrefix] : [];
}

function isValidSemver(value) {
  return isNonEmptyString(value) && SEMVER_PATTERN.test(value);
}

function isExactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function expectedEngineForRole(role) {
  if (role === AUTHORITATIVE_ROLE) return 'postgres';
  if (role === CLIENT_LOCAL_ROLE) return 'sqlite';
  return null;
}

function readTopLevelYamlScalarAt(baseDir, relativePath, key) {
  const absolutePath = path.join(baseDir, relativePath);
  const text = fs.readFileSync(absolutePath, 'utf8');
  const pattern = new RegExp(
    `^${key}:\\s*(?:"([^"\\r\\n]+)"|'([^'\\r\\n]+)'|([^\\s#]+))\\s*(?:#.*)?$`,
    'mu',
  );
  const match = text.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function normalizeSimpleYamlScalar(value) {
  const withoutComment = value.trim().replace(/\s+#.*$/u, '').trim();
  if (/^(?:null|~)$/iu.test(withoutComment)) return null;
  const quoted = withoutComment.match(/^(?:"([^"]*)"|'([^']*)')$/u);
  return quoted ? quoted[1] ?? quoted[2] : withoutComment;
}

function readSimpleYamlAt(baseDir, relativePath) {
  const absolutePath = path.join(baseDir, relativePath);
  const scalars = new Map();
  const sequences = new Map();
  const stack = [];

  for (const rawLine of fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/u)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.match(/^ */u)?.[0].length ?? 0;
    if (indent % 2 !== 0) continue;
    const level = indent / 2;
    const line = rawLine.trim();
    const sequenceMatch = line.match(/^-\s+(.+?)\s*$/u);
    if (sequenceMatch) {
      const sequencePath = stack.slice(0, level).join('.');
      if (sequencePath) {
        const values = sequences.get(sequencePath) ?? [];
        values.push(normalizeSimpleYamlScalar(sequenceMatch[1]));
        sequences.set(sequencePath, values);
      }
      continue;
    }

    const scalarMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/u);
    if (!scalarMatch) continue;
    const [, key, rawValue = ''] = scalarMatch;
    stack.length = level;
    const keyPath = [...stack, key].join('.');
    if (rawValue.trim()) {
      scalars.set(keyPath, normalizeSimpleYamlScalar(rawValue));
    } else {
      stack[level] = key;
      stack.length = level + 1;
    }
  }

  return { scalars, sequences };
}

function validateClientLocalPolicy(moduleRootDir, manifest, fail) {
  let policy;
  try {
    policy = readSimpleYamlAt(moduleRootDir, 'local-data-policy.yaml');
  } catch (error) {
    fail(`local-data-policy.yaml must be readable (${error.message})`);
    return;
  }

  const scalar = (key) => policy.scalars.get(key);
  if (scalar('kind') !== 'sdkwork.database.client-local-policy') {
    fail('local-data-policy.yaml kind must be sdkwork.database.client-local-policy');
  }
  if (scalar('mode') !== manifest.clientLocal?.mode) {
    fail('local-data-policy.yaml mode must match database.manifest.json clientLocal.mode');
  }
  if (scalar('scope') !== manifest.clientLocal?.scope) {
    fail('local-data-policy.yaml scope must match database.manifest.json clientLocal.scope');
  }
  if (scalar('authoritative_source') !== manifest.clientLocal?.authoritativeSource) {
    fail(
      'local-data-policy.yaml authoritative_source must match database.manifest.json clientLocal.authoritativeSource',
    );
  }
  if (
    manifest.clientLocal?.mode === 'offline-projection'
    && scalar('sync_contract') !== manifest.clientLocal.syncContract
  ) {
    fail('local-data-policy.yaml sync_contract must match the offline-projection sync contract');
  }

  for (const key of [
    'security.encryption_at_rest',
    'security.key_store',
    'security.backup',
    'security.export',
    'security.lock_state',
    'retention.policy',
    'retention.max_age_or_event',
    'lifecycle.logout',
    'lifecycle.account_switch',
    'lifecycle.uninstall',
    'recovery.migration_interruption',
    'recovery.disk_full',
    'recovery.corruption',
    'recovery.projection_rebuild',
  ]) {
    if (!isNonEmptyString(scalar(key))) {
      fail(`local-data-policy.yaml ${key} must be defined`);
    }
  }
}

function validateLocaleSetManifest(seedManifest, fail) {
  if (!isNonEmptyString(seedManifest.i18nVersion)) {
    fail('seeds/seed.manifest.json i18nVersion must be defined');
  }
  if (!isNonEmptyString(seedManifest.fallbackLocale)) {
    fail('seeds/seed.manifest.json fallbackLocale must be defined');
  }
  const supportedLocales = Array.isArray(seedManifest.supportedLocales) ? seedManifest.supportedLocales : [];
  const activeLocales = Array.isArray(seedManifest.activeLocales) ? seedManifest.activeLocales : [];
  if (supportedLocales.length === 0) {
    fail('seeds/seed.manifest.json supportedLocales must be non-empty');
  }
  if (activeLocales.length === 0) {
    fail('seeds/seed.manifest.json activeLocales must be non-empty');
  }
  for (const locale of [seedManifest.defaultLocale, seedManifest.fallbackLocale, ...activeLocales]) {
    if (locale && !supportedLocales.includes(locale)) {
      fail(`seeds/seed.manifest.json locale ${locale} must be listed in supportedLocales`);
    }
  }
  if (!seedManifest.localeSets || typeof seedManifest.localeSets !== 'object' || Array.isArray(seedManifest.localeSets)) {
    fail('seeds/seed.manifest.json localeSets must be defined');
    return;
  }
  for (const locale of activeLocales) {
    const localeSet = seedManifest.localeSets[locale];
    if (!localeSet) {
      fail(`seeds/seed.manifest.json localeSets.${locale} must be defined for active locale`);
      continue;
    }
    if (!isNonEmptyString(localeSet.version)) {
      fail(`seeds/seed.manifest.json localeSets.${locale}.version must be defined`);
    }
    if (!isNonEmptyString(localeSet.checksum)) {
      fail(`seeds/seed.manifest.json localeSets.${locale}.checksum must be defined`);
    }
    if (!Array.isArray(localeSet.files)) {
      fail(`seeds/seed.manifest.json localeSets.${locale}.files must be an array`);
    }
  }
}

function listBaselineSqlFiles(moduleRootDir, engine) {
  const baselineDir = path.join(moduleRootDir, 'ddl/baseline', engine);
  if (!fs.existsSync(baselineDir)) {
    return [];
  }
  return fs
    .readdirSync(baselineDir)
    .filter((entry) => entry.endsWith('.sql'))
    .sort();
}

function listMigrationUpSqlFiles(moduleRootDir, engine) {
  const migrationDir = path.join(moduleRootDir, 'migrations', engine);
  if (!fs.existsSync(migrationDir)) return [];
  return fs.readdirSync(migrationDir).filter((entry) => entry.endsWith('.up.sql')).sort();
}

function validateBaselineSourceEngines(moduleRootDir, engine, baselineFiles, fail) {
  const foreignEngine = engine === 'postgres' ? 'sqlite' : 'postgres';
  const foreignSource = new RegExp(
    `^--\\s*(?:baseline source|folded migration|source):\\s+.*(?:^|[/\\\\])${foreignEngine}(?:[/\\\\]|$)`,
    'imu',
  );
  for (const fileName of baselineFiles) {
    const sql = fs.readFileSync(path.join(moduleRootDir, 'ddl/baseline', engine, fileName), 'utf8');
    if (foreignSource.test(sql)) {
      fail(
        `ddl/baseline/${engine}/${fileName} must not contain ${foreignEngine} source provenance or DDL`,
      );
    }
    validateApplicationOwnedSql(
      sql,
      `ddl/baseline/${engine}/${fileName}`,
      fail,
    );
  }
}

function validateApplicationOwnedSql(sql, relativePath, fail) {
  const match = sql.match(FORBIDDEN_APPLICATION_PROVISIONING_SQL);
  if (match) {
    fail(
      `${relativePath} must not contain ${match[0].toUpperCase()}; application lifecycle assets manage only module-owned objects inside the shared schema`,
    );
  }
}

/**
 * Organization id column contract (DATABASE_SPEC.md DB089-DB093).
 *
 * Every `organization_id` column in baseline DDL must be NOT NULL with the
 * platform sentinel default:
 * - BIGINT/INTEGER -> NOT NULL DEFAULT 0
 * - TEXT/VARCHAR(n) -> NOT NULL DEFAULT '0'
 * - UUID -> NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'
 *
 * Different fields (parent_/merchant_/definition_organization_id, ...) are
 * scoped by their own domain contract and are skipped.
 */
const ORGANIZATION_ID_COLUMN_PATTERN = /\borganization_id\s+(TEXT|VARCHAR\(\d+\)|BIGINT|UUID|INTEGER)/gmu;
const ORGANIZATION_ID_SENTINEL_BY_TYPE = {
  BIGINT: /\bNOT NULL\b[\s\S]*?\bDEFAULT\s+0\b/iu,
  INTEGER: /\bNOT NULL\b[\s\S]*?\bDEFAULT\s+0\b/iu,
  TEXT: /\bNOT NULL\b[\s\S]*?\bDEFAULT\s+'0'/iu,
  VARCHAR: /\bNOT NULL\b[\s\S]*?\bDEFAULT\s+'0'/iu,
  UUID: /\bNOT NULL\b[\s\S]*?\bDEFAULT\s+'00000000-0000-0000-0000-000000000000'/iu,
};

function validateOrganizationIdContract(moduleRootDir, engine, baselineFiles, fail) {
  for (const fileName of baselineFiles) {
    const sql = fs.readFileSync(path.join(moduleRootDir, 'ddl/baseline', engine, fileName), 'utf8');
    ORGANIZATION_ID_COLUMN_PATTERN.lastIndex = 0;
    for (const match of sql.matchAll(ORGANIZATION_ID_COLUMN_PATTERN)) {
      const type = match[1];
      // \b already excludes prefixed fields such as parent_organization_id.
      const lineEnd = sql.indexOf('\n', match.index);
      const declaration = sql.slice(
        match.index,
        lineEnd === -1 ? undefined : lineEnd + 1,
      );
      const baseType = type.split('(')[0];
      const sentinelPattern = ORGANIZATION_ID_SENTINEL_BY_TYPE[baseType];
      const sentinelOk = sentinelPattern ? sentinelPattern.test(declaration) : false;
      const notNull = /\bNOT NULL\b/iu.test(declaration);
      if (!notNull || !sentinelOk) {
        const expected = baseType === 'BIGINT' || baseType === 'INTEGER'
          ? 'NOT NULL DEFAULT 0'
          : baseType === 'UUID'
            ? "NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'"
            : "NOT NULL DEFAULT '0'";
        fail(
          `ddl/baseline/${engine}/${fileName}: organization_id (${type}) must be ${expected} (DATABASE_SPEC DB089); found ${declaration.trim().replace(/\s+/g, ' ')}`,
        );
      }
    }
  }
}

export function validateDatabaseModuleContract(moduleRootDir) {
  const failures = [];

  function fail(message) {
    failures.push(message);
  }

  let manifest;
  try {
    manifest = readJsonAt(moduleRootDir, 'database.manifest.json');
  } catch (error) {
    fail(`database.manifest.json must be valid JSON (${error.message})`);
    return { ok: false, failures };
  }

  const manifestContractVersion = manifest.contractVersion;
  if (!isValidSemver(manifestContractVersion)) {
    fail(
      `database.manifest.json contractVersion must be valid SemVer (found ${manifestContractVersion ?? 'missing'})`,
    );
  }

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail(
      `database.manifest.json schemaVersion must be ${MANIFEST_SCHEMA_VERSION} (found ${manifest.schemaVersion ?? 'missing'})`,
    );
  }

  const databaseRole = manifest.databaseRole;
  const expectedEngine = expectedEngineForRole(databaseRole);
  if (!expectedEngine) {
    fail(
      `database.manifest.json databaseRole must be ${AUTHORITATIVE_ROLE} or ${CLIENT_LOCAL_ROLE} (found ${databaseRole ?? 'missing'})`,
    );
  } else {
    if (!isExactArray(manifest.engines, [expectedEngine])) {
      fail(
        `database.manifest.json engines must be exactly ["${expectedEngine}"] for ${databaseRole}`,
      );
    }
    if (manifest.defaultEngine !== expectedEngine) {
      fail(
        `database.manifest.json defaultEngine must be ${expectedEngine} for ${databaseRole}`,
      );
    }
  }

  let schemaContractVersion = null;
  let schemaDatabaseRole = null;
  let schemaTablePrefix = null;
  let schemaEngines = [];
  try {
    schemaContractVersion = readTopLevelYamlScalarAt(moduleRootDir, 'contract/schema.yaml', 'contract_version');
    schemaDatabaseRole = readTopLevelYamlScalarAt(moduleRootDir, 'contract/schema.yaml', 'database_role');
    schemaTablePrefix = readTopLevelYamlScalarAt(moduleRootDir, 'contract/schema.yaml', 'table_prefix');
    schemaEngines = readSimpleYamlAt(moduleRootDir, 'contract/schema.yaml').sequences.get('engines') ?? [];
    if (!isValidSemver(schemaContractVersion)) {
      fail(
        `contract/schema.yaml contract_version must be valid SemVer (found ${schemaContractVersion ?? 'missing'})`,
      );
    }
    if (schemaDatabaseRole !== databaseRole) {
      fail(
        `contract/schema.yaml database_role must match manifest databaseRole (manifest=${databaseRole ?? 'missing'}, schema=${schemaDatabaseRole ?? 'missing'})`,
      );
    }
    if (expectedEngine && !isExactArray(schemaEngines, [expectedEngine])) {
      fail(`contract/schema.yaml engines must be exactly ["${expectedEngine}"] for ${databaseRole}`);
    }
    if (
      databaseRole === AUTHORITATIVE_ROLE
      && (!isNonEmptyString(schemaTablePrefix) || schemaTablePrefix !== primaryManifestPrefix(manifest))
    ) {
      fail(
        `contract/schema.yaml table_prefix must match database.manifest.json primary tablePrefix (manifest=${primaryManifestPrefix(manifest) ?? 'missing'}, schema=${schemaTablePrefix ?? 'missing'})`,
      );
    }
  } catch (error) {
    fail(`contract/schema.yaml must be readable (${error.message})`);
  }

  if (
    isNonEmptyString(manifestContractVersion)
    && isNonEmptyString(schemaContractVersion)
    && manifestContractVersion !== schemaContractVersion
  ) {
    fail(
      `database contract versions must match (manifest=${manifestContractVersion}, schema=${schemaContractVersion})`,
    );
  }
  if (typeof manifest.lifecycle?.autoMigrate !== 'boolean') {
    fail('database.manifest.json lifecycle.autoMigrate must be an explicit boolean');
  }
  if (databaseRole === AUTHORITATIVE_ROLE && manifest.lifecycle?.autoMigrate !== false) {
    fail(
      'database.manifest.json lifecycle.autoMigrate must be false for authoritative-server modules',
    );
  }
  // Section 6.1: an authoritative-server manifest must declare the active seed
  // locale set. The layout validator defaults a missing value to zh-CN, which would
  // otherwise let the field stay absent and make section 6.4's manifest/seed
  // equality rule vacuous.
  if (
    databaseRole === AUTHORITATIVE_ROLE
    && (!Array.isArray(manifest.lifecycle?.activeSeedLocales)
      || manifest.lifecycle.activeSeedLocales.length === 0)
  ) {
    fail(
      'database.manifest.json lifecycle.activeSeedLocales must be a non-empty array for authoritative-server modules',
    );
  }

  const baselineStrategy = manifest.baselineStrategy;
  if (!BASELINE_STRATEGIES.has(baselineStrategy)) {
    fail(
      'database.manifest.json baselineStrategy must be migrations-only, baseline-plus-migrations, or baseline-only-dev',
    );
  }

  if (expectedEngine && BASELINE_STRATEGIES.has(baselineStrategy)) {
    const baselineFiles = listBaselineSqlFiles(moduleRootDir, expectedEngine);
    const migrationFiles = listMigrationUpSqlFiles(moduleRootDir, expectedEngine);
    if (baselineStrategy === 'migrations-only' && migrationFiles.length === 0) {
      fail(`migrations/${expectedEngine} must contain at least one .up.sql for migrations-only`);
    }
    if (baselineStrategy !== 'migrations-only' && baselineFiles.length === 0) {
      fail(`ddl/baseline/${expectedEngine} must contain at least one .sql baseline file`);
    }
    validateBaselineSourceEngines(moduleRootDir, expectedEngine, baselineFiles, fail);
    validateOrganizationIdContract(moduleRootDir, expectedEngine, baselineFiles, fail);
  }

  if (databaseRole === AUTHORITATIVE_ROLE) {
    for (const forbiddenPath of ['ddl/baseline/sqlite', 'migrations/sqlite']) {
      if (existsAt(moduleRootDir, forbiddenPath)) {
        fail(`${forbiddenPath} must not exist in an authoritative-server database root`);
      }
    }

    // Section 6.1: a root that declares neither tablePrefix nor tablePrefixes is
    // not an ownership-scoped database root.
    if (declaredManifestPrefixes(manifest).length === 0) {
      fail('database.manifest.json must declare a non-empty tablePrefix or tablePrefixes for an authoritative-server root');
    }
    if (Array.isArray(manifest.tablePrefixes) && manifest.tablePrefixes.length > 0 && manifest.tablePrefix !== undefined) {
      fail('database.manifest.json must not declare both tablePrefix and tablePrefixes');
    }

    try {
      const prefixRegistry = readJsonAt(moduleRootDir, 'contract/prefix-registry.json');
      if (!Array.isArray(prefixRegistry.prefixes) || prefixRegistry.prefixes.length === 0) {
        fail('contract/prefix-registry.json prefixes must be non-empty for an authoritative-server root');
      } else {
        const registeredPrefixes = new Set(
          prefixRegistry.prefixes.map((entry) => entry?.prefix).filter(isNonEmptyString),
        );
        const unregistered = declaredManifestPrefixes(manifest).filter(
          (prefix) => !registeredPrefixes.has(prefix),
        );
        if (unregistered.length > 0) {
          fail(
            `contract/prefix-registry.json must register every database.manifest.json tablePrefix (missing ${unregistered.join(', ')})`,
          );
        }
      }
    } catch (error) {
      fail(`contract/prefix-registry.json must be valid JSON (${error.message})`);
    }

    try {
      const tableRegistry = readJsonAt(moduleRootDir, 'contract/table-registry.json');
      if (!Array.isArray(tableRegistry.tables) || tableRegistry.tables.length === 0) {
        fail('contract/table-registry.json tables must be non-empty for an authoritative-server root');
      } else if (
        Array.isArray(manifest.tablePrefixes) && manifest.tablePrefixes.length > 0
        && tableRegistry.tables.some(
          (entry) =>
            !isNonEmptyString(entry?.table_name)
            || !manifest.tablePrefixes.some((prefix) => entry.table_name.startsWith(prefix)),
        )
      ) {
        fail(
          'contract/table-registry.json table names must use a database.manifest.json tablePrefixes prefix',
        );
      } else if (
        !Array.isArray(manifest.tablePrefixes)
        && isNonEmptyString(manifest.tablePrefix)
        && tableRegistry.tables.some(
          (entry) => !isNonEmptyString(entry?.table_name) || !entry.table_name.startsWith(manifest.tablePrefix),
        )
      ) {
        fail('contract/table-registry.json table names must use database.manifest.json tablePrefix');
      }
    } catch (error) {
      fail(`contract/table-registry.json must be valid JSON (${error.message})`);
    }
  }

  if (databaseRole === CLIENT_LOCAL_ROLE) {
    for (const forbiddenPath of ['ddl/baseline/postgres', 'migrations/postgres']) {
      if (existsAt(moduleRootDir, forbiddenPath)) {
        fail(`${forbiddenPath} must not exist in a client-local database root`);
      }
    }
    const clientLocal = manifest.clientLocal;
    if (!clientLocal || typeof clientLocal !== 'object' || Array.isArray(clientLocal)) {
      fail('database.manifest.json clientLocal must be defined for client-local modules');
    } else {
      if (!CLIENT_LOCAL_MODES.has(clientLocal.mode)) {
        fail('database.manifest.json clientLocal.mode must be cache, offline-projection, or local-only');
      }
      if (!isNonEmptyString(clientLocal.scope)) {
        fail('database.manifest.json clientLocal.scope must be defined');
      } else {
        const normalizedScope = clientLocal.scope.toLowerCase().split(/[^a-z0-9]+/u);
        for (const dimension of ['environment', 'profile', 'origin', 'account']) {
          if (!normalizedScope.includes(dimension)) {
            fail(`database.manifest.json clientLocal.scope must include ${dimension} isolation`);
          }
        }
      }
      if (!isNonEmptyString(clientLocal.authoritativeSource)) {
        fail('database.manifest.json clientLocal.authoritativeSource must be defined');
      }
      if (clientLocal.mode === 'offline-projection' && !isNonEmptyString(clientLocal.syncContract)) {
        fail('database.manifest.json clientLocal.syncContract must be defined for offline-projection');
      }
    }
  }

  return { ok: failures.length === 0, failures, databaseRole };
}

function migrationMetadata(sql) {
  const values = {};
  for (const match of sql.matchAll(/^--\s*([a-z_]+):\s*(.+?)\s*$/gmu)) {
    values[match[1]] = match[2];
  }
  return values;
}

/**
 * Section 7.2: `rollback` MUST begin with a strategy token; a parenthetical
 * explanation MAY follow, for example `forward-fix (sentinel backfill ...)`.
 */
const ROLLBACK_TOKENS = ['down-migration', 'forward-fix', 'restore-cutover'];

function rollbackToken(value) {
  if (!isNonEmptyString(value)) return null;
  const token = ROLLBACK_TOKENS.find((candidate) => value === candidate || value.startsWith(`${candidate} `));
  return token ?? null;
}

/**
 * Section 7.2: the metadata sidecar is the authoritative machine-readable record for a
 * history-immutable migration. It may correct a header value that is missing or invalid.
 */
function isValidHistoricalMetadataValue(key, value, engine) {
  if (!isNonEmptyString(value)) return false;
  if (key === 'engine') return value === engine;
  if (key === 'rollback') return rollbackToken(value) !== null;
  if (key === 'reversible' || key === 'transactional') return value === 'true' || value === 'false';
  return true;
}

function migrationMetadataSidecar(migrationDir, engine, fail) {
  const relativePath = `migrations/${engine}/metadata.json`;
  const sidecarPath = path.join(migrationDir, 'metadata.json');
  if (!fs.existsSync(sidecarPath)) return {};

  let sidecar;
  try {
    sidecar = parseJsonFile(sidecarPath);
  } catch (error) {
    fail(`${relativePath} must contain valid JSON: ${error.message}`);
    return {};
  }
  if (sidecar.schemaVersion !== 1) {
    fail(`${relativePath} schemaVersion must be 1`);
  }
  if (sidecar.kind !== 'sdkwork.database.migration-metadata') {
    fail(`${relativePath} kind must be sdkwork.database.migration-metadata`);
  }
  if (sidecar.engine !== engine) {
    fail(`${relativePath} engine must be ${engine}`);
  }
  if (sidecar.sourcePolicy !== 'historical-immutable') {
    fail(`${relativePath} sourcePolicy must be historical-immutable`);
  }
  if (!sidecar.migrations || typeof sidecar.migrations !== 'object' || Array.isArray(sidecar.migrations)) {
    fail(`${relativePath} migrations must be an object`);
    return {};
  }
  return sidecar.migrations;
}

function validateMigrationDirectory(moduleRootDir, engine, fail) {
  const migrationDir = path.join(moduleRootDir, 'migrations', engine);
  if (!fs.existsSync(migrationDir)) return;
  const supplementalMetadata = migrationMetadataSidecar(migrationDir, engine, fail);
  const migrationNames = new Set(
    fs.readdirSync(migrationDir).filter((entry) => entry.endsWith('.up.sql')),
  );

  for (const [entry, metadata] of Object.entries(supplementalMetadata)) {
    if (!migrationNames.has(entry)) {
      fail(`migrations/${engine}/metadata.json references missing migration ${entry}`);
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      fail(`migrations/${engine}/metadata.json entry ${entry} must be an object`);
    }
  }

  for (const entry of fs.readdirSync(migrationDir)) {
    if (!entry.endsWith('.up.sql')) continue;
    if (!/^\d{4,}_[a-z0-9_]+\.up\.sql$/u.test(entry)) {
      fail(`migrations/${engine}/${entry} must use a sortable numeric version prefix`);
    }

    const upPath = path.join(migrationDir, entry);
    const upSql = fs.readFileSync(upPath, 'utf8');
    const headerMetadata = migrationMetadata(upSql);
    const { correctionReason, ...sidecarMetadata } = supplementalMetadata[entry] ?? {};
    // Section 7.2: the sidecar may record a value for any field, including one the
    // header already declares. Every override must be auditable and must itself be valid.
    const overrides = Object.keys(sidecarMetadata).filter(
      (key) => headerMetadata[key] !== undefined && headerMetadata[key] !== sidecarMetadata[key],
    );
    if (overrides.length > 0 && !isNonEmptyString(correctionReason)) {
      fail(
        `migrations/${engine}/metadata.json entry ${entry} must define correctionReason when overriding ${overrides.join(', ')}`,
      );
    }
    for (const key of overrides) {
      if (!isValidHistoricalMetadataValue(key, sidecarMetadata[key], engine)) {
        fail(
          `migrations/${engine}/metadata.json entry ${entry} correction ${key}=${sidecarMetadata[key]} is not a valid value`,
        );
      }
    }
    const metadata = { ...headerMetadata, ...sidecarMetadata };
    const downName = entry.replace(/\.up\.sql$/u, '.down.sql');
    const downPath = path.join(migrationDir, downName);
    const hasDown = fs.existsSync(downPath);

    validateApplicationOwnedSql(upSql, `migrations/${engine}/${entry}`, fail);
    if (hasDown) {
      validateApplicationOwnedSql(
        fs.readFileSync(downPath, 'utf8'),
        `migrations/${engine}/${downName}`,
        fail,
      );
    }

    if (metadata.engine !== engine) {
      fail(`migrations/${engine}/${entry} metadata engine must be ${engine}`);
    }
    for (const key of ['reversible', 'rollback', 'transactional']) {
      if (!isNonEmptyString(metadata[key])) {
        fail(`migrations/${engine}/${entry} metadata ${key} must be defined`);
      }
    }
    // Section 7.2: `rollback` MUST begin with a machine-readable strategy token.
    const effectiveRollbackToken = rollbackToken(metadata.rollback);
    if (isNonEmptyString(metadata.rollback) && effectiveRollbackToken === null) {
      fail(
        `migrations/${engine}/${entry} metadata rollback must begin with down-migration, forward-fix, or restore-cutover (found ${metadata.rollback})`,
      );
    }
    if (isNonEmptyString(metadata.reversible) && metadata.reversible !== 'true' && metadata.reversible !== 'false') {
      fail(`migrations/${engine}/${entry} metadata reversible must be true or false (found ${metadata.reversible})`);
    }
    if (engine === 'postgres') {
      for (const key of ['lock', 'lock_timeout', 'statement_timeout']) {
        if (!isNonEmptyString(metadata[key])) {
          fail(`migrations/${engine}/${entry} metadata ${key} must be defined`);
        }
      }
    }

    if (metadata.reversible === 'true' && effectiveRollbackToken === 'down-migration' && !hasDown) {
      fail(`migrations/${engine}/${downName} must exist when rollback is down-migration`);
    }
    if (hasDown && (metadata.reversible !== 'true' || effectiveRollbackToken !== 'down-migration')) {
      fail(
        `migrations/${engine}/${downName} requires reversible: true and rollback: down-migration`,
      );
    }
  }
}

export function validateDatabaseModuleLayout(moduleRootDir, requiredRole = null) {
  const failures = [];

  function fail(message) {
    failures.push(message);
  }

  let manifest = null;
  try {
    manifest = readJsonAt(moduleRootDir, 'database.manifest.json');
  } catch (error) {
    fail(`database.manifest.json must be valid JSON (${error.message})`);
  }

  const databaseRole = manifest?.databaseRole ?? null;
  const expectedEngine = expectedEngineForRole(databaseRole);
  if (requiredRole && databaseRole !== requiredRole) {
    fail(`database.manifest.json databaseRole must be ${requiredRole} for this layout`);
  }

  const requiredPaths = [
    'README.md',
    'database.manifest.json',
    'contract/schema.yaml',
    'fixtures',
  ];

  if (databaseRole === AUTHORITATIVE_ROLE) {
    requiredPaths.push(
      'contract/prefix-registry.json',
      'contract/table-registry.json',
      'seeds/seed.manifest.json',
      'drift/policy.yaml',
      'migrations/postgres',
      'seeds/common',
      'ddl/baseline/postgres',
      'ddl/generated',
    );
  } else if (databaseRole === CLIENT_LOCAL_ROLE) {
    requiredPaths.push(
      'local-data-policy.yaml',
      'migrations/sqlite',
      'ddl/baseline/sqlite',
    );
  }

  for (const relativePath of requiredPaths) {
    if (!existsAt(moduleRootDir, relativePath)) {
      fail(`${relativePath} must exist`);
    }
  }

  if (databaseRole === AUTHORITATIVE_ROLE) {
    for (const locale of REQUIRED_LOCALES) {
      const relativePath = `seeds/locales/${locale}`;
      if (!existsAt(moduleRootDir, relativePath)) {
        fail(`${relativePath} must exist`);
      }
    }
  }

  if (expectedEngine) validateMigrationDirectory(moduleRootDir, expectedEngine, fail);

  if (manifest) {
    if (manifest.kind !== 'sdkwork.database.module') {
      fail('database.manifest.json kind must be sdkwork.database.module');
    }
    if (!manifest.moduleId || !manifest.serviceCode) {
      fail('database.manifest.json must define moduleId and serviceCode');
    }
    const activeLocales = manifest.lifecycle?.activeSeedLocales ?? ['zh-CN'];
    if (databaseRole === AUTHORITATIVE_ROLE && !activeLocales.includes('zh-CN')) {
      fail('database.manifest.json lifecycle.activeSeedLocales must include zh-CN');
    }
  }

  if (databaseRole === AUTHORITATIVE_ROLE) {
    try {
      const seedManifest = readJsonAt(moduleRootDir, 'seeds/seed.manifest.json');
      if (seedManifest.kind !== 'sdkwork.database.seed') {
        fail('seeds/seed.manifest.json kind must be sdkwork.database.seed');
      }
      if (seedManifest.defaultLocale !== 'zh-CN') {
        fail('seeds/seed.manifest.json defaultLocale must be zh-CN');
      }
      validateLocaleSetManifest(seedManifest, fail);
    } catch (error) {
      fail(`seeds/seed.manifest.json must be valid JSON (${error.message})`);
    }
  } else if (databaseRole === CLIENT_LOCAL_ROLE && manifest) {
    validateClientLocalPolicy(moduleRootDir, manifest, fail);
  }

  return { ok: failures.length === 0, failures, databaseRole };
}

export function validateDatabaseFramework(rootDir) {
  if (!directoryContainsFiles(path.join(rootDir, 'database'))) {
    return { ok: true, skipped: true, failures: [] };
  }

  const moduleResult = validateDatabaseModuleLayout(path.join(rootDir, 'database'));
  const contractResult = validateDatabaseModuleContract(path.join(rootDir, 'database'));
  const failures = [...moduleResult.failures, ...contractResult.failures];
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = parseJsonFile(packageJsonPath);
    const scripts = packageJson.scripts ?? {};
    const requiredScripts = contractResult.databaseRole === CLIENT_LOCAL_ROLE
      ? ['db:validate']
      : REQUIRED_DB_SCRIPTS;
    for (const scriptName of requiredScripts) {
      if (!scripts[scriptName]) {
        failures.push(`package.json scripts must define ${scriptName}`);
      }
    }
    if (contractResult.databaseRole === AUTHORITATIVE_ROLE) {
      for (const scriptName of AUTHORITATIVE_DB_SCRIPTS) {
        if (!scripts[scriptName]) {
          failures.push(`package.json scripts must define ${scriptName} for authoritative-server modules`);
        }
      }
    }
  }

  return { ok: failures.length === 0, skipped: false, failures };
}

function main() {
  const { root, layout } = parseArgs(process.argv.slice(2));

  if (layout === 'module' || layout === 'client-local') {
    const requiredRole = layout === 'client-local' ? CLIENT_LOCAL_ROLE : null;
    const result = validateDatabaseModuleLayout(root, requiredRole);
    if (!result.ok) {
      process.stderr.write(
        `Database module layout failed:\n${result.failures.map((item) => `- ${item}`).join('\n')}\n`,
      );
      process.exit(1);
    }
    process.stdout.write('Database module layout passed\n');
    return;
  }

  const result = validateDatabaseFramework(root);

  if (result.skipped) {
    process.stdout.write('Database framework standard skipped (no database/ directory)\n');
    return;
  }

  if (!result.ok) {
    process.stderr.write(
      `Database framework standard failed:\n${result.failures.map((item) => `- ${item}`).join('\n')}\n`,
    );
    process.exit(1);
  }

  process.stdout.write('Database framework standard passed\n');
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (import.meta.url === entryUrl) {
  main();
}
