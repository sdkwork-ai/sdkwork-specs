# Unity App Architecture Standard

- Version: 1.0
- Scope: SDKWork Unity application roots for games and interactive 3D/2D clients, UPM package taxonomy with Assembly Definitions, scene/prefab/asset ownership, generated C# app SDK integration, Unity host adapters, mobile/standalone/WebGL/mini-game delivery, and cross-client route alignment
- Related: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APPLICATION_SPEC.md`, `NAMING_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `APP_MANIFEST_SPEC.md`, `I18N_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `TEST_SPEC.md`

This standard defines the application-root architecture for SDKWork Unity clients: games, simulations, digital twins, and interactive 3D/2D product surfaces delivered as mobile app packages (`APP_ANDROID`, `APP_IOS`), desktop standalone packages (`DESKTOP_WINDOWS`, `DESKTOP_MACOS`, `DESKTOP_LINUX`), WebGL (`WEB`), or platform mini-game packages (`MP_WEIXIN_GAME` and related `MP_*_GAME` values).

Unity dependency boundaries are expressed through Assembly Definitions (`.asmdef`), not folder discipline alone. Every SDKWork role is one UPM package with one runtime Assembly Definition, so the compiler enforces the same dependency direction other client architectures enforce through package managers.

## 1. Core Model

```text
Unity root
  -> thin bootstrap scene + Assets/Scripts/Bootstrap
  -> UPM packages under Packages/ (core, commons, shell, capability, optional console/admin, host)
  -> generated C# app SDK clients adapted for Unity runtime
  -> appbase Unity wrapper or approved appbase C# IAM adapter
  -> one global token-manager equivalent (secure storage backed)
  -> typed Unity host adapters over platform/engine APIs
  -> scene/address contributions aligned by route id
```

Rules:

- A Unity root `MUST` use UPM packages for core, commons, shell, capability, optional console/admin, and host boundaries.
- The bootstrap scene and `Assets/Scripts/Bootstrap/` `MUST` stay thin: engine bootstrap, environment/runtime config load, SDK client construction, IAM runtime wiring, host adapter registration, and shell/first-scene loading. Game screens and systems live in packages.
- `MonoBehaviour` classes are thin adapters. Game rules, network flows, economy, and business orchestration live in plain C# services that receive injected SDK clients, ports, and adapters.
- Unity packages `MUST` consume generated C# app SDK clients or an approved appbase Unity wrapper. They must not import React, Flutter, Kotlin, Swift, or ArkTS wrappers.
- Engine and platform APIs (rendering pipeline config, platform UI, store/pay plugins, push, clipboard, file pickers) `MUST` stay behind typed host adapters.
- Cross-client route identity follows `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.

## 2. Standard Root Layout

```text
apps/sdkwork-<application-code>-unity/
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
    app/
      runtime-env.<deployment-profile>.<environment>.json
    host/
      unity.development.example.json
      unity.staging.example.json
      unity.production.example.json
    server/
      <application-code>.<deployment-profile>.<environment>.toml.example
    container/
      <application-code>.<deployment-profile>.<environment>.toml.example
  docs/
  scripts/
  sdks/
  specs/
  Assets/
    Scenes/
      Bootstrap.unity
    Scripts/
      Bootstrap/
        Environment.cs
        Runtime.cs
        SdkClients.cs
        IamRuntime.cs
        HostAdapters.cs
        SceneRoutes.cs
    StreamingAssets/
      RuntimeConfig/
    AddressableAssets/
      Settings/
    Settings/
  Packages/
    manifest.json
    com.sdkwork.<application-code>-unity-core/
    com.sdkwork.<application-code>-unity-commons/
    com.sdkwork.<application-code>-unity-shell/
    com.sdkwork.<application-code>-unity-<capability>/
    com.sdkwork.<application-code>-unity-console-core/
    com.sdkwork.<application-code>-unity-console-shell/
    com.sdkwork.<application-code>-unity-console-<capability>/
    com.sdkwork.<application-code>-unity-admin-core/
    com.sdkwork.<application-code>-unity-admin-shell/
    com.sdkwork.<application-code>-unity-admin-<capability>/
    com.sdkwork.<application-code>-unity-host/
  ProjectSettings/
  tests/
  package.json
```

Rules:

- The root name `apps/sdkwork-<application-code>-unity` is canonical. New Unity roots `MUST NOT` use the shorter `apps/<application-code>-unity/` form.
- `Assets/` owns only root-level bootstrap: `Scenes/Bootstrap.unity`, `Scripts/Bootstrap/`, materialized `StreamingAssets/RuntimeConfig/`, Addressables settings, and root quality/URP settings assets. Business scenes, prefabs, and assets belong to packages.
- `Packages/` owns embedded SDKWork UPM packages. Third-party UPM dependencies are declared in `Packages/manifest.json` and pinned by version or dependency lock.
- `config/app/` owns non-secret runtime templates; the build projects exactly one selected profile into `Assets/StreamingAssets/RuntimeConfig/` before player build, as required by `CONFIG_SPEC.md` and `ENVIRONMENT_SPEC.md` §5.1/§6.2.
- `config/host/` owns Unity company/package identifiers, bundle ids per target, keystore/signing reference names (never key material), store metadata references, and platform plugin settings references.
- `sdks/` follows `SDK_WORKSPACE_GENERATION_SPEC.md`; generated C# SDK output must not be hand-edited.
- `tests/` holds Unity Test Framework edit-mode/play-mode suites plus root config/route verification.

## 3. Package Taxonomy

UPM package names use the reverse-domain form `com.sdkwork.<application-code>-unity-<role>`; Assembly Definition names use `Sdkwork.<ApplicationCode>.Unity.<Role>` PascalCase. Both must preserve the SDKWork package identity in component specs.

| Package | Owns | Must not own |
| --- | --- | --- |
| `com.sdkwork.<application-code>-unity-core` | runtime config types, SDK client factories, generated C# SDK transport adapter (UnityWebRequest port), token-manager equivalent, appbase IAM adapter, session/context stores, scene route registry, host adapter contracts | scenes, prefabs, gameplay, business workflows |
| `com.sdkwork.<application-code>-unity-commons` | domain-neutral UI toolkit widgets, theming/tokens, list/form/error primitives, localization helpers | business scenes, SDK construction |
| `com.sdkwork.<application-code>-unity-shell` | shell scene composition, scene/navigation loading, AuthGate integration, route contribution assembly | gameplay/business services |
| `com.sdkwork.<application-code>-unity-<capability>` | one domain capability: scenes, prefabs, ScriptableObjects, plain C# services, state, i18n keys, route/scene contributions | concrete SDK construction, unrelated capabilities |
| `com.sdkwork.<application-code>-unity-console-*` | user-facing console workflows through app-api | internal operator workflows |
| `com.sdkwork.<application-code>-unity-admin-*` | approved internal operator workflows through backend-api | user login/session creation |
| `com.sdkwork.<application-code>-unity-host` | Unity host adapters: secure storage, platform UI, push, deep links, store/payment bridges, file/media pickers, clipboard, haptics, lifecycle, device info | business API transport, authorization |

Rules:

- Unity admin packages require explicit approval, `backend-admin` surface classification, and backend SDK boundary verification. Games that need an internal operations console should prefer a PC `admin` root (`APP_PC_ARCHITECTURE_SPEC.md`) over a shipped Unity admin package.
- Packages without the `console` or `admin` role are default app/user packages.
- The `<capability>` segment is a concrete business/game module token (lower kebab-case in the package id) and `MUST NOT` be a placeholder such as `console`, `admin`, `manager`, `backend`, `common`, `misc`, `game`, or `core`.
- Each package contains exactly one runtime `.asmdef` (plus optional `Editor` and `Tests` asmdefs). Package `.asmdef` references are the dependency boundary and must mirror section 5.

## 4. Package Internal Shape

```text
Packages/com.sdkwork.<application-code>-unity-<capability>/
  package.json
  README.md
  Runtime/
    Sdkwork.<ApplicationCode>.Unity.<Capability>.asmdef
    Services/
    State/
    Models/
    Routes/
    Localization/
    Host/
    Scripts/
      (thin MonoBehaviours, VOs, controllers)
  Scenes/
  Art/
    Prefabs/
    Materials/
    Textures/
    Audio/
  Config/
    ScriptableObjects/
  Editor/
    Sdkwork.<ApplicationCode>.Unity.<Capability>.Editor.asmdef
  Tests/
    Sdkwork.<ApplicationCode>.Unity.<Capability>.Tests.asmdef
  specs/
```

Rules:

- `Runtime/Scripts/` owns `MonoBehaviour` thin adapters; `Runtime/Services/` owns plain C# services that call injected SDK clients or ports; `Runtime/State/` owns runtime state stores that clear sensitive state on logout/account switch.
- `Scenes/`, `Art/Prefabs/`, and `Config/ScriptableObjects/` are owned by exactly one package. Root `Assets/` must not contain business scenes or prefabs.
- `Config/ScriptableObjects/` may hold designer-authored content and non-secret tuning data only. Secrets, tokens, endpoints, and credentials are forbidden in assets; `ScriptableObject` assets containing API URLs must be generated from runtime config, not hand-authored per environment.
- `Editor/` code stays in the Editor asmdef and never ships in players.
- `Tests/` covers services (edit mode) and representative scene flows (play mode).
- Business assets must not use `Resources/` folders; content is addressed through direct package references, Addressables groups owned by the package, or scene references.

## 5. Dependency Direction

Allowed Assembly Definition reference flow:

```text
unity-core, unity-commons
  -> unity-shell, unity-console-core, unity-admin-core
  -> unity-console-shell, unity-admin-shell
  -> app/console/admin capability packages
  -> Assets/Scripts/Bootstrap (bootstrap scene wiring)
  -> unity-host implementations
```

Rules:

- `unity-core` and `unity-commons` asmdefs must not reference capability asmdefs.
- Capability services call injected SDK clients, repositories, or service ports; MonoBehaviours call services, never SDK clients directly.
- Platform/engine implementations live in `unity-host` or root bootstrap, not in feature scenes.
- Generated C# SDK assemblies are referenced through `unity-core` only; feature asmdefs must not reference generated SDK assemblies directly.
- Cyclic asmdef references are forbidden and fail compilation; the dependency direction above is enforced by the compiler, not by review alone.

## 6. SDK And IAM Integration

Rules:

- Unity app packages `MUST` consume `/app/v3/api` through generated C# app SDK clients or an approved appbase Unity wrapper.
- Unity admin packages, when approved as `backend-admin` surfaces, `MUST` consume `/backend/v3/api` through generated C# backend SDK clients or approved backend wrappers.
- `unity-core` adapts the generated C# SDK transport to Unity through one `UnityWebRequest`-based transport implementation; feature packages never construct HTTP clients.
- Runtime/bootstrap `MUST` construct generated SDK clients, appbase clients or wrappers, one global token-manager equivalent, token/context stores, and host adapters before shell/first-scene load.
- Tokens and refresh tokens are persisted only through the `secureStorage` host adapter (Keychain/Keystore-backed or equivalent). `PlayerPrefs`, plaintext files, and `StreamingAssets` are forbidden for tokens, secrets, and credentials.
- Appbase login/session behavior uses appbase app SDK resources or an approved Unity IAM adapter. Product packages must not create local auth/session endpoints.
- Missing SDK methods must be fixed in app-api/OpenAPI/generator inputs and regenerated; no raw `UnityWebRequest` business fallbacks, manual headers, or local DTO forks.
- Logout, refresh failure, and account/tenant switch must clear secure storage, token manager, context store, sensitive runtime state, and realtime/session bridges.

## 7. Unity Host Adapter Boundary

Standard Unity host adapter categories:

```text
secureStorage
platformLogin
storeAndPayment
pushNotifications
deepLinks
camera
microphone
haptics
clipboard
filePicker
shareSheet
networkStatus
appLifecycle
deviceInfo
screenAndWindow
permissions
```

Rules:

- Feature packages depend on host adapter interfaces, not engine/platform globals, static manager singletons, or third-party plugin APIs.
- Host adapters expose typed methods and stable errors such as `unsupported`, `permission-denied`, `unavailable`, `cancelled`, and `invalid-state`; per-target implementations must resolve for every shipped build target or fall back to `unsupported`.
- Deep links and store launches validate scheme/host/path, state, nonce, and expiry before completing sensitive flows.
- Store/payment bridges collect platform purchase facts only; entitlement and order state remain backend/app-api responsibilities validated through SDK calls.
- WebGL builds degrade gracefully: host adapters that cannot exist in the browser sandbox report `unsupported` instead of throwing.

## 8. Scene And Route Alignment

Rules:

- Unity scenes and addressable scene keys map to SDKWork route ids `<surface>.<domain>.<capability>.<screen>` when the same workflow exists in PC, H5, Flutter, mini program, or native roots.
- Scene route contributions declare `id`, `surface`, `domain`, `capability`, `screen`, `titleKey`, auth mode, permission hints, and the Unity scene key:

```csharp
public sealed record UnitySceneRoute(
    string Id,
    string Surface,
    string Domain,
    string Capability,
    string Screen,
    string TitleKey,
    string Auth,
    string SceneKey,
    string? PermissionHint = null);
```

- The bootstrap scene is the only fixed scene; shell navigation loads scenes/addresses through `SceneRoutes.cs` mapping route ids to scene keys.
- Deep links and platform launches resolve to route ids before scene loading.
- Route/scene metadata must not contain API URLs, SDK methods, tokens, or secrets.

## 9. Config, Build, And Release

Rules:

- The build selects exactly one `config/app/runtime-env.<deployment-profile>.<environment>.json`, validates its identity fields (`environment`, `deploymentProfile`, `profileId`, `runtimeTarget`), and projects it into `Assets/StreamingAssets/RuntimeConfig/` before the player build. Unity build targets, scripting backend (IL2CPP/Mono), and store channels remain separate axes.
- `config/host/` owns per-target bundle ids, signing reference names, and store metadata references; keystore/keymaterial files stay ignored or in CI secure storage.
- Release preflight must validate signing references, icons, screenshots, checksums/SBOM/provenance, store metadata, and secret absence in built players, including a scan proving no tokens/secrets reached `StreamingAssets` or ScriptableObjects.
- `sdkwork.app.config.json` uses `runtime.family = "mobile"` for app-store delivery, `"desktop"` for standalone delivery, `"web"` for WebGL, and `"mini-program"` for mini-game delivery, with `runtime.framework = "unity"`; `publish.platforms` lists only delivered values (`APP_ANDROID`, `APP_IOS`, `DESKTOP_*`, `WEB`, `MP_WEIXIN_GAME`, and so on).
- Mini-game delivery (WebGL converted to platform mini-game packages) additionally follows the platform package rules of `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md` section 10 for `MP_*_GAME` platforms, including platform package-size budgets.
- Unity version, render pipeline, and UPM dependency versions are pinned per root and recorded in release evidence.

## 10. Standard Commands

Unity roots should provide Unity CLI batch-mode equivalents and pnpm aliases:

```text
pnpm install
pnpm dev:standalone
pnpm dev:cloud
pnpm check:unity
pnpm test:unity
pnpm build:unity:android
pnpm build:unity:ios
pnpm build:unity:webgl
pnpm build:unity:windows
pnpm build:unity:staging
pnpm build:unity:prod
pnpm release:package:unity:runtime-configurable
pnpm test
pnpm test:config
```

Underlying runner form (internal detail):

```text
unity-editor -batchmode -nographics -projectPath . -runTests -testPlatform EditMode -testResults results.xml -quit
unity-editor -batchmode -nographics -projectPath . -executeMethod Sdkwork.Build.BuildPlayer -quit
```

Rules:

- `pnpm dev` is not a Unity editor replacement; it may open the editor with the selected runtime config materialized.
- Production build commands must run runtime-config projection, route/scene mapping validation, host adapter coverage checks for the selected targets, and secret scans before the player build.
- Package-level commands should allow focused edit-mode tests for changed packages.

## 11. Verification

Required verification for Unity architecture changes:

| Verification | Evidence |
| --- | --- |
| Root layout | Static check proves the root path uses `apps/sdkwork-<application-code>-unity/` and `.sdkwork/`, `config/app`, `config/host`, `Assets/Scripts/Bootstrap`, `Assets/Scenes/Bootstrap.unity`, `Packages/` UPM packages, `sdks/`, scripts, and tests exist. |
| Package naming | Static check proves UPM ids use `com.sdkwork.<application-code>-unity-*` with reserved core/commons/shell/console/admin/host roles and matching asmdef names. |
| Root thinness | Static scan proves root `Assets/` owns bootstrap/composition only and business scenes/systems live in packages. |
| Dependency direction | asmdef reference check proves core/commons never reference capabilities, features never reference generated SDK assemblies directly, and no cycles exist. |
| SDK boundary | Static scan proves generated C# SDK clients or approved wrappers are used through `unity-core`, with no raw `UnityWebRequest` business calls, manual auth headers, foreign-architecture wrappers, or generated SDK edits. |
| Secure storage | Tests prove tokens persist only through the `secureStorage` adapter and never through `PlayerPrefs`/plaintext/`StreamingAssets`. |
| IAM clearing | Tests prove secure storage, token manager, context store, sensitive state, and session bridges clear on logout/refresh failure/account switch. |
| Host boundary | Static scan proves feature scenes/services do not call engine/platform globals or third-party plugin APIs directly for host capabilities. |
| Route alignment | Tests prove scene/address keys map to shared route ids and align with cross-client route metadata where workflows match. |
| Config boundary | Tests prove exactly one validated runtime-env profile is projected per build and host config stays secret-free. |
| Release preflight | Checks validate signing references, store metadata, icons/screenshots, checksums/SBOM/provenance, and secret absence in build evidence. |

Acceptance checklist:

- [ ] Unity root uses `apps/sdkwork-<application-code>-unity/` and follows `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.
- [ ] Bootstrap scene and `Assets/Scripts/Bootstrap/` remain thin.
- [ ] UPM packages are split by core, commons, shell, capability, optional console/admin, and host roles with asmdef-enforced dependency direction.
- [ ] Generated C# SDKs and appbase Unity IAM wrapper are injected from core/bootstrap with one shared token-manager equivalent.
- [ ] Tokens persist only through secure storage; engine/platform behavior uses typed host adapters.
- [ ] Scene keys map to shared route ids where workflows match other client roots.
- [ ] Config, manifest, and release metadata are separated and secret-free.
- [ ] Unity edit-mode/play-mode tests or batch-mode equivalents pass for touched packages.
