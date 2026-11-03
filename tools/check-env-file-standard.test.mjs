import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkEnvFileStandard } from './check-env-file-standard.mjs';

test('reports invalid keys, duplicate keys, and unresolved interpolation', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-env-file-'));
  try {
    mkdirSync(path.join(root, 'apps', 'demo'), { recursive: true });
    writeFileSync(
      path.join(root, 'apps', 'demo', '.env.development'),
      'GOOD_KEY=1\nbad_key=2\nGOOD_KEY=3\nBROKEN=${MISSING}\n',
      'utf8',
    );
    const result = checkEnvFileStandard(root);
    const kinds = result.issues.map((issue) => issue.kind).sort();
    assert.deepEqual(kinds, ['duplicate-key', 'invalid-key', 'unresolved-interpolation']);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
