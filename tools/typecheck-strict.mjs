#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  STRICTNESS_FLOOR,
  isBaseFragmentTsconfig,
  isUpstreamBoundaryPath,
  parseJsonc,
  readEffectiveCompilerOptions,
} from './lib/typescript-federation-strictness.mjs';

const ERROR_LINE_PATTERN = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/u;

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    projects: [],
    scope: 'own',
    tsc: null,
    listProjects: false,
    includeVendored: false,
    help: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      args.root = path.resolve(argv[++index]);
    } else if (arg === '--project' || arg === '-p') {
      args.projects.push(argv[++index]);
    } else if (arg === '--scope') {
      args.scope = argv[++index];
    } else if (arg === '--tsc') {
      args.tsc = path.resolve(argv[++index]);
    } else if (arg === '--list-projects') {
      args.listProjects = true;
    } else if (arg === '--include-vendored') {
      args.includeVendored = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node tools/typecheck-strict.mjs --root <repository-root> [--project <tsconfig>...] [options]',
    '',
    'Runs `tsc --noEmit` with the federation strictness floor forced on, so a repository detects its',
    'own strictness drift instead of discovering it when a stricter consumer builds it',
    '(TYPESCRIPT_CODE_SPEC.md section 13).',
    '',
    'Options:',
    '  --root <path>           Repository root (default: current directory).',
    '  -p, --project <path>    tsconfig to check, relative to --root; repeatable.',
    '                          Defaults to every tsconfig in the repository that defines a program.',
    '  --scope own|all         "own" (default) fails only on errors in files inside --root; errors',
    '                          coming from federated sibling sources are reported but tolerated,',
    '                          because those belong to the sibling repository\'s own gate.',
    '  --tsc <path>            Path to the tsc entry point (default: resolved from node_modules).',
    '  --list-projects         Print the resolved project list and exit.',
    `  --include-vendored      Also scan read-only upstream trees (${['vendor', 'third_party', 'external'].join(', ')}).`,
    '                          Their errors are reported as "vendored" and never fail the run:',
    '                          AGENTS_SPEC forbids patching them, so the only remedy is a sync.',
    '  -h, --help              Show this help.',
    '',
    `Strictness floor: ${STRICTNESS_FLOOR.join(', ')}`,
  ].join('\n');
}

/**
 * Locates the `tsc` entry point. The package manager installs dev tooling per workspace package, so a repository
 * root often has no hoisted `typescript`; nested installs are searched as a fallback.
 */
function resolveTscBinary(root) {
  let current = path.resolve(root);
  while (true) {
    const candidate = path.join(current, 'node_modules', 'typescript', 'bin', 'tsc');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return findNestedTscBinary(root);
}

function findNestedTscBinary(root, maxDepth = 5) {
  const skip = new Set(['.git', 'dist', 'build', 'coverage', '.runtime', 'target']);
  let found = null;

  function walk(currentDir, depth) {
    if (found || depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found) {
        return;
      }
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        if (entry.name === 'node_modules') {
          const candidate = path.join(absolute, 'typescript', 'bin', 'tsc');
          if (fs.existsSync(candidate)) {
            found = candidate;
            return;
          }
          continue;
        }
        walk(absolute, depth + 1);
      }
    }
  }

  walk(root, 0);
  return found;
}

function isProgramProject(tsconfigPath) {
  // A shared `extends` target is not a program; see isBaseFragmentTsconfig in the library.
  if (isBaseFragmentTsconfig(tsconfigPath)) {
    return false;
  }
  const json = parseJsonc(fs.readFileSync(tsconfigPath, 'utf8'));
  if (!json) {
    return false;
  }
  const hasEntries = (value) => Array.isArray(value) && value.length > 0;
  const declaresProgram = hasEntries(json.include)
    || hasEntries(json.files)
    || Boolean(json.compilerOptions && Object.keys(json.compilerOptions).length > 0);
  if (!declaresProgram) {
    return false;
  }
  const options = readEffectiveCompilerOptions(tsconfigPath).compilerOptions;
  // A config that only sets `references` (or nothing) is a solution file, not a program.
  return Object.keys(options).length > 0;
}

function listProjectFiles(root) {
  const results = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.runtime', 'target']);

  function walk(currentDir, depth) {
    if (depth > 5) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        walk(absolute, depth + 1);
        continue;
      }
      if (entry.isFile() && /^tsconfig.*\.json$/u.test(entry.name) && isProgramProject(absolute)) {
        results.push(absolute);
      }
    }
  }

  walk(root, 0);
  return dedupeByDirectory(results);
}

function relativeToRoot(absolutePath, root) {
  return path.relative(root, absolutePath).replace(/\\/g, '/');
}

function isVendoredProject(absolutePath, root) {
  return isUpstreamBoundaryPath(relativeToRoot(absolutePath, root));
}

/**
 * Runs one program per directory: when a directory ships both `tsconfig.json` and narrower variants
 * such as `tsconfig.app.json`, the base config already covers the variant's files and running both
 * only duplicates diagnostics and cost.
 */
function dedupeByDirectory(files) {
  const byDirectory = new Map();
  for (const file of files) {
    const directory = path.dirname(file);
    if (!byDirectory.has(directory)) {
      byDirectory.set(directory, []);
    }
    byDirectory.get(directory).push(file);
  }

  const selected = [];
  for (const group of byDirectory.values()) {
    const canonical = group.find((file) => path.basename(file) === 'tsconfig.json');
    if (canonical) {
      selected.push(canonical);
    } else {
      selected.push(...group.sort());
    }
  }
  return selected.sort();
}

function parseErrors(output, root) {
  const errors = [];
  let current = null;

  for (const line of output.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }

    const match = line.match(ERROR_LINE_PATTERN);
    if (match) {
      current = {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4],
        message: match[5],
        details: [],
      };
      errors.push(current);
      continue;
    }

    // Indented lines are continuations of the preceding diagnostic, not separate errors.
    if (current && /^\s/u.test(line)) {
      current.details.push(line);
      continue;
    }

    current = { file: null, message: line, details: [] };
    errors.push(current);
  }

  for (const error of errors) {
    if (!error.file) {
      error.inside = true;
      continue;
    }
    const absolute = path.resolve(root, error.file);
    const relative = path.relative(root, absolute);
    error.inside = !relative.startsWith('..') && !path.isAbsolute(relative);
    error.vendored = error.inside && isUpstreamBoundaryPath(relative);
  }

  return errors;
}

function formatError(error) {
  return [error.raw ?? `${error.file ?? '<tsc>'}: ${error.message}`, ...(error.details ?? [])].join('\n');
}

function bucketOutsideErrors(errors, root) {
  const byRepo = new Map();
  for (const error of errors) {
    if (error.inside || !error.file) {
      continue;
    }
    const absolute = path.resolve(root, error.file);
    const relativeToParent = path.relative(path.dirname(root), absolute).replace(/\\/g, '/');
    const repo = relativeToParent.split('/')[0] ?? error.file;
    byRepo.set(repo, (byRepo.get(repo) ?? 0) + 1);
  }
  return [...byRepo.entries()].sort((left, right) => right[1] - left[1]);
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log(usage());
  process.exit(0);
}

if (args.scope !== 'own' && args.scope !== 'all') {
  console.error(`typecheck-strict: unknown --scope "${args.scope}" (expected "own" or "all")`);
  process.exit(2);
}

const tscBinary = args.tsc ?? resolveTscBinary(args.root);
if (!tscBinary) {
  console.error('typecheck-strict: could not locate typescript; install it or pass --tsc <path>');
  process.exit(2);
}

const discoveredProjects = args.projects.length > 0
  ? args.projects.map((project) => path.resolve(args.root, project))
  : listProjectFiles(args.root);

// An explicitly named project is always honoured: the operator asked for that program.
const suppressedVendored = args.includeVendored || args.projects.length > 0
  ? []
  : discoveredProjects.filter((project) => isVendoredProject(project, args.root));
const projects = discoveredProjects.filter((project) => !suppressedVendored.includes(project));

if (projects.length === 0) {
  console.error(`typecheck-strict: no tsconfig projects found under ${args.root}`);
  process.exit(2);
}

if (args.listProjects) {
  for (const project of projects) {
    console.log(relativeToRoot(project, args.root));
  }
  process.exit(0);
}

const strictnessArgs = STRICTNESS_FLOOR.map((flag) => `--${flag}`);
let failed = false;
let ownErrors = 0;
let vendoredErrors = 0;
let externalErrors = 0;

for (const project of projects) {
  const projectLabel = relativeToRoot(project, args.root);
  const result = spawnSync(
    process.execPath,
    [tscBinary, '--project', project, '--noEmit', '--pretty', 'false', ...strictnessArgs],
    { cwd: args.root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const errors = parseErrors(output, args.root);
  const own = errors.filter((error) => error.inside && !error.vendored);
  const vendored = errors.filter((error) => error.inside && error.vendored);
  const outside = errors.filter((error) => !error.inside);

  ownErrors += own.length;
  vendoredErrors += vendored.length;
  externalErrors += outside.length;

  const buckets = bucketOutsideErrors(outside, args.root);
  const counters = [`own=${own.length}`];
  if (vendored.length > 0) {
    counters.push(`vendored=${vendored.length}`);
  }
  counters.push(`external=${outside.length}`);
  console.log(
    `[${projectLabel}] ${counters.join(' ')}`
    + (buckets.length > 0
      ? ` (${buckets.map(([repo, count]) => `${repo}:${count}`).join(', ')})`
      : ''),
  );

  for (const error of own) {
    console.error(formatError(error));
  }
  for (const error of vendored) {
    console.error(`vendored: ${formatError(error)}`);
  }
  if (args.scope === 'all') {
    for (const error of outside) {
      console.error(formatError(error));
    }
  }

  // Vendored diagnostics are informational only: AGENTS_SPEC makes those trees read-only, so a
  // failure here would demand a patch that the specification forbids.
  if (own.length > 0 || (args.scope === 'all' && outside.length > 0)) {
    failed = true;
  }

  if (result.error) {
    console.error(`[${projectLabel}] tsc failed to start: ${result.error.message}`);
    failed = true;
  }
}

const counters = [`${projects.length} project(s)`, `own=${ownErrors}`];
if (vendoredErrors > 0 || suppressedVendored.length > 0) {
  counters.push(`vendored=${vendoredErrors}`);
}
counters.push(`external=${externalErrors}`, `scope=${args.scope}`);
if (suppressedVendored.length > 0) {
  counters.push(`skipped-vendored-projects=${suppressedVendored.length}`);
}
console.log(`typecheck-strict: ${counters.join(', ')}`);

if (externalErrors > 0 && args.scope === 'own') {
  console.log(
    'External errors come from federated sibling sources and are owned by those repositories; '
    + 'run this gate there, or use --scope all to see them.',
  );
}

if (suppressedVendored.length > 0) {
  console.log(
    'Read-only upstream trees (vendor/, third_party/, external/) are excluded: AGENTS_SPEC forbids '
    + 'patching them, so their diagnostics are upstream debt rather than repository debt. '
    + 'Pass --include-vendored to survey them.',
  );
}

if (vendoredErrors > 0) {
  console.log(
    'Vendored diagnostics are reported for visibility only and do not fail the run; the remedy is '
    + 'a vendored-sync, not a local patch.',
  );
}

process.exit(failed ? 1 : 0);
