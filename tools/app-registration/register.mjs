#!/usr/bin/env node

/**
 * Registrar: ensure Deploy application → IAM installation → anchored environment,
 * for every application × environment in the inventory.
 *
 * # Sequence per item (never reordered)
 *
 * 1. **Plan** — derive the deploy slug, the IAM application type, the permission
 *    scope, the deterministic idempotency keys, and the anchor sinks. A plan
 *    defect (no slug, no `app.appType`, no permission scope) is reported as a
 *    failure instead of being skipped.
 * 2. **Deploy ensure** — resolve the application by exact slug through
 *    `apps.list`, otherwise `apps.create` with
 *    `Idempotency-Key: sdkwork-app-register:<environment>:<slug>`. A `409`
 *    (slug already taken) is resolved by re-reading the row, so a concurrent
 *    creator is adopted instead of producing a second application.
 * 3. **Anchor resolution** — the decimal `deploy_app.id`, read from
 *    `AppResponse.deployApplicationId` on the row the deploy ensure step just
 *    returned (list, retrieve, or create). Order: the anchor recorded in the
 *    app's own environment configuration, then an explicit `--anchor-map`
 *    override, then that response field; in `--anchor-kind=deploy-application-uuid`
 *    mode the addressable uuid replaces the response field. Two disagreeing
 *    sources are a hard failure: the registrar never picks one.
 * 4. **IAM ensure** — `POST /backend/v3/api/iam/tenant_applications` with the
 *    anchor, the derived `provisioningIdempotencyKey`, the application type and
 *    the manifest permission scope; then `.../{id}/enable` when the reconciled
 *    installation is not already `enabled`.
 * 5. **Verify** — the installation must report `enabled` and echo the same
 *    anchor. A response that cannot prove the binding is refused (see
 *    `--allow-unverified-iam-binding`).
 * 6. **Environment hand-off** — write `SDKWORK_DEPLOY_APPLICATION_ID` into the
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
  RegistrationConfigurationError,
  assertDeployApplicationIdForKind,
  buildDeployAppCreateBody,
  buildTenantApplicationProvisionBody,
  defaultDeploymentProfile,
  deployAppCreateIdempotencyKey,
  deployAppKindForApplicationType,
  formatRegistrationItemLabel,
  normalizeEnvironment,
  readDeployAppItem,
  readTenantApplicationItem,
  resolveDeploySlug,
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
    primaryDomain: trim(entry.environments?.[environment]?.domain),
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

async function withRetries(operation, { maxAttempts, retryDelayMs, sleep }) {
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
      await sleep(retryDelayMs * attempt);
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

async function ensureIamInstallation(context, plan, anchor, applicationType) {
  const { iamClient, options } = context;
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
    () => iamClient.provisionTenantApplication(body),
    context.retryPolicy,
  );
  let item = readTenantApplicationItem(provisioned.value);
  let enabledNow = false;
  if (item.status.toLowerCase() !== 'enabled') {
    if (!item.tenantApplicationId) {
      throw new IamApiError(
        `IAM provisioned an installation for ${plan.label} without returning its id, so it cannot `
        + 'be enabled or verified',
        { kind: 'unreadable' },
      );
    }
    const enabled = await withRetries(
      () => iamClient.enableTenantApplication(item.tenantApplicationId, {
        tenantId: plan.tenantId,
      }),
      context.retryPolicy,
    );
    item = readTenantApplicationItem(enabled.value);
    enabledNow = true;
  }
  const verified = verifyIamInstallation(plan, anchor, item, options);
  return {
    item,
    enabledNow,
    provisioningIdempotencyKey: body.provisioningIdempotencyKey,
    verified,
    attempts: provisioned.attempts,
  };
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
 * Register one planned item (Deploy ensure → anchor → IAM ensure → verify).
 * @param context - clients, options, retry policy
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
    status: 'failed',
    deployApplicationId: '',
    deployApplicationUuid: '',
    deployAppStatus: '',
    anchorSource: '',
    iam: {},
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

    const iamOutcome = await ensureIamInstallation(
      context,
      plan,
      resolved.anchor,
      plan.applicationType,
    );
    result.iam = {
      tenantApplicationId: iamOutcome.item.tenantApplicationId,
      appId: iamOutcome.item.appId,
      status: iamOutcome.item.status,
      deployApplicationId: iamOutcome.item.deployApplicationId,
      enabledNow: iamOutcome.enabledNow,
      provisioningIdempotencyKey: iamOutcome.provisioningIdempotencyKey,
      anchorVerified: iamOutcome.verified.anchorVerified,
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
    : 2;
  const retryDelayMs = Number.isInteger(options.retryDelayMs) && options.retryDelayMs >= 0
    ? options.retryDelayMs
    : 250;
  const sleep = dependencies.sleep ?? sleepDefault;
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
    settings: {
      deployBaseUrl: trim(options.settings?.deploy?.baseUrl),
      iamBaseUrl: trim(options.settings?.iam?.baseUrl),
      tenantId: trim(options.settings?.tenantId),
      organizationId: trim(options.settings?.organizationId),
      deployCredentials: options.settings?.deploy?.accessToken ? 'present' : 'absent',
      iamCredentials: options.settings?.iam?.auth ? 'present' : 'absent',
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
        status: plan.defects.length > 0 ? 'invalid' : 'planned',
        plan: {
          deployLookup: { kind: 'slug', slug: plan.slug },
          deployCreate: plan.deployCreateBody,
          deployCreateIdempotencyKey: plan.deployCreateIdempotencyKey,
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
      timeoutMs: settings.iam.timeoutMs,
      fetchImpl: dependencies.fetchImpl,
    });

  const context = {
    deployClient,
    iamClient,
    options: {
      ...options,
      anchorKind,
      allowUnverifiedIamBinding: options.allowUnverifiedIamBinding === true,
      recordDeployUuid: options.recordDeployUuid !== false,
      writeAnchor: options.writeAnchor !== false,
      materialize: options.materialize !== false,
      regenerateTopologyEnv: options.regenerateTopologyEnv !== false,
    },
    retryPolicy: { maxAttempts, retryDelayMs, sleep },
    runNodeScript,
  };

  for (const { plan } of plans) {
    if (plan.defects.length > 0) {
      report.entries.push({
        id: plan.id,
        repo: plan.repo,
        appDir: plan.appDir,
        label: plan.label,
        environment: plan.environment,
        slug: plan.slug,
        applicationType: plan.applicationType,
        status: 'failed',
        error: plan.defects.join('; '),
        errorKind: 'plan',
        deployApplicationId: '',
        deployApplicationUuid: '',
        iam: {},
        anchor: { written: [], outcomes: [], skipped: '' },
        materialize: { status: 'skipped', reason: 'item failed before registration' },
      });
      continue;
    }
    const result = await registerOne(context, plan);
    report.entries.push(result);
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
