import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateCredentialEntryRepository } from './lib/credential-entry-bootstrap-standard.mjs';

function createFixture({ installPlugin = true, publicToken = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-credential-entry-'));
  const appRoot = path.join(root, 'apps', 'sdkwork-demo-pc');
  fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(appRoot, 'sdkwork.app.config.json'), '{"kind":"sdkwork.app"}\n');
  fs.writeFileSync(path.join(appRoot, 'index.html'), '<div id="root"></div>\n');
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
    name: '@sdkwork/demo-pc',
    private: true,
    scripts: { dev: 'vite' },
  }, null, 2));
  fs.writeFileSync(
    path.join(appRoot, 'src', 'runtime.ts'),
    "import { wrapCredentialEntryClient } from '@sdkwork/iam-credential-entry';\nvoid wrapCredentialEntryClient;\n",
  );
  fs.writeFileSync(
    path.join(appRoot, 'vite.config.ts'),
    installPlugin
      ? "import { createSdkworkCredentialEntryBootstrapVitePlugin } from '@sdkwork/iam-credential-entry/vite';\nexport default { plugins: [createSdkworkCredentialEntryBootstrapVitePlugin()] };\n"
      : 'export default { plugins: [] };\n',
  );
  fs.writeFileSync(path.join(appRoot, '.env.example'), 'SDKWORK_ACCESS_TOKEN=\n');
  fs.writeFileSync(
    path.join(appRoot, '.env.production.example'),
    publicToken ? 'SDKWORK_ACCESS_TOKEN=unsafe\n' : 'PUBLIC_API_URL=https://api.example.test\n',
  );
  return root;
}

test('accepts a canonical credential-entry Vite consumer', () => {
  const root = createFixture();
  try {
    assert.deepEqual(validateCredentialEntryRepository(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepts canonical Vite integration through a local composition helper', () => {
  const root = createFixture({ installPlugin: false });
  const appRoot = path.join(root, 'apps', 'sdkwork-demo-pc');
  try {
    fs.writeFileSync(
      path.join(appRoot, 'credential-entry-plugins.mjs'),
      "import { createSdkworkCredentialEntryBootstrapVitePlugin } from '@sdkwork/iam-credential-entry/vite';\nexport function createCredentialEntryPlugins() { return [createSdkworkCredentialEntryBootstrapVitePlugin()]; }\n",
    );
    fs.writeFileSync(
      path.join(appRoot, 'vite.config.ts'),
      "import { createCredentialEntryPlugins } from './credential-entry-plugins.mjs';\nexport default { plugins: createCredentialEntryPlugins() };\n",
    );
    assert.deepEqual(validateCredentialEntryRepository(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reports missing canonical Vite integration', () => {
  const root = createFixture({ installPlugin: false });
  try {
    assert.ok(validateCredentialEntryRepository(root).some((issue) => issue.includes('must install')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reports resolved production browser bootstrap tokens', () => {
  const root = createFixture({ publicToken: true });
  try {
    const issues = validateCredentialEntryRepository(root);
    assert.ok(issues.some((issue) => issue.includes('resolved bootstrap token')));
    assert.ok(issues.some((issue) => issue.includes('production browser template')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not treat nested library Vite configs as executable IAM renderers', () => {
  const root = createFixture();
  const libraryRoot = path.join(root, 'apps', 'sdkwork-demo-pc', 'packages', 'ui');
  try {
    fs.mkdirSync(path.join(libraryRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(libraryRoot, 'package.json'), JSON.stringify({
      name: '@sdkwork/demo-ui',
      private: true,
      scripts: { build: 'vite build' },
    }, null, 2));
    fs.writeFileSync(path.join(libraryRoot, 'vite.config.ts'), 'export default { plugins: [] };\n');
    fs.writeFileSync(
      path.join(libraryRoot, 'src', 'auth.ts'),
      "import type { IamClient } from '@sdkwork/iam-app-sdk';\nexport type AuthClient = IamClient;\n",
    );
    assert.deepEqual(validateCredentialEntryRepository(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ignores vendored external Vite projects', () => {
  const root = createFixture();
  const externalRoot = path.join(root, 'external', 'vendor-app');
  try {
    fs.mkdirSync(path.join(externalRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(externalRoot, 'index.html'), '<div id="root"></div>\n');
    fs.writeFileSync(path.join(externalRoot, 'vite.config.ts'), 'export default { plugins: [] };\n');
    fs.writeFileSync(
      path.join(externalRoot, 'src', 'auth.ts'),
      "import { wrapCredentialEntryClient } from '@sdkwork/iam-credential-entry';\nvoid wrapCredentialEntryClient;\n",
    );
    assert.deepEqual(validateCredentialEntryRepository(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ignores JWT helpers in test fixtures and mocks', () => {
  const root = createFixture();
  const scriptsRoot = path.join(root, 'scripts');
  try {
    fs.mkdirSync(path.join(scriptsRoot, 'fixtures'), { recursive: true });
    fs.writeFileSync(
      path.join(scriptsRoot, 'fixtures', 'credential-entry-bootstrap.fixture.mjs'),
      'function createTestJwt() { return "fixture"; }\nvoid createTestJwt;\n',
    );
    fs.writeFileSync(
      path.join(scriptsRoot, 'pc-e2e-mock-api-fixtures.mjs'),
      'function createTestJwt() { return "mock"; }\nvoid createTestJwt;\n',
    );
    assert.deepEqual(validateCredentialEntryRepository(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('still reports a production-local bootstrap implementation', () => {
  const root = createFixture();
  const devRoot = path.join(root, 'scripts', 'dev');
  try {
    fs.mkdirSync(devRoot, { recursive: true });
    fs.writeFileSync(
      path.join(devRoot, 'application-bootstrap.mjs'),
      'function createDevBootstrapAccessTokenJwt() { return "unsafe"; }\nvoid createDevBootstrapAccessTokenJwt;\n',
    );
    assert.ok(
      validateCredentialEntryRepository(root)
        .some((issue) => issue.includes('application-local credential-entry bootstrap fork')),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- renderer scope widening -------------------------------------------------
//
// Mutation tests for `credential-entry-renderer-scope.json`. The scope file lets a
// repository opt into full renderer coverage before every sibling repository has
// migrated, so widening the predicate does not turn the workspace red for debt that
// belongs to someone else. These cases pin both directions of that switch.

const scopePath = path.resolve('credential-entry-renderer-scope.json');

function withScopeRepositories(repositories, run) {
  const original = fs.readFileSync(scopePath, 'utf8');
  try {
    fs.writeFileSync(scopePath, `${JSON.stringify({ repositories }, null, 2)}\n`);
    return run();
  } finally {
    fs.writeFileSync(scopePath, original);
  }
}

// A renderer that consumes no IAM marker at all: no credential-entry import in
// `src/`, no declared dependency, no canonical plugin. Historically this was
// invisible to the gate no matter how many protected operations it dispatched,
// which is how a green gate coexisted with the runtime failure
// `non-open-api request requires Access-Token before request dispatch`.
//
// The repository root is a named child of the temp directory because scope entries
// are matched against the validated root's basename; a bare `mkdtemp` root carries a
// random suffix and would never match a stable repository name.
function createMarkerFreeRendererFixture({ repositoryName = 'sdkwork-demo' } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-credential-entry-scope-'));
  const root = path.join(scratch, repositoryName);
  const appRoot = path.join(root, 'apps', `${repositoryName}-h5`);
  fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(appRoot, 'sdkwork.app.config.json'), '{"kind":"sdkwork.app"}\n');
  fs.writeFileSync(path.join(appRoot, 'index.html'), '<div id="root"></div>\n');
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
    name: `@sdkwork/${repositoryName}-h5`,
    private: true,
    scripts: { start: 'vite preview --host 127.0.0.1' },
  }, null, 2));
  fs.writeFileSync(path.join(appRoot, 'src', 'main.tsx'), 'export const boot = true;\n');
  fs.writeFileSync(path.join(appRoot, 'vite.config.ts'), 'export default { plugins: [] };\n');
  fs.writeFileSync(path.join(appRoot, '.env.example'), 'SDKWORK_ACCESS_TOKEN=\n');
  return { scratch, root, appRoot };
}

test('reports a marker-free renderer once its repository is in scope', () => {
  const { scratch, root } = createMarkerFreeRendererFixture();
  try {
    const issues = withScopeRepositories(['sdkwork-demo'], () => validateCredentialEntryRepository(root));
    assert.ok(
      issues.some((issue) => issue.includes('must install createSdkworkCredentialEntryBootstrapVitePlugin')),
      `expected a canonical-plugin finding, received: ${JSON.stringify(issues)}`,
    );
    assert.ok(
      issues.some((issue) => issue.includes('must consume the canonical IAM Vite entry')),
      `expected a canonical-entry finding, received: ${JSON.stringify(issues)}`,
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('reports the missing private env template for an in-scope renderer', () => {
  const { scratch, root, appRoot } = createMarkerFreeRendererFixture();
  try {
    fs.rmSync(path.join(appRoot, '.env.example'));
    const issues = withScopeRepositories(['sdkwork-demo'], () => validateCredentialEntryRepository(root));
    assert.ok(
      issues.some((issue) => issue.includes('must provide a private env template with blank SDKWORK_ACCESS_TOKEN=')),
      `expected an env-template finding, received: ${JSON.stringify(issues)}`,
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('leaves a marker-free renderer alone while its repository is out of scope', () => {
  const { scratch, root } = createMarkerFreeRendererFixture();
  try {
    const issues = withScopeRepositories([], () => validateCredentialEntryRepository(root));
    assert.deepEqual(issues, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scope entries match the repository name, not a repository-relative path', () => {
  const { scratch, root } = createMarkerFreeRendererFixture({ repositoryName: 'sdkwork-scoped-demo' });
  try {
    // Naming the repository must enforce it...
    const enforced = withScopeRepositories(['sdkwork-scoped-demo'], () => validateCredentialEntryRepository(root));
    assert.ok(enforced.some((issue) => issue.includes('must install')));
    // ...while naming an unrelated repository must not.
    const untouched = withScopeRepositories(['sdkwork-other-demo'], () => validateCredentialEntryRepository(root));
    assert.deepEqual(untouched, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scope entries may narrow enforcement to a subtree', () => {
  const { scratch, root } = createMarkerFreeRendererFixture();
  try {
    const subtree = withScopeRepositories(['sdkwork-demo/apps/sdkwork-demo-h5'], () => validateCredentialEntryRepository(root));
    assert.ok(subtree.some((issue) => issue.includes('must install')));
    const siblingOnly = withScopeRepositories(['sdkwork-demo/apps/some-other-surface'], () => validateCredentialEntryRepository(root));
    assert.deepEqual(siblingOnly, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a marker-bearing renderer stays in scope even when its repository is not listed', () => {
  // Regression guard for the historical behaviour: repositories that already
  // reference credential entry must not silently drop out when the scope list
  // is empty.
  const root = createFixture({ installPlugin: false });
  try {
    const issues = withScopeRepositories([], () => validateCredentialEntryRepository(root));
    assert.ok(issues.some((issue) => issue.includes('must install')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
