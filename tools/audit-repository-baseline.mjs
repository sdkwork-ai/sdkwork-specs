#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = { root: process.cwd(), only: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) {
      args.root = resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--only' && argv[i + 1]) {
      // Repeatable, and comma-separated so a repository can adopt a single rule (for example
      // tracked-compiler-emit) without having to satisfy the whole L1 baseline first.
      args.only.push(...argv[i + 1].split(',').map((name) => name.trim()).filter(Boolean));
      i += 1;
    }
  }
  return args;
}

function checkGitBranch(root) {
  try {
    const branch = execSync('git branch --show-current', { cwd: root, encoding: 'utf8' }).trim();
    return { ok: branch === 'main', detail: branch || 'detached' };
  } catch {
    return { ok: false, detail: 'not a git repository' };
  }
}

function checkFile(root, rel) {
  return existsSync(join(root, rel));
}

function checkForbiddenTracked(root) {
  try {
    const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const forbidden = files.filter((file) =>
      /(^|\/)node_modules\//.test(file)
      || /(^|\/)target\//.test(file)
      || /(^|\/)dist\//.test(file)
      || /(^|\/)\.env$/.test(file),
    );
    return { ok: forbidden.length === 0, detail: forbidden.slice(0, 5) };
  } catch {
    return { ok: true, detail: [] };
  }
}

/**
 * Compiler emit must never be tracked beside its source (REPOSITORY_BASELINE_SPEC section 2):
 * tsc run without --noEmit or an outDir drops .js/.d.ts next to every .ts input, and those stale
 * copies shadow the source for bundlers and for tsc itself.
 *
 * Authored ambient declarations (`vite-env.d.ts`) are not flagged: they have no same-named .ts
 * sibling, which is exactly what makes them authored rather than emitted.
 */
function checkTrackedCompilerEmit(root) {
  try {
    const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const offenders = [];
    for (const file of files) {
      if (!/\.(?:js|js\.map|d\.ts|d\.ts\.map)$/.test(file)) {
        continue;
      }
      const directory = join(root, dirname(file));
      const stem = basename(file).replace(/\.d\.ts\.map$/, '').replace(/\.js\.map$/, '')
        .replace(/\.d\.ts$/, '').replace(/\.js$/, '');
      const hasSibling = ['ts', 'tsx'].some((ext) => existsSync(join(directory, `${stem}.${ext}`)));
      if (hasSibling) {
        offenders.push(file);
      }
    }
    return { ok: offenders.length === 0, detail: offenders.slice(0, 5) };
  } catch {
    return { ok: true, detail: [] };
  }
}

function main(argv = process.argv.slice(2)) {
  const { root, only } = parseArgs(argv);
  const allChecks = [
    ['branch-main', checkGitBranch(root)],
    ['agents', { ok: checkFile(root, 'AGENTS.md'), detail: 'AGENTS.md' }],
    ['claude-shim', { ok: checkFile(root, 'CLAUDE.md'), detail: 'CLAUDE.md' }],
    ['gemini-shim', { ok: checkFile(root, 'GEMINI.md'), detail: 'GEMINI.md' }],
    ['codex-shim', { ok: checkFile(root, 'CODEX.md'), detail: 'CODEX.md' }],
    ['gitignore', { ok: checkFile(root, '.gitignore'), detail: '.gitignore' }],
    ['sdkwork-readme', { ok: checkFile(root, '.sdkwork/README.md'), detail: '.sdkwork/README.md' }],
    ['sdkwork-skills', { ok: checkFile(root, '.sdkwork/skills/README.md'), detail: '.sdkwork/skills/README.md' }],
    ['sdkwork-plugins', { ok: checkFile(root, '.sdkwork/plugins/README.md'), detail: '.sdkwork/plugins/README.md' }],
    ['sdkwork-gitignore', { ok: checkFile(root, '.sdkwork/.gitignore'), detail: '.sdkwork/.gitignore' }],
    ['forbidden-tracked', checkForbiddenTracked(root)],
    ['tracked-compiler-emit', checkTrackedCompilerEmit(root)],
  ];

  const checks = only.length > 0
    ? allChecks.filter(([name]) => only.includes(name))
    : allChecks;
  const unknown = only.filter((name) => !allChecks.some(([checkName]) => checkName === name));
  if (unknown.length > 0) {
    console.error(
      `audit-repository-baseline: unknown --only value(s): ${unknown.join(', ')}; `
      + `known checks: ${allChecks.map(([name]) => name).join(', ')}`,
    );
    return 2;
  }

  const failures = checks.filter(([, result]) => !result.ok);
  const lines = [`Repository baseline audit: ${root}`];
  for (const [name, result] of checks) {
    lines.push(`${result.ok ? 'PASS' : 'FAIL'} ${name}${result.detail ? ` (${JSON.stringify(result.detail)})` : ''}`);
  }

  console.log(lines.join('\n'));
  return failures.length === 0 ? 0 : 1;
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (import.meta.url === entryUrl) {
  process.exitCode = main();
}

export { main };
