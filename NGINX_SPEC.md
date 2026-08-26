# NGINX Compatibility And Public Edge Standard

- Version: 2.0
- Scope: nginx-compatible configuration dialect, Adaptive Web emission rules, TLS certificate paths, and migration handoff into `sdkwork-webserver`
- Related: `SDKWORK_WEBSERVER_SPEC.md`, `SDKWORK_DEPLOY_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `DEPLOYMENT_SPEC.md`, `ENVIRONMENT_SPEC.md`, `SECURITY_SPEC.md`, `OBSERVABILITY_SPEC.md`

## 0. Authority Transfer (Normative)

SDKWork **public reverse proxy** is owned exclusively by **`sdkwork-webserver`**
(`SDKWORK_WEBSERVER_SPEC.md`). That process is **nginx-configuration
compatible**: module `deployments/webserver/` TOML and rendered
`nginx.<profile>.<environment>.conf` sidecars are the dialect; the Rust data
plane (`serve-imports` / Adaptive Web) is the execution plane.

Rules:

- Operators `MUST NOT` install, enable, or run stock OpenResty/nginx,
  `/etc/nginx`, or host `sites-enabled` as the public edge for SDKWork
  domains (`api*.brand`, `im-*.brand`, `server-*.brand`, module hosts, …).
- Operators `MUST NOT` use Windows `netsh interface portproxy` (or equivalent)
  to forward public `:80`/`:443` to a host nginx listener (for example
  `:8088`). Development publishes Docker host `:80`/`:443` from
  `sdkwork-webserver`; test/production publish the documented import ports.
- `pnpm nginx:deploy`, `sudo nginx -t`, and `systemctl reload nginx` are
  **retired** as live public-edge procedures. New operator handoff `MUST`
  start, reload, and verify `sdkwork-webserver` (container or package) only.
- This file remains the dialect/Adaptive Web emission contract for rendered
  nginx-shaped sidecars and for one-time migration of legacy site files into
  `deployments/webserver/`. It is **not** authority to run stock nginx.

Local WSL retirement entrypoints (repository `sdkwork-webserver`):

```sh
sudo bash deployments/docker/scripts/uninstall-wsl-nginx.sh
# install-wsl-nginx.sh is retired and only invokes uninstall
```

Verify the public plane through the webserver publish ports:

```sh
curl --noproxy '*' -H 'Host: api-dev.birdcoder.cn' http://127.0.0.1/healthz
curl --noproxy '*' -H 'Host: api-dev.sdkwork.com' http://127.0.0.1/healthz
```

## 1. Compatibility Artifact Path Contract

Legacy / migration staging paths (not a live stock-nginx install root):

```text
target/nginx/sites-enabled/sdkwork/<domain>.conf
deployments/webserver/nginx.<profile>.<environment>.conf
```

`<domain>` is the complete public hostname and is always the file name stem
when a per-domain staging file is rendered. It is not a directory.

Examples (staging / documentation only):

```text
target/nginx/sites-enabled/sdkwork/api.sdkwork.com.conf
target/nginx/sites-enabled/sdkwork/api-dev.sdkwork.com.conf
target/nginx/sites-enabled/sdkwork/im-test.sdkwork.com.conf
```

The retired live path `/etc/nginx/sites-enabled/sdkwork/<domain>.conf`
`MUST NOT` be written by new automation as a production edge. Existing files
under `/etc/nginx` `MUST` be removed (`uninstall-wsl-nginx.sh` or equivalent)
before claiming public-edge readiness.

Environment hosts follow the registry in `APP_RUNTIME_TOPOLOGY_NAMING.md`
section 9: non-production hosts carry a suffix (`api-dev.sdkwork.com`,
`im-test.sdkwork.com`, `im-staging.sdkwork.com`), production carries none
(`api.sdkwork.com`, `im.sdkwork.com`). Prefix-style hosts such as
`staging-im.sdkwork.com` are retired and `MUST NOT` be deployed.

Multi-domain sites (`SDKWORK_DEPLOY_SPEC.md` section 7.2) bind the primary
registered host as the site `domain` and additional registered hosts of the
same profile environment as `aliases`. Generated `server_name` lists the
primary domain plus every alias. Aliases share the primary certificate and
upstream; each alias is never a separate live site process.

Rules:

- The site-family directory name in staging trees is `sdkwork` unless an
  operator explicitly chooses another safe directory name.
- The rendered file name must be the full domain plus `.conf` when emitting
  per-domain staging artifacts.
- Do not emit `domain/api.sdkwork.com.conf`, `api.conf`, or `sdkwork.com.conf`
  for an `api.sdkwork.com` virtual host.
- Generated config comments must include the domain, site family, upstream,
  and certificate root.
- `server_name` values are the expose `domain` plus every `aliases` entry,
  joined by spaces.

The canonical repository template (compatibility sample only) is:

```text
apps/sdkwork-cloudrouter/etc/nginx/NGINX_SAMPLE.conf
```

`API_SAMPLE.conf` is retained only as a compatibility sample. New
documentation and operator handoff must point to module
`deployments/webserver/` (`SDKWORK_WEBSERVER_SPEC.md`) as the live authority.

## 2. Upstream Contract

Platform API and module import planes proxy to the packaged gateway / module
upstream declared in webserver TOML. For the platform cloud gateway the
default in-process / sibling target is:

```text
gateway:3900   # Docker attach / compose DNS
# or host-mapped direct probe:
http://127.0.0.1:3910
```

Rules:

- The old sample upstream `http://127.0.0.1:8080` is obsolete.
- Declarative webserver TOML uses the reserved upstream name `gateway` for the
  primary API/application reverse-proxy target (`SDKWORK_WEBSERVER_SPEC.md`
  §8.1, W30). Rendered sidecars emit `upstream gateway { … }` once per
  effective process configuration; every virtual host references the same
  name. Module checkouts reuse the name `gateway`; isolation comes from
  separate webserver processes or composer deduplication when multiple
  modules share one container runtime.
- The edge owns the portal, vendor compatibility open-api gateway surfaces
  (for example OpenAI `/v1/*` declared per `API_SPEC.md` section 4.5.2),
  business open-api, backend/admin API, app API, OpenAPI documents,
  `/healthz`, and `/readyz` as declared by imported module configs.
- The proxy must preserve `Host`, real client IP, `X-Forwarded-*`, and
  websocket upgrade headers.
- Streaming and generation routes must not be broken by proxy buffering;
  generated configs set `proxy_buffering off` and use long read/send
  timeouts. The Rust data plane honors the equivalent bounded streaming
  defaults (`SDKWORK_WEBSERVER_SPEC.md` §13.4).
- `client_max_body_size` must not be lower than the Cloud Router upload body
  limits. The default generated value is `1100m`.

## 3. Certificate Path Contract

Certificates use a stable root and a certificate name directory:

```text
/etc/sdkwork/certs/letsencrypt/<cert-name>/fullchain.pem
/etc/sdkwork/certs/letsencrypt/<cert-name>/privkey.pem
/etc/sdkwork/certs/letsencrypt/<cert-name>/chain.pem
```

For `api.sdkwork.com` and `www.sdkwork.com`, the default certificate name is
`sdkwork.com`:

```text
/etc/sdkwork/certs/letsencrypt/sdkwork.com/fullchain.pem
/etc/sdkwork/certs/letsencrypt/sdkwork.com/privkey.pem
/etc/sdkwork/certs/letsencrypt/sdkwork.com/chain.pem
```

The retired bootstrap path `/opt/certs/letsencrypt/live/` `MUST NOT` appear in
new webserver TOML, rendered sidecars, deployment scripts, or documentation
examples. Use `/etc/sdkwork/certs/letsencrypt/` exclusively.

Non-production environment hosts (`api-dev.sdkwork.com`, `im-test.sdkwork.com`,
`im-staging.sdkwork.com`, and the application-role hosts from
`APP_RUNTIME_TOPOLOGY_NAMING.md` section 9) SHOULD be covered by a wildcard or
SAN certificate for `*.sdkwork.com` so one certificate serves every
environment host. When a wildcard is not available, each environment host uses
its own certificate directory named after the full hostname. Production hosts
keep the bare `sdkwork.com` certificate name.

Multi-base-domain sites: a site whose `aliases` span multiple registered base
domains (for example `router.sdkwork.com` + `router.birdcoder.com` +
`router.dtupay.com`) `MUST` use a certificate that covers every bound host —
either one SAN certificate listing all hosts or one wildcard/SAN certificate
per base domain (`*.sdkwork.com`, `*.birdcoder.com`, `*.dtupay.com`).

Rules:

- Operators may override the certificate name with `--cert-name` on render
  tools that still accept it for staging artifacts.
- Operators may override the certificate root with `--cert-root`.
- The certificate name is a directory name, not an arbitrary path.
- TLS configs should enable `TLSv1.2` and `TLSv1.3`; legacy `TLSv1.1`,
  `TLSv1`, and broad legacy ciphers are not allowed in new generated configs.

## 4. Generated Command Contract

Compatibility render / plan commands may still exist in application
workspaces for migration and review:

```sh
pnpm nginx:plan -- --domain api.sdkwork.com
pnpm nginx:render -- --domain api.sdkwork.com --output-root target/nginx
```

Command behavior:

- `nginx:plan` prints the canonical staging path, upstream, certificate
  files, and rendered config without writing files.
- `nginx:render` writes a local staging file under
  `target/nginx/sites-enabled/sdkwork/<domain>.conf` (or `--output` /
  `--output-root`).
- `nginx:deploy` to `/etc/nginx/...` is **retired**. Automation that still
  exposes the name `MUST` either refuse or write only to a non-live staging
  root and instruct operators to load the equivalent
  `deployments/webserver/` material into `sdkwork-webserver`.
- Multi-domain sites are rendered by invoking the commands once per host or
  via `deployctl plan/nginx render` (`SDKWORK_DEPLOY_SPEC.md` section 12)
  which emits one staging site file per expose item with shared
  `server_name` aliases.
- `--platform linux|windows|macos` lets operators produce a platform-specific
  plan from any workstation.

Live reload / verification is webserver-owned:

```sh
# container example (development owns host :80 / :443)
bash scripts/docker/deploy-docker-environment.sh development
curl --noproxy '*' -H 'Host: api-dev.sdkwork.com' http://127.0.0.1/healthz
curl --noproxy '*' -H 'Host: api-dev.birdcoder.cn' http://127.0.0.1/healthz
```

## 5. Ubuntu Release Build, Install, Start, And Public Edge

Build and install the application package, then publish domains through
`sdkwork-webserver` (package service or Docker compose). Do not install stock
nginx as part of the public edge.

```sh
sudo apt install ./cloudrouter-linux-x64-service-<version>.deb
# configure application TOML / secrets per DEPLOYMENT_SPEC.md
sudo systemctl start cloudrouter          # application / gateway process
# public domains: start sdkwork-webserver (imports.d loads module sidecars)
curl --noproxy '*' -H 'Host: api.sdkwork.com' http://127.0.0.1/healthz
```

## 6. Local Operator Workstations

On WSL/Ubuntu and Windows:

- Point hosts for registered domains at `127.0.0.1`.
- Publish `sdkwork-webserver` Docker `:80`/`:443` (development) or the
  documented test/production import ports.
- Clear stale Windows `portproxy` rules that forward `:80` to host nginx
  (`setup-windows-port-forwarding-admin.ps1` resets portproxy).
- Uninstall host nginx (`uninstall-wsl-nginx.sh`). Never reinstall for domain
  routing.

## 7. Adaptive Web PC / H5 Emission

Every independent module that exposes browser UI on a public `web` or
`web+api` origin `MUST` package both browser surfaces by default:

| Surface | Application root | Installed root (`binary-package`) |
| --- | --- | --- |
| PC | `apps/sdkwork-<application-code>-pc/` | `/usr/share/sdkwork/<runtimeCode>/web/pc/` |
| H5 | `apps/sdkwork-<application-code>-h5/` | `/usr/share/sdkwork/<runtimeCode>/web/h5/` |

### 7.1 Request Selection

Rendered sidecars and the webserver Adaptive Web data plane `MUST` select the
SPA surface with this contract:

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

### 7.2 Sidecar Emission (nginx-shaped)

Adaptive Web on rendered nginx-compatible sidecars `MUST` emit:

1. `http`-level `map` blocks that set `$sdkwork_<appId>_surface_final` to
   `pc` or `h5`.
2. A `location /` dispatch that jumps to a named location selected by that
   map (for example
   `try_files /__sdkwork_adaptive_dispatch__ @$sdkwork_<appId>_surface_final;`).
3. Sibling named locations `@pc` and `@h5` (and optionally `@static`) with
   fixed `root` under `/usr/share/sdkwork/<runtimeCode>/web/{pc,h5,static}/`
   plus SPA or ordinary static `try_files`.

The Rust Adaptive Web plane executes the same selection contract without
requiring a stock nginx process.

Forbidden:

- Variable `include` paths such as
  `include …/web.$sdkwork_<appId>_surface_final.conf;`
- A single `location /` with variable `root` that invents a missing SPA shell

Adaptive maps and `@pc` / `@h5` named locations `MUST NOT` be emitted in
`static-fallback` mode. When no static root is configured for the public
domain, plan validation `MUST` fail.

## 8. Acceptance Checklist

- [ ] No stock OpenResty/nginx process serves SDKWork public domains.
- [ ] `/etc/nginx` is absent or empty of SDKWork live site configs on operator
      hosts that claim public-edge readiness.
- [ ] Public `:80`/`:443` (or documented env import ports) are published by
      `sdkwork-webserver`.
- [ ] Module configs live under `deployments/webserver/` and validate with
      `SDKWORK_WEBSERVER_SPEC.md` tools.
- [ ] Upstream name `gateway` is used for the primary API/application target.
- [ ] TLS certificate paths use `/etc/sdkwork/certs/letsencrypt/<cert-name>/`.
- [ ] Configs preserve forwarded headers and streaming behavior.
- [ ] `/healthz` and `/readyz` pass through the public domain via webserver.
- [ ] Public Adaptive Web hosts use named-location PC/H5 dispatch (or plan-time
      `collapse-*` / `static-fallback`) per §7; variable `include` paths are absent.
