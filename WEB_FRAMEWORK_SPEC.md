# SDKWork Web Framework Integration Standard

- Version: 1.0
- Scope: mandatory integration of `sdkwork-web-framework` for every SDKWork HTTP `*-api` runtime surface, including `open-api`, `app-api`, `backend-api`, Rust route crates, application standalone gateways, platform cloud gateways, migration-only API servers, and Java Spring parallel runtime semantics
- Related: `COMPOSABLE_ARCHITECTURE_SPEC.md`, `API_SPEC.md`, `APPLICATION_GATEWAY_SPEC.md`, `WEB_BACKEND_SPEC.md`, `I18N_SPEC.md`, `SECURITY_SPEC.md` section 5.1, `RUST_CODE_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `TEST_SPEC.md`, `COMPONENT_SPEC.md`, `APPLICATION_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `OBSERVABILITY_SPEC.md`, `MIGRATION_SPEC.md`
- Detail standard: `../sdkwork-web-framework/specs/WEB_FRAMEWORK_STANDARD.md` (L1 framework repository authoritative for crate APIs, pipeline stages, extension traits, and capability matrix)

This standard defines when and how SDKWork applications **must** integrate the `sdkwork-web-framework` repository. `API_SPEC.md` owns HTTP contract semantics. `I18N_SPEC.md` owns cross-stack internationalization semantics. This file owns **runtime framework integration**, including request context, locale context, interceptor behavior, and centralized response mapping. `WEB_BACKEND_SPEC.md` owns handler/service/repository layering after the framework boundary. Cross-stack runtime entrypoint and dependency surface composition follows `COMPOSABLE_ARCHITECTURE_SPEC.md`.

## 1. System Model

```text
sdkwork-specs (L0)
  API_SPEC.md section 10, SECURITY_SPEC.md section 5.1
       -> narrows
sdkwork-specs/WEB_FRAMEWORK_SPEC.md (L0 integration mandate)
       -> narrows
sdkwork-web-framework/specs/WEB_FRAMEWORK_STANDARD.md (L1 executable profile)
       -> enforced by
sdkwork-web-framework crates (L2 runtime)
       -> extended by
business repositories: sdkwork-routes-* + API assemblies + application standalone gateways + appbase/application-line adapters (L3)
```

Rules:

- The canonical SDKWork HTTP application framework repository is
  `sdkwork-web-framework`.
- Any SDKWork application repository, application module, route crate, migration-only API server, backend service, gateway, or reusable component that owns, serves, develops, proxies, or composes an SDKWork HTTP `*-api` surface `MUST` follow this standard.
- SDKWork HTTP `*-api` includes `open-api`, `app-api`, `backend-api`, and any package, crate, module, service, gateway, or authority whose name ends with `-api` and exposes HTTP routes.
- Business repositories with Rust HTTP APIs `MUST` depend on `sdkwork-web-framework` crates; they `MUST NOT` fork, copy, or reimplement the standard interceptor chain, request-context resolution, route manifest contract metadata, or secure defaults locally.
- `sdkwork-web-framework` `MUST NOT` depend on any business repository, business route crate, application-owned OpenAPI authority, or application-owned SDK family.
- Java Spring HTTP backends do not cargo-depend on the Rust framework, but they `MUST` preserve equivalent `WebRequestContext` vocabulary, standard interceptor semantics, route manifest/OpenAPI metadata, and `application/problem+json` behavior defined by `API_SPEC.md` section 10 and `SECURITY_SPEC.md` section 5.1.

## 2. Mandatory Scope

The following artifacts `MUST` integrate `sdkwork-web-framework` or its language-equivalent profile:

| Artifact | Requirement |
| --- | --- |
| `sdkwork-routes-<capability>-open-api` | Framework router mounting, route manifest framework metadata, and `WebRequestContext` injection |
| `sdkwork-routes-<capability>-app-api` | Same |
| `sdkwork-routes-<capability>-backend-api` | Same |
| `sdkwork-<application-code>-api-server` | Migration-only framework bootstrap and route mounting until retired listener crates move to `sdkwork-api-<application-code>-standalone-gateway` |
| `sdkwork-api-<application-code>-assembly` | Host-neutral composition of application-owned HTTP `*-api` surfaces |
| `sdkwork-api-<application-code>-standalone-gateway` | Framework pipeline and listener for assembled APIs in `deploymentProfile=standalone` |
| `sdkwork-api-cloud-gateway` | Platform-owned framework pipeline hosting approved API assemblies in cloud |
| Java/Spring `*ApiController` module | Typed `WebRequestContext` equivalent, standard interceptor order, and OpenAPI/manifest metadata parity |
| Contract-only `apis/` source | OpenAPI operations still declare `x-sdkwork-request-context: WebRequestContext` and `x-sdkwork-api-surface` before SDK generation |

Out of scope for this standard:

- gRPC/RPC services (`RPC_SPEC.md`, `RUST_RPC_SPEC.md`)
- Pure frontend packages without HTTP route ownership
- Workers without HTTP listeners
- `sdkwork-<application-code>-service-host` in-process containers that do not mount HTTP routes

These out-of-scope artifacts still `MUST NOT` introduce a competing HTTP context framework when they call, generate, or compose SDKWork HTTP APIs.

## 3. Application Architecture Rule

SDKWork application HTTP development uses one architecture:

```text
requirement / ADR
  -> API contract and route manifest
  -> sdkwork-web-framework route helpers
  -> WebRequestContext / RequirePrincipal
  -> handler/controller adapter
  -> service or use-case
  -> repository/provider/cache/event ports
  -> materialized OpenAPI authority
  -> owner-only SDK family
  -> application/frontend/backend consumers through generated SDKs or approved wrappers
```

Rules:

- Application roots that develop `open-api`, `app-api`, `backend-api`, or any HTTP `*-api` module `MUST` declare `WEB_FRAMEWORK_SPEC.md` as part of their architecture and verification evidence.
- Application shells `MUST` mount SDKWork HTTP route crates, dependency routers, backend controllers, and gateway routes through the framework bootstrap or an approved language-equivalent runtime profile.
- UI packages, frontend services, backend-admin UI packages, SDK consumers, and application feature services `MUST` consume generated SDKs or approved composed wrappers. They `MUST NOT` import route crates, controller classes, path constants, or framework route internals as transport APIs.
- Dependency-owned API surfaces are integrated through `sdkDependencies`, `dependencyApiSurfaces`, executable dependency router/controller exports, external upstreams, or approved composed wrappers. They `MUST NOT` be copied into the consuming application-owned route crate or SDK authority.
- Framework bootstrap and gateway composition `MUST` consume route manifests/OpenAPI authorities through the route registry and fail before startup/release when normalized `(surface, method, path)` collisions exist.
- Standard app/backend health and readiness paths (`/app/v3/api/system/health`, `/app/v3/api/system/ready`, `/backend/v3/api/system/health`, `/backend/v3/api/system/ready`) are reserved for the standard health route owner. Business framework routers and dependency route mounts `MUST NOT` claim those paths.
- Framework adoption is a repository/application architecture requirement, not an optional per-team implementation style.

## 4. Dependency Rules

Rules:

- Rust HTTP-capable repositories that own, serve, develop, proxy, or compose any SDKWork HTTP `*-api` surface `MUST` declare `sdkwork-web-framework` through the native build tool (`Cargo.toml` path or pinned Git dependency) according to `DEPENDENCY_MANAGEMENT_SPEC.md`.
- Route crates `MUST` depend on public framework crates such as `sdkwork-web-context`, `sdkwork-web-axum`, `sdkwork-web-contract`, and related `sdkwork-web-*` packages. Exact crate boundaries are defined in the L1 standard.
- Standalone/cloud gateways and migration-only API server crates `MUST` assemble the HTTP runtime through `sdkwork-web-bootstrap` or an equivalent documented public bootstrap API from the framework repository.
- Gateways that proxy or compose SDKWork `*-api` routes `MUST` run the framework surface classification, context, auth, policy, logging, audit, and response identity stages before dispatching to upstreams, except for explicitly documented health/readiness probes.
- Business repositories `MUST NOT` deep-import private framework modules. They use only public framework crates and public package-root exports.
- Business repositories `MUST NOT` depend on deprecated appbase-only HTTP context crates such as `sdkwork-platform-http-context-service` for new work. Migration guidance lives in `../sdkwork-web-framework/docs/10-migration-from-appbase.md` and `MIGRATION_SPEC.md`.
- Application repositories `MUST NOT` vendor framework pipeline source into local `crates/` copies, local Java filter packages, or generated SDK workspaces.

## 5. Request Context Vocabulary

The canonical typed request context is **`WebRequestContext`**.

| Concept | Standard name | Notes |
| --- | --- | --- |
| Request context | `WebRequestContext` | Required handler/controller context on all SDKWork HTTP operations |
| Principal | `WebRequestPrincipal` | `None` only on public routes |
| API surface | `WebApiSurface` | `OpenApi`, `AppApi`, `BackendApi`, `GatewayApi` |
| Locale context | `WebLocaleContext` | Framework-resolved locale, fallback, active locale, and message bundle version metadata |
| Service view | `TenantAppContext` | Tenant/app/subject ids for service-layer scoping |
| Legacy alias | `AppRequestContext` | Migration-only alias; new code and OpenAPI extensions use `WebRequestContext` |

Rules:

- `WebRequestContext` `MUST` be resolved once at the framework boundary and injected before protected business handlers run.
- Every SDKWork HTTP operation `MUST` have a `WebRequestContext`, including public operations. Public operations receive a context with `principal: None`; protected operations use `WebRequestPrincipal` or `RequirePrincipal`.
- `WebRequestContext` `MUST` include a framework-resolved `WebLocaleContext` following `I18N_SPEC.md` section 3.
- Handlers `MUST` declare `WebRequestContext` or `RequirePrincipal` as a function parameter. They `MUST NOT` parse `Authorization`, `Access-Token`, `X-API-Key`, tenant, organization, user, permission, request-id, locale, language, or SDKWork identity projection headers.
- Java/Spring controller methods `MUST` consume the typed context through a method parameter, request attribute, argument resolver, or equivalent central framework mechanism. They `MUST NOT` reparse credential, tenant, or locale headers in controller logic.
- Domain projections such as IAM `AppContext` `MUST` be injected only through `DomainContextInjector` or an equivalent framework-registered extension. Route crates and controllers `MUST NOT` hardcode domain context construction.
- OpenAPI operations `MUST` declare `x-sdkwork-request-context: WebRequestContext` and `x-sdkwork-api-surface` according to `API_SPEC.md` section 19.
- Route manifests `MUST` declare `requestContext: WebRequestContext` and `apiSurface` on every route entry so materialization can write the OpenAPI extensions deterministically.
- Full field vocabulary and JSON Schema: `../sdkwork-web-framework/specs/web-request-context.schema.json` and `../sdkwork-web-framework/docs/03-web-request-context.md`.

### 5.1 SQL Subject Scope Projection

Handlers and repositories that persist SQL `BIGINT` `tenant_id`, `organization_id`, or `user_id` columns `MUST` project subject scope from `WebRequestContext` / `TenantAppContext` using the rules in `SUBJECT_ID_SPEC.md`.

| Step | Input | Output |
| --- | --- | --- |
| 1 | `WebRequestContext.principal` | validated tenant/user/org string claims |
| 2 | `TenantAppContext` | service-layer subject view |
| 3 | SQL subject mapper | `tenant_id: i64`, `organization_id: i64`, `user_id: i64` |

Rules:

- Positive numeric parsing is required for `tenant_id` and `user_id`; `organization_id` `MUST` parse as `>= 0`, with `0` meaning tenant-level scope.
- Mapping failure on an authenticated principal `MUST` return HTTP `422` with business code `42201`, not HTTP `500` or internal code `5001`.
- Legacy `TrustedRequestSubject` bridges `MAY` exist only for migration and `MUST` use the same numeric parse rules.
- Handlers `MUST NOT` read client-supplied tenant/user selector headers or parameters to establish ambient SQL subject scope.

### 5.2 Locale Context Projection

`WebLocaleContext` is the framework-owned request locale view. It is resolved once and then consumed by handlers, message mappers, response mappers, SDK gateway adapters, audit enrichers, and backend/admin controllers.

Required logical fields:

```text
WebLocaleContext {
  requestedLocale?: LocaleTag
  effectiveLocale: LocaleTag
  fallbackLocale: LocaleTag
  supportedLocales: LocaleTag[]
  activeLocales: LocaleTag[]
  source: user-preference | tenant-preference | app-default | accept-language | sdk-header | system-default
  catalogVersion?: string
  messageBundleVersion?: string
  timezone?: string
  numberingSystem?: string
}
```

Rules:

- Locale tags `MUST` be normalized according to `I18N_SPEC.md`.
- Locale resolution precedence `MUST` follow `I18N_SPEC.md` section 2: authenticated user preference, tenant/application preference, approved SDK/host runtime locale, `Accept-Language`, application default, explicit fallback.
- Public, login, registration, OAuth, password reset, refresh-token, open-api, app-api, backend-api, gateway, and framework control-plane routes `MUST` receive locale context.
- The framework `MUST` emit `Content-Language` on localized responses and `Vary: Accept-Language` when representation varies by language.
- The framework `MAY` emit diagnostic bundle version headers defined by `I18N_SPEC.md`.
- Business handlers and controllers `MUST NOT` parse `Accept-Language`, `X-SdkWork-Locale`, cookies, query parameters, or user-agent headers to choose locale.
- Production locale resolution `MUST NOT` trust query parameters unless the route is a documented preview/test route and route metadata declares the exception.

## 6. API Surfaces And Auth Modes

| Surface | Prefix | Auth mode | Framework requirement |
| --- | --- | --- | --- |
| app-api | `/app/v3/api` | `anonymous`, `credential-entry-bootstrap`, `refresh-token`, or `dual-token` | Route-profile resolver + `WebRequestContext` |
| backend-api | `/backend/v3/api` | `dual-token` or an explicitly governed internal/agent profile | Route-profile resolver + `WebRequestContext` |
| open-api | Approved domain prefix, for example `/im/v3/api` | `anonymous`, `api-key`, `oauth`, `open-api-flexible`, `api-key-or-dual-token`, or `compatibility` | Header-driven credential resolution + `WebRequestContext` |
| gateway-api/internal-api | Gateway-owned prefixes | `ingress-token` or an explicitly declared profile | Context resolution before proxy/composition |

Rules:

- Surface classification `MUST` run in the framework pipeline before credential parsing.
- Protected app-api and backend-api handlers `MUST` call `require_tenant_id()` and `require_app_id()` or an equivalent framework/profile guard before business logic that reads tenant-owned data.
- Protected open-api handlers `MUST` consume framework-resolved tenant/app context from API key lookup, OAuth bearer lookup, or flexible open-api credential detection. Vendor compatibility routes declared under `API_SPEC.md` section 4.5.2 `MAY` use documented adapter context rules. They `MUST NOT` parse credential headers directly.
- Open-api credential mode `MUST` be declared in the route manifest (`auth.mode`) and enforced before protected business logic runs.
- Route metadata is the sole auth-profile selector. Header presence, path-prefix heuristics, public-prefix lists, handler behavior, or SDK defaults `MUST NOT` override the matched route profile.
- Framework contract types `MUST` expose first-class variants for every canonical profile in `API_SPEC.md` section 10, including `CredentialEntryBootstrap`; encoding it as `Public` plus an unrelated flag is non-compliant.
- Before authentication, the framework `MUST` run a credential-contamination guard derived from the matched profile. The guard rejects disallowed credential/context headers and never strips them silently before business logic.

### 6.1 Open-api Credential Modes

Protected open-api routes `MUST` declare one of these route-level auth modes:

| Route manifest `auth.mode` | Framework `RouteAuth` | Credential transport | Resolver path |
| --- | --- | --- | --- |
| `api-key` | `ApiKey` | `X-Api-Key` | `WebRequestContextResolver::resolve_api_key` + `ApiKeyLookupService` |
| `oauth` | `OAuth` | `Authorization: Bearer <token>` without `Access-Token` | `WebRequestContextResolver::resolve_oauth_bearer` + `OAuthTokenLookupService` |
| `open-api-flexible` | `OpenApiFlexible` | API key and/or OAuth bearer headers | `OpenApiCredentialSchemeDetector` chooses scheme, then dispatches to the matching resolver |
| `api-key-or-dual-token` | `ApiKeyOrDualToken` | `X-API-Key` alone, or `Authorization: Bearer <auth_token>` together with `Access-Token` | Exact credential-combination guard chooses API-key lookup or dual-token resolution |
| `public` | `Public` | none | anonymous `WebRequestContext` |

Rules:

- Credential scheme detection for open-api `MUST` be header-driven. When `Access-Token` is present, the request `MUST NOT` be classified as open-api OAuth bearer; app-api/backend-api dual-token rules take precedence on those surfaces.
- `OpenApiFlexible` default preference when both `X-Api-Key` and OAuth bearer are present is API key first. Applications `MAY` override `OpenApiCredentialSchemeDetector` through framework runtime assembly.
- `ApiKeyOrDualToken` accepts exactly one complete branch. `X-API-Key` by itself selects API-key resolution. `Authorization` plus `Access-Token` selects dual-token resolution. API key mixed with either token, either token without its pair, and missing credentials `MUST` fail in the credential-contamination/presence guard before resolver or handler execution.
- Open-api credential modes and app-api/backend-api dual-token mode `MUST` be mutually exclusive for one request.
- Dual-token resolution on app-api/backend-api surfaces `MUST` require both `Authorization: Bearer <JWT auth_token>` and `Access-Token: <JWT access_token>` when the route declares `dual-token` mode and the client runtime has both credentials available.
- Credential-entry bootstrap routes `MUST` require `Access-Token: <JWT access_token>` and resolve tenant/app isolation from that token while rejecting `Authorization` and every other non-profile credential.
- Anonymous routes require no credential and receive `principal: None`. Refresh-token routes use only their declared refresh proof; they derive tenant/session context from the validated proof and `MUST NOT` require or inherit `Access-Token` or `Authorization`.
- `auth_token` and `access_token` header values `MUST` use JWT compact serialization. Semicolon claim-string tokens and raw JSON claim blobs `MUST` be rejected by framework parsers and production resolvers.
- Auth/access JWT parsers `MUST` require a non-negative integer `token_version` claim. Current production value is `1`. Validators `MUST` reject missing, malformed, obsolete, or future versions outside the configured upgrade window.
- When both tokens are present, overlapping principal and tenancy claims `MUST` be resolved from `auth_token` first. Contradictory overlapping values in `access_token` `MUST` fail validation.
- Production and production-like profiles `MUST` resolve API keys and OAuth bearer tokens through server-side lookup services. Dev-only inline claim-string resolvers are allowed only for open-api API key dev fixtures documented by the owning repository; they `MUST NOT` accept auth/access token claim strings.
- IAM standard adapter: `sdkwork-iam-web-adapter` implements `IamWebRequestContextResolver` (canonical application integration alias), `IamOpenApiWebRequestContextResolver`, and the concrete `IamDatabaseWebRequestContextResolver` with `IamApiKeyLookupService` and `IamOAuthTokenLookupService`. Application repositories `MUST` wire protected app-api/backend-api surfaces through `IamWebRequestContextResolver` and `SHOULD NOT` add application-local pass-through resolver wrappers.
- L1 trait signatures, detector defaults, and Axum extractors: `../sdkwork-web-framework/specs/WEB_FRAMEWORK_STANDARD.md`, `../sdkwork-web-framework/docs/03-web-request-context.md`, and `../sdkwork-web-framework/docs/15-extension-points-registry.md`.

- Business route crates `MUST NOT` live in `sdkwork-web-framework`. Framework-owned admin or control-plane route crates may live in the framework repository only when their ownership is explicit, their paths are framework-owned, and they follow the same `WebRequestContext`, manifest, OpenAPI, and security rules as application route crates.
- Surface prefix rules remain authoritative in `API_SPEC.md` section 4.
- Public route declarations use framework route metadata such as `RouteAuth::Public`; SDK/OpenAPI metadata for those operations uses `security: []` and `x-sdkwork-auth-mode: anonymous`. Credential-entry declarations use `RouteAuth::CredentialEntryBootstrap`, materialize `security: [{ AccessToken: [] }]`, and never reuse the public variant.
- Framework runtime enums may use language-native names such as `WebAuthMode::Public` or `WebApiSurface::AppApi`, but route manifests, OpenAPI extensions, SDK generator inputs, and generated SDK metadata `MUST` use the canonical contract labels `public`, `anonymous`, `open-api`, `app-api`, `backend-api`, and approved `*-api` surface labels.

## 7. Every API Operation Rule

Rules:

- Every SDKWork HTTP operation that is authored, materialized, generated, served, proxied, or composed under an `open-api`, `app-api`, `backend-api`, or other HTTP `*-api` surface `MUST` declare and use `WebRequestContext`.
- Every route manifest entry `MUST` include `requestContext: WebRequestContext` and `apiSurface: open-api | app-api | backend-api` or the matching approved `*-api` surface value. Missing either field is a materialization failure.
- Every materialized OpenAPI operation `MUST` include `x-sdkwork-request-context: WebRequestContext` and `x-sdkwork-api-surface`. `x-sdkwork-api-surface` values `MUST` be canonical kebab-case contract labels such as `open-api`, `app-api`, `backend-api`, and `internal-api`; camelCase values such as `openApi`, `appApi`, `backendApi`, and `internalApi` are internal runtime labels only and are invalid in route manifests, OpenAPI, derived `*.sdkgen.*` inputs, and generated SDK metadata.
- Public routes `MUST` still run through request identity, surface classification, request validation, logging, audit where applicable, secure headers, and response identity stages. Public does not mean context-free.
- Protected routes `MUST` prove principal, tenant/app context, authorization, and tenant isolation before service code accesses tenant-owned data.
- SDK generator inputs `MUST` preserve the request-context and surface extensions from authority OpenAPI to derived `*.sdkgen.*` files.
- Framework route contract types such as `HttpRoute`, Java route metadata annotations, or materializer input records `MUST` carry or validate the route-level `requestContext`, `apiSurface`, owner/API authority, source route crate/module, auth mode, and security flags needed for deterministic OpenAPI materialization. Inferring these fields only from path prefixes is allowed during migration only when the materializer immediately validates the inferred values against the route manifest and rejects `unknown`, missing, or mismatched metadata.
- Public SDK-generated operations `MUST` materialize `security: []` and `x-sdkwork-auth-mode: anonymous`. Framework-specific markers such as `x-sdkwork-route-auth: public` may also be emitted, but they do not replace `x-sdkwork-auth-mode`.
- Operations classified by their owning API contract as credential-entry `MUST` use `RouteAuth::CredentialEntryBootstrap`, materialize `security: [{ AccessToken: [] }]`, `x-sdkwork-auth-mode: credential-entry-bootstrap`, and `x-sdkwork-forbid-credential-headers: true`. Operations classified as anonymous `MUST` use `RouteAuth::Public` and materialize anonymous metadata. The framework enforces the selected manifest profile without embedding business-operation names or path-specific exceptions.
- Open-api surface classification `MUST` support approved domain prefixes such as `/im/v3/api`; it `MUST NOT` classify only a hard-coded `/open/v3/api` prefix as open-api.

## 8. Mandatory Interceptor Chain

All SDKWork HTTP API routers, including anonymous, credential-entry, refresh, protected, gateway, and compatibility routes, `MUST` run the standard API call chain defined in `API_SPEC.md` section 10.3 and `SECURITY_SPEC.md` section 5.1. A profile may make a stage a no-op, but it does not bypass the chain.

Rust protected routers `MUST` use `WebCallInterceptorChain::standard()` from `sdkwork-web-framework` or a documented strict superset. Business code `MUST NOT` bypass context resolution, authentication, authorization, tenant isolation, or context injection stages.

Standard stages:

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

- Chain errors `MUST` map to `application/problem+json` through the framework error boundary.
- Locale resolution `MUST` run as a standard sub-stage of request context resolution and complete before context injection. Authentication may enrich the locale context with user or tenant preference before protected handlers run.
- Cloud production and standalone production `MUST NOT` use dev-only
  claim-string resolvers.
- Sensitive operations defined by `SECURITY_SPEC.md` section 5 and `API_SPEC.md` section 19 `MUST` declare `x-sdkwork-rate-limit-tier` in OpenAPI and configure the corresponding framework policy.
- Gateways and dependency proxy routes `MUST` run the relevant stages before upstream dispatch unless the route is an explicitly documented local health/readiness endpoint.

## 9. Business Extension Traits

The framework defines extension points; business repositories implement them.

| Trait | Stage | Typical implementer |
| --- | --- | --- |
| `WebRequestContextResolver` | 10 | appbase `IamWebRequestContextResolver` / `IamOpenApiWebRequestContextResolver` |
| `ApiKeyLookupService` | 10 (open-api api-key) | appbase or owning domain |
| `OAuthTokenLookupService` | 10 (open-api oauth) | appbase or owning domain |
| `OpenApiCredentialSchemeDetector` | 10 (open-api flexible) | appbase or product override |
| `LocaleResolver` | 10 | framework default + appbase/application preference providers |
| `UserLocalePreferenceProvider` | 10/11 | appbase or application user profile service |
| `TenantLocalePreferenceProvider` | 10/11 | appbase or application tenant profile service |
| `AuthorizationPolicy` | 12 | appbase or product policy service |
| `TenantIsolationPolicy` | 13 | appbase or product policy service |
| `DomainContextInjector` | 14 | appbase IAM injector, product injectors |
| `MessageBundleProvider` | response/error boundary | framework, appbase, or application message bundle registry |
| `LocalizedProblemMapper` | response/error boundary | framework response mapper |
| `ValidationMessageResolver` | extractor/validation boundary | framework validation adapter |

Rules:

- Business adapters `MUST` register through framework runtime assembly. They `MUST NOT` bypass the standard chain.
- IAM token validation, API key lookup, OAuth bearer lookup, RBAC, and tenant isolation remain business-owned, but their hook positions and semantics are framework-owned.
- Locale preference lookup and message resolution remain extension-owned, but their hook positions, context vocabulary, headers, and safe problem-detail semantics are framework-owned.
- appbase and application repositories `MUST` implement framework traits instead of exposing a parallel HTTP context framework.

## 10. Handler, Service, And Repository Rules

Rules:

- Handlers `MUST` take `WebRequestContext` via framework injection (`FromRequestParts` in Rust or an equivalent argument resolver in Java).
- Handlers `MUST NOT` use raw `Extension<WebRequestContext>` as the only pattern when `FromRequestParts` is available.
- Handlers `MUST` read locale, timezone, numbering system, and message bundle version only from `WebRequestContext.locale` or approved service context projections.
- Services `MUST` accept `&WebRequestContext` or `TenantAppContext` for tenant/app scoping and `MUST NOT` depend on Axum, Spring, or gateway request types.
- Repositories `MUST NOT` accept bare `tenant_id` without provenance from service/context inputs.
- Route manifests `MUST` use framework contract types such as `HttpRoute` and `RouteAuth` when materializing OpenAPI.
- Detailed layering rules remain in `WEB_BACKEND_SPEC.md` and `RUST_CODE_SPEC.md`.

## 11. No-Bypass Rules

Forbidden:

- Ad hoc Axum/Tower middleware stacks that replace framework bootstrap for SDKWork `*-api` routes.
- Local Java filter/interceptor chains that implement different request-context, auth, tenant, or problem-detail semantics.
- Local request-context structs that compete with `WebRequestContext`.
- Handler/controller parsing of raw credential, tenant, organization, user, permission, or request identity headers.
- Handler/controller parsing of raw locale, language, cookie, query, or user-agent values to choose user-facing language.
- Deprecated context crates such as `sdkwork-platform-http-context-service` for new HTTP work.
- Vendored framework source or copied framework pipeline code in application repositories.
- SDK generation from OpenAPI or route manifests that omit request-context/surface metadata.
- Routers merged outside the one framework-wrapped router after route-manifest binding.
- A second application/gateway CORS or authentication middleware around a router already governed by the standard framework chain.
- Runtime OpenAPI assembled from a route inventory different from the executable router and bound `HttpRouteManifest`.
- Runtime-composed route manifests backed by leaked allocations, process-global mutable registries, or source parsing. The framework contract must own or reference-count combined route inventories directly.

## 12. Secure Defaults

The framework enforces secure defaults without per-route business configuration:

- CORS: deny-by-default. Development/test profiles `MAY` use the shared framework
  private-network origin policy, which accepts only HTTP(S) loopback, RFC 1918 IPv4, and IPv6
  unique-local-address origins on numeric development ports. The policy `MUST` be rejected by
  production validation; production remains an exact-origin allowlist. Responses that echo a
  concrete allowed origin `MUST` include `Vary: Origin` and `MUST NOT` emit `*` with credentials.
- A production or production-like gateway that mounts any browser-callable `app` surface `MUST`
  fail startup when `allowAnyOrigin` is enabled or `allowedOrigins` is empty. Empty means deny all
  browser origins; it `MUST NOT` be interpreted as same-origin discovery. Each entry `MUST` be an
  exact origin without a wildcard, path, query, or fragment: an HTTP(S) origin, or a registered
  desktop custom-scheme origin such as `app://dsh` or `tauri://localhost`. Browser and desktop
  WebView callers use the same allowlist, including OAuth authorization and callback completion
  requests. Unregistered schemes (`javascript:`, `data:`, `file:`) remain forbidden.
- Registered first-party client origins (desktop WebView custom schemes `app://dsh`, `app://birdcoder`,
  `app://sdkwork`, `app://dtupay`, `tauri://localhost`, and the mini program runtime
  `https://servicewechat.com`) `MUST` be merged into the effective CORS policy in every lifecycle
  environment, production included. Deployments `MAY` repeat them in `SDKWORK_CORS_ALLOWED_ORIGINS`
  but `MUST NOT` need to; runtime assembly owns the merge.
- The default CORS request-header allowlist `MUST` cover the SDKWork credential and protocol headers
  (`Authorization`, `Access-Token`, `Content-Type`, `Idempotency-Key`, `X-Content-SHA256`,
  `X-Idempotency-Fingerprint`, `X-API-Key`, `X-SDKWork-Access-Token`) plus industry-common headers
  (`Accept`, `Accept-Language`, `Content-Language`, `X-Requested-With`, `X-Request-Id`,
  `X-Correlation-ID`, `X-Tenant-ID`, `X-Device-ID`, `X-Client-Version`, `X-App-Version`,
  `X-Platform`, `Traceparent`, `Tracestate`), and `MUST` expose infrastructure response headers
  (`X-Request-Id`, `X-SDKWork-Trace-Id`) via `Access-Control-Expose-Headers`. Development/test
  policies `MAY` widen the preflight header gate to `*` so local surfaces never fail preflight when
  the SDK grows a new request header; production validation `MUST` keep rejecting `*` headers.
- The `open-api` surface is a server-to-server / generated-SDK surface: CORS origin and preflight
  validation, and the cross-site request guard, `MUST NOT` apply to it. Calls without a browser
  `Origin` are the normal case; requests that do carry an `Origin` `MUST NOT` be CORS-denied on
  open-api routes. App-api, backend-api, and gateway surfaces keep full CORS enforcement.
- The source deployment profile is the origin-set authority under `SOURCE_CONFIG_SPEC.md`. Client
  SDK base URL selection, OAuth redirect URI construction, gateway routing, and CORS configuration
  `MUST` resolve from the same selected environment/profile; SDK consumers `MUST NOT` repair a 403
  by suppressing `Origin`, proxying credentials through an ungoverned endpoint, or enabling `*`.
- Each mounted API router `MUST` have exactly one CORS policy authority: the standard Web Framework
  CORS interceptor configured with the environment-derived `SecurityPolicy`. A standalone/cloud
  process host `MUST NOT` wrap routers that already use `WebFrameworkLayer` with a second Tower,
  Axum, Spring, proxy, or application-local CORS middleware. Public edge proxies may add transport
  headers only when they preserve and do not independently contradict the application policy.
- Multi-surface assemblies `MUST` inject the same resolved environment and configured origin set
  into every mounted Web Framework layer. Process-host assembly, router merge order, and SDK surface
  must not change whether an Origin is accepted.
- Embedded dependency routers resolve the host-selected lifecycle environment through the shared
  `SDKWORK_ENVIRONMENT` projection and the host origin set through
  `SDKWORK_CORS_ALLOWED_ORIGINS`, as governed by `SOURCE_CONFIG_SPEC.md`. Application-scoped keys
  such as `SDKWORK_<APP>_ENVIRONMENT` remain application inputs; they do not replace the shared
  projection consumed by independently owned dependency routers. An outer gateway and its embedded
  routers `MUST NOT` resolve different environments or CORS policies for the same request.
- Request ID: server-generated UUID v4; overwrite client `X-Request-Id`
- Unauthenticated protected paths: `401` problem+json
- Oversized body: `413`
- Rate limit exceeded: `429` with `Retry-After` when applicable
- Logs `MUST` redact tokens and API keys

## 13. Java Spring Parallel Profile

Java Spring controllers `MUST` preserve the same contract and runtime semantics without cargo-depending on Rust crates.

Rules:

- Spring filters/interceptors `MUST` implement the same standard stage semantics and produce a typed `WebRequestContext` equivalent before controller methods run.
- Controllers `MUST` consume the typed context and `MUST NOT` reparse credential or tenant headers.
- Java controller scan or route manifest tooling `MUST` emit `requestContext: WebRequestContext` and `apiSurface` metadata so materialized OpenAPI contains the same extensions as Rust routes.
- Problem-detail mapping `MUST` remain centralized through framework exception handling or a shared response mapper.
- Java locale resolution `MUST` produce the same logical `WebLocaleContext`, response headers, and localized problem-detail extension fields as the Rust framework profile.
- Success responses `MUST` be serialized as `SdkWorkApiResponse` from `API_SPEC.md` section 15 for SDKWork-owned business operations on `app-api`, `backend-api`, and business `open-api`. Vendor compatibility `open-api` operations declared with `x-sdkwork-wire-protocol: external` per section 4.5.2 `MAY` preserve upstream wire through documented adapter handlers instead of `SdkWorkApiResponse`. Framework response identity `MUST` inject server-owned `traceId` and success `code` into every JSON success body that uses the SDKWork envelope and `SHOULD` echo `traceId` through `X-SdkWork-Trace-Id`.
- Handlers `MUST NOT` return legacy envelopes such as `PlusApiResult`, `AppbaseApiResult`, `StoreApiResult`, `SdkWorkResponse`, or per-domain `*ApiResult`. Business failures `MUST` map to `ProblemDetail`, not HTTP 2xx bodies with non-success `code`, `success`, or human `message`. Wire field `requestId` is forbidden.
- Framework response mapping `MUST` normalize every SDKWork-owned custom 4xx/5xx response, including Axum/Spring extractor or binding rejection, request-size/media-type rejection, router fallback, timeout, and handler error responses, to `application/problem+json`. The normalized body `MUST` contain server-owned `traceId` and `instance`; it `MUST` contain the matched route `operationId` when route metadata resolves. Operations explicitly declared with `x-sdkwork-wire-protocol: external` preserve their external protocol error body.
- Rust `http::HeaderName::from_static` arguments `MUST` be compile-time lowercase
  ASCII header keys. Display/OpenAPI names such as `X-SdkWork-Trace-Id` `MUST`
  be separate from lowercase runtime constants such as
  `x-sdkwork-trace-id`; display constants `MUST NOT` be passed to
  `HeaderName::from_static`. Dynamic or display-cased names use a fallible
  parser such as `HeaderName::from_bytes` or `HeaderName::try_from`, and parse
  failure must remain a typed response/configuration error rather than panic.
- Java and Rust implementations of the same `operationId` `MUST` preserve identical auth, tenant, request-context, success-envelope, operation-pattern status, and error semantics.
- Framework response mapping `MUST` preserve `API_SPEC.md` section 15.4 operation semantics: create maps to `201`, update/retrieve/list/search maps to `200`, delete maps to `204` with no JSON body, async accept maps to `202`, and SDKWork-owned business failures map to `ProblemDetail`.

## 14. Verification

Framework repository:

```bash
cargo test --workspace
```

Business repository after framework integration:

- Dependency graph check: `cargo tree` includes public `sdkwork-web-*` crates and has no reverse dependency from framework crates to business crates.
- Route manifest check: every route declares `requestContext: WebRequestContext`, `apiSurface`, auth mode, owner, source, and handler binding metadata.
- Route collision check: `check-route-path-collisions.mjs` passes for route manifests and OpenAPI authorities before framework routers or gateways are merged.
- Component runtime check: `check-component-port-bindings.mjs` passes when same-origin dependency API surfaces or runtime entrypoints are declared.
- Contract label check: route manifests, materialized OpenAPI, and derived SDK inputs use canonical `x-sdkwork-api-surface` values such as `open-api`, `app-api`, `backend-api`, and `internal-api`, not camelCase runtime enum labels.
- Pipeline order contract test: standard chain stages are not bypassed.
- Handler static scan: no raw credential, tenant, organization, user, permission, or request-id header parsing in route crates or controllers.
- Locale static scan: no handler/controller-local parsing of `Accept-Language`, `X-SdkWork-Locale`, locale query parameters, cookies, or user-agent language values.
- Locale context test: public and protected routes receive `WebRequestContext.locale`; unsupported requested locales resolve through the configured fallback chain.
- Locale response test: localized responses emit `Content-Language`, and language-varying responses emit `Vary: Accept-Language`.
- Localized problem test: framework errors and validation errors preserve numeric `ProblemDetail.code` and `traceId`, and expose `i18nKey`/`locale` when safe messages exist.
- Problem routing test: extractor, validation, handler, timeout, and fallback errors contain `instance`; matched SDKWork-owned routes also contain the manifest `operationId`, while unmatched routes do not fabricate one.
- Header construction test: every static Rust response header key is lowercase;
  success and Problem Details response construction cannot panic for a valid
  trace id. Verify authored Rust sources with
  `tools/check-rust-http-header-standard.mjs`.
- Bootstrap smoke test: gateway or migration-only API server mounts routes through framework bootstrap.
- OpenAPI check: every operation declares `x-sdkwork-request-context: WebRequestContext`, canonical `x-sdkwork-api-surface`, and exactly one auth profile; `security`, auth profile, route metadata, and SDK transport policy agree.
- Operation pattern check: SDKWork-owned operations preserve the `API_SPEC.md` section 15.4 method/path/status/data matrix; delete routes return `204` without JSON bodies and create routes return `201`.
- Credential-entry check: pre-session operations use `CredentialEntryBootstrap`, require only `AccessToken`, materialize the canonical profile/guard metadata, reject every non-profile credential before handler logic, and return a diagnostic missing-bootstrap problem without reaching the handler.
- Route/OpenAPI parity check: the executable router, bound route manifest, served OpenAPI, and SDK generation authority have identical normalized `(surface, method, path, operationId, authProfile)` inventory for the selected deployment profile.
- Manifest ownership check: static route manifests and runtime-composed manifests bind through the same Framework API; composition does not use `Box::leak` or another lifetime-forcing allocation leak.
- Open-api auth check: protected routes declare `api-key`, `oauth`, `open-api-flexible`, or `api-key-or-dual-token`; security vectors cover missing credentials, API key resolution, OAuth bearer resolution, flexible scheme selection, valid dual-token selection, incomplete token pairs, and API key/token contamination.
- SDK generation check: authority OpenAPI and derived `*.sdkgen.*` inputs preserve request-context and surface extensions.
- Java profile check, when Java is present: typed context argument resolution, interceptor order, and problem-detail mapping match this standard.

Detailed test requirements: `TEST_SPEC.md` section 2.3.1.

## 15. Acceptance Checklist

- [ ] Every repository/application/module that owns, serves, develops, proxies, or composes an SDKWork HTTP `*-api` surface follows this standard.
- [ ] Rust HTTP `*-api` runtimes declare `sdkwork-web-framework` and public `sdkwork-web-*` crate dependencies.
- [ ] Route crates mount through framework router helpers and inject `WebRequestContext`.
- [ ] Gateway or migration-only API server uses framework bootstrap; no handwritten Axum/Tower security stack replaces the standard chain.
- [ ] Every route manifest entry declares `requestContext: WebRequestContext` and `apiSurface`.
- [ ] Route manifests and OpenAPI authorities pass normalized route path collision validation.
- [ ] Every materialized OpenAPI operation declares `x-sdkwork-request-context: WebRequestContext`, canonical kebab-case `x-sdkwork-api-surface`, and rate-limit tier when required.
- [ ] Public SDK-generated operations declare `security: []` and `x-sdkwork-auth-mode: anonymous`.
- [ ] Credential-entry operations declare `CredentialEntryBootstrap`, require only `AccessToken`, and enforce the profile contamination guard.
- [ ] Handlers/controllers declare typed `WebRequestContext`; no raw credential, tenant, organization, user, permission, or request-id header parsing.
- [ ] `WebRequestContext` includes `WebLocaleContext` and all SDKWork HTTP routes receive locale context.
- [ ] Handlers/controllers do not parse locale headers, cookies, query parameters, or user-agent language values.
- [ ] Localized responses emit standard locale headers and problem-detail localization metadata without changing numeric error semantics.
- [ ] Business adapters implement framework traits; no parallel HTTP context framework in appbase or application repositories.
- [ ] Java controllers, when present, preserve equivalent typed context, interceptor semantics, route metadata, and problem-detail behavior.
- [ ] Protected open-api routes declare `api-key`, `oauth`, `open-api-flexible`, or `api-key-or-dual-token` auth mode and resolve credentials through framework extension traits, not handler-local header parsing.
- [ ] The executable router, bound manifest, served OpenAPI, and SDK authority use one selected-profile route inventory with no missing or extra operation.
- [ ] One framework layer owns CORS, authentication, authorization, tenant isolation, problem mapping, and response identity for every mounted API route.
- [ ] `HttpRouteManifest` natively owns or shares runtime-composed inventories; assembly and gateway code contains no leaked manifest allocation.
- [ ] SDK generation inputs preserve request-context and API-surface extensions from authority OpenAPI.
- [ ] Open-api prefix check: approved domain prefixes such as `/im/v3/api` classify and materialize as `open-api`; hard-coded-only `/open/v3/api` classification is not sufficient.
- [ ] Verification commands from section 14 pass before merge.
