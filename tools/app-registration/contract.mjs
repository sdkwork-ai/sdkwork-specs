#!/usr/bin/env node

/**
 * Registration contract: identities, deterministic idempotency keys, provision
 * body, and fail-closed configuration.
 *
 * Everything here is pure and synchronous, so the rules that decide *what* the
 * registrar asks Deploy and IAM for can be tested without a socket.
 *
 * # Identity model
 *
 * - The deploy application is the installation identity. Deploy mints both the
 *   BIGINT `id` and the `uuid` server side; `apps.retrieve` addresses the row by
 *   `uuid` (`deploy_app.uuid`), while IAM binds its installation through
 *   `iam_tenant_application.deploy_application_id`, which Deploy's own identity
 *   provisioning port writes as the decimal BIGINT (`deploy_app.id`).
 * - The app API returns both on every list/retrieve/create/update response:
 *   `AppResponse.id` is the uuid and `AppResponse.deployApplicationId` is the
 *   decimal anchor (`sdkwork-deployments` commit `7471031`). The anchor is read
 *   from that field and never derived from the uuid or the slug.
 * - The public application access token carries that same anchor as `app_id` and
 *   `aud` (`access_token_issue.rs`: "the installation's deploy application id").
 *   The anchor is therefore never synthesized, never the slug, and never another
 *   surface's value.
 * - Because the two identifiers are different facts, every result records both:
 *   `deployApplicationUuid` (addressable on the app API) and
 *   `deployApplicationId` (the anchor IAM and the token carry).
 *
 * # Idempotency model
 *
 * - `apps.create` uses `Idempotency-Key: sdkwork-app-register:<environment>:<slug>`.
 *   The key and the body depend only on the app slug, the environment, and the
 *   app's own manifest fields, so a retry replays the first row instead of
 *   colliding on `uk_deploy_app_tenant_slug`.
 * - `iam.tenantApplications.create` uses
 *   `provisioningIdempotencyKey = iam-bootstrap-<sha256(...)[0..40]>` over the
 *   same identity tuple the framework derives it from
 *   (`@sdkwork/iam-application-bootstrap` `deriveProvisioningIdempotencyKey`), so
 *   the registrar and the runtime bootstrap converge on one installation.
 *
 * @module app-registration/contract
 */

import { createHash } from 'node:crypto';

/** Environment variable that carries the registration anchor. */
export const DEPLOY_APPLICATION_ID_ENV = 'SDKWORK_DEPLOY_APPLICATION_ID';

/** Prefix of the deterministic `apps.create` idempotency key. */
export const DEPLOY_APP_CREATE_IDEMPOTENCY_KEY_PREFIX = 'sdkwork-app-register:';

/** Prefix of the deterministic IAM provisioning key (framework-compatible). */
export const IAM_PROVISIONING_IDEMPOTENCY_KEY_PREFIX = 'iam-bootstrap-';

/** Longest `Idempotency-Key` the deploy route accepts. */
export const DEPLOY_IDEMPOTENCY_KEY_MAX_LEN = 128;

/** Longest deploy application slug (`deploy_app.slug VARCHAR(120)`). */
export const DEPLOY_APP_SLUG_MAX_LEN = 120;

/** Longest deploy application name accepted by `apps.create`. */
export const DEPLOY_APP_NAME_MAX_LEN = 200;

/** Product-semantic application types IAM provisioning accepts. */
export const IAM_TENANT_APPLICATION_TYPES = ['api', 'h5', 'pc', 'flutter', 'other'];

/** Canonical registration environments. */
export const REGISTRATION_ENVIRONMENTS = [
  'development',
  'test',
  'staging',
  'demo',
  'production',
];

/** Environment aliases accepted on the command line. */
const ENVIRONMENT_ALIASES = new Map([
  ['dev', 'development'],
  ['local', 'development'],
  ['development', 'development'],
  ['test', 'test'],
  ['staging', 'staging'],
  ['demo', 'demo'],
  ['prod', 'production'],
  ['production', 'production'],
]);

/** Deployment profile that serves each environment when none is passed. */
const DEFAULT_DEPLOYMENT_PROFILE_BY_ENVIRONMENT = new Map([
  ['development', 'standalone'],
  ['test', 'standalone'],
  ['staging', 'cloud'],
  ['demo', 'cloud'],
  ['production', 'cloud'],
]);

/**
 * Required and optional environment variables per side.
 *
 * The Deploy names are the ones the shipped installer already reads
 * (`deploy_application.rs`), so one deployment configures both tools; the IAM
 * names are the canonical bootstrap-operator names from
 * `IAM_APPLICATION_BOOTSTRAP_SPEC` §5.2.
 */
export const REGISTRATION_SETTINGS_ENV = Object.freeze({
  deploy: Object.freeze({
    baseUrl: 'SDKWORK_DEPLOY_BACKEND_API_BASE_URL',
    accessToken: 'SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN',
    authToken: 'SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN',
    timeoutMs: 'SDKWORK_DEPLOY_BACKEND_TIMEOUT_MS',
  }),
  iam: Object.freeze({
    baseUrlCandidates: ['SDKWORK_IAM_BACKEND_API_BASE_URL', 'SDKWORK_BACKEND_BASE_URL'],
    authTokenCandidates: [
      'SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN',
      'SDKWORK_IAM_BOOTSTRAP_AUTH_TOKEN',
    ],
    usernameCandidates: [
      'SDKWORK_IAM_BOOTSTRAP_OPERATOR_USERNAME',
      'SDKWORK_IAM_BOOTSTRAP_USERNAME',
    ],
    passwordCandidates: [
      'SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD',
      'SDKWORK_IAM_BOOTSTRAP_PASSWORD',
    ],
    timeoutMs: 'SDKWORK_IAM_BACKEND_TIMEOUT_MS',
  }),
  tenantId: 'SDKWORK_TENANT_ID',
  organizationId: 'SDKWORK_ORGANIZATION_ID',
});

/** Raised when registration cannot start because configuration is missing. */
export class RegistrationConfigurationError extends Error {
  /**
   * @param message - operator-facing message
   * @param details - structured detail (missing variables, offending values)
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'RegistrationConfigurationError';
    this.details = details;
  }
}

function trimToValue(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : '';
}

/**
 * Normalize a lifecycle environment name.
 * @param value - raw environment (`dev`, `prod`, `production`, ...)
 * @returns the canonical environment
 * @throws {RegistrationConfigurationError} when the value is not a lifecycle
 */
export function normalizeEnvironment(value) {
  const normalized = ENVIRONMENT_ALIASES.get(trimToValue(value).toLowerCase());
  if (!normalized) {
    throw new RegistrationConfigurationError(
      `unsupported environment ${JSON.stringify(String(value ?? ''))}; expected one of `
      + `${REGISTRATION_ENVIRONMENTS.join(', ')} (aliases: dev, local, prod)`,
      { value },
    );
  }
  return normalized;
}

/**
 * Deployment profile that serves one environment when none is requested.
 * @param environment - canonical environment
 * @returns `standalone` or `cloud`
 */
export function defaultDeploymentProfile(environment) {
  return DEFAULT_DEPLOYMENT_PROFILE_BY_ENVIRONMENT.get(normalizeEnvironment(environment));
}

/**
 * Map the manifest `app.appType` onto the IAM provisioning `applicationType`.
 * @param appType - manifest `app.appType`
 * @returns the provisioning type, `other` for an unrecognized value, or `''`
 */
export function mapManifestAppTypeToApplicationType(appType) {
  const normalized = trimToValue(appType).toUpperCase();
  if (!normalized) {
    return '';
  }
  switch (normalized) {
    case 'APP_HTML':
    case 'APP_H5':
    case 'H5':
      return 'h5';
    case 'APP_FLUTTER':
    case 'FLUTTER':
      return 'flutter';
    case 'APP_REACT':
    case 'APP_VUE':
    case 'APP_PC':
    case 'PC':
    case 'WEB':
    case 'DESKTOP':
      return 'pc';
    case 'APP_API':
    case 'API':
    case 'SDK':
      return 'api';
    default:
      return 'other';
  }
}

/**
 * Lowercase DNS-label form of an application key or name.
 * @param value - candidate slug source
 * @returns the slug, possibly empty when the value has no ASCII alphanumeric
 */
export function slugifyAppKey(value) {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '');
  return slug.slice(0, DEPLOY_APP_SLUG_MAX_LEN).replace(/-+$/u, '');
}

/**
 * Deterministic deploy slug for one application root.
 *
 * The manifest identity wins (`app.key`, then `app.name`), and the directory
 * name is the fallback. Two application roots that would derive the same slug
 * (a fork that kept its upstream key) are disambiguated with the repository
 * name, so the plan is stable and two apps never fight over
 * `uk_deploy_app_tenant_slug`.
 * @param entry - inventory entry (`appKey`, `appName`, `slug`, `repo`, `id`)
 * @param allEntries - every inventory entry taking part in this run
 * @returns the slug and how it was derived
 */
export function resolveDeploySlug(entry, allEntries) {
  const directorySlug = slugifyAppKey(
    entry.appDir && entry.appDir !== '.' ? entry.appDir.split(/[\\/]/u).pop() : entry.repo,
  );
  const base = slugifyAppKey(entry.appKey) || slugifyAppKey(entry.appName) || directorySlug;
  if (!base) {
    throw new RegistrationConfigurationError(
      `${entry.id}: cannot derive a deploy application slug from app.key=${JSON.stringify(entry.appKey)} `
      + `or app.name=${JSON.stringify(entry.appName)}; set app.key in agent.app.config.json`,
      { entry: entry.id },
    );
  }
  const collisions = (allEntries ?? []).filter((candidate) => {
    const candidateDirectorySlug = slugifyAppKey(
      candidate.appDir && candidate.appDir !== '.'
        ? candidate.appDir.split(/[\\/]/u).pop()
        : candidate.repo,
    );
    const candidateBase = slugifyAppKey(candidate.appKey) || slugifyAppKey(candidate.appName)
      || candidateDirectorySlug;
    return candidateBase === base && candidate.id !== entry.id;
  });
  if (collisions.length === 0) {
    return { slug: base, slugSource: 'app.key', disambiguated: false };
  }
  const repoSlug = slugifyAppKey(entry.repo);
  const qualified = `${repoSlug}-${base}`.slice(0, DEPLOY_APP_SLUG_MAX_LEN).replace(/-+$/u, '');
  return { slug: qualified, slugSource: 'repo+app.key', disambiguated: true };
}

/**
 * Deterministic `apps.create` `Idempotency-Key`.
 *
 * One key per (environment, slug): a retry after a timeout replays the first row
 * rather than creating a second application, and a different app never shares a
 * key because the slug is unique in the tenant.
 * @param environment - canonical environment
 * @param slug - deploy application slug
 * @returns the idempotency key, within the route's 128-character limit
 */
export function deployAppCreateIdempotencyKey(environment, slug) {
  const key = `${DEPLOY_APP_CREATE_IDEMPOTENCY_KEY_PREFIX}${environment}:${slug}`;
  if (key.length <= DEPLOY_IDEMPOTENCY_KEY_MAX_LEN) {
    return key;
  }
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return `${DEPLOY_APP_CREATE_IDEMPOTENCY_KEY_PREFIX}${environment}:${digest}`;
}

/**
 * Stable per-installation instance key, mirroring the embedded and Node bootstrap.
 * @param anchor - deploy application anchor
 * @param environment - canonical environment
 * @returns the derived instance key
 */
export function tenantApplicationInstanceKey(anchor, environment) {
  const normalized = trimToValue(anchor).replace(/-/gu, '_');
  const lifecycle = normalizeEnvironment(environment);
  if (lifecycle === 'development') {
    return `${normalized}_dev`;
  }
  if (lifecycle === 'production') {
    return `${normalized}_prod`;
  }
  return `${normalized}_${lifecycle.replace(/-/gu, '_')}`;
}

/**
 * Deterministic IAM provisioning idempotency key.
 *
 * Byte-compatible with `@sdkwork/iam-application-bootstrap`
 * `deriveProvisioningIdempotencyKey`: `sha256` over the same six newline-joined
 * fields, truncated to 40 hex characters. Re-running either implementation
 * therefore reconciles one installation.
 * @param command - provisioning identity tuple
 * @returns `iam-bootstrap-<digest>`
 */
export function deriveProvisioningIdempotencyKey(command) {
  const identity = [
    command.tenantId,
    command.organizationId,
    command.deployApplicationId,
    command.applicationType,
    command.instanceKey,
    command.environment,
  ]
    .map((value) => trimToValue(value))
    .join('\n');
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 40);
  return `${IAM_PROVISIONING_IDEMPOTENCY_KEY_PREFIX}${digest}`;
}

/**
 * Refuse anything that is not a decimal application id.
 *
 * The anchor reaches a URL segment, an IAM link column, and a token claim; a
 * uuid, a slug, a blank, or a newline in that position silently binds an
 * installation to the wrong identity.
 * @param value - candidate anchor
 * @param label - who supplied it (for the diagnostic)
 * @returns the normalized decimal anchor
 * @throws {RegistrationConfigurationError} when the value is not decimal digits
 */
export function assertDeployApplicationAnchor(value, label = DEPLOY_APPLICATION_ID_ENV) {
  const anchor = trimToValue(value);
  if (!anchor) {
    throw new RegistrationConfigurationError(
      `${label} is empty; expected the decimal deploy application id`,
      { value },
    );
  }
  if (!/^[0-9]+$/u.test(anchor)) {
    throw new RegistrationConfigurationError(
      `${label}=${JSON.stringify(anchor)} is not a deploy application id: the anchor is the `
      + 'decimal `deploy_app.id` IAM binds (`deploy_application_id`) and that every access token '
      + 'carries as `app_id`/`aud`. A uuid or slug in this position binds the installation to a '
      + 'different identity than the deploy row that owns it.',
      { value: anchor },
    );
  }
  return anchor;
}

/**
 * Refuse anything that is not one URL path segment / identity value.
 *
 * Used for the `deploy-application-uuid` anchor kind, where the deployment binds
 * the addressable uuid on purpose. The value still reaches a URL segment and a
 * token claim, so it must not carry `/`, `?`, `#`, `%`, whitespace, or control
 * characters.
 * @param value - candidate anchor
 * @param label - who supplied it (for the diagnostic)
 * @returns the normalized anchor
 * @throws {RegistrationConfigurationError} when the value is not one segment
 */
export function assertDeployApplicationUuid(value, label = DEPLOY_APPLICATION_ID_ENV) {
  const anchor = trimToValue(value);
  if (!anchor) {
    throw new RegistrationConfigurationError(
      `${label} is empty; expected the deploy application uuid`,
      { value },
    );
  }
  if (anchor.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(anchor)) {
    throw new RegistrationConfigurationError(
      `${label}=${JSON.stringify(anchor)} is not a single application identity segment `
      + "(allowed: ascii letters, digits, '-', '_', '.', ':' up to 128 characters)",
      { value: anchor },
    );
  }
  return anchor;
}

/**
 * Validate an anchor against the selected anchor kind.
 * @param value - candidate anchor
 * @param label - who supplied it (for the diagnostic)
 * @param anchorKind - `deploy-application-id` (decimal) or `deploy-application-uuid`
 * @returns the normalized anchor
 * @throws {RegistrationConfigurationError} when the value does not match the kind
 */
export function assertDeployApplicationIdForKind(value, label, anchorKind) {
  return anchorKind === 'deploy-application-uuid'
    ? assertDeployApplicationUuid(value, label)
    : assertDeployApplicationAnchor(value, label);
}

/**
 * Deterministic `apps.create` body.
 *
 * Every persisted field is derived from the application identity only, so a
 * retried create produces the same `request_sha256` and replays the recorded row
 * instead of being rejected as "key reused with a different body".
 * @param input - slug plus manifest identity
 * @returns the request body
 */
export function buildDeployAppCreateBody(input) {
  const slug = trimToValue(input.slug);
  if (!slug) {
    throw new RegistrationConfigurationError('deploy application slug is required to create an app');
  }
  const name = (
    trimToValue(input.displayName)
    || trimToValue(input.name)
    || slug
  ).slice(0, DEPLOY_APP_NAME_MAX_LEN);
  const body = {
    name,
    slug,
    appKind: trimToValue(input.appKind) || 'API_SERVICE',
  };
  const environment = trimToValue(input.environment).toLowerCase();
  if (environment) {
    body.defaultEnvironment = environment.slice(0, 16);
  }
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : null;
  if (metadata) {
    body.metadata = metadata;
  }
  return body;
}

/**
 * Deploy `appKind` for one application type.
 *
 * Deploy's own vocabulary (`AppKind`) is a delivery shape, IAM's
 * `applicationType` is a product semantic shape; this is the only place the two
 * are related.
 * @param applicationType - IAM application type
 * @returns the deploy app kind
 */
export function deployAppKindForApplicationType(applicationType) {
  switch (trimToValue(applicationType)) {
    case 'h5':
      return 'SPA_WEB';
    case 'pc':
      return 'SPA_WEB';
    case 'api':
      return 'API_SERVICE';
    default:
      return 'API_SERVICE';
  }
}

/**
 * Build the IAM `tenantApplications.create` body.
 *
 * The bootstrap operator credentials travel in the body (that is the route's
 * declared auth mode), and the anchor is the deploy application id — never the
 * manifest's runtime `backend.appId` fallback, which is the retired identity the
 * token must not carry.
 * @param input - anchor, application identity, tenant scope, and operator auth
 * @returns the request body
 */
export function buildTenantApplicationProvisionBody(input) {
  const anchorKind = trimToValue(input.anchorKind) || 'deploy-application-id';
  if (!['deploy-application-id', 'deploy-application-uuid'].includes(anchorKind)) {
    throw new RegistrationConfigurationError(
      `unsupported anchorKind ${JSON.stringify(input.anchorKind)}`,
    );
  }
  const deployApplicationId = assertDeployApplicationIdForKind(
    input.deployApplicationId,
    DEPLOY_APPLICATION_ID_ENV,
    anchorKind,
  );
  const applicationType = trimToValue(input.applicationType).toLowerCase();
  if (!IAM_TENANT_APPLICATION_TYPES.includes(applicationType)) {
    throw new RegistrationConfigurationError(
      `applicationType=${JSON.stringify(input.applicationType)} is not a tenant application type `
      + `(expected one of ${IAM_TENANT_APPLICATION_TYPES.join('|')})`,
    );
  }
  const environment = normalizeEnvironment(input.environment);
  const tenantId = trimToValue(input.tenantId);
  const organizationId = trimToValue(input.organizationId);
  if (!tenantId) {
    throw new RegistrationConfigurationError(
      'tenantId is required to provision a tenant application',
    );
  }
  if (!organizationId) {
    throw new RegistrationConfigurationError(
      'organizationId is required to provision a tenant application',
    );
  }
  const instanceKey = trimToValue(input.instanceKey)
    || tenantApplicationInstanceKey(deployApplicationId, environment);
  const command = {
    deployApplicationId,
    applicationType,
    tenantId,
    organizationId,
    instanceKey,
    displayName: (trimToValue(input.displayName) || trimToValue(input.appKey) || instanceKey)
      .slice(0, 200),
    environment,
    provisioningIdempotencyKey: trimToValue(input.provisioningIdempotencyKey)
      || deriveProvisioningIdempotencyKey({
        tenantId,
        organizationId,
        deployApplicationId,
        applicationType,
        instanceKey,
        environment,
      }),
  };
  if (Array.isArray(input.accessPermissions)) {
    // An empty array is an explicit "no API scope" choice (IAM_APPLICATION_BOOTSTRAP_SPEC §4)
    // and must survive as-is rather than fall back to a default.
    command.accessPermissions = input.accessPermissions.filter(
      (entry) => typeof entry === 'string' && entry.trim().length > 0,
    );
  } else if (input.accessPermissions === null) {
    command.accessPermissions = [];
  }
  const runtimeConfig = input.runtimeConfig;
  if (runtimeConfig && typeof runtimeConfig === 'object' && !Array.isArray(runtimeConfig)) {
    command.runtimeConfig = runtimeConfig;
  }
  const primaryDomain = trimToValue(input.primaryDomain);
  if (primaryDomain) {
    command.primaryDomain = primaryDomain;
  }
  return command;
}

/**
 * Extract the anchor facts out of one deploy application item.
 *
 * `id` is the addressable uuid (`AppResponse.id` maps `deploy_app.uuid`) and
 * `deployApplicationId` is the decimal anchor (`deploy_app.id`); both are read
 * from the same row. A response that omits the anchor or carries a non-decimal
 * value is refused, so the uuid is never promoted into the anchor position.
 * @param item - `data.item` of a deploy response
 * @returns uuid, decimal anchor, slug, status, tenant
 * @throws {RegistrationConfigurationError} when the uuid or the decimal anchor is missing
 */
export function readDeployAppItem(item) {
  if (!item || typeof item !== 'object') {
    throw new RegistrationConfigurationError('deploy response has no data.item application');
  }
  const uuid = trimToValue(item.id) || trimToValue(item.uuid);
  if (!uuid) {
    throw new RegistrationConfigurationError('deploy application item has no id (uuid)');
  }
  const anchor = trimToValue(item.deployApplicationId);
  if (!anchor) {
    throw new RegistrationConfigurationError(
      `deploy application ${uuid} carried no deployApplicationId; the app API returns the decimal `
      + '`deploy_app.id` anchor on every response, and IAM binds that value rather than the uuid',
      { uuid },
    );
  }
  return {
    uuid,
    deployApplicationId: assertDeployApplicationAnchor(
      anchor,
      'deploy response deployApplicationId',
    ),
    slug: trimToValue(item.slug),
    name: trimToValue(item.name),
    appStatus: trimToValue(item.appStatus),
    tenantId: trimToValue(item.tenantId),
    raw: item,
  };
}

/**
 * Extract the installation facts out of one tenant-application item.
 * @param item - `data.item` of a provision/enable response
 * @returns installation id, anchor, status, runtime app id
 */
export function readTenantApplicationItem(item) {
  if (!item || typeof item !== 'object') {
    throw new RegistrationConfigurationError('IAM response has no tenant application item');
  }
  const tenantApplicationId = trimToValue(item.tenantApplicationId) || trimToValue(item.id);
  return {
    tenantApplicationId,
    deployApplicationId: trimToValue(item.deployApplicationId),
    status: trimToValue(item.status),
    appId: trimToValue(item.appId),
    instanceKey: trimToValue(item.instanceKey),
    applicationType: trimToValue(item.applicationType),
    raw: item,
  };
}

function readFirstEnv(env, candidates) {
  for (const key of candidates) {
    const value = trimToValue(env[key]);
    if (value) {
      return { key, value };
    }
  }
  return { key: candidates[0], value: '' };
}

function assertHttpBaseUrl(value, label) {
  if (!/^https?:\/\//iu.test(value)) {
    throw new RegistrationConfigurationError(
      `${label} must be an absolute http(s) URL such as http://127.0.0.1:3902, got `
      + `${JSON.stringify(value)}`,
      { value },
    );
  }
  return value.replace(/\/+$/u, '');
}

/**
 * Resolve the deploy and IAM connection settings from the environment.
 *
 * Every missing value is collected before failing, and every message names the
 * exact variable, so an operator is never told "credentials missing" without
 * being told which ones.
 * @param env - process environment bag
 * @returns deploy/IAM base URLs, credentials, tenant scope, timeouts
 * @throws {RegistrationConfigurationError} naming every missing variable
 */
export function resolveRegistrationSettings(env = process.env) {
  const missing = [];
  const deployBase = readFirstEnv(env, [REGISTRATION_SETTINGS_ENV.deploy.baseUrl]);
  if (!deployBase.value) {
    missing.push(deployBase.key);
  }
  const deployAccess = readFirstEnv(env, [REGISTRATION_SETTINGS_ENV.deploy.accessToken]);
  if (!deployAccess.value) {
    missing.push(deployAccess.key);
  }
  const deployAuth = readFirstEnv(env, [REGISTRATION_SETTINGS_ENV.deploy.authToken]);
  if (!deployAuth.value) {
    missing.push(deployAuth.key);
  }
  const iamBase = readFirstEnv(env, REGISTRATION_SETTINGS_ENV.iam.baseUrlCandidates);
  if (!iamBase.value) {
    missing.push(iamBase.key);
  }
  const iamAuthToken = readFirstEnv(env, REGISTRATION_SETTINGS_ENV.iam.authTokenCandidates);
  const iamUsername = readFirstEnv(env, REGISTRATION_SETTINGS_ENV.iam.usernameCandidates);
  const iamPassword = readFirstEnv(env, REGISTRATION_SETTINGS_ENV.iam.passwordCandidates);
  if (!iamAuthToken.value && !(iamUsername.value && iamPassword.value)) {
    missing.push(
      `${REGISTRATION_SETTINGS_ENV.iam.authTokenCandidates[0]} or `
      + `${REGISTRATION_SETTINGS_ENV.iam.usernameCandidates[0]} + `
      + `${REGISTRATION_SETTINGS_ENV.iam.passwordCandidates[0]}`,
    );
  }
  if (missing.length > 0) {
    throw new RegistrationConfigurationError(
      `registration cannot start: ${missing.length} required setting(s) are missing or blank:\n`
      + missing.map((name) => `  - ${name}`).join('\n')
      + '\nSet them in the deployment profile environment; the registrar never invents a '
      + 'credential, a base URL, or an application identity.',
      { missing },
    );
  }

  const tenantId = trimToValue(env[REGISTRATION_SETTINGS_ENV.tenantId]);
  const organizationId = trimToValue(env[REGISTRATION_SETTINGS_ENV.organizationId]);
  const iamAuth = iamAuthToken.value
    ? { authToken: iamAuthToken.value }
    : { username: iamUsername.value, password: iamPassword.value };

  return {
    deploy: {
      baseUrl: assertHttpBaseUrl(deployBase.value, deployBase.key),
      accessToken: deployAccess.value,
      authToken: deployAuth.value,
      timeoutMs: readTimeout(env, REGISTRATION_SETTINGS_ENV.deploy.timeoutMs),
    },
    iam: {
      baseUrl: assertHttpBaseUrl(iamBase.value, iamBase.key),
      auth: iamAuth,
      timeoutMs: readTimeout(env, REGISTRATION_SETTINGS_ENV.iam.timeoutMs),
    },
    tenantId,
    organizationId,
  };
}

function readTimeout(env, key) {
  const raw = trimToValue(env[key]);
  if (!raw) {
    return 10_000;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 500 || parsed > 60_000) {
    throw new RegistrationConfigurationError(
      `${key}=${JSON.stringify(raw)} must be an integer number of milliseconds in 500..60000`,
      { key, value: raw },
    );
  }
  return parsed;
}

/**
 * Console label for one registration item.
 * @param entry - inventory entry
 * @param environment - canonical environment
 * @returns `repo/appdir@environment`
 */
export function formatRegistrationItemLabel(entry, environment) {
  const appDir = entry.appDir && entry.appDir !== '.' ? `/${entry.appDir}` : '';
  return `${entry.repo}${appDir}@${environment}`;
}
