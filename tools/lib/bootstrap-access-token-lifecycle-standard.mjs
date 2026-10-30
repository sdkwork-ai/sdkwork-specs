import fs from 'node:fs';
import path from 'node:path';

import { validateCredentialEntryRepository } from './credential-entry-bootstrap-standard.mjs';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.runtime',
  '.turbo',
  'coverage',
  'dist',
  'build',
  'external',
  'generated',
  'node_modules',
  'target',
]);

const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.ts']);

const FORBIDDEN_PRIMARY_SUPER_ADMIN_MARKERS = [
  '~/.sdkwork/users/super-admin.json',
  'loadSuperAdminProfileFromHome(',
];

const IAM_APPLICATION_BOOTSTRAP_SPEC_MARKERS = [
  '~/.sdkwork/iam-bootstrap/',
  'loadBootstrapAuthProfileFromHome',
  'ensureRepoBootstrapAccessToken',
  'with-bootstrap-token.mjs',
  'prepareLifecycleAccessTokenEnv',
  'bootstrap operator credentials',
  '### 5.4 Per-Repository Access Token Reuse And Regeneration',
  '.env.<deployment-profile>.<lifecycle>.bootstrap.local',
  'Reuse is the default',
  'MUST NOT re-register',
  'readRepoBootstrapAccessToken',
  'writeRepoBootstrapAccessToken',
];

const TOKEN_CACHE_SPELLINGS = [
  '.env.<deployment-profile>.<lifecycle>.bootstrap.local',
  '.env.standalone.<lifecycle>.bootstrap.local',
  '.env.<lifecycle>.bootstrap.local',
];

const TOKEN_GENERATION_CALL = /\bbuildBootstrapAccessTokenEnvRecord\s*\(\s*(?:''|"")\s*,/u;
const LOCAL_JWT_FORK = /function\s+(?:createTestJwt|createDevBootstrapAccessTokenJwt)\s*\(/u;
const REUSE_HELPER_MARKERS = [
  'inspectBootstrapAccessToken',
  'isBootstrapAccessTokenReusable',
  'isReusableBootstrapAccessToken',
  'isReusableConfiguredBootstrapToken',
];
const UNCONDITIONAL_PROVISION_CALL = /\btryProvisionRegisteredBootstrapToken\s*\(/u;
const CONFIGURED_CHECK = /\b(?:configured|existing|reusable|isReusable)/u;

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
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

function packageJsonAt(root) {
  const filePath = path.join(root, 'package.json');
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return readJson(filePath);
  } catch {
    return undefined;
  }
}

function manifestRequiresBootstrapToken(repoRoot) {
  const manifestPath = path.join(repoRoot, 'agent.app.config.json');
  if (!fs.existsSync(manifestPath)) return false;
  try {
    const manifest = readJson(manifestPath);
    const permissions =
      manifest.backend?.accessTokenPermissionScope
      ?? manifest.backend?.permissionScope
      ?? [];
    return Array.isArray(permissions) && permissions.length > 0;
  } catch {
    return false;
  }
}

function usesSdkworkAppLifecycle(packageJson) {
  if (!packageJson?.scripts) return false;
  return Object.values(packageJson.scripts).some((command) => (
    typeof command === 'string'
    && (command.includes('sdkwork-app') || command.includes('sdkwork-command.mjs'))
  ));
}

function hasEnvTokenEnsureScript(packageJson) {
  return typeof packageJson?.scripts?.['env:token:ensure'] === 'string';
}

function lifecycleScriptsUseBootstrapTokenEnsure(packageJson) {
  if (!packageJson?.scripts) return false;
  return Object.values(packageJson.scripts).some((command) => (
    typeof command === 'string'
    && (
      command.includes('ensure-repo-bootstrap-access-token.mjs')
      || command.includes('with-bootstrap-token.mjs')
    )
  ));
}

function dependsOnSdkworkEnvBootstrap(packageJson) {
  const sections = [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.peerDependencies,
  ];
  return sections.some((section) => section && '@sdkwork/sdkwork-env-bootstrap' in section);
}

function isIamFrameworkOwner(repoRoot) {
  return fs.existsSync(path.join(
    repoRoot,
    'apps/sdkwork-iam-common/packages/sdkwork-iam-application-bootstrap/package.json',
  ));
}

function hasEmbeddedIamAssembly(repoRoot) {
  const cargoFiles = walkFiles(repoRoot, (filePath) => path.basename(filePath) === 'Cargo.toml', 6);
  const pattern = /^\s*(?:sdkwork-api-iam-assembly|sdkwork_api_iam_assembly)\s*(?:=|\.)/mu;
  return cargoFiles.some((filePath) => pattern.test(readText(filePath)));
}

function requiresCredentialEntrySurfaces(repoRoot) {
  return validateCredentialEntryRepository(repoRoot).length > 0;
}

export function validateIamBootstrapAuthProfileSpec(specsRoot) {
  const specPath = path.join(specsRoot, 'IAM_APPLICATION_BOOTSTRAP_SPEC.md');
  const issues = [];
  if (!fs.existsSync(specPath)) {
    issues.push('missing standard: IAM_APPLICATION_BOOTSTRAP_SPEC.md');
    return issues;
  }
  const source = readText(specPath);
  for (const marker of IAM_APPLICATION_BOOTSTRAP_SPEC_MARKERS) {
    if (!source.includes(marker)) {
      issues.push(`IAM_APPLICATION_BOOTSTRAP_SPEC.md must contain ${marker}`);
    }
  }
  if (source.includes('etc/bootstrap/profiles/')) {
    issues.push('IAM_APPLICATION_BOOTSTRAP_SPEC.md must reference configs/bootstrap/profiles/, not etc/bootstrap/profiles/');
  }
  return issues;
}

export function validateWorkspaceBootstrapInfrastructure(workspaceRoot) {
  const issues = [];
  const requiredPaths = [
    ['bin/with-bootstrap-token.mjs', 'sdkwork-space/bin/with-bootstrap-token.mjs'],
    ['bin/lib/bootstrap-auth-profile.mjs', 'sdkwork-space/bin/lib/bootstrap-auth-profile.mjs'],
    ['configs/bootstrap/profiles/dev.env', 'sdkwork-space/configs/bootstrap/profiles/dev.env'],
    ['sdkwork-iam/scripts/dev/ensure-repo-bootstrap-access-token.mjs', 'ensure-repo-bootstrap-access-token runner'],
    ['sdkwork-app-topology/scripts/sdkwork-app.mjs', 'sdkwork-app lifecycle facade'],
  ];
  for (const [relativePath, label] of requiredPaths) {
    if (!fs.existsSync(path.join(workspaceRoot, relativePath))) {
      issues.push(`workspace missing ${label} at ${relativePath}`);
    }
  }

  const topologySource = readText(path.join(workspaceRoot, 'sdkwork-app-topology/scripts/sdkwork-app.mjs'));
  if (!topologySource.includes('prepareLifecycleAccessTokenEnv')) {
    issues.push('sdkwork-app.mjs must expose prepareLifecycleAccessTokenEnv for lifecycle token ensure');
  }

  const frameworkSource = readText(path.join(
    workspaceRoot,
    'sdkwork-iam/apps/sdkwork-iam-common/packages/sdkwork-iam-application-bootstrap/src/bootstrap-auth-profile.ts',
  ));
  if (!frameworkSource.includes('loadBootstrapAuthProfileFromHome')) {
    issues.push('@sdkwork/iam-application-bootstrap must expose loadBootstrapAuthProfileFromHome');
  }

  return issues;
}

export function scanForbiddenPrimarySuperAdminPaths(repoRoot) {
  const issues = [];
  const scriptFiles = walkFiles(repoRoot, (filePath) => {
    const extension = path.extname(filePath);
    if (!SCRIPT_EXTENSIONS.has(extension)) return false;
    const normalized = relative(repoRoot, filePath);
    return !normalized.includes('/generated/')
      && !normalized.includes('/node_modules/')
      && !normalized.endsWith('.test.mjs')
      && !normalized.endsWith('.spec.mjs')
      && !normalized.endsWith('.spec.ts');
  }, 10);

  for (const filePath of scriptFiles) {
    const source = readText(filePath);
    for (const marker of FORBIDDEN_PRIMARY_SUPER_ADMIN_MARKERS) {
      if (source.includes(marker)) {
        issues.push(`${relative(repoRoot, filePath)} uses retired primary bootstrap auth path ${marker}`);
      }
    }
  }
  return issues;
}

function hasLifecycleOwner(packageJson) {
  return usesSdkworkAppLifecycle(packageJson)
    || hasEnvTokenEnsureScript(packageJson)
    || lifecycleScriptsUseBootstrapTokenEnsure(packageJson)
    || dependsOnSdkworkEnvBootstrap(packageJson);
}

function repositoryLifecycleOwner(repoRoot) {
  return hasLifecycleOwner(packageJsonAt(repoRoot));
}

function gitignoreCoversBootstrapArtifacts(repoRoot) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  const lines = readText(gitignorePath)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return lines.some((line) => (
    line === '.env'
    || line === '.env.*'
    || line === '.env*'
    || line.includes('.bootstrap.local')
    || line.startsWith('.env.*.')
  ));
}

function validateBootstrapArtifactGitignore(repoRoot) {
  if (gitignoreCoversBootstrapArtifacts(repoRoot)) return [];
  return [
    `${path.basename(repoRoot)} must gitignore the bootstrap token artifact (${TOKEN_CACHE_SPELLINGS[0]})`,
  ];
}

function sourceFilesForReuseScan(repoRoot) {
  return walkFiles(repoRoot, (filePath) => {
    if (!SCRIPT_EXTENSIONS.has(path.extname(filePath))) return false;
    const normalized = relative(repoRoot, filePath);
    return !/(?:^|\/)(?:generated|external|lib|dist|build|target|node_modules)\//u.test(normalized)
      && !/\.(?:test|spec)\.(?:mjs|js|ts)$/u.test(normalized)
      && !/(?:^|\/)(?:tests?|__tests__|fixtures?|mocks?)\//u.test(normalized);
  }, 10);
}

function validateTokenReuseSource(repoRoot) {
  const issues = [];
  for (const filePath of sourceFilesForReuseScan(repoRoot)) {
    const source = readText(filePath);
    const displayPath = relative(repoRoot, filePath);

    if (TOKEN_GENERATION_CALL.test(source)) {
      issues.push(`${displayPath} generates a bootstrap token from an empty value instead of reusing a configured token`);
    }
    if (LOCAL_JWT_FORK.test(source)) {
      issues.push(`${displayPath} contains an application-local JWT signing fork`);
    }

    const provisionIndex = source.search(UNCONDITIONAL_PROVISION_CALL);
    if (provisionIndex < 0) continue;
    if (!REUSE_HELPER_MARKERS.some((marker) => source.includes(marker))) {
      issues.push(`${displayPath} provisions an IAM bootstrap token without a canonical reuse check (${REUSE_HELPER_MARKERS.join(' / ')})`);
      continue;
    }
    const configuredIndex = source.search(CONFIGURED_CHECK);
    if (configuredIndex < 0 || configuredIndex > provisionIndex) {
      issues.push(`${displayPath} calls IAM bootstrap provisioning before checking for a reusable configured token`);
    }
  }
  return [...new Set(issues)];
}

export function validateRepositoryBootstrapLifecycle(repoRoot) {
  const issues = [];
  if (!manifestRequiresBootstrapToken(repoRoot)) {
    return issues;
  }

  const packageJson = packageJsonAt(repoRoot);
  if (
    isIamFrameworkOwner(repoRoot)
    || hasEmbeddedIamAssembly(repoRoot)
  ) {
    return issues;
  }

  if (!hasLifecycleOwner(packageJson) && requiresCredentialEntrySurfaces(repoRoot)) {
    issues.push(
      `${path.basename(repoRoot)} declares bootstrap permission scope and credential-entry surfaces but exposes neither sdkwork-app lifecycle commands nor env:token:ensure`,
    );
  }

  issues.push(...validateBootstrapArtifactGitignore(repoRoot));
  issues.push(...validateTokenReuseSource(repoRoot));
  issues.push(...scanForbiddenPrimarySuperAdminPaths(repoRoot));
  return issues;
}

export function auditWorkspaceBootstrapLifecycle(workspaceRoot) {
  const repositories = [];
  const issues = [
    ...validateIamBootstrapAuthProfileSpec(path.join(workspaceRoot, 'sdkwork-specs')),
    ...validateWorkspaceBootstrapInfrastructure(workspaceRoot),
  ];

  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) continue;
    if (entry.name === 'sdkwork-specs') continue;
    const repoRoot = path.join(workspaceRoot, entry.name);
    const repositoryIssues = validateRepositoryBootstrapLifecycle(repoRoot);
    issues.push(...repositoryIssues);
    repositories.push({
      repository: entry.name,
      isGitRepository: fs.existsSync(path.join(repoRoot, '.git')),
      requiresBootstrapToken: manifestRequiresBootstrapToken(repoRoot),
      hasLifecycleOwner: repositoryLifecycleOwner(repoRoot),
      hasEnvironmentScopedArtifact: gitignoreCoversBootstrapArtifacts(repoRoot),
      issues: repositoryIssues,
    });
  }

  return { repositories, issues };
}

export function collectWorkspaceBootstrapLifecycleIssues(workspaceRoot) {
  return auditWorkspaceBootstrapLifecycle(workspaceRoot).issues;
}
