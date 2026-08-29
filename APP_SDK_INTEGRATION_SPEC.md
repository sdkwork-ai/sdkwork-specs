# App SDK Integration And Composition Standard

- Version: 1.0
- Scope: app SDK integration across PC React, H5 mobile React, Flutter, mini program, native Android, native iOS, native HarmonyOS, desktop/native, Rust-enabled apps, Drive Uploader, app dependency composition, appbase IAM runtime, and global token-manager wiring
- Related: `APPLICATION_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_INTEGRATION_CONVENTIONS.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `DESKTOP_APP_ARCHITECTURE_SPEC.md`, `WEB_BACKEND_SPEC.md`, `API_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `DRIVE_SPEC.md`, `MEDIA_RESOURCE_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines how SDKWork applications integrate generated SDKs and reusable appbase capabilities without copying APIs, forking clients, or creating local auth behavior. Applications are composition roots. Applications compose dependency SDKs, shared modules, appbase IAM runtime, Rust route/service crates, and architecture-specific UI packages through explicit boundaries. The application root owns one SDK credential topology for every runtime target; feature packages only receive injected clients, services, or ports.

Consumer integration facts such as dependency SDK base URLs, runtime modes, inherited permission manifest refs, component layer roles, frontend package roles, Rust crate summaries, route manifests, and runtime dependency surfaces must be derived through `APP_INTEGRATION_CONVENTIONS.md`, `COMPOSABLE_ARCHITECTURE_SPEC.md`, and `resolve-composition.mjs`. Consumers declare `contracts.sdkDependencies` and optional `contracts.composition.overrides`; they must not hand-maintain parallel dependency surface manifests or duplicate dependency permission catalogs.

The normative IAM reference is `sdkwork-iam`:

- `sdkwork-iam/apps/sdkwork-iam-common/packages/sdkwork-iam-runtime/src/index.ts`
- `sdkwork-iam/apps/sdkwork-iam-common/packages/sdkwork-iam-runtime/tests/iam-runtime.standard.test.ts`
- `sdkwork-iam/apps/sdkwork-iam-common/packages/sdkwork-iam-sdk-adapter/src/index.ts`
- `sdkwork-iam/apps/sdkwork-iam-pc/packages/sdkwork-iam-react/src/index.tsx`
- `sdkwork-iam/apps/sdkwork-iam-pc/packages/sdkwork-auth-pc-react/src/auth-service.ts`

Those packages implement the standard runtime shape: `createIamRuntime(...)` creates or receives one `AuthTokenManager` from `@sdkwork/sdk-common/createTokenManager`, binds the same manager to `appbaseApp`, optional `backend-admin` `appbaseBackend`, and every downstream `sdkClients` entry through `setTokenManager`, persists tokens in a `tokenStore`, persists `AppContext` in a `contextStore`, emits standard dual-token headers through `getAuthHeaders()`, and clears local token/context state even when remote logout fails.

Applications normally consume a higher-level IAM auth runtime factory for their architecture, for example `@sdkwork/auth-runtime-pc-react` `createSdkworkAppbasePcAuthRuntime(...)` on PC React. The low-level `@sdkwork/iam-runtime` and `@sdkwork/iam-sdk-adapter` packages are appbase implementation details or approved wrapper internals. Application bootstrap code provides app identity, runtime config, generated SDK clients, the global TokenManager, and session bridge hooks to the high-level factory; it must not reassemble appbase IAM adapters locally when an architecture-level appbase runtime factory exists.

Every SDKWork application uses this as the TokenManager closure rule: within one authenticated session context, every SDK client that sends SDKWork app-api, explicit `backend-admin` backend-api, or an explicitly declared open-api dual-token branch `MUST` share the same `TokenManager` instance. This includes appbase app SDKs, application/dependency app SDKs such as Drive, Messaging, and IM when their declared profile uses dual token, explicit `backend-admin` backend SDKs, and any approved composed wrapper backed by those SDKs. Public SDKs that need no credentials receive no token manager. Protected open-api SDKs receive credential providers matching their declared auth mode (`api-key`, `oauth`, `open-api-flexible`, or `api-key-or-dual-token`). An `api-key-or-dual-token` client joins the login TokenManager client list only while configured for its dual-token branch; its API-key branch is mutually exclusive and uses no session TokenManager.

## 1. Composition Model

Standard app composition:

```text
application root
  -> app shell/bootstrap
  -> architecture-specific UI package
  -> service/facade package
  -> generated language SDK client or approved wrapper
  -> appbase IAM runtime and global TokenManager
  -> app-api/backend-api/open-api SDKs
  -> Rust route/service crates or Java backend controllers
  -> dependency SDKs and reusable modules
```

Rules:

- An application root `MUST` be a composition layer, not a source-copy layer.
- App shells `MUST` own routing, providers, runtime config, SDK construction, token/session bootstrap, host adapters, and composition of feature packages.
- Feature packages `MUST` receive services, ports, generated SDK clients, host adapters, and runtime inputs through explicit injection.
- Consuming applications `MUST NOT` copy dependency routes, SDK generated output, appbase IAM packages, appbase DTOs, or dependency service internals into the application repository for convenience.
- Consuming applications `MUST NOT` regenerate dependency-owned APIs into application-owned SDK families. Dependency capabilities are consumed through dependency SDK packages, approved composed wrappers, or runtime service interfaces.
- Cross-app reuse `MUST` happen through published modules, generated SDKs, component specs, `sdkDependencies`, or approved composed facades. It must not happen through imports of another app's private `src` paths.
- Shared pure contracts may be framework-neutral. UI components, host adapters, and platform-specific runtime code stay in their own architecture family.
- Services may compose multiple SDK calls into a domain use case, but they `MUST NOT` hide a missing backend capability with raw HTTP or local DTO forks.

## 2. Dependency Relationships

Applications depend on each other through stable artifacts.

| Dependency kind | Consume through | Forbidden |
| --- | --- | --- |
| Appbase IAM/session/workspace/bootstrap | `sdkwork-iam` packages, generated IAM SDKs (`sdkwork-iam-app-sdk`, `sdkwork-iam-backend-sdk`), IAM Rust crates | application-local login routes, copied auth UI, regenerated IAM APIs |
| Drive upload/download/storage | Client upload through `sdkwork-drive-app-sdk client.uploader.*`; server-side Rust upload through `DriveUploaderService` or an approved Drive server-side uploader facade; application-owned SDKs accept Drive references or `MediaResource` | application-local upload endpoints, raw Drive HTTP, provider SDK calls, app-local upload tables/counters, regenerating Drive APIs into application-owned SDKs |
| Application-owned app API | generated `sdkwork-<domain>-app-sdk` for the target language | raw HTTP, backend SDK, route constants |
| Application-owned backend API | generated `sdkwork-<domain>-backend-sdk` for `backend-admin` clients | app SDK for operator resources, raw HTTP, app/user/console runtime construction |
| IAM app API | generated `sdkwork-iam-app-sdk` and approved IAM app wrappers, including user-visible IAM directory/contact read resources | backend SDK, application-local IAM forks, deleting app SDK exports to hide backend leakage |
| IAM backend API | generated `sdkwork-iam-backend-sdk` for `backend-admin` IAM management | app/user/console login flows, app auth runtime construction, user-facing directory reads |
| Application-owned open/domain API | generated `sdkwork-<domain>-sdk` with declared open-api credential mode | app login token manager unless explicitly declared by contract |
| Rust route capability | route manifest, aggregated authority, generated SDK family | frontend import of Rust route crates or path constants |
| Reusable UI/service package | package root export and component spec | imports from private package internals |
| Host/native capability | typed host adapter | business API calls from native globals |

Rules:

- Each application or independent git repository that owns APIs owns its local `sdks/` workspace.
- The application-owned SDK family generates only application-owned operations. Appbase, Drive, provider, and other reusable dependency operations stay in their own SDK families.
- File upload is a Drive dependency capability. Application-owned app/backend SDKs should accept `driveUri`, `driveSpaceId`, `driveNodeId`, Drive references, or Drive-backed `MediaResource` values after upload; they must not add application-local upload-session, presign, part, or completion methods.
- `sdkDependencies` `MUST` declare dependency SDK families in family-root `sdk-manifest.json` and component specs when an application-owned SDK or composed facade depends on them.
- A consuming application may compose dependency SDKs in runtime/bootstrap, service facades, or approved composed packages outside generated transport ownership.
- Generated transport output `MUST NOT` import, vendor, re-export, or rewrite dependency SDK packages.
- Dependency APIs are not exported by a consuming application or component by default. App/core
  packages, composed facades, and SDK family roots `MUST` declare `dependencyApiExports: []` when
  they consume dependency SDKs but do not re-expose dependency capabilities.
- A dependency app/backend/open API capability may be exposed from the consuming app only through an
  explicit `dependencyApiExports` entry using `dependency-sdk`, `composed-wrapper`, `service-port`,
  or `documentation-only` mode. The export must live in authored application core, composed facade,
  service-port, or host-adapter code outside `generated/server-openapi`.
- Enabling a dependency API export `MUST NOT` add dependency-owned operations to the application-owned
  generated SDK family. Application-owned generated SDKs remain owner-only; dependency capabilities remain in
  the dependency SDK or approved authored facade.
- Component specs `MUST` expose the dependency contract clearly enough that a consumer can tell whether it depends on a generated SDK, a composed wrapper, a service port, or a host adapter.
- Application core packages and runtime bootstrap packages `MUST` export the application-owned app SDK. They
  export dependency app SDK wrappers only when a `dependencyApiExports` entry or the approved
  appbase auth/runtime integration declares that wrapper as required by frontend app integration.
  Appbase app SDK wrappers are required when the app uses appbase login, current user, runtime
  metadata, workspace, contacts, address book, or user-visible IAM directory read/list/tree
  resources.
- Backend SDK wrappers `MUST` be exported only from `backend-admin` package boundaries. A frontend app core may construct backend SDK clients only when it is explicitly a `backend-admin` core surface; otherwise backend SDK imports, backend base URL resolvers, and appbase backend clients are forbidden in app and user-facing console packages.
- Except for explicit `backend-admin` boundaries, app, console, app auth runtime, shared frontend core, mobile/native/desktop renderer, and app-side service packages `MUST` consume generated app SDKs or approved app SDK wrappers. They `MUST NOT` import, export, construct, wrap, proxy, or route through backend SDK packages or appbase backend SDK clients.

### 2.1 Backend-Admin Package Boundary

The backend-admin package boundary is the authored package/component boundary that is allowed to
construct or consume generated backend SDK clients for operator-only workflows. A route path is not a surface classification. Placing a page under `/admin`, naming a route "admin", or showing an operator
navigation item does not make an app, console, shared frontend core, or auth-runtime package eligible
to import backend SDKs. The machine-readable component spec owns that classification.

Rules:

- PC React admin feature packages that use backend SDKs `MUST` live in a package named
  `sdkwork-<application-code>-pc-admin-<capability>` and declare `component.surface: "backend-admin"`.
- App, console, app auth runtime, shared frontend core, mobile/native/desktop renderer, and app-side
  service packages `MUST NOT` import, construct, export, or wrap application-owned backend SDKs or appbase
  backend SDKs. They may receive app SDK clients, appbase app SDK clients, or approved app-side
  service ports only.
- Shared runtime/bootstrap code may own a narrow SDK client factory when it is explicitly documented
  as the application SDK inventory boundary. Feature packages outside `backend-admin` still may not
  call backend SDK getters through that boundary.
- The default SDK base-url model may use one common API edge origin only when
  runtime topology explicitly proves that edge serves every derived surface.
  Runtime bootstrap otherwise resolves application-owned URLs from
  `application.public-ingress` and platform dependency URLs from
  `platform.api-gateway`; per-surface and per-SDK overrides remain available
  for multi-host deployments.

### 2.2 Drive Uploader Composition

Applications that upload files must compose Drive Uploader as a dependency, not as application-local infrastructure.

Rules:

- Client upload services `MUST` receive an injected Drive app SDK client or a narrow facade backed by `sdkwork-drive-app-sdk client.uploader.*`.
- Runtime/bootstrap `MUST` create the Drive app SDK client with its own Drive App API base URL and bind the same global TokenManager when the Drive App API surface is authenticated.
- Service facades may expose domain names such as `uploadAvatar`, `uploadAttachment`, or `uploadCatalogImage`, but their implementation must delegate to `client.uploader.uploadAvatar`, `client.uploader.uploadAttachment`, `client.uploader.uploadImage`, `client.uploader.uploadByProfile`, or another approved Drive uploader method.
- Application service facades must supply Drive Uploader business attribution from stable application context: `appId`, `appResourceType`, `appResourceId`, optional `scene`, optional `source`, `uploadProfileCode`, and retention. Tenant, organization, and authenticated user attribution must come from the Drive app SDK's TokenManager-backed request context or the server-side API key/request context, not from generated method arguments.
- UI components may select files, preview files, display progress, retry, and remove local selections. They must not create upload task ids, provider object keys, Drive presign URLs, or statistic dimensions directly.
- Server-side Rust application services that upload generated/imported bytes `MUST` call `DriveUploaderService`, `PrepareUploaderUploadCommand`, or an approved Drive server-side uploader facade. They must not call Drive App API over HTTP from the same trusted backend just to reuse client routes.
- Application-owned SDK generation `MUST NOT` include Drive uploader App API operations in the application-owned authority. Drive uploader operations stay in the Drive SDK family and are declared as dependencies when composed.

### 2.3 Platform Surface Foundation Composition

Foundation APIs reused by independent applications remain owned by their
source application, API assembly, and SDK family. The platform cloud gateway
selects approved assemblies or upstreams from the platform side; application
clients consume generated SDKs through the declared `platform.api-gateway`
surface without depending on that host implementation.

Rules:

- An application-owned API assembly `MUST NOT` copy appbase, Drive, messaging,
  IM, RTC, commerce, AIoT, or other dependency route crates. Each dependency
  remains in its owner's canonical API assembly.
- A standalone gateway `MAY` select a dependency assembly only when
  `dependencyApiSurfaces` declares verified same-origin embedding. Cloud
  application runners resolve the deployed platform surface and start no
  local platform gateway process.
- Application dev runners and server launchers `MUST NOT` depend on, resolve,
  start, configure, or package `sdkwork-api-cloud-gateway`. Standalone runtime
  capabilities are composed through API assemblies per `API_ASSEMBLY_SPEC.md`.
- Rust applications consume dependency APIs through dependency assemblies in a
  standalone host or through generated SDKs at explicit deployed URLs. They
  `MUST NOT` import platform cloud-gateway router builders.
- API assembly evidence comes from component specs, route manifests, Cargo
  metadata, and `assembly-manifest.json`; applications do not maintain a
  cloud-gateway catalog or executable integration manifest.
- Application frontends and SDK bootstrap resolve platform dependency SDKs
  from `platform.api-gateway`. A common API edge origin may be used only when
  topology declares coverage for every derived surface. Per-surface or per-SDK
  overrides remain available for migration, private dependency hosts,
  multi-host deployments, and tenant-specific routing. Application launchers
  must not materialize per-module foundation upstream defaults beside the
  platform surface origin; those variables are explicit upstream overrides.
- Browser development may expose one same-origin API edge to generated SDK
  clients only when client-visible request paths remain canonical API paths and
  proxy routing to `application.public-ingress`, `platform.api-gateway`, or
  explicit dependency upstreams happens behind that API edge. SDK base URLs,
  public runtime config, examples, and HAR-visible requests must not contain
  proxy selector prefixes such as `/__sdkwork/platform`.
- Application-owned APIs remain independent SDKWork API systems. They keep
  their own API authority, SDK family, generated SDKs, component specs, and
  owner-only SDK generation. When an application-owned API becomes reusable,
  its canonical assembly or upstream may be selected by the platform host.
  Resolving dependency SDKs from `platform.api-gateway` never redirects
  application-owned app-api, backend-api, or open-api URLs; those remain bound
  to `application.public-ingress` unless topology explicitly declares a common
  edge that serves both surface sets.
- New application-local raw route adapters are non-compliant when an approved
  dependency API assembly exists. Existing exceptions follow
  `MIGRATION_SPEC.md` and are removed from the final compliant state.

### 2.4 Standalone Same-Origin Versus Cloud Independent SDK Base URLs

Application SDK bootstrap `MUST` resolve `config.baseUrl` according to deployment profile and declared `dependencyApiSurfaces`. Authority: `ENVIRONMENT_SPEC.md` §5.1.4.1 and §6.2, `CONFIG_SPEC.md` §3.1.

Rules:

- In `standalone` browser and desktop renderer surfaces, application-owned and same-origin-mounted dependency SDK clients `MUST` default to same-origin relative canonical API paths (for example `/app/v3/api`, `/feeds/v3/api`). Dev proxy routing to the application standalone gateway is an ingress concern; SDK clients `MUST NOT` embed sibling module localhost ports as the default base URL.
- In `cloud` surfaces, SDK clients `MUST` resolve absolute base URLs from runtime topology: `application.public-ingress` for application-owned APIs, `platform.api-gateway` for platform dependency APIs, and explicit per-dependency overrides when topology declares a different host.
- Shared runtime/bootstrap packages (for example application commons SDK inventory) `MUST` centralize base URL resolution per surface. Feature packages `MUST NOT` hardcode absolute dev ports or duplicate conflicting resolution logic.
- Generated SDK client factories `MUST` receive a non-empty `config.baseUrl` for required clients. Same-origin relative paths are valid base URLs and `MUST NOT` be normalized to empty strings before client construction.
- When a dependency is integrated only in `cloud` (not same-origin-mounted in standalone), standalone bootstrap `MUST NOT` fabricate a same-origin path for that dependency. Conversely, when a dependency is `same-origin-mounted`, standalone bootstrap `MUST NOT` fall back to a remote absolute URL unless topology explicitly declares an external upstream override.

## 3. Architecture-Specific SDK Families

Each application architecture uses the SDK family and IAM wrapper that match its language and runtime.

| Architecture | SDK language | Required SDK boundary | IAM/appbase boundary |
| --- | --- | --- | --- |
| App PC React | TypeScript | generated TypeScript app SDKs plus service ports | `@sdkwork/iam-runtime`, `@sdkwork/iam-react`, `@sdkwork/auth-pc-react`, `@sdkwork/iam-app-sdk` |
| H5 mobile React | TypeScript | generated TypeScript app SDKs plus typed H5/Capacitor host adapters | appbase mobile wrapper when available, otherwise the same generated appbase app SDK through an approved mobile runtime adapter |
| App Flutter | Dart/Flutter | generated Dart/Flutter app SDKs plus platform adapters | generated Dart/Flutter appbase app SDK or approved appbase Flutter wrapper |
| Mini program app | TypeScript | generated TypeScript app SDKs adapted for mini program runtime plus typed mini program host adapters | appbase mini program wrapper when available, otherwise the same generated appbase app SDK through an approved mini program runtime adapter |
| Android native app | Kotlin/Java | generated Kotlin/Java app SDKs plus typed Android host adapters | generated Kotlin/Java appbase app SDK or approved appbase Android wrapper |
| iOS native app | Swift | generated Swift app SDKs plus typed iOS host adapters | generated Swift appbase app SDK or approved appbase iOS wrapper |
| Harmony native app | ArkTS/TypeScript | generated ArkTS/TypeScript app SDKs adapted for Harmony runtime plus typed HarmonyOS host adapters | appbase Harmony wrapper when available, otherwise generated appbase app SDK through an approved Harmony runtime adapter |
| Desktop/Tauri renderer | TypeScript | generated TypeScript app SDKs injected by renderer bootstrap | appbase IAM runtime in renderer, native secure storage only through host adapter |
| Rust backend/runtime | Rust | generated Rust dependency SDKs or Rust service traits for dependency calls | appbase Rust crates for context/auth/bootstrap and generated appbase SDKs when Rust calls appbase HTTP APIs |
| Backend/admin React | TypeScript | generated TypeScript backend SDKs for the `backend-admin` surface | appbase backend SDK for IAM administration, no user-facing auth session creation |

Rules:

- App-side UI packages `MUST` consume app-api through the generated app SDK for their language or through an approved appbase wrapper built on that SDK.
- `backend-admin` UI packages `MUST` consume backend-api through generated backend SDKs or approved backend wrappers.
- Non-admin UI packages `MUST` consume app-api through generated app SDK clients or approved app SDK wrappers. A package is non-admin unless it is explicitly classified as `backend-admin`; naming a user-facing console, app settings page, or customer-owned management page as "management" does not permit backend SDK use.
- User-facing app and console workflows that read organizations, departments, memberships, assignments, positions, role bindings, and organization/department trees for contacts, address books, workspace navigation, or customer-owned management `MUST` consume appbase app SDK resources or an approved app SDK wrapper. They must not use appbase backend SDK merely because the resource is IAM-related.
- `backend-admin` IAM creation, deletion, mutation, tenant-wide administration, and operator audit workflows `MUST` consume appbase backend SDK resources from a `backend-admin` boundary. If a user-facing console needs a management capability that is missing from app SDK, the owning app-api/app SDK contract must be extended or the workflow must move to `backend-admin`; the console must not import backend SDK as a shortcut.
- Flutter packages `MUST` use generated Dart/Flutter SDK clients. They must not call TypeScript wrappers or React packages.
- Android native packages `MUST` use generated Kotlin/Java SDK clients. They must not call TypeScript, Dart/Flutter, Swift, ArkTS, or React wrappers.
- iOS native packages `MUST` use generated Swift SDK clients. They must not call TypeScript, Dart/Flutter, Kotlin/Java, ArkTS, or React wrappers.
- Harmony native packages `MUST` use generated ArkTS/TypeScript SDK clients adapted for Harmony runtime or approved Harmony wrappers. They must not call React browser wrappers, Dart/Flutter wrappers, Kotlin/Java wrappers, or Swift wrappers.
- Rust service and native runtime code that calls HTTP APIs directly `MUST` use generated Rust SDKs or approved Rust service clients. It must not embed frontend TypeScript SDK behavior.
- Open-api SDKs use the credential mode declared by the open-api contract. Protected open-api clients use API key and/or OAuth bearer credential providers separate from the app login token manager unless the declared `api-key-or-dual-token` profile selects its dual-token branch; that branch shares the application login TokenManager and is mutually exclusive with API-key state.
- Architecture-specific wrappers may normalize storage, platform lifecycle, or host integration, but they `MUST` remain thin wrappers over generated SDK resources and appbase runtime behavior.
- Missing SDK methods `MUST` be fixed in the owning API contract, OpenAPI authority, generator inputs, and generated SDK family before the app integrates the capability.

## 4. Appbase IAM Runtime Standard

Login, registration, session, and IAM runtime behavior are appbase capabilities.

Standard low-level runtime shape implemented by appbase packages and approved architecture wrappers:

```ts
import { createTokenManager } from "@sdkwork/sdk-common";
import { createIamRuntime } from "@sdkwork/iam-runtime";

const tokenManager = createTokenManager();

const sdkBaseUrls = resolveSdkBaseUrls(runtimeConfig);
const isBackendAdminRuntime = classifyRuntimeSurface(runtimeConfig) === "backend-admin";

const productAppSdk = createProductAppSdk({
  baseUrl: sdkBaseUrls.appApiBaseUrl,
  tokenManager,
});

const productBackendSdk = isBackendAdminRuntime && sdkBaseUrls.backendApiBaseUrl
  ? createProductBackendSdk({
      baseUrl: sdkBaseUrls.backendApiBaseUrl,
      tokenManager,
    })
  : undefined;

const iamRuntime = createIamRuntime({
  clients: {
    appbaseApp,
    appbaseBackend: isBackendAdminRuntime ? appbaseBackend : undefined,
    sdkClients: [
      productAppSdk,
      ...(productBackendSdk ? [productBackendSdk] : []),
    ],
  },
  config,
  tokenManager,
  tokenStore,
  contextStore,
});
```

Rules:

- Every authenticated application runtime `MUST` create exactly one global `TokenManager` or language-equivalent token manager per authenticated session context.
- Application bootstrap `MUST` consume the approved high-level IAM auth runtime/factory for its architecture when one exists, for example `createSdkworkAppbasePcAuthRuntime(...)` for PC React.
- IAM application registration and tenant runtime provisioning `MUST` use `@sdkwork/iam-application-bootstrap` per `IAM_APPLICATION_BOOTSTRAP_SPEC.md`. Application code `MUST NOT` hand-craft raw HTTP to `/backend/v3/api/iam/applications/register`, `/backend/v3/api/iam/tenant_applications`, or `/backend/v3/api/iam/access_credentials`.
- Application bootstrap `MUST NOT` import `@sdkwork/iam-sdk-adapter`, call `createIamAppSdkAdapter(...)`, call `createIamBackendSdkAdapter(...)`, or locally wire appbase SDK resources into IAM ports when an appbase high-level runtime/factory can do that wiring.
- Application bootstrap `MUST NOT` call `createIamRuntime(...)` directly except inside an approved appbase-owned wrapper package that exposes the same high-level inputs.
- Runtime/bootstrap `MUST` resolve SDK base URLs from `CONFIG_SPEC.md` and `ENVIRONMENT_SPEC.md` before creating generated SDK clients.
- Runtime/bootstrap `MUST` resolve i18n runtime config from `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, and `I18N_SPEC.md` before constructing SDK clients, app auth runtime, frontend i18n providers, or host adapters that expose locale.
- Application-owned SDK URLs and platform dependency SDK URLs `SHOULD` derive
  from their declared topology surfaces. They may share one common API edge
  origin only when that edge is declared to serve all required surfaces.
  Per-surface and per-SDK overrides `MUST` remain available for multi-host
  deployments, external dependency services, private dependency hosts, or
  tenant-specific routing.
- A common API edge origin is not an arbitrary application `API_BASE_URL`. It
  must safely derive standard SDK surface URLs such as `/v1`, `/app/v3/api`,
  and `/backend/v3/api`; a surface URL such as `/v1` must not be reused as the
  origin for app/backend SDKs.
- Base URL config may come from private process env, public browser runtime env, or runtime TOML depending on target, but token values must never come from these config sources.
- Runtime/bootstrap `MUST` build an SDK inventory before constructing feature services. The inventory classifies each SDK as authenticated app-api, authenticated `backend-admin` backend-api, protected open-api API-key, protected open-api OAuth bearer, protected open-api flexible, public open-api, local/native, or test fake.
- Runtime/bootstrap must derive the SDK inventory from core package composition and `component.spec.json` contracts defined by `APP_COMPOSITION_SPEC.md`. Bootstrap must not maintain a second handwritten inventory that can drift from manifest authority.
- The same `TokenManager` instance `MUST` be passed to `@sdkwork/iam-app-sdk`, every application/dependency app SDK client, and only those `@sdkwork/iam-backend-sdk`, application-owned backend SDK, or dependency backend SDK clients that are present in an explicit `backend-admin` authenticated SDK inventory.
- App auth/login runtime for user-facing application sessions `MUST` construct appbase app SDK and downstream app SDK clients required for login/session/current-user/directory app-side behavior. It `MUST NOT` construct appbase backend SDK or application-owned backend SDK clients just because the application root also contains admin packages.
- Generated SDK clients that support `setTokenManager(manager)` `MUST` receive the same instance during bootstrap. Generated SDK clients that accept `tokenManager` in a constructor `MUST` receive that same instance instead of a package-local manager.
- The appbase app SDK client `MUST` be named `appbaseApp` or `appbaseAppClient` in runtime code so it cannot be confused with application-owned app SDK clients.
- Application-owned and dependency app SDK clients, plus explicit `backend-admin` backend SDK clients, `MUST` be passed as downstream `sdkClients` or the local language equivalent. They must not own login, token refresh, independent token stores, independent `TokenManager` instances, or session restoration.
- Applications `MUST NOT` create per-domain, per-package, per-service, or per-SDK TokenManagers for the same authenticated session. Account switch, tenant switch, logout, refresh failure, or session replacement creates or clears the application session context as a whole, then rebinds every authenticated SDK through the single runtime path.
- Login, registration, OAuth, QR auth, password reset, current session, refresh, logout, runtime metadata, and current-user self-service `MUST` call appbase app SDK resources under `appbaseApp.auth.*`, `appbaseApp.openPlatform.qrAuth.*`, `appbaseApp.system.iam.*`, and `appbaseApp.iam.users.current.*`. Verification-code delivery and verification `MUST` call the generated messaging app SDK surface under `messagingApp.messaging.verificationCodes.*` or the approved appbase auth wrapper that delegates to that injected messaging client.
- `backend-admin` IAM management `MUST` use `appbaseBackend.iam.*`. Backend SDK clients `MUST NOT` expose an `auth` namespace for user-facing session creation.
- Reusable auth services `MUST` expose `commitSession(session, options?)`, not `persistSession`.
- `commitSession` `MUST` validate and normalize the appbase session, persist `authToken`, `accessToken`, and optional `refreshToken`, write returned `AppContext` or clear stale context, then sync the global token manager.
- Token persistence failure `MUST NOT` update the in-memory token manager.
- Context propagation failure after token persistence `MUST` clear token store, context store, and token manager before rejecting.
- New session flows `MUST NOT` inherit an old `refreshToken` when appbase does not return one.
- Current-session bootstrap, current-session update, refresh continuation, and equivalent restoration flows may preserve the existing refresh token only through `commitSession(session, { preserveRefreshToken: true })`.
- `getAuthHeaders()` or the language-equivalent runtime helper may expose `Authorization: Bearer <JWT authToken>`, `Access-Token: <JWT accessToken>`, and optional locale headers for approved runtime bridges. Protected SDK transports must send JWT `Access-Token` whenever an access token is available. UI and feature services must not manually assemble these headers, locale headers, or semicolon claim-string tokens.
- TypeScript application/backend SDK transports, open-api SDKs using an explicitly declared dual-token branch, and approved runtime bridges `MUST` delegate dual-token header construction to `@sdkwork/sdk-common` `buildAuthHeaders('dual-token', ..., tokenManager)` instead of reading tokens and formatting `Authorization` or `Access-Token` locally. `api-key-or-dual-token` transports `MUST` keep API-key and TokenManager state mutually exclusive and fail before dispatch on an incomplete dual-token pair. IAM credential entry uses the first-class `credential-entry-bootstrap` transport profile: it injects bootstrap `Access-Token` only, never adds session/context credentials, and fails before dispatch when bootstrap is absent, as governed by `IAM_CREDENTIAL_ENTRY_SPEC.md`.
- Application bootstrap `MUST` pass the approved locale provider or i18n provider into generated SDK clients that support locale propagation. Feature packages must receive the provider or translated text through injected runtime ports, not through direct environment reads or manual `Accept-Language` mutation.
- Application roots `MUST` document private bootstrap `SDKWORK_ACCESS_TOKEN` in env templates when credential-entry or protected app/backend surfaces are consumed. Service/native runtimes may seed TokenManager from that value before interactive login. Development browser renderers use only the private lifecycle handoff; production browser renderers use an approved short-lived bootstrap exchange or trusted host channel. Public env, static assets, `AUTH_TOKEN`, `REFRESH_TOKEN`, `API_KEY`, `VITE_*_TOKEN`, and `PORTAL_PUBLIC_*_TOKEN` are forbidden outside explicit isolated test fixtures.
- Logout and refresh failure `MUST` clear local token store, global token manager, context store, sensitive caches, realtime/session bridges, and native secure storage when present, even when remote session deletion fails.
- Runtime/bootstrap `MUST` compose the single authenticated session recovery coordinator from `IAM_LOGIN_INTEGRATION_SPEC.md` section 5.2 and bind application SDKs, dependency SDKs, approved composed wrappers, uploads, and realtime transports to it. Sharing only the TokenManager without shared refresh and terminal-clearing behavior is insufficient.

## 5. Rust Backend Composition

Rust backends participate in composition through route crates, service crates, dependency SDKs, and appbase runtime crates.

```text
packages/sdkwork-routes-merchandise-app-api
  -> route manifest
  -> sdkwork-shop-app-api
  -> sdkwork-shop-app-sdk
  -> frontend/service consumes generated SDK
```

Rules:

- Rust route crates `MUST` follow `sdkwork-routes-<capability>-open-api`, `sdkwork-routes-<capability>-app-api`, or `sdkwork-routes-<capability>-backend-api`.
- Rust route crates own route/path configuration, handler binding, and route manifests for one capability and one surface. They do not become frontend path libraries.
- Application shells aggregate route manifests into project/domain API authorities such as `sdkwork-shop-app-api`, then generate owner-only SDK families.
- Rust implementations that expose or validate appbase IAM/session/context
  behavior `MUST` depend on appbase Rust crates. Application Rust services must not
  fork appbase auth guards, context extraction, token validation, or bootstrap
  behavior.
- Protected Rust business routes `MUST` validate dual tokens and inject typed `WebRequestContext`/`AppContext` through `sdkwork-web-framework` according to `WEB_FRAMEWORK_SPEC.md` and `IAM_LOGIN_INTEGRATION_SPEC.md`.
- Rust services that call dependency-owned APIs directly `MUST` use generated dependency SDKs or approved service traits. They must not copy OpenAPI routes into the product authority.
- Tauri/native commands may start or bridge local Rust runtimes, but they `MUST NOT` own business authentication or become hidden app-api/backend-api surfaces.

### 5.1 Rust Backend Dependency API Composition

Dependency API composition distinguishes route contracts from mounted handlers.

Rules:

- Rust backend integration `MUST` import dependency crates through public package exports or
  approved service traits. It must not import private dependency `src` files, copy route constants,
  or duplicate dependency handlers in the product crate.
- A dependency route contract, route manifest, or metadata export can describe expected method/path
  coverage, but it is not an executable router. Same-process mounting requires a dependency-owned
  executable router, controller, handler adapter, or approved runtime service export.
- If a dependency crate exposes only route contract metadata, the consuming app `MUST` treat that
  surface as an external dependency service for SDK client base URL purposes until an executable
  router export and coverage test exist.
- Application roots that mount dependency APIs through the same origin `MUST` record the mount in
  `dependencyApiSurfaces` with `sameOriginAllowed: true`, an executable router export, and coverage
  evidence comparing dependency route contracts or OpenAPI paths against the runtime router.
- Same-origin dependency mounts `MUST` be production-capable. A router/controller/service export
  backed only by demo rows, sample/local state, fixture data, mocks, or hard-coded tenants, users,
  organizations, API keys, roles, or permissions is a test/demo artifact and `MUST NOT` be recorded
  as verified `dependencyApiSurfaces` coverage for any lifecycle environment.
- The executable dependency router/controller/service export `MUST` be a public integration
  entrypoint declared by the dependency component. Surface-specific Rust entrypoints should follow
  the pattern `sdkwork_<component>_open_api`, `sdkwork_<component>_app_api`, and
  `sdkwork_<component>_backend_api`, with public builders such as
  `build_sdkwork_<component>_<surface>_router` or an equivalent service builder.
- Split/server mode and embedded/same-process mode have different requirements. Split/server mode
  `MUST` configure a platform API surface that serves every consumed dependency surface or an explicit
  dependency SDK base URL for each dependency surface. Embedded mode
  `MUST` mount the dependency-owned executable router/controller/service export and record verified
  coverage in `dependencyApiSurfaces`.
- When one platform API surface serves multiple dependency surfaces with overlapping API
  prefixes, the platform routing contract `MUST` declare route precedence and the application `MUST` rely on
  that contract instead of mounting the same foundation APIs locally. More specific dependency
  routes and fixed IAM/provider routes resolve before broad fallback surfaces.
- `pnpm dev:desktop`, a local server launcher, or any host command starting a backend process does not
  by itself prove that dependency APIs are served. The launched runtime must either configure the
  dependency surface as an external service or mount the executable dependency integration entrypoint.
- Application roots that do not mount the dependency executable router `MUST` configure dependency
  SDK clients with either the declared platform API surface or explicit dependency
  base URLs, and fail fast when neither is available.
- Browser renderer dependency SDK clients `MUST` be configured with an API edge
  base URL that preserves canonical path construction. They `MUST NOT` be
  configured with a base URL whose path segment exists only to choose an
  upstream, such as `/__sdkwork/platform`, `/proxy/platform`, or
  `/gateway/platform`.
- `backend-admin` appbase IAM management uses the appbase backend SDK and backend dependency base URL;
  it may use the platform API surface only when that surface explicitly serves appbase backend IAM.
  It must not fall back to an application backend route prefix unless appbase backend IAM executable
  routes are mounted and verified in the application runtime.

### 5.2 Appbase Backend IAM Runtime Rule

Appbase app SDK integration and appbase backend IAM integration are separate runtime obligations.

Rules:

- Integrating `sdkwork-iam-app-sdk` or `@sdkwork/iam-app-sdk` satisfies app-api IAM
  responsibilities such as login, session, current-user, workspace, contacts, and user-visible
  directory reads. It does not satisfy backend-admin IAM management route availability.
- `backend-admin` packages that call `@sdkwork/iam-backend-sdk` for users, organizations,
  departments, roles, permissions, policies, tenants, API keys, audit events, or security events
  `MUST` receive an appbase backend API base URL that serves `/backend/v3/api/iam/*`.
- A consuming application may satisfy that base URL through a common SDK gateway only when the
  gateway is declared to serve the appbase backend surface, or through the application same-origin
  backend only when a production-capable appbase backend router/controller/service adapter is
  mounted and verified in `dependencyApiSurfaces`. The adapter may be appbase-owned or an approved
  application adapter, but it must be backed by real appbase IAM tables/services or a real upstream.
- A demo/local appbase backend IAM router, hard-coded seed response, or fake success handler is not
  appbase backend IAM integration. If a command route has no real command store yet, it must fail
  explicitly instead of returning synthetic success or synthetic rows.
- If neither a verified same-origin mount nor an explicit appbase backend service/gateway is
  configured, runtime bootstrap must fail before constructing the appbase backend SDK client. It
  must not wait for admin organization or user pages to discover missing IAM routes through 404
  responses.

## 6. Frontend Service And Component Rules

Frontend applications compose UI packages, services, SDK clients, IAM runtime, and host adapters.

Rules:

- Runtime/bootstrap constructs concrete SDK clients, the global token manager, appbase IAM runtime, open-api credential providers, secure storage adapters, and host adapters.
- Runtime/bootstrap constructs the i18n provider and SDK locale provider from the same resolved locale config so frontend UI, generated SDK transports, and backend framework locale negotiation remain aligned.
- UI packages call hooks/services. Hooks/services call injected SDK clients or narrow service ports.
- UI components `MUST NOT` construct SDK clients, parse tokens, set `Authorization`, set `Access-Token`, set `X-API-Key`, set locale headers, or call raw `fetch`/`axios` for app business.
- Service facades should preserve generated SDK resource names unless they intentionally compose multiple SDK calls into a domain use case.
- Component packages `MUST` define their external dependencies through package root exports and component specs. Consumers should be able to wire the package without reading private implementation files.
- Shared cross-architecture state must be modeled as contracts or service ports. React state, Flutter blocs/controllers, Android view models, iOS view models, Harmony view models, and host lifecycle code do not cross architecture families.
- IAM user/session state is a runtime concern. Feature packages may observe authenticated user/context through injected services, but they `MUST NOT` persist their own copy of tokens or AppContext.
- List/search feature services `MUST` consume SDK `{ items, pageInfo }` pagination and `MUST NOT` implement interactive browsing with `listAll*` aggregation plus local `slice` per `PAGINATION_SPEC.md` §8.
- Create/update/delete/command feature services `MUST` consume generated SDK operation methods aligned with `API_SPEC.md` section 15.4. They `MUST NOT` introduce raw HTTP fallbacks, local DTO/envelope parsers, delete success JSON parsing, or SDK aliases that bypass `create`, `update`, `delete`, domain command actions, or `bulk<Action>` methods.
- Retriable feature services `MUST` pass idempotency keys and optimistic concurrency preconditions only through generated SDK-supported options such as `idempotencyKey` and `ifMatch`; they `MUST NOT` construct manual `Idempotency-Key`, `If-Match`, auth, tenant, or trace headers in UI/service code.
- Service facades `MUST NOT` hand-build `pageSize`, `limit`, `page_no`, `pageNo`, `per_page`, `size`, or numeric-cursor query strings. Language-level `pageSize` options must serialize through generated SDK transport as HTTP `page_size`, and interactive lists must not request maximum `page_size` just to page locally.

## 7. Verification

Required checks for app SDK composition:

| Verification | Evidence |
| --- | --- |
| Appbase IAM boundary | Static scan shows login/register/session/refresh/logout/current-user calls use appbase SDK resources or appbase wrappers, and application bootstrap uses the approved high-level IAM auth runtime/factory instead of low-level IAM SDK adapters. |
| SDK inventory closure | Tests or deterministic static checks list every appbase, application-owned, and dependency SDK consumed by the app, prove they are declared in core/surface `component.spec.json` contracts, and classify credential mode before service construction. |
| Credential-entry closure | Tests prove bootstrap is available before credential-entry SDK construction/use, only `Access-Token` is dispatched, absence fails locally, and production browser bootstrap uses no static/public credential artifact. |
| Component port closure | `check-component-port-bindings.mjs` proves new composable modules expose layer roles, valid provided/required ports, and executable runtime entrypoints for same-origin dependency surfaces. |
| Frontend composition closure | `check-frontend-composition.mjs` proves feature packages consume SDK access through core/ports and host packages do not depend on business SDKs. |
| Rust backend composition closure | `check-rust-backend-composition.mjs` proves route/service/repository/runtime Cargo dependency boundaries. |
| Global TokenManager | Tests prove one `TokenManager` is bound to appbase app SDKs, application/dependency app SDKs, explicit `backend-admin` appbase backend/application backend/dependency backend SDKs, and approved composed wrappers through `setTokenManager`, constructor injection, or the language equivalent. |
| I18n provider closure | Tests prove runtime/bootstrap derives one locale strategy for UI providers, host adapters, and generated SDK locale providers; feature services do not set `Accept-Language` or `X-SdkWork-Locale` manually. |
| Session commit order | Tests prove persistence failure does not update token manager, context propagation failure rolls back token/context state, stale context is cleared, and continuation flows preserve refresh token only when allowed. |
| Session recovery closure | Tests prove authenticated application/dependency SDKs and realtime transports coalesce concurrent `401` responses into one refresh, re-read credentials, replay only eligible operations at most once, preserve problem details, and stop on terminal or deterministic client errors. |
| Logout clearing | Tests prove local token/context state clears even when remote logout fails. |
| Architecture SDK boundary | Static scans prove PC React/H5 mobile React/Flutter/mini program/Android/iOS/Harmony/backend-admin packages use the correct generated SDK language and surface. |
| App SDK export boundary | Static scans prove application/frontend core exports the application-owned app SDK and required dependency app SDK wrappers, including appbase app SDK wrappers, while backend SDK wrappers are exported only from `backend-admin` boundaries. |
| Dependency API export configuration | Static scans and component spec checks prove dependency APIs are not re-exported unless `dependencyApiExports` declares the dependency workspace, surface, export mode, method set, visibility, and public export symbol. |
| User console SDK boundary | Static scans prove app and user-facing console packages do not import backend SDKs, backend SDK wrapper functions, backend base URL resolvers, or appbase backend SDK clients; missing user-facing capabilities fail closed or are added to app-api/app SDK. |
| Drive Uploader dependency | Tests and static scans prove upload-capable apps use injected `sdkwork-drive-app-sdk client.uploader.*`, Rust server upload paths use `DriveUploaderService` or an approved Drive server-side facade, and application-owned SDK authorities do not contain Drive uploader operations. |
| No transport bypass | Static scans prove no raw HTTP, manual auth headers, local DTO forks, generated SDK edits, application-local appbase auth routes, direct application-side `@sdkwork/iam-sdk-adapter` imports, or application-side `createIamRuntime(...)` wiring were introduced. |
| Operation semantics | Tests prove application services use generated SDK methods aligned with `API_SPEC.md` section 15.4 and do not parse legacy create/update/delete/command envelopes. |
| Rust composition | Route manifest tests prove route crate naming, authority aggregation, owner-only SDK generation, and no frontend imports of route crates. |
| Dependency ownership | SDK ownership checks prove dependency-owned appbase/Drive/provider routes are declared as dependencies and not regenerated into application-owned SDKs. |
| Backend SDK auth namespace | Tests prove backend SDK IAM clients do not expose user-facing `auth.sessions.create` or equivalent login/session creation. |

Suggested scan categories:

```text
rg -n "fetch\\(|axios\\.|Authorization|Access-Token|X-API-Key" apps/<application-code>
rg -n "/drive/uploader|/drive/upload_sessions|client\\.uploader|DriveUploaderService|sdkwork_drive_uploader_service" apps/<application-code>
rg -n "auth\\.sessions|auth\\.registrations|iam\\.users\\.current|openPlatform\\.qrAuth" apps/<application-code>
rg -n "sdkwork-routes-.*-(app-api|backend-api|open-api)" apps/<application-code>/packages
rg -n "createSdkworkAppbase.*AuthRuntime|setTokenManager|tokenManager|createIamRuntime|createTokenManager|commitSession" apps/<application-code> apps/sdkwork-appbase
rg -n "@sdkwork/iam-sdk-adapter|createIamAppSdkAdapter|createIamBackendSdkAdapter" apps/<application-code>
rg -n "createTokenManager\\(|new .*TokenManager|setAuthToken|setAccessToken" apps/<application-code>
```

## 9. Consumer Import Naming

Application, feature, shell, service, bootstrap, and contract-test code `MUST` import HTTP SDK clients through scoped composed consumer packages. Generator transport package names are ownership/build artifacts only.

Authority for naming roles, physical layout, workspace registration, and verification: `SDK_PACKAGE_NAMING_SPEC.md`.

| Surface | Consumer import |
| --- | --- |
| App API | `@sdkwork/<application-code>-app-sdk` |
| Backend API (`backend-admin` only) | `@sdkwork/<application-code>-backend-sdk` |
| Open/domain API | `@sdkwork/<domain>-sdk` |

Rules:

- Each SDK family `MUST` expose a composed TypeScript facade at `sdks/sdkwork-<domain>-<surface>-sdk/sdkwork-<domain>-<surface>-sdk-typescript/src/index.ts` with `package.json#name` equal to the scoped consumer package.
- The composed facade `MUST` re-export generated transport from `generated/server-openapi/src/index.ts` and `MUST NOT` copy generated source into consumers.
- Consumer packages `MUST NOT` import `sdkwork-*-app-sdk-generated-typescript`, `sdkwork-*-backend-sdk-generated-typescript`, `sdkwork-*-sdk-generated-typescript`, or other generator transport names.
- Consumer packages `MUST NOT` deep-import `generated/server-openapi/src/*` when a composed facade exists for that SDK family.
- Vite, TypeScript, and test alias maps `MUST` target the composed facade entry (`src/index.ts`), not missing transport `dist/` exports.
- Workspace dependency keys, `component.spec.json#contracts.sdkClients`, and integration contract tests `MUST` use the same scoped consumer package names.

Forbidden examples:

```typescript
import { createClient } from 'sdkwork-skills-app-sdk-generated-typescript';
import { SdkworkAppClient } from 'sdkwork-mail-app-sdk-generated-typescript/src/sdk';
import { createClient } from '@sdkwork/commerce-app-sdk'; // retired
```

Required examples (IAM canonical reference):

```typescript
import { createClient, type SdkworkAppClient } from '@sdkwork/iam-app-sdk';
import type { SdkworkBackendClient } from '@sdkwork/iam-backend-sdk'; // backend-admin only
import { createClient as createCloudRouterDomainsClient } from '@sdkwork/cloudrouter-app-sdk/domains'; // federated T1 domains via Cloud Router
```

Verification:

```bash
node <sdkwork-specs>/tools/check-sdk-standard.mjs --workspace <workspace-root>
node <sdkwork-specs>/tools/check-sdk-standard.mjs --workspace <workspace-root> --fix
node <sdkwork-specs>/tools/check-app-sdk-consumer-imports.mjs --workspace <workspace-root>
node <sdkwork-specs>/tools/check-app-sdk-consumer-imports.mjs --workspace <workspace-root> --materialize-facades --align-alias-paths
```

Use `--materialize-facades` to create missing `src/index.ts` composed entries for `@sdkwork/*` SDK families. Use `--align-alias-paths` to rewrite consumer Vite/tsconfig/package alias paths from `generated/server-openapi` to composed facade entries before re-validating.

Composed facade physical layout (Cloud Router federated domains example):

```text
sdks/cloudrouter-app-sdk/cloudrouter-app-sdk-typescript/
  src/index.ts                    → @sdkwork/cloudrouter-app-sdk
  src/domains/index.ts            → @sdkwork/cloudrouter-app-sdk/domains
  generated/server-openapi/       → portal transport (generator ownership)
  generated/domains/server-openapi/ → federated domain transport (generator ownership)
```

Rules for composed facades:

- `src/index.ts` and optional subpaths such as `src/domains/index.ts` `MAY` re-export from `../generated/**` or `../../generated/domains/**` within the same `*-sdk-typescript` family root only.
- Composed facades `MUST NOT` import from sibling `*-domain-transport-typescript` directories or cross-family `../../*-typescript/generated` hops.
- Retired `@sdkwork/cloudrouter-*-domain-transport-sdk` packages and standalone `*-domain-transport-typescript` SDK family roots are forbidden; domain transport lives under `generated/domains/server-openapi/` inside the standard SDK family.

Retired commerce packages:

- `@sdkwork/commerce-app-sdk` and `@sdkwork/commerce-backend-sdk` are removed.
- Legacy `sdkwork-commerce-*-generated-typescript` transport names map to `@sdkwork/cloudrouter-app-sdk/domains` and `@sdkwork/cloudrouter-backend-sdk/domains`.
- Non-standard `@sdkwork/cloudrouter-*-domain-transport-sdk` packages are retired; use the `./domains` export on the standard Cloud Router SDK packages.

Authority: `SDK_SPEC.md` package naming table, `SDK_WORKSPACE_GENERATION_SPEC.md` composed facade rules, this section.

## 8. Acceptance Checklist

- [ ] Application root composes dependencies instead of copying source, routes, DTOs, or generated SDK output.
- [ ] Application-owned SDK families generate only application-owned operations.
- [ ] Dependency SDK families are declared through `sdkDependencies`, component specs, or approved composed wrappers.
- [ ] `dependencyApiExports` is explicit. Dependency APIs are not exported by default; configured
  exports live in authored composed wrappers, application core, service ports, or host adapters
  outside generated transport.
- [ ] Application/frontend core exports the application-owned app SDK and only the required dependency app SDK
  wrappers for app integration, including appbase app SDK when appbase IAM, current-user, workspace,
  contacts, or address-book resources are used.
- [ ] Backend SDK wrappers are exported only from `backend-admin` boundaries and are absent from app auth runtime, app packages, and user-facing console packages.
- [ ] Upload-capable apps declare Drive app SDK as a dependency, client upload services call `client.uploader.*`, Rust server upload services call the Drive server-side uploader service, and application-owned SDKs accept only Drive references or `MediaResource`.
- [ ] The selected UI architecture uses the matching generated SDK language and surface.
- [ ] Runtime/bootstrap declares or derives an SDK inventory and classifies each SDK credential mode before services are constructed.
- [ ] `resolve-composition.mjs` materializes `generated/composition.resolved.json#architecture` for component contracts, frontend packages, Rust crates, route manifests, and runtime dependency surfaces; generated output is not hand-edited.
- [ ] Runtime/bootstrap supports one common SDK base URL as the default and supports per-surface or per-SDK overrides for split and external dependency services.
- [ ] Application clients consume shared platform foundation APIs through
  generated SDKs bound to `platform.api-gateway`; standalone hosts embed only
  approved dependency API assemblies with verified same-origin coverage.
- [ ] Runtime/bootstrap uses the approved high-level IAM auth runtime/factory for the architecture and does not locally wire low-level IAM SDK adapters in application code.
- [ ] IAM application bootstrap uses `@sdkwork/iam-application-bootstrap` and passes `check-iam-application-bootstrap-standard.mjs`.
- [ ] Runtime/bootstrap creates exactly one global `TokenManager` per authenticated session context.
- [ ] Runtime/bootstrap creates or receives one i18n provider/locale provider and passes it to generated SDK clients and UI providers through approved runtime ports.
- [ ] Appbase app SDK, every application/dependency app SDK, explicit `backend-admin` appbase backend/application backend/dependency backend SDKs, and every approved composed wrapper backed by those SDKs share that same `TokenManager`.
- [ ] Authenticated SDKs, uploads, SSE, and WebSocket share one session recovery coordinator in addition to the TokenManager; `401` recovery, replay eligibility, terminal clearing, and reconnect stopping follow `IAM_LOGIN_INTEGRATION_SPEC.md` section 5.2.
- [ ] Protected open-api SDKs use a credential provider matching their declared auth mode; only an explicitly declared dual-token branch may join the app/backend TokenManager list, and its API-key state is mutually exclusive.
- [ ] Login, registration, session, refresh, logout, QR/OAuth, password reset, runtime metadata, and current-user self-service use appbase app SDK resources, while verification-code delivery uses the generated messaging app SDK surface.
- [ ] `backend-admin` IAM management uses appbase backend SDK and does not expose user-facing auth session creation.
- [ ] Rust route crates and route aggregation follow the route crate -> API authority -> SDK family model.
- [ ] Embedded Rust runtimes mount dependency-owned executable router/controller/service exports for
  every same-origin dependency surface; split/server runtimes configure the platform API surface that
  serves the dependency surface or explicit dependency SDK base URLs.
- [ ] Frontend services use injected SDK clients and no raw HTTP/manual auth or locale header fallback.
- [ ] Application consumers import scoped composed SDK packages (`@sdkwork/<application-code>-app-sdk`, `@sdkwork/<application-code>-backend-sdk`) and never generator transport names such as `sdkwork-*-generated-typescript`.
- [ ] Logout, refresh failure, token persistence failure, context rollback, stale context clearing, and refresh-token continuation behavior are tested.
