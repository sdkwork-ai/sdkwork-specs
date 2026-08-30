# SDKWork Discovery And Service Registry Standard

- Version: 1.0
- Baseline: `sdkwork-discovery` gRPC control plane, SDKWork RPC internal/backend surfaces, revision-ordered watch
- Scope: service registry, versioned runtime configuration, discovery client integration, watch semantics, storage profiles, security, topology surfaces, and verification for every SDKWork deployment that uses dynamic RPC resolution
- Related: `RPC_SPEC.md`, `RPC_FRAMEWORK_SPEC.md`, `RPC_RESILIENCE_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, `RUST_RPC_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `DEPLOYMENT_SPEC.md`, `REGION_SPEC.md`, `DATABASE_SPEC.md`, `DATABASE_FRAMEWORK_SPEC.md`, `SECURITY_SPEC.md`, `OBSERVABILITY_SPEC.md`, `NAMING_SPEC.md`, `MIGRATION_SPEC.md`, `TEST_SPEC.md`
- Canonical product: `sdkwork-discovery`
- Canonical RPC SDK family: `sdkwork-discovery-rpc-sdk`

This document defines the platform-standard service discovery and versioned runtime configuration control plane for SDKWork. `sdkwork-discovery` is the canonical implementation. Applications and services `MUST NOT` introduce parallel registry products, ad hoc Redis service lists, or environment-only peer tables for production RPC resolution unless a governed exception records the migration path back to this standard.

`RPC_SPEC.md` owns business RPC contract semantics. This file owns registry identity, discovery APIs, config releases, watch behavior, client resolver integration, and control-plane deployment rules.

## 1. Normative Language

The words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` use RFC-style meaning.

## 2. System Model

SDKWork separates RPC control plane from RPC data plane:

```text
sdkwork-specs (L0)
  DISCOVERY_SPEC.md + RPC_FRAMEWORK_SPEC.md
       -> narrows
sdkwork-discovery product (L1 control plane)
  Registry + Config + Watch over gRPC
       -> resolves
sdkwork-rpc-framework client resolver (L1 invocation runtime)
       -> calls
domain RPC servers (L2 data plane)
  sdkwork-<domain>-rpc over gRPC
```

Rules:

- Discovery is a platform capability, not an application-local convention.
- Business RPC services register instances with discovery; callers resolve endpoints through the RPC framework resolver instead of hard-coded peer lists in production.
- Discovery itself is implemented with SDKWork RPC contracts under `sdkwork.discovery.*` packages and `sdkwork-discovery-rpc-sdk`.
- Browser, H5, mini program, and most mobile UI clients `MUST NOT` call discovery directly. They continue to use generated HTTP SDKs unless an approved gRPC-Web ADR exists.

## 3. Bounded Capabilities

`sdkwork-discovery` owns two bounded capabilities in one infrastructure service:

| Capability | Responsibility |
| --- | --- |
| Service Registry | Instance registration, lease renewal, status reporting, exact retrieval, discovery queries, revision-ordered watch |
| Config Registry | Draft validation, immutable publish, rollback, effective configuration resolution, revision-ordered watch |

Non-goals for the platform standard:

- Browser UI for registry administration in the first platform slice.
- Compatibility shims for Nacos, Apollo, Eureka, Consul KV, or etcd APIs.
- Plaintext secret storage in config releases.
- Active health probing in the first platform slice beyond lease TTL and reported instance status.

## 4. Registry Identity

Registry instance identity is:

```text
namespace + environment + service_name + instance_id
```

| Field | Requirement |
| --- | --- |
| `namespace` | Tenant or platform partition. Production cross-namespace calls require explicit resolver policy. |
| `environment` | Lifecycle environment such as `development`, `test`, `staging`, `demo`, `production`. |
| `service_name` | Canonical discovery service name from `NAMING_SPEC.md` discovery naming rules. |
| `instance_id` | Stable per-process identity for the lifetime of one RPC server process. |

Rules:

- Registering an instance is an upsert and returns a lease.
- Renewing a lease extends `expires_at`.
- Reporting instance status updates health state and increments revision.
- Deregistration is idempotent.
- Discovery excludes expired instances and non-serving instances by default.
- Every material registry or config change increments a monotonic revision shared by watch streams.

## 5. Registered Instance Contract

Every RPC data-plane server that uses dynamic discovery `MUST` register with at least:

| Field | Requirement |
| --- | --- |
| `endpoint` | Published gRPC endpoint such as `grpcs://game.internal:50051` or approved loopback form in standalone dev. |
| `protocol` | `grpc` for standard SDKWork RPC. |
| `version` | Service binary or contract release version. |
| `status` | Reported serving status from the discovery common type model. |
| `lease_ttl_seconds` | Lease duration used by renew loop. |
| `metadata` | Structured key/value metadata including `rpc_surface`, `proto_packages`, and `operation_manifest_ref` when applicable. |

Recommended metadata keys:

| Metadata key | Meaning |
| --- | --- |
| `rpc_surface` | `app`, `backend`, `internal`, or `common`. |
| `sdk_family` | Owning RPC SDK family such as `sdkwork-im-rpc-sdk`. |
| `domain` | Canonical domain from `DOMAIN_SPEC.md`. |
| `deployment_profile` | `standalone` or `cloud`. |
| `runtime_target` | Runtime target from `CONFIG_SPEC.md`. |
| `operation_manifest_ref` | Path or URI to RPC manifest or service manifest used by CI parity checks. |

Rules:

- `service_name` `MUST` follow `NAMING_SPEC.md` discovery service naming.
- Internal orchestration callers `SHOULD` discover with `healthy_only = true` and `protocol = grpc`.
- Persistent instances `MAY` set `persistent = true` only when the service documents why lease expiry must not remove the row automatically.

## 6. Config Registry

Configuration is versioned and release-based. Clients read effective released config, never drafts.

Required behavior:

- Draft creation validates scope, format, size, and secret policy.
- Publish creates an immutable release and increments revision.
- Rollback creates a new immutable release from a selected historical release and increments revision.
- Effective config resolution merges scopes from broad to narrow:
  `namespace/environment` -> `application` -> `service_name`.
- Narrower scopes override broader scopes for the same config key.
- Config body values are stored as text with a declared format and content hash.
- Literal secret values are rejected by default; secret references are allowed.

Supported config formats in the first platform slice:

- `TEXT`
- `JSON`
- `TOML`

Rules:

- Effective config keys for RPC runtime `SHOULD` include `tls_profile`, `resilience_profile`, `default_deadline_ms`, and feature toggles consumed by `RPC_FRAMEWORK_SPEC.md`.
- Config publish and rollback require backend/operator authority on the discovery admin surface.
- Applications `MUST NOT` treat local `.env` files as the source of truth for shared production RPC peer lists when discovery is enabled.

## 7. RPC Contract

Discovery RPC packages:

```text
sdkwork.discovery.common.v1
sdkwork.discovery.internal.v1
sdkwork.discovery.backend.v3
```

Standard services:

| Package | Service | Surface | Purpose |
| --- | --- | --- | --- |
| `sdkwork.discovery.internal.v1` | `RegistryService` | internal | Register, renew, deregister, discover, retrieve |
| `sdkwork.discovery.internal.v1` | `DiscoveryConfigService` | internal | Effective config retrieval and config watch |
| `sdkwork.discovery.internal.v1` | `DiscoveryWatchService` | internal | Registry watch streams |
| `sdkwork.discovery.backend.v3` | `DiscoveryAdminService` | backend | Draft/publish/rollback and operator listing |
| `grpc.health.v1` | `Health` | common/internal | Standard health checking |

Rules:

- Every discovery RPC method `MUST` appear in `sdkwork-discovery-rpc-sdk` RPC manifest with `operationId`, auth, idempotency, and streaming mode.
- Discovery contracts `MUST` follow `RPC_SPEC.md` metadata, error, deadline, and compatibility rules.
- Discovery admin methods `MUST NOT` be exposed on public app ingress.

## 8. Topology Surfaces

Discovery terminates on SDKWork runtime topology surfaces:

| Surface id | Plane | Audience |
| --- | --- | --- |
| `application.public-ingress` | application | Registry and config RPC for service hosts and internal callers |
| `operations.control-ingress` | operations | Admin RPC for operators and automation |

Rules:

- Local development `MAY` bind both surfaces on one process when topology profile documents combined ingress.
- Production `SHOULD` separate public registry/config ingress from operator admin ingress when the deployment profile supports split ingress.
- Topology profiles `MUST` be declared through `APP_RUNTIME_TOPOLOGY_SPEC.md` and application topology manifests.

## 9. Storage Profiles

Runtime storage is selected by typed config, not ad hoc connection strings in business services.

| Provider | Use |
| --- | --- |
| `memory` | Deterministic tests and local development only. |
| `postgres` | Required durable relational provider for development/test/staging/demo/production registry, config, and watch storage. |
| `redis` | Optional durable provider for single-writer or restart-recovery deployments. |
| `etcd` | Planned distributed adapter; must implement the same store contract tests before acceptance. |
| `consul` | Planned distributed adapter; must implement the same store contract tests before acceptance. |

Rules:

- Password material `MUST` use `password_file` or equivalent secret-file references.
- Direct inline production passwords are rejected by runtime config validation.
- Database lifecycle for discovery `MUST` follow `DATABASE_FRAMEWORK_SPEC.md` with module id `discovery`.
- Table prefix `discovery_` follows `DATABASE_SPEC.md`.
- SQLite `MUST NOT` be selected as a discovery server storage provider. A desktop/native discovery client may keep a declared client-local SQLite cache, but that cache is outside the discovery server store contract and cannot publish registry/config authority.

## 10. Watch Semantics

Watch RPC streams revision-ordered stored registry or config events starting at `from_revision`, then continue with live events from the current runtime process.

Rules:

- `WatchService` registry mutation events `SHOULD` include enough `ServiceInstance` payload for clients to update local caches.
- Deregistered events `MAY` return identity tombstones when the current row is unavailable.
- Watch `MAY` be disabled by runtime config; when disabled, the watch service is not registered.
- Concurrent watch streams are bounded; excess clients receive gRPC `RESOURCE_EXHAUSTED`.
- Idle streams `SHOULD` receive heartbeat events with the last delivered revision.
- Live fanout is process-local. Horizontally scaled deployments `SHOULD` use sticky stream endpoints or reconnect with last observed revision until distributed fanout adapters exist.
- Reconnects remain safe because durable watch storage is the source of truth for revision replay.

## 11. Security

Discovery enforces authority at the service layer with typed caller context. Core services `MUST NOT` inspect raw transport headers directly in business modules.

| Action | Required authority |
| --- | --- |
| Register / renew / deregister / report status | Registry write or equivalent service identity |
| Discover / retrieve / watch registry | Registry read |
| Retrieve effective config / watch config | Config read |
| Publish / rollback config | Config publish |
| Admin list / draft / publish / rollback | Backend operator or approved automation identity |

Transport rules:

- Production `SHOULD` require TLS or mTLS on discovery ingress.
- Service-token mode uses signed bearer tokens with issuer, audience, max TTL, and permission claims.
- `allow_unsigned_local_context` is a development/test loopback-only mode and `MUST NOT` be enabled in production.
- mTLS client verification `SHOULD` be enabled for service-to-service production.
- Reflection `MUST` be disabled or access-controlled in public production.

Rules:

- Discovery security `MUST` align with `SECURITY_SPEC.md` RPC metadata and mTLS guidance.
- Secret literal publishing is rejected unless an explicit governed policy enables it.

## 12. Client Integration

RPC callers `MUST` integrate discovery through `RPC_FRAMEWORK_SPEC.md`, not ad hoc SDK calls in business modules.

Standard resolver flow:

```text
RpcClientFactory
  -> DiscoveryNameResolver (or StaticNameResolver in approved dev profiles)
  -> DiscoverInstances / WatchService cache refresh
  -> LoadBalancer pick
  -> generated RPC client call
```

Resolver profiles:

| Profile | When |
| --- | --- |
| `static` | Approved standalone loopback or fixed topology tables in development |
| `static-composite` | Single-process local orchestration with topology manifest endpoints |
| `discovery` | Default for cloud and multi-instance production |
| `composite` | Static fallback plus discovery primary with documented precedence |

Rules:

- Production multi-instance RPC resolution `MUST` use `discovery` or `composite` with discovery primary.
- Discovery client credentials `MUST` be injected during bootstrap.
- Watch-driven cache refresh `SHOULD` be preferred over high-frequency polling.
- Cross-namespace discovery `MUST` be explicit in resolver policy.

## 13. Server Lifecycle

Every discovery-enabled RPC data-plane host `MUST` implement:

```text
startup -> register instance -> start renew loop
shutdown signal -> deregister -> stop renew loop -> drain in-flight RPC
```

Rules:

- Renew interval `SHOULD` be significantly shorter than lease TTL.
- Failed renew beyond policy `MUST` trigger re-register or process exit based on deployment profile.
- Graceful shutdown `MUST` deregister before terminating the listener when discovery is enabled.
- Graceful shutdown semantics `MUST` align with `RPC_RESILIENCE_SPEC.md` drain rules.

## 14. Observability

Discovery `MUST` emit logs, metrics, and traces aligned with `OBSERVABILITY_SPEC.md`.

Minimum metrics:

- Registry register/renew/deregister/discover counts.
- Watch active stream count and heartbeat count.
- Config publish/rollback/effective retrieval counts.
- Lease expiry scan duration and batch size.
- gRPC health serving status.

Rules:

- Discovery logs and metrics `MUST` include `namespace`, `environment`, and `service_name` where applicable.
- Discovery logs `MUST NOT` include secret files, tokens, or config body secrets.

## 15. Environment Variables

Discovery process variables use the `SDKWORK_DISCOVERY_` prefix. See `ENVIRONMENT_SPEC.md` section 16 for the canonical variable table.

Rules:

- `SDKWORK_DISCOVERY_CONFIG_FILE` selects the host-local config file only; it is not forwarded as business config.
- Application-owned RPC services `MUST NOT` overload `SDKWORK_DISCOVERY_*` keys for non-discovery behavior.
- Discovery storage selection uses `SDKWORK_DISCOVERY_STORAGE_PROVIDER`; when it selects PostgreSQL, connection identity and lifecycle configuration come only from `SDKWORK_DATABASE_*`.

## 16. Verification

Every discovery contract or runtime behavior change `MUST` verify:

- [ ] RPC manifest covers every discovery service method.
- [ ] Proto lint and breaking-change checks pass.
- [ ] Registry upsert, lease renewal, expiration filtering, and idempotent deregistration tests pass.
- [ ] Config draft validation, publish, effective resolution, and secret policy rejection tests pass.
- [ ] Permission enforcement tests pass for registry and config operations.
- [ ] Watch replay from `from_revision` and heartbeat behavior tests pass.
- [ ] Server config validation rejects SQLite storage in every lifecycle environment, and production additionally rejects memory storage, unsigned local context, and inline secrets.
- [ ] Topology surface bindings are documented and validated when ingress changes.

## 17. External Baselines

- gRPC health checking: https://grpc.io/docs/guides/health-checking/
- gRPC server reflection: https://grpc.io/docs/guides/reflection/
- OpenTelemetry gRPC semantic conventions: https://opentelemetry.io/docs/specs/semconv/rpc/grpc/
