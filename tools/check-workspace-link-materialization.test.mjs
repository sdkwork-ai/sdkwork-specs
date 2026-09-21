import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CAUSE_INSTALL_PENDING,
  CAUSE_WORKSPACE_UNCOVERED,
  declaredWorkspaceDependencies,
  linkExists,
  readManifest,
  validateRepository,
  workspaceGlobToRegExp,
  workspaceMemberGlobs,
  workspaceSpecifierTarget,
} from './lib/workspace-link-materialization.mjs';

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-link-materialization-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# fixture\n');
  return root;
}

function writeManifest(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeWorkspaceYaml(root, packages) {
  const lines = ['packages:'];
  for (const entry of packages) {
    lines.push(`  - "${entry}"`);
  }
  lines.push('', 'catalog:', '  react: ^19.2.8', '  "@sdkwork/not-a-member": workspace:*', '');
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), lines.join('\n'));
}

function markInstalled(root) {
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', '.modules.yaml'), 'storeDir: /tmp/store\n');
}

/** Create the symlink a successful `pnpm install` would have produced. */
function materializeLink(importerDir, dependencyName, target) {
  const scopedDir = path.join(importerDir, 'node_modules', ...dependencyName.split('/').slice(0, 1));
  fs.mkdirSync(scopedDir, { recursive: true });
  fs.symlinkSync(target, path.join(importerDir, 'node_modules', ...dependencyName.split('/')), 'junction');
}

test('only workspace: specifiers in the @sdkwork scope are governed', () => {
  const declared = declaredWorkspaceDependencies({
    dependencies: {
      '@sdkwork/workspace-dep': 'workspace:*',
      '@sdkwork/registry-dep': '^1.0.2',
      'third-party': 'workspace:*',
    },
    devDependencies: { '@sdkwork/dev-dep': 'workspace:^' },
    peerDependencies: { '@sdkwork/peer-dep': 'workspace:~' },
  });
  assert.deepEqual(
    declared.map((entry) => entry.name),
    ['@sdkwork/dev-dep', '@sdkwork/peer-dep', '@sdkwork/workspace-dep'],
  );
});

test('workspace globs match within a segment only', () => {
  assert.equal(workspaceGlobToRegExp('apps/sdkwork-im-pc/packages/*').test('apps/sdkwork-im-pc/packages/core'), true);
  assert.equal(workspaceGlobToRegExp('apps/sdkwork-im-pc/packages/*').test('apps/sdkwork-im-pc/packages/deep/core'), false);
  assert.equal(workspaceGlobToRegExp('apps/*').test('apps/sdkwork-im-pc'), true);
  assert.equal(workspaceGlobToRegExp('apps/*').test('apps/sdkwork-im-pc/nested'), false);
});

test('catalog keys are not mistaken for member globs', () => {
  const root = makeRepo();
  writeWorkspaceYaml(root, ['apps/sdkwork-im-pc']);
  const globs = workspaceMemberGlobs(root);
  assert.equal(globs.length, 1);
  assert.equal(globs[0].test('apps/sdkwork-im-pc'), true);
  // The catalog contains `@sdkwork/not-a-member`; it must not become a glob.
  assert.equal(globs.some((glob) => glob.test('@sdkwork/not-a-member')), false);
});

test('a repository that was never installed is skipped, not reported', () => {
  const root = makeRepo();
  writeWorkspaceYaml(root, ['apps/sdkwork-im-pc']);
  writeManifest(path.join(root, 'apps', 'sdkwork-im-pc'), {
    name: '@sdkwork/im-pc',
    dependencies: { '@sdkwork/ui-pc-react': 'workspace:*' },
  });

  const result = validateRepository(root);
  assert.equal(result.installed, false);
  assert.deepEqual(result.violations, []);
});

test('an installed repository with a materialized link is clean', () => {
  const root = makeRepo();
  markInstalled(root);
  writeWorkspaceYaml(root, ['apps/sdkwork-im-pc']);
  const appDir = path.join(root, 'apps', 'sdkwork-im-pc');
  writeManifest(appDir, {
    name: '@sdkwork/im-pc',
    dependencies: { '@sdkwork/ui-pc-react': 'workspace:*' },
  });
  materializeLink(appDir, '@sdkwork/ui-pc-react', path.join(root, 'sibling-ui'));

  assert.equal(linkExists(appDir, '@sdkwork/ui-pc-react'), true);
  assert.deepEqual(validateRepository(root).violations, []);
});

test('a workspace member with a missing link is install-pending', () => {
  const root = makeRepo();
  markInstalled(root);
  writeWorkspaceYaml(root, ['apps/sdkwork-im-pc']);
  const appDir = path.join(root, 'apps', 'sdkwork-im-pc');
  writeManifest(appDir, {
    name: '@sdkwork/im-pc',
    dependencies: { '@sdkwork/ui-pc-react': 'workspace:*' },
  });

  const violations = validateRepository(root).violations;
  assert.equal(violations.length, 1);
  assert.equal(violations[0].cause, CAUSE_INSTALL_PENDING);
  assert.equal(violations[0].dependency, '@sdkwork/ui-pc-react');
  assert.equal(violations[0].packageDir, 'apps/sdkwork-im-pc');
});

test('a manifest outside the workspace globs is workspace-uncovered, not install-pending', () => {
  const root = makeRepo();
  markInstalled(root);
  // Only the PC app is a member; the common subtree is deliberately excluded.
  writeWorkspaceYaml(root, ['apps/sdkwork-im-pc']);
  const orphanDir = path.join(root, 'apps', 'sdkwork-im-common', 'packages', 'sdkwork-im-mobile-react');
  writeManifest(orphanDir, {
    name: '@sdkwork/im-mobile-react',
    dependencies: { '@sdkwork/ui-mobile-react': 'workspace:*' },
  });

  const violations = validateRepository(root).violations;
  assert.equal(violations.length, 1);
  assert.equal(violations[0].cause, CAUSE_WORKSPACE_UNCOVERED);
});

test('links are judged per declaring package, not per repository root', () => {
  const root = makeRepo();
  markInstalled(root);
  writeWorkspaceYaml(root, ['apps/sdkwork-im-pc', 'apps/sdkwork-im-pc/packages/*']);

  const appDir = path.join(root, 'apps', 'sdkwork-im-pc');
  const coreDir = path.join(appDir, 'packages', 'sdkwork-im-pc-core');
  for (const dir of [appDir, coreDir]) {
    writeManifest(dir, {
      name: `@sdkwork/fixture-${path.basename(dir)}`,
      dependencies: { '@sdkwork/ui-pc-react': 'workspace:*' },
    });
  }

  // Only the app root gets its link, as happens when install ran before the
  // core package declared the dependency.
  materializeLink(appDir, '@sdkwork/ui-pc-react', path.join(root, 'sibling-ui'));

  const violations = validateRepository(root).violations;
  assert.equal(violations.length, 1);
  assert.equal(violations[0].packageDir, 'apps/sdkwork-im-pc/packages/sdkwork-im-pc-core');
  assert.equal(violations[0].cause, CAUSE_INSTALL_PENDING);
});

test('non-workspace specifiers never produce a violation', () => {
  const root = makeRepo();
  markInstalled(root);
  writeWorkspaceYaml(root, ['apps/sdkwork-im-pc']);
  writeManifest(path.join(root, 'apps', 'sdkwork-im-pc'), {
    name: '@sdkwork/im-pc',
    dependencies: { '@sdkwork/sdk-common': '^1.0.2' },
  });

  assert.deepEqual(validateRepository(root).violations, []);
});

test('the repository root is an implicit member, so its missing link is install-pending', () => {
  const root = makeRepo();
  markInstalled(root);
  // No glob matches the repository root, yet pnpm still treats it as a project.
  writeWorkspaceYaml(root, ['apps/sdkwork-im-pc']);
  writeManifest(root, {
    name: '@sdkwork/repo-root',
    dependencies: { '@sdkwork/sdk-common': 'workspace:*' },
  });

  const violations = validateRepository(root).violations;
  assert.equal(violations.length, 1);
  assert.equal(violations[0].cause, CAUSE_INSTALL_PENDING);
  assert.equal(violations[0].packageDir, '.');
});

test('an empty packages list still governs the repository root', () => {
  const root = makeRepo();
  markInstalled(root);
  writeWorkspaceYaml(root, []);
  writeManifest(root, {
    name: '@sdkwork/repo-root',
    dependencies: { '@sdkwork/sdk-common': 'workspace:*' },
  });

  const violations = validateRepository(root).violations;
  assert.equal(violations.length, 1);
  assert.equal(violations[0].cause, CAUSE_INSTALL_PENDING);
});

test('a BOM-prefixed manifest is still read, not silently skipped', () => {
  const root = makeRepo();
  markInstalled(root);
  writeWorkspaceYaml(root, []);
  // `JSON.parse` rejects a leading U+FEFF. Writing the BOM must not be able to
  // hide the package: that failure mode reports *nothing* while a real
  // dependency rots unlinked.
  const manifest = {
    name: '@sdkwork/bom-package',
    dependencies: { '@sdkwork/sdk-common': 'workspace:*' },
  };
  const dir = path.join(root, 'packages', 'bom-package');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `\uFEFF${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const violations = validateRepository(root).violations;
  assert.equal(violations.length, 1, 'the BOM-prefixed package must still be policed');
  assert.equal(violations[0].packageName, '@sdkwork/bom-package');
  assert.equal(violations[0].dependency, '@sdkwork/sdk-common');
});

test('readManifest tolerates a BOM and parses the real content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-read-manifest-'));
  const file = path.join(dir, 'package.json');
  fs.writeFileSync(file, '\uFEFF{"name":"@sdkwork/x"}\n', 'utf8');
  assert.deepEqual(readManifest(file), { name: '@sdkwork/x' });
});

test('a workspace specifier resolves to the package it points at, not the key', () => {
  assert.equal(workspaceSpecifierTarget('@sdkwork/x', 'workspace:*'), '@sdkwork/x');
  assert.equal(workspaceSpecifierTarget('@sdkwork/x', 'workspace:^1.2.3'), '@sdkwork/x');
  assert.equal(workspaceSpecifierTarget('@sdkwork/x', 'workspace:~1.2.3'), '@sdkwork/x');
  assert.equal(
    workspaceSpecifierTarget('@sdkwork/drive-pc-drive', 'workspace:sdkwork-drive-pc-drive@*'),
    'sdkwork-drive-pc-drive',
  );
  assert.equal(
    workspaceSpecifierTarget('@sdkwork/foo', 'workspace:other-pkg@^2.0.0'),
    'other-pkg',
  );
});

test('an aliased workspace dependency is reported with its real target package', () => {
  const root = makeRepo();
  markInstalled(root);
  writeWorkspaceYaml(root, ['apps/im-pc']);
  writeManifest(path.join(root, 'apps', 'im-pc'), {
    name: '@sdkwork/im-pc-core',
    dependencies: { '@sdkwork/drive-pc-drive': 'workspace:sdkwork-drive-pc-drive@*' },
  });

  const violations = validateRepository(root).violations;
  assert.equal(violations.length, 1);
  assert.equal(violations[0].dependency, '@sdkwork/drive-pc-drive');
  assert.equal(violations[0].targetPackage, 'sdkwork-drive-pc-drive');
});

test('optionalDependencies are policed like the other dependency fields', () => {
  const root = makeRepo();
  markInstalled(root);
  writeWorkspaceYaml(root, []);
  writeManifest(root, {
    name: '@sdkwork/repo-root',
    optionalDependencies: { '@sdkwork/sdk-common': 'workspace:*' },
  });

  const violations = validateRepository(root).violations;
  assert.equal(violations.length, 1);
  assert.equal(violations[0].field, 'optionalDependencies');
});

test('a slashless member entry is kept, not dropped as a non-glob', () => {
  // `packages: ["sdkwork-notes-pc-react"]` declares that directory as a member.
  // Dropping it because it has no `/` would misfile its dependencies as
  // workspace-uncovered — advice install can never satisfy.
  const root = makeRepo();
  markInstalled(root);
  writeWorkspaceYaml(root, ['sdkwork-notes-pc-react']);
  writeManifest(path.join(root, 'sdkwork-notes-pc-react'), {
    name: '@sdkwork/notes-pc-react',
    dependencies: { '@sdkwork/utils': 'workspace:*' },
  });

  const violations = validateRepository(root).violations;
  assert.equal(violations.length, 1);
  assert.equal(
    violations[0].cause,
    CAUSE_INSTALL_PENDING,
    'a declared slashless member must be install-pending, not workspace-uncovered',
  );
});
