#!/usr/bin/env node

/**
 * Migrates repository env files to the naming contract of
 * `ENVIRONMENT_SPEC.md` section 5.1.7, and rewrites the source literals that
 * point at the moved files.
 *
 * Automated rules (deterministic path moves):
 *
 *   host     .env.postgres[.example]  ->  config/host/postgres.env[.example]
 *            .env.sqlite[.example]    ->  config/host/sqlite.env[.example]
 *   desktop  apps/<surface>/.env.<platform>[.example]
 *                                     ->  apps/<surface>/packaging/<platform>.env[.example]
 *   scalar   .env.<environment>[.example]
 *                                     ->  .env.standalone.<environment>[.example]
 *
 * Everything else (`.env.local`, composed `.bootstrap.local` overlays,
 * `.env.release.example`, `.env.<profile>.<non-environment>`) needs a
 * judgement call about the canonical target, so it is reported as `manual`.
 *
 * Usage:
 *   node tools/migrate-env-file-naming.mjs [--root <dir>] [--workspace|--single]
 *                                          [--rule host|desktop|scalar|all]
 *                                          [--apply] [--json]
 *
 * Dry run is the default: `--apply` performs `git mv`, plain renames for
 * untracked files, and in-place reference rewrites.
 *
 * Exit codes: 0 nothing to do, 1 work remains after the run, 2 usage error.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  classifyEnvFileName,
  discoverRepositories,
  ENVIRONMENTS,
  isEnvFileName,
  isGitCheckout,
  walkRepositoryFiles,
} from './env-naming-lib.mjs';

const SPECS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const DESKTOP_PLATFORMS = new Set(['windows', 'macos', 'linux']);

/** Text files that are generated or historical and never edited by this tool. */
const REWRITE_SKIP_PREFIXES = ['.agents/notes/', '.zcode/', '.workbuddy/'];
const REWRITE_SKIP_BASENAMES = new Set(['CHANGELOG.md', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'Cargo.lock']);

/**
 * Deterministic reference rewrites, applied in order (longest name first).
 * @type {Array<{name: string, replacement: string}>}
 */
const REFERENCE_REWRITES = [
  { name: '.env.postgres.example', replacement: 'config/host/postgres.env.example' },
  { name: '.env.sqlite.example', replacement: 'config/host/sqlite.env.example' },
  { name: '.env.postgres', replacement: 'config/host/postgres.env' },
  { name: '.env.sqlite', replacement: 'config/host/sqlite.env' },
];

/**
 * One planned move.
 * @typedef {{ from: string, to: string, rule: string, tracked: boolean }} PlannedMove
 */

/**
 * Plan the deterministic moves for one env file.
 * @param relative - repo-relative posix path.
 * @param base - file basename.
 * @returns the move, or `undefined` when the file needs a manual decision.
 */
function planMove(relative, base) {
  const directory = path.posix.dirname(relative);
  const parent = directory === '.' ? '' : directory;
  const segments = base.slice('.env.'.length).split('.');
  const canonicalParts = segments.at(-1) === 'example' ? segments.slice(0, -1) : segments;
  const suffix = segments.at(-1) === 'example' ? '.example' : '';
  const single = canonicalParts.length === 1 ? canonicalParts[0] : undefined;

  if (single === 'postgres' || single === 'sqlite') {
    return { to: joinPosix(parent, `config/host/${single}.env${suffix}`), rule: 'host' };
  }
  if (single !== undefined && DESKTOP_PLATFORMS.has(single)) {
    return { to: joinPosix(parent, `packaging/${single}.env${suffix}`), rule: 'desktop' };
  }
  if (single !== undefined && ENVIRONMENTS.has(single)) {
    return { to: joinPosix(parent, `.env.standalone.${single}${suffix}`), rule: 'scalar' };
  }
  return undefined;
}

/**
 * Join two posix path fragments, tolerating an empty parent.
 * @param parent - directory fragment, may be ''.
 * @param child - child fragment.
 * @returns joined posix path.
 */
function joinPosix(parent, child) {
  return parent === '' ? child : `${parent}/${child}`;
}

/**
 * Run git in one repository and return stdout.
 * @param repoRoot - repository working tree.
 * @param args - git arguments.
 * @returns stdout text, or '' on failure.
 */
function git(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) return '';
  return result.stdout ?? '';
}

/**
 * List tracked files of one repository.
 * @param repoRoot - repository working tree.
 * @returns repo-relative posix paths.
 */
function trackedFiles(repoRoot) {
  return git(repoRoot, ['ls-files', '-z'])
    .split('\u0000')
    .filter(Boolean);
}

/**
 * Is this path safe and meaningful to rewrite?
 * @param relative - repo-relative posix path.
 * @returns true when the file may be rewritten in place.
 */
function isRewritable(relative) {
  const base = path.posix.basename(relative);
  if (REWRITE_SKIP_BASENAMES.has(base)) return false;
  return !REWRITE_SKIP_PREFIXES.some(prefix => relative.startsWith(prefix));
}

/**
 * Rewrite retired env-file literals in one file.
 * @param absolute - absolute file path.
 * @returns true when the file changed.
 */
function rewriteReferences(absolute) {
  let text;
  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch {
    return false;
  }
  if (text.includes('\u0000')) return false;
  if (!text.includes('.env.postgres') && !text.includes('.env.sqlite')) return false;
  let next = text;
  for (const { name, replacement } of REFERENCE_REWRITES) {
    // The literal must start a token: `.env.postgres` inside
    // `config/host/postgres.env` is a different name and never matches, and
    // `obj.env.postgres` is a property chain.
    next = next.replaceAll(name, replacement);
  }
  if (next === text) return false;
  fs.writeFileSync(absolute, next);
  return true;
}

/**
 * Text files that may carry a reference to a moved path.
 * @param repoRoot - repository working tree.
 * @returns repo-relative posix paths.
 */
function textCandidates(repoRoot) {
  if (isGitCheckout(repoRoot)) return trackedFiles(repoRoot).filter(isRewritable);
  const files = [];
  walkRepositoryFiles(repoRoot, (absolute, relative) => {
    if (isRewritable(relative)) files.push(relative);
  });
  return files;
}

/**
 * Move one file, using `git mv` when git tracks it.
 * @param repoRoot - repository working tree.
 * @param move - planned move.
 * @returns true when the move succeeded.
 */
function applyMove(repoRoot, move) {
  const source = path.join(repoRoot, ...move.from.split('/'));
  const target = path.join(repoRoot, ...move.to.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    process.stderr.write(`  SKIP ${move.from}: ${move.to} already exists\n`);
    return false;
  }
  if (move.tracked) {
    const result = spawnSync('git', ['-C', repoRoot, 'mv', move.from, move.to], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status === 0) return true;
    process.stderr.write(`  WARN git mv failed for ${move.from}: ${(result.stderr ?? '').trim()}\n`);
  }
  try {
    fs.renameSync(source, target);
    return true;
  } catch (error) {
    process.stderr.write(`  WARN rename failed for ${move.from}: ${error.message}\n`);
    return false;
  }
}

/**
 * Parse CLI arguments.
 * @param argv - process arguments after the script name.
 * @returns parsed options.
 */
function parseArguments(argv) {
  const options = {
    root: path.resolve(SPECS_ROOT, '..'),
    mode: 'auto',
    rule: 'all',
    apply: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') {
      const value = argv[index + 1];
      if (value === undefined) return { error: '--root requires a directory' };
      options.root = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--rule') {
      const value = argv[index + 1];
      if (value === undefined) return { error: '--rule requires host, desktop, scalar, or all' };
      if (!['host', 'desktop', 'scalar', 'all'].includes(value)) {
        return { error: `unknown rule: ${value}` };
      }
      options.rule = value;
      index += 1;
      continue;
    }
    if (argument === '--workspace') {
      options.mode = 'workspace';
      continue;
    }
    if (argument === '--single') {
      options.mode = 'single';
      continue;
    }
    if (argument === '--apply') {
      options.apply = true;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    return { error: `unknown argument: ${argument}` };
  }
  return options;
}

/**
 * Resolve scan targets the same way the gate does.
 * @param root - absolute scan root.
 * @param mode - `auto`, `workspace`, or `single`.
 * @returns list of `{ name, root }`.
 */
function resolveTargets(root, mode) {
  if (mode === 'single') return [{ name: path.basename(root), root }];
  const repositories = discoverRepositories(root);
  if (mode === 'workspace') return repositories;
  if (repositories.length <= 1) return [{ name: path.basename(root), root }];
  return repositories;
}

/**
 * Build the plan for one repository.
 * @param repoRoot - repository working tree.
 * @param rule - requested rule filter.
 * @returns plan entries for this repository.
 */
function planRepository(repoRoot, rule) {
  const tracked = new Set(trackedFiles(repoRoot));
  const moves = [];
  const manual = [];
  walkRepositoryFiles(repoRoot, (absolute, relative) => {
    const base = path.basename(absolute);
    if (!isEnvFileName(base) || base === '.env' || base === '.env.example') return;
    if (classifyEnvFileName(base) === undefined) return;
    const planned = planMove(relative, base);
    if (planned === undefined) {
      manual.push({ file: relative, detail: classifyEnvFileName(base) ?? '' });
      return;
    }
    if (rule !== 'all' && planned.rule !== rule) return;
    moves.push({ from: relative, to: planned.to, rule: planned.rule, tracked: tracked.has(relative) });
  });
  return { moves, manual };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.error !== undefined) {
    process.stderr.write(`migrate-env-file-naming: ${options.error}\n`);
    process.exit(2);
  }
  if (options.help === true) {
    process.stdout.write(
      'Usage: node tools/migrate-env-file-naming.mjs [--root <dir>] [--workspace|--single]\n'
      + '                                          [--rule host|desktop|scalar|all]\n'
      + '                                          [--apply] [--json]\n',
    );
    process.exit(0);
  }

  const targets = resolveTargets(options.root, options.mode);
  const report = [];
  let pendingMoves = 0;
  let pendingManual = 0;

  for (const target of targets) {
    const { moves, manual } = planRepository(target.root, options.rule);
    if (moves.length === 0 && manual.length === 0) continue;
    const entry = { repository: target.name, root: target.root, moves, manual, rewritten: [] };
    if (options.apply && moves.length > 0) {
      for (const move of moves) {
        if (applyMove(target.root, move)) entry.rewritten.push(`moved ${move.from} -> ${move.to}`);
      }
      // Every tracked text file may mention a moved path, including the moved
      // files themselves.
      const candidates = new Set(textCandidates(target.root));
      // A moved private file is untracked, so it is not in `ls-files`, yet its
      // header comment names the retired path and must follow the rename.
      for (const move of moves) candidates.add(move.to);
      for (const relative of candidates) {
        const absolute = path.join(target.root, ...relative.split('/'));
        if (rewriteReferences(absolute)) entry.rewritten.push(`rewrote ${relative}`);
      }
    }
    // The exit code reports what is still wrong on disk, so a successful
    // `--apply` must be able to end at zero.
    const remaining = planRepository(target.root, options.rule);
    pendingMoves += remaining.moves.length;
    pendingManual += remaining.manual.length;
    report.push(entry);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ root: options.root, applied: options.apply, repositories: report }, null, 2)}\n`);
  } else {
    for (const entry of report) {
      process.stdout.write(`## ${entry.repository}\n`);
      for (const move of entry.moves) {
        process.stdout.write(`  ${move.tracked ? 'mv ' : 'mv?'} ${move.from} -> ${move.to}  [${move.rule}]\n`);
      }
      for (const item of entry.manual) {
        process.stdout.write(`  manual ${item.file}: ${item.detail}\n`);
      }
      if (options.apply) {
        for (const line of entry.rewritten) process.stdout.write(`  rewrote ${line}\n`);
      }
    }
    process.stdout.write(
      `migrate-env-file-naming: ${report.length} repository(ies), ${pendingMoves} remaining move(s), ${pendingManual} manual file(s), ${options.apply ? 'APPLIED' : 'dry run'}\n`,
    );
  }

  const remaining = pendingMoves + pendingManual;
  process.exit(remaining === 0 ? 0 : 1);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
