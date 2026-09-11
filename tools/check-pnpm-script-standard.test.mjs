import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';

const CHECKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-pnpm-script-standard.mjs');

function makeRepo(manifest, { includeStop = true, normalizeDevProfiles = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-pnpm-script-standard-'));
  const normalizedManifest = {
    ...manifest,
    scripts: { ...manifest.scripts },
  };
  if (normalizeDevProfiles && normalizedManifest.scripts.dev) {
    normalizedManifest.scripts.dev = 'pnpm dev:standalone';
    normalizedManifest.scripts['dev:standalone'] ??=
      'node scripts/sdkwork-command.mjs dev --deployment-profile standalone --environment development';
    normalizedManifest.scripts['dev:cloud'] ??=
      'node scripts/sdkwork-command.mjs dev --deployment-profile cloud --environment development';
  }
  if (includeStop && normalizedManifest.scripts.dev && !normalizedManifest.scripts.stop) {
    normalizedManifest.scripts.stop = 'node scripts/sdkwork-stop.mjs';
  }
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(normalizedManifest, null, 2)}\n`);
  return root;
}

function runChecker(root, productPrefix = 'demo') {
  return spawnSync(
    process.execPath,
    [CHECKER, '--root', root, '--application-code-prefix', productPrefix],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  );
}

function runCheckerJson(root, productPrefix = 'demo') {
  return spawnSync(
    process.execPath,
    [CHECKER, '--root', root, '--json', '--application-code-prefix', productPrefix],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  );
}

function runCheckerWorkspace(workspaceRoot) {
  return spawnSync(
    process.execPath,
    [CHECKER, '--workspace', workspaceRoot, '--json'],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  );
}

// The canonical compliant root shape: every required root script plus the
// scoped stop command. Derived from makeRepo's normalization so fleet children
// are audited on exactly the same contract as single-repository fixtures.
function writeCompliantRoot(workspaceRoot, name) {
  const root = path.join(workspaceRoot, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name,
      scripts: {
        dev: 'pnpm dev:standalone',
        'dev:standalone': 'node scripts/sdkwork-command.mjs dev --deployment-profile standalone --environment development',
        'dev:cloud': 'node scripts/sdkwork-command.mjs dev --deployment-profile cloud --environment development',
        stop: 'node scripts/sdkwork-stop.mjs',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    }, null, 2)}\n`,
  );
  return root;
}

function canonicalAssemblyCommand(root, toolName) {
  const toolPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), toolName);
  const relative = path.relative(root, toolPath).replaceAll('\\', '/');
  const commandPath = path.isAbsolute(relative) || /^[a-z]:\//iu.test(relative)
    ? relative
    : relative.startsWith('.') ? relative : `./${relative}`;
  return `node ${commandPath} --root .`;
}

function writeApplicationManifest(root) {
  writeFileSync(path.join(root, 'sdkwork.app.config.json'), '{}\n');
}

function writeAssemblyScripts(root, commands = {}) {
  const packagePath = path.join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  manifest.scripts['api:assembly:materialize'] = commands.materialize
    ?? canonicalAssemblyCommand(root, 'materialize-api-assembly.mjs');
  manifest.scripts['api:assembly:validate'] = commands.validate
    ?? canonicalAssemblyCommand(root, 'validate-api-assembly.mjs');
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

describe('check-pnpm-script-standard', () => {
  it('keeps the allowed first-segment list identical to PNPM_SCRIPT_SPEC.md', async () => {
    const { ALLOWED_FIRST_SEGMENTS } = await import('./check-pnpm-script-standard.mjs');
    const spec = readFileSync(
      path.resolve(path.dirname(CHECKER), '..', 'PNPM_SCRIPT_SPEC.md'),
      'utf8',
    );
    const block = spec.match(/Allowed command or namespace first segments:\s*```text\n([\s\S]*?)```/u);
    assert.ok(block, 'PNPM_SCRIPT_SPEC.md must list the allowed first segments in a text fence');
    const specSegments = block[1].split('\n').map((entry) => entry.trim()).filter(Boolean);

    // A name allowed by only the standard or only the checker is how a rule ends
    // up occupying the contract slot while enforcing something unauthorized, or
    // authorizing something no gate reads. Both directions are defects.
    assert.deepEqual(
      [...ALLOWED_FIRST_SEGMENTS],
      specSegments,
      'the checker and PNPM_SCRIPT_SPEC.md allowed first-segment lists must match in content and order',
    );
  });

  it('rejects a development root without a scoped stop command', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    }, { includeStop: false });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /roots with dev must expose a scoped stop command/);
  });

  it('accepts a repository root with canonical scripts', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pnpm script standard ok/);
  });

  it('accepts standard npm lifecycle hooks without treating them as public namespaces', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        predev: 'node scripts/preflight.mjs',
        build: 'node scripts/sdkwork-command.mjs build',
        prebuild: 'node scripts/preflight.mjs',
        test: 'node scripts/sdkwork-command.mjs test',
        pretest: 'node scripts/generate.mjs',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        prepublishOnly: 'pnpm verify',
      },
    });

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('does not impose application runtime commands on a declared node package root', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        build: 'tsc',
        test: 'node --test',
      },
    }, { normalizeDevProfiles: false });
    mkdirSync(path.join(root, 'specs'));
    writeFileSync(path.join(root, 'specs', 'component.spec.json'), JSON.stringify({
      kind: 'sdkwork.component.spec',
      component: { type: 'node-package' },
    }));
    writeFileSync(path.join(root, 'sdkwork.app.config.json'), JSON.stringify({
      kind: 'sdkwork.app',
      runtime: { family: 'web' },
    }));

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('does not impose application runtime commands on a non-application repository kind', () => {
    const root = makeRepo({
      name: '@sdkwork/shared-tools',
      scripts: {
        build: 'tsc',
        test: 'node --test',
      },
    }, { normalizeDevProfiles: false });
    writeFileSync(
      path.join(root, 'README.md'),
      '# Shared tools\n\nrepository-kind: foundation-dependency\n',
    );

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('keeps explicit application repository kinds on the complete lifecycle contract', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        build: 'tsc',
        test: 'node --test',
      },
    }, { normalizeDevProfiles: false });
    writeFileSync(
      path.join(root, 'README.md'),
      '# Demo\n\nrepository-kind: legacy-application\n',
    );

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required root script "dev"/u);
    assert.match(result.stderr, /missing required root script "verify"/u);
    assert.match(result.stderr, /missing required root script "clean"/u);
  });

  it('reports lifecycle debt instead of crashing on a malformed optional app manifest', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        build: 'tsc',
        test: 'node --test',
      },
    }, { normalizeDevProfiles: false });
    writeFileSync(path.join(root, 'sdkwork.app.config.json'), '');

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required root script "dev"/u);
    assert.doesNotMatch(result.stderr, /SyntaxError|Unexpected end of JSON input/u);
  });

  it('requires API assembly commands for an application root without HTTP routes', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeFileSync(path.join(root, 'sdkwork.app.config.json'), '{}\n');

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required API assembly script "api:assembly:materialize"/u);
    assert.match(result.stderr, /missing required API assembly script "api:assembly:validate"/u);
  });

  it('accepts direct canonical API assembly commands for an application root', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeApplicationManifest(root);
    writeAssemblyScripts(root);

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects application-owned API assembly wrappers', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeApplicationManifest(root);
    writeAssemblyScripts(root, {
      materialize: 'node scripts/gateway/assembly-materialize.mjs',
      validate: 'node scripts/gateway/assembly-validate.mjs',
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /api:assembly:materialize: must directly invoke the canonical sdkwork-specs tool/u);
    assert.match(result.stderr, /api:assembly:validate: must directly invoke the canonical sdkwork-specs tool/u);
    assert.match(result.stderr, /application-owned wrappers are forbidden/u);
  });

  it('rejects API assembly commands that invoke the wrong canonical tool', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeApplicationManifest(root);
    writeAssemblyScripts(root, {
      materialize: canonicalAssemblyCommand(root, 'validate-api-assembly.mjs'),
      validate: canonicalAssemblyCommand(root, 'materialize-api-assembly.mjs'),
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /api:assembly:materialize: must directly invoke the canonical sdkwork-specs tool/u);
    assert.match(result.stderr, /api:assembly:validate: must directly invoke the canonical sdkwork-specs tool/u);
  });

  it('treats a component deployment as a delegated app surface instead of an independent API root', () => {
    const root = makeRepo({
      name: 'sdkwork-demo-pc',
      // A component deployment invokes the same facade, so section 2 requires it
      // to declare the pinned dependency exactly like an independent root.
      devDependencies: { '@sdkwork/app-topology': 'workspace:*' },
      scripts: {
        dev: 'pnpm dev:standalone',
        'dev:standalone': 'pnpm exec sdkwork-app dev --root ../.. --deployment-profile standalone',
        'dev:cloud': 'pnpm exec sdkwork-app dev --root ../.. --deployment-profile cloud',
        stop: 'pnpm exec sdkwork-app stop --root ../..',
      },
    }, { normalizeDevProfiles: false });
    mkdirSync(path.join(root, 'etc'), { recursive: true });
    writeFileSync(path.join(root, 'sdkwork.app.config.json'), JSON.stringify({
      kind: 'sdkwork.app',
      runtime: { family: 'desktop' },
    }));
    writeFileSync(path.join(root, 'etc', 'sdkwork.deployment.config.json'), JSON.stringify({
      kind: 'sdkwork.component-deployment',
      parentDeploymentConfig: '../../../etc/sdkwork.deployment.config.json',
      parentTopologySpec: '../../../specs/topology.spec.json',
    }));

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /API assembly/u);
  });

  it('rejects platform cloud gateway commands in application roots', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'gateway:package:cloud': 'node scripts/sdkwork-command.mjs gateway package --deployment-profile cloud',
        'gateway:cloud:bundle': 'node scripts/sdkwork-command.mjs gateway bundle --deployment-profile cloud',
        'gateway:package:platform-config': 'node scripts/sdkwork-command.mjs gateway package --deployment-profile cloud',
      },
    });

    const result = runChecker(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /application roots must not expose platform cloud gateway commands/u);
    assert.match(result.stderr, /gateway:cloud:bundle/u);
    assert.match(result.stderr, /gateway:package:platform-config/u);
  });

  it('accepts deterministic standalone/cloud development and paired release/deploy phases', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        'dev:standalone': 'node scripts/sdkwork-command.mjs dev --deployment-profile standalone --environment development',
        'dev:cloud': 'node scripts/sdkwork-command.mjs dev --deployment-profile cloud --environment development',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'release:package:standalone': 'node scripts/sdkwork-command.mjs release package --deployment-profile standalone',
        'release:package:cloud': 'node scripts/sdkwork-command.mjs release package --deployment-profile cloud',
        'deploy:plan:standalone': 'node scripts/sdkwork-command.mjs deploy plan --deployment-profile standalone',
        'deploy:plan:cloud': 'node scripts/sdkwork-command.mjs deploy plan --deployment-profile cloud',
      },
    });

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('requires only release profiles declared by fixed workflow targets', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      devDependencies: { '@sdkwork/app-topology': 'workspace:*' },
      scripts: {
        dev: 'pnpm dev:standalone',
        'dev:standalone': 'node scripts/sdkwork-command.mjs dev --deployment-profile standalone --environment development',
        'dev:cloud': 'node scripts/sdkwork-command.mjs dev --deployment-profile cloud --environment development',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'release:package:cloud': 'pnpm exec sdkwork-app release:package --deployment-profile cloud',
      },
    });
    writeFileSync(path.join(root, 'sdkwork.workflow.json'), JSON.stringify({
      targets: [{ deploymentProfile: 'cloud' }],
    }));

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('accepts private SDKWork lifecycle hooks behind the canonical public facade', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      devDependencies: { '@sdkwork/app-topology': 'workspace:*' },
      scripts: {
        dev: 'pnpm dev:standalone',
        'dev:standalone': 'pnpm exec sdkwork-app dev --deployment-profile standalone',
        'dev:cloud': 'pnpm exec sdkwork-app dev --deployment-profile cloud',
        build: 'pnpm exec sdkwork-app build',
        test: 'pnpm exec sdkwork-app test',
        check: 'pnpm exec sdkwork-app check',
        verify: 'pnpm exec sdkwork-app verify',
        clean: 'pnpm exec sdkwork-app clean',
        // Every facade lifecycle verb needs its hook: the facade returns null
        // from runPrivateLifecycleScript when the hook is absent and then
        // throws "missing private lifecycle hook". A sibling namespace hook
        // such as _sdkwork:release:* does not substitute for a lifecycle verb.
        '_sdkwork:build': 'cargo build --release',
        '_sdkwork:test': 'vitest run',
        '_sdkwork:check': 'tsc --noEmit',
        '_sdkwork:verify': 'pnpm run check && pnpm test',
        '_sdkwork:clean': 'node scripts/clean-artifacts.mjs',
        '_sdkwork:dev:standalone': 'node scripts/demo-dev.mjs --legacy-layout',
        '_sdkwork:dev:cloud': 'vite --mode cloud',
        '_sdkwork:release:package': 'node scripts/demo-package.mjs',
        '_sdkwork:runtime:device-edge': 'cargo run -p sdkwork-demo-device-edge-runtime',
      },
    });

    const result = runChecker(root);
    assert.equal(result.status, 0, result.stderr);
  });

  it('keeps edge runtimes and API gateways in distinct command namespaces', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        build: 'pnpm exec sdkwork-app build',
        test: 'pnpm exec sdkwork-app test',
        check: 'pnpm exec sdkwork-app check',
        verify: 'pnpm exec sdkwork-app verify',
        clean: 'pnpm exec sdkwork-app clean',
        'gateway:package:standalone':
          'cargo build -p sdkwork-api-demo-standalone-gateway -p sdkwork-demo-device-edge-runtime',
        '_sdkwork:runtime:device-edge':
          'cargo run -p sdkwork-api-demo-standalone-gateway',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /edge runtime targets belong to _sdkwork:runtime/u);
    assert.match(result.stderr, /API gateway targets belong to _sdkwork:gateway/u);
  });

  it('rejects malformed private SDKWork hook names', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        '_sdkwork:custom': 'node scripts/custom.mjs',
      },
    });

    const result = runChecker(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /private SDKWork hooks must use an approved _sdkwork lifecycle or topology namespace/u);
  });

  it('rejects application-private stop hooks', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        build: 'pnpm exec sdkwork-app build',
        test: 'pnpm exec sdkwork-app test',
        check: 'pnpm exec sdkwork-app check',
        verify: 'pnpm exec sdkwork-app verify',
        clean: 'pnpm exec sdkwork-app clean',
        '_sdkwork:stop': 'node scripts/stop.mjs',
      },
    });

    const result = runChecker(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /private _sdkwork:stop is forbidden/u);
  });

  it('accepts one runtime-configurable client release lane', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        'dev:standalone': 'node scripts/sdkwork-command.mjs dev --deployment-profile standalone --environment development',
        'dev:cloud': 'node scripts/sdkwork-command.mjs dev --deployment-profile cloud --environment development',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'release:package:desktop:runtime-configurable': 'node scripts/sdkwork-command.mjs release package --target desktop --profile-binding runtime-configurable',
      },
    });

    const result = runChecker(root);
    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects missing or ambiguous development profile entrypoints', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    }, { normalizeDevProfiles: false });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required root script "dev:standalone"/);
    assert.match(result.stderr, /missing required root script "dev:cloud"/);
    assert.match(result.stderr, /bare dev must directly delegate to "dev:standalone"/);
  });

  it('rejects cloud development that selects a local database', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        'dev:standalone': 'node scripts/sdkwork-command.mjs dev --deployment-profile standalone --environment development',
        'dev:cloud': 'node scripts/sdkwork-command.mjs dev --deployment-profile cloud --environment development --database postgres',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /remote cloud development must not select or bootstrap a local database/);
  });

  it('rejects target-specific cloud development scripts with a database axis', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        'dev:browser:postgres:cloud': 'node scripts/sdkwork-command.mjs dev --target browser --database postgres --deployment-profile cloud --environment development',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cloud development consumes deployed APIs and must not include a database axis/);
  });

  it('rejects profile-first lifecycle names and unpaired profile phases', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'release:cloud:package': 'node scripts/sdkwork-command.mjs release package --deployment-profile cloud',
        'release:package:cloud': 'node scripts/sdkwork-command.mjs release package --deployment-profile cloud',
        'deploy:cloud:apply': 'node scripts/sdkwork-command.mjs deploy apply --deployment-profile cloud',
        'deploy:apply:cloud': 'node scripts/sdkwork-command.mjs deploy apply --deployment-profile cloud',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release:cloud:package: use release:<phase>/);
    assert.match(result.stderr, /deploy:cloud:apply: use deploy:<phase>/);
    assert.match(result.stderr, /release:package: exposed lifecycle phase must provide a standalone profile variant/);
    assert.match(result.stderr, /deploy:apply: exposed lifecycle phase must provide a standalone profile variant/);
  });

  it('accepts UTF-8 BOM JSON command manifests', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const specsDir = path.join(root, 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(
      path.join(specsDir, 'component.spec.json'),
      `\uFEFF${JSON.stringify({ scripts: { check: 'pnpm check' } }, null, 2)}\n`,
    );

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('ignores vendored upstream package scripts', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const externalRoot = path.join(root, 'external', 'upstream');
    mkdirSync(externalRoot, { recursive: true });
    writeFileSync(
      path.join(externalRoot, 'package.json'),
      `${JSON.stringify({ scripts: { prepare: 'node upstream-build.mjs', 'dev:web': 'vite' } }, null, 2)}\n`,
    );

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('accepts browser and desktop dev defaults that delegate to postgres standalone profiles', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:browser',
        'dev:browser': 'pnpm dev:browser:postgres:standalone',
        'dev:browser:postgres:standalone': 'node scripts/demo-dev.mjs --target browser --database postgres --deployment-profile standalone',
        'dev:desktop': 'pnpm dev:desktop:postgres:standalone',
        'dev:desktop:postgres:standalone': 'node scripts/demo-dev.mjs --target desktop --database postgres --deployment-profile standalone',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects browser and desktop dev defaults that do not resolve to postgres standalone profiles', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        'dev:browser': 'node scripts/demo-dev.mjs --target browser --database sqlite --deployment-profile standalone',
        'dev:desktop': 'node scripts/demo-dev.mjs --target desktop --database postgres --deployment-profile cloud',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /dev:browser: default dev runtime must resolve to database "postgres"/,
    );
    assert.match(
      result.stderr,
      /dev:desktop: default dev runtime must resolve to deployment profile "standalone"/,
    );
  });

  it('rejects sqlite browser and server profiles while allowing explicit desktop client-local naming', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:browser',
        'dev:browser': 'pnpm dev:browser:postgres:standalone',
        'dev:browser:postgres:standalone': 'node scripts/demo-dev.mjs --target browser --database postgres --deployment-profile standalone',
        'dev:desktop': 'pnpm dev:desktop:postgres:standalone',
        'dev:desktop:postgres:standalone': 'node scripts/demo-dev.mjs --target desktop --database postgres --deployment-profile standalone',
        'dev:desktop:sqlite': 'node scripts/demo-local-data.mjs --database sqlite',
        'dev:browser:sqlite': 'node scripts/demo-dev.mjs --target browser --database sqlite',
        'dev:server:sqlite': 'node scripts/demo-dev.mjs --target server --database sqlite',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dev:browser:sqlite: sqlite is client-local/);
    assert.match(result.stderr, /dev:server:sqlite: sqlite is client-local/);
    assert.doesNotMatch(result.stderr, /dev:desktop:sqlite: sqlite is client-local/);
  });

  it('rejects retired service layout tokens in dev scripts and command values', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:browser',
        'dev:browser': 'pnpm dev:browser:postgres:split-services:standalone',
        'dev:browser:postgres:split-services:standalone': 'node scripts/demo-dev.mjs --target browser --database postgres --service-layout split-services --deployment-profile standalone',
        'dev:desktop': 'node scripts/demo-dev.mjs --target desktop --database postgres --service-layout unified-process --deployment-profile standalone',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /dev:browser:postgres:split-services:standalone: retired token "split-services" must not appear in public scripts/,
    );
    assert.match(
      result.stderr,
      /dev:desktop: command value uses retired deployment token "service-layout"/,
    );
  });

  it('rejects browser and desktop dev defaults that use retired hosting flags', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        'dev:browser': 'node scripts/demo-dev.mjs --target browser --database postgres --hosting self-hosted',
        'dev:desktop': 'node scripts/demo-dev.mjs --target desktop --database postgres --hosting cloud-hosted',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /dev:browser: default dev runtime must use --deployment-profile standalone instead of retired --hosting/,
    );
    assert.match(
      result.stderr,
      /dev:desktop: default dev runtime must use --deployment-profile standalone instead of retired --hosting/,
    );
  });

  it('rejects retired deployment flags in root script command values', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build --hosting self-hosted',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'release:package': 'node scripts/release.mjs --deploymentMode cloud-hosted',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /build: command value uses retired deployment token "--hosting"/,
    );
    assert.match(
      result.stderr,
      /release:package: command value uses retired deployment token "deploymentMode"/,
    );
  });

  it('rejects missing required root scripts', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required root script "build"/);
    assert.match(result.stderr, /missing required root script "verify"/);
  });

  it('rejects application-code-prefixed public scripts and gateway profile-first names', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'demo:dev': 'node scripts/demo-dev.mjs',
        'gateway:cloud:bundle': 'node scripts/gateway-cloud-bundle.mjs bundle',
      },
    });

    const result = runChecker(root, 'demo');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /demo:dev: first segment "demo" is not a standard public namespace/);
    assert.match(result.stderr, /demo:dev: application-code-prefixed public root scripts are forbidden/);
    assert.match(result.stderr, /gateway:cloud:bundle: use gateway:<action>\[:deploymentProfile\]/);
  });

  it('accepts desktop host family commands', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'desktop:dev': 'pnpm dev:desktop',
        'desktop:build': 'pnpm build:desktop',
        'desktop:dev:electron': 'pnpm dev:desktop:electron',
        'desktop:check': 'pnpm check:tauri-config',
      },
    });

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects nonstandard desktop host family actions and tool-first aliases', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'desktop:foo': 'pnpm dev:desktop',
        'desktop:dev:native-host': 'tauri dev',
        'tauri:dev': 'pnpm dev:desktop',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /desktop:foo: use action-first runtime target script names such as foo:desktop/,
    );
    assert.match(
      result.stderr,
      /desktop:dev:native-host: use action-first runtime target script names such as dev:desktop/,
    );
    assert.match(
      result.stderr,
      /tauri:dev: use action-first runtime target script names such as dev:desktop/,
    );
  });

  it('rejects tauri as a runtime target suffix in public script names', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'dev:tauri': 'pnpm dev:desktop',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /dev:tauri: use runtime target "desktop" instead of tool alias "tauri", for example dev:desktop/,
    );
  });

  it('rejects nonstandard dev runtime target suffixes in root scripts', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:browser',
        'dev:browser': 'pnpm dev:browser:postgres:standalone',
        'dev:browser:postgres:standalone': 'node scripts/demo-dev.mjs --target browser --database postgres --deployment-profile standalone',
        'dev:desktop': 'pnpm dev:desktop:postgres:standalone',
        'dev:desktop:postgres:standalone': 'node scripts/demo-dev.mjs --target desktop --database postgres --deployment-profile standalone',
        'dev:portal': 'node scripts/demo-dev.mjs --target browser-only',
        'dev:service': 'node scripts/demo-dev.mjs --target service',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /dev:portal: "portal" is not a standard dev runtime target; use one of/,
    );
    assert.match(
      result.stderr,
      /dev:service: "service" is not a standard dev runtime target; use one of/,
    );
  });

  it('rejects mobile, mini-program, and container platform-first root command aliases', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'android:build': 'gradle build',
        'flutter:dev': 'flutter run',
        'mini-program:build': 'node scripts/build-mini-program.mjs',
        'docker:build': 'docker build .',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /android:build: use action-first runtime target script names such as build:android-native/,
    );
    assert.match(
      result.stderr,
      /flutter:dev: use action-first runtime target script names such as dev:flutter-android/,
    );
    assert.match(
      result.stderr,
      /mini-program:build: use action-first runtime target script names such as build:mini-program/,
    );
    assert.match(
      result.stderr,
      /docker:build: use action-first runtime target script names such as build:container/,
    );
  });

  it('ignores generated package manifests while scanning local packages', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const generatedDir = path.join(root, 'sdks/demo/generated/server-openapi');
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(
      path.join(generatedDir, 'package.json'),
      `${JSON.stringify({ name: 'generated', scripts: { 'demo:dev': 'vite' } }, null, 2)}\n`,
    );

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects package-local scripts that keep retired public namespaces', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const appDir = path.join(root, 'apps/demo-pc');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'package.json'),
      `${JSON.stringify({ name: 'demo-pc', scripts: { 'product:check': 'pnpm typecheck && pnpm build' } }, null, 2)}\n`,
    );

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /apps[/\\]demo-pc[/\\]package\.json#product:check: first segment "product" is not a standard local namespace/,
    );
  });

  it('rejects retired deployment flags in package-local command values', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const appDir = path.join(root, 'apps/demo-pc');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'package.json'),
      `${JSON.stringify({ name: 'demo-pc', scripts: { dev: 'vite --hosting cloud-hosted' } }, null, 2)}\n`,
    );

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /apps[/\\]demo-pc[/\\]package\.json#dev: command value uses retired deployment token "--hosting"/,
    );
  });

  it('rejects package-local non-desktop platform-first runtime command aliases', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const appDir = path.join(root, 'apps/demo-pc');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'package.json'),
      `${JSON.stringify({ name: 'demo-pc', scripts: { 'browser:dev': 'vite', 'desktop:build': 'pnpm build:desktop' } }, null, 2)}\n`,
    );

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /apps[/\\]demo-pc[/\\]package\.json#browser:dev: use action-first runtime target script names such as dev:browser/,
    );
    assert.doesNotMatch(
      result.stderr,
      /apps[/\\]demo-pc[/\\]package\.json#desktop:build/,
    );
  });

  it('rejects nonstandard dev runtime target suffixes in package-local scripts', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const appDir = path.join(root, 'apps/demo-pc');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'package.json'),
      `${JSON.stringify({ name: 'demo-pc', scripts: { 'dev:service': 'node service.mjs', 'dev:desktop:native-host': 'tauri dev' } }, null, 2)}\n`,
    );

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /apps[/\\]demo-pc[/\\]package\.json#dev:service: "service" is not a standard dev runtime target/,
    );
    assert.match(
      result.stderr,
      /apps[/\\]demo-pc[/\\]package\.json#dev:desktop:native-host: "native-host" is not a standard dev axis value/,
    );
  });

  it('rejects package-local mobile and mini-program platform-first command aliases', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const appDir = path.join(root, 'apps/demo-mobile');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'package.json'),
      `${JSON.stringify({ name: 'demo-mobile', scripts: { 'ios:build': 'xcodebuild', 'harmony:dev': 'hvigorw', 'mini-program:build': 'node scripts/mp.mjs' } }, null, 2)}\n`,
    );

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /apps[/\\]demo-mobile[/\\]package\.json#ios:build: use action-first runtime target script names such as build:ios-native/,
    );
    assert.match(
      result.stderr,
      /apps[/\\]demo-mobile[/\\]package\.json#harmony:dev: use action-first runtime target script names such as dev:harmony-native/,
    );
    assert.match(
      result.stderr,
      /apps[/\\]demo-mobile[/\\]package\.json#mini-program:build: use action-first runtime target script names such as build:mini-program/,
    );
  });

  it('accepts package-local maintenance helper scripts', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const appDir = path.join(root, 'apps/demo-pc');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'package.json'),
      `${JSON.stringify({ name: 'demo-pc', scripts: { 'deps:check': 'node scripts/check-deps.mjs' } }, null, 2)}\n`,
    );

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects nonstandard pnpm command examples in markdown docs', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeFileSync(
      path.join(root, 'README.md'),
      [
        '# Demo',
        '',
        '- Use `pnpm demo:dev` for local development.',
        '- Use `pnpm server:dev` for backend-only development.',
        '- Use `pnpm gateway:cloud:bundle` for cloud packaging.',
      ].join('\n'),
    );

    const result = runChecker(root, 'demo');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /README\.md:3: pnpm demo:dev: application-code-prefixed command examples are forbidden/);
    assert.match(result.stderr, /README\.md:4: pnpm server:dev: first segment "server" is not a standard public namespace/);
    assert.match(result.stderr, /README\.md:5: pnpm gateway:cloud:bundle: use gateway:<action>\[:deploymentProfile\]/);
  });

  it('rejects retired deployment flags in markdown pnpm command examples', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeFileSync(
      path.join(root, 'README.md'),
      [
        '# Demo',
        '',
        '- Use `pnpm dev:browser -- --hosting self-hosted` for local development.',
      ].join('\n'),
    );

    const result = runChecker(root, 'demo');

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /README\.md:3: pnpm dev:browser: command example uses retired deployment token "--hosting"/,
    );
  });

  it('rejects nonstandard pnpm commands in active command json files', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'api:assembly:materialize': 'node tools/materialize.mjs',
        'api:assembly:validate': 'node tools/validate.mjs',
      },
    });
    writeFileSync(
      path.join(root, 'sdkwork.app.config.json'),
      `${JSON.stringify({ devApp: { build: { targets: [{ command: 'pnpm demo:build' }, { command: 'pnpm tauri:dev' }] } } }, null, 2)}\n`,
    );
    const specsDir = path.join(root, 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(
      path.join(specsDir, 'topology.spec.json'),
      `${JSON.stringify({ scripts: { pnpm: { portal: { script: 'pnpm browser:dev' } } } }, null, 2)}\n`,
    );
    writeAssemblyScripts(root);

    const result = runChecker(root, 'demo');

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /sdkwork\.app\.config\.json: devApp\.build\.targets\.0\.command: pnpm demo:build: application-code-prefixed command examples are forbidden/,
    );
    assert.match(
      result.stderr,
      /sdkwork\.app\.config\.json: devApp\.build\.targets\.1\.command: pnpm tauri:dev: use action-first runtime target script names such as dev:desktop/,
    );
    assert.match(
      result.stderr,
      /specs[/\\]topology\.spec\.json: scripts\.pnpm\.portal\.script: pnpm browser:dev: use action-first runtime target script names such as dev:browser/,
    );
  });

  it('rejects retired deployment flags in active command json files', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeFileSync(
      path.join(root, 'sdkwork.workflow.json'),
      `${JSON.stringify({ targets: [{ command: 'pnpm dev:desktop -- --hosting cloud-hosted' }] }, null, 2)}\n`,
    );

    const result = runChecker(root, 'demo');

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /sdkwork\.workflow\.json: targets\.0\.command: pnpm dev:desktop: command example uses retired deployment token "--hosting"/,
    );
  });

  it('rejects nonstandard pnpm commands in active runner scripts', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const scriptsDir = path.join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(scriptsDir, 'dev.mjs'),
      [
        'const args = ["--dir", "apps/demo-pc", "browser:dev"];',
        'const command = "pnpm server:dev";',
        'const legacy = ["demo:dev"];',
      ].join('\n'),
    );

    const result = runChecker(root, 'demo');

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /scripts[/\\]dev\.mjs:1: pnpm browser:dev: use action-first runtime target script names such as dev:browser/,
    );
    assert.match(
      result.stderr,
      /scripts[/\\]dev\.mjs:2: pnpm server:dev: first segment "server" is not a standard public namespace/,
    );
    assert.match(
      result.stderr,
      /scripts[/\\]dev\.mjs:3: pnpm demo:dev: application-code-prefixed command examples are forbidden/,
    );
  });

  it('ignores non-command colon strings in active runner scripts', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const scriptsDir = path.join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(scriptsDir, 'dev.mjs'),
      [
        "import fs from 'node:fs';",
        "const now = '2026-01-01T00:00:00Z';",
        "const schema = 'https://example.test/schema:sdkwork';",
        "const standardScript = 'dev:desktop';",
      ].join('\n'),
    );

    const result = runChecker(root, 'demo');

    assert.equal(result.status, 0, result.stderr);
  });

  it('ignores native pnpm commands in markdown docs', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeFileSync(
      path.join(root, 'README.md'),
      [
        '# Demo',
        '',
        '- Install with `pnpm install`.',
        '- Add packages with `pnpm add @sdkwork/demo`.',
        '- Run a binary with `pnpm exec sdkgen --help`.',
        '- Requires pnpm 10.x.',
      ].join('\n'),
    );

    const result = runChecker(root, 'demo');

    assert.equal(result.status, 0, result.stderr);
  });

  it('ignores prose that describes pnpm command standards without naming a script', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeFileSync(
      path.join(root, 'AGENTS.md'),
      [
        '# Repository Guidelines',
        '',
        '- pnpm command changes follow `../sdkwork-specs/PNPM_SCRIPT_SPEC.md`.',
        '- Use canonical root pnpm commands from `PNPM_SCRIPT_SPEC.md`.',
        '- pnpm workspace configuration is owned by `pnpm-workspace.yaml`.',
        '- `pnpm check:pnpm-script-standard`: validate pnpm command standardization.',
      ].join('\n'),
    );

    const result = runChecker(root, 'demo');

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects application cloud gateway commands and requires API assembly commands for route owners', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        'gateway:run:cloud': 'cargo run -p sdkwork-api-cloud-gateway',
      },
    });
    writeFileSync(
      path.join(root, 'Cargo.toml'),
      '[workspace]\nmembers = ["crates/sdkwork-routes-demo-app-api"]\n',
    );

    const result = runChecker(root, 'demo');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not expose platform cloud gateway commands/u);
    assert.match(result.stderr, /missing required API assembly script "api:assembly:materialize"/u);
    assert.match(result.stderr, /missing required API assembly script "api:assembly:validate"/u);
  });

  it('does not fabricate a command by joining separate inline code spans', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeFileSync(
      path.join(root, 'README.md'),
      [
        '# Demo',
        '',
        '`pnpm.cmd` should be used on Windows if PowerShell blocks `pnpm.ps1`.',
        '',
        '- `pnpm` and `cargo` verification commands listed above pass.',
        '- Recover access through the root `pnpm` commands; the default `target/dev/demo.sqlite` database is used.',
        '- `commandPathPrepend` prepends `pnpm` / `npm` / `yarn` to `PATH`.',
        '',
      ].join('\n'),
    );

    const result = runChecker(root, 'demo');

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects a nonstandard command inside a single inline code span', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeFileSync(
      path.join(root, 'README.md'),
      ['# Demo', '', '- Run `pnpm dev:web` to start the browser target.', ''].join('\n'),
    );

    const result = runChecker(root, 'demo');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /README\.md:3: pnpm dev:web: "web" is not a standard dev runtime target/u);
  });

  it('ignores pnpm references in comment-only lines of runner scripts', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const scriptsDir = path.join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(scriptsDir, 'prose.mjs'),
      [
        '#!/usr/bin/env node',
        '// Prose in a comment is not a command reference:',
        '//   pnpm would then fail, pnpm cannot run, pnpm keeps going.',
        '/**',
        ' * A docstring that names the words it suppresses — "pnpm would",',
        ' * "pnpm cannot", "pnpm keeps" — is still only a comment.',
        ' */',
        "const install = 'pnpm install';",
      ].join('\n'),
    );

    const result = runChecker(root, 'demo');

    assert.equal(result.status, 0, result.stderr);
  });

  it('still scans a code line that carries a trailing comment', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const scriptsDir = path.join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(scriptsDir, 'legacy.mjs'),
      ["const command = 'pnpm server:dev'; // retired alias kept during migration", ''].join('\n'),
    );

    const result = runChecker(root, 'demo');

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /scripts[/\\]legacy\.mjs:1: pnpm server:dev: first segment "server" is not a standard public namespace/u,
    );
  });

  it('keeps stdout machine-readable when a runner script is exempted', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'node scripts/sdkwork-command.mjs dev',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    const scriptsDir = path.join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(scriptsDir, 'rename-map.mjs'),
      [
        '// @sdkwork-script-standard-exempt retired-name-migration',
        "const renameMap = { 'demo:dev': 'dev:browser', 'demo:build': 'build' };",
        '',
      ].join('\n'),
    );

    const result = runCheckerJson(root, 'demo');
    // Parsing is the assertion: an exemption note written to stdout would make
    // the fleet runner read no report at all and silently pass the repository.
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true, result.stderr);
    assert.match(result.stderr, /runner script standard exemption: scripts[/\\]rename-map\.mjs/u);
  });

  it('aggregates a workspace fleet and fails when any repository fails', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-pnpm-fleet-'));
    writeCompliantRoot(workspaceRoot, 'sdkwork-good');
    const bad = writeCompliantRoot(workspaceRoot, 'sdkwork-bad');
    writeFileSync(
      path.join(bad, 'README.md'),
      ['# Bad', '', '- Run `pnpm dev:web` to start the browser target.', ''].join('\n'),
    );

    const result = runCheckerWorkspace(workspaceRoot);
    const report = JSON.parse(result.stdout);

    assert.notEqual(result.status, 0);
    assert.equal(report.repositories, 2);
    assert.equal(report.passed, 1);
    assert.equal(report.failed, 1);

    const good = report.reports.find((entry) => entry.repository === 'sdkwork-good');
    const failing = report.reports.find((entry) => entry.repository === 'sdkwork-bad');
    assert.equal(good.ok, true, JSON.stringify(good.issues));
    assert.equal(failing.ok, false);
    assert.deepEqual(failing.issues.map((issue) => issue.scope), ['documentation-examples']);
  });

  it('does not validate local AI workspace metadata as shipped documentation', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    // `.workbuddy/` and `.sdkwork/` are per-machine AI workspace directories:
    // git-ignored, never tracked, and full of prose that names command
    // placeholders. Their contents describe what an agent did, not the
    // standard, so validating them yields unactionable findings.
    mkdirSync(path.join(root, '.workbuddy', 'memory'), { recursive: true });
    writeFileSync(
      path.join(root, '.workbuddy', 'memory', '2026-09-11.md'),
      ['Follow `pnpm run somePlaceholder` in prose.', ''].join('\n'),
    );
    mkdirSync(path.join(root, '.sdkwork'), { recursive: true });
    writeFileSync(path.join(root, '.sdkwork', 'note.md'), 'Also `pnpm run otherPlaceholder`.\n');

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('still validates command examples inside shipped documentation', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
      },
    });
    writeFileSync(path.join(root, 'RUNBOOK.md'), 'Start with `pnpm dev:web`.\n');

    const result = runChecker(root);

    // The ignore rule must not disarm the scan for real documents.
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /documentation pnpm command examples are not compliant/u);
  });

  // PNPM_SCRIPT_SPEC.md section 2: the facade owns the public verb, the private
  // hook owns the tool command, and the two form a required pair. The facade
  // aborts with "missing private lifecycle hook" when the hook is absent, so
  // accepting a hook-less delegation would let the gate bless a script that
  // cannot run -- the "occupies the contract slot while enforcing nothing"
  // defect class, inverted.
  function facadeManifest({ hookName = 'build', includeHook = true, dependency = 'workspace:*' } = {}) {
    const manifest = {
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        'dev:standalone': 'pnpm exec sdkwork-app dev --deployment-profile standalone',
        'dev:cloud': 'pnpm exec sdkwork-app dev --deployment-profile cloud',
        stop: 'pnpm exec sdkwork-app stop',
        build: 'pnpm exec sdkwork-app build',
        test: 'pnpm exec sdkwork-app test',
        check: 'pnpm exec sdkwork-app check',
        verify: 'pnpm exec sdkwork-app verify',
        clean: 'pnpm exec sdkwork-app clean',
      },
    };
    if (includeHook) {
      for (const verb of ['build', 'test', 'check', 'verify', 'clean']) {
        manifest.scripts[`_sdkwork:${verb}`] = `node scripts/${verb}.mjs`;
      }
    }
    if (dependency !== null) {
      manifest.devDependencies = { '@sdkwork/app-topology': dependency };
    }
    return manifest;
  }

  it('accepts the canonical public verb plus private hook pairing', () => {
    const root = makeRepo(facadeManifest());

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects a facade delegation whose private lifecycle hook is missing', () => {
    const manifest = facadeManifest({ includeHook: false });
    // Keep every hook except the one under test, so the failure is attributable.
    for (const verb of ['test', 'check', 'verify', 'clean']) {
      manifest.scripts[`_sdkwork:${verb}`] = `node scripts/${verb}.mjs`;
    }
    const root = makeRepo(manifest);

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /build: public command delegates to the sdkwork-app facade/u);
    assert.match(result.stderr, /_sdkwork:build/u);
  });

  it('rejects a private lifecycle hook that no public command selects', () => {
    const root = makeRepo({
      name: 'sdkwork-demo',
      scripts: {
        dev: 'pnpm dev:standalone',
        'dev:standalone': 'node scripts/sdkwork-command.mjs dev --deployment-profile standalone',
        'dev:cloud': 'node scripts/sdkwork-command.mjs dev --deployment-profile cloud',
        stop: 'node scripts/sdkwork-stop.mjs',
        build: 'node scripts/sdkwork-command.mjs build',
        test: 'node scripts/sdkwork-command.mjs test',
        check: 'node scripts/sdkwork-command.mjs check',
        verify: 'node scripts/sdkwork-command.mjs verify',
        clean: 'node scripts/sdkwork-command.mjs clean',
        '_sdkwork:build': 'tsc && vite build',
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /_sdkwork:build: private lifecycle hook is not selected/u);
  });

  it('does not mistake a namespaced facade surface for the lifecycle verb', () => {
    // `sdkwork-app build:pc` is a different command surface; only the bare verb
    // is the canonical lifecycle delegation, so no hook is required for it.
    const manifest = facadeManifest({ includeHook: false });
    for (const verb of ['test', 'check', 'verify', 'clean']) {
      manifest.scripts[`_sdkwork:${verb}`] = `node scripts/${verb}.mjs`;
    }
    manifest.scripts.build = 'pnpm exec sdkwork-app build:pc';
    const root = makeRepo(manifest);

    const result = runChecker(root);

    assert.doesNotMatch(result.stderr, /_sdkwork:build/u);
  });

  it('rejects invoking the facade without declaring @sdkwork/app-topology', () => {
    const root = makeRepo(facadeManifest({ dependency: null }));

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not declare "@sdkwork\/app-topology"/u);
  });

  it('rejects an unpinned @sdkwork/app-topology dependency', () => {
    const root = makeRepo(facadeManifest({ dependency: 'latest' }));

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be pinned to a workspace or release version/u);
  });
});
