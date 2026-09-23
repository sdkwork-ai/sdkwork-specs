#!/usr/bin/env node

// Token minimal-claims + header-budget gate (workspace-scoped).
//
// Enforces the IAM_SPEC.md §5.2 / WEB_FRAMEWORK_SPEC.md §5.3 contract across the
// WHOLE workspace, not just sdkwork-iam:
//
//   R1 (signed-scope)  `data_scope` / `permission_scope` MUST NOT appear in a
//      token payload block. They are DB-authoritative and loaded from the
//      `iam_session` row at request time; signing them in inflates the JWT and
//      produces `HTTP 431 Request Header Fields Too Large` at the edge.
//   R2 (credential-derivation) A validator MUST NOT derive an authorization
//      decision from a credential claim. Reading `claims.get("data_scope")` /
//      `metadata.get("permission_scope")` into a principal is a fail-open shape:
//      with the claim no longer signed it silently yields an empty scope, and a
//      forged claim would silently grant scope. Scope MUST come from the
//      server-resolved port (IAM_SPEC §5.6).
//
// The DB path (`row.get("data_scope")`, `*_json` columns, `INSERT`/`UPDATE`,
// `bind(...)`) is the authoritative source and is explicitly allowed — that is
// exactly where the scope is supposed to live.
//
// An intentional compatibility fixture (a test that constructs a legacy token
// carrying scope, precisely in order to assert it is ignored) opts out with an
// explicit, greppable marker on or above the line:
//
//     // token-claims-gate: legacy-fixture
//
// Exemptions are explicit so a reviewer sees them, instead of the rule being
// weakened for everyone.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'target', 'dist', 'build', '.turbo', 'generated',
  'artifacts', 'external', 'vendor', 'coverage', '.next', 'out', '.venv',
  'venv', '__pycache__', '.pnpm-store', '.desktop-build', 'bin', 'obj', '.vite',
  // Agent/IDE workspace metadata, not a deliverable of this contract.
  '.workbuddy', '.zcode', '.idea', '.vscode',
]);

// This gate necessarily names the very patterns it forbids, so it must not
// scan itself (nor its fixture battery, which is deliberately full of positive
// controls).
const SELF_FILES = new Set([
  'check-token-minimal-claims.mjs',
  'check-token-minimal-claims.test.mjs',
]);

const SOURCE_EXTENSIONS = ['.rs', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.go', '.cs'];
const DOC_EXTENSIONS = ['.md'];

const FORBIDDEN_CLAIM_KEYS = ['data_scope', 'permission_scope'];

// Fixture and documented-exception opt-outs; both must be greppable and deliberate.
//
//   legacy-fixture            a test that signs scope precisely to assert it is IGNORED
//   credential-entry-exception the bounded bootstrap credential-entry gate scope, which
//                              APP_PERMISSION_COMPOSITION_SPEC defines as NOT user RBAC
//
// Anything else is a violation.
const EXEMPT_MARKERS = [
  'token-claims-gate: legacy-fixture',
  'token-claims-gate: credential-entry-exception',
];

// A token identity claim proves the surrounding block is a token payload.
const TOKEN_IDENTITY_MARKER = /"(iss|token_type|aud|exp|iat|sub|session_id|sid)"\s*:/u;

// DB / authoritative-store context: the place scope is SUPPOSED to live.
const STORE_CONTEXT = new RegExp(
  [
    '_json', '::jsonb', '\\bINSERT\\b', '\\bUPDATE\\b', '\\bSELECT\\b', '\\bSET\\b',
    '\\.bind\\(', '\\brow\\.get\\(', '\\bfetch_one\\b', '\\bfetch_optional\\b',
    '\\bexecute\\(', '\\bquery_as', '\\bVALUES\\b', 'migration', '\\bDDL\\b',
    'CREATE TABLE', '\\bADD COLUMN\\b',
  ].join('|'),
  'u',
);

// JS/TS bare-object claim assignment: claims.permission_scope = ... / obj["permission_scope"] = ...
const CLAIM_ASSIGNMENT = new RegExp(
  `\\b(claims|payload|tokenPayload|jwtPayload|tokenClaims)\\b\\s*(?:\\.\\s*("?)(\\w+)\\2|\\[\\s*["'](\\w+)["']\\s*\\])\\s*=(?!=)`,
  'u',
);

// R2: a validator pulling scope out of a credential.
const CREDENTIAL_DERIVATION = /(claims|metadata|credential)\s*\.\s*get\(\s*["'](data_scope|permission_scope)["']\s*\)/gu;
const CREDENTIAL_DERIVATION_JS = /\b(claims|payload|jwtPayload|tokenClaims)\s*(?:\?\.)?\s*\.\s*(data_scope|dataScope|permission_scope|permissionScope)\b/gu;

const SPEC_MINIMAL_CLAIM_MARKERS = [
  'Token payloads `MUST` be minimal, bounded',
  '`MUST NOT` be embedded',
  'are never registered claims',
  'HTTP 431',
  // Strengthened anchors added with the closed-admission rewrite.
  'Claim admission is closed by default',
  'fixed-size identity envelope',
  'Forbidden claims',
];

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      args.root = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (token === '--workspace') {
      args.root = path.resolve(argv[index + 1] ?? '');
      index += 1;
    }
  }
  return args;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function listFiles(rootDir, extensions, maxDepth = 12, depth = 0, results = []) {
  if (depth > maxDepth || !fs.existsSync(rootDir)) {
    return results;
  }
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name) || SELF_FILES.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      listFiles(fullPath, extensions, maxDepth, depth + 1, results);
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      results.push(fullPath);
    }
  }
  return results;
}

function resolveCandidate(root, childName) {
  const child = path.join(root, childName);
  if (fs.existsSync(child)) {
    return child;
  }
  const sibling = path.resolve(root, '..', childName);
  if (fs.existsSync(sibling)) {
    return sibling;
  }
  return null;
}

/**
 * Locate the enclosing `{ ... }` block (balanced) that contains `position`.
 * Returns [start, end] indices, or null when the braces are unbalanced.
 */
function enclosingBlock(text, position) {
  let open = -1;
  let depth = 0;
  for (let i = position; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === '}') {
      depth += 1;
    } else if (ch === '{') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth -= 1;
    }
  }
  if (open === -1) {
    return null;
  }
  let close = -1;
  depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  return close === -1 ? null : [open, close];
}

function lineOf(text, index) {
  let count = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') {
      count += 1;
    }
  }
  return count;
}

// How far above a flagged line the opt-out marker may sit. A fixture marker
// normally annotates a whole builder function, and the offending claims can sit
// a dozen-plus lines below it inside the same `json!({...})` block.
const EXEMPT_LOOKBACK_LINES = 20;

function isExempt(text, index) {
  const lineEnd = (() => {
    const end = text.indexOf('\n', index);
    return end === -1 ? text.length : end;
  })();
  let from = text.lastIndexOf('\n', index) + 1; // start of the flagged line
  for (let i = 0; i < EXEMPT_LOOKBACK_LINES && from > 0; i += 1) {
    // Step over the newline that terminates the previous line; stepping by one
    // would land back on the same newline and never move.
    const cursor = text.lastIndexOf('\n', from - 2);
    if (cursor < 0) {
      from = 0;
      break;
    }
    from = cursor + 1;
  }
  return EXEMPT_MARKERS.some((marker) => text.slice(from, lineEnd).includes(marker));
}

function scanSourceFile(filePath, displayPath) {
  const text = readText(filePath);
  const violations = [];

  // ---- R1: forbidden claim inside a token payload block -------------------
  for (const claimKey of FORBIDDEN_CLAIM_KEYS) {
    const needle = `"${claimKey}"`;
    let from = 0;
    for (;;) {
      const idx = text.indexOf(needle, from);
      if (idx === -1) {
        break;
      }
      from = idx + needle.length;
      if (isExempt(text, idx)) {
        continue;
      }
      const block = enclosingBlock(text, idx);
      const scope = block ? text.slice(block[0], block[1] + 1) : text.slice(Math.max(0, idx - 600), idx + 400);
      if (STORE_CONTEXT.test(scope)) {
        continue;
      }
      if (!TOKEN_IDENTITY_MARKER.test(scope)) {
        continue;
      }
      violations.push(
        `${displayPath}:${lineOf(text, idx)}: R1 token payload embeds "${claimKey}" signed claim; ` +
          'scopes are DB-authoritative and MUST NOT be embedded (HTTP 431 risk)',
      );
    }
  }

  // ---- R1b: JS/TS claim assignment ----------------------------------------
  {
    const re = new RegExp(CLAIM_ASSIGNMENT.source, 'gu');
    for (const match of text.matchAll(re)) {
      const key = match[3] ?? match[4] ?? '';
      if (!FORBIDDEN_CLAIM_KEYS.includes(key)) {
        continue;
      }
      const idx = match.index ?? 0;
      if (isExempt(text, idx)) {
        continue;
      }
      violations.push(
        `${displayPath}:${lineOf(text, idx)}: R1 token payload assignment sets "${key}"; ` +
          'scopes MUST NOT be signed into a credential (HTTP 431 risk)',
      );
    }
  }

  // ---- R2: credential-derived authorization -------------------------------
  {
    const re = new RegExp(CREDENTIAL_DERIVATION.source, 'gu');
    for (const match of text.matchAll(re)) {
      const idx = match.index ?? 0;
      if (isExempt(text, idx)) {
        continue;
      }
      violations.push(
        `[advisory] ${displayPath}:${lineOf(text, idx)}: R2 credential scope is read here; ` +
          'in production the authorization decision MUST come from the server-resolved port ' +
          '(IAM_SPEC §5.6), and `AuthorizationScopeProvider` MUST stay in its default `Deny` mode',
      );
    }
    const reJs = new RegExp(CREDENTIAL_DERIVATION_JS.source, 'gu');
    for (const match of text.matchAll(reJs)) {
      const idx = match.index ?? 0;
      if (isExempt(text, idx)) {
        continue;
      }
      // Skip assignments; those are handled by R1b.
      const tail = text.slice(idx, idx + 200);
      if (/=(?!=)/u.test(tail.slice(match[0].length))) {
        continue;
      }
      violations.push(
        `[advisory] ${displayPath}:${lineOf(text, idx)}: R2 credential scope is read here; ` +
          'in production the authorization decision MUST come from the server-resolved port ' +
          '(IAM_SPEC §5.6), and `AuthorizationScopeProvider` MUST stay in its default `Deny` mode',
      );
    }
  }

  return violations;
}

const DOC_DEBT_PATTERNS = [
  {
    // A credential carrying authorization scope, stated as fact (not as a prohibition).
    re: /(access_token|auth_token|JWT|token)[^\n]{0,60}\b(permission_scope|data_scope)\b/iu,
    why: 'documentation states that a credential carries authorization scope',
  },
  {
    re: /\bJWT\s+`?permission_scope`?\s+refreshes/iu,
    why: 'documentation states that a JWT carries permission_scope',
  },
];

const DOC_ALLOW = /(MUST NOT|must not|forbidden|never|prohibit|不再|禁止|不得|is not a substitute|not embedd|MUST be read from|server-resolved|DB-authoritative)/iu;

function scanDocFile(filePath, displayPath) {
  const lines = readText(filePath).split(/\r?\n/u);
  const violations = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (DOC_ALLOW.test(line)) {
      continue;
    }
    for (const { re, why } of DOC_DEBT_PATTERNS) {
      if (re.test(line)) {
        violations.push(
          `${displayPath}:${i + 1}: D1 ${why}: ${JSON.stringify(line.trim().slice(0, 140))}`,
        );
        break;
      }
    }
  }
  return violations;
}

export function validateTokenMinimalClaims(root) {
  const failures = [];

  const specPath =
    resolveCandidate(root, 'sdkwork-specs/IAM_SPEC.md') ?? resolveCandidate(root, 'IAM_SPEC.md');

  // ---- workspace source scan ---------------------------------------------
  let repos = [];
  try {
    repos = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
      .map((entry) => path.join(root, entry.name));
  } catch {
    failures.push(`workspace root not readable: ${root}`);
  }

  // A nested `sdkwork-specs/IAM_SPEC.md` layout means `root` is the workspace.
  const isWorkspace = repos.some((repo) => path.basename(repo) === 'sdkwork-iam');
  const scanRoot = isWorkspace ? root : path.dirname(root);

  let scannedRepos = 0;
  for (const repo of repos.length > 0 ? repos : [root]) {
    const repoName = path.basename(repo);
    if (!repoName.startsWith('sdkwork-') && repo !== root) {
      continue;
    }
    scannedRepos += 1;
    for (const file of listFiles(repo, SOURCE_EXTENSIONS)) {
      const display = `${repoName}/${path.relative(repo, file).replace(/\\/gu, '/')}`;
      failures.push(...scanSourceFile(file, display));
    }
    for (const file of listFiles(repo, DOC_EXTENSIONS)) {
      const display = `${repoName}/${path.relative(repo, file).replace(/\\/gu, '/')}`;
      failures.push(...scanDocFile(file, display));
    }
  }

  // ---- spec anchors -------------------------------------------------------
  if (specPath) {
    const specText = readText(specPath);
    for (const marker of SPEC_MINIMAL_CLAIM_MARKERS) {
      if (!specText.includes(marker)) {
        failures.push(
          `IAM_SPEC.md missing minimal-claim marker: ${JSON.stringify(marker)}`,
        );
      }
    }
  } else {
    failures.push('IAM_SPEC.md not found (expected sdkwork-specs/IAM_SPEC.md or IAM_SPEC.md)');
  }

  const summary = {
    root: root.replace(/\\/gu, '/'),
    scanRoot: scanRoot.replace(/\\/gu, '/'),
    reposScanned: scannedRepos,
    specFile: specPath ? specPath.replace(/\\/gu, '/') : null,
    advisories: failures.filter((failure) => failure.startsWith('[advisory]')).length,
    blocking: failures.filter((failure) => !failure.startsWith('[advisory]')).length,
  };
  return {
    // Advisory findings are reported but do not block: reading a credential is
    // legal at the parsing layer, and the blocking contract is that the
    // authorization decision comes from the server-resolved port. Blocking
    // findings are signed scope (R1), claim assignment (R1b), doc debt (D1),
    // and missing spec anchors.
    ok: summary.blocking === 0,
    violations: [...failures],
    summary,
  };
}

/** Backwards-compatible alias; IAM-only callers keep working. */
export function validateIamTokenMinimalClaims(root) {
  return validateTokenMinimalClaims(root);
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const result = validateTokenMinimalClaims(root);
  for (const failure of result.violations) {
    console.error(`- ${failure}`);
  }
  if (!result.ok) {
    console.error(
      `\nToken minimal-claims / header-budget standard failed: ` +
        `${result.summary.blocking} blocking violation(s)` +
        (result.summary.advisories > 0 ? `, ${result.summary.advisories} advisory item(s)` : ''),
    );
    process.exit(1);
  }
  console.log(
    `Token minimal-claims / header-budget standard ok ` +
      `(${result.summary.reposScanned} repositories scanned` +
      (result.summary.advisories > 0 ? `, ${result.summary.advisories} advisory item(s)` : '') +
      ')',
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
