#!/usr/bin/env node
// Pass 2: catches the wrapped `let contribution =\n    crate::assemble_...(..)` form
// that the single-line rules in migrate-cloud-gateway-modules.mjs miss.

import { readFileSync, writeFileSync } from 'node:fs';

const FILE =
  'E:/sdkwork-space/sdkwork-api-cloud-gateway/crates/sdkwork-api-cloud-gateway/src/embedded_dependency_routes.rs';

let source = readFileSync(FILE, 'utf8');

const rules = [
  [
    /let contribution =\s*(sdkwork_api_[a-z0-9_]+_assembly)::assemble_api_router_with_pool\(\s*(pool\.clone\(\))\s*\)/g,
    'let module =\n        $1::web_module_with_pool($2)',
  ],
  [
    /let contribution =\s*(sdkwork_api_[a-z0-9_]+_assembly)::assemble_contribution_with_pool\(\s*(pool\.clone\(\))\s*\)/g,
    'let module =\n        $1::web_module_with_pool($2)',
  ],
  [
    /let contribution =\s*(sdkwork_api_[a-z0-9_]+_assembly)::assemble_api_router_from_env\(\)/g,
    'let module =\n        $1::web_module()',
  ],
  [
    /let contribution =\s*(sdkwork_api_[a-z0-9_]+_assembly)::assemble_api_router\(\)/g,
    'let module =\n        $1::web_module()',
  ],
];

for (const [pattern, replacement] of rules) {
  source = source.replace(pattern, replacement);
}

source = source.replace(/contributions\.push\(contribution\);/g, 'modules.push(module);');

writeFileSync(FILE, source);
console.log('embedded_dependency_routes.rs pass 2 done');
