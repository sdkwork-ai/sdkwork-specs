import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// Resolve the checker relative to this test file, not the caller's cwd: the
// suite must behave the same whether it is run from `sdkwork-specs/` or from
// the workspace root via a `node --test sdkwork-specs/tools/...` invocation.
const CHECKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-agent-workflow-standard.mjs');

function write(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text);
}

function makeRepo(options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-agent-workflow-standard-'));
  const specsRoot = path.join(path.dirname(root), 'sdkwork-specs');
  mkdirSync(specsRoot, { recursive: true });
  write(specsRoot, 'README.md', '# SDKWork Standards\n');
  write(specsRoot, 'SOUL.md', '# SDKWork Agent Soul\n');
  write(specsRoot, 'AGENTS_SPEC.md', '# AGENTS.md Standard\n');

  write(root, 'sdkwork.workflow.json', JSON.stringify({
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: {
      id: 'sdkwork-demo',
      name: 'SDKWork Demo',
      repository: 'sdkwork-ai/sdkwork-demo',
      sourcePath: '.',
      configPath: 'sdkwork.app.config.json',
    },
    release: {
      artifactPrefix: 'sdkwork-demo',
      defaultVersion: '0.1.0',
      changelog: { source: 'auto' },
    },
    dependencies: [
      {
        id: 'sdkwork-web-framework',
        repository: 'sdkwork-ai/sdkwork-web-framework',
        ref: 'main',
        refInput: 'SDKWORK_WEB_FRAMEWORK_REF',
        tokenSecret: 'SDKWORK_RELEASE_TOKEN',
      },
    ],
    lifecycle: {
      build: [
        { name: 'Verify', shell: 'node', run: 'console.log(process.env.SDKWORK_PACKAGE_ID)' },
      ],
    },
    targets: [
      {
        id: 'linux-x64-standalone-server-tar-gz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/release/*'],
        deploymentProfile: 'standalone',
        runtimeTarget: 'server',
      },
    ],
    security: {
      artifactAttestations: true,
      sbomRequired: false,
      signingRequired: false,
    },
    publish: {
      workflowArtifact: true,
      githubRelease: true,
    },
  }, null, 2));

  write(root, '.github/workflows/package.yml', [
    'name: Package Application',
    'on:',
    '  push:',
    '    tags:',
    "      - 'v*'",
    '  release:',
    '    types: [published]',
    '  workflow_dispatch:',
    '    inputs:',
    '      tag:',
    '        required: false',
    '      package_version:',
    '        required: false',
    '      platform:',
    '        required: true',
    '        default: all',
    '      architecture:',
    '        required: true',
    '        default: all',
    '      profile:',
    '        required: true',
    '        default: all',
    '      format:',
    '        required: true',
    '        default: all',
    '      sdkwork_web_framework_ref:',
    '        required: false',
    '        default: main',
    'permissions:',
    '  contents: write',
    '  actions: read',
    '  id-token: write',
    '  attestations: write',
    'jobs:',
    '  package:',
    '    uses: sdkwork-ai/sdkwork-github-workflow/.github/workflows/sdkwork-package.yml@b0829529b9277a3da32b90c2d36ff34ff09fa832',
    '    with:',
    '      config_path: sdkwork.workflow.json',
    "      tag: ${{ github.event.inputs.tag || github.event.release.tag_name || github.ref_name }}",
    "      package_version: ${{ github.event.inputs.package_version || '' }}",
    "      platform: ${{ github.event.inputs.platform || 'all' }}",
    "      architecture: ${{ github.event.inputs.architecture || 'all' }}",
    "      profile: ${{ github.event.inputs.profile || 'all' }}",
    "      format: ${{ github.event.inputs.format || 'all' }}",
    '      framework_ref: b0829529b9277a3da32b90c2d36ff34ff09fa832',
    '      dependency_refs_json: >-',
    '        {',
    '          "SDKWORK_WEB_FRAMEWORK_REF": "${{ github.event.inputs.sdkwork_web_framework_ref || vars.SDKWORK_WEB_FRAMEWORK_REF }}"',
    '        }',
    '    secrets: inherit',
    '',
  ].join('\n'));

  write(root, 'AGENTS.md', [
    '# Repository Guidelines',
    '',
    '## SDKWORK Soul',
    '',
    'Read `../sdkwork-specs/SOUL.md` before executing tasks.',
    '',
    '## SDKWORK Standards',
    '',
    '- `../sdkwork-specs/README.md`',
    '- `../sdkwork-specs/SOUL.md`',
    '- `../sdkwork-specs/AGENTS_SPEC.md`',
    '- `../sdkwork-specs/PNPM_SCRIPT_SPEC.md`',
    '- `../sdkwork-specs/GITHUB_WORKFLOW_SPEC.md`',
    '',
    '## Application Identity',
    '',
    'Read `sdkwork.app.config.json` when the task touches application behavior, runtime config, SDK wiring, release metadata, or app capabilities.',
    '',
    '## Local Dictionary Structure',
    '',
    '- `AGENTS.md`: local agent entrypoint.',
    '- `sdkwork.workflow.json`: GitHub packaging manifest.',
    '',
    '## Spec Resolution Order',
    '',
    'Use dynamic progressive loading: read the nearest `AGENTS.md`, app identity only when relevant, local specs only when relevant, root `sdkwork-specs/README.md`, task-specific specs, then implementation files.',
    '',
    '## Required Specs By Task Type',
    '',
    'Load language-specific specs on demand only. TypeScript/Node changes load `TYPESCRIPT_CODE_SPEC.md`; Rust changes load `RUST_CODE_SPEC.md`; Java/Spring changes load `JAVA_CODE_SPEC.md`; frontend changes load `FRONTEND_CODE_SPEC.md`. Agent/workflow changes load `SOUL.md`, `AGENTS_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, and `GITHUB_WORKFLOW_SPEC.md` when GitHub packaging is touched.',
    '',
    '## Code Style Rules',
    '',
    'Read `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, and only the touched language/framework spec before code edits.',
    '',
    '## Build, Test, and Verification',
    '',
    'Use canonical root commands such as `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm check`, `pnpm verify`, and `pnpm clean`.',
    '',
    '## Agent Execution Rules',
    '',
    'Do not copy root standards locally. Use task-specific specs and record verification evidence.',
    '',
    '## Task-Specific Standards',
    '',
    'List/search work loads `PAGINATION_SPEC.md`. Run `node ../sdkwork-specs/tools/check-pagination.mjs --workspace .` before completing list/search work.',
    '',
    '## Human Review Rules',
    '',
    'Request human review for breaking standards, public naming, security/auth, generated SDK ownership, release, migration, or destructive changes.',
    '',
  ].join('\n'));

  write(root, 'CLAUDE.md', '# Claude Code Entry\n\nThis file is a compatibility shim. Read `AGENTS.md`, then `../sdkwork-specs/README.md`.\n');
  write(root, 'GEMINI.md', '# Gemini CLI Entry\n\nThis file is a compatibility shim. Read `AGENTS.md`, then `../sdkwork-specs/README.md`.\n');
  write(root, 'CODEX.md', '# Codex Entry\n\nThis file is a compatibility shim. Read `AGENTS.md`, then `../sdkwork-specs/README.md`.\n');

  if (options.mutate) {
    options.mutate(root);
  }

  return root;
}

function runChecker(root) {
  return spawnSync(process.execPath, [CHECKER, '--root', root], {
    cwd: path.dirname(CHECKER),
    encoding: 'utf8',
  });
}

describe('check-agent-workflow-standard', () => {
  it('accepts canonical AGENTS.md and packaging workflow entrypoints', () => {
    const root = makeRepo();
    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /agent and workflow standard ok/);
  });

  it('rejects missing thin package workflow', () => {
    const root = makeRepo({
      mutate(repoRoot) {
        write(repoRoot, '.github/workflows/package.yml', '');
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.github[/\\]workflows[/\\]package\.yml must call the SDKWork reusable package workflow/);
  });

  it('rejects copied release workflow bodies in application repositories', () => {
    const root = makeRepo({
      mutate(repoRoot) {
        write(repoRoot, '.github/workflows/release-package.yml', [
          'name: Copied Release',
          'jobs:',
          '  release:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - run: gh release upload "$TAG" dist/*',
        ].join('\n'));
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /copied packaging workflow is forbidden/);
  });

  it('does not require application packaging workflow files for standards repositories', () => {
    const root = makeRepo({
      mutate(repoRoot) {
        write(repoRoot, 'README.md', [
          '# SDKWork Standards',
          '',
          'repository-kind: standards',
          '',
        ].join('\n'));
        rmSync(path.join(repoRoot, 'sdkwork.workflow.json'), { force: true });
        rmSync(path.join(repoRoot, '.github'), { recursive: true, force: true });
      },
    });

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /agent and workflow standard ok/);
  });

  it('does not require an empty application packaging contract for foundation dependencies', () => {
    const root = makeRepo({
      mutate(repoRoot) {
        write(repoRoot, 'README.md', [
          '# SDKWork Foundation',
          '',
          'repository-kind: foundation-dependency',
          '',
        ].join('\n'));
        rmSync(path.join(repoRoot, 'sdkwork.workflow.json'), { force: true });
        rmSync(path.join(repoRoot, '.github'), { recursive: true, force: true });
      },
    });

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /agent and workflow standard ok/);
  });

  it('rejects workflow targets without deploymentProfile and runtimeTarget', () => {
    const root = makeRepo({
      mutate(repoRoot) {
        write(repoRoot, 'sdkwork.workflow.json', JSON.stringify({
          schemaVersion: '2026-06-06.sdkwork.workflow.v1',
          app: { id: 'sdkwork-demo', repository: 'sdkwork-ai/sdkwork-demo' },
          release: { artifactPrefix: 'sdkwork-demo', defaultVersion: '0.1.0' },
          targets: [
            {
              id: 'linux-x64-server-tar-gz',
              profile: 'server',
              platform: 'linux',
              architecture: 'x64',
              formats: ['tar.gz'],
              runner: 'ubuntu-24.04',
              outputGlobs: ['dist/*'],
            },
          ],
        }, null, 2));
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /targets\.0 must declare profileBinding as fixed or runtime-configurable/);
    assert.match(result.stderr, /targets\.0 must declare runtimeTarget/);
  });

  it('accepts a runtime-configurable client workflow target', () => {
    const root = makeRepo({
      mutate(repoRoot) {
        const workflowPath = path.join(repoRoot, 'sdkwork.workflow.json');
        const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'));
        workflow.targets = [{
          id: 'ios-universal-dual-mobile-ipa',
          profileBinding: 'runtime-configurable',
          supportedDeploymentProfiles: ['standalone', 'cloud'],
          defaultDeploymentProfile: 'standalone',
          runtimeTarget: 'ios-native',
          profile: 'mobile',
          platform: 'ios',
          architecture: 'universal',
          formats: ['ipa'],
          runner: 'macos-15',
          outputGlobs: ['dist/*.ipa'],
        }];
        write(repoRoot, 'sdkwork.workflow.json', JSON.stringify(workflow, null, 2));
      },
    });

    const result = runChecker(root);
    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects dependency refInputs that are not exposed through the package workflow', () => {
    const root = makeRepo({
      mutate(repoRoot) {
        write(repoRoot, 'sdkwork.workflow.json', JSON.stringify({
          schemaVersion: '2026-06-06.sdkwork.workflow.v1',
          app: {
            id: 'sdkwork-demo',
            name: 'SDKWork Demo',
            repository: 'sdkwork-ai/sdkwork-demo',
            sourcePath: '.',
            configPath: 'sdkwork.app.config.json',
          },
          release: {
            artifactPrefix: 'sdkwork-demo',
            defaultVersion: '0.1.0',
            changelog: { source: 'auto' },
          },
          dependencies: [
            {
              id: 'sdkwork-web-framework',
              repository: 'sdkwork-ai/sdkwork-web-framework',
              ref: 'main',
              refInput: 'SDKWORK_WEB_FRAMEWORK_REF',
              tokenSecret: 'SDKWORK_RELEASE_TOKEN',
            },
            {
              id: 'sdkwork-database',
              repository: 'sdkwork-ai/sdkwork-database',
              ref: 'main',
              refInput: 'SDKWORK_DATABASE_REF',
              tokenSecret: 'SDKWORK_RELEASE_TOKEN',
            },
          ],
          targets: [
            {
              id: 'linux-x64-standalone-server-tar-gz',
              profile: 'server',
              platform: 'linux',
              architecture: 'x64',
              formats: ['tar.gz'],
              runner: 'ubuntu-24.04',
              outputGlobs: ['dist/release/*'],
              deploymentProfile: 'standalone',
              runtimeTarget: 'server',
            },
          ],
        }, null, 2));
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SDKWORK_DATABASE_REF/);
    assert.match(result.stderr, /dependency_refs_json/);
    assert.match(result.stderr, /sdkwork_database_ref/);
  });

  it('rejects dependency refInputs without workflow variable fallbacks', () => {
    const root = makeRepo({
      mutate(repoRoot) {
        let workflowText = readFileSync(path.join(repoRoot, '.github/workflows/package.yml'), 'utf8');
        workflowText = workflowText.replace(
          '"SDKWORK_WEB_FRAMEWORK_REF": "${{ github.event.inputs.sdkwork_web_framework_ref || vars.SDKWORK_WEB_FRAMEWORK_REF }}"',
          '"SDKWORK_WEB_FRAMEWORK_REF": "${{ github.event.inputs.sdkwork_web_framework_ref }}"',
        );
        write(repoRoot, '.github/workflows/package.yml', workflowText);
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /vars\.SDKWORK_WEB_FRAMEWORK_REF/);
  });

  it('rejects AGENTS.md files that retain legacy local guidance blocks', () => {
    const root = makeRepo({
      mutate(repoRoot) {
        write(repoRoot, 'AGENTS.md', [
          '# Repository Guidelines',
          '',
          '## SDKWORK Soul',
          'Read `../sdkwork-specs/SOUL.md`.',
          '',
          '## SDKWORK Standards',
          '`../sdkwork-specs/README.md` and `../sdkwork-specs/AGENTS_SPEC.md`.',
          '',
          '## Application Identity',
          'Read `sdkwork.app.config.json`.',
          '',
          '## Local Dictionary Structure',
          '- `AGENTS.md`',
          '',
          '## Spec Resolution Order',
          'Read everything.',
          '',
          '## Required Specs By Task Type',
          'Load all specs.',
          '',
          '## Code Style Rules',
          'Use local style.',
          '',
          '## Build, Test, and Verification',
          '- `pnpm.cmd dev` starts the old app.',
          '',
          '## Agent Execution Rules',
          'Use local guidance.',
          '',
          '## Human Review Rules',
          'Ask humans.',
          '',
          '## Existing Local Guidance',
          'This preserved block is no longer standard.',
          '',
        ].join('\n'));
      },
    });

    const result = runChecker(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AGENTS\.md must not retain "Existing Local Guidance"/);
    assert.match(result.stderr, /AGENTS\.md must describe dynamic progressive loading/);
  });
});
