#!/usr/bin/env node

/**
 * Public application access token generator for SDKWork client env profiles.
 *
 * The token is SaaS-isolation material, not a secret. It is a three-part JWT
 * with `alg: none`, `kid: public-app-token`, and `token_class: application`.
 * Every manifest-bearing application root carries one token per profile in its
 * committed per-scope env file (`APP_ACCESS_TOKEN_SPEC.md`).
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const PUBLIC_APP_ACCESS_TOKEN_KEY = 'SDKWORK_ACCESS_TOKEN';
export const PUBLIC_APP_ACCESS_TOKEN_KID = 'public-app-token';

/**
 * Committed app id placeholder for a surface whose anchor is known only at
 * deployment (`APP_ACCESS_TOKEN_SPEC.md` §3.1.1,
 * `APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §8).
 *
 * A repository commits this value instead of a fabricated identity, and a
 * verification gate reports it as needing materialization rather than as a claim
 * mismatch. A packaging gate that requires the anchor refuses it.
 */
export const PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID = '__SDKWORK_DEPLOY_APPLICATION_ID__';

/**
 * True when a token claim still carries the committed app id placeholder.
 *
 * The canonical placeholder is `__SDKWORK_DEPLOY_APPLICATION_ID__`; the
 * `<ENV_VAR>`-derived form is accepted too, so a surface that declares a
 * different anchor variable keeps the same signal.
 * @param appId - token `app_id` or `aud` claim.
 * @param envName - declared anchor variable, when known.
 * @returns true when the value is a pending materialization placeholder.
 */
export function isApplicationAccessTokenPendingAppId(appId, envName = '') {
  const value = String(appId ?? '').trim();
  if (!value) {
    return false;
  }
  const name = String(envName ?? '').trim();
  return value === PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID
    || (name ? value === `__${name}__` : false);
}

/**
 * `accessToken` field naming the environment variable that carries the app id.
 *
 * A deployment that makes the deploy application the identity of every access
 * token (`IAM_APPLICATION_BOOTSTRAP_SPEC.md`, `APP_ACCESS_TOKEN_SPEC.md` §3.1.1)
 * cannot compile the app id into the repository: the id belongs to the
 * installation. Such a surface declares `"appIdEnv": "<ENV_VAR>"` instead of
 * `"appId"`, and the materializer reads the anchor from that variable. The
 * equivalent inline placeholder `"appId": "${<ENV_VAR>}"` is accepted too.
 */
export const APP_ACCESS_TOKEN_APP_ID_ENV_FIELD = 'appIdEnv';

const APP_ID_ENV_PLACEHOLDER_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u;

/**
 * Raised when an `appIdEnv`-sourced surface is materialized or verified without
 * the named environment variable.
 *
 * A missing anchor must never fall back to a retired literal: the token would
 * carry an identity IAM suppresses. The error keeps `envName` and `code` so a
 * verification gate can report a readable `skipped: <ENV> not set` instead of
 * failing or silently passing.
 */
export class MissingAppIdEnvironmentError extends Error {
  constructor(envName) {
    super(
      `${envName} is not set: this surface takes its public application token app id from the `
      + 'deployment application anchor, so the generator must fail instead of falling back to a '
      + 'compiled-in app id',
    );
    this.name = 'MissingAppIdEnvironmentError';
    this.code = 'APP_ID_ENV_MISSING';
    this.envName = envName;
  }
}

/**
 * Classify a resolver failure as the "anchor unavailable" case.
 * @param error - thrown value.
 * @returns true when it is a {@link MissingAppIdEnvironmentError}.
 */
export function isMissingAppIdEnvironmentError(error) {
  return error instanceof MissingAppIdEnvironmentError;
}

function resolveAppIdFromEnvironment(envName, env) {
  const value = String(env?.[envName] ?? '').trim();
  if (!value) {
    throw new MissingAppIdEnvironmentError(envName);
  }
  return { appId: value, source: 'env', envName };
}

/**
 * Environment variable a surface takes its deployment anchor from, if any.
 *
 * Returns the declared `accessToken.appIdEnv` name, or the variable named by an
 * inline `${ENV_VAR}` placeholder in `accessToken.appId`. A plain literal
 * `appId` is repository-owned, so it has no environment source and yields `''`.
 * @param accessTokenSpec - materialization `accessToken` input object.
 * @returns the environment variable name, or `''`.
 */
export function resolveApplicationAccessTokenEnvName(accessTokenSpec = {}) {
  const spec = accessTokenSpec && typeof accessTokenSpec === 'object' ? accessTokenSpec : {};
  const envField = String(spec[APP_ACCESS_TOKEN_APP_ID_ENV_FIELD] ?? '').trim();
  if (envField) {
    return envField;
  }
  const placeholder = APP_ID_ENV_PLACEHOLDER_PATTERN.exec(String(spec.appId ?? '').trim());
  return placeholder?.[1] ?? '';
}

/**
 * Env-name suffix that identifies one surface inside a deployment anchor name.
 *
 * Every surface of a repository deploys as its own application
 * (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §5), so the anchor variable is
 * surface-scoped: `<declared anchor variable>_<SURFACE>`. The suffix is derived
 * from the surface id only, so two runs of the same declaration always name the
 * same variable.
 * @param surfaceId - declared client surface id.
 * @returns the upper-snake suffix, or `''` when the id has no name characters.
 */
export function surfaceAnchorEnvSuffix(surfaceId) {
  return String(surfaceId ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+/u, '')
    .replace(/_+$/u, '');
}

/**
 * Per-surface anchor variable derived from a declared anchor variable.
 *
 * `SDKWORK_DEPLOY_APPLICATION_ID` + `sdkwork-im-pc` yields
 * `SDKWORK_DEPLOY_APPLICATION_ID_SDKWORK_IM_PC`. The declaration keeps naming the
 * base variable, so a repository that materialized one anchor for all surfaces
 * keeps working; a registration that anchors each surface writes the derived
 * name and the materializer reads it for that surface only.
 * @param baseEnvName - the declared anchor variable (`accessToken.appIdEnv`).
 * @param surfaceId - declared client surface id.
 * @returns the surface-scoped variable name, or `''` when it cannot be derived.
 */
export function surfaceApplicationTokenEnvName(baseEnvName, surfaceId) {
  const base = String(baseEnvName ?? '').trim();
  const suffix = surfaceAnchorEnvSuffix(surfaceId);
  if (!base || !suffix) {
    return '';
  }
  return `${base}_${suffix}`;
}

/**
 * Resolve the app id of one `accessToken` input object.
 *
 * Precedence: `appIdEnv` (or an inline `${ENV_VAR}` placeholder in `appId`)
 * reads the deployment anchor; a plain `appId` remains a literal identity for
 * surfaces whose app id is genuinely repository-owned. Declaring both a literal
 * and an env source is ambiguous and fails.
 * @param accessTokenSpec - materialization `accessToken` input object.
 * @param env - environment bag to read the anchor from.
 * @returns the resolved app id plus its source.
 */
export function resolveApplicationAccessTokenAppId(accessTokenSpec = {}, env = process.env) {
  const spec = accessTokenSpec && typeof accessTokenSpec === 'object' ? accessTokenSpec : {};
  const envField = String(spec[APP_ACCESS_TOKEN_APP_ID_ENV_FIELD] ?? '').trim();
  const declaredAppId = String(spec.appId ?? '').trim();
  if (envField && declaredAppId) {
    throw new Error(
      `accessToken must declare either ${APP_ACCESS_TOKEN_APP_ID_ENV_FIELD} or appId, not both.`,
    );
  }
  if (envField) {
    return resolveAppIdFromEnvironment(envField, env);
  }
  const placeholder = APP_ID_ENV_PLACEHOLDER_PATTERN.exec(declaredAppId);
  if (placeholder?.[1]) {
    return resolveAppIdFromEnvironment(placeholder[1], env);
  }
  if (declaredAppId) {
    return { appId: declaredAppId, source: 'literal' };
  }
  throw new Error(
    `accessToken must declare ${APP_ACCESS_TOKEN_APP_ID_ENV_FIELD} (a deployment anchor env var) `
    + 'or appId (a repository-owned app id) for a public application access token.',
  );
}

/**
 * Release-scope claim carried by every public application access token.
 *
 * `APPLICATION_IDENTITY_SPEC.md` §4.1 owns the vocabulary, the default, and the
 * immutable-installation rule; IAM stamps the same claim on every deployment
 * credential. The public token `MUST` declare it: IAM compares it against the
 * installation, and an absent claim can only derive `TENANT` or `ORGANIZATION`,
 * never `USER`, so a personal installation rejects a token that omits it.
 */
export const PUBLIC_APP_ACCESS_TOKEN_OWNERSHIP_SCOPE_CLAIM = 'ownership_scope';
export const APPLICATION_OWNERSHIP_SCOPES = Object.freeze(['TENANT', 'ORGANIZATION', 'USER']);
export const DEFAULT_APPLICATION_OWNERSHIP_SCOPE = 'TENANT';

/**
 * Process environment variable that overrides the materialized release scope.
 *
 * The scope belongs to the installation, not to the repository: one source tree
 * produces several deployments, so a deployment-provided value outranks the
 * committed surface declaration (`APPLICATION_IDENTITY_SPEC.md` §4.1 rule 3).
 */
export const APPLICATION_OWNERSHIP_SCOPE_ENV = 'SDKWORK_APPLICATION_OWNERSHIP_SCOPE';

/**
 * Process environment variable naming the owner of a `USER`-scoped release.
 *
 * The claim it feeds is the existing `user_id`; it is read only when the
 * resolved scope is `USER`, so a tenant or organization profile is never
 * affected by this variable.
 */
export const APPLICATION_OWNER_USER_ID_ENV = 'SDKWORK_APPLICATION_OWNER_USER_ID';

/**
 * `accessToken` field declaring the release scope
 * (`etc/client-env.materialization.json`).
 */
export const APP_ACCESS_TOKEN_OWNERSHIP_SCOPE_FIELD = 'ownershipScope';

/**
 * `accessToken` field declaring the owner user id of a `USER`-scoped release.
 */
export const APP_ACCESS_TOKEN_OWNER_USER_ID_FIELD = 'ownerUserId';

/**
 * Normalize and validate one release-scope value.
 *
 * The accepted spelling is the canonical upper-case vocabulary of
 * `APPLICATION_IDENTITY_SPEC.md` §4.1; an unknown value fails closed instead of
 * being mapped to the default, matching IAM's claim parser.
 * @param value - declared or claimed scope.
 * @param label - what the caller is validating, for the error message.
 * @returns the canonical upper-case scope.
 * @throws when the value is empty or not one of the three scopes.
 */
export function normalizeApplicationOwnershipScope(value, label = 'ownershipScope') {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) {
    throw new Error(`${label} is required; expected one of ${APPLICATION_OWNERSHIP_SCOPES.join(', ')}.`);
  }
  if (!APPLICATION_OWNERSHIP_SCOPES.includes(normalized)) {
    throw new Error(
      `${label}=${String(value)} is not a release scope; expected one of `
      + `${APPLICATION_OWNERSHIP_SCOPES.join(', ')}.`,
    );
  }
  return normalized;
}

/**
 * Resolve a surface's declared release scope with deployment precedence.
 *
 * Precedence, highest first:
 *   1. the process environment (`SDKWORK_APPLICATION_OWNERSHIP_SCOPE`) — the
 *      installation that is being materialized owns the scope;
 *   2. the materialization surface declaration
 *      (`accessToken.ownershipScope`);
 *   3. `TENANT`, the only default in `APPLICATION_IDENTITY_SPEC.md` §4.1.
 * @param accessTokenSpec - materialization `accessToken` input object.
 * @param env - environment bag to read the override from.
 * @returns the resolved scope plus its source (`environment`, `declaration`, `default`).
 */
export function resolveApplicationOwnershipScope(accessTokenSpec = {}, env = process.env) {
  const spec = accessTokenSpec && typeof accessTokenSpec === 'object' ? accessTokenSpec : {};
  const fromEnvironment = String(env?.[APPLICATION_OWNERSHIP_SCOPE_ENV] ?? '').trim();
  if (fromEnvironment) {
    return {
      ownershipScope: normalizeApplicationOwnershipScope(
        fromEnvironment,
        APPLICATION_OWNERSHIP_SCOPE_ENV,
      ),
      source: 'environment',
    };
  }
  const declared = String(spec[APP_ACCESS_TOKEN_OWNERSHIP_SCOPE_FIELD] ?? '').trim();
  if (declared) {
    return {
      ownershipScope: normalizeApplicationOwnershipScope(
        declared,
        `accessToken.${APP_ACCESS_TOKEN_OWNERSHIP_SCOPE_FIELD}`,
      ),
      source: 'declaration',
    };
  }
  return { ownershipScope: DEFAULT_APPLICATION_OWNERSHIP_SCOPE, source: 'default' };
}

/**
 * Resolve the owner user id of a `USER`-scoped surface, if one is declared.
 *
 * Precedence matches the scope: process environment
 * (`SDKWORK_APPLICATION_OWNER_USER_ID`), then
 * `accessToken.ownerUserId`. The resolver never invents a value, so a caller
 * that needs one can name the missing source instead of writing a synthetic id.
 * @param accessTokenSpec - materialization `accessToken` input object.
 * @param env - environment bag to read the override from.
 * @returns the owner user id (`''` when none is declared) plus its source.
 */
export function resolveApplicationOwnerUserId(accessTokenSpec = {}, env = process.env) {
  const spec = accessTokenSpec && typeof accessTokenSpec === 'object' ? accessTokenSpec : {};
  const fromEnvironment = String(env?.[APPLICATION_OWNER_USER_ID_ENV] ?? '').trim();
  if (fromEnvironment) {
    return { userId: fromEnvironment, source: 'environment' };
  }
  const declared = String(spec[APP_ACCESS_TOKEN_OWNER_USER_ID_FIELD] ?? '').trim();
  if (declared) {
    return { userId: declared, source: 'declaration' };
  }
  return { userId: '', source: 'none' };
}

/**
 * Resolve the release-scope claims one surface's public token must carry.
 *
 * `TENANT` and `ORGANIZATION` keep `user_id = 0`
 * (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §8). A `USER` release is one
 * person's deployment, so its token carries the owner's user id and generation
 * fails, naming the missing source, when neither the environment nor the
 * surface declaration supplies one.
 * @param accessTokenSpec - materialization `accessToken` input object.
 * @param env - environment bag.
 * @returns the scope, the user-id claim value, and both sources.
 * @throws when the scope is `USER` and no usable owner user id is available.
 */
export function resolveApplicationAccessTokenScope(accessTokenSpec = {}, env = process.env) {
  const { ownershipScope, source } = resolveApplicationOwnershipScope(accessTokenSpec, env);
  if (ownershipScope !== 'USER') {
    return { ownershipScope, source, userId: '0', userIdSource: 'not-applicable' };
  }
  const owner = resolveApplicationOwnerUserId(accessTokenSpec, env);
  if (!owner.userId) {
    throw new Error(
      'ownership_scope=USER requires the owner user id for the token user_id claim: declare '
      + `accessToken.${APP_ACCESS_TOKEN_OWNER_USER_ID_FIELD} or set ${APPLICATION_OWNER_USER_ID_ENV}.`,
    );
  }
  if (owner.userId === '0') {
    const origin = owner.source === 'environment'
      ? APPLICATION_OWNER_USER_ID_ENV
      : `accessToken.${APP_ACCESS_TOKEN_OWNER_USER_ID_FIELD}`;
    throw new Error(
      `${origin} must not be the tenant sentinel 0 for ownership_scope=USER: a personal release `
      + 'carries its owner user id.',
    );
  }
  return { ownershipScope, source, userId: owner.userId, userIdSource: owner.source };
}

export const PUBLIC_APP_ACCESS_TOKEN_ISS = 'sdkwork-iam-public';
export const PUBLIC_APP_ACCESS_TOKEN_SIGNATURE = 'public';
export const PUBLIC_APP_ACCESS_TOKEN_CLASS = 'application';
export const PUBLIC_APP_ACCESS_TOKEN_VERSION = 1;

// Fixed generation instant and rotation ceiling keep committed profiles stable.
// Rotation is an explicit change to these constants plus a full regeneration.
export const PUBLIC_APP_ACCESS_TOKEN_ISSUED_AT = Math.floor(Date.UTC(2026, 0, 1) / 1000);
export const PUBLIC_APP_ACCESS_TOKEN_EXPIRES_AT = Math.floor(Date.UTC(2100, 0, 1) / 1000);

const ENVIRONMENTS = new Set(['development', 'test', 'staging', 'demo', 'production']);
const DEPLOYMENT_PROFILES = new Set(['standalone', 'cloud']);

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value, label) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${label} is required for a public application access token.`);
  }
  return normalized;
}

function assertEnvironment(value) {
  const environment = requireText(value, 'environment');
  if (!ENVIRONMENTS.has(environment)) {
    throw new Error(`Unsupported environment ${environment}; expected development, test, staging, demo, or production.`);
  }
  return environment;
}

function assertDeploymentProfile(value) {
  const deploymentProfile = requireText(value, 'deploymentProfile');
  if (!DEPLOYMENT_PROFILES.has(deploymentProfile)) {
    throw new Error(`Unsupported deployment profile ${deploymentProfile}; expected standalone or cloud.`);
  }
  return deploymentProfile;
}

function resolveDeploymentMode(deploymentProfile) {
  return deploymentProfile === 'cloud' ? 'saas' : 'private';
}

function resolveLoginScope(organizationId) {
  return organizationId === '0' ? 'TENANT' : 'ORGANIZATION';
}

function assertAccessScope(accessScope, organizationId, label = 'accessScope') {
  if (accessScope === undefined) return;
  const normalized = requireText(accessScope, label).toLowerCase();
  if (normalized !== 'tenant' && normalized !== 'organization') {
    throw new Error(`${label} must be tenant or organization.`);
  }
  const expected = organizationId === '0' ? 'tenant' : 'organization';
  if (normalized !== expected) {
    throw new Error(
      `${label}=${normalized} conflicts with organizationId=${organizationId}; `
      + `organization_id must be 0 for a tenant-level token and non-zero for an organization-level token.`,
    );
  }
}

function assertLoginScope(loginScope, organizationId, label = 'loginScope') {
  if (loginScope === undefined) return;
  const normalized = requireText(loginScope, label).toUpperCase();
  const expected = resolveLoginScope(organizationId);
  if (normalized !== expected) {
    throw new Error(
      `${label}=${normalized} conflicts with organizationId=${organizationId}; expected ${expected}.`,
    );
  }
}

/**
 * Owner user id claim of one token.
 *
 * `TENANT` and `ORGANIZATION` releases keep the `0` sentinel; a `USER` release
 * carries its owner, because a personal installation's isolation key ends in
 * `user_id` (`APPLICATION_IDENTITY_SPEC.md` §4.1 rule 7).
 * @param ownershipScope - resolved release scope.
 * @param userId - declared owner user id.
 * @returns the `user_id` claim value.
 */
function resolveOwnerUserIdClaim(ownershipScope, userId) {
  if (ownershipScope !== 'USER') {
    return '0';
  }
  const normalized = normalizeText(userId);
  if (!normalized || normalized === '0') {
    throw new Error(
      'ownership_scope=USER requires the owner user id for the token user_id claim: declare '
      + `accessToken.${APP_ACCESS_TOKEN_OWNER_USER_ID_FIELD} or set ${APPLICATION_OWNER_USER_ID_ENV}.`,
    );
  }
  return normalized;
}

/**
 * Refuse a release scope whose organization or user claims contradict it.
 *
 * The rules are IAM's (`APPLICATION_IDENTITY_SPEC.md` §4.1 rule 7,
 * `IAM_SPEC.md` §5.2): `ORGANIZATION` requires a non-zero `organization_id`,
 * while `TENANT` and `USER` are tenant-level in organization terms and require
 * `organization_id = 0`; a `USER` release additionally requires its owner.
 * @param ownershipScope - resolved release scope.
 * @param organizationId - `organization_id` claim value.
 * @param userId - resolved `user_id` claim value.
 */
function assertOwnershipScopeClaims(ownershipScope, organizationId, userId) {
  if (ownershipScope === 'ORGANIZATION') {
    if (!organizationId || organizationId === '0') {
      throw new Error(
        'ownership_scope=ORGANIZATION requires a non-zero organization_id; declare '
        + 'accessToken.organizationId (or pass --organization-id) for an organization-scoped installation.',
      );
    }
    return;
  }
  if (organizationId !== '0') {
    throw new Error(
      `ownership_scope=${ownershipScope} is a tenant-level release, so organization_id must be 0; `
      + `got ${organizationId}. Declare ownershipScope=ORGANIZATION for an organization-scoped installation.`,
    );
  }
  if (ownershipScope === 'USER' && (!userId || userId === '0')) {
    throw new Error(
      `ownership_scope=USER requires user_id to name the installation owner; got ${userId || '(empty)'}.`,
    );
  }
}

function resolveSessionId(appId, deploymentProfile, environment) {
  return `bootstrap-public-${appId}-${deploymentProfile}.${environment}`;
}

/**
 * Build one deterministic public application access token.
 * @param {object} options - manifest identity and profile.
 * @returns {string} JWT compact serialization.
 */
export function createApplicationAccessToken(options = {}) {
  const appId = requireText(options.appId, 'appId');
  const tenantId = requireText(options.tenantId, 'tenantId');
  const organizationId = normalizeText(options.organizationId) || '0';
  // An explicit scope wins; without one the historical derivation from
  // `organization_id` applies (`TENANT` for 0, `ORGANIZATION` otherwise, never
  // `USER`), which is IAM's legacy rule and keeps a direct generator call with a
  // non-zero organization coherent. Materialization always passes the resolved
  // value, so an undeclared surface gets `TENANT` and an organization id
  // without a scope is refused there (`APP_ACCESS_TOKEN_SPEC.md` §3.2.1).
  const ownershipScope = normalizeApplicationOwnershipScope(
    options.ownershipScope ?? resolveLoginScope(organizationId),
    'ownershipScope',
  );
  const userId = resolveOwnerUserIdClaim(ownershipScope, options.userId);
  assertOwnershipScopeClaims(ownershipScope, organizationId, userId);
  assertAccessScope(options.accessScope, organizationId);
  assertLoginScope(options.loginScope, organizationId);
  const environment = assertEnvironment(options.environment);
  const deploymentProfile = assertDeploymentProfile(options.deploymentProfile);
  const runtimeTarget = requireText(options.runtimeTarget, 'runtimeTarget');
  const permissionScope = Array.isArray(options.permissionScope) && options.permissionScope.length > 0
    ? options.permissionScope.map((entry) => requireText(entry, 'permissionScope entry'))
    : ['iam:self'];
  const issuedAt = Number.isFinite(options.issuedAt)
    ? Math.trunc(options.issuedAt)
    : PUBLIC_APP_ACCESS_TOKEN_ISSUED_AT;
  const expiresAt = Number.isFinite(options.expiresAt)
    ? Math.trunc(options.expiresAt)
    : PUBLIC_APP_ACCESS_TOKEN_EXPIRES_AT;

  const header = {
    alg: 'none',
    kid: PUBLIC_APP_ACCESS_TOKEN_KID,
    typ: 'JWT',
  };
  const payload = {
    app_id: appId,
    aud: appId,
    deployment_mode: resolveDeploymentMode(deploymentProfile),
    deployment_profile: deploymentProfile,
    environment,
    exp: expiresAt,
    iat: issuedAt,
    iss: PUBLIC_APP_ACCESS_TOKEN_ISS,
    login_scope: resolveLoginScope(organizationId),
    organization_id: organizationId,
    ownership_scope: ownershipScope,
    permission_scope: permissionScope,
    runtime_target: runtimeTarget,
    session_id: normalizeText(options.sessionId) || resolveSessionId(appId, deploymentProfile, environment),
    tenant_id: tenantId,
    token_class: PUBLIC_APP_ACCESS_TOKEN_CLASS,
    token_type: 'access',
    token_version: PUBLIC_APP_ACCESS_TOKEN_VERSION,
    user_id: userId,
  };

  return `${base64urlJson(header)}.${base64urlJson(payload)}.${PUBLIC_APP_ACCESS_TOKEN_SIGNATURE}`;
}

/**
 * Decode and validate the public application access token shape.
 * @param {string} token - compact JWT.
 * @returns {{header: object, payload: object}}
 */
export function decodeApplicationAccessToken(token) {
  const parts = normalizeText(token).split('.');
  if (parts.length !== 3) {
    throw new Error('Public application access token must be a three-part JWT compact serialization.');
  }
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error(`Public application access token payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (header?.alg !== 'none' || header?.kid !== PUBLIC_APP_ACCESS_TOKEN_KID) {
    throw new Error(`Public application access token header must declare alg=none and kid=${PUBLIC_APP_ACCESS_TOKEN_KID}.`);
  }
  if (parts[2] !== PUBLIC_APP_ACCESS_TOKEN_SIGNATURE) {
    throw new Error(`Public application access token signature segment must be "${PUBLIC_APP_ACCESS_TOKEN_SIGNATURE}".`);
  }
  if (payload?.token_class !== PUBLIC_APP_ACCESS_TOKEN_CLASS || payload?.token_type !== 'access') {
    throw new Error('Public application access token must declare token_class=application and token_type=access.');
  }
  const organizationId = String(payload.organization_id ?? '');
  const expectedLoginScope = resolveLoginScope(organizationId);
  if (payload.login_scope !== expectedLoginScope) {
    throw new Error(
      `Public application access token login_scope=${payload.login_scope} is inconsistent with `
      + `organization_id=${organizationId}; expected ${expectedLoginScope}.`,
    );
  }
  // An absent claim is the legacy derivation, never `USER`
  // (`APPLICATION_IDENTITY_SPEC.md` §4.1 rule 6). `USER` can only be declared,
  // and it is the one scope that must carry the owner as `user_id`.
  const declaredOwnershipScope = String(payload.ownership_scope ?? '').trim();
  const ownershipScope = declaredOwnershipScope
    ? normalizeApplicationOwnershipScope(declaredOwnershipScope, 'ownership_scope')
    : expectedLoginScope;
  if (ownershipScope === 'ORGANIZATION' && organizationId === '0') {
    throw new Error(
      'Public application access token ownership_scope=ORGANIZATION requires a non-zero '
      + `organization_id; got ${organizationId || '(empty)'}.`,
    );
  }
  if (ownershipScope !== 'ORGANIZATION' && organizationId !== '0') {
    throw new Error(
      `Public application access token ownership_scope=${ownershipScope} requires organization_id=0; `
      + `got ${organizationId}.`,
    );
  }
  if (ownershipScope === 'USER') {
    const userId = String(payload.user_id ?? '').trim();
    if (!userId || userId === '0') {
      throw new Error(
        'Public application access token ownership_scope=USER must carry the installation owner in its '
        + `user_id claim; got ${userId || '(empty)'}.`,
      );
    }
  }
  return { header, payload };
}

/**
 * Validate one committed token against the expected app/profile identity.
 * @param {string} token - committed token.
 * @param {object} expected - expected app identity and profile.
 * @returns {object} decoded payload.
 */
export function assertApplicationAccessToken(token, expected = {}) {
  const { payload } = decodeApplicationAccessToken(token);
  const checks = [
    ['app_id', expected.appId],
    ['aud', expected.appId],
    ['tenant_id', expected.tenantId],
    ['organization_id', expected.organizationId ?? '0'],
    ['environment', expected.environment],
    ['deployment_profile', expected.deploymentProfile],
    ['runtime_target', expected.runtimeTarget],
    ['login_scope', expected.loginScope],
  ];
  for (const [claim, value] of checks) {
    if (value !== undefined && String(payload[claim] ?? '') !== String(value)) {
      throw new Error(`Public application access token claim ${claim}=${payload[claim]} does not match ${value}.`);
    }
  }
  if (expected.ownershipScope !== undefined) {
    const wanted = normalizeApplicationOwnershipScope(expected.ownershipScope, 'expected ownershipScope');
    // Decode already proved the claim/pointer agreement, so an absent claim is
    // the legacy `login_scope` derivation. It is accepted only for a `TENANT`
    // surface: an organization or personal surface must declare the claim so a
    // stale token cannot pass through the legacy fallback.
    const declared = String(payload.ownership_scope ?? '').trim();
    if (!declared && wanted !== DEFAULT_APPLICATION_OWNERSHIP_SCOPE) {
      throw new Error(
        `Public application access token is missing claim `
        + `${PUBLIC_APP_ACCESS_TOKEN_OWNERSHIP_SCOPE_CLAIM}=${wanted}; an absent claim is only valid `
        + `for ${DEFAULT_APPLICATION_OWNERSHIP_SCOPE} (APP_ACCESS_TOKEN_SPEC.md §3.2.1).`,
      );
    }
    const effective = declared
      ? normalizeApplicationOwnershipScope(declared, 'ownership_scope')
      : resolveLoginScope(String(payload.organization_id ?? '0'));
    if (effective !== wanted) {
      throw new Error(
        `Public application access token claim ownership_scope=${declared || effective} does not match ${wanted}.`,
      );
    }
  }
  if (expected.ownerUserId !== undefined) {
    const wanted = String(expected.ownerUserId).trim();
    if (wanted && String(payload.user_id ?? '').trim() !== wanted) {
      throw new Error(
        `Public application access token claim user_id=${payload.user_id ?? ''} does not match ${wanted}.`,
      );
    }
  }
  return payload;
}

function readOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${token} requires a value.`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  app-access-token.mjs generate --app-id <id> --tenant-id <tenant> --environment <environment> \\
    --deployment-profile <standalone|cloud> --runtime-target <target> [options]
  app-access-token.mjs decode --token <jwt>
  app-access-token.mjs verify --token <jwt> --app-id <id> [--tenant-id <tenant>] \\
    [--environment <environment>] [--deployment-profile <standalone|cloud>] [--runtime-target <target>]

Generate options:
  --organization-id <id>       default 0; 0 = tenant-level token, non-zero = organization-level token
  --scope <tenant|organization> explicit login-scope guard; must agree with --organization-id
  --ownership-scope <TENANT|ORGANIZATION|USER>  release scope claim, default TENANT
  --user-id <id>               owner user id; required for --ownership-scope USER, otherwise 0
  --permission-scope <list>    comma-separated, default iam:self
  --session-id <id>            default bootstrap-public-<app>-<profile>.<environment>
  --issued-at <epoch-seconds>  default 1767225600
  --expires-at <epoch-seconds> default 4102444800
  --json                       print token plus decoded header/payload

The token is a public SaaS-isolation string, not a secret.`);
}

function runCli() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }
  const options = readOptions(rest);
  if (command === 'decode') {
    if (!options.token) throw new Error('--token is required.');
    console.log(JSON.stringify(decodeApplicationAccessToken(options.token), null, 2));
    return;
  }
  if (command === 'verify') {
    if (!options.token) throw new Error('--token is required.');
    const scope = String(options.scope ?? '').trim().toLowerCase();
    if (scope && scope !== 'tenant' && scope !== 'organization') {
      throw new Error('--scope must be tenant or organization.');
    }
    const payload = assertApplicationAccessToken(options.token, {
      appId: options['app-id'],
      tenantId: options['tenant-id'],
      organizationId: options['organization-id'],
      environment: options.environment,
      deploymentProfile: options['deployment-profile'],
      runtimeTarget: options['runtime-target'],
      loginScope: scope === 'tenant' ? 'TENANT' : scope === 'organization' ? 'ORGANIZATION' : undefined,
      ownershipScope: options['ownership-scope'],
      ownerUserId: options['user-id'],
    });
    console.log(JSON.stringify({ valid: true, payload }, null, 2));
    return;
  }
  if (command !== 'generate') {
    throw new Error(`Unknown command: ${command}`);
  }
  const token = createApplicationAccessToken({
    appId: options['app-id'],
    tenantId: options['tenant-id'],
    organizationId: options['organization-id'],
    accessScope: options.scope,
    environment: options.environment,
    deploymentProfile: options['deployment-profile'],
    runtimeTarget: options['runtime-target'],
    ownershipScope: options['ownership-scope'],
    userId: options['user-id'],
    permissionScope: options['permission-scope']
      ? options['permission-scope'].split(',').map((entry) => entry.trim()).filter(Boolean)
      : undefined,
    sessionId: options['session-id'],
    issuedAt: options['issued-at'] ? Number(options['issued-at']) : undefined,
    expiresAt: options['expires-at'] ? Number(options['expires-at']) : undefined,
  });
  if (options.json) {
    console.log(JSON.stringify({ token, ...decodeApplicationAccessToken(token) }, null, 2));
  } else {
    console.log(token);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
