#!/usr/bin/env node

/**
 * Validate every `SDKWORK_ACCESS_TOKEN` value found in workspace env/config files.
 *
 * The public application token is a deterministic JWT compact value:
 * header `alg:none`, `kid:public-app-token`; claims `token_class:application`,
 * `token_type:access`, `iss:sdkwork-iam-public`; signature segment `public`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const EXPECTED_HEADER = 'eyJhbGciOiJub25lIiwia2lkIjoicHVibGljLWFwcC10b2tlbiIsInR5cCI6IkpXVCJ9';
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', 'build', '.next', '.turbo']);
const TOKEN_PATTERN = /\b([A-Z][A-Z0-9_]*(?:_AUTH|_ACCESS)_TOKEN)\s*[:=]\s*["']?([A-Za-z0-9._-]+)/gu;

function parseArgs(argv) {
  const options = { workspace: process.cwd(), check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check') {
      options.check = true;
      continue;
    }
    if (token === '--workspace') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) {
        throw new Error('--workspace requires a value.');
      }
      options.workspace = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported token-file validator option: ${token}`);
  }
  return options;
}

function decodeClaims(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function validateAccessTokenFiles(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const files = [];
  const unique = new Map();
  const walk = (dir, depth) => {
    if (depth > 6) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }
      const relative = path.relative(root, fullPath).replaceAll('\\', '/');
      const isDotenv = entry.name.startsWith('.env') || entry.name.endsWith('.env');
      const isProfileJson = entry.name.endsWith('.json')
        && /\/(?:env|config)\//u.test(relative);
      if (!isDotenv && !isProfileJson) {
        continue;
      }
      if (entry.name.includes('.example') || entry.name.endsWith('.local.env')) {
        continue;
      }
      let text;
      try {
        text = readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }
      for (const match of text.matchAll(TOKEN_PATTERN)) {
        const key = match[1];
        const token = match[2];
        if (unique.has(token)) {
          continue;
        }
        const claims = decodeClaims(token);
        const issues = [];
        const isPublicToken = token.startsWith(`${EXPECTED_HEADER}.`) && token.endsWith('.public');
        if (!isPublicToken) {
          issues.push(`non-public-token:${key}`);
        } else {
          if (!claims) {
            issues.push('unparseable claims');
          } else {
            if (claims.token_class !== 'application') issues.push('token_class');
            if (claims.token_type !== 'access') issues.push('token_type');
            if (claims.iss !== 'sdkwork-iam-public') issues.push('iss');
            if (!String(claims.app_id ?? '').trim()) issues.push('app_id');
            if (!String(claims.environment ?? '').trim()) issues.push('environment');
            if (!String(claims.deployment_profile ?? '').trim()) issues.push('deployment_profile');
            if (!String(claims.runtime_target ?? '').trim()) issues.push('runtime_target');
          }
        }
        unique.set(token, { file: relative, key, claims, issues });
        files.push({ file: relative, key, token, claims, issues });
      }
    }
  };
  walk(root, 0);
  const invalid = [...unique.values()].filter((entry) => entry.issues.length > 0);
  return { workspace: root, files, uniqueTokens: unique.size, invalid };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = validateAccessTokenFiles(options.workspace);
  console.log(`access-token file validation: ${result.uniqueTokens} unique token(s), ${result.invalid.length} invalid`);
  for (const entry of result.invalid.slice(0, 50)) {
    console.log(`  INVALID ${entry.file} :: ${entry.issues.join(',')}`);
  }
  if (options.check && result.invalid.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
