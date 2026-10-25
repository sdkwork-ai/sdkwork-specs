import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkApplicationCloudGatewayBoundary } from './check-application-cloud-gateway-boundary.mjs';

function appRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-cloud-boundary-'));
  fs.writeFileSync(path.join(root, 'agent.app.config.json'), '{}\n');
  return root;
}

test('accepts an application that only declares surface-oriented remote URLs', () => {
  const root = appRoot();
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'etc', 'cloud.development.env'),
    'SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL=https://demo.sdkwork.com\n',
  );
  assert.equal(checkApplicationCloudGatewayBoundary(root).ok, true);
});

test('rejects application scripts and config that operate the platform cloud gateway', () => {
  const root = appRoot();
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'cargo run -p sdkwork-api-cloud-gateway' } }, null, 2),
  );
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true });
  fs.writeFileSync(path.join(root, 'etc', 'sdkwork-api-cloud-gateway.demo.toml'), 'name = "sdkwork-api-cloud-gateway"\n');
  fs.mkdirSync(path.join(root, 'crates', 'sdkwork-demo-cloud-gateway'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'crates', 'sdkwork-demo-cloud-gateway', 'Cargo.toml'),
    '[package]\nname = "sdkwork-demo-cloud-gateway"\n',
  );
  const result = checkApplicationCloudGatewayBoundary(root);
  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 3);
});

test('rejects the retired foundationApiGateway parallel component contract', () => {
  const root = appRoot();
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'specs', 'component.spec.json'),
    JSON.stringify({
      integration: {
        foundationApiGateway: {
          targetMode: 'shared-gateway',
          gatewayBaseUrlEnv: 'SDKWORK_PLATFORM_URL',
        },
      },
    }, null, 2),
  );

  const result = checkApplicationCloudGatewayBoundary(root);
  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].detail, /foundationApiGateway/u);
});
