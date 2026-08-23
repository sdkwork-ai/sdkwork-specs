# SDKWork Web Server Deploy Configuration Standard

- Version: 2.0
- Scope: per-module `deployments/webserver/` split configuration (`server.common.toml`, `server.standalone.toml`, `server.cloud.toml`) with inheritance and override; nginx-parallel declarative web server configuration covering reverse proxy, virtual hosts, directory resource mounting, certificate/TLS, and full nginx conf compatibility
- Related: `NGINX_SPEC.md`, `SDKWORK_DEPLOY_SPEC.md`, `DEPLOYMENT_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_NAMING.md`, `SECURITY_SPEC.md`, `OBSERVABILITY_SPEC.md`, `CONFIG_SPEC.md`, `TEST_SPEC.md`

Every independent SDKWork module root `MUST` contain a `deployments/webserver/`
directory with **three** TOML files: a shared baseline
(`server.common.toml`) plus one override file per deployment profile
(`server.standalone.toml`, `server.cloud.toml`). The profile files inherit the
common baseline and override only what differs. This keeps the standalone and
cloud configurations minimal and reusable: common serving behavior lives in
one place, and each deployment profile carries only its deltas.

The files are **nginx-parallel**: every section maps to an nginx context,
every typed key maps to an nginx directive, and each profile's merged
configuration renders deterministically into a complete, valid nginx
configuration. Full nginx `conf` compatibility is supported through raw
directive passthrough and per-profile `nginx.conf` compatibility sidecars.

## 1. Position In The Standards Stack

Three artifacts describe web serving, with three different roles:

| Artifact | Role | Authority |
| --- | --- | --- |
| `deployments/webserver/*.toml` | Deploy-time declarative source: what the module serves, where it proxies, which certificates it uses, per deployment profile | This standard |
| `deployments/webserver/nginx.<profile>.conf` | Rendered nginx configuration for one profile; optional compatibility sidecar that `MUST` stay equivalent to that profile's merged configuration | `NGINX_SPEC.md` |
| `sdkwork.webserver.config.json` | Executable runtime configuration of the SDKWork Web Server process | `sdkwork-webserver` module `specs/sdkwork.webserver.config.schema.json` |

Rules:

- The TOML files are the source of truth for the web data plane at deploy
  time. Tools and operators `MAY` render them into nginx site files
  (`NGINX_SPEC.md`) or materialize them into the webserver runtime config, but
  `MUST NOT` edit either derived artifact without re-deriving it.
- `deployments/deploy.yaml` (`SDKWORK_DEPLOY_SPEC.md`) declares which public
  hosts an application owns (`expose`); the TOML files declare how those hosts
  are served. Every `expose` domain `SHOULD` appear in a merged
  `[[http.server]]` `serverName` of the matching profile.
- The configuration is profile-scoped, not environment-scoped: it holds no
  per-environment conditionals. Environment binding comes from host names,
  certificate paths, and deploy-time rendering.
- The webserver runtime config schema remains the executable authority for the
  `sdkwork-webserver` process; section 13 defines the materialization mapping.

## 2. File Location Contract And Inheritance Model

### 2.1 Files

Every independent module root `MUST` contain:

```text
<module-root>/deployments/
  webserver/
    server.common.toml        # shared baseline, inherited by both profiles
    server.standalone.toml    # standalone overrides, inherits common
    server.cloud.toml         # cloud overrides, inherits common
```

Optional:

```text
    nginx.standalone.conf     # rendered equivalent of the standalone merge
    nginx.cloud.conf          # rendered equivalent of the cloud merge
    snippets/*.conf           # nginx include fragments referenced by include = [...]
    certs/                    # development-only self-signed material; never production keys
    README.md                 # module-specific operator notes
```

Rules:

- The file names are exactly `server.common.toml`, `server.standalone.toml`,
  and `server.cloud.toml`; the directory name is exactly `webserver`.
- The legacy single-file layout (`server.toml`) is **retired**: it `MUST NOT`
  exist in a module using this standard (W19).
- The workspace root `MUST NOT` contain a workspace-wide
  `deployments/webserver/` (same boundary as `SDKWORK_DEPLOY_SPEC.md`
  section 2).
- A module with no public web surface still `MUST` provide all three files;
  `server.common.toml` carries `enabled = false` and the profile files carry
  only their `profile` declaration.
- `deployments/webserver/` is deploy-time source configuration. Runtime
  directories, secrets, and installed artifacts follow
  `RUNTIME_DIRECTORY_SPEC.md` and `SOURCE_CONFIG_SPEC.md`; never commit
  production keys under `certs/`.
- Every TOML file `MUST` parse as the TOML subset defined in section 3.2, and
  the directory `MUST` pass `tools/check-webserver-toml-standard.mjs` before
  merge.

### 2.2 Effective Configuration And Inheritance

Each deployment profile has one **effective configuration**:

```text
effective(standalone) = merge(server.common.toml, server.standalone.toml)
effective(cloud)      = merge(server.common.toml, server.cloud.toml)
```

The effective configuration of each profile `MUST` satisfy every validation
rule of this standard (W21). Common content is authored once and reused by
both profiles; each profile file declares only its deltas, which keeps the
standalone and cloud files small and focused (high cohesion, low coupling).

| File | Role | Required root keys |
| --- | --- | --- |
| `server.common.toml` | Shared baseline | `specVersion`, `kind`, `id`; no `profile` key |
| `server.standalone.toml` | Standalone deltas | `profile = "standalone"`; `specVersion`/`kind`/`id` `MUST NOT` be declared |
| `server.cloud.toml` | Cloud deltas | `profile = "cloud"`; `specVersion`/`kind`/`id` `MUST NOT` be declared |

### 2.3 Merge Rules

`merge(base, overlay)` follows these rules in order:

1. **Scalar keys** (string, integer, float, boolean): the overlay value wins
   when declared; otherwise the base value is inherited.
2. **Leaf arrays** (`listen`, `serverName`, `protocols`, `proxySetHeader`,
   `index`, `tryFiles`, `errorPage`, `gzipTypes`, `logFormat`, `accessLog`,
   `map`, `include`, `allow`, `deny`, `rewrite`, `addHeader`, `raw`): the
   overlay array replaces the base array entirely.
3. **Plain tables** (`nginx`, `main`, `main.events`, `http`,
   `http.certificates.<name>`, `tls`, `stream`): merged recursively with
   rules 1-5.
4. **Object arrays merge by identity key** (upsert): elements of
   `[[http.server]]`, `[[http.upstream]]`, `[[http.server.location]]`, and
   `[[stream.server]]` are matched by their identity key:

   | Array | Identity key | Example |
   | --- | --- | --- |
   | `[[http.server]]` | first `serverName` | `["im.sdkwork.com", ...]` |
   | `[[http.upstream]]` | `name` | `"gateway"` |
   | `[[http.server.location]]` | `match` | `"/api/"` |
   | `[[stream.server]]` | first `listen` | `"3306"` |

   An overlay element with the same identity replaces the base element (its
   inner keys merge by rules 1-3); an overlay element with a new identity is
   appended.
5. **`[[http.upstream.target]]` arrays** are replaced wholesale whenever the
   overlay defines the containing upstream with a `target` array; targets are
   not merged by identity (an upstream's target set is a unit).

Rules:

- Elements shared by both profiles `MUST` be authored in
  `server.common.toml`; elements specific to one profile `MUST` be authored in
  that profile's file. Merging cannot remove a common element, so profile-only
  elements must not be placed in the common baseline.
- Identity keys must be unique within each file and within each effective
  configuration (W22): one `match` per server, one upstream `name`, one
  `serverName` across servers.
- A profile file `MAY` declare `enabled`, `description`, `nginx`,
  `main`, `http`, and `stream` overrides; `specVersion`, `kind`, and `id`
  always come from the common baseline.
- Merge is deterministic and profile-local; it never crosses profiles.

### 2.4 Merge Example

`server.common.toml`:

```toml
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"

[http]
sendfile = true
clientMaxBodySize = "1100m"

[http.certificates.im]
certFile = "/opt/certs/letsencrypt/live/im.sdkwork.com/fullchain.pem"
certKeyFile = "/opt/certs/letsencrypt/live/im.sdkwork.com/privkey.pem"

[[http.upstream]]
name = "gateway"
loadBalancing = "least-connections"
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
```

`server.cloud.toml` (only the deltas):

```toml
profile = "cloud"

[[http.upstream]]
name = "gateway"
[[http.upstream.target]]
address = "10.0.4.12:3900"
weight = 3
```

The cloud effective configuration inherits the server, TLS, and location from
common and replaces only the upstream target set
(`10.0.4.12:3900` with `weight = 3`). The standalone effective configuration
is the common baseline unchanged.

## 3. Document Structure

### 3.1 Root Keys And Context Hierarchy

| TOML root key | nginx context | Purpose |
| --- | --- | --- |
| `specVersion` | — | Integer, `1` for this version of the document schema |
| `kind` | — | String, `"sdkwork.webserver.server"`; common file only |
| `id` | — | Module `runtimeCode` (`SDKWORK_DEPLOY_SPEC.md` section 3); common file only |
| `profile` | — | `"standalone"` or `"cloud"`; profile files only, never the common file |
| `enabled` | — | Boolean, default `true`; `false` only when the module exposes no public web surface |
| `description` | — | Free text; required when `enabled = false` |
| `nginx` | — | nginx compatibility toggle, profile, unknown-directive policy, sidecar contract (section 4) |
| `main` | `main` | Process-level directives (section 5) |
| `http` | `http` | HTTP context: certificates, upstreams, virtual hosts (sections 6-11) |
| `stream` | `stream` | TCP/UDP proxying (section 12) |

Context rendering order is fixed: `main` → `events` → `http` (certificates →
maps/log formats → upstreams → servers, each server followed by its
locations) → `stream`. Raw entries render in place after typed keys of the
same context.

### 3.2 TOML Subset

Every TOML file `MUST` parse as TOML 1.0 restricted to:

- Basic strings (`"..."` with `\"`, `\\`, `\n`, `\t`, `\r`, `\b`, `\f`, `\uXXXX`,
  `\UXXXXXXXX`) and literal strings (`'...'`).
- Integers (decimal, `0x`, `0o`, `0b`, with `_` separators), floats (including
  exponent and `inf`/`nan`), and booleans.
- Arrays (multi-line allowed) and inline tables (`{ key = value, ... }`).
- `[table]`, `[[array-of-tables]]`, and dotted keys.

Forbidden TOML features (`MUST NOT` be used; the validator rejects them):

- Multi-line strings (`"""`, `'''`), datetimes, dates, and times.
- Keys whose values depend on context evaluation; the files are static.
- Duplicate keys and redefinition of a table or array-of-tables.

## 4. Nginx Profile And Full Conf Compatibility

### 4.1 `[nginx]` Table

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch for nginx compatibility (`nginx.enabled`). When `false`, skip sidecar equivalence (W16), refuse nginx.conf import activation, and treat the module as Rust-native TOML only |
| `profile` | `"http-core-v1"` | The typed directive set defined by sections 5-12 |
| `unknownDirectivePolicy` | `"error"` | Behavior when a TOML key is not in the typed set: `error` (validation failure), `warn` (warning only), or `allow` (requires `exceptionRef`) |
| `exceptionRef` | — | Governance exception record (`GOVERNANCE_SPEC.md`) required for `unknownDirectivePolicy = "allow"` |
| `strict` | `true` | When `true`, raw entries are syntax-checked and a present per-profile sidecar must be the equivalent render; `false` relaxes sidecar equivalence to a warning |
| `confFile` | `"nginx.conf"` | Base name of the compatibility sidecar; profile sidecars are `<confFile>.<profile>` |

Rules:

- The retired table `[compatibility]` (and key `nginxProfile`) `MUST` fail
  validation with an actionable migration diagnostic pointing to `[nginx]` /
  `nginx.profile`. Dual-read is forbidden.
- `nginx.enabled = false` is the Rust-native path: operators edit TOML only; existing
  `nginx.<profile>.conf` sidecars are ignored by W16 (emit an informational
  warning if present). Import tools `MUST NOT` publish Rust snapshots from
  raw nginx.conf while nginx compatibility is disabled.
- `nginx.enabled = true` requires the `http-core-v1` profile contract: typed keys,
  optional `raw` passthrough, and sidecar equivalence under `strict`.
- Capability progress for the profile is tracked in
  `sdkwork-webserver/specs/nginx-gap.catalog.json` (not a claim
  of full nginx OSS behavioral parity).
- `unknownDirectivePolicy = "allow"` without `exceptionRef` is a validation
  error. `warn` is for controlled migration windows only.
- `strict = false` also requires `exceptionRef` and is never the default.
- The sidecar file names follow the profile: `nginx.standalone.conf` and
  `nginx.cloud.conf` (from `confFile = "nginx.conf"`), compared against each
  profile's effective render.

### 4.2 Raw Directive Passthrough

Every context supports a `raw` array of strings. Each entry is one verbatim
nginx directive statement, for example:

```toml
[main]
raw = ["daemon off;", "load_module modules/ngx_http_upstream_hash_module.so;"]
```

Rules:

- A raw entry `MUST` be a single directive statement: `name args...;`
  terminated by `;`, no `{`/`}` braces, no newline. Blocks `MUST` be expressed
  through typed sections or `include`.
- Raw entries are rendered verbatim after the typed keys of the same context,
  preserving the listed order.
- Raw entries are the migration path for directives the typed set does not
  cover yet; the typed set is the reviewable, validated surface.

### 4.3 Per-Profile `nginx.conf` Compatibility Sidecar

When `nginx.standalone.conf` or `nginx.cloud.conf` exists:

- It `MUST` be the rendered equivalent of that profile's **effective**
  configuration: tools generate it with the fixed rendering order, and
  validation renders the effective configuration and compares the directive
  statements.
- It `MUST NOT` contain directives that contradict the effective
  configuration; a divergent sidecar is a validation error under
  `strict = true`.
- One-time migration from an existing handwritten nginx config into the TOML
  files is allowed: every migrated directive either maps to a typed key or
  lands in `raw`; directives left unmapped `MUST` be declared through
  `unknownDirectivePolicy = "warn"` or `"allow"` with `exceptionRef`, and the
  migration record is release evidence.
- Rendering follows `NGINX_SPEC.md`: site files use
  `/etc/nginx/sites-enabled/sdkwork/<domain>.conf`, upstreams normalize
  `0.0.0.0:<port>` to `http://127.0.0.1:<port>`, and adaptive Web uses
  snippet `include` files (never a variable `root` with SPA `try_files` in a
  single location).

## 5. Main And Events Context

### 5.1 `[main]`

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `user` | `user` | string | Default `"sdkwork"` |
| `workerProcesses` | `worker_processes` | string or int | Default `"auto"` |
| `workerRlimitNofile` | `worker_rlimit_nofile` | int | — |
| `pid` | `pid` | string | Default derives from `RUNTIME_DIRECTORY_SPEC.md` runtime state (`/run/sdkwork/<id>/`) |
| `errorLog` | `error_log` | string | `"path [level]"` |
| `include` | `include` | string[] | Paths or globs; snippets are resolved relative to `deployments/webserver/` |
| `raw` | — | string[] | Section 4.2 |

### 5.2 `[main.events]`

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `workerConnections` | `worker_connections` | int | Required; the connection limit per worker |
| `use` | `use` | string | `epoll`/`kqueue`/`poll`/`select`; default is platform-derived |
| `acceptMutex` | `accept_mutex` | bool | — |
| `multiAccept` | `multi_accept` | bool | — |
| `raw` | — | string[] | Section 4.2 |

## 6. HTTP Context (`[http]`)

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `sendfile` | `sendfile` | bool | Default `true` |
| `tcpNopush` | `tcp_nopush` | bool | — |
| `tcpNodelay` | `tcp_nodelay` | bool | Default `true` |
| `keepaliveTimeout` | `keepalive_timeout` | string or int | Default `75` |
| `keepaliveRequests` | `keepalive_requests` | int | — |
| `clientMaxBodySize` | `client_max_body_size` | string | `MUST NOT` be lower than the module upload limits; Cloud Router default is `1100m` |
| `clientBodyTimeout` | `client_body_timeout` | string or int | — |
| `clientHeaderTimeout` | `client_header_timeout` | string or int | — |
| `clientBodyBufferSize` | `client_body_buffer_size` | string | — |
| `clientHeaderBufferSize` | `client_header_buffer_size` | string | — |
| `largeClientHeaderBuffers` | `large_client_header_buffers` | string | `"<count> <size>"` |
| `resetTimedoutConnection` | `reset_timedout_connection` | bool | — |
| `sendTimeout` | `send_timeout` | string or int | — |
| `serverNamesHashMaxSize` | `server_names_hash_max_size` | int | — |
| `serverTokens` | `server_tokens` | string | `"off"` recommended for production |
| `defaultType` | `default_type` | string | Default `application/octet-stream` |
| `logFormat` | `log_format` | string[] | Entries are `"<name> <format>"` |
| `accessLog` | `access_log` | string[] | Entries are `"<path> [<format>]"` |
| `gzip` | `gzip` | bool | — |
| `gzipTypes` | `gzip_types` | string[] | — |
| `gzipMinLength` | `gzip_min_length` | int | — |
| `map` | `map` | string[] | Entries are `"<$var> <mapped-value> <default>"` |
| `limitReqZone` | `limit_req_zone` | string[] | Entries are `"<$key> zone=<name>:<size> rate=<rate>"`; consumed by location `limitReq` |
| `include` | `include` | string[] | Same semantics as `main.include` |
| `raw` | — | string[] | Section 4.2 |

The `http` context of each **effective** configuration `MUST` contain at
least one `[[http.server]]` or one `[[stream.server]]` when `enabled = true`.

## 7. Named Certificates (`[http.certificates]`)

`[http.certificates]` is a table of reusable, named certificate entries
(plain tables, so they merge recursively across profiles):

```toml
[http.certificates.im]
certFile = "/opt/certs/letsencrypt/live/im.sdkwork.com/fullchain.pem"
certKeyFile = "/opt/certs/letsencrypt/live/im.sdkwork.com/privkey.pem"
chainFile = "/opt/certs/letsencrypt/live/im.sdkwork.com/chain.pem"
ocspStapling = true
```

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `certFile` | `ssl_certificate` | string | Required unless `acme` is set; absolute path |
| `certKeyFile` | `ssl_certificate_key` | string | Required unless `acme` is set; absolute path or `secret://` reference |
| `chainFile` | `ssl_trusted_certificate` | string | Optional; absolute path |
| `ocspStapling` | `ssl_stapling` | bool | — |
| `acme` | — | string | ACME-managed certificate name issued by the SDKWork ACME service; mutually exclusive with `certFile`/`certKeyFile` |

Rules:

- Certificate names are TOML table keys; names containing dots (such as
  base-domain names like `sdkwork.com`) `MUST` be written as quoted keys
  (`[http.certificates."sdkwork.com"]`); references (`cert = "sdkwork.com"`)
  are plain strings.
- Certificate paths `MUST` be absolute and `MUST` follow the `NGINX_SPEC.md`
  section 3 contract (`/opt/certs/letsencrypt/live/<cert-name>/...`) unless
  an operator-managed root is documented in the module `deployments/webserver/README.md`.

### 7.1 Certificate Inventory (`/etc/sdkwork/certs/<domain>/`)

System-scope and container deployments `SHOULD` use the canonical
certificate inventory root `/etc/sdkwork/certs/` (overridable with
`SDKWORK_CERTS_DIR` for containers and tests). One directory per domain:

| Path | Purpose |
| --- | --- |
| `/etc/sdkwork/certs/<domain>/cert.pem` | Leaf certificate (PEM) |
| `/etc/sdkwork/certs/<domain>/key.pem` | Private key (PEM, `0600`) |
| `/etc/sdkwork/certs/<domain>/chain.pem` | Optional issuer chain (PEM) |

References use the `certs://<domain>/<file>` URI form anywhere a certificate
path is accepted (`certFile`, `certKeyFile`, `chainFile`, nginx-conf
`ssl_certificate`, `ssl_certificate_key`):

```toml
[http.certificates."sdkwork.com"]
certFile = "certs://sdkwork.com/cert.pem"
certKeyFile = "certs://sdkwork.com/key.pem"
chainFile = "certs://sdkwork.com/chain.pem"
```

Rules:

- `certs://<domain>/…` resolves against the inventory root; the domain
  directory is the operator/ACME-managed certificate home. Missing
  inventory files fail closed with a precise diagnostic.
- The ACME certificate worker writes issued and renewed material into
  `/etc/sdkwork/certs/<domain>/` (`cert.pem`, `key.pem`, `chain.pem`), so
  the inventory is the single certificate home for both ACME-managed and
  operator-uploaded certificates.
- Domain directories `MUST` be readable by the runtime service user and
  private keys `MUST` be `0600` (group `sdkwork` on Linux).
- Certificate and key material `MUST NOT` be embedded inline; `secret://`
  references are the only allowed indirection (`SDKWORK_DEPLOY_SPEC.md` section 11).
- Development-only self-signed material may live under
  `deployments/webserver/certs/`, is excluded from release packages by
  `PACKAGING_SPEC.md`, and `MUST NOT` be referenced by a production host.
- Certificates shared by both profiles belong in `server.common.toml`; a
  profile-specific certificate belongs in that profile's file.

## 8. Upstreams (`[[http.upstream]]`)

An upstream is a named reverse-proxy target group (`upstream <name> { ... }`):

```toml
[[http.upstream]]
name = "api_backend"
loadBalancing = "least-connections"
keepalive = 32
[[http.upstream.target]]
address = "127.0.0.1:3900"
weight = 1
[[http.upstream.target]]
address = "127.0.0.1:3901"
weight = 1
backup = true
```

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `name` | `upstream <name>` | string | Required; unique across the file and across the effective configuration; `MUST` match `^[a-z][a-z0-9_-]*$` |
| `loadBalancing` | `least_conn`/`ip_hash`/`random`/`hash` | string | `round-robin` (default), `least-connections`, `ip-hash`, `random`, or `hash`; `hash` requires `hashKey` |
| `hashKey` | `hash <key>` | string | Required when `loadBalancing = "hash"`; for example `"$request_uri consistent"` |
| `keepalive` | `keepalive` | int | Connection cache size |
| `keepaliveTimeout` | `keepalive_timeout` | string | — |
| `raw` | — | string[] | Section 4.2 |

`[[http.upstream.target]]` (the `server <address> ...;` entries):

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `address` | `server <address>` | string | Required; `host:port`, IPv6 `[addr]:port`, or `unix:<path>` |
| `weight` | `server ... weight=N` | int | Default `1` |
| `maxFails` | `server ... max_fails=N` | int | — |
| `failTimeout` | `server ... fail_timeout=<t>` | string | — |
| `backup` | `server ... backup` | bool | — |
| `down` | `server ... down` | bool | — |
| `resolve` | `server ... resolve` | bool | Requires a resolver; cloud/multi-instance deployments `MUST` use it per `DEPLOYMENT_SPEC.md` section 4.2 when dynamic resolution applies |
| `raw` | — | string | Verbatim `server` line override |

Rules:

- An upstream `MUST` declare at least one target, and at least one target
  `MUST NOT` be `down` (checked on each effective configuration).
- Upstream names are referenced by `proxyPass = "http://<name>"` (section 11);
  every reference `MUST` resolve to a declared upstream or a literal
  `http(s)://host:port` in the effective configuration.
- Upstream target addresses `SHOULD NOT` use conventionally placeholder ports
  such as `8080`; when one is used, the module `MUST` document the real
  service port (`SDKWORK_DEPLOY_SPEC.md` section 9.2) and the checker emits a
  warning (W8).
- Profile differences in targets belong in the profile file: declare the
  upstream with the same `name` and a `target` array; the overlay replaces the
  whole target set (merge rule 5).

## 9. Virtual Hosts (`[[http.server]]`)

Each `[[http.server]]` is an nginx `server { }` block (a virtual host):

```toml
[[http.server]]
listen = ["443 ssl", "80"]
serverName = ["im.sdkwork.com", "www.im.sdkwork.com"]
http2 = true
root = "/usr/share/sdkwork/im/web/pc"
index = ["index.html"]
```

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `listen` | `listen` | string[] | Required; `"80"`, `"443 ssl"`, `"127.0.0.1:8080"`, `"[::1]:8080"`, `"unix:<path>"`; `443` variants require TLS config (section 10) |
| `serverName` | `server_name` | string[] | Required; bare hostnames or `*.` wildcards; no scheme, port, or path; first entry is the merge identity key |
| `http2` | `http2` | bool | — |
| `root` | `root` | string | Inherited default for locations (section 11) |
| `index` | `index` | string[] | — |
| `tryFiles` | `try_files` | string[] | Server-level default |
| `charset` | `charset` | string | — |
| `errorPage` | `error_page` | string[] | Entries are `"<code> <uri>"` |
| `returnStatus` / `returnBody` | `return <code> [text]` | int / string | Convenience for bare responses (see section 11 rules) |
| `gzip` | `gzip` | bool | — |
| `include` | `include` | string[] | — |
| `tls` | `ssl_*` | table | Section 10; required when any `listen` entry is `ssl` |
| `raw` | — | string[] | Section 4.2 |

Rules:

- `serverName` entries `MUST` be elements of the module host registry
  (`APP_RUNTIME_TOPOLOGY_NAMING.md` section 9) or recorded customer base
  domains; the same environment-boundary rules as `SDKWORK_DEPLOY_SPEC.md`
  section 7.2 apply.
- The same `serverName` value `MUST NOT` appear on two `[[http.server]]`
  blocks in an effective configuration (ambiguous virtual host).
- A `listen` entry containing `ssl` without `[http.server.tls]` fails
  validation.
- `returnBody` requires `returnStatus`; `returnStatus` without
  `returnBody` renders `return <code>;`.
- A profile that overrides a common server reuses the first `serverName` as
  the identity key; renaming the identity key in a profile file creates a new
  server instead of overriding.

## 10. TLS And Certificates On A Virtual Host (`[http.server.tls]`)

```toml
[http.server.tls]
cert = "im"
protocols = ["TLSv1.2", "TLSv1.3"]
preferServerCiphers = true
sessionCache = "shared:SSL:10m"
```

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `cert` | — | string | Reference to a `[http.certificates]` name; mutually exclusive with `certFile`/`certKeyFile` |
| `certFile` | `ssl_certificate` | string | Direct override; same path rules as section 7 |
| `certKeyFile` | `ssl_certificate_key` | string | Direct override |
| `chainFile` | `ssl_trusted_certificate` | string | Direct override |
| `protocols` | `ssl_protocols` | string[] | Default `["TLSv1.2", "TLSv1.3"]`; `TLSv1`/`TLSv1.1` `MUST NOT` be used in new configs (`NGINX_SPEC.md` section 3) |
| `ciphers` | `ssl_ciphers` | string | — |
| `preferServerCiphers` | `ssl_prefer_server_ciphers` | bool | — |
| `sessionCache` | `ssl_session_cache` | string | — |
| `sessionTimeout` | `ssl_session_timeout` | string | — |
| `sessionTickets` | `ssl_session_tickets` | bool | — |
| `stapling` | `ssl_stapling` | bool | — |
| `staplingVerify` | `ssl_stapling_verify` | bool | — |
| `clientCertificate` | `ssl_verify_client` | string or bool | `"on"`, `"off"`, `"optional"`, or boolean |
| `clientCertificateCA` | `ssl_client_certificate` | string | Required when `clientCertificate` is on/optional |
| `verifyDepth` | `ssl_verify_depth` | int | — |
| `dhparam` | `ssl_dhparam` | string | — |
| `ecdhCurve` | `ssl_ecdh_curve` | string | For example `"auto"` or `"X25519:prime256v1"` |
| `raw` | — | string[] | Section 4.2 |

Rules:

- `cert` references `MUST` resolve to an entry in the effective
  `[http.certificates]`.
- Direct file fields and `cert` are mutually exclusive.
- Readiness and security constraints of `HEALTH_CHECK_SPEC.md` and
  `SECURITY_SPEC.md` apply to every TLS listener; TLS is terminated at the
  web server edge, upstreams may reuse the session via `proxySetHeader`
  forwarded protocol headers.

## 11. Locations (`[[http.server.location]]`)

Each location is an nginx `location <match> { }` block. The `match` value is
required, is the merge identity key, and follows nginx modifiers: prefix
(`/api/`), exact (`= /healthz`), regex (`~ \.php$`, `~* ...`), or non-regex
prefix (`^~ /static/`).

```toml
[[http.server.location]]
match = "/api/"
proxyPass = "http://api_backend"
proxySetHeader = [
  "Host $host",
  "X-Real-IP $remote_addr",
  "X-Forwarded-For $proxy_add_x_forwarded_for",
  "X-Forwarded-Proto $scheme",
]
proxyHttpVersion = "1.1"
proxyWebsocketUpgrade = true
proxyReadTimeout = "120s"
proxySendTimeout = "120s"
proxyBuffering = false

[[http.server.location]]
match = "/"
root = "/usr/share/sdkwork/im/web/pc"
index = ["index.html"]
tryFiles = ["$uri", "$uri/", "/index.html"]

[[http.server.location]]
match = "= /healthz"
returnStatus = 200
returnBody = "{\"status\":\"ok\"}"
```

### 11.1 Reverse Proxy Keys

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `proxyPass` | `proxy_pass` | string | `http://<upstream-name>` or literal `http(s)://host:port`; upstream reference must exist in the effective configuration (section 8) |
| `proxySetHeader` | `proxy_set_header` | string[] | Entries are `"<name> <value>"` |
| `proxyHttpVersion` | `proxy_http_version` | string | `"1.1"` required with keepalive/WebSocket upgrades |
| `proxyBuffering` | `proxy_buffering` | bool | `MUST` be `false` for streaming/generation routes (`NGINX_SPEC.md` section 2) |
| `proxyBufferSize` | `proxy_buffer_size` | string | — |
| `proxyConnectTimeout` | `proxy_connect_timeout` | string | — |
| `proxyReadTimeout` | `proxy_read_timeout` | string | Long values required for streaming/generation routes |
| `proxySendTimeout` | `proxy_send_timeout` | string | — |
| `proxyWebsocketUpgrade` | — | bool | Convenience: renders `proxy_set_header Upgrade $http_upgrade;` and `Connection "upgrade";` |
| `proxyRedirect` | `proxy_redirect` | string | — |
| `proxyInterceptErrors` | `proxy_intercept_errors` | bool | — |
| `proxyNextUpstream` | `proxy_next_upstream` | string | For example `"error timeout http_502"`; `"off"` disables |
| `proxyHideHeader` | `proxy_hide_header` | string[] | Headers stripped from upstream responses |
| `proxyRequestBuffering` | `proxy_request_buffering` | bool | `false` streams request bodies (upload/long-poll paths) |
| `proxyMethod` | `proxy_method` | string | Overrides the HTTP method forwarded to the upstream |
| `authBasic` | `auth_basic` | string | `"<realm> [off]"`; requires `authBasicUserFile` |
| `authBasicUserFile` | `auth_basic_user_file` | string | Absolute path to an htpasswd-style user file |
| `limitReq` | `limit_req` | string[] | Entries are `"<zone> [burst=<n>] [nodelay]"`; zone declared by http `limitReqZone` |
| `addHeader` | `add_header` | string[] | — |
| `allow` / `deny` | `allow` / `deny` | string[] | Access control at location scope |
| `limitRate` | `limit_rate` | string | — |
| `rewrite` | `rewrite` | string[] | — |
| `etag` | `etag` | bool | Static file ETag generation |
| `disableSymlinks` | `disable_symlinks` | string | `"off"` or `"if_not_owner"` |
| `logNotFound` | `log_not_found` | bool | — |
| `sendfileMaxChunk` | `sendfile_max_chunk` | string | — |
| `raw` | — | string[] | Section 4.2 |

### 11.2 Directory Resource Mounting Keys

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `root` | `root` | string | Directory root for file serving; install-layout paths from `SDKWORK_DEPLOY_SPEC.md` section 4 or `RUNTIME_DIRECTORY_SPEC.md` web roots |
| `alias` | `alias` | string | Path substitution; directory aliases `MUST` end with `/` |
| `index` | `index` | string[] | — |
| `tryFiles` | `try_files` | string[] | SPA fallback uses `$uri`, `$uri/`, fallback file; adaptive Web must use named-location dispatch, not variable root (`SDKWORK_DEPLOY_SPEC.md` §8.1) |
| `include` | `include` | string[] | Fixed snippet paths relative to `deployments/webserver/` (or absolute install paths). Variable include paths (`web.$…_surface_final.conf`) are forbidden. Adaptive Web uses http-level maps + `location /` dispatch + server-level `@pc` / `@h5` named locations |
| `autoindex` | `autoindex` | bool | Default `false`; directory listing `MUST NOT` be enabled on public production roots without an exception |
| `expires` | `expires` | string | — |
| `returnStatus` / `returnBody` | `return` | int / string | See section 9 rules |

### 11.3 Serving Behavior Rules

- `proxyPass`, `root`, `alias`, `returnStatus`, and location-level `include`
  are mutually exclusive serving behaviors in one location; specifying more
  than one of `proxyPass` / `root` / `alias` / `returnStatus` fails
  validation. Adaptive Web `location /` `MAY` use `raw`/`tryFiles` dispatch to
  `@$…_surface_final` while `@pc` / `@h5` named locations live as server-level
  siblings (`SDKWORK_DEPLOY_SPEC.md` §8.1).
- Every `[[http.server]]` with traffic `MUST` route unmatched requests
  explicitly: at minimum a `match = "/"` location or a server-level
  `returnStatus`.
- Public browser hosts that serve module UI from stock nginx (`expose.mode`
  `web` / `web+api`) `MUST` follow adaptive PC/H5 selection per
  `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1 and
  `SDKWORK_DEPLOY_SPEC.md` §8: mobile → H5 (fallback PC / `collapse-pc`),
  desktop → PC (fallback H5 / `collapse-h5`). Stock nginx emission `MUST`
  use named-location dispatch (`SDKWORK_DEPLOY_SPEC.md` §8.1), not variable
  `include`. When neither surface is installed, `match = "/"` `MUST` serve
  the configured static resource `root` (`static-fallback`, typically
  `/usr/share/sdkwork/<runtimeCode>/web/static` or the module location
  `root`) with ordinary file `try_files` (typically `=404`), not an empty
  adaptive map and not a fabricated SPA shell. Plan folding
  (`sdkwork-specs/tools/webserver/adaptive-web.mjs`, invoked from module
  `scripts/render-webserver-nginx-sidecars.mjs` or equivalent) `MUST` rewrite
  Adaptive-Web-wired public `/` locations before rendering
  `nginx.<profile>.conf` sidecars. Authority cross-links: `NGINX_SPEC.md` §7,
  `SDKWORK_DEPLOY_SPEC.md` §8.1.
- The `sdkwork-webserver` module's own public-ingress hosts (`expose.mode:
  api`) `MUST` reverse-proxy all public paths (including `/`) to the gateway
  upstream. Edge nginx `MUST NOT` declare Adaptive Web maps, `@pc` / `@h5`
  roots, or module SPA static roots for those hosts; Adaptive Web, website
  delivery, reverse proxy, and static serving are owned by the webserver
  process.
- Streaming and generation routes `MUST` disable proxy buffering and extend
  proxy timeouts; `proxyWebsocketUpgrade` is required for WebSocket paths.
- `match` values `MUST` start with `/`, `= /`, `^~ /`, `~ `, or `~* ` and be
  unique within their server (W22).
- Forwarded headers (`X-Forwarded-For`, `X-Forwarded-Proto`, `Host`) `MUST`
  be preserved for proxied surfaces; trusted-proxy CIDRs follow the module's
  deployment inputs.

## 12. Stream Context (`[stream]`, `[[stream.server]]`)

TCP stream proxying uses the nginx `stream` context. The Rust data plane
executes plaintext TCP, TLS termination (`listen … ssl`), and TLS passthrough
(`sslPreread = true`). UDP and `stream.raw` fail closed (serve via nginx edge
or a future profile). V1 `sslPreread` peeks ClientHello SNI for diagnostics but
still routes every connection to the configured `proxyPass` (no SNI map yet).

```toml
[stream]
[[stream.server]]
listen = ["3306"]
proxyPass = "10.0.0.5:3306"
proxyTimeout = "60s"

[[stream.server]]
listen = ["127.0.0.1:443 ssl"]
certificate = "site"
proxyPass = "127.0.0.1:8443"

[[stream.server]]
listen = ["127.0.0.1:8443"]
sslPreread = true
proxyPass = "backend"
```

| TOML key | nginx directive | Type | Notes |
| --- | --- | --- | --- |
| `stream.raw` | — | string[] | Section 4.2; fail closed for runtime |
| `[[stream.server]].listen` | `listen` | string[] | Required; `"<port>"` / `"<host>:<port>"` / `"… ssl"`; first entry is merge identity |
| `[[stream.server]].certificate` | `ssl_certificate` binding | string | Required when `listen` includes `ssl`; references `[http.certificates.<name>]` |
| `[[stream.server]].sslPreread` | `ssl_preread` | bool | TLS passthrough; mutually exclusive with `listen … ssl` |
| `[[stream.server]].proxyPass` | `proxy_pass` | string | Required; `host:port` literal or upstream name (section 8 semantics) |
| `[[stream.server]].proxyTimeout` | `proxy_timeout` | string | Runtime floor 1000 ms |
| `[[stream.server]].proxyProtocol` | `proxy_protocol` | bool | Outbound PROXY v1 to upstream when true |
| `[[stream.server]].raw` | — | string[] | Section 4.2 |

Upstream-referenced stream targets `MUST` honor the same live/backup and
health ejection state as HTTP reverse proxy (shared `ProxyUpstream`).

Stream servers `MUST` bind loopback or declared private addresses by default;
public stream listeners require documented approval.

## 13. Integration With Deployment Standards

### 13.1 `deploy.yaml` Consistency

- Every `expose.domain` in `deployments/deploy.yaml` `SHOULD` appear in a
  `[[http.server]]` `serverName` of the matching profile's effective
  configuration. The validator emits a warning when a module declares both
  files and the sets diverge.
- `install.layout` web roots (`SDKWORK_DEPLOY_SPEC.md` section 4) are the
  canonical `root` values for `binary-package` and `source-tree` layouts.

### 13.2 Nginx Rendering

Each profile's effective configuration is a declarative source for the site
files and upstreams defined by `NGINX_SPEC.md`: canonical site path
`/etc/nginx/sites-enabled/sdkwork/<domain>.conf`, certificate root
`/opt/certs/letsencrypt/live/<cert-name>/`, upstream normalization, and
`nginx -t` before reload. Generated config comments `MUST` include the source
file names (`server.common.toml`, `server.<profile>.toml`) so operators can
trace the declarative origin.

### 13.3 Runtime Materialization

The `sdkwork-webserver` runtime consumes `sdkwork.webserver.config.json`
(module schema). Materializing an effective configuration maps:

| TOML (effective) | runtime config |
| --- | --- |
| `[[http.server]]` listen/serverName | `listeners` + `virtualHosts[].serverNames` |
| `[[http.server.location]]` match/proxyPass | `virtualHosts[].routes` (match) + `proxy` resource with `upstreamRef` |
| `[[http.server.location]]` root/alias/tryFiles | `static` resource (`root`, `indexFiles`, `spaFallback`) |
| `[[http.server.location]]` returnStatus/returnBody | `respond` resource |
| `[[http.upstream]]` | `upstreams` (targets, load balancing, timeouts, retry) |
| `[http.certificates]` + `[http.server.tls]` | `certificates` + `tlsPolicies` |
| `[main]`/`[http]` limits | `limits` |

Materialization `MUST` be deterministic and `MUST NOT` invent serving behavior
absent from the effective configuration.

### 13.4 Runtime Alignment Matrix

The `sdkwork-webserver` runtime (`crates/sdkwork-webserver-core/src/config/server_toml.rs`)
loads a layout v2 directory through `load_server_toml_app(dir, profile, app_key)`
with the same merge semantics as the validator. Its materialization alignment:

| server.toml capability | Runtime alignment |
| --- | --- |
| `listen`/`serverName`/`http2` | Mapped: shared listeners per bind/port; `http2` on TLS listeners; explicit plaintext listens are declared intent (`allowPlaintextHttp`) |
| `[http.server.tls]` + `[http.certificates]` | Mapped: named certificates bind their `serverName`s; `TLSv1.2`/`TLSv1.3` policies; SNI-per-port differences fail closed |
| `root`/`index`/`tryFiles` | Mapped: static resource; runtime roots are chroot-relative, absolute paths lose the leading `/`; SPA fallback from the last `tryFiles` entry; location prefix is stripped before join (mount semantics) |
| `alias`/`index`/`tryFiles` | Mapped: same static resource model as `root` (prefix strip = nginx `alias`); directory aliases `MUST` end with `/`; regex locations with `alias` fail closed |
| `returnStatus`/`returnBody` | Mapped: respond resource |
| `proxyPass` to a declared upstream | Mapped: proxy resource with `upstreamRef`; literal `http(s)://host:port` targets synthesize a dedicated upstream |
| `[[http.upstream]]` targets/weight/backup | Mapped: `down` targets filtered; literal IP targets are authorized (`addressPolicy.allowedCidrs`) because `server.toml` is operator-declared intent |
| `loadBalancing` | `round-robin`, `least-connections`, `ip-hash`, `random`, and `hash` (`hashKey` with `$request_uri`/`$uri`/`$remote_addr`/`$host` and optional `consistent`) mapped; unsupported hash keys fail closed |
| `proxySetHeader` | Mapped: `"Name value"` entries with `$host`/`$scheme`/`$remote_addr`/`$proxy_add_x_forwarded_for`/`$http_upgrade` (or literals) execute on the Rust proxy path; unsupported `$vars` fail closed at materialize |
| Proxy timeouts / buffering / websocket upgrade flags | Accepted as declarations; runtime uses its bounded streaming/timeout defaults — nginx buffering knobs are not executed |
| `alias`, `authBasic`, `clientCertificate` | `alias` mapped (see above). `authBasic` / `authBasicUserFile` mapped: htpasswd `$apr1$` / `{SHA}` / bcrypt loaded at materialize; Basic challenge on the Rust data plane. `clientCertificate` fails closed until implemented (tracked in `sdkwork-webserver/specs/nginx-gap.catalog.json`); stock edge nginx is reverse-proxy/interop only and `MUST NOT` be treated as a substitute execution plane for those gaps |
| regex `match` (`~`/`~*`), `^~` prefix-exclusive, `rewrite` (`last`/`break`/`redirect`/`permanent`) | Mapped: location selection follows nginx exact → longest prefix / `^~` → regex order → prefix; rewrite applies a bounded internal-redirect state machine (`MAX_REWRITE_INTERNAL_REDIRECTS`) |
| `limitReqZone` / location `limitReq` / `allow` / `deny` | Mapped: `$binary_remote_addr`/`$remote_addr` zones with burst/nodelay admission (delay queue not scheduled); location `allow` then `deny` ordered ACL (empty = inactive) |
| `stream` TCP (`[[stream.server]]`) | Mapped: plaintext TCP, TLS terminate (`listen … ssl` + `certificate`), or `sslPreread` passthrough to literal/`upstream`; health-aware upstream pick shared with HTTP; idle `proxyTimeout`; optional outbound PROXY v1; share connection admission. UDP / `stream.raw` fail closed |
| `raw` directives | Not executable; a non-empty `raw` fails closed at load time |

Fail-closed is deliberate: a declared directive that the Rust data plane cannot
honor must never silently diverge from the operator's intent. Capability gaps are
tracked in `sdkwork-webserver/specs/nginx-gap.catalog.json`. Edge nginx sidecars
(`NGINX_SPEC.md` rendering under `nginx.enabled`) are a reverse-proxy and
interop surface, not a substitute execution plane for unimplemented Rust
capabilities.

### 13.5 Secrets

- The TOML files `MUST NOT` contain plaintext secrets, private key material,
  or credentials. Inline material is detected by the validator.
- Secret indirection uses `secret://` references only
  (`SDKWORK_DEPLOY_SPEC.md` section 11); `PACKAGING_SPEC.md` forbidden-content
  rules apply to `deployments/webserver/`.

### 13.6 Process Adaptive Web Static Roots (`config.toml` `[app_roots]`)

For `expose.mode: api` (webserver product), edge TOML is proxy-only. Process
runtime TOML owns Adaptive Web:

| Key | Role |
| --- | --- |
| `pc_static_root` / `h5_static_root` / `static_fallback_root` | Explicit roots (win when set) |
| `*_by_environment` | Maps keyed by lifecycle environment |
| `tablet_surface` | `pc` (default) or `h5` |

Checkout: `apps/sdkwork-webserver-{pc,h5}/dist/<envAlias>/`.
Installed: `<share>/web/{pc,h5,static}/` (`RUNTIME_DIRECTORY_SPEC.md` §4.1.1).
Env: `SDKWORK_WEBSERVER_{PC,H5,STATIC_FALLBACK}_STATIC_ROOT`,
`SDKWORK_WEBSERVER_TABLET_SURFACE`.
Example: `sdkwork-webserver/deployments/webserver/app-roots.example.toml`.
Device rules: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1.
## 14. Validation Rules

The validator `tools/check-webserver-toml-standard.mjs` enforces:

| Id | Rule |
| --- | --- |
| W1 | Layout v2 files exist: `server.common.toml`, `server.standalone.toml`, `server.cloud.toml`; the retired single-file `server.toml` `MUST NOT` exist |
| W2 | Every file parses as the TOML subset of section 3.2 (no multi-line strings, datetimes, or duplicates) |
| W3 | Effective configurations carry `specVersion = 1`, `kind = "sdkwork.webserver.server"`, `id` from the common baseline |
| W4 | `enabled = false` declares `description` and no servers; `enabled = true` (default) has at least one `[[http.server]]` or `[[stream.server]]` per effective configuration |
| W5 | Unknown typed keys fail per `unknownDirectivePolicy`; `allow` requires `exceptionRef`; `strict = false` requires `exceptionRef` |
| W6 | `[main.events]` `workerConnections` present when `[main.events]` exists |
| W7 | Upstream `name` unique and `^[a-z][a-z0-9_-]*$`; at least one live target per effective configuration |
| W8 | `proxyPass` upstream references resolve to declared upstreams or literal `http(s)://host:port`; placeholder ports (such as `8080`) produce a warning |
| W9 | `serverName` values are bare hosts/wildcards without scheme/port/path and are not duplicated across servers in an effective configuration |
| W10 | `listen` values match nginx listen syntax; `ssl` listen requires `[http.server.tls]` |
| W11 | TLS `cert` references resolve; `cert` and direct file fields are mutually exclusive; legacy `TLSv1`/`TLSv1.1` rejected |
| W12 | Location `match` starts with `/`, `= /`, `^~ /`, `~ `, or `~* `; serving behaviors (`proxyPass`/`root`/`alias`/`returnStatus`) are mutually exclusive |
| W13 | Raw entries are single `name args...;` statements without braces |
| W14 | Certificate and key paths are absolute or `secret://`; no `-----BEGIN` key material inline anywhere |
| W15 | Workspace root has no `deployments/webserver/` |
| W16 | When `nginx.enabled = true` (default), present per-profile sidecars match the effective render under `strict`; when `nginx.enabled = false`, sidecars are ignored with a warning |
| W17 | `enabled = false` effective configurations have no `[[http.server]]`/`[[stream.server]]` |
| W18 | `deploy.yaml` `expose` domains are covered by `serverName` across the effective configurations (warning when `deploy.yaml` is present) |
| W19 | Layout v2 only: `server.toml` is retired and fails validation when present; v2 files exist (see W1) |
| W20 | `server.common.toml` has no `profile` key; `server.standalone.toml` declares `profile = "standalone"`; `server.cloud.toml` declares `profile = "cloud"`; profile files `MUST NOT` declare `specVersion`/`kind`/`id` |
| W21 | Each profile's effective configuration passes rules W2-W18 (excluding W19-W20) after merge |
| W22 | Identity keys are unique in each effective configuration: one location `match` per server, one upstream `name`, one `serverName` across servers |

Workspace mode (`--workspace <root>`) scans every sibling module with a
`deployments/` directory and reports missing layout v2 files as compliance
gaps. `tools/webserver/scaffold-workspace.mjs` generates the initial v2 files
for every workspace module from its own `specs/topology.spec.json` facts
(hosts, gateway bind); modules without a declared web surface are generated
with `enabled = false` and must be enabled by their maintainer when a surface
appears.

## 15. Examples

See `examples/webserver/` for a complete multi-virtual-host example split
into `server.common.toml`, `server.standalone.toml`, and `server.cloud.toml`
with reverse proxy, static mounting, upstreams, certificates, raw directives,
and a profile delta. See `examples/deploy/` for `deploy.yaml` counterparts.

## 16. Acceptance Checklist

- [ ] `deployments/webserver/server.common.toml`, `server.standalone.toml`,
      and `server.cloud.toml` exist and the module passes
      `node tools/check-webserver-toml-standard.mjs --root .`.
- [ ] Common serving behavior (hosts, certificates, static roots, shared
      upstreams) lives in `server.common.toml`; profile deltas (targets,
      profile-only surfaces) live in the profile files.
- [ ] Every public host the module serves appears in a merged
      `[[http.server]]` `serverName`.
- [ ] Reverse proxy locations resolve declared upstreams per profile;
      streaming routes disable buffering; WebSocket paths enable upgrade
      headers.
- [ ] Static web roots use install-layout paths; adaptive Web uses stock-nginx
      named-location dispatch (`SDKWORK_DEPLOY_SPEC.md` §8.1), not variable
      `include` and not variable-root SPA fallback; neither PC nor H5 uses
      `static-fallback`. For `expose.mode: api` (webserver product), edge TOML
      stays proxy-only and process `[app_roots]` (§13.6) binds PC/H5/static.
- [ ] TLS listeners reference named certificates with `TLSv1.2`/`TLSv1.3`
      only; certificate paths follow `NGINX_SPEC.md`; no inline key material.
- [ ] Raw directives are single statements; per-profile `nginx.*.conf`
      sidecars (when present) are the equivalent renders.
- [ ] `deploy.yaml` `expose` domains and the effective `serverName` sets are
      consistent.
