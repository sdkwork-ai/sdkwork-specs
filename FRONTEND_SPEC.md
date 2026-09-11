# Frontend and UI Service Standard

- Version: 1.0
- Scope: architecture-neutral UI-service-SDK layering, reusable UI modules, service facades, state, routing, accessibility, frontend tests
- Related: `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `APPLICATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MODULE_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, `BACKEND_UI_SPEC.md`, `SDK_SPEC.md`, `PAGINATION_SPEC.md`, `DRIVE_SPEC.md`, `MEDIA_RESOURCE_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `I18N_SPEC.md`, `CONFIG_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines the shared frontend rules for SDKWork modules. It is architecture-neutral and applies to app PC React, user console React, internal admin React, H5 mobile React, Flutter, mini program, native Android, native iOS, native HarmonyOS, and standalone backend/admin React packages. Platform-specific package placement, host adapters, tablet/desktop/mobile packaging, route projection, and interaction rules live in the architecture-specific standards. UI-service-SDK dependency direction follows `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`. Client application roots follow `COMPOSABLE_ARCHITECTURE_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, and their matching root architecture standard. Cross-architecture SDK composition, app dependency relationships, appbase IAM runtime, and global TokenManager wiring follow `APP_SDK_INTEGRATION_SPEC.md`. Cross-stack internationalization, locale fallback, message key ownership, and SDK locale propagation follow `I18N_SPEC.md`.

`UI_ARCHITECTURE_SPEC.md` is the required selection gate. Architecture-specific UI standards extend this common standard:

| UI architecture | Required spec | API surface |
| --- | --- | --- |
| App PC React | `APP_PC_ARCHITECTURE_SPEC.md`, then `APP_PC_REACT_UI_SPEC.md` | `/app/v3/api` through generated app SDK; supports web, desktop, and large-screen tablet renderer targets |
| PC user console React | `APP_PC_ARCHITECTURE_SPEC.md`, then `APP_PC_REACT_UI_SPEC.md` | `/app/v3/api` or approved console-facing app SDK surface; supports web, desktop, and large-screen tablet renderer targets |
| PC internal admin React | `APP_PC_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` | `backend-admin` surface; `/backend/v3/api` through generated backend SDK; supports web, desktop, and large-screen tablet renderer targets when enabled |
| H5 mobile React | `APP_H5_ARCHITECTURE_SPEC.md`, then `APP_MOBILE_REACT_UI_SPEC.md` | `/app/v3/api` through generated app SDK and H5/Capacitor host adapters |
| H5 user console React | `APP_H5_ARCHITECTURE_SPEC.md`, then `APP_MOBILE_REACT_UI_SPEC.md` | `/app/v3/api` or approved console-facing app SDK surface through generated app SDK and H5/Capacitor host adapters |
| H5 internal admin React | `APP_H5_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` | `backend-admin` surface; `/backend/v3/api` through generated backend SDK |
| App Flutter | `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_FLUTTER_UI_SPEC.md` | `/app/v3/api` through generated Dart/Flutter app SDK and platform adapters |
| Flutter user console | `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_FLUTTER_UI_SPEC.md` | `/app/v3/api` or approved console-facing app SDK surface through generated Dart/Flutter app SDK and platform adapters |
| Flutter internal admin | `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` | `backend-admin` surface; `/backend/v3/api` through generated Dart/Flutter backend SDK |
| Mini program app | `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, then `APP_MINI_PROGRAM_UI_SPEC.md` | `/app/v3/api` through generated TypeScript app SDK or approved mini program wrapper and host adapters |
| Mini program user console | `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, then `APP_MINI_PROGRAM_UI_SPEC.md` | `/app/v3/api` or approved console-facing app SDK surface through generated TypeScript app SDK or approved mini program wrapper and host adapters |
| Mini program internal admin | `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` | `backend-admin` surface; `/backend/v3/api` through generated backend SDK |
| Android native app | `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_ANDROID_NATIVE_UI_SPEC.md` | `/app/v3/api` through generated Kotlin/Java app SDK or approved Android wrapper and host adapters |
| Android native user console | `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_ANDROID_NATIVE_UI_SPEC.md` | `/app/v3/api` or approved console-facing app SDK surface through generated Kotlin/Java app SDK or approved Android wrapper and host adapters |
| Android native internal admin | `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` | `backend-admin` surface; `/backend/v3/api` through generated Kotlin/Java backend SDK |
| iOS native app | `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_IOS_NATIVE_UI_SPEC.md` | `/app/v3/api` through generated Swift app SDK or approved iOS wrapper and host adapters |
| iOS native user console | `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_IOS_NATIVE_UI_SPEC.md` | `/app/v3/api` or approved console-facing app SDK surface through generated Swift app SDK or approved iOS wrapper and host adapters |
| iOS native internal admin | `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` | `backend-admin` surface; `/backend/v3/api` through generated Swift backend SDK |
| Harmony native app | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_HARMONY_NATIVE_UI_SPEC.md` | `/app/v3/api` through generated ArkTS/TypeScript app SDK adapted for Harmony runtime or approved Harmony wrapper and host adapters |
| Harmony native user console | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_HARMONY_NATIVE_UI_SPEC.md` | `/app/v3/api` or approved console-facing app SDK surface through generated ArkTS/TypeScript app SDK adapted for Harmony runtime or approved Harmony wrapper and host adapters |
| Harmony native internal admin | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` | `backend-admin` surface; `/backend/v3/api` through generated Harmony-compatible backend SDK |
| Standalone backend/admin React | `BACKEND_UI_SPEC.md` | `backend-admin` surface; `/backend/v3/api` through generated backend SDK |

## 1. Layering

Standard frontend flow:

```text
App shell
  -> runtime providers
  -> appbase IAM runtime and global TokenManager
  -> feature routes/pages
  -> UI components
  -> services
  -> injected generated SDK clients
```

Rules:

- UI components `MUST` receive data, callbacks, and state through props, hooks, or providers.
- UI components `MUST NOT` call raw HTTP, manually set token or API key headers, parse JWTs for authorization, or choose tenant isolation rules.
- Services `MUST` call generated SDK clients or approved service interfaces.
- Runtime/bootstrap code `MUST` construct SDK clients, create the appbase IAM runtime, provide one global token manager for authenticated app-api SDK clients and explicit `backend-admin` backend-api SDK clients, provide token/context stores, and provide open-api credential providers when protected open-api SDKs are consumed.
- Runtime/bootstrap code `MUST` bind the same global token manager to `appbaseApp`, optional `backend-admin` `appbaseBackend`, every authenticated downstream app-api SDK client, and every explicit `backend-admin` backend-api SDK client through generated SDK credential APIs such as `setTokenManager`.
- IAM login/session bootstrap, AuthGate behavior, token refresh, logout clearing, and appbase auth UI/runtime integration `MUST` follow `IAM_LOGIN_INTEGRATION_SPEC.md`.
- App SDK and dependency composition `MUST` follow `APP_SDK_INTEGRATION_SPEC.md`; product UI packages consume dependency capabilities through generated SDKs, service ports, or approved composed wrappers.
- Feature packages `MUST` consume SDK capabilities through core public exports, injected SDK clients,
  declared service ports, or approved composed wrappers. They `MUST NOT` import generated SDK
  packages directly.
- Core and commons packages `MUST NOT` depend on capability packages. Host packages `MUST NOT`
  depend on business app/backend SDK packages.
- App shell code `MUST` stay thin: router, layout, providers, environment selection, host integration.
- Frontend work `MUST` select exactly one primary UI architecture through `UI_ARCHITECTURE_SPEC.md` before package placement.
- App/user-facing UI `MUST NOT` import `backend-admin` UI packages or call backend-api for user workflows.
- App/user-facing UI and user console UI `MUST` consume generated app SDK clients or approved appbase app wrappers for user-facing workflows, including contacts, address books, workspace navigation, and user-visible IAM directory read/list/tree resources. They `MUST NOT` import backend SDK packages, backend SDK wrapper functions, backend base URL resolvers, or appbase backend SDK clients.
- Every frontend package outside an explicit `backend-admin` boundary `MUST` use generated app SDK clients or approved app SDK wrappers for SDKWork remote capabilities. User-facing app packages, user console packages, shared frontend core packages, app auth runtime packages, and mobile/native/desktop renderer packages `MUST NOT` import, export, construct, proxy, or route through backend SDK clients.
- User console UI `MUST` stay in architecture-specific `console-<capability>` packages and must not import internal admin business internals.
- Internal admin UI is `backend-admin`. It `MUST` stay in architecture-specific `admin-<capability>` packages or standalone backend/admin packages and must follow backend-domain split rules from `BACKEND_UI_SPEC.md`.
- Standalone backend/admin UI `MUST NOT` be mixed into app UI packages and must follow business-domain backend package split rules from `BACKEND_UI_SPEC.md`.

## 1.1 UI Architecture Selection

Rules:

- PC React app UI uses `APP_PC_ARCHITECTURE_SPEC.md`, then `APP_PC_REACT_UI_SPEC.md`.
- PC user console UI uses `APP_PC_ARCHITECTURE_SPEC.md`, then `APP_PC_REACT_UI_SPEC.md`.
- PC internal admin UI uses `APP_PC_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md`.
- H5 mobile React app and user console UI use `APP_H5_ARCHITECTURE_SPEC.md`, then `APP_MOBILE_REACT_UI_SPEC.md`.
- H5 internal admin UI uses `APP_H5_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md`.
- Flutter app and user console UI use `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_FLUTTER_UI_SPEC.md`.
- Flutter internal admin UI uses `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md`.
- Mini program app and user console UI use `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, then `APP_MINI_PROGRAM_UI_SPEC.md`.
- Mini program internal admin UI uses `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md`.
- Android native app and user console UI use `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_ANDROID_NATIVE_UI_SPEC.md`.
- Android native internal admin UI uses `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md`.
- iOS native app and user console UI use `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_IOS_NATIVE_UI_SPEC.md`.
- iOS native internal admin UI uses `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md`.
- Harmony native app and user console UI use `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_HARMONY_NATIVE_UI_SPEC.md`.
- Harmony native internal admin UI uses `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md`.
- Standalone backend/admin React UI uses `BACKEND_UI_SPEC.md`.
- A package cannot implement more than one of these architecture families. Shared logic belongs in non-UI contracts or services.
- Shared common rules remain in this file; package naming, route ownership, host/platform adapters, and SDK surface selection come from the architecture-specific spec.

## 1.2 Frontend Package Role Dependency Matrix

Frontend modules compose like building blocks only when their dependency direction is visible from package names, `exports`, and `specs/component.spec.json`.

| Package role | Typical `contracts.layerRole` | May depend on | Must not depend on | SDK surface |
| --- | --- | --- | --- | --- |
| App shell/root | `frontend-shell` | core package, route contributions, providers, host adapters, generated app SDK construction in bootstrap | feature private `src/**`, generated transport internals, backend SDKs outside explicit `backend-admin` shell | app SDK by default; backend SDK only for declared `backend-admin` root |
| Core / console-core / admin-core | `frontend-core` | generated SDK facades, appbase runtime, module registry, host/session contracts | capability packages, feature pages, UI implementation internals | core exposes typed SDK/service ports; `admin-core` may expose backend SDK helpers only with `component.surface = "backend-admin"` |
| Commons / design primitives | `frontend-commons` | design tokens, domain-neutral components, utility packages, i18n primitives | business SDKs, capability packages, route ownership, auth/session state | no direct business API SDK |
| Feature/capability package | `frontend-feature` | core public exports, injected SDK clients, service ports, host adapter ports, local UI/state/i18n | generated SDK package imports, backend SDKs unless package is explicit admin, sibling feature private paths | app SDK or approved service facade; backend SDK only in explicit `backend-admin` package |
| User console package | `frontend-feature` | console core, app SDK resources, route/menu hints, inherited permission codes | internal admin packages, backend SDK wrappers, backend base URL resolvers | app SDK or approved console-facing app SDK |
| Internal admin package | `frontend-feature` | admin core, backend SDK clients, backend-admin service ports, route/menu permission hints | app/user workflow internals, app login/session creation, non-admin core helpers that hide backend SDKs | backend SDK through explicit `backend-admin` boundary |
| Host/native adapter | `frontend-host` | platform APIs, native bridges, storage adapters, host capability contracts | business SDK orchestration, permission decisions, domain service rules | no business SDK unless the adapter is the approved SDK bootstrap boundary |

Rules:

- Package role classification `MUST` be declared in `specs/component.spec.json` through `component.surface` and `contracts.layerRole` when SDK access, route exposure, or admin/user separation depends on it.
- Feature packages `MUST` import SDK access through core package public exports, injected clients, service ports, or approved composed wrappers. Direct generated SDK imports are forbidden even when the package manager can resolve them.
- Backend SDK imports require an explicit `backend-admin` package/component boundary. A route path, menu group, page title, or file name containing `admin` is not enough.
- Shared frontend code `MUST` stay installable without consuming application globals. Environment, endpoint, TokenManager, and open-api credential providers belong in bootstrap/runtime composition.
- `check-application-layering.mjs`, `check-frontend-composition.mjs`,
  `check-app-sdk-consumer-imports.mjs`, and `verify-repo.mjs` are the executable gates for this
  matrix.

## 2. Architecture-Neutral Package Shape

Recommended package structure:

```text
App-side packages:
packages/<architecture>/<domain>/<package>/
  package.json
  README.md
  src/
    index.ts
    components/
    hooks/
    pages/
    services/
    state/
    styles/
    types/
  tests/

PC application packages:
apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-<capability>/
apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-console-<capability>/
apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-admin-<capability>/

Client app-root package roles:
apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-<capability>/
apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-console-<capability>/
apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-admin-<capability>/
apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_<capability>/
apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_console_<capability>/
apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_admin_<capability>/
apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-<capability>/
apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-console-<capability>/
apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-admin-<capability>/
apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-<capability>/
apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-console-<capability>/
apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-admin-<capability>/
apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-<capability>/
apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-console-<capability>/
apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-admin-<capability>/
apps/sdkwork-<application-code>-harmony-mobile/packages/sdkwork-<application-code>-harmony-mobile-<capability>/
apps/sdkwork-<application-code>-harmony-mobile/packages/sdkwork-<application-code>-harmony-mobile-console-<capability>/
apps/sdkwork-<application-code>-harmony-mobile/packages/sdkwork-<application-code>-harmony-mobile-admin-<capability>/

Standalone backend/admin packages:
apps/sdkwork-backend-react-web/packages/sdkwork-react-backend-<domain>/
  package.json
  README.md
  src/
    index.ts
    components/
    hooks/
    pages/
    services/
    repository/
    routes/
    i18n/
    types/
  tests/
```

Architecture-specific standards may replace `package.json`, `src/`, and language folder names with Gradle/Kotlin, Swift Package, Dart, ArkTS, or mini program equivalents. The logical boundaries remain the same: public export, route/page/screen UI, services, state, host adapters, local view models, tests, and component specs.

Rules:

- `components/` contains reusable visual pieces.
- `pages/` contains route-level feature composition.
- `hooks/` contains React integration around services and state.
- `services/` contains SDK orchestration and domain methods.
- `state/` contains cache/view state only, not backend source-of-truth rules.
- `i18n/` contains package-local locale fragments and thin aggregation exports. It must follow the language/framework directory layout in `I18N_SPEC.md` section 6.1 and must not become an authored monolithic app or package catalog.
- `types/` contains local view models only. API DTOs come from generated SDKs or standard contracts.

The selected `architecture` must be one of:

- `pc-react`
- `pc-console-react`
- `pc-admin-react`
- `mobile-react`
- `mobile-console-react`
- `mobile-admin-react`
- `mobile-flutter`
- `mobile-console-flutter`
- `mobile-admin-flutter`
- `mini-program`
- `mini-program-console`
- `mini-program-admin`
- `android-native`
- `android-native-console`
- `android-native-admin`
- `ios-native`
- `ios-native-console`
- `ios-native-admin`
- `harmony-native`
- `harmony-native-console`
- `harmony-native-admin`
- `backend-admin-react`

## 3. SDK Client Injection

Frontend services `MUST` accept SDK clients or a narrow client interface.

```ts
export interface IamAppClientSurface {
  auth: {
    sessions: {
      create(body: unknown): Promise<unknown>;
      refresh(body: unknown): Promise<unknown>;
      delete(): Promise<void>;
    };
  };
  iam: {
    users: {
      current: {
        retrieve(): Promise<unknown>;
      };
    };
  };
}
```

Rules:

- Service interfaces `SHOULD` mirror generated SDK resource surfaces.
- Tests `SHOULD` provide fake clients implementing the same resource surface.
- Application-specific generated SDK constructors belong in runtime/bootstrap, not shared modules.
- Application-specific locale providers and SDK locale-provider construction belong in runtime/bootstrap, not shared modules.
- A module must not import a generated SDK package only to construct clients internally.
- Appbase login/session service ports `MUST` name the login authority `appbaseApp` or `appbaseAppClient`, not a generic `appClient`, so product SDK clients cannot be mistaken for the IAM authority.
- App-api service modules and explicit `backend-admin` backend-api service modules `MUST` receive token-manager-aware SDK clients from bootstrap. They must not create independent token stores, refresh flows, or login clients.
- Appbase current-user, login, registration, verification, OAuth, QR auth, password reset, refresh, current session, and logout calls `MUST` use appbase SDK resources or approved appbase wrappers.
- Services that consume protected open-api SDKs `MUST` receive injected SDK clients and an approved open-api credential provider from runtime/bootstrap. They `MUST NOT` receive raw API key or OAuth bearer strings from UI components or construct `X-API-Key` or `Authorization` headers manually.
- Frontend services MUST NOT generate `traceId`, `requestId`, `xRequestId`, `X-Request-Id`, or `x-request-id`, and MUST NOT pass generated SDK `xRequestId` params. They may generate business `Idempotency-Key` values for retriable commands and must read returned `traceId` values from `SdkWorkApiResponse.raw`, generated SDK error types, or `ProblemDetail` when correlation is needed.
- Frontend services MUST consume generated SDK unwrap behavior for `SdkWorkApiResponse` and MUST NOT parse legacy `success`, human `message`, `requestId`, `PlusApiResult`, `AppbaseApiResult`, or per-domain `*ApiResult` envelopes in business modules.
- Business services that consume protected open-api SDKs `MUST` use the same section 14 list/search input and section 15 unwrap semantics as app-api services unless the consumed operation is a vendor compatibility API declared with `x-sdkwork-wire-protocol: external` per `API_SPEC.md` section 4.5.2.
- UI error presentation SHOULD map `ProblemDetail.i18nKey` or numeric `ProblemDetail.code` to localized user-facing text through i18n keys such as `errors.result.<code>` (for example `errors.result.40001`). UI layers MUST NOT branch on HTTP 2xx legacy `success` flags, localized backend text, or string wire codes such as `validation_error`.
- Frontend services and UI components `MUST NOT` set locale request headers manually, including `Accept-Language` and any SDKWork-prefixed locale header. Locale propagation goes through the generated SDK locale provider wired by runtime/bootstrap, which owns the standard `Accept-Language` value.
- Frontend services `MUST` consume generated SDK operation methods that match `API_SPEC.md` section 15.4: `retrieve`, `list`, `search`, `create`, `update`, `delete`, domain command actions, and `bulk<Action>` where declared. They `MUST NOT` add raw HTTP fallbacks or local aliases such as `patchUser`, `replaceUser`, `deleteUserById`, or `batchCreateUsers` for SDKWork v3 APIs.
- Delete service methods `MUST` treat generated SDK `void`/`204` success as the normal result. They `MUST NOT` parse `{ success: true }`, `{ deleted: true }`, or command-style JSON bodies for delete success.
- Retriable create/command UI flows `MUST` create or receive one unpredictable business idempotency key at the logical action boundary and pass it through the generated SDK `idempotencyKey` input. Every retry of that action `MUST` reuse the same value; a distinct user action `MUST` receive a new value. Frontends `MUST NOT` generate `traceId`, `requestId`, or manual idempotency headers outside SDK-supported inputs.
- Update forms that edit versioned resources `MUST` preserve and pass the declared `version` or `ifMatch` precondition through the generated SDK/service contract. Silent last-write-wins updates are forbidden when the API declares optimistic concurrency.
- File upload, download, import, and generated-asset storage services `MUST` use generated Drive SDK clients governed by `DRIVE_SPEC.md`. All client-side uploads must go through `sdkwork-drive-app-sdk client.uploader.*`; UI-local `File`, object URL previews, upload progress, local resumable state, and presigned URLs must remain transient view or service state.
- Media upload, picker, import, and generated-asset services `MUST` use `MediaResource` contracts from `MEDIA_RESOURCE_SPEC.md` once data crosses the business service boundary.
- Frontend DTO field names for media should use natural business roles such as `avatar`, `cover`, `thumbnail`, `poster`, `video`, `audio`, `file`, `document`, `asset`, `mainImage`, `galleryImage`, `detailImage`, or `skuImage`. Do not use redundant names such as `coverMedia` when the type is already `MediaResource`.

### 3.1 Drive Uploader Services

Frontend upload services are thin domain facades over Drive Uploader.

Standard service flow:

```text
UI file picker / platform asset
  -> feature upload service supplies attribution and profile
  -> injected Drive app SDK client.uploader.* uploads/resumes/completes
  -> service normalizes Drive result to Drive reference or MediaResource
  -> business SDK command stores the business relation
```

Rules:

- Runtime/bootstrap owns the concrete Drive app SDK client and injects it into upload services with the same global TokenManager used by authenticated app-api SDKs.
- Upload services `MUST` use high-level methods such as `client.uploader.upload`, `uploadByProfile`, `uploadImage`, `uploadVideo`, `uploadAudio`, `uploadDocument`, `uploadArchive`, `uploadText`, `uploadDataset`, `uploadAttachment`, `uploadAvatar`, or `uploadThumbnail`.
- Upload services `MUST` supply business attribution such as `appId`, `appResourceType`, `appResourceId`, optional `scene`, optional `source`, `uploadProfileCode`, and retention from application context or feature configuration. They `MUST NOT` pass `tenantId`, `organizationId`, current `userId`, or equivalent authenticated identity as generated SDK method inputs; authenticated attribution comes from the shared TokenManager-backed request context.
- UI components `MUST NOT` assemble Drive Uploader request metadata except user-selected file facts and explicit field-level intent such as media role. Components do not own `appId`, `appResourceType`, `appResourceId`, `scene`, `source`, object keys, upload session ids, or retention policy.
- Feature code `MUST NOT` call raw `fetch`, `axios`, generic request clients, or handwritten SDKs against `/app/v3/api/drive/uploader/*`, `/app/v3/api/drive/upload_sessions/*`, S3, OSS, MinIO, local file-store, or provider presign endpoints. The Drive SDK composed uploader may perform the raw byte upload to the short-lived provider URL returned by Drive.
- Business form payloads `MUST` contain only Drive references, Drive-backed `MediaResource` values, or business relation ids after upload completion. They must not submit `File`, object URL, presigned URL, provider URL, bucket, object key, upload part list, or local uploader state.
- Product-specific upload widgets may exist, but they are UI wrappers over an injected upload service. They are not alternate upload engines.

## 4. State And Cache

Rules:

- Server state `SHOULD` be fetched through services and cached with a predictable query key strategy.
- Query keys `SHOULD` include domain, resource, tenant/organization scope when safe, and stable parameters.
- Auth/session state `MUST` react to token refresh, logout, tenant switch, and permission changes.
- Auth/session state `MUST` clear according to `IAM_LOGIN_INTEGRATION_SPEC.md`: persisted session, app-api SDK token managers, explicit `backend-admin` backend-api SDK token managers, approved open-api credential provider state when present, realtime connections, sensitive caches, and native secure storage when present.
- UI-only state may be local component state.
- Sensitive state `MUST` be cleared on logout and tenant switch.
- Media preview object URLs, drag/drop files, upload queue progress, retry counters, and presigned upload URLs are UI-only or service-local state. They must not be cached as persisted server state or submitted as business media identity.
- Persisted media cache entries should key by stable Drive `driveUri`, `driveNodeId`, `MediaResource.id`, `objectBlobId`, provider `uri`, or the owning resource plus media role, not by signed delivery URL.
- Browser code `MUST NOT` construct provider object keys, call object storage provider SDKs directly, or store Drive presigned URLs as server state. Missing upload/download behavior must be added to Drive SDK contracts.

## 5. Errors And Empty States

Rules:

- SDK `application/problem+json` errors `MUST` be mapped to stable user-facing service errors.
- UI must handle loading, empty, permission-denied, validation-error, offline/unavailable, and unknown-error states for reusable flows.
- UI must not display stack traces, raw SQL, raw provider responses, tokens, or internal exception details.
- Retry UI `SHOULD` be used only for idempotent or safe operations.

## 6. Authorization UX

Rules:

- Frontend permission checks are hints for navigation and affordances only.
- Server-side authorization remains mandatory.
- Disabled or hidden UI actions `SHOULD` map to permission codes such as `iam.users.read`.
- Tenant and organization switchers `MUST` trigger service/cache invalidation.
- Cross-tenant or platform-admin UI must make scope visible to operators.

## 7. Accessibility, Internationalization, And Design

Rules:

- Interactive controls `MUST` be keyboard reachable.
- Forms `MUST` connect labels, validation messages, and field descriptions.
- Icon-only buttons `MUST` have accessible names and tooltips where helpful.
- Reusable modules `SHOULD` accept i18n text providers or message catalogs instead of hard-coded L1 brand/store copy.
- Reusable modules `MUST` keep locale resources in package-local fragments defined by `I18N_SPEC.md` section 6.1; root-level aggregators and platform resource bundles must be thin or generated.
- Frontend runtime providers `MUST` resolve locale fallback centrally and must not let individual components import fallback locale fragments directly.
- Cross-client workflows `SHOULD` share stable route title keys, permission hint keys, validation keys, and error keys while each platform keeps its own package-local resource format.
- Text must fit responsive containers without overlap.
- Design tokens and component primitives should be imported from the app's design system rather than redefined locally.

## 8. Host And Platform Boundaries

Rules:

- Native host calls `MUST` go through host adapters.
- Desktop hosts (Tauri and Electron) `MUST` expose the shared host adapter contract from `@sdkwork/desktop-host-contract`; feature packages consume injected host interfaces only and `MUST NOT` reference `window.__TAURI__`, `window.electron`, `ipcRenderer`, or import `@tauri-apps/api` / `electron` directly. Both hosts must satisfy the same `DesktopHost` interface so feature code compiles unchanged against either host.
- Capability availability is declared through the host `capabilities` set or a shared capability helper; hand-written platform branches on host globals are forbidden. Unsupported capabilities degrade through fallback adapters with stable error codes (`unsupported`, `permission-denied`, `unavailable`, `cancelled`, `invalid-state`).
- Host adapters `MUST NOT` enforce business authorization in place of backend checks.
- Secure storage for tokens `SHOULD` use host-provided secure storage where available.
- Local Rust backend client construction belongs in runtime/bootstrap.
- File, process, window, browser, mobile, and OS permissions must be explicit and reviewed.

### 8.1 List And Search Pagination

Interactive list UIs and frontend feature services `MUST` follow `PAGINATION_SPEC.md` §8 and `API_SPEC.md` §14.1/§16.

Rules:

- table, feed, and infinite-scroll lists `MUST` request one server page at a time using `page`/`page_size` or `cursor`/`page_size` through generated SDK clients;
- frontend services `MUST NOT` hand-build `pageSize`, `limit`, `page_no`, `pageNo`, `per_page`, `size`, or numeric-cursor pagination compatibility query strings. When a service builds a URL directly for a standard SDKWork API, it must use `page_size` exactly;
- services `MUST` propagate `pageInfo.nextCursor` or increment `page` until `hasMore` is false;
- `listAll*`, `fetchAll*`, or equivalent helpers `MUST NOT` back normal paginated UI browsing;
- client-side `Array.prototype.slice`, manual offset math, or virtual paging over a fully downloaded array `MUST NOT` replace server pagination;
- bulk export/admin scripts that intentionally iterate all pages `MUST` be explicit, cancellable, and documented — not hidden inside shared list services used by interactive screens.

## 9. Acceptance Checklist

- [ ] UI-service-SDK boundaries are respected.
- [ ] SDK clients are injected.
- [ ] Appbase IAM runtime and one global token manager are wired in runtime/bootstrap when authenticated app-api SDK clients or explicit `backend-admin` backend-api SDK clients are used.
- [ ] Architecture-specific SDK language and dependency SDK composition follow `APP_SDK_INTEGRATION_SPEC.md`.
- [ ] No raw HTTP, manual auth headers, or manual API key headers exist in shared business modules.
- [ ] `node ../sdkwork-specs/tools/check-application-layering.mjs --root .` passes for UI raw HTTP and service SDK injection boundaries.
- [ ] `node ../sdkwork-specs/tools/check-frontend-composition.mjs --root .` passes for frontend
      package role, dependency direction, core export, and SDK import boundaries.
- [ ] Upload services use injected Drive app SDK `client.uploader.*`, supply required attribution/profile/retention metadata, and persist only Drive references or `MediaResource`.
- [ ] UI upload components keep files, previews, progress, retry state, and presigned URLs transient.
- [ ] Auth/session/tenant switch clears sensitive state.
- [ ] Permission-denied and validation-error states are covered.
- [ ] Keyboard and accessible labels are covered for interactive controls.
- [ ] Authored frontend i18n resources follow the selected language/framework layout from `I18N_SPEC.md` section 6.1 and generated platform bundles are thin or generated.
- [ ] Tests cover service behavior and representative UI integration.
- [ ] Interactive lists use server pagination (`cursor`/`page`) and do not slice full client arrays (`PAGINATION_SPEC.md`).
- [ ] Frontend services do not emit `pageSize` or `limit` query aliases for SDKWork list/search APIs.
- [ ] Frontend services call generated SDK operation methods aligned with `API_SPEC.md` section 15.4 and do not parse legacy delete/create/update/command response bodies.
- [ ] Retriable commands use SDK-supported idempotency options only; UI code does not generate `traceId`, `requestId`, or manual auth/idempotency headers.
