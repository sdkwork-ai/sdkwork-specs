# Pad Application Architecture Standard

- Version: 1.0
- Scope: SDKWork pad/tablet application roots for iPadOS and Android tablets, including the PC-aligned React renderer, tablet host package, app/console/admin package taxonomy, tablet adaptation contract, SDK/IAM boundary, config, release, and verification
- Related: `SDKWORK_WORKSPACE_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `DESKTOP_APP_ARCHITECTURE_SPEC.md`, `APPLICATION_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `FRONTEND_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_MANIFEST_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `NAMING_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `DEPLOYMENT_SPEC.md`, `SECURITY_SPEC.md`, `APP_ASSETS_SPEC.md`, `TAILWIND_CSS_INTEGRATION_SPEC.md`, `THEME_DARKMODE_SPEC.md`, `I18N_SPEC.md`, `COMPONENT_SPEC.md`, `MODULE_SPEC.md`, `TEST_SPEC.md`

This standard defines the architecture for SDKWork pad applications. A pad application is a tablet-first, large-screen client root that delivers native iPadOS and Android tablet packages. Its application architecture is aligned with `APP_PC_ARCHITECTURE_SPEC.md`: the same thin bootstrap, package roles, app/console/admin separation, generated-SDK boundary, appbase IAM runtime, global TokenManager, host adapter boundary, route identity, and config discipline. The difference is the product target and the mandatory tablet adaptation contract in section 5.

This standard is the authority for:

- the `apps/sdkwork-<application-code>-pad/` application root;
- `sdkwork-<application-code>-pad-*`, `sdkwork-<application-code>-pad-console-*`, and `sdkwork-<application-code>-pad-admin-*` packages;
- the single `sdkwork-<application-code>-pad-tauri` tablet host package;
- the tablet adaptation contract that both pad roots and PC-root tablet targets apply;
- tablet runtime, config, build, release, store, migration, and verification rules.

`APP_PC_ARCHITECTURE_SPEC.md` owns the shared large-screen application architecture. Where this standard is silent, the shared PC architecture rules apply with `pc` replaced by `pad`; PC-only browser-mode, desktop-host, Electron, and Capacitor rules do not apply to a pad root. `DESKTOP_APP_ARCHITECTURE_SPEC.md` owns the native host and bridge profile details; `APP_PC_REACT_UI_SPEC.md` owns the React package layering rules.

## 1. Core Model

A pad application root composes packages. It is not a second place where business behavior accumulates.

```text
Pad application root
  -> thin root src bootstrap, providers, route assembly, tablet layout entry
  -> package families under packages/
  -> injected generated TypeScript app SDK clients and appbase IAM runtime
  -> app-api, backend-api, protected open-api, local runtime APIs
  -> one pad-tauri host package for iPadOS and Android tablet targets
```

Rules:

- One pad application root `MUST` deliver at least one native tablet target. iPadOS maps to `tablet-ipados`; Android tablet maps to `tablet-android`. A pad root that ships both targets keeps one root, one renderer, one package taxonomy, and one host package.
- A pad root `MUST` be tablet-first. Its default window is a medium or expanded tablet window, and its default navigation is a tablet navigation pattern, not a stretched phone shell.
- A pad root `MUST` reuse the shared PC architecture conventions in `APP_PC_ARCHITECTURE_SPEC.md` sections 3, 4, 5, 6, 7, 9, 11, and 12 with the `pad` segment, plus the applicable section 1 principles. PC browser-mode, desktop-host, Electron, and Capacitor rules do not apply. The architecture-alignment matrix in section 3 makes the substitution explicit.
- Root `src/` `MUST` stay thin: bootstrap, providers, tablet layout, router assembly, AuthGate wiring, environment selection, host adapter registration, and package registration.
- Business pages, services, route contributions, i18n, domain state, and workflow-specific components `MUST` live in `packages/`.
- Generated SDK clients `MUST` be constructed in bootstrap/core code and injected into services or providers. UI packages `MUST NOT` construct raw HTTP calls, manual auth headers, manual API key headers, or generated SDK clients for business flows.
- Appbase IAM login, registration, session, refresh, logout, current user, runtime metadata, and token propagation `MUST` follow `APP_SDK_INTEGRATION_SPEC.md` and `IAM_LOGIN_INTEGRATION_SPEC.md`.
- A pad root `MUST NOT` be a WebView wrapper around an H5 or PC bundle. It owns a real React renderer, package family, and tablet adaptation implementation.
- A pad root `MUST NOT` create phone-first H5 pages, mobile-only business services, a second auth runtime, or a parallel generated SDK family.
- This version of the pad root targets iPadOS and Android tablets only. HarmonyOS tablet delivery follows the Harmony native mobile root or a future target extension, and Windows tablet delivery is a PC package platform; neither is a pad-root runtime target.

### 1.1 What "Aligned With PC" Means

Alignment is architectural, not a shared bundle.

| Concern | Pad alignment requirement |
| --- | --- |
| Root model | One application root with a thin bootstrap and package families under `packages/`. |
| Package roles | `core`, `commons`, `shell`, capability, optional `console-*`, optional `admin-*`, and one host package. |
| Surface split | App, user-facing console, and internal `backend-admin` remain separate. |
| SDK boundary | App/console use generated TypeScript app SDKs; admin uses generated backend SDKs. |
| IAM/session | One appbase IAM runtime and one global TokenManager per authenticated session context. |
| Host boundary | Typed host adapter contracts and a shared bridge protocol; no platform globals in feature code. |
| Route identity | `<surface>.<domain>.<capability>.<screen>` route ids shared with PC, H5, and native roots. |
| Config | Lifecycle environment, deployment profile, build mode, runtime target, and packaging metadata stay separate. |
| Verification | Static package checks plus app-level tablet adaptation tests. |

Rules:

- Pad packages `MUST NOT` import `-pc-*`, `-h5-*`, Flutter, mini program, or native mobile UI packages, route contributions, host implementations, or private `src/` files.
- Cross-root reuse `MUST` use generated SDKs, shared contracts, service ports, route metadata, i18n keys, design tokens, host adapter contracts, or test fixtures.
- A pad root `MUST NOT` fork a PC business service or page merely to change layout. Layout adaptation belongs in shell, layout primitives, and capability UI; business behavior stays shared through contracts and SDKs.
- A pad root and a PC root that serve the same product `MUST` keep the same API surface, SDK family, route ids, permission hints, and i18n keys.

### 1.2 Choosing Between The PC Root And The Pad Root

Tablet delivery has two valid paths. Choose one per product surface and app identity.

| Product situation | Required architecture | Why |
| --- | --- | --- |
| A PC product adds tablet packages for the same large-screen workflow, app identity, and store listing | PC root with `tablet-ipados` / `tablet-android` targets, per `APP_PC_ARCHITECTURE_SPEC.md` section 8.1 | Tablet is a package target of the PC product; no second renderer is justified. |
| A tablet-first product needs a dedicated tablet UX, tablet-only navigation model, separate app identity/store listing, or a tablet-specific capability set | Pad root, per this standard | The tablet surface is a product surface, not only a package target. |
| A phone-first product also runs acceptably on tablets | H5, Flutter, or native mobile root with responsive tablet widths | A pad root is not a phone-first architecture and must not be used to avoid mobile adaptation. |
| Browser-only tablet access | Adaptive Web PC/H5 pair; tablets resolve to the PC surface unless a delivery override selects H5 | The pad root is a native packaging architecture, not a browser delivery root. |

Rules:

- One product surface `MUST NOT` declare both a pad root and PC-root tablet packages for the same app identity and store listing. Choose one path and record the choice in the application `specs/` or ADR.
- A pad root `MUST NOT` be used only to obtain an iPad app-store listing while the product remains a phone-first or web-first experience.
- PC-root tablet targets `MUST` apply the tablet adaptation contract in section 5. They do not become pad roots.
- Moving a shipped PC-root tablet target to a pad root, or the reverse, is an application-root change and requires an ADR plus release migration evidence.

## 2. Standard Root Layout

Every new pad application root `MUST` use the directory name `apps/sdkwork-<application-code>-pad/` and start from this layout unless an exception is recorded through `GOVERNANCE_SPEC.md`.

```text
apps/sdkwork-<application-code>-pad/
  AGENTS.md
  agent.app.config.json
  .sdkwork/
    README.md
    skills/
      README.md
    plugins/
      README.md
  .env.<deployment-profile>.<environment>
  assets/
    README.md
    resources/
    media/
    capture/
  bin/
    windows/
    linux/
    macos/
  config/
    browser/
      runtime-env.<deployment-profile>.<environment>.example.json
    tablet/
      <application-code>.<deployment-profile>.<environment>.toml.example
    tauri/
  docs/
  public/
  scripts/
  sdks/
  specs/
    component.spec.json
    tablet-adaptation.spec.json
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
      hostAdapters.ts
  packages/
    sdkwork-<application-code>-pad-core/
    sdkwork-<application-code>-pad-commons/
    sdkwork-<application-code>-pad-shell/
    sdkwork-<application-code>-pad-<capability>/
    sdkwork-<application-code>-pad-console-core/
    sdkwork-<application-code>-pad-console-shell/
    sdkwork-<application-code>-pad-console-<capability>/
    sdkwork-<application-code>-pad-admin-core/
    sdkwork-<application-code>-pad-admin-shell/
    sdkwork-<application-code>-pad-admin-<capability>/
    sdkwork-<application-code>-pad-tauri/
      src-tauri/
        tauri.conf.json
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

- `.sdkwork/` is required by `SDKWORK_WORKSPACE_SPEC.md`. It is not generated SDK output and is not user runtime state.
- `assets/` owns the application asset root defined by `APP_ASSETS_SPEC.md`, including iPad and Android tablet screenshots, covers, and capture configuration.
- `bin/` contains cross-platform operational and release helper scripts when the root needs them.
- `config/browser/` owns tablet-renderer public runtime config because the React renderer runs in a WebView. It contains public, non-secret values only.
- `config/tablet/` owns installed tablet runtime defaults: local host mode, secure storage provider, cache policy, and target metadata references. It does not own API route constants or business config.
- `config/tauri/` or `src-tauri/tauri.*.conf.json` owns platform packaging metadata: bundle identifier, package name, permissions, capabilities, icons, target metadata, and signing references.
- `docs/` owns tablet adaptation evidence, runbooks, release notes, and local decisions.
- `sdks/` contains application-root SDK workspaces and generator inputs according to `SDK_WORKSPACE_GENERATION_SPEC.md`.
- `specs/` contains local component and application contracts. `component.spec.json` follows `COMPONENT_SPEC.md`; `tablet-adaptation.spec.json` follows section 5.12.
- `src/` is the root shell entry and composition boundary only.
- `packages/` contains runtime, shell, capability, console, admin, and host packages. Exactly one `pad-tauri` host package is allowed.
- `tests/` contains application-level integration, tablet adaptation, route, package-boundary, host, and release verification tests.
- A pad root `MUST NOT` contain `config/server/`, `config/container/`, or a deployable service profile. If the product needs a bundled local service, it follows `APPLICATION_SPEC.md`, `CONFIG_SPEC.md`, and `RUNTIME_DIRECTORY_SPEC.md` as a separate deployable module, not as pad-root config.

### 2.1 Renderer And Tailwind CSS

The pad renderer is a React/Vite renderer inside the Tauri host.

Rules:

- Pad build output follows the Tauri `frontendDist` target. A pad root is exempt from the browser `dist/<profile>/<envAlias>/` publish layout in `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` section 2.1 because it ships store/installer artifacts, not browser assets.
- `src/index.css` is the single Tailwind CSS bootstrap entry when Tailwind CSS v4 is used; `TAILWIND_CSS_INTEGRATION_SPEC.md` applies.
- Feature packages under `packages/` `MUST NOT` `@import "tailwindcss"` in CSS imported by the host shell.
- `vite.config.ts` `MUST` register `@tailwindcss/vite` and `MUST NOT` alias bare specifier `tailwindcss`.
- `vite.config.ts` and `vitest.config.ts` `MUST NOT` declare `resolve.alias` entries for package specifiers. Workspace package resolution follows `APP_PC_ARCHITECTURE_SPEC.md` section 2.0.1.
- Verification `MUST` run `node <sdkwork-specs>/tools/check-vite-workspace-aliases.mjs --root .` and pass before a pad root is considered compliant.

## 3. PC Alignment Matrix

The pad root is structurally the PC root with a tablet runtime and tablet UX. The following matrix is normative.

| Concern | PC reference | Pad requirement |
| --- | --- | --- |
| Root name | `apps/sdkwork-<application-code>-pc/` | `apps/sdkwork-<application-code>-pad/` |
| Package segment | `pc` | `pad` |
| Root bootstrap | `src/bootstrap/` | Same responsibilities; add tablet host adapter registration and window-class detection. |
| Package roles | `pc-core`, `pc-commons`, `pc-shell`, `pc-<capability>`, `pc-console-*`, `pc-admin-*` | `pad-core`, `pad-commons`, `pad-shell`, `pad-<capability>`, `pad-console-*`, `pad-admin-*` |
| Surface split | App, user console, internal admin | Identical ownership and API/SDK boundaries. |
| Renderer | React/Vite large-screen renderer | React/Vite tablet renderer; responsive window-class layout, not a phone renderer. |
| Native host | One per desktop architecture (`pc-tauri`, `pc-electron`, `pc-capacitor`) | Exactly one `pad-tauri`; Electron and Capacitor are forbidden for pad roots. |
| Runtime targets | `browser`, `desktop`, `tablet-*` | `tablet-ipados`, `tablet-android` only. |
| Config families | Browser, desktop, server, container, Tauri | Browser (WebView public config), tablet user runtime, Tauri platform config. No server/container. |
| SDK/IAM | Generated TypeScript app SDK, appbase IAM, one TokenManager | Identical, with secure storage through the tablet host adapter. |
| Routes | PC route ids and shell ownership | Identical route ids and ownership; add tablet presentation hints. |
| Commands | `dev:*`, `build:*`, `desktop:*`, `tablet:*` | `dev:tablet-*`, `build:tablet-*`, and `mobile:*` tablet aliases. |
| Release | Desktop installers, tablet packages | IPA, APK/AAB, store/private distribution evidence. |

Rules:

- A pad root `MUST NOT` rename a package role. `core`, `commons`, `shell`, `console-core`, `console-shell`, `admin-core`, `admin-shell`, and `host` retain their PC meaning.
- A pad root `MUST NOT` introduce a fourth app surface. App, console, and admin remain the only surfaces.
- A pad root `MUST` keep `pad-core` free of backend SDK exports. `pad-admin-core` or another explicit `backend-admin` boundary owns backend SDK wrappers.

## 4. Package Taxonomy

Pad package directory names `MUST` include the application code and the `pad` surface segment.

| Package family | Naming | Surface | Owns | Must not own |
| --- | --- | --- | --- | --- |
| Core runtime | `sdkwork-<application-code>-pad-core` | shared tablet runtime | SDK client factories, TokenManager binding, appbase IAM runtime, session store, environment, window-class detection, host adapter contracts | product pages, domain workflows, admin business logic |
| Commons | `sdkwork-<application-code>-pad-commons` | shared tablet UI/runtime | domain-neutral tablet layout primitives, split-view primitives, responsive helpers, design-system adapters, i18n helpers | business pages, business services, route ownership |
| App shell | `sdkwork-<application-code>-pad-shell` | app/user shell | tablet app layout, navigation rail/sidebar, master-detail composition, app route assembly, app AuthGate integration | console/admin routes, backend SDK calls, business services |
| App capability | `sdkwork-<application-code>-pad-<capability>` | app/user | tablet-adapted pages, components, services, hooks, route metadata, i18n | console/admin pages, backend-only operations, concrete SDK construction |
| Console core | `sdkwork-<application-code>-pad-console-core` | user console runtime | console SDK providers, console permission hints, console runtime helpers | app shell, admin SDK resources, internal staff features |
| Console shell | `sdkwork-<application-code>-pad-console-shell` | user console shell | user-facing management console layout, tablet navigation, console route composition | app pages, internal admin pages, backend-only operation center |
| Console capability | `sdkwork-<application-code>-pad-console-<capability>` | user console | customer/tenant/app-owner management tablet workflows, console services, console route metadata | internal company admin behavior, backend-only moderation/ops workflows |
| Admin core | `sdkwork-<application-code>-pad-admin-core` | `backend-admin` runtime | backend SDK provider, admin permission/audit helpers, admin route guards, operator context | user login UI, app-api session creation, customer console workflows |
| Admin shell | `sdkwork-<application-code>-pad-admin-shell` | `backend-admin` shell | internal management tablet layout, admin menus, admin route composition | app user navigation, user console navigation, business data transport |
| Admin capability | `sdkwork-<application-code>-pad-admin-<capability>` | `backend-admin` | internal staff tablet operation pages, backend services, permissions, audit-facing workflows | app-api user workflows, user console workflows, raw HTTP bypasses |
| Tauri tablet host | `sdkwork-<application-code>-pad-tauri` | iPadOS and Android tablet native host | Tauri CLI and config, Rust shell commands, permissions, capabilities, icons, iPadOS IPA workflow, Android APK/AAB workflow | business authorization, app/domain services, generated SDK edits, another architecture's scaffold |

Rules:

- A package named `sdkwork-<application-code>-pad-<capability>` without `pad-console` or `pad-admin` is an app/user package by default.
- `console` means user-facing management console for customers, tenants, app owners, or app users who manage their own resources.
- `admin` maps to the `backend-admin` surface: company-internal staff management for operations, moderation, platform administration, support, audit, and internal control. `pad-console` packages are not `backend-admin`.
- Exactly one `sdkwork-<application-code>-pad-tauri` host package is allowed per pad root. `pad-electron`, `pad-capacitor`, `pad-host`, `pad-desktop`, and `pad-<platform>-host` names are forbidden.
- A pad root `MUST NOT` use `-pc-*`, `-h5-*`, `-android-mobile-*`, `-ios-mobile-*`, `-harmony-mobile-*`, `-flutter-mobile-*`, `-mp-*`, `-uniapp-*`, or `-unity-*` package families for its own UI. It may consume generated SDKs and `-common` contracts.
- New pad packages `MUST NOT` use `sdkwork-<application-code>-pad-react-*`. The React implementation is implied by the pad root; the surface role is not encoded as `-react`.
- Capability names `MUST` be lower kebab-case and should match a domain or business capability from `DOMAIN_SPEC.md`.

Examples:

```text
sdkwork-shop-pad-merchandise
sdkwork-shop-pad-cart
sdkwork-shop-pad-orders
sdkwork-shop-pad-console-settings
sdkwork-shop-pad-console-settlements
sdkwork-shop-pad-admin-monitor
sdkwork-shop-pad-admin-inventory
sdkwork-shop-pad-tauri
```

### 4.1 Package Internal Shape

Pad capability packages use the PC React package shape with tablet adaptation folders.

```text
packages/sdkwork-<application-code>-pad-<surface-or-capability>/
  package.json
  README.md
  src/
    index.ts
    pages/
    components/
    layout/
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
- `src/layout/` owns tablet layout composition for that capability: split panes, inspector regions, responsive regions, and window-class variants.
- `src/pages/` owns route-level composition.
- `src/components/` owns rendering units and receives data through props or hooks.
- `src/services/` owns SDK orchestration, validation mapping, error normalization, and workflow coordination.
- `src/state/` owns view/cache state only. API invariants remain on the backend.
- `src/i18n/` owns package-local locale fragments and thin aggregation exports per `I18N_SPEC.md`.
- `src/routes/` owns route metadata contributed to the owning shell. It does not own raw URL constants for API calls.
- `specs/` follows `COMPONENT_SPEC.md` for authored packages.

## 5. Tablet Adaptation Contract

Tablet adaptation is a product requirement, not a CSS afterthought. This section is authoritative for pad roots and for PC-root tablet targets. Mobile roots that claim tablet-width support `SHOULD` apply sections 5.4, 5.5, 5.8, and 5.9 to the extent their platform allows.

### 5.1 Window Classes And Breakpoints

Tablet layouts `MUST` respond to the current window size, not to a device model, user-agent string, or fixed orientation.

| Window class | Width range (logical px/pt) | Primary use on a tablet |
| --- | --- | --- |
| `compact` | 320-599 | Narrow multi-window, Slide Over, split-view edge, transient phone-width pane. |
| `medium` | 600-839 | Portrait tablet, half-screen split view, compact multitasking. |
| `expanded` | 840-1199 | Full-screen portrait tablet, two-pane productivity layout. |
| `large` | 1200 and above | Landscape tablet, Stage Manager, desktop mode, three-pane layout. |

Rules:

- A pad root `MUST` implement all four window classes. A class may change layout, but it `MUST NOT` be unimplemented or assumed unreachable because the device is a tablet.
- `medium` and `expanded` are the primary product classes. `compact` is a first-class multi-window and split-view class, not an error state.
- Both portrait and landscape `MUST` be supported. A pad root `MUST NOT` lock orientation or require a fixed device posture.
- Window-class detection `MUST` use container or window dimensions and `ResizeObserver`-equivalent APIs. Hard-coded iPad model widths, Android `smallestWidth` values as the only layout signal, and user-agent branching are forbidden for layout.
- A window resize `MUST` reflow content without losing route state, scroll position, selection, open panels, or unsaved input.
- A pad root `MUST` declare its supported classes, orientations, multitasking modes, input modes, capabilities, and test matrix in `specs/tablet-adaptation.spec.json` per section 5.12.

### 5.2 Layout And Navigation

Rules:

- `medium` and wider `MUST` use a tablet navigation pattern: navigation rail, sidebar, split view, or a combination. A bottom tab bar stretched across a tablet `MUST NOT` be the primary navigation.
- `expanded` `MUST` support master-detail or list-detail composition for collection workflows. Selecting an item `MUST NOT` replace the collection with a full-screen detail page when a split layout is available.
- `large` `SHOULD` support a third pane or inspector for properties, activity, preview, or contextual actions.
- `compact` `MAY` collapse to a single column with a drawer, sheet, or stack navigation. It `MUST NOT` reuse a phone-only shell that breaks tablet layout when the window grows.
- Resizable panes `MUST` declare minimum and maximum widths, respect content minimums, and persist the user's pane ratio per workspace and route family.
- Content `MUST` use a readable measure. Long text `SHOULD` cap line length and `MAY` use multiple columns at `large`.
- Dialogs `SHOULD` become sheets, popovers, or inline panels on tablets. Full-screen modals are reserved for immersive or blocking tasks.
- Toolbars and command surfaces `MUST` adapt to the window class. Hiding all actions behind a single overflow menu on `expanded` is forbidden when primary actions can be shown.
- Layout state `MUST` restore after route changes, app resume, and window recreation. Shell-owned layout state and capability-owned view state `MUST` remain separate.

### 5.3 Multi-Window, Split View, And External Display

Rules:

- iPadOS targets `MUST` support Split View and Slide Over where the OS version allows them, and `SHOULD` support Stage Manager window resizing. The layout `MUST` remain usable at the narrowest supported split width.
- Android tablet targets `MUST` support multi-window/freeform resizing where the OS and device allow it, and `MUST` declare `resizeableActivity` and large-screen support in the Android manifest when required.
- The app `MUST NOT` assume it owns the full screen, a fixed aspect ratio, or a single window. Full-screen-only assumptions, orientation locks, and fixed pixel layouts are forbidden.
- One authenticated session `MUST` back every window of the app. Multiple windows `MUST NOT` create duplicate TokenManagers, refresh loops, or divergent auth state.
- Each window `MUST` keep its own navigation stack and route instance. Cross-window shared state `MUST` be explicit through a shared store, broadcast channel, or host adapter, not through accidental module singletons.
- Deep links, handoff, and external display events `MUST` open or focus the correct window and route without duplicating the session.
- Drag and drop `MUST` work within the app and, where the platform allows, across apps. Drop targets `MUST` validate type and permission before accepting data.
- External display or desktop-mode output is optional. When supported, it `MUST` use the same route ids and a declared layout, not a second undocumented UI.

### 5.4 Input And Interaction

Rules:

- Touch targets `MUST` be at least 44 x 44 pt on iPadOS and 48 x 48 dp on Android, with adequate spacing between adjacent targets.
- `MUST` support pointer hover, focus, click, right-click context menu, and trackpad scrolling on iPadOS and pointer/mouse input on Android where available.
- `MUST` support hardware keyboard navigation: visible focus, logical tab order, Enter/Space activation, Escape/back dismissal, and documented shortcuts for primary actions.
- Every pointer-only action `MUST` have a touch equivalent. Every hover-only affordance `MUST` have a focus or press equivalent. Hover-only menus and right-click-only actions are forbidden.
- `MUST` support text selection, copy/paste, multi-select, and drag and drop where the workflow uses collections.
- Virtual keyboard and IME insets `MUST` be handled. A focused field `MUST` remain visible, the layout `MUST` avoid covering the caret, and dismissing the keyboard `MUST` restore the viewport.
- Stylus input is optional. When the app claims stylus support, it `MUST` declare the capability, handle palm rejection and pressure/tilt only where used, and provide a touch fallback for every stylus action.
- Gesture navigation and system back `MUST` be respected. The app `MUST NOT` place destructive or primary controls inside system gesture areas.

### 5.5 Safe Areas And System UI

Rules:

- Layouts `MUST` consume safe-area insets on all four edges, including the home indicator, status bar, rounded corners, camera cutout, and multitasking affordances.
- iPadOS layouts `MUST` account for the multitasking control, window controls, and Stage Manager chrome. Controls `MUST NOT` be hidden under system window controls.
- Android layouts `MUST` support edge-to-edge rendering with correct insets, gesture navigation, predictive back, and taskbar/desktop-mode insets where available.
- Scrollable content `MUST` extend correctly under translucent system bars while keeping interactive controls outside gesture exclusion zones.
- Keyboard, pointer, and stylus interactions `MUST NOT` be blocked by transparent overlay layers used only for visual effects.

### 5.6 Typography, Density, And Visual Hierarchy

Rules:

- A pad root `MUST NOT` scale a phone layout up. It `MUST` use tablet-appropriate density, spacing, type scale, and information hierarchy.
- Typography `MUST` respect platform text scaling (`Dynamic Type` on iPadOS, font scale on Android). Layouts `MUST` reflow rather than clip at large text sizes.
- Reading surfaces `SHOULD` cap line length and use multi-column text at `expanded` and `large` where the content benefits.
- Images and media `MUST` be selected for the rendered size. Stretching phone-resolution assets across a tablet is forbidden.
- Dark mode, high contrast, and reduced motion `MUST` follow `THEME_DARKMODE_SPEC.md` and the platform accessibility settings.
- Loading, empty, error, permission-denied, and offline states `MUST` be designed for tablet layout, not inherited from a phone-width shell.

### 5.7 State Preservation And Lifecycle

Rules:

- Resize, orientation change, split-view resize, Stage Manager resize, and Android multi-window resize `MUST` preserve route, scroll, selection, open panels, pane ratios, and unsaved drafts.
- Background and foreground transitions `MUST` refresh or revalidate session state without duplicating submissions, replaying uploads, or dropping queued work.
- Low-memory warnings `MUST` release non-visible caches and decoded media without losing user-entered state.
- Logout, account switch, and tenant switch `MUST` clear session state in every window and every host storage location.
- Crash or termination recovery `SHOULD` restore the last safe route and draft state without restoring stale secrets.

### 5.8 Accessibility

Rules:

- Every interactive element `MUST` expose an accessible name, role, state, and value.
- Screen-reader order `MUST` follow visual and logical order. Decorative split panes and resize handles `MUST NOT` create focus traps.
- Keyboard-only operation `MUST` be possible for all primary workflows.
- Switch Control, Voice Control, and platform assistive technologies `MUST` be able to activate primary actions.
- Reduced-motion settings `MUST` disable non-essential animation. Flashing, parallax, and auto-playing media `MUST` follow platform accessibility settings.
- Contrast, focus indicators, and text scaling `MUST` meet platform accessibility guidance.
- Captions and transcripts `MUST` be provided for media that carries spoken content.

### 5.9 Performance

Rules:

- Scrolling and resizing `SHOULD` hold the platform refresh rate on the supported device baseline. Long lists, tables, and media grids `MUST` virtualize.
- Image decode, thumbnails, and video posters `MUST` match the rendered size and density.
- Window resize and split-view transitions `MUST NOT` trigger full data reloads or layout thrash.
- Startup, route transition, and first meaningful paint `SHOULD` be measured on the oldest supported tablet, not only on a current simulator.
- Memory budgets `MUST` account for multiple windows and large media.

### 5.10 Tablet Capability Adapters

Tablet-only and tablet-relevant capabilities are exposed through typed host adapters, never platform globals.

Standard tablet capability categories:

```text
multitasking
externalDisplay
windowControls
keyboardShortcuts
stylus
filePicker
shareSheet
camera
qrScanner
secureStorage
pushNotifications
biometric
networkStatus
appLifecycle
clipboard
deepLinks
```

Rules:

- The host `MUST` declare a `capabilities` set. Renderer code routes through the declared set or a shared capability helper; hand-written platform branches on host globals are forbidden.
- Unsupported capabilities `MUST` return stable outcomes such as `unsupported` or `unavailable`; they `MUST NOT` throw platform-specific exceptions into business code.
- Every host implementation for the same capability `MUST` expose the same method shape so feature code compiles unchanged.
- Stylus, external display, and biometric capabilities are optional. A root that declares them `MUST` provide a fallback for devices without them.
- Host adapters `MUST NOT` own login, token refresh, permission evaluation, business authorization, direct database access, or raw business API transport.

### 5.11 Anti-Patterns

| Anti-pattern | Why it fails | Required replacement |
| --- | --- | --- |
| Stretched phone layout with bottom tabs | Ignores tablet information density and navigation expectations | Navigation rail/sidebar plus master-detail or split layout. |
| Fixed iPad model widths or user-agent layout branching | Breaks Split View, Stage Manager, Android freeform, and future devices | Window-class detection from actual dimensions. |
| Orientation lock or full-screen-only assumption | Breaks multitasking and external display | Resizable layout for all declared classes. |
| Hover-only or right-click-only action | Unusable with touch | Touch and keyboard equivalent. |
| Tiny touch targets | Accessibility and error-rate failure | 44 pt / 48 dp minimum with spacing. |
| Full-screen modal for every detail | Wastes tablet space and loses context | Split pane, sheet, popover, or inspector. |
| Copying mobile auth or token storage | Diverges from appbase IAM and risks token leakage | Appbase IAM runtime plus host secure storage. |
| WebView wrapper around H5 or PC bundle | Not a tablet architecture; hides adaptation work | Real pad renderer and package family. |
| Duplicating PC business services for tablet | Creates divergent behavior | Shared contracts and SDKs; adaptation in shell and UI. |
| Assuming one window equals one app instance | Duplicate sessions, refresh loops, inconsistent state | One session, per-window route state. |

### 5.12 Tablet Adaptation Contract File

Every pad root, and every PC root that enables `tablet-ipados` or `tablet-android`, `MUST` provide `specs/tablet-adaptation.spec.json` matching `schemas/sdkwork.tablet-adaptation.spec.schema.v1.json`.

Minimum shape:

```json
{
  "schemaVersion": 1,
  "applicationCode": "shop",
  "runtimeTargets": ["tablet-ipados", "tablet-android"],
  "windowClasses": {
    "compact": { "supported": true, "minWidth": 320, "layout": "single-column" },
    "medium": { "supported": true, "minWidth": 600, "layout": "rail-and-content" },
    "expanded": { "supported": true, "minWidth": 840, "layout": "master-detail" },
    "large": { "supported": true, "minWidth": 1200, "layout": "three-pane" }
  },
  "orientations": ["portrait", "landscape"],
  "multitasking": {
    "splitView": true,
    "slideOver": true,
    "stageManager": true,
    "androidFreeform": true,
    "externalDisplay": false
  },
  "input": {
    "touch": true,
    "pointer": true,
    "trackpad": true,
    "hardwareKeyboard": true,
    "stylus": false
  },
  "capabilities": [
    "multitasking",
    "windowControls",
    "keyboardShortcuts",
    "filePicker",
    "shareSheet",
    "secureStorage",
    "networkStatus",
    "appLifecycle",
    "clipboard",
    "deepLinks"
  ],
  "testMatrix": [
    { "runtimeTarget": "tablet-ipados", "windowClass": "medium", "orientation": "portrait", "multitasking": "full-screen" },
    { "runtimeTarget": "tablet-ipados", "windowClass": "expanded", "orientation": "landscape", "multitasking": "split-view" },
    { "runtimeTarget": "tablet-ipados", "windowClass": "compact", "orientation": "portrait", "multitasking": "slide-over" },
    { "runtimeTarget": "tablet-android", "windowClass": "medium", "orientation": "portrait", "multitasking": "full-screen" },
    { "runtimeTarget": "tablet-android", "windowClass": "expanded", "orientation": "landscape", "multitasking": "freeform" }
  ],
  "evidence": {
    "screenshots": "assets/capture/tablet/",
    "tests": "tests/tablet/"
  }
}
```

The example matrix is abbreviated. A real matrix `MUST` cover every declared runtime target, window class, orientation, and applicable multitasking mode.

Rules:

- `runtimeTargets` `MUST` list only targets the root actually ships.
- Every window class `MUST` be declared `supported: true`; a pad root cannot omit `compact` because multi-window can reach it.
- `orientations` `MUST` include both `portrait` and `landscape`.
- `multitasking` `MUST` declare `splitView`, `slideOver`, `stageManager`, `androidFreeform`, and `externalDisplay`. `splitView` and `slideOver` `MUST` be `true` for iPadOS targets, `androidFreeform` `MUST` be `true` for Android tablet targets, and `externalDisplay` is declared according to the product.
- `input` `MUST` declare `touch`, `pointer`, `trackpad`, `hardwareKeyboard`, and `stylus`. `touch`, `pointer`, and `hardwareKeyboard` `MUST` be `true`; `trackpad` and `stylus` are declared according to the product.
- `capabilities` `MUST` be a subset of the capabilities the host actually declares. A capability listed here but absent from the host is a blocker.
- `testMatrix` `MUST` cover every declared runtime target and every window class and orientation for that target. It `MUST` include a `full-screen` case, `split-view`/`slide-over`/`stage-manager` cases for iPadOS targets, `freeform` for Android tablet targets, and `external-display` when that mode is claimed. A test matrix that omits a declared target, class, orientation, or applicable mode is invalid.
- `testMatrix[].multitasking` values are `full-screen`, `split-view`, `slide-over`, `stage-manager`, `freeform`, and `external-display`.
- `evidence.screenshots` and `evidence.tests` `MUST` point at tracked directories that contain the adaptation evidence.
- App tests `MUST` validate this file against the required shape and the host capability declaration, and `MUST` fail when a declared matrix row has no automated or recorded manual evidence.
- Verification `MUST` run `node <sdkwork-specs>/tools/check-tablet-adaptation.mjs --root .`; a workspace scan uses `--workspace <workspace-root>`.

## 6. Runtime Targets, Manifest, And Config

Pad roots use the existing tablet runtime target vocabulary. No new deployment profile or runtime target is introduced.

| Target | Runtime target | Host/package | Required behavior |
| --- | --- | --- | --- |
| iPadOS native tablet | `tablet-ipados` | `sdkwork-<application-code>-pad-tauri` Tauri iOS target | iPad Split View/Slide Over/Stage Manager awareness, Apple signing, IPA/TestFlight/App Store or private distribution. |
| Android tablet native | `tablet-android` | `sdkwork-<application-code>-pad-tauri` Tauri Android target | Android multi-window/large-screen behavior, signing, APK/AAB, Play/private distribution. |

Rules:

- A pad root `MUST NOT` declare `browser`, `desktop`, `server`, `container`, `capacitor-*`, `flutter-*`, `android-native`, `ios-native`, `harmony-native`, or `mini-program` as its runtime target. Browser tablet access belongs to the Adaptive Web PC/H5 pair.
- A pad root `MUST` declare `runtime.clientArchitectures` with exactly one value, `tauri`. Its package `runtimeTarget` entries are `tablet-ipados` and/or `tablet-android`, matching the shipped targets.
- `clientArchitecture = "electron"` or `"capacitor"` `MUST NOT` be declared for a pad root or for a tablet runtime target.
- `runtime.family` `MUST` be `desktop` and `runtime.framework` `MUST` be `react-tauri` for a pad root.
- `targetPlatforms` `MUST` include the platforms the root ships, for example `ipados` and `android-tablet`.
- `publish.platforms` `MUST` list only the platforms actually shipped, for example `APP_IOS` and `APP_ANDROID`.
- `app.appType` `MUST` remain the canonical client application type for the implementation (`APP_REACT` for the React pad root). The tablet identity is carried by the root, runtime target, and package metadata, not by inventing a new `appType`.

### 6.1 Config And Environment Matrix

| Concern | Standard values | Owner |
| --- | --- | --- |
| Lifecycle environment | `development`, `test`, `staging`, `demo`, `production` | `CONFIG_SPEC.md` typed runtime config |
| Profile alias | `dev`, `test`, `staging`, `prod` | Legacy command/operator compatibility only |
| Build mode | Vite/Tauri/build-tool mode | Build scripts and tool config |
| Deployment profile | `standalone`, `cloud` | runtime/bootstrap |
| Runtime target | `tablet-ipados`, `tablet-android` | runtime/bootstrap |
| Window class | `compact`, `medium`, `expanded`, `large` | shell/layout runtime |

Standard config ownership:

| Config family | Example files | Owns | Must not own |
| --- | --- | --- | --- |
| Vite/tablet renderer build env | `.env.<deployment-profile>.<environment>` | public `VITE_*` profile identity, SDK base URLs, public flags | secrets, tokens, database/Redis config, host packaging metadata |
| Tablet renderer runtime | `config/browser/runtime-env.<deployment-profile>.<environment>.example.json` | promotable public SDK base URLs, public feature flags, public app metadata | secrets, database URLs, Redis URLs, tokens, private service endpoints |
| Tablet user runtime | `config/tablet/<application-code>.<deployment-profile>.<environment>.toml.example` | installed tablet mode, secure storage provider, cache policy, target metadata references | server PostgreSQL defaults, API route constants, signing secrets |
| Tauri platform | `src-tauri/tauri.ios.conf.json`, `src-tauri/tauri.android.conf.json`, optional `config/tauri/` templates | bundle id, package name, icons, permissions, capabilities, window metadata, signing references | business API contracts, SDK ownership, auth tokens, private keys |

Rules:

- Pad roots `MUST` provide safe example config for every runtime target and environment they support.
- Tablet renderer env files `MUST` expose matching `VITE_SDKWORK_ENVIRONMENT`, `VITE_SDKWORK_DEPLOYMENT_PROFILE`, `VITE_SDKWORK_PROFILE_ID`, and `VITE_SDKWORK_RUNTIME_TARGET=tablet-ipados|tablet-android` before renderer SDK construction.
- `.env.local`, `.env.<profile>.local`, `.env.postgres`, `.env.release.local`, and `config/*.local.toml` `MUST` be ignored.
- `pnpm test` `MUST` use an isolated test profile and must not share development or production database/schema, Redis prefix, logs, cache, runtime, or temporary directories.
- Release builds `MUST` fail preflight when production profiles contain localhost endpoints, development secrets, test database names, writable developer directories, unresolved placeholders, or committed signing material.
- Tablet config `MUST NOT` identify the remote gateway implementation. Standalone and cloud selection follows `CONFIG_SPEC.md` and `DEPLOYMENT_SPEC.md`.

## 7. Host Package And Native Boundary

The pad root owns exactly one native host package: `sdkwork-<application-code>-pad-tauri`.

Standard host package shape:

```text
packages/sdkwork-<application-code>-pad-tauri/
  package.json
  src/
    host/
  src-tauri/
    tauri.conf.json
    tauri.ios.conf.json
    tauri.android.conf.json
    src/
    permissions/
    capabilities/
    icons/
    gen/
      apple/
      android/
  tests/
```

Rules:

- The host package `MUST` implement the shared host adapter contract and bridge protocol used by the PC host family (`@sdkwork/desktop-host-contract`; the package name is historical and covers large-screen native hosts). Tablet-specific categories from section 5.10 extend the contract; they do not create a second contract.
- The host package `MUST` own Tauri configuration, permissions, capabilities, icons, native project directories, signing references, and target-specific packaging metadata.
- The host package `MUST NOT` own business authorization, app/domain services, generated SDK edits, route constants, or a second architecture's scaffold.
- The host package `MUST NOT` depend on a PC host package or another client root's host package. Shared contracts belong in `pad-core` or an approved shared contract package.
- iPadOS target configuration `MUST` document bundle id, Apple team, provisioning profile, signing certificate, entitlements, minimum OS version, supported device families, icons, launch assets, and distribution path.
- Android tablet target configuration `MUST` document package name, min/target SDK, signing key handling, ABI targets, icons, adaptive icon assets, APK/AAB outputs, large-screen manifest behavior, and distribution path.
- Tablet targets `MUST NOT` store tokens, refresh tokens, signing secrets, or API keys in generated platform directories or committed native config.
- iPadOS builds `MUST` be performed on macOS hosts with Apple tooling. Android tablet builds require Android tooling. CI pipelines `MUST` record which runner image satisfies each target.
- `tauri.ios.conf.json` and `tauri.android.conf.json` `MUST NOT` override business API contracts, SDK package ownership, or auth behavior.
- A pad root `MUST NOT` add a `pad-desktop`, `pad-electron`, or `pad-capacitor` host. Tablet-only packaging is a design constraint, not a missing integration.

## 8. SDK, IAM, And Session

Pad applications are SDK composition applications with tablet host adapters.

Rules:

- App and console packages `MUST` use generated TypeScript app SDK clients or approved appbase app wrappers for `/app/v3/api`.
- Admin packages are `backend-admin` packages and `MUST` use generated TypeScript backend SDK clients or approved backend wrappers for `/backend/v3/api`.
- Packages without `pad-admin` are non-admin. They `MUST NOT` import, export, construct, proxy, or route through backend SDK clients, backend wrappers, backend generated SDK packages, or backend base URL resolvers.
- `pad-core` `MUST` export the application-owned app SDK and appbase app SDK wrappers needed by the tablet renderer. It `MUST NOT` export backend SDK wrappers.
- `pad-admin-core` or an equivalent `backend-admin` boundary owns backend SDK and appbase backend SDK wrapper exports.
- Runtime/bootstrap `MUST` create one global TokenManager per authenticated session context and bind it to appbase app SDK clients, downstream authenticated app-api SDK clients, and explicit `backend-admin` backend-api SDK clients.
- Appbase IAM runtime owns login, registration, current session, refresh, logout, OAuth, QR auth, password reset, runtime metadata, and current-user self-service.
- Token and refresh-token persistence `MUST` use the tablet host secure-storage adapter backed by iOS Keychain or Android Keystore. Tokens `MUST NOT` be stored in `localStorage`, `sessionStorage`, IndexedDB, committed config, generated platform directories, or plain files.
- Logout, refresh failure, tenant switch, and account switch `MUST` clear token/context stores, sensitive state, realtime/session bridges, and platform secure storage in every window.
- Biometric unlock is optional. When enabled, it gates access to the existing session; it `MUST NOT` become a second credential store or bypass appbase IAM.
- Protected open-api clients, when used from pad packages, `MUST` be injected with their approved open-api credential provider matching the declared auth mode. They `MUST NOT` be added to app/backend token-manager client lists.
- Feature packages `MUST NOT` implement raw HTTP fallbacks for missing SDK methods. Missing methods are fixed in the owning API contract, generator input, and generated SDK family.

## 9. Routes And Multi-Window Identity

Pad routes use the same identity model as every other client architecture.

Rules:

- Route ids `MUST` follow `<surface>.<domain>.<capability>.<screen>`, with the same `surface`, `domain`, `capability`, `screen`, `titleKey`, and `permissionHint` used by the PC or H5 implementation of the same workflow.
- Route metadata `MUST NOT` declare HTTP API paths, SDK methods, raw URL constants, or transport details.
- A tablet presentation hint `MAY` be declared alongside existing presentation hints:

```ts
export interface SdkworkUiRouteContribution {
  // ...
  presentation?: {
    // ...
    pad?: "page" | "split" | "inspector" | "sheet" | "popover" | "dialog";
  };
}
```

- The `pad` hint `MUST` describe composition intent, not a physical breakpoint. The shell decides how a `split` or `inspector` route composes at the current window class.
- Every window `MUST` keep its own route instance and navigation stack. A deep link `MUST` resolve to a route id first and then to the window-specific physical path or route object.
- Route guards remain shell/runtime responsibilities. Capability packages declare auth and permission hints only.
- App, console, and admin route prefixes `SHOULD` remain distinct when the surfaces coexist, for example `/app`, `/console`, and `/admin`.
- A multi-window route `MUST` restore correctly when a window is closed, recreated, or moved between displays.

## 10. Commands

Every pad application root `MUST` expose these command equivalents:

```text
pnpm install
pnpm dev
pnpm dev:standalone
pnpm dev:cloud
pnpm stop
pnpm typecheck
pnpm test
pnpm test:tablet-adaptation
pnpm test:config
pnpm check
pnpm verify
pnpm lint
pnpm build
pnpm build:tablet-ipados
pnpm build:tablet-ipados:prod
pnpm build:tablet-android
pnpm build:tablet-android:prod
pnpm clean
```

Tablet development commands:

```text
pnpm dev:tablet-ipados
pnpm dev:tablet-android
```

Rules:

- `pnpm dev` `MUST` start the root's declared default tablet host. A pad root `SHOULD` default to iPadOS when both targets are shipped, unless the application README documents Android tablet as the default.
- `dev:standalone` and `dev:cloud` `MUST` select the same default tablet target as `dev` and the corresponding deployment profile, per `PNPM_SCRIPT_SPEC.md` section 3. `stop` `MUST` stop only processes started by the root's development session.
- Pad roots `MUST` also expose the root lifecycle commands `check`, `verify`, `clean`, and `build` required by `PNPM_SCRIPT_SPEC.md`. `build` builds every shipped tablet target.
- `dev:tablet-ipados`, `dev:tablet-android`, `build:tablet-ipados`, and `build:tablet-android` `MUST` call the corresponding Tauri CLI commands such as `tauri ios dev`, `tauri ios build`, `tauri android dev`, and `tauri android build`.
- Pad roots `SHOULD` expose the profile variants `dev:tablet-ipados:standalone`, `dev:tablet-ipados:cloud`, `dev:tablet-android:standalone`, and `dev:tablet-android:cloud` per `PNPM_SCRIPT_SPEC.md` section 3. `pnpm dev` remains the default entry.
- A pad root `MAY` expose the `mobile:*` convenience family. When it does, `mobile:dev:ipados` maps to `dev:tablet-ipados` and `mobile:dev:android` maps to `dev:tablet-android`, per `PNPM_SCRIPT_SPEC.md` section 4.1.2.
- Package filters `MUST` be stable:

```text
pnpm --filter @sdkwork/<application-code>-pad-core typecheck
pnpm --filter @sdkwork/<application-code>-pad-tauri build:tablet-ipados
pnpm --filter @sdkwork/<application-code>-pad-tauri build:tablet-android
```

- `test:tablet-adaptation` `MUST` run the tablet adaptation tests declared in `specs/tablet-adaptation.spec.json`, including window-class layout, resize state preservation, input parity, safe-area behavior, and host capability fallback.
- `test:config` `MUST` validate deployment profile, environment, runtime target, public/private separation, and test isolation.
- `build:tablet-*:prod` `MUST` run release preflight for public runtime config, tablet user config, Tauri platform config, icons, signing references, and store metadata.

## 11. Build, Release, And Store

Rules:

- iPadOS artifacts `MUST` be IPA or the store-owned equivalent. Android tablet artifacts `MUST` be APK or AAB. Artifact naming follows `NAMING_SPEC.md` and `GITHUB_WORKFLOW_SPEC.md`, for example `ipados-universal-standalone-tablet-ipa` and `android-tablet-arm64-standalone-tablet-aab`.
- Release evidence `MUST` include target, version, build number, signing identity reference, artifact checksum, provenance, and the store/private distribution lane.
- Store submission media `MUST` follow `APP_ASSETS_SPEC.md`, including iPad screenshots when an iPad target is shipped and Play tablet screenshots when tablet groups are declared.
- iPadOS release `MUST` document Apple Developer team, bundle id, provisioning profile, signing certificate, entitlements, minimum OS, privacy declarations, TestFlight/App Store/private path, and rollback through the store or MDM channel.
- Android tablet release `MUST` document package name, version code strategy, signing key handling, ABI targets, min/target SDK, large-screen manifest behavior, Play/private path, staged rollout, and rollback.
- Signing keys, provisioning profiles, store credentials, and notarization secrets `MUST` live in the approved secret store and `MUST NOT` be committed to the repository, build artifacts, or generated native directories.
- A release `MUST` fail when the tablet adaptation contract declares a matrix row without evidence, when the host capability set lacks a declared capability, or when tablet screenshots/assets required by the declared store profile are missing.
- Store descriptions and screenshots `MUST` represent the tablet experience honestly. A phone screenshot scaled up as a tablet screenshot is forbidden.

## 12. Migration And Exceptions

The pad root previously had no single architecture standard. Some drafts and consumer repositories interpreted `apps/sdkwork-<application-code>-pad/` as a mobile-framework root that selects a per-target mobile standard. This standard replaces that interpretation.

Rules:

- New pad roots `MUST` follow this standard. A new pad root `MUST NOT` be created by copying `APP_H5_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, or `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`.
- An existing pad root that used a mobile framework and mobile package family `MUST` either migrate to the PC-aligned pad architecture in this standard or be reclassified as the matching mobile root (`-ios-mobile`, `-android-mobile`, `-harmony-mobile`, or `-flutter-mobile`). The reclassification is a root move and requires `MIGRATION_SPEC.md` evidence.
- During migration, a governance exception `MUST` name the affected root, the old framework/package family, the target state, the owner, and the expiry. A standing exception is not accepted.
- Existing PC roots that already ship `tablet-ipados` or `tablet-android` `MUST` keep their root and add `specs/tablet-adaptation.spec.json` plus the section 5 adaptation evidence. They `MUST NOT` be moved to a pad root solely to satisfy this standard.
- If a product needs both a PC root and a pad root, they `MUST` be separate application roots with separate manifests, store identities, package families, and verification. Shared behavior goes through `-common` contracts, generated SDKs, and design tokens.
- Moving tablet packages from a PC root to a pad root, or the reverse, requires an ADR, a release migration plan, store-listing continuity evidence, and a compatibility window.

## 13. Verification

Required verification for pad application architecture changes:

| Verification | Evidence |
| --- | --- |
| Root layout | Static check proves the root path uses `apps/sdkwork-<application-code>-pad/` and contains `.sdkwork/`, `src/`, `packages/`, `sdks/`, `specs/`, `assets/`, `config/`, `scripts/`, and `tests/` as required. |
| Package naming | Static check proves new packages use `sdkwork-<application-code>-pad-*`, `sdkwork-<application-code>-pad-console-*`, or `sdkwork-<application-code>-pad-admin-*`. |
| Host package naming | `node <sdkwork-specs>/tools/check-client-host-packages.mjs --root .` proves the pad root owns exactly one `sdkwork-<application-code>-pad-tauri` host package, carries `package.json`, and has no Electron, Capacitor, generic host, or second-architecture package. |
| Surface split | Static scan proves app, console, and admin packages do not deep import each other or share hidden route/service internals. |
| SDK boundary | Static scan proves app/console use app SDKs, `backend-admin` packages use backend SDKs, protected open-api uses the declared credential provider, and no raw HTTP/manual auth headers were introduced. |
| SDK export boundary | Static scan proves `pad-core` exports app SDK/appbase app SDK wrappers and no backend SDK wrappers, while backend SDK wrappers are exported only from `pad-admin-core` or another `backend-admin` boundary. |
| IAM boundary | Tests prove appbase IAM runtime, one global TokenManager, secure-storage persistence, logout clearing, session restore, tenant switch, and multi-window session sharing. |
| PC alignment | Static scan proves the pad root uses the PC package roles, surface split, dependency direction, route id shape, and config families with the `pad` segment. It also proves no pad package imports PC/H5/mobile UI implementations. |
| Window-class layout | Automated or screenshot tests prove `compact`, `medium`, `expanded`, and `large` layouts, portrait and landscape, and state preservation across resize and rotation. |
| Multitasking | Device/simulator tests prove iPad Split View, Slide Over, and Stage Manager behavior where supported, and Android multi-window/freeform behavior where supported. |
| Input parity | Tests prove touch, pointer, trackpad, hardware keyboard, focus order, context menus, virtual keyboard insets, and touch equivalents for pointer-only actions. |
| Safe areas | Tests or screenshots prove all four insets, home indicator, status bar, camera cutout, multitasking controls, Android edge-to-edge, and gesture exclusion zones. |
| Accessibility | Tests or audit evidence prove labels/roles, screen-reader order, keyboard-only operation, large text reflow, reduced motion, contrast, and captions. |
| Performance | Evidence proves virtualization for long collections, rendered-size media, resize without full reload, startup/first-paint budget, and memory behavior with multiple windows. |
| Adaptation contract | App tests validate `specs/tablet-adaptation.spec.json` against `schemas/sdkwork.tablet-adaptation.spec.schema.v1.json`, declared host capabilities, and evidence paths; `node <sdkwork-specs>/tools/check-tablet-adaptation.mjs --root .` passes and fails when a declared target, class, orientation, or applicable multitasking mode has no coverage. |
| Manifest/config boundary | `node <sdkwork-specs>/tools/check-tablet-adaptation.mjs --root .` proves pad `appType = APP_REACT`, `runtime.family = desktop`, `runtime.framework = react-tauri`, `clientArchitectures = ["tauri"]`, tablet-only package targets, and corresponding `targetPlatforms`/`publish.platforms`; tests prove deployment profile, environment, public/private separation, and test isolation. |
| Assets/release | `node <sdkwork-specs>/tools/check-app-assets-standard.mjs --root .` passes; release preflight proves signing references, artifact naming, store media, checksums, and provenance without committed secrets. |
| Package build | Changed packages pass typecheck, tests, adapter tests, and tablet build/smoke commands. |

Acceptance checklist:

- [ ] Pad root uses `apps/sdkwork-<application-code>-pad/` and follows the standard root layout or has a documented governance exception.
- [ ] New package names include the `pad` segment and follow the app/console/admin roles.
- [ ] Exactly one `pad-tauri` host package exists; no Electron, Capacitor, generic host, or second architecture is present.
- [ ] Runtime targets are limited to `tablet-ipados` and `tablet-android`; no browser, desktop, server, container, or mobile-framework target is declared.
- [ ] `runtime.family = "desktop"`, `runtime.framework = "react-tauri"`, and `clientArchitectures = ["tauri"]`.
- [ ] `pad-core` exports app SDK/appbase app SDK wrappers and no backend SDK wrappers.
- [ ] Appbase IAM runtime, one global TokenManager, secure storage, logout clearing, and multi-window session sharing are verified.
- [ ] `specs/tablet-adaptation.spec.json` exists, covers all four window classes, both orientations, every shipped target, and every claimed multitasking mode, points at real evidence, and passes `tools/check-tablet-adaptation.mjs`.
- [ ] Tablet layout covers navigation rail/sidebar, master-detail, resizable panes, orientation, resize, split view, Stage Manager/freeform, safe areas, virtual keyboard, pointer, trackpad, keyboard, and optional stylus.
- [ ] Touch targets, accessibility, text scaling, reduced motion, and contrast meet the platform baseline.
- [ ] No phone-first navigation, hover-only action, full-screen-only assumption, fixed device-width layout, or WebView wrapper was introduced.
- [ ] Tablet screenshots, store metadata, signing references, artifact names, and release evidence are complete and honest.
- [ ] Verification evidence is recorded in the application PR or change note.
