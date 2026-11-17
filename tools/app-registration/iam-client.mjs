#!/usr/bin/env node

/**
 * IAM tenant-application bootstrap client used by the registrar.
 *
 * Route authority (`IAM_APPLICATION_BOOTSTRAP_SPEC` §2, mirrored by
 * `@sdkwork/iam-application-bootstrap` `src/fetch-client.ts`):
 *
 * - `POST /backend/v3/api/iam/tenant_applications` (`tenantApplications.create`,
 *   auth mode `bootstrap-body`) — provision or reconcile the one installation
 *   bound to a deploy application. The bootstrap operator credentials travel in
 *   the body through `authToken` or `username` + `password`.
 * - `POST /backend/v3/api/iam/tenant_applications/{tenantApplicationId}/enable`
 *   (`tenantApplications.enable`, auth mode `bootstrap-body`).
 *
 * `GET /backend/v3/api/iam/tenant_applications/{id}` is a dual-token admin read
 * and is deliberately not used: the registrar holds bootstrap-body credentials
 * only, so the binding is verified from the reconciliation response (the durable
 * record of the write), and a response that does not echo the anchor is refused
 * rather than assumed.
 *
 * @module app-registration/iam-client
 */

/** Backend API prefix for the IAM bootstrap operations. */
export const IAM_BACKEND_API_PREFIX = '/backend/v3/api';

/** Provision/reconcile path. */
export const IAM_TENANT_APPLICATIONS_PATH = '/iam/tenant_applications';

/** Typed refusal of one IAM bootstrap call. */
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
 * Create an IAM bootstrap-body client.
 * @param options - backend base URL, bootstrap operator auth, timeout, fetch override
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

  async function request(pathAndQuery, body) {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    let response;
    try {
      response = await fetchImpl(`${origin}${IAM_BACKEND_API_PREFIX}${pathAndQuery}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body ?? {}),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      throw new IamApiError(
        `IAM API POST ${pathAndQuery} is unreachable at ${origin} (${
          error instanceof Error ? error.message : String(error)
        })`,
        { kind: 'unreachable', path: pathAndQuery, retryable: true },
      );
    }
    const text = await response.text().catch(() => '');
    let payload = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new IamApiError(
          `IAM API POST ${pathAndQuery} answered HTTP ${response.status} with a non-JSON body`,
          { kind: 'unreadable', path: pathAndQuery, status: response.status },
        );
      }
    }
    if (!response.ok) {
      throw new IamApiError(
        `IAM API POST ${pathAndQuery} was rejected with HTTP ${response.status}${
          problemCode(payload) ? ` (problem code ${problemCode(payload)})` : ''
        }${problemMessage(payload) ? `: ${problemMessage(payload)}` : ''}`,
        {
          kind: 'rejected',
          path: pathAndQuery,
          status: response.status,
          code: problemCode(payload),
          retryable: response.status >= 500 || response.status === 429,
        },
      );
    }
    return unwrapIamItem(payload, pathAndQuery);
  }

  return {
    /**
     * Provision or reconcile the installation bound to a deploy application.
     * @param body - provisioning command plus bootstrap operator auth
     * @returns the installation item
     */
    provisionTenantApplication(body) {
      return request(IAM_TENANT_APPLICATIONS_PATH, { ...authFields, ...body });
    },

    /**
     * Enable one installation.
     * @param tenantApplicationId - installation id
     * @param body - extra fields (tenant scope)
     * @returns the installation item
     */
    enableTenantApplication(tenantApplicationId, body = {}) {
      const id = trim(tenantApplicationId);
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
  };
}
