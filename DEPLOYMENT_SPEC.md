# Deployment And Runtime Standard

- Version: 1.1
- Scope: standalone/cloud application deployment profiles, Java Spring, Rust backend, HTTP/RPC runtime bootstrap, frontend bootstrap, environment config
- Related: `APPLICATION_SPEC.md`, `APP_MANIFEST_SPEC.md`, `CONFIG_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `ENVIRONMENT_SPEC.md`, `REGION_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `RELEASE_SPEC.md`, `API_SPEC.md`, `RPC_SPEC.md`, `RPC_FRAMEWORK_SPEC.md`, `DISCOVERY_SPEC.md`, `RPC_RESILIENCE_SPEC.md`, `RUST_RPC_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `SDK_SPEC.md`, `IAM_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `SDKWORK_WEBSERVER_SPEC.md`

SDKWork applications must deploy through one of two standardized application deployment profiles: `standalone` or `cloud`. Shared module APIs, route contracts, generated SDKs, IAM request context, and runtime bootstrap must remain the same across both profiles.

Use `CONFIG_SPEC.md` for typed runtime config, SDK client construction, token storage adapters, and feature flags.

## 1. Deployment Profiles

`deploymentProfile` is the canonical active API/runtime topology field. Every
SDKWork runtime instance and every server-side deployment unit `MUST` select
exactly one active profile. A runtime-configurable client artifact may support
both profiles and selects exactly one during bootstrap; artifact capability is
declared through `supportedDeploymentProfiles`, not by inventing a third
profile value.

| Profile | Architecture | Use case |
| --- | --- | --- |
| `standalone` | Application API topology terminates at `sdkwork-api-<application-code>-standalone-gateway`, which hosts the application API assembly | Local development, desktop-local service, customer-private gateway, appliance/server install, single-node service, single-container unit |
| `cloud` | Clients consume explicit deployed API surface URLs; the platform deployment hosts approved application API assemblies | SDKWork hosted cloud, customer VPC/private cloud, Kubernetes or equivalent orchestration, and local clients consuming deployed cloud APIs |

Rules:

- `deploymentProfile` values are only `standalone` and `cloud`.
- Old values such as `saas`, `private`, `local`, `test`, `server`,
  `container`, `desktop`, `browser`, `web`, `mobile`, `mini-program`,
  `docker`, and hosting aliases `MUST NOT` be used as deployment profile
  values.
- SaaS, customer-private, local, and test are environment, ownership, tenancy,
  release, or test-fixture concerns. They must be represented through
  environment, release metadata, runtime target, topology profile, or test
  fixture config, not through a third deployment profile.
- Shared API contracts `MUST` remain identical across `standalone` and `cloud`.
- `deploymentProfile` `MUST NOT` encode whether a client artifact is installed
  locally. Desktop, mobile, tablet, and browser clients may support one or both
  profiles while retaining their exact runtime target and package identity.
- Runtime config carries one active `deploymentProfile`. Client package and
  workflow metadata uses either a fixed `deploymentProfile` or
  `profileBinding = runtime-configurable` plus
  `supportedDeploymentProfiles`; these forms are mutually exclusive.
- Differences in storage, process model, topology, dependency availability, or token issuer `MUST` be hidden behind SDK client initialization and `WebRequestContext` construction.
- Local-only native capabilities may have local host APIs, but common IAM/API contracts must remain compatible and must not leak local-only parameters into generated SDK inputs.
- Runtime config and SDK client bootstrap `MUST` follow `CONFIG_SPEC.md`.

### 1.1 Standalone Profile

Rules:

- `standalone` deployments `MUST` expose one public application ingress for
  SDKWork HTTP `*-api` surfaces unless the app is a pure client package.
- All application-owned `open-api`, `app-api`, `backend-api`, route crates,
  controller modules, gateways, and migration-only API servers in a standalone deployment
  `MUST` integrate `sdkwork-web-framework` or the language-equivalent profile
  defined by `WEB_FRAMEWORK_SPEC.md`.
- Every route/operation served in standalone `MUST` receive
  `WebRequestContext`; tenant and organization context come from auth/access
  token validation, API key records, or server-side request context, not from
  generated `tenant_id` or `tenantId` SDK inputs.
- Dependency APIs selected as standalone same-origin are dependency-owned
  assembly contributions linked into the application gateway process. An
  external dependency remains explicit. A browser dev-server proxy is only a
  same-origin transport in front of the current application ingress; it does
  not replace dependency assembly evidence or authorize a dependency gateway
  process or alternate loopback API listener.
- Standalone server packages default to PostgreSQL. Standalone desktop
  client-local data targets may default to SQLite under the SDKWork
  user-private directory.
- Redis is required only when the application profile declares shared runtime
  state, realtime fanout, rate limiting, queueing, or cache behavior that
  requires Redis.
- Standalone release artifacts may be archives, OS services, desktop
  installers, or single-container packages, but all of them remain one
  application deployment unit.
- When an embedded dependency assembly reads owner-controlled database,
  registry, policy, template, or other filesystem runtime assets, the
  standalone artifact `MUST` package those assets under a stable owner-scoped
  runtime root and bind that root explicitly. Installed startup `MUST NOT`
  fall back to a dependency source checkout or a build-machine
  `CARGO_MANIFEST_DIR`. Package validation and extracted-artifact smoke tests
  `MUST` fail when a required owner runtime root is missing or incomplete.
- A standalone deployment that declares a browser application `MUST` expose
  the page and browser API requests through one browser-visible origin.
  Development may retain separate internal renderer and API listeners only
  through a declared canonical-path `dev-server-proxy`. Production packages
  include the browser build output and serve it through the application
  ingress with declared runtime root, `/` mount, and `/index.html` SPA fallback
  evidence.
- A desktop host that owns a local standalone gateway `MUST` supervise only
  its application-scoped process, bind loopback by default, allocate a
  collision-safe port, wait for bounded readiness, use user-private runtime
  paths, perform bounded graceful shutdown, and record crash/restart evidence.
- Mobile and browser clients `MUST NOT` assume that standalone means an
  on-device gateway. They may consume the application standalone gateway on a
  developer machine, customer-private host, LAN appliance, or other declared
  private endpoint. Offline capability is a separate contract.
- Standalone browser SDK base URLs `MUST` use same-origin relative canonical
  API paths with dev/proxy ingress to the application standalone gateway.
  Cross-reference `ENVIRONMENT_SPEC.md` §6.2 and `API_ASSEMBLY_SPEC.md` §6.1.1.
- The application `sdkwork-api-<application-code>-standalone-gateway`
  `MUST` start independently and expose the full same-origin-mounted API
  surface composed in api-assembly without requiring sibling application
  repositories to be running, except for declared external upstream overrides.

### 1.2 Cloud Profile

Rules:

- `cloud` deployments `MUST` declare public ingress, service discovery or
  upstreams, managed secrets, persistent data stores, readiness/liveness checks,
  observability, rollback, and release environment binding.
- `cloud` deployments `MAY` decompose internal services for independent
  scaling, but that decomposition remains gateway/upstream implementation
  detail and `MUST NOT` create another deployment profile or profile-id segment.
- Platform capabilities such as IAM, appbase, Drive, shared agent services, and
  cross-application SDKs `MUST` be reached through declared platform/application
  surfaces or dependency SDK base URLs. They must not be hidden behind ad hoc
  localhost defaults.
- Cloud browser/runtime config `SHOULD` start from one public API edge root
  when a gateway serves all SDK surfaces while preserving canonical API paths,
  and `MUST` support explicit per-surface or per-dependency base URL overrides
  when selected surfaces route to different hosts.
- Cloud deployments `MUST` use independent absolute API base URLs from
  declared topology (`application.public-ingress`, `platform.api-gateway`, and
  documented per-dependency overrides). Browser clients `MUST NOT` rely on
  same-origin relative paths unless production ingress explicitly co-hosts every
  derived surface on one origin. Cross-reference `ENVIRONMENT_SPEC.md` §6.2 and
  `CONFIG_SPEC.md` §3.1.
- Cloud release artifacts are container images, charts/manifests, deployment
  bundles, or provider-specific deployment packages with SBOM, provenance,
  checksums, signing, rollout, and rollback evidence.
- Cloud client bootstrap resolves surface-oriented deployed URLs and does not
  identify or operate the remote gateway implementation. Platform assembly
  hosting is governed outside the application repository.
- Local `cloud.development` `MUST NOT` start a standalone gateway, platform
  gateway, API listener, database, Redis, migration,
  seed process, or deployed-service worker. Dedicated cloud and edge ingresses
  are remote surfaces in this profile.

### 1.3 Application Mode Coverage

`CONFIG_SPEC.md` owns the canonical `runtimeTarget` vocabulary. This section
defines how those runtime targets participate in the two deployment profiles;
it is not a second enum.

| Application mode | Runtime target values | Allowed deployment profiles | Primary config owner | Release behavior |
| --- | --- | --- | --- | --- |
| Browser web | `browser` | `standalone`, `cloud`, or runtime-configurable for both | Public runtime config plus topology `browserDeliveries` from `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, and `APP_RUNTIME_TOPOLOGY_SPEC.md` | Standalone development uses a same-origin dev proxy; standalone production packages static assets into the application ingress; cloud uses a declared Web URL/static bundle with profile-specific rollout evidence. |
| PC desktop | `desktop` | `standalone`, `cloud`, or runtime-configurable for both | Desktop/user runtime config plus platform host config | Signed installer or app bundle; standalone may supervise a local gateway, cloud must not. |
| Large-screen tablet | `tablet-ipados`, `tablet-android` | `standalone`, `cloud`, or runtime-configurable for both | PC renderer config plus tablet host config | IPA/APK/AAB or platform package evidence; hosted tablet Web uses `browser`. |
| H5 and Capacitor mobile | `browser`, `capacitor-ios`, `capacitor-android` | `standalone`, `cloud`, or runtime-configurable for both | H5 public config plus optional Capacitor host config | H5 is a Web URL/static package; Capacitor produces IPA/APK/AAB. |
| Flutter mobile | `flutter-ios`, `flutter-android` | `standalone`, `cloud`, or runtime-configurable for both | Flutter app config plus platform host config | IPA/APK/AAB or store-owned package with signing and store rollout evidence. |
| Native mobile | `android-native`, `ios-native`, `harmony-native` | `standalone`, `cloud`, or runtime-configurable for both | Native app config plus platform host config | AAB/APK, IPA, Harmony package, app-store, or private distribution evidence. |
| Mini program | `mini-program` | `cloud` when served through platform review/release; `standalone` only for documented private/platform-local packages | Mini program config plus host platform config | Platform upload/review/release package with app id, version, and rollback notes. |
| Server service | `server` | `standalone` or `cloud` | Server process config | Archive, service package, or cloud service artifact with PostgreSQL/Redis and ingress evidence. |
| Container image or bundle | `container` | `standalone` for single-container units; `cloud` for orchestrated images/bundles | Mounted container config, env, and platform secrets | OCI image, Docker-compatible image, chart/manifest, or deployment bundle with digest and rollback evidence. |
| Test runner | `test-runner` | Not a production deployment profile; uses `environment = test` | Ephemeral test config | Test artifacts are evidence only and must not be published as production runtime packages. |

Rules:

- `deploymentProfile` answers which API/runtime topology is active.
  `runtimeTarget` answers where the executable config adapter runs. Client
  architecture, target platform, artifact format, and management ownership are
  separate metadata axes.
- A runtime-configurable client package `MUST` declare
  `profileBinding = runtime-configurable`, both supported profile values, and
  one non-side-effecting default. Server, gateway, worker, and container
  deployment units remain fixed-profile artifacts.
- `docker` is a packaging/tool ecosystem term. SDKWork runtime metadata uses
  `runtimeTarget = "container"` and package/workflow metadata uses container or
  OCI/Docker image formats as defined by `APP_MANIFEST_SPEC.md` and
  `GITHUB_WORKFLOW_SPEC.md`.
- Package metadata, workflow targets, release notes, and manifest entries
  `MUST` carry `runtimeTarget` plus either a fixed `deploymentProfile` or a
  runtime-configurable supported-profile set and validate them against the
  matrix above.
- Pure client packages do not have to expose HTTP ingress. Any API surface they
  serve, proxy, or compose still follows `WEB_FRAMEWORK_SPEC.md`,
  `API_SPEC.md`, and `WebRequestContext` rules.
- Browser artifacts with multiple implementations such as `pc-web` and `h5`
  carry architecture-specific delivery evidence. Runtime selection must not
  serve one architecture's proxy, static root, or SPA shell for another.

### 1.4 Development, Release, And Deployment Boundaries

The deployment profile has one meaning across the lifecycle, but each command
stage performs a different operation:

| Stage | Selects | Permitted side effect |
| --- | --- | --- |
| `dev` | `standalone.development` or `cloud.development` | Starts only processes declared local by the development topology |
| `release` | Standalone or cloud package targets | Produces, validates, signs, attests, or publishes immutable artifacts |
| `deploy` | An immutable artifact, deployment profile, and lifecycle environment | Plans, applies, validates, or rolls back an installation/rollout |

Rules:

- Release packaging `MUST NOT` apply a deployment, and deployment `MUST NOT`
  rebuild an artifact with different source or config.
- `dev:cloud` consuming a deployed API does not reclassify the local client
  package. Package fixed/runtime-configurable profile binding remains an
  explicit release-matrix fact.
- A deployment apply or rollback operation `MUST` name `standalone` or
  `cloud`, the lifecycle environment, immutable artifact identity, and the
  rollback target or forward-fix boundary before side effects.
- Fixed standalone and cloud artifacts from one logical release may share a
  SemVer version, but retain distinct package ids and evidence. One
  runtime-configurable client artifact retains one binary identity plus
  profile-specific runtime-config provenance, smoke, rollout, and recovery
  evidence.
- Environment-specific secrets and provider credentials are deployment inputs,
  not release artifact contents.

### 1.5 Orthogonal Deployment Dimensions

Deployment manifests and plans keep these dimensions separate from
`deploymentProfile`:

| Field | Canonical values |
| --- | --- |
| `deliveryKind` | `host-package`, `container-image`, `static-web`, `platform-package`, `configuration-bundle` |
| `deploymentDriver` | `host-service`, `container-runtime`, `kubernetes`, `static-host`, `application-store`, `mini-program-platform`, `nginx` |
| `managementModel` | `sdkwork-managed`, `customer-managed`, `platform-managed`, `end-user-managed` |
| `tenancyModel` | `single-tenant`, `multi-tenant` |
| `isolationModel` | `shared`, `dedicated` |
| `networkExposure` | `public`, `private`, `internal`, `offline` |
| `rolloutStrategy` | `recreate`, `rolling`, `blue-green`, `canary`, `platform-staged` |
| `availabilityMode` | `single-instance`, `high-availability`, `multi-region` |

Provider identity, provider region, availability zones, market region, and
storage region remain separate fields governed by `REGION_SPEC.md`. None of
these values may become a deployment profile or profile-id segment.

## 2. Environment Names

Standard environments:

```text
development
test
staging
production
```

Rules:

- Environment-specific base URLs, feature flags, deployment profile, and runtime target belong in bootstrap config.
- Shared packages `MUST NOT` hard-code environment URLs.
- Config keys `SHOULD` be capability-scoped and documented.
- Env files and materialized runtime documents `MUST` use canonical profile id
  `<deploymentProfile>.<environment>` and the architecture formats defined by
  `ENVIRONMENT_SPEC.md` section 5.1. Deployment and environment selection never
  relies on a one-dimensional `.env.production`, Vite mode, Flutter flavor,
  Spring profile, or native build variant.
- Public hostnames `MUST` follow the environment host formula registered in
  `APP_RUNTIME_TOPOLOGY_NAMING.md` section 9: `<role>[-<environment-suffix>].<base-domain>`
  for `development` (`-dev`), `test` (`-test`), and `staging` (`-staging`);
  bare `<role>.<base-domain>` for `production`. Deployment manifests, nginx
  site files, certificates, and operator runbooks reference the same registered
  hosts (`im-test.sdkwork.com`, `api-dev.sdkwork.com`, `im.sdkwork.com`,
  `api.sdkwork.com`). Prefix-style hosts such as `test-im.sdkwork.com` are
  retired.

## 3. Runtime Bootstrap

Bootstrap owns:

- SDK client construction.
- Base URL selection.
- Token storage adapter selection.
- IAM login/session integration and Rust AppContext validation follow `IAM_LOGIN_INTEGRATION_SPEC.md` in standalone, cloud, desktop, server, container, browser, mobile, and test runner targets.
- Deployment profile and runtime target selection.
- Feature flag provider.
- Host/native adapter injection.

Shared modules own:

- Domain services.
- UI composition.
- Generated SDK method consumption.
- Validation and error mapping.

## 4. Java/Rust Parity

Rules:

- Cloud and standalone implementations `MUST` expose the same OpenAPI contract for shared domains.
- Java, Rust, or other runtime implementations that expose shared RPC services `MUST` preserve the proto contract and operationId mapping defined by `RPC_SPEC.md`.
- Database schemas for shared domains `MUST` map to `DATABASE_SPEC.md`.
- Contract tests `SHOULD` run against both Java and Rust implementations.
- If a standalone runtime cannot support a cloud-only capability, the standard contract must define an explicit unavailable capability response, not a different schema.

## 4.1 RPC Deployment Parity

Rules:

- RPC servers MUST be enabled by explicit runtime config; adding a proto contract does not automatically publish a network endpoint.
- Standalone desktop runtime MAY bind RPC to loopback without TLS when documented as local-only.
- Standalone service and cloud production RPC endpoints SHOULD use TLS; service-to-service production RPC SHOULD use mTLS.
- Public app RPC endpoints must pass through approved ingress, auth, rate limit, observability, and reflection controls.
- Reflection MUST be disabled or access-controlled for public production endpoints.
- Health checks MAY be exposed to private operators, but must not leak tenant data, schema details, secrets, or internal dependency names.
- RPC and HTTP adapters in the same process MUST share runtime/service/storage wiring instead of creating divergent implementations.

## 4.2 Discovery Deployment

Rules:

- Cloud and multi-instance production deployments that use dynamic RPC resolution MUST declare a `sdkwork-discovery` endpoint or approved topology-provided discovery ingress.
- Discovery production deployments MUST use durable PostgreSQL storage per `DISCOVERY_SPEC.md`.
- Discovery horizontally scaled deployments SHOULD document watch stream stickiness or revision-based reconnect policy.
- RPC data-plane services MUST register with discovery before accepting cross-service traffic when dynamic resolution is enabled.
- RPC data-plane graceful shutdown MUST deregister from discovery and drain in-flight calls per `RPC_RESILIENCE_SPEC.md`.

## 4.3 RPC Framework Deployment

Rules:

- RPC servers and approved RPC clients MUST integrate `sdkwork-rpc-framework` per `RPC_FRAMEWORK_SPEC.md`.
- Service hosts MUST wire RPC bootstrap stages before feature services start when RPC is enabled.
- Production RPC clients MUST use framework resolver profiles; static peer lists are development-only unless a migration exception is recorded.
- Framework TLS/mTLS, reflection, health, and resilience profiles MUST be declared in runtime config and verified in deployment tests.

## 5. SdkWork Cloud Router Release Deployment Standard

SdkWork Cloud Router release packages must support fast installation on Linux,
Windows, and macOS across `x64` and `arm64` architectures. Archive, service,
single-container packages use fixed `standalone`; cloud container images and
orchestration bundles use fixed `cloud`. Desktop packages are
runtime-configurable for both profiles unless a release explicitly limits the
client.

### 5.1 Runtime Profile Defaults

| Package mode | Deployment profile | Runtime target | Database default | Startup behavior |
| --- | --- | --- | --- | --- |
| Archive | `standalone` | `server` | PostgreSQL | Initialize missing config, then run with structured PostgreSQL configuration. |
| Service | `standalone` | `server` | PostgreSQL | Initialize missing config, install service integration, then run after PostgreSQL is configured. |
| Single container | `standalone` | `container` | PostgreSQL | Use mounted config, protected secrets, and a mounted writable data directory as one application unit. |
| Cloud image/bundle | `cloud` | `container` | Managed PostgreSQL | Use orchestrator-injected config, platform secrets, managed dependencies, probes, rollout, and rollback policy. |
| Desktop | runtime-configurable: `standalone`, `cloud` | `desktop` | SQLite for declared standalone client-local data; PostgreSQL for any colocated backend service; no local service database in cloud | Initialize isolated profile config; supervise the standalone gateway only when standalone-local placement is active. |

Standalone server/container and cloud container deployments default to
PostgreSQL. Desktop runtime targets default only declared client-local persistence to SQLite.

Desktop packages must keep declared client-local data on SQLite by default. Development
orchestration is stricter: SDKWork application root `pnpm dev:browser` and
`pnpm dev:desktop` default to PostgreSQL, `deploymentProfile = standalone`,
and `environment = development`. Explicit client-local SQLite or cloud development
paths must use suffixed commands such as `pnpm dev:desktop:sqlite` or
`pnpm dev:browser:cloud`; the SQLite suffix must not select a backend database.
Cloud development consumes deployed APIs and does not
select a local database. The PostgreSQL development profile belongs to
standalone dev orchestration and any launched backend service runtime; it must
not change the installed desktop package default or the desktop user data
location.

Redis is enabled and required by default for cloud deployments and standalone
server/container packages that declare shared runtime state. Release packages
must include the `[redis]` section and password-file paths when Redis is
required, and startup must fail fast when required Redis configuration is
missing. Desktop runtime targets keep Redis optional and disabled by default.

### 5.2 Required Runtime Env

Private process variables:

```text
SDKWORK_CLOUDROUTER_DEPLOYMENT_PROFILE=standalone
SDKWORK_CLOUDROUTER_RUNTIME_TARGET=server
SDKWORK_CLOUDROUTER_CONFIG_FILE=/etc/sdkwork/router/cloudrouter.toml
SDKWORK_DATABASE_ENGINE=postgresql
SDKWORK_DATABASE_HOST=db.example.com
SDKWORK_DATABASE_PORT=5432
SDKWORK_DATABASE_NAME=sdkwork_ai_prod
SDKWORK_DATABASE_SCHEMA=sdkwork_ai_prod
SDKWORK_DATABASE_USERNAME=sdkwork_ai_prod
SDKWORK_DATABASE_PASSWORD_FILE=/etc/sdkwork/database/database.secret
SDKWORK_DATABASE_SSL_MODE=require
SDKWORK_DATABASE_MAX_CONNECTIONS=16
# SDKWORK_DATABASE_URL=postgresql://sdkwork_ai_prod:<password>@db.example.com:5432/sdkwork_ai_prod
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
```

Browser-visible portal variables:

```text
# /v1 is valid here only for vendor compatibility open-api declared with x-sdkwork-wire-protocol: external per API_SPEC.md section 4.5.2.
# SDKWork-owned business open-api domains use their approved prefix, for example /im/v3/api.
PORTAL_PUBLIC_API_BASE_URL=/v1
PORTAL_PUBLIC_OPEN_API_BASE_URL=/v1
PORTAL_PUBLIC_APP_API_BASE_URL=/app/v3/api
PORTAL_PUBLIC_BACKEND_API_BASE_URL=/backend/v3/api
```

Rules:

- `SDKWORK_CLOUDROUTER_CONFIG_FILE` overrides the canonical TOML path defined by `RUNTIME_DIRECTORY_SPEC.md`.
- `SDKWORK_CLOUDROUTER_DEPLOYMENT_PROFILE` must be `standalone` for archive, service,
  single-container, and desktop releases, and `cloud` for cloud image/bundle
  releases.
- `SDKWORK_CLOUDROUTER_RUNTIME_TARGET` must be `server` for archive/service releases,
  `container` for container images, and `desktop` for desktop installers.
- `SDKWORK_CLOUDROUTER_DEPLOYMENT_MODE` is retired. New application startup,
  checked-in examples, release env files, workflow config, app manifests, and
  runtime TOML must reject it. Migration tools may read it only outside
  application startup and must normalize it into `SDKWORK_CLOUDROUTER_DEPLOYMENT_PROFILE`
  plus `SDKWORK_CLOUDROUTER_RUNTIME_TARGET` before application code sees the config.
- Server runtime TOML and private process env must declare PostgreSQL through
  structured fields: `SDKWORK_DATABASE_ENGINE`, `SDKWORK_DATABASE_HOST`,
  `SDKWORK_DATABASE_PORT`, `SDKWORK_DATABASE_NAME`, `SDKWORK_DATABASE_SCHEMA`,
  `SDKWORK_DATABASE_USERNAME`, `SDKWORK_DATABASE_PASSWORD_FILE`, and
  `SDKWORK_DATABASE_SSL_MODE`.
- Application-prefixed database identity keys such as
  `SDKWORK_<APP>_DATABASE_NAME`, `SDKWORK_<APP>_DATABASE_SCHEMA`, and
  `SDKWORK_<APP>_DATABASE_URL` are retired migration inputs. Checked-in release
  env, installers, deployment mappings, and application startup `MUST` use only
  the canonical `SDKWORK_DATABASE_*` keys and `MUST NOT` dual-read old names.
- `DATABASE_PROVIDER` and `DATABASE_SSLMODE` are not standard names and must
  not be accepted by new SDKWork applications.
- `SDKWORK_DATABASE_URL` remains an explicit private override and must not be exposed through `PORTAL_PUBLIC_*` or any browser runtime script.
- `SDKWORK_CLOUDROUTER_REDIS_HOST`, `SDKWORK_CLOUDROUTER_REDIS_PORT`, `SDKWORK_CLOUDROUTER_REDIS_DATABASE`, `SDKWORK_CLOUDROUTER_REDIS_USERNAME`, `SDKWORK_CLOUDROUTER_REDIS_URL`, `SDKWORK_CLOUDROUTER_REDIS_PASSWORD_FILE`, `SDKWORK_CLOUDROUTER_REDIS_PASSWORD`, `SDKWORK_CLOUDROUTER_REDIS_KEY_PREFIX`, `SDKWORK_CLOUDROUTER_REDIS_TLS`, `SDKWORK_CLOUDROUTER_REDIS_MAX_CONNECTIONS`, `SDKWORK_CLOUDROUTER_REDIS_CONNECT_TIMEOUT_MILLIS`, `SDKWORK_CLOUDROUTER_REDIS_COMMAND_TIMEOUT_MILLIS`, and `SDKWORK_CLOUDROUTER_REDIS_POOL_IDLE_TIMEOUT_SECONDS` are private Redis overrides and must not be exposed through browser runtime script.
- `[redis].enabled` defaults to `true` for cloud releases and standalone
  server/container releases that declare shared runtime state; it defaults to
  `false` for desktop. Deployments that require Redis must configure
  `[redis].host`, `[redis].port`, `[redis].database`, and protected password
  handling before first startup. Use `[redis].url` only as an advanced
  managed-endpoint override; use separate `tls`, pool, timeout, and
  `key_prefix` fields for standard deployments.
- `PORTAL_PUBLIC_APP_API_BASE_URL` and `PORTAL_PUBLIC_BACKEND_API_BASE_URL` must remain independently configurable because selected deployments may route them to different hosts.
- SDKWork business open-api and vendor compatibility open-api configuration should use `PORTAL_PUBLIC_OPEN_API_BASE_URL` or `PORTAL_PUBLIC_API_BASE_URL`, not an ambiguous gateway env name. A `/v1` value is valid only for vendor compatibility open-api declared with `x-sdkwork-wire-protocol: external` per `API_SPEC.md` section 4.5.2; SDKWork-owned business open-api domains must use their approved non-app/non-backend prefix from section 4.5.1, for example `/im/v3/api`.

### 5.3 Runtime Directory Paths

Cloud Router uses application code `router` for directory paths and process name
`cloudrouter` for binaries, services, commands, and process-specific config
filenames.

| Target | Config file | Data directory |
| --- | --- | --- |
| Linux server/service/container | `/etc/sdkwork/router/cloudrouter.toml` | `/var/lib/sdkwork/router` |
| Windows server/service | `%ProgramData%/sdkwork/router/cloudrouter.toml` | `%ProgramData%/sdkwork/router/Data` |
| macOS server/service | `/Library/Application Support/sdkwork/router/cloudrouter.toml` | `/Library/Application Support/sdkwork/router/Data` |
| Linux desktop | `~/.sdkwork/router/config/cloudrouter.toml` | `~/.sdkwork/router/data` |
| Windows desktop | `%USERPROFILE%/.sdkwork/router/config/cloudrouter.toml` | `%USERPROFILE%/.sdkwork/router/data` |
| macOS desktop | `~/.sdkwork/router/config/cloudrouter.toml` | `~/.sdkwork/router/data` |

Rules:

- Linux release packages must also use `/usr/lib/sdkwork/router`,
  `/usr/share/sdkwork/router`, `/usr/share/doc/sdkwork/router`,
  `/var/log/sdkwork/router`, `/var/cache/sdkwork/router`, and
  `/run/sdkwork/router` when those directories are needed.
- User-private Cloud Router files must use `~/.sdkwork/router` or the Windows
  equivalent `%USERPROFILE%/.sdkwork/router`.
- Development PostgreSQL examples must use `.env.postgres.example` for checked-in
  local placeholders and `.env.postgres` for ignored developer overrides.
- Historical desktop paths such as XDG or display-name based directories may
  be read as compatibility fallbacks during migration, but new writes must use
  the canonical SDKWork paths.

### 5.4 Fast Initialization Contract

Every release package must include the installer binary and document these target-host commands:

```sh
cloudrouterctl ensure
cloudrouterctl refresh-catalog --force
```

The install package planner must also include release env checks and writes:

```sh
pnpm release:env:write -- --check
pnpm release:env:write -- --force
```

Rules:

- Initialization may create the default runtime TOML file when it is missing.
- Server initialization must generate an explicit structured PostgreSQL config.
- PostgreSQL password material should be supplied through `password_file` or platform secrets; direct `password` is allowed only when the runtime TOML is protected as a secret-bearing file.
- Redis password material should be supplied through `password_file` or platform secrets when `[redis].enabled = true`; direct `[redis].password` is allowed only when the runtime TOML is protected as a secret-bearing file.
- Desktop initialization may create the SQLite file under the SDKWork user private data directory.
- Desktop development startup may also launch a backend service with the
  PostgreSQL dev profile; that backend service database is not the desktop
  package's local SQLite store.
- Release packages must include `config/cloudrouter.toml.example`, generated `INSTALL.md`, generated `install-manifest.json`, binaries, portal assets, and SDK archives.
- Release packages must not include `.env.release.local`, secrets, local test databases, `node_modules`, or VCS metadata.
- Container packages must mount configuration and mutable data rather than baking secrets or database state into the image.

### 5.5 Ubuntu Release Start Example

For a staged Ubuntu server release:

```sh
sudo apt install ./cloudrouter-linux-x64-service-0.2.0.deb
sudo editor /etc/sdkwork/router/cloudrouter.toml
sudo systemctl start cloudrouter
curl http://127.0.0.1:3900/healthz
curl http://127.0.0.1:3900/readyz
```

The Linux service package creates `/etc/sdkwork/router/cloudrouter.toml`,
`/etc/sdkwork/router/cloudrouter.env`, and the workspace database password file
`/etc/sdkwork/database/database.secret`, then
enables `cloudrouter.service` on systemd hosts. Operators configure PostgreSQL
in the TOML or protected secret file before starting the service.

For public-domain publication, use **`sdkwork-webserver`**
(`SDKWORK_WEBSERVER_SPEC.md` §0.1, `NGINX_SPEC.md` §0). Stock OpenResty/nginx
and `/etc/nginx/sites-enabled/...` are **not** the live public edge.
Module configs live under `deployments/webserver/`; the webserver import plane
reverse-proxies platform API hosts to the gateway (default sibling /
host-mapped probe `http://127.0.0.1:3910` for development). Certificate
material uses `/etc/sdkwork/certs/letsencrypt/<cert-name>/fullchain.pem` plus
`/etc/sdkwork/certs/letsencrypt/<cert-name>/privkey.pem`.

## 6. Container Install Image And Multi-Instance Deployment

The unified container install image is one immutable artifact per release. It
carries no environment binding: the lifecycle environment, domain, database,
and credentials are deployment inputs resolved by the container entrypoint at
start.

Rules:

- One image, every environment: all lifecycle environments of the
  application (`development`, `test`, `staging`, and `production` where
  declared) use the same image tag. Environment selection `MUST` happen at
  deploy time through the deployment env file (for example
  `SDKWORK_WEBSERVER_ENVIRONMENT` / `GATEWAY_ENVIRONMENT` and related
  variables); image builds `MUST NOT` bake environment values.
- Every environment supports multi-instance deployment. Each instance:
  - runs as its own compose project `<application>-<environment>-i<index>`
    (for example `sdkwork-webserver-production-i1` or
    `sdkwork-api-cloud-gateway-production-i2`);
  - owns a unique node identity (the application's node-identity variable —
    `SDKWORK_WEBSERVER_NODE_UUID` for sdkwork-webserver — or the
    container-hostname-derived default) and its own host port;
  - joins the per-environment shared network and mounts the per-environment
    shared secrets/data volumes.
- Only one instance publishes application-designated edge host ports (for
  example the sdkwork-webserver 80/443 import plane on instance 1). External
  load balancing across instances uses the per-instance host ports; a
  deterministic instance port plan (for example the gateway
  `GATEWAY_HOST_PORT + (index - 1) * 10` stride) keeps environments
  collision-free.
- Shared PostgreSQL and Redis are prerequisites. Instance 1 starts first,
  completes database migration, and reaches health before instances 2..N
  start.
- Application-specific singleton services stay single-instance per
  environment: the sdkwork-api-cloud-gateway bundle runs one
  knowledgebase-rpc singleton (the `<application>-<environment>-deps`
  project) that provisions shared secrets material before instance 1, and
  every gateway instance reaches it over the shared network by service DNS
  name. The public reverse proxy remains owned by the independent
  sdkwork-webserver deployment, which upstreams the per-instance gateway
  host ports.
- The bundle deploy script is the single generic entrypoint:
  `deploy.sh --environment <env> [--replicas N] [--down|--ps|--logs]`.
  It `MUST` fail before side effects when the environment is missing or
  unknown, and `MUST` stay idempotent (re-running updates the existing stack).
- Container space mounts follow `SDKWORK_WEBSERVER_SPEC.md` section 17
  (sdkwork-webserver only): the space root is read-only and the
  `sdkwork-space` checkout subtree is a read-write overlay (clone/pull
  target). The import plane default active set is `cloud`
  (`SDKWORK_WEBSERVER_IMPORT_PROFILE`), and every container listens on
  gateway port 3800 internally so module `server.standalone.toml` upstreams
  stay uniform across instances and hosts.
- Drive delivery cache mount (sdkwork-webserver only): the host directory
  `/opt/deploy/drive` is bind-mounted read-write at the same container path
  and is shared by every instance of an environment. The webserver uses the
  `website-cache` subtree as the Drive website content local delivery cache
  root (`SDKWORK_DRIVE_WEBSITE_CACHE_ROOT`, default
  `/opt/deploy/drive/website-cache`) so multi-instance deployments share one
  disk LRU cache; races are made safe by content-addressed immutable entries
  (`DRIVE_SPEC.md` §17.3). The rest of `/opt/deploy/drive` is reserved for
  drive-owned local file storage and `MUST NOT` be used for container-ephemeral
  state.
- Multiple independently configurable instances: a per-instance override file
  `env/<environment>.i<index>.env` is layered on top of the base environment
  env file (later `--env-file` wins), so each instance can carry its own
  primary domain, clone URL, TLS/ACME profile, or any other deployment input.
- See `PNPM_SCRIPT_SPEC.md` section 4.4 for the owning commands
  (`build:container:install`, `deploy:apply:standalone:docker`).

## 7. Acceptance Checklist

- [ ] Deployment profile is explicit and is either `standalone` or `cloud`.
- [ ] Runtime target is explicit and separate from deployment profile.
- [ ] SDK construction is isolated in bootstrap.
- [ ] Shared modules do not hard-code backend type.
- [ ] Standalone/cloud API parity is tested.
- [ ] Standalone browser profiles prove one browser-visible page/API origin,
      canonical-path development proxying, architecture selection, and
      production static/SPA packaging through the application ingress.
- [ ] Standalone/cloud RPC parity is tested when shared proto services are exposed.
- [ ] Discovery endpoint and registration lifecycle are declared when dynamic RPC resolution is enabled.
- [ ] RPC framework integration is verified for RPC-enabled service hosts.
- [ ] Environment config is documented and typed.
- [ ] The unified install image is environment-neutral and supports every
      lifecycle environment at deploy time.
- [ ] Every environment can deploy N instances with unique node identities
      and shared per-environment state.
