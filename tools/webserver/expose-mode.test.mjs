// Regression gate for expose-mode resolution (SDKWORK_DEPLOY_SPEC.md §8 / W29).
//
// Why this test exists: `moduleUsesAdaptiveWebEdge` is an authority input for
// W29, the commercial-readiness audit, and `build-from-topology` (which prunes
// production `adaptive-web.*` includes). It previously resolved js-yaml as
// `{ default: yaml }` only; on the ESM build that yields `undefined` WITHOUT
// throwing, so the try/catch never fired and every module silently reported
// `false`. That disabled W29, blinded the audit, and made the materializer
// prune production edge wiring. Each assertion below pins one link of that chain.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { moduleUsesAdaptiveWebEdge, readDeployYaml, isEdgeProxyOnlyModule } from './expose-mode.mjs';

function fixture(deployYamlText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expose-mode-'));
  if (deployYamlText !== null) {
    fs.mkdirSync(path.join(root, 'deployments'), { recursive: true });
    fs.writeFileSync(path.join(root, 'deployments', 'deploy.yaml'), deployYamlText);
  }
  return root;
}

const PROFILE = (mode, extra = '') => `profiles:
  standalone:
    expose:
      - domain: demo.example.com
        tls: example.com
        mode: ${mode}
${extra}`;

test('yaml backend actually resolves (guards the ESM-vs-CJS export-shape regression)', () => {
  // A malformed-but-present deploy.yaml must THROW, which is only possible when
  // the yaml backend loaded. If this assertion stops throwing, the import shape
  // regressed and every verdict below silently became `false` again.
  const root = fixture('profiles: [unterminated\n');
  assert.throws(
    () => readDeployYaml(root),
    /cannot parse|js-yaml is not installed/u,
    'present-but-unparseable deploy.yaml must fail closed, not return null/false',
  );
});

test('expose.mode web+api resolves to an Adaptive Web edge', () => {
  assert.equal(moduleUsesAdaptiveWebEdge(fixture(PROFILE('web+api')), 'sdkwork-demo'), true);
});

test('expose.mode web resolves to an Adaptive Web edge', () => {
  assert.equal(moduleUsesAdaptiveWebEdge(fixture(PROFILE('web')), 'sdkwork-demo'), true);
});

test('expose.mode api is NOT an Adaptive Web edge', () => {
  assert.equal(moduleUsesAdaptiveWebEdge(fixture(PROFILE('api')), 'sdkwork-demo'), false);
});

test('a genuinely absent deploy.yaml is a declared absence, not an error', () => {
  assert.equal(moduleUsesAdaptiveWebEdge(fixture(null), 'sdkwork-demo'), false);
  assert.equal(readDeployYaml(fixture(null)), null);
});

test('root-level expose (no profiles block) is honoured', () => {
  const root = fixture('expose:\n  - domain: demo.example.com\n    mode: web\n');
  assert.equal(moduleUsesAdaptiveWebEdge(root, 'sdkwork-demo'), true);
});

test('edge proxy-only products short-circuit regardless of deploy.yaml', () => {
  assert.equal(isEdgeProxyOnlyModule('sdkwork-webserver'), true);
  assert.equal(isEdgeProxyOnlyModule('sdkwork-api-cloud-gateway'), true);
  assert.equal(moduleUsesAdaptiveWebEdge(fixture(PROFILE('web+api')), 'sdkwork-webserver'), false);
});
