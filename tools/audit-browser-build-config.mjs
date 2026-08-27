#!/usr/bin/env node
/**
 * Deep audit of Adaptive Web build config across the workspace.
 * Complements sweep-browser-build-workspace.mjs (scripts + dist layout).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_WORKSPACE_ROOT,
  declaredDeploymentProfiles,
  listBrowserWorkspaceModules,
  planBrowserWorkspaceSurfaces,
} from "../../bin/lib/browser-workspace-core.mjs";
import { discoverBrowserAppRoots } from "./build-browser-client.mjs";

const VITE_CONFIG_NAMES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.web.ts",
  "vite.config.web.mjs",
  "vite.config.browser.ts",
  "vite.config.browser.mjs",
];

function findViteConfig(appRoot) {
  for (const name of VITE_CONFIG_NAMES) {
    const candidate = path.join(appRoot, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function hasCanonicalOutDir(source) {
  return (
    /resolveBrowserDistOutDir\s*\(/u.test(source)
    || /outDir\s*:\s*['"`]dist\/(standalone|cloud)\/(dev|test|staging|prod)['"`]/u.test(source)
  );
}

function main() {
  const workspaceRoot = path.resolve(process.argv[2] ?? DEFAULT_WORKSPACE_ROOT);
  const mods = listBrowserWorkspaceModules(workspaceRoot);
  const report = {
    modules: mods.length,
    profiles: { both: [], standaloneOnly: [], other: [] },
    noAppConfig: [],
    missingTypecheckNarrow: [],
    missingVite: [],
    missingOutDirHelper: [],
    dryRunSurfaces: 0,
  };

  for (const moduleName of mods) {
    const repoRoot = path.join(workspaceRoot, moduleName);
    const profiles = declaredDeploymentProfiles(repoRoot);
    if (profiles.length === 1 && profiles[0] === "standalone") {
      report.profiles.standaloneOnly.push(moduleName);
    } else if (profiles.includes("standalone") && profiles.includes("cloud")) {
      report.profiles.both.push(moduleName);
    } else {
      report.profiles.other.push({ moduleName, profiles });
    }
    if (!fs.existsSync(path.join(repoRoot, "sdkwork.app.config.json"))) {
      report.noAppConfig.push(moduleName);
    }
    for (const app of discoverBrowserAppRoots(repoRoot)) {
      const hasNarrow =
        fs.existsSync(path.join(app.root, "tsconfig.app.json"))
        || fs.existsSync(path.join(app.root, "tsconfig.build.json"));
      const hasRootTsconfig = fs.existsSync(path.join(app.root, "tsconfig.json"));
      if (hasRootTsconfig && !hasNarrow) {
        report.missingTypecheckNarrow.push(`${moduleName}/${app.relative}`);
      }
      const vite = findViteConfig(app.root);
      if (!vite) {
        report.missingVite.push(`${moduleName}/${app.relative}`);
        continue;
      }
      const source = fs.readFileSync(vite, "utf8");
      if (!hasCanonicalOutDir(source)) {
        report.missingOutDirHelper.push(
          `${moduleName}/${app.relative} (${path.basename(vite)})`,
        );
      }
    }
  }

  report.dryRunSurfaces = planBrowserWorkspaceSurfaces({
    architecture: "all",
    deploymentProfile: "all",
    environment: "prod",
    workspaceRoot,
  }).length;

  console.log(JSON.stringify({
    modules: report.modules,
    dryRunSurfacesProdAllProfiles: report.dryRunSurfaces,
    profileCounts: {
      both: report.profiles.both.length,
      standaloneOnly: report.profiles.standaloneOnly,
      other: report.profiles.other,
    },
    noAppConfig: report.noAppConfig,
    missingTypecheckNarrowCount: report.missingTypecheckNarrow.length,
    missingTypecheckNarrow: report.missingTypecheckNarrow,
    missingVite: report.missingVite,
    missingOutDirHelper: report.missingOutDirHelper,
  }, null, 2));

  const hardFail =
    report.missingVite.length > 0
    || report.missingOutDirHelper.length > 0
    || report.profiles.other.length > 0;
  process.exitCode = hardFail ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
