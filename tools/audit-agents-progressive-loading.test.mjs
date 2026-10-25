import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const AUDIT = path.join(TOOL_DIR, 'audit-agents-progressive-loading.mjs');
const ALIGNER = path.join(TOOL_DIR, 'align-agents-progressive-loading.mjs');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function write(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function initGitRepository(root) {
  fs.mkdirSync(root, { recursive: true });
  run('git', ['init', '-q'], root);
  run('git', ['config', 'user.email', 'tests@sdkwork.local'], root);
  run('git', ['config', 'user.name', 'SDKWork Tests'], root);
}

function stageAll(root) {
  run('git', ['add', '-A'], root);
  run('git', ['commit', '--quiet', '-m', 'fixture'], root);
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function agentsText(referencePrefix) {
  const prefix = referencePrefix ? `${referencePrefix}/` : '';
  return [
    '# Repository Guidelines',
    '',
    '## SDKWORK Soul',
    '',
    `Read \`${prefix}SOUL.md\` before a task when its execution rules apply.`,
    '',
    '## SDKWORK Standards',
    '',
    `- \`${prefix}README.md\``,
    `- \`${prefix}SOUL.md\``,
    `- \`${prefix}AGENTS_SPEC.md\``,
    '',
    '## Application Identity',
    '',
    'Read application identity only when the task touches application behavior.',
    '',
    '## Local Dictionary Structure',
    '',
    '- `AGENTS.md` routes agent work.',
    '',
    '## Spec Resolution Order',
    '',
    'Use dynamic progressive loading and inspect only the current task-specific authority before implementation files.',
    '',
    '## Required Specs By Task Type',
    '',
    'Language-specific specs are on-demand only for the touched language.',
    '',
    '## Code Style Rules',
    '',
    'Use the relevant code style authority.',
    '',
    '## Build, Test, and Verification',
    '',
    'Run the narrow verification for the current task.',
    '',
    '## Agent Execution Rules',
    '',
    'Do not copy global standards into local instructions.',
    '',
    '## Human Review Rules',
    '',
    'Escalate breaking standards changes for review.',
    '',
  ].join('\n');
}

function makeWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-agents-progressive-loading-'));
  initGitRepository(workspace);

  write(workspace, 'AGENTS.md', agentsText('sdkwork-specs'));
  write(workspace, '.gitmodules', [
    '[submodule "sdkwork-specs"]',
    '  path = sdkwork-specs',
    '  url = https://example.invalid/sdkwork-specs.git',
    '[submodule "sdkwork-alpha"]',
    '  path = sdkwork-alpha',
    '  url = https://example.invalid/sdkwork-alpha.git',
    '[submodule "nested-vendor"]',
    '  path = external/sdkwork-vendor',
    '  url = https://example.invalid/sdkwork-vendor.git',
    '[submodule "unmanaged"]',
    '  path = model-kit',
    '  url = https://example.invalid/model-kit.git',
    '',
  ].join('\n'));
  stageAll(workspace);

  const specsRoot = path.join(workspace, 'sdkwork-specs');
  initGitRepository(specsRoot);
  write(specsRoot, 'README.md', '# SDKWork Standards\n');
  write(specsRoot, 'SOUL.md', '# SDKWork Agent Soul\n');
  write(specsRoot, 'AGENTS_SPEC.md', '# AGENTS.md Standard\n');
  write(specsRoot, 'AGENTS.md', agentsText(''));
  stageAll(specsRoot);

  const alphaRoot = path.join(workspace, 'sdkwork-alpha');
  initGitRepository(alphaRoot);
  write(alphaRoot, 'AGENTS.md', agentsText('../sdkwork-specs'));
  write(alphaRoot, 'apps/demo/agent.app.config.json', '{"app":{"key":"demo"}}\n');
  write(alphaRoot, 'apps/demo/AGENTS.md', agentsText('../../../sdkwork-specs'));
  write(alphaRoot, 'apps/no-config/README.md', '# no-config\n');
  write(alphaRoot, 'apps/bad/README.md', '# bad\n');
  write(alphaRoot, 'apps/bad/AGENTS.md', [
    agentsText('../sdkwork-specs'),
    '## HTTP API Response Envelope',
    '',
    'Legacy duplicate one.',
    '',
    '## HTTP API Response Envelope',
    '',
    'Legacy duplicate two.',
    '',
  ].join('\n'));
  write(alphaRoot, 'legacy-client/agent.app.config.json', '{"app":{"key":"legacy"}}\n');
  write(alphaRoot, 'legacy-client/AGENTS.md', agentsText('../../sdkwork-specs'));
  write(alphaRoot, 'crates/sdkwork-alpha-tool/AGENTS.md', '# Component-local entrypoint\n');
  write(alphaRoot, 'external/vendor/agent.app.config.json', '{"app":{"key":"external"}}\n');
  write(alphaRoot, 'external/vendor/AGENTS.md', agentsText('../../sdkwork-specs'));
  write(alphaRoot, 'generated/client/agent.app.config.json', '{"app":{"key":"generated"}}\n');
  write(alphaRoot, 'generated/client/AGENTS.md', agentsText('../../sdkwork-specs'));
  write(alphaRoot, 'runtime/cache/agent.app.config.json', '{"app":{"key":"runtime"}}\n');
  write(alphaRoot, 'runtime/cache/AGENTS.md', agentsText('../../sdkwork-specs'));
  write(alphaRoot, 'data/drive-objects/agent.app.config.json', '{"app":{"key":"drive"}}\n');
  write(alphaRoot, 'data/drive-objects/AGENTS.md', agentsText('../../sdkwork-specs'));
  stageAll(alphaRoot);

  return { workspace, alphaRoot };
}

function runAudit(workspace, output) {
  return spawnSync(process.execPath, [AUDIT, '--workspace', workspace, '--output', output], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function target(manifest, agentRoot) {
  const value = manifest.targets.find((entry) => entry.agentRoot === agentRoot);
  assert.ok(value, `missing target ${agentRoot}`);
  return value;
}

test('builds a deterministic tracked-root manifest without mutating AGENTS.md', (context) => {
  const { workspace, alphaRoot } = makeWorkspace();
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const alphaAgents = path.join(alphaRoot, 'AGENTS.md');
  const demoAgents = path.join(alphaRoot, 'apps', 'demo', 'AGENTS.md');
  const beforeAlpha = fs.readFileSync(alphaAgents, 'utf8');
  const beforeDemo = fs.readFileSync(demoAgents, 'utf8');
  const firstOutput = path.join(workspace, 'agents-progressive-loading.manifest.json');
  const secondOutput = path.join(workspace, 'agents-progressive-loading-second.manifest.json');

  const first = runAudit(workspace, firstOutput);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.match(first.stdout, /3 repositories, 7 targets/);

  const manifest = JSON.parse(fs.readFileSync(firstOutput, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.workspaceRoot, '.');
  assert.equal(manifest.standardsRoot, 'sdkwork-specs');
  assert.equal(manifest.summary.repositoryCount, 3);
  assert.equal(manifest.summary.targetCount, 7);
  assert.equal(manifest.summary.missingAgentCount, 1);
  assert.equal(JSON.stringify(manifest).includes(workspace), false);
  assert.equal(manifest.alignment.workspaceRoot, '.');
  assert.equal(manifest.alignment.summary.candidateCount, 7);
  assert.equal(manifest.alignment.summary.targetCount, 7);
  assert.equal(manifest.alignment.summary.deferredCount, 0);
  assert.equal(manifest.alignment.summary.repairHttpEnvelopeCount, 1);
  assert.equal(manifest.alignment.summary.ensurePaginationCount, 6);

  const demo = target(manifest, 'sdkwork-alpha/apps/demo');
  assert.deepEqual(demo.discoveryReasons, ['tracked-direct-apps-child', 'tracked-agent-app-config']);
  assert.equal(demo.agent.state, 'existing');
  assert.equal(demo.agent.relativeSpecReferences.relativeSpecsPath, '../../../sdkwork-specs');
  assert.equal(demo.agent.relativeSpecReferences.valid, true);
  assert.equal(demo.agent.progressiveLoading.status, 'aligned');
  const demoAlignment = manifest.alignment.targets.find((entry) => entry.rootPath === demo.agentRoot);
  assert.deepEqual(demoAlignment, {
    rootPath: 'sdkwork-alpha/apps/demo',
    agentPath: 'AGENTS.md',
    relativeSpecsPath: '../../../sdkwork-specs',
    rootKind: 'application',
    action: 'update',
    beforeSha256: sha256(demoAgents),
    ensurePagination: true,
  });

  const noConfig = target(manifest, 'sdkwork-alpha/apps/no-config');
  assert.equal(noConfig.agent.state, 'missing');
  assert.deepEqual(noConfig.discoveryReasons, ['tracked-direct-apps-child']);
  assert.deepEqual(
    manifest.alignment.targets.find((entry) => entry.rootPath === noConfig.agentRoot),
    {
      rootPath: 'sdkwork-alpha/apps/no-config',
      agentPath: 'AGENTS.md',
      relativeSpecsPath: '../../../sdkwork-specs',
      rootKind: 'application',
      action: 'create',
      beforeSha256: null,
    },
  );

  const legacy = target(manifest, 'sdkwork-alpha/legacy-client');
  assert.equal(legacy.agent.relativeSpecReferences.relativeSpecsPath, '../../sdkwork-specs');
  assert.equal(legacy.agent.relativeSpecReferences.valid, true);

  const bad = target(manifest, 'sdkwork-alpha/apps/bad');
  assert.equal(bad.agent.relativeSpecReferences.valid, false);
  assert.equal(bad.agent.progressiveLoading.status, 'aligned');
  assert.equal(bad.agent.sectionHeadingCounts['HTTP API Response Envelope'], 2);
  assert.deepEqual(
    manifest.alignment.targets.find((entry) => entry.rootPath === bad.agentRoot),
    {
      rootPath: 'sdkwork-alpha/apps/bad',
      agentPath: 'AGENTS.md',
      relativeSpecsPath: '../../../sdkwork-specs',
      rootKind: 'application',
      action: 'update',
      beforeSha256: sha256(path.join(alphaRoot, 'apps', 'bad', 'AGENTS.md')),
      repairHttpEnvelope: true,
      ensurePagination: true,
    },
  );

  assert.ok(manifest.unscopedAgents.some((entry) => entry.path === 'sdkwork-alpha/crates/sdkwork-alpha-tool/AGENTS.md'));
  assert.equal(manifest.targets.some((entry) => entry.agentRoot.includes('external/vendor')), false);
  assert.equal(manifest.targets.some((entry) => entry.agentRoot.includes('generated/client')), false);
  assert.equal(manifest.targets.some((entry) => entry.agentRoot.includes('runtime/cache')), false);
  assert.equal(manifest.targets.some((entry) => entry.agentRoot.includes('drive-objects')), false);
  assert.ok(manifest.excludedPaths.some((entry) => entry.path === 'sdkwork-alpha/external/vendor/AGENTS.md'));
  assert.ok(manifest.excludedPaths.some((entry) => entry.path === 'sdkwork-alpha/generated/client/AGENTS.md'));
  assert.ok(manifest.excludedPaths.some((entry) => entry.path === 'sdkwork-alpha/runtime/cache/AGENTS.md'));
  assert.ok(manifest.excludedPaths.some((entry) => entry.path === 'sdkwork-alpha/data/drive-objects/AGENTS.md'));

  const alignmentDryRun = spawnSync(
    process.execPath,
    [
      ALIGNER,
      '--workspace',
      workspace,
      '--manifest',
      firstOutput,
      '--repair-http-envelope',
      '--ensure-pagination',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(alignmentDryRun.status, 0, alignmentDryRun.stderr || alignmentDryRun.stdout);
  assert.match(alignmentDryRun.stdout, /would update sdkwork-alpha\/apps\/demo\/AGENTS\.md/);
  assert.match(alignmentDryRun.stdout, /would create sdkwork-alpha\/apps\/no-config\/AGENTS\.md/);

  const second = runAudit(workspace, secondOutput);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(fs.readFileSync(firstOutput, 'utf8'), fs.readFileSync(secondOutput, 'utf8'));
  assert.equal(fs.readFileSync(alphaAgents, 'utf8'), beforeAlpha);
  assert.equal(fs.readFileSync(demoAgents, 'utf8'), beforeDemo);
});

test('defers dirty and unsafe roots from the alignment manifest', (context) => {
  const { workspace, alphaRoot } = makeWorkspace();
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  write(alphaRoot, 'apps/dirty/README.md', '# dirty\n');
  write(alphaRoot, 'apps/dirty/AGENTS.md', agentsText('../../../sdkwork-specs'));
  write(alphaRoot, 'apps/not-a-directory/README.md', '# not-a-directory\n');
  stageAll(alphaRoot);
  fs.rmSync(path.join(alphaRoot, 'apps/not-a-directory'), { recursive: true, force: true });
  fs.writeFileSync(path.join(alphaRoot, 'apps/not-a-directory'), 'not a directory\n', 'utf8');
  fs.appendFileSync(path.join(alphaRoot, 'apps/dirty/AGENTS.md'), 'Uncommitted local guidance.\n', 'utf8');

  const output = path.join(workspace, 'agents-progressive-loading-deferred.json');
  const result = runAudit(workspace, output);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const manifest = JSON.parse(fs.readFileSync(output, 'utf8'));
  const dirty = manifest.alignment.deferred.find((entry) => entry.rootPath === 'sdkwork-alpha/apps/dirty');
  assert.equal(dirty.reason, 'dirty-agent-path');
  assert.equal(dirty.action, 'update');
  assert.match(dirty.beforeSha256, /^[a-f0-9]{64}$/u);

  const unsafe = manifest.alignment.deferred.find((entry) => entry.rootPath === 'sdkwork-alpha/apps/not-a-directory');
  assert.equal(unsafe.reason, 'root-unsafe-non-directory');
  assert.equal(unsafe.action, null);
  assert.equal(manifest.alignment.targets.some((entry) => entry.rootPath === dirty.rootPath), false);
  assert.equal(manifest.alignment.targets.some((entry) => entry.rootPath === unsafe.rootPath), false);
  assert.equal(manifest.alignment.summary.dirtyDeferredCount, 1);
  assert.equal(manifest.alignment.summary.unsafeDeferredCount, 1);
});

test('refuses to use AGENTS.md as the audit output', (context) => {
  const { workspace } = makeWorkspace();
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const agentsPath = path.join(workspace, 'AGENTS.md');
  const before = fs.readFileSync(agentsPath, 'utf8');
  const result = runAudit(workspace, agentsPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not target AGENTS\.md/);
  assert.equal(fs.readFileSync(agentsPath, 'utf8'), before);
});
