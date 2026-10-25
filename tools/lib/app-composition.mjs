#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

export const CLIENT_ARCHITECTURES = [
  { suffix: '-pc-react', id: 'pc', coreRole: 'pc-core', corePattern: /-pc-core$/ },
  { suffix: '-pc', id: 'pc', coreRole: 'pc-core', corePattern: /-pc-core$/ },
  { suffix: '-h5', id: 'h5', coreRole: 'h5-core', corePattern: /-h5-core$/ },
  { suffix: '-flutter-mobile', id: 'flutter-mobile', coreRole: 'flutter_mobile_core', corePattern: /_flutter_mobile_core$/ },
  { suffix: '-mini-program', id: 'mp', coreRole: 'mp-core', corePattern: /-mp-core$/ },
  { suffix: '-android-mobile', id: 'android-mobile', coreRole: 'android-mobile-core', corePattern: /-android-mobile-core$/ },
  { suffix: '-ios-mobile', id: 'ios-mobile', coreRole: 'ios-mobile-core', corePattern: /-ios-mobile-core$/ },
  { suffix: '-harmony-mobile', id: 'harmony-mobile', coreRole: 'harmony-mobile-core', corePattern: /-harmony-mobile-core$/ },
];

export const CREDENTIAL_MODES = new Set([
  'authenticated-app-api',
  'authenticated-backend-admin',
  'protected-open-api-api-key',
  'protected-open-api-oauth',
  'protected-open-api-flexible',
  'protected-open-api-api-key-or-dual-token',
  'public-open-api',
  'local-native',
  'test-fake',
]);

export const CORE_EXPORT_SUBPATHS = ['.', './sdk', './modules', './host', './session', './composition'];

const FORBIDDEN_CAPABILITY_SDK_IMPORT_PATTERNS = [
  /^sdkwork-[^/]+-generated-/u,
  /^@sdkwork\/iam-app-sdk/u,
  /^@sdkwork\/iam-backend-sdk/u,
];

export function toPosix(filePath) {
  return filePath.replaceAll(path.sep, '/');
}

export function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
  return JSON.parse(raw);
}

export function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

export function detectClientArchitecture(appRootName) {
  for (const entry of CLIENT_ARCHITECTURES) {
    if (appRootName.endsWith(entry.suffix)) return entry;
  }
  return null;
}

export function listClientAppRoots(repoRoot) {
  const roots = [];
  const appsDir = path.join(repoRoot, 'apps');
  if (fs.existsSync(appsDir)) {
    for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const arch = detectClientArchitecture(entry.name);
      if (!arch) continue;
      const appRoot = path.join(appsDir, entry.name);
      if (qualifiesAsClientAppRoot(appRoot)) {
        roots.push({ appRoot, appRootName: entry.name, architecture: arch });
      }
    }
  }

  const repoName = path.basename(repoRoot);
  const arch = detectClientArchitecture(repoName);
  if (arch && qualifiesAsClientAppRoot(repoRoot)) {
    roots.push({ appRoot: repoRoot, appRootName: repoName, architecture: arch });
  }

  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'apps' || entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.name.startsWith('.')) continue;
    const siblingArch = detectClientArchitecture(entry.name);
    if (!siblingArch) continue;
    const appRoot = path.join(repoRoot, entry.name);
    if (!qualifiesAsClientAppRoot(appRoot)) continue;
    if (roots.some((root) => root.appRoot === appRoot)) continue;
    roots.push({ appRoot, appRootName: entry.name, architecture: siblingArch });
  }

  return roots;
}

export function isCorePackageDirectory(name) {
  if (/-(?:console-core|admin-core)$/.test(name)) return true;
  if (/_flutter_mobile_(?:console_core|admin_core|core)$/.test(name)) return true;
  if (/-core$/.test(name) && !/-host-core$/.test(name)) return true;
  return false;
}

export function findCorePackages(appRoot) {
  const packagesDir = path.join(appRoot, 'packages');
  if (!fs.existsSync(packagesDir)) return [];

  const cores = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isCorePackageDirectory(entry.name)) continue;
    const packageDir = path.join(packagesDir, entry.name);
    const componentSpecPath = path.join(packageDir, 'specs/component.spec.json');
    const packageJsonPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(packageJsonPath) && !fs.existsSync(componentSpecPath)) continue;
    const packageJson = fs.existsSync(packageJsonPath) ? readJson(packageJsonPath) : null;
    const componentSpec = fs.existsSync(componentSpecPath)
      ? readJson(componentSpecPath)
      : { component: { name: packageJson?.name ?? entry.name }, contracts: {} };

    let surface = 'app';
    if (/-console-core$/.test(entry.name) || /_console_core$/.test(entry.name)) surface = 'console';
    else if (/-admin-core$/.test(entry.name) || /_admin_core$/.test(entry.name)) surface = 'backend-admin';

    cores.push({
      surface,
      packageDir,
      packageName: entry.name,
      componentName: componentSpec.component?.name ?? packageJson?.name ?? entry.name,
      componentSpec,
      componentSpecPath,
      packageJson,
    });
  }

  return cores.sort((a, b) => a.surface.localeCompare(b.surface));
}

export function normalizeSdkDependencies(componentSpec) {
  const deps = componentSpec?.contracts?.sdkDependencies ?? [];
  return deps.map((item) => {
    if (typeof item === 'string') return { workspace: item };
    const workspace = item.workspace ?? item.sdkFamily ?? null;
    return workspace ? { ...item, workspace } : item;
  }).filter((item) => item.workspace);
}

export function isCompositionConsumerExempt(componentSpec) {
  return componentSpec?.composition?.consumerIntegrationsExempt === true;
}

export function isCompositionExemptRepo(repoRoot) {
  const readmePath = path.join(repoRoot, 'README.md');
  if (fs.existsSync(readmePath) && /^repository-kind:\s*standards\s*$/imu.test(readText(readmePath))) {
    return true;
  }

  const repoName = path.basename(repoRoot);
  if (repoName === 'sdkwork-web-framework') return true;
  const repoSpec = fs.existsSync(path.join(repoRoot, 'specs/component.spec.json'))
    ? readJson(path.join(repoRoot, 'specs/component.spec.json'))
    : null;
  if (!repoSpec) return false;
  if (isCompositionConsumerExempt(repoSpec)) return true;
  const capability = repoSpec.component?.capability ?? '';
  const type = repoSpec.component?.type ?? '';
  return type === 'rust-workspace' && capability === 'web-framework';
}

export function validateCoreCompositionLayout(core, relPrefix) {
  const issues = [];
  const srcRoot = fs.existsSync(path.join(core.packageDir, 'src'))
    ? path.join(core.packageDir, 'src')
    : path.join(core.packageDir, 'lib');
  const compositionDir = path.join(srcRoot, 'composition');
  const altCompositionDir = path.join(core.packageDir, 'lib/composition');
  if (!fs.existsSync(compositionDir) && !fs.existsSync(altCompositionDir)) {
    issues.push(`${relPrefix}: core package ${core.componentName} missing src/composition/ or lib/composition/`);
  }

  if (fs.existsSync(path.join(core.packageDir, 'pubspec.yaml'))) return issues;

  if (core.packageJson?.exports && typeof core.packageJson.exports === 'object') {
    for (const subpath of CORE_EXPORT_SUBPATHS) {
      if (!(subpath in core.packageJson.exports)) {
        issues.push(`${relPrefix}: core package ${core.componentName} missing package.json exports[${JSON.stringify(subpath)}]`);
      }
    }
  } else if (!fs.existsSync(path.join(core.packageDir, 'package.json'))) {
    issues.push(`${relPrefix}: core package ${core.componentName} missing package.json or pubspec.yaml`);
  }

  return issues;
}

export function validateSdkDependenciesContract(core, relPrefix) {
  const issues = [];
  const deps = normalizeSdkDependencies(core.componentSpec);
  for (const dep of deps) {
    if (!dep.workspace) {
      issues.push(`${relPrefix}: sdkDependencies entry missing workspace in ${core.componentName}`);
      continue;
    }
    if (dep.credentialMode && !CREDENTIAL_MODES.has(dep.credentialMode)) {
      issues.push(`${relPrefix}: invalid credentialMode for ${dep.workspace} in ${core.componentName}`);
    }
    const surface = dep.surface ?? 'app-api';
    if (surface === 'backend-api' && core.surface !== 'backend-admin') {
      issues.push(`${relPrefix}: backend-api SDK ${dep.workspace} must not appear in ${core.surface} core ${core.componentName}`);
    }
    if (surface === 'app-api' && core.surface === 'backend-admin') {
      issues.push(`${relPrefix}: app-api SDK ${dep.workspace} must not appear in backend-admin core ${core.componentName}`);
    }
  }
  return issues;
}

export function isRuntimeIntegrationPackageDirectory(name) {
  return /-commons$/u.test(name);
}

export function isBackendAdminSdkPackageDirectory(name) {
  return /-(?:pc|h5|mp|android-mobile|ios-mobile|harmony-mobile)-admin-sdk$/u.test(name)
    || /_flutter_mobile_admin_sdk$/u.test(name);
}

export function isCapabilityPackageDirectory(name) {
  if (isCorePackageDirectory(name)) return false;
  if (isBackendAdminSdkPackageDirectory(name)) return false;
  if (/-(?:shell|host)$/.test(name)) return false;
  if (isRuntimeIntegrationPackageDirectory(name)) return false;
  return true;
}

export function isForbiddenCapabilitySdkImport(moduleSpecifier) {
  return FORBIDDEN_CAPABILITY_SDK_IMPORT_PATTERNS.some((pattern) => pattern.test(moduleSpecifier));
}

function listTypeScriptSourceFiles(rootDir) {
  const files = [];
  if (!fs.existsSync(rootDir)) return files;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...listTypeScriptSourceFiles(entryPath));
      continue;
    }
    if (/\.(?:ts|tsx)$/u.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(entryPath);
    }
  }
  return files;
}

export function extractImportSpecifiers(sourceText) {
  const specifiers = [];
  const importRe = /import\s+(?:type\s+)?(?:\{[^}]*\}|[^"';\s]+)\s+from\s+["']([^"']+)["']/gu;
  let match = importRe.exec(sourceText);
  while (match) {
    specifiers.push(match[1]);
    match = importRe.exec(sourceText);
  }
  const sideEffectRe = /import\s+["']([^"']+)["']/gu;
  match = sideEffectRe.exec(sourceText);
  while (match) {
    specifiers.push(match[1]);
    match = sideEffectRe.exec(sourceText);
  }
  return specifiers;
}

function parsePackageNameFromSpecifier(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('#')) return null;
  if (specifier.startsWith('node:')) return null;
  if (specifier.startsWith('@')) {
    const segments = specifier.split('/');
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : specifier;
  }
  return specifier.split('/')[0];
}

function declaredDependencyNames(packageJson) {
  if (!packageJson) return new Set();
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);
}

function listWorkspacePackageDirs(repoRoot) {
  const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspacePath)) return [];

  const text = readText(workspacePath);
  const packageEntries = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/u)) {
    if (/^packages:\s*$/u.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^[A-Za-z0-9_./-]+:\s*$/u.test(line) && !line.startsWith(' ')) {
      break;
    }
    const match = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/u);
    if (inPackages && match) packageEntries.push(match[1]);
  }

  const dirs = new Set();
  for (const entry of packageEntries) {
    if (entry.startsWith('../')) continue;
    if (entry.includes('*')) {
      const base = path.resolve(repoRoot, entry.replace(/\/?\*+$/u, ''));
      if (!base.startsWith(path.resolve(repoRoot)) || !fs.existsSync(base)) continue;
      for (const child of fs.readdirSync(base, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        dirs.add(path.join(base, child.name));
      }
      continue;
    }
    const resolved = path.resolve(repoRoot, entry);
    if (!resolved.startsWith(path.resolve(repoRoot))) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      dirs.add(resolved);
    }
  }
  return [...dirs];
}

export function validatePackageImportClosure(repoRoot) {
  const issues = [];
  for (const packageDir of listWorkspacePackageDirs(repoRoot)) {
    const packageJsonPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) continue;
    const packageJson = readJson(packageJsonPath);
    const packageName = packageJson.name;
    if (!packageName) continue;

    const declared = declaredDependencyNames(packageJson);
    const srcDir = fs.existsSync(path.join(packageDir, 'src'))
      ? path.join(packageDir, 'src')
      : path.join(packageDir, 'lib');
    for (const filePath of listTypeScriptSourceFiles(srcDir)) {
      const source = readText(filePath);
      for (const specifier of extractImportSpecifiers(source)) {
        const depName = parsePackageNameFromSpecifier(specifier);
        if (!depName || depName === packageName) continue;
        if (declared.has(depName)) continue;
        issues.push(
          `${toPosix(path.relative(repoRoot, filePath))}: import ${specifier} missing from ${toPosix(path.relative(repoRoot, packageJsonPath))} dependencies/peerDependencies/devDependencies`,
        );
      }
    }
  }
  return issues;
}

const CROSS_PACKAGE_RELATIVE_IMPORT_RE = /\.\.(?:\/|\\)[^"'`]*?(?:packages\/(?:sdkwork-[^/\\]+|@sdkwork[^/\\]*)|[a-z0-9@][^"'`]*?-pc-[a-z0-9-]+(?:\/|\\))[^"'`]*?\/src(?:\/|\\|$)/iu;

export function validateCrossPackageRelativeImports(repoRoot) {
  const issues = [];
  const packagesDir = path.join(repoRoot, 'apps');
  const roots = [];
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const appPackages = path.join(packagesDir, entry.name, 'packages');
      if (fs.existsSync(appPackages)) roots.push(appPackages);
    }
  }
  const hybridPackages = path.join(repoRoot, 'packages');
  if (fs.existsSync(hybridPackages)) roots.push(hybridPackages);

  for (const root of roots) {
    for (const filePath of listTypeScriptSourceFiles(root)) {
      const source = readText(filePath);
      for (const specifier of extractImportSpecifiers(source)) {
        if (!specifier.startsWith('.')) continue;
        if (CROSS_PACKAGE_RELATIVE_IMPORT_RE.test(specifier)) {
          issues.push(
            `${toPosix(path.relative(repoRoot, filePath))}: cross-package relative import ${specifier} must use workspace package exports`,
          );
        }
        if (/\.\.(?:\/|\\)\.\.(?:\/|\\)\.\.(?:\/|\\)src(?:\/|\\|$)/u.test(specifier)) {
          issues.push(
            `${toPosix(path.relative(repoRoot, filePath))}: package must not import app-root src via ${specifier}`,
          );
        }
      }
    }
  }
  return issues;
}

export function validateCapabilitySdkImportBoundary(appRoot, relPrefix) {
  const issues = [];
  const packagesDir = path.join(appRoot, 'packages');
  if (!fs.existsSync(packagesDir)) return issues;

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isCapabilityPackageDirectory(entry.name)) continue;
    const packageDir = path.join(packagesDir, entry.name);
    const srcDir = fs.existsSync(path.join(packageDir, 'src'))
      ? path.join(packageDir, 'src')
      : path.join(packageDir, 'lib');
    for (const filePath of listTypeScriptSourceFiles(srcDir)) {
      const source = readText(filePath);
      for (const specifier of extractImportSpecifiers(source)) {
        if (!isForbiddenCapabilitySdkImport(specifier)) continue;
        issues.push(`${relPrefix}/packages/${entry.name}/${toPosix(path.relative(packageDir, filePath))}: capability package must not import generated SDK module ${specifier}`);
      }
    }
  }

  return issues;
}

export function findForbiddenCompositionArtifacts(repoRoot) {
  const issues = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name === 'dependency.composition.json') {
        issues.push(`${toPosix(path.relative(repoRoot, full))}: forbidden parallel composition manifest`);
      }
    }
  };
  if (fs.existsSync(repoRoot)) walk(repoRoot);
  return issues;
}

export function findNestedAppWorkspaces(repoRoot) {
  const issues = [];
  const appsDir = path.join(repoRoot, 'apps');
  if (!fs.existsSync(appsDir)) return issues;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name === 'pnpm-workspace.yaml') {
        issues.push(`${toPosix(path.relative(repoRoot, full))}: nested app-level pnpm-workspace.yaml is forbidden`);
      }
    }
  };
  walk(appsDir);
  return issues;
}

const NON_ROOT_WORKSPACE_ALLOWLIST_SEGMENTS = [
  `${path.sep}external${path.sep}`,
  `${path.sep}.devcontainer${path.sep}`,
  `${path.sep}.runtime${path.sep}`,
];

function qualifiesAsClientAppRoot(appRoot) {
  if (!fs.existsSync(path.join(appRoot, 'agent.app.config.json'))) return false;
  return findCorePackages(appRoot).length > 0;
}

export function findNonRootPnpmWorkspaces(repoRoot) {
  const issues = [];
  const rootWorkspacePath = path.resolve(path.join(repoRoot, 'pnpm-workspace.yaml'));
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'pnpm-workspace.yaml') continue;
      if (path.resolve(full) === rootWorkspacePath) continue;
      const rel = toPosix(path.relative(repoRoot, full));
      if (NON_ROOT_WORKSPACE_ALLOWLIST_SEGMENTS.some((segment) => full.includes(segment))) continue;
      issues.push(`${rel}: non-root pnpm-workspace.yaml is forbidden; declare sibling packages at repository root only`);
    }
  };
  if (fs.existsSync(repoRoot)) walk(repoRoot);
  return issues;
}

export function findDependencyCompositionFieldViolations(repoRoot) {
  const issues = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'component.spec.json') continue;
      const spec = readJson(full);
      if (spec.contracts?.dependencyComposition) {
        issues.push(`${toPosix(path.relative(repoRoot, full))}: contracts.dependencyComposition is forbidden`);
      }
    }
  };
  if (fs.existsSync(repoRoot)) walk(repoRoot);
  return issues;
}

export function hasClientAppSurfaceDirectories(repoRoot) {
  const appsDir = path.join(repoRoot, 'apps');
  if (!fs.existsSync(appsDir)) return false;
  for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (detectClientArchitecture(entry.name)) return true;
  }
  return false;
}

export function validateBackendReleaseComposition(repoRoot) {
  const issues = [];
  const manifestPath = path.join(repoRoot, 'agent.app.config.json');
  if (!fs.existsSync(manifestPath)) return issues;

  const clientRoots = listClientAppRoots(repoRoot);
  if (clientRoots.length > 0 || hasClientAppSurfaceDirectories(repoRoot)) return issues;

  const manifest = readJson(manifestPath);
  if (!manifest.backend) return issues;

  if (manifest.schemaVersion >= 3) {
    const componentSpecPath = path.join(repoRoot, 'specs/component.spec.json');
    const componentSpec = fs.existsSync(componentSpecPath)
      ? readJson(componentSpecPath)
      : null;
    if (!Array.isArray(componentSpec?.contracts?.sdkDependencies)) {
      issues.push(
        'specs/component.spec.json#contracts.sdkDependencies required for backend-only App Standard v3 roots',
      );
    }
  } else if (!Array.isArray(manifest.sdkDependencies)) {
    issues.push(
      'agent.app.config.json#sdkDependencies required for legacy backend-only application roots',
    );
  }
  return issues;
}

export function validateRepoPackageScripts(repoRoot) {
  const issues = [];
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return issues;

  const pkg = readJson(packageJsonPath);
  const scripts = JSON.stringify(pkg.scripts ?? {});
  if (scripts.includes('check-dependency-composition.mjs')) {
    issues.push(
      'package.json references deleted check-dependency-composition.mjs; use check:app-composition with verify-repo.mjs',
    );
  }
  return issues;
}

export function validateAppComposition(repoRoot, options = {}) {
  const strictImportClosure = options.strictImportClosure
    ?? process.env.VERIFY_IMPORT_CLOSURE_STRICT === '1';
  const issues = [];
  issues.push(...findForbiddenCompositionArtifacts(repoRoot));
  issues.push(...findNestedAppWorkspaces(repoRoot));
  issues.push(...findNonRootPnpmWorkspaces(repoRoot));
  issues.push(...findDependencyCompositionFieldViolations(repoRoot));
  issues.push(...validateBackendReleaseComposition(repoRoot));
  issues.push(...validateRepoPackageScripts(repoRoot));
  issues.push(...validateCrossPackageRelativeImports(repoRoot));
  if (strictImportClosure) {
    issues.push(...validatePackageImportClosure(repoRoot));
  }

  for (const clientRoot of listClientAppRoots(repoRoot)) {
    const relRoot = toPosix(path.relative(repoRoot, clientRoot.appRoot));
    const cores = findCorePackages(clientRoot.appRoot);
    if (cores.length === 0) {
      issues.push(`${relRoot}: client app root missing core package`);
      continue;
    }
    for (const core of cores) {
      const relCore = `${relRoot}/packages/${core.packageName}`;
      issues.push(...validateCoreCompositionLayout(core, relCore));
      issues.push(...validateSdkDependenciesContract(core, relCore));
    }
    issues.push(...validateCapabilitySdkImportBoundary(clientRoot.appRoot, relRoot));
  }

  return issues;
}
