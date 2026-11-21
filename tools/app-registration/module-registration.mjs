#!/usr/bin/env node

/**
 * Universal module registration entrypoint.
 *
 * One module (a `sdkwork-*` repository) is the unit: this command discovers the
 * repository root manifest and every `apps/*` surface, then registers all of
 * them against one Deploy + IAM deployment. It is the same flow every module in
 * the workspace uses, so a new module does not need a bespoke script.
 *
 * # Two identities
 *
 * - `--auth operator` (default): the Deploy and IAM calls run as an operator or
 *   admin. Deploy derives `ownerType=TENANT` from that caller, the installation
 *   is provisioned with `ownershipScope=TENANT`, and the returned anchors are
 *   written into the module's authored env layer so the committed profile matrix
 *   is materialized with them.
 * - `--auth user`: the Deploy calls run as the signed-in (or password-granted)
 *   user, so Deploy derives `ownerType=USER` and the user's own app center lists
 *   the result. The IAM provision/enable calls still use an operator credential
 *   (`--operator-username`/`--operator-password` or the environment) because
 *   enabling an installation is the super-admin step; the installation itself
 *   is provisioned with `ownershipScope=USER` and the user's id as
 *   `ownerUserId`. Anchors are user-specific, so they are not written into the
 *   committed layer unless `--materialize-user` is passed explicitly.
 *
 * # OEM
 *
 * `--api-domain` points Deploy and IAM at one gateway origin, and
 * `--domain-pattern` (or `--brand` + `--domain-suffix`) names the public
 * installation domains. `--oem-config` reads the same values from one JSON file,
 * so a white-label cluster is initialized by replacing the API domain and the
 * domain suffix, then running the same command.
 *
 * @module app-registration/module-registration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  RegistrationConfigurationError,
  resolveRegistrationSettings,
} from './contract.mjs';
import {
  bodyFingerprintHeaders,
  serializeRequestBody,
} from './http-fingerprint.mjs';
import { buildRegistrationInventory } from './inventory.mjs';
import { registerApplications } from './register.mjs';
import { createApplicationAccessToken } from '../app-access-token.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.resolve(MODULE_DIR, '..');
const APP_MANIFEST_FILE = 'agent.app.config.json';
const IAM_SESSION_LOGIN_PATH = '/app/v3/api/auth/sessions';
const DEFAULT_ENVIRONMENT = 'development';
const DEFAULT_DEVICE_ID = 'sdkwork-module-registration';
const AUTH_MODES = ['operator', 'user'];

function trim(value) {
  return String(value ?? '').trim();
}

function absoluteHttpUrl(value, label) {
  const raw = trim(value).replace(/\/+$/u, '');
  if (!raw) {
    return '';
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new RegistrationConfigurationError(`${label} is not an absolute URL: ${JSON.stringify(raw)}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new RegistrationConfigurationError(`${label} must use http or https: ${JSON.stringify(raw)}`);
  }
  return raw;
}

function withScheme(domain) {
  const raw = trim(domain).replace(/\/+$/u, '');
  if (!raw) {
    return '';
  }
  return /^https?:\/\//iu.test(raw) ? raw : `https://${raw}`;
}

/**
 * Application roots of one module repository.
 *
 * A module owns its root manifest and zero or more `apps/<surface>` manifests;
 * a directory without a manifest is not an application root and is skipped.
 * @param moduleRoot - absolute module repository root
 * @returns relative application directories (`'.'` for the root)
 */
export function discoverModuleRoots(moduleRoot) {
  const root = path.resolve(moduleRoot);
  if (!fs.existsSync(path.join(root, APP_MANIFEST_FILE))) {
    throw new RegistrationConfigurationError(
      `${root} has no ${APP_MANIFEST_FILE}; run the command at a module root or pass --module-root`,
    );
  }
  const roots = ['.'];
  const appsDir = path.join(root, 'apps');
  if (fs.existsSync(appsDir)) {
    const surfaces = fs
      .readdirSync(appsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(appsDir, name, APP_MANIFEST_FILE)))
      .sort((left, right) => left.localeCompare(right));
    for (const surface of surfaces) {
      roots.push(`apps/${surface}`);
    }
  }
  return roots;
}

/**
 * Registration ids for one module in the workspace inventory.
 *
 * The inventory id is the path relative to the workspace root, so the repository
 * name is the first segment: `<repo>` for the root manifest and
 * `<repo>/apps/<surface>` for a surface.
 * @param moduleRoot - absolute module repository root
 * @returns `--only` ids
 */
export function moduleRegistrationIds(moduleRoot) {
  const root = path.resolve(moduleRoot);
  const repo = path.basename(root);
  return discoverModuleRoots(root).map((relative) => (
    relative === '.' ? repo : `${repo}/${relative}`
  ));
}

/**
 * Workspace root that contains the module repository.
 * @param moduleRoot - absolute module repository root
 * @param explicit - optional explicit workspace root
 * @returns absolute workspace root
 */
export function resolveModuleWorkspace(moduleRoot, explicit = '') {
  if (trim(explicit)) {
    return path.resolve(explicit);
  }
  return path.dirname(path.resolve(moduleRoot));
}

/**
 * Expand the OEM placeholders the registration resolver does not own.
 *
 * `{env}` and `{slug}` stay for the registrar; `{app}` is its slug form,
 * `{brand}` and `{suffix}` are literal replacements.
 * @param pattern - authored pattern
 * @param values - brand/suffix
 * @returns pattern the registrar understands
 */
export function expandOemDomainPattern(pattern, { brand = '', suffix = '' } = {}) {
  return trim(pattern)
    .replaceAll('{brand}', trim(brand))
    .replaceAll('{suffix}', trim(suffix))
    .replaceAll('{app}', '{slug}');
}

/**
 * Resolve the API endpoints and public-domain pattern for one deployment.
 *
 * Explicit flags win; `--oem-config` fills the rest; environment values are the
 * last fallback. The API domain is the OEM switch: replacing it points the same
 * module at another cluster without editing the module.
 * @param input - flags and env
 * @returns endpoints, domain pattern, and tenant scope
 */
export function resolveModuleOemSettings(input = {}) {
  const env = input.env ?? process.env;
  const config = input.oemConfig ?? {};
  const pick = (flag, configKey, envKeys) => {
    const explicit = trim(flag);
    if (explicit) {
      return explicit;
    }
    const configured = trim(config[configKey]);
    if (configured) {
      return configured;
    }
    for (const key of envKeys) {
      const value = trim(env[key]);
      if (value) {
        return value;
      }
    }
    return '';
  };
  const apiDomain = pick(input.apiDomain, 'apiDomain', ['SDKWORK_OEM_API_DOMAIN', 'SDKWORK_API_DOMAIN']);
  const brand = pick(input.brand, 'brand', ['SDKWORK_OEM_BRAND']);
  const suffix = pick(input.domainSuffix, 'domainSuffix', ['SDKWORK_OEM_DOMAIN_SUFFIX']);
  const explicitPattern = pick(
    input.domainPattern,
    'domainPattern',
    ['SDKWORK_OEM_DOMAIN_PATTERN'],
  );
  const pattern = explicitPattern || (suffix ? '{app}.{env}.{suffix}' : '');
  const deployBaseUrl = absoluteHttpUrl(
    trim(input.deployBaseUrl) || withScheme(apiDomain),
    'Deploy base URL',
  );
  const iamBaseUrl = absoluteHttpUrl(
    trim(input.iamBaseUrl) || withScheme(apiDomain),
    'IAM base URL',
  );
  return {
    apiDomain,
    brand,
    suffix,
    primaryDomainPattern: expandOemDomainPattern(pattern, { brand, suffix }),
    deployBaseUrl,
    iamBaseUrl,
    tenantId: pick(input.tenantId, 'tenantId', ['SDKWORK_TENANT_ID']),
    organizationId: pick(input.organizationId, 'organizationId', ['SDKWORK_ORGANIZATION_ID']) || '0',
  };
}

function decodeJwtPayload(token) {
  const value = trim(token);
  const segment = value.split('.')[1];
  if (!segment) {
    return {};
  }
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * Facts carried by a dual-token session access token.
 * @param accessToken - JWT access token
 * @returns tenant, user, and organization ids when present
 */
export function readSessionIdentity(accessToken) {
  const claims = decodeJwtPayload(accessToken);
  return {
    userId: trim(claims.user_id ?? claims.sub ?? claims.userId),
    tenantId: trim(claims.tenant_id ?? claims.tenantId),
    organizationId: trim(claims.organization_id ?? claims.organizationId),
  };
}

/**
 * Password-grant login through the credential-entry-bootstrap route.
 *
 * The `Access-Token` must be an application credential the caller already holds
 * (for a module, its committed public token); the route then issues a normal
 * user session, so the Deploy calls that follow run as that user.
 * @param input - endpoints and credentials
 * @returns the dual-token session
 */
export async function loginUserSession(input = {}) {
  const baseUrl = absoluteHttpUrl(input.baseUrl, 'IAM base URL');
  const accessToken = trim(input.accessToken);
  const username = trim(input.username);
  const password = String(input.password ?? '');
  if (!accessToken) {
    throw new RegistrationConfigurationError(
      'user login requires --access-token (or SDKWORK_ACCESS_TOKEN) as the app credential',
    );
  }
  if (!username || !password) {
    throw new RegistrationConfigurationError('user login requires --username and --password');
  }
  const body = {
    grantType: 'password',
    username,
    password,
    deviceId: trim(input.deviceId) || DEFAULT_DEVICE_ID,
  };
  const serialized = serializeRequestBody(body);
  const response = await (input.fetchImpl ?? fetch)(`${baseUrl}${IAM_SESSION_LOGIN_PATH}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'access-token': accessToken,
      ...bodyFingerprintHeaders(serialized),
    },
    body: serialized,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new RegistrationConfigurationError(
      `user login failed with HTTP ${response.status}`,
      { status: response.status, payload },
    );
  }
  const data = payload?.data ?? payload;
  const sessionAccessToken = trim(data?.accessToken ?? data?.access_token);
  const sessionAuthToken = trim(data?.authToken ?? data?.auth_token);
  if (!sessionAccessToken || !sessionAuthToken) {
    throw new RegistrationConfigurationError('user login returned no accessToken/authToken pair');
  }
  return {
    accessToken: sessionAccessToken,
    authToken: sessionAuthToken,
    identity: readSessionIdentity(sessionAccessToken),
  };
}

/**
 * Mint the operator credential document with the established bootstrap tool.
 *
 * A child process keeps this module from duplicating the credential-chain rules;
 * the temporary file is deleted before the function returns.
 * @param input - endpoints, credentials, and tenant scope
 * @returns Deploy + IAM operator settings
 */
export function mintOperatorSettings(input = {}) {
  const script = path.join(TOOLS_DIR, 'bootstrap-credentials.mjs');
  const outFile = path.join(os.tmpdir(), `sdkwork-module-registration-${process.pid}-${Date.now()}.env`);
  const reportFile = `${outFile}.report.json`;
  const args = [
    script,
    '--iam-base-url', input.iamBaseUrl,
    '--deploy-base-url', input.deployBaseUrl,
    '--username', input.username,
    '--password', input.password,
    '--app-id', input.appId || 'sdkwork-api-cloud-gateway',
    '--tenant-id', input.tenantId || '100001',
    '--organization-id', input.organizationId || '0',
    '--device-id', input.deviceId || DEFAULT_DEVICE_ID,
    '--out', outFile,
    '--report', reportFile,
  ];
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
  });
  try {
    if (result.status !== 0) {
      throw new RegistrationConfigurationError(
        `operator credential bootstrap failed: ${trim(result.stderr) || trim(result.stdout)}`,
      );
    }
    const assignments = {};
    for (const line of fs.readFileSync(outFile, 'utf8').split(/\r?\n/u)) {
      const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
      if (match) {
        assignments[match[1]] = match[2];
      }
    }
    return {
      deploy: {
        baseUrl: input.deployBaseUrl,
        accessToken: assignments.SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN,
        authToken: assignments.SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN,
        timeoutMs: 10_000,
      },
      iam: {
        baseUrl: input.iamBaseUrl,
        auth: { username: input.username, password: input.password },
        management: {
          accessToken: assignments.SDKWORK_IAM_MANAGEMENT_ACCESS_TOKEN,
          authToken: assignments.SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN,
        },
        timeoutMs: 10_000,
      },
      tenantId: input.tenantId || '100001',
      organizationId: input.organizationId || '0',
    };
  } finally {
    fs.rmSync(outFile, { force: true });
    fs.rmSync(reportFile, { force: true });
  }
}

/**
 * Operator settings from the process environment, or minted from credentials.
 * @param oem - resolved endpoints and scope
 * @param input - credential flags
 * @returns settings document
 */
export function resolveOperatorSettings(oem, input = {}) {
  const env = input.env ?? process.env;
  const username = trim(input.username) || trim(env.SDKWORK_IAM_BOOTSTRAP_OPERATOR_USERNAME);
  const password = trim(input.password) || trim(env.SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD);
  const hasEnvTokens = trim(env.SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN)
    && trim(env.SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN)
    && (trim(env.SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN) || (username && password));
  if (hasEnvTokens && !input.forceMint) {
    const settings = resolveRegistrationSettings(env);
    return {
      ...settings,
      deploy: { ...settings.deploy, baseUrl: settings.deploy.baseUrl || oem.deployBaseUrl },
      iam: { ...settings.iam, baseUrl: settings.iam.baseUrl || oem.iamBaseUrl },
      tenantId: settings.tenantId || oem.tenantId,
      organizationId: settings.organizationId || oem.organizationId,
    };
  }
  if (!username || !password) {
    throw new RegistrationConfigurationError(
      'operator registration requires --username/--password (or the bootstrap operator env), '
      + 'or a ready token pair in SDKWORK_DEPLOY_BACKEND_* / SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN',
    );
  }
  if (!oem.deployBaseUrl || !oem.iamBaseUrl) {
    throw new RegistrationConfigurationError(
      'operator registration requires --api-domain (or --deploy-base-url/--iam-base-url)',
    );
  }
  return mintOperatorSettings({
    iamBaseUrl: oem.iamBaseUrl,
    deployBaseUrl: oem.deployBaseUrl,
    username,
    password,
    appId: trim(input.appId) || trim(env.SDKWORK_IAM_BOOTSTRAP_APP_ID) || 'sdkwork-api-cloud-gateway',
    tenantId: oem.tenantId || '100001',
    organizationId: oem.organizationId || '0',
    deviceId: trim(input.deviceId),
  });
}

/**
 * Resolve the user session for `--auth user`.
 * @param oem - resolved endpoints
 * @param input - tokens or password-grant fields
 * @param deps - fetch injection for tests
 * @returns user session and identity
 */
export async function resolveUserSession(oem, input = {}, deps = {}) {
  const env = input.env ?? process.env;
  const explicitAccess = trim(input.userAccessToken) || trim(env.SDKWORK_USER_ACCESS_TOKEN);
  const explicitAuth = trim(input.userAuthToken) || trim(env.SDKWORK_USER_AUTH_TOKEN);
  if (explicitAccess && explicitAuth) {
    return { accessToken: explicitAccess, authToken: explicitAuth, identity: readSessionIdentity(explicitAccess) };
  }
  if (!oem.iamBaseUrl) {
    throw new RegistrationConfigurationError(
      'user login requires --api-domain (or --iam-base-url), or a ready user token pair',
    );
  }
  return loginUserSession({
    baseUrl: oem.iamBaseUrl,
    accessToken: input.accessToken || env.SDKWORK_ACCESS_TOKEN,
    username: input.username,
    password: input.password,
    deviceId: input.deviceId || `${DEFAULT_DEVICE_ID}-user`,
    fetchImpl: deps.fetchImpl,
  });
}

/**
 * Run one module registration.
 * @param options - parsed options
 * @param deps - injection points for tests
 * @returns the registration report plus resolved context
 */
export async function registerModule(options = {}, deps = {}) {
  const moduleRoot = path.resolve(options.moduleRoot ?? process.cwd());
  const workspaceRoot = resolveModuleWorkspace(moduleRoot, options.workspaceRoot);
  const environment = trim(options.environment) || DEFAULT_ENVIRONMENT;
  const authMode = trim(options.auth) || 'operator';
  if (!AUTH_MODES.includes(authMode)) {
    throw new RegistrationConfigurationError(`--auth must be one of ${AUTH_MODES.join('|')}`);
  }
  const oem = resolveModuleOemSettings({
    ...options,
    env: deps.env ?? process.env,
  });
  const requestedOwnership = trim(options.ownership).toLowerCase()
    || (authMode === 'user' ? 'user' : 'tenant');
  if (!['tenant', 'organization', 'user'].includes(requestedOwnership)) {
    throw new RegistrationConfigurationError('--ownership must be tenant, organization, or user');
  }
  if (requestedOwnership === 'user' && authMode !== 'user') {
    throw new RegistrationConfigurationError('--ownership user requires --auth user');
  }
  if (requestedOwnership === 'tenant' && authMode !== 'operator') {
    throw new RegistrationConfigurationError('TENANT ownership requires --auth operator');
  }
  if (requestedOwnership === 'organization') {
    if (authMode !== 'operator') {
      throw new RegistrationConfigurationError('ORGANIZATION ownership requires --auth operator');
    }
    const organizationId = trim(options.organizationId) || oem.organizationId;
    if (!/^[1-9][0-9]*$/u.test(organizationId)) {
      throw new RegistrationConfigurationError(
        'ORGANIZATION ownership requires a positive --organization-id',
      );
    }
    oem.organizationId = organizationId;
    options.organizationId = organizationId;
  }
  const ids = options.only?.length ? options.only : moduleRegistrationIds(moduleRoot);
  if (ids.length === 0) {
    throw new RegistrationConfigurationError(`no application roots found under ${moduleRoot}`);
  }

  let settings;
  let ownershipScope = requestedOwnership === 'organization' ? 'ORGANIZATION' : 'TENANT';
  let ownerUserId = '';
  let writeAnchor = options.writeAnchor !== false;
  let materialize = options.materialize !== false;
  let userSession = null;

  if (authMode === 'operator') {
    if (options.dryRun && !(options.username || options.password || process.env.SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN)) {
      settings = {
        deploy: { baseUrl: oem.deployBaseUrl || 'http://127.0.0.1:3900', accessToken: '', authToken: '', timeoutMs: 10_000 },
        iam: { baseUrl: oem.iamBaseUrl || 'http://127.0.0.1:3901', auth: {}, management: {}, timeoutMs: 10_000 },
        tenantId: oem.tenantId || '100001',
        organizationId: oem.organizationId || '0',
      };
    } else {
      settings = resolveOperatorSettings(oem, {
        ...options,
        env: deps.env ?? process.env,
      });
    }
    if (oem.primaryDomainPattern) {
      options.primaryDomainPattern = oem.primaryDomainPattern;
    }
  } else {
    if (options.dryRun && !options.userAccessToken && !options.username && !process.env.SDKWORK_USER_ACCESS_TOKEN) {
      userSession = {
        accessToken: 'dry-run-user',
        authToken: 'dry-run-user',
        identity: {
          userId: trim(options.ownerUserId) || '1',
          tenantId: oem.tenantId || '100001',
          organizationId: oem.organizationId || '0',
        },
      };
    } else {
      userSession = await resolveUserSession(oem, {
        ...options,
        env: deps.env ?? process.env,
      }, deps);
    }
    ownerUserId = trim(options.ownerUserId) || userSession.identity.userId;
    if (!ownerUserId) {
      throw new RegistrationConfigurationError(
        'USER registration needs --owner-user-id or a session whose access token carries user_id',
      );
    }
    let operatorSettings;
    if (options.dryRun && !options.operatorUsername && !options.username && !process.env.SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN) {
      operatorSettings = {
        deploy: { baseUrl: oem.deployBaseUrl || 'http://127.0.0.1:3900', accessToken: '', authToken: '', timeoutMs: 10_000 },
        iam: { baseUrl: oem.iamBaseUrl || 'http://127.0.0.1:3901', auth: {}, management: {}, timeoutMs: 10_000 },
        tenantId: oem.tenantId || '100001',
        organizationId: oem.organizationId || '0',
      };
    } else {
      operatorSettings = resolveOperatorSettings(oem, {
        ...options,
        username: options.operatorUsername,
        password: options.operatorPassword,
        env: deps.env ?? process.env,
      });
    }
    settings = {
      ...operatorSettings,
      deploy: {
        ...operatorSettings.deploy,
        baseUrl: oem.deployBaseUrl || operatorSettings.deploy.baseUrl || '',
        accessToken: userSession.accessToken,
        authToken: userSession.authToken,
      },
    };
    ownershipScope = 'USER';
    // Deploy slugs are tenant-unique; a user-published copy gets its own namespace
    // so it can coexist with the tenant-owned registration of the same module.
    options.slugSuffix = trim(options.slugSuffix) || `-u${ownerUserId}`;
    // The repository anchor is the tenant identity; a user's copy must not read it.
    options.ignoreRecordedAnchor = true;
    // Domains are unique per tenant too; insert the user suffix into the first label.
    options.primaryDomainLabelSuffix = trim(options.primaryDomainLabelSuffix) || `-u${ownerUserId}`;
    // A user's anchor is theirs; it must not overwrite the repository identity
    // unless the run explicitly asks for a user-specific materialization.
    writeAnchor = options.materializeUser === true;
    materialize = options.materializeUser === true;
    if (oem.primaryDomainPattern) {
      options.primaryDomainPattern = oem.primaryDomainPattern;
    }
  }

  options.deployOwnerType = ownershipScope === 'USER'
    ? 'USER'
    : ownershipScope === 'ORGANIZATION' ? 'ORGANIZATION' : 'TENANT';
  if (options.iamTransport) {
    settings = { ...settings, iam: { ...settings.iam, transport: options.iamTransport } };
  }

  if (ownershipScope === 'ORGANIZATION' && options.dryRun !== true) {
    assertOrganizationDeclaration(moduleRoot, options.organizationId);
  }

  const report = await registerApplications({
    workspaceRoot,
    environment,
    deploymentProfile: options.deploymentProfile,
    scope: 'all',
    only: ids,
    primaryDomainPattern: options.primaryDomainPattern,
    dryRun: options.dryRun === true,
    reportPath: options.reportPath,
    maxAttempts: options.maxAttempts,
    retryDelayMs: options.retryDelayMs,
    concurrency: options.concurrency,
    anchorKind: options.anchorKind,
    allowUnverifiedIamBinding: options.allowUnverifiedIamBinding,
    registerEnvironments: options.registerEnvironments,
    writeAnchor,
    recordDeployUuid: options.recordDeployUuid,
    regenerateTopologyEnv: options.regenerateTopologyEnv,
    materialize,
    includeServersOnly: options.includeServersOnly,
    ownershipScope,
    ownerUserId,
    organizationId: options.organizationId,
    slugSuffix: options.slugSuffix,
    primaryDomainLabelSuffix: options.primaryDomainLabelSuffix,
    deployOwnerType: options.deployOwnerType,
    ignoreRecordedAnchor: options.ignoreRecordedAnchor === true,
    defaultApplicationType: options.defaultApplicationType,
    defaultPermissionScope: options.defaultPermissionScope,
    deployAppKind: options.deployAppKind,
    fixAppTypes: options.fixAppTypes === true,
    settings,
  });

  if (authMode === 'user' && options.tokenOut && !options.dryRun) {
    const rootId = path.basename(moduleRoot);
    const anchor = (report.entries ?? []).find((entry) => entry.id === rootId && entry.deployApplicationId)?.deployApplicationId
      || (report.entries ?? []).find((entry) => entry.deployApplicationId)?.deployApplicationId;
    if (!anchor) {
      throw new RegistrationConfigurationError('token output requested but the registration returned no anchor');
    }
    let permissionScope = ['iam:self'];
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, APP_MANIFEST_FILE), 'utf8').replace(/^\uFEFF/u, ''));
      if (Array.isArray(manifest?.backend?.accessTokenPermissionScope)
        && manifest.backend.accessTokenPermissionScope.length > 0) {
        permissionScope = manifest.backend.accessTokenPermissionScope;
      }
    } catch {
      // The anchor and owner are enough for the default scope.
    }
    const token = createApplicationAccessToken({
      appId: anchor,
      tenantId: oem.tenantId || userSession.identity.tenantId || '100001',
      organizationId: '0',
      ownershipScope: 'USER',
      userId: ownerUserId,
      environment,
      deploymentProfile: options.deploymentProfile || 'standalone',
      runtimeTarget: options.runtimeTarget || 'browser',
      permissionScope,
    });
    fs.mkdirSync(path.dirname(options.tokenOut), { recursive: true });
    fs.writeFileSync(
      options.tokenOut,
      `SDKWORK_DEPLOY_APPLICATION_ID=${anchor}\nSDKWORK_APPLICATION_OWNERSHIP_SCOPE=USER\nSDKWORK_APPLICATION_OWNER_USER_ID=${ownerUserId}\nSDKWORK_ACCESS_TOKEN=${token}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  if (options.materializeUser === true && !options.dryRun) {
    const anchors = Object.fromEntries(
      (report.entries ?? [])
        .filter((entry) => entry.anchor)
        .map((entry) => [entry.id, entry.anchor]),
    );
    const baseAnchor = anchors[path.basename(moduleRoot)] || '';
    const env = {
      ...process.env,
      SDKWORK_APPLICATION_OWNERSHIP_SCOPE: 'USER',
      SDKWORK_APPLICATION_OWNER_USER_ID: ownerUserId,
      SDKWORK_DEPLOY_APPLICATION_ID: baseAnchor,
      ...Object.fromEntries(
        Object.entries(anchors)
          .filter(([id]) => id.includes('/apps/'))
          .map(([id, anchor]) => [
            `SDKWORK_DEPLOY_APPLICATION_ID_${id.split('/apps/')[1].toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}`,
            anchor,
          ]),
      ),
    };
    spawnSync(process.execPath, [path.join(TOOLS_DIR, 'materialize-client-env.mjs'), '--root', moduleRoot], {
      cwd: moduleRoot,
      encoding: 'utf8',
      env,
      windowsHide: true,
    });
  }

  return {
    report,
    moduleRoot,
    workspaceRoot,
    environment,
    authMode,
    ownershipScope,
    ownerUserId,
    oem,
    userSession: userSession ? { identity: userSession.identity } : null,
  };
}

/**
 * Parse the universal module CLI.
 * @param argv - arguments after the script
 * @returns options
 */
export function assertOrganizationDeclaration(moduleRoot, organizationId) {
  const declarationPath = path.join(path.resolve(moduleRoot), 'etc', 'client-env.materialization.json');
  if (!fs.existsSync(declarationPath)) {
    return;
  }
  const declaration = JSON.parse(fs.readFileSync(declarationPath, 'utf8').replace(/^\uFEFF/u, ''));
  const mismatched = (declaration.surfaces ?? []).filter((surface) => {
    const accessToken = surface?.accessToken;
    if (!accessToken || typeof accessToken !== 'object') {
      return false;
    }
    const declared = trim(accessToken.organizationId) || '0';
    return declared !== String(organizationId);
  });
  if (mismatched.length > 0) {
    throw new RegistrationConfigurationError(
      `ORGANIZATION materialization requires accessToken.organizationId=${organizationId}; `
      + `these surfaces declare another value: ${mismatched.map((surface) => surface.id).join(', ')}`,
    );
  }
}

export function auditModule(moduleRoot, workspaceRoot = '') {
  const root = path.resolve(moduleRoot);
  const inventory = buildRegistrationInventory({
    workspaceRoot: resolveModuleWorkspace(root, workspaceRoot),
  });
  const wanted = new Set(moduleRegistrationIds(root));
  const entries = (inventory.entries ?? []).filter((entry) => wanted.has(entry.id)).map((entry) => ({
    id: entry.id,
    appType: entry.appType ?? '',
    canonicalAppType: entry.canonicalAppType ?? '',
    applicationType: entry.applicationType ?? '',
    deployAppKind: entry.deployAppKind ?? '',
    deployAppKindSource: entry.deployAppKindSource ?? '',
    surfaceDefects: entry.surfaceDefects ?? [],
    surfaceNotes: entry.surfaceNotes ?? [],
    surfaceNameWarning: entry.surfaceNameWarning ?? '',
    tokenCarrier: entry.tokenCarrier?.kind ?? '',
    permissionScopeRequirement: entry.permissionScopeRequirement?.kind ?? '',
    serversOnly: entry.serversOnly === true,
    environments: Object.fromEntries(
      Object.entries(entry.environments ?? {}).map(([environment, facts]) => [
        environment,
        {
          domain: facts.domain ?? '',
          domainSource: facts.domainSource ?? '',
          anchorSinks: facts.anchorSinks ?? [],
        },
      ]),
    ),
  }));
  return {
    moduleRoot: root,
    workspaceRoot: resolveModuleWorkspace(root, workspaceRoot),
    counts: {
      roots: entries.length,
      clientCarriers: entries.filter((entry) => entry.tokenCarrier === 'client-env-materializer').length,
      serversOnly: entries.filter((entry) => entry.serversOnly).length,
      missingApplicationType: entries.filter((entry) => !entry.applicationType).length,
      missingDeployAppKind: entries.filter((entry) => !entry.deployAppKind).length,
      surfaceDefects: entries.reduce((total, entry) => total + entry.surfaceDefects.length, 0),
      scopeRequired: entries.filter((entry) => entry.permissionScopeRequirement === 'required').length,
      scopeMaterialized: entries.filter((entry) => entry.permissionScopeRequirement === 'materialized').length,
      missingClientEnv: entries.filter((entry) => entry.permissionScopeRequirement === 'missingClientEnvConfiguration').length,
    },
    entries,
  };
}

export function parseArgs(argv) {
  const options = {
    moduleRoot: process.cwd(),
    workspaceRoot: '',
    environment: '',
    auth: 'operator',
    only: [],
    dryRun: false,
    reportPath: '',
    json: false,
    maxAttempts: 5,
    retryDelayMs: 500,
    concurrency: 2,
    help: false,
  };
  const valueOf = (index, name) => {
    const value = trim(argv[index + 1]);
    if (!value) {
      throw new RegistrationConfigurationError(`${name} requires a value`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--module-root':
        options.moduleRoot = path.resolve(valueOf(index, arg));
        index += 1;
        break;
      case '--workspace':
        options.workspaceRoot = path.resolve(valueOf(index, arg));
        index += 1;
        break;
      case '--environment':
        options.environment = valueOf(index, arg);
        index += 1;
        break;
      case '--auth':
        options.auth = valueOf(index, arg);
        index += 1;
        break;
      case '--slug-suffix':
        options.slugSuffix = valueOf(index, arg);
        index += 1;
        break;
      case '--domain-label-suffix':
        options.primaryDomainLabelSuffix = valueOf(index, arg);
        index += 1;
        break;
      case '--ownership':
        options.ownership = valueOf(index, arg);
        index += 1;
        break;
      case '--default-app-type':
        options.defaultApplicationType = valueOf(index, arg);
        index += 1;
        break;
      case '--deploy-app-kind':
        options.deployAppKind = valueOf(index, arg);
        index += 1;
        break;
      case '--fix-app-types':
        options.fixAppTypes = true;
        break;
      case '--default-permission-scope':
        options.defaultPermissionScope = valueOf(index, arg).split(',').map((entry) => entry.trim()).filter(Boolean);
        index += 1;
        break;
      case '--only':
        options.only.push(valueOf(index, arg));
        index += 1;
        break;
      case '--deployment-profile':
        options.deploymentProfile = valueOf(index, arg);
        index += 1;
        break;
      case '--primary-domain':
      case '--domain-pattern':
        options.primaryDomainPattern = valueOf(index, arg);
        index += 1;
        break;
      case '--api-domain':
        options.apiDomain = valueOf(index, arg);
        index += 1;
        break;
      case '--deploy-base-url':
        options.deployBaseUrl = valueOf(index, arg);
        index += 1;
        break;
      case '--iam-base-url':
        options.iamBaseUrl = valueOf(index, arg);
        index += 1;
        break;
      case '--iam-transport':
        options.iamTransport = valueOf(index, arg);
        index += 1;
        break;
      case '--brand':
        options.brand = valueOf(index, arg);
        index += 1;
        break;
      case '--domain-suffix':
        options.domainSuffix = valueOf(index, arg);
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
      case '--oem-config':
        options.oemConfig = JSON.parse(fs.readFileSync(path.resolve(valueOf(index, arg)), 'utf8'));
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
      case '--operator-username':
        options.operatorUsername = valueOf(index, arg);
        index += 1;
        break;
      case '--operator-password':
        options.operatorPassword = valueOf(index, arg);
        index += 1;
        break;
      case '--operator-auth-token':
        options.operatorAuthToken = valueOf(index, arg);
        index += 1;
        break;
      case '--app-id':
        options.appId = valueOf(index, arg);
        index += 1;
        break;
      case '--user-access-token':
        options.userAccessToken = valueOf(index, arg);
        index += 1;
        break;
      case '--user-auth-token':
        options.userAuthToken = valueOf(index, arg);
        index += 1;
        break;
      case '--access-token':
        options.accessToken = valueOf(index, arg);
        index += 1;
        break;
      case '--owner-user-id':
        options.ownerUserId = valueOf(index, arg);
        index += 1;
        break;
      case '--device-id':
        options.deviceId = valueOf(index, arg);
        index += 1;
        break;
      case '--materialize-user':
        options.materializeUser = true;
        break;
      case '--token-out':
        options.tokenOut = path.resolve(valueOf(index, arg));
        index += 1;
        break;
      case '--no-write-anchor':
        options.writeAnchor = false;
        break;
      case '--no-materialize':
        options.materialize = false;
        break;
      case '--audit':
        options.audit = true;
        break;
      case '--include-servers-only':
        options.includeServersOnly = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--report':
        options.reportPath = path.resolve(valueOf(index, arg));
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
        throw new RegistrationConfigurationError(`unsupported option: ${arg}`);
    }
  }
  return options;
}

const HELP = `register-module — register every application of one module

Usage:
  node sdkwork-specs/tools/register-module.mjs [options]

Module selection:
  --module-root <dir>      Module repository root (default: cwd)
  --workspace <dir>        Workspace root containing the module (default: parent)
  --only <id>              Register one inventory id (repeatable); default: every root
  --environment <name>     development|test|staging|demo|production
  --deployment-profile <p> standalone|cloud
  --primary-domain <pat>   Domain pattern; supports {env}, {slug}, {app}, {brand}, {suffix}

Identity:
  --auth operator|user     operator (TENANT) or user (USER-owned self-publish)
  --ownership tenant|organization|user
                           Ownership override; organization requires a non-zero organizationId
  --default-app-type <t>   Fallback IAM applicationType for a manifest without app.appType
  --deploy-app-kind <kind> Explicit deploy application kind for a genuinely multi-surface root;
                           otherwise derived from runtime.family/framework, clientArchitectures,
                           and publish.platforms (a root without one provable surface fails)
  --fix-app-types          Write a derived app.appType back when the declared value contradicts
                           the proven surface (e.g. APP_HTML on a Flutter root)
  --default-permission-scope <csv>
                           Fallback scope for a manifest without accessTokenPermissionScope
  --audit                  Print the module inventory classification and exit
  --username/--password    Credential for the selected auth mode
  --operator-username/--operator-password
                           IAM enable credential for --auth user
  --user-access-token/--user-auth-token
                           Existing user session pair for --auth user
  --access-token <token>   Public app token used as the login Access-Token
  --owner-user-id <id>     Owner of the USER installation (default: session user_id)
  --slug-suffix <suffix>   Deploy slug suffix (default for USER: -u<ownerUserId>)
  --domain-label-suffix <s> First-label suffix for the primary domain (USER default: -u<ownerUserId>)
  --device-id <id>         Session device id (default: sdkwork-module-registration)

OEM / cluster:
  --api-domain <host>      One gateway origin for Deploy + IAM
  --deploy-base-url <url>  Explicit Deploy app-api origin
  --iam-base-url <url>     Explicit IAM backend origin
  --iam-transport <mode>    auto (default) | canonical | legacy for IAM lifecycle routes
  --brand <name>           {brand} replacement
  --domain-suffix <suffix> Default domain pattern {app}.{env}.{suffix}
  --oem-config <file>      JSON with apiDomain/brand/domainSuffix/domainPattern/tenantId
  --tenant-id/--organization-id

Output:
  --dry-run                Plan only
  --report <path>          Write the JSON report
  --token-out <path>       Write a USER token + anchor to a file (auth user)
  --materialize-user       Write USER-scoped anchors and tokens into the module
  --no-write-anchor        Do not write anchors
  --no-materialize         Do not rewrite profile tokens
  --json                   Print the report as JSON
  --help
`;

/**
 * CLI entrypoint.
 * @param argv - arguments after the script
 * @returns exit code
 */
export async function runMain(argv) {
  let options;
  try {
    options = parseModuleArgs(argv);
  } catch (error) {
    console.error(`register-module: ${error.message}`);
    return 2;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (options.audit) {
    try {
      const audit = auditModule(options.moduleRoot, options.workspaceRoot);
      console.log(JSON.stringify(audit, null, 2));
      return 0;
    } catch (error) {
      console.error(`register-module audit: ${error.message}`);
      return 1;
    }
  }
  try {
    const { report } = await registerModule(options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const counts = report.counts ?? {};
      console.log(
        `register-module ${options.auth}: planned=${counts.planned ?? 0} created=${counts.created ?? 0} `
        + `reused=${counts.reused ?? 0} failed=${counts.failed ?? 0} invalid=${counts.invalid ?? 0} `
        + `environmentsActive=${counts.environmentsActive ?? 0} anchorWritten=${counts.anchorWritten ?? 0} `
        + `materialized=${counts.materialized ?? 0}`,
      );
      for (const failure of report.entries ?? []) {
        if (failure.status === 'failed') {
          console.error(`  failed: ${failure.id} :: ${failure.error ?? 'unknown error'}`);
        }
      }
    }
    return report.counts?.failed > 0 || report.counts?.invalid > 0 ? 1 : 0;
  } catch (error) {
    console.error(`register-module: ${error.message}`);
    return 1;
  }
}

export const parseModuleArgs = parseArgs;

export { buildRegistrationInventory };
