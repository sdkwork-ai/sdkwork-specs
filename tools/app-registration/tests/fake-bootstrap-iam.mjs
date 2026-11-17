#!/usr/bin/env node

/**
 * Loopback fake of the two IAM routes the credential bootstrap uses.
 *
 * It reproduces the behaviour the real gateway enforces, because the tool's
 * correctness depends on those details rather than on the happy-path shape:
 *
 * - `POST /backend/v3/api/iam/access_credentials` is bootstrap-body
 *   (`username` + `password`, or `authToken`) and resolves `appId` against the
 *   installation's deploy-application anchor;
 * - `POST /app/v3/api/auth/sessions` is credential-entry-bootstrap: it demands an
 *   `Access-Token` header holding a live credential access token;
 * - a login revokes every live session of the same `(appId, deviceId)` before
 *   issuing the new pair — a null device therefore kills the credential session.
 *
 * @module app-registration/tests/fake-bootstrap-iam
 */

import { createHash } from 'node:crypto';
import http from 'node:http';

const APP_ID = 'sdkwork-iam';
const USER = 'operator';
const PASSWORD = 'Operator_Test_2026!';
const TENANT = '100001';
const ORGANIZATION = '0';

function base64url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

function makeToken(kind, session) {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({
    app_id: session.appId,
    aud: session.appId,
    auth_level: session.authLevel,
    deployment_mode: 'saas',
    environment: 'dev',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    iss: 'sdkwork-iam-local',
    login_scope: 'TENANT',
    organization_id: ORGANIZATION,
    session_id: session.id,
    tenant_id: TENANT,
    token_type: kind,
    token_version: 1,
    user_id: '3',
  });
  const signature = createHash('sha256').update(`${header}.${payload}`).digest('hex');
  return `${header}.${payload}.${signature}`;
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/**
 * Start the fake IAM.
 * @param options - overrides: `failCredential`, `omitAuthToken`, `appId`, `password`
 * @returns the running fake with its base URL, session store, and request log
 */
export async function startFakeBootstrapIam(options = {}) {
  const appId = options.appId ?? APP_ID;
  const password = options.password ?? PASSWORD;
  const sessions = [];
  const requests = [];
  let sequence = 0;

  function liveSessionByAccessToken(rawToken) {
    return sessions.find(
      (session) => session.revokedAt === null
        && session.accessToken === rawToken
        && session.expiresAt > Date.now(),
    );
  }

  function createSession({ deviceId, authLevel }) {
    sequence += 1;
    const session = {
      id: `fake-session-${sequence}`,
      appId,
      deviceId,
      authLevel,
      revokedAt: null,
      expiresAt: Date.now() + 3_600_000,
    };
    session.accessToken = makeToken('access', session);
    session.authToken = makeToken('auth', session);
    sessions.push(session);
    return session;
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const body = await readBody(request);
    requests.push({ method: request.method, path: url.pathname, headers: request.headers, body });

    if (request.method === 'POST' && url.pathname === '/backend/v3/api/iam/access_credentials') {
      if (options.failCredential) {
        send(response, 401, { code: 40101, detail: 'invalid bootstrap operator credentials' });
        return;
      }
      if (!body || typeof body !== 'object') {
        send(response, 400, { code: 40001, detail: 'request body must be JSON' });
        return;
      }
      const hasAuthToken = String(body.authToken ?? '').trim().length > 0;
      const credentialsMatch = body.username === USER && body.password === password;
      if (!hasAuthToken && !credentialsMatch) {
        send(response, 401, { code: 40101, detail: 'invalid bootstrap operator credentials' });
        return;
      }
      if (body.appId !== appId) {
        send(response, 404, {
          code: 40401,
          detail: 'tenant application was not found; register application and provision tenant',
        });
        return;
      }
      if (body.tenantId !== TENANT || body.organizationId !== ORGANIZATION) {
        send(response, 400, { code: 40001, detail: 'tenantId/organizationId do not match' });
        return;
      }
      const session = createSession({ deviceId: null, authLevel: 'system' });
      send(response, 200, {
        code: 0,
        data: {
          accessToken: session.accessToken,
          ...(options.omitAuthToken ? {} : { authToken: session.authToken }),
          accessCredential: session.accessToken,
          sessionId: session.id,
          tenantId: TENANT,
          organizationId: ORGANIZATION,
          appId,
          tenantApplicationId: 'fake-installation',
          expiresAt: new Date(session.expiresAt).toISOString(),
        },
        traceId: 'fake-trace-credential',
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/app/v3/api/auth/sessions') {
      const accessToken = String(request.headers['access-token'] ?? '').trim();
      const credentialSession = accessToken ? liveSessionByAccessToken(accessToken) : null;
      if (!credentialSession) {
        send(response, 401, {
          code: 40101,
          detail: 'credential-entry-bootstrap requests require bootstrap Access-Token JWT',
        });
        return;
      }
      if (!body || body.username !== USER || body.password !== password) {
        send(response, 401, { code: 40101, detail: 'invalid credentials' });
        return;
      }
      const deviceId = String(body.deviceId ?? '').trim() || null;
      // The real rule: same application + same device id is replaced on login.
      // A login without a device id therefore replaces the credential session,
      // which is exactly what the tool's device id avoids.
      const revokedAt = new Date().toISOString();
      for (const session of sessions) {
        if (
          session.appId === appId
          && session.deviceId === deviceId
          && session.revokedAt === null
        ) {
          session.revokedAt = revokedAt;
        }
      }
      const session = createSession({ deviceId, authLevel: 'password' });
      send(response, 200, {
        code: 0,
        data: {
          accessToken: session.accessToken,
          authToken: session.authToken,
          sessionId: session.id,
          expiresAt: new Date(session.expiresAt).toISOString(),
        },
        traceId: 'fake-trace-session',
      });
      return;
    }

    send(response, 404, { code: 40401, detail: `no route for ${request.method} ${url.pathname}` });
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    sessions,
    /** Sessions that a request could still authenticate with. */
    liveSessions() {
      return sessions.filter((session) => session.revokedAt === null);
    },
    /** Credential sessions minted by the access_credentials route. */
    credentialSessions() {
      return sessions.filter((session) => session.authLevel === 'system');
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export const FAKE_IAM_FIXTURE = Object.freeze({
  appId: APP_ID,
  username: USER,
  password: PASSWORD,
  tenantId: TENANT,
  organizationId: ORGANIZATION,
});
