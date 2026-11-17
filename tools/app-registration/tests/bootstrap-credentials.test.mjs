#!/usr/bin/env node

/**
 * Tests for the dual-token credential bootstrap.
 *
 * The suite drives the loopback fake in `fake-bootstrap-iam.mjs`, which enforces
 * the two rules that make this chain fragile in reality:
 *
 * - the session login refuses a request that does not present a live bootstrap
 *   `Access-Token`, and
 * - a login replaces the sessions of the same application on the same device, so
 *   an unscoped login silently revokes the credential the Deploy API needs.
 *
 * @module app-registration/tests/bootstrap-credentials
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BOOTSTRAP_SETTINGS_ENV,
  BootstrapCredentialError,
  DEFAULT_MANAGEMENT_DEVICE_ID,
  IAM_ACCESS_CREDENTIALS_PATH,
  IAM_SESSION_LOGIN_PATH,
  buildReport,
  createBootstrapCredentialClient,
  decodeTokenClaims,
  parseArgs,
  renderEnvAssignments,
  resolveBootstrapSettings,
  restrictCredentialFile,
  runMain,
  writeCredentialFile,
} from '../bootstrap-credentials.mjs';
import { FAKE_IAM_FIXTURE, startFakeBootstrapIam } from './fake-bootstrap-iam.mjs';

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function patternFor(message) {
  return new RegExp(message, 'u');
}

test('resolveBootstrapSettings names the missing IAM base URL', () => {
  assert.throws(
    () => resolveBootstrapSettings({}, {}),
    (error) => error instanceof BootstrapCredentialError
      && error.stage === 'config'
      && patternFor(BOOTSTRAP_SETTINGS_ENV.iamBaseUrl[0]).test(error.message),
  );
});

test('resolveBootstrapSettings names the missing operator password', () => {
  assert.throws(
    () => resolveBootstrapSettings({ iamBaseUrl: 'http://127.0.0.1:3901', username: 'operator' }, {}),
    (error) => error instanceof BootstrapCredentialError
      && error.stage === 'config'
      && patternFor(BOOTSTRAP_SETTINGS_ENV.password[0]).test(error.message),
  );
});

test('resolveBootstrapSettings reads the environment aliases and defaults', () => {
  const settings = resolveBootstrapSettings(
    {},
    {
      [BOOTSTRAP_SETTINGS_ENV.iamBaseUrl[1]]: 'http://127.0.0.1:3901/',
      [BOOTSTRAP_SETTINGS_ENV.username[0]]: 'operator',
      [BOOTSTRAP_SETTINGS_ENV.password[0]]: 'secret',
      [BOOTSTRAP_SETTINGS_ENV.tenantId[0]]: '100001',
    },
  );
  assert.equal(settings.iamBaseUrl, 'http://127.0.0.1:3901/');
  assert.equal(settings.appId, 'sdkwork-iam');
  assert.equal(settings.organizationId, '0');
  assert.equal(settings.deviceId, DEFAULT_MANAGEMENT_DEVICE_ID);
  assert.equal(settings.tenantId, '100001');
});

test('bootstrap mints both pairs and keeps the credential session live', async (t) => {
  const fake = await startFakeBootstrapIam();
  t.after(() => fake.close());
  const client = createBootstrapCredentialClient({
    iamBaseUrl: fake.baseUrl,
    username: FAKE_IAM_FIXTURE.username,
    password: FAKE_IAM_FIXTURE.password,
    appId: FAKE_IAM_FIXTURE.appId,
    tenantId: FAKE_IAM_FIXTURE.tenantId,
    organizationId: FAKE_IAM_FIXTURE.organizationId,
    deviceId: DEFAULT_MANAGEMENT_DEVICE_ID,
  });
  const result = await client.bootstrap();

  assert.ok(result.deploy.accessToken);
  assert.ok(result.deploy.authToken);
  assert.ok(result.management.accessToken);
  assert.ok(result.management.authToken);
  assert.notEqual(result.deploy.accessToken, result.management.accessToken);

  const credentialSession = fake.credentialSessions()[0];
  assert.equal(credentialSession.revokedAt, null, 'the device-scoped login must not revoke it');
  assert.equal(fake.requests.length, 2);
  assert.equal(fake.requests[0].path, IAM_ACCESS_CREDENTIALS_PATH);
  assert.equal(fake.requests[1].path, IAM_SESSION_LOGIN_PATH);

  const deployClaims = decodeTokenClaims(result.deploy.accessToken);
  assert.equal(deployClaims.app_id, FAKE_IAM_FIXTURE.appId);
  assert.equal(deployClaims.aud, FAKE_IAM_FIXTURE.appId);
  const managementClaims = decodeTokenClaims(result.management.accessToken);
  assert.equal(managementClaims.device_id, undefined);
  assert.equal(managementClaims.session_id, fake.sessions.at(-1).id);

  const report = buildReport(result, client.requests);
  const serialized = JSON.stringify(report);
  for (const token of [
    result.deploy.accessToken,
    result.deploy.authToken,
    result.management.accessToken,
    result.management.authToken,
  ]) {
    assert.equal(serialized.includes(token), false, 'the report must never carry a token');
  }
  assert.equal(report.deployCredential.route, IAM_ACCESS_CREDENTIALS_PATH);
  assert.equal(report.managementSession.route, IAM_SESSION_LOGIN_PATH);
  assert.equal(report.deployCredential.appId, FAKE_IAM_FIXTURE.appId);
});

test('a login without a device id would revoke the credential session', async (t) => {
  const fake = await startFakeBootstrapIam();
  t.after(() => fake.close());
  const client = createBootstrapCredentialClient({
    iamBaseUrl: fake.baseUrl,
    username: FAKE_IAM_FIXTURE.username,
    password: FAKE_IAM_FIXTURE.password,
    appId: FAKE_IAM_FIXTURE.appId,
    tenantId: FAKE_IAM_FIXTURE.tenantId,
    organizationId: FAKE_IAM_FIXTURE.organizationId,
    deviceId: '',
  });
  await client.bootstrap();
  const credentialSession = fake.credentialSessions()[0];
  assert.notEqual(
    credentialSession.revokedAt,
    null,
    'the fake must model the collision the tool avoids with deviceId',
  );
});

test('bootstrap sends a non-empty device id to every management session', async (t) => {
  const fake = await startFakeBootstrapIam();
  t.after(() => fake.close());
  const client = createBootstrapCredentialClient({
    iamBaseUrl: fake.baseUrl,
    username: FAKE_IAM_FIXTURE.username,
    password: FAKE_IAM_FIXTURE.password,
    appId: FAKE_IAM_FIXTURE.appId,
    tenantId: FAKE_IAM_FIXTURE.tenantId,
    organizationId: FAKE_IAM_FIXTURE.organizationId,
    deviceId: 'registration-run-1',
  });
  await client.bootstrap();
  const loginRequest = fake.requests.find((entry) => entry.path === IAM_SESSION_LOGIN_PATH);
  assert.equal(loginRequest.body.deviceId, 'registration-run-1');
  assert.equal(loginRequest.headers['access-token'], fake.credentialSessions()[0].accessToken);
});

test('a rejected credential call names the deploy-credential link', async (t) => {
  const fake = await startFakeBootstrapIam({ failCredential: true });
  t.after(() => fake.close());
  const client = createBootstrapCredentialClient({
    iamBaseUrl: fake.baseUrl,
    username: FAKE_IAM_FIXTURE.username,
    password: FAKE_IAM_FIXTURE.password,
    appId: FAKE_IAM_FIXTURE.appId,
    tenantId: FAKE_IAM_FIXTURE.tenantId,
    organizationId: FAKE_IAM_FIXTURE.organizationId,
  });
  await assert.rejects(
    () => client.bootstrap(),
    (error) => error instanceof BootstrapCredentialError
      && error.stage === 'deploy-credential'
      && error.status === 401
      && error.code === '40101'
      && error.path === IAM_ACCESS_CREDENTIALS_PATH
      && patternFor(IAM_ACCESS_CREDENTIALS_PATH).test(error.message),
  );
});

test('an unknown appId is refused as a missing installation', async (t) => {
  const fake = await startFakeBootstrapIam();
  t.after(() => fake.close());
  const client = createBootstrapCredentialClient({
    iamBaseUrl: fake.baseUrl,
    username: FAKE_IAM_FIXTURE.username,
    password: FAKE_IAM_FIXTURE.password,
    appId: 'sdkwork-not-installed',
    tenantId: FAKE_IAM_FIXTURE.tenantId,
    organizationId: FAKE_IAM_FIXTURE.organizationId,
  });
  await assert.rejects(
    () => client.bootstrap(),
    (error) => error instanceof BootstrapCredentialError
      && error.stage === 'deploy-credential'
      && error.status === 404
      && patternFor('was not found').test(error.message),
  );
});

test('a response without authToken names the unreadable link', async (t) => {
  const fake = await startFakeBootstrapIam({ omitAuthToken: true });
  t.after(() => fake.close());
  const client = createBootstrapCredentialClient({
    iamBaseUrl: fake.baseUrl,
    username: FAKE_IAM_FIXTURE.username,
    password: FAKE_IAM_FIXTURE.password,
    appId: FAKE_IAM_FIXTURE.appId,
    tenantId: FAKE_IAM_FIXTURE.tenantId,
    organizationId: FAKE_IAM_FIXTURE.organizationId,
  });
  await assert.rejects(
    () => client.bootstrap(),
    (error) => error instanceof BootstrapCredentialError
      && error.stage === 'deploy-credential'
      && patternFor('accessToken/authToken').test(error.message),
  );
});

test('an unreachable IAM gateway names the base URL and stage', async () => {
  const client = createBootstrapCredentialClient({
    iamBaseUrl: 'http://127.0.0.1:1',
    username: FAKE_IAM_FIXTURE.username,
    password: FAKE_IAM_FIXTURE.password,
    appId: FAKE_IAM_FIXTURE.appId,
    timeoutMs: 2000,
    maxAttempts: 1,
  });
  await assert.rejects(
    () => client.bootstrap(),
    (error) => error instanceof BootstrapCredentialError
      && error.stage === 'deploy-credential'
      && error.retryable === true
      && patternFor('unreachable').test(error.message),
  );
});

test('renderEnvAssignments emits the six registration assignments', async (t) => {
  const fake = await startFakeBootstrapIam();
  t.after(() => fake.close());
  const client = createBootstrapCredentialClient({
    iamBaseUrl: fake.baseUrl,
    username: FAKE_IAM_FIXTURE.username,
    password: FAKE_IAM_FIXTURE.password,
    appId: FAKE_IAM_FIXTURE.appId,
  });
  const result = await client.bootstrap();
  const withoutDeploy = renderEnvAssignments(result);
  assert.deepEqual(
    withoutDeploy.map((line) => line.split('=')[0]),
    [
      'SDKWORK_IAM_BACKEND_API_BASE_URL',
      'SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN',
      'SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN',
      'SDKWORK_IAM_MANAGEMENT_ACCESS_TOKEN',
      'SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN',
    ],
  );
  const withDeploy = renderEnvAssignments(result, 'http://127.0.0.1:3900');
  assert.ok(withDeploy.includes('SDKWORK_DEPLOY_BACKEND_API_BASE_URL=http://127.0.0.1:3900'));
});

test('the credential file is written with the assignment lines and restricted', () => {
  const directory = temporaryDirectory('sdkwork-bootstrap-credentials-');
  const target = path.join(directory, 'registration.env');
  const written = writeCredentialFile(target, ['A=1', 'B=2']);
  assert.equal(written, path.resolve(target));
  assert.equal(fs.readFileSync(target, 'utf8'), 'A=1\nB=2\n');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  }
  assert.doesNotThrow(() => restrictCredentialFile(target));
});

test('parseArgs rejects an unknown option and a missing value', () => {
  assert.throws(() => parseArgs(['--nope']), (error) => error.stage === 'config');
  assert.throws(() => parseArgs(['--iam-base-url']), (error) => error.stage === 'config');
  assert.throws(
    () => parseArgs(['--timeout-ms', '0']),
    (error) => error.stage === 'config' && patternFor('positive').test(error.message),
  );
});

test('runMain writes the env file and a redacted report', async (t) => {
  const fake = await startFakeBootstrapIam();
  t.after(() => fake.close());
  const directory = temporaryDirectory('sdkwork-bootstrap-cli-');
  const outPath = path.join(directory, 'registration.env');
  const reportPath = path.join(directory, 'report.json');
  let stdout = '';
  let stderr = '';
  const code = await runMain(
    [
      '--iam-base-url', fake.baseUrl,
      '--deploy-base-url', 'http://127.0.0.1:3900',
      '--username', FAKE_IAM_FIXTURE.username,
      '--password', FAKE_IAM_FIXTURE.password,
      '--app-id', FAKE_IAM_FIXTURE.appId,
      '--out', outPath,
      '--report', reportPath,
    ],
    {},
    { stdout: (chunk) => { stdout += chunk; }, stderr: (chunk) => { stderr += chunk; } },
  );
  assert.equal(code, 0);
  const file = fs.readFileSync(outPath, 'utf8');
  assert.match(file, /SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN=/u);
  assert.match(file, /SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN=/u);
  assert.match(stdout, /wrote 6 assignment\(s\)/u);
  assert.match(stderr, /redacted report written/u);

  const report = fs.readFileSync(reportPath, 'utf8');
  const parsed = JSON.parse(report);
  assert.equal(parsed.kind, 'sdkwork.bootstrap-credentials-report');
  const accessToken = /SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN=(?<token>.+)/u.exec(file).groups.token;
  assert.equal(report.includes(accessToken), false);
});

test('runMain returns 2 for unusable configuration', async () => {
  let stderr = '';
  const code = await runMain([], {}, { stdout: () => {}, stderr: (chunk) => { stderr += chunk; } });
  assert.equal(code, 2);
  assert.match(stderr, /config link failed/u);
});

test('runMain returns 1 when a link of the chain fails', async (t) => {
  const fake = await startFakeBootstrapIam({ failCredential: true });
  t.after(() => fake.close());
  let stderr = '';
  const code = await runMain(
    [
      '--iam-base-url', fake.baseUrl,
      '--username', FAKE_IAM_FIXTURE.username,
      '--password', FAKE_IAM_FIXTURE.password,
    ],
    {},
    { stdout: () => {}, stderr: (chunk) => { stderr += chunk; } },
  );
  assert.equal(code, 1);
  assert.match(stderr, /deploy-credential link failed/u);
});

test('runMain --help prints the chain and exits 0', async () => {
  let stdout = '';
  const code = await runMain(['--help'], {}, { stdout: (chunk) => { stdout += chunk; }, stderr: () => {} });
  assert.equal(code, 0);
  assert.match(stdout, /bootstrap-credentials/u);
  assert.match(stdout, /SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN/u);
  assert.match(stdout, /SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN/u);
});
