import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lifecycleEnvironmentForPath,
  isTextFile,
  migratePostgresProfileContent,
  shouldSkipDirectory,
  workspaceIdentityForEnvironment,
} from './unify-postgres-profile.mjs';

const scopedDatabaseKey = (scope, field) => ['SDKWORK', scope, 'DATABASE', field].join('_');

test('resolves every lifecycle environment without mapping staging to production', () => {
  assert.equal(lifecycleEnvironmentForPath('etc/topology/standalone.development.env'), 'development');
  assert.equal(lifecycleEnvironmentForPath('etc/topology/standalone.test.env'), 'test');
  assert.equal(lifecycleEnvironmentForPath('etc/topology/cloud.staging.env'), 'staging');
  assert.equal(lifecycleEnvironmentForPath('etc/topology/cloud.production.env'), 'production');
  assert.equal(workspaceIdentityForEnvironment('staging').database, 'sdkwork_ai_staging');
});

test('renames application and module database keys in source text', () => {
  const source = `${scopedDatabaseKey('CLOUD', 'URL')}=postgresql://old:secret@db/sdkwork_cloudrouter_dev
${scopedDatabaseKey('CLOUDROUTER', 'AUTO_MIGRATE')}=true
${scopedDatabaseKey('IAM', 'MAX_CONNECTIONS')}=4`;
  const result = migratePostgresProfileContent(source, 'src/config.rs');
  assert.equal(result.conflicts.length, 0);
  assert.match(result.content, /SDKWORK_DATABASE_URL/u);
  assert.match(result.content, /SDKWORK_DATABASE_AUTO_MIGRATE/u);
  assert.match(result.content, /SDKWORK_DATABASE_MAX_CONNECTIONS/u);
  assert.doesNotMatch(result.content, /SDKWORK_(?:CLOUD|CLOUDROUTER|IAM)_DATABASE_/u);
});

test('renames custom PostgreSQL URL keys to canonical database keys', () => {
  const source = `SDKWORK_MEMORY_POSTGRES_TEST_URL=postgres://localhost/test
SDKWORK_AGENT_RUNTIME_POSTGRES_URI=postgres://localhost/runtime`;
  const result = migratePostgresProfileContent(source, 'scripts/postgres-test.mjs');
  assert.equal(result.conflicts.length, 0);
  assert.equal(
    result.content,
    `SDKWORK_DATABASE_TEST_POSTGRES_URL=postgres://localhost/test
SDKWORK_DATABASE_URL=postgres://localhost/runtime`,
  );

  const bare = migratePostgresProfileContent(
    'ORDER_TEST_POSTGRES_URL=postgres://localhost/test',
    'scripts/postgres-test.mjs',
  );
  assert.equal(
    bare.content,
    'SDKWORK_DATABASE_TEST_POSTGRES_URL=postgres://localhost/test',
  );

  const canonical = migratePostgresProfileContent(
    'SDKWORK_DATABASE_TEST_POSTGRES_URL=postgres://localhost/test',
    'scripts/postgres-test.mjs',
  );
  assert.equal(canonical.changed, false);
});

test('normalizes config identity according to the profile path', () => {
  const source = `${scopedDatabaseKey('DRIVE', 'NAME')}=sdkwork_drive_staging
${scopedDatabaseKey('DRIVE', 'SCHEMA')}=public
${scopedDatabaseKey('DRIVE', 'USERNAME')}=sdkwork_drive
${scopedDatabaseKey('DRIVE', 'URL')}=postgresql://sdkwork_drive:secret@db/sdkwork_drive_staging?sslmode=require`;
  const result = migratePostgresProfileContent(
    source,
    'sdkwork-drive/etc/topology/cloud.staging.env',
  );
  assert.equal(result.conflicts.length, 0);
  assert.match(result.content, /SDKWORK_DATABASE_NAME=sdkwork_ai_staging/u);
  assert.match(result.content, /SDKWORK_DATABASE_SCHEMA=sdkwork_ai_staging/u);
  assert.match(result.content, /SDKWORK_DATABASE_USERNAME=sdkwork_ai_staging/u);
  assert.match(
    result.content,
    /postgresql:\/\/sdkwork_ai_staging:secret@db\/sdkwork_ai_staging\?sslmode=require/u,
  );
});

test('normalizes a legacy bare production database URL', () => {
  const result = migratePostgresProfileContent(
    'url = "postgres://prod-db:5432/sdkwork"',
    'sdkwork-terminal/config/server/terminal.production.toml.example',
  );

  assert.equal(result.changed, true);
  assert.equal(
    result.content,
    'url = "postgres://prod-db:5432/sdkwork_ai_prod"',
  );
});

test('inserts and normalizes the canonical schema fallback switch', () => {
  const missing = migratePostgresProfileContent(
    'SDKWORK_DATABASE_SCHEMA=sdkwork_ai_dev\nSDKWORK_DATABASE_USERNAME=sdkwork_ai_dev\n',
    'sdkwork-demo/postgres.env.example',
  );
  assert.match(
    missing.content,
    /SDKWORK_DATABASE_SCHEMA=sdkwork_ai_dev\nSDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false\n/u,
  );

  const enabled = migratePostgresProfileContent(
    'SDKWORK_DATABASE_SCHEMA=sdkwork_ai_dev\nSDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=true # migration residue\n',
    'sdkwork-demo/postgres.env.example',
  );
  assert.match(
    enabled.content,
    /SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false # migration residue/u,
  );
  assert.doesNotMatch(enabled.content, /SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=true/u);
});

test('migration excludes repository-generated runtime and test fixture directories', () => {
  assert.equal(shouldSkipDirectory('sdkwork-demo', 'target-test-fixtures'), true);
  assert.equal(shouldSkipDirectory('sdkwork-demo/.sdkwork', 'runtime'), true);
  assert.equal(shouldSkipDirectory('sdkwork-demo/src', 'runtime'), false);
});

test('migration includes root batch scripts and Dockerfiles', () => {
  assert.equal(isTextFile('sdkwork-demo/start-server.bat'), true);
  assert.equal(isTextFile('sdkwork-demo/deployments/Dockerfile.server'), true);
  assert.equal(isTextFile('sdkwork-demo/deployments/Dockerfile'), true);
});

test('detects canonical key conflicts without exposing values', () => {
  const result = migratePostgresProfileContent(
    `${scopedDatabaseKey('CLOUD', 'PASSWORD')}=first
SDKWORK_DATABASE_PASSWORD=second`,
    'sdkwork-demo/.env.release.example',
  );
  assert.deepEqual(result.conflicts, ['SDKWORK_DATABASE_PASSWORD']);
});

test('blocks multiple module keys that would become duplicate JavaScript object keys', () => {
  const result = migratePostgresProfileContent(
    `const env = {
  ${scopedDatabaseKey('IM', 'URL')}: databaseUrl,
  ${scopedDatabaseKey('RTC_STATE', 'URL')}: databaseUrl,
};`,
    'scripts/dev/embedded-database-env.mjs',
  );

  assert.deepEqual(result.conflicts, ['SDKWORK_DATABASE_URL']);
  assert.match(result.content, /SDKWORK_DATABASE_URL: databaseUrl/u);
});

test('requires manual migration for business storage fields', () => {
  const source = `${scopedDatabaseKey('AIOT_DEVICE', 'TABLE_PREFIX')}=iot_
${scopedDatabaseKey('AIOT_DEVICE', 'MODE')}=pool`;
  const result = migratePostgresProfileContent(
    source,
    'sdkwork-aiot/etc/topology/cloud.production.env',
  );

  assert.equal(result.changed, false);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.manualMigrations, [
    scopedDatabaseKey('AIOT_DEVICE', 'MODE'),
    scopedDatabaseKey('AIOT_DEVICE', 'TABLE_PREFIX'),
  ]);
  assert.equal(result.content, source);
  assert.doesNotMatch(result.content, /SDKWORK_DATABASE_(?:MODE|TABLE_PREFIX)/u);
});
