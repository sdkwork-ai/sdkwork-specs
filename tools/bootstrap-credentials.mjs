#!/usr/bin/env node

/**
 * Workspace entrypoint: mint the dual-token pairs a registration run needs.
 *
 * The implementation lives in `tools/app-registration/bootstrap-credentials.mjs`;
 * this file keeps the canonical `sdkwork-specs/tools/<tool>.mjs` invocation that
 * the workspace's other tools use.
 *
 * @example
 *   node sdkwork-specs/tools/bootstrap-credentials.mjs \
 *     --iam-base-url http://127.0.0.1:3901 \
 *     --deploy-base-url http://127.0.0.1:3900 \
 *     --username operator --password "$SDKWORK_IAM_OPERATOR_PASSWORD" \
 *     --out .run/registration.env
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runMain } from './app-registration/bootstrap-credentials.mjs';

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runMain(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
