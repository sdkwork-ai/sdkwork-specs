#!/usr/bin/env node

/**
 * Cross-workspace consistency audit for the region/i18n/deployment system.
 *
 * Scans every sdkwork-* repository under the workspace root and reports
 * inconsistencies in:
 *   - topology spec presence and applicationCode uniqueness
 *   - profile env region keys (SDKWORK_<APP>_REGION_CODE, SDKWORK_DATABASE_SEED_LOCALE)
 *   - seed.manifest.json locale/i18n declarations
 *   - database.manifest.json activeSeedLocales
 *   - deployment config presence
 *
 * Usage:
 *   node tools/audit-region-consistency.mjs [--workspace <root>]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const EXPECTED_SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'de-DE', 'fr-FR', 'ru-RU', 'ko-KR'];
// REGION_SPEC §4: `global` is the standard default and `cn` is the China
// mainland market partition; both are active registry codes. The audit
// requires every profile env to declare the key with an active code, not a
// specific market.
const ACTIVE_REGION_CODES = ['global', 'cn'];
const EXPECTED_SEED_LOCALE = 'zh-CN';

function parseArgs(argv) {
  const settings = { workspaceRoot: DEFAULT_WORKSPACE_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--workspace') {
      settings.workspaceRoot = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return settings;
}

function reposUnder(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function specOf(repoRoot) {
  const specPath = path.join(repoRoot, 'specs', 'topology.spec.json');
  if (!fs.existsSync(specPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch {
    return { __invalid: true };
  }
}

function profileDirsFor(repoRoot, spec = null) {
  const candidates = ['etc/topology', 'configs/topology'];
  if (spec?.profileRoot) {
    candidates.unshift(spec.profileRoot);
  }
  return [...new Set(candidates)]
    .map((relative) => path.join(repoRoot, relative))
    .filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
}

// Env var names must not contain hyphens; application codes normalize like
// `api-gateway` → `API_GATEWAY` for the `SDKWORK_<APPLICATION_CODE>_REGION_CODE` key.
function regionKeyFor(applicationCode) {
  return `SDKWORK_${applicationCode.toUpperCase().replaceAll('-', '_')}_REGION_CODE`;
}

function audit() {
  const settings = parseArgs(process.argv.slice(2));
  const repos = reposUnder(settings.workspaceRoot);
  const issues = [];
  const apps = [];
  const appCodes = new Map();

  for (const repo of repos) {
    const name = path.basename(repo);
    const spec = specOf(repo);
    if (!spec) continue;

    if (spec.__invalid) {
      issues.push(`[${name}] topology spec is invalid JSON`);
      continue;
    }
    const code = String(spec.applicationCode ?? spec.appId ?? 'APP').toUpperCase();
    if (appCodes.has(code) && appCodes.get(code) !== name) {
      issues.push(`[${name}] applicationCode ${code} collides with ${appCodes.get(code)}`);
    }
    appCodes.set(code, name);
    apps.push({ name, code, spec });

    const dirs = profileDirsFor(repo, spec);
    if (dirs.length === 0) {
      issues.push(`[${name}] topology spec exists but no profile env dir`);
      continue;
    }
    const regionKey = regionKeyFor(code);
    for (const dir of dirs) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.env'));
      if (files.length === 0) {
        // JSON runtime-env profiles (e.g. messaging) are a separate form.
        continue;
      }
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        const lines = content.split('\n');
        const regionLine = lines.find((line) => /^SDKWORK_[A-Z0-9_]+_REGION_CODE=/.test(line));
        const seedLine = lines.find((line) => line.startsWith('SDKWORK_DATABASE_SEED_LOCALE='));
        if (!regionLine) {
          issues.push(`[${name}/${file}] missing ${regionKey}`);
        } else if (!ACTIVE_REGION_CODES.includes(regionLine.split('=')[1].trim())) {
          issues.push(`[${name}/${file}] ${regionLine.split('=')[0]}=${regionLine.split('=')[1]} (expected an active REGION_SPEC code: ${ACTIVE_REGION_CODES.join(' or ')})`);
        }
        if (!seedLine) {
          issues.push(`[${name}/${file}] missing SDKWORK_DATABASE_SEED_LOCALE`);
        } else if (seedLine.split('=')[1].trim() !== EXPECTED_SEED_LOCALE) {
          issues.push(`[${name}/${file}] SDKWORK_DATABASE_SEED_LOCALE=${seedLine.split('=')[1]} (expected ${EXPECTED_SEED_LOCALE})`);
        }
      }
    }

    // seed manifest consistency
    const seedManifestPath = path.join(repo, 'database', 'seeds', 'seed.manifest.json');
    if (fs.existsSync(seedManifestPath)) {
      try {
        const seed = JSON.parse(fs.readFileSync(seedManifestPath, 'utf8'));
        const supported = seed.supportedLocales ?? [];
        for (const expected of EXPECTED_SUPPORTED_LOCALES) {
          if (!supported.includes(expected)) {
            issues.push(`[${name}] seed.manifest supportedLocales missing ${expected}`);
          }
        }
        if (!seed.activeLocales?.includes('zh-CN')) {
          issues.push(`[${name}] seed.manifest activeLocales missing zh-CN`);
        }
        if (!seed.activeLocales?.includes('en-US')) {
          issues.push(`[${name}] seed.manifest activeLocales missing en-US`);
        }
        if (!seed.defaultLocale || seed.defaultLocale !== 'zh-CN') {
          issues.push(`[${name}] seed.manifest defaultLocale ${seed.defaultLocale}`);
        }
        if (!seed.fallbackLocale || seed.fallbackLocale !== 'zh-CN') {
          issues.push(`[${name}] seed.manifest fallbackLocale ${seed.fallbackLocale}`);
        }
      } catch (error) {
        issues.push(`[${name}] seed.manifest invalid: ${error.message}`);
      }
    }

    // database manifest activeSeedLocales
    const dbManifestPath = path.join(repo, 'database', 'database.manifest.json');
    if (fs.existsSync(dbManifestPath)) {
      try {
        const db = JSON.parse(fs.readFileSync(dbManifestPath, 'utf8'));
        const active = db.lifecycle?.activeSeedLocales ?? [];
        if (!active.includes('en-US')) {
          issues.push(`[${name}] database.manifest activeSeedLocales missing en-US`);
        }
      } catch (error) {
        issues.push(`[${name}] database.manifest invalid: ${error.message}`);
      }
    }

    // deployment config presence for apps with deploy.yaml
    const deployYaml = path.join(repo, 'deployments', 'deploy.yaml');
    const deploymentConfig = path.join(repo, 'etc', 'sdkwork.deployment.config.json');
    if (fs.existsSync(deployYaml) && !fs.existsSync(deploymentConfig)) {
      issues.push(`[${name}] has deployments/deploy.yaml but no etc/sdkwork.deployment.config.json`);
    }
  }

  const uniqueCodes = new Set([...appCodes.keys()]);
  console.log(JSON.stringify({
    repositoriesWithTopology: apps.length,
    uniqueApplicationCodes: uniqueCodes.size,
    issueCount: issues.length,
    issues,
  }, null, 2));
}

audit();
