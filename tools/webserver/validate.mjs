// Validation for deployments/webserver/server.toml per SDKWORK_WEBSERVER_SPEC.md.
// Enforces the W1-W26 rules plus the canonical nginx conf render (W16 sidecar).

import fs from 'node:fs';
import path from 'node:path';

import { parseTomlSubset, TomlSubsetError } from './toml.mjs';
import { mergeConfigs } from './merge.mjs';
import {
  DEPLOYMENT_PROFILES,
  ENVIRONMENT_FILE_NAMES,
  LIFECYCLE_ENVIRONMENTS,
  LAYOUT_V3_FILES,
  mergeEffective,
  sidecarFileName,
} from './layout-v3.mjs';
import { applyAdaptiveWebFolding } from './adaptive-web.mjs';
import { GATEWAY_SNIPPET_PATHS } from './gateway-snippets.mjs';
import { ADAPTIVE_SNIPPET_PATHS } from './adaptive-web-snippets.mjs';
import { moduleUsesAdaptiveWebEdge, isEdgeProxyOnlyModule } from './expose-mode.mjs';
import { retiredNginxDiagnostics, retiredNginxKeys } from './retired-nginx.mjs';
import { isPublicHostCompliant, normalizeHost, PLATFORM_GATEWAY_ROLE, baseDomainFromHost } from './host-registry.mjs';
import { isRetiredCertPath, isSdkworkLetsencryptCertPath } from './cert-paths.mjs';

export { TomlSubsetError };

let yaml = null;
try {
  ({ default: yaml } = await import('js-yaml'));
} catch {
  yaml = null;
}

const ROOT_KEYS = new Set([
  'specVersion', 'kind', 'id', 'enabled', 'description', 'profile', 'environment', 'nginx', 'main', 'http', 'stream',
]);
const NGINX_KEYS = new Set(['enabled', 'profile', 'unknownDirectivePolicy', 'exceptionRef', 'strict', 'confFile']);
const MAIN_KEYS = new Set(['user', 'workerProcesses', 'workerRlimitNofile', 'pid', 'errorLog', 'include', 'raw', 'events']);
const EVENTS_KEYS = new Set(['workerConnections', 'use', 'acceptMutex', 'multiAccept', 'raw']);
const HTTP_KEYS = new Set([
  'sendfile', 'tcpNopush', 'tcpNodelay', 'keepaliveTimeout', 'keepaliveRequests',
  'clientMaxBodySize', 'clientBodyTimeout', 'clientHeaderTimeout', 'clientBodyBufferSize',
  'clientHeaderBufferSize', 'largeClientHeaderBuffers', 'resetTimedoutConnection', 'sendTimeout',
  'serverNamesHashMaxSize', 'serverTokens', 'defaultType',
  'logFormat', 'accessLog', 'gzip', 'gzipTypes', 'gzipMinLength', 'map', 'limitReqZone', 'include', 'raw',
  'defaults', 'certificates', 'upstream', 'server',
]);
const DEFAULTS_KEYS = new Set(['tls']);
const CERT_KEYS = new Set(['certFile', 'certKeyFile', 'chainFile', 'ocspStapling', 'acme']);
const UPSTREAM_KEYS = new Set(['name', 'loadBalancing', 'hashKey', 'keepalive', 'keepaliveTimeout', 'raw', 'target']);
const TARGET_KEYS = new Set(['address', 'weight', 'maxFails', 'failTimeout', 'backup', 'down', 'resolve', 'raw']);
const SERVER_KEYS = new Set([
  'listen', 'serverName', 'http2', 'root', 'index', 'tryFiles', 'charset', 'errorPage',
  'returnStatus', 'returnBody', 'gzip', 'include', 'raw', 'tls', 'location',
]);
const TLS_KEYS = new Set([
  'cert', 'certFile', 'certKeyFile', 'chainFile', 'protocols', 'ciphers', 'preferServerCiphers',
  'sessionCache', 'sessionTimeout', 'sessionTickets', 'stapling', 'staplingVerify',
  'clientCertificate', 'clientCertificateCA', 'verifyDepth', 'dhparam', 'ecdhCurve', 'raw',
]);
const LOCATION_KEYS = new Set([
  'match', 'proxyPass', 'proxySetHeader', 'proxyHttpVersion', 'proxyBuffering', 'proxyBufferSize',
  'proxyConnectTimeout', 'proxyReadTimeout', 'proxySendTimeout', 'proxyWebsocketUpgrade',
  'proxyRedirect', 'proxyInterceptErrors', 'proxyNextUpstream', 'proxyHideHeader',
  'proxyRequestBuffering', 'proxyMethod', 'authBasic', 'authBasicUserFile', 'limitReq',
  'addHeader', 'allow', 'deny', 'limitRate', 'rewrite', 'etag', 'disableSymlinks', 'logNotFound',
  'sendfileMaxChunk', 'root', 'alias', 'index', 'tryFiles', 'autoindex', 'expires',
  'returnStatus', 'returnBody', 'include', 'raw',
]);
const STREAM_KEYS = new Set(['raw', 'server']);
const STREAM_SERVER_KEYS = new Set(['listen', 'proxyPass', 'proxyTimeout', 'proxyProtocol', 'raw']);

const LISTEN_PATTERN = /^(unix:.+|\[[0-9A-Fa-f:]+\]:\d+|[0-9A-Za-z.-]+:\d+|\d+)(\s+(ssl|http2|proxy_protocol|reuseport|default_server|so_keepalive))*$/u;
const SERVER_NAME_PATTERN = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/u;
const MATCH_PATTERN = /^(= |\^~ |~ |~\* |\/)/u;
const ADDRESS_PATTERN = /^(unix:.+|\[[0-9A-Fa-f:]+\]:\d+|[A-Za-z0-9.-]+:\d+)$/u;
const RAW_STATEMENT = /^[A-Za-z_][A-Za-z0-9_-]*(\s+[^;{}]*)?;$/u;

const LOAD_BALANCING = new Set(['round-robin', 'least-connections', 'ip-hash', 'random', 'hash']);
const PLACEHOLDER_PORTS = new Set([8080, 8000]);

function push(errors, pathText, message) {
  errors.push(`${pathText}: ${message}`);
}

function pushWarn(warnings, pathText, message) {
  warnings.push(`${pathText}: ${message}`);
}

function checkUnknownKeys(keys, obj, pathText, errors, warnings, ctx, skipKeys = undefined) {
  const { policy, exceptionRef } = ctx;
  for (const key of Object.keys(obj)) {
    if (keys.has(key)) continue;
    if (skipKeys && skipKeys.has(key)) continue;
    const message = `unknown key "${key}" in ${pathText}`;
    if (policy === 'error' || policy === undefined) push(errors, pathText, message);
    else if (policy === 'warn') pushWarn(warnings, pathText, message);
  }
  if (policy === 'allow' && !exceptionRef) {
    push(errors, 'nginx', 'unknownDirectivePolicy "allow" requires exceptionRef');
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTls(tls, http, pathText, errors, warnings, ctx) {
  if (!isPlainObject(tls)) {
    push(errors, pathText, 'must be a table');
    return;
  }
  checkUnknownKeys(TLS_KEYS, tls, pathText, errors, warnings, ctx);
  const hasCertRef = tls.cert !== undefined;
  const hasDirectFiles = tls.certFile !== undefined || tls.certKeyFile !== undefined;
  if (hasCertRef && hasDirectFiles) {
    push(errors, `${pathText}.cert`, 'cert and certFile/certKeyFile are mutually exclusive');
  }
  if (hasCertRef) {
    const certs = http?.certificates ?? {};
    if (!isPlainObject(certs[tls.cert])) {
      push(errors, `${pathText}.cert`, `references undefined certificate "${tls.cert}"`);
    }
  }
  for (const proto of tls.protocols ?? []) {
    if (proto === 'TLSv1' || proto === 'TLSv1.1') {
      push(errors, `${pathText}.protocols`, `legacy protocol "${proto}" is not allowed`);
    }
  }
  if ((tls.clientCertificate === 'on' || tls.clientCertificate === true) && !tls.clientCertificateCA) {
    push(errors, `${pathText}.clientCertificate`, 'requires clientCertificateCA when enabled');
  }
}

function validateCertificate(cert, pathText, errors, warnings, ctx) {
  if (!isPlainObject(cert)) {
    push(errors, pathText, 'must be a table');
    return;
  }
  checkUnknownKeys(CERT_KEYS, cert, pathText, errors, warnings, ctx);
  const hasAcme = cert.acme !== undefined;
  const hasFiles = cert.certFile !== undefined || cert.certKeyFile !== undefined;
  if (hasAcme && hasFiles) {
    push(errors, pathText, 'acme and certFile/certKeyFile are mutually exclusive');
  }
  if (!hasAcme && (!cert.certFile || !cert.certKeyFile)) {
    push(errors, pathText, 'requires certFile and certKeyFile, or acme');
  }
  for (const fileKey of ['certFile', 'certKeyFile', 'chainFile']) {
    const value = cert[fileKey];
    if (value === undefined) continue;
    if (typeof value !== 'string' || (!value.startsWith('/') && !value.startsWith('secret://'))) {
      push(errors, `${pathText}.${fileKey}`, 'must be an absolute path or secret:// reference');
      continue;
    }
    if (isRetiredCertPath(value)) {
      push(errors, `${pathText}.${fileKey}`, `retired certificate path; use /etc/sdkwork/certs/letsencrypt/<cert-name>/ (W25)`);
    } else if (
      !hasAcme
      && !value.startsWith('secret://')
      && value.includes('/letsencrypt/')
      && !isSdkworkLetsencryptCertPath(value)
    ) {
      push(errors, `${pathText}.${fileKey}`, `certificate path must use /etc/sdkwork/certs/letsencrypt/<cert-name>/ (W25)`);
    }
  }
}

function validateUpstreams(http, errors, warnings, ctx) {
  const names = new Set();
  for (const [index, upstream] of (http.upstream ?? []).entries()) {
    const pathText = `http.upstream[${index}]`;
    if (!isPlainObject(upstream)) {
      push(errors, pathText, 'must be a table');
      continue;
    }
    checkUnknownKeys(UPSTREAM_KEYS, upstream, pathText, errors, warnings, ctx);
    if (typeof upstream.name !== 'string' || !/^[a-z][a-z0-9_-]*$/u.test(upstream.name)) {
      push(errors, `${pathText}.name`, 'must match ^[a-z][a-z0-9_-]*$');
    } else if (names.has(upstream.name)) {
      push(errors, `${pathText}.name`, `duplicate upstream name "${upstream.name}"`);
    } else {
      names.add(upstream.name);
    }
    if (upstream.loadBalancing !== undefined && !LOAD_BALANCING.has(upstream.loadBalancing)) {
      push(errors, `${pathText}.loadBalancing`, `must be one of ${[...LOAD_BALANCING].join(', ')}`);
    }
    if (upstream.loadBalancing === 'hash' && (typeof upstream.hashKey !== 'string' || !upstream.hashKey.trim())) {
      push(errors, `${pathText}.hashKey`, 'is required when loadBalancing = "hash"');
    }
    if (upstream.loadBalancing !== 'hash' && upstream.hashKey !== undefined) {
      push(errors, `${pathText}.hashKey`, 'is allowed only when loadBalancing = "hash"');
    }
    if (!Array.isArray(upstream.target) || upstream.target.length === 0) {
      push(errors, `${pathText}.target`, 'must declare at least one target');
      continue;
    }
    let liveTargets = 0;
    for (const [targetIndex, target] of upstream.target.entries()) {
      const targetPath = `${pathText}.target[${targetIndex}]`;
      if (!isPlainObject(target)) {
        push(errors, targetPath, 'must be a table');
        continue;
      }
      checkUnknownKeys(TARGET_KEYS, target, targetPath, errors, warnings, ctx);
      if (typeof target.address !== 'string' || !ADDRESS_PATTERN.test(target.address)) {
        push(errors, `${targetPath}.address`, 'must be host:port, [ipv6]:port, or unix:path');
      } else if (!target.down) {
        liveTargets += 1;
      }
      if (target.raw !== undefined && typeof target.raw !== 'string') {
        push(errors, `${targetPath}.raw`, 'must be a string');
      }
    }
    if (liveTargets === 0) {
      push(errors, pathText, 'must have at least one target that is not down');
    }
  }
  return names;
}

function validateLocation(location, serverIndex, locationIndex, errors, warnings, ctx) {
  const pathText = `http.server[${serverIndex}].location[${locationIndex}]`;
  if (!isPlainObject(location)) {
    push(errors, pathText, 'must be a table');
    return;
  }
  checkUnknownKeys(LOCATION_KEYS, location, pathText, errors, warnings, ctx);
  if (typeof location.match !== 'string' || !location.match.trim()) {
    push(errors, `${pathText}.match`, 'is required');
  } else if (!MATCH_PATTERN.test(location.match)) {
    push(errors, `${pathText}.match`, 'must start with /, = /, ^~ /, ~ , or ~* ');
  }
  const behaviors = ['proxyPass', 'root', 'alias', 'returnStatus', 'include'].filter(
    (k) => location[k] !== undefined,
  );
  if (behaviors.length > 1) {
    push(errors, pathText, `serving behaviors ${behaviors.join(', ')} are mutually exclusive`);
  }
  if (location.include !== undefined) {
    if (!Array.isArray(location.include) || location.include.length === 0) {
      push(errors, `${pathText}.include`, 'must be a non-empty string array');
    } else {
      for (const [i, entry] of location.include.entries()) {
        if (typeof entry !== 'string' || !entry.trim()) {
          push(errors, `${pathText}.include[${i}]`, 'must be a non-empty string');
        } else if (/\$[A-Za-z_]/.test(entry)) {
          push(
            errors,
            `${pathText}.include[${i}]`,
            'variable include paths are forbidden; use Adaptive Web named-location dispatch (SDKWORK_DEPLOY_SPEC.md §8.1)',
          );
        }
      }
    }
  }
  if (location.proxyPass !== undefined && typeof location.proxyPass !== 'string') {
    push(errors, `${pathText}.proxyPass`, 'must be a string');
  }
  if (location.returnBody !== undefined && location.returnStatus === undefined) {
    push(errors, `${pathText}.returnBody`, 'requires returnStatus');
  }
  if (location.alias !== undefined && typeof location.alias === 'string' && !location.alias.endsWith('/')) {
    push(errors, `${pathText}.alias`, 'directory aliases must end with /');
  }
  if (location.authBasic !== undefined) {
    if (typeof location.authBasic !== 'string' || location.authBasic.trim() === '') {
      push(errors, `${pathText}.authBasic`, 'must be a non-empty string');
    } else if (location.authBasic.trim().toLowerCase() !== 'off' && location.authBasicUserFile === undefined) {
      push(errors, `${pathText}.authBasic`, 'requires authBasicUserFile');
    }
  }
  if (location.authBasicUserFile !== undefined && location.authBasic === undefined) {
    push(errors, `${pathText}.authBasicUserFile`, 'requires authBasic');
  }
}

function validateServers(http, errors, warnings, upstreamNames, ctx) {
  const seenServerNames = new Set();
  for (const [index, server] of (http.server ?? []).entries()) {
    const pathText = `http.server[${index}]`;
    if (!isPlainObject(server)) {
      push(errors, pathText, 'must be a table');
      continue;
    }
    checkUnknownKeys(SERVER_KEYS, server, pathText, errors, warnings, ctx);
    if (!Array.isArray(server.listen) || server.listen.length === 0) {
      push(errors, `${pathText}.listen`, 'is required');
    } else {
      for (const [listenIndex, listen] of server.listen.entries()) {
        if (typeof listen !== 'string' || !LISTEN_PATTERN.test(listen)) {
          push(errors, `${pathText}.listen[${listenIndex}]`, `invalid listen value "${listen}"`);
        }
      }
    }
    const hasSslListen = (server.listen ?? []).some((l) => typeof l === 'string' && /\bssl\b/u.test(l));
    if (hasSslListen && server.tls === undefined) {
      push(errors, `${pathText}.tls`, 'required when a listen entry uses ssl');
    }
    if (!Array.isArray(server.serverName) || server.serverName.length === 0) {
      push(errors, `${pathText}.serverName`, 'is required');
    } else {
      for (const name of server.serverName) {
        if (typeof name !== 'string' || !SERVER_NAME_PATTERN.test(name)) {
          push(errors, `${pathText}.serverName`, `invalid server name "${name}"`);
        } else if (seenServerNames.has(name)) {
          push(errors, `${pathText}.serverName`, `duplicate server name "${name}" across virtual hosts`);
        } else {
          seenServerNames.add(name);
        }
      }
    }
    if (server.returnBody !== undefined && server.returnStatus === undefined) {
      push(errors, `${pathText}.returnBody`, 'requires returnStatus');
    }
    if (server.tls !== undefined) {
      validateTls(server.tls, http, `${pathText}.tls`, errors, warnings, ctx);
    }
    if (server.include !== undefined) {
      if (!Array.isArray(server.include) || server.include.length === 0) {
        push(errors, `${pathText}.include`, 'must be a non-empty string array');
      } else {
        for (const [includeIndex, entry] of server.include.entries()) {
          if (typeof entry !== 'string' || !entry.trim()) {
            push(errors, `${pathText}.include[${includeIndex}]`, 'must be a non-empty string');
          } else if (/\$|\*/u.test(entry)) {
            push(errors, `${pathText}.include[${includeIndex}]`, 'variable include paths are forbidden');
          }
        }
      }
    }
    for (const [locationIndex, location] of (server.location ?? []).entries()) {
      validateLocation(location, index, locationIndex, errors, warnings, ctx);
      if (location.proxyPass !== undefined && typeof location.proxyPass === 'string') {
        const target = location.proxyPass;
        if (/^https?:\/\/[A-Za-z0-9_-]+$/u.test(target) && !upstreamNames.has(target.slice(target.indexOf('//') + 2))) {
          push(errors, `${pathText}.location[${locationIndex}].proxyPass`, `references undefined upstream "${target}"`);
        } else {
          const portMatch = /^https?:\/\/[^:/]+:(\d+)/u.exec(target);
          if (portMatch && PLACEHOLDER_PORTS.has(Number(portMatch[1]))) {
            pushWarn(warnings, `${pathText}.location[${locationIndex}].proxyPass`, `placeholder port ${portMatch[1]} in "${target}"`);
          }
        }
      }
    }
  }
}

function validateStream(stream, errors, warnings, ctx) {
  if (!isPlainObject(stream)) {
    push(errors, 'stream', 'must be a table');
    return;
  }
  checkUnknownKeys(STREAM_KEYS, stream, 'stream', errors, warnings, ctx);
  for (const [index, server] of (stream.server ?? []).entries()) {
    const pathText = `stream.server[${index}]`;
    if (!isPlainObject(server)) {
      push(errors, pathText, 'must be a table');
      continue;
    }
    checkUnknownKeys(STREAM_SERVER_KEYS, server, pathText, errors, warnings, ctx);
    if (!Array.isArray(server.listen) || server.listen.length === 0) {
      push(errors, `${pathText}.listen`, 'is required');
    }
    if (typeof server.proxyPass !== 'string' || !server.proxyPass.trim()) {
      push(errors, `${pathText}.proxyPass`, 'is required');
    }
  }
}

function validateRawEntries(raw, pathText, errors, warnings) {
  if (!Array.isArray(raw)) {
    push(errors, pathText, 'must be an array of strings');
    return;
  }
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'string') {
      push(errors, `${pathText}[${index}]`, 'must be a string');
    } else if (!RAW_STATEMENT.test(entry.trim())) {
      push(errors, `${pathText}[${index}]`, `"${entry}" is not a single nginx directive statement (name args...;)`);
    }
  }
}

function collectRaw(doc, errors, warnings) {
  const rawAt = (value, pathText) => {
    if (value !== undefined) validateRawEntries(value, pathText, errors, warnings);
  };
  rawAt(doc.main?.raw, 'main.raw');
  rawAt(doc.main?.events?.raw, 'main.events.raw');
  rawAt(doc.http?.raw, 'http.raw');
  rawAt(doc.stream?.raw, 'stream.raw');
  for (const [index, upstream] of (doc.http?.upstream ?? []).entries()) {
    rawAt(upstream.raw, `http.upstream[${index}].raw`);
  }
  for (const [index, server] of (doc.http?.server ?? []).entries()) {
    rawAt(server.raw, `http.server[${index}].raw`);
    rawAt(server.tls?.raw, `http.server[${index}].tls.raw`);
    for (const [locationIndex, location] of (server.location ?? []).entries()) {
      rawAt(location.raw, `http.server[${index}].location[${locationIndex}].raw`);
    }
  }
  for (const [index, server] of (doc.stream?.server ?? []).entries()) {
    rawAt(server.raw, `stream.server[${index}].raw`);
  }
}

function checkSecrets(doc, errors) {
  const scan = (value, pathText) => {
    if (typeof value === 'string') {
      if (value.includes('-----BEGIN')) {
        push(errors, pathText, 'inline private key material is forbidden (use file paths or secret://)');
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => scan(item, `${pathText}[${i}]`));
    } else if (isPlainObject(value)) {
      for (const [key, item] of Object.entries(value)) scan(item, `${pathText}.${key}`);
    }
  };
  scan(doc, 'server.toml');
}

/**
 * All typed keys of the standard (contexts + `[nginx]` metadata). Exported
 * for the anti-drift alignment test.
 */
export const TYPED_KEYS = new Set([
  ...MAIN_KEYS, ...EVENTS_KEYS, ...HTTP_KEYS, ...CERT_KEYS, ...UPSTREAM_KEYS,
  ...TARGET_KEYS, ...SERVER_KEYS, ...TLS_KEYS, ...LOCATION_KEYS,
  ...STREAM_KEYS, ...STREAM_SERVER_KEYS,
]);

/**
 * Validate a parsed server.toml document.
 * @param {object} doc parsed TOML
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateWebserverToml(doc) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(doc)) {
    push(errors, 'server.toml', 'must be a TOML table');
    return { errors, warnings };
  }

  for (const retired of retiredNginxDiagnostics(doc)) {
    push(errors, retired.path, retired.message);
  }

  const policy = doc.nginx?.unknownDirectivePolicy ?? 'error';
  const exceptionRef = doc.nginx?.exceptionRef;
  const ctx = { policy, exceptionRef };

  checkUnknownKeys(ROOT_KEYS, doc, 'server.toml', errors, warnings, ctx, new Set(['compatibility']));
  if (doc.specVersion !== 1) push(errors, 'specVersion', 'must be 1');
  if (doc.kind !== 'sdkwork.webserver.server') {
    push(errors, 'kind', 'must be "sdkwork.webserver.server"');
  }
  if (typeof doc.id !== 'string' || !/^[a-z][a-z0-9_-]*$/u.test(doc.id)) {
    push(errors, 'id', 'must match ^[a-z][a-z0-9_-]*$ (module runtimeCode)');
  }

  if (policy !== undefined && !['error', 'warn', 'allow'].includes(policy)) {
    push(errors, 'nginx.unknownDirectivePolicy', 'must be error, warn, or allow');
  }
  if (doc.nginx?.strict === false && !exceptionRef) {
    push(errors, 'nginx.strict', 'false requires exceptionRef');
  }
  if (doc.nginx !== undefined) {
    checkUnknownKeys(NGINX_KEYS, doc.nginx, 'nginx', errors, warnings, ctx, retiredNginxKeys(doc));
  }

  const enabled = doc.enabled !== false;
  const hasHttpServer = Array.isArray(doc.http?.server) && doc.http.server.length > 0;
  const hasStreamServer = Array.isArray(doc.stream?.server) && doc.stream.server.length > 0;

  if (!enabled) {
    if (typeof doc.description !== 'string' || !doc.description.trim()) {
      push(errors, 'description', 'is required when enabled = false');
    }
    if (hasHttpServer || hasStreamServer) {
      push(errors, 'server.toml', 'enabled = false must not declare http/stream servers');
    }
  } else if (!hasHttpServer && !hasStreamServer) {
    push(errors, 'server.toml', 'enabled = true requires at least one [[http.server]] or [[stream.server]]');
  }

  if (doc.main !== undefined) {
    if (!isPlainObject(doc.main)) {
      push(errors, 'main', 'must be a table');
    } else {
      checkUnknownKeys(MAIN_KEYS, doc.main, 'main', errors, warnings, ctx);
      if (doc.main.events !== undefined) {
        if (!isPlainObject(doc.main.events)) {
          push(errors, 'main.events', 'must be a table');
        } else {
          checkUnknownKeys(EVENTS_KEYS, doc.main.events, 'main.events', errors, warnings, ctx);
          if (doc.main.events.workerConnections === undefined) {
            push(errors, 'main.events.workerConnections', 'is required when [main.events] exists');
          }
        }
      }
    }
  }

  if (doc.http !== undefined) {
    if (!isPlainObject(doc.http)) {
      push(errors, 'http', 'must be a table');
    } else {
      checkUnknownKeys(HTTP_KEYS, doc.http, 'http', errors, warnings, ctx);
      if (doc.http.defaults !== undefined) {
        if (!isPlainObject(doc.http.defaults)) {
          push(errors, 'http.defaults', 'must be a table');
        } else {
          checkUnknownKeys(DEFAULTS_KEYS, doc.http.defaults, 'http.defaults', errors, warnings, ctx);
          if (doc.http.defaults.tls !== undefined) {
            validateTls(doc.http.defaults.tls, doc.http, 'http.defaults.tls', errors, warnings, ctx);
          }
        }
      }
      for (const [name, cert] of Object.entries(doc.http.certificates ?? {})) {
        validateCertificate(cert, `http.certificates.${name}`, errors, warnings, ctx);
      }
      const upstreamNames = validateUpstreams(doc.http, errors, warnings, ctx);
      validateServers(doc.http, errors, warnings, upstreamNames, ctx);
    }
  }

  if (doc.stream !== undefined) {
    validateStream(doc.stream, errors, warnings, ctx);
  }

  collectRaw(doc, errors, warnings);
  checkSecrets(doc, errors);

  return { errors, warnings };
}

/**
 * Render the canonical nginx configuration for a parsed server.toml document
 * (fixed rendering order, section 4.3 of the standard).
 * @param {object} doc parsed effective configuration
 * @param {{profile?: string}} [options] profile name for the generated header
 * @returns {string}
 */
export function renderNginxConf(doc, options = {}) {
  const lines = [
    `# Generated by the SDKWork web server standard (SDKWORK_WEBSERVER_SPEC.md)`,
    `# from server.common.toml${options.profile ? ` + server.${options.profile}.toml` : ''}; do not edit by hand.`,
  ];
  const main = doc.main ?? {};
  if (main.user !== undefined) lines.push(`user ${main.user};`);
  if (main.workerProcesses !== undefined) lines.push(`worker_processes ${main.workerProcesses};`);
  if (main.workerRlimitNofile !== undefined) lines.push(`worker_rlimit_nofile ${main.workerRlimitNofile};`);
  if (main.pid !== undefined) lines.push(`pid ${main.pid};`);
  if (main.errorLog !== undefined) lines.push(`error_log ${main.errorLog};`);
  for (const inc of main.include ?? []) lines.push(`include ${inc};`);
  for (const raw of main.raw ?? []) lines.push(raw);
  if (main.events !== undefined) {
    lines.push('events {');
    const ev = main.events;
    if (ev.workerConnections !== undefined) lines.push(`    worker_connections ${ev.workerConnections};`);
    if (ev.use !== undefined) lines.push(`    use ${ev.use};`);
    if (ev.acceptMutex !== undefined) lines.push(`    accept_mutex ${ev.acceptMutex ? 'on' : 'off'};`);
    if (ev.multiAccept !== undefined) lines.push(`    multi_accept ${ev.multiAccept ? 'on' : 'off'};`);
    for (const raw of ev.raw ?? []) lines.push(`    ${raw}`);
    lines.push('}');
  }

  const http = doc.http;
  const stream = doc.stream;
  const hasStream = stream !== undefined && (Array.isArray(stream.server) || Array.isArray(stream.raw));
  if (http !== undefined) {
    lines.push('http {');
    const onOff = (v) => (v ? 'on' : 'off');
    if (http.sendfile !== undefined) lines.push(`    sendfile ${onOff(http.sendfile)};`);
    if (http.tcpNopush !== undefined) lines.push(`    tcp_nopush ${onOff(http.tcpNopush)};`);
    if (http.tcpNodelay !== undefined) lines.push(`    tcp_nodelay ${onOff(http.tcpNodelay)};`);
    if (http.keepaliveTimeout !== undefined) lines.push(`    keepalive_timeout ${http.keepaliveTimeout};`);
    if (http.keepaliveRequests !== undefined) lines.push(`    keepalive_requests ${http.keepaliveRequests};`);
    if (http.clientMaxBodySize !== undefined) lines.push(`    client_max_body_size ${http.clientMaxBodySize};`);
    if (http.clientBodyTimeout !== undefined) lines.push(`    client_body_timeout ${http.clientBodyTimeout};`);
    if (http.clientHeaderTimeout !== undefined) lines.push(`    client_header_timeout ${http.clientHeaderTimeout};`);
    if (http.clientBodyBufferSize !== undefined) lines.push(`    client_body_buffer_size ${http.clientBodyBufferSize};`);
    if (http.clientHeaderBufferSize !== undefined) lines.push(`    client_header_buffer_size ${http.clientHeaderBufferSize};`);
    if (http.largeClientHeaderBuffers !== undefined) lines.push(`    large_client_header_buffers ${http.largeClientHeaderBuffers};`);
    if (http.resetTimedoutConnection !== undefined) lines.push(`    reset_timedout_connection ${http.resetTimedoutConnection ? 'on' : 'off'};`);
    if (http.sendTimeout !== undefined) lines.push(`    send_timeout ${http.sendTimeout};`);
    if (http.serverNamesHashMaxSize !== undefined) lines.push(`    server_names_hash_max_size ${http.serverNamesHashMaxSize};`);
    if (http.serverTokens !== undefined) lines.push(`    server_tokens ${http.serverTokens};`);
    if (http.defaultType !== undefined) lines.push(`    default_type ${http.defaultType};`);
    for (const entry of http.logFormat ?? []) lines.push(`    log_format ${entry};`);
    for (const entry of http.accessLog ?? []) lines.push(`    access_log ${entry};`);
    if (http.gzip !== undefined) lines.push(`    gzip ${onOff(http.gzip)};`);
    if (http.gzipTypes !== undefined) lines.push(`    gzip_types ${http.gzipTypes.join(' ')};`);
    if (http.gzipMinLength !== undefined) lines.push(`    gzip_min_length ${http.gzipMinLength};`);
    for (const entry of http.map ?? []) {
      const parts = entry.split(/\s+/u);
      lines.push(`    map ${parts[0]} ${parts[1]} {`);
      lines.push(`        default ${parts.slice(2).join(' ') || 'upgrade'};`);
      lines.push('    }');
    }
    for (const entry of http.limitReqZone ?? []) lines.push(`    limit_req_zone ${entry};`);
    for (const inc of http.include ?? []) lines.push(`    include ${inc};`);
    for (const raw of http.raw ?? []) lines.push(`    ${raw}`);

    for (const upstream of http.upstream ?? []) {
      lines.push(`    upstream ${upstream.name} {`);
      if (upstream.loadBalancing === 'least-connections') lines.push('        least_conn;');
      if (upstream.loadBalancing === 'ip-hash') lines.push('        ip_hash;');
      if (upstream.loadBalancing === 'random') lines.push('        random;');
      if (upstream.loadBalancing === 'hash') lines.push(`        hash ${upstream.hashKey};`);
      if (upstream.keepalive !== undefined) lines.push(`        keepalive ${upstream.keepalive};`);
      if (upstream.keepaliveTimeout !== undefined) lines.push(`        keepalive_timeout ${upstream.keepaliveTimeout};`);
      for (const target of upstream.target ?? []) {
        if (target.raw !== undefined) {
          lines.push(`        server ${target.raw};`);
          continue;
        }
        const flags = [];
        if (target.weight !== undefined && target.weight !== 1) flags.push(`weight=${target.weight}`);
        if (target.maxFails !== undefined) flags.push(`max_fails=${target.maxFails}`);
        if (target.failTimeout !== undefined) flags.push(`fail_timeout=${target.failTimeout}`);
        if (target.backup) flags.push('backup');
        if (target.down) flags.push('down');
        if (target.resolve) flags.push('resolve');
        const suffix = flags.length > 0 ? ` ${flags.join(' ')}` : '';
        lines.push(`        server ${target.address}${suffix};`);
      }
      for (const raw of upstream.raw ?? []) lines.push(`        ${raw}`);
      lines.push('    }');
    }

    for (const server of http.server ?? []) {
      lines.push('    server {');
      for (const listen of server.listen ?? []) lines.push(`        listen ${listen};`);
      if (server.serverName !== undefined) lines.push(`        server_name ${server.serverName.join(' ')};`);
      if (server.http2 !== undefined) lines.push(`        http2 ${server.http2 ? 'on' : 'off'};`);
      if (server.root !== undefined) lines.push(`        root ${server.root};`);
      if (server.index !== undefined) lines.push(`        index ${server.index.join(' ')};`);
      if (server.tryFiles !== undefined) lines.push(`        try_files ${server.tryFiles.join(' ')};`);
      if (server.charset !== undefined) lines.push(`        charset ${server.charset};`);
      for (const entry of server.errorPage ?? []) lines.push(`        error_page ${entry};`);
      if (server.returnStatus !== undefined) {
        lines.push(`        return ${server.returnStatus}${server.returnBody !== undefined ? ` ${server.returnBody}` : ''};`);
      }
      if (server.gzip !== undefined) lines.push(`        gzip ${server.gzip ? 'on' : 'off'};`);
      for (const inc of server.include ?? []) lines.push(`        include ${inc};`);

      if (server.tls !== undefined) {
        const tls = server.tls;
        const cert = tls.cert !== undefined ? (http.certificates ?? {})[tls.cert] ?? {} : tls;
        const certFile = tls.certFile ?? cert.certFile;
        const certKeyFile = tls.certKeyFile ?? cert.certKeyFile;
        const chainFile = tls.chainFile ?? cert.chainFile;
        if (certFile !== undefined) lines.push(`        ssl_certificate ${certFile};`);
        if (certKeyFile !== undefined) lines.push(`        ssl_certificate_key ${certKeyFile};`);
        if (chainFile !== undefined) lines.push(`        ssl_trusted_certificate ${chainFile};`);
        if (cert.ocspStapling !== undefined) lines.push(`        ssl_stapling ${cert.ocspStapling ? 'on' : 'off'};`);
        if (tls.protocols !== undefined) lines.push(`        ssl_protocols ${tls.protocols.join(' ')};`);
        if (tls.ciphers !== undefined) lines.push(`        ssl_ciphers ${tls.ciphers};`);
        if (tls.preferServerCiphers !== undefined) lines.push(`        ssl_prefer_server_ciphers ${tls.preferServerCiphers ? 'on' : 'off'};`);
        if (tls.sessionCache !== undefined) lines.push(`        ssl_session_cache ${tls.sessionCache};`);
        if (tls.sessionTimeout !== undefined) lines.push(`        ssl_session_timeout ${tls.sessionTimeout};`);
        if (tls.sessionTickets !== undefined) lines.push(`        ssl_session_tickets ${tls.sessionTickets ? 'on' : 'off'};`);
        if (tls.stapling !== undefined) lines.push(`        ssl_stapling ${tls.stapling ? 'on' : 'off'};`);
        if (tls.staplingVerify !== undefined) lines.push(`        ssl_stapling_verify ${tls.staplingVerify ? 'on' : 'off'};`);
        if (tls.clientCertificate !== undefined) {
          const value = tls.clientCertificate === true ? 'on' : tls.clientCertificate === false ? 'off' : tls.clientCertificate;
          lines.push(`        ssl_verify_client ${value};`);
        }
        if (tls.clientCertificateCA !== undefined) lines.push(`        ssl_client_certificate ${tls.clientCertificateCA};`);
        if (tls.verifyDepth !== undefined) lines.push(`        ssl_verify_depth ${tls.verifyDepth};`);
        if (tls.dhparam !== undefined) lines.push(`        ssl_dhparam ${tls.dhparam};`);
        if (tls.ecdhCurve !== undefined) lines.push(`        ssl_ecdh_curve ${tls.ecdhCurve};`);
        for (const raw of tls.raw ?? []) lines.push(`        ${raw}`);
      }

      for (const location of server.location ?? []) {
        lines.push(`        location ${location.match} {`);
        if (location.proxyPass !== undefined) lines.push(`            proxy_pass ${location.proxyPass};`);
        for (const header of location.proxySetHeader ?? []) lines.push(`            proxy_set_header ${header};`);
        if (location.proxyHttpVersion !== undefined) lines.push(`            proxy_http_version ${location.proxyHttpVersion};`);
        if (location.proxyBuffering !== undefined) lines.push(`            proxy_buffering ${location.proxyBuffering ? 'on' : 'off'};`);
        if (location.proxyBufferSize !== undefined) lines.push(`            proxy_buffer_size ${location.proxyBufferSize};`);
        if (location.proxyConnectTimeout !== undefined) lines.push(`            proxy_connect_timeout ${location.proxyConnectTimeout};`);
        if (location.proxyReadTimeout !== undefined) lines.push(`            proxy_read_timeout ${location.proxyReadTimeout};`);
        if (location.proxySendTimeout !== undefined) lines.push(`            proxy_send_timeout ${location.proxySendTimeout};`);
        if (location.proxyWebsocketUpgrade) {
          lines.push('            proxy_set_header Upgrade $http_upgrade;');
          lines.push('            proxy_set_header Connection "upgrade";');
        }
        if (location.proxyRedirect !== undefined) lines.push(`            proxy_redirect ${location.proxyRedirect};`);
        if (location.proxyInterceptErrors !== undefined) lines.push(`            proxy_intercept_errors ${location.proxyInterceptErrors ? 'on' : 'off'};`);
        if (location.proxyNextUpstream !== undefined) lines.push(`            proxy_next_upstream ${location.proxyNextUpstream};`);
        for (const header of location.proxyHideHeader ?? []) lines.push(`            proxy_hide_header ${header};`);
        if (location.proxyRequestBuffering !== undefined) lines.push(`            proxy_request_buffering ${location.proxyRequestBuffering ? 'on' : 'off'};`);
        if (location.proxyMethod !== undefined) lines.push(`            proxy_method ${location.proxyMethod};`);
        if (location.authBasic !== undefined) lines.push(`            auth_basic ${location.authBasic};`);
        if (location.authBasicUserFile !== undefined) lines.push(`            auth_basic_user_file ${location.authBasicUserFile};`);
        for (const entry of location.limitReq ?? []) lines.push(`            limit_req ${entry};`);
        for (const header of location.addHeader ?? []) lines.push(`            add_header ${header};`);
        for (const entry of location.allow ?? []) lines.push(`            allow ${entry};`);
        for (const entry of location.deny ?? []) lines.push(`            deny ${entry};`);
        if (location.limitRate !== undefined) lines.push(`            limit_rate ${location.limitRate};`);
        for (const entry of location.rewrite ?? []) lines.push(`            rewrite ${entry};`);
        if (location.root !== undefined) lines.push(`            root ${location.root};`);
        if (location.alias !== undefined) lines.push(`            alias ${location.alias};`);
        if (location.index !== undefined) lines.push(`            index ${location.index.join(' ')};`);
        if (location.tryFiles !== undefined) lines.push(`            try_files ${location.tryFiles.join(' ')};`);
        if (location.autoindex !== undefined) lines.push(`            autoindex ${location.autoindex ? 'on' : 'off'};`);
        if (location.etag !== undefined) lines.push(`            etag ${location.etag ? 'on' : 'off'};`);
        if (location.disableSymlinks !== undefined) lines.push(`            disable_symlinks ${location.disableSymlinks};`);
        if (location.logNotFound !== undefined) lines.push(`            log_not_found ${location.logNotFound ? 'on' : 'off'};`);
        if (location.sendfileMaxChunk !== undefined) lines.push(`            sendfile_max_chunk ${location.sendfileMaxChunk};`);
        if (location.expires !== undefined) lines.push(`            expires ${location.expires};`);
        if (location.returnStatus !== undefined) {
          lines.push(`            return ${location.returnStatus}${location.returnBody !== undefined ? ` ${location.returnBody}` : ''};`);
        }
        for (const inc of location.include ?? []) lines.push(`            include ${inc};`);
        for (const raw of location.raw ?? []) lines.push(`            ${raw}`);
        lines.push('        }');
      }

      for (const raw of server.raw ?? []) lines.push(`        ${raw}`);
      lines.push('    }');
    }

    lines.push('}');
  }

  if (hasStream) {
    lines.push('stream {');
    for (const server of stream.server ?? []) {
      lines.push('    server {');
      for (const listen of server.listen ?? []) lines.push(`        listen ${listen};`);
      lines.push(`        proxy_pass ${server.proxyPass};`);
      if (server.proxyTimeout !== undefined) lines.push(`        proxy_timeout ${server.proxyTimeout};`);
      if (server.proxyProtocol !== undefined) lines.push(`        proxy_protocol ${server.proxyProtocol ? 'on' : 'off'};`);
      for (const raw of server.raw ?? []) lines.push(`        ${raw}`);
      lines.push('    }');
    }
    for (const raw of stream.raw ?? []) lines.push(`    ${raw}`);
    lines.push('}');
  }

  return `${lines.join('\n')}\n`;
}

function normalizeConfLines(confText) {
  return confText
    .split('\n')
    .map((line) => line.replace(/#.*$/u, '').trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\s+/gu, ' '));
}

/**
 * Validate a module's deployments/webserver directory (layout v3: W1, W2,
 * W16, W18-W25). Each effective(profile, environment) is validated after merge (W21).
 * @param {string} moduleRoot module repository root
 * @param {{isWorkspaceRoot?: boolean}} [options]
 * @returns {{missing: boolean, ok: boolean, errors: string[], warnings: string[], profiles: object}}
 */
export function validateWebserverDir(moduleRoot, options = {}) {
  const { isWorkspaceRoot = false } = options;
  const errors = [];
  const warnings = [];
  const dir = path.join(moduleRoot, 'deployments', 'webserver');
  const layoutFiles = LAYOUT_V3_FILES;
  const retiredPath = path.join(dir, 'server.toml');

  if (isWorkspaceRoot && fs.existsSync(path.join(dir, 'server.common.toml'))) {
    errors.push(`${path.join(dir, 'server.common.toml')}: workspace root MUST NOT contain deployments/webserver/ (W15)`);
    return { missing: false, ok: false, errors, warnings, profiles: {} };
  }

  const missing = layoutFiles.filter((name) => !fs.existsSync(path.join(dir, name)));
  if (missing.length > 0) {
    const retired = fs.existsSync(retiredPath);
    for (const name of missing) errors.push(`${path.join(dir, name)}: missing layout v3 file (W1)`);
    if (retired) {
      errors.push(`${retiredPath}: server.toml is retired; use layout v3 files (W19)`);
      try {
        const doc = parseTomlSubset(fs.readFileSync(retiredPath, 'utf8'), 'server.toml');
        for (const e of validateWebserverToml(doc).errors) errors.push(`server.toml: ${e}`);
      } catch (error) {
        if (error instanceof TomlSubsetError) errors.push(`server.toml: ${error.message}`);
        else throw error;
      }
    }
    if (missing.length === layoutFiles.length && !retired) {
      return { missing: true, ok: false, errors, warnings, profiles: {} };
    }
    return { missing: false, ok: false, errors, warnings, profiles: {} };
  }

  const docs = {};
  for (const name of layoutFiles) {
    try {
      docs[name] = parseTomlSubset(fs.readFileSync(path.join(dir, name), 'utf8'), name);
    } catch (error) {
      if (error instanceof TomlSubsetError) {
        errors.push(error.message);
        return { missing: false, ok: false, errors, warnings, profiles: {} };
      }
      throw error;
    }
  }
  const common = docs['server.common.toml'];
  const standalone = docs['server.standalone.toml'];
  const cloud = docs['server.cloud.toml'];
  const environmentDocs = Object.fromEntries(
    LIFECYCLE_ENVIRONMENTS.map((environment) => [
      environment,
      docs[ENVIRONMENT_FILE_NAMES[environment]],
    ]),
  );

  // W20: role keys and inherited identity.
  if (common.profile !== undefined) {
    errors.push('server.common.toml: MUST NOT declare profile (W20)');
  }
  if (common.environment !== undefined) {
    errors.push('server.common.toml: MUST NOT declare environment (W20)');
  }
  if (common.enabled !== false) {
    for (const server of common.http?.server ?? []) {
      errors.push(
        'server.common.toml: MUST NOT declare [[http.server]]; use server.<environment>.toml (W20)',
      );
      break;
    }
  }
  for (const environment of LIFECYCLE_ENVIRONMENTS) {
    const fileName = ENVIRONMENT_FILE_NAMES[environment];
    const doc = environmentDocs[environment];
    if (doc.profile !== undefined) {
      errors.push(`${fileName}: MUST NOT declare profile (W20)`);
    }
    if (doc.environment !== environment) {
      errors.push(`${fileName}: environment MUST be "${environment}" (W20)`);
    }
    for (const forbidden of ['specVersion', 'kind', 'id']) {
      if (doc[forbidden] !== undefined) {
        errors.push(`${fileName}: MUST NOT declare ${forbidden}; inherited from server.common.toml (W20)`);
      }
    }
  }
  for (const [name, doc, expected] of [
    ['server.standalone.toml', standalone, 'standalone'],
    ['server.cloud.toml', cloud, 'cloud'],
  ]) {
    if (doc.profile !== expected) {
      errors.push(`${name}: profile MUST be "${expected}" (W20)`);
    }
    if (doc.environment !== undefined) {
      errors.push(`${name}: MUST NOT declare environment (W20)`);
    }
    for (const forbidden of ['specVersion', 'kind', 'id']) {
      if (doc[forbidden] !== undefined) {
        errors.push(`${name}: MUST NOT declare ${forbidden}; inherited from server.common.toml (W20)`);
      }
    }
  }

  // W21: merge and validate each effective(profile, environment).
  const profiles = {};
  for (const profileName of DEPLOYMENT_PROFILES) {
    profiles[profileName] = {};
    const profileDoc = profileName === 'standalone' ? standalone : cloud;
    for (const environment of LIFECYCLE_ENVIRONMENTS) {
      const effective = mergeEffective(common, environmentDocs[environment], profileDoc);
      profiles[profileName][environment] = effective;
      const result = validateWebserverToml(effective);
      for (const e of result.errors) errors.push(`effective(${profileName}.${environment}): ${e}`);
      for (const w of result.warnings) warnings.push(`effective(${profileName}.${environment}): ${w}`);
    }
  }

  // W30: canonical primary API upstream is named "gateway" (§8.1).
  if (common.enabled !== false) {
    for (const profileName of DEPLOYMENT_PROFILES) {
      for (const environment of LIFECYCLE_ENVIRONMENTS) {
        const effective = profiles[profileName][environment];
        if (effective.enabled === false) continue;
        const hasHttpSurface = (effective.http?.server ?? []).length > 0;
        if (!hasHttpSurface) continue;
        const gatewayUpstreams = (effective.http?.upstream ?? []).filter(
          (upstream) => upstream?.name === 'gateway',
        );
        if (gatewayUpstreams.length === 0) {
          errors.push(
            `effective(${profileName}.${environment}): MUST declare [[http.upstream]] name = "gateway" for the primary API target (W30)`,
          );
        } else if (gatewayUpstreams.length > 1) {
          errors.push(
            `effective(${profileName}.${environment}): MUST declare exactly one upstream named "gateway" (W30)`,
          );
        }
      }
    }
  }

  // W24: public hostnames must follow APP_RUNTIME_TOPOLOGY_NAMING.md §9.
  const moduleName = path.basename(path.resolve(moduleRoot));
  for (const environment of LIFECYCLE_ENVIRONMENTS) {
    const envDoc = environmentDocs[environment];
    for (const server of envDoc?.http?.server ?? []) {
      for (const host of server.serverName ?? []) {
        if (!isPublicHostCompliant(host)) {
          errors.push(
            `server.${environment}.toml serverName "${host}": not a registered public host per APP_RUNTIME_TOPOLOGY_NAMING.md §9 (W24)`,
          );
        }
        if (
          moduleName !== 'sdkwork-api-cloud-gateway'
          && normalizeHost(host).split('.')[0] === PLATFORM_GATEWAY_ROLE
        ) {
          errors.push(
            `server.${environment}.toml serverName "${host}": platform gateway host belongs on sdkwork-api-cloud-gateway only (W24)`,
          );
        }
      }
    }
  }

  // W26: every lifecycle tier declares the same base-domain coverage as production.
  if (common.enabled !== false) {
    const productionHosts = (environmentDocs.production?.http?.server ?? [])
      .flatMap((server) => server.serverName ?? [])
      .map(normalizeHost)
      .filter(Boolean);
    const productionBases = new Set(
      productionHosts.map((host) => baseDomainFromHost(host)).filter(Boolean),
    );
    if (productionBases.size > 0) {
      for (const environment of ['development', 'test', 'staging']) {
        const fileName = ENVIRONMENT_FILE_NAMES[environment];
        const envHosts = (environmentDocs[environment]?.http?.server ?? [])
          .flatMap((server) => server.serverName ?? [])
          .map(normalizeHost)
          .filter(Boolean);
        if (envHosts.length === 0) {
          errors.push(`${fileName}: MUST declare [[http.server]] when production hosts exist (W26)`);
          continue;
        }
        const envBases = new Set(envHosts.map((host) => baseDomainFromHost(host)).filter(Boolean));
        if (envBases.size !== productionBases.size) {
          errors.push(
            `${fileName}: base domain count ${envBases.size} != production ${productionBases.size} (W26)`,
          );
        }
      }
    }
  }

  // W27: platform certificates and TLS defaults live in server.common.toml only.
  if (common.enabled !== false && isPlainObject(common.http?.certificates) && Object.keys(common.http.certificates).length > 0) {
    for (const environment of LIFECYCLE_ENVIRONMENTS) {
      const fileName = ENVIRONMENT_FILE_NAMES[environment];
      const envCerts = environmentDocs[environment]?.http?.certificates;
      if (isPlainObject(envCerts) && Object.keys(envCerts).length > 0) {
        errors.push(`${fileName}: MUST NOT declare [http.certificates]; use server.common.toml (W27)`);
      }
    }
  }

  // W28: server.include snippet paths must exist under deployments/webserver/.
  for (const environment of LIFECYCLE_ENVIRONMENTS) {
    const fileName = ENVIRONMENT_FILE_NAMES[environment];
    for (const [index, server] of (environmentDocs[environment]?.http?.server ?? []).entries()) {
      for (const entry of server.include ?? []) {
        if (typeof entry !== 'string' || !entry.trim()) continue;
        const snippetPath = path.join(dir, entry);
        if (!fs.existsSync(snippetPath)) {
          errors.push(`${fileName} http.server[${index}].include: missing snippet ${entry} (W28)`);
        }
      }
    }
  }

  // W29: Adaptive Web edge modules (expose.mode web / web+api) wire production hosts correctly.
  const adaptiveEdge = moduleUsesAdaptiveWebEdge(moduleRoot, moduleName);
  if (adaptiveEdge && common.enabled !== false) {
    if (!(common.http?.include ?? []).some((entry) => String(entry).includes('adaptive-web.maps.conf'))) {
      errors.push('server.common.toml: MUST declare http.include snippets/adaptive-web.maps.conf for Adaptive Web edge (W29)');
    }
    for (const snippet of [
      ADAPTIVE_SNIPPET_PATHS.maps,
      ADAPTIVE_SNIPPET_PATHS.dispatch,
      ADAPTIVE_SNIPPET_PATHS.namedLocations,
      GATEWAY_SNIPPET_PATHS.apiProduction,
    ]) {
      if (!fs.existsSync(path.join(dir, snippet))) {
        errors.push(`${snippet}: missing Adaptive Web edge snippet (W29)`);
      }
    }
    const productionEffective = profiles.standalone?.production ?? profiles.cloud?.production;
    for (const server of productionEffective?.http?.server ?? []) {
      if (!serverHasAdaptiveRootDispatch(server)) {
        const names = (server.serverName ?? []).join(',') || '(unknown)';
        errors.push(
          `server.production.toml: production host ${names} MUST declare location / → adaptive-web.dispatch.conf (W29)`,
        );
      }
    }
  }

  // W16: per-profile×environment sidecars when nginx.enabled is true.
  const nginx = common.nginx ?? {};
  const nginxEnabled = nginx.enabled !== false;
  const strict = nginx.strict !== false;
  const confBase = nginx.confFile ?? 'nginx.conf';
  for (const profileName of DEPLOYMENT_PROFILES) {
    for (const environment of LIFECYCLE_ENVIRONMENTS) {
      const effective = profiles[profileName][environment];
      const sidecarPath = path.join(dir, sidecarFileName(confBase, profileName, environment));
      const legacySidecarPath = path.join(
        dir,
        `${confBase.replace(/\.conf$/u, '')}.${profileName}.conf`,
      );
      const chosenSidecar = fs.existsSync(sidecarPath)
        ? sidecarPath
        : environment === 'production' && fs.existsSync(legacySidecarPath)
          ? legacySidecarPath
          : null;
      if (!chosenSidecar) {
        if (nginxEnabled && strict && common.enabled !== false) {
          errors.push(
            `${sidecarFileName(confBase, profileName, environment)}: missing nginx sidecar (W16); run align-webserver-workspace or render-nginx-sidecars`,
          );
        }
        continue;
      }
      if (!nginxEnabled) {
        warnings.push(
          `${path.basename(chosenSidecar)}: present but ignored because nginx.enabled = false (W16)`,
        );
        continue;
      }
      if (chosenSidecar === legacySidecarPath) {
        warnings.push(
          `${path.basename(legacySidecarPath)}: legacy sidecar; prefer ${sidecarFileName(confBase, profileName, environment)} (W16)`,
        );
      }
      const { doc: folded } = applyAdaptiveWebFolding(effective, {
        moduleRoot,
        webserverDir: dir,
        runtimeCode: common.id,
      });
      const rendered = normalizeConfLines(renderNginxConf(folded));
      const sidecar = normalizeConfLines(fs.readFileSync(chosenSidecar, 'utf8'));
      const sidecarSet = new Set(sidecar);
      const missingLines = rendered.filter((line) => !sidecarSet.has(line));
      if (missingLines.length > 0) {
        const message = `${path.basename(chosenSidecar)} diverges from effective(${profileName}.${environment}); missing: ${missingLines.slice(0, 3).join(' | ')}${missingLines.length > 3 ? ' ...' : ''}`;
        if (strict) errors.push(`${path.basename(chosenSidecar)}: ${message} (W16)`);
        else warnings.push(`${path.basename(chosenSidecar)}: ${message} (W16 relaxed)`);
      }
    }
  }

  // W18: deploy.yaml expose domains must match effective(profile.environment).
  const deployYaml = path.join(moduleRoot, 'deployments', 'deploy.yaml');
  if (yaml && fs.existsSync(deployYaml)) {
    try {
      const parsed = yaml.load(fs.readFileSync(deployYaml, 'utf8'));
      const profileBlocks = parsed?.profiles && typeof parsed.profiles === 'object'
        ? Object.entries(parsed.profiles)
        : parsed?.expose
          ? [['default', parsed]]
          : [];
      for (const [profileId, block] of profileBlocks) {
        if (!block || !Array.isArray(block.expose)) continue;
        const environment = profileId.includes('.') ? profileId.split('.').pop() : 'production';
        const deploymentProfile = profileId.includes('.') ? profileId.split('.')[0] : 'standalone';
        if (!DEPLOYMENT_PROFILES.includes(deploymentProfile)) continue;
        if (!LIFECYCLE_ENVIRONMENTS.includes(environment)) continue;
        const effective = profiles[deploymentProfile]?.[environment];
        if (!effective) continue;
        const serverNames = new Set(
          (effective.http?.server ?? []).flatMap((server) => server.serverName ?? []),
        );
        for (const item of block.expose) {
          const domain = typeof item === 'string' ? item : item?.domain;
          if (!domain || serverNames.has(domain)) continue;
          warnings.push(
            `deployments/deploy.yaml profile "${profileId}": expose domain "${domain}" is not covered by effective(${deploymentProfile}.${environment}) serverName (W18)`,
          );
        }
      }
    } catch {
      // unparseable deploy.yaml is reported by check-deploy-standard
    }
  }

  // W23: edge proxy-only modules (sdkwork-webserver, sdkwork-api-cloud-gateway) must not ship Adaptive Web.
  if (isEdgeProxyOnlyModule(moduleName)) {
    const forbiddenMarkers = [
      'adaptive-web.maps.conf',
      'adaptive-web.dispatch.conf',
      'adaptive-web.named-locations.conf',
      'web.pc.conf',
      'web.h5.conf',
      'web.static.conf',
      '@pc',
      '@h5',
    ];
    for (const profileName of DEPLOYMENT_PROFILES) {
      for (const environment of LIFECYCLE_ENVIRONMENTS) {
        const effective = profiles[profileName][environment];
        const blob = JSON.stringify(effective);
        for (const marker of forbiddenMarkers) {
          if (blob.includes(marker)) {
            errors.push(
              `effective(${profileName}.${environment}): ${moduleName} edge nginx must not include Adaptive Web marker "${marker}" (W23)`,
            );
          }
        }
        if (moduleName !== 'sdkwork-webserver') continue;
        for (const server of effective.http?.server ?? []) {
          const names = server.serverName ?? [];
          const isPublicIngress = names.some((name) => (
            name === 'server.sdkwork.com'
            || /^server(-dev|-test|-staging)?\.sdkwork\.com$/u.test(name)
          ));
          if (!isPublicIngress) continue;
          const root = (server.location ?? []).find((location) => location.match === '/');
          if (!root && !gatewayRootLocationViaSnippet(server, dir)) {
            errors.push(
              `effective(${profileName}.${environment}): public ingress ${names.join(',')} missing location / (W23)`,
            );
            continue;
          }
          if (root) {
            if (typeof root.proxyPass !== 'string' || !root.proxyPass.trim()) {
              errors.push(
                `effective(${profileName}.${environment}): public ingress ${names.join(',')} location / MUST proxy_pass to the gateway (W23)`,
              );
            }
            if (root.root !== undefined || root.include !== undefined) {
              errors.push(
                `effective(${profileName}.${environment}): public ingress ${names.join(',')} location / MUST NOT declare root/include Adaptive Web (W23)`,
              );
            }
          }
        }
      }
    }
    const snippetsDir = path.join(dir, 'snippets');
    if (fs.existsSync(snippetsDir)) {
      for (const entry of fs.readdirSync(snippetsDir)) {
        if (/adaptive-web|web\.(pc|h5|static)\.conf/u.test(entry)) {
          errors.push(
            `deployments/webserver/snippets/${entry}: forbidden on ${moduleName} proxy-only edge (W23)`,
          );
        }
      }
    }
  }

  return { missing: false, ok: errors.length === 0, errors, warnings, profiles };
}

function serverHasAdaptiveRootDispatch(server) {
  return (server.location ?? []).some(
    (location) => location.match === '/'
      && (location.include ?? []).some((entry) => String(entry).includes('adaptive-web.dispatch.conf')),
  );
}

function gatewayRootLocationViaSnippet(server, webserverDir) {
  for (const entry of server.include ?? []) {
    if (entry !== GATEWAY_SNIPPET_PATHS.production && entry !== GATEWAY_SNIPPET_PATHS.nonproduction) {
      continue;
    }
    const snippetPath = path.join(webserverDir, entry);
    if (!fs.existsSync(snippetPath)) continue;
    const content = fs.readFileSync(snippetPath, 'utf8');
    if (/location\s+\/\s*\{/u.test(content) && /proxy_pass\s+http:\/\/gateway/u.test(content)) {
      return true;
    }
  }
  return false;
}

function collectExposeBlocks(yaml, text) {
  const blocks = [];
  try {
    const parsed = yaml.load(text);
    if (parsed?.profiles && typeof parsed.profiles === 'object') {
      for (const block of Object.values(parsed.profiles)) {
        if (block && Array.isArray(block.expose)) blocks.push(block);
      }
    } else if (parsed && Array.isArray(parsed.expose)) {
      blocks.push(parsed);
    }
  } catch {
    // unparseable deploy.yaml is reported by check-deploy-standard
  }
  return blocks;
}

/**
 * Scan a workspace for module web server compliance (W1 presence).
 * @param {string} workspaceRoot
 * @returns {{modules: Array<{root: string, name: string, missing: boolean, ok: boolean, errors: string[], warnings: string[]}>, missingCount: number, errorCount: number}}
 */
export function scanWebserverCompliance(workspaceRoot) {
  const modules = [];
  let missingCount = 0;
  let errorCount = 0;
  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const moduleRoot = path.join(workspaceRoot, entry.name);
    if (!fs.existsSync(path.join(moduleRoot, 'deployments'))) continue;
    const result = validateWebserverDir(moduleRoot);
    if (result.missing) missingCount += 1;
    if (!result.missing && !result.ok) errorCount += 1;
    modules.push({ root: moduleRoot, name: entry.name, ...result });
  }
  modules.sort((a, b) => a.name.localeCompare(b.name));
  return { modules, missingCount, errorCount };
}
