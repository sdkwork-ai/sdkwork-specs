#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEPLOY_APPLICATION_ID_ENV } from '../contract.mjs';
import {
  DEPLOY_APPLICATION_UUID_ENV,
  readEnvFileValue,
  readRecordedAnchor,
  writeAnchorEnv,
} from '../env-anchor.mjs';

function withTempFile(initialContent, run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-anchor-'));
  const filePath = path.join(directory, 'standalone.development.env');
  if (initialContent !== null) {
    writeFileSync(filePath, initialContent, 'utf8');
  }
  try {
    return run({ directory, filePath });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('the anchor is appended once with a provenance header', () => {
  withTempFile('SDKWORK_ENVIRONMENT=development\n', ({ filePath }) => {
    const outcomes = writeAnchorEnv({
      sinkPaths: [filePath],
      anchor: '900123',
      uuid: 'uuid-1',
    });
    assert.deepEqual(outcomes.map((entry) => entry.outcome), ['updated']);
    const content = readFileSync(filePath, 'utf8');
    assert.match(content, /^SDKWORK_ENVIRONMENT=development$/mu);
    assert.match(content, /^# .*register-applications\.mjs\)$/mu);
    assert.match(content, new RegExp(`^${DEPLOY_APPLICATION_ID_ENV}=900123$`, 'mu'));
    assert.match(content, new RegExp(`^${DEPLOY_APPLICATION_UUID_ENV}=uuid-1$`, 'mu'));
    assert.ok(content.endsWith('\n'));
  });
});

test('writing the same anchor twice leaves the file byte-identical', () => {
  withTempFile('SDKWORK_ENVIRONMENT=development\n', ({ filePath }) => {
    writeAnchorEnv({ sinkPaths: [filePath], anchor: '900123', uuid: 'uuid-1' });
    const first = readFileSync(filePath, 'utf8');
    const second = writeAnchorEnv({ sinkPaths: [filePath], anchor: '900123', uuid: 'uuid-1' });
    assert.deepEqual(second.map((entry) => entry.outcome), ['unchanged']);
    assert.equal(readFileSync(filePath, 'utf8'), first);
  });
});

test('a changed anchor replaces the line in place without duplicating it', () => {
  withTempFile(
    `SDKWORK_ENVIRONMENT=development\n${DEPLOY_APPLICATION_ID_ENV}=111\nSDKWORK_OTHER=1\n`,
    ({ filePath }) => {
      writeAnchorEnv({ sinkPaths: [filePath], anchor: '222' });
      const content = readFileSync(filePath, 'utf8');
      const occurrences = content
        .split('\n')
        .filter((line) => line.startsWith(`${DEPLOY_APPLICATION_ID_ENV}=`));
      assert.deepEqual(occurrences, [`${DEPLOY_APPLICATION_ID_ENV}=222`]);
      assert.match(content, /^SDKWORK_OTHER=1$/mu);
      assert.equal(content.indexOf(DEPLOY_APPLICATION_ID_ENV), content.lastIndexOf(
        DEPLOY_APPLICATION_ID_ENV,
      ));
    },
  );
});

test('an absent sink is skipped unless the caller allows creating it', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-anchor-'));
  try {
    const missing = path.join(directory, 'nested', 'missing.env');
    const skipped = writeAnchorEnv({ sinkPaths: [missing], anchor: '1' });
    assert.deepEqual(skipped.map((entry) => entry.outcome), ['skipped-missing']);
    assert.equal(existsSync(missing), false);
    const created = writeAnchorEnv({ sinkPaths: [missing], anchor: '1', createMissing: true });
    assert.deepEqual(created.map((entry) => entry.outcome), ['created']);
    assert.equal(readEnvFileValue(missing, DEPLOY_APPLICATION_ID_ENV), '1');
    assert.deepEqual(
      readdirSync(path.dirname(missing)).filter((name) => name.includes('.tmp-')),
      [],
      'the atomic write must not leave a temporary file behind',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('recorded anchors are read across sinks and conflicts are surfaced', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-anchor-'));
  try {
    const standalone = path.join(directory, 'standalone.development.env');
    const cloud = path.join(directory, 'cloud.development.env');
    writeFileSync(standalone, `${DEPLOY_APPLICATION_ID_ENV}=123\n`, 'utf8');
    writeFileSync(cloud, `${DEPLOY_APPLICATION_ID_ENV}="123"\n`, 'utf8');
    const agreeing = readRecordedAnchor([standalone, cloud]);
    assert.equal(agreeing.value, '123');
    assert.deepEqual(agreeing.conflict, []);

    writeFileSync(cloud, `${DEPLOY_APPLICATION_ID_ENV}=456\n`, 'utf8');
    const conflicting = readRecordedAnchor([standalone, cloud]);
    assert.equal(conflicting.conflict.length, 2);
    assert.deepEqual(
      conflicting.conflict.map((entry) => entry.value).sort(),
      ['123', '456'],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the reader tolerates export prefixes, quotes, and BOMs', () => {
  withTempFile(
    `\uFEFFexport ${DEPLOY_APPLICATION_ID_ENV}='900123'\n`,
    ({ filePath }) => {
      assert.equal(readEnvFileValue(filePath, DEPLOY_APPLICATION_ID_ENV), '900123');
    },
  );
});
