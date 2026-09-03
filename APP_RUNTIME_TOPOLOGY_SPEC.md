# Application Runtime Topology Standard

- Version: 4.4
- Scope: cross-application deployment entrypoints, multi-plane routing, multi-protocol surfaces, dev orchestration contracts, and client bootstrap URL authority
- Related: `APPLICATION_GATEWAY_SPEC.md`, `NAMING_SPEC.md`, `APP_RUNTIME_TOPOLOGY_NAMING.md`, `APP_RUNTIME_TOPOLOGY_ARCHETYPES.md`, `DEPLOYMENT_SPEC.md`, `ENVIRONMENT_SPEC.md`, `CONFIG_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `../sdkwork-app-topology/README.md`

This standard defines where clients, operators, devices, and SDKs connect for
each SDKWork application. `DEPLOYMENT_SPEC.md` owns the application deployment
architecture: every deployable application uses exactly one active
`deploymentProfile`: `standalone` or `cloud`.

`deploymentProfile` is the only deployment-mode axis exposed to application
integration, SDK bootstrap, dev scripts, profile ids, and release automation.
Process decomposition, upstream scaling, and platform adapter placement are
implementation details inside the selected profile; they are not additional
profile segments.

**Naming authority:** `APP_RUNTIME_TOPOLOGY_NAMING.md`. All labels, env keys,
profile ids, CLI flags, and examples must match that registry.

## 1. Non-Goals

- OpenAPI/SDK ownership. Use `API_SPEC.md`, `SDK_SPEC.md`, and app integration specs.
- nginx, K8s, systemd, or provider-specific manifest details.
- Backward compatibility with retired deployment vocabulary.
- Exposing internal process decomposition as an SDKWork application integration mode.

## 2. Vocabulary

Applications `MUST` use these axes.

| Axis | Key | Values | Question it answers |
| --- | --- | --- | --- |
| Deployment profile | `deploymentProfile` | `standalone`, `cloud` | What deployment architecture is this application using? |
| Environment tier | `environment` | `development`, `test`, `staging`, `production`, `demo` | Which lifecycle stage is active? (`demo` is the independent demonstration/deployment tier) |
| Connectivity plane | `connectivityPlane` | `application`, `platform`, `operations`, `edge` | Who owns this route? |
| Browser origin mode | `browserDeliveries[].originMode` | `same-origin` | Do the page and browser-visible API requests share one origin? |
| Browser delivery mode | `browserDeliveries[].deliveryMode` | `dev-server-proxy`, `gateway-static` | How does that browser origin reach the application ingress in this profile? |

Examples in conversation:

- "Drive production uses `standalone.production`."
- "IM production uses `cloud.production`."
- "Realtime WebSocket terminates on `application.public-ingress`, not `platform.api-gateway`."

Rules:

- `deploymentProfile` values are only `standalone` and `cloud`.
- `standalone` means the application is shipped and operated as a
  self-contained deployment unit. It may embed application routes, dependency
  adapters, and an approved platform adapter behind one application ingress.
- `cloud` means clients consume explicitly deployed API surfaces operated with
  cloud release automation, managed secrets, probes, and rollout/rollback.
  Application topology does not own or identify the remote gateway host.
- Retired terms such as `self-hosted`, `cloud-hosted`, `saas`, `private`,
  `local`, `hosting`, `topology`, and `distribution` `MUST NOT` be used as
  active deployment profile or profile-id segments.
- `deploymentProfile` must not be inferred from `runtimeTarget`. A container
  can be a `standalone` single-container artifact or a `cloud` orchestrated
  image.
- Internal process count, binary count, and upstream fan-out `MUST NOT` appear
  in profile ids, SDK package names, public scripts, browser env keys, or
  application integration contracts.
- `dependencyApiSurfaces[].runtimeMode = "same-origin"` describes executable
  dependency API assembly composition. It does not prove that a browser page
  and its API requests share one browser-visible origin. That separate fact is
  declared by `browserDeliveries[].originMode`.

## 3. Connectivity Planes

| Plane | Owner | Protocols | Terminated by |
| --- | --- | --- | --- |
| `application` | Application repository | `http`, `ws`, future `sse` | Application API assembly hosted by the standalone application gateway or deployed platform gateway |
| `platform` | Shared SDKWork platform | `http` | Platform API assemblies hosted by `sdkwork-api-cloud-gateway` or an approved standalone host |
| `operations` | Application operator APIs | `http` | Operations control ingress |
| `edge` | Device or edge protocol clients | `ws`, `mqtt`, `udp`, device `http` | Responsibility-specific `sdkwork-<application-code>-<edge-capability>-edge-runtime` |

Rules:

- Application realtime WebSocket `MUST` terminate on `application.public-ingress`.
  In a `cloud` profile, the deployed platform cloud gateway
  (`sdkwork-api-cloud-gateway`) `MAY` terminate the application realtime plane
  (WebSocket upgrade plus declared client link transports) behind that surface
  when the application declares the platform-hosted realtime mode, the
  platform gateway declares the embedded realtime surface, and an ADR
  (`ADR-20260809-platform-gateway-realtime-hosting`) is recorded. The
  application standalone gateway remains the host for `standalone` profiles.
- External platform APIs use `platform.api-gateway` URLs only in cloud client
  bootstrap. A standalone profile embeds every selected same-origin dependency
  as an owner assembly contribution behind `application.public-ingress` and
  `MUST NOT` resolve a `platform.api-gateway` URL.
- Edge protocols `MUST NOT` be routed through `sdkwork-api-cloud-gateway` unless a
  future platform spec adds an edge tier. Application client link transports
  (TCP, UDP, QUIC) that belong to a declared application realtime surface are
  `application`-plane protocols, not `edge`-plane protocols; device and edge
  protocols (device WebSocket, MQTT bridge, device UDP) remain `edge`-plane
  and keep the `edge-runtime` role.
- Each plane `MUST` have distinct env keys from `APP_RUNTIME_TOPOLOGY_NAMING.md`.
- Application topology describes deployed surface URLs, not the implementation
  identity of the remote platform gateway. Cloud API assembly selection
  and rollout belong to the `sdkwork-api-cloud-gateway` repository or platform
  deployment authority.
- Edge/realtime/device ingress requires a protocol-specific role and ADR. It
  does not authorize a generic application HTTP cloud gateway or a local
  gateway in `cloud.development`.
- A topology process that terminates the `edge` plane uses role `edge-runtime`;
  it is not a `worker`, application standalone gateway, or platform cloud
  gateway. Its crate name and listener boundary follow `NAMING_SPEC.md` section
  4.3 and `APPLICATION_GATEWAY_SPEC.md` section 5.

## 4. Surfaces

A surface is a named ingress: bind, public URL, protocol set, and optional path
metadata.

Surface id pattern:

```text
<connectivityPlane>.<surfaceRole>
```

Example declaration in `specs/topology.spec.json`:

```json
{
  "id": "application.public-ingress",
  "connectivityPlane": "application",
  "protocols": ["http", "websocket"],
  "bindEnv": "SDKWORK_IM_APPLICATION_PUBLIC_INGRESS_BIND",
  "httpUrlEnv": "SDKWORK_IM_APPLICATION_PUBLIC_HTTP_URL",
  "websocketUrlEnv": "SDKWORK_IM_APPLICATION_PUBLIC_WEBSOCKET_URL",
  "websocketPath": "/im/v3/api/realtime/ws",
  "realtimeHosting": "platform-cloud-gateway"
}
```

`realtimeHosting` declares who terminates the application realtime plane in a
`cloud` profile: `application` (application ingress, default) or
`platform-cloud-gateway` (the deployed platform cloud gateway, per
`ADR-20260809-platform-gateway-realtime-hosting`). `standalone` profiles
always terminate realtime on `application.public-ingress` regardless of the
declared value.

Rules:

- HTTP and WebSocket on the same surface share host and port; only the scheme differs.
- `websocketUrlEnv` is origin only; SDKs append `websocketPath`.
- `bindEnv` is server-side; `*UrlEnv` keys are used by clients and orchestration.
- `realtimeHosting: "platform-cloud-gateway"` requires the platform gateway to
  declare the embedded realtime dependency surface and its Cargo feature; it
  does not change the surface id, env keys, or SDK-facing URLs.
- Client link transport binds (for example `SDKWORK_IM_REALTIME_TCP_BIND_ADDR`)
  are server-side declarations of the application realtime surface; they are
  non-HTTP listeners and are not `edge`-plane ingress.

### 4.1 Cloud Public Host Registry

`specs/topology.spec.json` `cloudPublicHosts` maps topology surfaces to their
public hostnames. Hostnames follow the environment host formula from
`APP_RUNTIME_TOPOLOGY_NAMING.md` section 9 (`<role>[-<environment-suffix>].<base-domain>`;
production carries no suffix).

```json
{
  "cloudPublicHosts": {
    "application.public-ingress": {
      "httpHost": "im.sdkwork.com",
      "websocketHost": "im.sdkwork.com",
      "note": "chat.sdkwork.com is reserved for LLM conversational apps, not IM",
      "environments": {
        "development": { "httpHost": "im-dev.sdkwork.com", "websocketHost": "im-dev.sdkwork.com" },
        "test": { "httpHost": "im-test.sdkwork.com", "websocketHost": "im-test.sdkwork.com" },
        "staging": { "httpHost": "im-staging.sdkwork.com", "websocketHost": "im-staging.sdkwork.com" }
      }
    },
    "platform.api-gateway": {
      "httpHost": "api.sdkwork.com",
      "environments": {
        "development": { "httpHost": "api-dev.sdkwork.com" },
        "test": { "httpHost": "api-test.sdkwork.com" },
        "staging": { "httpHost": "api-staging.sdkwork.com" }
      }
    },
    "application.multi-domain-ingress": {
      "httpHost": "router.sdkwork.com",
      "httpHosts": ["router.sdkwork.com", "router.birdcoder.com", "router.dtupay.com"],
      "environments": {
        "test": { "httpHosts": ["router-test.sdkwork.com", "router-test.birdcoder.com", "router-test.dtupay.com"] }
      }
    }
  }
}
```

Field contract:

| Field | Meaning |
| --- | --- |
| `httpHost` | Production primary HTTP hostname for the surface. Its absence means the surface has no cloud public host. |
| `httpHosts` | Optional complete production host set for the surface (multi-base-domain bindings per `APP_RUNTIME_TOPOLOGY_NAMING.md` section 9). When both are declared, `httpHost` `MUST` be an element of `httpHosts`. When only `httpHosts` is declared, `httpHost` defaults to its first element. |
| `websocketHost` | Optional production WebSocket hostname; defaults to `httpHost`. |
| `note` | Optional registry annotation (top-level entries only; never used for routing). |
| `environments` | Optional per-environment overrides keyed by canonical environment (`development`, `test`, `staging`, `demo`, `production`). Each entry may override `httpHost`, `httpHosts`, and/or `websocketHost`. |

Resolution rules:

- For a profile with environment `E`, the effective host set is
  `environments[E].httpHosts` when declared, otherwise
  `[environments[E].httpHost]` when declared.
- The top-level `httpHosts` / `httpHost` values are the `production` default:
  they apply to `production` profiles and to profiles whose environment has no
  `environments` override **only when the surface is production-only**.
  Non-production environments `MUST` declare their own override and `MUST NOT`
  fall back to the top-level (production) host set; a `cloud.development`
  profile without an override has no registered host for the surface and
  fails validation (`SDKWORK_DEPLOY_SPEC.md` V21) rather than inheriting the
  production host.
- A profile `MUST` NOT resolve an unregistered environment host from the
  formula implicitly for routing decisions; tools may verify a host against
  `APP_RUNTIME_TOPOLOGY_NAMING.md` section 9.1 but routing and deploy manifests
  consume the declared registry.
- `expose.domain` in `deployments/deploy.yaml` `MUST` be an element of the
  effective host set for the profile environment; every additional registered
  host `SHOULD` be bound as `expose.aliases` so the site serves the full set
  (`SDKWORK_DEPLOY_SPEC.md` section 7.2).
- Each host in the effective set maps to one nginx-compatible site artifact
  (staging `target/nginx/sites-enabled/sdkwork/<host>.conf` or module
  `deployments/webserver/` loaded by `sdkwork-webserver`) when it appears as an
  `expose` item; hosts bound only as `aliases` share the primary site artifact
  and appear as extra `server_name` values. Stock `/etc/nginx` is not the live
  edge (`NGINX_SPEC.md` §0).
- Standalone profiles `MUST NOT` resolve or require `cloudPublicHosts`.
- Per-environment hosts are never inherited across environments; a
  `cloud.development` profile does not fall back to the production host or to a
  loopback URL.

### 4.2 Runtime Binding Versus Build Binding

Every client-facing base URL (SDK clients, browser runtime env, mini-program and
mobile runtime env, dev proxy targets) is bound in exactly one mode. The mode
follows the consuming lifecycle step, never the file that declares it.

| Lifecycle step | Bound target | Source of the value |
| --- | --- | --- |
| `dev:cloud` runtime | Local platform gateway `ip:port` | `SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL` (normally `http://127.0.0.1:3900`) |
| Cloud-mode build (`build:<client>:<env>:cloud`) | Environment cloud API edge | `cloudApiBaseUrl` host family for that environment |
| Deployed runtime | The deployed edge that owns the profile | `cloudPublicHosts` / `public/runtime-env.js` deployment anchor |

Environment cloud API edge host family (`platform.api-gateway`, one registered
`<base-domain>` family per environment):

| Environment | Host family | Example |
| --- | --- | --- |
| `development` | `api-dev.<base-domain>` | `https://api-dev.sdkwork.com` |
| `test` | `api-test.<base-domain>` | `https://api-test.sdkwork.com` |
| `staging` | `api-staging.<base-domain>` | `https://api-staging.sdkwork.com` |
| `demo` | `api-demo.<base-domain>` | `https://api-demo.sdkwork.com` |
| `production` | `api.<base-domain>` | `https://api.sdkwork.com` |

Rules:

- **`dev:cloud` binds local.** Every `cloud.development` artifact that a
  development process or a browser dev surface consumes `MUST` resolve
  platform-gateway-attached base URLs to the local gateway `ip:port`. This
  covers topology profile env, vite dotenv surfaces (`.env.cloud.development`),
  browser/mini-program/mobile runtime env
  (`runtime-env.cloud.development.json`, `sdkwork.cloud.development.json`),
  `public/runtime-env.json` materializations, and generated SDK client
  construction. No `api-<suffix>.<base-domain>` value `MAY` appear in a
  `cloud.development` artifact.
- **Cloud-mode builds bind the environment domain family.** `build:*` for a
  cloud profile `MUST` use the environment host family of the table above
  (`development` → `api-dev.`, `test` → `api-test.`, `staging` →
  `api-staging.`, `demo` → `api-demo.`, `production` → `api.`) and `MUST NOT`
  introduce loopback or `127.0.0.1` values.
- **Never cross the boundary.** A value bound for dev runtime is not a build
  input and vice versa. A repository that materializes the same source into
  both surfaces `MUST` select the binding by profile id and lifecycle step.
- **Standalone is unaffected.** Standalone profiles resolve loopback/same-origin
  values through their own rules; they never consume `cloudPublicHosts`.
- **WebSocket edges follow their HTTP origin.** A `ws(s)://` edge attached to
  the platform gateway is rewritten together with its HTTP counterpart
  (`https` → `wss`, `http` → `ws`).
- **Paths are preserved.** Rebinding replaces origin only; declared API
  prefixes such as `/backend/v3/api` survive the rewrite.
- **Separate service edges stay remote.** Dependency-owned hosts that are not
  the platform gateway (agents, voice, drive application hosts, ...) keep their
  registered values even under `dev:cloud`, `PNPM_SCRIPT_SPEC.md` §3.

SDK base URL resolution chain (`SDK_SPEC.md` §5). Every SDK integration
`MUST` resolve its base URL in this order; the first hit wins:

1. Explicit process or dotenv override for the running profile.
2. `dev:cloud` local gateway anchor, only when the active profile is
   `cloud.development` and the anchor is declared.
3. The materialized artifact value for the active profile.
4. The environment host family of the table above for build/deploy targets.

Hardcoding an `api-<suffix>.<base-domain>` value as a client default or fallback
is forbidden: a default that a `dev:cloud` session can reach is a dev-runtime
leak, whether or not an env key would normally override it.

## 5. Archetypes

Applications declare `archetype` in `specs/topology.spec.json`. Definitions
live in `APP_RUNTIME_TOPOLOGY_ARCHETYPES.md`.

| Archetype | Typical products |
| --- | --- |
| `application-http-gateway` | Drive-class HTTP applications |
| `realtime-application-platform` | IM and future realtime collaboration apps |
| `application-rest-edge-device` | AIoT and future edge/device apps |

## 6. Profile Contract

### Profile Id

```text
<deploymentProfile>.<environment>
```

Examples:

```text
standalone.development
standalone.production
cloud.staging
cloud.production
```

Rules:

- Profile ids `MUST` contain exactly two segments.
- The first segment `MUST` be `standalone` or `cloud`.
- The second segment `MUST` be a normalized environment tier from
  `ENVIRONMENT_SPEC.md`.
- A profile id `MUST NOT` encode runtime target, database engine, process
  count, upstream count, hosting ownership, or package format.

Cloud-capable topology schema v5 roots declare explicit remote surfaces:

```json
{
  "surfaces": {
    "application.public-ingress": {
      "httpUrlEnv": "SDKWORK_DEMO_APPLICATION_PUBLIC_HTTP_URL"
    }
  }
}
```

The application contract does not name the remote gateway implementation.
Protocol-specific edge/realtime ingress requires an ADR and separate topology
surface. The machine authority is `schemas/sdkwork.app.topology.schema.v5.json`.
Schema v4 remains readable only during the migration window.

### Browser Delivery Evidence

A standalone topology v5 orchestration profile that delivers a browser
application uses `browserDeliveries`. Every entry declares a stable `id`, repository-relative
`applicationRoot`, non-empty canonical `clientArchitectures`,
`originMode: "same-origin"`, one `deliveryMode`, and
`apiSurfaceId: "application.public-ingress"`.

Standalone development with a browser client uses:

```json
{
  "id": "webserver-pc",
  "applicationRoot": "apps/sdkwork-webserver-pc",
  "clientArchitectures": ["pc-web"],
  "originMode": "same-origin",
  "deliveryMode": "dev-server-proxy",
  "clientProcessId": "webserver-pc-browser",
  "apiSurfaceId": "application.public-ingress",
  "preserveCanonicalPaths": true
}
```

The selected client process owns the development renderer listener. The
browser opens that renderer origin, and the renderer proxy forwards canonical
API paths to the topology-resolved application ingress. The API target listener
is internal transport for this browser flow; it is not emitted as a browser SDK
Base URL.

Standalone production with a browser application uses:

```json
{
  "id": "webserver-pc",
  "applicationRoot": "apps/sdkwork-webserver-pc",
  "clientArchitectures": ["pc-web"],
  "originMode": "same-origin",
  "deliveryMode": "gateway-static",
  "hostProcessId": "application.public-ingress",
  "apiSurfaceId": "application.public-ingress",
  "buildOutput": "apps/sdkwork-webserver-pc/dist",
  "runtimeRootEnv": "SDKWORK_WEB_PC_STATIC_ROOT",
  "mountPath": "/",
  "spaFallback": "/index.html"
}
```

`buildOutput` is release input evidence; `runtimeRootEnv` resolves the packaged
or installed asset root. The gateway serves immutable assets and the SPA shell
on the same origin as the APIs. API, OpenAPI, health, and operations routes take
precedence over static lookup and SPA fallback.

Rules:

- Every standalone browser client process `MUST` have exactly one matching
  development delivery for its `applicationRoot` and architecture selection.
- Every corresponding standalone production browser artifact `MUST` have
  exactly one `gateway-static` delivery per selected client architecture.
- A delivery's `clientArchitectures` `MUST` match its development client
  process. Runtime-plan resolution projects only entries matching the selected
  `clientArchitecture`, so `pc-web` and `h5` may coexist without sharing the
  wrong renderer, proxy, or build output.
- `browserDeliveries` contains no concrete bind, port, URL, or installed path.
  Those values remain in the selected source `etc/` profile.

### Repository Files

```text
specs/topology.spec.json
etc/topology/<profile-id>.env
docs/topology-standard.md
scripts/lib/<application-code>-topology.mjs
```

Implementation: `@sdkwork/app-topology` (`../sdkwork-app-topology`).

### 6.1 Application Environment Keys And Database Boundary

`topology.spec.json#applicationCode` declares the canonical lowercase L2
application code from `RUNTIME_DIRECTORY_SPEC.md`. It owns runtime directory
and install path segments such as `/etc/sdkwork/<application-code>`. It may
differ from `appId`, repository name, process name, `app.key`, and the
application lifecycle environment prefix.

`topology.spec.json#envKeys` declares complete application lifecycle and
connectivity environment key names and is authoritative after initialization.
New topology initialization may propose conventional env names from the new
application code, while established products may preserve a different explicit
prefix such as `SDKWORK_CLOUDROUTER_*`. Migration tooling derives an existing
application prefix from `envKeys.deploymentProfile`, not from `applicationCode`.
The prefix is not a database namespace.

Topology schema v5 `MUST NOT` declare `database`, `database.appPrefix`, an
application-scoped database prefix, database name, or schema name. PostgreSQL
selection belongs to the active workspace environment profile and uses only the
canonical `SDKWORK_DATABASE_*` contract from `ENVIRONMENT_SPEC.md` section 7.1.
The orchestration process role `database` describes process ownership only; it
does not grant an application or module a separate PostgreSQL identity.

Application lifecycle keys such as
`SDKWORK_<APPLICATION_CODE>_DEPLOYMENT_PROFILE` remain application-scoped.
Database keys such as `SDKWORK_DATABASE_NAME` and
`SDKWORK_DATABASE_SCHEMA` remain workspace-scoped. Implementations and
migration tools `MUST NOT` derive one family from the other.

The repository-level `sdkwork-app` facade in `sdkwork-app-topology` is the
standard local lifecycle adapter. Public `pnpm dev`, `build`, `test`, `check`,
`verify`, `clean`, and `stop` scripts delegate to it; application-specific commands
remain private `_sdkwork:*` hooks. The facade consumes this topology contract
and the resolved runtime-plan schema rather than introducing another runtime
manifest. Package/release planning belongs to `sdkwork-github-workflow`, and
deployment apply/rollback belongs to `sdkwork-specs/tools/deployctl.mjs`.
Generic development orchestration records a repository-scoped heartbeat outside the source tree
under the OS user/runner runtime root defined by `RUNTIME_DIRECTORY_SPEC.md` section 5. The path is
`sdkwork/sdkwork-app/<repository-hash>/development-session.json`, where the hash is derived from the
canonical repository real path, so a separate `sdkwork-app stop` invocation can terminate only that
development process tree without adding a repository directory. The registry also records directly
spawned child PIDs and topology-resolved owned bindings. If registry state is
missing or stale, the facade reconstructs ownership from development profiles:
surface/process `bindEnv` declarations provide TCP listener ownership and
`managedResources` select framework-owned lifecycle drivers. Windows process
tree termination may be used as an optimization, but correctness must not depend
on WMI/CIM enumeration. The registry directory and file are user-private, writes
are atomic, stale files are removed, and repository/process identity is validated
before termination. Applications must not provide private `_sdkwork:stop`
process-selection logic.

Client app surfaces that share an enclosing application deployment unit delegate
topology through `etc/sdkwork.deployment.config.json#parentTopologySpec` as
defined by `SOURCE_CONFIG_SPEC.md`. Their public `dev:*` and `stop` commands
invoke `sdkwork-app` with an explicit enclosing `--root`; surface-local
`build`, `test`, `check`, `verify`, and `clean` remain scoped to the child root.
Delegated surfaces do not copy parent `etc/topology` profiles, declare a second
topology spec, or start a second standalone gateway.

## 7. Client Bootstrap

- IAM login uses `platform.api-gateway` only in a `cloud` profile where the
  platform plane is external.
- In `standalone`, IAM and every other same-origin dependency API are linked as
  dependency-owned Rust API assembly contributions into the current
  `sdkwork-api-<application-code>-standalone-gateway` process. They preserve the
  same SDK contract, credential rules, and `WebRequestContext` behavior while
  being served by `application.public-ingress`; they are not dependency gateway
  processes, child processes, or alternate loopback listeners.
- Server and browser `platform.api-gateway` URL keys are cloud-only and `MUST`
  be absent from standalone source profiles and resolved runtime plans.
- Each deployment profile `MUST` classify every consumed dependency API surface as exactly one of embedded same-origin or external. Embedded selects the dependency-owned API assembly and proves mount coverage; external selects a declared platform/dependency URL and does not mount the dependency assembly locally.
- Server/native open-api and app-api SDKs use the
  `application.public-ingress` HTTP URL. Browser deliveries preserve that API
  surface while using their declared browser-visible origin.
- Realtime SDKs use `application.public-ingress` WebSocket URL.
- Client env keys mirror server keys with the configured browser prefix.
- A standalone browser delivery resolves browser SDK Base URLs from the
  browser-visible origin. Checked-in and materialized public runtime source
  values use root-relative same-origin paths; browser bootstrap may then resolve
  them against `window.location.origin` before SDK construction. No standalone
  public runtime source exposes or hard-codes an absolute renderer,
  application-ingress, dependency, or loopback origin.
- Credential-entry bootstrap is a lifecycle precondition, not a feature-level env read. Development renderers receive the approved private bootstrap handoff before application modules execute; production browsers use the approved short-lived IAM bootstrap exchange or trusted host channel from `IAM_CREDENTIAL_ENTRY_SPEC.md`.

Forbidden:

- One ambiguous URL for both application and platform SDKs.
- Hardcoded loopback ports in feature packages.
- Generated SDK operations that accept current tenant context through
  `tenant_id` or `tenantId` parameters.

## 8. Dev Orchestration

Dev scripts `MUST`:

1. Load profile env from `etc/topology/` through `@sdkwork/app-topology`.
2. Start processes from `topology.spec.json` `orchestration.profiles[<profile-id>]`.
3. Health-check required surfaces before starting clients.
4. Execute declared lifecycle environment providers, including IAM credential-entry development bootstrap, before spawning dependent clients.
5. Accept `--deployment-profile` and `--environment`.
6. Print the resolved `deploymentProfile`, `environment`, runtime target,
   database profile when applicable, and profile id at startup.

The resolved runtime plan is the sole bind authority. Child commands receive topology-resolved host/port values through their declared env/arguments; package scripts and application launchers `MUST NOT` replace those values with hard-coded ports. The development session registry records the actual spawned binding and validation fails when it differs from the plan.

### 8.1 Access Endpoints

Development access URLs are resolved from topology instead of inferred from a
port number, process name, framework role, or application-specific log code.
An orchestration profile `MAY` declare `accessEndpoints`. Each endpoint:

- `MUST` have a stable `id`, `kind`, absolute `path`, and exactly one source:
  `processId` or `surfaceId`;
- `MUST` reference a process in the same profile or a declared topology
  surface;
- `MUST` reference a process with `bindEnv` when `source.processId` is used;
- `MAY` declare `runtimeTargets` and `clientArchitectures` using the same
  canonical vocabularies as process selection;
- `MAY` set `primary: true`; at most one selected endpoint may be primary for
  one resolved runtime plan;
- `MUST` use `kind: user-interface` for a browser-accessible application UI
  and `kind: api-reference` for an OpenAPI or equivalent developer document.

The shared `@sdkwork/app-topology` runtime plan `MUST` resolve selected access
endpoints after process and client-architecture filtering. It owns bind parsing,
wildcard-listener loopback projection, LAN address discovery, deterministic URL
ordering, and standard access-line formatting. Application launchers may add
product-specific API route diagnostics, but they `MUST NOT` guess that
`application.public-ingress` serves a UI root or publish a URL that was not
declared by `accessEndpoints`.

Adding `accessEndpoints` is backward-compatible. Profiles without the field
retain their existing process plan and do not receive inferred access URLs.

### 8.2 Adaptive Browser Delivery

Independent modules that expose a browser client on `application.public-ingress`
`MUST` declare both `pc-web` and `h5` client architectures (application roots
`apps/<appId>-pc` and `apps/<appId>-h5`). Missing one surface collapses at plan
time; missing both uses production `static-fallback` per
`SDKWORK_DEPLOY_SPEC.md` §8.

A `dev-server-proxy` browser delivery `MAY` declare `renderers` to become
**adaptive**: one same-origin dev ingress selects the browser renderer by
device class, and falls back to another renderer when the preferred one is
unavailable. Desktop browsers receive `pc-web`; mobile browsers receive `h5`.
When the preferred renderer is not ready or fails, the ingress falls back to
the other available renderer (desktop → `h5`, mobile → `pc-web`). This mirrors
production `SDKWORK_DEPLOY_SPEC.md` §8 Adaptive Web (including §8.1 stock
nginx named-location emission) on the dev side; the device detection contract
below is shared with it.

`browserDeliveries[].renderers`:

- `MUST` be an object keyed by canonical client architectures declared by the
  delivery; every key `MUST` belong to
  `browserDeliveries[].clientArchitectures`.
- Each renderer `MUST` declare `applicationRoot` (safe relative path) and one
  invocation: `command` + `args` (args may use `{host}` and `{port}` tokens),
  a workspace `script` resolved in `applicationRoot`, or `crate`/`package`.
- Each renderer `MUST` resolve a TCP port from `portEnv` (profile env) or
  `defaultPort`; it `MAY` declare `hostEnv`, `userAgent` (readiness probe),
  and an `env` string map merged into the renderer environment. Renderer
  `env` values and invocation `args` may use the `{host}`, `{port}`,
  `{httpOrigin}`, and `{wsOrigin}` tokens resolved from the delivery bind and
  `browserVisibleOrigin`.
- A delivery with both `pc-web` and `h5` renderers is `adaptive`; with a
  single renderer it collapses (`collapse-pc` / `collapse-h5`) like the
  production plan folding in `SDKWORK_DEPLOY_SPEC.md` §8.
- Renderers are `dev-server-proxy` only; `gateway-static` deliveries `MUST NOT`
  declare them.

The framework-owned adaptive ingress (implemented by `@sdkwork/app-topology`
`startAdaptiveWebDelivery`) `MUST`:

1. Start every declared renderer through the lifecycle spawner with the
   resolved profile env; inject `surface.clientHttpEnv` and
   `surface.clientWebsocketEnv` of `apiSurfaceId` with the delivery's
   `browserVisibleOrigin` so renderers call the same origin.
2. Wait for renderer readiness with device-appropriate probes (bounded;
   default 120s).
3. Serve the `browserVisibleOrigin` bind: route non-API requests by device
   class to the preferred renderer, add `Vary: user-agent`, keep canonical
   API paths (`/api`, `/app|backend|im|open/v\d+/api`, health and metrics
   paths) and WebSocket upgrades on `application.public-ingress`, and fall
   back to the next available renderer (GET/HEAD) when the preferred renderer
   is not ready or fails.
4. Mark a renderer unavailable on exit; the ingress keeps serving with the
   remaining renderers until the development session ends.

Device detection order (shared with `SDKWORK_DEPLOY_SPEC.md` §8):

1. `browserDeliveries[].deviceOverrides` rules (regex `pattern` →
   `deviceClass`).
2. `Sec-CH-UA-Mobile: ?1`.
3. iPad defaults to the delivery `tabletArchitecture` (`pc-web` unless
   declared `h5`).
4. Default mobile User-Agent regex.
5. Default desktop → `pc-web`.

The adaptive client process keeps its `bindEnv` and `applicationRoot` (the
delivery's `clientProcessId`); the orchestrator does not launch it as a
separate process. `accessEndpoints` keep referencing it and resolve to the
same `browserVisibleOrigin`. Non-adaptive `dev-server-proxy` deliveries retain
their private hook behavior and are unaffected.

Root `dev:browser` and `dev:desktop` are default dev orchestration commands.
They `MUST` resolve to `standalone.development` and the PostgreSQL dev database
profile unless the command name explicitly selects another database or `cloud`.
New dev scripts `MUST NOT` accept or emit retired deployment flags such as
`--hosting self-hosted` or `--hosting cloud-hosted`.

Every pnpm-managed application root `MUST` also expose the profile entrypoints
defined by `PNPM_SCRIPT_SPEC.md`:

```text
pnpm dev:standalone
pnpm dev:cloud
```

`dev:standalone` selects `standalone.development`. Its orchestration profile may
start the local application ingress, non-HTTP local dependencies, and local
developer-facing clients. HTTP dependency API surfaces classified as embedded
same-origin are linked Rust assembly contributions inside the application
standalone gateway; orchestration `MUST NOT` start their gateway binaries or
allocate dependency API ports.

When that profile selects a browser client, its renderer/dev-server listener is
a local client-tooling listener, not a second application API listener. The
browser sees the renderer origin only; canonical API requests traverse the
declared `dev-server-proxy` delivery to `application.public-ingress`.

`dev:cloud` selects `cloud.development` as a remote-consumer development
profile. It starts local developer-facing clients only. The profile:

- `MUST` resolve `application.public-ingress` and every required external plane
  to explicit deployed URLs from the selected source config.
- `MUST NOT` start an application gateway, platform gateway, API server,
  edge runtime, worker required only by the deployed API, database, Redis,
  migration, or seed process.
- `MUST` health-check required remote surfaces with bounded timeouts before
  starting clients.
- `MUST` fail closed when a required remote URL is missing and must not inherit
  a loopback URL from `standalone.development` or a URL from
  `cloud.production`.
- `MAY` use an explicitly declared local tunnel or proxy, but that process and
  its loopback URL must be visible in the topology profile rather than created
  as an orchestrator fallback.

`orchestration.profiles["cloud.development"].processes` therefore contains no
local API-plane or platform-plane server process by default. Its
`healthSurfaces` may name remote surfaces. Client dev servers remain local
runtime targets and do not become cloud release artifacts merely because they
consume a cloud deployment.

Every orchestrator `MUST` expose a deterministic JSON plan equivalent to:

```text
pnpm topology:plan --deployment-profile <standalone|cloud> --environment <environment> --runtime-target <target> --json
```

The plan includes active profile/environment, local client processes, local
gateway identity, remote surfaces, Base URLs with source provenance, selected
browser deliveries with distinct `browserVisibleOrigin` and `apiTargetOrigin`,
local data stores, health checks, config inputs, and forbidden process roles.
Validation operates on the resolved plan rather than only process-name
matching.

The canonical plan contract is
`schemas/sdkwork.runtime-plan.schema.v1.json`. Repositories may call the shared
resolver directly when their `@sdkwork/app-topology` adapter does not yet expose
an equivalent command:

```bash
node ../sdkwork-specs/tools/resolve-app-runtime-plan.mjs --root . --deployment-profile cloud --environment development --runtime-target browser --json
```

Topology schema v5 orchestration processes `MUST` declare one canonical
`role`: `client`, `api-standalone-gateway`, `edge-runtime`, `database`, `redis`,
`migration`, `seed`, `worker`, or `tunnel`. `id`, binary, or script text is not
role authority. `edge-runtime` is reserved for the responsibility-specific
device/edge protocol process defined by `NAMING_SPEC.md` section 4.3; background
jobs that terminate no edge ingress remain `worker`.
Client processes `MAY` declare a repository-relative `applicationRoot` when
the client is an independently configured application surface. The path must
stay inside the repository and contain its own `sdkwork.app.config.json`;
non-client processes must not declare this field.
The retired `api-listener` role is not valid in schema v5; HTTP API processes
must be represented by the single `api-standalone-gateway` role.
`cloud.development` allows only `client` and explicitly configured `tunnel`
roles; in particular, it starts no local `edge-runtime`. `standalone.development`
may declare local dependencies, but an
application that serves HTTP APIs has exactly one `api-standalone-gateway` role.

An orchestration process that applies only to selected runtime targets `MAY`
declare `runtimeTargets`. The runtime plan `MUST` exclude that process unless
the selected `runtimeTarget` appears in the non-empty canonical target list.
Processes without `runtimeTargets` apply to every runtime target for the
profile. This selection is declarative; public pnpm scripts must not duplicate
the process graph for browser and desktop variants.

When one runtime target has multiple client implementations, a `client`
process `MAY` additionally declare `clientArchitectures` using the canonical
`APP_MANIFEST_SPEC.md` vocabulary. Runtime-plan selection applies both axes.
For example, PC Web and H5 both use `runtimeTarget = browser` and are selected
with `clientArchitecture = pc-web` or `h5`; H5 is not a new runtime target.
Processes without `clientArchitectures` remain shared. The default browser
architecture is `pc-web` and the default desktop architecture is `tauri` for
backward-compatible public commands; other architectures are explicit. For
desktop hosts, `clientArchitecture = "electron"` selects the Electron host and
`clientArchitecture = "tauri"` selects the Tauri host; both use
`runtimeTarget = "desktop"` and share the same `client` orchestration process
while the runtime plan records the selected architecture so package and
artifact selection stays deterministic. An application that ships both hosts
`MUST` declare both values in its orchestration `clientArchitectures` and its
manifest `clientArchitectures`.

`cloud.development` plans `MUST` report zero local standalone gateway,
platform gateway, API listener, edge runtime, database, Redis, migration, seed,
and deployed-service worker processes.
`standalone.development` plans with application HTTP APIs `MUST` report exactly
one application HTTP ingress:
`sdkwork-api-<application-code>-standalone-gateway`.

For `deploymentProfile=standalone`, orchestration `MUST` start only the
application ingress process for application-plane HTTP APIs. Internal route
crates and dependency-owned API assembly contributions are embedded in that
ingress process, and dev/runtime contracts `MUST NOT` require extra loopback API
ports to make application or embedded dependency APIs reachable.

For every profile, orchestration `MUST` treat HTTP API ingress as **single-bind
per plane**. A development renderer listener is counted as client tooling, not
as another API ingress:

- `application.public-ingress` is the only application-plane HTTP listener that
  dev scripts, client bootstrap, and default smoke tests may require.
- `platform.api-gateway` is the only platform-plane HTTP listener that dev
  scripts and client bootstrap may require when external platform APIs are in
  scope in a cloud profile. It `MUST NOT` resolve or appear in a standalone
  profile; standalone dependency SDKs use `application.public-ingress`.
- Additional HTTP surface ids such as `application.backend-http`,
  `application.open-http`, or per-service listener binaries `MUST NOT` appear
  as separately required orchestration processes when a gateway already
  terminates the same plane. Those binaries remain valid as internal upstream
  or packaging targets only.
- Dev orchestration scripts `MUST NOT` spawn HTTP sidecar loops, multi-port
  service matrices, or reserved loopback port tables whose only purpose is to
  keep extra application HTTP listeners alive locally.

### 8.3 Automated Test Port Isolation

Automated test runs that boot the application or any runtime surface (gateway,
portal, backend/admin API, app API, or embedded dependency APIs) `MUST NOT`
bind the manual development default ports. Manual development keeps exclusive
ownership of the default dev bind values declared by the workspace
`standalone.development` topology profile, so a developer can start
`pnpm dev` at any time without port conflicts and without any automated run
displacing, restarting, or competing with the manually started instance.

Rules:

- Automated test runs `MUST` configure dedicated test ports through the
  topology bind authority — explicit `--*-bind` orchestration flags or
  `SDKWORK_*_BIND` environment overrides resolved from the test run's profile
  or environment — and `MUST NOT` fall back to the manual dev default ports.
- Automated test runs `MUST NOT` kill, restart, or share ports with a
  manually started dev instance; when the manual defaults are occupied, the
  automated run proceeds on its test ports without touching the occupant.
- Test port allocation `MUST` be deterministic per test suite (declared
  ranges in the test launch profile or test environment) and `MUST` be
  documented; test code `MUST NOT` hard-code loopback ports outside the
  declared test range.
- Automated test runs `MUST` release their test ports and terminate every
  spawned runtime process on completion — success or failure — leaving no
  orphan listeners or daemonized dev stacks behind.
- A test launcher `MUST` fail fast with a clear diagnostic when its declared
  test ports are already in use, instead of retrying against or displacing
  the occupant.

The default dev ports belong to manual startup only; automated test
configuration (profiles, env files, CI matrices) `MUST` reference the
dedicated test ports, never the manual defaults.

Normative gateway integration rules live in `APPLICATION_GATEWAY_SPEC.md`
section 5. From an application root, workspace verification is:
`node ../sdkwork-specs/tools/audit-single-http-ingress-workspace.mjs --workspace ..`.

Adoption steps: `APP_RUNTIME_TOPOLOGY_ADOPTION.md`.

## 9. Deployment Standard Mapping

| Deployment profile | Runtime target coverage |
| --- | --- |
| `standalone` | `browser`, `server`, `container`, `desktop`, `tablet-ipados`, `tablet-android`, `capacitor-ios`, `capacitor-android`, `flutter-ios`, `flutter-android`, `android-native`, `ios-native`, `harmony-native`, `mini-program` when packaged as a private/platform-local app, and `test-runner` |
| `cloud` | `container`, `server`, `browser`, `mini-program`, H5 browser surfaces, cloud-served public runtime config, and `test-runner` |

Rules:

- `server`, `container`, `desktop`, `browser`, tablet, Capacitor, Flutter,
  native mobile, mini-program, and `test-runner` values from `CONFIG_SPEC.md`
  are runtime targets, not deployment profiles.
- Non-browser client runtime targets may be standalone release artifacts while
  explicitly external SDK surfaces point at cloud services. This does not
  create a third deployment profile. Standalone browser targets still require
  the same-origin `browserDeliveries` contract from section 5.
- `browser` and H5 cloud surfaces normally connect to `application.public-ingress`
  and `platform.api-gateway` through public runtime config. Native, desktop,
  tablet, Flutter, Capacitor, and mini program packages connect through the
  same declared surfaces after host/bootstrap config resolves SDK base URLs.
- `docker` is not a topology or deployment profile value. Docker-compatible
  packages use `runtimeTarget = "container"` and container/OCI package metadata.
- SaaS and customer-private ownership are release/deployment-environment
  metadata. They must not create new topology profile ids.

## 10. CI And Packaging

Package profile slugs for deployable artifacts `MUST` include `standalone` or
`cloud`.

Examples:

```text
standalone-server
standalone-desktop
standalone-container
cloud-container
cloud-platform-config-bundle
cloud-application-public-ingress
```

Rules:

- Surface roles may be appended for deployable config bundles.
- Application API assembly and gateway names must use
  `sdkwork-api-<application-code>-assembly` and
  `sdkwork-api-<application-code>-standalone-gateway` per `NAMING_SPEC.md` section 4.3.1.
- Matrix planners must pass `SDKWORK_DEPLOYMENT_PROFILE` to lifecycle steps.

## 11. Verification

- Validate spec: `node ../sdkwork-app-topology/scripts/sdkwork-topology.mjs validate --root .`
- Contract tests load profile fixtures; no inline port literals in source.
- Naming audit must reject retired terms from `APP_RUNTIME_TOPOLOGY_NAMING.md`.
- Validation must fail when a topology profile id starts with retired hosting aliases.
- Validation must fail when a deployment profile is any value other than
  `standalone` or `cloud`.
- Validation must fail when a topology profile id contains more or fewer than
  two segments.
- Standalone smoke tests must prove one public application ingress can serve all
  declared application-plane HTTP APIs without extra loopback route servers.
- Cloud smoke tests must prove internal upstream URLs, platform surfaces,
  secrets, probes, and SDK base URL resolution are explicit while client
  bootstrap still receives one application ingress URL.
- Credential-entry lifecycle tests must prove bootstrap provider completion precedes renderer spawn, missing provider output fails before the login UI becomes actionable, and production/public artifacts contain no bootstrap token.
- Runtime-plan tests must prove declared renderer bindings, spawned command arguments, access endpoints, CORS origins, and session registry bindings are identical.
- Standalone browser runtime-plan tests must prove `browserVisibleOrigin` and
  `apiTargetOrigin` are distinct only for `dev-server-proxy`, browser SDK URLs
  resolve to the former, and production `gateway-static` resolves both to
  `application.public-ingress`.
- Topology validation must reject a standalone browser client without matching
  browser delivery evidence, a non-same-origin mode, a non-application API
  surface, architecture drift, any absolute browser SDK Base URL, a proxy that
  does not preserve canonical paths, or a production static delivery without
  gateway host, app-owned build output, runtime root, root mount, and SPA
  fallback evidence.
- Single HTTP ingress checks must pass:
  `node ../sdkwork-specs/tools/check-single-http-ingress.mjs --root .` per
  application root and
  `node ../sdkwork-specs/tools/audit-single-http-ingress-workspace.mjs --workspace ..`
  across SDKWork application repositories.
- API assembly and application cloud-gateway boundary checks must pass per
  `API_ASSEMBLY_SPEC.md`.

## 12. Retirement Policy

Unreleased applications delete retired keys, binaries, and docs. No aliases or
bridges are allowed in application code. Compatibility aliases are allowed only
inside an approved migration tool and must normalize to `deploymentProfile`,
`runtimeTarget`, `environment`, and the v5 profile id before application code
sees them.
