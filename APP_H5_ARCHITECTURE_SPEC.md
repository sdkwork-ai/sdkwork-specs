# H5 Application Architecture Standard

- Version: 1.1
- Scope: SDKWork phone-first H5 application roots, mobile browser applications, WeChat-H5 style browser runtimes, embedded WebView mobile runtimes, and multi-platform mobile app packaging (iOS and Android) through one Capacitor host that reuses the same H5 renderer
- Related: `SDKWORK_WORKSPACE_SPEC.md`, `APPLICATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `NAMING_SPEC.md`, `APP_MANIFEST_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `GOVERNANCE_SPEC.md`, `TEST_SPEC.md`

This standard defines the application-root architecture for SDKWork H5 applications. H5 is the canonical phone-first mobile web runtime. Capacitor is one optional native host that packages the H5 renderer as installable iOS and Android applications; it is not a separate application architecture. H5 browser mode, WeChat-H5 mode, embedded WebView mode, Capacitor iOS mode, and Capacitor Android mode reuse one mobile renderer, one route contribution model, one generated TypeScript app SDK composition layer, one appbase IAM runtime, and one package taxonomy.

One Capacitor host package serves every shipped mobile platform. Platform differences — native project layout, permission manifests, deep-link mechanism, push service, secure storage, signing, and release channel — live inside that one host package and in `config/host/native/<platform>/` as **platform profiles**. They `MUST NOT` become forked hosts, forked renderers, duplicated business packages, or a second appbase IAM runtime. Section 8 owns the platform profile registry and the per-platform rules.

This file is the H5 application root standard and the single authoritative entrypoint for SDKWork H5/Capacitor application architecture. `APP_MOBILE_REACT_UI_SPEC.md` remains the detailed mobile React UI package standard.

Reference inputs:

- `APP_PC_ARCHITECTURE_SPEC.md` defines the aligned application-root shape, thin root shell, package taxonomy, SDK/IAM boundary, app/console/admin separation, and verification style that H5 roots mirror for the mobile web surface.
- `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` defines cross-client route identity, package roles, dependency direction, host adapter boundaries, and SDK/runtime composition shared by PC, H5, Flutter, mini program, Android, iOS, and Harmony roots.
- `APP_MOBILE_REACT_UI_SPEC.md` defines screen, component, hook, service, state, i18n, and mobile interaction details inside H5 mobile React packages.

## 1. Core Model

An H5 application root composes packages. It does not become the place where mobile business behavior accumulates.

```text
H5 application root
  -> root src bootstrap, providers, route assembly, mobile shell entry
  -> package families under packages/
  -> generated TypeScript app SDK clients and appbase IAM runtime
  -> app-api, protected open-api, dependency app SDKs, and approved local runtime APIs
  -> typed H5/browser/WebView/Capacitor host adapter contracts
  -> optional Capacitor host package for iOS and Android release targets
```

Rules:

- One H5 application root `MUST` support H5 browser mode.
- H5 means phone-first, touch-first, compact mobile web behavior. It is separate from PC large-screen browser/tablet behavior, Flutter mobile, mini program, and native Android/iOS/Harmony roots.
- Capacitor iOS and Android targets `MUST` reuse the same H5 renderer, route contributions, SDK clients, appbase IAM runtime, and global TokenManager.
- Root `src/` `MUST` stay thin: bootstrap, providers, global mobile shell, AuthGate wiring, route assembly, runtime config selection, SDK client construction, IAM runtime wiring, and host adapter registration.
- Business screens, components, hooks, services, state, route contributions, i18n, host adapter contracts, and workflow-specific view models `MUST` live in packages.
- Generated SDK clients `MUST` be constructed in bootstrap/core code and injected into services or providers.
- UI packages `MUST NOT` construct raw HTTP calls, manual auth headers, manual API key headers, or generated SDK clients for business flows.
- Capacitor host code `MUST NOT` own business authentication, business authorization, remote business API calls, SDK construction, generated SDK output, or business state machines.
- Appbase IAM login, registration, session, refresh, logout, current user, runtime metadata, and token propagation `MUST` follow `APP_SDK_INTEGRATION_SPEC.md` and `IAM_LOGIN_INTEGRATION_SPEC.md`.

## 2. Standard Root Layout

Every new H5 application root `MUST` use the directory name
`apps/sdkwork-<application-code>-h5/` and start from this layout unless an exception is
recorded through `GOVERNANCE_SPEC.md`. The root directory name carries the
SDKWork namespace, product identity, and H5 architecture segment together; new
roots `MUST NOT` use the shorter `apps/<application-code>-h5/` form.

```text
apps/sdkwork-<application-code>-h5/
  AGENTS.md
  sdkwork.app.config.json
  .sdkwork/
    README.md
    skills/
      README.md
    plugins/
      README.md
  bin/
    ios/
    android/
  etc/
    README.md
    sdkwork.deployment.config.json
  .env.<deployment-profile>.<environment>
  config/
    browser/
      runtime-env.<deployment-profile>.<environment>.example.json
    host/
      README.md
      capacitor.<environment>.example.json
      native/
        ios/
          ios.<environment>.example.json
          deep-link-capabilities.snippet.plist
        android/
          android.<environment>.example.json
          deep-link-intent-filter.snippet.xml
    server/
      <application-code>.<deployment-profile>.<environment>.toml.example
    container/
      <application-code>.<deployment-profile>.<environment>.toml.example
  docs/
  public/
  scripts/
  sdks/
  specs/
  src/
    main.tsx
    App.tsx
    AuthGate.tsx
    index.css
    bootstrap/
      environment.ts
      runtime.ts
      sdkClients.ts
      iamRuntime.ts
      tokenManager.ts
      hostAdapters.ts
      routes.ts
    providers/
    shell/
    routes/
  packages/
    sdkwork-<application-code>-h5-core/
    sdkwork-<application-code>-h5-commons/
    sdkwork-<application-code>-h5-shell/
    sdkwork-<application-code>-h5-<capability>/
    sdkwork-<application-code>-h5-console-core/
    sdkwork-<application-code>-h5-console-shell/
    sdkwork-<application-code>-h5-console-<capability>/
    sdkwork-<application-code>-h5-admin-core/
    sdkwork-<application-code>-h5-admin-shell/
    sdkwork-<application-code>-h5-admin-<capability>/
    sdkwork-<application-code>-h5-capacitor/
      package.json
      capacitor.config.ts
      src/
        host/
          registry.ts
          browser/
          ios/
          android/
        plugins/
          sdkwork-host.ts
          sdkwork-host.ios.ts
          sdkwork-host.android.ts
      resources/
        icons/
        splash/
      ios/
        App/
          App.xcodeproj/
          App/
            Info.plist
            AppDelegate.swift
            Assets.xcassets/
          CapApp-SPM/
            Package.swift
          App.entitlements
          debug.xcconfig
      android/
        app/
          build.gradle
          src/main/
            AndroidManifest.xml
            res/
        variables.gradle
        build.gradle
        settings.gradle
        gradle/
          libs.versions.toml
        gradlew
        gradlew.bat
  tests/
  index.html
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.json
  vite.config.ts
```

Directory rules:

- The root name `apps/sdkwork-<application-code>-h5` and package segment `h5` are canonical for H5/Capacitor application roots.
- `.sdkwork/` is required by `SDKWORK_WORKSPACE_SPEC.md` for repository/application skills and plugins. It is not generated SDK output and is not user runtime state.
- `bin/` contains cross-platform operational scripts for build, install, run, diagnostics, and mobile host helper commands when the H5 root is runnable outside a larger workspace.
- `config/browser/` owns public browser-visible runtime config for H5. It is named `browser` to align with PC and other browser renderers.
- `config/host/` owns Capacitor platform templates, permission metadata, URL scheme/app link references, native capability flags, and signing reference metadata. It must not contain secrets.
- `config/server/` and `config/container/` are present only when the H5 root owns a server/container runtime or local preview service. They must remain separate from browser and host config.
- `docs/` contains H5 architecture notes, runbooks, release notes, platform review notes, and local decisions.
- `public/` contains browser-served static assets only.
- `scripts/` contains build, validation, generation, release, and development utilities.
- `sdks/` contains application-root SDK workspaces and generator inputs according to `SDK_WORKSPACE_GENERATION_SPEC.md`.
- `specs/` contains local component/application specs that extend, but do not contradict, this canonical specs directory.
- `src/` is the root shell entry and composition boundary only.
- `packages/` contains all reusable runtime, shell, app, console, admin, and native host packages.
- `packages/sdkwork-<application-code>-h5-capacitor` is the only package that may own Capacitor configuration, plugin implementation, generated native project directories, and platform-specific host implementations.
- Generated Capacitor `ios/` and `android/` directories must not contain product business logic or app SDK transport.
- `bin/ios/` and `bin/android/` own platform build, signing, and store-submission helper entrypoints. They call package and native toolchain commands; they must not become a second build system.
- `config/host/native/ios/` and `config/host/native/android/` own per-platform profile templates and native snippet fragments. Snippets are reviewable templates for what must appear in the generated native project, not generated output.
- Platform subtrees `packages/sdkwork-<application-code>-h5-capacitor/ios/` and `.../android/` are the only place platform-specific native code may live. One platform subtree `MUST NOT` contain another platform's code, and neither may contain business screens, business services, or app SDK construction.
- `ios/App/CapApp-SPM/Package.swift` and `ios/App/debug.xcconfig` are Capacitor-generated output and `MUST NOT` be hand-edited.
- `tests/` contains application-level integration, runtime, route, package-boundary, host-adapter, config, and release verification tests.

## 2.1 Configuration And Environment Matrix

H5 application roots must keep lifecycle environment, profile alias, build mode, deployment profile, runtime target, and host target separate.

| Concern | Standard values | Owner |
| --- | --- | --- |
| Lifecycle environment | `development`, `test`, `staging`, `demo`, `production` | `CONFIG_SPEC.md` typed runtime config |
| Profile alias | `dev`, `test`, `staging`, `prod` | legacy command/operator compatibility only |
| Build mode | Vite/Capacitor/build-tool mode | build scripts and tool config |
| Deployment profile | `standalone`, `cloud` | runtime/bootstrap |
| Runtime target | `browser`, `capacitor-ios`, `capacitor-android`, `server`, `container`, `test-runner`; WeChat browser and embedded WebView are host/runtime variants, not canonical runtime targets | runtime/bootstrap |

Standard config ownership:

| Config family | Example files | Owns | Must not own |
| --- | --- | --- | --- |
| Vite/browser build env | `.env.<deployment-profile>.<environment>` | public `VITE_*` profile identity, SDK base URLs, public flags | secrets, tokens, database/Redis config, Capacitor packaging metadata |
| Browser public runtime | `config/browser/runtime-env.<deployment-profile>.<environment>.example.json`, `/runtime-env.js` | public SDK base URLs, public feature flags, public app metadata, H5 host capability flags | secrets, database URLs, Redis URLs, tokens, refresh tokens, private service endpoints |
| Shared host runtime | `config/host/capacitor.<environment>.example.json`, `capacitor.config.ts` | Capacitor `appId` / `appName` / `webDir`, server allow-navigation entries, shared plugin flags, capability enablement | signing private keys, API keys, auth tokens, business API paths, SDK ownership |
| iOS host platform runtime | `config/host/native/ios/ios.<environment>.example.json`, `config/host/native/ios/*.snippet.plist`, `ios/App/App/Info.plist` | iOS bundle id reference, associated domains, URL schemes, `Info.plist` usage-description references, APNs profile reference, signing reference names, store profile references | secrets, signing private keys, provisioning profiles, business API paths, SDK ownership |
| Android host platform runtime | `config/host/native/android/android.<environment>.example.json`, `config/host/native/android/*.snippet.xml`, `android/app/src/main/AndroidManifest.xml` | Android application id reference, App Links, manifest permission references, FCM profile reference, min/target SDK references, signing reference names, store profile references | secrets, keystore files, `keystore.properties`, business API paths, SDK ownership |
| Server runtime | `config/server/<application-code>.<deployment-profile>.<environment>.toml.example`, `/etc/sdkwork/<application-code>/<process>.toml` | bind address, API gateway, PostgreSQL, Redis, reverse proxy trust, service paths when the app owns server runtime | browser-only `VITE_*`, Capacitor packaging metadata |
| Container runtime | `config/container/<application-code>.<deployment-profile>.<environment>.toml.example`, mounted `/etc/sdkwork/...` | container service config, mounted secrets, external service endpoints, volumes | image-baked secrets or mutable database state |

The browser runtime source matrix is one file per supported
`<deployment-profile>.<environment>` combination (all ten when both
`standalone` and `cloud` ship all five lifecycle environments) using the
canonical `runtime-env.<deployment-profile>.<environment>.json` name — never
environment-only or profile-only names. Value rules per profile follow
`ENVIRONMENT_SPEC.md` §5.1.0.1: `standalone` sources use the same-origin root
`/` for every SDK base URL; `cloud` sources use the unified `cloudApiBaseUrl`
origin for the environment (`api-dev.<domain>` … `api-demo.<domain>` … `api.<domain>`).

Host config is keyed by `<environment>` only — `config/host/capacitor.<environment>.example.json` and
`config/host/native/<platform>/<platform>.<environment>.example.json`. This is deliberate: a native
package identity, a signing identity, and a store lane are environment-scoped, so the deployment
profile is recorded as a field inside the host profile rather than as a file-name segment. It is not
a licence to use environment-only names for `config/browser/`, `config/server/`, or `config/container/`.

Rules:

- H5 roots `MUST` provide safe example config for every runtime target they support.
- H5 and Capacitor renderers `MUST` use
  `.env.<deploymentProfile>.<environment>` with Vite mode equal to the exact
  profile id. Capacitor does not create a second env namespace; native package
  metadata stays in `config/host/`.
- H5 env content `MUST` expose matching `VITE_SDKWORK_ENVIRONMENT`,
  `VITE_SDKWORK_DEPLOYMENT_PROFILE`, `VITE_SDKWORK_PROFILE_ID`, and a runtime
  target resolved as `browser`, `capacitor-ios`, or `capacitor-android` by the
  selected build/bootstrap adapter.
- `development`, `test`, `staging`, `demo`, and `production` examples are required for server/container targets; browser and host targets should provide the same set unless the target is explicitly dev-only.
- `dev` and `prod` are command/operator aliases only. Env file names and
  runtime config use canonical environment and profile-id values.
- `.env.local`, `.env.<profile>.local`, `.env.postgres`, `.env.release.local`, `config/*.local.*`, native signing files, and platform credential files must be ignored.
- `pnpm dev` delegates to `dev:standalone`; `dev:browser:standalone` and
  `dev:browser:cloud` are the explicit H5 browser profile commands.
- `pnpm test` uses an isolated test profile and must not share development or production database/schema, Redis prefix, logs, cache, runtime, or temp directories.
- Browser SDK base URLs must be loaded from public runtime config before SDK client construction. Vite `VITE_*` variables are public non-secret build/dev inputs only.
- Release builds must fail preflight if production profiles contain localhost service endpoints, development secrets, test database names, writable developer directories, unresolved placeholders, or source-controlled secret files.

## 2.2 Platform Deployment Matrix

H5 applications share one mobile renderer and one package taxonomy across browser and optional native-host targets.

| Target | Standard mode | Host/package | Required behavior |
| --- | --- | --- | --- |
| Mobile H5 browser | `h5` | root Vite/browser build | Phone-first renderer, public runtime config, generated app SDKs, no native host dependency |
| WeChat H5 browser | `h5-weixin` | H5 renderer with WeChat bridge adapter | Same SDK/IAM boundary with WeChat browser facts behind typed host adapters |
| Embedded WebView | `webview` | H5 renderer embedded by another approved host | Same route/SDK/runtime model, host facts injected through adapter contract |
| iOS Capacitor app | `capacitor-ios` | `sdkwork-<application-code>-h5-capacitor` | Same renderer, iOS bundle id, universal links, push, secure storage, IPA/TestFlight/App Store or private distribution workflow |
| Android Capacitor app | `capacitor-android` | `sdkwork-<application-code>-h5-capacitor` | Same renderer, Android package id, app links, push, secure storage, APK/AAB/Google Play or private distribution workflow |

Per-platform contract for the one Capacitor host. Every shipped platform `MUST` satisfy every row for its column:

| Concern | iOS (`capacitor-ios`) | Android (`capacitor-android`) |
| --- | --- | --- |
| Platform identity field | `app.identifiers.bundleId` (reverse-DNS) | `app.identifiers.packageName` (reverse-DNS, Gradle `applicationId`) |
| Native project root | `ios/App/` | `android/app/` plus `android/variables.gradle` |
| Dependency manager | Swift Package Manager (`ios/App/CapApp-SPM/Package.swift`, generated) | Gradle wrapper plus `gradle/libs.versions.toml` |
| Permission declaration | `ios/App/App/Info.plist` usage-description keys | `android/app/src/main/AndroidManifest.xml` plus runtime permission flow |
| Deep-link mechanism | Universal Links (associated domains) primary; custom URL scheme secondary | Android App Links (`android:autoVerify`) primary; custom URL scheme secondary |
| Push service | APNs | FCM |
| Secure storage | Keychain behind the secure-storage adapter | Android Keystore behind the secure-storage adapter |
| Release artifact | `.ipa` (App Store, TestFlight, or private) | `.aab` (Play) or `.apk` (private or enterprise) |
| Platform profile template | `config/host/native/ios/ios.<environment>.example.json` | `config/host/native/android/android.<environment>.example.json` |
| Platform snippet fragments | `config/host/native/ios/*.snippet.plist` | `config/host/native/android/*.snippet.xml` |
| iOS deployment target | 15.0 | n/a |
| Android SDK floors | n/a | `minSdkVersion` 24; `compileSdkVersion` = `targetSdkVersion` = 36 |
| Build toolchain floor | macOS with Xcode 26.0+ | Android Studio Otter (2025.2.1)+, AGP 8.13.0, Gradle wrapper 8.14.3, Kotlin 2.2.20, Java 21 |

Rules:

- The H5 renderer `MUST` be the source of truth for H5 browser, WeChat-H5, embedded WebView, and Capacitor targets.
- Capacitor targets `MUST NOT` introduce app-only business screens, app-only SDK wrappers, copied auth stores, divergent route ownership, or a second appbase IAM runtime.
- Host-specific bridges may expose platform facts and local capabilities only. Business workflows still call generated SDK clients through services.
- H5 public runtime config must load before SDK clients are constructed.
- H5 browser fallback adapters must represent unavailable native capability with stable user-safe errors.
- iOS builds require macOS and Apple tooling. Android builds require Android SDK/JDK/Gradle tooling. CI and release runbooks must document runner requirements.
- A platform `MAY` be unshipped only if it declares no build commands, no config checker, no manifest publish entry, and no `config/host/native/<platform>/` profile. A half-wired platform is a defect, not a partial state.
- Platform identity `MUST` have exactly one authority: `sdkwork.app.config.json`. The `capacitor.config.ts` `appId`, the Xcode bundle identifier, and the Gradle `applicationId` are projections of that authority and `MUST` agree; a mismatch `MUST` fail release preflight.
- The SDK and toolchain floors track the declared Capacitor major. Raising the Android target SDK `MUST` be done by upgrading the Capacitor major, never by editing `targetSdkVersion` alone: Capacitor binds the target SDK to its major version and does not support custom target SDK values.
- New iOS projects `MUST` use Swift Package Manager. CocoaPods is maintenance-mode only and `MUST NOT` be selected for new roots; Swift Package Manager and CocoaPods `MUST NOT` be mixed in one project.
- `ios/App/CapApp-SPM/Package.swift` and `ios/App/debug.xcconfig` are generated by the Capacitor CLI on `cap sync`. They `MUST NOT` be hand-edited; native customization belongs in `Info.plist`, `AppDelegate.swift`, entitlements, `Assets.xcassets/`, or the Gradle and manifest files.
- Capacitor 8 removed `adjustMarginsForEdgeToEdge`; safe-area and system-bar inset handling `MUST` use the System Bars plugin instead of that removed option.

## 2.3 Required Application Capabilities

A complete H5 application standard covers more than mobile screens and package names.

| Capability | Owner package or layer | Required standard |
| --- | --- | --- |
| Runtime/bootstrap | root `src/bootstrap/`, `h5-core` | Environment, SDK clients, appbase IAM runtime, global TokenManager, host adapters |
| App shell | `h5-shell` | Mobile route assembly, tab/stack/sheet navigation, AuthGate, user workspace entry |
| User console shell | `h5-console-shell` | User-facing mobile management console navigation, route assembly, console permission hints |
| Internal admin shell | `h5-admin-shell` | Approved internal mobile admin navigation, backend route guards, audit-sensitive layout |
| App domain features | `h5-<capability>` | User-facing screens, services, hooks, i18n, app SDK orchestration |
| Console domain features | `h5-console-<capability>` | Customer/tenant/app-owner mobile management workflows, app SDK orchestration |
| Admin domain features | `h5-admin-<capability>` | Approved internal operations through backend SDK orchestration |
| SDK workspace | `sdks/`, `h5-core/src/sdk/` | Generated SDK family declaration, dependency SDK composition, no generated output edits |
| IAM/session | appbase packages and `h5-core` | Login, registration, refresh, logout, current session, TokenManager propagation |
| Permissions | surface shells and services | Frontend hints only; app-api/backend-api remains authoritative |
| Drive/media/files | domain packages plus generated Drive SDKs | Camera/file selection, Drive-backed upload/download, media contracts |
| Realtime/notifications | appbase/product service packages plus host adapters | Websocket/SSE/realtime clients, push adapter over APNs (iOS) and FCM (Android), logout clearing |
| Deep links | shell packages, host package | Route id hydration, OAuth/QR/password-reset callbacks, state/nonce validation |
| Secure storage | `h5-core`, `h5-capacitor` | One adapter contract with a browser fallback, a Keychain implementation (iOS), and an Android Keystore implementation (Android); logout clearing |
| Mobile resilience | `h5-core`, domain services | Network status, retry/reconnect, background/foreground behavior, safe offline cache |
| Diagnostics and support | `h5-core`, host package | Safe diagnostics bundle, user-safe error reports, no secret logging |
| Release channels | `scripts/`, `h5-capacitor`, app manifest | H5 asset release, per-platform `.ipa` and `.aab`/`.apk` metadata, rollback notes, staged rollout |

Rules:

- An H5 application is incomplete if it defines screens but omits SDK/IAM bootstrap, route ownership, host adapter boundaries, runtime config, release commands, or architecture verification.
- Every capability `MUST` have an owner package or owner layer. Shared capabilities `MUST` use public exports and service ports; they `MUST NOT` use deep imports or copied runtime singletons.
- Capability implementation order should start from runtime/bootstrap, SDK/IAM, shell routing, then domain packages, then host packaging. Host packaging must not force a redesign of SDK or auth boundaries.
- A capability implemented on one mobile platform `MUST` degrade on the other platform with a stable `unsupported` adapter error. It `MUST NOT` throw, silently no-op, or be feature-detected by UI packages.

## 3. Package Taxonomy

H5 package directory names `MUST` include the application code and the `h5` surface segment.

| Package family | Naming | Surface | Owns | Must not own |
| --- | --- | --- | --- | --- |
| Core runtime | `sdkwork-<application-code>-h5-core` | shared H5 runtime | SDK client factories, TokenManager binding, appbase IAM runtime, session/context stores, runtime config, route registry, host adapter contracts | screens, business workflows |
| Commons | `sdkwork-<application-code>-h5-commons` | shared mobile UI/runtime | mobile UI primitives, safe-area helpers, touch/form/list primitives, design-system adapters, domain-neutral hooks | business screens, concrete SDK construction |
| App shell | `sdkwork-<application-code>-h5-shell` | app/user shell | mobile navigation container, tab/stack/sheet layout, app route composition, app AuthGate integration | console/admin routes, business services |
| App capability | `sdkwork-<application-code>-h5-<capability>` | app/user | user-facing screens, components, hooks, services, state, i18n, route contributions, view models | console/admin workflows, concrete SDK construction |
| Console core | `sdkwork-<application-code>-h5-console-core` | user console runtime | console SDK providers, console permission hints, mobile console session/runtime helpers | app shell, internal admin SDK resources |
| Console shell | `sdkwork-<application-code>-h5-console-shell` | user console shell | user-facing mobile management console navigation and route composition | app routes, internal admin navigation |
| Console capability | `sdkwork-<application-code>-h5-console-<capability>` | user console | customer/tenant/app-owner mobile management workflows through app-api | company-internal admin behavior |
| Admin core | `sdkwork-<application-code>-h5-admin-core` | `backend-admin` runtime, approved only | backend SDK provider, admin permission/audit helpers, admin route guards, operator context | user login UI, app-api session creation |
| Admin shell | `sdkwork-<application-code>-h5-admin-shell` | internal mobile admin, approved only | internal staff navigation, route composition, audit-sensitive transitions | app or console navigation |
| Admin capability | `sdkwork-<application-code>-h5-admin-<capability>` | internal mobile admin, approved only | internal operator workflows through backend-api | user app workflows, app SDK login/session creation |
| Capacitor host | `sdkwork-<application-code>-h5-capacitor` | native host, one package for every mobile platform | Shared Capacitor config and plugin bridge, per-platform native subtrees (`ios/`, `android/`), per-platform profiles, permission declarations, package metadata, typed host implementations plus their platform-specific variants | business API calls, business authorization, SDK generation, forked renderers, forked business screens |

Rules:

- H5 mobile capability packages follow `APP_MOBILE_REACT_UI_SPEC.md` for screens, components, hooks, services, state, i18n, navigation, and host contracts.
- Admin package families for H5 roots require explicit governance approval, `backend-admin` surface classification, and backend SDK boundary verification.
- Shared UI primitives belong in `h5-commons`. Shared runtime/session/SDK behavior belongs in `h5-core`.
- `core`, `commons`, and `shell` package names are reserved for infrastructure. They `MUST NOT` own business screens or business services.
- Capability names `MUST` be lower kebab-case and align with canonical domains or approved business capabilities.
- Packages without `h5-console` or `h5-admin` are default mobile app/user packages.
- `h5-console-<capability>` packages are the user-facing mobile management console family. They follow the same package-internal shape as `h5-<capability>` packages, but their routes, i18n, services, and state are scoped to customer, tenant, app-owner, or app-user management workflows.
- `h5-admin-<capability>` packages are approved internal operations admin packages and map to `backend-admin`; they must not be used for user-facing management console workflows.
- The `<capability>` segment is the concrete business module token. It `MUST NOT` be a placeholder such as `console`, `admin`, `manager`, `backend`, `common`, or `misc`.
- The Capacitor host package is exactly one package per H5 root and `MUST` serve every shipped mobile platform. Platform-split host packages such as `sdkwork-<application-code>-h5-capacitor-ios` or `-h5-capacitor-android` `MUST NOT` be introduced; platform differences belong in subtrees of the one package, not in a second package.

Examples:

```text
sdkwork-shop-h5-merchandise
sdkwork-shop-h5-cart
sdkwork-shop-h5-orders
sdkwork-shop-h5-console-settings
sdkwork-shop-h5-console-settlements
sdkwork-shop-h5-admin-monitor
sdkwork-shop-h5-capacitor
```

## 4. App, Console, And Admin Surface Rules

H5 app, console, and admin surfaces share the same root and renderer stack, but they have different users, API surfaces, SDK clients, routes, and permission models.

| Surface | Package pattern | Typical users | API/SDK boundary | Route ownership |
| --- | --- | --- | --- | --- |
| App | `sdkwork-<application-code>-h5-<capability>` | end users and app users on mobile web/app | app-api through generated app SDKs; protected open-api only through injected approved clients | app shell |
| Console | `sdkwork-<application-code>-h5-console-<capability>` | customers, tenant owners, app owners, business users managing their own resources from mobile | app-api through generated app SDKs or approved console-facing app SDK wrappers | console shell |
| Admin | `sdkwork-<application-code>-h5-admin-<capability>` | approved internal company staff, operators, support, auditors | backend-api through generated backend SDKs; appbase backend SDK for IAM administration | admin shell |

Rules:

- App packages `MUST NOT` import console or admin package internals.
- Console packages `MUST NOT` import admin package internals or use backend-only operations unless an explicit backend-for-console contract is approved.
- Admin packages `MUST NOT` import app/user screens, user console screens, or app-api login/session resources.
- Shared visual primitives belong in `h5-commons`. Shared SDK/session/runtime logic belongs in `h5-core`. Shared surface-specific runtime logic belongs in `h5-console-core` or `h5-admin-core`.
- Cross-surface workflows `MUST` be composed through public package exports, SDK service ports, or generated SDK clients. They `MUST NOT` share route constants, hidden globals, or deep `src/` imports.
- Mobile admin surfaces are high-risk and require governance approval because mobile devices have different loss, lock-screen, notification, and secure-storage risks than PC internal admin surfaces.

## 5. Package Internal Shape

Capability packages should use a consistent internal shape.

```text
packages/sdkwork-<application-code>-h5-<surface-or-capability>/
  package.json
  README.md
  src/
    index.ts
    screens/
    components/
    hooks/
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

- `src/index.ts` is the only public export boundary.
- `screens/` owns route-level mobile UI.
- `components/` owns rendering units and receives data through props or hooks.
- `hooks/` owns React binding around service and state behavior.
- `services/` owns SDK orchestration, validation mapping, error normalization, and business workflow coordination through injected SDK clients or service ports.
- `state/` owns view/cache state only and must clear sensitive state on logout, refresh failure, tenant switch, and account switch.
- `i18n/` owns package-local mobile locale fragments and thin aggregation exports. Authored whole-root or whole-package locale monoliths are forbidden by `I18N_SPEC.md`.
- `routes/` and `navigation/` own route contributions, tab/stack/modal/sheet metadata, and deep-link mapping inputs.
- `host/` owns host adapter contracts used by the package, not Capacitor plugin implementations.
- API DTOs come from generated SDKs or shared contract packages. Local `types/` contains view models and route params only.

Core package shape:

```text
packages/sdkwork-<application-code>-h5-core/
  src/
    index.ts
    config/
    host/
    runtime/
    sdk/
    session/
    storage/
```

Capacitor host package shape (one package, per-platform subtrees):

```text
packages/sdkwork-<application-code>-h5-capacitor/
  package.json
  capacitor.config.ts
  src/
    index.ts
    host/
      registry.ts
      browser/
      ios/
      android/
    plugins/
      sdkwork-host.ts
      sdkwork-host.ios.ts
      sdkwork-host.android.ts
  resources/
    icons/
    splash/
  ios/
    App/
      App.xcodeproj/
      App/
        Info.plist
        AppDelegate.swift
        Assets.xcassets/
      CapApp-SPM/
        Package.swift
      App.entitlements
      debug.xcconfig
  android/
    app/
      build.gradle
      src/main/
        AndroidManifest.xml
        res/
    variables.gradle
    build.gradle
    settings.gradle
    gradle/
      libs.versions.toml
    gradlew
    gradlew.bat
  tests/
```

Rules:

- `src/index.ts` is the only public export boundary, exactly as in capability packages.
- `src/host/<platform>/` holds that platform's adapter implementations; `src/host/browser/` holds the browser fallbacks. A platform directory `MUST NOT` import another platform's directory.
- `src/plugins/` holds the one SDKWork Capacitor plugin carrying the shared method table plus its per-platform files. Additional ad-hoc plugins `MUST NOT` be added for individual capabilities.
- `ios/` and `android/` are the only platform subtrees. Adding a third mobile platform means adding a third subtree plus its profile, not restructuring the package.
- `tests/` `MUST` cover the adapter parity gate, the browser fallback path, and the profile/identity agreement checks.

## 6. Dependency Direction

Allowed dependency flow:

```text
h5-core, h5-commons
  -> h5-shell, h5-console-core, h5-admin-core
  -> h5-console-shell, h5-admin-shell
  -> app/console/admin capability packages
  -> root src composition
  -> optional h5-capacitor host
```

Rules:

- `h5-core` and `h5-commons` `MUST NOT` depend on business capability packages.
- App capability packages may depend on `h5-core`, `h5-commons`, appbase wrappers, generated app SDK ports, host adapter contracts, and approved shared contracts.
- Console packages may depend on `h5-console-core`, `h5-console-shell` public exports, `h5-core`, `h5-commons`, appbase wrappers, generated app SDK ports, and approved shared contracts. They `MUST NOT` depend on admin packages.
- Admin packages may depend on `h5-admin-core`, `h5-admin-shell` public exports, `h5-core`, `h5-commons`, generated backend SDK ports, and approved shared contracts. They `MUST NOT` depend on app or console packages for business behavior.
- The Capacitor package depends on host adapter contracts and renderer build outputs. It `MUST NOT` depend on capability package internals.
- Shell packages compose routes and layout. They `MUST NOT` own business services or hidden SDK clients.
- Cross-package imports `MUST` use package root exports, not `src/` deep imports.
- Cyclic dependencies are forbidden.

## 7. SDK And IAM Integration

H5 applications are SDK composition applications.

Rules:

- App and mobile console packages `MUST` use generated TypeScript app SDK clients or approved appbase app wrappers for `/app/v3/api`.
- Mobile admin packages, when approved as `backend-admin` surfaces, `MUST` use generated TypeScript backend SDK clients or approved backend wrappers for `/backend/v3/api`.
- Packages without `h5-admin` are non-admin for SDK selection. They `MUST` use generated app SDK clients or approved app SDK wrappers and `MUST NOT` import, export, construct, proxy, or route through backend SDK clients, appbase backend SDK clients, backend wrappers, backend generated SDK packages, or backend base URL resolvers.
- Runtime/bootstrap `MUST` create one global TokenManager per authenticated session context and bind it to appbase app SDK, application/dependency app SDKs, Drive app SDK, IM app SDK, and other authenticated dependency app SDKs.
- Explicit `backend-admin` H5 admin packages may receive backend SDK clients through `h5-admin-core`; those clients must not be exported through `h5-core`.
- Protected open-api clients, when used from H5 packages, `MUST` be injected with their approved open-api credential provider matching the declared auth mode. They `MUST NOT` be added to app/backend token-manager client lists.
- H5 token storage should prefer server-managed httpOnly cookie architectures when available. If browser session/local storage is used, the security risk and clearing behavior must be documented.
- Capacitor token/context storage must use secure storage host adapters where available.
- Secure storage adapters may persist appbase token/context state for the central runtime. They must not own login, refresh, permission checks, or business authorization.
- Verification-code delivery must use the generated messaging app SDK surface or an approved appbase wrapper that delegates to an injected messaging client.
- UI and services must not assemble auth headers, parse JWTs for authorization, call raw HTTP, or construct SDK clients.

## 8. Mobile Host Profiles

An H5 root is one renderer plus a registry of mobile host profiles. Profiles differ in how the renderer is loaded, which platform facts exist, and which artifact is distributed. They `MUST NOT` differ in business screens, route ids, SDK clients, IAM runtime, or permission model.

| Profile | Host package | Loads the renderer as | Platform facts source | Distinct artifact | Shipped |
| --- | --- | --- | --- | --- | --- |
| Mobile H5 browser | none (root Vite build) | mobile browser document, optionally installed as PWA | browser APIs behind typed fallbacks | Web URL or static package | Always |
| WeChat H5 browser | none (root Vite build) | WeChat in-app browser | WeChat JSSDK behind adapter | Web URL | When declared |
| Embedded WebView | none (container owned by the embedding host) | host-owned WebView | host-injected adapter | Host-owned package | When declared |
| Capacitor iOS | `sdkwork-<application-code>-h5-capacitor` | Capacitor iOS runtime (`WKWebView`) | `@capacitor/*` plugins behind adapter | `.ipa` | When declared |
| Capacitor Android | `sdkwork-<application-code>-h5-capacitor` | Capacitor Android runtime (WebView plus local asset server) | `@capacitor/*` plugins behind adapter | `.aab` / `.apk` | When declared |

Rules:

- One Capacitor host package `MUST` serve every shipped mobile platform. Per-platform subtrees inside one package is the model; two host packages split by mobile platform is forbidden.
- Shipped profiles `MUST` be declared in `sdkwork.app.config.json` (`publish.platforms`, `runtime.runtimes`) and `MUST` match the artifacts actually produced.
- Adding a mobile platform profile is configuration plus native platform subtrees inside the existing host package. It is not a new application architecture and `MUST NOT` create a second renderer, a second route tree, or a second appbase IAM runtime.
- Browser profiles `MUST` keep working with no native host present. A native-only assumption inside a shared package is a defect.

### 8.1 Browser Runtime Profiles

Rules:

- `pnpm dev` starts the default standalone H5 browser renderer/topology.
- `pnpm dev:browser:standalone` and `pnpm dev:browser:cloud` select the explicit H5 browser profile.
- WeChat-H5 and embedded-WebView modes are load-time variants of the same renderer. They inject host facts through adapters and `MUST NOT` fork routes, screens, or SDK wiring.
- Browser web mode `MUST` degrade gracefully when native host adapters are unavailable, using the fallback adapter set described in section 8.6.
- Installable PWA is the mobile H5 browser profile plus a web app manifest and a service worker. It is not a separate architecture and `MUST NOT` be recorded as a native platform.

### 8.2 Capacitor Host Profile

One Capacitor host package, one Capacitor config, one plugin bridge, and one adapter surface serve every shipped mobile platform.

Rules:

- `capacitor.config.ts` `MUST` be the single Capacitor runtime configuration. Its `appId` is a projection of the manifest identity authority described in section 2.2.
- `src/host/registry.ts` `MUST` resolve the platform-appropriate adapter implementation at runtime. Feature packages `MUST NOT` branch on the Capacitor platform string themselves.
- Capacitor builds `MUST` use the H5 mobile renderer build output. `webDir` `MUST` point at that output, and the host package `MUST NOT` build a second web bundle.
- Platform code belongs in the per-platform subtrees (`ios/`, `android/`) and the per-platform adapter or plugin files. Shared code lives in `src/` and `MUST NOT` import platform-only globals.
- The Capacitor dev commands `dev:capacitor-ios:standalone`, `dev:capacitor-ios:cloud`, `dev:capacitor-android:standalone`, and `dev:capacitor-android:cloud` select the Capacitor targets when packaging is enabled.
- An H5 root `MUST NOT` introduce a generic `sdkwork-<application-code>-h5-host` package. The only host package name for an H5 root is `sdkwork-<application-code>-h5-capacitor` (`NAMING_SPEC.md` section 3.1): a root that currently carries `-h5-host` `MUST` be renamed, and a root that ships no Capacitor platform `MUST NOT` carry an H5 host package at all. A generic `-pc-host` is equally non-canonical and `MUST NOT` stand beside a `-pc-<architecture>` desktop host.
- A root owning a single mobile host `MAY` also expose the `mobile:*` host family from `PNPM_SCRIPT_SPEC.md` section 4.1.2 (`mobile:dev`, `mobile:dev:ios`, `mobile:build:android`) as a top-level alias of the action-first `dev:capacitor-ios` / `build:capacitor-android` commands, with the same default profile (`standalone`, `development`). The action-first names remain canonical, and a root owning more than one mobile host `MUST NOT` expose the family.
- Capacitor ownership is split by client root and `MUST NOT` overlap. This standard owns the Capacitor **iOS/Android** host of an H5 root (`h5-capacitor`, `runtime_target = "capacitor-ios" | "capacitor-android"`). The Capacitor **desktop** host of a PC root (`pc-capacitor`, `clientArchitecture = "capacitor"`, `runtimeTarget = "desktop"`) is owned by `APP_PC_ARCHITECTURE_SPEC.md` and `DESKTOP_APP_ARCHITECTURE_SPEC.md`. An H5 root `MUST NOT` own the desktop Capacitor host, and a PC root `MUST NOT` own mobile Capacitor targets.

### 8.3 iOS Platform Profile

`capacitor-ios` packages the shared renderer as an installable iOS application.

| Concern | Rule |
| --- | --- |
| Identity | The bundle identifier comes from `app.identifiers.bundleId` and `MUST` agree with the `capacitor.config.ts` `appId` and the Xcode project bundle identifier. |
| Native project | `ios/App/` is source-controlled. It contains the Capacitor scaffold plus reviewed native customization; generated package-manager wiring is excluded from review. |
| Dependency manager | Swift Package Manager. `ios/App/CapApp-SPM/Package.swift` and `ios/App/debug.xcconfig` are generated on `cap sync` and `MUST NOT` be hand-edited. CocoaPods `MUST NOT` be selected for new roots and `MUST NOT` be mixed with Swift Package Manager inside one project. |
| Deployment target | iOS 15.0 is the floor for the declared Capacitor major. Raising it requires a recorded decision. |
| Toolchain | Xcode 26.0+ on macOS. iOS builds `MUST NOT` run on a non-macOS runner, and release runbooks `MUST` name the macOS runner and Xcode version. |
| Permissions | Every enabled native capability `MUST` declare its `Info.plist` usage-description key. An adapter `MUST NOT` be enabled without its usage string, and purpose strings `MUST` be localized through package i18n instead of hard-coded in one language. |
| Deep links | Universal Links through associated domains are primary. A custom URL scheme is secondary, for development and OAuth return only. |
| Push | APNs. The adapter only obtains or refreshes the device token; server-side registration stays an app-api workflow. |
| Secure storage | Keychain behind the secure-storage adapter, cleared on logout. The keychain accessibility class `MUST` be documented per stored item. |
| Signing and distribution | Certificates and provisioning profiles are machine or CI credentials and `MUST NOT` be committed. The declared distribution lane (App Store, TestFlight, or private) is recorded in the manifest. |

### 8.4 Android Platform Profile

`capacitor-android` packages the shared renderer as an installable Android application.

| Concern | Rule |
| --- | --- |
| Identity | The application id comes from `app.identifiers.packageName` and `MUST` agree with the `capacitor.config.ts` `appId` and the Gradle `applicationId`. |
| Native project | `android/` is source-controlled, including `android/variables.gradle`, `gradle/libs.versions.toml`, and the Gradle wrapper. |
| SDK floors | `minSdkVersion` 24, and `compileSdkVersion` = `targetSdkVersion` = 36 for the declared Capacitor major. Custom target SDK values are not supported: the target SDK is bound to the Capacitor major, so raising it means upgrading Capacitor. |
| Toolchain | Android Studio Otter (2025.2.1)+, Android Gradle Plugin 8.13.0, Gradle wrapper 8.14.3, Kotlin 2.2.20, and Java 21 source and target levels. |
| Permissions | Declared in `android/app/src/main/AndroidManifest.xml` together with the runtime request flow, including the rationale and permanent-denial paths. A denied permission `MUST` surface as `permission-denied`, never as a crash or an unbounded prompt loop. |
| Manifest hygiene | Exported components `MUST` be declared explicitly, cleartext traffic `MUST` be disabled in production, and secure-storage state `MUST` be excluded from backup through `dataExtractionRules`. |
| Deep links | Android App Links with `android:autoVerify` are primary. A custom URL scheme is secondary, for development and OAuth return only. |
| Push | FCM. `google-services.json` is app-specific and `MUST` be supplied by the environment or CI rather than committed when it carries project-specific keys; the platform profile references it by name. |
| Secure storage | Android Keystore behind the secure-storage adapter, cleared on logout and excluded from backup. |
| Edge-to-edge | System-bar inset handling `MUST` use the System Bars plugin. The removed `adjustMarginsForEdgeToEdge` option `MUST NOT` be reintroduced. |
| Signing and distribution | Keystore files and `keystore.properties` are credential material and `MUST NOT` be committed. Upload-key and app-signing-key ownership `MUST` be documented, `versionCode` `MUST` increase monotonically per uploaded artifact, and `versionName` `MUST` stay aligned with the manifest version. |

### 8.5 Non-Adopted Mobile Platform Profiles

Platforms outside this standard are registered here so that a root does not silently assume support.

| Platform | Status | Reason | Correct route instead |
| --- | --- | --- | --- |
| HarmonyOS / OpenHarmony through Capacitor | Not adopted | Capacitor upstream supports iOS, Android, and the web. Harmony support exists only as a community port outside the upstream platform set, so it carries no upstream compatibility or security guarantee. | Use `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md` and a native Harmony root. |
| Desktop operating systems through Capacitor | Out of scope here | Desktop packaging belongs to the PC client root, which owns the Capacitor desktop host. | `APP_PC_ARCHITECTURE_SPEC.md` and `DESKTOP_APP_ARCHITECTURE_SPEC.md` section 5.4. |
| Installable PWA | Not a platform profile | It is the mobile H5 browser profile plus a web app manifest and a service worker. | Section 8.1. |

Rules:

- Adding a platform outside the upstream Capacitor platform set `MUST` go through `GOVERNANCE_SPEC.md` as a recorded exception, `MUST` name the provider and its maintenance status, and `MUST` register its supply-chain risk before any root depends on it.
- A root `MUST NOT` claim a non-adopted platform in `publish.platforms`, build commands, or store metadata.

### 8.6 Host Adapter Contract

Rules:

- Every adapter in the section 9 catalog `MUST` have one shared TypeScript interface, one browser fallback implementation, and one implementation per shipped native platform.
- Per-platform implementations `MUST` live in the platform subtree or in the platform-specific adapter and plugin files of the host package. They `MUST NOT` fork the shared interface and `MUST NOT` be duplicated inside feature packages.
- Parity is a compile-time gate: each platform implementation `MUST` satisfy the shared adapter interface, so a missing method fails typecheck instead of failing on a device at runtime.
- Adapter errors `MUST` be the stable user-safe set: `unsupported`, `permission-denied`, `unavailable`, `cancelled`, `invalid-state`, and `timeout`.
- Feature packages depend on adapter interfaces only. They `MUST NOT` import Capacitor packages, Capacitor globals, WeChat globals, or browser globals for business workflows.
- Native host commands expose OS capability only. They `MUST NOT` own login, permission evaluation, business authorization, app-api or backend-api calls, or direct database access for feature workflows.

### 8.7 Mobile Bridge Protocol

Rules:

- The host package `MUST` expose exactly one SDKWork Capacitor plugin carrying the shared method table, with platform-specific implementations in the per-platform plugin files. Scattering capabilities across many ad-hoc plugins is forbidden.
- The plugin method table is the mobile analogue of the desktop bridge allowlist: a method absent from the table `MUST NOT` be reachable from the renderer.
- The browser fallback `MUST` register the same method table on the web platform so that a single call site works across browser, iOS, and Android.
- Platform detection belongs in the host package. Shared code `MUST NOT` read the platform string, `MUST NOT` import `@capacitor/core`, and `MUST NOT` assume a native method exists because one platform implements it.
- Mobile-local files, runtime paths, SQLite usage when approved, logs, cache, temp files, and secrets follow `RUNTIME_DIRECTORY_SPEC.md`.
- Release builds `MUST NOT` hard-code localhost service endpoints, developer directories, tokens, private keys, or signing secrets.

## 9. Host Adapter Catalog

The Capacitor package implements host adapter interfaces defined by core or capability packages. H5 browser mode supplies fallback adapters. This catalog is the mobile H5/Capacitor catalog; the PC desktop Capacitor host uses the `@sdkwork/desktop-host-contract` capability set and the bridge protocol defined by `DESKTOP_APP_ARCHITECTURE_SPEC.md` sections 5.5 and 5.6.

Standard adapters:

```text
camera
qrScanner
pushNotifications
deepLinks
secureStorage
biometric
shareSheet
networkStatus
appLifecycle
clipboard
filePicker
filesystemSandbox
geolocation
deviceInfo
haptics
contactsPicker
paymentHost
browserOpen
```

Rules:

- Feature packages depend on adapter interfaces, not Capacitor globals, browser globals, WeChat globals, or plugin imports.
- The H5 runtime must provide fallback adapters for unsupported native capabilities.
- Adapter errors must be stable and user-safe: `unsupported`, `permission-denied`, `unavailable`, `cancelled`, `invalid-state`, and `timeout`.
- Push token registration with the backend is an app-api workflow. The host adapter only obtains or refreshes the platform token.
- File upload and media storage use Drive app SDK or approved Drive uploader facades. Host adapters may select files or capture media but must not create upload sessions, presign URLs, object keys, or provider SDK flows.
- Deep links must validate expected scheme, host, path, state, nonce, expiry, tenant/app context, and unsafe-link rejection before completing sensitive flows.
- Payment host adapters may launch platform payment flows, but order creation, payment intent creation, callback verification, and settlement state remain backend-owned.

## 10. Mobile Interaction Rules

Rules:

- H5 UI is phone-first, touch-first, safe-area-aware, and usable at common phone widths before tablet or desktop widths are considered.
- Navigation should use mobile stack, tab, sheet, modal, and drawer patterns rather than dense desktop tables or hover-only workflows.
- Lists must cover loading, empty, error, retry, pagination or bounded infinite loading, and pull-to-refresh behavior when appropriate.
- Forms must use mobile-friendly input types, validation messages, keyboard avoidance, duplicate-submit protection, and safe background/foreground recovery.
- OAuth, QR login, password reset, verification-code, push permission, payment, and deep-link flows must survive background/foreground transitions where the host supports them.
- Text must fit compact containers without viewport-scaled font hacks or overlap.
- Touch targets must be reachable and have stable dimensions. Bottom navigation, sheets, and sticky actions must respect safe areas and virtual keyboard behavior.
- Offline behavior is allowed for view/cache state by default. Mutating offline queues require explicit service design, conflict handling, idempotency keys, and tests.
- H5 pages must not rely on hover-only controls, desktop-only keyboard shortcuts, desktop pointer precision, or wide tables as the only interaction path.

## 11. Route And Navigation Standards

Rules:

- App routes belong to `h5-shell` and app capability route contributions.
- Console routes belong to `h5-console-shell` and `h5-console-*` route contributions.
- Admin routes belong to `h5-admin-shell` and approved `h5-admin-*` route contributions.
- Route metadata may declare title, icon, route id, required permission hint, layout group, mobile presentation, and lazy import. It `MUST NOT` declare API path constants.
- App, console, and admin route prefixes `SHOULD` be distinct when they coexist in one root, for example `/app`, `/console`, and `/admin`.
- Physical mobile paths may be shorter than PC paths, but route ids `MUST` align through `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.
- Deep links resolve to route ids first, then navigation adapters map the route id to stack/tab/modal/sheet presentation.

## 12. Config And Manifest

Rules:

- `runtime.family` in `sdkwork.app.config.json` should be `mobile` for H5/Capacitor applications.
- `runtime.framework` should be `react-capacitor` when Capacitor targets exist and `react-h5` or a more specific value when H5-only.
- `runtime.runtimes` should declare actual runtime families such as `WEB`, `CAPACITOR_IOS`, and `CAPACITOR_ANDROID` when represented by the manifest schema.
- Each shipped Capacitor platform `MUST` declare `clientArchitecture = "capacitor"` on its `artifacts.installConfig.packages[]` entry together with the matching `runtimeTarget` (`capacitor-ios` or `capacitor-android`), resolving to the single `sdkwork-<application-code>-h5-capacitor` host package under the client-root-scoped rule of `APP_MANIFEST_SPEC.md`. An H5 root `MUST NOT` declare a `runtimeTarget = "desktop"` entry; desktop Capacitor belongs to the PC root.
- `publish.platforms` should include actual supported platforms such as `H5`, `H5_WEIXIN`, `APP_IOS`, and `APP_ANDROID`.
- `artifacts.installConfig.packages[]` must describe H5 URL packages, App Store/TestFlight or IPA entries, Google Play/private store or APK/AAB entries, and release package ids.
- `app.identifiers.bundleId` owns iOS bundle identity. `app.identifiers.packageName` owns Android application id.
- Production manifests must declare governed icons, screenshots, previews, checksums, signing metadata, SBOM/provenance references, and release notes according to `APP_MANIFEST_SPEC.md`.
- Store screenshots must show the actual mobile app, not desktop screenshots or marketing-only banners.
- `app.identifiers.packageName` is the Android application id authority and `app.identifiers.bundleId` is the iOS bundle identity authority. A shipped platform `MUST` project them into `capacitor.config.ts` `appId`, the Xcode bundle identifier, and the Gradle `applicationId` without divergence.
- A shipped platform `MUST` declare its platform profile, and an unshipped platform `MUST NOT` appear in `publish.platforms`, in `artifacts.installConfig.packages[]`, or in store metadata.
- Per-platform store metadata `MUST` be declared separately: iOS privacy declarations and screenshot sets differ from Google Play data-safety and content-rating declarations. One platform's metadata `MUST NOT` be reused for the other.
- Platform SDK and toolchain floors declared by the manifest `MUST` match the section 2.2 platform contract for the declared Capacitor major.

## 13. Standard Commands

Every H5 application root should provide these command equivalents:

```text
pnpm install
pnpm dev
pnpm dev:standalone
pnpm dev:cloud
pnpm dev:browser:standalone
pnpm dev:browser:cloud
pnpm build:browser
pnpm build:browser:staging
pnpm build:browser:prod
pnpm preview:browser
pnpm build
pnpm build:staging
pnpm build:prod
pnpm typecheck
pnpm lint
pnpm test
pnpm test:config
```

Capacitor-enabled roots should also provide:

```text
pnpm build:capacitor-ios
pnpm build:capacitor-ios:prod
pnpm build:capacitor-android
pnpm build:capacitor-android:prod
pnpm dev:capacitor-ios:standalone
pnpm dev:capacitor-ios:cloud
pnpm dev:capacitor-android:standalone
pnpm dev:capacitor-android:cloud
pnpm check:capacitor-config
pnpm check:capacitor-config:ios
pnpm check:capacitor-config:android
```

Package filters should be stable:

```text
pnpm --filter @sdkwork/<application-code>-h5-core typecheck
pnpm --filter @sdkwork/<application-code>-h5-orders test
pnpm --filter @sdkwork/<application-code>-h5-console-settings test
pnpm --filter @sdkwork/<application-code>-h5-capacitor cap:sync
```

Rules:

- Internal package dependencies `MUST` use `workspace:*`.
- Root commands should run recursively or through a deterministic task runner when package count grows.
- `pnpm dev` delegates to `dev:standalone` and starts the H5 mobile renderer
  plus the standalone topology selected by the root dispatcher.
- Cloud variants start only the renderer/host/simulator and resolve the
  deployed application and platform API surface URLs; they start no local
  gateway or data service and do not identify the remote gateway
  implementation.
- Capacitor synchronization/copy/open commands remain internal runner details
  behind action-first public commands and use the same renderer output.
- Per-platform build and config-check variants `MUST` exist for every shipped platform and `MUST NOT` exist for an unshipped one. A platform with build commands but no config checker, or the reverse, is a defect.
- `check:capacitor-config` `MUST` validate the shared Capacitor config, every shipped platform profile, identity agreement across the manifest, `capacitor.config.ts`, Xcode, and Gradle, and the absence of secrets. The per-platform variants `MUST` add that platform's native project and profile checks.
- Platform build commands `MUST` fail fast when the platform toolchain floor is unmet — Xcode version, `compileSdkVersion` or `targetSdkVersion`, or Java level — instead of producing an unbuildable native project.
- Production browser and Capacitor builds must run release preflight for
  public runtime config, host config, manifest, media, signing references,
  package metadata, and secret absence.
- H5 browser output is a Web artifact even on iOS/Android browsers. Only an
  approved native host such as Capacitor produces IPA/APK/AAB artifacts.
- Package commands remain the canonical development interface. `bin/` scripts may call package commands but must not become a second build system.

## 14. Standard Ownership

Rules:

- New standards, application roots, component specs, tests, and runbooks `MUST` cite `APP_H5_ARCHITECTURE_SPEC.md`.
- H5 architecture rules `MUST NOT` be duplicated into another root standard file.
- Existing H5 roots should update local documentation and tests to reference `APP_H5_ARCHITECTURE_SPEC.md` when they next touch H5 architecture, package taxonomy, SDK/IAM wiring, host adapters, config, or release behavior.
- During migration from older local wording, do not move H5 app, console, admin, and host behavior into one catch-all package to reduce rename work.
- Migration tests `SHOULD` prove public exports, route ids, SDK dependencies, host adapters, and permission prefixes remain compatible.

## 15. Verification

Required verification for H5 application architecture changes:

| Verification | Evidence |
| --- | --- |
| Root layout | Static check proves the root path uses `apps/sdkwork-<application-code>-h5/` and `.sdkwork/`, `config/browser`, `config/host`, `src/bootstrap`, `packages/`, `sdks/`, `scripts/`, and tests exist for application roots. |
| Package naming | Static check proves new packages use `sdkwork-<application-code>-h5-*`, including reserved console/admin/host forms. |
| Host package naming | `node <sdkwork-specs>/tools/check-client-host-packages.mjs --root .` proves the H5 root carries at most the single `sdkwork-<application-code>-h5-capacitor` host package, that no generic `-h5-host` exists, and that the host package carries the manifest of the H5 root ecosystem, which is `package.json` (`NAMING_SPEC.md` section 3.1). |
| Renderer sharing | Tests or static checks prove H5, WebView, iOS, and Android targets reuse the same renderer, route contributions, SDK clients, IAM runtime, and TokenManager. |
| Surface split | Static scan proves app, console, and admin packages do not deep import each other or share hidden route/service internals. |
| SDK boundary | Static scan proves app/console packages use app SDKs, approved `backend-admin` packages use backend SDKs, protected open-api uses declared open-api credential provider, and no raw HTTP/manual auth headers/generated SDK edits were introduced. |
| SDK export boundary | Static scan proves `h5-core` exports app SDK/appbase app SDK wrappers and no backend SDK wrappers, while backend SDK/appbase backend SDK wrappers are exported only from `h5-admin-core` or another approved `backend-admin` boundary. |
| IAM clearing | Tests prove logout, refresh failure, tenant switch, and account switch clear browser storage, secure storage, token manager, context store, caches, realtime/session bridges, and sensitive state. |
| Host boundary | Static scan proves feature packages do not import Capacitor plugins, WeChat globals, browser globals, or platform globals directly for business workflows. |
| Deep link security | Tests prove scheme, host, path, state, nonce, expiry, context binding, and unsafe-link rejection behavior. |
| Push lifecycle | Tests cover permission denied, token registration, token refresh, logout unregister/clear, and foreground/background handling. |
| Config boundary | Tests prove browser public runtime config and host/platform config contain no secrets and load before SDK construction. |
| Release preflight | Checks validate H5 URL, IPA/App Store metadata, APK/AAB/Google Play metadata, icons, screenshots, checksums, SBOM/provenance, and signing references. |
| Platform profile coverage | Static check proves every shipped platform has its native subtree, platform profile, permission declaration, adapter implementations, and build command, and that no unshipped platform has any of them. |
| Platform identity agreement | Static check proves `app.identifiers.bundleId` and `app.identifiers.packageName` agree with the `capacitor.config.ts` `appId`, the Xcode bundle identifier, and the Gradle `applicationId`. |
| Platform adapter parity | Typecheck proves each platform adapter implementation satisfies the shared adapter interface, and tests prove a browser fallback exists for every adapter in the section 9 catalog. |
| Platform toolchain and SDK floors | Static check proves the iOS deployment target and the Android `minSdkVersion`, `compileSdkVersion`, and `targetSdkVersion` match the section 2.2 contract for the declared Capacitor major. |
| Generated-output discipline | Static check proves `ios/App/CapApp-SPM/Package.swift` and `ios/App/debug.xcconfig` were not hand-edited, and that no keystore, provisioning profile, certificate, or `google-services.json` carrying project keys is committed. |
| Package build | Changed packages pass typecheck, tests, and build or smoke commands. |

Acceptance checklist:

- [ ] H5 application root uses `apps/sdkwork-<application-code>-h5/` and follows the standard root layout or has a documented exception.
- [ ] H5 is the baseline runtime and Capacitor is a host/release shape.
- [ ] H5, WebView, and Capacitor targets share one mobile renderer and one SDK/IAM runtime model.
- [ ] Root `src/` remains thin.
- [ ] Packages use the `h5` segment and split core, commons, shell, capability, optional console/admin, and Capacitor host responsibilities.
- [ ] App/console/admin routes, SDK clients, permissions, i18n, and tests are separated.
- [ ] `h5-core` exports the application-owned app SDK and appbase app SDK wrappers needed by the frontend app, and does not export backend SDK wrappers.
- [ ] Backend SDK and appbase backend SDK wrappers are available only from `h5-admin-core` or an equivalent `backend-admin` boundary.
- [ ] Route ids align with `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.
- [ ] SDK clients and appbase IAM runtime are created in bootstrap/core and injected.
- [ ] Native capabilities use typed host adapters with H5 fallbacks.
- [ ] Browser public runtime config, host platform config, server config, and container config are separated and secret-free.
- [ ] Every shipped mobile platform has its own native subtree, platform profile, permission declaration, adapter implementations, and build command inside the one Capacitor host package.
- [ ] No platform-split Capacitor host package exists, and no unshipped platform has build commands, a config checker, or manifest publish entries.
- [ ] Platform identity agrees across `sdkwork.app.config.json`, `capacitor.config.ts`, Xcode, and Gradle.
- [ ] iOS uses Swift Package Manager with no CocoaPods project and no mixed package-manager setup.
- [ ] Test profile isolates database/schema, Redis key prefix, logs, cache, runtime, and temp directories.
- [ ] Appbase IAM runtime and one global TokenManager are wired by bootstrap/core.
- [ ] Release metadata, screenshots, checksums, signing references, SBOM/provenance, and package artifacts are validated.
- [ ] Verification evidence is recorded in the application PR or change note.
