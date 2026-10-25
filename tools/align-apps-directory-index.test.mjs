import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { alignAppsDirectoryIndex, renderAppsReadme } from './lib/apps-directory-index.mjs';
import { validateAppsDirectoryIndex } from './check-apps-directory-index.mjs';

function write(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text);
}

describe('align-apps-directory-index', () => {
  it('creates compliant apps/README.md for multi-surface repositories', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-align-apps-'));
    write(root, 'AGENTS.md', '# Repo\n');
    write(root, 'agent.app.config.json', JSON.stringify({ app: { key: 'demo', displayName: 'Demo' } }, null, 2));
    write(root, 'README.md', '# Demo\n');
    write(root, 'apps/sdkwork-demo-pc/README.md', '# Demo PC\n');
    write(root, 'apps/sdkwork-demo-pc/agent.app.config.json', JSON.stringify({ app: { displayName: 'Demo PC' } }));
    write(root, 'apps/sdkwork-demo-common/README.md', '# Demo Common\n');

    const result = alignAppsDirectoryIndex(root);
    assert.equal(result.skipped, false);
    assert.ok(result.changed.includes('apps/README.md'));

    const validation = validateAppsDirectoryIndex(root);
    assert.deepEqual(validation.issues, []);
    const text = renderAppsReadme(root, result.identity);
    assert.match(text, /Directory Index/u);
    assert.match(text, /sdkwork-demo-pc/u);
    assert.match(text, /sdkwork-demo-common/u);
  });

  it('creates apps/ for root-primary repositories without apps/', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-align-apps-'));
    write(root, 'AGENTS.md', '# Repo\n');
    write(root, 'agent.app.config.json', '{}');
    write(root, 'README.md', '# Root Primary\n');

    alignAppsDirectoryIndex(root);
    const validation = validateAppsDirectoryIndex(root);
    assert.deepEqual(validation.issues, []);
  });
});
