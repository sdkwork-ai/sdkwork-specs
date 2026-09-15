#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WORKSPACE_ROOT } from './lib/workspace-root.mjs';

const root = path.resolve(DEFAULT_WORKSPACE_ROOT, 'sdkwork-space');
const src = fs.readFileSync(
  path.join(root, 'crates/sdkwork-aiot-storage-sqlx/src/lib.rs'),
  'utf8',
);
const match = src.match(/pub fn initial_migration_sql\(\)[\s\S]*?r#"([\s\S]*?)"#\s*\}/);
if (!match) {
  throw new Error('initial_migration_sql block not found');
}
const outDir = path.join(root, 'database/ddl/baseline/postgres');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, '0001_aiot_baseline.sql');
fs.writeFileSync(outPath, `${match[1].trimStart()}\n`);
const count = (match[1].match(/CREATE TABLE/gi) ?? []).length;
process.stdout.write(`wrote ${outPath} (${count} tables)\n`);
