#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  APP_ASSETS_STANDARD,
  findAppManifests,
  hasAssetsStandard,
  validateAppAssetsFile,
} from './app-assets-lib.mjs';

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: '.' },
      config: { type: 'string', default: 'agent.app.config.json' },
      workspace: { type: 'string' },
      json: { type: 'boolean', default: false },
      'require-standard': { type: 'boolean', default: false },
      now: { type: 'string' },
    },
  });
  const root = path.resolve(values.workspace ?? values.root);
  const files = values.workspace
    ? findAppManifests(root)
    : [path.resolve(root, values.config)];
  if (files.length === 0) throw new Error(`no agent.app.config.json files found under ${root}`);
  for (const file of files) if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const now = values.now ? new Date(values.now) : new Date();
  if (Number.isNaN(now.valueOf())) throw new Error(`--now is not a valid date: ${values.now}`);

  const issues = [];
  let adopted = 0;
  let legacy = 0;
  for (const file of files) {
    const label = path.relative(root, file).replaceAll('\\', '/');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
    } catch (error) {
      issues.push(`${label}: invalid JSON (${error.message})`);
      continue;
    }
    if (hasAssetsStandard(manifest)) adopted += 1;
    else legacy += 1;
    issues.push(...validateAppAssetsFile(file, {
      label,
      requireStandard: values['require-standard'],
      now,
    }));
  }
  const unique = [...new Set(issues)];
  if (values.json) {
    console.log(JSON.stringify({
      valid: unique.length === 0,
      standard: APP_ASSETS_STANDARD,
      manifests: files.length,
      adopted,
      legacy,
      issues: unique,
    }, null, 2));
  }
  if (unique.length > 0) {
    if (!values.json) for (const issue of unique) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }
  if (!values.json) {
    console.log(`app assets standard ok: ${files.length} manifest(s), ${adopted} adopted, ${legacy} legacy`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`app assets check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
