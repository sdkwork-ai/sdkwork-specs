# App Android Native UI Standard

- Version: 1.1
- Scope: app/user-facing and Android user-console native packages, Jetpack Compose or Android View UI, generated Kotlin/Java app SDK integration, Android host adapters, mobile interaction, and package-local state
- Related: `API_SPEC.md`, `APPLICATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `COMPONENT_SPEC.md`, `CONFIG_SPEC.md`, `DOMAIN_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `ICON_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `I18N_SPEC.md`, `MODULE_SPEC.md`, `NAMING_SPEC.md`, `SDK_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines how SDKWork app-side and Android user-console native UI is packaged and integrated. In application roots it is applied after `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`; in shared package families it remains the detailed Android native package standard. Android UI packages are app/user-facing or user-console packages and consume app-api through generated Kotlin/Java app SDK clients or approved appbase Android wrappers. They must not consume `backend-admin` UI packages or backend SDKs for user-facing workflows.

This standard is selected through `UI_ARCHITECTURE_SPEC.md` and applies only to app/user-facing and user-console Android native packages. Android admin packages are `backend-admin` packages and must also follow `BACKEND_UI_SPEC.md`.

Canonical app-root Android package shape:

```text
apps/sdkwork-<application-code>-android-mobile/
  packages/
    sdkwork-<application-code>-android-mobile-core/
    sdkwork-<application-code>-android-mobile-commons/
    sdkwork-<application-code>-android-mobile-shell/
    sdkwork-<application-code>-android-mobile-<capability>/
    sdkwork-<application-code>-android-mobile-console-<capability>/
```

Optional shared Android package shape:

```text
packages/android-native/
  iam/
  foundation/
  commerce/
  communication/
  content/
  intelligence/
  system/
```

## 1. Surface Boundary

Rules:

- Android app UI `MUST` live in normalized Android application packages such as `apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-<capability>` or approved shared Android package families such as `packages/android-native/<domain>/<package>`.
- Android user-console UI `MUST` live in `apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-console-<capability>` packages and follow the same package-internal UI/service/state/i18n shape as app packages.
- Android app and user-console UI `MUST` consume `/app/v3/api` through generated Kotlin/Java app SDK clients or approved wrappers.
- Android app and user-console UI `MUST NOT` consume `/backend/v3/api`, backend SDK packages, backend React packages, Flutter packages, iOS packages, or Harmony packages for user-facing workflows.
- Operator/admin screens require a separately approved Android admin package family classified as `backend-admin` and must follow `backend-admin` backend-api/backend SDK rules.
- Android framework and platform APIs such as camera, biometric, secure storage, push, intents, app links, files, and lifecycle `MUST` go through typed host adapters.

## 2. Package Split

| Package type | Naming | Owns | Must not own |
| --- | --- | --- | --- |
| Android app shell | `sdkwork-<application-code>-android-mobile-shell` or app-specific Android shell | navigation graph, providers, AuthGate, route composition | reusable domain features |
| Android foundation package | `sdkwork-<application-code>-android-mobile-commons` or `sdkwork-<foundation>-android-native` | domain-neutral UI primitives, theme adapters, form/list/error primitives, i18n helpers | business-domain shortcuts |
| Android domain package | `sdkwork-<application-code>-android-mobile-<capability>` or `sdkwork-<capability>-android-native` | screens, composables/views, view models/controllers, services, repositories, state, i18n/resources, route metadata | concrete SDK construction, backend admin logic |
| Android user console package | `sdkwork-<application-code>-android-mobile-console-<capability>` | user-facing management console screens, composables/views, view models/controllers, services, repositories, state, i18n/resources, route metadata | company-internal admin workflows, backend-only operation center behavior |
| Android host package | `sdkwork-<application-code>-android-mobile-host` or `sdkwork-<host>-android-native` when needed | Android platform API adapters, permissions, lifecycle, secure storage, camera/QR/share/push/deep links | API business logic |

Rules:

- Android packages `MUST` be split by domain/capability.
- Android console packages `MUST` be split by concrete management capability and must not become one large mobile console package.
- A single Android package `MUST NOT` accumulate unrelated backend-like business modules.
- Shared UI primitives remain domain-neutral unless they live inside the owning domain package.
- Android packages may share app SDK port contracts conceptually with other client packages, but must not depend on their UI/runtime code.

## 3. Internal Shape

Recommended app-root package structure:

```text
apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-<capability>/
  build.gradle.kts
  src/
    main/
      kotlin/
        com/sdkwork/<application-code>/android/mobile/<capability>/
          PublicApi.kt
          ui/
            screens/
            components/
          presentation/
            viewmodels/
            controllers/
          services/
          repositories/
          state/
          i18n/
          routes/
          navigation/
          host/
          models/
      i18n/
        <locale>/<domain>/<capability>/
      res/                  # generated or thin platform resource projection
    test/
    androidTest/
  specs/
```

Recommended shared package structure:

```text
packages/android-native/<domain>/<package>/
  build.gradle.kts
  src/
    main/
      kotlin/
      res/
    test/
    androidTest/
  specs/
```

Rules:

- The package public API file exports integration contracts and composition helpers.
- `ui/screens/` owns route-level UI.
- `ui/components/` owns reusable or domain-specific components.
- `presentation/` owns view models/controllers and UI state mapping.
- `services/` owns use-case orchestration.
- `repositories/` owns thin generated app SDK calls where repository naming is used.
- `src/main/i18n/<locale>/<domain>/<capability>/` owns package-local Android locale source fragments. Kotlin files under `i18n/` and `src/main/res/values*/strings.xml` are thin registries or generated platform projections only. Platform resource aggregates must be generated or assembled from fragments and must not be hand-authored whole-app catalogs; follow `I18N_SPEC.md` section 6.1.
- `models/` owns view models only. API DTOs come from generated Kotlin/Java app SDKs.
- `host/` owns adapter interfaces for platform capabilities.

## 4. SDK And Host Integration

Rules:

- Android services/repositories `MUST` receive generated app SDK clients or narrow app SDK ports through dependency injection.
- Android runtime/bootstrap `MUST` construct generated Kotlin/Java app SDK clients, appbase SDK clients or approved appbase Android wrappers, one global token-manager equivalent, token/context storage, and host adapters.
- Android IAM integration `MUST` use generated appbase app SDK resources or an approved appbase Android wrapper for login, registration, current session, refresh, logout, verification, OAuth, QR auth, password reset, runtime metadata, and current-user self-service.
- If an appbase Android wrapper is missing a required resource, the missing capability `MUST` be added to appbase app-api/OpenAPI/generator inputs and regenerated. Android packages `MUST NOT` fill the gap with raw HTTP calls, manual headers, or copied TypeScript/Flutter logic.
- UI and view models `MUST NOT` construct SDK clients, attach auth/API key headers, parse JWTs for authorization, or call raw HTTP for business transport.
- Platform capabilities must be behind interfaces so tests can use fake adapters.
- Generated SDK output `MUST NOT` be hand-edited.

## 5. Android Interaction And Design

Rules:

- Android UI must be phone-first, touch-first, safe-area/window-inset-aware, and usable across common phone, foldable, and tablet widths when the app supports them.
- New UI should use Compose state hoisting or an approved root state pattern; legacy Views must not bypass service and host adapter boundaries.
- Screens must handle loading, empty, validation-error, permission-denied, offline/unavailable, and unknown-error states.
- Forms must support keyboard avoidance, autofill hints where appropriate, accessible labels, and duplicate-submit protection.
- QR scan, OAuth redirect, verification-code, push permission, and password reset flows must handle activity/process lifecycle transitions.
- Theme usage must come from the app design system or package-injected theme adapters. Domain packages must not redefine global themes.
- Bottom navigation and navigation rail destinations `MUST` render the selected destination with the filled icon variant and every unselected destination with the outline variant of the same glyph, and `MUST NOT` convey selection by color alone. Compose `NavigationBarItem` and `NavigationRailItem` `MUST` select `Icons.Filled.*` when selected and `Icons.Outlined.*` otherwise; legacy Views `MUST` use a selected-state drawable with the filled vector. This is the Android application of `ICON_SPEC.md` section 3.

## 6. Security

Rules:

- Tokens should be stored through approved Android secure storage adapters where available.
- Secure storage may persist centralized token/context state, but it `MUST NOT` own login, token refresh, permission checks, or business authorization.
- Logout, refresh failure, tenant switch, and account switch `MUST` clear secure storage, global token-manager equivalent, context store, sensitive Android state, and realtime/session bridges.
- Verification codes, OAuth codes, password reset tokens, QR keys, access tokens, refresh tokens, and push tokens `MUST NOT` be logged or placed in crash/analytics breadcrumbs.
- Deep links must validate expected scheme/host/path, state, nonce, and expiry before completing sensitive flows.
- Frontend permission checks are hints only. App-api authorization remains mandatory.

## 7. Testing

Required coverage for new Android capabilities:

| Test | Requirement |
| --- | --- |
| Package boundary | Static scan proves packages follow `sdkwork-<application-code>-android-mobile-*` or approved shared Android package names and do not deep-import another package's private source. |
| SDK boundary | Static scan proves generated SDK clients or approved wrappers are used and no raw HTTP, manual auth headers, or generated SDK edits were introduced. |
| Service/view model | Unit tests use fake generated app SDK clients and fake host adapters. |
| UI states | Compose/UI tests or documented fixtures cover loading, empty, validation-error, permission-denied, unavailable, and unknown-error states. |
| Navigation icons | Compose/UI tests prove the selected bottom-navigation or rail destination renders the filled variant, every unselected destination renders the outline variant of the same glyph, and both are legible in light and dark themes (`ICON_SPEC.md` section 3). |
| I18n layout | Static scan proves authored fragments stay under `src/main/i18n/<locale>/<domain>/<capability>/` and `res/values*/strings.xml` is generated or thin platform projection only. |
| IAM clearing | Tests prove secure storage, token manager, context store, caches, and sensitive state clear on logout, refresh failure, tenant switch, and account switch. |
| Host boundary | Static scan proves feature UI does not call Android platform APIs directly for host capabilities. |

Acceptance checklist:

- [ ] Android UI package placement follows `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`.
- [ ] Packages are split by domain/capability and expose only public integration contracts.
- [ ] Route ids and i18n keys align with other client architectures where workflows match.
- [ ] Services use generated app SDK clients or approved wrappers through injection.
- [ ] Android platform APIs are behind typed host adapters.
- [ ] UI covers mobile interaction states and lifecycle constraints.
- [ ] Security-sensitive platform facts and tokens are not logged or persisted insecurely.
- [ ] Verification evidence is recorded before completion.
