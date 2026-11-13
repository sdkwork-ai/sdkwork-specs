#!/usr/bin/env node
/**
 * AUTHORIZATION_STATE_SPEC.md section 3.5 enforcement: every permission
 * enforcement point must evaluate grants with the shared wildcard-aware
 * matcher, not literal string equality.
 *
 * Scans sibling SDKWork Rust repositories for authorization predicates on
 * permission scopes and flags the ones that cannot honor `*`, `{domain}.*`, or
 * `*.{action}` grants. Test code is ignored.
 *
 * Usage: node check-permission-guard-standard.mjs --workspace <D:\sdkwork-space>
 *        [--json] [--repo <name>]...
 * Exit codes: 0 conforming, 1 violations, 2 unusable input.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: path.resolve(process.cwd(), '..') },
    repo: { type: 'string', multiple: true },
    json: { type: 'boolean', default: false },
  },
});

const workspace = path.resolve(values.workspace);
const onlyRepos = values.repo ?? null;

const MATCHER_MARKERS = [
  'permission_matches(',
  'permission_scope_matches_any(',
  'permission_code_matches(',
  'has_permission_in_scope(',
];

/**
 * Deliberate literal-scope predicates. Each entry needs a written reason and
 * the AUTHORIZATION_STATE_SPEC section that permits it. Keep this list empty
 * unless the scope set is not a permission grant (for example an API-key
 * credential scope that must stay literal by contract).
 */
const ALLOWLIST = new Map([
  [
    'sdkwork/sdkwork-aiot/crates/sdkwork-aiot-contract/src/lib.rs',
    'AiotRequestContext::has_permission is a literal membership primitive on a contract crate with zero dependencies; the AIoT route gate authorizes through sdkwork_web_core::permission_scope_matches_any (AUTHORIZATION_STATE_SPEC 3.5).',
  ],
  [
    'sdkwork/sdkwork-knowledgebase/crates/sdkwork-intelligence-knowledgebase-service/src/provider_binding.rs',
    'Provider credential rotation/revocation intentionally requires the exact knowledge.platform.manage code or the platform break-glass `*`; a domain wildcard such as knowledge.* must not reach it (least privilege, AUTHORIZATION_STATE_SPEC 3.5).',
  ],
]);

const findings = [];
const scanned = [];
const violations = [];

function listRepos() {
  return fs
    .readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => entry.name)
    .filter((name) => !onlyRepos || onlyRepos.includes(name))
    .sort();
}

function collectRustFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const name = entry.name;
      if (
        name === 'target' ||
        name === 'node_modules' ||
        name === 'generated' ||
        name === 'tests' ||
        name === 'examples' ||
        name === 'benches'
      ) {
        continue;
      }
      collectRustFiles(absolute, out);
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      out.push(absolute);
    }
  }
}

function braceBody(source, signatureIndex) {
  const open = source.indexOf('{', signatureIndex);
  if (open < 0) {
    return '';
  }
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open, index + 1);
      }
    }
  }
  return source.slice(open);
}

function hasMatcher(text) {
  return MATCHER_MARKERS.some((marker) => text.includes(marker));
}

function relative(repo, absolute) {
  return `sdkwork/${repo}/${path.relative(path.join(workspace, repo), absolute).split(path.sep).join('/')}`;
}

for (const repo of listRepos()) {
  const repoRoot = path.join(workspace, repo);
  const files = [];
  for (const crateDir of ['crates', 'services', 'packages']) {
    collectRustFiles(path.join(repoRoot, crateDir), files);
  }
  for (const andFile of files) {
    const source = fs.readFileSync(andFile, 'utf8');
    scanned.push(relative(repo, andFile));

    // 1. Declared permission predicates: fn has_permission(...) { ... }
    const signature = /fn\s+has_permission\s*\(/.exec(source);
    if (signature) {
      const body = braceBody(source, signature.index);
      const line = source.slice(0, signature.index).split('\n').length;
      if (!hasMatcher(body)) {
        findings.push({
          file: relative(repo, andFile),
          line,
          kind: 'has_permission-without-shared-matcher',
          message:
            'has_permission body compares permission codes literally; wildcard grants (*, domain.*, *.action) are denied (AUTHORIZATION_STATE_SPEC 3.5)',
        });
      }
    }

    // 2. Inline scope predicates: permission_scope.iter().any(|...| scope == ...)
    const inlinePattern = /permission_scope\s*\.\s*iter\s*\(\s*\)\s*\.\s*any\s*\(/g;
    for (const match of source.matchAll(inlinePattern)) {
      const window = source.slice(match.index, match.index + 400);
      const line = source.slice(0, match.index).split('\n').length;
      if (hasMatcher(window)) {
        continue;
      }
      if (/==\s*[A-Z_a-z0-9"]|permission\s*==|scope\s*==|needle/.test(window)) {
        findings.push({
          file: relative(repo, andFile),
          line,
          kind: 'literal-scope-predicate',
          message:
            'permission_scope predicate compares codes literally; use the shared wildcard matcher (AUTHORIZATION_STATE_SPEC 3.5)',
        });
      }
    }

    // 3. Vec<String> scope membership checks: permission_scope.contains("x")
    const containsPattern = /permission_scope\s*\.\s*contains\s*\(\s*"/g;
    for (const match of source.matchAll(containsPattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      findings.push({
        file: relative(repo, andFile),
        line,
        kind: 'scope-contains-literal',
        message:
          'permission_scope.contains(<literal>) cannot honor wildcard grants (AUTHORIZATION_STATE_SPEC 3.5)',
      });
    }

    // 4. Route-manifest generators must propagate auth.permission.
    if (path.basename(andFile) === 'build.rs' && source.includes('struct RouteManifestAuth')) {
      if (!source.includes('with_required_permission')) {
        const line = source.split('\n').findIndex((text) => text.includes('struct RouteManifestAuth')) + 1;
        findings.push({
          file: relative(repo, andFile),
          line,
          kind: 'route-manifest-permission-dropped',
          message:
            'route generator deserializes auth.mode but never emits with_required_permission, so declared permissions are not enforced (AUTHORIZATION_STATE_SPEC 3.9)',
        });
      }
    }
  }
}

for (const finding of findings) {
  const allowReason = ALLOWLIST.get(finding.file);
  if (allowReason) {
    finding.allowed = allowReason;
  } else {
    violations.push(finding);
  }
}

if (values.json) {
  process.stdout.write(
    `${JSON.stringify({ ok: violations.length === 0, scanned: scanned.length, violations, allowed: findings.filter((item) => item.allowed) }, null, 2)}\n`,
  );
} else {
  process.stdout.write(`scanned ${scanned.length} Rust files across ${listRepos().length} repositories\n`);
  for (const item of findings.filter((finding) => finding.allowed)) {
    process.stdout.write(`ok   ${item.file}:${item.line} allowlisted\n`);
  }
  for (const item of violations) {
    process.stderr.write(`FAIL ${item.file}:${item.line} [${item.kind}] ${item.message}\n`);
  }
  process.stdout.write(
    `${violations.length === 0 ? 'check-permission-guard-standard: passed' : `check-permission-guard-standard: ${violations.length} violation(s)`}\n`,
  );
}

process.exit(violations.length === 0 ? 0 : 1);
