#!/usr/bin/env node

/**
 * Workspace entrypoint: register every application of the current module.
 *
 * The implementation lives in `tools/app-registration/module-registration.mjs`;
 * this file keeps the canonical `sdkwork-specs/tools/<tool>.mjs` invocation.
 *
 * @example
 *   node ../sdkwork-specs/tools/register-module.mjs --environment production \
 *     --auth operator --api-domain api.example.com --domain-suffix example.com \
 *     --username operator --password "$SDKWORK_IAM_OPERATOR_PASSWORD"
 *
 * @example
 *   node ../sdkwork-specs/tools/register-module.mjs --environment production \
 *     --auth user --username alice --password "$SDKWORK_USER_PASSWORD" \
 *     --access-token "$SDKWORK_ACCESS_TOKEN" \
 *     --operator-username operator --operator-password "$SDKWORK_IAM_OPERATOR_PASSWORD" \
 *     --api-domain api.example.com
 *
 * @example
 *   node ../sdkwork-specs/tools/register-module.mjs --audit
 *
 * @example
 *   node ../sdkwork-specs/tools/register-module.mjs --dry-run --auth operator
 *     --ownership organization --organization-id 100002
 *     --oem-config oem.json --api-domain api.example.com
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runMain } from './app-registration/module-registration.mjs';

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runMain(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
