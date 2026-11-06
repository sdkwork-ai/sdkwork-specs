# uni-app x Application Root Architecture Standard

- Version: 1.0
- Scope: SDKWork uni-app x application roots (`apps/sdkwork-<application-code>-uniappx/`), the `vapor` (蒸汽模式) and `vdom` (非蒸汽模式) Vue modes, `.uvue` page and component ownership, `pages.json` route projection, generated TypeScript app/backend SDK integration, `uni.*`/UTS host adapters, HBuilderX-based packaging, and cross-client route alignment
- Related: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APPLICATION_SPEC.md`, `NAMING_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `UNIAPP_APP_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `ICON_SPEC.md`, `FRONTEND_CODE_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `APP_MANIFEST_SPEC.md`, `APP_ASSETS_SPEC.md`, `I18N_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `TEST_SPEC.md`

This standard defines the application-root architecture for SDKWork uni-app x clients. A uni-app x root is one HBuilderX-managed project that ships `.uvue` pages and projects to multiple delivery targets: App (`APP_ANDROID`, `APP_IOS`, `APP_HARMONY`), mini programs (`MP_WEIXIN`, `MP_ALIPAY`, and other `MP_*` profiles), and Web (`H5`, `WEB`).

uni-app x is not a version bump of uni-app. It replaces `.vue` pages with `.uvue` pages, the Vite project scaffold with the HBuilderX project model, and the App rendering pipeline with native rendering. `UNIAPP_APP_ARCHITECTURE_SPEC.md` remains the authority for uni-app; this standard is the authority for uni-app x.

The framework authority is explicit:

- A uni-app x root `MUST` follow this standard as its root architecture authority.
- A uni-app root `MUST` follow `UNIAPP_APP_ARCHITECTURE_SPEC.md` instead.
- A native WeChat mini program source root `MUST` follow `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md` instead.
- One application root `MUST NOT` keep uni-app, uni-app x, and a native mini program tree as competing business source authorities for the same target set. A delivered product may combine a uni-app x root with separate native roots, but each target has exactly one source authority.

SDKWork packages and uni-app x platform `pages`/`subPackages` are different concepts. SDKWork packages are source, dependency, component, and composition boundaries. Platform `pages`, `subPackages`, and tabBar entries are runtime packaging boundaries. Business architecture is expressed through SDKWork packages first, then projected into `pages.json` through route metadata and build tooling.

## 1. Core Model

```text
uni-app x root
  -> thin HBuilderX entry (App.uvue, main.uts, manifest.json, pages.json)
  -> one declared Vue mode: vapor (蒸汽模式) or vdom (非蒸汽模式)
  -> SDKWork packages under packages/
  -> generated TypeScript app SDKs through one uni.request-compatible transport adapter
  -> appbase IAM runtime or approved uni-app x IAM adapter
  -> exactly one global TokenManager
  -> typed host adapters over uni.* APIs and UTS plugins
  -> route contributions projected to pages.json pages, subPackages, and tabBar
```

Rules:

- uni-app x roots `MUST` use SDKWork packages for core, commons, shell, capability, optional console/admin, and host boundaries.
- Root entry files `MUST` stay thin: `App.uvue`, `main.uts`, `manifest.json`, `pages.json`, bootstrap assembly, route projection targets, shell registration, SDK client construction, IAM runtime wiring, and host adapter registration. Login/first-run/tab pages may live in a thin root `pages/` package.
- Business pages, components, services, state, i18n, and route contributions `MUST` live in packages.
- Generated TypeScript app SDK clients are the only business transport. uni-app x packages `MUST NOT` call backend SDKs for user-facing workflows, and `MUST NOT` use raw `uni.request` for business APIs.
- `uni.*`, platform globals, and UTS plugin APIs `MUST` stay behind typed host adapters.

## 2. Vue Mode Contract (Vapor And VDOM)

`vapor` (蒸汽模式) removes the virtual DOM and, on App targets, uses the uni-app x native rendering pipeline. `vdom` (非蒸汽模式) keeps the virtual DOM and the earlier UTS-driven pipeline. Both modes are supported by this standard, and both must satisfy the same package, route, SDK/IAM, host, and verification contract.

### 2.1 Mode declaration

Rules:

- A uni-app x root `MUST` declare exactly one mode through `manifest.json` `uni-app-x.vapor` (`true` = `vapor`, `false` = `vdom`) and mirror it in `agent.app.config.json` `runtime.uniappxMode` with the value `vapor` or `vdom`.
- The two declarations `MUST` agree. A disagreement is a build and verification failure, not a warning.
- The mode is an architecture axis. It is never an environment, deployment profile, profile id, runtime target, target platform, or build format.
- A root `MUST NOT` carry both modes as business source authorities. Mode switching changes the compiled runtime, not the application architecture or route identity.
- `vapor` is the default for new roots. A new root that selects `vdom` `MUST` record the reason in its `docs/architecture/` decision record or `specs/` and keep the same acceptance evidence.
- An existing `vdom` root `MAY` migrate to `vapor` after section 12 evidence; a `vapor` root that switches back to `vdom` `MUST` re-verify source compatibility, because Vapor-authored code may not compile under VDOM.

### 2.2 Mode matrix

| Concern | `vapor` (蒸汽模式) | `vdom` (非蒸汽模式) |
| --- | --- | --- |
| Vue runtime | Virtual DOM removed; template/style compiled to bytecode or machine code on App | Virtual DOM retained |
| App rendering | Native rendering pipeline, App components implemented in C/UTS | Native components with the earlier pipeline |
| Script language | JS/TS (UTS still allowed and runs through UTS-to-JS) | UTS (compiled to Kotlin/Swift/ArkTS/JS) |
| Options API | Not supported | Supported by the runtime but forbidden by this standard |
| Mixins | Not supported | Supported by the runtime but forbidden by this standard |
| Style isolation | 2.0 only, default `isolated` | 2.0 required by this standard |
| CSS selectors | Simple class and group selectors only | Same restriction required for mode portability |
| Conditional token | `VUE3-VAPOR` | No mode token |
| Web/mini program build | Builds with VDOM behavior at runtime | VDOM behavior |
| Minimum App versions | Android 6+, iOS 15+, HarmonyOS API 20+ | Android 5+, iOS 12+, HarmonyOS API 14+ |
| Toolchain | HBuilderX 5.21+ for Android Vapor, 5.11+ for iOS, 5.0+ for HarmonyOS | HBuilderX 4.x+ |

### 2.3 Mode-specific rules

Rules for `vapor`:

- A `vapor` root `MUST` satisfy the mode's minimum platform versions in `manifest.json`: Android `minSdkVersion` 23 or higher, iOS `minimumOSVersion` 15.0 or higher, HarmonyOS `compatibleSdkVersion` API 20 or higher.
- A `vapor` root `MUST` use the `VUE3-VAPOR` conditional token for mode compatibility code, and `MUST NOT` emulate Vapor-only behavior on targets that still run VDOM.
- Web and mini program targets built from a `vapor` root currently run VDOM behavior. Release notes, performance claims, and test evidence `MUST` label those targets as VDOM runtime, not Vapor runtime.
- Vapor App builds `MUST` record the view-layer compilation target (`bytecode` preferred, `machine-code` when required) and the HBuilderX version in build evidence.
- Vapor `list-view`/`list-item` reuse follows the platform contract: `list-item` `v-for` must carry `:key`, the first keyed `v-for` under one `list-view` is the reusable one, and `list-item`/`list-view` stay in the same `.uvue` file. Wrapping `list-item` in another component forfeits reuse.
- `flatten` is applied only to `view`, `text`, and `image` where the merged-node semantics are acceptable. A flattened overlay that must receive events `MUST NOT` use `flatten`.

Rules for `vdom`:

- A `vdom` root `MUST` satisfy its mode's lower minimum versions and `MUST` still avoid APIs removed from the uni-app x common surface.
- A `vdom` root `MUST` keep the same Composition API, `.uvue`, and host-adapter rules as `vapor` so migration stays possible.
- `vdom` roots `MUST NOT` rely on runtime features that Vapor removes, such as Options API, mixins, `this`, or complex CSS selectors, even where the VDOM runtime currently accepts them.

Rules for both modes:

- Pages are `.uvue` files. A `.vue` page `MUST NOT` exist under a uni-app x root: the compiler writes it into `app-config.js` and silently skips page compilation, producing a broken route.
- A `.vue` component is allowed only when a documented dependency ships one and the root imports it explicitly; SDKWork-authored components are `.uvue`.
- `<script setup>` `MUST NOT` declare `lang="ts"` or `lang="uts"` on a page or component. Write the portable TypeScript/UTS-compatible subset; external script files keep the `.uts` extension and may contain JS/TS under `vapor`.
- Composition API only. Options API (`export default { data() {...} }`), mixins, `this`, and Vuex are forbidden in both modes; Pinia is the only allowed application state library.
- Both modes `MUST` pass the same headless TypeScript checks and the same route/SDK/IAM/host verification. A rule that only one mode satisfies is not a valid shared-package rule.

## 3. Standard Root Layout

A uni-app x root is an HBuilderX project. It does not use the `src/` layout of a Vite-scaffolded uni-app project, and it does not use a CLI-created scaffold.

```text
apps/sdkwork-<application-code>-uniappx/
  AGENTS.md
  agent.app.config.json
  .sdkwork/
    README.md
    skills/
      README.md
    plugins/
      README.md
  assets/
    README.md
    resources/
    media/
    capture/
  config/
    browser/
      runtime-env.<deployment-profile>.<environment>.js
    mini-program/
      runtime-env.<deployment-profile>.<environment>.json
    app/
      runtime-env.<deployment-profile>.<environment>.json
    host/
      uniappx-weixin.example.json
      uniappx-app.example.json
    server/
      <application-code>.<deployment-profile>.<environment>.toml.example
    container/
      <application-code>.<deployment-profile>.<environment>.toml.example
  docs/
  scripts/
  sdks/
  specs/
    component.spec.json
    uniappx-mode.spec.json
  bootstrap/
    environment.uts
    runtime.uts
    sdkClients.uts
    iamRuntime.uts
    hostAdapters.uts
    routes.uts
  shell/
  routes/
  pages/
    __generated__/
  static/
  uni_modules/
  packages/
    sdkwork-<application-code>-uniappx-core/
    sdkwork-<application-code>-uniappx-commons/
    sdkwork-<application-code>-uniappx-shell/
    sdkwork-<application-code>-uniappx-<capability>/
    sdkwork-<application-code>-uniappx-console-core/
    sdkwork-<application-code>-uniappx-console-shell/
    sdkwork-<application-code>-uniappx-console-<capability>/
    sdkwork-<application-code>-uniappx-admin-core/
    sdkwork-<application-code>-uniappx-admin-shell/
    sdkwork-<application-code>-uniappx-admin-<capability>/
    sdkwork-<application-code>-uniappx-host/
  tests/
  App.uvue
  main.uts
  manifest.json
  pages.json
  uni.scss
  package.json
  tsconfig.json
```

Rules:

- The root name `apps/sdkwork-<application-code>-uniappx` and the single package segment `uniappx` are canonical. New roots `MUST NOT` use `apps/<application-code>-uniappx/`, `-uniapp-x`, `-uni-app-x`, or `-uni_app_x` forms in a path or package name.
- `manifest.json` `MUST` carry the mandatory `uni-app-x` node. When the node is missing, HBuilderX treats the project as uni-app and the root is invalid.
- `manifest.json` `MUST` carry `"uni-app-x": { "vapor": <mode>, "styleIsolationVersion": "2" }`, with `vapor` matching `agent.app.config.json` `runtime.uniappxMode`. The Gradle/DevEco/CocoaPods native configuration is owned by HBuilderX packaging and is not hand-authored.
- `pages.json` is assembled from route contributions into `pages/__generated__/` where tooling exists. Hand-maintained `pages.json` entries are allowed only for root-owned pages such as login, first-run, and error pages, and `MUST` be listed in the route-projection evidence.
- `config/browser/`, `config/mini-program/`, and `config/app/` exist only for the delivery targets the root actually enables. At least one `MUST` exist.
- `config/host/` owns platform app ids, platform profiles, permission references, upload environment, and store/signing references. It `MUST NOT` contain private keys, tokens, or API keys.
- `uni_modules/` owns vendored UTS plugins. A UTS plugin that contains native business logic `MUST` be wrapped by `sdkwork-<application-code>-uniappx-host`; feature packages `MUST NOT` import a `uni_modules` plugin directly.
- `bootstrap/` is not a business package. It may import package public exports and host contracts, and `MUST NOT` contain pages or business workflows.
- `agent.app.config.json` uses `runtime.family = "mini-program"` for mini-program-only roots, `"mobile"` when App packages are delivered, and `"web"` for Web-only roots; `runtime.framework = "uni-app-x"`; `runtime.clientArchitectures = ["uniappx"]`; `runtime.uniappxMode` is `vapor` or `vdom`; `app.appType = "APP_UNIAPP"` because the backend `PlusProjectType` closed set has no uni-app x member, with the reason recorded in `metadata`; `publish.platforms` lists only the actually delivered `MP_*`, `APP_*`, `H5`, or `WEB` values.
- A root `MUST NOT` add a `vite.config.ts`, `index.html`, or `main.ts` scaffold to imitate uni-app. HBuilderX owns the build configuration; a documented build hook is the only reason to add a configuration file, and it lives under `scripts/` or `config/`.
- `specs/uniappx-mode.spec.json` declares the selected mode, the delivered targets, the mode's minimum versions, and the evidence paths. The shape is validated by `tools/check-uniappx-architecture.mjs`.

## 4. Package Taxonomy

| Package family | Owns | Must not own |
| --- | --- | --- |
| `sdkwork-<application-code>-uniappx-core` | runtime config, SDK factories with the uni-app x request transport adapter, appbase IAM adapter, token/session/context stores, route registry, host adapter contracts | pages, business workflows |
| `sdkwork-<application-code>-uniappx-commons` | domain-neutral `.uvue` components, form/list/error primitives, design tokens, i18n helpers | business pages, SDK construction |
| `sdkwork-<application-code>-uniappx-shell` | app shell, tabBar/page route composition, AuthGate integration, route projection inputs | business services |
| `sdkwork-<application-code>-uniappx-<capability>` | `.uvue` pages, `.uvue` components, services, state (Pinia or equivalent), i18n, route contributions, view models | concrete SDK construction, unrelated capabilities |
| `sdkwork-<application-code>-uniappx-console-*` | user-facing console workflows through app-api | internal operator workflows |
| `sdkwork-<application-code>-uniappx-admin-*` | approved internal operator workflows through backend-api | user app login/session creation |
| `sdkwork-<application-code>-uniappx-host` | `uni.*` adapters, UTS plugin wrappers, platform conditional implementations, permissions, login bridge, storage, file/media pickers, QR/camera/share/push/profile APIs | business API transport, authorization |

Rules:

- uni-app x admin packages require explicit approval, `backend-admin` surface classification, and backend SDK boundary verification.
- Packages without `uniappx-console` or `uniappx-admin` are default uni-app x app/user packages.
- The `<capability>` segment is a concrete business module token in lower kebab-case and `MUST NOT` be a placeholder such as `console`, `admin`, `manager`, `backend`, `common`, or `misc`.
- Shared components remain domain-neutral. Domain components live in the owning capability package.
- One capability package projects to one platform `subPackage` by default unless size or route cohesion requires a documented split.
- A root `MUST` have exactly one `sdkwork-<application-code>-uniappx-host` package. Platform variance is expressed inside it, not by adding per-platform host packages.
- Reusable cross-application components come from `sdkwork-appbase` `packages/uni-app-x/` (base UI and models) and `sdkwork-iam` `apps/sdkwork-iam-uniappx/` (auth, session, account, and user-center components). An application root `MUST NOT` fork them.

## 5. Package Internal Shape

```text
packages/sdkwork-<application-code>-uniappx-<capability>/
  package.json
  README.md
  specs/
    component.spec.json
  src/
    index.uts
    pages/
    components/
    services/
    stores/
    i18n/
    routes/
    host/
    types/
  tests/
```

Rules:

- `src/index.uts` is the public logic export boundary. `.uvue` components are exposed through an explicit component entry (for example `src/components/index.uts` or a documented alias) and imported by path; a package `MUST NOT` rely on automatic easycom discovery across a workspace package boundary.
- `pages/` owns `.uvue` route-level pages before projection into platform pages.
- `components/` owns `.uvue` components. `components/` `MUST NOT` import `uni.*`; host behavior arrives through injected adapters.
- `services/` owns app SDK orchestration through injected SDK clients or service ports; services `MUST NOT` call `uni.request` for business APIs.
- `stores/` owns Pinia view/cache state and must clear sensitive state on logout and account/tenant switch.
- `routes/` owns route contributions and platform placement metadata (root package, `subPackage`, page path, preload).
- `host/` owns adapter contracts used by the package, not `uni.*` implementations.
- Local `types/` owns view models and route params; API DTOs come from generated SDKs.
- Shared pure logic (no Vue render, no `uni.*`) `MAY` use `.ts` so it can be unit-tested with Node. Files that touch Vue lifecycle, page lifecycle, or `uni.*` use `.uts` or `.uvue`.
- Package-level `tsconfig.json` `MUST` typecheck `.ts` logic and declaration files. The uni-app x compiler does not typecheck, so the root `typecheck` command is the only type gate.

## 6. Source And Style Contract

Rules:

- `<script setup>` is mandatory. Options API and mixins are forbidden in both modes.
- Reactive state uses `ref`, `reactive`, `computed`, and `watch`; page lifecycle uses uni-app x lifecycle hooks (`onLoad`, `onShow`, `onReady`, `onUnload`) imported from the framework.
- A `.uvue` component has one visual root where practical; `defineOptions({ styleIsolation })` is set only when the component intentionally accepts external class influence, and the default stays `isolated`.
- CSS uses flex layout (column is the platform default), `px`/`rpx`/`%` units, and `em` only for `line-height`. Grid and block layout, CSS variables, media queries, and keyframes follow the platform compatibility table; unsupported properties are not shipped as dead CSS.
- Text is always inside `<text>` and does not rely on style inheritance. A component `MUST NOT` assume Web text defaults.
- Class names follow BEM (`block__element--modifier`). Complex descendant, child, attribute, and pseudo selectors are forbidden in `vapor` and forbidden in `vdom` for portability. SCSS is allowed because it compiles at build time.
- `MUST NOT` rely on pseudo-elements on App targets; icon glyphs use unicode text or image assets per `ICON_SPEC.md`.
- `v-for` always has a stable `:key`. Lists use `list-view`/`list-item` or `scroll-view` per the platform guidance; large collections never render unbounded nodes.
- Platform-only APIs, DOM APIs, and Node APIs are not imported into `.uvue` files. Feature code consumes host adapter contracts.
- Monetary values, units, and int64 identifiers follow `API_SPEC.md` §13.2 and §13.6; ids stay strings in the client.

## 7. Conditional Compilation Boundary

Rules:

- `#ifdef`/`#ifndef` conditional compilation `MUST` stay inside `sdkwork-<application-code>-uniappx-host/src/` and root `bootstrap/`/`main.uts` platform branches.
- Mode conditions use exactly `VUE3-VAPOR` (with `#ifndef VUE3-VAPOR` for VDOM). Feature packages `MUST NOT` scatter mode conditions through pages, components, or services; mode variance is expressed by host adapter implementations selected at bootstrap.
- Platform conditions use the canonical tokens `APP-ANDROID`, `APP-IOS`, `APP-HARMONY`, `WEB`, `MP-WEIXIN`, `MP-ALIPAY`, and `MP` where a group condition is supported. The uni-app tokens `APP-PLUS` and `H5` are not uni-app x tokens and `MUST NOT` appear.
- A platform-exclusive capability requires an approved component spec that names the exclusive platform set.
- CSS platform conditions follow the same boundary: shared styles are platform-neutral; platform overrides live with the host package or a documented shell adapter.

## 8. Dependency Direction

Allowed flow:

```text
uniappx-core, uniappx-commons
  -> uniappx-shell, uniappx-console-core, uniappx-admin-core
  -> uniappx-console-shell, uniappx-admin-shell
  -> app/console/admin capability packages
  -> root bootstrap and pages.json projection
  -> uniappx-host platform adapters
```

Rules:

- `uniappx-core` and `uniappx-commons` must not import business capability packages.
- Capability services call injected SDK clients or service ports, not raw request APIs.
- Platform implementations live in `uniappx-host`, not feature pages.
- Cross-package imports use package root exports, not private source paths.
- Cyclic workspace dependencies are forbidden.
- Application roots consume shared components from `sdkwork-appbase` and `sdkwork-iam` as workspace dependencies. Copying a shared component into the root is forbidden.

## 9. SDK And IAM Integration

Rules:

- User-facing uni-app x packages `MUST` use generated TypeScript app SDK clients or approved appbase/uni-app x wrappers for `/app/v3/api`. The generated SDK transport is adapted to the uni-app x runtime through one request adapter in `uniappx-core`; feature packages never wire transports.
- uni-app x admin packages, when approved as `backend-admin` surfaces, `MUST` use generated TypeScript backend SDK clients or approved backend wrappers for `/backend/v3/api`.
- The root runtime `MUST` create one global TokenManager shared by the appbase app SDK client, every authenticated app-api SDK client, and explicit `backend-admin` backend SDK clients.
- Appbase login/session behavior uses appbase app SDK resources or the `sdkwork-iam-uniappx` auth packages. Product packages must not create local auth/session endpoints.
- Platform login codes, phone-number grants, profile prompts, scene/query inputs, and provider-specific auth facts are host inputs exchanged through approved app-api/appbase flows, not feature-local raw HTTP.
- Token/session clearing must clear uni-app x storage, token manager, context store, sensitive state, and realtime/session bridges on logout, refresh failure, and account/tenant switch.
- Missing SDK methods must be fixed in app-api/OpenAPI/generator inputs and regenerated; no raw request fallbacks.
- The SDK boundary is identical in both Vue modes. A package `MUST NOT` branch on `VUE3-VAPOR` to choose a different SDK or transport.
- HBuilderX compiler versions and the mode are recorded in SDK/runtime build evidence so generated-client behavior can be reproduced.

## 10. Host Adapter Boundary

Standard uni-app x host adapter categories:

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
windowAndSafeArea
```

Rules:

- Feature packages must not call `uni.*`, UTS plugin APIs, platform globals (`wx.*`, `plus.*`, `window`-only browser APIs), or native bridge objects directly.
- `uniappx-host` provides per-platform implementations and test fakes. Conditional compilation selects implementations, and every delivered target resolves to an implementation or an `unsupported` fallback.
- UTS plugins are wrapped by typed adapters. A plugin `MUST` be replaced by a maintained wrapper, not imported ad hoc by feature code.
- Adapter methods normalize platform-specific errors into stable SDKWork host errors (`unsupported`, `permission-denied`, `unavailable`, `cancelled`, `invalid-state`).
- Scene/query/deep-link inputs validate expected source, path, nonce/state, expiry, and auth requirements before sensitive flows complete.
- File/media upload uses the Drive app SDK or approved Drive uploader facades. Host adapters only select or capture files.
- Payment bridge adapters collect platform payment facts only; payment authorization and order state remain backend/app-api responsibilities.
- A host capability that behaves differently per mode `MUST` hide the difference behind the same contract and return the same result shape.

## 11. Route, Pages.json, And UI Alignment

Rules:

- uni-app x route ids follow `<surface>.<domain>.<capability>.<screen>` and align with PC, H5, Flutter, mini program, uni-app, and native route ids for the same workflow.
- Route contributions declare `id`, `surface`, `domain`, `capability`, `screen`, `titleKey`, auth mode, permission hints, and uni-app x placement metadata:

```ts
export interface UniappxRoutePlacement {
  rootPackage?: boolean;
  subpackage?: string;
  pagePath: string;
  tabBar?: boolean;
  preload?: boolean;
}
```

- `pages.json` pages, `subPackages`, and tabBar entries are generated or assembled from route contributions where tooling exists.
- Every generated tabBar entry `MUST` declare both `iconPath` and `selectedIconPath`: the selected tab uses the filled icon and every unselected tab uses the outline icon of the same glyph per `ICON_SPEC.md` §3.2. A custom tab bar on any target `MUST` consume the same pair.
- Route metadata must not declare API URLs or SDK methods.
- uni-app x UI is touch-first, safe-area-aware, rpx-based, and package-size-conscious. It must not import desktop-only components, browser DOM-only helpers on mini program targets, or Node-only libraries.
- The visual language and route identity stay the same across `vapor` and `vdom`; mode differences are rendering internals, never layout or behavior forks.

## 12. Config, Mode Evidence, Build, And Release

Rules:

- uni-app x env files follow `ENVIRONMENT_SPEC.md` §5.1: `.env.<profile-id>` with `VITE_SDKWORK_*` public keys; the HBuilderX run/publish target is a target axis, never an environment or deployment-profile value.
- `config/mini-program/` and `config/app/` runtime templates (when those targets are enabled) declare matching `SDKWORK_ENVIRONMENT`, `SDKWORK_DEPLOYMENT_PROFILE`, `SDKWORK_PROFILE_ID`, and `SDKWORK_RUNTIME_TARGET` values.
- `manifest.json` platform app ids and minimum versions are materialized from `config/host/`; committed manifest values must match the checked-in host examples or remain placeholders.
- Mode evidence `MUST` include: selected mode, HBuilderX version, whether the view layer used bytecode or machine code on App targets, minimum-version compliance, and target runtime classification (`vapor` or VDOM fallback) for Web/mini program builds.
- Builds `MUST` carry the selected profile's public application access token `SDKWORK_ACCESS_TOKEN` (`APP_ACCESS_TOKEN_SPEC.md`). They `MUST NOT` contain session access tokens, refresh tokens, platform secrets, private upload keys, database URLs, Redis URLs, or signing credentials.
- App packages follow native store rules for icons, screenshots, splash, permissions, privacy manifests, and minimum versions; mini program targets follow platform review/package-size rules.
- Production build/upload commands must run route projection, config validation, manifest/mode validation, platform package validation, and secret scans before upload.
- Hot update (`wgt`) is allowed only when the root records the supported HBuilderX/runtime baseline, keeps the app's native shell version compatible, and passes the store policy review. Hot update never carries secrets.
- Release artifacts record the mode, targets, HBuilderX version, generated SDK versions, and the `specs/uniappx-mode.spec.json` digest.

## 13. Standard Commands

uni-app x roots should provide:

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
pnpm build:ios-native
pnpm build:harmony-native
pnpm build:staging
pnpm build:prod
pnpm typecheck
pnpm lint
pnpm test
pnpm test:config
pnpm test:routes
pnpm test:mode
```

Rules:

- `pnpm dev` starts the default uni-app x development flow for the root's primary target through the HBuilderX CLI or the team's approved wrapper.
- Public commands use the standard action-first runtime-target vocabulary: the Web platform is `browser`, the mini-program platform is `mini-program`, and the native App platform is `android-native`, `ios-native`, or `harmony-native`. The compiler vendor value (`mp-weixin`, `app-android`, `app-ios`, `app-harmony`, `web`) is an internal HBuilderX detail, never a public command segment — `build:uniappx:mp-weixin` and `dev:uniappx:app` are invalid target shapes.
- The Vue mode is read from `manifest.json`/`agent.app.config.json`; it `MUST NOT` be a command segment or an environment variable.
- Version gates: `dev:android-native`/`build:android-native` require HBuilderX 5.21+ for `vapor`; iOS requires 5.11+; HarmonyOS requires 5.0+.
- Package-level commands should allow focused tests/static checks for changed packages.
- Because the uni-app x compiler does not typecheck, `pnpm typecheck` `MUST` run `tsc --noEmit` across shared TypeScript packages and `MUST` fail the build pipeline on errors.

## 14. Verification

Required verification for uni-app x architecture changes:

| Verification | Evidence |
| --- | --- |
| Root layout | Static check proves the root uses `apps/sdkwork-<application-code>-uniappx/`, has `manifest.json` with the `uni-app-x` node, `App.uvue`, `main.uts`, `pages.json`, `.sdkwork/`, at least one enabled `config/browser|mini-program|app`, `config/host`, `bootstrap/`, `packages/`, `specs/uniappx-mode.spec.json`, `sdks/`, `scripts/`, and `tests/`. |
| Mode declaration | Static check proves `manifest.json` `uni-app-x.vapor` agrees with `agent.app.config.json` `runtime.uniappxMode` and with `specs/uniappx-mode.spec.json`. |
| Mode versions | Static check proves the manifest minimum versions satisfy the selected mode for every delivered App target. |
| Package naming | Static check proves packages use `sdkwork-<application-code>-uniappx-*` and reserved console/admin/host forms, with exactly one `-uniappx-host`. |
| Page ownership | Static scan proves pages are `.uvue`, business pages live in packages, and `.vue` pages do not exist under the root. |
| Mode isolation | Static scan proves `VUE3-VAPOR` conditions stay in `uniappx-host` and bootstrap, and no feature package branches on the mode. |
| Source portability | Static scan proves no Options API, mixins, `this`, Vuex, or complex selectors in authored `.uvue`/`.uts` sources. |
| SDK boundary | Static scan proves generated app SDK clients with the core transport adapter are used and no raw `uni.request`/manual auth headers/generated SDK edits were introduced. |
| IAM clearing | Tests prove uni storage, token manager, context store, caches, and sensitive state clear on logout/refresh failure/account switch, in both modes. |
| Host boundary | Static scan proves feature packages do not call `uni.*`, UTS plugins, or platform globals directly. |
| Route projection | Tests prove route contributions generate or assemble `pages.json` pages/subPackages/tabBar deterministically, with paired tab icons. |
| Route alignment | Static checks prove route ids follow the shared format and align with other client roots where applicable. |
| Config boundary | Tests prove env and host config templates are non-secret and reject private keys, tokens, API keys, database URLs, and private endpoints. |
| Build evidence | Release evidence records mode, HBuilderX version, view-layer compilation target, target runtime classification, and minimum-version compliance. |

Acceptance checklist:

- [ ] uni-app x root uses `apps/sdkwork-<application-code>-uniappx/` and follows `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.
- [ ] Exactly one Vue mode is declared and consistent across `manifest.json`, `agent.app.config.json`, and `specs/uniappx-mode.spec.json`.
- [ ] One source authority per target; no competing uni-app, uni-app x, or native mini program business tree.
- [ ] SDKWork packages, not platform pages/subPackages, define the source architecture.
- [ ] Pages are `.uvue`; Composition API only; no Options API, mixins, `this`, or Vuex.
- [ ] `pages.json` projections are generated or assembled from route contributions with paired tab icons.
- [ ] Generated TypeScript app SDKs or approved wrappers are injected from bootstrap/core with one shared TokenManager.
- [ ] Platform APIs, UTS plugins, and conditional compilation stay behind typed host adapters.
- [ ] Mode-specific minimum versions are satisfied and recorded.
- [ ] Route ids align with other client architectures where workflows match.
- [ ] Shared components come from `sdkwork-appbase` / `sdkwork-iam`, not application-local forks.
- [ ] Config, manifest, platform package metadata, and release files are secret-free.
- [ ] Verification evidence is recorded before completion.

## 15. Migration From uni-app And From VDOM

Rules:

- A uni-app root is not renamed into a uni-app x root. Migration creates a uni-app x root, moves business code into `uniappx` packages, and retires the uni-app root only after the new root passes its own release gate.
- The migration sequence follows the platform guide and SDKWork gates: normalize layout to flex, move text into `<text>`, converge CSS to supported properties and simple selectors, convert Options API to Composition API, remove mixins/`this`/Vuex, replace `.vue` pages with `.uvue`, replace incompatible component libraries with `uni-app-x`-compatible ones, then select the mode.
- A `vdom` root migrates to `vapor` only after: selectors and style isolation 2.0 are applied, Options API is gone, Android `uvue` code no longer calls native APIs directly (move those to UTS plugins), and the manifest mode switch is verified on every delivered target.
- Migration evidence `MUST` show route-id parity, SDK/IAM parity, and the same or better performance and accessibility results on each delivered target.

## 16. Relationship To Other Client Roots

| Situation | Root |
| --- | --- |
| App-first cross-platform product (Android/iOS/HarmonyOS plus Web/mini program) | `uniappx` |
| Existing uni-app product that stays on Vue 3 + Vite and the uni-app runtime | `uniapp` |
| Native-platform UX, platform SDK depth, or single-platform store product | `android-mobile`, `ios-mobile`, or `harmony-mobile` |
| Mini-program-only product | `mini-program` |
| Browser-first product | `pc` and `h5` (Adaptive Web pair) |

Rules:

- A product `MUST` choose one source root per target. Running a uni-app x App build does not create a native mobile root, and running a Web build does not create an `h5` root.
- A uni-app x root and a native root may coexist for the same product only when each target has one authority and cross-root route ids, SDK surfaces, and i18n keys align.
- DCloud has announced the end of uni-app App-platform maintenance in 2027 and positions `vapor` as the successor path. New App-first products should choose `uniappx` unless an existing dependency or plugin blocks it, and that blocker is recorded in the root's decision record.
