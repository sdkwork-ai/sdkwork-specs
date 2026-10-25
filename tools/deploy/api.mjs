import fs from 'node:fs';
import path from 'node:path';
import { normalizeUpstream, resolveDomainSurfaceId, resolveSurfaceBind } from './topology-env.mjs';

export { resolveDomainSurfaceId } from './topology-env.mjs';

function collectOpenApiFiles(repoRoot) {
  const apisRoot = path.join(repoRoot, 'apis');
  if (!fs.existsSync(apisRoot)) {
    return [];
  }
  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(openapi\.json|yaml|yml)$/i.test(entry.name)) {
        results.push(full);
      }
    }
  };
  walk(apisRoot);
  return results;
}

function extractPrefixesFromOpenApi(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const prefixes = new Set();
  const jsonPathMatches = [...text.matchAll(/"(\/[^"]+\/v\d+\/api[^"]*)"/g)];
  const yamlPathMatches = [...text.matchAll(/^\s{2}(\/[^:\s]+\/v\d+\/api[^:]*):\s*$/gm)];
  for (const match of [...jsonPathMatches, ...yamlPathMatches]) {
    const full = match[1].trim();
    const parts = full.split('/').filter(Boolean);
    if (parts.length >= 3) {
      prefixes.add(`/${parts.slice(0, 3).join('/')}`);
    }
  }
  return [...prefixes];
}

function apiKindFromPrefix(prefix) {
  if (prefix.startsWith('/internal/')) return 'internal-api';
  if (prefix.startsWith('/app/')) return 'app-api';
  if (prefix.startsWith('/backend/')) return 'backend-api';
  return 'open-api';
}

export function resolveApiSurfaces(appConfig, repoRoot) {
  const fromManifest = [];
  for (const surface of appConfig?.apiSurfaces ?? []) {
    if (surface?.apiPrefix) {
      fromManifest.push({
        kind: surface.kind ?? 'unknown',
        prefix: surface.apiPrefix,
        source: 'agent.app.config.json',
      });
    }
  }

  const fromOpenApi = [];
  for (const file of collectOpenApiFiles(repoRoot)) {
    for (const prefix of extractPrefixesFromOpenApi(file)) {
      fromOpenApi.push({
        kind: apiKindFromPrefix(prefix),
        prefix,
        source: path.relative(repoRoot, file),
      });
    }
  }

  const merged = [];
  const seen = new Set();
  for (const item of [...fromManifest, ...fromOpenApi]) {
    const key = item.prefix;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export function resolveWebsocketPath(topology) {
  return topology?.surfaces?.['application.public-ingress']?.websocketPath ?? null;
}

const SURFACE_API_KINDS = {
  'application.public-ingress': new Set(['app-api', 'backend-api', 'open-api', 'internal-api', 'unknown']),
  'application.app-http': new Set(['app-api']),
  'application.backend-http': new Set(['backend-api']),
  'operations.control-ingress': new Set(['backend-api']),
  'platform.api-gateway': new Set(['open-api', 'platform-api', 'unknown']),
};

export function filterApiSurfacesForSurface(apiSurfaces, surfaceId) {
  const allowed = SURFACE_API_KINDS[surfaceId];
  if (!allowed) {
    return [];
  }
  return (apiSurfaces ?? []).filter((item) => allowed.has(item.kind));
}

export function resolveUpstreams(topology, overrides = {}, profileEnv = {}) {
  const surfaces = topology?.surfaces ?? {};
  const upstreams = {};

  for (const [key, surfaceId] of [
    ['application', 'application.public-ingress'],
    ['platform', 'platform.api-gateway'],
    ['operations', 'operations.control-ingress'],
  ]) {
    if (!surfaces[surfaceId]) {
      continue;
    }
    const resolved = resolveSurfaceBind(topology, profileEnv, surfaceId, overrides);
    if (resolved) {
      upstreams[key] = resolved;
    }
  }

  if (overrides?.proxy?.upstreams) {
    for (const [key, value] of Object.entries(overrides.proxy.upstreams)) {
      upstreams[key] = normalizeUpstream(value);
    }
  }

  if (!upstreams.application && topology?.defaults?.gatewayBind) {
    upstreams.application = normalizeUpstream(topology.defaults.gatewayBind);
  }

  return upstreams;
}

export function upstreamForSurface(upstreams, surfaceId) {
  switch (surfaceId) {
    case 'platform.api-gateway':
      return upstreams.platform ?? upstreams.application;
    case 'operations.control-ingress':
      return upstreams.operations ?? upstreams.application;
    default:
      return upstreams.application;
  }
}

export function detectApiPrefixConflicts(apiSurfaces) {
  const byPrefix = new Map();
  for (const item of apiSurfaces) {
    const list = byPrefix.get(item.prefix) ?? [];
    list.push(item);
    byPrefix.set(item.prefix, list);
  }
  const conflicts = [];
  for (const [prefix, items] of byPrefix) {
    const sources = new Set(items.map((i) => i.source));
    if (sources.size > 1 && items.some((i) => i.source === 'agent.app.config.json')) {
      conflicts.push(`api prefix "${prefix}" declared in multiple authorities: ${[...sources].join(', ')}`);
    }
  }
  return conflicts;
}
