import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  alignSdkStandard,
  collectSdkStandardViolations,
} from './lib/align-sdk-standard.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('checks and aligns every canonical TypeScript SDK family manifest field', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-sdk-standard-'));
  const familyName = 'sdkwork-demo-app-sdk';
  const familyRoot = path.join(root, 'sdks', familyName);
  const typescriptRoot = path.join(familyRoot, `${familyName}-typescript`);
  const transportRoot = path.join(typescriptRoot, 'generated', 'server-openapi');

  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# fixture\n');
  writeJson(path.join(typescriptRoot, 'package.json'), {
    name: '@sdkwork/demo-app-sdk',
    exports: { '.': './src/index.ts' },
  });
  fs.mkdirSync(path.join(typescriptRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(typescriptRoot, 'src', 'index.ts'), 'export {};\n');
  writeJson(path.join(transportRoot, 'package.json'), {
    name: 'sdkwork-demo-app-sdk-generated-typescript',
    private: true,
  });
  writeJson(path.join(familyRoot, 'sdk-manifest.json'), {
    sdkOwner: 'sdkwork-demo',
    apiAuthority: 'sdkwork-demo-app-api',
    generationInputSpec: 'openapi/sdkwork-demo-app-api.sdkgen.yaml',
    sdkDependencies: [],
  });

  const beforeKinds = new Set(collectSdkStandardViolations(root).map((issue) => issue.kind));
  for (const expectedKind of [
    'manifest-sdk-family',
    'manifest-sdk-name',
    'manifest-consumer-name',
    'manifest-transport-name',
    'manifest-typescript-composed-root',
    'manifest-typescript-composed-entry',
    'manifest-typescript-transport-root',
    'manifest-typescript-transport-entry',
  ]) {
    assert.ok(beforeKinds.has(expectedKind), expectedKind);
  }

  alignSdkStandard(root);

  const afterKinds = new Set(collectSdkStandardViolations(root).map((issue) => issue.kind));
  for (const kind of beforeKinds) {
    assert.equal(afterKinds.has(kind), false, kind);
  }
});

test('composed facade re-declares transport runtime dependencies such as @sdkwork/utils', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-sdk-standard-utils-'));
  const familyName = 'sdkwork-demo-app-sdk';
  const familyRoot = path.join(root, 'sdks', familyName);
  const typescriptRoot = path.join(familyRoot, `${familyName}-typescript`);
  const transportRoot = path.join(typescriptRoot, 'generated', 'server-openapi');
  const utilsSource = path.join(root, 'sdkwork-utils', 'packages', 'sdkwork-utils-typescript', 'package.json');

  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# fixture\n');
  writeJson(path.join(typescriptRoot, 'package.json'), {
    name: '@sdkwork/demo-app-sdk',
    exports: { '.': './src/index.ts' },
    dependencies: { '@sdkwork/sdk-common': '^1.0.5' },
  });
  fs.mkdirSync(path.join(typescriptRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(typescriptRoot, 'src', 'index.ts'), 'export {};\n');
  writeJson(path.join(transportRoot, 'package.json'), {
    name: 'sdkwork-demo-app-sdk-generated-typescript',
    private: true,
    dependencies: {
      '@sdkwork/sdk-common': '^1.0.5',
      '@sdkwork/utils': '^0.11.0',
    },
  });
  writeJson(path.join(familyRoot, 'sdk-manifest.json'), {
    sdkOwner: 'sdkwork-demo',
    apiAuthority: 'sdkwork-demo-app-api',
    generationInputSpec: 'openapi/sdkwork-demo-app-api.sdkgen.yaml',
    sdkDependencies: [],
  });
  writeJson(utilsSource, { name: '@sdkwork/utils', version: '0.11.0' });

  const kinds = new Set(collectSdkStandardViolations(root).map((issue) => issue.kind));
  assert.ok(kinds.has('composed-missing-transport-dependency'), 'check flags the missing dependency');

  alignSdkStandard(root);

  const pkg = JSON.parse(fs.readFileSync(path.join(typescriptRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@sdkwork/utils'], '^0.11.0', 'align adds the concrete spec');
  const afterKinds = new Set(collectSdkStandardViolations(root).map((issue) => issue.kind));
  assert.equal(afterKinds.has('composed-missing-transport-dependency'), false);
});
