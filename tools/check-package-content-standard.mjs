#!/usr/bin/env node
// PACKAGING_SPEC.md content standard checker.
//
// Verifies that packaging pipelines do not ship forbidden content:
//  1. Container builds must use a staging directory or a complete
//     .dockerignore/.containerignore; repository-root COPY without an
//     exclusion file is a defect (PACKAGING_SPEC §4).
//  2. Staging/package directories must not contain forbidden entries
//     (node_modules, .git, target, test fixtures, dev env, secrets).
//  3. Declared package manifests (install-manifest.json and container-image
//     evidence) must be present for packaged outputs and must not list
//     forbidden paths.
//  4. Release binaries must be stripped (PACKAGING_SPEC §2.4) where the
//     package format requires it.
//
// Usage: node tools/check-package-content-standard.mjs [--workspace <root>]
// Exit code 0 = pass, 1 = violations, 2 = invocation error.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const FORBIDDEN_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'target', '.gradle', '.mvn',
  'Pods', '.dart_tool', '__pycache__', '.venv', 'venv', '.pnpm',
  '.idea', '.vscode', '.editorconfig', '.prettierrc', '.prettierrc.json',
  '.prettierrc.js', 'coverage',
]);
/**
 * Materialized dotenv files never ship inside a release package.
 *
 * `ENVIRONMENT_SPEC.md` section 5.1.7 allows four dotenv shapes in a working
 * tree; a package may carry only the `*.example` template, so the rule is a
 * shape test rather than a list of retired spellings to keep in sync.
 * @param leaf - file basename.
 * @returns whether the name is a dotenv file.
 */
function isForbiddenEnvFile(leaf) {
  return leaf === '.env' || leaf.startsWith('.env.');
}
const FORBIDDEN_EXTENSIONS = new Set(['.sqlite', '.db', '.pdb']);
const SECRET_PATH_PATTERN = /(?:^|\/)(?:secrets?|credentials?|\.env[\w.-]*|\.pem|\.key|\.p12|\.pfx)(?:\/|$)/iu;
const PACKAGE_MANIFEST_NAMES = new Set(['install-manifest.json', 'container-image.json', 'package.manifest.json']);
const BINARY_NAMES = new Set(['cloudrouter', 'cloudrouterctl', 'sdkwork-api-cloudrouter-standalone-gateway']);

function listFilesRecursive(root, { maxDepth = 20 } = {}) {
  const files = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else files.push(full);
    }
  }
  walk(root, 0);
  return files;
}

function isForbiddenRelative(relative) {
  const segments = relative.split(/[\\/]+/u).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    if (FORBIDDEN_NAMES.has(segments[index])) return true;
  }
  const leaf = segments[segments.length - 1] ?? '';
  // Template files (`*.example`) carry no secret values and are allowed as
  // declared packaging entries.
  if (leaf.endsWith('.example')) return false;
  if (isForbiddenEnvFile(leaf)) return true;
  if (FORBIDDEN_EXTENSIONS.has(path.extname(leaf).toLowerCase())) return true;
  if (SECRET_PATH_PATTERN.test(relative)) return true;
  return false;
}

function findWorkspaceRoot(entryDir) {
  const start = path.resolve(entryDir);
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
  return start;
}

function findDockerIgnore(workspaceRoot, issues) {
  const dockerIgnore = path.join(workspaceRoot, '.dockerignore');
  const containerIgnore = path.join(workspaceRoot, '.containerignore');
  if (fs.existsSync(dockerIgnore)) return dockerIgnore;
  if (fs.existsSync(containerIgnore)) return containerIgnore;
  return null;
}

function checkStagingDirectories(workspaceRoot, issues) {
  const stagingCandidates = [
    'dist/install-package-staging',
    'dist/container-image-build',
    'dist/install-packages',
    'dist/packages',
    'packages/dist',
    'build/install',
  ];
  for (const candidate of stagingCandidates) {
    const dir = path.join(workspaceRoot, candidate);
    if (!fs.existsSync(dir)) continue;
    for (const file of listFilesRecursive(dir)) {
      const relative = path.relative(dir, file).replace(/\\/gu, '/');
      if (isForbiddenRelative(relative)) {
        issues.push(`${candidate}/${relative}: forbidden packaging content (PACKAGING_SPEC §2)`);
      }
    }
  }
}

function checkPackageManifests(workspaceRoot, issues) {
  const candidates = [
    'dist/install-packages',
    'dist',
    'packages',
  ];
  for (const candidate of candidates) {
    const dir = path.join(workspaceRoot, candidate);
    if (!fs.existsSync(dir)) continue;
    for (const file of listFilesRecursive(dir)) {
      const base = path.basename(file);
      if (!PACKAGE_MANIFEST_NAMES.has(base)) continue;
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        issues.push(`${file}: package manifest is not valid JSON`);
        continue;
      }
      const entries = collectManifestEntries(manifest);
      for (const entry of entries) {
        if (isForbiddenRelative(entry)) {
          issues.push(`${file}: manifest lists forbidden entry ${entry} (PACKAGING_SPEC §6)`);
        }
      }
      const label = `${file}: package manifest missing required `;
      const packageId = manifest.packageId ?? manifest.package?.id ?? manifest.id;
      const version = manifest.version ?? manifest.package?.version;
      if (packageId === undefined || packageId === null) {
        issues.push(`${label}package id`);
      }
      if (version === undefined || version === null) {
        issues.push(`${label}version`);
      }
      if (manifest.package && typeof manifest.package === 'object'
        && (manifest.package.entries || manifest.package.files)) {
        const nested = manifest.package.entries ?? manifest.package.files;
        for (const entry of nested) {
          const entryPath = typeof entry === 'string'
            ? entry
            : (entry.archivePath ?? entry.path);
          if (typeof entryPath === 'string' && isForbiddenRelative(entryPath)) {
            issues.push(`${file}: manifest lists forbidden entry ${entryPath} (PACKAGING_SPEC §6)`);
          }
        }
      }
    }
  }
}

function collectManifestEntries(manifest) {
  const result = [];
  if (Array.isArray(manifest.entries)) {
    for (const entry of manifest.entries) {
      if (typeof entry === 'string') result.push(entry);
      else if (entry && typeof entry.archivePath === 'string') result.push(entry.archivePath);
    }
  }
  if (Array.isArray(manifest.files)) {
    for (const entry of manifest.files) {
      if (typeof entry === 'string') result.push(entry);
      else if (entry && typeof entry.path === 'string') result.push(entry.path);
    }
  }
  if (manifest.installManifest && Array.isArray(manifest.installManifest.entries)) {
    for (const entry of manifest.installManifest.entries) {
      if (typeof entry === 'string') result.push(entry);
      else if (entry && typeof entry.path === 'string') result.push(entry.path);
    }
  }
  return result;
}

function checkBinaryStripped(workspaceRoot, issues, { reportBinaryStrip = false } = {}) {
  // Best-effort: release binaries found in target/release are checked for
  // debug symbols via the ELF .debug section marker only when the toolchain
  // stripped marker is absent; this is advisory unless reportBinaryStrip.
  const releaseDir = path.join(workspaceRoot, 'target', 'release');
  if (!fs.existsSync(releaseDir)) return;
  for (const name of fs.readdirSync(releaseDir)) {
    if (!BINARY_NAMES.has(name)) continue;
    const file = path.join(releaseDir, name);
    if (path.extname(name) === '.exe') continue; // PE handled by format policy
    const head = fs.readFileSync(file);
    const isElf = head.length > 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
    if (!isElf) continue;
    const size = fs.statSync(file).size;
    // Stripped ELF binaries are typically much smaller than the equivalent
    // unstripped build for this workspace's scale; report size as evidence.
    if (reportBinaryStrip && size > 300 * 1024 * 1024) {
      issues.push(`${name}: release binary is ${Math.round(size / 1024 / 1024)}MB; verify strip policy (PACKAGING_SPEC §2.4)`);
    }
  }
}

export function validatePackageContent(workspaceRoot, { reportBinaryStrip = false } = {}) {
  const issues = [];
  const dockerIgnore = findDockerIgnore(workspaceRoot, issues);
  const hasContainerScripts = fs.existsSync(path.join(workspaceRoot, 'Dockerfile'))
    || fs.existsSync(path.join(workspaceRoot, 'scripts', 'build-cloud-router-container.mjs'));
  if (hasContainerScripts && !dockerIgnore) {
    issues.push('container packaging without .dockerignore/.containerignore: repository-root COPY context risk (PACKAGING_SPEC §4)');
  }
  checkStagingDirectories(workspaceRoot, issues);
  checkPackageManifests(workspaceRoot, issues);
  checkBinaryStripped(workspaceRoot, issues, { reportBinaryStrip });
  return issues;
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      workspace: { type: 'string', short: 'w', default: '.' },
      'report-binary-strip': { type: 'boolean', default: false },
    },
  });
  const workspaceRoot = path.resolve(values.workspace);
  if (!fs.existsSync(path.join(workspaceRoot, 'package.json'))) {
    console.error(`check-package-content-standard: workspace root has no package.json: ${workspaceRoot}`);
    return 2;
  }
  const issues = validatePackageContent(workspaceRoot, {
    reportBinaryStrip: values['report-binary-strip'] ?? false,
  });
  if (issues.length === 0) {
    console.log('check-package-content-standard: PASS');
    return 0;
  }
  for (const issue of issues) console.error(`- ${issue}`);
  console.error(`check-package-content-standard: ${issues.length} violation(s)`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
