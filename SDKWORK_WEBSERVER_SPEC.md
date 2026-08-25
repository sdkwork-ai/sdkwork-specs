# SDKWork Web Server Deploy Configuration Standard

- Version: 3.1
- Scope: per-module `deployments/webserver/` layout v3 — shared baseline, **one file per lifecycle environment**, one file per deployment profile; nginx-parallel declarative web server configuration
- Related: `NGINX_SPEC.md`, `SDKWORK_DEPLOY_SPEC.md`, `DEPLOYMENT_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_NAMING.md`, `SECURITY_SPEC.md`, `OBSERVABILITY_SPEC.md`, `CONFIG_SPEC.md`, `TEST_SPEC.md`

Every independent SDKWork module root `MUST` contain a `deployments/webserver/`
directory with **layout v3** — seven TOML files:

1. `server.common.toml` — module identity, nginx/main/http globals, upstream skeleton (no virtual hosts).
2. `server.development.toml`, `server.test.toml`, `server.staging.toml`, `server.production.toml` — lifecycle environment overlays (hosts, TLS, locations).
3. `server.standalone.toml`, `server.cloud.toml` — deployment profile overlays (upstream targets only).

Process startup selects **one deployment profile** and **one lifecycle environment**, then loads and merges the matching files.

## 0. Quick Reference

| Question | Answer |
| --- | --- |
| How many files? | **7** TOML files per module (1 common + 4 environments + 2 profiles) |
| How is config merged? | `effective(<profile>.<environment>) = merge(common, server.<environment>.toml, server.<profile>.toml)` |
| What goes in common? | Identity, `[nginx]`, `[main]`, `[http]` globals, platform `[http.certificates]`, `[http.defaults.tls]`, upstream skeleton — **no** `[[http.server]]` |
| What goes in environment files? | `environment = "…"`, virtual hosts (`listen`, `serverName`, `tls.cert`, `include`) for **that tier only** |
| What goes in profile files? | `profile = "standalone"` or `"cloud"`, upstream **targets** only |
| How many hosts per tier? | Every registered base domain (`APP_RUNTIME_TOPOLOGY_NAMING.md` §9.3) in **each** environment file |
| Development / test / staging | Suffix hosts (`im-dev.sdkwork.com`, …), listener `80`, longer proxy timeouts |
| Production | Bare hosts (`im.sdkwork.com`, …), listeners `443 ssl` + `80`, TLS + health locations |
| Align from topology | `node sdkwork-specs/tools/webserver/align-webserver-workspace.mjs <workspace-root>` |
| Render nginx sidecars | `node sdkwork-specs/tools/webserver/render-nginx-sidecars.mjs <workspace-root>` (also runs during align) |
| Validate | `node sdkwork-specs/tools/webserver/audit-workspace.mjs <workspace-root>` |
| Dual config | TOML (source of truth) + `nginx.<profile>.<environment>.conf` (human-readable render + nginx compat entry) |
| Default process startup | `sdkwork-api-webserver-standalone-gateway` with no subcommand serves the nginx sidecar for `SDKWORK_WEBSERVER_DEPLOYMENT_PROFILE` × `SDKWORK_WEBSERVER_ENVIRONMENT` |

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
| `deployments/webserver/nginx.<profile>.<environment>.conf` | Rendered nginx for one profile×environment effective merge | `NGINX_SPEC.md` |
| `sdkwork.webserver.config.json` | Executable runtime configuration of the SDKWork Web Server process | `sdkwork-webserver` module `specs/sdkwork.webserver.config.schema.json` |

Rules:

- The TOML files are the source of truth for the web data plane at deploy
  time. Tools and operators `MAY` render them into nginx site files
  (`NGINX_SPEC.md`) or materialize them into the webserver runtime config, but
  `MUST NOT` edit either derived artifact without re-deriving it.
- `deployments/deploy.yaml` (`SDKWORK_DEPLOY_SPEC.md`) declares which public
  hosts an application owns (`expose`); the TOML files declare how those hosts
  are served. Every `expose` domain `SHOULD` appear in
  `effective(<profile>.<environment>)` `serverName` for the matching
  `deployments/deploy.yaml` profile id.
- Profile selects upstream topology (`server.standalone.toml` /
  `server.cloud.toml`); environment selects which `server.<environment>.toml`
  is merged. Each lifecycle tier is an **independent file** — not combined in
  `server.common.toml`.
- The webserver runtime config schema remains the executable authority for the
  `sdkwork-webserver` process; section 13 defines the materialization mapping.

## 2. File Location Contract And Inheritance Model

### 2.1 Files

Every independent module root `MUST` contain:

```text
<module-root>/deployments/
  webserver/
    server.common.toml           # identity + globals; MUST NOT declare [[http.server]]
    server.development.toml      # environment = "development"
    server.test.toml             # environment = "test"
    server.staging.toml          # environment = "staging"
    server.production.toml       # environment = "production"
    server.standalone.toml       # profile = "standalone"
    server.cloud.toml            # profile = "cloud"
```

Optional:

```text
    nginx.standalone.production.conf   # rendered effective(standalone.production)
    nginx.cloud.development.conf       # rendered effective(cloud.development)
    snippets/*.conf
    certs/
    README.md
    app-roots.example.toml
```

Rules:

- Environment file names are exactly `server.development.toml`, `server.test.toml`,
  `server.staging.toml`, and `server.production.toml`.
- Profile file names remain `server.standalone.toml` and `server.cloud.toml`.
- Layout v2 (all hosts in `server.common.toml` only) is **retired** (W19/W20).
- A module with no public web surface still `MUST` ship all seven files;
  `server.common.toml` carries `enabled = false`; environment files declare
  only `environment = "<name>"`.
- `deployments/webserver/` is deploy-time source configuration. Runtime
  directories, secrets, and installed artifacts follow
  `RUNTIME_DIRECTORY_SPEC.md` and `SOURCE_CONFIG_SPEC.md`; never commit
  production keys under `certs/`.
- Every TOML file `MUST` parse as the TOML subset defined in section 3.2, and
  the directory `MUST` pass `tools/check-webserver-toml-standard.mjs` before
  merge.

### 2.2 Effective Configuration And Inheritance

Each runtime activation has one **effective configuration**:

```text
effective(<profile>.<environment>) =
  merge(merge(server.common.toml, server.<environment>.toml), server.<profile>.toml)
```

Examples:

```text
effective(standalone.development) = merge(common, server.development.toml, server.standalone.toml)
effective(cloud.production)       = merge(common, server.production.toml, server.cloud.toml)
```

The loader `MUST` strip file-role keys (`profile`, `environment`) before merge.
Every effective configuration `MUST` pass validation (W21).

| File | Role | Required root keys |
| --- | --- | --- |
| `server.common.toml` | Shared baseline | `specVersion`, `kind`, `id`; no `profile` / `environment`; no `[[http.server]]` when enabled |
| `server.<environment>.toml` | Lifecycle overlay | `environment = "<name>"`; hosts/certs/locations for that tier only |
| `server.<profile>.toml` | Deployment overlay | `profile = "standalone"` or `"cloud"`; upstream targets only |

Materialize from topology:

```bash
node <sdkwork-specs>/tools/align-webserver-workspace.mjs --root .
```

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

### 2.4 Environment Files (Independent Per Tier)

Each lifecycle environment is a **separate file**. Never combine tiers in
`server.common.toml`.

| File | `environment` | Host pattern | Listeners | TLS | Locations |
| --- | --- | --- | --- | --- | --- |
| `server.development.toml` | `development` | `<role>-dev.<base-domain>` × all bases | `80` | no | `/api/`, `/`, gateway proxy |
| `server.test.toml` | `test` | `<role>-test.<base-domain>` × all bases | `80` | no | same |
| `server.staging.toml` | `staging` | `<role>-staging.<base-domain>` × all bases | `80` | no | same |
| `server.production.toml` | `production` | `<role>.<base-domain>` × all bases | `443 ssl`, `80` | yes (per base cert) | `/healthz`, `/readyz`, `/api/`, `/` |

Capability by tier:

| Capability | development | test | staging | production |
| --- | --- | --- | --- | --- |
| Multi-base-domain hosts | required (W26) | required | required | required |
| `[http.certificates]` | **common only (W27)** | **common only** | **common only** | **common only** |
| `[[http.server]]` | one block, all env hosts in `serverName` | same | same | one block **per base domain** (TLS split) |
| Location behavior | `include snippets/gateway-locations.nonproduction.conf` | same | same | `include snippets/gateway-locations.production.conf` |
| Health probes (`/healthz`, `/readyz`) | via production snippet | via production snippet | via production snippet | **required** (snippet) |
| TLS protocols / session cache | `[http.defaults.tls]` in common | same | same | same; server declares `tls.cert` only |
| `proxyReadTimeout` on `/` | `300s` (snippet) | `300s` | `300s` | `120s` |
| Upstream target | from profile file | from profile file | from profile file | from profile file |

Rules:

- Host formula: `APP_RUNTIME_TOPOLOGY_NAMING.md` §9.2; base domains §9.3.
- **W26:** when production declares hosts, development/test/staging `MUST` declare
  the same base-domain count.
- Profile files declare upstream targets only — no `environment`, no virtual hosts.
- Runtime selects profile + environment (`SDKWORK_<CODE>_DEPLOYMENT_PROFILE`,
  `SDKWORK_<CODE>_ENVIRONMENT`) and merges the three layers (§2.2).
- Adaptive Web static roots live in process `[app_roots.*_by_environment]` (§13.6).

### 2.5 Merge Example (layout v3)

`server.common.toml` (no virtual hosts):

```toml
specVersion = 1
kind = "sdkwork.webserver.server"
id = "im"

[nginx]
profile = "http-core-v1"

[http]
sendfile = true
clientMaxBodySize = "1100m"

[[http.upstream]]
name = "gateway"
loadBalancing = "least-connections"
keepalive = 32
```

`server.production.toml`:

```toml
environment = "production"

[http.certificates."sdkwork.com"]
certFile = "/etc/sdkwork/certs/letsencrypt/sdkwork.com/fullchain.pem"
certKeyFile = "/etc/sdkwork/certs/letsencrypt/sdkwork.com/privkey.pem"

[[http.server]]
listen = ["443 ssl", "80"]
serverName = ["im.sdkwork.com"]
[http.server.tls]
cert = "sdkwork.com"
protocols = ["TLSv1.2", "TLSv1.3"]

[[http.server.location]]
match = "/"
proxyPass = "http://gateway"
```

`server.development.toml`:

```toml
environment = "development"

[[http.server]]
listen = ["80"]
serverName = ["im-dev.sdkwork.com", "im-dev.birdcoder.com"]

[[http.server.location]]
match = "/"
proxyPass = "http://gateway"
```

`server.standalone.toml` (upstream delta only):

```toml
profile = "standalone"

[[http.upstream]]
name = "gateway"
[[http.upstream.target]]
address = "127.0.0.1:3900"
weight = 1
```

`effective(standalone.production)` inherits production hosts/TLS from
`server.production.toml` and the standalone upstream target from
`server.standalone.toml`.

## 3. Document Structure

### 3.1 Root Keys And Context Hierarchy

| TOML root key | nginx context | Purpose |
| --- | --- | --- |
| `specVersion` | — | Integer, `1` for this version of the document schema |
| `kind` | — | String, `"sdkwork.webserver.server"`; common file only |
| `id` | — | Module `runtimeCode` (`SDKWORK_DEPLOY_SPEC.md` section 3); common file only |
| `environment` | — | `"development"`, `"test"`, `"staging"`, or `"production"`; environment files only |
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
| `confFile` | `"nginx.conf"` | Base name of compatibility sidecars: `nginx.<profile>.<environment>.conf` |

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
- Sidecar file names follow profile × environment:
  `nginx.<profile>.<environment>.conf` (from `confFile = "nginx.conf"`), compared
  against each `effective(<profile>.<environment>)` render. Legacy
  `nginx.<profile>.conf` (production-only) is accepted with a migration warning.

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

When `nginx.<profile>.<environment>.conf` exists (or legacy
`nginx.<profile>.conf` for production):

- It `MUST` be the rendered equivalent of that profile's **effective**
  configuration for the matching environment: tools generate it with the fixed rendering order, and
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
certFile = "/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/fullchain.pem"
certKeyFile = "/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/privkey.pem"
chainFile = "/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/chain.pem"
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

- Platform base-domain certificate blocks `MUST` be authored once in
  `server.common.toml` (W27). Environment files `MUST NOT` repeat
  `[http.certificates]`.
- Certificate names are TOML table keys; names containing dots (such as
  base-domain names like `sdkwork.com`) `MUST` be written as quoted keys
  (`[http.certificates."sdkwork.com"]`); references (`cert = "sdkwork.com"`)
  are plain strings.
- Certificate paths `MUST` be absolute and `MUST` follow the `NGINX_SPEC.md`
  section 3 contract (`/etc/sdkwork/certs/letsencrypt/<cert-name>/...`) unless
  an operator-managed root is documented in the module `deployments/webserver/README.md`.
- The retired bootstrap path `/opt/certs/letsencrypt/live/` `MUST NOT` appear in
  any new configuration (W25).

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

### 7.2 TLS And Location Defaults (DRY)

Shared TLS parameters and gateway location behavior `MUST NOT` be duplicated
across environment virtual hosts:

| Artifact | Role |
| --- | --- |
| `defaults` | Typed key under `[http]` for shared overlays (see `[http.defaults.tls]`) |
| `[http.defaults.tls]` | Shared `protocols`, `preferServerCiphers`, `sessionCache` merged into each `[[http.server]].tls` at effective-config time |
| `snippets/gateway-locations.production.conf` | Health probes, `/api/`, `/` proxy behavior for production |
| `snippets/gateway-locations.nonproduction.conf` | `/api/`, `/` proxy behavior for development/test/staging |
| `[[http.server]].include` | References the snippet for that tier; environment files declare hosts, listen, and `tls.cert` only (W28) |

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

### 8.1 Reserved Upstream Name `gateway` (W30)

SDKWork standardizes on one **canonical upstream name** per effective nginx
configuration: `gateway`. This is intentional; modules `MUST NOT` rename it to
`<module>-gateway`, `<applicationCode>_gateway`, or other module-specific
identifiers.

| Scope | Rule |
| --- | --- |
| **Within one nginx process** | Upstream names `MUST` be unique (W7, W22). Every enabled module declares exactly one `[[http.upstream]]` with `name = "gateway"` for its API/application reverse-proxy target. |
| **Across modules** | Each module ships an **isolated** layout v3 tree and renders **one** `nginx.<profile>.<environment>.conf` sidecar per process startup. The name `gateway` is reused in every module checkout, but each running nginx loads only **one** effective configuration — there is no cross-module upstream collision at runtime. |
| **Multiple `[[http.server]]` blocks** | All virtual hosts in the same effective configuration share the single `upstream gateway { … }` block. Many `server { }` blocks referencing `proxy_pass http://gateway;` is normal and required. |
| **Shared snippets** | `snippets/gateway-locations.*.conf` and `snippets/gateway-api-locations.production.conf` hardcode `proxy_pass http://gateway;`. Renaming the upstream in TOML without updating these snippets breaks rendering (W28). |
| **Additional upstreams** | Modules that need non-gateway backends (for example a dedicated websocket or object-store proxy) `MAY` declare extra `[[http.upstream]]` entries with **distinct** names (`object_store`, `realtime`, …). Only the application/platform API target uses `gateway`. |
| **Multi-module import (§17)** | When `sdkwork-webserver` composes sibling module configs into one container runtime, the composer `MUST` **deduplicate** upstream blocks by `name`. Identical `upstream gateway` definitions collapse to one block; conflicting targets for the same name are a composition error. Module source trees keep `name = "gateway"`; the composer normalizes — modules do not prefix upstream names locally. |

Profile target semantics (unchanged):

| Profile | `gateway` target |
| --- | --- |
| `standalone` | Local `sdkwork-api-<application-code>-standalone-gateway` bind (for example `127.0.0.1:3900`) |
| `cloud` | Platform API gateway service (for example `sdkwork-api-cloud-gateway:8080`) |

Forbidden:

- Renaming the primary API upstream away from `gateway` in module TOML or snippets.
- Declaring more than one upstream named `gateway` in the same effective configuration.
- Assuming upstream names are globally unique across the workspace; uniqueness is **per nginx process / per effective configuration** only.

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
  (`sdkwork-specs/tools/webserver/adaptive-web.mjs`, invoked from
  `sdkwork-specs/tools/webserver/render-nginx-sidecars.mjs` or module
  `scripts/render-webserver-nginx-sidecars.mjs`) `MUST` rewrite
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
`/etc/sdkwork/certs/letsencrypt/<cert-name>/`, upstream normalization, and
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
loads a layout v3 directory through `load_server_toml_app(dir, profile, environment, app_key)`
with the same merge semantics as the validator. Its materialization alignment:

| server.toml capability | Runtime alignment |
| --- | --- |
| `listen`/`serverName`/`http2` | Mapped: shared listeners per bind/port; `http2` on TLS listeners; explicit plaintext listens are declared intent (`allowPlaintextHttp`) |
| `[http.server.tls]` + `[http.certificates]` | Mapped: named certificates bind their `serverName`s; `TLSv1.2`/`TLSv1.3` policies; per-base-domain TLS split on one listener port is served by multi-cert SNI (the listener policy collects every certificate for the port); version/ALPN (HTTP/2 intent) or client-auth differences between servers sharing a port fail closed |
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

Checkout: `apps/sdkwork-webserver-{pc,h5}/dist/<profile>/<envAlias>/`
(`<profile>` is `standalone` or `cloud`; `standalone` is the default profile
and the default serving mode — same-origin `/` SDK base URLs. Cloud profile
SPA roots are CDN-publishable artifacts, not gateway-served roots).
Installed: `<share>/web/{pc,h5,static}/` (`RUNTIME_DIRECTORY_SPEC.md` §4.1.1).
Env: `SDKWORK_WEBSERVER_{PC,H5,STATIC_FALLBACK}_STATIC_ROOT`,
`SDKWORK_WEBSERVER_TABLET_SURFACE`.
Example: `sdkwork-webserver/deployments/webserver/app-roots.example.toml`.
Device rules: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1.
## 14. Validation Rules

The validator `tools/check-webserver-toml-standard.mjs` enforces:

| Id | Rule |
| --- | --- |
| W1 | Layout v3 files exist: `server.common.toml`, four `server.<environment>.toml`, two `server.<profile>.toml`; retired `server.toml` `MUST NOT` exist |
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
| W16 | When `nginx.enabled = true` (default) and the module is enabled, every `nginx.<profile>.<environment>.conf` sidecar must exist and match the effective render under `strict`; when `nginx.enabled = false`, sidecars are ignored with a warning |
| W17 | `enabled = false` effective configurations have no `[[http.server]]`/`[[stream.server]]` |
| W18 | `deploy.yaml` `expose` domains are covered by `serverName` across the effective configurations (warning when `deploy.yaml` is present) |
| W19 | Layout v2 only: `server.toml` is retired and fails validation when present; v2 files exist (see W1) |
| W20 | `server.common.toml` has no `profile`/`environment` and no `[[http.server]]` when enabled; each `server.<environment>.toml` declares matching `environment`; profile files declare `profile` only |
| W21 | Each `effective(<profile>.<environment>)` passes rules W2–W26 after three-layer merge |
| W22 | Identity keys are unique in each effective configuration: one location `match` per server, one upstream `name`, one `serverName` across servers |
| W23 | Public ingress servers expose `location /` as gateway `proxy_pass` only; forbidden snippet paths on product trees |
| W24 | `serverName` hosts are registered public hosts per `APP_RUNTIME_TOPOLOGY_NAMING.md` §9; platform gateway hosts belong on `sdkwork-api-cloud-gateway` only |
| W25 | Certificate paths use `/etc/sdkwork/certs/letsencrypt/<cert-name>/`; `/opt/certs/letsencrypt/live/` is retired and fails validation |
| W26 | When production declares hosts, development/test/staging `MUST` declare `[[http.server]]` with the same base-domain count |
| W27 | `[http.certificates]` `MUST` live in `server.common.toml` only; environment files `MUST NOT` repeat certificate blocks |
| W28 | `server.include` snippet paths `MUST` exist under `deployments/webserver/` |
| W29 | Modules with `expose.mode` `web` / `web+api` (except edge proxy-only products) `MUST` declare Adaptive Web maps in common, production `location /` dispatch, and gateway `/api/` proxy snippets |
| W30 | Enabled modules `MUST` declare exactly one primary API upstream named `gateway`; shared gateway snippets `MUST` reference `http://gateway`; upstream names are unique per effective configuration / nginx process, not globally across modules; multi-module composers `MUST` deduplicate upstream blocks by name (§8.1) |

Workspace mode (`--workspace <root>`) scans every sibling module with a
`deployments/` directory and reports missing layout v3 files as compliance
gaps. `tools/webserver/scaffold-workspace.mjs` generates the initial v3 files
for every workspace module from its own `specs/topology.spec.json` facts
(hosts, gateway bind); modules without a declared web surface are generated
with `enabled = false` and must be enabled by their maintainer when a surface
appears.

## 15. Examples

See `examples/webserver/` for complete layout v3 examples: `deployments/webserver/`
(`server.common.toml` + `server.<environment>.toml` + `server.<profile>.toml`) with
reverse proxy, multi-base-domain hosts, certificates, and profile deltas. Module
templates live under `examples/webserver/modules/`. See `examples/deploy/` for
`deploy.yaml` counterparts. Refresh with `tools/webserver/sync-webserver-examples.mjs`.

## 17. Docker Space Module Integration

Standalone Docker clusters on one Ubuntu/WSL host share one sdkwork-space checkout
and import sibling modules into the gateway runtime config.

| Item | Standard |
| --- | --- |
| Host checkout | `SDKWORK_SPACE_HOST_PATH` (default `/opt/deploy`) cloned to `…/sdkwork-space` |
| Container mount | `${SDKWORK_SPACE_HOST_PATH}:/opt/deploy` (same path inside the container) |
| Clone URL | `https://github.com/Sdkwork-Cloud/sdkwork-space.git` (`SDKWORK_SPACE_CLONE_URL`) |
| Module discovery | `SDKWORK_SPACE_AUTO_DISCOVER=true`: every enabled `sdkwork-*/deployments/webserver/` except `sdkwork-webserver` and `enabled = false` placeholders; otherwise import only `SDKWORK_SPACE_MODULES` when set |
| Runtime imports | `[[webserver.imports]]` entries in `/etc/sdkwork/webserver/config.toml` (`id`, `path`, `required`, `probe_upstreams`) |
| Materialized copies | Copied TOML at `/etc/sdkwork/webserver/modules/<module-id>/` (standalone upstream patched to the container gateway port) |
| App-roots catalog | Generated `/etc/sdkwork/webserver/module-app-roots/<module-id>.toml` with discovered PC/H5 dist paths |
| Docker defaults | `required = false`, `probe_upstreams = false` (sibling upstreams are not co-located in the webserver container) |
| Multi-cluster | One host runs development/test/production containers on distinct **host** ports (`13800` / `18888` / `18080`); each container listens on gateway port **3800** internally so module `server.standalone.toml` upstreams stay uniform |
| Adaptive Web static | Process `[app_roots]` maps `apps/*-{pc,h5}/dist/{dev,test,staging,prod}` from the checkout; bundled image roots remain the fallback |
| Multi-base-domain | Module environment TOML lists every registered host per `APP_RUNTIME_TOPOLOGY_NAMING.md` §9.1–§9.3 (`sdkwork.com`, `birdcoder.com`, `dtupay.com`, `sdkwork.cn`, `birdcoder.cn`, `dtupay.cn`, `skubc.com`, `skubc.cn`, `zowalk.com`, `zowalk.cn`, `offer86.com`, `offer86.cn`, `86offer.com`, `86offer.cn`, …) |
| Module templates | Copy from `examples/webserver/modules/` in this standards repository |

Operator scripts: `deployments/docker/scripts/setup-host-space-clone.sh`, `entrypoint-standalone.sh`.

### 17.1 Module Browser Build Commands

Each sibling module with Adaptive Web PC/H5 surfaces `MUST` expose the
section 4.2 command family at its repository root — for both `standalone`
(default, same-origin) and `cloud` (unified `api-*` edge) profiles. Docker
operators build one module at a time against the mounted checkout:

| Surface | Host command | Output |
| --- | --- | --- |
| PC dev standalone | `pnpm --dir sdkwork-space/sdkwork-im build:pc:dev` | `apps/sdkwork-im-pc/dist/standalone/dev/` |
| PC prod standalone | `pnpm --dir sdkwork-space/sdkwork-im build:pc:prod` | `apps/sdkwork-im-pc/dist/standalone/prod/` |
| PC dev cloud | `pnpm --dir sdkwork-space/sdkwork-im build:pc:dev:cloud` | `apps/sdkwork-im-pc/dist/cloud/dev/` |
| PC prod cloud | `pnpm --dir sdkwork-space/sdkwork-im build:pc:prod:cloud` | `apps/sdkwork-im-pc/dist/cloud/prod/` |
| H5 dev standalone | `pnpm --dir sdkwork-space/sdkwork-im build:h5:dev` | `apps/sdkwork-im-h5/dist/standalone/dev/` |
| H5 prod standalone | `pnpm --dir sdkwork-space/sdkwork-im build:h5:prod` | `apps/sdkwork-im-h5/dist/standalone/prod/` |
| H5 prod cloud | `pnpm --dir sdkwork-space/sdkwork-im build:h5:prod:cloud` | `apps/sdkwork-im-h5/dist/cloud/prod/` |

The two profile subtrees coexist: the gateway serves the active
`standalone` subtree in the default same-origin mode, while the `cloud`
bundles are the CDN-publishable artifacts that target the unified
`api-dev.<domain>`/`api.<domain>` edge (`ENVIRONMENT_SPEC.md` §5.1.0.1).

From `sdkwork-webserver` (host or container toolchain):

```bash
# Rebuild every owned PC/H5 surface for development and reload static roots
pnpm build:container:module -- --module sdkwork-im --architecture all --environment dev --reload

# Rebuild only PC for production mode inside the container toolchain
pnpm build:container:module -- --module sdkwork-im --architecture pc --environment prod --deployment-environment production --in-container

# Low-level single-surface host build
pnpm build:container:module:browser -- --module sdkwork-im --architecture h5 --environment dev
```

Inside a running standalone container:

```bash
build-browser --module sdkwork-im --architecture all --environment dev --reload-static
reload-module-static
```

The entrypoint resolves static roots from
`apps/*-{pc,h5}/dist/<profile>/<envAlias>/` for the active lifecycle
environment and deployment profile (`development`→`dev`, `production`→`prod`;
`standalone` is the default profile).

Workspace compliance sweep:

```bash
node sdkwork-specs/tools/sweep-browser-build-workspace.mjs --workspace /path/to/sdkwork-space
```

### 17.2 Module Template Checklist

Each imported module `MUST` ship layout v3 under `deployments/webserver/`:

1. `server.common.toml` — identity, nginx/main/http globals, upstream skeleton.
2. `server.development.toml`, `server.test.toml`, `server.staging.toml`, `server.production.toml` — one file per lifecycle tier.
3. `server.standalone.toml` / `server.cloud.toml` — upstream targets per deployment profile.
4. `README.md` — generated environment summary (refreshed by align).
5. `app-roots.example.toml` — optional Adaptive Web dist catalog.

Minimal copy-paste templates: `examples/webserver/modules/README.md`.

### 17.3 Import Set Selection (`imports.d` Dual Configuration)

The webserver startup import plane
(`/etc/sdkwork/webserver/imports.d/`, loaded through
`[webserver] include = ["imports.d/import.conf"]`) ships **two** import
configuration sets so the startup mode can switch freely without touching
the module checkouts:

| File | Role |
| --- | --- |
| `import.conf.standalone` | Aggregator including each sibling module's `nginx.standalone.<environment>.conf` sidecar |
| `import.conf.cloud` | Aggregator including each sibling module's `nginx.cloud.<environment>.conf` sidecar |
| `import.conf` | **Active** aggregator — byte-for-byte copy of the selected set |
| `layout-imports.standalone.toml` / `layout-imports.cloud.toml` | Per-profile layout-v3 TOML import lists (modules without nginx sidecars) |
| `layout-imports.toml` | Active layout TOML — copy of the selected set |

Rules:

- Both sets are materialized on every entrypoint run; they are never
  partially regenerated. Only the active `import.conf` / `layout-imports.toml`
  copies are replaced on switch.
- The **default active set is `cloud`** (`SDKWORK_WEBSERVER_IMPORT_PROFILE`
  defaults to `cloud`). This is independent of the application build default
  (`standalone`): the build/packaging default governs how the webserver's own
  PC/H5 SPAs are produced and served, while the import default governs which
  sibling-module edge set the gateway data plane starts with.
- Operators switch the active set with
  `node scripts/webserver-import-profile.mjs <standalone|cloud>` (or the
  `pnpm import:switch:<profile>` alias), which atomically re-copies the two
  active files and reloads the gateway data plane.
- The active set `MUST` be consistent: both `import.conf` and
  `layout-imports.toml` must come from the same profile; mixing sets is a
  startup error.
- Standalone and cloud sidecars always coexist under every module's
  `deployments/webserver/` (`nginx.standalone.<env>.conf` +
  `nginx.cloud.<env>.conf`), so switching never requires rebuilding module
  configs.

## 16. Acceptance Checklist

- [ ] All **seven** layout v3 files exist under `deployments/webserver/`.
- [ ] `server.common.toml` has identity and globals only — **no** `[[http.server]]`.
- [ ] Each `server.<environment>.toml` declares `environment` and hosts for that tier only.
- [ ] `server.standalone.toml` / `server.cloud.toml` declare `profile` and upstream targets only.
- [ ] Every registered base domain appears in **each** environment file (W26).
- [ ] Production uses TLS (`443 ssl`) with `/healthz` and `/readyz` locations.
- [ ] `node sdkwork-specs/tools/webserver/audit-workspace.mjs` passes for the module.
- [ ] `deploy.yaml` `expose` domains match `effective(<profile>.<environment>)` `serverName` (W18).
- [ ] Certificate paths use `/etc/sdkwork/certs/letsencrypt/<cert-name>/` (W25).
- [ ] Sidecars `nginx.<profile>.<environment>.conf` exist and match effective renders (W16).
