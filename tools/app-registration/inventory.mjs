#!/usr/bin/env node

/**
 * Registration inventory for every independent SDKWork application surface.
 *
 * The unit of registration is one manifest-bearing application root: a
 * repository root that carries `agent.app.config.json`, or a direct
 * `apps/<surface>` directory that carries its own manifest. That root is also
 * the unit the IAM bootstrap rules describe ("a multi-surface repository MUST
 * discover the repository manifest and each direct manifest-bearing apps/*
 * root"), and it is the root whose per-scope env files carry the public
 * application access token.
 *
 * The scan is read-only. It answers, for every root:
 *
 * - repository and app directory,
 * - surface id and manifest identity (`app.key`, display name, app type),
 * - the deploy application slug the registrar would request,
 * - the declared client surfaces whose token carrier is the
 *   `etc/client-env.materialization.json` declared profile matrix,
 * - whether the root must declare `backend.accessTokenPermissionScope`
 *   (`permissionScopeRequirement`): the requirement follows the client token
 *   carrier, so a server-only root is `notApplicable` (`serversOnly`), a root with
 *   client directories but no materialization declaration is
 *   `missingClientEnvConfiguration`, and only a root that actually mints a public
 *   client token is required to declare the scope,
 * - where each environment's `SDKWORK_DEPLOY_APPLICATION_ID` anchor can be
 *   written (the authored topology override layer, an authored `.env.<env>`,
 *   or nowhere), and which committed profile files carry the materialized
 *   public application token,
 * - the per-surface anchor sink of every declared surface rooted at the
 *   application root (`surfaceAnchors`): the surface's own anchor variable
 *   (`<base>_<SURFACE>`) and the profile files that carry its token. That is the
 *   registration granularity the factory standard requires — one deploy
 *   application, one anchor, and one token carrier per surface
 *   (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §5, §11).
 *
 * Usage:
 *   node sdkwork-specs/tools/app-registration/register-applications.mjs \
 *     --inventory app-registration-inventory.json
 *
 * @module app-registration/inventory
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  resolveApplicationAccessTokenEnvName,
  surfaceApplicationTokenEnvName,
} from '../app-access-token.mjs';
import {
  describeSurfaceNameMismatch,
  resolveDeployAppSurface,
  slugifyAppKey,
} from './contract.mjs';

export { describeSurfaceNameMismatch, resolveDeployAppSurface, slugifyAppKey };

/** Manifest file name that makes a directory an application root. */
export const APP_MANIFEST_FILE = 'agent.app.config.json';

/** Canonical registration environments (`ENVIRONMENT_SPEC` lifecycle names). */
export const REGISTRATION_ENVIRONMENTS = [
  'development',
  'test',
  'staging',
  'demo',
  'production',
];

/** Deployment profiles every client surface matrix covers. */
export const REGISTRATION_DEPLOYMENT_PROFILES = ['standalone', 'cloud'];

/** Directories never searched for application manifests. */
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.sdkwork',
  '.turbo',
  'backup',
  'build',
  'dist',
  'external',
  'generated',
  'node_modules',
  'sdks',
  'target',
]);

/** Token carrier layout per declared client surface `format`. */
const TOKEN_CARRIER_LAYOUTS = {
  vite: (appRoot, profileId) => path.join(appRoot, `.env.${profileId}`),
  flutter: (appRoot, profileId) => path.join(appRoot, 'env', `sdkwork.${profileId}.json`),
  'mini-program': (appRoot, profileId) =>
    path.join(appRoot, 'config', 'mini-program', `runtime-env.${profileId}.json`),
  'harmony-native': (appRoot, profileId) =>
    path.join(appRoot, 'config', 'app', `runtime-env.${profileId}.json`),
  native: (appRoot, profileId) =>
    path.join(appRoot, 'config', 'app', `runtime-env.${profileId}.json`),
};

/** Profile id of a deployment profile plus environment, e.g. `standalone.development`. */
export function clientProfileId(deploymentProfile, environment) {
  return `${deploymentProfile}.${environment}`;
}

/**
 * Why a manifest root must (or must not) declare `backend.accessTokenPermissionScope`.
 *
 * `accessTokenPermissionScope` is the default permission scope IAM stamps on the
 * **public application access token** a *client* surface presents. A root that
 * mints no such token has nothing to scope, so demanding the field from it asks
 * for a permission set that no runtime can ever use. The requirement therefore
 * follows the client token carrier, never the mere presence of a manifest:
 *
 * - `materialized` — a client token carrier exists: the repository's materializer
 *   declares an `accessToken` surface, or the app root carries materialized
 *   profile files. The scope is REQUIRED; an empty one is a defect.
 * - `declared` — no carrier exists, but the manifest already declares its own
 *   scope. Registration proceeds; the absent materialization is reported as a
 *   note, never as a scope defect.
 * - `missingClientEnvConfiguration` — client application directories exist under
 *   `apps/` but the repository declares no materialization, so the scope cannot
 *   be derived or honoured. Blocking: configure the materialization first.
 * - `notApplicable` — no carrier, no client surface, no declared scope: a
 *   server-only root (`serversOnly`). The requirement does not apply, and the
 *   registrar skips it instead of inventing a public token scope.
 */
export const PERMISSION_SCOPE_REQUIREMENTS = Object.freeze({
  MATERIALIZED: 'materialized',
  DECLARED: 'declared',
  MISSING_CLIENT_ENV_CONFIGURATION: 'missingClientEnvConfiguration',
  NOT_APPLICABLE: 'notApplicable',
});

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

/** Trimmed string list of a manifest array field, dropping empty entries. */
function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry.length > 0);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function manifestAppKey(manifest, appDirName) {
  const key = String(manifest?.app?.key ?? '').trim();
  if (key) {
    return key;
  }
  const name = String(manifest?.app?.name ?? '').trim();
  if (name) {
    return name;
  }
  return appDirName;
}

function manifestAppName(manifest, fallback) {
  const declared =
    String(manifest?.app?.displayName ?? '').trim()
    || String(manifest?.app?.name ?? '').trim()
    || String(manifest?.name ?? '').trim();
  return declared || fallback;
}

function manifestPermissionScope(manifest) {
  const scope = manifest?.backend?.accessTokenPermissionScope ?? manifest?.backend?.permissionScope;
  return Array.isArray(scope) ? scope.filter((entry) => typeof entry === 'string') : [];
}

/**
 * Read the authored domain sources of one lifecycle.
 *
 * The registrar normalizes and validates the value (`resolvePrimaryDomain`), so
 * the scan keeps every source separate instead of collapsing them here: a value
 * that is present but not a hostname must fail the item, not be silently
 * replaced by a lower-precedence source. `domain` is the highest-precedence raw
 * candidate and is retained for operators reading the inventory.
 * @param manifest - parsed `agent.app.config.json`
 * @param environment - canonical lifecycle
 * @returns the raw sources plus the resolved candidate and its origin
 */
function manifestEnvironmentDomainSources(manifest, environment) {
  const environments = manifest?.environments ?? {};
  const aliases = {
    development: ['development', 'dev'],
    test: ['test'],
    staging: ['staging'],
    demo: ['demo'],
    production: ['production', 'prod'],
  }[environment] ?? [environment];
  let sectionAlias = '';
  let section = {};
  for (const alias of aliases) {
    const candidate = environments[alias];
    if (candidate && typeof candidate === 'object') {
      sectionAlias = alias;
      section = candidate;
      break;
    }
  }
  const accessUrl = String(section?.accessUrl ?? '').trim();
  const deployUrl = String(section?.deployUrl ?? '').trim();
  const backendPrimaryDomain = String(manifest?.backend?.primaryDomain ?? '').trim();
  const backendDomain = String(manifest?.backend?.domain ?? '').trim();
  const candidates = [
    [sectionAlias ? `environments.${sectionAlias}.accessUrl` : '', accessUrl],
    [sectionAlias ? `environments.${sectionAlias}.deployUrl` : '', deployUrl],
    ['backend.primaryDomain', backendPrimaryDomain],
    ['backend.domain', backendDomain],
  ];
  const [source, domain] = candidates.find(([, value]) => value) ?? ['', ''];
  return { environmentSection: sectionAlias, accessUrl, deployUrl, domain, domainSource: source };
}

/**
 * Repository root that owns an application root.
 *
 * A manifest at the repository root owns itself; a manifest under `apps/` is
 * owned by its grandparent directory.
 * @param workspaceRoot - workspace root
 * @param appRoot - absolute application root that carries the manifest
 * @returns the absolute repository root
 */
export function resolveRepositoryRoot(workspaceRoot, appRoot) {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(appRoot));
  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.length >= 2 && segments[segments.length - 2] === 'apps') {
    return path.join(path.resolve(workspaceRoot), ...segments.slice(0, -2));
  }
  return appRoot;
}

/**
 * Enumerate the application roots under one workspace.
 * @param workspaceRoot - directory that contains the `sdkwork-*` repositories
 * @returns absolute application roots, sorted by workspace-relative path
 */
export function discoverApplicationRoots(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  if (!existsSync(root)) {
    throw new Error(`workspace root does not exist: ${root}`);
  }
  const roots = [];
  for (const repoEntry of readdirSync(root, { withFileTypes: true })) {
    if (!repoEntry.isDirectory() || IGNORED_DIRECTORY_NAMES.has(repoEntry.name)) {
      continue;
    }
    if (!repoEntry.name.startsWith('sdkwork-')) {
      continue;
    }
    const repoRoot = path.join(root, repoEntry.name);
    if (existsSync(path.join(repoRoot, APP_MANIFEST_FILE))) {
      roots.push(repoRoot);
    }
    const appsDir = path.join(repoRoot, 'apps');
    if (!existsSync(appsDir) || !statSync(appsDir).isDirectory()) {
      continue;
    }
    for (const appEntry of readdirSync(appsDir, { withFileTypes: true })) {
      if (!appEntry.isDirectory() || IGNORED_DIRECTORY_NAMES.has(appEntry.name)) {
        continue;
      }
      const appRoot = path.join(appsDir, appEntry.name);
      if (existsSync(path.join(appRoot, APP_MANIFEST_FILE))) {
        roots.push(appRoot);
      }
    }
  }
  return roots.sort((left, right) =>
    toPosix(path.relative(root, left)).localeCompare(toPosix(path.relative(root, right))),
  );
}

/**
 * Read the repository's declared client-surface matrix.
 *
 * `etc/client-env.materialization.json` is the only declaration of which
 * surfaces mint a public application token and from which environment variable
 * they take its `app_id`. A repository without the file declares no client
 * surface (a server-only repository).
 *
 * Each surface also carries its *anchor sink* facts here, because every shipped
 * surface is an independent deploy application with its own anchor
 * (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §5):
 *
 * - `baseAnchorEnvName` — the variable the declaration names (today
 *   `SDKWORK_DEPLOY_APPLICATION_ID`), which the one-anchor-per-repository mode
 *   writes;
 * - `surfaceAnchorEnvName` — the derived per-surface variable
 *   (`<base>_<SURFACE>`), which a per-surface registration writes and the
 *   materializer reads for that surface only;
 * - `profileFiles` — the surface's own profile carrier files, one per profile,
 *   excluding profiles the declaration excludes.
 * @param repoRoot - absolute repository root
 * @returns the declaration, or `null` when the repository declares none
 */
export function readClientEnvDeclaration(repoRoot) {
  const configPath = path.join(repoRoot, 'etc', 'client-env.materialization.json');
  if (!existsSync(configPath)) {
    return null;
  }
  const config = readJson(configPath);
  const surfaces = Array.isArray(config.surfaces) ? config.surfaces : [];
  return {
    configPath,
    application: String(config.application ?? '').trim(),
    surfaces: surfaces.map((surface) => {
      const appIdEnv = String(surface.accessToken?.appIdEnv ?? '').trim();
      const appIdLiteral = String(surface.accessToken?.appId ?? '').trim();
      const id = String(surface.id ?? '').trim();
      const format = String(surface.format ?? '').trim();
      const baseAnchorEnvName = resolveApplicationAccessTokenEnvName(surface.accessToken);
      const excludeProfiles = Array.isArray(surface.excludeProfiles)
        ? surface.excludeProfiles.map((profileId) => String(profileId).trim())
        : [];
      return {
        id,
        root: String(surface.root ?? '').trim(),
        format,
        runtimeTarget: String(surface.runtimeTarget ?? '').trim(),
        appIdEnv,
        appIdLiteral,
        // A surface is a *token* carrier only when it names the public token's
        // `app_id`; a server-profile surface (`format: none`) materializes runtime
        // env and mints no client token, so it never implies a permission scope.
        hasAccessToken: appIdEnv !== '' || appIdLiteral !== '',
        excludeProfiles,
        baseAnchorEnvName,
        surfaceAnchorEnvName: surfaceApplicationTokenEnvName(baseAnchorEnvName, id),
        profileFiles: surfaceProfileFiles(repoRoot, {
          format,
          root: String(surface.root ?? '').trim(),
          excludeProfiles,
        }),
      };
    }),
  };
}

/**
 * Profile carrier files a declared surface owns.
 *
 * These files are the surface's token carrier and therefore its anchor sink: one
 * profile per `<deployment-profile>.<environment>`, in the format's own layout
 * (`apps/<surface>/.env.<profile>` for vite, `env/sdkwork.<profile>.json` for
 * Flutter, the runtime-env documents for mini program and Harmony). A profile the
 * declaration excludes is not a sink, because the materializer never writes it.
 * @param repoRoot - absolute repository root
 * @param surface - declared surface facts (`format`, `root`, `excludeProfiles`)
 * @returns repo-relative profile file descriptors, sorted by profile id
 */
export function surfaceProfileFiles(repoRoot, surface) {
  const layout = TOKEN_CARRIER_LAYOUTS[surface.format];
  if (!layout) {
    return [];
  }
  const appRoot = path.resolve(repoRoot, surface.root || '.');
  const excluded = new Set(surface.excludeProfiles ?? []);
  const files = [];
  for (const deploymentProfile of REGISTRATION_DEPLOYMENT_PROFILES) {
    for (const environment of REGISTRATION_ENVIRONMENTS) {
      const profileId = clientProfileId(deploymentProfile, environment);
      if (excluded.has(profileId)) {
        continue;
      }
      files.push({
        profileId,
        path: toPosix(path.relative(repoRoot, layout(appRoot, profileId))),
      });
    }
  }
  return files;
}

function resolveAnchorSink(repoRoot, environment) {
  const candidates = REGISTRATION_DEPLOYMENT_PROFILES.map((deploymentProfile) => {
    const overridePath = path.join(
      repoRoot,
      'etc',
      'topology',
      'overrides',
      `${clientProfileId(deploymentProfile, environment)}.env`,
    );
    return { deploymentProfile, kind: 'topology-override', filePath: overridePath };
  }).filter((candidate) => existsSync(candidate.filePath));

  for (const dotEnvName of [`.env.${environment}`, '.env']) {
    const dotEnvPath = path.join(repoRoot, dotEnvName);
    if (existsSync(dotEnvPath)) {
      candidates.push({ deploymentProfile: '', kind: 'dotenv', filePath: dotEnvPath });
      break;
    }
  }
  return candidates;
}

function countMaterializedProfiles(appRoot, format) {
  const layout = TOKEN_CARRIER_LAYOUTS[format];
  if (!layout) {
    return { present: [], missing: [] };
  }
  const present = [];
  const missing = [];
  for (const deploymentProfile of REGISTRATION_DEPLOYMENT_PROFILES) {
    for (const environment of REGISTRATION_ENVIRONMENTS) {
      const profileId = clientProfileId(deploymentProfile, environment);
      const filePath = layout(appRoot, profileId);
      (existsSync(filePath) ? present : missing).push(profileId);
    }
  }
  return { present, missing };
}

/**
 * Materialized profile files that already exist under one application root.
 *
 * A repository that carries profile files but no `etc/client-env.materialization.json`
 * still holds a client token carrier in the only place that matters: the tracked
 * profile file the app reads at runtime. Detecting them keeps such a repository on
 * the "scope required" side instead of misreading it as server-only.
 * @param workspaceRoot - workspace root (for workspace-relative reporting)
 * @param appRoot - absolute application root
 * @returns the carrier files that exist, with their format and profile id
 */
function findProfileCarrierFiles(workspaceRoot, appRoot) {
  const found = [];
  for (const [format, layout] of Object.entries(TOKEN_CARRIER_LAYOUTS)) {
    for (const deploymentProfile of REGISTRATION_DEPLOYMENT_PROFILES) {
      for (const environment of REGISTRATION_ENVIRONMENTS) {
        const profileId = clientProfileId(deploymentProfile, environment);
        const filePath = layout(appRoot, profileId);
        if (existsSync(filePath)) {
          found.push({ format, profileId, path: toPosix(path.relative(workspaceRoot, filePath)) });
        }
      }
    }
  }
  return found;
}

/**
 * Client application directories directly under one repository's `apps/`.
 *
 * These are the directories a public client token would be delivered to, whether
 * or not they carry a manifest today: a repository that ships `apps/<surface>`
 * directories has a client face even when the surface is still empty scaffolding.
 * @param repoRoot - absolute repository root
 * @returns repository-relative `apps/<surface>` paths, sorted
 */
export function listClientAppDirectories(repoRoot) {
  const appsDir = path.join(repoRoot, 'apps');
  if (!existsSync(appsDir) || !statSync(appsDir).isDirectory()) {
    return [];
  }
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORY_NAMES.has(entry.name))
    .map((entry) => `apps/${entry.name}`)
    .sort();
}

/**
 * Decide whether one manifest root must declare `backend.accessTokenPermissionScope`.
 *
 * The decision is scoped to the client surface, not to the manifest: a server-only
 * root gets `notApplicable` (never a defect), a root whose client env was never
 * configured gets its own `missingClientEnvConfiguration` classification instead of
 * a scope defect, and only a root that actually mints a public client token is
 * required to declare the scope.
 * @param facts - one root's client surface facts
 * @param facts.workspaceRoot - workspace root (for workspace-relative carrier paths)
 * @param facts.appRoot - absolute application root
 * @param facts.declaration - repository client-env declaration, or `null`
 * @param facts.permissionScope - the scope the manifest declares (may be empty)
 * @param facts.clientAppDirectories - repository-relative `apps/<surface>` paths
 * @returns the requirement facts recorded on the inventory entry
 */
export function describePermissionScopeRequirement(facts) {
  const {
    workspaceRoot,
    appRoot,
    declaration,
    permissionScope,
    clientAppDirectories,
  } = facts;
  const declaredSurfaces = declaration?.surfaces ?? [];
  const accessTokenSurfaces = declaredSurfaces.filter((surface) => surface.hasAccessToken);
  const profileFiles = findProfileCarrierFiles(workspaceRoot, appRoot);
  const clientSurface = {
    kind: clientAppDirectories.length > 0 ? 'apps-directories' : 'none',
    directories: clientAppDirectories,
    materializationDeclared: Boolean(declaration),
  };
  const carrier = {
    materializationSurfaces: accessTokenSurfaces.map((surface) => surface.id),
    profileFiles,
  };
  const base = {
    requiresPermissionScope: false,
    requiresClientEnvMaterialization: false,
    serversOnly: false,
    clientSurface,
    carrier,
    notes: [],
  };

  if (accessTokenSurfaces.length > 0 || profileFiles.length > 0) {
    const origin = accessTokenSurfaces.length > 0
      ? `etc/client-env.materialization.json surface(s) ${accessTokenSurfaces.map((surface) => surface.id).join(', ')} declare accessToken`
      : `profile carrier file(s) ${profileFiles.map((entry) => entry.path).join(', ')} exist`;
    return {
      ...base,
      kind: PERMISSION_SCOPE_REQUIREMENTS.MATERIALIZED,
      requiresPermissionScope: true,
      reason: `${origin}; the root mints a public client token, so backend.accessTokenPermissionScope is required`,
    };
  }

  if (permissionScope.length > 0) {
    if (clientSurface.kind === 'apps-directories') {
      base.notes.push(
        `client application directories (${clientAppDirectories.join(', ')}) exist but the repository `
        + 'declares no etc/client-env.materialization.json accessToken carrier, so no public token is '
        + 'minted for them; registration is not blocked by that gap',
      );
    }
    return {
      ...base,
      kind: PERMISSION_SCOPE_REQUIREMENTS.DECLARED,
      reason:
        'no client token carrier exists, but the manifest declares backend.accessTokenPermissionScope '
        + 'itself, so the requirement is satisfied by declaration',
    };
  }

  if (clientSurface.kind === 'apps-directories') {
    return {
      ...base,
      kind: PERMISSION_SCOPE_REQUIREMENTS.MISSING_CLIENT_ENV_CONFIGURATION,
      requiresClientEnvMaterialization: true,
      reason:
        `client application directories (${clientAppDirectories.join(', ')}) exist but the repository `
        + 'declares no etc/client-env.materialization.json, so neither a public token nor its '
        + 'permission scope can be derived; configure the client env materialization first',
    };
  }

  return {
    ...base,
    kind: PERMISSION_SCOPE_REQUIREMENTS.NOT_APPLICABLE,
    serversOnly: true,
    reason:
      'server-only root: no client application directories, no accessToken carrier, and no declared '
      + 'scope, so no public token exists for accessTokenPermissionScope to bound',
  };
}

/**
 * Surface anchors owned by one application root.
 *
 * The registration granularity is the surface
 * (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §5, §11): an `apps/<surface>` manifest
 * root is one surface, so its anchor may only reach that surface's own profile
 * files. A repository-root manifest owns the surfaces rooted at `.` — usually
 * none, because the inner surfaces are their own manifest roots.
 * @param appRoot - absolute application root
 * @param declaration - repository client-env declaration, or `null`
 * @returns one anchor record per surface rooted at this application root
 */
function describeOwnSurfaceAnchors(appRoot, declaration) {
  if (!declaration) {
    return [];
  }
  const relativeAppRoot = toPosix(path.relative(declaration.repoRoot, appRoot)) || '.';
  return declaration.surfaces
    .filter((surface) => (surface.root.replace(/\/+$/u, '') || '.') === relativeAppRoot)
    .map((surface) => ({
      id: surface.id,
      root: surface.root,
      format: surface.format,
      runtimeTarget: surface.runtimeTarget,
      baseAnchorEnvName: surface.baseAnchorEnvName,
      surfaceAnchorEnvName: surface.surfaceAnchorEnvName,
      profileFiles: surface.profileFiles.map((file) => ({
        ...file,
        present: existsSync(path.join(declaration.repoRoot, file.path)),
      })),
    }));
}

/**
 * Describe where one application surface's public token lives today.
 *
 * The carrier is resolved at repository granularity: `materialize-client-env.mjs`
 * runs per repository and bakes one deploy anchor into every declared surface, so
 * a repository-root application whose client surfaces live under `apps/*` still
 * owns those tokens even though no declared surface is rooted at the repository
 * root itself.
 * @param workspaceRoot - workspace root
 * @param appRoot - absolute application root
 * @param declaration - repository client-env declaration, or `null`
 * @returns carrier facts for the inventory entry
 */
function describeTokenCarrier(workspaceRoot, appRoot, declaration) {
  if (!declaration) {
    return {
      kind: 'none',
      mintsPublicToken: false,
      accessTokenSurfaceIds: [],
      reason: 'repository declares no etc/client-env.materialization.json',
      configPath: '',
      surfaces: [],
      repositorySurfaces: [],
    };
  }
  const relativeAppRoot = toPosix(path.relative(declaration.repoRoot, appRoot)) || '.';
  const matched = declaration.surfaces.filter((surface) => {
    const root = surface.root.replace(/\/+$/u, '') || '.';
    return root === relativeAppRoot;
  });
  const surfaces = matched.map((surface) => ({
    id: surface.id,
    format: surface.format,
    runtimeTarget: surface.runtimeTarget,
    appIdEnv: surface.appIdEnv,
    appIdLiteral: surface.appIdLiteral,
    hasAccessToken: surface.hasAccessToken,
    tokenKey: 'SDKWORK_ACCESS_TOKEN',
    profiles: countMaterializedProfiles(appRoot, surface.format),
  }));
  // A declared surface only implies a public client token when it carries an
  // `accessToken` identity; `format: none` server surfaces materialize runtime env
  // and never mint one, so the repository is still server-only for registration.
  const accessTokenSurfaceIds = declaration.surfaces
    .filter((surface) => surface.hasAccessToken)
    .map((surface) => surface.id);
  return {
    kind: declaration.surfaces.length > 0 ? 'client-env-materializer' : 'none',
    mintsPublicToken: accessTokenSurfaceIds.length > 0,
    accessTokenSurfaceIds,
    reason:
      surfaces.length > 0
        ? ''
        : `the repository's declared client surfaces are rooted at ${declaration.surfaces
          .map((surface) => surface.root)
          .join(', ')}; this application root owns the repository-level anchor they materialize`,
    configPath: toPosix(path.relative(workspaceRoot, declaration.configPath)),
    surfaces,
    repositorySurfaces: declaration.surfaces.map((surface) => ({
      id: surface.id,
      root: surface.root,
      format: surface.format,
      runtimeTarget: surface.runtimeTarget,
      appIdEnv: surface.appIdEnv,
      hasAccessToken: surface.hasAccessToken,
      baseAnchorEnvName: surface.baseAnchorEnvName,
      surfaceAnchorEnvName: surface.surfaceAnchorEnvName,
      profileFiles: surface.profileFiles.map((file) => ({
        ...file,
        present: existsSync(path.join(declaration.repoRoot, file.path)),
      })),
    })),
  };
}

/**
 * Build the registration inventory for a workspace.
 *
 * Deterministic: the entry order, every path, and every derived slug depend only
 * on the workspace contents. Re-running on an unchanged workspace produces the
 * same document, which is what makes the plan (and the deterministic idempotency
 * keys derived from it) reproducible.
 * @param options - workspace root and the repositories to scan
 * @returns the inventory document
 */
export function buildRegistrationInventory(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const roots = discoverApplicationRoots(workspaceRoot);
  const declarations = new Map();
  const clientAppDirectories = new Map();
  const entries = [];

  for (const appRoot of roots) {
    const repoRoot = resolveRepositoryRoot(workspaceRoot, appRoot);
    const relativeAppDir = toPosix(path.relative(repoRoot, appRoot)) || '.';
    const appDirName = path.basename(appRoot);
    const manifestPath = path.join(appRoot, APP_MANIFEST_FILE);
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch (error) {
      entries.push({
        id: toPosix(path.relative(workspaceRoot, appRoot)),
        repo: path.basename(repoRoot),
        appDir: relativeAppDir,
        manifestPath: toPosix(path.relative(workspaceRoot, manifestPath)),
        parseError: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!declarations.has(repoRoot)) {
      const declaration = readClientEnvDeclaration(repoRoot);
      declarations.set(
        repoRoot,
        declaration ? { ...declaration, repoRoot } : null,
      );
    }
    const declaration = declarations.get(repoRoot);
    if (!clientAppDirectories.has(repoRoot)) {
      clientAppDirectories.set(repoRoot, listClientAppDirectories(repoRoot));
    }
    const appDirectories = clientAppDirectories.get(repoRoot);

    const appKey = manifestAppKey(manifest, appDirName);
    const appName = manifestAppName(manifest, appKey);
    const permissionScope = manifestPermissionScope(manifest);
    const tokenCarrier = describeTokenCarrier(workspaceRoot, appRoot, declaration);
    const surfaceAnchors = describeOwnSurfaceAnchors(appRoot, declaration);
    const permissionScopeRequirement = describePermissionScopeRequirement({
      workspaceRoot,
      appRoot,
      declaration,
      permissionScope,
      clientAppDirectories: appDirectories,
    });
    const slugFromKey = slugifyAppKey(appKey);
    const slugFromName = slugifyAppKey(manifest?.app?.name ?? '');
    const slugFromDir = slugifyAppKey(appDirName);
    const slug = slugFromKey || slugFromName || slugFromDir;
    const environments = {};
    for (const environment of REGISTRATION_ENVIRONMENTS) {
      environments[environment] = {
        ...manifestEnvironmentDomainSources(manifest, environment),
        anchorSinks: resolveAnchorSink(repoRoot, environment)
          .map((sink) => ({
            deploymentProfile: sink.deploymentProfile,
            kind: sink.kind,
            path: toPosix(path.relative(workspaceRoot, sink.filePath)),
          })),
      };
    }

    // The surface authority is the manifest runtime + delivery metadata, not the
    // coarse `app.appType` (`APP_MANIFEST_SPEC.md` §6.1): Flutter, mini program,
    // native mobile, and API delivery are indistinguishable in `appType` alone.
    const surface = resolveDeployAppSurface({
      appType: manifest?.app?.appType,
      runtimeFamily: manifest?.runtime?.family,
      runtimeFramework: manifest?.runtime?.framework,
      // `defaultArchitecture` is the legacy single-architecture spelling of the
      // same fact (`APP_MANIFEST_SPEC.md` §6), and the IAM bootstrap framework
      // reads it too, so both provisioners must classify it identically.
      clientArchitectures: [
        ...asStringList(manifest?.runtime?.clientArchitectures),
        ...asStringList([manifest?.runtime?.defaultArchitecture]),
      ],
      publishPlatforms: manifest?.publish?.platforms,
      runtimeTargets: (manifest?.artifacts?.installConfig?.packages ?? [])
        .map((entry) => entry?.runtimeTarget),
    });

    entries.push({
      id: toPosix(path.relative(workspaceRoot, appRoot)),
      repo: path.basename(repoRoot),
      appDir: relativeAppDir,
      manifestPath: toPosix(path.relative(workspaceRoot, manifestPath)),
      appKey,
      appName,
      displayName: String(manifest?.app?.displayName ?? '').trim(),
      appType: String(manifest?.app?.appType ?? '').trim(),
      runtimeFamily: String(manifest?.runtime?.family ?? '').trim(),
      runtimeFramework: String(manifest?.runtime?.framework ?? '').trim(),
      clientArchitectures: asStringList(manifest?.runtime?.clientArchitectures),
      publishPlatforms: asStringList(manifest?.publish?.platforms),
      runtimeTargets: asStringList(
        (manifest?.artifacts?.installConfig?.packages ?? []).map((entry) => entry?.runtimeTarget),
      ),
      applicationType: surface.applicationType,
      deployAppKind: surface.deployAppKind,
      deployAppKindSource: surface.deployAppKindSource,
      canonicalAppType: surface.canonicalAppType,
      appTypeDeclared: surface.appTypeDeclared,
      appTypeWarning: surface.appTypeWarning,
      surfaceNotes: surface.notes,
      surfaceDefects: surface.defects,
      surfaceNameWarning: describeSurfaceNameMismatch(relativeAppDir, surface.deployAppKind),
      backendAppId: String(manifest?.backend?.appId ?? '').trim(),
      backendPrimaryDomain: String(manifest?.backend?.primaryDomain ?? '').trim(),
      backendDomain: String(manifest?.backend?.domain ?? '').trim(),
      tenantId: String(manifest?.backend?.tenantId ?? '').trim(),
      organizationId: String(manifest?.backend?.organizationId ?? '').trim(),
      permissionScope,
      permissionScopeCount: permissionScope.length,
      permissionScopeRequirement,
      clientSurface: permissionScopeRequirement.clientSurface,
      serversOnly: permissionScopeRequirement.serversOnly,
      slug,
      slugSource: slugFromKey ? 'app.key' : slugFromName ? 'app.name' : 'directory',
      environments,
      tokenCarrier,
      // Per-surface registration facts: each record is one surface this root
      // registered with its own deploy application, its own anchor variable, and
      // its own profile carrier files.
      surfaceAnchors,
    });
  }

  const slugs = new Map();
  for (const entry of entries) {
    if (!entry.slug) {
      continue;
    }
    const bucket = slugs.get(entry.slug) ?? [];
    bucket.push(entry.id);
    slugs.set(entry.slug, bucket);
  }
  const duplicateSlugs = [...slugs.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([slug, ids]) => ({ slug, ids }));

  const parsed = entries.filter((entry) => !entry.parseError);
  return {
    schemaVersion: 1,
    kind: 'sdkwork.app-registration-inventory',
    workspaceRoot: toPosix(workspaceRoot),
    generatedAt: new Date().toISOString(),
    environments: REGISTRATION_ENVIRONMENTS,
    deploymentProfiles: REGISTRATION_DEPLOYMENT_PROFILES,
    counts: {
      applicationRoots: entries.length,
      parsedManifests: parsed.length,
      parseErrors: entries.length - parsed.length,
      repositories: new Set(
        parsed.map((entry) => entry.repo),
      ).size,
      repositoriesWithClientEnv: new Set(
        parsed.filter((entry) => entry.tokenCarrier?.kind === 'client-env-materializer')
          .map((entry) => entry.repo),
      ).size,
      bootstrapReady: parsed.filter(
        (entry) => entry.permissionScopeCount > 0 && entry.applicationType !== '',
      ).length,
      // Raw declaration count: how many manifests carry the field at all. It is a
      // fact about the manifest, not a defect count — see
      // `missingPermissionScopeRequired` for the roots that actually need one.
      missingPermissionScope: parsed.filter((entry) => entry.permissionScopeCount === 0).length,
      missingPermissionScopeRequired: parsed.filter(
        (entry) => entry.permissionScopeRequirement?.requiresPermissionScope
          && entry.permissionScopeCount === 0,
      ).length,
      missingClientEnvConfiguration: parsed.filter(
        (entry) => entry.permissionScopeRequirement?.kind === 'missingClientEnvConfiguration',
      ).length,
      serversOnly: parsed.filter((entry) => entry.permissionScopeRequirement?.serversOnly).length,
      scopeRequirement: {
        materialized: parsed.filter(
          (entry) => entry.permissionScopeRequirement?.kind === 'materialized',
        ).length,
        declared: parsed.filter(
          (entry) => entry.permissionScopeRequirement?.kind === 'declared',
        ).length,
        missingClientEnvConfiguration: parsed.filter(
          (entry) => entry.permissionScopeRequirement?.kind === 'missingClientEnvConfiguration',
        ).length,
        notApplicable: parsed.filter(
          (entry) => entry.permissionScopeRequirement?.kind === 'notApplicable',
        ).length,
      },
      missingApplicationType: parsed.filter((entry) => entry.applicationType === '').length,
      // Surface resolution: a root whose manifest facts do not identify exactly
      // one endpoint surface cannot be registered; it is reported here instead of
      // silently becoming an API service.
      missingDeployAppKind: parsed.filter((entry) => !entry.deployAppKind).length,
      appTypeWarnings: parsed.filter((entry) => entry.appTypeWarning).length,
      surfaceNameWarnings: parsed.filter((entry) => entry.surfaceNameWarning).length,
      appTypeContradictions: parsed.filter(
        (entry) => entry.canonicalAppType !== '' && entry.appType !== entry.canonicalAppType,
      ).length,
      deployAppKinds: parsed.reduce((tally, entry) => {
        if (entry.deployAppKind) {
          tally[entry.deployAppKind] = (tally[entry.deployAppKind] ?? 0) + 1;
        }
        return tally;
      }, {}),
      withClientTokenCarrier: parsed.filter(
        (entry) => entry.tokenCarrier?.kind === 'client-env-materializer',
      ).length,
      withPublicTokenCarrier: parsed.filter(
        (entry) => entry.tokenCarrier?.mintsPublicToken === true,
      ).length,
      withAnchorSink: parsed.filter((entry) =>
        Object.values(entry.environments).every((environment) => environment.anchorSinks.length > 0),
      ).length,
      // Surface anchors: every surface that registers as its own deploy
      // application owns an anchor variable and a profile file set.
      surfaceAnchors: parsed.reduce(
        (total, entry) => total + (entry.surfaceAnchors?.length ?? 0),
        0,
      ),
      entriesWithSurfaceAnchor: parsed.filter(
        (entry) => (entry.surfaceAnchors?.length ?? 0) > 0,
      ).length,
      duplicateSlugs: duplicateSlugs.length,
      credentialEntrySurfaces: parsed.reduce(
        (total, entry) => total + (entry.tokenCarrier?.surfaces?.length ?? 0),
        0,
      ),
    },
    duplicateSlugs,
    entries,
  };
}
