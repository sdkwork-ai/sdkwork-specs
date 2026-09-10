# UI Architecture Selection Standard

- Version: 1.0
- Scope: UI architecture selection, package-family ownership, app/backend surface separation, SDK boundary verification
- Related: `FRONTEND_SPEC.md`, `APPLICATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `UNIAPP_APP_ARCHITECTURE_SPEC.md`, `UNITY_APP_ARCHITECTURE_SPEC.md`, `APP_STATIC_WEB_ARCHITECTURE_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, `BACKEND_UI_SPEC.md`, `SDK_SPEC.md`, `API_SPEC.md`, `TEST_SPEC.md`

This standard is the required entrypoint for UI package placement. It decides which architecture-specific UI standard owns the work. It does not replace the detailed UI standards; it prevents package drift before files are created.

For client application roots, apply `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` and the matching root architecture standard before choosing the detailed UI package standard. PC roots apply `APP_PC_ARCHITECTURE_SPEC.md`; H5/Capacitor roots apply `APP_H5_ARCHITECTURE_SPEC.md`; Flutter mobile roots apply `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`; mini program roots apply `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`; native Android roots apply `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`; native iOS roots apply `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`; native HarmonyOS roots apply `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`; uni-app roots apply `UNIAPP_APP_ARCHITECTURE_SPEC.md`; Unity roots apply `UNITY_APP_ARCHITECTURE_SPEC.md`; static web (pure HTML) roots apply `APP_STATIC_WEB_ARCHITECTURE_SPEC.md`. The uni-app, Unity, and static web root standards own their package-local UI rules directly; no separate detailed UI standard exists for those architectures.

## 1. Selection Gate

Every UI change `MUST` declare exactly one primary UI architecture before implementation starts.

| Primary architecture | Owning package family | API surface | SDK language and boundary | IAM/appbase boundary | Detailed standard |
| --- | --- | --- | --- | --- | --- |
| Cross-architecture shared packages | `apps/sdkwork-<application-code>-common/packages/sdkwork-<capability>` | contract/service only | generated SDK ports/adapters, no UI runtime | `@sdkwork/iam-runtime`, `@sdkwork/iam-contracts`, service ports | `APPLICATION_SPEC.md`, `MODULE_SPEC.md` |
| App PC React | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-<capability>` | `/app/v3/api` | generated TypeScript app SDK or approved appbase wrapper | `@sdkwork/iam-runtime`, `@sdkwork/iam-react`, `@sdkwork/auth-pc-react`, global TokenManager | `APP_PC_ARCHITECTURE_SPEC.md`, then `APP_PC_REACT_UI_SPEC.md` |
| PC user console React | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-console-<capability>` | `/app/v3/api` or approved console-facing app SDK surface | generated TypeScript app SDK or approved appbase/console wrapper | appbase IAM runtime, console route guards, global TokenManager | `APP_PC_ARCHITECTURE_SPEC.md`, then `APP_PC_REACT_UI_SPEC.md` |
| PC internal admin React | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-admin-<capability>` | `/backend/v3/api` | generated TypeScript backend SDK or approved backend wrapper for `backend-admin` | appbase backend SDK for IAM administration; no user-facing auth sessions | `APP_PC_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` |
| H5 mobile React | `apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-<capability>` | `/app/v3/api` | generated TypeScript app SDK plus typed H5/Capacitor host adapters | appbase mobile wrapper or approved appbase IAM runtime adapter, global TokenManager | `APP_H5_ARCHITECTURE_SPEC.md`, then `APP_MOBILE_REACT_UI_SPEC.md` |
| H5 user console React | `apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-console-<capability>` | `/app/v3/api` or approved console-facing app SDK surface | generated TypeScript app SDK plus typed H5/Capacitor host adapters | appbase mobile wrapper or approved appbase IAM runtime adapter, console route guards, global TokenManager | `APP_H5_ARCHITECTURE_SPEC.md`, then `APP_MOBILE_REACT_UI_SPEC.md` |
| H5 internal admin React | `apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-admin-<capability>` | `/backend/v3/api` | generated TypeScript backend SDK or approved backend wrapper for `backend-admin` | appbase backend SDK for IAM administration; no user-facing auth sessions | `APP_H5_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` |
| App Flutter | `apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_<capability>` | `/app/v3/api` | generated Dart/Flutter app SDK plus platform adapters | generated Dart/Flutter appbase SDK or approved appbase Flutter wrapper, global token-manager equivalent | `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_FLUTTER_UI_SPEC.md` |
| Flutter user console | `apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_console_<capability>` | `/app/v3/api` or approved console-facing app SDK surface | generated Dart/Flutter app SDK plus platform adapters | generated Dart/Flutter appbase SDK or approved appbase Flutter wrapper, console route guards, global token-manager equivalent | `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_FLUTTER_UI_SPEC.md` |
| Flutter internal admin | `apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_admin_<capability>` | `/backend/v3/api` | generated Dart/Flutter backend SDK or approved backend wrapper for `backend-admin` | generated appbase backend SDK or approved backend wrapper for IAM administration; no user-facing auth sessions | `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` |
| Mini program app | `apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-<capability>` | `/app/v3/api` | generated TypeScript app SDK adapted for mini program runtime plus typed mini program host adapters | appbase mini program wrapper or approved appbase IAM runtime adapter, global TokenManager equivalent | `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, then `APP_MINI_PROGRAM_UI_SPEC.md` |
| Mini program user console | `apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-console-<capability>` | `/app/v3/api` or approved console-facing app SDK surface | generated TypeScript app SDK adapted for mini program runtime plus typed mini program host adapters | appbase mini program wrapper or approved appbase IAM runtime adapter, console route guards, global TokenManager equivalent | `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, then `APP_MINI_PROGRAM_UI_SPEC.md` |
| Mini program internal admin | `apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-admin-<capability>` | `/backend/v3/api` | generated TypeScript backend SDK adapted for mini program runtime or approved backend wrapper for `backend-admin` | appbase backend SDK or approved backend wrapper for IAM administration; no user-facing auth sessions | `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` |
| Android native app | `apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-<capability>` | `/app/v3/api` | generated Kotlin/Java app SDK plus typed Android host adapters | generated Kotlin/Java appbase SDK or approved appbase Android wrapper, global token-manager equivalent | `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_ANDROID_NATIVE_UI_SPEC.md` |
| Android native user console | `apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-console-<capability>` | `/app/v3/api` or approved console-facing app SDK surface | generated Kotlin/Java app SDK plus typed Android host adapters | generated Kotlin/Java appbase SDK or approved appbase Android wrapper, console route guards, global token-manager equivalent | `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_ANDROID_NATIVE_UI_SPEC.md` |
| Android native internal admin | `apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-admin-<capability>` | `/backend/v3/api` | generated Kotlin/Java backend SDK or approved backend wrapper for `backend-admin` | generated appbase backend SDK or approved backend wrapper for IAM administration; no user-facing auth sessions | `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` |
| iOS native app | `apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-<capability>` | `/app/v3/api` | generated Swift app SDK plus typed iOS host adapters | generated Swift appbase SDK or approved appbase iOS wrapper, global token-manager equivalent | `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_IOS_NATIVE_UI_SPEC.md` |
| iOS native user console | `apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-console-<capability>` | `/app/v3/api` or approved console-facing app SDK surface | generated Swift app SDK plus typed iOS host adapters | generated Swift appbase SDK or approved appbase iOS wrapper, console route guards, global token-manager equivalent | `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_IOS_NATIVE_UI_SPEC.md` |
| iOS native internal admin | `apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-admin-<capability>` | `/backend/v3/api` | generated Swift backend SDK or approved backend wrapper for `backend-admin` | generated appbase backend SDK or approved backend wrapper for IAM administration; no user-facing auth sessions | `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` |
| Harmony native app | `apps/sdkwork-<application-code>-harmony-mobile/packages/sdkwork-<application-code>-harmony-mobile-<capability>` | `/app/v3/api` | generated ArkTS/TypeScript app SDK adapted for Harmony runtime plus typed HarmonyOS host adapters | appbase Harmony wrapper or approved appbase ArkTS adapter, global token-manager equivalent | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_HARMONY_NATIVE_UI_SPEC.md` |
| Harmony native user console | `apps/sdkwork-<application-code>-harmony-mobile/packages/sdkwork-<application-code>-harmony-mobile-console-<capability>` | `/app/v3/api` or approved console-facing app SDK surface | generated ArkTS/TypeScript app SDK adapted for Harmony runtime plus typed HarmonyOS host adapters | appbase Harmony wrapper or approved appbase ArkTS adapter, console route guards, global token-manager equivalent | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_HARMONY_NATIVE_UI_SPEC.md` |
| Harmony native internal admin | `apps/sdkwork-<application-code>-harmony-mobile/packages/sdkwork-<application-code>-harmony-mobile-admin-<capability>` | `/backend/v3/api` | generated Harmony-compatible backend SDK or approved backend wrapper for `backend-admin` | appbase backend SDK or approved backend wrapper for IAM administration; no user-facing auth sessions | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` |
| uni-app app | `apps/sdkwork-<application-code>-uniapp/packages/sdkwork-<application-code>-uniapp-<capability>` | `/app/v3/api` | generated TypeScript app SDK adapted for uni-app runtime plus typed uni-app host adapters | appbase uni-app wrapper or approved appbase IAM runtime adapter, global TokenManager equivalent | `UNIAPP_APP_ARCHITECTURE_SPEC.md` |
| uni-app user console | `apps/sdkwork-<application-code>-uniapp/packages/sdkwork-<application-code>-uniapp-console-<capability>` | `/app/v3/api` or approved console-facing app SDK surface | generated TypeScript app SDK adapted for uni-app runtime plus typed uni-app host adapters | appbase uni-app wrapper or approved appbase IAM runtime adapter, console route guards, global TokenManager equivalent | `UNIAPP_APP_ARCHITECTURE_SPEC.md` |
| uni-app internal admin | `apps/sdkwork-<application-code>-uniapp/packages/sdkwork-<application-code>-uniapp-admin-<capability>` | `/backend/v3/api` | generated TypeScript backend SDK adapted for uni-app runtime or approved backend wrapper for `backend-admin` | appbase backend SDK or approved backend wrapper for IAM administration; no user-facing auth sessions | `UNIAPP_APP_ARCHITECTURE_SPEC.md`, then `BACKEND_UI_SPEC.md` |
| Unity app | `apps/sdkwork-<application-code>-unity/Packages/com.sdkwork.<application-code>-unity-<capability>` | `/app/v3/api` | generated C# app SDK or approved Unity wrapper plus typed Unity host adapters | appbase Unity wrapper or approved appbase C# adapter, global token-manager equivalent backed by secure storage | `UNITY_APP_ARCHITECTURE_SPEC.md` |
| Static web (pure HTML) | `apps/sdkwork-<application-code>-static-web/packages/sdkwork-<application-code>-static-web-<page-group>` | declared public/open-api surfaces only, or build-time content | generated public/open-api SDK clients loaded through `core` runtime config, or build-time generated content; no session/TokenManager | no user auth sessions; content-only boundary | `APP_STATIC_WEB_ARCHITECTURE_SPEC.md` |
| Backend/admin React | `apps/sdkwork-backend-react-web/packages/sdkwork-react-backend-<domain>` | `/backend/v3/api` | generated TypeScript backend SDK or approved backend wrapper for `backend-admin` | appbase backend SDK for IAM administration; no user-facing auth sessions | `BACKEND_UI_SPEC.md` |

Rules:

- A single UI package `MUST NOT` mix app UI and backend/admin UI.
- A single UI package `MUST NOT` mix PC React, H5 mobile React, Flutter, mini program, uni-app, Unity, static web, Android native, iOS native, Harmony native, and backend/admin React implementations.
- Cross-architecture reuse belongs in contract, service, i18n, token, or generated SDK packages with no UI imports.
- If an existing package path does not match the selected architecture, move or wrap the capability before adding new business behavior.
- User-facing auth, registration, session, OAuth, verification-code login, QR login, password reset, and current user flows belong to app UI and app-api.
- Client app-root packages without `console` or `admin` role segments are app/user packages by default.
- Client `console` packages are user-facing management console packages for customers, tenants, app owners, or app users who manage their own resources. They use the same technology-specific UI package rules as app packages and remain app-api/app SDK consumers.
- Client `admin` packages are `backend-admin` company-internal staff/operator packages for operations, support, audit, platform administration, moderation, and internal control. They use backend-api/backend SDK boundaries.
- `backend-admin` means admin-only backend UI/API/SDK use for internal staff, operators, support, auditors, platform administrators, or trusted backend services acting for those admin workflows. User console packages are not `backend-admin`.
- Every UI package outside an explicit `backend-admin` boundary `MUST` use app-api through generated app SDK clients or approved app SDK wrappers. Non-admin UI packages `MUST NOT` import, export, construct, or wrap backend SDK clients, appbase backend SDK clients, backend wrapper functions, backend generated SDK packages, or backend base URL resolvers.
- Operator-only configuration, audit, provider binding, tenant administration, resource moderation, and platform management belong to `backend-admin` UI and backend-api.

## 2. Package Ownership

UI package ownership is domain-first and architecture-second.

Rules:

- Domain names `MUST` come from `DOMAIN_SPEC.md`.
- App UI packages `MUST` be split by user-facing domain and capability.
- Client app-root packages `MUST` follow `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` for core, commons, shell, capability, optional console/admin, host package roles, route id, and dependency direction.
- Backend/admin UI packages are `backend-admin` packages. They `MUST` be split as `@sdkwork/react-backend-<domain>` and aligned with permission prefixes.
- Client user-facing console packages `MUST` be split with the architecture-specific `console-<capability>` role, such as `sdkwork-<application-code>-pc-console-<capability>`, `sdkwork-<application-code>-h5-console-<capability>`, or `sdkwork_<application_code>_flutter_mobile_console_<capability>`. They must not be named or treated as internal admin packages.
- Client internal admin packages are `backend-admin` packages. They `MUST` be split with the architecture-specific `admin-<capability>` role, such as `sdkwork-<application-code>-pc-admin-<capability>`, `sdkwork-<application-code>-android-mobile-admin-<capability>`, or `sdkwork_<application_code>_flutter_mobile_admin_<capability>`. They must not be placed in user app or console package families.
- `@sdkwork/react-backend-ui` may contain only domain-neutral primitives.
- `@sdkwork/react-backend-core` may contain only SDK/runtime/provider infrastructure.
- Packages named `common`, `misc`, `manager`, `base`, `core`, `admin`, `backend`, or `console` `MUST NOT` own business pages, business services, repositories, route records, menu records, permission constants, or domain i18n unless a root spec explicitly defines their bounded context.
- Multi-domain screens `MUST` compose public exports from domain packages. They must not create a new catch-all business package.

## 3. SDK Boundary

UI architecture decides the SDK surface.

| UI package type | Must use | Must not use |
| --- | --- | --- |
| App PC React | injected app SDK client or appbase service wrapper | backend SDK, backend UI packages, raw HTTP |
| PC user console React | injected app SDK client or approved console-facing appbase app wrapper | admin package internals, backend SDK packages, appbase backend SDK clients, backend wrapper functions, raw HTTP |
| PC internal admin React | injected backend SDK client or backend-core/admin wrapper | app SDK login/session creation, app/console package internals, raw HTTP |
| H5/Flutter/mini program/native user console packages | injected app SDK client or approved console-facing appbase app wrapper for the selected architecture | admin package internals, backend SDK packages, appbase backend SDK clients, backend wrapper functions, raw HTTP |
| H5/Flutter/mini program/native internal admin packages | injected backend SDK client or backend-core/admin wrapper for the selected architecture | app SDK login/session creation, app/console package internals, raw HTTP |
| H5 mobile React | injected app SDK client, typed H5/Capacitor host adapters | backend SDK, backend UI packages, native globals for business API calls |
| App Flutter | generated Dart/Flutter app SDK, platform adapter interfaces | backend SDK, React packages, raw `http` calls for app business |
| Mini program app | injected app SDK client or approved mini program wrapper, typed mini program host adapters | backend SDK for user workflows, platform globals in feature code, raw request APIs for business |
| Android native app | generated Kotlin/Java app SDK, typed Android host adapter interfaces | backend SDK for user workflows, React/Flutter/iOS/Harmony packages, raw OkHttp/Retrofit calls for app business |
| iOS native app | generated Swift app SDK, typed iOS host adapter interfaces | backend SDK for user workflows, React/Flutter/Android/Harmony packages, raw URLSession calls for app business |
| Harmony native app | generated ArkTS/TypeScript app SDK adapted for Harmony runtime, typed HarmonyOS host adapter interfaces | backend SDK for user workflows, React/Flutter/Android/iOS packages, raw request APIs for app business |
| uni-app app | injected app SDK client or approved uni-app wrapper through the core transport adapter, typed uni-app host adapters | backend SDK for user workflows, platform globals and `uni.*` in feature code, raw request APIs for business |
| Unity app | generated C# app SDK through the core transport adapter, typed Unity host adapter interfaces | backend SDK for user workflows, React/Flutter/native packages, raw `UnityWebRequest` calls for app business |
| Static web (pure HTML) | `core`-loaded public/open-api clients from runtime config, or build-time content | app/backend SDK session surfaces, protected API calls, inline hardcoded API origins, secrets in output |
| Backend/admin React | injected backend SDK client or backend-core wrapper | app SDK for operator resources, app UI packages, raw HTTP |

Rules:

- UI components call hooks/services. Services call injected SDK clients.
- Missing SDK methods `MUST` be fixed in the owning app-api, backend-api, or approved open-api OpenAPI contract and generator flow.
- Handwritten raw HTTP fallbacks, manual token/API key headers, local DTO forks, and generated SDK output edits are forbidden for UI business flows.
- Runtime/bootstrap constructs concrete SDK clients. Reusable UI packages receive typed clients, services, or providers.
- Runtime/bootstrap `MUST` apply `APP_SDK_INTEGRATION_SPEC.md`: create one global token manager for authenticated app-api SDK clients and explicit `backend-admin` backend-api SDK clients, bind it to appbase and downstream SDK clients, and keep protected open-api credentials in a separate provider matching the declared auth mode.
- Appbase IAM login, registration, session, refresh, logout, verification, OAuth, QR auth, password reset, runtime metadata, and current-user self-service `MUST` remain appbase app SDK or approved appbase wrapper responsibilities.
- App/user-facing UI, user console UI, mobile/native/desktop renderer UI, and shared frontend UI packages `MUST` use generated app SDK clients or approved app SDK wrappers for SDKWork remote capabilities. They are not allowed to use backend SDKs unless the package is explicitly a `backend-admin` package.
- Appbase app-side IAM directory resources for contacts, address books, workspace navigation, customer-owned management views, and organization/department tree reads `MUST` remain app SDK resources in app and user-facing console UI. A UI package must not switch to backend SDK merely because the resource belongs to the IAM domain.
- `backend-admin` IAM management `MUST` use appbase backend SDK resources and must not expose or consume user-facing `auth.sessions.create` through backend SDKs.
- Backend SDK wrappers `MUST` be exported and imported only through `backend-admin` package boundaries. Architecture-specific `*-admin-*` packages, Dart `_admin_` packages, and standalone backend/admin React domain packages are `backend-admin`; core packages, app auth runtime, default app packages, and user console packages must keep exporting and consuming app SDK/appbase app SDK wrappers instead.
- The generated SDK language must match the selected architecture: TypeScript for React packages and mini program packages, Dart/Flutter for Flutter packages, Kotlin/Java for Android native packages, Swift for iOS native packages, ArkTS/TypeScript adapted for Harmony native packages, and Rust SDKs or Rust service clients for Rust/native runtime code.
- When a UI/service package consumes a protected open-api SDK, it `MUST` receive an injected open-api SDK client and approved open-api credential provider through runtime/bootstrap. It `MUST NOT` place that SDK in app/backend token-manager client lists or assemble `X-API-Key` or OAuth bearer headers directly.

## 4. Visual And Interaction Boundary

Architecture standards own platform-specific interaction rules.

Rules:

- App PC React optimizes for keyboard, pointer, route persistence, dense desktop layout, multitasking, and adaptive iPadOS/Android tablet large-screen behavior when those targets are enabled.
- H5 mobile React optimizes for touch, safe areas, compact widths, H5/Capacitor host adapters, and app lifecycle transitions.
- App Flutter optimizes for platform widgets, responsive mobile/tablet/foldable/desktop surfaces, and platform adapter interfaces.
- Mini program app optimizes for platform page/subpackage constraints, touch, safe areas, platform permission prompts, and platform review/package-size requirements.
- Android native app optimizes for Android touch, window insets, Compose/View lifecycle, activity/process transitions, permissions, intents, Play/private distribution, and Android host adapters.
- iOS native app optimizes for SwiftUI/UIKit navigation, safe areas, Dynamic Type, foreground/background transitions, universal links, App Store/TestFlight/private distribution, and iOS host adapters.
- Harmony native app optimizes for ArkUI navigation, safe areas, foldable/device profiles, ability lifecycle, wants/deep links, AppGallery/private distribution, and HarmonyOS host adapters.
- uni-app app optimizes for touch, rpx layout, safe areas, `pages.json`/tabBar placement, subpackage size budgets, and one-source delivery across H5, mini program, and App targets.
- Unity app optimizes for scene/address navigation, frame budgets, asset/addressables governance, gamepad/touch/pointer input profiles, and platform store or mini-game delivery constraints.
- Static web optimizes for progressive enhancement (content visible without JavaScript), SEO/canonical/sitemap correctness, CSP-compatible markup, cache-friendly asset paths, and locale-prefixed static delivery.
- Backend/admin React optimizes for dense, flat, operational workflows with tables, filters, drawers, dialogs, tabs, and repeated administrative actions.
- Shared visual tokens may be common, but package-local global themes, reset CSS, and shell layout overrides are forbidden in domain packages.

## 5. Required Verification

Every touched UI package `MUST` prove the selected architecture boundary.

| Verification | Required evidence |
| --- | --- |
| Package family | Static scan or component spec proves the package path matches the selected architecture. |
| SDK surface | Service tests use fake or generated SDK clients matching the selected SDK surface. |
| No bypass | Static scan proves no raw HTTP, manual token/API key headers, backend/app cross-surface calls, open-api token-manager misuse, or generated SDK edits were introduced. |
| Domain split | Backend/admin business code is not placed in `@sdkwork/react-backend-ui`, `@sdkwork/react-backend-core`, or any catch-all package. |
| UI states | Tests cover loading, empty, validation-error, permission-denied, unavailable, and unknown-error states where applicable. |
| i18n | User-facing or operator-facing copy lives in package-local i18n fragments or configured message catalogs that follow `I18N_SPEC.md`; app/root/package locale monoliths are rejected unless generated from fragments. |

## 6. Acceptance Checklist

- [ ] Exactly one primary UI architecture was selected.
- [ ] The package path matches the selected architecture table.
- [ ] The detailed architecture standard was applied.
- [ ] Client app roots applied `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` and their root architecture standard before detailed package work.
- [ ] Architecture-specific generated SDK language and appbase IAM boundary follow `APP_SDK_INTEGRATION_SPEC.md`.
- [ ] Domain ownership follows `DOMAIN_SPEC.md`.
- [ ] App UI uses app-api/app SDK only for user-facing workflows.
- [ ] User console UI uses app-api/app SDK or approved appbase app wrappers only, including user-visible IAM directory/contact resources.
- [ ] `backend-admin` UI uses backend-api/backend SDK only for `backend-admin` operator workflows.
- [ ] Backend/admin business UI is split by `@sdkwork/react-backend-<domain>`.
- [ ] No catch-all business package was introduced.
- [ ] No raw HTTP, manual auth/API key header, DTO fork, open-api token-manager misuse, or generated SDK edit was introduced.
- [ ] i18n resources are package-local fragments with thin aggregators, not authored app/root/package locale monoliths.
- [ ] Tests or scans prove package placement, SDK boundary, and representative UI states.
