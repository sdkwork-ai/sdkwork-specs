import assert from 'node:assert/strict';
import test from 'node:test';

import { renderLayoutReadmeSection, upsertLayoutSection } from './application-deploy-layout/render.mjs';
import { LAYOUT_MARKER_START, LAYOUT_MARKER_END } from './application-deploy-layout/constants.mjs';

const SECTION = renderLayoutReadmeSection({ runtimeCode: 'rust-axum', appId: 'sdkwork-notes' });

/**
 * The workspace aligner is run repeatedly and promises that a repo already in
 * the canonical shape reports no change. Regression: the previous
 * implementation re-appended the suffix after the end marker verbatim while
 * `section` already carried the newline that terminated the marker line, so
 * each run added one more newline — a file that grew without bound and a
 * spurious diff in every repository on every invocation.
 */
test('upsertLayoutSection is idempotent from a real repository README', () => {
  const seeded = `# sdkwork-notes Source Configuration\n\n${SECTION}\n\n\n`;
  const once = upsertLayoutSection(seeded, SECTION, 'sdkwork-notes Source Configuration');
  const twice = upsertLayoutSection(once, SECTION, 'sdkwork-notes Source Configuration');
  const thrice = upsertLayoutSection(twice, SECTION, 'sdkwork-notes Source Configuration');

  assert.equal(twice, once, 'second application must be a no-op');
  assert.equal(thrice, once, 'third application must be a no-op');
});

test('upsertLayoutSection is idempotent when no README exists yet', () => {
  const once = upsertLayoutSection('', SECTION, 'sdkwork-notes Source Configuration');
  const twice = upsertLayoutSection(once, SECTION, 'sdkwork-notes Source Configuration');

  assert.equal(twice, once);
  assert.ok(once.startsWith('# sdkwork-notes Source Configuration\n\n'));
});

test('upsertLayoutSection is idempotent for a README without markers', () => {
  const plain = '# sdkwork-notes Source Configuration\n\nJust prose.\n';
  const once = upsertLayoutSection(plain, SECTION, 'sdkwork-notes Source Configuration');
  const twice = upsertLayoutSection(once, SECTION, 'sdkwork-notes Source Configuration');

  assert.equal(twice, once);
  assert.ok(once.includes(LAYOUT_MARKER_START));
});

test('upsertLayoutSection preserves content that follows the section', () => {
  const seeded = `# sdkwork-notes Source Configuration\n\n${SECTION}\n\n## Extra\n\nSome prose.\n`;
  const next = upsertLayoutSection(seeded, SECTION, 'sdkwork-notes Source Configuration');

  assert.ok(next.includes('## Extra'), 'trailing section must survive');
  assert.ok(next.includes('Some prose.'));
  assert.equal(
    upsertLayoutSection(next, SECTION, 'sdkwork-notes Source Configuration'),
    next,
    'must converge with trailing content present',
  );
});

test('the rendered shape still satisfies the layout checker contract', () => {
  const next = upsertLayoutSection('', SECTION, 'sdkwork-notes Source Configuration');

  // tools/application-deploy-layout/inspect.mjs requires the start marker and
  // the string "config.toml" inside etc/README.md.
  assert.ok(next.includes(LAYOUT_MARKER_START));
  assert.ok(next.includes(LAYOUT_MARKER_END));
  assert.ok(next.includes('config.toml'));
  assert.ok(next.endsWith('\n'));
  assert.ok(!next.endsWith('\n\n'), 'must not leave trailing blank lines');
});
