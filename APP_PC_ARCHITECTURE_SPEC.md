# PC Application Architecture Standard

- Version: 1.0
- Scope: SDKWork PC application roots that support PC browser web, desktop, and large-screen tablet native packaging, including app modules, user-facing console modules, internal admin modules, shared renderer packages, Tauri/native host packages, and iPadOS/Android tablet runtime/package targets
- Related: `SDKWORK_WORKSPACE_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `APPLICATION_SPEC.md`, `NAMING_SPEC.md`, `APP_MANIFEST_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `DESKTOP_APP_ARCHITECTURE_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `BACKEND_UI_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines the application-root architecture for SDKWork PC applications. A PC application is one application root that can run as a browser web application and, when required, as a desktop or large-screen tablet native application through a host such as Tauri.

This file is the PC application root standard. `APP_PC_REACT_UI_SPEC.md` remains the detailed React UI package standard, and `DESKTOP_APP_ARCHITECTURE_SPEC.md` remains the detailed desktop/Tauri host standard. New SDKWork application architecture standards for H5, Flutter, WeChat Mini Program, iOS, Android, and HarmonyOS should keep a similar root layout, package taxonomy, SDK boundary, appbase IAM boundary, and app/console/admin separation.

Reference inputs:

- `apps/docs/ARCHITECT.md` defines the pnpm workspace, thin root `src/`, `packages/`, and service-layer split pattern.
- `apps/sdkwork-im/apps/sdkwork-chat-pc` demonstrates a PC app root with renderer bootstrap, app packages, console/admin package families, and desktop package placement.
- `apps/sdkwork-cloudrouter/apps/sdkwork-cloudrouter-pc` demonstrates app, console, and admin capability decomposition at scale. Its packages without a `pc` segment are migration references; new PC packages use the normalized naming in this standard.
- Tauri v2 official docs define mobile development commands, platform-specific config merging, iOS signing, Android/iOS build outputs, and mobile multi-window behavior. SDKWork PC tablet packaging uses those capabilities only as a large-screen PC runtime/package target.

## 1. Core Model

A PC application root composes packages. It does not become the place where business behavior accumulates.

```text
PC application root
  -> root src bootstrap, providers, route assembly, layout entry
  -> package families under packages/
  -> injected generated SDK clients and appbase IAM runtime
  -> app-api, backend-api, protected open-api, local runtime APIs
  -> optional Tauri/native host package for desktop and tablet targets
```

Rules:

- One PC application root `MUST` support browser web mode. If desktop, iPadOS, or Android tablet native mode is required, it `MUST` reuse the same renderer and packages where possible.
- PC version means large-screen, productivity-oriented application behavior. It includes PC browsers, Windows/macOS/Linux desktop shells, and tablet-native packages such as iPadOS and Android tablets when the app keeps the same large-screen workflow model. Phone-first H5 remains a separate architecture standard.
- Root `src/` `MUST` stay thin: bootstrap, providers, global layout, router assembly, AuthGate wiring, environment selection, and package registration.
- Business pages, services, route contributions, i18n, domain state, and workflow-specific components `MUST` live in packages.
- Generated SDK clients `MUST` be constructed in bootstrap/core code and injected into services or providers.
- UI packages `MUST NOT` construct raw HTTP calls, manual auth headers, manual API key headers, or generated SDK clients for business flows.
- Appbase IAM login, registration, session, refresh, logout, current user, runtime metadata, and token propagation `MUST` follow `APP_SDK_INTEGRATION_SPEC.md` and `IAM_LOGIN_INTEGRATION_SPEC.md`.

## 2. Standard Root Layout

Every new PC application root `MUST` use the directory name `apps/sdkwork-<application-code>-pc/`
and start from this layout unless an exception is recorded through
`GOVERNANCE_SPEC.md`. The root directory name carries the SDKWork namespace,
product identity, and PC architecture segment together; new roots `MUST NOT`
use the shorter `apps/<application-code>-pc/` form.

```text
apps/sdkwork-<application-code>-pc/
  .sdkwork/
    README.md
    skills/
      README.md
    plugins/
      README.md
  bin/
    windows/
    linux/
    macos/
  etc/
    README.md
    sdkwork.deployment.config.json
  .env.<deployment-profile>.<environment>
  config/
    browser/
      runtime-env.<deployment-profile>.<environment>.example.json
    desktop/
      <application-code>.<deployment-profile>.<environment>.toml.example
    server/
      <application-code>.<deployment-profile>.<environment>.toml.example
    container/
      <application-code>.<deployment-profile>.<environment>.toml.example
    tauri/
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
      iamRuntime.ts
      runtime.ts
      routes.ts
      sdkClients.ts
  packages/
    sdkwork-<application-code>-pc-core/
    sdkwork-<application-code>-pc-commons/
    sdkwork-<application-code>-pc-shell/
    sdkwork-<application-code>-pc-<capability>/
    sdkwork-<application-code>-pc-console-core/
    sdkwork-<application-code>-pc-console-shell/
    sdkwork-<application-code>-pc-console-<capability>/
    sdkwork-<application-code>-pc-admin-core/
    sdkwork-<application-code>-pc-admin-shell/
    sdkwork-<application-code>-pc-admin-<capability>/
    sdkwork-<application-code>-pc-desktop/
      src-tauri/
        tauri.conf.json
        tauri.windows.conf.json
        tauri.macos.conf.json
        tauri.linux.conf.json
        tauri.ios.conf.json
        tauri.android.conf.json
        gen/
          apple/
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

- `.sdkwork/` is required by `SDKWORK_WORKSPACE_SPEC.md` for repository/application skills and plugins. It is not generated SDK output and is not user runtime state.
- `bin/` contains cross-platform operational scripts for runnable application roots, including server start, stop, restart, status, diagnostics, and desktop launch helpers when applicable.
- `config/` contains checked-in non-secret config templates grouped by runtime target. Host-local overrides are excluded from source control.
- `docs/` contains app architecture notes, runbooks, release notes, and local decisions.
- `public/` contains browser-served static assets only.
- `scripts/` contains build, validation, generation, migration, and development utilities.
- `sdks/` contains application-root SDK workspaces and generator inputs according to `SDK_WORKSPACE_GENERATION_SPEC.md`.
- `specs/` contains local component/application specs that extend, but do not contradict, this canonical specs directory.
- `src/` is the root shell entry and composition boundary only.
- `packages/` contains all reusable runtime, shell, app, console, admin, and native host packages.
- `tests/` contains application-level integration, runtime, route, package-boundary, and architecture verification tests.

## 2.0 Tailwind CSS Shell Entry

PC application roots that use Tailwind CSS v4 `MUST` follow `TAILWIND_CSS_INTEGRATION_SPEC.md`.

Rules:

- `src/index.css` is the single Tailwind bootstrap entry for the runnable PC app graph.
- Host applications register integrated sibling repositories through `@source` directives in `src/index.css`.
- Feature packages under `packages/` `MUST NOT` `@import "tailwindcss"` in CSS imported by the host shell.
- `vite.config.ts` `MUST` register `@tailwindcss/vite` and `MUST NOT` alias bare specifier `tailwindcss`.

### 2.0.1 Workspace Package Resolution

Package imports `MUST` resolve through pnpm workspace linking and package
`exports` maps. `vite.config.ts` is the Vite process configuration, not a
dependency-resolution authority; it `MUST NOT` restate the workspace dependency
graph and `MUST NOT` grow alias entries that package resolution already
provides.

Rules:

- `vite.config.ts` and `vitest.config.ts` `MUST NOT` declare `resolve.alias`
  entries for package specifiers — scoped (`@sdkwork/*`), unscoped
  (`sdkwork-drive-pc-core`, `lucide-react`, `react`, `i18next`), bare, or
  subpath forms such as `@sdkwork/utils/money`. Every alias entry that maps a
  package name to a directory or file is a resolution remap that workspace
  linking must provide instead.
- Package imports `MUST` resolve through `node_modules` workspace symlinks
  created by `pnpm install` from `pnpm-workspace.yaml`, and through the owning
  package's `exports` map. Missing links are fixed by completing
  `pnpm-workspace.yaml` and the importing package's declared dependencies, then
  running `pnpm install` — never by consumer aliases.
- Workspace packages consumed as source `MUST` expose their concrete source
  entry through `exports` (for example `"./src/index.ts"`); consumers `MUST NOT`
  map them to `src/index.ts` with aliases.
- Subpath imports such as `@sdkwork/<package>/<segment>` `MUST` be declared in
  the owning package's `exports` map; consumers `MUST NOT` alias the segment.
- Hook-bearing dependency deduplication (`react`, `react-dom`,
  `react-i18next`, `i18next`) `MUST` use `resolve.dedupe` only; `MUST NOT`
  declare `resolve.alias` entries for those packages.
- Project-internal path aliases (for example `"@"` → the application source
  root) remain allowed only when they map directory paths, never package
  specifiers.
- `tailwindcss` integration follows section 2.0: register
  `@tailwindcss/vite`; `MUST NOT` alias bare specifier `tailwindcss`.
- Verification `MUST` run
  `node ../sdkwork-specs/tools/check-vite-workspace-aliases.mjs --root .` and
  pass before a PC application root is considered compliant.

## 2.1 Configuration And Environment Matrix

PC application roots must keep lifecycle environment, deployment profile, build
mode, and runtime target separate.

| Concern | Standard values | Owner |
| --- | --- | --- |
| Lifecycle environment | `development`, `test`, `staging`, `production` | `CONFIG_SPEC.md` typed runtime config |
| Profile alias | `dev`, `test`, `staging`, `prod` | legacy command/operator compatibility only |
| Build mode | Vite/Tauri/Spring/build-tool mode | build scripts and tool config |
| Deployment profile | `standalone`, `cloud` | runtime/bootstrap |
| Runtime target | `browser`, `desktop`, `tablet-ipados`, `tablet-android`, `server`, `container`, `test-runner` | runtime/bootstrap |

Standard config ownership:

| Config family | Example files | Owns | Must not own |
| --- | --- | --- | --- |
| Vite/browser build env | `.env.<deployment-profile>.<environment>` | public `VITE_*` profile identity, SDK base URLs, public flags | secrets, tokens, database/Redis config, host packaging metadata |
| Browser deploy-time runtime | `config/browser/runtime-env.<deployment-profile>.<environment>.example.json`, `/runtime-env.js` | promotable public SDK base URLs, public feature flags, public app metadata | secrets, database URLs, Redis URLs, tokens, private service endpoints |

The browser runtime source matrix is one file per supported
`<deployment-profile>.<environment>` combination (all eight when both
`standalone` and `cloud` ship all four lifecycle environments) using the
canonical `runtime-env.<deployment-profile>.<environment>.json` name — never
environment-only or profile-only names. Value rules per profile follow
`ENVIRONMENT_SPEC.md` §5.1.0.1: `standalone` sources use the same-origin root
`/` for every SDK base URL; `cloud` sources use the unified `cloudApiBaseUrl`
origin for the environment (`api-dev.<domain>` … `api.<domain>`).
| Desktop user runtime | `config/desktop/<application-code>.<deployment-profile>.<environment>.toml.example`, user `~/.sdkwork/<application-code>/config/<application-code>.toml` | installed desktop mode, local service toggle, declared client-local user-private SQLite path, secure storage provider | server PostgreSQL defaults for dev services, API route constants, signing secrets |
| Server runtime | `config/server/<application-code>.<deployment-profile>.<environment>.toml.example`, `/etc/sdkwork/<application-code>/<process>.toml` | bind address, PostgreSQL, Redis, reverse proxy trust, service paths | browser-only `VITE_*`, Tauri packaging metadata |
| Container runtime | `config/container/<application-code>.<deployment-profile>.<environment>.toml.example`, mounted `/etc/sdkwork/...` | container service config, mounted secrets, external services, volumes | image-baked secrets or mutable database state |
| Tauri platform | `src-tauri/tauri.*.conf.json`, optional `config/tauri/` templates | bundle id, package id, icons, permissions, capabilities, window metadata, signing references | business API contracts, SDK ownership, auth tokens, private keys |

Rules:

- PC roots `MUST` provide safe example config for every runtime target they support. `development`, `test`, `staging`, and `production` examples are required for server/container targets; browser and desktop targets should provide the same set unless the target is explicitly dev-only.
- PC Vite renderers `MUST` use `.env.<deploymentProfile>.<environment>` and
  `vite --mode <deploymentProfile>.<environment>` as defined by
  `ENVIRONMENT_SPEC.md` section 5.1. Root `.env.*` files are materialized from
  `etc/`; they are not a second source authority.
- The env content `MUST` expose matching `VITE_SDKWORK_ENVIRONMENT`,
  `VITE_SDKWORK_DEPLOYMENT_PROFILE`, `VITE_SDKWORK_PROFILE_ID`, and
  `VITE_SDKWORK_RUNTIME_TARGET=browser` before renderer SDK construction.
- `dev` and `prod` are command/operator aliases only. Env file names and
  runtime config use canonical environment and profile-id values.
- `.env.local`, `.env.<profile>.local`, `.env.postgres`, `.env.release.local`, and `config/*.local.toml` must be ignored.
- `pnpm dev` starts the browser renderer with browser public runtime config.
- `pnpm dev:server` starts the backend service with the selected
  `config/server/<application-code>.<deployment-profile>.development.toml.example`
  copied or materialized into a host-local dev config.
- `pnpm test` uses an isolated test profile and must not share development or production database/schema, Redis prefix, logs, cache, runtime, or temp directories.
- `pnpm dev:desktop` starts the desktop host through the standard development
  orchestration profile. It defaults to PostgreSQL, standalone, and
  development, even when the desktop process itself remains client-only and
  connects to an externally supervised application standalone gateway.
  Installed desktop config remains the desktop profile with
  declared client-local user-private SQLite by default. Tauri remains an internal runner detail;
  public pnpm commands follow `PNPM_SCRIPT_SPEC.md` action-first runtime target
  names.
- PC roots that support cloud `MUST` expose browser and desktop cloud variants.
  They start only local renderer/desktop-host processes and consume the
  deployed application and platform API surface URLs; no local standalone
  gateway, API, or data process is started, and client config does not identify
  the remote gateway implementation.
- Desktop/browser packages may declare runtime-configurable support for both
  profiles. One active profile is selected at bootstrap and profile/origin
  switches isolate credentials, cache, offline state, and local data.
- Browser SDK base URLs must be loaded from public runtime config before SDK client construction. Vite `VITE_*` variables are public non-secret build/dev inputs only.
- Release builds must fail preflight if production profiles contain localhost service endpoints, development secrets, test database names, writable developer directories, or unresolved placeholders.

## 2.2 Platform Deployment Matrix

PC applications share one renderer and one package taxonomy across large-screen targets.

| Target | Standard mode | Host/package | Required behavior |
| --- | --- | --- | --- |
| PC browser web | `web` | root Vite/browser build | Full app/console/admin route composition, no native host dependency, graceful host-adapter fallback |
| Windows desktop | `desktop-windows` | `sdkwork-<application-code>-pc-desktop` (Tauri) or `sdkwork-<application-code>-pc-electron` (Electron) | Native desktop bundle, WebView2 (Tauri) / Chromium (Electron) runtime boundary, Windows scripts in `bin/windows/` |
| macOS desktop | `desktop-macos` | `sdkwork-<application-code>-pc-desktop` (Tauri) or `sdkwork-<application-code>-pc-electron` (Electron) | Native desktop bundle, signed/notarized release when distributed outside development |
| Linux desktop | `desktop-linux` | `sdkwork-<application-code>-pc-desktop` (Tauri) or `sdkwork-<application-code>-pc-electron` (Electron) | Native desktop bundle, distro/runtime dependency documentation |
| iPadOS native tablet | `tablet-ipados` | `sdkwork-<application-code>-pc-desktop` Tauri iOS target | Same PC renderer, adaptive tablet layout, iPad split/multi-window awareness, Apple signing and IPA workflow |
| Android tablet native | `tablet-android` | `sdkwork-<application-code>-pc-desktop` Tauri Android target | Same PC renderer, adaptive tablet layout, Android large-screen/windowing behavior, APK/AAB workflow |

Rules:

- The PC renderer `MUST` be the source of truth for web, desktop, iPadOS, and Android tablet targets.
- Desktop native hosts (Tauri and Electron) `MUST` follow `DESKTOP_APP_ARCHITECTURE_SPEC.md`: both consume the same renderer output and the same host adapter contract and bridge protocol, and feature packages `MUST NOT` reference host globals (`window.__TAURI__`, `window.electron`) directly.
- Tablet native packaging `MUST NOT` create phone-first H5 pages, mobile-only business services, or a separate auth/runtime model inside the PC root.
- iPadOS and Android tablet targets `MUST` use adaptive large-screen UI patterns: navigation rail/sidebar, split panes, tabs, drawers, resizable detail panels, keyboard shortcuts where available, touch/stylus support, and safe-area handling.
- iPadOS and Android tablet targets `MUST` keep app, console, and admin route ownership identical to web/desktop mode unless a local component spec documents a platform-specific route exclusion.
- Tauri platform-specific config files such as `tauri.windows.conf.json`, `tauri.macos.conf.json`, `tauri.linux.conf.json`, `tauri.ios.conf.json`, and `tauri.android.conf.json` may override target-specific packaging, identifiers, bundle metadata, permissions, and capabilities. They `MUST NOT` override business API contracts or SDK package ownership.
- iOS/iPadOS development and build commands require a macOS host with Apple tooling. Android tablet builds require Android tooling. These prerequisites belong in the app runbook and CI/release documentation.

## 2.3 Required Application Capabilities

A complete PC application standard covers more than pages and package names.

| Capability | Owner package or layer | Required standard |
| --- | --- | --- |
| Runtime/bootstrap | root `src/bootstrap/`, `pc-core` | Environment, SDK clients, appbase IAM runtime, global TokenManager, host adapters |
| App shell | `pc-shell` | App route assembly, layout, navigation, app AuthGate, user workspace entry |
| User console shell | `pc-console-shell` | User-facing management console navigation, route assembly, console permission hints |
| Internal admin shell | `pc-admin-shell` | Internal staff navigation, backend route guards, audit-sensitive layout |
| App domain features | `pc-<capability>` | User-facing pages, services, hooks, i18n, app SDK orchestration |
| Console domain features | `pc-console-<capability>` | Customer/tenant/app-owner management workflows, app SDK orchestration |
| Admin domain features | `pc-admin-<capability>` | Internal operations, moderation, platform administration, backend SDK orchestration |
| SDK workspace | `sdks/`, `pc-core/src/sdk/` | Generated SDK family declaration, dependency SDK composition, no generated output edits |
| IAM/session | appbase packages and `pc-core` | Login, registration, refresh, logout, current session, TokenManager propagation |
| Permissions | surface shells and services | Frontend hints only; app-api/backend-api remains authoritative |
| Drive/media/files | domain packages plus generated Drive SDKs | File picker, upload/download grants, Drive-backed media contracts |
| Realtime/notifications | appbase/product service packages | Websocket/SSE/realtime clients, host notification adapters, logout clearing |
| Search/commands | `pc-commons`, shell packages | Command palette, global search, keyboard and pointer workflows |
| Settings/profile/workspace | app or console packages | User settings, tenant/workspace selection, account preferences |
| Accessibility and input | `pc-commons`, shell packages | Keyboard navigation, focus management, screen-reader labels, high contrast, reduced motion, pointer/touch/stylus parity |
| Responsive large-screen layout | shell and surface packages | Desktop, browser, iPad, Android tablet split panes, resizable panels, density settings, safe areas |
| Offline and resilience | `pc-core`, domain services | Local cache policy, retry, reconnect, optimistic state boundaries, offline-safe messaging where approved |
| Background jobs | `pc-core`, desktop host, server profile | Upload/download queue, sync queue, cancellation, pause/resume, foreground/background behavior |
| Deep links and routing handoff | shell packages, desktop host | URL scheme handling, route hydration, tenant/workspace context restore, unsafe-link rejection |
| Update and release channels | `pc-desktop`, `scripts/`, `bin/` | Web asset version, desktop updater, tablet release channel, rollback notes, staged rollout |
| Diagnostics and support | `pc-core`, desktop host, admin/console packages | Safe diagnostics bundle, log export, health checks, support context without secrets |
| Local/native host capability | `pc-desktop` and `pc-core/src/host/` | Window/tray, deep links, clipboard, file dialogs, updater, local service lifecycle |
| Tablet packaging | `pc-desktop/src-tauri/` | iPadOS/Android tablet config, safe areas, split/multi-window behavior, signing/build workflow |
| Observability | bootstrap, services, host package | Logs, traces, diagnostics, user-safe error reporting, no secret logging |
| Release/update | `pc-desktop`, `bin/`, `scripts/` | Web build, desktop bundles, IPA/APK/AAB where enabled, versioning, signing, runbooks |

Rules:

- A PC application is incomplete if it defines pages but omits SDK/IAM bootstrap, route ownership, package verification, runtime config, release commands, or platform packaging rules.
- Every capability `MUST` have an owner package or owner layer. Shared capabilities `MUST` use public exports and service ports; they `MUST NOT` use deep imports or copied runtime singletons.
- Capability implementation order should start from runtime/bootstrap, SDK/IAM, shell routing, then domain packages, then platform packaging. Platform packaging must not force a redesign of SDK or auth boundaries.

## 3. Package Taxonomy

PC package directory names `MUST` include the application code and the `pc` surface segment.

| Package family | Naming | Surface | Owns | Must not own |
| --- | --- | --- | --- | --- |
| Core runtime | `sdkwork-<application-code>-pc-core` | shared PC runtime | SDK client factories, TokenManager binding, appbase IAM runtime, session store, environment, host adapter contracts | product pages, domain workflows, admin business logic |
| Commons | `sdkwork-<application-code>-pc-commons` | shared PC UI/runtime | domain-neutral components, hooks, utilities, design-system adapters, i18n helpers | business pages, business services, route ownership |
| App shell | `sdkwork-<application-code>-pc-shell` | app/user shell | user-facing layout, navigation, app route composition, app AuthGate integration | console/admin routes, backend SDK calls, business services |
| App capability | `sdkwork-<application-code>-pc-<capability>` | app/user | user-facing pages, components, services, hooks, route metadata, i18n | console/admin pages, backend-only operations, concrete SDK construction |
| Console core | `sdkwork-<application-code>-pc-console-core` | user console runtime | console SDK providers, console permission hints, console session/runtime helpers | app shell, admin SDK resources, internal staff features |
| Console shell | `sdkwork-<application-code>-pc-console-shell` | user console shell | user-facing management console layout, menus, console route composition | app pages, internal admin pages, backend-only operation center |
| Console capability | `sdkwork-<application-code>-pc-console-<capability>` | user console | customer/tenant/app-owner management pages, console services, console route metadata | internal company admin behavior, backend-only moderation/ops workflows |
| Admin core | `sdkwork-<application-code>-pc-admin-core` | `backend-admin` runtime | backend SDK provider, admin permission/audit helpers, admin route guards, operator context | user login UI, app-api session creation, customer console workflows |
| Admin shell | `sdkwork-<application-code>-pc-admin-shell` | `backend-admin` shell | internal management layout, admin menus, admin route composition | app user navigation, user console navigation, business data transport |
| Admin capability | `sdkwork-<application-code>-pc-admin-<capability>` | `backend-admin` | internal staff operation pages, backend services, permissions, audit-facing workflows | app-api user workflows, user console workflows, raw HTTP bypasses |
| Native host | `sdkwork-<application-code>-pc-desktop` | desktop and tablet native host | Tauri config, native commands, permissions, capabilities, icons, desktop bundles, iPadOS IPA workflow, Android tablet APK/AAB workflow | business authorization, app/domain services, generated SDK edits |

Rules:

- A package named `sdkwork-<application-code>-pc-<capability>` without `pc-console` or `pc-admin` is an app/user package by default.
- `console` means user-facing management console for customers, tenants, app owners, or app users who manage their own resources.
- `admin` means the PC package maps to the `backend-admin` surface: company-internal staff management backend for operations, moderation, platform administration, support, audit, and internal control. `pc-console` packages are not `backend-admin`.
- New PC packages `MUST NOT` use `sdkwork-<application-code>-console-*` or `sdkwork-<application-code>-admin-*` without the `pc` segment.
- Existing packages without the `pc` segment are migration references only. New work should either create the normalized `sdkwork-<application-code>-pc-console-*` or `sdkwork-<application-code>-pc-admin-*` package, or record a migration exception.
- `core`, `commons`, and `shell` package names are reserved for infrastructure. They `MUST NOT` own business pages or business services.
- Capability names `MUST` be lower kebab-case and should match a domain or business capability from `DOMAIN_SPEC.md`.

Examples:

```text
sdkwork-shop-pc-merchandise
sdkwork-shop-pc-cart
sdkwork-shop-pc-orders
sdkwork-shop-pc-console-settings
sdkwork-shop-pc-console-settlements
sdkwork-shop-pc-admin-monitor
sdkwork-shop-pc-admin-inventory
sdkwork-shop-pc-desktop
```

### 3.1 Forbidden Anti-Patterns

The following directory and npm package names are **forbidden for new PC application work**. They usually mean the surface role (`app`, `console`, or `admin`) was omitted or placed after a legacy `-pc-react` suffix.

| Anti-pattern | Why it is wrong | Correct replacement |
| --- | --- | --- |
| `sdkwork-<application-code>-<capability>-pc-react` inside `apps/sdkwork-<application-code>-pc/packages/` | Uses legacy appbase shared-library suffix instead of application-root surface naming | App: `sdkwork-<application-code>-pc-<capability>` |
| `sdkwork-<domain>-<capability>-pc-react` inside any application root | Domain token replaces application code and hides the surface role | App: `sdkwork-<application-code>-pc-<capability>` in the owning domain repository under `apps/sdkwork-<domain>-pc/packages/` |
| `@sdkwork/<domain>-<capability>-pc-react` for tenant/org/oauth admin UI | npm name encodes `-pc-react` instead of `pc-admin` surface | `@sdkwork/<application-code>-pc-admin-<capability>` (example: `@sdkwork/iam-pc-admin-oauth`) |
| `sdkwork-<application-code>-admin-<capability>` or `sdkwork-<application-code>-console-<capability>` without `pc` | Missing architecture segment; cannot distinguish PC from H5/Flutter/mobile admin families | `sdkwork-<application-code>-pc-admin-<capability>` or `sdkwork-<application-code>-pc-console-<capability>` |
| Putting `backend-admin` operator pages in app packages (`sdkwork-<application-code>-pc-<capability>`) or user console packages (`pc-console-*`) | Wrong API/SDK surface and permission model | `sdkwork-<application-code>-pc-admin-<capability>` |
| Putting customer/tenant self-service management in `pc-admin-*` | `pc-admin` is company-internal `backend-admin`, not user console | `sdkwork-<application-code>-pc-console-<capability>` |

Decision table:

| Users | API/SDK | Directory pattern | npm pattern (example app code `iam`) |
| --- | --- | --- | --- |
| End users / app users | app-api / app SDK | `sdkwork-iam-pc-<capability>` | `@sdkwork/iam-pc-<capability>` |
| Customers / tenant owners / app owners (self-service management) | app-api / app SDK | `sdkwork-iam-pc-console-<capability>` | `@sdkwork/iam-pc-console-<capability>` |
| Internal staff / operators / auditors | backend-api / backend SDK | `sdkwork-iam-pc-admin-<capability>` | `@sdkwork/iam-pc-admin-<capability>` |

Rules:

- When a capability is operator-only (tenant administration, platform OAuth config, internal audit), it `MUST` use `pc-admin-*`, not `pc-*` or `*-pc-react`.
- When a capability lets customers manage their own resources, it `MUST` use `pc-console-*`, not `pc-admin-*`.
- Legacy `sdkwork-<foundation>-pc-react` names under appbase `packages/pc-react/` remain valid **only** for cross-application foundation libraries (`shell`, `workspace`, `command`, auth runtime). They `MUST NOT` be copied into application roots for domain admin or console modules.
- Static verification `SHOULD` reject new directories matching `sdkwork-*-pc-react` under `apps/sdkwork-<application-code>-pc/packages/` except documented migration exceptions.

## 4. App, Console, And Admin Surface Rules

The three PC surfaces share the same root and renderer stack, but they have different users, API surfaces, SDK clients, routes, and permission models.

| Surface | Package pattern | Typical users | API/SDK boundary | Route ownership |
| --- | --- | --- | --- | --- |
| App | `sdkwork-<application-code>-pc-<capability>` | end users and app users | app-api through generated app SDKs; protected open-api only through injected approved clients | app shell |
| Console | `sdkwork-<application-code>-pc-console-<capability>` | customers, tenant owners, app owners, business users managing their own resources | app-api through generated app SDKs or approved console-facing app SDK wrappers; protected open-api only through injected approved clients | console shell |
| Admin | `sdkwork-<application-code>-pc-admin-<capability>` | internal company staff, operators, support, auditors | backend-api through generated backend SDKs; appbase backend SDK for IAM administration | admin shell |

Rules:

- App packages `MUST NOT` import console or admin package internals.
- Console packages `MUST NOT` import admin package internals or use backend-only operations unless an explicit backend-for-console contract is approved.
- Admin packages `MUST NOT` import app/user pages, user console pages, or app-api login/session resources.
- Shared visual primitives belong in `pc-commons`. Shared SDK/session/runtime logic belongs in `pc-core`. Shared surface-specific runtime logic belongs in `pc-console-core` or `pc-admin-core`.
- Cross-surface workflows `MUST` be composed through public package exports, SDK service ports, or generated SDK clients. They `MUST NOT` share route constants, hidden globals, or deep `src/` imports.
- Console and admin modules can coexist in one PC application root only when route prefixes, navigation, permissions, telemetry, and SDK clients are separated.

## 5. Package Internal Shape

Capability packages should use a consistent internal shape.

```text
packages/sdkwork-<application-code>-pc-<surface-or-capability>/
  package.json
  README.md
  src/
    index.ts
    pages/
    components/
    hooks/
    services/
    state/
    i18n/
    types/
    routes/
  tests/
  specs/
```

Rules:

- `src/index.ts` is the only public export boundary.
- `pages/` owns route-level composition.
- `components/` owns rendering units and receives data through props or hooks.
- `hooks/` owns React binding around service and state behavior.
- `services/` owns SDK orchestration, validation mapping, error normalization, and business workflow coordination.
- `state/` owns view/cache state only. API invariants remain on the backend.
- `i18n/` owns surface-appropriate package-local locale fragments and thin aggregation exports. User-facing app/console copy and internal admin copy `MUST NOT` be conflated, and authored whole-root locale monoliths are forbidden by `I18N_SPEC.md`.
- `types/` owns local view models only. API DTOs come from generated SDKs or shared contract packages.
- `routes/` owns route metadata contributed to the owning shell. It does not own raw URL constants for API calls.
- `specs/` follows `COMPONENT_SPEC.md` for authored packages.

Core package shape:

```text
packages/sdkwork-<application-code>-pc-core/
  src/
    index.ts
    composition/
      dependency-manifest.ts
      sdk-inventory.ts
      module-registry.ts
      host-registry.ts
      index.ts
    config/
    host/
    runtime/
    sdk/
    session/
```

Native host package shape:

```text
packages/sdkwork-<application-code>-pc-desktop/
  package.json
  src/
    host/
  src-tauri/
    tauri.conf.json
    tauri.windows.conf.json
    tauri.macos.conf.json
    tauri.linux.conf.json
    tauri.ios.conf.json
    tauri.android.conf.json
    src/
    permissions/
    capabilities/
    icons/
    gen/
      apple/
      android/
```

## 6. Dependency Direction

Allowed dependency flow:

```text
pc-core, pc-commons
  -> pc-shell, pc-console-core, pc-admin-core
  -> pc-console-shell, pc-admin-shell
  -> app/console/admin capability packages
  -> root src composition
  -> optional pc-desktop host
```

Rules:

- `pc-core` and `pc-commons` `MUST NOT` depend on business capability packages.
- App capability packages may depend on `pc-core`, `pc-commons`, appbase wrappers, generated app SDK ports, and approved shared contracts.
- Console packages may depend on `pc-console-core`, `pc-console-shell` public exports, `pc-core`, `pc-commons`, appbase wrappers, generated app SDK ports, and approved shared contracts. They `MUST NOT` depend on admin packages.
- Admin packages may depend on `pc-admin-core`, `pc-admin-shell` public exports, `pc-core`, `pc-commons`, generated backend SDK ports, and approved shared contracts. They `MUST NOT` depend on app or console packages for business behavior.
- `pc-core` SDK exports `MUST` include the application-owned app SDK and dependency app SDK wrappers needed by the app renderer, including appbase app SDK wrappers for appbase IAM, current user, workspace, contacts, address book, and user-visible IAM directory read/list/tree resources. `pc-core` `MUST NOT` export application-owned backend SDK wrappers, appbase backend SDK wrappers, backend base URL resolvers, or backend generated SDK clients.
- `pc-admin-core` or an equivalent `backend-admin` SDK subpath owns backend SDK and appbase backend SDK wrapper exports. App and console packages may not import that `backend-admin` SDK subpath.
- Shell packages compose routes and layout. They `MUST NOT` own business services or hidden SDK clients.
- Native host packages may depend on renderer build outputs and host adapter contracts. They `MUST NOT` directly depend on app, console, or admin business packages for workflow logic.
- Cyclic dependencies are forbidden.
- Cross-package imports `MUST` use package root exports, not `src/` deep imports.

### 6.1 Dependency Capability Embed Packages

Domain repositories that ship PC UI into host applications (for example IM, workspace, or portal shells) `MUST` publish embed packages from `apps/sdkwork-<domain>-pc/packages/sdkwork-<domain>-pc-<capability>/`, not from repository-root `packages/pc-react/**`.

Normative embed contract (Drive, Knowledgebase, Voice, and future dependency capabilities):

```text
apps/sdkwork-<domain>-pc/packages/sdkwork-<domain>-pc-<capability>/
  src/index.ts                      public export boundary
  src/<Capability>View.tsx          route-level embed surface
  src/runtime.ts                    configure<Domain>PcRuntime({ sdkPorts })
  src/sdkPorts.ts                   host-injected SDK/session/language ports
  src/services/                     SDK orchestration only; no raw HTTP
```

Rules:

- The embed package `MUST` export exactly one primary view (for example `DriveView`, `KnowledgeView`, `VoiceMarketView`) and `configure<Domain>PcRuntime`.
- Host applications `MUST` inject session, SDK clients, and language ports through `sdkPorts`; embed packages `MUST NOT` read host-local env, `localStorage`, or IM-specific session globals directly.
- Host shell integration `MUST` lazy-load the embed package through `capabilityModuleLoaders` (or equivalent shell registry), not through feature packages such as `im-pc-chat`.
- Host `*-pc-core` integration modules (for example `drivePcIntegration.ts`, `voicePcIntegration.ts`) `MUST` map host session snapshots into domain `sdkPorts` and call `configure<Domain>PcRuntime` before rendering the embed view.
- Legacy repository-root `packages/pc-react/<domain>/` and npm names ending in `-pc-react` for domain capability UI are migration-only. New domain capability UI `MUST` land under `apps/sdkwork-<domain>-pc/packages/sdkwork-<domain>-pc-<capability>/`.

## 7. SDK And IAM Integration

PC applications are SDK composition applications.

Rules:

- App and console packages `MUST` use generated TypeScript app SDK clients or approved appbase app wrappers for `/app/v3/api`.
- Admin packages are `backend-admin` packages and `MUST` use generated TypeScript backend SDK clients or approved backend wrappers for `/backend/v3/api`.
- Packages without `pc-admin` are non-admin for SDK selection. They `MUST` use generated app SDK clients or approved app SDK wrappers and `MUST NOT` import, export, construct, proxy, or route through backend SDK clients, appbase backend SDK clients, backend wrappers, backend generated SDK packages, or backend base URL resolvers.
- App and console packages that implement contacts, address books, organization trees, department trees, memberships, assignments, positions, or role-binding read views `MUST` use appbase app SDK resources or an approved app SDK wrapper. They `MUST NOT` use appbase backend SDK or application-owned backend SDK for those user-visible directory workflows.
- Admin packages may use appbase backend SDK for `backend-admin` IAM management and application-owned backend SDK for operator resources. That permission does not extend to `pc-core`, app packages, or user-facing console packages.
- Protected open-api clients, when used from PC packages, `MUST` be injected with their approved open-api credential provider matching the declared auth mode. They `MUST NOT` be added to app/backend token-manager client lists.
- Runtime/bootstrap `MUST` create one global TokenManager per authenticated session context and bind it to appbase app SDK clients, downstream authenticated app-api SDK clients, and explicit `backend-admin` backend-api SDK clients.
- Appbase IAM runtime owns login, registration, current session, refresh, logout, OAuth, QR auth, password reset, runtime metadata, and current-user self-service. Verification-code delivery and verification are messaging-owned app-api capabilities and must be injected through the generated messaging app SDK surface when auth flows need them.
- Application packages `MUST NOT` copy appbase IAM APIs, regenerate appbase-owned contracts, or create local auth/session SDK ports when the appbase resource exists.
- `backend-admin` IAM management uses appbase backend SDK resources where applicable. Backend SDKs `MUST NOT` expose or consume user-facing `auth.sessions.create`, registration, refresh, or login-session creation resources.
- App auth runtime for the user-facing PC renderer `MUST` construct appbase app SDK and downstream app SDK clients only. It `MUST NOT` construct backend SDK clients just because admin packages are present in the same PC root.
- Services receive SDK clients or narrow SDK ports through dependency injection. UI components call services or hooks, not SDK clients directly, when reusable behavior exists.

## 8. Web, Desktop, And Tablet Native Runtime

PC browser, desktop, and tablet native modes share the renderer.

Rules:

- `pnpm dev` should start the default PC browser renderer for the application root.
- `pnpm dev:desktop` should start the default desktop host when `sdkwork-<application-code>-pc-desktop` exists.
- `pnpm dev:tablet-ipados` should start the iOS/iPadOS Tauri development target when tablet packaging is enabled.
- `pnpm dev:tablet-android` should start the Android tablet Tauri development target when tablet packaging is enabled.
- Tauri `devUrl` `MUST` point to the renderer dev server, and `frontendDist` `MUST` point to the renderer build output.
- Mobile/tablet Tauri development `MUST` configure the renderer dev server for `TAURI_DEV_HOST` when required by physical iOS/iPadOS devices.
- Browser web mode `MUST` degrade gracefully when native host adapters are unavailable.
- Native host commands expose OS capability only. They `MUST NOT` own login, permission evaluation, business authorization, app-api/backend-api calls, or direct database access for feature workflows.
- Desktop-local and tablet-local files, runtime paths, SQLite usage, logs, cache, temp files, and secrets follow `RUNTIME_DIRECTORY_SPEC.md` and `DESKTOP_APP_ARCHITECTURE_SPEC.md`.
- Release builds `MUST NOT` hard-code localhost service endpoints, developer directories, tokens, or private keys.

## 8.1 Tablet And iPadOS Runtime And Package Profile

Tablet packaging is a PC large-screen runtime/package target, not a deployment
profile and not a replacement for H5 or phone-native architectures.

Rules:

- iPadOS and Android tablet targets `MUST` use the same React renderer, route metadata, SDK clients, appbase IAM runtime, and global TokenManager as web/desktop mode.
- Tablet targets `MUST` define target-specific Tauri config, bundle identifier/application id, icons, permissions, capabilities, signing inputs, and release output expectations.
- iPadOS packaging `MUST` document Apple Developer account/team, provisioning profile, signing certificate, bundle id, minimum supported OS version, entitlements, and IPA/TestFlight/App Store or private distribution path.
- Android tablet packaging `MUST` document Android package name, min/target SDK, signing key handling, ABI targets, APK/AAB output, Play/private distribution path, and large-screen manifest behavior.
- iPadOS builds `MUST` be performed on macOS hosts. CI may orchestrate the build, but the signing/build runner must satisfy Apple tooling requirements.
- Tablet targets `MUST` handle safe areas, virtual keyboard, orientation, pointer/keyboard input, touch/stylus input, split view or multi-window where supported, and offline/foreground/background lifecycle events.
- Tablet targets `MUST NOT` store tokens, refresh tokens, signing secrets, or API keys in generated platform directories or committed native config.

## 9. Route And Navigation Standards

Rules:

- App routes belong to `pc-shell` and app capability route contributions.
- Console routes belong to `pc-console-shell` and `pc-console-*` route contributions.
- Admin routes belong to `pc-admin-shell` and `pc-admin-*` route contributions.
- Route metadata may declare title, icon, route id, required permission hint, layout group, and lazy import. It `MUST NOT` declare API path constants.
- App, console, and admin route prefixes `SHOULD` be distinct in the browser router when they coexist in one root, for example `/app`, `/console`, and `/admin`.
- Admin route guards `MUST` enforce internal staff/operator permissions and audit-sensitive transitions.
- Console route guards `MUST` enforce customer/tenant/app-owner permissions and must not grant internal staff permissions by route naming alone.

## 10. Standard Commands

Every PC application root should provide these command equivalents:

```text
pnpm install
pnpm dev
pnpm dev:server
pnpm dev:desktop
pnpm build
pnpm build:staging
pnpm build:prod
pnpm typecheck
pnpm test
pnpm test:config
pnpm lint
```

Desktop-enabled roots should also provide:

```text
pnpm dev:desktop
pnpm build:desktop
pnpm build:desktop:prod
```

Tablet-enabled roots should also provide:

```text
pnpm dev:tablet-ipados
pnpm build:tablet-ipados
pnpm build:tablet-ipados:prod
pnpm dev:tablet-android
pnpm build:tablet-android
pnpm build:tablet-android:prod
```

Package filters should be stable:

```text
pnpm --filter @sdkwork/<application-code>-pc-core typecheck
pnpm --filter @sdkwork/<application-code>-pc-console-settings test
pnpm --filter @sdkwork/<application-code>-pc-admin-monitor test
pnpm --filter @sdkwork/<application-code>-pc-desktop build:desktop
pnpm --filter @sdkwork/<application-code>-pc-desktop build:tablet-ipados
pnpm --filter @sdkwork/<application-code>-pc-desktop build:tablet-android
```

Rules:

- Internal package dependencies `MUST` use `workspace:*`.
- Root commands should run recursively or through a deterministic task runner when package count grows.
- `bin/` scripts may call package commands, but package commands remain the canonical development interface.
- `pnpm dev` should bind the browser renderer to the development browser profile.
- `pnpm dev:server` should bind the backend/server process to the development server profile.
- `pnpm build:staging` and `pnpm build:prod` must run config preflight for browser public runtime, server/container runtime templates, desktop runtime templates, and Tauri platform config before packaging.
- `pnpm test:config` must validate dev/test/staging/prod profile normalization, public/private separation, desktop/server separation, and test isolation.
- Tablet package scripts use action-first runtime target names such as `dev:tablet-ipados`, `build:tablet-ipados`, `dev:tablet-android`, and `build:tablet-android`. They `MUST` call the corresponding Tauri CLI commands such as `tauri ios dev`, `tauri ios build`, `tauri android dev`, and `tauri android build`.
- Tablet release scripts `MUST` record output artifacts: IPA for iPadOS/iOS targets and APK/AAB for Android tablet targets.

## 11. Migration Notes

Reference applications may contain packages such as:

```text
sdkwork-cloudrouter-console-settings
sdkwork-cloudrouter-admin-monitor
sdkwork-clawchat-console-core
sdkwork-clawchat-admin-dashboard
```

These are valid historical references for package decomposition, but they are not the target naming style for new PC application work.

Rules:

- New PC application packages `MUST` include the `pc` segment.
- Existing packages may be migrated incrementally by adding normalized package names and compatibility exports.
- During migration, do not move app, console, and admin behavior into one catch-all package to reduce rename work.
- Migration tests `SHOULD` prove public exports, route ids, SDK dependencies, and permission prefixes remain compatible.

## 12. Verification

Required verification for PC application architecture changes:

| Verification | Evidence |
| --- | --- |
| Root layout | Static check proves the root path uses `apps/sdkwork-<application-code>-pc/` and `.sdkwork/`, `src/`, `packages/`, `sdks/`, `scripts/`, and required metadata exist for application roots. |
| Package naming | Static check proves new packages use `sdkwork-<application-code>-pc-*`, `sdkwork-<application-code>-pc-console-*`, or `sdkwork-<application-code>-pc-admin-*`. |
| Surface split | Static scan proves app, console, and admin packages do not deep import each other or share hidden route/service internals. |
| SDK boundary | Static scan proves app/console use app SDKs, `backend-admin` packages use backend SDKs, protected open-api uses declared open-api credential provider, and no raw HTTP/manual auth headers were introduced. |
| SDK export boundary | Static scan proves `pc-core` exports app SDK/appbase app SDK wrappers and no backend SDK wrappers, while backend SDK/appbase backend SDK wrappers are exported only from `pc-admin-core` or another `backend-admin` boundary. |
| IAM boundary | Tests prove appbase IAM runtime, global TokenManager, logout clearing, session restore, and route guards behave across app, console, and admin surfaces. |
| Config profile boundary | Static and runtime tests prove `development/test/staging/production`, profile aliases, deployment profile, build mode, and runtime target are separated; browser, desktop, server, container, and Tauri platform config files do not leak into each other. |
| Environment file hygiene | Static scan proves checked-in files are safe examples only and ignored host-local files include `.env.local`, `.env.<profile>.local`, `.env.postgres`, `.env.release.local`, and `config/*.local.toml`. |
| Root thinness | Static scan or code review proves root `src/` owns bootstrap/composition only, not business services or mock data. |
| Desktop and tablet parity | When native targets exist, Tauri config, platform config files, host adapters, web fallback, renderer reuse, iPadOS packaging, and Android tablet packaging pass `DESKTOP_APP_ARCHITECTURE_SPEC.md`. |
| Package build | Changed packages pass typecheck, tests, and build or smoke commands. |

Acceptance checklist:

- [ ] PC application root uses `apps/sdkwork-<application-code>-pc/` and follows the standard root layout or has a documented exception.
- [ ] New package names include the `pc` segment.
- [ ] Packages without `pc-console` or `pc-admin` are treated as user-facing app packages.
- [ ] Console packages are user-facing management console packages, not internal admin packages.
- [ ] Admin packages are `backend-admin` internal company/staff backend packages, not user app packages.
- [ ] App/console/admin routes, SDK clients, permissions, i18n, and tests are separated.
- [ ] `pc-core` exports the application-owned app SDK and appbase app SDK wrappers needed by the frontend app, and does not export backend SDK wrappers.
- [ ] Backend SDK and appbase backend SDK wrappers are available only from `pc-admin-core` or an equivalent `backend-admin` boundary.
- [ ] Root `src/` remains thin.
- [ ] Browser public runtime config, desktop user config, server config, container config, and Tauri platform config are separated and validated for dev/test/staging/prod.
- [ ] Test profile isolates database/schema, Redis key prefix, logs, cache, runtime, and temp directories.
- [ ] Appbase IAM runtime and one global TokenManager are wired by bootstrap/core.
- [ ] Desktop and tablet native modes, when present, reuse the PC renderer and keep native host code local-only.
- [ ] iPadOS and Android tablet packaging rules are documented and verified when tablet native targets are enabled.
- [ ] Verification evidence is recorded in the application PR or change note.
