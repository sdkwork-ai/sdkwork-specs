# Configuration And Environment Standard

- Version: 1.2
- Scope: environment config, SDK client initialization, secrets, feature flags, typed runtime config, dev/test/staging/prod profiles, desktop/server/container/web/H5/Flutter/mini-program/native Android/native iOS/native Harmony switching
- Related: `SOURCE_CONFIG_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `ENVIRONMENT_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `DEPLOYMENT_SPEC.md`, `REGION_SPEC.md`, `SDK_SPEC.md`, `SECURITY_SPEC.md`, `APPLICATION_SPEC.md`, `APP_MANIFEST_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `DESKTOP_APP_ARCHITECTURE_SPEC.md`, `I18N_SPEC.md`

This standard defines how applications select environment, deployment profile,
runtime target, base URLs, SDK clients, token storage, and feature flags without
leaking those decisions into reusable modules.

## 1. Configuration Sources

Allowed config sources:

| Source | Use |
| --- | --- |
| app manifest | App identity, runtime family, release/distribution metadata |
| source `etc/` | Safe environment/profile instances, SDK Base URLs, bind/public URLs, browser bootstrap inputs, and server/gateway templates |
| environment variables | Explicit deployment/container overrides for safe values; not the primary checked-in topology authority |
| secret manager / secure storage | Secrets, tokens, private keys, signing credentials |
| bootstrap file | Local development defaults and app shell wiring |
| server config | Java/Rust service process settings |
| platform config | Tauri/native target packaging metadata, permissions, capabilities, signing references |

Rules:

- Shared modules `MUST NOT` read process env, `.env` files, local storage, registry, or native config directly.
- Shared modules receive typed config from runtime/bootstrap.
- Every independently deployable root owns source-controlled `etc/` according to `SOURCE_CONFIG_SPEC.md`.
- Concrete environment URLs, ports, topology values, database targets, and Redis targets `MUST NOT`
  be stored in `sdkwork.app.config.json`; they belong to the selected source `etc/` profile.
- Repository-root `configs/` is retired for runtime/deployment configuration. New config instances
  use `etc/`; infrastructure descriptors remain under `deployments/`.
- Secrets `MUST NOT` be stored in app manifests or committed config files.
- Standalone/cloud differences `MUST` be represented as typed
  `deploymentProfile`, not scattered conditionals.
- Lifecycle environment, deployment profile, and runtime target `MUST` be
  represented as separate typed fields. A single `NODE_ENV`, Vite mode, Spring
  profile, Tauri target, or container image name must not be used as the whole
  runtime decision model.
- Public development commands select normalized runtime config rather than
  defining a parallel mode axis. `dev:standalone` materializes
  `standalone.development`; `dev:cloud` materializes `cloud.development`.
  Values such as `remote`, `local-api`, `saas`, or `apiMode` must not duplicate
  `deploymentProfile`.
- A local client using `cloud.development` reports the cloud deployment profile
  of the API topology it consumes while preserving its own exact local
  `runtimeTarget`. Release/package metadata remains governed by the target
  consistency matrix and is not inferred from the development command.
- Source/build dependency paths in package, workspace, SDK, or tool config `MUST` follow `DEPENDENCY_MANAGEMENT_SPEC.md` and must not use machine-specific absolute paths.

## 2. Standard Runtime Config

```ts
export type SdkworkEnvironment = "development" | "test" | "staging" | "demo" | "production";
export type SdkworkConfigProfile = "dev" | "test" | "staging" | "prod";
export type SdkworkBuildMode = "development" | "test" | "staging" | "demo" | "production";
export type SdkworkDeploymentProfile = "standalone" | "cloud";
export type SdkworkBrowserOriginMode = "same-origin" | "cross-origin";
export type SdkworkGatewayPlacement =
  | "local-child-process"
  | "embedded"
  | "private-host"
  | "remote-managed";
export type SdkworkRuntimeTarget =
  | "browser"
  | "desktop"
  | "tablet-ipados"
  | "tablet-android"
  | "capacitor-ios"
  | "capacitor-android"
  | "flutter-ios"
  | "flutter-android"
  | "android-native"
  | "ios-native"
  | "harmony-native"
  | "mini-program"
  | "server"
  | "container"
  | "test-runner";

export interface SdkworkRuntimeConfig {
  environment: SdkworkEnvironment;
  profileId: `${SdkworkDeploymentProfile}.${SdkworkEnvironment}`;
  configProfile?: SdkworkConfigProfile;
  buildMode?: SdkworkBuildMode;
  deploymentProfile: SdkworkDeploymentProfile;
  runtimeTarget: SdkworkRuntimeTarget;
  targetPlatform?: string;
  clientArchitecture?: string;
  browserOriginMode?: SdkworkBrowserOriginMode;
  gatewayPlacement?: SdkworkGatewayPlacement;
  openApiBaseUrl?: string;
  appApiBaseUrl: string;
  backendApiBaseUrl?: string;
  sdkBaseUrls?: SdkworkSdkBaseUrlConfig;
  dependencyApiSurfaces?: SdkworkDependencyApiSurfaceConfig[];
  dependencyApiExports?: SdkworkDependencyApiExportConfig[];
  auth?: SdkworkAuthRuntimeConfig;
  i18n?: SdkworkI18nRuntimeConfig;
  publicRuntime?: SdkworkPublicRuntimeConfig;
  server?: SdkworkServerConfig;
  desktop?: SdkworkDesktopConfig;
  tablet?: SdkworkTabletConfig;
  mobile?: SdkworkMobileConfig;
  miniProgram?: SdkworkMiniProgramConfig;
  paths?: SdkworkRuntimePaths;
  database?: SdkworkDatabaseConfig;
  redis?: SdkworkRedisConfig;
  appKey: string;
  featureFlags?: Record<string, boolean | string | number>;
}

export interface SdkworkSdkBaseUrlConfig {
  sdkBaseUrl?: string;
  defaultApiBaseUrl?: string;
  openApiBaseUrl?: string;
  appApiBaseUrl: string;
  backendApiBaseUrl?: string;
  dependencySdkBaseUrls?: Record<string, SdkworkDependencySdkBaseUrls>;
}

export interface SdkworkDependencySdkBaseUrls {
  openApiBaseUrl?: string;
  appApiBaseUrl?: string;
  backendApiBaseUrl?: string;
}

export interface SdkworkDependencyApiSurfaceConfig {
  workspace: string;
  sdkFamily: string;
  apiAuthority: string;
  surface: "open-api" | "app-api" | "backend-api";
  apiPrefix: string | null;
  runtimeMode: "same-origin" | "external-service" | "not-mounted";
  sameOriginAllowed: boolean;
  executableExport?: string;
  cargoFeature?: string;
  cargoDependency?: string;
  mountPath?: string;
  routeContract?: string;
  coverage: "verified" | "partial" | "missing";
  requiredBaseUrlKey?: string;
}

export interface SdkworkDependencyApiExportConfig {
  workspace: string;
  sdkFamily: string;
  apiAuthority: string;
  surface: "open-api" | "app-api" | "backend-api";
  apiPrefix: string | null;
  exportMode: "none" | "dependency-sdk" | "composed-wrapper" | "service-port" | "documentation-only";
  visibility: "internal" | "app" | "backend-admin" | "public" | string;
  methods?: string[];
  methodSelector?: string;
  packageExport?: string;
  servicePort?: string;
  documentationRef?: string;
  runtimeRequired?: boolean;
}

export interface SdkworkAuthRuntimeConfig {
  tokenManagerMode: "appbase-global" | "service-context" | "test";
  tokenStorage: "memory" | "browser-session" | "browser-local" | "os-secure-storage" | "server-context";
  accessTokenHeader: "Access-Token";
  authTokenHeader: "Authorization";
  refreshEnabled?: boolean;
  apiKeyCredentialProvider?: "server" | "secure-storage" | "short-lived" | "test";
}

export interface SdkworkI18nRuntimeConfig {
  defaultLocale: string;
  supportedLocales: string[];
  activeLocales?: string[];
  fallbackLocale: string;
  loadingStrategy?: "eager-core-lazy-feature" | "lazy-route-fragments" | "platform-generated-bundle";
  catalogManifestUrl?: string;
  catalogVersion?: string;
  messageBundleVersion?: string;
  backendMessageBundleVersion?: string;
}

export interface SdkworkPublicRuntimeConfig {
  browserOriginMode?: SdkworkBrowserOriginMode;
  sdkBaseUrl?: string;
  apiBaseUrl?: string;
  openApiBaseUrl?: string;
  appApiBaseUrl?: string;
  backendApiBaseUrl?: string;
  dependencySdkBaseUrls?: Record<string, SdkworkDependencySdkBaseUrls>;
  i18n?: SdkworkI18nRuntimeConfig;
  runtimeEnvFile?: string;
  featureFlags?: Record<string, boolean | string | number>;
}

export interface SdkworkServerConfig {
  bind?: string;
  externalScheme?: "http" | "https";
  publicBaseUrl?: string;
  trustForwardedHeaders?: boolean;
  profileConfigFile?: string;
}

export interface SdkworkDesktopConfig {
  nativeHost: "tauri" | "electron" | "browser-installed" | "custom";
  /**
   * Optional bridge transport override; defaults to "auto". Tauri hosts use
   * invoke/commands, Electron hosts use contextBridge/ipcRenderer, and browser
   * hosts use the fallback adapter. Feature code MUST NOT select the transport
   * directly; it consumes only `@sdkwork/desktop-host-contract` interfaces.
   */
  bridgeTransport?: "auto" | "invoke" | "ipc" | "none";
  localServiceEnabled?: boolean;
  localServiceBind?: string;
  userConfigFile?: string;
  secureStorageProvider?: string;
}

export interface SdkworkTabletConfig {
  platform: "ipad-os" | "android-tablet";
  nativeHost: "tauri" | "custom";
  bundleId?: string;
  packageName?: string;
  platformConfigFile?: string;
}

export interface SdkworkMobileConfig {
  architecture: "h5" | "capacitor" | "flutter" | "android-native" | "ios-native" | "harmony-native";
  platform?: "ios" | "android" | "harmony" | "browser" | "weixin-browser";
  nativeHost?: "capacitor" | "flutter" | "android-native" | "ios-native" | "harmony-native" | "browser" | "custom";
  bundleId?: string;
  packageName?: string;
  platformConfigFile?: string;
  secureStorageProvider?: string;
}

export interface SdkworkMiniProgramConfig {
  platform: "weixin" | "alipay" | "baidu" | "toutiao" | "lark" | "qq" | "kuaishou" | "jd" | "360" | "dingtalk" | "ali" | "custom";
  appId?: string;
  platformConfigFile?: string;
  subpackageStrategy?: "capability" | "manual" | "single-package";
}

export interface SdkworkRuntimePaths {
  appCode: string;
  processName?: string;
  configDirectory?: string;
  configFile?: string;
  dataDirectory?: string;
  logDirectory?: string;
  cacheDirectory?: string;
  runtimeDirectory?: string;
  tempDirectory?: string;
}

export interface SdkworkDatabaseConfig {
  engine: "postgresql" | "sqlite";
  host?: string;
  port?: number;
  database?: string;
  schema?: string;
  username?: string;
  passwordFile?: string;
  password?: string;
  sslMode?: string;
  maxConnections?: number;
  connectTimeoutMs?: number;
  idleTimeoutSeconds?: number;
  url?: string;
  file?: string;
  autoMigrate?: boolean;
  autoSeed?: boolean;
}

export interface SdkworkRedisConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  database?: number;
  username?: string;
  url?: string;
  passwordFile?: string;
  password?: string;
  keyPrefix?: string;
  tls?: boolean;
  maxConnections?: number;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  poolIdleTimeoutSeconds?: number;
}
```

Rules:

- `environment` describes lifecycle stage.
- `profileId` is the canonical two-dimensional identifier and must equal
  `${deploymentProfile}.${environment}`. Bootstrap rejects mismatches before
  SDK construction.
- `configProfile` is an optional legacy command/operator alias used for script
  compatibility or traceability. `dev` maps to `development`; `prod` maps to
  `production`. New env file names use `profileId`, not `configProfile`.
- `buildMode` describes the bundler/build tool mode. It is useful for Vite or native package scripts, but it is not the lifecycle authority for runtime behavior.
- `deploymentProfile` describes application deployment architecture and is only
  `standalone` or `cloud`. It is the one active API/runtime topology for this
  runtime instance, not an artifact format or installation-location flag.
- `runtimeTarget` describes where this config is consumed: browser renderer, desktop host, tablet host, Capacitor host, Flutter host, mini program runtime, server process, container process, or test runner.
- `targetPlatform` records the operating or delivery platform, while
  `clientArchitecture` records the implementation/host architecture. For
  example, iOS may pair with `h5`, `capacitor`, `flutter`, or `ios-native`;
  Android may pair with `h5`, `capacitor`, `flutter`, or `android-native`.
- H5 in an iOS or Android browser remains `runtimeTarget = browser` and does
  not imply an IPA/APK. Capacitor, Flutter, and native targets produce platform
  binaries according to their architecture standards.
- `browserOriginMode` describes browser security origin behavior. Every
  `standalone` runtime with `runtimeTarget = "browser"` `MUST` resolve it to
  `"same-origin"`. Cloud browser deployments may use `"cross-origin"` only
  when explicit API origins, CORS, CSP, cookie, and credential policy allow it.
- `browserOriginMode` is independent from
  `dependencyApiSurfaces[].runtimeMode`. The latter proves whether a dependency
  API assembly is embedded or external; it does not describe where the browser
  page was loaded.
- Application runtime config does not carry a cloud gateway strategy or
  implementation identity. `gatewayPlacement` is required only when a
  standalone client owns or locates its application standalone gateway.
- `openApiBaseUrl`, `appApiBaseUrl`, and `backendApiBaseUrl` are resolved before SDK clients are created, but backend SDK clients may be constructed only after the SDK inventory classifies the runtime as `backend-admin`.
- `openApiBaseUrl` is optional because not every application consumes an open-api SDK. When present for a SDKWork-owned business open-api, it `MUST` use that domain's approved non-app/non-backend prefix from `API_SPEC.md` section 4.5.1, for example `/im/v3/api`. It does not require a literal `/open` path segment. Vendor compatibility prefixes such as `/v1` are valid only for operations declared with `x-sdkwork-wire-protocol: external` per section 4.5.2.
- `sdkBaseUrls` is the canonical SDK base URL map for bootstrap. It `MAY` use
  one common `sdkBaseUrl` only when topology proves one API edge serves all
  consumed SDK surfaces. Otherwise `openApiBaseUrl`, `appApiBaseUrl`,
  `backendApiBaseUrl`, and dependency-specific entries resolve from their
  declared application/platform surfaces.
- A common `sdkBaseUrl` represents a topology-proven API edge origin or
  deployment path prefix. Bootstrap derives surface URLs by appending the
  standard API prefixes, for example `/v1`, `/app/v3/api`, and
  `/backend/v3/api`. It `MUST NOT` treat a resolved surface URL such as `/v1`
  as the origin for other surfaces.
- Browser-visible SDK base URLs and public runtime config `MUST` preserve
  client-visible API URI canonicality from `API_SPEC.md` section 4.1.1. A
  development proxy selector, upstream id, gateway role, or connectivity-plane
  token must not appear in a public SDK base URL when generated SDKs will append
  `/app/v3/api`, `/backend/v3/api`, or an approved open-api prefix.
- Per-surface and per-SDK overrides win over the common `sdkBaseUrl`. This keeps the simple one-base-url deployment path while still allowing external upstream services, private dependency hosts, and tenant-specific SDK routing.
- `sdkBaseUrls.dependencySdkBaseUrls` owns override base URLs for dependency SDK families such as appbase, Drive, IM, or another application. It must be keyed by stable SDK family id, not by ad hoc host names.
- `dependencyApiSurfaces` records which dependency-owned HTTP API surfaces are available through
  the current runtime, which are external services, and which are intentionally not mounted. It
  `MUST` match component/runtime manifests and the dependency surface rules in `SDK_SPEC.md`.
- Application standalone and platform cloud gateway runtimes may record `cargoFeature` and `cargoDependency` on dependency API surface
  entries. These values are pointers into native Cargo metadata, not a replacement catalog; tooling
  must verify them with `cargo metadata`, `[workspace.dependencies]`, and the runtime crate's
  feature table.
- Platform cloud gateway dependency surfaces that proxy to external upstreams `MUST` use `runtimeMode:
  "external-service"` or the platform host's equivalent external-upstream runtime mode plus `requiredBaseUrlKey` or
  dependency SDK base URL config. They `MUST NOT` set `cargoFeature` or `cargoDependency` unless an
  embedded executable dependency is actually compiled into that host.
- `dependencyApiExports` records which dependency-owned API capabilities this application or
  component intentionally exposes through authored public integration surfaces. It `MUST` default to
  `[]`; dependency APIs are not exported by a consuming app merely because dependency SDK clients
  are configured.
- `auth` config describes how the runtime obtains and stores credentials. It must not contain actual `authToken`, `accessToken`, `refreshToken`, API key values, or session DTOs.
- `i18n` config describes locale selection, supported locale list, active locale list, fallback locale, message-catalog loading strategy, manifest URL, and bundle versions only. It must not contain translated message content, L1 brand/store copy, validation copy, or generated message-catalog bundles.
- `defaultLocale`, `fallbackLocale`, and every `activeLocales[]` entry `MUST` be members of `supportedLocales` for production and production-like profiles.
- `i18n` runtime config is separate from database seed locale config. Database seed locale and `i18nVersion` follow `DATABASE_FRAMEWORK_SPEC.md` and `ENVIRONMENT_SPEC.md`.
- Runtime config `MUST NOT` define `tenantId` or `organizationId` as API/SDK call defaults. Tenant and organization context after authentication is resolved from tokens, API key records, or server-side request context. Pre-auth tenant or organization selection must use IAM login/selection flows, not SDK config or per-call options.
- Config objects crossing host/native boundaries `SHOULD` be serializable.
- `publicRuntime` is browser-visible and may contain only non-secret values such
  as normalized `deploymentProfile`, `runtimeTarget`, public SDK base URLs, and
  feature flags. Browser bundles must not read private process config.
- A standalone browser public runtime source uses root-relative SDK Base URLs.
  Browser bootstrap may resolve those paths against `window.location.origin`
  before SDK construction. Checked-in or materialized standalone public config
  `MUST NOT` contain an absolute renderer, application-ingress, dependency, or
  loopback origin, even when that origin currently matches the page.
- `server` owns process bind, public URL, reverse-proxy trust, and service profile config. It must not own renderer-only build settings.
- `desktop` owns native host, user config, local service lifecycle, and secure storage provider. It must not own remote business API contracts.
- `tablet` owns iPadOS/Android tablet package identity and platform config references. It must not own phone-first H5 behavior or business SDK bypasses.
- `mobile` owns H5/Capacitor/Flutter/native Android/native iOS/native Harmony mobile package identity, platform config references, secure storage provider selection, and mobile host metadata. It must not own SDK package ownership, business route constants, auth tokens, refresh tokens, signing keys, or business authorization.
- `miniProgram` owns mini program platform identity, app id references, platform config file references, and page/subpackage strategy. It must not own platform private keys, business API contracts, generated SDK ownership, or feature-local auth behavior.
- `paths` resolves the canonical directories defined by `RUNTIME_DIRECTORY_SPEC.md`.
- `database` resolves the structured database fields defined by `RUNTIME_DIRECTORY_SPEC.md` and `DATABASE_SPEC.md`.
- Standalone server/container and cloud runtime targets should use structured PostgreSQL fields.
  `url` is a private explicit override, not the primary production contract.
- Desktop runtime targets may use SQLite only for declared client-local data, with `file` under the
  SDKWork user private data directory.
- Desktop client-local runtime config should resolve `database.engine` to `sqlite` and
  `database.file` to the user private data directory by default.
- Application root `dev:browser` and `dev:desktop` commands are development
  orchestration defaults. They should resolve `database.engine = "postgresql"`,
  `deploymentProfile = "standalone"`, and `environment = "development"`
  unless an explicit suffixed command selects cloud. An SQLite suffix may
  select only a declared client-local database profile, never the backend
  service database.
  This development service config is separate from the desktop-local SQLite
  config and must not change the installed desktop package default.
- Environment parsing for `database` must map
  `SDKWORK_DATABASE_ENGINE` to `engine` and
  `SDKWORK_DATABASE_SSL_MODE` to `sslMode`. New applications must reject
  application- or module-prefixed database fields without dual-reading them, and must reject
  `DATABASE_PROVIDER` and `DATABASE_SSLMODE` instead of treating them as
  aliases.
- Redis config is optional infrastructure config. The default is
  `enabled: false`; reusable modules must not assume Redis exists unless their
  bootstrap receives an enabled typed Redis config.
- Redis connections should prefer separate `host`, `port`, and `database`
  fields. `url` is an advanced override for managed Redis endpoints whose
  connection contract cannot be represented cleanly with separate fields.
- Redis password material should use `passwordFile` or a platform secret.
  Direct `password` is allowed only when the process environment or config file
  is protected as a secret-bearing source.

### 2.1 Runtime Target Authority

`SdkworkRuntimeTarget` is the canonical runtime-target vocabulary for SDKWork
application config, manifests, workflow targets, release evidence, topology
fixtures, and validation. Other specs may reference this list but must not
invent alternate deployment-mode values.

| Runtime target | Runtime family | Config owner | Secret/session owner | Package/release notes |
| --- | --- | --- | --- | --- |
| `browser` | web/H5 renderer | public runtime config and browser bootstrap | browser token storage adapter only; no private secrets | Web URL or static web package; may be `cloud` or documented standalone/offline package. |
| `desktop` | PC desktop host | desktop user config and native host config | OS secure storage or approved user-private secrets | Signed desktop installer or app bundle; defaults to standalone. |
| `tablet-ipados` | PC tablet host | PC renderer config plus iPadOS/Tauri host config | iPadOS secure storage or approved host adapter | IPA/TestFlight/App Store/private package for large-screen tablet behavior. |
| `tablet-android` | PC tablet host | PC renderer config plus Android/Tauri host config | Android secure storage or approved host adapter | APK/AAB/Play/private package for large-screen tablet behavior. |
| `capacitor-ios` | H5 mobile host | H5 browser config plus Capacitor iOS host config | iOS secure storage through Capacitor adapter | IPA/TestFlight/App Store/private package. |
| `capacitor-android` | H5 mobile host | H5 browser config plus Capacitor Android host config | Android secure storage through Capacitor adapter | APK/AAB/Play/private package. |
| `flutter-ios` | Flutter mobile host | Flutter app config plus iOS host config | Flutter secure storage adapter backed by iOS facilities | IPA/TestFlight/App Store/private package. |
| `flutter-android` | Flutter mobile host | Flutter app config plus Android host config | Flutter secure storage adapter backed by Android facilities | APK/AAB/Play/private package. |
| `android-native` | native Android app | Android app config plus Gradle/manifest host config | Android secure storage or approved platform adapter | APK/AAB/Play/private package. |
| `ios-native` | native iOS app | iOS app config plus Xcode/Swift package host config | iOS Keychain or approved platform adapter | IPA/TestFlight/App Store/private package. |
| `harmony-native` | native HarmonyOS app | Harmony app config plus hvigor/ohpm host config | Harmony secure storage or approved platform adapter | Harmony package or store/private distribution artifact. |
| `mini-program` | mini program host | mini program app config plus platform host config | platform session/storage adapter; no committed app secret | Platform upload/review/release package. |
| `server` | service process | server runtime config | process secret manager or protected config file | Archive, OS service, or cloud service artifact. |
| `container` | containerized service | mounted config, env, and platform secret manager | orchestrator secret manager or mounted secret files | OCI/Docker-compatible image, chart, manifest, or deployment bundle. |
| `test-runner` | automated test runtime | generated test config | ephemeral test credentials only | Test evidence only; not a production package target. |

Rules:

- Validators `MUST` reject `mobile`, `native`, `web`, `docker`, `server`,
  `desktop`, or `container` when they are used as deployment profiles. Only
  exact `SdkworkRuntimeTarget` values may describe runtime targets.
- Package profile values such as `mobile`, `tablet`, `desktop`, `server`, and
  `container` are artifact taxonomy labels. They do not replace
  `runtimeTarget`.
- Docker-compatible artifacts use `runtimeTarget = "container"`. The word
  `docker` may appear only in package format, tooling, provider, or operator
  documentation.
- H5 web and PC web both use `runtimeTarget = "browser"`. The app root and
  `runtime.framework` distinguish `react`, `react-h5`, and other browser
  architectures.

## 3. SDK Client Bootstrap

### 3.1 Profile URL Resolution Summary

| Profile | Browser default | Server/runtime default | Primary authority |
| --- | --- | --- | --- |
| `standalone` | Same-origin relative canonical API paths from authored `VITE_*` or runtime config | Application standalone gateway listener from topology `application.public-ingress` | `ENVIRONMENT_SPEC.md` §6.2, `API_ASSEMBLY_SPEC.md` §6.1.1 |
| `cloud` | Absolute URLs from `application.public-ingress` and `platform.api-gateway` | Deployed upstream URLs from topology; no local standalone gateway process | `DEPLOYMENT_SPEC.md` §1.2, `ENVIRONMENT_SPEC.md` §6.2 |

Rules:

- Topology `MUST` declare enough surface metadata for the selected profile to materialize every required SDK base URL without guessing sibling repository ports.
- `standalone` topology `MUST` declare the standalone gateway bind address, public browser origin, and every same-origin-mounted dependency surface that the api-assembly composes.
- `cloud` topology `MUST` declare public ingress for application-owned APIs and platform gateway URLs for dependency APIs unless an explicit per-dependency override documents a different host.
- Profile-specific URL materialization `MUST` follow `ENVIRONMENT_SPEC.md` §5.1.4.1 resolution order. Authored same-origin `VITE_*` values `MUST NOT` be overwritten by launcher-derived absolute URLs in `standalone` development.

Bootstrap creates SDK clients:

```ts
const openApiBaseUrl = config.sdkBaseUrls?.openApiBaseUrl ?? config.openApiBaseUrl;

const openApiClient = openApiBaseUrl
  ? createOpenApiClient({
      baseUrl: openApiBaseUrl,
      apiKey: apiKeyProvider,
    })
  : undefined;

const appClient = createAppClient({
  baseUrl: config.sdkBaseUrls?.appApiBaseUrl ?? config.appApiBaseUrl,
  tokenManager,
});

const backendApiBaseUrl = config.sdkBaseUrls?.backendApiBaseUrl ?? config.backendApiBaseUrl;
const isBackendAdminRuntime = classifyRuntimeSurface(config) === "backend-admin";

const backendClient = isBackendAdminRuntime && backendApiBaseUrl
  ? createBackendClient({
      baseUrl: backendApiBaseUrl,
      tokenManager,
    })
  : undefined;
```

Rules:

- SDK client constructors may differ by generated SDK package.
- Service modules receive constructed clients, not constructor details.
- Runtime config selects SDK base URLs, dependency surfaces, and credential modes. It `MUST NOT` contain live tokens, raw API keys, or per-user session credential values.
- `cloud.development` client bootstrap `MUST` require explicit application and
  platform Base URLs for every required surface, reject implicit standalone or
  production fallback, and complete bounded remote health checks before
  constructing feature services.
- Application and platform Base URLs `MAY` resolve to the same deployed origin.
  Bootstrap `MUST` preserve surface-specific SDK path ownership without
  inferring the remote gateway implementation.
- Switching deployment profile, environment, API origin, token issuer, or
  application identity `MUST` create a distinct credential/cache/storage
  namespace and require re-authentication. Tokens, cookies, SQLite state,
  offline queues, and feature caches `MUST NOT` cross that boundary implicitly.
- Runtime config `SHOULD` allow one browser-visible public API edge root, for example `PORTAL_PUBLIC_SDK_BASE_URL`, and derive standard open-api, app-api, and backend-api public runtime URLs from it while preserving canonical API paths. Applications `MAY` also expose per-surface or per-SDK public override keys such as `PORTAL_PUBLIC_OPEN_API_BASE_URL`, `PORTAL_PUBLIC_APP_API_BASE_URL`, `PORTAL_PUBLIC_BACKEND_API_BASE_URL`, or dependency-specific keys.
- Bootstrap `MUST` classify every SDK and operation profile before constructing feature services: anonymous, credential-entry bootstrap, refresh-token, authenticated app-api, authenticated `backend-admin` backend-api, protected open-api API-key, protected open-api OAuth bearer, protected open-api flexible, ingress/agent, compatibility, local/native, or test fake. The presence of `backendApiBaseUrl` alone is not permission to construct a backend SDK client.
- Token providers for app-api and backend-api SDKs `MUST` support both `Authorization: Bearer <JWT auth_token>` and `Access-Token: <JWT access_token>`.
- Token providers `MUST` send both headers on protected requests whenever both credentials are available.
- Service/native application bootstrap `MAY` seed TokenManager from private `SDKWORK_ACCESS_TOKEN` before interactive login. Development browsers use only the approved private Vite lifecycle handoff; production browsers use an approved short-lived bootstrap exchange or trusted host channel. Login/session commit `MUST` replace bootstrap state with IAM-issued session tokens. `auth_token`, `refresh_token`, and API keys `MUST NOT` be configured in environment variables.
- Credential-entry bootstrap preparation and Vite serve handoff `MUST` use the IAM-owned helpers defined by `IAM_CREDENTIAL_ENTRY_SPEC.md`. Application Vite configs `MUST NOT` implement local `transformIndexHtml` token serializers or define `process.env.SDKWORK_ACCESS_TOKEN`; they consume `@sdkwork/iam-credential-entry/vite` instead.
- `development` may generate a disposable manifest-derived bootstrap JWT. `test` requires an explicit isolated-test generation opt-in. Staging/production service or native contexts require a private runtime source and fail closed when it is missing; production browsers never embed that credential and must complete the approved runtime bootstrap channel before enabling credential entry.
- In an authenticated application session context, every app-api SDK client and every explicit `backend-admin` backend-api SDK client `MUST` receive credentials from the same global `TokenManager`. This includes appbase app SDKs, application/dependency app SDKs, explicit `backend-admin` appbase backend SDKs, application/dependency backend SDKs, and approved composed wrappers backed by those SDKs.
- Server service-context runtimes that do not represent a user login session `MUST` use one request/service credential provider per service context. They must not create per-domain or per-SDK credential providers for calls that share the same context.
- App-api and backend-api SDK clients `MUST NOT` receive live session `authToken`, `accessToken`, or `refreshToken` through browser public runtime config, feature flags, app manifests, or per-call manual headers. Private bootstrap env credentials are allowed only according to `ENVIRONMENT_SPEC.md` section 6.1.
- `Access-Token` is the canonical access isolation header. Generated SDKs, runtime adapters, server guards, and tests must not introduce aliases such as `X-Access-Token`, `access_token` query parameters, or application-specific access headers.
- Bootstrap may expose `getAuthHeaders()` only for approved runtime bridges, local service calls, or tests. UI components and feature service facades must call SDK methods instead of assembling headers.
- Open-api credential providers for protected open-api SDKs `MUST` be separate from the app login token manager. API key and OAuth bearer secrets `MUST NOT` be stored in browser runtime env, app manifests, generated SDK docs, frontend bundles, logs, screenshots, or telemetry. Browser-facing open-api usage must be public, session-mediated, or backed by an approved short-lived credential flow.
- Dependency SDK base URLs `MUST` be configured explicitly when they do not
  resolve from `platform.api-gateway`, a topology-proven common API edge
  origin, or an application's verified same-origin embedding. Dependency-owned
  SDKs must not be regenerated or hard-coded into application-owned SDK base
  URLs.
- Dependency SDK base URLs may inherit the common `sdkBaseUrl` when topology
  documents that origin as serving the dependency surface, or they may inherit
  an application same-origin app/backend default only when the
  application runtime declares `dependencyApiSurfaces` mount coverage for that dependency SDK
  family, surface, and prefix. A route contract or `sdkDependencies` entry alone is not enough.
- In a `standalone` profile, every dependency surface declared with
  `runtimeMode: "same-origin"` `MUST` resolve from the current application's
  `application.public-ingress`. Its owner API assembly is linked into the
  current Rust standalone gateway process. Standalone source profiles, resolved
  runtime config, and browser runtime config `MUST NOT` define a
  `platform.api-gateway` URL or an alternate dependency loopback origin for that
  surface.
- Standalone browser development `MUST` use the browser's dev-server origin for
  application-owned and embedded dependency SDK clients. The declared
  `dev-server-proxy` routes canonical API paths internally to
  `application.public-ingress` without changing the client-visible URI. Its
  target URL is private Node/server configuration and is never materialized
  into public/Vite SDK Base URL values. This transport proxy is not dependency
  assembly mount evidence and does not satisfy `sameOriginAllowed` or
  `runtimeMode: "same-origin"` coverage by itself.
- Standalone production browser config `MUST` use the
  `application.public-ingress` page origin exposed by the declared
  `gateway-static` delivery. The static asset runtime root, `/` mount, and
  `/index.html` SPA fallback are server/package config, not browser SDK URL
  overrides.
- `dependencyApiSurfaces` entries with `runtimeMode: "same-origin"` `MUST` set
  `sameOriginAllowed: true`, name the executable router/controller/service export or equivalent
  runtime adapter, and record `coverage: "verified"` before SDK clients may inherit the application
  same-origin `appApiBaseUrl` or `backendApiBaseUrl`.
- When an application standalone gateway provides the same-origin or embedded dependency surface,
  `dependencyApiSurfaces` `SHOULD` also name the Cargo feature and Cargo dependency that activate
  that executable integration. The feature/dependency evidence must resolve through Cargo metadata;
  a separate gateway catalog file is not accepted as the source of these facts.
- An embedded executable export is a host-neutral assembly contribution called
  by the application standalone gateway. It `MUST NOT` be satisfied by launching
  the dependency repository's standalone gateway binary, binding a second HTTP
  listener, or proxying to an undeclared loopback dependency port.
- When the platform cloud gateway proxies an external upstream dependency service, the dependency
  surface names the upstream/base-url config instead of Cargo feature/dependency evidence. Split
  proxy coverage proves gateway routing and upstream configuration; it does not prove same-process
  embedded router availability.
- A platform cloud gateway external-upstream proxy surface `MUST NOT` be created from SDK family name alone. The
  existing SDK family manifest, component spec, or runtime manifest must also prove a materialized route
  path set with a stable route prefix. Acceptable materialized evidence includes authority OpenAPI
  `paths`, derived `*.sdkgen.*` OpenAPI inputs, or normalized route manifests under
  `sdks/_route-manifests/<surface>/`. Generic-only roots and SDK family manifests with no paths are
  tracked as future integration candidates, not required runtime upstreams.
- A dependency SDK family may expose multiple stable route prefixes, for example a comments SDK
  owning both `/app/v3/api/comments` and `/app/v3/api/engagement`. Runtime config `MUST` declare
  each prefix as a separate dependency API surface while sharing the same service id and
  `requiredBaseUrlKey`, so route matching stays precise without broad fallback ownership.
- Cloud application runtime config that consumes the platform connectivity plane
  (`APP_RUNTIME_TOPOLOGY_NAMING.md` surface `platform.api-gateway`) `SHOULD`
  use that surface origin as the default platform dependency base URL source.
  Direct dependency module URLs are per-surface overrides for explicit
  multi-host deployments and must not be hidden as the default.
- The platform API surface origin does not collapse application-owned SDK
  roots. Application-owned `openApiBaseUrl`, `appApiBaseUrl`, and
  `backendApiBaseUrl` remain bound to `application.public-ingress` unless
  topology explicitly proves one API edge serves both surface sets.
- Application-local runtime env `MUST NOT` materialize per-module foundation upstream defaults beside a
  configured platform API surface origin. Appbase, Drive, commerce, search, voice, image, comments, course,
  messaging, or other foundation module URLs are explicit upstream overrides only.
- Cloud launch/config tests for applications that consume `platform.api-gateway`
  `MUST` prove dependency SDK defaults derive from that surface while application-owned app/backend/open SDK base URLs remain
  application-owned.
- When dependency API surfaces overlap by prefix, runtime config or the component spec `MUST`
  describe the route precedence that the selected host routing contract enforces. Specific dependency patterns and fixed
  IAM/provider routes resolve before broad fallback prefixes. Foundation prefixes such as Drive,
  Notary, RTC, Agent/Kernel, AIoT, Memory, Knowledgebase, News, Notes, Music, Generations,
  Community, Search, Voice, Image, Comments, Course, and Messaging must resolve before broad
  app/backend fallback surfaces. Broad external upstream surfaces
  may inherit a common API edge origin only when tests prove they do not shadow more specific dependency
  surfaces.
- Development proxies that serve multiple owners under one browser origin
  `MUST` use canonical route-prefix precedence, route manifests, or materialized
  OpenAPI path inventories to route requests. They `MUST NOT` expose synthetic
  prefixes such as `/__sdkwork/*`, `/proxy/*`, `/gateway/*`, or `/platform/*`
  as SDK base URLs or documented API examples.
- Same-origin dependency surface config `MUST` name only production-capable routers, controllers,
  service adapters, or upstreams as verified coverage. Demo routers, mock servers, fixture stores,
  hard-coded IAM tenants/users/organizations/API keys, or seed-only responses are valid only in
  explicitly marked tests and must not enable application same-origin SDK base URL inheritance.
- `dependencyApiSurfaces` entries with `runtimeMode: "external-service"` `MUST` set
  `sameOriginAllowed: false` and provide `requiredBaseUrlKey` or another deterministic pointer to
  `sdkBaseUrls.dependencySdkBaseUrls[<sdkFamily>]`.
- `dependencyApiSurfaces` entries with `runtimeMode: "not-mounted"` `MUST` set
  `sameOriginAllowed: false`; bootstrap must not construct a dependency SDK client for that surface
  unless a feature/config path explicitly changes the runtime mode.
- If `dependencyApiSurfaces` marks a dependency SDK surface as external-service, not-mounted, or
  unverified, SDK client bootstrap `MUST` require the dependency-specific base URL from
  `sdkBaseUrls.dependencySdkBaseUrls`, the declared platform API surface, or a
  common `sdkBaseUrl` whose topology coverage includes that dependency surface,
  and must fail fast before
  constructing a client with the application-owned base URL.
- Runtime bootstrap `MUST` compare `dependencyApiExports` with `dependencyApiSurfaces`. Any export
  with `runtimeRequired: true` must have either verified same-origin coverage or a configured
  dependency-specific base URL before feature services are constructed.
- `backend-admin` dependency SDKs `MUST` not inherit a browser-visible application backend base URL unless
  the `backend-admin` UI is allowed to call that surface and runtime mount coverage proves every
  dependency-owned method/path is served at that same origin. They `MAY` use the platform API surface only
  when it explicitly serves the dependency backend surface, not
  merely because the application-owned backend SDK has a default `/backend/v3/api` URL.
- For appbase backend-admin IAM, `PORTAL_PUBLIC_SDK_BASE_URL` may derive
  `PORTAL_PUBLIC_APPBASE_BACKEND_API_BASE_URL` only when topology proves that origin serves
  `/backend/v3/api/iam/*`. An application backend default such as
  `PORTAL_PUBLIC_BACKEND_API_BASE_URL` or `VITE_CLOUDROUTER_BACKEND_API_BASE_URL` may be used for
  `@sdkwork/iam-backend-sdk` only when `dependencyApiSurfaces` records verified same-origin
  mount coverage for a production-capable appbase backend IAM router/controller/service adapter.
  Appbase app SDK configuration, route metadata, local/demo routers, and fake response handlers are
  not evidence for appbase backend IAM availability.
- Token refresh behavior `MUST` be centralized so modules do not implement competing refresh flows.
- Test mode may use fake SDK clients or mock servers with the same resource surface.

## 4. Environment Names And Files

Canonical environments:

```text
development
test
staging
production
```

Canonical deployment profiles:

```text
standalone
cloud
```

Canonical profile id:

```text
<deploymentProfile>.<environment>
```

`ENVIRONMENT_SPEC.md` section 5.1 is the file-format authority for the complete
eight-profile matrix and the PC/H5 Vite, Flutter, native WeChat mini program,
uni-app, native mobile, desktop, Node, Spring Boot, and Rust projections.

Profile aliases remain command compatibility only:

| Profile alias | Canonical environment | Allowed use |
| --- | --- | --- | --- |
| `dev` | `development` | Command input normalized before profile selection |
| `test` | `test` | Command input or exact canonical environment |
| `staging` | `staging` | Command input or exact canonical environment |
| `prod` | `production` | Command input normalized before profile selection |

Every materialized config must resolve these fields before bootstrap continues:

```text
environment
deploymentProfile
profileId
runtimeTarget
```

The invariant is:

```text
profileId == deploymentProfile + "." + environment
```

Rules:

- Runtime validates the content and the selected file name; it does not infer
  production safety from either one alone.
- `dev` and `prod` must normalize to `development` and `production` before
  composing `profileId`. New file names do not use `.dev` or `.prod`.
- Unknown environment names, deployment profiles, profile ids, and runtime
  targets fail closed. A missing profile never falls back to another
  environment or deployment profile.
- Vite uses `.env.<profile-id>` and `VITE_*`; Flutter uses
  `env/sdkwork.<profile-id>.json` and `SDKWORK_*`; native WeChat mini programs
  use `config/mini-program/runtime-env.<profile-id>.json`; uni-app uses the
  Vite `.env.<profile-id>` contract.
- Host/platform config is not an env authority. Tauri config, Capacitor config,
  `project.config.json`, Gradle/manifest config, Xcode/plist/xcconfig, and
  Harmony JSON5 may own package identity, permissions, capabilities, signing
  references, and build metadata only.
- A private `SDKWORK_ACCESS_TOKEN` may be read by Node-side development/test orchestration, but it must not be renamed to `VITE_*`, emitted into public runtime config, or frozen into staging/production output. Development/test browser handoff follows `IAM_CREDENTIAL_ENTRY_SPEC.md` only.
- Browser deploy-time SDK URLs should be served through `/runtime-env.js` or an equivalent public runtime config document instead of being frozen into a hashed bundle when the same build artifact is promoted across environments.
- Server production config must come from process env, an administrator-managed runtime config file, deployment infrastructure, or a secret manager, not from a committed `.env.production`.
- Test config must isolate database names or schemas, Redis key prefixes, log directories, cache directories, and temp directories from development and production. Server test database/schema names remain workspace-scoped, such as `sdkwork_ai_test` or `sdkwork_ai_test_<run_id>`; they must not be derived from an application code or module id.
- Desktop installed runtime config must live in the SDKWork user private config directory and default declared client-local data to SQLite. Desktop/Tauri development service config is a separate server config profile and uses PostgreSQL.
- `.env.postgres.example` is the checked-in local PostgreSQL template for apps
  that support PostgreSQL development. It must use the unified structured
  `SDKWORK_DATABASE_*` fields from `ENVIRONMENT_SPEC.md` section 7.1,
  plus structured `SDKWORK_DATABASE_ADMIN_*` fields when database
  initialization needs an admin connection.
- `.env.postgres` is a host-local developer override and must be excluded from
  source control.
- Production config must come from deployment infrastructure or secret manager.
- Config keys `SHOULD` be namespaced by capability, such as `SDKWORK_IAM_*`.
- Unknown config keys in machine-readable manifests `SHOULD` fail validation to prevent drift.
- Locale and i18n runtime config keys should stay small and declarative: default locale, supported locales, active locales, fallback locale, message-catalog manifest URL, and bundle versions. Translation message catalogs follow `I18N_SPEC.md` package-local fragment ownership and must not be embedded in runtime config, feature flags, app manifests, or environment files.

## 5. Feature Flags

Rules:

- Feature flags `SHOULD` be capability-scoped and typed.
- Security, tenant isolation, and permission enforcement `MUST NOT` depend only on frontend feature flags.
- Feature flags that affect API or database semantics `MUST` be documented in the relevant spec or module README.
- Long-lived flags `SHOULD` have an owner and removal condition.

## 6. Secret Handling

Rules:

- Secrets, tokens, private keys, refresh tokens, verification codes, and API keys `MUST NOT` appear in app manifests, generated SDK docs, frontend bundles, logs, telemetry attributes, or screenshots.
- Desktop apps `SHOULD` store tokens in OS secure storage through a host adapter.
- Browser apps `SHOULD` prefer secure, httpOnly server-managed cookies when the architecture supports them; otherwise token storage risks must be documented.
- Local development secrets must be excluded from source control.

## 7. Acceptance Checklist

- [ ] Runtime config is typed.
- [ ] Shared modules do not read env/global config directly.
- [ ] Lifecycle environment, compatibility profile alias, deployment profile,
      canonical profile id, build mode, and runtime target are normalized
      separately.
- [ ] Dev/test/staging/prod example files are checked in only as safe templates, and local overrides are ignored.
- [ ] Browser public runtime config, desktop user config, H5/Capacitor config, Flutter config, mini program config, native Android config, native iOS config, native Harmony config, server config, container config, and Tauri platform config are separated.
- [ ] Database env parsing maps `SDKWORK_DATABASE_ENGINE` and `SDKWORK_DATABASE_SSL_MODE` to typed config and rejects application-prefixed PostgreSQL identity fields, `DATABASE_PROVIDER`, and `DATABASE_SSLMODE`.
- [ ] Apps with PostgreSQL development support provide `.env.postgres.example` and ignore `.env.postgres`.
- [ ] SDK clients are constructed in bootstrap from one common SDK base URL plus per-surface/per-SDK overrides, with separate effective open-api, app-api, and `backend-admin` backend-api URLs where those surfaces are consumed.
- [ ] Browser-visible SDK base URLs and public runtime config preserve canonical
  API URIs; proxy/upstream selectors do not appear in client-visible API paths.
- [ ] SDK inventory classifies every consumed SDK and operation profile, including anonymous, credential-entry bootstrap, refresh-token, authenticated app/backend, protected open-api, ingress/agent, compatibility, local/native, and test fake before services are constructed.
- [ ] Appbase app SDKs, application/dependency app SDKs, explicit `backend-admin` appbase backend SDKs, application/dependency backend SDKs, and approved composed wrappers in the same authenticated application session receive the same global `TokenManager`; server service-context runtimes use one request/service credential provider per service context.
- [ ] Protected open-api SDKs receive credentials through a separate open-api credential provider matching their declared auth mode and are not placed in login TokenManager client lists.
- [ ] Runtime config contains SDK base URL values and token-manager behavior, but does not contain actual auth/access/refresh tokens or raw API keys.
- [ ] Credential-entry bootstrap fails before SDK dispatch when unavailable; development uses the private lifecycle handoff and production browser artifacts use only the approved short-lived runtime channel with no embedded token.
- [ ] Runtime config contains only i18n locale strategy, active locale list, message-catalog manifest references, and bundle versions, not translated message content or monolithic locale bundles.
- [ ] Runtime i18n config is not reused as database seed locale configuration; seed locale and seed i18n version are handled by database lifecycle config.
- [ ] Dependency SDK base URLs are keyed by SDK family id and are injected during bootstrap instead of hard-coded in services.
- [ ] RPC client inventory classifies every consumed RPC SDK family, resolver profile, resilience profile, and discovery endpoint before feature services are constructed when RPC is enabled.
- [ ] Discovery registration and renew loops are wired in bootstrap for RPC servers that use dynamic resolution.
- [ ] `dependencyApiExports` is explicit and defaults to `[]`; dependency API exports with
  `runtimeRequired: true` have verified same-origin `dependencyApiSurfaces` coverage or explicit
  dependency SDK base URL config before feature services are constructed.
- [ ] Same-origin dependency API surfaces name an executable router/controller/service export and
  have verified coverage before dependency SDK clients inherit application app/backend base URLs.
- [ ] Gateway-host dependency API surfaces, when used, name Cargo feature/dependency evidence that
  resolves through Cargo metadata instead of a separate host catalog.
- [ ] Application runtime defaults resolve shared foundation APIs through the
  declared platform API surface; direct dependency module URLs are explicit overrides.
- [ ] Deployment profile and environment are explicit.
- [ ] Desktop installed config defaults declared client-local persistence to user-private SQLite, while every desktop-started backend service uses the server PostgreSQL profile.
- [ ] Test config isolates database/schema, Redis key prefix, logs, cache, and temp directories from development and production without deriving PostgreSQL identities from application codes or module ids.
- [ ] Secrets are isolated from manifests and committed files.
- [ ] Feature flags are scoped and documented.
