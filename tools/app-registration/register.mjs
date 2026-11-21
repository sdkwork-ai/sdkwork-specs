#!/usr/bin/env node

/**
 * Registrar: ensure Deploy application →IAM installation →installation
 * environment →anchored environment, for every application × environment in the
 * inventory.
 *
 * # Identity model (one installation, one row per lifecycle)
 *
 * A deploy application is environment-independent (`uk_deploy_app_tenant_slug` is
 * scoped by tenant, not by lifecycle) and IAM binds exactly one installation to
 * it (`uk_iam_application_installation_deploy`). A lifecycle is therefore **not**
 * a second installation or a second anchor: it is one
 * `iam_application_installation_environment` row under that installation
 * (`env_key` + `primary_domain` + `env_status`). Registering `development` and
 * then `production` keeps one deploy app, one anchor, one installation, and adds
 * one row per lifecycle.
 *
 * # Sequence per item (never reordered)
 *
 * 1. **Plan** —derive the deploy slug, the IAM application type, the permission
 *    scope, the primary domain, the deterministic idempotency keys, and the
 *    anchor sinks. A plan defect (no slug, no `app.appType`, no permission scope
 *    where one is required, missing client env configuration, no primary domain
 *    source) is reported as a failure instead of being skipped: an item that
 *    cannot be anchored or enabled must not reach Deploy or IAM. A **server-only**
 *    root — no client application directories, no `accessToken` carrier, and no
 *    declared scope — is the one planned skip: it mints no public client token, so
 *    there is no scope for it to declare, and the report records the reason
 *    (`--include-servers-only` registers it anyway).
 * 2. **Deploy ensure** —resolve the application by exact slug through
 *    `apps.list`, otherwise `apps.create` with
 *    `Idempotency-Key: sdkwork-app-register:<environment>:<slug>` and
 *    `X-Content-SHA256: sha256(body bytes)`. A `409` (slug already taken) is
 *    resolved by re-reading the row, so a concurrent creator is adopted instead
 *    of producing a second application.
 * 3. **Anchor resolution** —the decimal `deploy_app.id`, read from
 *    `AppResponse.deployApplicationId` on the row the deploy ensure step just
 *    returned (list, retrieve, or create). Order: the anchor recorded in the
 *    app's own environment configuration, then an explicit `--anchor-map`
 *    override, then that response field; in `--anchor-kind=deploy-application-uuid`
 *    mode the addressable uuid replaces the response field. Two disagreeing
 *    sources are a hard failure: the registrar never picks one.
 * 4. **IAM provision** —`POST /backend/v3/api/iam/installations` with the
 *    anchor, the derived `provisioningIdempotencyKey`, the application type, the
 *    manifest permission scope, and the resolved `primaryDomain` (enable refuses a
 *    blank one).
 * 5. **Environment row** —`PUT /backend/v3/api/iam/tenants/{tenantId}/installations/{installationId}/environments/{envKey}`
 *    with `primaryDomain` + `envStatus=active`, keyed by the row identity and
 *    deduplicated per installation, so several surfaces of one repository do not
 *    create a second row.
 * 6. **Enable + verify** —enable only after the environment row exists; the
 *    installation must report `enabled` and echo the same anchor. A response that
 *    cannot prove the binding is refused (see `--allow-unverified-iam-binding`).
 * 7. **Environment hand-off** —write the anchor into the authored env layer,
 *    regenerate the generated topology profile, and re-run the client-env
 *    materializer so each profile's public token carries the anchor. The
 *    granularity follows the registration granularity: a **surface-scoped** run
 *    (`--scope all` / `--scope surfaces`) writes the surface-scoped anchor
 *    variable `<SDKWORK_DEPLOY_APPLICATION_ID>_<SURFACE>` and materializes only
 *    that surface (`--surface`), so several surfaces of one repository keep
 *    independent anchors; a **repository-scoped** run (`--scope repository`,
 *    the default) keeps the one-anchor-per-repository behavior the committed
 *    profiles were materialized with.
 *
 * Failure of one item is recorded and the run continues; the exit code reflects
 * the failure count. Nothing is ever skipped silently: every item ends as
 * `created`, `reused`, `failed`, or `skipped` (with its reason recorded), and
 * every failure carries a diagnostic naming the route or the variable.
 *
 * @module app-registration/register
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  DEPLOY_APPLICATION_ID_ENV,
  IAM_TENANT_APPLICATION_TYPES,
  NEW_REGISTRATION_DEPLOY_APP_KINDS,
  PRIMARY_DOMAIN_SOURCES,
  RegistrationConfigurationError,
  applicationTypeForDeployKind,
  assertDeployApplicationIdForKind,
  buildDeployAppCreateBody,
  buildInstallationProvisionBody,
  defaultDeploymentProfile,
  deployAppCreateIdempotencyKey,
  environmentUpsertIdempotencyKey,
  formatRegistrationItemLabel,
  normalizeEnvironment,
  readDeployAppItem,
  readInstallationItem,
  replaceManifestAppType,
  resolveDeploySlug,
  resolvePrimaryDomain,
  tenantApplicationInstanceKey,
  verifyDeployAppKind,
} from './contract.mjs';
import { DeployApiError, createDeployApplicationClient, findAppBySlug } from './deploy-client.mjs';
import { IamApiError, createIamApplicationClient } from './iam-client.mjs';
import { readRecordedAnchor, writeAnchorEnv, DEPLOY_APPLICATION_UUID_ENV } from './env-anchor.mjs';
import { PERMISSION_SCOPE_REQUIREMENTS } from './inventory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.resolve(__dirname, '..');

/** Fatal registration failure (configuration or unusable inventory). */
export class RegistrationAbortedError extends Error {
  /**
   * @param message - operator-facing message
   * @param details - structured detail
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'RegistrationAbortedError';
    this.details = details;
  }
}

function trim(value) {
  return String(value ?? '').trim();
}

function sleepDefault(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Write the derived `app.appType` back into one application manifest.
 *
 * Only the explicit `--fix-app-types` repair calls this: the declared type
 * contradicts the surface the runtime facts prove, and the operator asked for the
 * derivation to be persisted. The path is confined to the selected workspace and
 * the rewrite preserves the authored formatting (see `replaceManifestAppType`).
 * @param entry - inventory entry (workspace-relative `manifestPath`)
 * @param nextAppType - canonical app type to write
 * @param options - run options carrying `workspaceRoot`
 * @returns the repair record, or `null` when the file cannot be repaired
 */
function repairManifestAppType(entry, nextAppType, options) {
  const workspaceRoot = trim(options.workspaceRoot);
  const manifestPath = trim(entry.manifestPath);
  if (!workspaceRoot || !manifestPath) {
    return null;
  }
  const absoluteRoot = path.resolve(workspaceRoot);
  const absoluteManifest = path.resolve(absoluteRoot, manifestPath);
  const relative = path.relative(absoluteRoot, absoluteManifest);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  let text;
  try {
    text = readFileSync(absoluteManifest, 'utf8');
  } catch {
    return null;
  }
  const patched = replaceManifestAppType(text, nextAppType);
  if (!patched) {
    return null;
  }
  writeFileSync(absoluteManifest, patched.text, 'utf8');
  return {
    manifestPath: relative.split(path.sep).join('/'),
    previous: patched.previous,
    appType: trim(nextAppType).toUpperCase(),
  };
}

/**
 * Select the inventory entries this run registers.
 * @param inventory - inventory document
 * @param options - scope, filter, explicit ids
 * @returns the selected entries
 */
export function selectTargets(inventory, options = {}) {
  const scope = trim(options.scope) || 'repository';
  if (!['repository', 'all', 'repo-root', 'surfaces'].includes(scope)) {
    throw new RegistrationConfigurationError(
      `unsupported scope ${JSON.stringify(scope)}; expected repository, all, repo-root, or surfaces`,
    );
  }
  let pattern = null;
  if (trim(options.filterPattern)) {
    try {
      pattern = new RegExp(trim(options.filterPattern), 'iu');
    } catch (error) {
      throw new RegistrationConfigurationError(
        `invalid --filter regular expression: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const only = new Set((options.only ?? []).map((value) => trim(value)).filter(Boolean));
  const selected = (inventory.entries ?? []).filter((entry) => {
    if (entry.parseError) {
      return false;
    }
    if (only.size > 0 && !only.has(entry.id)) {
      return false;
    }
    if (scope === 'repo-root' && entry.appDir !== '.') {
      return false;
    }
    if (scope === 'surfaces' && entry.appDir === '.') {
      return false;
    }
    if (pattern) {
      const haystack = `${entry.id} ${entry.appKey} ${entry.appName} ${entry.slug ?? ''}`;
      if (!pattern.test(haystack)) {
        return false;
      }
    }
    return true;
  });
  if (scope !== 'repository') {
    return selected;
  }
  // One registration per repository: the repository-root manifest when it
  // exists, otherwise the first surface manifest. This is the legacy
  // one-anchor-per-repository mode the committed profiles were materialized
  // with. `--scope all` / `--scope surfaces` register each manifest root — and
  // therefore each surface — with its own deploy application and its own anchor
  // (see `resolveAnchorGroup`).
  const primaryByRepo = new Map();
  for (const entry of selected) {
    const current = primaryByRepo.get(entry.repo);
    if (!current) {
      primaryByRepo.set(entry.repo, entry);
      continue;
    }
    if (current.appDir !== '.' && entry.appDir === '.') {
      primaryByRepo.set(entry.repo, entry);
    }
  }
  const primaryIds = new Set([...primaryByRepo.values()].map((entry) => entry.id));
  return selected.filter((entry) => primaryIds.has(entry.id));
}

/**
 * Flag items whose primary domain is claimed more than once in this run.
 *
 * IAM keeps `(tenant_id, primary_domain)` unique among live
 * `iam_application_installation_environment` rows
 * (`upsert_installation_environment` raises `conflict: primaryDomain '...' is
 * already registered to environment '...'`). In a batch, whichever item upserts
 * second would fail, and with concurrency that victim is not deterministic. Both
 * items are therefore reported as plan defects so the operator fixes the authored
 * source (usually by passing `--primary-domain` with a `{slug}` placeholder)
 * instead of chasing a mid-batch `409`.
 * @param plans - every planned item of the run
 */
function markDuplicatePrimaryDomains(plans) {
  const byDomain = new Map();
  for (const { plan } of plans) {
    if (!plan.primaryDomain || plan.defects.length > 0) {
      continue;
    }
    const key = `${plan.tenantId}:${plan.primaryDomain.toLowerCase()}`;
    const bucket = byDomain.get(key) ?? [];
    bucket.push(plan);
    byDomain.set(key, bucket);
  }
  for (const bucket of byDomain.values()) {
    // Several manifest roots that resolve to one deploy slug are one
    // installation, hence one environment row: sharing the domain there is the
    // normal multi-surface case, not a conflict.
    const distinctSlugs = new Set(bucket.map((plan) => plan.slug));
    if (distinctSlugs.size < 2) {
      continue;
    }
    const labels = bucket.map((plan) => plan.label);
    for (const plan of bucket) {
      const others = labels.filter((label) => label !== plan.label);
      plan.defects.push(
        `${plan.label}: primaryDomain ${plan.primaryDomain} (source ${plan.primaryDomainSource}) is `
        + `also claimed by ${others.join(', ')}. IAM keeps (tenant_id, primary_domain) unique across `
        + 'installation environment rows, so only one of them could ever be registered. Pass '
        + '--primary-domain with a per-application placeholder such as "{slug}.{env}.sdkwork.com".',
      );
    }
  }
}

/** Scopes that register every manifest root as its own deploy application. */
const SURFACE_SCOPES = new Set(['all', 'surfaces']);

/**
 * Anchor granularity of one planned item.
 *
 * `APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §5 makes one endpoint surface one
 * deploy application with its own `app_id`; §11 repeats the runbook per surface.
 * A scope that selects every manifest root therefore anchors each surface
 * separately: its anchor may only reach that surface's own profile files. The
 * default `repository` scope keeps the legacy one-anchor-per-repository behavior
 * (the anchor the committed profiles were materialized with), and so does a
 * repository whose only manifest is the repository root — it has no surface
 * manifest to register one by one.
 *
 * The decision is taken from the repository inventory, never from the selected
 * subset: `--only <root>` must not let one repository-root manifest overwrite the
 * anchors of surfaces it did not register.
 * @param scope - selected registration scope
 * @param repoEntries - every parsed inventory entry of the same repository
 * @returns `surface` or `repository`
 */
export function resolveAnchorGroup(scope, repoEntries) {
  const selected = trim(scope) || 'repository';
  if (!SURFACE_SCOPES.has(selected)) {
    return 'repository';
  }
  if (selected === 'surfaces') {
    return 'surface';
  }
  const hasSurfaceManifest = (repoEntries ?? []).some(
    (candidate) => trim(candidate.appDir) !== '' && candidate.appDir !== '.',
  );
  return hasSurfaceManifest ? 'surface' : 'repository';
}

/**
 * Anchor and uuid bookkeeping keys for one recorded identity.
 *
 * A surface-scoped anchor keeps the suffix of its variable, so
 * `SDKWORK_DEPLOY_APPLICATION_ID_SDKWORK_IM_PC` pairs with
 * `SDKWORK_DEPLOY_APPLICATION_UUID_SDKWORK_IM_PC`; the repository-level anchor
 * keeps the canonical names.
 * @param anchorEnvName - surface-scoped anchor variable, or `''` for the repository
 * @param baseAnchorEnvName - the variable named by the declaration
 * @returns the anchor key and the uuid bookkeeping key
 */
export function anchorRecordKeys(anchorEnvName, baseAnchorEnvName = DEPLOY_APPLICATION_ID_ENV) {
  const surfaceKey = trim(anchorEnvName);
  const base = trim(baseAnchorEnvName) || DEPLOY_APPLICATION_ID_ENV;
  if (!surfaceKey || surfaceKey === base || !surfaceKey.startsWith(base)) {
    return { anchorKey: base, uuidKey: DEPLOY_APPLICATION_UUID_ENV };
  }
  return {
    anchorKey: surfaceKey,
    uuidKey: `${DEPLOY_APPLICATION_UUID_ENV}${surfaceKey.slice(base.length)}`,
  };
}

/**
 * The surfaces one planned item may anchor and materialize.
 *
 * A `surface` group materializes only the surfaces rooted at this application
 * root (its own surfaces); a `repository` group materializes every declared
 * surface of the repository, which is what one anchor per repository means.
 * Declared `format: none` surfaces materialize no client artifact and are
 * recorded separately instead of being handed to the materializer.
 * @param anchorGroup - `surface` or `repository`
 * @param entry - inventory entry
 * @returns the materializable surface records plus the excluded surface ids
 */
function planSurfaceGroup(anchorGroup, entry) {
  const declared = anchorGroup === 'surface'
    ? (entry.surfaceAnchors ?? [])
    : (entry.tokenCarrier?.repositorySurfaces ?? []);
  const surfaces = [];
  const excluded = [];
  for (const surface of declared) {
    if (surface.format === 'none') {
      excluded.push(surface.id);
      continue;
    }
    const keys = anchorRecordKeys(surface.surfaceAnchorEnvName, surface.baseAnchorEnvName);
    surfaces.push({
      id: surface.id,
      root: surface.root,
      format: surface.format,
      runtimeTarget: surface.runtimeTarget,
      baseAnchorEnvName: trim(surface.baseAnchorEnvName),
      surfaceAnchorEnvName: trim(surface.surfaceAnchorEnvName),
      anchorKey: keys.anchorKey,
      uuidKey: keys.uuidKey,
      profileFiles: (surface.profileFiles ?? []).map((file) => file.path),
    });
  }
  return { mode: anchorGroup, surfaces, excluded };
}

function resolveSinkPaths(entry, environment, deploymentProfile) {
  const sinks = entry.environments?.[environment]?.anchorSinks ?? [];
  return sinks
    .filter((sink) => {
      if (!deploymentProfile) {
        return true;
      }
      return sink.deploymentProfile === '' || sink.deploymentProfile === deploymentProfile;
    })
    .map((sink) => ({ ...sink }));
}

/**
 * Read the anchor a plan's environment configuration already records.
 *
 * A `repository` group reads the repository-level anchor variable. A `surface`
 * group reads each owned surface's own variable: two surfaces of one repository
 * hold independent anchors, so reading the shared variable would report another
 * surface's identity as a conflict. Surfaces that share one deploy application
 * (one manifest root owning several surfaces) must agree, so disagreeing values
 * are still surfaced as a conflict.
 * @param plan - planned item
 * @returns recorded value, source path, identity label, and conflicts
 */
export function readPlanRecordedAnchor(plan) {
  const sinkPaths = (plan.sinkPaths ?? []).map((sink) => sink.absolutePath);
  if (plan.anchorGroup !== 'surface' || (plan.surfaceGroup?.surfaces ?? []).length === 0) {
    const recorded = readRecordedAnchor(sinkPaths);
    return {
      ...recorded,
      keyLabel: DEPLOY_APPLICATION_ID_ENV,
      key: DEPLOY_APPLICATION_ID_ENV,
    };
  }
  const perSurface = (plan.surfaceGroup?.surfaces ?? []).map((surface) => ({
    surfaceId: surface.id,
    key: surface.anchorKey,
    ...readRecordedAnchor(sinkPaths, surface.anchorKey),
  }));
  const recorded = perSurface.filter((entry) => entry.value !== '');
  const distinct = new Set(recorded.map((entry) => entry.value));
  const conflict = distinct.size > 1
    ? perSurface.flatMap((entry) => entry.all.map((item) => ({ ...item, surfaceId: entry.surfaceId })))
    : [];
  return {
    value: recorded[0]?.value ?? '',
    path: recorded[0]?.path ?? '',
    key: recorded[0]?.key ?? '',
    keyLabel: recorded.length > 1
      ? `surface anchor variables (${recorded.map((entry) => entry.key).join(', ')})`
      : (recorded[0]?.key ?? perSurface[0]?.key ?? DEPLOY_APPLICATION_ID_ENV),
    all: recorded.flatMap((entry) => entry.all),
    surfaces: perSurface.map((entry) => ({
      surfaceId: entry.surfaceId,
      key: entry.key,
      value: entry.value,
      path: entry.path,
    })),
    conflict,
  };
}

/**
 * Normalize one inventory entry into the facts the registrar acts on.
 * @param entry - inventory entry
 * @param allEntries - entries taking part in this run (slug collision scope)
 * @param environment - canonical environment
 * @param options - deployment profile, anchor overrides
 * @returns the plan, its defects, and the skip verdict when the root has no client surface
 */
export function planRegistrationItem(entry, allEntries, environment, options = {}) {
  const defects = [];
  const scopeRequirement = entry.permissionScopeRequirement ?? null;
  const plan = {
    id: entry.id,
    repo: entry.repo,
    appDir: entry.appDir,
    label: formatRegistrationItemLabel(entry, environment),
    environment,
    applicationType: trim(entry.applicationType),
    permissionScope: Array.isArray(entry.permissionScope) ? [...entry.permissionScope] : [],
    permissionScopeRequirement: trim(scopeRequirement?.kind),
    permissionScopeRequirementReason: trim(scopeRequirement?.reason),
    permissionScopeRequirementNotes: Array.isArray(scopeRequirement?.notes)
      ? [...scopeRequirement.notes]
      : [],
    clientSurface: scopeRequirement?.clientSurface ?? { kind: 'none', directories: [] },
    serversOnly: scopeRequirement?.serversOnly === true,
    tenantId: trim(options.tenantId) || trim(entry.tenantId) || '100001',
    organizationId: trim(options.organizationId) || trim(entry.organizationId) || '0',
    primaryDomain: '',
    primaryDomainSource: '',
    slug: '',
    slugSource: '',
    deployCreateIdempotencyKey: '',
    deployCreateBody: null,
    anchorOverrides: {},
    sinkPaths: [],
    // `surface` anchors each surface separately (one deploy application per
    // manifest root); `repository` keeps the legacy one-anchor-per-repository
    // materialization.
    anchorGroup: 'repository',
    surfaceGroup: { mode: 'repository', surfaces: [], excluded: [] },
    surfaces: [],
  };

  // Surface first: the deploy application kind and the IAM application type are
  // both derived from the manifest runtime + delivery facts the inventory read
  // (`resolveDeployAppSurface`). The declared `app.appType` is not the authority:
  // it cannot distinguish H5 from PC, and Flutter, mini program, native mobile,
  // and API delivery collapse to the same few values.
  const deployKindOverride = trim(options.deployAppKind).toUpperCase();
  if (deployKindOverride && !NEW_REGISTRATION_DEPLOY_APP_KINDS.includes(deployKindOverride)) {
    throw new RegistrationConfigurationError(
      `deployAppKind=${JSON.stringify(options.deployAppKind)} is not a deploy application kind a new `
      + `registration may select; expected one of ${NEW_REGISTRATION_DEPLOY_APP_KINDS.join('|')}`,
    );
  }
  plan.deployKind = deployKindOverride || trim(entry.deployAppKind).toUpperCase();
  plan.deployKindSource = deployKindOverride
    ? '--deploy-app-kind override'
    : trim(entry.deployAppKindSource);
  plan.repairAppKind = options.repairAppKind === true;
  plan.surfaceNotes = Array.isArray(entry.surfaceNotes) ? [...entry.surfaceNotes] : [];
  if (trim(entry.surfaceNameWarning)) {
    plan.surfaceNotes.push(entry.surfaceNameWarning);
  }
  plan.appTypeDeclared = trim(entry.appType);
  plan.canonicalAppType = trim(entry.canonicalAppType).toUpperCase();
  plan.applicationType = trim(plan.applicationType) || (
    plan.deployKind ? trim(entry.applicationType) : ''
  );

  for (const defect of entry.surfaceDefects ?? []) {
    if (deployKindOverride) {
      // The override is the operator's explicit decision about the surface; the
      // ambiguity stays visible as a note instead of blocking what was chosen.
      plan.surfaceNotes.push(`overridden by --deploy-app-kind=${deployKindOverride}: ${defect}`);
      continue;
    }
    defects.push(`${entry.id}: ${defect}`);
  }
  if (deployKindOverride && !plan.applicationType) {
    plan.applicationType = applicationTypeForDeployKind(deployKindOverride);
    if (plan.applicationType) {
      plan.applicationTypeSource = '--deploy-app-kind override';
    }
  }
  if (!plan.deployKind) {
    defects.push(
      `${entry.id}: the deploy application kind cannot be resolved from the manifest surface. `
      + 'Declare runtime.family/runtime.framework plus publish.platforms per '
      + 'APP_MANIFEST_SPEC.md §6.1, split a multi-surface root into its own application roots, '
      + 'or pass --deploy-app-kind explicitly after reviewing the surface',
    );
  }

  const defaultApplicationType = trim(options.defaultApplicationType).toLowerCase();
  if (!plan.applicationType && defaultApplicationType) {
    if (!IAM_TENANT_APPLICATION_TYPES.includes(defaultApplicationType)) {
      throw new RegistrationConfigurationError(
        `defaultApplicationType=${JSON.stringify(defaultApplicationType)} is not one of ${IAM_TENANT_APPLICATION_TYPES.join('|')}`,
      );
    }
    plan.applicationType = defaultApplicationType;
    plan.applicationTypeSource = '--default-app-type';
  } else if (plan.applicationType) {
    plan.applicationTypeSource = 'manifest surface';
  }
  const defaultPermissionScope = Array.isArray(options.defaultPermissionScope)
    ? options.defaultPermissionScope.filter((entry) => trim(entry).length > 0)
    : [];
  if (plan.permissionScope.length === 0 && defaultPermissionScope.length > 0) {
    plan.permissionScope = [...defaultPermissionScope];
  }

  // A server-only root mints no public client token, so there is no
  // `accessTokenPermissionScope` for the registration to carry. Skipping it is an
  // explicit, reported outcome with its reason — never a silent drop — and
  // `--include-servers-only` re-enables registering it anyway.
  if (plan.serversOnly && options.includeServersOnly !== true) {
    return {
      plan,
      defects,
      skip: {
        kind: 'serversOnly',
        reason:
          `${entry.id}: skipped as server-only — ${plan.permissionScopeRequirementReason}. `
          + 'No public client token exists for backend.accessTokenPermissionScope to bound. '
          + 'Pass --include-servers-only to register it anyway.',
      },
    };
  }

  if (plan.applicationType === '') {
    defects.push(
      `${entry.id}: app.appType is missing from agent.app.config.json and the runtime surface does `
      + 'not imply an IAM applicationType; declare app.appType or pass --default-app-type',
    );
  }
  if (plan.canonicalAppType && plan.appTypeDeclared && plan.appTypeDeclared !== plan.canonicalAppType) {
    // The surface proves the declared product type wrong (for example APP_HTML on a
    // Flutter root). Writing back is an explicit repair; otherwise the operator
    // must fix the manifest, because platform_app/catalog projection reads it.
    if (options.fixAppTypes === true && options.dryRun === true) {
      // A plan must not mutate the tree: report the repair the real run would do.
      plan.surfaceNotes.push(
        `--fix-app-types would rewrite app.appType ${JSON.stringify(plan.appTypeDeclared)} -> `
        + `${JSON.stringify(plan.canonicalAppType)} in ${entry.manifestPath}`,
      );
      plan.appTypeDeclared = plan.canonicalAppType;
      plan.appTypeRepairPlanned = { previous: trim(entry.appType), appType: plan.canonicalAppType };
    } else {
      const repaired = options.fixAppTypes === true
        ? repairManifestAppType(entry, plan.canonicalAppType, options)
        : null;
      if (repaired) {
        plan.appTypeDeclared = plan.canonicalAppType;
        plan.appTypeRepair = repaired;
      } else {
        defects.push(
          `${entry.id}: app.appType=${JSON.stringify(plan.appTypeDeclared)} contradicts the surface the `
          + `runtime facts prove (${plan.deployKind}: expected ${plan.canonicalAppType}). Fix the `
          + 'manifest, or pass --fix-app-types to write the derived value back into '
          + 'agent.app.config.json',
        );
      }
    }
  }
  if (plan.permissionScopeRequirement === PERMISSION_SCOPE_REQUIREMENTS.MISSING_CLIENT_ENV_CONFIGURATION
    && plan.permissionScope.length === 0) {
    // Kept separate from the scope defect on purpose: this root's client env was
    // never configured, so asking for a scope tells the operator to edit the wrong
    // file. The actionable prerequisite is the materialization declaration.
    defects.push(
      `${entry.id}: ${plan.permissionScopeRequirementReason}. This needs an `
      + 'etc/client-env.materialization.json that declares the client surface(s) and their '
      + 'accessToken before the root can be registered; it is a missing client env configuration, '
      + 'not an empty backend.accessTokenPermissionScope.',
    );
  } else if (
    plan.permissionScope.length === 0
    // IAM bootstrap refuses *any* application it provisions without a default
    // access permission list, so the scope is required for every root this plan
    // actually registers: one whose client surface mints a token, one registered
    // through --include-servers-only, and one whose inventory carried no
    // classification facts (a caller-supplied inventory keeps the strict default).
    && (scopeRequirement === null
      || scopeRequirement.requiresPermissionScope === true
      || plan.serversOnly)
  ) {
    defects.push(
      `${entry.id}: backend.accessTokenPermissionScope is empty; IAM application bootstrap refuses `
      + 'a manifest with no default access permissions (an explicit empty array is only valid when '
      + 'the manifest declares the field)',
    );
  }
  try {
    const resolved = resolveDeploySlug(entry, allEntries);
    const suffix = trim(options.slugSuffix);
    plan.slug = suffix ? `${resolved.slug}${suffix}`.slice(0, 120) : resolved.slug;
    plan.slugSource = suffix ? `${resolved.slugSource}+slugSuffix` : resolved.slugSource;
    plan.slugDisambiguated = resolved.disambiguated || Boolean(suffix);
  } catch (error) {
    defects.push(error instanceof Error ? error.message : String(error));
  }

  if (plan.slug && plan.deployKind) {
    plan.deployCreateIdempotencyKey = deployAppCreateIdempotencyKey(environment, plan.slug);
    plan.deployCreateBody = buildDeployAppCreateBody({
      slug: plan.slug,
      name: entry.appName,
      displayName: entry.displayName,
      appKind: plan.deployKind,
      ownerType: options.deployOwnerType,
      environment,
      metadata: {
        'sdkwork.io/source-repository': entry.repo,
        'sdkwork.io/source-app-root': entry.id,
      },
    });
  }

  // The primary domain is a provisioning input, not a decoration: IAM enable
  // refuses an installation whose `primary_domain` is blank, so an item with no
  // domain source must fail here instead of after a deploy create and a
  // half-written IAM installation.
  try {
    const resolvedDomain = resolvePrimaryDomain({
      entry,
      environment,
      slug: plan.slug,
      pattern: options.primaryDomainPattern,
    });
    let resolvedDomainValue = resolvedDomain.domain;
    const labelSuffix = trim(options.primaryDomainLabelSuffix);
    if (resolvedDomainValue && labelSuffix) {
      const [label, ...rest] = resolvedDomainValue.split('.');
      resolvedDomainValue = `${label}${labelSuffix}${rest.length > 0 ? `.${rest.join('.')}` : ''}`;
    }
    plan.primaryDomain = resolvedDomainValue;
    plan.primaryDomainSource = labelSuffix
      ? `${resolvedDomain.source}+labelSuffix`
      : resolvedDomain.source;
    if (!resolvedDomain.domain) {
      defects.push(
        `${entry.id}: no primaryDomain source for ${environment}. IAM enable refuses an `
        + `installation without one, so the run stops here. Set --primary-domain <pattern> `
        + '(placeholders: {env}, {slug}) or declare one of '
        + `${PRIMARY_DOMAIN_SOURCES.slice(1).join(', ')} in agent.app.config.json.`,
      );
    }
  } catch (error) {
    defects.push(error instanceof Error ? error.message : String(error));
  }

  const deploymentProfile = trim(options.deploymentProfile);
  plan.deploymentProfile = deploymentProfile;
  plan.sinkPaths = resolveSinkPaths(entry, environment, deploymentProfile);
  if (plan.sinkPaths.length === 0) {
    plan.defectsAnchorSink = true;
  }
  // Anchor granularity: one deploy application per manifest root means one
  // anchor per surface, so each surface keeps its own anchor variable and its own
  // profile carrier files. `repository` keeps the legacy single-anchor behavior.
  const anchorGroup = options.anchorGroup === 'surface' ? 'surface' : 'repository';
  plan.anchorGroup = anchorGroup;
  plan.surfaceGroup = planSurfaceGroup(anchorGroup, entry);
  plan.surfaces = plan.surfaceGroup.surfaces.map((surface) => surface.id);
  if (anchorGroup === 'surface') {
    const declared = entry.tokenCarrier?.repositorySurfaces ?? [];
    const byAnchorEnvName = new Map();
    for (const surface of declared) {
      const name = trim(surface.surfaceAnchorEnvName);
      if (!name) {
        continue;
      }
      byAnchorEnvName.set(name, [...(byAnchorEnvName.get(name) ?? []), surface.id]);
    }
    for (const [name, ids] of byAnchorEnvName) {
      if (ids.length > 1) {
        defects.push(
          `${entry.id}: declared surfaces ${ids.join(', ')} would share the anchor variable ${name}; `
          + 'each surface that registers with its own deploy application needs its own anchor '
          + 'variable, so their surface ids must derive distinct names',
        );
      }
    }
    for (const surface of plan.surfaceGroup.surfaces) {
      const envSourced = trim(surface.baseAnchorEnvName) !== '';
      if (envSourced && !surface.surfaceAnchorEnvName) {
        defects.push(
          `${entry.id}: surface ${surface.id} declares its anchor variable `
          + `${surface.baseAnchorEnvName} but no surface-scoped name can be derived from its id; `
          + 'rename the surface id so the per-surface anchor variable is readable',
        );
      }
    }
  }
  const override = options.anchorOverrides?.[`${entry.id}@${environment}`]
    ?? options.anchorOverrides?.[entry.id]
    ?? '';
  plan.anchorOverride = trim(override);
  return { plan, defects };
}

/**
 * Delay before the next attempt of one retryable call.
 *
 * The framework answers `429` with `Retry-After` when the backend rate limiter
 * trips, and a batch registration of 82 applications trips it routinely. The
 * wait is therefore `max(Retry-After, exponential)` —never less than the server
 * asked for, never less than the backoff —plus up to 25% jitter so a batch that
 * was throttled together does not retry in lockstep and trip the limiter again.
 * @param error - the failed attempt
 * @param attempt - 1-based attempt number that just failed
 * @param policy - maxAttempts, retryDelayMs, jitter
 * @returns delay in milliseconds
 */
export function retryDelayMsFor(error, attempt, policy) {
  const retryAfter = Number(error?.retryAfterMs) > 0 ? Number(error.retryAfterMs) : 0;
  const exponential = Math.max(0, Number(policy.retryDelayMs) || 0) * 2 ** Math.max(0, attempt - 1);
  const floor = Math.max(retryAfter, exponential);
  if (floor === 0) {
    return 0;
  }
  const jitter = typeof policy.jitter === 'function' ? policy.jitter() : Math.random();
  return Math.round(floor + jitter * floor * 0.25);
}

async function withRetries(operation, policy) {
  const maxAttempts = Number.isInteger(policy.maxAttempts) && policy.maxAttempts > 0
    ? policy.maxAttempts
    : 1;
  const sleep = policy.sleep ?? sleepDefault;
  let attempt = 0;
  let lastError;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const value = await operation(attempt);
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable === true;
      if (!retryable || attempt >= maxAttempts) {
        break;
      }
      await sleep(retryDelayMsFor(error, attempt, policy));
    }
  }
  if (lastError && typeof lastError === 'object') {
    lastError.attempts = attempt;
  }
  throw lastError;
}

async function ensureDeployApplication(context, plan) {
  const { deployClient, options } = context;
  const recorded = plan.recordedAnchor;
  // Adopting an existing row is only valid when it still carries the kind the
  // manifest surface resolves to. `app_kind` is immutable for a released
  // endpoint, so a row registered by an older, mis-detecting run cannot be
  // silently reused: without an explicit repair the item fails with the
  // corrective action instead of wiring a token to the wrong surface. With
  // `--repair-app-kind` the guarded draft correction is applied through
  // `apps.update` (the API still refuses it once targets or releases exist).
  const adopt = async (item, created, attempts, lookup) => {
    const parsed = readDeployAppItem(item);
    const defect = verifyDeployAppKind(parsed, plan.deployKind, plan.label);
    if (!defect) {
      return { item, created, attempts, lookup };
    }
    if (plan.repairAppKind !== true) {
      throw new RegistrationConfigurationError(defect, { slug: plan.slug, lookup });
    }
    const repaired = await withRetries(
      () => deployClient.updateApp(parsed.uuid, { appKind: plan.deployKind }),
      context.retryPolicy,
    );
    const repairedItem = readDeployAppItem(repaired.value);
    const remaining = verifyDeployAppKind(repairedItem, plan.deployKind, plan.label);
    if (remaining) {
      throw new RegistrationConfigurationError(remaining, { slug: plan.slug, lookup });
    }
    return {
      item: repaired.value,
      created,
      attempts: attempts + repaired.attempts,
      lookup: `${lookup}+kind-repair`,
      kindRepair: { from: parsed.appKind, to: repairedItem.appKind },
    };
  };
  // A recorded anchor that is also a uuid can be read directly; the app API
  // addresses applications by uuid, so this is the only exact re-read.
  if (recorded && options.anchorKind === 'deploy-application-uuid') {
    const existing = await withRetries(
      () => deployClient.retrieveApp(recorded),
      context.retryPolicy,
    );
    if (existing.value) {
      return adopt(existing.value, false, existing.attempts, 'anchor');
    }
  }
  const found = await withRetries(
    () => findAppBySlug(deployClient, plan.slug),
    context.retryPolicy,
  );
  if (found.value) {
    return adopt(found.value, false, found.attempts, 'slug');
  }
  try {
    const created = await withRetries(
      () => deployClient.createApp(plan.deployCreateBody, {
        idempotencyKey: plan.deployCreateIdempotencyKey,
      }),
      context.retryPolicy,
    );
    return adopt(created.value, true, created.attempts, 'create');
  } catch (error) {
    // A concurrent creator won `uk_deploy_app_tenant_slug`: adopt its row rather
    // than failing the item, because the deterministic key would have replayed
    // it had the race gone the other way.
    if (error instanceof DeployApiError && error.status === 409) {
      const adopted = await withRetries(
        () => findAppBySlug(deployClient, plan.slug),
        context.retryPolicy,
      );
      if (adopted.value) {
        return adopt(adopted.value, false, adopted.attempts, 'slug-after-conflict');
      }
    }
    throw error;
  }
}

function resolveAnchor(context, plan, deployItem) {
  const sources = [];
  if (plan.recordedAnchor) {
    sources.push({ source: 'environment', value: plan.recordedAnchor });
  }
  if (plan.anchorOverride) {
    sources.push({ source: '--anchor-map', value: plan.anchorOverride });
  }
  // The deploy response always carries the anchor: `assertDeployApplicationItem`
  // refuses a row without a decimal `deployApplicationId` before it reaches here,
  // so create/retrieve/list all supply the anchor directly. The uuid only enters
  // the anchor position when the operator deliberately asks for that identity.
  if (context.options.anchorKind === 'deploy-application-uuid') {
    sources.push({ source: 'deploy-uuid', value: deployItem.uuid });
  } else {
    sources.push({ source: 'deploy-response', value: deployItem.deployApplicationId });
  }
  const distinct = new Set(sources.map((entry) => entry.value));
  if (distinct.size > 1) {
    throw new RegistrationConfigurationError(
      `conflicting deploy application anchors for ${plan.label}: `
      + sources.map((entry) => `${entry.source}=${entry.value}`).join(', ')
      + '. The registrar refuses to choose; reconcile the environment configuration, the anchor '
      + 'map, and the deploy row before retrying.',
      { sources },
    );
  }
  const anchor = sources[0].value;
  return {
    anchor: assertDeployApplicationIdForKind(
      anchor,
      `deploy application anchor (${sources[0].source})`,
      context.options.anchorKind,
    ),
    source: sources[0].source,
    sources,
  };
}

async function provisionIamInstallation(context, plan, anchor, applicationType) {
  const organizationId = trim(context.options.ownershipScope).toUpperCase() === 'ORGANIZATION'
    ? trim(context.options.organizationId) || plan.organizationId
    : plan.organizationId;
  const body = buildInstallationProvisionBody({
    deployApplicationId: anchor,
    anchorKind: context.options.anchorKind,
    applicationType,
    environment: plan.environment,
    tenantId: plan.tenantId,
    organizationId,
    displayName: plan.displayName || plan.slug,
    appKey: plan.slug,
    accessPermissions: plan.permissionScope,
    primaryDomain: plan.primaryDomain,
    ownershipScope: context.options.ownershipScope,
    ownerUserId: context.options.ownerUserId,
  });
  const provisioned = await withRetries(
    () => context.iamClient.provisionInstallation(body),
    context.retryPolicy,
  );
  const item = readInstallationItem(provisioned.value);
  if (!item.installationId) {
    throw new IamApiError(
      `IAM provisioned an installation for ${plan.label} without returning its id, so its `
      + 'environment row cannot be registered and it cannot be enabled or verified',
      { kind: 'unreadable' },
    );
  }
  return { item, body, attempts: provisioned.attempts };
}

/**
 * Ensure the lifecycle row exists and is `active` before the installation is enabled.
 *
 * One installation serves every lifecycle; the lifecycle is one
 * `iam_application_installation_environment` row (`env_key`, `primary_domain`,
 * `env_status`). Runtime token issuance opens with
 * `decide_installation_environment_access`: once the installation has any row, a
 * request for an unregistered environment, or for a row that is not `active`,
 * fails closed. Enabling an installation without writing its row would therefore
 * publish an installation that no request of this lifecycle can use.
 *
 * The upsert is deduplicated per `(installation, env_key)` within a run: several
 * surfaces of one repository resolve to one installation, and creating a second
 * row for the same environment is not a thing IAM allows (or needs).
 * @param context - clients, options, retry policy, run-level environment cache
 * @param plan - planned item (carries the resolved primary domain)
 * @param item - the provisioned installation item
 * @returns the environment row facts
 */
async function ensureInstallationEnvironment(context, plan, item) {
  const { options } = context;
  const cacheKey = `${item.installationId}@${plan.environment}`;
  // The cache holds the in-flight promise, not the finished outcome: two surfaces
  // of one installation are registered concurrently, and both must await the same
  // single upsert instead of racing two writes for one row.
  const inFlight = context.environments.get(cacheKey);
  if (inFlight) {
    const settled = await inFlight;
    return { ...settled, deduplicated: true };
  }
  const attempt = (async () => {
    const base = {
      envKey: plan.environment,
      primaryDomain: plan.primaryDomain,
      primaryDomainSource: plan.primaryDomainSource,
      status: '',
      environmentId: '',
      idempotencyKey: '',
      attempts: 0,
      deduplicated: false,
    };
    if (!options.registerEnvironments) {
      return {
        ...base,
        status: 'skipped',
        reason: 'environment registration disabled (--no-register-environments)',
      };
    }
    const idempotencyKey = environmentUpsertIdempotencyKey(
      plan.tenantId,
      item.installationId,
      plan.environment,
    );
    const upserted = await withRetries(
      () => context.iamClient.upsertInstallationEnvironment({
        tenantId: plan.tenantId,
        installationId: item.installationId,
        envKey: plan.environment,
        primaryDomain: plan.primaryDomain,
        envStatus: 'active',
        idempotencyKey,
      }),
      context.retryPolicy,
    );
    const row = upserted.value ?? {};
    const outcome = {
      ...base,
      envKey: trim(row.environmentKey) || plan.environment,
      primaryDomain: trim(row.primaryDomain) || plan.primaryDomain,
      status: trim(row.status) || 'active',
      environmentId: trim(row.environmentId),
      idempotencyKey,
      attempts: upserted.attempts,
    };
    if (outcome.status.toLowerCase() !== 'active') {
      throw new IamApiError(
        `${plan.label}: IAM stored the ${outcome.envKey} environment row as `
        + `${JSON.stringify(outcome.status)} instead of active, so token issuance for this `
        + 'lifecycle would fail closed',
        { kind: 'unverified' },
      );
    }
    return outcome;
  })();
  context.environments.set(cacheKey, attempt);
  try {
    return await attempt;
  } catch (error) {
    // A failed row must not be cached: another surface still deserves its own
    // diagnostic, and a later run has to try again.
    context.environments.delete(cacheKey);
    throw error;
  }
}

async function enableIamInstallation(context, plan, item) {
  const enabled = await withRetries(
    () => context.iamClient.enableInstallation(item.installationId, {
      tenantId: plan.tenantId,
      primaryDomain: plan.primaryDomain,
      accessPermissions: plan.permissionScope,
    }),
    context.retryPolicy,
  );
  return readInstallationItem(enabled.value);
}

function verifyIamInstallation(plan, anchor, item, options) {
  const problems = [];
  if (item.status.toLowerCase() !== 'enabled') {
    problems.push(`installation ${item.installationId || '(unknown)'} is ${item.status || '(no status)'} instead of enabled`);
  }
  if (item.deployApplicationId) {
    if (item.deployApplicationId !== anchor) {
      problems.push(
        `installation ${item.installationId || '(unknown)'} is bound to deploy application `
        + `${item.deployApplicationId}, not ${anchor}`,
      );
    }
  } else if (!options.allowUnverifiedIamBinding) {
    problems.push(
      `the IAM response did not echo deployApplicationId, so the installation cannot be proven `
      + `bound to ${anchor}; re-run with --allow-unverified-iam-binding only if this IAM build is `
      + 'known not to echo it',
    );
  }
  if (problems.length > 0) {
    const error = new IamApiError(
      `${plan.label}: IAM installation verification failed: ${problems.join('; ')}`,
      { kind: 'unverified' },
    );
    throw error;
  }
  return { status: item.status, anchorVerified: item.deployApplicationId === anchor };
}

/**
 * Register one planned item (Deploy ensure →anchor →IAM provision →environment
 * row →enable →verify).
 *
 * The environment row is written *before* enable on purpose: an enabled
 * installation with no row for the lifecycle cannot issue a token for it, so
 * enabling first would publish a broken installation.
 * @param context - clients, options, retry policy, environment cache
 * @param plan - planned item
 * @returns the item result
 */
async function registerOne(context, plan) {
  const result = {
    id: plan.id,
    repo: plan.repo,
    appDir: plan.appDir,
    label: plan.label,
    environment: plan.environment,
    slug: plan.slug,
    slugSource: plan.slugSource,
    applicationType: plan.applicationType,
    applicationTypeSource: plan.applicationTypeSource ?? '',
    deployAppKind: plan.deployKind,
    deployAppKindSource: plan.deployKindSource,
    appType: plan.appTypeDeclared,
    canonicalAppType: plan.canonicalAppType,
    permissionScopeCount: plan.permissionScope.length,
    permissionScopeRequirement: plan.permissionScopeRequirement,
    permissionScopeRequirementReason: plan.permissionScopeRequirementReason,
    permissionScopeRequirementNotes: plan.permissionScopeRequirementNotes,
    notes: [
      ...(plan.permissionScopeRequirementNotes ?? []),
      ...(plan.surfaceNotes ?? []),
    ],
    clientSurface: plan.clientSurface,
    serversOnly: plan.serversOnly,
    primaryDomain: plan.primaryDomain,
    primaryDomainSource: plan.primaryDomainSource,
    // Registration granularity: `surface` means this manifest root is one
    // endpoint surface with its own deploy application, anchor, and token
    // carrier; `repository` is the legacy one-anchor-per-repository mode.
    anchorGroup: plan.anchorGroup,
    surfaces: [...plan.surfaces],
    status: 'failed',
    deployApplicationId: '',
    deployApplicationUuid: '',
    deployAppStatus: '',
    anchorSource: '',
    iam: {},
    installationEnvironment: { envKey: plan.environment, status: '', primaryDomain: plan.primaryDomain },
    anchor: { mode: plan.anchorGroup, written: [], outcomes: [], surfaces: [], skipped: '' },
    materialize: { status: 'pending' },
    attempts: 0,
    error: '',
    ...(plan.appTypeRepair ? { appTypeRepair: plan.appTypeRepair } : {}),
  };
  try {
    const deployOutcome = await ensureDeployApplication(context, plan);
    const deployItem = readDeployAppItem(deployOutcome.item);
    result.deployApplicationUuid = deployItem.uuid;
    result.deployAppStatus = deployItem.appStatus;
    result.attempts = deployOutcome.attempts;
    result.deploy = {
      created: deployOutcome.created,
      lookup: deployOutcome.lookup,
      idempotencyKey: plan.deployCreateIdempotencyKey,
      ...(deployOutcome.kindRepair ? { kindRepair: deployOutcome.kindRepair } : {}),
    };
    const resolved = resolveAnchor(context, plan, deployItem);
    result.deployApplicationId = resolved.anchor;
    result.anchorSource = resolved.source;

    const provisioned = await provisionIamInstallation(
      context,
      plan,
      resolved.anchor,
      plan.applicationType,
    );
    result.iam = {
      installationId: provisioned.item.installationId,
      appId: provisioned.item.appId,
      status: provisioned.item.status,
      deployApplicationId: provisioned.item.deployApplicationId,
      provisionedStatus: provisioned.item.status,
      provisioningIdempotencyKey: provisioned.body.provisioningIdempotencyKey,
    };

    const environment = await ensureInstallationEnvironment(context, plan, provisioned.item);
    result.installationEnvironment = environment;

    let item = provisioned.item;
    let enabledNow = false;
    if (item.status.toLowerCase() !== 'enabled') {
      item = await enableIamInstallation(context, plan, item);
      enabledNow = true;
    }
    const verified = verifyIamInstallation(plan, resolved.anchor, item, context.options);
    result.iam = {
      ...result.iam,
      status: item.status,
      deployApplicationId: item.deployApplicationId,
      enabledNow,
      anchorVerified: verified.anchorVerified,
      environmentKey: environment.envKey,
    };
    result.status = deployOutcome.created ? 'created' : 'reused';
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.errorKind = error?.kind ?? error?.name ?? 'error';
    result.retryable = error?.retryable === true;
    return result;
  }
}

function nodeRunnerDefault() {
  return ({ script, args, cwd, env, timeoutMs }) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [script, ...args], {
        cwd,
        env,
        stdio: 'inherit',
        windowsHide: process.platform === 'win32',
      });
      const timer = setTimeout(() => {
        child.kill();
      }, timeoutMs);
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ code: 1, error: error instanceof Error ? error.message : String(error) });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1 });
      });
    });
}

/**
 * Write the anchor records one item owns.
 *
 * A `surface` group writes one surface-scoped variable per owned surface, so two
 * surfaces of one repository never overwrite each other's record even though they
 * share the authored env layer. A `repository` group — and a surface group this
 * manifest root owns no surface of (the repository-root manifest of a
 * multi-surface repository) — writes the canonical repository-level variable,
 * which is the server identity that layer already carries.
 * @param context - options and the runner
 * @param result - item result being filled
 * @param plan - planned item
 */
function writePlanAnchorRecords(context, result, plan) {
  const { options } = context;
  const sinkPaths = plan.sinkPaths.map((sink) => sink.absolutePath);
  const anchor = result.deployApplicationId;
  result.anchor.mode = plan.anchorGroup;
  if (sinkPaths.length === 0) {
    result.anchor.skipped = 'no authored environment configuration for this application';
    return;
  }
  if (!options.writeAnchor) {
    result.anchor.skipped = 'anchor writing disabled (--no-write-anchor)';
    return;
  }
  const surfaces = plan.surfaceGroup.surfaces;
  const targets = (plan.anchorGroup === 'surface' && surfaces.length > 0
    ? surfaces.map((surface) => ({
      surfaceId: surface.id,
      anchorKey: surface.anchorKey,
      uuidKey: surface.uuidKey,
    }))
    : [{
      surfaceId: '',
      anchorKey: DEPLOY_APPLICATION_ID_ENV,
      uuidKey: DEPLOY_APPLICATION_UUID_ENV,
    }]);
  if (!anchor) {
    result.anchor.skipped = 'the deploy application reported no anchor to write';
    return;
  }
  for (const target of targets) {
    const outcomes = writeAnchorEnv({
      sinkPaths,
      anchor,
      uuid: result.deployApplicationUuid,
      recordUuid: options.recordDeployUuid,
      key: target.anchorKey,
      uuidKey: target.uuidKey,
    });
    result.anchor.surfaces.push({
      id: target.surfaceId,
      anchorVariable: target.anchorKey,
      outcomes: outcomes.map((outcome) => ({
        path: outcome.path,
        outcome: outcome.outcome,
      })),
    });
    for (const outcome of outcomes) {
      result.anchor.outcomes.push({
        surfaceId: target.surfaceId,
        anchorVariable: target.anchorKey,
        path: outcome.path,
        outcome: outcome.outcome,
      });
      if (outcome.outcome === 'updated' || outcome.outcome === 'created') {
        result.anchor.written.push(outcome.path);
      }
    }
  }
  result.anchor.written = [...new Set(result.anchor.written)];
}

/**
 * Regenerate the generated topology profiles that received an anchor record.
 *
 * The generated `etc/topology/<profile>.<environment>.env` is the file the
 * materializer reads, so a recorded anchor must reach it. Several surfaces of one
 * repository share those files, and items are registered concurrently, so the run
 * is deduplicated per `(repository, profile)`: one writer, one result, every item
 * reads the same outcome.
 * @param context - options and the runner
 * @param active - registered items with their plans
 */
async function regenerateTopologyProfiles(context, active) {
  const { options, runNodeScript } = context;
  const runs = new Map();
  for (const { result, plan } of active) {
    if (result.anchor.skipped || !result.deployApplicationId) {
      continue;
    }
    const topologySinks = plan.sinkPaths.filter((sink) => sink.kind === 'topology-override');
    if (topologySinks.length === 0) {
      continue;
    }
    const byRepo = new Map();
    for (const sink of topologySinks) {
      if (!sink.deploymentProfile) {
        continue;
      }
      const repoRoot = sink.absoluteRepoRoot ?? plan.repoAbsoluteRoot ?? '';
      if (!repoRoot) {
        continue;
      }
      const profiles = byRepo.get(repoRoot) ?? new Set();
      profiles.add(sink.deploymentProfile);
      byRepo.set(repoRoot, profiles);
    }
    for (const [repoRoot, profiles] of byRepo.entries()) {
      for (const deploymentProfile of profiles) {
        const profileId = `${deploymentProfile}.${result.environment}`;
        const cacheKey = `${repoRoot}::${profileId}`;
        let run = runs.get(cacheKey);
        if (!run) {
          run = runNodeScript({
            script: path.join(TOOLS_DIR, 'materialize-topology-env.mjs'),
            args: ['--root', repoRoot, '--profile', profileId],
            cwd: repoRoot,
            env: { ...process.env },
            timeoutMs: 120_000,
          });
          runs.set(cacheKey, run);
        }
        let outcome;
        try {
          outcome = await run;
        } catch (error) {
          outcome = { code: 1, error: error instanceof Error ? error.message : String(error) };
        }
        result.anchor.topologyRegenerated = result.anchor.topologyRegenerated ?? [];
        result.anchor.topologyRegenerated.push({
          repoRoot,
          profileId,
          code: outcome.code,
        });
        if (outcome.code !== 0) {
          result.anchor.topologyRegenerationFailed = true;
        }
      }
    }
  }
}

/**
 * Re-run the client-env materializer for one registered item.
 *
 * The surface filter is the whole point: a surface group passes `--surface` plus
 * that surface's own anchor variable, so the materializer rewrites only the
 * selected surfaces' profile files. The repository group keeps the historical
 * full-matrix run with the repository anchor.
 * @param context - options and the runner
 * @param result - item result being filled
 * @param plan - planned item
 */
async function materializePlan(context, result, plan) {
  const { options, runNodeScript } = context;
  const surfaces = plan.surfaceGroup.surfaces;
  const common = {
    repoRoot: plan.repoAbsoluteRoot ?? '',
    mode: plan.anchorGroup,
    anchor: result.deployApplicationId ?? '',
    surfaces: plan.surfaces,
  };
  if (!options.materialize) {
    result.materialize = {
      ...common,
      status: 'skipped',
      reason: 'materialization disabled (--no-materialize)',
    };
    return;
  }
  if (!plan.hasClientEnv) {
    result.materialize = {
      ...common,
      status: 'not-applicable',
      reason: 'repository declares no etc/client-env.materialization.json',
    };
    return;
  }
  if (surfaces.length === 0) {
    result.materialize = {
      ...common,
      status: 'not-applicable',
      reason: plan.anchorGroup === 'surface'
        ? 'this repository registers each surface as its own deploy application '
          + '(one anchor per surface), and this manifest root owns none of the declared surfaces; '
          + 'register the apps/<surface> manifest root to materialize its tokens'
        : 'the repository declares no materializable client surface',
    };
    return;
  }
  if (!common.repoRoot || !common.anchor) {
    result.materialize = {
      ...common,
      status: 'failed',
      reason: 'cannot resolve the repository root or the anchor for materialization',
    };
    return;
  }
  // One environment per run: every environment is a separate deployment with its
  // own anchor, so materializing the whole profile matrix would bake this run's
  // anchor into another environment's profile files.
  const args = ['--root', common.repoRoot, '--environment', result.environment];
  let env = { ...process.env };
  if (plan.anchorGroup === 'surface') {
    for (const surface of surfaces) {
      args.push('--surface', surface.id);
      // The per-surface anchor variable is what the materializer resolves first
      // for that surface; the repository-level variable is never overwritten, so
      // the other surfaces keep their own identity.
      env[surface.anchorKey] = common.anchor;
    }
  } else {
    env[DEPLOY_APPLICATION_ID_ENV] = common.anchor;
  }
  const run = await runNodeScript({
    script: path.join(TOOLS_DIR, 'materialize-client-env.mjs'),
    args,
    cwd: common.repoRoot,
    env,
    timeoutMs: 180_000,
  });
  result.materialize = {
    ...common,
    status: run.code === 0 ? 'materialized' : 'failed',
    code: run.code,
    args,
    anchorVariables: plan.anchorGroup === 'surface'
      ? surfaces.map((surface) => surface.anchorKey)
      : [DEPLOY_APPLICATION_ID_ENV],
  };
}

async function runEnvironmentHandoff(context, entries, planByItemId) {
  const { options } = context;
  const active = [];
  for (const result of entries) {
    if (result.status === 'failed' || result.status === 'skipped') {
      continue;
    }
    const plan = planByItemId.get(result.id);
    if (!plan) {
      continue;
    }
    active.push({ result, plan });
  }

  // 1. Anchor records: one surface-scoped variable per surface, or the
  //    repository-level variable when this root anchors the whole repository.
  for (const { result, plan } of active) {
    writePlanAnchorRecords(context, result, plan);
  }
  // 2. The generated topology profiles are the materializer's input, so the
  //    records must reach them before materialization reads them.
  if (options.writeAnchor && options.regenerateTopologyEnv) {
    await regenerateTopologyProfiles(context, active);
  }
  // 3. Materialization, scoped to what each item owns.
  for (const { result, plan } of active) {
    await materializePlan(context, result, plan);
  }
}

/**
 * Run the registrar.
 *
 * @param options - workspace, environment, scope, dry-run, anchors, hand-off flags
 * @param dependencies - client factories, inventory, runner, clock (tests inject)
 * @returns the registration report
 */
export async function registerApplications(options = {}, dependencies = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const environment = normalizeEnvironment(options.environment ?? 'development');
  const anchorKind = trim(options.anchorKind) || 'deploy-application-id';
  if (!['deploy-application-id', 'deploy-application-uuid'].includes(anchorKind)) {
    throw new RegistrationConfigurationError(
      `unsupported --anchor-kind ${JSON.stringify(anchorKind)}; expected deploy-application-id or `
      + 'deploy-application-uuid',
    );
  }
  const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
    ? options.maxAttempts
    : 5;
  const retryDelayMs = Number.isInteger(options.retryDelayMs) && options.retryDelayMs >= 0
    ? options.retryDelayMs
    : 500;
  const concurrency = Number.isInteger(options.concurrency) && options.concurrency > 0
    ? Math.min(options.concurrency, 8)
    : 2;
  const sleep = dependencies.sleep ?? sleepDefault;
  const jitter = dependencies.jitter ?? Math.random;
  const runNodeScript = dependencies.runNodeScript ?? nodeRunnerDefault();

  const inventory = dependencies.inventory
    ?? (await import('./inventory.mjs')).buildRegistrationInventory({ workspaceRoot });

  const targets = selectTargets(inventory, options);
  if (targets.length === 0) {
    throw new RegistrationAbortedError(
      `no application matched scope=${trim(options.scope) || 'repository'}${
        trim(options.filterPattern) ? ` filter=${trim(options.filterPattern)}` : ''
      } under ${workspaceRoot}`,
      { workspaceRoot, scope: options.scope },
    );
  }

  const deploymentProfile = trim(options.deploymentProfile) || defaultDeploymentProfile(environment);
  // An anchor belongs to the application, not to one deployment profile: the
  // same deploy application serves both the standalone and the cloud profile of
  // an environment. Every existing authored env layer of the environment is
  // therefore written unless the operator narrows the run with
  // `--deployment-profile`.
  const explicitDeploymentProfile = trim(options.deploymentProfile);
  const anchorOverrides = options.anchorOverrides ?? {};

  const plans = [];
  const report = {
    schemaVersion: 1,
    kind: 'sdkwork.app-registration-report',
    generatedAt: new Date().toISOString(),
    environment,
    deploymentProfile,
    workspaceRoot,
    dryRun: Boolean(options.dryRun),
    scope: trim(options.scope) || 'repository',
    filterPattern: trim(options.filterPattern),
    anchorKind,
    writeAnchor: options.writeAnchor !== false,
    materialize: options.materialize !== false,
    registerEnvironments: options.registerEnvironments !== false,
    primaryDomainPattern: trim(options.primaryDomainPattern),
    deployAppKind: trim(options.deployAppKind).toUpperCase(),
    fixAppTypes: options.fixAppTypes === true,
    repairAppKind: options.repairAppKind === true,
    concurrency,
    maxAttempts,
    retryDelayMs,
    settings: {
      deployBaseUrl: trim(options.settings?.deploy?.baseUrl),
      iamBaseUrl: trim(options.settings?.iam?.baseUrl),
      tenantId: trim(options.settings?.tenantId),
      organizationId: trim(options.settings?.organizationId),
      deployCredentials: options.settings?.deploy?.accessToken ? 'present' : 'absent',
      iamCredentials: options.settings?.iam?.auth ? 'present' : 'absent',
      iamManagementCredentials: resolveManagementCredentialState(options.settings?.iam),
    },
    counts: {},
    entries: [],
  };

  for (const entry of targets) {
    const repoRoot = path.resolve(workspaceRoot, entry.repo);
    const appRoot = entry.appDir === '.'
      ? repoRoot
      : path.resolve(repoRoot, entry.appDir);
    const repoEntries = inventory.entries.filter(
      (candidate) => !candidate.parseError && candidate.repo === entry.repo,
    );
    const anchorGroup = resolveAnchorGroup(trim(options.scope) || 'repository', repoEntries);
    // Slug collisions are resolved against every parsed manifest in the
    // workspace, not only the selected subset, so `--scope surfaces` and
    // `--scope all` derive the same slug for the same application.
    const { plan, defects, skip } = planRegistrationItem(
      entry,
      inventory.entries.filter((candidate) => !candidate.parseError),
      environment,
      {
        tenantId: options.tenantId,
        organizationId: options.organizationId,
        deploymentProfile: explicitDeploymentProfile,
        anchorOverrides,
        primaryDomainPattern: options.primaryDomainPattern,
        slugSuffix: options.slugSuffix,
        primaryDomainLabelSuffix: options.primaryDomainLabelSuffix,
        deployOwnerType: options.deployOwnerType,
        ignoreRecordedAnchor: options.ignoreRecordedAnchor === true,
        includeServersOnly: options.includeServersOnly === true,
        anchorGroup,
        deployAppKind: options.deployAppKind,
        fixAppTypes: options.fixAppTypes === true,
        repairAppKind: options.repairAppKind === true,
        dryRun: options.dryRun === true,
        workspaceRoot,
      },
    );
    plan.repoAbsoluteRoot = repoRoot;
    plan.appAbsoluteRoot = appRoot;
    plan.displayName = trim(entry.displayName) || trim(entry.appName);
    plan.hasClientEnv = entry.tokenCarrier?.kind === 'client-env-materializer';
    for (const sink of plan.sinkPaths) {
      // Inventory sink paths are workspace-relative; the writer needs the
      // absolute path under the repository that owns the env configuration.
      sink.absolutePath = path.resolve(workspaceRoot, sink.path);
      sink.absoluteRepoRoot = repoRoot;
    }
    const recorded = options.ignoreRecordedAnchor === true
      ? { value: '', conflict: [] }
      : readPlanRecordedAnchor(plan);
    if (recorded.conflict.length > 0) {
      defects.push(
        `${entry.id}: conflicting ${recorded.keyLabel} values across environment `
        + `configuration: ${recorded.conflict
          .map((item) => `${item.path}#${item.key}=${item.value}`)
          .join(', ')}`,
      );
    }
    plan.recordedAnchor = recorded.value;
    plan.recordedAnchorPath = recorded.path;
    plan.recordedAnchorKey = recorded.key;
    // The instance key is derived from the anchor (decimal deploy application id),
    // never from the slug: the registrar and the embedded/Node bootstrap must
    // derive the same `installation_instance_key` for one installation.
    const anchorForInstanceKey = trim(recorded.value) || trim(plan.anchorOverride);
    plan.instanceKeyHint = anchorForInstanceKey
      ? tenantApplicationInstanceKey(anchorForInstanceKey, environment)
      : `(deploy-application-id)_${environment === 'development'
        ? 'dev'
        : environment === 'production'
          ? 'prod'
          : environment}`;
    plan.defects = defects;
    plans.push({ entry, plan, skip });
  }

  markDuplicatePrimaryDomains(plans);

  const planByItemId = new Map(plans.map((entry) => [entry.plan.id, entry.plan]));

  if (options.dryRun) {
    for (const { plan, skip } of plans) {
      const shared = {
        id: plan.id,
        repo: plan.repo,
        appDir: plan.appDir,
        label: plan.label,
        environment: plan.environment,
        slug: plan.slug,
        slugSource: plan.slugSource,
        slugDisambiguated: Boolean(plan.slugDisambiguated),
        applicationType: plan.applicationType,
        applicationTypeSource: plan.applicationTypeSource ?? '',
        deployAppKind: plan.deployKind,
        deployAppKindSource: plan.deployKindSource,
        appType: plan.appTypeDeclared,
        canonicalAppType: plan.canonicalAppType,
        permissionScopeCount: plan.permissionScope.length,
        permissionScopeRequirement: plan.permissionScopeRequirement,
        permissionScopeRequirementReason: plan.permissionScopeRequirementReason,
        clientSurface: plan.clientSurface,
        serversOnly: plan.serversOnly,
        primaryDomain: plan.primaryDomain,
        primaryDomainSource: plan.primaryDomainSource,
        anchorGroup: plan.anchorGroup,
        notes: [
          ...(plan.permissionScopeRequirementNotes ?? []),
          ...(plan.surfaceNotes ?? []),
        ],
      };
      if (skip) {
        report.entries.push({
          ...shared,
          status: 'skipped',
          skipKind: skip.kind,
          skipReason: skip.reason,
          plan: null,
          defects: [],
        });
        continue;
      }
      report.entries.push({
        ...shared,
        status: plan.defects.length > 0 ? 'invalid' : 'planned',
        plan: {
          deployLookup: { kind: 'slug', slug: plan.slug },
          deployCreate: plan.deployCreateBody,
          deployCreateIdempotencyKey: plan.deployCreateIdempotencyKey,
          contentSha256Header: 'sha256(JSON request body), lowercase hex',
          anchor: plan.recordedAnchor
            ? { value: plan.recordedAnchor, source: 'environment', path: plan.recordedAnchorPath }
            : plan.anchorOverride
              ? { value: plan.anchorOverride, source: '--anchor-map' }
              : {
                value: '',
                source: anchorKind === 'deploy-application-uuid'
                  ? 'deploy response id (uuid)'
                  : 'deploy response deployApplicationId',
              },
          iam: {
            path: '/backend/v3/api/iam/installations',
            applicationType: plan.applicationType,
            instanceKey: plan.instanceKeyHint,
            tenantId: plan.tenantId,
            organizationId: plan.organizationId,
            accessPermissions: plan.permissionScope,
            primaryDomain: plan.primaryDomain,
          },
          environment: {
            path: '/backend/v3/api/iam/tenants/{tenantId}/installations/{installationId}'
              + '/environments/{envKey}',
            envKey: plan.environment,
            primaryDomain: plan.primaryDomain,
            primaryDomainSource: plan.primaryDomainSource,
            envStatus: 'active',
          },
          anchorSinks: plan.sinkPaths.map((sink) => ({
            kind: sink.kind,
            deploymentProfile: sink.deploymentProfile,
            path: sink.path,
          })),
          surfaces: plan.surfaceGroup.surfaces.map((surface) => ({
            id: surface.id,
            format: surface.format,
            anchorVariable: surface.anchorKey,
            profileFiles: surface.profileFiles,
          })),
          excludedSurfaces: plan.surfaceGroup.excluded,
          materialize: plan.hasClientEnv && plan.surfaceGroup.surfaces.length > 0
            ? {
              repoRoot: path.relative(workspaceRoot, plan.repoAbsoluteRoot),
              mode: plan.anchorGroup,
              surfaces: plan.surfaces,
              anchorVariables: plan.surfaceGroup.surfaces.map((surface) => surface.anchorKey),
            }
            : 'not-applicable',
        },
        defects: plan.defects,
        ...(plan.appTypeRepair ? { appTypeRepair: plan.appTypeRepair } : {}),
        ...(plan.appTypeRepairPlanned ? { appTypeRepairPlanned: plan.appTypeRepairPlanned } : {}),
      });
    }
    report.counts = summarizeCounts(report.entries, plans.length);
    return report;
  }

  const ownershipScope = trim(options.ownershipScope).toUpperCase();
  if (ownershipScope && !['TENANT', 'ORGANIZATION', 'USER'].includes(ownershipScope)) {
    throw new RegistrationConfigurationError(
      `ownershipScope=${JSON.stringify(options.ownershipScope)} is not TENANT, ORGANIZATION, or USER`,
    );
  }
  if (ownershipScope === 'ORGANIZATION' && !/^[1-9][0-9]*$/u.test(trim(options.organizationId))) {
    throw new RegistrationConfigurationError(
      'ORGANIZATION registration requires a positive organizationId override',
    );
  }
  if (ownershipScope === 'USER' && !/^[1-9][0-9]*$/u.test(trim(options.ownerUserId))) {
    throw new RegistrationConfigurationError(
      'USER registration requires a positive ownerUserId',
    );
  }

  const settings = options.settings;
  if (!settings) {
    throw new RegistrationConfigurationError(
      'registration settings are missing; resolve them from the environment before running',
    );
  }
  const deployClient = dependencies.deployClient
    ?? createDeployApplicationClient({
      baseUrl: settings.deploy.baseUrl,
      accessToken: settings.deploy.accessToken,
      authToken: settings.deploy.authToken,
      timeoutMs: settings.deploy.timeoutMs,
      fetchImpl: dependencies.fetchImpl,
    });
  const iamClient = dependencies.iamClient
    ?? createIamApplicationClient({
      baseUrl: settings.iam.baseUrl,
      auth: settings.iam.auth,
      management: settings.iam.management,
      transport: settings.iam.transport,
      timeoutMs: settings.iam.timeoutMs,
      fetchImpl: dependencies.fetchImpl,
    });

  const context = {
    deployClient,
    iamClient,
    // One installation per deploy anchor, one row per lifecycle: the cache keeps
    // several surfaces that resolve to the same installation from upserting the
    // same `(installation, environment)` row twice in one run.
    environments: new Map(),
    options: {
      ...options,
      anchorKind,
      allowUnverifiedIamBinding: options.allowUnverifiedIamBinding === true,
      recordDeployUuid: options.recordDeployUuid !== false,
      writeAnchor: options.writeAnchor !== false,
      materialize: options.materialize !== false,
      regenerateTopologyEnv: options.regenerateTopologyEnv !== false,
      registerEnvironments: options.registerEnvironments !== false,
    },
    retryPolicy: { maxAttempts, retryDelayMs, sleep, jitter },
    runNodeScript,
  };

  const invalid = plans.filter(({ plan, skip }) => !skip && plan.defects.length > 0);
  const skipped = plans.filter(({ skip }) => Boolean(skip));
  const runnable = plans.filter(({ plan, skip }) => !skip && plan.defects.length === 0);
  const invalidEntries = invalid.map(({ plan }) => ({
    id: plan.id,
    repo: plan.repo,
    appDir: plan.appDir,
    label: plan.label,
    environment: plan.environment,
    slug: plan.slug,
    applicationType: plan.applicationType,
    applicationTypeSource: plan.applicationTypeSource ?? '',
    deployAppKind: plan.deployKind,
    deployAppKindSource: plan.deployKindSource,
    appType: plan.appTypeDeclared,
    canonicalAppType: plan.canonicalAppType,
    permissionScopeCount: plan.permissionScope.length,
    permissionScopeRequirement: plan.permissionScopeRequirement,
    clientSurface: plan.clientSurface,
    serversOnly: plan.serversOnly,
    primaryDomain: plan.primaryDomain,
    primaryDomainSource: plan.primaryDomainSource,
    anchorGroup: plan.anchorGroup,
    surfaces: [...plan.surfaces],
    status: 'failed',
    error: plan.defects.join('; '),
    errorKind: 'plan',
    deployApplicationId: '',
    deployApplicationUuid: '',
    iam: {},
    installationEnvironment: { envKey: plan.environment, status: '', primaryDomain: plan.primaryDomain },
    anchor: { mode: plan.anchorGroup, written: [], outcomes: [], surfaces: [], skipped: '' },
    materialize: { status: 'skipped', reason: 'item failed before registration' },
  }));
  const skippedEntries = skipped.map(({ plan, skip }) => ({
    id: plan.id,
    repo: plan.repo,
    appDir: plan.appDir,
    label: plan.label,
    environment: plan.environment,
    slug: plan.slug,
    applicationType: plan.applicationType,
    permissionScopeCount: plan.permissionScope.length,
    permissionScopeRequirement: plan.permissionScopeRequirement,
    permissionScopeRequirementReason: plan.permissionScopeRequirementReason,
    clientSurface: plan.clientSurface,
    serversOnly: plan.serversOnly,
    primaryDomain: '',
    primaryDomainSource: '',
    anchorGroup: plan.anchorGroup,
    surfaces: [...plan.surfaces],
    status: 'skipped',
    skipKind: skip.kind,
    skipReason: skip.reason,
    notes: plan.permissionScopeRequirementNotes,
    deployApplicationId: '',
    deployApplicationUuid: '',
    iam: {},
    installationEnvironment: { envKey: plan.environment, status: '', primaryDomain: '' },
    anchor: { mode: plan.anchorGroup, written: [], outcomes: [], surfaces: [], skipped: skip.reason },
    materialize: { status: 'skipped', reason: 'server-only root skipped before registration' },
  }));

  const registered = await runWithConcurrency(runnable, concurrency, ({ plan }) =>
    registerOne(context, plan));
  // Keep the plan order in the report: plan defects, skips, and registration
  // results are merged back by the plan they belong to.
  const resultById = new Map(registered.map((entry) => [entry.id, entry]));
  const invalidById = new Map(invalidEntries.map((entry) => [entry.id, entry]));
  const skippedById = new Map(skippedEntries.map((entry) => [entry.id, entry]));
  for (const { plan } of plans) {
    const entry = invalidById.get(plan.id) ?? skippedById.get(plan.id) ?? resultById.get(plan.id);
    if (entry) {
      report.entries.push(entry);
    }
  }

  await runEnvironmentHandoff(context, report.entries, planByItemId);
  report.counts = summarizeCounts(report.entries, plans.length);
  report.finishedAt = new Date().toISOString();
  return report;
}

function summarizeCounts(entries, planned) {
  const count = (status) => entries.filter((entry) => entry.status === status).length;
  return {
    planned,
    created: count('created'),
    reused: count('reused'),
    failed: count('failed'),
    invalid: count('invalid'),
    // A `serversOnly` root is skipped on purpose: no public client token exists,
    // so the registration has no accessTokenPermissionScope to carry. The count is
    // reported so the skip is visible and auditable.
    skipped: count('skipped'),
    environmentsActive: entries.filter(
      (entry) => (entry.installationEnvironment?.status ?? '').toLowerCase() === 'active',
    ).length,
    environmentsSkipped: entries.filter(
      (entry) => entry.installationEnvironment?.status === 'skipped',
    ).length,
    environmentsDeduplicated: entries.filter(
      (entry) => entry.installationEnvironment?.deduplicated === true,
    ).length,
    anchorWritten: entries.filter((entry) => (entry.anchor?.written?.length ?? 0) > 0).length,
    anchorsAlreadyPresent: entries.filter((entry) => {
      const outcomes = entry.anchor?.outcomes ?? [];
      return outcomes.length > 0 && outcomes.every((outcome) => outcome.outcome === 'unchanged');
    }).length,
    materialized: entries.filter((entry) => entry.materialize?.status === 'materialized').length,
    materializeFailed: entries.filter((entry) => entry.materialize?.status === 'failed').length,
    // Retained for report compatibility: since every surface materializes only
    // its own carrier files, two anchors of one repository can no longer collide
    // inside one materializer run, so this count stays 0.
    materializeConflict: entries.filter((entry) => entry.materialize?.status === 'conflict').length,
    // Registration granularity evidence: items registered as their own surface
    // (one deploy application per manifest root) and the surface-scoped anchors
    // they recorded.
    surfaceScoped: entries.filter((entry) => entry.anchorGroup === 'surface').length,
    surfaceMaterialized: entries.filter(
      (entry) => entry.materialize?.status === 'materialized' && entry.materialize?.mode === 'surface',
    ).length,
    surfaceAnchorsWritten: entries.filter((entry) =>
      entry.anchor?.mode === 'surface'
      && (entry.anchor?.surfaces ?? []).some((surface) =>
        surface.id !== ''
        && (surface.outcomes ?? []).some((outcome) =>
          outcome.outcome === 'updated' || outcome.outcome === 'created')),
    ).length,
  };
}

/**
 * Describe how the dual-token management surface will authenticate.
 * @param iam - resolved `settings.iam`
 * @returns `dual-token`, `session-from-operator-password`, or `absent`
 */
function resolveManagementCredentialState(iam) {
  const management = iam?.management ?? {};
  if (trim(management.accessToken) && trim(management.authToken)) {
    return 'dual-token';
  }
  if (trim(management.username) && trim(management.password)) {
    return 'session-from-operator-password';
  }
  return 'absent';
}

/**
 * Run one task per item with a bounded number of in-flight tasks.
 *
 * A full workspace is 80+ applications, and the backend rate limiter trips when
 * they are fired at once, so the default is 2 (`--concurrency`). Results keep the
 * plan order regardless of completion order, so a report reads the same on every
 * run.
 * @param items - items to process
 * @param limit - maximum concurrent tasks
 * @param worker - async task; must not throw (item failures are recorded)
 * @returns results in input order
 */
export async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  const width = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
  let cursor = 0;
  const runners = Array.from({ length: width }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
