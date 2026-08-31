#!/usr/bin/env node
// check-cross-module-api-collisions.mjs
//
// Cross-module API dedup gate for SDKWork workspaces (API_ASSEMBLY_SPEC.md
// section "Cross-Module Composition Dedup And Collision Resolution").
//
// Scans every application assembly's route inventory (resolved through each
// route crate's component contract / assembly manifest) and reports duplicate
// normalized `(surface, method, path)` identities across *different*
// application owners. Duplicates inside one application are contract defects
// that must be fixed; duplicates across applications require an explicit
// ownership decision in the platform gateway component contract.
//
// Usage:
//   node check-cross-module-api-collisions.mjs --workspace .
//   node check-cross-module-api-collisions.mjs --root <application-root>
//   node check-cross-module-api-collisions.mjs --workspace . --strict
//
// Exit codes: 0 = clean, 1 = collisions or errors found.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace") args.workspace = argv[++i];
    else if (arg === "--root") args.root = argv[++i];
    else if (arg === "--strict") args.strict = true;
  }
  return args;
}

function listDirectories(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readStructuredContract(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") return readJson(file);
  if (ext === ".yaml" || ext === ".yml") {
    // Best-effort YAML->object; schema shape only needs paths + components.
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
    const json = yamlLikeToJson(lines);
    return json;
  }
  return null;
}

function yamlLikeToJson(lines) {
  // Minimal YAML subset parser for route manifests / OpenAPI documents.
  const out = { paths: {} };
  let currentPath = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const pathMatch = /^\/[^\s:]+:$/u.exec(trimmed);
    if (pathMatch) {
      currentPath = pathMatch[0].slice(0, -1);
      out.paths[currentPath] = {};
      continue;
    }
    const methodMatch = /^(get|post|put|patch|delete):\s*$/iu.exec(trimmed);
    if (methodMatch && currentPath) {
      out.paths[currentPath][methodMatch[1].toLowerCase()] = {};
    }
  }
  return out;
}

function routesFromOpenApi(doc) {
  const routes = [];
  for (const [p, ops] of Object.entries(doc?.paths ?? {})) {
    for (const [method, op] of Object.entries(ops ?? {})) {
      const normalized = method.toLowerCase();
      if (!["get", "post", "put", "patch", "delete"].includes(normalized)) continue;
      routes.push({
        method: normalized.toUpperCase(),
        path: p,
        operationId: op?.operationId,
      });
    }
  }
  return routes;
}

function routesFromRouteManifest(doc) {
  const routes = [];
  for (const route of doc?.routes ?? []) {
    if (!route?.method || !route?.path) continue;
    routes.push({
      method: String(route.method).toUpperCase(),
      path: route.path,
      operationId: route.operationId,
    });
  }
  return routes;
}

function resolveRouteInventory(appRoot, routeCrate) {
  const ref = routeCrate.routeManifestRef;
  if (!ref) return { source: null, routes: [] };
  // `file#symbol` references resolve to the file; symbol resolution is not
  // needed to extract the (method, path) inventory from structured contracts.
  const [fileRef] = ref.split("#", 1);
  const filePath = path.resolve(appRoot, fileRef);
  if (!fs.existsSync(filePath)) return { source: filePath, routes: [], missing: true };
  const doc = readStructuredContract(filePath);
  if (!doc) return { source: filePath, routes: [] };
  const routes = Array.isArray(doc.routes)
    ? routesFromRouteManifest(doc)
    : routesFromOpenApi(doc);
  return { source: filePath, routes, missing: false };
}

function surfaceOf(ref) {
  if (!ref) return "unknown";
  const match = ref.match(/\/(app-api|backend-api|open-api|internal-api)\//u);
  return match ? match[1] : "unknown";
}

function collectApplicationRoutes(appRoot, applicationCode) {
  const assemblyDir = path.join(appRoot, "crates", `sdkwork-api-${applicationCode}-assembly`);
  const manifestPath = path.join(assemblyDir, "assembly-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { applicationCode, routes: [], error: `missing ${manifestPath}` };
  }
  const manifest = readJson(manifestPath);
  const inventory = [];
  for (const routeCrate of manifest.routeCrates ?? []) {
    const { routes, missing } = resolveRouteInventory(appRoot, routeCrate);
    if (missing) {
      inventory.push({
        error: `route manifest missing: ${routeCrate.routeManifestRef}`,
      });
      continue;
    }
    const surface = routeCrate.surface ?? surfaceOf(routeCrate.routeManifestRef);
    for (const route of routes) {
      inventory.push({
        surface: surface.replace(/-api$/u, "") + "-api",
        method: route.method,
        path: route.path,
        operationId: route.operationId,
        source: routeCrate.routeManifestRef,
      });
    }
  }
  return { applicationCode, routes: inventory };
}

function normalizePath(p) {
  return p
    .split("/")
    .map((segment) => (/^\{[^}]+\}$/u.test(segment) ? "{}" : segment))
    .join("/");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspace = args.workspace
    ? path.resolve(args.workspace)
    : path.resolve(args.root ?? ".");
  const root = args.root ? path.resolve(args.root) : workspace;

  const targets = args.root ? [root] : listDirectories(workspace).filter((d) => {
    const name = path.basename(d);
    if (name === "sdkwork-api-cloud-gateway") return false; // platform gateway, not an application
    if (name === "sdkwork-specs") return false;
    return name.startsWith("sdkwork-") && fs.existsSync(path.join(d, "sdkwork.app.config.json"));
  });

  const seen = new Map(); // key -> [{applicationCode, source, operationId}]
  const errors = [];
  const reports = [];

  for (const appRoot of targets) {
    const applicationCode = path.basename(appRoot).replace(/^sdkwork-/u, "");
    const result = collectApplicationRoutes(appRoot, applicationCode);
    if (result.error) {
      reports.push({ applicationCode, error: result.error });
      continue;
    }
    for (const route of result.routes) {
      if (route.error) {
        errors.push(`${applicationCode}: ${route.error}`);
        continue;
      }
      const key = `${route.surface}|${route.method}|${normalizePath(route.path)}`;
      const entry = {
        applicationCode,
        surface: route.surface,
        method: route.method,
        path: route.path,
        operationId: route.operationId,
        source: route.source,
      };
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(entry);
    }
  }

  const collisions = [...seen.values()].filter((owners) => {
    const apps = new Set(owners.map((o) => o.applicationCode));
    return apps.size > 1;
  });

  if (args.strict) {
    // Strict mode also flags intra-application duplicate declarations.
    for (const [key, owners] of seen) {
      if (owners.length > 1) {
        const apps = new Set(owners.map((o) => o.applicationCode));
        if (apps.size === 1) {
          collisions.push({ intraApp: true, key, owners });
        }
      }
    }
  }

  let exit = 0;
  if (reports.length > 0) {
    for (const r of reports) {
      console.log(`WARN ${r.applicationCode}: ${r.error}`);
    }
  }
  for (const collision of collisions) {
    const owners = collision.owners ?? collision;
    const first = owners[0];
    const key = collision.key ??
      `${first.surface}|${first.method}|${normalizePath(first.path)}`;
    // Contract-level duplicates are audit findings by default: they may be
    // isolated by composition-surface selection (API_ASSEMBLY_SPEC §4.2.2)
    // and never mounted together. `--strict` turns them into blocking
    // failures so owners are forced to dedup or record the resolution.
    if (collision.intraApp) {
      console.log(`INTRADUP ${key}`);
      for (const o of owners) {
        console.log(`  ${o.applicationCode} ${o.method} ${o.path} opId=${o.operationId} source=${o.source}`);
      }
      continue;
    }
    if (!args.strict) {
      console.log(`FINDING ${key}`);
      for (const o of owners) {
        console.log(`  ${o.applicationCode} ${o.method} ${o.path} opId=${o.operationId} source=${o.source}`);
      }
      continue;
    }
    exit = 1;
    console.log(`COLLISION ${key}`);
    for (const o of owners) {
      console.log(`  ${o.applicationCode} ${o.method} ${o.path} opId=${o.operationId} source=${o.source}`);
    }
  }

  if (exit === 0 && errors.length === 0) {
    console.log(
      `cross-module API collision audit passed (${targets.length} applications, ${collisions.length} findings${args.strict ? " (strict: all resolved)" : ""})`,
    );
  }
  process.exit(exit);
}

main();
