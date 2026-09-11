#!/usr/bin/env node
/**
 * Root `.gitignore` MUST NOT ignore directories the standards designate as authored content.
 *
 * An over-broad ignore rule is invisible to every other gate: the content sits on disk, no check
 * reads the ignore file, and `git status` looks clean — so the canonical entrypoints simply can
 * never be committed. Measured 2026-09-11: 75 repositories ignored the root `bin/` directory while
 * 73 of them shipped the nine canonical entrypoint scripts on disk, with 69 still untracked; 9
 * repositories ignored `sdks/**\/generated/`, which the fleet deliberately commits.
 *
 * Authority:
 *  - `MODULE_BIN_SPEC.md` section 2: `bin/` is the module's only authored-script channel. The
 *    standard has no provision for ignoring it, and a fleet scan found `bin/` holds only authored
 *    sources (930 .sh, 81 .md, 24 .ps1, 14 .cmd, 6 deb/rpm `.template`, 5 .mjs) and zero binaries.
 *  - `SDK_WORKSPACE_GENERATION_SPEC.md`: committed `generated/server-openapi` output is regulated,
 *    and `AGENTS.md` defines `sdks/` as holding generated SDK artifacts.
 *  - `REPOSITORY_BASELINE_SPEC.md` section 2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listWorkspaceRepositoryRoots } from './lib/workspace-check-runner.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TOOL_DIR, '../..');

/**
 * Ignore entries that remove canonical authored content from version control.
 * `bin/`, `/bin/`, `bin/**`, and `/bin/**` are the same rule; the leading slash only anchors it.
 */
export const CANONICAL_CONTENT_IGNORE_RULES = [
  {
    id: 'bin-entrypoint-directory',
    match: /^\/?bin\/\*{0,2}$/u,
    authority: 'MODULE_BIN_SPEC.md section 2',
  },
  {
    id: 'sdks-generated-output',
    match: /^sdks\/\*\*\/generated\/\*{0,2}$/u,
    authority: 'SDK_WORKSPACE_GENERATION_SPEC.md',
  },
];

export function parseArgs(argv) {
  const args = { workspace: null, root: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--workspace') {
      args.workspace = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (token === '--root') {
      args.root = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (token === '--json') {
      args.json = true;
    }
  }
  return args;
}

/** Offending ignore entries for one repository root, in file order. */
export function findIgnoredCanonicalContent(repoRoot) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return [];
  }
  const findings = [];
  const lines = fs.readFileSync(gitignorePath, 'utf8').split(/\r?\n/u);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) {
      return;
    }
    for (const rule of CANONICAL_CONTENT_IGNORE_RULES) {
      if (rule.match.test(line)) {
        findings.push({
          rule: rule.id,
          authority: rule.authority,
          entry: line,
          line: index + 1,
        });
      }
    }
  });
  return findings;
}

export function auditRoot(repoRoot) {
  const findings = findIgnoredCanonicalContent(repoRoot);
  return { root: repoRoot, findings, ok: findings.length === 0 };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let roots;
  if (args.root) {
    if (!fs.existsSync(args.root) || !fs.statSync(args.root).isDirectory()) {
      process.stderr.write(`check-gitignore-standard: --root is not an existing directory: ${args.root}\n`);
      process.exit(2);
      return;
    }
    roots = [args.root];
  } else if (args.workspace) {
    if (!fs.existsSync(args.workspace) || !fs.statSync(args.workspace).isDirectory()) {
      process.stderr.write(`check-gitignore-standard: --workspace is not an existing directory: ${args.workspace}\n`);
      process.exit(2);
      return;
    }
    roots = listWorkspaceRepositoryRoots(args.workspace);
  } else {
    process.stderr.write('check-gitignore-standard: pass --workspace <dir> or --root <repo>\n');
    process.exit(2);
    return;
  }

  if (roots.length === 0) {
    process.stderr.write('check-gitignore-standard: resolved 0 repositories; refusing to report success\n');
    process.exit(2);
    return;
  }

  const results = roots.map((root) => auditRoot(root));
  const failing = results.filter((result) => !result.ok);
  const violations = failing.reduce((sum, result) => sum + result.findings.length, 0);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ roots: results, failing: failing.length, violations }, null, 2)}\n`);
  } else {
    for (const result of failing) {
      process.stdout.write(`FAIL  ${path.basename(result.root)}\n`);
      for (const finding of result.findings) {
        process.stdout.write(
          `        - .gitignore:${finding.line}  "${finding.entry}"  ignores canonical authored content (${finding.authority})\n`,
        );
      }
    }
    process.stdout.write(
      `  repositories: ${roots.length}   passed: ${roots.length - failing.length}   failed: ${failing.length}\n`
      + `  violations:      ${violations}\n`,
    );
    process.stdout.write(
      `check-gitignore-standard: ${roots.length} repositories, ${roots.length - failing.length} compliant, `
      + `${failing.length} ignoring canonical authored content\n`,
    );
  }

  process.exit(failing.length === 0 ? 0 : 1);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (import.meta.url === entryUrl) {
  main();
}
