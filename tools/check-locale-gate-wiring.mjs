#!/usr/bin/env node

/**
 * Locale gate wiring audit.
 *
 * `I18N_SPEC.md` section 16.1 says a repository that ships scanned-language
 * source must be able to detect a reintroduced retired locale request header
 * from its own verify aggregate. Declaring the gate is not enough: the step has
 * to be *reachable* from the aggregate that `pnpm verify` runs, otherwise it
 * never executes and the repository is unprotected while looking wired.
 *
 * That distinction is what this audit measures. It walks each repository's own
 * script graph from its preferred aggregate (`_sdkwork:verify`, then `verify`,
 * then `check`), follows `pnpm`/`sdkwork-run-*` references and the
 * `sdkwork-app <command>` re-entry into `_sdkwork:<command>`, and reports
 * whether the locale gate is actually reachable.
 *
 * Report-only by default so it can run as a debt meter; `--enforce` turns an
 * unwired repository with an aggregate into a failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { listWorkspaceRepositoryRoots } from './lib/workspace-check-runner.mjs';
import { specsRoot } from './lib/workspace-registry.mjs';

const SPECS_ROOT = specsRoot();

/** Tools that carry the locale contract (directly or transitively). */
const LOCALE_GATE_RE = /verify-repo\.mjs|check-i18n-standard\.mjs/u;

/** Preference order from `I18N_SPEC.md` section 16.1 clause 2. */
const AGGREGATE_PREFERENCE = ['_sdkwork:verify', 'verify', 'check'];

function usage() {
  return [
    'Usage:',
    '  node tools/check-locale-gate-wiring.mjs [--workspace <workspace-root>] [--enforce] [--json]',
    '  node tools/check-locale-gate-wiring.mjs --root <repo>',
    '',
    'Reports whether the locale gate is reachable from each repository aggregate.',
  ].join('\n');
}

/**
 * Collect every command string reachable from `entry` inside one repository's
 * script table. Only references that resolve to a sibling script are followed,
 * so the walk terminates and never escapes the repository.
 */
export function reachableCommands(scripts, entry) {
  const seen = new Set();
  const commands = [];

  const visit = (name) => {
    if (!name || seen.has(name)) return;
    const command = scripts[name];
    if (typeof command !== 'string') return;
    seen.add(name);
    commands.push(command);

    const references = new Set();
    for (const match of command.matchAll(/\bpnpm(?:\s+run)?\s+([A-Za-z0-9:_-]+)/gu)) {
      references.add(match[1]);
    }
    for (const match of command.matchAll(/sdkwork-run-(?:pnpm|node)\s+([A-Za-z0-9:_-]+)/gu)) {
      references.add(match[1]);
    }
    // `sdkwork-app verify` re-enters the repository through its private hook.
    if (/\bsdkwork-app\s+(?:verify|check|build|test|dev|clean)\b/u.test(command)) {
      references.add('_sdkwork:verify');
      references.add('_sdkwork:check');
    }
    for (const reference of references) {
      if (scripts[reference]) visit(reference);
    }
  };

  visit(entry);
  return commands;
}

/** Classify one repository root. */
export function classifyRepositoryRoot(repoRoot) {
  const name = path.basename(repoRoot);
  const manifestPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    return { name, state: 'no-manifest' };
  }

  let scripts;
  try {
    scripts = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).scripts ?? {};
  } catch {
    return { name, state: 'unreadable-manifest' };
  }

  const aggregate = AGGREGATE_PREFERENCE.find((key) => typeof scripts[key] === 'string');
  if (!aggregate) {
    // No aggregate at all is a `PNPM_SCRIPT_SPEC.md` gap owned by that
    // specification, so it is a warning rather than a locale failure.
    return { name, state: 'no-aggregate' };
  }

  const wired = reachableCommands(scripts, aggregate).some((command) => LOCALE_GATE_RE.test(command));
  return { name, state: wired ? 'wired' : 'unwired', aggregate };
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      root: { type: 'string' },
      enforce: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  let repoRoots;
  if (values.root) {
    const root = path.resolve(values.root);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      console.error(`locale gate wiring audit cannot run: not a directory: ${root}`);
      process.exit(2);
    }
    repoRoots = [root];
  } else {
    const workspace = path.resolve(values.workspace ?? path.join(SPECS_ROOT, '..'));
    if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
      console.error(`locale gate wiring audit cannot run: not a directory: ${workspace}`);
      process.exit(2);
    }
    repoRoots = listWorkspaceRepositoryRoots(workspace);
    if (repoRoots.length === 0) {
      // A scan that enumerates nothing must not report success.
      console.error(`locale gate wiring audit cannot run: enumerated 0 repositories under ${workspace}`);
      process.exit(2);
    }
  }

  const results = repoRoots.map(classifyRepositoryRoot);
  const unwired = results.filter((r) => r.state === 'unwired');
  const noAggregate = results.filter((r) => r.state === 'no-aggregate');
  const wired = results.filter((r) => r.state === 'wired');
  const structural = results.filter((r) => r.state === 'no-manifest' || r.state === 'unreadable-manifest');

  if (values.json) {
    console.log(JSON.stringify({ wired: wired.length, unwired, noAggregate: noAggregate.map((r) => r.name), structural: structural.map((r) => r.name) }, null, 2));
  } else {
    console.log(`repositories audited: ${results.length}`);
    console.log(`  locale gate reachable from aggregate: ${wired.length}`);
    console.log(`  UNWIRED (aggregate exists, gate unreachable): ${unwired.length}`);
    console.log(`  no aggregate (PNPM_SCRIPT_SPEC gap, warning): ${noAggregate.length}`);
    console.log(`  no package.json (outside npm scope): ${structural.length}`);
    if (unwired.length > 0) {
      console.log('\nUnwired repositories:');
      for (const r of unwired) console.log(`  ${r.name} (aggregate: ${r.aggregate})`);
    }
    if (noAggregate.length > 0) {
      console.log('\nNo-aggregate repositories (warning):');
      console.log(`  ${noAggregate.map((r) => r.name).join(', ')}`);
    }
  }

  if (values.enforce && unwired.length > 0) {
    console.error(`\nlocale gate wiring audit failed: ${unwired.length} repository(ies) declare an aggregate but never run a locale gate`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
