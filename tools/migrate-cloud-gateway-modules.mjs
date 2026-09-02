#!/usr/bin/env node
// Rewrites the platform cloud gateway's embedded dependency bootstrap so it
// installs dependency-owned `WebModule`s instead of raw contributions.

import { readFileSync, writeFileSync } from 'node:fs';

const FILE =
  'E:/sdkwork-space/sdkwork-api-cloud-gateway/crates/sdkwork-api-cloud-gateway/src/embedded_dependency_routes.rs';

let source = readFileSync(FILE, 'utf8');

const rules = [
  // Generic: pool-backed assemblies.
  [
    /let contribution = (sdkwork_api_[a-z0-9_]+_assembly)::assemble_api_router_with_pool\((pool\.clone\(\))\)/g,
    'let module = $1::web_module_with_pool($2)',
  ],
  [
    /let contribution = (sdkwork_api_[a-z0-9_]+_assembly)::assemble_contribution_with_pool\((pool\.clone\(\))\)/g,
    'let module = $1::web_module_with_pool($2)',
  ],
  [
    /let contribution = (sdkwork_api_[a-z0-9_]+_assembly)::assemble_api_router_from_env\(\)/g,
    'let module = $1::web_module()',
  ],
  [
    /let contribution = (sdkwork_api_[a-z0-9_]+_assembly)::assemble_api_router\(\)/g,
    'let module = $1::web_module()',
  ],
  [
    /let contribution = (sdkwork_api_[a-z0-9_]+_assembly)::assemble_backend_api_contribution\(\)/g,
    'let module = $1::web_module()',
  ],
  // Struct-returning assemblies whose contribution is all the gateway needs.
  [
    /let assembly = (sdkwork_api_[a-z0-9_]+_assembly)::assemble_api_router_with_pool\((pool\.clone\(\))\)/g,
    'let module = $1::web_module_with_pool($2)',
  ],
];

for (const [pattern, replacement] of rules) {
  source = source.replace(pattern, replacement);
}

source = source
  .replace(/contributions\.push\(assembly\.contribution\);/g, 'modules.push(module);')
  .replace(/contributions\.push\(contribution\);/g, 'modules.push(module);')
  .replace(
    'pub struct EmbeddedDependencyBootstrap {\n    pub contributions: Vec<ApiAssemblyContribution>,',
    'pub struct EmbeddedDependencyBootstrap {\n    /// Dependency-owned Web Modules (API_ASSEMBLY_SPEC §4.1.1). The platform\n    /// gateway installs these through `ApiModuleRegistry::add_modules`;\n    /// duplicate registrations are ignored so route composition stays free.\n    pub modules: Vec<WebModule>,',
  )
  .replace(
    /#\[allow\(unused_mut\)\]\n    let mut contributions = Vec::new\(\);/,
    '#[allow(unused_mut)]\n    let mut modules: Vec<WebModule> = Vec::new();',
  )
  .replace(
    'Ok(EmbeddedDependencyBootstrap {\n        contributions,\n        runtime,\n    })',
    'Ok(EmbeddedDependencyBootstrap { modules, runtime })',
  )
  .replace(
    /#\[cfg\(any\(feature = "foundation-cloudrouter", feature = "foundation-webserver"\)\)\]\nuse sdkwork_web_contract::enrich_owned_openapi_document;\n/,
    '',
  )
  .replace(
    'use sdkwork_web_bootstrap::ApiAssemblyContribution;',
    'use sdkwork_web_bootstrap::WebModule;',
  );

writeFileSync(FILE, source);
console.log('embedded_dependency_routes.rs rewritten');
