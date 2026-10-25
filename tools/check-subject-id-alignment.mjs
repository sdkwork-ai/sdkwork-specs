#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'target',
  'dist',
  'generated',
  '.git',
  'external',
]);

/** Paths that intentionally use non-numeric tenant ids in negative tests. */
const NEGATIVE_TEST_PATH_MARKERS = [
  'app_sql_subject.rs',
  'web_bridge.rs',
  'web_framework_compat.rs',
  'app_dashboard_api.rs',
  'runtime_standard.rs',
];

function isNegativeTestFile(relativePath) {
  return NEGATIVE_TEST_PATH_MARKERS.some((marker) => relativePath.endsWith(marker));
}

const FORBIDDEN_PATTERNS = [
  { label: 'legacy tenant string tenant-1', pattern: /["']tenant-1["']/g },
  { label: 'legacy tenant string tenant-001', pattern: /["']tenant-001["']/g },
  { label: 'legacy tenant string tenant-demo', pattern: /["']tenant-demo["']/g },
  { label: 'legacy tenant string tenant-test', pattern: /["']tenant-test["']/g },
  { label: 'legacy tenant string tenant-other', pattern: /["']tenant-other["']/g },
  { label: 'legacy tenant string tenant-bootstrap (positive fixture)', pattern: /["']tenant-bootstrap["']/g, skipNegativeTests: true },
  { label: 'legacy org string org-1', pattern: /["']org-1["']/g },
  { label: 'legacy org string org-2', pattern: /["']org-2["']/g },
  { label: 'legacy org string org-test', pattern: /["']org-test["']/g },
  { label: 'legacy org string org-ai', pattern: /["']org-ai["']/g },
  { label: 'legacy org string org-exec', pattern: /["']org-exec["']/g },
  { label: 'legacy org string org-rtc-drive', pattern: /["']org-rtc-drive["']/g },
  { label: 'legacy org string org-002', pattern: /["']org-002["']/g },
  { label: 'legacy tenant_id: 1 fixture', pattern: /\btenant_id:\s*1\b/g },
  { label: 'legacy organization_id: 1 fixture', pattern: /\borganization_id:\s*1\b/g },
  { label: 'env tenant id =1', pattern: /TENANT_ID=1(?:\r?\n|$)/g },
  { label: 'env tenant id =1001', pattern: /TENANT_ID=1001(?:\r?\n|$)/g },
  { label: 'doubled tenant id 10000100001', pattern: /10000100001/g },
  { label: 'prefixed org_ tenant_', pattern: /\b(?:org|tenant)_[{]/g },
  { label: 'legacy tenant string tenant-a (subject scope)', pattern: /["']tenant-a["']/g, skipNegativeTests: true },
  { label: 'legacy tenant string tenant-oauth', pattern: /["']tenant-oauth["']/g },
  { label: 'legacy tenant string tenant-ai', pattern: /["']tenant-ai["']/g },
  { label: 'legacy tenant string tenant_1', pattern: /["']tenant_1["']/g },
  { label: 'legacy org string org_1', pattern: /["']org_1["']/g },
  { label: 'legacy tenant string tenant_42', pattern: /["']tenant_42["']/g },
  { label: 'legacy org string org_configured', pattern: /["']org_configured["']/g },
  { label: 'legacy org string org_secondary', pattern: /["']org_secondary["']/g },
  { label: 'legacy tenant string tenant-rtc-drive', pattern: /["']tenant-rtc-drive["']/g },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
      continue;
    }
    if (/\.(rs|ts|tsx|mjs|json|sql|env(?:\.[A-Za-z0-9._-]+)?)$/u.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

function assertManifest(relativePath) {
  const absolute = path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(absolute)) {
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(absolute, 'utf8').replace(/^\uFEFF/u, ''));
  const tenantId = manifest.backend?.tenantId ?? manifest.tenantId;
  const organizationId = manifest.backend?.organizationId ?? manifest.organizationId;
  if (tenantId != null && tenantId !== '100001') {
    failures.push(`${relativePath}: tenantId must be 100001 (found ${tenantId})`);
  }
  if (organizationId != null && organizationId !== '0') {
    failures.push(`${relativePath}: organizationId must be 0 (found ${organizationId})`);
  }
}

for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) {
    continue;
  }
  const repoRoot = path.join(workspaceRoot, entry.name);
  walk(repoRoot).forEach((absolute) => {
    if (path.basename(absolute) === 'agent.app.config.json') {
      assertManifest(path.relative(workspaceRoot, absolute).replaceAll('\\', '/'));
    }
  });
}

for (const file of walk(workspaceRoot)) {
  const relative = path.relative(workspaceRoot, file).replaceAll('\\', '/');
  if (relative.includes('check-subject-id-alignment.mjs')) {
    continue;
  }
  if (relative.includes('check_agents_identity_alignment.mjs')) {
    continue;
  }
  if (relative.includes('/sdks/') && relative.includes('/generated/')) {
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  for (const { label, pattern, skipNegativeTests } of FORBIDDEN_PATTERNS) {
    if (skipNegativeTests && isNegativeTestFile(relative)) {
      continue;
    }
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      failures.push(`${relative}: forbidden ${label}`);
    }
  }
}

if (failures.length > 0) {
  console.error('subject id alignment failures:');
  for (const failure of failures.slice(0, 200)) {
    console.error(`- ${failure}`);
  }
  if (failures.length > 200) {
    console.error(`... and ${failures.length - 200} more`);
  }
  process.exit(1);
}

console.log('subject id alignment passed');
