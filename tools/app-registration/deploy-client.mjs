#!/usr/bin/env node

/**
 * Deploy application API client used by the registrar.
 *
 * Route authority (`sdkwork-deployments`, read — not guessed):
 *
 * - `crates/sdkwork-routes-deploy-app-api/src/http_route_manifest.rs:289-300`
 *   declares `GET /app/v3/api/apps` (`apps.list`, `deploy.apps.read`),
 *   `POST /app/v3/api/apps` (`apps.create`, `deploy.apps.write`) and
 *   `GET /app/v3/api/apps/{appId}` (`apps.retrieve`, `deploy.apps.read`).
 * - `crates/sdkwork-routes-deploy-app-api/src/app_delivery_routes.rs:444-467`
 *   requires the `Idempotency-Key` header on `apps.create`.
 * - `crates/sdkwork-intelligence-deploy-repository-sqlx/src/apps.rs:507-528`
 *   resolves `{appId}` against `deploy_app.uuid`; `:370` turns a duplicate
 *   `(tenant_id, slug)` insert into a `409` conflict; `:286-332` replays the row
 *   recorded under the same `Idempotency-Key`.
 * - `apis/app-api/deploy/deploy-app-api.openapi.json` declares `apps.list`
 *   filters `page`, `page_size`, `keyword` (case-insensitive name/slug match) and
 *   `AppResponse.id` as the application uuid.
 * - `AppResponse.deployApplicationId` is the decimal `deploy_app.id` anchor
 *   (`API_SPEC.md` §13.6 int64-string wire shape), required on the list,
 *   retrieve, create, and update responses by `sdkwork-deployments` commit
 *   `7471031`. The uuid and the anchor are different facts and are always read
 *   from the same row: `assertDeployApplicationItem` refuses a response that
 *   omits the anchor, carries a non-decimal value, or carries no uuid.
 *
 * The client is deliberately small and dependency-free so the registrar can run
 * from CI or an operator shell without the generated SDK workspace.
 *
 * @module app-registration/deploy-client
 */

/** Deploy app-api path prefix. */
export const DEPLOY_APPS_PATH = '/app/v3/api/apps';

/** Typed refusal of one deploy API call. */
export class DeployApiError extends Error {
  /**
   * @param message - operator-facing message naming the route and the cause
   * @param details - call facts (kind, status, path, problem code, retryable)
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'DeployApiError';
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

function normalizeBaseUrl(baseUrl) {
  const trimmed = trim(baseUrl).replace(/\/+$/u, '');
  if (!/^https?:\/\//iu.test(trimmed)) {
    throw new DeployApiError(
      `deploy API base URL must be an absolute http(s) URL, got ${JSON.stringify(trim(baseUrl))}`,
      { kind: 'invalid-settings' },
    );
  }
  if (/\/app\/v3\/api$/u.test(trimmed)) {
    return trimmed.slice(0, -'/app/v3/api'.length);
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
 * Unwrap the SDKWork response envelope (`{code, data, traceId}`).
 * @param payload - parsed JSON body
 * @param path - request path (for the diagnostic)
 * @returns the `data` object
 * @throws {DeployApiError} when the envelope carries no data
 */
export function unwrapDeployEnvelope(payload, path) {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const data = payload.data;
    if (data && typeof data === 'object') {
      return data;
    }
    throw new DeployApiError(
      `deploy response ${path} carried an empty data envelope`,
      { kind: 'unreadable', path },
    );
  }
  throw new DeployApiError(
    `deploy response ${path} is not a {code,data,traceId} envelope`,
    { kind: 'unreadable', path },
  );
}

/**
 * Validate one `AppResponse` row and return it unchanged.
 *
 * `AppResponse.id` is the addressable uuid (`deploy_app.uuid`); the decimal
 * anchor is `AppResponse.deployApplicationId` (`deploy_app.id`). Both are read
 * from the same row and never from each other, so a response that omits the
 * anchor or carries a non-decimal one is refused instead of being promoted from
 * the uuid. This is the wire boundary of the registrar's fail-closed rule: a
 * deployment that cannot report the anchor cannot anchor an IAM installation.
 * @param item - one `data.item` / `data.items[]` of an app API response
 * @param path - request path (for the diagnostic)
 * @returns the validated item
 * @throws {DeployApiError} when the uuid or the decimal anchor is missing or invalid
 */
export function assertDeployApplicationItem(item, path) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new DeployApiError(
      `deploy response ${path} carried no application row to read the anchor from`,
      { kind: 'unreadable', path },
    );
  }
  const uuid = trim(item.id);
  if (!uuid) {
    throw new DeployApiError(
      `deploy application row from ${path} has no id (uuid), so it cannot be addressed or recorded`,
      { kind: 'unreadable', path },
    );
  }
  const anchor = trim(item.deployApplicationId);
  if (!anchor) {
    throw new DeployApiError(
      `deploy application ${uuid} from ${path} carried no deployApplicationId; the app API must `
      + 'return the decimal `deploy_app.id` anchor (int64 string) on every list/retrieve/create '
      + 'response, and IAM binds that value, not the uuid',
      { kind: 'unreadable', path, uuid },
    );
  }
  if (!/^[0-9]+$/u.test(anchor)) {
    throw new DeployApiError(
      `deploy application ${uuid} from ${path} carried deployApplicationId=${JSON.stringify(anchor)}, `
      + 'which is not the decimal `deploy_app.id` anchor IAM stores as `deploy_application_id` and '
      + 'every access token carries as `app_id`/`aud`',
      { kind: 'unreadable', path, uuid, deployApplicationId: anchor },
    );
  }
  return item;
}

/**
 * Create a deploy application API client.
 * @param options - base URL, dual-token credentials, timeout, fetch override
 * @returns the client
 */
export function createDeployApplicationClient(options) {
  const origin = normalizeBaseUrl(options.baseUrl);
  const accessToken = trim(options.accessToken);
  const authToken = trim(options.authToken);
  if (!accessToken || !authToken) {
    throw new DeployApiError(
      'deploy API client requires both an Access-Token and a Bearer auth token',
      { kind: 'invalid-settings' },
    );
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10_000;

  async function request(method, pathAndQuery, { body, idempotencyKey } = {}) {
    const headers = {
      accept: 'application/json',
      'access-token': accessToken,
      authorization: `Bearer ${authToken}`,
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (idempotencyKey) {
      headers['idempotency-key'] = idempotencyKey;
    }
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    let response;
    try {
      response = await fetchImpl(`${origin}${pathAndQuery}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      throw new DeployApiError(
        `deploy API ${method} ${pathAndQuery} is unreachable at ${origin} (${
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
        throw new DeployApiError(
          `deploy API ${method} ${pathAndQuery} answered HTTP ${response.status} with a `
          + 'non-JSON body',
          { kind: 'unreadable', path: pathAndQuery, status: response.status },
        );
      }
    }
    if (!response.ok) {
      throw new DeployApiError(
        `deploy API ${method} ${pathAndQuery} was rejected with HTTP ${response.status}${
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
    return { status: response.status, payload };
  }

  return {
    /**
     * List applications matching a keyword (case-insensitive name/slug match).
     * @param query - keyword, page, page size
     * @returns the page items, each carrying its uuid and decimal anchor
     */
    async listApps(query = {}) {
      const search = new URLSearchParams();
      search.set('page', String(query.page ?? 1));
      search.set('page_size', String(query.pageSize ?? 50));
      if (trim(query.keyword)) {
        search.set('keyword', trim(query.keyword));
      }
      const pathAndQuery = `${DEPLOY_APPS_PATH}?${search.toString()}`;
      const { payload } = await request('GET', pathAndQuery);
      const data = unwrapDeployEnvelope(payload, pathAndQuery);
      const items = (Array.isArray(data.items) ? data.items : [])
        .map((item) => assertDeployApplicationItem(item, pathAndQuery));
      return { items, path: pathAndQuery };
    },

    /**
     * Retrieve one application by uuid.
     * @param uuid - application uuid (the route's `{appId}`)
     * @returns the validated application item, or `null` when the API answered 404
     */
    async retrieveApp(uuid) {
      const value = trim(uuid);
      if (!value) {
        throw new DeployApiError('deploy application uuid is required to retrieve an app', {
          kind: 'invalid-settings',
        });
      }
      const pathAndQuery = `${DEPLOY_APPS_PATH}/${encodeURIComponent(value)}`;
      try {
        const { payload } = await request('GET', pathAndQuery);
        const item = unwrapDeployEnvelope(payload, pathAndQuery).item ?? null;
        return item === null ? null : assertDeployApplicationItem(item, pathAndQuery);
      } catch (error) {
        if (error instanceof DeployApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    /**
     * Create one application with a caller-supplied idempotency key.
     *
     * The returned row is validated here, so the caller can use
     * `deployApplicationId` directly as the anchor without a re-read.
     * @param body - `CreateAppRequest` body
     * @param headerOptions - deterministic `Idempotency-Key`
     * @returns the created application item with its decimal anchor
     */
    async createApp(body, { idempotencyKey } = {}) {
      if (!trim(idempotencyKey)) {
        throw new DeployApiError(
          'apps.create requires an Idempotency-Key so a retry replays instead of duplicating',
          { kind: 'invalid-settings' },
        );
      }
      const { payload } = await request('POST', DEPLOY_APPS_PATH, {
        body,
        idempotencyKey: trim(idempotencyKey),
      });
      const data = unwrapDeployEnvelope(payload, DEPLOY_APPS_PATH);
      return assertDeployApplicationItem(data.item ?? data, DEPLOY_APPS_PATH);
    },
  };
}

/**
 * Find one application by exact slug.
 *
 * `apps.list` matches the keyword against name *and* slug with `LIKE`, so a
 * keyword hit is a candidate, not a match: only an exact case-insensitive slug
 * comparison identifies the application whose `uk_deploy_app_tenant_slug` this
 * app owns.
 * @param client - deploy client
 * @param slug - deploy application slug
 * @returns the matching item, or `null`
 * @throws {DeployApiError} when several rows carry the same slug
 */
export async function findAppBySlug(client, slug) {
  const wanted = trim(slug).toLowerCase();
  if (!wanted) {
    throw new DeployApiError('deploy application slug is required to look up an app', {
      kind: 'invalid-settings',
    });
  }
  const { items } = await client.listApps({ keyword: wanted, pageSize: 50 });
  const matches = items.filter((item) => trim(item?.slug).toLowerCase() === wanted);
  if (matches.length > 1) {
    throw new DeployApiError(
      `deploy returned ${matches.length} applications with slug ${wanted}; the tenant's slug `
      + 'uniqueness was violated and the registrar refuses to guess which one owns this app',
      { kind: 'conflict', path: DEPLOY_APPS_PATH },
    );
  }
  return matches[0] ?? null;
}
