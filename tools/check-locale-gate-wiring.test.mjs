import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyRepositoryRoot, reachableCommands } from './check-locale-gate-wiring.mjs';

const AUDIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-locale-gate-wiring.mjs');

function makeRepo(scripts) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-locale-wiring-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: path.basename(root), scripts }, null, 2));
  return root;
}

function runAudit(args) {
  return spawnSync(process.execPath, [AUDIT, ...args], { encoding: 'utf8' });
}

describe('reachableCommands', () => {
  it('follows pnpm script references transitively', () => {
    const scripts = {
      '_sdkwork:verify': 'pnpm run check:app-composition',
      'check:app-composition': 'node ../sdkwork-specs/tools/verify-repo.mjs --root .',
    };

    const commands = reachableCommands(scripts, '_sdkwork:verify');

    assert.deepEqual(commands, [
      'pnpm run check:app-composition',
      'node ../sdkwork-specs/tools/verify-repo.mjs --root .',
    ]);
  });

  it('follows sdkwork-run-pnpm thin runner references', () => {
    const scripts = {
      '_sdkwork:verify': 'sdkwork-run-pnpm build && sdkwork-run-pnpm check:i18n-standard',
      build: 'sdkwork-run-node scripts/build.mjs',
      'check:i18n-standard': 'node ../sdkwork-specs/tools/check-i18n-standard.mjs --root .',
    };

    const commands = reachableCommands(scripts, '_sdkwork:verify');

    assert.ok(commands.some((c) => /check-i18n-standard\.mjs/u.test(c)));
  });

  it('follows the sdkwork-app re-entry into the private verify hook', () => {
    const scripts = {
      verify: 'pnpm exec sdkwork-app verify',
      '_sdkwork:verify': 'pnpm test && pnpm check:i18n-standard',
      'check:i18n-standard': 'node ../sdkwork-specs/tools/check-i18n-standard.mjs --root .',
    };

    const commands = reachableCommands(scripts, 'verify');

    assert.ok(commands.some((c) => /check-i18n-standard\.mjs/u.test(c)));
  });

  it('terminates on a reference cycle', () => {
    const scripts = {
      '_sdkwork:verify': 'pnpm run check',
      check: 'pnpm run _sdkwork:verify',
    };

    const commands = reachableCommands(scripts, '_sdkwork:verify');

    assert.equal(commands.length, 2);
  });

  it('ignores references to scripts that do not exist', () => {
    const scripts = { check: 'pnpm run missing-script && pnpm test' };

    const commands = reachableCommands(scripts, 'check');

    assert.deepEqual(commands, ['pnpm run missing-script && pnpm test']);
  });
});

describe('classifyRepositoryRoot', () => {
  it('reports a repository without package.json as outside npm scope', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-locale-wiring-'));
    assert.equal(classifyRepositoryRoot(root).state, 'no-manifest');
  });

  it('reports a repository with no preferred aggregate as a warning', () => {
    const root = makeRepo({ lint: 'eslint .' });
    assert.equal(classifyRepositoryRoot(root).state, 'no-aggregate');
  });

  it('is unwired when the gate is declared but never referenced by the aggregate', () => {
    // This is the failure mode the audit exists for: the script exists, so the
    // repository looks wired, but no aggregate ever runs it.
    const root = makeRepo({
      '_sdkwork:verify': 'pnpm test',
      'check:app-composition': 'node ../sdkwork-specs/tools/verify-repo.mjs --root .',
    });

    const result = classifyRepositoryRoot(root);

    assert.equal(result.state, 'unwired');
    assert.equal(result.aggregate, '_sdkwork:verify');
  });

  it('is wired when the aggregate references the declared gate', () => {
    const root = makeRepo({
      '_sdkwork:verify': 'pnpm test && pnpm check:app-composition',
      'check:app-composition': 'node ../sdkwork-specs/tools/verify-repo.mjs --root .',
    });

    assert.equal(classifyRepositoryRoot(root).state, 'wired');
  });

  it('prefers _sdkwork:verify over verify and check', () => {
    const root = makeRepo({
      '_sdkwork:verify': 'pnpm test',
      verify: 'pnpm check:i18n-standard',
      check: 'pnpm test',
      'check:i18n-standard': 'node ../sdkwork-specs/tools/check-i18n-standard.mjs --root .',
    });

    // The higher-preference aggregate is the one that actually gates merges.
    assert.equal(classifyRepositoryRoot(root).state, 'unwired');
  });
});

describe('audit CLI', () => {
  it('fails closed on a workspace root that does not exist', () => {
    const result = runAudit(['--workspace', path.join(os.tmpdir(), 'sdkwork-absent-workspace')]);

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /not a directory/u);
  });

  it('fails closed when the workspace enumerates no repositories', () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-empty-workspace-'));

    const result = runAudit(['--workspace', empty]);

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /enumerated 0 repositories/u);
  });

  it('exits non-zero under --enforce when a repository is unwired', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-workspace-'));
    const repo = path.join(workspace, 'sdkwork-demo');
    mkdirSync(repo, { recursive: true });
    writeFileSync(path.join(repo, 'AGENTS.md'), '# Repository Guidelines\n');
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
      scripts: {
        '_sdkwork:verify': 'pnpm test',
        'check:app-composition': 'node ../sdkwork-specs/tools/verify-repo.mjs --root .',
      },
    }, null, 2));

    const result = runAudit(['--workspace', workspace, '--enforce']);

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /UNWIRED \(aggregate exists, gate unreachable\): 1/u);
  });
});
