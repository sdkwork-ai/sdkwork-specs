#!/usr/bin/env node

/**
 * Mint the dual-token credential pairs a registration run needs.
 *
 * # Why this tool exists
 *
 * Registering applications needs two *different* credentials that cannot be
 * derived from one another:
 *
 * 1. the **Deploy app-api** pair (`Authorization: Bearer <auth>` +
 *    `Access-Token: <access>`) for `POST /app/v3/api/apps` and friends, and
 * 2. the **IAM management** pair for the dual-token installation-environment
 *    upsert (`PUT /backend/v3/api/iam/tenants/{tenant}/applications/{id}/environments/{key}`).
 *
 * Neither token is printed by `sdkwork-iam-db init/seed`, and the two routes
 * authenticate differently, so a rehearsal that only has the operator password
 * cannot start registering. This tool performs the two-step chain once and emits
 * the environment assignments:
 *
 * ```text
 *   operator username + password
 *          │
 *          ├─ POST /backend/v3/api/iam/access_credentials      (bootstrap-body)
 *          │     body: tenantId + organizationId + appId + username + password
 *          │     → { accessToken, authToken }                  ⇒ Deploy app-api pair
 *          │
 *          └─ POST /app/v3/api/auth/sessions                   (credential-entry-bootstrap)
 *                headers: Access-Token = the credential above
 *                body:    grantType + username + password + deviceId
 *                → { accessToken, authToken }                  ⇒ IAM management pair
 * ```
 *
 * The order matters and so does `deviceId`. `POST /app/v3/api/auth/sessions`
 * revokes every live session of the same `(tenant, user, app_id, device_id)`
 * before it issues a new one (`sdkwork-routes-iam-app-api/src/tokens.rs`
 * `revoke_active_sessions_for_user_app_device`). The credential minted by
 * `access_credentials` is a session of the same application with **no** device
 * id, so a login without one revokes it and the Deploy pair dies before it is
 * used. Naming the management session's device keeps the two sessions disjoint
 * and both usable — this is not cosmetic, and the fake in the tests asserts it.
 *
 * @module app-registration/bootstrap-credentials
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  bodyFingerprintHeaders,
  parseRetryAfterMs,
  serializeRequestBody,
} from './http-fingerprint.mjs';
import { resolveIamOrigin } from './iam-client.mjs';

/** Environment variables this tool reads, in resolution order. */
export const BOOTSTRAP_SETTINGS_ENV = Object.freeze({
  iamBaseUrl: ['SDKWORK_IAM_BACKEND_API_BASE_URL', 'SDKWORK_BACKEND_BASE_URL'],
  deployBaseUrl: ['SDKWORK_DEPLOY_BACKEND_API_BASE_URL'],
  authToken: ['SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN', 'SDKWORK_IAM_BOOTSTRAP_AUTH_TOKEN'],
  username: ['SDKWORK_IAM_BOOTSTRAP_OPERATOR_USERNAME', 'SDKWORK_IAM_BOOTSTRAP_USERNAME'],
  password: ['SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD', 'SDKWORK_IAM_BOOTSTRAP_PASSWORD'],
  appId: ['SDKWORK_IAM_BOOTSTRAP_APP_ID'],
  tenantId: ['SDKWORK_TENANT_ID'],
  organizationId: ['SDKWORK_ORGANIZATION_ID'],
  deviceId: ['SDKWORK_REGISTRATION_DEVICE_ID'],
});

/** Default install anchor used to mint the bootstrap credential.
 *
 * `access_credentials` resolves `appId` against
 * `iam_application_installation.deploy_application_id`, never against the IAM
 * runtime `app_id`. `sdkwork-iam` is the anchor IAM self-registers when its own
 * gateway bootstraps from `SDKWORK_APP_ROOT`, so it is the one installation that
 * exists before any registration run.
 */
export const DEFAULT_BOOTSTRAP_APP_ID = 'sdkwork-iam';

/** Default tenant/organization of the seeded platform (`002_default_iam_subject`). */
export const DEFAULT_TENANT_ID = '100001';
export const DEFAULT_ORGANIZATION_ID = '0';

/** Device id that keeps the management session disjoint from the credential. */
export const DEFAULT_MANAGEMENT_DEVICE_ID = 'sdkwork-app-registration';

/** IAM routes used by the chain. */
export const IAM_ACCESS_CREDENTIALS_PATH = '/backend/v3/api/iam/access_credentials';
export const IAM_SESSION_LOGIN_PATH = '/app/v3/api/auth/sessions';

/** Typed failure that names the link of the chain that could not be completed. */
export class BootstrapCredentialError extends Error {
  /**
   * @param message - operator-facing message naming the route/variable to fix
   * @param options - `stage` (config | deploy-credential | management-session),
   *   HTTP status, problem code, retryability, and the route path
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'BootstrapCredentialError';
    this.stage = options.stage ?? 'config';
    this.path = options.path ?? '';
    this.status = options.status ?? 0;
    this.code = options.code ?? '';
    this.retryable = Boolean(options.retryable);
    this.retryAfterMs = Number(options.retryAfterMs) > 0 ? Number(options.retryAfterMs) : 0;
  }
}

function trim(value) {
  return String(value ?? '').trim();
}

function firstDefined(values) {
  for (const value of values) {
    const trimmed = trim(value);
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

/**
 * Resolve the bootstrap settings from flags plus the process environment.
 *
 * Every missing value is named before a single request is attempted, so a
 * rehearsal fails with "set SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD" instead of
 * an opaque 401.
 * @param options - flag values (`iamBaseUrl`, `username`, `password`, `authToken`, ...)
 * @param env - process environment (injected by tests)
 * @returns the resolved, validated settings
 */
export function resolveBootstrapSettings(options = {}, env = process.env) {
  const pick = (keys) => firstDefined(keys.map((key) => env?.[key]));
  const iamBaseUrl = trim(options.iamBaseUrl) || pick(BOOTSTRAP_SETTINGS_ENV.iamBaseUrl);
  if (!iamBaseUrl) {
    throw new BootstrapCredentialError(
      `IAM base URL is required: pass --iam-base-url or set ${BOOTSTRAP_SETTINGS_ENV.iamBaseUrl[0]}`,
      { stage: 'config' },
    );
  }
  const authToken = trim(options.authToken) || pick(BOOTSTRAP_SETTINGS_ENV.authToken);
  const username = trim(options.username) || pick(BOOTSTRAP_SETTINGS_ENV.username);
  const password = trim(options.password) || pick(BOOTSTRAP_SETTINGS_ENV.password);
  if (!authToken && !(username && password)) {
    throw new BootstrapCredentialError(
      'the bootstrap operator credential is required: pass --username + --password (or set '
      + `${BOOTSTRAP_SETTINGS_ENV.username[0]} + ${BOOTSTRAP_SETTINGS_ENV.password[0]}), `
      + `or pass --operator-auth-token (${BOOTSTRAP_SETTINGS_ENV.authToken[0]})`,
      { stage: 'config' },
    );
  }
  return {
    iamBaseUrl,
    deployBaseUrl: trim(options.deployBaseUrl) || pick(BOOTSTRAP_SETTINGS_ENV.deployBaseUrl),
    authToken,
    username,
    password,
    appId: trim(options.appId) || pick(BOOTSTRAP_SETTINGS_ENV.appId) || DEFAULT_BOOTSTRAP_APP_ID,
    tenantId:
      trim(options.tenantId) || pick(BOOTSTRAP_SETTINGS_ENV.tenantId) || DEFAULT_TENANT_ID,
    organizationId:
      trim(options.organizationId)
      || pick(BOOTSTRAP_SETTINGS_ENV.organizationId)
      || DEFAULT_ORGANIZATION_ID,
    deviceId:
      trim(options.deviceId) || pick(BOOTSTRAP_SETTINGS_ENV.deviceId)
      || DEFAULT_MANAGEMENT_DEVICE_ID,
    timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10_000,
    maxAttempts: Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 3,
    retryDelayMs: Number(options.retryDelayMs) >= 0 ? Number(options.retryDelayMs) : 500,
  };
}

/**
 * Decode a JWT payload without verifying it.
 *
 * Only used to report facts a human can check (which anchor the token names,
 * when it expires, which session it belongs to). It never decides anything.
 * @param token - compact JWS
 * @returns the claims object, or null when the value is not a JWT
 */
export function decodeTokenClaims(token) {
  const segment = trim(token).split('.')[1];
  if (!segment) {
    return null;
  }
  try {
    const payload = Buffer.from(segment.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64');
    const parsed = JSON.parse(payload.toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function tokenFacts(token) {
  const claims = decodeTokenClaims(token) ?? {};
  const expiresAt = Number(claims.exp) > 0 ? new Date(Number(claims.exp) * 1000).toISOString() : '';
  return {
    present: Boolean(trim(token)),
    length: trim(token).length,
    appId: trim(claims.app_id),
    audience: trim(claims.aud),
    sessionId: trim(claims.session_id),
    userId: trim(claims.user_id),
    environment: trim(claims.environment),
    deploymentMode: trim(claims.deployment_mode),
    authLevel: trim(claims.auth_level),
    expiresAt,
  };
}

function problemCode(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  return payload.code === undefined || payload.code === null ? '' : String(payload.code);
}

function problemMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  for (const key of ['detail', 'title', 'message']) {
    const value = trim(payload[key]);
    if (value) {
      return value.slice(0, 300);
    }
  }
  return '';
}

/**
 * Create the two-request client that mints the credential pairs.
 *
 * @param settings - resolved settings from {@link resolveBootstrapSettings}
 * @param hooks - `fetchImpl` and `sleep` injection points (tests)
 * @returns the client with `mintDeployCredential`, `mintManagementSession`, `bootstrap`
 */
export function createBootstrapCredentialClient(settings, hooks = {}) {
  const origin = resolveIamOrigin(settings.iamBaseUrl);
  const fetchImpl = hooks.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = hooks.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : 10_000;
  const maxAttempts = Number(settings.maxAttempts) > 0 ? Number(settings.maxAttempts) : 3;
  const retryDelayMs = Number(settings.retryDelayMs) >= 0 ? Number(settings.retryDelayMs) : 500;
  const requests = [];
  let bootstrapCredential = null;
  let managementSession = null;

  async function send(method, url, { headers, body, stage, pathLabel }) {
    for (let attempt = 1; ; attempt += 1) {
      const signal =
        typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers,
          ...(body !== undefined ? { body } : {}),
          ...(signal !== undefined ? { signal } : {}),
        });
      } catch (error) {
        if (attempt < maxAttempts) {
          await sleep(retryDelayMs * attempt);
          continue;
        }
        throw new BootstrapCredentialError(
          `${method} ${pathLabel} is unreachable at ${origin} (${stage} link): `
          + `${error instanceof Error ? error.message : String(error)}. Check that the IAM gateway `
          + 'is listening on the configured base URL.',
          { stage, path: pathLabel, retryable: true },
        );
      }
      requests.push({ method, path: pathLabel, status: response.status, attempt });
      const text = await response.text().catch(() => '');
      let payload = {};
      if (text.trim()) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw new BootstrapCredentialError(
            `${method} ${pathLabel} answered HTTP ${response.status} with a non-JSON body (${stage} link)`,
            { stage, path: pathLabel, status: response.status },
          );
        }
      }
      if (response.ok) {
        return payload;
      }
      const retryable = response.status >= 500 || response.status === 429;
      if (retryable && attempt < maxAttempts) {
        const announced = parseRetryAfterMs(response.headers?.get?.('retry-after'));
        await sleep(announced > 0 ? announced : retryDelayMs * attempt);
        continue;
      }
      throw new BootstrapCredentialError(
        `${method} ${pathLabel} was rejected with HTTP ${response.status} (${stage} link)${
          problemCode(payload) ? ` (problem code ${problemCode(payload)})` : ''
        }${problemMessage(payload) ? `: ${problemMessage(payload)}` : ''}`,
        {
          stage,
          path: pathLabel,
          status: response.status,
          code: problemCode(payload),
          retryable,
          retryAfterMs: parseRetryAfterMs(response.headers?.get?.('retry-after')),
        },
      );
    }
  }

  function unwrap(payload, pathLabel, stage) {
    const data = payload && typeof payload === 'object' ? payload.data ?? payload : null;
    if (!data || typeof data !== 'object') {
      throw new BootstrapCredentialError(
        `${pathLabel} returned no credential object (${stage} link)`,
        { stage, path: pathLabel },
      );
    }
    const accessToken = trim(data.accessToken ?? data.access_token ?? data.accessCredential);
    const authToken = trim(data.authToken ?? data.auth_token);
    if (!accessToken || !authToken) {
      throw new BootstrapCredentialError(
        `${pathLabel} returned no accessToken/authToken pair (${stage} link); a dual-token client `
        + 'needs both headers',
        { stage, path: pathLabel },
      );
    }
    return {
      accessToken,
      authToken,
      tenantApplicationId: trim(data.tenantApplicationId),
      sessionId: trim(data.sessionId),
      expiresAt: trim(data.expiresAt),
      echoedAppId: trim(data.appId),
    };
  }

  /**
   * Step 1 — mint the bootstrap credential that the Deploy app-api accepts.
   * @returns the dual-token pair plus the installation it was issued for
   */
  async function mintDeployCredential() {
    if (bootstrapCredential) {
      return bootstrapCredential;
    }
    const body = {
      tenantId: trim(settings.tenantId) || DEFAULT_TENANT_ID,
      organizationId: trim(settings.organizationId) || DEFAULT_ORGANIZATION_ID,
      appId: trim(settings.appId) || DEFAULT_BOOTSTRAP_APP_ID,
      ...(settings.authToken
        ? { authToken: settings.authToken }
        : { username: settings.username, password: settings.password }),
    };
    const serialized = serializeRequestBody(body);
    const payload = await send('POST', `${origin}${IAM_ACCESS_CREDENTIALS_PATH}`, {
      headers: {
        accept: 'application/json',
        ...bodyFingerprintHeaders(serialized),
      },
      body: serialized,
      stage: 'deploy-credential',
      pathLabel: IAM_ACCESS_CREDENTIALS_PATH,
    });
    const pair = unwrap(payload, IAM_ACCESS_CREDENTIALS_PATH, 'deploy-credential');
    bootstrapCredential = {
      ...pair,
      facts: {
        ...tokenFacts(pair.accessToken),
        stage: 'deploy-credential',
        route: IAM_ACCESS_CREDENTIALS_PATH,
        requestedAppId: settings.appId,
        tenantId: settings.tenantId,
        organizationId: settings.organizationId,
      },
    };
    return bootstrapCredential;
  }

  /**
   * Step 2 — trade the bootstrap access token for a management session.
   *
   * `deviceId` is mandatory in spirit: without it the login revokes the
   * credential session from step 1 (same application, same null device).
   * @returns the dual-token management session
   */
  async function mintManagementSession() {
    if (managementSession) {
      return managementSession;
    }
    const credential = await mintDeployCredential();
    const body = {
      grantType: 'password',
      username: settings.username,
      password: settings.password,
      deviceId: settings.deviceId,
    };
    const serialized = serializeRequestBody(body);
    const payload = await send('POST', `${origin}${IAM_SESSION_LOGIN_PATH}`, {
      headers: {
        accept: 'application/json',
        'access-token': credential.accessToken,
        ...bodyFingerprintHeaders(serialized),
      },
      body: serialized,
      stage: 'management-session',
      pathLabel: IAM_SESSION_LOGIN_PATH,
    });
    const pair = unwrap(payload, IAM_SESSION_LOGIN_PATH, 'management-session');
    managementSession = {
      ...pair,
      facts: {
        ...tokenFacts(pair.accessToken),
        stage: 'management-session',
        route: IAM_SESSION_LOGIN_PATH,
        deviceId: settings.deviceId,
      },
    };
    return managementSession;
  }

  return {
    /** Facts about the requests already sent (redacted: no bodies, no tokens). */
    requests,
    mintDeployCredential,
    mintManagementSession,

    /**
     * Run both steps and return the credential document.
     * @returns both pairs plus the resolved origin/settings facts
     */
    async bootstrap() {
      const deploy = await mintDeployCredential();
      const management = await mintManagementSession();
      return {
        deploy,
        management,
        origin,
        settings: {
          appId: settings.appId,
          tenantId: settings.tenantId,
          organizationId: settings.organizationId,
          deviceId: settings.deviceId,
        },
      };
    },
  };
}

/**
 * Render the `KEY=value` lines a shell can `export`.
 *
 * `SDKWORK_DEPLOY_BACKEND_API_BASE_URL` is only emitted when the caller supplied
 * a Deploy base URL: inventing a port would make a rehearsal talk to whatever
 * happens to listen there.
 * @param result - output of {@link createBootstrapCredentialClient} `.bootstrap()`
 * @param deployBaseUrl - Deploy app-api origin, optional
 * @returns the assignment lines
 */
export function renderEnvAssignments(result, deployBaseUrl = '') {
  const lines = [`SDKWORK_IAM_BACKEND_API_BASE_URL=${result.origin}`];
  if (trim(deployBaseUrl)) {
    lines.push(`SDKWORK_DEPLOY_BACKEND_API_BASE_URL=${trim(deployBaseUrl)}`);
  }
  lines.push(
    `SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN=${result.deploy.accessToken}`,
    `SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN=${result.deploy.authToken}`,
    `SDKWORK_IAM_MANAGEMENT_ACCESS_TOKEN=${result.management.accessToken}`,
    `SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN=${result.management.authToken}`,
  );
  return lines;
}

/**
 * Restrict a credential file to its owner.
 *
 * POSIX gets `chmod 0600`. On Windows `chmod` only toggles the read-only
 * attribute, so the file's inherited ACL is replaced with an owner-only grant
 * through `icacls`; if that fails the caller is told rather than left with a
 * world-readable token file.
 * @param filePath - file to lock down
 */
export function restrictCredentialFile(filePath) {
  fs.chmodSync(filePath, 0o600);
  if (process.platform !== 'win32') {
    return;
  }
  const owner = trim(process.env.USERNAME);
  if (!owner) {
    throw new BootstrapCredentialError(
      `credential file ${filePath} could not be restricted: USERNAME is not set, so an owner-only `
      + 'ACL cannot be applied',
      { stage: 'config' },
    );
  }
  execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${owner}:F`], {
    stdio: 'ignore',
  });
}

/**
 * Write the credential assignments as a file readable only by the owner.
 * @param filePath - destination (parents are created)
 * @param lines - `KEY=value` assignments
 * @returns the absolute path written
 */
export function writeCredentialFile(filePath, lines) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  restrictCredentialFile(absolute);
  return absolute;
}

const HELP = `bootstrap-credentials — mint the dual-token pairs a registration run needs

Usage:
  bootstrap-credentials [options]

Chain:
  1. POST ${IAM_ACCESS_CREDENTIALS_PATH}            (bootstrap-body)
     → SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN / SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN
  2. POST ${IAM_SESSION_LOGIN_PATH}   (Access-Token = step 1, deviceId scoped)
     → SDKWORK_IAM_MANAGEMENT_ACCESS_TOKEN / SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN

Options:
  --iam-base-url <url>        IAM gateway origin (env ${BOOTSTRAP_SETTINGS_ENV.iamBaseUrl[0]})
  --deploy-base-url <url>     Deploy app-api origin; emitted as
                              SDKWORK_DEPLOY_BACKEND_API_BASE_URL (env ${BOOTSTRAP_SETTINGS_ENV.deployBaseUrl[0]})
  --username <name>           bootstrap operator username (env ${BOOTSTRAP_SETTINGS_ENV.username[0]})
  --password <password>       bootstrap operator password (env ${BOOTSTRAP_SETTINGS_ENV.password[0]})
  --operator-auth-token <jwt> bootstrap-body authToken instead of username + password
                              (env ${BOOTSTRAP_SETTINGS_ENV.authToken[0]})
  --app-id <anchor>           deploy application anchor of the issuing installation
                              (env ${BOOTSTRAP_SETTINGS_ENV.appId[0]}, default ${DEFAULT_BOOTSTRAP_APP_ID})
  --tenant-id <id>            default ${DEFAULT_TENANT_ID}
  --organization-id <id>      default ${DEFAULT_ORGANIZATION_ID}
  --device-id <id>            management session device id (default ${DEFAULT_MANAGEMENT_DEVICE_ID});
                              it keeps the session disjoint from the credential session
  --timeout-ms <n>            per-request timeout (default 10000)
  --retries <n>               attempts for 429/5xx (default 3)
  --out <path>                write the assignments to a 0600 file instead of stdout
  --report <path>             write a redacted JSON report (never contains tokens)
  --json                      print the credential document as JSON (contains tokens)
  --help                      show this help

Exit codes:
  0  both pairs minted
  1  a link of the chain failed (the message names the stage, route, and variable)
  2  configuration is unusable
`;

/**
 * Parse command-line arguments.
 * @param argv - arguments without the node/script prefix
 * @returns the options plus `help`
 */
export function parseArgs(argv) {
  const options = { help: false };
  const valueOf = (index, name) => {
    const value = trim(argv[index + 1]);
    if (!value) {
      throw new BootstrapCredentialError(`${name} requires a value`, { stage: 'config' });
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--iam-base-url':
        options.iamBaseUrl = valueOf(index, arg);
        index += 1;
        break;
      case '--deploy-base-url':
        options.deployBaseUrl = valueOf(index, arg);
        index += 1;
        break;
      case '--username':
        options.username = valueOf(index, arg);
        index += 1;
        break;
      case '--password':
        options.password = valueOf(index, arg);
        index += 1;
        break;
      case '--operator-auth-token':
        options.authToken = valueOf(index, arg);
        index += 1;
        break;
      case '--app-id':
        options.appId = valueOf(index, arg);
        index += 1;
        break;
      case '--tenant-id':
        options.tenantId = valueOf(index, arg);
        index += 1;
        break;
      case '--organization-id':
        options.organizationId = valueOf(index, arg);
        index += 1;
        break;
      case '--device-id':
        options.deviceId = valueOf(index, arg);
        index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = Number(valueOf(index, arg));
        index += 1;
        break;
      case '--retries':
        options.maxAttempts = Number(valueOf(index, arg));
        index += 1;
        break;
      case '--out':
        options.outPath = valueOf(index, arg);
        index += 1;
        break;
      case '--report':
        options.reportPath = valueOf(index, arg);
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new BootstrapCredentialError(`unsupported option: ${arg}`, { stage: 'config' });
    }
  }
  if (options.timeoutMs !== undefined && !(Number(options.timeoutMs) > 0)) {
    throw new BootstrapCredentialError('--timeout-ms must be a positive number', {
      stage: 'config',
    });
  }
  if (options.maxAttempts !== undefined && !(Number(options.maxAttempts) >= 1)) {
    throw new BootstrapCredentialError('--retries must be a positive integer', {
      stage: 'config',
    });
  }
  return options;
}

/**
 * Build the redacted report of a successful run.
 * @param result - client output
 * @param requests - request log from the client
 * @returns a JSON-serializable document without any token value
 */
export function buildReport(result, requests) {
  return {
    schemaVersion: 1,
    kind: 'sdkwork.bootstrap-credentials-report',
    generatedAt: new Date().toISOString(),
    iamBaseUrl: result.origin,
    appId: result.settings.appId,
    tenantId: result.settings.tenantId,
    organizationId: result.settings.organizationId,
    deviceId: result.settings.deviceId,
    deployCredential: {
      route: IAM_ACCESS_CREDENTIALS_PATH,
      tenantApplicationId: result.deploy.tenantApplicationId,
      echoedAppId: result.deploy.echoedAppId,
      ...result.deploy.facts,
    },
    managementSession: {
      route: IAM_SESSION_LOGIN_PATH,
      ...result.management.facts,
    },
    requests,
  };
}

/**
 * Run the CLI and map failures onto the documented exit codes.
 * @param argv - arguments without the node/script prefix
 * @param env - process environment (tests)
 * @param io - output sinks (tests capture instead of writing the console)
 * @returns the process exit code
 */
export async function runMain(argv, env = process.env, io = {}) {
  const stdout = io.stdout ?? ((chunk) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk) => process.stderr.write(chunk));
  try {
    const options = parseArgs(argv);
    if (options.help) {
      stdout(HELP);
      return 0;
    }
    const settings = resolveBootstrapSettings(options, env);
    const client = createBootstrapCredentialClient(settings);
    const result = await client.bootstrap();
    const lines = renderEnvAssignments(result, settings.deployBaseUrl);

    if (options.outPath) {
      const written = writeCredentialFile(options.outPath, lines);
      stdout(
        `bootstrap-credentials: wrote ${lines.length} assignment(s) to ${written} (0600)\n`,
      );
    } else {
      stdout(`${lines.join('\n')}\n`);
    }
    if (options.json) {
      stdout(`${JSON.stringify({
        deploy: { accessToken: result.deploy.accessToken, authToken: result.deploy.authToken },
        management: {
          accessToken: result.management.accessToken,
          authToken: result.management.authToken,
        },
        facts: buildReport(result, client.requests),
      }, null, 2)}\n`);
    }
    if (options.reportPath) {
      const report = buildReport(result, client.requests);
      fs.mkdirSync(path.dirname(path.resolve(options.reportPath)), { recursive: true });
      fs.writeFileSync(
        path.resolve(options.reportPath),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
      );
      stderr(`bootstrap-credentials: redacted report written to ${options.reportPath}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof BootstrapCredentialError) {
      stderr(`[bootstrap-credentials] ${error.stage} link failed: ${error.message}\n`);
      return error.stage === 'config' ? 2 : 1;
    }
    stderr(
      `[bootstrap-credentials] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    return 1;
  }
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runMain(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
