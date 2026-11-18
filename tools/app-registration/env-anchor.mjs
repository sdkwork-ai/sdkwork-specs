#!/usr/bin/env node

/**
 * Environment hand-off: write the deploy application anchor into an app's
 * environment configuration.
 *
 * The anchor reaches the token through the materializer, never by hand: the
 * client-env materializer resolves each surface's public token `app_id` from
 * `SDKWORK_DEPLOY_APPLICATION_ID` (`app-access-token.mjs`
 * `resolveApplicationAccessTokenAppId`). Writing the anchor into the profile's
 * authored env layer and re-running the materializer is therefore the only
 * supported production path — a hand-edited token would be overwritten by the
 * next materialization and would encode an identity nobody verified.
 *
 * Two kinds of sink exist in a repository:
 *
 * - `etc/topology/overrides/<deployment-profile>.<environment>.env` — the
 *   authored override layer of the topology generator. The generated
 *   `etc/topology/<deployment-profile>.<environment>.env` is rebuilt from it and
 *   `MUST NOT` be edited directly.
 * - `.env.<environment>` / `.env` — a repository that keeps a single authored
 *   env file per lifecycle.
 *
 * Two identities can be recorded in those sinks: the repository-level
 * `SDKWORK_DEPLOY_APPLICATION_ID` (one anchor for every surface of the
 * repository) and the surface-scoped `<that variable>_<SURFACE>` a per-surface
 * registration writes, so several surfaces of one repository hold independent
 * anchors in the same layer without overwriting each other.
 *
 * Writes are atomic (temporary file + rename) and idempotent (the same value
 * leaves the file untouched, so repeated runs produce no diff).
 *
 * @module app-registration/env-anchor
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEPLOY_APPLICATION_ID_ENV } from './contract.mjs';

/** Bookkeeping key: the deploy application uuid the anchor resolves to. */
export const DEPLOY_APPLICATION_UUID_ENV = 'SDKWORK_DEPLOY_APPLICATION_UUID';

const HEADER = '# deploy application identity (written by sdkwork-specs '
  + 'tools/app-registration/register-applications.mjs)';

/**
 * Read one `KEY=value` pair out of a dotenv-style file.
 * @param filePath - absolute env file path
 * @param key - variable name
 * @returns the value, or `''` when the file or key is absent
 */
export function readEnvFileValue(filePath, key) {
  if (!existsSync(filePath)) {
    return '';
  }
  const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
  return readEnvValue(text, key);
}

/**
 * Read one `KEY=value` pair out of dotenv text.
 * @param text - file contents
 * @param key - variable name
 * @returns the trimmed value, or `''`
 */
export function readEnvValue(text, key) {
  const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=(.*)$`, 'mu');
  const match = pattern.exec(String(text ?? ''));
  if (!match) {
    return '';
  }
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  return value.trim();
}

/**
 * Collect every anchor recorded in the environment's sinks.
 *
 * The key selects the identity being read: the repository-level
 * `SDKWORK_DEPLOY_APPLICATION_ID` for a one-anchor-per-repository registration,
 * or the surface-scoped `<base>_<SURFACE>` variable for a surface that registers
 * as its own deploy application.
 * @param sinkPaths - absolute env file paths for one application × environment
 * @param key - anchor variable to read (defaults to the repository-level anchor)
 * @returns recorded value, its source, and every conflicting value
 */
export function readRecordedAnchor(sinkPaths, key = DEPLOY_APPLICATION_ID_ENV) {
  const found = [];
  for (const filePath of sinkPaths) {
    const value = readEnvFileValue(filePath, key);
    if (value) {
      found.push({ path: filePath, key, value });
    }
  }
  const distinct = new Set(found.map((entry) => entry.value));
  return {
    value: found[0]?.value ?? '',
    path: found[0]?.path ?? '',
    all: found,
    conflict: distinct.size > 1 ? found : [],
  };
}

function upsertKey(text, key, value) {
  const lines = String(text ?? '').replace(/\r\n/gu, '\n').split('\n');
  // A trailing newline produces one empty final element; dropping trailing empty
  // lines here keeps two consecutive upserts on adjacent lines instead of
  // inserting a blank line between them.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=`, 'u');
  let replaced = false;
  const next = lines.map((line) => {
    if (!replaced && pattern.test(line)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    if (!next.some((line) => line.trim() === HEADER)) {
      if (next.length > 0 && next[next.length - 1].trim() !== '') {
        next.push('');
      }
      next.push(HEADER);
    }
    next.push(`${key}=${value}`);
  }
  let output = next.join('\n');
  if (!output.endsWith('\n')) {
    output += '\n';
  }
  return output;
}

/**
 * Block the current thread for a few milliseconds.
 *
 * `Atomics.wait` is the only synchronous sleep available to a module API, and a
 * rename retry has to stay synchronous so {@link writeAnchorEnv} keeps a
 * synchronous contract.
 * @param milliseconds - wait budget
 */
function sleepSync(milliseconds) {
  if (milliseconds <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Rename a temporary file over its target, tolerating a transient Windows lock.
 *
 * On Windows a virus scanner or indexer can hold a handle on the freshly written
 * temporary file for a few milliseconds, which surfaces as `EPERM`/`EBUSY` from
 * `rename`. Retrying keeps the write atomic instead of falling back to an
 * in-place rewrite that a reader could observe half-written.
 * @param from - temporary path
 * @param to - target path
 */
function renameWithRetry(from, to) {
  const backoff = [0, 10, 25, 50, 100];
  for (let attempt = 0; attempt < backoff.length; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const retryable = error?.code === 'EPERM' || error?.code === 'EBUSY' || error?.code === 'EACCES';
      if (!retryable || attempt === backoff.length - 1) {
        throw error;
      }
      sleepSync(backoff[attempt]);
    }
  }
}

function writeAtomically(filePath, content) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.tmp-${process.pid}`);
  try {
    writeFileSync(temporary, content, 'utf8');
    renameWithRetry(temporary, filePath);
  } catch (error) {
    if (existsSync(temporary)) {
      try {
        unlinkSync(temporary);
      } catch {
        // The rename already failed; a stranded temporary file must not mask it.
      }
    }
    throw error;
  }
}

/**
 * Write the anchor (and optionally the addressable uuid) into every sink.
 *
 * A sink that already carries the same value is reported as `unchanged` and is
 * not rewritten, so a repeated registration produces no diff and keeps file
 * modes. `key`/`uuidKey` select which identity is written: the repository-level
 * anchor by default, or a surface-scoped anchor when one surface registers as its
 * own deploy application (so two surfaces of one repository never overwrite each
 * other's record).
 * @param input - sinks, anchor, optional uuid, and the identity keys
 * @returns per-sink outcome
 */
export function writeAnchorEnv(input) {
  const anchor = String(input.anchor ?? '').trim();
  if (!anchor) {
    throw new Error('cannot write an empty deploy application anchor');
  }
  const key = String(input.key ?? DEPLOY_APPLICATION_ID_ENV).trim() || DEPLOY_APPLICATION_ID_ENV;
  const uuidKey = String(input.uuidKey ?? DEPLOY_APPLICATION_UUID_ENV).trim()
    || DEPLOY_APPLICATION_UUID_ENV;
  const uuid = String(input.uuid ?? '').trim();
  const recordUuid = input.recordUuid !== false && uuid.length > 0;
  const results = [];
  for (const filePath of input.sinkPaths ?? []) {
    const absolutePath = path.resolve(filePath);
    if (!existsSync(absolutePath) && input.createMissing !== true) {
      results.push({ path: absolutePath, outcome: 'skipped-missing' });
      continue;
    }
    const before = existsSync(absolutePath)
      ? readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/u, '')
      : '';
    let after = upsertKey(before, key, anchor);
    if (recordUuid) {
      after = upsertKey(after, uuidKey, uuid);
    }
    if (before === after) {
      results.push({ path: absolutePath, outcome: 'unchanged' });
      continue;
    }
    writeAtomically(absolutePath, after);
    results.push({ path: absolutePath, outcome: before ? 'updated' : 'created' });
  }
  return results;
}
