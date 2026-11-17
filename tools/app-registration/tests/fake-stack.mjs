#!/usr/bin/env node

/**
 * Loopback fake of the two HTTP surfaces the registrar drives.
 *
 * It implements the wire behaviour the registrar depends on, taken from the
 * real route owners rather than invented:
 *
 * - `POST /app/v3/api/apps` requires `Idempotency-Key`, replays the row recorded
 *   under a repeated key, and answers `409` when the tenant slug is taken
 *   (`http_route_manifest.rs`, `app_delivery_routes.rs`, `apps.rs`).
 * - `GET /app/v3/api/apps/{appId}` resolves the *uuid*; `GET /app/v3/api/apps`
 *   filters on `keyword` (name or slug, case-insensitive).
 * - `POST /backend/v3/api/iam/tenant_applications` reconciles the one
 *   installation bound to `deployApplicationId` and returns it; `.../enable`
 *   transitions it to `enabled`.
 *
 * The stack never shortcuts the registrar: it answers with the same envelopes
 * (`{code, data, traceId}` / `application/problem+json`), so a change in the
 * client's parsing shows up as a test failure.
 *
 * @module app-registration/tests/fake-stack
 */

import { createServer } from 'node:http';

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

/**
 * Start the fake Deploy + IAM stack.
 * @param options - seed rows and per-route hooks
 * @returns the stack handle
 */
export async function startFakeStack(options = {}) {
  const apps = new Map();
  const idempotency = new Map();
  const installations = new Map();
  const requests = [];
  let nextDecimal = Number(options.firstDecimal ?? 900100);
  let nextUuid = 1;
  let nextInstallation = 1;
  let failNext = options.failNext ?? [];

  for (const app of options.apps ?? []) {
    apps.set(app.slug, { ...app });
    if (Number.isFinite(Number(app.deployApplicationId))) {
      nextDecimal = Math.max(nextDecimal, Number(app.deployApplicationId) + 1);
    }
  }
  for (const installation of options.installations ?? []) {
    installations.set(installation.deployApplicationId, { ...installation });
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
        key: `${request.method} ${url.pathname}`,
      };
      requests.push(record);

      const injected = failNext.find(
        (entry) => entry.method === record.method && entry.path === record.path,
      );
      if (injected) {
        failNext = failNext.filter((entry) => entry !== injected);
        sendJson(response, injected.status ?? 500, injected.body ?? problem(500, 50001, 'injected failure'));
        return;
      }
      const hook = (options.hooks ?? []).find(
        (entry) => entry.method === record.method && entry.path === record.path,
      );
      if (hook) {
        const handled = hook.handle({ request: record, apps, installations });
        if (handled) {
          sendJson(response, handled.status, handled.body);
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
        if (idempotency.has(key)) {
          sendJson(response, 201, envelope({ item: appResponse(idempotency.get(key)) }));
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
        sendJson(response, 201, envelope({ item: appResponse(app) }));
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
        sendJson(response, 200, envelope({ item: appResponse(app) }));
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
        const existing = installations.get(anchor);
        if (existing) {
          sendJson(response, 200, envelope({ item: existing }));
          return;
        }
        const installation = {
          tenantApplicationId: `ta-${nextInstallation++}`,
          id: '',
          appId: `app-runtime-${anchor}`,
          deployApplicationId: anchor,
          instanceKey: String(payload.instanceKey ?? ''),
          applicationType: String(payload.applicationType ?? ''),
          status: 'draft',
          accessPermissions: payload.accessPermissions ?? [],
        };
        installation.id = installation.tenantApplicationId;
        installations.set(anchor, installation);
        sendJson(response, 201, envelope({ item: installation }));
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
        installation.status = options.enableResultStatus ?? 'enabled';
        sendJson(response, 200, envelope({ item: installation }));
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

function sendJson(response, status, body) {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(serialized),
    connection: 'close',
  });
  response.end(serialized);
}
