#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(readArgument('--workspace') ?? process.cwd());
const ignoredDirectories = new Set([
  '.git',
  '.pnpm',
  'coverage',
  'dist',
  'external',
  'generated',
  'node_modules',
  'target',
]);
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const violations = [];
const inspectedSourceFiles = new Set();

verifyIamDefaults();
scanWorkspaceApplications();

if (violations.length > 0) {
  console.error('auth session retention check failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('auth session retention check passed');

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function verifyIamDefaults() {
  const tokenSourcePath = path.join(
    workspaceRoot,
    'sdkwork-iam',
    'crates',
    'sdkwork-routes-iam-app-api',
    'src',
    'tokens.rs',
  );
  const runtimeSourcePath = path.join(
    workspaceRoot,
    'sdkwork-iam',
    'apps',
    'sdkwork-iam-common',
    'packages',
    'sdkwork-iam-runtime',
    'src',
    'index.ts',
  );
  const tokenSource = readRequiredFile(tokenSourcePath);
  const runtimeSource = readRequiredFile(runtimeSourcePath);

  if (!/DEFAULT_SESSION_TTL_DAYS:\s*u128\s*=\s*30/u.test(tokenSource)) {
    violations.push('sdkwork-iam must define a 30-day default interactive session TTL');
  }
  if (!/export function createPersistentIamTokenStore/u.test(runtimeSource)) {
    violations.push('@sdkwork/iam-runtime must export the shared persistent token store');
  }
  if (!/refreshToken/u.test(runtimeSource)) {
    violations.push('@sdkwork/iam-runtime persistent sessions must retain refreshToken');
  }
}

function scanWorkspaceApplications() {
  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const repositoryRoot = path.join(workspaceRoot, entry.name);
    const appsRoot = path.join(repositoryRoot, 'apps');
    if (fs.existsSync(path.join(repositoryRoot, 'agent.app.config.json'))) {
      walkApplicationSources(repositoryRoot);
    } else if (fs.existsSync(appsRoot)) {
      walkApplicationSources(appsRoot);
    }
  }
}

function walkApplicationSources(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkApplicationSources(entryPath);
      continue;
    }
    if (!sourceExtensions.has(path.extname(entry.name)) || isTestFile(entryPath)) {
      continue;
    }
    inspectSource(entryPath);
  }
}

function inspectSource(filePath) {
  if (inspectedSourceFiles.has(filePath)) {
    return;
  }
  inspectedSourceFiles.add(filePath);
  if (isExplicitShortLivedDevProvider(filePath)) {
    return;
  }
  const source = fs.readFileSync(filePath, 'utf8');
  const writesTabScopedSession = [...source.matchAll(
    /sessionStorage\.setItem\s*\(\s*([A-Za-z0-9_$.]+)/gu,
  )].some((match) => /TOKEN|SESSION|STORAGE_KEY/iu.test(match[1]) && !/FLAG/iu.test(match[1]));
  const injectsTabScopedSessionStore = /return\s+(?:window\.)?sessionStorage|session:\s*(?:window\.)?sessionStorage/iu.test(source);
  const ownsIamCredentials = /authToken|refreshToken|AUTH_TOKEN/u.test(source);
  const hasDurableMigration = /localStorage\.setItem\s*\(/u.test(source);
  if ((writesTabScopedSession || injectsTabScopedSessionStore) && ownsIamCredentials && !hasDurableMigration) {
    violations.push(
      `${path.relative(workspaceRoot, filePath)} writes IAM credentials only to sessionStorage`,
    );
  }
}

function isExplicitShortLivedDevProvider(filePath) {
  return filePath.replaceAll('\\', '/').endsWith(
    '/sdkwork-web-framework/apps/sdkwork-web-framework-pc/src/sdk/auth/token-provider.ts',
  );
}

function isTestFile(filePath) {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  return normalized.includes('/test/')
    || normalized.includes('/tests/')
    || normalized.includes('/e2e/')
    || normalized.includes('/scripts/')
    || /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(normalized);
}

function readRequiredFile(filePath) {
  if (!fs.existsSync(filePath)) {
    violations.push(`required auth session authority is missing: ${path.relative(workspaceRoot, filePath)}`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}
