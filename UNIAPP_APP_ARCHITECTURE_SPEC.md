# uni-app Cross-Platform App Architecture Standard

- Version: 1.0
- Scope: SDKWork uni-app application roots, Vue 3/Vite package taxonomy, one-source projection across H5, WeChat/Alipay/DingTalk/Lark/other mini program, and App (Android/iOS) targets, generated TypeScript app SDK integration, `uni.*` host adapters, conditional compilation boundaries, and cross-client route alignment
- Related: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APPLICATION_SPEC.md`, `NAMING_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `FRONTEND_CODE_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `APP_MANIFEST_SPEC.md`, `I18N_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `TEST_SPEC.md`

This standard defines the application-root architecture for SDKWork uni-app clients. A uni-app root is one Vue 3 + Vite source tree that projects to multiple delivery targets: H5 (`H5`), mini programs (`MP_WEIXIN`, `MP_ALIPAY`, `MP_DINGTALK`, `MP_LARK`, and other `MP_*` profiles), and native App packages (`APP_ANDROID`, `APP_IOS` through uni-app App packaging).

The framework authority is explicit:

- A uni-app root `MUST` follow this standard as its root architecture authority.
- A native WeChat Mini Program source root `MUST` follow `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md` instead.
- One application root `MUST NOT` keep uni-app and a native mini program tree as competing business source authorities for the same target set. The delivered product may combine one uni-app root with separate native roots, but each target has exactly one source authority.

SDKWork packages and uni-app platform `pages`/`subPackages` are different concepts. SDKWork packages are source, dependency, component, and composition boundaries. Platform `pages`, `subPackages`, and tabBar entries are runtime packaging boundaries. Business architecture is expressed through SDKWork packages first, then projected into `pages.json` through route metadata and build tooling.

## 1. Core Model

```text
uni-app root
  -> thin app bootstrap (App.vue/main.ts)
  -> SDKWork packages under packages/
  -> generated TypeScript app SDKs adapted for uni-app runtime
  -> appbase uni-app wrapper or approved appbase IAM runtime adapter
  -> one global TokenManager equivalent
  -> typed host adapters over uni.* / platform-conditioned APIs
  -> route contributions projected to pages.json pages and subPackages
```

Rules:

- uni-app roots `MUST` use SDKWork packages for core, commons, shell, capability, optional console/admin, and host boundaries.
- Platform `pages`/`subPackages` `MUST NOT` become the primary business architecture boundary.
- Root `src/` `MUST` stay thin: `App.vue`, `main.ts`, `manifest.json`, bootstrap assembly, route projection targets, shell registration, SDK client construction, IAM runtime wiring, and host adapter registration. Login/first-run/tab pages may live in the root `src/pages/` package.
- Business pages, components, services, state, i18n, and route contributions `MUST` live in packages.
- Generated TypeScript app SDK clients are the only business transport. uni-app packages `MUST NOT` call backend SDKs for user-facing workflows.
- `uni.*` and platform-only APIs `MUST` stay behind typed host adapters.

## 2. Standard Root Layout

```text
apps/sdkwork-<application-code>-uniapp/
  AGENTS.md
  sdkwork.app.config.json
  .sdkwork/
    README.md
    skills/
      README.md
    plugins/
      README.md
  etc/
    README.md
    sdkwork.deployment.config.json
  config/
    browser/
      runtime-env.<deployment-profile>.<environment>.js
    mini-program/
      runtime-env.<deployment-profile>.<environment>.json
    app/
      runtime-env.<deployment-profile>.<environment>.json
    host/
      uniapp-weixin.development.example.json
      uniapp-weixin.production.example.json
      uniapp-app.example.json
    server/
      <application-code>.<deployment-profile>.<environment>.toml.example
    container/
      <application-code>.<deployment-profile>.<environment>.toml.example
  docs/
  scripts/
  sdks/
  specs/
  src/
    App.vue
    main.ts
    manifest.json
    uni.scss
    static/
    bootstrap/
      environment.ts
      runtime.ts
      sdkClients.ts
      iamRuntime.ts
      hostAdapters.ts
      routes.ts
    shell/
    routes/
    pages/
      __generated__/
  packages/
    sdkwork-<application-code>-uniapp-core/
    sdkwork-<application-code>-uniapp-commons/
    sdkwork-<application-code>-uniapp-shell/
    sdkwork-<application-code>-uniapp-<capability>/
    sdkwork-<application-code>-uniapp-console-core/
    sdkwork-<application-code>-uniapp-console-shell/
    sdkwork-<application-code>-uniapp-console-<capability>/
    sdkwork-<application-code>-uniapp-admin-core/
    sdkwork-<application-code>-uniapp-admin-shell/
    sdkwork-<application-code>-uniapp-admin-<capability>/
    sdkwork-<application-code>-uniapp-host/
  tests/
  package.json
  vite.config.ts
  index.html
```

Rules:

- The root name `apps/sdkwork-<application-code>-uniapp` and package segment `uniapp` are canonical. New uni-app roots `MUST NOT` use the shorter `apps/<application-code>-uniapp/` form.
- `config/browser/`, `config/mini-program/`, and `config/app/` exist only for the delivery targets the root actually enables. At least one must exist.
- `config/host/` owns per-platform app ids, platform profiles, permission references, upload environment, and signing/app-store reference metadata. It must not contain private keys, tokens, or API keys.
- `src/pages/__generated__/` and the generated `pages.json` fragments are projection targets; business code stays in packages.
- uni-app env files `MUST` use `.env.<profile-id>` with `VITE_SDKWORK_*` public keys per `ENVIRONMENT_SPEC.md` section 5.1. The `uni build -p` value (`mp-weixin`, `h5`, `app`, and so on) is a target platform axis, never an environment or deployment-profile value.
- `sdkwork.app.config.json` uses `runtime.family = "mini-program"` for mini-program-only roots, `"mobile"` when App packages are delivered, and `"web"` for H5-only roots; `runtime.framework = "uni-app"`; `publish.platforms` lists only the actually delivered `MP_*`, `APP_*`, or `H5` values.

## 3. Package Taxonomy

| Package family | Owns | Must not own |
| --- | --- | --- |
| `sdkwork-<application-code>-uniapp-core` | runtime config, SDK factories with the uni-app request transport adapter, appbase IAM adapter, token/session/context stores, route registry, host adapter contracts | pages, business workflows |
| `sdkwork-<application-code>-uniapp-commons` | domain-neutral Vue components, form/list/error primitives, design tokens, i18n helpers | business pages, SDK construction |
| `sdkwork-<application-code>-uniapp-shell` | app shell, tabBar/page route composition, AuthGate integration, route projection inputs | business services |
| `sdkwork-<application-code>-uniapp-<capability>` | Vue pages, components, services, state (Pinia or equivalent), i18n, route contributions, view models | concrete SDK construction, unrelated capabilities |
| `sdkwork-<application-code>-uniapp-console-*` | user-facing console workflows through app-api | internal operator workflows |
| `sdkwork-<application-code>-uniapp-admin-*` | approved internal operator workflows through backend-api | user app login/session creation |
| `sdkwork-<application-code>-uniapp-host` | `uni.*` adapters, platform conditional implementations, permissions, login bridge, storage, file/media pickers, QR/camera/share/push/profile APIs | business API transport, authorization |

Rules:

- uni-app admin packages require explicit approval, `backend-admin` surface classification, and backend SDK boundary verification.
- Packages without `uniapp-console` or `uniapp-admin` are default uni-app app/user packages.
- The `<capability>` segment is a concrete business module token in lower kebab-case and `MUST NOT` be a placeholder such as `console`, `admin`, `manager`, `backend`, `common`, or `misc`.
- Shared components remain domain-neutral. Domain components live in the owning capability package.
- One capability package projects to one platform `subPackage` by default unless size or route cohesion requires a documented split.

## 4. Package Internal Shape

```text
packages/sdkwork-<application-code>-uniapp-<capability>/
  package.json
  README.md
  src/
    index.ts
    pages/
    components/
    services/
    stores/
    i18n/
    routes/
    navigation/
    host/
    types/
  tests/
  specs/
```

Rules:

- `src/index.ts` is the public export boundary.
- `pages/` owns `.vue` route-level pages before projection into platform pages.
- `services/` owns app SDK orchestration through injected SDK clients or service ports; services never call `uni.request` for business APIs.
- `stores/` owns view/cache state and must clear sensitive state on logout and account/tenant switch.
- `routes/` owns route contributions and platform placement metadata (root package, `subPackage`, page path, preload).
- `host/` owns adapter contracts used by the package, not `uni.*` implementations.
- Local `types/` owns view models and route params; API DTOs come from generated SDKs.

## 5. Conditional Compilation Boundary

Rules:

- `#ifdef`/`#ifndef` conditional compilation `MUST` stay inside the host package (`sdkwork-<application-code>-uniapp-host/src/<platform>/`) and root bootstrap platform branches.
- Capability packages `MUST NOT` scatter `MP-WEIXIN`, `H5`, `APP-PLUS`, or equivalent conditions through pages, components, or services. Platform variance is expressed through host adapter implementations selected at bootstrap.
- A platform-exclusive capability requires an approved component spec that names the exclusive platform set.
- CSS platform conditions follow the same boundary: shared styles are platform-neutral; platform overrides live with the host package or documented shell adapters.

## 6. Dependency Direction

Allowed flow:

```text
uniapp-core, uniapp-commons
  -> uniapp-shell, uniapp-console-core, uniapp-admin-core
  -> uniapp-console-shell, uniapp-admin-shell
  -> app/console/admin capability packages
  -> root src composition and pages.json projection
  -> uniapp-host platform adapters
```

Rules:

- `uniapp-core` and `uniapp-commons` must not import business capability packages.
- Capability services call injected SDK clients or service ports, not raw request APIs.
- Platform implementations live in `uniapp-host`, not feature pages.
- Cross-package imports must use package root exports, not private source paths.
- Cyclic workspace dependencies are forbidden.

## 7. SDK And IAM Integration

Rules:

- User-facing uni-app packages `MUST` use generated TypeScript app SDK clients or approved appbase/uni-app wrappers for `/app/v3/api`. The generated SDK transport is adapted to the uni-app runtime through one request adapter in `uniapp-core`; feature packages never wire transports.
- uni-app admin packages, when approved as `backend-admin` surfaces, `MUST` use generated TypeScript backend SDK clients or approved backend wrappers for `/backend/v3/api`.
- The root runtime `MUST` create one global TokenManager equivalent shared by the appbase app SDK client, every authenticated app-api SDK client, and explicit `backend-admin` backend SDK clients.
- Appbase login/session behavior uses appbase app SDK resources or an approved uni-app IAM adapter. Product packages must not create local auth/session endpoints.
- Platform login codes, phone-number grants, profile prompts, and provider-specific auth facts are host inputs exchanged through approved app-api/appbase flows, not feature-local raw HTTP.
- Token/session clearing must clear uni-app storage, token manager, context store, sensitive state, and realtime/session bridges on logout, refresh failure, and account/tenant switch.
- Missing SDK methods must be fixed in app-api/OpenAPI/generator inputs and regenerated; no raw request fallbacks.

## 8. Host Adapter Boundary

Standard uni-app host adapter categories:

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

- Feature packages must not call `uni.*` or platform globals (`wx.*`, `plus.*`, `window`-only browser APIs) directly.
- `uniapp-host` provides per-platform implementations and test fakes; conditional compilation selects implementations, and every target must resolve to an implementation or an `unsupported` fallback.
- Adapter methods must normalize platform-specific errors into stable SDKWork host errors (`unsupported`, `permission-denied`, `unavailable`, `cancelled`, `invalid-state`).
- Scene/query/deep-link inputs must validate expected source, path, nonce/state, expiry, and auth requirements before sensitive flows complete.
- File/media upload uses the Drive app SDK or approved Drive uploader facades. Host adapters only select or capture files.
- Payment bridge adapters collect platform payment facts only; payment authorization and order state remain backend/app-api responsibilities.

## 9. Route And UI Alignment

Rules:

- uni-app route ids follow `<surface>.<domain>.<capability>.<screen>` and align with PC, H5, Flutter, mini program, and native route ids for the same workflow.
- Route contributions declare `id`, `surface`, `domain`, `capability`, `screen`, `titleKey`, auth mode, permission hints, and uni-app placement metadata:

```ts
export interface UniappRoutePlacement {
  rootPackage?: boolean;
  subpackage?: string;
  pagePath: string;
  tabBar?: boolean;
  preload?: boolean;
}
```

- `pages.json` pages, `subPackages`, and tabBar entries are generated or assembled from route contributions where tooling exists.
- Route metadata must not declare API URLs or SDK methods.
- uni-app UI is touch-first, safe-area-aware, rpx-based, and package-size-conscious. It must not import desktop-only components, browser DOM-only helpers on mini program targets, or Node-only libraries.

## 10. Config, Build, And Release

Rules:

- uni-app env files follow `ENVIRONMENT_SPEC.md` section 5.1: `.env.<profile-id>` with `VITE_SDKWORK_*` public keys; exactly one profile is selected per build and recorded in build evidence.
- `config/mini-program/` and `config/app/` runtime templates (when those targets are enabled) declare matching `SDKWORK_ENVIRONMENT`, `SDKWORK_DEPLOYMENT_PROFILE`, `SDKWORK_PROFILE_ID`, and `SDKWORK_RUNTIME_TARGET` values.
- `src/manifest.json` platform app ids are materialized from `config/host/`; committed manifest values must match the checked-in host examples or remain placeholders.
- Builds contain no access tokens, platform secrets, private upload keys, database URLs, Redis URLs, or signing credentials. IDE private settings stay in ignored local files; a safe `.example` may be committed.
- App packages follow native store rules for icons, screenshots, splash, permissions, and privacy manifests; mini program targets follow platform review/package-size rules.
- Production build/upload commands must run route projection, config validation, platform package validation, manifest validation, and secret scans before upload.

## 11. Standard Commands

uni-app roots should provide:

```text
pnpm install
pnpm dev
pnpm dev:standalone
pnpm dev:cloud
pnpm dev:browser:standalone
pnpm dev:mini-program:standalone
pnpm dev:android-native:standalone
pnpm build
pnpm build:browser
pnpm build:mini-program
pnpm build:android-native
pnpm build:staging
pnpm build:prod
pnpm typecheck
pnpm lint
pnpm test
pnpm test:config
pnpm test:routes
uni build -p mp-weixin --mode cloud.production
```

Rules:

- `pnpm dev` starts the default uni-app development flow for the root's primary target.
- Public commands use the standard action-first runtime-target vocabulary: the H5 platform is `browser`, the mini-program platform is `mini-program`, and the native app platform is `android-native` / `ios-native`. The compilation vendor (for example `mp-weixin`, `app-plus`, or an `h5` build) is an internal runner detail carried by `uni build -p`, never a public command segment — `build:uniapp:mp-weixin` and `dev:uniapp:h5` are invalid target shapes, not valid targets.
- Package-level commands should allow focused tests/static checks for changed packages.

## 12. Verification

Required verification for uni-app architecture changes:

| Verification | Evidence |
| --- | --- |
| Root layout | Static check proves the root path uses `apps/sdkwork-<application-code>-uniapp/` and `.sdkwork/`, enabled `config/browser|mini-program|app`, `config/host`, `src/bootstrap`, `packages/`, route projection targets, `sdks/`, scripts, and tests exist. |
| Package naming | Static check proves packages use `sdkwork-<application-code>-uniapp-*` and reserved console/admin/host forms. |
| Package/subpackage boundary | Static check proves business code lives in SDKWork packages and platform pages/subPackages are projections or thin wrappers. |
| Conditional compilation | Static scan proves `#ifdef` platform conditions stay in the host package and bootstrap, not capability pages/services. |
| Route projection | Tests prove route contributions generate or assemble `pages.json` pages/subPackages/tabBar deterministically. |
| Route alignment | Static checks prove route ids follow the shared route id format and align with other client roots where applicable. |
| SDK boundary | Static scan proves generated app SDK clients with the core transport adapter are used and no raw `uni.request`/manual auth headers/generated SDK edits were introduced. |
| IAM clearing | Tests prove uni storage, token manager, context store, caches, and sensitive state clear on logout/refresh failure/account switch. |
| Host boundary | Static scan proves feature packages do not call `uni.*` or platform globals directly. |
| Config boundary | Tests prove env and host config templates are non-secret and reject private keys, tokens, API keys, database URLs, and private endpoints. |

Acceptance checklist:

- [ ] uni-app root uses `apps/sdkwork-<application-code>-uniapp/` and follows `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.
- [ ] One source authority per target; no competing native mini program business tree.
- [ ] SDKWork packages, not platform pages/subPackages, define the source architecture.
- [ ] `pages.json` projections are generated or assembled from route contributions.
- [ ] Generated TypeScript app SDKs or approved wrappers are injected from bootstrap/core with one shared TokenManager.
- [ ] Platform APIs and conditional compilation stay behind typed host adapters.
- [ ] Route ids align with other client architectures where workflows match.
- [ ] Config, manifest, platform package metadata, and release files are secret-free.
- [ ] Verification evidence is recorded before completion.
