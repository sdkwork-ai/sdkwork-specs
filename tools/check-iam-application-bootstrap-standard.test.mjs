import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateIamApplicationBootstrapStandard } from './check-iam-application-bootstrap-standard.mjs';

async function withFixture(files, callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdkwork-iam-bootstrap-check-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
    }
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const APP_MANIFEST = `${JSON.stringify({
  backend: {
    accessTokenPermissionScope: ['iam.applications.read'],
  },
}, null, 2)}\n`;

test('accepts the shared embedded Rust bootstrap framework for manifest-owning runtimes', async () => {
  await withFixture({
    'agent.app.config.json': APP_MANIFEST,
    'Cargo.toml': `[workspace.dependencies]\nsdkwork-iam-embedded-application-bootstrap = { path = "../sdkwork-iam/crates/sdkwork-iam-embedded-application-bootstrap" }\n`,
  }, async (root) => {
    const result = validateIamApplicationBootstrapStandard(root);
    assert.equal(result.ok, true, result.failures.join('\n'));
    assert.equal(result.summary.hasEmbeddedRustFramework, true);
  });
});

test('accepts the IAM assembly when it owns the embedded bootstrap lifecycle', async () => {
  await withFixture({
    'agent.app.config.json': APP_MANIFEST,
    'Cargo.toml': `[workspace.dependencies]\nsdkwork-api-iam-assembly = { path = "../sdkwork-iam/crates/sdkwork-api-iam-assembly" }\n`,
  }, async (root) => {
    const result = validateIamApplicationBootstrapStandard(root);
    assert.equal(result.ok, true, result.failures.join('\n'));
    assert.equal(result.summary.hasIamAssembly, true);
  });
});

test('rejects an application manifest without a shared bootstrap owner', async () => {
  await withFixture({
    'agent.app.config.json': APP_MANIFEST,
    'Cargo.toml': '[workspace]\nmembers = []\n',
  }, async (root) => {
    const result = validateIamApplicationBootstrapStandard(root);
    assert.equal(result.ok, false);
    assert.match(result.failures.join('\n'), /depends on none of/);
  });
});
