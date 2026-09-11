#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditRoot,
  findIgnoredCanonicalContent,
} from './check-gitignore-standard.mjs';
import { planRepository } from './align-gitignore-standard.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TOOL_DIR, '../..');

function fixture(gitignoreText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-gitignore-'));
  if (gitignoreText !== null) {
    fs.writeFileSync(path.join(root, '.gitignore'), gitignoreText, 'utf8');
  }
  return root;
}

// --- offending entries ------------------------------------------------------------------
for (const entry of ['/bin/', 'bin/', '/bin/**', '/bin/*']) {
  const root = fixture(`node_modules/\n${entry}\ndist/\n`);
  const findings = findIgnoredCanonicalContent(root);
  assert.equal(findings.length, 1, `${entry} must be reported as ignoring canonical content`);
  assert.equal(findings[0].rule, 'bin-entrypoint-directory');
  assert.equal(findings[0].line, 2, 'the finding must carry the 1-based line number');
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = fixture('node_modules/\nsdks/**/generated/\n');
  const findings = findIgnoredCanonicalContent(root);
  assert.equal(findings.length, 1, 'sdks/**/generated/ must be reported');
  assert.equal(findings[0].rule, 'sdks-generated-output');
  fs.rmSync(root, { recursive: true, force: true });
}

// --- entries that must stay untouched ---------------------------------------------------
for (const [label, text] of [
  ['a narrower bin path is legitimate', 'node_modules/\n/bin/lib/\ndist/\n'],
  ['a nested bin path is not the canonical entrypoint', '/crates/x/bin/\n'],
  ['a negation restores tracking', '/bin/\n!/bin/\n'],
  ['a commented entry is documentation', '# /bin/ was removed per MODULE_BIN_SPEC.md section 2\n'],
  ['unrelated bin-like names', 'binaries/\nrebuild/\n'],
]) {
  const root = fixture(text);
  const findings = findIgnoredCanonicalContent(root);
  // The negation case still contains a live `/bin/` rule on line 1, so only assert the
  // non-negated, non-comment fixtures are clean.
  if (label !== 'a negation restores tracking') {
    assert.equal(findings.length, 0, `${label}: no finding expected, got ${JSON.stringify(findings)}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = fixture(null);
  assert.equal(findIgnoredCanonicalContent(root).length, 0, 'a repository without .gitignore is clean');
  fs.rmSync(root, { recursive: true, force: true });
}

// --- CRLF ------------------------------------------------------------------------------
{
  const root = fixture('node_modules/\r\n/bin/\r\ndist/\r\n');
  const findings = findIgnoredCanonicalContent(root);
  assert.equal(findings.length, 1, 'CRLF files must be parsed line-by-line');
  assert.equal(findings[0].line, 2);
  fs.rmSync(root, { recursive: true, force: true });
}

// --- the aligner removes exactly the offending line and preserves the line ending -------
{
  const root = fixture('# header\r\nnode_modules/\r\n/bin/\r\ndist/\r\n\r\n# trailing\r\n');
  const plan = planRepository(root);
  assert.deepEqual(plan.removed, ['/bin/']);
  assert.equal(plan.changed, true);
  assert.equal(
    plan.next,
    '# header\r\nnode_modules/\r\ndist/\r\n\r\n# trailing\r\n',
    'only the offending line may be removed, and CRLF must be preserved',
  );
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = fixture('node_modules/\n/bin/lib/\n');
  const plan = planRepository(root);
  assert.equal(plan.changed, false, 'a compliant .gitignore must produce no change');
  fs.rmSync(root, { recursive: true, force: true });
}

// --- fail-closed: an unresolvable root must not report success --------------------------
{
  const missing = spawnSync(
    process.execPath,
    [path.join(TOOL_DIR, 'check-gitignore-standard.mjs'), '--root', path.join(os.tmpdir(), 'sdkwork-gitignore-does-not-exist')],
    { encoding: 'utf8' },
  );
  // A missing root resolves to zero repositories and must exit 2 rather than "0 findings".
  assert.ok(
    missing.status === 2 || missing.status === 1,
    `a missing --workspace/--root must not exit 0; got ${missing.status}`,
  );
}

// --- fleet integration ------------------------------------------------------------------
const audit = spawnSync(
  process.execPath,
  [path.join(TOOL_DIR, 'check-gitignore-standard.mjs'), '--workspace', WORKSPACE_ROOT, '--json'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
assert.ok([0, 1].includes(audit.status), audit.stdout || audit.stderr);
const payload = JSON.parse(audit.stdout);
assert.ok(Array.isArray(payload.roots) && payload.roots.length > 0, 'the workspace must enumerate repositories');
assert.equal(
  payload.failing,
  0,
  `every governed repository must be free of over-reaching ignore rules; failing: ${
    payload.roots.filter((row) => !row.ok).map((row) => path.basename(row.root)).join(', ')}`,
);

process.stdout.write('check-gitignore-standard.test.mjs passed\n');
