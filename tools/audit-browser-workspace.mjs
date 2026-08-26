#!/usr/bin/env node

/**
 * Per-module audit for the standalone/cloud browser build system
 * (ENVIRONMENT_SPEC.md §5.1.0.1, PNPM_SCRIPT_SPEC.md §4.2,
 * SDKWORK_WEBSERVER_SPEC.md §17.4).
 *
 * Checks per module (sdkwork-* with pc/h5 apps):
 *   A. manifest runtime.supportedDeploymentProfiles declaration
 *   B. repo deployment config environments.*.cloudApiBaseUrl
 *   C. app deployment config: profile matrix + materialization
 *   D. runtime-env sources: canonical names + value rules
 *   E. legacy runtime-env filenames (historical baggage)
 *   F. legacy dist layout dirs (dist/{dev,test,staging,prod})
 *   G. legacy .env.cloud.* off-edge API hosts
 *
 * Usage:
 *   node tools/audit-browser-workspace.mjs --workspace <sdkwork-space-root>
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { discoverBrowserAppRoots, materializeBrowserRuntimeEnv } from './build-browser-client.mjs';

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];
const PROFILES = ['standalone', 'cloud'];
const LEGACY_DIST_ALIASES = ['dev', 'test', 'staging', 'prod'];
const SDK_URL_KEY = /API_BASE_URL|API_GATEWAY|API_EDGE|_API_URL/;
const EDGE_HOSTS = {
  development: 'api-dev.sdkwork.com',
  test: 'api-test.sdkwork.com',
  staging: 'api-staging.sdkwork.com',
  production: 'api.sdkwork.com',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findBrowserRuntimeEnvDir(appRoot) {
  for (const relative of ['etc/browser', 'config/browser']) {
    const candidate = path.join(appRoot, relative);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return path.join(appRoot, 'etc', 'browser');
}

function auditRepo(repositoryRoot, repoName) {
  const issues = [];
  const apps = discoverBrowserAppRoots(repositoryRoot);
  if (apps.length === 0) {
    return { apps: 0, issues: [] };
  }

  // A. manifest
  const manifestPath = path.join(repositoryRoot, 'sdkwork.app.config.json');
  let declaredProfiles = null;
  if (fs.existsSync(manifestPath)) {
    try {
      declaredProfiles = readJson(manifestPath).runtime?.supportedDeploymentProfiles;
    } catch {
      issues.push('A: manifest is not valid JSON');
    }
  } else {
    issues.push('A: sdkwork.app.config.json missing');
  }
  const isStandaloneOnly = repoName === 'sdkwork-webserver';
  if (isStandaloneOnly) {
    if (JSON.stringify(declaredProfiles) !== JSON.stringify(['standalone'])) {
      issues.push(`A: webserver must declare ["standalone"], got ${JSON.stringify(declaredProfiles)}`);
    }
  } else if (!Array.isArray(declaredProfiles)
    || !declaredProfiles.includes('standalone')
    || !declaredProfiles.includes('cloud')) {
    issues.push(`A: must declare both standalone and cloud, got ${JSON.stringify(declaredProfiles)}`);
  }

  // B. repo deployment config cloudApiBaseUrl
  const repoDeployPath = path.join(repositoryRoot, 'etc', 'sdkwork.deployment.config.json');
  if (fs.existsSync(repoDeployPath)) {
    const envs = readJson(repoDeployPath).environments ?? {};
    for (const environment of ENVIRONMENTS) {
      const value = envs[environment]?.cloudApiBaseUrl;
      if (typeof value !== 'string' || value.length === 0) {
        issues.push(`B: environments.${environment}.cloudApiBaseUrl missing`);
      }
    }
  } else {
    issues.push('B: repo deployment config missing');
  }

  for (const app of apps) {
    const appName = app.name;
    const prefix = `${appName}`;

    // C. app deployment config
    const depCfgPath = path.join(app.root, 'etc', 'sdkwork.deployment.config.json');
    if (!fs.existsSync(depCfgPath)) {
      issues.push(`C: ${prefix}: app deployment config missing`);
      continue;
    }
    let depCfg;
    try {
      depCfg = readJson(depCfgPath);
    } catch {
      issues.push(`C: ${prefix}: app deployment config invalid JSON`);
      continue;
    }
    const profiles = depCfg.profiles ?? {};
    const expectedProfiles = isStandaloneOnly
      ? PROFILES.slice(0, 1).flatMap((p) => ENVIRONMENTS.map((e) => `${p}.${e}`))
      : PROFILES.flatMap((p) => ENVIRONMENTS.map((e) => `${p}.${e}`));
    for (const profileId of expectedProfiles) {
      if (typeof profiles[profileId]?.source !== 'string') {
        issues.push(`C: ${prefix}: missing profile ${profileId}`);
      }
    }
    if (isStandaloneOnly && Object.keys(profiles).some((k) => k.startsWith('cloud.'))) {
      issues.push(`C: ${prefix}: webserver must not declare cloud profiles`);
    }
    const materialization = depCfg.materialization;
    const hasJsonOutput = typeof materialization?.output === 'string';
    const isDotenv = materialization?.format === 'dotenv' || typeof materialization?.outputPattern === 'string';
    if (!hasJsonOutput && !isDotenv) {
      issues.push(`C: ${prefix}: materialization.output (json) or dotenv format required`);
    }

    // D. runtime-env sources canonical + value rules
    const browserDir = findBrowserRuntimeEnvDir(app.root);
    for (const profileId of expectedProfiles) {
      const [deploymentProfile, environment] = profileId.split('.');
      const fileName = `runtime-env.${profileId}.json`;
      if (!fs.existsSync(path.join(browserDir, fileName))) {
        issues.push(`D: ${prefix}: missing ${fileName}`);
        continue;
      }
      try {
        materializeBrowserRuntimeEnv({
          appRoot: app.root,
          deploymentProfile,
          environment,
          repositoryRoot,
        });
      } catch (error) {
        issues.push(`D: ${prefix}: ${profileId} -> ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // E. legacy runtime-env filenames
    if (fs.existsSync(browserDir)) {
      const canonical = new Set(expectedProfiles.map((p) => `runtime-env.${p}.json`));
      for (const name of fs.readdirSync(browserDir)) {
        if (name.startsWith('runtime-env.') && name.endsWith('.json') && !canonical.has(name)) {
          issues.push(`E: ${prefix}: legacy runtime-env file ${name}`);
        }
      }
    }

    // F. legacy dist layout dirs
    const distRoot = path.join(app.root, 'dist');
    if (fs.existsSync(distRoot)) {
      for (const alias of LEGACY_DIST_ALIASES) {
        if (fs.existsSync(path.join(distRoot, alias))) {
          issues.push(`F: ${prefix}: legacy dist/${alias} directory present`);
        }
      }
    }
  }

  // G. legacy .env.cloud.* off-edge API hosts
  for (const app of apps) {
    for (const environment of ENVIRONMENTS) {
      const envFile = path.join(app.root, `.env.cloud.${environment}`);
      if (!fs.existsSync(envFile)) continue;
      const expectedHost = EDGE_HOSTS[environment];
      const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (!SDK_URL_KEY.test(key) || !/^https?:\/\//.test(value)) continue;
        let url;
        try {
          url = new URL(value);
        } catch {
          continue;
        }
        if (url.hostname !== expectedHost) {
          issues.push(`G: ${app.name}: ${envFile} ${key} -> ${value} (must be ${expectedHost})`);
        }
      }
    }
  }

  return { apps: apps.length, issues };
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h' },
      workspace: { type: 'string', required: true },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/audit-browser-workspace.mjs --workspace <sdkwork-space-root>');
    return;
  }
  const workspaceRoot = path.resolve(values.workspace);
  let totalIssues = 0;
  let moduleCount = 0;
  for (const repo of fs.readdirSync(workspaceRoot).filter((n) => n.startsWith('sdkwork-')).sort()) {
    const result = auditRepo(path.join(workspaceRoot, repo), repo);
    if (result.apps === 0) continue;
    moduleCount += 1;
    const status = result.issues.length === 0 ? 'PASS' : 'FAIL';
    console.log(`${status} ${repo} (${result.apps} apps, ${result.issues.length} issue(s))`);
    for (const issue of result.issues.slice(0, 12)) {
      console.log(`    - ${issue}`);
    }
    if (result.issues.length > 12) {
      console.log(`    ... and ${result.issues.length - 12} more`);
    }
    totalIssues += result.issues.length;
  }
  console.log(`\nmodules audited: ${moduleCount}, total issues: ${totalIssues}`);
  process.exitCode = totalIssues > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
