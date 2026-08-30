# Observability Standard

- Version: 1.0
- Scope: logs, metrics, traces, audit correlation, diagnostics, HTTP/RPC runtime observability
- Related: `SECURITY_SPEC.md`, `CONFIG_SPEC.md`, `WEB_BACKEND_SPEC.md`, `RPC_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, `SDK_SPEC.md`, `DRIVE_SPEC.md`, `EVENT_SPEC.md`, `TEST_SPEC.md`

Production behavior must be observable without leaking sensitive data.

## 1. Correlation

Rules:

- Every API request `SHOULD` have a `traceId` or correlation ID.
- Every appbase HTTP request `MUST` have a server-owned request id generated at the request framework boundary.
- SDKWork-owned custom error responses `MUST` include the server-owned `traceId`.
- SDKWork-owned custom error responses `MUST` include `instance` (`{METHOD} {routeTemplate}` with a redacted-path fallback) and `MUST` include `operationId` when the web framework resolves matched route metadata. Unmatched operations do not fabricate `operationId`.
- Appbase problem responses `MUST` include the server-owned request id when available.
- Logs, metrics, traces, audit events, and security events `SHOULD` be correlated.
- Tenant and organization context may be logged only when allowed by security and privacy rules.
- Web backend handlers and services `MUST` use the server-owned request context from `WEB_BACKEND_SPEC.md` for request id, operationId, surface, route template, and safe tenant context. They must not create competing request correlation IDs.

## 2. Logging

Rules:

- Logs `MUST` be structured in production services.
- Log fields `SHOULD` include timestamp, level, service, environment, traceId, operationId, route, API surface, interceptor stage, auth mode, status, duration, and safe tenant context.
- HTTP access logs and structured application logs `MUST` use `traceId` from `SdkWorkApiResponse` or `ProblemDetail`. Legacy wire field `requestId` `MUST NOT` be emitted in new logging fields.
- RPC logs `SHOULD` include proto package, service, method, operationId, gRPC status code, deadline, duration, and safe tenant context.
- Logs `MUST NOT` include raw tokens, API keys, access tokens, passwords, verification codes, secrets, private keys, or full sensitive payloads.
- API key logs may include key id, safe key prefix, source, and status only after server-side validation.
- HTTP route values in logs `MUST` use the route template, for example `/app/v3/api/products/{productId}`, not raw paths containing user, tenant, file, object, token, or provider identifiers.
- Handler, service, repository, and provider adapter logs `SHOULD` include operationId when the work is tied to an HTTP or RPC operation. Free-form controller or handler class names are not a substitute for operationId.

## 2.1 Generated RPC SDK Observability

Generated RPC SDK packages follow `RPC_SDK_WORKSPACE_SPEC.md`.

Rules:

- Generated RPC SDKs SHOULD expose deadline and trace metadata options.
- RPC client wrappers SHOULD propagate `traceparent` and record package, service, method, operationId, status, deadline, and duration where the language runtime supports it.
- RPC SDK instrumentation MUST NOT log raw tokens, access tokens, API keys, certificates, request payload secrets, or high-cardinality user data.
- RPC SDK README examples SHOULD show trace/deadline option wiring when the generated language target supports it.

## 3. Metrics

Metrics must be stable operational contracts, not ad hoc dashboard fields.

Metric naming:

- Runtime/exported metric names `MUST` use lowercase snake case.
- Metric names `SHOULD` use the pattern
  `<app_or_domain>_<resource>_<operation>_<measure>_<unit>`.
- Counters `MUST` end in `_total` when exported to Prometheus-compatible
  systems.
- Duration metrics `MUST` express the unit in the name, usually
  `_duration_seconds`.
- Size metrics `MUST` express the unit in the name, such as `_bytes`.
- Boolean states should be represented as labels on counters or gauges, not as
  separate `*_true` and `*_false` metrics.
- Database projection metric names, such as `ops_metric_snapshot.metric_name`,
  must map to the same canonical runtime metric name or to a documented
  dashboard alias.

Required common labels:

| Label | Requirement |
| --- | --- |
| `service` | Stable process or service name. |
| `environment` | `development`, `test`, `staging`, `demo`, or `production`. |
| `deployment_profile` | `standalone` or `cloud`. |
| `runtime_target` | One exact `CONFIG_SPEC.md` runtime target: `browser`, `desktop`, `tablet-ipados`, `tablet-android`, `capacitor-ios`, `capacitor-android`, `flutter-ios`, `flutter-android`, `android-native`, `ios-native`, `harmony-native`, `mini-program`, `server`, `container`, or `test-runner`. |
| `runtime_profile` | Backend/runtime profile, such as `postgresql`, `sqlite`, or `redis`, when the metric depends on infrastructure. |
| `operation_id` | OpenAPI/RPC operation id where available. |
| `route` | HTTP route template, not raw path. |
| `method` | HTTP method or RPC method. |
| `status` | Normalized HTTP status class/code or RPC status. |
| `api_surface` | `open-api`, `app-api`, `backend-api`, `internal-api`, or `rpc` when known. |
| `backend_layer` | `router`, `handler`, `service`, `repository`, `provider`, or `materializer` when the metric is emitted by a web backend implementation layer. |

Label rules:

- Labels `MUST` be low-cardinality and bounded.
- Labels `MUST NOT` include raw user ids, emails, phone numbers, tenant names,
  API keys, access tokens, prompt text, model input, file paths, object keys,
  signed URLs, SQL text, trace ids, request ids, or full IP addresses.
- Tenant or organization labels are allowed only when the deployment explicitly
  scopes metrics to a small bounded private environment; otherwise use safe
  aggregate dimensions or omit them.
- Dynamic model/provider/channel labels must use stable codes from the API or
  database contract. Free-form display names are not valid labels.
- High-cardinality diagnostics belong in traces, logs, or sampled exemplars,
  not metric labels.
- Backend metrics `MUST NOT` use controller class names, handler function names, SQL text, raw URLs,
  tenant names, user ids, or request ids as labels. Use operationId, route template, normalized
  status, API surface, and bounded backend layer labels instead.

Metric types:

- Request, job, retry, failure, auth failure, rate limit, cache hit/miss, and
  provider invocation counts are counters.
- In-flight requests, queue depth, pool usage, active sessions, and available
  capacity are gauges.
- Latency and duration measurements are histograms. Summaries are allowed only
  when the backend cannot aggregate histograms.
- Monetary values, usage units, and token counts that feed billing must be
  recorded as business facts first; metrics can expose aggregates but must not
  be the source of truth for billing.

Histogram guidance:

- HTTP/RPC latency histograms should use seconds and buckets appropriate for the
  operation class, for example `0.005`, `0.01`, `0.025`, `0.05`, `0.1`, `0.25`,
  `0.5`, `1`, `2.5`, `5`, and `10`.
- Provider and AI generation latency may add larger buckets, but the bucket set
  must be documented and stable for dashboards.
- Background job duration histograms may use coarser buckets, but must still use
  seconds.
- RPC stream lifecycle histograms should use coarser buckets appropriate for
  long-lived connections, for example `1`, `5`, `10`, `30`, `60`, `300`, `600`,
  `1800`, `3600`, and `14400` seconds.

Health check metrics:

- `<service>_health_status` gauge: `1` when serving, `0` when not serving.
- Labels: `service`, `environment`, `deployment_profile`, `runtime_target`.
- Health endpoints SHOULD expose per-service health status when multiple services
  are registered in a single process.
- Health metrics MUST NOT require authentication to scrape when the deployment
  policy allows internal health monitoring.

Core API metrics:

- Request count by route, method, status.
- Request latency by route and method.
- Error count by code and status.
- Auth failure count.
- Rate limit count.
- API call-chain rejection count by interceptor stage and normalized error kind.
- Request context resolution count by API surface and auth mode.
- SDK generation/contract validation failures in CI.

Core RPC metrics:

- RPC request count by package, service, method, operationId, and gRPC status.
- RPC request latency by service and method.
- RPC deadline exceeded and cancellation count.
- RPC auth failure count.
- RPC health serving status.
- Proto lint, breaking-change, and generated-client validation failures in CI.

RPC stream metrics (for server-streaming and bidirectional-streaming methods):

- Active stream count by surface and service.
- Stream lifecycle duration histogram.
- Stream event throughput count by service and method.
- Stream error and disconnect count by service and error kind.

gRPC status code to metric label mapping:

| gRPC Status Code | Metric `status` Label |
| --- | --- |
| `OK` | `ok` |
| `CANCELLED` | `cancelled` |
| `UNKNOWN` | `unknown` |
| `INVALID_ARGUMENT` | `invalid_argument` |
| `DEADLINE_EXCEEDED` | `deadline_exceeded` |
| `NOT_FOUND` | `not_found` |
| `ALREADY_EXISTS` | `already_exists` |
| `PERMISSION_DENIED` | `permission_denied` |
| `RESOURCE_EXHAUSTED` | `resource_exhausted` |
| `FAILED_PRECONDITION` | `failed_precondition` |
| `ABORTED` | `aborted` |
| `OUT_OF_RANGE` | `out_of_range` |
| `UNIMPLEMENTED` | `unimplemented` |
| `INTERNAL` | `internal` |
| `UNAVAILABLE` | `unavailable` |
| `DATA_LOSS` | `data_loss` |
| `UNAUTHENTICATED` | `unauthenticated` |

RPC `api_surface` label values:

| Proto Surface | Metric `api_surface` Label |
| --- | --- |
| `internal.v1` or `internal.v3` | `rpc-internal` |
| `backend.v3` | `rpc-backend` |
| `app.v3` | `rpc-app` |
| `common.v1` | `rpc-common` |

Core Drive metrics:

- Upload session count by state and policy.
- Upload completion latency and uploaded bytes by safe policy/provider class.
- Download grant count, expiry bucket, and denial count.
- Storage provider latency/error count by normalized Drive error kind.
- Quarantine, scan failure, retention delete, and reconciliation failure count.

Core database and runtime metrics:

- Database pool connections by state, backend profile, and service.
- Database query or transaction duration by repository/operation class, without
  raw SQL labels.
- Migration and seed counts by result and target version.
- Redis/cache command latency, errors, hits, misses, writes, deletes, and
  refreshes by safe namespace.
- Desktop-local SQLite metrics must use `runtime_profile=sqlite`.
- Desktop-started backend service metrics must use the backend service runtime
  profile, normally `runtime_profile=postgresql`.

Projection and dashboard metrics:

- Tables such as `ops_metric_snapshot` are dashboard projections. They are not
  the primary telemetry source.
- Snapshot rows must include metric scope, canonical name, period, time range,
  safe dimension key/value, value, and unit.
- Metric snapshots must be rebuildable from telemetry streams or durable
  business facts.
- Dashboard projections must not mix unrelated units in one metric name.
- Snapshot dimensions must follow the same low-cardinality and privacy rules as
  exported metric labels.

## 4. Tracing

Rules:

- Services `SHOULD` use OpenTelemetry-compatible trace concepts.
- Trace spans `SHOULD` include operationId, route template, deployment profile,
  runtime target, and safe tenant scope.
- RPC trace spans `SHOULD` include proto package, service, method, operationId,
  gRPC status code, deployment profile, runtime target, and safe tenant scope.
- Database spans must not include raw SQL with sensitive values.
- Drive spans must not include signed URLs, object keys, provider credentials, or raw file content.

## 5. Audit

Rules:

- IAM, billing, permission, key, tenant, and security operations `MUST` emit audit/security events.
- Audit entries `MUST` capture actor, action, resource, tenant, result, time, and traceId.
- Appbase audit entries `SHOULD` include server request id, API surface, auth mode, key id when API key mode is used, session/token id when OAuth bearer mode is used, and safe tenant/organization/user context.
- Audit logs must not depend only on application console logs.

## 6. Acceptance Checklist

- [ ] Error responses include traceId.
- [ ] Logs are structured and redacted.
- [ ] Metrics cover route/status/latency/errors.
- [ ] Metrics use canonical names, explicit units, stable types, and bounded labels.
- [ ] Metric labels avoid secrets, PII, raw ids, raw paths, trace ids, and unbounded values.
- [ ] Histogram buckets and units are documented for HTTP/RPC/provider/job durations.
- [ ] Dashboard metric snapshots are rebuildable projections, not billing or audit facts.
- [ ] Sensitive operations emit audit events.
- [ ] Trace context propagates through service calls.
- [ ] Generated RPC SDKs expose deadline and trace metadata options when the language target supports them.
- [ ] RPC services propagate `traceparent` and report package/service/method/status metrics when RPC is enabled.
- [ ] Drive upload/download/provider metrics and traces are present without exposing signed URLs, object keys, or credentials.
- [ ] RPC stream methods report active stream count, stream duration, and stream error count.
- [ ] gRPC status codes are normalized to standard metric label values.
- [ ] RPC `api_surface` labels distinguish `rpc-internal`, `rpc-backend`, `rpc-app`, and `rpc-common`.
- [ ] Health status metrics are exposed per-service when multiple services share a process.
- [ ] Stream lifecycle histogram buckets are documented for long-lived connections.
