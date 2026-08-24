# NGINX Reverse Proxy Standard

- Version: 1.0
- Scope: SDKWork public reverse proxy deployment, generated nginx site files, TLS certificate paths, and release host handoff
- Related: `SDKWORK_WEBSERVER_SPEC.md`, `SDKWORK_DEPLOY_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `DEPLOYMENT_SPEC.md`, `ENVIRONMENT_SPEC.md`, `SECURITY_SPEC.md`, `OBSERVABILITY_SPEC.md`

SDKWork nginx deployment must keep public-domain routing reproducible across Linux servers and local operator workstations. Generated files are deployable artifacts, not handwritten one-off snippets.

The declarative source for the serving behavior behind these sites is the
per-module `deployments/webserver/server.toml` defined by
`SDKWORK_WEBSERVER_SPEC.md`: reverse proxy locations, virtual hosts, static
resource mounting, and certificate references are typed there and rendered
into the site files and upstreams below. Handwritten site files remain
allowed only as a one-time migration path into that declarative standard.

## 1. Site File Path Contract

The canonical Linux deployment path is:

```text
/etc/nginx/sites-enabled/sdkwork/<domain>.conf
```

`<domain>` is the complete public hostname and is always the file name stem. It is not a directory.

Examples:

```text
/etc/nginx/sites-enabled/sdkwork/api.sdkwork.com.conf
/etc/nginx/sites-enabled/sdkwork/www.sdkwork.com.conf
/etc/nginx/sites-enabled/sdkwork/api-dev.sdkwork.com.conf
/etc/nginx/sites-enabled/sdkwork/im-test.sdkwork.com.conf
/etc/nginx/sites-enabled/sdkwork/im-staging.sdkwork.com.conf
```

Environment hosts follow the registry in `APP_RUNTIME_TOPOLOGY_NAMING.md`
section 9: non-production hosts carry a suffix (`api-dev.sdkwork.com`,
`im-test.sdkwork.com`, `im-staging.sdkwork.com`), production carries none
(`api.sdkwork.com`, `im.sdkwork.com`). Each environment host gets its own site
file with the full hostname as the file name stem. Prefix-style hosts such as
`staging-im.sdkwork.com` are retired and `MUST NOT` be deployed.

Multi-domain sites (`SDKWORK_DEPLOY_SPEC.md` section 7.2) bind the primary
registered host as the site `domain` and additional registered hosts of the
same profile environment as `aliases`:

```text
/etc/nginx/sites-enabled/sdkwork/router.sdkwork.com.conf
```

The generated site file emits `server_name router.sdkwork.com
router.birdcoder.com router.dtupay.com;` (domain plus every alias) on both the
80→443 redirect server and the 443 server block. Aliases share the primary
site file, certificate, and upstream; each alias is never a separate site
file.

Rules:

- The site-family directory is `sdkwork` unless an operator explicitly chooses another safe directory name.
- The deployed nginx file name must be the full domain plus `.conf`.
- Do not deploy `domain/api.sdkwork.com.conf`, `api.conf`, or `sdkwork.com.conf` for an `api.sdkwork.com` virtual host.
- Generated config comments must include the domain, site family, canonical deploy path, upstream, and certificate root.
- `server_name` values are the expose `domain` plus every `aliases` entry,
  joined by spaces; a multi-base-domain site therefore serves every registered
  host from one site file.

The canonical repository template is:

```text
apps/sdkwork-cloudrouter/etc/nginx/NGINX_SAMPLE.conf
```

`API_SAMPLE.conf` is retained only as a compatibility sample for older references. New documentation and operator handoff must point to `etc/nginx/NGINX_SAMPLE.conf` or to generated full-domain examples under `etc/nginx/sdkwork/`.

## 2. Upstream Contract

Release deployments proxy to the packaged Rust edge server:

```text
http://127.0.0.1:3900
```

Rules:

- The old sample upstream `http://127.0.0.1:8080` is obsolete.
- Declarative webserver TOML uses the reserved upstream name `gateway` for the
  primary API/application reverse-proxy target (`SDKWORK_WEBSERVER_SPEC.md`
  §8.1, W30). Generated site files emit `upstream gateway { … }` once per nginx
  process; every virtual host in that process references the same name. Module
  checkouts reuse the name `gateway`; isolation comes from separate nginx
  processes (or composer deduplication when multiple modules share one
  container runtime).
- The edge server owns the portal, vendor compatibility open-api gateway surfaces (for example OpenAI `/v1/*` declared per `API_SPEC.md` section 4.5.2), business open-api, backend/admin API, app API, OpenAPI documents, `/healthz`, and `/readyz`.
- The proxy must preserve `Host`, real client IP, `X-Forwarded-*`, and websocket upgrade headers.
- Streaming and generation routes must not be broken by proxy buffering; generated configs set `proxy_buffering off` and use long read/send timeouts.
- `client_max_body_size` must not be lower than the Cloud Router upload body limits. The default generated value is `1100m`.

## 3. Certificate Path Contract

Certificates use a stable root and a certificate name directory:

```text
/etc/sdkwork/certs/letsencrypt/<cert-name>/fullchain.pem
/etc/sdkwork/certs/letsencrypt/<cert-name>/privkey.pem
/etc/sdkwork/certs/letsencrypt/<cert-name>/chain.pem
```

For `api.sdkwork.com` and `www.sdkwork.com`, the default certificate name is `sdkwork.com`:

```text
/etc/sdkwork/certs/letsencrypt/sdkwork.com/fullchain.pem
/etc/sdkwork/certs/letsencrypt/sdkwork.com/privkey.pem
/etc/sdkwork/certs/letsencrypt/sdkwork.com/chain.pem
```

The retired bootstrap path `/opt/certs/letsencrypt/live/` `MUST NOT` appear in
new nginx configs, webserver TOML, deployment scripts, or documentation
examples. Use `/etc/sdkwork/certs/letsencrypt/` exclusively.

Non-production environment hosts (`api-dev.sdkwork.com`, `im-test.sdkwork.com`,
`im-staging.sdkwork.com`, and the application-role hosts from
`APP_RUNTIME_TOPOLOGY_NAMING.md` section 9) SHOULD be covered by a wildcard or
SAN certificate for `*.sdkwork.com` so one certificate serves every
environment host. When a wildcard is not available, each environment host uses
its own certificate directory named after the full hostname; operators pass
`--cert-name` accordingly. Production hosts keep the bare `sdkwork.com`
certificate name.

Multi-base-domain sites: a site whose `aliases` span multiple registered base
domains (for example `router.sdkwork.com` + `router.birdcoder.com` +
`router.dtupay.com`) `MUST` use a certificate that covers every bound host —
either one SAN certificate listing all hosts or one wildcard/SAN certificate
per base domain (`*.sdkwork.com`, `*.birdcoder.com`, `*.dtupay.com`). The
certificate directory name follows the primary `domain` unless the operator
passes an explicit `--cert-name`.

Rules:

- Operators may override the certificate name with `--cert-name`.
- Operators may override the certificate root with `--cert-root`.
- The certificate name is a directory name, not an arbitrary path.
- TLS configs should enable `TLSv1.2` and `TLSv1.3`; legacy `TLSv1.1`, `TLSv1`, and broad legacy ciphers are not allowed in new generated configs.

## 4. Generated Command Contract

The Cloud Router workspace exposes these pnpm commands:

```sh
pnpm nginx:plan -- --domain api.sdkwork.com
pnpm nginx:render -- --domain api.sdkwork.com --output-root target/nginx
sudo pnpm nginx:deploy -- --domain api.sdkwork.com --cert-name sdkwork.com
```

Command behavior:

- `nginx:plan` prints the canonical path, output path, upstream, certificate files, reload commands, and rendered config without writing files.
- `nginx:render` writes a local staging file. On Windows and macOS, the default staging path is `target/nginx/sites-enabled/sdkwork/<domain>.conf`.
- `nginx:deploy` writes the selected output file. On Linux with no `--output` or `--output-root`, it writes the canonical `/etc/nginx/sites-enabled/sdkwork/<domain>.conf` path.
- `--output <path>` writes one exact file.
- `--output-root <path>` writes `sites-enabled/sdkwork/<domain>.conf` under the given local root.
- Multi-domain sites are rendered by invoking the commands once per host:
  plan/render/deploy each registered host (`router.sdkwork.com`,
  `router.birdcoder.com`, `router.dtupay.com`) or rely on the `expose` list of
  `deployctl plan/nginx render` (`SDKWORK_DEPLOY_SPEC.md` section 12) which
  emits one site file per expose item with shared `server_name` aliases.
- `--platform linux|windows|macos` lets operators produce a platform-specific plan from any workstation.

After deploy, operators validate and reload nginx explicitly:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

## 5. Ubuntu Release Build, Install, Start, And Proxy

Build from a source checkout:

```sh
pnpm release:env:write -- --check
pnpm release:env:write -- --force
pnpm build
pnpm install:package:build -- --package-id linux-x64-service
```

Install and start on Ubuntu:

```sh
sudo apt install ./cloudrouter-linux-x64-server-0.3.0.deb
sudo editor /etc/sdkwork/router/cloudrouter.toml
sudo editor /etc/sdkwork/database/database.secret
sudo systemctl start cloudrouter
curl http://127.0.0.1:3900/healthz
curl http://127.0.0.1:3900/readyz
```

Deploy nginx for an API domain:

```sh
sudo pnpm nginx:deploy -- --domain api.sdkwork.com --cert-name sdkwork.com
sudo nginx -t
sudo systemctl reload nginx
curl https://api.sdkwork.com/healthz
curl https://api.sdkwork.com/readyz
```

Deploy nginx for a web domain:

```sh
sudo pnpm nginx:deploy -- --domain www.sdkwork.com --site-type web --cert-name sdkwork.com
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Cross-Platform Operator Flow

Linux production host:

```sh
sudo pnpm nginx:deploy -- --domain api.sdkwork.com --cert-name sdkwork.com
sudo nginx -t
sudo systemctl reload nginx
```

Windows workstation staging:

```powershell
pnpm nginx:render -- --platform windows --domain api.sdkwork.com --output-root target/nginx
```

macOS workstation staging:

```sh
pnpm nginx:render -- --platform macos --domain api.sdkwork.com --output-root target/nginx
```

Windows or macOS hosts with a local nginx install must pass an explicit `--output-root` or `--output` matching their nginx config layout. The rendered nginx content still uses Linux-style certificate paths when that config will be copied to a Linux host.

## 7. Adaptive Web (PC / H5 Device Selection)

Authority: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1,
`SDKWORK_DEPLOY_SPEC.md` §8 / §8.1, `SDKWORK_WEBSERVER_SPEC.md` §11.3.

Applies to module public origins with `expose.mode` `web` or `web+api` that
serve browser SPA roots from stock nginx. It does **not** apply to
`expose.mode: api` edges (including the `sdkwork-webserver` product public
ingress): those origins reverse-proxy all traffic to the owning process and
leave Adaptive Web / static delivery to that process.

Every independent module that exposes browser UI on a public `web` or
`web+api` origin `MUST` package both browser surfaces by default:

| Surface | Application root | Installed root (`binary-package`) |
| --- | --- | --- |
| PC | `apps/sdkwork-<application-code>-pc/` | `/usr/share/sdkwork/<runtimeCode>/web/pc/` |
| H5 | `apps/sdkwork-<application-code>-h5/` | `/usr/share/sdkwork/<runtimeCode>/web/h5/` |

### 7.1 Request Selection

Stock nginx site files and module `deployments/webserver/` renders `MUST`
select the SPA surface with this contract:

| Client class | Preferred surface | If preferred is not packaged |
| --- | --- | --- |
| Mobile (`Sec-CH-UA-Mobile: ?1` or mobile User-Agent) | H5 | serve PC (`collapse-pc`) |
| Desktop / other | PC | serve H5 (`collapse-h5`) |
| Tablet | PC (or H5 when `overrides.web.tablet: h5`) | other available surface |
| Neither PC nor H5 packaged | — | `static-fallback` |

Detection order (shared with the website data plane):

1. Deploy / delivery device-override rules
2. `Sec-CH-UA-Mobile: ?1`
3. Tablet User-Agent (`iPad`) → PC (or H5 when `overrides.web.tablet: h5`)
4. Default mobile User-Agent regex from `SDKWORK_DEPLOY_SPEC.md` §8
5. Default desktop → PC

`iPad` defaults to PC unless tablet override selects H5. Emit the `iPad` map
entry **before** the mobile regex so UA strings that contain both `iPad` and
`Mobile` stay on the tablet surface.

### 7.2 Stock nginx Emission

Adaptive Web on stock nginx `MUST` emit:

1. `http`-level `map` blocks that set `$sdkwork_<appId>_surface_final` to
   `pc` or `h5`.
2. A `location /` dispatch that jumps to a named location selected by that
   map (for example
   `try_files /__sdkwork_adaptive_dispatch__ @$sdkwork_<appId>_surface_final;`).
3. Sibling named locations `@pc` and `@h5` (and optionally `@static`) with
   fixed `root` under `/usr/share/sdkwork/<runtimeCode>/web/{pc,h5,static}/`
   plus SPA or ordinary static `try_files`.

Forbidden:

- Variable `include` paths such as
  `include …/web.$sdkwork_<appId>_surface_final.conf;`
- A single `location /` with variable `root` that invents a missing SPA shell

Plan folding (`collapse-pc` / `collapse-h5` / `static-fallback`) is applied by
`sdkwork-specs/tools/webserver/adaptive-web.mjs` and
`sdkwork-specs/tools/deploy/nginx-render.mjs` before site files or
`nginx.<profile>.conf` sidecars are written. Reference module wiring:
`sdkwork-specs/examples/webserver/adaptive-snippets/` (for modules with
`expose.mode` `web` / `web+api`). The `sdkwork-webserver` product edge is
`expose.mode: api` and must not include those snippets (validator W23).

### 7.3 Static Fallback

When neither PC nor H5 is packaged, nginx `MUST` serve the configured static
resource root (`overrides.web.staticRoot`,
`sdkwork-specs/examples/webserver/adaptive-snippets/web.static.conf`, or the
`[[http.server.location]]` `match = "/"` `root`) with ordinary file serving:

```nginx
root /usr/share/sdkwork/<runtimeCode>/web/static;
index index.html;
try_files $uri $uri/ =404;
```

Adaptive maps and `@pc` / `@h5` named locations `MUST NOT` be emitted in
`static-fallback` mode. When no static root is configured for the public
domain, plan validation `MUST` fail.

## 8. Acceptance Checklist

- [ ] The deployed file path is `/etc/nginx/sites-enabled/sdkwork/<domain>.conf`.
- [ ] The file name is the complete public domain plus `.conf`.
- [ ] The upstream is `http://127.0.0.1:3900`.
- [ ] TLS certificate paths use `/etc/sdkwork/certs/letsencrypt/<cert-name>/`.
- [ ] Configs preserve forwarded headers and streaming behavior.
- [ ] `nginx -t` passes before reload.
- [ ] `/healthz` and `/readyz` pass through the public domain after reload.
- [ ] Public Adaptive Web hosts use named-location PC/H5 dispatch (or plan-time
      `collapse-*` / `static-fallback`) per §7; variable `include` paths are absent.
