# SDKWork IAM Application Bootstrap Standard

- Version: 1.2
- Scope: deploy applications, installations, bootstrap orchestration, access credential issuance, manifest mapping, reusable framework package, and application onboarding enforcement
- Related: `IAM_SPEC.md`, `APPLICATION_IDENTITY_SPEC.md`, `APPLICATION_FACTORY_DEPLOYMENT_SPEC.md`, `APP_MANIFEST_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `MODULE_SPEC.md`, `API_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `TEST_SPEC.md`, `DATABASE_FRAMEWORK_SPEC.md`

This standard defines the canonical deploy-application-first IAM application model and the reusable bootstrap framework that every new SDKWork application must use.

## 1. Domain Model

SDKWork IAM application onboarding has one installation layer anchored on the deploy application. Do not introduce `plus_*` tables, `studio_*` tables, or a separate deployment entity in IAM database ownership.

| Layer | Database | Meaning |
| --- | --- | --- |
| Deploy application | Owned outside IAM (deploy/cloudrouter manifests) | The deployed runtime identity an installation serves; `deployApplicationId` is the anchor |
| Installation (wire name "installation") | `iam_application_installation` (renamed from `iam_application_installation` by IAM migration `0043`) | Tenant-scoped runtime instance with `deploy_application_id`, domain, access permissions, `application_type`, status, and runtime `app_id` |

Rules:

- Application templates are retired: provisioning no longer registers a template and accepts no `templateId` or `appKey`.
- Provisioning creates or reconciles one installation bound to the deploy application it serves, from explicit attributes (`applicationType`, `instanceKey`, `displayName`, `environment`, `accessPermissions`, `runtimeConfig`).
- Enable transitions the installation to an operable state.
- Access credential issuance creates delegated `auth_token` and `access_token` only after the installation is enabled.
- Deployment is not a separate IAM table. Deployment behavior is expressed through provision, update, enable, and runtime configuration on the installation.
- Application identity, the deploy-application anchor, and access-token `app_id` binding follow `APPLICATION_IDENTITY_SPEC.md`. The end-to-end factory pipeline around this bootstrap (deploy publication, environment/domain planning, token materialization, upgrade, uninstall, failure/compensation) follows `APPLICATION_FACTORY_DEPLOYMENT_SPEC.md`; this standard remains the bootstrap command and API authority.

## 2. Canonical Backend API Surface

All bootstrap operations live in backend-api only. Static path segments use `lower_snake_case`.

| Business step | Method | Path | operationId | Auth mode |
| --- | --- | --- | --- | --- |
| Provision installation | `POST` | `/backend/v3/api/iam/installations` | `installations.create` | `bootstrap-body` |
| Update installation | `PATCH` | `/backend/v3/api/iam/installations/{installationId}` | `installations.update` | `bootstrap-body` |
| Enable installation | `POST` | `/backend/v3/api/iam/installations/{installationId}/enable` | `installations.enable` | `bootstrap-body` |
| Retrieve installation | `GET` | `/backend/v3/api/iam/installations/{installationId}` | `installations.retrieve` | `dual-token` |
| Issue access credential | `POST` | `/backend/v3/api/iam/access_credentials` | `accessCredentials.create` | `bootstrap-body` |

Rules:

- Bootstrap operations `MUST NOT` require dual-token headers.
- `installations.retrieve` is an authenticated admin read (dual-token) for runtime inspection; it is not part of the bootstrap-body flow and returns redacted `runtimeConfig` (including `[redacted]` for `oauth.relyingParty.clientSecretHash`).
- Bootstrap body authentication `MUST` use bootstrap operator credentials in the JSON body through `authToken` or username/email/phone plus `password`. Development often uses the platform super-admin account, but the auth profile directory and env keys `MUST NOT` assume that role name.
- Handlers `MUST` enforce bootstrap-operator checks, per-operation permission codes, and tenant scope before business rules run.
- Consumers `MUST NOT` hand-craft raw HTTP to these paths when `@sdkwork/iam-application-bootstrap` or generated backend SDK clients are available.

Required permission codes:

```text
iam.installations.provision
iam.installations.update
iam.installations.enable
iam.access_credentials.create
```

Admin read permission for `installations.retrieve` reuses `iam.installations.update` so OAuth relying-party administrators can read back redacted runtime config without bootstrap-body credentials.

### 2.1 Authenticated Tenant Application Administration

Backend-admin browser surfaces must not collect or forward bootstrap operator credentials. Tenant
application management in those surfaces uses a separate dual-token operation family that reuses
the canonical installation domain service and permission codes:

| Business step | Method | Path | operationId | Permission |
| --- | --- | --- | --- | --- |
| List installations | `GET` | `/backend/v3/api/iam/tenants/{tenantId}/installations` | `installations.list` | `iam.installations.update` |
| Retrieve installation summary | `GET` | `/backend/v3/api/iam/tenants/{tenantId}/installations/summary` | `installations.summary.retrieve` | `iam.installations.update` |
| Provision installation | `POST` | `/backend/v3/api/iam/tenants/{tenantId}/installations` | `installations.management.create` | `iam.installations.provision` |
| Update domain and access scope | `PATCH` | `/backend/v3/api/iam/tenants/{tenantId}/installations/{installationId}` | `installations.management.update` | `iam.installations.update` |
| Enable installation | `POST` | `/backend/v3/api/iam/tenants/{tenantId}/installations/{installationId}/enable` | `installations.management.enable` | `iam.installations.enable` |
| Disable installation | `POST` | `/backend/v3/api/iam/tenants/{tenantId}/installations/{installationId}/disable` | `installations.management.disable` | `iam.installations.update` |

Rules:

- These operations require the standard backend-admin dual-token request context and tenant
  isolation. Platform operators may target another tenant only through the governed platform
  tenant access rule.
- Management provisioning takes the same deploy-application attributes (`deployApplicationId`,
  `applicationType`, `instanceKey`, `displayName`, `environment`, `accessPermissions`,
  `runtimeConfig`); it does not register an application template and accepts no `templateId` or
  `appKey`.
- Management and bootstrap provisioning both accept the release scope: `ownershipScope`
  (`TENANT` | `ORGANIZATION` | `USER`, default `TENANT`) plus `ownerUserId` for `USER`. The command
  `MUST` validate the pair against `organizationId` (`TENANT` and `USER` require `0`,
  `ORGANIZATION` requires non-zero) and `MUST` fail closed instead of defaulting a mismatched
  combination. The scope is immutable afterwards: re-provisioning an installation with a different
  scope is a conflict naming the stored scope, never an in-place change
  (`APPLICATION_IDENTITY_SPEC.md` §4.1).
- Browser applications must use `installations.management.*` through the generated backend
  SDK or approved IAM service facade. They must not call bootstrap-body operations or handle
  bootstrap credentials.
- List operations use standard server-side pagination and optional `q`, `status`, and
  `environment` filters.
- Enable and disable are explicit status transitions. Disabled installations must remain
  inoperable for authentication and token issuance.

## 3. Reusable Framework Package

The canonical reusable module is:

```text
@sdkwork/iam-application-bootstrap
```

Physical package root in `sdkwork-iam`:

```text
apps/sdkwork-iam-common/packages/sdkwork-iam-application-bootstrap
```

Rules:

- New applications and appbase-derived repositories `MUST` use this package for provision → enable → access credential orchestration, anchored on the deploy application the installation serves.
- Application code `MUST NOT` duplicate manifest mapping, auth merge, env output formatting, or step ordering in local scripts. No call registers an application template, and no request body carries `templateId` or `appKey`.
- CLI/bootstrap scripts `MAY` remain thin wrappers that parse args, load manifest/profile, choose a transport, and call the framework module.
- The framework `MUST` expose a transport port (`IamApplicationBootstrapClient`) and at least these adapters:
  - `createFetchIamApplicationBootstrapClient(...)` for CLI/tooling environments
  - `createIamApplicationBootstrapClientFromBackend(...)` for generated backend SDK clients
  - `createIamApplicationBootstrapClientFromIamService(...)` for `@sdkwork/iam-service` facades
  - `createIamApplicationBootstrapFromIamService(...)` and `createIamApplicationBootstrapFromIamRuntime(...)` for runtime/service composition
- The framework `MUST` expose:
  - `bootstrapApplicationFromManifest(...)` for manifest-driven onboarding
  - `bootstrapDeployApplication(...)` for onboarding a complete deploy-application command without a manifest
  - `createIamApplicationBootstrap(...)`
  - optional `updateTenantApplication(...)` on the client port and module facade
  - manifest mapping helpers, including `mapManifestAppTypeToApplicationType(...)`, `resolveDeployApplicationId(...)`, and `deriveProvisioningIdempotencyKey(...)`
  - command validation (`validateTenantApplicationProvisionCommand(...)`) and bootstrap auth/env resolution helpers
  - env handoff helpers such as `formatBootstrapEnvFile(...)`
- The provisioning command `MUST` carry `applicationType` (`api` | `h5` | `pc` | `flutter` | `miniprogram` | `ios` | `android` | `harmonyos` | `desktop` | `other`) and `deployApplicationId`; the framework `MUST` fail closed naming the missing field instead of sending an incomplete body. This is the IAM runtime and `@sdkwork/iam-application-bootstrap` vocabulary, and it `MUST` match the Deploy endpoint the installation serves.
- Repeated onboarding with the same `provisioningIdempotencyKey` `MUST` be a replay: the framework returns the first outcome and the API reconciles the one installation bound to that deploy application.

Forbidden in application-owned bootstrap code:

- raw `fetch`/`axios`/HTTP client calls to bootstrap IAM paths
- copied manifest-to-command mapping outside the framework unless an approved local narrowing spec documents an exception
- direct SQL against `iam_application_installation` from application scripts

## 4. Manifest Mapping

`agent.app.config.json` remains the registration source of truth. See `APP_MANIFEST_SPEC.md` for field semantics.

Minimum manifest fields for IAM bootstrap:

| Manifest field | Bootstrap use |
| --- | --- |
| `app.name`, `app.displayName` | installation `displayName` |
| `app.appType` | source of the product-semantic `applicationType` when the caller does not pass the proven surface: `APP_HTML`→`h5`, `APP_FLUTTER`→`flutter`, `APP_REACT`/`APP_VUE`/`APP_PC`→`pc`, `APP_UNIAPP`→`miniprogram`, `APP_IOS`→`ios`, `APP_ANDROID`→`android`, `APP_HARMONY`→`harmonyos`, `APP_DESKTOP`→`desktop`, `APP_API`/`SDK`→`api`, otherwise `other`. A deployment that registers its surfaces from `runtime.family`/`runtime.framework`/`publish.platforms` (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §14.6) passes the proven type instead, because `APP_REACT` alone cannot distinguish an H5 root from a PC root |
| `backend.deployApplicationId` | deploy application anchor the installation serves; the deployment's own application id. A self-provisioned installation whose deployment identity is the IAM runtime id may fall back to `backend.appId`, but a deployment that assigns its own id `MUST` pass it here, through the caller, or via `SDKWORK_DEPLOY_APPLICATION_ID` |
| `backend.accessTokenPermissionScope` or `backend.permissionScope` | required non-empty default access permissions |
| `backend.tenantId`, `backend.organizationId` | installation scope defaults |
| `backend.appId` | configured runtime identity: the installation selection key and the credential-entry runtime `appId`. It `MUST NOT` be read as the deploy anchor or as the token `app_id`; the token's `app_id` is the installation's deploy application (`APPLICATION_IDENTITY_SPEC.md` §4) |
| `backend.primaryDomain` or runtime `--domain` / env | installation domain |
| `oauth.relyingParty` | `runtimeConfig.oauth.relyingParty`; absent registers no OAuth relying party |
| `release.notes[]` | optional installation version label |

Rules:

- `backend.accessTokenPermissionScope` `MUST` be a non-empty string array for every new app.
- Bootstrap `MUST` fail closed when default access permissions are missing.
- Bootstrap `MUST` fail closed naming `deployApplicationId` when neither the caller nor the manifest supplies it. The anchor comes from configuration only; it is never generated.
- Bootstrap `MUST` fail closed naming `applicationType` when neither the caller nor `app.appType` supplies it.
- An empty explicit `accessPermissions` array is a valid choice meaning "no API scope"; it `MUST NOT` be replaced by a default.
- Manifest content `MUST NOT` contain secrets, live tokens, or bootstrap passwords.
- Every runnable manifest-bearing application root, including PC, H5/Capacitor, Flutter, native Android, native iOS, native HarmonyOS, mini program, and future client roots, `MUST` declare a non-empty `backend.appId` when it uses credential-entry.
- `backend.appId` is the sole manifest-derived IAM runtime application identity. Bootstrap and token generation `MUST NOT` infer or append identity segments from `app.key`, `runtime.family`, `runtime.framework`, package platform, runtime target, or client architecture metadata.
- A multi-surface repository `MUST` discover the repository manifest and each direct manifest-bearing `apps/*` root without hardcoded architecture suffix lists. Each credential-entry surface `MUST` use a unique `backend.appId`, and repeated bootstrap runs `MUST` reconcile the same tenant-application rows.

### 4.1 Bootstrap Owner, Default Permissions, And Production Guards

Bootstrap has two different principals and they must not be conflated:

| Principal | Purpose | Allowed lifetime |
| --- | --- | --- |
| Bootstrap operator | Provisions/enables the installation and issues initial access credentials | Operational action only; credentials come from a secret store or interactive operator auth |
| Application bootstrap owner | First tenant/organization owner or invite target for the new application | Runtime subject with ordinary `org_admin` or application-owned owner role, never implicit platform authority |

Rules:

- Production bootstrap `MUST NOT` create a live `platform_super_admin` user, default password, default API key, or unbounded bootstrap token.
- Production bootstrap owner creation `MUST` use an explicit owner subject, invitation, or operator-approved binding in the deployment profile. Demo defaults are allowed only in dev/test profiles.
- `backend.accessTokenPermissionScope` is a bootstrap transport allowlist. It `MUST` be minimal, standard-formatted, and limited to credential-entry/pre-login or explicitly documented bootstrap calls. It must not duplicate entire module catalogs.
- Application bootstrap scripts `MUST` be idempotent: repeated runs reconcile the installation, owner binding, access credential, and environment handoff by stable keys instead of inserting duplicates.
- Default role bindings created by bootstrap `MUST` follow the actor initialization and default grant matrix in `PERMISSION_STANDARD_SPEC.md` and pass the same IMF role assignability and exclusion checks as runtime grants unless a seed-only exception is declared in `IAM_MODULE_MANIFEST_SPEC.md`.
- Super-admin activation, rotation, and emergency access `MUST` be governed by `PERMISSION_STANDARD_SPEC.md` and `IAM_RBAC_FEDERATION_SPEC.md`, not application-local bootstrap scripts.

## 5. Runtime Environments

The same framework `MUST` work across these environments by swapping only the transport adapter and environment resolution:

| Environment | Required adapter | Notes |
| --- | --- | --- |
| Local CLI / CI bootstrap | `createFetchIamApplicationBootstrapClient` | Uses `admin:bootstrap:app` or equivalent thin script |
| SaaS/private backend SDK runtime | `createIamApplicationBootstrapClientFromBackend` | Uses generated `@sdkwork/iam-backend-sdk` or approved backend SDK |
| Existing IAM service runtime | `createIamApplicationBootstrapClientFromIamService` | Uses `@sdkwork/iam-service` without raw HTTP |
| Server/container service bootstrap | fetch or backend SDK adapter | May write `.sdkwork.local.env` or inject env through approved secret store |
| Embedded standalone / installer runtime | `sdkwork-iam-embedded-application-bootstrap` (Rust) | Reads `agent.app.config.json`, calls `ensure_tenant_application_runtime` directly on the IAM Postgres profile |

### 5.1 Embedded Rust Runtime Bootstrap

Naming follows `NAMING_SPEC.md`: the retired `product-*` bootstrap prefix is forbidden. Use `installation` for IAM registry rows and `embedded application bootstrap` for the shared Rust crate.

When IAM runs inside an application process or installer (standalone gateway, database ensure, or another approved embedded startup path), applications `MUST` use the shared Rust crate:

```text
sdkwork-iam/crates/sdkwork-iam-embedded-application-bootstrap
```

An application gateway that mounts `sdkwork-api-iam-assembly` through
`assemble_app_api_contribution()` satisfies this dependency requirement when the IAM assembly
owns database bootstrap and delegates tenant-application provisioning to the shared embedded
bootstrap implementation before returning its routes. The consuming gateway must not add an
unused direct embedded-bootstrap dependency or duplicate that lifecycle locally.

Rules:

- Application repositories `MUST NOT` duplicate manifest mapping, Postgres `search_path` wiring, tenant-application reconcile logic, or raw SQL against `iam_application_installation`.
- Application repositories `MAY` keep a thin adapter crate that supplies additional runtime bindings (for example IM PC + H5) but `MUST` delegate to `ensure_tenant_application_from_app_root` or `ensure_tenant_application_from_app_root_with_env_and_fallback`.
- `ensure_tenant_application_from_app_root_with_env` without a repository-root fallback `MUST NOT` be used in application adapters; it silently skips provisioning when `SDKWORK_*_APP_ROOT` env vars are unset.
- `sdkwork-iam-database-host` `MUST` invoke `ensure_tenant_application_from_app_root_if_configured` after IAM migrations when `SDKWORK_APP_ROOT` (or an approved app-root env alias) points at a manifest-bearing application root.
- Embedded bootstrap `MUST` derive `instance_key` through `tenant_application_instance_key(runtime_app_id, environment)` so installations do not collide with platform defaults such as `default`.
- Embedded bootstrap `MUST` upsert installations by stable row id and reconcile the deploy application anchor, runtime app id, and instance-key conflicts before enable.

### 5.2 Bootstrap Operator Auth Profile

Bootstrap operator credentials are operational secrets. They `MUST NOT` live in tracked manifests, `.env.example`, or repository scripts.

| Location | Purpose |
| --- | --- |
| `~/.sdkwork/iam-bootstrap/<lifecycle>.json` | Canonical per-environment operator auth profile (`username`, `email`, `password`, optional `authToken`) |
| `~/.sdkwork/users/<stem>.json` | Legacy fallback only; `super-admin` stem is retired as the primary path |
| `SDKWORK_IAM_BOOTSTRAP_OPERATOR_USERNAME` / `SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD` | Process env override for CI or one-shot commands |
| `SDKWORK_IAM_BOOTSTRAP_OPERATOR_PROFILE` | Selects a profile file stem under `iam-bootstrap/` |

Rules:

- The canonical loader is `@sdkwork/iam-application-bootstrap` `loadBootstrapAuthProfileFromHome(...)`. Application and workspace scripts `MUST NOT` fork profile resolution or hard-code `~/.sdkwork/users/super-admin.json` as the primary source.
- Rust embedded IAM startup `MUST` read the same `iam-bootstrap` directory through `sdkwork-iam-web-adapter` bootstrap auth helpers.
- Development identity defaults: username `admin`, email `admin@sdkwork.com`. Passwords `MUST` stay in the ignored home profile file.
- Batch bootstrap and token ensure `MUST` map workspace profile aliases (`dev`, `test`, `staging`, `prod`) to lifecycle names (`development`, `test`, `staging`, `production`) before selecting profile files.

### 5.3 Lifecycle Access Token Ensure

Start, build, test, check, verify, and clean commands that call protected app-api or backend-api surfaces `MUST` resolve `SDKWORK_ACCESS_TOKEN` before spawning child processes. The public application access token defined by `APP_ACCESS_TOKEN_SPEC.md` is the primary source and is committed in every per-scope env file; a missing or mismatched public token fails the command. Private operator bootstrap credentials are a fallback for CLI/development tooling only.

Resolution order:

1. The selected profile's committed per-scope env file `SDKWORK_ACCESS_TOKEN` (public application access token; primary).
2. Process env when the token is reusable: a signed operator credential, or a local fixture JWT where the selected lifecycle permits one.
3. The user-private credential bundle: `~/.sdkwork/<application-code>/credentials/<profile-id>.json` (§5.4.1). No repository env file carries a private operator token; a composed name such as `.env.<deployment-profile>.<lifecycle>.bootstrap.local` `MUST` be rejected with a diagnostic naming the bundle, never read.
4. Legacy unscoped registration output `.sdkwork.local.env`, only when its token validates for the selected lifecycle and deployment identity.
5. IAM application bootstrap through `@sdkwork/iam-application-bootstrap` `ensureRepoBootstrapAccessToken(...)` when bootstrap operator credentials exist.
6. Credential-entry fixture generation through `@sdkwork/iam-credential-entry/node-bootstrap` for `development`, or an isolated `test` runner with the explicit test-generation opt-in and a loopback gateway.

Remote gateway backends `MUST` reject `alg:none` fixture JWTs in `staging` and `production`. Operators `SHOULD` register a real token through IAM bootstrap or supply a signed JWT from a secret store for any shared or remote gateway; a development fixture is disposable and expires within 24 hours.

### 5.4 Per-Repository Access Token Reuse And Regeneration

Each independent Git repository owns its private operator bootstrap credential (where a lifecycle lane still uses one). A multi-surface repository `MAY` own one private operator credential per manifest-bearing application root when those surfaces declare distinct `backend.appId` values. Private operator credentials `MUST NOT` be shared between repositories, between lifecycle environments, between deployment profiles, or between surfaces with different application identities.

The **public application access token** is a different credential class and is
governed by `APP_ACCESS_TOKEN_SPEC.md`: it is committed in every per-scope env
file, is unique per application root and profile, and is not a private operator
bootstrap credential. This section's private cache, reuse, and regeneration rules
do not apply to it.

#### 5.4.1 Cache Artifact

| Concern | Rule |
| --- | --- |
| Canonical path | The user-private store, never the repository: `~/.sdkwork/<application-code>/credentials/<profile-id>.json`, for example `~/.sdkwork/birdcoder/credentials/standalone.development.json` or `~/.sdkwork/birdcoder/credentials/cloud.test.json` |
| Composed env names | Forbidden. `.env.<deployment-profile>.<lifecycle>.bootstrap.local`, `.env.standalone.<lifecycle>.bootstrap.local`, `.env.<lifecycle>.bootstrap.local`, and every other composed `.env.*` spelling `MUST NOT` be written, and a reader that finds one `MUST` reject it naming the bundle (`ENVIRONMENT_SPEC.md` §5.1.7). |
| Legacy read-only spelling | `.sdkwork.local.env` is an unscoped registration output. It `MUST` be read last and `MUST NOT` be used as the reusable cache when a bundle exists. |
| Content | A JSON object with `accessToken` and the non-secret metadata keys `environment`, `deploymentProfile`, `backend`, `appId`, `issuedAt`, `expiresAt`, `source` |
| Git | Outside every checkout by construction; `MUST NOT` appear in a commit, package, browser bundle, HTML, `/runtime-env.js`, or public runtime config |
| File mode | POSIX writers `MUST` create the file with owner-only permissions (`0600`) |
| Write discipline | Writers `MUST` write a temporary file in the same directory and rename it over the target. Readers `MUST` never observe a partially written bundle. |
| Scope | Exactly one active token per manifest root (repository root or `apps/<surface>` application root), profile id, backend origin, and manifest `backend.appId` |

A private operator bootstrap credential `MUST` live only in the user-private store. The public application access token is separate: it lives in the app root's committed per-scope env file and is resolved by `APP_ACCESS_TOKEN_SPEC.md`; a repository that resolves a private operator token from a workspace-level shared file is non-conforming.

#### 5.4.2 Reuse Contract

Before any IAM provisioning, fixture signing, or artifact write, the resolver `MUST` inspect every candidate token and reuse the first one that satisfies all of these conditions:

- It is non-empty. A token that is not a three-part JWT is treated as an opaque operator-supplied value and is reused without rewriting; the runtime JWT parser still rejects it if the backend requires a JWT.
- `exp` is absent or the current time is earlier than `exp` minus the configured clock skew. Implementations `MUST` use a skew of at least 60 seconds and `SHOULD` use 300 seconds.
- `nbf` is absent or already satisfied.
- The `environment` claim, when present on a JWT, normalizes to the selected lifecycle (`dev`/`local` normalize to `development`, `prod` to `production`) and matches it. A JWT that omits the claim cannot be scope-validated for that dimension and is treated as opaque.
- The `app_id` claim is the installation's deploy application anchor (`APPLICATION_IDENTITY_SPEC.md` §4), not the runtime `backend.appId`. Credentials issued before the deploy-anchor rule carry the legacy runtime application id (`app_<uuid>`) and remain valid only inside the migration window. Reuse currently treats the claim as opaque; a resolver that knows the expected anchor `SHOULD` compare it and regenerate on mismatch, and the strict check becomes mandatory when the window closes. Tenant and organization claims carry the cross-application isolation (next bullet), and a token minted for a different backend fails at request time through the audience binding and is regenerated per section 5.4.3.
- `tenant_id` and `organization_id` match the manifest defaults when both the manifest and the token declare them.
- A fixture JWT (`alg:none` with the literal `signature` segment) is accepted only where fixture generation is allowed: `development`, isolated `test` with the explicit test-generation opt-in or a loopback gateway, and never `staging` or `production`. A public application access token (`token_class:application`, `kid:public-app-token`, signature segment `public`) is not a fixture and is accepted in every environment per `APP_ACCESS_TOKEN_SPEC.md`.
- When the artifact carries `sdkwork-bootstrap-backend`, its normalized origin matches the active backend base URL; when it carries `sdkwork-bootstrap-environment`, it matches the selected lifecycle.

When a token is reusable, the lifecycle resolver `MUST`:

- return it unchanged,
- skip IAM application bootstrap registration, provisioning, enable, and access-credential issuance,
- skip fixture generation,
- leave the artifact byte-identical,
- emit only a non-secret diagnostic such as `configured` or `reused` with the artifact path.

Reuse is the default. A resolver `MUST NOT` re-register, must not re-provision, and `MUST NOT` re-sign a token that already satisfies section 5.4.2. The same resolver MUST NOT re-register a reusable token merely because a launch command ran. Canonical readers and writers are `readRepoBootstrapAccessToken` and `writeRepoBootstrapAccessToken` from `@sdkwork/iam-credential-entry/node-bootstrap`.

Repeated starts, builds, tests, checks, verifies, and cleans against an unchanged manifest and backend `MUST` be idempotent for the token artifact.

#### 5.4.3 Regeneration Contract

Regeneration is an exception, not the per-start default. A resolver `MUST` regenerate or re-provision only when:

- no candidate token exists,
- the token is expired or outside its `nbf` window,
- the token claims contradict the selected lifecycle, manifest application identity, or tenant/organization,
- the artifact metadata records a different backend origin,
- the token is a fixture that the selected environment may not use,
- an operator explicitly passes `--refresh` / `refresh: true`, or
- IAM revokes or rotates the credential and the next authenticated request fails with the declared credential error.

On regeneration the resolver `MUST` use the same repository, deployment profile, and lifecycle scope, replace only that scope's artifact, and `MUST NOT` delete or overwrite another environment's artifact. If operator credentials allow IAM application bootstrap, that path runs before fixture generation. `staging` and `production` `MUST` fail closed instead of generating a fixture.

#### 5.4.4 Concurrency And Diagnostics

- Concurrent starts of the same repository `MUST` converge on one complete artifact. Last-writer-wins is acceptable because every writer renames a complete file.
- A failed artifact write `MUST` not silently discard a token the resolver already holds in memory; the resolver warns and continues with the in-memory value.
- Diagnostics `MUST` name the repository, lifecycle, artifact path, and outcome (`reused`, `generated`, `provisioned`, `unavailable`, `refresh`), and `MUST NOT` include token values.
- The lifecycle checker `check-bootstrap-access-token-lifecycle-standard.mjs` is the machine gate for this section. It `MUST` fail a repository that has credential-entry surfaces but no lifecycle owner, that generates a token on every start without reuse, or that writes a non-conforming artifact path.

#### 5.4.5 Packaging

A packaging command is a `resolve` consumer (`ENVIRONMENT_SPEC.md` §6.1). It reads the public application access token from the selected app root's committed per-scope env file (`APP_ACCESS_TOKEN_SPEC.md`) and bakes that profile's deployment selection and token into the built artifact; it never reads the private bootstrap credential cache and never mints a credential.

Rules:

- Packaging `MUST NOT` register, provision, enable, sign, generate a fixture, refresh, or rewrite a credential, and `MUST NOT` read `~/.sdkwork/<application-code>/credentials/` or `SDKWORK_IAM_BOOTSTRAP_*`. The private cache is a CLI/resolve-phase input only and `MUST` stay out of every packaged artifact.
- The embedded token `MUST` be the committed public application access token, byte-identical to the value in the selected per-scope file. Packaging copies it; it never normalizes, re-signs, or re-encodes it.
- A missing, empty, malformed, or identity-mismatched token `MUST` fail the packaging command before the platform packaging step, with a diagnostic naming the app root, the profile file, the profile id, and the canonical materializer command (`node <sdkwork-specs>/tools/materialize-client-env.mjs --root <repository>`). It `MUST NOT` warn and continue.
- The packaged artifact `MUST NOT` carry a private release environment file, an operator bootstrap credential, a session access token, an auth token, a refresh token, or a provider API key (`ENVIRONMENT_SPEC.md` §6.1.1).
- Diagnostics `MUST` follow the §5.4.4 shape — repository, lifecycle, source file, outcome (`present`, `absent`) — and `MUST NOT` include the token value.
- Verification `MUST` cover the three packaging cases: a complete identity-matched token is embedded unchanged, a missing or mismatched token fails with the materializer hint, and the built artifact carries no private credential of any kind.


Canonical owners:

| Owner | Role |
| --- | --- |
| `@sdkwork/app-topology` `sdkwork-app` | `prepareLifecycleAccessTokenEnv(...)` on `dev`, `build`, `test`, `check`, `verify`, and `clean` |
| `sdkwork-iam/scripts/dev/ensure-repo-bootstrap-access-token.mjs` | CLI ensure for any manifest-bearing repo root |
| `sdkwork-space/bin/with-bootstrap-token.mjs` | Cross-repo wrapper: workspace profile + repo launch env + home auth → ensure → spawn command |
| `@sdkwork/iam-application-bootstrap` | `ensureRepoBootstrapAccessToken`, `writeRegisteredBootstrapEnvFiles`, auth profile loaders |
| `@sdkwork/iam-credential-entry/node-bootstrap` | Token inspection/reuse, environment-scoped artifact read/write, fixture generation, env merge |
| Application-specific packages such as `@sdkwork/sdkwork-env-bootstrap` | `MAY` narrow BirdCoder launch env; `MUST` delegate token ensure to the framework helpers and `MUST NOT` re-provision or sign while a reusable token exists |

Rules:

- Every lifecycle resolver `MUST` implement section 5.4 reuse-first semantics. Re-provisioning a registered token on every start is forbidden.
- Application repositories `SHOULD` expose an `env:token:ensure` script when they do not route lifecycle commands through `sdkwork-app` but still own credential-entry surfaces.
- Workspace batch bootstrap `MUST` load tracked profile values from `configs/bootstrap/profiles/<profile>.env`; ignored overrides use `configs/bootstrap/profiles/<profile>.local.env`.
- Browser/renderer runtimes `MUST NOT` execute bootstrap registration or token ensure directly; Node orchestrators and topology facades own lifecycle resolution.

Forbidden in application-owned lifecycle code:

- copied fixture JWT signing
- primary reads of `~/.sdkwork/users/super-admin.json` outside documented legacy fallback
- sending fixture `alg:none` tokens to `staging` or `production` gateway URLs

Forbidden in application-owned embedded bootstrap code:

- copied manifest-to-command mapping outside the shared crate
- per-app Postgres pool helpers that omit unified schema `search_path`
- blind `INSERT` installation rows without reconcile/upsert

Embedded IAM integration checklist for application repositories that call `build_sdkwork_iam_app_api_router()`:

1. Bootstrap IAM schema with `sdkwork_iam_database_host::bootstrap_iam_database_from_env()` before installation provisioning when the process owns IAM lifecycle.
2. Call `ensure_tenant_application_from_app_root_with_env_and_fallback(...)` (or an approved thin adapter) before building the IAM router on every startup path (standalone gateway, installer, direct API server, or approved cloud gateway startup).
3. Inject `SDKWORK_APP_ROOT` and the approved app-root alias (such as `SDKWORK_DRIVE_APP_ROOT` or `SDKWORK_IM_APP_ROOT`) at the **consumer application manifest root** for installation provisioning. Inject `SDKWORK_IAM_APP_ROOT` at the sibling `sdkwork-iam` repository root so IAM database-host post-bootstrap hooks can materialize IMF catalog and IAM database assets from the canonical IAM ownership boundary.
4. Keep manifest mapping, Postgres `search_path`, reconcile/upsert, and `instance_key` derivation in `sdkwork-iam-embedded-application-bootstrap` / `sdkwork-iam-web-adapter`; application adapters only supply repo-root fallback and optional runtime bindings.
5. Add a repository governance test under `scripts/dev/*-iam-application-bootstrap-standard.test.mjs` that asserts the adapter, startup ordering, dependencies, and dev env injection.

Cloud repositories `MUST` inject `SDKWORK_APP_ROOT` on every dev and gateway startup path (directly or through `@sdkwork/app-topology` `resolveIamDevEnv()`). Repository topology contract tests `SHOULD` assert `IAM_APPLICATION_BOOTSTRAP_ENV`, `resolveIamDevEnv`, and the app-specific `SDKWORK_<APPLICATION_CODE>_APP_ROOT` alias in dev orchestrators.

Rules:

- Browser/renderer runtimes `MUST NOT` execute bootstrap registration directly.
- Bootstrap output env keys `SHOULD` include:
  - `SDKWORK_TENANT_ID`
  - `SDKWORK_ORGANIZATION_ID`
  - `SDKWORK_INSTALLATION_ID`
  - `SDKWORK_APP_ID`
  - `SDKWORK_APP_DOMAIN`
  - `SDKWORK_APP_ACCESS_CREDENTIAL`
  - `SDKWORK_ACCESS_TOKEN`
  - `SDKWORK_AUTH_TOKEN`
- After interactive login, session bootstrap `MUST` replace bootstrap env credentials per `IAM_SPEC.md` section 5.2.1.

## 6. Repository Script Standard

Application repositories that provide IAM bootstrap tooling `SHOULD` expose:

```text
pnpm run admin:bootstrap:app -- --config <app-root>/agent.app.config.json --domain <primary-domain>
```

Workspace-level batch bootstrap lives in `sdkwork-space/bin/`:

| Platform | Command |
| --- | --- |
| Linux / macOS | `./bin/bootstrap-all-apps.sh --profile <dev\|test\|staging\|production>` |
| Windows PowerShell | `.\bin\bootstrap-all-apps.ps1 --profile <dev\|test\|staging\|production>` |
| Windows CMD | `bin\bootstrap-all-apps.cmd --profile <dev\|test\|staging\|production>` |
| Node | `node bin/bootstrap-all-apps.mjs --profile <dev\|test\|staging\|production>` |

Rules:

- Batch bootstrap `MUST` delegate per-app execution to `@sdkwork/iam-application-bootstrap` through `sdkwork-appbase/scripts/bootstrap/bootstrap-app.mjs`.
- Batch bootstrap `MUST` load tracked environment profile values from `configs/bootstrap/profiles/<profile>.env`; ignored developer overrides use `configs/bootstrap/profiles/<profile>.local.env`.
- Batch bootstrap `MUST` resolve per-app domains and API Base URLs from `etc/sdkwork.deployment.config.json` and its referenced typed profiles unless an explicit command-line override is provided. It `MUST NOT` read concrete environment values from `agent.app.config.json`.
- Legacy `schemaVersion: 1` `agent.app.config` and `schemaVersion: 2` backend gateway manifests `MAY` be upgraded in place through `bin/scaffold-app-manifest-bootstrap.mjs` before batch bootstrap.
- Public script first segment `MUST` be `admin` per `PNPM_SCRIPT_SPEC.md` for application repositories; workspace `bin/` utilities `MAY` use neutral names such as `bootstrap-all-apps`.
- Database seed/bootstrap scripts `MUST NOT` be confused with IAM application bootstrap; database lifecycle remains under `db:*`.

### 6.1 Administrator Credential Recovery

An application repository that can only be unlocked with an authenticated console `SHOULD` expose
an offline recovery script for the bootstrap administrator credential, named
`admin:reset:<target>` where `<target>` identifies the environment:

```text
pnpm admin:reset:dev -- --password <new-password>
pnpm admin:reset:release -- --password <new-password>
```

Rules:

- The replacement password `MUST` reach the application process through an environment variable
  (`SDKWORK_<APP>_ADMIN_RESET_PASSWORD`), never through `argv`, so process listings cannot observe
  it.
- The recovery `MUST` target the same canonical tenant and administrator subject that
  `sdkwork-iam-bootstrap` provisions, and `MUST` write the password credential with the same
  Argon2id parameters IAM uses to verify it.
- The recovery `MUST` read the stored credential back and verify it against the requested password
  before reporting success; a reset that reports success `MUST` already prove the credential is
  usable.
- The recovery `MUST` be idempotent and `MUST` clear the failed-attempt and lockout state, so a
  locked-out administrator can be recovered without manual SQL.
- The recovery `MUST NOT` create tenants, users, memberships, or roles. Provisioning stays with
  bootstrap.
- Recovery authorization is deployment access (configuration file plus database reachability); it
  `MUST NOT` invent a second credential store or a backdoor token.

## 7. Verification

Every repository that owns application bootstrap behavior `MUST` run:

```bash
node ../sdkwork-specs/tools/check-iam-application-bootstrap-standard.mjs --root .
```

Application repositories with IAM bootstrap `MUST` also run:

```bash
pnpm --filter @sdkwork/iam-application-bootstrap test
```

Embedded IAM application repositories under `sdkwork-space` `MUST` run the workspace audit before merge:

```bash
node ../sdkwork-specs/tools/audit-iam-embedded-bootstrap-workspace.mjs
```

Repositories with credential-entry surfaces or explicit `env:token:ensure` scripts `MUST` run:

```bash
node ../sdkwork-specs/tools/check-bootstrap-access-token-lifecycle-standard.mjs --root .
```

Workspace-wide regression `MAY` run:

```bash
node sdkwork-specs/tools/check-bootstrap-access-token-lifecycle-standard.mjs --workspace .
```

Each embedded IAM repository `MUST` provide `scripts/dev/*-iam-application-bootstrap-standard.test.mjs` and keep startup ordering aligned with section 5.1. Cloud repositories `MUST` inject `SDKWORK_APP_ROOT` on every dev and gateway startup path (directly or through `@sdkwork/app-topology` `resolveIamDevEnv()`).

## 8. New Application Checklist

- [ ] Declare non-empty `backend.accessTokenPermissionScope` in `agent.app.config.json`.
- [ ] Declare the deploy application anchor in `backend.deployApplicationId` (or `backend.appId`) and a manifest `app.appType`.
- [ ] Use `@sdkwork/iam-application-bootstrap` for bootstrap orchestration.
- [ ] Keep CLI/bootstrap scripts thin; no raw bootstrap HTTP in app code.
- [ ] Wire backend SDK or IAM service adapter for non-CLI environments.
- [ ] For embedded standalone/installer runtimes, delegate to `sdkwork-iam-embedded-application-bootstrap` instead of local SQL/bootstrap copies.
- [ ] Document `admin:bootstrap:app`, `env:token:ensure`, or approved `sdkwork-app` lifecycle wiring in the app runbook.
- [ ] Keep one environment-scoped bootstrap artifact per repository and verify that a second start reuses it without provisioning or regenerating.
- [ ] Store bootstrap operator credentials under `~/.sdkwork/iam-bootstrap/<lifecycle>.json` or approved secret store; do not commit passwords.
- [ ] Run `check-iam-application-bootstrap-standard.mjs` before merge.
- [ ] For embedded IAM runtimes, run `audit-iam-embedded-bootstrap-workspace.mjs` and the repository `*-iam-application-bootstrap-standard.test.mjs` governance test before merge.
- [ ] Run `@sdkwork/iam-application-bootstrap` contract tests when the framework package is present in the workspace.

## 9. Acceptance Checklist

- [ ] Bootstrap flow uses provision → enable → access credential only; it registers no application template.
- [ ] No `plus_*`, legacy `iam_application`, `iam_application_template`, or `studio_*` bootstrap ownership remains in IAM appbase paths.
- [ ] Backend bootstrap paths use `lower_snake_case` static segments.
- [ ] Generated backend SDK and `@sdkwork/iam-service` expose `iam.installations.*` and `iam.accessCredentials.create`, and no retired `iam.applications.register` surface.
- [ ] Provisioning requests carry `applicationType` and `deployApplicationId`, never `templateId` or `appKey`.
- [ ] Provisioning requests carry `ownershipScope` (default `TENANT`) and, for `USER`, `ownerUserId`; the value agrees with `organizationId` and is immutable afterwards (`APPLICATION_IDENTITY_SPEC.md` §4.1).
- [ ] Application-owned scripts import `@sdkwork/iam-application-bootstrap` instead of raw bootstrap HTTP.
- [ ] Embedded Rust runtimes import `sdkwork-iam-embedded-application-bootstrap` instead of local tenant-application SQL.
- [ ] Manifest mapping and auth merge live in the framework package.
- [ ] Governance checker passes for the application root.
