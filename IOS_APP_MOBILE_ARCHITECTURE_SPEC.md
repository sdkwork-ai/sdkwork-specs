# iOS App Mobile Architecture Standard

- Version: 1.0
- Scope: SDKWork native iOS mobile application roots, Swift/Xcode/Swift Package package taxonomy, generated Swift app SDK integration, iOS host adapters, App Store/private distribution metadata, and cross-client route alignment
- Related: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APPLICATION_SPEC.md`, `NAMING_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `APP_MANIFEST_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `TEST_SPEC.md`

This standard defines the application-root architecture for SDKWork native iOS mobile apps. iOS roots follow the same client architecture alignment model as PC, H5, Flutter, mini program, native Android, and native HarmonyOS roots, but use Swift, Xcode, Swift Package Manager, generated Swift SDK clients, iOS host adapters, and Apple build/release tooling.

Use `APP_IOS_NATIVE_UI_SPEC.md` for detailed iOS UI package rules. This file owns the iOS application root, package taxonomy, config, host/platform boundary, commands, release, and architecture verification.

## 1. Core Model

```text
iOS native mobile root
  -> thin iOS app target
  -> Swift package families under packages/
  -> generated Swift app SDKs
  -> appbase iOS wrapper or generated appbase Swift app SDK
  -> one global token-manager equivalent
  -> typed iOS host adapters
  -> route contributions aligned by route id
```

Rules:

- An iOS native mobile root `MUST` use Swift-first app targets and Swift packages for reusable runtime, shell, capability, and host boundaries.
- New iOS UI should be SwiftUI-first. UIKit is allowed for migration, system interoperability, or embedded platform controllers, but it must stay package-local and behind the same UI/service/host boundaries.
- The root `App/` target `MUST` stay thin: app entry, scene/app delegate bridge when required, bootstrap, providers, shell assembly, route registry, SDK client construction, IAM runtime wiring, and host adapter registration.
- Business screens, views, view models/controllers, services, repositories, state, i18n/localization, and navigation metadata `MUST` live in packages.
- iOS packages `MUST` consume generated Swift app SDK clients or approved iOS appbase wrappers. They must not import TypeScript, React, Flutter, Kotlin, or ArkTS wrappers.
- iOS framework APIs and Apple capability calls `MUST` stay behind typed host adapters.
- Cross-client route identity follows `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.

## 2. Standard Root Layout

```text
apps/sdkwork-<application-code>-ios-mobile/
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
      ios.development.example.json
      ios.test.example.json
      ios.staging.example.json
      ios.production.example.json
    server/
      <application-code>.<deployment-profile>.<environment>.toml.example
    container/
      <application-code>.<deployment-profile>.<environment>.toml.example
  docs/
  scripts/
  sdks/
  specs/
  App/
    <Product>App.swift
    Bootstrap/
      Environment.swift
      Runtime.swift
      SdkClients.swift
      IamRuntime.swift
      HostAdapters.swift
      Routes.swift
    Providers/
    Shell/
    Routes/
    Resources/
      Info.plist
      Assets.xcassets/
      Localizable.xcstrings
  packages/
    sdkwork-<application-code>-ios-mobile-core/
    sdkwork-<application-code>-ios-mobile-commons/
    sdkwork-<application-code>-ios-mobile-shell/
    sdkwork-<application-code>-ios-mobile-<capability>/
    sdkwork-<application-code>-ios-mobile-console-core/
    sdkwork-<application-code>-ios-mobile-console-shell/
    sdkwork-<application-code>-ios-mobile-console-<capability>/
    sdkwork-<application-code>-ios-mobile-admin-core/
    sdkwork-<application-code>-ios-mobile-admin-shell/
    sdkwork-<application-code>-ios-mobile-admin-<capability>/
    sdkwork-<application-code>-ios-mobile-host/
  Tests/
  Package.swift
  <Product>.xcodeproj/
  <Product>.xcworkspace/
```

Rules:

- The root name `apps/sdkwork-<application-code>-ios-mobile` and package segment `ios-mobile` are canonical for native iOS phone roots. New iOS native roots `MUST NOT` use the shorter `apps/<application-code>-ios-mobile/` form.
- Package directories use SDKWork kebab-case names such as `sdkwork-<application-code>-ios-mobile-orders`.
- Swift target/module names cannot contain hyphens. They should use approved PascalCase target names such as `Sdkwork<Product>IosMobileOrders`, derived from the package directory identity.
- `config/app/` owns non-secret runtime templates consumed by iOS bootstrap.
- `config/host/` owns bundle id, minimum iOS version, entitlements references, associated domains, universal links, push profile references, signing reference names, Apple team/profile references, store profile references, and release metadata. It must not contain signing private keys or secrets.
- The root `App/` target is the installable iOS application and composition target. It must not own product business workflows.
- `packages/` owns Swift packages for runtime, shell, surface, capability, and host packages.
- `sdks/` follows `SDK_WORKSPACE_GENERATION_SPEC.md` and must not contain hand-edited generated output.
- iOS roots that publish app manifests use `runtime.family = "mobile"` and `runtime.framework = "ios-native"`.

## 3. Package Taxonomy

| Package family | Owns | Must not own |
| --- | --- | --- |
| `sdkwork-<application-code>-ios-mobile-core` | runtime config, SDK factories, token-manager equivalent, appbase IAM runtime/wrapper, session/context stores, route registry, host adapter contracts | screens, views, business workflows |
| `sdkwork-<application-code>-ios-mobile-commons` | domain-neutral SwiftUI/UIKit primitives, theme adapters, design tokens, form/list/error primitives, localization helpers | business screens, SDK construction |
| `sdkwork-<application-code>-ios-mobile-shell` | app shell, navigation stack/tab/sheet assembly, AuthGate integration, app route composition | business services |
| `sdkwork-<application-code>-ios-mobile-<capability>` | screens, views, view models/controllers, services, repositories, state, localization, route contributions, models | concrete SDK construction, unrelated capabilities |
| `sdkwork-<application-code>-ios-mobile-console-*` | approved user-facing mobile console workflows through app-api | internal operator workflows |
| `sdkwork-<application-code>-ios-mobile-admin-*` | approved internal operator workflows through backend-api | app user login/session creation |
| `sdkwork-<application-code>-ios-mobile-host` | iOS platform adapters for camera, QR, keychain, push, deep links, files, lifecycle, device features | business API transport, business authorization |

Rules:

- New iOS packages `MUST` be split by domain/capability and must not become catch-all mobile business modules.
- Packages without `ios-mobile-console` or `ios-mobile-admin` are default iOS app/user packages.
- `sdkwork-<application-code>-ios-mobile-console-<capability>` packages are the user-facing iOS management console family. They follow the same package-internal shape as default iOS capability packages and consume app-api through generated Swift app SDK clients or approved iOS appbase wrappers.
- `sdkwork-<application-code>-ios-mobile-admin-<capability>` packages are approved internal operations admin packages and map to `backend-admin`; they must consume backend-api through generated Swift backend SDK clients or approved backend wrappers.
- The `<capability>` segment is the concrete business module token. It `MUST` use lower kebab-case in SDKWork package directories, derive legal Swift target/module names, and `MUST NOT` be a placeholder such as `console`, `admin`, `manager`, `backend`, `common`, or `misc`.
- Console and admin package families are optional. Mobile admin packages require explicit governance approval, `backend-admin` surface classification, and backend SDK boundary verification.
- Shared UI primitives remain domain-neutral unless they live inside the owning capability package.
- iOS packages may share route ids, i18n keys, design tokens, SDK port contracts, and service contracts with other client roots, but must not import another architecture's UI/runtime implementation.

## 4. Package Internal Shape

```text
packages/sdkwork-<application-code>-ios-mobile-<capability>/
  Package.swift
  README.md
  Sources/
    Sdkwork<Product>IosMobile<Capability>/
      PublicApi.swift
      Screens/
      Components/
      Presentation/
        ViewModels/
        Controllers/
      Services/
      Repositories/
      State/
      I18n/
      Routes/
      Navigation/
      Host/
      Models/
      Resources/
  Tests/
    Sdkwork<Product>IosMobile<Capability>Tests/
  specs/
```

Rules:

- `PublicApi.swift` or equivalent package root exports define the public integration boundary.
- `Screens/` owns route-level UI. `Components/` owns reusable or domain-specific UI components.
- `Presentation/` owns view models, controllers, intents, effects, and UI state mapping.
- `I18n/`, `Resources/`, and platform localization files own package-local locale fragments. Platform monolithic resources must be generated or assembled from fragments and must not be hand-authored whole-root catalogs; follow `I18N_SPEC.md`.
- `Services/` owns use-case orchestration and calls injected generated SDK clients, repositories, or service ports.
- `Repositories/` may own thin generated SDK adapter calls when repository naming is used. It must not become a local persistence layer unless a local offline contract is explicitly approved.
- `Models/` owns view models, screen models, and route params. API DTOs come from generated Swift SDKs.
- `Host/` owns host adapter interfaces used by the package, not iOS framework implementations.

## 5. Dependency Direction

Allowed flow:

```text
ios-mobile-core, ios-mobile-commons
  -> ios-mobile-shell, ios-mobile-console-core, ios-mobile-admin-core
  -> ios-mobile-console-shell, ios-mobile-admin-shell
  -> app/console/admin capability packages
  -> root App composition target
  -> ios-mobile-host
```

Rules:

- iOS UI must not construct SDK clients or read runtime env directly.
- View models/controllers call services. Services call injected generated SDK clients, repositories, or service ports.
- iOS platform implementations live in the host package or root bootstrap, not in feature UI.
- Cross-package imports use public package/module exports, not another package's private source paths.
- Cyclic Swift package or Xcode target dependencies are forbidden.

## 6. SDK And IAM Integration

Rules:

- iOS app packages `MUST` consume `/app/v3/api` through generated Swift app SDK clients or approved iOS appbase wrappers.
- iOS admin packages, when approved as `backend-admin` surfaces, `MUST` consume `/backend/v3/api` through generated Swift backend SDK clients or approved backend wrappers.
- Runtime/bootstrap `MUST` construct generated Swift SDK clients, appbase SDK clients or wrappers, a global token-manager equivalent, token/context stores, and iOS host adapters before feature services are initialized.
- The global token-manager equivalent must be shared by appbase app SDK, every authenticated application/dependency app-api SDK client, and explicit `backend-admin` appbase backend/application backend/dependency backend SDK clients.
- Missing Swift SDK methods must be fixed in OpenAPI/generator inputs and regenerated. iOS packages must not fill gaps with raw URLSession calls, manual headers, copied TypeScript/Flutter/Kotlin wrappers, or local DTO forks.
- Logout and refresh failure must clear keychain/secure storage, token manager, context store, sensitive iOS state, and realtime/session bridges.

## 7. iOS Host Adapter Boundary

Standard iOS host adapter categories:

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
universalLinks
```

Rules:

- Feature packages depend on host adapter interfaces, not iOS framework APIs, UIKit/AppKit globals, notification center globals, or SDK singleton globals.
- Host adapters must expose stable user-safe errors such as `unsupported`, `permission-denied`, `unavailable`, `cancelled`, and `invalid-state`.
- Deep-link and universal-link callbacks must validate scheme, host, path, state, nonce, and expiry before completing sensitive flows.
- Push token registration is an app-api workflow. Host adapters only obtain platform token facts and permission state.
- File/media upload uses Drive app SDK or approved Drive uploader facades. Host adapters may pick files or capture media but do not own Drive/storage lifecycle.

## 8. Route Alignment

Rules:

- iOS navigation routes `MUST` map to SDKWork route ids when the same workflow exists in PC, H5, Flutter, mini program, native Android, or native HarmonyOS roots.
- Route contributions must declare `id`, `surface`, `domain`, `capability`, `screen`, `titleKey`, auth mode, and permission hints.
- iOS physical navigation destinations may differ from other platforms, but route ids and localization keys should align.
- Deep links and universal links should resolve to route ids before being converted into iOS navigation actions.
- Route metadata must not contain API URLs, SDK methods, access tokens, app secrets, signing secrets, or Apple private keys.

## 9. Config, Build, And Release

Rules:

- iOS root config separates lifecycle environment, build mode, deployment
  profile, and runtime target according to `CONFIG_SPEC.md`.
- Native iOS runtime env materializes as
  `config/app/runtime-env.<deploymentProfile>.<environment>.json` and declares
  matching `environment`, `deploymentProfile`, `profileId`, and
  `runtimeTarget=ios-native`. Xcode scheme/configuration, simulator/device,
  bundle id, signing identity, and store channel remain separate axes.
- The build validates and packages exactly one selected non-secret runtime JSON
  resource. User `.xcconfig`, provisioning profiles, certificates, private
  keys, and developer overrides stay ignored or in Apple/CI secure storage.
- `config/app/` and `config/host/` examples must be safe checked-in templates only.
- iOS bundle id, minimum supported iOS version, entitlements, permissions, associated domains, universal links, push environment, signing reference names, Apple team/profile references, and store profile references belong to host config or Xcode project templates.
- Host config must not contain signing private keys, auth tokens, refresh tokens, API keys, database credentials, private service endpoints, SDK ownership, or business route constants.
- `sdkwork.app.config.json` must include App Store/TestFlight/private distribution metadata, icons, screenshots, package ids, checksums where applicable, signing metadata references, SBOM/provenance, and release notes.
- Publish platform should be `APP_IOS` for iOS-only native roots. Generic `APP` or `APP_PLUS` may be listed only when the product actually supports a broader mobile app family.

## 10. Standard Commands

iOS native roots should provide equivalents for:

```text
swift test
xcodebuild -scheme <Product> -configuration Debug build
xcodebuild -scheme <Product> -configuration Release archive
xcodebuild -exportArchive
```

Application roots may expose stable aliases when the package manager or repository tooling orchestrates iOS:

```text
pnpm install
pnpm dev:standalone
pnpm dev:cloud
pnpm dev:ios-native:standalone
pnpm dev:ios-native:cloud
pnpm check:ios-native
pnpm test:ios-native
pnpm build:ios-native:debug
pnpm build:ios-native:release
pnpm release:package:ios-native:runtime-configurable
pnpm test
pnpm test:config
```

Rules:

- Production build commands must run config, SDK boundary, manifest, media, signing-reference, and secret preflight before packaging.
- Standalone variants consume the application-owned standalone gateway at its
  declared private/LAN/appliance endpoint; iOS clients do not implicitly launch
  an on-device gateway. Cloud variants use deployed application and platform
  API surface URLs, start no local gateway or data service, and do not identify
  the remote gateway implementation.
- Runtime-configurable IPA/App Store packages may support both profiles with
  isolated credentials and endpoint namespaces. Endpoint selection alone must
  not produce duplicate signed binaries.
- iOS builds require macOS, Xcode, Apple signing tooling, and a documented signing/release profile.
- Package-level commands should allow focused Swift tests for changed packages.

## 11. Verification

Required verification for iOS native architecture changes:

| Verification | Evidence |
| --- | --- |
| Root layout | Static check proves the root path uses `apps/sdkwork-<application-code>-ios-mobile/` and `.sdkwork/`, `config/app`, `config/host`, root `App` bootstrap, `packages/`, `sdks/`, `scripts/`, Xcode/SPM files, and tests exist. |
| Package naming | Static check proves iOS packages use `sdkwork-<application-code>-ios-mobile-*` and reserved console/admin/host forms. |
| Root thinness | Static scan proves root `App/` owns bootstrap/composition only and business features live in packages. |
| SDK boundary | Static scan proves generated Swift SDK clients are injected and no raw HTTP, manual auth headers, TypeScript/Flutter/Kotlin/ArkTS wrapper imports, or generated SDK edits were introduced. |
| IAM clearing | Tests prove token manager, context store, keychain/secure storage, sensitive state, and realtime/session bridges clear on logout and refresh failure. |
| Host boundary | Static scan proves feature packages do not call iOS framework/platform APIs directly for host capabilities. |
| Route alignment | Tests or static checks prove iOS route ids align with cross-client route identity. |
| UI states | UI tests cover loading, success, empty, validation-error, permission-denied, offline/unavailable, and unknown-error states for representative screens. |
| Release preflight | Checks validate iOS package metadata, icons, screenshots, signing references, checksums/SBOM/provenance, App Store/TestFlight/private distribution metadata, and secret absence. |

Acceptance checklist:

- [ ] iOS root uses `apps/sdkwork-<application-code>-ios-mobile/` and follows `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.
- [ ] Root `App/` remains thin.
- [ ] Packages are split by core, commons, shell, capability, optional console/admin, and host roles.
- [ ] Generated Swift SDKs and appbase iOS IAM runtime/wrapper are injected from bootstrap/core.
- [ ] iOS platform behavior uses typed host adapters.
- [ ] Route ids align with other client architectures where workflows match.
- [ ] Config, manifest, and release metadata are separated and secret-free.
- [ ] Swift/Xcode test/build or package equivalents pass for touched packages.
