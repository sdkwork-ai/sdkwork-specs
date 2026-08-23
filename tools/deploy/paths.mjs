import path from 'node:path';
import { surfaceDist } from './identity.mjs';

export function nginxSiteFile(domain, overrides = {}) {
  if (overrides?.nginx?.siteFile) {
    return overrides.nginx.siteFile;
  }
  return `/etc/nginx/sites-enabled/sdkwork/${domain}.conf`;
}

export function nginxStagingFile(domain) {
  return path.posix.join('target/nginx/sites-enabled/sdkwork', `${domain}.conf`);
}

export function certPaths(certName, overrides = {}) {
  const certRoot = overrides?.tls?.certRoot ?? overrides?.nginx?.certRoot ?? '/etc/sdkwork/certs/letsencrypt';
  const base = `${certRoot}/${certName}`;
  return {
    fullchain: `${base}/fullchain.pem`,
    privkey: `${base}/privkey.pem`,
  };
}

export function webRoots({ appId, runtimeCode, layout, surface, repoRoot, dev = false }) {
  const relDist = surfaceDist(appId, surface);
  if (dev) {
    return path.posix.join(repoRoot.replace(/\\/g, '/'), relDist);
  }
  if (layout === 'source-tree') {
    return `/usr/share/sdkwork-space/${appId}/${relDist}`;
  }
  return `/usr/share/sdkwork/${runtimeCode}/web/${surface}/`;
}

export function binaryPath({ appId, runtimeCode, layout, binary, repoRoot, dev = false }) {
  if (dev) {
    return path.posix.join(repoRoot.replace(/\\/g, '/'), `target/release/${binary}`);
  }
  if (layout === 'source-tree') {
    return `/usr/share/sdkwork-space/${appId}/target/release/${binary}`;
  }
  return `/usr/lib/sdkwork/${runtimeCode}/${binary}`;
}

export function hostRoot({ appId, layout }) {
  if (layout === 'source-tree') {
    return `/usr/share/sdkwork-space/${appId}/`;
  }
  return null;
}
