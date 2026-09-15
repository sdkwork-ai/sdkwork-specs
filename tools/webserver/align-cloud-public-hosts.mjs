#!/usr/bin/env node
// Align specs/topology.spec.json cloudPublicHosts to APP_RUNTIME_TOPOLOGY_NAMING.md §9.
import fs from 'node:fs';
import path from 'node:path';

import { alignCloudPublicHosts } from './host-registry.mjs';
import { productionHostsForSurface } from './build-from-topology.mjs';
import { DEFAULT_WORKSPACE_ROOT } from '../lib/workspace-root.mjs';

const workspace = path.resolve(process.argv[2] ?? DEFAULT_WORKSPACE_ROOT);
const write = process.argv.includes('--write');

let scanned = 0;
let changed = 0;

for (const name of fs.readdirSync(workspace)) {
  if (!name.startsWith('sdkwork-')) continue;
  const moduleRoot = path.join(workspace, name);
  const topologyPath = path.join(moduleRoot, 'specs', 'topology.spec.json');
  if (!fs.existsSync(topologyPath)) continue;
  scanned += 1;
  const before = fs.readFileSync(topologyPath, 'utf8');
  const spec = JSON.parse(before);
  alignCloudPublicHosts(spec);
  const after = `${JSON.stringify(spec, null, 2)}\n`;
  if (after !== before) {
    changed += 1;
    if (write) fs.writeFileSync(topologyPath, after);
    else console.log(`would-update ${name}`);
  }
}

console.log(`align-cloud-public-hosts: ${scanned} topology file(s), ${changed} ${write ? 'updated' : 'pending (--write to apply)'}`);
