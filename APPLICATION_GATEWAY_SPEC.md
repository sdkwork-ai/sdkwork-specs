# Application Gateway Standard

- Version: 2.5
- Scope: application standalone and platform cloud HTTP gateway hosts, listener ownership, naming, topology binding, thin-host boundaries, pnpm commands, migration, and verification
- Related: `API_ASSEMBLY_SPEC.md`, `NAMING_SPEC.md` section 4.3.1, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_NAMING.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `COMPONENT_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `MIGRATION_SPEC.md`, `TEST_SPEC.md`

This standard owns HTTP gateway processes and listener behavior. API route,
service, repository, permission, and OpenAPI composition belongs to
`API_ASSEMBLY_SPEC.md`.

## 1. Gateway Roles

SDKWork defines exactly two generic HTTP gateway roles:

| Role | Canonical crate | Owner | Deployment profile | Surface |
| --- | --- | --- | --- | --- |
| Application standalone gateway | `sdkwork-api-<application-code>-standalone-gateway` | Application repository | `standalone` | `application.public-ingress` |
| Platform cloud gateway | `sdkwork-api-cloud-gateway` | Platform gateway repository | `cloud` | Deployed application and platform HTTP ingress; optionally declared application realtime planes |

Rules:

- Application-level generic HTTP cloud gateways are retired.
- `sdkwork-api-cloud-gateway` is not an application component, dependency,
  local development sidecar, config bundle, or release artifact.
- The platform cloud gateway `MAY` host a declared application realtime plane
  (WebSocket upgrade on the HTTP listener plus declared client link
  transports) as an embedded dependency runtime surface. This mode requires
  the application topology declaration, the platform gateway's embedded
  realtime surface and Cargo feature, and `ADR-20260809-platform-gateway-realtime-hosting`.
  It does not change `application.public-ingress` surface identity or env
  keys, and it does not make the gateway an `edge`-plane process.
- Device or edge protocol ingress uses
  `sdkwork-<application-code>-<edge-capability>-edge-runtime`, declares topology
  role `edge-runtime`, and requires an ADR. It `MUST NOT` use the retired generic
  `sdkwork-<application-code>-cloud-gateway` identity, mount application HTTP API
  surfaces, or use gateway command namespaces.
- Bare `sdkwork-<application-code>-gateway` and `*-api-server` listener roles
  are retired.

## 2. Host And Capability Separation

Gateways are thin runtime hosts. Every application API capability reaches a
gateway through `sdkwork-api-<application-code>-assembly`.

```text
sdkwork-api-<application-code>-standalone-gateway --+
                                                     +-> sdkwork-api-<application-code>-assembly
sdkwork-api-cloud-gateway --------------------------+
```

Arrows mean "depends on". The two hosts are siblings; neither gateway depends
on or starts the other.

Gateway hosts own listener lifecycle, process-wide Web Framework
infrastructure, observability, topology materialization, assembly selection,
and cross-assembly collision validation. They do not own application route
aggregation, API bootstrap dependencies, OpenAPI authority, permission
catalogs, or SDK generation.

The host applies exactly one `sdkwork-web-framework` pipeline to the combined router and combined route manifest from all selected assemblies. Framework-owned CORS, authentication, authorization, tenant isolation, problem mapping, audit, and response identity `MUST NOT` be duplicated by gateway-local middleware.

`with_server_request_identity` and equivalent request-id-only helpers are not a Web Framework
integration. A gateway that dispatches into an embedded dependency router `MUST` preserve that
dependency's manifest and resolver/context injectors through the selected framework pipeline. It
`MUST NOT` merge or dispatch `assembly.router` while dropping the remaining assembly contract.

The only application building-block boundary visible to a gateway is the owner API assembly public
bootstrap defined by `API_ASSEMBLY_SPEC.md` section 4.1. The host may pass a process-shared database
pool, lifecycle environment/profile, topology context, and declared provider ports; it may not
construct the owner's service/repository/database graph. Serve startup and installer migration use
that same bootstrap so standalone and cloud hosts cannot drift into separate module catalogs.

### 2.1 Vocabulary Discipline

These terms are not interchangeable:

| Term | Meaning | Valid consumer reference |
| --- | --- | --- |
| API surface | Client-visible URL contract and endpoint provenance | `application.public-ingress` or `platform.api-gateway` |
| API assembly | Host-neutral application API capability library | `sdkwork-api-<application-code>-assembly` |
| Application standalone gateway | Application-owned standalone HTTP process | `sdkwork-api-<application-code>-standalone-gateway` |
| Platform cloud gateway | Platform-owned cloud HTTP process | `sdkwork-api-cloud-gateway` |
| Gateway host | A statement that intentionally applies to both canonical process roles | No client/runtime-config identity |
| Browser-visible origin | Origin used by the page and browser network requests | `browserDeliveries[].originMode` and the resolved `browserVisibleOrigin` |
| API target origin | Internal or public origin that receives proxied API traffic | Resolved `browserDeliveries[].apiTargetOrigin` |

Active standards, manifests, and application documentation `MUST NOT` use
bare phrases such as "the gateway", "shared gateway", or "SDKWork API
gateway" when one exact role or surface is intended. Application config and
composition output name API surfaces and URL provenance, never a remote
gateway implementation. `integration.foundationApiGateway` is retired; its
facts belong to topology surfaces, `sdkDependencies`, and
`dependencyApiSurfaces`.

### 2.2 Gateway Transparency And Canonical Paths

Gateways and development proxies are transport infrastructure. They select an
upstream, apply process infrastructure, and enforce route precedence; they do
not change SDKWork API identity.

Rules:

- Gateway hosts, reverse proxies, browser dev servers, and platform API edges
  `MUST` preserve the client-visible canonical API paths defined in
  `API_SPEC.md` section 4.1.1.
- Infrastructure selector prefixes such as `/__sdkwork/platform`,
  `/proxy/platform`, `/gateway/platform`, or `/platform/app/v3/api` `MUST NOT`
  appear in public runtime config, generated SDK base URLs, documentation
  examples, browser network traces, or client-visible API contracts.
- A standalone development profile with a browser client `MUST` expose one
  browser-visible origin through its declared `dev-server-proxy` delivery. The
  dev server `MUST` route application-owned and dependency-owned APIs by
  canonical path precedence: exact and dependency-owned route namespaces first,
  then broad application-owned surface fallbacks such as `/app`, `/backend`, or
  open-api prefixes. Canonical `/openapi.json`, `/healthz`, `/readyz`, `/livez`,
  and `/metrics` paths are forwarded without a synthetic proxy prefix.
- A proxy target, upstream URL, or connectivity plane name may be configured
  privately in Node/server runtime config, but it must not be encoded into the
  client-visible request URI.
- Gateway route registries and component `apiSurfaces` inventories `MUST` list
  every canonical prefix owned by each selected API authority. If one authority
  owns multiple prefixes, such as `/app/v3/api/assets` and
  `/app/v3/api/drive`, every prefix maps to the same authority/service identity;
  a broad `/app/v3/api` fallback or one listed sibling prefix does not cover the
  omitted prefix.
- Contract verification `MUST` compare the registry prefixes for an authority
  with its declared `apiPrefixes` and executable/OpenAPI route inventory. A
  router that is mounted but unreachable because its canonical prefix is absent
  from registry selection is a startup or test failure, not a request-time
  `502`.

### 2.3 Embedded Dependency Consumption Is In-Process

A gateway process that embeds a dependency API assembly owns that dependency's
capabilities in-process. Embedded selection is a direct backend integration,
not an HTTP forwarding relationship.

Rules:

- A module running inside a gateway process `MUST` consume the capabilities of
  an assembly mounted in the same process through a declared in-process port
  (service, provider, or host adapter port) wired by the composition root per
  `COMPOSABLE_ARCHITECTURE_SPEC.md` section 3. The consumer `MUST NOT` reach
  the embedded capability by issuing HTTP requests to the gateway's own
  listener (loopback self-forwarding).
- A gateway process `MUST NOT` require per-dependency base URL variables such
  as `SDKWORK_<APPLICATION_CODE>_<DEPENDENCY>_BACKEND_API_BASE_URL` for
  embedded consumption, and `MUST NOT` default them to the gateway's own
  origin. That env family applies only when the selected deployment profile
  places the dependency in a separate process: standalone external mode, or a
  cloud `platform.api-gateway` upstream.
- Same-process consumption `MUST NOT` require IAM service credentials whose
  only purpose is to authenticate a loopback request to the gateway's own
  protected surface. Authorization for in-process consumption is enforced by
  the port contract and the composition root, not by re-entering the HTTP
  authentication stack.
- A retry loop that waits for the gateway's own listener to become ready
  before an embedded consumer can invoke a mounted dependency is a violation
  symptom: it proves the consumer is using loopback HTTP instead of an
  in-process port. Startup order between the listener and embedded capability
  wiring `MUST NOT` be a functional dependency.
- Dual-token backend surfaces remain the contract for every real HTTP client
  (browser, app SDK, backend-admin SDK, external service). In-process ports do
  not replace the HTTP surface; they are the internal consumer path that keeps
  the surface free of self-originated traffic.
- `component.spec.json` dependency surfaces keep declaring in-process
  integration coverage with the existing `coverage` field. A deployment that
  runs the dependency in a separate process switches the consumer to the
  generated dependency SDK / declared base URL contract and `MUST` provide
  that base URL; a deployment that embeds the assembly `MUST` wire the
  declared port.

Verification: gateway repositories `SHOULD` fail static checks when a consumer
of an embedded dependency surface constructs an HTTP client whose resolved
base URL is the gateway's own bind/origin, and runtime smoke checks `MUST`
start the gateway without any retry-on-own-listener log pattern.

`tools/check-embedded-self-loop.mjs --workspace <root>` is the workspace gate
for this section. It reads every repository's deployment profiles and Cargo
manifests and fails on three conditions:

- `SELF-LOOP` — a deployment profile declares a dependency base URL whose
  authority resolves to this application's own ingress.
- `EMBEDDED-LOCAL-DEP` — a dependency base URL resolves to another SDKWork
  module's ingress while this repository already compiles that module's API
  assembly in-process.
- `EMBEDDED-DECLARED-URL` — the repository compiles module `M` in-process and
  still declares a loopback base URL naming `M`. A routable external origin is
  allowed: that is the documented escape hatch for a dependency deployed as a
  separate process.

Browser-facing variables (`VITE_*`, `*_BROWSER_*`, `*_DEV_PROXY_*`, desktop app
origins) are out of scope: a browser talking to a server is a real network hop.
The validation logic lives in `tools/lib/embedded-self-loop.mjs` so it can be
unit tested and reused by other gates.

The gate reads every deployment profile it can find, because a loopback
default hides in whichever file a profile happens to use:

- `etc/`, `docker/`, `deployments/`, `container/` dotenv files and `demo.env`;
- `docker-compose*.yml` `environment:` blocks — including `${VAR:-default}`
  compose interpolation, since the default is what runs when an operator sets
  nothing;
- runtime TOML `bind = "host:port"` declarations, because the platform gateway
  declares its ingress there rather than as an environment variable, so an
  env-only scan sees no owner and silently skips the repository.

## 3. Standalone Application Gateway

Every application root has one canonical standalone host:

```text
crates/sdkwork-api-<application-code>-standalone-gateway/
```

It terminates `application.public-ingress` for `standalone.*`, consumes the
application API assembly and explicitly selected dependency assemblies, starts
as the sole application HTTP listener for `pnpm dev`, and mounts process
infrastructure exactly once.

It `MUST NOT` depend on, resolve, or start `sdkwork-api-cloud-gateway`; depend
directly on application route crates; duplicate assembly-owned implementation
dependencies; or start per-surface HTTP sidecars.

The selected standalone profile `MUST` determine whether each dependency surface is embedded through its dependency assembly or external through an explicit platform/dependency URL. The gateway fails startup when the profile selects embedded mode without an executable dependency assembly, or external mode without a resolvable upstream/base URL.

An embedded owner contribution that reads filesystem runtime assets `MUST`
receive an explicit owner-scoped runtime root from the application package.
The package contains the dependency-owned database manifests, migrations,
registry/module contracts, and other startup-required assets selected by that
owner. Production startup and release smoke tests `MUST NOT` resolve those
assets from sibling source repositories or compile-time source paths.

For a production `gateway-static` browser delivery, the standalone gateway
also serves the declared built browser asset root. API/OpenAPI/health/operations
routes `MUST` be matched before static assets, and static assets `MUST` be
matched before the `/index.html` SPA fallback. A production browser delivery
fails startup or readiness when its declared runtime asset root or index file
is missing; it must not silently degrade into an API-only `404` application.

## 4. Platform Cloud Gateway

`sdkwork-api-cloud-gateway` is owned only by the platform gateway repository.
It consumes approved API assemblies from the platform side and exposes their
HTTP capabilities in deployed cloud topology.

Application repositories publish assembly contracts; they do not configure
the platform host. Assembly registration, selection, rollout, routing, and
cloud host config live in the platform gateway or platform deployment
authority. Cross-assembly route collisions are validated before bind and
process infrastructure is mounted once.

The platform cloud gateway `MAY` host a declared application realtime plane as
an embedded dependency runtime surface per `APP_RUNTIME_TOPOLOGY_SPEC.md`
section 3 and `ADR-20260809-platform-gateway-realtime-hosting`. The WebSocket
upgrade shares the gateway's single HTTP listener; client link transports
(TCP, UDP, QUIC) are additional non-HTTP listeners owned by the embedded
realtime plane, spawned only when the application declares their binds, and
never mount HTTP API surfaces. The gateway keeps exactly one HTTP ingress
(section 5) and is not an `edge`-plane or `edge-runtime` process.

## 5. Single HTTP Ingress

Standalone application development and deployment allows exactly one
application-plane **API** listener:

```text
sdkwork-api-<application-code>-standalone-gateway
```

`app-api`, `backend-api`, and `open-api` are route surfaces, not listener
processes. Route crates and service-host packages may remain build/test units,
but default standalone orchestration `MUST NOT` start them as HTTP sidecars.
An assembly may count a route surface as served only when its mount contributes
an executable `axum::Router`; route manifests and descriptors never establish
runtime HTTP capability by themselves.

A Vite or equivalent development renderer may own a second internal HTTP
listener as a `client` process. That listener is not another API host: the
browser sees it as the sole page/API origin, and it forwards canonical API
paths to the one standalone gateway listener declared as its `apiTargetOrigin`.
Production `gateway-static` delivery removes that renderer listener and serves
the page and APIs through the application ingress itself.

An RPC, gRPC, worker, or service host that has no application HTTP API may own
an operations-only listener for canonical `/healthz`, `/readyz`, and `/metrics`
endpoints when its topology declares that operations surface. Such a listener
is not `application.public-ingress`, does not make the application assembly
`served`, and must be composed through `sdkwork-web-bootstrap`. It must not
mount business routes or become a second application-plane HTTP ingress.

A gateway or standalone host that embeds a declared application realtime plane
owns exactly one HTTP ingress (the WebSocket upgrade path rides that listener)
and `MAY` additionally own the application's declared client link transport
listeners (TCP, UDP, QUIC) as non-HTTP sockets spawned by the embedded
realtime plane. Link transport binds are server-side declarations of the
application realtime surface (`APP_RUNTIME_TOPOLOGY_SPEC.md` section 4), are
not HTTP listeners, and `MUST NOT` be counted as HTTP ingress for this
section.

Cloud development is remote-client-only. `cloud.development` starts no local
standalone gateway, platform gateway, API listener, data service, migration,
seed, or deployed-service worker.

## 6. Repository Layout

Application repository:

```text
crates/
  sdkwork-api-<application-code>-assembly/
  sdkwork-api-<application-code>-standalone-gateway/
  sdkwork-routes-<capability>-app-api/
  sdkwork-routes-<capability>-backend-api/
  sdkwork-routes-<capability>-open-api/
```

Platform gateway repository:

```text
crates/
  sdkwork-api-cloud-gateway/
  sdkwork-api-cloud-gateway-config/
  sdkwork-api-cloud-gateway-registry/
  sdkwork-api-cloud-gateway-observability/
```

Application repositories `MUST NOT` contain the platform gateway crate,
platform gateway TOML files, or platform gateway packaging assets.

## 7. Component Contracts

| Component | Type | Required dependency |
| --- | --- | --- |
| API assembly | `rust-api-assembly` | Application-owned route/service/repository graph |
| Standalone gateway | `rust-api-standalone-gateway` | `sdkwork-api-<application-code>-assembly` |
| Platform cloud gateway | `rust-platform-cloud-gateway` | Approved API assembly set or upstream registry |

Standalone gateway component contracts additionally declare required ports for every selected
dependency assembly and matching `dependencyApiSurfaces` entries. A dependency assembly export
remains provider-owned: the gateway lists it in `requiredPorts`, never in the gateway's own
`publicExports`. Direct route, service, repository, provider-adapter, or database-host
implementation dependencies and undeclared same-origin mounts are invalid even when they compile;
process-wide Web Framework, database-pool, topology, listener, and explicit host-adapter
dependencies remain valid thin-host infrastructure.

The platform cloud gateway component additionally declares
`gatewayIntegration.assemblyIntegrationPoint`, including the context, bootstrap, runtime bundle,
contribution type, and `databaseLifecycleOwner: "sdkwork-api-<application-code>-assembly"`.
Every component dependency surface that selects an assembly aligns its Cargo feature,
`cargoDependency`, and executable export with that single integration point.

## 8. Pnpm Commands

Application roots expose `api:assembly:materialize`,
`api:assembly:validate`, and only `gateway:*:standalone` commands. The
standalone commands target `sdkwork-api-<application-code>-standalone-gateway`.

The canonical onboarding and readiness sequence is defined by
`API_ASSEMBLY_SPEC.md` section 7.1. Assembly bootstrap does not imply standalone
host readiness; `audit-gateway-alignment-repo.mjs --root . --strict` is the
host completion gate.

Only the `sdkwork-api-cloud-gateway` repository exposes
`gateway:run:cloud`, `gateway:build:cloud`, `gateway:package:cloud`, and
`gateway:validate:cloud`.

## 9. Topology Binding

Application topology declares its standalone gateway and surface-oriented
remote URLs. It does not declare a cloud gateway crate, binary, repository,
owner, bind variable, config path, or autostart flag.

Renderer bind/port, access endpoint, SDK base URL, browser delivery, CORS origin, credential-entry bootstrap handoff, and gateway bind `MUST` resolve from the same runtime plan. Package scripts may consume the resolved values but must not override them with hard-coded ports.

For standalone production, `application.public-ingress` is the browser-visible
page and API origin. During standalone development, a declared client dev
server may be the browser-visible origin while
`application.public-ingress` remains its internal API target. Same-origin
dependency assemblies run inside that gateway process, so standalone profile
files and materialized client config `MUST NOT` resolve
`platform.api-gateway`, set its public/Vite URL keys, point dependency SDKs at
a second local port, or expose the internal API target origin to browser code.
`platform.api-gateway` URL resolution is cloud-profile-only.

Canonical roles are `api-standalone-gateway` in an application topology and
`platform-cloud-gateway` in the platform gateway topology. Application client
config points to deployed API URLs without identifying the cloud gateway
implementation.

## 10. Migration

| Retired | Replacement |
| --- | --- |
| `sdkwork-<application-code>-gateway-assembly` | `sdkwork-api-<application-code>-assembly` |
| `sdkwork-<application-code>-standalone-gateway` | `sdkwork-api-<application-code>-standalone-gateway` |
| `sdkwork-<application-code>-cloud-gateway` | Platform-hosted assembly or responsibility-specific edge ingress |
| `sdkwork-<application-code>-api-server` | `sdkwork-api-<application-code>-standalone-gateway` |
| `gateway:assembly:*` | `api:assembly:*` |

Migration must materialize and validate the API assembly before removing the
old host. Rollback may return validation to audit mode but must not restore
application ownership or autostart of `sdkwork-api-cloud-gateway`.

## 11. Verification

Run application checks from the selected application root:

```text
node ../sdkwork-specs/tools/validate-api-assembly.mjs --root .
node ../sdkwork-specs/tools/check-application-cloud-gateway-boundary.mjs --root .
node ../sdkwork-specs/tools/check-single-http-ingress.mjs --root .
node ../sdkwork-specs/tools/scan-duplicate-gateway-api-deps.mjs --root .
node ../sdkwork-specs/tools/check-route-path-collisions.mjs --root .
node ../sdkwork-specs/tools/check-api-runtime-parity.mjs --root .
```

## 12. Acceptance Checklist

- [ ] Application HTTP APIs enter hosts only through API assemblies.
- [ ] Application standalone gateway uses the canonical `sdkwork-api-*` name.
- [ ] Applications do not depend on, start, configure, or package cloud gateway.
- [ ] Platform cloud gateway consumes assemblies from the platform side.
- [ ] Gateway hosts are thin and mount process infrastructure once.
- [ ] All selected application/dependency routers are merged before one Web Framework layer; no API router or duplicate CORS/auth middleware is added afterward.
- [ ] Served OpenAPI is built from the same selected assembly contributions and auth profiles as the executable router.
- [ ] Standalone has one application API listener; an optional development
      renderer listener is declared only as client tooling behind one
      browser-visible origin.
- [ ] A standalone browser client declares same-origin development proxy and
      production static/SPA delivery evidence for every selected architecture.
- [ ] Browser SDK URLs use the browser-visible origin; internal development API
      targets remain private to the dev-server process.
- [ ] Cloud development starts no local API-plane process.
- [ ] Embedded dependency capabilities are consumed in-process through declared ports; no embedded consumer loop-calls the gateway's own listener, and no per-dependency base URL is required or defaulted to the gateway origin for embedded selection (`APPLICATION_GATEWAY_SPEC.md` section 2.3).
