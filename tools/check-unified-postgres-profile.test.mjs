#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectLine,
  inspectPostgresExampleFile,
  inspectRuntimeSourceLine,
  isRuntimeRootScriptFile,
  isRuntimeSourceFile,
  shouldSkipDirectory,
} from './check-unified-postgres-profile.mjs';

const scopedDatabaseKey = (scope, field) => ['SDKWORK', scope, 'DATABASE', field].join('_');

test('accepts the canonical shared development identity', () => {
  const filePath = 'sdkwork-demo/postgres.env.example';
  assert.equal(inspectLine('SDKWORK_DATABASE_NAME=sdkwork_ai_dev', filePath), null);
  assert.equal(inspectLine('SDKWORK_DATABASE_SCHEMA=sdkwork_ai_dev', filePath), null);
  assert.equal(inspectLine('SDKWORK_DATABASE_USERNAME=sdkwork_ai_dev', filePath), null);
});

test('accepts a password file as the checked-in PostgreSQL credential source', () => {
  const content = `SDKWORK_DATABASE_ENGINE=postgresql
SDKWORK_DATABASE_HOST=127.0.0.1
SDKWORK_DATABASE_PORT=5432
SDKWORK_DATABASE_NAME=sdkwork_ai_dev
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_dev
SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false
SDKWORK_DATABASE_USERNAME=sdkwork_ai_dev
SDKWORK_DATABASE_PASSWORD_FILE=/run/secrets/sdkwork/database-password
SDKWORK_DATABASE_SSL_MODE=disable
SDKWORK_DATABASE_MAX_CONNECTIONS=10
SDKWORK_DATABASE_ADMIN_HOST=127.0.0.1
SDKWORK_DATABASE_ADMIN_PORT=5432
SDKWORK_DATABASE_ADMIN_USERNAME=postgres
SDKWORK_DATABASE_ADMIN_PASSWORD=postgres_admin_pass
SDKWORK_DATABASE_ADMIN_DATABASE=postgres
SDKWORK_DATABASE_ADMIN_SSL_MODE=disable
`;

  assert.deepEqual(
    inspectPostgresExampleFile('sdkwork-demo/postgres.env.example', content),
    [],
  );
});

test('accepts a direct password as the development PostgreSQL credential source', () => {
  const content = `SDKWORK_DATABASE_ENGINE=postgresql
SDKWORK_DATABASE_HOST=127.0.0.1
SDKWORK_DATABASE_PORT=5432
SDKWORK_DATABASE_NAME=sdkwork_ai_dev
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_dev
SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false
SDKWORK_DATABASE_USERNAME=sdkwork_ai_dev
SDKWORK_DATABASE_PASSWORD=sdkworkdev123
SDKWORK_DATABASE_SSL_MODE=disable
SDKWORK_DATABASE_MAX_CONNECTIONS=10
SDKWORK_DATABASE_ADMIN_HOST=127.0.0.1
SDKWORK_DATABASE_ADMIN_PORT=5432
SDKWORK_DATABASE_ADMIN_USERNAME=postgres
SDKWORK_DATABASE_ADMIN_PASSWORD=postgres_admin_pass
SDKWORK_DATABASE_ADMIN_DATABASE=postgres
SDKWORK_DATABASE_ADMIN_SSL_MODE=disable
`;

  assert.deepEqual(
    inspectPostgresExampleFile('sdkwork-demo/postgres.env.example', content),
    [],
  );
});

test('rejects application-prefixed database identity keys', () => {
  const filePath = 'sdkwork-demo/postgres.env.example';
  assert.match(
    inspectLine(`${scopedDatabaseKey('DEMO', 'NAME')}=sdkwork_ai_dev`, filePath),
    /retired application\/module-prefixed database key/u,
  );
  assert.match(
    inspectLine(`${scopedDatabaseKey('DEMO', 'URL')}=postgresql://sdkwork_ai_dev:secret@db:5432/sdkwork_ai_dev`, filePath),
    /retired application\/module-prefixed database key/u,
  );
});

test('requires exact shared identities in every application development profile', () => {
  const filePath = 'sdkwork-demo/etc/topology/standalone.development.env';
  assert.match(
    inspectLine(`${scopedDatabaseKey('DEMO', 'NAME')}=postgres`, filePath),
    /retired application\/module-prefixed database key/u,
  );
  assert.match(
    inspectLine(`${scopedDatabaseKey('DEMO', 'SCHEMA')}=sdkwork_ai_prod`, filePath),
    /retired application\/module-prefixed database key/u,
  );
  assert.match(
    inspectLine(`${scopedDatabaseKey('DEMO', 'USERNAME')}=postgres`, filePath),
    /retired application\/module-prefixed database key/u,
  );
  assert.match(
    inspectLine(
      `${scopedDatabaseKey('DEMO', 'URL')}=postgresql://sdkwork_ai_prod:secret@db:5432/sdkwork_ai_prod`,
      filePath,
    ),
    /retired application\/module-prefixed database key/u,
  );
});

test('rejects application-specific development databases and schemas', () => {
  const filePath = 'sdkwork-cloudrouter/postgres.env.example';
  assert.match(
    inspectLine('SDKWORK_DATABASE_NAME=sdkwork_cloudrouter_dev', filePath),
    /non-canonical/u,
  );
  assert.match(
    inspectLine('SDKWORK_DATABASE_SCHEMA=sdkwork_cloudrouter_dev', filePath),
    /non-canonical/u,
  );
  assert.match(
    inspectLine(`${scopedDatabaseKey('DEMO', 'SCHEMA')}=sdkwork_demo_dev`, filePath),
    /retired application\/module-prefixed database key/u,
  );
});

test('rejects application-specific PostgreSQL URL targets', () => {
  const filePath = 'sdkwork-cloudrouter/etc/topology/standalone.development.env';
  assert.match(
    inspectLine(
      'SDKWORK_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/sdkwork_cloudrouter_dev?sslmode=disable',
      filePath,
    ),
    /non-canonical/u,
  );
});

test('requires canonical-only schema fallback configuration', () => {
  const examplePath = 'sdkwork-demo/postgres.env.example';
  const topologyPath = 'sdkwork-demo/etc/topology/standalone.development.env';
  assert.equal(
    inspectLine('SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false', examplePath),
    null,
  );
  assert.match(
    inspectLine('SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=true', examplePath),
    /must be false/u,
  );
  assert.match(
    inspectLine('SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=0', examplePath),
    /must be false/u,
  );
  assert.equal(
    inspectLine('SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=no', topologyPath),
    null,
  );
});

test('keeps production identity distinct from development identity', () => {
  const productionPath = 'sdkwork-demo/etc/topology/standalone.production.env';
  assert.equal(
    inspectLine('SDKWORK_DATABASE_NAME=sdkwork_ai_prod', productionPath),
    null,
  );
  assert.match(
    inspectLine('SDKWORK_DATABASE_NAME=sdkwork_ai_dev', productionPath),
    /expected sdkwork_ai_prod/u,
  );
  assert.match(
    inspectLine(
      'SDKWORK_DATABASE_URL=postgresql://sdkwork_ai_dev:secret@db:5432/sdkwork_ai_dev',
      productionPath,
    ),
    /expected sdkwork_ai_prod/u,
  );
});

test('ignores deployment-time connection placeholders', () => {
  assert.equal(
    inspectLine(
      'SDKWORK_DATABASE_URL=postgresql://DEPLOY_INJECT:user@db:5432/DEPLOY_INJECT:database',
      'sdkwork-demo/etc/topology/cloud.production.env',
    ),
    null,
  );
});

test('rejects retired cloud-scoped database keys', () => {
  assert.match(
    inspectLine(`${scopedDatabaseKey('CLOUD', 'NAME')}=sdkwork_ai_dev`, 'sdkwork-demo/postgres.env.example'),
    /retired application\/module-prefixed database key/u,
  );
  assert.match(
    inspectLine(
      `${scopedDatabaseKey('CLOUD', 'URL')}=\${SDKWORK_DATABASE_URL}`,
      'sdkwork-demo/etc/topology/standalone.development.env',
    ),
    /retired application\/module-prefixed database key/u,
  );
  assert.match(
    inspectLine(
      `# ${scopedDatabaseKey('CLOUD', 'URL')}=postgresql://db.example.com/sdkwork_ai_dev`,
      'sdkwork-demo/postgres.env.example',
    ),
    /retired application\/module-prefixed database key/u,
  );
});

test('allows only workspace-scoped test database identities', () => {
  const filePath = 'sdkwork-demo/etc/topology/standalone.test.env';
  assert.equal(inspectLine('SDKWORK_DATABASE_NAME=sdkwork_ai_test', filePath), null);
  assert.equal(inspectLine('SDKWORK_DATABASE_SCHEMA=sdkwork_ai_test_123', filePath), null);
  assert.equal(inspectLine('SDKWORK_DATABASE_USERNAME=sdkwork_ai_test', filePath), null);
  assert.match(
    inspectLine('SDKWORK_DATABASE_USERNAME=sdkwork_ai_test_123', filePath),
    /expected sdkwork_ai_test/u,
  );
  assert.match(
    inspectLine('SDKWORK_DATABASE_NAME=demo_test_123', filePath),
    /expected sdkwork_ai_test/u,
  );
  assert.match(
    inspectLine('database = "sdkwork_drive_test"', filePath),
    /non-canonical/u,
  );
});

test('enforces lifecycle identity for structured TOML fields', () => {
  const stagingPath = 'sdkwork-demo/etc/server/demo.staging.toml.example';
  assert.equal(inspectLine('database = "sdkwork_ai_staging"', stagingPath), null);
  assert.equal(inspectLine('schema = "sdkwork_ai_staging"', stagingPath), null);
  assert.equal(inspectLine('username = "sdkwork_ai_staging"', stagingPath), null);
  assert.match(
    inspectLine('database = "sdkwork_ai_prod"', stagingPath),
    /expected sdkwork_ai_staging/u,
  );
  assert.match(
    inspectLine('schema = "public"', stagingPath),
    /expected sdkwork_ai_staging/u,
  );
});

test('rejects retired generic aliases', () => {
  const filePath = 'sdkwork-demo/postgres.env.example';
  assert.match(
    inspectLine('SDKWORK_DATABASE_SSLMODE=disable', filePath),
    /SDKWORK_DATABASE_SSL_MODE/u,
  );
  assert.match(inspectLine('DATABASE_PROVIDER=postgresql', filePath), /retired database key/u);
});

test('workspace temporary pool governance keys remain canonical database keys', () => {
  const filePath = 'sdkwork-demo/postgres.env.example';
  assert.equal(
    inspectLine('SDKWORK_DATABASE_TEMPORARY_ANY_POOL_EXCEPTION=true', filePath),
    null,
  );
  assert.equal(
    inspectLine('SDKWORK_DATABASE_TEMPORARY_DRIVER_POOL_COUNT=1', filePath),
    null,
  );
});

test('runtime source rejects concrete module-scoped database keys', () => {
  assert.match(
    inspectRuntimeSourceLine(`${scopedDatabaseKey('CLOUD', 'URL')}=postgresql://localhost/db`),
    /retired application\/module-prefixed database key/u,
  );
  assert.match(
    inspectRuntimeSourceLine(`const KEY: &str = "${scopedDatabaseKey('AIOT_DEVICE', 'ENGINE')}";`),
    /retired application\/module-prefixed database key/u,
  );
  assert.match(
    inspectRuntimeSourceLine('std::env::var("TEST_DATABASE_URL")'),
    /retired legacy database key/u,
  );
  assert.match(
    inspectRuntimeSourceLine(`std::env::var("${scopedDatabaseKey('CLIENT', 'PATH')}")`),
    /retired application\/module-prefixed database key/u,
  );
  assert.match(
    inspectRuntimeSourceLine(`const KEY: &str = "${scopedDatabaseKey('DRIVE', 'SQLITE_URL')}";`),
    /retired application\/module-prefixed database key/u,
  );
});

test('runtime source rejects retired workspace path and SSL aliases', () => {
  assert.match(
    inspectRuntimeSourceLine('std::env::var("SDKWORK_DATABASE_PATH")'),
    /retired workspace database alias/u,
  );
  assert.match(
    inspectRuntimeSourceLine('std::env::var("SDKWORK_DATABASE_SSLMODE")'),
    /retired workspace database alias/u,
  );
});

test('runtime source permits the live client-local SQLite key', () => {
  // SDKWORK_DATABASE_SQLITE_URL is the client-local connection key
  // (ENVIRONMENT_SPEC §7.2); desktop/native client code reads and sets it.
  assert.equal(
    inspectRuntimeSourceLine('std::env::var("SDKWORK_DATABASE_SQLITE_URL")'),
    null,
  );
  assert.equal(
    inspectRuntimeSourceLine('std::env::set_var("SDKWORK_DATABASE_SQLITE_URL", &url);'),
    null,
  );
});

test('runtime source permits explicit fail-closed retired-key rejection definitions', () => {
  assert.equal(
    inspectRuntimeSourceLine(
      '"SDKWORK_DATABASE_SSLMODE" // sdkwork-retired-database-key-rejection',
    ),
    null,
  );
});

test('runtime source allows internal database-related identifier names', () => {
  assert.equal(
    inspectRuntimeSourceLine('const DEFAULT_SQLITE_DATABASE_URL: &str = "sqlite::memory:";'),
    null,
  );
  assert.equal(
    inspectRuntimeSourceLine('struct IamDatabaseHost;'),
    null,
  );
});

test('checked-in topology env rejects legacy database keys without SDKWORK prefix', () => {
  assert.match(
    inspectLine(
      'GAMES_DATABASE_URL=postgresql://sdkwork_ai_dev:secret@db:5432/sdkwork_ai_dev',
      'sdkwork-games/configs/topology/standalone.development.env',
    ),
    /retired legacy database key/u,
  );
});

test('runtime source rejects invalid generic mode and table-prefix keys', () => {
  assert.match(
    inspectRuntimeSourceLine('SDKWORK_DATABASE_MODE=pool'),
    /unsupported workspace database key/u,
  );
  assert.match(
    inspectRuntimeSourceLine('const TABLE_PREFIX_KEY = "SDKWORK_DATABASE_TABLE_PREFIX";'),
    /unsupported workspace database key/u,
  );
});

test('runtime source rejects dynamic module-scoped database key construction', () => {
  assert.match(
    inspectRuntimeSourceLine('SDKWORK_<PROCESS>_DATABASE_MAX_CONNECTIONS'),
    /symbolic application\/module-prefixed database key/u,
  );
  assert.match(
    inspectRuntimeSourceLine('const key = `SDKWORK_${service}_DATABASE_URL`;'),
    /dynamic application\/module-prefixed database key construction/u,
  );
  assert.match(
    inspectRuntimeSourceLine('let key = format!("SDKWORK_{service}_DATABASE_URL");'),
    /dynamic application\/module-prefixed database key construction/u,
  );
  assert.match(
    inspectRuntimeSourceLine("const key = 'SDKWORK_' + service + '_DATABASE_URL';"),
    /concatenated application\/module-prefixed database key construction/u,
  );
});

test('runtime source accepts canonical database keys and module ownership metadata', () => {
  assert.equal(inspectRuntimeSourceLine('SDKWORK_DATABASE_URL=postgresql://localhost/db'), null);
  assert.equal(inspectRuntimeSourceLine('SDKWORK_DATABASE_MODULE_ID=iot'), null);
  assert.equal(inspectRuntimeSourceLine('SDKWORK_DATABASE_MAX_CONNECTIONS=10'), null);
  assert.equal(inspectRuntimeSourceLine('SDKWORK_DATABASE_FILE=.data/client.db'), null);
});

test('runtime source rejects legacy YAML database assignments', () => {
  assert.match(
    inspectRuntimeSourceLine('  CUSTOMER_SERVICE_DATABASE_URL: postgres://localhost/database'),
    /retired legacy database key/u,
  );
});

test('workflow PostgreSQL services use the canonical test identity', () => {
  const workflowPath = 'sdkwork-demo/.github/workflows/verify.yml';
  assert.equal(
    inspectRuntimeSourceLine('  POSTGRES_DB: sdkwork_ai_test', workflowPath),
    null,
  );
  assert.equal(
    inspectRuntimeSourceLine('  POSTGRES_USER: sdkwork_ai_test', workflowPath),
    null,
  );
  assert.equal(
    inspectRuntimeSourceLine(
      '  SDKWORK_DATABASE_URL: postgres://sdkwork_ai_test:secret@localhost/sdkwork_ai_test',
      workflowPath,
    ),
    null,
  );
  assert.match(
    inspectRuntimeSourceLine('  POSTGRES_DB: demo_test', workflowPath),
    /expected sdkwork_ai_test/u,
  );
  assert.match(
    inspectRuntimeSourceLine('  POSTGRES_USER: postgres', workflowPath),
    /expected sdkwork_ai_test/u,
  );
  assert.match(
    inspectRuntimeSourceLine(
      '  SDKWORK_DATABASE_URL: postgres://demo:secret@localhost/demo_test',
      workflowPath,
    ),
    /non-canonical PostgreSQL URL database/u,
  );
});

test('runtime source rejects custom PostgreSQL URL keys', () => {
  assert.equal(
    inspectRuntimeSourceLine('SDKWORK_DATABASE_TEST_POSTGRES_URL=postgres://localhost/test'),
    null,
  );
  assert.match(
    inspectRuntimeSourceLine('SDKWORK_MEMORY_POSTGRES_TEST_URL=postgres://localhost/test'),
    /SDKWORK_DATABASE_TEST_POSTGRES_URL/u,
  );
  assert.match(
    inspectRuntimeSourceLine('ORDER_TEST_POSTGRES_URL=postgres://localhost/test'),
    /SDKWORK_DATABASE_TEST_POSTGRES_URL/u,
  );
  assert.match(
    inspectRuntimeSourceLine('SDKWORK_AGENT_RUNTIME_POSTGRES_URI=postgres://localhost/runtime'),
    /SDKWORK_DATABASE_URL/u,
  );
});

test('scanner excludes repository-generated runtime and test fixture directories', () => {
  assert.equal(shouldSkipDirectory('target-test-fixtures', 'sdkwork-demo'), true);
  assert.equal(shouldSkipDirectory('runtime', 'sdkwork-demo/.sdkwork'), true);
  assert.equal(shouldSkipDirectory('runtime', 'sdkwork-demo/src'), false);
});

test('scanner includes root scripts and Dockerfiles as runtime source', () => {
  assert.equal(isRuntimeRootScriptFile('sdkwork-demo/start-server.bat'), true);
  assert.equal(isRuntimeSourceFile('sdkwork-demo/deployments/Dockerfile.server'), true);
  assert.equal(isRuntimeSourceFile('sdkwork-demo/deployments/Dockerfile'), true);
});

test('rejects cross-application database secret paths', () => {
  const filePath = 'sdkwork-documents/etc/topology/cloud.production.env';
  assert.match(
    inspectLine('SDKWORK_DATABASE_PASSWORD_FILE=/etc/sdkwork/router/database.secret', filePath),
    /cross-application database secret path/u,
  );
  assert.match(
    inspectRuntimeSourceLine(
      'password_file = "/etc/sdkwork/router/database.secret"',
      filePath,
    ),
    /cross-application database secret path/u,
  );
});

test('rejects per-application database secret migration fallbacks', () => {
  const filePath = 'sdkwork-membership/etc/topology/cloud.production.env';
  assert.match(
    inspectLine('SDKWORK_DATABASE_PASSWORD_FILE=/etc/sdkwork/membership/database.secret', filePath),
    /dated migration fallback/u,
  );
  assert.match(
    inspectLine(
      'password_file = "/etc/sdkwork/chat/database.secret"',
      'sdkwork-im/deployments/templates/server.env.example',
    ),
    /cross-application database secret path/u,
  );
});

test('accepts the workspace database configuration directory', () => {
  const topologyPath = 'sdkwork-demo/etc/topology/cloud.production.env';
  const tomlPath = 'sdkwork-demo/etc/server/demo.production.toml.example';
  assert.equal(
    inspectLine('SDKWORK_DATABASE_PASSWORD_FILE=/etc/sdkwork/database/database.secret', topologyPath),
    null,
  );
  assert.equal(
    inspectLine('password_file = "/etc/sdkwork/database/database.secret"', tomlPath),
    null,
  );
  assert.equal(
    inspectRuntimeSourceLine('password_file = "/etc/sdkwork/database/database.secret"', tomlPath),
    null,
  );
  assert.equal(
    inspectLine(
      'SDKWORK_DATABASE_PASSWORD_FILE=/run/secrets/sdkwork/database-password',
      topologyPath,
    ),
    null,
  );
});

test('rejects inline DEPLOY_INJECT database passwords', () => {
  const topologyPath = 'sdkwork-demo/etc/topology/cloud.production.env';
  const tomlPath = 'sdkwork-demo/etc/server/demo.production.toml.example';
  assert.match(
    inspectLine(
      'SDKWORK_DATABASE_PASSWORD=DEPLOY_INJECT:database-password-min-32-characters',
      topologyPath,
    ),
    /DEPLOY_INJECT/u,
  );
  assert.match(
    inspectLine('password = "DEPLOY_INJECT:database-password"', tomlPath),
    /DEPLOY_INJECT/u,
  );
});

test('rejects inline production database passwords outside placeholders', () => {
  const tomlPath = 'sdkwork-demo/etc/server/demo.production.toml.example';
  assert.match(
    inspectLine('password = "real-password"', tomlPath),
    /inline database password/u,
  );
  assert.equal(inspectLine('password = "change-me"', tomlPath), null);
  assert.equal(
    inspectLine(
      'password = "sdkworkdev123"',
      'sdkwork-demo/etc/server/demo.development.toml.example',
    ),
    null,
  );
});
