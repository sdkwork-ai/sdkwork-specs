# App Mini Program UI Standard

- Version: 1.2
- Scope: app/user-facing and mini program user-console UI packages, source pages/components, route projection inputs, generated app SDK integration, mini program host adapters, and package-size-aware interaction rules
- Related: `API_SPEC.md`, `APPLICATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `COMPONENT_SPEC.md`, `CONFIG_SPEC.md`, `DOMAIN_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `I18N_SPEC.md`, `MODULE_SPEC.md`, `NAMING_SPEC.md`, `SDK_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`

This standard defines how SDKWork app-side and mini program user-console UI is packaged and integrated. In application roots it is applied after `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`; in shared package families it remains the detailed mini program package standard. Mini program UI packages are user-facing or user-console packages and consume app-api through generated TypeScript app SDK clients or approved appbase mini program wrappers. They must not consume `backend-admin` UI packages or backend SDKs for user-facing workflows.

SDKWork source packages and platform pages/subpackages remain separate. This file owns the package-local UI/service/state/i18n/route rules. `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md` owns the root app layout, platform pages/subpackages projection, host/platform config, and release boundary.

Canonical app-root mini program package shape:

```text
apps/sdkwork-<application-code>-mini-program/
  packages/
    sdkwork-<application-code>-mp-core/
    sdkwork-<application-code>-mp-commons/
    sdkwork-<application-code>-mp-shell/
    sdkwork-<application-code>-mp-<capability>/
    sdkwork-<application-code>-mp-console-<capability>/
```

Optional shared mini program package shape:

```text
packages/
  mini-program/
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

- Mini program app UI `MUST` live in normalized mini program application packages such as `apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-<capability>` or approved shared mini program package families such as `packages/mini-program/<domain>/<package>`.
- Mini program user-console UI `MUST` live in `apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-console-<capability>` packages and follow the same package-internal UI/service/state/i18n shape as app packages.
- Mini program app and user-console UI `MUST` consume `/app/v3/api` through generated TypeScript app SDK clients or approved appbase mini program wrappers.
- Mini program app and user-console UI `MUST NOT` consume `/backend/v3/api`, backend SDK packages, backend React packages, or backend UI service facades for user-facing workflows.
- Operator/admin screens require separately approved mini program admin package families classified as `backend-admin` and must follow `backend-admin` backend-api/backend SDK rules.
- Platform APIs such as `wx.*`, `my.*`, `dd.*`, `tt.*`, or equivalent `MUST` go through typed host adapters.
- Platform `pages` and `subpackages` are runtime projections. They must not become the source dependency boundary.

## 2. Package Split

| Package type | Naming | Owns | Must not own |
| --- | --- | --- | --- |
| mini program shell/runtime | `sdkwork-<application-code>-mp-shell` or app-specific mini program shell | app shell, tab/page composition, route projection inputs, AuthGate integration | reusable domain pages and services |
| mini program foundation | `sdkwork-<application-code>-mp-commons` or `sdkwork-<foundation>-mini-program` | domain-neutral components, form/list/error primitives, design tokens, i18n helpers | business-domain shortcuts |
| mini program domain package | `sdkwork-<application-code>-mp-<capability>` or `sdkwork-<capability>-mini-program` | source pages, components, services, state, i18n, route metadata, view models | concrete SDK construction, unrelated capabilities |
| mini program user console package | `sdkwork-<application-code>-mp-console-<capability>` | user-facing management console source pages, components, services, state, i18n, route metadata, view models | company-internal admin workflows, backend-only operation center behavior |
| platform host package | `sdkwork-<application-code>-mp-host` or `sdkwork-<host>-mini-program` when needed | platform API adapters, permissions, login bridge, storage, media/file picker, share, scene/deep-link handling | business API transport, business authorization |

Rules:

- Mini program packages `MUST` be split by domain/capability.
- Mini program console packages `MUST` be split by concrete management capability and must not become one large console package.
- A single mini program package `MUST NOT` accumulate unrelated product workflows.
- Shared components remain domain-neutral unless they live inside the owning capability package.
- Domain packages may share route ids, i18n keys, design tokens, SDK port contracts, and service contracts with PC/H5/Flutter packages, but must not import their UI implementations.
- Capability packages should be small enough to project cleanly into platform subpackages when package-size limits require it.

## 3. Internal Shape

Recommended app-root package structure:

```text
apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-<capability>/
  package.json
  README.md
  src/
    index.ts
    pages/
    components/
    services/
    state/
    i18n/
    routes/
    navigation/
    host/
    types/
  tests/
  specs/
```

Recommended shared package structure:

```text
packages/mini-program/<domain>/<package>/
  package.json
  README.md
  src/
    index.ts
    pages/
    components/
    services/
    state/
    i18n/
    routes/
    navigation/
    host/
    types/
  tests/
  specs/
```

Rules:

- Authored page, component, service, state, route, and host-adapter sources `MUST` be TypeScript (`.ts`) under the `TYPESCRIPT_CODE_SPEC.md` strict baseline; i18n fragments follow `I18N_SPEC.md` section 6.1 (`.ts` or `.json`). Platform JavaScript beside the sources is a generated projection artifact, not an authoring venue; hand-authored JavaScript page or component sources are a review failure.
- `src/index.ts` is the public export boundary.
- `pages/` owns SDKWork source pages before projection into platform runtime pages.
- `components/` owns package-local mini program components and reusable domain components.
- `services/` owns app SDK orchestration through injected clients or service ports.
- `state/` owns view/cache state and must clear sensitive state on logout, refresh failure, account switch, and tenant switch.
- `i18n/` owns package-local mini program locale fragments and thin aggregation exports before platform page/subpackage projection. Mini program source packages `MUST` use the `src/i18n/<locale>/<domain>/<capability>/<fragment>.ts|json` layout from `I18N_SPEC.md` section 6.1. Platform page/subpackage locale resources are generated or thin projections only; this folder must not contain an authored whole-app or whole-package locale monolith.
- `routes/` owns SDKWork route contributions and mini program route placement metadata.
- `navigation/` owns tab, stack, redirect, scene, and subpackage preload metadata.
- `host/` owns adapter contracts used by the package, not platform global implementations.
- Local `types/` owns view models and route params. API DTOs come from generated SDKs.

## 4. Route Projection

Mini program UI packages contribute SDKWork routes that the root projects into platform pages and subpackages.

Standard contribution fields:

```ts
export interface SdkworkMiniProgramRouteContribution {
  id: string;
  surface: "app" | "console" | "admin";
  domain: string;
  capability: string;
  screen: string;
  titleKey: string;
  auth: "public" | "required";
  permissionHint?: string;
  miniProgram: {
    rootPackage?: boolean;
    subpackage?: string;
    pagePath: string;
    preload?: boolean;
  };
}
```

Rules:

- Route ids `MUST` follow `<surface>.<domain>.<capability>.<screen>`.
- Route ids, title keys, permission hints, and screen semantics should align with PC, H5, and Flutter implementations of the same workflow.
- Route metadata must not contain API URLs, SDK method names, access tokens, app secrets, or platform private keys.
- Package route contributions may choose root package placement only for login, first-run, authorization callback, tab entry, or other startup-critical pages.
- Business capabilities should default to platform subpackages when they contain more than trivial pages.
- Projection tooling must be deterministic so `app.json`, pages, and subpackages can be verified.

## 5. SDK And IAM Integration

Rules:

- Services `MUST` use generated TypeScript app SDK clients or approved appbase mini program wrappers.
- Runtime/bootstrap `MUST` construct generated app SDK clients, appbase IAM clients or wrappers, one global TokenManager equivalent, token/context stores, and host adapters.
- Mini program login codes, phone-number grants, profile prompts, subscription permissions, and scene inputs are platform facts. They must be exchanged through approved app-api or appbase flows, not feature-local raw request calls.
- Missing app SDK methods must be fixed in the owning app-api/OpenAPI/generator inputs and regenerated. Mini program packages must not fill gaps with raw request APIs, manual headers, or copied browser wrappers.
- `appbaseApp`, optional `backend-admin` `appbaseBackend`, downstream application/dependency app-api SDK clients, and explicit `backend-admin` backend-api SDK clients must share the same authenticated session token manager or approved mini program equivalent.
- UI pages and components must not construct SDK clients, attach auth/API key headers, parse JWTs for authorization, or call raw platform request APIs for business transport.

## 6. Host Adapter Boundary

Standard host adapter categories:

```text
platformLogin
secureStorage
camera
qrScanner
mediaPicker
filePicker
share
subscriptionsOrPush
deepLinksOrScene
networkStatus
appLifecycle
clipboard
geolocation
deviceInfo
haptics
paymentBridge
```

Rules:

- Feature packages depend on adapter interfaces, not platform globals.
- Host adapters normalize platform errors into stable SDKWork errors such as `unsupported`, `permission-denied`, `unavailable`, `cancelled`, and `invalid-state`.
- Scene, query, QR, and deep-link inputs must validate expected source, path, nonce/state, expiry, and auth requirements before sensitive flows complete.
- File/media upload uses Drive app SDK or approved Drive uploader facades. Host adapters may select or capture files but must not create upload sessions, presign URLs, object keys, or provider SDK flows.
- Payment bridge adapters may collect platform payment facts, but payment authorization and order state remain backend/app-api responsibilities.

## 7. Mini Program Interaction Rules

Rules:

- UI must be touch-first, safe-area-aware, and usable at common phone widths.
- Screens must cover loading, success, empty, validation-error, permission-denied, offline/unavailable, and unknown-error states for representative workflows.
- Lists must support refresh, pagination or bounded incremental loading, empty state, retry, and package-size-conscious rendering.
- Forms must use platform-appropriate inputs, validation messages, duplicate-submit protection, and privacy-safe temporary state.
- Login, phone authorization, QR, subscription, payment, share, and scene-entry flows must handle foreground/background transitions where the platform supports them.
- Text must fit compact containers without overlap or viewport-scaled font hacks.
- Package-size budgets must be considered before adding large dependencies, media, or cross-platform compatibility layers.
- Page surfaces `MUST` be full-bleed: page containers and the `page-*` wrappers `MUST NOT` apply horizontal padding, and card/section surfaces `MUST` use zero horizontal margin so blocks, media, banners, and list rows span the full screen width edge-to-edge. Layout rhythm comes from vertical spacing and surface background contrast, not page gutters. Text-dense blocks `MAY` keep a small documented content inset inside their own surface for readability, but re-adding a page-level gutter through a shared inner `view` wrapper on every block is forbidden. Horizontal page padding is a review failure.
- A bottom tab bar `MUST` distinguish the selected tab with a filled icon and unselected tabs with an outline (unfilled) icon of the same glyph, and `MUST NOT` convey selection by color alone. When the icon set has no dedicated filled/outline pair, the selected state `MUST` fill the same glyph (for example `fill="currentColor"` on a stroke-based icon set). When the platform exposes a native selected-icon slot, it `MUST` be used (such as mini program `iconPath`/`selectedIconPath` or Flutter `NavigationDestination(icon:/selectedIcon:)`). Icon pairs `SHOULD` ship in both light and dark tab-bar themes or use a theme-aware tint.
- A bottom tab bar `MUST` render only on tab-root routes. Secondary screens — stack pushes, detail, creation, and settings surfaces — `MUST NOT` render the bottom tab bar or reserve its space. Tab-bar visibility `MUST` be decided once per route at composition or shell-layout time from the surface's declared tab roots (route table or native tabBar manifest), never inside individual screens with per-screen conditionals; on platforms with a native tab bar the platform mechanism is the equivalent guarantee, and the declared tab roots remain the cross-surface source of which routes show the tab bar.

## 8. Security

Rules:

- Tokens should be stored through platform secure storage adapters when available.
- Token/session clearing `MUST` clear platform storage, global token manager, context store, sensitive state, caches, and realtime/session bridges on logout, refresh failure, tenant switch, and account switch.
- Verification codes, OAuth codes, reset tokens, login codes, phone grants, QR keys, access tokens, and refresh tokens `MUST NOT` be logged, persisted in insecure view state, or placed in analytics attributes.
- Platform private keys, app secrets, upload credentials, and signing credentials must not appear in source packages, route metadata, committed config, or manifest metadata.
- Frontend permission checks are hints only. App-api/backend-api authorization remains mandatory.

## 9. Testing

Required coverage for new mini program UI capabilities:

| Test | Requirement |
| --- | --- |
| Package boundary | Static scan proves packages follow `sdkwork-<application-code>-mp-*` or approved shared mini program package names and do not deep-import another package's private source. |
| Route projection | Tests prove route contributions generate or assemble platform pages/subpackages deterministically. |
| SDK boundary | Static scan proves generated SDK clients or approved wrappers are used and no raw request APIs, manual auth headers, or generated SDK edits were introduced. |
| IAM clearing | Tests prove platform storage, token manager, context store, caches, and sensitive state clear on logout, refresh failure, tenant switch, and account switch. |
| Host boundary | Static scan proves feature pages/components do not call platform globals directly. |
| UI states | Tests or documented fixtures cover loading, empty, validation-error, permission-denied, unavailable, and unknown-error states. |
| I18n layout | Static scan proves authored fragments stay under `src/i18n/<locale>/<domain>/<capability>/` and generated platform resources are not hand-authored feature copy. |
| Language boundary | Static scan proves authored page/component/service sources are TypeScript, strict typecheck passes, and platform JavaScript beside them is generated output. |
| Package size | Build or static check proves root package/subpackage size budgets are respected when tooling supports it. |

Acceptance checklist:

- [ ] Mini program UI package placement follows `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`.
- [ ] Source packages, not platform pages/subpackages, define the business architecture.
- [ ] Packages are split by domain/capability and expose only public integration contracts.
- [ ] Route ids and i18n keys align with other client architectures where workflows match.
- [ ] Services use generated app SDK clients or approved wrappers through injection.
- [ ] Platform APIs are behind typed host adapters.
- [ ] UI covers mobile interaction states and package-size constraints.
- [ ] Security-sensitive platform facts and tokens are not logged or persisted insecurely.
- [ ] Verification evidence is recorded before completion.
