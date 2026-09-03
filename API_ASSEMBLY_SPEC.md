# API Assembly Standard

- Version: 1.3
- Scope: application-owned HTTP API composition, host-neutral assembly crates, route-surface completeness, gateway dependency direction, manifests, pnpm commands, migration, and verification
- Related: `APPLICATION_GATEWAY_SPEC.md`, `APPLICATION_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_PERMISSION_COMPOSITION_SPEC.md`, `COMPOSABLE_ARCHITECTURE_SPEC.md`, `COMPONENT_SPEC.md`, `NAMING_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `MIGRATION_SPEC.md`, `TEST_SPEC.md`

This standard is the normative authority for assembling SDKWork HTTP APIs into
runtime hosts. `APPLICATION_GATEWAY_SPEC.md` owns gateway processes and
listeners; this file owns the API capability graph mounted by those hosts.

## 1. Core Model

Every SDKWork application root owns exactly one application API assembly:

```text
sdkwork-api-<application-code>-assembly
```

The assembly is a host-neutral library. It collects every application-owned
`app-api`, `backend-api`, and `open-api` route surface and exports one typed API
composition contract. The same assembly is consumed by:

- `sdkwork-api-<application-code>-standalone-gateway` for standalone runtime;
- `sdkwork-api-cloud-gateway` for platform cloud runtime.

Build and runtime dependency direction is fixed; arrows mean "depends on":

```text
gateway host -> api-assembly -> route -> service/repository graph
```

Rules:

- Application roots `MUST NOT` depend on, build, start, configure, package, or
  publish `sdkwork-api-cloud-gateway`.
- `sdkwork-api-cloud-gateway` `MAY` consume application API assemblies from the
  platform gateway repository or its governed workspace composition.
- API assemblies `MUST NOT` depend on application standalone or platform cloud
  gateway crates.
- Route crates `MUST NOT` depend on gateway hosts.
- Gateway hosts `MUST NOT` bypass assemblies by mounting application-owned
  route crates directly.
- An application that intentionally exposes no HTTP APIs `MUST` still publish
  an empty assembly manifest with `apiMode: none`; absence of the assembly is
  not a valid no-API declaration.
- Process infrastructure endpoints are not application API surfaces. A gRPC,
  RPC, worker, or service host `MAY` expose only the canonical `/healthz`,
  `/readyz`, and `/metrics` operations endpoints through
  `sdkwork-web-bootstrap` without changing `apiMode: none`. This exception does
  not authorize business handlers, arbitrary probe aliases, dynamic route
  paths, or app/backend/open API routes in that host. The first
  non-infrastructure HTTP route requires a canonical route crate and
  `apiMode: served`.

## 2. Naming And Placement

Canonical Rust package and crate placement:

```text
crates/sdkwork-api-<application-code>-assembly/
  Cargo.toml
  assembly-manifest.json
  specs/component.spec.json
  src/lib.rs
```

Canonical identities:

| Role | Identity |
| --- | --- |
| API assembly package | `sdkwork-api-<application-code>-assembly` |
| Rust library | `sdkwork_api_<application_code>_assembly` |
| Component type | `rust-api-assembly` |
| Component layer role | `runtime-composition` |
| Manifest kind | `sdkwork.api.assembly` |
| Script namespace | `api:assembly:*` |

The selected application root directory is the application-code authority for
API assembly naming and `MUST` be `sdkwork-<application-code>`. An enclosing
repository may have a different identity, but `app.key`, `backend.appId`,
product name, process name, and repository stem `MUST NOT` silently rename the
assembly. Tools fail closed when the selected application root is not
canonical; move/select the canonical application root before bootstrapping.

The component contract `MUST` use `component.type: "rust-api-assembly"`,
`component.capability: "api-assembly"`, `component.surface: "api-assembly"`,
and `contracts.layerRole: "runtime-composition"`. These fields classify
different dimensions and are not interchangeable; `api-assembly` `MUST NOT`
be used as a `layerRole`.

Retired identities:

- `sdkwork-<application-code>-gateway-assembly`;
- `sdkwork.gateway.assembly`;
- `gateway:assembly:*`;
- application-owned `sdkwork-<application-code>-cloud-gateway`.

Retired identities may appear only in migration records, compatibility-window
input handling, and negative test fixtures. New or materialized source `MUST`
use the canonical API assembly identity.

## 3. Ownership And Completeness

The application API assembly owns the complete set of application-authored
HTTP route crates, regardless of capability token. Discovery authority order:

1. route `specs/component.spec.json` identity and ownership;
2. route manifest surface and authority metadata;
3. Cargo workspace/package metadata as a consistency check;
4. package-name inference only as migration diagnostics.

Rules:

- Every application-owned route crate `MUST` be included exactly once.
- Every included route crate `MUST` declare exactly one of `app-api`,
  `backend-api`, or `open-api`.
- Every served route crate `gateway_mount` `MUST` return an executable
  `axum::Router`, either directly or through `Result<Router, E>`. Route
  manifests, descriptor collections, OpenAPI metadata, and an empty
  `Router::new()` are inventory contributions, not executable mounts, and
  `MUST NOT` use the `gateway_mount` name or satisfy `apiMode: served`.
- Route ownership `MUST NOT` be inferred solely from an
  `sdkwork-routes-<application-code>-*` package prefix; aggregate application
  repositories may own capability-named route crates.
- Dependency-owned routes remain in the dependency application's assembly.
  Applications and gateways compose dependency assemblies; they do not copy
  dependency route crates into the consuming application's assembly.
- A consuming application assembly `MUST NOT` import dependency route crates to make a dependency surface executable. The selected gateway host composes dependency-owned assembly contributions through dependency-owned public assembly entrypoints.
- Dependency assembly selection is deployment-profile specific and must agree with `dependencyApiSurfaces`: an embedded/same-origin surface selects the dependency assembly; an external platform surface selects no local assembly and requires its declared base URL/upstream.
- Normalized `(surface, method, path)` identities `MUST` be unique inside an
  assembly and across every set of assemblies mounted by one gateway.
- Permission, request-context, OpenAPI authority, and response-envelope rules
  remain identical in standalone and cloud hosts.

## 4. Assembly Contract

An API assembly exports host-neutral composition contributions:

- application business router;
- route manifest inventory;
- OpenAPI document contributions;
- permission catalog contributions;
- bootstrap dependency requirements;
- readiness contributions without public probe-path ownership.

Each contribution `MUST` describe the same normalized route inventory across its executable router, `HttpRouteManifest`, OpenAPI operations, permissions, and ownership metadata. A contribution is invalid when any one of those inventories is missing, stale, or contradictory.

The canonical Rust entrypoint is:

```rust
pub async fn assemble_api_router(
    context: ApiAssemblyContext,
) -> Result<ApiAssembly, ApiAssemblyError>;
```

An assembly `MAY` additionally export `assemble_api_business_router` for a
multi-assembly host that mounts process infrastructure once. Exported types
`MUST` be host-neutral and `MUST NOT` contain listener bind addresses,
standalone/cloud selection, process supervision, TLS termination, or gateway
repository paths.

The assembly owns application service/repository wiring needed to construct
its APIs. Gateways own listener lifecycle, process-wide Web Framework
infrastructure, observability, shutdown, and topology materialization.

Before a gateway installs the Web Framework layer, it `MUST` merge all selected application and dependency contributions, reject route/profile collisions, bind the combined manifest, and build the served OpenAPI from those same selected contributions. No API router may be merged after framework installation.

An assembly contribution is an indivisible runtime contract. A consumer `MUST NOT` project only
its `router` field, call a deprecated router-only entrypoint, or otherwise discard its route
manifest, OpenAPI contribution, permission catalog, domain context injectors, or readiness check.
An owner assembly that must retain process-lifetime workers `MAY` return a host-neutral runtime
bundle whose public `contribution` field has the exact `ApiAssemblyContribution` type. The bundle
does not weaken contribution completeness: consumers `MUST` pass that field intact into profile
composition, while runtime sidecars remain owner-defined lifecycle handles and `MUST NOT` own an
HTTP listener or install Web Framework infrastructure.
When a host selects a dependency assembly, tests `MUST` prove that a matched dependency error
contains the dependency operation's `instance` and `operationId`; an HTTP status or successful
handler dispatch alone is insufficient integration evidence.

The Web Framework route-manifest contract `MUST` support owned or reference-counted combined route
inventories. Assemblies and gateways `MUST NOT` use `Box::leak`, leaked allocations, process-lifetime
global mutation, or source parsing to coerce a runtime-composed manifest into a `'static` slice.
Static route-crate manifests and runtime-composed manifests use the same validation and binding API.

### 4.1 Building-Block Integration Point

Every served owner assembly `MUST` expose one canonical building-block integration point used by
both its standalone gateway and the platform cloud gateway:

```text
gateway-owned ApiAssemblyContext
  -> owner sdkwork-api-<application-code>-assembly bootstrap
     -> owner database/module lifecycle
     -> owner service/repository/provider construction
     -> ApiAssemblyRuntime
        -> indivisible ApiAssemblyContribution
        -> owner-retained workers and graceful-shutdown handles
```

`ApiAssemblyContext` contains only process-shared, host-neutral inputs such as `DatabasePool`, the
selected lifecycle environment/profile, topology values, and explicitly declared provider ports.
`ApiAssemblyRuntime` is the owner-defined lifetime bundle when the contribution alone is
insufficient; it `MUST` expose the complete `ApiAssemblyContribution` without requiring consumers
to reconstruct owner state.

Rules:

- The owner assembly manages its route, service, repository, database migration/bootstrap,
  readiness, provider adapters, and retained runtime handles behind this public bootstrap.
- A gateway provides process resources and topology context. It `MUST NOT` depend directly on or
  invoke owner `sdkwork-routes-*`, `sdkwork-*-service`, `sdkwork-*-service-host`,
  `sdkwork-*-repository-*`, `sdkwork-*-provider-*-adapter`, or `sdkwork-*-database-host` crates.
- Runtime startup, explicit migration/install, and release smoke tests `MUST` enter through the
  same owner bootstrap contract. A gateway-local database module catalog or parallel migration
  switch is forbidden.
- Each platform `foundation-*` feature that selects an HTTP owner declares exactly one direct
  `sdkwork-api-<application-code>-assembly`; component dependency surfaces, Cargo feature wiring,
  and the called executable export `MUST` agree.
- Responsibility-specific process adapters such as the one Web Framework IAM resolver or a
  separately governed realtime plane remain gateway-owned only when they are not owner API
  construction dependencies and their exception is explicit in the component/topology contract.
- Owner assembly bootstrap paths `MUST NOT` call `service_router`, a generic single-router
  `wrap_router_with_web_framework*`, `ComposedApiAssembly::into_hosted`, or an equivalent process
  infrastructure wrapper around the complete owner router. They return host-neutral business
  routers inside the complete contribution; the selected standalone/cloud host composes every
  contribution and installs the one process Web Framework pipeline. A specialized route-local
  security layer that requires explicit machine-credential collaborators is not a substitute for
  that process pipeline and requires a component security contract plus human review.
- When an owner assembly requires another module's lifecycle or same-origin routes, the owner
  assembly declares that dependency as a required assembly port, passes the same host context or
  process pool into the dependency assembly, and invokes its public bootstrap before constructing
  dependent routes. The gateway still selects only the top-level owner and `MUST NOT` duplicate the
  nested dependency lifecycle. The owner component contract and process-pool contract record the
  dependency assembly, ordering, profile coverage, and executable evidence.

The canonical gate is:

```text
node ../sdkwork-specs/tools/check-api-assembly-integration-closure.mjs --root .
node ../sdkwork-specs/tools/check-api-assembly-integration-closure.mjs --root . --strict-standalone-hosting
node ../sdkwork-specs/tools/check-api-assembly-integration-closure.mjs --root . --strict-selected-standalone-parity
```

The first command enforces dependency and lifecycle ownership during staged migration. Standalone
release candidates additionally run the strict command, which rejects router-only projections and
requires the complete contribution to pass through `ComposedApiAssembly::try_compose(...).into_hosted(...)`.
Strict mode also requires the standalone crate's own `specs/component.spec.json`, matching component
identity/type, non-empty runtime entrypoints, and one `requiredPorts` declaration for every direct
owner assembly dependency. Each required assembly port names the exact executable `crate::function`
entrypoint, and the standalone source calls that declared export. The same gate rejects owner
assembly bootstrap calls that pre-install Web Framework or process service-router infrastructure.
Platform release candidates run `--strict-selected-standalone-parity`; it resolves every owner
workspace selected by the cloud gateway component contract, requires that workspace's standalone
gateway, and applies the same complete-hosting checks. Unrelated workspace applications do not
block that application-scoped release gate.

### 4.1.1 Module Registry Composition (`addModule` / `addModules`)

The canonical host-side integration front door is the Web Framework module
registry `ApiModuleRegistry` (`sdkwork_web_bootstrap::ApiModuleRegistry`). It is
the framework-level equivalent of FastAPI `include_router` / NestJS
`addModule`: every served module contributes one indivisible
`ApiAssemblyContribution` (router + route manifest + OpenAPI + permission
catalog + domain injectors + readiness) and the host registers those
contributions by owner.

#### Module Definition (`WebModule`)

A module is one application's complete, independently installable HTTP
definition — the SDKWork equivalent of a FastAPI `APIRouter` bundle or a NestJS
module. `WebModule` (`sdkwork_web_bootstrap::WebModule`) bundles an owner
identity, a title, and every surface contribution the module serves:

- **One contribution per served owner.** A module's app-api, backend-api and
  other business surfaces owned by the same application belong to a single
  indivisible `ApiAssemblyContribution`; a separately served owner (for example
  an anonymous open surface contributed as `sdkwork-<code>-open`) is a second
  contribution inside the same module.
- **The module owns its surfaces; the host installs the module.** Hosts never
  assemble a module's routes surface by surface — they call
  `add_module(WebModule)` once per module.
- Each served owner assembly `MUST` export the canonical module factory
  `web_module()` next to its contribution factories, plus the composition
  variant its host profiles require:

  ```rust
  // Canonical: bootstraps the module's own dependencies from the process
  // environment and returns its complete surface set. Always required.
  pub async fn web_module() -> Result<WebModule, String>;

  // Platform cloud gateway profile: composes on the process-shared pool.
  // Required whenever `assemble_api_router_with_pool` is exported.
  pub async fn web_module_with_pool(pool: DatabasePool) -> Result<WebModule, String>;

  // Host-supplied state profiles. Used when the module cannot bootstrap itself
  // from the environment alone; `web_module()` delegates to these.
  pub async fn web_module_with_context(context: ApiAssemblyContext) -> Result<WebModule, String>;
  pub fn web_module_with_state(state: Arc<…State>) -> Result<WebModule, String>;
  pub async fn web_module_with_config(config: &…Config) -> Result<WebModule, String>;
  ```

  The factory returns a `WebModule` built from the owner's complete
  contribution set (every selected surface). Existing per-surface contribution
  factories stay available for federated hosts; new host integrations `MUST`
  install the module.

- `web_module()` `MUST NOT` reach another process over HTTP to obtain its own
  routes (§2.3 of `APPLICATION_GATEWAY_SPEC.md`). A module that needs runtime
  state opens it in-process — from the environment, from the process-shared
  pool, or from caller-supplied state — and never forwards to its own listener.
- An assembly that owns no HTTP surface of its own (a pure dependency
  composition such as `sdkwork-games`) `MUST` still export `web_module()`; the
  module is then the set of dependency-owned contributions it composes, and its
  documentation `MUST` state that the owner contributes no routes itself.
- An application declared with `"apiMode": "none"` and an empty `routeCrates`
  list (`sdkwork-audio`, `sdkwork-video`, `sdkwork-tts`, `sdkwork-terminal`,
  `sdkwork-codebox`, …) still `MUST` export `web_module()`. Such a module serves
  an empty router, but it is not an empty *object*: it carries the owner
  identity, the title, an empty route manifest, an OpenAPI document, a
  permission catalog and a readiness check, so every host publishes the same
  contract. `ApiAssembly` `MUST` be a type alias for `ApiAssemblyContribution`
  and the assembly `MUST` be built through `ApiAssemblyContribution::from_manifest`
  (the `sdkwork-birdcoder2` shape):

  ```rust
  pub type ApiAssembly = ApiAssemblyContribution;

  pub fn assemble_api_router() -> ApiAssembly {
      ApiAssemblyContribution::from_manifest(
          "sdkwork-<code>",
          "SDKWork <Title> API",
          Router::new(),
          HttpRouteManifest::from_owned_routes(Vec::new()),
          Vec::new(),
          std::sync::Arc::new(sdkwork_web_bootstrap::AlwaysReady),
      )
      .unwrap_or_else(|error| panic!("sdkwork-<code> API assembly failed: {error}"))
  }

  pub fn web_module() -> Result<WebModule, String> {
      Ok(WebModule::from_contribution(assemble_api_router()))
  }
  ```

  Declaring `pub struct ApiAssembly { pub router: Router }` and feeding that
  struct to `WebModule::from_contribution` is a contract violation: the struct
  carries no manifest, OpenAPI document, permission catalog or readiness check.
  `tools/check-web-module-contribution-projection.mjs` fails both shapes.

#### Export Completeness

The assembly crate is the module's public contract, so `lib.rs` `MUST`
re-export every factory the module's own hosts import. Generated `lib.rs`
templates start from the canonical name list only, and hand-written standalone
gateways routinely import additional factories
(`assemble_api_router_from_env`, `assemble_api_router_runtime`,
`build_router_from_business`, …). A missing re-export is an E0432/E0425 at the
host and a broken module contract, not a host bug:

- Every `pub` factory in `bootstrap.rs` that a host inside the same repository
  references `MUST` appear in the `pub use bootstrap::{…};` list.
- Hosts `MUST NOT` import a module-private path to work around a missing
  re-export.
- `tools/repair-missing-assembly-exports.mjs` reconstructs the list from
  compiler output when a template drops names.

#### Host Integration Form

Hosts install modules on one registry and then compose:

```rust
let mut module_registry = ApiModuleRegistry::new();
module_registry.add_modules(vec![web_module().await?]);
// …or add_module(web_module().await?) one module at a time
let app = module_registry
    .try_compose("SDKWork <App> API")?
    .into_hosted(framework)
    .router;
```

`ApiModuleRegistry::with_module` / `with_modules` are consuming builders for
the same registration, for hosts that compose in a single expression.

`try_compose` returns `Result<ComposedApiAssembly, String>`, so the composition
expression `MUST` carry exactly one error handler, and it `MUST` match the
enclosing function:

- In a function returning `Result` whose error converts from `String`
  (`Box<dyn Error>`, `anyhow::Error`, `String`, …): a trailing `?`, optionally
  preceded by one `.map_err(…)`.

  ```rust
  let composed = module_registry.try_compose("SDKWork <App> API")?;
  // or
  let composed = module_registry
      .try_compose("SDKWork <App> API")
      .map_err(std::io::Error::other)?;
  ```

- In a function returning `()` (for example `#[tokio::main] async fn main()`):
  `.expect(…)` / `.unwrap_or_else(…)` instead of `?`.

  ```rust
  let composed = module_registry
      .try_compose("SDKWork <App> API")
      .expect("<app> API composition failed");
  ```

Common violations, all rejected by the compiler and by review:

- `?` followed by another `Result` combinator
  (`try_compose(…)?.expect(…)` / `try_compose(…)?.map_err(…)?`) — `?` already
  unwraps, so `expect`/`map_err` resolve against `ComposedApiAssembly` (E0599).
- No handler at all, leaving a bare `Result` that the following code
  dereferences (`composed.route_manifest` → E0609).
- `?` inside a function that returns `()` (E0277).
- Dropping `let mut` from a binding whose field the host assigns afterwards
  (`composed.readiness_check = …` → E0594).

`tools/repair-try-compose-question-mark.mjs`,
`tools/repair-try-compose-propagation.mjs`,
`tools/repair-dropped-try-compose-result.mjs` and
`tools/repair-missing-mut.mjs` repair each of these from compiler output.

#### Verification

`tools/check-web-module-adoption.mjs --workspace <root> --strict` fails when any
served owner assembly is missing `web_module` (or `web_module_with_pool` while
exporting `assemble_api_router_with_pool`), or when any standalone gateway that
serves routes does not install them through
`ApiModuleRegistry::add_module`. `tools/migrate-web-modules.mjs` performs the
corresponding mechanical migration.

#### Registration Semantics

Rules:

- Standalone gateways and the platform cloud gateway `MUST` assemble served
  routes through one `ApiModuleRegistry`: `add_module` (or `add_modules`) for
  every selected module, then `try_compose(title)` (or
  `into_hosted(title, framework)`) to validate and bind. A bare
  `ApiAssemblyContribution` converts into a single-surface `WebModule`, so
  contribution-only dependencies keep working during migration. Direct
  `ComposedApiAssembly::try_compose` remains permitted for hosts that already
  validate contributions themselves, but new integration work `MUST` prefer the
  registry.
- **Duplicate registration is ignored, not fatal.** Registering the same owner
  more than once is tolerated: the first registration wins, later duplicates
  are skipped with a `tracing` warning and recorded in
  `ApiModuleRegistry::ignored_duplicates()`. This makes free composition of
  route modules idempotent — an application may be listed by two integration
  paths (for example as a direct host dependency and again through an
  aggregation module) without breaking composition.
- Module-level duplicate tolerance never relaxes §4.2.1 route-level
  uniqueness. Two *different* owners claiming the same normalized
  `(surface, method, path)` still fail `try_compose` closed.
- Registration order is composition order: the host `SHOULD` register its own
  contribution first, then dependency modules, so ownership tie-breaks and
  manifest ordering stay deterministic.
- The registry is host-side only. Owner assembly bootstrap paths `MUST NOT`
  construct or compose a registry (§4.1); they return host-neutral
  contributions.

The static closure gate accepts either composition front door:
`ApiModuleRegistry` with `add_module`/`try_compose`, or
`ComposedApiAssembly::try_compose` — both followed by `.into_hosted(...)`
(see `tools/check-api-assembly-integration-closure.mjs`).

## 4.2 Cross-Module Composition Dedup And Collision Resolution

Any host that composes multiple assemblies (the platform cloud gateway and any
standalone gateway that selects dependency assemblies) `MUST` guarantee that
every normalized `(surface, method, path)` identity is mounted exactly once.
This section owns the dedup, collision-resolution, and ownership rules for
multi-module composition. It applies to every combination of assemblies, so a
`platform-foundation-*` suite that enables multiple applications stays
collision-free without requiring every application to know the others.

### 4.2.1 Route Ownership Uniqueness

- Normalized `(surface, method, path)` identities `MUST` be unique across every
  set of assemblies mounted by one gateway host. Duplicates that reach runtime
  composition are composition errors (`ComposedApiAssembly::try_compose` fails
  closed on route collisions).
- The gateway `component.spec.json` `apiSurfaces` declaration is the ownership
  authority: the first declared surface whose prefix matches a route path is
  the **primary owner** of that route.
- A route declared by an assembly whose matching surface is not the primary
  owner is a **duplicate contribution**. Duplicate contributions `MUST NOT` be
  mounted; the host skips them and records a resolution entry for observability.
- Unresolved multi-owner routes fail both static checks and runtime
  composition. "Two applications happen to define the same path" is never a
  valid silent pass; it requires either an ownership decision in the gateway
  contract or a composition-surface exclusion (4.2.2).

### 4.2.2 Composition Surface Selection

An assembly `MAY` expose different route surfaces per composition context
through its `ApiAssemblyContext` (for example `cloud_gateway()` may expose only
the service-to-service `internal` surface while `default()` exposes the full
app/backend/internal business surface). This is the canonical mechanism for
keeping a complete business surface available to the standalone host while
excluding it from platform composition.

Rules:

- The assembly `MUST` keep its executable router, route manifest, OpenAPI
  contribution, and permission catalog consistent for the selected context
  (API_ASSEMBLY_SPEC §4). A context that drops a surface drops it from every
  inventory, not only from the router.
- The gateway static closure check scopes route discovery to the dependency's
  declared `apiSurfaces`. Surfaces excluded by the composition context are not
  part of the combined route inventory and `MUST NOT` be declared as gateway
  surfaces.
- Contract-level duplicates that are isolated by composition-surface selection
  are permitted but `MUST` be recorded in the gateway component contract under
  `contracts.resolvedDedup` so the resolution is auditable, with the primary
  owner, the excluded surface, and the affected normalized route identities.

### 4.2.3 Ownership Resolution Gate

Canonical gates:

```text
node <gateway-repo>/scripts/check-gateway-api-closure.mjs --root .
node ../sdkwork-specs/tools/check-cross-module-api-collisions.mjs --workspace ..
```

- `check-gateway-api-closure` validates the gateway-view route inventory: every
  mounted route matches a declared surface, every declared surface has a
  provider route, and multi-owner routes resolve to the primary owner (first
  `apiSurfaces` declaration wins; the losing duplicate contribution is skipped).
- `check-cross-module-api-collisions` audits contract-level duplicate
  `(surface, method, path)` identities across application assemblies and
  reports them for dedup review. Contract duplicates isolated by
  composition-surface selection are documented findings, not blocking failures.
- Runtime composition (`ComposedApiAssembly::try_compose`) remains the final
  guard: any duplicate that survives static checks fails closed with the
  colliding operations named.

## 5. Assembly Manifest

`assembly-manifest.json` is source-controlled deterministic materialized
output. Minimum shape:

```json
{
  "kind": "sdkwork.api.assembly",
  "schemaVersion": 1,
  "applicationCode": "birdcoder",
  "apiMode": "served",
  "packageName": "sdkwork-api-birdcoder-assembly",
  "crateDir": "crates/sdkwork-api-birdcoder-assembly",
  "routeCrates": []
}
```

Rules:

- `apiMode` is `served` or `none`.
- `served` requires at least one route contribution unless an approved staged
  migration record explains the temporary empty state.
- `none` requires an empty route inventory and `component.spec.json` evidence.
- `generatedAt` or other wall-clock values `MUST NOT` make materialization
  nondeterministic.
- Route entries include package identity, component reference, surface,
  normalized path prefix, mount order, route-manifest reference, and source
  reference.
- `componentRef`, `routeManifestRef`, and `sourceRef` are normalized,
  application-root-relative paths. They `MUST` resolve inside the selected
  application root, `MUST NOT` contain `.` or `..` traversal segments, and
  every referenced file `MUST` exist. A route component declaration beginning
  with `sdks/_route-manifests/` is application-root-relative; other relative
  route-manifest declarations are component-root-relative.
- Materialization `MUST` preserve authored bootstrap code and regenerate only
  declared generated regions or files.
- An authored assembly `src/lib.rs` that declares modules or public exports beyond the canonical
  materializer template `MUST` contain the exact `SDKWORK-ASSEMBLY-LIB-CUSTOM` marker. The
  materializer `MUST` preserve a marked file byte-for-byte while continuing to regenerate declared
  companion artifacts such as `src/generated.rs`. Application-specific generated modules do not
  make `src/lib.rs` generated ownership and `MUST NOT` be silently removed during materialization.

### 5.1 Runtime Parity Evidence

Every selected deployment profile that serves or intentionally serves no HTTP API `MUST` emit one
deterministic `api-runtime-parity.<profile>.evidence.json` file under application `specs/` or
`.sdkwork/evidence/`. The machine authority is
`schemas/sdkwork.api-runtime-parity-evidence.schema.v1.json`. The evidence contract is:

```json
{
  "schemaVersion": 1,
  "kind": "sdkwork.api-runtime-parity-evidence",
  "application": "sdkwork-birdcoder",
  "profile": "standalone",
  "apiMode": "served",
  "sources": {
    "executableRouter": {
      "kind": "runtime-probe",
      "location": "http://127.0.0.1:3901/.well-known/sdkwork/routes"
    },
    "boundManifest": {
      "kind": "framework-bound-manifest",
      "location": "runtime:combined-manifest"
    },
    "servedOpenapi": {
      "kind": "runtime-http-openapi",
      "location": "http://127.0.0.1:3901/openapi.json"
    },
    "sdkAuthority": {
      "kind": "sdk-generation-authority",
      "location": "apis/app-api/birdcoder/openapi.json"
    }
  },
  "inventories": {
    "executableRouter": [],
    "boundManifest": [],
    "servedOpenapi": [],
    "sdkAuthority": []
  }
}
```

Each inventory row has exactly the comparison fields:

```json
{
  "surface": "app-api",
  "method": "POST",
  "normalizedPath": "/app/v3/api/oauth/device_authorizations",
  "operationId": "oauth.deviceAuthorizations.create",
  "authProfile": "credential-entry-bootstrap"
}
```

Rules:

- `apiMode: served` requires a non-empty executable inventory. `apiMode: none` requires all four
  inventories to be empty; it is not an excuse for a failed probe.
- Executable evidence comes only from a framework route registry or an integration/runtime probe
  that exercises the assembled router. Copying the bound manifest and relabeling it executable is
  forbidden.
- Served OpenAPI evidence comes from the selected running profile's HTTP OpenAPI endpoint, not a
  static source file. SDK authority evidence comes from the exact input selected by SDK generation.
- Path normalization converts framework `:parameter` syntax to OpenAPI `{parameter}` syntax,
  removes only leading/trailing slash variation, and preserves parameter names. It does not erase
  contract differences.
- Duplicate normalized `(surface, method, path)` rows fail. Missing/extra routes, `operationId`
  differences, and auth-profile differences fail independently.
- Profile evidence is generated by an integration test or deterministic evidence command after
  all routers, dependency assemblies, manifests, and OpenAPI contributions are merged and before
  the one Web Framework layer is applied.
- An HTTP status alone is not executable-route evidence unless the probe distinguishes the real
  handler from framework fallback. In particular, a pre-auth `401`, generic `404`, or manifest-only
  `501` does not prove the handler is mounted.
- Optional source `sha256` values, when present, are lowercase SHA-256. Secrets, tokens, database
  addresses, and internal upstream credentials are forbidden in evidence.

The canonical read-only gate is:

```text
node ../sdkwork-specs/tools/check-api-runtime-parity.mjs --root .
```

The reusable Rust Web Framework contract exposes normalized manifest/OpenAPI inventory types; it
does not infer executable Axum routes by parsing source or debug output.

## 6. Gateway Consumption

### 6.1 Standalone

`sdkwork-api-<application-code>-standalone-gateway` consumes the corresponding
application assembly and any explicitly selected dependency assemblies. It is
the only application-plane HTTP listener started by `pnpm dev`.

The standalone gateway `MUST NOT` depend on route, service, repository, or
database implementation crates already owned by an assembly. All such
dependencies enter through assemblies.

The thin-host Cargo gate rejects direct runtime dependencies matching
`sdkwork-routes-*`, `sdkwork-*-service`, `sdkwork-*-repository-*`,
`sdkwork-*-provider-*-adapter`, or `sdkwork-*-database-host` whenever the gateway selects an API
assembly.
Process infrastructure such as `sdkwork-database-sqlx`, Web Framework/bootstrap
crates, and responsibility-specific host adapters remain allowed when they
serve listener, framework, topology, or process-lifecycle concerns rather than
duplicating assembly-owned API construction.

Standalone dependency composition rules:

- The gateway declares each selected dependency assembly as a required component port and matching `dependencyApiSurfaces` entry with `runtimeMode: same-origin`, `sameOriginAllowed: true`, API authority, SDK family, prefix, executable assembly export, and profile coverage.
- The gateway calls dependency-owned assembly entrypoints; it does not import `sdkwork-routes-*`, duplicate dependency service wiring, or reclassify dependency ownership.
- The combined executable router, combined `HttpRouteManifest`, served OpenAPI, permission catalog, and readiness set are constructed as one selected-profile unit before the single Web Framework layer is applied.
- A configured same-origin dependency whose assembly cannot initialize causes startup/readiness failure with `50301`; the gateway does not start a partial route surface that later returns 404.
- A standalone client `MUST` use the application public-ingress origin for every selected same-origin dependency SDK. The standalone profile `MUST NOT` publish a platform API gateway URL, dependency sidecar URL, alternate loopback port, or `VITE_*` platform-gateway URL for that dependency.
- Selecting a dependency assembly means linking and initializing its Rust backend contribution inside the current application standalone gateway process. It `MUST NOT` start the dependency's standalone gateway binary or require a second HTTP listener.

#### 6.1.1 Standalone Dependency Integration Completeness

When an application declares `dependencyApiSurfaces` with `runtimeMode` `same-origin` or `same-origin-mounted`, the owning application api-assembly and standalone gateway `MUST` integrate the full declared dependency API surface. Partial integration is a contract violation.

Checklist — every declared same-origin dependency `MUST` satisfy all items:

| Check | Requirement |
| --- | --- |
| Assembly selection | Dependency api-assembly or approved route crate set is registered in the application standalone gateway bootstrap |
| Route manifest | All dependency-owned routes appear in the composed standalone route manifest |
| OpenAPI inventory | Composed OpenAPI route inventory matches the route manifest after approved augmentation rules; manifest-only or OpenAPI-only drift `MUST` fail verification |
| Listener exposure | Canonical browser paths (for example `/feeds/v3/api`) are served by the application standalone gateway or declared same-origin mount, not by a sibling dev port in browser clients |
| SDK bootstrap | Frontend/runtime resolves the dependency SDK `baseUrl` as a same-origin relative path in `standalone` per `ENVIRONMENT_SPEC.md` §6.2 |
| Independent start | `sdkwork-api-<application-code>-standalone-gateway` starts and passes readiness with only declared external upstreams; missing same-origin dependency routes `MUST` fail startup or verification |

Rules:

- Dependency integration `MUST` follow declared `dependencyApiSurfaces` ownership and `runtimeMode`. Do not import dependency route crates into application-owned generated SDK authorities; compose at the api-assembly boundary only.
- When federated open routes exist (for example feeds open runtime), bootstrap `MUST` apply the same OpenAPI augmentation policy used for application app/backend surfaces so composed inventories stay aligned with route manifests.
- Repository verification for api-assembly changes `MUST` include standalone gateway build/start evidence and any repository-owned assembly inventory checks. Cross-reference `ENVIRONMENT_SPEC.md` §6.2 for browser URL expectations.
- The standalone gateway `MUST` be able to start independently and serve the composed API surface for its owning application without requiring sibling application repositories to be running, except for explicitly declared external upstream overrides.

### 6.2 Cloud

Only the `sdkwork-api-cloud-gateway` repository owns the platform cloud gateway
process. It selects and consumes approved application assemblies, validates
cross-assembly route collisions, and mounts process infrastructure once.

#### 6.2.1 Cloud Gateway Installs Modules, Not Contributions

The platform cloud gateway is the integration of every dependency module's API
routes, so it `MUST` install each embedded dependency through that dependency's
own `WebModule` factory (`§4.1.1`) rather than reaching into the dependency's
assembly internals:

- Every `#[cfg(feature = "foundation-*")]` selection block `MUST` obtain a
  `WebModule` from the dependency crate (`web_module`, `web_module_with_pool`,
  `web_module_with_context`, `web_module_with_pool_for_environment`, or a
  declared variant) and collect it into `Vec<WebModule>`.
- The gateway `MUST NOT` project dependency fields into a hand-written
  `ApiAssemblyContribution { .. }` literal. A contribution is the dependency's
  own definition; rebuilding it in the host re-couples the host to dependency
  internals and silently drops surfaces the dependency later adds.
- Dependency-owned concerns `MUST` move into the dependency module. OpenAPI
  enrichment in particular belongs to the module that authors the document, so
  every host publishes the same contract instead of restamping it per host.
- Runtime artefacts that are a *host* concern (background `JoinHandle`s, IM
  runtime handles, realtime planes) `MAY` be handed back to the host by a
  paired factory (`web_module_with_pool_retaining_background`,
  `web_module_with_realtime_bootstrap`). The module still owns the complete
  route definition; only task shutdown moves to the host.
- The collected modules `MUST` be installed through
  `ApiModuleRegistry::add_modules` so duplicate registrations are ignored
  (`§4.1.1`) and cross-owner route collisions still fail closed. Ignored
  duplicates `MUST` be logged.
- A host-specific context (for example
  `ApiAssemblyContext::cloud_gateway()`) `MUST` be passed through the
  `web_module_with_context` variant instead of calling a context-taking
  assembly entrypoint directly.

Application repositories may publish assembly source or artifacts for platform
composition, but they `MUST NOT` declare the cloud gateway as a Cargo, pnpm,
topology, source-config, build, test, or release dependency.

## 7. Pnpm Commands

Application roots expose the following command families:

```text
pnpm api:assembly:materialize
pnpm api:assembly:validate
```

Rules:

- Materialization writes only `sdkwork-api-<application-code>-assembly`
  deterministic source and manifest output.
- Validation is read-only.
- Each pnpm command directly invokes its matching canonical tool under
  `sdkwork-specs/tools/` with `--root .`. Application-owned dispatchers,
  `scripts/gateway/assembly-*` wrappers, shell wrappers, and substitute or
  swapped tools are forbidden. The canonical bootstrap computes the required
  workspace-relative command path.
- `pnpm dev` and `pnpm dev:standalone` validate or build the assembly before
  starting the standalone gateway.
- `pnpm dev:cloud` starts no local assembly host, gateway, API listener,
  database, migration, seed, or deployed-service worker.
- Gateway and route changes `MUST` run `api:assembly:validate` in CI.

### 7.1 Canonical Fast Integration

Run these commands from the application root. The one-time bootstrap is the
only canonical assembly onboarding command:

```text
node ../sdkwork-specs/tools/bootstrap-api-assembly-repo.mjs --root .
```

It deterministically:

1. materializes `sdkwork-api-<application-code>-assembly`, including
   `apiMode: none` when the application owns no HTTP routes;
2. adds the assembly to Cargo workspace members when a Cargo workspace exists;
3. makes `api:assembly:materialize` and `api:assembly:validate` delegate
   directly to the canonical `sdkwork-specs` tools;
4. runs read-only assembly validation before reporting success.

It `MUST NOT` create `scripts/gateway/assembly-*` wrappers, create or rename a
standalone gateway, register an assembly in the platform cloud gateway, or
delete migration files. Re-running it is idempotent. Route-owning applications
must fix missing component ownership contracts before bootstrap can pass.

Application hosting reaches distinct readiness states:

| State | Owner | Required evidence |
| --- | --- | --- |
| Contract ready | Route/component owner | Every route crate has `specs/component.spec.json` and route manifest authority |
| Assembly ready | Application repository | Bootstrap succeeds and `pnpm api:assembly:validate` passes |
| Standalone host ready | Application repository | Canonical standalone gateway depends only on approved assemblies and strict readiness audit passes |
| Local development ready | Application repository | `pnpm dev` delegates to `dev:standalone`, one application ingress starts, topology check passes |
| Cloud composition ready | Platform gateway owner | Platform repository selects the published assembly and cross-assembly collision checks pass |

For a canonical new application template, the standalone gateway already
exists. For a governed migration with an existing host, the application owner
may run this one-time wiring aid and must inspect its diff:

```text
node ../sdkwork-specs/tools/wire-api-assembly-host.mjs --root .
```

The wiring aid is not completion evidence. The read-only completion gate is:

```text
pnpm api:assembly:validate
node ../sdkwork-specs/tools/audit-gateway-alignment-repo.mjs --root . --strict
node ../sdkwork-specs/tools/check-application-cloud-gateway-boundary.mjs --root .
node ../sdkwork-specs/tools/check-topology-deployment-profiles.mjs --root .
```

Application teams hand off the assembly crate and deterministic manifest to
the platform owner. They do not hand off or maintain platform cloud gateway
config. Platform registration is a separate platform-owned change and is not
required for local assembly or standalone-host readiness.

## 8. Forbidden Application Cloud Integration

Application-root validation `MUST` fail when active files contain any of:

- a Cargo, package, or workspace dependency on `sdkwork-api-cloud-gateway`;
- a script that resolves, builds, runs, supervises, or packages the platform
  cloud gateway;
- application-owned `sdkwork-api-cloud-gateway.*.toml` source config;
- topology components or processes whose crate, binary, repository, or owner
  is `sdkwork-api-cloud-gateway`;
- application release assets or deployment packages for the platform cloud
  gateway;
- direct route merging in a gateway host.

Client runtime configuration may point to deployed API URLs. It `MUST` use
surface-oriented URL keys and `MUST NOT` require knowledge of the remote
gateway implementation identity.

## 9. Migration

Migration follows `MIGRATION_SPEC.md` and the active API assembly migration
record. The required sequence is:

1. materialize the canonical API assembly;
2. prove route-surface completeness and collision freedom;
3. point the standalone gateway only at assemblies;
4. remove duplicate gateway-host dependencies and direct route merges;
5. remove application cloud-gateway configs, scripts, topology ownership, and
   release assets;
6. register the assembly from the cloud gateway side;
7. remove retired names after both standalone and cloud composition tests pass.

Rollback restores validator audit mode or the previous application release;
it `MUST NOT` restore application ownership or autostart of
`sdkwork-api-cloud-gateway`.

## 10. Verification

Required application checks:

```text
node ../sdkwork-specs/tools/validate-api-assembly.mjs --root .
node ../sdkwork-specs/tools/check-application-cloud-gateway-boundary.mjs --root .
node ../sdkwork-specs/tools/check-single-http-ingress.mjs --root .
node ../sdkwork-specs/tools/check-route-path-collisions.mjs --root .
node ../sdkwork-specs/tools/check-api-runtime-parity.mjs --root .
```

Required workspace checks:

```text
node ../sdkwork-specs/tools/audit-api-assembly-workspace.mjs --workspace ..
node ../sdkwork-specs/tools/check-application-cloud-gateway-boundary.mjs --workspace ..
node ../sdkwork-specs/tools/check-api-assembly-integration-closure.mjs --workspace .. --strict-standalone-hosting
node ../sdkwork-specs/tools/check-cross-module-api-collisions.mjs --workspace ..
node ../sdkwork-specs/tools/check-web-module-adoption.mjs --workspace .. --strict
node ../sdkwork-specs/tools/check-web-module-exports.mjs ..
node ../sdkwork-specs/tools/check-web-module-contribution-projection.mjs --workspace ..
node ../sdkwork-specs/tools/check-embedded-self-loop.mjs --workspace ..
```

Gateway hosts additionally run the gateway-view dedup gate:

```text
node <gateway-repo>/scripts/check-gateway-api-closure.mjs --root <gateway-repo>
```

## 11. Acceptance Checklist

- [ ] Exactly one canonical API assembly exists per application root.
- [ ] All application-owned app/backend/open route crates are included once.
- [ ] Standalone and cloud hosts consume the same assembly contract.
- [ ] Dependency-owned routes enter standalone only through selected dependency assemblies and matching profile-specific `dependencyApiSurfaces` declarations.
- [ ] Application roots do not depend on or operate the platform cloud gateway.
- [ ] Standalone gateway hosts depend on assemblies, not assembly-owned crates.
- [ ] Runtime-composed route manifests use Framework-owned/shared ownership and do not leak allocations to manufacture static lifetimes.
- [ ] `pnpm dev` delegates to standalone and starts one application HTTP ingress.
- [ ] `pnpm dev:cloud` is remote-client-only.
- [ ] Executable routes, bound manifests, served OpenAPI, SDK authorities, permissions, readiness, auth profiles, and collision checks agree for each selected profile.
- [ ] Cross-module `(surface, method, path)` identities mounted by one gateway are unique; multi-owner routes resolve to the primary owner declared by the gateway `apiSurfaces` order, and composition-surface exclusions are recorded in `contracts.resolvedDedup`.
- [ ] Composition contexts (`ApiAssemblyContext`) keep router, manifest, OpenAPI, and permission inventories consistent for the selected surface set.
