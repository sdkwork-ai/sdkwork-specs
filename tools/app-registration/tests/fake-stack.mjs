#!/usr/bin/env node

/**
 * Loopback fake of the HTTP surfaces the registrar drives.
 *
 * It implements the wire behaviour the registrar depends on, taken from the real
 * route owners rather than invented:
 *
 * - `POST /app/v3/api/apps` requires `Idempotency-Key`, replays the row recorded
 *   under a repeated key, answers `409` when the tenant slug is taken, and — like
 *   the framework idempotency middleware — rejects a body-carrying command that
 *   omits `X-Content-SHA256`, and rejects a digest that does not match the bytes
 *   (`sdkwork-web-framework` `crates/sdkwork-web-core/src/idempotency.rs`
 *   `resolve_idempotency_fingerprint`).
 * - `GET /app/v3/api/apps/{appId}` resolves the *uuid*; `GET /app/v3/api/apps`
 *   filters on `keyword` (name or slug, case-insensitive).
 * - `POST /backend/v3/api/iam/tenant_applications` reconciles the one
 *   installation bound to `deployApplicationId`, refuses a blank
 *   `primaryDomain` (IAM enable refuses a blank installation domain), and
 *   returns it; `.../enable` transitions it to `enabled` and reproduces the
 *   `409 primaryDomain must be configured` refusal when the stored installation
 *   has no domain.
 * - `PUT /backend/v3/api/iam/tenants/{tenantId}/applications/{installationId}/environments/{envKey}`
 *   upserts the environment row keyed by `(installation, env_key)`, requires the
 *   dual-token headers the real route declares, and rejects a domain already
 *   registered to another environment of the tenant.
 * - `POST /app/v3/api/auth/sessions` mints the dual-token operator session the
 *   management route needs.
 *
 * The stack never shortcuts the registrar: it answers with the same envelopes
 * (`{code, data, traceId}` / `application/problem+json`), so a change in the
 * client's parsing shows up as a test failure.
 *
 * @module app-registration/tests/fake-stack
 */

import { createServer } from 'node:http';

import { sha256Hex } from '../http-fingerprint.mjs';

function problem(status, code, detail) {
  return {
    type: 'about:blank',
    title: 'request failed',
    status,
    code,
    detail,
    traceId: 'trace-fake',
  };
}

function envelope(data) {
  return { code: 0, data, traceId: 'trace-fake' };
}

function resource(item) {
  return envelope({ item });
}

/**
 * Start the fake Deploy + IAM stack.
 * @param options - seed rows and per-route hooks
 * @returns the stack handle
 */
export async function startFakeStack(options = {}) {
  const apps = new Map();
  const idempotency = new Map();
  const installations = new Map();
  const environmentRows = new Map();
  const requests = [];
  let nextDecimal = Number(options.firstDecimal ?? 900100);
  let nextUuid = 1;
  let nextInstallation = 1;
  let nextEnvironment = 1;
  let failNext = options.failNext ?? [];
  let sessions = 0;

  for (const app of options.apps ?? []) {
    apps.set(app.slug, { ...app });
    if (Number.isFinite(Number(app.deployApplicationId))) {
      nextDecimal = Math.max(nextDecimal, Number(app.deployApplicationId) + 1);
    }
  }
  for (const installation of options.installations ?? []) {
    installations.set(installation.deployApplicationId, { ...installation });
  }
  for (const environment of options.environments ?? []) {
    environmentRows.set(`${environment.installationId}:${environment.environmentKey}`, {
      ...environment,
    });
  }

  function appResponse(app) {
    return {
      id: app.uuid,
      name: app.name,
      slug: app.slug,
      appKind: app.appKind ?? 'API_SERVICE',
      appStatus: app.appStatus ?? 'DRAFT',
      defaultEnvironment: app.defaultEnvironment ?? 'development',
      tenantId: app.tenantId ?? '100001',
      nginxConfigOverridden: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      version: '1',
      ...(app.exposeDecimalId === false || app.deployApplicationId === undefined
        ? {}
        : { deployApplicationId: String(app.deployApplicationId) }),
    };
  }

  function environmentResponse(row) {
    return {
      environmentId: row.environmentId,
      environmentKey: row.environmentKey,
      installationId: row.installationId,
      tenantId: row.tenantId,
      organizationId: row.organizationId ?? '0',
      primaryDomain: row.primaryDomain,
      domainConfig: {},
      status: row.status,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
  }

  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const payload = rawBody ? safeJson(rawBody) : {};
      const url = new URL(request.url, 'http://127.0.0.1');
      const record = {
        method: request.method,
        path: url.pathname,
        search: url.search,
        headers: request.headers,
        body: payload,
        rawBody,
        key: `${request.method} ${url.pathname}`,
      };
      requests.push(record);

      const injected = failNext.find(
        (entry) => entry.method === record.method && entry.path === record.path,
      );
      if (injected) {
        failNext = failNext.filter((entry) => entry !== injected);
        sendJson(
          response,
          injected.status ?? 500,
          injected.body ?? problem(500, 50001, 'injected failure'),
          injected.headers ?? {},
        );
        return;
      }
      const hook = (options.hooks ?? []).find(
        (entry) => entry.method === record.method && entry.path === record.path,
      );
      if (hook) {
        const handled = hook.handle({ request: record, apps, installations, environmentRows });
        if (handled) {
          sendJson(response, handled.status, handled.body, handled.headers ?? {});
          return;
        }
      }

      if (record.method === 'GET' && record.path === '/app/v3/api/apps') {
        const keyword = url.searchParams.get('keyword')?.toLowerCase() ?? '';
        const items = [...apps.values()]
          .filter(
            (app) => !keyword
              || app.name.toLowerCase().includes(keyword)
              || app.slug.toLowerCase().includes(keyword),
          )
          .map(appResponse);
        sendJson(response, 200, envelope({ items, total: items.length, page: 1, pageSize: 50 }));
        return;
      }
      if (record.method === 'POST' && record.path === '/app/v3/api/apps') {
        const key = String(request.headers['idempotency-key'] ?? '').trim();
        if (!key) {
          sendJson(response, 400, problem(400, 40001, 'Idempotency-Key header is required'));
          return;
        }
        // The framework idempotency middleware refuses a body-carrying command
        // that does not name the payload digest.
        const declaredHash = String(request.headers['x-content-sha256'] ?? '').trim();
        if (rawBody.length > 0 && !declaredHash) {
          sendJson(response, 400, problem(
            400,
            40002,
            'requests with a body must include X-Content-SHA256 or X-Idempotency-Fingerprint '
            + 'for idempotent commands',
          ));
          return;
        }
        if (declaredHash && declaredHash !== sha256Hex(rawBody)) {
          sendJson(response, 400, problem(
            400,
            40003,
            `X-Content-SHA256 ${declaredHash} does not match the request body`,
          ));
          return;
        }
        if (idempotency.has(key)) {
          sendJson(response, 201, resource(appResponse(idempotency.get(key))));
          return;
        }
        const slug = String(payload.slug ?? '').trim();
        if (!slug || !String(payload.name ?? '').trim()) {
          sendJson(response, 422, problem(422, 42201, 'name is required'));
          return;
        }
        if (apps.has(slug)) {
          sendJson(response, 409, problem(409, 40901, `app slug ${slug} already exists`));
          return;
        }
        const app = {
          uuid: `uuid-${nextUuid++}`,
          deployApplicationId: String(nextDecimal++),
          name: String(payload.name),
          slug,
          appKind: payload.appKind,
          defaultEnvironment: payload.defaultEnvironment,
          appStatus: 'DRAFT',
          exposeDecimalId: options.exposeDecimalId !== false,
        };
        apps.set(slug, app);
        idempotency.set(key, app);
        sendJson(response, 201, resource(appResponse(app)));
        return;
      }
      const appMatch = /^\/app\/v3\/api\/apps\/([^/]+)$/u.exec(record.path);
      if (record.method === 'GET' && appMatch) {
        const uuid = decodeURIComponent(appMatch[1]);
        const app = [...apps.values()].find((candidate) => candidate.uuid === uuid);
        if (!app) {
          sendJson(response, 404, problem(404, 40401, 'app not found'));
          return;
        }
        sendJson(response, 200, resource(appResponse(app)));
        return;
      }
      if (record.method === 'POST' && record.path === '/app/v3/api/auth/sessions') {
        sessions += 1;
        sendJson(response, 201, envelope({
          accessToken: `access-session-${sessions}`,
          authToken: `auth-session-${sessions}`,
          sessionId: `session-${sessions}`,
        }));
        return;
      }
      if (record.method === 'POST' && record.path === '/backend/v3/api/iam/tenant_applications') {
        const anchor = String(payload.deployApplicationId ?? '').trim();
        if (!anchor) {
          sendJson(response, 400, problem(400, 40002, 'deployApplicationId is required'));
          return;
        }
        if (!payload.provisioningIdempotencyKey) {
          sendJson(response, 400, problem(400, 40003, 'provisioningIdempotencyKey is required'));
          return;
        }
        if (!payload.authToken && !(payload.username && payload.password)) {
          sendJson(response, 401, problem(401, 40101, 'bootstrap operator credentials are required'));
          return;
        }
        if (!String(payload.primaryDomain ?? '').trim()) {
          // `resolve_tenant_application_primary_domain` refuses a blank domain.
          sendJson(response, 400, problem(
            400,
            40004,
            'primaryDomain is required for tenant application bootstrap',
          ));
          return;
        }
        const existing = installations.get(anchor);
        if (existing) {
          existing.primaryDomain = String(payload.primaryDomain);
          existing.environment = String(payload.environment ?? existing.environment ?? '');
          sendJson(response, 200, resource(existing));
          return;
        }
        const installation = {
          tenantApplicationId: `ta-${nextInstallation++}`,
          id: '',
          appId: `app-runtime-${anchor}`,
          deployApplicationId: anchor,
          instanceKey: String(payload.instanceKey ?? ''),
          applicationType: String(payload.applicationType ?? ''),
          primaryDomain: String(payload.primaryDomain),
          environment: String(payload.environment ?? ''),
          status: 'draft',
          accessPermissions: payload.accessPermissions ?? [],
        };
        installation.id = installation.tenantApplicationId;
        installations.set(anchor, installation);
        sendJson(response, 201, resource(installation));
        return;
      }
      const enableMatch = /^\/backend\/v3\/api\/iam\/tenant_applications\/([^/]+)\/enable$/u.exec(
        record.path,
      );
      if (record.method === 'POST' && enableMatch) {
        const id = decodeURIComponent(enableMatch[1]);
        const installation = [...installations.values()].find(
          (candidate) => candidate.tenantApplicationId === id || candidate.id === id,
        );
        if (!installation) {
          sendJson(response, 404, problem(404, 40402, 'installation not found'));
          return;
        }
        if (!String(installation.primaryDomain ?? '').trim()) {
          sendJson(response, 409, problem(
            409,
            40904,
            'primaryDomain must be configured before enabling tenant application',
          ));
          return;
        }
        installation.status = options.enableResultStatus ?? 'enabled';
        sendJson(response, 200, resource(installation));
        return;
      }
      const environmentMatch = /^\/backend\/v3\/api\/iam\/tenants\/([^/]+)\/applications\/([^/]+)\/environments\/([^/]+)$/u.exec(
        record.path,
      );
      if (record.method === 'PUT' && environmentMatch) {
        const tenantId = decodeURIComponent(environmentMatch[1]);
        const installationId = decodeURIComponent(environmentMatch[2]);
        const envKey = decodeURIComponent(environmentMatch[3]);
        const authorization = String(request.headers.authorization ?? '');
        const accessToken = String(request.headers['access-token'] ?? '').trim();
        if (!/^Bearer \S+$/u.test(authorization) || !accessToken) {
          sendJson(response, 401, problem(
            401,
            40102,
            'this route requires a dual-token session (Authorization: Bearer + Access-Token)',
          ));
          return;
        }
        const installation = [...installations.values()].find(
          (candidate) => candidate.tenantApplicationId === installationId
            || candidate.id === installationId,
        );
        if (!installation) {
          sendJson(response, 404, problem(404, 40403, 'installation was not found'));
          return;
        }
        const domain = String(payload.primaryDomain ?? '').trim();
        if (!domain) {
          sendJson(response, 400, problem(
            400,
            40005,
            'primaryDomain is required for an installation environment',
          ));
          return;
        }
        const status = String(payload.envStatus ?? payload.status ?? 'pending').toLowerCase();
        if (!['pending', 'active', 'disabled'].includes(status)) {
          sendJson(response, 400, problem(400, 40006, 'status must be one of pending, active, or disabled'));
          return;
        }
        const conflicting = [...environmentRows.values()].find(
          (row) => row.tenantId === tenantId
            && row.primaryDomain.toLowerCase() === domain.toLowerCase()
            && !(row.installationId === installationId
              && row.environmentKey.toLowerCase() === envKey.toLowerCase()),
        );
        if (conflicting) {
          sendJson(response, 409, problem(
            409,
            40905,
            `primaryDomain '${domain}' is already registered to environment `
            + `'${conflicting.environmentKey}' of this tenant`,
          ));
          return;
        }
        const rowKey = `${installationId}:${envKey}`;
        const existingRow = environmentRows.get(rowKey);
        const row = existingRow ?? {
          environmentId: `iaenv-${nextEnvironment++}`,
          tenantId,
          installationId,
          environmentKey: envKey,
        };
        row.primaryDomain = domain;
        row.status = status;
        environmentRows.set(rowKey, row);
        sendJson(response, 200, resource(environmentResponse(row)));
        return;
      }
      sendJson(response, 404, problem(404, 40400, `no fake route for ${record.key}`));
    });
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    apps,
    installations,
    environmentRows,
    requests,
    /** Queue one injected failure for the next request to `method path`. */
    failNextOnce(entry) {
      failNext.push(entry);
    },
    /** Replace the queued failures. */
    setFailNext(entries) {
      failNext = [...entries];
    },
    requestsFor(method, requestPath) {
      return requests.filter((entry) => entry.method === method && entry.path === requestPath);
    },
    /** Every environment request, in arrival order. */
    environmentRequests() {
      return requests.filter(
        (entry) => entry.method === 'PUT' && entry.path.includes('/environments/'),
      );
    },
    async close() {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    },
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function sendJson(response, status, body, extraHeaders = {}) {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(serialized),
    connection: 'close',
    ...extraHeaders,
  });
  response.end(serialized);
}
