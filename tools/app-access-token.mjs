#!/usr/bin/env node

/**
 * Public application access token generator for SDKWork client env profiles.
 *
 * The token is SaaS-isolation material, not a secret. It is a three-part JWT
 * with `alg: none`, `kid: public-app-token`, and `token_class: application`.
 * Every manifest-bearing application root carries one token per profile in its
 * committed per-scope env file (`APP_ACCESS_TOKEN_SPEC.md`).
 */

export const PUBLIC_APP_ACCESS_TOKEN_KEY = 'SDKWORK_ACCESS_TOKEN';
export const PUBLIC_APP_ACCESS_TOKEN_KID = 'public-app-token';
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
    permission_scope: permissionScope,
    runtime_target: runtimeTarget,
    session_id: normalizeText(options.sessionId) || resolveSessionId(appId, deploymentProfile, environment),
    tenant_id: tenantId,
    token_class: PUBLIC_APP_ACCESS_TOKEN_CLASS,
    token_type: 'access',
    token_version: PUBLIC_APP_ACCESS_TOKEN_VERSION,
    user_id: '0',
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
  ];
  for (const [claim, value] of checks) {
    if (value !== undefined && String(payload[claim] ?? '') !== String(value)) {
      throw new Error(`Public application access token claim ${claim}=${payload[claim]} does not match ${value}.`);
    }
  }
  return payload;
}
