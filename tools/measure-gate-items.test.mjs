import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const MEASURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'measure-gate-items.mjs');

function makeFixtureTool(name, body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-measure-gate-items-'));
  const toolPath = path.join(dir, name);
  writeFileSync(toolPath, body);
  return toolPath;
}

function runMeasure(args) {
  return spawnSync(process.execPath, [MEASURE, ...args], { encoding: 'utf8' });
}

describe('measure-gate-items', () => {
  it('uses the matrix counter, so a numbered tally is reported', () => {
    const tool = makeFixtureTool('tally.mjs', 'console.log("violations : 3");\n');

    const result = runMeasure([tool]);

    assert.equal(result.status, 0, result.stderr);
    // 3 comes from countItems' label:value path, not from a local re-implementation.
    assert.match(result.stdout, /countItems: 3/u);
  });

  it('reports bullet evidence lines as items too', () => {
    const tool = makeFixtureTool('bullets.mjs', 'console.log("- one\\n- two\\n- three");\n');

    const result = runMeasure([tool]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /countItems: 3/u);
  });

  it('refuses to report a baseline for a crashed gate', () => {
    // A crashed gate reports zero items. Recording that as a baseline would
    // hide the real debt behind a stack trace, so the tool must fail instead.
    const tool = makeFixtureTool('crash.mjs', [
      'console.error("node:internal/fs");',
      'console.error("    at Object.readFileSync (node:fs:440:20)");',
      'console.error("errno: -4058,");',
      'console.error("syscall: \'open\'");',
      'console.error("Node.js v22.22.2");',
      '',
    ].join('\n'));

    const result = runMeasure([tool]);

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /gate crashed/u);
  });

  it('fails closed when the tool does not exist', () => {
    const result = runMeasure([path.join(os.tmpdir(), 'sdkwork-absent-gate-tool.mjs')]);

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /no such tool/u);
  });

  it('prints usage when invoked without a tool', () => {
    const result = runMeasure([]);

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /Usage: node tools\/measure-gate-items\.mjs/u);
  });
});
