#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

const SKIP_DIRS = new Set([
  '.git',
  '.pnpm',
  '.runtime',
  'artifacts',
  'dist',
  'external',
  'generated',
  'node_modules',
  'target',
  'target-test-fixtures',
]);

const TEXT_EXTENSIONS = new Set([
  '.cmd',
  '.bat',
  '.env',
  '.example',
  '.js',
  '.json',
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

const MANUAL_STORAGE_FIELDS = new Set(['MODE', 'TABLE_PREFIX']);

export function isTextFile(filePath) {
  const base = path.basename(filePath).toLowerCase();
  return base.startsWith('.env')
    || base === 'dockerfile'
    || base.startsWith('dockerfile.')
    || TEXT_EXTENSIONS.has(path.extname(base));
}

export function shouldSkipDirectory(parentDir, name) {
  return SKIP_DIRS.has(name)
    || (
      path.basename(parentDir).toLowerCase() === '.sdkwork'
      && name.toLowerCase() === 'runtime'
    );
}

function collectFiles(root, files = []) {
  if (!fs.existsSync(root)) {
    return files;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && shouldSkipDirectory(root, entry.name)) {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, files);
    } else if (entry.isFile() && isTextFile(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function environmentToken(value) {
  const normalized = value.toLowerCase();
  const patterns = [
    ['production', /(?:^|[._-])(?:production|prod)(?:[._-]|$)/u],
    ['staging', /(?:^|[._-])staging(?:[._-]|$)/u],
    ['test', /(?:^|[._-])test(?:[._-]|$)/u],
    ['development', /(?:^|[._-])(?:development|dev)(?:[._-]|$)/u],
  ];
  return patterns.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

export function lifecycleEnvironmentForPath(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base === 'postgres.env' || base === 'postgres.env.example') {
    return 'development';
  }
  return environmentToken(base)
    ?? environmentToken(filePath.replaceAll('\\', '/'));
}

export function workspaceIdentityForEnvironment(environment) {
  if (environment === 'development') {
    return {
      database: 'sdkwork_ai_dev',
      schema: 'sdkwork_ai_dev',
      username: 'sdkwork_ai_dev',
    };
  }
  if (environment === 'test') {
    return {
      database: 'sdkwork_ai_test',
      schema: 'sdkwork_ai_test',
      username: 'sdkwork_ai_test',
    };
  }
  if (environment === 'staging') {
    return {
      database: 'sdkwork_ai_staging',
      schema: 'sdkwork_ai_staging',
      username: 'sdkwork_ai_staging',
    };
  }
  if (environment === 'production') {
    return {
      database: 'sdkwork_ai_prod',
      schema: 'sdkwork_ai_prod',
      username: 'sdkwork_ai_prod',
    };
  }
  return null;
}

function isProfileConfigFile(filePath) {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  return base.startsWith('.env')
    // Host-local database profiles are `config/host/postgres.env` and its
    // checked-in example, so they no longer carry an `.env.` prefix.
    || /^(?:postgres|sqlite)\.env(?:\.example)?$/u.test(base)
    || /\.(?:toml|yaml|yml)\.example$/u.test(base)
    || base.endsWith('.env')
    || normalized.includes('/etc/topology/')
    || normalized.includes('/config/server/')
    || normalized.includes('/config/container/')
    || normalized.includes('/deployments/templates/');
}

function renameDatabaseKeys(content) {
  return content
    .replace(
      /\bSDKWORK_(?!DATABASE_)[A-Z0-9_]+_(?:TEST_POSTGRES_URL|POSTGRES_TEST_URL)\b/gu,
      'SDKWORK_DATABASE_TEST_POSTGRES_URL',
    )
    .replace(
      /\b(?!SDKWORK_DATABASE_TEST_POSTGRES_URL\b)[A-Z0-9_]+_TEST_POSTGRES_URL\b/gu,
      'SDKWORK_DATABASE_TEST_POSTGRES_URL',
    )
    .replace(
      /\bSDKWORK_(?!DATABASE_)[A-Z0-9_]+_RUNTIME_POSTGRES_(?:URL|URI)\b/gu,
      'SDKWORK_DATABASE_URL',
    )
    .replace(
      /SDKWORK_(?!DATABASE_)([A-Z0-9_]+)_DATABASE_([A-Z0-9_]+)/gu,
      (match, _scope, field) => (
        MANUAL_STORAGE_FIELDS.has(field) ? match : `SDKWORK_DATABASE_${field}`
      ),
    )
    .replace(/\bDOCUMENTS_DATABASE_([A-Z0-9_]+)/gu, 'SDKWORK_DATABASE_$1');
}

function inspectManualStorageKeys(content) {
  return [...String(content).matchAll(
    /\bSDKWORK_(?!DATABASE_)[A-Z0-9_]+_DATABASE_(?:MODE|TABLE_PREFIX)\b/gu,
  )]
    .map((match) => match[0])
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort();
}

function inspectCanonicalKeyCollisions(content) {
  const sourcesByTarget = new Map();
  const addSource = (target, source) => {
    const sources = sourcesByTarget.get(target) ?? new Set();
    sources.add(source);
    sourcesByTarget.set(target, sources);
  };

  for (const match of String(content).matchAll(
    /\bSDKWORK_(?!DATABASE_)([A-Z0-9_]+)_DATABASE_([A-Z0-9_]+)\b/gu,
  )) {
    const field = match[2];
    if (!MANUAL_STORAGE_FIELDS.has(field)) {
      addSource(`SDKWORK_DATABASE_${field}`, match[0]);
    }
  }
  for (const match of String(content).matchAll(
    /\bSDKWORK_(?!DATABASE_)[A-Z0-9_]+_(?:TEST_POSTGRES_URL|POSTGRES_TEST_URL)\b/gu,
  )) {
    addSource('SDKWORK_DATABASE_TEST_POSTGRES_URL', match[0]);
  }
  for (const match of String(content).matchAll(
    /\b(?!SDKWORK_DATABASE_TEST_POSTGRES_URL\b)[A-Z0-9_]+_TEST_POSTGRES_URL\b/gu,
  )) {
    addSource('SDKWORK_DATABASE_TEST_POSTGRES_URL', match[0]);
  }
  for (const match of String(content).matchAll(
    /\bSDKWORK_(?!DATABASE_)[A-Z0-9_]+_RUNTIME_POSTGRES_(?:URL|URI)\b/gu,
  )) {
    addSource('SDKWORK_DATABASE_URL', match[0]);
  }
  for (const match of String(content).matchAll(/\bSDKWORK_DATABASE_[A-Z0-9_]+\b/gu)) {
    addSource(match[0], match[0]);
  }
  for (const match of String(content).matchAll(/\bDOCUMENTS_DATABASE_([A-Z0-9_]+)\b/gu)) {
    addSource(`SDKWORK_DATABASE_${match[1]}`, match[0]);
  }

  return [...sourcesByTarget.entries()]
    .filter(([, sources]) => sources.size > 1)
    .map(([target]) => target)
    .sort();
}

function replaceAssignmentValue(line, pattern, value) {
  return line.replace(pattern, `$1${value}$2`);
}

function normalizePostgresUrls(line, identity) {
  return line.replace(
    /(postgres(?:ql)?:\/\/)([^@\s/"']+@)?([^/\s"']+\/)([^?&#\s"']+)/giu,
    (_match, scheme, credentials, authority, _database) => {
      let nextCredentials = credentials;
      if (credentials) {
        const raw = credentials.slice(0, -1);
        const colon = raw.indexOf(':');
        nextCredentials = colon >= 0
          ? `${identity.username}${raw.slice(colon)}@`
          : `${identity.username}@`;
      }
      return `${scheme}${nextCredentials ?? ''}${authority}${identity.database}`;
    },
  );
}

function normalizeConfigIdentities(content, filePath) {
  if (!isProfileConfigFile(filePath)) {
    return content;
  }
  const identity = workspaceIdentityForEnvironment(lifecycleEnvironmentForPath(filePath));
  if (!identity) {
    return content;
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingEol = /\r?\n$/u.test(content);
  let section = '';
  const lines = content.split(/\r?\n/u).map((line) => {
    const sectionMatch = line.trim().match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      return line;
    }

    let next = line;
    next = replaceAssignmentValue(
      next,
      /^(\s*#?\s*SDKWORK_DATABASE_NAME\s*=\s*["']?)[^#\r\n]*?(["']?\s*(?:#.*)?)$/u,
      identity.database,
    );
    next = replaceAssignmentValue(
      next,
      /^(\s*#?\s*SDKWORK_DATABASE_SCHEMA\s*=\s*["']?)[^#\r\n]*?(["']?\s*(?:#.*)?)$/u,
      identity.schema,
    );
    next = replaceAssignmentValue(
      next,
      /^(\s*#?\s*SDKWORK_DATABASE_USERNAME\s*=\s*["']?)[^#\r\n]*?(["']?\s*(?:#.*)?)$/u,
      identity.username,
    );
    next = replaceAssignmentValue(
      next,
      /^(\s*POSTGRES_DB\s*:\s*["']?)[^#\r\n]*?(["']?\s*(?:#.*)?)$/u,
      identity.database,
    );
    next = replaceAssignmentValue(
      next,
      /^(\s*POSTGRES_USER\s*:\s*["']?)[^#\r\n]*?(["']?\s*(?:#.*)?)$/u,
      identity.username,
    );

    if (!section || section === 'database') {
      next = replaceAssignmentValue(
        next,
        /^(\s*database\s*=\s*")[^"]*(".*)$/u,
        identity.database,
      );
      next = replaceAssignmentValue(
        next,
        /^(\s*schema\s*=\s*")[^"]*(".*)$/u,
        identity.schema,
      );
      next = replaceAssignmentValue(
        next,
        /^(\s*username\s*=\s*")[^"]*(".*)$/u,
        identity.username,
      );
    }

    return normalizePostgresUrls(next, identity);
  });
  if (!hadTrailingEol && lines.at(-1) === '') {
    lines.pop();
  }
  let updated = lines.join(eol);
  if (
    path.basename(filePath).toLowerCase() === 'postgres.env.example'
    && /^\s*SDKWORK_DATABASE_SCHEMA\s*=/mu.test(updated)
  ) {
    if (/^\s*SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC\s*=/mu.test(updated)) {
      updated = updated.replace(
        /^(\s*SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC\s*=\s*)[^#\r\n]*?(\s*(?:#.*)?)$/gmu,
        '$1false$2',
      );
    } else {
      updated = updated.replace(
        /^(\s*SDKWORK_DATABASE_SCHEMA\s*=\s*[^\r\n]+)$/mu,
        `$1${eol}SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false`,
      );
    }
  }
  return updated;
}

function inspectCanonicalKeyConflicts(content) {
  const seen = new Map();
  const conflicts = new Set();
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^\s*(SDKWORK_DATABASE_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    if (seen.has(key) && seen.get(key) !== value) {
      conflicts.add(key);
    } else {
      seen.set(key, value);
    }
  }
  return [...conflicts].sort();
}

export function migratePostgresProfileContent(content, filePath) {
  const source = String(content);
  const manualMigrations = inspectManualStorageKeys(source);
  const renamed = renameDatabaseKeys(source);
  const updated = normalizeConfigIdentities(renamed, filePath);
  return {
    conflicts: [
      ...new Set([
        ...inspectCanonicalKeyCollisions(source),
        ...inspectCanonicalKeyConflicts(updated),
      ]),
    ].sort(),
    manualMigrations,
    content: updated,
    changed: updated !== content,
  };
}

function gitDirtyFiles(repoRoot) {
  const result = spawnSync(
    'git',
    ['-C', repoRoot, 'status', '--porcelain', '--untracked-files=all'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) {
    return new Set();
  }
  return new Set(
    result.stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => line.slice(3).split(' -> ').at(-1))
      .map((relativePath) => path.normalize(path.resolve(repoRoot, relativePath))),
  );
}

function repositoryRoots({ root, workspace }) {
  if (root) {
    return [path.resolve(root)];
  }
  const workspaceRoot = path.resolve(workspace ?? DEFAULT_WORKSPACE_ROOT);
  return fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => (
      entry.isDirectory()
      && entry.name.startsWith('sdkwork-')
      && entry.name !== 'sdkwork-specs'
    ))
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((repoRoot) => fs.existsSync(path.join(repoRoot, '.git')));
}

export function parseArgs(argv) {
  const args = { help: false, root: null, workspace: DEFAULT_WORKSPACE_ROOT, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--write') {
      args.write = true;
    } else if (arg === '--root' || arg === '--workspace') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a path`);
      }
      args[arg.slice(2)] = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (args.root && argv.includes('--workspace')) {
    throw new Error('use either --root or --workspace, not both');
  }
  return args;
}

function printHelp() {
  process.stdout.write(`Usage: node tools/unify-postgres-profile.mjs [options]\n\n`
    + 'Plan or apply the SDKWORK_DATABASE_* workspace migration.\n\n'
    + 'Options:\n'
    + '  --workspace <path>  Parent SDKWork workspace (default: tool parent workspace)\n'
    + '  --root <path>       Migrate one repository root\n'
    + '  --write             Apply the plan; default is read-only dry-run\n'
    + '  --help, -h\n');
}

export function runMigration(options) {
  const changed = [];
  const blocked = [];
  const conflicts = [];
  const manualMigrations = [];
  for (const repoRoot of repositoryRoots(options)) {
    const dirtyFiles = gitDirtyFiles(repoRoot);
    for (const filePath of collectFiles(repoRoot)) {
      const original = fs.readFileSync(filePath, 'utf8');
      const result = migratePostgresProfileContent(original, filePath);
      const relative = path.relative(options.workspace ?? DEFAULT_WORKSPACE_ROOT, filePath);
      if (result.manualMigrations.length > 0) {
        manualMigrations.push({ file: relative, keys: result.manualMigrations });
        continue;
      }
      if (!result.changed) {
        continue;
      }
      if (result.conflicts.length > 0) {
        conflicts.push({ file: relative, keys: result.conflicts });
        continue;
      }
      if (options.write && dirtyFiles.has(path.normalize(filePath))) {
        blocked.push(relative);
        continue;
      }
      if (options.write) {
        fs.writeFileSync(filePath, result.content, 'utf8');
      }
      changed.push(relative);
    }
  }
  return { blocked, changed, conflicts, manualMigrations };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = runMigration(options);
  const action = options.write ? 'updated' : 'would update';
  process.stdout.write(`Unified PostgreSQL profile ${action} ${result.changed.length} files.\n`);
  for (const file of result.changed.sort()) {
    process.stdout.write(`- ${file}\n`);
  }
  for (const conflict of result.conflicts) {
    process.stderr.write(`conflict: ${conflict.file} (${conflict.keys.join(', ')})\n`);
  }
  for (const migration of result.manualMigrations) {
    process.stderr.write(
      `manual storage-key migration required: ${migration.file} (${migration.keys.join(', ')})\n`,
    );
  }
  for (const file of result.blocked.sort()) {
    process.stderr.write(`dirty file not modified: ${file}\n`);
  }
  if (
    result.conflicts.length > 0
    || result.manualMigrations.length > 0
    || result.blocked.length > 0
  ) {
    process.exitCode = 1;
  } else if (!options.write && result.changed.length > 0) {
    process.stdout.write('Dry-run only. Re-run with --write after reviewing the plan.\n');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
