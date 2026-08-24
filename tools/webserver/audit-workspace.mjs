#!/usr/bin/env node
// Audit layout v3 webserver configs across sdkwork-space and canonical examples.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LAYOUT_V3_FILES } from './layout-v3.mjs';
import { scanWebserverCompliance, validateWebserverDir } from './validate.mjs';

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const specsRoot = path.resolve(toolsRoot, '../..');

const workspace = process.argv[2] ?? 'E:/sdkwork-space';
const { modules } = scanWebserverCompliance(path.resolve(workspace));

let ok = 0;
let warn = 0;
let err = 0;
for (const module of modules) {
  if (module.missing) {
    err += 1;
    console.log(`MISSING ${module.name}`);
    continue;
  }
  if (!module.ok) {
    err += 1;
    console.log(`ERROR   ${module.name}`);
    for (const e of module.errors ?? []) console.log(`  ${e}`);
    continue;
  }
  ok += 1;
  const w18 = (module.warnings ?? []).filter((w) => w.includes('(W18)'));
  if (w18.length > 0) {
    warn += 1;
    console.log(`WARN    ${module.name} (${w18.length} W18)`);
  }
}

const exampleModules = [
  'examples/webserver',
  'examples/webserver/modules/sdkwork-im',
  'examples/webserver/modules/sdkwork-cloudrouter',
  'examples/webserver/modules/sdkwork-birdcoder',
];
let exampleErr = 0;
for (const rel of exampleModules) {
  const moduleRoot = path.join(specsRoot, rel);
  if (!fs.existsSync(moduleRoot)) {
    exampleErr += 1;
    console.log(`ERROR   ${rel} (missing example tree)`);
    continue;
  }
  const result = validateWebserverDir(moduleRoot);
  if (!result.ok) {
    exampleErr += 1;
    console.log(`ERROR   ${rel}`);
    for (const e of result.errors.slice(0, 5)) console.log(`  ${e}`);
  }
}

console.log(`\naudit-workspace: ${modules.length} modules, ${ok} ok, ${warn} with W18 warnings, ${err} errors`);
console.log(`examples: ${exampleModules.length} template(s), ${exampleModules.length - exampleErr} ok, ${exampleErr} error(s)`);
console.log(`required files per module: ${LAYOUT_V3_FILES.join(', ')}`);
process.exit(err + exampleErr > 0 ? 1 : 0);
