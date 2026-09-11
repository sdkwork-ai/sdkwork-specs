#!/usr/bin/env node
/**
 * Validates SDKWork identity and naming terminology in standards and optional consumer roots.
 * See NAMING_SPEC.md §0 and MIGRATION_SPEC.md §8.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  forbiddenFoundationPcReactPattern,
  legacyHttpRouteCratePattern,
} from './lib/naming-patterns.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IGNORE_DIRS = new Set(['node_modules', '.git', 'artifacts']);
const SCAN_EXTENSIONS = new Set(['.md', '.json', '.mjs', '.ts', '.tsx', '.yaml', '.yml']);

const ALLOW_PATH_PARTS = new Set([
  'migrate-identity-terminology.mjs',
  'check-identity-naming.mjs',
  'check-unified-postgres-profile.mjs',
  'unify-postgres-profile.mjs',
  'naming-patterns.mjs',
]);

function usage() {
  return [
    'Usage: node tools/check-identity-naming.mjs [--root <path>] [--mode standards|consumer]',
    '',
    'standards: scan sdkwork-specs normative markdown (default when --root is specs root)',
    'consumer: scan repository packages/crates for retired naming patterns',
  ].join('\n');
}

function fail(message, details = []) {
  console.error(`identity naming failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function walk(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    // Stale renamed dependency trees (`node_modules.stale.<date>`) are dependency trees too.
    if (entry.name.startsWith('node_modules')) continue;
    const full = path.join(dir, entry.name);
    // `statSync` follows symlinks, so a dangling link — or a directory removed by a concurrent
    // build — threw ENOENT here and aborted the whole scan with an unhandled crash. Directory
    // entries are already typed by `readdirSync`, so only links need a defensive stat, and an
    // unreadable entry is skipped rather than fatal.
    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      try {
        isDirectory = fs.statSync(full).isDirectory();
      } catch {
        continue;
      }
    }
    if (isDirectory) walk(full, files);
    else files.push(full);
  }
  return files;
}

function relative(root, file) {
  return path.relative(root, file) || file;
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function isStandardsAuthority(rel) {
  return !rel.includes('/')
    && !rel.includes('\\')
    && rel.endsWith('.md')
    && !['CLAUDE.md', 'CODEX.md', 'GEMINI.md', 'MIGRATION_SPEC.md'].includes(rel);
}

function scanText(file, text, rules, root) {
  const issues = [];
  const rel = relative(root, file);
  for (const rule of rules) {
    if (rule.onlySpecs && !isStandardsAuthority(rel)) continue;
    let from = 0;
    while (from < text.length) {
      const match = rule.pattern.exec(text.slice(from));
      if (!match) break;
      const index = from + match.index;
      const line = lineNumber(text, index);
      const snippet = text.slice(index, index + 80).split('\n')[0];
      if (rule.allow?.(snippet, rel, line, text, index)) {
        from = index + match[0].length;
        continue;
      }
      issues.push(`${rel}:${line}: ${rule.message} (${snippet.trim()})`);
      from = index + match[0].length;
    }
  }
  return issues;
}

function isRetiredGatewayDocumentation(rel, lineText) {
  if (!rel.endsWith('.md')) return false;
  const trimmed = lineText.trimStart();
  if (trimmed.startsWith('|')) return true;
  return (
    /Retired/i.test(lineText) ||
    /forbidden/i.test(lineText) ||
    /MUST NOT[`]?\s*invent/i.test(lineText) ||
    /invent a bare/i.test(lineText) ||
    /MUST fail on bare/i.test(lineText) ||
    /Bare `/i.test(lineText) ||
    /bare `/i.test(lineText) ||
    /without\s+(?:a\s+)?[`]?standalone/i.test(lineText) ||
    /without\s+(?:the\s+)?(?:a\s+)?[`]?cloud[`]?\s+qualifier/i.test(lineText) ||
    /for brevity/i.test(lineText) ||
    /Retired platform/i.test(lineText) ||
    /preserve compatib/i.test(lineText) ||
    /Migration mapping/i.test(lineText)
  );
}

function isLegacyTableRow(rel, line, text, index) {
  if (!rel.endsWith('MIGRATION_SPEC.md') && !rel.endsWith('NAMING_SPEC.md')) return false;
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const lineEnd = text.indexOf('\n', index);
  const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  if (rel.endsWith('MIGRATION_SPEC.md') && lineText.trimStart().startsWith('|')) return true;
  if (rel.endsWith('NAMING_SPEC.md') && lineText.trimStart().startsWith('|')) return true;
  return lineText.includes('Retired synonyms');
}

const NON_CANONICAL_ROUTE_CRATE_PATTERN = legacyHttpRouteCratePattern();
const NON_CANONICAL_FOUNDATION_PC_REACT_PATTERN = forbiddenFoundationPcReactPattern();

function isAllowedContext(snippet, rel, line, text, index) {
  return (
    /production/u.test(snippet) ||
    /product name/u.test(snippet) ||
    /product-owned internal/u.test(snippet) ||
    /`product:\*`/u.test(snippet) ||
    /namespace.*product/u.test(snippet) ||
    /Retired commerce capability token `product`/u.test(snippet) ||
    /forbidden generic suffix `product`/u.test(snippet) ||
    /sdkwork-<application-code>-product/u.test(snippet) ||
    isLegacyTableRow(rel, line, text, index)
  );
}

const standardsRules = [
  {
    pattern: /<product>/gu,
    message: 'retired placeholder <product>; use <application-code> or <application_code>',
    allow: (snippet, rel, line, text, index) => isAllowedContext(snippet, rel, line, text, index),
    onlySpecs: true,
  },
  {
    pattern: /sdkwork-<app>-/gu,
    message: 'retired placeholder sdkwork-<app>-*; use sdkwork-<application-code>-*',
    onlySpecs: true,
  },
  {
    pattern: /react-backend-product/gu,
    message: 'retired backend package react-backend-product; use react-backend-merchandise',
  },
  {
    pattern: /commerce-product-service/gu,
    message: 'retired commerce-product-service; use commerce-merchandise-service',
  },
  {
    pattern: /-(?:pc|h5)-product(?:[^a-z]|$)/gu,
    message: 'retired client package suffix -pc-product/-h5-product; use -merchandise or another capability',
    allow: (snippet) => snippet.includes('application-code>-product'),
  },
  {
    pattern: /product-specific/gu,
    message: 'retired product-specific; use application-specific',
    allow: (snippet, rel, line, text, index) => isAllowedContext(snippet, rel, line, text, index),
  },
  {
    pattern: /product-prefixed/gu,
    message: 'retired product-prefixed; use application-code-prefixed',
    allow: (snippet) => snippet.includes('product-prefix') && snippet.includes('deprecated'),
  },
  {
    pattern: /Product repository/gu,
    message: 'retired Product repository; use SDKWork repository',
  },
  {
    pattern: /product code/giu,
    message: 'retired product code; use application code',
    allow: (snippet, rel, line, text, index) => isAllowedContext(snippet, rel, line, text, index),
  },
  {
    pattern: /sdkwork\/<app>/gu,
    message: 'retired path sdkwork/<app>; use sdkwork/<application-code>',
    onlySpecs: true,
  },
  {
    pattern: /PRODUCT_OR_PLATFORM/gu,
    message: 'retired env formula PRODUCT_OR_PLATFORM; use PLATFORM_OR_APPLICATION_CODE',
    onlySpecs: true,
  },
  {
    pattern: /Product apps/gu,
    message: 'retired Product apps; use Consuming applications or application roots',
  },
  {
    pattern: /product apps/gu,
    message: 'retired product apps; use consuming applications',
  },
  {
    pattern: /Product application/gu,
    message: 'retired Product application; use Application or application root',
    allow: (snippet) => /Product application-owned/i.test(snippet),
  },
  {
    pattern: /product prefix/giu,
    message: 'retired product prefix; use application-code prefix',
    allow: (snippet, rel, line, text, index) =>
      isLegacyTableRow(rel, line, text, index) || /Forbidden Application-Code Prefixes/i.test(text),
  },
  {
    pattern: /product approval/giu,
    message: 'retired product approval; use governance approval',
  },
  {
    pattern: /sdkwork-identity-/giu,
    message: 'forbidden sdkwork-identity-* package/crate; domain is iam',
  },
  {
    pattern: /domain:\s*identity/giu,
    message: 'forbidden domain identity; use iam',
  },
  {
    pattern: /Product app-api/gu,
    message: 'retired Product app-api qualifier; use app-api',
  },
  {
    pattern: /product app-api/gu,
    message: 'retired product app-api qualifier; use app-api',
  },
  {
    pattern: /sdkwork-<application-code>-gateway(?!-assembly)/gu,
    message: 'retired application gateway identity; use sdkwork-api-<application-code>-assembly or sdkwork-api-<application-code>-standalone-gateway',
    allow: (snippet, rel, line, text, index) => {
      const lineStart = text.lastIndexOf('\n', index) + 1;
      const lineEnd = text.indexOf('\n', index);
      const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const prevLineStart = text.lastIndexOf('\n', lineStart - 2) + 1;
      const prevLineText = text.slice(prevLineStart, lineStart - 1);
      const context = `${prevLineText}\n${lineText}`;
      return (
        snippet.includes('sdkwork-api-cloud-gateway') ||
        snippet.includes('sdkwork-api-<application-code>-standalone-gateway') ||
        snippet.includes('sdkwork-api-<application-code>-assembly') ||
        lineText.includes('sdkwork-api-<application-code>-assembly') ||
        snippet.includes('Retired') ||
        snippet.includes('retired') ||
        isLegacyTableRow(rel, line, text, index) ||
        isRetiredGatewayDocumentation(rel, lineText) ||
        isRetiredGatewayDocumentation(rel, context)
      );
    },
    onlySpecs: true,
  },
  {
    pattern: /shared foundation gateway/giu,
    message: 'ambiguous shared foundation gateway; use platform connectivity-plane gateway',
    allow: (snippet) => snippet.includes('platform connectivity-plane'),
  },
  {
    pattern: /\bgateway assembl(?:y|ies)\b|gateway-assembly|gateway:assembly:/giu,
    message: 'retired gateway assembly identity; use API assembly and api:assembly:*',
    allow: (snippet, rel, line, text, index) => {
      const lineStart = text.lastIndexOf('\n', index) + 1;
      const lineEnd = text.indexOf('\n', index);
      const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const context = text.slice(Math.max(0, lineStart - 160), lineEnd === -1 ? text.length : lineEnd);
      return isRetiredGatewayDocumentation(rel, lineText)
        || /retired|migration|rejected|old identity/iu.test(context);
    },
    onlySpecs: true,
  },
  {
    pattern: /sdkwork-commerce \(deleted\)/giu,
    message: 'deleted repository identity in active authority; use a current example and keep deleted identities in migration history only',
    onlySpecs: true,
  },
  {
    pattern: /\b(?:shared SDKWork API gateway|SDKWork API gateway|shared gateway)\b/giu,
    message: 'ambiguous gateway role; name application standalone gateway, platform cloud gateway, or the exact API surface',
    allow: (snippet, rel, line, text, index) => {
      const lineStart = text.lastIndexOf('\n', index) + 1;
      const lineEnd = text.indexOf('\n', index);
      const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      return /bare phrases|retired|MUST NOT use/iu.test(lineText);
    },
    onlySpecs: true,
  },
  {
    pattern: /product adapter/giu,
    message: 'retired product adapter; use application-line adapter',
    allow: (snippet, rel, line, text, index) => isLegacyTableRow(rel, line, text, index),
  },
  {
    pattern: /product same-origin/giu,
    message: 'retired product same-origin; use application same-origin',
  },
  {
    pattern: /product copy/giu,
    message: 'retired product copy; use L1 brand/store copy or message-catalog content',
    allow: (snippet, rel, line, text, index) => isLegacyTableRow(rel, line, text, index),
  },
  {
    pattern: /product OpenAPI/giu,
    message: 'retired product OpenAPI; use application-owned OpenAPI',
  },
];

const consumerRules = [
  {
    pattern: NON_CANONICAL_FOUNDATION_PC_REACT_PATTERN,
    message:
      'non-canonical appbase foundation PC React package; use sdkwork-shell-pc-react or sdkwork-workspace-pc-react',
  },
  {
    pattern: legacyHttpRouteCratePattern(),
    message:
      'non-canonical Rust HTTP route crate name; use sdkwork-routes-<capability>-<surface>',
  },
  {
    pattern: /react-backend-product/gu,
    message: 'retired backend package react-backend-product; use react-backend-merchandise',
  },
  {
    pattern: /commerce-product-service/gu,
    message: 'retired commerce-product-service; use commerce-merchandise-service',
  },
  {
    pattern: /sdkwork-[a-z0-9]+-(?:pc|h5)-product(?:[^a-z]|$)/gu,
    message: 'retired client package *-pc-product/*-h5-product; migrate to *-merchandise',
  },
  {
    pattern: /name = "sdkwork-api-gateway"/gu,
    message: 'retired bare platform gateway crate; use sdkwork-api-cloud-gateway',
  },
  {
    pattern: /name = "sdkwork-[a-z0-9]+-gateway"/gu,
    message: 'retired bare application gateway crate; use sdkwork-api-<application-code>-standalone-gateway',
    allow: (snippet) =>
      snippet.includes('sdkwork-api-cloud-gateway') ||
      snippet.includes('sdkwork-api-') && snippet.includes('-standalone-gateway'),
  },
  {
    pattern: /^name\s*=\s*"sdkwork-[a-z0-9-]+-runtime"\s*$/gmu,
    message:
      'forbidden generic Rust runtime crate; use a responsibility-specific host/worker or sdkwork-<application-code>-<edge-capability>-edge-runtime',
    allow: (snippet) =>
      /^name\s*=\s*"sdkwork-[a-z0-9]+(?:-[a-z0-9]+)+-edge-runtime"\s*$/u.test(snippet),
  },
  {
    pattern: /^name\s*=\s*"sdkwork-[a-z0-9]+(?:-[a-z0-9]+)+-edge-runtime"\s*$/gmu,
    message: 'edge-runtime Rust crates must live under crates/',
    allow: (_snippet, rel) => /^crates[\\/][^\\/]+[\\/]Cargo\.toml$/u.test(rel),
  },
];

function scanStandards(root) {
  const files = walk(root).filter((file) => {
    const ext = path.extname(file);
    if (!SCAN_EXTENSIONS.has(ext)) return false;
    const rel = relative(root, file);
    if (ALLOW_PATH_PARTS.has(path.basename(file))) return false;
    if (rel.includes('templates/env.postgres')) return false;
    return ext === '.md' || rel.includes('tools/');
  });
  const issues = [];
  for (const file of files) {
    const rel = relative(root, file);
    if (rel === 'MIGRATION_SPEC.md') continue;
    const text = fs.readFileSync(file, 'utf8');
    issues.push(...scanText(file, text, standardsRules, root));
  }
  return issues;
}

function scanConsumer(root) {
  const targets = [];
  for (const sub of ['packages', 'apps', 'crates', 'services', 'sdks']) {
    const dir = path.join(root, sub);
    if (fs.existsSync(dir)) targets.push(...walk(dir));
  }
  const issues = [];
  for (const file of targets) {
    const ext = path.extname(file);
    if (!['.json', '.toml', '.rs', '.ts', '.tsx', '.md', '.yaml', '.yml'].includes(ext)) continue;
    const text = fs.readFileSync(file, 'utf8');
    issues.push(...scanText(file, text, consumerRules, root));
  }
  return issues;
}

const parsed = parseArgs({
  options: {
    root: { type: 'string' },
    mode: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
});

if (parsed.values.help) {
  console.log(usage());
  process.exit(0);
}

const root = path.resolve(parsed.values.root || SPECS_ROOT);
const mode =
  parsed.values.mode ||
  (path.resolve(root) === path.resolve(SPECS_ROOT) ? 'standards' : 'consumer');

const issues = mode === 'standards' ? scanStandards(root) : scanConsumer(root);

if (issues.length > 0) {
  fail(`found ${issues.length} identity naming issue(s)`, issues.slice(0, 100));
}

console.log(
  `identity naming ok: ${path.relative(process.cwd(), root) || root} (${mode} mode)`,
);
