import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  authorityOf,
  bindAuthority,
  dependencyNamedBy,
  expandShellDefault,
  inProcessDependencies,
  moduleOfRepo,
  parseComposeEnvironment,
  parseEnv,
  tomlBinds,
  validateEmbeddedSelfLoop,
} from './lib/embedded-self-loop.mjs';

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('authorityOf reduces loopback URLs to a host-independent authority', () => {
  assert.equal(authorityOf('http://127.0.0.1:3905/backend/v3/api'), 'loopback:3905');
  assert.equal(authorityOf('http://localhost:18089'), 'loopback:18089');
  assert.equal(authorityOf('http://0.0.0.0:3905'), 'loopback:3905');
  // A routable external origin is a real separate process, not a self-loop.
  assert.equal(authorityOf('https://membership.internal.example.com/api'), null);
  assert.equal(authorityOf('/backend/v3/api'), null);
});

test('bindAuthority accepts both bare binds and full URLs', () => {
  assert.equal(bindAuthority('0.0.0.0:3905'), 'loopback:3905');
  assert.equal(bindAuthority('http://127.0.0.1:3905'), 'loopback:3905');
  assert.equal(bindAuthority('0.0.0.0:3905 '), 'loopback:3905');
  assert.equal(bindAuthority('3905'), null);
});

test('parseEnv strips quotes and comments and tolerates CRLF', () => {
  const entries = parseEnv(
    '# leading comment\r\nA=1\r\nB="http://127.0.0.1:1"\r\nC=\'x\'\r\n\r\nNOEQUALS\r\n',
  );
  assert.deepEqual(entries, [
    { key: 'A', value: '1', line: 2 },
    { key: 'B', value: 'http://127.0.0.1:1', line: 3 },
    { key: 'C', value: 'x', line: 4 },
  ]);
});

test('moduleOfRepo strips only the sdkwork- prefix', () => {
  assert.equal(moduleOfRepo('sdkwork-cloudrouter'), 'cloudrouter');
  assert.equal(moduleOfRepo('sdkwork-api-cloud-gateway'), 'api-cloud-gateway');
  assert.equal(moduleOfRepo('other-repo'), null);
});

test('inProcessDependencies reads embedded assemblies from every Cargo manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-loop-deps-'));
  write(path.join(root, 'Cargo.toml'), '[dependencies]\nsdkwork-api-community-assembly = { workspace = true }\n');
  write(
    path.join(root, 'crates/sdkwork-api-im-assembly/Cargo.toml'),
    '[dependencies]\nsdkwork-api-feeds-assembly.workspace = true\nsdkwork-api-news-assembly.workspace = true\n',
  );
  assert.deepEqual([...inProcessDependencies(root)].sort(), ['community', 'feeds', 'news']);
});

test('dependencyNamedBy resolves the dependency, not the consumer', () => {
  // `SDKWORK_FEEDS_COMMUNITY_OPEN_API_BASE_URL` names `community`; the leading
  // `FEEDS` token is the consumer application that declares the variable.
  assert.equal(
    dependencyNamedBy('SDKWORK_FEEDS_COMMUNITY_OPEN_API_BASE_URL', new Set(['community', 'feeds']), 'feeds'),
    'community',
  );
  assert.equal(
    dependencyNamedBy('SDKWORK_MEMBERSHIP_BACKEND_API_BASE_URL', new Set(['membership']), 'cloudrouter'),
    'membership',
  );
  // A repository embedding itself is not a dependency reference.
  assert.equal(dependencyNamedBy('SDKWORK_IM_OPEN_API_BASE_URL', new Set(['im']), 'im'), null);
  assert.equal(dependencyNamedBy('SDKWORK_DRIVE_BACKEND_API_BASE_URL', new Set(['community']), 'cloudrouter'), null);
});

function workspaceFixture({ repos }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-loop-ws-'));
  for (const repo of repos) {
    write(path.join(root, repo.name, 'Cargo.toml'), `[workspace]\nmembers = []\n\n[dependencies]\n${repo.cargoDeps ?? ''}`);
    for (const [rel, content] of Object.entries(repo.env ?? {})) {
      write(path.join(root, repo.name, rel), content);
    }
  }
  return root;
}

test('rule A flags a dependency URL that targets the application own ingress', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-cloudrouter',
      cargoDeps: 'sdkwork-api-community-assembly = { workspace = true }\n',
      env: {
        'etc/topology/standalone.development.env': [
          'SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3905',
          'SDKWORK_MEMBERSHIP_BACKEND_API_BASE_URL=http://127.0.0.1:3905/backend/v3/api',
        ].join('\n'),
      },
    }],
  });

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^SELF-LOOP /);
  assert.match(findings[0], /SDKWORK_MEMBERSHIP_BACKEND_API_BASE_URL/);
});

test('rule A ignores browser-facing variables: a browser hop is not a self-loop', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-cloudrouter',
      env: {
        'etc/topology/standalone.development.env': [
          'SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3905',
          'VITE_SDKWORK_MEMBERSHIP_BACKEND_API_BASE_URL=http://127.0.0.1:3905/backend/v3/api',
          'SDKWORK_PORTAL_BROWSER_API_ORIGIN=http://127.0.0.1:3905',
        ].join('\n'),
      },
    }],
  });

  assert.deepEqual(validateEmbeddedSelfLoop(root).findings, []);
});

test('rule A ignores a routable external origin: that is a real separate process', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-cloudrouter',
      cargoDeps: 'sdkwork-api-community-assembly = { workspace = true }\n',
      env: {
        'etc/topology/standalone.development.env': [
          'SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3905',
          'SDKWORK_MEMBERSHIP_BACKEND_API_BASE_URL=https://membership.example.com/backend/v3/api',
        ].join('\n'),
      },
    }],
  });

  assert.deepEqual(validateEmbeddedSelfLoop(root).findings, []);
});

test('rule B flags a dependency URL pointing at another module composed in-process', () => {
  const root = workspaceFixture({
    repos: [
      {
        name: 'sdkwork-membership',
        env: {
          'etc/topology/standalone.development.env':
            'SDKWORK_MEMBERSHIP_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3902',
        },
      },
      {
        name: 'sdkwork-cloudrouter',
        cargoDeps: 'sdkwork-api-membership-assembly = { workspace = true }\n',
        env: {
          'etc/topology/standalone.development.env': [
            'SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3905',
            'SDKWORK_MEMBERSHIP_BACKEND_API_BASE_URL=http://127.0.0.1:3902/backend/v3/api',
          ].join('\n'),
        },
      },
    ],
  });

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^EMBEDDED-LOCAL-DEP /);
  assert.match(findings[0], /sdkwork-membership over HTTP/);
});

test('rule B allows a cross-process call to a module that is not embedded', () => {
  const root = workspaceFixture({
    repos: [
      {
        name: 'sdkwork-membership',
        env: {
          'etc/topology/standalone.development.env':
            'SDKWORK_MEMBERSHIP_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3902',
        },
      },
      {
        name: 'sdkwork-cloudrouter',
        env: {
          'etc/topology/standalone.development.env': [
            'SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3905',
            'SDKWORK_MEMBERSHIP_BACKEND_API_BASE_URL=http://127.0.0.1:3902/backend/v3/api',
          ].join('\n'),
        },
      },
    ],
  });

  assert.deepEqual(validateEmbeddedSelfLoop(root).findings, []);
});

test('rule C flags a loopback URL naming an in-process dependency', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-im',
      cargoDeps: 'sdkwork-api-community-assembly = { workspace = true }\n',
      env: {
        'etc/topology/standalone.development.env': [
          'SDKWORK_IM_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:18089',
          'SDKWORK_FEEDS_COMMUNITY_OPEN_API_BASE_URL=http://127.0.0.1:18094',
        ].join('\n'),
      },
    }],
  });

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^EMBEDDED-DECLARED-URL /);
  assert.match(findings[0], /for community/);
});

test('onlyRepo keeps the workspace index while reporting one repository', () => {
  const root = workspaceFixture({
    repos: [
      {
        name: 'sdkwork-membership',
        env: {
          'etc/topology/standalone.development.env':
            'SDKWORK_MEMBERSHIP_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3902',
        },
      },
      {
        name: 'sdkwork-cloudrouter',
        cargoDeps: 'sdkwork-api-membership-assembly = { workspace = true }\n',
        env: {
          'etc/topology/standalone.development.env': [
            'SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3905',
            'SDKWORK_MEMBERSHIP_BACKEND_API_BASE_URL=http://127.0.0.1:3902/backend/v3/api',
          ].join('\n'),
        },
      },
    ],
  });

  const scoped = validateEmbeddedSelfLoop(root, { onlyRepo: 'sdkwork-cloudrouter' });
  assert.equal(scoped.repositories, 1);
  // The rule B verdict still needs membership's ingress, so it is found.
  assert.equal(scoped.findings.length, 1);

  const other = validateEmbeddedSelfLoop(root, { onlyRepo: 'sdkwork-membership' });
  assert.deepEqual(other.findings, []);
});

test('expandShellDefault unwraps the compose default, which is what actually runs', () => {
  assert.equal(
    expandShellDefault('${GATEWAY_CLOUDROUTER_OPEN_API_BASE_URL:-http://127.0.0.1:3900}'),
    'http://127.0.0.1:3900',
  );
  assert.equal(expandShellDefault('https://cloudrouter.example.com'), 'https://cloudrouter.example.com');
  // A bare reference has no default to inspect, so nothing is asserted on it.
  assert.equal(expandShellDefault('${GATEWAY_HOST}'), '');
});

test('parseComposeEnvironment reads both mapping and list spellings and drops comments', () => {
  const entries = parseComposeEnvironment([
    'services:',
    '  gateway:',
    '    environment:',
    '      # Empty = accept all Host headers (comments carry "=" constantly)',
    '      SDKWORK_CLOUDROUTER_OPEN_API_BASE_URL: ${GATEWAY_X:-http://127.0.0.1:3900}',
    "      SDKWORK_RTC_STATE_REQUIRE_DURABLE: 'true'",
    '      - SDKWORK_LIST_FORM=http://127.0.0.1:3902',
    '    volumes:',
    '      - ./etc:/etc',
  ].join('\n'));

  assert.deepEqual(entries, [
    { key: 'SDKWORK_CLOUDROUTER_OPEN_API_BASE_URL', value: '${GATEWAY_X:-http://127.0.0.1:3900}' },
    { key: 'SDKWORK_RTC_STATE_REQUIRE_DURABLE', value: 'true' },
    { key: 'SDKWORK_LIST_FORM', value: 'http://127.0.0.1:3902' },
  ]);
});

test('tomlBinds reads runtime TOML ingress declarations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-loop-toml-'));
  write(
    path.join(root, 'etc/app.development.toml'),
    '[server]\nbind = "127.0.0.1:3900"\n\n[admin]\nbind = "0.0.0.0:3907"\n',
  );
  write(path.join(root, 'etc/other.txt'), 'bind = "127.0.0.1:9999"\n');

  assert.deepEqual([...tomlBinds(root)].sort(), ['loopback:3900', 'loopback:3907']);
});

test('rule A flags a compose default that resolves to the gateway own bind', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-api-cloud-gateway',
      // The gateway declares its ingress in runtime TOML, not as an env var, so
      // an env-only scan would see no owner and silently skip this repository.
      env: {
        'etc/gateway.development.toml': 'bind = "127.0.0.1:3900"',
        'docker-compose.yml': [
          'services:',
          '  gateway:',
          '    environment:',
          '      SDKWORK_CLOUDROUTER_OPEN_API_BASE_URL: ${GATEWAY_X:-http://127.0.0.1:3900}',
        ].join('\n'),
      },
    }],
  });

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^SELF-LOOP /);
  assert.match(findings[0], /docker-compose\.yml/);
});

test('rule B ignores a port shared by another module the variable does not name', () => {
  // Dev profiles reuse loopback ports: sdkwork-deployments and the platform
  // gateway both bind 3900. A CloudRouter URL landing on 3900 is a call to the
  // gateway, not to the deployments module this repository happens to embed.
  const root = workspaceFixture({
    repos: [
      {
        name: 'sdkwork-deployments',
        env: {
          'etc/topology/standalone.development.env':
            'SDKWORK_DEPLOY_APPLICATION_PUBLIC_INGRESS_BIND=127.0.0.1:3900',
        },
      },
      {
        name: 'sdkwork-webserver',
        cargoDeps: 'sdkwork-api-deployments-assembly = { workspace = true }\n',
        env: {
          'deployments/docker/docker-compose.yml': [
            'services:',
            '  webserver:',
            '    environment:',
            '      SDKWORK_CLOUDROUTER_OPEN_API_BASE_URL: http://127.0.0.1:3900',
          ].join('\n'),
        },
      },
    ],
  });

  assert.deepEqual(validateEmbeddedSelfLoop(root).findings, []);
});

test('the audit reports repository and profile counts', () => {
  const root = workspaceFixture({
    repos: [
      { name: 'sdkwork-a', env: { 'etc/one.env': 'SDKWORK_A_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:1' } },
      { name: 'sdkwork-b', env: { 'etc/two.env': 'X=1', 'docker/three.env': 'Y=2' } },
    ],
  });

  const { repositories, profiles } = validateEmbeddedSelfLoop(root);
  assert.equal(repositories, 2);
  assert.equal(profiles, 3);
});
