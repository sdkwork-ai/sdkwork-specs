// Build layout v3 deployments/webserver/*.toml from specs/topology.spec.json.
// Authority: SDKWORK_WEBSERVER_SPEC.md §2, APP_RUNTIME_TOPOLOGY_NAMING.md §9.

import fs from 'node:fs';
import path from 'node:path';

import { LIFECYCLE_ENVIRONMENTS } from './layout-v3.mjs';
import { serializeToml } from './serialize.mjs';
import { filterCompliantHosts, isPublicHostCompliant, normalizeHost } from './host-registry.mjs';
import { letsencryptCertificateBlock } from './cert-paths.mjs';

export { LIFECYCLE_ENVIRONMENTS };
export const CLOUD_GATEWAY_TARGET = 'sdkwork-api-cloud-gateway:8080';
export const DEFAULT_STANDALONE_BIND = '127.0.0.1:3900';

const PROXY_HEADERS = [
  'Host $host',
  'X-Real-IP $remote_addr',
  'X-Forwarded-For $proxy_add_x_forwarded_for',
  'X-Forwarded-Proto $scheme',
];

const PROXY_HEADERS_LITE = [
  'Host $host',
  'X-Forwarded-For $proxy_add_x_forwarded_for',
  'X-Forwarded-Proto $scheme',
];

export function certNameFromHost(host) {
  const parts = host.split('.');
  if (parts.length < 2) return host;
  return parts.slice(-2).join('.');
}

export function deriveEnvHosts(productionHosts, environment) {
  if (environment === 'production') return [...productionHosts];
  const suffix =
    environment === 'development' ? '-dev' : environment === 'test' ? '-test' : '-staging';
  return productionHosts.map((host) => {
    const parts = host.split('.');
    if (parts.length < 2) return host;
    const role = parts[0];
    const base = parts.slice(1).join('.');
    return `${role}${suffix}.${base}`;
  });
}

export function productionHostsForSurface(surface) {
  if (!surface) return [];
  const raw = [];
  if (Array.isArray(surface.httpHosts) && surface.httpHosts.length > 0) {
    raw.push(...surface.httpHosts);
  }
  if (typeof surface.httpHost === 'string' && surface.httpHost.length > 0) {
    raw.push(surface.httpHost);
  }
  return filterCompliantHosts(raw);
}

export function hostsForSurface(surface, environment) {
  const production = productionHostsForSurface(surface);
  if (production.length === 0) return [];
  if (environment === 'production') return production;
  const envBlock = surface.environments?.[environment];
  if (envBlock?.httpHosts?.length) return filterCompliantHosts([...new Set(envBlock.httpHosts)]);
  if (typeof envBlock?.httpHost === 'string' && envBlock.httpHost.length > 0) {
    return filterCompliantHosts([envBlock.httpHost]);
  }
  return filterCompliantHosts(deriveEnvHosts(production, environment));
}

/** HTTP nginx webserver applies only to surfaces that terminate HTTP. */
export function surfaceSupportsHttpWebserver(topology, surfaceId) {
  const surface = topology?.surfaces?.[surfaceId];
  if (!surface) return true;
  const protocols = Array.isArray(surface.protocols) ? surface.protocols : ['http'];
  return protocols.includes('http');
}

export function webserverSurfaces(appId, topology) {
  const hosts = topology?.cloudPublicHosts ?? {};
  if (appId === 'sdkwork-api-cloud-gateway') {
    return hosts['platform.api-gateway'] ? ['platform.api-gateway'] : Object.keys(hosts);
  }
  const surfaces = [];
  for (const surfaceId of [
    'application.public-ingress',
    'application.app-http',
    'application.backend-http',
    'application.admin-http',
    'application.open-http',
    'edge.device-ingress',
  ]) {
    if (!surfaceSupportsHttpWebserver(topology, surfaceId)) continue;
    if (productionHostsForSurface(hosts[surfaceId]).length > 0) surfaces.push(surfaceId);
  }
  return surfaces;
}

function buildCertificates(hosts) {
  const certificates = {};
  for (const host of hosts) {
    const name = certNameFromHost(host);
    if (certificates[name]) continue;
    certificates[name] = letsencryptCertificateBlock(name);
  }
  return certificates;
}

function proxyLocation(match, { production = true, health = false } = {}) {
  const loc = {
    match,
    proxyPass: 'http://gateway',
    proxyHttpVersion: '1.1',
    proxySetHeader: health ? ['Host $host'] : production ? PROXY_HEADERS : PROXY_HEADERS_LITE,
  };
  if (!health) {
    loc.proxyBuffering = false;
    loc.proxyReadTimeout = production ? '120s' : '300s';
    if (production) loc.proxySendTimeout = '120s';
  }
  return loc;
}

function groupHostsByCert(hosts) {
  const groups = new Map();
  for (const host of hosts) {
    const cert = certNameFromHost(host);
    if (!groups.has(cert)) groups.set(cert, []);
    groups.get(cert).push(host);
  }
  return groups;
}

function buildServerBlock(serverName, environment, { includeApiPrefix = false, tlsCert = null } = {}) {
  const production = environment === 'production';
  const listen = production ? ['443 ssl', '80'] : ['80'];
  const server = { listen, serverName: [...serverName] };
  if (production) {
    const cert = tlsCert ?? certNameFromHost(serverName[0]);
    server.tls = {
      cert,
      protocols: ['TLSv1.2', 'TLSv1.3'],
      preferServerCiphers: true,
      sessionCache: 'shared:SSL:10m',
    };
  }
  const locations = [];
  if (production) {
    locations.push(proxyLocation('= /healthz', { health: true }));
    locations.push(proxyLocation('= /readyz', { health: true }));
  }
  if (includeApiPrefix) {
    locations.push({
      match: '/api/',
      proxyPass: 'http://gateway',
      proxyHttpVersion: '1.1',
      proxySetHeader: PROXY_HEADERS_LITE,
    });
  }
  locations.push(proxyLocation('/', { production }));
  server.location = locations;
  return server;
}

function buildEnvironmentDoc(topology, surfaces, environment) {
  const hostSet = new Set();
  for (const surfaceId of surfaces) {
    for (const host of hostsForSurface(topology.cloudPublicHosts[surfaceId], environment)) {
      if (isPublicHostCompliant(host)) hostSet.add(normalizeHost(host));
    }
  }
  const hosts = [...hostSet];
  if (hosts.length === 0) {
    return { environment, http: {} };
  }

  const servers = [];
  if (environment === 'production') {
    for (const [cert, groupHosts] of groupHostsByCert(hosts)) {
      servers.push(
        buildServerBlock(groupHosts, environment, {
          includeApiPrefix: true,
          tlsCert: cert,
        }),
      );
    }
  } else {
    servers.push(
      buildServerBlock(hosts, environment, {
        includeApiPrefix: true,
      }),
    );
  }

  return {
    environment,
    http: {
      certificates: buildCertificates(hosts),
      server: servers,
    },
  };
}

export function buildWebserverDocs({ appId, topology, moduleRoot = null }) {
  const runtimeCode = topology?.applicationCode ?? appId.replace(/^sdkwork-/u, '');
  const surfaces = topology?.cloudPublicHosts ? webserverSurfaces(appId, topology) : [];
  const standaloneBind = topology?.defaults?.gatewayBind ?? DEFAULT_STANDALONE_BIND;

  const hasHosts = surfaces.some(
    (surfaceId) => productionHostsForSurface(topology.cloudPublicHosts[surfaceId]).length > 0,
  );

  const environments = Object.fromEntries(
    LIFECYCLE_ENVIRONMENTS.map((environment) => [
      environment,
      hasHosts ? buildEnvironmentDoc(topology, surfaces, environment) : { environment },
    ]),
  );

  if (!hasHosts) {
    return {
      enabled: false,
      common: {
        specVersion: 1,
        kind: 'sdkwork.webserver.server',
        id: runtimeCode,
        enabled: false,
        description: `${appId} webserver placeholder (no cloudPublicHosts in topology)`,
      },
      environments,
      standalone: { profile: 'standalone' },
      cloud: { profile: 'cloud' },
      moduleRoot,
    };
  }

  const common = {
    specVersion: 1,
    kind: 'sdkwork.webserver.server',
    id: runtimeCode,
    description: `${appId} web server (${surfaces.join(', ')})`,
    nginx: {
      enabled: true,
      profile: 'http-core-v1',
      unknownDirectivePolicy: 'error',
      strict: true,
      confFile: 'nginx.conf',
    },
    main: {
      user: 'sdkwork',
      workerProcesses: 'auto',
      pid: `/run/sdkwork/${runtimeCode}/webserver.pid`,
      errorLog: `/var/log/sdkwork/${runtimeCode}/webserver/error.log warn`,
      events: { workerConnections: 1024 },
    },
    http: {
      sendfile: true,
      keepaliveTimeout: 75,
      clientMaxBodySize: '1100m',
      serverTokens: 'off',
      gzip: true,
      upstream: [{ name: 'gateway', loadBalancing: 'least-connections', keepalive: 32 }],
    },
  };

  const standalone = {
    profile: 'standalone',
    http: {
      upstream: [{ name: 'gateway', target: [{ address: standaloneBind, weight: 1 }] }],
    },
  };

  const cloud = {
    profile: 'cloud',
    http: {
      upstream: [{ name: 'gateway', target: [{ address: CLOUD_GATEWAY_TARGET, weight: 1 }] }],
    },
  };

  return { enabled: true, common, environments, standalone, cloud, moduleRoot };
}

export function buildAppRootsExample({ appId, moduleRoot }) {
  if (!moduleRoot || !fs.existsSync(moduleRoot)) return null;
  const appsDir = path.join(moduleRoot, 'apps');
  if (!fs.existsSync(appsDir)) return null;
  const pcDir = fs.readdirSync(appsDir).find((name) => name.includes('-pc'));
  const h5Dir = fs.readdirSync(appsDir).find((name) => name.includes('-h5'));
  if (!pcDir && !h5Dir) return null;

  const lines = [
    `# Adaptive Web roots for ${appId} (copy into runtime config when in-process).`,
    `# Docker entrypoint generates /etc/sdkwork/webserver/module-app-roots/${appId}.toml`,
    '',
    '[app_roots]',
    'tablet_surface = "pc"',
    '',
  ];
  if (pcDir) {
    lines.push('[app_roots.pc_static_by_environment]');
    for (const env of LIFECYCLE_ENVIRONMENTS) {
      const alias = env === 'development' ? 'dev' : env === 'production' ? 'prod' : env;
      lines.push(`${env} = "apps/${pcDir}/dist/${alias}"`);
    }
    lines.push('');
  }
  if (h5Dir) {
    lines.push('[app_roots.h5_static_by_environment]');
    for (const env of LIFECYCLE_ENVIRONMENTS) {
      const alias = env === 'development' ? 'dev' : env === 'production' ? 'prod' : env;
      lines.push(`${env} = "apps/${h5Dir}/dist/${alias}"`);
    }
    lines.push('');
  }
  lines.push('[app_roots.static_fallback_by_environment]');
  for (const env of LIFECYCLE_ENVIRONMENTS) {
    lines.push(`${env} = "deployments/webserver/static"`);
  }
  lines.push('');
  return lines.join('\n');
}

export function writeWebserverLayout(moduleRoot, docs, { writeAppRoots = true } = {}) {
  const dir = path.join(moduleRoot, 'deployments', 'webserver');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.common.toml'), serializeToml(docs.common));
  for (const environment of LIFECYCLE_ENVIRONMENTS) {
    const envDoc = docs.environments?.[environment] ?? { environment };
    fs.writeFileSync(path.join(dir, `server.${environment}.toml`), serializeToml(envDoc));
  }
  fs.writeFileSync(path.join(dir, 'server.standalone.toml'), serializeToml(docs.standalone));
  fs.writeFileSync(path.join(dir, 'server.cloud.toml'), serializeToml(docs.cloud));
  const legacy = path.join(dir, 'server.toml');
  if (fs.existsSync(legacy)) fs.rmSync(legacy);
  if (writeAppRoots && docs.enabled) {
    const appRoots = buildAppRootsExample({ appId: path.basename(moduleRoot), moduleRoot });
    if (appRoots) {
      fs.writeFileSync(path.join(dir, 'app-roots.example.toml'), appRoots);
    }
  }
}

/** Infer lifecycle environment from serverName suffixes (migration helper). */
export function inferEnvironmentFromServerNames(serverNames) {
  const names = serverNames ?? [];
  if (names.some((name) => name.includes('-staging.'))) return 'staging';
  if (names.some((name) => name.includes('-test.'))) return 'test';
  if (names.some((name) => name.includes('-dev.'))) return 'development';
  return 'production';
}

/** Split a layout v2 common (all environments in one file) into layout v3 environment docs. */
export function splitLegacyCommonIntoEnvironments(commonDoc) {
  const servers = commonDoc.http?.server ?? [];
  const buckets = Object.fromEntries(LIFECYCLE_ENVIRONMENTS.map((environment) => [environment, []]));

  for (const server of servers) {
    const environment = inferEnvironmentFromServerNames(server.serverName);
    buckets[environment].push(server);
  }

  const environments = {};
  for (const environment of LIFECYCLE_ENVIRONMENTS) {
    const envServers = buckets[environment];
    const hosts = envServers.flatMap((server) => server.serverName ?? []);
    environments[environment] = {
      environment,
      http: envServers.length > 0
        ? {
            certificates: buildCertificates(hosts),
            server: envServers,
          }
        : {},
    };
  }

  const nextCommon = structuredClone(commonDoc);
  if (nextCommon.http) {
    delete nextCommon.http.server;
    delete nextCommon.http.certificates;
    if (Object.keys(nextCommon.http).length === 0) delete nextCommon.http;
  }
  return { common: nextCommon, environments };
}
