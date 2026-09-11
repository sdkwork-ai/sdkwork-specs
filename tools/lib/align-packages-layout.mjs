import fs from 'node:fs';
import path from 'node:path';

import { resolveRepositoryIdentity } from '../align-repository-docs-lib.mjs';
import {
  LEGACY_REPO_PACKAGE_FAMILIES,
  listApplicationRoots,
  parseRepositoryKind,
  resolveRepositoryKind,
  scanRepositoryPackagesLayout,
} from './packages-layout-patterns.mjs';

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

const LEGACY_FAMILY_TARGET_SUFFIX = {
  'packages/common': '-common',
  'packages/pc-react': '-pc',
  'packages/mobile-react': '-h5',
  'packages/mobile-flutter': '-flutter-mobile',
  'packages/mini-program': '-mini-program',
  'packages/android-native': '-android-mobile',
  'packages/ios-native': '-ios-mobile',
  'packages/harmony-native': '-harmony-mobile',
};

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * True when the path itself is a symlink/junction. `lstatSync` is required:
 * `statSync` follows the link and reports the target, so every recursive-delete
 * decision must consult the link status of the path before descending into it.
 */
function isSymbolicLinkPath(targetPath) {
  try {
    return fs.lstatSync(targetPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function listChildDirectories(dirPath) {
  if (!isDirectory(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function normalizeApplicationCode(raw) {
  const value = String(raw ?? '').trim();
  if (!value) {
    return value;
  }
  return value.startsWith('sdkwork-') ? value.slice('sdkwork-'.length) : value;
}

export function inferApplicationCode(repoRoot) {
  const manifestPath = path.join(repoRoot, 'sdkwork.app.config.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readText(manifestPath));
      if (manifest.app?.key) {
        return normalizeApplicationCode(manifest.app.key);
      }
    } catch {
      // fall through
    }
  }

  for (const appRoot of listApplicationRoots(repoRoot)) {
    const match = appRoot.match(/^apps\/sdkwork-([a-z0-9-]+?)(?:-(?:common|pc|h5|flutter-mobile|mini-program|android-mobile|ios-mobile|harmony-mobile|backend-react-web))$/);
    if (match) {
      return normalizeApplicationCode(match[1]);
    }
  }

  const identity = resolveRepositoryIdentity(repoRoot);
  if (identity.applicationCode && identity.applicationCode !== identity.repoName) {
    return normalizeApplicationCode(identity.applicationCode);
  }

  const repoName = path.basename(repoRoot);
  if (repoName.startsWith('sdkwork-')) {
    return normalizeApplicationCode(repoName.slice('sdkwork-'.length));
  }
  return normalizeApplicationCode(repoName);
}

export function expectedRepositoryKind(repoRoot) {
  const repoName = path.basename(repoRoot);
  if (repoName === 'sdkwork-specs' || fs.existsSync(path.join(repoRoot, 'DOCUMENTATION_SPEC.md'))) {
    return 'standards';
  }
  if (FOUNDATION_REPOSITORY_NAMES.has(repoName)) {
    return 'foundation-dependency';
  }
  if (SHARED_PACKAGE_FAMILY_REPOSITORIES.has(repoName)) {
    return 'shared-package-family';
  }
  if (readText(path.join(repoRoot, 'README.md')).includes('not an independent SDKWORK application root')) {
    return 'foundation-dependency';
  }
  return 'application';
}

export function upsertRepositoryKind(readmeText, repositoryKind) {
  if (parseRepositoryKind(readmeText) === repositoryKind) {
    return { changed: false, text: readmeText };
  }

  const line = `repository-kind: ${repositoryKind}`;
  const withoutExisting = readmeText.replace(/^repository-kind:\s*.+\r?\n?/gim, '');
  const eol = withoutExisting.includes('\r\n') ? '\r\n' : '\n';
  const lines = withoutExisting.split(/\r?\n/u);

  if (lines[0]?.startsWith('#')) {
    lines.splice(1, 0, line);
  } else {
    lines.unshift(line, '');
  }

  const text = lines.join(eol);
  return { changed: parseRepositoryKind(text) === repositoryKind && text !== readmeText, text };
}

function hasPackageJsonInTree(dirPath) {
  if (!isDirectory(dirPath)) {
    return false;
  }
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolute = path.join(dirPath, entry.name);
    if (entry.isFile() && entry.name === 'package.json') {
      return true;
    }
    if (entry.isDirectory() && hasPackageJsonInTree(absolute)) {
      return true;
    }
  }
  return false;
}

function hasWorkspacePackageAtRoot(packagesDir) {
  if (!isDirectory(packagesDir)) {
    return false;
  }

  for (const legacyFamily of LEGACY_REPO_PACKAGE_FAMILIES) {
    const legacyName = path.basename(legacyFamily);
    const legacyAbsolute = path.join(packagesDir, legacyName);
    if (isDirectory(legacyAbsolute) && hasPackageJsonInTree(legacyAbsolute)) {
      return true;
    }
  }

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (LEGACY_REPO_PACKAGE_FAMILIES.some((legacyPath) => legacyPath.endsWith(entry.name))) {
      continue;
    }
    if (fs.existsSync(path.join(packagesDir, entry.name, 'package.json'))) {
      return true;
    }
  }
  return false;
}

function removeOrphanPackageDirectories(repoRoot, dryRun) {
  const actions = [];
  const packagesDir = path.join(repoRoot, 'packages');
  // Never descend through a compatibility link: the entries it exposes are the
  // canonical packages, and deleting a "no package.json" entry would delete the
  // real source through the link.
  if (!isDirectory(packagesDir) || isSymbolicLinkPath(packagesDir)) {
    return actions;
  }

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (LEGACY_REPO_PACKAGE_FAMILIES.some((legacyPath) => legacyPath.endsWith(entry.name))) {
      continue;
    }
    const entryAbsolute = path.join(packagesDir, entry.name);
    if (!fs.existsSync(path.join(entryAbsolute, 'package.json'))) {
      if (!dryRun) {
        fs.rmSync(entryAbsolute, { recursive: true, force: true });
      }
      actions.push(`remove orphan packages/${entry.name}/`);
    }
  }

  return actions;
}

function collectLegacyFamilyPackageMoves(repoRoot, legacyFamily, legacyAbsolute, appRootName, targetPackagesDir, moves) {
  function walk(currentAbsolute, relativeParts) {
    for (const entry of fs.readdirSync(currentAbsolute, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const entryAbsolute = path.join(currentAbsolute, entry.name);
      const nextRelative = [...relativeParts, entry.name];
      if (fs.existsSync(path.join(entryAbsolute, 'package.json'))) {
        moves.push({
          from: path.join(legacyFamily, ...nextRelative),
          to: path.posix.join(appRootName, 'packages', entry.name),
          fromAbsolute: entryAbsolute,
          toAbsolute: path.join(targetPackagesDir, entry.name),
        });
        continue;
      }
      walk(entryAbsolute, nextRelative);
    }
  }

  walk(legacyAbsolute, []);
}

function resolveFlatPackageAppRoot(repoRoot, applicationCode, entry) {
  const surfaceMatch = entry.match(/^sdkwork-([a-z0-9-]+?)-(pc|h5|mp|flutter-mobile|android-mobile|ios-mobile|harmony-mobile)(?:-|$)/);
  if (surfaceMatch) {
    const suffix = surfaceMatch[2] === 'mp' ? '-mini-program' : `-${surfaceMatch[2]}`;
    return `apps/sdkwork-${applicationCode}${suffix}`;
  }
  if (/(-contracts|-sdk-ports|-service|-runtime)$/.test(entry)) {
    return `apps/sdkwork-${applicationCode}-common`;
  }
  if (new RegExp(`^sdkwork-${applicationCode}(?:-[a-z0-9]+)*-(?:core|sdk)$`, 'u').test(entry)) {
    return `apps/sdkwork-${applicationCode}-common`;
  }
  if (/^sdkwork-[a-z0-9-]+-(?:app|backend|open)?-?sdk$/u.test(entry)) {
    return `apps/sdkwork-${applicationCode}-common`;
  }
  if (fs.existsSync(path.join(repoRoot, 'sdkwork.app.config.json')) || listApplicationRoots(repoRoot).length > 0) {
    return `apps/sdkwork-${applicationCode}-pc`;
  }
  return null;
}

function collectLegacyPackageMoves(repoRoot, applicationCode) {
  const moves = [];

  for (const [legacyFamily, suffix] of Object.entries(LEGACY_FAMILY_TARGET_SUFFIX)) {
    const legacyAbsolute = path.join(repoRoot, legacyFamily);
    if (!isDirectory(legacyAbsolute) || isSymbolicLinkPath(legacyAbsolute)) {
      continue;
    }

    const appRootName = `apps/sdkwork-${applicationCode}${suffix}`;
    const targetPackagesDir = path.join(repoRoot, appRootName, 'packages');
    collectLegacyFamilyPackageMoves(repoRoot, legacyFamily, legacyAbsolute, appRootName, targetPackagesDir, moves);
  }

  const repoPackagesDir = path.join(repoRoot, 'packages');
  if (isDirectory(repoPackagesDir) && !isSymbolicLinkPath(repoPackagesDir)) {
    for (const entry of listChildDirectories(repoPackagesDir)) {
      if (LEGACY_REPO_PACKAGE_FAMILIES.some((legacyPath) => legacyPath.endsWith(entry))) {
        continue;
      }
      const entryAbsolute = path.join(repoPackagesDir, entry);
      if (!fs.existsSync(path.join(entryAbsolute, 'package.json'))) {
        continue;
      }
      const appRootName = resolveFlatPackageAppRoot(repoRoot, applicationCode, entry);
      if (!appRootName) {
        continue;
      }
      moves.push({
        from: path.posix.join('packages', entry),
        to: path.posix.join(appRootName, 'packages', entry),
        fromAbsolute: entryAbsolute,
        toAbsolute: path.join(repoRoot, appRootName, 'packages', entry),
      });
    }
  }

  const unique = new Map();
  for (const move of moves) {
    unique.set(move.from, move);
  }
  return [...unique.values()];
}

function ensureAppRootScaffold(repoRoot, appRootRelative) {
  const changed = [];
  const appRootAbsolute = path.join(repoRoot, appRootRelative);
  if (!isDirectory(appRootAbsolute)) {
    fs.mkdirSync(appRootAbsolute, { recursive: true });
    changed.push(`${appRootRelative}/`);
  }
  const packagesDir = path.join(appRootAbsolute, 'packages');
  if (!isDirectory(packagesDir)) {
    fs.mkdirSync(packagesDir, { recursive: true });
    changed.push(`${appRootRelative}/packages/`);
  }
  const readmePath = path.join(appRootAbsolute, 'README.md');
  if (!fs.existsSync(readmePath)) {
    writeText(readmePath, `# ${path.basename(appRootRelative)}\n\nArchitecture-local application root per \`SDKWORK_WORKSPACE_SPEC.md\` section 1.1.2.\n`);
    changed.push(`${appRootRelative}/README.md`);
  }
  return changed;
}

function rewritePnpmWorkspace(repoRoot, applicationCode, dryRun) {
  const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspacePath)) {
    return { changed: false, actions: [] };
  }

  const original = readText(workspacePath);
  const lines = original.split('\n');
  const actions = [];
  const filtered = [];

  const legacyLinePatterns = [
    /^(\s*-\s*["'])packages\/\*["']\s*$/,
    /^(\s*-\s*["'])packages\/common/,
    /^(\s*-\s*["'])packages\/pc-react/,
    /^(\s*-\s*["'])packages\/mobile-react/,
    /^(\s*-\s*["'])packages\/mobile-flutter/,
    /^(\s*-\s*["'])packages\/mini-program/,
    /^(\s*-\s*["'])packages\/android-native/,
    /^(\s*-\s*["'])packages\/ios-native/,
    /^(\s*-\s*["'])packages\/harmony-native/,
    /^(\s*-\s*["'])packages\/sdkwork-/,
    /^(\s*-\s*["'])apps\/sdkwork-sdkwork-/,
  ];

  for (const line of lines) {
    if (legacyLinePatterns.some((pattern) => pattern.test(line))) {
      actions.push(`remove workspace entry: ${line.trim()}`);
      continue;
    }
    filtered.push(line);
  }

  const additions = new Set();
  for (const suffix of new Set(Object.values(LEGACY_FAMILY_TARGET_SUFFIX))) {
    const appRoot = `apps/sdkwork-${applicationCode}${suffix}`;
    if (isDirectory(path.join(repoRoot, appRoot, 'packages'))) {
      additions.add(`  - "${appRoot}"`);
      additions.add(`  - "${appRoot}/packages/*"`);
    }
  }

  for (const appRoot of listApplicationRoots(repoRoot)) {
    if (isDirectory(path.join(repoRoot, appRoot, 'packages'))) {
      additions.add(`  - "${appRoot}"`);
      additions.add(`  - "${appRoot}/packages/*"`);
    }
  }

  let packagesIndex = filtered.findIndex((line) => /^packages:\s*$/.test(line));
  if (packagesIndex === -1) {
    filtered.unshift('packages:');
    packagesIndex = 0;
  }

  const existing = new Set(filtered);
  const toInsert = [...additions].filter((line) => !existing.has(line));
  if (toInsert.length > 0) {
    filtered.splice(packagesIndex + 1, 0, ...toInsert);
    for (const line of toInsert) {
      actions.push(`add workspace entry: ${line.trim()}`);
    }
  }

  const updated = `${filtered.join('\n').replace(/\s+$/u, '')}\n`;
  if (updated !== original && !dryRun) {
    writeText(workspacePath, updated);
  }
  return { changed: updated !== original, actions };
}

function moveDirectorySync(fromAbsolute, toAbsolute) {
  fs.mkdirSync(path.dirname(toAbsolute), { recursive: true });
  try {
    fs.renameSync(fromAbsolute, toAbsolute);
  } catch (error) {
    if (error?.code !== 'EXDEV' && error?.code !== 'EPERM') {
      throw error;
    }
    fs.cpSync(fromAbsolute, toAbsolute, { recursive: true });
    fs.rmSync(fromAbsolute, { recursive: true, force: true });
  }
}

/**
 * Directories that are build output or installed dependencies rather than
 * authored source. They are excluded from the duplicate comparison so a stale
 * `dist/` or `node_modules/` in one copy does not mask an identity match.
 */
const DUPLICATE_COMPARE_IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'target', '.turbo', '.cache', '.next', 'coverage',
]);

/**
 * Compare two directory trees by relative path and byte content.
 *
 * `alignRepositoryPackagesLayout` deletes the legacy copy whenever the canonical
 * target already exists. Without this check a diverged legacy tree — one that
 * received a local fix the canonical copy never got — would be deleted with no
 * way to notice. The caller keeps and reports the legacy tree instead, so the
 * layout gate stays red until an operator reconciles the two.
 */
function treesAreIdentical(leftAbsolute, rightAbsolute) {
  const collect = (dirPath, prefix, files) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (DUPLICATE_COMPARE_IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        collect(path.join(dirPath, entry.name), relative, files);
        continue;
      }
      if (entry.isFile()) {
        files.set(relative, fs.readFileSync(path.join(dirPath, entry.name)));
      }
    }
    return files;
  };

  const leftFiles = collect(leftAbsolute, '', new Map());
  const rightFiles = collect(rightAbsolute, '', new Map());
  if (leftFiles.size !== rightFiles.size) {
    return false;
  }
  for (const [relative, content] of leftFiles) {
    const counterpart = rightFiles.get(relative);
    if (counterpart === undefined || !counterpart.equals(content)) {
      return false;
    }
  }
  return true;
}

function removeEmptyDirectoryTree(dirPath, dryRun) {
  if (!isDirectory(dirPath)) {
    return false;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirectoryTree(path.join(dirPath, entry.name), dryRun);
    }
  }

  const remaining = fs.readdirSync(dirPath);
  if (remaining.length === 0) {
    if (!dryRun) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
    return true;
  }
  return false;
}

function repairDoublePrefixedApplicationRoots(repoRoot, dryRun) {
  const actions = [];
  const appsDir = path.join(repoRoot, 'apps');
  if (!isDirectory(appsDir)) {
    return actions;
  }

  for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const match = entry.name.match(/^sdkwork-sdkwork-(.+)$/u);
    if (!match) {
      continue;
    }

    const correctedName = `sdkwork-${match[1]}`;
    const fromAbsolute = path.join(appsDir, entry.name);
    const toAbsolute = path.join(appsDir, correctedName);

    if (fs.existsSync(toAbsolute)) {
      const fromPackages = path.join(fromAbsolute, 'packages');
      const toPackages = path.join(toAbsolute, 'packages');
      if (isDirectory(fromPackages)) {
        fs.mkdirSync(toPackages, { recursive: true });
        for (const packageDir of listChildDirectories(fromPackages)) {
          const packageFrom = path.join(fromPackages, packageDir);
          const packageTo = path.join(toPackages, packageDir);
          if (!fs.existsSync(packageTo) && !dryRun) {
            moveDirectorySync(packageFrom, packageTo);
            actions.push(`merge packages/${packageDir} from apps/${entry.name} into apps/${correctedName}`);
          }
        }
      }
      if (!dryRun) {
        removeEmptyDirectoryTree(fromAbsolute, dryRun);
      }
      actions.push(`remove duplicate app root apps/${entry.name}`);
      continue;
    }

    if (!dryRun) {
      moveDirectorySync(fromAbsolute, toAbsolute);
    }
    actions.push(`repair app root apps/${entry.name} -> apps/${correctedName}`);
  }

  return actions;
}

function removeEmptyLegacyDirectories(repoRoot, dryRun) {
  const actions = [];
  for (const legacyFamily of LEGACY_REPO_PACKAGE_FAMILIES) {
    const legacyAbsolute = path.join(repoRoot, legacyFamily);
    if (isSymbolicLinkPath(legacyAbsolute)) {
      continue;
    }
    if (removeEmptyDirectoryTree(legacyAbsolute, dryRun)) {
      actions.push(`remove empty ${legacyFamily}/`);
    }
  }

  const packagesDir = path.join(repoRoot, 'packages');
  // A compatibility link is removed by `unlinkSync` in the caller. Treating it as
  // a stub directory here would `rmSync` through the link into the canonical tree.
  if (isSymbolicLinkPath(packagesDir)) {
    return actions;
  }
  if (removeEmptyDirectoryTree(packagesDir, dryRun)) {
    actions.push('remove empty packages/');
  } else if (isDirectory(packagesDir) && !hasWorkspacePackageAtRoot(packagesDir)) {
    if (!dryRun) {
      fs.rmSync(packagesDir, { recursive: true, force: true });
    }
    actions.push('remove stub packages/');
  }
  return actions;
}

export function alignRepositoryPackagesLayout(repoRoot, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const repositoryKind = expectedRepositoryKind(repoRoot);
  const changed = [];
  const actions = [];
  const skippedReason = [];

  if (repositoryKind === 'standards' || repositoryKind === 'foundation-dependency' || repositoryKind === 'shared-package-family') {
    const readmePath = path.join(repoRoot, 'README.md');
    const readmeUpsert = upsertRepositoryKind(readText(readmePath), repositoryKind);
    if (readmeUpsert.changed && !dryRun) {
      writeText(readmePath, readmeUpsert.text);
    }
    if (readmeUpsert.changed) {
      changed.push('README.md');
      actions.push(`set repository-kind: ${repositoryKind}`);
    }
    return {
      repoRoot,
      repositoryKind,
      skipped: false,
      changed,
      actions,
      issuesAfter: scanRepositoryPackagesLayout(repoRoot, { mode: 'enforce', repositoryKind }),
    };
  }

  const applicationCode = inferApplicationCode(repoRoot);
  repairDoublePrefixedApplicationRoots(repoRoot, dryRun).forEach((action) => actions.push(action));

  // A compatibility link at a legacy family root resolves into the canonical
  // `apps/<application-root>/packages/` tree. Removing it means removing the link
  // itself: `fs.rmSync` on a path whose ancestor is a link follows the link and
  // deletes the canonical packages instead, leaving a dangling link behind.
  for (const legacyFamily of new Set(['packages', ...LEGACY_REPO_PACKAGE_FAMILIES])) {
    const legacyAbsolute = path.join(repoRoot, legacyFamily);
    if (!isSymbolicLinkPath(legacyAbsolute)) {
      continue;
    }
    if (!dryRun) {
      fs.unlinkSync(legacyAbsolute);
    }
    actions.push(`remove legacy packages symlink: ${legacyFamily}`);
    changed.push(legacyFamily);
  }

  const moves = collectLegacyPackageMoves(repoRoot, applicationCode);

  for (const move of moves) {
    if (fs.existsSync(move.toAbsolute)) {
      if (!treesAreIdentical(move.fromAbsolute, move.toAbsolute)) {
        actions.push(
          `keep legacy source, content differs: ${move.from} (reconcile with ${move.to} before removing)`,
        );
        continue;
      }
      if (!dryRun) {
        fs.rmSync(move.fromAbsolute, { recursive: true, force: true });
      }
      actions.push(`remove legacy duplicate source: ${move.from}`);
      continue;
    }
    ensureAppRootScaffold(repoRoot, path.posix.dirname(path.posix.dirname(move.to.replace(/\\/g, '/')))).forEach((item) => {
      if (!changed.includes(item)) {
        changed.push(item);
      }
    });
    if (!dryRun) {
      fs.mkdirSync(path.dirname(move.toAbsolute), { recursive: true });
      moveDirectorySync(move.fromAbsolute, move.toAbsolute);
    }
    changed.push(`${move.from} -> ${move.to}`);
    actions.push(`move ${move.from} -> ${move.to}`);
  }

  const workspaceResult = rewritePnpmWorkspace(repoRoot, applicationCode, dryRun);
  if (workspaceResult.changed) {
    changed.push('pnpm-workspace.yaml');
    actions.push(...workspaceResult.actions);
  }

  if (!dryRun) {
    removeOrphanPackageDirectories(repoRoot, dryRun).forEach((action) => actions.push(action));
    removeEmptyLegacyDirectories(repoRoot, dryRun).forEach((action) => actions.push(action));
  }

  const readmePath = path.join(repoRoot, 'README.md');
  const readmeUpsert = upsertRepositoryKind(readText(readmePath), 'application');
  if (readmeUpsert.changed && !dryRun) {
    writeText(readmePath, readmeUpsert.text);
  }
  if (readmeUpsert.changed) {
    changed.push('README.md');
    actions.push('set repository-kind: application');
  }

  const issuesAfter = scanRepositoryPackagesLayout(repoRoot, { mode: 'enforce', repositoryKind: 'application' });

  return {
    repoRoot,
    repositoryKind: 'application',
    applicationCode,
    skipped: false,
    changed,
    actions,
    issuesAfter,
  };
}

export function shouldAlignRepositoryPackagesLayout(repoRoot) {
  const kind = expectedRepositoryKind(repoRoot);
  if (kind === 'standards' || kind === 'foundation-dependency' || kind === 'shared-package-family') {
    return parseRepositoryKind(readText(path.join(repoRoot, 'README.md'))) !== kind;
  }
  return scanRepositoryPackagesLayout(repoRoot, { mode: 'enforce', repositoryKind: 'application' }).length > 0;
}
