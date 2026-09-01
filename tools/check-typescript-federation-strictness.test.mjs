import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  STRICTNESS_FLOOR,
  collectFederatedTargets,
  findGoverningTsconfig,
  listFederatedSupplierRepos,
  missingStrictnessFlags,
  parseJsonc,
  readEffectiveCompilerOptions,
  relaxedStrictnessFlags,
  scanTypeScriptFederationStrictness,
  stripJsonComments,
  stripTrailingCommas,
  isUpstreamBoundaryPath,
  isBaseFragmentTsconfig,
  UPSTREAM_BOUNDARY_DIRECTORIES,
} from './lib/typescript-federation-strictness.mjs';

const STRICT_OPTIONS = Object.freeze({
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noImplicitOverride: true,
  noFallthroughCasesInSwitch: true,
});

function makeTempParent(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(
      absolute,
      typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
    );
  }
  return root;
}

function makeRepo(parent, name, files) {
  return writeFiles(path.join(parent, name), files);
}

function strictTsconfig(extra = {}) {
  return { compilerOptions: { ...STRICT_OPTIONS, ...extra }, include: ['src'] };
}

test('parses tsconfig JSONC with comments and trailing commas', () => {
  const parsed = parseJsonc(`{
    // federation baseline
    "compilerOptions": {
      "strict": true, /* required */
      "noUnusedLocals": true,
    },
  }`);

  assert.deepEqual(parsed, {
    compilerOptions: { strict: true, noUnusedLocals: true },
  });
});

test('strips comments without touching string literals', () => {
  const text = '{ "a": "// not a comment", "b": "/* nor this */" } // real comment';
  const stripped = stripJsonComments(text);
  assert.match(stripped, /\/\/ not a comment/);
  assert.match(stripped, /\/\* nor this \*\//);
  assert.doesNotMatch(stripped, /real comment/);
});

test('strips trailing commas only before closing brackets', () => {
  assert.equal(stripTrailingCommas('[1, 2, ]'), '[1, 2, ]'.replace(', ]', ' ]'));
  assert.equal(stripTrailingCommas('["a,"]'), '["a,"]');
});

test('resolves effective compilerOptions across the extends chain', () => {
  const parent = makeTempParent('sdkwork-tsfed-extends-');
  const repoRoot = makeRepo(parent, 'sdkwork-consumer', {
    'tsconfig.base.json': { compilerOptions: { ...STRICT_OPTIONS, noEmit: true } },
    'apps/app/tsconfig.json': {
      extends: '../../tsconfig.base.json',
      compilerOptions: { noUncheckedIndexedAccess: false },
      include: ['src'],
    },
  });

  const { chain, compilerOptions } = readEffectiveCompilerOptions(
    path.join(repoRoot, 'apps/app/tsconfig.json'),
  );

  assert.equal(chain.length, 2);
  assert.equal(compilerOptions.exactOptionalPropertyTypes, true);
  assert.equal(compilerOptions.noEmit, true);
  assert.equal(compilerOptions.noUncheckedIndexedAccess, false);

  // The leaf wins, so the flag is reported as an active relaxation, not an omission.
  assert.deepEqual(missingStrictnessFlags(compilerOptions), ['noUncheckedIndexedAccess']);
  assert.deepEqual(relaxedStrictnessFlags(compilerOptions), ['noUncheckedIndexedAccess']);
});

test('flags a consumer that relaxes the strictness floor', () => {
  const parent = makeTempParent('sdkwork-tsfed-consumer-');
  const repoRoot = makeRepo(parent, 'sdkwork-consumer', {
    'tsconfig.base.json': {
      compilerOptions: { ...STRICT_OPTIONS, exactOptionalPropertyTypes: false },
    },
  });

  const result = scanTypeScriptFederationStrictness(repoRoot);
  const kinds = result.failures.map((issue) => `${issue.kind}:${issue.entry}`);

  assert.ok(kinds.includes('consumer-strictness-relaxed:exactOptionalPropertyTypes'));
  assert.equal(result.consumer.baseline.includes('exactOptionalPropertyTypes'), false);
});

test('accepts a compliant supplier and rejects one below the baseline', () => {
  const parent = makeTempParent('sdkwork-tsfed-supplier-');
  const repoRoot = makeRepo(parent, 'sdkwork-consumer', {
    'tsconfig.base.json': {
      compilerOptions: {
        ...STRICT_OPTIONS,
        paths: {
          '@sdkwork/ok': ['../sdkwork-ok/packages/core/src/index.ts'],
          '@sdkwork/bad': ['../sdkwork-bad/packages/core/src/index.ts'],
        },
      },
    },
  });
  makeRepo(parent, 'sdkwork-ok', {
    'packages/core/tsconfig.json': strictTsconfig(),
    'packages/core/src/index.ts': 'export {};\n',
    'package.json': { name: 'sdkwork-ok', scripts: { typecheck: 'tsc --noEmit' } },
  });
  makeRepo(parent, 'sdkwork-bad', {
    'packages/core/tsconfig.json': { compilerOptions: { strict: true }, include: ['src'] },
    'packages/core/src/index.ts': 'export {};\n',
    'package.json': { name: 'sdkwork-bad', scripts: { typecheck: 'tsc --noEmit' } },
  });

  const result = scanTypeScriptFederationStrictness(repoRoot);
  const byName = new Map(result.suppliers.map((supplier) => [supplier.name, supplier]));

  assert.equal(byName.get('sdkwork-ok').compliant, true);
  assert.equal(byName.get('sdkwork-bad').compliant, false);
  assert.deepEqual(byName.get('sdkwork-bad').tsconfigs[0].missing, STRICTNESS_FLOOR.slice(1));
});

test('requires a typecheck script on every federated supplier', () => {
  const parent = makeTempParent('sdkwork-tsfed-script-');
  const repoRoot = makeRepo(parent, 'sdkwork-consumer', {
    'tsconfig.base.json': {
      compilerOptions: {
        ...STRICT_OPTIONS,
        paths: { '@sdkwork/nocheck': ['../sdkwork-nocheck/packages/core/src/index.ts'] },
      },
    },
  });
  makeRepo(parent, 'sdkwork-nocheck', {
    'packages/core/tsconfig.json': strictTsconfig(),
    'packages/core/src/index.ts': 'export {};\n',
    'package.json': { name: 'sdkwork-nocheck', scripts: { build: 'vite build' } },
  });

  const result = scanTypeScriptFederationStrictness(repoRoot);
  assert.deepEqual(
    result.failures.map((issue) => issue.kind),
    ['supplier-typecheck-script-missing'],
  );
});

test('migration list demotes supplier failures to warnings', () => {
  const parent = makeTempParent('sdkwork-tsfed-migration-');
  const repoRoot = makeRepo(parent, 'sdkwork-consumer', {
    'tsconfig.base.json': {
      compilerOptions: {
        ...STRICT_OPTIONS,
        paths: { '@sdkwork/legacy': ['../sdkwork-legacy/packages/core/src/index.ts'] },
      },
    },
  });
  makeRepo(parent, 'sdkwork-legacy', {
    'packages/core/tsconfig.json': { compilerOptions: { strict: true }, include: ['src'] },
    'packages/core/src/index.ts': 'export {};\n',
    'package.json': { name: 'sdkwork-legacy', scripts: {} },
  });
  const migrationList = path.join(repoRoot, '.sdkwork/typescript-federation-migration.json');
  writeFiles(repoRoot, {
    '.sdkwork/typescript-federation-migration.json': {
      version: 1,
      repos: [{ repo: 'sdkwork-legacy', reason: 'migration in progress', expires: '2099-01-01' }],
    },
  });

  const result = scanTypeScriptFederationStrictness(repoRoot, { migrationList });
  assert.equal(result.failures.length, 0);
  assert.ok(result.warnings.length > 0);
  assert.equal(result.suppliers[0].migrating, true);
});

test('fails on a stale migration entry once the supplier complies', () => {
  const parent = makeTempParent('sdkwork-tsfed-stale-');
  const repoRoot = makeRepo(parent, 'sdkwork-consumer', {
    'tsconfig.base.json': {
      compilerOptions: {
        ...STRICT_OPTIONS,
        paths: { '@sdkwork/done': ['../sdkwork-done/packages/core/src/index.ts'] },
      },
    },
  });
  makeRepo(parent, 'sdkwork-done', {
    'packages/core/tsconfig.json': strictTsconfig(),
    'packages/core/src/index.ts': 'export {};\n',
    'package.json': { name: 'sdkwork-done', scripts: { typecheck: 'tsc --noEmit' } },
  });
  const migrationList = path.join(repoRoot, '.sdkwork/typescript-federation-migration.json');
  writeFiles(repoRoot, {
    '.sdkwork/typescript-federation-migration.json': {
      version: 1,
      repos: [{ repo: 'sdkwork-done', reason: 'already fixed', expires: '2099-01-01' }],
    },
  });

  const result = scanTypeScriptFederationStrictness(repoRoot, { migrationList });
  assert.deepEqual(
    result.failures.map((issue) => issue.kind),
    ['stale-migration-entry'],
  );
});

test('fails when a migration grace period expires', () => {
  const parent = makeTempParent('sdkwork-tsfed-expired-');
  const repoRoot = makeRepo(parent, 'sdkwork-consumer', {
    'tsconfig.base.json': {
      compilerOptions: {
        ...STRICT_OPTIONS,
        paths: { '@sdkwork/overdue': ['../sdkwork-overdue/packages/core/src/index.ts'] },
      },
    },
  });
  makeRepo(parent, 'sdkwork-overdue', {
    'packages/core/tsconfig.json': { compilerOptions: { strict: true }, include: ['src'] },
    'packages/core/src/index.ts': 'export {};\n',
    'package.json': { name: 'sdkwork-overdue', scripts: {} },
  });
  const migrationList = path.join(repoRoot, '.sdkwork/typescript-federation-migration.json');
  writeFiles(repoRoot, {
    '.sdkwork/typescript-federation-migration.json': {
      version: 1,
      repos: [{ repo: 'sdkwork-overdue', reason: 'overdue', expires: '2020-01-01' }],
    },
  });

  const result = scanTypeScriptFederationStrictness(repoRoot, {
    migrationList,
    today: '2026-09-01',
  });
  assert.ok(result.failures.some((issue) => issue.kind === 'expired-migration-entry'));
  assert.deepEqual(result.migration.expired, ['sdkwork-overdue']);
});

test('ignores deeper directory escapes that are not sibling repositories', () => {
  const parent = makeTempParent('sdkwork-tsfed-escape-');
  const repoRoot = makeRepo(parent, 'sdkwork-consumer', {
    'tsconfig.base.json': {
      compilerOptions: {
        ...STRICT_OPTIONS,
        paths: { '@sdkwork/escape': ['../../sdkwork-escape/packages/core/src/index.ts'] },
      },
    },
  });
  writeFiles(parent, {
    'sdkwork-escape/packages/core/src/index.ts': 'export {};\n',
  });

  assert.deepEqual(collectFederatedTargets(repoRoot), []);
  assert.deepEqual(listFederatedSupplierRepos(repoRoot), []);
});

test('resolves the nearest tsconfig that governs a federated directory', () => {
  const parent = makeTempParent('sdkwork-tsfed-governing-');
  const supplierRoot = makeRepo(parent, 'sdkwork-nested', {
    'tsconfig.json': strictTsconfig(),
    'packages/core/src/index.ts': 'export {};\n',
  });

  const governing = findGoverningTsconfig(path.join(supplierRoot, 'packages/core/src'), supplierRoot);
  assert.equal(governing, path.join(supplierRoot, 'tsconfig.json'));
});

test('prefers tsconfig.json over tsconfig.base.json in the same directory', () => {
  const parent = makeTempParent('sdkwork-tsfed-prefer-');
  const supplierRoot = makeRepo(parent, 'sdkwork-prefer', {
    'tsconfig.base.json': { compilerOptions: { strict: true } },
    'tsconfig.json': { extends: './tsconfig.base.json', ...strictTsconfig() },
    'packages/core/src/index.ts': 'export {};\n',
  });

  const governing = findGoverningTsconfig(path.join(supplierRoot, 'packages/core/src'), supplierRoot);
  assert.equal(governing, path.join(supplierRoot, 'tsconfig.json'));
});

test('collects suppliers from both pnpm-workspace.yaml and tsconfig paths', () => {
  const parent = makeTempParent('sdkwork-tsfed-sources-');
  const repoRoot = makeRepo(parent, 'sdkwork-consumer', {
    'pnpm-workspace.yaml': [
      'packages:',
      "  - '../sdkwork-from-workspace/packages/core'",
      '',
    ].join('\n'),
    'tsconfig.base.json': {
      compilerOptions: {
        ...STRICT_OPTIONS,
        paths: { '@sdkwork/from-paths': ['../sdkwork-from-paths/packages/core/src/index.ts'] },
      },
    },
  });
  for (const name of ['sdkwork-from-workspace', 'sdkwork-from-paths']) {
    makeRepo(parent, name, {
      'packages/core/tsconfig.json': strictTsconfig(),
      'packages/core/src/index.ts': 'export {};\n',
      'package.json': { name, scripts: { typecheck: 'tsc --noEmit' } },
    });
  }

  const suppliers = listFederatedSupplierRepos(repoRoot);
  assert.deepEqual(suppliers.map((supplier) => supplier.name), [
    'sdkwork-from-paths',
    'sdkwork-from-workspace',
  ]);
  assert.deepEqual(suppliers.find((s) => s.name === 'sdkwork-from-workspace').sources, [
    'pnpm-workspace.yaml',
  ]);
  assert.deepEqual(suppliers.find((s) => s.name === 'sdkwork-from-paths').sources, [
    'tsconfig.base.json',
  ]);
});

test('treats root-level upstream trees as read-only boundaries', () => {
  for (const tree of UPSTREAM_BOUNDARY_DIRECTORIES) {
    assert.equal(isUpstreamBoundaryPath(`${tree}/cordis/src/index.ts`), true, tree);
    assert.equal(isUpstreamBoundaryPath(`${tree}/tsconfig.json`), true, tree);
  }
  assert.equal(isUpstreamBoundaryPath('packages/core/src/index.ts'), false);
  assert.equal(isUpstreamBoundaryPath('src/vendor/helpers.ts'), false);
  assert.equal(isUpstreamBoundaryPath('vendor\\cordis\\src\\index.ts'), true);
});

test('a nested vendor directory stays inside the strictness contract', () => {
  // Only the first segment counts: packages/<pkg>/vendor is SDKWork-authored code, so exempting it
  // would silently drop real debt out of the gate.
  assert.equal(isUpstreamBoundaryPath('packages/acme/vendor/shim.ts'), false);
  assert.equal(isUpstreamBoundaryPath('vendor'), true);
});

test('treats tsconfig.base* fragments as non-programs', () => {
  // A shared `extends` target is never compiled on its own; tsc-ing it produces spurious TS2877
  // from its `paths` entries, so it must not be picked up as a project.
  assert.equal(isBaseFragmentTsconfig('tsconfig.base.json'), true);
  assert.equal(isBaseFragmentTsconfig('tsconfig.base.client.json'), true);
  assert.equal(isBaseFragmentTsconfig('tsconfig.base.host.web.json'), true);
  assert.equal(isBaseFragmentTsconfig('/repo/tsconfig.base.json'), true);
  assert.equal(isBaseFragmentTsconfig('tsconfig.json'), false);
  assert.equal(isBaseFragmentTsconfig('tsconfig.client.json'), false);
  assert.equal(isBaseFragmentTsconfig('packages/core/tsconfig.json'), false);
  assert.equal(isBaseFragmentTsconfig('tsconfig.baseline.json'), false);
});
