# Reusable Module Standard

- Version: 1.0
- Scope: reusable frontend/backend modules, appbase packages, service facades, extension points, module composition
- Related: `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `COMPOSABLE_ARCHITECTURE_SPEC.md`, `DOMAIN_SPEC.md`, `APPLICATION_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, `RUST_CODE_SPEC.md`, `JAVA_CODE_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`, `FRONTEND_CODE_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, `BACKEND_UI_SPEC.md`, `SDK_SPEC.md`, `API_SPEC.md`, `TEST_SPEC.md`

This standard defines the building-block model for SDKWork applications. A reusable module must be installable, understandable, replaceable, and testable without copying app-specific code. Application-wide L0-L6 responsibility boundaries follow `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`; cross-stack composition closure follows `COMPOSABLE_ARCHITECTURE_SPEC.md`.

## 1. Module Contract

Every reusable module `MUST` expose a public contract.

```ts
export interface SdkworkModule<TClients, TConfig, TServices> {
  name: string;
  version: string;
  domain: string;
  initialize(input: {
    clients: TClients;
    config: TConfig;
    services?: Partial<TServices>;
  }): TServices;
}
```

Rules:

- A module `MUST` declare one primary domain and one capability.
- A module `MUST` expose one package root export from `src/index.ts` or the language-equivalent public export file defined by its architecture standard.
- A new composable module `MUST` declare `contracts.layerRole`, `contracts.publicExports`,
  `contracts.providedPorts`, and `contracts.requiredPorts` in `specs/component.spec.json` so
  consumers can integrate it without reading private implementation files.
- A module `MUST NOT` require app-local globals, hidden singleton SDK clients, hard-coded URLs, hard-coded tenant IDs, or manually assembled auth headers.
- A module `MUST` be usable with standalone/cloud SDK clients and Java/Rust
  runtime implementations when its domain is shared.
- A module `SHOULD` publish a small public type surface and hide implementation internals.
- A module implementation `MUST` follow `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, and the language-specific spec only for languages it actually uses.

## 2. Package Classification

| Package type | Owns | Must not own |
| --- | --- | --- |
| `contracts` | Public TypeScript interfaces, generated type adapters, constants | UI, network calls |
| `service` | Domain orchestration, SDK client injection, validation mapping | React rendering, host calls |
| `ui` | Stateless or controlled visual components | business authorization, raw SDK calls |
| `feature` | Integrated pages/hooks using services and UI | transport configuration |
| `runtime` | Providers, bootstrap, storage adapters, host adapters | domain invariants |
| `host` | browser/mobile/native/runtime boundary | API business logic |
| `backend-domain-ui` | `backend-admin` domain pages, route/menu metadata, operator services using backend SDK | app/user-facing UI, app SDK calls, backend SDK construction |
| `pc-console-ui` | User-facing PC management console pages, route metadata, console services using app SDKs | company-internal admin workflows, backend-only operation center behavior |
| `pc-admin-ui` | Company-internal PC admin pages, route/menu metadata, internal operator services using backend SDKs | app/user-facing UI, user console workflows, app SDK login/session creation |
| `client-app-ui` | Client app-root packages aligned by core, commons, shell, capability, console/admin, and host roles | cross-architecture UI imports, hidden SDK constructors, platform globals |

Rules:

- Shared foundation modules `SHOULD` split contracts, service, UI, feature, runtime, and host only when the split reduces coupling.
- Small modules may keep these layers in one package, but boundaries must remain visible in folders and exports.
- A package named `core` must be domain-specific, such as `sdkwork-iam-core-pc-react`; generic `sdkwork-core` is forbidden for new shared domain behavior.
- PC user console modules `MUST` follow `APP_PC_ARCHITECTURE_SPEC.md` and be split as `sdkwork-<application-code>-pc-console-<capability>`.
- PC internal admin modules `MUST` follow `APP_PC_ARCHITECTURE_SPEC.md` and `BACKEND_UI_SPEC.md` and be split as `sdkwork-<application-code>-pc-admin-<capability>`.
- H5 application modules `MUST` follow `APP_H5_ARCHITECTURE_SPEC.md` and be split as `sdkwork-<application-code>-h5-<capability>`, with Capacitor host code in `sdkwork-<application-code>-h5-capacitor`.
- Flutter mobile modules `MUST` follow `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md` and be split as lower snake case Dart packages such as `sdkwork_<application_code>_flutter_mobile_<capability>`.
- Mini program modules `MUST` follow `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md` and `APP_MINI_PROGRAM_UI_SPEC.md` and be split as `sdkwork-<application-code>-mp-<capability>` source packages or approved shared `sdkwork-<capability>-mini-program` packages. Platform `pages` and `subpackages` are projections, not the source module boundary.
- Android native modules `MUST` follow `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md` and `APP_ANDROID_NATIVE_UI_SPEC.md` and be split as `sdkwork-<application-code>-android-mobile-<capability>` source packages or approved shared `sdkwork-<capability>-android-native` packages.
- iOS native modules `MUST` follow `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md` and `APP_IOS_NATIVE_UI_SPEC.md` and be split as `sdkwork-<application-code>-ios-mobile-<capability>` source packages or approved shared `sdkwork-<capability>-ios-native` packages.
- Harmony native modules `MUST` follow `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md` and `APP_HARMONY_NATIVE_UI_SPEC.md` and be split as `sdkwork-<application-code>-harmony-mobile-<capability>` source packages or approved shared `sdkwork-<capability>-harmony-native` packages.
- Standalone backend/admin UI modules `MUST` follow `BACKEND_UI_SPEC.md` and be split by business domain as `@sdkwork/react-backend-<domain>`.
- `@sdkwork/react-backend-ui` may contain only domain-neutral primitives; backend business pages and services must live in the owning backend domain package.

## 3. Appbase Canonical Modules

`apps/sdkwork-appbase` should use canonical IAM and platform naming for new modules.

| Capability | Canonical module intent |
| --- | --- |
| `iam-auth` | Login, registration, sessions, token refresh/logout, MFA/passkey/OAuth extensions |
| `iam-user` | Current user, profiles, identities, credentials, preferences |
| `iam-tenant` | Tenant selection, tenant settings, tenant members |
| `iam-organization` | Organization tree, departments, organization members |
| `iam-permission` | Roles, permissions, policies, authorization hints |
| `iam-security` | Security events, audit timeline, devices, API keys |
| `platform-app` | App manifest, app registry, environment, release/update metadata |
| `runtime-bootstrap` | SDK client creation, deployment profile, runtime target, token storage, host adapter injection, IAM application bootstrap orchestration through `@sdkwork/iam-application-bootstrap` |

Rules:

- New modules use `iam`, not `identity`, for user/auth/tenant/permission foundations.
- Legacy package names may be wrapped during migration, but new public contracts use canonical names.
- UI labels may use user-friendly wording; domain contracts use canonical domain names.

## 4. Dependency Direction

Allowed dependency flow:

```text
feature -> ui
feature -> service
service -> contracts
service -> generated SDK client interface
runtime -> service
runtime -> host adapter
app shell -> runtime
app shell -> feature
```

Forbidden dependencies:

- `contracts` importing `ui`, `service`, generated SDK implementations, or app shell code.
- `ui` constructing generated SDK clients.
- `service` importing app route files, page components, or native host implementations.
- shared modules importing another package through `/src/...` internals.
- foundation modules depending on application-specific feature modules.

## 4.1 Implementation Layout

Rules:

- Module entrypoints expose public contracts and composition helpers only.
- Reusable modules consumed by an application must be registered and bound through the architecture core package `composition/module-registry.*` per `APP_COMPOSITION_SPEC.md`.
- Reusable modules expose provided/required ports through `COMPONENT_SPEC.md` and
  `COMPOSABLE_ARCHITECTURE_SPEC.md`; README examples may explain those ports but must not become
  the authority.
- Durable module layer boundaries `MUST` follow `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`; a
  module that mixes UI, service, repository, provider, runtime, and contract ownership must split
  those responsibilities or document a temporary migration exception in its component spec.
- Business logic belongs in service/use-case modules.
- Persistence belongs in repository modules.
- Provider calls and host/runtime integration belong in adapters.
- Configuration belongs in typed config/bootstrap modules.
- Tests must target the public contract or focused internal units, not private file paths from other packages.
- Rust modules must not collect business logic in `src/lib.rs`; `RUST_CODE_SPEC.md` defines the required split.
- Java modules follow controller/service/repository/package boundaries from `JAVA_CODE_SPEC.md`.
- TypeScript modules use `src/index.ts` as the export boundary and typed SDK ports from `TYPESCRIPT_CODE_SPEC.md`.
- Frontend modules keep UI, hooks, services, state, routes, and i18n separated according to `FRONTEND_CODE_SPEC.md`.

## 4.2 Backend Module Call Boundary (In-Process First)

Authority: this section. It applies to every Rust backend crate in a module repository (`crates/*/src`, `services/*/src`), and it overrides any local convenience adapter.

### 4.2.1 The rule

Every SDKWork packaged deployment runs **one backend process against one PostgreSQL**: the gateway process embeds every module (`integrated` topology), and each module's data lives in the same database. Therefore, when a backend module needs another SDKWork module's data or behavior, it `MUST` reach it **in-process**:

- depend on the sibling module's contract/service/repository crate in `Cargo.toml` and call its public port, trait, or query API directly; or
- if the shared behavior is only expressed as an HTTP handler today, move that behavior down into the layer both modules can depend on (`<module>-contract`, `<module>-service`, `<module>-repository-sqlx`) and call it directly from both sides.

### 4.2.2 Forbidden

- Reading an environment variable that addresses a sibling SDKWork module's HTTP surface from backend business code, and calling it with `reqwest`, `hyper`, or a generated HTTP client. Forbidden shapes include `SDKWORK_<MODULE>_BACKEND_API_*`, `SDKWORK_<MODULE>_OPEN_API_*`, `SDKWORK_<MODULE>_<NAME>_URL`, and module-scoped forms such as `APPSTORE_DRIVE_BASE_URL`, `SDKWORK_FORUM_DRIVE_URL`, `SDKWORK_DRIVE_FACADE_URL`.
- Introducing a backend-to-backend adapter whose **default** mode is HTTP, or whose use depends on a service credential (`SDKWORK_ACCESS_TOKEN`, a shared secret) that the packaged deployment does not provision.
- Treating a loopback origin (`http://127.0.0.1:<port>`) as "the same process". It is a separate socket hop with its own authentication, availability, timeout, and failure semantics, and it fails at request time — after business state has already changed.
- Adding a new entry to a repository's `specs/backend-module-call-boundary.allow.json` without a written reason and a linked migration plan.

### 4.2.3 Allowed exceptions

Recorded in `specs/backend-module-call-boundary.allow.json` with a non-empty `reason`:

- Calls to **external** providers (payment gateways, LLM/search vendors, push providers, OAuth/ACME endpoints, webhook receivers).
- Calls made by **clients**: app SDKs, CLIs, agent tools, desktop/tauri hosts, browser runtimes that act as a client of the gateway.
- A deliberate **split deployment** in which the sibling runs in another process or container. Such an adapter `MUST` default to the in-process mode, `MUST` require an explicit opt-in variable for HTTP, and `MUST` fail at startup — never at the first business request — when its credentials are missing.

### 4.2.4 Why

The boundary exists because of a production incident: the order module called the account module over loopback HTTP, required `SDKWORK_ACCESS_TOKEN`, and the deployment had neither the token nor an account HTTP service. Every coupon redemption returned `HTTP 500` **after** the coupon had already been consumed and the order had been marked paid. An in-process call cannot produce that class of failure: it shares the transaction and connection pool, cannot drift on auth or error mapping, and needs no deployment-time configuration.

### 4.2.5 Verification

```bash
node sdkwork-specs/tools/check-backend-module-call-boundary.mjs --root <repo>
node sdkwork-specs/tools/check-backend-module-call-boundary.mjs --workspace <workspace-root>
```

The check is deliberately narrow: it flags sibling-module endpoints read from non-client backend crates. It ignores external vendors, infrastructure endpoints (`database`, `redis`, `otel`, …), self-published URLs (`*_PUBLIC_*`, `*_REDIRECT_*`, `*_LOGIN_*`, JWKS/issuer), and client/tool/desktop crates.

### 4.2.6 Known debt (migration in progress)

The workspace audit at the time this rule was introduced found **46 backend-to-backend HTTP call sites across 16 repositories**. **All are resolved**: sixteen repository/target groups migrated to in-process calls (§4.2.6.1) and two endpoint groups are **recorded exceptions** with written reasons (§4.2.6.2). `check-backend-module-call-boundary.mjs --workspace` reports **0 violations**. New code `MUST NOT` add to either list.

**Open functional decisions** (not boundary violations, but surfaced by this migration):

- **`sdkwork-browser` LLM** — **decided**: an audit found no completion implementation in `sdkwork-llm` at all (`impl LanguageModelPort for` count = 0; `OpenLlmService` holds only a store; provider endpoint/secret/model columns are never read or written; provider adapters are explicitly "Phase 2" in the architecture doc). An in-process provider therefore cannot exist today, so the browser agent **keeps HTTP as its default** for the LLM call — with startup validation — and that endpoint is a **recorded exception**, not a migration. `=in_process` stays as the opt-in for when a provider lands.
- **`sdkwork-feeds` news** — **resolved**: the news module now exposes `list_published_items(tenant_id, limit)` and the feeds news source registers in-process by default (schema probe), with HTTP only as an explicit opt-in.
- **`sdkwork-canvas` restore**: drive's `restore_version` flips version lifecycle without advancing the node head, so the canvas pointer guard still answers 500.
- **`sdkwork-appstore` build cost** — **capability delivered, adoption pending**: `drive-object-runtime` now has `backend-fs` / `backend-s3` features; a metadata-only consumer that opts out of `backend-s3` drops from 1025 to 659 `cargo tree` lines (−366 packages). Adopting that requires changing the **consumer** manifests (appstore, notes, canvas, webserver, deployments), which is outside this repository's boundary work.

**Resolved upstream blockers** (kept as a record of what the migration needed):

- **Drive** — delivered: `DriveUploadService::complete_stored_version(...)`, `SqlDriveNodeVersionStore::restore_version(...)`, `DriveUploadSessionService::{prepare,retrieve,complete,cancel}` callable with a `PgPool` (route logic moved down, not duplicated), `SqlDrivePermissionService::resolve_node_access_batch(...)`, and an `object-runtime` feature split (`backend-fs` / `backend-s3`) that cuts a metadata-only consumer by **366 packages** (1025 → 659).
- **News** — delivered: `list_published_items(tenant_id, limit)` (internal, tenant-scoped) and `list_published_items_public(limit)` (the public open surface, cross-tenant by design) on one port; the open route now delegates to it, and `sdkwork-feeds` registers the news source in-process by default (schema probe).

#### 4.2.6.1 Fixed

| Repository | Target module(s) | What changed |
| --- | --- | --- |
| `sdkwork-order` | account | Adapter defaults to the in-process store; HTTP is an explicit, startup-validated opt-in. |
| `sdkwork-order` | course | The periodic relay calls the course module's `CourseEntitlementGrantRepository` in-process on the shared pool; the URL/secret pair and `reqwest` were dropped from the service host. Idempotency (`purchase_ref` → enrollment idempotency key), batch size, interval and per-order error isolation preserved. |
| `sdkwork-community` | membership, order | In-process ports on the shared pool by default (membership repository + `OrderManagementDetailQuery`); HTTP survives only in `commerce_http.rs` behind an explicit, startup-validated opt-in. |
| `sdkwork-course` | drive | `InProcessDriveCoursePort` reproduces the drive route's tenant scope, active node/space, `reader` ACL, 30–300 s grant TTL and token signing; the HTTP adapter is opt-in only. |
| `sdkwork-appstore` | drive, search, iam | In-process drive/search ports with the same tenant scoping and reader ACL; `APPSTORE_IAM_BASE_URL` was dead config and is deleted; the module now boots with **no** sibling endpoint configuration. |
| `sdkwork-knowledgebase` | drive, memory | The drive HTTP transport was deleted outright (the embedded path already existed); memory defaults to `in_process` and `http` requires a valid base URL at bootstrap. |
| `sdkwork-im` | portal, community | Both were false positives with a real smell behind them: the portal URL is the browser-visible origin injected into the PC shell (CSP/HTML), now resolved only from this process's own published origin; `embedded_dependency_routes.rs` **mounts** sibling routes and merely wrote `SDKWORK_FEEDS_COMMUNITY_OPEN_API_BASE_URL` so the feeds HTTP adapter could loop back — the read/write and the feeds dependency were deleted, community is called in-process. |
| `sdkwork-feeds` | community, news | Community source reads `CommunitySqlxStore::list_feed` in-process on the shared pool with the same `approved_only`, stream-key filters, ordering and page clamp. **News is blocked**: no sibling published-item port exists, so no news adapter is registered by default and the exact port signature is recorded below. |
| `sdkwork-forum` | drive, search | Drive reads and download grants in-process (`find_active_node`/`find_active_space` + `reader` ACL + 30–300 s grant TTL); search goes through `PostgresqlSearchProvider` with one shared payload DTO for both transports. `SDKWORK_FORUM_DRIVE_URL` was a logging no-op and is deleted; only search keeps an opt-in HTTP mode (`SDKWORK_FORUM_SEARCH_MODE=http`), validated at startup. |
| `sdkwork-mail` | drive | In-process attachment port on the host pool: active node/space lookup plus the message owner's `reader` ACL, validated **before** the message row is written. Attachments are Drive node references, so there is no upload path to port. `SDKWORK_MAIL_DRIVE_MODE=http` is the only opt-in. |
| `sdkwork-canvas` | drive | Port rewritten in-process: create via `DriveUploaderService::upload_bytes`, read/list via node-version + storage-object stores with `reader`/`writer` ACL, tenant quota, and chunked integrity-checked reads. **Page-content update/restore fail closed** pending the two Drive APIs recorded above. |
| `sdkwork-deployments` | drive, knowledgebase | Website-root create/re-read, provider-event delivery and KB active-publication reads now run in-process on the host pool (KB's own store is `AnyPool`-only). The Drive **upload-session** finalisation has no Service-level API, so it is never a default: production-like profiles refuse to boot without an explicit HTTP opt-in. **[Superseded by the drive upload-session API — see `sdkwork-webserver` note.]** |
| `sdkwork-webserver` | drive, knowledgebase | Website rendering reads Drive (`get_root` + resource resolution + ranged object reads with the same 304/412/416/integrity semantics) and KB's `KnowledgeWikiPublicProviderService` in-process; the three `deploy.*` URL fields were dead config and are deleted. Provider mode is an explicit opt-in (`SDKWORK_WEBSERVER_*_PROVIDER_MODE=http`), validated at startup. **Platform note**: this repository cannot be `cargo check --workspace`-verified on Windows — `data_plane/socket_activation.rs` and `protocol_pool.rs` use `std::os::unix` in baseline code; Linux CI is required for that gate. |
| `sdkwork-browser` | llm | LLM calls moved behind an explicit adapter. **Final state: HTTP is the default** because `sdkwork-llm` has no in-process completion implementation at all (see the decision below); `=in_process` is the opt-in and fails with an actionable message when no provider is injected. Startup validation guarantees no request-time 500 once an LLM path is enabled; rules mode still boots endpoint-free. Allowlisted with the Phase-2 reason. |
| `sdkwork-agents` | knowledgebase, memory | Both bridges moved to ports: in-process on the host pool, HTTP adapters extracted to `http_adapter.rs` and selected only by an explicit mode variable; result limits/ordering, tenant scoping and error kinds preserved. |
| `sdkwork-notes` | drive | Drive access split into adapters: `drive_in_process` (create via `upload_bytes`, ranged reads with integrity checks, `reader`/`writer` ACL, quota) plus an opt-in `drive_http_adapter`; the page-content mapping is shared rather than duplicated. |

#### 4.2.6.2 Remaining

| Repository | Target module(s) | Endpoint variables |
| --- | --- | --- |
| _(none)_ | — | — |

`sdkwork-cloudrouter` is **not** a violation: its `edge-runtime` is a separate edge process that terminates public traffic and proxies the gateway / backend-api / app-api / portal surfaces upstream. That is the §4.2.3 split-deployment exception, recorded with a written reason for each of its four upstream variables in `sdkwork-cloudrouter/specs/backend-module-call-boundary.allow.json`.

Out of scope for this rule (governed elsewhere): RPC endpoints (`RPC_SPEC.md`), service discovery, observability exporters, and browser-bundle (`VITE_*`) URL hand-off.

#### 4.2.7 Review checklist for an in-process migration

A module that replaces a sibling HTTP call with an in-process port `MUST` be reviewed against this checklist before it is considered done.

**Conformance**

- [ ] No sibling endpoint variable is read on the default path; any remaining read sits in an explicitly named `*_http_adapter` module and is covered by an allowlist entry with a reason.
- [ ] Library code has no `panic!`/`unwrap`/`expect` on a reachable path (`RUST_CODE_SPEC.md` §7).
- [ ] Errors map to the same kinds as the HTTP path, so HTTP status codes do not change.
- [ ] Tenant and organization scoping is preserved and comes from the request context, not from an environment default.
- [ ] Authorization checks the sibling route performed are reproduced by calling the sibling's own permission service — never re-implemented.
- [ ] Idempotency keys, batch sizes, intervals, timeouts and retry bounds are unchanged or stricter.
- [ ] Public API paths, response envelopes and permission requirements are unchanged.
- [ ] `Cargo.toml` uses workspace dependencies, declares `[lib].name` when the package name has a hyphen, and commits the regenerated `Cargo.lock`.

**Cohesion and coupling**

- [ ] The port lives in the layer that owns the decision (service or host composition), not inside a route handler or a bootstrap function.
- [ ] Business rules did not move into the adapter; the adapter only translates and delegates.
- [ ] No duplicated DTO mapping: the outbound HTTP DTO and the in-process DTO are not both maintained for the same concept.
- [ ] Dead configuration is deleted (env vars, topology entries, k8s manifests, runbooks, component specs), not left "just in case".
- [ ] The new crate follows the existing adapter family's shape (for example `sdkwork-order-integration-<target>`), rather than inventing a second pattern.

**Performance**

- [ ] The in-process path reuses the host connection pool; it does not open a second pool for one call.
- [ ] No per-item round trip where a set-based query is possible (no N+1 on batch paths).
- [ ] New queries have a supporting index or an existing one; capture the `EXPLAIN` for the main query.
- [ ] A heavyweight dependency is not pulled in for a single call: if the sibling crate drags native/TLS/SDK builds, consider depending on its narrower contract/repository crate.
- [ ] Batch sizes and page limits stay bounded, and a failure cannot stall the worker loop.

**Verification**

```bash
cargo check --workspace
cargo test -p <touched crates>
node sdkwork-specs/tools/check-backend-module-call-boundary.mjs --root <repo>
node sdkwork-specs/tools/check-rust-crate-naming-standard.mjs --root <repo>
node sdkwork-specs/tools/check-rust-manifest-standard.mjs --root <repo>
node sdkwork-specs/tools/check-rust-backend-composition.mjs --root <repo>
```

## 5. SDK Client Port Injection

Reusable modules separate what changes from what stays stable:

| Concern | Owner |
| --- | --- |
| Concrete SDK constructor, base URL, environment, deployment profile, runtime target, and endpoint selection | runtime/bootstrap |
| Generated app SDK package name and client class | application adapter |
| Generated backend SDK package name and client class | application adapter |
| Stable resource method surface such as `client.auth.sessions.create` | module SDK port |
| Business orchestration and normalization | module service |
| React UI and hooks | module UI/feature layer |

Rules:

- A shared module `MUST` accept generated SDK clients through typed ports instead of importing app-specific SDK packages directly.
- A shared module `MUST NOT` create concrete app/backend SDK clients inside UI components or service functions.
- The app SDK and backend SDK may come from different generated packages, but equivalent shared resources `MUST` use the same `tag + operationId` method tree.
- Runtime/bootstrap owns environment, standalone/cloud deployment profile,
  runtime target, endpoint selection, and token store wiring.
- Service modules may compose multiple SDK calls into one use case, but they `MUST NOT` hide missing SDK operations with raw HTTP fallbacks.
- Tests `MUST` prove the service works with fake clients that implement the same generated resource surface.

IAM example:

```ts
const isBackendAdminRuntime = classifyRuntimeSurface(config) === "backend-admin";

createIamRuntime({
  clients: {
    appbaseApp,
    appbaseBackend: isBackendAdminRuntime ? appbaseBackend : undefined,
    sdkClients: [
      productAppSdk,
      ...(isBackendAdminRuntime ? [productBackendSdk] : []),
    ],
  },
  config: {
    appId: "commerce-pc",
    deploymentProfile: "cloud",
    runtimeTarget: "browser",
    environment: "prod",
  },
  tokenStore,
});
```

Communication modules follow the same rule. IM and RTC consumers use the public packages `@sdkwork/im-sdk` and `@sdkwork/rtc-sdk`, whose active source workspaces are:

- `apps/sdkwork-im/sdks/sdkwork-im-sdk`
- `../sdkwork-rtc/sdks/sdkwork-rtc-sdk`

Deprecated `openchat` sources `MUST NOT` be used for new appbase modules.

## 5.1 UI Architecture Module Families

| Architecture | Canonical package family | Required spec |
| --- | --- | --- |
| Cross-architecture shared packages | `apps/sdkwork-<application-code>-common/packages/sdkwork-<capability>` | `APPLICATION_SPEC.md`, `MODULE_SPEC.md` |
| App PC React | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-<capability>` or `apps/sdkwork-<domain>-pc/packages/sdkwork-<domain>-pc-<capability>` in a domain repository | `APP_PC_ARCHITECTURE_SPEC.md`, then `APP_PC_REACT_UI_SPEC.md` |
| PC user console React | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-console-<capability>` | `APP_PC_ARCHITECTURE_SPEC.md`, then `APP_PC_REACT_UI_SPEC.md` |
| PC internal admin React | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-admin-<capability>` | `APP_PC_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` |
| H5 mobile React | `apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-<capability>` | `APP_H5_ARCHITECTURE_SPEC.md`, then `APP_MOBILE_REACT_UI_SPEC.md` |
| App Flutter | `apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_<capability>` | `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_FLUTTER_UI_SPEC.md` |
| Mini program app | `apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-<capability>` | `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, then `APP_MINI_PROGRAM_UI_SPEC.md` |
| Android native app | `apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-<capability>` | `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_ANDROID_NATIVE_UI_SPEC.md` |
| iOS native app | `apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-<capability>` | `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_IOS_NATIVE_UI_SPEC.md` |
| Harmony native app | `apps/sdkwork-<application-code>-harmony-mobile/packages/sdkwork-<application-code>-harmony-mobile-<capability>` | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_HARMONY_NATIVE_UI_SPEC.md` |
| Standalone backend/admin React | `apps/sdkwork-backend-react-web/packages/sdkwork-react-backend-<domain>` | `BACKEND_UI_SPEC.md` |

Rules:

- A UI module `MUST` choose the architecture package family through `UI_ARCHITECTURE_SPEC.md` before implementation.
- Legacy repository-root families such as `packages/pc-react/<domain>/`, `packages/common/<domain>/`, and `packages/mobile-react/<domain>/` are migration-only. New modules `MUST NOT` add them in domain multi-surface repositories.
- App-side and PC user console UI modules consume app SDK surfaces; PC internal admin and standalone backend/admin UI modules are `backend-admin` modules and consume backend SDK surfaces.
- Modules for different UI architectures may share contracts, generated SDK surfaces, service concepts, route ids, i18n keys, and design tokens, but must not import each other's UI components, routes, platform pages, widgets, or host implementations.
- PC internal admin and standalone backend React modules are `backend-admin` modules and must not be consolidated into a single backend business package. Split them by business domain, capability, and permission prefix.
- Catch-all backend/admin packages are forbidden for business pages, business services, repositories, route records, menu records, permission constants, and domain i18n.

## 6. Extension Points

Reusable modules `MUST` make variation explicit.

```ts
export interface IamModuleExtensions {
  passwordPolicy?: PasswordPolicyProvider;
  mfaProvider?: MfaProvider;
  organizationLabelProvider?: OrganizationLabelProvider;
  permissionCatalogProvider?: PermissionCatalogProvider;
}
```

Rules:

- Extension points `MUST` be interfaces, callbacks, providers, or adapters.
- Extension points `MUST` have deterministic fallback behavior.
- Extension points `MUST NOT` require consumers to monkey-patch generated SDK clients or overwrite internal files.
- Extensions that change API or database semantics require updates to `API_SPEC.md` or `DATABASE_SPEC.md`.

## 7. Module Documentation

Each reusable module `MUST` include:

- Capability and domain.
- Public exports.
- Required SDK client surface.
- Configuration inputs.
- Extension points.
- Security assumptions.
- Tests and verification command.
- Example integration in standalone and cloud application profiles when applicable.

## 8. Acceptance Checklist

- [ ] Module has one domain and one capability.
- [ ] Public contract is exported from `src/index.ts`.
- [ ] New composable modules declare layer role and port contracts in `component.spec.json`.
- [ ] Implementation follows `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, and only the language specs used by the module.
- [ ] Entry files do not contain unrelated business logic, persistence, provider adapters, and tests.
- [ ] Dependencies flow in the allowed direction.
- [ ] SDK clients are injected and typed.
- [ ] Concrete SDK constructors stay in runtime/bootstrap or application adapters.
- [ ] IAM application bootstrap stays in `@sdkwork/iam-application-bootstrap`; scripts remain thin wrappers.
- [ ] Standalone/cloud variation and runtime-target variation are hidden behind runtime/bootstrap.
- [ ] Extension points are explicit.
- [ ] Module tests use fake or generated SDK clients.
- [ ] Backend crates reach sibling modules in-process; no sibling-module HTTP endpoint is read from backend code (`MODULE_SPEC.md` §4.2).
- [ ] README documents integration and verification.
