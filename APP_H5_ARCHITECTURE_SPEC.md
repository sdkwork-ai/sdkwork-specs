# H5 Application Architecture Standard

- Version: 1.0
- Scope: SDKWork phone-first H5 application roots, mobile browser applications, WeChat-H5 style browser runtimes, embedded WebView mobile runtimes, and Capacitor iOS/Android apps that reuse the same H5 renderer
- Related: `SDKWORK_WORKSPACE_SPEC.md`, `APPLICATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `NAMING_SPEC.md`, `APP_MANIFEST_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `TEST_SPEC.md`

This standard defines the application-root architecture for SDKWork H5 applications. H5 is the canonical phone-first mobile web runtime. Capacitor is an optional native host and release shape for iOS and Android, not a separate application architecture. H5 browser mode, WeChat-H5 mode, embedded WebView mode, and Capacitor iOS/Android mode reuse one mobile renderer, one route contribution model, one generated TypeScript app SDK composition layer, one appbase IAM runtime, and one package taxonomy.

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
      capacitor.development.example.json
      capacitor.test.example.json
      capacitor.staging.example.json
      capacitor.production.example.json
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
      capacitor.config.ts
      src/
        host/
        plugins/
      ios/
      android/
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

The browser runtime source matrix is one file per supported
`<deployment-profile>.<environment>` combination (all ten when both
`standalone` and `cloud` ship all five lifecycle environments) using the
canonical `runtime-env.<deployment-profile>.<environment>.json` name — never
environment-only or profile-only names. Value rules per profile follow
`ENVIRONMENT_SPEC.md` §5.1.0.1: `standalone` sources use the same-origin root
`/` for every SDK base URL; `cloud` sources use the unified `cloudApiBaseUrl`
origin for the environment (`api-dev.<domain>` … `api-demo.<domain>` … `api.<domain>`).
| Host platform runtime | `config/host/capacitor.<environment>.example.json`, `capacitor.config.ts`, platform config references | bundle id/package id references, schemes, app links, associated domains, permissions, plugin flags, store metadata references | signing private keys, API keys, auth tokens, business API paths, SDK ownership |
| Server runtime | `config/server/<application-code>.<deployment-profile>.<environment>.toml.example`, `/etc/sdkwork/<application-code>/<process>.toml` | bind address, API gateway, PostgreSQL, Redis, reverse proxy trust, service paths when the app owns server runtime | browser-only `VITE_*`, Capacitor packaging metadata |
| Container runtime | `config/container/<application-code>.<deployment-profile>.<environment>.toml.example`, mounted `/etc/sdkwork/...` | container service config, mounted secrets, external service endpoints, volumes | image-baked secrets or mutable database state |

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

Rules:

- The H5 renderer `MUST` be the source of truth for H5 browser, WeChat-H5, embedded WebView, and Capacitor targets.
- Capacitor targets `MUST NOT` introduce app-only business screens, app-only SDK wrappers, copied auth stores, divergent route ownership, or a second appbase IAM runtime.
- Host-specific bridges may expose platform facts and local capabilities only. Business workflows still call generated SDK clients through services.
- H5 public runtime config must load before SDK clients are constructed.
- H5 browser fallback adapters must represent unavailable native capability with stable user-safe errors.
- iOS builds require macOS and Apple tooling. Android builds require Android SDK/JDK/Gradle tooling. CI and release runbooks must document runner requirements.

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
| Realtime/notifications | appbase/product service packages plus host adapters | Websocket/SSE/realtime clients, push adapter, logout clearing |
| Deep links | shell packages, host package | Route id hydration, OAuth/QR/password-reset callbacks, state/nonce validation |
| Secure storage | `h5-core`, `h5-capacitor` | Browser fallback and native secure-storage adapter, logout clearing |
| Mobile resilience | `h5-core`, domain services | Network status, retry/reconnect, background/foreground behavior, safe offline cache |
| Diagnostics and support | `h5-core`, host package | Safe diagnostics bundle, user-safe error reports, no secret logging |
| Release channels | `scripts/`, `h5-capacitor`, app manifest | H5 asset release, IPA/APK/AAB metadata, rollback notes, staged rollout |

Rules:

- An H5 application is incomplete if it defines screens but omits SDK/IAM bootstrap, route ownership, host adapter boundaries, runtime config, release commands, or architecture verification.
- Every capability `MUST` have an owner package or owner layer. Shared capabilities `MUST` use public exports and service ports; they `MUST NOT` use deep imports or copied runtime singletons.
- Capability implementation order should start from runtime/bootstrap, SDK/IAM, shell routing, then domain packages, then host packaging. Host packaging must not force a redesign of SDK or auth boundaries.

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
| Capacitor host | `sdkwork-<application-code>-h5-capacitor` | native host | Capacitor config, plugins, permissions, iOS/Android package metadata, typed host implementations | business API calls, business authorization, SDK generation |

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

Capacitor host package shape:

```text
packages/sdkwork-<application-code>-h5-capacitor/
  package.json
  capacitor.config.ts
  src/
    host/
    plugins/
  ios/
  android/
```

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

## 8. H5, WebView, And Capacitor Runtime

Rules:

- `pnpm dev` starts the default standalone H5 browser renderer/topology.
- `pnpm dev:browser:standalone` and `pnpm dev:browser:cloud` select the
  explicit H5 browser profile.
- `pnpm dev:capacitor-ios:standalone`, `pnpm dev:capacitor-ios:cloud`,
  `pnpm dev:capacitor-android:standalone`, and
  `pnpm dev:capacitor-android:cloud` select Capacitor targets when packaging is
  enabled.
- Capacitor builds `MUST` use the H5 mobile renderer build output.
- Browser web mode `MUST` degrade gracefully when native host adapters are unavailable.
- Native host commands expose OS capability only. They `MUST NOT` own login, permission evaluation, business authorization, app-api/backend-api calls, or direct database access for feature workflows.
- Mobile-local files, runtime paths, SQLite usage when approved, logs, cache, temp files, and secrets follow `RUNTIME_DIRECTORY_SPEC.md`.
- Release builds `MUST NOT` hard-code localhost service endpoints, developer directories, tokens, private keys, or signing secrets.

## 9. Host Adapter Catalog

The Capacitor package implements host adapter interfaces defined by core or capability packages. H5 browser mode supplies fallback adapters.

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
- `publish.platforms` should include actual supported platforms such as `H5`, `H5_WEIXIN`, `APP_IOS`, and `APP_ANDROID`.
- `artifacts.installConfig.packages[]` must describe H5 URL packages, App Store/TestFlight or IPA entries, Google Play/private store or APK/AAB entries, and release package ids.
- `app.identifiers.bundleId` owns iOS bundle identity. `app.identifiers.packageName` owns Android application id.
- Production manifests must declare governed icons, screenshots, previews, checksums, signing metadata, SBOM/provenance references, and release notes according to `APP_MANIFEST_SPEC.md`.
- Store screenshots must show the actual mobile app, not desktop screenshots or marketing-only banners.

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
- [ ] Test profile isolates database/schema, Redis key prefix, logs, cache, runtime, and temp directories.
- [ ] Appbase IAM runtime and one global TokenManager are wired by bootstrap/core.
- [ ] Release metadata, screenshots, checksums, signing references, SBOM/provenance, and package artifacts are validated.
- [ ] Verification evidence is recorded in the application PR or change note.
