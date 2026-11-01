#!/usr/bin/env node

/**
 * Enforces the single env-file shape of `ENVIRONMENT_SPEC.md` section 5.1.7.
 *
 * Exactly three `.env*` names may exist per scope:
 *
 *   .env                                      base layer
 *   .env.example                              the only template
 *   .env.<profile>.<environment>[.example]    the materialized per-scope file
 *
 * `<profile>` is `standalone` or `cloud`; `<environment>` is `development`,
 * `test`, `staging`, `demo`, or `production`. Nothing composes onto those
 * names, so `.env.local`, `.env.<profile>.<environment>.bootstrap.local`,
 * `.env.<environment>`, `.env.release`, `.env.postgres`, `.env.sqlite`, and
 * `.env.<platform>` are all violations.
 *
 * Host and packaging configuration is not a Vite env file: it lives at
 * `config/host/postgres.env[.example]` or
 * `apps/<surface>/packaging/<platform>.env[.example]`.
 *
 * Usage:
 *   node tools/check-env-file-naming.mjs [--root <dir>] [--workspace|--single]
 *                                        [--json] [--strict-references] [--quiet]
 *                                        [--no-references]
 *
 * `--root` defaults to the workspace above this repository. A root that holds
 * git checkouts (itself and/or direct child directories) is scanned repository
 * by repository; `--single` forces one tree. Nested checkouts are never
 * reported inside a parent, because each repository runs this gate itself.
 *
 * Exit codes: 0 clean, 1 violations, 2 usage error.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  classifyEnvFileName as classify,
  discoverRepositories,
  REFERENCE_ALLOW_MARKER,
  scanRepository,
} from './env-naming-lib.mjs';

const SPECS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export { classify as classifyEnvFileName };

/**
 * Parse CLI arguments.
 * @param argv - process arguments after the script name.
 * @returns parsed options.
 */
function parseArguments(argv) {
  const options = {
    root: path.resolve(SPECS_ROOT, '..'),
    json: false,
    quiet: false,
    strictReferences: false,
    references: true,
    mode: 'auto',
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
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--quiet') {
      options.quiet = true;
      continue;
    }
    if (argument === '--strict-references') {
      options.strictReferences = true;
      continue;
    }
    if (argument === '--no-references') {
      options.references = false;
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
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    return { error: `unknown argument: ${argument}` };
  }
  return options;
}

/**
 * Resolve the scan targets for one root.
 * @param root - absolute scan root.
 * @param mode - `auto`, `workspace`, or `single`.
 * @returns list of `{ name, root }` targets.
 */
function resolveTargets(root, mode) {
  if (mode === 'single') return [{ name: '', root }];
  const repositories = discoverRepositories(root);
  if (mode === 'workspace') return repositories;
  if (repositories.length <= 1) return [{ name: '', root }];
  return repositories;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.error !== undefined) {
    process.stderr.write(`check-env-file-naming: ${options.error}\n`);
    process.exit(2);
  }
  if (options.help === true) {
    process.stdout.write(
      'Usage: node tools/check-env-file-naming.mjs [--root <dir>] [--workspace|--single]\n'
      + '                                        [--json] [--quiet]\n'
      + '                                        [--strict-references] [--no-references]\n',
    );
    process.exit(0);
  }

  const targets = resolveTargets(options.root, options.mode);
  if (targets.length === 0) {
    process.stderr.write(`check-env-file-naming: no git checkout under ${options.root}\n`);
    process.exit(2);
  }

  const envFiles = [];
  const violations = [];
  const references = [];
  const prefix = target => (target.name === '' ? '' : `${target.name}/`);
  for (const target of targets) {
    const result = scanRepository(target.root, { references: options.references });
    const lead = prefix(target);
    for (const file of result.envFiles) envFiles.push(`${lead}${file}`);
    for (const violation of result.violations) {
      violations.push({ ...violation, file: `${lead}${violation.file}`, repository: target.name });
    }
    for (const hit of result.references) {
      references.push({ ...hit, file: `${lead}${hit.file}`, repository: target.name });
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      root: options.root,
      repositories: targets.map(target => target.name).filter(name => name !== ''),
      envFiles,
      violations,
      references,
    }, null, 2)}\n`);
  } else if (!options.quiet) {
    process.stdout.write(`check-env-file-naming: ${envFiles.length} env file(s) under ${options.root}\n`);
    for (const violation of violations) {
      process.stdout.write(`  FAIL ${violation.file}: ${violation.detail}\n`);
    }
    if (references.length > 0) {
      process.stdout.write(`  warn ${references.length} retired env-file reference(s) in source text${options.strictReferences ? '' : ` (add \`${REFERENCE_ALLOW_MARKER}\` to accept a diagnostic that names the retired spelling)`}\n`);
      for (const hit of references.slice(0, 40)) {
        process.stdout.write(`       ${hit.file}:${hit.line} ${hit.name}\n`);
      }
      if (references.length > 40) {
        process.stdout.write(`       ... ${references.length - 40} more\n`);
      }
    }
    process.stdout.write(
      violations.length === 0
        ? '  ok: every env file name matches ENVIRONMENT_SPEC 5.1.7\n'
        : `  ${violations.length} violation(s)\n`,
    );
  }

  const failed = violations.length > 0
    || (options.strictReferences && references.length > 0);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
