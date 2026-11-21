#!/usr/bin/env node

/**
 * IAM client used by the registrar: tenant-application bootstrap (body
 * credentials) plus installation-environment management (dual-token session).
 *
 * # Route authority (read from `sdkwork-iam`, not guessed)
 *
 * - `crates/sdkwork-routes-iam-backend-api/src/manifest.rs:643` declares
 *   `POST /backend/v3/api/iam/installations`
 *   (`installations.create`, auth mode `bootstrap-body`), and `:661`
 *   declares `POST /backend/v3/api/iam/installations/{installationId}/enable`
 *   (also `bootstrap-body`). The bootstrap operator credentials travel in the
 *   body through `authToken` or `username` + `password`
 *   (`sdkwork-iam-web-adapter/src/super_admin_auth.rs` `resolve_bootstrap_actor`).
 * - `crates/sdkwork-routes-iam-backend-api/src/manifest.rs:105` declares
 *   `PUT /backend/v3/api/iam/tenants/{tenantId}/installations/{installationId}/environments/{environmentKey}`
 *   (`installations.environments.update`, auth mode `dual-token`), handled by
 *   `crates/sdkwork-routes-iam-backend-api/src/installation_lifecycle.rs`.
 *   `upsert_installation_environment` reconciles the row keyed by
 *   `(installation_id, env_key)`, stores `primary_domain` and `env_status`
 *   (`pending` | `active` | `disabled`), and returns `409` when the domain is
 *   already registered to another environment of the tenant.
 * - The enable step (`crates/sdkwork-iam-web-adapter/src/application_registry.rs:1199`)
 *   refuses an installation whose `primary_domain` is blank
 *   (`primaryDomain must be configured before enabling tenant application`).
 *   That is the second gap the rehearsal exposed: the domain is a required
 *   provisioning input, not an optional decoration.
 * - Runtime token issuance opens with
 *   `decide_installation_environment_access`
 *   (`crates/sdkwork-iam-web-adapter/src/installation_lifecycle.rs:129`): once an
 *   installation has any environment row, a token request for an unregistered
 *   environment fails closed, and a row that is not `active` blocks issuance.
 *   One installation serves every lifecycle, and each lifecycle is a row.
 *
 * # Credentials
 *
 * The environment route is dual-token: `Authorization: Bearer <auth token>` plus
 * `Access-Token: <access token>`. That pair is a *session*, so it is resolved in
 * this order:
 *
 * 1. explicit management tokens (`SDKWORK_IAM_MANAGEMENT_ACCESS_TOKEN` +
 *    `SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN`, or their `SDKWORK_IAM_BACKEND_*` aliases);
 * 2. a session minted from the bootstrap operator `username` + `password` through
 *    `POST /app/v3/api/auth/sessions` (`sessions.create`, credential-entry
 *    bootstrap, `sdkwork-routes-iam-app-api/src/manifest.rs:6`), cached for the run;
 * 3. otherwise the call fails closed naming the variables to set — the registrar
 *    never enables an installation whose environment row it could not write.
 *
 * @module app-registration/iam-client
 */

import {
  bodyFingerprintHeaders,
  parseRetryAfterMs,
  serializeRequestBody,
} from './http-fingerprint.mjs';

/** Backend API prefix for the IAM bootstrap operations. */
export const IAM_BACKEND_API_PREFIX = '/backend/v3/api';

/** Provision/reconcile path. */
export const IAM_TENANT_APPLICATIONS_PATH = '/iam/installations';

/** Tenant-scoped installation management path prefix (dual-token surface). */
export const IAM_TENANT_APPLICATIONS_MANAGEMENT_PREFIX = '/iam/tenants';

/** App-api login path used to mint a dual-token session for the operator. */
export const IAM_APP_SESSION_LOGIN_PATH = '/app/v3/api/auth/sessions';

/** Typed refusal of one IAM call. */
export class IamApiError extends Error {
  /**
   * @param message - operator-facing message naming the route and the cause
   * @param details - call facts (kind, status, path, problem code, retryable)
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'IamApiError';
    this.kind = details.kind ?? 'rejected';
    this.path = details.path ?? '';
    this.status = details.status ?? 0;
    this.code = details.code ?? '';
    this.retryable = Boolean(details.retryable);
    /** `Retry-After` delay announced by the server, in milliseconds (0 when absent). */
    this.retryAfterMs = Number(details.retryAfterMs) > 0 ? Number(details.retryAfterMs) : 0;
    this.details = details;
  }
}

function trim(value) {
  return String(value ?? '').trim();
}

/**
 * Strip a trailing `/backend/v3/api` so the path constants are joined once.
 * @param baseUrl - configured backend base URL (origin or origin plus prefix)
 * @returns the origin
 */
export function resolveIamOrigin(baseUrl) {
  const trimmed = trim(baseUrl).replace(/\/+$/u, '');
  if (!/^https?:\/\//iu.test(trimmed)) {
    throw new IamApiError(
      `IAM API base URL must be an absolute http(s) URL, got ${JSON.stringify(trim(baseUrl))}`,
      { kind: 'invalid-settings' },
    );
  }
  if (trimmed.endsWith(IAM_BACKEND_API_PREFIX)) {
    return trimmed.slice(0, -IAM_BACKEND_API_PREFIX.length);
  }
  return trimmed;
}

function problemCode(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const code = payload.code ?? payload.errorCode;
  return code === undefined || code === null ? '' : String(code);
}

function problemMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  for (const key of ['detail', 'title', 'message', 'msg']) {
    const value = trim(payload[key]);
    if (value) {
      return value.slice(0, 300);
    }
  }
  return '';
}

/**
 * Unwrap the bootstrap response: `data.item` when present, else `data`.
 * @param payload - parsed JSON body
 * @param path - request path (for the diagnostic)
 * @returns the installation item
 */
export function unwrapIamItem(payload, path) {
  const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
  if (!data || typeof data !== 'object') {
    throw new IamApiError(`IAM response ${path} carried no installation item`, {
      kind: 'unreadable',
      path,
    });
  }
  const item = data.item ?? data;
  if (!item || typeof item !== 'object') {
    throw new IamApiError(`IAM response ${path} carried no installation item`, {
      kind: 'unreadable',
      path,
    });
  }
  return item;
}

/**
 * Create an IAM bootstrap-body + installation-management client.
 * @param options - backend base URL, bootstrap operator auth, management session, timeout
 * @returns the client
 */
export function createIamApplicationClient(options) {
  const origin = resolveIamOrigin(options.baseUrl);
  const auth = options.auth ?? {};
  const hasAuthToken = trim(auth.authToken).length > 0;
  const hasPasswordAuth = trim(auth.username).length > 0 && trim(auth.password).length > 0;
  if (!hasAuthToken && !hasPasswordAuth) {
    throw new IamApiError(
      'IAM bootstrap client requires SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN or the operator '
      + 'username + password (the bootstrap-body auth mode)',
      { kind: 'invalid-settings' },
    );
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10_000;
  const authFields = hasAuthToken
    ? { authToken: trim(auth.authToken) }
    : { username: trim(auth.username), password: trim(auth.password) };

  const management = options.management ?? {};
  const explicitAccessToken = trim(management.accessToken);
  const explicitAuthToken = trim(management.authToken);
  const mintUsername = trim(management.username || auth.username);
  const mintPassword = trim(management.password || auth.password);
  const canMintSession = mintUsername.length > 0 && mintPassword.length > 0;
  /** @type {{accessToken: string, authToken: string} | null} */
  let mintedSession = null;

  function signalFor() {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  }

  async function send(method, url, { headers, body, pathLabel }) {
    const signal = signalFor();
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      throw new IamApiError(
        `IAM API ${method} ${pathLabel} is unreachable at ${origin} (${
          error instanceof Error ? error.message : String(error)
        })`,
        { kind: 'unreachable', path: pathLabel, retryable: true },
      );
    }
    const text = await response.text().catch(() => '');
    let payload = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new IamApiError(
          `IAM API ${method} ${pathLabel} answered HTTP ${response.status} with a non-JSON body`,
          { kind: 'unreadable', path: pathLabel, status: response.status },
        );
      }
    }
    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new IamApiError(
        `IAM API ${method} ${pathLabel} was rejected with HTTP ${response.status}${
          problemCode(payload) ? ` (problem code ${problemCode(payload)})` : ''
        }${problemMessage(payload) ? `: ${problemMessage(payload)}` : ''}`,
        {
          kind: 'rejected',
          path: pathLabel,
          status: response.status,
          code: problemCode(payload),
          retryable,
          retryAfterMs: parseRetryAfterMs(response.headers?.get?.('retry-after')),
        },
      );
    }
    return payload;
  }

  async function request(pathAndQuery, body) {
    const serializedBody = serializeRequestBody(body ?? {});
    const payload = await send(
      'POST',
      `${origin}${IAM_BACKEND_API_PREFIX}${pathAndQuery}`,
      {
        headers: {
          accept: 'application/json',
          ...bodyFingerprintHeaders(serializedBody),
        },
        body: serializedBody,
        pathLabel: pathAndQuery,
      },
    );
    return unwrapIamItem(payload, pathAndQuery);
  }

  /**
   * Mint (once per run) the dual-token operator session the management routes need.
   * @returns the session tokens
   */
  async function resolveManagementSession() {
    if (explicitAccessToken && explicitAuthToken) {
      return { accessToken: explicitAccessToken, authToken: explicitAuthToken };
    }
    if (mintedSession) {
      return mintedSession;
    }
    if (!canMintSession) {
      throw new IamApiError(
        'IAM installation-environment registration needs a dual-token operator session: set '
        + 'SDKWORK_IAM_MANAGEMENT_ACCESS_TOKEN + SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN (aliases '
        + 'SDKWORK_IAM_BACKEND_ACCESS_TOKEN / SDKWORK_IAM_BACKEND_AUTH_TOKEN), or set '
        + 'SDKWORK_IAM_BOOTSTRAP_OPERATOR_USERNAME + SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD so '
        + 'the registrar can mint the session through POST /app/v3/api/auth/sessions. The '
        + 'environment route is dual-token only, and the registrar will not enable an '
        + 'installation whose environment row it cannot write.',
        { kind: 'invalid-settings', path: IAM_APP_SESSION_LOGIN_PATH },
      );
    }
    const serializedBody = serializeRequestBody({
      grantType: 'password',
      username: mintUsername,
      password: mintPassword,
    });
    const payload = await send(
      'POST',
      `${origin}${IAM_APP_SESSION_LOGIN_PATH}`,
      {
        headers: {
          accept: 'application/json',
          ...bodyFingerprintHeaders(serializedBody),
        },
        body: serializedBody,
        pathLabel: IAM_APP_SESSION_LOGIN_PATH,
      },
    );
    const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
    const item = (data && typeof data === 'object' && (data.item ?? data)) || {};
    const accessToken = trim(item.accessToken ?? item.access_token);
    const authToken = trim(item.authToken ?? item.auth_token);
    if (!accessToken || !authToken) {
      throw new IamApiError(
        `IAM login ${IAM_APP_SESSION_LOGIN_PATH} returned no accessToken/authToken pair, so the `
        + 'installation-environment route cannot be authenticated',
        { kind: 'unreadable', path: IAM_APP_SESSION_LOGIN_PATH },
      );
    }
    mintedSession = { accessToken, authToken };
    return mintedSession;
  }

  return {
    /**
     * Provision or reconcile the installation bound to a deploy application.
     * @param body - provisioning command plus bootstrap operator auth
     * @returns the installation item
     */
    provisionInstallation(body) {
      return request(IAM_TENANT_APPLICATIONS_PATH, { ...authFields, ...body });
    },

    /**
     * Enable one installation.
     * @param installationId - installation id
     * @param body - extra fields (tenant scope)
     * @returns the installation item
     */
    enableInstallation(installationId, body = {}) {
      const id = trim(installationId);
      if (!id) {
        throw new IamApiError('tenant application id is required to enable an installation', {
          kind: 'invalid-settings',
        });
      }
      return request(
        `${IAM_TENANT_APPLICATIONS_PATH}/${encodeURIComponent(id)}/enable`,
        { ...authFields, ...body },
      );
    },

    /**
     * Whether this client can authenticate the dual-token management surface.
     * @returns true when explicit tokens are configured or a session can be minted
     */
    hasManagementCredentials() {
      return (explicitAccessToken.length > 0 && explicitAuthToken.length > 0) || canMintSession;
    },

    /**
     * Creates or reconciles one environment row of an installation.
     *
     * `PUT` is the idempotent upsert the IAM lifecycle exposes: the row is keyed by
     * `(installation_id, env_key)`, so a repeated run rewrites the same row instead
     * of adding a second one. The request carries a deterministic
     * `Idempotency-Key` so a retry after a timeout replays it.
     * @param command - tenant, installation id, environment key, domain, status
     * @returns the environment item (`environmentId`, `environmentKey`, `status`, ...)
     */
    async upsertInstallationEnvironment(command = {}) {
      const tenantId = trim(command.tenantId);
      const installationId = trim(command.installationId);
      const envKey = trim(command.envKey);
      const primaryDomain = trim(command.primaryDomain);
      if (!tenantId || !installationId || !envKey) {
        throw new IamApiError(
          'environment registration requires tenantId, installationId, and envKey',
          { kind: 'invalid-settings' },
        );
      }
      if (!primaryDomain) {
        throw new IamApiError(
          `environment ${envKey} of installation ${installationId} has no primaryDomain; IAM `
          + 'enable refuses an installation without one',
          { kind: 'invalid-settings' },
        );
      }
      const session = await resolveManagementSession();
      const pathLabel = `${IAM_TENANT_APPLICATIONS_MANAGEMENT_PREFIX}/${encodeURIComponent(tenantId)}`
        + `/applications/${encodeURIComponent(installationId)}`
        + `/environments/${encodeURIComponent(envKey)}`;
      const serializedBody = serializeRequestBody({
        primaryDomain,
        envStatus: trim(command.envStatus) || 'active',
      });
      const headers = {
        accept: 'application/json',
        authorization: `Bearer ${session.authToken}`,
        'access-token': session.accessToken,
        ...bodyFingerprintHeaders(serializedBody),
      };
      if (trim(command.idempotencyKey)) {
        headers['idempotency-key'] = trim(command.idempotencyKey);
      }
      const payload = await send('PUT', `${origin}${IAM_BACKEND_API_PREFIX}${pathLabel}`, {
        headers,
        body: serializedBody,
        pathLabel,
      });
      return unwrapIamItem(payload, pathLabel);
    },
  };
}
