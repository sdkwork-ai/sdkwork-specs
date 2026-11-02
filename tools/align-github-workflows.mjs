#!/usr/bin/env node

/**
 * Align application repositories to the SDKWork GitHub workflow standard.
 *
 * The framework owns the workflow entrypoints and the standard owns the
 * contract, so alignment is a rendering step, not a per-repository edit: every
 * selected repository is rendered from its `agent.workflow.json` through
 * `sdkwork-github-workflow/scripts/render-app-workflows.mjs`. Repositories whose
 * gates exist only as bespoke workflow YAML are reported instead of rewritten,
 * because choosing the gate scripts is a semantic decision the repository owner
 * must make.
 *
 * Usage:
 *   node tools/align-github-workflows.mjs --workspace-root .. [--repo <name>]... [--write]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const CHECKER = path.join(import.meta.dirname, 'check-agent-workflow-standard.mjs');
const RENDERER = 'scripts/render-app-workflows.mjs';

function usage() {
  return [
    'Usage: node tools/align-github-workflows.mjs --workspace-root <parent> [options]',
    '',
    'Options:',
    '  --repo <name>         Align only this repository (repeatable).',
    '  --write              Write rendered entrypoints; default is a dry run.',
    '  --include-bespoke    Also replace bespoke verify.yml/package.yml bodies (gate choices become `scripts: verify`).',
    '  --json               Print the action plan as JSON.',
    '',
    'A repository is aligned when package.yml and verify.yml are rendered from its',
    'agent.workflow.json and its package.json declares the gate scripts the',
    'verification entrypoint runs.',
  ].join('\n');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function auditWorkspace(workspaceRoot) {
  const output = execFileSync(process.execPath, [
    CHECKER, '--workspace-root', workspaceRoot, '--report', '--json',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(output).repositories;
}

function gateScripts(root) {
  const manifestPath = path.join(root, 'package.json');
  if (!fs.existsSync(manifestPath)) return null;
  const scripts = readJson(manifestPath).scripts ?? {};
  if (typeof scripts.verify === 'string') return ['verify'];
  return null;
}

function isCaller(file, workflow) {
  if (!fs.existsSync(file)) return false;
  return new RegExp(`sdkwork-github-workflow/\\.github/workflows/${workflow}@`, 'u').test(fs.readFileSync(file, 'utf8'));
}

// Steps the reusable workflow owns. A bespoke verification workflow that only
// adds these before its gate is safe to replace: the gate list is preserved as
// `scripts`, and the framework performs the install itself.
// Steps the reusable workflow owns. A bespoke verification workflow that only
// adds these before its gate is safe to replace: the gate list is preserved as
// `scripts`, and the framework performs the install and dependency checkout
// itself. The sibling `git clone` lines are the legacy form of exactly that
// checkout — the framework's `checkout-dependencies` action replaces them.
const FRAMEWORK_OWNED_COMMAND = /^(?:pnpm|npm|yarn|bun)\s+(?:install|i)\b|^(?:cargo|pip|pip3|composer|choco|apt-get|brew)\s+install\b|^corepack\b|^pnpm\s+store\b|^node\s+scripts\/prepare-(?:ci-|shared-sdk-git-sources|ci-dependencies)|^git\s+clone\s/u;
const PACKAGE_SCRIPT_COMMAND = /^(?:pnpm|npm|yarn|bun)(?:\s+run)?\s+([A-Za-z0-9:._-]+)$/u;
const SHELL_NOISE = /^(?:#|set\s|echo\b|export\b|cd\b|source\b|\benv\b|if\b|then\b|fi\b|else\b|for\b|do\b|done\b|working-directory:|\||--)/u;

/**
 * Extract the executable commands a workflow's `run:` steps declare.
 * @param {string} text - Workflow YAML.
 * @returns {string[]} Command lines, block steps expanded.
 */
function workflowCommands(text) {
  const lines = text.split(/\r?\n/u);
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*-?\s*run:\s*(.*)$/u.exec(lines[index]);
    if (!match) continue;
    const inline = match[1].trim();
    if (!/^[|>][-+]?$/u.test(inline)) {
      if (inline !== '') commands.push(inline.replace(/^['"]|['"]$/gu, ''));
      continue;
    }
    for (let blockIndex = index + 1; blockIndex < lines.length; blockIndex += 1) {
      const line = lines[blockIndex];
      if (line.trim() === '') continue;
      if (!/^\s{10,}/u.test(line)) break;
      commands.push(line.trim());
    }
  }
  return commands
    .flatMap((command) => command.split('&&').map((part) => part.trim()))
    .filter((command) => command !== '');
}

/**
 * Derive the gate scripts a bespoke verification workflow runs.
 *
 * The replacement is behavior-preserving only when every gate is a package
 * script the repository already declares: the framework then owns checkout,
 * toolchain setup, dependency checkout, and install, and runs the same gates.
 * @param {string} root - Repository root.
 * @param {string} verifyPath - Bespoke verification workflow path.
 * @returns {string[]|null} Gate scripts, or null when the workflow does more.
 */
function bespokeGateScripts(root, verifyPath) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const available = manifest.scripts ?? {};
  const gates = workflowCommands(fs.readFileSync(verifyPath, 'utf8'))
    .filter((command) => !FRAMEWORK_OWNED_COMMAND.test(command))
    .filter((command) => !SHELL_NOISE.test(command));
  if (gates.length === 0) return null;
  const scripts = [];
  for (const gate of gates) {
    const match = PACKAGE_SCRIPT_COMMAND.exec(gate);
    if (match === null) return null;
    const script = match[1];
    if (!(script in available)) return null;
    if (!scripts.includes(script)) scripts.push(script);
  }
  return scripts;
}

/**
 * Plan one repository's alignment.
 * @param {string} root - Repository root.
 * @param {{ role: string, issues: string[] }} audit - Checker result for the repository.
 * @param {{ includeBespoke: boolean }} options - Whether bespoke workflow bodies may be replaced.
 * @returns {{ action: 'align'|'skip'|'manual', reason?: string, files?: string[] }} Plan entry.
 */
function planRepository(root, audit, options) {
  // The framework owns its workflows; a fork or a vendored third-party project
  // mirrors an upstream CI graph this tool must not rewrite.
  if (audit.role === 'framework' || audit.role === 'fork-upstream' || audit.role === 'third-party') {
    return { action: 'skip', reason: `role ${audit.role}` };
  }
  const hasConfig = fs.existsSync(path.join(root, 'agent.workflow.json'));
  if (!hasConfig && audit.role === 'application') {
    return { action: 'manual', reason: 'no agent.workflow.json; declare the packaging contract first' };
  }
  const manifestPath = path.join(root, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    return { action: 'manual', reason: 'no package.json; the verification workflow runs package scripts' };
  }
  const availableScripts = readJson(manifestPath).scripts ?? {};
  const verifyPath = path.join(root, '.github', 'workflows', 'verify.yml');
  let scripts = null;
  if (!options.includeBespoke && fs.existsSync(verifyPath) && !isCaller(verifyPath, 'sdkwork-ci.yml')) {
    // A bespoke workflow whose gates are exactly package-script calls is
    // behavior-preserving to replace; anything else needs the owner's decision.
    scripts = bespokeGateScripts(root, verifyPath);
    if (scripts === null) {
      return { action: 'manual', reason: 'verify.yml runs gates the repository does not declare as package scripts; move them into verify, then re-run' };
    }
  }
  if (!(('verify' in availableScripts) || (Array.isArray(scripts) && scripts.length > 0))) {
    // `verify` is the merge-ready aggregate; a repository that has not adopted it
    // yet still has a canonical static check or test entry to run.
    const fallback = ['check', 'test'].find((name) => name in availableScripts);
    if (fallback === undefined) {
      return { action: 'manual', reason: 'package.json declares no verify, check, or test script for the verification entrypoint' };
    }
    scripts = scripts ?? [fallback];
  }
  if (audit.role === 'application') {
    const packagePath = path.join(root, '.github', 'workflows', 'package.yml');
    if (!options.includeBespoke && fs.existsSync(packagePath) && !isCaller(packagePath, 'sdkwork-package.yml')) {
      return { action: 'manual', reason: 'package.yml is bespoke; declare its targets in agent.workflow.json, then re-run' };
    }
  }
  return {
    action: 'align',
    scripts,
    verifyOnly: !hasConfig || audit.role === 'ci-only',
    // A `ci-only` repository owns no packaging entrypoint. When an earlier
    // alignment rendered one from a configuration that declares no target, the
    // entrypoint is framework-generated and carries no repository logic, so it
    // is removed again instead of drifting into a release pipeline.
    removePackage: audit.role === 'ci-only' && isCaller(path.join(root, '.github', 'workflows', 'package.yml'), 'sdkwork-package.yml'),
    files: audit.role === 'ci-only'
      ? ['.github/workflows/verify.yml']
      : ['.github/workflows/package.yml', '.github/workflows/verify.yml'],
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      'workspace-root': { type: 'string' },
      repo: { type: 'string', multiple: true, default: [] },
      write: { type: 'boolean', default: false },
      'include-bespoke': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });
  if (values.help || !values['workspace-root']) {
    console.log(usage());
    process.exitCode = values.help ? 0 : 2;
    return;
  }

  const workspaceRoot = path.resolve(values['workspace-root']);
  const frameworkRoot = path.join(workspaceRoot, 'sdkwork-github-workflow');
  const renderer = path.join(frameworkRoot, RENDERER);
  if (!fs.existsSync(renderer)) {
    throw new Error(`framework renderer not found: ${renderer}`);
  }

  const audit = auditWorkspace(workspaceRoot);
  const selected = values.repo.length > 0
    ? audit.filter((entry) => values.repo.includes(entry.repository))
    : audit;
  const plan = [];
  for (const entry of selected) {
    const root = path.join(workspaceRoot, entry.repository);
    const decision = planRepository(root, entry, { includeBespoke: values['include-bespoke'] });
    if (decision.action !== 'align') {
      plan.push({ repository: entry.repository, role: entry.role, ...decision, remaining: entry.issues.length });
      continue;
    }
    const args = [renderer, '--root', root];
    if (decision.verifyOnly) args.push('--verify-only');
    if (Array.isArray(decision.scripts) && decision.scripts.length > 0) args.push('--scripts', decision.scripts.join(','));
    let result;
    try {
      const output = values.write
        ? execFileSync(process.execPath, [...args, '--write'], { encoding: 'utf8' })
        : execFileSync(process.execPath, [...args, '--plan'], { encoding: 'utf8' });
      result = { ok: true, changed: (output.match(/rendered |differs /gu) ?? []).length };
    } catch (error) {
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      result = { ok: false, detail: output.trim().split(/\r?\n/u).slice(-1)[0] ?? String(error.message) };
    }
    plan.push({
      repository: entry.repository,
      role: entry.role,
      action: result.ok ? 'align' : 'manual',
      changed: result.changed ?? 0,
      reason: result.ok ? undefined : result.detail,
      remaining: entry.issues.length,
    });
    if (result.ok && decision.removePackage) {
      const packagePath = path.join(root, '.github', 'workflows', 'package.yml');
      if (values.write) {
        fs.rmSync(packagePath);
        console.log(`${'remove'.padEnd(6)} ${entry.repository.padEnd(26)} ${entry.role.padEnd(16)} .github/workflows/package.yml (no package target declared)`);
      } else {
        console.log(`${'remove'.padEnd(6)} ${entry.repository.padEnd(26)} ${entry.role.padEnd(16)} .github/workflows/package.yml (dry run)`);
      }
    }
  }

  if (values.json) {
    console.log(JSON.stringify({
      write: values.write,
      plan,
      alignable: plan.filter((entry) => entry.action === 'align').length,
      manual: plan.filter((entry) => entry.action === 'manual').length,
      skipped: plan.filter((entry) => entry.action === 'skip').length,
    }, null, 2));
  } else {
    for (const entry of plan) {
      const detail = entry.action === 'align'
        ? `${entry.changed} file(s) ${values.write ? 'rendered' : 'to render'}`
        : entry.reason ?? '';
      console.log(`${entry.action.padEnd(6)} ${entry.repository.padEnd(26)} ${entry.role.padEnd(16)} ${detail}`);
    }
    console.log(`\n${plan.filter((entry) => entry.action === 'align').length} alignable, ${plan.filter((entry) => entry.action === 'manual').length} manual, ${plan.filter((entry) => entry.action === 'skip').length} skipped${values.write ? ' (written)' : ' (dry run; pass --write)'}`);
  }
  process.exitCode = 0;
}

try {
  main();
} catch (error) {
  console.error(`[align-github-workflows] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
