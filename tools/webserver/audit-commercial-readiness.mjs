#!/usr/bin/env node
// Commercial-readiness audit beyond W1-W29 (sidecars, snippets, app-roots, static fallback).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sidecarFileName, DEPLOYMENT_PROFILES, LIFECYCLE_ENVIRONMENTS } from './layout-v3.mjs';
import { moduleUsesAdaptiveWebEdge, isEdgeProxyOnlyModule } from './expose-mode.mjs';
import { detectBrowserSurfacesForWebserver } from './adaptive-web.mjs';
import { ADAPTIVE_SNIPPET_PATHS } from './adaptive-web-snippets.mjs';
import { GATEWAY_SNIPPET_PATHS } from './gateway-snippets.mjs';
import { validateWebserverDir } from './validate.mjs';

const workspace = path.resolve(process.argv[2] ?? 'E:/sdkwork-space');
const critical = [];
const warnings = [];
const optimizations = [];

function add(level, module, message) {
  (level === 'critical' ? critical : level === 'warning' ? warnings : optimizations).push({ module, message });
}

export function auditCommercialReadiness(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const localCritical = [];
  const localWarnings = [];
  const localOptimizations = [];

  function localAdd(level, module, message) {
    (level === 'critical' ? localCritical : level === 'warning' ? localWarnings : localOptimizations).push({ module, message });
  }

  for (const name of fs.readdirSync(root).filter((n) => n.startsWith('sdkwork-')).sort()) {
    const moduleRoot = path.join(root, name);
    const webserverDir = path.join(moduleRoot, 'deployments/webserver');
    if (!fs.existsSync(webserverDir)) continue;

    const validation = validateWebserverDir(moduleRoot);
    if (!validation.ok) {
      for (const error of validation.errors.slice(0, 2)) localAdd('critical', name, error);
      continue;
    }

    const commonPath = path.join(webserverDir, 'server.common.toml');
    if (!fs.existsSync(commonPath)) continue;
    const commonText = fs.readFileSync(commonPath, 'utf8');
    const enabled = !commonText.includes('enabled = false');

    if (!enabled) continue;

    for (const profile of DEPLOYMENT_PROFILES) {
      for (const environment of LIFECYCLE_ENVIRONMENTS) {
        const sidecar = path.join(webserverDir, sidecarFileName('nginx.conf', profile, environment));
        if (!fs.existsSync(sidecar)) {
          localAdd('critical', name, `missing sidecar ${path.basename(sidecar)}`);
        }
      }
    }

    const adaptiveEdge = moduleUsesAdaptiveWebEdge(moduleRoot, name);
    const proxyOnly = isEdgeProxyOnlyModule(name);

    if (proxyOnly) {
      for (const snippet of Object.values(ADAPTIVE_SNIPPET_PATHS)) {
        if (fs.existsSync(path.join(webserverDir, snippet))) {
          localAdd('critical', name, `proxy-only module must not ship ${snippet} (W23)`);
        }
      }
      if (fs.existsSync(path.join(webserverDir, GATEWAY_SNIPPET_PATHS.apiProduction))) {
        localAdd('critical', name, `proxy-only module must not ship ${GATEWAY_SNIPPET_PATHS.apiProduction} (W23)`);
      }
    } else if (adaptiveEdge) {
      for (const snippet of [
        ADAPTIVE_SNIPPET_PATHS.maps,
        ADAPTIVE_SNIPPET_PATHS.dispatch,
        ADAPTIVE_SNIPPET_PATHS.namedLocations,
        GATEWAY_SNIPPET_PATHS.apiProduction,
      ]) {
        if (!fs.existsSync(path.join(webserverDir, snippet))) {
          localAdd('critical', name, `missing adaptive snippet ${snippet}`);
        }
      }
      if (!commonText.includes('adaptive-web.maps.conf')) {
        localAdd('critical', name, 'common.toml missing http.include adaptive-web.maps.conf');
      }
      const prodText = fs.readFileSync(path.join(webserverDir, 'server.production.toml'), 'utf8');
      if (!prodText.includes('adaptive-web.dispatch.conf')) {
        localAdd('critical', name, 'production missing location / adaptive dispatch');
      }
      if (!prodText.includes('gateway-api-locations.production.conf')) {
        localAdd('critical', name, 'production missing gateway-api snippet for /api/ proxy');
      }
    }

    const surfaces = detectBrowserSurfacesForWebserver(moduleRoot, webserverDir);
    const hasApps = surfaces.pcExists || surfaces.h5Exists;
    const appRootsPath = path.join(webserverDir, 'app-roots.example.toml');
    if (hasApps && !fs.existsSync(appRootsPath)) {
      localAdd('warning', name, 'PC/H5 apps present but app-roots.example.toml missing');
    } else if (hasApps && fs.existsSync(appRootsPath)) {
      const appRootsText = fs.readFileSync(appRootsPath, 'utf8');
      // Flat dist/<alias> paths are retired; process roots must declare
      // dist/standalone/<alias> (SDKWORK_WEBSERVER_SPEC.md §13.6 / §17.1).
      if (
        /dist\/(?:dev|test|staging|prod)"/u.test(appRootsText)
        && !/dist\/(?:standalone|cloud)\//u.test(appRootsText)
      ) {
        localAdd(
          'critical',
          name,
          'app-roots.example.toml still uses flat dist/<alias>; expected dist/standalone/<alias>',
        );
      }
    }
    if (adaptiveEdge && !surfaces.pcExists && !surfaces.h5Exists) {
      localAdd(
        'optimization',
        name,
        'adaptive edge without packaged PC/H5 apps — production uses static-fallback; add apps/ or ship static assets',
      );
    }
    if (adaptiveEdge && !fs.existsSync(path.join(webserverDir, 'static', 'index.html'))) {
      localAdd('optimization', name, 'create deployments/webserver/static/index.html for static-fallback placeholder');
    }
    if (!fs.existsSync(path.join(webserverDir, 'README.md'))) {
      localAdd('optimization', name, 'missing deployments/webserver/README.md');
    }
  }

  return {
    critical: localCritical,
    warnings: localWarnings,
    optimizations: localOptimizations,
  };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const result = auditCommercialReadiness(workspace);
  critical.push(...result.critical);
  warnings.push(...result.warnings);
  optimizations.push(...result.optimizations);

  console.log(`audit-commercial-readiness: ${critical.length} critical, ${warnings.length} warnings, ${optimizations.length} optimizations\n`);

  if (critical.length > 0) {
    console.log('CRITICAL');
    for (const { module, message } of critical) console.log(`  ${module}: ${message}`);
    console.log('');
  }
  if (warnings.length > 0) {
    console.log('WARNINGS');
    for (const { module, message } of warnings.slice(0, 40)) console.log(`  ${module}: ${message}`);
    if (warnings.length > 40) console.log(`  ... +${warnings.length - 40} more`);
    console.log('');
  }
  if (optimizations.length > 0) {
    console.log('OPTIMIZATIONS');
    for (const { module, message } of optimizations.slice(0, 20)) console.log(`  ${module}: ${message}`);
    if (optimizations.length > 20) console.log(`  ... +${optimizations.length - 20} more`);
  }

  process.exit(critical.length > 0 ? 1 : 0);
}
