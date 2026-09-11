import fs from 'node:fs';
import path from 'node:path';

export const FOUNDATION_REPOSITORY_NAMES = new Set([
  'sdkwork-appbase',
  'sdkwork-core',
  'sdkwork-database',
  'sdkwork-discovery',
  'sdkwork-fs',
  'sdkwork-github-workflow',
  'sdkwork-id',
  'sdkwork-kernel',
  'sdkwork-rpc-framework',
  'sdkwork-sdk-generator',
  'sdkwork-web-framework',
  'sdkwork-deployments',
  'sdkwork-app-topology',
  'sdkwork-models',
]);

export const SHARED_PACKAGE_FAMILY_REPOSITORIES = new Set([
  'sdkwork-utils',
  'sdkwork-sdk-commons',
]);

export const LEGACY_REPO_PACKAGE_FAMILIES = [
  'packages/common',
  'packages/pc-react',
  'packages/mobile-react',
  'packages/mobile-flutter',
  'packages/mini-program',
  'packages/android-native',
  'packages/ios-native',
  'packages/harmony-native',
];

export const REPOSITORY_KINDS = [
  'application',
  'legacy-application',
  'shared-package-family',
  'foundation-dependency',
  'standards',
  'unknown',
];

export const APPLICATION_ROOT_PATTERN = /^apps\/sdkwork-[a-z0-9-]+(?:-(?:common|pc|h5|flutter-mobile|mini-program|android-mobile|ios-mobile|harmony-mobile|backend-react-web))?$/;

export function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

export function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

export function listApplicationRoots(repoRoot) {
  const appsDir = path.join(repoRoot, 'apps');
  if (!isDirectory(appsDir)) {
    return [];
  }

  return fs.readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => path.posix.join('apps', entry.name))
    .sort();
}

export function parseRepositoryKind(readmeText) {
  const match = readmeText.match(/repository-kind:\s*([a-z-]+)/i);
  return match ? match[1].toLowerCase() : null;
}

export function declaresSharedPackageFamilyRepository(readmeText) {
  return parseRepositoryKind(readmeText) === 'shared-package-family';
}

export function declaresFoundationDependencyRepository(readmeText) {
  if (parseRepositoryKind(readmeText) === 'foundation-dependency') {
    return true;
  }
  return /not an independent SDKWORK application root/i.test(readmeText);
}

export function ownsApplicationLineCapabilities(repoRoot) {
  return ['apis', 'crates', 'sdks'].some((name) => isDirectory(path.join(repoRoot, name)));
}

export function hasRepositoryRootPackages(repoRoot) {
  return isDirectory(path.join(repoRoot, 'packages'));
}

/**
 * A repository-root `packages/` that is a symlink/junction into the canonical
 * `apps/<application-root>/packages/` tree is a compatibility link, not a second
 * package family. It must be classified separately: the remedy is to remove the
 * link itself, and any tool that recursively deletes the path would otherwise
 * follow the link and destroy the canonical source.
 */
export function isRepositoryRootPackagesSymlink(repoRoot) {
  try {
    return fs.lstatSync(path.join(repoRoot, 'packages')).isSymbolicLink();
  } catch {
    return false;
  }
}

export function resolveRepositoryKind(repoRoot, options = {}) {
  if (options.repositoryKind) {
    return options.repositoryKind;
  }

  const repoName = path.basename(repoRoot);
  const readmeText = readText(path.join(repoRoot, 'README.md'));
  const declaredKind = parseRepositoryKind(readmeText);

  if (repoName === 'sdkwork-specs' || fs.existsSync(path.join(repoRoot, 'DOCUMENTATION_SPEC.md'))) {
    return declaredKind === 'standards' ? 'standards' : 'standards';
  }
  if (FOUNDATION_REPOSITORY_NAMES.has(repoName) || declaresFoundationDependencyRepository(readmeText)) {
    return declaredKind === 'foundation-dependency' ? 'foundation-dependency' : 'foundation-dependency';
  }
  if (SHARED_PACKAGE_FAMILY_REPOSITORIES.has(repoName) || declaredKind === 'shared-package-family') {
    return 'shared-package-family';
  }
  if (declaredKind && REPOSITORY_KINDS.includes(declaredKind)) {
    return declaredKind;
  }

  if (fs.existsSync(path.join(repoRoot, 'sdkwork.app.config.json')) || listApplicationRoots(repoRoot).length > 0) {
    return 'application';
  }

  if (hasRepositoryRootPackages(repoRoot) && ownsApplicationLineCapabilities(repoRoot)) {
    return 'legacy-application';
  }

  return declaredKind ?? 'unknown';
}

function issueSeverity(kind, mode, repositoryKind) {
  if (repositoryKind === 'foundation-dependency' || repositoryKind === 'standards') {
    return 'skip';
  }

  if (repositoryKind === 'shared-package-family' && kind === 'forbidden-repo-root-packages') {
    return 'skip';
  }

  if (mode === 'audit') {
    return 'info';
  }

  if (mode === 'migration') {
    return 'warn';
  }

  return 'error';
}

export function classifyRepositoryKindMetadata(repoRoot, options = {}) {
  const issues = [];
  const mode = options.mode ?? 'enforce';
  const readmePath = path.join(repoRoot, 'README.md');
  const readmeText = readText(readmePath);
  const repositoryKind = resolveRepositoryKind(repoRoot, options);

  if ((repositoryKind === 'application' || repositoryKind === 'legacy-application') && !parseRepositoryKind(readmeText)) {
    issues.push({
      kind: 'missing-repository-kind',
      severity: mode === 'enforce' ? 'error' : 'warn',
      detail: 'application repositories MUST declare repository-kind: application in README.md per SDKWORK_WORKSPACE_SPEC.md section 1.1.2',
      path: 'README.md',
    });
  } else if (repositoryKind === 'unknown' && hasRepositoryRootPackages(repoRoot)) {
    issues.push({
      kind: 'missing-repository-kind',
      severity: mode === 'enforce' ? 'error' : 'warn',
      detail: 'repositories with repository-root packages/ MUST declare repository-kind: application, shared-package-family, or foundation-dependency in README.md',
      path: 'README.md',
    });
  }

  return { repositoryKind, issues };
}

export function classifyRepositoryRootPackages(repoRoot, options = {}) {
  const issues = [];
  const mode = options.mode ?? 'enforce';
  const { repositoryKind, issues: metadataIssues } = classifyRepositoryKindMetadata(repoRoot, options);
  issues.push(...metadataIssues);

  if (repositoryKind === 'foundation-dependency' || repositoryKind === 'standards') {
    return issues.filter((issue) => issue.severity !== 'skip');
  }

  if (!hasRepositoryRootPackages(repoRoot)) {
    return issues;
  }

  const applicationRoots = listApplicationRoots(repoRoot);
  const requiresArchitectureQualifiedPackages = repositoryKind === 'application'
    || repositoryKind === 'legacy-application'
    || (applicationRoots.length > 0)
    || (repositoryKind === 'unknown' && ownsApplicationLineCapabilities(repoRoot));

  if (requiresArchitectureQualifiedPackages && repositoryKind !== 'shared-package-family') {
    const packagesIsSymlink = isRepositoryRootPackagesSymlink(repoRoot);
    const kind = packagesIsSymlink ? 'legacy-packages-symlink' : 'forbidden-repo-root-packages';
    const severity = issueSeverity(kind, mode, repositoryKind);
    if (severity !== 'skip') {
      issues.push({
        kind,
        severity,
        detail: packagesIsSymlink
          ? 'repository-root packages/ is a compatibility link into apps/<application-root>/packages/; remove the link itself (unlink only — never delete through it, that would destroy the canonical packages)'
          : 'repository-root packages/ is forbidden for application repositories; use apps/sdkwork-<application-code>-common/packages/ or apps/sdkwork-<application-code>-<client-arch>/packages/',
        path: 'packages/',
      });
    }
  }

  if (repositoryKind === 'application' || repositoryKind === 'legacy-application') {
    for (const legacyPath of LEGACY_REPO_PACKAGE_FAMILIES) {
      if (!isDirectory(path.join(repoRoot, legacyPath))) {
        continue;
      }
      const severity = issueSeverity('legacy-package-family-path', mode, repositoryKind);
      if (severity !== 'skip') {
        issues.push({
          kind: 'legacy-package-family-path',
          severity,
          detail: `${legacyPath}/ is migration-only; move package families under apps/sdkwork-<application-code>-common/packages/ or apps/sdkwork-<application-code>-<client-arch>/packages/`,
          path: legacyPath,
        });
      }
    }
  }

  return issues;
}

export function classifyPnpmWorkspacePackagesLayout(repoRoot, options = {}) {
  const issues = [];
  const mode = options.mode ?? 'enforce';
  const repositoryKind = options.repositoryKind ?? resolveRepositoryKind(repoRoot);
  const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');

  if (repositoryKind === 'foundation-dependency' || repositoryKind === 'standards' || repositoryKind === 'shared-package-family') {
    return issues;
  }

  if (!pathExists(workspacePath)) {
    return issues;
  }

  const applicationRoots = listApplicationRoots(repoRoot);
  const legacyApplication = repositoryKind === 'legacy-application'
    || (applicationRoots.length === 0 && hasRepositoryRootPackages(repoRoot) && ownsApplicationLineCapabilities(repoRoot));

  if (applicationRoots.length === 0 && !legacyApplication) {
    return issues;
  }

  const workspaceText = readText(workspacePath);
  const forbiddenPatterns = [
    /['"]packages\/\*['"]/,
    /['"]packages\/\*\/\*['"]/,
    ...LEGACY_REPO_PACKAGE_FAMILIES.map((legacyPath) => new RegExp(`['"]${legacyPath.replace(/\//g, '\\/')}`)),
  ];

  for (const pattern of forbiddenPatterns) {
    if (!pattern.test(workspaceText)) {
      continue;
    }
    const severity = issueSeverity('legacy-pnpm-workspace-glob', mode, repositoryKind);
    if (severity !== 'skip') {
      issues.push({
        kind: 'legacy-pnpm-workspace-glob',
        severity,
        detail: `pnpm-workspace.yaml must not glob repository-root package families when apps/sdkwork-<application-code>-* roots exist; use apps/sdkwork-<application-code>-*/packages/* instead (${pattern})`,
        path: 'pnpm-workspace.yaml',
      });
    }
  }

  return issues;
}

export function scanRepositoryPackagesLayout(repoRoot, options = {}) {
  const repositoryKind = options.repositoryKind ?? resolveRepositoryKind(repoRoot);
  const mode = options.mode ?? 'enforce';
  const scanOptions = { ...options, mode, repositoryKind };

  return [
    ...classifyRepositoryRootPackages(repoRoot, scanOptions),
    ...classifyPnpmWorkspacePackagesLayout(repoRoot, scanOptions),
  ].filter((issue) => issue.severity !== 'skip');
}

export function partitionIssues(issues) {
  return {
    errors: issues.filter((issue) => issue.severity === 'error' || issue.severity === undefined),
    warnings: issues.filter((issue) => issue.severity === 'warn'),
    infos: issues.filter((issue) => issue.severity === 'info'),
  };
}

export function summarizeRepositoryPackagesLayout(repoRoot, options = {}) {
  const repositoryKind = resolveRepositoryKind(repoRoot, options);
  const issues = scanRepositoryPackagesLayout(repoRoot, { ...options, repositoryKind });
  const { errors, warnings, infos } = partitionIssues(issues);

  return {
    repoRoot,
    repositoryKind,
    applicationRoots: listApplicationRoots(repoRoot),
    hasRepositoryRootPackages: hasRepositoryRootPackages(repoRoot),
    issueCount: issues.length,
    errors,
    warnings,
    infos,
  };
}
