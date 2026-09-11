#!/usr/bin/env node
/**
 * Run every workspace gate independently and report a measurable matrix.
 *
 * Why this exists: the root `check:all` chain joins gates with `&&`, so it stops at the first
 * failure. That answers "is something red?" but not "how many are red, and by how much?" —
 * which is the question a regression loop actually needs. Each gate must therefore be run in
 * its own process, not through the chain.
 *
 * Two tiers:
 *   contract  - the gates in root `check:all`. These must exit 0. `check:all` stays the single
 *               source of truth for this list; this tool reads it rather than duplicating it.
 *   guardrail - gates with known, recorded debt. They are allowed to fail, but the item count
 *               must not exceed the baseline in `sdkwork-specs/gates.manifest.json`.
 *
 * Usage:
 *   node sdkwork-specs/tools/run-gate-matrix.mjs [--workspace <root>] [--json]
 *   node sdkwork-specs/tools/run-gate-matrix.mjs --only guardrail
 *   node sdkwork-specs/tools/run-gate-matrix.mjs --update-baseline
 *
 * Scopes: `workspace` (run once with --workspace), `repo` (run once per governed repository),
 * and `fixed` (run once with literal argv — for the legacy single-target gates that ignore
 * `--workspace` entirely and assert one hardcoded repository; they are registered so their
 * status stays visible, not because they cover the fleet).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWorkspaceRepositoryRoots } from './lib/workspace-check-runner.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const SPECS_ROOT = path.resolve(TOOL_DIR, '..');
const MANIFEST_PATH = path.join(SPECS_ROOT, 'gates.manifest.json');

/**
 * Normalise a gate's output into an item count.
 *
 * Gates in this workspace do not share one output format, so this takes the maximum of four
 * deterministic readings rather than summing them (a gate that prints both a summary and its
 * evidence lines must not be counted twice):
 *   - rule tallies       "  2  rust.module-file-case"
 *   - label : value      "violations    : 3"      (only for violation-ish labels, so that
 *                         "scanned files : 1137" is not mistaken for debt)
 *   - value then label   "24 finding(s) across 2 repo(s)"
 *   - bullet evidence    "- path:1 problem"
 *
 * Determinism matters more than absolute truth here: the baseline is recorded from this same
 * function, so a stable parser gives a stable regression signal.
 */
const VIOLATION_LABEL_RE = /(?:violation|finding|issue|problem|error|debt|offend|uncovered|missing)/iu;

/**
 * Detect a gate that died instead of reporting.
 *
 * A crashed gate prints a Node.js unhandled-exception dump, whose stack frames and source
 * excerpts are line-shaped enough to be miscounted as findings: `check-sdk-standard` crashed
 * with `ENOENT` on a missing build artifact and its stack trace was counted as "486 items",
 * which would have been recorded as a debt baseline. A crash is never a measurement, so it
 * must be reported as a crash and failed outright — in either tier.
 *
 * Narrow on purpose. An earlier version also keyed on `throw new Error`, which fires on a
 * gate that merely *prints* a matched source line containing that text — it wrongly flagged
 * `check-identity-naming` as crashed in 13 repositories that were reporting clean findings.
 * The fatal signature is the version banner plus Node stack frames, not the words in a finding.
 */
export function looksLikeCrash(output) {
  const hasVersionBanner = /^Node\.js v\d+\.\d+\.\d+\s*$/mu.test(output);
  const hasNodeFrame = /^\s+at .+\(node:[^)]+\)\s*$/mu.test(output);
  const hasErrnoBlock = /^\s*(?:errno|syscall):/mu.test(output);
  return hasVersionBanner || (hasNodeFrame && hasErrnoBlock);
}

export function countItems(output) {
  let tally = 0;
  let reported = 0;
  let bullets = 0;
  for (const line of output.split(/\r?\n/u)) {
    const tallyMatch = /^\s*(\d+)\s+[A-Za-z][\w.:-]*\s*$/u.exec(line);
    if (tallyMatch) tally += Number(tallyMatch[1]);

    const labelMatch = /^\s*([A-Za-z][\w -]*?)\s*:\s*(\d+)\s*$/u.exec(line);
    if (labelMatch && VIOLATION_LABEL_RE.test(labelMatch[1])) {
      reported = Math.max(reported, Number(labelMatch[2]));
    }

    const inlineMatch = /(\d+)\s+(?:finding|issue|violation|problem|error|debt|entry|entries)\b/iu.exec(line);
    if (inlineMatch) reported = Math.max(reported, Number(inlineMatch[1]));

    if (/^\s*[-*]\s+\S/u.test(line)) bullets += 1;
  }
  return Math.max(tally, reported, bullets);
}

function parseArgs(argv) {
  const options = { workspace: null, json: false, only: null, updateBaseline: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') options.workspace = argv[++index];
    else if (arg === '--only') options.only = argv[++index];
    else if (arg === '--json') options.json = true;
    else if (arg === '--update-baseline') options.updateBaseline = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function expand(template, values) {
  return template
    .replaceAll('{workspace}', values.workspace)
    .replaceAll('{repo}', values.repo);
}

/**
 * Build the argv for a root-batched gate.
 *
 * A `roots`-scope gate accepts a repeatable `--root` flag, so all governed repositories are
 * passed to a single process instead of spawning one process per repository. This matters:
 * `check-shell-portability` spent 463s of a 722s matrix run purely on process fan-out before
 * batching collapsed it to one invocation.
 */
function expandRoots(gate, repos) {
  const flag = gate.rootsFlag;
  if (typeof flag !== 'string' || flag.length === 0) {
    throw new Error(`${gate.id} uses scope "roots" but declares no rootsFlag`);
  }
  const args = [];
  for (const element of gate.argv) {
    if (element === '{roots}') {
      for (const repo of repos) args.push(flag, repo);
    } else {
      args.push(element);
    }
  }
  return args;
}

function runCommand(command, args, cwd) {
  const started = Date.now();
  const run = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const crashed = looksLikeCrash(output);
  return {
    exit: run.status ?? -1,
    seconds: Math.round((Date.now() - started) / 1000),
    output,
    crashed,
    // A crash has no item count. Reporting the parsed number here would invent a baseline out
    // of a stack trace, so the count is suppressed and the crash is failed explicitly.
    items: crashed ? 0 : countItems(output),
    tail: crashed
      ? `CRASHED: ${(output.match(/^(?:Error|.*Error):?.*$/mu)?.[0] ?? output.trim().split(/\r?\n/u).filter(Boolean).slice(-1)[0] ?? '').slice(0, 140)}`
      : (output.trim().split(/\r?\n/u).filter(Boolean).slice(-1)[0] ?? ''),
  };
}

/** The contract tier is derived from `check:all`, never duplicated in the manifest. */
function readContractGates(workspace) {
  const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
  const chain = pkg.scripts?.['check:all'];
  if (!chain) throw new Error('root package.json has no check:all script; cannot derive the contract tier');
  return [...chain.matchAll(/pnpm run ([a-z0-9:-]+)/giu)].map((match) => match[1]);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspace = path.resolve(options.workspace ?? path.join(SPECS_ROOT, '..'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const repos = listWorkspaceRepositoryRoots(workspace);

  const results = [];

  if (options.only !== 'guardrail') {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
    for (const gate of readContractGates(workspace)) {
      const script = rootPkg.scripts[gate];
      if (!script) continue;
      const run = runCommand('bash', ['-c', script], workspace);
      results.push({ id: gate, tier: 'contract', baseline: 0, ...run });
    }
  }

  if (options.only !== 'contract') {
    for (const gate of manifest.gates) {
      const resolved = path.join(SPECS_ROOT, 'tools', gate.tool);
      if (!fs.existsSync(resolved)) {
        results.push({ id: gate.id, tier: gate.tier, baseline: gate.baseline, exit: -1, seconds: 0, items: 0, tail: `missing tool: ${gate.tool}` });
        continue;
      }
      if (gate.scope === 'roots') {
        const args = expandRoots(gate, repos);
        const run = runCommand(process.execPath, [resolved, ...args], workspace);
        results.push({ id: gate.id, tier: gate.tier, baseline: gate.baseline, ...run });
        continue;
      }
      if (gate.scope === 'repo') {
        // Per-repository tools have no fleet mode, so the fleet signal is the aggregate.
        let exit = 0;
        let items = 0;
        let seconds = 0;
        let crashed = false;
        const crashedRepos = [];
        const offenders = [];
        for (const repo of repos) {
          const args = gate.argv.map((value) => expand(value, { workspace, repo }));
          const run = runCommand(process.execPath, [resolved, ...args], workspace);
          seconds += run.seconds;
          if (run.crashed) {
            crashed = true;
            crashedRepos.push(path.basename(repo));
            continue;
          }
          if (run.exit !== 0) {
            exit = run.exit;
            items += run.items;
            offenders.push(path.basename(repo));
          }
        }
        results.push({
          id: gate.id,
          tier: gate.tier,
          baseline: gate.baseline,
          exit,
          seconds,
          items: crashed ? 0 : items,
          crashed,
          // Report crashes and ordinary findings separately: an earlier version printed the
          // combined offender list under a "CRASHED in N repo(s)" label, which claimed repos
          // had crashed when they had simply reported findings.
          tail: crashed
            ? `CRASHED in ${crashedRepos.length} repo(s): ${crashedRepos.slice(0, 6).join(', ')}${
                offenders.length > 0 ? ` | ${offenders.length} repo(s) with findings` : ''
              }`
            : offenders.length > 0
              ? `${offenders.length} repo(s): ${offenders.slice(0, 6).join(', ')}`
              : 'all repos clean',
        });
        continue;
      }
      const args = gate.argv.map((value) => expand(value, { workspace }));
      const run = runCommand(process.execPath, [resolved, ...args], workspace);
      results.push({ id: gate.id, tier: gate.tier, baseline: gate.baseline, ...run });
    }
  }

  const regressions = results.filter((result) => {
    if (result.crashed) return true;
    return result.tier === 'contract' ? result.exit !== 0 : result.items > result.baseline;
  });

  if (options.updateBaseline) {
    for (const gate of manifest.gates) {
      const measured = results.find((result) => result.id === gate.id);
      if (measured) gate.baseline = measured.items;
    }
    manifest.measuredAt = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  if (options.json) {
    console.log(JSON.stringify({ workspace, repos: repos.length, results, regressions: regressions.map((r) => r.id) }, null, 2));
  } else {
    for (const result of results) {
      const flag = result.tier === 'contract' ? 'contract ' : 'guardrail';
      const status = result.crashed
        ? 'CRASH'
        : result.tier === 'contract'
          ? (result.exit === 0 ? 'ok  ' : 'FAIL')
          : (result.items > result.baseline ? 'FAIL' : 'ok  ');
      console.log(
        `${status} ${flag} ${result.id.padEnd(52)} exit=${String(result.exit).padEnd(3)} items=${String(result.items).padEnd(5)} baseline=${String(result.baseline).padEnd(5)} ${String(result.seconds).padStart(4)}s`,
      );
      if (status !== 'ok  ') console.log(`         ${result.tail.slice(0, 180)}`);
    }
    const contract = results.filter((r) => r.tier === 'contract');
    const guardrail = results.filter((r) => r.tier === 'guardrail');
    console.log('');
    console.log(`contract  green ${contract.filter((r) => r.exit === 0 && !r.crashed).length}/${contract.length}`);
    console.log(`guardrail within baseline ${guardrail.filter((r) => r.items <= r.baseline && !r.crashed).length}/${guardrail.length}`);
    console.log(`crashed: ${results.filter((r) => r.crashed).map((r) => r.id).join(', ') || '(none)'}`);
    console.log(`regressions: ${regressions.length === 0 ? '(none)' : regressions.map((r) => r.id).join(', ')}`);
  }

  process.exitCode = regressions.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
