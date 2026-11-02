# App iOS Native UI Standard

- Version: 1.1
- Scope: app/user-facing and iOS user-console native packages, SwiftUI or UIKit UI, generated Swift app SDK integration, iOS host adapters, mobile interaction, and package-local state
- Related: `API_SPEC.md`, `APPLICATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `COMPONENT_SPEC.md`, `CONFIG_SPEC.md`, `DOMAIN_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `ICON_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `I18N_SPEC.md`, `MODULE_SPEC.md`, `NAMING_SPEC.md`, `SDK_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines how SDKWork app-side and iOS user-console native UI is packaged and integrated. In application roots it is applied after `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`; in shared package families it remains the detailed iOS native package standard. iOS UI packages are app/user-facing or user-console packages and consume app-api through generated Swift app SDK clients or approved appbase iOS wrappers. They must not consume `backend-admin` UI packages or backend SDKs for user-facing workflows.

This standard is selected through `UI_ARCHITECTURE_SPEC.md` and applies only to app/user-facing and user-console iOS native packages. iOS admin packages are `backend-admin` packages and must also follow `BACKEND_UI_SPEC.md`.

Canonical app-root iOS package shape:

```text
apps/sdkwork-<application-code>-ios-mobile/
  packages/
    sdkwork-<application-code>-ios-mobile-core/
    sdkwork-<application-code>-ios-mobile-commons/
    sdkwork-<application-code>-ios-mobile-shell/
    sdkwork-<application-code>-ios-mobile-<capability>/
    sdkwork-<application-code>-ios-mobile-console-<capability>/
```

Optional shared iOS package shape:

```text
packages/ios-native/
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

- iOS app UI `MUST` live in normalized iOS application packages such as `apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-<capability>` or approved shared iOS package families such as `packages/ios-native/<domain>/<package>`.
- iOS user-console UI `MUST` live in `apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-console-<capability>` packages and follow the same package-internal UI/service/state/i18n shape as app packages.
- iOS app and user-console UI `MUST` consume `/app/v3/api` through generated Swift app SDK clients or approved wrappers.
- iOS app and user-console UI `MUST NOT` consume `/backend/v3/api`, backend SDK packages, backend React packages, Flutter packages, Android packages, or Harmony packages for user-facing workflows.
- Operator/admin screens require a separately approved iOS admin package family classified as `backend-admin` and must follow `backend-admin` backend-api/backend SDK rules.
- iOS framework and platform APIs such as camera, biometric, keychain, push, universal links, files, and lifecycle `MUST` go through typed host adapters.

## 2. Package Split

| Package type | Naming | Owns | Must not own |
| --- | --- | --- | --- |
| iOS app shell | `sdkwork-<application-code>-ios-mobile-shell` or app-specific iOS shell | navigation stack/tab/sheet composition, providers, AuthGate, route composition | reusable domain features |
| iOS foundation package | `sdkwork-<application-code>-ios-mobile-commons` or `sdkwork-<foundation>-ios-native` | domain-neutral UI primitives, theme adapters, form/list/error primitives, i18n helpers | business-domain shortcuts |
| iOS domain package | `sdkwork-<application-code>-ios-mobile-<capability>` or `sdkwork-<capability>-ios-native` | screens, views, view models/controllers, services, repositories, state, localization, route metadata | concrete SDK construction, backend admin logic |
| iOS user console package | `sdkwork-<application-code>-ios-mobile-console-<capability>` | user-facing management console screens, views, view models/controllers, services, repositories, state, localization, route metadata | company-internal admin workflows, backend-only operation center behavior |
| iOS host package | `sdkwork-<application-code>-ios-mobile-host` or `sdkwork-<host>-ios-native` when needed | iOS platform API adapters, permissions, lifecycle, keychain, camera/QR/share/push/universal links | API business logic |

Rules:

- iOS packages `MUST` be split by domain/capability.
- iOS console packages `MUST` be split by concrete management capability and must not become one large mobile console package.
- A single iOS package `MUST NOT` accumulate unrelated backend-like business modules.
- Shared UI primitives remain domain-neutral unless they live inside the owning domain package.
- iOS packages may share app SDK port contracts conceptually with other client packages, but must not depend on their UI/runtime code.

## 3. Internal Shape

Recommended app-root package structure:

```text
apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-<capability>/
  Package.swift
  Sources/
    Sdkwork<Product>IosMobile<Capability>/
      PublicApi.swift
      Screens/
      Components/
      Presentation/
        ViewModels/
        Controllers/
      Services/
      Repositories/
      State/
      I18n/
        <locale>/<domain>/<capability>/
      Routes/
      Navigation/
      Host/
      Models/
      Resources/            # generated or thin .lproj projection
  Tests/
  specs/
```

Recommended shared package structure:

```text
packages/ios-native/<domain>/<package>/
  Package.swift
  Sources/
  Tests/
  specs/
```

Rules:

- The package public API file exports integration contracts and composition helpers.
- `Screens/` owns route-level UI.
- `Components/` owns reusable or domain-specific components.
- `Presentation/` owns view models/controllers and UI state mapping.
- `Services/` owns use-case orchestration.
- `Repositories/` owns thin generated app SDK calls where repository naming is used.
- `I18n/<locale>/<domain>/<capability>/` owns package-local iOS locale source fragments. `Resources/*.lproj/Localizable.strings`, `.stringsdict`, and other platform localization files are generated or thin projections only. Platform resource aggregates must be generated or assembled from fragments and must not be hand-authored whole-app catalogs; follow `I18N_SPEC.md` section 6.1.
- `Models/` owns view models only. API DTOs come from generated Swift app SDKs.
- `Host/` owns adapter interfaces for platform capabilities.

## 4. SDK And Host Integration

Rules:

- iOS services/repositories `MUST` receive generated app SDK clients or narrow app SDK ports through dependency injection.
- iOS runtime/bootstrap `MUST` construct generated Swift app SDK clients, appbase SDK clients or approved appbase iOS wrappers, one global token-manager equivalent, token/context storage, and host adapters.
- iOS IAM integration `MUST` use generated appbase app SDK resources or an approved appbase iOS wrapper for login, registration, current session, refresh, logout, verification, OAuth, QR auth, password reset, runtime metadata, and current-user self-service.
- If an appbase iOS wrapper is missing a required resource, the missing capability `MUST` be added to appbase app-api/OpenAPI/generator inputs and regenerated. iOS packages `MUST NOT` fill the gap with raw HTTP calls, manual headers, or copied TypeScript/Flutter logic.
- UI and view models `MUST NOT` construct SDK clients, attach auth/API key headers, parse JWTs for authorization, or call raw HTTP for business transport.
- Platform capabilities must be behind interfaces so tests can use fake adapters.
- Generated SDK output `MUST NOT` be hand-edited.

## 5. iOS Interaction And Design

Rules:

- iOS UI must be phone-first, touch-first, safe-area-aware, Dynamic Type aware, and usable across common iPhone sizes and iPad windows when the app supports them.
- New UI should use SwiftUI state and navigation patterns or an approved root state pattern; UIKit must not bypass service and host adapter boundaries.
- Screens must handle loading, empty, validation-error, permission-denied, offline/unavailable, and unknown-error states.
- Forms must support keyboard avoidance, autofill hints where appropriate, accessible labels, and duplicate-submit protection.
- QR scan, OAuth redirect, verification-code, push permission, and password reset flows must handle foreground/background transitions.
- Theme usage must come from the app design system or package-injected theme adapters. Domain packages must not redefine global themes.
- Tab bar and sidebar destinations `MUST` render the selected destination with the filled icon variant and every unselected destination with the outline variant of the same glyph, and `MUST NOT` convey selection by color alone. UIKit `MUST` use `UITabBarItem.selectedImage` where available; SwiftUI `MUST` drive the SF Symbol variant (for example `house` / `house.fill`) from selection, using a custom tab bar when the native tab item cannot express both images. This is the iOS application of `ICON_SPEC.md` section 3.

## 6. Security

Rules:

- Tokens should be stored through approved iOS secure storage/keychain adapters where available.
- Secure storage may persist centralized token/context state, but it `MUST NOT` own login, token refresh, permission checks, or business authorization.
- Logout, refresh failure, tenant switch, and account switch `MUST` clear secure storage, global token-manager equivalent, context store, sensitive iOS state, and realtime/session bridges.
- Verification codes, OAuth codes, password reset tokens, QR keys, access tokens, refresh tokens, and push tokens `MUST NOT` be logged or placed in crash/analytics breadcrumbs.
- Deep links and universal links must validate expected scheme/host/path, state, nonce, and expiry before completing sensitive flows.
- Frontend permission checks are hints only. App-api authorization remains mandatory.

## 7. Testing

Required coverage for new iOS capabilities:

| Test | Requirement |
| --- | --- |
| Package boundary | Static scan proves packages follow `sdkwork-<application-code>-ios-mobile-*` or approved shared iOS package names and do not deep-import another package's private source. |
| SDK boundary | Static scan proves generated SDK clients or approved wrappers are used and no raw HTTP, manual auth headers, or generated SDK edits were introduced. |
| Service/view model | Unit tests use fake generated app SDK clients and fake host adapters. |
| UI states | SwiftUI/UIKit tests or documented fixtures cover loading, empty, validation-error, permission-denied, unavailable, and unknown-error states. |
| Navigation icons | UI tests or documented fixtures prove the selected tab or sidebar destination renders the filled variant, every unselected destination renders the outline variant of the same glyph, and both are legible in light and dark themes (`ICON_SPEC.md` section 3). |
| I18n layout | Static scan proves authored fragments stay under `I18n/<locale>/<domain>/<capability>/` and `.lproj/Localizable.strings` files are generated or thin platform projections only. |
| IAM clearing | Tests prove secure storage, token manager, context store, caches, and sensitive state clear on logout, refresh failure, tenant switch, and account switch. |
| Host boundary | Static scan proves feature UI does not call iOS platform APIs directly for host capabilities. |

Acceptance checklist:

- [ ] iOS UI package placement follows `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`.
- [ ] Packages are split by domain/capability and expose only public integration contracts.
- [ ] Route ids and localization keys align with other client architectures where workflows match.
- [ ] Services use generated app SDK clients or approved wrappers through injection.
- [ ] iOS platform APIs are behind typed host adapters.
- [ ] UI covers mobile interaction states and lifecycle constraints.
- [ ] Security-sensitive platform facts and tokens are not logged or persisted insecurely.
- [ ] Verification evidence is recorded before completion.
