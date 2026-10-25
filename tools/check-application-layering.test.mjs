import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CHECKER = path.resolve(import.meta.dirname, 'check-application-layering.mjs');

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeRepo(prefix = 'sdkwork-layering-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  writeText(path.join(root, 'AGENTS.md'), '# Repository Guidelines\n');
  return root;
}

function runChecker(args) {
  return spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
}

test('accepts standard Java and TypeScript application layering', () => {
  const root = makeRepo();
  writeText(
    path.join(root, 'services/order/src/main/java/com/sdkwork/demo/order/api/OrderAppApiController.java'),
    'package com.sdkwork.demo.order.api;\nimport com.sdkwork.demo.order.application.OrderService;\nclass OrderAppApiController { private final OrderService service; }\n',
  );
  writeText(
    path.join(root, 'services/order/src/main/java/com/sdkwork/demo/order/application/OrderService.java'),
    'package com.sdkwork.demo.order.application;\nimport com.sdkwork.demo.order.domain.OrderRepository;\nclass OrderService { private final OrderRepository repository; }\n',
  );
  writeText(
    path.join(root, 'services/order/src/main/java/com/sdkwork/demo/order/domain/OrderRepository.java'),
    'package com.sdkwork.demo.order.domain;\ninterface OrderRepository {}\n',
  );
  writeText(
    path.join(root, 'services/order/src/main/java/com/sdkwork/demo/order/infrastructure/persistence/SqlOrderRepository.java'),
    'package com.sdkwork.demo.order.infrastructure.persistence;\nimport com.sdkwork.demo.order.domain.OrderRepository;\nclass SqlOrderRepository implements OrderRepository {}\n',
  );

  const appRoot = path.join(root, 'apps/sdkwork-demo-pc');
  writeJson(path.join(appRoot, 'agent.app.config.json'), { schemaVersion: 1, applicationCode: 'demo' });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-orders/package.json'), {
    name: '@sdkwork/demo-pc-orders',
    version: '0.0.0',
  });
  writeText(
    path.join(appRoot, 'packages/sdkwork-demo-pc-orders/src/pages/OrdersPage.tsx'),
    "import { createOrderServices } from '../services/orderService';\nexport function OrdersPage() { return null; }\n",
  );
  writeText(
    path.join(appRoot, 'packages/sdkwork-demo-pc-orders/src/services/orderService.ts'),
    'export function createOrderServices(input: { client: { orders: { list(): Promise<unknown> } } }) { return input.client.orders.list(); }\n',
  );

  const result = runChecker(['--root', root]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /application layering check passed/u);
});

test('rejects Java controllers that depend on repository or infrastructure layers', () => {
  const root = makeRepo();
  writeText(
    path.join(root, 'services/order/src/main/java/com/sdkwork/demo/order/api/OrderAppApiController.java'),
    'package com.sdkwork.demo.order.api;\nimport com.sdkwork.demo.order.repository.OrderRepository;\nimport org.springframework.transaction.annotation.Transactional;\nclass OrderAppApiController {}\n',
  );

  const result = runChecker(['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /controller must depend on application services/u);
  assert.match(result.stderr, /transactions belong in service\/use-case/u);
});

test('rejects Java repository code that imports HTTP framework concerns', () => {
  const root = makeRepo();
  writeText(
    path.join(root, 'services/order/src/main/java/com/sdkwork/demo/order/repository/OrderRepository.java'),
    'package com.sdkwork.demo.order.repository;\nimport org.springframework.http.ResponseEntity;\nclass OrderRepository { ResponseEntity<String> leak; }\n',
  );

  const result = runChecker(['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repository layer must not depend on HTTP framework types/u);
});

test('rejects frontend UI and service raw HTTP or local SDK construction', () => {
  const root = makeRepo();
  const appRoot = path.join(root, 'apps/sdkwork-demo-pc');
  writeJson(path.join(appRoot, 'agent.app.config.json'), { schemaVersion: 1, applicationCode: 'demo' });
  writeJson(path.join(appRoot, 'packages/sdkwork-demo-pc-orders/package.json'), {
    name: '@sdkwork/demo-pc-orders',
    version: '0.0.0',
  });
  writeText(
    path.join(appRoot, 'packages/sdkwork-demo-pc-orders/src/components/OrderList.tsx'),
    "export async function OrderList() { await fetch('/app/v3/api/orders'); return null; }\n",
  );
  writeText(
    path.join(appRoot, 'packages/sdkwork-demo-pc-orders/src/services/orderService.ts'),
    "import { createClient } from '@sdkwork/demo-app-sdk';\nexport function createOrderService() { return createClient({ baseUrl: '/app/v3/api' }); }\n",
  );

  const result = runChecker(['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /UI layer must not call raw HTTP/u);
  assert.match(result.stderr, /services must receive injected SDK clients/u);
});

test('scans child repositories with --workspace', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-layering-workspace-'));
  const repo = path.join(workspace, 'sdkwork-demo');
  writeText(path.join(repo, 'AGENTS.md'), '# Repository Guidelines\n');
  writeText(
    path.join(repo, 'services/order/src/main/java/com/sdkwork/demo/order/api/OrderAppApiController.java'),
    'package com.sdkwork.demo.order.api;\nimport com.sdkwork.demo.order.infrastructure.persistence.SqlOrderRepository;\nclass OrderAppApiController {}\n',
  );

  const result = runChecker(['--workspace', workspace]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sdkwork-demo/u);
  assert.match(result.stderr, /controller must depend on application services/u);
});
