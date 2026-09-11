#!/usr/bin/env node
// check-destructive-operation-patterns.mjs
//
// Read-only audit for pattern-driven deletion and recursive version-control
// deletion in SDKWork operator scripts. Authority: DESTRUCTIVE_OPERATION_SPEC.md.
//
// Scope is deliberately narrow so that a hit is actionable rather than noise:
//
//   - shell / PowerShell / cmd scripts under bin/, scripts/, tools/,
//     deployments/, docker/
//   - .github/workflows/*.yml|yaml run steps
//   - package.json "scripts" values
//
// Files whose name marks them as tests, and any file that already carries the
// SDKWORK-DESTRUCTIVE-OPERATION-STANDARD managed block, are skipped. Clean
// artifact removal by literal exact path (for example `rm -rf "$PKG/dist"`,
// where the target has no wildcard) is NOT reported: the checker detects
// pattern-driven deletion, not variable-trust questions that no static scan can
// answer. Positional parameters (`$1`, `$@`, `$*`) remain reported because they
// are unvalidated by construction.
//
// Usage:
//   node check-destructive-operation-patterns.mjs --workspace E:/sdkwork-space
//   node check-destructive-operation-patterns.mjs --root E:/sdkwork-space/sdkwork-order
//   node check-destructive-operation-patterns.mjs --workspace E:/sdkwork-space --json
//
// Exit codes: 0 = no violations, 1 = one or more violations found.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index < 0) return fallback;
  const hit = args[index];
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const next = args[index + 1];
  return next && !next.startsWith('--') ? next : fallback;
};

const WORKSPACE = getArg('workspace', 'E:/sdkwork-space');
const ROOT = getArg('root', null);
const AS_JSON = args.includes('--json');

const EXCLUDED_SEGMENTS = new Set([
  '.agents',
  '.cache',
  '.git',
  '.next',
  '.pnpm',
  '.turbo',
  '__fixtures__',
  '__tests__',
  'artifacts',
  'coverage',
  'dist',
  'external',
  'fixture',
  'fixtures',
  'gen',
  'generated',
  'node_modules',
  'out',
  'snapshots',
  'target',
  'test',
  'test-data',
  'testdata',
  'tests',
  'third-party',
  'third_party',
  'upstream',
  'vendor',
]);

const SCAN_DIRS = ['bin', 'scripts', 'tools', 'deployments', 'docker'];
const SHELL_EXT = new Set(['.sh', '.bash', '.ps1', '.cmd', '.bat']);
const SELF_EXEMPT_MARKER = 'SDKWORK-DESTRUCTIVE-OPERATION-STANDARD';

// A wildcard, glob class, or brace-expansion list in an argument position.
const GLOB = /(^|\s)\*|[*?]\s*$|\{[^}]*,[^}]*\}/;
// Positional or all-arguments shell parameter, unvalidated by construction.
const POSITIONAL = /\$(?:[1-9]|@|\*|\{[1-9]|[@*]\})/;
// `rm` used as a command token, not as part of `--rm`, `docker … rm`, or a word.
const RM_CMD = /(?:^|[;&|()]|&&|\|\||\bthen\b|\bdo\b|\belse\b|\s)rm\s/;

function rmTargets(line) {
  const idx = line.search(RM_CMD);
  if (idx < 0) return null;
  const after = line.slice(idx).replace(RM_CMD, 'rm ');
  const m = after.match(/^rm\s+((?:-[A-Za-z]+\s+)*)([\s\S]*)$/);
  if (!m) return null;
  return m[2];
}

function isDeletionLine(line) {
  const targets = rmTargets(line);
  if (targets === null) return false;
  return GLOB.test(targets) || POSITIONAL.test(targets);
}

const RULES = [
  {
    id: 'git-rm-recursive',
    label: 'recursive git rm (forbidden in every SDKWork script)',
    test: (line) => /(^|[;&|(]|\s)git\s+rm\b/.test(line) && /(^|\s)-[A-Za-z]*r[A-Za-z]*(\s|$)|--recursive/.test(line),
  },
  {
    id: 'git-rm-directory-or-glob',
    label: 'git rm over a directory, glob, or repository root',
    test: (line) => /(^|[;&|(]|\s)git\s+rm\b/.test(line) && /(\s\.(\s|$))|(\s\S*\*)|(\s\S*\?)|(\s--\s)/.test(line),
  },
  {
    id: 'git-clean-force',
    label: 'git clean with force',
    test: (line) => /(^|[;&|(]|\s)git\s+clean\b/.test(line) && /(^|\s)-[A-Za-z]*f/.test(line),
  },
  {
    id: 'rm-pattern',
    label: 'rm with a wildcard, glob, brace expansion, or positional parameter',
    test: isDeletionLine,
  },
  {
    id: 'find-delete',
    label: 'find-driven deletion',
    test: (line) => /(^|[;&|(]|\s)find\s/.test(line) && /(-delete\b|-exec(?:dir)?\s+rm\b)/.test(line),
  },
  {
    id: 'xargs-rm',
    label: 'xargs-driven deletion',
    test: (line) => /\bxargs\b/.test(line) && /(^|[;&|(]|\s)rm\s/.test(line),
  },
  {
    id: 'cmd-recursive-delete',
    label: 'cmd.exe recursive delete',
    test: (line) => /(^|\s)(del|erase)\s+\/[A-Za-z]*[SQ]/i.test(line) || /(^|\s)(rd|rmdir)\s+\/[A-Za-z]*S/i.test(line),
  },
  {
    id: 'powershell-recursive-glob',
    label: 'PowerShell recursive remove over a glob or repository root',
    test: (line) =>
      /\bRemove-Item\b/i.test(line) && /-(Recurse|Force)/i.test(line) && /(\s\*|\s\.\s*$|\[A-Za-z]*\*)/.test(line),
  },
  {
    id: 'rimraf-glob',
    label: 'rimraf over a glob or repository root',
    test: (line) => /(^|[;&|(]|\s)rimraf\s/.test(line) && /(\s\*|\s\.\s*$)/.test(line),
  },
  {
    id: 'shutil-rmtree-dynamic',
    label: 'shutil.rmtree over a glob, positional, or parent-relative path',
    test: (line) => /shutil\.rmtree\s*\(/.test(line) && /(\*|\.\.\/|\bsys\.argv)/.test(line),
  },
];

function toPosix(value) {
  return value.split(sep).join('/');
}

function isTestFile(name) {
  const lower = name.toLowerCase();
  return /\.(test|spec)\./.test(lower) || lower.includes('-test.') || lower.startsWith('test-') || lower === 'tests.sh';
}

function repoRoots() {
  if (ROOT) return [ROOT.replace(/\\/g, '/')];
  const out = [];
  for (const e of readdirSync(WORKSPACE, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith('sdkwork-')) continue;
    const repo = join(WORKSPACE, e.name);
    if (existsSync(join(repo, '.git')) || existsSync(join(repo, 'AGENTS.md'))) out.push(repo);
  }
  return out.sort();
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (EXCLUDED_SEGMENTS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!e.isFile()) continue;
    if (isTestFile(e.name)) continue;
    const ext = extname(e.name).toLowerCase();
    if (!SHELL_EXT.has(ext)) continue;
    if (e.name === 'package.json') continue;
    out.push(full);
  }
}

function stripComment(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
  return line;
}

function scanLines(file, text, startLine = 1) {
  if (text.includes(SELF_EXEMPT_MARKER)) return [];
  const hits = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripComment(lines[i]);
    if (!line.trim()) continue;
    for (const rule of RULES) {
      if (rule.test(line)) {
        hits.push({
          file,
          line: i + startLine,
          rule: rule.id,
          label: rule.label,
          text: line.trim().slice(0, 200),
        });
        break;
      }
    }
  }
  return hits;
}

// Inline `run:` blocks in GitHub workflow YAML.
function scanWorkflow(file, text) {
  if (text.includes(SELF_EXEMPT_MARKER)) return [];
  const hits = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const m = raw.match(/^\s*(?:-\s*)?(?:run|shell)\s*:\s*(.*)$/);
    if (!m) continue;
    const inline = m[1];
    if (!inline || inline === '|' || inline === '>' || inline === '|-' || inline === '>-') continue;
    for (const rule of RULES) {
      if (rule.test(inline)) {
        hits.push({ file, line: i + 1, rule: rule.id, label: rule.label, text: inline.trim().slice(0, 200) });
        break;
      }
    }
  }
  return hits;
}

function scanPackageJson(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const scripts = parsed && typeof parsed.scripts === 'object' ? parsed.scripts : {};
  const hits = [];
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') continue;
    for (const rule of RULES) {
      if (rule.test(value)) {
        hits.push({
          file: `${file}#scripts.${name}`,
          line: 0,
          rule: rule.id,
          label: rule.label,
          text: value.slice(0, 200),
        });
        break;
      }
    }
  }
  return hits;
}

const repos = repoRoots();
const scanned = { files: 0, repos: 0 };
const hits = [];

for (const repo of repos) {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const full = join(repo, dir);
    if (existsSync(full) && statSync(full).isDirectory()) walk(full, files);
  }
  const workflows = join(repo, '.github', 'workflows');
  let wfFiles = [];
  if (existsSync(workflows)) walk(workflows, wfFiles);
  for (const f of wfFiles) {
    const ext = extname(f).toLowerCase();
    if (ext === '.yml' || ext === '.yaml') files.push(f);
  }
  const pkg = join(repo, 'package.json');
  if (existsSync(pkg)) files.push(pkg);

  if (!files.length) continue;
  scanned.repos += 1;

  for (const file of files) {
    scanned.files += 1;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (file.endsWith('package.json')) {
      hits.push(...scanPackageJson(file));
      continue;
    }
    const ext = extname(file).toLowerCase();
    if (ext === '.yml' || ext === '.yaml') {
      hits.push(...scanWorkflow(file, text));
      continue;
    }
    hits.push(...scanLines(file, text));
  }
}

const rel = (p) => toPosix(relative(WORKSPACE, p));

if (AS_JSON) {
  console.log(
    JSON.stringify(
      { scanned, violationCount: hits.length, violations: hits.map((h) => ({ ...h, file: rel(h.file) })) },
      null,
      2,
    ),
  );
} else {
  console.log(`scanned repos : ${scanned.repos}`);
  console.log(`scanned files : ${scanned.files}`);
  console.log(`violations    : ${hits.length}`);
  for (const h of hits) {
    console.log(`  ${rel(h.file)}${h.line ? `:${h.line}` : ''}  [${h.rule}] ${h.label}`);
    console.log(`      ${h.text}`);
  }
}

process.exit(hits.length > 0 ? 1 : 0);
