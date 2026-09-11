#!/usr/bin/env node
/**
 * Align database bootstrap references after a baseline rename or
 * initialization-state reset. It rewrites the recorded provenance of a
 * consolidated baseline (`-- baseline source: ddl/baseline/<engine>/<file>.sql`)
 * so it names a baseline file that still exists.
 *
 * Registered mappings:
 * - 0001_*_legacy_baseline.sql -> 0001_*_baseline.sql
 * - 0001_sdkwork_models_catalog_baseline.sql -> 0001_sdkwork-models_baseline.sql
 * - 0001_videocut_legacy_baseline -> 0001_videocut_baseline (migration id strings)
 * - <engine>/0001_notary_foundation.sql -> <engine>/0001_notary_baseline.sql
 *   (scoped to `baseline/<engine>/`; the crate-local migration of the same name is
 *    intentionally absent and asserted as such by sdkwork-notary)
 * - 0001_prompts_ai_baseline.sql -> 0001_prompts_baseline.sql
 * - 0001_base_data_baseline.sql -> 0001_base-data_baseline.sql
 *
 * The inverse check is `check-database-bootstrap-references.mjs`; run it to find
 * a stale reference that is not registered here yet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TOOL_DIR, '../..');
/**
 * This tool's `REPLACEMENTS` table contains the legacy literals it rewrites, so
 * the tool's own source matches its own search patterns. Without this guard a
 * workspace-wide run (or `--dry-run`) reports the fixer as a hit and, without
 * `--dry-run`, silently rewrites the pattern table it is executing — corrupting
 * the fixer on first use. A migration fixer MUST be idempotent and MUST NOT
 * mutate its own definition, so the file that defines the mapping is excluded —
 * along with its regression test, which necessarily asserts on the same literals.
 */
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));
const EXCLUDED_PATHS = new Set([
  SELF_PATH,
  path.join(path.dirname(SELF_PATH), `${path.basename(SELF_PATH, '.mjs')}.test.mjs`),
]);

/**
 * `.sql` MUST be scanned. The legacy literals this tool migrates live in the
 * consolidated baseline headers emitted by `reset-database-initialization-state.mjs`
 * (`-- baseline source: ddl/baseline/<engine>/<file>.sql`), and those headers are
 * `.sql` files. Omitting `.sql` made every `align:database-bootstrap-references`
 * run a guaranteed no-op: the mapping table could never match anything.
 */
const TEXT_EXTENSIONS = new Set([
  '.rs', '.mjs', '.js', '.py', '.json', '.md', '.toml', '.yaml', '.yml', '.sql',
]);

/**
 * Migration ledger for baseline provenance. The consolidated baseline records the
 * origin of each merged section, and renaming a baseline does not rewrite those
 * comments, so each rename must be registered here. The mappings are deliberately
 * explicit rather than inferred from the baseline directory: an inferred rewrite
 * would silently repair a *wrong* reference instead of surfacing it, while an
 * explicit entry is an auditable decision per rename. A stale reference that is
 * not yet in this table is reported by `check-database-bootstrap-references.mjs`.
 *
 * Longest-first ordering matters: the specific catalog/mapping entries must be
 * applied before `_legacy_baseline.sql` collapses the generic suffix.
 */
const REPLACEMENTS = [
  ['0001_sdkwork_models_catalog_baseline.sql', '0001_sdkwork-models_baseline.sql'],
  ['0001_videocut_legacy_baseline', '0001_videocut_baseline'],
  // Engine-scoped on purpose: `0001_notary_foundation.sql` is also the name of the
  // retired crate-local migration that
  // `sdkwork-notary/scripts/verify-notary-standard-architecture.test.mjs` asserts is
  // gone. A bare-basename mapping would rewrite that guard into asserting a file
  // that never existed in the crate, so the rename is confined to baseline paths.
  ['baseline/postgres/0001_notary_foundation.sql', 'baseline/postgres/0001_notary_baseline.sql'],
  ['baseline/sqlite/0001_notary_foundation.sql', 'baseline/sqlite/0001_notary_baseline.sql'],
  ['0001_prompts_ai_baseline.sql', '0001_prompts_baseline.sql'],
  ['0001_base_data_baseline.sql', '0001_base-data_baseline.sql'],
  ['_legacy_baseline.sql', '_baseline.sql'],
];

function parseArgs(argv) {
  const args = { workspace: WORKSPACE_ROOT, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--workspace') {
      args.workspace = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token === '--help' || token === '-h') {
      console.log('Usage: node align-database-bootstrap-references.mjs [--workspace <dir>] [--dry-run]');
      process.exit(0);
    }
  }
  return args;
}

/**
 * Directories that never hold authored sources. `.sdkwork/` carries generated
 * runtime contexts (for example `sdkwork-webserver/.sdkwork/runtime/
 * docker-standalone-context/...`, which is a byte copy of module sources rebaked
 * on every build) and `.tmp*`/scratch trees hold in-flight agent output — a
 * content rewrite there is either thrown away or desyncs a generated artifact,
 * so both MUST stay out of scope.
 */
const SKIPPED_DIRS = [
  'node_modules', 'target', '.git', '.runtime', 'dist', 'build', '.pnpm-store',
  '.sdkwork', '.tools', '.tmp', '.cache', 'tmp', 'cache', 'external', 'vendor',
];
const SKIPPED_DIR_PREFIXES = ['.tmp-'];

export function shouldSkipDir(name) {
  return SKIPPED_DIRS.includes(name)
    || SKIPPED_DIR_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function applyReplacements(content) {
  let next = content;
  for (const [from, to] of REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  return next;
}

export function walkFiles(rootDir, files = []) {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (shouldSkipDir(entry.name)) {
      continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
      continue;
    }
    if (EXCLUDED_PATHS.has(path.resolve(fullPath))) {
      continue;
    }
    const ext = path.extname(entry.name);
    if (!TEXT_EXTENSIONS.has(ext)) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

export function listTargetRoots(workspace) {
  return fs
    .readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (entry.name.startsWith('sdkwork-') || entry.name === 'data'))
    .map((entry) => path.join(workspace, entry.name));
}

export function alignWorkspace(workspace, { dryRun = false, log = () => {} } = {}) {
  const changed = [];
  for (const root of listTargetRoots(workspace)) {
    for (const filePath of walkFiles(root)) {
      const original = fs.readFileSync(filePath, 'utf8');
      const updated = applyReplacements(original);
      if (updated === original) {
        continue;
      }
      changed.push(filePath);
      if (dryRun) {
        log(`[dry-run] would update ${filePath}`);
      } else {
        fs.writeFileSync(filePath, updated, 'utf8');
        log(`[align] updated ${filePath}`);
      }
    }
  }
  return changed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const changed = alignWorkspace(args.workspace, { dryRun: args.dryRun, log: console.log });
  console.log(
    `[align-database-bootstrap-references] ${args.dryRun ? 'would change' : 'changed'} ${changed.length} file(s)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF_PATH) {
  main();
}
