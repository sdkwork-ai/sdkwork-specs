// Layout v2 scaffold per SDKWORK_WEBSERVER_SPEC.md section 2.
// Delegates to build-from-topology.mjs; use align-webserver-workspace.mjs for routine alignment.
import fs from 'node:fs';
import path from 'node:path';

import { buildWebserverDocs, writeWebserverLayout } from './build-from-topology.mjs';

const WORKSPACE = process.argv[2] ?? 'E:/sdkwork-space';
const SKIP = new Set(['sdkwork-webserver']);

let aligned = 0;
const report = [];

for (const name of fs.readdirSync(WORKSPACE)) {
  if (!name.startsWith('sdkwork-') || SKIP.has(name)) continue;
  if (!fs.existsSync(path.join(WORKSPACE, name, 'deployments'))) continue;
  const moduleRoot = path.join(WORKSPACE, name);
  let topology = null;
  try {
    topology = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'specs', 'topology.spec.json'), 'utf8'));
  } catch {
    topology = null;
  }
  const docs = buildWebserverDocs({ appId: name, topology, moduleRoot });
  writeWebserverLayout(moduleRoot, docs);
  report.push(`${docs.enabled ? 'aligned' : 'disabled'} ${name}`);
  aligned += 1;
}

console.log(report.sort().join('\n'));
console.log(`scaffold-workspace: ${aligned} module(s) materialized`);
