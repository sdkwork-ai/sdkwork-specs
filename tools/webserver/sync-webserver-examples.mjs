#!/usr/bin/env node
// Copy aligned module webserver layout v3 files into sdkwork-specs/examples/webserver/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sidecarFileName, DEPLOYMENT_PROFILES, LIFECYCLE_ENVIRONMENTS } from './layout-v3.mjs';
import { validateWebserverDir } from './validate.mjs';

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const specsRoot = path.resolve(toolsRoot, '../..');
const workspace = path.resolve(process.argv[2] ?? path.join(specsRoot, '..'));

const EXAMPLE_SOURCES = {
  'sdkwork-im': 'modules/sdkwork-im',
  'sdkwork-cloudrouter': 'modules/sdkwork-cloudrouter',
  'sdkwork-birdcoder': 'modules/sdkwork-birdcoder',
};

const LAYOUT_FILES = [
  'server.common.toml',
  'server.development.toml',
  'server.test.toml',
  'server.staging.toml',
  'server.production.toml',
  'server.standalone.toml',
  'server.cloud.toml',
  'app-roots.example.toml',
];

const examplesRoot = path.join(specsRoot, 'examples', 'webserver');
const ROOT_SHOWCASE = 'sdkwork-im';

function sidecarNames() {
  return DEPLOYMENT_PROFILES.flatMap((profile) =>
    LIFECYCLE_ENVIRONMENTS.map((environment) => sidecarFileName('nginx.conf', profile, environment)),
  );
}

function copyLayoutFiles(srcDir, destDir) {
  let count = 0;
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of LAYOUT_FILES) {
    const src = path.join(srcDir, name);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(destDir, name));
    count += 1;
  }
  for (const name of sidecarNames()) {
    const src = path.join(srcDir, name);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(destDir, name));
    count += 1;
  }
  const snippetsSrc = path.join(srcDir, 'snippets');
  if (fs.existsSync(snippetsSrc)) {
    const snippetsDest = path.join(destDir, 'snippets');
    fs.mkdirSync(snippetsDest, { recursive: true });
    for (const entry of fs.readdirSync(snippetsSrc)) {
      fs.copyFileSync(path.join(snippetsSrc, entry), path.join(snippetsDest, entry));
      count += 1;
    }
  }
  return count;
}

let copied = 0;
for (const [moduleName, exampleRel] of Object.entries(EXAMPLE_SOURCES)) {
  const srcDir = path.join(workspace, moduleName, 'deployments', 'webserver');
  const destDir = path.join(examplesRoot, exampleRel, 'deployments', 'webserver');
  if (!fs.existsSync(srcDir)) {
    console.error(`missing source: ${srcDir}`);
    process.exitCode = 1;
    continue;
  }
  copied += copyLayoutFiles(srcDir, destDir);
}

// Root showcase: full layout v3 under deployments/webserver/ plus flat mirrors.
const showcaseSrc = path.join(workspace, ROOT_SHOWCASE, 'deployments', 'webserver');
const showcaseDest = path.join(examplesRoot, 'deployments', 'webserver');
if (fs.existsSync(showcaseSrc)) {
  copied += copyLayoutFiles(showcaseSrc, showcaseDest);
  const commonPath = path.join(showcaseDest, 'server.common.toml');
  if (fs.existsSync(commonPath)) {
    const header = `# Example server.common.toml per SDKWORK_WEBSERVER_SPEC.md (layout v3).\n# Authoritative tree: examples/webserver/deployments/webserver/\n\n`;
    fs.writeFileSync(commonPath, header + fs.readFileSync(path.join(showcaseSrc, 'server.common.toml'), 'utf8'));
  }
  for (const name of LAYOUT_FILES) {
    const src = path.join(showcaseDest, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(examplesRoot, name));
      copied += 1;
    }
  }
}

const VALIDATE_ROOTS = [
  'examples/webserver',
  ...Object.values(EXAMPLE_SOURCES).map((rel) => `examples/webserver/${rel}`),
];

let errors = 0;
for (const rel of VALIDATE_ROOTS) {
  const moduleRoot = path.join(specsRoot, rel);
  const result = validateWebserverDir(moduleRoot);
  if (!result.ok) {
    errors += result.errors.length;
    console.error(`${rel}: validation failed`);
    for (const message of result.errors.slice(0, 5)) console.error(`  ${message}`);
  }
}

console.log(`sync-webserver-examples: ${copied} file(s) copied, ${errors} validation error(s)`);
process.exit(errors > 0 ? 1 : 0);
