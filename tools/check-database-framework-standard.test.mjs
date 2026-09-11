#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateDatabaseFramework,
  validateDatabaseModuleContract,
  validateDatabaseModuleLayout,
} from './check-database-framework-standard.mjs';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));

function writeJson(relativePath, value, rootDir) {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(relativePath, value, rootDir) {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, value, 'utf8');
}

function scaffoldValidDatabaseRoot(rootDir, contractVersion = '5.0.0') {
  writeText('database/README.md', '# database\n', rootDir);
  writeJson(
    'database/database.manifest.json',
    {
      schemaVersion: 2,
      kind: 'sdkwork.database.module',
      databaseRole: 'authoritative-server',
      moduleId: 'demo',
      serviceCode: 'DEMO',
      contractVersion,
      engines: ['postgres'],
      defaultEngine: 'postgres',
      tablePrefix: 'demo_',
      baselineStrategy: 'baseline-plus-migrations',
      lifecycle: { activeSeedLocales: ['zh-CN'], autoMigrate: false },
    },
    rootDir,
  );
  writeText(
    'database/contract/schema.yaml',
    `schema_version: 1\nkind: sdkwork.database.schema\ndatabase_role: authoritative-server\nmodule_id: demo\ncontract_version: ${contractVersion}\nengines:\n  - postgres\ntable_prefix: demo_\ntables: []\n`,
    rootDir,
  );
  writeJson('database/contract/prefix-registry.json', {
    schemaVersion: 1,
    kind: 'sdkwork.database.prefix-registry',
    prefixes: [{ prefix: 'demo_', owner: 'demo-platform', domain: 'demo' }],
  }, rootDir);
  writeJson('database/contract/table-registry.json', {
    schemaVersion: 1,
    kind: 'sdkwork.database.table-registry',
    tables: [{ table_name: 'demo_probe', owner: 'demo-platform', compliance_level: 'L2', lifecycle_status: 'active' }],
  }, rootDir);
  writeJson(
    'database/seeds/seed.manifest.json',
    {
      schemaVersion: 1,
      kind: 'sdkwork.database.seed',
      i18nVersion: '1.0.0',
      defaultLocale: 'zh-CN',
      fallbackLocale: 'zh-CN',
      supportedLocales: ['zh-CN', 'en-US', 'ja-JP', 'de-DE', 'fr-FR', 'ru-RU', 'ko-KR'],
      activeLocales: ['zh-CN'],
      localeSets: {
        'zh-CN': {
          version: '1.0.0',
          required: true,
          checksum: 'sha256:test',
          files: [],
        },
      },
      profiles: { standard: { common: [], locales: { 'zh-CN': [] } } },
    },
    rootDir,
  );
  writeText('database/drift/policy.yaml', 'schemaVersion: 1\nkind: sdkwork.database.drift-policy\nrules: {}\n', rootDir);
  writeText('database/migrations/postgres/.gitkeep', '', rootDir);
  writeText('database/seeds/common/.gitkeep', '', rootDir);
  writeText('database/ddl/baseline/postgres/0001_demo_baseline.sql', 'CREATE TABLE demo_probe (id INTEGER PRIMARY KEY);\n', rootDir);
  writeText('database/ddl/generated/.gitkeep', '', rootDir);
  writeText('database/fixtures/.gitkeep', '', rootDir);
  for (const locale of ['zh-CN', 'en-US', 'ja-JP', 'de-DE', 'fr-FR', 'ru-RU', 'ko-KR']) {
    writeText(`database/seeds/locales/${locale}/.gitkeep`, '', rootDir);
  }
  writeJson(
    'package.json',
    {
      scripts: {
        'db:validate': 'node ../sdkwork-specs/tools/check-database-framework-standard.mjs --root .',
        'db:plan': 'echo plan',
        'db:init': 'echo init',
        'db:migrate': 'echo migrate',
        'db:seed': 'echo seed',
        'db:status': 'echo status',
        'db:drift': 'echo drift',
        'db:drift:check': 'echo drift-check',
        'db:materialize:contract': 'echo materialize',
        'db:bootstrap': 'echo bootstrap',
      },
    },
    rootDir,
  );
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(tempRoot);
const valid = validateDatabaseFramework(tempRoot);
assert.equal(valid.ok, true, 'valid scaffold should pass');

const emptyDatabaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
fs.mkdirSync(path.join(emptyDatabaseRoot, 'database/contract'), { recursive: true });
const emptyDatabase = validateDatabaseFramework(emptyDatabaseRoot);
assert.equal(emptyDatabase.skipped, true, 'empty untracked database directories are not database owners');

const authoritativeAutoMigrateRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'sdkwork-db-framework-'),
);
scaffoldValidDatabaseRoot(authoritativeAutoMigrateRoot);
const authoritativeAutoMigrateManifestPath = path.join(
  authoritativeAutoMigrateRoot,
  'database/database.manifest.json',
);
const authoritativeAutoMigrateManifest = JSON.parse(
  fs.readFileSync(authoritativeAutoMigrateManifestPath, 'utf8'),
);
authoritativeAutoMigrateManifest.lifecycle.autoMigrate = true;
fs.writeFileSync(
  authoritativeAutoMigrateManifestPath,
  `${JSON.stringify(authoritativeAutoMigrateManifest, null, 2)}\n`,
  'utf8',
);
const authoritativeAutoMigrate = validateDatabaseModuleContract(
  path.join(authoritativeAutoMigrateRoot, 'database'),
);
assert.equal(
  authoritativeAutoMigrate.ok,
  false,
  'authoritative-server modules must not enable automatic migrations',
);
assert.ok(
  authoritativeAutoMigrate.failures.some((item) => item.includes('must be false')),
  'failure should identify authoritative-server automatic migration ownership',
);

const mismatchedPrefixRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(mismatchedPrefixRoot);
const mismatchedPrefixManifestPath = path.join(
  mismatchedPrefixRoot,
  'database/database.manifest.json',
);
const mismatchedPrefixManifest = JSON.parse(
  fs.readFileSync(mismatchedPrefixManifestPath, 'utf8'),
);
mismatchedPrefixManifest.tablePrefix = 'foreign_';
fs.writeFileSync(
  mismatchedPrefixManifestPath,
  `${JSON.stringify(mismatchedPrefixManifest, null, 2)}\n`,
  'utf8',
);
const mismatchedPrefix = validateDatabaseModuleContract(
  path.join(mismatchedPrefixRoot, 'database'),
);
assert.equal(mismatchedPrefix.ok, false, 'database prefix ownership must be consistent');
assert.ok(
  mismatchedPrefix.failures.some((item) => item.includes('table_prefix must match')),
  'failure should identify schema and manifest prefix mismatch',
);
assert.ok(
  mismatchedPrefix.failures.some((item) => item.includes('must register every database.manifest.json tablePrefix')),
  'failure should identify missing prefix ownership declaration',
);
assert.ok(
  mismatchedPrefix.failures.some((item) => item.includes('table names must use')),
  'failure should identify tables outside the owned prefix',
);

const mixedDialectBaselineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(mixedDialectBaselineRoot);
const mixedDialectBaselinePath = path.join(
  mixedDialectBaselineRoot,
  'database/ddl/baseline/postgres/0001_demo_baseline.sql',
);
fs.appendFileSync(
  mixedDialectBaselinePath,
  "\n-- source: crates/demo/migrations/sqlite/0002_add_status.sql\nALTER TABLE demo_probe ADD COLUMN status TEXT;\n",
  'utf8',
);
const mixedDialectBaseline = validateDatabaseModuleContract(
  path.join(mixedDialectBaselineRoot, 'database'),
);
assert.equal(mixedDialectBaseline.ok, false, 'PostgreSQL baseline must reject SQLite sources');
assert.ok(
  mixedDialectBaseline.failures.some((item) => item.includes('must not contain sqlite source')),
  'failure should identify cross-engine baseline provenance',
);

const applicationSchemaProvisioningRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'sdkwork-db-framework-'),
);
scaffoldValidDatabaseRoot(applicationSchemaProvisioningRoot);
fs.appendFileSync(
  path.join(
    applicationSchemaProvisioningRoot,
    'database/ddl/baseline/postgres/0001_demo_baseline.sql',
  ),
  '\nCREATE SCHEMA sdkwork_demo_dev;\n',
  'utf8',
);
const applicationSchemaProvisioning = validateDatabaseModuleContract(
  path.join(applicationSchemaProvisioningRoot, 'database'),
);
assert.equal(
  applicationSchemaProvisioning.ok,
  false,
  'application baselines must not provision a database or schema',
);
assert.ok(
  applicationSchemaProvisioning.failures.some((item) => item.includes('CREATE SCHEMA')),
  'failure should identify forbidden application-owned schema provisioning',
);

const bomPackageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(bomPackageRoot);
const bomPackagePath = path.join(bomPackageRoot, 'package.json');
fs.writeFileSync(bomPackagePath, `\uFEFF${fs.readFileSync(bomPackagePath, 'utf8')}`, 'utf8');
const bomPackage = validateDatabaseFramework(bomPackageRoot);
assert.equal(bomPackage.ok, true, 'UTF-8 BOM must not prevent package.json validation');

const alternateValidVersionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(alternateValidVersionRoot, '2.1.0');
const alternateValidVersion = validateDatabaseFramework(alternateValidVersionRoot);
assert.equal(alternateValidVersion.ok, true, 'valid L2 contract versions must not be pinned to 1.0.0');

const invalidContractVersionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(invalidContractVersionRoot, '1.0');
const invalidContractVersion = validateDatabaseModuleContract(
  path.join(invalidContractVersionRoot, 'database'),
);
assert.equal(invalidContractVersion.ok, false, 'invalid semantic versions should fail L2 contract checks');
assert.ok(
  invalidContractVersion.failures.some((item) => item.includes('valid SemVer')),
  'failure should mention invalid SemVer',
);

const contractVersionMismatchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(contractVersionMismatchRoot);
const mismatchSchemaPath = path.join(contractVersionMismatchRoot, 'database/contract/schema.yaml');
const mismatchSchema = fs
  .readFileSync(mismatchSchemaPath, 'utf8')
  .replace('contract_version: 5.0.0', 'contract_version: 5.0.1');
fs.writeFileSync(mismatchSchemaPath, mismatchSchema, 'utf8');
const contractVersionMismatch = validateDatabaseModuleContract(
  path.join(contractVersionMismatchRoot, 'database'),
);
assert.equal(contractVersionMismatch.ok, false, 'manifest and schema contract versions must match');
assert.ok(
  contractVersionMismatch.failures.some((item) => item.includes('database contract versions must match')),
  'failure should mention the manifest and schema contract version mismatch',
);

const missingLocaleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(missingLocaleRoot);
fs.rmSync(path.join(missingLocaleRoot, 'database/seeds/locales/ko-KR'), { recursive: true, force: true });
const missingLocale = validateDatabaseFramework(missingLocaleRoot);
assert.equal(missingLocale.ok, false, 'missing locale directory should fail');

const missingI18nRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(missingI18nRoot);
const seedManifest = JSON.parse(
  fs.readFileSync(path.join(missingI18nRoot, 'database/seeds/seed.manifest.json'), 'utf8'),
);
delete seedManifest.i18nVersion;
delete seedManifest.localeSets;
fs.writeFileSync(
  path.join(missingI18nRoot, 'database/seeds/seed.manifest.json'),
  `${JSON.stringify(seedManifest, null, 2)}\n`,
);
const missingI18n = validateDatabaseModuleLayout(path.join(missingI18nRoot, 'database'));
assert.equal(missingI18n.ok, false, 'missing seed i18n metadata should fail');
assert.ok(
  missingI18n.failures.some((item) => item.includes('i18nVersion') || item.includes('localeSets')),
  'failure should mention seed i18n metadata',
);

const templateRoot = path.resolve(toolsDir, '../templates/database');
const templateResult = validateDatabaseModuleLayout(templateRoot);
assert.equal(templateResult.ok, true, 'templates/database should satisfy module layout checks');

const clientTemplateRoot = path.resolve(toolsDir, '../templates/database-client-local');
const clientTemplateResult = validateDatabaseModuleLayout(clientTemplateRoot, 'client-local');
assert.equal(clientTemplateResult.ok, true, 'templates/database-client-local should satisfy client-local layout checks');
const clientTemplateContractResult = validateDatabaseModuleContract(clientTemplateRoot);
assert.equal(
  clientTemplateContractResult.failures.some((item) => item.includes('table_prefix')),
  false,
  'client-local database contracts must not require a shared-schema table prefix',
);

const forwardOnlyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(forwardOnlyRoot);
writeText(
  'database/migrations/postgres/0001_add_demo_status.up.sql',
  '-- sdkwork:migration\n-- engine: postgres\n-- reversible: false\n-- rollback: forward-fix\n-- transactional: true\n-- lock: access-exclusive\n-- lock_timeout: 2s\n-- statement_timeout: 30s\nALTER TABLE demo_probe ADD COLUMN status INTEGER;\n',
  forwardOnlyRoot,
);
const forwardOnly = validateDatabaseModuleLayout(path.join(forwardOnlyRoot, 'database'));
assert.equal(forwardOnly.ok, true, 'forward-only migration with explicit rollback metadata should pass');

const timestampMigrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(timestampMigrationRoot);
writeText(
  'database/migrations/postgres/202607300001_add_demo_timestamp.up.sql',
  '-- sdkwork:migration\n-- engine: postgres\n-- reversible: false\n-- rollback: forward-fix\n-- transactional: true\n-- lock: lightweight\n-- lock_timeout: 2s\n-- statement_timeout: 30s\nSELECT 1;\n',
  timestampMigrationRoot,
);
const timestampMigration = validateDatabaseModuleLayout(
  path.join(timestampMigrationRoot, 'database'),
);
assert.equal(
  timestampMigration.ok,
  true,
  'ISO-like numeric migration version tokens should pass',
);

const migrationsOnlyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(migrationsOnlyRoot);
const migrationsOnlyManifestPath = path.join(migrationsOnlyRoot, 'database/database.manifest.json');
const migrationsOnlyManifest = JSON.parse(fs.readFileSync(migrationsOnlyManifestPath, 'utf8'));
migrationsOnlyManifest.baselineStrategy = 'migrations-only';
fs.writeFileSync(
  migrationsOnlyManifestPath,
  `${JSON.stringify(migrationsOnlyManifest, null, 2)}\n`,
  'utf8',
);
fs.rmSync(path.join(migrationsOnlyRoot, 'database/ddl/baseline/postgres/0001_demo_baseline.sql'));
writeText(
  'database/migrations/postgres/0001_create_demo.up.sql',
  '-- sdkwork:migration\n-- engine: postgres\n-- reversible: false\n-- rollback: forward-fix\n-- transactional: true\n-- lock: access-exclusive\n-- lock_timeout: 2s\n-- statement_timeout: 30s\nCREATE TABLE demo_probe (id BIGINT PRIMARY KEY);\n',
  migrationsOnlyRoot,
);
const migrationsOnly = validateDatabaseModuleContract(path.join(migrationsOnlyRoot, 'database'));
assert.equal(migrationsOnly.ok, true, 'migrations-only contract with an initial migration should pass');

const emptyMigrationsOnlyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(emptyMigrationsOnlyRoot);
const emptyMigrationsOnlyManifestPath = path.join(
  emptyMigrationsOnlyRoot,
  'database/database.manifest.json',
);
const emptyMigrationsOnlyManifest = JSON.parse(
  fs.readFileSync(emptyMigrationsOnlyManifestPath, 'utf8'),
);
emptyMigrationsOnlyManifest.baselineStrategy = 'migrations-only';
fs.writeFileSync(
  emptyMigrationsOnlyManifestPath,
  `${JSON.stringify(emptyMigrationsOnlyManifest, null, 2)}\n`,
  'utf8',
);
const emptyMigrationsOnly = validateDatabaseModuleContract(
  path.join(emptyMigrationsOnlyRoot, 'database'),
);
assert.equal(emptyMigrationsOnly.ok, false, 'migrations-only contract without a migration should fail');
assert.ok(
  emptyMigrationsOnly.failures.some((item) => item.includes('at least one .up.sql')),
  'failure should identify the missing initial migration',
);

const missingOperationalMetadataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(missingOperationalMetadataRoot);
writeText(
  'database/migrations/postgres/0001_add_demo_status.up.sql',
  '-- sdkwork:migration\n-- engine: postgres\n-- reversible: false\n-- rollback: forward-fix\n-- transactional: true\nALTER TABLE demo_probe ADD COLUMN status INTEGER;\n',
  missingOperationalMetadataRoot,
);
const missingOperationalMetadata = validateDatabaseModuleLayout(
  path.join(missingOperationalMetadataRoot, 'database'),
);
assert.equal(missingOperationalMetadata.ok, false, 'PostgreSQL migration without lock budgets should fail');
assert.ok(
  missingOperationalMetadata.failures.some((item) => item.includes('metadata lock_timeout')),
  'failure should identify missing PostgreSQL lock timeout metadata',
);
writeText(
  'database/migrations/postgres/metadata.json',
  `${JSON.stringify({
    schemaVersion: 1,
    kind: 'sdkwork.database.migration-metadata',
    engine: 'postgres',
    sourcePolicy: 'historical-immutable',
    migrations: {
      '0001_add_demo_status.up.sql': {
        lock: 'access-exclusive',
        lock_timeout: '2s',
        statement_timeout: '30s',
      },
    },
  }, null, 2)}\n`,
  missingOperationalMetadataRoot,
);
const supplementedOperationalMetadata = validateDatabaseModuleLayout(
  path.join(missingOperationalMetadataRoot, 'database'),
);
assert.equal(
  supplementedOperationalMetadata.ok,
  true,
  'historical sidecar metadata should complete a migration without changing SQL bytes',
);

const missingRollbackMetadataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(missingRollbackMetadataRoot);
writeText(
  'database/migrations/postgres/0001_add_demo_status.up.sql',
  '-- sdkwork:migration\n-- engine: postgres\nALTER TABLE demo_probe ADD COLUMN status INTEGER;\n',
  missingRollbackMetadataRoot,
);
const missingRollbackMetadata = validateDatabaseModuleLayout(
  path.join(missingRollbackMetadataRoot, 'database'),
);
assert.equal(missingRollbackMetadata.ok, false, 'migration without rollback metadata should fail');
assert.ok(
  missingRollbackMetadata.failures.some((item) => item.includes('metadata rollback')),
  'failure should mention rollback metadata',
);

const missingDeclaredDownRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(missingDeclaredDownRoot);
writeText(
  'database/migrations/postgres/0001_add_demo_status.up.sql',
  '-- sdkwork:migration\n-- engine: postgres\n-- reversible: true\n-- rollback: down-migration\n-- transactional: true\n-- lock: access-exclusive\n-- lock_timeout: 2s\n-- statement_timeout: 30s\nALTER TABLE demo_probe ADD COLUMN status INTEGER;\n',
  missingDeclaredDownRoot,
);
const missingDeclaredDown = validateDatabaseModuleLayout(
  path.join(missingDeclaredDownRoot, 'database'),
);
assert.equal(missingDeclaredDown.ok, false, 'declared down-migration without down file should fail');
assert.ok(
  missingDeclaredDown.failures.some((item) => item.includes('.down.sql')),
  'failure should mention the missing declared down migration',
);

const serverSqliteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(serverSqliteRoot);
writeText('database/migrations/sqlite/.gitkeep', '', serverSqliteRoot);
const serverSqlite = validateDatabaseModuleContract(path.join(serverSqliteRoot, 'database'));
assert.equal(serverSqlite.ok, false, 'authoritative-server root must reject SQLite assets');
assert.ok(
  serverSqlite.failures.some((item) => item.includes('migrations/sqlite must not exist')),
  'failure should identify server SQLite assets',
);

const clientLocalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidClientLocalRoot(clientLocalRoot);
const clientLocal = validateDatabaseFramework(clientLocalRoot);
assert.equal(clientLocal.ok, true, 'valid client-local SQLite scaffold should pass');

const clientSchemaEngineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidClientLocalRoot(clientSchemaEngineRoot);
const clientSchemaPath = path.join(clientSchemaEngineRoot, 'database/contract/schema.yaml');
fs.writeFileSync(
  clientSchemaPath,
  fs.readFileSync(clientSchemaPath, 'utf8').replace('  - sqlite', '  - postgres'),
  'utf8',
);
const clientSchemaEngine = validateDatabaseModuleContract(path.join(clientSchemaEngineRoot, 'database'));
assert.equal(clientSchemaEngine.ok, false, 'client-local schema with PostgreSQL engine should fail');
assert.ok(
  clientSchemaEngine.failures.some((item) => item.includes('schema.yaml engines must be exactly ["sqlite"]')),
  'failure should identify the role-specific schema engine',
);

const incompleteClientScopeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidClientLocalRoot(incompleteClientScopeRoot);
const incompleteScopeManifestPath = path.join(
  incompleteClientScopeRoot,
  'database/database.manifest.json',
);
const incompleteScopeManifest = JSON.parse(fs.readFileSync(incompleteScopeManifestPath, 'utf8'));
incompleteScopeManifest.clientLocal.scope = 'environment-profile-account';
fs.writeFileSync(
  incompleteScopeManifestPath,
  `${JSON.stringify(incompleteScopeManifest, null, 2)}\n`,
  'utf8',
);
const incompleteClientScope = validateDatabaseModuleContract(
  path.join(incompleteClientScopeRoot, 'database'),
);
assert.equal(incompleteClientScope.ok, false, 'client-local scope without origin isolation should fail');
assert.ok(
  incompleteClientScope.failures.some((item) => item.includes('scope must include origin isolation')),
  'failure should identify the missing client-local isolation dimension',
);

const missingRetentionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidClientLocalRoot(missingRetentionRoot);
const missingRetentionPolicyPath = path.join(missingRetentionRoot, 'database/local-data-policy.yaml');
fs.writeFileSync(
  missingRetentionPolicyPath,
  fs.readFileSync(missingRetentionPolicyPath, 'utf8').replace(
    /retention:\n  policy:.*\n  max_age_or_event:.*\n/u,
    '',
  ),
  'utf8',
);
const missingRetention = validateDatabaseModuleLayout(path.join(missingRetentionRoot, 'database'));
assert.equal(missingRetention.ok, false, 'client-local policy without retention should fail');
assert.ok(
  missingRetention.failures.some((item) => item.includes('retention.policy')),
  'failure should identify missing client-local retention policy',
);

const mixedClientRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidClientLocalRoot(mixedClientRoot);
const mixedClientManifestPath = path.join(mixedClientRoot, 'database/database.manifest.json');
const mixedClientManifest = JSON.parse(fs.readFileSync(mixedClientManifestPath, 'utf8'));
mixedClientManifest.engines = ['postgres', 'sqlite'];
fs.writeFileSync(mixedClientManifestPath, `${JSON.stringify(mixedClientManifest, null, 2)}\n`, 'utf8');
const mixedClient = validateDatabaseModuleContract(path.join(mixedClientRoot, 'database'));
assert.equal(mixedClient.ok, false, 'mixed engine client-local manifest should fail');
assert.ok(
  mixedClient.failures.some((item) => item.includes('engines must be exactly ["sqlite"]')),
  'failure should identify the exact client-local engine contract',
);

const offlineWithoutSyncRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidClientLocalRoot(offlineWithoutSyncRoot, 'offline-projection');
const offlineManifestPath = path.join(offlineWithoutSyncRoot, 'database/database.manifest.json');
const offlineManifest = JSON.parse(fs.readFileSync(offlineManifestPath, 'utf8'));
offlineManifest.clientLocal.syncContract = null;
fs.writeFileSync(offlineManifestPath, `${JSON.stringify(offlineManifest, null, 2)}\n`, 'utf8');
const offlineWithoutSync = validateDatabaseModuleContract(
  path.join(offlineWithoutSyncRoot, 'database'),
);
assert.equal(offlineWithoutSync.ok, false, 'offline projection without sync contract should fail');
assert.ok(
  offlineWithoutSync.failures.some((item) => item.includes('syncContract')),
  'failure should identify the missing sync contract',
);

const missingBaselineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(missingBaselineRoot);
fs.rmSync(path.join(missingBaselineRoot, 'database/ddl/baseline/postgres/0001_demo_baseline.sql'));
const missingBaseline = validateDatabaseModuleContract(path.join(missingBaselineRoot, 'database'));
assert.equal(missingBaseline.ok, false, 'missing postgres baseline should fail L2 contract checks');

const missingAutoMigrateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(missingAutoMigrateRoot);
const missingAutoMigrateManifest = JSON.parse(
  fs.readFileSync(path.join(missingAutoMigrateRoot, 'database/database.manifest.json'), 'utf8'),
);
delete missingAutoMigrateManifest.lifecycle.autoMigrate;
fs.writeFileSync(
  path.join(missingAutoMigrateRoot, 'database/database.manifest.json'),
  `${JSON.stringify(missingAutoMigrateManifest, null, 2)}\n`,
);
const missingAutoMigrate = validateDatabaseModuleContract(path.join(missingAutoMigrateRoot, 'database'));
assert.equal(missingAutoMigrate.ok, false, 'missing autoMigrate policy should fail contract checks');
assert.ok(
  missingAutoMigrate.failures.some((item) => item.includes('explicit boolean')),
  'failure should identify the missing auto-migration policy',
);

const cliTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork db framework cli '));
try {
  const cliDir = path.join(cliTempRoot, 'validator path with spaces');
  const cliPath = path.join(cliDir, 'check-database-framework-standard.mjs');
  const cliAppRoot = path.join(cliTempRoot, 'application root with spaces');
  fs.mkdirSync(cliDir, { recursive: true });
  fs.copyFileSync(path.join(toolsDir, 'check-database-framework-standard.mjs'), cliPath);
  scaffoldValidDatabaseRoot(cliAppRoot);

  const validCli = spawnSync(process.execPath, [cliPath, '--root', cliAppRoot], { encoding: 'utf8' });
  const validCliOutput = `${validCli.stdout}${validCli.stderr}`;
  assert.equal(validCli.status, 0, validCliOutput);
  assert.match(validCli.stdout, /Database framework standard passed/, validCliOutput);

  fs.rmSync(path.join(cliAppRoot, 'database/README.md'));
  const invalidCli = spawnSync(process.execPath, [cliPath, '--root', cliAppRoot], { encoding: 'utf8' });
  const invalidCliOutput = `${invalidCli.stdout}${invalidCli.stderr}`;
  assert.equal(invalidCli.status, 1, invalidCliOutput);
  assert.match(invalidCli.stderr, /Database framework standard failed/, invalidCliOutput);
  assert.match(invalidCli.stderr, /README\.md must exist/, invalidCliOutput);} finally {
  fs.rmSync(cliTempRoot, { recursive: true, force: true });
}

function scaffoldValidClientLocalRoot(rootDir, mode = 'cache') {
  writeText('database/README.md', '# client-local database\n', rootDir);
  writeJson(
    'database/database.manifest.json',
    {
      schemaVersion: 2,
      kind: 'sdkwork.database.module',
      databaseRole: 'client-local',
      moduleId: 'demo-client-local',
      serviceCode: 'DEMO_CLIENT_LOCAL',
      contractVersion: '1.2.0',
      engines: ['sqlite'],
      defaultEngine: 'sqlite',
      tablePrefix: 'demo_cache_',
      baselineStrategy: 'baseline-plus-migrations',
      clientLocal: {
        mode,
        scope: 'environment-profile-origin-account',
        authoritativeSource: 'demo-app-api',
        syncContract: mode === 'offline-projection' ? 'specs/demo-sync.spec.json' : null,
      },
      lifecycle: { autoMigrate: true },
    },
    rootDir,
  );
  writeText(
    'database/contract/schema.yaml',
    'schema_version: 1\nkind: sdkwork.database.schema\ndatabase_role: client-local\nmodule_id: demo-client-local\ncontract_version: 1.2.0\nengines:\n  - sqlite\ntable_prefix: demo_cache_\ntables: []\n',
    rootDir,
  );
  writeText(
    'database/local-data-policy.yaml',
    [
      'schema_version: 1',
      'kind: sdkwork.database.client-local-policy',
      `mode: ${mode}`,
      'scope: environment-profile-origin-account',
      'authoritative_source: demo-app-api',
      `sync_contract: ${mode === 'offline-projection' ? 'specs/demo-sync.spec.json' : 'null'}`,
      'security:',
      '  encryption_at_rest: required-when-sensitive',
      '  key_store: os-secure-storage',
      '  backup: excluded-unless-declared',
      '  export: disabled-unless-declared',
      '  lock_state: close-or-rekey-per-platform-policy',
      'retention:',
      '  policy: bounded-by-authoritative-cache-policy',
      '  max_age_or_event: 30d-or-logout',
      'lifecycle:',
      '  logout: purge-account-scoped-data',
      '  account_switch: isolate-and-purge-active-state',
      '  uninstall: platform-default-with-documented-backup-policy',
      'recovery:',
      '  migration_interruption: atomic-retry-or-restore',
      '  disk_full: fail-without-partial-commit',
      '  corruption: integrity-check-then-rebuild-or-restore',
      '  projection_rebuild: from-authoritative-source',
      '',
    ].join('\n'),
    rootDir,
  );
  writeText('database/migrations/sqlite/.gitkeep', '', rootDir);
  writeText('database/ddl/baseline/sqlite/0001_demo_client_local_baseline.sql', 'CREATE TABLE demo_cache (id BIGINT PRIMARY KEY);\n', rootDir);
  writeText('database/fixtures/.gitkeep', '', rootDir);
  writeJson('package.json', { scripts: { 'db:validate': 'echo validate' } }, rootDir);
}

// organization_id column contract (DATABASE_SPEC DB089-DB093).
const orgContractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-org-contract-'));
scaffoldValidDatabaseRoot(orgContractRoot);
writeText(
  'database/ddl/baseline/postgres/0001_org_contract.sql',
  [
    'CREATE TABLE org_good (',
    '  id TEXT NOT NULL PRIMARY KEY,',
    '  tenant_id TEXT NOT NULL,',
    "  organization_id TEXT NOT NULL DEFAULT '0',",
    '  name TEXT NOT NULL',
    ');',
    'CREATE TABLE org_nullable (',
    '  id TEXT NOT NULL PRIMARY KEY,',
    '  tenant_id TEXT NOT NULL,',
    '  organization_id TEXT,',
    '  name TEXT NOT NULL',
    ');',
    'CREATE TABLE org_no_default (',
    '  id TEXT NOT NULL PRIMARY KEY,',
    '  tenant_id TEXT NOT NULL,',
    '  organization_id BIGINT NOT NULL,',
    '  name TEXT NOT NULL',
    ');',
    'CREATE TABLE org_wrong_default (',
    '  id TEXT NOT NULL PRIMARY KEY,',
    '  tenant_id TEXT NOT NULL,',
    "  organization_id TEXT NOT NULL DEFAULT '',",
    '  name TEXT NOT NULL',
    ');',
    '',
  ].join('\n'),
  orgContractRoot,
);
const orgContract = validateDatabaseModuleContract(path.join(orgContractRoot, 'database'));
const orgContractFails = orgContract.failures.filter((item) => item.includes('organization_id ('));
assert.equal(
  orgContractFails.length,
  3,
  'organization_id contract must reject nullable, missing-default and wrong-default columns (DB089)',
);
assert.ok(
  orgContractFails.some((item) => item.includes('organization_id (TEXT) must be NOT NULL DEFAULT')),
  'nullable TEXT organization_id must be reported',
);
assert.ok(
  orgContractFails.some((item) => item.includes('organization_id (BIGINT) must be NOT NULL DEFAULT 0')),
  'NOT NULL BIGINT without sentinel default must be reported',
);
assert.ok(
  orgContractFails.some((item) => item.includes("DEFAULT ''")),
  'empty-string default must be reported as not the sentinel',
);

// Section 6.1: multi-prefix roots declare `tablePrefixes` (first entry primary) and
// must register every declined family; a root that declares neither, or declares
// both, is not an ownership-scoped database root.
const multiPrefixRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(multiPrefixRoot);
const multiPrefixManifestPath = path.join(multiPrefixRoot, 'database/database.manifest.json');
const multiPrefixManifest = JSON.parse(fs.readFileSync(multiPrefixManifestPath, 'utf8'));
delete multiPrefixManifest.tablePrefix;
multiPrefixManifest.tablePrefixes = ['demo_', 'demo_aux_'];
writeJson('database/database.manifest.json', multiPrefixManifest, multiPrefixRoot);
writeText(
  'database/contract/schema.yaml',
  'schema_version: 1\nkind: sdkwork.database.schema\ndatabase_role: authoritative-server\nmodule_id: demo\ncontract_version: 5.0.0\nengines:\n  - postgres\ntable_prefix: demo_\ntables: []\n',
  multiPrefixRoot,
);
writeJson(
  'database/contract/prefix-registry.json',
  {
    schemaVersion: 1,
    kind: 'sdkwork.database.prefix-registry',
    prefixes: [
      { prefix: 'demo_', owner: 'demo-platform' },
      { prefix: 'demo_aux_', owner: 'demo-platform' },
    ],
  },
  multiPrefixRoot,
);
const multiPrefix = validateDatabaseModuleContract(path.join(multiPrefixRoot, 'database'));
assert.ok(
  !multiPrefix.failures.some((item) => item.includes('tablePrefix')),
  `a fully registered multi-prefix root must pass, got ${JSON.stringify(multiPrefix.failures)}`,
);

const unregisteredSecondPrefixRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(unregisteredSecondPrefixRoot);
const unregisteredSecondPrefixManifest = JSON.parse(
  fs.readFileSync(path.join(unregisteredSecondPrefixRoot, 'database/database.manifest.json'), 'utf8'),
);
delete unregisteredSecondPrefixManifest.tablePrefix;
unregisteredSecondPrefixManifest.tablePrefixes = ['demo_', 'demo_aux_'];
writeJson('database/database.manifest.json', unregisteredSecondPrefixManifest, unregisteredSecondPrefixRoot);
writeText(
  'database/contract/schema.yaml',
  'schema_version: 1\nkind: sdkwork.database.schema\ndatabase_role: authoritative-server\nmodule_id: demo\ncontract_version: 5.0.0\nengines:\n  - postgres\ntable_prefix: demo_\ntables: []\n',
  unregisteredSecondPrefixRoot,
);
const unregisteredSecondPrefix = validateDatabaseModuleContract(
  path.join(unregisteredSecondPrefixRoot, 'database'),
);
assert.ok(
  unregisteredSecondPrefix.failures.some(
    (item) => item.includes('must register every database.manifest.json tablePrefix')
      && item.includes('demo_aux_'),
  ),
  'every declared prefix family must be registered, not only the primary one',
);

const noPrefixRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(noPrefixRoot);
const noPrefixManifestPath = path.join(noPrefixRoot, 'database/database.manifest.json');
const noPrefixManifest = JSON.parse(fs.readFileSync(noPrefixManifestPath, 'utf8'));
delete noPrefixManifest.tablePrefix;
writeJson('database/database.manifest.json', noPrefixManifest, noPrefixRoot);
const noPrefix = validateDatabaseModuleContract(path.join(noPrefixRoot, 'database'));
assert.ok(
  noPrefix.failures.some((item) => item.includes('must declare a non-empty tablePrefix or tablePrefixes')),
  'a root with no declared prefix is not ownership-scoped',
);

const bothPrefixFormsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(bothPrefixFormsRoot);
const bothPrefixFormsManifestPath = path.join(bothPrefixFormsRoot, 'database/database.manifest.json');
const bothPrefixFormsManifest = JSON.parse(fs.readFileSync(bothPrefixFormsManifestPath, 'utf8'));
bothPrefixFormsManifest.tablePrefixes = ['demo_'];
writeJson('database/database.manifest.json', bothPrefixFormsManifest, bothPrefixFormsRoot);
const bothPrefixForms = validateDatabaseModuleContract(path.join(bothPrefixFormsRoot, 'database'));
assert.ok(
  bothPrefixForms.failures.some((item) => item.includes('must not declare both tablePrefix and tablePrefixes')),
  'declaring both prefix forms must be rejected',
);

const noActiveSeedLocaleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-db-framework-'));
scaffoldValidDatabaseRoot(noActiveSeedLocaleRoot);
const noActiveSeedLocaleManifestPath = path.join(
  noActiveSeedLocaleRoot,
  'database/database.manifest.json',
);
const noActiveSeedLocaleManifest = JSON.parse(
  fs.readFileSync(noActiveSeedLocaleManifestPath, 'utf8'),
);
delete noActiveSeedLocaleManifest.lifecycle.activeSeedLocales;
writeJson('database/database.manifest.json', noActiveSeedLocaleManifest, noActiveSeedLocaleRoot);
const noActiveSeedLocale = validateDatabaseModuleContract(
  path.join(noActiveSeedLocaleRoot, 'database'),
);
assert.ok(
  noActiveSeedLocale.failures.some((item) => item.includes('activeSeedLocales must be a non-empty array')),
  'authoritative-server manifests must declare lifecycle.activeSeedLocales',
);

process.stdout.write('check-database-framework-standard.test.mjs passed\n');
