#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(readArgument('--workspace') ?? process.cwd());
const strict = process.argv.includes('--strict');
const ignoredDirectories = new Set([
  '.git', '.pnpm', 'build', 'coverage', 'dist', 'external', 'generated',
  'node_modules', 'sdks', 'target', 'test', 'tests',
]);
const sourceExtensions = new Set([
  '.dart', '.js', '.jsx', '.kt', '.kts', '.mjs', '.swift', '.ts', '.tsx', '.ets',
]);
const manifests = findFiles(workspaceRoot, 'agent.app.config.json');
const appRoots = selectApplicationSurfaceRoots(manifests.map((file) => path.dirname(file)));
const results = [];

for (const appRoot of appRoots) {
  const sources = collectSources(appRoot);
  const source = sources.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  if (!hasIamIntegration(source)) {
    continue;
  }

  const checks = {
    authBoundary: /AuthGate|AppAuthGate|ProtectedRoute|RequireAuth|RequireOperatorSession|AuthenticatedAuthRouteGuard|isPublicAuthRoute|auth(?:entication)?\s*gate/iu.test(source),
    currentSessionValidation:
      /sessions\.current\.retrieve|current\.retrieve|hydrate[A-Za-z]*Session|restore[A-Za-z]*Session|createSdkworkAppbasePcAuthRuntime|SdkworkSessionAuthBrowserRoot/iu.test(source),
    dualTokens: /authToken|auth_token/u.test(source) && /accessToken|access_token/u.test(source),
    logoutClearing: /clearTokens|clearSession|clear[A-Za-z]*Session|logout|signOut/iu.test(source),
    persistentSession:
      /localStorage|secureStorage|secure_storage|flutter_secure_storage|createPersistentIamTokenStore|tokenStore|SessionPersistence|getCustomerServiceIamAuthRuntime/iu.test(source),
    refreshToken: /refreshToken|refresh_token|createPersistentIamTokenStore|getCustomerServiceIamAuthRuntime/u.test(source),
    tokenManager: /TokenManager|tokenManager|token_manager/u.test(source),
  };
  const missing = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  results.push({
    appRoot: path.relative(workspaceRoot, appRoot),
    checks,
    missing,
    sourceFiles: sources.length,
  });
}

const incomplete = results.filter((result) => result.missing.length > 0);
const report = {
  applicationManifests: manifests.length,
  applicationSurfaceRoots: appRoots.length,
  iamIntegratedSurfaces: results.length,
  complete: results.length - incomplete.length,
  incomplete: incomplete.length,
  results,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`IAM integration audit: ${report.complete}/${report.iamIntegratedSurfaces} complete`);
  for (const result of incomplete) {
    console.log(`- ${result.appRoot}: missing ${result.missing.join(', ')}`);
  }
}

if (strict && incomplete.length > 0) {
  process.exit(1);
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function findFiles(root, fileName) {
  const files = [];
  walk(root, (filePath) => {
    if (path.basename(filePath) === fileName) {
      files.push(filePath);
    }
  });
  return files;
}

function selectApplicationSurfaceRoots(roots) {
  const normalizedRoots = [...new Set(roots.map((root) => path.resolve(root)))];
  return normalizedRoots.filter((root) => !normalizedRoots.some((candidate) =>
    candidate !== root
      && path.dirname(candidate).startsWith(`${root}${path.sep}`)
      && fs.existsSync(path.join(root, 'apps')),
  ));
}

function collectSources(root) {
  const files = [];
  walk(root, (filePath) => {
    if (sourceExtensions.has(path.extname(filePath).toLowerCase()) && !isTestFile(filePath)) {
      files.push(filePath);
    }
  });
  return files;
}

function walk(directory, onFile) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath, onFile);
    } else {
      onFile(entryPath);
    }
  }
}

function hasIamIntegration(source) {
  return /@sdkwork\/auth-(?:runtime-)?pc-react|createSdkworkAppbasePcAuthRuntime|SdkworkIamAuthRoutes|createSdkworkIamRuntimeAuthController|auth\.sessions\.(?:create|refresh)|AuthSessionController|auth_session_controller|IamAuthGate/iu.test(source);
}

function isTestFile(filePath) {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  return normalized.includes('/__tests__/')
    || normalized.includes('/e2e/')
    || normalized.includes('/scripts/')
    || /\.(?:spec|test)\.[^.]+$/u.test(normalized);
}
