#!/usr/bin/env node
// Audit layout v3 webserver configs across sdkwork-space.
import path from 'node:path';

import { LAYOUT_V3_FILES } from './layout-v3.mjs';
import { scanWebserverCompliance } from './validate.mjs';

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

console.log(`\naudit-workspace: ${modules.length} modules, ${ok} ok, ${warn} with W18 warnings, ${err} errors`);
console.log(`required files per module: ${LAYOUT_V3_FILES.join(', ')}`);
process.exit(err > 0 ? 1 : 0);
