#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  findCorePackages,
  listClientAppRoots,
  normalizeSdkDependencies,
  readJson,
  toPosix,
} from './lib/app-composition.mjs';
import {
  openApiAuthorityEntries,
  walkOpenApiFiles,
} from './lib/http-response-envelope-patterns.mjs';
import {
  openApiOperationEntriesFromText,
} from './lib/openapi-operation-utils.mjs';

const NON_HTTP_CREDENTIAL_MODES = new Set(['local-native', 'test-fake']);
const IAM_MODULE_FALLBACKS = new Map([
  ['ai', 'sdkwork-iam/iam/modules/ai/iam.module.manifest.json'],
  ['apps', 'sdkwork-iam/iam/modules/apps/iam.module.manifest.json'],
  ['commerce', 'sdkwork-iam/iam/modules/commerce/iam.module.manifest.json'],
  ['courses', 'sdkwork-iam/iam/modules/courses/iam.module.manifest.json'],
  ['drive', 'sdkwork-iam/iam/modules/drive/iam.module.manifest.json'],
  ['iam', 'sdkwork-iam/iam/modules/iam-kernel/iam.module.manifest.json'],
  ['iam-kernel', 'sdkwork-iam/iam/modules/iam-kernel/iam.module.manifest.json'],
  ['integrations', 'sdkwork-iam/iam/modules/integrations/iam.module.manifest.json'],
  ['iot', 'sdkwork-iam/iam/modules/iot/iam.module.manifest.json'],
  ['messaging', 'sdkwork-iam/iam/modules/messaging/iam.module.manifest.json'],
  ['ops', 'sdkwork-iam/iam/modules/ops/iam.module.manifest.json'],
  ['system', 'sdkwork-iam/iam/modules/system/iam.module.manifest.json'],
]);

function parseArgs(argv) {
  const args = { root: process.cwd(), workspace: null, write: false, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = path.resolve(argv[++i]);
    else if (arg === '--workspace') args.workspace = path.resolve(argv[++i]);
    else if (arg === '--write') args.write = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`Usage:
  node tools/align-permission-composition.mjs --root <repo> [--write] [--dry-run]
  node tools/align-permission-composition.mjs --workspace <sdkwork-space> [--write] [--dry-run]

Aligns component.spec.json#contracts.permissionComposition for HTTP sdkDependencies.`);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function writeJson(filePath, value, options) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (options.dryRun || !options.write) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rendered, 'utf8');
  return true;
}

function isHttpSdkDependency(dep) {
  if (!dep?.workspace) return false;
  if (NON_HTTP_CREDENTIAL_MODES.has(dep.credentialMode)) return false;
  const surface = dep.surface ?? '';
  if (/^(app-api|backend-api|open-api)$/u.test(surface)) return true;
  return /(?:^|[-/])(?:app|backend|open)-sdk(?:$|\/)/u.test(dep.workspace)
    || /-sdk(?:-typescript)?$/u.test(dep.workspace);
}

function workspaceToken(workspace) {
  let token = String(workspace ?? '').replace(/\\/gu, '/').trim();
  if (!token) return '';
  if (token.startsWith('@sdkwork-internal/')) token = token.slice('@sdkwork-internal/'.length);
  else if (token.startsWith('@sdkwork/')) token = token.slice('@sdkwork/'.length);
  if (token.includes('/')) {
    const sdkSegment = token.split('/').find((segment) => /(?:^sdkwork-|^[a-z0-9-]+-)(?:.*-)?sdk/u.test(segment));
    token = sdkSegment ?? token.split('/').filter(Boolean).at(-1) ?? token;
  }
  return token;
}

function moduleCandidatesForDependency(dep) {
  const candidates = new Set();
  for (const value of [dep.permissionModuleId, dep.moduleId, dep.domain]) {
    if (typeof value === 'string' && value.trim()) candidates.add(value.trim());
  }

  const token = workspaceToken(dep.workspace);
  const cloudrouterCapability = token.match(/^cloudrouter-(?:app|backend)-([a-z0-9-]+)-capability$/u);
  if (cloudrouterCapability) candidates.add(cloudrouterCapability[1]);

  const snakeConsumer = token.match(/^sdkwork_([a-z0-9_]+?)_(?:flutter_mobile|android_mobile|ios_mobile|harmony_mobile|h5|mp)?_?app_sdk_consumer$/u);
  if (snakeConsumer) {
    candidates.add(snakeConsumer[1].replace(/_/gu, '-'));
  }

  const stripped = token
    .replace(/^sdkwork-sdkwork-/u, 'sdkwork-')
    .replace(/^sdkwork-/u, '')
    .replace(/-(?:app|backend|open)-sdk(?:-generated)?(?:-typescript)?$/u, '')
    .replace(/-sdk(?:-generated)?(?:-typescript)?$/u, '')
    .replace(/-app-sdk-generated$/u, '')
    .replace(/-backend-sdk-generated$/u, '')
    .replace(/-open-sdk-generated$/u, '');
  if (stripped) candidates.add(stripped);
  return [...candidates].filter((candidate) => /^[a-z][a-z0-9-]*$/u.test(candidate));
}

function dependencyDomain(dep) {
  return moduleCandidatesForDependency(dep)[0] ?? null;
}

function collectPermissionCodes(root, moduleId) {
  const codes = new Set();
  if (!fs.existsSync(root)) return [];
  for (const authority of openApiAuthorityEntries(walkOpenApiFiles(root))) {
    const text = fs.existsSync(authority.file) ? fs.readFileSync(authority.file, 'utf8') : null;
    if (!text) continue;
    for (const entry of openApiOperationEntriesFromText(text).entries) {
      const code = entry.operation?.['x-sdkwork-permission'];
      if (typeof code !== 'string') continue;
      if (code.startsWith(`${moduleId}.`)) codes.add(code);
    }
  }
  return [...codes].sort();
}

function buildPermissionCatalog(root, moduleId) {
  return collectPermissionCodes(root, moduleId).map((code) => ({
    code,
    description: `Permission ${code}`,
    source: 'openapi',
  }));
}

function ensureModuleManifest(manifestPath, moduleId, sourceRoot, options) {
  const existing = readJsonIfExists(manifestPath);
  if (existing) return { path: manifestPath, changed: false };

  const manifest = {
    schemaVersion: 1,
    kind: 'sdkwork.iam.module',
    moduleId,
    domain: moduleId,
    permissions: {
      catalog: buildPermissionCatalog(sourceRoot, moduleId),
    },
  };
  writeJson(manifestPath, manifest, options);
  return { path: manifestPath, changed: true };
}

function scanModuleManifestRegistry(workspaceRoot) {
  const registry = new Map();
  const ignoreDirs = new Set([
    '.cache',
    '.git',
    '.pnpm-store',
    '.runtime',
    '.sdkwork',
    '.tmp',
    'artifacts',
    'build',
    'dist',
    'generated',
    'node_modules',
    'target',
  ]);
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignoreDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'iam.module.manifest.json') continue;
      const manifest = readJsonIfExists(full);
      if (!manifest) continue;
      for (const key of [manifest.moduleId, manifest.domain]) {
        if (typeof key === 'string' && key.trim() && !registry.has(key.trim())) {
          registry.set(key.trim(), { path: full, manifest });
        }
      }
    }
  };
  walk(workspaceRoot);
  return registry;
}

function findSiblingRepoRoot(repoRoot, moduleId) {
  const workspaceRoot = path.dirname(repoRoot);
  const direct = path.join(workspaceRoot, `sdkwork-${moduleId}`);
  if (fs.existsSync(direct)) return direct;
  return null;
}

function resolveIntegrationPermissionManifest(repoRoot, moduleId) {
  const siblingRoot = findSiblingRepoRoot(repoRoot, moduleId);
  if (!siblingRoot) return null;
  const componentSpec = readJsonIfExists(path.join(siblingRoot, 'specs/component.spec.json'));
  const permissionManifest = componentSpec?.integration?.permissionManifest;
  if (typeof permissionManifest !== 'string' || !permissionManifest.trim()) return null;
  const resolved = path.resolve(siblingRoot, permissionManifest);
  return fs.existsSync(resolved) ? resolved : null;
}

function resolveFallbackManifest(repoRoot, moduleId) {
  const fallback = IAM_MODULE_FALLBACKS.get(moduleId);
  if (!fallback) return null;
  const candidate = path.join(path.dirname(repoRoot), fallback);
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveOrCreateManifestForDependency(repoRoot, dep, registry, options) {
  const candidates = moduleCandidatesForDependency(dep);
  for (const candidate of candidates) {
    const fromRegistry = registry.get(candidate);
    if (fromRegistry?.path) return { moduleId: fromRegistry.manifest?.moduleId ?? candidate, manifestPath: fromRegistry.path };

    const integrationManifest = resolveIntegrationPermissionManifest(repoRoot, candidate);
    if (integrationManifest) {
      const manifest = readJsonIfExists(integrationManifest);
      return { moduleId: manifest?.moduleId ?? candidate, manifestPath: integrationManifest };
    }

    const fallback = resolveFallbackManifest(repoRoot, candidate);
    if (fallback) {
      const manifest = readJsonIfExists(fallback);
      return { moduleId: manifest?.moduleId ?? candidate, manifestPath: fallback };
    }
  }

  const moduleId = candidates[0];
  if (!moduleId) return null;
  const siblingRoot = findSiblingRepoRoot(repoRoot, moduleId);
  const manifestRoot = siblingRoot ?? repoRoot;
  const manifestPath = path.join(manifestRoot, 'specs', 'iam.module.manifest.json');
  const { changed } = ensureModuleManifest(manifestPath, moduleId, manifestRoot, options);
  const manifest = readJsonIfExists(manifestPath) ?? { moduleId, domain: moduleId };
  if (changed) {
    registry.set(moduleId, { path: manifestPath, manifest });
    registry.set(manifest.domain ?? moduleId, { path: manifestPath, manifest });
  }
  return { moduleId: manifest.moduleId ?? moduleId, manifestPath };
}

function relativeManifestRef(componentRoot, manifestPath) {
  return toPosix(path.relative(componentRoot, manifestPath));
}

function repositoryDomain(repoRoot) {
  return path.basename(repoRoot).replace(/^sdkwork-/u, '');
}

function buildPermissionComposition(repoRoot, core, deps, registry, options) {
  const existing = core.componentSpec?.contracts?.permissionComposition ?? {};
  const existingRefsByKey = new Map();
  for (const ref of existing.moduleCatalogRefs ?? []) {
    const key = ref.moduleId ?? ref.manifestRef;
    if (key) existingRefsByKey.set(key, ref);
  }
  const refsByKey = new Map();

  let appManifestRef = existing.applicationModule?.manifestRef;
  const repoDomain = repositoryDomain(repoRoot);

  for (const dep of deps) {
    const resolved = resolveOrCreateManifestForDependency(repoRoot, dep, registry, options);
    if (!resolved) continue;
    const manifest = readJsonIfExists(resolved.manifestPath);
    const moduleId = manifest?.moduleId ?? resolved.moduleId;
    const manifestRef = relativeManifestRef(core.packageDir, resolved.manifestPath);
    const depCandidates = new Set(moduleCandidatesForDependency(dep));
    const existingRef = existingRefsByKey.get(moduleId) ?? existingRefsByKey.get(manifestRef);
    refsByKey.set(moduleId, {
      ...(existingRef ?? {}),
      moduleId,
      manifestRef,
      inheritPermissions: true,
      inheritRoles: existingRef?.inheritRoles ?? moduleId !== 'iam-kernel',
    });

    if (depCandidates.has(repoDomain) || moduleId === repoDomain || manifest?.domain === repoDomain) {
      appManifestRef = manifestRef;
    }
  }

  const next = {
    ...existing,
    inheritanceMode: 'module-catalog-with-overrides',
    ...(appManifestRef ? { applicationModule: { ...(existing.applicationModule ?? {}), manifestRef: appManifestRef } } : {}),
    moduleCatalogRefs: [...refsByKey.values()].sort((a, b) => String(a.moduleId).localeCompare(String(b.moduleId))),
    bootstrapAccessTokenScope: {
      inheritFrom: 'agent.app.config.json#backend.accessTokenPermissionScope',
      supplement: existing.bootstrapAccessTokenScope?.supplement ?? [],
      overrideReplace: existing.bootstrapAccessTokenScope?.overrideReplace ?? false,
      ...(existing.bootstrapAccessTokenScope ?? {}),
    },
    routePermissionHints: {
      inheritFromOpenApi: true,
      inheritFromModuleManifests: true,
      overrides: existing.routePermissionHints?.overrides ?? [],
      ...(existing.routePermissionHints ?? {}),
    },
    consumerPolicy: {
      forbidLocalPermissionCatalogForDependencyDomains: true,
      allowExplicitOverridesOnly: true,
      allowFrontendHintsWithoutServerDuplication: true,
      ...(existing.consumerPolicy ?? {}),
    },
  };

  return next;
}

function stableJson(value) {
  return JSON.stringify(value);
}

export function alignPermissionCompositionForRoot(repoRoot, options = {}) {
  const writeOptions = {
    write: options.write === true,
    dryRun: options.dryRun === true,
  };
  const registry = options.registry ?? scanModuleManifestRegistry(options.workspaceRoot ?? path.dirname(repoRoot));
  const changes = [];

  for (const clientRoot of listClientAppRoots(repoRoot)) {
    for (const core of findCorePackages(clientRoot.appRoot)) {
      const deps = normalizeSdkDependencies(core.componentSpec).filter(isHttpSdkDependency);
      if (deps.length === 0) continue;

      const nextPermissionComposition = buildPermissionComposition(repoRoot, core, deps, registry, writeOptions);
      const currentPermissionComposition = core.componentSpec?.contracts?.permissionComposition;
      if (stableJson(currentPermissionComposition ?? null) === stableJson(nextPermissionComposition)) continue;

      const nextSpec = {
        ...core.componentSpec,
        contracts: {
          ...(core.componentSpec.contracts ?? {}),
          permissionComposition: nextPermissionComposition,
        },
      };
      writeJson(core.componentSpecPath, nextSpec, writeOptions);
      changes.push({
        path: core.componentSpecPath,
        relPath: toPosix(path.relative(repoRoot, core.componentSpecPath)),
        corePackage: core.componentName,
        dependencies: deps.map((dep) => dep.workspace),
      });
    }
  }

  return changes;
}

function listWorkspaceRepos(workspaceRoot) {
  if (!fs.existsSync(workspaceRoot)) return [];
  return fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git')
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((repoRoot) => fs.existsSync(path.join(repoRoot, 'AGENTS.md')) || fs.existsSync(path.join(repoRoot, 'agent.app.config.json')) || fs.existsSync(path.join(repoRoot, 'apps')));
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }

  const roots = args.workspace ? listWorkspaceRepos(args.workspace) : [args.root];
  const registry = scanModuleManifestRegistry(args.workspace ?? path.dirname(args.root));
  let total = 0;
  for (const root of roots) {
    const changes = alignPermissionCompositionForRoot(root, {
      write: args.write && !args.dryRun,
      dryRun: args.dryRun || !args.write,
      workspaceRoot: args.workspace ?? path.dirname(root),
      registry,
    });
    total += changes.length;
    for (const change of changes) {
      console.log(`aligned permissionComposition ${path.basename(root)}:${change.relPath}`);
    }
  }
  console.log(`permission composition alignment complete (${total} component spec(s))`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (import.meta.url === entryUrl) {
  main();
}
