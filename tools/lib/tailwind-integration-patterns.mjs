import fs from 'node:fs';
import path from 'node:path';

export function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
  return JSON.parse(raw);
}

export function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const TAILWIND_IMPORT_PATTERN = /@import\s+["']tailwindcss["']\s*;/;
const TAILWIND_VITE_ALIAS_PATTERN = /find:\s*['"]tailwindcss['"]/;
const TAILWIND_HARDCODED_NODE_MODULES_PATTERN = /node_modules[/\\]tailwindcss/;
const TAILWIND_VITE_PLUGIN_PATTERN = /@tailwindcss\/vite/;

const REQUIRED_TAILWIND_DEPENDENCIES = ['tailwindcss', '@tailwindcss/vite'];

const SKIP_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'external',
  'target',
  '.runtime',
  '.turbo',
  'coverage',
]);

export const TAILWIND_BOOTSTRAP_ALLOWLIST = [
  /^apps\/[^/]+\/src\/index\.css$/u,
  /^src\/index\.css$/u,
  /(?:^|\/)sdkwork-ui-pc-react\/src\/styles\/[^/]+\.css$/u,
  /(?:^|\/)packages\/[^/]+-shell\/src\/styles\/index\.css$/u,
  /(?:^|\/)packages\/sdkwork-autocut-desktop\/src\/index\.css$/u,
];

// The UI library owns the shared `src/styles/*.css` sheet, so it is exempt from
// the app-level dependency-section rule. The pattern must accept a repository
// root child path (`sdkwork-ui-pc-react/package.json`, no leading slash) as well
// as a nested one — the same `(?:^|/)` prefix the bootstrap allowlist uses.
export const TAILWIND_UI_LIBRARY_PACKAGE_PATTERN = /(?:^|\/)sdkwork-ui-pc-react\/package\.json$/u;

export function normalizePosixPath(value) {
  return value.replace(/\\/g, '/');
}

export function isTailwindBootstrapAllowed(relativePath) {
  const normalized = normalizePosixPath(relativePath);
  return TAILWIND_BOOTSTRAP_ALLOWLIST.some((pattern) => pattern.test(normalized));
}

export function isUiLibraryPackage(relativePackageJsonPath) {
  return TAILWIND_UI_LIBRARY_PACKAGE_PATTERN.test(normalizePosixPath(relativePackageJsonPath));
}

export function findTailwindImports(cssSource) {
  return [...cssSource.matchAll(/@import\s+["']tailwindcss["']\s*;/g)].map((match) => match.index ?? 0);
}

export function classifyCssTailwindBootstrap(relativePath, cssSource) {
  if (findTailwindImports(cssSource).length === 0) {
    return [];
  }
  if (isTailwindBootstrapAllowed(normalizePosixPath(relativePath))) {
    return [];
  }
  return [{
    kind: 'forbidden-feature-bootstrap',
    detail: `${normalizePosixPath(relativePath)} must not @import "tailwindcss"; host shell or standalone app index.css owns the single bootstrap`,
  }];
}

function isShellPackage(relativePackageJsonPath) {
  return /(?:^|\/)packages\/[^/]+-shell\/package\.json$/u.test(normalizePosixPath(relativePackageJsonPath));
}

export function classifyViteTailwindConfig(relativePath, source) {
  const issues = [];
  const normalizedPath = normalizePosixPath(relativePath);
  if (TAILWIND_HARDCODED_NODE_MODULES_PATTERN.test(source)) {
    issues.push({
      kind: 'hardcoded-tailwind-node-modules',
      detail: `${normalizedPath} must not hard-code node_modules/tailwindcss paths`,
    });
  }
  if (TAILWIND_VITE_ALIAS_PATTERN.test(source)) {
    issues.push({
      kind: 'deprecated-tailwind-vite-alias',
      detail: `${normalizedPath} must not alias bare specifier tailwindcss; use single shell bootstrap per TAILWIND_CSS_INTEGRATION_SPEC.md`,
    });
  }
  return issues;
}

function packageUsesTailwindVitePlugin(packageDir) {
  const viteConfigs = fs.readdirSync(packageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^vite\.config\.(?:ts|mts|js|mjs)$/u.test(entry.name))
    .map((entry) => path.join(packageDir, entry.name));
  return viteConfigs.some((viteConfigPath) => {
    const source = fs.readFileSync(viteConfigPath, 'utf8');
    return TAILWIND_VITE_PLUGIN_PATTERN.test(source) || /createBirdcoderVitePlugins|createSdkwork.*VitePlugins/u.test(source);
  });
}

function packageOwnsTailwindBootstrap(packageDir, relativePackageJsonPath) {
  const indexCssPath = path.join(packageDir, 'src', 'index.css');
  if (fs.existsSync(indexCssPath) && TAILWIND_IMPORT_PATTERN.test(fs.readFileSync(indexCssPath, 'utf8'))) {
    return true;
  }

  const shellCssPath = path.join(packageDir, 'src', 'styles', 'index.css');
  if (fs.existsSync(shellCssPath) && TAILWIND_IMPORT_PATTERN.test(fs.readFileSync(shellCssPath, 'utf8'))) {
    return true;
  }

  if (packageUsesTailwindVitePlugin(packageDir)) {
    return true;
  }

  return false;
}

export function classifyAppTailwindDependencies(relativePath, packageJson, packageDir = null) {
  const issues = [];
  const normalizedPath = normalizePosixPath(relativePath);
  if (isUiLibraryPackage(normalizedPath) || isShellPackage(normalizedPath)) {
    return issues;
  }

  const resolvedPackageDir = packageDir ?? path.dirname(path.resolve(relativePath));
  if (!packageOwnsTailwindBootstrap(resolvedPackageDir, normalizedPath)) {
    return issues;
  }

  const dependencies = packageJson.dependencies ?? {};
  const devDependencies = packageJson.devDependencies ?? {};

  for (const dependencyName of REQUIRED_TAILWIND_DEPENDENCIES) {
    if (dependencies[dependencyName]) {
      continue;
    }
    if (devDependencies[dependencyName]) {
      issues.push({
        kind: 'tailwind-dependency-section',
        detail: `${normalizedPath} must declare ${dependencyName} in dependencies, not devDependencies`,
      });
      continue;
    }
    issues.push({
      kind: 'missing-tailwind-dependency',
      detail: `${normalizedPath} owns Tailwind bootstrap but does not declare ${dependencyName}`,
    });
  }
  return issues;
}

export function alignTailwindDependencies(packageJson) {
  const next = structuredClone(packageJson);
  next.dependencies ??= {};
  next.devDependencies ??= {};
  let changed = false;

  for (const dependencyName of REQUIRED_TAILWIND_DEPENDENCIES) {
    const devVersion = next.devDependencies[dependencyName];
    if (!devVersion || next.dependencies[dependencyName]) {
      continue;
    }
    next.dependencies[dependencyName] = devVersion;
    delete next.devDependencies[dependencyName];
    changed = true;
  }

  return { packageJson: next, changed };
}

export function shouldSkipDirectory(name) {
  return SKIP_DIRECTORY_NAMES.has(name);
}

export function walkFiles(rootDir, predicate) {
  const results = [];
  if (!fs.existsSync(rootDir)) {
    return results;
  }
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (shouldSkipDirectory(entry.name)) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (predicate(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

export function scanRepositoryTailwindIntegration(repoRoot) {
  const issues = [];
  const cssFiles = walkFiles(repoRoot, (filePath) => filePath.endsWith('.css'));
  for (const cssFile of cssFiles) {
    const relativePath = path.relative(repoRoot, cssFile);
    const cssSource = fs.readFileSync(cssFile, 'utf8');
    issues.push(...classifyCssTailwindBootstrap(relativePath, cssSource));
  }

  const viteConfigs = walkFiles(repoRoot, (filePath) => /vite\.config\.(?:ts|mts|js|mjs)$/u.test(filePath));
  for (const viteConfig of viteConfigs) {
    const relativePath = path.relative(repoRoot, viteConfig);
    const source = fs.readFileSync(viteConfig, 'utf8');
    issues.push(...classifyViteTailwindConfig(relativePath, source));
  }

  const packageJsonFiles = walkFiles(repoRoot, (filePath) => filePath.endsWith('package.json'));
  for (const packageJsonPath of packageJsonFiles) {
    const relativePath = path.relative(repoRoot, packageJsonPath);
    const packageJson = readJsonFile(packageJsonPath);
    issues.push(...classifyAppTailwindDependencies(relativePath, packageJson, path.dirname(packageJsonPath)));
  }

  return issues;
}

export function alignRepositoryTailwindIntegration(repoRoot) {
  const changedFiles = [];
  const packageJsonFiles = walkFiles(repoRoot, (filePath) => filePath.endsWith('package.json'));
  for (const packageJsonPath of packageJsonFiles) {
    const relativePath = normalizePosixPath(path.relative(repoRoot, packageJsonPath));
    const packageJson = readJsonFile(packageJsonPath);
    if (isUiLibraryPackage(relativePath) || isShellPackage(relativePath)) {
      continue;
    }
    if (!packageOwnsTailwindBootstrap(path.dirname(packageJsonPath), relativePath)) {
      continue;
    }
    const { packageJson: aligned, changed } = alignTailwindDependencies(packageJson);
    if (!changed) {
      continue;
    }
    writeJsonFile(packageJsonPath, aligned);
    changedFiles.push(relativePath);
  }
  return changedFiles;
}
