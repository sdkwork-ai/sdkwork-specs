// Build layout v3 deployments/webserver/*.toml from specs/topology.spec.json.
// Authority: SDKWORK_WEBSERVER_SPEC.md §2, APP_RUNTIME_TOPOLOGY_NAMING.md §9.

import fs from 'node:fs';
import path from 'node:path';

import { LIFECYCLE_ENVIRONMENTS } from './layout-v3.mjs';
import { serializeToml } from './serialize.mjs';
import { filterCompliantHosts, isPublicHostCompliant, normalizeHost } from './host-registry.mjs';
import { platformCertificateRegistry } from './platform-certificates.mjs';
import {
  gatewaySnippetInclude,
  GATEWAY_SNIPPET_PATHS,
  TLS_DEFAULTS,
  writeGatewaySnippets,
} from './gateway-snippets.mjs';
import { ADAPTIVE_SNIPPET_PATHS, writeAdaptiveWebSnippets } from './adaptive-web-snippets.mjs';
import { moduleUsesAdaptiveWebEdge } from './expose-mode.mjs';

export { LIFECYCLE_ENVIRONMENTS };
export const CLOUD_GATEWAY_TARGET = 'sdkwork-api-cloud-gateway:8080';
export const DEFAULT_STANDALONE_BIND = '127.0.0.1:3900';

export function certNameFromHost(host) {
  const parts = host.split('.');
  if (parts.length < 2) return host;
  return parts.slice(-2).join('.');
}

function pruneAdaptiveWebSnippets(webserverDir) {
  for (const rel of Object.values(ADAPTIVE_SNIPPET_PATHS)) {
    const target = path.join(webserverDir, rel);
    if (fs.existsSync(target)) fs.rmSync(target);
  }
}

function ensureStaticFallbackDir(webserverDir) {
  const staticDir = path.join(webserverDir, 'static');
  fs.mkdirSync(staticDir, { recursive: true });
  const gitkeep = path.join(staticDir, '.gitkeep');
  if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');
  const indexPath = path.join(staticDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>SDKWork</title></head>'
        + '<body><p>Static fallback placeholder — replace with packaged PC/H5 assets.</p></body></html>\n',
    );
  }
}

export function deriveEnvHosts(productionHosts, environment) {
  if (environment === 'production') return [...productionHosts];
  const suffix =
    environment === 'development' ? '-dev'
      : environment === 'test' ? '-test'
        : environment === 'demo' ? '-demo'
          : '-staging';
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

function groupHostsByCert(hosts) {
  const groups = new Map();
  for (const host of hosts) {
    const cert = certNameFromHost(host);
    if (!groups.has(cert)) groups.set(cert, []);
    groups.get(cert).push(host);
  }
  return groups;
}

function buildServerBlock(serverName, environment, { tlsCert = null, adaptiveWeb = false } = {}) {
  const production = environment === 'production';
  const server = {
    listen: production ? ['443 ssl', '80'] : ['80'],
    serverName: [...serverName],
  };

  if (adaptiveWeb && production) {
    server.include = [
      ADAPTIVE_SNIPPET_PATHS.namedLocations,
      GATEWAY_SNIPPET_PATHS.apiProduction,
    ];
    server.location = [
      { match: '/', include: [ADAPTIVE_SNIPPET_PATHS.dispatch] },
    ];
  } else {
    server.include = [gatewaySnippetInclude(environment)];
  }

  if (production) {
    server.tls = { cert: tlsCert ?? certNameFromHost(serverName[0]) };
  }
  return server;
}

function buildEnvironmentDoc(topology, surfaces, environment, { adaptiveWeb = false } = {}) {
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
      servers.push(buildServerBlock(groupHosts, environment, { tlsCert: cert, adaptiveWeb }));
    }
  } else {
    servers.push(buildServerBlock(hosts, environment, { adaptiveWeb: false }));
  }

  return {
    environment,
    http: {
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

  const adaptiveWeb = moduleRoot
    ? moduleUsesAdaptiveWebEdge(moduleRoot, appId)
    : false;

  const environments = Object.fromEntries(
    LIFECYCLE_ENVIRONMENTS.map((environment) => [
      environment,
      hasHosts
        ? buildEnvironmentDoc(topology, surfaces, environment, { adaptiveWeb })
        : { environment },
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
      certificates: platformCertificateRegistry(),
      defaults: { tls: TLS_DEFAULTS },
      upstream: [{ name: 'gateway', loadBalancing: 'least-connections', keepalive: 32 }],
    },
  };

  if (adaptiveWeb) {
    common.http.include = [ADAPTIVE_SNIPPET_PATHS.maps];
  }

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

  return { enabled: true, common, environments, standalone, cloud, moduleRoot, adaptiveWeb };
}

export function buildAppRootsExample({ appId, moduleRoot }) {
  if (!moduleRoot || !fs.existsSync(moduleRoot)) return null;
  const appsDir = path.join(moduleRoot, 'apps');
  if (!fs.existsSync(appsDir)) return null;
  const appEntries = fs.readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const pcDir = appEntries.find((name) => name.startsWith('sdkwork-') && name.endsWith('-pc'));
  const h5Dir = appEntries.find((name) => name.startsWith('sdkwork-') && name.endsWith('-h5'));
  if (!pcDir && !h5Dir) return null;

  const lines = [
    `# Adaptive Web roots for ${appId} (copy into runtime config when in-process).`,
    `# Docker entrypoint generates /etc/sdkwork/webserver/module-app-roots/${appId}.toml`,
    '',
    '[app_roots]',
    'tablet_surface = "pc"',
    '',
  ];
  // FRONTEND_CODE_SPEC.md §7 / SDKWORK_WEBSERVER_SPEC.md §13.6 / §17.1:
  // process Adaptive Web roots are dist/<profile>/<envAlias>/; the gateway
  // catalog defaults to the standalone profile (same-origin). Cloud bundles
  // coexist under dist/cloud/<alias>/ for CDN publish and are not the default
  // in-process static roots.
  const defaultProfile = 'standalone';
  if (pcDir) {
    lines.push('[app_roots.pc_static_by_environment]');
    for (const env of LIFECYCLE_ENVIRONMENTS) {
      const alias = env === 'development' ? 'dev' : env === 'production' ? 'prod' : env;
      lines.push(`${env} = "apps/${pcDir}/dist/${defaultProfile}/${alias}"`);
    }
    lines.push('');
  }
  if (h5Dir) {
    lines.push('[app_roots.h5_static_by_environment]');
    for (const env of LIFECYCLE_ENVIRONMENTS) {
      const alias = env === 'development' ? 'dev' : env === 'production' ? 'prod' : env;
      lines.push(`${env} = "apps/${h5Dir}/dist/${defaultProfile}/${alias}"`);
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

export function buildWebserverReadme({ appId, docs, topology }) {
  const runtimeCode = docs.common?.id ?? appId.replace(/^sdkwork-/u, '');
  const enabled = docs.enabled !== false && docs.common?.enabled !== false;
  const surfaces = topology?.cloudPublicHosts ? webserverSurfaces(appId, topology) : [];

  const envRows = [];
  for (const environment of LIFECYCLE_ENVIRONMENTS) {
    const envDoc = docs.environments?.[environment] ?? {};
    const hosts = (envDoc.http?.server ?? []).flatMap((s) => s.serverName ?? []);
    const sample = hosts[0] ?? '(none)';
    const tls = environment === 'production' ? '443 ssl + 80' : '80';
    envRows.push(`| ${environment} | \`server.${environment}.toml\` | ${hosts.length} | \`${sample}\` | ${tls} |`);
  }

  return `# Web Server Configuration (layout v3)

Module \`${appId}\` · runtime code \`${runtimeCode}\` · ${enabled ? 'enabled' : 'disabled'}

Authority: \`SDKWORK_WEBSERVER_SPEC.md\` · hosts: \`APP_RUNTIME_TOPOLOGY_NAMING.md\` §9.

## Layout

\`\`\`text
deployments/webserver/
  server.common.toml           # identity, nginx/main/http globals, platform certs, TLS defaults, upstream skeleton
  server.development.toml      # environment = "development" — hosts + include only
  server.test.toml             # environment = "test"
  server.staging.toml          # environment = "staging"
  server.production.toml       # environment = "production"
  server.standalone.toml       # profile = "standalone" (upstream targets)
  server.cloud.toml            # profile = "cloud" (platform gateway upstream)
  snippets/gateway-locations.production.conf   # full gateway proxy (api-only edge products)
  snippets/gateway-api-locations.production.conf  # /api/ + health only (Adaptive Web modules)
  snippets/gateway-locations.nonproduction.conf   # dev/test/staging full proxy to gateway
  snippets/adaptive-web.maps.conf            # PC/H5 UA maps (web / web+api modules only)
  snippets/adaptive-web.dispatch.conf      # location / dispatch
  snippets/adaptive-web.named-locations.conf  # @pc / @h5 static roots
  app-roots.example.toml                     # process Adaptive Web dist catalog (PC/H5)
\`\`\`

Merge at runtime:

\`\`\`text
effective(<profile>.<environment>) =
  merge(server.common.toml, server.<environment>.toml, server.<profile>.toml)
\`\`\`

## Lifecycle environments

| Environment | File | Hosts | Example | Listeners |
| --- | --- | ---: | --- | --- |
${envRows.join('\n')}

Surfaces: ${surfaces.length > 0 ? surfaces.join(', ') : 'none (placeholder)'}.

## Refresh and validate

\`\`\`bash
node sdkwork-specs/tools/webserver/align-webserver-workspace.mjs <sdkwork-space-root>
node sdkwork-specs/tools/webserver/audit-modules.mjs <sdkwork-space-root>
\`\`\`

Sidecars (required when \`nginx.enabled = true\`): \`nginx.<profile>.<environment>.conf\` must match \`effective(<profile>.<environment>)\` when \`nginx.strict = true\`. Regenerate with \`align-webserver-workspace.mjs\` or \`render-nginx-sidecars.mjs\`.
`;
}

export function writeWebserverLayout(moduleRoot, docs, { writeAppRoots = true, appId = null, topology = null } = {}) {
  const dir = path.join(moduleRoot, 'deployments', 'webserver');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.common.toml'), serializeToml(docs.common));
  for (const environment of LIFECYCLE_ENVIRONMENTS) {
    const envDoc = docs.environments?.[environment] ?? { environment };
    fs.writeFileSync(path.join(dir, `server.${environment}.toml`), serializeToml(envDoc));
  }
  fs.writeFileSync(path.join(dir, 'server.standalone.toml'), serializeToml(docs.standalone));
  fs.writeFileSync(path.join(dir, 'server.cloud.toml'), serializeToml(docs.cloud));
  if (docs.enabled !== false && docs.common?.enabled !== false) {
    const adaptiveWeb = docs.adaptiveWeb === true;
    writeGatewaySnippets(dir, { adaptiveWeb });
    if (adaptiveWeb) {
      writeAdaptiveWebSnippets(dir, docs.common?.id ?? path.basename(moduleRoot).replace(/^sdkwork-/u, ''));
      ensureStaticFallbackDir(dir);
    } else {
      pruneAdaptiveWebSnippets(dir);
    }
  }
  const legacy = path.join(dir, 'server.toml');
  if (fs.existsSync(legacy)) fs.rmSync(legacy);
  if (writeAppRoots && docs.enabled) {
    const appRoots = buildAppRootsExample({ appId: path.basename(moduleRoot), moduleRoot });
    if (appRoots) {
      fs.writeFileSync(path.join(dir, 'app-roots.example.toml'), appRoots);
    }
  }
  const readme = buildWebserverReadme({
    appId: appId ?? path.basename(moduleRoot),
    docs,
    topology,
  });
  fs.writeFileSync(path.join(dir, 'README.md'), readme);
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
      http: envServers.length > 0 ? { server: envServers } : {},
    };
  }

  const nextCommon = structuredClone(commonDoc);
  if (nextCommon.http) {
    delete nextCommon.http.server;
    nextCommon.http.certificates = platformCertificateRegistry();
    nextCommon.http.defaults = { tls: TLS_DEFAULTS };
    if (Object.keys(nextCommon.http).length === 0) delete nextCommon.http;
  }
  return { common: nextCommon, environments };
}
