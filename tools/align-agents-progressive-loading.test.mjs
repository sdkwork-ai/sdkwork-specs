import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';

const ALIGNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'align-agents-progressive-loading.mjs');
const temporaryRoots = [];

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function write(root, relativePath, content) {
  const destination = path.join(root, relativePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content, 'utf8');
  return destination;
}

function initializeGit(root) {
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'tests@sdkwork.local'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'SDKWork Tests'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root });
}

function agentText() {
  return [
    '# Repository Guidelines',
    '',
    '## Spec Resolution Order',
    '',
    'Keep this local resolution note.',
    '',
    '## Build, Test, and Verification',
    '',
    'Keep this local verification command: `pnpm test`.',
    '',
    '## Agent Execution Rules',
    '',
    'Keep this local execution rule.',
    '',
    '## App SDK Consumer Imports',
    '',
    'CANONICAL APP SDK BODY MUST STAY BYTE-FOR-BYTE.',
    '',
    '## HTTP API Response Envelope',
    '',
    'CANONICAL HTTP BODY MUST STAY BYTE-FOR-BYTE.',
    '',
    '## List And Search Pagination',
    '',
    'CANONICAL PAGINATION BODY MUST STAY BYTE-FOR-BYTE.',
    '',
    '## Human Review Rules',
    '',
    'Keep local human review text.',
    '',
  ].join('\n');
}

function makeWorkspace({ appPath = 'sdkwork-demo', agent = agentText() } = {}) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-align-agents-progressive-'));
  temporaryRoots.push(workspace);
  write(workspace, 'sdkwork-specs/README.md', '# SDKWork Standards\n');
  write(workspace, 'sdkwork-specs/SOUL.md', '# SDKWork Agent Soul\n');
  write(workspace, 'sdkwork-specs/AGENTS_SPEC.md', '# AGENTS.md Standard\n');
  const root = path.join(workspace, appPath);
  mkdirSync(root, { recursive: true });
  if (agent !== null) {
    writeFileSync(path.join(root, 'AGENTS.md'), agent, 'utf8');
  }
  writeFileSync(path.join(root, '.gitkeep'), '', 'utf8');
  initializeGit(root);
  return { workspace, root, appPath };
}

function manifestFor({
  rootPath,
  relativeSpecsPath,
  action,
  beforeSha256,
  rootKind = 'application',
  agentPath = 'AGENTS.md',
  repairHttpEnvelope,
  ensurePagination,
}) {
  return {
    schemaVersion: '1',
    workspaceRoot: '.',
    targets: [{
      rootPath,
      agentPath,
      relativeSpecsPath,
      action,
      beforeSha256,
      rootKind,
      ...(repairHttpEnvelope === undefined ? {} : { repairHttpEnvelope }),
      ...(ensurePagination === undefined ? {} : { ensurePagination }),
    }],
  };
}

function writeManifest(workspace, manifest) {
  const manifestPath = path.join(workspace, 'agents-migration.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

function run(workspace, manifestPath, ...args) {
  return spawnSync(process.execPath, [ALIGNER, '--workspace', workspace, '--manifest', manifestPath, ...args], {
    encoding: 'utf8',
  });
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe('align-agents-progressive-loading', () => {
  it('defaults to dry-run and only reports the marker-owned update', () => {
    const { workspace, root, appPath } = makeWorkspace();
    const before = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    const manifestPath = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(before),
    }));

    const result = run(workspace, manifestPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would update sdkwork-demo\/AGENTS\.md/);
    assert.equal(readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), before);
  });

  it('writes routing blocks and removes copied global standard bodies', () => {
    const { workspace, root, appPath } = makeWorkspace();
    const before = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    const manifestPath = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(before),
    }));

    const result = run(workspace, manifestPath, '--write');
    const after = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /updated sdkwork-demo\/AGENTS\.md/);
    assert.match(after, /<!-- SDKWORK-PROGRESSIVE-LOADING: v1 -->/);
    assert.match(after, /<!-- SDKWORK-VERIFICATION-ROUTING: v1 -->/);
    assert.match(after, /## SDKWORK Standards/);
    assert.match(after, /\.\.\/sdkwork-specs\/README\.md/);
    assert.match(after, /Keep this local resolution note\./);
    assert.match(after, /Keep this local verification command/);
    assert.match(after, /Keep this local execution rule\./);
    assert.doesNotMatch(after, /^## (?:App SDK Consumer Imports|HTTP API Response Envelope|List And Search Pagination)$/gmu);
    assert.match(after, /^## Task-Specific Standards$/mu);
    assert.match(after, /Keep local human review text\./);
  });

  it('replaces existing marker-owned content without changing local content', () => {
    const marked = agentText().replace(
      'Keep this local resolution note.',
      [
        '<!-- SDKWORK-PROGRESSIVE-LOADING: v1 -->',
        'obsolete owned text',
        '<!-- /SDKWORK-PROGRESSIVE-LOADING: v1 -->',
        '',
        'Keep this local resolution note.',
      ].join('\n'),
    ).replace(
      'Keep this local verification command: `pnpm test`.',
      [
        '<!-- SDKWORK-VERIFICATION-ROUTING: v1 -->',
        'obsolete verification text',
        '<!-- /SDKWORK-VERIFICATION-ROUTING: v1 -->',
        '',
        'Keep this local verification command: `pnpm test`.',
      ].join('\n'),
    ).replace(
      'Keep this local execution rule.',
      [
        '<!-- SDKWORK-PROGRESSIVE-LOADING: v1 -->',
        'obsolete execution text',
        '<!-- /SDKWORK-PROGRESSIVE-LOADING: v1 -->',
        '',
        'Keep this local execution rule.',
      ].join('\n'),
    );
    const { workspace, root, appPath } = makeWorkspace({ agent: marked });
    const manifestPath = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(marked),
    }));

    const result = run(workspace, manifestPath, '--write');
    const after = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(after, /obsolete owned text|obsolete verification text|obsolete execution text/);
    assert.match(after, /Keep this local resolution note\./);
    assert.match(after, /Keep this local verification command/);
    assert.match(after, /Keep this local execution rule\./);
  });

  it('normalizes every relative sdkwork-specs prefix in retained content', () => {
    const withBrokenPaths = agentText().replace(
      '## Spec Resolution Order',
      [
        '## SDKWORK Standards',
        '',
        'Read `../../sdkwork-specs/README.md` and `../../sdkwork-specs/SOUL.md`.',
        'Keep the self-root reference `sdkwork-specs/README.md` unchanged.',
        '',
        '## Spec Resolution Order',
      ].join('\n'),
    );
    const { workspace, root, appPath } = makeWorkspace({ agent: withBrokenPaths });
    const manifestPath = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(withBrokenPaths),
    }));

    const result = run(workspace, manifestPath, '--write');
    const after = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

    assert.equal(result.status, 0, result.stderr);
    assert.match(after, /`\.\.\/sdkwork-specs\/README\.md` and `\.\.\/sdkwork-specs\/SOUL\.md`/);
    assert.match(after, /`sdkwork-specs\/README\.md` unchanged/);
    assert.doesNotMatch(after, /CANONICAL APP SDK BODY/);
  });

  it('safely creates missing routing sections for a sparse legacy entrypoint', () => {
    const sparse = [
      '# Legacy Entry',
      '',
      '## Local Dictionary Structure',
      '',
      'Keep this local dictionary note.',
      '',
      '## App SDK Consumer Imports',
      '',
      'CANONICAL APP SDK BODY MUST STAY BYTE-FOR-BYTE.',
      '',
      '## HTTP API Response Envelope',
      '',
      'CANONICAL HTTP BODY MUST STAY BYTE-FOR-BYTE.',
      '',
      '## List And Search Pagination',
      '',
      'CANONICAL PAGINATION BODY MUST STAY BYTE-FOR-BYTE.',
      '',
      '## Human Review Rules',
      '',
      'Keep this local human review note.',
      '',
    ].join('\n');
    const { workspace, root, appPath } = makeWorkspace({ agent: sparse });
    const manifestPath = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(sparse),
    }));

    const result = run(workspace, manifestPath, '--write');
    const after = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

    assert.equal(result.status, 0, result.stderr);
    for (const heading of [
      '## SDKWORK Soul',
      '## SDKWORK Standards',
      '## Application Identity',
      '## Local Dictionary Structure',
      '## Spec Resolution Order',
      '## Required Specs By Task Type',
      '## Code Style Rules',
      '## Build, Test, and Verification',
      '## Agent Execution Rules',
      '## Human Review Rules',
    ]) {
      assert.ok(after.includes(heading), `missing ${heading}`);
    }
    assert.ok(after.indexOf('## Local Dictionary Structure') < after.indexOf('## Spec Resolution Order'));
    assert.ok(after.indexOf('## Agent Execution Rules') < after.indexOf('## Human Review Rules'));
    assert.match(after, /Keep this local dictionary note\./);
    assert.match(after, /Keep this local human review note\./);
    assert.match(after, /dynamic progressive loading/);
    assert.match(after, /language-specific specs are on-demand/i);
    assert.match(after, /current task/);
    assert.match(after, /PNPM_SCRIPT_SPEC\.md/);
    assert.match(after, /GITHUB_WORKFLOW_SPEC\.md/);
    assert.match(after, /RUST_CODE_SPEC\.md.*JAVA_CODE_SPEC\.md.*TYPESCRIPT_CODE_SPEC\.md.*FRONTEND_CODE_SPEC\.md/);
    assert.doesNotMatch(after, /CANONICAL (?:APP SDK|HTTP|PAGINATION) BODY/);
    assert.match(after, /^## Task-Specific Standards$/mu);
  });

  it('rejects duplicate required sections before changing an existing entrypoint', () => {
    const duplicate = agentText().replace(
      '## Build, Test, and Verification',
      [
        '## Code Style Rules',
        '',
        'First code style guidance.',
        '',
        '## Code Style Rules',
        '',
        'Duplicate code style guidance.',
        '',
        '## Build, Test, and Verification',
      ].join('\n'),
    );
    const { workspace, root, appPath } = makeWorkspace({ agent: duplicate });
    const manifestPath = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(duplicate),
    }));

    const result = run(workspace, manifestPath, '--write');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicate required section "Code Style Rules"/);
    assert.equal(readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), duplicate);
  });

  it('retires copied HTTP envelope sections even when legacy repair switches are present', () => {
    const duplicateHttp = agentText().replace(
      '## List And Search Pagination',
      [
        '## HTTP API Response Envelope',
        '',
        'Legacy success uses `SdkWorkResponse` and duplicate local guidance.',
        '',
        '## List And Search Pagination',
      ].join('\n'),
    );
    const { workspace, root, appPath } = makeWorkspace({ agent: duplicateHttp });
    const manifestPath = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(duplicateHttp),
      repairHttpEnvelope: true,
    }));

    const result = run(workspace, manifestPath, '--repair-http-envelope', '--write');
    const after = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

    assert.equal(result.status, 0, result.stderr);
    assert.equal((after.match(/^## HTTP API Response Envelope$/gmu) ?? []).length, 0);
    assert.doesNotMatch(after, /Legacy success uses/);
    assert.match(after, /API_SPEC\.md/);
  });

  it('routes pagination without recreating copied pagination sections', () => {
    const withoutPagination = agentText().replace(
      [
        '## List And Search Pagination',
        '',
        'CANONICAL PAGINATION BODY MUST STAY BYTE-FOR-BYTE.',
        '',
      ].join('\n'),
      '',
    );
    const { workspace, root, appPath } = makeWorkspace({ agent: withoutPagination });
    const manifestPath = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(withoutPagination),
      ensurePagination: true,
    }));

    const result = run(workspace, manifestPath, '--ensure-pagination', '--write');
    const after = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(after, /^## List And Search Pagination$/mu);
    assert.match(after, /PAGINATION_SPEC\.md/);
    assert.match(after, /check-pagination\.mjs/);
  });

  it('creates a compliant minimal application entrypoint only with --write', () => {
    const { workspace, appPath } = makeWorkspace({ appPath: 'sdkwork-demo/apps/sdkwork-demo-pc', agent: null });
    const root = path.join(workspace, appPath);
    const manifestPath = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../../../sdkwork-specs',
      action: 'create',
      beforeSha256: null,
    }));

    const dryRun = run(workspace, manifestPath);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /would create sdkwork-demo\/apps\/sdkwork-demo-pc\/AGENTS\.md/);
    assert.equal(fsExists(path.join(root, 'AGENTS.md')), false);

    const writeResult = run(workspace, manifestPath, '--write');
    const created = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    assert.equal(writeResult.status, 0, writeResult.stderr);
    for (const heading of [
      '## Task-Specific Standards',
      '## Human Review Rules',
    ]) {
      assert.ok(created.includes(heading), `missing ${heading}`);
    }
    assert.match(created, /API_SPEC\.md/);
    assert.match(created, /SOURCE_CONFIG_SPEC\.md/);
    assert.match(created, /check-pagination\.mjs/);
    assert.match(created, /\.\.\/\.\.\/\.\.\/sdkwork-specs\/SOUL\.md/);
    assert.match(created, /<!-- SDKWORK-PROGRESSIVE-LOADING: v1 -->/);
    assert.match(created, /<!-- SDKWORK-VERIFICATION-ROUTING: v1 -->/);
  });

  it('rejects a manifest target outside the workspace or in an excluded directory', () => {
    const { workspace, root, appPath } = makeWorkspace();
    const before = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    const outside = manifestFor({
      rootPath: '../outside',
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(before),
    });
    const outsideResult = run(workspace, writeManifest(workspace, outside));
    assert.notEqual(outsideResult.status, 0);
    assert.match(outsideResult.stderr, /rootPath.*(escape|outside)/i);

    const excludedRoot = path.join(root, 'external', 'upstream');
    mkdirSync(excludedRoot, { recursive: true });
    writeFileSync(path.join(excludedRoot, 'AGENTS.md'), agentText(), 'utf8');
    const excluded = manifestFor({
      rootPath: `${appPath}/external/upstream`,
      relativeSpecsPath: '../../../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(agentText()),
    });
    const excludedResult = run(workspace, writeManifest(workspace, excluded));
    assert.notEqual(excludedResult.status, 0);
    assert.match(excludedResult.stderr, /excluded directory segment/i);
  });

  it('rejects a symbolic-link root', () => {
    const { workspace, root } = makeWorkspace();
    const linkedRoot = path.join(workspace, 'linked-demo');
    symlinkSync(root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    const before = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    const manifestPath = writeManifest(workspace, manifestFor({
      rootPath: 'linked-demo',
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(before),
    }));

    const result = run(workspace, manifestPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symbolic link/i);
  });

  it('rejects dirty and hash-changed update targets', () => {
    const { workspace, root, appPath } = makeWorkspace();
    const original = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    const dirty = `${original}\nDirty local change.\n`;
    writeFileSync(path.join(root, 'AGENTS.md'), dirty, 'utf8');
    const dirtyManifest = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(dirty),
    }));
    const dirtyResult = run(workspace, dirtyManifest);
    assert.notEqual(dirtyResult.status, 0);
    assert.match(dirtyResult.stderr, /dirty/i);

    const hashManifest = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(original),
    }));
    const hashResult = run(workspace, hashManifest);
    assert.notEqual(hashResult.status, 0);
    assert.match(hashResult.stderr, /hash changed/i);
  });

  it('rejects malformed marker ownership and a create overwrite', () => {
    const malformed = agentText().replace(
      'Keep this local resolution note.',
      '<!-- SDKWORK-VERIFICATION-ROUTING: v1 -->\nwrong section\n<!-- /SDKWORK-VERIFICATION-ROUTING: v1 -->',
    );
    const { workspace, root, appPath } = makeWorkspace({ agent: malformed });
    const malformedManifest = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'update',
      beforeSha256: sha256(malformed),
    }));
    const malformedResult = run(workspace, malformedManifest);
    assert.notEqual(malformedResult.status, 0);
    assert.match(malformedResult.stderr, /outside its owned routing section/i);

    const createManifest = writeManifest(workspace, manifestFor({
      rootPath: appPath,
      relativeSpecsPath: '../sdkwork-specs',
      action: 'create',
      beforeSha256: null,
    }));
    const createResult = run(workspace, createManifest);
    assert.notEqual(createResult.status, 0);
    assert.match(createResult.stderr, /already exists/i);
    assert.ok(readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes('wrong section'));
  });
});

function fsExists(filePath) {
  try {
    return Boolean(readFileSync(filePath));
  } catch {
    return false;
  }
}
