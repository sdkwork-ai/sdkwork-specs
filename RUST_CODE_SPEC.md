# Rust Code Standard

- Version: 2.0
- Scope: Rust crates, workspaces, route crates, Tauri/native Rust, Rust services, Rust SDK facades, and Rust tests
- Related: `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `APPLICATION_GATEWAY_SPEC.md`, `API_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `COMPONENT_SPEC.md`, `I18N_SPEC.md`, `RUST_RPC_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `TEST_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `OBSERVABILITY_SPEC.md`, `SECURITY_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`

This standard applies only when Rust source, Cargo manifests, Rust route crates, Tauri Rust code, or Rust RPC code is touched. Rust crate responsibilities implement the L0-L6 profile from `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`; cross-stack Rust composition and layer roles follow `COMPOSABLE_ARCHITECTURE_SPEC.md`.

This standard targets industry-best Rust practice as published by the Rust API Guidelines, the Rust Reference, Clippy, the Rust Book, and the Google Rust Style Guide, narrowed to SDKWork's multi-repository, multi-crate workspace. Where a rule is not machine-checkable, the standard states the review evidence required.

## 1. Crate And Module Shape

Rules:

- `src/lib.rs` is a public module assembly file. It should contain `pub mod`, private `mod`, re-exports, crate-level documentation, and small compile-time wiring only.
- `src/lib.rs` `MUST NOT` contain handlers, repositories, SQL queries, provider clients, long business services, large DTO definitions, test fixtures, or generated data tables.
- If `lib.rs` contains multiple unrelated responsibilities (e.g., business logic AND database access), split it before adding more behavior.
- `src/main.rs` or `bin/*` owns process startup only. Runtime business logic belongs in library modules.
- A final process host that composes TLS-capable Rust dependencies `MUST` explicitly install one process-level Rustls `CryptoProvider` before constructing HTTP clients, routers, services, or listeners. It `MUST NOT` rely on Rustls automatic provider selection because aggregated dependency features may enable both `ring` and `aws-lc-rs`; provider policy belongs to the final process host, not to route, service, repository, or generated SDK crates.
- Process-startup tests for a TLS-capable gateway, worker, or server `MUST` execute or directly verify provider installation before runtime composition so feature unification cannot defer a missing-provider panic to deployment startup.
- A platform process that composes many framework routers or manifests `MUST` verify startup with its complete production feature set on every supported operating-system family. When bounded composition depth exceeds an operating system's default main-thread stack, the final process host `MAY` establish an explicit documented runtime-thread stack budget; it `MUST NOT` remove modules, skip route construction, or weaken runtime parity to avoid the failure.

**Cohesion guidance for Rust files:**

| Signal | Likely Meaning | Action |
| --- | --- | --- |
| File grows beyond ~200 lines | Possible responsibility creep | Review: does this serve one concern? |
| Mixes different concerns | High coupling risk | Split by responsibility domain |
| Different teams modify separately | Needs separation | Create new module per team |
| Testing requires mocking unrelated code | Tight coupling | Separate into independent modules |
| Public type leaks an implementation detail | Encapsulation break | Introduce a private module or sealed interface |

When in doubt, prefer splitting over accumulating complexity. A well-structured codebase with many small files is better than a few monolithic ones that are hard to maintain.

Rust crates `MUST` be named and structured by responsibility. A crate name must tell a reader
whether it owns business rules, database access, HTTP route adaptation, process startup, native host
integration, background jobs, or gateway/proxy behavior.

Allowed authored Rust crate families:

| Responsibility | Standard crate name | Primary owner |
| --- | --- | --- |
| Business service/use case | `sdkwork-<domain>-<capability>-service` | domain models, commands, results, business rules, service ports |
| SQLx repository implementation | `sdkwork-<domain>-<capability>-repository-sqlx` | database schema constants, row mapping, SQLx queries, repository trait implementation |
| HTTP route/API adapter | `sdkwork-routes-<capability>-<surface>` | paths, routes, handlers, route manifest, API/service mapping |
| In-process service host | `sdkwork-<application-code>-service-host` | standalone/native service container, no HTTP route mounting |
| Native/Tauri host | `sdkwork-<application-code>-native-host` or `sdkwork-<application-code>-tauri-host` | native commands, host state, platform adapters |
| Background job process | `sdkwork-<domain>-<capability>-worker` | jobs, scheduling, queues, retries, cursors, locks |
| API assembly | `sdkwork-api-<application-code>-assembly` | host-neutral app-api/backend-api/open-api route and bootstrap composition |
| API gateway/proxy (standalone deployment) | `sdkwork-api-<application-code>-standalone-gateway` | standalone application ingress, upstream routing, route precedence, dependency API surface proxying, optional embedded platform adapter |
| Platform API gateway | `sdkwork-api-cloud-gateway` | shared `platform.api-gateway` ingress for SDKWork platform APIs |

`sdkwork-<application-code>-api-server` is a migration-only listener name. New application HTTP ingress `MUST` use `sdkwork-api-<application-code>-assembly` and `sdkwork-api-<application-code>-standalone-gateway` per `API_ASSEMBLY_SPEC.md` and `APPLICATION_GATEWAY_SPEC.md`. Single-surface smoke binaries may exist only as package-local tests when they do not become public ingress.

Forbidden Rust crate suffixes for SDKWork Rust crates:

- `sdkwork-<application-code>-gateway` (bare application gateway without `standalone` or `cloud` qualifier)
- `sdkwork-<application-code>-product`
- `sdkwork-<application-code>-runtime`
- `sdkwork-<domain>-<capability>-runtime`
- `sdkwork-<application-code>-backend`
- `sdkwork-<application-code>-core`
- `sdkwork-<application-code>-common`
- `sdkwork-<application-code>-manager`
- `sdkwork-<application-code>-server-runtime`

These names are not legacy-compatible exceptions. Repositories containing them are not compliant
until the crates are renamed to responsibility-specific names and public references are updated. Do
not preserve an old forbidden crate name through a wrapper crate, package alias, feature alias, or
public re-export alias. Breaking package renames still follow `MIGRATION_SPEC.md`, but the final
state must not keep the forbidden name.

Retired listener rule:

- `sdkwork-<application-code>-api-server` `MUST NOT` be introduced as a new default application ingress listener.
- Existing `sdkwork-<application-code>-api-server` crates are migration-only and `MUST` have a migration plan to the canonical API assembly and standalone gateway.
- A package-local test or cloud scale-out single-surface listener `MAY` keep a narrowly documented binary only when topology, dev scripts, release manifests, and client bootstrap do not treat it as `application.public-ingress`.

Standard business service crate layout:

```text
crates/sdkwork-<domain>-<capability>-service/
  Cargo.toml
  README.md
  specs/
    component.spec.json
  resources/
    i18n/        # present when the crate owns backend message resources
  src/
    lib.rs
    config.rs
    context.rs
    error.rs
    domain/
      mod.rs
      models.rs
      value_objects.rs
      commands.rs
      results.rs
      events.rs
    ports/
      mod.rs
      repository.rs
      provider.rs
      cache.rs
      events.rs
    service/
      mod.rs
      <capability>_service.rs
      <use_case>.rs
    test_support/
      mod.rs
      fixtures.rs
      fakes.rs
  tests/
    service_smoke.rs
    authorization_smoke.rs
    transaction_smoke.rs
    idempotency_smoke.rs
```

Rules:

- Service crates own business rules, authorization decisions, transaction orchestration,
  idempotency, domain events, and cache/event/provider coordination.
- Service crates define repository and provider ports as traits. They `MUST NOT` depend on concrete
  SQLx repository crates.
- Service crates `MUST NOT` depend on HTTP framework request/response types.
- Service crates `MUST NOT` depend on generated SDKs for the API authority they implement.
- Crates that own user-facing or operator-facing backend message resources `MUST` keep authored bundles under `resources/i18n/<locale>/<domain>/<capability>/` per `I18N_SPEC.md` section 6.1. `src/i18n.rs` or `src/i18n/mod.rs` may register or resolve bundles, but it `MUST NOT` become the authored message catalog.
- Service crates `MUST NOT` declare direct sibling SDKWork `path = "../sdkwork-..."` dependencies in
  member `Cargo.toml`; sibling source paths belong once in root `[workspace.dependencies]`, and
  member crates consume them with `{ workspace = true }`.

### 1.1 Rust Crate Role Dependency Matrix

Rust backend crates `MUST` keep business policy, HTTP adaptation, persistence, and runtime composition separate.

| Crate role | Typical `contracts.layerRole` | May depend on | Must not depend on | Required evidence |
| --- | --- | --- | --- | --- |
| `sdkwork-<domain>-<capability>-service` | `backend-service` or `backend-domain` | domain models, ports, provider traits, event/cache abstractions, utility crates | concrete `*-repository-sqlx`, `sdkwork-web-framework` request/response types, same-authority generated SDKs | service tests for authorization, transactions, idempotency, domain behavior |
| `sdkwork-<domain>-<capability>-repository-sqlx` | `backend-repository` | service-declared repository traits, SQLx, database utilities, row mappers | HTTP framework crates, route crates, business permission decisions, API DTO ownership | repository tests for tenant/data-scope predicates and query bounds |
| `sdkwork-routes-<capability>-<surface>` | `backend-route` | service traits/structs, DTO mappers, `sdkwork-web-framework` public route helpers, route manifest types | concrete repository crates, same-authority generated SDKs, raw credential parsing, hidden route copies | route manifest tests, handler mapping tests, `check-route-path-collisions.mjs` |
| `sdkwork-<application-code>-service-host` | `runtime-service-host` | service crates, repositories/providers, config, host adapters | HTTP listener startup, API path ownership, business rules | dependency wiring tests and no HTTP listener evidence |
| `sdkwork-api-<application-code>-assembly` | `api-assembly` | route, service, repository, database/cache ports, Web Framework router contributions | listener bind, process supervision, gateway identity | API assembly completeness and collision validation |
| `sdkwork-api-<application-code>-standalone-gateway` | `runtime-gateway` | API assembly crate, framework bootstrap, topology config | route/service/repository duplication, route hand-merge matrices, business rules | API assembly, thin-host, readiness/preflight tests |
| `sdkwork-<application-code>-native-host` / `sdkwork-<application-code>-tauri-host` | `runtime-native-host` | service-host boundary, host commands, native storage/bridge adapters | SQL ownership, HTTP route authority, copied web handlers | host adapter tests and component port declarations |
| `sdkwork-<domain>-<capability>-worker` | `backend-provider` or `runtime-service-host` | service use cases, queue/scheduler adapters, cursors, locks | public HTTP API ownership, direct table writes that bypass services | job idempotency, retry, and service-boundary tests |

Rules:

- Runtime crates construct and wire dependencies; service crates decide business policy; repository crates persist data; route crates adapt HTTP. A crate that owns more than one of those roles must be split before new behavior is added.
- Member `Cargo.toml` files `MUST` consume sibling SDKWork crates through root `[workspace.dependencies]` and `{ workspace = true }`. Direct sibling `path = "../sdkwork-..."` entries in member crates are forbidden.
- Same-origin dependency API coverage requires executable public router/controller/service exports declared in `contracts.runtimeEntrypoints` and `contracts.dependencyApiSurfaces`. Route manifests and OpenAPI files alone are metadata, not runtime coverage.
- `check-application-layering.mjs` validates cross-language application layer violations, and
  `check-rust-backend-composition.mjs` is the executable gate for Rust crate dependency direction.
  Route, API, SDK, and gateway checks still apply when the crate owns HTTP behavior.

Standard SQLx repository crate layout:

```text
crates/sdkwork-<domain>-<capability>-repository-sqlx/
  Cargo.toml
  README.md
  src/
    lib.rs
    error.rs
    db/
      mod.rs
      schema.rs
      rows.rs
      columns.rs
      indexes.rs
    mapper/
      mod.rs
      row_mapper.rs
    repository/
      mod.rs
      queries.rs
      <aggregate>_repository.rs
    test_support/
      mod.rs
      fixtures.rs
  tests/
    repository_smoke.rs
    tenant_scope_smoke.rs
    schema_mapping_smoke.rs
    optimistic_lock_smoke.rs
```

Rules:

- Repository implementation crates implement repository traits declared by the service crate.
- `db/schema.rs`, `db/columns.rs`, and `db/indexes.rs` own table, column, and index constants or
  logical schema descriptors.
- `db/rows.rs` owns database row types. API DTOs and domain models must not be aliases for row
  types.
- `repository/queries.rs` owns SQL text, query fragments, or query-builder helpers.
- Repository implementations `MUST` receive tenant, organization, user, and data-scope inputs from
  service/context parameters. They `MUST NOT` infer authorization by parsing HTTP headers or global
  request state.
- Repository implementations `MUST NOT` own business policy, permission checks, HTTP concerns, or
  provider calls.
- Repository implementation crates `MUST NOT` depend on HTTP framework crates such as
  `sdkwork-web-framework`, `axum`, `actix-web`, `poem`, `rocket`, `hyper`, or `tower-http`.

Migration-only HTTP API server process crate layout:

```text
crates/sdkwork-<application-code>-api-server/
  Cargo.toml
  README.md
  src/
    main.rs
    lib.rs
    bootstrap/
      mod.rs
      config.rs
      state.rs
      database.rs
      repositories.rs
      services.rs
      adapters.rs
      routers.rs
    server/
      mod.rs
      listen.rs
      shutdown.rs
      middleware.rs
    preflight/
      mod.rs
      config.rs
      database.rs
      dependency_surfaces.rs
    health.rs
  tests/
    bootstrap_smoke.rs
    route_mount_smoke.rs
    dependency_surface_smoke.rs
    preflight_smoke.rs
```

Rules:

- New application ingress crates `MUST NOT` use this layout. Use the canonical API assembly and `sdkwork-api-<application-code>-standalone-gateway`.
- Existing API server crates are migration-only runnable HTTP processes. They may mount route crates, construct services, inject repository/adapters, run preflight checks, and start the listener only until the repository migrates to the standard gateway role.
- Migration-only API server crates `MUST` assemble the HTTP runtime through `sdkwork-web-bootstrap` or an equivalent documented bootstrap API from `sdkwork-web-framework` according to `WEB_FRAMEWORK_SPEC.md`.
- Migration-only API server crates `MUST NOT` define core business rules, SQL queries, OpenAPI authority, or generated SDK ownership.
- Migration plans `MUST` move default dev/release public ingress from `sdkwork-<application-code>-api-server` to the canonical API assembly and standalone gateway before production release.

Standard in-process service host crate layout:

```text
crates/sdkwork-<application-code>-service-host/
  Cargo.toml
  README.md
  src/
    lib.rs
    bootstrap/
      mod.rs
      config.rs
      state.rs
      database.rs
      repositories.rs
      services.rs
      adapters.rs
    host/
      mod.rs
      service_container.rs
    preflight/
      mod.rs
      config.rs
      database.rs
  tests/
    service_host_smoke.rs
    dependency_wiring_smoke.rs
    preflight_smoke.rs
```

Rules:

- Service host crates provide a Rust in-process service container for
  standalone/native use.
- Service host crates `MUST NOT` mount HTTP routes or start an HTTP listener.
- Service host crates `MUST NOT` replace service crates as the owner of business rules.

Standard native/Tauri host crate layout:

```text
crates/sdkwork-<application-code>-native-host/
  Cargo.toml
  README.md
  src/
    lib.rs
    commands/
      mod.rs
      <capability>_commands.rs
    host/
      mod.rs
      state.rs
      permissions.rs
    adapters/
      mod.rs
      filesystem.rs
      keychain.rs
      notifications.rs
    bootstrap/
      mod.rs
      services.rs
  tests/
    command_smoke.rs
    host_permission_smoke.rs
    adapter_smoke.rs
```

Rules:

- Native host crates own native/Tauri command boundaries and platform adapters.
- Native host crates may call service hosts or service crates through typed boundaries.
- Native host crates `MUST NOT` run SQL directly, define OpenAPI authority, or replace HTTP route
  crates.

Standard worker crate layout:

```text
crates/sdkwork-<domain>-<capability>-worker/
  Cargo.toml
  README.md
  src/
    main.rs
    lib.rs
    jobs/
      mod.rs
      <job_name>.rs
    scheduler/
      mod.rs
      cron.rs
    bootstrap/
      mod.rs
      config.rs
      repositories.rs
      services.rs
      adapters.rs
    preflight.rs
  tests/
    job_smoke.rs
    idempotency_smoke.rs
    retry_smoke.rs
```

Rules:

- Worker crates own background job execution, queues, schedules, cursors, locks, retries, and
  maintenance loops.
- Worker crates should call service use cases instead of bypassing service rules with direct table
  writes.
- Worker crates `MUST NOT` expose HTTP route authority unless the HTTP surface is split into a
  route crate mounted through an API assembly by an application standalone
  gateway, platform cloud gateway, or another topology-approved HTTP runtime.

Standard standalone application gateway crate layout:

```text
crates/sdkwork-api-<application-code>-standalone-gateway/
  Cargo.toml
  README.md
  specs/
    component.spec.json
  src/
    main.rs
    lib.rs
    routing/
      mod.rs
      table.rs
      precedence.rs
      upstreams.rs
    proxy/
      mod.rs
      request.rs
      response.rs
    auth/
      mod.rs
      context_forwarding.rs
    preflight/
      mod.rs
      upstreams.rs
    health.rs
  tests/
    route_precedence_smoke.rs
    upstream_config_smoke.rs
    dependency_surface_smoke.rs
    fail_closed_smoke.rs
```

Rules:

- Application standalone gateway crates own listener infrastructure and
  assembly selection. API assemblies own application route/service/repository
  composition.
- Applications `MUST NOT` introduce a generic cloud gateway or bare gateway.
- Gateway crates `MUST NOT` own business service rules, business repositories, or
  application-owned SDK generation authority.

## 2. Route Crates

Rust HTTP route crates follow `API_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, and `SDK_WORKSPACE_GENERATION_SPEC.md`.

Required route crate shape:

```text
crates/sdkwork-routes-<capability>-<surface>/
  Cargo.toml
  src/
    lib.rs
    paths.rs
    routes.rs
    handlers.rs
    manifest.rs
    error.rs
    mapper/
      mod.rs
      request.rs
      response.rs
      problem.rs
```

Rules:

- `paths.rs` owns path constants.
- `routes.rs` owns framework router composition through `sdkwork-web-framework` helpers.
- `handlers.rs` owns HTTP decoding/response mapping, declares `WebRequestContext` on every handler, and delegates business logic.
- `manifest.rs` owns deterministic route manifest projection, including `requestContext: WebRequestContext` and route-level `apiSurface` for every route.
- `mapper/` owns request DTO to service command mapping, service result to response DTO mapping,
  and problem-detail mapping.
- Business rules live in services, not handlers.
- Route crates must call service traits or service structs and must not depend on concrete SQLx
  repository implementation crates.
- Route crates must not depend on generated SDKs for the same API authority.
- Route crates `MUST NOT` parse raw credential or tenant headers in handlers; context comes from `WebRequestContext` injected by the framework.

## 3. Surface Integration Entrypoints

Rust components that are intended to be mounted by another application must expose stable,
surface-specific integration entrypoints. A consumer should be able to integrate the component from
the package root and component spec without reading private source files.

Rules:

- Runtime components that expose SDKWork HTTP surfaces `SHOULD` provide public modules or files for
  each served surface, such as `sdkwork_<component>_open_api`, `sdkwork_<component>_app_api`, and
  `sdkwork_<component>_backend_api`.
- Each mounted surface `SHOULD` expose a public executable builder such as
  `build_sdkwork_<component>_<surface>_router`, `build_sdkwork_<component>_<surface>_controller`, or
  an equivalent service builder.
- `src/lib.rs` may re-export those builders, but the builder implementation, handlers, state wiring,
  service construction, and coverage helpers belong in focused modules.
- Route manifests, path constants, OpenAPI documents, and metadata functions are not executable
  integration entrypoints. A same-process dependency mount requires a dependency-owned executable
  router/controller/handler adapter or approved service export according to
  `APP_SDK_INTEGRATION_SPEC.md`.
- A component that exposes only route contracts or manifests and no executable builder must be
  treated as an external dependency API surface by consuming runtimes.
- Public surface entrypoints must be declared in `specs/component.spec.json` through
  `contracts.publicExports`, `contracts.runtimeEntrypoints`, and `contracts.dependencyApiSurfaces`
  when they participate in same-origin dependency composition.

## 4. Naming And Visibility

Rules:

- Scope: these package/import naming rules apply only to SDKWork-authored crates. Third-party
  crates (registry, git, or upstream trees such as `external/`, `third_party/`, and `vendor/`) keep
  their upstream package and crate names unchanged; do not rename, re-case, or re-derive them.
- Cargo package names use lowercase kebab-case, for example `sdkwork-routes-merchandise-app-api`.
- Rust import names use snake_case, for example `sdkwork_routes_merchandise_app_api`.
- The full package, directory, `[lib].name`, module, and dependency-key mapping is normative in
  `NAMING_SPEC.md` section 3.1. A crate whose `[package].name` contains a hyphen `MUST` declare
  `[lib].name` explicitly as the package name with every `-` replaced by `_`.
- Every external crate referenced by `src/` `MUST` be declared in that crate's `[dependencies]`
  table. Dependency declaration integrity is normative in `NAMING_SPEC.md` section 3.2.
- Runnable crate names must use a specific suffix such as `service-host`, `native-host`,
  `tauri-host`, `worker`, `standalone-gateway`, `cloud-gateway`, or platform
  `api-cloud-gateway`; `api-server` is migration-only and generic `product` and
  `runtime` suffixes are forbidden.
- Modules use snake_case.
- Types, traits, and enum variants use PascalCase. Functions, methods, and variables use
  snake_case. Fields use snake_case. Const generics and type parameters use single uppercase
  letters or short descriptive PascalCase (`T`, `E`, `Item`, `State`).
- Constants use SCREAMING_SNAKE_CASE only for true compile-time constants; runtime-fixed values
  that are not `const` expressions use `static` with SCREAMING_SNAKE_CASE or an accessor.
- Acronyms in identifiers are title-cased as normal words in PascalCase (`HttpClient`, not
  `HTTPClient`) and lowercased in snake_case (`http_client`, not `HTTP_client`).
- Keep items private by default. Export only stable integration surfaces. Public API is a
  semver contract (see section 10).

## 5. Errors And Results

Rust reports failure with `Result<T, E>`, not with panics or sentinel values. Library code
returns errors; binaries and process boundaries are where errors become logs, metrics, and exit
codes.

Rules:

- Libraries expose typed errors where callers can take meaningful action. Prefer a dedicated
  `Error` enum per crate (typically in `src/error.rs`) implementing `std::error::Error`,
  `Display`, and `std::fmt::Debug`.
- Derive `thiserror::Error` for error enums in service, repository, route, and SDK crates.
  `thiserror` `MUST NOT` be used in hot paths where a hand-written `From`/`Display` is trivial.
- Error enums `MUST` implement `std::error::Error::source()` for wrapped causes so the full chain
  is reachable through `anyhow::Error::chain()` and `tracing` spans.
- Provide `From<E>` conversions so `?` works across crate boundaries. Conversion `MUST` preserve
  the original cause in the `source` chain and `MUST NOT` swallow context.
- Name the crate error type `Error` with a crate-level `pub type Result<T> = std::result::Result<T, Error>;`
  alias; specific `Result` aliases may be added for submodules when the error type is narrower.
- Encode remediation in the variant: `NotFound`, `Conflict`, `Unauthorized`,
  `Validation { field, reason }`, `External { source, retryable }` are better than
  `GenericFailure(String)`.
- Variants `MUST NOT` carry raw SQL, secrets, credentials, or PII in their `Display`
  implementation. Logging and error responses must use the redacted form.
- `anyhow` is allowed at binary, CLI, test, and one-off tooling boundaries only. It `MUST NOT`
  appear in `[dependencies]` of service, repository, route, or SDK lib crates; those crates use
  typed errors. `anyhow` `MUST NOT` be re-exported from a library.
- Service/domain crates should prefer typed errors or error enums. Repository errors are mapped to
  domain errors at the port boundary, never leaked as SQLx errors into services.
- HTTP boundary code maps domain errors to Problem Details according to `API_SPEC.md`. The mapping
  lives in `mapper/problem.rs`; a single `IntoResponse`/`ToProblem` impl per error type, not ad-hoc
  `match` arms scattered across handlers.
- Do not add a `String`/`anyhow::Error` catch-all variant to "simplify" a crate error enum. Add
  the concrete source variant or wrap a documented external error.
- Functions that cannot fail `MUST NOT` return `Result`; functions that can fail `MUST NOT`
  swallow the error with `let _ =` unless the failure is intentionally ignored and documented.

## 6. Safety And Unsafe

Safety is a design property, not a code review checkbox. Unsafe code is the exception; SDKWork
crates `MUST` default to safe Rust and keep every `unsafe` block small, local, and reviewable.

Rules:

- Crate default: declare `unsafe_code = "forbid"` in `[lints.rust]` (or the workspace lint
  baseline, see section 13). A crate that genuinely needs `unsafe` changes it to `deny` at the
  crate level with a documented justification in the crate `README.md`; `allow` is forbidden.
- `unsafe` blocks `MUST` be as small as possible: a few lines, never spanning a function body or
  a loop. Do not wrap safe operations in an `unsafe` block to "silence" a lint.
- Every `unsafe` block `MUST` carry a `// SAFETY:` comment immediately above it stating the
  preconditions that make the operation sound, and why the compiler cannot prove them.
  Preconditions reference the invariant source (documented type invariant, caller contract,
  checked bound). A `SAFETY` comment that restates the code is not acceptable.
- `unsafe fn` `MUST` declare its safety contract in `# Safety` documentation, `MUST` name
  `unsafe_op_in_unsafe_fn = "deny"` (default in edition 2024) so every unsafe operation inside is
  an explicit `unsafe` block, and `MUST` be reviewed by a second reviewer.
- `unsafe impl Send`/`unsafe impl Sync` are forbidden unless the type is a documented FFI
  handle or a performance-critical zero-copy wrapper, and the soundness argument is written in
  the `// SAFETY:` comment (which fields make it safe, and what would break it).
- Raw pointer dereference, `std::mem::transmute`, `MaybeUninit::assume_init`,
  `std::hint::unreachable_unchecked`, and `std::ptr::read/write` are forbidden outside a
  reviewed `unsafe` module with a written soundness argument.
- FFI boundaries (`extern "C"` blocks, `#[link]`, `libloading`) `MUST` declare the ABI contract,
  validate pointers/lengths at the boundary, and map foreign failures to typed errors. In edition
  2024, `extern` blocks are `unsafe extern` and `MUST` say so.
- `unsafe` code `MUST NOT` be introduced to work around a borrow-checker limitation that a safe
  redesign (ownership restructuring, `Arc`, interior mutability with a documented invariant)
  solves.
- A crate that contains `unsafe` code `MUST` list the exact `unsafe` sites and their invariants in
  its `README.md`, and its tests `MUST` include at least one test that would break if an
  invariant is violated (e.g., a debug-assertion test).
- Third-party crates that wrap unsafe primitives are preferred over hand-written unsafe
  (`bytes`, `parking_lot`). Do not reimplement a vetted abstraction.

## 7. Panic And Fallibility

Panics are bugs unless they are the documented reaction to a programming error at a process
boundary. Library code must not panic on external input.

Rules:

- Library crates `MUST NOT` panic on user input, malformed data, or unavailable resources.
  Recoverable failures are `Result`/`Option`; invariant violations that indicate a bug may use
  `panic!`/`assert!` only when the caller cannot recover and the invariant is documented.
- `unwrap`, `expect`, `panic!`, `todo!`, `unimplemented!`, `unreachable!`, and `dbg!` are
  forbidden in library code (declare `clippy::unwrap_used`, `clippy::expect_used`,
  `clippy::panic`, `clippy::todo`, `clippy::unimplemented`, `clippy::unreachable`,
  `clippy::dbg_macro` in the workspace lint baseline; binaries may relax them locally with a
  comment).
- `expect` is preferred over `unwrap` only when the message documents the invariant
  (`arr.first().expect("pipeline always pushes a header")`). `unwrap` in non-test code is
  forbidden.
- Prefer checked indexing (`get`, `get_mut`, `split_first`) over `[i]` in library code; use
  iterator combinators (`nth`, `find`) instead of index loops where the index is data-driven.
- Integer arithmetic that can overflow `MUST` use checked/saturating/wrapping operations
  (`checked_add`, `saturating_mul`) or explicitly documented `wrapping_*`. Enable
  `overflow-checks = true` in dev/release profiles except for measured hot paths.
- `expect`/`unwrap` inside `async` tasks and worker jobs is forbidden: a panic in a spawned task
  aborts the task and can corrupt shared state. Failures `MUST` be propagated as `Result` and
  logged by the task supervisor.
- Division by a non-constant divisor `MUST` be guarded (`checked_div`, `!= 0` check) unless the
  divisor is an enforced non-zero type (`NonZeroU64`, `NonZeroUsize`).
- The only allowed panic boundary is process/thread/task supervision: a top-level binary `main`
  or a task supervisor may `panic!`/return `Err` and let the runtime restart the unit. Such
  boundaries `MUST` be documented.
- Do not use `catch_unwind` to implement control flow or to "rescue" logic errors. If
  `catch_unwind` is needed at a plugin/FFI boundary, the caught block `MUST` not touch shared
  state after the panic.

## 8. Async, State, And Concurrency

Rust async is a first-class runtime concern in SDKWork services and gateways. Concurrency bugs
are state bugs; the standard below keeps shared state explicit and task isolation strong.

Rules:

- Do not hold `MutexGuard`/`RwLockGuard`/`RefCell` borrows across `.await`. If a lock must span
  an await point, restructure: compute under the lock, drop it, then await; or use
  `tokio::sync::Mutex` with the critical section documented and minimized.
- Shared mutable state `MUST` be explicit in state structs or service ports. Prefer
  `Arc<T>` + `tokio::sync::RwLock`/`Mutex` over global `static mut` or `lazy_static` maps;
  `static` mutable state is forbidden.
- Prefer `std::sync::Arc` over `Rc` in any crate compiled for multi-threaded runtimes. `Rc` and
  `RefCell` are permitted only in single-threaded Tauri command contexts and test fixtures, and
  `MUST` be documented as such.
- `Send`/`Sync` hygiene: public types that participate in runtime composition should be
  `Send + Sync` unless documented. Do not silently make a type `!Send`; if a type cannot be
  `Send`, document why and keep it out of `tokio::spawn` closures.
- Every `tokio::spawn`/`tokio::task::spawn_blocking`/`JoinHandle` `MUST` be awaited, aborted, or
  detached with a documented owner. Spawned futures `MUST` be `Send`; use `spawn_blocking` for
  CPU-bound or blocking-IO work with a documented thread-pool budget.
- Task shutdown `MUST` be cooperative: use `CancellationToken` or `watch` channels, check
  cancellation at await points, and give tasks a bounded drain time. `abort` is the last resort
  and `MUST` be logged.
- Prefer `tokio::sync` primitives (mpsc, oneshot, watch, broadcast) over hand-rolled
  condition-variable/queue loops. Channel capacity and backpressure `MUST` be bounded and
  documented (`mpsc::channel(n)` with a named buffer size).
- Timeouts `MUST` wrap every external await (HTTP call, SQL query, provider call, lock acquire):
  `tokio::time::timeout` or a framework equivalent. No unbounded external await is allowed.
- Retry loops `MUST` be bounded (max attempts), jittered, and backed off; they `MUST` respect
  cancellation and `MUST NOT` retry non-idempotent side effects without an idempotency key.
- Prefer immutable domain models and interior mutability only where the invariant is documented.
  A `Mutex<Vec<T>>` exposed publicly is a design smell; expose a service method instead.
- Do not use `async` for CPU-bound work; CPU-bound work belongs in `spawn_blocking` or a worker
  with a documented concurrency limit.
- `Send + 'static` bounds on task-spawned closures are required; capture `Arc` state by clone
  inside the task, never a borrow of stack state.

## 9. Ownership, Memory, And Performance

Rust's value semantics are a feature, not a tax. The rules below keep allocation behavior
predictable and avoid both premature optimization and careless cloning.

Rules:

- Function parameters: prefer `&str`/`&[T]`/`&T` for read-only access; take `String`/`Vec<T>`/
  `T` by value only when ownership transfer is intended; return `Cow<'_, str>`/`Cow<'_, [T]>`
  from functions that may borrow or allocate.
- Use `impl Trait` for read-only generic parameters and `&dyn Trait`/`Box<dyn Trait>` only when
  dynamic dispatch is required (trait objects, pluggable providers). Prefer generics
  (monomorphized) for sealed, crate-internal polymorphism.
- Do not clone large structures defensively. If a clone is required for ownership, `MUST`
  document why (`Arc` would preserve identity / the value is mutated by the consumer).
- Prefer `Arc<T>` for shared immutable data and `Arc<Mutex<T>>` only at the mutation point.
  `Mutex<Arc<T>>` (lock to swap the pointer) is preferred over `Arc<Mutex<T>>` for read-heavy
  config state.
- Use iterators and combinators (`map`, `filter`, `collect`) over imperative loops where
  readability is preserved; they enable fused, allocation-free pipelines.
- Avoid `.clone()` inside hot loops; hoist clones out of the loop or restructure with references.
- Prefer `Option<T>`/`Result<T, E>` and pattern matching over boolean flags and sentinel values
  (`-1`, empty string) — the type system is the documentation.
- Zero-cost abstraction is the default: prefer enums over trait objects when the variant set is
  closed (`enum Event { ... }` over `Box<dyn Handler>`), and `match` over `dyn` dispatch in
  hot paths.
- Measure before optimizing. `MUST NOT` add `unsafe`, exotic allocation tricks, or `Box::leak`
  for performance without a benchmark proving the bottleneck. Optimizations that trade safety or
  clarity for speed require a code review note.
- Prefer `#[inline]` only on tiny, stable, cross-crate hot functions; do not sprinkle `#[inline]`
  over the codebase.
- Memory: avoid unbounded growth in caches and channels. Bounded caches `MUST` have eviction
  policy and `MUST` be sized from config, not hardcoded large constants.

## 10. API Design And Semver

Public API is a semver contract. SDKWork crates are consumed across sibling repositories, so a
public API change can break the workspace at build time.

Rules:

- Public API `MUST` follow the Rust API Guidelines: item naming, documentation, and ergonomics
  (https://rust-lang.github.io/api-guidelines/). At minimum: every public item has a doc
  comment, public functions have doc examples, and `Result` is used for fallible operations.
- Public items `MUST` be documented (`#![warn(missing_docs)]` in library crates or the
  workspace lint baseline). Undocumented public items are a review failure.
- `#[must_use]` `MUST` be applied to functions returning `Result`, `Option`, `Iterator`, and
  guard types. `MUST NOT` ignore an error return value silently.
- Keep the public surface minimal: `pub` only what other crates consume; re-export through the
  crate root; prefer `pub(crate)` for internal plumbing.
- Prefer typed newtypes (`struct TenantId(Uuid)`) over bare primitives for domain identities and
  units; implement `Deref`/`Display`/`From` only when the semantic is preserved.
- Sealed traits: a trait that must not be implemented outside the crate `MUST` be sealed with a
  `pub(crate)` supertrait or the "sealed" module pattern.
- Semver discipline:
  - Breaking changes (remove/rename public item, change signature, tighten bounds, change
    behavior) `MUST` bump the major version or the minor per the repository release policy and
    `MUST` follow `MIGRATION_SPEC.md`.
  - Adding a public item or implementing a trait for a public type is non-breaking.
  - `MUST NOT` change a public type's `Send`/`Sync`/`'static` bounds in a patch release.
  - `MUST NOT` rely on `#[doc(hidden)]` to hide a de-facto public item; remove it or make it
    `pub(crate)`.
- Prefer builder patterns for types with many optional fields; builders `MUST` validate in
  `build()` and return `Result`, not panic.
- Do not expose internal types through public signatures: a public function `MUST NOT` leak
  `sqlx::Row`, `axum` extractors, or provider SDK types. Return domain/API types.
- Default trait implementations `MUST` be documented; `MUST NOT` provide "empty" defaults that
  silently change behavior.
- Generic bounds: prefer the minimum bounds required; add `where` clauses at the implementation
  site rather than the trait definition when possible.

## 11. Documentation Discipline

Documentation is part of the build. `cargo doc` warnings are build warnings.

Rules:

- Every public item `MUST` have a doc comment (`///` or `//!`). Doc comments `MUST` describe the
  contract (what, when it fails, invariants), not restate the code.
- Use `//!` for module-level and crate-level docs (`//!` at the top of `lib.rs` and each
  `mod.rs`).
- Public functions `MUST` document: parameters, return values, and error conditions
  (`# Errors` section). Fallible functions `MUST` explain when each error variant is returned.
- Public APIs `MUST` include at least one runnable doctest example (`/// ``` ``...`), and the
  example `MUST` compile under `cargo test --doc`.
- Use `# Panics`, `# Errors`, `# Safety`, `# Examples`, and `# Returns` section headings
  consistently.
- Internal comments (`//`) explain *why*, not *what*. Restating the code in a comment is noise.
  A comment that explains an invariant, a trade-off, or a historical constraint is valuable.
- `TODO`/`FIXME` markers `MUST` reference a tracking issue or task id; a bare `TODO` is
  forbidden. `dbg!`/`todo!`/`unimplemented!` in committed code are forbidden (see section 7).
- Crate `README.md` `MUST` document: purpose, public surface, usage example, configuration, and
  — when the crate contains `unsafe` or non-obvious invariants — the invariant catalog.
- Generated or boilerplate code `MUST NOT` suppress docs with `#[allow(missing_docs)]` unless
  the generator owns the item and the suppression is documented at the crate root.

## 12. Testing And Verification

Tests are the executable specification. The test pyramid is: unit tests in modules, integration
tests in `tests/`, doctests in public docs, and property tests for invariants.

Rules:

- Every crate `MUST` have unit tests (`#[cfg(test)] mod tests`) covering its non-trivial
  functions, and integration tests in `tests/` covering public behavior through the public API.
- Doctests are mandatory for public APIs (see section 11) and run in `cargo test`.
- Name tests in `given_condition_when_action_then_expectation` or
  `verb_expected_outcome` form (`rejects_negative_amount`, `returns_conflict_on_duplicate_key`).
  Test names `MUST NOT` contain `test_` prefixes and `MUST` read as behavior sentences.
- Each test `MUST` be isolated: no shared mutable global state, no dependence on test order,
  no reliance on wall-clock timing without an explicit tolerance. Parallel-safe by default.
- Database/async tests `MUST` use a dedicated test database or transactional rollback; `MUST NOT`
  point at dev/prod instances. Test data is created and cleaned by the test itself.
- Property-based tests (`proptest` or `quickcheck`) `MUST` cover: round-trips (encode/decode),
  idempotency, ordering invariants, and state-machine transitions where they exist.
- Async tests: use `#[tokio::test]` with an explicit flavor; `MUST NOT` block the executor with
  `block_on` inside a running runtime.
- Mocking: prefer trait fakes (hand-written test doubles in `test_support/`) over deep mock
  frameworks; `MUST NOT` mock what a real, cheap implementation provides.
- Coverage: the changed code path `MUST` be exercised. Coverage tooling (`cargo llvm-cov`,
  tarpaulin) is advisory; a test that does not assert is a liability.
- Test-only code `MUST NOT` be compiled into release binaries: test utilities live in
  `test_support/` behind a feature or in `#[cfg(test)]`, and `MUST NOT` be reachable from
  production paths.
- Regression tests `MUST` accompany every bug fix: first reproduce the failure, then fix, then
  lock the behavior with a test that fails on the old code.
- Run the narrowest `cargo test -p <crate>` first, then `cargo test --workspace` when shared
  contracts are touched (see section 16).

## 13. Manifest And Toolchain Configuration

The workspace manifest is the shared compile-time contract. A uniform baseline makes every crate
predictable and every review cheaper.

Rules:

- Every workspace root `MUST` define `[workspace.package]` with `edition` and `rust-version`, and
  every member `MUST` inherit them (`edition.workspace = true`, `rust-version.workspace = true`).
  New crates `MUST` use edition 2024 when the workspace MSRV allows it; edition 2021 is accepted
  for migration-only crates but `MUST` be listed in a migration note.
- `rust-version` `MUST` be declared and match the CI toolchain. Do not raise MSRV without
  `MIGRATION_SPEC.md` and a CI matrix update.
- Every workspace root `MUST` define a `[workspace.lints]` baseline (see the recommended block
  below), and every member `MUST` inherit it with `[lints] workspace = true`. A member `MAY`
  narrow a lint locally only with a comment; a member `MUST NOT` globally `allow` a baseline
  `deny` without review.
- Recommended baseline:

```toml
[workspace.lints.rust]
unsafe_code = "forbid"                 # reviewed crates change this to "deny" at crate level
unsafe_op_in_unsafe_fn = "deny"        # explicit unsafe blocks in unsafe fn (edition 2024 default)
missing_docs = "warn"                  # library crates: every public item documented
rust_2018_idioms = { level = "warn", priority = -1 }
rust_2024_compatibility = "warn"
single_use_lifetimes = "warn"
trivial_casts = "warn"
trivial_numeric_casts = "warn"
unused_qualifications = "warn"
variant_size_differences = "warn"

[workspace.lints.clippy]
all = "warn"
pedantic = "warn"                      # optional; fix or allow individually
dbg_macro = "deny"
todo = "deny"
unimplemented = "deny"
panic = "deny"                         # library crates; binaries relax locally
unwrap_used = "deny"                   # library crates; tests and binaries relax locally
expect_used = "deny"                   # library crates; tests and binaries relax locally
exit = "deny"
print_stdout = "deny"                  # libraries; CLIs/bins relax locally
print_stderr = "deny"
large_enum_variant = "warn"
needless_pass_by_value = "warn"
must_use_candidate = "warn"
module_name_repetitions = "allow"
cast_possible_truncation = "warn"
cast_lossless = "warn"
```

- `[profile.release]` `MUST` enable `overflow-checks = true` unless a measured hot path requires
  disabling it with a comment; `debug-assertions` and `lto` follow the repository release
  profile policy.
- Features:
  - Feature names use kebab-case (see `NAMING_SPEC.md`).
  - Feature definitions `MUST NOT` enable features of other crates implicitly without declaring
    the dependency; keep feature graphs acyclic and additive.
  - Default features `MUST` be minimal and documented; `MUST NOT` silently change runtime
    behavior between feature sets.
  - A `test-support` feature that exposes test utilities `MUST NOT` be a default feature.
- `[workspace.dependencies]` is the single declaration point for sibling SDKWork crates and
  shared third-party versions (see `DEPENDENCY_MANAGEMENT_SPEC.md`). Member crates consume them
  with `{ workspace = true }`.
- `build.rs` `MUST` be deterministic, `MUST NOT` modify source files, and `MUST NOT` download
  artifacts at build time (see `SUPPLY_CHAIN_SECURITY_SPEC.md`).
- `Cargo.lock` is generated output owned by the repository: regenerate and commit it in the same
  change as any dependency edit (see `NAMING_SPEC.md` section 3.2).

## 14. Dependencies And Supply Chain

Rules:

- Third-party dependencies keep their upstream package, crate, and version names exactly as
  published; SDKWork never renames or re-cases them (`NAMING_SPEC.md` section 3.1 rule 11).
- Dependencies `MUST` be declared at the workspace root (`[workspace.dependencies]`) and
  inherited; member crates `MUST NOT` invent divergent third-party versions.
- Pin meaningful bounds: `cargo update` is deliberate; do not leave wildcard (`*`) or
  floating-major version requirements. Use the governance catalog
  (`configs/dependency-catalog.yaml`) as the version authority (see
  `DEPENDENCY_MANAGEMENT_SPEC.md`).
- Prefer small, well-maintained, audited crates over "kitchen sink" utilities. A new dependency
  `MUST` be justified in the change description; prefer std or a sibling SDKWork crate when
  equivalent.
- `MUST NOT` add a dependency that duplicates a capability already provided by an SDKWork
  sibling crate (see `DEPENDENCY_MANAGEMENT_SPEC.md` and `COMPOSABLE_ARCHITECTURE_SPEC.md`).
- Vendored upstream source under `external/`, `third_party/`, or `vendor/` is read-only, pinned
  to a recorded upstream revision, and never modified (see `DEPENDENCY_MANAGEMENT_SPEC.md`
  section on upstream trees).
- License, audit, and vulnerability checks (`cargo audit`, `cargo deny`) `MUST` run in CI when
  the repository consumes registry dependencies (see `SUPPLY_CHAIN_SECURITY_SPEC.md`).
- Dependency graph hygiene: `MUST NOT` add cyclic path dependencies between sibling crates; the
  layer matrix (section 1.1) is the allowed direction.

## 15. Observability And Logging

Rules:

- Use `tracing` (or `log` behind a documented adapter) consistently. Direct `println!`/
  `eprintln!` in library code is forbidden (baseline `clippy::print_stdout`/`print_stderr`).
- Log at the right level: `error` for failures that need attention, `warn` for recoverable
  anomalies, `info` for lifecycle events, `debug`/`trace` for detail. Do not log secrets,
  tokens, credentials, or PII at any level.
- Every public entrypoint (handler, service method, job, command) `MUST` have a `tracing::span`
  or structured event carrying request/trace/tenant/user context propagated from
  `WebRequestContext` (see `OBSERVABILITY_SPEC.md`).
- Errors logged at the boundary `MUST` include the error chain and the context that identifies
  the failing operation; never log a bare "operation failed".
- `MUST NOT` log full SQL, connection strings, or provider request bodies unless explicitly
  enabled by a debug configuration that is off in production.

## 16. Formatting And Verification

Rules:

- Run `cargo fmt --check` or the repository wrapper before completion. Formatting is not
  optional: rustfmt is the only accepted style.
- Run `cargo clippy --all-targets -- -D warnings` (or the workspace baseline) when the
  repository requires it or when shared Rust code changes. Fix warnings; do not blanket
  `#[allow]` them.
- Run the narrowest `cargo test -p <crate>` first, then `cargo test --workspace` when shared
  contracts are touched. Run `cargo test --doc` when public docs change.
- Run `node ../sdkwork-specs/tools/check-application-layering.mjs --root .` when Rust
  route/service/repository/runtime boundaries are touched in an application repository.
- Run `node ../sdkwork-specs/tools/check-rust-backend-composition.mjs --root .` when Rust
  service, repository, route, migration-only API server, service host, native host, worker, or
  gateway crates are added or their Cargo dependencies change.
- Run `node ../sdkwork-specs/tools/check-rust-crate-naming-standard.mjs --root .` whenever a
  `Cargo.toml` is added or its `[package]`, `[lib]`, `[features]`, `[[bin]]`, or dependency
  tables change. It fails on kebab-case/snake-case violations and on `src/` imports that have
  no declared dependency.
- Run `node ../sdkwork-specs/tools/check-rust-manifest-standard.mjs --root .` to verify the
  workspace lint baseline, `edition`/`rust-version` inheritance, and member `[lints]` wiring
  when manifests are touched.
- Regenerate and commit `Cargo.lock` in the same change as any dependency table edit.
- Route crates must pass route manifest, prefix, authority, and SDK family checks from
  `TEST_SPEC.md`.
- Same-origin dependency surface crates must pass executable mount coverage checks from
  `APP_SDK_INTEGRATION_SPEC.md`, `COMPONENT_SPEC.md`, and `TEST_SPEC.md`.

## 17. Anti-Patterns

Forbidden:

- One giant `lib.rs` containing exports, handlers, SQL, DTOs, services, and tests.
- A crate named with a generic `product`, `runtime`, `backend`, `core`, `common`, or `manager`
  suffix instead of a responsibility-specific suffix.
- Route handlers that perform persistence or provider calls directly.
- Framework-specific types leaking into domain/service contracts.
- Generated SDK clients imported by route crates implementing the same authority.
- Service crates depending on concrete SQLx repository crates instead of ports.
- Repository crates depending on HTTP framework/request context crates.
- Member Cargo manifests declaring sibling SDKWork source `path` dependencies instead of
  `{ workspace = true }`.
- App-local upload/provider logic that bypasses Drive Uploader.
- Treating a route manifest, path constant, or OpenAPI document as proof that a dependency API is
  mounted in the current Rust runtime.
- Deep-importing private dependency source files instead of using the dependency's package-root
  surface integration entrypoint.
- `unwrap`/`expect` on user input, on `Result` from external crates, or in async tasks.
- `panic!`/`unimplemented!`/`todo!` in library code paths reachable from public API.
- Raw `unsafe` without a `// SAFETY:` comment; `unsafe` blocks larger than a few lines.
- `transmute`, `assume_init`, or raw pointer arithmetic outside a reviewed unsafe module.
- Holding a `std::sync::MutexGuard` across `.await`.
- `Rc`/`RefCell` in multi-threaded runtime paths.
- Spawned tasks that are neither awaited nor detached with a documented owner.
- Unbounded channels, unbounded caches, or unbounded retry loops.
- `String`/`anyhow::Error` catch-all error variants instead of typed error enums.
- `Box<dyn Trait>` where a closed enum or a generic would preserve the contract.
- `#[allow(missing_docs)]` on public API without generator ownership.
- Global `static mut` state, `lazy_static` maps used as process-wide mutable globals.
- Logging secrets, tokens, PII, or full SQL payloads.

## 18. Acceptance Checklist

- [ ] `lib.rs` serves as a module assembly file with clear, focused responsibility (module declarations, re-exports, lightweight wiring).
- [ ] Rust crate names use an allowed responsibility-specific family and avoid forbidden generic suffixes.
- [ ] Business logic is in focused modules.
- [ ] Business service, repository implementation, route adapter, migration-only API server, service host,
      native host, worker, and gateway responsibilities are split into their standard directories
      when those capabilities exist.
- [ ] Route crates use `paths.rs`, `routes.rs`, `handlers.rs`, and `manifest.rs` when they own HTTP routes.
- [ ] Authored Rust backend message resources, when present, live under `resources/i18n/<locale>/<domain>/<capability>/` and not in `src/i18n.rs` monoliths.
- [ ] Mountable dependency surfaces expose stable public router/controller/service builders and
      declare them in component specs.
- [ ] Errors are typed or mapped at the boundary; error enums implement `std::error::Error` with a
      `source` chain; no `String` catch-all variants.
- [ ] No `unsafe` in crates that declare `unsafe_code = "forbid"`; reviewed `unsafe` sites carry
      `// SAFETY:` comments and are listed in the crate README.
- [ ] No `unwrap`/`expect`/`panic!`/`todo!`/`dbg!` in library code reachable from public API.
- [ ] No lock held across `.await`; all external awaits have timeouts; retries are bounded and jittered.
- [ ] Public API is minimal, documented, `#[must_use]` where applicable, and semver-clean.
- [ ] Workspace manifest declares `[workspace.package]` (`edition`, `rust-version`),
      `[workspace.lints]`, and every member inherits both.
- [ ] `cargo fmt --check` and relevant `cargo clippy`/`cargo test`/checks are documented and pass.
- [ ] `Cargo.lock` is committed in the same change as any dependency table edit.
