# General API Definition Standard

- Version: 1.0
- Baseline: OpenAPI 3.1.2 stable contract profile, JSON Schema 2020-12, RFC 9457 Problem Details
- Forward-looking baseline: Track OpenAPI 3.2.0, but do not use 3.2-only features until the SDK generator, validators, Java tooling, Rust tooling, and generated TypeScript clients prove parity.
- Scope: Java Spring app-api, Java Spring backend-api, Rust HTTP APIs, generated HTTP SDKs, frontend services, API tests, web backend implementation alignment, and contract governance
- Canonical location: `API_SPEC.md` in the `sdkwork-specs` standards root

This document defines the API contract standard for SDKWork applications. It is intentionally independent of Java, Rust, TypeScript, Tauri, React, mobile, standalone, cloud, or deployment ownership choices. API contracts must be stable enough to generate SDKs, switch between standalone and cloud deployment profiles, and compose shared application modules without duplicating business logic.

For repository/application root directory placement, use `SDKWORK_WORKSPACE_SPEC.md`: `apis/` is the standard project-root directory for authored API contracts and API materialization inputs across API kinds. For data persistence and database naming rules, use `DATABASE_SPEC.md`. For cross-layer pagination contract, implementation prohibition (no in-process pagination), and verification gates, use `PAGINATION_SPEC.md`. For canonical domain names, use `DOMAIN_SPEC.md`. For file storage, upload sessions, download grants, object-storage providers, Drive spaces/nodes, and SDKWork-owned file lifecycle, use `DRIVE_SPEC.md`. For media representation, generated asset DTOs, and bare URL cleanup, use `MEDIA_RESOURCE_SPEC.md`. For cross-stack locale, localized problem metadata, and message-key rules, use `I18N_SPEC.md`. For mandatory `sdkwork-web-framework` integration on every SDKWork HTTP `*-api` surface, including open-api, app-api, backend-api, route manifests, application standalone gateways, platform cloud gateways, migration-only API servers, and Java/Spring parity, use `WEB_FRAMEWORK_SPEC.md`; the framework repository L1 detail standard is `../sdkwork-web-framework/specs/WEB_FRAMEWORK_STANDARD.md`. For web backend implementation layering, Java controller/Rust route crate boundaries, handler/service/repository naming, request context consumption, and route materialization responsibilities, use `WEB_BACKEND_SPEC.md`. For SDK naming semantics, generated client behavior, auth integration, and frontend service boundaries, use `SDK_SPEC.md`, `MODULE_SPEC.md`, and `FRONTEND_SPEC.md`; for application-root `sdks/` workspace generation, OpenAPI authority/derived input placement, and generated artifact placement, use `SDK_WORKSPACE_GENERATION_SPEC.md` as the subordinate detail standard under `SDK_SPEC.md`. For IAM login/session integration, appbase auth UI/runtime, logout clearing, and Rust AppContext validation, use `IAM_LOGIN_INTEGRATION_SPEC.md`. For gRPC/protobuf contracts, use `RPC_SPEC.md` and `RUST_RPC_SPEC.md`. HTTP API contracts and RPC contracts must preserve shared operation semantics, but neither document replaces the other.

## 1. Normative Language

The words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are used with RFC-style meaning.

| Term | Meaning |
| --- | --- |
| `MUST` | Required. A contract that violates this rule is not SDKWork-standard. |
| `MUST NOT` | Forbidden. Do not bypass this with local convention. |
| `SHOULD` | Strong recommendation. Deviation requires a documented reason. |
| `SHOULD NOT` | Strong negative recommendation. Deviation requires a documented reason. |
| `MAY` | Optional capability decided by product, compliance, or deployment needs. |

## 2. Standard Levels

| Level | Name | Minimum bar |
| --- | --- | --- |
| L0 | Legacy Compatible | Existing APIs with a migration map and documented risk. |
| L1 | Portable Core | OpenAPI 3.1.2-compatible contracts, stable paths, stable schemas, standard errors, generated SDK compatible. |
| L2 | Service Ready | Dual-token security, tenant isolation, idempotency, pagination, audit metadata, contract tests. |
| L3 | Enterprise Grade | Least privilege, ABAC conditions, audit events, rate limits, replay protection, version governance, formal deprecation windows. |

New core business APIs `MUST` target L2. IAM, tenant, organization, permission, billing, payment, entitlement, file, messaging, AI execution, admin, and security-sensitive APIs `SHOULD` target L3.

## 3. Source Of Truth

OpenAPI is the source of truth for HTTP contracts. Proto files are the source of truth for RPC contracts and follow `RPC_SPEC.md`.

`apis/` is the standard project-root location for authored API contract sources and review inputs when a repository or application owns API contracts. It may contain HTTP, RPC, async/event, internal, and integration API subtrees, but each API kind still follows its governing spec. Recommended shape:

```text
<project-root>/apis/
  open-api/<domain>/
    openapi.yaml
    routes/
    schemas/
    examples/
    changelogs/
    tests/
  app-api/<domain>/
    openapi.yaml
    routes/
    schemas/
    examples/
    changelogs/
    tests/
  backend-api/<domain>/
    openapi.yaml
    routes/
    schemas/
    examples/
    changelogs/
    tests/
  rpc/
  async/
  internal/
  examples/
  changelogs/
  tests/
```

Rules:

- `apis/` `MUST` contain API contract sources, API review inputs, API examples, API changelogs, API manifest inputs, or API validation fixtures only.
- HTTP API contracts under `apis/open-api/`, `apis/app-api/`, or `apis/backend-api/` `MUST` use the surfaces, prefixes, operationId rules, security rules, and OpenAPI profile in this standard.
- HTTP API contracts `SHOULD` be grouped by surface and canonical domain, for example `apis/app-api/drive/openapi.yaml`, with route manifests, shared schemas, examples, changelogs, and validation fixtures kept under the same surface/domain subtree when they are authored there.
- `routes/` and `schemas/` under `apis/` are contract/materialization inputs. They `MUST NOT` contain runnable controller, handler, service, repository, or generated SDK implementation code.
- RPC contracts under `apis/rpc/` `MUST` follow `RPC_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, and `RUST_RPC_SPEC.md` when Rust RPC implementation is touched.
- Async/event API contracts under `apis/async/` `MUST` follow `EVENT_SPEC.md` when they describe SDKWork events or webhooks.
- `apis/` `MUST NOT` contain generated SDK transport output, SDK family directories, generated SDK control-plane `.sdkwork/` files, runtime server state, or app UI/service implementation code.
- `sdks/` remains the SDK generation workspace. When an authored API contract in `apis/` feeds SDK generation, the owning SDK family still materializes authority OpenAPI and derived `sdkgen` inputs under `sdks/sdkwork-<domain>-sdk/`, `sdks/sdkwork-<domain>-app-sdk/`, or `sdks/sdkwork-<domain>-backend-sdk/` according to `SDK_WORKSPACE_GENERATION_SPEC.md`.

Every API module `MUST` produce an OpenAPI document that can be validated and used by the SDK generator. Java annotations, Rust route declarations, TypeScript client wrappers, handwritten DTOs, Swagger UI output, and documentation snippets are implementation details unless they exactly match the OpenAPI contract.

Standard artifacts:

| Artifact | Requirement |
| --- | --- |
| OpenAPI document | `openapi: 3.1.2` when supported by the generator or another `3.1.x` patch level when tooling requires it, stable `info.version`, canonical `servers`, complete `paths`, `components.schemas`, and `components.securitySchemes`. |
| SDK generation manifest | Generator package `@sdkwork/sdk-generator`, CLI `sdkgen`, canonical generator path or resolved package location, generator version or commit, command, input spec path, output package, package name, version, SDK type, language, `apiPrefix`, and `standardProfile` when strict governance is enabled. |
| Contract tests | At least one generation or validation test that proves the spec can generate SDKs without warnings that hide contract drift. |
| API changelog | Breaking, additive, deprecated, and removed operations must be recorded. |
| Exception register | Any L0 or intentional standard exception must include owner, reason, risk, and removal plan. |

SDK family semantics, SDK package naming, client behavior, auth handling, and service integration follow `SDK_SPEC.md`. Application SDK workspace layout follows `SDK_WORKSPACE_GENERATION_SPEC.md`: authority OpenAPI documents live under `<application-root>/sdks/sdkwork-<domain>-sdk/openapi/`, `<application-root>/sdks/sdkwork-<domain>-app-sdk/openapi/`, or `<application-root>/sdks/sdkwork-<domain>-backend-sdk/openapi/`, derived `*.sdkgen.yaml` inputs are materialized deterministically, and generated transport output lives under `generated/server-openapi`.

## 4. API Surfaces

SDKWork uses four canonical HTTP API surfaces. Internal RPC (`internal.v3`) remains a separate gRPC surface governed by `RPC_SPEC.md`.

| Surface | Standard authority suffix | Prefix | Audience | Login endpoints |
| --- | --- | --- | --- | --- |
| Open API | `open-api` | Any approved SDKWork HTTP API prefix that is not `/app/v3/api`, not `/backend/v3/api`, and not `/internal/v3/api`, for example `/im/v3/api` | External integrations, public/domain APIs, open platform clients, provider-facing API users | Forbidden |
| App API | `app-api` | `/app/v3/api` | Application development clients, desktop apps, mobile apps, H5, PC applications, and other user-facing app clients | Allowed and canonical |
| Backend API | `backend-api` | `/backend/v3/api` | Admin consoles, internal operators, backend SDKs, control plane, automation | Forbidden |
| Internal API | `internal-api` | `/internal/v3/api` | First-party application ingress consumers: kernel UI, embedded consoles, trusted in-app automation on `application.public-ingress` | Forbidden |

The runtime request framework classifies every SDKWork HTTP API path outside `/app/v3/api`, `/backend/v3/api`, and `/internal/v3/api` as `open-api` for context resolution. Open-api does not require the literal path segment `open`; domain-specific prefixes such as `/im/v3/api` are open-api when they are not app-api, backend-api, or internal-api. Protected open-api operations use header-driven API key, OAuth bearer, `open-api-flexible`, or `api-key-or-dual-token` context resolution according to the route manifest unless the operation is public or a vendor compatibility API declared under section 4.5.2.

Internal API is application-local HTTP on `application.public-ingress`. It is not backend-admin business API and must not be confused with RPC `internal.v3`. See `INTERNAL_API_SPEC.md`.

Rules:

- App API and Backend API versions `MUST` stay locked at `/app/v3/api` and `/backend/v3/api`.
- Open API is the external and public integration surface for every SDKWork HTTP API that is not app-api and not backend-api. Each open-api domain `MUST` declare one approved versioned prefix, for example `/im/v3/api`; using the literal `/open/v3/api` is allowed only when a domain explicitly chooses that prefix.
- Domain-specific open API systems such as Craw Chat IM use their locked prefix such as `/im/v3/api`, but they remain `open-api` for authority naming, request context classification, SDK family mapping, and security semantics.
- Craw Chat IM open routes `MUST` start with `/im/v3/api`, be generated from the IM open contract, and be consumed through the generated IM SDK.
- App API is the app/client integration surface for application development across mobile App, H5, PC applications, desktop shells, and other clients. Shared appbase capabilities such as IAM login, registration, token refresh, workspaces, app bootstrap, and reusable application modules `MUST` come from `sdkwork-appbase`, the canonical generated app SDK, or an approved appbase wrapper; verification-code delivery and verification `MUST` come from the owning messaging app API and generated messaging SDK surface. Legacy Java Plus app-api authorities may appear only as registered L0 migration exceptions with owner, risk, and removal plan.
- Craw Chat `MUST NOT` reimplement, fork, or shadow `/app/v3/api` routes already owned by `sdkwork-appbase` or another registered shared app-api authority.
- Applications integrating those shared IAM flows `MUST` follow `IAM_LOGIN_INTEGRATION_SPEC.md` instead of creating application-local auth/session endpoints.
- Backend API is the management, admin, operator, and control-plane surface. It `MUST` be generated from backend contracts and consumed through backend SDKs or backend-admin integrations.
- Open-api authority documents `MUST` be declared as `sdkwork-<domain>-open-api` and placed under the owning `sdks/sdkwork-<domain>-sdk/openapi/` workspace when the application owns local SDK generation.
- App API OpenAPI authority documents `MUST` be declared as `sdkwork-<domain>-app-api` and placed under the owning `sdks/sdkwork-<domain>-app-sdk/openapi/` workspace when the application owns local SDK generation.
- Backend API OpenAPI authority documents `MUST` be declared as `sdkwork-<domain>-backend-api` and placed under the owning `sdks/sdkwork-<domain>-backend-sdk/openapi/` workspace when the application owns local SDK generation.
- Internal API OpenAPI authority documents `MUST` be declared as `sdkwork-<domain>-internal-api` and placed under the owning `sdks/sdkwork-<domain>-internal-sdk/openapi/` workspace when the application owns local SDK generation. Authoring inputs `MAY` also live under `<application-root>/apis/internal-api/<domain>/`.
- Login, register, refresh, logout, current session, OAuth callback, password reset, device authorization, and verification-code delivery flows `MUST` live in app-api only.
- Open-api and backend-api `MUST NOT` expose auth/session login endpoints. They may validate credentials/tokens and consume the validated request context projection.
- Backend-api `MUST NOT` expose auth/session login endpoints. It may validate tokens and manage resources.
- Backend-api `MUST NOT` expose an `auth` namespace for IAM login, session creation, password reset, OAuth session, MFA challenge, device authorization, or verification-code delivery APIs. These user-facing flows belong to app-api, with verification-code delivery owned by messaging.
- Standalone and cloud implementations `MUST` expose identical paths, methods,
  operationIds, schemas, response envelopes, errors, and security declarations
  for shared modules.
- When a shared capability exposes both HTTP and RPC, the HTTP `operationId` and RPC method manifest `operationId` `MUST` describe the same domain operation.
- RPC services `MUST NOT` be used to hide missing or divergent HTTP/OpenAPI behavior for app/backend public APIs; divergence requires a documented compatibility decision.
- A frontend module `MUST` call API through `UI -> service -> injected SDK client`. UI components must not assemble raw HTTP requests or auth headers.
- New shared platform foundation APIs `MUST` use canonical domains from `DOMAIN_SPEC.md`.

### 4.1 Canonical Prefix Lock

App API and Backend API use global fixed prefixes. Open-api is not a literal `/open` namespace; each open-api domain declares an approved versioned prefix outside `/app/v3/api` and `/backend/v3/api`, and that approved domain prefix is then locked for that domain. Runtime source, OpenAPI snapshots, generated SDK inputs, local Rust route tables, Java controller class-level mappings, frontend SDK bootstrap code, environment examples, and contract tests `MUST` use the locked prefix for the owning surface/domain:

| Surface | Required prefix |
| --- | --- |
| Open API | The approved versioned domain prefix for that API, for example `/im/v3/api`; no literal `/open` segment is required |
| App API | `/app/v3/api` |
| Backend API | `/backend/v3/api` |
| Internal API | `/internal/v3/api` |

Forbidden runtime prefixes:

- `/api/app/v1`, `/api/app/v2`, `/api/app/v3`, `/api/app/v3/api`
- `/api/backend/v1`, `/api/backend/v2`, `/api/backend/v3`, `/api/backend/v3/api`
- `/app/v1`, `/app/v2`
- `/backend/v1`, `/backend/v2`
- Any unapproved open-api prefix.
- Any v1/v2 open-api prefix for new SDKWork API work, including literal `/open/v1` or `/open/v2` when a domain chooses the literal `open` prefix.
- Bare backend resource prefixes such as `/v3/api/resources/*` when the API belongs to backend-api

Rules:

- Open-api routes `MUST` use their approved versioned domain prefix and `MUST NOT` use `/app/v3/api` or `/backend/v3/api`.
- Craw Chat IM open routes `MUST` start with `/im/v3/api`.
- Java app-api controller class-level mappings `MUST` start with `/app/v3/api`.
- Java backend-api controller class-level mappings `MUST` start with `/backend/v3/api`.
- Method-level relative mappings may use subpaths such as `/list` or `/{id}` only when the owning class-level mapping is already canonical.
- Rust APIs that implement shared app modules `MUST` expose the same
  `/app/v3/api` paths as app-api only when that module is not already owned by
  sdkwork-appbase. If the module exists in `sdkwork-appbase`, a canonical
  generated app SDK, or a registered L0 migration authority, the consuming
  application must integrate that module instead of duplicating it locally.
- Backend-api `MUST NOT` publish bare `/v3/api/*` resources. If a resource is part of backend-api, it must move under `/backend/v3/api/...`; if it is not part of backend-api, it must be documented as a non-SDK static/public resource outside the backend-api OpenAPI surface.
- Generated SDK manifests and OpenAPI source contracts `MUST` fail validation if any runtime path uses a forbidden prefix.
- Environment examples and app bootstrap defaults `MUST` use canonical prefixes. Historical or migration documents may mention old prefixes only when explicitly labeled `legacy`, `deprecated`, `noncanonical`, or `migration-only`.

### 4.1.1 Client-Visible URI Canonicality

SDKWork API paths are contract identity, not transport implementation detail. A
browser, desktop renderer, mobile client, SDK debug log, HAR capture,
documentation example, generated SDK base URL, or public runtime config must
show the same canonical API URI that appears in OpenAPI.

Rules:

- Client-visible SDKWork HTTP requests `MUST` use canonical API paths:
  `/app/v3/api/...` for app-api, `/backend/v3/api/...` for backend-api,
  `/internal/v3/api/...` for internal-api, and the approved domain prefix for
  open-api.
- Development proxies, reverse proxies, platform gateways, service meshes,
  upstream selectors, and browser same-origin adapters `MUST NOT` add transport
  routing prefixes to the client-visible API path. Forbidden examples include
  `/__sdkwork/platform/app/v3/api/...`, `/proxy/app/v3/api/...`,
  `/gateway/app/v3/api/...`, `/platform/app/v3/api/...`, and
  `/api/app/v3/api/...`.
- A development or production proxy may route the canonical request internally
  to `application.public-ingress`, `platform.api-gateway`, or an explicit
  dependency upstream only after matching the canonical path and preserving the
  request URI seen by the client.
- When application-owned and dependency-owned operations share the same API
  surface prefix, the host or dev proxy `MUST` route by the more specific
  canonical namespace or route manifest path before falling back to a broad
  surface prefix. Broad `/app` or `/backend` fallback routes must not shadow
  dependency-owned canonical paths.
- Generated SDKs and public runtime config `MUST` receive an API edge origin or
  deployment path prefix that preserves canonical path assembly. They `MUST NOT`
  receive hidden infrastructure prefixes whose only purpose is selecting an
  upstream.
- An API authority may own more than one stable canonical resource prefix. The
  authority OpenAPI remains the path authority, and every gateway registry,
  component `apiSurfaces` declaration, proxy matcher, runtime mount inventory,
  and contract test `MUST` preserve every owned prefix. A broad surface prefix
  or synthetic parent prefix is not evidence for a missing canonical prefix.
- URI transparency is literal: query parameters may be normalized according to
  their operation contract, but a client, SDK, adapter, proxy, or gateway
  `MUST NOT` prepend, remove, duplicate, or rewrite canonical path segments.

### 4.2 Rust HTTP Route Crate Naming

Rust HTTP route crates are the source-level route/path configuration layer. They are not generated SDK families and they are not final OpenAPI authority names.

Naming layers:

| Layer | Role | Pattern | Example |
| --- | --- | --- | --- |
| Rust route crate | HTTP route/path implementation for one capability and one surface | `sdkwork-routes-<capability>-<surface>` | `sdkwork-routes-video-open-api` |
| API authority | Aggregated OpenAPI contract for one domain and one surface | `sdkwork-<domain>-<surface>` | `sdkwork-video-open-api` |
| Generated SDK family | Client transport generated from the authority | `sdkwork-<domain>-sdk`, `sdkwork-<domain>-app-sdk`, or `sdkwork-<domain>-backend-sdk` | `sdkwork-video-sdk` |

Route crate names use the `sdkwork-routes-` prefix and end with the API surface suffix so `-open-api`, `-app-api`, `-backend-api`, or `-internal-api` remain visible at a glance.

Required route crate name:

```text
sdkwork-routes-<capability>-<surface>
```

`<surface>` `MUST` be one of `open-api`, `app-api`, `backend-api`, or `internal-api`. The full crate/package name therefore follows one of these shapes:

```text
sdkwork-routes-<capability>-open-api
sdkwork-routes-<capability>-app-api
sdkwork-routes-<capability>-backend-api
sdkwork-routes-<capability>-internal-api
```

Examples:

```text
sdkwork-routes-merchandise-app-api
sdkwork-routes-cart-app-api
sdkwork-routes-order-backend-api
sdkwork-routes-payment-open-api
sdkwork-routes-video-open-api
```

Rules:

- Rust route crates that define HTTP route paths, mount points, route metadata, handler bindings, or framework route composition for SDKWork APIs `MUST` start with `sdkwork-routes-`.
- `sdkwork-routes-merchandise-app-api` owns app-api route/path definitions only. It `MUST NOT` be used as an SDK family name, generated package name, OpenAPI authority name, generator `--sdk-name`, or frontend SDK package name.
- Route crates `MUST` declare their API surface in their name and in their route manifest. A crate whose name ends in `app-api` may mount only `/app/v3/api` routes; a crate whose name ends in `backend-api` may mount only `/backend/v3/api` routes; a crate whose name ends in `open-api` may mount only approved open-api prefixes and `MUST NOT` mount `/app/v3/api`, `/backend/v3/api`, or `/internal/v3/api`; a crate whose name ends in `internal-api` may mount only `/internal/v3/api` routes.
- Route crates `MUST` use lowercase kebab-case package names. The Rust crate import may use snake case, for example package `sdkwork-routes-merchandise-app-api` imports as `sdkwork_routes_merchandise_app_api`.
- Route crates may be split by business capability for maintainability, for example merchandise, cart, order, payment, catalog, shipment, tenant, and report. They `MUST` still preserve the canonical domain names from `DOMAIN_SPEC.md` in tags, operationIds, schemas, and route manifests.
- Route crates `MUST` produce or feed a route manifest that can be materialized into an owner-only OpenAPI authority. Java controller mappings and Rust route crates are implementation inputs; the aggregated OpenAPI authority remains the HTTP contract source of truth for SDK generation.
- Route manifests and OpenAPI authorities `MUST` pass normalized route registry collision validation before API assembly or SDK generation. The collision key is `(surface, method, normalizedPath)`; `{id}`, `:id`, and `<id>` normalize to `{param}`.
- A route crate `MUST NOT` copy appbase-owned routes. If a route is owned by `sdkwork-appbase`, the consuming application uses the appbase Rust crate or appbase SDK dependency instead of creating `sdkwork-routes-<capability>-app-api` for that route.

### 4.2.1 Route Manifest Shape

A route manifest is the machine-readable contract between a Rust route crate and the OpenAPI authority materializer. Rust may build it from constants, macros, framework metadata, or generated files, but the materializer `MUST` see a deterministic manifest with this logical shape.

Example:

```yaml
schemaVersion: 1
kind: sdkwork.route.manifest
packageName: sdkwork-routes-merchandise-app-api
surface: app-api
owner: sdkwork-shop
domain: commerce
capability: merchandise
apiAuthority: sdkwork-shop-app-api
sdkFamily: sdkwork-shop-app-sdk
prefix: /app/v3/api
source:
  crateRoot: crates/sdkwork-routes-merchandise-app-api
  crateImport: sdkwork_routes_merchandise_app_api
routes:
  - method: GET
    path: /app/v3/api/products
    operationId: commerce.product.list
    tags: [commerce.product]
    requestContext: WebRequestContext
    apiSurface: app-api
    auth:
      mode: dual-token
      required: true
      permission: commerce.products.read
      tenantScope: tenant
      dataScope: organization
    handler:
      module: crate::handlers
      name: list_products
    schemas:
      request: null
      response: ProductListResponse
      problem: ProblemDetail
    ownership:
      owner: sdkwork-shop
      apiAuthority: sdkwork-shop-app-api
    source:
      file: src/routes.rs
      line: 42
```

Required top-level fields:

| Field | Requirement |
| --- | --- |
| `schemaVersion` | Positive integer. Version `1` is the current required profile. |
| `kind` | Exact value `sdkwork.route.manifest`. |
| `packageName` | Exact Cargo package name, for example `sdkwork-routes-merchandise-app-api`. |
| `surface` | `open-api`, `app-api`, or `backend-api`. |
| `owner` | SDK generation owner, materialized to `x-sdkwork-owner`. |
| `domain` | Canonical domain from `DOMAIN_SPEC.md`. |
| `capability` | Business capability encoded in the route crate name. |
| `apiAuthority` | Aggregated API authority name, for example `sdkwork-shop-app-api`. |
| `sdkFamily` | SDK family generated from the authority, for example `sdkwork-shop-app-sdk`. |
| `prefix` | Canonical path prefix for the surface/domain. |
| `routes` | Non-empty list of route entries. |

Required route fields:

| Field | Requirement |
| --- | --- |
| `method` | Uppercase HTTP method. |
| `path` | Full canonical path including `prefix`. |
| `operationId` | Stable SDK operation id following this spec. |
| `tags` | Non-empty OpenAPI tag list; the primary tag should preserve domain and capability. |
| `requestContext` | Exact value `WebRequestContext`; every SDKWork HTTP route has a framework-resolved typed context. |
| `apiSurface` | `open-api`, `app-api`, or `backend-api`; must match the top-level `surface`. |
| `auth` | Authentication and authorization projection for OpenAPI security metadata. |
| `handler` | Framework-neutral handler binding reference for traceability. |
| `schemas` | Request, response, and problem-detail schema references when known. |
| `ownership` | Operation owner and API authority. Defaults to the top-level owner/authority when omitted by tooling, but materialized OpenAPI `MUST` contain explicit ownership extensions. |
| `source` | Repo-relative source file and optional line for diagnostics. |

Optional route fields:

| Field | Requirement |
| --- | --- |
| `rateLimitTier` | Framework rate-limit tier for abuse-sensitive operations; materializes to `x-sdkwork-rate-limit-tier` when present. |
| `interceptorChain` | `standard` or a documented stricter profile; protected routes default to the standard chain from `WEB_FRAMEWORK_SPEC.md`. |
| `forbidCredentialHeaders` | Strict credential-contamination guard. When true, the runtime rejects every credential or context header not allowed by `auth.mode`. For `credential-entry-bootstrap`, bootstrap `Access-Token` remains allowed and required. |

Rules:

- `packageName`, `surface`, and `capability` `MUST` agree. `sdkwork-routes-merchandise-app-api` means capability `merchandise` and surface `app-api`.
- `source.crateRoot` `MUST` use `crates/sdkwork-routes-<capability>-<surface>` for SDKWork-standard Rust route crates.
- `apiAuthority` and `sdkFamily` `MUST` follow `SDK_SPEC.md`: `sdkwork-<domain>-open-api` -> `sdkwork-<domain>-sdk`, `sdkwork-<domain>-app-api` -> `sdkwork-<domain>-app-sdk`, and `sdkwork-<domain>-backend-api` -> `sdkwork-<domain>-backend-sdk`.
- For `app-api`, `prefix` `MUST` be `/app/v3/api`. For `backend-api`, `prefix` `MUST` be `/backend/v3/api`. For `open-api`, `prefix` `MUST` be an approved versioned domain prefix that is not `/app/v3/api` or `/backend/v3/api`; literal `/open/v3/api` is valid only when the owning domain explicitly approves that prefix.
- Every `routes[].path` `MUST` start with `prefix`; relative paths are not valid route-manifest materialization input.
- Every `routes[]` entry `MUST` declare `requestContext: WebRequestContext`. Public routes still receive `WebRequestContext` with an anonymous principal; protected routes require a resolved principal before business logic.
- Every `routes[]` entry `MUST` declare `apiSurface` and it `MUST` match the top-level `surface`. The materializer `MUST` reject missing or mismatched values.
- `routes[].apiSurface` values `MUST` use canonical kebab-case contract labels such as `open-api`, `app-api`, and `backend-api`. Runtime enum labels such as `openApi`, `appApi`, and `backendApi` are not valid route manifest or OpenAPI extension values.
- `auth.mode` `MUST` be one of `anonymous`, `credential-entry-bootstrap`, `refresh-token`, `dual-token`, `api-key`, `oauth`, `open-api-flexible`, `api-key-or-dual-token`, `ingress-token`, `agent-token`, or `compatibility`. Runtime APIs may retain a language-native `Public` enum variant, but route manifests and OpenAPI use `anonymous`; the legacy route-manifest value `public` is migration input only and materializers `MUST` normalize it to `anonymous` before validation or output.
- Protected app-api and backend-api routes use `dual-token`. Protected open-api routes use `api-key`, `oauth`, `open-api-flexible`, or `api-key-or-dual-token` unless the route is a vendor compatibility API declared under section 4.5.2, in which case `compatibility` is allowed together with `x-sdkwork-wire-protocol: external`.
- Public SDK-generated routes `MUST` materialize `security: []` and `x-sdkwork-auth-mode: anonymous`; a framework-specific `x-sdkwork-route-auth: public` extension may be present but does not replace `x-sdkwork-auth-mode`.
- Login, registration, OAuth session creation, QR auth session creation or password completion, password reset request, password reset completion, and equivalent pre-session credential-entry routes `MUST` use `auth.mode: credential-entry-bootstrap` and set `forbidCredentialHeaders: true` unless the owning IAM contract explicitly classifies the operation as pure anonymous or refresh-token proof.
- `ownership.owner` and `ownership.apiAuthority` materialize to `x-sdkwork-owner` and `x-sdkwork-api-authority`. `source.crateRoot` or `routes[].source` materializes to `x-sdkwork-source` and `x-sdkwork-source-route-crate`.
- `routes[].requestContext` materializes to `x-sdkwork-request-context`, `routes[].apiSurface` materializes to `x-sdkwork-api-surface`, and `routes[].rateLimitTier` materializes to `x-sdkwork-rate-limit-tier` when present.
- `routes[].forbidCredentialHeaders: true` materializes to `x-sdkwork-forbid-credential-headers: true`. Runtime routers and gateways `MUST` enforce the exact credential allowlist derived from `auth.mode` before handler execution. Handlers do not implement or override this guard.
- Route manifests `MUST NOT` contain duplicate `(method, path)` pairs after path-template normalization.
- Route manifests `MUST NOT` include dependency-owned operations as application-owned operations. Appbase, Drive, IAM login/session, and other reusable-module routes remain in their owning route crates and SDK families.
- Handler and schema references are traceability inputs, not permission to bypass OpenAPI review. The aggregated OpenAPI authority remains the SDK generation contract.

### 4.3 Route Aggregation To API Authority

An API authority is the aggregated contract for one project/domain and one surface. It may aggregate multiple Rust route crates, Java controllers, and generated route manifests that share the same owner and surface.

Example:

```text
sdkwork-routes-merchandise-app-api
sdkwork-routes-cart-app-api
sdkwork-routes-order-app-api
sdkwork-routes-payment-app-api
  -> sdkwork-shop-app-api
  -> sdkwork-shop-app-sdk
```

Rules:

- `sdkwork-shop-app-api` is the aggregated app-api authority for the shop application. It may aggregate shop-owned route crates such as `sdkwork-routes-merchandise-app-api`, `sdkwork-routes-cart-app-api`, and `sdkwork-routes-checkout-app-api`.
- `sdkwork-shop-app-api` `MUST` contain only shop-owned app-api operations after dependency-owned routes are subtracted. Appbase, Drive, provider, or other dependency-owned operations remain dependency SDKs.
- `sdkwork-shop-app-sdk` is the generated SDK family produced from `sdkwork-shop-app-api`. Application packages consume the SDK family or approved composed wrappers, not the route crates.
- The same mapping applies to open-api and backend-api: `sdkwork-routes-<capability>-open-api` aggregates into `sdkwork-<domain>-open-api` and generates `sdkwork-<domain>-sdk`; `sdkwork-routes-<capability>-backend-api` aggregates into `sdkwork-<domain>-backend-api` and generates `sdkwork-<domain>-backend-sdk`.
- Route manifest inputs `MUST` be grouped by `owner`, `domain`, `surface`, `apiAuthority`, `sdkFamily`, and `prefix`. A materializer `MUST NOT` merge manifests that disagree on any of those fields.
- Materialization `MUST` reject mixed surfaces, mismatched prefixes, missing owner/domain/capability, missing or mismatched route framework metadata, a route crate package name that does not match `sdkwork-routes-<capability>-<surface>`, operationId/tag/domain mismatch, duplicate method/path pairs, and dependency-owned operations in a consuming app authority.
- The materialized authority OpenAPI `MUST` write `x-sdkwork-owner`, `x-sdkwork-api-authority`, `x-sdkwork-source`, `x-sdkwork-source-route-crate`, `x-sdkwork-request-context`, `x-sdkwork-api-surface`, and `x-sdkwork-rate-limit-tier` when present for every operation produced from a route manifest.
- Authority materialization `MUST` be deterministic: the same route manifests, dependency authorities, and generator configuration must produce byte-stable OpenAPI and derived SDK inputs except for explicitly allowed generated timestamps, which should be avoided in committed artifacts.

### 4.4 Framework Runtime Binding

Every SDKWork HTTP API contract for open-api, app-api, backend-api, or any SDKWork HTTP `*-api` surface `MUST` assume a framework-owned runtime that resolves `WebRequestContext`, executes the standard interceptor chain, and injects typed context before business handlers run.

Rules:

- All SDKWork HTTP API runtime implementations `MUST` integrate `sdkwork-web-framework` for Rust route crates, application standalone gateways, platform cloud gateways, migration-only API servers, and any Rust-backed application module that owns, serves, proxies, or composes an HTTP `*-api` surface according to `WEB_FRAMEWORK_SPEC.md`.
- API contracts `MUST NOT` require clients to choose the current tenant, organization, user, app, or permission scope through path, query, header, cookie, or client-writable body fields when token or API-key context already defines that scope.
- Contract authors `MUST` design operations assuming handlers consume `WebRequestContext` injected by the framework. Handlers `MUST NOT` reparse `Authorization`, `Access-Token`, `X-API-Key`, or SDKWork identity projection headers.
- Rust route crates, gateways, and migration-only API servers `MUST NOT` bypass the framework to assemble ad hoc Axum/Tower security chains, custom credential parsers, or parallel request-context types.
- Java Spring controllers `MUST` preserve equivalent `WebRequestContext` vocabulary, 18-stage interceptor semantics, and problem-detail behavior even though they do not cargo-depend on Rust crates.
- Framework bootstrap, Cargo dependencies, extension trait registration, and verification commands are defined in `WEB_FRAMEWORK_SPEC.md`. Handler/service/repository layering after the framework boundary follows `WEB_BACKEND_SPEC.md`.
- Every route manifest entry `MUST` declare `requestContext: WebRequestContext` and `apiSurface`; every materialized OpenAPI operation `MUST` declare `x-sdkwork-request-context: WebRequestContext` and `x-sdkwork-api-surface` according to section 19.

### 4.5 Open API Input And Output Standard

Open-api is the external integration surface. SDKWork-owned business open-api contracts use the same HTTP input and output wire rules as app-api and backend-api except where section 4.5.2 documents a vendor compatibility exemption. Authentication and tenant resolution differ by surface; wire contract rules do not.

SDKWork HTTP contract classification is explicit and conservative:

| Contract category | Applies to | Wire protocol marker | Required wire contract |
| --- | --- | --- | --- |
| SDKWork-owned custom API | All `app-api`, all `backend-api`, and SDKWork-owned business `open-api` operations | Omitted `x-sdkwork-wire-protocol` or `x-sdkwork-wire-protocol: sdkwork-v3` | SDKWork v3 input/output rules: section 14, section 15, section 16, `SdkWorkApiResponse`, `ProblemDetail`, and standard pagination |
| Vendor compatibility open-api | Open-api operations that intentionally mirror a third-party or tool platform such as OpenAI, Anthropic/Claude, Google/Gemini, Claude Code, or Codex | Operation-level `x-sdkwork-wire-protocol: external` plus `x-sdkwork-external-protocol-id` | The upstream platform wire contract exactly, including request body, response body, status semantics, error shape, streaming shape, and field names |

Rules:

- The default is SDKWork-owned custom API. If an operation does not declare `x-sdkwork-wire-protocol`, validators, code review, SDK generation, and runtime mapping `MUST` treat it as `sdkwork-v3`.
- `x-sdkwork-wire-protocol: sdkwork-v3` is optional metadata for SDKWork-owned custom APIs; omitting it has the same meaning.
- A route, path prefix, tag, SDK family name, or document-level marker `MUST NOT` make an operation vendor-compatible by inference. Vendor compatibility requires operation-level `x-sdkwork-wire-protocol: external` and `x-sdkwork-external-protocol-id`.
- Mixed OpenAPI documents are valid only when each operation is classified independently. An external operation never exempts SDKWork-owned operations in the same document from section 14, section 15, or section 16.
- Document-level `x-sdkwork-wire-protocol: external` is allowed only as human-visible metadata for an external-only document; it does not replace operation-level markers.

#### 4.5.1 SDKWork Business Open API Wire Contract

Every L2+ SDKWork-owned business operation on an open-api authority `MUST` follow the same input and output standards as app-api and backend-api:

| Concern | Standard | Reference |
| --- | --- | --- |
| Request bodies | Typed JSON schemas, explicit required fields, no client-writable tenant selectors | section 14 |
| List and search input | `SdkWorkListQuery`, standard query parameters, `q` for free-text search | section 14.1 |
| Success JSON body | `SdkWorkApiResponse` with numeric `code: 0`, typed `data`, server-owned `traceId` | section 15 |
| Error body | HTTP 4xx/5xx with `application/problem+json` and numeric `ProblemDetail.code` | section 15.2 |
| List output | `data.items` plus `data.pageInfo` | section 16 |
| Operation patterns | Standard retrieve, list, search, create, update, delete, command, and async command matrix | section 15.4 |

Rules:

- Open-api business operations `MUST NOT` return bare domain DTO roots, legacy `*ApiResult` envelopes, top-level `{ items, pageInfo, traceId }` without `data`, or vendor-native response shapes when the operation is SDKWork-owned business API.
- Open-api authentication uses `api-key`, `oauth`, `open-api-flexible`, or the explicitly declared `api-key-or-dual-token` alternative profile, but that difference `MUST NOT` relax section 14 or section 15 wire rules.
- Generated open-api SDKs using `--standard-profile sdkwork-v3` `MUST` unwrap `SdkWorkApiResponse.data` by default, accept standard list/search input per section 14.1, and expose `.raw` for the full envelope per `SDK_SPEC.md` section 4.2.
- Open-api authority OpenAPI documents `MUST` `$ref` shared `SdkWorkApiResponse`, `SdkWorkListQuery`, `ProblemDetail`, `PageInfo`, and helper payloads from `templates/openapi/components/` the same way as app-api and backend-api authorities.
- External integrators consuming SDKWork-owned domain capabilities `MUST` use generated open-api SDKs or approved composed wrappers with the standard envelope; they `MUST NOT` be offered alternate open-api wire shapes for the same business operation.

Security-only differences for open-api remain in section 8, section 18, and `WEB_FRAMEWORK_SPEC.md`. They do not change section 14 or section 15 wire rules.

#### 4.5.2 Vendor Compatibility API Exemption

Some open-api routes exist solely to emulate a third-party or tool-native wire protocol so external clients such as IDE plugins, CLI agents, provider SDKs, or upstream automation can integrate without a SDKWork-specific client adapter.

Examples:

- OpenAI-compatible `/v1/*` chat, completions, embeddings, images, and related APIs
- Anthropic Messages-compatible APIs
- Claude Code, Codex, Gemini CLI, or other agent-tool compatibility surfaces that mirror the upstream tool HTTP contract
- Provider webhook or callback shapes that `MUST` preserve upstream field names, status semantics, and error bodies

Vendor compatibility APIs:

- `MAY` opt out of `SdkWorkApiResponse`, section 14.1 list query vocabulary, and `ProblemDetail` error envelopes when the upstream protocol defines its own request and response shapes.
- `MUST NOT` mix SDKWork business envelope fields with vendor-native wire on the same operation.
- `MUST` declare operation-level `x-sdkwork-wire-protocol: external` on every exempt operation.
- `MUST` declare operation-level `x-sdkwork-external-protocol-id` on the same operation with a stable lowercase kebab-case identifier such as `openai-v1`, `anthropic-messages`, `google-gemini-v1beta`, `claude-code`, or `codex`.
- `MUST` follow the upstream platform standard exactly for request bodies, response bodies, HTTP statuses, error payloads, streaming protocol, path/query/header names, and provider-specific field names. SDKWork envelope, pagination, and ProblemDetail rules must not be injected into these operations unless the upstream protocol itself defines them.
- `MUST` preserve those markers through route manifests, authority OpenAPI, derived `*.sdkgen.*` inputs, generated SDK metadata, and materialized API snapshots.
- `SHOULD` group exempt operations under dedicated path prefixes such as `/v1/`, `/anthropic/v1/`, or `/google/v1beta/`, or tags that make the upstream protocol visible in OpenAPI review.
- `MAY` declare route manifest `auth.mode: compatibility` only for these vendor compatibility routes; compatibility auth mode `MUST NOT` be used to bypass section 14 or section 15 for SDKWork-owned business operations.
- `MUST NOT` use this exemption for SDKWork-owned domain business APIs that happen to be consumed by external integrators. Those integrators consume generated SDKs with the standard envelope from section 4.5.1.

L0 legacy vendor-compatibility surfaces `MUST` register in the governance exception register with owner, upstream protocol reference, and removal or convergence plan per `GOVERNANCE_SPEC.md`.

All other open-api operations `MUST` follow section 4.5.1.

## 5. URL And Path Standard

### 5.1 Path Format

URL path ordinary segments use lowercase `lower_snake_case`. SDKWork custom method suffixes use the final-segment form `:<lowerCamelAction>` only when section 14.1 or section 15.4 defines the operation as search, command, or bulk.

Good:

```text
/app/v3/api/auth/sessions
/app/v3/api/auth/sessions/current
/app/v3/api/iam/organizations/{organizationId}/members
/backend/v3/api/iam/roles/{roleId}/permissions
/app/v3/api/iam/users:search
/app/v3/api/iam/users:bulkCreate
/backend/v3/api/cms/entries/{entryId}:publish
```

Forbidden:

```text
/app/v3/api/auth/login
/app/v3/api/auth__login
/app/v3/api/userCenter/profile
/backend/v3/api/auth/sessions
/app/v3/api/iam/organizations/{organization_id}
```

Rules:

- Static path segments `MUST` be lowercase `lower_snake_case`.
- Path parameters `MUST` be `lowerCamelCase`.
- Paths `MUST` be resource-oriented, not RPC-oriented by default.
- Slash action segments such as `/<resource>/{id}/cancel` `MAY` be used only when the operation is not naturally represented by CRUD, for example `activate`, `deactivate`, `cancel`, `submit`, `verify`, `resend`, `revoke`, or `restore`. Slash action segments `MUST` use lowercase `lower_snake_case`.
- SDKWork custom method suffixes `MAY` be used only as the final path suffix after a collection or resource path: `:<action>`, `:search`, or `:bulk<Action>`. The suffix action `MUST` use lowerCamelCase and `bulk<Action>` `MUST` use an uppercase action word after `bulk`.
- Once an operation path is published by the authority OpenAPI, that exact external URI is the transport contract for route manifests, runtime listeners, gateways, generated SDKs, browser requests, documentation, and examples. An implementation `MUST NOT` change a selected `/{id}:<action>` path to `/{id}/<action>`, insert an infrastructure selector, or otherwise rewrite the public path to accommodate a router framework.
- A framework that cannot register a path segment containing both a parameter and a custom method suffix, such as `{entryId}:publish`, `MUST` preserve the exact external URI through an adapter that captures the complete segment and strictly dispatches the declared id/action pair. The capture form is private implementation detail and `MUST NOT` appear in OpenAPI, route manifests, SDK metadata, client base URLs, browser-visible requests, documentation, or examples.
- Do not use double underscores, uppercase ordinary path segments, mixed naming styles, or colons except for the SDKWork custom method suffixes allowed above.
- A path `MUST NOT` duplicate another operation on the same surface/listener after template normalization. For collision checks, `/users/{userId}`, `/users/:id`, and `/users/<id>` are the same path. Intentional overrides require an ADR and an explicit route override marker.
- Standard app/backend health and readiness paths (`/app/v3/api/system/health`, `/app/v3/api/system/ready`, `/backend/v3/api/system/health`, `/backend/v3/api/system/ready`) are reserved for the standard health route owner. Business capabilities `MUST` use capability-specific paths and must not claim these common system paths.

### 5.2 Resource Naming

Collections use plural nouns. Singletons use clear singleton names.

| Concept | Standard path |
| --- | --- |
| Sessions | `/auth/sessions` |
| Current session | `/auth/sessions/current` |
| Tenants | `/iam/tenants` |
| Organizations | `/iam/organizations` |
| Organization members | `/iam/organizations/{organizationId}/members` |
| Users | `/iam/users` |
| Roles | `/iam/roles` |
| Role permissions | `/iam/roles/{roleId}/permissions` |
| API keys | `/iam/api_keys` |
| Audit events | `/iam/audit_events` |

## 6. HTTP Method Standard

| Method | Meaning | Body |
| --- | --- | --- |
| `GET` | Retrieve a resource or list resources | No request body |
| `POST` | Create resource or execute non-idempotent command | Usually has body |
| `PUT` | Replace a resource | Has full body |
| `PATCH` | Partially update a resource | Has partial body |
| `DELETE` | Delete, revoke, or detach a resource | Body discouraged |

Rules:

- `GET` operations `MUST` be safe and not change server state.
- `PUT` and idempotent `POST` commands `SHOULD` support `Idempotency-Key` for retry safety.
- `DELETE` returning no content `SHOULD` use `204`.
- Bulk create/update/delete operations `MUST` define item-level result semantics and partial failure rules.
- Long-running operations `SHOULD` return `202` with an operation resource or job resource.

## 7. OperationId Standard

Operation IDs are SDK surface contracts. They are not arbitrary Swagger labels and they must be designed before implementation. The generated SDK method name is a public API for every app that consumes the module.

### 7.1 Grammar

`operationId` `MUST` follow this grammar:

```text
operationId = resourcePath "." action
resourcePath = lowerCamelResource *( "." lowerCamelResource )
action = lowerCamelAction
lowerCamelResource = lowercaseLetter *( letter / digit )
lowerCamelAction = lowercaseLetter *( letter / digit )
```

Valid examples:

```text
sessions.create
sessions.current.retrieve
messaging.verificationCodes.verify
tenants.members.list
organizations.members.create
roles.permissions.delete
apiKeys.revoke
securityEvents.list
```

Invalid examples:

```text
auth__login
auth.login
createSession
sessions_create
Sessions.create
sessions.Create
organizations/{organizationId}/members.create
iam.organizations.list
```

Rules:

- `operationId` `MUST` use lowerCamelCase dotted segments.
- `operationId` `MUST` contain at least one resource segment and one action segment.
- `operationId` `MUST NOT` contain `__`, `_`, `-`, `/`, `{`, `}`, spaces, colons, or uppercase first characters.
- `operationId` `MUST NOT` duplicate the tag name. With tag `iam`, use `organizations.list`, not `iam.organizations.list`.
- `operationId` `MUST` be globally unique in the OpenAPI document.
- Path parameter names `MUST NOT` appear in `operationId`. Resource identity belongs in method arguments, not in SDK method names.
- `operationId` `MUST` remain stable across Java/Rust implementations and
  standalone/cloud deployment profiles.

### 7.2 Tag And OperationId Responsibilities

Tags define the top-level SDK module. Operation IDs define nested SDK resources and method names.

```text
tag: auth
operationId: sessions.create
SDK: client.auth.sessions.create(body)

tag: iam
operationId: organizations.members.create
SDK: client.iam.organizations.members.create(organizationId, body)
```

Rules:

- Each operation `MUST` have exactly one canonical tag.
- The tag `MUST` be lowerCamelCase.
- A tag `MUST` represent a bounded API domain such as `auth`, `iam`, `billing`, `content`, `communication`, `ai`, or `system`.
- Do not use Java controller names, Rust module names, page names, table names, or generated class names as tags.
- Do not repeat the tag inside `operationId`.

### 7.3 URL To OperationId Mapping

Static URL segments use `lower_snake_case`; operationId resource segments use `lowerCamelCase`.

| URL segment | operationId segment |
| --- | --- |
| `sessions` | `sessions` |
| `current` | `current` |
| `verification_codes` | `verificationCodes` |
| `password_reset_requests` | `passwordResetRequests` |
| `api_keys` | `apiKeys` |
| `security_events` | `securityEvents` |
| `audit_events` | `auditEvents` |

Mapping rules:

- Remove the API prefix `/app/v3/api` or `/backend/v3/api`.
- Use the tag as the top-level SDK module and do not include it again in operationId.
- Convert static resource path segments after the tag/domain segment from `lower_snake_case` to lowerCamelCase.
- Omit path parameters from operationId.
- Append one standard action segment as the last dotted segment.
- Singleton words such as `current`, `me`, or `default` may remain resource segments when they represent stable singleton resources.

Examples:

| Method | Path | Tag | operationId | SDK surface |
| --- | --- | --- | --- | --- |
| `POST` | `/app/v3/api/auth/sessions` | `auth` | `sessions.create` | `client.auth.sessions.create(body)` |
| `GET` | `/app/v3/api/auth/sessions/current` | `auth` | `sessions.current.retrieve` | `client.auth.sessions.current.retrieve()` |
| `DELETE` | `/app/v3/api/auth/sessions/current` | `auth` | `sessions.current.delete` | `client.auth.sessions.current.delete()` |
| `POST` | `/app/v3/api/messaging/verification_codes` | `messaging` | `messaging.verificationCodes.create` | `client.messaging.verificationCodes.create(body)` |
| `POST` | `/app/v3/api/messaging/verification_codes/verify` | `messaging` | `messaging.verificationCodes.verify` | `client.messaging.verificationCodes.verify(body)` |
| `GET` | `/backend/v3/api/iam/users` | `iam` | `users.list` | `client.iam.users.list(params)` |
| `GET` | `/backend/v3/api/iam/users/{userId}` | `iam` | `users.retrieve` | `client.iam.users.retrieve(userId)` |
| `PATCH` | `/backend/v3/api/iam/users/{userId}` | `iam` | `users.update` | `client.iam.users.update(userId, body)` |
| `GET` | `/backend/v3/api/iam/organizations/{organizationId}/members` | `iam` | `organizations.members.list` | `client.iam.organizations.members.list(organizationId, params)` |
| `POST` | `/backend/v3/api/iam/organizations/{organizationId}/members` | `iam` | `organizations.members.create` | `client.iam.organizations.members.create(organizationId, body)` |
| `DELETE` | `/backend/v3/api/iam/roles/{roleId}/permissions/{permissionId}` | `iam` | `roles.permissions.delete` | `client.iam.roles.permissions.delete(roleId, permissionId)` |

### 7.4 Standard Action Vocabulary

Use standard action names consistently.

| HTTP shape | Action | Example |
| --- | --- | --- |
| `GET /resources` | `list` | `users.list` |
| `POST /resources` | `create` | `users.create` |
| `GET /resources/{resourceId}` | `retrieve` | `users.retrieve` |
| `PUT /resources/{resourceId}` | `update` | `users.update` |
| `PATCH /resources/{resourceId}` | `update` | `users.update` |
| `DELETE /resources/{resourceId}` | `delete` | `users.delete` |
| `POST /resources/{resourceId}/restore` | `restore` | `users.restore` |
| `POST /resources/{resourceId}/activate` | `activate` | `users.activate` |
| `POST /resources/{resourceId}/deactivate` | `deactivate` | `users.deactivate` |
| `POST /resources/{resourceId}/revoke` | `revoke` | `apiKeys.revoke` |
| `POST /resources/{resourceId}/verify` | `verify` | `messaging.verificationCodes.verify` |
| `POST /resources/refresh` | `refresh` | `sessions.refresh` |
| `POST /resources:bulkCreate` | `bulkCreate` | `users.bulkCreate` |
| `POST /resources:bulkUpdate` | `bulkUpdate` | `users.bulkUpdate` |
| `POST /resources:bulkDelete` | `bulkDelete` | `users.bulkDelete` |

Rules:

- Do not use `get` for resource retrieval; use `retrieve`.
- Do not use `remove` for resource deletion; use `delete` unless the domain specifically distinguishes detach/remove from delete.
- Do not use `add` for collection creation; use `create`.
- Do not introduce new `batch_*` URL segments or `batch<Action>` operationIds for SDKWork-owned APIs. Use `:bulk<Action>` paths and `bulk<Action>` operationIds.
- Do not encode HTTP method names into operationIds, such as `postSession` or `getUsers`.
- Do not use vague actions such as `handle`, `process`, `do`, `execute`, or `operate`.
- If a business command needs a domain verb, the verb must match the final URL action segment and be stable, for example `submit`, `approve`, `reject`, `cancel`, `archive`, `publish`, or `unpublish`.

### 7.5 SDK Compatibility Rules

Rules:

- The generated TypeScript SDK for SDKWork v3 `SHOULD` expose nested resources, for example `client.auth.sessions.create()`.
- Flat legacy methods such as `client.auth.createSession()`, `client.auth.sessionsCreate()`, or `client.auth.authLogin()` `MUST NOT` be introduced for new SDKWork v3 APIs.
- App SDKs and backend SDKs may be different npm packages or generated clients, but the resource method shape `MUST` be the same for equivalent contracts.
- App-specific SDK client construction may differ, but once the client is injected into a service, the method surface must be stable.
- Changing operationId is a breaking SDK change and requires explicit version governance.
- SDK generators `MUST` synthesize nested resource clients directly from `tag + dotted operationId`. A generator that flattens `sessions.create` into `createSession` is not SDKWork v3 compliant.

### 7.6 Collision And Naming Review

Before accepting an OpenAPI document:

- Check that all operationIds are globally unique.
- Check that no two operations in the same tag produce the same SDK method path.
- Check that no operationId contains a tag prefix, controller prefix, or implementation detail.
- Check that action names are from the standard vocabulary or have a documented domain reason.
- Check that URL path, operationId, schema names, and response examples describe the same resource model.

## 8. Standard Tags And Domains

Tags are SDK modules, not arbitrary controller names.

| Tag | Domain |
| --- | --- |
| `auth` | Login, sessions, token refresh, verification, OAuth, password reset |
| `iam` | Tenants, organizations, users, roles, permissions, policies, API keys, security settings |
| `profile` | Current user's profile and preferences if separated from IAM admin resources |
| `billing` | Billing, settlement, wallet, payment, invoice, pricing |
| `content` | Documents, media, assets, drive, comments |
| `communication` | IM, contacts, channels, notifications |
| `ai` | Models, agents, tools, workflows, prompts, memory |
| `system` | App metadata, health, settings, support, feature flags |

Rules:

- Do not create tags named after Java controllers, Rust modules, pages, or database tables.
- A bounded context may define additional tags, but they `MUST` be registered in the module prefix/domain registry.
- IAM concepts `MUST` use `iam`, not vague `identity`, for API and database contracts. Existing package directories may keep architecture grouping names during migration, but the domain contract is `iam`.

## 9. OpenAPI Document Requirements

### 9.1 Required Top-Level Fields

```yaml
openapi: 3.1.0
info:
  title: SDKWork App API
  version: 3.0.0
servers:
  - url: https://api.example.com
paths: {}
components:
  schemas: {}
  securitySchemes: {}
```

Rules:

- OpenAPI version `SHOULD` be `3.1.2` for new standard contracts when the SDK generator supports it. A `3.1.x` patch level is acceptable when a toolchain has not yet adopted `3.1.2`.
- OpenAPI `3.2.x` features `MUST NOT` be used in source contracts until
  generator and runtime parity tests pass for TypeScript, Java, Rust,
  standalone, and cloud targets.
- JSON Schema dialect `SHOULD` be compatible with 2020-12.
- `info.version` `MUST` be semantic and traceable to generated SDK versions.
- Each operation `MUST` include `summary`, `operationId`, `tags`, `responses`, and explicit `security`.
- Each request and response body `MUST` declare media type and schema.
- `application/json` is the default success body media type.
- Error responses `MUST` include `application/problem+json`.

### 9.2 Security Schemes

App and backend protected operations use dual-token security. Protected open-api operations use API key security, OAuth bearer security, flexible API-key/OAuth security, or the explicit API-key-or-dual-token alternatives according to the route manifest when they are not explicitly public.

```yaml
components:
  securitySchemes:
    AuthToken:
      type: http
      scheme: bearer
      bearerFormat: JWT
    AccessToken:
      type: apiKey
      in: header
      name: Access-Token
      description: Signed JWT access_token compact serialization (`header.payload.signature`).
    ApiKey:
      type: apiKey
      in: header
      name: X-API-Key
    OAuthBearer:
      type: http
      scheme: bearer
      bearerFormat: JWT
    IngressToken:
      type: apiKey
      in: header
      name: X-SDKWork-Ingress-Token
    AgentToken:
      type: apiKey
      in: header
      name: X-SDKWork-Agent-Token
```

Rules:

- Protected app-api and backend-api operations `MUST` require both `AuthToken` and `AccessToken`.
- Protected open-api operations with `auth.mode: api-key` `MUST` require `ApiKey`.
- Protected open-api operations with `auth.mode: oauth` `MUST` require `OAuthBearer`.
- Protected open-api operations with `auth.mode: open-api-flexible` `MUST` declare separate `ApiKey` and `OAuthBearer` security alternatives; runtime selection follows `WEB_FRAMEWORK_SPEC.md` section 6.1.
- Protected open-api operations with `auth.mode: api-key-or-dual-token` `MUST` declare an `ApiKey` alternative and one combined `AuthToken` plus `AccessToken` alternative. The two tokens are an AND requirement inside one object; the API-key and dual-token objects are OR alternatives.
- Credential-entry bootstrap operations `MUST` require only `AccessToken`. They `MUST NOT` require or accept `AuthToken`, `ApiKey`, `OAuthBearer`, `IngressToken`, or `AgentToken`.
- Refresh-token operations carry refresh proof only through the declared request body or a dedicated refresh-token channel. They `MUST` declare `security: []` when the proof is modeled in the request body and `MUST NOT` inherit session or bootstrap headers.
- Internal ingress-token and agent-token operations `MUST` declare only their matching security scheme unless an approved compatibility contract explicitly says otherwise.
- Public operations `MUST` explicitly set `security: []`.
- `Authorization: Bearer <auth_token>` authenticates the principal/session on app-api/backend-api dual-token requests and on the dual-token branch of an `api-key-or-dual-token` open-api request.
- `Authorization: Bearer <token>` on open-api OAuth routes carries an OAuth bearer credential. It `MUST NOT` be treated as app-api `auth_token` when `Access-Token` is absent and the route declares `oauth` or `open-api-flexible`.
- `Access-Token: <JWT access_token>` carries access context such as tenant, organization, app, environment, and scope claims on app-api/backend-api requests and on the dual-token branch of an `api-key-or-dual-token` open-api request. Semicolon claim-string values are forbidden.
- `X-API-Key` carries an API key credential only. The server resolves tenant, organization, user, app, scope, and key identity from the validated API key object.
- `Access-Token` is the canonical SDKWork access isolation header for v3 app-api/backend-api contracts and explicitly declared open-api dual-token branches.
- Do not define duplicate security scheme names for the same token.
- Open-api credential modes and dual-token mode `MUST` be mutually exclusive for one request.
- App-api login/session creation operations are pre-session credential-entry operations. Unless explicitly classified as pure anonymous or refresh-token proof, they `MUST` use the `credential-entry-bootstrap` profile, require bootstrap `AccessToken`, and reject session, API-key, agent, ingress, and context-projection credentials.

Protected app/backend operation example:

```yaml
security:
  - AuthToken: []
    AccessToken: []
```

Protected open-api operation examples:

```yaml
# auth.mode: api-key
security:
  - ApiKey: []

# auth.mode: oauth
security:
  - OAuthBearer: []

# auth.mode: open-api-flexible
security:
  - ApiKey: []
  - OAuthBearer: []

# auth.mode: api-key-or-dual-token
security:
  - ApiKey: []
  - AuthToken: []
    AccessToken: []

# auth.mode: credential-entry-bootstrap
security:
  - AccessToken: []

# auth.mode: ingress-token
security:
  - IngressToken: []

# auth.mode: agent-token
security:
  - AgentToken: []
```

Public operation example:

```yaml
security: []
```

## 10. Token And Tenant Isolation Standard

The dual-token model separates authentication from access isolation.

Every operation has exactly one canonical authentication profile. The profile is contract metadata, SDK transport policy, framework resolver selection, and credential-contamination policy; these layers `MUST NOT` infer different profiles for the same operation.

| `x-sdkwork-auth-mode` | Allowed request credentials | Required context source | Forbidden automatic credentials |
| --- | --- | --- | --- |
| `anonymous` | None | Anonymous framework context | All stored/session/API credentials |
| `credential-entry-bootstrap` | Bootstrap `Access-Token` only | Validated bootstrap access JWT | `Authorization`, refresh token, API key, OAuth bearer, ingress/agent token, client context projection |
| `refresh-token` | Declared refresh proof only | Validated refresh session/proof | Stored auth/access tokens, API key, OAuth bearer, client context projection |
| `dual-token` | `Authorization` plus `Access-Token` | Validated matching session and access claims | API key, OAuth-only, ingress/agent token, client context projection |
| `api-key` | `X-API-Key` only | Server-side API-key lookup | App/backend session credentials and client context projection |
| `oauth` | OAuth bearer only | Server-side OAuth token/session lookup | Access token, API key, ingress/agent token, client context projection |
| `open-api-flexible` | API key or OAuth bearer | Detector-selected server-side lookup | App/backend session credentials and client context projection |
| `api-key-or-dual-token` | `X-API-Key` only, or `Authorization` plus `Access-Token` | API-key lookup or validated matching session and access claims | API key mixed with either token, incomplete dual-token credentials, ingress/agent token, client context projection |
| `ingress-token` | `X-SDKWork-Ingress-Token` only | Trusted ingress-token resolver | User/session/API-key credentials and client context projection |
| `agent-token` | `X-SDKWork-Agent-Token` only | Trusted agent-token resolver | User/session/API-key credentials and client context projection |
| `compatibility` | Operation-defined external protocol | Approved compatibility adapter | Any credential outside the external contract |

- Credential presence never changes the declared profile. A request with headers from another profile fails in the framework credential-contamination guard before business logic.
- `anonymous` means no credential, not "session optional". A route that requires an application/tenant bootstrap access JWT is `credential-entry-bootstrap`.
- `security` and `x-sdkwork-auth-mode` `MUST` agree. One OpenAPI security object means all schemes in that object are required together; separate objects express alternatives. Therefore `open-api-flexible` uses separate `ApiKey` and `OAuthBearer` objects, while `api-key-or-dual-token` uses one `ApiKey` object and one combined `AuthToken` plus `AccessToken` object.
- Tenant/app context for `credential-entry-bootstrap` comes from the validated bootstrap JWT. Tenant/session context for `refresh-token` comes from the validated refresh proof; neither route may fall through to dual-token handling.

| Token | Header | Purpose |
| --- | --- | --- |
| `auth_token` | `Authorization: Bearer` | Principal identity, session identity, tenant, organization, login scope, authentication strength, token expiry |
| `access_token` | `Access-Token` | Principal identity, session identity, tenant, organization, login scope, app, environment, deployment profile, runtime target, data scope, permission scope |

Rules:

- Tenant isolation data `MUST` be resolvable from verified token claims or a server-side token lookup.
- `auth_token` and `access_token` `MUST` both carry matching `tenant_id`, `organization_id`, `login_scope`, `user_id`/`sub`, and `session_id`/`sid` claims.
- `login_scope` `MUST` be `TENANT` when `organization_id` is absent or `0`, and `ORGANIZATION` when `organization_id` is present and non-zero. Contradictory token claims are invalid.
- Business requests `MUST NOT` trust tenant, organization, role, or user IDs supplied only by body/query parameters when they conflict with token context.
- Current-tenant selection `MUST NOT` be modeled as a client-supplied OpenAPI parameter or request field. Protected app-api, backend-api, and open-api contracts `MUST NOT` declare `tenant_id`, `tenantId`, `tenant`, `tenant-id`, `X-Tenant-Id`, or equivalent tenant selectors in path, query, header, cookie, or client-writable request body solely to choose the authenticated tenant.
- Protected open-api callers get tenant context from the validated API key record, validated OAuth bearer token/session lookup, or validated matching auth/access token claims when the declared profile includes that branch.
- API paths `MUST NOT` use `/tenants/{tenantId}/...` to scope ordinary current-tenant business resources. Use context-relative resources such as `/orders`, `/files`, or `/iam/organizations`, then enforce tenant and data scope from `WebRequestContext`.
- Explicit tenant administration or cross-tenant platform operations may address a tenant as the managed resource only when the operation is `backend-admin` or platform scoped, declares a platform/cross-tenant permission, and verifies explicit authorization. Such identifiers must be target/resource identifiers, not ambient request context selectors, and they `MUST NOT` weaken the ban on generated `tenant_id` or `tenantId` current-context inputs.
- If a request path contains a tenant or organization resource identifier, the server `MUST` verify it matches or is authorized by token claims.
- A token claim that affects authorization `MUST` be signed or server-validated.
- Auth/session creation endpoints in app-api are pre-session credential verification flows. They use `credential-entry-bootstrap` unless the IAM authority explicitly declares a pure-anonymous exception, and they return standard token objects and context metadata only after resolving the real IAM user, tenant, and organization context server-side.
- Multi-organization login `MUST` be represented as a documented continuation response, not as a normal authenticated session. The continuation credential is not valid for protected business operations.
- Production token validation `MUST` use tenant-bound signing keys or a server-side session lookup that proves tenant binding. A global shared tenant signing secret is forbidden for production and production-like profiles.
- Local Rust deployment `MUST` enforce the same logical token and tenant checks even if tokens are issued locally.

### 10.0 Bootstrap Access Credential

Every application root that consumes protected app-api or backend-api surfaces
`MUST` document a private bootstrap access credential in its env template.
Service-context runtimes `SHOULD` configure `SDKWORK_ACCESS_TOKEN` before
interactive login.

Rules:

- `SDKWORK_ACCESS_TOKEN` `MUST` contain a signed SDKWork `access_token` whose claims carry the ambient request context: at minimum `tenant_id`, `organization_id`, `app_id`, `environment`, `deployment_profile`, `runtime_target`, and applicable scope metadata.
- `auth_token`, `refresh_token`, and API keys `MUST NOT` be configured through environment variables. They are obtained only from sdkwork-iam login, refresh, and current-session flows.
- Bootstrap env credentials seed the global TokenManager or service-context credential provider only. They `MUST NOT` be copied into browser public runtime config, URLs, logs, UI, or feature state.
- Login, registration, refresh, current-session bootstrap, and organization-selection completion `MUST` replace bootstrap credentials with IAM-issued session tokens.
- Client request bodies, query parameters, path parameters, and SDKWork context-projection headers `MUST NOT` select current tenant, organization, user, session, or app scope when token claims already define that scope.

### 10.1 Recommended Token Claims

```json
{
  "sub": "user_01",
  "sid": "session_01",
  "tenant_id": "100001",
  "organization_id": "0",
  "login_scope": "TENANT",
  "token_type": "access",
  "app_id": "sdkwork_router",
  "environment": "prod",
  "scope": ["iam.users.read", "iam.roles.write"],
  "auth_level": "password_mfa",
  "iat": 1760000000,
  "exp": 1760003600
}
```

### 10.2 SDKWork Request Context Framework

All SDKWork HTTP implementations for open-api, app-api, and backend-api `MUST` expose a unified `WebRequestContext` before protected business handlers run. The standard Rust framework is `sdkwork-web-framework`; Java and other runtimes must preserve the same behavior and vocabulary. Integration rules are defined in `WEB_FRAMEWORK_SPEC.md`; IAM and domain projections are implemented by appbase or application-line adapters through framework extension traits.

`AppRequestContext` is a migration-only alias for `WebRequestContext`. New contracts, OpenAPI extensions, handlers, and documentation `MUST` use `WebRequestContext`.

Required context object:

```text
WebRequestContext =
  request_id
  api_surface
  auth_mode
  transport
  principal

WebRequestPrincipal =
  tenancy.tenant_id
  tenancy.organization_id
  tenancy.login_scope
  subject.user_id
  subject.session_id
  subject.subject_type
  app.app_id
  app.environment
  app.deployment_profile
  app.runtime_target
  auth.auth_level
  auth.api_key_id
  scopes.data_scope
  scopes.permission_scope
```

API surface and resolver standard:

| Surface | Prefixes | Auth mode | Resolver standard |
| --- | --- | --- | --- |
| `open-api` | Any approved SDKWork HTTP API prefix outside `/app/v3/api` and `/backend/v3/api`, for example `/im/v3/api` | `api-key`, `oauth`, `open-api-flexible`, or `api-key-or-dual-token` | Framework API-key/OAuth lookup or dual-token validation resolves the declared credential branch and produces `WebRequestPrincipal`. Flexible routes additionally use `OpenApiCredentialSchemeDetector`; API-key-or-dual-token routes use exact combination validation. |
| `app-api` | `/app/v3/api` | Dual token | Framework `WebRequestContextResolver` validates dual tokens and produces one principal context. |
| `backend-api` | `/backend/v3/api` | Dual token | Framework `WebRequestContextResolver` validates dual tokens and produces one principal context. |

Rules:

- `WebRequestContext` `MUST` be resolved once at the framework boundary and injected as a typed request extension or equivalent runtime context.
- Business handlers `MUST` consume the typed context. They `MUST NOT` reparse auth tokens, access tokens, API keys, or tenant/user fields from raw headers.
- `WebRequestContextResolver`, `ApiKeyLookupService`, `OAuthTokenLookupService`, `OpenApiCredentialSchemeDetector`, `AuthorizationPolicy`, `TenantIsolationPolicy`, and `DomainContextInjector` are standard framework extension points. appbase and application repositories implement them; they `MUST NOT` expose a parallel HTTP context framework.
- The default parser may support standalone development claim formats, but
  production parsers `MUST` validate signature, tenant-bound signing key or key
  id, token type, expiry, issuer, audience, revocation, tenant binding,
  organization binding, login-scope consistency, app binding, deployment
  profile, runtime target, and permission scope.
- API key lookup `MUST` be abstracted behind a service/interface. Implementations may use `iam_api_key`, tenant-local API key tables, encrypted secret stores, caches, or remote IAM services.
- OAuth bearer lookup `MUST` be abstracted behind a service/interface. Implementations may validate access-token hashes against `iam_session`, OAuth JWT claims with tenant-bound signing keys, or application-specific token stores.
- API key records `MUST` provide the principal user id, tenant id, organization id when applicable, app id, data scope, permission scope, key id, and revocation/expiry state.
- Protected app-api and backend-api requests `MUST` include `Access-Token: <JWT access_token>` whenever the client runtime has an access token from bootstrap or authenticated session state.
- Protected app-api and backend-api requests `MUST` include `Authorization: Bearer <JWT auth_token>` whenever the client runtime has an auth token from bootstrap or authenticated session state.
- Dual-token resolution `MUST` treat overlapping principal and tenancy claims from `auth_token` as authoritative when both tokens are present. Overlapping fields are `sub`/`user_id`, `sid`/`session_id`, `tenant_id`, `organization_id`, `login_scope`, and `auth_level`.
- Dual-token resolution `MUST` reject requests where `access_token` carries an overlapping claim that contradicts the authoritative `auth_token` value after normalization.
- Dual-token resolution `MUST` reject missing or conflicting `login_scope` claims and any `TENANT`/`ORGANIZATION` claim mismatch with `organization_id`.
- Access-isolation claims that exist only on `access_token`, such as `data_scope`, `permission_scope`, deployment profile, runtime target, and sharding hints, `MUST` be resolved from `access_token` even when `auth_token` is present.
- Context values from request body, query, path, or frontend state `MUST NOT` override the resolved context.

Forbidden client identity headers:

- Application clients `MUST NOT` send `x-sdkwork-tenant-id`,
  `x-sdkwork-user-id`, `x-sdkwork-actor-id`, `x-sdkwork-actor-kind`,
  `x-sdkwork-organization-id`, `x-sdkwork-session-id`, `x-sdkwork-app-id`,
  `x-sdkwork-environment`, `x-sdkwork-deployment-profile`,
  `x-sdkwork-deployment-mode`, `x-sdkwork-runtime-target`,
  `x-sdkwork-auth-level`, `x-sdkwork-data-scope`,
  `x-sdkwork-permission-scope`, `x-sdkwork-device-id`, or
  `x-sdkwork-context-signature`.
- Gateways `MUST NOT` require callers to supply those headers for protected app-api/backend-api traffic. When a gateway terminates TLS and re-issues service calls, it `MUST` forward only the standard dual-token credentials or an internal service identity, not caller-supplied tenant/user metadata.
- Servers `MUST` ignore or reject identity projection headers that conflict with verified token-derived context.

### 10.3 API Call Chain And Interceptor Standard

All SDKWork HTTP routers for open-api, app-api, and backend-api `MUST` run protected requests through an ordered API call chain. The chain is the standard place for cross-cutting policy, security, observability, and context injection. The standard Rust implementation is owned by `sdkwork-web-framework` (`WebCallInterceptorChain::standard()`); Java runtimes must preserve equivalent semantics.

Standard order:

1. Request identity
2. Surface classification
3. CORS
4. Method guard
5. Cross-site request guard
6. SQL injection request guard
7. Request size limit
8. Rate limit
9. Idempotency
10. Request context resolution
11. Authentication
12. Authorization
13. Tenant isolation
14. Context injection
15. Logging
16. Audit
17. Header security
18. Response identity

Rules:

- Frameworks `MUST` expose an interceptor interface equivalent to `WebCallInterceptor` with `before` and `after` phases.
- The standard chain `MUST` be extensible without bypassing context resolution or security guards.
- Request identity, surface classification, request context resolution, authentication, context injection, response identity, and secure response headers are mandatory for protected HTTP routers on all three API surfaces.
- Rust integrations `MUST` follow `WEB_FRAMEWORK_SPEC.md`; business repositories `MUST NOT` fork the chain locally.
- Authorization, tenant isolation, rate limit, idempotency, logging, and audit may be implemented by application-specific interceptors, but their hook positions and semantics `MUST` remain standard.
- CORS, method guard, cross-site request protection, request size limits, and SQL injection request guards `SHOULD` run before credential parsing to reduce attack surface.
- The SQL injection guard is a request-layer heuristic only. All database access `MUST` still use bind parameters, typed repositories, input validation, and server-side authorization.
- Error responses produced by the chain `MUST` use `application/problem+json` and include the server-owned request id when available.

## 11. Standard IAM API

IAM is the common base module for every app.

### 11.1 Auth Sessions

| Method | Path | operationId | Security |
| --- | --- | --- | --- |
| `POST` | `/app/v3/api/auth/sessions` | `sessions.create` | Public |
| `POST` | `/app/v3/api/auth/sessions/login_context_selection` | `sessions.loginContextSelection` | Public continuation |
| `POST` | `/app/v3/api/auth/sessions/organization_selection` | `sessions.organizationSelection` | Public continuation; compatibility alias for organization login only |
| `GET` | `/app/v3/api/auth/sessions/current` | `sessions.current.retrieve` | Dual token |
| `PATCH` | `/app/v3/api/auth/sessions/current` | `sessions.current.update` | Dual token; supports `loginScope` personal/organization switch |
| `DELETE` | `/app/v3/api/auth/sessions/current` | `sessions.current.delete` | Dual token |
| `POST` | `/app/v3/api/auth/sessions/refresh` | `sessions.refresh` | Public or refresh-token proof |

### 11.2 Verification And Recovery

| Method | Path | operationId |
| --- | --- | --- |
| `POST` | `/app/v3/api/messaging/verification_codes` | `messaging.verificationCodes.create` |
| `POST` | `/app/v3/api/messaging/verification_codes/verify` | `messaging.verificationCodes.verify` |
| `GET` | `/app/v3/api/auth/verification_policy` | `verificationPolicy.retrieve` |
| `POST` | `/app/v3/api/auth/password_reset_requests` | `passwordResetRequests.create` |
| `POST` | `/app/v3/api/auth/password_resets` | `passwordResets.create` |
| `POST` | `/app/v3/api/oauth/authorization_urls` | `oauth.authorizationUrls.create` |
| `POST` | `/app/v3/api/oauth/sessions` | `oauth.sessions.create` |

### 11.3 IAM Resource Management

These paths belong to app-api for user-facing self-service and to backend-api for administrative management when needed. The path, schema, and operationId must remain consistent.

| Resource | Standard path |
| --- | --- |
| Tenants | `/iam/tenants` |
| Tenant memberships | `/iam/tenants/current/members` |
| Organizations | `/iam/organizations` |
| Organization tree | `/iam/organizations/tree` |
| Organization members | `/iam/organizations/{organizationId}/members` |
| Users | `/iam/users` |
| Current user | `/iam/users/current` |
| Roles | `/iam/roles` |
| Permissions | `/iam/permissions` |
| Role permissions | `/iam/roles/{roleId}/permissions` |
| User roles | `/iam/users/{userId}/roles` |
| Policies | `/iam/policies` |
| API keys | `/iam/api_keys` |
| Security events | `/iam/security_events` |
| Audit events | `/iam/audit_events` |

## 12. Schema Naming Standard

Schema names use `PascalCase`.

| Category | Pattern | Example |
| --- | --- | --- |
| Resource | `<Domain><Resource>` or clear resource name | `IamUser`, `Tenant`, `Organization` |
| Create request | `Create<Resource>Request` | `CreateSessionRequest` |
| Update request | `Update<Resource>Request` | `UpdateOrganizationRequest` |
| Patch request | `Patch<Resource>Request` | `PatchUserRequest` |
| List params | `List<Resource>Params` | `ListUsersParams` |
| Page response | `<Resource>ListResponse` wrapping `SdkWorkPageData` | `UserListResponse` |
| Command response | `<Action><Resource>Response` wrapping `SdkWorkCommandData` | `VerifyCodeResponse` |
| Error | `ProblemDetail` | `ProblemDetail` |

Rules:

- Request schemas `MUST NOT` reuse entity schemas directly when writable fields differ from readable fields.
- Response schemas `MUST` avoid leaking password hashes, token secrets, internal IDs not intended for clients, deleted data, or private security metadata.
- Enum schemas `SHOULD` use string values for API stability unless numeric values are legally required.
- `additionalProperties` `MUST` be explicit.

## 13. Field Naming And Type Mapping

JSON field names use `lowerCamelCase`.

Database fields use `lower_snake_case`, but API fields use `lowerCamelCase`.

| Database | API |
| --- | --- |
| `tenant_id` | `tenantId` |
| `organization_id` | `organizationId` |
| `created_at` | `createdAt` |
| `updated_at` | `updatedAt` |
| `auth_token` | `authToken` |
| `access_token` | `accessToken` |

Cross-language-safe type mapping:

| Logical type | OpenAPI schema | JSON representation |
| --- | --- | --- |
| `int64` | `type: string`, `format: int64`, `pattern: "^-?[0-9]+$"` plus `x-sdkwork-int64-string: true` | String |
| `decimal` | `type: string`, decimal pattern | String |
| `instant` | `type: string`, `format: date-time` | ISO 8601 UTC |
| `date` | `type: string`, `format: date` | ISO date |
| `uuid` | `type: string`, `format: uuid` when true UUID | String |
| `json` | Explicit object schema or `additionalProperties` | Object |
| `enum` | `type: string`, `enum` | String |

Rules:

- API `int64` values `MUST` be strings to avoid JavaScript precision loss.
- The string rule applies only at the HTTP JSON/browser/generated-TypeScript boundary. Rust, Java, Go, C#, database schemas, and internal domain models `MUST` keep their native numeric representations such as Rust `i64`, Java `long`, Go `int64`, C# `long`, and SQL `BIGINT`.
- OpenAPI schemas for browser-facing `int64` fields and parameters `MUST NOT` use `type: integer, format: int64`. They `MUST` use `type: string`, `format: int64`, a digit pattern such as `^-?[0-9]+$`, `^[0-9]+$`, or `^[1-9][0-9]*$`, `x-sdkwork-int64-string: true`, and a native implementation hint such as `x-sdkwork-rust-type: i64` when the Rust side owns the endpoint.
- Frontend code and generated TypeScript SDKs `MUST` receive, store, compare, and submit `int64` values as strings. They `MUST NOT` parse `int64` IDs, snowflake IDs, versions, sequence numbers, byte counters, or monetary minor-unit values into JavaScript `number`.
- Server HTTP adapters `MUST` parse inbound `int64` strings at the request boundary, validate sign/range/domain constraints, and pass native numeric values into Rust/domain/database code. Business logic and SQL bindings must not be rewritten to string IDs merely because the browser JSON contract is string-based.
- IAM principal ids (`tenant_id`, `user_id`, `organization_id`) and SQL subject scope projection rules are defined in `SUBJECT_ID_SPEC.md`. OpenAPI fields that represent those subject ids `MUST` follow the int64-string rules above.
- **OpenAI/Anthropic compatible gateway exemption**: OpenAPI documents that mirror a third-party wire protocol (OpenAI / Anthropic compatible gateways) `MAY` declare `x-sdkwork-int64-openai-compat: true` on the document root. Those protocols require JSON numbers for Unix timestamps, byte sizes, and seeds, and every such value stays below `Number.MAX_SAFE_INTEGER` (2^53), so the browser rounding failure class does not apply. The marker must be present on the API authority and every derived mirror; the operation-patterns validator skips the int64-string closure for marked documents only.
- Monetary and high-precision decimals `MUST` be strings.
- Timestamps `MUST` be ISO 8601 UTC unless a domain explicitly requires a local date.
- Use `nullable` semantics through JSON Schema union types, for example `type: ["string", "null"]`.
- Images, videos, audio, voice, documents, archives, generated media, product media, upload results, and object-storage backed files `MUST` use `MediaResource` or `MediaResource[]` from `MEDIA_RESOURCE_SPEC.md` in new SDKWork-owned business contracts.
- SDKWork-owned file upload, download, provider, bucket/object, upload-session, and object-storage lifecycle APIs `MUST` be Drive APIs governed by `DRIVE_SPEC.md`. Product, IM, commerce, profile, app manifest, and AI business APIs consume Drive references and `MediaResource`; they must not define parallel storage lifecycle APIs.
- Bare media URL fields such as `avatarUrl`, `coverImage`, `thumbnailUrl`, `videoUrl`, `audioUrl`, `fileUrl`, `assetUrl`, and `imageUrl` `MUST NOT` appear in SDKWork-owned business DTOs for new applications. They must be replaced by natural business-role fields such as `avatar`, `cover`, `thumbnail`, `poster`, `video`, `audio`, `file`, `document`, `asset`, `mainImage`, `galleryImage`, `detailImage`, or `skuImage` whose schema type is `MediaResource`.
- Bare URL fields are allowed only when the field is explicitly a non-media link, endpoint, callback, payment, or provider-adapter wire field. Provider-adapter wire fields must be normalized to `MediaResource` before entering SDKWork-owned business contracts.
- Request body schemas used for list/search/filter input `MUST` use `q` for generic free-text search. They `MUST NOT` expose duplicate aliases such as `keyword`, `search`, `searchQuery`, or `search_query` for the same meaning.
- Response schemas and domain history objects may use explicit domain fields such as `keyword` when the field is stored or returned data, not a client-side generic search input.
- OpenAI-compatible `/v1` schemas may keep OpenAI wire names such as `search_query`; do not rename OpenAI compatibility fields to `q`.
- Do not rely on OpenAPI `format` alone for validation; important constraints `SHOULD` include `pattern`, `minimum`, `maximum`, `minLength`, `maxLength`, or `enum`.

### 13.1 MediaResource Schema Standard

`MediaResource` is the canonical HTTP API representation for usable SDKWork media resources. Drive is the storage lifecycle authority for SDKWork-owned object-storage-backed files.

Rules:

- API surfaces `SHOULD` define reusable `MediaResource`, `MediaKind`, `MediaSource`, `MediaAccess`, `MediaChecksum`, and `MediaAiProvenance` components following `MEDIA_RESOURCE_SPEC.md`.
- Persisted media resources `MUST` include stable identity such as `id`, Drive `uri`, Drive `objectBlobId`, or a provider `uri`; `url` alone is not a stable persisted identity.
- `url` inside `MediaResource` is a delivery hint and may be signed or temporary. APIs must not require clients to parse storage identity out of it.
- Drive upload APIs may return presigned URLs or upload sessions, but the completion result `SHOULD` return a Drive resource and a `MediaResource` or enough stable fields to construct one.
- SDKWork-owned business APIs `MUST NOT` expose `bucketId`, `objectKey`, provider endpoints, or presigned URLs as normal business DTO identity. Those fields are allowed only in Drive backend/admin or internal provider-adapter APIs.
- AI provider adapter DTOs may preserve provider-native names such as `image_url`, `audio_url`, `video_url`, `uri`, or `url`. SDKWork business DTOs must normalize them to `MediaResource` before storing or publishing domain state.
- Recursive `MediaResource` fields for `poster`, `thumbnails`, and `variants` may be replaced with non-recursive `MediaVariant`/`MediaRendition` helper schemas only when a generator cannot safely emit recursive SDK types.

## 14. Request Body Standard

SDKWork-owned business operations on `app-api`, `backend-api`, and `open-api` `MUST` follow this section. Vendor compatibility open-api operations declared with `x-sdkwork-wire-protocol: external` per section 4.5.2 `MAY` preserve upstream request shapes instead.

Rules:

- Request body schemas `MUST` define required fields explicitly.
- `POST`, `PUT`, and `PATCH` `SHOULD` use JSON object bodies unless file upload or form semantics are required.
- Partial update `PATCH` schemas `MUST` distinguish omitted fields from explicit `null`.
- Sensitive fields such as password, verification code, token, and private key `MUST` be `writeOnly: true`.
- Server-managed fields such as `id`, `tenant_id`, `tenantId`, `createdAt`, `updatedAt`, `version`, and audit fields `MUST NOT` be client-writable unless explicitly documented.
- Create, update, and command request bodies `MUST NOT` require or accept client-writable `tenant_id` or `tenantId` fields to select the current tenant. The authenticated tenant is resolved from token/API-key context before handlers run.

Example:

```yaml
CreateSessionRequest:
  type: object
  additionalProperties: false
  required: [loginName, password]
  properties:
    loginName:
      type: string
      minLength: 1
      maxLength: 320
    password:
      type: string
      minLength: 8
      maxLength: 256
      writeOnly: true
    tenantHint:
      type: [string, "null"]
      maxLength: 128
```

### 14.1 Query, List, Search, And Mutation Input Standard

List, search, and filter inputs `MUST` use explicit typed parameters or typed request bodies. Free-form SQL-like filter expressions, ad hoc JSON query DSLs, and duplicate search parameter aliases are forbidden unless a governance register entry documents an L3 exception.

Shared OpenAPI parameter and schema templates live under:

- `templates/openapi/components/parameters/query-parameters.yaml`
- `templates/openapi/components/schemas/sdkwork-list-query.yaml`

#### 14.1.1 Simple List Input (`GET`)

Use `GET` with query parameters when the list can be expressed with the standard parameter set and remains within URL length limits.

| Wire parameter | JSON body equivalent | Type | Default | Rules |
| --- | --- | --- | --- | --- |
| `page` | `page` | integer | `1` | One-based page index. Required for offset mode. Mutually exclusive with `cursor`. |
| `page_size` | `pageSize` | integer | `20` | Minimum `1`, maximum `200`. |
| `cursor` | `cursor` | string | — | Opaque token from prior `pageInfo.nextCursor`. Mutually exclusive with `page`. |
| `sort` | `sort` | string | — | Comma-separated API field names. Prefix `-` for descending. Maximum 3 fields. |
| `q` | `q` | string | — | Generic free-text search. Maximum length `256`. |
| `created_after` | `createdAfter` | date-time | — | Inclusive lower bound on `createdAt`. |
| `created_before` | `createdBefore` | date-time | — | Exclusive upper bound on `createdAt`. |
| `updated_after` | `updatedAfter` | date-time | — | Inclusive lower bound on `updatedAt`. |
| `updated_before` | `updatedBefore` | date-time | — | Exclusive upper bound on `updatedAt`. |
| `ids` | `ids[]` | string / array | — | Comma-separated int64-string ids in query; array in JSON body. Maximum `100` ids. |

Rules:

- Query parameter names `MUST` use lowercase URL wire names (`page_size`, `created_after`).
- JSON request body field names `MUST` use camelCase (`pageSize`, `createdAfter`) per §13.
- `pageSize` is the JSON/body or response field equivalent of `page_size`; it `MUST NOT` be accepted or documented as a GET query parameter.
- List/search GET operations `MUST NOT` accept `limit`, `page_no`, `pageNo`, `per_page`, `size`, or other aliases for the standard pagination parameters. Pre-launch applications `MUST` reject those aliases with `40003 INVALID_PARAMETER` instead of silently mapping them.
- `GET` list operations `MUST NOT` accept a request body.
- Domain filters beyond the standard set `MUST` use explicit query parameters such as `status`, `organization_id`, or `role_id`. Each filter parameter `MUST` be typed and documented.
- A list operation `MUST NOT` accept both `page` and `cursor` in the same request.
- An intentional operation-specific `page_size` maximum above `200` requires an unexpired `x-sdkwork-pagination-exception` record on that OpenAPI operation. The record `MUST` include `id`, `spec`, `rule`, `owner`, `reason`, `risk`, `expiresAt`, `removalPlan`, `maximumPageSize`, and non-empty `controls`; `maximumPageSize` `MUST` equal the parameter schema maximum. This exception does not change the platform default or any sibling operation.
- When `cursor` and `page` are both supplied, servers `MUST` reject the request with `40003 INVALID_PARAMETER`. Already-launched L0/L1 authorities that temporarily keep ignore semantics `MUST` record a migration exception per `MIGRATION_SPEC.md`; new and pre-launch authorities have no exception path.

Sort grammar:

```text
sort = sortField *( "," sortField )
sortField = [ "-" ] fieldName
fieldName = API schema field name in camelCase, for example createdAt, displayName
```

Examples:

```text
GET /app/v3/api/forum/topics?page=2&page_size=20&sort=-createdAt,title&q=release
GET /app/v3/api/iam/users?cursor=eyJwIjo2fQ&page_size=50&status=active
```

#### 14.1.2 Complex List Or Search Input (`POST`)

Use `POST /<collection>/search` or `POST /<collection>:search` when any of the following is true:

- filter cardinality exceeds practical URL limits;
- the query requires nested filter objects;
- the application requires saved or audited search bodies;
- the search input would exceed safe URL length.

Rules:

- Request body `MUST` extend `SdkWorkListQuery` or `SdkWorkListQueryWithFilters` from the shared templates.
- Response `MUST` still use `SdkWorkApiResponse` with `SdkWorkPageData`.
- `POST` search/list operations `MUST` be safe and idempotent. They `MUST NOT` mutate server state.
- `operationId` `SHOULD` use `<resource>.search`, for example `forum.topics.search`.

Example:

```yaml
ForumTopicSearchRequest:
  allOf:
    - $ref: "#/components/schemas/SdkWorkListQuery"
    - type: object
      additionalProperties: false
      properties:
        filters:
          $ref: "#/components/schemas/ForumTopicSearchFilters"
```

#### 14.1.3 Single-Resource, Mutation, And Command Input

| Operation kind | HTTP | Path pattern | Request input | Required headers |
| --- | --- | --- | --- | --- |
| Retrieve | `GET` | `/<collection>/{id}` | path `id` | auth per surface |
| Create | `POST` | `/<collection>` | typed create body | auth; `Idempotency-Key` when retriable or externally visible |
| Replace | `PUT` | `/<collection>/{id}` | typed full body | auth; `If-Match` when optimistic concurrency is required |
| Patch | `PATCH` | `/<collection>/{id}` | typed partial body | auth; `If-Match` when optimistic concurrency is required |
| Delete | `DELETE` | `/<collection>/{id}` | path `id` only; no JSON body | auth |
| Command | `POST` | `/<collection>/{id}/<action>`, `/<collection>/{id}:<action>`, or `/<collection>:<action>` | typed command body | auth; `Idempotency-Key` when retriable |
| Bulk command | `POST` | `/<collection>:bulk<Action>` | typed bulk body | auth; `Idempotency-Key` when retriable |

Rules:

- Path parameters `MUST` identify the resource. Business filters `MUST NOT` be passed as undocumented query aliases on retrieve/delete routes.
- Create/update/command bodies `MUST` be explicit schemas with `additionalProperties: false` unless a documented open extension object is required.
- Optimistic concurrency `SHOULD` use entity `version` fields and/or `If-Match` headers. Version conflicts `MUST` map to `40901 CONFLICT`.
- Create request schemas `SHOULD` use `Create<Resource>Request`; partial update schemas `SHOULD` use `Update<Resource>Request`; command schemas `SHOULD` use `<Action><Resource>Request` or `<Resource><Action>Request` when that reads better in the domain.
- Create bodies `MUST NOT` require client-filled resource ids, tenant selectors, audit fields, timestamps, version fields, `traceId`, or `requestId`. Natural idempotency keys such as `externalOrderNo` are allowed only when they are real domain identifiers and not SDKWork correlation ids.
- `PUT` means full replacement of the resource representation. If omitted fields should remain unchanged, use `PATCH` instead.
- `PATCH` means partial update. Omitted fields mean no change; explicit `null` means clear the field only when the target schema allows null and the operation documents clear semantics.
- `DELETE` request bodies are forbidden for SDKWork-owned business APIs. If a deletion needs a reason, confirmation, cascade policy, or workflow transition, model it as a command such as `archive`, `disable`, `revoke`, or `cancel`.
- Command operations `MUST` use stable domain verbs. They `MUST NOT` hide read/list/search behavior behind `POST` only to avoid query parameters or pagination.
- Bulk bodies `MUST` contain an `items` array or an equivalent typed batch member, define a maximum item count, and document whether execution is all-or-nothing or item-partial.
- Import and export APIs that exceed normal request/response budgets `MUST` be modeled as asynchronous commands and use Drive or MediaResource contracts for file references instead of app-local upload/download lifecycle.

## 15. Response Standard

SDKWork-owned business operations on `app-api`, `backend-api`, and `open-api` `MUST` follow this section. Vendor compatibility open-api operations declared with `x-sdkwork-wire-protocol: external` per section 4.5.2 `MAY` preserve upstream response and error shapes instead.

SDKWork HTTP APIs use a dual-track response model:

- **Success (2xx with body):** canonical `SdkWorkApiResponse` envelope with numeric success `code` (`0`), typed `data`, and server-owned `traceId`.
- **Failure (non-2xx or 204 without business payload):** RFC 9457 `application/problem+json` with `ProblemDetail`, including numeric error `code` and `traceId`.

Shared OpenAPI components live under `templates/openapi/components/schemas/` in this repository. API authorities `MUST` `$ref` those components instead of inventing per-domain envelope names.

Forbidden legacy wire fields and envelopes (L0 exceptions require a governance register entry with removal plan):

- `PlusApiResult`, `AppbaseApiResult`, `StoreApiResult`, `SdkWorkResponse`, and per-domain `*ApiResult` wrappers.
- Bare domain DTOs at the HTTP JSON root without `SdkWorkApiResponse`.
- Top-level `{ items, pageInfo, traceId }` or `{ items, pageInfo, requestId }` without a `data` object.
- HTTP `200`/`201` bodies that use `success: false`, human `message`, or non-success `code` values to signal business failure.
- Response field `requestId`. SDKWork HTTP contracts `MUST` use `traceId` only.

### 15.1 Success Responses

#### 15.1.1 Canonical Envelope: `SdkWorkApiResponse`

Every L2+ `app-api`, `backend-api`, and `open-api` operation that returns a JSON body on success `MUST` use `SdkWorkApiResponse` or an operation-specific schema that is an `allOf` extension of `SdkWorkApiResponse` with a typed `data` property.

```yaml
SdkWorkApiResponse:
  type: object
  additionalProperties: false
  required: [code, data, traceId]
  properties:
    code:
      type: integer
      format: int32
      description: Numeric success result code. MUST be 0 on HTTP 2xx. See §15.3.
      enum: [0]
      default: 0
      minimum: 0
      maximum: 0
    data:
      description: Operation-specific payload. Typed per operation through allOf or explicit schema refs.
    traceId:
      type: string
      format: uuid
      description: Server-owned request correlation id for logs, support, audit, and client diagnostics. Clients MUST NOT supply this value.
```

Rules:

- `traceId` `MUST` be generated by `sdkwork-web-framework` response identity handling for every request that records correlation.
- The response header `X-SdkWork-Trace-Id` `SHOULD` echo `traceId` when the response has headers.
- `code` `MUST` be the integer `0` on every HTTP 2xx JSON success body per §15.3. REST semantics such as create (`201`) or async accept (`202`) remain on the HTTP status, not on `code`.
- `200` for successful retrieve/update/action with body.
- `201` for creation when a resource is created and returned. The body `MUST` still use `SdkWorkApiResponse` with `code: 0`.
- `202` for accepted asynchronous work. The body `MUST` use `SdkWorkApiResponse` with `SdkWorkAsyncData` and `code: 0`.
- `204` for successful delete/logout/no-body operations. `204` `MUST NOT` include a JSON body; expose `traceId` through `X-SdkWork-Trace-Id` only.
- Response schemas `MUST` be explicit in OpenAPI.
- Handlers `MUST` serialize success through framework response mapping. Controllers and route handlers `MUST NOT` hand-build incompatible envelopes.

Example single-resource response:

```json
{
  "code": 0,
  "data": {
    "item": {
      "id": "12884901888",
      "displayName": "Example"
    }
  },
  "traceId": "0195f2a0-7c44-7b2e-9f3a-2a6f5d8e91ab"
}
```

#### 15.1.2 `data` Payload Shapes

| Shape | When | Required `data` fields |
| --- | --- | --- |
| `SdkWorkResourceData` | retrieve/create/update of one resource | `item` |
| `SdkWorkPageData` | list/search | `items`, `pageInfo` |
| `SdkWorkCommandData` | command/mutation without full resource body | `accepted` |
| `SdkWorkAsyncData` | async accept (`202`) | `accepted`, `operationId`, `status` |
| `SdkWorkBulkData` | bulk command | `items`, `allOrNothing` |

`SdkWorkResourceData`:

```yaml
SdkWorkResourceData:
  type: object
  additionalProperties: false
  required: [item]
  properties:
    item:
      description: Typed domain resource for the operation.
```

`SdkWorkPageData`:

```yaml
SdkWorkPageData:
  type: object
  additionalProperties: false
  required: [items, pageInfo]
  properties:
    items:
      type: array
      items: {}
    pageInfo:
      $ref: "#/components/schemas/PageInfo"
```

`SdkWorkCommandData`:

```yaml
SdkWorkCommandData:
  type: object
  additionalProperties: false
  required: [accepted]
  properties:
    accepted:
      type: boolean
      const: true
    resourceId:
      type: string
    status:
      type: string
```

`SdkWorkAsyncData`:

```yaml
SdkWorkAsyncData:
  type: object
  additionalProperties: false
  required: [accepted, operationId, status]
  properties:
    accepted:
      type: boolean
      const: true
    operationId:
      type: string
    status:
      type: string
      enum: [pending, running, succeeded, failed, cancelled]
    pollUrl:
      type: string
      format: uri-reference
```

`SdkWorkBulkData`:

```yaml
SdkWorkBulkData:
  type: object
  additionalProperties: false
  required: [items, allOrNothing]
  properties:
    items:
      type: array
      maxItems: 100
      items:
        $ref: "#/components/schemas/SdkWorkBulkItemResult"
    allOrNothing:
      type: boolean
```

Rules:

- Single-resource success payloads `MUST` place the resource under `data.item`. Do not flatten resource fields directly under `data` or at the HTTP root.
- List success payloads `MUST` place `items` and `pageInfo` under `data`.
- Command success `MUST NOT` return `accepted: false` with HTTP 2xx. Failures `MUST` use `ProblemDetail` and the correct HTTP error status.
- Vendor compatibility APIs such as OpenAI `/v1/*`, Claude Code, or Codex tool wire formats `MAY` opt out only when declared with `x-sdkwork-wire-protocol: external` per section 4.5.2. SDKWork-owned business open-api, app-api, and backend-api operations `MUST NOT` opt out.

#### 15.1.3 OpenAPI Response Schema Naming

| Purpose | Pattern | Example |
| --- | --- | --- |
| Single resource | `<Resource>Response` | `ForumTopicResponse` |
| List | `<Resource>ListResponse` | `ForumTopicListResponse` |
| Command | `<Action><Resource>Response` | `CreateTopicResponse` |

Each `<X>Response` `SHOULD` be expressed as:

```yaml
ForumTopicResponse:
  allOf:
    - $ref: "#/components/schemas/SdkWorkApiResponse"
    - type: object
      required: [data]
      properties:
        data:
          $ref: "#/components/schemas/SdkWorkResourceData"
```

When `data.item` needs a concrete type, nest an explicit `item` property with `$ref` to the domain schema inside the `allOf` extension.

### 15.3 Result Code Standard (Numeric)

SDKWork uses **numeric `int32` result codes** on the wire. This follows the industry pattern used by errno-style APIs, public-cloud control planes, and payment gateways:

- **`0` means business success** on HTTP 2xx JSON bodies.
- **Non-zero codes mean failure** on HTTP 4xx/5xx `ProblemDetail` bodies.
- **HTTP status** carries REST transport semantics (`201 Created`, `202 Accepted`, `404 Not Found`, etc.).
- **Body `code`** carries stable machine-readable business/result semantics for SDKs, logs, metrics, and i18n.

String tokens such as `ok`, `validation_error`, or snake_case error names `MUST NOT` appear in `SdkWorkApiResponse.code` or `ProblemDetail.code`.

#### 15.3.1 Code Ranges

| Range | Meaning | Wire location |
| --- | --- | --- |
| `0` | Success | `SdkWorkApiResponse.code` on HTTP 2xx |
| `40001`–`49999` | Client/protocol errors aligned with HTTP 4xx | `ProblemDetail.code` |
| `50001`–`59999` | Server/platform errors aligned with HTTP 5xx | `ProblemDetail.code` |
| `60000`–`69999` | Domain business errors registered by the owning API authority | `ProblemDetail.code` |
| `70000`–`79999` | Integration or third-party mapped errors | `ProblemDetail.code` |

Platform error codes `SHOULD` follow:

```text
code = HTTP_status * 100 + sequence
```

where `sequence` is `01`–`99` within the HTTP status family.

#### 15.3.2 Platform Result Code Registry

Success:

| Code | Symbol | HTTP | When |
| --- | --- | --- | --- |
| `0` | `OK` | `2xx` with JSON body | Every successful business response |

Platform errors:

| Code | Symbol | HTTP | When |
| --- | --- | --- | --- |
| `40001` | `VALIDATION_ERROR` | `400`, `422` | Request validation failed; field-level details `SHOULD` appear in `errors[]` |
| `40002` | `MALFORMED_REQUEST` | `400` | Malformed JSON, invalid syntax, or unparsable request |
| `40003` | `INVALID_PARAMETER` | `400` | Known parameter has invalid type, range, or combination |
| `40004` | `MISSING_REQUIRED_FIELD` | `400` | Required field, parameter, or header is absent |
| `40101` | `AUTHENTICATION_REQUIRED` | `401` | Missing authentication |
| `40102` | `TOKEN_EXPIRED` | `401` | Access or auth token expired |
| `40103` | `INVALID_TOKEN` | `401` | Token signature, format, or claims invalid |
| `40104` | `SESSION_REVOKED` | `401` | Session revoked, logged out, or no longer valid |
| `40301` | `PERMISSION_REQUIRED` | `403` | Authenticated but missing required permission |
| `40302` | `INSUFFICIENT_SCOPE` | `403` | Token/API key scope insufficient for the operation |
| `40303` | `TENANT_ACCESS_DENIED` | `403` | Tenant mismatch or tenant access denied |
| `40304` | `ORGANIZATION_ACCESS_DENIED` | `403` | Organization mismatch or organization access denied |
| `40401` | `NOT_FOUND` | `404` | Resource not found or intentionally hidden |
| `40501` | `METHOD_NOT_ALLOWED` | `405` | HTTP method not supported for the route |
| `40801` | `REQUEST_TIMEOUT` | `408` | Server timed out waiting for the request |
| `40901` | `CONFLICT` | `409` | Version mismatch, duplicate unique key, or state conflict |
| `41001` | `GONE` | `410` | Resource permanently removed |
| `41201` | `PRECONDITION_FAILED` | `412` | ETag, version, or conditional header precondition failed |
| `41301` | `PAYLOAD_TOO_LARGE` | `413` | Request body exceeds allowed size |
| `41501` | `UNSUPPORTED_MEDIA_TYPE` | `415` | Content-Type unsupported |
| `42201` | `UNPROCESSABLE_ENTITY` | `422` | Semantically invalid command where `400` is too broad |
| `42301` | `LOCKED` | `423` | Resource locked and cannot be modified now |
| `42801` | `PRECONDITION_REQUIRED` | `428` | Required precondition header such as `If-Match` missing |
| `42901` | `RATE_LIMIT_EXCEEDED` | `429` | Rate limit or quota exceeded |
| `50001` | `INTERNAL_ERROR` | `500` | Unexpected server failure |
| `50201` | `BAD_GATEWAY` | `502` | Upstream gateway/proxy failure |
| `50301` | `SERVICE_UNAVAILABLE` | `503` | Dependency unavailable or maintenance |
| `50401` | `GATEWAY_TIMEOUT` | `504` | Upstream gateway/proxy timeout |

Recommended domain error templates (register in the owning API authority before use):

| Code | Symbol | Typical HTTP | When |
| --- | --- | --- | --- |
| `60001` | `BUSINESS_RULE_VIOLATION` | `409`, `422` | Domain invariant or business rule failed |
| `60002` | `QUOTA_EXCEEDED` | `409`, `429` | Product quota, seat limit, or usage cap exceeded |
| `60003` | `INVALID_STATE` | `409`, `422` | Resource state does not allow the requested transition |
| `60004` | `DUPLICATE_ENTRY` | `409` | Domain-visible duplicate create |
| `60005` | `OPERATION_NOT_ALLOWED` | `403`, `409` | Operation forbidden for current resource state or plan |

Recommended integration error templates:

| Code | Symbol | Typical HTTP | When |
| --- | --- | --- | --- |
| `70001` | `UPSTREAM_ERROR` | `502`, `503` | Third-party/provider returned an error |
| `70002` | `UPSTREAM_TIMEOUT` | `504` | Third-party/provider timed out |

OpenAPI authorities `SHOULD` `$ref` `SdkWorkPlatformErrorCode`, `SdkWorkDomainErrorCode`, and `SdkWorkSuccessCode` from `templates/openapi/components/schemas/sdkwork-result-code.yaml`. Generated SDKs `MUST` expose these as named constants/enums.

#### 15.3.3 Field Validation Subcodes

When `ProblemDetail.code` is `40001`, field-level entries in `errors[]` `MAY` include optional numeric subcodes:

| Subcode range | Meaning |
| --- | --- |
| `40011`–`40099` | Field-level validation detail while the top-level code remains `40001` |

Rules:

- Field subcodes `MUST NOT` replace `ProblemDetail.code`.
- `errors[].field` `MUST` use JSON Pointer or dot-path notation.
- `errors[].message` `MUST` be safe for logs and optional UI display.

Rules:

- HTTP 2xx JSON success bodies `MUST` use `code: 0` only. Non-zero `code` on HTTP 2xx is forbidden.
- `ProblemDetail.code` `MUST` be non-zero and `MUST` fall within the registered ranges above or in the owning API authority domain registry.
- `ProblemDetail.status` `MUST` align with the HTTP family implied by `code` (`40001` with `400` or `422`, `40101` with `401`, etc.).
- Domain business errors `MUST` use `60000`–`69999`, be documented in the owning API authority changelog, and `MUST NOT` collide with platform codes.
- Generated SDKs `SHOULD` expose named constants such as `ResultCode.OK = 0` and `ResultCode.VALIDATION_ERROR = 40001`.
- Logs, metrics, and support tooling `SHOULD` index by numeric `code` and `traceId`.
- UI i18n `SHOULD` map numeric codes to localized text through stable keys such as `errors.result.40001` per `I18N_SPEC.md`.

Legacy string success tokens (`ok`, `created`, `accepted`, `updated`, `deleted`) and string error tokens (`validation_error`, `not_found`, etc.) are forbidden on the wire for L2+ contracts.

### 15.2 Error Responses

All error responses `MUST` use `application/problem+json` and the standard `ProblemDetail` schema.

```yaml
ProblemDetail:
  type: object
  additionalProperties: true
  required: [type, title, status, code, traceId, instance]
  properties:
    type:
      type: string
      format: uri-reference
    title:
      type: string
    status:
      type: integer
      minimum: 100
      maximum: 599
    detail:
      type: string
    instance:
      type: string
      description: Request endpoint occurrence in the form `{METHOD} {routeTemplate}`.
    operationId:
      type: string
      description: OpenAPI operation id for the failing request when resolved by the web framework.
    authProfile:
      type: string
      description: Safe canonical `x-sdkwork-auth-mode` value for the matched operation.
    failedStage:
      type: string
      description: Safe canonical Web Framework stage that rejected the request.
    reason:
      type: string
      description: Stable non-secret diagnostic reason such as `credential_missing`, `token_expired`, `credential_headers_forbidden`, or `dependency_surface_unavailable`.
    code:
      type: integer
      format: int32
      description: Numeric error result code. MUST be non-zero. See §15.3.
      minimum: 40001
      maximum: 79999
    traceId:
      type: string
      format: uuid
      description: Server-owned request correlation id. Same semantics as SdkWorkApiResponse.traceId.
    i18nKey:
      type: string
      description: Optional stable localization key such as `errors.result.40001`. It is presentation metadata only and does not replace numeric code.
    locale:
      type: string
      description: Optional effective BCP 47 locale used by the framework message mapper, for example `zh-CN`.
    errors:
      type: array
      items:
        $ref: "#/components/schemas/FieldError"
```

Common status codes:

| Status | Meaning |
| --- | --- |
| `400` | Invalid request syntax or domain validation failure |
| `401` | Missing, invalid, or expired authentication |
| `403` | Authenticated but not authorized |
| `404` | Resource not found or intentionally hidden |
| `409` | Conflict, version mismatch, duplicate unique key |
| `412` | Precondition failed |
| `422` | Semantically invalid command where `400` is too broad |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `503` | Service unavailable |

Rules:

- Every operation `MUST` declare `application/problem+json` error responses or a shared `default` problem response.
- Do not return stack traces, SQL, credentials, token internals, or internal hostnames.
- Validation errors `SHOULD` include field-level `errors`.
- `traceId` `MUST` be present on every error and `MUST` match the success-body correlation semantics.
- `instance` `MUST` identify the failing endpoint as `{METHOD} {routeTemplate}`. The framework `MUST` use the matched OpenAPI route template when available; otherwise it `MUST` use a bounded, redacted request path that removes user, tenant, file, object, token, and provider identifiers per `OBSERVABILITY_SPEC.md`.
- `operationId` `MUST` be present when the web framework resolves the matched OpenAPI operation for the request. It `MUST NOT` be accepted from a client header or fabricated for an unmatched method/path; unresolved operations omit the field.
- SDKWork-owned custom routes `MUST` normalize framework, router, body-limit, media-type, extractor, validation, handler, timeout, and fallback 4xx/5xx responses to `application/problem+json` before the response leaves the Web Framework. Operation-level external protocol routes declared per section 4.5.2 preserve their external error wire instead.
- Framework-generated authentication, authorization, tenant-isolation, routing, and dependency-availability problems `SHOULD` include `authProfile`, `failedStage`, and a stable non-secret `reason` when the route is known. These fields `MUST NOT` expose token contents, lookup keys, subject secrets, or internal upstream addresses.
- `code` `MUST` use stable numeric values from §15.3.
- Missing credentials use `40101`; expired tokens use `40102`; malformed, unverifiable, wrong-issuer, wrong-audience, wrong-purpose, or contradictory tokens use `40103`; revoked sessions use `40104`; authenticated permission/scope/tenant/organization denials use the matching `403xx`; absent routes/resources use `40401`; unavailable dependency surfaces use `50301` or an applicable gateway `502xx`/`504xx`. A missing or unreachable dependency surface `MUST NOT` be reported as route `404`.
- SDKWork-owned problem details `SHOULD` include `i18nKey` when a safe localized message exists. The standard key for result codes is `errors.result.<code>` per `I18N_SPEC.md`.
- SDKWork-owned problem details `SHOULD` include `locale` when the framework resolved `WebRequestContext.locale`.
- Field-level validation errors intended for UI display `SHOULD` include `errors[].i18nKey` and sanitized `errors[].params`; localized strings must not replace stable field paths or numeric codes.
- Security-sensitive `404` may hide unauthorized resource existence, but this must be consistent for the operation.
- Business failures `MUST NOT` be encoded as HTTP 2xx `SdkWorkApiResponse` bodies with non-success `code`, `success`, or human `message` fields.
- Business failures `MUST NOT` use localized `message` fields, string result tokens, or translated text as machine state.
- Response field `requestId` `MUST NOT` appear in new or migrated contracts.

Example validation error:

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 422,
  "code": 40001,
  "traceId": "0195f2a0-7c44-7b2e-9f3a-2a6f5d8e91ab",
  "i18nKey": "errors.result.40001",
  "locale": "zh-CN",
  "instance": "POST /app/v3/api/auth/login",
  "operationId": "auth.login.create",
  "detail": "One or more fields are invalid.",
  "errors": [
    {
      "field": "loginName",
      "message": "must not be blank",
      "code": 40011,
      "i18nKey": "validation.iam.auth.loginName.required",
      "params": {}
    }
  ]
}
```

Example internal error:

```json
{
  "type": "https://docs.sdkwork.com/problems/50001",
  "title": "Internal server error",
  "status": 500,
  "code": 50001,
  "traceId": "67b4e4c7d1554a00b946dcc426820ea2",
  "instance": "GET /app/v3/api/wallet/transactions",
  "operationId": "wallet.transactions.list",
  "detail": "An internal error occurred"
}
```

### 15.4 Operation Input And Output Contract Matrix

Every L2+ business operation `MUST` map to one of the standard contract patterns below. Domain-specific names replace `<resources>` and `<action>`, but input/output shapes `MUST NOT` invent alternate envelope roots.

| Pattern | Standard action | Method | Path | Request | Success body | HTTP | `data` shape |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Retrieve | `retrieve` | `GET` | `/<resources>/{id}` | path id | `SdkWorkApiResponse` | `200` | `SdkWorkResourceData.item` |
| List | `list` | `GET` | `/<resources>` | section 14.1.1 query | `SdkWorkApiResponse` | `200` | `SdkWorkPageData` |
| Search | `search` | `POST` | `/<resources>/search` or `/<resources>:search` | section 14.1.2 body | `SdkWorkApiResponse` | `200` | `SdkWorkPageData` |
| Create | `create` | `POST` | `/<resources>` | create body | `SdkWorkApiResponse` | `201` | `SdkWorkResourceData.item` |
| Replace | `update` | `PUT` | `/<resources>/{id}` | full body | `SdkWorkApiResponse` | `200` | `SdkWorkResourceData.item` |
| Patch | `update` | `PATCH` | `/<resources>/{id}` | partial body | `SdkWorkApiResponse` | `200` | `SdkWorkResourceData.item` |
| Delete | `delete` | `DELETE` | `/<resources>/{id}` | path id only | no JSON body | `204` | header-only `traceId` |
| Command | `<action>` | `POST` | `/<resources>/{id}/<action>`, `/<resources>/{id}:<action>`, or `/<resources>:<action>` | command body | `SdkWorkApiResponse` | `200` | `SdkWorkCommandData` |
| Async command | `<action>` | `POST` | `/<resources>/{id}/<action>`, `/<resources>/{id}:<action>`, or `/<resources>:<action>` | command body | `SdkWorkApiResponse` | `202` | `SdkWorkAsyncData` |
| Bulk command | `bulk<Action>` | `POST` | `/<resources>:bulk<Action>` | bulk body | `SdkWorkApiResponse` | `200` or `202` | `SdkWorkBulkData` or typed bulk result |

Rules:

- Every pattern above `MUST` declare `application/problem+json` error responses using numeric `ProblemDetail.code`.
- Open-api business operations `MUST` use the same input and output patterns as app-api and backend-api per section 4.5.1. Vendor compatibility open-api operations `MAY` opt out only under section 4.5.2.
- List/search patterns `MUST` return `items[]` even when empty.
- Create success `MUST` use HTTP `201`; do not return `200` for newly created resources. Upsert behavior `MUST` be explicit and must not be hidden behind a normal create operation.
- Update success `MUST` use HTTP `200` with `data.item` unless the operation is intentionally modeled as a command without a full resource payload.
- Delete success `MUST` use HTTP `204` and `MUST NOT` return legacy `{ success: true }`, `{ deleted: true }`, `SdkWorkCommandData`, or any JSON success body.
- Command success `MUST` return `data.accepted: true` or a typed command result. Business failures `MUST` use `ProblemDetail`, not `accepted: false` or human text inside HTTP `200`.
- Async command success `MUST` use `202` and `SdkWorkAsyncData`. The returned `operationId` is the asynchronous operation instance id; it is not the OpenAPI `operationId`.
- Bulk operations `MUST` document per-item success/failure semantics inside typed `data`, define max item count, define all-or-nothing versus partial execution, and `MUST NOT` encode partial failure only in human text.
- OpenAPI `operationId` `MUST` follow section 7 and align with the pattern (`list`, `search`, `create`, `retrieve`, `update`, `delete`, `bulk<Action>`, or the stable domain `<action>`). `PUT` and `PATCH` both use the standard SDK action `update`; do not introduce `patch<Resource>` or `replace<Resource>` method aliases unless a governance exception documents why the SDK surface needs two public update verbs.
- `POST` search operations are safe and idempotent. They `MUST NOT` mutate audit-visible domain state except optional search audit records explicitly required by product or compliance.
- Long-running import, export, report generation, AI execution, media processing, or provider synchronization operations `MUST` use async command semantics when they cannot reliably complete within the normal P0/P1 HTTP latency budget.
- Every SDKWork-owned operation `SHOULD` be covered by `node <sdkwork-specs>/tools/check-api-operation-patterns.mjs --workspace <workspace-root>` in addition to the response-envelope and pagination validators when the repository owns or materializes HTTP API contracts.
- The operation-patterns validator enforces the int64-string closure of §13.6: any schema property or operation parameter declared `format: int64` `MUST` be `type: string` with `x-sdkwork-int64-string: true` and a decimal `pattern`. `type: integer, format: int64` fails the check (`int64-integer-type` / `int64-string-marker-missing`), because it makes generated TypeScript SDKs emit `number` and browsers round ids past `Number.MAX_SAFE_INTEGER` (2^53), causing wrong-id lookups such as partner parent resolution failures. Keep Rust/Java/Go/C#/SQL native numeric types on the server; only the HTTP JSON boundary is string-based. Documents declaring `x-sdkwork-int64-openai-compat: true` (OpenAI/Anthropic compatible gateway mirrors, see §13.6) are exempt from the int64-string closure.

## 16. Pagination, Filtering, Sorting, And List Output

List and search operations `MUST` use the input rules in §14.1 and the output rules in this section. This section aligns with Google AIP-158 list pagination, RFC 9457 error semantics, and SDKWork envelope rules in §15. Service, repository, database, SDK, and frontend implementation rules — including the prohibition of in-process pagination — are normative in `PAGINATION_SPEC.md`.

### 16.1 List Output Shape

Every list or search response `MUST` use:

```json
{
  "code": 0,
  "data": {
    "items": [],
    "pageInfo": {}
  },
  "traceId": "..."
}
```

Rules:

- `data.items` `MUST` be an array. Empty results `MUST` return `"items": []`, not `null`.
- `data.pageInfo.mode` `MUST` be `offset` or `cursor`.
- List APIs `MUST` be paginated unless the collection is bounded by design and documented as such per `PAGINATION_SPEC.md` §11.
- Declaring `page_size`, `cursor`, or `page` in OpenAPI while implementing list results by loading an unbounded in-memory collection and slicing with `skip`/`take`/`slice` is a contract violation and `MUST NOT` ship on new L2+ endpoints.
- OpenAPI query parameters named `pageSize`, `limit`, `page_no`, `pageNo`, `per_page`, `size`, or equivalent pagination aliases are contract violations for SDKWork-owned business APIs unless the operation is an already-launched L0/L1 migration case with explicit removal evidence.

### 16.2 Offset Pagination

Input:

| Input | Required | Notes |
| --- | --- | --- |
| `page` | yes | Default `1` |
| `page_size` | no | Default `20`, max `200` |
| `sort`, `q`, filters | no | See §14.1.1 |

Output `pageInfo` when `mode = offset`:

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `mode` | yes | string | `offset` |
| `page` | yes | integer | Current page, starting at `1` |
| `pageSize` | yes | integer | Effective page size |
| `totalItems` | yes | int64-string | Total rows matching the filter |
| `totalPages` | yes | integer | `ceil(totalItems / pageSize)` |
| `hasMore` | no | boolean | Optional convenience mirror of `page < totalPages` |

Example request/response:

```http
GET /app/v3/api/forum/topics?page=2&page_size=20&sort=-createdAt&q=release
```

```json
{
  "code": 0,
  "data": {
    "items": [
      { "id": "12884901888", "title": "Release notes" }
    ],
    "pageInfo": {
      "mode": "offset",
      "page": 2,
      "pageSize": 20,
      "totalItems": "125",
      "totalPages": 7,
      "hasMore": true
    }
  },
  "traceId": "0195f2a0-7c44-7b2e-9f3a-2a6f5d8e91ab"
}
```

Rules:

- Offset pagination `SHOULD` be used for admin tables and stable, low-volume lists.
- Servers `MUST` reject `page_size` above `200` with `40003 INVALID_PARAMETER` unless the operation declares a valid exception under section 14.1.1; excepted operations `MUST` reject values above their declared `maximumPageSize` with the same error.

### 16.3 Cursor Pagination

Input:

| Input | Required | Notes |
| --- | --- | --- |
| `cursor` | no | Omit on first page |
| `page_size` | no | Default `20`, max `200` |
| `sort`, `q`, filters | no | Sort `SHOULD` remain stable across pages |

Output `pageInfo` when `mode = cursor`:

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `mode` | yes | string | `cursor` |
| `pageSize` | yes | integer | Effective page size |
| `hasMore` | yes | boolean | Whether another page exists |
| `nextCursor` | when `hasMore=true` | string or null | Opaque token for the next request |
| `totalItems` | no | int64-string | Optional estimated or exact total when cheap to compute |

Example request/response:

```http
GET /app/v3/api/messaging/conversations?cursor=eyJwIjo2fQ&page_size=50
```

```json
{
  "code": 0,
  "data": {
    "items": [
      { "id": "12884901901", "title": "Project chat" }
    ],
    "pageInfo": {
      "mode": "cursor",
      "pageSize": 50,
      "hasMore": true,
      "nextCursor": "eyJwIjo3fQ"
    }
  },
  "traceId": "0195f2a0-7c44-7b2e-9f3a-2a6f5d8e91ab"
}
```

Rules:

- Cursor tokens `MUST` be opaque to clients. Clients `MUST NOT` parse or construct cursor payloads.
- Cursor pagination `SHOULD` be used for high-volume feeds, logs, messages, and unstable lists.
- When `hasMore` is `false`, `nextCursor` `MUST` be `null` or omitted consistently within the API authority.

### 16.4 Filtering And Search Semantics

| Mechanism | Wire input | Response impact |
| --- | --- | --- |
| Free-text search | `q` | Server applies domain search across configured fields |
| Time range | `created_after`, `created_before`, `updated_after`, `updated_before` | Filters inclusive/exclusive bounds per §14.1.1 |
| Explicit ids | `ids` | Restrict result set to listed ids; unknown ids are omitted unless documented otherwise |
| Domain enum filter | typed params such as `status`, `role_id` | Exact-match or documented multi-value semantics |

Rules:

- Generic search `MUST` use `q` only. Duplicate aliases are forbidden.
- Multi-value enum filters `SHOULD` use repeated query params or comma-separated wire values documented in OpenAPI.
- Filter parameters `MUST` be typed in OpenAPI with `enum`, `pattern`, or bounds; do not accept arbitrary strings where enums exist.
- Search/list operations `MUST NOT` expose SQL, GraphQL, or generic expression languages in public L2 APIs.

### 16.5 Sorting Semantics

Rules:

- Default sort order `MUST` be documented per list operation.
- Sortable fields `MUST` be API field names, not database column names.
- Maximum sort field count is `3`.
- Unsupported sort fields `MUST` produce `40003 INVALID_PARAMETER`.
- Stable sorts `SHOULD` include a unique tie-breaker such as `id` or `createdAt`.

Example:

```text
sort=-createdAt,id
```

### 16.6 Shared Schema Reference

Standard page query parameters:

| Parameter | Type | Meaning |
| --- | --- | --- |
| `page` | integer, default `1` | One-based page index |
| `page_size` | integer, default `20`, max `200` | Page size |
| `cursor` | string | Cursor for cursor pagination |
| `sort` | string | Comma-separated sort fields, `-createdAt` for descending |
| `q` | string | Search keyword |

Query parameter names in the OpenAPI contract are wire names. Generated SDKs,
service methods, or controller variables may expose language-idiomatic aliases,
but those aliases `MUST NOT` feed back into the OpenAPI parameter name.

Standard page payload inside `SdkWorkApiResponse.data`:

```yaml
SdkWorkPageData:
  type: object
  additionalProperties: false
  required: [items, pageInfo]
  properties:
    items:
      type: array
      items:
        $ref: "#/components/schemas/IamUser"
    pageInfo:
      $ref: "#/components/schemas/PageInfo"
```

Standard `PageInfo`:

```yaml
PageInfo:
  type: object
  additionalProperties: false
  required: [mode]
  properties:
    mode:
      type: string
      enum: [offset, cursor]
    page:
      type: integer
      minimum: 1
    pageSize:
      type: integer
      minimum: 1
      maximum: 200
    totalItems:
      type: string
      format: int64
      pattern: "^[0-9]+$"
      x-sdkwork-int64-string: true
    totalPages:
      type: integer
      minimum: 0
    nextCursor:
      type: [string, "null"]
    hasMore:
      type: boolean
```

Rules:

- List APIs `MUST` return `SdkWorkApiResponse` whose `data` follows `SdkWorkPageData`.
- When `pageInfo.mode` is `offset`, `page`, `pageSize`, `totalItems`, and `totalPages` `MUST` be present.
- When `pageInfo.mode` is `cursor`, `pageSize`, `hasMore`, and `nextCursor` (when `hasMore=true`) `MUST` be present.
- List APIs `MUST` be paginated unless the collection is bounded by design.
- Sort fields `MUST` use API field names, not database column names.
- Query parameter names `MUST` use lowercase URL names because they are part of the URL contract.
- Multi-word query parameter names `MUST` use `lower_snake_case`, such as `page_size`, `created_after`, and `organization_id`.
- Single-word query parameter names `MUST` stay lowercase without an underscore, such as `q`, `page`, `sort`, `cursor`, and `status`.
- `pageSize` `MUST NOT` appear as an OpenAPI query parameter name. It is allowed only as the JSON body equivalent of `page_size` and as `PageInfo.pageSize` in response payloads.
- `limit` `MUST NOT` be used as a list/search page-size alias in SDKWork-owned business APIs. Use `page_size` for HTTP GET and `pageSize` inside `SdkWorkListQuery` request bodies.
- The standard free-text search parameter is `q`. OpenAPI URL query parameters and generated SDK query parameters `MUST NOT` use `keyword`, `search`, `searchQuery`, or `search_query` for generic search.
- A list operation `MUST NOT` expose multiple names such as `q`, `keyword`, `search`, `searchQuery`, or `search_query` for the same free-text search meaning. Use `q` for generic keyword search; reserve explicit multi-word filters for distinct domain concepts. SDK or implementation variables may use language-idiomatic names such as `searchQuery`, but those names must map to the wire parameter `q`.
- Filtering parameters `SHOULD` be explicit instead of a free-form SQL-like expression.
- Cursor pagination `SHOULD` be used for high-volume or unstable lists.
- Shared OpenAPI list query parameters `SHOULD` `$ref` `templates/openapi/components/parameters/query-parameters.yaml`.

### 16.7 Implementation Alignment

HTTP contract rules in §14.1 and §16 define the wire surface only. Implementations `MUST` also satisfy `PAGINATION_SPEC.md`:

- repository and service layers `MUST` bound reads to `page_size` at the store or maintained index;
- handlers `MUST` reject forbidden pagination aliases before invoking service or repository code;
- handlers `MUST NOT` materialize unbounded collections and slice them in process;
- SDK and frontend consumers `MUST NOT` substitute client-side `slice` or `listAll*` aggregation for server pagination on interactive lists.

## 17. Idempotency And Concurrency

Rules:

- Retriable create and payment-like commands `MUST` support `Idempotency-Key`.
- `Idempotency-Key` values are scoped by tenant, principal, method, and path.
- `x-sdkwork-idempotent: true` and a required `Idempotency-Key` OpenAPI header parameter are a strict pair: either both are present on the effective operation or both are absent. A shared local header `$ref` is allowed.
- The canonical `Idempotency-Key` parameter `MUST` be a required header with a string schema, `minLength: 1`, and `maxLength: 128`. API materialization and contract checks `MUST` reject marker/header mismatches, optional declarations, non-canonical header spelling, and unbounded schemas.
- Route manifests, runtime route metadata, derived generator inputs, and generated SDK method surfaces `MUST` preserve the same idempotency requirement as the authority OpenAPI operation. Materializers `MUST NOT` infer idempotency from an operationId substring or HTTP method.
- Clients `MUST` create one unpredictable idempotency key per logical user or job command, retain that key across transport retries and ambiguous outcomes, and create a new key only for a new logical command. Retry layers `MUST NOT` generate a new key per attempt.
- A replay with the same idempotency key and the same request fingerprint `SHOULD` return the original success result or current operation status without executing side effects again.
- A replay with the same idempotency key and a different request fingerprint `MUST` return `40901 CONFLICT`.
- Non-idempotent commands `MUST` either reject duplicate client submission through domain state checks or document why retries are unsafe.
- `traceId` is server-owned request correlation identity, not an idempotency key and not a browser/client-generated field.
- App/backend HTTP runtimes `MUST` generate a canonical UUID `traceId` for each request that records request correlation.
- App and backend OpenAPI contracts MUST NOT declare `X-Request-Id`, wire field `requestId`, or generated `xRequestId` parameters.
- Browser, frontend, app SDK, and backend-admin SDK consumers `MUST NOT` send `X-Request-Id`, client-generated `traceId`, or wire field `requestId`.
- If an edge gateway or trusted upstream component needs to preserve its own correlation id, it must use a domain-specific upstream correlation field and must not override the SDKWork server `traceId`.
- Request body schemas for new create/update/command operations `MUST NOT` require a client-filled `traceId` or `requestId` for SDKWork request correlation.
- Success and error responses MUST expose `traceId` when the API contract exposes request correlation, including `SdkWorkApiResponse`, problem details, audit records, runtime records, usage logs, and asynchronous command responses.
- Resource updates `SHOULD` support optimistic concurrency with `version`, `If-Match`, or equivalent domain versioning.
- Operations that require optimistic concurrency `MUST` document the version source (`version`, `etag`, or domain revision), declare `If-Match` when header preconditions are used, and map missing required preconditions to `42801 PRECONDITION_REQUIRED`.
- Failed `If-Match`, ETag, or version preconditions `MUST` return `41201 PRECONDITION_FAILED`; domain state conflicts that are not direct precondition failures `MUST` return `40901 CONFLICT` or a registered `60000`-range domain code.
- Duplicate idempotency keys with different payloads `MUST` return `409`.
- Runtimes `MUST` reject empty or oversized idempotency keys before store lookup, `MUST NOT` log raw keys, and `MUST` use a distributed durable idempotency store for production high-availability deployments.
- Idempotency records `SHOULD` follow database rules in `DATABASE_SPEC.md`.

## 18. Multi-Tenant And Authorization Semantics

Rules:

- Tenant and organization context `MUST` come from token context or validated route context.
- Login-created token context `MUST` come from real IAM user tenant binding and organization membership lookup. API implementations `MUST NOT` use demo tenants, mock users, email-normalized ids, request headers, or request payload tenant fields as authenticated context.
- Authorization `MUST` be checked in service/business logic, not only in UI.
- Frontend permission checks are user experience hints, not security boundaries.
- RBAC is the baseline: users, roles, permissions, role-permissions, user-roles.
- ABAC conditions `SHOULD` be supported for tenant, organization, owner, data scope, environment, resource state, and time-based restrictions.
- Permission codes `MUST` be stable strings, for example `iam.users.read`, `iam.roles.write`, `billing.invoices.read`.
- APIs `MUST` define the required permission or public status using OpenAPI extensions.

Recommended extensions:

```yaml
x-sdkwork-permission: iam.users.read
x-sdkwork-tenant-scope: tenant
x-sdkwork-data-scope: organization
x-sdkwork-audit-event: iam.user.read
```

## 19. Standard OpenAPI Extensions

SDKWork governance tools may read these extensions.

| Extension | Meaning |
| --- | --- |
| `x-sdkwork-request-context` | Typed handler context; value `WebRequestContext` for every HTTP operation |
| `x-sdkwork-api-surface` | Runtime surface classification: `open-api`, `app-api`, or `backend-api` |
| `x-sdkwork-rate-limit-tier` | Framework rate-limit tier for abuse-sensitive operations |
| `x-sdkwork-domain` | Bounded context such as `iam`, `billing`, `ai` |
| `x-sdkwork-resource` | Canonical resource name |
| `x-sdkwork-permission` | Required permission code |
| `x-sdkwork-public` | Explicit public operation marker |
| `x-sdkwork-tenant-scope` | `platform`, `tenant`, `organization`, `user`, `owner` |
| `x-sdkwork-data-scope` | Data visibility scope |
| `x-sdkwork-audit-event` | Audit event type |
| `x-sdkwork-idempotent` | Whether idempotency is required |
| `x-sdkwork-auth-mode` | Canonical operation credential profile: `anonymous`, `credential-entry-bootstrap`, `refresh-token`, `dual-token`, `api-key`, `oauth`, `open-api-flexible`, `api-key-or-dual-token`, `ingress-token`, `agent-token`, or `compatibility` |
| `x-sdkwork-forbid-credential-headers` | Strict contamination guard: reject every credential/context header outside the allowlist defined by `x-sdkwork-auth-mode` |
| `x-sdkwork-sdk-resource` | SDK nested resource override if path inference is insufficient |
| `x-sdkwork-deployment-profile` | `standalone`, `cloud`, or `all` |
| `x-sdkwork-runtime-target` | Optional runtime target qualifier when an operation is intentionally runtime-target-specific. Shared app/backend/open APIs should normally omit it. |
| `x-sdkwork-owner` | Owning application, repository, or reusable platform module that publishes this operation in its own SDK family |
| `x-sdkwork-api-authority` | Canonical API authority that owns the operation, for example `sdkwork-iam-app-api`, `sdkwork-im-app-api`, or `sdkwork-drive-backend-api` |
| `x-sdkwork-source` | Physical source or scanned module that produced the operation |
| `x-sdkwork-source-route-crate` | Rust route crate package name when the operation was materialized from `sdkwork.route.manifest` |
| `x-sdkwork-integration-source` | Integrated dependency source when an operation is present only for runtime composition or compatibility |
| `x-sdkwork-wire-protocol` | Wire contract profile: omitted or `sdkwork-v3` means SDKWork-owned custom API; `external` means operation-level vendor compatibility API exempt from section 14 and section 15 only when paired with `x-sdkwork-external-protocol-id` |
| `x-sdkwork-external-protocol-id` | Stable lowercase kebab-case upstream protocol identifier required on the same operation when `x-sdkwork-wire-protocol: external`, for example `openai-v1`, `anthropic-messages`, `google-gemini-v1beta`, `claude-code`, or `codex` |

Rules:

- Extensions `MUST NOT` contradict security requirements.
- Extensions are governance metadata; behavior still needs server enforcement.
- Every HTTP operation `MUST` declare `x-sdkwork-request-context: WebRequestContext` and `x-sdkwork-api-surface`. Missing either extension makes the contract non-compliant for SDKWork HTTP APIs.
- `x-sdkwork-api-surface` values `MUST` use canonical kebab-case contract labels: `open-api`, `app-api`, `backend-api`, or another approved `*-api` surface label. CamelCase runtime labels such as `openApi`, `appApi`, `backendApi`, and `gatewayApi` are invalid in OpenAPI and derived `*.sdkgen.*` inputs.
- Abuse-sensitive operations `MUST` declare `x-sdkwork-rate-limit-tier` and the runtime framework `MUST` enforce the matching policy. Mandatory-sensitive operations include login, registration, OAuth session creation, QR auth session creation or completion, verification code send/check, password reset request/completion, token refresh, API key creation/rotation/revocation, credential binding, and high-risk commands or mutation hot paths. Low-risk read/list operations `MAY` omit the extension only when the owning API threat model does not require throttling.
- Public operations that are generated into SDKs and must not receive stored credentials `MUST` declare `security: []` and `x-sdkwork-auth-mode: anonymous`. TypeScript, Flutter, and other generated SDKs `MUST` use that marker to skip automatic credential injection for that operation.
- Login, registration, OAuth session creation, QR auth session creation or password completion, password reset request, password reset completion, and equivalent pre-session credential-entry commands `MUST` declare `security: [{ AccessToken: [] }]`, `x-sdkwork-auth-mode: credential-entry-bootstrap`, and `x-sdkwork-forbid-credential-headers: true`, unless the owning IAM authority explicitly classifies an operation as pure anonymous or refresh-token proof. Runtime gateways enforce the derived allowlist before handler logic.
- `x-sdkwork-auth-mode`, OpenAPI `security`, route-manifest `auth.mode`, generated SDK call options, and runtime `RouteAuth` `MUST` represent the same profile. Validators `MUST` reject contradictions instead of choosing one source implicitly.
- `security: []` alone does not imply `x-sdkwork-forbid-credential-headers: true`; public metadata and bootstrap endpoints may be anonymous without rejecting irrelevant credentials unless their contract explicitly sets the extension.
- Every operation used as input to HTTP SDK generation `MUST` declare `x-sdkwork-owner` and `x-sdkwork-api-authority`.
- `x-sdkwork-owner` is the SDK generation ownership key. It identifies the app/repo/module that is allowed to generate the operation into its SDK family.
- `x-sdkwork-api-authority` identifies the canonical API authority and `MUST` use the lower-kebab `sdkwork-<domain>-<surface>` identity, for example `sdkwork-iam-app-api`, `sdkwork-iam-backend-api`, `sdkwork-im-app-api`, or `sdkwork-drive-backend-api`. Dotted authority aliases are invalid.
- `x-sdkwork-source` and `x-sdkwork-integration-source` may describe where the operation was scanned from, but they `MUST NOT` replace `x-sdkwork-owner` for generation decisions.
- SDKWork-owned custom operations on open-api, app-api, and backend-api `MUST` omit `x-sdkwork-wire-protocol` or declare `x-sdkwork-wire-protocol: sdkwork-v3`; omitted is the default and means `sdkwork-v3`.
- Vendor compatibility operations `MUST` declare operation-level `x-sdkwork-wire-protocol: external` and `x-sdkwork-external-protocol-id` per section 4.5.2. A document-level external marker, path prefix, tag, SDK family, or auth mode is not enough to opt out.
- OpenAPI documents may temporarily include dependency-owned operations for runtime integration inspection only when those operations are clearly marked with the dependency owner. The generated SDK input for an app/repo `MUST` filter them out unless the current SDK family owner matches the operation owner.
- Path prefix, tag, Rust crate name, Java controller package, or filesystem location `MUST NOT` be the only authority for SDK ownership. Those signals may help infer metadata during migration, but the materialized OpenAPI operation must carry explicit ownership before generation.

## 20. SDK Generation Standard

Rules:

- Generated SDKs are the only approved API transport for frontend business modules.
- HTTP SDKs `MUST` be generated by the canonical SDKWork generator at `..\sdkwork-sdk-generator` (`@sdkwork/sdk-generator` / `sdkgen`). Do not use `sdkwork-code-generator`, copied generator code, local stubs, generic OpenAPI generators, or application-local generator aliases for committed SDK output unless the alias is a documented wrapper that invokes the canonical generator.
- SDK family semantics, SDK package naming, generated client behavior, auth integration, and frontend service boundaries `MUST` follow `SDK_SPEC.md`.
- Application-root `sdks/` workspace layout, authority OpenAPI files, derived `sdkgen` files, backend OpenAPI SDK generation, and generated-output placement `MUST` follow `SDK_WORKSPACE_GENERATION_SPEC.md`.
- Do not use raw `fetch`, `axios`, manual auth headers, local SDK forks, or handwritten DTO shims to bypass missing SDK capabilities.
- If a capability is missing, update OpenAPI and regenerate SDKs.
- TypeScript SDKs for new SDKWork v3 open-api, app-api, and backend-api contracts `MUST` use `--standard-profile sdkwork-v3`.
- Resource-style operationIds `MUST` produce nested SDK resources.
- App-specific SDK clients may differ by package and constructor, but method shape `MUST` remain consistent.
- SDK generation inputs `MUST` contain only operations whose `x-sdkwork-owner` matches the owner declared in the family-root `sdk-manifest.json`.
- Dependency-owned operations such as appbase IAM must be consumed through the dependency SDK or approved composed wrapper, not regenerated into the consuming app SDK.
- SDK generation inputs `MUST NOT` contain current-tenant selector parameters or client-writable request fields named `tenant_id` or `tenantId`. If such a field appears only because the operation is trying to scope the caller's tenant, fix the API contract to use token/API-key context before generation.

### 20.1 SDK Resource Synthesis Rules

The OpenAPI contract `MUST` be shaped so that the generated SDK is predictable and modular.

| OpenAPI element | SDK effect |
| --- | --- |
| `tag` | Top-level SDK namespace such as `client.auth`, `client.iam` |
| Dotted `operationId` resource segments | Nested SDK resource objects such as `client.auth.sessions` or `client.iam.organizations.members` |
| Final `operationId` action segment | Method name such as `create`, `retrieve`, `update`, `delete`, `list`, `verify`, `refresh`, `revoke` |
| Path parameters | Required method arguments in order of appearance, before body and query objects when possible |
| Request body schema | Typed `body` or domain-specific body argument |
| Query parameters | Typed `params` object or explicit scalar arguments when the SDK generator needs stronger ergonomics |
| Security scheme requirements | Client auth header injection and request preflight behavior |
| `application/problem+json` errors | Error class mapping and typed rejection behavior |
| Pagination schema | SDK list helper return types and page cursor helpers |

Rules:

- Resource segments in `operationId` `SHOULD` map to nested SDK classes or nested service namespaces.
- Action segments in `operationId` `MUST` map to verbs with stable ergonomic meaning.
- A collection resource `MUST` produce a collection SDK object; a singleton resource `MUST` produce a singleton SDK object.
- If the URL is deeper than the SDK surface should expose, the SDK may flatten only when a documented generator rule explicitly says so. The default is nested resources.
- The SDK surface `SHOULD` read like a business capability tree, not a transport layer.
- Generated SDK examples in docs and tests `MUST` use the same method shape that the contract intends for production use.

### 20.2 SDK Construction And Injection

Rules:

- SDK clients `MUST` be injectable into frontend services and runtime adapters.
- Client construction differences across environments, deployment profiles, and
  runtime targets `MUST` be isolated in bootstrap code.
- A single app may use different app SDK and backend SDK constructors, but the service layer `MUST` hide that difference from UI components.
- All package-level facades and adapters `SHOULD` expose stable domain services such as `auth`, `iam`, `billing`, or `content` instead of exposing raw generated client internals.

Example:

```ts
const service = createIamService({
  appClient,
  backendClient,
});

await service.auth.sessions.create(body);
await service.iam.organizations.members.create(organizationId, body);
```

## 21. Frontend Integration Standard

Frontend shared modules use three layers.

| Layer | Responsibility | Forbidden |
| --- | --- | --- |
| UI | Render, forms, interaction, accessibility, local state | Raw HTTP, token parsing, tenant decisions |
| Service | Business orchestration, validation mapping, SDK client injection, cache boundary | Manual request URLs, manual auth headers |
| SDK | Generated API methods, typed DTOs, transport | App-specific UI logic |

Rules:

- Shared modules `MUST` accept SDK clients through initialization or provider composition.
- App-specific SDK constructor differences `MUST` be isolated in bootstrap code.
- Services `SHOULD` depend on interfaces that match generated SDK resource surfaces.
- UI packages `MUST` not import generated SDK internals directly when a service package exists.
- Environment, deployment profile, and runtime target switching is handled by
  SDK client initialization: development, test, staging, demo, production,
  standalone, cloud, browser, desktop, server, container, and other approved
  runtime targets.

## 22. Standalone And Cloud Deployment Parity

Rules:

- Standalone and cloud backends `MUST` share the same API contract for common modules.
- Differences in storage, token issuer, or process boundary `MUST NOT` change API paths or schemas.
- Runtime-target-specific native features may have local APIs, but common IAM,
  tenant, organization, user, role, permission, session, and security APIs must
  remain contract-compatible.
- SDK tests `SHOULD` be run against both standalone and cloud implementations.

## 23. Versioning And Deprecation

Rules:

- API version is carried in the path prefix. App-api uses `/app/v3/api`, backend-api uses `/backend/v3/api`, and open-api uses the approved versioned prefix for that domain, for example `/im/v3/api`.
- Additive fields are allowed when clients can ignore unknown fields.
- Removing fields, changing field types, changing operationId, changing security, changing path, or changing response status semantics is breaking.
- Breaking changes require a new version or explicit no-compatibility approval for pre-launch systems.
- Deprecated operations `SHOULD` include OpenAPI `deprecated: true` and `x-sdkwork-deprecation`.
- Do not introduce `/app/v1`, `/backend/v1`, or v1/v2 open-api prefixes for new work in this repository.

## 24. Contract Validation Checklist

An API is standard only when this checklist passes:

- [ ] OpenAPI version is `3.1.2` or a documented `3.1.x` toolchain fallback.
- [ ] API contract sources, examples, changelogs, and validation fixtures are placed under the standard `apis/` directory when the repository/application authors API contracts.
- [ ] HTTP API contracts authored under `apis/` use the surface/domain shape such as `apis/app-api/<domain>/openapi.yaml`, with `routes/`, `schemas/`, `examples/`, `changelogs/`, and `tests/` used only for contract and materialization inputs.
- [ ] `apis/` does not contain generated SDK transport output, SDK family directories, generated SDK control-plane `.sdkwork/` files, or runnable controller/handler/service/repository implementation code.
- [ ] Domain name follows `DOMAIN_SPEC.md`.
- [ ] SDK API paths use the approved prefix for their API surface: `/app/v3/api` for app-api, `/backend/v3/api` for backend-api, and an approved versioned non-app/non-backend prefix such as `/im/v3/api` for open-api.
- [ ] Common URL paths do not collide: `/healthz`, `/readyz`, `/livez`, and `/metrics` are infrastructure probes from `HEALTH_CHECK_SPEC.md`; `/app/v3/api/system/health`, `/app/v3/api/system/ready`, `/backend/v3/api/system/health`, and `/backend/v3/api/system/ready` are reserved business system health paths; feature modules use capability-specific paths.
- [ ] Runtime source, OpenAPI snapshots, generated SDK inputs, route tables, frontend SDK bootstrap code, and environment examples contain no forbidden legacy API prefix.
- [ ] Rust HTTP route crates, when present, are named `sdkwork-routes-<capability>-open-api`, `sdkwork-routes-<capability>-app-api`, or `sdkwork-routes-<capability>-backend-api`.
- [ ] Rust route crate names, declared surfaces, and mounted path prefixes agree.
- [ ] Route manifests, when present, use `kind: sdkwork.route.manifest`, validate package name, capability, surface, owner, domain, API authority, SDK family, prefix, `requestContext: WebRequestContext`, `apiSurface`, auth mode, ownership, and duplicate route rules.
- [ ] Route crate manifests, when present, aggregate into `sdkwork-<domain>-open-api`, `sdkwork-<domain>-app-api`, or `sdkwork-<domain>-backend-api`; route crate names are not used as final OpenAPI authority names.
- [ ] Route manifest materialization writes `x-sdkwork-owner`, `x-sdkwork-api-authority`, `x-sdkwork-source`, `x-sdkwork-source-route-crate`, `x-sdkwork-request-context`, `x-sdkwork-api-surface`, and `x-sdkwork-rate-limit-tier` when present into authority OpenAPI operations.
- [ ] Every SDK-generated operation declares `x-sdkwork-owner` and `x-sdkwork-api-authority`.
- [ ] No SDK generation input contains operations owned by another app/repo/module.
- [ ] Integrated dependency APIs are declared as SDK dependencies or composed wrappers instead of duplicated into the current SDK.
- [ ] No SDK-generated operation exposes `tenant_id` or `tenantId` as a current-tenant path, query, header, cookie, method, `params`, or client-writable body input.
- [ ] Web backend implementation layers, naming, request context consumption, repository boundaries, provider adapters, and static boundary scans follow `WEB_BACKEND_SPEC.md`.
- [ ] HTTP runtimes and modules for open-api, app-api, backend-api, or any SDKWork HTTP `*-api` surface follow `WEB_FRAMEWORK_SPEC.md`; Rust runtimes integrate `sdkwork-web-framework`.
- [ ] Every HTTP operation declares `x-sdkwork-request-context: WebRequestContext` and `x-sdkwork-api-surface`.
- [ ] Java app-api class-level mappings start with `/app/v3/api`, and Java backend-api class-level mappings start with `/backend/v3/api`.
- [ ] Backend-api publishes no bare `/v3/api/*` resource path.
- [ ] `apps` Java implementations, app/backend Java SDK generation inputs, and generated app/backend Java SDK path helpers pass `cd apps && node scripts/api-spec-java-standard.test.mjs`.
- [ ] Path static segments are lowercase `lower_snake_case`.
- [ ] Path parameters are `lowerCamelCase`.
- [ ] Each operation has one lowerCamelCase tag.
- [ ] Each operationId uses lowerCamelCase dotted resource style.
- [ ] No operationId contains `__`.
- [ ] Public operations explicitly set `security: []`.
- [ ] Public SDK-generated operations that must not send stored credentials set `x-sdkwork-auth-mode: anonymous`.
- [ ] Credential-entry operations require only `AccessToken`, set `x-sdkwork-auth-mode: credential-entry-bootstrap` and `x-sdkwork-forbid-credential-headers: true`, and runtime code rejects every non-profile credential/context header.
- [ ] Protected app-api and backend-api operations require both `AuthToken` and `AccessToken`.
- [ ] Protected open-api operations require the exact security vector declared by `auth.mode`: `ApiKey`, `OAuthBearer`, either API-key/OAuth alternative, or either API-key/combined-dual-token alternative.
- [ ] Auth/session creation operations do not use inbound tokens or context headers to choose tenant, organization, or user.
- [ ] Dual-token protected operations validate matching tenant, organization, login scope, user, session, app, and token type claims.
- [ ] Token validation uses tenant-bound signing keys or an equivalent server-side tenant-bound token lookup.
- [ ] Multi-organization login uses a documented continuation response instead of returning normal business tokens before organization selection.
- [ ] Runtime routers resolve `WebRequestContext` through `sdkwork-web-framework` (Rust) or an equivalent typed context framework (Java) before protected handlers run.
- [ ] Handlers consume typed `WebRequestContext` and do not reparse credential, tenant, user, permission, request-id, locale, or language headers.
- [ ] Runtime routers run the standard API call chain or a stricter documented superset.
- [ ] Backend API has no login/session creation/refresh/logout endpoint.
- [ ] Error responses include `application/problem+json` with numeric `ProblemDetail.code` from §15.3.
- [ ] SDKWork-owned error responses preserve numeric `ProblemDetail.code` and may include `i18nKey`/`locale` metadata per `I18N_SPEC.md`; localized text is not used as machine state.
- [ ] SDKWork-owned operations follow the section 15.4 operation matrix: create `201`, update/retrieve/list/search `200`, delete `204` without JSON body, async `202`, and typed bulk results.
- [ ] Success list/search responses use `SdkWorkApiResponse` + `SdkWorkPageData`; inputs follow §14.1 and §16.
- [ ] List/search operations use standard query parameters or `SdkWorkListQuery` bodies; generic search uses `q` only.
- [ ] `int64` and `decimal` API fields are strings.
- [ ] Request and response schemas use `additionalProperties` intentionally.
- [ ] List APIs are paginated or explicitly bounded.
- [ ] Retriable create/command APIs define idempotency behavior.
- [ ] `node <sdkwork-specs>/tools/check-api-operation-patterns.mjs --workspace <root>` passes for touched repositories that own or materialize OpenAPI authorities.
- [ ] `node <sdkwork-specs>/tools/check-route-path-collisions.mjs --workspace <root>` passes for touched repositories that own route manifests or OpenAPI authorities.
- [ ] Required permission, tenant scope, and audit metadata are documented.
- [ ] Generated SDK compiles and exposes resource-style methods.
- [ ] SDK generation uses `@sdkwork/sdk-generator` / `sdkgen` from `..\sdkwork-sdk-generator`, and the generation manifest records the generator package, canonical path or resolved package location, version or commit, command, input, output, language, SDK type, and standard profile.
- [ ] SDK family naming, generated package metadata, generated client behavior, auth integration, and service integration follow `SDK_SPEC.md`.
- [ ] OpenAPI authority location, derived generator inputs, application-root `sdks/` layout, and generated output placement follow `SDK_WORKSPACE_GENERATION_SPEC.md`.

## 25. References

This standard aligns with:

- OpenAPI Specification 3.1.2 stable profile: https://spec.openapis.org/oas/v3.1.2.html
- OpenAPI Specification 3.2.0 forward-looking profile: https://spec.openapis.org/oas/v3.2.0.html
- JSON Schema Draft 2020-12: https://json-schema.org/draft/2020-12
- RFC 9457 Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
- Google API Improvement Proposals list pagination (AIP-158): https://google.aip.dev/158
- Google API Improvement Proposals field masks (AIP-161): https://google.aip.dev/161
- JSON:API sparse fieldsets and filtering concepts: https://jsonapi.org/format/
- OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
