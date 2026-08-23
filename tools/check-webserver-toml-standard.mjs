#!/usr/bin/env node

// Validates deployments/webserver/server.toml per SDKWORK_WEBSERVER_SPEC.md.
// Usage:
//   node tools/check-webserver-toml-standard.mjs --root <module-root>
//   node tools/check-webserver-toml-standard.mjs --workspace <workspace-root>

import path from 'node:path';

import { validateWebserverDir, scanWebserverCompliance } from './webserver/validate.mjs';

function parseArgs(argv) {
  const args = { root: null, workspace: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = argv[i + 1];
    else if (argv[i] === '--workspace') args.workspace = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.workspace) {
  const { modules, missingCount, errorCount } = scanWebserverCompliance(path.resolve(args.workspace));
  for (const module of modules) {
    const state = module.missing ? 'MISSING' : module.ok ? 'ok' : 'ERROR';
    console.log(`${state.padEnd(7)} ${module.name}`);
    for (const warning of module.warnings) console.warn(`  warning: ${warning}`);
    for (const error of module.errors) console.error(`  error: ${error}`);
  }
  console.log(
    `check-webserver-toml-standard: ${modules.length} modules with deployments/, ${missingCount} missing webserver/server.toml, ${errorCount} with validation errors`,
  );
  process.exit(missingCount > 0 || errorCount > 0 ? 1 : 0);
}

const root = path.resolve(args.root ?? process.cwd());
const result = validateWebserverDir(root);
if (result.missing) {
  console.error(
    `check-webserver-toml-standard: missing layout v3 files in ${root} (server.common.toml + server.{development,test,staging,production}.toml + server.{standalone,cloud}.toml)`,
  );
  process.exit(1);
}
for (const warning of result.warnings) console.warn(`warning: ${warning}`);
if (!result.ok) {
  for (const error of result.errors) console.error(`error: ${error}`);
  console.error('check-webserver-toml-standard failed');
  process.exit(1);
}
console.log('check-webserver-toml-standard ok');
process.exit(0);
