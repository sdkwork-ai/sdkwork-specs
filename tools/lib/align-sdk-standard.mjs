/**
 * Align SDK families to SDK_PACKAGE_NAMING_SPEC.md (single consumer package model).
 */
import fs from 'node:fs';
import path from 'node:path';

import { listWorkspaceRepos } from './app-sdk-consumer-import-patterns.mjs';
import { parsePnpmWorkspacePackages } from './workspace-registry.mjs';
import { discoverAllSdkFamiliesIncludingApps, listTransportRootsInFamily } from './sdk-family-discovery.mjs';
import { materializeMissingComposedFacades, facadeBodyForConsumer } from './materialize-composed-sdk-facades.mjs';
import {
  collectParallelSdkRegistryViolations,
  inferManifestOwnership,
  manifestHasOwnership,
} from './sdk-manifest-standard.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function inferSdkType(family) {
  if (family.sdkFamilyStem.includes('-backend-') || family.sdkFamilyStem.endsWith('-backend-sdk')) return 'backend';
  if (family.sdkFamilyStem.includes('-internal-') || family.sdkFamilyStem.endsWith('-internal-sdk')) return 'internal';
  if (family.sdkFamilyStem.endsWith('-app-sdk')) return 'app';
  return 'open';
}

/**
 * Resolve the published version spec for `@sdkwork/sdk-common`.
 *
 * Composed consumer packages (`@sdkwork/<x>-sdk`) are PUBLISHED to npm, so
 * their `dependencies.@sdkwork/sdk-common` MUST be a concrete semver spec
 * (e.g. `^1.0.5`) that external consumers can resolve — never `workspace:*`,
 * which only resolves inside this monorepo. (See SDK_PACKAGE_NAMING_SPEC.md
 * §1.1: consumer packages are published; transport packages are not.)
 *
 * The version is read from the local source package at
 * `<workspaceRoot>/sdkwork-sdk-commons/sdkwork-sdk-common-typescript/package.json`
 * so align tracks sdk-common releases automatically. Falls back to `^1.0.5`
 * (the current published version) if the source package is missing.
 */
const SDK_COMMON_PUBLISHED_FALLBACK = '^1.0.5';
const SDK_COMMON_SOURCE_RELATIVE = path.join(
  'sdkwork-sdk-commons',
  'sdkwork-sdk-common-typescript',
  'package.json',
);

/**
 * `@sdkwork/utils` source package. Composed consumer packages that import
 * `sha256Hash` (or other utils) from `@sdkwork/utils` need it declared in
 * `dependencies` with a concrete semver spec — never `workspace:*`.
 * Source: `<workspaceRoot>/sdkwork-utils/packages/sdkwork-utils-typescript/package.json`.
 */
const SDK_UTILS_PUBLISHED_FALLBACK = '^0.11.0';
const SDK_UTILS_SOURCE_RELATIVE = path.join(
  'sdkwork-utils',
  'packages',
  'sdkwork-utils-typescript',
  'package.json',
);

/**
 * `@sdkwork/sdk-generator` source package. Composed consumer packages and
 * internal SDK tooling packages may reference the generator (e.g. via
 * `devDependencies` for `sdkgen` script discovery). Because the generator is
 * PUBLISHED to npm (`@sdkwork/sdk-generator`), any `workspace:*` reference
 * MUST be rewritten to a concrete semver spec — never left as `workspace:*`.
 * Source: `<workspaceRoot>/sdkwork-sdk-generator/package.json`.
 */
const SDK_GENERATOR_PUBLISHED_FALLBACK = '^1.0.9';
const SDK_GENERATOR_SOURCE_RELATIVE = path.join('sdkwork-sdk-generator', 'package.json');

function resolveSourcePublishedVersion(workspaceRoot, sourceRelative, fallback) {
  const sourcePath = path.join(workspaceRoot, sourceRelative);
  try {
    if (!fs.existsSync(sourcePath)) return fallback;
    const pkg = readJson(sourcePath);
    const version = pkg && typeof pkg.version === 'string' ? pkg.version.trim() : '';
    if (!/^\d+\.\d+\.\d+/.test(version)) return fallback;
    return `^${version}`;
  } catch {
    return fallback;
  }
}

function resolveSdkCommonPublishedVersion(workspaceRoot) {
  return resolveSourcePublishedVersion(
    workspaceRoot,
    SDK_COMMON_SOURCE_RELATIVE,
    SDK_COMMON_PUBLISHED_FALLBACK,
  );
}

function resolveSdkUtilsPublishedVersion(workspaceRoot) {
  return resolveSourcePublishedVersion(
    workspaceRoot,
    SDK_UTILS_SOURCE_RELATIVE,
    SDK_UTILS_PUBLISHED_FALLBACK,
  );
}

function resolveSdkGeneratorPublishedVersion(workspaceRoot) {
  return resolveSourcePublishedVersion(
    workspaceRoot,
    SDK_GENERATOR_SOURCE_RELATIVE,
    SDK_GENERATOR_PUBLISHED_FALLBACK,
  );
}

/**
 * Returns true if a dependency spec is a pnpm workspace protocol reference
 * (`workspace:*`, `workspace:^`, `workspace:~`, `workspace:1.0.0`, etc.).
 * Such specs MUST NOT appear in published consumer package manifests.
 */
function isWorkspaceProtocolSpec(spec) {
  return typeof spec === 'string' && spec.startsWith('workspace:');
}

/**
 * Build a map of `@sdkwork/<name>` -> published version spec (`^x.y.z`) by
 * scanning every composed consumer package.json under the workspace. This lets
 * align rewrite cross-SDK `workspace:*` references (e.g. `@sdkwork/iam-app-sdk`
 * as a peerDependency of `@sdkwork/knowledgebase-app-sdk`) to concrete versions
 * so the published consumer package resolves externally.
 *
 * Returns a Map<string, string>.
 */
function buildSdkworkConsumerVersionMap(workspaceRoot) {
  const map = new Map();
  for (const family of discoverAllSdkFamiliesIncludingApps(workspaceRoot)) {
    try {
      if (!fs.existsSync(family.composedPackageJsonPath)) continue;
      const pkg = readJson(family.composedPackageJsonPath);
      if (!pkg || typeof pkg.name !== 'string' || typeof pkg.version !== 'string') continue;
      if (!pkg.name.startsWith('@sdkwork/')) continue;
      if (!/^\d+\.\d+\.\d+/.test(pkg.version)) continue;
      // Don't overwrite an existing entry — first one wins (deterministic by
      // discoverAllSdkFamiliesIncludingApps's sort order).
      if (!map.has(pkg.name)) map.set(pkg.name, `^${pkg.version}`);
    } catch {
      // ignore unreadable manifests
    }
  }
  return map;
}

/**
 * Rewrite every `workspace:*` spec in a dependency section (dependencies /
 * peerDependencies / devDependencies) to a concrete `^x.y.z` spec when the
 * package name is known. Known names are:
 *   - `@sdkwork/sdk-common` (from source package)
 *   - `@sdkwork/utils` (from source package)
 *   - `@sdkwork/sdk-generator` (from source package — published to npm)
 *   - any `@sdkwork/<x>` consumer package present in the workspace (from the
 *     consumer version map)
 *
 * Mutates `pkg[section]` in place. Returns true if any rewrite happened.
 */
function rewriteWorkspaceSpecsInSection(pkg, section, workspaceRoot, consumerVersions, sdkCommonVersion, sdkUtilsVersion, sdkGeneratorVersion) {
  const deps = pkg[section];
  if (!deps || typeof deps !== 'object') return false;
  let changed = false;
  for (const [name, spec] of Object.entries(deps)) {
    if (!isWorkspaceProtocolSpec(spec)) continue;
    let resolved;
    if (name === '@sdkwork/sdk-common') {
      resolved = sdkCommonVersion;
    } else if (name === '@sdkwork/utils') {
      resolved = sdkUtilsVersion;
    } else if (name === '@sdkwork/sdk-generator') {
      resolved = sdkGeneratorVersion;
    } else if (consumerVersions.has(name)) {
      resolved = consumerVersions.get(name);
    }
    if (resolved && resolved !== spec) {
      deps[name] = resolved;
      changed = true;
    }
  }
  return changed;
}

function cleanComposedPackageDependencies(family, pkg) {
  let changed = false;
  if (!pkg.dependencies) return false;
  for (const key of Object.keys(pkg.dependencies)) {
    const remove = key === family.transportPackageName
      || key.startsWith('@sdkwork-internal/')
      || /^@sdkwork\/[a-z0-9-]+-generated$/u.test(key)
      || key.endsWith('-generated-typescript');
    if (remove) {
      delete pkg.dependencies[key];
      changed = true;
    }
  }
  return changed;
}

function ensureComposedPackageJson(family, workspaceRoot, context) {
  const target = family.composedPackageJsonPath;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let pkg;
  let changed = false;

  if (fs.existsSync(target)) {
    pkg = readJson(target);
  } else {
    pkg = {
      name: family.consumerPackageName,
      version: '0.1.0',
      description: `SDKWork ${family.sdkFamilyStem} composed consumer facade.`,
      type: 'module',
      private: true,
    };
    changed = true;
  }

  if (pkg.name !== family.consumerPackageName) {
    pkg.name = family.consumerPackageName;
    changed = true;
  }
  if (!pkg.main) {
    pkg.main = './src/index.ts';
    changed = true;
  }
  if (!pkg.module) {
    pkg.module = './src/index.ts';
    changed = true;
  }
  if (!pkg.types) {
    pkg.types = './src/index.ts';
    changed = true;
  }

  const nextExports = { ...(pkg.exports ?? {}) };
  if (!nextExports['.']) {
    nextExports['.'] = {
      types: './src/index.ts',
      import: './src/index.ts',
      default: './src/index.ts',
    };
    changed = true;
  }
  if (nextExports['./generated']) {
    delete nextExports['./generated'];
    changed = true;
  }
  if (JSON.stringify(pkg.exports ?? {}) !== JSON.stringify(nextExports)) {
    pkg.exports = nextExports;
    changed = true;
  }

  // Composed consumer packages are PUBLISHED to npm. Their `@sdkwork/sdk-common`
  // dependency MUST be a concrete semver spec (e.g. `^1.0.5`), never
  // `workspace:*`. If missing, add it. If already a workspace:* spec (left
  // behind by older align runs), rewrite it. If it's a non-workspace spec
  // that matches the fallback (meaning a prior align wrote it from a missing
  // source), upgrade to the current source version. Otherwise leave it alone.
  const desiredSdkCommonVersion = context.sdkCommonVersion;
  const currentSdkCommonSpec = pkg.dependencies?.['@sdkwork/sdk-common'];
  if (currentSdkCommonSpec !== desiredSdkCommonVersion) {
    const shouldRewrite = !currentSdkCommonSpec
      || isWorkspaceProtocolSpec(currentSdkCommonSpec)
      || currentSdkCommonSpec === SDK_COMMON_PUBLISHED_FALLBACK;
    if (shouldRewrite) {
      pkg.dependencies = {
        ...(pkg.dependencies ?? {}),
        '@sdkwork/sdk-common': desiredSdkCommonVersion,
      };
      changed = true;
    }
  }

  // Composed consumer packages publish the transport sources
  // (`generated/server-openapi/src`, `generated/domains/server-openapi/src`)
  // in their `files`, so every runtime dependency the transport declares (for
  // example `@sdkwork/utils`, injected by the generator for sdkwork-v3
  // profiles) MUST also be declared by the composed facade. Generated
  // transports are forbidden in `pnpm-workspace.yaml`
  // (`forbidden-workspace-transport`), so the facade is the only link that
  // resolves those imports both locally (tsc) and for npm consumers.
  const desiredSdkUtilsVersion = context.sdkUtilsVersion;
  const transportPkg = fs.existsSync(family.transportPackageJsonPath)
    ? readJson(family.transportPackageJsonPath)
    : null;
  const transportDeclaresUtils = Boolean(transportPkg?.dependencies?.['@sdkwork/utils']);
  const currentSdkUtilsSpec = pkg.dependencies?.['@sdkwork/utils'];
  if (transportDeclaresUtils && currentSdkUtilsSpec !== desiredSdkUtilsVersion) {
    const shouldRewriteUtils = !currentSdkUtilsSpec
      || isWorkspaceProtocolSpec(currentSdkUtilsSpec)
      || currentSdkUtilsSpec === SDK_UTILS_PUBLISHED_FALLBACK;
    if (shouldRewriteUtils) {
      pkg.dependencies = {
        ...(pkg.dependencies ?? {}),
        '@sdkwork/utils': desiredSdkUtilsVersion,
      };
      changed = true;
    }
  }

  // Rewrite any remaining `workspace:*` specs in `dependencies`,
  // `peerDependencies`, and `devDependencies` to concrete published versions.
  // This covers:
  //   - `@sdkwork/utils: workspace:*` (auto-declared by clean-repo-vite-aliases)
  //   - cross-SDK peerDependencies like `@sdkwork/iam-app-sdk: workspace:*`
  //   - `@sdkwork/sdk-generator: workspace:*` in devDependencies (used by
  //     composed packages that expose a `generate` script)
  // External consumers cannot resolve the workspace protocol, so any
  // `workspace:*` that survives to npm corrupts the published package.
  if (rewriteWorkspaceSpecsInSection(
    pkg, 'dependencies', workspaceRoot,
    context.consumerVersions, context.sdkCommonVersion, context.sdkUtilsVersion, context.sdkGeneratorVersion,
  )) changed = true;
  if (rewriteWorkspaceSpecsInSection(
    pkg, 'peerDependencies', workspaceRoot,
    context.consumerVersions, context.sdkCommonVersion, context.sdkUtilsVersion, context.sdkGeneratorVersion,
  )) changed = true;
  if (rewriteWorkspaceSpecsInSection(
    pkg, 'devDependencies', workspaceRoot,
    context.consumerVersions, context.sdkCommonVersion, context.sdkUtilsVersion, context.sdkGeneratorVersion,
  )) changed = true;

  if (cleanComposedPackageDependencies(family, pkg)) changed = true;

  if (changed) writeJson(target, pkg);
  return changed ? target : null;
}

function ensureComposedFacade(family) {
  const target = family.composedFacadePath;
  if (fs.existsSync(target)) return null;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, facadeBodyForConsumer(family.consumerPackageName), 'utf8');
  return target;
}

function ensureManifest(family) {
  const target = family.manifestPath;
  let manifest;
  let changed = false;

  if (fs.existsSync(target)) {
    manifest = readJson(target);
  } else {
    manifest = { schemaVersion: 1 };
    changed = true;
  }

  const assign = (key, value) => {
    if (manifest[key] !== value) {
      manifest[key] = value;
      changed = true;
    }
  };

  assign('sdkFamily', family.sdkFamilyStem);
  if (!manifest.sdkName) assign('sdkName', family.sdkFamilyStem);
  assign('packageName', family.consumerPackageName);
  assign('transportPackageName', family.transportPackageName);

  manifest.typescript = {
    composedRoot: family.composedRoot,
    composedEntry: family.composedEntry,
    transportRoot: family.transportRootRelative,
    transportEntry: family.transportEntry,
  };
  changed = true;

  manifest = inferManifestOwnership(family.familyRoot, family.sdkFamilyStem, manifest, family.repoRoot);
  changed = true;

  writeJson(target, manifest);
  return target;
}

function alignTransportPackageJsonForPath(family, transportPackageJsonPath, context) {
  const target = transportPackageJsonPath;
  if (!fs.existsSync(target)) return null;
  const pkg = readJson(target);
  let changed = false;

  if (pkg.name !== family.transportPackageName) {
    pkg.name = family.transportPackageName;
    changed = true;
  }
  if (pkg.private !== true) {
    pkg.private = true;
    changed = true;
  }
  if (pkg.sdkworkRole !== 'transport') {
    pkg.sdkworkRole = 'transport';
    changed = true;
  }
  const description = `Generator-owned TypeScript transport SDK for ${family.sdkFamilyStem}.`;
  if (pkg.description !== description) {
    pkg.description = description;
    changed = true;
  }

  // Transport packages are PRIVATE (never published standalone), but their
  // `package.json` ships inside the composed consumer package's `files` array
  // (e.g. `generated/server-openapi/dist` is bundled). More importantly, the
  // transport package's `dependencies` are what `pnpm publish` on the
  // composed package uses to resolve bundled workspace deps. Any
  // `workspace:*` left here either (a) survives into the published composed
  // package's bundled metadata, or (b) breaks if the transport package is
  // ever published standalone later. Rewrite to concrete semver specs.
  if (context) {
    if (rewriteWorkspaceSpecsInSection(
      pkg, 'dependencies', family.repoRoot,
      context.consumerVersions, context.sdkCommonVersion, context.sdkUtilsVersion, context.sdkGeneratorVersion,
    )) changed = true;
    if (rewriteWorkspaceSpecsInSection(
      pkg, 'peerDependencies', family.repoRoot,
      context.consumerVersions, context.sdkCommonVersion, context.sdkUtilsVersion, context.sdkGeneratorVersion,
    )) changed = true;
    if (rewriteWorkspaceSpecsInSection(
      pkg, 'devDependencies', family.repoRoot,
      context.consumerVersions, context.sdkCommonVersion, context.sdkUtilsVersion, context.sdkGeneratorVersion,
    )) changed = true;
  }

  if (changed) writeJson(target, pkg);
  return changed ? target : null;
}

function alignTransportPackageJson(family, context) {
  return alignTransportPackageJsonForPath(family, family.transportPackageJsonPath, context);
}

function alignTransportSdkJsonForPath(family, transportSdkJsonPath) {
  const target = transportSdkJsonPath;
  if (!fs.existsSync(target)) return null;
  const metadata = readJson(target);
  let changed = false;

  const assign = (key, value) => {
    if (metadata[key] !== value) {
      metadata[key] = value;
      changed = true;
    }
  };

  assign('name', family.sdkFamilyStem);
  assign('transportPackageName', family.transportPackageName);
  assign('consumerPackageName', family.consumerPackageName);
  if (metadata.packageName !== family.transportPackageName) {
    metadata.packageName = family.transportPackageName;
    changed = true;
  }

  if (changed) writeJson(target, metadata);
  return changed ? target : null;
}

function alignTransportSdkJson(family) {
  return alignTransportSdkJsonForPath(family, family.transportSdkJsonPath);
}

function alignAllFamilyTransports(family, context) {
  const changed = [];
  for (const transport of listTransportRootsInFamily(family.familyRoot, family.sdkFamilyStem)) {
    const file = alignTransportPackageJsonForPath(family, transport.transportPackageJsonPath, context);
    if (file) changed.push(file);
    const sdkJson = alignTransportSdkJsonForPath(family, transport.transportSdkJsonPath);
    if (sdkJson) changed.push(sdkJson);
  }
  return changed;
}

/**
 * Scan `providers/` subdirectories under a TypeScript SDK root and rewrite
 * any `workspace:*` specs in their `package.json` files.
 *
 * Provider packages (e.g. `@sdkwork/rtc-sdk-provider-agora`,
 * `@sdkwork/mail-sdk-provider-imap`) declare the parent SDK as a
 * `peerDependency` (concrete version) and a `devDependency` (`workspace:*`
 * for local dev). Even though these provider packages are currently
 * `private: true`, leaving `workspace:*` in their manifests is a latent
 * publish-time hazard: if they are ever published standalone, the
 * `workspace:*` will corrupt the published package. Rewrite them now so the
 * manifest is publish-safe.
 */
function alignFamilyProviderPackages(family, context) {
  const changed = [];
  const providersRoot = path.join(family.typescriptRoot, 'providers');
  if (!fs.existsSync(providersRoot)) return changed;

  let providerEntries;
  try {
    providerEntries = fs.readdirSync(providersRoot, { withFileTypes: true });
  } catch {
    return changed;
  }

  for (const entry of providerEntries) {
    if (!entry.isDirectory()) continue;
    const providerPackageJsonPath = path.join(providersRoot, entry.name, 'package.json');
    if (!fs.existsSync(providerPackageJsonPath)) continue;
    const pkg = readJson(providerPackageJsonPath);
    let changedThis = false;

    if (rewriteWorkspaceSpecsInSection(
      pkg, 'dependencies', family.repoRoot,
      context.consumerVersions, context.sdkCommonVersion, context.sdkUtilsVersion, context.sdkGeneratorVersion,
    )) changedThis = true;
    if (rewriteWorkspaceSpecsInSection(
      pkg, 'peerDependencies', family.repoRoot,
      context.consumerVersions, context.sdkCommonVersion, context.sdkUtilsVersion, context.sdkGeneratorVersion,
    )) changedThis = true;
    if (rewriteWorkspaceSpecsInSection(
      pkg, 'devDependencies', family.repoRoot,
      context.consumerVersions, context.sdkCommonVersion, context.sdkUtilsVersion, context.sdkGeneratorVersion,
    )) changedThis = true;

    if (changedThis) {
      writeJson(providerPackageJsonPath, pkg);
      changed.push(providerPackageJsonPath);
    }
  }
  return changed;
}

function collectFamilyTransportViolations(family) {
  const violations = [];
  for (const transport of listTransportRootsInFamily(family.familyRoot, family.sdkFamilyStem)) {
    if (!transport.isCanonical) {
      violations.push({
        kind: 'legacy-duplicate-typescript-root',
        file: transport.typescriptRoot,
        message: `remove legacy TypeScript root ${transport.typescriptRootName}; canonical root is ${family.sdkFamilyStem}-typescript`,
      });
    }
    const transportPkg = readJson(transport.transportPackageJsonPath);
    if (transportPkg.name !== family.transportPackageName) {
      violations.push({
        kind: 'transport-package-name',
        file: transport.transportPackageJsonPath,
        message: `${transportPkg.name} must be ${family.transportPackageName}`,
      });
    }
    if (String(transportPkg.name).startsWith('@sdkwork/')) {
      violations.push({
        kind: 'transport-scoped-name',
        file: transport.transportPackageJsonPath,
        message: 'transport package must not use @sdkwork scope',
      });
    }
  }
  return violations;
}

function workspaceEntryToComposed(entry) {
  if (entry.includes('generated/domains/server-openapi')) {
    return entry.replace(/\/generated\/domains\/server-openapi\/?$/u, '');
  }
  if (!entry.includes('generated/server-openapi')) return null;
  const composed = entry.replace(/\/generated\/server-openapi\/?$/u, '');
  if (composed.endsWith('-backend-sdk') || composed.endsWith('-app-sdk') || composed.endsWith('-sdk')) {
    const typescriptSuffix = composed.match(/(?:^|\/)(sdkwork-[a-z0-9-]+-sdk|cloudrouter-[a-z0-9-]+-sdk)$/u)?.[1];
    if (typescriptSuffix && !composed.endsWith('-typescript')) {
      return `${composed}/${typescriptSuffix}-typescript`;
    }
  }
  return composed;
}

function alignPnpmWorkspace(repoRoot) {
  const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspacePath)) return null;

  const original = fs.readFileSync(workspacePath, 'utf8');
  const packages = parsePnpmWorkspacePackages(original);
  const next = [];
  const seen = new Set();

  for (const entry of packages) {
    if (entry.includes('generated/server-openapi')) {
      const composed = workspaceEntryToComposed(entry.replace(/\\/g, '/'));
      if (composed && !seen.has(composed)) {
        next.push(composed);
        seen.add(composed);
      }
      continue;
    }
    if (entry.includes('generated/domains/server-openapi')) continue;
    if (!seen.has(entry)) {
      next.push(entry);
      seen.add(entry);
    }
  }

  const rebuilt = rebuildPnpmWorkspaceYaml(original, next);
  if (rebuilt === original) return null;
  fs.writeFileSync(workspacePath, rebuilt, 'utf8');
  return workspacePath;
}

function rebuildPnpmWorkspaceYaml(original, packages) {
  const lines = original.split(/\r?\n/u);
  const output = [];
  let inPackages = false;
  let packagesReplaced = false;

  for (const line of lines) {
    if (/^packages:\s*$/u.test(line)) {
      output.push(line);
      inPackages = true;
      continue;
    }
    if (inPackages && /^\s*-\s/u.test(line)) {
      if (!packagesReplaced) {
        for (const pkg of packages) {
          output.push(`  - "${pkg}"`);
        }
        packagesReplaced = true;
      }
      continue;
    }
    if (inPackages && /^[A-Za-z0-9_./-]+:\s*$/u.test(line) && !line.startsWith(' ')) {
      inPackages = false;
    }
    if (!(inPackages && /^\s*-\s/u.test(line))) {
      output.push(line);
    }
  }

  return `${output.join('\n').replace(/\n+$/u, '')}\n`;
}

export function collectSdkStandardViolations(workspaceRoot) {
  const violations = [];
  const families = discoverAllSdkFamiliesIncludingApps(workspaceRoot);

  for (const family of families) {
    if (!fs.existsSync(family.composedFacadePath)) {
      violations.push({
        kind: 'missing-composed-facade',
        file: family.composedFacadePath,
        message: `missing composed facade for ${family.consumerPackageName}`,
      });
    }
    if (!fs.existsSync(family.composedPackageJsonPath)) {
      violations.push({
        kind: 'missing-composed-package',
        file: family.composedPackageJsonPath,
        message: `missing composed package.json for ${family.consumerPackageName}`,
      });
    } else {
      const pkg = readJson(family.composedPackageJsonPath);
      if (pkg.name !== family.consumerPackageName) {
        violations.push({
          kind: 'composed-package-name',
          file: family.composedPackageJsonPath,
          message: `${pkg.name} must be ${family.consumerPackageName}`,
        });
      }
      if (pkg.exports?.['./generated']) {
        violations.push({
          kind: 'forbidden-generated-export',
          file: family.composedPackageJsonPath,
          message: 'consumer package must not export ./generated',
        });
      }
      // Generated transports are excluded from `pnpm-workspace.yaml`, so a
      // runtime dependency the transport declares (for example
      // `@sdkwork/utils` for sdkwork-v3 profiles) must be re-declared by the
      // composed facade; otherwise both tsc and npm consumers fail to resolve
      // it. `alignSdkStandard` adds the concrete spec when missing.
      if (fs.existsSync(family.transportPackageJsonPath)) {
        const transportPkg = readJson(family.transportPackageJsonPath);
        if (transportPkg.dependencies?.['@sdkwork/utils'] && !pkg.dependencies?.['@sdkwork/utils']) {
          violations.push({
            kind: 'composed-missing-transport-dependency',
            file: family.composedPackageJsonPath,
            message: `consumer package must declare @sdkwork/utils (declared by transport ${family.transportPackageName})`,
          });
        }
      }
    }

    violations.push(...collectFamilyTransportViolations(family));

    if (fs.existsSync(family.manifestPath)) {
      const manifest = readJson(family.manifestPath);
      if (manifest.sdkFamily !== family.sdkFamilyStem) {
        violations.push({
          kind: 'manifest-sdk-family',
          file: family.manifestPath,
          message: `${manifest.sdkFamily} must be ${family.sdkFamilyStem}`,
        });
      }
      if (manifest.sdkName !== family.sdkFamilyStem) {
        violations.push({
          kind: 'manifest-sdk-name',
          file: family.manifestPath,
          message: `${manifest.sdkName} must be ${family.sdkFamilyStem}`,
        });
      }
      if (manifest.packageName !== family.consumerPackageName) {
        violations.push({
          kind: 'manifest-consumer-name',
          file: family.manifestPath,
          message: `${manifest.packageName} must be ${family.consumerPackageName}`,
        });
      }
      if (manifest.transportPackageName !== family.transportPackageName) {
        violations.push({
          kind: 'manifest-transport-name',
          file: family.manifestPath,
          message: `${manifest.transportPackageName} must be ${family.transportPackageName}`,
        });
      }
      for (const [field, expected] of Object.entries({
        composedRoot: family.composedRoot,
        composedEntry: family.composedEntry,
        transportRoot: family.transportRootRelative,
        transportEntry: family.transportEntry,
      })) {
        if (manifest.typescript?.[field] !== expected) {
          violations.push({
            kind: `manifest-typescript-${field.replace(/[A-Z]/gu, (token) => `-${token.toLowerCase()}`)}`,
            file: family.manifestPath,
            message: `${manifest.typescript?.[field]} must be ${expected}`,
          });
        }
      }
      if (!manifestHasOwnership(manifest, { hasTransport: fs.existsSync(family.transportPackageJsonPath) })) {
        const hasOpenApiInput = fs.existsSync(path.join(family.familyRoot, 'openapi'))
          && fs.readdirSync(path.join(family.familyRoot, 'openapi')).some((f) => /\.sdkgen\.(?:json|ya?ml)$/u.test(f));
        if (hasOpenApiInput || fs.existsSync(family.transportPackageJsonPath)) {
          violations.push({
            kind: 'missing-manifest-ownership',
            file: family.manifestPath,
            message: 'manifest must include sdkOwner, apiAuthority, and generationInputSpec or authoritySpec',
          });
        }
      }
    } else {
      violations.push({
        kind: 'missing-manifest',
        file: family.manifestPath,
        message: 'missing sdk-manifest.json',
      });
    }
  }

  violations.push(...collectParallelSdkRegistryViolations(workspaceRoot));

  for (const repoRoot of listWorkspaceRepos(workspaceRoot)) {
    const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
    if (!fs.existsSync(workspacePath)) continue;
    for (const entry of parsePnpmWorkspacePackages(fs.readFileSync(workspacePath, 'utf8'))) {
      if (entry.includes('generated/server-openapi') || entry.includes('generated/domains/server-openapi')) {
        violations.push({
          kind: 'forbidden-workspace-transport',
          file: workspacePath,
          message: `remove workspace transport entry ${entry}`,
        });
      }
    }
  }

  return violations;
}

export function alignSdkStandard(workspaceRoot) {
  const changed = [];
  const families = discoverAllSdkFamiliesIncludingApps(workspaceRoot);

  // Build a context with concrete published version specs so every
  // `ensureComposedPackageJson` call can rewrite `workspace:*` to a real
  // semver range. We compute this once (not per-family) because scanning all
  // composed manifests for each family would be O(n²).
  const context = {
    sdkCommonVersion: resolveSdkCommonPublishedVersion(workspaceRoot),
    sdkUtilsVersion: resolveSdkUtilsPublishedVersion(workspaceRoot),
    sdkGeneratorVersion: resolveSdkGeneratorPublishedVersion(workspaceRoot),
    consumerVersions: buildSdkworkConsumerVersionMap(workspaceRoot),
  };

  for (const family of families) {
    for (const file of [
      ensureManifest(family),
      ensureComposedPackageJson(family, workspaceRoot, context),
      ensureComposedFacade(family),
      ...alignAllFamilyTransports(family, context),
      ...alignFamilyProviderPackages(family, context),
    ]) {
      if (file) changed.push(file);
    }
  }

  changed.push(...materializeMissingComposedFacades(workspaceRoot));

  for (const repoRoot of listWorkspaceRepos(workspaceRoot)) {
    const file = alignPnpmWorkspace(repoRoot);
    if (file) changed.push(file);
  }

  return [...new Set(changed)];
}

export { inferSdkType };
