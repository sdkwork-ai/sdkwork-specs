import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { validateAppsDirectoryIndex } from './check-apps-directory-index.mjs';

function write(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text);
}

function makeAppsReadme(children = []) {
  const rows = children.map((child) => (
    `| ${child} | pc | yes | Example surface | [README](${child}/README.md) |`
  ));
  return [
    '# apps/',
    '',
    'Application: demo',
    'Status: active',
    'Owner: demo-team',
    'Specs: APPLICATION_SPEC.md, SDKWORK_WORKSPACE_SPEC.md',
    '',
    '## Primary App Surface',
    '',
    'The repository root is not the primary runnable app surface.',
    '',
    '## Directory Index',
    '',
    '| Directory | Surface role | Runnable | Purpose | Entry |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

describe('check-apps-directory-index', () => {
  it('skips standards repositories', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-apps-index-'));
    write(root, 'DOCUMENTATION_SPEC.md', '# Documentation\n');
    const result = validateAppsDirectoryIndex(root);
    assert.equal(result.skipped, true);
    assert.deepEqual(result.issues, []);
  });

  it('accepts a compliant application repository', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-apps-index-'));
    write(root, 'agent.app.config.json', '{}\n');
    write(root, 'README.md', '# Demo\n\n- [apps index](apps/README.md)\n');
    write(root, 'apps/README.md', makeAppsReadme(['sdkwork-demo-pc']));
    write(root, 'apps/sdkwork-demo-pc/README.md', '# PC\n');
    const result = validateAppsDirectoryIndex(root);
    assert.equal(result.skipped, false);
    assert.deepEqual(result.issues, []);
  });

  it('fails when apps/README.md is missing', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-apps-index-'));
    write(root, 'agent.app.config.json', '{}\n');
    write(root, 'apps/.gitkeep', '');
    const result = validateAppsDirectoryIndex(root);
    assert.ok(result.issues.some((issue) => issue.includes('apps/README.md')));
  });

  it('fails when a child directory is not indexed', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-apps-index-'));
    write(root, 'agent.app.config.json', '{}\n');
    write(root, 'README.md', '# Demo\n\n- [apps index](apps/README.md)\n');
    write(root, 'apps/README.md', makeAppsReadme());
    write(root, 'apps/sdkwork-demo-pc/README.md', '# PC\n');
    const result = validateAppsDirectoryIndex(root);
    assert.ok(result.issues.some((issue) => issue.includes('sdkwork-demo-pc')));
  });

  it('validates multi-surface repositories without app manifests', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-apps-index-'));
    write(root, 'AGENTS.md', '# Repo\n');
    write(root, 'README.md', '# IAM\n\n- [apps index](apps/README.md)\n');
    write(root, 'apps/README.md', makeAppsReadme(['sdkwork-iam-pc', 'sdkwork-iam-common']));
    write(root, 'apps/sdkwork-iam-pc/README.md', '# IAM PC\n');
    write(root, 'apps/sdkwork-iam-common/README.md', '# IAM Common\n');
    const result = validateAppsDirectoryIndex(root);
    assert.equal(result.skipped, false);
    assert.deepEqual(result.issues, []);
  });
});
