# SDKWork Application Factory Deployment And Release Standard

- Version: 1.0
- Scope: the five application-factory concepts and their unique authorities, the publish → provision → issue → run → upgrade → uninstall lifecycle, release scope and data isolation, endpoint surfaces and independent deploy applications, source/remix readiness, the five-environment domain and hosting plan, deployment-injected token materialization, failure/compensation semantics, and the new-application factory runbook
- Related: `APPLICATION_IDENTITY_SPEC.md`, `IAM_APPLICATION_BOOTSTRAP_SPEC.md`, `APP_ACCESS_TOKEN_SPEC.md`, `IAM_SPEC.md`, `DEPLOYMENT_SPEC.md`, `RELEASE_SPEC.md`, `DATABASE_SPEC.md`, `DATABASE_FRAMEWORK_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_NAMING.md`, `ENVIRONMENT_SPEC.md`, `DOCKER_SPEC.md`, `SDKWORK_WEBSERVER_SPEC.md`, `DRIVE_SPEC.md`, `APP_MANIFEST_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `MIGRATION_SPEC.md`, `TEST_SPEC.md`
- Canonical location: `APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` in the `sdkwork-specs` standards root

This standard is the umbrella contract for the SDKWork application factory: the path that turns a product definition into a published **deploy application**, gives that deployment exactly one **installation** and at most one **hosting carrier**, binds its credentials to the deployment anchor, and carries it through the five lifecycle environments until it is retired.

It is deliberately a **cross-module sequence standard**, not a second definition of identity, token, database, bootstrap, or release semantics. Those subjects keep exactly one owner, listed in section 10. This standard owns the order in which the owners are invoked, the invariants that must hold between their rows, and the decisions that no single module may take alone.

## 1. Normative Language And Authority

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are normative. Every rule in this standard carries a **violation example** or a **check method**; a rule with neither is documentation, not a rule.

Authority order:

1. A cited standard wins on its own subject: `APPLICATION_IDENTITY_SPEC.md` for application vocabulary and one-to-one relations, `APP_ACCESS_TOKEN_SPEC.md` and `IAM_SPEC.md` §5.2 for token format and claims, `DATABASE_SPEC.md` §6.7/§6.10/§7 for column shape and naming, `IAM_APPLICATION_BOOTSTRAP_SPEC.md` for bootstrap commands and APIs, `DEPLOYMENT_SPEC.md` for deployment profiles and runtime topology, `RELEASE_SPEC.md` for release evidence and rollout, `SDKWORK_WEBSERVER_SPEC.md` for the public edge, and `DRIVE_SPEC.md` for bytes.
2. This standard wins on the factory sequence, the concept-authority matrix, the release-scope decision, the endpoint-surface matrix, the source/remix gate, the environment/domain plan, token-anchor materialization, and compensation between modules.
3. When this standard and an owner standard appear to disagree, the owner standard wins and this standard is corrected. A factory change that requires new identity vocabulary, a new token claim, a new table name, or a new bootstrap API `MUST` land in the owner standard first. — *Check:* the owner section is cited in the same change; a factory-only edit that needs new vocabulary is rejected.
4. A rule that cites an endpoint MUST be read together with that endpoint's published contract; the endpoint name is evidence of the current shape, not a second contract. — *Check:* the endpoint exists in the owner OpenAPI and the factory text does not contradict its declared request or response.

Rules:

- **MUST** keep this standard deduplicated: it `MUST NOT` copy claim tables, naming tables, bootstrap request schemas, or release-evidence lists that an owner standard already defines. — *Violation:* restating the full `APP_ACCESS_TOKEN_SPEC.md` claim matrix here would create two claim authorities.
- **MUST** treat a module that writes another module's concept as a defect, even when the write currently succeeds. — *Violation:* IAM provisioning writing `deploy_app.metadata.integrations` to record the installation link; the link is `deploy_app.id` in `iam_application_installation.deploy_application_id`.
- **SHOULD** cite the owner section instead of paraphrasing it; a citation that names only the file and not the section is incomplete for a normative rule. — *Check:* review every "follows `<owner standard>`" sentence and confirm it names a section when the rule depends on a specific part.

## 2. Concept And Unique Authority Matrix

The application factory has exactly five concepts. Adding a sixth concept, or a second table family for one of these concepts, is a de-duplication defect even when the new table is convenient.

| Concept | System of record | Physical authority | Stable identity | Write authority | `MUST NOT` be read as |
| --- | --- | --- | --- | --- | --- |
| Product (商品) | `sdkwork-appstore` | `appstore_application` + `appstore_application_version` + `appstore_application_listing` + `appstore_application_listing_price` | `appstore_application.id` (TEXT) and `uuid` | appstore only | runtime identity, installation, OAuth client, deployment unit |
| Deploy application (部署应用) | `sdkwork-deployments` | `deploy_app` (+ `deploy_app_platform_target`, `deploy_app_source`, builds, packages, releases, environments) | `deploy_app.id` (BIGINT) and `uuid` | deploy only | product identity, commerce listing, installation, OAuth client |
| Installation (安装) | `sdkwork-iam` | `iam_application_installation` (+ `iam_application_installation_environment`, `iam_application_installation_credential`) | `iam_application_installation.id`, anchored by `deploy_application_id` | IAM only | the deployed runtime, the product, a second deployment record |
| Hosting carrier (承载) | `sdkwork-webserver` | `webserver_application` (+ `webserver_application_host`, site and certificate records) | `webserver_application.id`, anchored by `deploy_application_id` | webserver only | application identity, publishing authority, installation |
| Scaffold (脚手架) | `sdkwork-deployments` | `deploy_application_scaffold` (+ `deploy_application_scaffold_category`, `deploy_application_scaffold_version`) | `deploy_application_scaffold.uuid` and `template_key` | deploy only | a runtime application, a product, a second scaffold family |

Relations:

| Relation | Cardinality | Enforcement |
| --- | --- | --- |
| Deploy application ↔ installation | exactly 1:1 | partial unique index on `iam_application_installation.deploy_application_id` (`uk_iam_application_installation_deploy`) |
| Deploy application ↔ hosting carrier | exactly 1:1 for every new row | partial unique index on `webserver_application.deploy_application_id` (`uk_webserver_application_deploy_application_id`); legacy rows `NULL` only until backfill |
| Product version → deployed copies (deploy applications) | 1:N when distributed as a product | the product version is the creation input; each deployed copy gets its own deploy application and installation |
| Scaffold version → product SKU/version | 1:N | creation provenance (`appstore_application_sku.source_scaffold_version_id`); no runtime relation |
| Product listing/price → price authority | one authority per listing and region | appstore ownership; no other module writes price |

Rules:

- **MUST** keep exactly these five write authorities. A module that needs a fact owned by another module `MUST` reference its identifier and `MUST NOT` persist a copy of the fact. — *Violation:* `webserver_application` accepting a create without `deploy_application_id` and then claiming to be the published application.
- **MUST** enforce both 1:1 relations in the database, not only in a console form or a service check. — *Check:* the two unique indexes above exist in the baseline/contract and a duplicate link returns a conflict instead of creating a second row.
- **MUST** use the deploy application as the only runtime anchor (`app_id`), never the product id, installation id, hosting carrier id, or OAuth client id. — *Violation:* signing `app_id = iam_application_installation.app_id` (the IAM runtime id); the token names an identity no deployment owns.
- **MUST NOT** create a sixth "application link" authority (for example `deploy_application_link`) or use a free-form `metadata.integrations` document as the authority for any relation above. — *Violation:* a `linkedApplications` JSON array that the console treats as the one-to-one relation; it cannot be constrained and drifts.
- **MUST NOT** resolve one module's concept by display name, slug, or package key across modules. — *Check:* every cross-module lookup is by the owning numeric id or stable uuid; a name scan in a repository is a defect.
- **MUST** keep the installation's environment and credential rows subordinate to the installation, never as a second installation. — *Violation:* creating one installation per environment; the next token names an environment instead of the deployment anchor.
- **MUST** keep the scaffold design-time only: a scaffold is generator input, and creating an application from it produces a product version and a deploy application, not a running identity. — *Violation:* an installation pointing at a scaffold id instead of the deploy application.
- **MUST** keep one price authority: billing, entitlement, and order settlement resolve from appstore listing/price, never from a scaffold column or a deploy application field. — *Violation:* charging `deploy_application_scaffold.price_minor`; it is a marketplace presentation value, not a settlement authority.

## 3. Lifecycle: Publish To Uninstall

The factory lifecycle has six stages. They are sequential in the sense that a later stage `MUST NOT` report success before its preconditions hold; they are retryable in the sense that a failed cross-module step is replayed idempotently, never repaired by deleting rows. Stages may overlap in execution — creating the deploy application triggers provisioning before the source or platform targets are configured — so the table's exit criteria say when a stage is complete, not when the next one may start.

| Stage | Trigger | Write owner | Durable state | Exit criterion |
| --- | --- | --- | --- | --- |
| 1. Register and publish | operator creates/updates the product version, listing, price when the application is sold; operator registers the deploy application, source when remix is offered, platform targets, build recipe | appstore then deploy | `appstore_*` rows when sold; `deploy_app` (`DRAFT`), `deploy_app_source` when configured, `deploy_app_platform_target` | the deploy application has at least one platform target; a remixable application also has a `READY` source (section 6); a sold application has a published listing and price |
| 2. Provision and enable | `deploy_app` create automatically calls identity provisioning; operator retries with `apps.identityProvision`; operator provisions/enables the installation through the IAM bootstrap command surface | deploy calls IAM; IAM owns the installation row | `deploy_app.identity_status` (`pending_identity` / `active` / `failed`); installation `provisioning_status` and `status` | installation is `enabled`, the deploy application reports `identity_status = active` |
| 3. Issue | first runtime bootstrap, login, or delegated credential request | IAM | `iam_session`, token hashes, environment/credential status | a token whose `app_id` is the deployment anchor is issued and validated |
| 4. Run | release promotion and hosting binding | deploy for release/deployment; webserver for the carrier | channel `current_release_id`, `deploy_deployment`, carrier and host rows, certificate rows | traffic reaches the promoted release through the carrier's host; the token validates |
| 5. Upgrade | a new immutable package/release is promoted | deploy; webserver only when hosts/certificates change | new package/release/rollout rows; installation unchanged | the new release is live with evidence; the deployment anchor and scope did not change |
| 6. Uninstall / retire | operator disables and retires the deployment | IAM first, then deploy, then webserver | installation `disabled`; credentials `retired`; environments `disabled`; deploy application `ARCHIVED`; hosts removed | issuance and traffic stop; retained data follows the declared retention policy; history remains readable |

Rules:

- **MUST** register the endpoint before provisioning its identity: the deploy application `MUST` exist before an installation can reference it, and the installation `MUST` be `enabled` before any credential is issued. — *Violation:* issuing a token for a `pending_config` installation by skipping `enable`; the token resolves to no operable runtime.
- **MUST** treat `READY` as a derived readiness verdict (source, platform target, release), not as a persisted application status that a client may set. `deploy_app.app_status` transitions `DRAFT` → `ACTIVE` → `PAUSED` → `ARCHIVED` through the deploy commands; `FAILED` on a deployment is reported through `identity_status = failed` or a release/deployment status, not by inventing a new `app_status`. — *Violation:* writing `READY` into `deploy_app.app_status`; `chk_deploy_app_status` rejects it and the console shows a state no query understands.
- **MUST** make each stage's outcome durable before the next stage is attempted. An in-memory success, a log line, or a console toast is not evidence. — *Check:* kill the process between two stages; the retry reads the stored status and does not create a second installation, credential, or carrier.
- **MUST** keep stage 2's cross-module call after every deploy-owned side effect, because a failure must not roll back the deploy application and its domains/source/audit. — *Violation:* wrapping `deploy_app` insert and IAM provisioning in one transaction that rolls the app back; domains, source, and audit are destroyed by a transient IAM outage.
- **MUST NOT** skip a stage on a retry: a provisioning retry `MUST` replay the same installation key, not create a new installation; an upgrade `MUST` add a release, not edit the installation's identity. — *Check:* provisioning retry count is 1 installation row; upgrade count is 1 installation row and N releases.
- **MUST** make uninstall forward-only: disable, retire, archive, release hosts, and retain or purge data under `PRIVACY_SPEC.md`; deleting the installation, deploy application, carrier, or history `MUST NOT` be the uninstall mechanism. — *Violation:* `DELETE FROM iam_application_installation`; the install count, token subject, and audit trail disappear while sessions and domains still exist.
- **MUST** stop issuance before stopping traffic during uninstall, so no credential outlives the deployment's operability. — *Check:* after disabling the installation, a new credential request fails; existing sessions are rejected on the next validation.

## 4. Release Scope And Data Isolation

Every installation carries exactly one release scope (`ownership_scope`). The installation is the authority; the request is only allowed to declare a value that is checked against it. The vocabulary, the default, and the immutability rules are owned by `APPLICATION_IDENTITY_SPEC.md` §4.1; this section fixes the factory-facing matrix and the cross-module consequences.

| `ownership_scope` | Meaning | `iam_application_installation.organization_id` | `owner_user_id` | Isolation key | Wire `organization_id` claim |
| --- | --- | --- | --- | --- | --- |
| `TENANT` (default) | released to the whole tenant | `0` | absent | `(tenant_id, app_id)` | `0` |
| `ORGANIZATION` | released to one organization | non-zero organization id | absent | `(tenant_id, organization_id, app_id)` | the organization id |
| `USER` | released to one person | `0` | required, the owning user | `(tenant_id, app_id, user_id)` | `0` |

`deploy_app.owner_type` uses the same vocabulary plus the platform-internal `PLATFORM` level. `PLATFORM` maps to installation scope `TENANT`; the other three map one-to-one. Both tables enforce the level/pointer agreement with a database `CHECK`.

Rules:

- **MUST** default to `TENANT` only when the application's owner level is `TENANT` or `PLATFORM`. An application whose owner level is `USER` or `ORGANIZATION` produces an installation of that level; the request body `MUST NOT` be able to pick a different one. — *Violation:* a console create sending `ownershipScope: "TENANT"` for a user-owned application; the installation and the application then disagree, and data isolation keys diverge.
- **MUST** treat a declared `ownershipScope` as a declaration to verify, never as a selector. Issuance `MUST` read the scope from `iam_application_installation` and fail closed on a mismatch (`IAM_APPLICATION_BOOTSTRAP_SPEC.md` §2.1, `APPLICATION_IDENTITY_SPEC.md` §4.1 rule 3). — *Check:* `accessCredentials.create` with a mismatched `ownershipScope` returns an error and writes no session.
- **MUST** make the scope immutable for the installation's lifetime. Changing the level is a new deploy application and a new installation, never an update. — *Violation:* `UPDATE iam_application_installation SET ownership_scope = 'USER'`; existing rows are silently re-interpreted under a different isolation key.
- **MUST** filter every application-scoped data plane by the isolation key of the installation's scope, not by the session's `login_scope` alone. — *Violation:* a `USER`-scoped deployment filtering `WHERE tenant_id = $1 AND app_id = $2`; every user of the tenant reads the owner's rows.
- **MUST** carry the columns each scope needs: `app_id` plus `organization_id` for `ORGANIZATION`, and `app_id` plus `user_id` for `USER`. A table that stores rows for a personal deployment `MUST NOT` be tenant-only. — *Check:* schema review plus a two-user isolation test that fails when the `user_id` predicate is removed.
- **MUST** make uniqueness scope-aware: `(tenant_id, app_id)`, `(tenant_id, organization_id, app_id)`, or `(tenant_id, app_id, user_id)` as the scope requires, so two organizations or two users cannot collide on one deployment. — *Violation:* a unique key on `(tenant_id, app_id, name)` only; the second organization's row is rejected or overwrites the first.
- **MUST** keep authorization unchanged by scope: scope selects data, never permission. A `USER`-scoped deployment grants no more than the same permission scope at tenant level. — *Violation:* treating `USER` as an admin/owner role and bypassing RBAC.
- **MUST** bind a `USER`-scoped credential to the owner as subject; issuance for any other subject fails closed, and the bootstrap credential of a personal installation is issued for the owner, not for a synthetic system user. — *Check:* a delegated credential for a different user returns an error naming the installation and owner.
- **MUST** resolve the scope from the installation by the token's `app_id`; it `MUST NOT` be inferred from the public application token's `login_scope`, because a `USER` release keeps `login_scope = TENANT` (personal session, not organization session). — *Violation:* choosing the tenant isolation key because the public token says `login_scope: TENANT`.
- **MUST** keep the owner gate on list/read paths: `PLATFORM` and `TENANT` are reachable across the tenant; `ORGANIZATION` requires the caller's organization; `USER` requires the owning user (platform operators may have an explicit cross-owner admin path). — *Check:* another tenant member cannot list a `USER` application; another organization cannot read an `ORGANIZATION` application.
- **MUST** keep one installation per deployment scope. Re-provisioning an installation with a different scope is a conflict naming the stored scope, not an in-place change. — *Violation:* a retry with `ownershipScope` changed from `TENANT` to `USER` silently succeeding; `IAM_APPLICATION_BOOTSTRAP_SPEC.md` §2.1 requires the conflict.

## 5. Endpoint Surfaces And Independent Applications

One deploy application is one endpoint. Each shipped surface (H5, PC, mini program, Flutter, native iOS, native Android, native HarmonyOS, API service, desktop) `MUST` register as its own deploy application with the correct `app_kind`, because each surface has its own token audience, package formats, store identity, and release cadence.

| Surface | `deploy_app.app_kind` | Allowed platform target(s) | Typical package formats |
| --- | --- | --- | --- |
| H5 web | `H5_WEB` | `WEB` | `DIST_DIR`, `TAR_GZ`, `ZIP` |
| PC web | `PC_WEB` | `WEB` | `DIST_DIR`, `TAR_GZ`, `ZIP` |
| Mini program (WeChat) | `WECHAT_MINIPROGRAM` | `WECHAT` | `ZIP`, `TAR_GZ` |
| Mini program (Douyin) | `DOUYIN_MINIPROGRAM` | `DOUYIN` | `ZIP`, `TAR_GZ` |
| Flutter app | `FLUTTER_APP` | `IOS`, `ANDROID`, `HARMONYOS`, `WINDOWS`, `MACOS`, `LINUX`, `WEB` | per platform, for example `IPA`/`APK`/`HAP`/`MSI`/`DMG`/`DEB` |
| Native iOS | `IOS_APP` | `IOS` | `IPA`, `XCARCHIVE`, `ZIP` |
| Native Android | `ANDROID_APP` | `ANDROID` | `APK`, `AAB`, `ZIP` |
| Native HarmonyOS | `HARMONYOS_APP` | `HARMONYOS` | `HAP`, `APP`, `ZIP` |
| API service | `API_SERVICE` | `API` | `OCI_IMAGE`, `PROCESS_BUNDLE`, `TAR_GZ`, `JAR`, `WAR` |
| Desktop app | `DESKTOP_APP` | `WINDOWS`, `MACOS`, `LINUX` | `MSI`, `NSIS`, `MSIX`, `EXE`, `DMG`, `PKG`, `DEB`, `RPM`, `APPIMAGE` |

The platform/package matrix is enforced by `sdkwork-deploy-core::validate_app_kind_platform` and `validate_package_format_for_platform`; this table is the factory view, not a second matrix.

Rules:

- **MUST** register every surface as a separate deploy application with its own `app_id`, installation, token audience, and release. — *Violation:* one `PC_WEB` application carrying both `/` and `/mobile` and one token; a mobile-only credential can now call the desktop API.
- **MUST** set `app_kind` to the surface's canonical kind and `MUST NOT` change it in place. A different endpoint kind is a new application, because its token audience, store identity, and package formats differ. — *Violation:* `PATCH`ing `PC_WEB` to `H5_WEB`; the contract does not accept `appKind` on update, and the existing releases belong to the wrong validator.
- **MUST** keep a Flutter codebase as one `FLUTTER_APP` deploy application with multiple platform targets, not as separate `IOS_APP`/`ANDROID_APP` applications. — *Violation:* registering the same Flutter build as an `IOS_APP` to get an iOS token; the store identity and release flow now disagree with the build.
- **MUST** keep WeChat and Douyin mini programs as separate applications, because their platform app ids, review channels, and size ceilings are independent. — *Violation:* one `WECHAT_MINIPROGRAM` application with a `DOUYIN` target; the matrix rejects it.
- **MUST** map a new registration to the endpoint it actually serves: an interactive H5 surface uses `H5_WEB`, an interactive PC surface uses `PC_WEB`, and a content-only static site `MAY` use `STATIC_WEB` under `APP_STATIC_WEB_ARCHITECTURE_SPEC.md`; `SPA_WEB` remains only for pre-existing rows. — *Check:* a new `SPA_WEB` registration is rejected in review and migrated to `PC_WEB` or `H5_WEB`; a static site cites the static-web root standard.
- **MUST** expose the admin filter dimensions from the canonical records: application group, `owner_type`/`ownershipScope`, `app_kind`, `app_status`, and lifecycle environment. The filter `MUST` be a server-side query over the owner's reachable rows, not a client-side narrowing of a tenant-wide list. — *Violation:* the admin ledger shows another user's `USER` applications because the filter runs after the list; the owner gate belongs in the query (section 4).
- **MUST NOT** register an API gateway, a hosting carrier, or a store listing as an application surface. The gateway is infrastructure, the carrier is hosting, and the listing is commerce. — *Violation:* a `deploy_app` row for `sdkwork-api-cloud-gateway`; it receives an installation and a token but serves no tenant endpoint.

## 6. Source, Readiness, And Remix

A deploy application has at most one remix source. The source answers *what a remix downloads*, not *what the application currently runs*; running code is a release. The source row is `deploy_app_source`; the Git repository it may reference is `deploy_source_repository`; the archive it may reference is `deploy_artifact`.

Rules:

- **MUST** keep exactly one source per deploy application, enforced by `uk_deploy_app_source_app`. Replacing a source is a full replacement, not a partial edit, because a Git source and an archive source have disjoint pointers. — *Violation:* a second row for the same application; the remix endpoint would have to choose one silently.
- **MUST** use `kind = GIT` with a referenced repository or `kind = ARCHIVE` with a referenced artifact, and `MUST` keep the kind/pointer agreement a database check. — *Check:* a half-configured source (`GIT` with no repository, or both pointers set) is rejected by `chk_deploy_app_source_kind`/`chk_deploy_app_source_pointer`.
- **MUST** make a Git source ready only by a validation probe: `repo_status = VALIDATED`, written by `POST /app/v3/api/apps/{appId}/source/validate`. Registration alone is `PENDING`, and a failed probe is `INVALID`. — *Violation:* enabling remix on a `PENDING` repository; the download instructions point at an unverified URL.
- **MUST** record a reachable-but-unauthorized repository as `VALIDATED` with the closed code `GIT_VALIDATION_CREDENTIALS_REQUIRED` and `credentialsRequired: true`, and `MUST` return the opaque `credentialSecretRef` (never the secret) so the remix client can clone. — *Check:* the source response carries those fields and no secret material.
- **MUST** make an archive source ready only when its artifact is active and attributed to this application; a retired or foreign artifact is `MISSING` with `ARCHIVE_UNAVAILABLE`. — *Violation:* pointing the source at another application's artifact; a remix would download foreign code.
- **MUST** derive readiness at read time and expose the closed reason code (`SOURCE_NOT_CONFIGURED`, `SOURCE_KIND_MISMATCH`, `GIT_REPOSITORY_UNUSABLE`, `GIT_PROVIDER_UNSUPPORTED`, `GIT_REPOSITORY_URL_INVALID`, `GIT_REPOSITORY_NOT_VALIDATED`, `GIT_REPOSITORY_PENDING`, `GIT_REPOSITORY_INVALID`, `GIT_REFERENCE_INVALID`, `GIT_SUB_PATH_INVALID`, `ARCHIVE_UNAVAILABLE`). A stored readiness flag is prohibited because it goes stale. — *Check:* deleting/retiring the artifact flips the next read to `MISSING` without a new write.
- **MUST** require `readiness = READY` before `remix_enabled = true`; enabling otherwise is a `409` carrying the readiness reason. Disabling is always accepted. — *Violation:* setting `remix_enabled = TRUE` directly in the database; the download endpoint must still refuse, which means two authorities for the same decision.
- **MUST** return download coordinates from the deploy application, not from a product, installation, or scaffold: `mode = GIT` returns repository URL/ref/subPath (and the clone mode); `mode = ARCHIVE` returns the artifact descriptor (`driveNodeId`, `checksumSha256`, size). — *Check:* `GET /app/v3/api/apps/{appId}/remix` returns `download` only when enabled and ready.
- **MUST** move bytes through Drive, never through the deploy API: an archive's bytes are fetched from Drive with the described node and verified against the checksum. Deploy returns coordinates; Drive returns bytes. — *Violation:* a deploy endpoint proxying the archive; it duplicates Drive authorization and retention.
- **MUST** treat a remix as a new application with a new deploy application anchor, installation, and scope; the source application `MUST NOT` be mutated, and the new application inherits no live credential or session. — *Violation:* cloning into the same `deploy_app` row; the source and the remix share an `app_id` and a token audience.
- **MUST NOT** duplicate the source in appstore, IAM, or the scaffold: the scaffold may describe design-time inputs, but the runtime source of a deployed application is `deploy_app_source`. — *Violation:* an installation row carrying `git_url`; the deployment's source would have two owners.

## 7. Environment, Domain, And Hosting Plan

The five lifecycle environments are `development`, `test`, `staging`, `demo`, and `production` (`ENVIRONMENT_SPEC.md` §5, `DOCKER_SPEC.md` §3). The application-level view is:

| Environment | Default app host | Deployment environment row | Installation environment | Token profile ids | `deployments/deploy.yaml` profile key |
| --- | --- | --- | --- | --- | --- |
| `development` | `<label>.app-dev.<suffix>` | `env_key = development`, explicit `env_level` | `env_key = development`, `pending` or `active` | `standalone.development`, `cloud.development` | not a deployable manifest key |
| `test` | `<label>.app-test.<suffix>` | `env_key = test`, explicit `env_level` | `env_key = test` | `standalone.test`, `cloud.test` | `test` |
| `staging` | `<label>.app-staging.<suffix>` | `env_key = staging`, explicit `env_level` | `env_key = staging` | `standalone.staging`, `cloud.staging` | `staging` |
| `demo` | `<label>.app-demo.<suffix>` | `env_key = demo`, explicit `env_level` | `env_key = demo` | `standalone.demo`, `cloud.demo` | not a deployable manifest key |
| `production` | `<label>.app.<suffix>` | `env_key = production`, explicit `env_level` | `env_key = production` | `standalone.production`, `cloud.production` | `production` |

`<label>` is `deploy_app.app_domain_label` when set, otherwise `deploy_app.slug`. `<suffix>` is the per-application override when set, otherwise the platform catalog (`PLATFORM_APP_DOMAIN_SUFFIXES`, 14 suffixes). The host formula is `<label>.app[-<env>].<suffix>`; the DNS/TLS planning form is `*.<app|app-<env>>.<suffix>` (for example `*.app.<suffix>` in production and `*.app-demo.<suffix>` in demo). The platform edge hosts, ports, and per-environment persistence profile are owned by `DOCKER_SPEC.md` §3 and `APP_RUNTIME_TOPOLOGY_NAMING.md` §9; this standard does not restate them.

Rules:

- **MUST** support exactly the five lifecycle environments; a sixth value `MUST NOT` be introduced locally by an application, a console, or a deploy manifest. Adding one is an `ENVIRONMENT_SPEC.md` change that extends the token matrix, host catalog, and certificate plan together. — *Violation:* a `qa` environment in an app hostname catalog; the token matrix and the certificate plan do not know it.
- **MUST** derive the app host from the formula above, never from a hand-written host per application. `app_domain_label` `MUST` be a lowercase DNS label (1–63 bytes, alphanumeric and interior hyphens); an empty suffix override `MUST` be rejected. — *Check:* the DDL check plus `normalize_app_domain_label`/`normalize_app_domain_suffixes`; an uppercase or wildcard label is refused.
- **MUST** give every environment its own host; a non-production environment `MUST NOT` share the production host or a production cookie/redirect URI. — *Violation:* using `myapp.app.<suffix>` for staging; test traffic reaches production data.
- **MUST** keep `demo` an independent demonstration tier (dedicated database/Redis per `DOCKER_SPEC.md` §3.3) and `MUST NOT` treat it as a second development. — *Check:* the demo persistence profile names its own database and prefix.
- **MUST** record the deployment environment row with `env_key` and an explicit `env_level` (`DEVELOPMENT`/`STAGING`/`PRODUCTION`). `env_level` is a coarse promotion/approval class and `MUST NOT` be silently derived from `env_key`; the level vocabulary is coarser than the five lifecycle names. — *Violation:* mapping `test` to `DEVELOPMENT` by guess and skipping an approval; the operator never declared the class.
- **MUST** keep promotion history immutable: a promotion writes a `deploy_environment_promotion` row together with the environment's `current_release_id`; a newer promotion fences an older one. — *Check:* two concurrent promotions leave one current pointer and both history rows.
- **MUST** keep the installation environment row authoritative for that environment's public domain: `(installation_id, env_key)` unique, `(tenant_id, primary_domain)` unique, domain lowercased, no wildcard, no whitespace. — *Violation:* two installations claiming one domain; the token's environment resolves to the wrong carrier.
- **MUST** anchor the hosting carrier to the deploy application: every new `webserver_application` row supplies `deploy_application_id`, and the unique index allows at most one live carrier per deployment. The carrier owns only site/host/vhost/certificate/reverse-proxy configuration; it `MUST NOT` create an application identity or a second release authority. — *Violation:* creating a carrier and using its `slug` as the application; deploy then has no row to publish.
- **MUST** keep the installation environment and the deployment environment aligned by `env_key`; a token for an environment the installation has not registered or activated fails closed (`ensure_installation_environment_active`). — *Check:* issuing for `staging` when only `production` is active returns an error naming the registered environments.
- **MUST** use `https` for public origins, redirect URIs, and cookies; a release artifact `MUST NOT` carry `http://`, `localhost`, a developer origin, or a tunnel URL. — *Violation:* a release public token/environment file with `http://127.0.0.1`; the packaged portal cannot pass the release gate.
- **MUST** route custom domains through the deploy domain/certificate plane and the webserver host registry; a custom domain `MUST NOT` bypass the carrier, the certificate inventory, or the CORS allowlist. — *Check:* `deploy_domain`/`webserver_application_host`/certificate rows exist for the host; an unknown host is not served.

## 8. Token Materialization And Placeholder Rules

Token format and claim semantics are owned by `APP_ACCESS_TOKEN_SPEC.md` §3 and `IAM_SPEC.md` §5.2; this section fixes only what the factory must do so the deployment anchor reaches every credential.

| Claim | Deployment credential (`aud = app_id`) | OAuth authorization-server token |
| --- | --- | --- |
| `app_id` | the deploy application anchor (`deploy_app.id`) | the same deploy application anchor |
| `aud` | equal to `app_id` | the authorized client id |
| `azp` | absent (the dual-token claim list in `IAM_SPEC.md` §5.2 does not admit it) | equal to the client id |
| `tenant_id` (`tid` in shorthand) | the tenant | the tenant |
| `organization_id` (`oid` in shorthand) | `0` for `TENANT`/`USER`, the organization for `ORGANIZATION` | the same rule |
| `ownership_scope` | the installation's scope | resolved from the installation by `app_id`; the current OAuth payload signs `login_scope`/`organization_id` but not `ownership_scope` |
| `environment`, `deployment_mode` | the lifecycle environment and `standalone`/`cloud` mode | the same |

Rules:

- **MUST** source the public application token's `app_id`/`aud` from the deployment-injected variable `SDKWORK_DEPLOY_APPLICATION_ID`, not from a compiled-in literal. A repository that registers every surface separately mirrors the deployment-injected variable per surface as `<SDKWORK_DEPLOY_APPLICATION_ID>_<SURFACE>` (§11 step 11), so each surface's carrier is written from that surface's own anchor. — *Violation:* committing `"appId": "sdkwork-im-pc"` for an application whose real anchor is assigned per installation; the token names a repository identity, not a deployment.
- **MUST** commit the profile placeholder `__SDKWORK_DEPLOY_APPLICATION_ID__` for a surface whose anchor is known only at deployment, and `MUST` re-run materialization with the variable set before building or packaging. — *Check:* `materialize-client-env.mjs --root <repository>` fails naming `SDKWORK_DEPLOY_APPLICATION_ID` when it is unset; the committed file still carries the placeholder, not a fabricated id.
- **MUST** fail closed when the anchor is missing or empty; no fallback to a retired app id, an IAM runtime id, a product id, or a scaffold id. — *Violation:* `resolve_access_token_app_id` falling back to `tenant_application.app_id`; the token names the installation instead of the deployment.
- **MUST** keep the public token a single compact JWT string in every profile file; `MUST NOT` store the generator input object under `SDKWORK_ACCESS_TOKEN` and `MUST NOT` duplicate it under `VITE_*`/`PORTAL_PUBLIC_*`. — *Check:* `check-app-access-token-env.mjs --root <repository>` parses the value as a three-part JWT and rejects a JSON object.
- **MUST** carry the installation's release scope into dual-token session credentials and verify it on the server; a token whose `ownership_scope` contradicts the installation fails closed. — *Violation:* a session claiming `USER` against a `TENANT` installation; the data plane filters by the wrong key.
- **MUST** stamp the same claim on the public application token at materialization time, resolving `SDKWORK_APPLICATION_OWNERSHIP_SCOPE` first, then `accessToken.ownershipScope`, then the `TENANT` default, and **MUST** fail generation when an `ORGANIZATION` surface has no non-zero `organization_id` or a `USER` surface has no owner user id (`SDKWORK_APPLICATION_OWNER_USER_ID` or `accessToken.ownerUserId`). — *Check:* `check-app-access-token-env.mjs --root <repository>` reports `missing claim ownership_scope=<scope>` for a token generated without it, and materialization fails naming the variable or field when the owner is missing (`APP_ACCESS_TOKEN_SPEC.md` §3.2.1).
- **MUST** keep the public application token's `user_id` at `0` for `TENANT`/`ORGANIZATION` and at the installation owner's user id for `USER`; the claim names the isolation key, not authenticated permissions. — *Violation:* a personal release whose token still says `user_id: 0`; IAM has no owner to bind the credential to, and a `USER` surface is rejected or reads the wrong partition.
- **MUST** resolve an absent `ownership_scope` from the installation by `app_id`; a token family that does not sign it (currently the OAuth access token) `MUST NOT` be assumed `TENANT`. — *Check:* the server loads the installation's scope for such a token, and a `USER` deployment does not fall back to a tenant key.
- **MUST** issue a `USER`-scoped credential only for the installation's owner; the bootstrap path uses the owner as subject rather than a synthetic user. — *Check:* a credential request for another tenant member is rejected; issuing for a disabled owner fails closed.
- **MUST** keep the public application token isolation-only: `token_class = application`, `user_id = 0` (`TENANT`/`ORGANIZATION`) or the installation owner's user id (`USER`), no user permissions, and no acceptance on dual-token, backend-admin, open-api, or API-key routes (`APP_ACCESS_TOKEN_SPEC.md` §1/§5). — *Violation:* accepting the public token as a session; every client in the tenant can call protected business operations.
- **MUST** make the server resolve the release scope from the installation by `app_id`; the public token's `login_scope` is not a substitute, because a `USER` release stays `TENANT`-shaped. — *Violation:* a `USER` deployment reading tenant data because the bootstrap token said `TENANT`.
- **MUST** validate all ten profile files (five environments × `standalone`/`cloud`) at `dev`, `start`, `serve`, `build`, `package`, and `dist`, and `MUST` fail before the runtime, compiler, or renderer starts. — *Check:* `check-release-access-token-env.mjs --root <repository>` and the release gate in `APP_ACCESS_TOKEN_SPEC.md` §4.1; a missing release token fails packaging.
- **MUST NOT** provide a bypass flag, a development token in a release artifact, or a token whose `environment`/`deployment_profile`/`app_id` claims disagree with the selected profile. — *Violation:* a release package built with `standalone.development`; the deployment boots with the wrong isolation claims.
- **MUST** regenerate and commit the public token only through `tools/app-access-token.mjs`/`materialize-client-env.mjs`; rotation is an explicit reviewed change, not a side effect of a build. — *Check:* regenerating with the same inputs produces no diff; a changed token has a reviewable rotation reason.

## 9. Failure And Compensation Semantics

The factory spans four module databases and Drive; there is no distributed transaction. Correctness comes from an explicit durable status, an idempotency key, a bounded retry, and a forward compensation. Deleting a committed row is never compensation.

| Failure | Required behavior | Evidence / check |
| --- | --- | --- |
| Deploy application created, IAM provisioning failed | keep the application; set `identity_status = failed`; log the cause; retry through `apps.identityProvision` with the same `deploy:{id}` key | the application and its domains/source remain; the retry lands on one installation |
| IAM provisioning not configured (`Skipped`) | keep `identity_status = pending_identity`; do not report failure or success | no status rewrite; operator sees the pending state |
| Provisioning replay after a timeout | resolve by `deploy_application_id` first, then instance key; never create a second installation | `uk_iam_application_installation_deploy` holds; the command returns the existing row |
| Installation enable before domain/permissions | fail naming the missing field; stay `pending_config` | enable refuses; no token issuance |
| Duplicate environment/domain/client id | conflict naming the existing key/domain/client; no partial write | unique indexes: `(installation_id, env_key)`, `(tenant_id, primary_domain)`, `client_id` |
| Source validation failure | keep `PENDING`/`INVALID`; remix stays disabled; no download coordinates | source response `readiness = MISSING` with a reason |
| Artifact retired after being configured | next read reports `ARCHIVE_UNAVAILABLE`; remix does not hand out a dead pointer | the source response changes without a new write |
| Release promotion conflict | transactional fence; previous channel pointer and rollout remain | two promotions leave one current pointer |
| Second hosting carrier for one deployment | conflict on `uk_webserver_application_deploy_application_id`; reconcile the existing carrier | no duplicate host ownership |
| Anchor missing or claim mismatch | issuance/build fails naming the variable or claim; no fallback identity | error names `SDKWORK_DEPLOY_APPLICATION_ID` or the mismatched claim |
| Tenant disabled, environment inactive, owner disabled | fail closed before signing | `40303`/named environment/owner error; no session row |
| Drive unavailable | package/source reads fail explicitly; no empty file or fake checksum | deploy reports the storage failure; no bytes path through deploy |
| Partial installation (row exists, domains/credentials missing) | keep the row as `pending_config`; complete the missing children; do not delete | reconciliation report lists it; a retry fills the gaps |

Rules:

- **MUST** record a durable status for every cross-module step that can fail: `deploy_app.identity_status`, installation `provisioning_status`/`status`, environment `env_status`, credential `credential_status`, source readiness. — *Violation:* logging an IAM error and leaving no column to retry from; the next operator cannot tell whether the installation exists.
- **MUST** make every retry idempotent by a stable key: `deploy:{id}` for identity provisioning, `provisioningIdempotencyKey` for installation provisioning, an `Idempotency-Key` plus request hash for application create, and the package/release identity for release creation. — *Check:* repeating the same command twice yields one row and the same response body.
- **MUST NOT** roll back a committed module row because a later module failed. Compensation is forward: retry, disable, retire, archive, or reconcile. — *Violation:* deleting the deploy application because its installation could not be created; the domains and audit trail are destroyed and the retry has no key.
- **MUST NOT** compensate by deleting history or by editing an immutable record. Uninstall disables/retires/archives; a correction is a new release or a new application, not a mutated old one. — *Check:* the uninstall path contains no `DELETE` on installation, credentials, carrier, releases, or audits.
- **MUST** bound retries (attempt count and timeout) and make them safe against duplicates; an unbounded loop that creates rows is prohibited. — *Violation:* a worker retrying a non-idempotent credential create forever; every retry mints a new client id.
- **MUST** name the failing stage, resource, and key in the error: deployment id, installation id, environment key, source/artifact id, or client id. A generic "provisioning failed" is not actionable and is not acceptable evidence. — *Check:* the error text contains the identifier an operator can search.
- **MUST** run reconciliation for every soft cross-module reference: deploy application `identity_status` vs installation existence, carrier `deploy_application_id` vs deploy inventory, installation environment domains vs carrier hosts, and token anchor vs installation. A dangling reference is an alert, not a valid state. — *Violation:* a carrier linked to a deleted deploy application; reconciliation reports zero because nobody checks.
- **MUST NOT** introduce a fallback credential, a "repair" that rewrites the anchor, or an out-of-band SQL fix as the normal recovery. A repair `MUST` be an explicit operator action recorded in the runbook, and the normal path `MUST` be idempotent replay. — *Check:* the operator runbook has a retry command, and the record types an audit event.

## 10. Deduplication And Cross-Standard Boundaries

This standard is the factory umbrella; it deliberately does not become a second authority. The following table is the dedup contract.

| Subject | Authority | What this standard adds |
| --- | --- | --- |
| Vocabulary, one-to-one relations, token `app_id` binding, release-scope vocabulary | `APPLICATION_IDENTITY_SPEC.md` §1–§4.1 | the factory sequence and the cross-module consequences of the scope |
| Token format, public token profile matrix, build/start gate | `APP_ACCESS_TOKEN_SPEC.md` §2–§4.1 | the deployment anchor source (`SDKWORK_DEPLOY_APPLICATION_ID`) and the factory materialization order |
| Session token claims and tenant-bound signing | `IAM_SPEC.md` §5.2 | that issuance reads the installation's scope and fails closed on contradiction |
| Installation, environment, credential, bootstrap commands and APIs | `IAM_APPLICATION_BOOTSTRAP_SPEC.md` §2–§5 | what deploy does before/after the bootstrap call and how a failure is recorded |
| Database naming, ownership fields, subject scope, indexes | `DATABASE_SPEC.md` §6.7, §6.10, §7 | the concept-to-table matrix and the required 1:1 indexes |
| Deployment profiles, runtime bootstrap, environment names, port/edge topology | `DEPLOYMENT_SPEC.md` §1/§2/§6, `DOCKER_SPEC.md` §3, `ENVIRONMENT_SPEC.md` §5 | the application-level domain plan and the five-environment factory matrix |
| Release evidence, rollout, rollback, versioning | `RELEASE_SPEC.md` §1–§5 | the factory lifecycle stages that produce and consume a release |
| Hosting configuration, virtual hosts, TLS, public edge | `SDKWORK_WEBSERVER_SPEC.md` §0.1/§9/§10 | that the carrier is anchored to the deploy application and owns no identity |
| Bytes, upload sessions, download grants, retention | `DRIVE_SPEC.md` §6.1/§9 | that deploy returns coordinates and Drive returns bytes |
| Build/package/artifact validation and traceability | `RELEASE_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md` | that the package/release identity is immutable and the anchor survives upgrades |

Rules:

- **MUST** link to the owner section rather than restate its table; a duplicated table is a second authority even when it currently agrees. — *Violation:* copying the `IAM_SPEC.md` claim-admission list into this file; the next claim change updates one copy and the other stays green.
- **MUST** send a change to the owner standard first when it needs a new claim, a new table, a new enum value, or a new API. This standard then cites the new owner section. — *Check:* a pull request that adds `ownership_scope` to a token but not to `IAM_SPEC.md`/`APP_ACCESS_TOKEN_SPEC.md` is rejected by review.
- **MUST** keep the factory-specific rules here limited to cross-module sequencing, scope, endpoint registration, source/remix gate, environment/domain planning, token-anchor materialization, compensation, and the runbook. — *Violation:* a second database naming table, a second release evidence checklist, or a second bootstrap request schema in this file.
- **SHOULD** treat an apparent conflict as a defect in this standard, not in the owner. — *Check:* the reviewer asks "which standard owns this fact?" before accepting the cited wording.
- **SHOULD** qualify "application" whenever the sentence could be read as more than one of the five concepts. Write *product application*, *deploy application*, *installation*, *hosting carrier*, or *scaffold*. — *Violation:* "the application must be enabled"; the reader cannot tell whether the deploy row, the installation row, or the carrier is meant.

## 11. New Application Factory Runbook

This is the complete step list for adding one new application (one endpoint surface). A ten-surface product repeats it per surface; a Flutter product runs it once with multiple platform targets.

1. **Choose the surface and kind.** Select exactly one row of section 5 and the canonical `app_kind`. Do not create a combined app or a per-store duplicate for the same kind.
2. **Register the deploy application.** Create `deploy_app` through `POST /app/v3/api/apps` with the name, slug, kind, and owner level. Creation is idempotent by `Idempotency-Key`; a retry returns the same row. The registration granularity is the surface: one surface is one deploy application, so a repository that ships several surfaces registers one row per surface (the `sdkwork-specs` registrar's `--scope all` does this, one `apps/<surface>` manifest root at a time).
3. **Bind the source.** Upload an archive through the upload/artifact flow, or register a Git repository. Then `PUT /app/v3/api/apps/{appId}/source` with `GIT` (provider/url/ref/subPath) or `ARCHIVE` (artifactId). For Git, run `POST /app/v3/api/apps/{appId}/source/validate` until `repoStatus = VALIDATED`; supply `credentialSecretRef` if the probe says credentials are required.
4. **Confirm readiness.** `GET /app/v3/api/apps/{appId}/source` must return `readiness = READY`. If it is not ready, fix the reported reason; do not enable remix yet.
5. **Enable remix only if the application is remixable.** `PUT /app/v3/api/apps/{appId}/remix` with `{ "enabled": true }` after readiness; verify `GET /app/v3/api/apps/{appId}/remix` returns a `download` block. Disabling is always allowed.
6. **Plan environments and domains.** Declare the deployment environment rows and platform targets. For each of the five environments, know the default host (`<label>.app[-<env>].<suffix>`) and whether the environment is commissioned; set the installation environment domain when the environment is registered.
7. **Build and release.** Create the build, the package, the release, and the channel promotion; promote into each environment. The release is immutable; an upgrade is a new release, never an edit.
8. **Provision identity.** Creation already calls identity provisioning. Verify `identity_status`; on `failed`, retry `POST /backend/v3/api/apps/{appId}/identity_provision` (same `deploy:{id}` key). The installation is created by the IAM bootstrap surface (`IAM_APPLICATION_BOOTSTRAP_SPEC.md` §2) and starts `pending_config`.
9. **Enable the installation.** Configure `primary_domain` and a non-empty `accessPermissions` list. The minimal pre-login scope (for example `iam:self`/`iam.credential_entry`) belongs there; an empty provisioning list is a valid "no API scope" input, but the current enable gate requires at least one scope, so an application that claims no business API still declares its bootstrap scope. Then enable. A token request before enable must fail.
10. **Register the installation environment and credential.** Upsert the environment row with `env_key`, domain, and status; create the OAuth client/credential for that environment when the surface uses OAuth. Rotate rather than reuse a client id; revoke retires it.
11. **Materialize the token anchor.** Set `SDKWORK_DEPLOY_APPLICATION_ID` to the deploy application id, keep the committed placeholder in the repository, and run `node <sdkwork-specs>/tools/materialize-client-env.mjs --root <repository>`. Set `SDKWORK_APPLICATION_OWNERSHIP_SCOPE` (or declare `accessToken.ownershipScope`) to the installation's release scope — `TENANT` when neither is present — and, for a `USER` installation, `SDKWORK_APPLICATION_OWNER_USER_ID`, because the token then carries `ownership_scope` and the owner's `user_id` (§8, `APP_ACCESS_TOKEN_SPEC.md` §3.2.1). A repository whose surfaces are registered one by one records each anchor under the surface-scoped variable `<SDKWORK_DEPLOY_APPLICATION_ID>_<SURFACE>` and materializes with `--surface <surface-id>`, so materializing one surface never rewrites another surface's carrier. Run `node <sdkwork-specs>/tools/check-release-access-token-env.mjs --root <repository>`; packaging must fail closed without it.
12. **Anchor the hosting carrier.** Create the `webserver_application` with `deploy_application_id` for the deployed endpoint, register its host (default or custom), and bind the certificate. The carrier must not create a second application identity.
13. **Verify the admin filters.** In the admin application center, confirm the new row is visible under the correct application group, ownership scope (`ownerType`/`ownershipScope`), `appKind`, `appStatus`, and environment filter; the deployment ledger must not show a duplicate. A `USER`-owned app must not be visible to another tenant member.
14. **Verify isolation and evidence.** Run a two-scope access test (member/organization/user), a token anchor test (`app_id == aud` for a deployment credential), and the release evidence check. Record the build, release, installation, and token evidence before announcing the application.

Rules:

- **MUST** validate the source before enabling remix; automatic identity provisioning may start when the deploy application is created, and it `MUST NOT` be read as proof that the source is ready. — *Violation:* enabling remix immediately after create because the installation exists; the source is still `PENDING`.
- **MUST** complete steps 8–10 before enabling traffic; a live host with a `pending_config` installation returns authorization failures that look like outages. — *Check:* the host is not announced until the installation is `enabled`.
- **MUST** treat step 13 as a deliverable, not a demonstration: an application that is absent from the admin filter is operationally invisible. — *Check:* the list query returns it for its owner scope and not for a wider scope.

## 12. Acceptance Checklist

Concepts and authority:

- [ ] Exactly the five concepts of section 2 exist; no sixth application model or second scaffold family.
- [ ] Each concept has one writer; other modules store identifiers only, never copies of identity facts.
- [ ] Installation ↔ deploy application and carrier ↔ deploy application are 1:1 unique indexes.
- [ ] No cross-module lookup uses display name, slug, or a `metadata` document as the authority.
- [ ] The token `app_id` is the deploy application in every family; no product/installation/carrier id is used.

Lifecycle:

- [ ] A deployment cannot issue a token before its installation is `enabled`.
- [ ] Every cross-module stage has a durable status and an idempotent retry key.
- [ ] A failed provisioning does not roll back the deploy application; the retry lands on the same installation.
- [ ] An upgrade keeps the deployment anchor and the installation row unchanged.
- [ ] Uninstall disables/retires/archives and retains history; it performs no destructive delete.

Release scope:

- [ ] Every installation has exactly one immutable `ownership_scope`.
- [ ] `TENANT` is the default only for `TENANT`/`PLATFORM` applications; `USER`/`ORGANIZATION` produce their matching scope.
- [ ] The request cannot select or widen the scope; a declared mismatch fails closed.
- [ ] Data planes filter by the scope's isolation key, and the required columns exist.
- [ ] A `USER` credential subject is the installation owner.
- [ ] Every public application access token declares the installation's `ownership_scope`, and a `USER` token carries its owner's `user_id`.

Endpoint surfaces:

- [ ] Each shipped surface is its own deploy application with the correct `app_kind`.
- [ ] The kind/platform/package-format matrix is enforced for every target.
- [ ] A Flutter build is one `FLUTTER_APP` with multiple targets, not separate native apps.
- [ ] No application combines two surfaces or two store identities.
- [ ] The admin filter exposes group, ownership, kind, status, and environment, gated in the query.

Source and remix:

- [ ] Exactly one source exists per deploy application.
- [ ] A Git source is `VALIDATED` by the probe before readiness; an archive source points at an active, same-application artifact.
- [ ] `remix_enabled` requires readiness; the download coordinates come from deploy and bytes come from Drive.
- [ ] A remix creates a new deploy application, installation, and token audience.

Environment and hosting:

- [ ] The five lifecycle environments are the only values; each has its own host.
- [ ] The default host follows `<label>.app[-<env>].<suffix>` and the registered suffix catalog.
- [ ] The installation environment domain is unique per tenant and matches the carrier host.
- [ ] The hosting carrier is 1:1 with the deploy application and owns no application identity.
- [ ] Release artifacts contain no development origin, `localhost`, `http://`, or shared production host.

Token materialization:

- [ ] The public token `app_id`/`aud` comes from `SDKWORK_DEPLOY_APPLICATION_ID`, never a compiled literal.
- [ ] The repository commits the placeholder where the anchor is deployment-assigned.
- [ ] All ten profile files are present and valid; packaging fails closed without a release token.
- [ ] A session credential's `ownership_scope` matches the installation; `USER` subjects are the owner.
- [ ] The public token is isolation-only and is rejected on protected routes.

Failure and compensation:

- [ ] Every retry is bounded, idempotent, and names the failing stage/resource/key.
- [ ] No compensation deletes a committed row or edits immutable history.
- [ ] Reconciliation covers identity, carrier, environment domain, and token-anchor references.
- [ ] A dangling cross-module reference raises an alert instead of passing silently.

Deduplication:

- [ ] No claim table, naming table, bootstrap schema, or release-evidence list is duplicated here.
- [ ] A new claim/table/enum/API was added to its owner standard before being cited here.
- [ ] "Application" is qualified in every new normative sentence.

## 13. Landing Status And Known Gaps

This section records what the current implementation proves and what it does not, so this standard is not read as a roadmap presented as fact. Closing a gap requires the owning module's change plus the verification named in the row.

| Area | Current evidence | Gap or boundary |
| --- | --- | --- |
| Five concepts and 1:1 anchors | `deploy_app`, `iam_application_installation.deploy_application_id` unique, `webserver_application.deploy_application_id` unique, `appstore_application*`, `deploy_application_scaffold*` | the plan's `deploy_app` → `deploy_application` rename is **not applied**; the physical name remains `deploy_app` |
| Release scope | `ownership_scope` + `owner_user_id` + DB `CHECK` in the IAM ownership-scope migration; deploy normalizes `PLATFORM` to `TENANT`; issuance reads the installation | `tenancy_model`, `upgrade_policy`, installation-level `retired_at`, and `purge_status` from the restructure plan are **not in the installation schema**; credential `retired_at` exists on the credential row only. Upgrade/uninstall use the existing disable/retire/archive primitives |
| Endpoint kinds | `chk_deploy_app_app_kind`, contract enum, `validate_app_kind_platform`/`validate_package_format_for_platform` | legacy `STATIC_WEB`/`SPA_WEB` rows may still exist; the deploy canonical-kind migration adds the check `NOT VALID` until legacy rows are normalized and the constraint is validated |
| Source and remix | `deploy_app_source` with one-source unique index, validation probe, readiness reasons, remix download coordinates | a market-template install that reads an author-scoped version is still a known service gap (deploy `template_market`); it must not be treated as a ready source |
| Environment and hosts | five-environment host formula, suffix catalog, carrier anchor, installation environments/credentials | the uninstall/upgrade product surface is not fully wired; the lifecycle is exercised through the API primitives, not a single operator workflow |
| Token anchor | `SDKWORK_DEPLOY_APPLICATION_ID`, `appIdEnv`, placeholder, fail-closed materialization and release gate | the public token generator emits `login_scope`/`organization_id`, **not** `ownership_scope`; the server resolves scope from the installation. `APPLICATION_IDENTITY_SPEC.md` §4.1 rule 10's public-token claim is therefore target hardening, not a current token field |
| Scaffold and price | scaffold CRUD and marketplace paths in deploy; appstore listing/price is the commerce authority | `deploy_application_scaffold` still carries `pricing_model`/`price_minor`/`currency` and serializes them for its market; they are a presentation value, not a settlement authority, until the owner migration removes or repurposes them |
| Naming | `runtime_app_id` is used for the installation's IAM runtime id | the acceptance report records this as a naming debt (D3); it must not be read as the deploy anchor |

Rules:

- **MUST NOT** describe a gap row as implemented, or infer a capability from a plan that the schema does not carry. — *Violation:* claiming installation-level auto-upgrade policy exists because the plan named `upgrade_policy`; no column exists.
- **MUST** close a gap through the owning module and update this table in the same change; a standard-only edit does not close behavior. — *Check:* the closing change names the migration/API/test and updates the evidence column.
- **MUST** treat the physical-name differences (`deploy_app`, `iam_application_installation` vs wire `tenantApplicationId`) as naming facts, not as a second concept. A wire rename requires `MIGRATION_SPEC.md`. — *Violation:* declaring a second installation concept because the API path still says `tenant_applications`.
