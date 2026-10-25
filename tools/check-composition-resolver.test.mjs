#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import os from 'node:os';

import {
  deriveFoundationEnvFromResolution,
  resolveComposition,
  validateCompositionResolution,
} from './lib/composition-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cloudRouterRoot = path.resolve(__dirname, '../../../sdkwork-cloudrouter');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function createSdkFamily(repoRoot, workspace, {
  sdkOwner,
  apiAuthority,
  sdkTarget,
  apiPrefix,
  integration,
} = {}) {
  writeJson(path.join(repoRoot, 'specs/component.spec.json'), {
    component: { name: sdkOwner, type: 'application-root' },
    ...(integration ? { integration } : {}),
  });
  writeJson(path.join(repoRoot, `sdks/${workspace}/sdk-manifest.json`), {
    schemaVersion: 1,
    workspace,
    sdkOwner,
    apiAuthority,
    sdkDependencies: [],
    discoverySurface: {
      sdkTarget,
      apiPrefix,
      generatedProtocols: ['http-openapi'],
    },
  });
}

function createOwnershipResolutionFixture({ integrationOverrides = {} } = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-composition-ownership-'));
  const root = path.join(workspaceRoot, 'sdkwork-demo');
  const appRoot = path.join(root, 'apps/sdkwork-demo-pc');
  writeJson(path.join(root, 'agent.app.config.json'), {
    schemaVersion: 3,
    kind: 'agent.app',
    app: { key: 'sdkwork-demo' },
  });
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    schemaVersion: 3,
    kind: 'agent.app',
    app: { key: 'sdkwork-demo' },
  });

  const appDependencies = [
    'sdkwork-demo-app-sdk',
    'sdkwork-drive-app-sdk',
    'sdkwork-agents-app-sdk',
    'sdkwork-skills-app-sdk',
    'sdkwork-prompts-app-sdk',
    'sdkwork-documents-app-sdk',
    'sdkwork-messaging-app-sdk',
    'sdkwork-im-app-sdk',
  ].map((workspace) => ({
    workspace,
    surface: 'app-api',
    credentialMode: 'authenticated-app-api',
  }));

  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/package.json'), {
    name: '@sdkwork/demo-pc-core',
    version: '0.0.0',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/specs/component.spec.json'), {
    component: {
      name: '@sdkwork/demo-pc-core',
      type: 'frontend-core',
      surface: 'app',
    },
    contracts: {
      sdkDependencies: appDependencies,
      composition: {
        overrides: {
          integrations: integrationOverrides,
        },
      },
    },
  });

  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-admin-core/package.json'), {
    name: '@sdkwork/demo-pc-admin-core',
    version: '0.0.0',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-admin-core/specs/component.spec.json'), {
    component: {
      name: '@sdkwork/demo-pc-admin-core',
      type: 'frontend-core',
      surface: 'backend-admin',
    },
    contracts: {
      sdkDependencies: [{
        workspace: 'sdkwork-iam-backend-sdk',
        surface: 'backend-api',
        credentialMode: 'authenticated-backend-admin',
      }],
    },
  });

  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-console-core/package.json'), {
    name: '@sdkwork/demo-pc-console-core',
    version: '0.0.0',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-console-core/specs/component.spec.json'), {
    component: {
      name: '@sdkwork/demo-pc-console-core',
      type: 'frontend-core',
      surface: 'console',
    },
    contracts: {
      sdkDependencies: [{
        workspace: 'sdkwork-im-sdk',
        surface: 'open-api',
        credentialMode: 'protected-open-api-flexible',
      }],
    },
  });

  const families = [
    ['demo', 'sdkwork-demo-app-sdk', 'sdkwork-demo', 'sdkwork-demo-app-api', 'app', '/app/v3/api'],
    ['drive', 'sdkwork-drive-app-sdk', 'sdkwork-drive', 'sdkwork-drive-app-api', 'app', '/app/v3/api'],
    ['agents', 'sdkwork-agents-app-sdk', 'sdkwork-agents', 'sdkwork-agents-app-api', 'app', '/app/v3/api'],
    ['skills', 'sdkwork-skills-app-sdk', 'sdkwork-skills', 'sdkwork-skills-app-api', 'app', '/app/v3/api'],
    ['prompts', 'sdkwork-prompts-app-sdk', 'sdkwork-prompts', 'sdkwork-prompts-app-api', 'app', '/app/v3/api'],
    ['documents', 'sdkwork-documents-app-sdk', 'sdkwork-documents', 'sdkwork-documents-app-api', 'app', '/app/v3/api'],
    ['messaging', 'sdkwork-messaging-app-sdk', 'sdkwork-messaging', 'sdkwork-messaging-app-api', 'app', '/app/v3/api'],
    ['im', 'sdkwork-im-app-sdk', 'sdkwork-im', 'sdkwork-im-app-api', 'app', '/app/v3/api'],
    ['iam', 'sdkwork-iam-backend-sdk', 'sdkwork-iam', 'sdkwork-iam-backend-api', 'backend', '/backend/v3/api'],
    ['im', 'sdkwork-im-sdk', 'sdkwork-im', 'sdkwork-im-open-api', 'open', '/im/v3/api'],
  ];
  for (const [domain, workspace, sdkOwner, apiAuthority, sdkTarget, apiPrefix] of families) {
    createSdkFamily(path.join(workspaceRoot, `sdkwork-${domain}`), workspace, {
      sdkOwner,
      apiAuthority,
      sdkTarget,
      apiPrefix,
      integration: domain === 'drive'
        ? { defaultConnectivityPlane: 'application', defaultRuntimeMode: 'same-origin-embedded' }
        : undefined,
    });
  }

  return { root, resolution: resolveComposition(root) };
}

test('resolveComposition derives platform IAM integration from cloudrouter sdkDependencies', () => {
  if (!fs.existsSync(cloudRouterRoot)) return;

  const resolution = resolveComposition(cloudRouterRoot);
  const iam = resolution.integrations.find((entry) => entry.workspace === 'sdkwork-iam-app-sdk');
  assert.ok(iam, 'expected sdkwork-iam-app-sdk integration');
  assert.equal(iam.connectivityPlane, 'platform');
  assert.equal(iam.runtimeMode, 'external-via-platform-surface');
  assert.equal(iam.forbidApplicationSameOriginFallback, true);
  assert.equal(resolution.requiresPlatformApiSurface, true);
  assert.equal(Object.hasOwn(resolution, 'requiresPlatformGatewayProcess'), false);
  assert.doesNotMatch(JSON.stringify(resolution), /external-via-platform-gateway/u);
  assert.ok(
    resolution.permissions.inheritedManifests.some((entry) => entry.workspace === 'sdkwork-iam-app-sdk'),
    'expected IAM permission manifest inheritance',
  );
});

test('validateCompositionResolution rejects platform IAM falling back to application same-origin URL', () => {
  const resolution = {
    issues: [],
    integrations: [
      {
        workspace: 'sdkwork-iam-app-sdk',
        envKey: 'VITE_SDKWORK_APPBASE_APP_API_BASE_URL',
        connectivityPlane: 'platform',
        forbidApplicationSameOriginFallback: true,
      },
    ],
  };

  const issues = validateCompositionResolution(resolution, {
    observedEnv: {
      VITE_SDKWORK_APPBASE_APP_API_BASE_URL: '/app/v3/api',
    },
    applicationAppApiBaseUrl: '/app/v3/api',
  });

  assert.ok(issues.length >= 1);
  assert.match(issues[0], /must not fall back to application same-origin/u);
});

test('validateCompositionResolution allows verified browser same-origin API edge root', () => {
  const resolution = {
    issues: [],
    integrations: [
      {
        workspace: 'sdkwork-drive-app-sdk',
        envKey: 'VITE_SDKWORK_DRIVE_APP_API_BASE_URL',
        connectivityPlane: 'platform',
        forbidApplicationSameOriginFallback: true,
      },
    ],
  };

  const issues = validateCompositionResolution(resolution, {
    observedEnv: {
      VITE_SDKWORK_DRIVE_APP_API_BASE_URL: '/',
    },
    applicationAppApiBaseUrl: '/',
    allowBrowserSameOriginApiEdge: true,
    canonicalRoutePrecedenceVerified: true,
  });

  assert.deepEqual(issues, []);
});

test('validateCompositionResolution rejects synthetic browser proxy selector paths', () => {
  const resolution = {
    issues: [],
    integrations: [
      {
        workspace: 'sdkwork-drive-app-sdk',
        envKey: 'VITE_SDKWORK_DRIVE_APP_API_BASE_URL',
        connectivityPlane: 'platform',
        forbidApplicationSameOriginFallback: true,
      },
    ],
  };

  const issues = validateCompositionResolution(resolution, {
    observedEnv: {
      VITE_SDKWORK_DRIVE_APP_API_BASE_URL: '/__sdkwork/platform',
    },
    applicationAppApiBaseUrl: '/',
  });

  assert.ok(issues.length >= 1);
  assert.match(issues[0], /must not expose proxy or gateway selector path/u);
});

test('deriveFoundationEnvFromResolution maps platform dependencies to surface origin', () => {
  const resolution = {
    env: {},
    integrations: [
      {
        workspace: 'sdkwork-iam-app-sdk',
        envKey: 'VITE_SDKWORK_APPBASE_APP_API_BASE_URL',
        runtimeMode: 'external-via-platform-surface',
        apiPrefix: '/app/v3/api',
      },
      {
        workspace: 'sdkwork-drive-app-sdk',
        envKey: 'VITE_SDKWORK_DRIVE_APP_API_BASE_URL',
        runtimeMode: 'external-via-platform-surface',
        apiPrefix: '/app/v3/api',
      },
    ],
  };

  const env = deriveFoundationEnvFromResolution(resolution, {
    platformApiOrigin: 'http://127.0.0.1:3902',
    applicationAppApiBaseUrl: '/app/v3/api',
    applicationBackendApiBaseUrl: 'http://127.0.0.1:3900/backend/v3/api',
  });

  assert.equal(env.VITE_SDKWORK_APPBASE_APP_API_BASE_URL, 'http://127.0.0.1:3902/app/v3/api');
  assert.equal(env.VITE_SDKWORK_DRIVE_APP_API_BASE_URL, 'http://127.0.0.1:3902/app/v3/api');
});

test('resolveComposition derives planes from SDK ownership for app, backend, and open surfaces', () => {
  const { resolution } = createOwnershipResolutionFixture({
    integrationOverrides: {
      'sdkwork-drive-app-sdk': {
        baseUrl: 'https://drive.example.test/app/v3/api',
        runtimeMode: 'external-via-declared-upstream',
      },
    },
  });

  const ownSdk = resolution.integrations.find((entry) => entry.workspace === 'sdkwork-demo-app-sdk');
  assert.ok(ownSdk);
  assert.equal(ownSdk.connectivityPlane, 'application');
  assert.equal(ownSdk.runtimeMode, 'same-origin-embedded');
  assert.equal(ownSdk.consumerSdkOwner, 'sdkwork-demo');
  assert.equal(ownSdk.sdkOwner, 'sdkwork-demo');

  const expectedPlatformFamilies = [
    'sdkwork-agents-app-sdk',
    'sdkwork-documents-app-sdk',
    'sdkwork-im-app-sdk',
    'sdkwork-im-sdk',
    'sdkwork-iam-backend-sdk',
    'sdkwork-messaging-app-sdk',
    'sdkwork-prompts-app-sdk',
    'sdkwork-skills-app-sdk',
  ];
  for (const workspace of expectedPlatformFamilies) {
    const integration = resolution.integrations.find((entry) => entry.workspace === workspace);
    assert.ok(integration, `expected ${workspace} integration`);
    assert.equal(integration.connectivityPlane, 'platform', workspace);
    assert.equal(integration.runtimeMode, 'external-via-platform-surface', workspace);
    assert.equal(integration.forbidApplicationSameOriginFallback, true, workspace);
  }

  const drive = resolution.integrations.find((entry) => entry.workspace === 'sdkwork-drive-app-sdk');
  assert.ok(drive);
  assert.equal(drive.connectivityPlane, 'platform');
  assert.equal(drive.runtimeMode, 'external-via-declared-upstream');
  assert.equal(resolution.env.VITE_SDKWORK_DRIVE_APP_API_BASE_URL, 'https://drive.example.test/app/v3/api');
  assert.equal(resolution.issues.length, 0);
});

test('resolveComposition rejects consumer overrides that attempt to change connectivity plane', () => {
  const { resolution } = createOwnershipResolutionFixture({
    integrationOverrides: {
      'sdkwork-drive-app-sdk': {
        connectivityPlane: 'application',
      },
    },
  });

  const drive = resolution.integrations.find((entry) => entry.workspace === 'sdkwork-drive-app-sdk');
  assert.ok(drive);
  assert.equal(drive.connectivityPlane, 'platform');
  assert.equal(drive.runtimeMode, 'external-via-platform-surface');
  assert.ok(resolution.issues.some((issue) => /unsupported composition integration override connectivityPlane/u.test(issue)));
});

test('resolveComposition prefers verified standalone-host assembly mounts over dependency surface defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-composition-embedded-iam-'));
  const appRoot = path.join(root, 'apps/sdkwork-demo-pc');
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    schemaVersion: 1,
    applicationCode: 'demo',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/package.json'), {
    name: '@sdkwork/demo-pc-core',
    version: '0.0.0',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/specs/component.spec.json'), {
    component: {
      name: '@sdkwork/demo-pc-core',
      type: 'typescript-package',
      surface: 'app',
    },
    contracts: {
      sdkDependencies: [
        {
          workspace: 'sdkwork-iam-app-sdk',
          surface: 'app-api',
          credentialMode: 'authenticated-app-api',
        },
      ],
    },
  });
  writeJson(path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/specs/component.spec.json'), {
    component: {
      name: 'sdkwork-api-demo-standalone-gateway',
      type: 'rust-crate',
      surface: 'backend',
    },
    contracts: {
      dependencyApiSurfaces: [
        {
          workspace: 'sdkwork-iam',
          sdkFamily: 'sdkwork-iam-app-sdk',
          surface: 'app-api',
          apiPrefix: '/app/v3/api',
          runtimeMode: 'same-origin-mounted',
          cargoDependency: 'sdkwork_api_iam_assembly',
          embeddedExecutableExport: 'sdkwork_api_iam_assembly::assemble_api_business_router',
          coverageEvidence: ['src/main.rs#assemble_api_router'],
        },
      ],
    },
  });
  writeText(
    path.join(root, 'crates/sdkwork-api-demo-standalone-gateway/Cargo.toml'),
    [
      '[package]',
      'name = "sdkwork-api-demo-standalone-gateway"',
      'version = "0.0.0"',
      '',
      '[dependencies]',
      'sdkwork_api_iam_assembly.workspace = true',
      '',
    ].join('\n'),
  );

  const resolution = resolveComposition(root);
  const iam = resolution.integrations.find((entry) => entry.workspace === 'sdkwork-iam-app-sdk');

  assert.ok(iam);
  assert.equal(iam.runtimeMode, 'same-origin-embedded');
  assert.equal(iam.connectivityPlane, 'application');
  assert.equal(iam.mountStatus, 'verified');
  assert.equal(iam.envKey, null);
  assert.equal(resolution.requiresPlatformApiSurface, false);
});

test('resolveComposition includes cross-stack architecture summary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-composition-architecture-'));
  writeJson(path.join(root, 'specs/component.spec.json'), {
    component: { name: 'sdkwork-demo', type: 'application-root' },
    composition: { consumerIntegrationsExempt: true },
    contracts: {
      dependencyApiSurfaces: [
        {
          workspace: 'sdkwork-iam-app-sdk',
          surface: 'app-api',
          runtimeMode: 'external-service',
          apiPrefix: '/app/v3/api/iam',
        },
      ],
    },
  });
  const appRoot = path.join(root, 'apps/sdkwork-demo-pc');
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    schemaVersion: 1,
    applicationCode: 'demo',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/package.json'), {
    name: '@sdkwork/demo-pc-core',
    version: '0.0.0',
  });
  fs.mkdirSync(path.join(appRoot, 'packages/sdkwork-demo-pc-core/src/composition'), { recursive: true });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/specs/component.spec.json'), {
    component: {
      name: '@sdkwork/demo-pc-core',
      type: 'frontend-core',
      root: 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-core',
      domain: 'demo',
      capability: 'core',
      languages: ['typescript'],
    },
    contracts: {
      layerRole: 'frontend-core',
      publicExports: ['.', './composition'],
      providedPorts: [],
      requiredPorts: [],
      sdkDependencies: [],
    },
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-chat/package.json'), {
    name: '@sdkwork/demo-pc-chat',
    version: '0.0.0',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-chat/specs/component.spec.json'), {
    component: {
      name: '@sdkwork/demo-pc-chat',
      type: 'react-package',
      root: 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-chat',
      domain: 'demo',
      capability: 'chat',
      languages: ['typescript'],
    },
    contracts: {
      layerRole: 'frontend-feature',
      publicExports: ['.'],
      providedPorts: [{ name: 'chatServices', export: '.' }],
      requiredPorts: [{ name: 'demoSdk', export: '.' }],
    },
  });
  writeText(
    path.join(root, 'crates/sdkwork-demo-chat-service/Cargo.toml'),
    '[package]\nname = "sdkwork-demo-chat-service"\nversion = "0.0.0"\n',
  );
  writeJson(path.join(root, 'crates/sdkwork-routes-chat-app-api/specs/component.spec.json'), {
    component: {
      name: 'sdkwork-routes-chat-app-api',
      type: 'rust-route-crate',
      root: 'crates/sdkwork-routes-chat-app-api',
      domain: 'demo',
      capability: 'chat',
      languages: ['rust'],
    },
    contracts: {
      layerRole: 'backend-route',
      publicExports: ['.'],
      runtimeEntrypoints: ['build_sdkwork_chat_app_api_router'],
      routeManifest: 'sdks/_route-manifests/app-api/sdkwork-routes-chat-app-api.route-manifest.json',
    },
  });
  writeJson(path.join(root, 'sdks/_route-manifests/app-api/sdkwork-routes-chat-app-api.route-manifest.json'), {
    kind: 'sdkwork.route.manifest',
    surface: 'app-api',
    packageName: 'sdkwork-routes-chat-app-api',
    routes: [{ method: 'GET', path: '/app/v3/api/chat/messages', operationId: 'chat.messages.list' }],
  });

  const resolution = resolveComposition(root);

  assert.ok(resolution.architecture.components.some((entry) => entry.name === '@sdkwork/demo-pc-chat'));
  assert.ok(resolution.architecture.frontend.packages.some((entry) => entry.name === '@sdkwork/demo-pc-chat'));
  assert.ok(resolution.architecture.rust.crates.some((entry) => entry.packageName === 'sdkwork-demo-chat-service'));
  assert.ok(resolution.architecture.routes.manifests.some((entry) => entry.packageName === 'sdkwork-routes-chat-app-api'));
  assert.ok(resolution.architecture.runtime.dependencyApiSurfaces.some((entry) => entry.workspace === 'sdkwork-iam-app-sdk'));
});

test('standards repositories are exempt from consumer SDK dependency requirements', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-composition-standards-'));
  writeText(path.join(root, 'README.md'), '# SDKWork Standards\n\nrepository-kind: standards\n');

  const resolution = resolveComposition(root);

  assert.equal(resolution.issues.includes('no sdkDependencies found in consumer core component.spec.json files'), false);
});

test('resolveComposition classifies sibling internal SDKs on the internal service plane', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-composition-internal-'));
  const root = path.join(workspaceRoot, 'sdkwork-demo');
  const appRoot = path.join(root, 'apps/sdkwork-demo-pc');
  writeJson(path.join(root, 'agent.app.config.json'), {
    schemaVersion: 3,
    kind: 'agent.app',
    app: { key: 'sdkwork-demo' },
  });
  writeJson(path.join(appRoot, 'agent.app.config.json'), {
    schemaVersion: 3,
    kind: 'agent.app',
    app: { key: 'sdkwork-demo' },
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/package.json'), {
    name: '@sdkwork/demo-pc-core',
    version: '0.0.0',
  });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-core/specs/component.spec.json'), {
    component: {
      name: '@sdkwork/demo-pc-core',
      type: 'frontend-core',
      surface: 'app',
    },
    contracts: {
      sdkDependencies: [{ workspace: 'sdkwork-drive-internal-sdk' }],
    },
  });
  createSdkFamily(path.join(workspaceRoot, 'sdkwork-drive'), 'sdkwork-drive-internal-sdk', {
    sdkOwner: 'sdkwork-drive',
    apiAuthority: 'sdkwork-drive-internal-api',
    sdkTarget: 'internal',
    apiPrefix: '/internal/v3/api',
  });

  try {
    const resolution = resolveComposition(root);
    const internal = resolution.integrations.find(
      (entry) => entry.workspace === 'sdkwork-drive-internal-sdk',
    );

    assert.deepEqual(resolution.issues, []);
    assert.ok(internal);
    assert.equal(internal.surface, 'internal-api');
    assert.equal(internal.apiPrefix, '/internal/v3/api');
    assert.equal(internal.sdkOwner, 'sdkwork-drive');
    assert.equal(internal.connectivityPlane, 'platform');
    assert.equal(internal.runtimeMode, 'external-via-platform-surface');
    assert.equal(internal.envKey, 'SDKWORK_DRIVE_INTERNAL_API_BASE_URL');
    assert.equal(
      resolution.meta.credentialModes['sdkwork-drive-internal-sdk'],
      'ingress-token',
    );
  } finally {
    fs.rmSync(workspaceRoot, { force: true, recursive: true });
  }
});
