# SDKWork Application Deploy Standard

- Version: 1.1
- Scope: per-application deployment manifest, install layouts, adaptive Web, Nginx site generation, client package release orchestration
- Related: `SDKWORK_WORKSPACE_SPEC.md`, `NAMING_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `APPLICATION_DEPLOY_LAYOUT_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `DEPLOYMENT_SPEC.md`, `NGINX_SPEC.md`, `SDKWORK_WEBSERVER_SPEC.md`, `APP_MANIFEST_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `RELEASE_SPEC.md`, `CONFIG_SPEC.md`, `API_SPEC.md`, `PNPM_SCRIPT_SPEC.md`

This standard defines the single deployment contract for each SDKWork application repository. Deploy tools and SDKWork Deploy Server consume `deployments/deploy.yaml` together with existing app, topology, workflow, and API contracts.

## 1. Goals

- One file per application: `deployments/deploy.yaml`.
- Convention over configuration: paths, API prefixes, and Nginx filenames are inferred.
- Two production install layouts: source-tree and binary-package.
- Adaptive Web on one domain: desktop browsers use `-pc`; mobile browsers use `-h5`; missing surfaces fall back in plan phase.
- No `routes` section: HTTP API prefixes come from `apiSurfaces` and OpenAPI; WebSocket paths come from topology.
- Nginx is the public data plane: one domain maps to one `{domain}.conf` under `NGINX_SPEC.md`.

## 2. Standard Files

Each deployable application repository MUST contain:

```text
<repository-root>/
  sdkwork.app.config.json
  specs/topology.spec.json
  sdkwork.workflow.json
  deployments/
    deploy.yaml
```

Optional:

```text
deployments/templates/
deployments/nginx/
deployments/webserver/       # layout v3 per SDKWORK_WEBSERVER_SPEC.md
```

`deployments/webserver/` holds the module's declarative web server
configuration (`SDKWORK_WEBSERVER_SPEC.md` layout v3:
`server.common.toml` + `server.<environment>.toml` + `server.<profile>.toml`):
it owns reverse proxy locations, virtual hosts, static resource mounting,
and certificates. The retired single-file `server.toml` and layout v2
(all hosts in `server.common.toml` only) MUST NOT exist.
`expose` domains in `deploy.yaml` `SHOULD` be covered by `[[http.server]]`
`serverName` entries there; the check is enforced by
`tools/check-webserver-toml-standard.mjs`.

Workspace root `sdkwork-space/` MUST NOT define a workspace-wide deployment manifest.

## 3. Identity

Deploy resolves three identifiers:

| Field | Example (IM) | Authority | Use |
| --- | --- | --- | --- |
| `appId` | `sdkwork-im` | repository directory name and `topology.spec.json` `appId` | source-tree paths, surface directory names |
| `runtimeCode` | `im` | `topology.applicationCode` | `/etc/sdkwork/`, `/usr/lib/sdkwork/`, `/usr/share/sdkwork/` |
| `app.key` | `chat` | `sdkwork.app.config.json` | app.key / IAM only; MUST NOT be used for deploy paths |

Rules:

- `appId` MUST NOT be truncated.
- `appId`, repository directory name, and `topology.appId` MUST match.
- `runtimeCode` MUST equal the canonical lowercase
  `topology.applicationCode` from `RUNTIME_DIRECTORY_SPEC.md`; it MUST NOT be
  inferred from a database field or database env key.
- Deploy MUST NOT derive `runtimeCode` from `app.key`.

## 4. Install Layouts

`install.layout` selects production filesystem semantics.

| Layout | Meaning | Web prod root (PC) | Web prod root (H5) | Binary prod path |
| --- | --- | --- | --- | --- |
| `source-tree` | Development/diagnostic source install; production requires a dated governance exception | `/usr/share/sdkwork-space/{appId}/apps/{appId}-pc/dist/` | `/usr/share/sdkwork-space/{appId}/apps/{appId}-h5/dist/` | `/usr/share/sdkwork-space/{appId}/target/release/{binary}` |
| `binary-package` | Traditional package install per `RUNTIME_DIRECTORY_SPEC` | `/usr/share/sdkwork/{runtimeCode}/web/pc/` | `/usr/share/sdkwork/{runtimeCode}/web/h5/` | `/usr/lib/sdkwork/{runtimeCode}/{binary}` |

Development always uses `{repoRoot}` with the same relative paths as the repository.

Config, data, logs for both layouts (`APPLICATION_DEPLOY_LAYOUT_SPEC.md` section 3):

```text
/etc/sdkwork/{runtimeCode}/
/var/lib/sdkwork/{runtimeCode}/
/var/log/sdkwork/{runtimeCode}/
/run/sdkwork/{runtimeCode}/
```

Default inference when `install.layout` is omitted:

- `deployctl plan --dev`: no host install; use `{repoRoot}`.
- workflow targets with `deb` or `rpm`: `binary-package`.
- workflow targets with repository-structure archives: `source-tree`.
- otherwise: `binary-package`.

## 5. Surface Paths

Surface root:

```text
apps/{appId}-{client-arch}/
```

Web dist:

```text
apps/{appId}-{client-arch}/dist/
```

Mini program WeChat output:

```text
apps/{appId}-mini-program/dist/weixin/
```

## 6. Manifest Contract

Format: YAML. New manifests use
`schemas/sdkwork.deploy.schema.v2.json` and `version: 2`. Version 1 remains
readable only during `MIG-2026-0720`.

### 6.1 Simple mode

```yaml
version: 2
profile: cloud.production

deployment:
  deploymentProfile: cloud
  environment: production
  deliveryKind: container-image
  deploymentDriver: kubernetes
  managementModel: sdkwork-managed
  tenancyModel: multi-tenant
  isolationModel: shared
  networkExposure: public
  rolloutStrategy: rolling
  availabilityMode: high-availability

install:
  layout: binary-package

expose: []
packages: []
overrides: {}
```

### 6.2 Multi-profile mode

When `profiles` exists, root-level `profile`, `install`, `expose`, `packages`, and `overrides` MUST be absent. Use `defaultProfile`.

```yaml
version: 2
defaultProfile: cloud.production

profiles:
  standalone.production:
    deployment:
      deploymentProfile: standalone
      environment: production
      deliveryKind: host-package
      deploymentDriver: host-service
      managementModel: customer-managed
      tenancyModel: single-tenant
      isolationModel: dedicated
      networkExposure: private
      rolloutStrategy: recreate
      availabilityMode: single-instance
    install:
      layout: binary-package
    expose: []
    packages: []
    overrides: {}
  cloud.production:
    deployment:
      deploymentProfile: cloud
      environment: production
      deliveryKind: container-image
      deploymentDriver: kubernetes
      managementModel: sdkwork-managed
      tenancyModel: multi-tenant
      isolationModel: shared
      networkExposure: public
      rolloutStrategy: rolling
      availabilityMode: high-availability
    install:
      layout: binary-package
    expose: []
    packages: []
    overrides: {}
```

Dual-profile applications `MUST` use multi-profile mode and declare both
`standalone.production` and `cloud.production`. `defaultProfile` is permitted
for read-only discovery and operator UI selection; apply and rollback commands
must still name the profile and lifecycle environment explicitly.

Development profiles remain source config under `etc/` and are not deploy
targets. `standalone.development` and `cloud.development` must not be selected
by a production apply command.

Version 2 profile ids `MUST` match their structured
`deployment.deploymentProfile` and `deployment.environment`. Production
profiles `MUST` use `binary-package`; `source-tree` requires an explicit dated
exception reference and is never the default.

Delivery and driver combinations are constrained:

| `deliveryKind` | Allowed `deploymentDriver` |
| --- | --- |
| `host-package` | `host-service`, `nginx` |
| `container-image` | `container-runtime`, `kubernetes` |
| `static-web` | `static-host`, `nginx` |
| `platform-package` | `application-store`, `mini-program-platform` |
| `configuration-bundle` | `host-service`, `container-runtime`, `kubernetes`, `nginx` |

Cloud deployments must not use `networkExposure = offline`. Offline
deployments must not declare public `expose` domains. `multi-region` requires
an infrastructure provider, provider region, and at least two availability
zones. `canary` requires `container-runtime`, `kubernetes`, or `static-host`;
`platform-staged` requires an application-store or mini-program-platform
driver. Schema and executable validation enforce these combinations.

## 7. expose

Each item declares one public domain and one Nginx site file.

### 7.1 Nginx site file

For `domain: im.sdkwork.com`:

```text
/etc/nginx/sites-enabled/sdkwork/im.sdkwork.com.conf
```

Staging default:

```text
target/nginx/sites-enabled/sdkwork/im.sdkwork.com.conf
```

TLS default:

```text
/etc/sdkwork/certs/letsencrypt/{certName}/fullchain.pem
/etc/sdkwork/certs/letsencrypt/{certName}/privkey.pem
```

### 7.2 Fields

```yaml
expose:
  - domain: im.sdkwork.com
    tls: sdkwork.com
    mode: web+api
    web: adaptive
    aliases: []
    apiPathStyle: full-prefix
```

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `domain` | yes | — | full hostname; conf file stem; must be an element of the profile-environment host set |
| `tls` | no | prod managed; dev `off` | certificate directory name |
| `mode` | no | `web+api` | `web`, `api`, `web+api` |
| `web` | when Web served | — | `adaptive`, `pc`, `h5`, `[pc, h5]` |
| `aliases` | no | `[]` | extra `server_name` values; registered hosts bound to the same site |
| `apiPathStyle` | no | `full-prefix` | only for `mode: api`; `strip-prefix` optional |

Multi-domain binding modes:

- **One site, many hosts**: bind the primary registered host as `domain` and
  every additional registered host of the same profile environment as
  `aliases`. Aliases share the primary site file, TLS certificate, upstream,
  and routing; nginx emits one `server_name` per alias
  (`NGINX_SPEC.md` section 1).
- **One host per site**: declare one `expose` item per host; each item gets
  its own site file and certificate directory.

Constraints:

- `mode: api` MUST NOT include `web`. Edge nginx for `mode: api` `MUST`
  reverse-proxy public traffic to the owning process upstream and `MUST NOT`
  emit Adaptive Web `@pc` / `@h5` file roots or ordinary module SPA static
  roots for that domain. The `sdkwork-webserver` module's public-ingress
  expose items `MUST` use `mode: api`: Adaptive Web selection, website
  delivery, reverse proxy, and static file serving for that product are owned
  by the `sdkwork-webserver` process (see §8 exception below).
- `mode: web` MUST NOT expose API locations unless overridden in `overrides.nginx`.
- production MUST NOT use `tls: off` unless `overrides.allowInsecureTls: true`.
- `domain` MUST be an element of the host set registered for the profile
  environment in `topology.spec.json` `cloudPublicHosts` (including its
  `environments` overrides and the `httpHosts` multi-host arrays) per
  `APP_RUNTIME_TOPOLOGY_NAMING.md` section 9. Non-production profiles expose
  suffix hosts (`im-test.sdkwork.com`, `router-staging.birdcoder.com`);
  production exposes the bare role host (`im.sdkwork.com`, `router.dtupay.com`).
  Prefix-style hosts (`staging-im.sdkwork.com`) and production-suffixed hosts
  (`im-prod.sdkwork.com`) fail validation. Customer-managed base domains are
  allowed when release metadata records the substitution.
- Every `aliases` entry MUST be a bare hostname (no scheme, port, or path) and
  MUST be an element of the same profile-environment host set (or a recorded
  customer base domain). Aliases MUST NOT be registered hosts of a different
  environment (for example `im-test.sdkwork.com` as a production alias).
- When `domain` + `aliases` cover the full registered host set of the profile
  environment, the site serves every host; a registered host that is neither
  `domain` nor an alias of any expose item SHOULD be declared in a separate
  expose item or dropped from the registry.

There is NO `routes` section.

## 8. Adaptive Web

Modules with public `web` / `web+api` domains `MUST` ship PC+H5 roots and
install them under `<share>/web/{pc,h5}/` with source builds in
`dist/{dev,test,staging,prod}/` (`APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1,
`RUNTIME_DIRECTORY_SPEC.md` §4.1.1).

**Exception — `sdkwork-webserver`:** `expose.mode: api` → edge nginx proxy-only;
process `[app_roots]` owns Adaptive Web (`SDKWORK_WEBSERVER_SPEC.md` §13.6).
§8.1 nginx emission still applies to other modules with `web` / `web+api`.

Normative request selection (same for production nginx and app-config data
planes that serve module Adaptive Web):

| Client class | Preferred surface | If preferred surface is not packaged / not ready |
| --- | --- | --- |
| Mobile (`Sec-CH-UA-Mobile: ?1` or mobile UA) | H5 | PC |
| Desktop / other | PC | H5 |
| Tablet | PC (or H5 when `overrides.web.tablet: h5`) | other available surface |
| Neither PC nor H5 packaged | — | `static-fallback` (ordinary static root; see below) |

`web: adaptive` or `web: [pc, h5]` selects PC/H5 by request headers on path `/`.

The development-side mirror of this contract is `APP_RUNTIME_TOPOLOGY_SPEC.md`
§8.2 (Adaptive Browser Delivery): `@sdkwork/app-topology` serves the same
detection order below for `dev-server-proxy` browser deliveries declared in
`topology.spec.json`. The detection contract is shared; production and dev
must not diverge.

Detection order:

1. `overrides.web.rules`
2. `Sec-CH-UA-Mobile: ?1`
3. tablet User-Agent (`iPad`) → `overrides.web.tablet` (`pc` default, or `h5`)
4. default mobile User-Agent regex
5. default desktop → `pc`

Default mobile User-Agent regex:

```text
(Mobile|Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini|MicroMessenger|HuaweiBrowser|HarmonyOS|UCBrowser|Quark)
```

iPad defaults to `pc` unless `overrides.web.tablet: h5`. Stock nginx maps
`MUST` match `iPad` **before** the mobile regex because many iPad User-Agents
also contain `Mobile`.

Preferred surface and cross-collapse:

| Client class | Preferred surface | If preferred missing |
| --- | --- | --- |
| Mobile (`Sec-CH-UA-Mobile: ?1` or mobile UA) | `h5` | serve `pc` |
| Desktop / other | `pc` | serve `h5` |
| Tablet | `pc` (or `h5` when `overrides.web.tablet: h5`) | other available surface |

Plan folding (repository / install state at plan time):

| Repository / install state | web mode | Behavior |
| --- | --- | --- |
| pc and h5 exist | `adaptive` | UA / Client Hint selects preferred surface via named-location dispatch (§8.1) |
| pc only | `collapse-pc` | all clients receive `pc` (warn: h5 missing) |
| h5 only | `collapse-h5` | all clients receive `h5` (warn: pc missing) |
| neither | `static-fallback` | serve the configured nginx / `server.toml` static resource root (`overrides.web.staticRoot`, or the module `[[http.server.location]]` `match = "/"` static `root` when rendering from `SDKWORK_WEBSERVER_SPEC.md`); SPA adaptive snippets `MUST NOT` be emitted |

`static-fallback` `MUST` use ordinary static file serving from the module
nginx / `server.toml` configuration (typically
`deployments/webserver/snippets/web.static.conf` →
`/usr/share/sdkwork/<runtimeCode>/web/static` with
`try_files $uri $uri/ =404`, or `overrides.web.staticRoot` / the location
`root` declared for `match = "/"`). It `MUST NOT` pretend a missing PC or H5
SPA shell exists. When no static root is configured for the domain, plan
validation `MUST` fail.

Plan-time folding (`collapse-pc` / `collapse-h5` / `static-fallback`) applies
when packaging or install inventory is incomplete. Request-time selection
still prefers H5 on mobile and PC on desktop whenever both surfaces exist.

### 8.1 Stock nginx adaptive emission (required)

Adaptive Web on stock nginx `MUST` be emitted as:

1. `http`-level `map` blocks that set `$sdkwork_<appId>_surface_final` to
   `pc` or `h5` (Client-Hint / UA detection order above).
2. A `location /` dispatch that jumps to a **named location** selected by that
   map (for example
   `try_files /__sdkwork_adaptive_dispatch__ @$sdkwork_<appId>_surface_final;`).
3. Sibling named locations `@pc` and `@h5` (and optionally `@static`) that each
   own a fixed `root` under `/usr/share/sdkwork/<runtimeCode>/web/{pc,h5,static}/`
   plus SPA or static `try_files`.

Forbidden on stock nginx:

- Variable `include` paths such as
  `include …/web.$sdkwork_<appId>_surface_final.conf;`
  (nginx resolves `include` at configuration load time and does not expand
  variables in include paths).
- A single `location /` with variable `root` plus SPA `try_files` that invents
  a missing PC/H5 shell.

Plan folding still applies: `collapse-pc` / `collapse-h5` omit the unused named
location and map all clients to the remaining surface; `static-fallback` omits
adaptive maps and emits ordinary static `root` + `try_files … =404` (or the
module `deployments/webserver/` static location) instead of `@pc` / `@h5`.

Deployctl / `tools/deploy/nginx-render.mjs` and module
`deployments/webserver/` renders `MUST` follow this emission contract so
generated site files and `nginx.<profile>.conf` sidecars load on stock nginx.

Surfaces referenced by `expose.web` are built and deployed automatically and
`MUST NOT` appear in `packages`.

## 9. API and WebSocket Inference

API location prefixes are inferred in this order:

1. `sdkwork.app.config.json` `apiSurfaces[].apiPrefix`
2. `apis/**` OpenAPI path prefixes

WebSocket path:

- `topology.surfaces.application.public-ingress.websocketPath`
- emitted only on domains mapped to `application.public-ingress`

### 9.1 Per-domain API surfaces

When `topology.cloudPublicHosts` maps a public hostname to a topology surface, Nginx MUST filter API locations to that surface:

| `cloudPublicHosts` surface | Allowed `apiSurfaces[].kind` |
| --- | --- |
| `application.public-ingress` | `app-api`, `backend-api`, `open-api`, `unknown` |
| `application.app-http` | `app-api` |
| `application.backend-http` | `backend-api` |
| `operations.control-ingress` | `backend-api` |
| `platform.api-gateway` | `open-api`, `platform-api`, `unknown` |

When no mapping exists for a domain, tools default to `application.public-ingress`.

### 9.2 Upstream resolution

Upstream bind resolution order for each topology surface:

1. `overrides.proxy.upstreams[surfaceId]`
2. profile env value for `topology.surfaces[surfaceId].bindEnv`
3. `overrides.proxy.bind` (public ingress only)
4. `topology.defaults.gatewayBind`

Rules:

- Nginx MUST proxy to resolved upstream listen addresses, not filesystem binary paths.
- Bind values such as `0.0.0.0:3900` MUST normalize to `http://127.0.0.1:3900` for `proxy_pass`.
- Tools MUST NOT emit placeholder upstreams such as `127.0.0.1:8080`.

Health locations SHOULD be generated when upstream exposes `/healthz` and `/readyz`.

## 10. packages

Declares client artifacts not hosted by `expose.web`.

```yaml
packages:
  - flutter-mobile
  - harmony-mobile
  - mini-program-weixin
  - desktop-windows
  - desktop-macos
```

Allowed names:

| Name | Repository focus |
| --- | --- |
| `flutter-mobile` | `apps/{appId}-flutter-mobile/` |
| `harmony-mobile` | `apps/{appId}-harmony-mobile/` |
| `android-mobile` | `apps/{appId}-android-mobile/` |
| `ios-mobile` | `apps/{appId}-ios-mobile/` |
| `mini-program-weixin` | `apps/{appId}-mini-program/dist/weixin/` |
| `mini-program-alipay` | `apps/{appId}-mini-program/dist/alipay/` |
| `desktop-windows` | workflow desktop target |
| `desktop-macos` | workflow desktop target |
| `desktop-linux` | workflow desktop target |

`pc` and `h5` MUST NOT appear in `packages`.

Package IDs, signing, and workflow targets come from `sdkwork.app.config.json` and `sdkwork.workflow.json`.

## 11. overrides

Optional exceptions only:

```yaml
overrides:
  allowInsecureTls: false
  install:
    layout: source-tree
  proxy:
    bind: 127.0.0.1:18079
    upstreams:
      application: http://127.0.0.1:18079
      platform: http://127.0.0.1:3900
  web:
    tablet: pc
    staticRoot: /usr/share/sdkwork/webserver/web/static
    rules:
      - userAgentRegex: iPad
        surface: h5
    cdn:
      enabled: false
  nginx:
    siteFile: /etc/nginx/sites-enabled/sdkwork/im.sdkwork.com.conf
    clientMaxBodySize: 1100m
    snippets: []
  packages:
    flutter-mobile:
      skip: true
```

Secrets MUST use `secret://` references. Plaintext secrets in deploy.yaml are forbidden.

## 12. Tooling

Repositories SHOULD expose:

```text
deploy:validate
deploy:plan
nginx:render
```

Repositories that own both deployment architectures also expose
`deploy:plan:standalone`, `deploy:apply:standalone`,
`deploy:validate:standalone`, `deploy:rollback:standalone`, and matching
`:cloud` variants according to `PNPM_SCRIPT_SPEC.md`. Applying or rolling back
requires an explicit environment and immutable artifact identity.

Implementation:

```text
node ../sdkwork-specs/tools/deployctl.mjs validate --root .
node ../sdkwork-specs/tools/deployctl.mjs plan --root . [--dev]
node ../sdkwork-specs/tools/deployctl.mjs apply --root . --profile <profile> --environment <environment> --artifact-id <id> --artifact-digest sha256:<digest> --artifact-evidence <evidence.json> [--artifact-root <download-or-package-root>] --rollback-target <id-or-digest-or-forward-fix:boundary> --approval-ref <protected-environment-or-change-record> [--domain <domain>]
node ../sdkwork-specs/tools/deployctl.mjs rollback --root . --profile <profile> --environment <environment> --artifact-id <failed-id> --artifact-digest sha256:<failed-digest> --artifact-evidence <evidence.json> [--artifact-root <download-or-package-root>] --rollback-target <previous-id-or-digest> --approval-ref <protected-environment-or-change-record> [--domain <domain>]
node ../sdkwork-specs/tools/deployctl.mjs nginx render --root . --domain <domain>
node ../sdkwork-specs/tools/deployctl.mjs nginx apply --root . --profile <profile> --environment <environment> --artifact-id <id> --artifact-digest sha256:<digest> --artifact-evidence <evidence.json> --rollback-target <id-or-digest-or-forward-fix:boundary> --approval-ref <protected-environment-or-change-record> --domain <domain>
node ../sdkwork-specs/tools/deployctl.mjs nginx rollback --root . --profile <profile> --environment <environment> --artifact-id <failed-id> --artifact-digest sha256:<failed-digest> --artifact-evidence <evidence.json> --rollback-target <previous-id-or-digest> --approval-ref <protected-environment-or-change-record> --domain <domain>
node ../sdkwork-specs/tools/deployctl.mjs init --root .
```

Production nginx reload is gated by `SDKWORK_DEPLOY_NGINX_RELOAD=true` and uses `SDKWORK_DEPLOY_NGINX_RELOAD_CMD` (default `nginx -s reload`).

Top-level `apply` and `rollback` dispatch by the typed
`deployment.deploymentDriver`. The built-in deployctl executor currently owns
`nginx`. Kubernetes, container-runtime, host-service, static-host,
application-store, and mini-program-platform side effects run through approved
`sdkwork-github-workflow` lifecycle adapters until a reviewed deployctl executor
is registered. Deployctl `MUST` fail closed for an unregistered driver and
`MUST NOT` reinterpret it as nginx.

Side-effecting apply and rollback commands `MUST NOT` use `defaultProfile`.
They require explicit profile, lifecycle environment, immutable artifact id and
digest, an artifact evidence document, approval context, and rollback target or
approved forward-fix boundary. The evidence document must bind artifact id,
artifact path, digest computed from the packaged bytes, version, source commit,
package id, selected profile support, SBOM,
provenance, and signature references; see
`schemas/sdkwork.artifact-evidence.schema.v1.json`.
`--artifact-root` defaults to the application root and selects the root against
which `artifactPath` is resolved after a workflow artifact download.
The selected environment must equal the environment segment in the profile id.
Nginx apply stores the replaced configuration in a rollback-target-keyed backup
with selection evidence. Rollback validates that backup, preserves the failed
current config, restores the selected backup, runs
`nginx -t`, reloads only when approved, and restores the failed config if test
or reload fails.
The first installation, where no previous site exists, uses an explicitly
approved `forward-fix:<boundary>` value. A rollback operation rejects that
value because it must name a concrete stored target.

### 12.1 Deploy Server orchestration

Deploy API Server publishes nginx through site `runtimeConfig.sdkworkDeploy` bindings:

```json
{
  "sdkworkDeploy": {
    "appRoot": "/usr/share/sdkwork-space/sdkwork-im",
    "domain": "im.sdkwork.com",
    "profileId": "cloud.production",
    "siteFile": "/etc/nginx/sites-enabled/sdkwork/im.sdkwork.com.conf"
  }
}
```

Rules:

- `appRoot` MUST contain `deployments/deploy.yaml`.
- `domain` MAY be omitted when the site primary domain is registered in Deploy DB.
- `POST /backend/v3/api/nginx/configs/{configId}/deploy` MUST validate config content, then:
  1. when orchestration is enabled (default), run `deployctl nginx apply` with explicit root, profile, environment, artifact id/digest, rollback target, and domain from the approved deployment record
  2. otherwise write validated DB content to `{siteFile}` with backup and optional reload
- Orchestration is disabled only when `SDKWORK_DEPLOY_ORCHESTRATE_NGINX=false`.
- `deployctl` path resolves from `SDKWORK_DEPLOY_DEPLOYCTL`, `SDKWORK_DEPLOY_SPEC_ROOT`, or `{SDKWORK_DEPLOY_APP_ROOT}/../sdkwork-specs/tools/deployctl.mjs`.

Nginx lifecycle:

```text
plan → render → nginx -t → deploy → reload → health-check → rollback previous conf on failure
```

## 13. Validation Rules

| Id | Rule |
| --- | --- |
| V1 | `appId` equals repository directory and topology `appId` |
| V2 | `runtimeCode` equals valid `topology.applicationCode` |
| V3 | `profiles` and root-level expose/packages are mutually exclusive |
| V4 | `mode: api` forbids `web` |
| V5 | adaptive requires pc or h5 surface root, or a configured static-fallback root when neither exists |
| V6 | `install.layout` is `source-tree` or `binary-package` |
| V7 | binary-package web roots MUST NOT use `/usr/share/sdkwork-space/` |
| V8 | source-tree web roots MUST NOT use `/usr/share/sdkwork/{runtimeCode}/web/` |
| V9 | site file equals `/etc/nginx/sites-enabled/sdkwork/{domain}.conf` |
| V10 | packages MUST NOT list `pc` or `h5` |
| V11 | production tls MUST NOT be `off` without `overrides.allowInsecureTls` |
| V12 | no plaintext secrets |
| V13 | apiSurfaces/OpenAPI prefix conflict fails validation |
| V14 | per-domain API locations MUST match `cloudPublicHosts` surface filter |
| V15 | nginx render MUST resolve upstreams from profile env or topology defaults; no placeholder ports |
| V16 | deploy manifest MUST validate against its declared v1/v2 schema; new manifests use v2 |
| V17 | profile ids use exactly `<standalone|cloud>.<test|staging|production>` and match structured deployment fields |
| V18 | v2 profiles declare typed delivery, driver, management, tenancy, isolation, exposure, rollout, and availability dimensions |
| V19 | production source-tree installation fails without an approved dated governance exception |
| V20 | side-effecting operations require explicit profile/environment/artifact digest/evidence/rollback selection and never consume `defaultProfile` |
| V22 | adaptive nginx emission MUST use named-location dispatch (§8.1); variable `include` paths and variable-root SPA fallback are forbidden |

## 14. Examples

See `examples/deploy/`.

## 15. Acceptance Checklist

- [x] `deployments/deploy.yaml` exists for deployable applications.
- [x] `deploy:validate` passes in `pnpm check`.
- [x] `deployctl plan` prints appId, runtimeCode, layout, nginx site file, web roots, upstreams.
- [x] generated nginx uses `/etc/nginx/sites-enabled/sdkwork/{domain}.conf`.
- [x] adaptive web uses stock-nginx named-location dispatch (§8.1), not
      variable `include` and not variable-root SPA fallback.
- [x] source-tree and binary-package roots match this spec.
- [x] multi-domain API filtering follows `cloudPublicHosts`.
- [x] nginx validate/reload hooks are security-gated for production operations.
- [x] Deploy API Server orchestrates remote `nginx apply` across registered application roots.
