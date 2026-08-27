#!/usr/bin/env node
/**
 * Sequentially build every Adaptive Web module (prod × declared profiles).
 * Writes a live JSON report under .sdkwork/logs/.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_WORKSPACE_ROOT,
  listBrowserWorkspaceModules,
} from "../../bin/lib/browser-workspace-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(process.argv[2] ?? path.join(__dirname, "..", ".."));
const BUILDER = path.join(WORKSPACE, "bin", "build-browser-workspace.mjs");
const REPORT_DIR = path.join(WORKSPACE, ".sdkwork", "logs");
const REPORT_PATH = path.join(REPORT_DIR, "module-build-land-report.json");

function parseArgs(argv) {
  const options = {
    continueOnError: true,
    deploymentProfile: "all",
    environment: "prod",
    fromModule: "",
    module: "",
    skipTypecheck: true,
    workspaceRoot: WORKSPACE,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace" && argv[i + 1]) options.workspaceRoot = path.resolve(argv[++i]);
    else if (arg === "--module" && argv[i + 1]) options.module = argv[++i];
    else if (arg === "--from" && argv[i + 1]) options.fromModule = argv[++i];
    else if (arg === "--environment" && argv[i + 1]) options.environment = argv[++i];
    else if (arg === "--deployment-profile" && argv[i + 1]) options.deploymentProfile = argv[++i];
    else if (arg === "--with-typecheck") options.skipTypecheck = false;
    else if (arg === "--fail-fast") options.continueOnError = false;
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  let modules = listBrowserWorkspaceModules(options.workspaceRoot, options.module);
  if (options.fromModule) {
    const idx = modules.indexOf(options.fromModule);
    if (idx < 0) {
      throw new Error(`--from module not found: ${options.fromModule}`);
    }
    modules = modules.slice(idx);
  }

  /** @type {{ module: string, ok: boolean, elapsedSec: number, logHint: string, exitCode: number|null }[]} */
  const results = [];
  const startedAll = Date.now();

  console.log(`[land-modules] modules=${modules.length} env=${options.environment} profile=${options.deploymentProfile} skip-typecheck=${options.skipTypecheck}`);
  for (let i = 0; i < modules.length; i += 1) {
    const moduleName = modules[i];
    const summaryPath = path.join(REPORT_DIR, `land-${moduleName}.json`);
    const args = [
      BUILDER,
      "--workspace",
      options.workspaceRoot,
      "--module",
      moduleName,
      "--environment",
      options.environment,
      "--deployment-profile",
      options.deploymentProfile,
      "--json-summary",
      summaryPath,
    ];
    if (options.skipTypecheck) args.push("--skip-typecheck");
    if (options.continueOnError) args.push("--continue-on-error");

    console.log(`\n[land-modules] (${i + 1}/${modules.length}) START ${moduleName}`);
    const started = Date.now();
    const result = spawnSync(process.execPath, args, {
      cwd: options.workspaceRoot,
      encoding: "utf8",
      stdio: "inherit",
      timeout: 900000,
      windowsHide: true,
    });
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    const ok = result.status === 0;
    results.push({
      elapsedSec,
      exitCode: result.status,
      logHint: summaryPath,
      module: moduleName,
      ok,
    });
    fs.writeFileSync(
      REPORT_PATH,
      `${JSON.stringify({
        elapsedSec: Math.round((Date.now() - startedAll) / 1000),
        fail: results.filter((r) => !r.ok).length,
        options,
        pass: results.filter((r) => r.ok).length,
        results,
        total: modules.length,
      }, null, 2)}\n`,
      "utf8",
    );
    console.log(`[land-modules] (${i + 1}/${modules.length}) ${ok ? "PASS" : "FAIL"} ${moduleName} ${elapsedSec}s`);
    if (!ok && !options.continueOnError) {
      break;
    }
  }

  const fail = results.filter((r) => !r.ok);
  console.log(`\n[land-modules] done pass=${results.length - fail.length} fail=${fail.length} report=${REPORT_PATH}`);
  for (const entry of fail) {
    console.log(`  - ${entry.module} exit=${entry.exitCode}`);
  }
  process.exitCode = fail.length === 0 ? 0 : 1;
}

main();
