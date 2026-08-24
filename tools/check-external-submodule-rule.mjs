#!/usr/bin/env node

/**
 * check-external-submodule-rule.mjs
 *
 * Enforces the SDKWork external-content rule:
 *   - Vendored upstream content under `external/` MUST be referenced as git
 *     submodules (gitlink, mode 160000), never committed as regular files.
 *   - Every path registered in a repo's `.gitmodules` MUST be a gitlink in the
 *     current index.
 *   - The only files allowed to be tracked under `external/` are the
 *     `external/README.md` documentation marker and the documented exception
 *     `external/knowledge-engines/**` in sdkwork-knowledgebase (SDKWork-owned
 *     engine catalog metadata referenced by crates at build/test time).
 *
 * Usage:
 *   node sdkwork-specs/tools/check-external-submodule-rule.mjs --workspace <workspace-root>
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const EXTERNAL_DOC_EXCEPTIONS = new Set([
  'sdkwork-knowledgebase/external/knowledge-engines',
]);

function git(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function listWorkspaceRepos(workspaceRoot) {
  const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(workspaceRoot, e.name, '.git')))
    .map((e) => path.join(workspaceRoot, e.name));
}

function parseGitmodules(gitmodulesPath) {
  const content = fs.readFileSync(gitmodulesPath, 'utf8');
  const sections = [];
  const sectionRe = /^\s*\[submodule\s+"([^"]+)"\]\s*$/gm;
  let match;
  while ((match = sectionRe.exec(content)) !== null) {
    sections.push({ path: match[1] });
  }
  // Extract path for each section (first `path =` line after the section header).
  const lines = content.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const header = line.match(/^\s*\[submodule\s+"([^"]+)"\]\s*$/);
    if (header) {
      current = { name: header[1], path: null };
      sections.push(current);
      continue;
    }
    const pathMatch = line.match(/^\s*path\s*=\s*(.+?)\s*$/);
    if (pathMatch && current && current.path === null) {
      current.path = pathMatch[1];
    }
  }
  return sections.map((s) => s.path).filter(Boolean);
}

function collectTrackedFiles(repoRoot, prefix) {
  const result = git(repoRoot, ['ls-files', '--', prefix]);
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

export function checkExternalSubmoduleRule(workspaceRoot) {
  const violations = [];
  const repos = listWorkspaceRepos(workspaceRoot);
  const rel = (p) => path.relative(workspaceRoot, p).replace(/\\/g, '/');

  for (const repoRoot of repos) {
    const repoName = path.basename(repoRoot);
    const gitmodulesPath = path.join(repoRoot, '.gitmodules');
    const hasGitmodules = fs.existsSync(gitmodulesPath);

    // 1. Registered submodule paths must be gitlinks (mode 160000).
    if (hasGitmodules) {
      for (const subPath of parseGitmodules(gitmodulesPath)) {
        const out = git(repoRoot, ['ls-files', '-s', '--', subPath]).stdout.trim();
        const mode = out.split(/\s+/)[0] ?? '';
        if (mode !== '160000') {
          violations.push({
            repo: repoName,
            severity: 'error',
            message: `.gitmodules entry '${subPath}' is not a gitlink in the index (mode='${mode || 'missing'}')`,
          });
        }
      }
    }

    // 2. Tracked files under external/ must be README markers or documented exceptions.
    const tracked = collectTrackedFiles(repoRoot, 'external/');
    for (const file of tracked) {
      const normalized = file.replace(/\\/g, '/');
      if (normalized === 'external/README.md') continue;
      if (normalized === 'external/.gitkeep') continue;
      const isGitlink = git(repoRoot, ['ls-files', '-s', '--', normalized]).stdout
        .trim()
        .split(/\s+/)[0] === '160000';
      if (isGitlink) continue;
      const exceptionKey = `${repoName}/${normalized}`;
      const underException = [...EXTERNAL_DOC_EXCEPTIONS].some((prefix) =>
        exceptionKey === prefix || exceptionKey.startsWith(`${prefix}/`),
      );
      if (!underException) {
        violations.push({
          repo: repoName,
          severity: 'error',
          message: `tracked file '${normalized}' is committed directly under external/; vendored content must be a submodule reference`,
        });
      }
    }
  }

  return { violations, repos: repos.map(rel) };
}

function main() {
  const { values } = parseArgs({
    options: { workspace: { type: 'string' } },
  });
  const workspaceRoot = path.resolve(values.workspace ?? '.');
  if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
    console.error(`check-external-submodule-rule: not a git workspace root: ${workspaceRoot}`);
    process.exit(2);
  }
  const { violations } = checkExternalSubmoduleRule(workspaceRoot);
  for (const v of violations) {
    console.error(`[${v.severity}] ${v.repo}: ${v.message}`);
  }
  if (violations.length > 0) {
    console.error(`check-external-submodule-rule: ${violations.length} violation(s) found`);
    process.exit(1);
  }
  console.log('check-external-submodule-rule: OK (external/ content is submodule-only)');
}

main();
