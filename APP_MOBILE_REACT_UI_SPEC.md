# App Mobile React UI Standard

- Version: 1.2
- Scope: app/user-facing and H5 user-console React mobile packages, H5 mobile web screens, Capacitor mobile renderer packages, app SDK integration
- Related: `API_SPEC.md`, `APPLICATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `COMPONENT_SPEC.md`, `CONFIG_SPEC.md`, `DOMAIN_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `I18N_SPEC.md`, `MODULE_SPEC.md`, `NAMING_SPEC.md`, `SDK_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines how SDKWork app-side and H5 user-console mobile React UI is packaged and integrated. In application roots it is applied after `APP_H5_ARCHITECTURE_SPEC.md`; in shared package families it remains the detailed mobile React package standard. Mobile React UI is user-facing and must consume app-api through generated TypeScript app SDK clients or approved appbase mobile wrappers. It must not depend on `backend-admin` UI packages. Cross-architecture SDK composition and appbase IAM token wiring follow `APP_SDK_INTEGRATION_SPEC.md`.

This standard is selected through `UI_ARCHITECTURE_SPEC.md` and applies only to app/user-facing and user-console H5/mobile React packages. H5 admin packages are `backend-admin` packages and must also follow `BACKEND_UI_SPEC.md`.

Canonical app-root H5 mobile package shape:

```text
apps/sdkwork-<application-code>-h5/
  packages/
    sdkwork-<application-code>-h5-core/
    sdkwork-<application-code>-h5-commons/
    sdkwork-<application-code>-h5-shell/
    sdkwork-<application-code>-h5-<capability>/
    sdkwork-<application-code>-h5-console-<capability>/
```

Shared mobile React package shape:

```text
apps/sdkwork-appbase/
  packages/
    mobile-react/
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

- Mobile React app UI `MUST` live in normalized H5 application packages such as `apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-<capability>`.
- H5 user-console UI `MUST` live in `apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-console-<capability>` packages and follow the same package-internal UI/service/state/i18n shape as app packages.
- Mobile React app and user-console UI `MUST` consume `/app/v3/api` through the generated app SDK or approved appbase wrappers.
- Mobile React app and user-console UI `MUST NOT` consume `/backend/v3/api`, backend SDK packages, or `@sdkwork/react-backend-*` packages.
- `backend-admin` UI and operator-only workflows are forbidden in mobile React app or user-console packages unless the product is explicitly an admin mobile app with its own approved `backend-admin` package family.
- Native-only concerns such as camera, push token, deep link, biometric prompt, secure storage, and OS share sheet `MUST` go through host adapters.

## 2. Package Split

| Package type | Naming | Owns | Must not own |
| --- | --- | --- | --- |
| mobile shell/runtime | `sdkwork-<application-code>-h5-shell` or app-specific mobile shell | navigation container, safe-area provider, SDK bootstrap, token storage adapter, host adapters | reusable domain services and pages |
| mobile foundation | `sdkwork-<application-code>-h5-commons` or `sdkwork-<foundation>-mobile-react` | appbase, client navigation, command palette, search, workspace primitives for mobile | business-domain shortcuts |
| mobile domain package | `sdkwork-<application-code>-h5-<capability>` or `sdkwork-<capability>-mobile-react` | screens, components, hooks, services, i18n, navigation metadata | concrete SDK construction, backend admin logic |
| mobile user console package | `sdkwork-<application-code>-h5-console-<capability>` | user-facing management console screens, components, hooks, services, i18n, navigation metadata | company-internal admin workflows, backend-only operation center behavior |
| host adapter package | `sdkwork-<application-code>-h5-capacitor` or `sdkwork-<host>-mobile-react` when needed | native bridge abstraction, per-platform adapter and plugin implementations inside the one package, and permissions | API business logic, platform-split host packages |

Rules:

- Mobile packages `MUST` be split by domain/capability and must not become one large mobile business package.
- H5 console packages `MUST` be split by concrete management capability and must not become one large mobile console package.
- Shared visual primitives must remain domain-neutral.
- Domain packages may share contracts with PC React packages, but must not import PC-specific page or layout components.
- Mobile and PC packages may share SDK port interfaces through common contracts or services when the UI concerns remain separate.

## 3. Internal Shape

Recommended app-root package structure:

```text
apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-<capability>/
  package.json
  src/
    index.ts
    screens/
    components/
    hooks/
    services/
    state/
    i18n/
    navigation/
    host/
    types/
  tests/
  specs/
```

Recommended shared package structure:

```text
apps/sdkwork-<application-code>-h5/packages/<package>/
  package.json
  src/
    index.ts
    screens/
    components/
    hooks/
    services/
    state/
    i18n/
    navigation/
    host/
    types/
  tests/
  specs/
```

Rules:

- `screens/` owns mobile route-level UI.
- `navigation/` owns route metadata, tab registration, stack registration, and deep-link mapping.- Shared mobile shell chrome — the page navbar (title bar with back control) and the bottom tab bar — `MUST` be defined once in the appbase shell foundation package (`@sdkwork/shell-mobile-react`) and reused by every app. App capability packages `MUST NOT` hand-roll per-screen headers or tab bars; they compose the shared components with app data (titles, back handlers, badges, action slots). Shared chrome components `MUST` stay app-agnostic (data in, events out; no app store, router-implementation, or capability imports), which keeps reuse high-cohesion and low-coupling.

- `host/` owns injected host adapter contracts only, not native implementation details unless the package is a host package.
- `services/` owns app SDK orchestration through injected clients or shared service interfaces.
- `state/` owns mobile view/cache state and must clear sensitive state on logout and account/tenant switch.
- `i18n/` owns package-local mobile locale fragments and thin aggregation exports. H5/mobile React TypeScript packages `MUST` use the `src/i18n/<locale>/<domain>/<capability>/<fragment>.ts|json` layout from `I18N_SPEC.md` section 6.1. It must not contain an authored whole-app or whole-package locale monolith.

## 4. SDK And Host Integration

Rules:

- Services `MUST` use app SDK clients or approved service wrappers.
- Runtime/bootstrap `MUST` construct generated TypeScript app SDK clients, appbase IAM clients, one global token manager, token/context stores, and mobile host adapters.
- Mobile React IAM integration `MUST` use an appbase mobile wrapper when available. If a mobile-specific wrapper is not available, the app may use an approved adapter over `@sdkwork/iam-runtime` and `@sdkwork/iam-app-sdk`; it must not create raw HTTP auth flows.
- `appbaseApp`, optional `backend-admin` `appbaseBackend`, downstream app-api SDK clients, and explicit `backend-admin` backend-api SDK clients `MUST` share the same global token manager through generated SDK credential APIs such as `setTokenManager`.
- Login, registration, current session, refresh, logout, OAuth, QR auth, password reset, runtime metadata, and current-user self-service `MUST` use appbase app SDK resources or appbase wrappers. Verification-code delivery and verification `MUST` use the generated messaging app SDK surface or an appbase wrapper that delegates to an injected messaging client.
- Native bridge calls `MUST` go through typed host adapters.
- UI components `MUST NOT` construct SDK clients, call raw HTTP, manually attach auth/API key headers, or call native bridge globals directly.
- Push notification, QR scan, camera, location, biometric, secure storage, and deep-link handling must be represented as typed adapters with test doubles.
- Secure storage adapters may persist appbase token/context data for the central runtime, but they `MUST NOT` own login, refresh, permission checks, or business authorization.
- Missing app SDK methods must be fixed in the owning app-api OpenAPI authority and generator inputs before the mobile package consumes them. Legacy Java Plus app-api authorities may be used only under registered L0 migration exceptions.

## 5. Mobile Interaction And Design

Rules:

- Mobile UI must be touch-first, safe-area-aware, and usable at common phone widths.
- Primary actions should be reachable without dense desktop tables or hover-only interactions.
- Lists must support loading, pull-to-refresh or explicit refresh when appropriate, pagination or infinite loading with bounds, empty state, retry, and offline/unavailable state.
- Forms must use mobile-friendly input types, validation messages, and keyboard avoidance.
- QR scan, OAuth redirect, password reset, and verification-code flows must survive app background/foreground transitions where the host supports it.
- Text must fit within compact mobile containers without overlap or viewport-scaled font hacks.
- Page surfaces `MUST` be full-bleed: the page-level container and its primary scroll body `MUST NOT` apply horizontal padding or horizontal margins, so section surfaces, media, banners, and list rows span the full viewport width edge-to-edge. Layout rhythm comes from vertical spacing and surface background contrast, not page gutters. Text-dense blocks `MAY` keep a small documented content inset inside their own surface for readability, but re-adding a page-level gutter through a shared inner wrapper on every block is forbidden. The documented surface content inset is the 0.9rem token applied as the surface's own horizontal padding; ad-hoc inset values outside the token are a review failure. Horizontal page padding is a review failure.
- Full-bleed surfaces `MUST NOT` apply outer border radii or horizontal margins. Any block that spans the viewport width edge-to-edge — banners, section surfaces, list rows, heroes, summary strips, entry rows — keeps square corners so it reads as part of the page instead of a floating card. Border radius is reserved for inset elements (avatars, chips, thumbnails, badges, chat bubbles, form controls, icon tiles inside a surface) and for overlay sheets, whose top corners `MAY` stay rounded. A full-width block with an outer radius is a review failure.
- Reference picks whose target has a browsable list (orders, addresses, coupons, items) `MUST` use cell navigation: the form renders a cell with the current reference (or a placeholder), and tapping it pushes a dedicated picker page that lists candidates and completes the pick back to the form. Free-text id input for such a reference is a review failure; small closed sets (`≤`5 options) `MAY` use the action-sheet picker instead.
- Choice inputs `MUST NOT` render the desktop-style native `<select>` dropdown on mobile surfaces. A choice field renders as a picker cell — a full-bleed cell row (label left, current value and chevron right) that opens a bottom action-sheet picker; stacked picker cells form a grouped card. A native `<select>` on a mobile surface is a review failure.
- Secondary screens (stack pushes, detail, creation, and settings surfaces) `MUST` render the shared navigation bar — a back affordance plus the route title — instead of the search header reserved for tab roots. Titles `MUST` resolve once at shell-layout time from the route registry; pages `MUST NOT` assemble their own top headers. Full-bleed media surfaces such as product galleries `MAY` own floating navigation affordances with scroll-revealed chrome in place of the static bar.
- A bottom tab bar `MUST` distinguish the selected tab with a filled icon and unselected tabs with an outline (unfilled) icon of the same glyph, and `MUST NOT` convey selection by color alone. When the icon set has no dedicated filled/outline pair, the selected state `MUST` fill the same glyph (for example `fill="currentColor"` on a stroke-based icon set). When the platform exposes a native selected-icon slot, it `MUST` be used (such as mini program `iconPath`/`selectedIconPath` or Flutter `NavigationDestination(icon:/selectedIcon:)`). Icon pairs `SHOULD` ship in both light and dark tab-bar themes or use a theme-aware tint.
- A bottom tab bar `MUST` render only on tab-root routes. Secondary screens — stack pushes, detail, creation, and settings surfaces — `MUST NOT` render the bottom tab bar or reserve its space. Tab-bar visibility `MUST` be decided once per route at composition or shell-layout time from the surface's declared tab roots (route table or native tabBar manifest), never inside individual screens with per-screen conditionals; on platforms with a native tab bar the platform mechanism is the equivalent guarantee, and the declared tab roots remain the cross-surface source of which routes show the tab bar.

## 6. Security

Rules:

- Tokens should be stored through secure storage host adapters where available.
- Token/session clearing `MUST` clear secure storage, global token manager, context store, mobile caches, realtime/session bridges, and sensitive view state on logout, refresh failure, tenant switch, and account switch.
- Verification codes, OAuth codes, reset tokens, QR keys, and access tokens `MUST NOT` be logged, persisted in insecure view state, or placed in analytics attributes.
- Deep links must validate expected scheme, host, path, nonce/state, and expiry before completing sensitive flows.
- Frontend permission checks are hints only. App-api authorization remains mandatory.

## 7. Testing

Required coverage for new mobile React capabilities:

- service test with fake app SDK client;
- host adapter contract test for native-dependent behavior;
- screen/hook test for loading, empty, validation, permission-denied, and failure states;
- navigation/deep-link mapping test when adding routes;
- i18n directory/static scan and fallback test when user-facing copy is added;
- typecheck for changed packages.

Acceptance checklist:

- [ ] Package belongs to the correct mobile app domain/capability.
- [ ] UI -> services -> injected app SDK clients boundary is respected.
- [ ] Mobile runtime wires appbase IAM, generated app SDK clients, secure storage adapter, and one global token manager according to `APP_SDK_INTEGRATION_SPEC.md`.
- [ ] Native concerns use host adapters.
- [ ] No backend SDK, backend UI dependency, raw HTTP, manual auth/API key headers, or generated SDK edits were introduced.
- [ ] Mobile-specific state, offline, safe-area, and security behaviors are covered.
