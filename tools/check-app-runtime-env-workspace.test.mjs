import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TOOL_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-app-runtime-env-workspace.mjs');

const SDK_COMMON_STUB = [
  "export const CLOUD_GATEWAY_DEV_PORT = '3910';",
  "// SDKWORK_RUNTIME_ENV bridge marker",
  "'same-origin-relative'",
].join('\n');

const VITE_CONFIG_ALIGNED = [
  "import { createBrowserRuntimeEnvVitePlugin } from '../../../sdkwork-specs/tools/browser-runtime-env-vite.mjs';",
  'export default {};',
].join('\n');

const VITE_CONFIG_UNALIGNED = 'export default {};\n';

function writeFixtureRepo(root, name, { withSdkCommon, viteConfig, withArtifact, withGitignoreCover }) {
  const repoRoot = path.join(root, name);
  const appRoot = path.join(repoRoot, 'apps', `${name}-pc`);
  mkdirSync(path.join(appRoot, 'src'), { recursive: true });
  writeFileSync(path.join(appRoot, 'vite.config.ts'), viteConfig);
  if (withSdkCommon) {
    const sdkCommonDir = path.join(repoRoot, 'node_modules', '@sdkwork', 'sdk-common', 'src', 'utils');
    mkdirSync(sdkCommonDir, { recursive: true });
    writeFileSync(path.join(sdkCommonDir, 'url.ts'), SDK_COMMON_STUB);
  }
  if (withArtifact) {
    mkdirSync(path.join(appRoot, 'public'), { recursive: true });
    writeFileSync(path.join(appRoot, 'public', 'runtime-env.json'), '{}');
  }
  writeFileSync(
    path.join(repoRoot, '.gitignore'),
    withGitignoreCover ? 'public/runtime-env.json\n' : '# nothing\n',
  );
  return repoRoot;
}

test('workspace tracker classifies ok / environment-blocked / code-gap and applies exit modes', () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-app-runtime-env-'));
  try {
    writeFixtureRepo(fixtureRoot, 'sdkwork-fixture-a', {
      withSdkCommon: true,
      viteConfig: VITE_CONFIG_ALIGNED,
      withArtifact: false,
      withGitignoreCover: true,
    });
    writeFixtureRepo(fixtureRoot, 'sdkwork-fixture-b', {
      withSdkCommon: false,
      viteConfig: VITE_CONFIG_UNALIGNED,
      withArtifact: true,
      withGitignoreCover: true,
    });
    writeFixtureRepo(fixtureRoot, 'sdkwork-fixture-c', {
      withSdkCommon: false,
      viteConfig: VITE_CONFIG_ALIGNED,
      withArtifact: false,
      withGitignoreCover: true,
    });

    const report = spawnSync(process.execPath, [TOOL_PATH, '--workspace', fixtureRoot, '--report'], {
      encoding: 'utf8',
    });
    assertReport(report);

    assert.match(report.stdout, /ok\s+sdkwork-fixture-a/u);
    assert.match(report.stdout, /environment\s+sdkwork-fixture-c/u);
    // Code-gap detail lines stream to stderr (they are the failure report).
    assert.match(report.stderr, /code-gap\s+sdkwork-fixture-b/u);
    assert.match(report.stdout, /1 ok, 1 environment-blocked, 1 code-gap\(s\) \(3 browser-surface repositories\)/u);

    // A .gitignore-uncovered artifact is a code gap even in an aligned repo.
    writeFixtureRepo(fixtureRoot, 'sdkwork-fixture-d', {
      withSdkCommon: true,
      viteConfig: VITE_CONFIG_ALIGNED,
      withArtifact: true,
      withGitignoreCover: false,
    });
    const reportWithD = spawnSync(process.execPath, [TOOL_PATH, '--workspace', fixtureRoot, '--report'], {
      encoding: 'utf8',
    });
    assertReport(reportWithD);
    assert.match(reportWithD.stderr, /code-gap\s+sdkwork-fixture-d/u);
    assert.match(reportWithD.stderr, /does not cover public\/runtime-env\.json/u);

    const strict = spawnSync(process.execPath, [TOOL_PATH, '--workspace', fixtureRoot], { encoding: 'utf8' });
    assert.equal(strict.status, 1, 'strict mode exits 1 while code gaps exist');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

function assertReport(result) {
  // --report mode exits 0; code-gap detail lines legitimately stream to stderr.
  if (result.status !== 0 || /Error/u.test(result.stderr)) {
    throw new Error(`tracker failed: ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}
