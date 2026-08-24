// Adaptive Web nginx snippets — PC/H5 named locations and dispatch (SDKWORK_DEPLOY_SPEC.md §8).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADAPTIVE_SNIPPET_PATHS = {
  maps: 'snippets/adaptive-web.maps.conf',
  dispatch: 'snippets/adaptive-web.dispatch.conf',
  namedLocations: 'snippets/adaptive-web.named-locations.conf',
};

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const specsRoot = path.resolve(toolsRoot, '../..');
const referenceDir = path.join(specsRoot, 'examples', 'webserver', 'adaptive-snippets');

function readReference(name) {
  const referencePath = path.join(referenceDir, name);
  if (!fs.existsSync(referencePath)) {
    throw new Error(`missing adaptive snippet reference: ${referencePath}`);
  }
  return fs.readFileSync(referencePath, 'utf8');
}

function namedLocationsContent(runtimeCode) {
  const shareRoot = `/usr/share/sdkwork/${runtimeCode}/web`;
  return `# Named locations for Adaptive Web (SDKWORK_DEPLOY_SPEC.md §8.1).
# Installed package roots; checkout dev uses gateway proxy on non-production hosts.

location @pc {
    root ${shareRoot}/pc;
    index index.html;
    try_files $uri $uri/ /index.html;
}

location @h5 {
    root ${shareRoot}/h5;
    index index.html;
    try_files $uri $uri/ /index.html;
}
`;
}

export function writeAdaptiveWebSnippets(webserverDir, runtimeCode) {
  const snippetsDir = path.join(webserverDir, 'snippets');
  fs.mkdirSync(snippetsDir, { recursive: true });
  fs.writeFileSync(
    path.join(snippetsDir, 'adaptive-web.maps.conf'),
    readReference('adaptive-web.maps.conf'),
  );
  fs.writeFileSync(
    path.join(snippetsDir, 'adaptive-web.dispatch.conf'),
    readReference('adaptive-web.dispatch.conf'),
  );
  fs.writeFileSync(
    path.join(snippetsDir, 'adaptive-web.named-locations.conf'),
    namedLocationsContent(runtimeCode),
  );
}
