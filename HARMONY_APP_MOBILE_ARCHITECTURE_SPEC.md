# Harmony App Mobile Architecture Standard

- Version: 1.0
- Scope: SDKWork native HarmonyOS mobile application roots, ArkTS/ArkUI package taxonomy, generated ArkTS/TypeScript app SDK integration, HarmonyOS host adapters, AppGallery/private distribution metadata, and cross-client route alignment
- Related: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APPLICATION_SPEC.md`, `NAMING_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `APP_MANIFEST_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `TEST_SPEC.md`

This standard defines the application-root architecture for SDKWork native HarmonyOS mobile apps. Harmony roots follow the same client architecture alignment model as PC, H5, Flutter, mini program, native Android, and native iOS roots, but use ArkTS, ArkUI, DevEco Studio, ohpm/hvigor, HAR/HAP-style modules, generated ArkTS/TypeScript SDK clients adapted for Harmony runtime, HarmonyOS host adapters, and HarmonyOS build/release tooling.

Use `APP_HARMONY_NATIVE_UI_SPEC.md` for detailed Harmony native UI package rules. This file owns the HarmonyOS application root, package taxonomy, config, host/platform boundary, commands, release, and architecture verification.

## 1. Core Model

```text
Harmony native mobile root
  -> thin Harmony entry module
  -> ArkTS/HAR package families under packages/
  -> generated ArkTS/TypeScript app SDKs adapted for Harmony runtime
  -> appbase Harmony wrapper or approved appbase ArkTS adapter
  -> one global token-manager equivalent
  -> typed HarmonyOS host adapters
  -> route contributions aligned by route id
```

Rules:

- A Harmony native mobile root `MUST` use ArkTS-first Harmony modules for reusable runtime, shell, capability, and host boundaries.
- New Harmony UI should be ArkUI-first. Native components or platform-specific bridges are allowed for system interoperability, but they must stay package-local and behind the same UI/service/host boundaries.
- The root `entry/` module `MUST` stay thin: entry ability, bootstrap, provider assembly, route/page registry, SDK client construction, IAM runtime wiring, and host adapter registration.
- Business pages, components, view models/controllers, services, repositories, state, i18n/resources, and navigation metadata `MUST` live in packages.
- Harmony packages `MUST` consume generated ArkTS/TypeScript app SDK clients adapted for Harmony runtime or approved Harmony appbase wrappers. They must not import React browser wrappers, Flutter wrappers, Kotlin wrappers, or Swift wrappers.
- HarmonyOS system APIs and device capability calls `MUST` stay behind typed host adapters.
- Cross-client route identity follows `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.

## 2. Standard Root Layout

```text
apps/sdkwork-<application-code>-harmony-mobile/
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
      harmony.development.example.json
      harmony.test.example.json
      harmony.staging.example.json
      harmony.production.example.json
    server/
      <application-code>.<deployment-profile>.<environment>.toml.example
    container/
      <application-code>.<deployment-profile>.<environment>.toml.example
  docs/
  scripts/
  sdks/
  specs/
  AppScope/
  entry/
    oh-package.json5
    build-profile.json5
    src/
      main/
        module.json5
        ets/
          entryability/
            EntryAbility.ets
          bootstrap/
            Environment.ets
            Runtime.ets
            SdkClients.ets
            IamRuntime.ets
            HostAdapters.ets
            Routes.ets
          providers/
          shell/
          routes/
          pages/
            __generated__/
      ohosTest/
  packages/
    sdkwork-<application-code>-harmony-mobile-core/
    sdkwork-<application-code>-harmony-mobile-commons/
    sdkwork-<application-code>-harmony-mobile-shell/
    sdkwork-<application-code>-harmony-mobile-<capability>/
    sdkwork-<application-code>-harmony-mobile-console-core/
    sdkwork-<application-code>-harmony-mobile-console-shell/
    sdkwork-<application-code>-harmony-mobile-console-<capability>/
    sdkwork-<application-code>-harmony-mobile-admin-core/
    sdkwork-<application-code>-harmony-mobile-admin-shell/
    sdkwork-<application-code>-harmony-mobile-admin-<capability>/
    sdkwork-<application-code>-harmony-mobile-host/
  tests/
  oh-package.json5
  build-profile.json5
  hvigorfile.ts
  hvigor/
```

Rules:

- The root name `apps/sdkwork-<application-code>-harmony-mobile` and package segment `harmony-mobile` are canonical for native HarmonyOS phone roots. New HarmonyOS native roots `MUST NOT` use the shorter `apps/<application-code>-harmony-mobile/` form.
- Package directories use SDKWork kebab-case names such as `sdkwork-<application-code>-harmony-mobile-orders`.
- ohpm package ids or import aliases may use an approved registry scope, but they must preserve the `sdkwork-<application-code>-harmony-mobile-*` identity in package metadata and component specs.
- ArkTS namespaces and import aliases must use legal identifiers derived from the package directory identity and must not hide the SDKWork package role.
- `config/app/` owns non-secret runtime templates consumed by Harmony bootstrap.
- `config/host/` owns Harmony bundle id/app id, module metadata, device types, permissions, app links, push profile references, signing reference names, AppGallery/private distribution references, and release metadata. It must not contain signing private keys or secrets.
- The root `entry/` module is the installable Harmony application entry and composition module. It must not own product business workflows.
- `packages/` owns ArkTS/HAR-style modules for runtime, shell, surface, capability, and host packages.
- `entry/src/main/ets/pages/__generated__/` is a projection target when route/page generation exists. Application business code should remain in packages.
- `sdks/` follows `SDK_WORKSPACE_GENERATION_SPEC.md` and must not contain hand-edited generated output.
- Harmony roots that publish app manifests use `runtime.family = "mobile"` and `runtime.framework = "harmony-native"`.

## 3. Package Taxonomy

| Package family | Owns | Must not own |
| --- | --- | --- |
| `sdkwork-<application-code>-harmony-mobile-core` | runtime config, SDK factories, token-manager equivalent, appbase IAM runtime/wrapper, session/context stores, route registry, host adapter contracts | pages, components, business workflows |
| `sdkwork-<application-code>-harmony-mobile-commons` | domain-neutral ArkUI components, theme adapters, design tokens, form/list/error primitives, i18n/resource helpers | business pages, SDK construction |
| `sdkwork-<application-code>-harmony-mobile-shell` | app shell, navigation/page stack assembly, AuthGate integration, app route composition | business services |
| `sdkwork-<application-code>-harmony-mobile-<capability>` | pages, components, view models/controllers, services, repositories, state, i18n, route contributions, models | concrete SDK construction, unrelated capabilities |
| `sdkwork-<application-code>-harmony-mobile-console-*` | approved user-facing mobile console workflows through app-api | internal operator workflows |
| `sdkwork-<application-code>-harmony-mobile-admin-*` | approved internal operator workflows through backend-api | app user login/session creation |
| `sdkwork-<application-code>-harmony-mobile-host` | HarmonyOS platform adapters for camera, QR, secure storage, push, deep links, files, lifecycle, device features | business API transport, business authorization |

Rules:

- New Harmony packages `MUST` be split by domain/capability and must not become catch-all mobile business modules.
- Packages without `harmony-mobile-console` or `harmony-mobile-admin` are default Harmony app/user packages.
- `sdkwork-<application-code>-harmony-mobile-console-<capability>` packages are the user-facing Harmony management console family. They follow the same package-internal shape as default Harmony capability packages and consume app-api through generated ArkTS/TypeScript app SDK clients or approved Harmony appbase wrappers.
- `sdkwork-<application-code>-harmony-mobile-admin-<capability>` packages are approved internal operations admin packages and map to `backend-admin`; they must consume backend-api through generated Harmony-compatible backend SDK clients or approved backend wrappers.
- The `<capability>` segment is the concrete business module token. It `MUST` use lower kebab-case in SDKWork package directories, preserve legal ohpm/ArkTS module identities, and `MUST NOT` be a placeholder such as `console`, `admin`, `manager`, `backend`, `common`, or `misc`.
- Console and admin package families are optional. Mobile admin packages require explicit governance approval, `backend-admin` surface classification, and backend SDK boundary verification.
- Shared UI primitives remain domain-neutral unless they live inside the owning capability package.
- Harmony packages may share route ids, i18n keys, design tokens, SDK port contracts, and service contracts with other client roots, but must not import another architecture's UI/runtime implementation.

## 4. Package Internal Shape

```text
packages/sdkwork-<application-code>-harmony-mobile-<capability>/
  oh-package.json5
  build-profile.json5
  README.md
  src/
    main/
      module.json5
      ets/
        Index.ets
        pages/
        components/
        presentation/
          viewModels/
          controllers/
        services/
        repositories/
        state/
        i18n/
        routes/
        navigation/
        host/
        models/
    ohosTest/
  tests/
  specs/
```

Rules:

- `Index.ets` or equivalent package root export file is the public integration boundary.
- `pages/` owns route-level UI. `components/` owns reusable or domain-specific UI components.
- `presentation/` owns view models, controllers, intents, effects, and UI state mapping.
- `services/` owns use-case orchestration and calls injected generated SDK clients, repositories, or service ports.
- `repositories/` may own thin generated SDK adapter calls when repository naming is used. It must not become a local persistence layer unless a local offline contract is explicitly approved.
- `i18n/` and Harmony resource files own package-local locale fragments. Platform monolithic resources must be generated or assembled from fragments and must not be hand-authored whole-root catalogs; follow `I18N_SPEC.md`.
- `models/` owns view models, screen models, and route params. API DTOs come from generated ArkTS/TypeScript SDKs.
- `host/` owns host adapter interfaces used by the package, not HarmonyOS system API implementations.

## 5. Dependency Direction

Allowed flow:

```text
harmony-mobile-core, harmony-mobile-commons
  -> harmony-mobile-shell, harmony-mobile-console-core, harmony-mobile-admin-core
  -> harmony-mobile-console-shell, harmony-mobile-admin-shell
  -> app/console/admin capability packages
  -> root entry composition module
  -> harmony-mobile-host
```

Rules:

- Harmony UI must not construct SDK clients or read runtime env directly.
- View models/controllers call services. Services call injected generated SDK clients, repositories, or service ports.
- HarmonyOS platform implementations live in the host package or root bootstrap, not in feature UI.
- Cross-package imports use public package/module exports, not another package's private source paths.
- Cyclic ohpm/hvigor dependencies are forbidden.

## 6. SDK And IAM Integration

Rules:

- Harmony app packages `MUST` consume `/app/v3/api` through generated ArkTS/TypeScript app SDK clients adapted for Harmony runtime or approved Harmony appbase wrappers.
- Harmony admin packages, when approved as `backend-admin` surfaces, `MUST` consume `/backend/v3/api` through generated ArkTS/TypeScript backend SDK clients or approved backend wrappers.
- Runtime/bootstrap `MUST` construct generated SDK clients, appbase SDK clients or wrappers, a global token-manager equivalent, token/context stores, and HarmonyOS host adapters before feature services are initialized.
- The global token-manager equivalent must be shared by appbase app SDK, every authenticated application/dependency app-api SDK client, and explicit `backend-admin` appbase backend/application backend/dependency backend SDK clients.
- Missing Harmony SDK methods must be fixed in OpenAPI/generator inputs and regenerated. Harmony packages must not fill gaps with raw request APIs, manual headers, copied React/Flutter/Kotlin/Swift wrappers, or local DTO forks.
- Logout and refresh failure must clear secure platform storage, token manager, context store, sensitive Harmony state, and realtime/session bridges.

## 7. HarmonyOS Host Adapter Boundary

Standard HarmonyOS host adapter categories:

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
permissions
wantBridge
```

Rules:

- Feature packages depend on host adapter interfaces, not HarmonyOS system APIs, global ability context, direct want handling, or SDK singleton globals.
- Host adapters must expose stable user-safe errors such as `unsupported`, `permission-denied`, `unavailable`, `cancelled`, and `invalid-state`.
- Deep-link/want callbacks must validate scheme, host, path, state, nonce, and expiry before completing sensitive flows.
- Push token registration is an app-api workflow. Host adapters only obtain platform token facts and permission state.
- File/media upload uses Drive app SDK or approved Drive uploader facades. Host adapters may pick files or capture media but do not own Drive/storage lifecycle.

## 8. Route Alignment

Rules:

- Harmony navigation routes/pages `MUST` map to SDKWork route ids when the same workflow exists in PC, H5, Flutter, mini program, native Android, or native iOS roots.
- Route contributions must declare `id`, `surface`, `domain`, `capability`, `screen`, `titleKey`, auth mode, and permission hints.
- Harmony physical page paths may differ from other platforms, but route ids and i18n keys should align.
- Deep links and wants should resolve to route ids before being converted into Harmony navigation actions.
- Route metadata must not contain API URLs, SDK methods, access tokens, app secrets, signing secrets, or Harmony private keys.

## 9. Config, Build, And Release

Rules:

- Harmony root config separates lifecycle environment, build mode, deployment
  profile, and runtime target according to `CONFIG_SPEC.md`.
- Native HarmonyOS runtime env materializes as
  `config/app/runtime-env.<deploymentProfile>.<environment>.json` and declares
  matching `environment`, `deploymentProfile`, `profileId`, and
  `runtimeTarget=harmony-native`. hvigor product/build mode, device type,
  bundle/module id, signing profile, and store channel remain separate axes.
- The build validates and projects exactly one selected non-secret runtime JSON
  resource. Signing files, private keys, profile credentials, and developer
  overrides stay ignored or in DevEco/CI secure storage.
- `config/app/` and `config/host/` examples must be safe checked-in templates only.
- Harmony bundle id/app id, module ids, supported device types, permissions, app links, push environment, signing reference names, AppGallery/private distribution references, and store profile references belong to host config or platform templates.
- Host config must not contain signing private keys, auth tokens, refresh tokens, API keys, database credentials, private service endpoints, SDK ownership, or business route constants.
- `sdkwork.app.config.json` must include AppGallery/private distribution metadata, icons, screenshots, package ids, checksums where applicable, signing metadata references, SBOM/provenance, and release notes.
- Publish platform should be `APP_HARMONY` for Harmony-only native roots. Generic `APP` or `APP_PLUS` may be listed only when the product actually supports a broader mobile app family.
- Until `APP_MANIFEST_SPEC.md` and backend package format enums define Harmony-specific package formats, Harmony direct packages should use `OTHER` with explicit package metadata describing the HAP/APP artifact kind.

## 10. Standard Commands

Harmony native roots should provide equivalents for:

```text
ohpm install
hvigor clean
hvigor assembleHap
hvigor assembleApp
hvigor test
```

Application roots may expose stable aliases when the package manager or repository tooling orchestrates Harmony:

```text
pnpm install
pnpm dev:standalone
pnpm dev:cloud
pnpm dev:harmony-native:standalone
pnpm dev:harmony-native:cloud
pnpm check:harmony-native
pnpm test:harmony-native
pnpm build:harmony-native:debug
pnpm build:harmony-native:release
pnpm release:package:harmony-native:runtime-configurable
pnpm test
pnpm test:config
```

Rules:

- Production build commands must run config, SDK boundary, manifest, media, signing-reference, and secret preflight before packaging.
- Standalone variants consume the application-owned standalone gateway at its
  declared private endpoint; cloud variants use deployed application and
  platform API surface URLs, start no local gateway or data service, and do
  not identify the remote gateway implementation.
- Harmony builds require DevEco Studio or compatible HarmonyOS SDK/hvigor/ohpm tooling and a documented signing/release profile.
- Package-level commands should allow focused tests/static checks for changed modules.

## 11. Verification

Required verification for Harmony native architecture changes:

| Verification | Evidence |
| --- | --- |
| Root layout | Static check proves the root path uses `apps/sdkwork-<application-code>-harmony-mobile/` and `.sdkwork/`, `config/app`, `config/host`, root `entry` bootstrap, `packages/`, `sdks/`, `scripts/`, ohpm/hvigor files, and tests exist. |
| Package naming | Static check proves Harmony packages use `sdkwork-<application-code>-harmony-mobile-*` and reserved console/admin/host forms. |
| Root thinness | Static scan proves root `entry/` owns bootstrap/composition only and business features live in packages. |
| SDK boundary | Static scan proves generated ArkTS/TypeScript SDK clients are injected and no raw request APIs, manual auth headers, React/Flutter/Kotlin/Swift wrapper imports, or generated SDK edits were introduced. |
| IAM clearing | Tests prove token manager, context store, secure storage, sensitive state, and realtime/session bridges clear on logout and refresh failure. |
| Host boundary | Static scan proves feature packages do not call HarmonyOS system/platform APIs directly for host capabilities. |
| Route alignment | Tests or static checks prove Harmony route ids align with cross-client route identity. |
| UI states | UI tests cover loading, success, empty, validation-error, permission-denied, offline/unavailable, and unknown-error states for representative screens. |
| Release preflight | Checks validate Harmony package metadata, icons, screenshots, signing references, checksums/SBOM/provenance, AppGallery/private distribution metadata, and secret absence. |

Acceptance checklist:

- [ ] Harmony root uses `apps/sdkwork-<application-code>-harmony-mobile/` and follows `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.
- [ ] Root `entry/` remains thin.
- [ ] Packages are split by core, commons, shell, capability, optional console/admin, and host roles.
- [ ] Generated ArkTS/TypeScript SDKs and appbase Harmony IAM runtime/wrapper are injected from bootstrap/core.
- [ ] HarmonyOS platform behavior uses typed host adapters.
- [ ] Route ids align with other client architectures where workflows match.
- [ ] Config, manifest, and release metadata are separated and secret-free.
- [ ] Harmony tests/build or package equivalents pass for touched packages.
