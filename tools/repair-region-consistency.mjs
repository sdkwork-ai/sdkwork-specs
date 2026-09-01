#!/usr/bin/env node

/**
 * Workspace-wide region/i18n consistency repair:
 *   1. profile env region defaults -> cn (any SDKWORK_*_REGION_CODE=global)
 *   2. drop the wrongly injected SDKWORK_ROUTER_REGION_CODE key when the
 *      canonical SDKWORK_CLOUDROUTER_ROUTER_REGION_CODE exists
 *   3. seed.manifest: activeLocales + en-US, supportedLocales complete set
 *   4. database.manifest: activeSeedLocales + en-US
 *   5. report apps with deploy.yaml but no deployment config
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'de-DE', 'fr-FR', 'ru-RU', 'ko-KR'];
const DRY_RUN = process.argv.includes('--dry-run');

function repos() {
  return fs
    .readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('sdkwork-'))
    .map((e) => path.join(WORKSPACE_ROOT, e.name))
    .filter((root) => fs.existsSync(path.join(root, 'specs', 'topology.spec.json')));
}

function profileDirs(root) {
  return ['etc/topology', 'configs/topology']
    .map((r) => path.join(root, r))
    .filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
}

const summary = { envFiles: 0, regionKeysUpdated: 0, wrongKeysDropped: 0, seedManifests: 0, dbManifests: 0, missingDeployConfig: [] };

for (const root of repos()) {
  const name = path.basename(root);
  // 1+2: profile env region keys
  for (const dir of profileDirs(root)) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.env'))) {
      const p = path.join(dir, file);
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      const out = [];
      for (const line of lines) {
        const m = /^SDKWORK_([A-Z0-9_]+)_REGION_CODE=(global|cn|us|eu|asia)$/.exec(line.trim());
        if (m) {
          const key = m[1];
          const hasCanonical =
            key === 'ROUTER' &&
            lines.some((l) => l.trim().startsWith('SDKWORK_CLOUDROUTER_ROUTER_REGION_CODE='));
          if (hasCanonical) {
            // wrong residual key from the bulk injector; drop it
            summary.wrongKeysDropped += 1;
            continue;
          }
          if (m[2] !== 'cn') {
            // Preserve the line terminator (CRLF checkouts must not be
            // rewritten to LF mid-line).
            out.push(line.replace(/(=global|=us|=eu|=asia)(\r?)$/, '=cn$2'));
            summary.regionKeysUpdated += 1;
            continue;
          }
        }
        out.push(line);
      }
      const updated = out.join('\n');
      if (updated !== lines.join('\n')) {
        if (!DRY_RUN) fs.writeFileSync(p, updated);
        summary.envFiles += 1;
      }
    }
  }

  // 3: seed manifest
  const seedPath = path.join(root, 'database', 'seeds', 'seed.manifest.json');
  if (fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    let changed = false;
    if (!seed.supportedLocales || SUPPORTED_LOCALES.some((l) => !seed.supportedLocales.includes(l))) {
      seed.supportedLocales = SUPPORTED_LOCALES;
      changed = true;
    }
    if (!seed.activeLocales?.includes('en-US')) {
      seed.activeLocales = Array.from(new Set([...(seed.activeLocales ?? []), 'en-US']));
      changed = true;
    }
    if (changed) {
      if (!DRY_RUN) fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n');
      summary.seedManifests += 1;
      console.log(`[seed] ${name} locales aligned`);
    }
  }

  // 4: database manifest
  const dbPath = path.join(root, 'database', 'database.manifest.json');
  if (fs.existsSync(dbPath)) {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const active = db.lifecycle?.activeSeedLocales ?? [];
    if (!active.includes('en-US')) {
      db.lifecycle.activeSeedLocales = Array.from(new Set([...active, 'en-US']));
      if (!DRY_RUN) fs.writeFileSync(dbPath, JSON.stringify(db, null, 2) + '\n');
      summary.dbManifests += 1;
      console.log(`[db] ${name} activeSeedLocales aligned`);
    }
  }

  // 5: deploy.yaml without deployment config
  const deployYaml = path.join(root, 'deployments', 'deploy.yaml');
  const deploymentConfig = path.join(root, 'etc', 'sdkwork.deployment.config.json');
  if (fs.existsSync(deployYaml) && !fs.existsSync(deploymentConfig)) {
    summary.missingDeployConfig.push(name);
  }
}

console.log(JSON.stringify(summary, null, 2));
