#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IAM_PNPM_WORKSPACE_PACKAGES } from '../iam-workspace-paths.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const FOUNDATION_PNPM_PACKAGES = [
  ...IAM_PNPM_WORKSPACE_PACKAGES,
  '../sdkwork-iam/apps/sdkwork-iam-common/packages/sdkwork-iam-credential-entry',
  // `sdkwork-auth-runtime-pc-react` depends on the user-center core package
  // via `workspace:*`; without this entry the closure is uninstallable
  // (ERR_PNPM_WORKSPACE_PKG_NOT_FOUND).
  '../sdkwork-iam/apps/sdkwork-iam-pc/packages/sdkwork-user-center-core-pc-react',
  '../sdkwork-iam/sdks/sdkwork-iam-app-sdk/sdkwork-iam-app-sdk-typescript',
  '../sdkwork-iam/sdks/sdkwork-iam-backend-sdk/sdkwork-iam-backend-sdk-typescript',
  '../sdkwork-appbase/packages/common/foundation/sdkwork-runtime-bootstrap',
  '../sdkwork-appbase/packages/pc-react/foundation/sdkwork-appbase-pc-react',
  '../sdkwork-appbase/packages/pc-react/foundation/sdkwork-i18n-pc-react',
  '../sdkwork-appbase/packages/mobile-react/foundation/sdkwork-appbase-mobile-react',
  '../sdkwork-appbase/packages/mobile-react/foundation/sdkwork-shell-mobile-react',
  // `sdkwork-appbase-pc-react` depends on the base-data backend SDK via
  // `workspace:*`; without this entry the closure is uninstallable
  // (ERR_PNPM_WORKSPACE_PKG_NOT_FOUND).
  '../sdkwork-appbase/sdks/sdkwork-base-data-backend-sdk/sdkwork-base-data-backend-sdk-typescript',
  '../sdkwork-core/sdkwork-core-pc-react',
  '../sdkwork-ui/sdkwork-ui-pc-react',
  '../sdkwork-sdk-commons/sdkwork-sdk-common-typescript',
  '../sdkwork-utils/packages/sdkwork-utils-typescript',
];

export function specsRoot() {
  return SPECS_ROOT;
}

export function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function parseFlatYamlCatalog(text) {
  const catalog = {};
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:"([^"]+)"|([^:]+)):\s+(.+?)\s*$/u);
    if (!match) continue;
    const key = (match[1] ?? match[2]).trim();
    const rawValue = match[3].trim();
    catalog[key] = rawValue.startsWith('"') && rawValue.endsWith('"')
      ? JSON.parse(rawValue)
      : rawValue;
  }
  return catalog;
}

export function loadDefaultCatalog({ specsRoot = SPECS_ROOT } = {}) {
  const governanceCatalogPath = path.resolve(
    specsRoot,
    '..',
    'configs',
    'dependency-catalog.yaml',
  );
  if (fs.existsSync(governanceCatalogPath)) {
    const governanceCatalog = parseFlatYamlCatalog(
      fs.readFileSync(governanceCatalogPath, 'utf8').replace(/^\uFEFF/u, ''),
    );
    if (Object.keys(governanceCatalog).length > 0) return governanceCatalog;
  }

  const catalogPath = path.join(specsRoot, 'workspace/catalog.base.json');
  const data = readJsonIfExists(catalogPath);
  return data ?? {
    react: '^19.2.4',
    'react-dom': '^19.2.4',
    typescript: '~6.0.2',
    vite: '^8.0.3',
    '@types/react': '^19.2.14',
    '@types/react-dom': '^19.2.3',
  };
}

export const DEFAULT_CATALOG = loadDefaultCatalog();

export function loadConsumerOverlay(repoName) {
  const consumerPath = path.join(SPECS_ROOT, 'workspace/consumers', `${repoName}.json`);
  const data = readJsonIfExists(consumerPath);
  return {
    pnpmPackages: data?.pnpm?.packages ?? [],
    catalog: data?.catalog ?? {},
  };
}

export function parsePnpmWorkspacePackages(text) {
  const packages = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/u)) {
    if (/^packages:\s*$/u.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^[A-Za-z0-9_./-]+:\s*$/u.test(line) && !line.startsWith(' ')) {
      break;
    }
    const match = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/u);
    if (inPackages && match) packages.push(match[1]);
  }
  return packages;
}

export function parsePnpmWorkspaceCatalog(text) {
  const catalog = {};
  let inCatalog = false;
  for (const line of text.split(/\r?\n/u)) {
    if (/^catalog:\s*$/u.test(line)) {
      inCatalog = true;
      continue;
    }
    if (inCatalog && /^[A-Za-z0-9_./-]+:\s*$/u.test(line) && !line.startsWith(' ')) {
      break;
    }
    const match = line.match(/^\s*["']?([^"':]+)["']?\s*:\s*(.+?)\s*$/u);
    if (inCatalog && match) {
      const value = match[2];
      catalog[match[1]] = value.startsWith('"') && value.endsWith('"')
        ? JSON.parse(value)
        : value;
    }
  }
  return catalog;
}

export function isSiblingPackageEntry(entry) {
  return entry.startsWith('../');
}

export function uniquePackages(entries) {
  return [...new Set(entries)];
}

export function buildWorkspacePackages(localPackages, repoName) {
  const overlay = loadConsumerOverlay(repoName);
  const foundationPackages = repoName === 'sdkwork-appbase'
    ? FOUNDATION_PNPM_PACKAGES.filter((entry) => !entry.startsWith('../sdkwork-appbase/'))
    : FOUNDATION_PNPM_PACKAGES;
  return uniquePackages([
    ...localPackages,
    ...foundationPackages,
    ...overlay.pnpmPackages,
  ]);
}

export function buildWorkspaceCatalog(existingCatalog, repoName) {
  const overlay = loadConsumerOverlay(repoName);
  return { ...DEFAULT_CATALOG, ...existingCatalog, ...overlay.catalog };
}

export function renderPnpmWorkspace({ packages, catalog }) {
  const lines = ['packages:'];
  for (const entry of packages) {
    lines.push(`  - "${entry}"`);
  }
  if (catalog && Object.keys(catalog).length > 0) {
    lines.push('', 'catalog:');
    for (const [key, value] of Object.entries(catalog)) {
      const renderedKey = /[^A-Za-z0-9_-]/u.test(key) ? `"${key}"` : key;
      const renderedValue = /\s/u.test(value) ? JSON.stringify(value) : value;
      lines.push(`  ${renderedKey}: ${renderedValue}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
