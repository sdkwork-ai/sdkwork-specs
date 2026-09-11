#!/usr/bin/env node
/**
 * Verify database bootstrap references resolve to existing files and flag
 * greenfield SQL hazards in consolidated baselines.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TOOL_DIR, '../..');

const INCLUDE_RE = /include_str!\(\s*"([^"]+\.sql)"/g;
const PATH_RE = /database\/ddl\/baseline\/[^\s"'`]+\.sql|database\/migrations\/[^\s"'`]+\.sql/g;
/**
 * A consolidated baseline records the origin of every merged section:
 *   -- baseline source: ddl/baseline/<engine>/<file>.sql
 *   -- source: database/ddl/baseline/<engine>/<file>.sql#<anchor>
 * Renaming a baseline does not rewrite those comments, so they silently start
 * pointing at a file that no longer exists — provenance that lies about where the
 * DDL came from. `align-database-bootstrap-references.mjs` is the remediation;
 * this rule is what keeps the debt from coming back.
 */
const PROVENANCE_RE = /^--\s+(?:baseline\s+)?source:\s*(\S+?)(?:#\S*)?\s*$/gmu;
/**
 * Only authored repository content is governed. `.sdkwork/` holds generated
 * runtime contexts (byte copies of module sources rebaked per build) and `.tmp*`
 * scratch trees hold in-flight tool output; flagging either would report drift in
 * an artifact nobody authored.
 */
const SKIPPED_DIRS = [
  'node_modules', 'target', '.git', '.runtime', 'dist', 'build', '.pnpm-store',
  '.sdkwork', '.tools', '.tmp', '.cache', 'tmp', 'cache', 'external', 'vendor',
];
const SKIPPED_DIR_PREFIXES = ['.tmp-'];

function parseArgs(argv) {
  const args = { workspace: WORKSPACE_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--workspace') {
      args.workspace = path.resolve(argv[index + 1] ?? '');
      index += 1;
    }
  }
  return args;
}

function listRepos(workspace) {
  return fs
    .readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => path.join(workspace, entry.name))
    .filter((repoRoot) => fs.existsSync(path.join(repoRoot, 'database', 'database.manifest.json')));
}

export function shouldSkipDir(name) {
  return SKIPPED_DIRS.includes(name)
    || SKIPPED_DIR_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function walkSourceFiles(rootDir, files = []) {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (shouldSkipDir(entry.name)) {
      continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(fullPath, files);
      continue;
    }
    if (/\.(rs|mjs|js|py|json|sql)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveSqlPath(repoRoot, rawPath) {
  const normalized = rawPath.replaceAll('\\', '/');
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  return path.normalize(path.join(repoRoot, normalized));
}

function stripSqlComments(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

function isRetiredStub(sql) {
  return !/CREATE\s+TABLE/iu.test(stripSqlComments(sql));
}

/**
 * Only self-referential baseline provenance is gated: a comment claiming this
 * module's baseline came from a sibling baseline file must name a sibling that
 * actually exists. That is the debt a baseline rename leaves behind, and it is
 * what `align-database-bootstrap-references.mjs` migrates.
 *
 * References to consolidation sources elsewhere in the repository
 * (`crates/&#42;&#42;/migrations/&#42;&#42;`, `specs/&#42;&#42;`, `migrations/&#42;&#42;`, globs) are historical provenance for
 * files consolidation intentionally absorbed into the baseline. Their absence is
 * expected, so they MUST NOT be reported.
 */
export function checkProvenance(repoRoot, baselineDir, baselineFile, issues) {
  const engine = path.basename(baselineDir);
  const sql = fs.readFileSync(path.join(baselineDir, baselineFile), 'utf8');
  const siblingDirs = new Set([`ddl/baseline/${engine}`, `database/ddl/baseline/${engine}`]);
  for (const match of sql.matchAll(PROVENANCE_RE)) {
    const normalized = match[1].replaceAll('\\', '/');
    if (!siblingDirs.has(path.posix.dirname(normalized))) {
      continue;
    }
    if (fs.existsSync(path.join(baselineDir, path.posix.basename(normalized)))) {
      continue;
    }
    issues.push(
      `${engine}/${baselineFile}: provenance reference does not exist: ${match[1]}`,
    );
  }
}

export function checkBaselineDir(repoRoot, engine, issues, baselineStrategy) {
  const dir = path.join(repoRoot, 'database', 'ddl', 'baseline', engine);
  if (!fs.existsSync(dir)) {
    return;
  }
  const sqlFiles = fs.readdirSync(dir).filter((name) => name.endsWith('.sql'));
  const primary = sqlFiles.filter((name) => /^0001_.*_baseline\.sql$/u.test(name));
  const stubs = sqlFiles.filter((name) => !/^0001_.*_baseline\.sql$/u.test(name));

  // `baselineStrategy` decides whether a baseline file is required at all.
  // DATABASE_FRAMEWORK_SPEC.md §6.1: `migrations-only` MUST provide at least one
  // ordered `.up.sql` migration and "a baseline snapshot is optional"; only
  // `baseline-plus-migrations` and `baseline-only-dev` MUST provide the
  // engine-specific baseline file. This check was unconditional, so a
  // migrations-only module that keeps a baseline directory — as sdkwork-drama
  // does while its README documents drift-tooling consolidation — was reported
  // as if it had lost a baseline it never claimed to have. Declaration of the
  // strategy stays mandatory: an undeclared or unknown value is still an error.
  const baselineRequired = baselineStrategy !== 'migrations-only';
  if (baselineRequired && primary.length !== 1) {
    issues.push(
      `${engine}: expected exactly one 0001_*_baseline.sql (found ${primary.length})` +
        ` (baselineStrategy=${baselineStrategy ?? '<undeclared>'})`,
    );
  }
  for (const stub of stubs) {
    const sql = fs.readFileSync(path.join(dir, stub), 'utf8');
    if (!isRetiredStub(sql)) {
      issues.push(`${engine}/${stub}: supplemental baseline must be retired stub without CREATE TABLE`);
    }
  }
  if (engine === 'sqlite' && primary.length === 1) {
    const sql = stripSqlComments(fs.readFileSync(path.join(dir, primary[0]), 'utf8'));
    if (/CREATE\s+EXTENSION/iu.test(sql)) {
      issues.push(`${engine}/${primary[0]}: sqlite baseline must not CREATE EXTENSION`);
    }
  }
  if (primary.length === 1) {
    checkProvenance(repoRoot, dir, primary[0], issues);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const failures = [];

  for (const repoRoot of listRepos(args.workspace)) {
    const repoName = path.basename(repoRoot);
    const repoIssues = [];
    let manifest = null;
    try {
      manifest = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'database/database.manifest.json'), 'utf8').replace(/^\uFEFF/u, ''),
      );
    } catch (error) {
      repoIssues.push(`database manifest is unreadable: ${error.message}`);
    }

    for (const filePath of walkSourceFiles(repoRoot)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (filePath.endsWith('.rs')) {
        for (const match of content.matchAll(INCLUDE_RE)) {
          const resolved = resolveSqlPath(path.dirname(filePath), match[1]);
          if (!fs.existsSync(resolved)) {
            repoIssues.push(`missing include_str target: ${match[1]} (${path.relative(repoRoot, filePath)})`);
          }
        }
      }
      for (const match of content.matchAll(PATH_RE)) {
        if (!match[0].startsWith('database/ddl/baseline/')) {
          continue;
        }
        if (match[0].includes('_legacy_baseline') || match[0].includes('_catalog_baseline')) {
          const resolved = resolveSqlPath(repoRoot, match[0]);
          if (!fs.existsSync(resolved)) {
            repoIssues.push(`stale baseline path: ${match[0]} (${path.relative(repoRoot, filePath)})`);
          }
        }
      }
    }

    if (manifest?.databaseRole === 'authoritative-server') {
      checkBaselineDir(repoRoot, 'postgres', repoIssues, manifest.baselineStrategy);
      for (const relativePath of ['database/ddl/baseline/sqlite', 'database/migrations/sqlite']) {
        if (fs.existsSync(path.join(repoRoot, relativePath))) {
          repoIssues.push(`${relativePath}: authoritative-server roots must not own SQLite assets`);
        }
      }
    } else if (manifest?.databaseRole === 'client-local') {
      checkBaselineDir(repoRoot, 'sqlite', repoIssues, manifest.baselineStrategy);
      for (const relativePath of ['database/ddl/baseline/postgres', 'database/migrations/postgres']) {
        if (fs.existsSync(path.join(repoRoot, relativePath))) {
          repoIssues.push(`${relativePath}: client-local roots must not own PostgreSQL assets`);
        }
      }
    } else if (manifest) {
      repoIssues.push('databaseRole must classify the root as authoritative-server or client-local');
    }

    if (repoIssues.length > 0) {
      failures.push({ repo: repoName, issues: repoIssues });
    }
  }

  if (failures.length === 0) {
    console.log('check-database-bootstrap-references: PASS');
    return;
  }

  console.error('check-database-bootstrap-references: FAIL');
  for (const entry of failures) {
    console.error(`\n${entry.repo}:`);
    for (const issue of entry.issues) {
      console.error(`  - ${issue}`);
    }
  }
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
