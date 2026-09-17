# Desktop App Architecture Standard

- Version: 1.1
- Scope: PC desktop and large-screen tablet native applications, especially Tauri-, Electron-, and Capacitor-hosted web apps, desktop shells, iPadOS/Android tablet targets, native host adapters, local runtime integration, packaging, and release boundaries
- Related: `APPLICATION_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `FRONTEND_SPEC.md`, `SDK_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `DEPLOYMENT_SPEC.md`, `SECURITY_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines the architecture boundary for SDKWork desktop and large-screen tablet native applications. It is intentionally product-neutral. It applies to Tauri, Electron, and Capacitor native shells, browser-installed desktop shells, tablet-native targets, and native wrappers that host a web UI.

SDKWork PC roots support three desktop host profiles, all sharing one host-agnostic renderer. Each host profile owns exactly one host package:

| Host profile | `clientArchitecture` | Host package | Default |
| --- | --- | --- | --- |
| Tauri host | `"tauri"` | `sdkwork-<application-code>-pc-tauri` | Yes |
| Electron host | `"electron"` | `sdkwork-<application-code>-pc-electron` | Explicit selection |
| Capacitor host | `"capacitor"` | `sdkwork-<application-code>-pc-capacitor` | Explicit selection |

Host package names are architecture-explicit: the package segment names the native architecture, never a generic `desktop` token. The retired `sdkwork-<application-code>-pc-desktop` name is a migration-only alias for the Tauri host package; new packages `MUST NOT` use it.

Every host `MUST` consume the same host-agnostic renderer, the same host adapter contract (section 5.5), and the same bridge protocol (section 5.6) so feature code never branches on the host identity. Host profiles are registered in section 5.

Desktop apps are app composition layers. They should be thin, predictable, and reusable across products. Product-specific UI and business behavior belong in app PC UI packages and service packages. Native host code belongs behind explicit host adapters and commands.

Desktop SDK composition, appbase IAM runtime wiring, dependency SDK usage, and global TokenManager behavior follow `APP_SDK_INTEGRATION_SPEC.md`.

For SDKWork PC applications, `APP_PC_ARCHITECTURE_SPEC.md` is the parent application-root standard. This file is the desktop/tablet native host detail standard for the `sdkwork-<application-code>-pc-tauri` (Tauri host), `sdkwork-<application-code>-pc-electron` (Electron host), and `sdkwork-<application-code>-pc-capacitor` (Capacitor host) packages and related native packaging behavior, including Windows, macOS, Linux, iPadOS, and Android tablet targets.

Capacitor ownership is split by client root, never shared: this standard and `APP_PC_ARCHITECTURE_SPEC.md` own the Capacitor **desktop** host of a PC root (`clientArchitecture = "capacitor"`, `runtimeTarget = "desktop"`), while `APP_H5_ARCHITECTURE_SPEC.md` owns the Capacitor **iOS/Android** host of an H5 root (`clientArchitecture = "capacitor"`, `runtimeTarget = "capacitor-ios" | "capacitor-android"`). A PC root `MUST NOT` own mobile Capacitor targets, and an H5 root `MUST NOT` own the desktop Capacitor host.

## 1. Reference Architecture

Standard desktop architecture:

```text
desktop/tablet native app shell
  -> route/layout/providers/bootstrap
  -> UI packages
  -> service/facade layer
  -> generated SDK clients or approved wrappers
  -> app/backend/local APIs
  -> optional native host adapters
```

Rules:

- Desktop apps `MUST` separate web UI, service orchestration, SDK transport, native host capabilities, and local runtime concerns.
- The app shell `MUST` stay thin: route composition, layout, providers, SDK bootstrap, session bootstrap, environment selection, and host adapter registration.
- Application features `MUST` live in domain or capability packages, not in native host commands.
- Remote business traffic `MUST` use generated SDK clients or approved wrappers.
- Native host commands `MUST` expose local device or operating-system capability only. They must not become app business services.

## 2. Layer Responsibilities

| Layer | Owns | Must not own |
| --- | --- | --- |
| Desktop/tablet app shell | routing, layout, providers, SDK bootstrap, session bootstrap, environment mode, host adapter binding | reusable feature workflows, generated SDK internals, database access |
| UI packages | pages, components, hooks, view state, route-level interaction | raw HTTP, manual auth headers, Tauri command strings scattered across feature code |
| Service/facade packages | SDK orchestration, validation mapping, domain-friendly methods, cache invalidation | UI rendering, native window/file/process control, hidden global transport |
| Generated SDK clients | typed transport, auth token plumbing, request/response models | product UI behavior, native host behavior |
| Native host adapter | typed wrappers for window, tray, filesystem, process, notifications, deep links, clipboard, updater | remote business authorization, app-domain workflows, direct database access |
| Local runtime | embedded or local HTTP/RPC service, local-only API bridge, runtime files, user-private state | UI composition, package-local feature shortcuts |
| Tablet platform target | iPadOS/Android packaging config, safe-area/platform lifecycle adapters, signing metadata, large-screen behavior | phone-first H5 behavior, separate auth model, business SDK bypasses |

Rules:

- UI calls services or hooks. Services call SDK clients.
- UI may call host adapters for local-only UX capability, but feature components `SHOULD NOT` import raw Tauri APIs directly.
- Host adapters `MUST` be small and typed. They may translate between UI-friendly methods and native commands.
- Local runtime APIs `MUST` follow the same contract and SDK boundary rules as remote APIs when they expose business behavior.

## 3. Desktop, Tablet, And Server Runtime Boundary

Desktop applications have two different persistence concerns:

| Concern | Standard database | Owner |
| --- | --- | --- |
| Desktop local user data | SQLite | Native runtime, installed package, host-local user config |
| Tablet local user data | SQLite or approved platform-local encrypted storage | Native runtime, installed package, platform app-private storage |
| Explicit service/backend runtime started by desktop development commands | PostgreSQL | Server/runtime service profile |

Rules:

- Installed desktop applications `MUST` store declared desktop client-local data in SQLite
  under the SDKWork user private data directory unless the user explicitly
  configures an external database.
- Installed tablet native applications `MUST` store tablet-local user data in
  SQLite or an approved encrypted platform-local storage adapter under the
  platform app-private directory. They `MUST NOT` write user state into generated
  native project directories.
- Desktop development commands that start the product service runtime
  `MUST` use the server PostgreSQL development profile for the service/backend
  process. Applications whose default desktop development commands are
  API-surface-backed client commands, such as SDKWork Cloud Router `pnpm dev:desktop`,
  must keep product server startup on explicit server commands.
- The desktop shell must not infer that the service database is SQLite just
  because the runtime target is `desktop`. The deployment profile remains
  `standalone` or `cloud`; the launched service profile describes backend
  persistence.
- SQLite development entrypoints are allowed only as explicit client-local
  validation profiles such as `pnpm dev:desktop:sqlite`. New
  `dev:server:sqlite` entrypoints are forbidden; existing aliases are L0
  migration inputs and cannot satisfy service/runtime PostgreSQL gates.
- Feature UI and host adapters `MUST NOT` access either SQLite or PostgreSQL
  directly. They call services, SDKs, or local runtime APIs.

## 4. Standard Package Shape

Recommended shape:

```text
apps/sdkwork-<application-code>-pc/
  package.json
  vite.config.ts
  config/
    browser/
    desktop/
    server/
    container/
    tauri/
    electron/
    capacitor/
  src/
    App.tsx
    AuthGate.tsx
    bootstrap/
  packages/
    sdkwork-<application-code>-pc-core/
      src/sdk/
      src/session/
      src/host/
        contract.ts                  # re-export of @sdkwork/desktop-host-contract only
        registry.ts                  # host registry and host resolution
        browser/                     # browser fallback DesktopHost
    sdkwork-<application-code>-pc-commons/
    sdkwork-<application-code>-pc-<capability>/
    sdkwork-<application-code>-pc-console-<capability>/
    sdkwork-<application-code>-pc-admin-<capability>/
    sdkwork-<application-code>-pc-tauri/
      package.json
      src/
        host/                        # Tauri DesktopHost adapter
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
        gen/
          apple/
          android/
    sdkwork-<application-code>-pc-electron/
      package.json
      src/
        host/                        # Electron DesktopHost adapter
      electron-builder.yml
      src-electron/
        main/
          index.ts
          window.ts
          ipc.ts
          secure-store.ts
          updater.ts
          deep-links.ts
          tray.ts
        preload/
          index.ts
        shared/
          ipc-channels.ts
      resources/
        icons/
    sdkwork-<application-code>-pc-capacitor/
      package.json
      src/
        host/                        # Capacitor DesktopHost adapter
      capacitor.config.ts
      capacitor.electron.config.ts
      electron/
        package.json
        electron-builder.config.js
        src/
          index.ts
          plugins/
            sdkwork-host.ts
      resources/
        icons/
```

Each host architecture is packaged separately. The renderer-side host adapter, the native scaffold, the native dependency set, the config family, and the icons/signing references of one architecture `MUST` live in that architecture's host package and `MUST NOT` be merged into another host package or into `pc-core`.

Rules:

- One host architecture has exactly one host package. A host package `MUST` declare exactly one `clientArchitecture` and `MUST NOT` contain the native scaffold, native dependencies, or adapter of a second architecture. A single package carrying both `src-tauri/` and `src-electron/` trees, or a generic `-pc-host` catch-all, is forbidden.
- `pc-core/src/host/` owns the contract re-export boundary, the host registry and host resolution, and the browser fallback adapter only. It `MUST NOT` implement a native host architecture, and it `MUST NOT` depend on `@tauri-apps/api`, `electron`, `@capacitor/core`, or a Capacitor desktop platform package.
- Each host package owns its own renderer-side `DesktopHost` adapter under `src/host/`. Every adapter `MUST` satisfy the same `@sdkwork/desktop-host-contract` interface, and a contract change `MUST` update all host adapters plus the browser fallback in the same change set.
- The root PC app package owns web bootstrap and web build scripts.
- Repositories that include a desktop app `MUST` expose top-level launch commands that follow `PNPM_SCRIPT_SPEC.md`: `pnpm dev` starts the default PC renderer or documented default development workflow, and `pnpm dev:desktop` starts the default desktop shell. Tauri CLI commands remain implementation details behind action-first public scripts.
- The PC renderer dev command `MUST` use the same host and port as the active host `devUrl` (Tauri `devUrl`, Electron `ELECTRON_START_URL`, Capacitor `server.url`), and it `MUST` fail on port conflicts instead of silently falling back to another port.
- Existing backend or application server development commands `MUST` remain available under explicit PostgreSQL names such as `pnpm dev:server` or `pnpm dev:postgres` when `pnpm dev` is assigned to the desktop renderer. `dev:sqlite` may name only a client-local desktop validation path, never a server database.
- The Tauri host package (`sdkwork-<application-code>-pc-tauri`) owns Tauri CLI, Tauri config, Rust shell code, icons, permissions, capabilities, and native bundle scripts.
- The Tauri host package also owns iPadOS and Android tablet Tauri target metadata, generated native project directories, signing/runbook references, and target-specific capabilities. Tablet targets are Tauri-only: `clientArchitecture = "capacitor"` and `"electron"` `MUST NOT` be declared for `tablet-ipados` or `tablet-android`.
- The Electron host package (`sdkwork-<application-code>-pc-electron`) owns Electron main/preload/shared source, `electron-builder.yml` (or `electron-forge.config.mjs`), icons, entitlements, signing references, asar policy, and native bundle scripts. It `MUST` consume the same renderer build output as the Tauri host and `MUST NOT` fork renderer code.
- Electron main and preload code `MUST` stay inside the Electron host package. Feature packages `MUST NOT` import `electron` or touch `window.electron`/`ipcRenderer` directly.
- The Capacitor host package (`sdkwork-<application-code>-pc-capacitor`) is the Capacitor project root for a PC desktop Capacitor host. It owns `capacitor.config.ts`, the typed provider platform config (`capacitor.electron.config.ts` for the Electron-backed provider), the provider-scaffolded `electron/` scaffold, icons, signing references, and native bundle scripts. It `MUST` consume the same renderer build output as the Tauri and Electron hosts and `MUST NOT` fork renderer code.
- The Capacitor `electron/` scaffold is provider-generated and `MUST` stay minimal. The application owns only the documented provider extension points — the typed config hooks (`beforeReady`, `windowFactory`, `onWindowCreated`) and its own declared plugins. Applications `MUST NOT` vendor provider runtime logic, hand-copy a generated platform main process, or edit platform internals the provider owns; platform behavior `MUST` be upgraded through a dependency update instead.
- Capacitor host plugins and renderer-facing host code `MUST` stay inside the Capacitor host package. Feature packages `MUST NOT` import `@capacitor/core`, a Capacitor desktop platform package, or any native plugin package directly.
- The root PC app `MUST NOT` own Tauri native dependencies unless the app is intentionally single-package and documents that exception.
- The root PC app `MUST NOT` own Electron native dependencies unless the app is intentionally single-package and documents that exception.
- The root PC app `MUST NOT` own Capacitor native dependencies unless the app is intentionally single-package and documents that exception.
- A PC root `MAY` ship any subset of the three host packages. It `MUST NOT` be required to ship all three, and adding a host package `MUST NOT` force changes into the renderer or into another host package.
- Shared UI and services live in `packages/*` or approved appbase packages.
- Generated SDK output lives in SDK workspaces and `MUST NOT` be edited by the desktop app.
- Package names should express product, `pc` surface, and capability according to `APP_PC_ARCHITECTURE_SPEC.md`. Avoid catch-all names for business features.

## 5. Desktop Host Profiles

A PC root selects one or more desktop host profiles. Every profile hosts the same renderer and differs only in its native architecture, its host package, its config family, and its transport implementation of the shared bridge protocol.

| Host profile | `clientArchitecture` | Host package | Native toolchain | Config family |
| --- | --- | --- | --- | --- |
| Tauri | `"tauri"` | `sdkwork-<application-code>-pc-tauri` | Rust, Tauri CLI | `config/tauri/`, `src-tauri/tauri.*.conf.json` |
| Electron | `"electron"` | `sdkwork-<application-code>-pc-electron` | Node, electron-builder or Electron Forge | `config/electron/`, `electron-builder.yml` |
| Capacitor | `"capacitor"` | `sdkwork-<application-code>-pc-capacitor` | Capacitor CLI plus an approved Capacitor desktop platform | `config/capacitor/`, `capacitor*.config.ts` |

Profile selection rules:

- `runtimeTarget = "desktop"` is shared by all three profiles. The architecture axis is `clientArchitecture`; a per-host runtime target such as `desktop-tauri` is forbidden.
- `clientArchitecture = "tauri"` remains the default desktop architecture for backward-compatible public commands. `"electron"` and `"capacitor"` are always explicit.
- A PC root `MUST` declare the `clientArchitecture` of every host package it ships, and release or artifact selection `MUST` resolve the host package from that declaration rather than from the presence of a directory.
- Host packages are independent. Removing, failing, or upgrading one host package `MUST NOT` break the renderer, another host package, or the browser target.
- iPadOS and Android tablet targets are Tauri-only and are not a fourth profile; see section 5.2.
- Each profile section below defines its package boundary, config, security baseline, and transport. Shared contracts are defined once in sections 5.5 and 5.6 and `MUST NOT` be restated per host.

## 5.1 Tauri Host Profile

Tauri is the preferred SDKWork desktop shell profile.

Required Tauri properties:

| Area | Standard |
| --- | --- |
| Package boundary | Tauri shell and tablet-native target config live in the Tauri host package named `sdkwork-<application-code>-pc-tauri`. |
| Web dev server | `devUrl` points to the root PC app dev server. |
| Web build output | `frontendDist` points to the root PC app build output. |
| Window model | Window labels, size, minimum size, title, and decoration policy are explicit. |
| Commands | Commands are narrow host capabilities with typed request/response payloads. |
| Permissions | Capabilities and permissions are least-privilege and listed in source control. |
| Bundle metadata | product name, identifier, version, icons, and targets are explicit and release-controlled. |
| Tablet metadata | iPadOS bundle id/signing profile and Android package/signing metadata are explicit and release-controlled when those targets are enabled. |

Rules:

- Tauri commands `MUST` be named by host capability, not business use case.
- Window control, tray, updater, deep link, file dialog, filesystem, shell open, clipboard, notification, and process integration belong behind host adapters.
- Tauri command handlers `MUST` validate inputs and return safe errors. They must not leak secrets, tokens, local file contents, or raw system errors.
- Tauri permissions `MUST` be minimized. A feature requiring broader permission needs a documented reason and test coverage.
- The renderer `MUST` call the typed host adapter contract (section 5.5) and `MUST NOT` call `window.__TAURI__`, `window.electron`, Capacitor globals, or any host global directly.
- Web-only mode `MUST` degrade gracefully through the browser fallback host (empty `capabilities`, `unsupported` outcomes).
- Tablet mode must degrade gracefully when a desktop-only host capability is unavailable and must expose only target-supported capability adapters.

## 5.2 Tauri Tablet Target Profile

Tauri tablet targets are allowed for PC applications because they preserve the same large-screen renderer and workflow model. Tablet packaging is Tauri-only: exposing iPadOS or Android tablet targets requires the Tauri host package, and `clientArchitecture = "electron"` or `"capacitor"` `MUST NOT` be declared for `tablet-ipados` or `tablet-android`.

Rules:

- iPadOS and Android tablet targets `MUST` reuse the PC renderer, package taxonomy, SDK clients, appbase IAM runtime, and global TokenManager defined by `APP_PC_ARCHITECTURE_SPEC.md`.
- iPadOS target configuration `MUST` document bundle id, Apple team, provisioning profile, signing certificate, entitlements, minimum OS version, icons, launch assets, and distribution path.
- Android tablet target configuration `MUST` document package name, min/target SDK, signing key handling, ABI targets, icons, adaptive icon assets, APK/AAB outputs, and distribution path.
- Tablet target commands `SHOULD` be exposed as `pnpm dev:tablet-ipados`, `pnpm build:tablet-ipados`, `pnpm dev:tablet-android`, and `pnpm build:tablet-android`.
- iOS/iPadOS builds require macOS with Apple tooling. Android tablet builds require Android tooling. CI pipelines `MUST` record which runner image satisfies each target.
- Tablet UI `MUST` handle safe areas, orientation, split view or multi-window where supported, pointer/keyboard input, touch/stylus input, virtual keyboard, and foreground/background lifecycle transitions.
- Tablet targets `MUST NOT` introduce phone-first navigation, mobile-only SDK wrappers, copied auth stores, or divergent route ownership inside the PC root.

## 5.3 Electron Host Profile

Electron is a supported alternative desktop host profile (`clientArchitecture = "electron"`, `runtimeTarget = "desktop"`). It shares the same PC renderer, package taxonomy, generated SDK boundary, appbase IAM runtime, and global TokenManager as the Tauri host. The renderer `MUST` be host-agnostic: it reaches native capabilities only through the host adapter contract (section 5.5).

Required Electron properties:

| Area | Standard |
| --- | --- |
| Package boundary | Electron host code lives in `sdkwork-<application-code>-pc-electron`; feature UI stays in app/domain packages. |
| Web build output | `electron-builder.yml` (or `electron-forge.config.mjs`) `files`/`extraResources` point at the root PC app build output; the renderer entry loads that output, not a second renderer tree. |
| Window model | `BrowserWindow` options (width, min size, title, frame/decoration, backgroundColor) are explicit and match the Tauri window profile. |
| IPC | All renderer-to-main calls go through the bridge protocol (section 5.6) via preload; no raw `ipcRenderer` calls in renderer feature code. |
| Secure storage | Tokens and secrets use an approved OS-backed secure store exposed only through the host adapter contract. |
| Updater | Update channel uses a signed updater (for example `electron-updater`) with the same release channel declaration as the Tauri updater. |
| Bundle metadata | productName, appId, artifactName, version, icons, targets, and signing references are explicit and release-controlled. |

Security baseline (mandatory):

- `contextIsolation = true`, `nodeIntegration = false`, `sandbox = true`, `webSecurity = true`.
- Preload is the single bridge: one preload script exposes a method allowlist (section 5.6) through `contextBridge.exposeInMainWorld`; it `MUST NOT` expose a generic pass-through of arbitrary channels or a raw `ipcRenderer`.
- Production `MUST` load the packaged renderer (`loadFile`/approved local origin) and `MUST NOT` `loadURL` to unapproved remote sources.
- Filesystem access `MUST` be restricted to the SDKWork user-private runtime namespace through the `filesystemSandbox` host adapter; arbitrary path traversal is forbidden.
- Signing keys, entitlements references, and updater publish config follow the same secret-absence rules as Tauri config (section 7).

## 5.4 Capacitor Host Profile

Capacitor is a supported third desktop host profile (`clientArchitecture = "capacitor"`, `runtimeTarget = "desktop"`). It shares the same PC renderer, package taxonomy, generated SDK boundary, appbase IAM runtime, and global TokenManager as the Tauri and Electron hosts. The renderer `MUST` be host-agnostic: it reaches native capabilities only through the host adapter contract (section 5.5).

A Capacitor desktop host exists so that a PC desktop app and an H5 mobile app can share one Capacitor plugin surface and one `capacitor.config` composition model. It is not a second renderer and it is not a rebranded Electron host.

Platform provider requirement:

- A Capacitor project reaches the desktop through a **Capacitor desktop platform provider**. Providers are third-party or community packages, so the provider is a governed dependency rather than a fixed identifier.
- The provider `MUST` be pinned to an explicit version range in the Capacitor host package, and the pinned version `MUST` appear in release evidence.
- The provider `MUST` be actively maintained, permissively licensed, and `MUST` track current Capacitor and Electron major releases with no upper bound. A provider that is unmaintained, or that pins the application to an unsupported Electron major, `MUST NOT` be used.
- `@capacitor-community/electron` is **not an approved provider**: its maintainers declare it unmaintained, it pins applications to older Electron releases, and it generates a full Electron project into the application's own source tree.
- The approved provider for the Electron-backed Capacitor desktop platform is `@capawesome/capacitor-electron` (MIT), which requires Capacitor 6 or later and Electron 28 or later.
- Because the provider is swappable, nothing outside the Capacitor host package `MUST` depend on provider identifiers. The renderer integrates through `@sdkwork/desktop-host-contract` only.

Required Capacitor properties:

| Area | Standard |
| --- | --- |
| Package boundary | Capacitor host code lives in `sdkwork-<application-code>-pc-capacitor`; feature UI stays in app/domain packages. |
| Project root | The Capacitor host package is the Capacitor project root. Capacitor CLI operations run there, not at the PC app root. |
| Renderer binding | `capacitor.config.ts` `webDir` and `server.url` point at the root PC app build output and dev server. Renderer code is never copied into the package. |
| Platform config | The typed provider config (`capacitor.electron.config.ts`) is the only place window options, deep-link scheme, and lifecycle hooks are declared. |
| Scaffold | The provider-scaffolded `electron/` directory stays minimal. The application owns only the declared config hooks and its own plugins. |
| Packaging | Packaging runs inside `electron/` through the provider pack script, which compiles the scaffold, vendors runtime dependencies, and hands off to electron-builder. |
| Bundle metadata | productName, appId, artifactName, version, icons, targets, and signing references are explicit, release-controlled, and match the Tauri and Electron host metadata from the same manifest authority. |
| Platform identity | `Capacitor.getPlatform()` resolves to `electron` on this host; feature code `MUST NOT` branch on it. |

Rules:

- The Capacitor host package `MUST NOT` vendor provider runtime logic, copy a generated platform main process, or hand-edit platform internals. Platform behavior changes arrive through a dependency update.
- The renderer dev server host and port `MUST` equal the Capacitor `server.url` value, and a port conflict `MUST` fail rather than silently fall back to another port.
- Custom main-process behavior `MUST` use the documented provider hooks (`beforeReady`, `windowFactory`, `onWindowCreated`) instead of editing generated code. A custom `windowFactory` `MUST NOT` weaken the mandatory security options.
- Application-owned plugins `MUST` implement the provider plugin contract and declare their metadata explicitly. Plugin names and methods `MUST NOT` carry business semantics.
- Capacitor plugins are an explicit pinned allow-list. A plugin that resolves through its web fallback `MUST` still be declared; implicit or transitive plugin use is forbidden.
- The Capacitor `electron/` scaffold `MUST NOT` contain product business logic, SDK transport, or session state.

Security baseline (mandatory):

- The Electron host security baseline in section 5.3 applies to the Capacitor host as well.
- The provider's mandatory security defaults — sandboxed renderer, context isolation, strict Content Security Policy, and validated IPC — `MUST` remain enabled and `MUST NOT` be weakened, including through a custom `windowFactory` or provider config.
- Native capability `MUST` be reached only through the bridge protocol (section 5.6) implemented by the SDKWork host plugin. The renderer `MUST NOT` reach provider globals, plugin globals, or `Capacitor.*` directly.
- Production `MUST` load the packaged renderer and `MUST NOT` load unapproved remote origins. Development-only live reload through `server.url` `MUST NOT` survive into release configuration.
- Desktop live updates, when enabled, `MUST` use the provider serving API with failed-boot rollback, `MUST` be signed, and `MUST` follow `SUPPLY_CHAIN_SECURITY_SPEC.md`. A live update `MUST NOT` bypass the release channel or signing policy declared for the other desktop hosts.
- Signing keys, entitlements references, and updater publish config follow the same secret-absence rules as Tauri and Electron config (section 7).

Provider risk register:

- A Capacitor desktop platform is a third-party dependency sitting between the operating system and the web layer. If it stops tracking Electron security releases, the application inherits the gap. Because the platform version is pinned and recorded in release evidence, provider currency `MUST` be reviewed at every provider Electron major release.
- Provider replacement `MUST` remain possible without renderer changes. A provider identifier appearing in `pc-core`, a feature package, or another host package is a defect against sections 4 and 5.5.

## 5.5 Host Adapter Contract

Every native host `MUST` expose typed host adapters defined by the shared contract package `@sdkwork/desktop-host-contract` (contract-only, zero host runtime dependency). Feature packages depend on the contract interfaces or injected host objects, never on host globals such as `window.__TAURI__` or `window.electron`.

Standard capability identifiers (aligned with `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` section 9):

```text
window | tray | deepLinks | notifications | clipboard | filePicker
filesystemSandbox | shellOpen | updater | secureStorage | networkStatus
appLifecycle | deviceInfo | process | localRuntime | powerMonitor
```

Contract rules:

- `DesktopHost` exposes `meta.id` (`"tauri" | "electron" | "capacitor" | "browser" | "custom"`), `meta.capabilities`, typed capability groups (`window`, `tray`, `deepLinks`, `notifications`, `filePicker`, `filesystemSandbox`, `clipboard`, `secureStorage`, `updater`, `localRuntime`), `hasCapability(cap)`, and `dispose()`.
- The Tauri, Electron, Capacitor, and browser implementations `MUST` satisfy the same `DesktopHost` interface. TypeScript `satisfies DesktopHost` (or equivalent strict assignment) is the compile-time parity gate; a contract change requires every shipped host adapter plus the browser fallback to update in the same change set.
- Each host adapter lives in its own host package under `src/host/`. `pc-core/src/host/` owns the contract re-export, the host registry and resolution, and the browser fallback only, and `MUST NOT` depend on any native host package.
- Every adapter method returns a stable outcome: `{ ok: true, value }` or `{ ok: false, error: { code, message, detail? } }`. Error codes are limited to `unsupported`, `permission-denied`, `unavailable`, `cancelled`, `invalid-state`, and `internal`. Renderer code branches only on `code`, never on host-specific error text.
- Host adapters `MUST` be local-only and `MUST NOT` own business authorization, token refresh, permission evaluation, or generated SDK transport.
- Capability routing in renderer code uses the declared `capabilities` set or the `withCapability` helper; hand-written host branches such as `if (window.__TAURI__)`, `window.electron`, or `Capacitor.getPlatform()` are forbidden.
- A browser-only runtime (`runtimeTarget = "browser"`) uses the browser fallback implementation whose `capabilities` set is empty and whose methods return `unsupported`.
- The contract package and its implementations follow `TYPESCRIPT_CODE_SPEC.md`; the contract `src/index.ts` is the stable public export boundary.

## 5.6 Bridge Protocol

All renderer-to-host native calls use one bridge protocol. Tauri (`invoke` + Rust commands), Electron (`contextBridge` + `ipcRenderer.invoke`), and Capacitor (a SDKWork host plugin on the Capacitor desktop platform) are transport implementations of the same protocol.

Method naming (three segments):

```text
sdkwork:<capability>:<action>
sdkwork:window:minimize
sdkwork:deepLinks:getInitialUrl
sdkwork:secureStorage:get
sdkwork:localRuntime:start
sdkwork:updater:check
```

- `<capability>` `MUST` come from the section 5.5 capability list. Business semantics (`sdkwork:orders:create`) are forbidden.
- Request/response shapes are `BridgeRequest { v, id, method, params?, meta? }` and `BridgeResponse { v, id, ok, result? } | { v, id, ok: false, error }`.
- Host-initiated events use `BridgeEvent { v, event, payload? }` with `event = "sdkwork:<capability>:<event>"` (for example `sdkwork:deepLinks:open`).
- Tauri host: Rust commands `MUST` be named by host capability (`sdkwork_<capability>_<action>`), validate inputs, return safe errors, and never leak secrets or raw system errors.
- Electron host: `ipcMain.handle` channels equal the protocol method names; the preload exposes an allowlist whose entries are generated or validated against the contract method table. Unknown channels `MUST` be rejected, not forwarded.
- Capacitor host: exactly one SDKWork host plugin carries the protocol method table and rejects unknown methods, mirroring the Electron preload allowlist. The plugin exposes the protocol, not a generic pass-through, and `MUST NOT` widen the capability surface beyond the declared provider plugins and host capabilities.
- Feature packages `MUST` consume the protocol through injected host adapters only; they `MUST NOT` import `@tauri-apps/api`, `electron`, or `@capacitor/core` directly.

## 6. SDK, Session, And Auth

Rules:

- Desktop apps `MUST` use the same generated SDK boundary as web apps.
- Desktop IAM login/session integration `MUST` follow `IAM_LOGIN_INTEGRATION_SPEC.md`; native hosts may support host storage, OAuth/deep-link bridging, and local runtime lifecycle, but must not own business authentication.
- Desktop runtime/bootstrap `MUST` follow `APP_SDK_INTEGRATION_SPEC.md`: construct appbase app SDK clients, application/dependency app SDK clients, explicit `backend-admin` backend SDK clients only when the desktop runtime owns a `backend-admin` surface, one global token manager, token/context stores, open-api credential providers, and host adapters in one composition boundary.
- Renderer appbase IAM runtime `MUST` own login, registration, current session, refresh, logout, verification, OAuth, QR auth, password reset, runtime metadata, current-user self-service, and token propagation to authenticated SDK clients.
- SDK clients are constructed in bootstrap/core code and injected into service facades.
- UI components `MUST NOT` create SDK clients, manually attach auth headers, parse JWTs for authorization, or call raw HTTP for business behavior.
- Session storage belongs in a core session module. Feature packages read session through exported helpers or injected services.
- Logout `MUST` clear persisted session state, reset generated SDK clients, reset realtime clients where applicable, close sensitive local state, and navigate to the login entry.
- Authenticated route guards `MUST` re-check persisted session state after logout, token refresh failure, tenant switch, or account switch.
- Tokens, QR keys, OAuth codes, refresh tokens, verification codes, and password reset tokens `MUST NOT` be logged or shown in UI.

## 7. Config And Runtime Modes

Desktop apps normally support more than one runtime mode.

| Mode | Meaning |
| --- | --- |
| `desktop` | Installed desktop app with native shell and user-private runtime files. |
| `tablet-ipados` | iPadOS native package using the PC renderer and Tauri iOS target. |
| `tablet-android` | Android tablet native package using the PC renderer and Tauri Android target. |
| `standalone` | Self-contained application deployment profile. |
| `cloud` | Cloud/service deployment profile using managed ingress and dependencies. |
| `browser` | Browser runtime target without native host APIs. |

Rules:

- Environment variables and runtime config follow `ENVIRONMENT_SPEC.md` and `CONFIG_SPEC.md`.
- Lifecycle environment, profile alias, deployment profile, canonical profile
  id, build mode, and runtime target `MUST` be modeled separately. Tauri
  target, Vite mode, or Spring profile must not be used as the entire runtime
  decision.
- Runtime directories, logs, cache, user-private files, and local database paths follow `RUNTIME_DIRECTORY_SPEC.md`.
- Declared desktop client-local data uses SQLite by default, and tablet-local
  data uses SQLite or approved platform-local encrypted storage. Every backend
  service launched by desktop development commands uses the PostgreSQL profile;
  an explicit SQLite command may validate only client-local persistence.
- Installed desktop config uses `environment = "production"`,
  `deployment_profile = "standalone"`,
  `profile_id = "standalone.production"`, and
  `runtime_target = "desktop"` by default unless the installer is explicitly
  producing a cloud-managed desktop profile.
- Desktop development config uses `environment = "development"`, matching
  `deployment_profile` and `profile_id`, and `runtime_target = "desktop"` for
  the native shell, while any launched backend service uses a separate
  `runtime_target = "server"` config.
- Desktop and tablet test config uses `environment = "test"` and isolates SQLite files, logs, cache, temp files, local service ports, and backend test databases.
- Release builds `MUST NOT` hard-code localhost API or websocket endpoints.
- Development defaults may use localhost only in development-prunable branches or explicit local profiles.
- Local runtime bridges `MUST` expose stable API contracts and must be replaceable by remote services without UI rewrites.
- Feature packages `MUST NOT` read deployment profile or runtime target directly
  unless they own a true platform-specific concern.

Standard desktop/native config files:

```text
apps/sdkwork-<application-code>-pc/
  config/
    desktop/
      <application-code>.<deployment-profile>.<environment>.toml.example
    server/
      <application-code>.<deployment-profile>.<environment>.toml.example
    tauri/
      tauri.conf.json
      tauri.windows.conf.json
      tauri.macos.conf.json
      tauri.linux.conf.json
      tauri.ios.conf.json
      tauri.android.conf.json
    electron/
      electron-builder.yml
    capacitor/
      capacitor.<deployment-profile>.<environment>.example.json
  packages/sdkwork-<application-code>-pc-tauri/
    src-tauri/
      tauri.conf.json
      tauri.windows.conf.json
      tauri.macos.conf.json
      tauri.linux.conf.json
      tauri.ios.conf.json
      tauri.android.conf.json
  packages/sdkwork-<application-code>-pc-electron/
    electron-builder.yml
  packages/sdkwork-<application-code>-pc-capacitor/
    capacitor.config.ts
    capacitor.electron.config.ts
```

Rules:

- `config/desktop/*.toml.example` describes installed desktop/tablet runtime defaults: local host mode, secure storage provider, local service lifecycle, user-private directories, and SQLite or encrypted local storage. Each supported file uses the canonical `<deployment-profile>.<environment>` profile id and declares matching `environment`, `deployment_profile`, `profile_id`, and `runtime_target` values.
- `config/server/*.toml.example` describes backend/service defaults used by
  `pnpm dev:server`, desktop-started services, service releases, and
  customer-owned or cloud deployments. Server examples use the same canonical
  profile id while declaring `runtime_target = "server"`.
- `config/tauri/*` or `src-tauri/tauri.*.conf.json` describes platform packaging metadata: bundle identifier, package name, window metadata, permissions, capabilities, icons, mobile/tablet target metadata, updater metadata, and signing references.
- Tauri config may contain signing key references, keychain names, environment variable names, or CI secret identifiers. It must not contain signing private keys, auth tokens, refresh tokens, database passwords, API keys, or private endpoints.
- Tauri platform-specific config files may override target-specific packaging values and permissions. They must not override app/console/admin route ownership, generated SDK packages, API path contracts, TokenManager wiring, or appbase IAM behavior.
- `config/electron/*` or the Electron host `electron-builder.yml` describes Electron packaging metadata: appId, productName, artifactName, targets, icons, asar policy, entitlements, and signing references. It must not contain signing private keys, auth tokens, or business API contracts.
- `config/capacitor/*.example.json` or the Capacitor host `capacitor.config.ts` / `capacitor.electron.config.ts` describes the Capacitor project binding: `appId`, `appName`, `webDir`, the development `server.url`, window options, deep-link scheme, the pinned platform provider reference, the plugin allow-list, and lifecycle hook declarations. Examples are non-secret templates; installed values are materialized at build time.
- Capacitor config `MUST NOT` contain signing private keys, auth tokens, refresh tokens, database passwords, API keys, or private endpoints, and `MUST NOT` weaken the provider's mandatory sandbox, context-isolation, CSP, or IPC-validation defaults.
- Each host config family is owned by its architecture's host package and `MUST NOT` be merged into another host config family or into `config/desktop/`.
- Desktop installer initialization may generate host-local runtime config under the SDKWork user-private config directory. Generated config is runtime state and must not be copied back into source control.

Recommended commands:

```text
pnpm dev:desktop
pnpm dev:desktop:standalone
pnpm dev:desktop:cloud
pnpm dev:desktop:electron
pnpm dev:desktop:capacitor
pnpm dev:server:standalone
pnpm dev:desktop:sqlite
pnpm test:desktop
pnpm check:tauri-config
pnpm check:electron-config
pnpm check:capacitor-config
pnpm build:desktop
pnpm build:desktop:staging
pnpm build:desktop:prod
pnpm build:desktop:electron:prod
pnpm build:desktop:capacitor:prod
pnpm build:tablet-ipados:prod
pnpm build:tablet-android:prod

pnpm desktop:dev                 # default host tauri, alias of pnpm dev:desktop
pnpm desktop:dev:electron        # Electron host, alias of pnpm dev:desktop:electron
pnpm desktop:dev:capacitor       # Capacitor host, alias of pnpm dev:desktop:capacitor
pnpm desktop:dev:standalone
pnpm desktop:dev:cloud
pnpm desktop:build
pnpm desktop:build:electron
pnpm desktop:build:electron:prod
pnpm desktop:build:capacitor
pnpm desktop:build:capacitor:prod
pnpm desktop:check
pnpm desktop:test
```

Command rules:

- `dev:desktop` uses the default desktop development orchestration profile and
  must resolve to PostgreSQL, standalone, and development by default. It may
  remain client-only when default API serving is assigned to an externally
  supervised application standalone gateway, but the selected dev
  topology/database profile is still `postgres:standalone`.
- `dev:desktop:standalone` starts or locates the application-owned standalone
  gateway according to typed `gatewayPlacement`; local ownership uses a
  scoped desktop supervisor and exactly one application HTTP ingress.
- `dev:desktop:cloud` starts the renderer/native host only, resolves the
  deployed application and platform API surface URLs, and starts no local
  gateway, API, database, Redis, migration, or seed process. Desktop client
  config does not identify the remote gateway implementation.
- `dev:server:standalone` or an equivalent explicit server command makes the backend
  service profile explicit when contributors need to debug the desktop plus
  service integration path.
- `dev:desktop:sqlite` or an equivalent documented command is the explicit
  client-local SQLite regression profile. It must not select SQLite for an
  application gateway, backend service, worker, or server integration process.
- `dev:desktop:electron` selects the Electron host (`clientArchitecture = "electron"`)
  with the same standalone/development/PostgreSQL defaults. The default
  `dev:desktop` remains the Tauri host for backward compatibility.
- `dev:desktop:capacitor` selects the Capacitor host (`clientArchitecture = "capacitor"`)
  with the same standalone/development/PostgreSQL defaults. It starts the
  pinned Capacitor desktop platform against the same renderer dev server.
- The `desktop:*` host-family commands (for example `desktop:dev`,
  `desktop:dev:electron`, `desktop:dev:capacitor`, `desktop:build`,
  `desktop:check`) are equivalent aliases of their `dev:desktop` /
  `build:desktop` counterparts per `PNPM_SCRIPT_SPEC.md` section 4.1.1. They
  default to the Tauri host and select another host only with the explicit
  `electron` or `capacitor` axis.
- `check:tauri-config` validates platform config merge, profile normalization, desktop/server split, secret absence, local path resolution, and test isolation.
- `check:electron-config` validates the Electron host profile: security baseline
  (`contextIsolation`/`nodeIntegration`/`sandbox`/`webSecurity`), preload allowlist,
  secret absence, profile normalization, product metadata, and output directory.
- `check:capacitor-config` validates the Capacitor host profile: pinned provider
  reference and its maintenance/version floor, mandatory provider security defaults
  (sandbox, context isolation, strict CSP, validated IPC), the plugin allow-list,
  the bridge host plugin name against the contract method table, `webDir`/`server.url`
  binding to the root renderer, release configuration containing no development
  `server.url`, scaffold thinness, secret absence, profile normalization, and
  output directory.
- A host that is not shipped `MUST NOT` have its config checker registered. A root
  shipping only the Tauri host `MUST NOT` be required to provide `check:electron-config`
  or `check:capacitor-config`.
- `build:desktop:prod`, `build:desktop:electron:prod`, `build:desktop:capacitor:prod`, `build:tablet-ipados:prod`, and `build:tablet-android:prod` must run release preflight before packaging.

## 8. Native Capability Boundary

Desktop local gateway supervision rules:

- The host `MUST` verify gateway artifact identity/version before execution,
  bind loopback by default, allocate a collision-safe port, and publish the
  resolved URL only through typed runtime bootstrap.
- Readiness, crash restart, graceful shutdown, process ownership, log paths,
  schema migration, and updater compatibility are bounded and attributable to
  the application/session. Generic process-name termination is forbidden.
- Gateway data, SQLite, locks, logs, cache, and temp files live under the
  application user-private runtime namespace. Upgrade failure preserves a
  recoverable previous data/artifact boundary.
- Switching profile, environment, issuer, or endpoint requires a distinct
  secure-storage/cache/data namespace and re-authentication. Cloud mode never
  reuses standalone tokens or mutable local service state implicitly.

Native capability is local capability. Business authorization remains on the API side.

Allowed native host concerns:

- window controls, tray menu, deep links, notifications;
- file picker, clipboard, shell open, safe local file access;
- updater and release channel integration;
- device identity and local-only diagnostics;
- local runtime process lifecycle when explicitly owned by the desktop shell.

Forbidden native host concerns:

- app-api or backend-api business authorization decisions;
- direct database access for feature workflows;
- secret token generation outside the auth/session standard;
- generated SDK bypasses;
- login, token refresh, permission evaluation, or business authorization;
- long-running domain workflows that should be services.

Rules:

- Host adapters `MUST` expose typed methods from the section 5.5 contract (such as `window.minimize()`, `tray.setMenu(...)`, `deepLinks.getInitialUrl()`), not raw command names throughout UI code.
- Native host errors `MUST` map to the section 5.5 stable error codes (`unsupported`, `permission-denied`, `unavailable`, `cancelled`, `invalid-state`, `internal`) and user-safe messages.
- Native code should emit structured logs without secrets.

## 9. Packaging And Release

Rules:

- Web build, desktop bundle, and tablet-native package are separate stages.
- The root app build produces renderer assets. Each host package bundles those assets independently; no host package consumes another host package's artifact.
- Desktop package scripts `SHOULD` provide explicit local dev and local build commands.
- The repository top-level `package.json` `MUST` provide launch aliases for the default desktop app so contributors can start it from the repository root without knowing the app subdirectory.
- Tauri package metadata `MUST` include stable product name, identifier, version, icons, and bundle targets.
- Electron package metadata `MUST` include stable productName, appId, artifactName, version, icons, and bundle targets, matching the Tauri host metadata from the same manifest authority.
- Capacitor package metadata `MUST` include stable `appId`, `appName`, productName, artifactName, version, icons, bundle targets, and the pinned desktop platform provider reference, matching the Tauri and Electron host metadata from the same manifest authority.
- A root shipping more than one host `MUST` derive every host's product name, identifier, version, icons, and signing references from one manifest authority. Per-host metadata divergence is forbidden.
- Tablet package metadata `MUST` include stable bundle/package identifiers, version, icons, signing configuration references, and target outputs.
- Release artifacts `MUST` be reproducible from source, lockfile, native host config (Tauri config, Electron builder config, or Capacitor platform config plus the pinned provider version), runtime config templates, and SDK versions.
- Desktop installers, IPA artifacts, APK/AAB artifacts, and generated native projects must not include local secrets, developer caches, generated temporary files, or runtime state.
- Public release behavior must be verified with production-like config, not only dev server config.

## 10. Standard Verification

Required verification for desktop architecture changes:

| Verification | Evidence |
| --- | --- |
| Package boundary | Static scan proves Tauri code lives in `-pc-tauri`, Electron code lives in `-pc-electron`, Capacitor code lives in `-pc-capacitor`, no host package contains a second architecture's scaffold or dependencies, and feature UI lives in app/domain packages. |
| Host package naming | `node <sdkwork-specs>/tools/check-client-host-packages.mjs --root .` proves every native host package is architecture-explicit, is owned by the matching client root, keeps exactly one package per architecture, and carries a `package.json`. The retired `-pc-desktop` alias is reported as migration debt and fails the gate under `--strict`. |
| Adapter ownership | Static scan proves each host adapter lives in its own host package, and `pc-core/src/host/` contains only the contract re-export, host registry, and browser fallback with no native host dependency. |
| SDK boundary | Static scan proves no raw HTTP, manual token headers, or generated SDK edits were introduced for business flows. |
| Host boundary | Static scan proves feature packages use the host adapter contract (section 5.5), not scattered raw host globals (`window.__TAURI__`, `window.electron`, `Capacitor.*`, `ipcRenderer`, `@tauri-apps/api`, `electron`, `@capacitor/core` imports). |
| Host contract parity | TypeScript check proves the Tauri, Electron, and Capacitor implementations plus the browser fallback satisfy the same `DesktopHost` interface and expose the same capability set. |
| Session behavior | Logout, refresh failure, and account switch clear session and prevent stale route guards. |
| Config behavior | Localhost defaults are dev/local only; dev/test/staging/prod profiles normalize correctly; browser public runtime, desktop user runtime, server runtime, container runtime, and the Tauri, Electron, and Capacitor host config families remain separate. |
| Database boundary | Declared desktop client-local data resolves to SQLite; every desktop-started backend service resolves to PostgreSQL. |
| Tauri config | `devUrl`, `frontendDist`, window config, permissions, capabilities, bundle metadata, and icons are present. |
| Electron config | Security baseline (`contextIsolation`/`nodeIntegration`/`sandbox`/`webSecurity`), preload allowlist, product metadata, signing references, and output directory are present and validated. |
| Capacitor config | Pinned provider reference and version floor, mandatory provider security defaults, plugin allow-list, bridge host plugin against the contract method table, `webDir`/`server.url` renderer binding, no development `server.url` in release config, scaffold thinness, and output directory are present and validated. |
| Tablet config | iPadOS/Android config, signing references, large-screen behavior, safe-area handling, permissions/capabilities, and output artifact commands are present when enabled, and tablet targets declare the Tauri architecture only. |
| Type and build | Changed packages pass typecheck and relevant build or smoke commands. |

Suggested commands depend on the app, but every desktop app should define equivalents for:

```text
pnpm dev
pnpm dev:desktop
pnpm dev:tablet-ipados
pnpm dev:tablet-android
pnpm --dir apps/sdkwork-<application-code>-pc lint
pnpm --dir apps/sdkwork-<application-code>-pc build
pnpm --dir apps/sdkwork-<application-code>-pc test:config
pnpm --dir apps/sdkwork-<application-code>-pc exec <architecture-contract-tests>
pnpm --filter @sdkwork/<application-code>-pc-tauri build:desktop:local
pnpm --filter @sdkwork/<application-code>-pc-tauri check:tauri-config
pnpm --filter @sdkwork/<application-code>-pc-tauri build:tablet-ipados
pnpm --filter @sdkwork/<application-code>-pc-tauri build:tablet-android
pnpm --filter @sdkwork/<application-code>-pc-electron build:desktop:electron:local
pnpm --filter @sdkwork/<application-code>-pc-electron check:electron-config
pnpm --filter @sdkwork/<application-code>-pc-capacitor build:desktop:capacitor:local
pnpm --filter @sdkwork/<application-code>-pc-capacitor check:capacitor-config
```

## 11. Acceptance Checklist

- [ ] Desktop/tablet native architecture was considered separately from app PC UI architecture.
- [ ] Repository top-level `pnpm dev` and `pnpm dev:desktop` can start the default PC renderer/default development workflow and desktop shell.
- [ ] Each shipped host architecture has its own host package (`-pc-tauri`, `-pc-electron`, `-pc-capacitor`); no package hosts two architectures.
- [ ] Each host adapter lives in its own host package, and `pc-core/src/host/` holds only the contract re-export, host registry, and browser fallback.
- [ ] `pnpm dev:desktop:electron` starts the Electron host with the same renderer and profile defaults when Electron packaging is enabled.
- [ ] `pnpm dev:desktop:capacitor` starts the Capacitor host, pinned to an approved, maintained desktop platform provider, with the same renderer and profile defaults when Capacitor packaging is enabled.
- [ ] App shell is thin and does not own reusable business workflows.
- [ ] UI-service-SDK layering follows `FRONTEND_SPEC.md` and `APP_PC_REACT_UI_SPEC.md`.
- [ ] Remote business calls use generated SDK clients or approved wrappers.
- [ ] Native host commands are narrow, typed, least-privilege, and local-only.
- [ ] Tauri, Electron, and Capacitor hosts satisfy the same `DesktopHost` contract (section 5.5); feature code contains no host globals.
- [ ] Electron host enforces the security baseline and preload allowlist (section 5.3).
- [ ] Capacitor host preserves the provider's mandatory security defaults and reaches native capability only through the bridge protocol (section 5.6).
- [ ] Desktop-local user data uses SQLite, tablet-local user data uses SQLite or approved encrypted platform storage, while desktop/tablet-started backend services use the PostgreSQL dev profile by default.
- [ ] Desktop user runtime config, desktop-started server config, browser public runtime config, and container runtime config use canonical `<deployment-profile>.<environment>` identities; each host config family (Tauri, Electron, Capacitor) remains a separate host-packaging axis.
- [ ] Host config contains only packaging metadata, permissions, capabilities, plugin allow-list, scaffold references, and signing references; secrets and business API contracts are excluded.
- [ ] Tauri config, permissions, capabilities, icons, and bundle metadata are explicit.
- [ ] iPadOS and Android tablet package metadata, signing references, safe-area/lifecycle behavior, and build commands are explicit when tablet targets are enabled, and tablet targets declare the Tauri architecture only.
- [ ] Session/logout/token handling is centralized and tested.
- [ ] Runtime config and directories follow `ENVIRONMENT_SPEC.md` and `RUNTIME_DIRECTORY_SPEC.md`.
- [ ] Release builds do not hard-code localhost or developer-only paths, and no release configuration carries a development Capacitor `server.url`.
- [ ] Verification covers package boundary, adapter ownership, SDK boundary, host boundary, host contract parity, config, and session behavior.
