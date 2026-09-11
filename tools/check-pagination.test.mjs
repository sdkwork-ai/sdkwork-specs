import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const CHECKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-pagination.mjs');

function write(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

function makeRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-pagination-check-'));
  write(root, 'package.json', '{"name":"sdkwork-pagination-check"}\n');
  return root;
}

function runChecker(root) {
  return spawnSync(process.execPath, [CHECKER, '--root', root], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
}

describe('check-pagination OpenAPI wire parameter checks', () => {
  it('rejects pageSize query parameters in OpenAPI authorities', () => {
    const root = makeRepo();
    write(root, 'apis/open-api/demo.openapi.yaml', `
openapi: 3.1.0
paths:
  /im/v3/api/chat/inbox:
    get:
      parameters:
        - name: pageSize
          in: query
          schema:
            type: integer
`);

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /pageSize query parameter/);
  });

  it('rejects limit query aliases in OpenAPI authorities', () => {
    const root = makeRepo();
    write(root, 'sdks/sdkwork-demo-sdk/openapi/demo.openapi.yaml', `
openapi: 3.1.0
paths:
  /im/v3/api/chat/inbox:
    get:
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
`);

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /limit query alias/);
  });

  it('allows vendor external OpenAPI operations to preserve upstream pagination query names', () => {
    const root = makeRepo();
    write(root, 'apis/open-api/demo.openapi.json', JSON.stringify({
      openapi: '3.1.0',
      paths: {
        '/v1/files': {
          get: {
            operationId: 'listFiles',
            'x-sdkwork-wire-protocol': 'external',
            'x-sdkwork-external-protocol-id': 'openai-v1',
            parameters: [
              {
                name: 'limit',
                in: 'query',
                schema: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 100,
                },
              },
            ],
          },
        },
        '/google/v1beta/files': {
          get: {
            operationId: 'googleListFiles',
            'x-sdkwork-wire-protocol': 'external',
            'x-sdkwork-external-protocol-id': 'google-gemini-v1beta',
            parameters: [
              {
                name: 'pageSize',
                in: 'query',
                schema: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 100,
                },
              },
            ],
          },
        },
      },
    }, null, 2));
    write(root, 'sdks/sdkwork-open-sdk/openapi/sdkwork-open-sdk.openapi.json', JSON.stringify({
      openapi: '3.1.0',
      paths: {
        '/v1/files': {
          get: {
            operationId: 'listFiles',
            'x-sdkwork-wire-protocol': 'external',
            'x-sdkwork-external-protocol-id': 'openai-v1',
            parameters: [
              {
                name: 'limit',
                in: 'query',
                schema: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 100,
                },
              },
            ],
          },
        },
      },
    }, null, 2));
    write(root, 'sdks/sdkwork-open-sdk/sdkwork-open-sdk-typescript/generated/server-openapi/src/api/files.ts', `
export class FilesApi {
  list(limit?: number) {
    return this.client.get('/v1/files', { queryParams: [{ name: 'limit', value: limit }] });
  }
}
`);

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('accepts canonical page_size query parameters in OpenAPI authorities', () => {
    const root = makeRepo();
    write(root, 'apis/open-api/demo.openapi.yaml', `
openapi: 3.1.0
paths:
  /im/v3/api/chat/inbox:
    get:
      parameters:
        - name: page_size
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 200
`);

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects every forbidden page-size query alias in OpenAPI authorities', () => {
    const root = makeRepo();
    write(root, 'apis/open-api/demo.openapi.yaml', `
openapi: 3.1.0
paths:
  /im/v3/api/chat/inbox:
    get:
      parameters:
        - name: page_no
          in: query
          schema:
            type: integer
        - name: pageNo
          in: query
          schema:
            type: integer
        - name: per_page
          in: query
          schema:
            type: integer
        - name: size
          in: query
          schema:
            type: integer
`);

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /page_no query alias/);
    assert.match(result.stderr, /pageNo query alias/);
    assert.match(result.stderr, /per_page query alias/);
    assert.match(result.stderr, /size query alias/);
  });

  it('rejects page_size query parameters without maximum 200', () => {
    const root = makeRepo();
    write(root, 'apis/open-api/demo.openapi.yaml', `
openapi: 3.1.0
paths:
  /im/v3/api/chat/inbox:
    get:
      parameters:
        - name: page_size
          in: query
          schema:
            type: integer
            minimum: 1
`);

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /page_size query parameter must declare maximum 200/);
  });

  it('accepts a complete unexpired operation-level page-size exception', () => {
    const root = makeRepo();
    write(root, 'apis/app-api/demo.openapi.json', JSON.stringify({
      openapi: '3.1.0',
      paths: {
        '/app/v3/api/demo/files': {
          get: {
            operationId: 'files.list',
            'x-sdkwork-pagination-exception': {
              id: 'EX-2099-0001',
              spec: 'PAGINATION_SPEC.md',
              rule: 'page_size maximum 200',
              owner: 'sdkwork-demo',
              reason: 'Interactive file-system browsing requires a larger first page.',
              risk: 'Larger response payload and frontend DOM growth.',
              expiresAt: '2099-12-31',
              removalPlan: 'Reassess after list virtualization and production telemetry.',
              maximumPageSize: 1000,
              controls: ['Cursor continuation', 'Hard response-page limit'],
            },
            parameters: [{
              name: 'page_size',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 1000 },
            }],
          },
        },
      },
    }, null, 2));

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('accepts a complete YAML operation-level page-size exception', () => {
    const root = makeRepo();
    write(root, 'apis/app-api/demo.openapi.yaml', `
openapi: 3.1.0
paths:
  /app/v3/api/demo/files:
    get:
      operationId: files.list
      x-sdkwork-pagination-exception:
        id: EX-2099-0002
        spec: PAGINATION_SPEC.md
        rule: page_size maximum 200
        owner: sdkwork-demo
        reason: Interactive file-system browsing requires a larger first page.
        risk: Larger response payload and frontend DOM growth.
        expiresAt: 2099-12-31
        removalPlan: Reassess after list virtualization and production telemetry.
        maximumPageSize: 1000
        controls:
          - Cursor continuation
          - Hard response-page limit
      parameters:
        - name: page_size
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 1000
`);

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects incomplete or mismatched operation-level page-size exceptions', () => {
    const root = makeRepo();
    write(root, 'apis/app-api/demo.openapi.json', JSON.stringify({
      openapi: '3.1.0',
      paths: {
        '/app/v3/api/demo/files': {
          get: {
            operationId: 'files.list',
            'x-sdkwork-pagination-exception': {
              id: 'EX-2099-0001',
              spec: 'PAGINATION_SPEC.md',
              rule: 'page_size maximum 200',
              owner: 'sdkwork-demo',
              reason: 'Interactive file-system browsing requires a larger first page.',
              risk: 'Larger response payload and frontend DOM growth.',
              expiresAt: '2099-12-31',
              removalPlan: 'Reassess after list virtualization and production telemetry.',
              maximumPageSize: 500,
              controls: ['Cursor continuation'],
            },
            parameters: [{
              name: 'page_size',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 1000 },
            }],
          },
        },
      },
    }, null, 2));

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /maximumPageSize must equal page_size maximum/);
  });

  it('rejects expired operation-level page-size exceptions', () => {
    const root = makeRepo();
    write(root, 'apis/app-api/demo.openapi.json', JSON.stringify({
      openapi: '3.1.0',
      paths: {
        '/app/v3/api/demo/files': {
          get: {
            operationId: 'files.list',
            'x-sdkwork-pagination-exception': {
              id: 'EX-2000-0001',
              spec: 'PAGINATION_SPEC.md',
              rule: 'page_size maximum 200',
              owner: 'sdkwork-demo',
              reason: 'Legacy file-system browser page size.',
              risk: 'Larger response payload and frontend DOM growth.',
              expiresAt: '2000-01-01',
              removalPlan: 'Reduce the page size after list virtualization.',
              maximumPageSize: 1000,
              controls: ['Cursor continuation'],
            },
            parameters: [{
              name: 'page_size',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 1000 },
            }],
          },
        },
      },
    }, null, 2));

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /pagination-exception is expired/);
  });

  it('rejects list pageInfo schemas without mode', () => {
    const root = makeRepo();
    write(root, 'apis/open-api/demo.openapi.yaml', `
openapi: 3.1.0
components:
  schemas:
    InboxResponse:
      type: object
      properties:
        data:
          type: object
          properties:
            items:
              type: array
              items:
                type: object
            pageInfo:
              type: object
              properties:
                hasMore:
                  type: boolean
                nextCursor:
                  type: string
paths:
  /im/v3/api/chat/inbox:
    get:
      parameters:
        - name: page_size
          in: query
          schema:
            type: integer
            maximum: 200
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InboxResponse'
`);

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /pageInfo schema must include mode/);
  });

  it('rejects pagination aliases in docs and tests', () => {
    const root = makeRepo();
    write(root, 'docs/runbooks/inbox.md', 'curl "/im/v3/api/chat/inbox?pageSize=20"\n');
    write(root, 'services/projection-service/tests/http_smoke_test.rs', `
#[test]
fn inbox_url() {
    let path = "/im/v3/api/chat/inbox?limit=20";
    assert!(!path.is_empty());
}
`);

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /forbidden pageSize query string/);
    assert.match(result.stderr, /forbidden limit query string/);
  });

  it('allows explicit negative tests that assert forbidden pagination aliases are rejected', () => {
    const root = makeRepo();
    write(root, 'services/projection-service/tests/http_smoke_test.rs', `
#[tokio::test]
async fn inbox_route_rejects_pagination_aliases() {
    let legacy_limit_response = router
        .clone()
        .oneshot(signed_request(
            "GET",
            "/app/v3/api/chat/inbox?limit=20",
        ))
        .await
        .unwrap();
    assert_eq!(StatusCode::BAD_REQUEST, legacy_limit_response.status());
    let legacy_limit_payload = json_payload(legacy_limit_response).await;
    assert_eq!(40003, legacy_limit_payload["code"].as_i64().unwrap());
}
`);

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('still rejects tests that exercise pagination aliases without rejection assertions', () => {
    const root = makeRepo();
    write(root, 'services/projection-service/tests/http_smoke_test.rs', `
#[tokio::test]
async fn inbox_route_still_accepts_legacy_limit() {
    let response = router
        .oneshot(signed_request("GET", "/app/v3/api/chat/inbox?limit=20"))
        .await
        .unwrap();
    assert_eq!(StatusCode::OK, response.status());
}
`);

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /forbidden limit query string/);
  });

  it('allows external provider protocol URLs in docs, tests, and provider adapters', () => {
    const root = makeRepo();
    write(root, 'services/payment-service/src/stripe_payment_adapter.rs', `
pub fn statement_path() -> &'static str {
    "/v1/balance_transactions?limit=100&created%5Bgte%5D=1780099200"
}
`);
    write(root, 'services/payment-service/tests/stripe_payment_adapter.rs', `
#[test]
fn statement_path() {
    assert_eq!(
        "/v1/balance_transactions?limit=100&created%5Bgte%5D=1780099200",
        statement_path()
    );
}
`);
    write(root, 'docs/providers/openai.md', 'curl "/v1/models?limit=20"\n');

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('allows external protocol query fragments when nearby context declares an external path', () => {
    const root = makeRepo();
    write(root, 'services/router-service/tests/invocation_request_transform.rs', `
#[test]
fn external_model_list_query_is_preserved() {
    invocation.request = InvocationRequest::new(Method::GET, "/v1/models")
        .with_request_id("req-query")
        .with_query("model=gpt-4o-mini&limit=10");

    SecretResolutionInterceptor::new(resolver())
        .before_dispatch(&mut invocation)
        .await
        .unwrap();

    let request = invocation.dispatch.provider_request.expect("request");
    assert_eq!(
        Some("model=gpt-4o-mini-provider&limit=10"),
        request.query.as_deref()
    );
}
`);

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects generated SDK transport query aliases without treating generated code as authored logic', () => {
    const root = makeRepo();
    write(root, 'sdks/sdkwork-demo-sdk/sdkwork-demo-sdk-csharp/generated/server-openapi/Api/ChatApi.cs', `
public class ChatApi {
  public void InboxRetrieve(int? pageSize = null) {
    _ = new QueryParameterSpec("pageSize", pageSize, "form", true, false, null);
    _ = new QueryParameterSpec("size", pageSize, "form", true, false, null);
  }
}
`);

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /generated SDK transport emits pageSize query/);
    assert.match(result.stderr, /generated SDK transport emits size query/);
  });

  it('rejects forbidden pagination aliases in Rust HTTP Query DTOs', () => {
    const root = makeRepo();
    write(root, 'services/catalog-service/src/api/model_rankings.rs', `
use axum::extract::Query;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ModelRankingsHttpQuery {
    rank_scope: Option<String>,
    limit: Option<i64>,
}

async fn fetch_model_rankings(Query(query): Query<ModelRankingsHttpQuery>) {
    let _ = query;
}
`);

    const result = runChecker(root);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /Rust HTTP Query DTO ModelRankingsHttpQuery exposes forbidden pagination query field limit/);
  });

  it('allows business command request body fields named limit when they are not HTTP Query DTOs', () => {
    const root = makeRepo();
    write(root, 'services/catalog-service/src/api/model_rankings.rs', `
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ModelRankingRefreshHttpRequest {
    rank_scope: Option<String>,
    limit: Option<i64>,
}

async fn refresh(Json(request): Json<ModelRankingRefreshHttpRequest>) {
    let _ = request;
}
`);

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('scans embedded data repositories with their own AGENTS entrypoint', () => {
    const root = makeRepo();
    write(root, 'data/sdkwork-models/AGENTS.md', 'Read ../sdkwork-specs/SOUL.md before executing tasks.\n');
    write(root, 'data/sdkwork-models/package.json', '{"name":"sdkwork-models"}\n');
    write(root, 'data/sdkwork-models/services/catalog-service/src/api/model_rankings.rs', `
use axum::extract::Query;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ModelRankingsHttpQuery {
    limit: Option<i64>,
}

async fn fetch_model_rankings(Query(query): Query<ModelRankingsHttpQuery>) {
    let _ = query;
}
`);

    const result = spawnSync(process.execPath, [CHECKER, '--workspace', root], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /sdkwork-models\/services\/catalog-service\/src\/api\/model_rankings\.rs/);
    assert.match(result.stderr, /forbidden pagination query field limit/);
  });
});
