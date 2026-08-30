import fs from 'node:fs';
import path from 'node:path';
import {
  isIgnoredGeneratedOrRuntimeDir,
  openApiAuthorityEntries,
  walkOpenApiFiles,
} from './http-response-envelope-patterns.mjs';
import {
  openApiOperationEntriesFromText,
} from './openapi-operation-utils.mjs';

export function normalizeRoutePath(routePath) {
  const raw = String(routePath ?? '').trim();
  if (!raw) return '';
  const withoutQuery = raw.split(/[?#]/u, 1)[0];
  const withCanonicalParams = withoutQuery
    .replace(/\/+/gu, '/')
    .replace(/\{[^}/]+\}/gu, '{param}')
    .replace(/<[^>/]+>/gu, '{param}')
    .replace(/(^|\/):[A-Za-z_][A-Za-z0-9_]*/gu, '$1{param}');
  if (withCanonicalParams.length > 1 && withCanonicalParams.endsWith('/')) {
    return withCanonicalParams.slice(0, -1);
  }
  return withCanonicalParams || '/';
}

export function classifyRoutePathCollisions(routes) {
  const groups = new Map();
  const issues = [];
  for (const route of routes) {
    if (!route?.method || !route?.path) continue;
    const listener = route.listener ?? route.surface ?? 'default';
    const method = String(route.method).toUpperCase();
    const normalizedPath = normalizeRoutePath(route.path);
    const key = `${listener}\0${method}\0${normalizedPath}`;
    const entries = groups.get(key) ?? [];
    entries.push({ ...route, listener, method, normalizedPath });
    groups.set(key, entries);
  }

  for (const entries of groups.values()) {
    const declarations = collapseEquivalentRepresentations(entries);
    issues.push(...classifyReservedRoutePathOwners(declarations));
    if (declarations.length <= 1) continue;
    if (declarations.every((entry) => hasOverrideAdr(entry))) continue;
    const first = declarations[0];
    const sources = declarations
      .map((entry) => `${entry.source}${entry.operationId ? `#${entry.operationId}` : ''}`)
      .join(', ');
    issues.push({
      kind: 'duplicate-route-path',
      detail: `${first.listener} ${first.method} ${first.normalizedPath} is declared by multiple route sources: ${sources}`,
      routes: declarations,
    });
  }
  return issues;
}

export function collectRouteRegistry(root) {
  const routes = [];
  routes.push(...collectOpenApiRoutes(root));
  routes.push(...collectRouteManifestRoutes(root));
  annotateDependencyOwnedOperations(root, routes);
  return routes.sort((left, right) => routeSortKey(left).localeCompare(routeSortKey(right)));
}

export function classifyRouteRegistry(root) {
  return classifyRoutePathCollisions(collectRouteRegistry(root));
}

function collectOpenApiRoutes(root) {
  const routes = [];
  for (const authority of openApiAuthorityEntries(walkOpenApiFiles(root))) {
    const text = readText(authority.file);
    if (text == null) continue;
    const parsed = openApiOperationEntriesFromText(text);
    const rel = toPosix(path.relative(root, authority.file));
    for (const entry of parsed.entries) {
      routes.push({
        sourceKind: 'openapi',
        projectionKind: openApiProjectionKind(rel),
        source: rel,
        repo: authority.repo,
        surface: authority.surface,
        method: entry.method.toUpperCase(),
        path: entry.routePath,
        operationId: entry.operation.operationId,
        routeCrate: entry.operation['x-sdkwork-source-route-crate'],
        overrideAdr: entry.operation['x-sdkwork-route-override-adr'],
      });
    }
  }
  return routes;
}

function collectRouteManifestRoutes(root) {
  const routes = [];
  for (const file of walkRouteManifestFiles(root)) {
    const manifest = readJson(file);
    if (!manifest || !isRouteManifest(manifest)) continue;
    const rel = toPosix(path.relative(root, file));
    const manifestSurface = manifest.surface ?? manifest.apiSurface ?? surfaceFromPath(file);
    const manifestRouteCrate = manifest.packageName ?? manifest.crate ?? manifest.crateName ?? manifest.name;
    const manifestOpenApiAuthority = manifest.source?.openApiAuthority ?? manifest.openApiAuthority;
    const entries = Array.isArray(manifest.routes) ? manifest.routes : [];
    for (const route of entries) {
      const routeSource = route.source && typeof route.source === 'object' ? route.source : {};
      routes.push({
        sourceKind: 'route-manifest',
        projectionKind: 'route-manifest',
        source: rel,
        surface: route.apiSurface ?? route.surface ?? manifestSurface,
        method: route.method,
        path: route.path ?? route.fullPath,
        operationId: route.operationId,
        routeCrate:
          route.routeCrate
          ?? routeSource.routeCrate
          ?? routeSource.crate
          ?? routeSource.crateName
          ?? manifestRouteCrate,
        sourceOpenApiAuthority: routeSource.openApiAuthority ?? manifestOpenApiAuthority,
        overrideAdr: route['x-sdkwork-route-override-adr'] ?? route.overrideAdr,
      });
    }
  }
  return routes;
}

function collapseEquivalentRepresentations(entries) {
  const declarations = [];
  for (const entry of entries) {
    const equivalent = declarations.find((candidate) => representsSameRouteDeclaration(candidate, entry));
    if (equivalent) {
      equivalent.source = `${equivalent.source}, ${entry.source}`;
      equivalent.overrideAdr = equivalent.overrideAdr ?? entry.overrideAdr;
      equivalent.routeCrate = equivalent.routeCrate ?? entry.routeCrate;
      continue;
    }
    declarations.push({ ...entry });
  }
  return declarations;
}

function representsSameRouteDeclaration(left, right) {
  if (isDerivedRouteManifestMirror(left, right)) return true;
  if (!left.operationId || left.operationId !== right.operationId) return false;
  if (isEquivalentDependencyOwnedProjection(left, right)) return true;
  if (left.routeCrate && right.routeCrate && left.routeCrate !== right.routeCrate) return false;
  if (left.sourceKind === 'openapi' && right.sourceKind === 'openapi') return true;
  if (isEquivalentRouteManifestProjection(left, right)) return true;
  if (isEquivalentOpenApiProjection(left, right)) return true;
  if (left.sourceKind === right.sourceKind) return false;
  return true;
}

/**
 * A route manifest produced by SDK generation is a derived mirror of the
 * OpenAPI authority that owns the route. When a route-manifest entry shares
 * the same physical route (surface/method/path, already grouped together) as an
 * OpenAPI projection, they describe the same installed route even though the
 * manifest names operations with a fully-qualified operationId that may differ
 * from the authority's short operationId. Treat the manifest as covered by the
 * authority instead of reporting a false duplicate.
 */
function isDerivedRouteManifestMirror(left, right) {
  const manifest = left.sourceKind === 'route-manifest' ? left
    : right.sourceKind === 'route-manifest' ? right
      : null;
  const openApi = left.sourceKind === 'openapi' ? left
    : right.sourceKind === 'openapi' ? right
      : null;
  return Boolean(manifest && openApi);
}

function isEquivalentDependencyOwnedProjection(left, right) {
  if (!left.dependencyOwnedOperationKey || left.dependencyOwnedOperationKey !== right.dependencyOwnedOperationKey) {
    return false;
  }
  const dependencyRouteCrate = left.dependencyRouteCrate ?? right.dependencyRouteCrate;
  if (!dependencyRouteCrate) return true;
  return left.routeCrate === dependencyRouteCrate || right.routeCrate === dependencyRouteCrate;
}

function isEquivalentRouteManifestProjection(left, right) {
  if (left.sourceKind !== 'route-manifest' || right.sourceKind !== 'route-manifest') return false;
  return Boolean(left.routeCrate && right.routeCrate && left.routeCrate === right.routeCrate);
}

function isEquivalentOpenApiProjection(left, right) {
  if (left.sourceKind !== 'openapi' || right.sourceKind !== 'openapi') return false;
  if (left.projectionKind === right.projectionKind) return false;
  const projectionKinds = new Set([left.projectionKind, right.projectionKind]);
  return projectionKinds.has('api-authority')
    && (projectionKinds.has('sdk-authority') || projectionKinds.has('generated-authority'));
}

function openApiProjectionKind(source) {
  if (/^apis\//u.test(source)) return 'api-authority';
  if (/^sdks\/[^/]+\/openapi\//u.test(source)) return 'sdk-authority';
  if (/^generated\/openapi\//u.test(source)) return 'generated-authority';
  if (/\/specs\/openapi\//u.test(source)) return 'api-authority';
  if (/\/sdks\/[^/]+\/openapi\//u.test(source)) return 'sdk-authority';
  if (/\/generated\/openapi\//u.test(source)) return 'generated-authority';
  return 'source-authority';
}

function hasOverrideAdr(route) {
  const adr = route.overrideAdr ?? route['x-sdkwork-route-override-adr'] ?? route.allowedOverrideAdr;
  return typeof adr === 'string' && /^ADR-[0-9A-Za-z_-]+/u.test(adr.trim());
}

function classifyReservedRoutePathOwners(routes) {
  const issues = [];
  for (const route of routes) {
    if (route.method !== 'GET') continue;
    if (!isReservedHealthRoutePath(route.normalizedPath)) continue;
    if (isApprovedHealthRouteOwner(route)) continue;
    issues.push({
      kind: 'reserved-route-path-owner',
      detail: `${route.listener} ${route.method} ${route.normalizedPath} is reserved for the standard health/readiness route owner; ${route.source}${route.operationId ? `#${route.operationId}` : ''} must use a capability-specific path or mount the standard health route component`,
      routes: [route],
    });
  }
  return issues;
}

function isReservedHealthRoutePath(routePath) {
  return /^\/(?:app|backend)\/v3\/api\/system\/(?:health|ready)$/u.test(routePath);
}

function isApprovedHealthRouteOwner(route) {
  const operationId = String(route.operationId ?? '').toLowerCase();
  if (
    route.normalizedPath.endsWith('/system/health') &&
    ['health.retrieve', 'system.health.retrieve'].includes(operationId)
  ) {
    return true;
  }
  if (
    route.normalizedPath.endsWith('/system/ready') &&
    ['ready.retrieve', 'system.ready.retrieve'].includes(operationId)
  ) {
    return true;
  }
  const ownerText = [
    route.routeCrate,
    route.source,
  ].filter(Boolean).join(' ').toLowerCase();
  return /(?:^|[/_-])(?:routes|router)?-?health(?:$|[/_-])/u.test(ownerText)
    || /(?:^|[/_-])system-health(?:$|[/_-])/u.test(ownerText)
    || /(?:^|[/_-])readiness(?:$|[/_-])/u.test(ownerText);
}

function walkRouteManifestFiles(root, acc = []) {
  if (!fs.existsSync(root)) return acc;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (isIgnoredGeneratedOrRuntimeDir(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkRouteManifestFiles(full, acc);
      continue;
    }
    if (/\.route-manifest\.json$/u.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function isRouteManifest(manifest) {
  return typeof manifest.kind === 'string'
    && /^sdkwork\.(?:http\.)?route[.-]manifest$/u.test(manifest.kind);
}

function surfaceFromPath(filePath) {
  const norm = toPosix(filePath);
  const match = norm.match(/\/_route-manifests\/([^/]+)\//u);
  return match?.[1] ?? 'default';
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readJson(filePath) {
  const text = readText(filePath);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function routeSortKey(route) {
  return [
    route.surface ?? '',
    route.method ?? '',
    normalizeRoutePath(route.path),
    route.source ?? '',
    route.operationId ?? '',
  ].join('\0');
}

function annotateDependencyOwnedOperations(root, routes) {
  const index = readDependencyOwnedOperationIndex(root);
  if (index.size === 0) return;
  for (const route of routes) {
    if (!route.operationId || !route.method || !route.path) continue;
    const listener = route.listener ?? route.surface ?? 'default';
    const key = dependencyOwnedOperationKey(
      listener,
      String(route.method).toUpperCase(),
      normalizeRoutePath(route.path),
      route.operationId,
    );
    const dependency = index.get(key);
    if (!dependency) continue;
    route.dependencyOwnedOperationKey = key;
    route.dependencyOwner = dependency.owner;
    route.dependencyWorkspace = dependency.workspace;
    route.dependencyRouteCrate = dependency.routeCrate;
  }
}

function readDependencyOwnedOperationIndex(root) {
  const manifest = readJson(path.join(root, 'specs', 'dependency-api-surfaces.json'));
  const index = new Map();
  if (!manifest) return index;
  const surfaces = Array.isArray(manifest.surfaces)
    ? manifest.surfaces
    : Array.isArray(manifest.dependencyApiSurfaces)
      ? manifest.dependencyApiSurfaces
      : Array.isArray(manifest.dependencies)
        ? manifest.dependencies
      : [];
  for (const surface of surfaces) {
    const surfaceId = surface.surface ?? surface.apiSurface;
    const dependencyRouteCrate =
      surface.runtimeIntegration?.rustRouteContractCrate?.crate
      ?? surface.rustRouteContractCrate?.crate;
    const operations = Array.isArray(surface.dependencyOwnedOperations)
      ? surface.dependencyOwnedOperations
      : [];
    for (const operation of operations) {
      if (!surfaceId || !operation.method || !operation.path || !operation.operationId) continue;
      const key = dependencyOwnedOperationKey(
        surfaceId,
        String(operation.method).toUpperCase(),
        normalizeRoutePath(operation.path),
        operation.operationId,
      );
      index.set(key, {
        owner: operation.owner,
        workspace: surface.workspace,
        routeCrate: dependencyRouteCrate,
      });
    }
  }
  return index;
}

function dependencyOwnedOperationKey(surface, method, normalizedPath, operationId) {
  return [surface, method, normalizedPath, operationId].join('\0');
}

function toPosix(filePath) {
  return filePath.replace(/\\/gu, '/');
}
