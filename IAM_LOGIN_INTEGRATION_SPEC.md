# IAM Login Integration Standard

- Version: 1.1
- Scope: fast IAM login/session integration, `sdkwork-iam` auth modules, generated IAM app SDK wiring, route guards, logout behavior, Rust AppContext validation, Tauri/standalone/cloud runtime boundaries
- Related: `IAM_SPEC.md`, `API_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `SDK_SPEC.md`, `FRONTEND_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_PAD_ARCHITECTURE_SPEC.md`, `DESKTOP_APP_ARCHITECTURE_SPEC.md`, `SECURITY_SPEC.md`, `DEPLOYMENT_SPEC.md`, `TEST_SPEC.md`

This standard defines how SDKWork applications integrate IAM login and session validation without reimplementing auth flows in consuming applications.

`sdkwork-iam` owns reusable login, registration, token refresh, current session, logout, OAuth, QR login, password reset, IAM runtime metadata, and IAM runtime bootstrap through `@sdkwork/iam-app-sdk` generated from `sdkwork-iam-app-api`. Verification-code delivery and verification are owned by `sdkwork-messaging` and must be consumed through the generated messaging app SDK surface when IAM flows need them. Consuming applications compose these capabilities through IAM UI/runtime packages (`@sdkwork/auth-pc-react`, `@sdkwork/auth-runtime-pc-react`, `@sdkwork/iam-runtime`), the generated IAM app SDK client, and an injected messaging app SDK client for verification-code operations. `sdkwork-appbase` retains platform shell primitives only (`@sdkwork/appbase-pc-react`, workspace UI, routing); it does not own IAM SDK families or IAM HTTP authorities.

Cross-architecture SDK composition and global token-manager wiring follow `APP_SDK_INTEGRATION_SPEC.md`. This file owns the IAM-specific login/session behavior and security invariants.

## 1. Integration Position

Standard login architecture:

```text
app shell
  -> AuthGate / route guard
  -> sdkwork-iam auth UI/runtime
  -> app auth service facade
  -> @sdkwork/iam-app-sdk appbaseApp client
  -> global tokenManager shared by app-api SDK clients and explicit backend-admin backend-api SDK clients
  -> /app/v3/api/auth/* and /app/v3/api/iam/*
  -> protected app-api SDK clients and explicit backend-admin backend-api SDK clients
  -> Rust/Java business APIs validate dual tokens and AppContext
```

Rules:

- Applications `MUST` integrate IAM login through `sdkwork-iam` packages or approved wrappers.
- Applications `MUST` perform login, registration, current-session validation, refresh, logout, OAuth, QR auth, password reset, runtime metadata, and current-user self-service through `@sdkwork/iam-app-sdk`; verification-code delivery and verification `MUST` go through the generated messaging app SDK surface or an appbase wrapper that delegates to an injected messaging client. Applications must not inject unrelated business SDK clients as login clients.
- Applications `MUST` provide one global token manager per authenticated session context and pass the same instance to `@sdkwork/iam-app-sdk`, every application/dependency app SDK, explicit `backend-admin` `@sdkwork/iam-backend-sdk`, explicit `backend-admin` application/dependency backend SDKs, and approved composed wrappers backed by those SDKs.
- Applications `MUST` use the approved high-level IAM auth runtime/factory for the selected architecture when available, for example `@sdkwork/auth-runtime-pc-react` `createSdkworkAppbasePcAuthRuntime(...)` for PC React. A pad root uses the same React factory with the tablet host secure-storage adapter. Application code supplies app identity, runtime config, SDK inventory clients, the global token manager, and session bridge hooks; appbase owns the low-level IAM adapter wiring.
- Applications `MUST NOT` import `@sdkwork/iam-sdk-adapter`, call `createIamAppSdkAdapter(...)`, call `createIamBackendSdkAdapter(...)`, or call `createIamRuntime(...)` directly for appbase login integration when a high-level appbase runtime/factory exists. Those calls belong in `sdkwork-appbase` packages or approved appbase-owned wrappers only.
- Applications `MUST NOT` create local `/auth/login`, `/auth/refresh`, `/auth/me`, `/app/v3/api/auth/*`, or user-center session endpoints when the capability is already owned by `sdkwork-iam`, `sdkwork-iam-app-api`, or `sdkwork-iam-app-sdk`.
- Login/session APIs `MUST` live in app-api only. Open-api domains such as Craw Chat IM (`/im/v3/api`), backend-api, Tauri commands, and application-local Rust routes may validate credentials or session projections when their contract requires it, but must not own user-facing login creation.
- Auth services, controllers, reusable local adapters, canonical authority bridges, and runtime user-center bridges `MUST NOT` synthesize an authenticated SDKWork session from a user/profile object, user id, email, username, legacy user-center `sessionId`, cached user, QR key, bridge hint, or test helper. Every login, registration, OAuth, verification-code login, QR completion, session-bridge, refresh, current-session update, and bootstrap success path `MUST` receive and validate a real appbase IAM `SdkworkAuthSession` with non-empty `authToken` and `accessToken` before reporting authenticated state, writing session storage, or updating the global TokenManager. Unsupported modes, incomplete sessions, and user-only results `MUST` fail closed.
- Current-session bootstrap `MUST` call `@sdkwork/iam-app-sdk` `auth.sessions.current.retrieve()` when that SDK resource is available. If current-session validation fails, the runtime `MUST` clear centralized session storage, context storage, token manager state, and sensitive session bridges, then report anonymous state; it `MUST NOT` fall back to cached user/profile data or locally stored tokens.
- Registration and password-reset services `MUST` preserve literal password values, `MUST NOT` synthesize a missing confirmation by copying the password into `confirmPassword`, and `MUST` reject an explicitly provided password confirmation that differs from the password before calling SDK resources. UI confirmation checks do not replace this service/runtime boundary check, and backend handlers must enforce the same rule.
- Development verification-code configuration may prefill UI input fields only. It `MUST NOT` skip `messaging.verificationCodes.create`, `messaging.verificationCodes.verify`, password-reset request creation, registration creation, or session creation, and new configuration names should use `prefill` instead of `bypass`.
- Application-owned open-api SDKs `MUST` receive credentials through a declared open-api credential provider matching their contract auth mode (`api-key`, `oauth`, or `open-api-flexible`), not through the app login token manager.
- UI components `MUST NOT` call raw HTTP, manually assemble `Authorization` or `Access-Token`, parse JWTs for authorization, or store duplicate token DTOs.
- Application/dependency app SDKs and explicit `backend-admin` backend SDKs `MUST NOT` own login, parse tokens, refresh tokens independently, or persist second session state; they only consume the global token manager for request authentication.
- Protected business services `MUST` consume a verified session projection through typed context, not through body/query tenant or user fields.

## 2. Standard Packages

Use the smallest package set needed for the target UI architecture.

| Concern | Standard package or layer | Responsibility |
| --- | --- | --- |
| Appbase shell primitives | `@sdkwork/appbase-pc-react` or architecture equivalent | capability manifest, appbase layout/runtime utilities |
| PC auth UI | `@sdkwork/auth-pc-react` | login/register/forgot-password/OAuth/QR auth routes and forms |
| IAM runtime | `@sdkwork/iam-runtime` | `createIamRuntime`, token/context stores, `getAuthHeaders`, appbase SDK validation, global token-manager binding |
| Architecture auth runtime | `@sdkwork/auth-runtime-pc-react` or architecture equivalent | approved high-level appbase runtime factory that applications call instead of wiring low-level IAM SDK adapters |
| PC IAM provider | `@sdkwork/iam-react` | `IamRuntimeProvider`, `IamProvider`, `useIamRuntime`, `useIamService` |
| PC IAM core export | `@sdkwork/iam-core-pc-react` | PC React re-export boundary for IAM runtime, stores, adapters, ports, contracts, and services |
| IAM contracts | `@sdkwork/iam-contracts` | token header names, IAM route constants, context contracts |
| IAM SDK ports | `@sdkwork/iam-sdk-ports` | generated SDK client shapes without app-specific constructors |
| IAM SDK adapter | `@sdkwork/iam-sdk-adapter` | strict envelope/call-shape adapter over standard IAM app/backend/open SDK resources |
| Application core package | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-core` or equivalent | SDK bootstrap, session store, auth service facade, IAM runtime bridge |

## 2.2 Capability Package Catalog Composition And Dedupe

Some high-level IAM integration factories compose capability packages (appbase, shell, and product packages) into a capability registry. Modern capability registries may treat duplicate capability package names as fatal (for example `Duplicate capability package: @sdkwork/shell-pc-react`), because duplicates can hide mismatched manifests or dependency drift.

Rules:

- High-level IAM integration factories that accept optional extra package lists (for example `extraPackageNames`) **MUST treat those inputs as idempotent**. Passing a package name that is already included by a default preset **MUST NOT** crash the consuming application.
- Consuming applications **MUST NOT** add shell-level capability packages (for example `@sdkwork/shell-pc-react`) to `extraPackageNames`. Shell capabilities are owned by the shell/runtime and may already be included by appbase presets.
- Consuming applications **MAY** add product capability packages (for example `@sdkwork/im-pc-react`) to `extraPackageNames` when those packages provide product-owned capability manifests. Product packages must not re-export or alias shell capability packages.
- If an upstream factory does not yet de-dupe package names, consuming applications **MUST** add a compatibility guard: catch the duplicate-capability startup error and retry without optional extra packages. This is a temporary bridge to keep apps running while catalogs are refactored; the preferred long-term fix remains making the factory inputs idempotent.

Rationale:

- Duplicate capability packages are frequently introduced by split-brain catalogs (a shell capability is included by a preset and then re-included via an extra list).
- Treating duplicates as fatal surfaces inconsistent dependency graphs early, but factories must still tolerate idempotent inputs to avoid breaking downstream apps during catalog refactors.

## 2.1 Canonical `sdkwork-iam` Package Roots

| npm package | Repository path under `sdkwork-iam` |
| --- | --- |
| `@sdkwork/iam-contracts` | `apps/sdkwork-iam-common/packages/sdkwork-iam-contracts` |
| `@sdkwork/iam-runtime` | `apps/sdkwork-iam-common/packages/sdkwork-iam-runtime` |
| `@sdkwork/iam-sdk-ports` | `apps/sdkwork-iam-common/packages/sdkwork-iam-sdk-ports` |
| `@sdkwork/iam-sdk-adapter` | `apps/sdkwork-iam-common/packages/sdkwork-iam-sdk-adapter` |
| `@sdkwork/iam-service` | `apps/sdkwork-iam-common/packages/sdkwork-iam-service` |
| `@sdkwork/auth-pc-react` | `apps/sdkwork-iam-pc/packages/sdkwork-auth-pc-react` |
| `@sdkwork/auth-runtime-pc-react` | `apps/sdkwork-iam-pc/packages/sdkwork-auth-runtime-pc-react` |
| `@sdkwork/iam-react` | `apps/sdkwork-iam-pc/packages/sdkwork-iam-react` |
| `@sdkwork/iam-app-sdk` | `sdks/sdkwork-iam-app-sdk/.../generated/server-openapi` |
| `@sdkwork/iam-backend-sdk` | `sdks/sdkwork-iam-backend-sdk/.../generated/server-openapi` |

Consumer workspace wiring `MUST` follow `DEPENDENCY_MANAGEMENT_SPEC.md` §3.1.
| Appbase app SDK | `@sdkwork/iam-app-sdk` | canonical login, session, runtime metadata, OAuth, QR auth, password reset, and current-user transport |
| Messaging app SDK | generated `sdkwork-messaging-app-sdk` surface | verification-code delivery and verification through `messaging.verificationCodes.*` |
| Appbase backend SDK | `@sdkwork/iam-backend-sdk` | canonical `backend-admin` IAM management transport |
| Application-owned app/backend SDKs | generated app-api SDKs and explicit `backend-admin` backend-api SDKs | protected business operations that receive the global token manager only |
| Dependency app/backend SDKs | generated dependency app-api SDKs and explicit `backend-admin` backend-api SDKs | dependency-owned protected operations such as Drive, Messaging, IM, or other reusable app SDK capabilities that receive the same global token manager only |
| Application-owned open-api SDKs | generated open-api SDKs | protected public/domain operations that receive API key and/or OAuth bearer credentials per their declared auth mode |
| Rust AppContext crate | product-independent context helper crate | dual-token and SDKWork AppContext extraction/validation |

Rules:

- Appbase packages own reusable IAM UI and auth flow behavior.
- Application core packages may adapt generated `@sdkwork/iam-app-sdk` constructors, generated `@sdkwork/iam-backend-sdk` constructors, token storage, and runtime config, but must not fork appbase auth UI, generated SDK output, or appbase login method names.
- IAM SDK adapters `MUST` be strict adapters over the standard appbase SDK resource surface. They may unwrap SDK envelopes and normalize generated path-parameter call shapes, but they `MUST NOT` map legacy or application-local methods such as `auth.login`, `auth.refreshToken`, `auth.register`, `auth.getOauthUrl`, `auth.createSendSmsCode`, `user.getUserProfile`, or app-local user-center methods into appbase login/session ports. Application packages do not depend on these adapters directly when an appbase high-level auth runtime/factory exists.
- Generated SDK output `MUST NOT` be edited by app or desktop packages.
- If an IAM SDK method is missing, fix `sdkwork-iam-app-api` or `sdkwork-iam-backend-api`, OpenAPI, and generator inputs before adding product integration.

## 3. Fast App Integration

Minimum app-side steps:

1. Add appbase and IAM package aliases or workspace dependencies.
2. Create one global token manager for the authenticated session context.
3. Create one session module that reads, writes, normalizes, and clears `authToken`, `accessToken`, `refreshToken`, `sessionId`, `user`, and `context`.
4. Create `@sdkwork/iam-app-sdk` as `appbaseApp` in bootstrap/core code. Create `@sdkwork/iam-backend-sdk` as `appbaseBackend` only when the runtime is an explicit `backend-admin` surface.
5. Build an SDK inventory, then pass every authenticated application/dependency app-api SDK and every explicit `backend-admin` backend-api SDK through `clients.sdkClients` or the local equivalent so the same global token manager is injected.
6. Pass protected open-api SDK clients through a separate open-api credential provider matching their declared auth mode (`api-key`, `oauth`, or `open-api-flexible`).
7. Use appbase auth UI/runtime packages or an approved high-level appbase auth integration wrapper for login, registration, refresh, OAuth, QR auth, password reset, runtime metadata, and current-user self-service.
8. Create only the application-specific runtime bridge needed for bootstrap/logout/current-session handoff, when appbase UI/runtime cannot consume those ports directly.
9. Wrap product routes with an `AuthGate`.
10. Verify logout clears local session state, the global token manager, realtime clients, sensitive caches, and redirects to login.

Standard PC React shape:

```text
apps/sdkwork-<application-code>-pc/
  src/
    App.tsx
    AuthGate.tsx
  packages/
    sdkwork-<application-code>-pc-core/
      src/sdk/session.ts
      src/sdk/appSdkClient.ts
      src/sdk/appAuthService.ts
      src/sdk/appAuthRuntime.ts
```

Rules:

- `App.tsx` owns router composition only.
- `AuthGate.tsx` owns route protection and rendering appbase auth routes.
- `session.ts` owns persisted session normalization and clearing.
- `appSdkClient.ts` owns SDK inventory classification, `@sdkwork/iam-app-sdk`, optional `backend-admin` `@sdkwork/iam-backend-sdk`, application/dependency SDK construction, and global TokenManager injection.
- `appAuthService.ts` may expose only application-specific auth bridges such as current-session bootstrap and logout when needed. It `MUST NOT` re-map or reimplement appbase-owned login, registration, refresh, verification-code, OAuth, QR auth, password reset, runtime metadata, or current-user self-service operations.
- `appAuthRuntime.ts` consumes an approved appbase high-level auth runtime/factory when available. Application-root code provides app identity, runtime config, injected SDK clients, the global TokenManager, and session bridge hooks instead of implementing appbase IAM adapter behavior locally.

Standard TypeScript runtime shape implemented by appbase packages and high-level wrappers:

```ts
const tokenManager = createTokenManager();
const isBackendAdminRuntime = classifyRuntimeSurface(config) === "backend-admin";

const runtime = createIamRuntime({
  clients: {
    appbaseApp,
    appbaseBackend: isBackendAdminRuntime ? appbaseBackend : undefined,
    sdkClients: [
      productAppSdk,
      dependencyAppSdk,
      ...(isBackendAdminRuntime ? [productBackendSdk, dependencyBackendSdk] : []),
    ],
  },
  config,
  tokenManager,
  tokenStore,
  contextStore,
});
```

Rules:

- `createIamRuntime(...)` `MUST` create or receive the global `AuthTokenManager`.
- `clients.appbaseApp` is required. `clients.appbaseBackend` is optional and only used when `backend-admin` IAM management is part of the runtime.
- `clients.sdkClients` contains downstream authenticated application/dependency app-api SDK clients, explicit `backend-admin` backend-api SDK clients, plus approved composed wrappers backed by those SDKs. It does not contain protected open-api SDKs.
- The runtime `MUST` bind the same token manager to every client with `setTokenManager(manager)`.
- The runtime `MUST` hydrate the token manager from `tokenStore` when in-memory tokens are empty.
- `contextStore` `MUST` persist returned `AppContext` and derive or expose `ShardingContext` when the platform provides that helper.

## 4. AuthGate Rules

An AuthGate is the application entry boundary between anonymous auth routes and protected product routes.

Required behavior:

```text
bootstrap persisted session
  -> retrieve current session when possible
  -> if protected route and no valid session, redirect to /auth/login?redirect=<target>
  -> if auth route and valid session, redirect to requested target or home
  -> render product routes only after authenticated session is confirmed
  -> render appbase IAM auth routes for anonymous auth paths
```

Rules:

- AuthGate `MUST` re-read persisted session state after route changes, logout, refresh failure, tenant switch, organization switch, and account switch.
- AuthGate `MUST` treat in-memory state and persisted session state as a pair. A stale in-memory session is not enough after logout.
- Auth routes `SHOULD` use a stable base path such as `/auth`.
- Redirect targets `MUST` be normalized to prevent loops back into auth routes.
- Loading state must not reveal protected data.
- Appbase auth routes receive runtime, runtime config, locale, appearance, base path, and home path from product bootstrap, not from feature packages.

## 5. Session And Token Rules

SDKWork protected app-api and backend-api operations use a dual-token model. Protected open-api operations use the auth mode declared by their API contract (`api-key`, `oauth`, or `open-api-flexible`) and do not participate in app login/session creation.

| Token | Transport | Purpose |
| --- | --- | --- |
| `authToken` | `Authorization: Bearer <auth_token>` | principal identity, session identity, tenant, organization, login scope, auth strength, expiry |
| `accessToken` | `Access-Token: <JWT access_token>` | principal identity, session identity, tenant, organization, login scope, app, environment, deployment profile, runtime target, data scope, permission scope |
| `refreshToken` | app-auth refresh operation only | refresh/rotation; never used for normal business APIs |

Rules:

- Session storage `MUST` be centralized in a core/session module.
- Interactive SDKWork application sessions `MUST` default to a 30-day retention window. Refresh rotates the session and starts a new 30-day window; explicit logout, revocation, credential reset, account disablement, tenant disablement, and security-policy overrides may end it earlier.
- Browser refresh and application restart `MUST` restore the centralized session before `AuthGate` decides whether to render protected routes. A valid persisted session must not be treated as anonymous merely because the in-memory TokenManager was recreated.
- The centralized session store `MUST` persist the complete rotating session, including `refreshToken`. Browser applications use app-scoped durable storage; desktop and native mobile hosts `MUST` use OS-backed secure storage such as Keychain, Keystore, or a platform credential vault for long-lived refresh credentials. Plaintext native Preferences, SharedPreferences, NSUserDefaults, and feature-owned state are forbidden for refresh-token persistence.
- TypeScript applications `SHOULD` use `@sdkwork/iam-runtime` `createPersistentIamTokenStore(...)` or an architecture-specific secure wrapper with the same contract instead of authoring another token-store format.
- Applications `MUST` create exactly one global token manager per authenticated session context.
- Login/session-creation requests `MUST NOT` send an existing user session, API key, OAuth bearer, ingress/agent token, or SDKWork context-projection headers to select tenant or organization. Credential-entry starts without a user session, but it uses the application bootstrap `Access-Token` to establish validated app/tenant isolation before IAM resolves the real user and organization context.
- Appbase login, registration, OAuth session creation, QR scan/password completion, password reset request, and password reset completion OpenAPI operations `MUST` declare `security: [{ AccessToken: [] }]`, `x-sdkwork-auth-mode: credential-entry-bootstrap`, and `x-sdkwork-forbid-credential-headers: true`, unless the IAM authority explicitly classifies an operation as pure anonymous or refresh-token proof. Browser QR login operations `oauth.deviceAuthorizations.create`, `oauth.deviceAuthorizations.retrieve`, and `oauth.deviceAuthorizations.sessionExchanges.create` are pure anonymous: they `MUST` declare `security: []` and `x-sdkwork-auth-mode: anonymous`, and generated SDKs `MUST` dispatch them without requiring or sending `Access-Token` or `Authorization`. Generated credential-entry SDK calls `MUST` send only the bootstrap `Access-Token`, fail before network dispatch when it is absent, and appbase servers `MUST` reject every credential or context header outside the selected profile allowlist.
- `authToken` and `accessToken` returned by appbase login/session APIs `MUST` both carry `tenant_id`, `organization_id`, `login_scope`, `user_id`, and `session_id` claims. Client-side code may decode token claims for diagnostics only; authorization and routing decisions `MUST` rely on appbase session validation and returned `AppContext`.
- Credential-entry SDK calls send only bootstrap `Access-Token`. Protected dual-token SDK calls send the authenticated session `Access-Token` and `Authorization`; anonymous and refresh-token operations send neither.
- Protected dual-token SDK clients `MUST` send `Access-Token: <JWT access_token>` and `Authorization: Bearer <auth_token>` together. A partial pair fails before or at the framework authentication stage and never degrades into a public or bootstrap profile.
- When both `authToken` and `accessToken` are present, server-side dual-token resolution `MUST` treat overlapping principal and tenancy claims from `authToken` as authoritative. Client runtimes `MUST` keep both tokens in sync through the single TokenManager and `MUST NOT` override token-derived scope with request fields.
- Runtime session normalization `MUST` reject complete-looking sessions whose
  `authToken`, `accessToken`, and returned `AppContext` disagree on tenant,
  organization, user, session, app, environment, deployment profile, runtime
  target, or login scope.
- `@sdkwork/iam-app-sdk`, application/dependency app SDKs, explicit `backend-admin` `@sdkwork/iam-backend-sdk`, explicit `backend-admin` application/dependency backend SDKs, and approved composed wrappers backed by those SDKs `MUST` receive the same global token manager through generated SDK config, `setTokenManager`, credential provider, constructor injection, or approved adapter.
- In the TypeScript appbase IAM runtime, the standard downstream client list is `clients.sdkClients`. Older or app-local names such as `appBackendSdkClients` may exist only as compatibility aliases that are normalized into `clients.sdkClients` before calling `createIamRuntime`.
- Login, registration, OAuth session creation, current-session retrieval/update, refresh, and session restoration `MUST` update the global token manager, centralized session store, and AppContext/context store together before the API call is reported as completed to UI/runtime code.
- Session side effects `MUST` be ordered: first validate the appbase session payload, then persist normalized tokens in the centralized session store, then write the returned AppContext to the context store or clear stale AppContext when the session has no context, and only then sync the global token manager. A failed token persistence step `MUST NOT` leave a new in-memory token manager state behind. A failed context propagation step after token persistence `MUST` clear the token store, context store, and global token manager before the API call rejects.
- New session flows such as login, registration, and OAuth session creation `MUST` replace the stored token set and `MUST NOT` inherit an old `refreshToken` when appbase does not return one. Current-session retrieval/update and refresh continuation may preserve the current stored `refreshToken` only when appbase returns rotated `authToken`/`accessToken` without a new `refreshToken`.
- Current-session retrieval is a validation flow, not a local cache restoration shortcut. When `auth.sessions.current.retrieve()` is available, the authenticated state is valid only after that SDK call returns a complete dual-token appbase session; failure or incomplete payload clears local session state and remains anonymous.
- Reusable auth UI and service packages `MUST` expose a `commitSession(session, options?)` hook, not `persistSession`. The session passed to `commitSession` `MUST` be the normalized committed session after continuation refresh-token rules have been applied.
- `commitSession(session)` is allowed only for new session flows. `commitSession(session, { preserveRefreshToken: true })` is allowed only for current-session bootstrap, current-session update, refresh continuation, and equivalent session restoration flows.
- `commitSession` `MUST` be awaited before auth service, runtime, route guard, or UI controller APIs resolve. If a custom committer returns a committed session, the runtime reports that normalized return value. If it returns `void`, the runtime reports the standard committed session it computed before invoking the committer.
- Logout clearing is a two-level `finally` rule: the service/runtime clears persisted tokens, global token manager, context store, realtime/session bridges, and sensitive caches even when remote session deletion fails; the UI/controller clears in-memory authenticated state even when service logout rejects after local cleanup.
- The global token manager is the app-api SDK and explicit `backend-admin` backend-api SDK login-retention standard. Application and dependency app SDKs and explicit `backend-admin` backend SDKs `MUST NOT` maintain independent token stores, independent TokenManagers, or refresh flows. Application open-api SDKs manage credentials through their declared open-api credential provider and `MUST NOT` treat API keys or OAuth bearer tokens as app login sessions.
- Frontend code outside SDK/bootstrap `MUST NOT` set `Authorization`, `Access-Token`, `X-Sdkwork-*`, or equivalent auth headers manually.
- `authToken`, `accessToken`, and `refreshToken` `MUST NOT` be logged, copied into URLs, exposed in UI, or saved in application feature state.
- Application roots `MUST` document private bootstrap `SDKWORK_ACCESS_TOKEN` in env templates when protected app-api or backend-api surfaces are consumed. Service-context runtimes `SHOULD` configure it before interactive login. Browser/renderer runtimes `MUST` obtain session tokens from sdkwork-iam and TokenManager storage instead of public env.
- Token refresh failure `MUST` clear the global token manager, session store, context store, realtime/session bridges, sensitive caches, and route to login through a single runtime clearing path.
- Logout `MUST` call `@sdkwork/iam-app-sdk` `client.auth.sessions.current.delete()` when possible, then clear local state in a `finally` path even when the remote delete fails.

Standard logout effects:

```text
appbaseAppClient.auth.sessions.current.delete()
  -> clear in-memory auth controller/session state in finally
  -> clear persisted session
  -> clear the global token manager
  -> close/reconnect realtime clients as anonymous
  -> clear sensitive query/cache state
  -> clear native secure session state when used
  -> navigate to /auth/login or configured login entry
```

### 5.1 Login Context Selection Protocol

The standard login endpoint may complete immediately or return a continuation state when the verified user belongs to one or more organizations in the resolved tenant.

Flow:

```text
pre-session credential-entry request with bootstrap Access-Token tenant isolation
  -> appbase scopes credential verification to bootstrap tenant_id
  -> appbase validates credentials within that tenant
  -> appbase resolves real user_id from IAM data
  -> appbase reads active iam_organization_membership rows
  -> appbase excludes platform sentinel organization id "0" from login-eligible memberships
  -> zero login-eligible organizations: return TENANT-scoped dual-token session with organizationId "0"
  -> one or more login-eligible organizations: return LOGIN_CONTEXT_SELECTION challenge
  -> app UI shows personal vs organization login choices
  -> user selects personal login (TENANT + organizationId "0") or an organization (ORGANIZATION + non-zero organizationId)
  -> appbase validates the choice and returns final dual-token session
```

Rules:

- Consuming applications `MUST` treat a login-context challenge as an authenticated-login continuation, not as a normal authenticated session. They `MUST NOT` update the global token manager, protected SDK clients, or route guard as authenticated until appbase returns the final dual-token session.
- Credential-entry login and registration `MUST` send bootstrap `Access-Token` through the SDK credential hook. Applications `MUST NOT` present tenant-selection UI for these flows; tenant scope is fixed before credential verification.
- The login-context UI may be a modal, route, or equivalent focused surface. It `MUST` display the personal-login option and only the safe organization choices returned by appbase, then submit the selected context through the generated appbase app SDK continuation method.
- Login-context continuation credentials `MUST NOT` be used as `authToken` or `accessToken` for application/dependency APIs. They are short-lived, single-purpose credentials for the continuation endpoint only.
- Consuming applications `MUST NOT` choose the first organization client-side, cache a login-context choice across users, or derive organization id from route/query/local storage without appbase validation.
- Personal login (`loginScope = "TENANT"`, `organizationId = "0"`) and organization login (`loginScope = "ORGANIZATION"`, non-zero `organizationId`) are both first-class outcomes. UI `MAY` highlight a primary organization, but `MUST NOT` auto-complete organization login without explicit user action.
- Organization id `"0"` is the platform personal-login sentinel. It `MUST NOT` appear in login-context `organizations[]`, `MUST NOT` be accepted by legacy organization-selection continuation with `loginScope = "ORGANIZATION"`, and `MUST` be serialized consistently in session `AppContext`, JWT claims, and token coherence checks for TENANT sessions.
- Login-eligible organization membership excludes sentinel `"0"` even when bootstrap data retains a root-organization row for directory seeding.
- Switching login context after authentication is a current-session update flow. It `MUST` use `PATCH /app/v3/api/auth/sessions/current` with `loginScope` and/or `organizationId`, then replace token/context state atomically. Sending `organizationId = "0"` without `loginScope` `MUST` switch back to personal login.
- Legacy `ORGANIZATION_SELECTION` challenge handling `SHOULD` migrate to `LOGIN_CONTEXT_SELECTION`. Compatibility aliases may remain until all consuming apps are updated.
- PC (`@sdkwork/auth-pc-react`), pad (`@sdkwork/auth-pc-react` with tablet host secure storage), H5 (`@sdkwork/iam-h5-auth`), and Flutter mobile (`sdkwork_iam_flutter_mobile_auth`) `MUST` consume the shared login-context helpers from `@sdkwork/iam-contracts` / `@sdkwork/iam-service` and `MUST NOT` fork organization id `"0"` handling locally.

### 5.2 Authenticated Session Recovery Protocol

Sharing a TokenManager does not by itself provide refresh or unauthorized-response recovery. Every interactive authenticated runtime `MUST` compose one session recovery coordinator with the global TokenManager and appbase refresh authority.

Rules:

- Application-owned SDKs, dependency SDKs such as Drive and Messaging, approved composed wrappers, uploads, SSE, WebSocket, and other authenticated transports `MUST` use the same session recovery coordinator for one authenticated session context. They `MUST NOT` implement independent refresh flows.
- Concurrent protected requests that detect an expired session or receive HTTP `401` / platform code `40101` `MUST` coalesce into one in-flight appbase refresh operation. Waiting requests and realtime transports `MUST` pause until that operation completes.
- After a successful refresh, a safe or idempotent read operation `MAY` be replayed at most once with credentials read again from the global TokenManager. A mutation `MUST NOT` be replayed automatically unless its generated SDK operation exposes and the caller supplied the contract-authorized idempotency or concurrency precondition.
- A failed refresh, a second `401` after the one allowed refresh, or an incomplete refreshed dual-token session `MUST` enter the single terminal clearing path from section 5: clear token, session, context, realtime/session bridges, sensitive caches, and native secure storage when present, then route to login according to the runtime policy.
- HTTP `401` `MUST NOT` enter generic retry or realtime reconnect backoff before session recovery runs. HTTP `403` `MUST NOT` trigger token refresh. Deterministic client errors such as `400`, `404`, and `422` `MUST NOT` be retried without a contract-specific correction. `408`, `429`, network failures, and retryable `5xx` responses may use the bounded retry policy declared by the SDK or transport.
- SDK and realtime errors `MUST` preserve standard `ProblemDetail` status, numeric `code`, `detail`, and `traceId` through the service boundary. A transport `MUST NOT` reduce an authenticated HTTP failure to a status-only string when a valid problem-detail body is available.
- SSE and WebSocket reconnect attempts `MUST` resolve credentials again from the global TokenManager after refresh. They `MUST` stop reconnecting after terminal session clearing or a deterministic non-retryable `4xx` response.
- The TokenManager contract owns credential storage, validity inspection, and token updates. Refresh orchestration, single-flight coordination, replay policy, terminal clearing, realtime pause/resume, and login routing belong to the session recovery coordinator or the approved high-level IAM runtime.

## 6. Rust Protected API Standard

Rust services that expose protected business APIs normally validate IAM sessions; they do not own login.

Standard Rust HTTP guard:

```text
request
  -> allow explicitly public routes only
  -> require Authorization: Bearer <auth_token>
  -> require Access-Token: <JWT access_token>
  -> verify dual-token claims or resolve them through a trusted server-side session lookup
  -> build WebRequestContext and typed AppContext at the sdkwork-web-framework boundary
  -> insert typed context into request extensions
  -> handlers consume typed context, not raw headers
```

Rules:

- Rust business routes `MUST` reject requests that lack a valid dual-token-derived context.
- Public routes `MUST` be explicitly listed, for example health, readiness, OpenAPI, static public metadata, or documented public bootstrap routes.
- Rust handlers `MUST` consume a typed `WebRequestContext` or `AppContext` extractor/extension injected by the framework middleware chain.
- Rust handlers `MUST NOT` parse tokens, tenant IDs, user IDs, or permission scopes directly.
- Request body, path, and query values `MUST NOT` override verified AppContext tenant, organization, user, actor, permission, or data scope.
- Error responses `MUST` use the standard problem-detail shape and stable auth/context error codes.

Recommended Rust modules:

```text
crates/<domain>-app-context/
  src/lib.rs
  tests/app_context_test.rs

services/<service>/
  src/auth_guard.rs
  src/context.rs
  src/routes.rs
  tests/auth_guard_test.rs
```

## 7. Forbidden AppContext Header Projection

SDKWork v3 request context is token-derived. A runtime, SDK, gateway, test helper, smoke script,
or document `MUST NOT` define, send, forward, sign, or generate AppContext projection headers for
tenant, organization, user, actor, session, app, device, data scope, permission scope, or equivalent
identity fields.

Forbidden client request headers include, but are not limited to:

- `x-sdkwork-tenant-id`
- `x-sdkwork-organization-id`
- `x-sdkwork-user-id`
- `x-sdkwork-actor-id`
- `x-sdkwork-actor-kind`
- `x-sdkwork-session-id`
- `x-sdkwork-app-id`
- `x-sdkwork-environment`
- `x-sdkwork-deployment-profile`
- `x-sdkwork-deployment-mode`
- `x-sdkwork-runtime-target`
- `x-sdkwork-auth-level`
- `x-sdkwork-data-scope`
- `x-sdkwork-permission-scope`
- `x-sdkwork-device-id`
- `x-sdkwork-context-signature`

Rules:

- Protected app-api and backend-api calls `MUST` send only `Authorization: Bearer <JWT auth_token>` and `Access-Token: <JWT access_token>` through the global TokenManager or equivalent credential hook.
- Servers `MUST` derive tenant, organization, user, actor, session, app,
  environment, deployment profile, runtime target, auth level, data scope, and
  permission scope from verified `auth_token` and `access_token` claims or a
  trusted server-side token/session lookup.
- Public Rust services `MUST` verify `authToken` and `accessToken` directly or resolve them through a trusted server-side token/session lookup before protected handlers run.
- Appbase HTTP routers `MUST` use the framework `WebRequestContextResolver` to build `WebRequestContext` and insert it into request extensions for route handlers according to `WEB_FRAMEWORK_SPEC.md`.
- SDKs and app runtimes `MUST` use the global TokenManager or equivalent credential hook to send only the standard dual-token credentials for protected app-api/backend-api calls.
- AppContext header builders, context-projection signing helpers, and tests that assert context header forwarding are forbidden technical debt.
- Permission checks use token claims, server-side permission lookup, or a typed policy service. Legacy scope headers `MUST NOT` grant permissions.
- Context values in request body, path, query, mutable frontend state, or custom metadata are hints only and never override token-derived context.

## 7.1 Forbidden IAM Bootstrap Environment Variables

Runtime identity scope `MUST` come from verified dual-token JWT claims after register/login, refresh, or current-session validation. Applications, IAM authorities, SDK bootstrap code, dev wrappers, and documentation `MUST NOT` inject fixed tenant, organization, app, user, or owner credentials through environment variables or public runtime config.

Forbidden runtime identity bootstrap variables include, but are not limited to:

- `SDKWORK_IAM_BOOTSTRAP_*`
- `SDKWORK_IAM_LOCAL_*`
- `SDKWORK_USER_CENTER_BOOTSTRAP_*`
- `SDKWORK_APP_ID`, `VITE_SDKWORK_APP_ID`, `VITE_APP_ID`, and equivalent runtime env keys used to override current tenant, organization, user, session, or app scope
- `SDKWORK_IAM_BOOTSTRAP_TENANT_ID`, `SDKWORK_IAM_BOOTSTRAP_ORGANIZATION_ID`, `SDKWORK_IAM_BOOTSTRAP_EMAIL`, `SDKWORK_IAM_BOOTSTRAP_PASSWORD`, and equivalent fixed owner or directory seed variables

Rules:

- `tenant_id`, `organization_id`, `user_id`, `session_id`, and current app scope `MUST` be read from `authToken` and `accessToken` claims or from a trusted server-side token/session lookup after login.
- When both `authToken` and `accessToken` are present, overlapping principal and tenancy claims `MUST` be resolved from `authToken` first. Contradictory overlapping values in `accessToken` `MUST` fail validation.
- Application IAM runtime metadata such as compile-time manifest `app.key` or an equivalent static application identifier `MAY` identify the application client to appbase before login, but it `MUST NOT` replace token-derived tenant, organization, user, or session scope.
- Dev auth form prefill variables such as `VITE_*_AUTH_DEV_DEFAULT_*` `MAY` exist only as optional login-form convenience. They `MUST NOT` seed IAM directory data, issue tokens, or override JWT claims.
- `SDKWORK_IAM_DEV_FIXED_VERIFY_CODE` and equivalent dev-only verification bypass variables `MAY` exist only for deterministic verification-code flows in local/private development. They `MUST NOT` carry tenant, organization, app, or user identity.
- Release, CI, and manifest tooling `MAY` use `SDKWORK_APP_ID` only as build/release metadata. That usage `MUST NOT` be consumed by live IAM runtime, TokenManager, or protected SDK client scope resolution.
- Local `.env`, tracked `.env.example`, bootstrap overlays, runtime TOML, and public runtime config `MUST NOT` require fixed tenant, organization, app, email, password, or owner credentials to start authenticated development.

## 8. Rust Local/Private IAM Authority

Only an IAM authority implementation may expose app-api login/session routes in Rust.

Allowed Rust IAM authority responsibilities:

- expose `/app/v3/api/auth/sessions`, `/app/v3/api/auth/sessions/current`,
  refresh, logout, verification, OAuth, QR auth, password reset, and current
  user routes when the deployment intentionally runs embedded standalone IAM;
- use the same OpenAPI paths, operationIds, schemas, `SdkWorkApiResponse` success envelopes, `ProblemDetail` errors, and security declarations as Java app-api;
- issue, hash, store, rotate, revoke, and verify tokens with the same logical IAM semantics;
- produce AppContext and ShardingContext compatible across standalone and cloud profiles;
- pass appbase UI/runtime contract tests without app-specific forks.

Forbidden for application Rust services:

- adding application-local login or refresh routes;
- exposing `/backend/v3/api/auth/*`;
- using IM/device runtime session routes as IAM login sessions;
- creating a separate user-center login namespace;
- bypassing generated app SDK/appbase because an auth method is missing.

## 9. Current User Self-Service

Current user profile and self-service operations are appbase app-api resources, not application-local user clients.

Rules:

- Current user reads `MUST` use `@sdkwork/iam-app-sdk` `appbaseApp.iam.users.current.retrieve()`.
- Current user updates and password changes `MUST` be defined as semantic appbase app-api current-user resources before use, for example `appbaseApp.iam.users.current.update(...)` and `appbaseApp.iam.users.current.password.update(...)`.
- Applications and UI packages `MUST NOT` inject clients exposing legacy `user.getUserProfile`, `user.updateUserProfile`, `user.changePassword`, or equivalent app-local user-center methods.
- Missing current-user app SDK methods `MUST` be closed by updating `sdkwork-iam-app-api`, OpenAPI, generator inputs, and all generated language SDKs. They `MUST NOT` be hidden by raw HTTP, fallback DTOs, or application-local SDK forks.
- User-center UI `MUST` expose edit/password capabilities only when the generated appbase app SDK resource exists. Default current-user profile UI is read-only until `iam.users.current.update` and password update resources are present.

## 10. Tauri And Desktop Rules

Desktop shells host the web app; they do not own business authentication.

Rules:

- Tauri commands `MUST NOT` perform login, token refresh, permission evaluation, or business authorization.
- Tauri may provide secure token storage, deep link/OAuth callback bridging, QR scan device capability, window control, and local runtime process lifecycle through typed host adapters.
- Renderer code `MUST` still use appbase IAM runtime and generated app SDK clients for login/session flows.
- Desktop logout `MUST` clear both renderer session state and native secure storage when native storage is used.
- Local/private desktop modes `MUST` use runtime config to choose app-api base URLs. Release builds must not hard-code development endpoints.

## 11. Verification

Required checks for IAM login integration:

| Verification | Evidence |
| --- | --- |
| Appbase boundary | Static scan shows login/register/session UI comes from appbase packages or approved wrappers, and product bootstrap uses the approved high-level IAM auth runtime/factory instead of low-level IAM SDK adapters. |
| SDK boundary | Static scan shows no raw HTTP/manual auth headers in UI or feature services. |
| Route guard | Tests or smoke checks prove protected routes redirect to login and authenticated auth routes redirect home/target. |
| Logout | Tests or smoke checks prove persisted session, global token manager, AppContext, realtime clients, caches, and native storage are cleared even when remote logout fails. |
| Session persistence | Tests prove login/refresh/current-session calls do not resolve before `commitSession` finishes, token persistence failure does not update the global token manager, new sessions do not inherit old refresh tokens, refresh/current-session continuation passes the already-merged committed session to `commitSession`, context propagation failure rolls back token/context stores, and sessions without AppContext clear stale AppContext. |
| Session recovery | Tests prove concurrent SDK and realtime `401` responses share one refresh operation, safe reads replay at most once, mutations do not replay without an approved idempotency/precondition contract, refresh failure clears once, and deterministic non-auth `4xx` responses stop retry/reconnect. |
| Login protocol | Tests prove login requests do not send or trust inbound auth/context headers, appbase returns tenant/organization/login-scope context in both tokens, and multi-organization login returns a continuation challenge instead of a normal session. |
| Organization selection | Tests prove organization-selection continuation credentials cannot authenticate product APIs, client code does not auto-select the first organization, and final token issuance validates membership before committing session state. |
| API boundary | Contract scan proves product IM/backend/Rust services do not expose appbase-owned `/app/v3/api/auth/*` routes. |
| Current user boundary | Static scan shows current-user profile/self-service calls use `appbaseApp.iam.users.current.*` and do not inject legacy `user.*` clients. |
| Rust guard | Tests prove protected Rust routes require valid dual tokens and typed WebRequestContext/AppContext injection through sdkwork-web-framework. |
| Context safety | Tests prove body/query/path tenant or user fields cannot override AppContext. |
| Error shape | Unauthorized/context failures return problem-detail errors with stable codes. |

Suggested command categories:

```text
pnpm --dir apps/sdkwork-<application-code>-pc test
pnpm --dir ../sdkwork-iam test:iam-standard-contracts
cargo test -p <rust-service> --test <auth_or_context_test>
rg -n "fetch\\(|axios\\.|Authorization|Access-Token" apps/sdkwork-<application-code>-pc/packages
rg -n "/app/v3/api/auth|/api/.*/auth|user-center/session" services crates
```

## 12. Acceptance Checklist

- [ ] App login/register/session UI is provided by `sdkwork-appbase` or approved wrappers.
- [ ] Application auth runtime integration uses the approved high-level IAM auth runtime/factory and does not directly depend on `@sdkwork/iam-sdk-adapter` or application-side `createIamRuntime(...)` wiring.
- [ ] Application does not reimplement appbase-owned auth endpoints.
- [ ] AuthGate protects product routes and redirects anonymous users to the login entry.
- [ ] Session storage is centralized and normalizes `authToken`, `accessToken`, `refreshToken`, `sessionId`, user, and AppContext.
- [ ] Generated appbase app SDK or strict IAM adapter over the standard appbase SDK resource surface owns all auth/session transport.
- [ ] Logout clears local session, global token manager, AppContext, realtime connections, sensitive cache, and native storage when present, including remote logout failure cases.
- [ ] Login/refresh/current-session restoration waits for session persistence and context propagation before returning to UI/runtime code, replaces refresh tokens for new sessions, preserves current refresh tokens only for continuation flows, rolls back on context propagation failure, and clears stale AppContext when the committed session has no context.
- [ ] Application/dependency SDKs and realtime transports share one session recovery coordinator; concurrent `401` responses coalesce refresh, safe reads replay at most once, terminal refresh failure clears once, and problem-detail `code` / `traceId` remain available.
- [ ] Credential-entry requests have no user session, carry only the validated bootstrap `Access-Token`, and receive user/organization context only after real IAM credential and membership lookup.
- [ ] Credential-entry OpenAPI operations use `security: [{ AccessToken: [] }]`, `x-sdkwork-auth-mode: credential-entry-bootstrap`, and `x-sdkwork-forbid-credential-headers: true`; generated SDKs fail before dispatch when bootstrap is missing, and backends reject every non-profile credential/context header.
- [ ] Multi-organization login uses the appbase organization-selection continuation protocol and does not commit normal session state until final dual tokens are returned.
- [ ] Runtime env, tracked `.env.example`, bootstrap overlays, and public runtime config do not inject fixed tenant, organization, user, owner, or session scope through `SDKWORK_IAM_BOOTSTRAP_*`, runtime `SDKWORK_APP_ID`, `VITE_SDKWORK_APP_ID`, or equivalent bootstrap variables.
- [ ] Both tokens and persisted AppContext agree on tenant, organization, login scope, user, session, app, environment, deployment profile, and runtime target.
- [ ] Reusable auth packages use `commitSession(session, options?)`, never `persistSession`, and controller logout clears local authenticated state in a `finally` path.
- [ ] Runtime/bootstrap builds an SDK inventory and passes every downstream authenticated application/dependency app-api/backend-api client and approved composed wrapper through `clients.sdkClients` or the language-equivalent token-manager-aware SDK list.
- [ ] Current user profile reads use `appbaseApp.iam.users.current.retrieve()` and missing self-service methods are fixed in appbase app-api/OpenAPI/generator inputs instead of application-local fallbacks.
- [ ] Rust protected APIs require dual tokens and typed WebRequestContext/AppContext injection through sdkwork-web-framework.
- [ ] Rust application services do not expose login/session creation routes unless they are the IAM authority implementation.
- [ ] Permission and tenant decisions come from verified AppContext, not request body/query/path hints.
- [ ] Tests cover route guard, logout, SDK boundary, Rust auth guard, and forbidden route namespace checks.
