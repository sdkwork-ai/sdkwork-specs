// Adaptive Web plan folding for module deployments/webserver renders.
// Authority: SDKWORK_DEPLOY_SPEC.md §8 / §8.1, SDKWORK_WEBSERVER_SPEC.md §11.3.

import fs from 'node:fs';
import path from 'node:path';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function serverHasAdaptiveWiring(server) {
  return (server.include ?? []).some((entry) => (
    String(entry).includes('adaptive-web.named-locations.conf')
  )) || (server.location ?? []).some((location) => (
    location.match === '/'
    && Array.isArray(location.include)
    && location.include.some((entry) => String(entry).includes('adaptive-web.dispatch.conf'))
  ));
}

export function detectBrowserSurfaces(moduleRoot, appId) {
  const id = appId
    ?? path.basename(path.resolve(moduleRoot)).replace(/^sdkwork-/u, 'sdkwork-');
  const packageAppId = path.basename(path.resolve(moduleRoot));
  const candidates = [packageAppId, id];
  let pcExists = false;
  let h5Exists = false;
  for (const name of candidates) {
    if (fs.existsSync(path.join(moduleRoot, 'apps', `${name}-pc`, 'package.json'))) {
      pcExists = true;
    }
    if (fs.existsSync(path.join(moduleRoot, 'apps', `${name}-h5`, 'package.json'))) {
      h5Exists = true;
    }
  }
  return { pcExists, h5Exists, packageAppId };
}

/** Infer PC/H5 from app-roots.example.toml when apps/ is absent (example trees). */
export function detectBrowserSurfacesForWebserver(moduleRoot, webserverDir = null) {
  const dir = webserverDir ?? path.join(moduleRoot, 'deployments', 'webserver');
  const detected = detectBrowserSurfaces(moduleRoot);
  if (detected.pcExists || detected.h5Exists) return detected;
  const appRootsPath = path.join(dir, 'app-roots.example.toml');
  if (!fs.existsSync(appRootsPath)) return detected;
  const text = fs.readFileSync(appRootsPath, 'utf8');
  return {
    ...detected,
    pcExists: detected.pcExists || text.includes('[app_roots.pc_static_by_environment]'),
    h5Exists: detected.h5Exists || text.includes('[app_roots.h5_static_by_environment]'),
  };
}

/**
 * Fold Adaptive Web locations on the effective TOML document for stock nginx.
 *
 * Servers without Adaptive Web snippet wiring are left unchanged (edge
 * reverse-proxy only). Inventory-based collapse/static-fallback applies only
 * to servers that already declare Adaptive Web maps/dispatch.
 *
 * @param {object} effectiveDoc merged server.common + profile TOML
 * @param {{
 *   moduleRoot?: string,
 *   runtimeCode?: string,
 *   pcExists?: boolean,
 *   h5Exists?: boolean,
 *   staticRoot?: string,
 *   publicIngressHosts?: string[],
 * }} [options]
 */
export function applyAdaptiveWebFolding(effectiveDoc, options = {}) {
  const doc = cloneJson(effectiveDoc);
  const runtimeCode = options.runtimeCode ?? 'webserver';
  const detected = options.moduleRoot
    ? detectBrowserSurfacesForWebserver(options.moduleRoot, options.webserverDir)
    : { pcExists: options.pcExists, h5Exists: options.h5Exists };
  const pcExists = options.pcExists ?? detected.pcExists ?? false;
  const h5Exists = options.h5Exists ?? detected.h5Exists ?? false;
  const staticRoot =
    options.staticRoot
    ?? `/usr/share/sdkwork/${runtimeCode}/web/static`;
  const warnings = [];

  const http = doc.http;
  if (!http?.server) {
    return { doc, mode: 'proxy-passthrough', warnings };
  }

  const adaptiveServers = http.server.filter((server) => serverHasAdaptiveWiring(server));
  if (adaptiveServers.length === 0) {
    // Edge reverse-proxy modules (for example sdkwork-webserver with
    // expose.mode: api) keep PC/H5 and static delivery inside the process.
    return { doc, mode: 'proxy-passthrough', warnings };
  }

  let mode = 'adaptive';
  if (pcExists && h5Exists) {
    mode = 'adaptive';
  } else if (pcExists && !h5Exists) {
    mode = 'collapse-pc';
    warnings.push('h5 surface missing; collapsing public / to pc for all clients');
  } else if (!pcExists && h5Exists) {
    mode = 'collapse-h5';
    warnings.push('pc surface missing; collapsing public / to h5 for all clients');
  } else {
    mode = 'static-fallback';
    warnings.push(`neither pc nor h5 packaged; public / uses static-fallback root ${staticRoot}`);
  }

  if (mode !== 'adaptive' && Array.isArray(http.include)) {
    http.include = http.include.filter(
      (entry) => !String(entry).includes('adaptive-web.maps.conf'),
    );
  }

  for (const server of adaptiveServers) {
    if (mode === 'adaptive') {
      const includes = new Set(server.include ?? []);
      includes.add('snippets/adaptive-web.named-locations.conf');
      server.include = [...includes];
      for (const location of server.location ?? []) {
        if (location.match === '/') {
          delete location.root;
          delete location.tryFiles;
          delete location.index;
          delete location.returnStatus;
          delete location.returnBody;
          delete location.proxyPass;
          location.include = ['snippets/adaptive-web.dispatch.conf'];
        }
      }
      continue;
    }

    if (Array.isArray(server.include)) {
      server.include = server.include.filter(
        (entry) => !String(entry).includes('adaptive-web.named-locations.conf'),
      );
      if (server.include.length === 0) {
        delete server.include;
      }
    }

    for (const location of server.location ?? []) {
      if (location.match !== '/') {
        continue;
      }
      // Dev hosts that proxy `/` to the gateway stay untouched.
      if (location.proxyPass !== undefined && !location.include) {
        continue;
      }
      delete location.include;
      delete location.proxyPass;
      delete location.returnStatus;
      delete location.returnBody;
      if (mode === 'collapse-pc') {
        location.root = `/usr/share/sdkwork/${runtimeCode}/web/pc`;
        location.index = ['index.html'];
        location.tryFiles = ['$uri', '$uri/', '/index.html'];
      } else if (mode === 'collapse-h5') {
        location.root = `/usr/share/sdkwork/${runtimeCode}/web/h5`;
        location.index = ['index.html'];
        location.tryFiles = ['$uri', '$uri/', '/index.html'];
      } else {
        location.root = staticRoot;
        location.index = ['index.html'];
        location.tryFiles = ['$uri', '$uri/', '=404'];
      }
    }
  }

  return { doc, mode, warnings };
}
