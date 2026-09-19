#!/usr/bin/env node

// IAM token minimal-claims gate.
//
// Enforces the IAM_SPEC.md §5/§5.2 minimal-claim contract:
//   - `data_scope` / `permission_scope` MUST NOT be signed into any token payload
//     (they are DB-authoritative and loaded from the iam_session row at request time).
//   - A signed token payload is anchored by the issuer marker
//     `"iss": "sdkwork-iam-local"`; embedding an authorization/data-access list in the
//     same `json!({...})` block inflates the JWT and risks HTTP 431 at the edge.
//   - IAM_SPEC.md MUST keep the minimal-claim and 431-budget normative statements.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.turbo', 'generated']);

const ISSUER_MARKER = '"iss": "sdkwork-iam-local"';
const FORBIDDEN_CLAIM_KEYS = ['data_scope', 'permission_scope'];

const SPEC_MINIMAL_CLAIM_MARKERS = [
  'Token payloads `MUST` be minimal, bounded',
  '`MUST NOT` be embedded',
  'are never registered claims',
  'HTTP 431',
];

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      args.root = path.resolve(argv[index + 1] ?? '');
      index += 1;
    }
  }
  return args;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function listFiles(rootDir, predicate, maxDepth = 10, depth = 0, results = []) {
  if (depth > maxDepth || !fs.existsSync(rootDir)) {
    return results;
  }
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      listFiles(fullPath, predicate, maxDepth, depth + 1, results);
    } else if (predicate(fullPath)) {
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

function scanTokenPayloads(filePath) {
  const text = readText(filePath);
  const violations = [];
  const normalizedRel = filePath.replace(/\\/g, '/');

  let searchFrom = 0;
  let markerIdx = text.indexOf(ISSUER_MARKER, searchFrom);
  const seenBlocks = new Set();
  while (markerIdx !== -1) {
    // Find the enclosing json!({...}) block by scanning backwards to the opening
    // `json!({` and forwards to the balanced closing `})`.
    const openIdx = text.lastIndexOf('json!({', markerIdx);
    let braceOpen;
    if (openIdx !== -1) {
      const openBrace = text.indexOf('{', openIdx + 'json!('.length);
      braceOpen = openBrace !== -1 ? openBrace : openIdx;
    } else {
      braceOpen = markerIdx;
    }

    let depth = 0;
    let closeIdx = -1;
    for (let i = braceOpen; i < text.length; i += 1) {
      if (text[i] === '{') {
        depth += 1;
      } else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    if (closeIdx !== -1 && !seenBlocks.has(`${openIdx}:${closeIdx}`)) {
      seenBlocks.add(`${openIdx}:${closeIdx}`);
      const block = text.slice(openIdx, closeIdx + 1);
      for (const claimKey of FORBIDDEN_CLAIM_KEYS) {
        if (block.includes(`"${claimKey}"`)) {
          violations.push(
            `${normalizedRel}: token payload embeds "${claimKey}" signed claim; scopes are DB-authoritative and MUST NOT be embedded (HTTP 431 risk)`,
          );
        }
      }
    }
    searchFrom = closeIdx !== -1 ? closeIdx + 1 : markerIdx + ISSUER_MARKER.length;
    markerIdx = text.indexOf(ISSUER_MARKER, searchFrom);
  }
  return violations;
}

export function validateIamTokenMinimalClaims(root) {
  const failures = [];

  const iamRoot = resolveCandidate(root, 'sdkwork-iam');
  const specPath =
    resolveCandidate(root, 'sdkwork-specs/IAM_SPEC.md') ??
    resolveCandidate(root, 'IAM_SPEC.md');

  if (iamRoot) {
    const rustFiles = listFiles(
      iamRoot,
      (filePath) => filePath.endsWith('.rs'),
    );
    for (const filePath of rustFiles) {
      failures.push(...scanTokenPayloads(filePath));
    }
  } else {
    failures.push('IAM source tree not found (expected sdkwork-iam or ../sdkwork-iam)');
  }

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
    iamRoot: iamRoot ? iamRoot.replace(/\\/g, '/') : null,
    specFile: specPath ? specPath.replace(/\\/g, '/') : null,
  };
  return {
    ok: failures.length === 0,
    violations: [...failures],
    summary,
  };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const result = validateIamTokenMinimalClaims(root);
  if (!result.ok) {
    console.error('IAM token minimal-claims standard failed:');
    for (const failure of result.violations) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log('IAM token minimal-claims standard ok');
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}