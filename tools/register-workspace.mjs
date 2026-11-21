#!/usr/bin/env node

/**
 * Workspace-wide module registration.
 *
 * The unit is still one module (`register-module.mjs`); this command only walks
 * the workspace's `sdkwork-*` repositories that carry an application manifest and
 * runs that same command in each, so every independent module uses one script
 * and one invocation style.
 *
 * It is intended for an operator/admin run: a workspace-wide USER run makes no
 * sense because a user's login token belongs to one module's installation. Run
 * `register-module.mjs --auth user` in the module a user is publishing.
 *
 * `--print-audiences` emits the one line an OEM/cluster operator must merge into
 * `GATEWAY_IAM_ALLOWED_AUDIENCES` after the runs; without it the app's own public
 * token is rejected at credential-entry bootstrap (`40103`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_MANIFEST = 'agent.app.config.json';

function trim(value) {
  return String(value ?? '').trim();
}

/**
 * Workspace modules that carry an application manifest.
 * @param workspaceRoot - directory containing `sdkwork-*` repositories
 * @returns module roots, sorted
 */
export function findWorkspaceModules(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  if (!fs.existsSync(root)) {
    throw new Error(`workspace root does not exist: ${root}`);
  }
  const modules = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^sdkwork-/u.test(entry.name)) {
      continue;
    }
    const moduleRoot = path.join(root, entry.name);
    const hasRootManifest = fs.existsSync(path.join(moduleRoot, APP_MANIFEST));
    const appsDir = path.join(moduleRoot, 'apps');
    const hasSurfaceManifest = fs.existsSync(appsDir)
      && fs.readdirSync(appsDir, { withFileTypes: true }).some((surface) => surface.isDirectory()
        && fs.existsSync(path.join(appsDir, surface.name, APP_MANIFEST)));
    if (hasRootManifest || hasSurfaceManifest) {
      modules.push(moduleRoot);
    }
  }
  return modules.sort((left, right) => left.localeCompare(right));
}

/**
 * Parse the workspace wrapper's arguments.
 * Only the flags that make sense for a whole-workspace operator run are
 * recognized; everything else stays a per-module concern.
 * @param argv - arguments after the script
 * @returns options plus forwarded module arguments
 */
export function parseWorkspaceArgs(argv) {
  const options = {
    workspaceRoot: path.dirname(TOOLS_DIR),
    modules: [],
    dryRun: false,
    printAudiences: false,
    help: false,
    forward: [],
  };
  const valueOf = (index, name) => {
    const value = trim(argv[index + 1]);
    if (!value) {
      throw new Error(`${name} requires a value`);
    }
    return value;
  };
  const forwardWithValue = (index, arg) => {
    options.forward.push(arg, valueOf(index, arg));
    return index + 1;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      options.workspaceRoot = path.resolve(valueOf(index, arg));
      index += 1;
    } else if (arg === '--module' || arg === '--modules') {
      options.modules.push(valueOf(index, arg));
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
      options.forward.push(arg);
    } else if (arg === '--print-audiences') {
      options.printAudiences = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if ([
      '--environment', '--deployment-profile', '--auth', '--primary-domain', '--domain-pattern',
      '--api-domain', '--deploy-base-url', '--iam-base-url', '--brand', '--domain-suffix',
      '--tenant-id', '--organization-id', '--username', '--password', '--operator-username',
      '--operator-password', '--app-id', '--iam-transport', '--oem-config',
      '--default-app-type', '--default-permission-scope', '--slug-suffix',
      '--domain-label-suffix', '--ownership', '--owner-user-id', '--device-id',
      '--deploy-app-kind', '--runtime-target',
    ].includes(arg)) {
      index = forwardWithValue(index, arg);
    } else if (arg === '--include-servers-only' || arg === '--no-write-anchor' || arg === '--no-materialize'
      || arg === '--fix-app-types' || arg === '--repair-app-kind') {
      options.forward.push(arg);
    } else {
      throw new Error(`unsupported option: ${arg}`);
    }
  }
  return options;
}

const HELP = `register-workspace — run register-module for every workspace module

Usage:
  node sdkwork-specs/tools/register-workspace.mjs [options]

Selection:
  --workspace <dir>       Workspace root (default: parent of sdkwork-specs)
  --module <dir>          Limit to one module directory name (repeatable)
  --dry-run               Plan every module, no requests or writes

Forwarded to register-module:
  --environment, --deployment-profile, --api-domain, --domain-suffix, --brand,
  --domain-pattern/--primary-domain, --oem-config, --username/--password,
  --operator-username/--operator-password, --tenant-id, --organization-id,
  --iam-transport, --ownership, --include-servers-only, --no-write-anchor,
  --no-materialize, --default-app-type, --default-permission-scope,
  --deploy-app-kind, --fix-app-types, --repair-app-kind

Output:
  --print-audiences       Print GATEWAY_IAM_ALLOWED_AUDIENCES=<anchors> for the
                          modules that registered successfully (OEM/cluster step)
  --help

A workspace run is an operator/admin run. USER self-publication is a per-module
operation ('register-module.mjs --auth user') because the login token belongs to
that module's installation.
`;

function main() {
  let options;
  try {
    options = parseWorkspaceArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`register-workspace: ${error.message}`);
    return 2;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  let modules;
  try {
    modules = findWorkspaceModules(options.workspaceRoot);
  } catch (error) {
    console.error(`register-workspace: ${error.message}`);
    return 2;
  }
  if (options.modules.length > 0) {
    const wanted = new Set(options.modules.map((entry) => path.basename(entry)));
    modules = modules.filter((moduleRoot) => wanted.has(path.basename(moduleRoot)));
  }
  if (modules.length === 0) {
    console.error('register-workspace: no module with an application manifest matched');
    return 2;
  }
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-workspace-register-'));
  const failures = [];
  const anchors = [];
  try {
    for (const moduleRoot of modules) {
      const reportPath = path.join(reportDir, `${path.basename(moduleRoot)}.json`);
      const args = [
        path.join(TOOLS_DIR, 'register-module.mjs'),
        '--module-root', moduleRoot,
        '--workspace', options.workspaceRoot,
        '--report', reportPath,
        ...options.forward,
      ];
      console.log(`\n== ${path.basename(moduleRoot)}`);
      const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      if (result.status !== 0) {
        failures.push(path.basename(moduleRoot));
      }
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        for (const entry of report.entries ?? []) {
          if (entry.deployApplicationId) {
            anchors.push(entry.deployApplicationId);
          }
        }
      } catch {
        // A failed/dry run may have no report; the failure list carries the fact.
      }
    }
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
  if (options.printAudiences) {
    const unique = [...new Set(anchors)];
    console.log(`\nGATEWAY_IAM_ALLOWED_AUDIENCES=${unique.join(',')}`);
    console.log('Merge these anchors into the gateway allow-list (or OEM cluster config).');
  }
  if (failures.length > 0) {
    console.error(`\nregister-workspace: ${failures.length} module(s) failed: ${failures.join(', ')}`);
    return 1;
  }
  console.log(`\nregister-workspace: ${modules.length} module(s) processed`);
  return 0;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = main();
}

export { main };
