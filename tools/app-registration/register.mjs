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
 *    anchor sinks. A plan defect (no slug, no `app.appType`, no permission scope,
 *    no primary domain source) is reported as a failure instead of being skipped:
 *    an item that cannot be anchored or enabled must not reach Deploy or IAM.
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
 * 4. **IAM provision** —`POST /backend/v3/api/iam/tenant_applications` with the
 *    anchor, the derived `provisioningIdempotencyKey`, the application type, the
 *    manifest permission scope, and the resolved `primaryDomain` (enable refuses a
 *    blank one).
 * 5. **Environment row** —`PUT /backend/v3/api/iam/tenants/{tenantId}/applications/{installationId}/environments/{envKey}`
 *    with `primaryDomain` + `envStatus=active`, keyed by the row identity and
 *    deduplicated per installation, so several surfaces of one repository do not
 *    create a second row.
 * 6. **Enable + verify** —enable only after the environment row exists; the
 *    installation must report `enabled` and echo the same anchor. A response that
 *    cannot prove the binding is refused (see `--allow-unverified-iam-binding`).
 * 7. **Environment hand-off** —write `SDKWORK_DEPLOY_APPLICATION_ID` into the
 *    authored env layer, regenerate the generated topology profile, and re-run
 *    the client-env materializer so each profile's public token carries the
 *    anchor.
 *
 * Failure of one item is recorded and the run continues; the exit code reflects
 * the failure count. Nothing is ever skipped silently: every item ends as
 * `created`, `reused`, or `failed`, and every failure carries a diagnostic naming
 * the route or the variable.
 *
 * @module app-registration/register
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  DEPLOY_APPLICATION_ID_ENV,
  PRIMARY_DOMAIN_SOURCES,
  RegistrationConfigurationError,
  assertDeployApplicationIdForKind,
  buildDeployAppCreateBody,
  buildTenantApplicationProvisionBody,
  defaultDeploymentProfile,
  deployAppCreateIdempotencyKey,
  deployAppKindForApplicationType,
  environmentUpsertIdempotencyKey,
  formatRegistrationItemLabel,
  normalizeEnvironment,
  readDeployAppItem,
  readTenantApplicationItem,
  resolveDeploySlug,
  resolvePrimaryDomain,
  tenantApplicationInstanceKey,
} from './contract.mjs';
import { DeployApiError, createDeployApplicationClient, findAppBySlug } from './deploy-client.mjs';
import { IamApiError, createIamApplicationClient } from './iam-client.mjs';
import { readRecordedAnchor, writeAnchorEnv } from './env-anchor.mjs';

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
  // exists, otherwise the first surface manifest. The client-env materializer
  // bakes exactly one deploy anchor per repository (every surface resolves
  // `appIdEnv` from the same process environment), so a per-surface anchor
  // cannot survive materialization; `--scope all` registers every manifest root
  // for deployments that generate tokens per surface by another route.
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
 * Normalize one inventory entry into the facts the registrar acts on.
 * @param entry - inventory entry
 * @param allEntries - entries taking part in this run (slug collision scope)
 * @param environment - canonical environment
 * @param options - deployment profile, anchor overrides
 * @returns the plan plus its defects
 */
export function planRegistrationItem(entry, allEntries, environment, options = {}) {
  const defects = [];
  const plan = {
    id: entry.id,
    repo: entry.repo,
    appDir: entry.appDir,
    label: formatRegistrationItemLabel(entry, environment),
    environment,
    applicationType: trim(entry.applicationType),
    permissionScope: Array.isArray(entry.permissionScope) ? [...entry.permissionScope] : [],
    tenantId: trim(options.tenantId) || trim(entry.tenantId) || '100001',
    organizationId: trim(options.organizationId) || trim(entry.organizationId) || '0',
    primaryDomain: '',
    primaryDomainSource: '',
    slug: '',
    slugSource: '',
    deployCreateIdempotencyKey: '',
    deployCreateBody: null,
    anchorOverrides: {},
  };

  if (plan.applicationType === '') {
    defects.push(
      `${entry.id}: app.appType is missing from agent.app.config.json; IAM provisioning needs a `
      + 'product-semantic applicationType',
    );
  }
  if (plan.permissionScope.length === 0) {
    defects.push(
      `${entry.id}: backend.accessTokenPermissionScope is empty; IAM application bootstrap refuses `
      + 'a manifest with no default access permissions (an explicit empty array is only valid when '
      + 'the manifest declares the field)',
    );
  }
  try {
    const resolved = resolveDeploySlug(entry, allEntries);
    plan.slug = resolved.slug;
    plan.slugSource = resolved.slugSource;
    plan.slugDisambiguated = resolved.disambiguated;
  } catch (error) {
    defects.push(error instanceof Error ? error.message : String(error));
  }

  if (plan.slug) {
    plan.deployCreateIdempotencyKey = deployAppCreateIdempotencyKey(environment, plan.slug);
    plan.deployCreateBody = buildDeployAppCreateBody({
      slug: plan.slug,
      name: entry.appName,
      displayName: entry.displayName,
      appKind: deployAppKindForApplicationType(plan.applicationType),
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
    plan.primaryDomain = resolvedDomain.domain;
    plan.primaryDomainSource = resolvedDomain.source;
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
  // A recorded anchor that is also a uuid can be read directly; the app API
  // addresses applications by uuid, so this is the only exact re-read.
  if (recorded && options.anchorKind === 'deploy-application-uuid') {
    const existing = await withRetries(
      () => deployClient.retrieveApp(recorded),
      context.retryPolicy,
    );
    if (existing.value) {
      return {
        item: existing.value,
        created: false,
        attempts: existing.attempts,
        lookup: 'anchor',
      };
    }
  }
  const found = await withRetries(
    () => findAppBySlug(deployClient, plan.slug),
    context.retryPolicy,
  );
  if (found.value) {
    return { item: found.value, created: false, attempts: found.attempts, lookup: 'slug' };
  }
  try {
    const created = await withRetries(
      () => deployClient.createApp(plan.deployCreateBody, {
        idempotencyKey: plan.deployCreateIdempotencyKey,
      }),
      context.retryPolicy,
    );
    return { item: created.value, created: true, attempts: created.attempts, lookup: 'create' };
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
        return {
          item: adopted.value,
          created: false,
          attempts: adopted.attempts,
          lookup: 'slug-after-conflict',
        };
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
  const body = buildTenantApplicationProvisionBody({
    deployApplicationId: anchor,
    anchorKind: context.options.anchorKind,
    applicationType,
    environment: plan.environment,
    tenantId: plan.tenantId,
    organizationId: plan.organizationId,
    displayName: plan.displayName || plan.slug,
    appKey: plan.slug,
    accessPermissions: plan.permissionScope,
    primaryDomain: plan.primaryDomain,
  });
  const provisioned = await withRetries(
    () => context.iamClient.provisionTenantApplication(body),
    context.retryPolicy,
  );
  const item = readTenantApplicationItem(provisioned.value);
  if (!item.tenantApplicationId) {
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
  const cacheKey = `${item.tenantApplicationId}@${plan.environment}`;
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
      item.tenantApplicationId,
      plan.environment,
    );
    const upserted = await withRetries(
      () => context.iamClient.upsertInstallationEnvironment({
        tenantId: plan.tenantId,
        installationId: item.tenantApplicationId,
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
    () => context.iamClient.enableTenantApplication(item.tenantApplicationId, {
      tenantId: plan.tenantId,
    }),
    context.retryPolicy,
  );
  return readTenantApplicationItem(enabled.value);
}

function verifyIamInstallation(plan, anchor, item, options) {
  const problems = [];
  if (item.status.toLowerCase() !== 'enabled') {
    problems.push(`installation ${item.tenantApplicationId || '(unknown)'} is ${item.status || '(no status)'} instead of enabled`);
  }
  if (item.deployApplicationId) {
    if (item.deployApplicationId !== anchor) {
      problems.push(
        `installation ${item.tenantApplicationId || '(unknown)'} is bound to deploy application `
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
    permissionScopeCount: plan.permissionScope.length,
    primaryDomain: plan.primaryDomain,
    primaryDomainSource: plan.primaryDomainSource,
    status: 'failed',
    deployApplicationId: '',
    deployApplicationUuid: '',
    deployAppStatus: '',
    anchorSource: '',
    iam: {},
    installationEnvironment: { envKey: plan.environment, status: '', primaryDomain: plan.primaryDomain },
    anchor: { written: [], outcomes: [], skipped: '' },
    materialize: { status: 'pending' },
    attempts: 0,
    error: '',
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
      tenantApplicationId: provisioned.item.tenantApplicationId,
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

async function runEnvironmentHandoff(context, entries, planByItemId) {
  const { options, runNodeScript } = context;
  const repositories = new Map();
  for (const result of entries) {
    if (result.status === 'failed') {
      continue;
    }
    const plan = planByItemId.get(result.id);
    const sinkPaths = plan.sinkPaths.map((sink) => sink.absolutePath);
    if (sinkPaths.length === 0) {
      result.anchor.skipped = 'no authored environment configuration for this application';
    } else if (options.writeAnchor) {
      const outcomes = writeAnchorEnv({
        sinkPaths,
        anchor: result.deployApplicationId,
        uuid: result.deployApplicationUuid,
        recordUuid: options.recordDeployUuid,
      });
      result.anchor.outcomes = outcomes.map((outcome) => ({
        path: outcome.path,
        outcome: outcome.outcome,
      }));
      result.anchor.written = outcomes
        .filter((outcome) => outcome.outcome === 'updated' || outcome.outcome === 'created')
        .map((outcome) => outcome.path);
      const topologySinks = plan.sinkPaths.filter((sink) => sink.kind === 'topology-override');
      if (options.regenerateTopologyEnv && topologySinks.length > 0) {
        const byRepo = new Map();
        for (const sink of topologySinks) {
          const key = sink.absoluteRepoRoot ?? plan.repoAbsoluteRoot ?? '';
          const bucket = byRepo.get(key) ?? new Set();
          bucket.add(sink.deploymentProfile);
          byRepo.set(key, bucket);
        }
        for (const [repoRoot, profiles] of byRepo.entries()) {
          if (!repoRoot) {
            continue;
          }
          for (const deploymentProfile of profiles) {
            if (!deploymentProfile) {
              continue;
            }
            const run = await runNodeScript({
              script: path.join(TOOLS_DIR, 'materialize-topology-env.mjs'),
              args: ['--root', repoRoot, '--profile', `${deploymentProfile}.${result.environment}`],
              cwd: repoRoot,
              env: { ...process.env },
              timeoutMs: 120_000,
            });
            result.anchor.topologyRegenerated = result.anchor.topologyRegenerated ?? [];
            result.anchor.topologyRegenerated.push({
              repoRoot,
              profileId: `${deploymentProfile}.${result.environment}`,
              code: run.code,
            });
            if (run.code !== 0) {
              result.anchor.topologyRegenerationFailed = true;
            }
          }
        }
      }
    } else {
      result.anchor.skipped = 'anchor writing disabled (--no-write-anchor)';
    }
    const repoKey = plan.repoAbsoluteRoot ?? result.repo;
    const bucket = repositories.get(repoKey) ?? {
      repoRoot: plan.repoAbsoluteRoot ?? '',
      hasClientEnv: Boolean(plan.hasClientEnv),
      items: [],
      anchors: new Set(),
    };
    bucket.items.push(result);
    bucket.anchors.add(result.deployApplicationId);
    repositories.set(repoKey, bucket);
  }

  for (const bucket of repositories.values()) {
    for (const result of bucket.items) {
      if (!options.materialize) {
        result.materialize = { status: 'skipped', reason: 'materialization disabled (--no-materialize)' };
        continue;
      }
      if (!bucket.hasClientEnv) {
        result.materialize = {
          status: 'not-applicable',
          reason: 'repository declares no etc/client-env.materialization.json',
        };
        continue;
      }
      if (bucket.anchors.size > 1) {
        result.materialize = {
          status: 'conflict',
          reason:
            'this repository has several distinct deploy anchors in the run and the client-env '
            + 'materializer bakes one anchor per repository; materialize each surface group '
            + 'separately',
          anchors: [...bucket.anchors],
        };
        continue;
      }
      const [anchor] = [...bucket.anchors];
      if (!bucket.repoRoot || !anchor) {
        result.materialize = {
          status: 'failed',
          reason: 'cannot resolve the repository root or the anchor for materialization',
        };
        continue;
      }
      const run = await runNodeScript({
        script: path.join(TOOLS_DIR, 'materialize-client-env.mjs'),
        // One environment per run: every environment is a separate deployment
        // with its own anchor, so materializing the whole profile matrix would
        // bake this run's anchor into another environment's profile files.
        args: ['--root', bucket.repoRoot, '--environment', result.environment],
        cwd: bucket.repoRoot,
        env: { ...process.env, [DEPLOY_APPLICATION_ID_ENV]: anchor },
        timeoutMs: 180_000,
      });
      result.materialize = {
        status: run.code === 0 ? 'materialized' : 'failed',
        code: run.code,
        repoRoot: bucket.repoRoot,
        anchor,
      };
    }
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
    // Slug collisions are resolved against every parsed manifest in the
    // workspace, not only the selected subset, so `--scope surfaces` and
    // `--scope all` derive the same slug for the same application.
    const { plan, defects } = planRegistrationItem(
      entry,
      inventory.entries.filter((candidate) => !candidate.parseError),
      environment,
      {
        tenantId: options.tenantId,
        organizationId: options.organizationId,
        deploymentProfile: explicitDeploymentProfile,
        anchorOverrides,
        primaryDomainPattern: options.primaryDomainPattern,
      },
    );
    plan.repoAbsoluteRoot = repoRoot;
    plan.appAbsoluteRoot = appRoot;
    plan.displayName = trim(entry.displayName) || trim(entry.appName);
    plan.hasClientEnv = entry.tokenCarrier?.kind === 'client-env-materializer';
    plan.surfaces = (entry.tokenCarrier?.surfaces ?? []).map((surface) => surface.id);
    for (const sink of plan.sinkPaths) {
      // Inventory sink paths are workspace-relative; the writer needs the
      // absolute path under the repository that owns the env configuration.
      sink.absolutePath = path.resolve(workspaceRoot, sink.path);
      sink.absoluteRepoRoot = repoRoot;
    }
    const recorded = readRecordedAnchor(plan.sinkPaths.map((sink) => sink.absolutePath));
    if (recorded.conflict.length > 0) {
      defects.push(
        `${entry.id}: conflicting ${DEPLOY_APPLICATION_ID_ENV} values across environment `
        + `configuration: ${recorded.conflict.map((item) => `${item.path}=${item.value}`).join(', ')}`,
      );
    }
    plan.recordedAnchor = recorded.value;
    plan.recordedAnchorPath = recorded.path;
    // The instance key is derived from the anchor (decimal deploy application id),
    // never from the slug: the registrar and the embedded/Node bootstrap must
    // derive the same `tenant_application_instance_key` for one installation.
    const anchorForInstanceKey = trim(recorded.value) || trim(plan.anchorOverride);
    plan.instanceKeyHint = anchorForInstanceKey
      ? tenantApplicationInstanceKey(anchorForInstanceKey, environment)
      : `(deploy-application-id)_${environment === 'development'
        ? 'dev'
        : environment === 'production'
          ? 'prod'
          : environment}`;
    plan.defects = defects;
    plans.push({ entry, plan });
  }

  markDuplicatePrimaryDomains(plans);

  const planByItemId = new Map(plans.map((entry) => [entry.plan.id, entry.plan]));

  if (options.dryRun) {
    for (const { plan } of plans) {
      report.entries.push({
        id: plan.id,
        repo: plan.repo,
        appDir: plan.appDir,
        label: plan.label,
        environment: plan.environment,
        slug: plan.slug,
        slugSource: plan.slugSource,
        slugDisambiguated: Boolean(plan.slugDisambiguated),
        applicationType: plan.applicationType,
        permissionScopeCount: plan.permissionScope.length,
        primaryDomain: plan.primaryDomain,
        primaryDomainSource: plan.primaryDomainSource,
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
            path: '/backend/v3/api/iam/tenant_applications',
            applicationType: plan.applicationType,
            instanceKey: plan.instanceKeyHint,
            tenantId: plan.tenantId,
            organizationId: plan.organizationId,
            accessPermissions: plan.permissionScope,
            primaryDomain: plan.primaryDomain,
          },
          environment: {
            path: '/backend/v3/api/iam/tenants/{tenantId}/applications/{installationId}'
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
          materialize: plan.hasClientEnv
            ? { repoRoot: path.relative(workspaceRoot, plan.repoAbsoluteRoot), surfaces: plan.surfaces }
            : 'not-applicable',
        },
        defects: plan.defects,
      });
    }
    report.counts = summarizeCounts(report.entries, plans.length);
    return report;
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

  const invalid = plans.filter(({ plan }) => plan.defects.length > 0);
  const runnable = plans.filter(({ plan }) => plan.defects.length === 0);
  const invalidEntries = invalid.map(({ plan }) => ({
    id: plan.id,
    repo: plan.repo,
    appDir: plan.appDir,
    label: plan.label,
    environment: plan.environment,
    slug: plan.slug,
    applicationType: plan.applicationType,
    primaryDomain: plan.primaryDomain,
    primaryDomainSource: plan.primaryDomainSource,
    status: 'failed',
    error: plan.defects.join('; '),
    errorKind: 'plan',
    deployApplicationId: '',
    deployApplicationUuid: '',
    iam: {},
    installationEnvironment: { envKey: plan.environment, status: '', primaryDomain: plan.primaryDomain },
    anchor: { written: [], outcomes: [], skipped: '' },
    materialize: { status: 'skipped', reason: 'item failed before registration' },
  }));

  const registered = await runWithConcurrency(runnable, concurrency, ({ plan }) =>
    registerOne(context, plan));
  // Keep the plan order in the report: plan defects and registration results are
  // merged back by the plan they belong to.
  const resultById = new Map(registered.map((entry) => [entry.id, entry]));
  const invalidById = new Map(invalidEntries.map((entry) => [entry.id, entry]));
  for (const { plan } of plans) {
    const entry = invalidById.get(plan.id) ?? resultById.get(plan.id);
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
    materializeConflict: entries.filter((entry) => entry.materialize?.status === 'conflict').length,
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
