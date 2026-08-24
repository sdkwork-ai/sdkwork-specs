# SDKWork Repository Workspace Standard

- Version: 1.1
- Scope: standard project root directory dictionary, read-only upstream source boundaries, and source-controlled `.sdkwork/` workspace metadata at every git repository root and every SDKWork application root
- Related: `README.md`, `SOUL.md`, `AGENTS_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `APPLICATION_SPEC.md`, `COMPONENT_SPEC.md`, `DOCUMENTATION_SPEC.md`, `GOVERNANCE_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines the repository/application root directory dictionary and the `.sdkwork/` directory. `.sdkwork/` is the local knowledge and extension workspace for SDKWork development. It stores reusable skills, repository-local plugins, and optional machine-readable workspace manifests that help agents, developers, and CI use the same standards.

Every SDKWork git repository root and every SDKWork application root `MUST` contain `AGENTS.md`, `.sdkwork/skills/`, and `.sdkwork/plugins/`. SDKWork-managed roots that support tool-specific compatibility also `MUST` contain shim files such as `CLAUDE.md`, `GEMINI.md`, or `CODEX.md` that point to `AGENTS.md`. Empty directories are not enough unless the repository has a tracked placeholder such as `README.md` or `.gitkeep`.

## 1. Directory Meanings

There are four different SDKWork path families that must not be mixed:

| Path family | Owner | Purpose | Governing spec |
| --- | --- | --- | --- |
| `<repo-or-application-root>/.sdkwork/` | repository/application maintainers | Source-controlled workspace metadata, common skills, local plugins, optional manifests | this file |
| `<generated-sdk-output>/.sdkwork/sdkwork-generator-*.json` | `sdkgen` | Generated SDK control-plane reports and manifests; required for HTTP/OpenAPI output and optional for RPC release, CI, audit, or migration evidence | `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md` |
| `~/.sdkwork/<application-code>` or `%USERPROFILE%\.sdkwork\<application-code>` | runtime user/process | User-private runtime config, data, cache, logs, secrets, temp files | `RUNTIME_DIRECTORY_SPEC.md` |
| `<repo-or-application-root>/{external,third_party,vendor}/` | upstream project or vendor | Optional pinned source consumed read-only through native build tools | `DEPENDENCY_MANAGEMENT_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md` |

In addition, SDKWork source dependency paths declared in `pnpm-workspace.yaml`, root `Cargo.toml`, and root `pubspec.yaml` are workspace-root owned. Sibling SDKWork repositories are consumed through these native build-tool mechanisms; the workspace root is the single source of truth for those paths, and member packages consume them by protocol (`workspace:*`, `{ workspace = true }`, package name).

Rules:

- Root/application `.sdkwork/` is source workspace metadata. It is not runtime state.
- Repository roots, application roots, and nested source modules `MUST NOT` contain `.runtime/`.
  Process coordination and disposable scratch state follow `RUNTIME_DIRECTORY_SPEC.md` section 5.
- Generated SDK output `.sdkwork/` directories are generator-owned. Do not add repository skills, plugins, or hand-authored workspace manifests there.
- Runtime `~/.sdkwork/<application-code>` directories are user-private. Do not commit them, mirror them into source, or use them as source standards.
- Local/private source workspace state may exist only under ignored paths such as `.sdkwork/local/`, `.sdkwork/tmp/`, `.sdkwork/cache/`, or `.sdkwork/secrets/`.
- Multi-repository SDKWork workspaces `MUST` declare sibling SDKWork source paths in native build-tool workspace roots (`pnpm-workspace.yaml packages:`, `Cargo.toml [workspace.dependencies]`, or root `pubspec.yaml dependency_overrides`), not in `.sdkwork/`.
- A member package `MUST NOT` redeclare a sibling SDKWork source path; it consumes the workspace root entry by native protocol.
- A SDKWork workspace root `SHOULD` be co-located with the SDKWork application root or git repository root. A workspace root that is not a git repository root is allowed only when explicitly documented.
- `external/`, `third_party/`, and `vendor/` are not SDKWork-authored source roots. They `MUST` remain read-only, `MUST NOT` contain SDKWork runtime state or generated output, and `MUST NOT` be assigned SDKWork component-spec ownership.
- Native build tools `MAY` depend directly on public packages, crates, or modules under these upstream roots according to `DEPENDENCY_MANAGEMENT_SPEC.md` section 3.2.

## 1.1 Standard Project Root Directories

SDKWork uses a two-layer source layout:

- `<project-root>/` is the git repository root or independent SDKWork application root governed by
  the standard top-level directory dictionary in this section.
- `apps/sdkwork-<application-code>-<client-arch>/` is an architecture-specific application surface root.
  It may contain `src/`, `lib/`, `App/`, `entry/`, `packages/`, `config/`, platform files, and
  other directories required by its selected architecture standard.
- `apps/` itself is a collection of application roots, not a language source root. Each direct child
  under `apps/` represents one selected application language/architecture root, such as
  `apps/sdkwork-<application-code>-pc/`, `apps/sdkwork-<application-code>-h5/`,
  `apps/sdkwork-<application-code>-flutter-mobile/`, `apps/sdkwork-<application-code>-mini-program/`,
  `apps/sdkwork-<application-code>-android-mobile/`, `apps/sdkwork-<application-code>-ios-mobile/`, or
  `apps/sdkwork-<application-code>-harmony-mobile/`. Cross-architecture TypeScript contracts, service
  ports, runtime, bootstrap, and domain RPC proto packages belong in
  `apps/sdkwork-<application-code>-common/packages/` when the repository owns multiple client surfaces.
  Architecture-local `src/`, `lib/`, `App/`, `entry/`, `packages/`, `config/`, and platform
  directories belong inside that child root.

Top-level `src/`, `packages/`, and `config/` are not generic SDKWork project-root directories.

Repository-root `packages/` rules:

- Application git repositories `MUST` place all package-family deliverables under
  `apps/sdkwork-<application-code>-common/packages/` or
  `apps/sdkwork-<application-code>-<client-arch>/packages/`. This applies to single-surface and
  multi-surface repositories alike.
- Repository-root `packages/` `MUST NOT` exist when the repository owns
  `apps/sdkwork-<application-code>-*` application roots or when it also owns `apis/`, `crates/`, or
  `sdks/` for an application line.
- Repository-root `packages/` is allowed only for a **dedicated shared package-family repository**
  whose sole primary deliverable is reusable package families and whose root README declares
  `repository-kind: shared-package-family`.
- Legacy repository-root families such as `packages/common/`, `packages/pc-react/`, and
  `packages/mobile-react/` are migration-only. New work `MUST NOT` add them.

When documenting or referencing package paths in standards, agents, or validators, always use the
full architecture-qualified path such as `apps/sdkwork-<application-code>-pc/packages/`. Do not
use bare `packages/` without the owning `apps/sdkwork-<application-code>-<client-arch>/` prefix.

Top-level `src/` and `config/` remain architecture-local under `apps/sdkwork-<application-code>-<client-arch>/`
when the governing architecture standard requires them.

### 1.1.2 Repository Kind And Packages Layout

Every SDKWork git repository root `MUST` declare its repository kind in root `README.md`:

```md
repository-kind: application
```

Allowed values:

| `repository-kind` | Purpose | Repository-root `packages/` |
| --- | --- | --- |
| `application` | Runnable SDKWork application git repository | Forbidden; use `apps/sdkwork-<application-code>-common/packages/` or `apps/sdkwork-<application-code>-<client-arch>/packages/` |
| `legacy-application` | Audit-only transitional label for repositories still being migrated by automation | Forbidden after cutover; use `align-workspace-packages-layout.mjs` then declare `application` |
| `shared-package-family` | Dedicated reusable package-family repository with no runnable application surface | Allowed at repository root |
| `foundation-dependency` | Shared foundation dependency repository such as `sdkwork-appbase` | Allowed at repository root until a foundation layout migration is recorded |
| `standards` | Standards or tooling repository such as `sdkwork-specs` | Not applicable |

Inference rules when `repository-kind` is omitted:

- `sdkwork.app.config.json` or `apps/sdkwork-<application-code>-*` present → treat as `application`
- README states the repository is not an independent SDKWork application root → treat as `foundation-dependency`
- repository-root `packages/` plus application-line `apis/`, `crates/`, or `sdks/` → treat as `legacy-application`

Verification:

```bash
node ../sdkwork-specs/tools/check-workspace-layout.mjs --root .
node ../sdkwork-specs/tools/check-workspace-layout.mjs --workspace ..
node ../sdkwork-specs/tools/check-workspace-packages-layout.mjs --root . --mode enforce
node ../sdkwork-specs/tools/check-workspace-packages-layout.mjs --workspace .. --mode enforce
node ../sdkwork-specs/tools/check-workspace-packages-layout.mjs --workspace .. --mode audit
node ../sdkwork-specs/tools/align-workspace-packages-layout.mjs --root . [--dry-run]
node ../sdkwork-specs/tools/align-workspace-packages-layout.mjs --workspace .. [--dry-run]
node ../sdkwork-specs/tools/check-workspace-federation-paths.mjs --workspace ..
node ../sdkwork-specs/tools/align-workspace-federation-paths.mjs --workspace .. [--dry-run]
node ../sdkwork-specs/tools/check-workspace-lock-package-paths.mjs --workspace ..
node ../sdkwork-specs/tools/align-workspace-lock-package-paths.mjs --workspace ..
```

Rules:

- New application repositories `MUST` declare `repository-kind: application` and `MUST NOT` create repository-root `packages/`.
- Pre-launch application repositories `MUST` pass `check-workspace-packages-layout.mjs --mode enforce`; `migration` mode is for transitional sweeps only.
- Repositories with remaining repository-root package debt `SHOULD` run `align-workspace-packages-layout.mjs` before re-declaring `repository-kind: application`.
- Foundation dependency repositories `MUST` declare `repository-kind: foundation-dependency` or an equivalent explicit README statement.
- Shared package-family repositories `MUST` declare `repository-kind: shared-package-family`.
- Documentation, agents, and validators `MUST` use full architecture-qualified package paths such as `apps/sdkwork-<application-code>-pc/packages/`; bare `packages/` is ambiguous and MUST NOT be used alone in standards text.
- `check-workspace-federation-paths.mjs` `MUST` validate `pnpm-workspace.yaml`, nested `package.json#workspaces`, package script path references, and `tsconfig*.json` `compilerOptions.paths`, `include`, `exclude`, and `files` entries for stale legacy layout paths and unresolved legacy references.
- `align-workspace-federation-paths.mjs` `SHOULD` rewrite resolvable stale federation and TypeScript path references to canonical architecture-qualified targets before pre-launch cutover.

Every independent SDKWork git repository root and every independent SDKWork application root `MUST`
use the following reserved top-level directory names when the corresponding capability exists:

```text
<project-root>/
  apis/
  apps/
  crates/
  sdks/
  jobs/
  tools/
  plugins/
  examples/
  etc/
  deployments/
  scripts/
  docs/
  tests/
```

The dictionary governs authored capabilities. Native ignored output such as `node_modules/`, Cargo
`target/`, Vite `node_modules/.vite/`, Flutter `.dart_tool/`, Gradle `build/`, package-local `dist/`,
and coverage output remains owned by the corresponding tool and is not an authored capability.
Generated state `MUST NOT` introduce a parallel generic namespace. Repository-root,
application-root, and nested source-module `.runtime/` directories are forbidden. Generic `.tmp/`
or `.cache/` directories are allowed only inside an explicitly governed workspace-metadata or
tool-native boundary such as `.sdkwork/tmp/` or `node_modules/.cache/`.

New independent repository and application templates `MUST` create the full directory dictionary
with `README.md` placeholders or tracked content. Narrow-purpose roots `MAY` omit inactive
capability directories only when the root README or a linked root-layout document lists the active
capabilities and intentionally absent standard directories.

Directory meanings:

| Directory | Purpose | Required when |
| --- | --- | --- |
| `apis/` | Author-owned API contracts and API source inputs for all API kinds, including HTTP OpenAPI surfaces, RPC/proto contracts, async/event API manifests, API examples, API changelogs, and API validation inputs | The repository or application defines, owns, reviews, or materializes any API contract |
| `apps/` | Collection of independently runnable application roots, application surfaces, app shells, demos promoted to runnable apps, or deployable application compositions; each direct child is a selected language/architecture application root; `apps/README.md` is the human directory index for every child application root | Every independent SDKWork application git repository; also when the repository contains more than one app root, an app surface below a larger workspace, or runnable app examples |
| `crates/` | Rust crates, including route crates, service crates, repository crates, service-host/native-host/Tauri-host/gateway/worker crates, migration-only API server crates, and reusable Rust libraries | Rust source is authored in the repository or application |
| `sdks/` | SDK family workspaces, SDK generation manifests, authority OpenAPI materialization outputs, derived `sdkgen` inputs, generated SDK language workspaces, and SDK component specs | The repository or application owns or generates SDK families |
| `jobs/` | Job definitions, schedules, queue bindings, batch descriptors, maintenance runbooks, and non-Rust job packages | Non-request/response jobs are scheduled, configured, operated, or packaged |
| `tools/` | Developer, validation, generation, migration, and operator tools that are not shipped as app runtime code | Repository-local reusable tooling is authored |
| `plugins/` | Application/runtime plugin source packages, marketplace plugin implementations, or extension packages | Application or runtime plugins are authored |
| `examples/` | Runnable examples, integration examples, sample configs, and SDK/API usage examples | Examples are needed for consumers or verification |
| `etc/` | Source-controlled safe deployment/runtime profiles, browser bootstrap inputs, service/gateway templates, and secret-file references per `SOURCE_CONFIG_SPEC.md` | The root is independently deployable or owns deployable configuration |
| `deployments/` | Infrastructure descriptors, packaging handoff files, installers, rollout/rollback assets, and deployment documentation | The repository ships, deploys, or documents deployable artifacts |
| `scripts/` | Thin command entrypoints for build, verification, generation, migration, packaging, and release workflows | Shell/Node/Python/PowerShell command wrappers are needed |
| `docs/` | Repository/application documentation layout, Canon product PRD, technical architecture, requirements, architecture decisions, guides, runbooks, changelogs, and user/developer docs | Documentation is authored beyond root README files |
| `tests/` | Cross-package tests, contract tests, integration tests, end-to-end tests, fixtures, and static verification inputs | Verification exists outside package-local test directories |

### 1.1.3 Read-Only Upstream Source Roots

`external/`, `third_party/`, and `vendor/` are optional upstream-source exceptions to the authored-capability dictionary above. They are not alternative names for SDKWork-owned `packages/`, `crates/`, `sdks/`, or `tools/`.

Rules:

- These roots `MAY` contain a pinned upstream checkout, submodule, subtree, or release source snapshot when direct source consumption is required.
- Their contents `MUST` remain unchanged from the recorded upstream revision. SDKWork-authored adapters, patches, tests, manifests, generated files, and runtime state belong outside the upstream tree.
- SDKWork component specs are not required inside an unmodified upstream tree. The consuming SDKWork adapter or owning integration module `MUST` carry the local contract and verification evidence.
- Repository layout, code-style, naming, and authored-source validators `MUST` exclude these trees from SDKWork-authored source enforcement. Dependency, license, provenance, immutability, and packaging validators `MUST` still inspect the evidence required by `DEPENDENCY_MANAGEMENT_SPEC.md` and `SUPPLY_CHAIN_SECURITY_SPEC.md`.
- An upstream source root `MUST NOT` be used for user-private data, provider runtime databases, caches, logs, temporary files, or SDKWork build output.

Recommended initial skeleton:

```text
<project-root>/
  apis/
    README.md
    open-api/<domain>/
      openapi.yaml
      routes/
      schemas/
      examples/
      changelogs/
      tests/
    app-api/<domain>/
      openapi.yaml
      routes/
      schemas/
      examples/
      changelogs/
      tests/
    backend-api/<domain>/
      openapi.yaml
      routes/
      schemas/
      examples/
      changelogs/
      tests/
    rpc/
    async/
    internal/
    examples/
    changelogs/
    tests/
  apps/
    README.md
    sdkwork-<application-code>-pc/
      README.md
      sdkwork.app.config.json
      src/ | lib/ | App/ | entry/        # selected architecture standard owns this level
      packages/                         # only when that architecture standard requires it
      config/                           # only when that architecture standard requires it
  crates/
    README.md
    sdkwork-routes-<capability>-<surface>/
    sdkwork-<domain>-<capability>-service/
    sdkwork-<domain>-<capability>-repository-sqlx/
    sdkwork-<application-code>-service-host/
    sdkwork-<application-code>-native-host/
    sdkwork-<application-code>-tauri-host/
    sdkwork-<domain>-<capability>-worker/
    sdkwork-api-<application-code>-assembly/
    sdkwork-api-<application-code>-standalone-gateway/
  sdks/
    README.md
    sdkwork-<domain>-sdk/
    sdkwork-<domain>-app-sdk/
    sdkwork-<domain>-backend-sdk/
  database/
    README.md
    database.manifest.json
    contract/
      schema.yaml
      prefix-registry.json
      table-registry.json
    ddl/
      baseline/
        postgres/
      generated/
    migrations/
      postgres/
    seeds/
      seed.manifest.json
      common/
      locales/
        zh-CN/
        en-US/
        ja-JP/
        de-DE/
        fr-FR/
        ru-RU/
        ko-KR/
    drift/
      policy.yaml
    fixtures/
  jobs/
    README.md
    schedules/
    queues/
    batches/
    runbooks/
    packages/
  tools/
    README.md
    validators/
    generators/
    migrations/
    operators/
  plugins/
    README.md
    <plugin-name>/
      README.md
      specs/component.spec.json
      src/
      tests/
  examples/
    README.md
  etc/
    README.md
    sdkwork.deployment.config.json
    deployments/
  deployments/
    README.md
    docker/
    k8s/
    systemd/
    nginx/
    runbooks/
  scripts/
    README.md
  docs/
    README.md
    INDEX.yaml
    product/
      README.md
    prd/
      README.md
      PRD.md
    requirements/
        README.md
      roadmap/
        README.md
    architecture/
      README.md
    tech/
      README.md
      TECH_ARCHITECTURE.md
    decisions/
        README.md
      views/
        README.md
    engineering/
      README.md
      plans/
        README.md
      reviews/
        README.md
    guides/
      README.md
      developer/
        README.md
      operator/
        README.md
      integrator/
        README.md
    runbooks/
      README.md
    changelogs/
      README.md
    migrations/
      README.md
    releases/
      README.md
    domains/
      README.md
    archive/
      README.md
  tests/
    README.md
    contract/
    integration/
    e2e/
    fixtures/
    static/
```

Each standard top-level directory README `MUST` include:

- Purpose.
- Owner.
- Allowed content.
- Forbidden content.
- Related specs.
- Verification command or checklist.

Capability activation signals:

| Directory | Active when |
| --- | --- |
| `apis/` | An OpenAPI document, proto file, AsyncAPI/event manifest, route authority source, API example, API changelog, or API validation fixture exists |
| `apps/` | More than one app surface exists, an app surface lives below a larger workspace, or runnable demos/app shells are part of the repository |
| `crates/` | A Cargo workspace member or Rust source crate is authored |
| `sdks/` | A SDK family is owned, generated, assembled, inspected, or published |
| `database/` | A relational database lifecycle module is owned: contract, migrations, seeds, drift policy, or bootstrap assets |
| `jobs/` | A cron schedule, queue consumer binding, batch job, maintenance task, or job runbook is owned |
| `tools/` | Reusable validators, generators, migration tools, parsers, CLIs, or operator utilities are authored |
| `plugins/` | Application/runtime installable extension source is authored |
| `examples/` | Consumer-facing runnable or copyable examples are maintained |
| `etc/` | A deployable root owns safe runtime/deployment profiles, browser bootstrap inputs, or service/gateway templates |
| `deployments/` | Docker, Kubernetes, systemd, nginx, installer, release handoff, rollout/rollback, or deployment runbook content is owned |
| `scripts/` | Thin shell/Node/Python/PowerShell entrypoints are committed |
| `docs/` | Canon PRD, technical architecture, requirements, ADRs, guides, runbooks, changelogs, migrations, releases, domain extensions, or archives are authored |
| `tests/` | Cross-package, contract, integration, end-to-end, fixture, or static verification content exists |

Documentation boundary rules:

- `docs/product/prd/PRD.md` and `docs/architecture/tech/TECH_ARCHITECTURE.md` are the fixed Canon entrypoints defined by `DOCUMENTATION_SPEC.md`.
- Architecture decision records belong in `docs/architecture/decisions/`, not `docs/adr/`.
- Machine contracts belong in `specs/`, `apis/`, and manifests; `docs/` must not become the only source of truth for those contracts.

Boundary rules:

- When a reserved capability is active, the matching directory `MUST` be represented by tracked
  source or a tracked placeholder such as `README.md` or `.gitkeep`.
- Active capabilities `MUST NOT` use competing top-level names such as `api/`, `sdk/`, `package/`,
  `packages/`, `config/`, `deploy/`, `deployment/`, or `tooling/` as generic project-root
  replacements.
- `apis/` is the canonical source directory for API contracts and API materialization inputs. It is
  not an implementation package root and it is not generated SDK output.
- `sdks/` remains the SDK family and generation workspace governed by
  `SDK_WORKSPACE_GENERATION_SPEC.md`. `apis/` may feed `sdks/`, but `apis/` must not contain
  generated transport packages, generated SDK control-plane `.sdkwork/` files, or SDK family
  directories.
- `database/` is the canonical source directory for application database lifecycle assets governed
  by `DATABASE_FRAMEWORK_SPEC.md`. It stores contracts, migrations, seeds, drift policy, and
  bootstrap fixtures. SQLx repository implementations remain in
  `crates/sdkwork-<domain>-<capability>-repository-sqlx/`; crate-local `migrations/` directories
  are legacy and must converge into `database/migrations/` during adoption.
- A single-application repository may make the repository root the primary app root. Its `apps/`
  directory still `MUST` exist with `apps/README.md` explaining that the repository root is the
  primary app surface and indexing any secondary app surfaces, shells, or demos.
- Every independent SDKWork application git repository `MUST` keep `apps/README.md` as the human
  directory index for application roots under `apps/`. The index `MUST` list every direct child
  directory, identify each surface role and whether it is runnable, and link to the child root
  `README.md` when that child exists. Content rules are defined in `DOCUMENTATION_SPEC.md` section 3.3.
- `jobs/` owns schedules, queue bindings, batch descriptors, job definitions, maintenance runbooks,
  and non-Rust job packages. Rust worker implementations belong in
  `crates/sdkwork-<domain>-<capability>-worker/`; `jobs/` may reference those crates but must not
  duplicate their implementation.
- `scripts/` contains thin command entrypoints. Public `package.json#scripts`
  names follow `PNPM_SCRIPT_SPEC.md`; application-specific runner file names may
  remain internal implementation details only. Reusable logic, parsers,
  generators, validators, CLIs, and operator utilities belong in `tools/` or
  in a proper package/crate.
- `plugins/` stores application/runtime plugin source. Repository/application agent plugins remain
  under `.sdkwork/plugins/` and follow this standard's plugin workspace rules.
- `etc/` stores source-controlled safe deployment/runtime profiles and templates according to
  `SOURCE_CONFIG_SPEC.md`. Every independently deployable root owns its own `etc/`; reusable
  libraries, SDKs, and embedded-only modules do not duplicate parent configuration.
- `deployments/` stores infrastructure descriptors, release handoff files, installers, rollout,
  rollback, and deployment runbooks. Runtime value authority remains in `etc/`.
- Repository-root `configs/` is retired. Migration tooling may read it only as a temporary fallback
  and must move runtime config to `etc/`, infrastructure to `deployments/`, and schemas to `specs/`.
- Root `tests/` stores cross-package, contract, integration, end-to-end, fixture, and static
  verification content. Package-local unit tests stay beside the package/crate/module they verify.
  Fixtures must not contain real secrets, tokens, private customer data, or runtime state.
- Top-level `config/` is allowed only as an architecture-local directory when the repository root is
  itself the selected app surface root and that architecture standard requires `config/`. Otherwise
  project-root deployable config content belongs in `etc/`.
- Top-level `packages/` is allowed only for a dedicated shared package-family repository whose root
  README declares `repository-kind: shared-package-family`. Application git repositories that own
  `apps/sdkwork-<application-code>-*` roots or application-line `apis/`, `crates/`, or `sdks/`
  `MUST NOT` keep repository-root `packages/`. Package families belong under
  `apps/sdkwork-<application-code>-common/packages/` or
  `apps/sdkwork-<application-code>-<client-arch>/packages/`.

Standard root examples:

```text
<single-surface-app-repository>/
  AGENTS.md
  sdkwork.app.config.json
  .sdkwork/
  apis/
  apps/
    README.md
    sdkwork-<application-code>-pc/
      README.md
      sdkwork.app.config.json
      packages/
      src/
      config/
  crates/
  sdks/
  jobs/
  tools/
  plugins/
  examples/
  etc/
  deployments/
  scripts/
  docs/
  tests/
```

```text
<multi-surface-app-repository>/
  AGENTS.md
  sdkwork.app.config.json
  .sdkwork/
  apis/app-api/<domain>/openapi.yaml
  apps/
    README.md                 # directory index for every application root below apps/
    sdkwork-<application-code>-common/
      README.md
      AGENTS.md
      .sdkwork/
      specs/
      packages/
    sdkwork-<application-code>-pc/
      sdkwork.app.config.json
      packages/
      config/
    sdkwork-<application-code>-h5/
      sdkwork.app.config.json
      packages/
      config/
  crates/
  sdks/
  jobs/
  tools/
  plugins/
  examples/
  etc/
  deployments/
  scripts/
  docs/
  tests/
```

```text
<domain-multi-surface-repository>/
  AGENTS.md
  .sdkwork/
  apis/
  apps/
    README.md
    sdkwork-<application-code>-common/packages/   # cross-architecture contracts, runtime, service, RPC proto
    sdkwork-<application-code>-pc/packages/       # PC React capability packages
    sdkwork-<application-code>-h5/packages/       # H5/mobile React capability packages
    sdkwork-<application-code>-flutter-mobile/packages/
  crates/
  sdks/
  jobs/
  tools/
  plugins/
  examples/
  etc/
  deployments/
  scripts/
  docs/
  tests/
```

Rules for `<domain-multi-surface-repository>`:

- Repository-root `packages/` `MUST NOT` exist after migration cutover for `application` repositories.
- Cross-architecture TypeScript and domain RPC proto packages `MUST` live under
  `apps/sdkwork-<application-code>-common/packages/`.
- Client-architecture UI and host packages `MUST` live under
  `apps/sdkwork-<application-code>-<client-arch>/packages/`.
- Legacy repository-root families such as `packages/common/<domain>/`, `packages/pc-react/<domain>/`,
  and `packages/mobile-react/<domain>/` are migration-only paths. New work `MUST NOT` add them.
- Each direct child under `apps/` `MUST` be an application root with its own `README.md`, `AGENTS.md`,
  `.sdkwork/`, and `specs/component.spec.json` when the root owns authored packages.
- The `-common` application root is not a runnable client surface. It owns shared package families
  consumed by every client architecture root for the same `<application-code>`.

```text
<rust-backend-or-local-service-repository>/
  AGENTS.md
  .sdkwork/
  apis/app-api/<domain>/openapi.yaml
  crates/sdkwork-routes-<capability>-app-api/
  crates/sdkwork-<domain>-<capability>-service/
  crates/sdkwork-<domain>-<capability>-repository-sqlx/
  crates/sdkwork-api-<application-code>-assembly/
  crates/sdkwork-api-<application-code>-standalone-gateway/
  crates/sdkwork-<application-code>-service-host/
  crates/sdkwork-<domain>-<capability>-worker/
  sdks/sdkwork-<domain>-app-sdk/
  jobs/schedules/
  tools/
  etc/
  deployments/
  scripts/
  docs/
  tests/
```

## 2. Required Workspace Shape

Every git repository root and every SDKWork application root `MUST` have:

```text
<repo-or-application-root>/
  AGENTS.md
  CLAUDE.md                 # compatibility shim to AGENTS.md when Claude Code is supported
  GEMINI.md                 # compatibility shim to AGENTS.md when Gemini CLI is supported
  CODEX.md                  # compatibility shim to AGENTS.md when Codex-specific entry is supported
  .sdkwork/
    README.md
    .gitignore
    skills/
      README.md
      <skill-name>/
        SKILL.md
        references/        # optional
        scripts/           # optional
        assets/            # optional
    plugins/
      README.md
      <plugin-name>/
        .codex-plugin/
          plugin.json
        skills/            # optional
        mcp/               # optional
        apps/              # optional
        scripts/           # optional
    manifests/             # optional
    local/                 # ignored when present
    tmp/                   # ignored when present
    cache/                 # ignored when present
    secrets/               # ignored when present
```

Rules:

- The application-root `database/` dictionary shown above is the PostgreSQL `authoritative-server` layout from `DATABASE_FRAMEWORK_SPEC.md`. SQLite assets do not appear beside it; a client/native module with declared local persistence owns its separate role-specific `database/` dictionary.
- `AGENTS.md` `MUST` follow `AGENTS_SPEC.md`, cite `SOUL.md`, and declare the relative path to root `sdkwork-specs/README.md`.
- Tool compatibility shims such as `CLAUDE.md`, `GEMINI.md`, and `CODEX.md`, when present, `MUST` point to `AGENTS.md`; they must not copy or override root standards.
- `.sdkwork/README.md` `MUST` explain the workspace purpose, owner, and which directories are authoritative.
- `.sdkwork/skills/README.md` `MUST` explain how to add repository/application skills.
- `.sdkwork/plugins/README.md` `MUST` explain how to add repository/application plugins.
- `.sdkwork/.gitignore` `MUST` ignore local-only state when those paths may be created.
- `.sdkwork/skills/` and `.sdkwork/plugins/` `MUST` be committed or otherwise represented by tracked files.
- A monorepo root `.sdkwork/` contains shared repository skills/plugins. An application root inside that monorepo still needs its own `.sdkwork/` when it is independently built, distributed, launched, or represented by `sdkwork.app.config.json`.
- Application-root `.sdkwork/` may reference repository-root skills/plugins, but it must not rely on user-global skills as its only project knowledge.

## 3. Skills Directory

`.sdkwork/skills/` stores reusable agent/operator workflows for the repository or application.

Skill directory shape:

```text
.sdkwork/skills/<skill-name>/
  SKILL.md
  references/
  scripts/
  assets/
```

Rules:

- `<skill-name>` `MUST` be lowercase kebab-case.
- A real skill `MUST` have `SKILL.md` as its entrypoint.
- `SKILL.md` `MUST` state when to use the skill, what inputs it expects, what files or commands it may touch, and which root specs it follows.
- Common skills should cite canonical specs instead of copying them. For example, an SDK generation skill cites `SDK_SPEC.md` and `SDK_WORKSPACE_GENERATION_SPEC.md`.
- Skills may include scripts only when the scripts are deterministic, documented, and safe to run from the declared root.
- Skills may include references or assets only when they are needed by the skill workflow.
- Skills `MUST NOT` store application/runtime source code, generated SDK output, runtime data, secrets, API keys, auth tokens, private certificates, local credentials, provider account IDs, or user-private files.
- Skills `MUST NOT` weaken root specs, bypass SDK generation standards, replace generated SDK clients with raw HTTP, or redefine API/security/runtime rules.

Recommended common skill categories:

- API route and OpenAPI materialization.
- SDK generation and generated-client verification.
- Appbase IAM integration checks.
- Repository/component standards inventory.
- Release and deployment readiness checks.
- Security, privacy, and observability review workflows.

## 4. Plugins Directory

`.sdkwork/plugins/` stores repository/application-local agent extensions and plugin bundles.

Plugin directory shape:

```text
.sdkwork/plugins/<plugin-name>/
  .codex-plugin/
    plugin.json
  skills/
  mcp/
  apps/
  scripts/
```

Rules:

- `<plugin-name>` `MUST` be lowercase kebab-case.
- Installable plugins `MUST` declare `.codex-plugin/plugin.json`.
- Plugin manifests `MUST` identify the plugin name, version, owner, description, and contributed skills/tools/apps when the plugin framework supports those fields.
- Plugin skills follow the same rules as `.sdkwork/skills/`.
- Plugins may contain MCP server definitions, app definitions, scripts, or bundled assets only when they are repository/application-specific and documented.
- Plugins `MUST NOT` vendor unrelated external toolchains, generated SDK outputs, secrets, runtime databases, caches, logs, or user-private data.
- A plugin that wraps build, SDK generation, or deployment commands `MUST` call the canonical commands defined by the relevant specs. It must not silently substitute local stubs or incompatible generators.

## 5. Optional Workspace Manifests

Repositories may add machine-readable manifests under `.sdkwork/manifests/` when tooling needs them.

Recommended workspace manifest shape:

```json
{
  "schemaVersion": 1,
  "kind": "sdkwork.workspace",
  "rootType": "repository",
  "name": "sdkwork-example",
  "applicationCode": null,
  "skillsDir": ".sdkwork/skills",
  "pluginsDir": ".sdkwork/plugins",
  "canonicalSpecs": ["specs/README.md"]
}
```

Rules:

- `kind` `MUST` be `sdkwork.workspace`.
- `rootType` `MUST` be `repository` or `application`.
- `canonicalSpecs` should include the repository/application relative path to the root standards entrypoint, such as `../sdkwork-specs/README.md`, when the workspace follows central SDKWork standards.
- `skillsDir` and `pluginsDir` `MUST` point to the required local directories.
- Optional manifests must not become a second source of truth for API, SDK, database, security, runtime, or component contracts.
- Optional manifests `MUST NOT` redeclare SDKWork source dependency paths. Those paths remain owned by `pnpm-workspace.yaml`, root `Cargo.toml`, and root `pubspec.yaml` as defined in `DEPENDENCY_MANAGEMENT_SPEC.md`.

## 5.1 Multi-Repository Workspace Layout

When a SDKWork application consumes multiple SDKWork git repositories as siblings, the consuming repository's build-tool workspace root is the canonical place to declare those paths.

Recommended multi-repository layout:

```text
<sdkwork-workspace-root>/
  sdkwork-app/                       # application root = workspace root
    pnpm-workspace.yaml              # packages + catalog (SDKWork source)
    Cargo.toml                       # [workspace.dependencies] (SDKWork source)
    package.json
  sdkwork-appbase/                   # sibling SDKWork repository
  sdkwork-core/                      # sibling SDKWork repository
  sdkwork-ui/                        # sibling SDKWork repository
  sdkwork-rtc/                       # sibling SDKWork repository
```

Rules:

- The consuming application root `MUST` own a single `pnpm-workspace.yaml` and/or a single root `Cargo.toml`. The pnpm workspace and the Cargo workspace are aligned by relative path; do not create separate pnpm workspaces that overlap.
- Each sibling SDKWork source path `MUST` be declared exactly once at the consuming workspace root.
- Local development resolves these paths from sibling checkouts. Release/CI resolves them from the framework checkout (see `DEPENDENCY_MANAGEMENT_SPEC.md` §5) without changing consumer `package.json` / `Cargo.toml` files.
- The layout `SHOULD` be documented in the application root `README.md` and `sdkwork.app.config.json` when present, listing the expected sibling SDKWork repositories.

## 5.2 Multi-Repository Checkout Root vs Repository Workspace

SDKWork commonly uses a sibling checkout layout where many git repositories live under one local directory such as `sdkwork-space/`. That checkout root is not a substitute for repository workspaces.

Rules:

- `<multi-repo-checkout-root>/` `MAY` host governance files such as `configs/dependency-catalog.yaml`, shared verification scripts, and `sdkwork-specs/`.
- `<multi-repo-checkout-root>/pnpm-workspace.yaml` `MUST NOT` enumerate application packages from child git repositories. If present, it `MUST` contain only governance/tooling packages local to the checkout root, or an empty `packages:` list.
- Developers `MUST` run install, dev, build, test, and verify commands from the target git repository root unless a documented governance script explicitly says otherwise.
- Each child git repository `MUST` remain independently cloneable and buildable with its own repository-root workspace manifest and lockfile.
- Sibling source paths `MUST` be declared in the consuming repository root, not in the checkout root.

## 6. Source Control And Security

Rules:

- `.sdkwork/README.md`, `.sdkwork/skills/README.md`, `.sdkwork/plugins/README.md`, approved skills, approved plugins, and optional non-secret manifests should be committed.
- `.sdkwork/local/`, `.sdkwork/tmp/`, `.sdkwork/cache/`, `.sdkwork/secrets/`, local install state, generated transient outputs, and any secret-bearing files `MUST` be ignored.
- Repository-local skills and plugins may reference private repository paths, but they `MUST NOT` embed private credentials or machine-specific absolute paths unless the path is a documented SDKWork canonical path.
- Any script under `.sdkwork/` that contacts external services `MUST` document the service, credential source, dry-run behavior when available, and verification command.
- Security reviews may scan `.sdkwork/` as source. Sensitive local state must never be placed there in committed form.
- Vendored upstream content under `external/` in any repository `MUST` be referenced as git submodules (gitlink, mode `160000`), never committed as regular files. Every path registered in `.gitmodules` `MUST` be a gitlink in the current index. Allowed tracked content under `external/` is limited to the `external/README.md` marker and documented exceptions. Repositories with `external/` submodules `MUST` keep them shallow (`git submodule update --depth 1`) and `MUST` configure `fetch.recurseSubmodules=false` and `push.recurseSubmodules=false` so full upstream history is never pulled into `.git/modules`. Enforcement: `node sdkwork-specs/tools/check-external-submodule-rule.mjs --workspace <workspace-root>`.

## 7. Discovery And Precedence

Recommended discovery order:

1. Nearest `AGENTS.md`.
2. Current application root `sdkwork.app.config.json` when present.
3. Nearest module `specs/` when the task touches an authored module.
4. Current repository/application root `specs/` when the task is repository-wide or application-wide.
5. Current application root `.sdkwork/`.
6. Enclosing git repository root `AGENTS.md` and `.sdkwork/`.
7. Global `sdkwork-specs/` standards referenced by relative path.
8. User-global skills or plugins.

Rules:

- `AGENTS.md` provides the first execution index, but it must not duplicate or override global specs.
- Closer `.sdkwork/` content may add application-specific guidance, but it must not contradict repository-root specs or global `sdkwork-specs` standards.
- Module-local `specs/` define integration boundaries for one module; repository/application root `specs/` define cross-module machine contracts. Neither layer replaces global standards.
- If two skills have the same name, the application-local skill may specialize the repository skill only when it explicitly cites the repository skill or canonical specs it extends.
- User-global skills and plugins are optional conveniences. They cannot replace the checked-in repository/application `.sdkwork/` standard content.

## 8. Verification

Repository/application workspace verification `MUST` check:

- Every git repository root has `AGENTS.md`.
- Every SDKWork application root has `AGENTS.md`.
- `AGENTS.md` resolves the relative path to `sdkwork-specs/README.md`, `SOUL.md`, and `AGENTS_SPEC.md`.
- Tool compatibility shims such as `CLAUDE.md`, `GEMINI.md`, and `CODEX.md`, when present, resolve the same-root `AGENTS.md` and the relative path to `sdkwork-specs/README.md`.
- Every git repository root has `.sdkwork/`, `.sdkwork/skills/`, and `.sdkwork/plugins/`.
- Every application root has `.sdkwork/`, `.sdkwork/skills/`, and `.sdkwork/plugins/`.
- Required directories are represented by tracked files such as `README.md` when they are otherwise empty.
- Real skills have `.sdkwork/skills/<skill-name>/SKILL.md`.
- Installable plugins have `.sdkwork/plugins/<plugin-name>/.codex-plugin/plugin.json`.
- `.sdkwork/` does not contain obvious secret-bearing files, runtime database files, generated SDK transport outputs, or `sdkgen` generated control-plane reports outside generated SDK output.
- Repository/application `.gitignore` files `MUST` ignore root and nested `.runtime/` as defense
  against accidental commits. The workspace layout validator inspects the filesystem directly and
  `MUST` still report any physical `.runtime/` directory.
- Generated SDK output `.sdkwork/sdkwork-generator-*.json` remains under generated SDK output and is not treated as a repository/application workspace.
- Runtime `~/.sdkwork/<application-code>` directories are not copied into source.
- Multi-repository SDKWork source dependency paths are declared only in `pnpm-workspace.yaml packages:`, root `Cargo.toml [workspace.dependencies]`, or root `pubspec.yaml dependency_overrides`; member packages do not redeclare sibling source paths.
- Optional `external/`, `third_party/`, and `vendor/` roots are treated as read-only upstream source, remain unchanged from their pinned revisions, and receive no SDKWork-authored files or runtime state.
- `.sdkwork/manifests/*.json` does not contain SDKWork source dependency paths when native build-tool workspace roots are the declared source of truth.
- Active top-level capabilities use the reserved project root directory names from section 1.1. Competing top-level names such as `api/`, `sdk/`, `package/`, `deploy/`, `deployment/`, or `tooling/` are rejected. Repository-root `packages/` is rejected for application repositories per section 1.1; architecture-local `config/` remains allowed only under `apps/sdkwork-<application-code>-<client-arch>/` or documented shared package-family exceptions.
- Full new repository/application templates contain the complete standard directory dictionary with tracked placeholders or content; narrow roots that omit inactive directories document the active layout in the root README.
- `apis/` and `sdks/` are not conflated: API contract sources and materialization inputs stay in `apis/` when authored there, while SDK family workspaces and generated SDK output stay in `sdks/`.
- `apis/` contains no generated SDK transport output, SDK family directories, implementation code, or generated SDK control-plane `.sdkwork/` files.
- `sdks/` is not used as the sole authored API source when the repository/application owns API contracts that require `apis/`.
- `jobs/` does not duplicate Rust worker implementation that belongs in `crates/sdkwork-<domain>-<capability>-worker/`.
- `scripts/` contains thin entrypoints only; reusable logic lives in `tools/` or an appropriate package/crate.
- `plugins/` application/runtime source and `.sdkwork/plugins/` agent plugin workspaces are distinct.
- `etc/`, `deployments/`, and any architecture-local `config/` contain no live secrets, local overrides, user-private runtime config, or runtime state.
- Root `tests/` contains cross-package/contract/integration/e2e/static verification and safe fixtures, while package-local unit tests remain package-local.
- Application git repositories `MUST` pass `node ../sdkwork-specs/tools/check-workspace-packages-layout.mjs --root .` or the workspace sweep equivalent.
- Every maintained repository/application root `MUST` pass `node ../sdkwork-specs/tools/check-workspace-layout.mjs --root .` or the workspace sweep equivalent.
- Repository/application README files link to specs and contracts; README prose is not treated as normative standards authority.
- `docs/adr/` is a retired layout. New ADRs `MUST` use `docs/architecture/decisions/`.

## 9. Acceptance Checklist

- [ ] Git repository root has `AGENTS.md` that follows `AGENTS_SPEC.md`.
- [ ] Git repository root has tool compatibility shims, such as `CLAUDE.md`, `GEMINI.md`, or `CODEX.md`, when those tool entrypoints are required.
- [ ] Git repository root has `.sdkwork/README.md`.
- [ ] Git repository root has `.sdkwork/skills/README.md`.
- [ ] Git repository root has `.sdkwork/plugins/README.md`.
- [ ] Each application root has its own `AGENTS.md`, `.sdkwork/README.md`, `.sdkwork/skills/README.md`, and `.sdkwork/plugins/README.md`.
- [ ] Each tool-compatible application root has shim files such as `CLAUDE.md`, `GEMINI.md`, or `CODEX.md` pointing to its own `AGENTS.md`.
- [ ] `AGENTS.md` uses valid relative links to root `sdkwork-specs`.
- [ ] `.sdkwork/.gitignore` ignores local, temp, cache, and secret-bearing state.
- [ ] Repository/application skills have `SKILL.md` and cite the relevant root specs.
- [ ] Repository/application plugins have `.codex-plugin/plugin.json` when installable.
- [ ] `.sdkwork/` contains no secrets, runtime data, generated SDK transport output, or user-private files.
- [ ] Repository roots, application roots, and nested source modules contain no `.runtime/` or other generic generated-state namespace.
- [ ] Reproducible outputs use tool-native ignored directories; process and test temporary state follows `RUNTIME_DIRECTORY_SPEC.md` section 5.
- [ ] Generated SDK `.sdkwork/sdkwork-generator-*.json` files remain generator-owned and are not modified by repository workspace tooling.
- [ ] Runtime private paths still follow `RUNTIME_DIRECTORY_SPEC.md`.
- [ ] Optional `external/`, `third_party/`, and `vendor/` roots are read-only, pinned, free of SDKWork-authored files and runtime state, and consumed only through native build-tool declarations.
- [ ] New repository/application templates contain the complete standard project root dictionary with tracked placeholders or content.
- [ ] Narrow roots that omit inactive standard directories document the active layout in the root README.
- [ ] Independent application repositories have `apps/README.md` that indexes every direct child application root and states whether the repository root is the primary runnable app surface.
- [ ] Active SDKWork-authored repository/application capabilities use only the standard top-level directory names: `apis/`, `apps/`, `crates/`, `sdks/`, `jobs/`, `tools/`, `plugins/`, `examples/`, `etc/`, `deployments/`, `scripts/`, `docs/`, and `tests/`; optional `external/`, `third_party/`, and `vendor/` roots contain read-only upstream source only, while `config/` and `packages/` are used only as architecture-local directories for the selected app surface root.
- [ ] API contract sources, generated SDK workspaces, application/runtime plugins, agent plugins, source config templates, deployment descriptors, job definitions, worker implementations, and runtime private config are placed in their distinct standard directories.
- [ ] Active `docs/` layouts provide Canon `docs/product/prd/PRD.md` and `docs/architecture/tech/TECH_ARCHITECTURE.md`, and new ADRs use `docs/architecture/decisions/`.
- [ ] New repositories bootstrap `docs/` with `tools/bootstrap-repository-docs.mjs` or an equivalent tracked skeleton.
