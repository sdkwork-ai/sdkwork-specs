# App Flutter UI Standard

- Version: 1.2
- Scope: app/user-facing and Flutter user-console packages, Flutter mobile app packages, generated app SDK integration, platform adapters
- Related: `API_SPEC.md`, `APPLICATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `COMPONENT_SPEC.md`, `CONFIG_SPEC.md`, `DOMAIN_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `I18N_SPEC.md`, `MODULE_SPEC.md`, `NAMING_SPEC.md`, `SDK_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines how SDKWork app-side and Flutter user-console UI is packaged and integrated. In application roots it is applied after `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`; in shared package families it remains the detailed Flutter package standard. Flutter UI packages are app/user-facing or user-console packages and consume app-api through generated Flutter/Dart app SDK clients or approved appbase Flutter wrappers. They must not consume `backend-admin` UI packages or backend SDKs for user-facing workflows. Cross-architecture SDK composition and appbase IAM token wiring follow `APP_SDK_INTEGRATION_SPEC.md`.

This standard is selected through `UI_ARCHITECTURE_SPEC.md` and applies only to app/user-facing and user-console Flutter packages. Flutter admin packages are `backend-admin` packages and must also follow `BACKEND_UI_SPEC.md`.

Canonical app-root Flutter mobile package shape:

```text
apps/sdkwork-<application-code>-flutter-mobile/
  packages/
    sdkwork_<application_code>_flutter_mobile_core/
    sdkwork_<application_code>_flutter_mobile_commons/
    sdkwork_<application_code>_flutter_mobile_shell/
    sdkwork_<application_code>_flutter_mobile_<capability>/
    sdkwork_<application_code>_flutter_mobile_console_<capability>/
```

Shared Flutter package shape:

```text
apps/sdkwork-appbase/
  packages/
    mobile-flutter/
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

- Flutter app UI `MUST` live in normalized Flutter application packages such as `apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_<capability>` or shared Flutter package families such as `packages/mobile-flutter/<domain>/<package>`.
- Flutter user-console UI `MUST` live in `apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_console_<capability>` packages and follow the same package-internal UI/service/state/i18n shape as app packages.
- Flutter app and user-console UI `MUST` consume `/app/v3/api` through generated Dart/Flutter app SDK clients or approved wrappers.
- Flutter app and user-console UI `MUST NOT` consume `/backend/v3/api`, backend SDKs, backend React packages, or backend UI service facades.
- App login, registration, OAuth, verification-code login, password reset, QR login, and current user flows belong to Flutter app UI when implemented in Flutter.
- Operator/admin screens require a separately approved Flutter admin package family classified as `backend-admin` and must follow `backend-admin` backend-api/backend SDK rules.

## 2. Package Split

| Package type | Naming | Owns | Must not own |
| --- | --- | --- | --- |
| Flutter app shell | `sdkwork_<application_code>_flutter_mobile_shell` or app-specific Flutter shell | `MaterialApp`/client navigation, providers, SDK bootstrap, token store, platform adapters | reusable domain features |
| Flutter foundation package | `sdkwork_<application_code>_flutter_mobile_commons` or `sdkwork_<foundation>_flutter` | appbase, workspace, command/search primitives | business-domain shortcuts |
| Flutter domain package | `sdkwork_<application_code>_flutter_mobile_<capability>` or `sdkwork_<capability>_flutter` | screens, widgets, controllers/blocs, repositories, services, i18n | concrete SDK construction, backend admin logic |
| Flutter user console package | `sdkwork_<application_code>_flutter_mobile_console_<capability>` | user-facing management console screens, widgets, controllers/blocs, repositories, services, i18n | company-internal admin workflows, backend-only operation center behavior |
| platform adapter package | `sdkwork_<application_code>_flutter_mobile_host` or `sdkwork_<host>_flutter` when needed | camera, QR scanner, secure storage, biometric, push, deep links | API business logic |

Rules:

- Flutter packages `MUST` be split by domain/capability.
- Flutter console packages `MUST` be split by concrete management capability and must not become one large mobile console package.
- A single Flutter package `MUST NOT` accumulate unrelated backend-like business modules.
- Shared widgets must remain domain-neutral unless they live inside the domain package.
- Flutter packages may share app SDK port contracts with React packages conceptually, but must not depend on React code.

## 3. Internal Shape

Recommended app-root package structure:

```text
apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_<capability>/
  pubspec.yaml
  lib/
    sdkwork_<application_code>_flutter_mobile_<capability>.dart
    src/
      screens/
      widgets/
      controllers/     # or blocs/, choose one pattern per package
      services/
      repositories/
      state/
      i18n/
      navigation/
      platform/
      models/
  test/
  specs/
```

Recommended shared package structure:

```text
packages/mobile-flutter/<domain>/<package>/
  pubspec.yaml
  lib/
    sdkwork_<capability>_flutter.dart
    src/
      screens/
      widgets/
      controllers/     # or blocs/, choose one pattern per package
      services/
      repositories/
      state/
      i18n/
      navigation/
      platform/
      models/
  test/
  specs/
```

Rules:

- The package root Dart file exports the public surface.
- `screens/` owns route-level UI.
- `widgets/` owns reusable or domain-specific widgets.
- `controllers/` or `blocs/` owns presentation logic. New packages should choose one pattern and stay consistent.
- `services/` owns use-case orchestration.
- `repositories/` owns thin generated app SDK calls where repository naming is used.
- `i18n/` owns package-local Flutter locale fragments and thin aggregation exports. Flutter/Dart packages `MUST` use the `lib/src/i18n/<locale>/<domain>/<capability>/<fragment>.arb|json` layout from `I18N_SPEC.md` section 6.1. Framework files such as `lib/l10n/app_*.arb` are generated or thin projections only; this folder must not contain an authored whole-app or whole-package locale monolith.
- `models/` owns view models only. API DTOs come from the generated Dart app SDK.
- `platform/` owns adapter interfaces for platform capabilities.

## 4. SDK And Platform Integration

Rules:

- Flutter services/repositories `MUST` receive generated app SDK clients or narrow app SDK ports through dependency injection.
- Flutter runtime/bootstrap `MUST` construct generated Dart/Flutter app SDK clients, generated Dart/Flutter appbase SDK clients or approved appbase Flutter wrappers, one global token-manager equivalent, token/context storage, and platform adapters.
- Flutter IAM integration `MUST` use generated appbase app SDK resources or an approved appbase Flutter wrapper for login, registration, current session, refresh, logout, verification, OAuth, QR auth, password reset, runtime metadata, and current-user self-service.
- If an appbase Flutter wrapper is missing a required resource, the missing capability `MUST` be added to appbase app-api/OpenAPI/generator inputs and regenerated. Flutter UI packages `MUST NOT` fill the gap with raw `http` calls, manual headers, or copied TypeScript wrapper logic.
- The Flutter token-manager equivalent `MUST` be global for the authenticated session context and shared by appbase app SDK, every authenticated application-owned app-api SDK client, and explicit `backend-admin` appbase backend/application backend SDK clients.
- Widgets `MUST NOT` construct SDK clients, call raw HTTP, manually attach auth/API key headers, or read secrets.
- Missing Flutter/Dart SDK methods `MUST` be fixed by updating app-api OpenAPI and generator inputs, then regenerating.
- Platform capabilities must be behind interfaces so tests can use fake adapters.
- Generated SDK output `MUST NOT` be hand-edited.

## 5. Flutter Interaction And Design

Rules:

- Flutter UI must be responsive across phone, tablet, foldable, and desktop windows when the app targets those surfaces.
- Touch targets must follow platform expectations and avoid hover-only behavior.
- Screens must handle loading, empty, validation-error, permission-denied, offline/unavailable, and unknown-error states.
- Forms must support keyboard avoidance, autofill hints where appropriate, and accessible labels.
- QR scan, OAuth redirect, verification-code, and password reset flows must handle app lifecycle transitions.
- Theme usage must come from the app design system or package-injected theme extensions. Domain packages must not redefine global themes.
- Screen bodies `MUST` be full-bleed: the page-level scroll body `MUST NOT` apply horizontal `EdgeInsets` padding, and card/section surfaces `MUST` span the full window width with zero horizontal margin, so media, banners, and list tiles run edge-to-edge. Layout rhythm comes from vertical spacing and surface contrast, not page gutters. Text-dense blocks `MAY` keep a small documented content inset inside their own surface (for example `ListTile.contentPadding`), but a shared horizontal page-gutter wrapper on every screen is forbidden. Horizontal page padding is a review failure.
- A bottom tab bar `MUST` distinguish the selected tab with a filled icon and unselected tabs with an outline (unfilled) icon of the same glyph, and `MUST NOT` convey selection by color alone. When the icon set has no dedicated filled/outline pair, the selected state `MUST` fill the same glyph (for example `fill="currentColor"` on a stroke-based icon set). When the platform exposes a native selected-icon slot, it `MUST` be used (such as mini program `iconPath`/`selectedIconPath` or Flutter `NavigationDestination(icon:/selectedIcon:)`). Icon pairs `SHOULD` ship in both light and dark tab-bar themes or use a theme-aware tint.
- A bottom tab bar `MUST` render only on tab-root routes. Secondary screens — stack pushes, detail, creation, and settings surfaces — `MUST NOT` render the bottom tab bar or reserve its space. Tab-bar visibility `MUST` be decided once per route at composition or shell-layout time from the surface's declared tab roots (route table or native tabBar manifest), never inside individual screens with per-screen conditionals; on platforms with a native tab bar the platform mechanism is the equivalent guarantee, and the declared tab roots remain the cross-surface source of which routes show the tab bar.

## 6. Security

Rules:

- Tokens should be stored through secure platform storage where available.
- Secure platform storage may persist centralized token/context state, but it `MUST NOT` own login, token refresh, permission checks, or business authorization.
- Logout, refresh failure, tenant switch, and account switch `MUST` clear platform storage, global token-manager equivalent, context store, sensitive Flutter state, and realtime/session bridges.
- Verification codes, OAuth codes, password reset tokens, QR keys, access tokens, and refresh tokens `MUST NOT` be logged or placed in crash/analytics breadcrumbs.
- Deep link callbacks must validate expected scheme/host/path, state, nonce, and expiry before completing sensitive flows.
- Frontend permission checks are hints only. App-api authorization remains mandatory.

## 7. Testing

Required coverage for new Flutter capabilities:

- unit test for service/repository using a fake generated app SDK client;
- widget test for representative loading, success, empty, validation-error, and failure states;
- platform adapter contract test for camera, QR, secure storage, deep link, or push behavior when used;
- route/deep-link test when adding navigation;
- i18n directory/static scan proving authored fragments stay under `lib/src/i18n/<locale>/<domain>/<capability>/` and generated `lib/l10n/**` files are not hand-authored feature copy;
- `flutter analyze` or package-equivalent static check.

Acceptance checklist:

- [ ] Package belongs to the correct Flutter app domain/capability.
- [ ] Widgets call controllers/services; services call injected app SDK clients.
- [ ] Flutter runtime wires generated Dart/Flutter app SDKs, appbase SDK/wrapper, platform storage, and one global token-manager equivalent according to `APP_SDK_INTEGRATION_SPEC.md`.
- [ ] Platform behavior uses typed adapters.
- [ ] No backend SDK, backend UI dependency, raw HTTP, manual auth/API key headers, or generated SDK edits were introduced.
- [ ] Tests cover SDK orchestration, platform adapters, and representative UI states.
