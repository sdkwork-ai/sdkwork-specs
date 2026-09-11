#!/usr/bin/env node
/**
 * Per-repo verification that application databases are in initialization state
 * per DATABASE_FRAMEWORK_SPEC.md section 7.5 (and section 5.1 for the README).
 *
 * Initialization state is a property of the committed asset SET, not a demand that
 * the migration tree be empty. Section 7.5 keeps ordered post-baseline migrations as
 * the pre-baseline upgrade path (sections 7.3/7.4 forbid deleting lifecycle history),
 * so the presence of `migrations/postgres/*.up.sql` is NOT debt by itself. Debt is
 * limited to: loose migrations, unusable migration names, competing baselines, and an
 * undocumented `database/README.md` state section.
 *
 * Usage:
 *   node verify-database-initialization-state.mjs --workspace <dir> [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDatabaseFramework } from './check-database-framework-standard.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TOOL_DIR, '../..');

const REQUIRED_DB_SCRIPTS = [
  'db:validate',
  'db:plan',
  'db:init',
  'db:migrate',
  'db:seed',
  'db:status',
  'db:drift',
  'db:drift:check',
  'db:materialize:contract',
  'db:bootstrap',
];

const REQUIRED_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'de-DE', 'fr-FR', 'ru-RU', 'ko-KR'];

const BASELINE_STRATEGIES = new Set(['migrations-only', 'baseline-plus-migrations', 'baseline-only-dev']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRetiredBaselineStub(sql) {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return !/CREATE\s+TABLE/iu.test(withoutComments);
}

const CANONICAL_VALIDATOR = /check-database-framework-standard\.mjs/u;

/**
 * TEST_SPEC.md section 2.0.2.1 accepts "call the canonical validator" as an
 * alternative to shipping `tests/contract/database-framework.contract.test.*`.
 * Resolve one hop through a wrapper such as `test:contract:database: pnpm db:validate`.
 */
function callsValidatorScript(scripts) {
  for (const command of Object.values(scripts)) {
    if (CANONICAL_VALIDATOR.test(command)) return true;
  }
  // One hop: a wrapper such as `test:contract:database: pnpm db:validate` where
  // `db:validate` is itself the canonical validator is covered by the loop above.
  return false;
}

function parseArgs(argv) {
  const args = { workspace: WORKSPACE_ROOT, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--workspace') {
      args.workspace = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (token === '--json') {
      args.json = true;
    }
  }
  return args;
}

function normalizeModuleId(moduleId) {
  return String(moduleId ?? 'module')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function listRepos(workspaceRoot) {
  return fs
    .readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(workspaceRoot, name, 'database', 'database.manifest.json')))
    .sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

/**
 * Section 5.2 and section 6.1 client-local profile. A client-local root declares exactly
 * SQLite, owns a local-data policy, and may not borrow authoritative server assets.
 */
function verifyClientLocalRoot(databaseDir, manifest) {
  const issues = [];

  if (JSON.stringify(manifest.engines) !== JSON.stringify(['sqlite'])) {
    issues.push('manifest: client-local initialization requires engines=[sqlite]');
  }
  if (manifest.defaultEngine !== 'sqlite') {
    issues.push('manifest: client-local requires defaultEngine=sqlite');
  }

  const clientLocal = manifest.clientLocal;
  if (!clientLocal || typeof clientLocal !== 'object' || Array.isArray(clientLocal)) {
    issues.push('manifest: client-local requires clientLocal with mode, scope, and authoritativeSource');
  } else {
    if (!['cache', 'offline-projection', 'local-only'].includes(clientLocal.mode)) {
      issues.push(
        `manifest: clientLocal.mode must be cache, offline-projection, or local-only (found ${clientLocal.mode ?? 'missing'})`,
      );
    }
    for (const key of ['scope', 'authoritativeSource']) {
      if (!isNonEmptyString(clientLocal[key])) {
        issues.push(`manifest: clientLocal.${key} must be defined for a client-local root`);
      }
    }
    if (clientLocal.mode === 'offline-projection' && !isNonEmptyString(clientLocal.syncContract)) {
      issues.push('manifest: clientLocal.syncContract must be defined for offline-projection');
    }
  }

  if (!BASELINE_STRATEGIES.has(manifest.baselineStrategy)) {
    issues.push(
      `manifest: baselineStrategy must be migrations-only, baseline-plus-migrations, or baseline-only-dev (found ${manifest.baselineStrategy ?? 'missing'})`,
    );
  }

  for (const required of ['README.md', 'contract/schema.yaml', 'local-data-policy.yaml']) {
    if (!fs.existsSync(path.join(databaseDir, ...required.split('/')))) {
      issues.push(`layout: database/${required} missing for a client-local root`);
    }
  }
  if (!fs.existsSync(path.join(databaseDir, 'fixtures'))) {
    issues.push('layout: database/fixtures missing for a client-local root');
  }
  if (
    fs.existsSync(path.join(databaseDir, 'ddl/baseline/postgres'))
    || fs.existsSync(path.join(databaseDir, 'migrations/postgres'))
  ) {
    issues.push('layout: a client-local root must not contain PostgreSQL baseline or migration assets');
  }

  const sqliteBaselineDir = path.join(databaseDir, 'ddl/baseline/sqlite');
  const sqliteMigrationDir = path.join(databaseDir, 'migrations/sqlite');
  const hasBaseline = fs.existsSync(sqliteBaselineDir)
    && fs.readdirSync(sqliteBaselineDir).some((name) => name.endsWith('.sql'));
  const hasMigration = fs.existsSync(sqliteMigrationDir)
    && fs.readdirSync(sqliteMigrationDir).some((name) => name.endsWith('.up.sql'));

  if (manifest.baselineStrategy === 'migrations-only') {
    if (!hasMigration) {
      issues.push('migrations: migrations/sqlite must contain at least one .up.sql for migrations-only');
    }
  } else if (!hasBaseline) {
    issues.push('baseline: ddl/baseline/sqlite must contain at least one .sql baseline file');
  }

  return issues;
}

function verifyRepo(workspaceRoot, repoName) {
  const repoRoot = path.join(workspaceRoot, repoName);
  const databaseDir = path.join(repoRoot, 'database');
  const manifest = readJson(path.join(databaseDir, 'database.manifest.json'));
  const normalizedModuleId = normalizeModuleId(manifest.moduleId);
  const targetBaseline = `0001_${normalizedModuleId}_baseline.sql`;
  const issues = [];

  if (manifest.databaseRole === 'client-local') {
    // Section 5.2: a client-local root owns a separate SQLite layout and is NOT judged by
    // the authoritative-server rules of section 5.1.
    issues.push(...verifyClientLocalRoot(databaseDir, manifest));
    const framework = validateDatabaseFramework(repoRoot);
    if (!framework.ok) {
      issues.unshift(...framework.failures.map((failure) => `framework: ${failure}`));
    }
    return { repo: repoName, moduleId: manifest.moduleId, ok: issues.length === 0, issues };
  }
  if (manifest.databaseRole !== 'authoritative-server') {
    issues.push(
      `manifest: databaseRole must be authoritative-server or client-local (found ${manifest.databaseRole ?? 'missing'})`,
    );
    return { repo: repoName, moduleId: manifest.moduleId, ok: false, issues };
  }
  if (JSON.stringify(manifest.engines) !== JSON.stringify(['postgres'])) {
    issues.push('manifest: authoritative initialization requires engines=[postgres]');
  }

  const framework = validateDatabaseFramework(repoRoot);
  if (!framework.ok) {
    issues.push(...framework.failures.map((failure) => `framework: ${failure}`));
  }

  const baselineStrategy = manifest.baselineStrategy;
  if (!BASELINE_STRATEGIES.has(baselineStrategy)) {
    issues.push(
      `manifest: baselineStrategy must be migrations-only, baseline-plus-migrations, or baseline-only-dev (found ${baselineStrategy ?? 'missing'})`,
    );
  }
  const requiresBaseline = baselineStrategy === 'baseline-plus-migrations' || baselineStrategy === 'baseline-only-dev';

  const readmePath = path.join(databaseDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    issues.push('readme: database/README.md missing');
  } else {
    const readme = fs.readFileSync(readmePath, 'utf8');
    if (!readme.includes('## Initialization state')) {
      issues.push('readme: missing ## Initialization state section');
    }
    if (!/db:validate/.test(readme)) {
      issues.push('readme: missing db:validate command documentation');
    }
  }

  for (const engine of ['postgres']) {
    const migrationDir = path.join(databaseDir, 'migrations', engine);
    const migrationFiles = fs.existsSync(migrationDir)
      ? fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql'))
      : [];
    const upMigrations = migrationFiles.filter((name) => name.endsWith('.up.sql'));

    // Section 7.1: sortable version prefixes, unambiguous ordering, paired down files.
    const versions = new Map();
    for (const entry of migrationFiles) {
      const versionMatch = /^(\d+)_/u.exec(entry);
      if (!versionMatch) {
        issues.push(
          `migration-naming: migrations/${engine}/${entry} must start with a zero-padded numeric version prefix`,
        );
        continue;
      }
      if (!versions.has(versionMatch[1])) versions.set(versionMatch[1], []);
      versions.get(versionMatch[1]).push(entry);
    }
    for (const [version, entries] of versions) {
      const bases = new Set(entries.map((name) => name.replace(/\.(?:up|down)\.sql$/u, '')));
      if (bases.size > 1) {
        issues.push(`migration-naming: migrations/${engine} version ${version} is ambiguous (${entries.join(', ')})`);
      }
    }
    for (const entry of migrationFiles.filter((name) => name.endsWith('.down.sql'))) {
      if (!upMigrations.includes(entry.replace(/\.down\.sql$/u, '.up.sql'))) {
        issues.push(`migration-pairing: migrations/${engine}/${entry} has no matching .up.sql`);
      }
    }

    if (!requiresBaseline) {
      // Section 6.1/7.5: a migrations-only root is bootstrapped by its ordered
      // migrations and MUST NOT be required to commit a baseline.
      if (upMigrations.length === 0) {
        issues.push(`migrations: migrations/${engine} must contain at least one .up.sql for migrations-only`);
      }
      continue;
    }

    const baselineDir = path.join(databaseDir, 'ddl/baseline', engine);
    if (!fs.existsSync(baselineDir)) {
      issues.push(`baseline: ddl/baseline/${engine} missing`);
      continue;
    }
    const sqlFiles = fs.readdirSync(baselineDir).filter((name) => name.endsWith('.sql'));
    const primaryBaselines = sqlFiles.filter((name) => /^0001_.*_baseline\.sql$/iu.test(name));
    const supplementalBaselines = sqlFiles.filter((name) => !/^0001_.*_baseline\.sql$/iu.test(name));

    if (sqlFiles.length === 0) {
      issues.push(`baseline: ddl/baseline/${engine} has no .sql file`);
    } else {
      for (const supplemental of supplementalBaselines) {
        const supplementalSql = fs.readFileSync(path.join(baselineDir, supplemental), 'utf8');
        if (!isRetiredBaselineStub(supplementalSql)) {
          issues.push(
            `baseline: supplemental ddl/baseline/${engine}/${supplemental} must be retired stub without CREATE TABLE`,
          );
        }
      }
      if (primaryBaselines.length !== 1) {
        issues.push(
          `baseline: ddl/baseline/${engine} must have exactly one 0001_*_baseline.sql (found ${primaryBaselines.length})`,
        );
      } else if (primaryBaselines[0].toLowerCase() !== targetBaseline.toLowerCase()) {
        issues.push(`baseline: expected ${targetBaseline}, found ${primaryBaselines[0]} in ${engine}`);
      } else {
        const sql = fs.readFileSync(path.join(baselineDir, primaryBaselines[0]), 'utf8').trim();
        if (sql.length < 32) {
          issues.push(`baseline: ddl/baseline/${engine}/${primaryBaselines[0]} is too small`);
        }
      }
    }
  }

  const looseMigrations = fs.existsSync(path.join(databaseDir, 'migrations'))
    ? fs.readdirSync(path.join(databaseDir, 'migrations'), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
        .map((entry) => `loose-migration: migrations/${entry.name}`)
    : [];
  issues.push(...looseMigrations);

  for (const locale of REQUIRED_LOCALES) {
    const localeDir = path.join(databaseDir, 'seeds/locales', locale);
    if (!fs.existsSync(localeDir)) {
      issues.push(`seeds: seeds/locales/${locale} missing`);
    }
  }

  const packageJsonPath = path.join(repoRoot, 'package.json');
  let packageScripts = null;
  if (fs.existsSync(packageJsonPath)) {
    const scripts = readJson(packageJsonPath).scripts ?? {};
    packageScripts = scripts;
    for (const scriptName of REQUIRED_DB_SCRIPTS) {
      if (!scripts[scriptName]) {
        issues.push(`scripts: package.json missing ${scriptName}`);
      }
    }
    const materialize = scripts['db:materialize:contract'] ?? '';
    if (requiresBaseline) {
      const expectedBaseline = `database/ddl/baseline/postgres/${targetBaseline}`;
      // Section 12: the command MUST materialize THIS module's canonical baseline. The
      // materializer may be a repository thin wrapper that resolves the path internally,
      // so a literal canonical path is not required in the script string; delegating to
      // another repository's database root is not acceptable.
      const namesCanonicalBaseline = materialize.includes(expectedBaseline) || materialize.includes(targetBaseline);
      const shipsOwnMaterializer =
        /(?:^|[\s&|;])(?:node|python3?|pnpm|npx|deno|bun)\b[^\n&|;]*?\b(?:tools[./]|scripts[./])/u.test(materialize);
      if (!namesCanonicalBaseline && !shipsOwnMaterializer) {
        issues.push(
          `scripts: db:materialize:contract must materialize this module's canonical baseline (${expectedBaseline}) through a repository materializer`,
        );
      }
      if (!fs.existsSync(path.join(repoRoot, expectedBaseline))) {
        issues.push(`scripts: db:materialize:contract baseline file missing at ${expectedBaseline}`);
      }
    }
  }

  // TEST_SPEC.md section 2.0.2.1: a repository MUST provide the contract test file OR
  // call the canonical validator. Both are accepted; the file alone is not required.
  const contractDir = path.join(repoRoot, 'tests/contract');
  const hasContractTestFile =
    fs.existsSync(contractDir)
    && fs.readdirSync(contractDir).some((name) => /^database-framework\.contract\.test\./u.test(name));
  const callsCanonicalValidator = packageScripts !== null && callsValidatorScript(packageScripts);
  if (!hasContractTestFile && !callsCanonicalValidator) {
    issues.push(
      'tests: tests/contract/database-framework.contract.test.* missing and no script calls check-database-framework-standard.mjs',
    );
  }

  return {
    repo: repoName,
    moduleId: manifest.moduleId,
    ok: issues.length === 0,
    issues,
  };
}

function main() {
  const { workspace, json } = parseArgs(process.argv.slice(2));
  const rows = listRepos(workspace).map((repo) => verifyRepo(workspace, repo));

  if (json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    process.exit(rows.every((row) => row.ok) ? 0 : 1);
    return;
  }

  const passing = rows.filter((row) => row.ok);
  const failing = rows.filter((row) => !row.ok);

  process.stdout.write(`Database initialization state verification (${workspace})\n`);
  process.stdout.write(`Modules: ${rows.length}\n`);
  process.stdout.write(`Pass: ${passing.length}\n`);
  process.stdout.write(`Fail: ${failing.length}\n\n`);

  for (const row of rows) {
    process.stdout.write(`${row.ok ? 'PASS' : 'FAIL'} ${row.repo} (${row.moduleId})\n`);
    for (const issue of row.issues.slice(0, 8)) {
      process.stdout.write(`  - ${issue}\n`);
    }
    if (row.issues.length > 8) {
      process.stdout.write(`  - ... ${row.issues.length - 8} more\n`);
    }
  }

  process.exit(failing.length === 0 ? 0 : 1);
}

main();
