#!/usr/bin/env node

/**
 * Rewrite residual deploy-layout debt across sdkwork-* repositories:
 * - configs/topology → etc/topology (text references)
 * - /etc/sdkwork/chat/chat.toml → /etc/sdkwork/im/config.toml (IM)
 * - /etc/sdkwork/router/cloudrouter.toml → /etc/sdkwork/router/config.toml
 * - ~/.sdkwork/chat/config/chat.toml → ~/.sdkwork/im/config/config.toml
 * - %ProgramData%/sdkwork/chat/chat.toml → %ProgramData%/sdkwork/im/config.toml
 * - cloudrouter.toml.example → config.toml.example (path strings)
 *
 * Does not rewrite CHANGELOG / CHECK_RESULT / generated / node_modules / .git / target / dist.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  'target',
  'dist',
  'generated',
  '.sdkwork',
  'CHECK_RESULT.md',
]);

const SKIP_FILE_NAMES = new Set([
  'CHECK_RESULT.md',
  'CHANGELOG.md',
]);

const TEXT_EXT = new Set([
  '.md',
  '.mjs',
  '.js',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.env',
  '.sh',
  '.ps1',
  '.py',
  '.rs',
  '.txt',
  '.service',
  '.example',
]);

function shouldSkipDir(name) {
  return SKIP_DIR.has(name) || name.startsWith('.');
}

function isTextFile(filePath) {
  const base = path.basename(filePath);
  if (SKIP_FILE_NAMES.has(base)) return false;
  if (base.endsWith('.md') && /CHANGELOG|CHECK_RESULT/i.test(base)) return false;
  const ext = path.extname(filePath);
  if (TEXT_EXT.has(ext)) return true;
  if (base.endsWith('.env.example') || base.endsWith('.toml.example')) return true;
  if (['Dockerfile', 'docker-compose.yml', 'AGENTS.md', 'README'].includes(base)) return true;
  return false;
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walk(path.join(dir, entry.name), files);
      continue;
    }
    const full = path.join(dir, entry.name);
    if (isTextFile(full)) files.push(full);
  }
  return files;
}

function rewriteContent(text, appId) {
  let next = text;
  const replacements = [
    [/configs\/topology/g, 'etc/topology'],
    [/configs\\\\topology/g, 'etc\\\\topology'],
  ];

  if (appId === 'sdkwork-im') {
    replacements.push(
      [/\/etc\/sdkwork\/chat\/chat\.toml/g, '/etc/sdkwork/im/config.toml'],
      [/\/etc\/sdkwork\/chat\//g, '/etc/sdkwork/im/'],
      [/~\/\.sdkwork\/chat\/config\/chat\.toml/g, '~/.sdkwork/im/config/config.toml'],
      [/~\/\.sdkwork\/chat\//g, '~/.sdkwork/im/'],
      [/%ProgramData%\/sdkwork\/chat\/chat\.toml/g, '%ProgramData%/sdkwork/im/config.toml'],
      [/%ProgramData%\\\\sdkwork\\\\chat\\\\chat\.toml/g, '%ProgramData%\\\\sdkwork\\\\im\\\\config.toml'],
      [/%ProgramData%\/sdkwork\/chat\//g, '%ProgramData%/sdkwork/im/'],
      [/\/Library\/Application Support\/sdkwork\/chat\/chat\.toml/g, '/Library/Application Support/sdkwork/im/config.toml'],
      [/\/Library\/Application Support\/sdkwork\/chat\//g, '/Library/Application Support/sdkwork/im/'],
      [/config\/chat\.toml\.example/g, 'config/config.toml.example'],
      [/deployments\/templates\/chat\.toml\.example/g, 'deployments/templates/config.toml.example'],
      [/chat\.toml\.example/g, 'config.toml.example'],
      // Keep explicit runtime file name references after directory migration.
      [/(?<![A-Za-z0-9_-])chat\.toml(?!\.example)/g, 'config.toml'],
    );
  }

  if (appId === 'sdkwork-cloudrouter') {
    replacements.push(
      [/\/etc\/sdkwork\/router\/cloudrouter\.toml/g, '/etc/sdkwork/router/config.toml'],
      [/~\/\.sdkwork\/router\/config\/cloudrouter\.toml/g, '~/.sdkwork/router/config/config.toml'],
      [/%ProgramData%\/sdkwork\/router\/cloudrouter\.toml/g, '%ProgramData%/sdkwork/router/config.toml'],
      [/%ProgramData%\\\\sdkwork\\\\router\\\\cloudrouter\.toml/g, '%ProgramData%\\\\sdkwork\\\\router\\\\config.toml'],
      [/\/Library\/Application Support\/sdkwork\/router\/cloudrouter\.toml/g, '/Library/Application Support/sdkwork/router/config.toml'],
      [/config\/cloudrouter\.toml\.example/g, 'config/config.toml.example'],
      [/docker\/config\/cloudrouter\.toml/g, 'docker/config/config.toml'],
      [/cloudrouter\.toml\.example/g, 'config.toml.example'],
      [/(?<![A-Za-z0-9_-])cloudrouter\.toml(?!\.example)/g, 'config.toml'],
    );
  }

  for (const [pattern, value] of replacements) {
    next = next.replace(pattern, value);
  }
  return next;
}

function renameKnownFiles(repoRoot, appId, dryRun) {
  const renames = [];
  const pairs = [];
  if (appId === 'sdkwork-im') {
    pairs.push(
      ['deployments/templates/chat.toml.example', 'deployments/templates/config.toml.example'],
    );
  }
  if (appId === 'sdkwork-cloudrouter') {
    pairs.push(
      ['docker/config/cloudrouter.toml', 'docker/config/config.toml'],
      ['config/cloudrouter.toml.example', 'config/config.toml.example'],
    );
  }
  for (const [fromRel, toRel] of pairs) {
    const from = path.join(repoRoot, fromRel);
    const to = path.join(repoRoot, toRel);
    if (!fs.existsSync(from)) continue;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(to)) {
        fs.unlinkSync(from);
      } else {
        fs.renameSync(from, to);
      }
    }
    renames.push(`${fromRel} -> ${toRel}`);
  }
  return renames;
}

function processRepo(repoRoot, dryRun) {
  const appId = path.basename(repoRoot);
  const changed = [];
  const renames = renameKnownFiles(repoRoot, appId, dryRun);
  changed.push(...renames.map((item) => `rename:${item}`));

  for (const file of walk(repoRoot)) {
    let original;
    try {
      original = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const next = rewriteContent(original, appId);
    if (next === original) continue;
    if (!dryRun) fs.writeFileSync(file, next, 'utf8');
    changed.push(`rewrite:${path.relative(repoRoot, file).replace(/\\/g, '/')}`);
  }
  return { appId, changed };
}

function listRepos(workspaceRoot) {
  return fs
    .readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((repoRoot) => {
      return (
        fs.existsSync(path.join(repoRoot, 'Cargo.toml')) ||
        fs.existsSync(path.join(repoRoot, 'agent.app.config.json'))
      );
    });
}

const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: path.resolve(process.cwd(), '..') },
    'dry-run': { type: 'boolean', default: false },
    only: { type: 'string' },
  },
});

const workspaceRoot = path.resolve(values.workspace);
const dryRun = values['dry-run'];
let repos = listRepos(workspaceRoot);
if (values.only) {
  const wanted = new Set(values.only.split(',').map((item) => item.trim()).filter(Boolean));
  repos = repos.filter((repoRoot) => wanted.has(path.basename(repoRoot)));
}

let touched = 0;
for (const repoRoot of repos) {
  const result = processRepo(repoRoot, dryRun);
  if (result.changed.length === 0) continue;
  touched += 1;
  console.log(`${dryRun ? 'would clean' : 'cleaned'} ${result.appId}: ${result.changed.length} changes`);
  for (const item of result.changed.slice(0, 12)) {
    console.log(`  - ${item}`);
  }
  if (result.changed.length > 12) {
    console.log(`  - ... ${result.changed.length - 12} more`);
  }
}

console.log(`\nclean-application-deploy-residual: ${touched} repos ${dryRun ? 'would change' : 'changed'}`);
process.exit(0);
