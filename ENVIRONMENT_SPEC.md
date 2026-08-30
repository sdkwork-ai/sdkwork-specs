# Environment Variable And Runtime Configuration Standard

- Version: 1.2
- Scope: environment variables, runtime config files, public browser runtime config, secrets, database selection, standalone/cloud deployment profiles, desktop/server/container/H5/Flutter/mini-program/native Android/native iOS/native Harmony runtime targets, SDK base URLs, locale strategy, Access-Token and TokenManager credential config rules, RPC endpoints
- Related: `CONFIG_SPEC.md`, `SOURCE_CONFIG_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `DEPLOYMENT_SPEC.md`, `REGION_SPEC.md`, `DATABASE_SPEC.md`, `DATABASE_FRAMEWORK_SPEC.md`, `SECURITY_SPEC.md`, `SDK_SPEC.md`, `RPC_SPEC.md`, `RPC_FRAMEWORK_SPEC.md`, `DISCOVERY_SPEC.md`, `RUST_RPC_SPEC.md`, `APPLICATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `I18N_SPEC.md`, `TEST_SPEC.md`

This standard defines the canonical environment and runtime configuration model for SDKWork applications. It exists to prevent each application from inventing different `.env` names, database defaults, SDK base URL rules, config file locations, and secret handling behavior.

`CONFIG_SPEC.md` defines the typed runtime config contract inside application code. This document defines the external operating contract: environment variables, config files, deployment-profile defaults, runtime-target defaults, and validation rules.

## 1. Design Goals

Environment configuration must satisfy these goals:

- One application can run in development, test, staging, demo, and production without code changes.
- `dev`, `test`, `staging`, and `prod` may be accepted as command aliases while
  application runtime normalizes them before composing the canonical profile
  id. They are not canonical env file suffixes.
- One product can support `standalone` and `cloud` deployment profiles with
  explicit browser, H5, desktop, tablet, Capacitor, Flutter, native mobile,
  mini program, service/server, container, and test-runner runtime targets.
- Browser renderer, H5 mobile renderer, desktop native host, tablet native host, Capacitor host, Flutter host, mini program runtime, native Android host, native iOS host, native Harmony host, server process, container process, and test runner config are separated.
- Server-side development, test, staging, demo, and production deployments use PostgreSQL for authoritative relational persistence.
- Desktop installs use SQLite only for declared client-local data in the SDKWork user private data directory defined by `RUNTIME_DIRECTORY_SPEC.md`.
- Desktop/Tauri development commands that start backend services use the server PostgreSQL development profile. SQLite profiles belong only to installed or explicitly tested client-local data.
- Every database setting can be specified in a runtime config file and overridden by environment variables for emergency operations.
- Browser-visible values are separated from private process values.
- SDK bootstrap resolves application and platform API surface URLs before
  constructing clients. One common API edge origin may derive multiple
  surfaces only when topology proves that edge coverage; per-surface or per-SDK
  overrides support multi-host deployments.
- Secrets are never committed, never served through browser runtime config, and never logged in plaintext.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Environment | Lifecycle stage: `development`, `test`, `staging`, `demo`, or `production`. `demo` is the independent demonstration/deployment tier, fully isolated from dev/test/staging/prod. |
| Environment profile alias | Legacy command/operator alias: `dev`, `test`, `staging`, or `prod`. `dev` maps to `development`; `prod` maps to `production`; aliases are normalized before canonical profile selection. |
| Deployment profile | Application deployment architecture: `standalone` or `cloud`. |
| Runtime target | Code execution target: `browser`, `desktop`, `tablet-ipados`, `tablet-android`, `capacitor-ios`, `capacitor-android`, `flutter-ios`, `flutter-android`, `android-native`, `ios-native`, `harmony-native`, `mini-program`, `server`, `container`, or `test-runner`. |
| Build mode | Build tool mode such as Vite mode, Tauri build target, or Spring profile alias. It is not sufficient as the full runtime environment model. |
| Process env | Environment variables available to a service process. |
| Runtime config file | Host-local TOML/YAML/JSON config file loaded at startup. TOML is preferred for SDKWork Rust services. |
| Public runtime env | Browser-visible values served through a controlled endpoint such as `/runtime-env.js`. |
| Secret | Password, token, signing key, webhook secret, API key, private connection string, or credential material. |
| SDK surface | Generated SDK family or API surface, such as SDKWork business open-api, app-api, backend-api, or a vendor compatibility open-api surface declared with `x-sdkwork-wire-protocol: external` per `API_SPEC.md` section 4.5.2. |

## 3. Source Precedence

Configuration sources must be resolved by runtime target.

Server and container processes resolve private configuration in this order:

1. Built-in safe defaults for local development, tests, and desktop-only non-secret settings.
2. Runtime config file from the canonical runtime directory or explicit config path.
3. Process environment variables.
4. Command-line arguments for one-shot local development or test commands.
5. Secret manager or OS secure storage for secrets when the deployment platform provides one.

Browser renderers resolve public configuration in this order:

1. Build-time public defaults for development only.
2. Public runtime config document such as `/runtime-env.js` or `/runtime-env.json`.
3. Server-rendered public config values derived from validated private config.
4. Generated SDK client bootstrap validation.

Desktop and tablet native hosts resolve local configuration in this order:

1. Built-in safe desktop/tablet defaults.
2. SDKWork user-private runtime config file from `RUNTIME_DIRECTORY_SPEC.md`.
3. Process env or command-line overrides for development and diagnostics.
4. OS secure storage for tokens and secrets.
5. Platform config such as Tauri `tauri.*.conf.json` for packaging metadata only.

Rules:

- Process env overrides config file values.
- Command-line arguments may override process env only for local development and test tooling, not production service managers.
- Public browser runtime env must be generated from validated process or config-file values by the trusted server.
- Browser renderer code must never read server process env, host-local TOML, platform secret files, or desktop secure storage directly.
- Tauri/native platform config is packaging config, not runtime business config. It may be merged by target platform, but it must not define secrets or API contract ownership.
- Shared modules must not read process env directly. Bootstrap code reads env and constructs typed runtime config.
- Unknown keys in strict release config should fail validation unless explicitly marked as extension keys.

## 4. Naming Standard

Environment variable names must follow this format:

```text
<PLATFORM_OR_APPLICATION_CODE>_<DOMAIN_OR_CAPABILITY>_<SETTING>
```

For SDKWork application private runtime values:

```text
SDKWORK_<APPLICATION_CODE>_<SETTING>
```

Legacy application-specific prefixes such as `SDKWORK_CLOUDROUTER_*` may remain only during a documented migration window.

For browser-public portal values:

```text
PORTAL_PUBLIC_<SURFACE>_<SETTING>
```

For Vite/browser-internal runtime values:

```text
VITE_<APP_CODE>_<SURFACE>_<SETTING>
```

Rules:

- Use uppercase snake case.
- Use one application-code prefix per application family.
- Use capability names that match `DOMAIN_SPEC.md` and `SDK_SPEC.md`.
- Use `SDK_BASE_URL` only for a topology-declared common API edge origin that
  can derive multiple SDK surfaces. Do not use generic names such as
  `GATEWAY_API_BASE_URL` when the consuming SDK surface is more specific.
  Prefer `OPEN_API_BASE_URL`, `APP_API_BASE_URL`, or `BACKEND_API_BASE_URL` for
  resolved surface overrides.
- Dependency SDK base URL override variables must include a stable dependency SDK family or dependency app code segment, for example `SDKWORK_<APPLICATION_CODE>_APPBASE_APP_API_BASE_URL`, `SDKWORK_<APPLICATION_CODE>_DRIVE_APP_API_BASE_URL`, or `PORTAL_PUBLIC_IM_OPEN_API_BASE_URL`.
- Application realtime surfaces use the `SDKWORK_<APPLICATION_CODE>_REALTIME_*`
  family registered in `APP_RUNTIME_TOPOLOGY_NAMING.md` section 6 (for example
  `SDKWORK_IM_REALTIME_TCP_BIND_ADDR`, `SDKWORK_IM_REALTIME_CLUSTER_BUS_URL`,
  `SDKWORK_IM_REALTIME_NODE_ID`). Link transport binds are server-side only and
  `MUST NOT` be exposed to browser code. The platform cloud gateway realtime
  hosting toggle is `SDKWORK_API_CLOUD_GATEWAY_REALTIME_ENABLED`.
- Do not put secrets in names prefixed with `PORTAL_PUBLIC_`, `VITE_`, `PUBLIC_`, `NEXT_PUBLIC_`, or any variable that is exposed to browser code.
- `SDKWORK_ACCESS_TOKEN` is the unified private bootstrap access credential for every application root. It `MUST` appear in checked-in private env templates such as `.env.example` when the application calls protected app-api or backend-api surfaces. It `MUST NOT` use an app-prefixed name such as `SDKWORK_<APPLICATION_CODE>_ACCESS_TOKEN`. It `MUST NOT` be exposed through `VITE_*`, `PORTAL_PUBLIC_*`, or other browser-visible runtime config.
- `SDKWORK_AUTH_TOKEN`, `SDKWORK_REFRESH_TOKEN`, `SDKWORK_API_KEY`, app-prefixed credential env names, and `VITE_*_TOKEN` remain forbidden as live credential inputs. `auth_token`, `refresh_token`, and API keys `MUST` come from login, refresh, or approved runtime credential providers—not environment variables.
- After appbase login, registration, refresh, or current-session bootstrap succeeds, runtime session tokens from the global TokenManager `MUST` supersede env bootstrap credentials for outbound protected SDK calls. Env bootstrap credentials `MUST NOT` be merged with or override authenticated session tokens.
- Boolean variables must accept only `true`, `false`, `1`, or `0` after normalization.
- URL variables must reject query strings, fragments, control characters, protocol-relative URLs, and non-HTTP schemes unless the specific setting is documented as a database URL.

## 5. Standard Environment Variables

These variables form the baseline for SDKWork applications.

| Variable | Visibility | Required | Description |
| --- | --- | --- | --- |
| `SDKWORK_<APPLICATION_CODE>_ENVIRONMENT` | private | SHOULD | Lifecycle stage: `development`, `test`, `staging`, `demo`, `production`. |
| `SDKWORK_<APPLICATION_CODE>_CONFIG_PROFILE` | private | SHOULD | Legacy command/operator profile alias: `dev`, `test`, `staging`, `prod`. Startup must normalize it before canonical profile selection. |
| `SDKWORK_<APPLICATION_CODE>_DEPLOYMENT_PROFILE` | private | SHOULD | Application deployment architecture: `standalone` or `cloud`. |
| `SDKWORK_<APPLICATION_CODE>_RUNTIME_TARGET` | private | SHOULD | Execution target: `browser`, `desktop`, `tablet-ipados`, `tablet-android`, `capacitor-ios`, `capacitor-android`, `flutter-ios`, `flutter-android`, `android-native`, `ios-native`, `harmony-native`, `mini-program`, `server`, `container`, `test-runner`. |
| `SDKWORK_<APPLICATION_CODE>_BROWSER_ORIGIN_MODE` | private/public projection | SHOULD for browser targets | Browser page/API origin relationship: `same-origin` for standalone; `same-origin` or explicitly governed `cross-origin` for cloud. |
| `SDKWORK_<APPLICATION_CODE>_BUILD_MODE` | private/public by tool | MAY | Build tool mode. It must not replace `ENVIRONMENT`, `DEPLOYMENT_PROFILE`, or `RUNTIME_TARGET`. |
| `SDKWORK_<APPLICATION_CODE>_CONFIG_FILE` | private | MAY | Explicit runtime config file path. |
| `SDKWORK_<APPLICATION_CODE>_SERVER_CONFIG_FILE` | private | MAY | Explicit server process config file path when a PC/desktop root also owns server profiles. Defaults to `CONFIG_FILE` when absent. |
| `SDKWORK_<APPLICATION_CODE>_DESKTOP_CONFIG_FILE` | private | MAY | Explicit desktop/tablet user config file path. Defaults to the user-private SDKWork config path when absent. |
| `SDKWORK_<APPLICATION_CODE>_SDK_BASE_URL` | private | SHOULD when multiple SDK surfaces share one gateway | Common SDK root used to derive SDKWork open-api, app-api, backend-api, and documented dependency SDK base URLs. It must be a deployment root, not a resolved surface URL such as `/v1` or `/backend/v3/api`. |
| `SDKWORK_<APPLICATION_CODE>_API_BASE_URL` | private | MAY | Generic same-origin or service-side default API base URL. Prefer surface-specific variables for SDK client construction. |
| `SDKWORK_<APPLICATION_CODE>_OPEN_API_BASE_URL` | private | MAY | Server/runtime SDKWork business open-api or vendor compatibility open-api base URL declared per `API_SPEC.md` section 4.5. Business open-api paths need not include `/open`; they are any approved non-app/non-backend prefix. |
| `SDKWORK_<APPLICATION_CODE>_APP_API_BASE_URL` | private | SHOULD when app SDK is consumed | Server/runtime app-api SDK base URL, normally ending in `/app/v3/api` for SDKWork v3 app-api. |
| `SDKWORK_<APPLICATION_CODE>_BACKEND_API_BASE_URL` | private | SHOULD when backend SDK is consumed | Server/runtime backend-api SDK base URL, normally ending in `/backend/v3/api` for SDKWork v3 backend-api. |
| `SDKWORK_<APPLICATION_CODE>_<DEPENDENCY>_OPEN_API_BASE_URL` | private | MAY | Dependency open-api SDK base URL keyed by dependency SDK family/app code. |
| `SDKWORK_<APPLICATION_CODE>_<DEPENDENCY>_APP_API_BASE_URL` | private | MAY | Dependency app-api SDK base URL keyed by dependency SDK family/app code, for example appbase or Drive. |
| `SDKWORK_<APPLICATION_CODE>_<DEPENDENCY>_BACKEND_API_BASE_URL` | private | MAY | Dependency backend-api SDK base URL keyed by dependency SDK family/app code. |
| `SDKWORK_<APPLICATION_CODE>_TOKEN_MANAGER_MODE` | private | MAY | Credential strategy: `appbase-global`, `service-context`, or `test`. It configures behavior only; it must not contain token values. |
| `SDKWORK_<APPLICATION_CODE>_TOKEN_STORAGE` | private | MAY | Token storage strategy: `memory`, `browser-session`, `browser-local`, `os-secure-storage`, or `server-context`. Browser strategies must pass security review. |
| `SDKWORK_ACCESS_TOKEN` | secret | SHOULD when protected app-api/backend-api is called before interactive login | Unified private bootstrap `access_token` used to seed the global TokenManager or service-context credential provider for SaaS deployment tenant isolation. It `MUST` be a signed SDKWork access token whose claims carry current `tenant_id`, `organization_id`, `app_id`, environment, deployment profile, runtime target, and scope metadata. It `MUST NOT` use an app-prefixed env name. It `MUST NOT` be exposed to browser public runtime config. After login/session bootstrap, runtime session `accessToken` replaces this value. |
| `SDKWORK_ACCESS_TOKEN_HEADER` | private | MAY | Must be `Access-Token` for SDKWork v3 app-api/backend-api. Present only for compatibility validation, not customization. |
| `SDKWORK_AUTH_TOKEN_HEADER` | private | MAY | Must be `Authorization` for SDKWork v3 bearer auth. Present only for compatibility validation, not customization. |
| `SDKWORK_<APPLICATION_CODE>_DEFAULT_LOCALE` | private/public | MAY | Default BCP 47 locale such as `en-US` or `zh-CN`. This configures selection only; translated messages stay in i18n catalog fragments. |
| `SDKWORK_<APPLICATION_CODE>_SUPPORTED_LOCALES` | private/public | MAY | Comma-separated supported locale list. It must not contain translated message content. |
| `SDKWORK_<APPLICATION_CODE>_ACTIVE_LOCALES` | private/public | MAY | Comma-separated deployment-enabled locale list. It must be a subset of supported locales and must not contain translated message content. |
| `SDKWORK_<APPLICATION_CODE>_FALLBACK_LOCALE` | private/public | MAY | Explicit fallback locale, normally `en-US` for first-party SDKWork apps unless a product spec narrows it. |
| `SDKWORK_<APPLICATION_CODE>_I18N_CATALOG_MANIFEST_URL` | private/public | MAY | URL or path to a generated **message-catalog** manifest. The manifest points to package-local fragments or generated bundles and must not be an authored monolithic locale file. |
| `SDKWORK_<APPLICATION_CODE>_I18N_CATALOG_VERSION` | private/public | MAY | Version or content hash for the active frontend message catalog manifest. It must not contain translated message content. |
| `SDKWORK_<APPLICATION_CODE>_BACKEND_MESSAGE_BUNDLE_VERSION` | private | MAY | Version or content hash for backend message bundles used by framework problem/message resolution. It must not contain translated message content. |
| `SDKWORK_DATABASE_ENGINE` | private | MAY | `postgresql` for authoritative server/container/cloud targets; `sqlite` only for declared client-local desktop/native data. |
| `SDKWORK_DATABASE_HOST` | private | MAY | PostgreSQL host. Prefer this structured field over a URL for release deployments. |
| `SDKWORK_DATABASE_PORT` | private | MAY | PostgreSQL port, normally `5432`. |
| `SDKWORK_DATABASE_NAME` | private | MAY | Workspace PostgreSQL database name selected by environment, such as `sdkwork_ai_dev`, `sdkwork_ai_test`, `sdkwork_ai_staging`, `sdkwork_ai_demo`, or `sdkwork_ai_prod`. A `demo` environment `MUST` use a dedicated database (typically a `_demo` suffix) so guest/demonstration data never shares dev/test/prod persistence. |
| `SDKWORK_DATABASE_SCHEMA` | private | MAY | Workspace PostgreSQL schema selected by environment. It must not be derived from application code or module id. |
| `SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC` | private | MAY | PostgreSQL schema search-path compatibility switch. Defaults to and SHOULD be explicitly set to `false`; normal application, migration, bootstrap, test, and worker connections use the canonical schema only. `true` is allowed only for a dated, reviewed migration exception with collision tests and a removal milestone. Extension-owned objects outside the application schema must be schema-qualified. |
| `SDKWORK_DATABASE_USERNAME` | private | MAY | Workspace PostgreSQL username selected by environment. |
| `SDKWORK_DATABASE_PASSWORD_FILE` | secret | MAY | PostgreSQL password file path. Prefer this over direct password values. |
| `SDKWORK_DATABASE_PASSWORD` | secret | MAY | Direct PostgreSQL password override, allowed only for protected process environments or secret-bearing config files. |
| `SDKWORK_DATABASE_SSL_MODE` | private | MAY | PostgreSQL SSL mode. Production deployments should use `require`, `verify-ca`, or `verify-full` where supported. |
| `SDKWORK_DATABASE_URL` | private | MAY | Explicit database URL override. Server release packages should prefer structured runtime config fields for PostgreSQL; client-local desktop/native profiles may use SQLite. |
| `SDKWORK_DATABASE_FILE` | private | MAY | SQLite database file path for declared client-local desktop/native targets. |
| `SDKWORK_DATABASE_MAX_CONNECTIONS` | private | MAY | Database pool limit. |
| `SDKWORK_DATABASE_MODULE_ID` | private | MAY | Database lifecycle module id resolved from `database/database.manifest.json`. |
| `SDKWORK_DATABASE_AUTO_MIGRATE` | private | MAY | When `true`, service bootstrap applies pending migrations. Production SHOULD default to `false`. |
| `SDKWORK_DATABASE_SEED_ON_BOOT` | private | MAY | When `true`, service bootstrap applies required seed sets if not yet recorded. Production SHOULD default to `false`. |
| `SDKWORK_DATABASE_SEED_LOCALE` | private | MAY | Seed locale directory name. Default `zh-CN`. |
| `SDKWORK_DATABASE_SEED_PROFILE` | private | MAY | Seed profile name from `seeds/seed.manifest.json`. Default `standard`. |
| `SDKWORK_DATABASE_SEED_I18N_VERSION` | private | MAY | Database seed localization data version from `seeds/seed.manifest.json`. This configures database initialization only, not runtime locale. |
| `SDKWORK_<APPLICATION_CODE>_REGION_CODE` | private | MAY | Deployment/market region code per `REGION_SPEC.md` section 4: lowercase ASCII `^[a-z][a-z0-9_]*$`, at most 64 characters, default `global`. The region is orthogonal to the deployment profile and environment and MUST NOT become a profile-id segment. |
| `SDKWORK_<APPLICATION_CODE>_PROVIDER_REGION` | private | MAY | Cloud provider region (L2 `providerRegion`) per `REGION_SPEC.md` section 6. Cloud deployments SHOULD declare it; it MUST NOT be used as `regionCode`. |
| `SDKWORK_<APPLICATION_CODE>_CLOUD_PROVIDER` | private | MAY | Cloud provider identity per `REGION_SPEC.md` section 6. Cloud deployments SHOULD declare it. |
| `SDKWORK_DATABASE_DRIFT_INTERVAL_SEC` | private | MAY | Background drift refresh interval in seconds. Default `60`. |
| `SDKWORK_DATABASE_CONFIG_DIR` | private | MAY | Explicit workspace database configuration directory override. Defaults to the canonical OS system-scope directory from `ENVIRONMENT_SPEC.md` section 7.3: Linux/container `/etc/sdkwork/database`, macOS `/Library/Application Support/sdkwork/database`, Windows `%ProgramData%\sdkwork\database`. Production and staging database config resolves from this directory; development and test `MUST NOT` use it. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_ENABLED` | private | MAY | Enables the Redis adapter. Cloud deployments and standalone server/container targets that require shared state default to `true`; desktop user-data targets default to `false` unless shared infrastructure is explicitly enabled. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_HOST` | private | MAY | Redis host used when Redis is enabled. Prefer this structured field over a URL. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_PORT` | private | MAY | Redis port used when Redis is enabled. Defaults should normally use `6379`. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_DATABASE` | private | MAY | Redis logical database index used when Redis is enabled. Defaults should normally use `0`. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_USERNAME` | private | MAY | Optional Redis username, for ACL-enabled Redis deployments. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_URL` | private | MAY | Advanced Redis URL override used only when a managed endpoint cannot be represented cleanly with host, port, database, username, and TLS fields. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_PASSWORD_FILE` | secret | MAY | Redis password file path. Prefer this over direct Redis password values. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_PASSWORD` | secret | MAY | Direct Redis password override, allowed only for protected process environments or secret-bearing config files. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_KEY_PREFIX` | private | MAY | Optional key namespace prefix for Redis data owned by the application. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_TLS` | private | MAY | Enables TLS for structured Redis host/port/database configuration. Use `rediss://` when using the URL override. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_MAX_CONNECTIONS` | private | MAY | Redis client pool limit. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_CONNECT_TIMEOUT_MILLIS` | private | MAY | Redis connection timeout in milliseconds. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_COMMAND_TIMEOUT_MILLIS` | private | MAY | Redis command timeout in milliseconds. |
| `SDKWORK_<APPLICATION_CODE>_REDIS_POOL_IDLE_TIMEOUT_SECONDS` | private | MAY | Redis idle connection lifetime in seconds. |
| `SDKWORK_<APPLICATION_CODE>_SERVER_BIND` | private | SHOULD for services | Public service bind address, for example `0.0.0.0:3900`. |
| `SDKWORK_<APPLICATION_CODE>_TRUST_FORWARDED_HEADERS` | private | MAY | Whether reverse-proxy forwarded headers are trusted. |
| `SDKWORK_<APPLICATION_CODE>_LOG_LEVEL` | private | MAY | Runtime log filter. |
| `SDKWORK_<APPLICATION_CODE>_DATA_DIR` | private | MAY | Explicit data directory override. |
| `SDKWORK_<APPLICATION_CODE>_CACHE_DIR` | private | MAY | Explicit cache directory override. |
| `SDKWORK_<APPLICATION_CODE>_LOG_DIR` | private | MAY | Explicit file log directory override. |
| `SDKWORK_<APPLICATION_CODE>_RUNTIME_DIR` | private | MAY | Explicit runtime state directory override for PID files, sockets, locks, and generated ephemeral state. |
| `SDKWORK_<APPLICATION_CODE>_TEMP_DIR` | private | MAY | Explicit temporary file directory override. |
| `SDKWORK_<APPLICATION_CODE>_API_KEY_PEPPER` | secret | REQUIRED when API keys are issued | Pepper used for API key hashing or verification. |
| `SDKWORK_<APPLICATION_CODE>_SESSION_SECRET` | secret | REQUIRED when sessions are issued | Session signing/encryption secret. |
| `SDKWORK_<APPLICATION_CODE>_WEBHOOK_SECRET` | secret | REQUIRED when webhooks are verified | Webhook signing secret. |

Application-specific variables may be added only when they have an owner, validation rule, and documentation entry.

## 5.1 Canonical Profile Id And Env File Standard

SDKWork env files use one canonical profile id:

```text
<deploymentProfile>.<environment>
```

The complete standard matrix is:

| Profile id | Deployment topology | Lifecycle tier |
| --- | --- | --- |
| `standalone.development` | Application-owned standalone ingress | Development |
| `standalone.test` | Application-owned standalone ingress | Isolated automated or manual test |
| `standalone.staging` | Application-owned standalone ingress | Production-like rehearsal |
| `standalone.demo` | Application-owned standalone ingress | Independent demonstration/deployment showcase |
| `standalone.production` | Application-owned standalone ingress | Production |
| `cloud.development` | Explicit deployed cloud surfaces | Development |
| `cloud.test` | Explicit deployed cloud surfaces | Isolated cloud test |
| `cloud.staging` | Explicit deployed cloud surfaces | Production-like cloud rehearsal |
| `cloud.demo` | Explicit deployed cloud surfaces | Independent cloud demonstration/deployment showcase |
| `cloud.production` | Explicit deployed cloud surfaces | Production cloud |

Rules:

- Profile ids `MUST` contain exactly two segments. The first segment is only
  `standalone` or `cloud`; the second is only `development`, `test`, `staging`,
  `demo`, or `production`.
- A deployable application that declares both deployment profiles and all five
  lifecycle environments `MUST` provide all ten source profiles. A root that
  intentionally supports a smaller matrix `MUST` declare the supported
  combinations in `etc/sdkwork.deployment.config.json` and its release metadata;
  missing combinations fail selection rather than falling back.
- `dev` and `prod` are command compatibility aliases for `development` and
  `production`. New env file names, profile ids, persisted config, artifacts,
  and evidence `MUST NOT` use `.dev`, `.prod`, `local`, `private`, `saas`, or
  `self-hosted` as substitutes for a canonical profile id.
- Browser PC/H5 build dirs use the profile×environment layout
  `dist/<deploymentProfile>/<envAlias>/` under each app root — for example
  `dist/standalone/prod/`, `dist/cloud/dev/` — so standalone (same-origin) and
  cloud (unified `api-*` edge) builds coexist without overwriting each other
  (`APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1,
  `FRONTEND_CODE_SPEC.md` §7). The `dev|test|staging|prod` segments are
  environment aliases, not profile-id substitutes.
- Public hostnames follow the environment host formula in
  `APP_RUNTIME_TOPOLOGY_NAMING.md` section 9: non-production hosts use
  `<role>-<environment-suffix>.<base-domain>` (`im-dev.sdkwork.com`,
  `api-test.sdkwork.com`) and production uses the bare role host
  (`im.sdkwork.com`, `api.sdkwork.com`). The `dev`/`test`/`staging` suffix in a
  hostname is a domain-registry-only abbreviation; it does not replace the
  canonical `development`/`test`/`staging` `environment` values in profile ids,
  env keys (`SDKWORK_IM_ENVIRONMENT=development`), or materialized runtime
  documents. Profile id `cloud.development` maps to public host
  `im-dev.sdkwork.com`; the two vocabularies must not be conflated.
- Cloud profile env files `MUST` resolve the application public ingress and the
  platform API gateway to their declared environment hosts from the registry.
  A cloud profile `MUST NOT` point the application public ingress at the
  `api-*` platform host or vice versa unless the application declares
  `applicationAndApiOriginsAreDistinct: false` with a dated governance
  exception.
- Browser runtime sources follow the profile×environment file matrix
  `runtime-env.<deploymentProfile>.<environment>.json` (one source file per
  supported profile id under the app `etc/browser/` directory; sibling PC/H5
  applications share the same naming). The materialized deploy-time document
  (`/runtime-env.json`) is derived from exactly one selected source and must
  re-declare `deploymentProfile`, `environment`, `profileId`,
  `runtimeTarget`, and `browserOriginMode`.

### 5.1.0.1 Cloud API Edge (Unified `api-*` Domain Standard)

Browser clients in `cloud` profiles `MUST` target one unified cloud API edge
origin per environment instead of per-service hostnames:

| Environment | Cloud API edge origin | Example |
| --- | --- | --- |
| `development` | `https://api-dev.<base-domain>` | `https://api-dev.sdkwork.com` |
| `test` | `https://api-test.<base-domain>` | `https://api-test.sdkwork.com` |
| `staging` | `https://api-staging.<base-domain>` | `https://api-staging.sdkwork.com` |
| `production` | `https://api.<base-domain>` | `https://api.sdkwork.com` |

Rules:

- `<base-domain>` is the product's concrete main domain (for example
  `sdkwork.com`, `birdcoder.cn`). The per-environment origin is declared once
  as the environment-level `cloudApiBaseUrl` key in
  `etc/sdkwork.deployment.config.json` and is the single authoritative value
  for every browser SDK API base URL.
- Every public SDK API base URL field in a cloud browser runtime source
  (`appApiBaseUrl`, `backendApiBaseUrl`, dependency SDK base URLs such as
  `driveAppApiBaseUrl`/`appbaseAppApiBaseUrl`, and deployment SDK base URLs)
  `MUST` equal that environment's `cloudApiBaseUrl` origin. The API edge
  routes the canonical prefixes (`/app/v3/api`, `/backend/v3/api`, dependency
  prefixes) to the owning services. Per-service browser-facing hostnames
  (`server-app-dev.*`, `server-admin-*`) `MUST NOT` be used as browser SDK
  base URLs in cloud profiles.
- Navigation-only URLs (messaging, portal, docs) that are not SDK API bases
  may remain explicit per-service hostnames and are validated as absolute
  HTTP(S) URLs only.
- `standalone` browser runtime sources `MUST` declare
  `browserOriginMode = same-origin` and use the canonical root-relative path
  `/` for every SDK API base URL; the browser resolves `/app/v3/api` against
  its own origin. `standalone` is the default deployment profile when no
  profile is selected.
- File names select a candidate profile, but content remains authoritative only
  after it declares matching `environment`, `deploymentProfile`, `profileId`,
  and `runtimeTarget` values. A mismatch fails before SDK construction or host
  startup.
- `cloud.development` never inherits `standalone.development`, loopback API
  endpoints, or `cloud.production`. Required remote surface URLs are explicit.

### 5.1.1 Four Configuration Layers

Every application architecture separates these layers:

| Layer | Standard owner | Examples | Rule |
| --- | --- | --- | --- |
| Source authority | `<deployable-root>/etc/` | `sdkwork.deployment.config.json`, `topology/cloud.production.env` | Reviewed topology and safe values; one authority per deployment unit. |
| Materialized application env | Application root | `.env.cloud.production`, `env/sdkwork.cloud.production.json`, `config/mini-program/runtime-env.cloud.production.json` | Deterministic derivative selected by profile id and runtime target. |
| Host-local/private overlay | Ignored local file or secure store | `.env.cloud.development.local`, `sdkwork.cloud.development.bootstrap.local.json`, `project.private.config.json` | Secrets, developer overrides, platform credentials; never committed. |
| Runtime/operator override | Process env, installed config, secret manager, CLI | `/etc/sdkwork/...`, mounted secret, one-shot flag | Explicit late override with validation and provenance. |

`sdkwork.app.config.json` declares application identity, supported runtimes, and
release capabilities. It does not own concrete URLs, ports, environment maps, or
per-profile env values. `SOURCE_CONFIG_SPEC.md` owns source materialization and
precedence.

### 5.1.2 Required Identity Keys

Every materialized profile exposes the equivalent of these values in the
framework's canonical namespace:

| Logical field | Canonical value |
| --- | --- |
| `environment` | `development`, `test`, `staging`, `demo`, or `production` |
| `deploymentProfile` | `standalone` or `cloud` |
| `profileId` | Exact concatenation `<deploymentProfile>.<environment>` |
| `runtimeTarget` | Exact `CONFIG_SPEC.md` runtime target |
| application ingress | Application-owned public HTTP origin or base URL |
| platform/dependency surfaces | Explicit only when the selected SDK inventory requires them |

Application-scoped env keys use uppercase snake case with a normalized
`<APPLICATION_CODE>` segment. New materializers should emit both generic SDKWork
identity keys and application-scoped keys when application-specific bootstrap
code consumes them:

```text
SDKWORK_ENVIRONMENT=development
SDKWORK_DEPLOYMENT_PROFILE=standalone
SDKWORK_PROFILE_ID=standalone.development
SDKWORK_RUNTIME_TARGET=browser
SDKWORK_<APPLICATION_CODE>_ENVIRONMENT=development
SDKWORK_<APPLICATION_CODE>_DEPLOYMENT_PROFILE=standalone
SDKWORK_<APPLICATION_CODE>_PROFILE_ID=standalone.development
SDKWORK_<APPLICATION_CODE>_RUNTIME_TARGET=browser
```

Browser/Vite projections prefix public keys with `VITE_`. Flutter and private
Node/runtime projections use `SDKWORK_`. Native mini program JSON uses
`SDKWORK_` field names because it is a generated runtime document rather than a
process environment. Compatibility keys such as `API_BASE_URL`, `FLUTTER_ENV`,
or unprefixed legacy application keys are migration aliases only.

### 5.1.3 Architecture File Matrix

| Application architecture | Canonical tracked materialization | Local/private overlay | Runtime consumption |
| --- | --- | --- | --- |
| PC browser / Vite renderer | `.env.<profile-id>` | `.env.<profile-id>.local` or `.env.<profile-id>.bootstrap.local` | `vite --mode <profile-id>` and `import.meta.env.VITE_*` |
| H5 / Vite / Capacitor renderer | `.env.<profile-id>` | `.env.<profile-id>.local` or `.env.<profile-id>.bootstrap.local` | Same Vite contract; Capacitor host metadata remains separate |
| Flutter | `env/sdkwork.<profile-id>.json` | `env/sdkwork.<profile-id>.bootstrap.local.json` | `--dart-define-from-file=...` and `String.fromEnvironment` |
| WeChat native mini program | `config/mini-program/runtime-env.<profile-id>.json` | `project.private.config.json` and an ignored bootstrap overlay when required | Build copies exactly one selected safe JSON document into the platform output |
| uni-app multi-platform mini program | `.env.<profile-id>` | `.env.<profile-id>.local` | Vite/uni-app build mode; `UNI_PLATFORM` or an explicit target flag remains a separate axis |
| Native Android | `config/app/runtime-env.<profile-id>.json` | `local.properties`, ignored signing files, secure CI inputs | Build validates and packages one selected non-secret resource; host values remain Gradle/manifest config |
| Native iOS | `config/app/runtime-env.<profile-id>.json` | user `.xcconfig`, keychain/signing profiles, secure CI inputs | Build validates and packages one selected non-secret resource; host values remain Xcode/plist config |
| Native HarmonyOS | `config/app/runtime-env.<profile-id>.json` | ignored signing/profile files and secure CI inputs | hvigor projects one selected non-secret resource; host values remain JSON5/module config |
| Desktop native host | `config/desktop/<application-code>.<profile-id>.toml.example` | installed user-private TOML and OS secure storage | Host bootstrap; renderer still follows the PC Vite row |
| Node server | `.env.<profile-id>.example` or typed `etc/` JSON/TOML | `.env.<profile-id>.local`, installed config, secret manager | `SDKWORK_*` through process bootstrap |
| Spring Boot server | `application-<deployment-profile>-<environment>.yml.example` | external YAML, process env, secret manager | Spring profile is an adapter and must normalize to the canonical profile id |
| Rust server/container | `etc/<process>.<profile-id>.toml` or a referenced topology env | installed/mounted TOML, process env, secret files | Typed bootstrap with lower snake case config keys |

Libraries, generated SDKs, UI packages, and embedded-only modules do not own
profile files. They receive typed configuration from the deployable bootstrap.
Lifecycle-only host metadata examples such as `capacitor.production.example.json`,
`flutter.production.example.json`, or `mp-weixin.production.example.json` are
not env authorities. They may remain one-dimensional only when their package,
permission, signing-reference, or store metadata is identical for standalone
and cloud; endpoint and topology values never belong in those host files.

### 5.1.4 PC And H5 Vite Format

PC browser and H5 roots use Vite public env files as deterministic derivatives:

```dotenv
# .env.standalone.development
VITE_SDKWORK_ENVIRONMENT=development
VITE_SDKWORK_DEPLOYMENT_PROFILE=standalone
VITE_SDKWORK_PROFILE_ID=standalone.development
VITE_SDKWORK_RUNTIME_TARGET=browser
VITE_SDKWORK_<APPLICATION_CODE>_BROWSER_ORIGIN_MODE=same-origin
VITE_<APP_CODE>_SDK_BASE_URL=/
```

```dotenv
# .env.cloud.development
VITE_SDKWORK_ENVIRONMENT=development
VITE_SDKWORK_DEPLOYMENT_PROFILE=cloud
VITE_SDKWORK_PROFILE_ID=cloud.development
VITE_SDKWORK_RUNTIME_TARGET=browser
VITE_SDKWORK_<APPLICATION_CODE>_APPLICATION_PUBLIC_HTTP_URL=https://im-dev.sdkwork.com
VITE_SDKWORK_<APPLICATION_CODE>_PLATFORM_API_GATEWAY_HTTP_URL=https://api-dev.sdkwork.com
```

```dotenv
# .env.cloud.production
VITE_SDKWORK_ENVIRONMENT=production
VITE_SDKWORK_DEPLOYMENT_PROFILE=cloud
VITE_SDKWORK_PROFILE_ID=cloud.production
VITE_SDKWORK_RUNTIME_TARGET=browser
VITE_SDKWORK_<APPLICATION_CODE>_APPLICATION_PUBLIC_HTTP_URL=https://im.sdkwork.com
VITE_SDKWORK_<APPLICATION_CODE>_PLATFORM_API_GATEWAY_HTTP_URL=https://api.sdkwork.com
```

Rules:

- `VITE_*` is the canonical renderer namespace. Non-`VITE_` values loaded by
  Node-side orchestration are private to the build/bootstrap process and must
  not be read from browser modules.
- `vite --mode standalone.development` loads
  `.env.standalone.development`; `vite build --mode cloud.production` loads
  `.env.cloud.production`.
- If one immutable browser artifact is promoted across environments, build env
  selects only safe build facts and deploy tooling emits `/runtime-env.js` or
  `/runtime-env.json` with the same logical fields. Runtime config loads before
  SDK clients.
- Browser-visible env contains no `SDKWORK_ACCESS_TOKEN`, auth token, refresh
  token, API key, database URL, Redis URL, signing value, or private endpoint.
- Standalone Vite output contains no absolute application-ingress target URL.
  The Node-side dev server reads that target from the parent topology profile;
  browser modules receive same-origin SDK paths only.

#### 5.1.4.1 VITE And PORTAL_PUBLIC Lifecycle

Rules:

- `VITE_*` keys are the authored browser contract. They are injected at build time and are the only browser-visible env keys. Browser bundles must not read `process.env` directly.
- `PORTAL_PUBLIC_*` keys are the runtime contract. They are injected at runtime and are the only runtime env keys. Browser bundles must not read `import.meta.env` directly.
- In `standalone` browser development, authored `VITE_*` same-origin relative API paths `MUST` win over any `PORTAL_PUBLIC_*` value derived from a dev launcher or shared gateway ingress. A dev runner `MUST NOT` inject absolute `PORTAL_PUBLIC_SDK_BASE_URL` or per-dependency absolute SDK base URLs when the browser contract is same-origin mounted.
- In `cloud` browser/runtime config, public ingress and platform gateway URLs `MUST` be materialized into `PORTAL_PUBLIC_*` (or equivalent runtime config) from topology. Per-surface and per-dependency absolute base URLs `MUST` remain available when selected surfaces route to different hosts.
- When both `VITE_*` and `PORTAL_PUBLIC_*` exist for the same logical surface, resolution order is:
  1. explicit per-SDK override in authored runtime config or component spec;
  2. authored `VITE_*` same-origin relative path in `standalone` dev;
  3. topology-derived `PORTAL_PUBLIC_*` absolute URL in `cloud` or packaged runtime;
  4. fail closed when the resolved base URL is empty for a required SDK client.
- SDK client factories `MUST NOT` pre-strip canonical API path prefixes before passing `config.baseUrl` to generated SDK clients when the authored value is a same-origin relative path such as `/app/v3/api`. Prefix normalization belongs to the generated SDK transport layer and must preserve non-empty relative origins.

### 5.1.5 Flutter Dart-Define JSON Format

Flutter roots use JSON because `--dart-define-from-file` is the native build
input:

```json
{
  "SDKWORK_ENVIRONMENT": "development",
  "SDKWORK_DEPLOYMENT_PROFILE": "standalone",
  "SDKWORK_PROFILE_ID": "standalone.development",
  "SDKWORK_RUNTIME_TARGET": "flutter-android",
  "SDKWORK_<APPLICATION_CODE>_APPLICATION_PUBLIC_HTTP_URL": "http://10.0.2.2:10240"
}
```

Example commands:

```text
flutter run --dart-define-from-file=env/sdkwork.standalone.development.json
flutter build appbundle --dart-define-from-file=env/sdkwork.cloud.production.json
flutter build ipa --dart-define-from-file=env/sdkwork.cloud.production.json
```

Rules:

- `SDKWORK_*` is the canonical Flutter namespace and is read through
  `String.fromEnvironment(...)` or a typed wrapper.
- Android emulator, iOS simulator, physical-device, LAN, and cloud origins are
  explicit source values. A materializer must not guess host-loopback aliases.
- A live bootstrap token may exist only in the ignored
  `sdkwork.<profile-id>.bootstrap.local.json` development/test overlay and must
  never enter a release artifact.

### 5.1.6 Mini Program Formats

WeChat native mini program roots use a generated runtime JSON document:

```json
{
  "SDKWORK_ENVIRONMENT": "production",
  "SDKWORK_DEPLOYMENT_PROFILE": "cloud",
  "SDKWORK_PROFILE_ID": "cloud.production",
  "SDKWORK_RUNTIME_TARGET": "mini-program",
  "SDKWORK_<APPLICATION_CODE>_APPLICATION_PUBLIC_HTTP_URL": "https://mini.example.com",
  "SDKWORK_<APPLICATION_CODE>_PLATFORM_API_GATEWAY_HTTP_URL": "https://api.example.com"
}
```

The build command selects the profile explicitly and records it in a build
manifest:

```text
node scripts/build-mini-program.mjs --deployment-profile cloud --environment production
```

Rules for WeChat native mini programs:

- The selected `config/mini-program/runtime-env.<profile-id>.json` is copied or
  compiled into one deterministic public runtime module before `App()` starts.
- `project.config.json` owns safe shared WeChat tooling metadata.
  `project.private.config.json` owns developer-local IDE settings and stays
  ignored. App secrets, upload private keys, and signing credentials stay in
  platform/CI secret storage.
- Source packages do not call `wx.request` as a config fallback and do not read
  arbitrary process env at runtime.

uni-app multi-platform mini program roots use the Vite naming contract:

```dotenv
# .env.cloud.production
VITE_SDKWORK_ENVIRONMENT=production
VITE_SDKWORK_DEPLOYMENT_PROFILE=cloud
VITE_SDKWORK_PROFILE_ID=cloud.production
VITE_SDKWORK_RUNTIME_TARGET=mini-program
VITE_SDKWORK_<APPLICATION_CODE>_APPLICATION_PUBLIC_HTTP_URL=https://mini.example.com
```

Example:

```text
uni build -p mp-weixin --mode cloud.production
uni build -p mp-alipay --mode cloud.production
```

`mp-weixin`, `mp-alipay`, `mp-dingtalk`, and other platform values are target
platforms, not profile-id segments. One mini program root selects exactly one
framework authority: native WeChat for `weixin-mini-program`, or uni-app for a
declared multi-platform matrix. It must not keep both as competing source trees.

### 5.1.7 Local Overrides, Secrets, And Migration

Ignored files include, as applicable:

```text
.env.local
.env.<profile-id>.local
.env.<profile-id>.bootstrap.local
env/sdkwork.<profile-id>.bootstrap.local.json
etc/**/*.local.*
etc/secrets/
config/**/*.local.*
project.private.config.json
local.properties
*.keystore
*.jks
*.p12
*.mobileprovision
```

Rules:

- Tracked materialized env files are safe, deterministic build/runtime inputs.
  They contain no live credential values, even when a key name is present as an
  empty documented placeholder.
- Development/test bootstrap credentials come from the correct backend/app
  login context and are written only to ignored bootstrap overlays.
- `staging` and `production` secrets come from secret managers, mounted secret
  files, protected process env, OS secure storage, or platform signing systems.
- Legacy `.env.development`, `.env.production`, `runtime-env.production.json`,
  `sdkwork.prod.json`, and similar one-dimensional files must migrate to the
  canonical two-dimensional name. Compatibility readers may warn during a
  bounded migration but must not dual-write old and new authorities.
- Reference examples live under `templates/environment/`; application-specific
  values are materialized from that application's `etc/`, not copied back into
  the standards repository.

## 5.2 Desktop, Server, Container, And Browser Config Profiles

Runtime target profiles must remain separate even when they are launched from
one PC application root.

| Runtime target | Default config location | Default persistence | Standard profile behavior |
| --- | --- | --- | --- |
| `browser` | `/runtime-env.js` or `/runtime-env.json` served by the trusted host | Browser storage only through approved auth/session adapter | Public SDK URLs and flags only; no secrets, database URLs, or private endpoints. |
| `desktop` | `~/.sdkwork/<application-code>/config/<application-code>.toml` or `%USERPROFILE%\.sdkwork\<application-code>\config\<application-code>.toml` | SQLite under SDKWork user-private data directory | Installed desktop runtime; may start local services but desktop user config stays separate. |
| `tablet-ipados` | Platform app-private config plus approved Tauri iOS config | SQLite or approved encrypted platform-local storage | Same PC renderer and SDK/IAM runtime; iPadOS packaging metadata is target config. |
| `tablet-android` | Platform app-private config plus approved Tauri Android config | SQLite or approved encrypted platform-local storage | Same PC renderer and SDK/IAM runtime; Android package/signing metadata is target config. |
| `capacitor-ios` | H5 mobile `config/browser` plus `config/host` Capacitor iOS profile and platform app-private storage | Approved secure storage adapter; local caches only | Same H5 mobile renderer and SDK/IAM runtime; iOS package/signing metadata is host config. |
| `capacitor-android` | H5 mobile `config/browser` plus `config/host` Capacitor Android profile and platform app-private storage | Approved secure storage adapter; local caches only | Same H5 mobile renderer and SDK/IAM runtime; Android package/signing metadata is host config. |
| `flutter-ios` | Flutter `config/app` plus `config/host` iOS profile and platform app-private storage | Approved secure storage adapter; local caches only | Generated Dart SDK/IAM runtime; iOS package/signing metadata is host config. |
| `flutter-android` | Flutter `config/app` plus `config/host` Android profile and platform app-private storage | Approved secure storage adapter; local caches only | Generated Dart SDK/IAM runtime; Android package/signing metadata is host config. |
| `android-native` | Android native `config/app` plus `config/host` Android profile and platform app-private storage | Approved secure storage adapter; local caches only | Generated Kotlin/Java SDK/IAM runtime; Android package/signing metadata is host config. |
| `ios-native` | iOS native `config/app` plus `config/host` iOS profile and platform app-private storage | Approved secure storage adapter; local caches only | Generated Swift SDK/IAM runtime; iOS package/signing metadata is host config. |
| `harmony-native` | Harmony native `config/app` plus `config/host` Harmony profile and platform app-private storage | Approved secure storage adapter; local caches only | Generated ArkTS/TypeScript SDK/IAM runtime adapted for Harmony; Harmony package/signing metadata is host config. |
| `mini-program` | Mini program `config/mini-program` plus `config/host` platform profile | Platform storage through approved host adapter | Generated TypeScript app SDK or approved wrapper; platform pages/subpackages are route projections. |
| `server` | `/etc/sdkwork/<application-code>/<process>.toml` or `%ProgramData%\sdkwork\<application-code>\<process>.toml` | PostgreSQL, Redis when required | Long-running service, explicit bind, reverse proxy assumptions, strict secret handling. |
| `container` | Mounted `/etc/sdkwork/<application-code>/<process>.toml`, env, and `/run/secrets/...` | External PostgreSQL/Redis or mounted volumes | Image contains examples only; runtime config and secrets are injected. |
| `test-runner` | Ephemeral generated config under test temp directory | Isolated PostgreSQL schema/database for server tests; isolated SQLite file only for client-local tests | No shared dev/prod state; deterministic cleanup; evidence is role-specific. |

Rules:

- The runtime target table above is an exhaustive config profile matrix for
  application runtime targets. Environment templates, TOML files, generated
  public runtime JSON, native host config, and workflow env must use these
  exact values from `CONFIG_SPEC.md`.
- Docker-compatible deployments `MUST` declare `runtime_target = "container"`.
  `docker` is allowed only as tooling/provider/package-format wording, not as
  a runtime target or deployment profile value.
- `pnpm dev` for a PC root starts the browser renderer unless the local app spec says otherwise.
- `pnpm dev:server` starts the server process with the development server config profile.
- `pnpm dev:desktop` starts the desktop shell and may also start a server process, but the server process reads the server development profile, not the installed desktop profile.
- Installed desktop packages use `deployment_profile = "standalone"` and `runtime_target = "desktop"` by default.
- Standalone server packages use `deployment_profile = "standalone"` and `runtime_target = "server"` by default.
- Standalone single-container packages use `deployment_profile = "standalone"` and `runtime_target = "container"` by default.
- Cloud container packages use `deployment_profile = "cloud"` and `runtime_target = "container"` by default.
- Test runners use `environment = "test"` and `runtime_target = "test-runner"` even when the code under test is a server or desktop runtime.
- A config validator must fail if a production server profile contains localhost API endpoints, development-only secrets, test database names, writable developer directories, or placeholder passwords.

## 6. SDK Base URL Standard

Development profile routing rules:

- `standalone.development` Base URLs resolve to the local standalone
  `application.public-ingress`. Dependency APIs classified as same-origin are
  dependency-owned Rust assembly contributions linked into that gateway process;
  they do not receive a separate gateway origin or listener.
- For a standalone browser delivery, private server/Node Base URLs resolve to
  `application.public-ingress`, while browser public/Vite Base URLs resolve to
  the browser-visible origin. Development normally represents the latter with
  `/` and routes it through the declared canonical-path dev-server proxy.
- Every standalone browser runtime source declares
  `browserOriginMode = same-origin`. Its public/Vite SDK Base URL values are
  root-relative paths, never absolute renderer, application-ingress,
  dependency, or loopback URLs; browser bootstrap resolves the paths against
  `window.location.origin`.
- Standalone production browser public config also uses same-origin paths. The
  `gateway-static` host serves those paths and the application APIs on the same
  `application.public-ingress` origin.
- `platform.api-gateway` server and browser URL keys are cloud-only. They `MUST`
  be absent from standalone env profiles and from materialized standalone
  runtime config.
- Environment resolvers that replace database URL, credential, schema, or
  module identity keys from a canonical source file `MUST` preserve process
  database governance keys such as `SDKWORK_DATABASE_TEMPORARY_*`. These keys
  control capacity reservation before canonical pool creation and are not
  database identity overrides.
- `cloud.development` Base URLs resolve to already deployed cloud application
  and platform surfaces. They must be explicit source config values and must
  not inherit standalone loopback defaults or production endpoints.
- Application and platform SDK roots may resolve to the same deployed origin,
  but source config does not identify the remote gateway implementation.
  Surface paths remain SDK/API-authority owned even when origins are identical.
- Protocol-specific edge ingress URLs require a topology surface and ADR; they
  are not implicit alternatives to the application HTTP surface.
- Installed client profile/endpoint switching must namespace secure storage,
  tokens, cookies, caches, offline queues, local databases, and update state by
  application identity, active profile, environment, and normalized origin.
  Switching across that boundary requires re-authentication.
- A browser client started by `dev:cloud` may use a local development origin,
  but the cloud development API must authorize only the declared development
  origins under the shared Web Framework CORS policy. This does not permit a
  production wildcard origin.
- Missing, placeholder, or unauthorized cloud development endpoints fail
  bootstrap with redacted diagnostics before SDK client construction.

Generated SDK bootstrap must resolve explicit base URLs for each SDK surface
before constructing generated clients. It may start from one common API edge
origin only when topology proves that edge serves every derived surface;
otherwise application and platform surfaces resolve independently.

| SDK surface | Private server/runtime env | Public browser runtime env | Vite/dev-server public env | Default |
| --- | --- | --- | --- | --- |
| Common API edge origin | `SDKWORK_<APPLICATION_CODE>_SDK_BASE_URL` | `PORTAL_PUBLIC_SDK_BASE_URL` | `VITE_<APP_CODE>_SDK_BASE_URL` | Optional topology-declared origin that serves every derived surface. |
| Public API reference / generic OpenAPI display | `SDKWORK_<APPLICATION_CODE>_API_BASE_URL` | `PORTAL_PUBLIC_API_BASE_URL` | `VITE_API_BASE_URL` | Same-origin API path, app-specific. |
| SDKWork business open-api SDK or vendor compatibility open-api surface | `SDKWORK_<APPLICATION_CODE>_OPEN_API_BASE_URL` | `PORTAL_PUBLIC_OPEN_API_BASE_URL` | `VITE_<APP_CODE>_OPEN_API_BASE_URL` | Resolved from its declared application/platform surface or a proven common API edge origin. |
| App/user SDK | `SDKWORK_<APPLICATION_CODE>_APP_API_BASE_URL` | `PORTAL_PUBLIC_APP_API_BASE_URL` | `VITE_<APP_CODE>_APP_API_BASE_URL` | Resolved from `application.public-ingress`, optionally through a proven common API edge origin. |
| `backend-admin` SDK | `SDKWORK_<APPLICATION_CODE>_BACKEND_API_BASE_URL` | `PORTAL_PUBLIC_BACKEND_API_BASE_URL` | `VITE_<APP_CODE>_BACKEND_API_BASE_URL` | Resolved from the owning application/platform surface; browser exposure still requires `backend-admin`. |
| Dependency open-api SDK | `SDKWORK_<APPLICATION_CODE>_<DEPENDENCY>_OPEN_API_BASE_URL` | `PORTAL_PUBLIC_<DEPENDENCY>_OPEN_API_BASE_URL` | `VITE_<APP_CODE>_<DEPENDENCY>_OPEN_API_BASE_URL` | Cloud: resolved from `platform.api-gateway` unless an explicit dependency surface override applies. Standalone same-origin: resolved from `application.public-ingress` with verified assembly mount coverage. |
| Dependency app-api SDK | `SDKWORK_<APPLICATION_CODE>_<DEPENDENCY>_APP_API_BASE_URL` | `PORTAL_PUBLIC_<DEPENDENCY>_APP_API_BASE_URL` | `VITE_<APP_CODE>_<DEPENDENCY>_APP_API_BASE_URL` | Cloud: resolved from `platform.api-gateway`. Standalone same-origin: resolved from `application.public-ingress` with verified assembly mount coverage. |
| Dependency backend-api SDK | `SDKWORK_<APPLICATION_CODE>_<DEPENDENCY>_BACKEND_API_BASE_URL` | `PORTAL_PUBLIC_<DEPENDENCY>_BACKEND_API_BASE_URL` | `VITE_<APP_CODE>_<DEPENDENCY>_BACKEND_API_BASE_URL` | Cloud: resolved from `platform.api-gateway`. Standalone same-origin: resolved from `application.public-ingress` with verified backend assembly mount coverage. |

Rules:

- SDKWork business open-api SDK and vendor compatibility open-api configuration must use `OPEN_API_BASE_URL` terminology. For SDKWork business open-api SDKs, the value `MUST` be that domain's approved non-app/non-backend prefix from `API_SPEC.md` section 4.5.1, for example `/im/v3/api`; it does not imply a literal `/open` path segment. Vendor compatibility prefixes such as `/v1` are valid only for operations declared with `x-sdkwork-wire-protocol: external` per section 4.5.2 and must not be used as the default for new SDKWork-owned business open-api domains. `gateway` can remain an internal system id when the generated schema or UI already uses it, but environment names should describe the SDK surface.
- A common API edge origin must not itself be a resolved surface URL such as
  `/v1`, `/app/v3/api`, or `/backend/v3/api`. A surface URL may be configured
  only through the matching surface or SDK-specific override.
- App SDK and `backend-admin` SDK clients must receive explicit resolved base
  URLs after config resolution because they may terminate at different hosts in
  cloud or customer-owned multi-host deployments.
- Appbase, Drive, IM, payment, media, or other dependency SDK override variables must be keyed by dependency SDK family/app code. Do not hide dependency base URLs behind an application-local `API_BASE_URL` when the dependency can be deployed independently.
- Browser public runtime config may expose SDK base URLs only when the browser is allowed to call that SDK surface directly. `backend-admin` base URLs must not be exposed to user-facing app UI or PC user console UI unless that route surface is explicitly `backend-admin`.
- Standalone browser Base URLs `MUST` be same-origin paths so remote browsers
  are not given loopback or internal listener addresses. An absolute URL is not
  a valid standalone source value even when it currently matches the page
  origin. Cloud browser defaults
  should also be same-origin paths when one edge serves all surfaces.
  Dependency SDK same-origin defaults are allowed only when
  `dependencyApiSurfaces` records verified mount coverage for that dependency
  surface.
- Dependency backend-api SDK override variables such as
  `SDKWORK_<APPLICATION_CODE>_APPBASE_BACKEND_API_BASE_URL`,
  `PORTAL_PUBLIC_APPBASE_BACKEND_API_BASE_URL`, and
  `VITE_SDKWORK_APPBASE_BACKEND_API_BASE_URL` are optional when `SDK_BASE_URL` points to a verified gateway that serves the dependency backend routes. They `MUST` be configured explicitly when the dependency backend is deployed elsewhere or when mount coverage is not documented.
- A checked-in example may leave a required external dependency backend base URL empty to force deployment configuration, but it `MUST NOT` set that dependency URL to `/backend/v3/api` or another application-owned default without matching `dependencyApiSurfaces` coverage evidence.
- Absolute HTTP/HTTPS origins must be added to the production Content Security Policy `connect-src`.
- Generated SDK examples must not hard-code tenant-specific hosts.
- Base URL values must not include query strings, fragments, embedded credentials, API keys, tokens, or tenant-specific secret material.
- Environment variable names ending in `_REFRESH_TOKEN`, `_AUTH_TOKEN`, `_API_KEY`, or browser/public `*_TOKEN` are forbidden as live credential inputs unless a spec explicitly marks the variable as a test-only fixture. `SDKWORK_ACCESS_TOKEN` is the only allowed private bootstrap access credential according to section 6.1. Production browser configs must fail validation when bootstrap or session token values are exposed through `VITE_*` or `PORTAL_PUBLIC_*`.

### 6.1 Access Token And Credential Configuration

Every SDKWork application that consumes protected app-api or backend-api surfaces
`MUST` treat `Access-Token` as a mandatory outbound credential whenever a
credential is available. Tenant, organization, app, environment, deployment
profile, runtime target, and scope context `MUST` be carried inside signed token
claims, not in client-writable request fields or SDKWork context-projection
headers.

Credential sources:

| Phase | `access_token` source | `auth_token` source | Rule |
| --- | --- | --- | --- |
| Service/bootstrap | `SDKWORK_ACCESS_TOKEN` in private env or secret manager | Appbase IAM login/registration/refresh/current-session only | Used only before interactive login or for approved service-context runtimes (`server`, `container`, `test-runner`, and documented desktop service contexts). |
| Interactive session | Appbase IAM login/registration/refresh/current-session response | Same appbase IAM response | Replaces bootstrap credentials in TokenManager, session store, and context store. |
| Browser/renderer | TokenManager session storage after login | TokenManager session storage after login | `MUST NOT` read live tokens from `VITE_*`, `PORTAL_PUBLIC_*`, or public runtime config. |

Bootstrap lifecycle policy:

| Environment | Private bootstrap source | Missing-token behavior | Browser artifact rule |
| --- | --- | --- | --- |
| `development` | Existing private `SDKWORK_ACCESS_TOKEN`, otherwise the shared IAM manifest-based local generator | May generate a disposable local JWT | The IAM serve-only Vite plugin may inject the canonical credential-entry global before application modules execute. |
| `test` | Explicit test token, otherwise the shared generator only when the isolated runner opts in | Fail unless a token exists or `allowTestTokenGeneration: true` is set | Injection requires the separate `allowTestInjection: true` opt-in. |
| `staging` | Secret manager, mounted secret, protected host env, or equivalent private runtime source | Fail closed | Never embed in HTML, bundles, public env, or static runtime config. |
| `production` | Secret manager, mounted secret, protected host env, or equivalent private runtime source | Fail closed | Never embed in HTML, bundles, public env, or static runtime config. |

The canonical Node owners are `@sdkwork/iam-application-bootstrap` `ensureRepoBootstrapAccessToken(...)`, `sdkwork-iam/scripts/dev/ensure-repo-bootstrap-access-token.mjs`, `sdkwork-space/bin/with-bootstrap-token.mjs`, and loopback fixture merge through `sdkwork-iam/scripts/dev/create-dev-bootstrap-access-token-env.mjs`. The canonical Vite owner is `@sdkwork/iam-credential-entry/vite`. Application repositories `MUST NOT` copy fixture JWT creation, manifest identity lookup, env merge, private bootstrap env-file parsing, inline serialization, or canonical global assignment. `process.env.SDKWORK_ACCESS_TOKEN` Vite define replacement is forbidden as the browser handoff because it is not reliable for linked client source in Vite 6.

| Credential | Source | Header | Env/config rule |
| --- | --- | --- | --- |
| Auth token | Appbase IAM session/login/refresh/current-session only | `Authorization: Bearer <auth_token>` | Forbidden in environment variables. Forbidden in browser public runtime config. |
| Access token | Appbase IAM session/login/refresh/current-session, or private bootstrap `SDKWORK_ACCESS_TOKEN` before login | `Access-Token: <JWT access_token>` | `SDKWORK_ACCESS_TOKEN` `SHOULD` be configured for every application root that calls protected APIs. Value `MUST` be a signed JWT, not a semicolon claim string. Forbidden in browser public runtime config. Superseded by session tokens after login. |
| Refresh token | Appbase IAM refresh flow only | Not sent on business API requests | Not allowed in env or browser public runtime config. Storage is controlled by appbase IAM runtime. |
| API key | Open-api credential provider for `api-key` or `open-api-flexible` mode | `X-API-Key` or declared scheme | Not allowed in environment variables. Raw value may exist only in protected secret manager, server-side non-env config, OS secure storage, or test fixture. Never in browser public runtime config. |
| OAuth bearer | Open-api credential provider for `oauth` or `open-api-flexible` mode | `Authorization: Bearer <token>` | Raw value may exist only in protected secret manager, server-side config, OS secure storage, or test fixture. Never in browser public runtime config. |

Rules:

- Protected app-api and backend-api SDK requests `MUST` send `Access-Token: <JWT access_token>` whenever the runtime has an access token available from bootstrap or session state.
- Protected app-api and backend-api SDK requests `MUST` send `Authorization: Bearer <auth_token>` whenever the runtime has an auth token available from bootstrap or session state.
- App-api and backend-api SDK clients must obtain runtime session tokens through the global TokenManager or language-equivalent credential provider. Service/bootstrap runtimes may seed that provider from `SDKWORK_ACCESS_TOKEN` only.
- When both bootstrap/session `auth_token` and `access_token` are present, frameworks and runtimes `MUST` treat overlapping principal and tenancy claims from `auth_token` as authoritative. Overlapping fields are: `sub`/`user_id`, `sid`/`session_id`, `tenant_id`, `organization_id`, `login_scope`, and `auth_level`. Access-isolation-only fields such as `data_scope`, `permission_scope`, deployment profile, runtime target, and sharding hints remain authoritative from `access_token`.
- If `access_token` carries an overlapping claim that contradicts the authoritative `auth_token` value after normalization, the request `MUST` be rejected.
- TokenManager config may be controlled by `SDKWORK_<APPLICATION_CODE>_TOKEN_MANAGER_MODE` and `SDKWORK_<APPLICATION_CODE>_TOKEN_STORAGE`, but those variables describe behavior only and must never contain token values.
- TokenManager config may be controlled by `SDKWORK_<APPLICATION_CODE>_TOKEN_MANAGER_MODE` and `SDKWORK_<APPLICATION_CODE>_TOKEN_STORAGE`, but those variables describe behavior only and must never contain token values.
- `SDKWORK_ACCESS_TOKEN_HEADER` may exist only to assert that the runtime uses `Access-Token`; SDKWork v3 applications must reject any value other than `Access-Token`.
- `SDKWORK_AUTH_TOKEN_HEADER` may exist only to assert that the runtime uses `Authorization`; SDKWork v3 applications must reject any value other than `Authorization`.
- Browser public runtime config must never include token manager state, token storage contents, refresh tokens, API keys, or generated `getAuthHeaders()` output.
- Staging and production build commands must produce byte-identical credential-free browser artifacts regardless of whether the build host process has `SDKWORK_ACCESS_TOKEN` set.
- Desktop apps should store tokens through OS secure storage or approved encrypted storage. Server-side service contexts should use typed request context or trusted service credentials, not `.env` session tokens.
- Test fixtures may contain fake token strings only when the file is clearly test-only, excluded from production bundles, and covered by static scans that prevent reuse in release config.
- Runtime env, tracked `.env.example`, bootstrap overlays, runtime TOML, and public runtime config `MUST NOT` define fixed IAM identity scope through `SDKWORK_IAM_BOOTSTRAP_*`, `SDKWORK_IAM_LOCAL_*`, `SDKWORK_USER_CENTER_BOOTSTRAP_*`, runtime `SDKWORK_APP_ID`, `VITE_SDKWORK_APP_ID`, or equivalent tenant/organization/user/owner bootstrap variables. Current tenant, organization, user, session, and app scope `MUST` come from dual-token JWT claims after login according to `IAM_LOGIN_INTEGRATION_SPEC.md`.
- Release and CI tooling `MAY` use `SDKWORK_APP_ID` only as build or workflow metadata. That variable `MUST NOT` be read by live IAM runtime, TokenManager, or protected SDK client scope resolution.

### 6.2 Standalone Same-Origin Versus Cloud Independent API Base URLs

This section is the normative decision matrix for browser SDK base URL configuration across deployment profiles. Authority for assembly composition remains `API_ASSEMBLY_SPEC.md`; authority for topology materialization remains `CONFIG_SPEC.md` and `DEPLOYMENT_SPEC.md`.

| Concern | `standalone` profile | `cloud` profile |
| --- | --- | --- |
| Browser SDK base URL default | Same-origin relative canonical API paths (`/app/v3/api`, `/feeds/v3/api`, …) | Absolute URLs from `application.public-ingress` and `platform.api-gateway` |
| API process ownership | Application `sdkwork-api-<application-code>-standalone-gateway` started by the application dev runner or packaged artifact | Deployed application and platform API surfaces; no local standalone gateway in cloud runners |
| Dev ingress | One browser-visible origin; internal API listener reached through Vite `dev-server-proxy` or equivalent canonical-path proxy | Public ingress URL(s) declared in topology |
| Dependency APIs in standalone | Selected into the application standalone gateway through `dependencyApiSurfaces` and `API_ASSEMBLY_SPEC.md` §6.1 | Resolved from deployed platform/application surfaces or explicit per-dependency absolute base URLs |
| Forbidden browser defaults | Pointing generated SDK clients at sibling module dev ports (`8095`, `18095`, `3902`, …) when same-origin federation is declared | Assuming localhost or undeclared private upstreams |

Rules:

- `standalone` browser clients `MUST` default to same-origin relative SDK base URLs for every surface mounted on the application standalone gateway. Example authored keys: `VITE_<APP_CODE>_APP_API_BASE_URL=/app/v3/api`, `VITE_<APP_CODE>_FEEDS_APP_API_BASE_URL=/feeds/v3/api`.
- `standalone` dev runners `MUST` proxy those canonical paths to the application standalone gateway listener. The browser `MUST NOT` be configured to call dependency-owned standalone gateway ports directly when `dependencyApiSurfaces.runtimeMode` is `same-origin` or `same-origin-mounted`.
- `cloud` browser and server runtime `MUST` resolve SDK base URLs from declared topology: application-owned surfaces from `application.public-ingress`, platform dependency surfaces from `platform.api-gateway`, and explicit overrides per `dependencyApiSurfaces` when surfaces are not co-hosted.
- Each application `MUST` be able to start its `sdkwork-api-<application-code>-standalone-gateway` independently and serve composed APIs on a declared listener without requiring sibling application repositories to be running, except for explicitly declared external upstream overrides in topology or dev profile.
- Standalone gateway completeness `MUST` follow `API_ASSEMBLY_SPEC.md` §6.1.1: every `dependencyApiSurfaces` entry with `runtimeMode` `same-origin` or `same-origin-mounted` `MUST` be integrated into the application api-assembly with matching route manifests, OpenAPI inventories, and verification evidence.
- Environment examples, dev launcher output, and HAR-visible browser requests `MUST` reflect the selected profile. A `standalone` example `MUST NOT` document absolute sibling-module ports as the default browser contract when same-origin federation is the declared integration mode.

## 7. Database Selection Standard

Database defaults depend on `deploymentProfile` and `runtimeTarget`.

Standalone server/container targets and cloud targets default to PostgreSQL
through runtime TOML, environment, or orchestration config. Desktop user data
remains SQLite by default. Desktop/Tauri development commands that start a
backend service use PostgreSQL to exercise server behavior, but that does not
change the desktop package database default. `SDKWORK_DATABASE_URL` is an
explicit operator override, not the primary production configuration path.
Application root `pnpm dev:browser` and `pnpm dev:desktop` are development
orchestration defaults, not installer defaults: both must select the
PostgreSQL development profile, `deploymentProfile = standalone`, and
`environment = development` unless an explicit suffixed command selects cloud.
An explicit SQLite suffix may select a client-local database test/profile only;
it `MUST NOT` select SQLite for a backend service.

| Deployment profile | Runtime target | Default database | Requirement |
| --- | --- | --- | --- |
| `standalone` | `desktop` | SQLite for declared client-local data; PostgreSQL for any launched backend service | Desktop client-local data uses a user-private SQLite file. Desktop-started backend services always use the server PostgreSQL profile. |
| `standalone` | `server` | PostgreSQL | Development, test, release, and installed server packages use PostgreSQL for authoritative relational state. |
| `standalone` | `container` | PostgreSQL | Single-container packages keep database state external or on explicit mounted volumes; do not store production DB state in ephemeral layers. |
| `cloud` | `server` or `container` | Managed PostgreSQL or qualified compatible service | Must satisfy `DATABASE_SPEC.md`, PostgreSQL conformance, secret handling, readiness, backup, and rollback requirements. |
| `standalone` or `cloud` | `test-runner` | Isolated PostgreSQL for server tests; isolated SQLite only for client-local tests | Test DB must be isolated per test run and may prove only its declared database role. |

### 7.1 Unified Workspace PostgreSQL Profile

All SDKWork applications in one workspace share one PostgreSQL connection identity per lifecycle environment and deployment profile. The canonical contract is owned by `sdkwork-specs/templates/env.postgres.example` and uses `SDKWORK_DATABASE_*` keys; workspace or deployment infrastructure materializes its values. In a workspace environment, every application service, embedded dependency module, gateway-owned route module, worker, bootstrap command, and migration command resolves the same endpoint, database name, schema, and credential identity for that environment. Application-specific alternatives such as `sdkwork_cloudrouter_dev`, `sdkwork_drive_dev`, `<application_code>_test_<run_id>`, `sdkwork_<application-code>_prod`, or per-module schemas are forbidden.

Applications MUST NOT define per-app PostgreSQL database names, usernames, passwords, schemas, or URLs that differ from this profile in checked-in `.env.postgres.example`, topology profile env files, runtime TOML examples, release templates, CI templates, or operator documentation.

| Environment | Canonical keys | Database | Schema | Username | Password |
| --- | --- | --- | --- | --- | --- |
| Development | `SDKWORK_DATABASE_*` | `sdkwork_ai_dev` | `sdkwork_ai_dev` | `sdkwork_ai_dev` | `sdkworkdev123` |
| Test | `SDKWORK_DATABASE_*` | `sdkwork_ai_test` or ephemeral `sdkwork_ai_test_<run_id>` | same as database | `sdkwork_ai_test` | test-only secret |
| Staging | `SDKWORK_DATABASE_*` | `sdkwork_ai_staging` | `sdkwork_ai_staging` | `sdkwork_ai_staging` | secret file or protected env |
| Production | `SDKWORK_DATABASE_*` | `sdkwork_ai_prod` | `sdkwork_ai_prod` | `sdkwork_ai_prod` | secret file or protected env |

Rules:

- `SDKWORK_DATABASE_*` is the single source of truth for PostgreSQL connection identity across IAM, gateway-embedded routers, reusable dependency modules, application services, workers, CLI bootstrap, and test runners.
- Per-app or per-module `SDKWORK_<APPLICATION_CODE>_DATABASE_*` keys are retired migration inputs, not runtime compatibility inputs. Checked-in config, runtime templates, dev runners, installers, application startup, and test harnesses `MUST` use only `SDKWORK_DATABASE_*` for database connection identity, pool sizing, lifecycle, seed, drift, and client-local SQLite database file settings. Runtime code `MUST` reject an old key with an actionable diagnostic instead of dual-reading it.
- Every application repository MUST ship `.env.postgres.example` that contains only `SDKWORK_DATABASE_*` fields derived from `sdkwork-specs/templates/env.postgres.example`.
- Developer overrides belong in ignored `.env.postgres` at the selected application root. A workspace-level launcher `MAY` materialize the same values into child process environments, but no application repository owns the global profile and no child may fork its identity.
- Dev orchestration, topology loaders, IAM env helpers, and installers `MUST` resolve PostgreSQL exclusively through `SDKWORK_DATABASE_*`.
- Topology contracts `MUST NOT` declare `database.appPrefix`, an application database namespace, or any rule that derives database keys, database names, or schema names from application lifecycle env prefixes. `topology.spec.json#envKeys` owns complete application lifecycle/connectivity key names only.
- Rust services using `sdkwork-database-config` already fall back to `SDKWORK_DATABASE_*`; applications must not reintroduce separate default URLs.
- Application `dev`, `test`, bootstrap, init, seed, drift, and migration commands `MUST` use the shared workspace database and schema selected for the active environment. They `MUST NOT` create, drop, rename, or switch to an application-specific or module-specific PostgreSQL database or schema.
- PostgreSQL application and lifecycle connections `MUST` set a canonical-only `search_path` for the selected environment. `public` and other writable fallback schemas `MUST NOT` appear in the normal search path because unqualified discovery and DDL can otherwise bind to a same-named foreign object. `SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=true` requires a dated migration exception, collision regression coverage, and a removal milestone.
- Test isolation is allowed only at the workspace identity boundary. A test run MAY use an ephemeral `sdkwork_ai_test_<run_id>` database and schema when parallel destructive tests require it, but the identity remains workspace-scoped and MUST NOT include an application code, module id, table prefix, package name, or service name.
- Provisioning the shared database, shared schema, login role, and required extensions is a workspace administration responsibility. Application lifecycle commands initialize and migrate only their declared module-owned tables, indexes, constraints, seeds, lifecycle history, and drift evidence inside the selected shared schema.
- Table ownership and migrations remain per module. Isolation comes from the module contract, an ownership-specific table prefix, table registry, migration history, lifecycle owner metadata, and least-privilege roles; it `MUST NOT` come from per-application or per-module databases or schemas.
- An existing-table conflict, checksum mismatch, unknown migration, or schema drift `MUST` fail closed and be repaired through a reviewed forward, module-owned migration. Tooling `MUST NOT` bypass the conflict by selecting or creating another database or schema.
- Startup bootstrap `MUST` report the resolved database identity, schema, active environment, and module lifecycle plan before applying migrations or seeds. If a module expects a column or table missing from the shared schema, the failure is a schema drift/migration failure, not permission to bootstrap a private compatibility schema.

Canonical development template:

```env
SDKWORK_DATABASE_ENGINE=postgresql
SDKWORK_DATABASE_HOST=127.0.0.1
SDKWORK_DATABASE_PORT=5432
SDKWORK_DATABASE_NAME=sdkwork_ai_dev
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_dev
SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false
SDKWORK_DATABASE_USERNAME=sdkwork_ai_dev
SDKWORK_DATABASE_PASSWORD=sdkworkdev123
SDKWORK_DATABASE_SSL_MODE=disable
SDKWORK_DATABASE_MAX_CONNECTIONS=10
```

Embedded IAM stores per-tenant JWT signing material in `iam_tenant_signing_key.secret_ref` when tenants are provisioned. Applications that share one PostgreSQL database read the same tenant signing keys from the database; no deployment env var is required for session or access-token issuance.

Canonical production server/container fields:

```env
SDKWORK_DATABASE_ENGINE=postgresql
SDKWORK_DATABASE_HOST=db.example.com
SDKWORK_DATABASE_PORT=5432
SDKWORK_DATABASE_NAME=sdkwork_ai_prod
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_prod
SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false
SDKWORK_DATABASE_USERNAME=sdkwork_ai_prod
SDKWORK_DATABASE_PASSWORD_FILE=/etc/sdkwork/database/database.secret
SDKWORK_DATABASE_SSL_MODE=require
SDKWORK_DATABASE_MAX_CONNECTIONS=20
```

Rules:

- Server release packages must generate an explicit structured PostgreSQL config with host, database, username, and secret handling fields.
- Production and staging database configuration `MUST` resolve from the workspace database configuration directory defined in section 7.3 (`/etc/sdkwork/database/` on Linux). Per-application paths such as `/etc/sdkwork/<application-code>/database.secret` are dated migration fallbacks only and `MUST NOT` appear in new checked-in production templates; cross-application references such as `/etc/sdkwork/router/database.secret` inside a non-router repository are violations.
- Desktop packages and desktop runtime profiles must keep local user data on
  SQLite by default. They must create the SQLite file under the SDKWork user
  private data directory, not under server data directories and not in
  PostgreSQL, unless the user explicitly configures an external database.
- SDKWork application root commands follow `PNPM_SCRIPT_SPEC.md`. `pnpm dev`
  starts the default development workflow. `pnpm dev:browser` and
  `pnpm dev:desktop` default to PostgreSQL, standalone, and development.
  Product-prefixed public commands such as `cloudrouter:dev`, `drive:dev`, and
  `im:dev` are retired. The PostgreSQL development profile belongs to dev
  orchestration and any launched service runtime; it must not be treated as the
  installed desktop-local data store.
- New application server SQLite commands, including `pnpm dev:server:sqlite`,
  are forbidden. Existing commands are L0 migration aliases only and require a
  dated migration record; they must not satisfy server development, test, or
  release gates. Desktop client commands such as `pnpm dev:desktop:sqlite`
  may validate only the declared client-local SQLite module while any launched
  application API assembly or standalone gateway remains PostgreSQL-backed.
- PostgreSQL secrets should use `password_file` or a platform secret; direct `password` is allowed only when the runtime config file is protected as a secret-bearing file.
- Development PostgreSQL profiles must use a checked-in `.env.postgres.example`
  file with local-only placeholder values and an ignored `.env.postgres`
  developer override.
- `.env.postgres.example` must use the unified `SDKWORK_DATABASE_*` split
  fields from `§7.1 Unified Workspace PostgreSQL Profile` and
  `sdkwork-specs/templates/env.postgres.example`. Per-app
  `SDKWORK_<APPLICATION_CODE>_DATABASE_*` connection identity fields are not allowed in
  checked-in PostgreSQL templates.
- If database initialization needs an admin connection, use
  `SDKWORK_DATABASE_ADMIN_HOST`, `SDKWORK_DATABASE_ADMIN_PORT`,
  `SDKWORK_DATABASE_ADMIN_USERNAME`, `SDKWORK_DATABASE_ADMIN_PASSWORD`,
  `SDKWORK_DATABASE_ADMIN_DATABASE`, and `SDKWORK_DATABASE_ADMIN_SSL_MODE`.
- `DATABASE_PROVIDER` and `DATABASE_SSLMODE` are not standard names. New apps
  must reject them rather than accepting aliases.

Standard `.env.postgres.example` shape:

```env
# Copy from sdkwork-specs/templates/env.postgres.example
SDKWORK_DATABASE_ENGINE=postgresql
SDKWORK_DATABASE_HOST=127.0.0.1
SDKWORK_DATABASE_PORT=5432
SDKWORK_DATABASE_NAME=sdkwork_ai_dev
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_dev
SDKWORK_DATABASE_USERNAME=sdkwork_ai_dev
SDKWORK_DATABASE_PASSWORD=sdkworkdev123
SDKWORK_DATABASE_SSL_MODE=disable
SDKWORK_DATABASE_MAX_CONNECTIONS=10

SDKWORK_DATABASE_ADMIN_HOST=127.0.0.1
SDKWORK_DATABASE_ADMIN_PORT=5432
SDKWORK_DATABASE_ADMIN_USERNAME=postgres
SDKWORK_DATABASE_ADMIN_PASSWORD=postgres_admin_pass
SDKWORK_DATABASE_ADMIN_DATABASE=postgres
SDKWORK_DATABASE_ADMIN_SSL_MODE=disable
```

PostgreSQL development bootstrap workflow:

1. Copy or auto-materialize `.env.postgres` from `.env.postgres.example` at the application root (dev orchestration and `resolveIamDevEnv` do this automatically when the file is missing).
2. Run `pnpm db:postgres:init` to create the shared PostgreSQL role, database, and schema using `SDKWORK_DATABASE_ADMIN_*` (implemented by `sdkwork-specs/tools/postgres/postgres-db-cli.mjs`; no `psql` required).
3. Run `pnpm db:init` or `pnpm db:migrate` to apply service-specific schema migrations through `sdkwork-database-cli`.
4. Start `pnpm dev`; dev orchestration must load the same `.env.postgres` profile used by database commands. File values win over shell database env overrides.

Applications with `.env.postgres.example` `MUST` expose `db:postgres:init` and `db:postgres:plan` at the repository root. `sdkwork-im` additionally exposes `db:postgres:migrate` for IM-specific bootstrap orchestration.

- Desktop packages may create a declared client-local SQLite database automatically during first-run initialization.
- Database URLs are private process/config values. They must never be exposed through `PORTAL_PUBLIC_*` or `VITE_*`.
- Pool settings must be explicit for server/container deployments.
- Migration and seed behavior must be controlled by typed install/init settings, not implicit environment guesses.
### 7.2 Client-Local SQLite Connection Profile

Client-local SQLite (desktop, tablet, mobile, and other native clients) uses one dedicated connection key that is independent of the server PostgreSQL profile:

```env
SDKWORK_DATABASE_SQLITE_URL=sqlite:///<user-private-data-dir>/<application-code>.sqlite3
```

Rules:

- `SDKWORK_DATABASE_SQLITE_URL` is the single source of truth for the client-local SQLite database file. It `MUST` be a `sqlite:` URL: the POSIX form is `sqlite:///<absolute-path>`, and Windows clients `MAY` use `sqlite:<absolute-path>`. Runtime code `MUST NOT` reconstruct the file path from `SDKWORK_DATABASE_URL`, `SDKWORK_DATABASE_FILE`, or any PostgreSQL identity field.
- `SDKWORK_DATABASE_SQLITE_URL` and the PostgreSQL `SDKWORK_DATABASE_*` profile `MAY` coexist in one process: PostgreSQL remains the authoritative-server identity and the SQLite URL addresses only the declared client-local database. When `SDKWORK_DATABASE_SQLITE_URL` is present, client-local engines resolve to SQLite; server engines keep resolving the PostgreSQL profile.

**Module resolution roles.** Every database module selects one of two roles when it resolves its connection:

- *Client-local role* — modules holding only declared client-local data resolve `SDKWORK_DATABASE_SQLITE_URL` (SQLite). The URL is the single source of truth for the file; PostgreSQL profile fields `MUST NOT` redirect this resolution.
- *Server role* — authoritative-server modules resolve the workspace PostgreSQL profile (§7.1). `SDKWORK_DATABASE_SQLITE_URL` `MUST NOT` redirect this resolution; a process that also declares client-local data resolves both roles side by side.

Operational rules:

- `SDKWORK_DATABASE_ENGINE` describes the server profile only. When `SDKWORK_DATABASE_SQLITE_URL` is present it `MUST NOT` veto client-local resolution; malformed engine values still fail closed.
- `SDKWORK_DATABASE_SQLITE_URL` alone does not constitute a configured PostgreSQL profile. Profile loaders and `.env.postgres` materialization `MUST` still apply when only the SQLite URL is present, so server engines keep the workspace identity.
- A module that is server-authoritative by architecture `MUST NOT` silently accept SQLite when the SQLite URL is present; its host resolves the server role and rejects a non-PostgreSQL pool with an actionable diagnostic.
- Server/container deployments `MUST NOT` set `SDKWORK_DATABASE_SQLITE_URL` unless the package is a desktop/native client with an explicit local data boundary.
- The SQLite file `MUST` live under the SDKWork user private data directory (`RUNTIME_DIRECTORY_SPEC.md`, e.g. `~/.sdkwork/<application-code>/data`), not beside the executable and not under server data directories.
- Per-service SQLite aliases (`SDKWORK_<APPLICATION_CODE>_DATABASE_URL`, `SDKWORK_<APPLICATION_CODE>_DATABASE_FILE`) are retired and `MUST` be rejected like the PostgreSQL aliases in §7.1.
- Desktop first-run initialization `MAY` create the client-local SQLite database automatically; pool and lifecycle policy continues to use the `SDKWORK_DATABASE_*` pool keys.

### 7.3 Workspace Database Configuration Directory

Production and staging server/container deployments resolve the unified workspace PostgreSQL profile from one shared, operator-managed system directory. Development and test environments `MUST NOT` use this directory: development resolves `.env.postgres` at the selected application root (section 7.1), and test runners use ephemeral isolated state. This section is the canonical standard for that directory; `RUNTIME_DIRECTORY_SPEC.md` owns the host filesystem layout rows.

**Canonical OS directories** (selection follows the host operating system):

| OS / target | Workspace database config directory | Notes |
| --- | --- | --- |
| Linux service | `/etc/sdkwork/database/` | Operator-managed config, `root:sdkwork`, `0750`; files `0640`; secret files `0600` or `0640`. |
| Linux user/desktop | `~/.sdkwork/database/` | User-private fallback for desktop-launched services in development only; not a production path. |
| macOS service | `/Library/Application Support/sdkwork/database/` | System-scope equivalent. |
| macOS user/desktop | `~/.sdkwork/database/` | User-private fallback, development only. |
| Windows service | `%ProgramData%\sdkwork\database\` | System-scope equivalent. |
| Windows user/desktop | `%USERPROFILE%\.sdkwork\database\` | User-private fallback, development only. |
| Container | Mounted `/etc/sdkwork/database/` | Read-only config mount; secrets via `/run/secrets/` or the mounted `*.secret` files. |
| Test runner | None | Test config is ephemeral, generated under the test temp directory; never the system directory. |

**File shapes** in the selected directory:

| File | Role | Notes |
| --- | --- | --- |
| `database.toml` | Active production/staging structured database config | TOML preferred for SDKWork Rust services; `[database]` fields per `RUNTIME_DIRECTORY_SPEC.md` section 9. |
| `database.env` | Env-form equivalent of `database.toml` | `SDKWORK_DATABASE_*` keys only; consumed by services and bootstrap commands that read process env. |
| `<profile-id>.env` | Optional per-profile override | Exact profile id such as `cloud.production.env` or `standalone.production.env`; content must declare matching `profileId`. |
| `database.secret` / `*.secret` | Secret-bearing files | Password material; `0600`; referenced by `password_file` fields. |

**Discovery precedence** for production/staging database configuration:

1. `SDKWORK_DATABASE_CONFIG_DIR` explicit override.
2. Canonical OS directory from the table above.
3. Single-application host: when the host runs exactly one SDKWork application, the application config directory
   `/etc/sdkwork/<application-code>/` (or the OS equivalent) may carry the workspace database files and
   `database.secret` (for example `/etc/sdkwork/webserver/secrets/database.secret`), referenced through
   `password_file`. Multi-application hosts `MUST` resolve from the canonical shared directory (item 2).
   Historical per-application paths remain readable during a bounded migration window.
4. Process environment variables (`SDKWORK_DATABASE_*`) as late operator overrides.
5. Secret manager or OS secure storage for password material.

**Rules:**

- Production and staging startup `MUST` fail closed when the workspace database configuration directory is missing, when `database.toml`/`database.env` contains placeholder values, or when the resolved `database`/`schema`/`username` do not match the unified environment identity (`sdkwork_ai_prod`, `sdkwork_ai_staging`).
- All applications in one workspace share this directory and the single connection identity per environment from section 7.1. Applications `MUST NOT` create per-application or per-module database configuration subdirectories, database names, schemas, or connection identities inside it.
- Checked-in production templates, topology env files, release templates, installers, and operator documentation `MUST` reference `/etc/sdkwork/database/database.secret` (or the OS equivalent) by default and `MUST NOT` introduce per-application `database.secret` paths on multi-application hosts. A cross-application reference such as `/etc/sdkwork/router/database.secret` inside a non-router repository is a violation.
- Single-application host exception: an installer targeting a host that runs exactly one SDKWork application `MAY` keep the workspace database password secret at the application config directory
  (`/etc/sdkwork/<application-code>/secrets/database.secret` or the OS equivalent) so the application is self-contained. The secret file `MUST` be `0600` (or `0640`) with the service identity, `MUST` be referenced only through `password_file` (never inlined), and the chosen location `MUST` be declared in the installer/operator documentation. The workspace database identity values (database, schema, username) still follow section 7.1 — only the secret file location differs.
- Production config files `MUST NOT` contain inline passwords or `DEPLOY_INJECT:<name>` password placeholders; they reference `password_file` or platform secrets only.
- Container images contain examples only; the running container receives the directory as a mounted config volume and secrets through `/run/secrets/`.
- Directory and file permissions follow `RUNTIME_DIRECTORY_SPEC.md` section 11: config directory `0750` (`root:sdkwork`), config files `0640`, secret files `0600` or `0640`, never world-readable.
- The shared directory is operator-managed configuration, not generated application data. Application lifecycle commands never write database identity or migration state into it.

Canonical `database.toml` shape (Linux production):

```toml
[database]
engine = "postgresql"
host = "db.example.com"
port = 5432
database = "sdkwork_ai_prod"
schema = "sdkwork_ai_prod"
schema_fallback_public = false
username = "sdkwork_ai_prod"
password_file = "/etc/sdkwork/database/database.secret"
ssl_mode = "require"
max_connections = 20
```

Canonical `database.env` shape (Linux production):

```env
SDKWORK_DATABASE_ENGINE=postgresql
SDKWORK_DATABASE_HOST=db.example.com
SDKWORK_DATABASE_PORT=5432
SDKWORK_DATABASE_NAME=sdkwork_ai_prod
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_prod
SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false
SDKWORK_DATABASE_USERNAME=sdkwork_ai_prod
SDKWORK_DATABASE_PASSWORD_FILE=/etc/sdkwork/database/database.secret
SDKWORK_DATABASE_SSL_MODE=require
SDKWORK_DATABASE_MAX_CONNECTIONS=20
```


## 8. Runtime Directory Paths

`RUNTIME_DIRECTORY_SPEC.md` is the canonical path standard for SDKWork
applications. Environment handling must reference that file instead of defining
app-local directory schemes.

For application code `<application-code>`:

| OS/profile | Config file | Data directory | Log directory |
| --- | --- | --- | --- |
| Linux service/container | `/etc/sdkwork/<application-code>/<application-code>.toml` or `/etc/sdkwork/<application-code>/<process>.toml` | `/var/lib/sdkwork/<application-code>` | `/var/log/sdkwork/<application-code>` |
| Linux user/desktop | `~/.sdkwork/<application-code>/config/<application-code>.toml` or `~/.sdkwork/<application-code>/config/<process>.toml` | `~/.sdkwork/<application-code>/data` | `~/.sdkwork/<application-code>/logs` |
| macOS service | `/Library/Application Support/sdkwork/<application-code>/<application-code>.toml` or process-specific equivalent | `/Library/Application Support/sdkwork/<application-code>/Data` | `/Library/Logs/sdkwork/<application-code>` |
| macOS user/desktop | `~/.sdkwork/<application-code>/config/<application-code>.toml` or process-specific equivalent | `~/.sdkwork/<application-code>/data` | `~/.sdkwork/<application-code>/logs` |
| Windows service | `%ProgramData%\sdkwork\<application-code>\<application-code>.toml` or process-specific equivalent | `%ProgramData%\sdkwork\<application-code>\Data` | `%ProgramData%\sdkwork\<application-code>\Logs` |
| Windows user/desktop | `%USERPROFILE%\.sdkwork\<application-code>\config\<application-code>.toml` or process-specific equivalent | `%USERPROFILE%\.sdkwork\<application-code>\data` | `%USERPROFILE%\.sdkwork\<application-code>\logs` |
| Container | `/etc/sdkwork/<application-code>/<application-code>.toml` or process-specific equivalent | `/var/lib/sdkwork/<application-code>` or mounted volume | stdout/stderr, optional `/var/log/sdkwork/<application-code>` |

The workspace database configuration directory (section 7.3) follows the same
per-OS system-scope pattern without an application-code segment:

| OS/profile | Database config directory |
| --- | --- |
| Linux service/container | `/etc/sdkwork/database/` |
| Linux user/desktop | `~/.sdkwork/database/` (development only) |
| macOS service | `/Library/Application Support/sdkwork/database/` |
| macOS user/desktop | `~/.sdkwork/database/` (development only) |
| Windows service | `%ProgramData%\sdkwork\database\` |
| Windows user/desktop | `%USERPROFILE%\.sdkwork\database\` (development only) |

Rules:

- `SDKWORK_<APPLICATION_CODE>_CONFIG_FILE` must override default config discovery.
- `SDKWORK_<APPLICATION_CODE>_DATA_DIR`, `SDKWORK_<APPLICATION_CODE>_CACHE_DIR`, and
  `SDKWORK_<APPLICATION_CODE>_LOG_DIR` may override their resolved directories.
- Config files must be created with restrictive permissions when they include secrets.
- Desktop apps should place SQLite data under the user private data path, not beside the executable.
- Server services should place mutable data under `/var/lib/sdkwork/<application-code>/` on Linux or the equivalent service data directory on other systems.
- Release archives must include example config templates but must not include host-local secrets.
- Historical XDG, `%APPDATA%`, `%LOCALAPPDATA%`, or display-name directories may be read as compatibility fallbacks during migration, but canonical SDKWork writes should target `~/.sdkwork/<application-code>` or the Windows equivalent `%USERPROFILE%\.sdkwork\<application-code>` for user-private files.

## 9. Runtime Config File Shape

TOML is the preferred runtime config file format for SDKWork Rust and desktop/server packages.

```toml
[runtime]
environment = "production"
deployment_profile = "standalone"
profile_id = "standalone.production"
runtime_target = "server"
config_profile = "prod"

[server]
bind = "0.0.0.0:3900"
external_scheme = "https"
trust_forwarded_headers = true

[database]
engine = "postgresql"
host = "db.example.com"
port = 5432
database = "sdkwork_ai_prod"
schema = "sdkwork_ai_prod"
username = "sdkwork_ai_prod"
password_file = "/etc/sdkwork/database/database.secret"
ssl_mode = "require"
max_connections = 20

[redis]
enabled = true
host = "redis.example.com"
port = 6379
database = 0
# username = "default"
# url = "redis://redis.example.com:6379/0"
password_file = "/etc/sdkwork/router/redis.secret"
key_prefix = "cloudrouter"
tls = false
max_connections = 16
connect_timeout_ms = 2000
command_timeout_ms = 1000
pool_idle_timeout_seconds = 60

[portal.public]
# /v1 is valid here only for vendor compatibility open-api declared with x-sdkwork-wire-protocol: external per API_SPEC.md section 4.5.2.
# SDKWork-owned business open-api domains use their approved prefix, for example /im/v3/api.
api_base_url = "/v1"
open_api_base_url = "/v1"
app_api_base_url = "/app/v3/api"
backend_api_base_url = "/backend/v3/api"
tool_api_enabled = false

[portal.tools]
rate_limit_requests = 120
rate_limit_window_seconds = 60
sdk_archive_root = "/var/lib/sdkwork/router/sdk-archives"
```

Rules:

- Config files should use lower snake case.
- `[runtime].environment`, `[runtime].deployment_profile`, `[runtime].profile_id`,
  and `[runtime].runtime_target` are required in non-example release config.
  `profile_id` must equal
  `<deployment_profile>.<environment>`.
- `[runtime].config_profile` is optional and exists only for operator readability or script traceability.
- Environment variables should use upper snake case.
- The mapping between file keys and env keys must be documented and tested.
- Secrets may appear in protected host-local config files, but checked-in examples must use placeholders.
- Database config must prefer structured fields in `[database]`. A full `url`
  is a private operator override, not the primary release contract.
- Redis config must live under `[redis]`. Cloud deployments and standalone server/container deployments that require shared state default to `enabled = true` and must fail fast when Redis is required but not configured; desktop user-data targets default to `enabled = false`.
- Redis connections should use `host`, `port`, `database`, `username`, `tls`, pool size, and timeout fields as the primary configuration. `url` is an advanced override for managed Redis endpoints whose connection contract cannot be represented cleanly with separate fields.
- Redis secrets should use `password_file` or platform secrets. Direct `password` is allowed only when the runtime TOML is protected as a secret-bearing file.
- Public browser runtime config must be generated from `[portal.public]` or equivalent validated env values.

Development server profile:

```toml
[runtime]
environment = "development"
deployment_profile = "standalone"
profile_id = "standalone.development"
runtime_target = "server"
config_profile = "dev"

[server]
bind = "127.0.0.1:3900"
trust_forwarded_headers = false

[database]
engine = "postgresql"
host = "127.0.0.1"
port = 5432
database = "sdkwork_ai_dev"
schema = "sdkwork_ai_dev"
username = "sdkwork_ai_dev"
password = "sdkworkdev123"
ssl_mode = "disable"
max_connections = 10

[redis]
enabled = true
host = "127.0.0.1"
port = 6379
database = 0
key_prefix = "<application-code>:dev"
tls = false
```

Test server profile:

```toml
[runtime]
environment = "test"
deployment_profile = "standalone"
profile_id = "standalone.test"
runtime_target = "test-runner"
config_profile = "test"

[paths]
data_directory = "<test-temp>/<application-code>/data"
log_directory = "<test-temp>/<application-code>/logs"
cache_directory = "<test-temp>/<application-code>/cache"
runtime_directory = "<test-temp>/<application-code>/run"
temp_directory = "<test-temp>/<application-code>/tmp"

[database]
engine = "postgresql"
host = "127.0.0.1"
port = 5432
database = "sdkwork_ai_test_<run_id>"
schema = "sdkwork_ai_test_<run_id>"
username = "sdkwork_ai_test"
password = "test-only-change-me"
ssl_mode = "disable"
max_connections = 4

[redis]
enabled = true
host = "127.0.0.1"
port = 6379
database = 15
key_prefix = "<application-code>:test:<run_id>"
tls = false
```

Production server profile:

```toml
[runtime]
environment = "production"
deployment_profile = "standalone"
profile_id = "standalone.production"
runtime_target = "server"
config_profile = "prod"

[server]
bind = "0.0.0.0:3900"
external_scheme = "https"
trust_forwarded_headers = true

[database]
engine = "postgresql"
host = "db.internal"
port = 5432
database = "sdkwork_ai_prod"
schema = "sdkwork_ai_prod"
username = "sdkwork_ai_prod"
password_file = "/etc/sdkwork/database/database.secret"
ssl_mode = "require"
max_connections = 20

[redis]
enabled = true
host = "redis.internal"
port = 6379
database = 0
password_file = "/etc/sdkwork/<application-code>/redis.secret"
key_prefix = "<application-code>:prod"
tls = true
```

Installed desktop production profile:

```toml
[runtime]
environment = "production"
deployment_profile = "standalone"
profile_id = "standalone.production"
runtime_target = "desktop"
config_profile = "prod"

[desktop]
native_host = "tauri"
local_service_enabled = true
secure_storage_provider = "os-keychain"

[database]
engine = "sqlite"
file = "~/.sdkwork/<application-code>/data/<application-code>.sqlite"
max_connections = 1

[redis]
enabled = false
```

## 10. Application Architecture Matrix

### 10.1 Browser Portal SPA

Use when a React/Vite/browser application is served by an edge service or static host.

Required behavior:

- Load `/runtime-env.js` or equivalent before the hashed application bundle.
- Use only browser-visible runtime variables for SDK client base URLs.
- Prefer `PORTAL_PUBLIC_SDK_BASE_URL` as the common public API edge root and derive open/app/backend public base URLs from it while preserving canonical API paths. Use `PORTAL_PUBLIC_OPEN_API_BASE_URL`, `PORTAL_PUBLIC_APP_API_BASE_URL`, `PORTAL_PUBLIC_BACKEND_API_BASE_URL`, or dependency-specific overrides only for multi-host deployments or explicit dependency upstreams.
- Reject invalid public URLs at startup or build-time preflight.
- Treat Vite mode as build-time input only. Runtime environment, deployment profile, and runtime target must come from validated public runtime config.
- Browser public runtime config must declare `environment`, `deploymentProfile`, and `runtimeTarget = "browser"` or their JSON/language equivalents.

Recommended variables:

```text
# /v1 is valid here only for vendor compatibility open-api declared with x-sdkwork-wire-protocol: external per API_SPEC.md section 4.5.2.
# SDKWork-owned business open-api domains use their approved prefix, for example /im/v3/api.
PORTAL_PUBLIC_API_BASE_URL=/v1
PORTAL_PUBLIC_SDK_BASE_URL=/
PORTAL_PUBLIC_OPEN_API_BASE_URL=/v1
PORTAL_PUBLIC_APP_API_BASE_URL=/app/v3/api
PORTAL_PUBLIC_BACKEND_API_BASE_URL=/backend/v3/api
PORTAL_PUBLIC_TOOL_API_ENABLED=false
```

Recommended public runtime config:

```json
{
  "environment": "production",
  "deploymentProfile": "cloud",
  "runtimeTarget": "browser",
  "browserOriginMode": "same-origin",
  "openApiBaseUrl": "/v1",
  "appApiBaseUrl": "/app/v3/api",
  "backendApiBaseUrl": "/backend/v3/api"
}
```

### 10.2 Backend-Admin Web Application

Use when an operator console consumes `backend-admin` APIs.

Required behavior:

- Consume generated `backend-admin` SDKs through approved wrappers.
- Configure `backend-admin` from its declared API surface. A proven common API
  edge origin may derive it; otherwise use
  `PORTAL_PUBLIC_BACKEND_API_BASE_URL`.
- Never expose backend service-to-service secrets to browser code.

Recommended public runtime variable:

```text
PORTAL_PUBLIC_SDK_BASE_URL=/
# Optional override when backend-admin does not use the common API edge origin:
# PORTAL_PUBLIC_BACKEND_API_BASE_URL=/backend/v3/api
```

### 10.3 App/User Web Application

Use when user-facing UI consumes app APIs.

Required behavior:

- Consume generated app SDKs through approved wrappers.
- Configure app API from `application.public-ingress`. A proven common API edge
  origin may derive it; otherwise use `PORTAL_PUBLIC_APP_API_BASE_URL`.
- Store tokens only through the platform-approved auth/session adapter.
- User-facing app UI and PC user console UI must not read `backend-admin` SDK base URLs.

Recommended public runtime variable:

```text
PORTAL_PUBLIC_SDK_BASE_URL=/
# Optional override when app-api does not use the common API edge origin:
# PORTAL_PUBLIC_APP_API_BASE_URL=/app/v3/api
```

### 10.4 Desktop Application

Use when the application is installed per user and can run locally.

Required behavior:

- Default declared client-local persistence to SQLite in the SDKWork user private data directory.
- When the desktop app starts a backend service during development, that service
  uses the server PostgreSQL dev profile. An explicit SQLite command may test
  only the client-local persistence module.
- Support a config file in the SDKWork user private config directory.
- Keep secrets in OS secure storage when possible.
- Allow `SDKWORK_DATABASE_URL` to override the local database for diagnostics and managed operator deployments.

Example desktop config:

```toml
[runtime]
environment = "production"
deployment_profile = "standalone"
profile_id = "standalone.production"
runtime_target = "desktop"

[database]
engine = "sqlite"
file = "~/.sdkwork/<application-code>/data/<application-code>.sqlite"
max_connections = 1
```

### 10.5 Server Service

Use when the application runs as a long-lived service on a VM or bare-metal host.

Required behavior:

- Require PostgreSQL for release deployment.
- Read config from the canonical service config path or `SDKWORK_<APPLICATION_CODE>_CONFIG_FILE`.
- Bind explicitly and document reverse-proxy assumptions.
- Fail fast when required secrets or database config are missing.
- Declare `environment`, `deployment_profile = "standalone"`, and `runtime_target = "server"` in runtime config.

Example server env:

```text
SDKWORK_<APPLICATION_CODE>_CONFIG_FILE=/etc/sdkwork/<application-code>/<application-code>.toml
SDKWORK_<APPLICATION_CODE>_ENVIRONMENT=production
SDKWORK_<APPLICATION_CODE>_CONFIG_PROFILE=prod
SDKWORK_<APPLICATION_CODE>_DEPLOYMENT_PROFILE=standalone
SDKWORK_<APPLICATION_CODE>_RUNTIME_TARGET=server
SDKWORK_DATABASE_ENGINE=postgresql
SDKWORK_DATABASE_HOST=db.example.com
SDKWORK_DATABASE_PORT=5432
SDKWORK_DATABASE_NAME=sdkwork_ai_prod
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_prod
SDKWORK_DATABASE_USERNAME=sdkwork_ai_prod
SDKWORK_DATABASE_PASSWORD_FILE=/etc/sdkwork/database/database.secret
SDKWORK_DATABASE_SSL_MODE=require
SDKWORK_DATABASE_MAX_CONNECTIONS=20
# SDKWORK_DATABASE_URL=postgresql://sdkwork_ai_prod:change-me@db.example.com:5432/sdkwork_ai_prod
SDKWORK_<APPLICATION_CODE>_SERVER_BIND=0.0.0.0:3900
SDKWORK_<APPLICATION_CODE>_TRUST_FORWARDED_HEADERS=1
```

### 10.6 Container Deployment

Use when the application runs in Docker, Kubernetes, or another container runtime.

Required behavior:

- Read config from mounted files and process env.
- Store mutable data on mounted volumes or external services.
- Do not bake secrets into the image.
- Prefer service DNS names for internal API targets.
- Declare `environment`, `deployment_profile = "cloud"`, and `runtime_target = "container"` for cloud images. Use `deployment_profile = "standalone"` only for a documented single-container standalone package.

Example container env:

```text
SDKWORK_<APPLICATION_CODE>_CONFIG_FILE=/etc/sdkwork/<application-code>/<application-code>.toml
SDKWORK_<APPLICATION_CODE>_ENVIRONMENT=production
SDKWORK_<APPLICATION_CODE>_CONFIG_PROFILE=prod
SDKWORK_<APPLICATION_CODE>_DEPLOYMENT_PROFILE=cloud
SDKWORK_<APPLICATION_CODE>_RUNTIME_TARGET=container
SDKWORK_DATABASE_ENGINE=postgresql
SDKWORK_DATABASE_HOST=postgres
SDKWORK_DATABASE_PORT=5432
SDKWORK_DATABASE_NAME=sdkwork_ai_prod
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_prod
SDKWORK_DATABASE_USERNAME=sdkwork_ai_prod
SDKWORK_DATABASE_PASSWORD_FILE=/run/secrets/sdkwork/database-password
SDKWORK_DATABASE_MAX_CONNECTIONS=20
# SDKWORK_DATABASE_URL=postgresql://sdkwork_ai_prod:change-me@postgres:5432/sdkwork_ai_prod
SDKWORK_<APPLICATION_CODE>_SERVER_BIND=0.0.0.0:3900
```

## 11. sdkwork-cloudrouter Application Env

The SdkWork Cloud Router product uses the `SDKWORK_CLOUDROUTER_` prefix for private process values and `PORTAL_PUBLIC_` for browser-visible portal values.

Database config is not application product config. Release and operations docs `MUST` use `SDKWORK_DATABASE_*` for PostgreSQL and declared client-local SQLite settings. Legacy application/module aliases such as `SDKWORK_<APP>_DATABASE_ENGINE`, `SDKWORK_<APP>_DATABASE_SSL_MODE`, and `SDKWORK_<APPLICATION_CODE>_DATABASE_URL` are retired migration inputs and must not appear in checked-in env, runtime TOML, installer templates, deployment mappings, or application startup defaults.

Standalone server/single-container and cloud deployments default to PostgreSQL.
Desktop runtime targets default to SQLite.

### 11.1 Runtime Config Precedence

Cloud Router startup must resolve runtime configuration in this order:

1. Built-in deployment-profile and runtime-target defaults.
2. Canonical runtime TOML path defined by `RUNTIME_DIRECTORY_SPEC.md`.
3. `SDKWORK_CLOUDROUTER_CONFIG_FILE`.
4. Private process env overrides such as `SDKWORK_DATABASE_URL`.
5. CLI flags for development, smoke tests, or explicit one-shot operations.

Rules:

- `SDKWORK_CLOUDROUTER_DEPLOYMENT_PROFILE=standalone` is the default for archive, service, single-container, and desktop releases.
- `SDKWORK_CLOUDROUTER_DEPLOYMENT_PROFILE=cloud` is the default for cloud image/bundle releases.
- `SDKWORK_CLOUDROUTER_ENVIRONMENT`, `SDKWORK_CLOUDROUTER_CONFIG_PROFILE`, and
  `SDKWORK_CLOUDROUTER_DEPLOYMENT_PROFILE`, and `SDKWORK_CLOUDROUTER_RUNTIME_TARGET` must be
  resolved before database, Redis, or SDK base URL defaults are selected.
- `SDKWORK_CLOUDROUTER_CONFIG_FILE` may point to any administrator-managed TOML file.
- `SDKWORK_DATABASE_URL` overrides TOML database fields only as an explicit operator override.
- `SDKWORK_DATABASE_MAX_CONNECTIONS` overrides `[database].max_connections` in TOML.
- If a config file is missing, startup tooling should initialize the default TOML file before validation.
- Server startup must create an explicit structured PostgreSQL runtime config when no database is configured.
- Server startup must fail closed when PostgreSQL configuration still uses the generated placeholder host or password.
- Desktop startup may initialize a local SQLite database automatically.

### 11.2 Runtime Directory Paths

| Target | Config file | Data directory | Default database |
| --- | --- | --- | --- |
| Linux server/service/container | `/etc/sdkwork/router/cloudrouter.toml` | `/var/lib/sdkwork/router` | PostgreSQL through structured TOML fields |
| Windows server/service | `%ProgramData%/sdkwork/router/cloudrouter.toml` | `%ProgramData%/sdkwork/router/Data` | PostgreSQL through structured TOML fields |
| macOS server/service | `/Library/Application Support/sdkwork/router/cloudrouter.toml` | `/Library/Application Support/sdkwork/router/Data` | PostgreSQL through structured TOML fields |
| Linux desktop | `~/.sdkwork/router/config/cloudrouter.toml` | `~/.sdkwork/router/data` | `sqlite://~/.sdkwork/router/data/cloudrouter.sqlite` |
| Windows desktop | `%USERPROFILE%/.sdkwork/router/config/cloudrouter.toml` | `%USERPROFILE%/.sdkwork/router/data` | `sqlite://%USERPROFILE%/.sdkwork/router/data/cloudrouter.sqlite` |
| macOS desktop | `~/.sdkwork/router/config/cloudrouter.toml` | `~/.sdkwork/router/data` | `sqlite://~/.sdkwork/router/data/cloudrouter.sqlite` |

Rules:

- Release packages must include `config/cloudrouter.toml.example`.
- Release packages must not include `.env.release.local`.
- Host-local env files may be generated during install initialization, but secrets must remain on the target host. Linux service packages should use `/etc/sdkwork/router/cloudrouter.env` for process overrides and `/etc/sdkwork/database/database.secret` for the workspace PostgreSQL password file.
- Desktop SQLite files must live under the SDKWork user private data directory, not beside the executable.
- Server mutable state belongs under the OS service data directory or a mounted volume.
- Historical desktop paths such as XDG or display-name based locations may be read as compatibility fallbacks during migration, but canonical writes must target `~/.sdkwork/router` or the Windows equivalent `%USERPROFILE%/.sdkwork/router`.

### 11.3 Development

```text
SDKWORK_CLOUDROUTER_DEPLOYMENT_PROFILE=standalone
SDKWORK_CLOUDROUTER_ENVIRONMENT=development
SDKWORK_CLOUDROUTER_CONFIG_PROFILE=dev
SDKWORK_CLOUDROUTER_RUNTIME_TARGET=server
SDKWORK_DATABASE_ENGINE=postgresql
SDKWORK_DATABASE_HOST=127.0.0.1
SDKWORK_DATABASE_PORT=5432
SDKWORK_DATABASE_NAME=sdkwork_ai_dev
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_dev
SDKWORK_DATABASE_USERNAME=sdkwork_ai_dev
SDKWORK_DATABASE_PASSWORD=sdkworkdev123
SDKWORK_DATABASE_SSL_MODE=disable
SDKWORK_DATABASE_MAX_CONNECTIONS=10
SDKWORK_DATABASE_ADMIN_HOST=127.0.0.1
SDKWORK_DATABASE_ADMIN_PORT=5432
SDKWORK_DATABASE_ADMIN_USERNAME=postgres
SDKWORK_DATABASE_ADMIN_PASSWORD=postgres_admin_pass
SDKWORK_DATABASE_ADMIN_DATABASE=postgres
SDKWORK_DATABASE_ADMIN_SSL_MODE=disable
# SDKWORK_DATABASE_URL=postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable
SDKWORK_CLOUDROUTER_REDIS_ENABLED=true
SDKWORK_CLOUDROUTER_REDIS_HOST=redis.example.com
SDKWORK_CLOUDROUTER_REDIS_PORT=6379
SDKWORK_CLOUDROUTER_REDIS_DATABASE=0
# SDKWORK_CLOUDROUTER_REDIS_URL=redis://redis.example.com:6379/0
SDKWORK_CLOUDROUTER_REDIS_KEY_PREFIX=cloudrouter
SDKWORK_CLOUDROUTER_REDIS_TLS=false
SDKWORK_CLOUDROUTER_REDIS_MAX_CONNECTIONS=16
SDKWORK_CLOUDROUTER_REDIS_CONNECT_TIMEOUT_MILLIS=2000
SDKWORK_CLOUDROUTER_REDIS_COMMAND_TIMEOUT_MILLIS=1000
SDKWORK_CLOUDROUTER_REDIS_POOL_IDLE_TIMEOUT_SECONDS=60
SDKWORK_CLOUDROUTER_SERVER_BIND=127.0.0.1:3900
SDKWORK_CLOUDROUTER_GATEWAY_BIND=127.0.0.1:3901
SDKWORK_CLOUDROUTER_ADMIN_API_BIND=127.0.0.1:3902
SDKWORK_CLOUDROUTER_APP_API_BIND=127.0.0.1:3903
SDKWORK_CLOUDROUTER_API_KEY_PEPPER=development-only-change-me
SDKWORK_CLOUDROUTER_TRUSTED_SUBJECT_SECRET=development-only-change-me
SDKWORK_CLOUDROUTER_APP_SESSION_SECRET=development-only-change-me
# /v1 is valid here only for vendor compatibility open-api declared with x-sdkwork-wire-protocol: external per API_SPEC.md section 4.5.2.
# SDKWork-owned business open-api domains use their approved prefix, for example /im/v3/api.
PORTAL_PUBLIC_API_BASE_URL=/v1
PORTAL_PUBLIC_OPEN_API_BASE_URL=/v1
PORTAL_PUBLIC_APP_API_BASE_URL=/app/v3/api
PORTAL_PUBLIC_BACKEND_API_BASE_URL=/backend/v3/api
PORTAL_PUBLIC_TOOL_API_ENABLED=false
```

Cloud Router checks in `.env.postgres.example` with these local PostgreSQL
fields. Developers may copy it to `.env.postgres`; that override is host-local
and excluded from source control. Startup scripts assemble the structured fields into
`SDKWORK_DATABASE_URL` for Rust services only after validation.

This development PostgreSQL profile is for the workspace server/runtime
integration path. It does not change the desktop runtime profile. Desktop
packages and desktop user data remain SQLite by default at
`~/.sdkwork/router/data/cloudrouter.sqlite` or the equivalent Windows user
profile path.

### 11.4 Desktop Install

```text
SDKWORK_CLOUDROUTER_DEPLOYMENT_PROFILE=standalone
SDKWORK_CLOUDROUTER_ENVIRONMENT=production
SDKWORK_CLOUDROUTER_CONFIG_PROFILE=prod
SDKWORK_CLOUDROUTER_RUNTIME_TARGET=desktop
SDKWORK_CLOUDROUTER_CONFIG_FILE=~/.sdkwork/router/config/cloudrouter.toml
SDKWORK_DATABASE_MAX_CONNECTIONS=1
SDKWORK_CLOUDROUTER_REDIS_ENABLED=false
SDKWORK_CLOUDROUTER_REDIS_HOST=redis.example.com
SDKWORK_CLOUDROUTER_REDIS_PORT=6379
SDKWORK_CLOUDROUTER_REDIS_DATABASE=0
# SDKWORK_CLOUDROUTER_REDIS_URL=redis://redis.example.com:6379/0
SDKWORK_CLOUDROUTER_REDIS_KEY_PREFIX=cloudrouter
SDKWORK_CLOUDROUTER_REDIS_TLS=false
SDKWORK_CLOUDROUTER_REDIS_MAX_CONNECTIONS=4
SDKWORK_CLOUDROUTER_REDIS_CONNECT_TIMEOUT_MILLIS=2000
SDKWORK_CLOUDROUTER_REDIS_COMMAND_TIMEOUT_MILLIS=1000
SDKWORK_CLOUDROUTER_REDIS_POOL_IDLE_TIMEOUT_SECONDS=60
# /v1 is valid here only for vendor compatibility open-api declared with x-sdkwork-wire-protocol: external per API_SPEC.md section 4.5.2.
# SDKWork-owned business open-api domains use their approved prefix, for example /im/v3/api.
PORTAL_PUBLIC_API_BASE_URL=/v1
PORTAL_PUBLIC_OPEN_API_BASE_URL=/v1
PORTAL_PUBLIC_APP_API_BASE_URL=/app/v3/api
PORTAL_PUBLIC_BACKEND_API_BASE_URL=/backend/v3/api
```

Desktop installers should generate a user config file and a SQLite database under the SDKWork user private directories when no explicit database URL is configured.
Desktop packages must not require PostgreSQL for first run. If an advanced user
explicitly configures PostgreSQL, that is an override of the desktop default,
not the product default.

Example Linux desktop config:

```toml
[runtime]
environment = "production"
deployment_profile = "standalone"
profile_id = "standalone.production"
runtime_target = "desktop"
config_profile = "prod"

[database]
engine = "sqlite"
file = "~/.sdkwork/router/data/cloudrouter.sqlite"
max_connections = 1

[redis]
enabled = false
host = "redis.example.com"
port = 6379
database = 0
# username = "default"
# url = "redis://redis.example.com:6379/0"
key_prefix = "cloudrouter"
tls = false
max_connections = 4
connect_timeout_ms = 2000
command_timeout_ms = 1000
pool_idle_timeout_seconds = 60
```

### 11.5 Server Release

```text
SDKWORK_CLOUDROUTER_DEPLOYMENT_PROFILE=standalone
SDKWORK_CLOUDROUTER_ENVIRONMENT=production
SDKWORK_CLOUDROUTER_CONFIG_PROFILE=prod
SDKWORK_CLOUDROUTER_RUNTIME_TARGET=server
SDKWORK_CLOUDROUTER_CONFIG_FILE=/etc/sdkwork/router/cloudrouter.toml
SDKWORK_DATABASE_MAX_CONNECTIONS=16
SDKWORK_CLOUDROUTER_REDIS_ENABLED=true
SDKWORK_CLOUDROUTER_REDIS_HOST=redis.example.com
SDKWORK_CLOUDROUTER_REDIS_PORT=6379
SDKWORK_CLOUDROUTER_REDIS_DATABASE=0
# SDKWORK_CLOUDROUTER_REDIS_URL=redis://redis.example.com:6379/0
SDKWORK_CLOUDROUTER_SERVER_BIND=0.0.0.0:3900
SDKWORK_CLOUDROUTER_EDGE_SERVER=1
SDKWORK_CLOUDROUTER_EDGE_EXTERNAL_SCHEME=https
SDKWORK_CLOUDROUTER_EDGE_TRUST_FORWARDED_HEADERS=1
# /v1 is valid here only for vendor compatibility open-api declared with x-sdkwork-wire-protocol: external per API_SPEC.md section 4.5.2.
# SDKWork-owned business open-api domains use their approved prefix, for example /im/v3/api.
PORTAL_PUBLIC_API_BASE_URL=/v1
PORTAL_PUBLIC_OPEN_API_BASE_URL=/v1
PORTAL_PUBLIC_APP_API_BASE_URL=/app/v3/api
PORTAL_PUBLIC_BACKEND_API_BASE_URL=/backend/v3/api
PORTAL_PUBLIC_TOOL_API_ENABLED=false
SDKWORK_CLOUDROUTER_EDGE_CSP_CONNECT_SRC=
SDKWORK_CLOUDROUTER_TOOL_API_RATE_LIMIT_REQUESTS=120
SDKWORK_CLOUDROUTER_TOOL_API_RATE_LIMIT_WINDOW_SECONDS=60
SDKWORK_CLOUDROUTER_TOOL_API_SDK_GENERATOR_BASE_URL=
SDKWORK_CLOUDROUTER_TOOL_API_SDK_ARCHIVE_ROOT=
```

Private edge-server env keys use the `SDKWORK_CLOUDROUTER_EDGE_*` and `SDKWORK_CLOUDROUTER_TOOL_API_*`
prefixes. The Rust edge gateway reads these canonical names first and accepts legacy
`PORTAL_TOOL_API_*`, `PORTAL_CSP_*`, `PORTAL_SECURITY_*`, and `PORTAL_STATIC_*` aliases
only as a read-only migration fallback. New release-host configuration must not assign
legacy private edge keys.

Example Linux server config:

```toml
[runtime]
environment = "production"
deployment_profile = "standalone"
profile_id = "standalone.production"
runtime_target = "server"
config_profile = "prod"

[database]
engine = "postgresql"
host = "db.internal"
port = 5432
database = "sdkwork_ai_prod"
schema = "sdkwork_ai_prod"
username = "sdkwork_ai_prod"
password_file = "/etc/sdkwork/database/database.secret"
# password = "real-password"
ssl_mode = "require"
max_connections = 16

[redis]
enabled = true
host = "redis.example.com"
port = 6379
database = 0
# username = "default"
# url = "redis://redis.example.com:6379/0"
password_file = "/etc/sdkwork/router/redis.secret"
key_prefix = "cloudrouter"
tls = false
max_connections = 16
connect_timeout_ms = 2000
command_timeout_ms = 1000
pool_idle_timeout_seconds = 60

[paths]
data_directory = "/var/lib/sdkwork/router"
```

For Cloud Router, Redis is enabled and required by default for server and
container deployments. Keep `[redis].enabled = true`, set `[redis].host`,
`[redis].port`, and `[redis].database` before first startup, and use
`[redis].url` only as an advanced managed-endpoint override. Prefer
`[redis].password_file` over direct `[redis].password`. Desktop deployments
keep Redis optional and disabled by default.

### 11.6 Cloud Multi-Host Deployment

Use when the portal edge service forwards to separate internal gateway, app API, and `backend-admin` API services while the public deployment profile remains `cloud`.

```text
SDKWORK_CLOUDROUTER_DEPLOYMENT_PROFILE=cloud
SDKWORK_CLOUDROUTER_RUNTIME_TARGET=container
SDKWORK_CLOUDROUTER_EDGE_GATEWAY_BASE_URL=http://gateway.internal:18080
SDKWORK_CLOUDROUTER_EDGE_APP_API_BASE_URL=http://app-api.internal:18082
SDKWORK_CLOUDROUTER_EDGE_BACKEND_API_BASE_URL=http://admin-api.internal:18081
# /v1 is valid here only for vendor compatibility open-api declared with x-sdkwork-wire-protocol: external per API_SPEC.md section 4.5.2.
# SDKWork-owned business open-api domains use their approved prefix, for example /im/v3/api.
PORTAL_PUBLIC_API_BASE_URL=/v1
PORTAL_PUBLIC_OPEN_API_BASE_URL=/v1
PORTAL_PUBLIC_APP_API_BASE_URL=/app/v3/api
PORTAL_PUBLIC_BACKEND_API_BASE_URL=/backend/v3/api
```

If a tenant exposes a vendor compatibility open-api surface from a different public host, `/v1` remains valid only when the operations declare `x-sdkwork-wire-protocol: external` per `API_SPEC.md` section 4.5.2:

```text
PORTAL_PUBLIC_API_BASE_URL=https://docs-api.example.com/v1
PORTAL_PUBLIC_OPEN_API_BASE_URL=https://open-api.example.com/v1
PORTAL_PUBLIC_APP_API_BASE_URL=https://app-api.example.com/app/v3/api
PORTAL_PUBLIC_BACKEND_API_BASE_URL=https://admin-api.example.com/backend/v3/api
```

If the override is for a SDKWork-owned business open-api domain, use that domain's approved prefix:

```text
PORTAL_PUBLIC_OPEN_API_BASE_URL=https://im-api.example.com/im/v3/api
PORTAL_PUBLIC_APP_API_BASE_URL=https://app-api.example.com/app/v3/api
PORTAL_PUBLIC_BACKEND_API_BASE_URL=https://admin-api.example.com/backend/v3/api
```

## 12. Release Env Files

Release env files are host-local artifacts.

Rules:

- Checked-in `.env.release.example` files are references only.
- `.env.release.local` must be generated on the release host and must not be committed.
- Release env writers must print safe summaries only and must not echo secrets.
- Strict release preflight must validate required values before packaging.
- Optional public overrides, such as `PORTAL_PUBLIC_OPEN_API_BASE_URL`, may be omitted when they inherit a required base URL.

Minimum release host contract for `sdkwork-cloudrouter`:

```text
SDKWORK_DATABASE_URL=postgres://sdkwork_ai_test:password@host:5432/sdkwork_ai_test
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_test
# /v1 is valid here only for vendor compatibility open-api declared with x-sdkwork-wire-protocol: external per API_SPEC.md section 4.5.2.
# SDKWork-owned business open-api domains use their approved prefix, for example /im/v3/api.
PORTAL_PUBLIC_API_BASE_URL=/v1
PORTAL_PUBLIC_OPEN_API_BASE_URL=/v1
PORTAL_PUBLIC_APP_API_BASE_URL=/app/v3/api
PORTAL_PUBLIC_BACKEND_API_BASE_URL=/backend/v3/api
PORTAL_PUBLIC_TOOL_API_ENABLED=false
```

## 13. Security Rules

- Secrets must not appear in browser runtime env, static assets, generated SDK examples, logs, screenshots, telemetry attributes, or committed templates.
- Database URLs are private unless they point to a local non-secret disposable test database.
- Public runtime env must be served with `Cache-Control: no-store` when values can vary per deployment.
- CSP `connect-src` must include only validated absolute API origins and the application origin.
- Env parsing must fail closed on malformed URLs, invalid booleans, invalid numbers, and missing required release secrets.
- Local development default secrets must be clearly marked as development-only.
- Env and public runtime config may expose locale strategy values such as default locale, supported locales, active locales, fallback locale, message-catalog manifest URL, and catalog version, but must not embed translated message catalogs, L1 brand/store copy overrides, or generated locale bundle contents.
- Database seed locale env keys such as `DATABASE_SEED_LOCALE` and `DATABASE_SEED_I18N_VERSION` configure database lifecycle initialization only. They `MUST NOT` be used as frontend runtime locale, SDK locale provider input, or API request locale.

## 14. Validation And Tests

Every application that adopts this standard should provide:

- Unit tests for env parsing and default resolution.
- Profile normalization tests for `dev -> development`, `prod -> production`, and rejection of unknown profile names.
- Canonical matrix tests for the ten
  `<deploymentProfile>.<environment>` combinations, undeclared-profile
  rejection, no cross-profile fallback, and source/materialized identity
  equality.
- Architecture format tests for PC/H5 Vite, Flutter dart-define JSON, native
  WeChat runtime JSON, uni-app Vite env, and every native/mobile format the
  application declares.
- Runtime target tests for browser, desktop, tablet, Capacitor, Flutter, mini program, native Android, native iOS, native Harmony, server, container, and test-runner defaults.
- Config file parsing tests for canonical and explicit paths.
- Release preflight validation for required production variables.
- Browser runtime env tests that verify public values load before SDK clients are constructed.
- Standalone browser env tests that verify `browserOriginMode = same-origin`,
  public/Vite SDK Base URLs resolve against the page origin, and no internal
  application-ingress target URL is emitted.
- Browser public runtime tests that verify no secret, database URL, Redis URL, token, signing key, or private endpoint is emitted through `/runtime-env.js`, `PORTAL_PUBLIC_*`, or `VITE_*`.
- I18n runtime config tests that verify env/public config contains only locale strategy, active locale list, message-catalog manifest references, and version identifiers, not translated message content or app/root/package locale monoliths.
- Database seed i18n env tests that verify seed locale/version values map only to database lifecycle config and do not override runtime locale negotiation.
- Database selection tests for desktop SQLite and server PostgreSQL behavior.
- Test-profile isolation tests for database/schema names, Redis key prefix, logs, cache, runtime, and temp directories.
- Tauri/native config tests that verify platform config contains packaging metadata, permissions, capabilities, and signing references only, not API secrets or business SDK contracts.
- Script syntax checks for env writer, preflight, installer, and production starter scripts.
- Security tests that prevent private env values from being emitted to public runtime config.

Acceptance checklist:

- [ ] Env names follow the product and capability prefix rules.
- [ ] Generic and application-scoped environment, deployment profile, profile id, and runtime target fields are normalized and validated together.
- [ ] Supported canonical profile files exist with
      `<deploymentProfile>.<environment>` names and local overrides are ignored.
- [ ] PC/H5 use `.env.<profile-id>`, Flutter uses
      `env/sdkwork.<profile-id>.json`, native WeChat uses
      `config/mini-program/runtime-env.<profile-id>.json`, and uni-app uses the
      Vite contract when those architectures are declared.
- [ ] Public values are separated from private and secret values.
- [ ] Generated SDK base URLs resolve from declared application/platform
  surfaces, with an optional proven common API edge origin and per-surface or
  per-SDK overrides; effective URLs are explicit after resolution.
- [ ] Locale env/public runtime values contain only default/supported/active/fallback locale strategy, message-catalog manifest references, and version identifiers; translated messages remain in `I18N_SPEC.md` message-catalog fragments.
- [ ] Database seed locale/version env values are private lifecycle settings and are not reused as frontend runtime locale or API request locale.
- [ ] Server release defaults require PostgreSQL.
- [ ] PostgreSQL development templates use `.env.postgres.example` with unified `SDKWORK_DATABASE_*` fields from `ENVIRONMENT_SPEC.md` §7.1 and `sdkwork-specs/templates/env.postgres.example`.
- [ ] Checked-in topology profiles and release env files do not define per-app PostgreSQL database names, usernames, passwords, or schemas that differ from the unified workspace profile.
- [ ] PostgreSQL application and lifecycle profiles use a canonical-only search path and set `SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false`; any temporary `true` value has a dated, reviewed migration exception and collision regression test.
- [ ] Workspace verification passes: `node ../sdkwork-specs/tools/check-unified-postgres-profile.mjs` from each application root (or once from workspace root).
- [ ] Legacy database env aliases such as `DATABASE_PROVIDER` and `DATABASE_SSLMODE` are rejected for new apps.
- [ ] Database lifecycle env keys follow `DATABASE_FRAMEWORK_SPEC.md` when the repository owns a `database/` module.
- [ ] Desktop install defaults to SQLite in the SDKWork user private data directory.
- [ ] Desktop installed config, desktop-started server dev config, browser public runtime config, H5/Capacitor config, Flutter config, mini program config, container config, and Tauri platform config are separate files or clearly separate sections.
- [ ] Test config isolates database/schema, Redis key prefix, logs, cache, runtime, and temp directories without introducing per-application or per-module PostgreSQL identities.
- [ ] Runtime config file path can be specified explicitly.
- [ ] Canonical runtime directory paths are documented for Linux, macOS, Windows, and containers.
- [ ] Release env files are generated locally and excluded from source control.
- [ ] Strict validation covers URLs, booleans, numbers, secrets, and unknown keys.

## 15. RPC Environment Variables

RPC runtime variables are private process variables unless explicitly documented as browser-visible gRPC-Web configuration.

| Variable | Visibility | Required | Description |
| --- | --- | --- | --- |
| `SDKWORK_<APPLICATION_CODE>_RPC_ENABLED` | private | MAY | Enables the app/domain RPC server. |
| `SDKWORK_<APPLICATION_CODE>_RPC_BIND_ADDR` | private | SHOULD when RPC is enabled | Bind address such as `127.0.0.1:50051` for standalone desktop/dev targets or `0.0.0.0:50051` behind approved ingress. |
| `SDKWORK_<APPLICATION_CODE>_RPC_PUBLIC_ENDPOINT` | private/public by deployment | MAY | Endpoint published to generated external RPC clients. |
| `SDKWORK_<APPLICATION_CODE>_RPC_TLS_ENABLED` | private | SHOULD for production | Enables server TLS. |
| `SDKWORK_<APPLICATION_CODE>_RPC_MTLS_ENABLED` | private | SHOULD for service-to-service production | Requires client certificates. |
| `SDKWORK_<APPLICATION_CODE>_RPC_REFLECTION_ENABLED` | private | MAY | Enables gRPC reflection. Must be disabled or access-controlled in public production. |
| `SDKWORK_<APPLICATION_CODE>_RPC_HEALTH_ENABLED` | private | SHOULD | Enables gRPC health service. |
| `SDKWORK_<APPLICATION_CODE>_RPC_GRPC_WEB_ENABLED` | private | MAY | Enables gRPC-Web bridge for approved browser clients. |
| `SDKWORK_<APPLICATION_CODE>_RPC_DEFAULT_DEADLINE_MS` | private | MAY | Default client/server deadline in milliseconds. |
| `SDKWORK_<APPLICATION_CODE>_RPC_RESOLVER_PROFILE` | private | SHOULD when RPC clients use dynamic resolution | `static`, `static-composite`, `discovery`, or `composite`. |
| `SDKWORK_<APPLICATION_CODE>_RPC_RESILIENCE_PROFILE` | private | MAY | Default resilience profile from `RPC_RESILIENCE_SPEC.md`. |
| `SDKWORK_<APPLICATION_CODE>_DISCOVERY_ENDPOINT` | private | SHOULD when resolver profile is `discovery` or `composite` | gRPC endpoint for `sdkwork-discovery` application ingress. |

Rules:

- RPC endpoint variables MUST reject query strings, fragments, control characters, and non-HTTP(S) schemes unless a runtime explicitly documents a Unix domain socket or named-pipe transport.
- TLS certificate paths and private keys are secrets or secret-bearing config and MUST NOT be exposed to browser runtime config.
- `PORTAL_PUBLIC_*_RPC_ENDPOINT` variables MAY exist only for approved gRPC-Web clients and must follow the same public-runtime validation rules as HTTP SDK base URLs.
- Shared modules MUST receive RPC clients through bootstrap/service injection; they must not read RPC environment variables directly.
- Discovery process variables use the `SDKWORK_DISCOVERY_` prefix and are defined in section 16.

## 16. Discovery Environment Variables

Discovery runtime variables are private process variables for `sdkwork-discovery` and discovery-aware RPC resolvers.

| Variable | Visibility | Required | Description |
| --- | --- | --- | --- |
| `SDKWORK_DISCOVERY_CONFIG_FILE` | private | MAY | Host-local discovery config file path selector. |
| `SDKWORK_DISCOVERY_ENVIRONMENT` | private | SHOULD | Lifecycle environment for registry/config scope. |
| `SDKWORK_DISCOVERY_CONFIG_PROFILE` | private | MAY | Config profile alias such as `dev`, `test`, `staging`, `prod`. |
| `SDKWORK_DISCOVERY_DEPLOYMENT_PROFILE` | private | SHOULD | Deployment profile: `standalone` or `cloud`. |
| `SDKWORK_DISCOVERY_APPLICATION_PUBLIC_INGRESS_BIND` | private | SHOULD | Bind address for application registry/config ingress. |
| `SDKWORK_DISCOVERY_APPLICATION_PUBLIC_GRPC_URL` | private | SHOULD | Published gRPC URL for registry/config clients. |
| `SDKWORK_DISCOVERY_OPERATIONS_CONTROL_INGRESS_BIND` | private | MAY | Bind address for operator/admin ingress. |
| `SDKWORK_DISCOVERY_OPERATIONS_CONTROL_GRPC_URL` | private | MAY | Published gRPC URL for admin clients. |
| `SDKWORK_DISCOVERY_STORAGE_PROVIDER` | private | SHOULD | `memory`, `postgres`, `redis`, `etcd`, or `consul`; SQLite is not a discovery server provider. |
| `SDKWORK_DISCOVERY_RPC_TLS_ENABLED` | private | SHOULD for production | Enables discovery server TLS. |
| `SDKWORK_DISCOVERY_RPC_MTLS_ENABLED` | private | SHOULD for service-to-service production | Requires client certificates on discovery ingress. |
| `SDKWORK_DISCOVERY_RPC_AUTH_MODE` | private | SHOULD | Discovery RPC auth mode such as service-token. |
| `SDKWORK_DISCOVERY_RPC_ALLOW_UNSIGNED_LOCAL_CONTEXT` | private | MAY | Development/test loopback-only unsigned caller context. |
| `SDKWORK_DISCOVERY_WATCH_ENABLED` | private | MAY | Enables watch RPC services. |
| `SDKWORK_DISCOVERY_METRICS_BIND` | private | MAY | Prometheus metrics bind address when enabled. |

Rules:

- Application-owned RPC services MUST NOT overload `SDKWORK_DISCOVERY_*` keys for non-discovery behavior.
- Production discovery config MUST reject unsigned local context, inline secrets, and non-durable storage providers per `DISCOVERY_SPEC.md`.
- RPC client resolvers SHOULD read `SDKWORK_<APPLICATION_CODE>_DISCOVERY_ENDPOINT` or topology-provided discovery URLs instead of hard-coded peer lists.
