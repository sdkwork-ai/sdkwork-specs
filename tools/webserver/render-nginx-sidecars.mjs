#!/usr/bin/env node
/**
 * Render deployments/webserver/nginx.<profile>.<environment>.conf sidecars from
 * layout v3 effective merge (SDKWORK_WEBSERVER_SPEC.md §4.3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEPLOYMENT_PROFILES,
  ENVIRONMENT_FILE_NAMES,
  LIFECYCLE_ENVIRONMENTS,
  mergeEffective,
  sidecarFileName,
} from './layout-v3.mjs';
import { applyAdaptiveWebFolding } from './adaptive-web.mjs';
import { parseTomlSubset } from './toml.mjs';
import { renderNginxConf, validateWebserverDir } from './validate.mjs';

const LEGACY_SIDECAR_PATTERN = /^nginx\.(standalone|cloud)(\..*)?\.conf$/u;

function readLayoutV3(webserverDir) {
  const commonPath = path.join(webserverDir, 'server.common.toml');
  if (!fs.existsSync(commonPath)) {
    return null;
  }
  const common = parseTomlSubset(fs.readFileSync(commonPath, 'utf8'), 'server.common.toml');
  const environmentDocs = Object.fromEntries(
    LIFECYCLE_ENVIRONMENTS.map((environment) => {
      const fileName = ENVIRONMENT_FILE_NAMES[environment];
      return [
        environment,
        parseTomlSubset(fs.readFileSync(path.join(webserverDir, fileName), 'utf8'), fileName),
      ];
    }),
  );
  const profileDocs = Object.fromEntries(
    DEPLOYMENT_PROFILES.map((profile) => {
      const fileName = `server.${profile}.toml`;
      return [
        profile,
        parseTomlSubset(fs.readFileSync(path.join(webserverDir, fileName), 'utf8'), fileName),
      ];
    }),
  );
  return { common, environmentDocs, profileDocs };
}

function removeLegacySidecars(webserverDir) {
  for (const entry of fs.readdirSync(webserverDir)) {
    if (LEGACY_SIDECAR_PATTERN.test(entry)) {
      fs.unlinkSync(path.join(webserverDir, entry));
    }
  }
}

/**
 * Render nginx sidecars for one module root.
 * @returns {{ skipped?: boolean, reason?: string, written?: string[], warnings?: string[] }}
 */
export function renderModuleNginxSidecars(moduleRoot, options = {}) {
  const { validate = false, runtimeCode = null, quiet = false } = options;
  const webserverDir = path.join(moduleRoot, 'deployments', 'webserver');
  if (!fs.existsSync(webserverDir)) {
    return { skipped: true, reason: 'missing deployments/webserver' };
  }

  const layout = readLayoutV3(webserverDir);
  if (!layout) {
    return { skipped: true, reason: 'missing layout v3 TOML' };
  }

  const { common, environmentDocs, profileDocs } = layout;
  if (common.enabled === false) {
    return { skipped: true, reason: 'module disabled' };
  }

  const nginx = common.nginx ?? {};
  if (nginx.enabled === false) {
    return { skipped: true, reason: 'nginx.enabled = false' };
  }

  const confBase = nginx.confFile ?? 'nginx.conf';
  const moduleCode = runtimeCode ?? common.id ?? path.basename(moduleRoot).replace(/^sdkwork-/u, '');
  removeLegacySidecars(webserverDir);

  const written = [];
  const warnings = [];

  for (const profile of DEPLOYMENT_PROFILES) {
    for (const environment of LIFECYCLE_ENVIRONMENTS) {
      const merged = mergeEffective(common, environmentDocs[environment], profileDocs[profile]);
      const { doc, mode, warnings: foldWarnings } = applyAdaptiveWebFolding(merged, {
        moduleRoot,
        webserverDir,
        runtimeCode: moduleCode,
      });
      for (const warning of foldWarnings) {
        const message = `[${profile}.${environment}] ${warning}`;
        warnings.push(message);
        if (!quiet) console.warn(`warning ${message}`);
      }
      const conf = renderNginxConf(doc, { profile, environment });
      const out = path.join(webserverDir, sidecarFileName(confBase, profile, environment));
      fs.writeFileSync(out, `${conf.trimEnd()}\n`, 'utf8');
      written.push(path.relative(moduleRoot, out));
      if (!quiet) {
        console.log(`wrote ${path.relative(moduleRoot, out)} (adaptive mode: ${mode})`);
      }
    }
  }

  if (validate) {
    const verify = validateWebserverDir(moduleRoot);
    for (const warning of verify.warnings) {
      warnings.push(warning);
      if (!quiet) console.warn(`warning: ${warning}`);
    }
    if (!verify.ok) {
      for (const error of verify.errors) {
        if (!quiet) console.error(`error: ${error}`);
      }
      throw new Error(`webserver validation failed for ${path.basename(moduleRoot)}`);
    }
  }

  return { written, warnings };
}

function parseCli(argv) {
  const workspaceFlag = argv.find((arg) => arg.startsWith('--workspace='));
  const moduleFlag = argv.find((arg) => arg.startsWith('--module='));
  return {
    workspace: path.resolve(
      workspaceFlag?.slice('--workspace='.length)
      ?? (argv[2] && !argv[2].startsWith('-') ? argv[2] : 'E:/sdkwork-space'),
    ),
    module: moduleFlag?.slice('--module='.length) ?? null,
    validate: argv.includes('--validate'),
    quiet: argv.includes('--quiet'),
  };
}

function isAlignableModule(name, workspace) {
  if (!name.startsWith('sdkwork-')) return false;
  return fs.existsSync(path.join(workspace, name, 'deployments'));
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { workspace, module, validate, quiet } = parseCli(process.argv.slice(2));
  let rendered = 0;
  let skipped = 0;

  const targets = module
    ? [module]
    : fs.readdirSync(workspace).filter((name) => isAlignableModule(name, workspace));

  for (const name of targets) {
    const moduleRoot = path.join(workspace, name);
    try {
      const result = renderModuleNginxSidecars(moduleRoot, { validate, quiet });
      if (result.skipped) {
        skipped += 1;
        if (!quiet) console.log(`skip ${name}: ${result.reason}`);
      } else {
        rendered += 1;
      }
    } catch (error) {
      console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }

  if (!quiet) {
    console.log(`render-nginx-sidecars: rendered=${rendered}, skipped=${skipped}`);
  }
  if (process.exitCode) process.exit(process.exitCode);
}
