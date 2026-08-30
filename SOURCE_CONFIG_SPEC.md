# SDKWork Source Configuration Standard

- Version: 1.0
- Scope: source-controlled `etc/`, deployable-root configuration ownership, application declarations, runtime materialization, and config migration
- Related: `CONFIG_SPEC.md`, `APP_MANIFEST_SPEC.md`, `ENVIRONMENT_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `APPLICATION_DEPLOY_LAYOUT_SPEC.md`, `DEPLOYMENT_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `COMPONENT_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

## 1. Purpose

SDKWork separates application declaration, configuration contracts, source-controlled deployment
instances, infrastructure descriptors, installed runtime configuration, and secrets.

The canonical ownership sentence is:

> `sdkwork.app.config.json` declares what an application is; `specs/` declares what configuration
> is valid; source `etc/` declares how a deployable root is configured; `deployments/` declares how
> artifacts are installed or orchestrated.

## 2. Deployable Root

A deployable root is a repository, application, or process-host module that can be independently
built and launched, packaged, installed, published as a static application, containerized, or
operated as a service.

Rules:

- Every deployable root `MUST` own `<deployable-root>/etc/`.
- An independently released browser, PC, H5, Flutter, native, desktop, server, worker, gateway, or
  `*-bin` host is a deployable root.
- A reusable package, library crate, generated SDK, composed SDK facade, DTO package, route fragment,
  or embedded-only domain module `MUST NOT` add `etc/` merely to mirror parent configuration.
- A module that supports an independent deployment profile and an embedded profile owns `etc/`
  because at least one supported profile makes it deployable.
- `specs/component.spec.json` `SHOULD` declare `deployment.deployable` explicitly when directory
  shape alone does not establish whether the module is a process host.

## 3. Source Directory Responsibilities

| Source | Authority |
| --- | --- |
| `sdkwork.app.config.json` | Application identity, registration, supported runtime families, owned capabilities, API/SDK inventory, release and distribution metadata |
| `specs/` | Schemas, invariants, allowed vocabulary, ownership rules, references, and verification commands |
| `etc/` | Safe source-controlled environment/profile instances, browser bootstrap inputs, service config templates, gateway config, local DNS examples, and secret-file references |
| `deployments/` | Docker, Kubernetes, system service, reverse proxy, installer, packaging handoff, rollout, rollback, and infrastructure descriptors |
| installed OS config | Operator-selected materialized runtime configuration |
| secret manager / secret files | Passwords, private keys, signing keys, API keys, tokens, and other secret values |

Rules:

- Concrete environment URLs, bind addresses, ports, SDK Base URLs, CORS origins, database targets,
  Redis targets, feature-flag values, and topology profile selections `MUST` live in `etc/`, not in
  `sdkwork.app.config.json` or `specs/`.
- The deployment profile that owns a public API ingress `MUST` own the complete CORS origin set for
  that ingress. Every browser, desktop WebView, H5, or other web-runtime origin that calls the
  ingress directly `MUST` appear as an exact origin in the same production or production-like
  profile. OAuth callback URLs do not create a separate CORS authority: their origin is covered by
  the same ingress allowlist as login, registration, refresh, and other app-api calls.
- Production and production-like profiles that expose an `app` API surface `MUST` set
  `cors.allowAnyOrigin = false` and `MUST` declare at least one exact HTTP(S) origin in
  `cors.allowedOrigins`. An empty list means no browser origin is allowed; it is not a same-origin
  fallback. Wildcard origins, URL paths, query strings, and fragments are forbidden. Desktop
  WebView callers that send a custom-scheme `Origin` (for example `app://dsh`) `MUST` appear as
  additional exact entries on the same ingress allowlist; they do not replace the required HTTP(S)
  origin.
- Development profiles `MAY` use the shared Web Framework loopback/private-network development
  policy. They `MUST NOT` copy development wildcard or private-network directives into production
  source config.
- A process host that embeds dependency routers `MUST` project the selected lifecycle environment
  to the shared `SDKWORK_ENVIRONMENT` key in addition to any application-scoped environment key.
  Production exact origins `MUST` likewise be projected to `SDKWORK_CORS_ALLOWED_ORIGINS` when an
  embedded dependency Web Framework layer consumes the shared policy. Dependency routers `MUST NOT`
  guess the host application's prefixed environment key. If the projection is missing, an inner
  router can resolve `prod` while the outer host resolves `development`, producing a second-layer
  CORS 403 even when the outer gateway accepted the Origin.
- `specs/` may provide illustrative placeholder examples but `MUST NOT` become the active environment
  value store.
- `deployments/` may reference `etc/` inputs but `MUST NOT` become a second runtime configuration
  authority.
- Source-controlled `etc/` contains no live secret values or developer-private overrides.

## 4. Canonical Layout

Every deployable root uses this minimum layout:

```text
<deployable-root>/
  sdkwork.app.config.json          # when the root is an application
  specs/
    component.spec.json            # module root, when applicable
  etc/
    README.md
    sdkwork.deployment.config.json # profile index when the root supports deployment profiles
    topology/
      standalone.development.env
      standalone.test.env
      standalone.staging.env
      standalone.production.env
      cloud.development.env
      cloud.test.env
      cloud.staging.env
      cloud.production.env
```

Process hosts may additionally use typed runtime files:

```text
<process-host>/etc/
  README.md
  gateway.standalone.development.toml
  gateway.standalone.production.toml
  gateway.cloud.development.toml
  gateway.cloud.production.toml
```

Rules:

- `etc/README.md` `MUST` identify the config entrypoint, supported environment/profile combinations,
  schema authority, local override policy, secret sources, materialization target, and validation command.
- Profile ids use `<deployment-profile>.<environment>` where deployment profile is `standalone` or
  `cloud` and environment is `development`, `test`, `staging`, `demo`, or `production`.
- `etc/sdkwork.deployment.config.json` `MUST` be a profile index, not a second
  environment-value store. Each owned profile entry points to one source file
  under `etc/`; the referenced file path stays relative to `etc/` and cannot
  escape the deployable root.
- The canonical full matrix contains ten profile ids. A root may declare a
  smaller supported matrix only when its application/release contracts exclude
  the missing combinations. Selection of an undeclared profile fails closed.
- A pnpm-managed application root `MUST` provide both
  `standalone.development` and `cloud.development` source profiles.
  `standalone.development` owns local application surface values;
  `cloud.development` owns explicit deployed cloud application/platform URLs
  for `pnpm dev:cloud`.
- `cloud.development` `MUST NOT` copy standalone loopback API defaults or
  production endpoints as fallback values. Missing required cloud URLs fail
  materialization. An approved local tunnel must be explicit and documented in
  `etc/README.md`.
- Autostart values in `cloud.development` `MUST` be false for remote API,
  gateway, database, and cache processes. Source config may declare bounded
  remote health checks without declaring those services as local processes.
- Client source config may describe both supported deployment profiles, but
  materialized runtime config contains exactly one active profile. Cloud
  source config uses explicit surface-oriented deployed URLs without naming
  the remote gateway implementation; standalone source config identifies the
  application-owned standalone gateway placement and URL.
- Profile/environment/endpoint switches `MUST` use distinct credential,
  cache, offline-state, and user-data namespaces. Source config never copies
  tokens or mutable runtime state between those namespaces.
- Browser renderer config owns renderer ports and binding names; cross-renderer public domains belong
  to the enclosing application deployment config and are injected into renderer bootstrap.
- A shared adaptive ingress owns the public application origin. PC and H5 renderer configs `MUST NOT`
  duplicate that origin as independent authorities.
- A client app surface that is independently built or published but shares the enclosing application's
  runtime deployment unit `MAY` use `kind = sdkwork.component-deployment`. It `MUST` declare both
  `parentDeploymentConfig` and `parentTopologySpec` as relative paths from
  `etc/sdkwork.deployment.config.json`. Both targets `MUST` exist in the same repository, and the
  topology target `MUST` be a topology v5 contract. The child `MUST NOT` copy parent profile env files
  or own a competing `specs/topology.spec.json`.

Canonical deployment index example:

```json
{
  "schemaVersion": 1,
  "kind": "sdkwork.deployment-index",
  "application": "sdkwork-<application-code>",
  "defaultProfile": "standalone.development",
  "profiles": {
    "standalone.development": { "config": "topology/standalone.development.env" },
    "standalone.test": { "config": "topology/standalone.test.env" },
    "standalone.staging": { "config": "topology/standalone.staging.env" },
    "standalone.production": { "config": "topology/standalone.production.env" },
    "cloud.development": { "config": "topology/cloud.development.env" },
    "cloud.test": { "config": "topology/cloud.test.env" },
    "cloud.staging": { "config": "topology/cloud.staging.env" },
    "cloud.production": { "config": "topology/cloud.production.env" }
  }
}
```

Each source profile declares matching identity values:

```dotenv
# etc/topology/cloud.production.env
SDKWORK_ENVIRONMENT=production
SDKWORK_DEPLOYMENT_PROFILE=cloud
SDKWORK_PROFILE_ID=cloud.production
SDKWORK_<APPLICATION_CODE>_ENVIRONMENT=production
SDKWORK_<APPLICATION_CODE>_DEPLOYMENT_PROFILE=cloud
SDKWORK_<APPLICATION_CODE>_PROFILE_ID=cloud.production
SDKWORK_<APPLICATION_CODE>_APPLICATION_PUBLIC_HTTP_URL=https://app.example.com
SDKWORK_<APPLICATION_CODE>_PLATFORM_API_GATEWAY_HTTP_URL=https://api.example.com
```

Surface materializers transform this authority into the exact architecture
format defined by `ENVIRONMENT_SPEC.md` section 5.1. They `MUST` be
deterministic, preserve the selected profile id and source-path provenance,
write no secrets, and support a check mode that fails when tracked output is
missing or stale.

## 5. Application Manifest Boundary

`sdkwork.app.config.json` `MUST NOT` own concrete environment deployment values.

Forbidden manifest fields for new manifests include concrete environment maps such as:

```text
environments.*.accessUrl
environments.*.deployUrl
envBindings.*.apiBaseUrlByEnv
envBindings.*.sdkBaseUrlByEnv
```

The manifest may declare supported deployment profiles, runtime targets, package targets, and a
relative pointer to `etc/sdkwork.deployment.config.json`. The pointer identifies configuration; it
does not copy configuration values into the manifest.

## 6. Runtime Materialization And Precedence

Bootstrap resolves configuration in this order, with later explicit sources overriding earlier ones:

1. Source `etc/` profile selected by typed `environment`, `deploymentProfile`, and `runtimeTarget`.
2. Installed/operator config at the canonical `RUNTIME_DIRECTORY_SPEC.md` path.
3. Secret manager or referenced secret files.
4. Process environment overrides.
5. CLI overrides for local development, diagnostics, or one-shot operator commands.

Rules:

- Environment variables are override and container-injection surfaces, not the primary source of
  checked-in environment topology.
- Browser-visible runtime config is materialized from safe `etc/` values and contains no secrets.
- Materialized output `MUST` declare matching `environment`,
  `deploymentProfile`, `profileId`, and `runtimeTarget` fields using the target
  framework's canonical names. Build/release evidence records the same selected
  profile id.
- Vite mode, Flutter flavor, Spring profile, native build variant, mini program
  platform, or package target is an adapter/orthogonal axis. None replaces the
  canonical profile id.
- Shared libraries and SDK packages receive typed configuration from bootstrap and do not discover
  `etc/`, environment variables, or OS paths themselves.
- Linux installed config uses `/etc/sdkwork/<application-code>/`; source `<deployable-root>/etc/` is
  its reviewed template/configuration input, not the installed directory itself.

## 7. Secrets And Local Overrides

Committed `etc/` may contain secret-file paths and placeholders only.

The following are forbidden in committed `etc/`: passwords, tokens, refresh tokens, session state,
private TLS keys, signing secrets, API keys, developer machine absolute paths, runtime databases,
logs, caches, and generated local certificates.

Local files matching `etc/**/*.local.*`, `etc/secrets/`, and materialized private overlays `MUST` be
ignored. Production secrets use the platform secret manager, mounted secret files, or protected OS
configuration paths.

## 8. Retired Layout And Migration

Repository-root `configs/` is retired as a runtime/deployment configuration authority.

Rules:

- New repositories and deployable roots `MUST NOT` create `configs/`.
- A multi-repository checkout root may retain governance-only paths such as
  `configs/dependency-catalog.yaml` under `DEPENDENCY_MANAGEMENT_SPEC.md`; that checkout root is not
  an application/deployable root, and the governance catalog `MUST NOT` contain runtime values.
- Existing `configs/` content must be classified and moved: runtime/profile config to `etc/`,
  infrastructure descriptors to `deployments/`, schemas/contracts to `specs/`, and reusable tooling
  data to the owning `tools/` module.
- A migration may read legacy `configs/` only as a compatibility fallback and must emit a warning
  naming the canonical `etc/` target.
- New code `MUST NOT` dual-write `configs/` and `etc/`.
- Compatibility fallback ends after the owning repository migrates and passes the source config
  validator in enforce mode.

## 9. Verification

Required checks for configuration ownership changes:

```bash
node <sdkwork-specs>/tools/check-source-config-standard.mjs --root <deployable-root>
node <sdkwork-specs>/tools/check-source-config-standard.mjs --root <deployable-root> --enforce-profile-identity
node <sdkwork-specs>/tools/check-agent-workflow-standard.mjs --root <repository-root>
```

The strict profile-identity form is required when creating or modifying env
profiles or their materializer. The default form temporarily reads a legacy
profile that declares none of `environment`, `deploymentProfile`, or
`profileId`; once any identity field exists, all fields must be complete and
consistent. Migration tooling must not create new identity-free profiles.

The source-config validator must verify deployable-root `etc/` presence, README/index discovery,
canonical profile ids, in-`etc/` profile references, referenced-file existence,
default-profile membership, profile identity consistency in strict mode,
forbidden committed secret patterns, retired `configs/` usage, manifest environment-value debt, and
production gateway CORS invariants. For component deployment roots it must also verify parent
deployment/topology delegation, topology v5, repository containment, and single topology authority.
During migration it must inspect gateway TOML under both `etc/`
and legacy `configs/`, so moving files cannot temporarily bypass the CORS gate.

## 10. Acceptance Checklist

- [ ] Every independently deployable root owns `etc/`.
- [ ] Non-deployable libraries and SDKs do not duplicate parent configuration.
- [ ] Concrete environment values live in `etc/`, not app manifests or specs.
- [ ] `deployments/` contains infrastructure descriptors only.
- [ ] Browser SDK Base URLs are injected by bootstrap.
- [ ] Standalone profiles collapse public SDK roots only to a canonical API edge origin when one ingress serves every required surface; they do not expose proxy selector path prefixes.
- [ ] Cloud profiles keep application and API origins explicit.
- [ ] Every production-like ingress serving app-api has a non-empty exact CORS allowlist covering
      every declared browser and desktop WebView origin.
- [ ] Embedded dependency routers receive the same selected environment and origin set through the
      shared `SDKWORK_ENVIRONMENT` and `SDKWORK_CORS_ALLOWED_ORIGINS` projections.
- [ ] Committed config contains no secrets or local overrides.
- [ ] Legacy `configs/` has no active runtime authority after migration.
