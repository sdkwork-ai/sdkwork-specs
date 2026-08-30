import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { alignOpenApiOperationPatterns } from './lib/align-api-operation-patterns.mjs';
import { classifyOpenApiOperationPatterns } from './lib/api-operation-patterns.mjs';

function document(paths) {
  return { openapi: '3.1.2', info: { title: 'test', version: '1.0.0' }, paths };
}

test('alignOpenApiOperationPatterns aligns create and delete status contracts', () => {
  const input = document({
    '/app/v3/api/items': {
      post: {
        operationId: 'items.add',
        responses: { 200: { description: 'created' }, default: { description: 'problem' } },
      },
    },
    '/app/v3/api/items/{itemId}': {
      delete: {
        operationId: 'items.remove',
        responses: {
          200: {
            description: 'deleted',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          default: { description: 'problem' },
        },
      },
    },
  });

  const first = alignOpenApiOperationPatterns(input);
  assert.ok(first.changes > 0);
  assert.equal(input.paths['/app/v3/api/items'].post.operationId, 'items.create');
  assert.ok(input.paths['/app/v3/api/items'].post.responses['201']);
  assert.equal(input.paths['/app/v3/api/items/{itemId}'].delete.operationId, 'items.delete');
  assert.deepEqual(input.paths['/app/v3/api/items/{itemId}'].delete.responses['204'], { description: 'deleted' });
  assert.equal(classifyOpenApiOperationPatterns(JSON.stringify(input)).length, 0);

  const second = alignOpenApiOperationPatterns(input);
  assert.equal(second.changes, 0);
});

test('alignOpenApiOperationPatterns preserves command and stream contracts', () => {
  const input = document({
    '/backend/v3/api/indexes/{indexId}/rebuild': {
      post: {
        operationId: 'indexes.rebuild',
        responses: { 202: { description: 'accepted' }, default: { description: 'problem' } },
      },
    },
    '/app/v3/api/sessions/{sessionId}/events': {
      get: {
        operationId: 'sessions.events.stream',
        responses: {
          200: { description: 'events', content: { 'text/event-stream': { schema: { type: 'string' } } } },
        },
      },
    },
  });

  const result = alignOpenApiOperationPatterns(input);
  assert.equal(result.changes, 0);
  assert.equal(classifyOpenApiOperationPatterns(JSON.stringify(input)).length, 0);
});

test('workspace aligner writes YAML authorities and is idempotent', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-operation-aligner-'));
  const authority = path.join(workspace, 'sdkwork-test', 'apis', 'app-api', 'test', 'openapi.yaml');
  fs.mkdirSync(path.dirname(authority), { recursive: true });
  fs.writeFileSync(authority, `
openapi: 3.1.2
info:
  title: test
  version: 1.0.0
paths:
  /app/v3/api/items:
    post:
      operationId: items.add
      responses:
        '200':
          description: created
`, 'utf8');

  const tool = path.resolve(import.meta.dirname, 'align-api-operation-patterns-workspace.mjs');
  const first = spawnSync(process.execPath, [tool, '--workspace', workspace], { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(fs.readFileSync(authority, 'utf8'), /operationId: items\.create/u);
  assert.match(fs.readFileSync(authority, 'utf8'), /'201':/u);

  const second = spawnSync(process.execPath, [tool, '--workspace', workspace, '--dry-run'], { encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /would align 0 files \(0 changes\)/u);
});

test('alignOpenApiOperationPatterns strips duplicated tag root from operationId', () => {
  const input = document({
    '/app/v3/api/wallet/overview': {
      get: {
        tags: ['wallet'],
        operationId: 'wallet.overview.retrieve',
        responses: { 200: { description: 'ok' } },
      },
    },
  });

  const result = alignOpenApiOperationPatterns(input);
  assert.ok(result.changes > 0);
  assert.equal(input.paths['/app/v3/api/wallet/overview'].get.operationId, 'overview.retrieve');
  assert.equal(classifyOpenApiOperationPatterns(JSON.stringify(input)).length, 0);
});

test('alignOpenApiOperationPatterns converts int64 integer to string with marker', () => {
  const input = {
    ...document({}),
    components: {
      schemas: {
        CartItem: {
          type: 'object',
          properties: { quantity: { type: 'integer', format: 'int64' } },
        },
      },
    },
  };

  const result = alignOpenApiOperationPatterns(input);
  assert.ok(result.changes > 0);
  assert.equal(input.components.schemas.CartItem.properties.quantity.type, 'string');
  assert.equal(input.components.schemas.CartItem.properties.quantity['x-sdkwork-int64-string'], true);
  assert.equal(classifyOpenApiOperationPatterns(JSON.stringify(input)).length, 0);
});

test('alignOpenApiOperationPatterns closes idempotency header contract', () => {
  const input = document({
    '/app/v3/api/items': {
      post: {
        operationId: 'items.create',
        'x-sdkwork-idempotent': true,
        responses: { 201: { description: 'created' } },
      },
    },
  });

  const result = alignOpenApiOperationPatterns(input);
  assert.ok(result.changes > 0);
  const post = input.paths['/app/v3/api/items'].post;
  const header = post.parameters.find((p) => p.name === 'Idempotency-Key');
  assert.ok(header);
  assert.equal(header.required, true);
  assert.deepEqual(header.schema, { type: 'string', minLength: 1, maxLength: 128 });
  assert.equal(classifyOpenApiOperationPatterns(JSON.stringify(input)).length, 0);
});

test('workspace aligner preserves JSON-compatible YAML source formatting', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-operation-json-yaml-aligner-'));
  const authority = path.join(workspace, 'sdkwork-test', 'apis', 'app-api', 'test', 'openapi.yaml');
  fs.mkdirSync(path.dirname(authority), { recursive: true });
  fs.writeFileSync(authority, `${JSON.stringify({
    openapi: '3.1.2',
    info: { title: 'test', version: '1.0.0' },
    paths: {
      '/app/v3/api/items': {
        post: {
          operationId: 'items.add',
          responses: { 200: { description: 'created' } },
        },
      },
    },
  }, null, 2)}\n`, 'utf8');

  const tool = path.resolve(import.meta.dirname, 'align-api-operation-patterns-workspace.mjs');
  const result = spawnSync(process.execPath, [tool, '--workspace', workspace], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = fs.readFileSync(authority, 'utf8');
  assert.equal(output.trimStart().startsWith('{'), true);
  assert.equal(JSON.parse(output).paths['/app/v3/api/items'].post.operationId, 'items.create');
});
