import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { applyRepositoryLifecycleFacade, planRepositoryLifecycleFacade } from './align-pnpm-lifecycle-facade.mjs';

const APP_TOPOLOGY = '@sdkwork/app-topology';

function makeRepo(scripts, { cargo = false, apps = false, eol = '\n', appConfig = null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-align-lifecycle-'));
  const manifest = { name: 'sdkwork-demo', private: true, scripts };
  if (apps) mkdirSync(path.join(root, 'apps', 'sdkwork-demo-pc'), { recursive: true });
  if (cargo) writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\n');
  if (appConfig) writeFileSync(path.join(root, 'sdkwork.app.config.json'), JSON.stringify(appConfig));
  const serialized = JSON.stringify(manifest, null, 2);
  writeFileSync(path.join(root, 'package.json'), (eol === '\r\n' ? serialized.replaceAll('\n', '\r\n') : serialized) + eol);
  return root;
}

function scriptsOf(root) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
}

const COMPLETE = {
  dev: 'pnpm --dir apps/sdkwork-demo-pc dev',
  build: 'tsc && vite build',
  test: 'vitest',
  check: 'pnpm run check:app-composition',
  verify: 'pnpm check && pnpm test',
  clean: 'node scripts/clean-artifacts.mjs',
  'check:app-composition': 'node ../sdkwork-specs/tools/verify-repo.mjs --root .',
};

describe('align-pnpm-lifecycle-facade', () => {
  it('moves an existing public verb into the matching private hook', () => {
    const root = makeRepo(COMPLETE);
    const result = applyRepositoryLifecycleFacade(root, { dryRun: false });

    assert.equal(result.written, true);
    const scripts = scriptsOf(root);
    assert.equal(scripts.build, 'pnpm exec sdkwork-app build');
    assert.equal(scripts['_sdkwork:build'], 'tsc && vite build');
    assert.equal(scripts.test, 'pnpm exec sdkwork-app test');
    assert.equal(scripts['_sdkwork:test'], 'vitest');
    assert.equal(scripts['_sdkwork:clean'], 'node scripts/clean-artifacts.mjs');
  });

  it('declares the pinned topology dependency once the facade is invoked', () => {
    const root = makeRepo(COMPLETE);
    applyRepositoryLifecycleFacade(root, { dryRun: false });

    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.devDependencies[APP_TOPOLOGY], 'workspace:*');
  });

  it('aggregates existing check:* gates instead of inventing a check command', () => {
    const root = makeRepo({
      ...COMPLETE,
      check: undefined,
      'check:cors-standard': 'node ../sdkwork-specs/tools/check-cors-standard.mjs --root .',
    });
    applyRepositoryLifecycleFacade(root, { dryRun: false });

    const scripts = scriptsOf(root);
    assert.equal(
      scripts['_sdkwork:check'],
      'pnpm run check:app-composition && pnpm run check:cors-standard',
    );
  });

  it('derives cargo clean for a Rust workspace', () => {
    const root = makeRepo({ ...COMPLETE, clean: undefined }, { cargo: true });
    applyRepositoryLifecycleFacade(root, { dryRun: false });

    assert.equal(scriptsOf(root)['_sdkwork:clean'], 'cargo clean');
  });

  it('refuses to invent build for a repository that ships clients', () => {
    const root = makeRepo({
      ...COMPLETE,
      build: undefined,
      'build:pc:prod': 'node ../sdkwork-specs/tools/build-browser-client.mjs --root . --architecture pc --environment prod',
    }, { cargo: true, apps: true });
    const plan = planRepositoryLifecycleFacade(root);

    // A guessed build command would occupy the contract slot while doing the
    // wrong thing, so the gap is reported rather than filled.
    assert.equal(scriptsOf(root).build, undefined);
    assert.ok(plan.decisions.some((entry) => entry.startsWith('_sdkwork:build:')), plan.decisions.join('\n'));
    assert.ok(!plan.changes.some((entry) => entry.includes('_sdkwork:build')));
  });

  it('preserves CRLF line endings and the line count that existed before', () => {
    const root = makeRepo(COMPLETE, { eol: '\r\n' });
    const before = readFileSync(path.join(root, 'package.json'), 'utf8');
    applyRepositoryLifecycleFacade(root, { dryRun: false });
    const after = readFileSync(path.join(root, 'package.json'), 'utf8');

    assert.ok(after.includes('\r\n'));
    assert.equal((after.match(/(?<!\r)\n/gu) ?? []).length, 0, 'no bare LF may be introduced into a CRLF file');
    const added = after.split('\r\n').length - before.split('\r\n').length;
    assert.equal(
      (after.match(/\r\n/gu) ?? []).length - (before.match(/\r\n/gu) ?? []).length,
      added,
      'existing lines must keep their own ending',
    );
  });

  it('is idempotent: a second run writes nothing', () => {
    const root = makeRepo(COMPLETE);
    assert.equal(applyRepositoryLifecycleFacade(root, { dryRun: false }).written, true);
    const afterFirst = readFileSync(path.join(root, 'package.json'), 'utf8');
    const second = applyRepositoryLifecycleFacade(root, { dryRun: false });

    assert.equal(second.written, false);
    assert.deepEqual(second.changes, []);
    assert.equal(readFileSync(path.join(root, 'package.json'), 'utf8'), afterFirst);
  });

  it('leaves a repository that already exposes every required command alone', () => {
    const root = makeRepo({
      dev: 'pnpm dev:standalone',
      'dev:standalone': 'node scripts/sdkwork-command.mjs dev --deployment-profile standalone',
      'dev:cloud': 'node scripts/sdkwork-command.mjs dev --deployment-profile cloud',
      build: 'cargo build --workspace',
      test: 'cargo test --workspace',
      check: 'cargo check --workspace',
      verify: 'pnpm check && pnpm test',
      clean: 'cargo clean',
    });
    const plan = planRepositoryLifecycleFacade(root);

    // Adopting the facade is a deliberate decision, not an alignment fix, so a
    // repository that conforms to the required-command contract is not touched.
    assert.deepEqual(plan.changes, []);
    assert.equal(plan.addDependency, false);
  });

  it('does not resurrect the cloud development entrypoint for a standalone-only repository', () => {
    const root = makeRepo({ ...COMPLETE, 'dev:cloud': undefined }, {
      appConfig: { runtime: { supportedDeploymentProfiles: ['standalone'] } },
    });
    const plan = planRepositoryLifecycleFacade(root);

    assert.equal(plan.nextScripts['dev:cloud'], undefined);
    assert.ok(!plan.changes.some((entry) => entry.startsWith('dev:cloud')));
  });

  it('keeps dev exactly equivalent to dev:standalone', () => {
    const root = makeRepo(COMPLETE);
    applyRepositoryLifecycleFacade(root, { dryRun: false });
    const scripts = scriptsOf(root);

    assert.equal(scripts.dev, 'pnpm dev:standalone');
    assert.equal(scripts['dev:standalone'], 'pnpm exec sdkwork-app dev --deployment-profile standalone');
    assert.equal(scripts['_sdkwork:dev:standalone'], COMPLETE.dev);
  });
});
