#!/usr/bin/env node
/**
 * Shared discovery helpers for API assembly materialize/validate tooling.
 * Authority: API_ASSEMBLY_SPEC.md, WEB_BACKEND_SPEC.md section 4.2.1.
 */
import fs from 'node:fs';
import path from 'node:path';

const GATEWAY_MOUNT_PATTERN = /pub\s+(?:async\s+)?fn\s+gateway_mount\b/u;
const GATEWAY_MOUNT_BUSINESS_PATTERN = /pub\s+(?:async\s+)?fn\s+gateway_mount_business\b/u;
const GATEWAY_MANIFEST_PATTERN =
  /pub\s+(?:async\s+)?fn\s+gateway_route_manifest\b|pub\s+const\s+GATEWAY_ROUTE_MANIFEST\b/u;
const GATEWAY_HTTP_ROUTE_MANIFEST_PATTERN =
  /pub\s+fn\s+gateway_route_manifest\s*\(\s*\)\s*->\s*(?:sdkwork_web_core::)?HttpRouteManifest\b/u;
const FORBIDDEN_GATEWAY_MERGE_PATTERN =
  /(?:router\s*=\s*router\s*\.merge\s*\(|\.merge\s*\()\s*(?:sdkwork_routes_|sdkwork-routes-)/u;
const ROUTE_INFRA_MOUNT_PATTERN =
  /mount_infra_routes\s*\(|mount_[a-z0-9_]+_infra_routes\s*\(|service_router\s*\(/u;
const ASSEMBLY_MULTI_GATEWAY_MOUNT_PATTERN =
  /router\s*=\s*router\s*\.merge\s*\(\s*sdkwork_routes_[a-z0-9_]+::gateway_mount\b/gu;
const DESCRIPTOR_ONLY_GATEWAY_MOUNT_PATTERN =
  /pub\s+(?:async\s+)?fn\s+gateway_mount\s*\([^)]*\)\s*(?:->\s*[^\{]+)?\{\s*(?:axum::)?Router::new\(\)\s*\}/u;
const EXECUTABLE_ROUTER_RETURN_PATTERN =
  /(?:^|[<,(\s])(?:axum::)?Router(?:\s*<|[,)>\s]|$)/u;
const AUTHORED_HTTP_ROUTER_PATTERN = /(?:axum::)?Router(?:\s*<[^>{}]+>)?::new\s*\(/u;
const AUTHORED_HTTP_ROUTE_PATTERN = /\.route(?:_service)?\s*\(/u;
const AUTHORED_HTTP_ROUTE_LITERAL_PATTERN = /\.route(?:_service)?\s*\(\s*"([^"]+)"/gu;
const PROCESS_INFRA_ROUTE_PATHS = new Set(['/healthz', '/readyz', '/metrics']);
const AUTHORED_HTTP_SCAN_SKIP_DIRS = new Set([
  '.git', '.runtime', 'artifacts', 'benches', 'dist', 'examples', 'external', 'fixtures',
  'generated', 'node_modules', 'target', 'test', 'tests', 'vendor',
]);

export function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function readJson(filePath) {
  const text = readText(filePath);
  if (!text.trim()) {
    return null;
  }
  return JSON.parse(text.replace(/^\uFEFF/u, ''));
}

export function resolveApplicationCode(root) {
  const base = path.basename(path.resolve(root));
  const match = /^sdkwork-([a-z0-9-]+)$/u.exec(base);
  if (match) {
    return match[1];
  }
  if (fs.existsSync(path.join(root, 'agent.app.config.json'))) {
    throw new Error(
      `application root directory must be sdkwork-<application-code>; cannot derive API assembly identity from ${base}`,
    );
  }
  return base.replace(/[^a-z0-9-]/gu, '-');
}

export function assemblyCrateDir(applicationCode) {
  return `crates/sdkwork-api-${applicationCode}-assembly`;
}

export function assemblyPackageName(applicationCode) {
  return `sdkwork-api-${applicationCode}-assembly`;
}

/** Adds one Cargo workspace member and removes duplicate canonical member lines. */
export function ensureCargoWorkspaceMember(root, member, { write = true } = {}) {
  const cargoPath = path.join(root, 'Cargo.toml');
  const cargo = readText(cargoPath);
  const membersMatch = /members\s*=\s*\[([\s\S]*?)\]/u.exec(cargo);
  if (!membersMatch) return false;

  let found = false;
  let changed = false;
  const normalizedMember = member.replaceAll('\\', '/');
  const emptyMembers = !membersMatch[1].trim();
  const lines = membersMatch[1].split('\n').filter((line) => {
    const quoted = /^\s*"([^"]+)"\s*,?\s*$/u.exec(line);
    if (!quoted || quoted[1].replaceAll('\\', '/') !== normalizedMember) return true;
    if (!found) {
      found = true;
      return true;
    }
    changed = true;
    return false;
  });
  if (!found) {
    if (emptyMembers) {
      lines.splice(0, lines.length, '', `    "${normalizedMember}",`, '');
    } else {
      lines.splice(lines[0]?.trim() ? 0 : 1, 0, `    "${normalizedMember}",`);
    }
    changed = true;
  }
  if (!changed) return false;

  const updatedBody = lines.join('\n');
  const bodyStart = membersMatch.index + membersMatch[0].indexOf('[') + 1;
  const updated = `${cargo.slice(0, bodyStart)}${updatedBody}${cargo.slice(
    bodyStart + membersMatch[1].length,
  )}`;
  if (write) fs.writeFileSync(cargoPath, updated, 'utf8');
  return true;
}

function isAuthoredHttpScanSkippedDirectory(name) {
  return AUTHORED_HTTP_SCAN_SKIP_DIRS.has(name) || name.startsWith('target-');
}

function walkAuthoredRustSources(root, current, excludedRoots, sources) {
  if (!fs.existsSync(current)) return;
  const resolvedCurrent = path.resolve(current);
  if (excludedRoots.some((excluded) => resolvedCurrent === excluded || resolvedCurrent.startsWith(`${excluded}${path.sep}`))) {
    return;
  }
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && isAuthoredHttpScanSkippedDirectory(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkAuthoredRustSources(root, absolute, excludedRoots, sources);
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      sources.push({
        absolute,
        relative: path.relative(root, absolute).replaceAll('\\', '/'),
      });
    }
  }
}

/**
 * Finds production Rust sources that construct and mount executable HTTP routes outside the
 * canonical API assembly. This rejects an apiMode:none declaration that merely hides legacy HTTP
 * ownership instead of migrating it into route crates.
 */
export function findAuthoredRustHttpRouterEvidence(root, applicationCode) {
  const repositoryRoot = path.resolve(root);
  const excludedRoots = [
    path.resolve(repositoryRoot, assemblyCrateDir(applicationCode)),
  ];
  const sources = [];
  for (const sourceRoot of ['services', 'crates']) {
    walkAuthoredRustSources(
      repositoryRoot,
      path.join(repositoryRoot, sourceRoot),
      excludedRoots,
      sources,
    );
  }
  return sources
    .filter(({ absolute }) => {
      const productionSource = readText(absolute).split(/#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/u, 1)[0];
      if (!AUTHORED_HTTP_ROUTER_PATTERN.test(productionSource)
        || !AUTHORED_HTTP_ROUTE_PATTERN.test(productionSource)) {
        return false;
      }

      const routeCalls = productionSource.match(/\.route(?:_service)?\s*\(/gu) ?? [];
      const literalPaths = [...productionSource.matchAll(AUTHORED_HTTP_ROUTE_LITERAL_PATTERN)]
        .map((match) => match[1]);
      const usesCanonicalInfraMount = ROUTE_INFRA_MOUNT_PATTERN.test(productionSource);
      const isProcessInfrastructureOnly = usesCanonicalInfraMount
        && routeCalls.length === literalPaths.length
        && literalPaths.every((routePath) => PROCESS_INFRA_ROUTE_PATHS.has(routePath));

      return !isProcessInfrastructureOnly;
    })
    .map(({ relative }) => relative)
    .sort((left, right) => left.localeCompare(right));
}

export function parseCargoWorkspaceMembers(root) {
  const cargoToml = readText(path.join(root, 'Cargo.toml'));
  const members = [];
  const membersMatch = /\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/u.exec(cargoToml);
  if (!membersMatch) {
    return members;
  }
  const body = membersMatch[1];
  for (const line of body.split('\n')) {
    for (const quoted of line.matchAll(/"([^"]+)"/gu)) {
      members.push(quoted[1].replace(/\\/gu, '/'));
    }
  }
  return members;
}

export function discoverRouteCrates(root, applicationCode) {
  const members = [...new Set(parseCargoWorkspaceMembers(root))];
  const routeMembers = members
    .filter((member) => /^crates\/sdkwork-routes-[a-z0-9-]+-(?:app|backend|open|internal)-api$/u.test(member))
    .filter((member) => !/^sdkwork-routes-health-/u.test(path.basename(member)))
    .filter((member) => !/-common$/u.test(path.basename(member)))
    .sort((a, b) => a.localeCompare(b));

  return routeMembers.map((memberDir) => {
    const crateRoot = path.join(root, memberDir);
    const cargoToml = readText(path.join(crateRoot, 'Cargo.toml'));
    const packageMatch = /^\s*name\s*=\s*"([^"]+)"/mu.exec(cargoToml);
    const packageName = packageMatch?.[1] ?? path.basename(memberDir);
    const libName = packageName.replace(/-/gu, '_');
    const libRs = [
      readText(path.join(crateRoot, 'src', 'lib.rs')),
      readText(path.join(crateRoot, 'src', 'routes.rs')),
    ].join('\n');
    const manifestRs = readText(path.join(crateRoot, 'src', 'manifest.rs'));
    const componentRef = `${memberDir}/specs/component.spec.json`;
    const componentPath = path.join(root, componentRef);
    const component = readJson(componentPath);
    const routeManifest = component?.contracts?.routeManifest;
    const routeManifestRef = resolveRouteManifestRef(root, memberDir, routeManifest);
    const pathPrefix = extractPathPrefix(libRs, manifestRs);
    const declaredSurface = component?.component?.surface;
    const surface = ['app-api', 'backend-api', 'open-api', 'internal-api'].includes(declaredSurface)
      ? declaredSurface
      : extractSurface(packageName);
    const gatewayMountReturn = extractGatewayMountReturn(libRs);
    const hasDelegatedDescriptorOnlyGatewayMount =
      functionTransitivelyReturnsEmptyRouter(libRs, 'gateway_mount');
    return {
      memberDir,
      packageName,
      libName,
      pathPrefix,
      surface,
      hasComponentSpec: fs.existsSync(componentPath),
      componentRef,
      routeManifestRef,
      routeManifestExists: routeManifestReferenceExists(root, routeManifestRef),
      routeManifestInsideRoot: !routeManifestRef.startsWith('../'),
      sourceRef: `${memberDir}/Cargo.toml`,
      hasGatewayMount: GATEWAY_MOUNT_PATTERN.test(libRs),
      hasDescriptorOnlyGatewayMount: DESCRIPTOR_ONLY_GATEWAY_MOUNT_PATTERN.test(libRs),
      hasDelegatedDescriptorOnlyGatewayMount,
      gatewayMountReturn,
      hasExecutableGatewayMount: gatewayMountReturn !== null
        && EXECUTABLE_ROUTER_RETURN_PATTERN.test(gatewayMountReturn),
      hasGatewayMountBusiness: GATEWAY_MOUNT_BUSINESS_PATTERN.test(libRs),
      hasGatewayRouteManifest: GATEWAY_MANIFEST_PATTERN.test(libRs),
      hasHttpRouteManifestAccessor: GATEWAY_HTTP_ROUTE_MANIFEST_PATTERN.test(libRs),
      mountsInfrastructure: routeCrateMountsInfrastructure(root, memberDir),
    };
  });
}

function extractRustFunctionBodies(source) {
  const functions = new Map();
  const pattern = /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gu;
  for (const match of source.matchAll(pattern)) {
    const bodyStart = source.indexOf('{', match.index + match[0].length);
    if (bodyStart < 0) continue;

    let depth = 0;
    let bodyEnd = -1;
    for (let index = bodyStart; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          bodyEnd = index;
          break;
        }
      }
    }
    if (bodyEnd > bodyStart) {
      functions.set(match[1], source.slice(bodyStart + 1, bodyEnd).trim());
    }
  }
  return functions;
}

function functionTransitivelyReturnsEmptyRouter(source, entrypoint) {
  const functions = extractRustFunctionBodies(source);
  const visiting = new Set();

  function resolvesToEmptyRouter(functionName) {
    if (visiting.has(functionName)) return false;
    const body = functions.get(functionName);
    if (!body) return false;

    const compact = body.replace(/\s+/gu, '');
    if (/^(?:axum::)?Router::new\(\)$/u.test(compact)) {
      return true;
    }

    const delegated = /^(?:return)?(?:[a-zA-Z_][a-zA-Z0-9_]*::)*([a-zA-Z_][a-zA-Z0-9_]*)\([^;]*\)(?:\.await)?;?$/u
      .exec(compact);
    if (!delegated) return false;

    visiting.add(functionName);
    const result = resolvesToEmptyRouter(delegated[1]);
    visiting.delete(functionName);
    return result;
  }

  return resolvesToEmptyRouter(entrypoint);
}

function resolveRouteManifestRef(root, memberDir, declaredValue) {
  if (typeof declaredValue !== 'string' || !declaredValue.trim()) {
    return `${memberDir}/specs/component.spec.json#contracts.routeManifest`;
  }

  const declared = declaredValue.trim().replace(/\\/gu, '/').replace(/^\.\//u, '');
  const baseDir = declared.startsWith('sdks/_route-manifests/')
    ? root
    : path.join(root, memberDir);
  const absolute = path.resolve(baseDir, declared);
  return path.relative(root, absolute).replace(/\\/gu, '/');
}

function routeManifestReferenceExists(root, routeManifestRef) {
  const [fileRef, symbolRef] = String(routeManifestRef ?? '').split('#', 2);
  const absolutePath = path.join(root, fileRef);
  if (!fs.existsSync(absolutePath)) {
    return false;
  }
  if (!symbolRef) {
    return true;
  }

  const source = fs.readFileSync(absolutePath, 'utf8');
  const escapedSymbol = symbolRef.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(
    `\\b(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${escapedSymbol}\\b`,
    'u',
  ).test(source);
}

function extractGatewayMountReturn(source) {
  const functionMatch = /pub\s+(?:async\s+)?fn\s+gateway_mount\b/u.exec(source);
  if (!functionMatch) return null;

  const signatureStart = functionMatch.index + functionMatch[0].length;
  const paramsStart = source.indexOf('(', signatureStart);
  if (paramsStart < 0) return null;

  let depth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        paramsEnd = index + 1;
        break;
      }
    }
  }
  if (paramsEnd < 0) return null;

  const tail = source.slice(paramsEnd);
  const arrowMatch = /^\s*->\s*/u.exec(tail);
  if (!arrowMatch) return null;
  const returnStart = arrowMatch[0].length;
  const returnTail = tail.slice(returnStart);
  const terminator = /\s+where\b|\s*\{/u.exec(returnTail);
  return returnTail.slice(0, terminator?.index ?? returnTail.length).trim() || null;
}

function extractSurface(packageName) {
  if (packageName.endsWith('-open-api')) {
    return 'open-api';
  }
  if (packageName.endsWith('-app-api')) {
    return 'app-api';
  }
  if (packageName.endsWith('-backend-api')) {
    return 'backend-api';
  }
  return 'unknown';
}

/** Support crates (manifests, web bootstrap) are not gateway mount surfaces. */
export function isSupportRouteCrate(packageName) {
  return /-(?:http-auth|http-shared|shared|support)$/u.test(packageName);
}

export function assemblyMountRouteCrates(routeCrates) {
  return routeCrates.filter((crate) => !isSupportRouteCrate(crate.packageName));
}

function extractPathPrefix(libRs, manifestRs) {
  const constMatch =
    /pub\s+const\s+(?:OPEN|APP|BACKEND)_API_PREFIX\s*:\s*&str\s*=\s*"([^"]+)"/u.exec(libRs) ??
    /pub\s+const\s+\w+_PREFIX\s*:\s*&str\s*=\s*"([^"]+)"/u.exec(libRs) ??
    /prefix\s*:\s*"([^"]+)"/u.exec(manifestRs);
  return constMatch?.[1] ?? null;
}

export function usesKernelBridgeAssembly(bootstrapSource) {
  return /build_agents_served_router|sdkwork_agents_kernel_bridge/u.test(bootstrapSource);
}

export function buildAssemblyManifest(root, applicationCode, routeCrates) {
  return {
    kind: 'sdkwork.api.assembly',
    schemaVersion: 1,
    applicationCode,
    apiMode: routeCrates.length > 0 ? 'served' : 'none',
    packageName: assemblyPackageName(applicationCode),
    crateDir: assemblyCrateDir(applicationCode),
    routeCrates: routeCrates.map((crate, index) => ({
      packageName: crate.packageName,
      memberDir: crate.memberDir,
      libName: crate.libName,
      surface: crate.surface,
      pathPrefix: crate.pathPrefix,
      mountOrder: index,
      componentRef: crate.componentRef,
      routeManifestRef: crate.routeManifestRef,
      sourceRef: crate.sourceRef,
    })),
  };
}

export function routeCratesUseDescriptorOnlyGatewayMount(root, applicationCode) {
  const routeCrates = discoverRouteCrates(root, applicationCode);
  if (routeCrates.length === 0) {
    return false;
  }
  for (const crate of routeCrates) {
    const libRs = readText(path.join(root, crate.memberDir, 'src', 'lib.rs'));
    if (/pub fn gateway_mount\(\) -> (?:axum::)?Router/u.test(libRs)) {
      return false;
    }
    if (/pub fn gateway_mount\(\)/u.test(libRs) && !/-> (?:axum::)?Router/u.test(libRs)) {
      continue;
    }
    if (/gateway_mount_business\s*\(/u.test(libRs)) {
      return false;
    }
  }
  return routeCrates.length > 0;
}

export function findGatewaySourceFiles(root, applicationCode) {
  const candidates = [
    path.join(root, 'crates', `sdkwork-api-${applicationCode}-standalone-gateway`, 'src'),
    path.join(root, 'crates', `sdkwork-${applicationCode}-standalone-gateway`, 'src'),
    path.join(root, 'crates', `sdkwork-${applicationCode}-cloud-gateway`, 'src'),
    path.join(root, 'services', `sdkwork-${applicationCode}-standalone-gateway`, 'src'),
    path.join(root, 'services', `sdkwork-${applicationCode}-cloud-gateway`, 'src'),
  ];
  const files = [];
  for (const dir of candidates) {
    collectRustSourceFiles(dir, files);
  }
  return files;
}

function collectRustSourceFiles(dir, files) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRustSourceFiles(full, files);
    } else if (entry.name.endsWith('.rs')) {
      files.push(full);
    }
  }
}

export function isApplicationOwnedRouteDep(depName, applicationCode) {
  const normalized = depName.replace(/_/g, '-');
  return new RegExp(`^sdkwork-routes-${applicationCode}-`, 'u').test(normalized);
}

export function standaloneGatewayUsesSplitSurfaceBinsOnly(root, applicationCode) {
  let cargoPath = path.join(root, 'crates', `sdkwork-api-${applicationCode}-standalone-gateway`, 'Cargo.toml');
  if (!fs.existsSync(cargoPath)) {
    cargoPath = path.join(root, 'crates', `sdkwork-${applicationCode}-standalone-gateway`, 'Cargo.toml');
  }
  if (!fs.existsSync(cargoPath)) {
    const legacyPath = path.join(root, 'crates', `sdkwork-${applicationCode}-api-server`, 'Cargo.toml');
    if (!fs.existsSync(legacyPath)) {
      return false;
    }
    return splitSurfaceBinsInCargo(readText(legacyPath), applicationCode);
  }
  return splitSurfaceBinsInCargo(readText(cargoPath), applicationCode);
}

/** @deprecated use standaloneGatewayUsesSplitSurfaceBinsOnly */
export function apiServerUsesSplitSurfaceBinsOnly(root, applicationCode) {
  return standaloneGatewayUsesSplitSurfaceBinsOnly(root, applicationCode);
}

function splitSurfaceBinsInCargo(cargo, applicationCode) {
  const binNames = [...cargo.matchAll(/\[\[bin\]\][\s\S]*?name\s*=\s*"([^"]+)"/gu)].map(
    (match) => match[1],
  );
  if (binNames.length === 0) {
    return false;
  }
  const hasUnifiedGateway = binNames.some(
    (name) =>
      name === `sdkwork-api-${applicationCode}-standalone-gateway` ||
      name === `sdkwork-${applicationCode}-standalone-gateway` ||
      name === `sdkwork-${applicationCode}-api-server`,
  );
  if (hasUnifiedGateway) {
    return false;
  }
  const hasApp = binNames.some((name) => /-app-api$/u.test(name));
  const hasBackend = binNames.some((name) => /-backend-api$/u.test(name));
  return hasApp && hasBackend;
}

export function scanForbiddenGatewayMerges(gatewaySourceFiles, assemblyCrateDir) {
  const hits = [];
  for (const filePath of gatewaySourceFiles) {
    const normalized = filePath.replace(/\\/gu, '/');
    if (normalized.includes(`${assemblyCrateDir}/`)) {
      continue;
    }
    const text = readText(filePath);
    if (FORBIDDEN_GATEWAY_MERGE_PATTERN.test(text)) {
      hits.push(normalized);
    }
  }
  return hits;
}

const ROUTE_BUILDER_PATTERN =
  /pub\s+(?:async\s+)?fn\s+build_[a-zA-Z0-9_]*router[a-zA-Z0-9_]*/u;

export function routeCrateMountsInfrastructure(root, memberDir) {
  for (const rel of ['src/lib.rs', 'src/routes.rs', 'src/health.rs', 'src/infra.rs']) {
    const text = readText(path.join(root, memberDir, rel));
    if (ROUTE_INFRA_MOUNT_PATTERN.test(text)) {
      return true;
    }
  }
  return false;
}

export function parseGatewayMountBusinessSignature(libRs) {
  const match = /pub\s+(async\s+)?fn\s+gateway_mount_business\s*\(([^)]*)\)/u.exec(libRs);
  if (!match) {
    return null;
  }
  return {
    async: Boolean(match[1]),
    params: match[2].trim(),
    paramNames: match[2]
      .trim()
      .split(',')
      .map((part) => part.trim().split(':')[0].trim())
      .filter(Boolean),
  };
}

export function discoverGatewayBusinessMounts(root, routeCrates) {
  return routeCrates.map((crate) => {
    const source = [
      readText(path.join(root, crate.memberDir, 'src', 'lib.rs')),
      readText(path.join(root, crate.memberDir, 'src', 'routes.rs')),
    ].join('\n');
    const mount = parseGatewayMountBusinessSignature(source);
    return { ...crate, mount };
  });
}

export function scanAssemblyInfraMergeViolations(bootstrapSource, routeCrates) {
  const errors = [];
  const mountCalls = [...bootstrapSource.matchAll(ASSEMBLY_MULTI_GATEWAY_MOUNT_PATTERN)];
  if (mountCalls.length < 2) {
    return errors;
  }
  const infraSurfaces = routeCrates.filter((crate) => crate.mountsInfrastructure);
  if (infraSurfaces.length === 0) {
    return errors;
  }
  const usesBusinessMount = /gateway_mount_business\s*\(/u.test(bootstrapSource);
  const mountsInfraOnce =
    /assemble_multi_surface_router\s*\(/u.test(bootstrapSource)
    || /mount_infra_routes\s*\(/u.test(bootstrapSource)
    || /mount_[a-z0-9_]+_infra_routes\s*\(/u.test(bootstrapSource);
  if (!usesBusinessMount) {
    errors.push(
      `assembly bootstrap merges ${mountCalls.length} gateway_mount surfaces while ${infraSurfaces
        .map((crate) => crate.packageName)
        .join(', ')} mount infrastructure; use gateway_mount_business`,
    );
  }
  if (!mountsInfraOnce) {
    errors.push(
      'assembly bootstrap must mount infrastructure once via assemble_multi_surface_router or mount_*_infra_routes',
    );
  }
  return errors;
}

export function routeCrateExpectsDelegatableMount(root, memberDir) {
  for (const rel of ['src/lib.rs', 'src/routes.rs', 'src/account_router.rs', 'src/app_catalog_router.rs']) {
    const text = readText(path.join(root, memberDir, rel));
    if (ROUTE_BUILDER_PATTERN.test(text)) {
      return true;
    }
  }
  return false;
}

export function parseGatewayMountSignature(libRs) {
  const match = /pub\s+(async\s+)?fn\s+gateway_mount\s*\(([^)]*)\)/u.exec(libRs);
  if (!match) {
    return null;
  }
  return {
    async: Boolean(match[1]),
    params: match[2].trim(),
    paramNames: match[2]
      .trim()
      .split(',')
      .map((part) => part.trim().split(':')[0].trim())
      .filter(Boolean),
  };
}

export function discoverGatewayMounts(root, routeCrates) {
  return routeCrates.map((crate) => {
    const source = [
      readText(path.join(root, crate.memberDir, 'src', 'lib.rs')),
      readText(path.join(root, crate.memberDir, 'src', 'routes.rs')),
    ].join('\n');
    const mount = parseGatewayMountSignature(source);
    return { ...crate, mount };
  });
}
