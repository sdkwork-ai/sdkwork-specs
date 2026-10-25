#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IAM_PACKAGE_PATHS } from './iam-workspace-paths.mjs';

const FRAMEWORK_PACKAGE = '@sdkwork/iam-application-bootstrap';
const EMBEDDED_RUST_FRAMEWORK_PACKAGE = 'sdkwork-iam-embedded-application-bootstrap';
const IAM_ASSEMBLY_PACKAGE = 'sdkwork-api-iam-assembly';
const FRAMEWORK_PACKAGE_PATHS = [
  IAM_PACKAGE_PATHS[FRAMEWORK_PACKAGE],
  'apps/sdkwork-iam-common/packages/sdkwork-iam-application-bootstrap',
];
const REQUIRED_BOOTSTRAP_SCRIPT = 'admin:bootstrap:app';
const FORBIDDEN_BOOTSTRAP_HTTP_MARKERS = [
  '/backend/v3/api/iam/applications/register',
  '/backend/v3/api/iam/tenant-applications',
  '/backend/v3/api/iam/tenant_applications',
  '/backend/v3/api/iam/access-credentials',
  '/backend/v3/api/iam/access_credentials',
];
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.turbo', 'generated']);

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function listFiles(rootDir, predicate, maxDepth = 8, depth = 0, results = []) {
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

function findAppManifests(rootDir) {
  return listFiles(rootDir, (filePath) => path.basename(filePath) === 'agent.app.config.json');
}

function findBootstrapScripts(rootDir) {
  return listFiles(rootDir, (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.includes('/scripts/bootstrap/') && normalized.endsWith('.mjs');
  });
}

function packageJsonAt(rootDir) {
  const filePath = path.join(rootDir, 'package.json');
  return fs.existsSync(filePath) ? readJson(filePath) : null;
}

function hasFrameworkDependency(packageJson) {
  if (!packageJson) {
    return false;
  }
  const sections = [packageJson.dependencies, packageJson.devDependencies, packageJson.peerDependencies];
  return sections.some((section) => section && section[FRAMEWORK_PACKAGE]);
}

function hasEmbeddedRustFrameworkDependency(rootDir) {
  const cargoManifests = listFiles(
    rootDir,
    (filePath) => path.basename(filePath) === 'Cargo.toml',
    5,
  );
  const dependencyPattern = new RegExp(
    `^\\s*(?:${EMBEDDED_RUST_FRAMEWORK_PACKAGE}|sdkwork_iam_embedded_application_bootstrap)\\s*(?:=|\\.)`,
    'mu',
  );
  return cargoManifests.some((manifestPath) => dependencyPattern.test(readText(manifestPath)));
}

function hasIamAssemblyDependency(rootDir) {
  const cargoManifests = listFiles(
    rootDir,
    (filePath) => path.basename(filePath) === 'Cargo.toml',
    5,
  );
  const dependencyPattern = new RegExp(
    `^\\s*(?:${IAM_ASSEMBLY_PACKAGE}|sdkwork_api_iam_assembly)\\s*(?:=|\\.)`,
    'mu',
  );
  return cargoManifests.some((manifestPath) => dependencyPattern.test(readText(manifestPath)));
}

function validateManifestPermissions(manifestPath, failures) {
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    failures.push(`${manifestPath}: invalid agent.app.config.json (${error.message})`);
    return;
  }

  const permissions =
    manifest.backend?.accessTokenPermissionScope ??
    manifest.backend?.permissionScope ??
    [];

  if (!Array.isArray(permissions) || permissions.length === 0) {
    failures.push(
      `${manifestPath}: backend.accessTokenPermissionScope (or backend.permissionScope) must be a non-empty string array for IAM bootstrap`,
    );
  }
}

function validateBootstrapScript(scriptPath, failures) {
  const text = readText(scriptPath);
  const relativePath = scriptPath.replace(/\\/g, '/');

  if (!text.includes(FRAMEWORK_PACKAGE)) {
    failures.push(`${relativePath}: bootstrap script must import ${FRAMEWORK_PACKAGE}`);
  }

  for (const marker of FORBIDDEN_BOOTSTRAP_HTTP_MARKERS) {
    if (text.includes(marker)) {
      failures.push(`${relativePath}: bootstrap script must not embed raw bootstrap HTTP path ${marker}`);
    }
  }
}

export function validateIamApplicationBootstrapStandard(rootDir) {
  const failures = [];
  const packageJson = packageJsonAt(rootDir);
  const manifests = findAppManifests(rootDir);
  const bootstrapScripts = findBootstrapScripts(rootDir);
  const hasFrameworkPackageDir = FRAMEWORK_PACKAGE_PATHS.some((relativePath) =>
    fs.existsSync(path.join(rootDir, relativePath)),
  );
  const hasEmbeddedRustFramework = hasEmbeddedRustFrameworkDependency(rootDir);
  const hasIamAssembly = hasIamAssemblyDependency(rootDir);
  const frameworkPackagePath = FRAMEWORK_PACKAGE_PATHS.find((relativePath) =>
    fs.existsSync(path.join(rootDir, relativePath)),
  );

  if (hasFrameworkPackageDir && frameworkPackagePath) {
    const frameworkPackageJson = packageJsonAt(path.join(rootDir, frameworkPackagePath));
    if (!frameworkPackageJson || frameworkPackageJson.name !== FRAMEWORK_PACKAGE) {
      failures.push(`${frameworkPackagePath}/package.json must declare name ${FRAMEWORK_PACKAGE}`);
    }
    if (!packageJson?.scripts?.[REQUIRED_BOOTSTRAP_SCRIPT]) {
      failures.push(`root package.json must expose ${REQUIRED_BOOTSTRAP_SCRIPT} for IAM application bootstrap`);
    }
    if (!hasFrameworkDependency(packageJson)) {
      failures.push(`root package.json must depend on ${FRAMEWORK_PACKAGE}`);
    }
  }

  for (const manifestPath of manifests) {
    validateManifestPermissions(manifestPath, failures);
  }

  for (const scriptPath of bootstrapScripts) {
    validateBootstrapScript(scriptPath, failures);
  }

  if (
    (manifests.length > 0 || bootstrapScripts.length > 0)
    && !hasFrameworkDependency(packageJson)
    && !hasFrameworkPackageDir
    && !hasEmbeddedRustFramework
    && !hasIamAssembly
  ) {
    failures.push(
      `repository declares app bootstrap surfaces but depends on none of ${FRAMEWORK_PACKAGE}, ${EMBEDDED_RUST_FRAMEWORK_PACKAGE}, or ${IAM_ASSEMBLY_PACKAGE}; add the matching shared bootstrap owner or remove local bootstrap duplication`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    summary: {
      manifests: manifests.length,
      bootstrapScripts: bootstrapScripts.length,
      hasFrameworkPackageDir,
      hasEmbeddedRustFramework,
      hasIamAssembly,
    },
  };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const result = validateIamApplicationBootstrapStandard(root);
  if (!result.ok) {
    console.error('IAM application bootstrap standard failed:');
    for (const failure of result.failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log(
    `IAM application bootstrap standard ok (${result.summary.manifests} manifest(s), ${result.summary.bootstrapScripts} bootstrap script(s))`,
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
