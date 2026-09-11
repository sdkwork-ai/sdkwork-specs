import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyAppTailwindDependencies,
  classifyCssTailwindBootstrap,
  classifyViteTailwindConfig,
  isTailwindBootstrapAllowed,
} from './lib/tailwind-integration-patterns.mjs';

test('allows app shell bootstrap css', () => {
  assert.equal(
    isTailwindBootstrapAllowed('apps/sdkwork-im-pc/src/index.css'),
    true,
  );
  assert.deepEqual(
    classifyCssTailwindBootstrap('apps/sdkwork-im-pc/src/index.css', '@import "tailwindcss";'),
    [],
  );
});
test('allows nested shell bootstrap css', () => {
  assert.equal(
    isTailwindBootstrapAllowed('sdkwork-notes-pc-react/packages/sdkwork-notes-pc-shell/src/styles/index.css'),
    true,
  );
});

test('allows repo-root bootstrap css', () => {
  assert.equal(isTailwindBootstrapAllowed('src/index.css'), true);
});

test('rejects host-composed feature package bootstrap css', () => {
  const issues = classifyCssTailwindBootstrap(
    'apps/sdkwork-drive-pc/packages/sdkwork-drive-pc-drive/src/driveSurface.css',
    '@import "tailwindcss";',
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'forbidden-feature-bootstrap');
});

test('rejects deprecated tailwind vite alias', () => {
  const issues = classifyViteTailwindConfig(
    'apps/sdkwork-im-pc/vite.config.ts',
    "{ find: 'tailwindcss', replacement: appRequire.resolve('tailwindcss/index.css') }",
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'deprecated-tailwind-vite-alias');
});

test('exempts the shared UI library manifest wherever it sits in the repository', () => {
  // The UI library owns the single shared bootstrap sheet, so it is exempt from
  // the app-level dependency-section rule. The guard must match both a repository
  // root child (`sdkwork-ui-pc-react/package.json`) and a nested one — the root
  // child form has no leading slash and used to slip through.
  const manifest = {
    dependencies: {},
    devDependencies: { tailwindcss: 'catalog:', '@tailwindcss/vite': 'catalog:' },
  };
  for (const relativePath of [
    'sdkwork-ui-pc-react/package.json',
    'packages/sdkwork-ui-pc-react/package.json',
    'apps/sdkwork-x-pc/packages/sdkwork-ui-pc-react/package.json',
  ]) {
    assert.deepEqual(
      classifyAppTailwindDependencies(relativePath, manifest, null),
      [],
      `${relativePath} must be exempt from the app-level dependency-section rule`,
    );
  }
});
