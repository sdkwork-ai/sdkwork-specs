import fs from 'node:fs';
import path from 'node:path';
import {
  extractImportSpecifiers,
  detectClientArchitecture,
  findCorePackages,
  isCorePackageDirectory,
  listClientAppRoots,
  readJson,
  readText,
  toPosix,
  validateCoreCompositionLayout,
} from './app-composition.mjs';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);

const DIRECT_SDK_IMPORT_RE = /(?:generated|generated-typescript|domain-transport|server-openapi|(?:^|\/|@sdkwork\/)[a-z0-9-]+-(?:app|backend)-sdk(?:$|\/))/u;
const BUSINESS_SDK_PACKAGE_RE = /(?:^|\/|@sdkwork\/)[a-z0-9-]+-(?:app|backend)-sdk(?:$|\/)/u;

function packageRole(packageName) {
  if (isCorePackageDirectory(packageName)) return 'core';
  if (/-commons$/u.test(packageName) || /_commons$/u.test(packageName)) return 'commons';
  if (/-shell$/u.test(packageName) || /_shell$/u.test(packageName)) return 'shell';
  if (/-host$/u.test(packageName) || /_host$/u.test(packageName)) return 'host';
  return 'capability';
}

function listSourceFiles(rootDir) {
  const files = [];
  if (!fs.existsSync(rootDir)) return files;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...listSourceFiles(path.join(rootDir, entry.name)));
      continue;
    }
    if (/\.(?:ts|tsx|js|jsx)$/u.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(path.join(rootDir, entry.name));
    }
  }
  return files;
}

function packageDependencies(packageJson) {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);
}

function listPackages(appRoot) {
  const packagesDir = path.join(appRoot, 'packages');
  if (!fs.existsSync(packagesDir)) return [];
  const packages = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(packagesDir, entry.name);
    const packageJsonPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) continue;
    const packageJson = readJson(packageJsonPath);
    packages.push({
      directoryName: entry.name,
      packageDir,
      packageJsonPath,
      packageJson,
      name: packageJson.name ?? entry.name,
      role: packageRole(entry.name),
    });
  }
  return packages.sort((a, b) => a.directoryName.localeCompare(b.directoryName));
}

function validateCoreExports(appRoot, relRoot) {
  const issues = [];
  for (const core of findCorePackages(appRoot)) {
    const relCore = `${relRoot}/packages/${core.packageName}`;
    issues.push(...validateCoreCompositionLayout(core, relCore));
  }
  return issues;
}

function validateRoleDependencyDirection(packages, relRoot) {
  const issues = [];
  const capabilityNames = new Set(
    packages
      .filter((pkg) => pkg.role === 'capability')
      .map((pkg) => pkg.name),
  );

  for (const pkg of packages) {
    const deps = packageDependencies(pkg.packageJson);
    if (pkg.role === 'core' || pkg.role === 'commons') {
      for (const dep of deps) {
        if (capabilityNames.has(dep)) {
          issues.push(`${relRoot}/packages/${pkg.directoryName}: ${pkg.role} package must not depend on capability package ${dep}`);
        }
      }
    }

    if (pkg.role === 'host') {
      for (const dep of deps) {
        if (BUSINESS_SDK_PACKAGE_RE.test(dep)) {
          issues.push(`${relRoot}/packages/${pkg.directoryName}: host package must not depend on business SDK ${dep}`);
        }
      }
    }
  }

  return issues;
}

function validateFeatureSdkImports(packages, repoRoot) {
  const issues = [];
  for (const pkg of packages) {
    if (pkg.role !== 'capability') continue;
    const srcRoot = fs.existsSync(path.join(pkg.packageDir, 'src'))
      ? path.join(pkg.packageDir, 'src')
      : path.join(pkg.packageDir, 'lib');
    for (const filePath of listSourceFiles(srcRoot)) {
      const source = readText(filePath);
      for (const specifier of extractImportSpecifiers(source)) {
        if (!DIRECT_SDK_IMPORT_RE.test(specifier)) continue;
        issues.push(`${toPosix(path.relative(repoRoot, filePath))}: feature package must not import generated SDK module ${specifier}; import SDK/service ports through core public exports`);
      }
    }
  }
  return issues;
}

export function validateFrontendComposition(repoRoot) {
  const issues = [];
  const clientRoots = listFrontendAppRoots(repoRoot);
  for (const clientRoot of clientRoots) {
    const relRoot = toPosix(path.relative(repoRoot, clientRoot.appRoot));
    const packages = listPackages(clientRoot.appRoot);
    issues.push(...validateCoreExports(clientRoot.appRoot, relRoot));
    issues.push(...validateRoleDependencyDirection(packages, relRoot));
    issues.push(...validateFeatureSdkImports(packages, repoRoot));
  }
  return issues;
}

export function listFrontendPackages(appRoot) {
  return listPackages(appRoot);
}

export function listFrontendAppRoots(repoRoot) {
  const roots = new Map();
  for (const root of listClientAppRoots(repoRoot)) {
    roots.set(root.appRoot, root);
  }

  const appsDir = path.join(repoRoot, 'apps');
  if (fs.existsSync(appsDir)) {
    for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const architecture = detectClientArchitecture(entry.name);
      if (!architecture) continue;
      const appRoot = path.join(appsDir, entry.name);
      if (!fs.existsSync(path.join(appRoot, 'agent.app.config.json'))) continue;
      if (!fs.existsSync(path.join(appRoot, 'packages'))) continue;
      if (!roots.has(appRoot)) {
        roots.set(appRoot, { appRoot, appRootName: entry.name, architecture });
      }
    }
  }

  return [...roots.values()].sort((a, b) => a.appRootName.localeCompare(b.appRootName));
}
