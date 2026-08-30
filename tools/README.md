# SDKWork Standards Tools

This directory contains executable validators for SDKWork standards.

Rules:

- Tools in this directory are standards-owned and application-neutral.
- Application repositories may call these tools through thin `package.json` scripts.
- `check-workspace-layout.mjs` validates authored top-level directory names and rejects
  repository/app/module `.runtime/` directories even when defensively ignored. Tool-native generated
  directories remain outside authored capability validation.
- `check-pnpm-script-standard.mjs` validates root scripts, package-local
  script names and command values, deterministic `dev` -> `dev:standalone`
  delegation, remote-only `dev:cloud`, default `dev:browser`/`dev:desktop`
  PostgreSQL + standalone + development resolution, paired phase-first
  standalone/cloud release and deploy variants, action-first runtime target
  command names, retired deployment flags, and active Markdown/AGENTS plus
  command-bearing JSON examples against `PNPM_SCRIPT_SPEC.md`.
- `audit-pnpm-lifecycle-framework.mjs` discovers application roots from
  `sdkwork.app.config.json`, reports development/build/release/deploy framework
  coverage, and assigns deterministic migration waves without modifying
  consumers. Use `--json` for migration automation and `--fail-on-debt` only
  after the approved consumer wave has completed.
- `check-topology-deployment-profiles.mjs` validates current v5 and migration
  v4 standalone/cloud profile coverage, rejects retired v5 `cloudIngress`
  implementation metadata, and verifies canonical application/platform API
  surfaces. Use `--root <application>` for one application,
  `--workspace <path> --repo <repository-name>` for one workspace child, or
  only `--workspace <path>` for a workspace scan. It rejects cloud
  development profiles that autostart local API/dependency processes, omit
  deployed surface URLs, use placeholders, or inherit loopback URLs without an
  explicit tunnel/proxy.
- `materialize-deployment-index.mjs` previews a minimal
  `etc/sdkwork.deployment.config.json` from an existing topology v5 profile
  inventory. It never copies URLs, rejects profiles outside `etc/`, and writes
  only with explicit `--write` after deployment review.
- `materialize-client-env.mjs` reads a repository-owned
  `etc/client-env.materialization.json` declaration and deterministically
  projects the root deployment profile matrix into tracked Vite, Flutter, and
  native mini-program client files. It emits generic and application-scoped
  profile identity, rejects secret-bearing keys and cloud loopback URLs, and
  supports `--check` for stale-file verification.
- `check-source-config-standard.mjs` validates deployable-root `etc/`
  ownership, canonical `standalone|cloud` x
  `development|test|staging|demo|production` profile ids, default-profile
  membership, in-`etc/` references, referenced-file existence, secret
  boundaries, retired `configs/` debt, and production gateway CORS. Add
  `--enforce-profile-identity` whenever env profiles or materializers are
  created or changed; it requires matching `environment`,
  `deploymentProfile`/`deployment_profile`, and `profileId`/`profile_id` in
  dotenv, JSON, TOML, or YAML source profiles.
- `resolve-app-runtime-plan.mjs` resolves a v5 topology into the canonical
  runtime plan shape, including local processes, remote surfaces, URL
  provenance, data stores, health checks, and forbidden cloud-development
  roles.
- `schemas/sdkwork.app.topology.schema.v5.json` and
  `schemas/sdkwork.runtime-plan.schema.v1.json` are the machine contracts for
  topology declarations and resolved plans.
- `check-app-manifest-deployment-standard.mjs` validates application runtime
  supported/default profiles and fixed versus runtime-configurable package
  bindings, canonical runtime targets/source types, dual-binding artifact ids,
  and client-only profile-configurable targets.
- `check-app-manifest-standard.mjs` validates the v3 app manifest identity,
  required sections, package/release references, secrets, and composes the
  deployment/profile gate. `non-deployable` test-runner evidence is excluded
  from publication and deployment profile coverage. Workspace scans report
  malformed manifests per file and continue validating the remaining active
  application roots; local `_sdkwork-agents-local-archive-*` backups are not
  application authorities.
- `check-deploy-standard.mjs` and `deployctl.mjs` validate v1 migration or v2
  deploy manifests. V2 adds typed deployment dimensions; side-effecting apply
  requires explicit profile/environment, immutable artifact digest, verified
  artifact evidence, and approval plus rollback/forward-fix target. Nginx
  apply and rollback preserve target-keyed recovery evidence, use atomic file
  replacement, and fail closed on `nginx -t` or reload.
- `check-agent-workflow-standard.mjs` validates repository/application
  `AGENTS.md` dynamic progressive loading, compatibility shims, relative
  `sdkwork-specs` links, and list/search pagination section presence. For
  application/package repositories it also validates `sdkwork.workflow.json`
  package target metadata and thin `.github/workflows/package.yml` reusable
  workflow integration; `repository-kind: standards` roots skip application
  packaging workflow requirements.
- `audit-agents-progressive-loading.mjs` writes a deterministic, read-only
  manifest for a workspace root, direct `sdkwork-*` `.gitmodules` repositories,
  tracked application manifests, and tracked direct `apps/*` roots. It excludes
  external, generated, and runtime paths and never modifies `AGENTS.md` files.
  Its `alignment` object contains clean, hash-guarded targets for
  `align-agents-progressive-loading.mjs`; dirty or unsafe candidates remain in
  `alignment.deferred` with a reason.
- `align-agents-pagination-standard.mjs` inserts or refreshes the
  `## List And Search Pagination` section in repository `AGENTS.md` files per
  `PAGINATION_SPEC.md` and `AGENTS_SPEC.md`.
- `check-api-operation-patterns.mjs` validates SDKWork-owned custom OpenAPI
  operations against `API_SPEC.md` section 15.4: operationId action alignment,
  create `201`, update `200`, delete `204` without JSON bodies, command/bulk
  status rules, and operation-level vendor compatibility exemptions.
- `check-api-response-envelope.mjs` validates SDKWork-owned custom OpenAPI
  response envelopes and problem details for app-api, backend-api, and business
  open-api authorities, while skipping only operation-level external protocol
  compatibility routes.
- `check-route-path-collisions.mjs` validates normalized route registry
  uniqueness across route manifests and OpenAPI authorities. It fails when
  distinct operations share the same `(surface, method, path)` after path
  template normalization.
- `check-permission-composition.mjs` validates client application permission
  composition for HTTP `sdkDependencies`: required `contracts.permissionComposition`,
  inherited IMF module catalog refs, and OpenAPI `x-sdkwork-permission` codes
  that resolve to inherited or application-owned manifests.
- `check-component-port-bindings.mjs` validates composable component contracts:
  `contracts.layerRole`, valid provided/required port declarations, and executable
  runtime entrypoints for same-origin dependency API surfaces. Use `--root` for one
  repository or `--workspace` for all child `sdkwork-*` repositories.
- `check-application-layering.mjs` validates cross-language application L0-L6
  boundaries: Java controllers stay out of repositories/infrastructure and
  transactions, repositories stay out of HTTP framework types, frontend UI stays
  out of raw HTTP, and frontend services receive injected SDK clients. Use `--root`
  for one repository or `--workspace` for all child `sdkwork-*` repositories.
- `check-frontend-composition.mjs` validates client package composition boundaries:
  required core exports, core/commons not depending on capability packages, host
  packages not depending on business SDKs, and feature packages not importing
  generated SDK packages directly. Use `--root` for one repository or `--workspace`
  for all child `sdkwork-*` repositories.
- `check-rust-backend-composition.mjs` validates Rust backend Cargo boundaries:
  service crates do not depend on concrete SQLx repository crates, route crates
  do not depend on generated SDKs for the same surface, repository crates do not
  depend on HTTP framework crates, and member Cargo manifests do not declare
  sibling SDKWork source paths outside root workspace dependencies. Use `--root`
  for one repository or `--workspace` for all child `sdkwork-*` repositories.
- `check-i18n-standard.mjs` validates SDKWork i18n source layouts, rejects
  authored locale monoliths, checks generated/thin platform resource projections,
  and enforces Rust/Java backend message bundle plus database locale seed
  placement. It skips vendored or third-party source trees such as `external/`,
  `third_party/`, and `vendor/`. Use `--root` for one repository or `--workspace`
  for all child `sdkwork-*` repositories.
- `check-pagination.mjs` heuristically scans for in-process pagination smells,
  OpenAPI wire alias debt (`pageSize`, `limit`, `page_no`, `pageNo`,
  `per_page`, `size`), missing `page_size.maximum`, missing `PageInfo.mode`,
  docs/tests examples with retired query names, and generated SDK transport
  query aliases per `PAGINATION_SPEC.md` section 2, section 10.2, and section 12.
- `check-database-framework-standard.mjs` validates application-root `database/`
  lifecycle assets, locale directories, manifests, L2 contract registries,
  per-engine baseline DDL, and required `db:*` scripts against
  `DATABASE_FRAMEWORK_SPEC.md`.
- `audit-database-framework-workspace.mjs` scans all `sdkwork-*` repositories under
  a workspace root and reports database framework compliance tiers.
- `bootstrap-database-module.mjs` scaffolds a standard `database/` module from
  `templates/database/` using `database-module-registry.json`. Authoritative
  server imports are PostgreSQL-only and fail when a legacy source glob crosses
  into SQLite assets.
- `check-identity-naming.mjs` validates identity lattice terminology in standards
  (`NAMING_SPEC.md` §0–§0.2), including root-level authority documents, and
  rejects deleted example identities, ambiguous gateway roles, retired
  placeholders, and commerce `product` overloads. Consumer mode scans
  non-canonical Rust HTTP route crate names, `identity` domain packages, and
  related patterns. See `MIGRATION_SPEC.md` §8.
- `check-application-cloud-gateway-boundary.mjs` rejects application ownership,
  operation, config, packaging, or release coupling to
  `sdkwork-api-cloud-gateway`, generic application cloud gateway identities,
  and the retired `integration.foundationApiGateway` parallel component
  contract.
- `migrate-remove-application-cloud-gateway.mjs` removes mechanically safe
  application-owned cloud gateway scripts, topology metadata, and source
  config, while reporting component-contract decomposition and other
  behavior-sensitive changes for manual repair.
- `bootstrap-api-assembly-repo.mjs --root <application>` is the canonical
  one-time assembly onboarding command. It materializes served or `apiMode: none`
  assemblies, adds Cargo workspace membership, writes direct canonical
  pnpm tool delegation, validates immediately, creates no wrapper scripts, and
  is idempotent.
- `materialize-route-component-specs.mjs (--root <application> | --workspace
  <workspace>) [--write]` plans missing ownership contracts for canonical Rust
  app/backend/open route crates and creates them only with explicit `--write`.
  It never overwrites authored component contracts.
- `migrate-application-gateway-hosting.mjs (--root <application> | --workspace
  <workspace>) [--write]` replaces newly materialized placeholder assemblies
  with existing authored business wiring, renames retired application assembly
  and standalone gateway crates to canonical identities, rewrites owned text
  references, and re-runs canonical bootstrap. It requires explicit `--write`.
- `materialize-standalone-gateway.mjs (--root <application> | --workspace
  <workspace>) [--write]` creates a minimal canonical standalone host only for
  application roots whose assembly has a zero-argument `assemble_api_router`.
  It refuses application-specific dependency wiring instead of guessing.
- `cleanup-descriptor-only-route-crates.mjs (--root <repo> | --workspace
  <workspace>) [--write]` removes canonical route crates that contain only an
  empty `gateway_mount` descriptor and no executable handler routes, clears
  Cargo and generated route-manifest references, then rematerializes assembly.
- `wire-api-assembly-host.mjs --root <application>` is a migration-only wiring
  aid for an existing canonical standalone gateway. It requires an explicit
  mutation scope and is never completion evidence by itself.
- `audit-gateway-alignment-repo.mjs --root <application> --strict` is the
  read-only application hosting readiness gate. It distinguishes assembly
  readiness from standalone-host readiness and audits `apiMode: none`
  applications instead of skipping them.
- `check-iam-web-adapter-standard.mjs` scans consumer repositories for canonical IAM
  web-adapter integration (`IamWebRequestContextResolver`,
  `iam_web_request_context_resolver_from_env`) and blocks legacy resolver imports,
  deprecated factory calls, and application-local pass-through resolver wrappers per
  `IAM_SPEC.md` and `WEB_FRAMEWORK_SPEC.md`.
- Tools must not embed application-specific secrets, local paths, or application-line behavior.
