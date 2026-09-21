import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  authorityOf,
  bindAuthority,
  dependencyNamedBy,
  derivedLoopbackInRust,
  expandShellDefault,
  inProcessDependencies,
  moduleOfRepo,
  parseComposeEnvironment,
  parseEnv,
  rustSources,
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

// --- Rule D: runtime-derived loopback base URLs in Rust source --------------
//
// The declaration rules above only see authored profiles. A backend that reads
// its own ingress bind and formats `http://127.0.0.1:{port}` at runtime is the
// same violation, and it is exactly the shape that produced the production
// `Bad gateway` incident: the process dialled its own listener while the
// dependency was already composed in-process.

test('derivedLoopbackInRust reports an outbound base URL built from the own ingress bind', () => {
  const source = [
    'pub const ENV_CLOUDROUTER_INGRESS_BIND: &str =',
    '    "SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_INGRESS_BIND";',
    '',
    'pub fn cloudrouter_base_url() -> String {',
    '    if let Ok(explicit) = env::var(ENV_CLOUDROUTER_BASE_URL) {',
    '        return explicit;',
    '    }',
    '    if let Ok(bind) = env::var(ENV_CLOUDROUTER_INGRESS_BIND) {',
    '        if let Some(port) = port_of(&bind) {',
    '            return format!("http://127.0.0.1:{port}");',
    '        }',
    '    }',
    '    DEFAULT_CLOUDROUTER_BASE_URL.to_string()',
    '}',
  ].join('\n');

  assert.equal(derivedLoopbackInRust(source), 'http://127.0.0.1:{port}');
});

test('derivedLoopbackInRust reports an injected loopback base URL for an embedded dependency', () => {
  const source = [
    'fn seed_process_env(port: u16) {',
    '    env::set_var(',
    '        "SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_INGRESS_BIND",',
    '        format!("127.0.0.1:{port}"),',
    '    );',
    '    env::set_var(',
    '        "SDKWORK_CLOUDROUTER_APPLICATION_OPEN_HTTP_URL",',
    '        format!("http://127.0.0.1:{port}"),',
    '    );',
    '}',
  ].join('\n');

  assert.equal(derivedLoopbackInRust(source), 'http://127.0.0.1:{port}');
});

test('derivedLoopbackInRust ignores a listener bind resolver', () => {
  const source = [
    'fn resolve_bind(port: u16) -> String {',
    '    let bind_address = format!("127.0.0.1:{port}");',
    '    bind_address',
    '}',
  ].join('\n');

  assert.equal(derivedLoopbackInRust(source), null);
});

test('derivedLoopbackInRust ignores a CORS allow-list entry', () => {
  const source = [
    'fn allowed_origins(port: u16) -> Vec<String> {',
    '    let mut origins: Vec<String> = Vec::new();',
    '    origins.push(format!("http://127.0.0.1:{port}"));',
    '    origins',
    '}',
  ].join('\n');

  assert.equal(derivedLoopbackInRust(source), null);
});

test('derivedLoopbackInRust ignores scaffolding inside an inline test module', () => {
  const source = [
    'pub fn boot() { /* production path with no loopback */ }',
    '',
    '#[cfg(test)]',
    'mod tests {',
    '    #[test]',
    '    fn spawns_a_server() {',
    '        let base_url = format!("http://127.0.0.1:{port}");',
    '        assert!(base_url.starts_with("http://127.0.0.1"));',
    '    }',
    '}',
  ].join('\n');

  assert.equal(derivedLoopbackInRust(source), null);
});

test('derivedLoopbackInRust ignores a line that assigns the ingress bind itself', () => {
  // A test fixture supplying the bind its value is listener configuration, not
  // an outbound client target, even when it sits in production-looking code.
  const source = [
    'fn fixture() {',
    '    env::set_var("SDKWORK_AGENTS_APPLICATION_PUBLIC_INGRESS_BIND", format!("127.0.0.1:{port}"));',
    '}',
  ].join('\n');

  assert.equal(derivedLoopbackInRust(source), null);
});

test('derivedLoopbackInRust ignores a hard-coded loopback client with no own listener', () => {
  // `ENV_X = "http://127.0.0.1:9"` is a separately owned concern; this rule is
  // about reading *this process's* listener, so it must stay silent.
  const source = [
    'pub const DEFAULT_BASE_URL: &str = "http://127.0.0.1:3900";',
    'fn base_url() -> &\'static str { DEFAULT_BASE_URL }',
  ].join('\n');

  assert.equal(derivedLoopbackInRust(source), null);
});

test('derivedLoopbackInRust ignores comments that name the prohibited pattern', () => {
  // A rule that reports its own rationale teaches readers to delete the
  // rationale. The doc comment explaining the prohibition must not be a finding.
  const source = [
    '/// Reading the bind and formatting `http://127.0.0.1:{port}` from it is',
    '/// forbidden (APPLICATION_GATEWAY_SPEC §2.3).',
    'pub fn cloudrouter_base_url_optional() -> Option<String> { None }',
    '// `http://127.0.0.1:{port}` from the bind dials the process itself.',
    '// SAFETY: nothing to do here.',
  ].join('\n');

  assert.equal(derivedLoopbackInRust(source), null);
});

test('rustSources skips test directories and test-named files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-loop-rs-'));
  write(path.join(root, 'crates/a/src/lib.rs'), 'pub fn a() {}\n');
  write(path.join(root, 'crates/a/src/test_helper.rs'), 'pub fn t() {}\n');
  write(path.join(root, 'crates/a/tests/bootstrap.rs'), 'fn t() {}\n');
  write(path.join(root, 'crates/a/src/bind_test.rs'), 'fn t() {}\n');
  write(path.join(root, 'src/main.rs'), 'fn main() {}\n');

  const relative = rustSources(root).map((file) => path.relative(root, file).replaceAll('\\', '/')).sort();
  assert.deepEqual(relative, ['crates/a/src/lib.rs', 'src/main.rs']);
});

test('rule D flags the violating repository and leaves a clean one alone', () => {
  const root = workspaceFixture({
    repos: [
      {
        name: 'sdkwork-agents',
        env: {
          'etc/topology/standalone.development.env':
            'SDKWORK_AGENTS_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3910',
        },
      },
      {
        name: 'sdkwork-cloudrouter',
        env: {
          'etc/topology/standalone.development.env':
            'SDKWORK_CLOUDROUTER_ROUTER_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3905',
        },
      },
    ],
  });
  write(
    path.join(root, 'sdkwork-agents/crates/sdkwork-agents-tool-cloudrouter/src/client.rs'),
    [
      'pub const ENV_INGRESS_BIND: &str =',
      '    "SDKWORK_AGENTS_APPLICATION_PUBLIC_INGRESS_BIND";',
      'pub fn cloudrouter_base_url() -> String {',
      '    if let Ok(bind) = env::var(ENV_INGRESS_BIND) {',
      '        if let Some(port) = port_of(&bind) {',
      '            return format!("http://127.0.0.1:{port}");',
      '        }',
      '    }',
      '    "http://127.0.0.1:3900".to_string()',
      '}',
    ].join('\n'),
  );

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^EMBEDDED-DERIVED-LOOPBACK /);
  assert.match(findings[0], /sdkwork-agents\/crates\/sdkwork-agents-tool-cloudrouter\/src\/client\.rs/);
});

test('an empty workspace is a failure, never a silent pass', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-loop-empty-'));
  const { findings, repositories } = validateEmbeddedSelfLoop(root);
  assert.equal(repositories, 0);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^SCAN-ROOT-EMPTY /);
});

test('a workspace with repositories but no deployment profile is a failure', () => {
  const root = workspaceFixture({ repos: [{ name: 'sdkwork-empty', env: {} }] });
  const { findings, repositories, profiles } = validateEmbeddedSelfLoop(root);
  assert.equal(repositories, 1);
  assert.equal(profiles, 0);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^SCAN-PROFILES-EMPTY /);
});

// --- Rule E: base-URL / bind resolution must not be re-implemented ----------

test('rule E flags a repository that re-implements the profile-to-mode classification', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-webserver',
      env: {
        'etc/topology/standalone.development.env':
          'SDKWORK_WEBSERVER_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3900',
      },
    }],
  });
  write(
    path.join(root, 'sdkwork-webserver/crates/core/src/module_imports.rs'),
    [
      'pub fn resolve_import_profile(profile: Option<&str>) -> Result<String, String> {',
      '    if let Some(profile) = profile {',
      '        if profile == "standalone" || profile == "cloud" {',
      '            return Ok(profile.to_owned());',
      '        }',
      '    }',
      '    Ok("standalone".to_owned())',
      '}',
    ].join('\n'),
  );

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^BASE-URL-RESOLUTION-DUPLICATED /);
  assert.match(findings[0], /profile-to-mode classification/);
  assert.match(findings[0], /APP_SDK_INTEGRATION_SPEC/);
});

test('rule E flags an inline listener-bind port parse', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-webserver',
      env: {
        'etc/topology/standalone.development.env':
          'SDKWORK_WEBSERVER_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3900',
      },
    }],
  });
  write(
    path.join(root, 'sdkwork-webserver/crates/core/src/listener.rs'),
    [
      'pub fn port_of(ingress_bind: &str) -> Option<u16> {',
      '    let (_, port) = ingress_bind.rsplit_once(\':\')?;',
      '    port.parse().ok()',
      '}',
    ].join('\n'),
  );

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /inline listener-bind port parse/);
});

test('rule E exempts the shared component that owns the resolution', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-utils',
      env: {
        'etc/topology/standalone.development.env':
          'SDKWORK_UTILS_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3920',
      },
    }],
  });
  write(
    path.join(root, 'sdkwork-utils/packages/sdkwork-utils-rust/src/service_base_url.rs'),
    [
      'pub fn mode_of_deployment_profile(profile: Option<&str>) -> ServiceMode {',
      '    match profile.map(str::trim) {',
      '        Some(profile) if profile.eq_ignore_ascii_case("standalone") => ServiceMode::Embedded,',
      '        _ => ServiceMode::Split,',
      '    }',
      '}',
      'pub fn bind_port(bind: &str) -> Option<u16> {',
      '    let (_, port) = bind.trim().rsplit_once(\':\')?;',
      '    port.parse::<u16>().ok()',
      '}',
    ].join('\n'),
  );

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('rule E leaves unrelated or_else chains and timestamp parsing alone', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-documents',
      env: {
        'etc/topology/standalone.development.env':
          'SDKWORK_DOCUMENTS_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3930',
      },
    }],
  });
  write(
    path.join(root, 'sdkwork-documents/crates/core/src/misc.rs'),
    [
      'fn path_of(base_url: Option<&str>) -> String {',
      '    let p = configured.or_else(|| base_url.and_then(url_path));',
      '    p.unwrap_or_default()',
      '}',
      'fn merged(existing: Option<&Map>) -> Value {',
      '    trimmed_string(input, "base_url").or_else(|| existing.and_then(|r| r.get("base_url").cloned()))',
      '}',
      'fn parse_unix(value: &str) -> i64 {',
      '    let parts: Vec<&str> = value.split_whitespace().collect();',
      '    let time_parts: Vec<i64> = parts[1].split(\':\').filter_map(|s| s.parse().ok()).collect();',
      '    time_parts[0]',
      '}',
    ].join('\n'),
  );

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('rule E does not fire on a file that delegates to the shared component', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-agents',
      env: {
        'etc/topology/standalone.development.env':
          'SDKWORK_AGENTS_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3910',
      },
    }],
  });
  write(
    path.join(root, 'sdkwork-agents/crates/tool/src/client.rs'),
    [
      'use sdkwork_utils_rust::service_base_url::{mode_of_deployment_profile, resolve};',
      'pub fn resolve_cloudrouter_base_url() -> ResolvedBaseUrl {',
      '    let request = ServiceBaseUrlRequest::new(',
      '        "cloudrouter",',
      '        mode_of_deployment_profile(deployment_profile().as_deref()),',
      '    );',
      '    resolve(&request)',
      '}',
    ].join('\n'),
  );

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('rule E does not fire inside an inline #[cfg(test)] module', () => {
  const root = workspaceFixture({
    repos: [{
      name: 'sdkwork-webserver',
      env: {
        'etc/topology/standalone.development.env':
          'SDKWORK_WEBSERVER_APPLICATION_PUBLIC_INGRESS_BIND=0.0.0.0:3900',
      },
    }],
  });
  write(
    path.join(root, 'sdkwork-webserver/crates/core/src/lib.rs'),
    [
      'pub fn real() {}',
      '#[cfg(test)]',
      'mod tests {',
      '    #[test]',
      '    fn parses() {',
      '        let profile = "standalone";',
      '        assert!(profile == "standalone" || profile == "cloud");',
      '    }',
      '}',
    ].join('\n'),
  );

  const { findings } = validateEmbeddedSelfLoop(root);
  assert.equal(findings.length, 0, JSON.stringify(findings));
});
