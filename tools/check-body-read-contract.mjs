#!/usr/bin/env node
/**
 * Enforce the non-destructive body observation contract in Rust sources.
 *
 * Authority: WEB_FRAMEWORK_SPEC.md section 11.1 (Non-Destructive Body
 * Observation), WEB_FRAMEWORK_STANDARD.md section 10.1.
 *
 * A request or streamed response body can be polled to completion exactly once,
 * so an observing stage must either replay the exact bytes or leave the body
 * untouched. Substituting an empty body for a message that was never (or
 * partially) captured is the shape that turned the 2026-11-25 relay outage into
 * `request body is empty` for every payload above the capture budget.
 *
 * Rules:
 *   empty-rebuild   `from_parts(parts, Body::empty())`  - rebuilt message with an
 *                   empty body; only legitimate for a drained body whose bytes are
 *                   handed on, a deliberate drain-and-discard, or a bodiless
 *                   response (101).
 *   empty-fallback  `unwrap_or_else(Body::empty)`       - an optional capture
 *                   degraded into an empty body.
 *   read-then-empty `Body::empty()` shortly after a `to_bytes` / `collect` on
 *                   the same body.
 *
 * Allowlisted sites live in ALLOWED_SITES with the reason that makes them safe;
 * every allowlist entry must still match one real site, so a stale allowance is
 * reported instead of silently hiding a new violation.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  'target-win',
  'target-rust-tests',
  'external',
  'vendor',
  'dist',
  'coverage',
]);

const SKIP_PATH_SEGMENTS = ['/tests/', '/benches/', '/examples/'];

const RULES = [
  {
    id: 'empty-rebuild',
    pattern: /from_parts\(\s*parts\s*,\s*(?:axum::body::)?Body::empty\(\)\s*\)/u,
    hint: 'rebuild the message from the bytes you read, or do not read it',
  },
  {
    id: 'empty-fallback',
    pattern: /unwrap_or_else\(\s*(?:axum::body::)?Body::empty\s*\)/u,
    hint: 'an optional capture must fall back to passing the body through, never to an empty body',
  },
  {
    id: 'read-then-empty',
    pattern: /(?:axum::body::)?Body::empty\(\)/u,
    hint: 'a read that failed (or was skipped) must surface explicitly, not as an empty body',
    afterReadWindow: 6,
  },
];

const READ_PATTERN = /(?:axum::body::)?to_bytes\(|BodyExt::collect|\.collect\(\)\s*\.await|into_data_stream\(\)/u;

/**
 * Sites that legitimately produce an empty body. `contains` must appear on the
 * matched line so the entry cannot silently cover a different expression.
 */
const ALLOWED_SITES = [
  {
    repo: 'sdkwork-webserver',
    file: 'crates/sdkwork-api-webserver-standalone-gateway/src/data_plane/handler.rs',
    rule: 'empty-rebuild',
    contains: 'Ok((Request::from_parts(parts, Body::empty()), collected))',
    reason: 'the request body is drained into `collected` and those bytes are handed on',
  },
  {
    repo: 'sdkwork-webserver',
    file: 'crates/sdkwork-api-webserver-standalone-gateway/src/data_plane/handler.rs',
    rule: 'empty-rebuild',
    contains: 'Ok(Request::from_parts(parts, Body::empty()))',
    reason: 'deliberate drain-and-discard helper (the body is intentionally consumed)',
  },
  {
    repo: 'sdkwork-webserver',
    file: 'crates/sdkwork-api-webserver-standalone-gateway/src/data_plane/proxy.rs',
    rule: 'empty-rebuild',
    contains: 'Response::from_parts(parts, Body::empty())',
    reason: '101 Switching Protocols carries no body; the tunnel owns the stream',
  },
];

function usage() {
  return [
    'Usage:',
    '  node tools/check-body-read-contract.mjs [--root <repo>]',
    '  node tools/check-body-read-contract.mjs --workspace <sdkwork-space-root>',
    '',
    'Modes:',
    '  --root .        scan one repository or module',
    '  --workspace ..  scan every child sdkwork-* repository under the workspace',
    '',
    'Options:',
    '  --json          print machine-readable findings',
    '  -h, --help      show this help',
  ].join('\n');
}

function walkRustFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      walkRustFiles(full, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.rs')) {
      continue;
    }
    const normalized = full.replace(/\\/g, '/');
    if (SKIP_PATH_SEGMENTS.some((segment) => normalized.includes(segment))) {
      continue;
    }
    out.push(full);
  }
  return out;
}

/**
 * Skips inline `#[cfg(test)] mod tests { ... }` blocks: fixture code is allowed
 * to build bodies by hand.
 */
function isTestModuleOpener(line) {
  return /^\s*(?:pub\s+)?mod\s+tests?\s*\{/u.test(line);
}

function stripLineComment(line) {
  const index = line.indexOf('//');
  return index === -1 ? line : line.slice(0, index);
}

function scanFile(repo, repoRoot, file) {
  const findings = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u);
  const relative = path.relative(repoRoot, file).replace(/\\/g, '/');

  let skipDepth = 0;
  let depth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const code = stripLineComment(raw);
    const opens = (code.match(/\{/gu) ?? []).length;
    const closes = (code.match(/\}/gu) ?? []).length;

    if (skipDepth > 0) {
      depth += opens - closes;
      if (depth <= skipDepth) {
        skipDepth = 0;
      }
      continue;
    }
    if (isTestModuleOpener(code)) {
      skipDepth = depth;
      depth += opens - closes;
      continue;
    }

    const trimmed = code.trim();
    if (trimmed.length > 0) {
      for (const rule of RULES) {
        if (!rule.pattern.test(trimmed)) {
          continue;
        }
        if (rule.afterReadWindow) {
          const start = Math.max(0, index - rule.afterReadWindow);
          const window = lines.slice(start, index + 1).map(stripLineComment);
          if (!window.some((line) => READ_PATTERN.test(line))) {
            continue;
          }
        }
        findings.push({
          repo,
          file: relative,
          line: index + 1,
          rule: rule.id,
          code: trimmed,
          hint: rule.hint,
        });
      }
    }
    depth += opens - closes;
  }
  return findings;
}

function allowlistKey(entry) {
  return `${entry.repo}|${entry.file}|${entry.rule}|${entry.contains}`;
}

/**
 * Applies the allowlist. `scannedRepos`, when provided, scopes the stale check to
 * the repositories actually scanned, so a single-repository run does not report
 * another repository's legitimate entries as stale.
 */
function applyAllowlist(findings, scannedRepos = null) {
  const used = new Set();
  const remaining = [];
  for (const finding of findings) {
    const match = ALLOWED_SITES.find((entry) => (
      entry.repo === finding.repo
      && entry.file === finding.file
      && entry.rule === finding.rule
      && finding.code.includes(entry.contains)
    ));
    if (match) {
      used.add(allowlistKey(match));
      continue;
    }
    remaining.push(finding);
  }
  const scoped = scannedRepos
    ? ALLOWED_SITES.filter((entry) => scannedRepos.has(entry.repo))
    : ALLOWED_SITES;
  const stale = scoped
    .filter((entry) => !used.has(allowlistKey(entry)))
    .map((entry) => ({ ...entry, stale: true }));
  return { remaining, stale };
}

function scanRepo(repoRoot) {
  const repo = path.basename(repoRoot);
  const findings = [];
  for (const file of walkRustFiles(repoRoot)) {
    findings.push(...scanFile(repo, repoRoot, file));
  }
  return findings;
}

function scanWorkspace(workspaceRoot) {
  const findings = [];
  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) {
      continue;
    }
    findings.push(...scanRepo(path.join(workspaceRoot, entry.name)));
  }
  return findings;
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      workspace: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const findings = values.workspace
    ? scanWorkspace(path.resolve(values.workspace))
    : scanRepo(path.resolve(values.root ?? SPECS_ROOT));
  const scannedRepos = new Set(findings.map((finding) => finding.repo));
  if (values.workspace) {
    // A repository that contributes no findings must still own its stale check.
    for (const entry of fs.readdirSync(path.resolve(values.workspace), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('sdkwork-')) {
        scannedRepos.add(entry.name);
      }
    }
  }
  const { remaining, stale } = applyAllowlist(findings, scannedRepos);

  if (values.json) {
    console.log(JSON.stringify({ violations: remaining, staleAllowlist: stale }, null, 2));
  } else if (remaining.length === 0 && stale.length === 0) {
    console.log(`body read contract check passed (${findings.length} allowlisted sites)`);
  } else {
    if (remaining.length > 0) {
      console.error(`body read contract violations (WEB_FRAMEWORK_SPEC §11.1): ${remaining.length}`);
      for (const finding of remaining.slice(0, 200)) {
        console.error(`- ${finding.repo}/${finding.file}:${finding.line} [${finding.rule}] ${finding.code}`);
        console.error(`  ${finding.hint}`);
      }
    }
    for (const entry of stale) {
      console.error(`- stale allowlist entry: ${entry.repo}/${entry.file} [${entry.rule}] (${entry.reason})`);
    }
  }

  process.exit(remaining.length === 0 && stale.length === 0 ? 0 : 1);
}

export { ALLOWED_SITES, RULES, applyAllowlist, scanFile, scanRepo, scanWorkspace };

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
