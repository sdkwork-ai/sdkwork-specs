#!/usr/bin/env node

/**
 * Validate a module's bin/ entrypoint family against MODULE_BIN_SPEC.md.
 * Usage: node tools/check-module-bin.mjs --root <module-root>
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const REQUIRED_SCRIPTS = Object.freeze([
  'docker-image.sh',
  'docker-deploy.sh',
  'apps-build.sh',
  'apps-package.sh',
  'apps-deploy.sh',
  'apps-pkg-installer.sh',
  'config.sh',
  'doctor.sh',
  'backup.sh',
]);

// A thin wrapper is a 2-statement dispatch; anything longer means generic
// logic leaked out of the shared library (MODULE_BIN_SPEC.md §2).
const MAX_WRAPPER_LINES = 8;

// Generic concerns that MUST live in sdkwork-specs/bin/lib/sdkwork-common.sh.
// Finding one of these in a module wrapper is a coupling violation.
const FORBIDDEN_IN_MODULE_SH = Object.freeze([
  { pattern: /\b(ssh|scp)\s/, issue: 'raw ssh/scp (use sdkwork_remote / sdkwork_push_dir)' },
  { pattern: /sha256sum/, issue: 'sha256sum (use sdkwork_write_checksum)' },
  { pattern: /tar\s+-[^\s]*c/, issue: 'tar create (use sdkwork_tar_artifact)' },
  { pattern: /docker\s+(save|push|load|pull)\b/, issue: 'raw docker transport (use the docker-image entrypoint)' },
  { pattern: /^SDKWORK_IMAGE_TAG_DEFAULT=/m, issue: 'hardcoded SDKWORK_IMAGE_TAG_DEFAULT (the tag comes from sdkwork.app.config.json release.currentVersion)' },
]);

function checkModuleBin(root) {
  const issues = [];
  const binDir = path.join(root, 'bin');
  if (!fs.existsSync(binDir)) {
    return [`missing bin/ directory (MODULE_BIN_SPEC.md §2)`];
  }

  for (const script of REQUIRED_SCRIPTS) {
    const p = path.join(binDir, script);
    if (!fs.existsSync(p)) {
      issues.push(`missing required bin/${script}`);
      continue;
    }
    try {
      fs.accessSync(p, fs.constants.X_OK);
    } catch {
      issues.push(`bin/${script} is not executable`);
    }
    const text = fs.readFileSync(p, 'utf8');
    if (!text.includes('lib/bootstrap.sh')) {
      issues.push(`bin/${script} must bootstrap through bin/lib/bootstrap.sh (thin wrapper rule, §2)`);
    }
    const bodyLines = text.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
    if (bodyLines.length > MAX_WRAPPER_LINES) {
      issues.push(
        `bin/${script} has ${bodyLines.length} code lines; thin wrappers must stay <= ${MAX_WRAPPER_LINES} (§2)`,
      );
    }
  }

  const moduleSh = path.join(binDir, 'lib', 'module.sh');
  if (!fs.existsSync(moduleSh)) {
    issues.push('missing bin/lib/module.sh (module wiring, §3)');
  } else {
    const text = fs.readFileSync(moduleSh, 'utf8');
    for (const key of ['SDKWORK_MODULE_ID', 'SDKWORK_IMAGE_NAME', 'SDKWORK_APP_TYPES']) {
      if (!text.includes(key)) {
        issues.push(`bin/lib/module.sh does not declare ${key}`);
      }
    }
    for (const hook of ['sdkwork_build_app', 'sdkwork_package_app', 'sdkwork_deploy_app', 'sdkwork_image_build', 'sdkwork_installer_app']) {
      if (!text.includes(hook)) {
        issues.push(`bin/lib/module.sh does not implement hook ${hook}`);
      }
    }
    for (const { pattern, issue } of FORBIDDEN_IN_MODULE_SH) {
      if (pattern.test(text)) {
        issues.push(`bin/lib/module.sh reimplements a shared concern: ${issue} (§3)`);
      }
    }
  }

  const bootstrap = path.join(binDir, 'lib', 'bootstrap.sh');
  if (fs.existsSync(bootstrap)) {
    const text = fs.readFileSync(bootstrap, 'utf8');
    for (const marker of ['SDKWORK_SPECS_ROOT', 'sdkwork-common.sh', 'entrypoints.sh']) {
      if (!text.includes(marker)) {
        issues.push(`bin/lib/bootstrap.sh does not reference ${marker} (§3 resolution order)`);
      }
    }
    // Operations lifecycle (OPERATIONS_SPEC.md §3-§5) ships as shared libraries;
    // a bootstrap that omits them forces the module to reimplement.
    for (const lib of ['ops-config.sh', 'ops-observe.sh', 'ops-backup.sh']) {
      if (!text.includes(lib)) {
        issues.push(`bin/lib/bootstrap.sh does not source ${lib} (OPERATIONS_SPEC.md §3-§5)`);
      }
    }
    if (!text.includes('sdkwork_init')) {
      issues.push('bin/lib/bootstrap.sh must call sdkwork_init (guards, defaults, evidence trap, §3)');
    }
  } else {
    issues.push('missing bin/lib/bootstrap.sh');
  }

  const readme = path.join(binDir, 'README.md');
  if (!fs.existsSync(readme)) {
    issues.push('missing bin/README.md (usage card, §2)');
  }

  return issues;
}

function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      root: { type: 'string', default: '.' },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/check-module-bin.mjs --root <module-root>');
    return;
  }
  const root = path.resolve(values.root);
  const issues = checkModuleBin(root);
  if (issues.length > 0) {
    console.error(`module bin standard failed for ${root}`);
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }
  console.log(`module bin standard passed for ${root}`);
}

main();
