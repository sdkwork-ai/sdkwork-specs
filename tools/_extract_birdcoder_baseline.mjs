#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WORKSPACE_ROOT } from './lib/workspace-root.mjs';

const root = path.resolve(DEFAULT_WORKSPACE_ROOT, 'sdkwork-space');
const files = [
  'crates/sdkwork-birdcoder-coding-sessions-repository-sqlx/src/db/schema.rs',
  'crates/sdkwork-birdcoder-workspace-repository-sqlx/src/db/schema.rs',
  'crates/sdkwork-birdcoder-skill-packages-repository-sqlx/src/db/schema.rs',
  'crates/sdkwork-birdcoder-model-config-repository-sqlx/src/db/schema.rs',
  'crates/sdkwork-birdcoder-membership-repository-sqlx/src/db/schema.rs',
];

function extractBlocks(text) {
  const blocks = [];
  const re = /r#"([\s\S]*?)"#;/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

let sql = '-- birdcoder legacy baseline from repository schema.rs files\n\n';
for (const relativePath of files) {
  const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const block of extractBlocks(text)) {
    sql += `${block.trim()}\n\n`;
  }
}

const outPath = path.join(
  root,
  'database/ddl/baseline/sqlite/0001_birdcoder_baseline.sql',
);
fs.writeFileSync(outPath, sql);
const count = (sql.match(/CREATE TABLE/gi) ?? []).length;
process.stdout.write(`wrote ${outPath} (${count} tables)\n`);
