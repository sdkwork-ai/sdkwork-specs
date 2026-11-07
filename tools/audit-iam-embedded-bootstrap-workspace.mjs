#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const iamRepoRoot = path.join(workspaceRoot, 'sdkwork-iam');

const EMBEDDED_IAM_REPOS = [
  {
    name: 'sdkwork-im',
    governanceTest: 'scripts/dev/sdkwork-im-iam-application-bootstrap-standard.test.mjs',
  },
  {
    name: 'sdkwork-drive',
    governanceTest: 'scripts/dev/sdkwork-drive-iam-application-bootstrap-standard.test.mjs',
  },
  {
    name: 'sdkwork-notes',
    governanceTest: 'scripts/dev/sdkwork-notes-iam-application-bootstrap-standard.test.mjs',
  },
  {
    name: 'sdkwork-github',
    governanceTest: 'scripts/dev/sdkwork-github-iam-application-bootstrap-standard.test.mjs',
  },
  {
    name: 'sdkwork-birdcoder',
    governanceTest: 'scripts/dev/sdkwork-birdcoder-iam-application-bootstrap-standard.test.mjs',
  },
  {
    name: 'sdkwork-cloudrouter',
    governanceTest: 'scripts/dev/sdkwork-cloudrouter-iam-application-bootstrap-standard.test.mjs',
  },
  {
    name: 'sdkwork-api-cloud-gateway',
    governanceTest: 'scripts/dev/sdkwork-api-cloud-gateway-iam-application-bootstrap-standard.test.mjs',
  },
];

const FORBIDDEN_ADAPTER_PATTERN = /ensure_tenant_application_from_app_root_with_env\s*\(/u;

function readIfExists(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function scanApplicationRustSources(repoRoot) {
  const hits = [];
  const queue = [repoRoot];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'target' || entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.rs')) {
        continue;
      }
      const source = fs.readFileSync(fullPath, 'utf8');
      if (FORBIDDEN_ADAPTER_PATTERN.test(source)) {
        hits.push(path.relative(repoRoot, fullPath));
      }
    }
  }
  return hits;
}

for (const repo of EMBEDDED_IAM_REPOS) {
  const repoRoot = path.join(workspaceRoot, repo.name);
  assert.ok(fs.existsSync(repoRoot), `${repo.name} repository must exist under sdkwork-space`);
  const governancePath = path.join(repoRoot, repo.governanceTest);
  assert.ok(
    fs.existsSync(governancePath),
    `${repo.name} must provide ${repo.governanceTest}`,
  );
}

const canonicalSharedRuntime = readIfExists(
  iamRepoRoot,
  'crates/sdkwork-iam-web-adapter/src/embedded_bootstrap.rs',
);
assert.ok(canonicalSharedRuntime, 'sdkwork-iam canonical embedded bootstrap runtime must exist');
assert.match(
  canonicalSharedRuntime,
  /pub async fn ensure_tenant_application_from_app_root_with_env_and_fallback/u,
  'Shared embedded bootstrap must expose repository-root fallback API.',
);
const embeddedBootstrapFacade = readIfExists(
  iamRepoRoot,
  'crates/sdkwork-iam-embedded-application-bootstrap/src/lib.rs',
);
assert.ok(embeddedBootstrapFacade, 'sdkwork-iam embedded bootstrap facade must exist');
assert.match(
  embeddedBootstrapFacade,
  /pub use sdkwork_iam_web_adapter/u,
  'Embedded bootstrap crate must delegate to the canonical IAM web adapter implementation.',
);

for (const repo of EMBEDDED_IAM_REPOS) {
  const repoRoot = path.join(workspaceRoot, repo.name);
  const forbiddenHits = scanApplicationRustSources(repoRoot).filter(
    (relativePath) => !relativePath.includes('sdkwork-iam-embedded-application-bootstrap'),
  );
  assert.equal(
    forbiddenHits.length,
    0,
    `${repo.name} must not use ensure_tenant_application_from_app_root_with_env without fallback: ${forbiddenHits.join(', ')}`,
  );
}

const gatewayDependencyRoutesSource = readIfExists(
  workspaceRoot,
  'sdkwork-api-cloud-gateway/crates/sdkwork-api-cloud-gateway/src/embedded_dependency_routes.rs',
);
assert.ok(gatewayDependencyRoutesSource, 'sdkwork-api-cloud-gateway embedded dependency routes must exist');
// e69f4c2 moved the gateway to the composed WebModule form; both entrypoints
// are canonical sdkwork_api_iam_assembly initializations (API_ASSEMBLY_SPEC
// §4.1.1). What the audit forbids is any adapter-side IAM bootstrap that
// bypasses the owner assembly.
assert.match(
  gatewayDependencyRoutesSource,
  /sdkwork_api_iam_assembly::(?:assemble_owner_api_surfaces_with_pool|web_module_with_pool)/u,
  'sdkwork-api-cloud-gateway must initialize IAM through the canonical owner assembly before serving embedded routes.',
);

console.log('sdkwork-space IAM embedded bootstrap workspace audit passed.');
