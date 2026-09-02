#!/usr/bin/env node
// Inventories which embedded cloud-gateway dependencies already expose a
// `WebModule` factory, so the gateway can install dependency-owned modules
// instead of raw `ApiAssemblyContribution` values.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE = 'E:/sdkwork-space';

function findRepo(code) {
  const direct = path.join(WORKSPACE, code);
  return existsSync(direct) ? direct : null;
}

function grepPublicFn(repo, name) {
  const crates = path.join(repo, 'crates');
  if (!existsSync(crates)) return null;
  for (const entry of readdirSync(crates, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(crates, entry.name, 'src');
    if (!existsSync(src)) continue;
    const stack = [src];
    while (stack.length) {
      const dir = stack.pop();
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) stack.push(abs);
        else if (item.name.endsWith('.rs')) {
          const source = readFileSync(abs, 'utf8');
          const re = new RegExp(
            `pub\\s+async\\s+fn\\s+${name}\\s*(\\([^)]*\\))?\\s*->\\s*([^\\n{]+)`,
            'g',
          );
          const match = re.exec(source);
          if (match) {
            return {
              crate: entry.name,
              file: path.relative(path.join(crates, entry.name), abs),
              params: (match[1] || '()').trim(),
              returns: match[2].trim(),
            };
          }
        }
      }
    }
  }
  return null;
}

const codes = [
  'sdkwork-iam','sdkwork-order','sdkwork-membership','sdkwork-skills','sdkwork-prompts',
  'sdkwork-documents','sdkwork-course','sdkwork-image','sdkwork-community','sdkwork-dezhou',
  'sdkwork-doudizhu','sdkwork-mahjong','sdkwork-xiangqi','sdkwork-notary','sdkwork-news',
  'sdkwork-assets','sdkwork-drive','sdkwork-payment','sdkwork-im','sdkwork-deployments',
  'sdkwork-cloudrouter','sdkwork-inventory','sdkwork-invoice','sdkwork-portal','sdkwork-shop',
  'sdkwork-voice','sdkwork-appstore','sdkwork-webserver','sdkwork-rtc','sdkwork-mail',
  'sdkwork-mcp','sdkwork-browser','sdkwork-llm','sdkwork-agents','sdkwork-generations',
  'sdkwork-aiot','sdkwork-promotion','sdkwork-knowledgebase','sdkwork-customerservice',
  'sdkwork-manager','sdkwork-cms','sdkwork-forum','sdkwork-modelkit','sdkwork-account',
  'sdkwork-catalog','sdkwork-gameengine','sdkwork-local-router','sdkwork-appbase',
  'sdkwork-birdcoder','sdkwork-canvas','sdkwork-company','sdkwork-feeds','sdkwork-github',
  'sdkwork-log','sdkwork-messaging','sdkwork-notes','sdkwork-search','sdkwork-settings',
];

const missing = [];
const rows = [];
for (const code of codes) {
  const repo = findRepo(code);
  if (!repo) {
    rows.push(`${code.padEnd(28)} REPO-NOT-FOUND`);
    missing.push(code);
    continue;
  }
  const withPool = grepPublicFn(repo, 'web_module_with_pool');
  const plain = grepPublicFn(repo, 'web_module\\b');
  const withContext = grepPublicFn(repo, 'web_module_with_context');
  const withConfig = grepPublicFn(repo, 'web_module_with_config');
  if (withPool) {
    rows.push(`${code.padEnd(28)} pool   ${withPool.crate} ${withPool.params} -> ${withPool.returns}`);
  } else if (plain) {
    rows.push(`${code.padEnd(28)} plain  ${plain.crate} ${plain.params} -> ${plain.returns}`);
  } else if (withContext) {
    rows.push(`${code.padEnd(28)} ctx    ${withContext.crate} ${withContext.params} -> ${withContext.returns}`);
  } else if (withConfig) {
    rows.push(`${code.padEnd(28)} config ${withConfig.crate} ${withConfig.params} -> ${withConfig.returns}`);
  } else {
    rows.push(`${code.padEnd(28)} MISSING`);
    missing.push(code);
  }
}

console.log(rows.join('\n'));
console.log(`\nmissing: ${missing.length}`);
if (missing.length) console.log(`  ${missing.join(', ')}`);
