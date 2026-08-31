# SDKWork Rust RPC Standard

- Version: 1.1
- Baseline: Rust `tonic`/`prost` gRPC stack over SDKWork proto contracts
- Scope: Rust standalone/cloud RPC server crates, generated proto crates, typed RPC clients, runtime adapters, bootstrap, tests, and packaging
- Related: `RPC_SPEC.md`, `RPC_FRAMEWORK_SPEC.md`, `RPC_RESILIENCE_SPEC.md`, `DISCOVERY_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, `API_SPEC.md`, `DRIVE_SPEC.md`, `SDK_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `DATABASE_SPEC.md`, `DEPLOYMENT_SPEC.md`, `ENVIRONMENT_SPEC.md`, `SECURITY_SPEC.md`, `OBSERVABILITY_SPEC.md`, `TEST_SPEC.md`, `RUST_CODE_SPEC.md`
- Canonical location: `specs/RUST_RPC_SPEC.md`

This document defines how SDKWork Rust services implement the language-neutral RPC standard. Rust RPC is an adapter layer. It exposes gRPC services and generated clients while preserving the existing SDKWork domain/runtime/storage boundaries.

All Rust baseline rules apply unchanged to RPC crates: error typing and `anyhow` boundaries
(`RUST_CODE_SPEC.md` section 5), safety and `unsafe` discipline (section 6), panic and fallibility
(section 7), async, state, and concurrency (section 8), API design and semver (section 10),
manifest and toolchain configuration (section 13), and formatting/verification (section 16). This
spec adds only the RPC-specific layer (proto contracts, tonic adapters, status mapping) and does
not repeat the shared baseline.

## 1. Rust RPC Positioning

Rust RPC exists to make SDKWork standalone and internal services callable by other languages and service runtimes without giving those callers direct database access.

Rules:

- Rust RPC `MUST` implement `RPC_SPEC.md`.
- Rust RPC servers and approved internal/backend clients `MUST` integrate `sdkwork-rpc-framework` per `RPC_FRAMEWORK_SPEC.md`.
- Discovery-enabled hosts `MUST` register, renew, and deregister through `DISCOVERY_SPEC.md`.
- Resilience behavior `MUST` follow `RPC_RESILIENCE_SPEC.md` profiles rather than ad hoc retry loops in domain crates.
- Rust RPC `MUST` call the same runtime/service/port abstractions as HTTP and Tauri adapters.
- Rust RPC `MUST NOT` call SQLx pools, database queries, HTTP routers, or Tauri commands directly.
- Rust RPC service code `MUST` be thin: metadata/context mapping, proto validation, runtime dispatch, typed response mapping, error mapping, tracing.
- Business logic belongs in domain/service/runtime crates.
- Persistence logic belongs in storage crates such as `sdkwork-*-storage-sqlx-rust`.
- File/object-storage lifecycle RPC belongs to Drive services from `DRIVE_SPEC.md`; business Rust RPC adapters must attach Drive references instead of implementing app-local object storage.

Standard adapter flow:

```text
tonic server
  -> auth/context/deadline/tracing interceptor
  -> typed proto request validation
  -> operationId mapping
  -> sdkwork runtime execution
  -> typed proto response mapping
  -> tonic status/error details
```

## 2. Standard Rust Libraries

| Concern | Standard crate |
| --- | --- |
| gRPC server/client | `tonic` |
| Protobuf message runtime | `prost`, `prost-types` |
| Proto build | `tonic-prost-build` |
| Async runtime | `tokio` |
| Service middleware | `tower` |
| Health checking | `tonic-health` |
| Server reflection | `tonic-reflection` |
| Optional gRPC-Web | `tonic-web` |
| Logging/tracing | `tracing` plus workspace-approved OpenTelemetry crates |

Rules:

- Versions `MUST` be pinned through `Cargo.toml` and `Cargo.lock`.
- New Rust RPC crates SHOULD use workspace-compatible crate versions rather than independently upgrading the gRPC stack.
- `tonic-web` MAY be added only when a browser client must call RPC directly.
- Reflection `MUST` be feature-gated or environment-gated.
- Generated Rust code MUST be produced by the build pipeline and must not be hand-edited.

## 3. Rust Package Split

Rust RPC is split into foundation, generated proto, server adapter, and optional client facade crates.

### 3.1 Foundation RPC Crate

```text
crates/sdkwork-rpc-core-rust/
  Cargo.toml
  src/lib.rs
  src/context.rs
  src/error.rs
  src/metadata.rs
  src/interceptor.rs
  src/health.rs
  src/reflection.rs
  src/deadline.rs
  src/trace.rs
```

Responsibility:

- SDKWork metadata constants.
- Context extraction and validation helpers.
- Token metadata parsing helpers.
- Request id and trace propagation helpers.
- Standard error/status mapping.
- Health/reflection builder helpers.
- Interceptor composition.

Rules:

- `sdkwork-rpc-core-rust` is the Rust-facing foundation crate and `MUST` align with `sdkwork-rpc-framework` primitives defined by `RPC_FRAMEWORK_SPEC.md`.
- `sdkwork-rpc-core-rust` MUST NOT depend on business-domain crates.
- Domain repositories `MUST` depend on framework/server/client crates for pipeline assembly instead of copying interceptor chains locally.
- It MAY depend on `tonic`, `tower`, `prost-types`, `tracing`, and shared Rust foundation crates.
- It MAY depend on `tonic`, `tower`, `prost-types`, `tracing`, and shared Rust foundation crates.
- It MUST expose reusable primitives for IAM, commerce, and future domains.

### 3.2 Domain Proto Crates

```text
crates/sdkwork-iam-rpc-proto-rust/
  Cargo.toml
  build.rs
  src/lib.rs

crates/sdkwork-shop-rpc-proto-rust/
  Cargo.toml
  build.rs
  src/lib.rs
```

Responsibility:

- Compile canonical proto files into Rust modules.
- Re-export generated service clients/servers and messages.
- Keep generated code isolated from handwritten server logic.

Rules:

- Proto source is canonical in common contract packages; proto crates may reference or vendor generated inputs through a documented build step.
- The proto crate MUST NOT contain business logic.
- The proto crate MUST NOT depend on SQLx or domain runtime crates.
- Build scripts MUST fail if required proto files are missing.

### 3.2.1 Rust RPC SDK Generation

Rust RPC proto/client crates generated through `sdkgen --protocol rpc` `MUST` follow
`RPC_SDK_WORKSPACE_SPEC.md`.

Rules:

- Generated protobuf output MUST stay isolated from handwritten server adapters.
- The proto/client crate owns generated messages, service clients, and descriptor inputs.
- The RPC server crate owns context mapping, service binding, runtime dispatch, and error mapping only.
- Generated Rust RPC SDK package metadata MUST identify proto source, RPC manifest, Buf/protoc strategy, and verification commands.

### 3.3 Domain RPC Server Crates

```text
crates/sdkwork-iam-rpc-rust/
  Cargo.toml
  src/lib.rs
  src/server.rs
  src/client.rs
  src/context_mapper.rs
  src/error_mapper.rs
  src/app/
  src/backend/
  tests/iam_rpc_contract.rs

crates/sdkwork-shop-rpc-rust/
  Cargo.toml
  src/lib.rs
  src/server.rs
  src/client.rs
  src/context_mapper.rs
  src/error_mapper.rs
  src/app/
  src/backend/
  tests/commerce_rpc_contract.rs
```

Responsibility:

- Register tonic services.
- Map metadata to SDKWork runtime context.
- Map proto requests to domain/runtime requests.
- Map runtime/domain responses to proto responses.
- Map domain errors to `tonic::Status`.
- Provide typed Rust client helpers when needed.
- Expose service manifest for bootstrap validation.

Rules:

- Domain RPC server crates MAY depend on domain runtime/core/service crates and proto crates.
- Domain RPC server crates MUST NOT depend on HTTP adapter crates.
- Domain RPC server crates MUST NOT depend on Tauri adapter crates.
- Direct dependency on `storage-sqlx-rust` is forbidden unless the crate is an internal migration/control RPC crate and the standard explicitly allows it.

### 3.4 Bootstrap Integration

Existing standalone/cloud bootstrap crates add a stage for RPC binding.

Commerce standard stages:

```text
1. validate-bootstrap-contracts
2. initialize-commerce-storage
3. initialize-commerce-runtime
4. bind-commerce-http-routes
5. bind-commerce-rpc-services
6. bind-commerce-tauri-commands
```

IAM standard stages:

```text
1. validate-bootstrap-contracts
2. initialize-iam-storage
3. initialize-iam-runtime
4. bind-iam-http-routes
5. bind-iam-rpc-services
6. bind-iam-tauri-commands
```

Required bootstrap capabilities:

| Capability | Meaning |
| --- | --- |
| `<domain>.rpc.server` | Creates and serves the tonic server. |
| `<domain>.rpc.service-binding` | Registers app/backend RPC services. |
| `<domain>.rpc.context` | Maps metadata to runtime context. |
| `<domain>.rpc.error-mapping` | Maps service errors to gRPC status/details. |
| `<domain>.rpc.health` | Registers gRPC health status. |
| `<domain>.rpc.reflection` | Registers reflection when enabled. |
| `<domain>.rpc.client` | Optional typed Rust RPC client factory. |

## 4. Dependency Direction

Required direction:

```text
sdkwork-<domain>-rpc-rust
  -> sdkwork-<domain>-rpc-proto-rust
  -> sdkwork-rpc-core-rust
  -> sdkwork-<domain>-runtime-rust
  -> sdkwork-<domain>-core-rust and service crates
  -> storage ports
  -> sdkwork-<domain>-storage-sqlx-rust implementation at host composition only
```

Forbidden direction:

```text
rpc-rust -> http-rust
rpc-rust -> tauri-rust
rpc-rust -> sqlx pool directly
http-rust -> rpc-rust
tauri-rust -> rpc-rust
storage-sqlx-rust -> rpc-rust
```

Rules:

- Host composition may wire runtime handlers to SQLx-backed storage implementations.
- RPC server methods must depend on runtime/service traits, not concrete SQLx stores.
- If an RPC method needs storage migration/admin control, it belongs in a foundation/internal control service with explicit authorization, not in an app business service.

## 5. Cargo Naming

| Package | Crate name | Rust crate import |
| --- | --- | --- |
| `sdkwork-rpc-core-rust` | `sdkwork_rpc_core` | `sdkwork_rpc_core` |
| `sdkwork-iam-rpc-proto-rust` | `sdkwork_iam_rpc_proto` | `sdkwork_iam_rpc_proto` |
| `sdkwork-iam-rpc-rust` | `sdkwork_iam_rpc` | `sdkwork_iam_rpc` |
| `sdkwork-shop-rpc-proto-rust` | `sdkwork_shop_rpc_proto` | `sdkwork_shop_rpc_proto` |
| `sdkwork-shop-rpc-rust` | `sdkwork_shop_rpc` | `sdkwork_shop_rpc` |

Rules:

- Package folder names use existing SDKWork style: `sdkwork-<domain>-rpc-rust`.
- Crate names use snake case: `sdkwork_<domain>_rpc`.
- Proto-only crates include `_rpc_proto`.
- Runtime server crates include `_rpc`.

## 6. Features

Standard Cargo features:

| Feature | Meaning |
| --- | --- |
| `server` | Build tonic server bindings. |
| `client` | Build typed Rust client helpers. |
| `reflection` | Enable reflection registration code. |
| `health` | Enable health registration code. |
| `grpc-web` | Enable `tonic-web` adapter. |
| `tls` | Enable TLS configuration helpers. |
| `mtls` | Enable mutual TLS configuration helpers. |
| `internal-control` | Enable migration/storage/runtime control services. |

Rules:

- `server` and `client` MAY both be enabled by default for internal crates, but generated SDK crates should keep features explicit.
- `reflection` MUST be disabled or access-controlled in public production.
- `internal-control` MUST NOT be enabled for public app clients.

## 7. Build Script Standard

Proto crates use `build.rs` with `tonic-prost-build`.

Rules:

- Build scripts MUST list proto files explicitly or read from a checked-in manifest.
- Build scripts MUST include all import roots explicitly.
- Generated Rust output MUST be deterministic.
- Build scripts SHOULD generate a descriptor set for reflection and compatibility verification.
- Build scripts MUST fail when proto contracts are missing, ambiguous, or not checked in.

Example shape:

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_prost_build::configure()
        .build_server(true)
        .build_client(true)
        .compile_protos(
            &[
                "../../../../../common/shop/sdkwork-shop-rpc-contracts/proto/sdkwork/shop/app/v3/checkout_service.proto",
            ],
            &[
                "../../../../../common/rpc/sdkwork-rpc-contracts/proto",
                "../../../../../common/shop/sdkwork-shop-rpc-contracts/proto",
            ],
        )?;

    Ok(())
}
```

The final path layout may differ, but the manifest must make the source contract explicit.

## 8. Server Construction

Every domain RPC crate exposes a server builder.

Required public shape:

```rust
pub struct CommerceRpcServerConfig {
    pub bind_addr: String,
    pub enable_health: bool,
    pub enable_reflection: bool,
    pub require_tls: bool,
}

pub struct CommerceRpcServices<R> {
    pub runtime: R,
}

pub fn commerce_rpc_service_manifest() -> CommerceRpcServiceManifest;
```

Rules:

- Server config MUST be plain Rust data and serializable by host bootstrap when appropriate.
- Service manifest MUST list package, service, method, operationId, auth, and idempotency metadata.
- The server builder MUST register app and backend services separately.
- Internal/control services MUST require explicit feature and config enablement.

## 9. Interceptors And Context Mapping

Standard interceptor responsibilities:

1. Validate metadata key format.
2. Extract `authorization` and `access-token`.
3. Extract `x-request-id`, `traceparent`, `idempotency-key`, and `x-request-hash`.
4. Resolve or validate tenant/user/session context from dual tokens or a server-side session lookup.
5. Apply deadline and cancellation behavior.
6. Attach SDKWork context to request extensions.
7. Start trace span and record service/method metadata.

Rules:

- Context mapping MUST reject any metadata or payload value that attempts to override token-derived context.
- IAM metadata, token, and AppContext validation MUST follow `IAM_LOGIN_INTEGRATION_SPEC.md`; RPC adapters validate context and dispatch to runtime services, but do not create application-local login/session flows.
- Metadata parsing MUST be case-insensitive where gRPC metadata semantics require it, but SDKWork code should emit lowercase keys.
- Interceptors MUST NOT perform business authorization alone; service/runtime authorization still applies.

## 10. Error Mapping

Every domain RPC crate provides an error mapper:

```rust
pub fn map_service_error(error: CommerceServiceError) -> tonic::Status;
```

Rules:

- Error mapping MUST follow `RPC_SPEC.md`.
- Client-safe messages MUST be separated from internal logs.
- Validation errors SHOULD include field-level details when the proto error detail strategy supports it.
- Unknown errors MUST be logged with request id and trace id before returning a generic status.

## 11. Rust Client Facade

Rust RPC clients are optional but recommended for internal consumers.

Rules:

- Client facades MUST wrap generated tonic clients without hiding generated request/response types.
- Client constructors MUST support endpoint, TLS/mTLS, token provider, request id provider, default deadline, and retry policy.
- Client retries MUST honor operation idempotency from the manifest.
- Client facade methods SHOULD mirror proto method names, not HTTP SDK resource-style chains.

## 12. Standard Rust RPC Services

Rust implementation crates MUST expose the service catalog defined in `RPC_SPEC.md` using these modules.

### 12.1 IAM

```text
sdkwork_iam_rpc::app::session_service
sdkwork_iam_rpc::app::verification_service
sdkwork_iam_rpc::app::password_recovery_service
sdkwork_iam_rpc::app::registration_service
sdkwork_iam_rpc::app::oauth_session_service
sdkwork_iam_rpc::app::qr_auth_service
sdkwork_iam_rpc::app::current_user_service

sdkwork_iam_rpc::backend::tenant_admin_service
sdkwork_iam_rpc::backend::organization_admin_service
sdkwork_iam_rpc::backend::user_admin_service
sdkwork_iam_rpc::backend::role_admin_service
sdkwork_iam_rpc::backend::permission_admin_service
sdkwork_iam_rpc::backend::policy_admin_service
sdkwork_iam_rpc::backend::api_key_admin_service
sdkwork_iam_rpc::backend::iam_audit_service
```

### 12.2 Commerce

```text
sdkwork_commerce_rpc::app::account_service
sdkwork_commerce_rpc::app::address_service
sdkwork_commerce_rpc::app::cart_service
sdkwork_commerce_rpc::app::catalog_query_service
sdkwork_commerce_rpc::app::checkout_service
sdkwork_commerce_rpc::app::coupon_service
sdkwork_commerce_rpc::app::order_service
sdkwork_commerce_rpc::app::payment_service
sdkwork_commerce_rpc::app::refund_service
sdkwork_commerce_rpc::app::fulfillment_service
sdkwork_commerce_rpc::app::shipment_service
sdkwork_commerce_rpc::app::recharge_service
sdkwork_commerce_rpc::app::wallet_service
sdkwork_commerce_rpc::app::membership_service
sdkwork_commerce_rpc::app::invoice_service

sdkwork_commerce_rpc::backend::catalog_admin_service
sdkwork_commerce_rpc::backend::inventory_admin_service
sdkwork_commerce_rpc::backend::order_admin_service
sdkwork_commerce_rpc::backend::payment_admin_service
sdkwork_commerce_rpc::backend::refund_admin_service
sdkwork_commerce_rpc::backend::fulfillment_admin_service
sdkwork_commerce_rpc::backend::membership_admin_service
sdkwork_commerce_rpc::backend::recharge_admin_service
sdkwork_commerce_rpc::backend::wallet_admin_service
sdkwork_commerce_rpc::backend::coupon_admin_service
sdkwork_commerce_rpc::backend::invoice_admin_service
sdkwork_commerce_rpc::backend::commerce_audit_service
sdkwork_commerce_rpc::backend::commerce_report_service
```

### 12.3 Foundation/Internal

```text
sdkwork_rpc_core::runtime_manifest_service
sdkwork_rpc_core::migration_control_service
sdkwork_rpc_core::storage_contract_service
sdkwork_rpc_core::health
sdkwork_rpc_core::reflection
```

Internal control services may live in `sdkwork-rpc-core-rust` or in a future `sdkwork-foundation-rpc-rust` crate if they need host-specific dependencies.

## 13. Testing

Required tests for every domain RPC crate:

| Test | Requirement |
| --- | --- |
| Proto compile test | `cargo test` or build proves generated proto compiles. |
| Service manifest test | Every registered method has package, service, method, operationId, auth, idempotency policy. |
| Operation parity test | Shared methods map to known HTTP operationIds where HTTP parity exists. |
| Metadata test | Auth, access token, request id, trace, idempotency metadata are accepted/rejected correctly. |
| Error mapping test | Each service error kind maps to expected `tonic::Code`. |
| Unary smoke test | In-process tonic server/client calls at least one app and one backend service. |
| Reflection/health test | Health and reflection are enabled/disabled by config. |
| No forbidden dependency test | RPC crates do not depend on HTTP/Tauri adapters or direct SQLx storage unless explicitly approved. |

Example commands:

```text
cargo test -p sdkwork-iam-rpc-rust
cargo test -p sdkwork-shop-rpc-rust
```

## 14. Environment And Deployment

Standard environment keys:

| Key | Meaning |
| --- | --- |
| `SDKWORK_RPC_ENABLED` | Enable domain RPC server. |
| `SDKWORK_RPC_BIND_ADDR` | Bind address, for example `127.0.0.1:50051` in local mode. |
| `SDKWORK_RPC_PUBLIC_ENDPOINT` | Endpoint used by generated external clients. |
| `SDKWORK_RPC_TLS_ENABLED` | Enable TLS. |
| `SDKWORK_RPC_MTLS_ENABLED` | Require client certificates. |
| `SDKWORK_RPC_REFLECTION_ENABLED` | Enable reflection. |
| `SDKWORK_RPC_HEALTH_ENABLED` | Enable health service. |
| `SDKWORK_RPC_GRPC_WEB_ENABLED` | Enable gRPC-Web bridge. |
| `SDKWORK_RPC_DEFAULT_DEADLINE_MS` | Default server/client deadline. |

Rules:

- Standalone desktop/development targets MAY bind to loopback without TLS when
  documented as local-only.
- Cloud production and customer-owned service production SHOULD require TLS;
  service-to-service production SHOULD use mTLS.
- Public app RPC endpoints must be behind approved ingress/proxy/security controls.
- Reflection must not be publicly exposed without access control.

## 15. Implementation Order

Recommended implementation sequence:

1. Add common proto contracts and descriptor generation.
2. Add `sdkwork-rpc-core-rust`.
3. Add IAM proto and proto Rust crate.
4. Add IAM RPC server crate with app session/current-user and backend user/role smoke methods.
5. Add Commerce proto and proto Rust crate.
6. Add Commerce RPC server crate with wallet/checkout/payment smoke methods.
7. Add bootstrap stage and service manifest validation.
8. Add generated non-Rust client smoke test for one public package.
9. Expand method coverage service by service.

The first runnable slice SHOULD include health, reflection in local mode, one app IAM service, one backend IAM service, one app commerce service, one backend commerce service, and contract tests.

## 16. External Baselines

- Tonic: https://docs.rs/tonic/latest/tonic/
- Prost: https://docs.rs/prost/latest/prost/
- tonic-prost-build: https://docs.rs/tonic-prost-build/latest/tonic_prost_build/
- tonic-health: https://docs.rs/tonic-health/latest/tonic_health/
- tonic-reflection: https://docs.rs/tonic-reflection/latest/tonic_reflection/
- tonic-web: https://docs.rs/tonic-web/latest/tonic_web/
