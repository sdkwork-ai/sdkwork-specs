# SDKWork RPC And gRPC Standard

- Version: 1.2
- Baseline: gRPC over HTTP/2, Protocol Buffers proto3, SDKWork v3 operation semantics
- Scope: cross-language RPC contracts, Rust services, Java/Rust parity services, generated RPC clients, service-to-service calls, internal deployment APIs, local desktop host RPC
- Related: `API_SPEC.md`, `DATABASE_SPEC.md`, `DRIVE_SPEC.md`, `MEDIA_RESOURCE_SPEC.md`, `SDK_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, `RPC_FRAMEWORK_SPEC.md`, `RPC_RESILIENCE_SPEC.md`, `DISCOVERY_SPEC.md`, `DOMAIN_SPEC.md`, `IAM_SPEC.md`, `SECURITY_SPEC.md`, `OBSERVABILITY_SPEC.md`, `TEST_SPEC.md`, `RUST_RPC_SPEC.md`
- Canonical location: `specs/RPC_SPEC.md`

This document defines the language-neutral RPC standard for SDKWork. It adds a gRPC/protobuf contract layer for direct use by Rust, Java, Go, Python, TypeScript, Dart, C#, and other language runtimes without replacing the existing HTTP/OpenAPI app API and backend API standards.

The standard architecture is dual-protocol: HTTP/OpenAPI and gRPC/protobuf are peer adapters over the same domain runtime, service, command/query, port, idempotency, transaction, storage, security, and observability contracts. A new RPC implementation MUST NOT create a second business implementation or bypass existing service/runtime abstractions.

## 1. Normative Language

The words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` use RFC-style meaning.

| Term | Meaning |
| --- | --- |
| `MUST` | Required. A contract that violates this rule is not SDKWork-standard. |
| `MUST NOT` | Forbidden. Do not bypass this with local convention. |
| `SHOULD` | Strong recommendation. Deviation requires a documented reason. |
| `SHOULD NOT` | Strong negative recommendation. Deviation requires a documented reason. |
| `MAY` | Optional capability decided by product, compliance, deployment, or compatibility needs. |

## 2. Standard Levels

| Level | Name | Minimum bar |
| --- | --- | --- |
| L0 | Legacy Bridge | Existing local interfaces have a migration map to canonical RPC contracts. |
| L1 | Portable Core | proto3 files compile, generated clients work in at least Rust and one non-Rust language, unary methods expose stable request/response messages. |
| L2 | Service Ready | Metadata auth, deadlines, standard errors, health checks, reflection in non-production or approved private environments, contract tests, idempotency for writes. |
| L3 | Enterprise Grade | mTLS, least-privilege authorization, audit, OpenTelemetry traces/metrics, breaking-change gates, generated multi-language SDK release manifest, formal deprecation windows. |

New IAM, commerce, payment, billing, membership, wallet, admin, and storage-control RPC surfaces `MUST` target L2. Security-sensitive, money-moving, operator-facing, and cross-service production RPC surfaces `SHOULD` target L3.

## 3. Source Of Truth

The `.proto` contract is the source of truth for RPC. Rust structs, Java classes, TypeScript interfaces, SQL models, HTTP routes, generated code, and README examples are implementation details unless they match the proto contract.

Required artifacts:

| Artifact | Requirement |
| --- | --- |
| Proto package | `syntax = "proto3";`, canonical package name, explicit imports, stable messages, stable service methods, stable field numbers. |
| RPC manifest | Domain, surface, package, service, method, operationId mapping, auth level, idempotency requirement, streaming mode, owner, compatibility level. |
| Generated clients | Generated from proto, never hand-edited, versioned with proto source and generator version. |
| Contract tests | Proto lint, breaking-change check, Rust server/client smoke test, at least one non-Rust generation check for public RPC packages. |
| Changelog | Breaking, additive, deprecated, and removed services/methods/messages/fields. |
| Exception register | Any non-standard metadata, field type, package name, auth model, or streaming behavior. |

Rules:

- RPC contracts `MUST` be reviewed as public or semi-public API contracts, not as private Rust implementation details.
- Existing HTTP operationIds `MUST` remain the semantic bridge between HTTP/OpenAPI and gRPC/protobuf for shared appbase operations.
- A gRPC method `MUST` map to exactly one SDKWork operation id unless it is a documented composition method. Composition methods must list all child operationIds.
- A service implementation `MUST` call the same runtime/service/port boundary used by HTTP or Tauri adapters.
- RPC adapters `MUST NOT` call SQLx repositories, database pools, HTTP routers, or Tauri commands directly.

## 3.1 RPC SDK Generation Boundary

RPC SDK package layout, RPC SDK family naming, proto generation workspace, language output placement, SDKWork RPC generation manifests, and `sdkgen --protocol rpc` verification are governed by `RPC_SDK_WORKSPACE_SPEC.md`.

Rules:

- RPC SDKs `MUST` be generated from proto contracts and the SDKWork RPC manifest.
- RPC SDK generation `MUST NOT` hand-edit generated protobuf output.
- RPC SDK generation is additive to existing OpenAPI HTTP SDK generation. Existing `sdkgen generate` commands without an explicit RPC protocol remain HTTP/OpenAPI generation.
- Missing RPC client capability `MUST` be fixed by updating proto contracts and the RPC manifest, then regenerating.

## 3.2 RPC Identity

SDKWork RPC identity is used consistently in logs, metrics, traces, audits, discovery metadata, manifests, and parity checks. Full invocation-runtime rules live in `RPC_FRAMEWORK_SPEC.md`.

Canonical identity URI:

```text
sdkwork-rpc://{namespace}/{environment}/{rpc_surface}/{proto_package}/{Service}/{Method}?operationId={dotted.id}
```

Example:

```text
sdkwork-rpc://acme/production/internal/sdkwork.communication.internal.v1/RoomOrchestrationService/CreateRoom?operationId=rooms.create
```

Rules:

- `rpc_surface` `MUST` be one of `app`, `backend`, `internal`, or `common`.
- `operationId` `MUST` match the RPC manifest and `apis/rpc/parity-registry.yaml` when HTTP parity exists.
- Observability and audit records `MUST` include `proto_package`, `service`, `method`, `operationId`, and `rpc_surface`.

## 3.3 Discovery Registration Metadata

RPC data-plane servers that use dynamic discovery `MUST` register through `DISCOVERY_SPEC.md` with metadata that links contract identity to runtime identity.

Required discovery metadata for business RPC services:

| Metadata key | Requirement |
| --- | --- |
| `rpc_surface` | `app`, `backend`, `internal`, or `common`. |
| `sdk_family` | Owning RPC SDK family such as `sdkwork-im-rpc-sdk`. |
| `domain` | Canonical domain from `DOMAIN_SPEC.md`. |
| `proto_packages` | Comma-separated or JSON list of served proto packages. |
| `operation_manifest_ref` | Path or URI to RPC manifest or service manifest used by CI. |

Rules:

- `service_name` `MUST` follow `NAMING_SPEC.md` discovery service naming.
- Static endpoint configuration `MAY` be used only in approved standalone or development profiles documented by `RPC_FRAMEWORK_SPEC.md`.
- Cloud and multi-instance production RPC `MUST` resolve peers through `sdkwork-discovery` unless a governed migration exception records a temporary static resolver.

## 3.4 Resolver Selection Matrix

| Caller environment | Resolver profile | Notes |
| --- | --- | --- |
| Browser, H5, mini program, most mobile UI | none for discovery | Continue HTTP SDKs; do not call discovery directly. |
| Standalone loopback dev | `static` | Fixed endpoint allowed with documented local-only policy. |
| Single-process local orchestration | `static-composite` | Topology manifest endpoint table. |
| Cloud or multi-instance production | `discovery` | Default through `sdkwork-discovery`. |
| Migration window | `composite` | Discovery primary with temporary static fallback only when `MIGRATION_SPEC.md` records the window. |

## 4. Protocol Profile

SDKWork standard RPC uses:

| Concern | Standard |
| --- | --- |
| Transport | gRPC over HTTP/2. |
| IDL | Protocol Buffers proto3. |
| Default method kind | Unary request/response. |
| Streaming | Allowed only when the domain explicitly needs events, logs, progress, realtime state, or large incremental transfer. |
| Browser usage | gRPC-Web is optional and must be explicitly enabled per app. Normal frontend UI continues to use generated HTTP SDKs unless a product explicitly selects gRPC-Web. |
| Gateway | JSON/HTTP gateway MAY be generated for internal compatibility, but it MUST NOT replace `API_SPEC.md` OpenAPI source-of-truth for HTTP app/backend APIs. |
| Health | Use standard gRPC health checking. |
| Reflection | SHOULD be enabled only in standalone development and controlled internal operations. It MUST be disabled or access-controlled in public production. |

Rules:

- Unary methods are the default because they map cleanly to existing SDKWork operationIds, idempotency, transactions, and generated client surfaces.
- Client streaming and bidirectional streaming require a documented backpressure, cancellation, auth, audit, and retry policy.
- Long-running commands SHOULD return an operation/job resource or use server streaming for progress; they MUST NOT hold a transaction open while waiting on external providers.
- Every client call SHOULD set a deadline. Server implementations MUST observe cancellation.

## 5. Surfaces

SDKWork RPC has the same app/backend separation as HTTP plus an internal-only surface for host and service operations.

| Surface | Proto package segment | Audience | Auth |
| --- | --- | --- | --- |
| App RPC | `app.v3` | Application clients, desktop/mobile hosts, standalone/cloud app clients | App auth/session token model. |
| Backend RPC | `backend.v3` | Admin consoles, operator tooling, backend SDKs | Backend/operator token or service identity. |
| Internal RPC | `internal.v1` or `internal.v3` | Service-to-service, local host, migration/runtime orchestration | mTLS or explicit standalone/internal trust boundary. |
| Common RPC | `common.v1` | Shared messages only, no business service ownership | No direct app endpoint. |

Rules:

- Login, register, refresh, logout, OAuth session, password reset, current user, QR auth, and verification-code RPC methods `MUST` live in app RPC only. Verification-code RPCs are messaging-owned and must align with the messaging app API operationIds.
- Backend RPC `MUST NOT` expose auth/session login methods.
- Internal RPC `MUST NOT` be reachable from public app clients.
- App and backend RPC packages MUST preserve the same semantic separation as `/app/v3/api` and `/backend/v3/api`.

## 5.1 Dual-Protocol Selection Matrix

SDKWork uses HTTP/OpenAPI and gRPC/protobuf as peer adapters over the same domain runtime. Choosing a transport is a boundary decision, not a business-model decision.

| Caller | Callee | Preferred transport | Notes |
| --- | --- | --- | --- |
| Browser, H5, mini program, most mobile UI | App/backend product APIs | HTTP app-api / backend-api SDK | Default per `RPC_SPEC.md` §4 and `APP_SDK_INTEGRATION_SPEC.md`. |
| Browser, H5, mini program, most mobile UI | IM realtime fanout | HTTP SDK + WebSocket realtime | Realtime subscriptions are not replaced by unary RPC. |
| Desktop/native host with approved gRPC-Web policy | App RPC | gRPC-Web or local host RPC | Requires explicit product ADR and browser transport policy. |
| Service-to-service orchestration | Another domain internal surface | Internal RPC (`internal.v1` / `internal.v3`) | Preferred over looping HTTP app SDK through a gateway with user tokens. |
| Service-to-service orchestration | Same-domain runtime in-process | In-process port/trait | Preferred when services are co-located; RPC is for cross-process boundaries. |
| Operator/admin console | Backend admin resources | HTTP backend-api SDK or backend RPC | Backend surface only. |
| High-frequency game command stream | Game runtime | App RPC stream and/or dedicated game realtime channel | Do not route high-frequency game state through IM message tables. |

Rules:

- A missing RPC method `MUST` be fixed by updating proto contracts and the RPC manifest, then regenerating. Consumers `MUST NOT` fill the gap with raw HTTP or raw gRPC stubs when an SDKWork RPC family exists.
- A missing HTTP app/backend method `MUST` be fixed by updating the owning OpenAPI authority and regenerating HTTP SDKs. RPC `MUST NOT` become the hidden public API for browser clients.
- Cross-domain orchestration such as game session creation binding IM rooms or RTC media sessions `SHOULD` use internal RPC on the provider domain once available. Until the internal RPC exists, gateway HTTP with service identity `MAY` be used only behind a documented migration exception.
- Internal RPC `MUST NOT` be exposed on public app ingress. Internal RPC servers `SHOULD` bind to private service networks or approved standalone loopback addresses per `ENVIRONMENT_SPEC.md` §15.

## 5.2 HTTP And RPC Parity Registry

Every domain that exposes both HTTP and RPC for the same operation `MUST` maintain a parity registry.

Recommended artifact:

```text
<application-or-domain-root>/apis/rpc/parity-registry.yaml
```

Minimum fields per mapped operation:

| Field | Requirement |
| --- | --- |
| `operationId` | Stable dotted SDKWork operation id shared by HTTP and RPC. |
| `httpSurface` | `open-api`, `app-api`, or `backend-api` when HTTP exists. |
| `httpPath` | OpenAPI path template when HTTP exists. |
| `rpcPackage` | Canonical proto package name. |
| `rpcService` | PascalCase service name. |
| `rpcMethod` | PascalCase method name. |
| `rpcSurface` | `app`, `backend`, `internal`, or `common`. |
| `parityStatus` | `full`, `rpc-only`, `http-only`, `composition`, or `deprecated`. |
| `owner` | Owning API authority or service team. |

Rules:

- Shared operations `MUST` use the same `operationId` on HTTP and RPC unless the RPC method is a documented composition method.
- `http-only` entries `MUST` include a reason, for example browser-only upload workflow or provider webhook ingress.
- `rpc-only` entries `MUST` include a reason, for example internal orchestration or host-only runtime control.
- `composition` entries `MUST` list child `operationId` values consumed by the RPC method.
- Parity drift `SHOULD` be checked in CI together with proto breaking-change checks and OpenAPI contract tests.

## 6. Package Naming

SDKWork separates three naming layers. They MUST NOT be collapsed into one token.

| Layer | Purpose | `rpc` segment required? | Example |
| --- | --- | --- | --- |
| Proto `package` | Domain contract semantics | `MUST NOT` | `sdkwork.game.app.v3` |
| Contract filesystem | Artifact kind and review boundary | `MUST` via `apis/rpc/` root | `apis/rpc/sdkwork/game/app/v3/session_service.proto` |
| SDK / crate / module | Consumer artifact identity | `MUST` | `sdkwork-game-rpc-sdk`, `sdkwork_game_rpc_proto` |

### 6.1 Proto Package Grammar

Proto package names use domain-first grammar:

```text
sdkwork.<domain>.<surface>.v<major>
sdkwork.<domain>.internal.v<major>
sdkwork.common.v<major>
```

Examples:

```proto
package sdkwork.iam.app.v3;
package sdkwork.iam.backend.v3;
package sdkwork.commerce.app.v3;
package sdkwork.commerce.backend.v3;
package sdkwork.communication.app.v3;
package sdkwork.communication.internal.v1;
package sdkwork.game.app.v3;
package sdkwork.game.internal.v1;
package sdkwork.foundation.internal.v1;
package sdkwork.common.v1;
```

Rules:

- Proto `package` names `MUST` be lowercase dot-separated segments.
- Proto `package` names `MUST NOT` include a transport segment such as `rpc`, `grpc`, `http`, or `openapi`.
- Domain segment `MUST` come from `DOMAIN_SPEC.md`.
- `<surface>` `MUST` be one of `app.v<major>`, `backend.v<major>`, or `internal.v<major>`.
- Version segment `v3` aligns with SDKWork app/backend API v3. Common/internal packages MAY use `v1` when they do not expose product API version semantics.
- A package `MUST NOT` mix app and backend services.
- Putting `rpc` into the proto `package` line is forbidden because SDKWork RPC and HTTP are peer adapters over the same domain semantics. Transport belongs to directory layout, RPC manifest kind, SDK family names, env keys, and server bind config—not to the domain package namespace.

### 6.2 Filesystem And SDK Naming

File paths mirror proto package names under an RPC contract root:

```text
apis/rpc/sdkwork/common/v1/context.proto
apis/rpc/sdkwork/iam/app/v3/session_service.proto
apis/rpc/sdkwork/iam/backend/v3/user_admin_service.proto
apis/rpc/sdkwork/commerce/app/v3/checkout_service.proto
apis/rpc/sdkwork/communication/app/v3/message_service.proto
apis/rpc/sdkwork/communication/internal/v1/room_orchestration_service.proto
apis/rpc/sdkwork/game/app/v3/session_service.proto
apis/rpc/sdkwork/game/internal/v1/matchmaking_service.proto
```

Rules:

- Authoritative RPC proto sources `MUST` live under `apis/rpc/` or an application-root `proto/` tree referenced by `kind: sdkwork.rpc.manifest`.
- RPC SDK family directories `MUST` include the `-rpc-sdk` suffix per `RPC_SDK_WORKSPACE_SPEC.md`.
- Generated language module names `MUST` include `rpc`, for example `com.sdkwork.game.rpc`, `sdkwork_game_rpc_proto`, or `@sdkwork/game-rpc-sdk`.
- `go_package`, `java_package`, `csharp_namespace`, and Rust module layout `MUST` be explicit and `SHOULD` include an `rpc` segment in the language module path even when the proto package remains domain-first.
- Legacy proto packages that predate this section, such as `sdkwork.communication.app.v3`, remain valid and `MUST NOT` be renamed solely to add an `rpc` proto segment.

### 6.3 Proto File Rules

- Proto file names `MUST` be lowercase snake_case.
- One primary service per proto file `SHOULD` be the default; small tightly coupled services `MAY` share a file when they belong to one bounded context.
- Generated language package options must be explicit, for example `go_package`, `java_package`, `csharp_namespace`, and Rust module layout through the Rust build.

## 7. Service Naming

Services use PascalCase and end with `Service`.

| Service type | Pattern | Example |
| --- | --- | --- |
| App business service | `<Resource>Service` | `CheckoutService`, `WalletService` |
| App auth/current service | `<Capability>Service` | `SessionService`, `CurrentUserService` |
| Backend admin service | `<Resource>AdminService` | `UserAdminService`, `PaymentAdminService` |
| Internal runtime service | `<Capability>RuntimeService` or `<Capability>ControlService` | `RuntimeManifestService`, `MigrationControlService` |
| Query-only service | `<Resource>QueryService` | `CatalogQueryService` |

Rules:

- Service names SHOULD match bounded context and operational ownership.
- A service should contain cohesive methods over one aggregate, workflow, or admin surface.
- A service MUST NOT become a catch-all such as `CommerceService` when bounded context services are clearer.
- Backend admin services MUST include `AdminService` unless the service is explicitly read-only reporting or audit.

## 8. Method Naming And OperationIds

RPC method names use PascalCase verbs and stable nouns. They map to SDKWork dotted operationIds.

| operationId action | RPC method verb |
| --- | --- |
| `create` | `Create<Resource>` |
| `retrieve` | `Retrieve<Resource>` |
| `list` | `List<ResourcePlural>` |
| `update` | `Update<Resource>` |
| `delete` | `Delete<Resource>` |
| `refresh` | `Refresh<Resource>` |
| `revoke` | `Revoke<Resource>` |
| `cancel` | `Cancel<Resource>` |
| `close` | `Close<Resource>` |
| `submit` | `Submit<Resource>` |
| `verify` | `Verify<Resource>` |
| `grant` | `Grant<Resource>` |
| `release` | `Release<Resource>` |
| `adjust` | `Adjust<Resource>` |
| `publish` | `Publish<Resource>` |
| `archive` | `Archive<Resource>` |
| `replay` | `Replay<Resource>` |

Example:

```proto
service CheckoutService {
  rpc CreateCheckoutSession(CreateCheckoutSessionRequest)
      returns (CreateCheckoutSessionResponse);

  rpc RetrieveCheckoutSession(RetrieveCheckoutSessionRequest)
      returns (RetrieveCheckoutSessionResponse);

  rpc CreateCheckoutSessionQuote(CreateCheckoutSessionQuoteRequest)
      returns (CreateCheckoutSessionQuoteResponse);

  rpc CreateCheckoutSessionOrder(CreateCheckoutSessionOrderRequest)
      returns (CreateCheckoutSessionOrderResponse);
}
```

Operation mapping:

| RPC method | operationId |
| --- | --- |
| `CreateCheckoutSession` | `checkout.sessions.create` |
| `RetrieveCheckoutSession` | `checkout.sessions.retrieve` |
| `CreateCheckoutSessionQuote` | `checkout.sessions.quotes.create` |
| `CreateCheckoutSessionOrder` | `checkout.sessions.orders.create` |

Rules:

- Every RPC method `MUST` have an `operationId` mapping in the RPC manifest.
- Method names `MUST` avoid HTTP vocabulary such as `Post`, `Get`, `Patch`, or `Endpoint`.
- Method names `MUST NOT` include path parameter names unless the parameter disambiguates a nested resource.
- Method names SHOULD stay stable even if HTTP paths change.

## 9. Message Naming

Every RPC method uses a dedicated request and response message:

```proto
rpc CreateOrder(CreateOrderRequest) returns (CreateOrderResponse);
```

Rules:

- Request messages `MUST` end with `Request`.
- Response messages `MUST` end with `Response`.
- Shared entity messages MAY be reused across methods only when they are stable domain views, not accidental transport DTOs.
- Field names use `snake_case`.
- Request messages SHOULD contain business input fields only; auth, tenant, request id, trace id, idempotency key, deadline, and caller context belong in metadata unless the business model needs them as data.
- Response messages SHOULD include the direct resource/result field and optional common metadata, not a generic `body_json` field for public RPC.
- Internal adapter-level methods MAY use `body_json` only for compatibility with an existing runtime dispatch contract and must be hidden behind typed public service methods.

## 10. Type Mapping

| SDKWork logical type | Proto type | Notes |
| --- | --- | --- |
| external id, uuid, business_no | `string` | Preferred for cross-language public contracts. |
| internal int64 id | `int64` or `string` | Public/gateway-safe APIs SHOULD use `string`; trusted internal RPC MAY use `int64`. |
| decimal/money amount | `string` or `sdkwork.common.v1.Decimal` | Do not use floating point for money. |
| currency | `string` | ISO code or configured token symbol. |
| timestamp/instant | `google.protobuf.Timestamp` | Boundary adapters may render ISO 8601 UTC for JSON. |
| date | `google.type.Date` or `string` | Use `string` if the language/tooling set does not standardize `google.type.Date`. |
| boolean | `bool` | Avoid tri-state bool; use enum or optional wrapper when needed. |
| enum | `enum` | Must include `*_UNSPECIFIED = 0`. |
| JSON extension | `google.protobuf.Struct` | Avoid for core fields. |
| binary | `bytes` | Use Drive upload sessions, Drive download grants, Drive-owned streaming, or storage references for large files. Use `sdkwork.common.v1.MediaResource` for persisted or shareable media references. |
| repeated list | `repeated T` | Use pagination for unbounded lists. |

Rules:

- Money, decimal, and token amounts `MUST NOT` use `float` or `double`.
- Enums `MUST` reserve zero for unspecified/unknown and use uppercase snake case values.
- Removed fields `MUST` be marked `reserved` by number and name.
- Field numbers `1` to `15` SHOULD be used for high-frequency fields.
- Field numbers `19000` to `19999` are reserved for SDKWork internal extensions and must not be used by business schemas.

## 11. Common Messages

Common messages live under `sdkwork.common.v1` and are imported by business packages.

Required common files:

```text
proto/sdkwork/common/v1/context.proto
proto/sdkwork/common/v1/error.proto
proto/sdkwork/common/v1/pagination.proto
proto/sdkwork/common/v1/money.proto
proto/sdkwork/common/v1/media.proto
proto/sdkwork/common/v1/audit.proto
proto/sdkwork/common/v1/idempotency.proto
proto/sdkwork/common/v1/runtime.proto
```

Standard common message set:

| Message | Purpose |
| --- | --- |
| `AppContext` | Tenant, organization, user, session, app, environment, deployment profile, runtime target, surface profile. |
| `CallerContext` | Actor/service identity and auth level for backend/internal calls. |
| `PageRequest` | Page size, cursor, sort, filters for list methods. |
| `PageResponse` | Next cursor, total count policy, list metadata. |
| `Money` | Decimal amount string and currency. |
| `Decimal` | Decimal string with precision/scale metadata when required. |
| `MediaResource` | Stable image, video, audio, voice, document, archive, object-storage, provider-asset, or generated-media reference. |
| `MediaAccess` | Visibility and expiry semantics for media delivery. |
| `MediaAiProvenance` | Provider, model, task, moderation, and provenance metadata for generated or edited media. |
| `DriveReference` | Optional common reference for Drive-backed files when a service needs space/node identity in addition to `MediaResource`. |
| `RequestMetadata` | Request id, trace id, idempotency key, request hash, client version. |
| `ResponseMetadata` | Request id, trace id, server time, warnings, deprecation notices. |
| `SdkworkError` | Code, message, retryability, trace id, field violations, resource identity. |
| `FieldViolation` | Validation target, description, rule. |
| `RuntimeCapability` | Runtime capability name, version, enabled flag. |
| `RpcServiceManifest` | Service, method, operationId, auth, owner, version, compatibility. |

Public methods SHOULD use metadata headers for request metadata and include `ResponseMetadata` only when clients need stable response-side details.

Media rules:

- RPC fields that represent images, videos, audio, voice, documents, archives, generated media, product media, upload results, or object-storage backed files `MUST` use `sdkwork.common.v1.MediaResource` or `repeated sdkwork.common.v1.MediaResource` in SDKWork-owned business services.
- SDKWork-owned file upload, download, provider, object lifecycle, and storage-control RPC belongs to Drive services governed by `DRIVE_SPEC.md`. Business RPC services attach Drive references or `MediaResource`; they must not define parallel upload-session or object-store protocols.
- Field names should describe the business role, for example `avatar`, `cover`, `thumbnail`, `poster`, `video`, `audio`, `file`, `document`, `asset`, `main_image`, `gallery_image`, `detail_image`, or `sku_image`. Do not append `media` when the message type already declares `MediaResource`.
- Provider adapter services MAY expose provider-native `url`, `uri`, `image_url`, `audio_url`, or `video_url` fields, but domain services must normalize provider media to `MediaResource`.
- Large file transfer should use Drive upload sessions, Drive download grants, Drive references, or explicit Drive-owned streaming. Do not send large product videos, generated media, or document files as unary `bytes`.

## 12. Metadata

SDKWork RPC metadata keys use lowercase ASCII. The following metadata keys are standard:

| Metadata key | Required when | Meaning |
| --- | --- | --- |
| `authorization` | Authenticated calls | `Bearer <auth_token>`. |
| `access-token` | SDKWork app/backend token calls | Canonical SDKWork access token. |
| `x-request-id` | All non-trivial calls | Caller or gateway request id. |
| `traceparent` | Distributed tracing | W3C trace context. |
| `idempotency-key` | Write commands | Retry-safe write identity. |
| `x-request-hash` | Idempotent writes | Stable hash of canonical request payload. |
| `x-sdkwork-client-version` | Generated client calls | SDK package/client version. |

Rules:

- Application clients authenticate with `authorization` and `access-token`; they MUST NOT send raw tenant/user context metadata.
- Backend/internal callers that require tenant context MUST use service tokens, API key lookup, or an internal typed context object, not caller-supplied tenant metadata.
- Metadata keys `MUST` be validated before request body handling.
- Servers MUST reject any context metadata that attempts to override token-derived or server-resolved context.

## 13. Auth And Authorization

Rules:

- App RPC uses the same dual-token model as SDKWork HTTP SDKs.
- For RPC calls authenticated with an SDKWork app/backend token, the access-token scope contract applies unchanged: `login_scope` `TENANT` with organization `0`/absent is tenant-level, organization `ORGANIZATION` with a non-zero id is organization-level, and every organization-scoped SQL operation and database seed binds the resolved scope (`API_SPEC.md` sections 10.4 and 10.6, `DATABASE_SPEC.md` section 16).
- Machine callers authenticated with an API key or service token resolve tenant and organization from the validated credential record, not from request metadata (`IAM_SPEC.md` section 5.3.1). A typed internal orchestration context is trusted only when the caller is an authenticated service identity and the context is signed or server-resolved.
- RPC tenant lifecycle gating is identical to HTTP: a non-active tenant fails closed with `40303` for token-authenticated, API-key-authenticated, and service-authenticated calls.
- Backend RPC uses backend/operator identity, service identity, or a documented internal token model.
- Internal RPC SHOULD use mTLS for service identity in production and private deployments.
- Method authorization MUST be enforced at the service/runtime boundary, not only in client SDKs.
- Login/session methods MUST NOT be exposed on backend RPC.
- Reflection and health endpoints MUST have environment-specific access control. Health may expose serving status broadly in private deployments; reflection should be restricted.

## 13.1 Internal Service-To-Service Orchestration

Internal RPC is the preferred cross-service integration path when a caller needs typed, low-latency orchestration behind the same domain runtime.

Rules:

- Internal callers `MUST` authenticate with service identity, mTLS, or another approved internal trust model. They `MUST NOT` impersonate end users by forwarding browser `authorization` and `access-token` metadata unless the RPC method is explicitly documented as a user-delegated internal proxy.
- Internal requests `MUST` carry typed caller context through `sdkwork.common.v1.CallerContext` and business context through `sdkwork.common.v1.RequestMetadata`, including `tenant_id`, `organization_id`, `actor_user_id` or `service_actor_id`, `trace_id`, and `idempotency_key` when writes are retryable.
- Orchestration methods that create resources in another domain, for example game session binding an IM room or RTC media session, `SHOULD` be owned by the callee domain internal package, not by ad hoc HTTP calls from the caller repository.
- The callee domain `MUST` remain the system of record for its own tables. The caller domain `MUST` store only binding references and MUST NOT duplicate callee message, conversation, or media-session tables.
- Internal RPC responses `MUST` return stable external identifiers (`uuid`, `room_id`, `conversation_id`, `media_session_id`) suitable for cross-domain binding tables.
- Internal RPC servers `MUST` enforce least-privilege authorization per method. A game orchestrator `MUST NOT` receive blanket admin rights on unrelated IM or RTC resources.

Recommended caller metadata shape:

| Field | Source | Rule |
| --- | --- | --- |
| `tenant_id` | Server-resolved from service token or signed orchestration context | Caller-supplied tenant override is forbidden on internal RPC. |
| `organization_id` | Server-resolved or explicit business input on the request body | Must match the bound game/session scope. |
| `actor_user_id` | Business input when acting on behalf of a player | Required for user-scoped room enter/post operations. |
| `service_actor_id` | Internal caller service name | Required for audit. |
| `idempotency_key` | Caller-generated per orchestration step | Required for create/bind/start commands. |

## 13.2 Cross-Application Launch Tickets

Applications that launch another product surface (for example IM launching a
group Knowledgebase space) `MUST` use an opaque launch ticket instead of
passing space identifiers, destination routes, session tokens, or caller
context across the boundary. The ticket lifecycle is a typed RPC contract
between the issuing and consuming domains.

Rules:

- The ticket `MUST` be opaque: a short-lived, single-use value stored
  server-side as a hash by the issuer, bound to the actor, scope, version, and
  binding epoch. It `MUST NOT` be a signed JWT that carries space identity,
  destinations, session tokens, or caller authority.
- The issuing domain `MUST` emit the ticket only after the binding is active
  and the requester is authorized (for example a joined non-Guest conversation
  member for group Knowledgebase launch).
- The consuming domain `MUST` redeem the ticket through a generated RPC SDK
  (`ConsumeGroupKnowledgebaseLaunchTicket` pattern) over the trusted path:
  mTLS with a signed caller context. Raw HTTP, manual credential headers, and
  local SDK forks are forbidden.
- Browser launch `MUST` carry only the opaque ticket in the standalone
  route fragment and `MUST` remove it from browser history once consumed.
  Space identifiers, destinations, session tokens, and caller context are
  never passed in the URL.
- Desktop launch `MUST` carry only the ticket through the registered deep
  link (for example `sdkwork-knowledgebase://group-launch/<opaque-ticket>`)
  handled by the independent consumer application process. The issuer `MUST
  NOT` create embedded webview windows for the consumer surface.
- The consuming domain `MUST` enforce final ACL and one-to-one binding on
  redemption; the issuer stores only the binding reference and the ticket
  ledger, never the consumer's content or membership tables.

## 14. Error Mapping

RPC errors use gRPC status codes plus SDKWork error detail metadata/messages.

| SDKWork error kind | gRPC status |
| --- | --- |
| `validation` | `INVALID_ARGUMENT` |
| `unauthenticated` | `UNAUTHENTICATED` |
| `unauthorized` | `PERMISSION_DENIED` |
| `not_found` | `NOT_FOUND` |
| `conflict` | `ALREADY_EXISTS` or `ABORTED` depending on domain semantics. |
| `invalid_state` | `FAILED_PRECONDITION` |
| `unsupported_capability` | `UNIMPLEMENTED` or `FAILED_PRECONDITION`. |
| `rate_limited` | `RESOURCE_EXHAUSTED` |
| `deadline` | `DEADLINE_EXCEEDED` |
| `canceled` | `CANCELLED` |
| `provider_unavailable` | `UNAVAILABLE` |
| `storage` | `INTERNAL` unless a user-correctable precondition is known. |
| `unknown` | `UNKNOWN` only when no better classification exists. |

Rules:

- Public clients MUST NOT depend on raw server exception strings.
- Validation errors SHOULD include field violations.
- Retryable errors MUST declare retryability through SDKWork error detail or response metadata.
- Internal logs may include storage/provider details; client errors must be safe for the caller audience.

## 15. Idempotency, Retry, Deadline, And Cancellation

Rules:

- Create/update/submit/pay/refund/recharge/grant/revoke/adjust/replay/fulfill commands `MUST` declare idempotency policy.
- Idempotent write methods `MUST` require `idempotency-key` unless the method is naturally idempotent and documented.
- Clients SHOULD use bounded retries only for retryable status codes and only when the method idempotency policy allows it.
- Servers MUST observe deadlines and cancellation.
- Server implementations MUST NOT keep database transactions open across network calls to third-party providers.

## 16. Streaming

Allowed streaming patterns:

| Pattern | Method kind | Examples |
| --- | --- | --- |
| Progress updates | Server streaming | Migration progress, report generation, long-running import. |
| Audit/log tailing | Server streaming | Operator audit event stream. |
| Realtime state | Server or bidirectional streaming | Chat, collaborative editing, device state. |
| Batch upload | Client streaming | Large import when Drive upload sessions or Drive object storage are not appropriate, or when Drive owns the streaming method. |

Rules:

- Streaming methods require an explicit cancellation, heartbeat, backpressure, auth refresh, and audit policy.
- Bidirectional streaming is not allowed for normal CRUD-style operations.
- Streaming response messages MUST include sequence id or cursor when clients may resume.

## 17. Contract Versioning

Rules:

- Additive fields and methods are allowed when field numbers are unique and generated clients stay compatible.
- Removing or renaming services, methods, messages, fields, enum values, or packages is breaking.
- Changing field type, label, meaning, required behavior, or auth policy is breaking.
- Deleted field numbers and names MUST be reserved.
- A new major package version is required for intentional breaking changes, for example `sdkwork.commerce.app.v4`.
- Deprecation windows MUST be recorded in the RPC manifest and changelog.

## 18. SDK Generation

Generated RPC clients MUST be reproducible from:

- proto source version
- generation tool version
- language target
- package name
- module namespace
- feature flags
- runtime dependency versions

Standard target packages:

| Language | Package naming pattern |
| --- | --- |
| Rust generated proto | `sdkwork_<domain>_rpc_proto` |
| Rust typed client facade | `sdkwork_<domain>_rpc_client` or inside `sdkwork_<domain>_rpc` |
| TypeScript | `@sdkwork/<sdk-family-stem>-rpc-sdk` |
| Java/Kotlin | `com.sdkwork.<domain>.rpc` |
| Go | `github.com/sdkwork/<domain>-rpc-go` or repo-approved module |
| Python | `sdkwork_<domain>_rpc` |
| Dart/Flutter | `sdkwork_<domain>_rpc` |
| C# | `Sdkwork.<Domain>.Rpc` |

Rules:

- Generated output MUST NOT be hand-edited.
- Missing client capability MUST be fixed by updating proto and regenerating.
- SDK README examples MUST show metadata/auth setup and at least one unary call.
- Generated clients SHOULD expose deadlines, cancellation, metadata injection, and typed errors.
- The SDK family stem MUST match sibling HTTP SDK families for the same capability line. For example,
  `sdkwork-im-sdk`, `sdkwork-im-app-sdk`, and `sdkwork-im-backend-sdk` imply
  `sdkwork-im-rpc-sdk`, even when proto packages use `sdkwork.communication.*`.

## 19. Standard Proto Repository Layout

Recommended shared contract layout for domain multi-surface repositories:

```text
apps/sdkwork-<application-code>-common/packages/sdkwork-rpc-contracts/
  proto/sdkwork/common/v1/*.proto
  buf.yaml
  buf.gen.yaml
  README.md

apps/sdkwork-<application-code>-common/packages/sdkwork-<domain>-rpc-contracts/
  proto/sdkwork/<domain>/app/v3/*.proto
  proto/sdkwork/<domain>/backend/v3/*.proto
  buf.yaml
  buf.gen.yaml
  README.md
```

Legacy repository-root layout (migration only; do not add new packages here):

```text
packages/common/rpc/sdkwork-rpc-contracts/
packages/common/<domain>/sdkwork-<domain>-rpc-contracts/
```

Rules:

- Cross-domain common messages belong in `sdkwork-rpc-contracts`.
- Business-domain proto contracts belong in their owning domain contract package.
- Generated language outputs MAY live in `sdks/` or language-specific package folders, but the proto source stays canonical.

## 20. Standard Service Catalog

This catalog defines the first SDKWork RPC service split. The method lists are the target standard surface; implementation may phase them in, but new RPC design should follow this catalog instead of inventing new service names.

### 20.1 Common And Runtime Services

| Package | Service | Surface | Methods |
| --- | --- | --- | --- |
| `sdkwork.common.v1` | shared messages only | common | No business RPC service. |
| `sdkwork.foundation.internal.v1` | `RuntimeManifestService` | internal | `RetrieveRuntimeManifest`, `ListRuntimeCapabilities`, `ListRpcServices`, `RetrieveRpcServiceManifest`. |
| `sdkwork.foundation.internal.v1` | `MigrationControlService` | internal/backend | `PreflightMigrations`, `ListMigrationPlans`, `ApplyMigrationPlan`, `RetrieveMigrationStatus`, `WatchMigrationProgress`. |
| `sdkwork.foundation.internal.v1` | `StorageContractService` | internal/backend | `ListTableContracts`, `RetrieveTableContract`, `ValidateStorageContract`. |
| `grpc.health.v1` | `Health` | common/internal | `Check`, `Watch`. |
| `grpc.reflection.v1alpha` or approved version | `ServerReflection` | dev/private | Standard reflection methods. |

### 20.2 IAM App RPC Services

Package: `sdkwork.iam.app.v3`

| Service | Methods | operationIds |
| --- | --- | --- |
| `SessionService` | `CreateSession`, `RetrieveCurrentSession`, `UpdateCurrentSession`, `DeleteCurrentSession`, `RefreshSession` | `sessions.create`, `sessions.current.retrieve`, `sessions.current.update`, `sessions.current.delete`, `sessions.refresh` |
| `VerificationService` | `CreateVerificationCode`, `VerifyVerificationCode` | `messaging.verificationCodes.create`, `messaging.verificationCodes.verify` |
| `PasswordRecoveryService` | `CreatePasswordResetRequest`, `CreatePasswordReset` | `passwordResetRequests.create`, `passwordResets.create` |
| `RegistrationService` | `CreateRegistration` | `registrations.create` |
| `OAuthSessionService` | `CreateOAuthAuthorizationUrl`, `CreateOAuthSession` | `oauth.authorizationUrls.create`, `oauth.sessions.create` |
| `QrAuthService` | `CreateQrAuthSession`, `RetrieveQrAuthSession`, `CreateQrAuthSessionScan`, `CreateQrAuthSessionPassword` | `qrAuth.sessions.create`, `qrAuth.sessions.retrieve`, `qrAuth.sessions.scans.create`, `qrAuth.sessions.passwords.create` |
| `CurrentUserService` | `RetrieveCurrentUser` | `users.current.retrieve` |

### 20.3 IAM Backend RPC Services

Package: `sdkwork.iam.backend.v3`

| Service | Methods | operationIds |
| --- | --- | --- |
| `TenantAdminService` | `CreateTenant`, `ListTenants`, `RetrieveTenant`, `UpdateTenant`, `DeleteTenant`, `CreateTenantMember`, `ListTenantMembers`, `UpdateTenantMember`, `DeleteTenantMember` | `tenants.create`, `tenants.list`, `tenants.retrieve`, `tenants.update`, `tenants.delete`, `tenants.members.create`, `tenants.members.list`, `tenants.members.update`, `tenants.members.delete` |
| `OrganizationAdminService` | `CreateOrganization`, `ListOrganizations`, `RetrieveOrganizationTree`, `RetrieveOrganization`, `UpdateOrganization`, `DeleteOrganization`, `CreateOrganizationMember`, `ListOrganizationMembers`, `UpdateOrganizationMember`, `DeleteOrganizationMember` | `organizations.create`, `organizations.list`, `organizations.tree.retrieve`, `organizations.retrieve`, `organizations.update`, `organizations.delete`, `organizations.members.create`, `organizations.members.list`, `organizations.members.update`, `organizations.members.delete` |
| `UserAdminService` | `CreateUser`, `ListUsers`, `RetrieveUser`, `UpdateUser`, `DeleteUser`, `ListUserRoles`, `CreateUserRole`, `DeleteUserRole` | `users.create`, `users.list`, `users.retrieve`, `users.update`, `users.delete`, `users.roles.list`, `users.roles.create`, `users.roles.delete` |
| `RoleAdminService` | `CreateRole`, `ListRoles`, `RetrieveRole`, `UpdateRole`, `DeleteRole`, `ListRolePermissions`, `CreateRolePermission`, `DeleteRolePermission` | `roles.create`, `roles.list`, `roles.retrieve`, `roles.update`, `roles.delete`, `roles.permissions.list`, `roles.permissions.create`, `roles.permissions.delete` |
| `PermissionAdminService` | `CreatePermission`, `ListPermissions`, `RetrievePermission`, `UpdatePermission`, `DeletePermission` | `permissions.create`, `permissions.list`, `permissions.retrieve`, `permissions.update`, `permissions.delete` |
| `PolicyAdminService` | `CreatePolicy`, `ListPolicies`, `RetrievePolicy`, `UpdatePolicy`, `DeletePolicy` | `policies.create`, `policies.list`, `policies.retrieve`, `policies.update`, `policies.delete` |
| `ApiKeyAdminService` | `ListApiKeys`, `RevokeApiKey` | `apiKeys.list`, `apiKeys.revoke` |
| `IamAuditService` | `ListSecurityEvents`, `ListAuditEvents` | `securityEvents.list`, `auditEvents.list` |

### 20.4 Commerce App RPC Services

Package: `sdkwork.commerce.app.v3`

| Service | Methods | operationIds |
| --- | --- | --- |
| `AccountService` | `RetrieveCurrentAccountSummary` | `accounts.current.summary.retrieve` |
| `AddressService` | `ListAddresses`, `CreateAddress`, `UpdateAddress`, `DeleteAddress`, `CreateDefaultAddressSelection` | `addresses.list`, `addresses.create`, `addresses.update`, `addresses.delete`, `addresses.defaultSelection.create` |
| `CartService` | `RetrieveCurrentCart`, `CreateCartItem`, `UpdateCartItem`, `DeleteCartItem` | `cart.current.retrieve`, `cart.items.create`, `cart.items.update`, `cart.items.delete` |
| `CatalogQueryService` | `ListCatalogCategories`, `RetrieveCatalogCategory`, `ListCatalogAttributes`, `ListCatalogProducts`, `RetrieveCatalogProduct`, `RetrieveCatalogSku`, `RetrieveCatalogSkuPrices`, `ListCatalogSpus`, `RetrieveCatalogSpu` | `catalog.categories.list`, `catalog.categories.retrieve`, `catalog.attributes.list`, `catalog.products.list`, `catalog.products.retrieve`, `catalog.skus.retrieve`, `catalog.skus.prices.retrieve`, `catalog.spus.list`, `catalog.spus.retrieve` |
| `CheckoutService` | `CreateCheckoutSession`, `RetrieveCheckoutSession`, `CreateCheckoutSessionQuote`, `CreateCheckoutSessionOrder` | `checkout.sessions.create`, `checkout.sessions.retrieve`, `checkout.sessions.quotes.create`, `checkout.sessions.orders.create` |
| `CouponService` | `ListCoupons`, `CreateCouponClaim`, `CreateCouponRedemption` | `coupons.list`, `coupons.claims.create`, `coupons.redemptions.create` |
| `OrderService` | `ListOrders`, `RetrieveOrder`, `CreateOrder`, `PayOrder`, `CancelOrder`, `RetrieveOrderStatistics`, `RetrieveOrderStatus`, `RetrieveOrderPaymentSuccess`, `ListOrderEvents`, `CreateOrderCancellation` | `orders.list`, `orders.retrieve`, `orders.create`, `orders.pay`, `orders.cancel`, `orders.statistics.retrieve`, `orders.status.retrieve`, `orders.paymentSuccess.retrieve`, `orders.events.list`, `orders.cancellations.create` |
| `PaymentService` | `ListPaymentMethods`, `CreatePaymentIntent`, `CreatePayment`, `ClosePayment`, `ListPaymentRecords`, `RetrievePaymentRecord`, `RetrievePaymentStatistics`, `RetrievePaymentIntent`, `CreatePaymentIntentAttempt`, `RetrievePaymentAttempt` | `payments.methods.list`, `payments.intents.create`, `payments.create`, `payments.close`, `payments.records.list`, `payments.records.retrieve`, `payments.statistics.retrieve`, `payments.intents.retrieve`, `payments.intents.attempts.create`, `payments.attempts.retrieve` |
| `RefundService` | `ListRefunds`, `CreateRefund`, `RetrieveRefund` | `refunds.list`, `refunds.create`, `refunds.retrieve` |
| `FulfillmentService` | `ListFulfillments`, `RetrieveFulfillment` | `fulfillments.list`, `fulfillments.retrieve` |
| `ShipmentService` | `RetrieveShipment` | `shipments.retrieve` |
| `RechargeService` | `ListRechargePackages`, `CreateRechargeOrder`, `RetrieveRechargeOrder`, `ListRechargeOrders`, `CancelRechargeOrder` | `recharges.packages.list`, `recharges.orders.create`, `recharges.orders.retrieve`, `recharges.orders.list`, `recharges.orders.cancel` |
| `WalletService` | `RetrieveWalletOverview`, `ListWalletAccounts`, `RetrieveWalletAccount`, `ListWalletLedgerEntries`, `RetrieveWalletLedgerEntry`, `ListWalletTransactions`, `RetrieveWalletTransaction`, `RetrieveWalletTokens`, `RetrieveWalletExchangeRate`, `ListWalletPointExchangeRules` | `wallet.overview.retrieve`, `wallet.accounts.list`, `wallet.accounts.retrieve`, `wallet.ledgerEntries.list`, `wallet.ledgerEntries.retrieve`, `wallet.transactions.list`, `wallet.transactions.retrieve`, `wallet.tokens.retrieve`, `wallet.exchangeRate.retrieve`, `wallet.points.exchangeRules.list` |
| `MembershipService` | `RetrieveCurrentMembership`, `ListMembershipPlans`, `ListMembershipBenefits`, `RetrieveCurrentMembershipStatus`, `ListMembershipPackageGroups`, `RetrieveMembershipPackageGroup`, `ListMembershipPackageGroupPackages`, `ListMembershipPackages`, `RetrieveMembershipPackage`, `CreateMembershipPurchase`, `RenewMembershipPurchase`, `UpgradeMembershipPurchase`, `RetrieveMembershipPointsBalance`, `ListMembershipPointsHistory`, `CreateMembershipDailyReward`, `RetrieveMembershipDailyRewardStatus`, `RetrieveMembershipPrivilegeUsage`, `CreateMembershipPrivilegeSpeedUp` | `memberships.current.retrieve`, `memberships.plans.list`, `memberships.benefits.list`, `memberships.current.status.retrieve`, `memberships.packageGroups.list`, `memberships.packageGroups.retrieve`, `memberships.packageGroups.packages.list`, `memberships.packages.list`, `memberships.packages.retrieve`, `memberships.purchases.create`, `memberships.purchases.renew`, `memberships.purchases.upgrade`, `memberships.points.balance.retrieve`, `memberships.points.history.list`, `memberships.points.dailyRewards.create`, `memberships.points.dailyRewards.status.retrieve`, `memberships.privileges.usage.retrieve`, `memberships.privileges.speedUps.create` |
| `InvoiceService` | `ListInvoices`, `RetrieveInvoice`, `CreateInvoice`, `UpdateInvoice`, `SubmitInvoice`, `CancelInvoice`, `ListInvoiceItems`, `ListMyInvoices`, `ListInvoiceTitles`, `RetrieveInvoiceStatistics` | `invoices.list`, `invoices.retrieve`, `invoices.create`, `invoices.update`, `invoices.submit`, `invoices.cancel`, `invoices.items.list`, `invoices.mine.list`, `invoices.titles.list`, `invoices.statistics.retrieve` |

### 20.5 Commerce Backend RPC Services

Package: `sdkwork.commerce.backend.v3`

| Service | Methods | operationIds |
| --- | --- | --- |
| `CatalogAdminService` | `ListManagedCatalogCategories`, `CreateCatalogCategory`, `UpdateCatalogCategory`, `DeleteCatalogCategory`, `ListCatalogProducts`, `CreateCatalogProduct`, `UpdateCatalogProduct`, `ListManagedCatalogSpus`, `CreateCatalogSpu`, `UpdateCatalogSpu`, `PublishCatalogSpu`, `ArchiveCatalogSpu`, `ListCatalogSkus`, `CreateCatalogSku`, `UpdateCatalogSku`, `ListManagedCatalogAttributes`, `CreateCatalogAttribute`, `ListCatalogPriceLists`, `CreateCatalogPriceList`, `UpdateCatalogPriceList` | `catalog.categories.management.list`, `catalog.categories.create`, `catalog.categories.update`, `catalog.categories.delete`, `catalog.products.list`, `catalog.products.create`, `catalog.products.update`, `catalog.spus.management.list`, `catalog.spus.create`, `catalog.spus.update`, `catalog.spus.publish`, `catalog.spus.archive`, `catalog.skus.list`, `catalog.skus.create`, `catalog.skus.update`, `catalog.attributes.management.list`, `catalog.attributes.create`, `catalog.priceLists.list`, `catalog.priceLists.create`, `catalog.priceLists.update` |
| `InventoryAdminService` | `ListInventoryStocks`, `AdjustInventoryStock`, `ListInventoryReservations`, `ReleaseInventoryReservation`, `ListInventoryLedger`, `ListInventoryLedgerEntries` | `inventory.stocks.list`, `inventory.stocks.adjust`, `inventory.reservations.list`, `inventory.reservations.release`, `inventory.ledger.list`, `inventory.ledgerEntries.list` |
| `OrderAdminService` | `ListOrders`, `ListManagedOrders`, `RetrieveManagedOrder`, `CancelManagedOrder`, `CloseManagedOrder`, `ListOrderEvents` | `orders.list`, `orders.management.list`, `orders.management.retrieve`, `orders.management.cancel`, `orders.management.close`, `orders.events.list` |
| `PaymentAdminService` | `ListPaymentProviderAccounts`, `CreatePaymentProviderAccount`, `UpdatePaymentProviderAccount`, `ListManagedPaymentMethods`, `CreatePaymentMethod`, `ListPaymentChannels`, `CreatePaymentChannel`, `ListPaymentRouteRules`, `CreatePaymentRouteRule`, `UpdatePaymentRouteRule`, `DeletePaymentRouteRule`, `ListPaymentIntents`, `ListPaymentAttempts`, `ListPaymentWebhookEvents`, `ListPaymentWebhooks`, `RetrievePaymentWebhook`, `ReplayPaymentWebhook`, `ListPaymentReconciliationRuns`, `CreatePaymentReconciliationRun` | `payments.providerAccounts.list`, `payments.providerAccounts.create`, `payments.providerAccounts.update`, `payments.methods.management.list`, `payments.methods.create`, `payments.channels.list`, `payments.channels.create`, `payments.routeRules.list`, `payments.routeRules.create`, `payments.routeRules.update`, `payments.routeRules.delete`, `payments.intents.list`, `payments.attempts.list`, `payments.webhookEvents.list`, `payments.webhooks.list`, `payments.webhooks.retrieve`, `payments.webhooks.replay`, `payments.reconciliationRuns.list`, `payments.reconciliationRuns.create` |
| `RefundAdminService` | `ListRefunds`, `ListManagedRefunds`, `RetrieveManagedRefund`, `RetrieveRefund`, `CreateRefundApproval`, `ListRefundAttempts`, `CreateRefundAttempt` | `refunds.list`, `refunds.management.list`, `refunds.management.retrieve`, `refunds.retrieve`, `refunds.approvals.create`, `refunds.attempts.list`, `refunds.attempts.create` |
| `FulfillmentAdminService` | `ListManagedFulfillments`, `CreateFulfillment`, `RetrieveManagedFulfillment`, `CreateFulfillmentShipment`, `UpdateFulfillmentShipment`, `CreateFulfillmentTrackingEvent`, `ListShipments` | `fulfillments.management.list`, `fulfillments.create`, `fulfillments.management.retrieve`, `fulfillments.shipments.create`, `fulfillments.shipments.update`, `fulfillments.trackingEvents.create`, `shipments.list` |
| `MembershipAdminService` | `ListManagedMembershipPlans`, `CreateMembershipPlan`, `UpdateMembershipPlan`, `DeleteMembershipPlan`, `ListMembershipPackages`, `CreateMembershipPackage`, `UpdateMembershipPackage`, `DeleteMembershipPackage`, `ListMembershipPackageGroups`, `CreateMembershipPackageGroup`, `UpdateMembershipPackageGroup`, `DeleteMembershipPackageGroup`, `ListMembershipMembers`, `UpdateMembershipMember`, `ListManagedMembershipEntitlements`, `GrantMembershipEntitlement`, `RevokeMembershipEntitlement` | `memberships.plans.management.list`, `memberships.plans.create`, `memberships.plans.update`, `memberships.plans.delete`, `memberships.packages.list`, `memberships.packages.create`, `memberships.packages.update`, `memberships.packages.delete`, `memberships.packageGroups.list`, `memberships.packageGroups.create`, `memberships.packageGroups.update`, `memberships.packageGroups.delete`, `memberships.members.list`, `memberships.members.update`, `memberships.entitlements.management.list`, `memberships.entitlements.grant`, `memberships.entitlements.revoke` |
| `RechargeAdminService` | `ListManagedRechargePackages`, `CreateRechargePackage`, `UpdateRechargePackage`, `ListManagedRechargeOrders` | `recharges.packages.management.list`, `recharges.packages.create`, `recharges.packages.update`, `recharges.orders.management.list` |
| `WalletAdminService` | `ListManagedWalletAccounts`, `CreateWalletAdjustment`, `ListWalletLedger`, `ListWalletLedgerEntries`, `ListWalletExchangeRules` | `wallet.accounts.management.list`, `wallet.adjustments.create`, `wallet.ledger.list`, `wallet.ledgerEntries.list`, `wallet.exchangeRules.list` |
| `CouponAdminService` | `ListManagedCouponTemplates`, `CreateCouponTemplate`, `UpdateCouponTemplate`, `ListCouponCodes`, `CreateCouponCode`, `ListCouponRedemptions` | `coupons.templates.management.list`, `coupons.templates.create`, `coupons.templates.update`, `coupons.codes.list`, `coupons.codes.create`, `coupons.redemptions.list` |
| `InvoiceAdminService` | `ListManagedInvoices`, `RetrieveManagedInvoice`, `ListInvoiceTitles`, `CreateInvoiceIssuance`, `CreateInvoiceVoid` | `invoices.management.list`, `invoices.management.retrieve`, `invoices.titles.list`, `invoices.issuance.create`, `invoices.voids.create` |
| `CommerceAuditService` | `ListAuditLogs`, `ListCommerceEvents` | `audit.logs.list`, `audit.commerceEvents.list` |
| `CommerceReportService` | `ListUsageStatements`, `RetrievePaymentReconciliation`, `ListOrderRevenue`, `ListRefundReports`, `RetrieveCommerceOverview`, `ListSalesReports`, `ListPaymentReconciliationReports` | `commerceReports.usageStatements.list`, `commerceReports.paymentReconciliation.retrieve`, `commerceReports.orderRevenue.list`, `commerceReports.refunds.list`, `reports.commerceOverview.retrieve`, `reports.sales.list`, `reports.paymentReconciliation.list` |

### 20.6 Communication RPC Services

Communication covers IM, conversation, message, room, call, notification, social, stream, and automation surfaces. Proto packages use canonical domain `communication` even when the public SDK family stem is `im`.

#### 20.6.1 Communication App RPC

Package: `sdkwork.communication.app.v3`

| Service | Target methods | HTTP/OpenAPI parity |
| --- | --- | --- |
| `ConversationService` | Conversation lifecycle, members, preferences, read cursor | Shared with IM app/open HTTP where published |
| `MessageService` | Create/retrieve/list/update message operations | Shared with IM HTTP message operations |
| `RealtimeService` | Subscription sync and event delivery control plane | Complements IM WebSocket realtime; does not replace browser WS |
| `CallService` | RTC session lifecycle exposed through IM calls facade | Shared with `/im/v3/api/calls/*` where published |
| `NotificationService` | Notification delivery and inbox control | Shared where published |
| `SocialService` | Social graph and contact-facing operations | Shared where published |
| `StreamService` | Stream control and stream-scoped operations | Shared where published |
| `AutomationService` | Agent/automation control plane | Shared where published |
| `RoomService` | `CreateRoom`, `RetrieveRoom`, `EnterRoom`, `LeaveRoom` | `MUST` map to `rooms.create`, `rooms.get`, `rooms.enter`, `rooms.leave` |

Rules:

- `RoomService` `MUST` support `roomKind` values `live`, `chat`, and `game`.
- Game move fanout over IM `MUST` use message custom schema `urn:sdkwork:sdkwork-im:message:custom:game.{gameKey}`; authoritative validation remains in the owning game runtime.
- Browser clients `SHOULD` continue using `@sdkwork/im-sdk` HTTP + realtime for rooms and messages unless gRPC-Web is explicitly approved.

#### 20.6.2 Communication Internal RPC

Package: `sdkwork.communication.internal.v1`

| Service | Purpose |
| --- | --- |
| `RuntimeTopologyService` | Runtime node and capability discovery |
| `RouteLeaseService` | Route lease claim/renew/release |
| `DomainEventRelayService` | Internal domain-event publish/ack/watch |
| `RoomOrchestrationService` | Service-to-service room create/enter/leave and conversation binding for `live`, `chat`, and `game` rooms |
| `MessageDispatchService` | Service-to-service validated custom message dispatch, including game move fanout |

`RoomOrchestrationService` and `MessageDispatchService` are required for cross-domain orchestration such as `sdkwork-gameengine` binding IM rooms without HTTP app SDK loops.

### 20.7 Game RPC Services

Package examples:

```text
sdkwork.game.app.v3
sdkwork.game.internal.v1
```

#### 20.7.1 Game App RPC

| Service | Methods | operationIds |
| --- | --- | --- |
| `CatalogQueryService` | `ListGames`, `RetrieveGame` | `games.list`, `games.retrieve` |
| `LobbyService` | `CreateLobby`, `RetrieveLobby`, `JoinLobby`, `LeaveLobby` | `lobbies.create`, `lobbies.retrieve`, `lobbies.join`, `lobbies.leave` |
| `SessionService` | `CreateSession`, `RetrieveSession`, `SubmitSessionCommand`, `RetrieveSessionState`, `EndSession` | `sessions.create`, `sessions.retrieve`, `sessions.commands.submit`, `sessions.state.retrieve`, `sessions.end` |
| `LeaderboardQueryService` | `ListLeaderboardEntries`, `RetrievePlayerRank` | `leaderboards.entries.list`, `leaderboards.rank.retrieve` |

Rules:

- `SubmitSessionCommand` `MUST` declare idempotency and `MUST` remain the authoritative write path for game commands. IM custom messages are fanout/transport, not the authority layer.
- `SessionService` `MAY` expose `StreamSessionEvents` as server streaming for MOBA/FPS-style clients. Browser clients `SHOULD` continue using HTTP unless gRPC-Web is explicitly approved.
- Game app RPC `MUST NOT` redefine IM conversation/message APIs or RTC media-session APIs. Bindings are returned as references and resolved through communication/RTC domains.

#### 20.7.2 Game Internal RPC

| Service | Purpose |
| --- | --- |
| `MatchmakingService` | Matchmaking, room allocation, participant assignment |
| `SessionRuntimeService` | Authoritative state transitions and snapshot checkpoints for co-located workers |
| `BindingQueryService` | Resolve `game_comms_binding` and `game_rtc_binding` references for internal callers |

### 20.8 RTC RPC Services

RTC proto packages use canonical domain `rtc` or approved communication-domain extension only when recorded in the RPC manifest and parity registry. Public SDK family stem remains `rtc`.

#### 20.8.1 RTC App RPC

Package: `sdkwork.rtc.app.v3`

| Service | Target methods | HTTP parity |
| --- | --- | --- |
| `RoomService` | `ListRooms`, `RetrieveRoom` | `rtc.rooms.list`, `rtc.rooms.retrieve` |
| `MediaSessionService` | `CreateMediaSession`, `RetrieveMediaSession`, `IssueParticipantCredential`, `ListRecordingArtifacts`, `RetrieveCompletionRecord` | Shared with `/app/v3/api/rtc/*` |
| `ProviderProfileService` | `ListActiveProviderProfiles` | Shared where published |

#### 20.8.2 RTC Internal RPC

Package: `sdkwork.rtc.internal.v1`

| Service | Purpose |
| --- | --- |
| `MediaSessionOrchestrationService` | Service-to-service media session create/bind/end for game voice/video orchestration |
| `ProviderWebhookIngressService` | Internal provider event normalization when not exposed through public HTTP ingress |

Rules:

- RTC RPC introduction `MUST` preserve HTTP/OpenAPI as the browser-facing source of truth until gRPC-Web is explicitly approved.
- Recording artifacts `MUST` continue to use Drive-backed `MediaResource` semantics from `MEDIA_RESOURCE_SPEC.md`.

## 21. Proto Example

```proto
syntax = "proto3";

package sdkwork.commerce.app.v3;

import "sdkwork/common/v1/money.proto";
import "sdkwork/common/v1/pagination.proto";
import "sdkwork/common/v1/runtime.proto";
import "google/protobuf/timestamp.proto";

option java_package = "com.sdkwork.commerce.app.v3";
option java_multiple_files = true;
option go_package = "github.com/sdkwork/commerce-rpc-go/sdkwork/commerce/app/v3;commerceappv3";

service WalletService {
  rpc RetrieveWalletOverview(RetrieveWalletOverviewRequest)
      returns (RetrieveWalletOverviewResponse);

  rpc ListWalletTransactions(ListWalletTransactionsRequest)
      returns (ListWalletTransactionsResponse);
}

message RetrieveWalletOverviewRequest {}

message RetrieveWalletOverviewResponse {
  WalletOverview overview = 1;
  sdkwork.common.v1.ResponseMetadata metadata = 15;
}

message ListWalletTransactionsRequest {
  sdkwork.common.v1.PageRequest page = 1;
  string wallet_account_id = 2;
}

message ListWalletTransactionsResponse {
  repeated WalletTransaction transactions = 1;
  sdkwork.common.v1.PageResponse page = 2;
  sdkwork.common.v1.ResponseMetadata metadata = 15;
}

message WalletOverview {
  string account_id = 1;
  sdkwork.common.v1.Money cash_balance = 2;
  string points_balance = 3;
  google.protobuf.Timestamp updated_at = 4;
}

message WalletTransaction {
  string transaction_id = 1;
  string transaction_type = 2;
  sdkwork.common.v1.Money amount = 3;
  string status = 4;
  google.protobuf.Timestamp created_at = 5;
}
```

## 22. Verification

Every RPC contract change `MUST` verify:

- [ ] Proto files compile.
- [ ] Proto lint passes.
- [ ] Breaking-change check passes against the previous released proto set.
- [ ] RPC manifest contains every service/method/operationId mapping.
- [ ] `apis/rpc/parity-registry.yaml` is updated when HTTP/RPC parity changes.
- [ ] Proto `package` names remain domain-first and do not include `rpc`, `grpc`, `http`, or `openapi` transport segments.
- [ ] RPC contract files live under `apis/rpc/` or another manifest-declared RPC root.
- [ ] Generated Rust code compiles.
- [ ] At least one non-Rust generated client compiles for public RPC packages.
- [ ] Unary server/client smoke tests pass.
- [ ] Auth metadata, deadlines, cancellation, idempotency, and error mapping are tested.
- [ ] Internal orchestration tests prove service identity and forbid user-token impersonation unless explicitly documented.
- [ ] Health check and reflection behavior match environment policy.
- [ ] RPC identity URI fields are present in manifest, discovery metadata, or observability smoke evidence when dynamic discovery is enabled.
- [ ] Discovery registration metadata is present when production RPC uses dynamic resolution.

## 23. External Baselines

- gRPC core concepts: https://grpc.io/docs/what-is-grpc/core-concepts/
- gRPC status codes: https://grpc.io/docs/guides/status-codes/
- gRPC health checking: https://grpc.io/docs/guides/health-checking/
- gRPC server reflection: https://grpc.io/docs/guides/reflection/
- Protocol Buffers best practices: https://protobuf.dev/best-practices/dos-donts/
- Protocol Buffers style guide: https://protobuf.dev/programming-guides/style/
- Buf lint and breaking-change workflow: https://buf.build/docs/lint/overview/
