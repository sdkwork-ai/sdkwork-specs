import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  classifyRoutePathCollisions,
  normalizeRoutePath,
} from './lib/route-registry.mjs';
import {
  validateApiAssembly,
} from './validate-api-assembly.mjs';

const CHECKER = path.resolve(import.meta.dirname, 'check-route-path-collisions.mjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function openApi(paths) {
  return {
    openapi: '3.1.2',
    info: { title: 'route registry', version: '1.0.0' },
    paths,
  };
}

test('normalizeRoutePath collapses path template dialects before collision checks', () => {
  assert.equal(normalizeRoutePath('/app/v3/api/users/:userId'), '/app/v3/api/users/{param}');
  assert.equal(normalizeRoutePath('/app/v3/api/users/{id}/'), '/app/v3/api/users/{param}');
  assert.equal(normalizeRoutePath('/app//v3/api/users/<id>'), '/app/v3/api/users/{param}');
});

test('classifyRoutePathCollisions reports duplicate OpenAPI method/path entries on the same surface', () => {
  const routes = [
    {
      source: 'apis/app-api/users/openapi.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/users/{userId}',
    },
    {
      source: 'apis/app-api/profiles/openapi.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/users/:id',
    },
  ];

  const issues = classifyRoutePathCollisions(routes);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'duplicate-route-path');
  assert.match(issues[0].detail, /GET \/app\/v3\/api\/users\/\{param\}/u);
});

test('classifyRoutePathCollisions reconciles source and SDK OpenAPI projections for the same operation', () => {
  const routes = [
    {
      sourceKind: 'openapi',
      projectionKind: 'api-authority',
      source: 'apis/app-api/users/openapi.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/users/{userId}',
      operationId: 'users.retrieve',
    },
    {
      sourceKind: 'openapi',
      projectionKind: 'sdk-authority',
      source: 'sdks/sdkwork-users-app-sdk/openapi/users-app-api.openapi.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/users/:id',
      operationId: 'users.retrieve',
    },
  ];

  const issues = classifyRoutePathCollisions(routes);

  assert.equal(issues.length, 0);
});

test('classifyRoutePathCollisions reconciles duplicate SDK OpenAPI projections for the same operation', () => {
  const routes = [
    {
      sourceKind: 'openapi',
      projectionKind: 'sdk-authority',
      source: 'apps/sdkwork-demo-pc/sdks/sdkwork-users-app-sdk/openapi/users-app-api.openapi.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/users/{userId}',
      operationId: 'users.retrieve',
    },
    {
      sourceKind: 'openapi',
      projectionKind: 'sdk-authority',
      source: 'sdks/sdkwork-users-app-sdk/openapi/users-app-api.openapi.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/users/:id',
      operationId: 'users.retrieve',
    },
  ];

  const issues = classifyRoutePathCollisions(routes);

  assert.equal(issues.length, 0);
});

test('classifyRoutePathCollisions reconciles duplicate route manifest projections for the same operation and route crate', () => {
  const routes = [
    {
      sourceKind: 'route-manifest',
      projectionKind: 'route-manifest',
      source: 'sdks/_route-manifests/app-api/sdkwork-router-comments-app-api.route-manifest.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/comments/comments/{commentId}',
      operationId: 'comments.comments.retrieve',
      routeCrate: 'sdkwork-routes-comments-app-api',
    },
    {
      sourceKind: 'route-manifest',
      projectionKind: 'route-manifest',
      source: 'sdks/_route-manifests/app-api/sdkwork-routes-comments-app-api.route-manifest.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/comments/comments/:id',
      operationId: 'comments.comments.retrieve',
      routeCrate: 'sdkwork-routes-comments-app-api',
    },
  ];

  const issues = classifyRoutePathCollisions(routes);

  assert.equal(issues.length, 0);
});

test('classifyRoutePathCollisions reports non-health owners on reserved health and ready paths', () => {
  const routes = [
    {
      sourceKind: 'route-manifest',
      projectionKind: 'route-manifest',
      source: 'sdks/_route-manifests/app-api/sdkwork-router-xiangqi-app-api.route-manifest.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/system/health',
      operationId: 'xiangqi.health.check',
      routeCrate: 'sdkwork-router-xiangqi-app-api',
    },
    {
      sourceKind: 'route-manifest',
      projectionKind: 'route-manifest',
      source: 'sdks/_route-manifests/app-api/sdkwork-router-xiangqi-app-api.route-manifest.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/system/ready',
      operationId: 'xiangqi.ready.check',
      routeCrate: 'sdkwork-router-xiangqi-app-api',
    },
  ];

  const issues = classifyRoutePathCollisions(routes);

  assert.equal(issues.length, 2);
  assert.ok(issues.every((issue) => issue.kind === 'reserved-route-path-owner'));
});

test('classifyRoutePathCollisions accepts OpenAPI projections of standard health route manifests', () => {
  const routes = [
    {
      sourceKind: 'openapi',
      projectionKind: 'api-authority',
      source: 'apis/app-api/game/dezhou-app-api.openapi.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/system/health',
      operationId: 'dezhou.health.check',
    },
    {
      sourceKind: 'route-manifest',
      projectionKind: 'route-manifest',
      source: 'sdks/_route-manifests/app-api/sdkwork-router-health-app-api.route-manifest.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/system/health',
      operationId: 'dezhou.health.check',
      routeCrate: 'sdkwork-router-health-app-api',
    },
  ];

  const issues = classifyRoutePathCollisions(routes);

  assert.equal(issues.length, 0);
});

test('classifyRoutePathCollisions accepts canonical system health operation ids', () => {
  const routes = [
    {
      sourceKind: 'openapi',
      projectionKind: 'sdk-authority',
      source: 'sdks/sdkwork-birdcoder-app-sdk/openapi/sdkwork-birdcoder-app-api.openapi.json',
      surface: 'app-api',
      method: 'GET',
      path: '/app/v3/api/system/health',
      operationId: 'health.retrieve',
    },
  ];

  const issues = classifyRoutePathCollisions(routes);

  assert.equal(issues.length, 0);
});

test('checker reconciles source and SDK OpenAPI authority projections for the same operation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-route-projection-reconcile-'));
  writeJson(
    path.join(root, 'apis/app-api/users/openapi.json'),
    openApi({
      '/app/v3/api/users/{userId}': {
        get: { operationId: 'users.retrieve', responses: { 200: { description: 'ok' } } },
      },
    }),
  );
  writeJson(
    path.join(root, 'sdks/sdkwork-users-app-sdk/openapi/users-app-api.openapi.json'),
    openApi({
      '/app/v3/api/users/:id': {
        get: { operationId: 'users.retrieve', responses: { 200: { description: 'ok' } } },
      },
    }),
  );

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
});

test('checker still reports distinct operations across OpenAPI authority projections', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-route-projection-collision-'));
  writeJson(
    path.join(root, 'apis/app-api/users/openapi.json'),
    openApi({
      '/app/v3/api/users/{userId}': {
        get: { operationId: 'users.retrieve', responses: { 200: { description: 'ok' } } },
      },
    }),
  );
  writeJson(
    path.join(root, 'sdks/sdkwork-users-app-sdk/openapi/users-app-api.openapi.json'),
    openApi({
      '/app/v3/api/users/:id': {
        get: { operationId: 'profiles.retrieve', responses: { 200: { description: 'ok' } } },
      },
    }),
  );

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate-route-path/u);
});

test('checker reports normalized OpenAPI route collisions across authorities', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-route-collision-openapi-'));
  writeJson(
    path.join(root, 'apis/app-api/users/openapi.json'),
    openApi({
      '/app/v3/api/users/{userId}': {
        get: { operationId: 'users.retrieve', responses: { 200: { description: 'ok' } } },
      },
    }),
  );
  writeJson(
    path.join(root, 'apis/app-api/profiles/openapi.json'),
    openApi({
      '/app/v3/api/users/:id': {
        get: { operationId: 'profiles.retrieve', responses: { 200: { description: 'ok' } } },
      },
    }),
  );

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate-route-path/u);
  assert.match(result.stderr, /users\/openapi\.json/u);
  assert.match(result.stderr, /profiles\/openapi\.json/u);
});

test('checker reconciles a route manifest mirror of an OpenAPI route on the same path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-route-collision-manifest-'));
  writeJson(
    path.join(root, 'apis/app-api/users/openapi.json'),
    openApi({
      '/app/v3/api/users/{userId}': {
        get: { operationId: 'users.retrieve', responses: { 200: { description: 'ok' } } },
      },
    }),
  );
  writeJson(
    path.join(root, 'sdks/_route-manifests/app-api/sdkwork-routes-users-app-api.route-manifest.json'),
    {
      schemaVersion: 1,
      kind: 'sdkwork.route.manifest',
      packageName: 'sdkwork-routes-users-app-api',
      surface: 'app-api',
      routes: [
        {
          method: 'GET',
          path: '/app/v3/api/users/:id',
          operationId: 'users.retrieve',
        },
      ],
    },
  );

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  // The route manifest is a generated mirror of the authority route and is
  // reconciled on the shared physical route, so the registry stays unique.
  assert.equal(result.status, 0, result.stderr);
});

test('checker reconciles aggregate route manifests using route-level source route crate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-route-source-route-crate-'));
  writeJson(
    path.join(root, 'apis/backend-api/models/openapi.json'),
    openApi({
      '/backend/v3/api/ai/model_mappings/resolve': {
        post: {
          operationId: 'modelMappings.resolve',
          'x-sdkwork-source-route-crate': 'sdkwork-routes-models-catalog-backend-api',
          responses: { 200: { description: 'ok' } },
        },
      },
    }),
  );
  writeJson(
    path.join(root, 'sdks/_route-manifests/backend-api/sdkwork-router-backend-api.route-manifest.json'),
    {
      schemaVersion: 1,
      kind: 'sdkwork.route.manifest',
      packageName: 'sdkwork-router-backend-api',
      surface: 'backend-api',
      routes: [
        {
          method: 'POST',
          path: '/backend/v3/api/ai/model_mappings/resolve',
          operationId: 'modelMappings.resolve',
          source: {
            routeCrate: 'sdkwork-routes-models-catalog-backend-api',
            openApiAuthority: 'apis/backend-api/models/openapi.json',
          },
        },
      ],
    },
  );

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
});

test('checker reconciles route manifest projections even with operationId drift on the same physical route', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-route-source-route-crate-drift-'));
  writeJson(
    path.join(root, 'apis/backend-api/models/openapi.json'),
    openApi({
      '/backend/v3/api/ai/model_mappings/resolve': {
        post: {
          operationId: 'modelMappings.resolve',
          'x-sdkwork-source-route-crate': 'sdkwork-routes-models-catalog-backend-api',
          responses: { 200: { description: 'ok' } },
        },
      },
    }),
  );
  writeJson(
    path.join(root, 'sdks/_route-manifests/backend-api/sdkwork-router-backend-api.route-manifest.json'),
    {
      schemaVersion: 1,
      kind: 'sdkwork.route.manifest',
      packageName: 'sdkwork-router-backend-api',
      surface: 'backend-api',
      routes: [
        {
          method: 'POST',
          path: '/backend/v3/api/ai/model_mappings/resolve',
          operationId: 'modelMappings.resolve.create',
          source: {
            routeCrate: 'sdkwork-routes-models-catalog-backend-api',
            openApiAuthority: 'apis/backend-api/models/openapi.json',
          },
        },
      ],
    },
  );

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  // The manifest operationId is a fully-qualified projection of the authority
  // operation; both describe the same installed physical route, so no duplicate.
  assert.equal(result.status, 0, result.stderr);
});

test('checker still reports route manifest projections from unrelated route crates on the same path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-route-manifest-crate-collision-'));
  writeJson(
    path.join(root, 'sdks/_route-manifests/app-api/sdkwork-routes-users-app-api.route-manifest.json'),
    {
      schemaVersion: 1,
      kind: 'sdkwork.route.manifest',
      packageName: 'sdkwork-routes-users-app-api',
      surface: 'app-api',
      routes: [
        {
          method: 'GET',
          path: '/app/v3/api/users/{userId}',
          operationId: 'users.retrieve',
        },
      ],
    },
  );
  writeJson(
    path.join(root, 'sdks/_route-manifests/app-api/sdkwork-routes-profiles-app-api.route-manifest.json'),
    {
      schemaVersion: 1,
      kind: 'sdkwork.route.manifest',
      packageName: 'sdkwork-routes-profiles-app-api',
      surface: 'app-api',
      routes: [
        {
          method: 'GET',
          path: '/app/v3/api/users/:id',
          operationId: 'users.retrieve',
        },
      ],
    },
  );

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  // Two unrelated route crates registering the same physical route is a genuine
  // conflict that the derived-mirror reconciliation must not mask.
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate-route-path/u);
});

test('checker ignores runtime and cargo target route manifest directory variants', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-route-runtime-ignore-'));
  for (const ignoredDir of ['.runtime', 'target-codex-verify']) {
    writeJson(
      path.join(
        root,
        ignoredDir,
        'sdks/_route-manifests/app-api/sdkwork-routes-demo-app-api.route-manifest.json',
      ),
      {
        schemaVersion: 1,
        kind: 'sdkwork.route.manifest',
        packageName: 'sdkwork-routes-demo-app-api',
        surface: 'app-api',
        routes: [
          {
            method: 'GET',
            path: '/app/v3/api/demo/items/{itemId}',
            operationId: `${ignoredDir}.items.retrieve`,
          },
        ],
      },
    );
  }

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
});

test('checker reconciles dependency-owned operations declared by dependency-api-surfaces', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-route-dependency-owned-'));
  writeJson(
    path.join(root, 'specs/dependency-api-surfaces.json'),
    {
      schemaVersion: 1,
      kind: 'sdkwork.dependency-api-surfaces',
      dependencies: [
        {
          workspace: 'sdkwork-models-app-sdk',
          surface: 'app-api',
          dependencyMode: 'consumer-sdk',
          runtimeIntegration: {
            mode: 'same-origin-mounted',
            rustRouteContractCrate: {
              crate: 'sdkwork-routes-models-catalog-app-api',
              executableRouterExport: 'model_catalog_router',
            },
          },
          dependencyOwnedOperations: [
            {
              method: 'GET',
              path: '/app/v3/api/ai/model_rankings',
              operationId: 'modelRankings.list',
              owner: 'sdkwork-models',
            },
          ],
        },
      ],
    },
  );
  writeJson(
    path.join(root, 'apis/app-api/cloudrouter/openapi.json'),
    openApi({
      '/app/v3/api/ai/model_rankings': {
        get: {
          operationId: 'modelRankings.list',
          'x-sdkwork-source-route-crate': 'sdkwork-routes-cloudrouter-app-api',
          responses: { 200: { description: 'ok' } },
        },
      },
    }),
  );
  writeJson(
    path.join(root, 'data/sdkwork-models/apis/app-api/intelligence/openapi.json'),
    openApi({
      '/app/v3/api/ai/model_rankings': {
        get: {
          operationId: 'modelRankings.list',
          'x-sdkwork-source-route-crate': 'sdkwork-routes-models-catalog-app-api',
          responses: { 200: { description: 'ok' } },
        },
      },
    }),
  );
  writeJson(
    path.join(root, 'sdks/_route-manifests/app-api/sdkwork-routes-cloudrouter-app-api.route-manifest.json'),
    {
      schemaVersion: 1,
      kind: 'sdkwork.route.manifest',
      packageName: 'sdkwork-routes-cloudrouter-app-api',
      surface: 'app-api',
      routes: [
        {
          method: 'GET',
          path: '/app/v3/api/ai/model_rankings',
          operationId: 'modelRankings.list',
        },
      ],
    },
  );

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
});

test('validateApiAssembly includes route path collision validation', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-gateway-route-collision-'));
  const root = path.join(workspace, 'sdkwork-shop');
  fs.mkdirSync(root, { recursive: true });
  writeJson(path.join(root, 'sdkwork.app.config.json'), {
    backend: { appId: 'sdkwork-shop' },
  });
  writeText(
    path.join(root, 'Cargo.toml'),
    [
      '[workspace]',
      'members = [',
      '  "crates/sdkwork-routes-shop-app-api",',
      '  "crates/sdkwork-api-shop-assembly"',
      ']',
      '',
    ].join('\n'),
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-shop-app-api/Cargo.toml'),
    '[package]\nname = "sdkwork-routes-shop-app-api"\nversion = "0.0.0"\n',
  );
  writeText(
    path.join(root, 'crates/sdkwork-routes-shop-app-api/src/lib.rs'),
    [
      'pub const APP_API_PREFIX: &str = "/app/v3/api/shop";',
      'pub fn gateway_mount() {}',
      'pub fn gateway_route_manifest() {}',
      '',
    ].join('\n'),
  );
  writeJson(path.join(root, 'crates/sdkwork-api-shop-assembly/assembly-manifest.json'), {
    kind: 'sdkwork.api.assembly',
    schemaVersion: 1,
    applicationCode: 'shop',
    packageName: 'sdkwork-api-shop-assembly',
    routeCrates: [{ packageName: 'sdkwork-routes-shop-app-api' }],
  });
  writeJson(
    path.join(root, 'apis/app-api/users/openapi.json'),
    openApi({
      '/app/v3/api/shop/users/{userId}': {
        get: { operationId: 'users.retrieve', responses: { 200: { description: 'ok' } } },
      },
    }),
  );
  writeJson(
    path.join(root, 'apis/app-api/profiles/openapi.json'),
    openApi({
      '/app/v3/api/shop/users/:id': {
        get: { operationId: 'profiles.retrieve', responses: { 200: { description: 'ok' } } },
      },
    }),
  );

  const result = validateApiAssembly(root);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate-route-path')));
});
