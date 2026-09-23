# Cache Framework Standard

- Version: 1.0
- Scope: cache runtime abstraction, local cache, Redis cache, namespace policy, admin cache management, QR/login temporary state, cache observability
- Related: `APPLICATION_SPEC.md`, `API_SPEC.md`, `CONFIG_SPEC.md`, `DEPLOYMENT_SPEC.md`, `ENVIRONMENT_SPEC.md`, `OBSERVABILITY_SPEC.md`, `PERFORMANCE_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines the framework-level cache contract for SDKWork applications. Cache is a runtime capability, not an ad hoc business helper. Application modules must use the cache abstraction and namespace policy model instead of reading Redis, process memory, browser storage, deployment profile flags, or runtime target flags directly.

## 1. Design Goals

- One cache API for desktop user-data targets and distributed service targets.
- Desktop packaged mode defaults to local in-process cache and must not require Redis.
- Cloud deployments and standalone server/container targets use Redis for
  shared cache state unless a capability explicitly declares desktop-only or
  single-process behavior.
- Cache entries are derived or temporary state. Cache must not be the only fact source for durable business data.
- Every cache namespace has an explicit owner, TTL, sensitivity, consistency level, failure mode, and management capability.
- Admin cache management can inspect high-level runtime state, refresh supported instances, delete namespaces, and delete single keys without exposing sensitive values.
- Cache behavior is testable in unit, contract, and deployment-mode parity tests.

## 2. Core Concepts

| Concept | Meaning |
| --- | --- |
| Cache manager | Runtime facade used by business modules. It owns instance selection, key construction, TTL policy, and backend differences. |
| Cache instance | A concrete cache backend binding such as `local_cache` or `redis_cache`. |
| Namespace policy | A logical namespace contract that binds business use to a cache instance and policy fields. |
| Cache key | Caller-supplied identifier within a namespace. Runtime code constructs the physical key from instance prefix, namespace, and key. |
| Local cache | In-process bounded cache for desktop and test usage. It is not shared across processes. |
| Redis cache | Shared service cache for cloud deployments and standalone server/container deployments. |
| Admin cache management | `backend-admin` API and UI surface for operator cache diagnostics and safe invalidation. |

## 3. Provider Kinds

The standard provider identifiers are:

| Provider kind | Use |
| --- | --- |
| `local_cache` | Desktop packaged mode, isolated tests, single-process local development. |
| `redis_cache` | Cloud deployments, standalone server/container deployments, and any feature requiring shared state. |

Rules:

- Provider identifiers are stable API contract values and must not include implementation names such as `local_process`.
- A deployment profile/runtime target may expose multiple cache instances only
  when each instance has a distinct non-overlapping key prefix and documented
  purpose.
- Business modules must not branch on provider kind. They call the cache manager by namespace.
- Redis adapter construction belongs to bootstrap/runtime wiring. Business modules must not create Redis clients directly.

## 4. Deployment Profile And Runtime Target Rules

| Deployment profile | Runtime target | Cache requirement |
| --- | --- | --- |
| `standalone` | `desktop` | MUST use `local_cache` by default. Redis MUST NOT be required for QR login, sessions, auth prompts, or basic admin UI. |
| `standalone` | local development target | SHOULD use `local_cache` unless testing Redis-specific behavior. |
| `standalone` or `cloud` | `test-runner` | SHOULD use `local_cache` or deterministic fake backends through the same cache manager contract. |
| `standalone` | `server` | MUST use `redis_cache` for runtime cache namespaces when the app declares shared state. Startup MUST fail fast when Redis is required but not configured. |
| `standalone` or `cloud` | `container` | MUST use external Redis or managed Redis-compatible service for shared cache when shared state is declared. |
| `cloud` | `server` or `container` | MUST use Redis or an approved distributed cache adapter for shared runtime state. |

Rules:

- Desktop and service cache defaults must be constructed from the same namespace policy list.
- Release/server packaging must validate Redis config before serving protected routes.
- Redis connection settings follow `ENVIRONMENT_SPEC.md`; secrets must use secret manager or protected config.

## 5. Cache Instance Contract

Every cache instance must expose these fields to runtime and admin APIs:

| Field | Requirement |
| --- | --- |
| `name` | Stable unique identifier. Required. |
| `providerKind` | `local_cache` or `redis_cache`. Required. |
| `purpose` | Operator-readable purpose. Required. |
| `keyPrefix` | Physical prefix owned by the application. Required, trimmed, no leading/trailing `:`. |
| `defaultTtlSeconds` | Positive fallback TTL. Required. |
| `maxEntries` | Positive bound for local cache; null for Redis unless adapter supports local bounding. |
| `connectionProfileName` | Required for Redis; null for local cache. |
| `supportsInspect` | Whether admin can inspect metadata for the instance. |
| `supportsRefresh` | Whether admin can refresh/cleanup the instance. |
| `supportsDelete` | Whether admin can delete namespace/key entries. |
| `cacheHits` | Successful read hits observed by the cache manager for this instance. |
| `cacheMisses` | Read misses observed by the cache manager for this instance. |
| `cacheWrites` | Successful writes observed by the cache manager for this instance. |
| `cacheDeletes` | Successful key or namespace delete operations observed by the cache manager for this instance. |
| `cacheRefreshes` | Successful refresh operations observed by the cache manager for this instance. |
| `cacheInspections` | Successful safe metadata inspection operations observed by the cache manager for this instance. |
| `cacheErrors` | Instance-resolved cache operation failures observed by the cache manager. |

Rules:

- Instance names must be unique.
- Key prefixes must not overlap. `cloud` and `cloud:auth` cannot be configured as separate instances in the same runtime because prefix scans would collide.
- Local cache must enforce `maxEntries` at write time when configured.
- Redis cache must require `connectionProfileName`.
- Unsupported admin operations must return a business conflict response, not an internal server error.

## 6. Namespace Policy Contract

Every namespace policy must expose these fields:

| Field | Requirement |
| --- | --- |
| `namespace` | Stable dotted namespace, unique within runtime. |
| `instanceName` | Existing cache instance binding. |
| `ttlSeconds` | Positive namespace TTL. |
| `scope` | One of `global`, `tenant`, `tenant_user`, `user`, `session`, `request`. |
| `sensitivity` | One of `public`, `internal`, `private`, `sensitive`, `credential`. |
| `failureMode` | One of `fail_closed`, `origin_fallback`, `serve_stale`, `bypass_cache`. |
| `consistency` | One of `relaxed`, `bounded_stale`, `coordination_critical`. |
| `jitterPercent` | 0-100 inclusive; applies positive deterministic TTL extension to reduce synchronized expiry. |
| `staleWhileRevalidateSeconds` | Non-negative stale serving window for adapters that support it. |
| `tags` | Operator-facing tags for search/filter/grouping. |
| `enabled` | Disabled namespaces skip reads/writes and preserve contract visibility. |

Rules:

- Namespace names must not be empty and must be unique.
- TTL policy belongs to namespace policy. Callers must not pass arbitrary TTL values for standard business writes.
- `jitterPercent` must be executed by the runtime, not only shown in admin UI.
- Sensitive or credential namespaces must not expose raw values through admin APIs, logs, frontend state, or telemetry.
- `coordination_critical` namespaces should default to `fail_closed`.
- `relaxed` namespaces may use `origin_fallback` or `serve_stale` when the source of truth is safe to read.

### 6.1 Authorization Scope Resolution Namespace

Authorization scope (`data_scope`, `permission_scope`) is a server-resolved fact (`IAM_SPEC.md` §5.6). It is cached under a declared namespace because it is derived state, but it is **not** a routing preference: a stale entry grants or denies authority the subject no longer holds. It therefore sits at the strict end of every policy dimension.

| Field | Value |
| --- | --- |
| `namespace` | `iam.authorization_scope` |
| `instanceName` | The runtime `local_cache` / `redis_cache` binding for the profile |
| `ttlSeconds` | `15` (bounded, and shorter than `iam.dynamic_policy` routing TTLs) |
| `scope` | `session` |
| `sensitivity` | `credential` |
| `failureMode` | `fail_closed` |
| `consistency` | `coordination_critical` |
| `jitterPercent` | `0` — synchronization of expiry buys nothing here and delays a reload |
| `staleWhileRevalidateSeconds` | `0` — stale authorization scope `MUST NOT` be served |
| `tags` | `iam`, `authorization`, `security` |

Rules:

- Caller keys `MUST` include tenant, organization, user, app, session, environment, deployment profile, and API surface, so a context switch cannot read another context's entry.
- Negative results `MUST` be cached for the namespace TTL so an absent session row cannot force a database round trip per request. Negative hits `MUST` be counted separately from loads and load failures.
- Invalidation `MUST` be explicit and driven by the writer. Role binding changes, role/permission-catalog changes, role-exclusion rule changes, session context switches, session revocations, and permission-catalog deployments each invalidate the affected scope (one subject, one user, one tenant, one session, or the whole namespace).
- TTL expiry is the backstop for a missed invalidation, never the consistency mechanism. A design that reflects a permission change only by waiting for the TTL `MUST NOT` be accepted.
- Cached scope `MUST NOT` be treated as session validity. Revocation and expiry are verified per request through the tenant-bound signature and session-revocation checks; the scope cache `MUST NOT` be allowed to bypass them.
- In a multi-replica deployment an in-process scope cache `MUST` be paired with a shared TTL bound or a broadcast invalidation channel; an unshared in-process cache without either `MUST NOT` be used for `coordination_critical` namespaces.
- Because `sensitivity = credential`, cached scope values `MUST NOT` appear in admin cache output, logs, traces, metrics labels, or frontend state. Only counts, keys, and TTL metadata may be surfaced.
- A scope load failure `MUST` surface as `fail_closed` denial with a distinguishable error/telemetry outcome, and `MUST NOT` be silently converted into an empty scope (which is indistinguishable from "no authority" and would deny with the wrong signal).

## 7. Key Construction

Physical keys must be constructed by the cache manager:

```text
<instance.keyPrefix>:<namespace>:<cacheKey>
```

Rules:

- Caller-supplied keys must be non-empty after trimming.
- Callers must not include the instance key prefix.
- Namespace and key deletion must use runtime-owned prefix construction.
- Key prefixes must make cross-tenant and cross-application collisions impossible in shared Redis deployments.
- Tenant/user-scoped namespaces should include tenant/user identifiers in the caller key or a typed key builder owned by the business module.

## 8. Runtime Operations

Minimum cache manager operations:

| Operation | Behavior |
| --- | --- |
| `get_json(namespace, key)` | Returns `None` for missing, expired, or disabled namespace entries. |
| `set_json(namespace, key, value)` | Uses namespace TTL and policy jitter. No caller TTL override for standard writes. |
| `delete_key(namespace, key)` | Deletes one physical key when instance supports delete. |
| `delete_namespace(namespace)` | Deletes all keys under a namespace when instance supports delete. |
| `delete_instance(instanceName)` | Deletes all keys under one configured cache instance when instance supports delete. |
| `list_namespace_keys(namespace, page_size, cursor)` | Returns one cursor page of bounded safe key metadata for one namespace when instance supports inspect. It must not read or return cached values. `cursor` is an opaque backend-issued continuation token. |
| `refresh_namespace(namespace)` | Cleans or refreshes entries under one namespace when instance supports refresh. |
| `refresh_instance(instanceName)` | Cleans or refreshes supported instance metadata without exposing values. |
| `refresh_all()` | Runs refresh over all instances and aggregates counts. |
| `snapshot()` | Returns summary, instances, namespace policies, entry counts, and runtime operation metrics for admin diagnostics. |

Instance snapshot statuses:

| Status | Meaning |
| --- | --- |
| `ready` | The configured cache instance is reachable and its runtime stats were read successfully. |
| `degraded` | The configured cache instance exists, but runtime stats could not be read during snapshot generation. |

Rules:

- Runtime validation should run before snapshots and startup-sensitive operations.
- Expired local cache entries may be removed lazily on read or refresh.
- Redis prefix scans must use bounded batched scan operations, not blocking full-key listing commands.
- Cache value serialization errors must be explicit and safe.
- Cache operation outcomes must include operation name, optional instance, optional namespace, optional cache key, deleted count, refreshed count, and status.
- Runtime snapshots must expose `cacheHits`, `cacheMisses`, `cacheWrites`, `cacheDeletes`, `cacheRefreshes`, `cacheInspections`, and `cacheErrors` on both summary and instance records.
- Summary metrics aggregate instance metrics. `cacheErrors` may also include system-level cache errors where no instance can be resolved, such as an unknown namespace or invalid runtime wiring.
- Snapshot generation must not fail the whole admin overview because one configured backend cannot return stats. The failed instance must still be returned with status `degraded`, zero entry counts for unavailable stats, and an incremented instance `cacheErrors` metric; healthy instances and namespace policies must remain visible.
- Operation metrics must be counted by the cache manager boundary after policy resolution, not by frontend code or direct backend adapters.
- Key listing requests must use `cursor` plus standard `page_size` from 1 to 200. Admin UI should use a conservative default such as 200.
- Key listing responses must use `SdkWorkApiResponse.data.items` plus `data.pageInfo` with `mode: "cursor"`. Additional bounded-scan metadata may live under `data.scanInfo` with `scannedItems`, `returnedItems`, and `scanComplete` so operators can continue a bounded scan without requiring an exact namespace total.
- Continuation tokens must be opaque to clients, signed by the backend, bound to the cache instance plus namespace scope, short-lived by default, and rejected when expired or reused for another namespace or provider.
- Key listing must not scan the full Redis namespace merely to compute an exact total count when `page_size` is supplied. A bounded scan may stop after finding `page_size + 1` matching keys.
- Key listing results may include logical key, namespace, instance, status, and TTL metadata. They must not include `value`, `payload`, raw JSON, or backend physical key prefixes.

## 9. Admin Management API

Admin cache management must be exposed through `backend-admin` SDK contracts, not raw frontend URLs.

Minimum endpoints:

| API | Purpose |
| --- | --- |
| `GET /backend/v3/api/system/cache/overview` | Runtime summary, instance metadata, namespace policies, entry counts, and operation metrics. |
| `POST /backend/v3/api/system/cache/refresh` | Refresh all supported instances. |
| `POST /backend/v3/api/system/cache/instances/{instanceName}/refresh` | Refresh one supported instance. |
| `DELETE /backend/v3/api/system/cache/instances/{instanceName}` | Delete all keys under one supported instance. |
| `POST /backend/v3/api/system/cache/namespaces/{namespace}/refresh` | Refresh one configured namespace. |
| `DELETE /backend/v3/api/system/cache/namespaces/{namespace}` | Delete namespace entries. |
| `GET /backend/v3/api/system/cache/namespaces/{namespace}/keys?page_size=200` | List bounded safe key metadata for a namespace. |
| `DELETE /backend/v3/api/system/cache/namespaces/{namespace}/keys/{key}` | Delete one key. |

Rules:

- API responses must use `SdkWorkApiResponse` for success bodies and `ProblemDetail` for errors per `API_SPEC.md` §15.
- Missing instances/namespaces return 404.
- Unsupported inspect/refresh/delete operations return 409.
- Invalid key-list `page_size` or `cursor` inputs return `40003 INVALID_PARAMETER`.
- Authentication and admin authorization are required.
- Admin APIs must never return cached values.
- Frontend admin packages must call generated backend SDK methods through the approved SDK client boundary.
- Frontend normalization must validate required fields, summary consistency, operation metric consistency, provider kind, runtime target, and namespace policy enums.

## 10. Admin UI Requirements

Admin cache UI should provide:

- Runtime summary cards: runtime target, instance count, namespace count, active entries, expired entries.
- Runtime operation metrics: hits, misses, writes, deletes, refreshes, inspections, and errors.
- Instance table: instance, provider, entry counts, operation activity, TTL, key prefix, status, capability-aware actions.
- Namespace table: namespace, instance binding, compact policy pills, TTL, tags, enabled status, capability-aware deletion.
- Namespace table actions must include capability-aware inspect, refresh, and delete controls.
- Instance table actions must include capability-aware refresh and delete controls; instance delete must require confirmation and must not expose cached values.
- Namespace key inspection panel that displays safe metadata only and supports selecting a key for deletion.
- Key inspection panel should show returned/scanned counts and a localized bounded-scan truncation message when `hasMore` is true.
- Key deletion panel with namespace/key inputs and confirmation.
- Global refresh and per-instance refresh where supported.
- Localized English and Chinese copy for all visible labels, states, errors, and confirmations.

Rules:

- UI must keep showing configured instances and namespaces even when entry counts are zero.
- UI must keep showing configured instances and namespaces when one instance is `degraded`; this is an operational warning state, not an empty or failed product state.
- Empty cache entries are not an empty product state.
- Disabled actions must be visibly disabled and should use localized unavailable text.
- Admin cache UI belongs after operational monitoring and analytics/data-statistics navigation in operator sidebar unless an app has a stricter local navigation spec.

## 11. Security And Privacy

Rules:

- Cache data must be classified through namespace `sensitivity`.
- Credential and sensitive namespaces must use short TTL and fail-closed behavior unless explicitly approved.
- Logs and telemetry may include namespace, instance, operation, counts, status, and error class; they must not include raw values or secrets.
- Redis URLs and credentials are secrets and must not be exposed in browser runtime config.
- Delete operations require admin authorization and confirmation in UI.
- Cache must not bypass tenant, organization, user, or app authorization.

## 12. Observability

Cache runtime should emit or expose:

- Operation counts by namespace, instance, provider kind, operation, and result.
- Latency for get/set/delete/refresh/snapshot operations.
- Error counts by error class.
- Entry counts and expired counts where supported.
- Redis connection/command timeout events.
- Admin invalidation audit events for namespace/key deletion.

Rules:

- Metrics must not include raw keys when keys can contain personal or sensitive data. Prefer namespace and hashed key identifiers if needed.
- Admin overview metrics must be safe aggregate counters only. They must not include cached values, raw payloads, Redis physical keys, or secret-bearing caller keys.
- Instance operation counters must roll up exactly to summary counters for hits, misses, writes, deletes, refreshes, and inspections. Summary error counters may be greater than the instance error total when failures occur before an instance is resolved.
- Admin operation outcomes should include counts for operator feedback.
- Service startup should fail fast and log a safe configuration error when required cache backend is missing.

## 13. Testing Requirements

Minimum tests for cache framework changes:

- Runtime validation for deployment-profile/runtime-target provider requirements.
- Local cache `maxEntries` enforcement.
- Namespace TTL and TTL jitter behavior.
- Duplicate namespace and invalid policy enum rejection.
- Redis/service mode requires explicit backend binding and connection profile.
- Key prefix overlap rejection.
- Admin API overview, refresh, delete key, delete namespace, 401, 404, and 409 behavior.
- Admin API namespace key listing behavior, including 404 unknown namespace, 409 unsupported inspect, and no value/payload fields.
- Frontend admin service SDK usage, payload normalization, summary consistency, invalid policy rejection, and operation routing.
- SDK generation/guardian checks when API contract changes.

Rules:

- New behavior must be introduced test-first.
- Generated SDK outputs must not be hand-edited.
- Cache specs and API contracts must be updated together.

## 14. Acceptance Checklist

- [ ] Deployment profile and runtime target select `local_cache` for desktop user-data targets and `redis_cache` for cloud or standalone server/container targets that require shared state.
- [ ] All cache namespaces have complete policy fields.
- [ ] Runtime validates instances, namespaces, enum values, key prefixes, Redis profile, and local capacity.
- [ ] Runtime executes namespace TTL and jitter.
- [ ] Admin APIs expose metadata and safe invalidation without values.
- [ ] Admin frontend calls generated backend SDK and validates response contracts.
- [ ] Sensitive values do not appear in logs, admin UI, SDK errors, or telemetry.
- [ ] Targeted runtime, API, frontend, and SDK checks pass.
