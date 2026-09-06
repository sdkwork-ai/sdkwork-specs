#!/usr/bin/env node

/**
 * scaffold-module-bin.mjs — scaffold the standardized nine-entrypoint bin/
 * family into an SDKWork module root (MODULE_BIN_SPEC.md §2, §3).
 *
 * Idempotent: existing bin/ files are never overwritten (module wiring may
 * carry real delegation); the tool only fills what is missing. Use --force
 * to regenerate the generated files (wrappers, bootstrap.sh, README.md,
 * AGENTS.md deployment section) — bin/lib/module.sh is never overwritten.
 *
 * Usage:
 *   node tools/scaffold-module-bin.mjs --root <module-root> [--image-name <docker-name>] [--app-types a,b] [--force]
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const WRAPPERS = [
  ['docker-image.sh', 'image packaging and update (MODULE_BIN_SPEC.md §4.1).'],
  ['docker-deploy.sh', 'image deployment to WSL/remote Ubuntu (§4.2).'],
  ['config.sh', 'deployed configuration inspection and mutation (§4.6).'],
  ['doctor.sh', 'read-only environment diagnostics (§4.7).'],
  ['backup.sh', 'backup and restore (§4.8).'],
  ['apps-build.sh', 'build declared application surfaces (§4.3).'],
  ['apps-package.sh', 'package declared application surfaces (§4.4).'],
  ['apps-deploy.sh', 'deploy packaged applications (§4.5).'],
  ['apps-pkg-installer.sh', 'package native OS installers (§4.9).'],
];

function wrapperSource(entry, comment) {
  return [
    '#!/usr/bin/env bash',
    `# ${comment}`,
    `SDKWORK_ENTRY="${entry}"`,
    'source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/bootstrap.sh"',
    '',
  ].join('\n');
}

const BOOTSTRAP = `#!/usr/bin/env bash
# bootstrap — resolve the sdkwork-specs checkout, load the shared library,
# module wiring, and generic entrypoints, then dispatch (MODULE_BIN_SPEC.md §3).
set -euo pipefail
: "\${SDKWORK_ENTRY:?bootstrap requires SDKWORK_ENTRY}"
SDKWORK_MODULE_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)"
export SDKWORK_MODULE_ROOT

if [[ -z "\${SDKWORK_SPECS_ROOT:-}" ]]; then
  if [[ -f "\${SDKWORK_MODULE_ROOT}/../sdkwork-specs/bin/lib/sdkwork-common.sh" ]]; then
    SDKWORK_SPECS_ROOT="$(cd "\${SDKWORK_MODULE_ROOT}/../sdkwork-specs" && pwd)"
  elif [[ -f "\${SDKWORK_MODULE_ROOT}/sdkwork-specs/bin/lib/sdkwork-common.sh" ]]; then
    SDKWORK_SPECS_ROOT="$(cd "\${SDKWORK_MODULE_ROOT}/sdkwork-specs" && pwd)"
  else
    echo "[sdkwork-bin] ERROR(65): cannot resolve sdkwork-specs checkout (set SDKWORK_SPECS_ROOT)" >&2
    exit 65
  fi
fi
export SDKWORK_SPECS_ROOT

# shellcheck source=/dev/null
source "\${SDKWORK_SPECS_ROOT}/bin/lib/sdkwork-common.sh"
# shellcheck source=/dev/null
source "\${SDKWORK_MODULE_ROOT}/bin/lib/module.sh"
# shellcheck source=/dev/null
source "\${SDKWORK_SPECS_ROOT}/bin/lib/entrypoints.sh"
# Operational lifecycle: configuration, logs/diagnostics, backup/restore
# (OPERATIONS_SPEC.md). Loaded after module.sh so module constants win.
# shellcheck source=/dev/null
source "\${SDKWORK_SPECS_ROOT}/bin/lib/ops-config.sh"
# shellcheck source=/dev/null
source "\${SDKWORK_SPECS_ROOT}/bin/lib/ops-observe.sh"
# shellcheck source=/dev/null
source "\${SDKWORK_SPECS_ROOT}/bin/lib/ops-backup.sh"

# Guards, defaults (image tag from the app manifest), and the evidence trap.
sdkwork_init

"sdkwork_entry_\${SDKWORK_ENTRY//-/_}" "$@"
`;

function moduleShSource({ moduleId, imageName, appTypes, hasContainerBuild }) {
  const imageBuild = hasContainerBuild
    ? `sdkwork_image_build() {
  local ref="$1" tag="$2"
  # Canonical container build declared by the repository (package.json).
  sdkwork_local_run pnpm build:container --tag "\${tag}"
}`
    : `sdkwork_image_build() {
  local ref="$1" tag="$2"
  sdkwork_die "\${SDKWORK_BIN_E_STATE}" \\
    "${moduleId} has no canonical container build entrypoint wired yet; implement this hook against the repository's container build (MODULE_BIN_SPEC.md §4.1) before using bin/docker-image.sh build"
}`;
  return `#!/usr/bin/env bash
# module.sh — ${moduleId} bin/ wiring (MODULE_BIN_SPEC.md §3).
# Scaffolded by sdkwork-specs/tools/scaffold-module-bin.mjs; replace the
# unwired hooks with the repository's canonical commands as they land.
# Every shared primitive comes from sdkwork-specs/bin/lib/sdkwork-common.sh.

SDKWORK_MODULE_ID="${moduleId}"
SDKWORK_IMAGE_NAME="${imageName}"
SDKWORK_APP_TYPES="${appTypes}"

# Operations wiring (OPERATIONS_SPEC.md): compose service carrying the health
# probe and its path; adjust to the module's compose file when it lands.
SDKWORK_PRIMARY_SERVICE="app"
SDKWORK_HEALTH_PATH="/healthz"
SDKWORK_CONFIG_ENV_SUBDIR="env"

# ----------------------------------------------------------------------------
# Container image (docker-image.sh build)
# ----------------------------------------------------------------------------
${imageBuild}

# ----------------------------------------------------------------------------
# Application build (apps-build.sh)
# ----------------------------------------------------------------------------
sdkwork_build_app() {
  local app_type="$1" environment="$2" profile="$3"
  case "\${app_type}" in
    server)
      sdkwork_local_run cargo build --release ;;
    *)
      sdkwork_die "\${SDKWORK_BIN_E_ENV}" \\
        "app type '\${app_type}' has no wired build for ${moduleId}; extend sdkwork_build_app with the repository's canonical runner (declared: \${SDKWORK_APP_TYPES})" ;;
  esac
}

# ----------------------------------------------------------------------------
# Application packaging (apps-package.sh)
# ----------------------------------------------------------------------------
sdkwork_package_app() {
  local app_type="$1" environment="$2" profile="$3" out="$4"
  sdkwork_die "\${SDKWORK_BIN_E_STATE}" \\
    "${moduleId} has no canonical release packager wired yet; implement sdkwork_package_app against the repository's packaging command (MODULE_BIN_SPEC.md §4.4)"
}

# ----------------------------------------------------------------------------
# Native installer packaging (apps-pkg-installer.sh, MODULE_BIN_SPEC.md §4.9)
# ----------------------------------------------------------------------------
sdkwork_installer_app() {
  local app_type="$1" platform="$2" environment="$3" profile="$4" out="$5" arch="$6" format="$7"
  sdkwork_die "\${SDKWORK_BIN_E_STATE}" \\
    "${moduleId} has no native installer builder wired yet; implement sdkwork_installer_app against the repository's installer commands (MODULE_BIN_SPEC.md §4.9; platforms: windows|linux|macos|android|ios)"
}

# ----------------------------------------------------------------------------
# Application deployment (apps-deploy.sh)
# ----------------------------------------------------------------------------
sdkwork_deploy_app() {
  local app_type="$1" action="$2" environment="$3" profile="$4" host="$5"
  sdkwork_die "\${SDKWORK_BIN_E_STATE}" \\
    "${moduleId} has no application deployment channel wired yet; implement sdkwork_deploy_app (host-native install via bin/apps-package artifacts, MODULE_BIN_SPEC.md §4.5)"
}
`;
}

function readmeSource({ moduleId, appTypes, imageName }) {
  return `# bin/ — standardized entrypoints (\`sdkwork-specs/MODULE_BIN_SPEC.md\`)

\`${moduleId}\` ships the standard nine \`bin/\` entrypoints. Shared behavior
lives in \`sdkwork-specs/bin/lib/sdkwork-common.sh\`; this directory only
carries identity (\`bin/lib/module.sh\`) and thin dispatches.

| Script | Purpose |
| --- | --- |
| \`docker-image.sh\` | build / push / save / load / update / inspect \`registry.sdkwork.com/apps/${imageName}:<version>\` |
| \`docker-deploy.sh\` | install / upgrade / rollback / status / logs / down / start / stop / restart the Docker bundle on \`wsl\` or \`ssh://[user@]host\` |
| \`apps-build.sh\` | build declared app surfaces (default: \`server\` → cargo) |
| \`apps-package.sh\` | package surfaces into \`target/bin-packages/\` (+ sidecar \`.sha256\`) |
| \`apps-deploy.sh\` | deploy packaged apps to WSL Ubuntu / remote Ubuntu |
| \`apps-pkg-installer.sh\` | package native OS installers (\`windows\|linux\|macos\|android\|ios\`) into \`target/bin-installers/\` |
| \`config.sh\` / \`doctor.sh\` / \`backup.sh\` | operations lifecycle (\`OPERATIONS_SPEC.md\` §3–§5) |

Declared app types: \`${appTypes}\`. Default image tag comes from
\`sdkwork.app.config.json\` → \`release.currentVersion\`.

Flags: \`--environment development|test|staging|demo|production\` ·
\`--profile standalone|cloud\` · \`--host wsl|ssh://[user@]host[:port]\` ·
\`--yes\` · \`--dry-run\`. Each run appends its command, flags, and exit status
to \`target/bin-evidence/evidence.log\`. Run \`bin/<script>.sh doctor\` for the
environment self-check.

> Hooks marked "no canonical command wired yet" in \`bin/lib/module.sh\`
> fail fast with guidance; wire them to the repository's canonical
> build/package/deploy commands as they land (MODULE_BIN_SPEC.md §3).
`;
}

function deploymentSectionSource(moduleId) {
  return `

## Deployment Standard (bin/)

Per \`../sdkwork-specs/MODULE_BIN_SPEC.md\`, this module ships the standardized
nine-entrypoint \`bin/\` family; all build/package/deploy/installer work \`MUST\`
go through them. See \`bin/README.md\` for the usage card and
\`bin/lib/module.sh\` for the delegation wiring (hooks not yet wired to a
canonical repository command fail fast with guidance).

- App types declared: see \`SDKWORK_APP_TYPES\` in \`bin/lib/module.sh\`;
  environments: \`development\`, \`test\`, \`staging\`, \`demo\`, \`production\`.
- Image reference: \`registry.sdkwork.com/apps/<docker-name>:<version>\`
  (\`DOCKER_SPEC.md\` §2.1; no \`latest\`, no env-suffixed tags).
- Authoritative specs: \`MODULE_BIN_SPEC.md\`, \`DOCKER_SPEC.md\`,
  \`DEPLOYMENT_SPEC.md\`, \`OPERATIONS_SPEC.md\`.
<!-- /SDKWORK-DEPLOYMENT-STANDARD: scaffolded -->
`;
}

function detectImageName(root) {
  // 1. explicit compose image in deployments/docker
  const candidates = [
    path.join(root, 'deployments/docker/docker-compose.yml'),
    path.join(root, 'deployments/docker/bundle/compose/docker-compose.yml'),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const match = text.match(/^\s*image:\s*([A-Za-z0-9._/-]+)\s*$/m);
      if (match && !/postgres|redis|pgvector|nginx|:\s*(latest|pg)/.test(match[1])) {
        return match[1].split(':')[0];
      }
    } catch { /* ignore */ }
  }
  return null;
}

function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      root: { type: 'string', default: '.' },
      'image-name': { type: 'string' },
      'app-types': { type: 'string' },
      force: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log('Usage: node tools/scaffold-module-bin.mjs --root <module-root> [--image-name X] [--app-types a,b] [--force]');
    return;
  }
  const root = path.resolve(values.root);
  const moduleId = path.basename(root);
  if (!fs.existsSync(path.join(root, 'sdkwork.app.config.json'))) {
    console.error(`- ${moduleId}: no sdkwork.app.config.json; not an SDKWork app root, skipped`);
    process.exitCode = 1;
    return;
  }
  const imageName = values['image-name'] || detectImageName(root) || `${moduleId}-standalone`;
  let appTypes = values['app-types'];
  if (!appTypes) {
    const appsDir = path.join(root, 'apps');
    const types = ['server'];
    try {
      for (const entry of fs.readdirSync(appsDir)) {
        if (/pc$/.test(entry)) types.push('pc');
        if (/h5$/.test(entry)) types.push('h5');
        if (/flutter/.test(entry)) types.push('flutter');
        if (/desktop/.test(entry)) types.push('desktop');
      }
    } catch { /* no apps dir */ }
    appTypes = [...new Set(types)].join(',');
  }
  let hasContainerBuild = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    hasContainerBuild = Object.keys(pkg.scripts || {}).some((k) => k.startsWith('build:container'));
  } catch { /* no package.json */ }

  const created = [];
  const skipped = [];
  const binDir = path.join(root, 'bin');
  const libDir = path.join(binDir, 'lib');
  fs.mkdirSync(libDir, { recursive: true });

  const writeIf = (file, content, { force = false, executable = false } = {}) => {
    if (fs.existsSync(file) && !force) { skipped.push(path.relative(root, file)); return; }
    fs.writeFileSync(file, content);
    if (executable) fs.chmodSync(file, 0o755);
    created.push(path.relative(root, file));
  };

  for (const [script, comment] of WRAPPERS) {
    writeIf(path.join(binDir, script), wrapperSource(script.replace(/\.sh$/, ''), comment), { force: values.force, executable: true });
  }
  writeIf(path.join(libDir, 'bootstrap.sh'), BOOTSTRAP, { force: values.force, executable: true });

  const moduleSh = path.join(libDir, 'module.sh');
  if (fs.existsSync(moduleSh)) {
    skipped.push('bin/lib/module.sh (exists; never overwritten)');
  } else {
    fs.writeFileSync(moduleSh, moduleShSource({ moduleId, imageName, appTypes, hasContainerBuild }));
    fs.chmodSync(moduleSh, 0o755);
    created.push('bin/lib/module.sh');
  }

  writeIf(path.join(binDir, 'README.md'), readmeSource({ moduleId, appTypes, imageName }), { force: values.force });

  const agentsPath = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    const agents = fs.readFileSync(agentsPath, 'utf8');
    if (!agents.includes('Deployment Standard (bin/)')) {
      fs.appendFileSync(agentsPath, deploymentSectionSource(moduleId));
      created.push('AGENTS.md (deployment section appended)');
    } else {
      skipped.push('AGENTS.md (deployment section present)');
    }
  } else {
    skipped.push('AGENTS.md (missing; skipped)');
  }

  console.log(`${moduleId}: created ${created.length}, skipped ${skipped.length}`);
  for (const item of created) console.log(`  + ${item}`);
  for (const item of skipped) console.log(`  = ${item}`);
}

main();
