import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The specs repository root owns the renderer scope file, so this module resolves it
// from its own location rather than from the repository under validation.
const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.runtime',
  '.turbo',
  'coverage',
  'dist',
  'external',
  'generated',
  'node_modules',
  'target',
]);

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const IAM_CONSUMER_MARKERS = [
  '@sdkwork/iam-app-sdk',
  '@sdkwork/iam-credential-entry',
  'createSdkworkAppbasePcAuthRuntime',
  'wrapCredentialEntryClient',
];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
}

function walkFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && predicate(entryPath)) files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function relative(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function findApplicationRoot(filePath, repositoryRoot) {
  let current = path.dirname(filePath);
  while (current.startsWith(repositoryRoot)) {
    if (fs.existsSync(path.join(current, 'sdkwork.app.config.json'))) return current;
    if (current === repositoryRoot) break;
    current = path.dirname(current);
  }
  return path.dirname(filePath);
}

function sourceFiles(root) {
  return walkFiles(root, (filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath)));
}

function moduleSourceFiles(moduleRoot) {
  const sourceRoot = path.join(moduleRoot, 'src');
  return sourceFiles(sourceRoot);
}

function moduleConsumesIam(moduleRoot) {
  return moduleSourceFiles(moduleRoot).some((filePath) => {
    const source = readText(filePath);
    return IAM_CONSUMER_MARKERS.some((marker) => source.includes(marker));
  });
}

function readPackageManifest(moduleRoot) {
  const manifestPath = path.join(moduleRoot, 'package.json');
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    return JSON.parse(readText(manifestPath));
  } catch {
    return undefined;
  }
}

function moduleDeclaresCredentialEntryDependency(moduleRoot) {
  const manifest = readPackageManifest(moduleRoot);
  if (!manifest) return false;
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .some((field) => Object.hasOwn(manifest[field] ?? {}, '@sdkwork/iam-credential-entry'));
}

function isExecutableRenderer(moduleRoot) {
  if (fs.existsSync(path.join(moduleRoot, 'index.html'))) return true;
  const scripts = readPackageManifest(moduleRoot)?.scripts ?? {};
  return Object.entries(scripts).some(([name, command]) => (
    /^(?:serve|start(?::(?:browser|desktop|h5|renderer|web)(?::.+)?)?)$/u.test(name)
    && typeof command === 'string'
    && /(?:vite|run-vite-host)/u.test(command)
  ));
}

// A Vite config is in scope whenever it belongs to an executable renderer.
//
// `IAM_CREDENTIAL_ENTRY_SPEC.md` section 6 requires every host app Vite config to
// consume `@sdkwork/iam-credential-entry/vite`. Predicating the check on an
// existing IAM marker (`moduleConsumesIam`) inverted the requirement: the one
// class of host that has never wired credential entry -- exactly the class the
// rule exists to catch -- was the only class excluded from the check. A renderer
// that consumes no IAM marker yet still dispatches protected operations therefore
// reported a green gate while failing at runtime with
// `non-open-api request requires Access-Token before request dispatch`.
//
// Scope widening is staged through `credential-entry-renderer-scope.json`: repos
// enumerated there are fully enforced, so widening the predicate does not turn the
// workspace red for debt owned by repos that have not migrated. Repos outside the
// list keep the historical marker-gated behaviour.
function readRendererScope() {
  const scopePath = path.join(SPECS_ROOT, 'credential-entry-renderer-scope.json');
  if (!fs.existsSync(scopePath)) return undefined;
  try {
    const scope = JSON.parse(readText(scopePath));
    return Array.isArray(scope.repositories) ? scope.repositories : undefined;
  } catch {
    return undefined;
  }
}

// Scope entries are workspace-relative paths, so the repository name is the first
// path segment. A bare repository name covers every renderer beneath it; a deeper
// entry covers only that subtree. Both forms are compared against the module path
// relative to the workspace root, which keeps a single comparison rule.
function isEnforcedRenderer(repositoryRoot, moduleRoot) {
  if (/[/\\]external[/\\]/u.test(moduleRoot)) return false;
  const scope = readRendererScope();
  if (scope === undefined) return false;
  const resolvedRoot = path.resolve(repositoryRoot);
  const workspaceRoot = path.dirname(resolvedRoot);
  const relativeModule = path.relative(workspaceRoot, moduleRoot).replaceAll(path.sep, '/');
  return scope.some((entry) => {
    const normalized = String(entry).replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
    if (normalized.length === 0) return false;
    return relativeModule === normalized || relativeModule.startsWith(`${normalized}/`);
  });
}

function isCredentialEntryViteConsumer(viteConfigPath, repositoryRoot) {
  const moduleRoot = path.dirname(viteConfigPath);
  const source = readText(viteConfigPath);
  if (source.includes('iam-credential-entry')
    || source.includes('createSdkworkCredentialEntryBootstrapVitePlugin')
    || moduleDeclaresCredentialEntryDependency(moduleRoot)) {
    return true;
  }
  if (!isExecutableRenderer(moduleRoot)) return false;
  return moduleConsumesIam(moduleRoot)
    || isEnforcedRenderer(repositoryRoot, moduleRoot);
}

function resolveLocalImportPath(importerPath, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const unresolved = path.resolve(path.dirname(importerPath), specifier);
  for (const candidate of [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.mjs`,
    `${unresolved}.js`,
    path.join(unresolved, 'index.ts'),
    path.join(unresolved, 'index.mjs'),
    path.join(unresolved, 'index.js'),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function readLocalViteComposition(entryPath, visited = new Set()) {
  const resolvedEntryPath = path.resolve(entryPath);
  if (visited.has(resolvedEntryPath)) return '';
  visited.add(resolvedEntryPath);

  const source = readText(resolvedEntryPath);
  const importedSources = [];
  const staticImportPattern = /\bfrom\s+['"](?<specifier>\.{1,2}\/[^'"]+)['"]/gu;
  for (const match of source.matchAll(staticImportPattern)) {
    const importedPath = resolveLocalImportPath(
      resolvedEntryPath,
      match.groups?.specifier ?? '',
    );
    if (importedPath) {
      importedSources.push(readLocalViteComposition(importedPath, visited));
    }
  }
  return [source, ...importedSources].join('\n');
}

function validateViteConsumer(repositoryRoot, viteConfigPath) {
  const source = readText(viteConfigPath);
  if (!isCredentialEntryViteConsumer(viteConfigPath, repositoryRoot)) return [];
  const compositionSource = readLocalViteComposition(viteConfigPath);

  const displayPath = relative(repositoryRoot, viteConfigPath);
  const issues = [];
  if (!compositionSource.includes('createSdkworkCredentialEntryBootstrapVitePlugin')) {
    issues.push(`${displayPath} must install createSdkworkCredentialEntryBootstrapVitePlugin`);
  }
  if (
    !compositionSource.includes('@sdkwork/iam-credential-entry/vite')
    && !compositionSource.includes('sdkwork-iam-credential-entry/src/vite.ts')
  ) {
    issues.push(`${displayPath} must consume the canonical IAM Vite entry`);
  }
  if (/['"]process\.env\.SDKWORK_ACCESS_TOKEN['"]\s*:/u.test(source)) {
    issues.push(`${displayPath} must not expose SDKWORK_ACCESS_TOKEN through Vite define`);
  }
  if (/VITE_[A-Z0-9_]*ACCESS_TOKEN/u.test(source)) {
    issues.push(`${displayPath} must not declare a public VITE access-token key`);
  }
  if (/serializeCredentialEntryBootstrapForInlineScript/u.test(source)) {
    issues.push(`${displayPath} must not copy the IAM bootstrap serializer`);
  }
  return issues;
}

function validateEnvTemplates(repositoryRoot, applicationRoot) {
  const issues = [];
  const templates = walkFiles(applicationRoot, (filePath) => /^\.env(?:\.[^.]+)*\.example$/u.test(path.basename(filePath)));
  const privateTemplates = templates.filter((filePath) => !/\.production\.example$/u.test(filePath));
  const productionTemplates = templates.filter((filePath) => /\.production\.example$/u.test(filePath));

  if (!privateTemplates.some((filePath) => /^SDKWORK_ACCESS_TOKEN=[ \t]*$/mu.test(readText(filePath)))) {
    issues.push(`${relative(repositoryRoot, applicationRoot)} must provide a private env template with blank SDKWORK_ACCESS_TOKEN=`);
  }
  for (const filePath of templates) {
    if (/^SDKWORK_ACCESS_TOKEN=[ \t]*\S+/mu.test(readText(filePath))) {
      issues.push(`${relative(repositoryRoot, filePath)} must not contain a resolved bootstrap token`);
    }
  }
  for (const filePath of productionTemplates) {
    if (/^SDKWORK_ACCESS_TOKEN=/mu.test(readText(filePath))) {
      issues.push(`${relative(repositoryRoot, filePath)} is a production browser template and must not declare SDKWORK_ACCESS_TOKEN`);
    }
  }
  return issues;
}

function validateLocalForks(repositoryRoot) {
  if (path.basename(repositoryRoot) === 'sdkwork-iam') return [];
  const issues = [];
  for (const filePath of sourceFiles(repositoryRoot)) {
    const displayPath = relative(repositoryRoot, filePath);
    const normalizedPath = `/${displayPath.toLowerCase()}`;
    const basename = path.basename(filePath).toLowerCase();
    if (
      /\/(?:test|tests|__tests__|fixtures?|mocks?)(?:\/|$)/u.test(normalizedPath)
      || /(?:^|[._-])(?:test|spec|fixture|mock)(?:[._-]|$)/u.test(basename)
    ) {
      continue;
    }
    const isProductionBootstrapSurface = normalizedPath.includes('/scripts/dev/')
      || /^vite\.config\.(?:js|mjs|mts|ts)$/u.test(basename)
      || /(?:bootstrap|credential-entry|runtime)/u.test(basename);
    if (!isProductionBootstrapSurface) continue;
    const source = readText(filePath);
    for (const pattern of [
      /function\s+createTestJwt\s*\(/u,
      /function\s+createDevBootstrapAccessTokenJwt\s*\(/u,
      /function\s+resolveRepoApplicationManifestPath\s*\(/u,
      /function\s+serializeCredentialEntryBootstrapForInlineScript\s*\(/u,
    ]) {
      if (pattern.test(source)) issues.push(`${displayPath} contains an application-local credential-entry bootstrap fork`);
    }
  }
  return issues;
}

export function validateCredentialEntryRepository(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  if (!fs.existsSync(root)) return [`repository root not found: ${root}`];

  const issues = [...validateLocalForks(root)];
  const viteConfigs = walkFiles(root, (filePath) => /^vite\.config\.(?:js|mjs|mts|ts)$/u.test(path.basename(filePath)));
  const iamApplicationRoots = new Set();
  for (const viteConfigPath of viteConfigs) {
    if (isCredentialEntryViteConsumer(viteConfigPath, root)) {
      iamApplicationRoots.add(findApplicationRoot(viteConfigPath, root));
    }
    issues.push(...validateViteConsumer(root, viteConfigPath));
  }
  for (const appRoot of iamApplicationRoots) issues.push(...validateEnvTemplates(root, appRoot));
  return [...new Set(issues)].sort((left, right) => left.localeCompare(right));
}

export function validateAuthProfileSpecs(specsRoot) {
  const root = path.resolve(specsRoot);
  const required = new Map([
    ['API_SPEC.md', [
      'credential-entry-bootstrap',
      'security: [{ AccessToken: [] }]',
      'separate `ApiKey` and `OAuthBearer` security alternatives',
      '`authProfile`',
      '`failedStage`',
      '`reason`',
    ]],
    ['SDK_SPEC.md', ['fail before network dispatch', 'x-sdkwork-auth-mode: credential-entry-bootstrap']],
    ['WEB_FRAMEWORK_SPEC.md', ['RouteAuth::CredentialEntryBootstrap', 'Runtime OpenAPI assembled from a route inventory different']],
    ['IAM_CREDENTIAL_ENTRY_SPEC.md', ['security:', '  - AccessToken: []', 'sdkwork-app', 'short-lived bootstrap JWT']],
    ['IAM_LOGIN_INTEGRATION_SPEC.md', ['x-sdkwork-auth-mode: credential-entry-bootstrap', 'fail before network dispatch']],
  ]);
  const forbidden = new Map([
    ['SDK_SPEC.md', ['`security: []` plus `x-sdkwork-auth-mode: anonymous`']],
    ['IAM_LOGIN_INTEGRATION_SPEC.md', ['anonymous login request with bootstrap Access-Token']],
  ]);
  const issues = [];
  for (const [relativePath, markers] of required) {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) {
      issues.push(`missing standard: ${relativePath}`);
      continue;
    }
    const source = readText(filePath);
    for (const marker of markers) {
      if (!source.includes(marker)) issues.push(`${relativePath} must contain ${marker}`);
    }
  }
  for (const [relativePath, markers] of forbidden) {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) continue;
    const source = readText(filePath);
    for (const marker of markers) {
      if (source.includes(marker)) issues.push(`${relativePath} contains retired rule ${marker}`);
    }
  }
  return issues;
}
