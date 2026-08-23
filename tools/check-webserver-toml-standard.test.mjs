import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseTomlSubset, TomlSubsetError } from './webserver/toml.mjs';
import { mergeConfigs } from './webserver/merge.mjs';
import {
  renderNginxConf,
  TYPED_KEYS,
  validateWebserverDir,
  validateWebserverToml,
} from './webserver/validate.mjs';

const VALID_DOC = `
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"
description = "IM module web server"

[nginx]
profile = "http-core-v1"

[main]
user = "sdkwork"
workerProcesses = "auto"
errorLog = "/var/log/sdkwork/im/webserver/error.log warn"

[main.events]
workerConnections = 1024

[http]
sendfile = true
keepaliveTimeout = 75
clientMaxBodySize = "1100m"
serverTokens = "off"

[http.certificates.im]
certFile = "/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/fullchain.pem"
certKeyFile = "/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/privkey.pem"
chainFile = "/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/chain.pem"

[[http.upstream]]
name = "api_backend"
loadBalancing = "least-connections"
keepalive = 32
[[http.upstream.target]]
address = "127.0.0.1:3900"
weight = 1
[[http.upstream.target]]
address = "127.0.0.1:3901"
backup = true

[[http.server]]
listen = ["443 ssl", "80"]
serverName = ["im.sdkwork.com", "www.im.sdkwork.com"]
http2 = true

[http.server.tls]
cert = "im"
protocols = ["TLSv1.2", "TLSv1.3"]

[[http.server.location]]
match = "/api/"
proxyPass = "http://api_backend"
proxySetHeader = ["Host $host", "X-Forwarded-Proto $scheme"]
proxyHttpVersion = "1.1"
proxyWebsocketUpgrade = true
proxyBuffering = false
proxyReadTimeout = "120s"

[[http.server.location]]
match = "/"
root = "/usr/share/sdkwork/im/web/pc"
index = ["index.html"]
tryFiles = ["$uri", "$uri/", "/index.html"]

[[http.server.location]]
match = "= /healthz"
returnStatus = 200
returnBody = "{\\"status\\":\\"ok\\"}"
`;

function parse(text) {
  return parseTomlSubset(text);
}

function errorsOf(doc) {
  return validateWebserverToml(doc).errors;
}

test('toml subset parser: full valid document', () => {
  const doc = parse(VALID_DOC);
  assert.equal(doc.specVersion, 1);
  assert.equal(doc.kind, 'sdkwork.webserver.server');
  assert.equal(doc.id, 'im');
  assert.equal(doc.main.events.workerConnections, 1024);
  assert.equal(doc.http.certificates.im.certFile, '/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/fullchain.pem');
  assert.equal(doc.http.upstream.length, 1);
  assert.equal(doc.http.upstream[0].name, 'api_backend');
  assert.equal(doc.http.upstream[0].target.length, 2);
  assert.equal(doc.http.upstream[0].target[1].backup, true);
  assert.equal(doc.http.server.length, 1);
  assert.equal(doc.http.server[0].tls.cert, 'im');
  assert.deepEqual(doc.http.server[0].tls.protocols, ['TLSv1.2', 'TLSv1.3']);
  assert.equal(doc.http.server[0].location.length, 3);
  assert.equal(doc.http.server[0].location[2].returnBody, '{"status":"ok"}');
});

test('toml subset parser: value forms', () => {
  const doc = parse(`
a = 1
b = 1_000
c = 0x1F
d = 3.14
e = 1e6
f = true
g = [1, 2, 3]
h = ["x", "y"]
i = { p = 1, q = "s" }
j = 'literal \\n string'
k = "escaped \\"quote\\" and \\u0041"
l = [
  1,
  2,
]
m.n.o = "dotted"
`);
  assert.equal(doc.a, 1);
  assert.equal(doc.b, 1000);
  assert.equal(doc.c, 31);
  assert.equal(doc.d, 3.14);
  assert.equal(doc.e, 1e6);
  assert.equal(doc.f, true);
  assert.deepEqual(doc.g, [1, 2, 3]);
  assert.deepEqual(doc.h, ['x', 'y']);
  assert.deepEqual(doc.i, { p: 1, q: 's' });
  assert.equal(doc.j, 'literal \\n string');
  assert.equal(doc.k, 'escaped "quote" and A');
  assert.deepEqual(doc.l, [1, 2]);
  assert.equal(doc.m.n.o, 'dotted');
});

test('toml subset parser: rejected forms', () => {
  assert.throws(() => parse('s = """multi\nline"""'), TomlSubsetError);
  assert.throws(() => parse('d = 1979-05-27'), TomlSubsetError);
  assert.throws(() => parse('t = 07:32:00'), TomlSubsetError);
  assert.throws(() => parse('a = 1\na = 2'), TomlSubsetError);
  assert.throws(() => parse('[http]\n[http]\n'), TomlSubsetError);
  assert.throws(() => parse('x = "bad \\q escape"'), TomlSubsetError);
  assert.throws(() => parse('[http.upstream]\nname = "a"\n[[http.upstream]]\n'), TomlSubsetError);
});

test('toml subset parser: quoted dotted keys for certificate names', () => {
  const doc = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "webserver"

[http.certificates."sdkwork.com"]
certFile = "/etc/sdkwork/certs/letsencrypt/sdkwork.com/fullchain.pem"
certKeyFile = "/etc/sdkwork/certs/letsencrypt/sdkwork.com/privkey.pem"

[[http.server]]
listen = ["443 ssl"]
serverName = ["server.sdkwork.com"]
[http.server.tls]
cert = "sdkwork.com"
`);
  assert.equal(doc.http.certificates['sdkwork.com'].certFile, '/etc/sdkwork/certs/letsencrypt/sdkwork.com/fullchain.pem');
  assert.deepEqual(errorsOf(doc), []);
});

test('validator: valid document passes', () => {
  const { errors, warnings } = validateWebserverToml(parse(VALID_DOC));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('validator: identity and enablement rules (W3, W4, W17)', () => {
  assert.ok(errorsOf(parse(`specVersion = 2\nkind = "sdkwork.webserver.server"\nid = "im"`)).length > 0);
  assert.ok(errorsOf(parse(`specVersion = 1\nkind = "other"\nid = "im"`)).length > 0);
  assert.ok(errorsOf(parse(`specVersion = 1\nkind = "sdkwork.webserver.server"\nid = "IM"`)).length > 0);

  const disabled = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "sdk"
enabled = false
description = "pure SDK module without web surface"
`);
  assert.deepEqual(errorsOf(disabled), []);

  const disabledNoReason = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "sdk"
enabled = false
`);
  assert.ok(errorsOf(disabledNoReason).some((e) => e.includes('description')));

  const enabledNoServer = parse(`specVersion = 1\nkind = "sdkwork.webserver.server"\nid = "im"`);
  assert.ok(errorsOf(enabledNoServer).some((e) => e.includes('at least one')));
});

test('validator: upstream and proxy rules (W7, W8)', () => {
  const doc = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"

[http]
[[http.upstream]]
name = "a_b"
[[http.upstream.target]]
address = "127.0.0.1:3900"

[[http.upstream]]
name = "a_b"
[[http.upstream.target]]
address = "127.0.0.1:3901"

[[http.upstream]]
name = "Bad-Name"
[[http.upstream.target]]
address = "127.0.0.1:3902"
down = true

[[http.server]]
listen = ["80"]
serverName = ["im.sdkwork.com"]
[[http.server.location]]
match = "/missing/"
proxyPass = "http://no-such-upstream"
[[http.server.location]]
match = "/ok/"
proxyPass = "http://a_b"
[[http.server.location]]
match = "/placeholder/"
proxyPass = "http://127.0.0.1:8080"
`);
  const { errors, warnings } = validateWebserverToml(doc);
  assert.ok(errors.some((e) => e.includes('duplicate upstream name')));
  assert.ok(errors.some((e) => e.includes('must match ^[a-z][a-z0-9_-]*$')));
  assert.ok(errors.some((e) => e.includes('at least one target that is not down')));
  assert.ok(errors.some((e) => e.includes('references undefined upstream')));
  assert.ok(warnings.some((w) => w.includes('placeholder port 8080')));
});

test('validator: virtual host rules (W9, W10, W11)', () => {
  const doc = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"

[http]
[[http.server]]
listen = ["443 ssl"]
serverName = ["im.sdkwork.com"]
[[http.server]]
listen = ["443"]
serverName = ["im.sdkwork.com"]
[[http.server]]
listen = ["443 ssl"]
serverName = ["https://bad.example.com", "im-test.sdkwork.com"]
[http.server.tls]
cert = "nope"
protocols = ["TLSv1.2", "TLSv1.1"]
`);
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('duplicate server name')));
  assert.ok(errors.some((e) => e.includes('invalid server name "https://bad.example.com"')));
  assert.ok(errors.some((e) => e.includes('required when a listen entry uses ssl')));
  assert.ok(errors.some((e) => e.includes('references undefined certificate "nope"')));
  assert.ok(errors.some((e) => e.includes('legacy protocol "TLSv1.1"')));
});

test('validator: location rules (W12)', () => {
  const doc = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"

[[http.server]]
listen = ["80"]
serverName = ["im.sdkwork.com"]
[[http.server.location]]
match = "api"
[[http.server.location]]
match = "/both/"
proxyPass = "http://127.0.0.1:3900"
root = "/srv"
[[http.server.location]]
match = "/alias/"
alias = "/var/lib/im/static"
`);
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('must start with /')));
  assert.ok(errors.some((e) => e.includes('mutually exclusive')));
  assert.ok(errors.some((e) => e.includes('must end with /')));
});

test('validator: raw statements and secrets (W13, W14)', () => {
  const doc = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"

[main]
raw = ["daemon off;", "load_module modules/x.so;"]

[[http.server]]
listen = ["80"]
serverName = ["im.sdkwork.com"]
raw = ["bad without semicolon", "block { not allowed }"]
`);
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('not a single nginx directive statement')));

  const secretDoc = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"

[[http.server]]
listen = ["80"]
serverName = ["im.sdkwork.com"]
[http.server.tls]
certKeyFile = "-----BEGIN PRIVATE KEY-----\\nabc"
`);
  assert.ok(errorsOf(secretDoc).some((e) => e.includes('inline private key material')));
});

test('validator: unknown directive policy (W5)', () => {
  const doc = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"
mysteryKey = 1
`);
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('unknown key "mysteryKey"')));

  const allowDoc = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"
mysteryKey = 1

[nginx]
unknownDirectivePolicy = "allow"
`);
  assert.ok(errorsOf(allowDoc).some((e) => e.includes('requires exceptionRef')));

  const allowed = parse(`
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"
mysteryKey = 1

[nginx]
unknownDirectivePolicy = "allow"
exceptionRef = "EXC-2026-0001"

[[http.server]]
listen = ["80"]
serverName = ["im.sdkwork.com"]
`);
  assert.deepEqual(errorsOf(allowed), []);
});

test('renderer: canonical conf matches typed keys (W16 basis)', () => {
  const doc = parse(VALID_DOC);
  const conf = renderNginxConf(doc);
  assert.match(conf, /user sdkwork;/u);
  assert.match(conf, /worker_processes auto;/u);
  assert.match(conf, /worker_connections 1024;/u);
  assert.match(conf, /client_max_body_size 1100m;/u);
  assert.match(conf, /    upstream api_backend \{\n        least_conn;/u);
  assert.match(conf, /server 127\.0\.0\.1:3901 backup;/u);
  assert.match(conf, /server_name im\.sdkwork\.com www\.im\.sdkwork\.com;/u);
  assert.match(conf, /ssl_certificate \/opt\/certs\/letsencrypt\/live\/im\.sdkwork\.com\/fullchain\.pem;/u);
  assert.match(conf, /ssl_protocols TLSv1\.2 TLSv1\.3;/u);
  assert.match(conf, /location \/api\/ \{/u);
  assert.match(conf, /proxy_pass http:\/\/api_backend;/u);
  assert.match(conf, /proxy_set_header Connection "upgrade";/u);
  assert.match(conf, /location = \/healthz \{/u);
  assert.match(conf, /return 200 \{"status":"ok"\};/u);
});

test('merge: scalar override, leaf array replace, identity upsert, target replace', () => {
  const common = parse(`
[http]
sendfile = true
keepaliveTimeout = 75
clientMaxBodySize = "1100m"
gzipTypes = ["text/css", "application/javascript"]

[http.certificates.im]
certFile = "/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/fullchain.pem"
certKeyFile = "/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/privkey.pem"

[[http.upstream]]
name = "gateway"
keepalive = 32
[[http.upstream.target]]
address = "127.0.0.1:3900"
weight = 1

[[http.server]]
listen = ["443 ssl", "80"]
serverName = ["im.sdkwork.com"]
[http.server.tls]
cert = "im"
protocols = ["TLSv1.2", "TLSv1.3"]

[[http.server.location]]
match = "/"
proxyPass = "http://gateway"
proxyReadTimeout = "60s"
`);

  const cloud = parse(`
profile = "cloud"
[http]
keepaliveTimeout = 120
gzipTypes = ["application/json"]

[[http.upstream]]
name = "gateway"
[[http.upstream.target]]
address = "10.0.4.12:3900"
weight = 3

[[http.server]]
listen = ["443 ssl", "80"]
serverName = ["im.sdkwork.com"]
http2 = true

[[http.server.location]]
match = "/"
proxyReadTimeout = "120s"

[[http.server]]
listen = ["443 ssl"]
serverName = ["api.sdkwork.com"]
[http.server.tls]
cert = "im"
`);

  const merged = mergeConfigs(common, cloud);
  // Scalar override and inheritance.
  assert.equal(merged.http.sendfile, true);
  assert.equal(merged.http.keepaliveTimeout, 120);
  assert.equal(merged.http.clientMaxBodySize, '1100m');
  // Leaf array replacement.
  assert.deepEqual(merged.http.gzipTypes, ['application/json']);
  // Upstream: target array replaced wholesale, other keys inherited.
  assert.equal(merged.http.upstream.length, 1);
  assert.equal(merged.http.upstream[0].keepalive, 32);
  assert.deepEqual(merged.http.upstream[0].target, [{ address: '10.0.4.12:3900', weight: 3 }]);
  // Server identity upsert: common server merged, new server appended.
  assert.equal(merged.http.server.length, 2);
  const im = merged.http.server[0];
  assert.equal(im.http2, true);
  assert.deepEqual(im.listen, ['443 ssl', '80']);
  assert.equal(im.tls.cert, 'im');
  // Location identity upsert: proxyPass inherited, timeout overridden.
  const loc = im.location[0];
  assert.equal(loc.proxyPass, 'http://gateway');
  assert.equal(loc.proxyReadTimeout, '120s');
  assert.equal(merged.http.server[1].serverName[0], 'api.sdkwork.com');
  // Identity fields of the common baseline survive untouched.
  assert.equal(merged.http.certificates.im.certFile, '/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/fullchain.pem');
});

test('merge: stream servers and plain-table recursion', () => {
  const common = parse(`
[stream]
[[stream.server]]
listen = ["3306"]
proxyPass = "10.0.0.5:3306"
`);
  const overlay = parse(`
profile = "standalone"
[stream]
[[stream.server]]
listen = ["3306"]
proxyTimeout = "60s"
`);
  const merged = mergeConfigs(common, overlay);
  assert.equal(merged.stream.server.length, 1);
  assert.equal(merged.stream.server[0].proxyPass, '10.0.0.5:3306');
  assert.equal(merged.stream.server[0].proxyTimeout, '60s');
});

test('alignment: every typed key is rendered, schematized, and spec-declared (anti-drift)', async () => {
  const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
  const specsRoot = path.resolve(toolsRoot, '..');
  const validatorSrc = fs.readFileSync(path.join(toolsRoot, 'webserver', 'validate.mjs'), 'utf8');
  const schema = JSON.parse(
    fs.readFileSync(path.join(specsRoot, 'schemas', 'sdkwork.webserver.toml.schema.v1.json'), 'utf8'),
  );
  const schemaKeys = new Set();
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (obj.properties) for (const key of Object.keys(obj.properties)) schemaKeys.add(key);
    for (const value of Object.values(obj)) walk(value);
  };
  walk(schema);
  const spec = fs.readFileSync(path.join(specsRoot, 'SDKWORK_WEBSERVER_SPEC.md'), 'utf8');
  const nonRendered = new Set(['raw', 'certificates', 'upstream', 'server', 'location', 'tls', 'target', 'events', 'match', 'name', 'listen', 'address', 'include']);
  for (const key of TYPED_KEYS) {
    assert.ok(schemaKeys.has(key), `schema must declare typed key "${key}"`);
    const declared = spec.includes(`\`${key}\``) || spec.includes(`[[http.${key}]]`) || spec.includes(`[[stream.${key}]]`) || spec.includes(`[[http.server.${key}]]`) || spec.includes(`]].${key}\``);
    assert.ok(declared, `spec must declare typed key "${key}"`);
    if (!nonRendered.has(key)) {
      assert.ok(validatorSrc.includes(`.${key}`), `renderer must handle typed key "${key}"`);
    }
  }
  // Renderer must emit a generated-comment header naming the sources.
  const conf = renderNginxConf(parse(VALID_DOC), { profile: 'standalone' });
  assert.match(conf, /Generated by the SDKWork web server standard/u);
  assert.match(conf, /server\.standalone\.toml/u);
});

test('file validation: layout v2 passes and per-profile sidecars (W1, W16)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-webserver-v2-'));
  const dir = path.join(tmp, 'deployments', 'webserver');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.common.toml'), VALID_DOC);
  fs.writeFileSync(path.join(dir, 'server.standalone.toml'), 'profile = "standalone"\n');
  fs.writeFileSync(path.join(dir, 'server.cloud.toml'), `profile = "cloud"

[[http.upstream]]
name = "api_backend"
[[http.upstream.target]]
address = "10.0.4.12:3900"
weight = 3
`);

  let result = validateWebserverDir(tmp);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.profiles.standalone.http.upstream[0].target[0].address, '127.0.0.1:3900');
  assert.equal(result.profiles.cloud.http.upstream[0].target[0].address, '10.0.4.12:3900');

  // Per-profile sidecars: correct renders pass, divergent ones fail.
  fs.writeFileSync(path.join(dir, 'nginx.standalone.conf'), renderNginxConf(result.profiles.standalone));
  fs.writeFileSync(path.join(dir, 'nginx.cloud.conf'), renderNginxConf(result.profiles.cloud));
  result = validateWebserverDir(tmp);
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  fs.writeFileSync(path.join(dir, 'nginx.cloud.conf'), 'http {\n    sendfile off;\n}\n');
  result = validateWebserverDir(tmp);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('diverges')));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('file validation: profile key rules (W20)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-webserver-v2-'));
  const dir = path.join(tmp, 'deployments', 'webserver');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.common.toml'), VALID_DOC);

  // Profile file with a wrong profile value.
  fs.writeFileSync(path.join(dir, 'server.standalone.toml'), 'profile = "cloud"\n');
  fs.writeFileSync(path.join(dir, 'server.cloud.toml'), 'profile = "cloud"\n');
  let result = validateWebserverDir(tmp);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('profile MUST be "standalone"')));

  // Profile file declaring inherited identity keys.
  fs.writeFileSync(
    path.join(dir, 'server.standalone.toml'),
    'profile = "standalone"\nspecVersion = 1\nkind = "sdkwork.webserver.server"\nid = "im"\n',
  );
  result = validateWebserverDir(tmp);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('MUST NOT declare specVersion')));

  // Common file declaring profile (root-level key, before any table header).
  fs.writeFileSync(path.join(dir, 'server.standalone.toml'), 'profile = "standalone"\n');
  fs.writeFileSync(path.join(dir, 'server.common.toml'), `profile = "standalone"\n${VALID_DOC}`);
  result = validateWebserverDir(tmp);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('MUST NOT declare profile')));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('file validation: retired single file and workspace root (W1, W15, W19)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-webserver-v2-'));
  const dir = path.join(tmp, 'deployments', 'webserver');
  fs.mkdirSync(dir, { recursive: true });

  // Retired server.toml alone is an error with migration diagnostics.
  fs.writeFileSync(path.join(dir, 'server.toml'), VALID_DOC);
  let result = validateWebserverDir(tmp);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('retired')));
  assert.ok(result.errors.some((e) => e.includes('missing layout v2 file')));

  // Layout v2 present: workspace root rule applies to the v2 files.
  fs.writeFileSync(path.join(dir, 'server.common.toml'), VALID_DOC);
  fs.writeFileSync(path.join(dir, 'server.standalone.toml'), 'profile = "standalone"\n');
  fs.writeFileSync(path.join(dir, 'server.cloud.toml'), 'profile = "cloud"\n');
  result = validateWebserverDir(tmp, { isWorkspaceRoot: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('workspace root MUST NOT')));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('nginx.enabled=false skips sidecar equivalence (W16)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-webserver-compat-'));
  const dir = path.join(tmp, 'deployments', 'webserver');
  fs.mkdirSync(dir, { recursive: true });
  const common = VALID_DOC.replace(
    '[nginx]\nprofile = "http-core-v1"',
    '[nginx]\nenabled = false\nprofile = "http-core-v1"',
  );
  fs.writeFileSync(path.join(dir, 'server.common.toml'), common);
  fs.writeFileSync(path.join(dir, 'server.standalone.toml'), 'profile = "standalone"\n');
  fs.writeFileSync(path.join(dir, 'server.cloud.toml'), 'profile = "cloud"\n');
  fs.writeFileSync(path.join(dir, 'nginx.standalone.conf'), 'this is not a valid render\n');
  fs.writeFileSync(path.join(dir, 'nginx.cloud.conf'), 'this is not a valid render\n');
  const result = validateWebserverDir(tmp);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.ok(result.warnings.some((w) => w.includes('nginx.enabled = false')));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('retired [compatibility] table fails with migration diagnostic', () => {
  const doc = VALID_DOC.replace('[nginx]\nprofile = "http-core-v1"', '[compatibility]\nenabled = true\nnginxProfile = "http-core-v1"');
  const result = validateWebserverToml(parseTomlSubset(doc));
  assert.equal(result.ok ?? result.errors.length === 0, false);
  assert.ok(result.errors.some((e) => e.includes('compatibility') && e.includes('[nginx]')));
  assert.equal(result.errors.filter((e) => e.includes('unknown key "compatibility"')).length, 0);
});

test('retired nginx.nginxProfile fails with migration diagnostic', () => {
  const doc = VALID_DOC.replace(
    'profile = "http-core-v1"',
    'nginxProfile = "http-core-v1"',
  );
  const result = validateWebserverToml(parseTomlSubset(doc));
  assert.equal(result.ok ?? result.errors.length === 0, false);
  assert.ok(result.errors.some((e) => e.includes('nginx.nginxProfile') && e.includes('nginx.profile')));
  assert.equal(result.errors.filter((e) => e.includes('unknown key "nginxProfile"')).length, 0);
});
