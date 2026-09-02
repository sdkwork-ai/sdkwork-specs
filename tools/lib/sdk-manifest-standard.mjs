/**
 * SDK family manifest ownership and discovery helpers.
 * See SDK_MANIFEST_SPEC.md and SDK_PACKAGE_NAMING_SPEC.md.
 */
import fs from 'node:fs';
import path from 'node:path';

import { listWorkspaceRepos } from './app-sdk-consumer-import-patterns.mjs';

const REMOVED_PARALLEL_REGISTRY_FILE = ['.sdkwork', 'assembly.json'].join('-');
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.runtime',
  '.turbo',
  'dist',
  'node_modules',
  'target',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

export function inferApiAuthority(sdkFamilyStem) {
  const sdkworkMatch = sdkFamilyStem.match(/^(sdkwork-[a-z0-9-]+)-(app|backend|internal)-sdk$/u);
  if (sdkworkMatch) return `${sdkworkMatch[1]}-${sdkworkMatch[2]}-api`;
  const clawMatch = sdkFamilyStem.match(/^(cloudrouter)-(app|backend|open)-sdk$/u);
  if (clawMatch) return `${clawMatch[1]}-${clawMatch[2]}-api`;
  if (sdkFamilyStem.endsWith('-sdk')) {
    return `${sdkFamilyStem.slice(0, -4)}-api`;
  }
  return null;
}

export function inferSdkOwner(repoRoot, sdkFamilyStem) {
  const repoName = path.basename(repoRoot);
  if (repoName.startsWith('sdkwork-') || repoName.startsWith('cloudrouter')) return repoName;
  const sdkworkStem = sdkFamilyStem.match(/^(sdkwork-[a-z0-9-]+)-/u)?.[1];
  if (sdkworkStem) return sdkworkStem;
  if (sdkFamilyStem.startsWith('cloudrouter-')) return 'sdkwork-cloudrouter';
  return null;
}

export function inferGenerationInputSpec(familyRoot) {
  const openapiDir = path.join(familyRoot, 'openapi');
  if (!fs.existsSync(openapiDir)) return null;
  const sdkgen = fs.readdirSync(openapiDir)
    .filter((entry) => /\.sdkgen\.(?:json|ya?ml)$/u.test(entry))
    .sort()[0];
  return sdkgen ? `openapi/${sdkgen}` : null;
}

export function inferManifestOwnership(familyRoot, sdkFamilyStem, manifest, repoRoot) {
  const next = { ...manifest };
  if (!next.sdkOwner) next.sdkOwner = inferSdkOwner(repoRoot, sdkFamilyStem);
  if (!next.apiAuthority) next.apiAuthority = inferApiAuthority(sdkFamilyStem);
  if (!next.generationInputSpec && !next.authoritySpec) {
    const inferred = inferGenerationInputSpec(familyRoot);
    if (inferred) next.generationInputSpec = inferred;
  }
  if (!Array.isArray(next.sdkDependencies)) next.sdkDependencies = [];
  return next;
}

export function manifestHasOwnership(manifest, { hasTransport = false } = {}) {
  const hasOwner = Boolean(manifest?.sdkOwner && manifest?.apiAuthority);
  const hasHttpInput = Boolean(
    manifest?.generationInputSpec
    || manifest?.authoritySpec
    || manifest?.openApiPath,
  );
  const hasRpcInput = Boolean(
    manifest?.rpcManifest
    || manifest?.discoverySurface?.protoRoot
    || manifest?.discoverySurface?.generatedProtocols?.includes('rpc'),
  );
  const hasProviderStandard = Boolean(
    manifest?.architecture
    || manifest?.metadata?.providerStandard
    || (Array.isArray(manifest?.languages) && manifest.languages.length > 0),
  );
  if (hasOwner && (hasHttpInput || hasRpcInput || hasProviderStandard)) return true;
  if (hasOwner && hasTransport) return true;
  return false;
}

function collectForbiddenFiles(dir, out, depth = 0) {
  if (depth > 16 || !fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        collectForbiddenFiles(path.join(dir, entry.name), out, depth + 1);
      }
      continue;
    }
    if (entry.isFile() && entry.name === REMOVED_PARALLEL_REGISTRY_FILE) {
      out.push(path.join(dir, entry.name));
    }
  }
}

export function collectParallelSdkRegistryViolations(workspaceRoot) {
  const files = [];
  for (const repoRoot of listWorkspaceRepos(workspaceRoot)) {
    collectForbiddenFiles(repoRoot, files);
  }
  return [...new Set(files)].sort().map((file) => ({
    kind: 'parallel-sdk-registry-file',
    file,
    message: `${REMOVED_PARALLEL_REGISTRY_FILE} is removed; use sdk-manifest.json and native application/package manifests`,
  }));
}

export function loadSdkFamilyManifestFromFamilyMetadata(repoRoot, workspace) {
  const sdkRoots = [path.join(repoRoot, 'sdks')];
  const appsDir = path.join(repoRoot, 'apps');
  for (const app of fs.existsSync(appsDir)
    ? fs.readdirSync(appsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : []) {
    sdkRoots.push(path.join(appsDir, app.name, 'sdks'));
  }

  const candidates = sdkRoots.map((sdkRoot) => path.join(sdkRoot, workspace, 'sdk-manifest.json'));
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    return readJson(candidate);
  }

  const consumerPackageName = `@sdkwork/${workspace.replace(/^sdkwork-/u, '')}`;
  for (const sdkRoot of sdkRoots) {
    if (!fs.existsSync(sdkRoot)) continue;
    for (const family of fs.readdirSync(sdkRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const candidate = path.join(sdkRoot, family.name, 'sdk-manifest.json');
      if (!fs.existsSync(candidate)) continue;
      const manifest = readJson(candidate);
      const manifestNames = [
        manifest.workspace,
        manifest.sdkFamily,
        manifest.sdkName,
        manifest.packageName,
        manifest.consumerPackageName,
      ];
      if (manifestNames.includes(workspace) || manifestNames.includes(consumerPackageName)) {
        return manifest;
      }
    }
  }
  return null;
}

export function loadSdkFamilyManifestForWorkspaceConsumer(repoRoot, workspace) {
  const domain = workspace.match(/^sdkwork-([^-]+)-(?:app|backend|internal)-sdk$/u)?.[1]
    ?? workspace.match(/^sdkwork-([^-]+)-sdk$/u)?.[1];
  if (domain) {
    const siblingRoot = path.resolve(repoRoot, '..', `sdkwork-${domain}`);
    if (fs.existsSync(path.join(siblingRoot, 'specs', 'component.spec.json'))) {
      const manifest = loadSdkFamilyManifestFromFamilyMetadata(siblingRoot, workspace);
      if (manifest) return manifest;
    }
    if (domain === 'iam' || domain === 'appbase') {
      const iamRoot = path.resolve(repoRoot, '..', 'sdkwork-iam');
      if (fs.existsSync(path.join(iamRoot, 'specs', 'component.spec.json'))) {
        const manifest = loadSdkFamilyManifestFromFamilyMetadata(iamRoot, workspace);
        if (manifest) return manifest;
      }
    }
    // Naming-derived ownership can differ from the owning repository name
    // (for example sdkwork-base-data-backend-sdk lives in sdkwork-appbase).
    // Fall back to a workspace scan for the repository that actually ships
    // this SDK family before giving up.
    const ownerRoot = findSdkFamilyOwnerRepo(repoRoot, workspace);
    if (ownerRoot) {
      const manifest = loadSdkFamilyManifestFromFamilyMetadata(ownerRoot, workspace);
      if (manifest) return manifest;
    }
  }
  // Multi-segment and non-standard family names (for example
  // sdkwork-drive-admin-storage-sdk, sdkwork-modelkit-sdk-typescript) may not
  // match the domain-derivation regex above. Always fall back to a workspace
  // scan so a correctly-owned sdk-manifest.json can still be resolved before
  // giving up. Guard against the common no-op path (repo index) cheaply.
  try {
    const ownerRoot = findSdkFamilyOwnerRepo(repoRoot, workspace);
    if (ownerRoot) {
      const manifest = loadSdkFamilyManifestFromFamilyMetadata(ownerRoot, workspace);
      if (manifest) return manifest;
    }
  } catch {
    // fall through to local metadata lookup
  }
  return loadSdkFamilyManifestFromFamilyMetadata(repoRoot, workspace);
}

function findSdkFamilyOwnerRepo(repoRoot, workspace) {
  const workspaceRoot = path.resolve(repoRoot, '..');
  let entries;
  try {
    entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) continue;
    if (entry.name === path.basename(repoRoot)) continue;
    const candidate = path.join(workspaceRoot, entry.name, 'sdks', workspace, 'sdk-manifest.json');
    if (fs.existsSync(candidate)) {
      return path.join(workspaceRoot, entry.name);
    }
  }
  return null;
}

export function loadDiscoverySurfaceFromFamilyMetadata(repoRoot, workspace) {
  return loadSdkFamilyManifestFromFamilyMetadata(repoRoot, workspace)?.discoverySurface ?? null;
}

export function loadDiscoverySurfaceForWorkspaceConsumer(repoRoot, workspace) {
  return loadSdkFamilyManifestForWorkspaceConsumer(repoRoot, workspace)?.discoverySurface ?? null;
}
