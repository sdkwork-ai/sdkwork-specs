#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const workspace = path.resolve(process.argv[2] ?? 'E:/sdkwork-space');
const names = fs.readdirSync(workspace).filter((n) => n.startsWith('sdkwork-')).sort();

for (const name of names) {
  const root = path.join(workspace, name);
  if (!fs.existsSync(path.join(root, 'deployments'))) continue;
  const hasTopo = fs.existsSync(path.join(root, 'specs/topology.spec.json'));
  const commonPath = path.join(root, 'deployments/webserver/server.common.toml');
  let line = `${name}: topo=${hasTopo ? 'yes' : 'NO'}`;
  if (fs.existsSync(commonPath)) {
    const t = fs.readFileSync(commonPath, 'utf8');
    const enabled = t.match(/^enabled = (true|false)/m)?.[1] ?? '?';
    const desc = t.match(/^description = "(.*)"/m)?.[1] ?? '';
    line += ` webserver=${enabled} ${desc.slice(0, 50)}`;
  } else {
    line += ' webserver=MISSING';
  }
  console.log(line);
}
