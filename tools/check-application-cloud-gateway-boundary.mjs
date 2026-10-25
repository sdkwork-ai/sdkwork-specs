#!/usr/bin/env node
/**
 * Reject generic application cloud gateways and application ownership or
 * operation of sdkwork-api-cloud-gateway.
 * Authority: API_ASSEMBLY_SPEC.md section 8.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ROOT = path.resolve(SPECS_ROOT, '..');
const ACTIVE_ROOT_FILES = [
  'Cargo.toml',
  'package.json',
  'pnpm-workspace.yaml',
  'agent.app.config.json',
];
const ACTIVE_DIRS = ['crates', 'apps', 'scripts', 'specs', 'etc', 'deployments'];
const ACTIVE_EXTENSIONS = new Set([
  '.json', '.toml', '.yaml', '.yml', '.env', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.rs', '.md',
]);
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'target', 'dist', 'build', 'generated', '.runtime', '.tmp', 'docs',
]);
const FORBIDDEN = 'sdkwork-api-cloud-gateway';
const APPLICATION_CLOUD_GATEWAY_PATTERN = /\bsdkwork-(?!api-cloud-gateway\b)[a-z0-9-]+-cloud-gateway\b/u;
const RETIRED_FOUNDATION_GATEWAY_FIELD_PATTERN = /["']foundationApiGateway["']\s*:/u;

function collectFiles(root) {
  const files = ACTIVE_ROOT_FILES
    .map((name) => path.join(root, name))
    .filter((filePath) => fs.existsSync(filePath));

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (ACTIVE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(filePath);
    }
  }

  for (const dir of ACTIVE_DIRS) walk(path.join(root, dir));
  return [...new Set(files)];
}

function isApplicationRoot(root) {
  return fs.existsSync(path.join(root, 'agent.app.config.json'));
}

export function checkApplicationCloudGatewayBoundary(root) {
  const resolved = path.resolve(root);
  if (path.basename(resolved) === FORBIDDEN || !isApplicationRoot(resolved)) {
    return { ok: true, skipped: true, root: resolved, findings: [] };
  }

  const findings = [];
  for (const filePath of collectFiles(resolved)) {
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      if (
        !lines[index].includes(FORBIDDEN)
        && !APPLICATION_CLOUD_GATEWAY_PATTERN.test(lines[index])
        && !RETIRED_FOUNDATION_GATEWAY_FIELD_PATTERN.test(lines[index])
      ) continue;
      findings.push({
        file: path.relative(resolved, filePath).replace(/\\/gu, '/'),
        line: index + 1,
        detail: lines[index].trim().slice(0, 240),
      });
    }
  }
  return { ok: findings.length === 0, skipped: false, root: resolved, findings };
}

function workspaceRoots(workspace) {
  return fs.readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => path.join(workspace, entry.name))
    .filter(isApplicationRoot);
}

function usage() {
  return 'Usage: node tools/check-application-cloud-gateway-boundary.mjs (--root <application> | --workspace <workspace>)';
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      workspace: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(usage());
    return;
  }
  if (Boolean(values.root) === Boolean(values.workspace)) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const roots = values.root
    ? [path.resolve(values.root)]
    : workspaceRoots(path.resolve(values.workspace));
  const failures = roots.map(checkApplicationCloudGatewayBoundary).filter((result) => !result.ok);
  for (const failure of failures) {
    for (const finding of failure.findings) {
      console.error(`${path.basename(failure.root)}/${finding.file}:${finding.line}: ${finding.detail}`);
    }
  }
  if (failures.length > 0) {
    console.error(`application-cloud-gateway-boundary: found ${failures.reduce((sum, item) => sum + item.findings.length, 0)} issue(s)`);
    process.exitCode = 1;
    return;
  }
  console.log(`application-cloud-gateway-boundary: passed ${roots.length} application root(s)`);
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) main();
