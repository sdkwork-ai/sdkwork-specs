import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyOpenApiOperationPatterns } from './lib/api-operation-patterns.mjs';

const CHECKER = path.resolve(import.meta.dirname, 'check-api-operation-patterns.mjs');

function openApi(paths) {
  return JSON.stringify(
    {
      openapi: '3.1.2',
      info: { title: 'operation patterns', version: '1.0.0' },
      paths,
      components: {
        schemas: {
          SdkWorkApiResponse: { type: 'object' },
          SdkWorkPageData: { type: 'object' },
          ProblemDetail: { type: 'object' },
        },
      },
    },
    null,
    2,
  );
}

function idempotencyKeyParameter(overrides = {}) {
  return {
    name: 'Idempotency-Key',
    in: 'header',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
    ...overrides,
  };
}

test('classifyOpenApiOperationPatterns rejects idempotency markers without required headers', () => {
  const issues = classifyOpenApiOperationPatterns(openApi({
    '/app/v3/api/users': {
      post: {
        operationId: 'users.create',
        'x-sdkwork-idempotent': true,
        responses: { 201: { description: 'created' } },
      },
    },
  }));

  assert.ok(issues.some((issue) => issue.kind === 'idempotency-header-missing'));
});

test('classifyOpenApiOperationPatterns rejects idempotency headers without markers', () => {
  const issues = classifyOpenApiOperationPatterns(openApi({
    '/app/v3/api/users': {
      post: {
        operationId: 'users.create',
        parameters: [idempotencyKeyParameter()],
        responses: { 201: { description: 'created' } },
      },
    },
  }));

  assert.ok(issues.some((issue) => issue.kind === 'idempotency-marker-missing'));
});

test('classifyOpenApiOperationPatterns rejects optional idempotency headers', () => {
  const issues = classifyOpenApiOperationPatterns(openApi({
    '/app/v3/api/users': {
      post: {
        operationId: 'users.create',
        'x-sdkwork-idempotent': true,
        parameters: [idempotencyKeyParameter({ required: false })],
        responses: { 201: { description: 'created' } },
      },
    },
  }));

  assert.ok(issues.some((issue) => issue.kind === 'idempotency-header-required'));
});

test('classifyOpenApiOperationPatterns accepts JSON shared idempotency parameters', () => {
  const document = JSON.parse(openApi({
    '/app/v3/api/users': {
      post: {
        operationId: 'users.create',
        'x-sdkwork-idempotent': true,
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        responses: { 201: { description: 'created' } },
      },
    },
  }));
  document.components.parameters = { IdempotencyKey: idempotencyKeyParameter() };

  assert.deepEqual(classifyOpenApiOperationPatterns(JSON.stringify(document)), []);
});

test('classifyOpenApiOperationPatterns accepts YAML shared idempotency parameters', () => {
  const issues = classifyOpenApiOperationPatterns(`
openapi: 3.1.2
paths:
  /app/v3/api/users:
    post:
      operationId: users.create
      x-sdkwork-idempotent: true
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '201':
          description: created
components:
  parameters:
    IdempotencyKey:
      name: Idempotency-Key
      in: header
      required: true
      schema:
        type: string
        minLength: 1
        maxLength: 128
`);

  assert.deepEqual(issues, []);
});

test('classifyOpenApiOperationPatterns exempts external protocol idempotency semantics', () => {
  const issues = classifyOpenApiOperationPatterns(openApi({
    '/v1/jobs': {
      post: {
        operationId: 'jobsCreate',
        'x-sdkwork-wire-protocol': 'external',
        'x-sdkwork-external-protocol-id': 'vendor-v1',
        'x-sdkwork-idempotent': true,
        responses: { 200: { description: 'vendor response' } },
      },
    },
  }));

  assert.deepEqual(issues, []);
});

test('classifyOpenApiOperationPatterns flags create operations that do not return 201', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/app/v3/api/users': {
        post: {
          operationId: 'users.create',
          responses: {
            200: { description: 'wrong create status' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.ok(issues.some((issue) => issue.kind === 'create-status'));
});

test('classifyOpenApiOperationPatterns flags delete operations that return JSON success bodies', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/app/v3/api/users/{userId}': {
        delete: {
          operationId: 'users.delete',
          responses: {
            200: {
              description: 'wrong delete body',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SdkWorkApiResponse' },
                },
              },
            },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.ok(issues.some((issue) => issue.kind === 'delete-status'));
});

test('classifyOpenApiOperationPatterns flags search operationId drift', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/app/v3/api/users/search': {
        post: {
          operationId: 'users.list',
          responses: {
            200: { description: 'search response' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.ok(issues.some((issue) => issue.kind === 'operation-id-action'));
});

test('classifyOpenApiOperationPatterns rejects operationIds that repeat the SDK tag namespace', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/app/v3/api/catalog/products': {
        get: {
          tags: ['catalog'],
          operationId: 'catalog.products.list',
          responses: {
            200: { description: 'catalog products' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.ok(issues.some((issue) => issue.kind === 'operation-id-tag-duplication'));
  assert.ok(issues.some((issue) => issue.detail.includes('must not repeat tag catalog')));
});

test('classifyOpenApiOperationPatterns skips external compatibility operations', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/v1/chat/completions': {
        post: {
          operationId: 'chatCompletionsCreate',
          'x-sdkwork-wire-protocol': 'external',
          'x-sdkwork-external-protocol-id': 'openai-v1',
          responses: {
            200: { description: 'OpenAI response' },
          },
        },
      },
    }),
  );

  assert.equal(issues.length, 0);
});

test('classifyOpenApiOperationPatterns accepts singleton retrieve GET operations without path parameters', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/app/v3/api/auth/sessions/current': {
        get: {
          operationId: 'sessions.current.retrieve',
          responses: {
            200: { description: 'current session' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.equal(issues.length, 0);
});

test('classifyOpenApiOperationPatterns requires singleton summary GET operations to use retrieve', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/app/v3/api/comments/threads/{threadId}/summary': {
        get: {
          operationId: 'comments.threads.summary',
          responses: {
            200: { description: 'thread summary' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.ok(issues.some((issue) => issue.detail.includes('operationId action retrieve')));
});

test('classifyOpenApiOperationPatterns accepts explicit nested list GET operations ending in a parameter', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/app/v3/api/music/charts/{chartId}': {
        get: {
          operationId: 'charts.entries.list',
          responses: {
            200: { description: 'chart entries' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.equal(issues.length, 0);
});

test('classifyOpenApiOperationPatterns accepts redirect-only callback operations', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/app/v3/api/github/integration/oauth/callback': {
        get: {
          operationId: 'integration.oauth.callback',
          responses: {
            302: { description: 'redirect' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.equal(issues.length, 0);
});

test('classifyOpenApiOperationPatterns accepts SSE operations with the stream action', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/app/v3/api/device/terminal/sessions/{sessionId}/events': {
        get: {
          operationId: 'device.terminal.sessions.events.stream',
          responses: {
            200: {
              description: 'event stream',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.equal(issues.length, 0);
});

test('classifyOpenApiOperationPatterns recognizes snake-case command suffixes', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/backend/v3/api/ai/route_explain': {
        post: {
          operationId: 'routeExplain.explain',
          responses: {
            200: { description: 'route explanation' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.equal(issues.length, 0);
});

test('classifyOpenApiOperationPatterns accepts nested collection create operations', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/backend/v3/api/iam/organizations/{organizationId}/members': {
        post: {
          operationId: 'organizations.members.create',
          responses: {
            201: { description: 'created member' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.equal(issues.length, 0);
});

test('classifyOpenApiOperationPatterns accepts resource command operations with stable verbs', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/backend/v3/api/iam/users/{userId}/restore': {
        post: {
          operationId: 'users.restore',
          responses: {
            200: { description: 'restored user' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.equal(issues.length, 0);
});

test('classifyOpenApiOperationPatterns accepts domain-specific command verbs', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/im/v3/api/chat/messages/{messageId}/unpin': {
        post: {
          operationId: 'messages.unpin',
          responses: {
            200: { description: 'unpinned message' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.equal(issues.length, 0);
});

test('classifyOpenApiOperationPatterns reports domain-specific command operationId drift with the path action', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/im/v3/api/chat/messages/{messageId}/unpin': {
        post: {
          operationId: 'messages.pin.delete',
          responses: {
            200: { description: 'unpinned message' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.ok(issues.some((issue) => issue.detail.includes('operationId action unpin')));
});

test('classifyOpenApiOperationPatterns accepts collection command operations with stable verbs', () => {
  const issues = classifyOpenApiOperationPatterns(
    openApi({
      '/app/v3/api/messaging/verification_codes/verify': {
        post: {
          operationId: 'verificationCodes.verify',
          responses: {
            200: { description: 'verified code' },
            default: { description: 'problem' },
          },
        },
      },
    }),
  );

  assert.equal(issues.length, 0);
});

test('classifyOpenApiOperationPatterns flags YAML create status drift', () => {
  const issues = classifyOpenApiOperationPatterns(`
openapi: 3.1.2
paths:
  /app/v3/api/users:
    post:
      operationId: users.create
      responses:
        '200':
          description: wrong create status
        default:
          description: problem
`);

  assert.ok(issues.some((issue) => issue.kind === 'create-status'));
});

test('classifyOpenApiOperationPatterns flags YAML colon bulk path operationId drift', () => {
  const issues = classifyOpenApiOperationPatterns(`
openapi: 3.1.2
paths:
  /app/v3/api/users:bulkCreate:
    post:
      operationId: users.create
      responses:
        '200':
          description: wrong bulk action
        default:
          description: problem
`);

  assert.ok(issues.some((issue) => issue.kind === 'operation-id-action'));
});

test('classifyOpenApiOperationPatterns flags quoted YAML colon search path operationId drift', () => {
  const issues = classifyOpenApiOperationPatterns(`
openapi: 3.1.2
paths:
  "/app/v3/api/users:search":
    post:
      operationId: users.list
      responses:
        '200':
          description: wrong search action
        default:
          description: problem
`);

  assert.ok(issues.some((issue) => issue.kind === 'operation-id-action'));
});

test('checker reports operation-pattern violations for repo OpenAPI authorities', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-operation-patterns-'));
  const authority = path.join(root, 'apis', 'app-api', 'iam', 'openapi.json');
  fs.mkdirSync(path.dirname(authority), { recursive: true });
  fs.writeFileSync(
    authority,
    `${openApi({
      '/app/v3/api/users': {
        post: {
          operationId: 'users.create',
          responses: {
            200: { description: 'wrong create status' },
            default: { description: 'problem' },
          },
        },
      },
    })}\n`,
    'utf8',
  );

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /create-status/);
});

test('checker scans every same-surface OpenAPI authority instead of one preferred file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-operation-patterns-authorities-'));
  const goodAuthority = path.join(root, 'apis', 'app-api', 'aaa-good', 'openapi.json');
  const badAuthority = path.join(root, 'apis', 'app-api', 'zzz-bad', 'openapi.json');
  fs.mkdirSync(path.dirname(goodAuthority), { recursive: true });
  fs.mkdirSync(path.dirname(badAuthority), { recursive: true });
  fs.writeFileSync(
    goodAuthority,
    `${openApi({
      '/app/v3/api/good-users': {
        post: {
          operationId: 'users.create',
          responses: {
            201: { description: 'created' },
            default: { description: 'problem' },
          },
        },
      },
    })}\n`,
    'utf8',
  );
  fs.writeFileSync(
    badAuthority,
    `${openApi({
      '/app/v3/api/bad-users': {
        post: {
          operationId: 'users.create',
          responses: {
            200: { description: 'wrong create status' },
            default: { description: 'problem' },
          },
        },
      },
    })}\n`,
    'utf8',
  );

  const result = spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /zzz-bad/);
  assert.match(result.stderr, /create-status/);
});

function moneyDocument(properties) {
  return JSON.stringify({
    openapi: '3.1.2',
    info: { title: 'money units', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        Amounts: { type: 'object', properties },
      },
    },
  });
}

test('classifyOpenApiOperationPatterns requires a money-unit marker on monetary int64 fields', () => {
  const issues = classifyOpenApiOperationPatterns(moneyDocument({
    totalAmount: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
  }));
  assert.ok(
    issues.some((issue) => issue.kind === 'money-unit-marker-missing'),
    'a monetary amount without x-sdkwork-money-unit must be reported',
  );
});

test('classifyOpenApiOperationPatterns rejects a non-minor money unit', () => {
  const issues = classifyOpenApiOperationPatterns(moneyDocument({
    paidAmount: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
      'x-sdkwork-money-unit': 'major',
    },
  }));
  assert.ok(
    issues.some((issue) => issue.kind === 'money-unit-not-minor'),
    'x-sdkwork-money-unit: major must be rejected per API_SPEC 13.2.1',
  );
});

test('classifyOpenApiOperationPatterns accepts a declared minor-unit money field', () => {
  const issues = classifyOpenApiOperationPatterns(moneyDocument({
    totalAmount: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
      'x-sdkwork-money-unit': 'minor',
      'x-sdkwork-money-currency': 'CNY',
    },
  }));
  assert.equal(
    issues.filter((issue) => issue.kind.startsWith('money-unit')).length,
    0,
    'a fully declared minor-unit amount must pass',
  );
});

test('classifyOpenApiOperationPatterns does not flag non-monetary counters', () => {
  const issues = classifyOpenApiOperationPatterns(moneyDocument({
    totalRequestCount: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
    totalUsers: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
    totalInvited: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
    points: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
  }));
  assert.equal(
    issues.filter((issue) => issue.kind.startsWith('money-unit')).length,
    0,
    'counters, tallies, and unit balances are not money and must not require a currency marker',
  );
});

test('classifyOpenApiOperationPatterns matches monetary vocabulary on word segments, not substrings', () => {
  const issues = classifyOpenApiOperationPatterns(moneyDocument({
    // `feedbackId` contains the substring `fee` but is an identifier. Substring
    // matching reported every feedback id as an undeclared monetary amount.
    feedbackId: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
    feedbackCount: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
  }));
  assert.equal(
    issues.filter((issue) => issue.kind.startsWith('money-unit')).length,
    0,
    'identifiers that merely embed monetary substrings must not require a currency marker',
  );
});

test('classifyOpenApiOperationPatterns still flags genuine monetary fields after segment matching', () => {
  const issues = classifyOpenApiOperationPatterns(moneyDocument({
    feeMinor: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
    creditAmount: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
    subTotal: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
  }));
  const flagged = issues.filter((issue) => issue.kind === 'money-unit-marker-missing');
  assert.equal(
    flagged.length,
    3,
    'feeMinor, creditAmount, and subTotal are monetary and must each be reported',
  );
});

test('classifyOpenApiOperationPatterns exempts documents marked openai-compatible', () => {
  const document = JSON.parse(moneyDocument({
    totalAmount: {
      type: 'string',
      format: 'int64',
      pattern: '^[0-9]+$',
      'x-sdkwork-int64-string': true,
    },
  }));
  document['x-sdkwork-int64-openai-compat'] = true;
  const issues = classifyOpenApiOperationPatterns(JSON.stringify(document));
  assert.equal(
    issues.filter((issue) => issue.kind.startsWith('money-unit')).length,
    0,
    'the vendor wire-protocol exemption also covers the money-unit closure',
  );
});
