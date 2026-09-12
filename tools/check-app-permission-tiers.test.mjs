import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CHECKER = path.resolve(import.meta.dirname, 'check-app-permission-tiers.mjs');

function createWorkspace(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function openApiAppApi({ permission, authTier }) {
  const operation = {
    operationId: 'orders.list',
    responses: { 200: { description: 'ok' } },
  };
  if (permission !== undefined) operation['x-sdkwork-permission'] = permission;
  if (authTier !== undefined) operation['x-sdkwork-auth-tier'] = authTier;
  return {
    openapi: '3.1.2',
    info: { title: 'app-api contract', version: '1.0.0' },
    paths: { '/app/v3/api/birdcoder2/orders': { get: operation } },
  };
}

function run(workspace) {
  return spawnSync(process.execPath, [CHECKER, '--workspace', workspace], {
    encoding: 'utf8',
  });
}

test('workspace without an apis/app-api surface passes instead of crashing', () => {
  const workspace = createWorkspace('sdkwork-app-permission-tiers-no-app-api-');

  const result = run(workspace);

  assert.equal(result.status, 0, `unexpected stderr: ${result.stderr}`);
  assert.equal(result.stdout.trim(), '');
});

test('workspace with an empty apis/app-api surface passes', () => {
  const workspace = createWorkspace('sdkwork-app-permission-tiers-empty-app-api-');
  fs.mkdirSync(path.join(workspace, 'apis/app-api'), { recursive: true });

  const result = run(workspace);

  assert.equal(result.status, 0, `unexpected stderr: ${result.stderr}`);
});

test('checker fails when app-api declares x-sdkwork-permission without tier 3', () => {
  const workspace = createWorkspace('sdkwork-app-permission-tiers-violation-');
  writeJson(
    path.join(workspace, 'apis/app-api/web/openapi.json'),
    openApiAppApi({ permission: 'web.orders.write' }),
  );

  const result = run(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /apis\/app-api\/web\/openapi\.json/u);
  assert.match(result.stdout, /x-sdkwork-auth-tier: 3/u);
  assert.match(result.stdout, /orders\.list/u);
});

test('checker passes when the permission is backed by x-sdkwork-auth-tier 3', () => {
  const workspace = createWorkspace('sdkwork-app-permission-tiers-tier-3-');
  writeJson(
    path.join(workspace, 'apis/app-api/web/openapi.json'),
    openApiAppApi({ permission: 'web.orders.write', authTier: 3 }),
  );

  const result = run(workspace);

  assert.equal(result.status, 0, `unexpected stdout: ${result.stdout}`);
});

test('checker passes when no operation declares x-sdkwork-permission', () => {
  const workspace = createWorkspace('sdkwork-app-permission-tiers-no-permission-');
  writeJson(
    path.join(workspace, 'apis/app-api/web/openapi.json'),
    openApiAppApi({}),
  );

  const result = run(workspace);

  assert.equal(result.status, 0, `unexpected stdout: ${result.stdout}`);
});

test('checker fails when the app-api contract is unparseable JSON', () => {
  const workspace = createWorkspace('sdkwork-app-permission-tiers-bad-json-');
  const filePath = path.join(workspace, 'apis/app-api/web/openapi.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{ "openapi": ', 'utf8');

  const result = run(workspace);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /not valid JSON/u);
});
