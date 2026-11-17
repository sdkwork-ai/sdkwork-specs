#!/usr/bin/env node

/**
 * Workspace entrypoint: register every application into Deploy and IAM.
 *
 * The implementation lives in `tools/app-registration/`; this file keeps the
 * canonical `sdkwork-specs/tools/<tool>.mjs` invocation that the workspace's
 * other tools use.
 *
 * @example
 *   node sdkwork-specs/tools/register-applications.mjs --inventory inventory.json
 *   node sdkwork-specs/tools/register-applications.mjs --environment development --dry-run
 *   node sdkwork-specs/tools/register-applications.mjs --environment production --report report.json
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runMain } from './app-registration/register-applications.mjs';

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    });
}
