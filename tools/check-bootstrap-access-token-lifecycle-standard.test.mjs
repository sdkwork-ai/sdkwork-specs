import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  validateIamBootstrapAuthProfileSpec,
  validateRepositoryBootstrapLifecycle,
  validateWorkspaceBootstrapInfrastructure,
} from './lib/bootstrap-access-token-lifecycle-standard.mjs';

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('IAM application bootstrap spec documents auth profile and lifecycle token ensure', () => {
  const issues = validateIamBootstrapAuthProfileSpec(path.join(WORKSPACE_ROOT, 'sdkwork-specs'));
  assert.deepEqual(issues, [], issues.join('\n'));
});

test('workspace bootstrap infrastructure is present', () => {
  const issues = validateWorkspaceBootstrapInfrastructure(WORKSPACE_ROOT);
  assert.deepEqual(issues, [], issues.join('\n'));
});

test('accepts a repository that routes lifecycle through sdkwork-app', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-bootstrap-lifecycle-'));
  try {
    fs.writeFileSync(path.join(root, 'agent.app.config.json'), `${JSON.stringify({
      backend: { accessTokenPermissionScope: ['iam.applications.read'] },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
      scripts: { dev: 'pnpm exec sdkwork-app dev' },
    }, null, 2)}\n`);
    assert.deepEqual(validateRepositoryBootstrapLifecycle(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects credential-entry surfaces without lifecycle token ensure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-bootstrap-lifecycle-'));
  const appRoot = path.join(root, 'apps', 'sdkwork-demo-pc');
  try {
    fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'agent.app.config.json'), `${JSON.stringify({
      backend: { accessTokenPermissionScope: ['iam.applications.read'] },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
      scripts: { dev: 'pnpm --dir apps/sdkwork-demo-pc dev' },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(appRoot, 'agent.app.config.json'), '{"kind":"agent.app"}\n');
    fs.writeFileSync(path.join(appRoot, 'index.html'), '<div id="root"></div>\n');
    fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
    }, null, 2));
    fs.writeFileSync(
      path.join(appRoot, 'src', 'runtime.ts'),
      "import { wrapCredentialEntryClient } from '@sdkwork/iam-credential-entry';\nvoid wrapCredentialEntryClient;\n",
    );
    fs.writeFileSync(path.join(appRoot, 'vite.config.ts'), 'export default { plugins: [] };\n');
    fs.writeFileSync(path.join(appRoot, '.env.example'), 'SDKWORK_ACCESS_TOKEN=\n');
    const issues = validateRepositoryBootstrapLifecycle(root);
    assert.ok(issues.some((issue) => issue.includes('credential-entry surfaces')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
