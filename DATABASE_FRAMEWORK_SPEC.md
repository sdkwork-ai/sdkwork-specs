# SDKWork Database Framework Standard

- Version: 2.0
- Status: active
- Scope: application database lifecycle, standardized `database/` asset layout, migration and seed governance, schema drift observation, lifecycle SPI hosted in `sdkwork-database`, bootstrap and upgrade orchestration, locale-aware initialization data
- Related: `DATABASE_SPEC.md`, `DATABASE_SPEC_PROCESS_SHARED_POOL.md`, `SCHEMA_REGISTRY_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `MIGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `WEB_BACKEND_SPEC.md`, `API_SPEC.md`, `SECURITY_SPEC.md`, `OBSERVABILITY_SPEC.md`, `I18N_SPEC.md`, `TEST_SPEC.md`, `QUALITY_GATE_SPEC.md`, `RELEASE_SPEC.md`, `GOVERNANCE_SPEC.md`, `DOCUMENTATION_SPEC.md`
- Detail implementation profile: `../sdkwork-database/specs/DATABASE_FRAMEWORK_STANDARD.md` (L1 framework repository authoritative for crate APIs, SPI trait signatures, CLI commands, and verification harnesses)

This standard defines how SDKWork applications **build, initialize, upgrade, observe, and govern** relational databases. `DATABASE_SPEC.md` owns PostgreSQL-first authoritative server semantics, SQLite client-local boundaries, logical types, naming, indexes, tenant isolation, connection pools, and repository boundaries. This file owns **database lifecycle orchestration** and the role-specific **database asset dictionaries** that lifecycle consumes.

## 1. System Model

```text
sdkwork-specs (L0)
  DATABASE_SPEC.md            -> table/field/index semantics, pool rules
  DATABASE_FRAMEWORK_SPEC.md  -> lifecycle, directory, SPI, drift, seed locale
       -> narrows
sdkwork-database/specs/DATABASE_FRAMEWORK_STANDARD.md (L1 executable profile)
       -> enforced by
sdkwork-database crates (L2 runtime)
  sdkwork-database-spi          -> normative SPI traits and registry contracts
  sdkwork-database-history      -> ops history tables, checksum queries, migration/seed recording
  sdkwork-database-lifecycle    -> bootstrap / migrate / seed orchestration
  sdkwork-database-contract     -> contract parsing and expected schema model
  sdkwork-database-drift        -> expected-vs-actual diff engine
  sdkwork-database-ops          -> ops status/migrations/seeds read models
  sdkwork-database-ops-http       -> axum routes for /backend/v3/ops/database/*
  sdkwork-database-config       -> existing config types
  sdkwork-database-sqlx         -> existing pool implementation
  sdkwork-database-repository   -> existing repository layer (legacy migration manager deprecated)
  sdkwork-database-cli          -> validate / plan / init / migrate / seed / drift CLI
       -> extended by
application database modules (L3)
  database/ assets + optional SPI hooks
```

Rules:

- Every SDKWork application or backend service repository that owns a relational database `MUST` follow this standard for lifecycle assets and bootstrap behavior.
- Every database module `MUST` declare `databaseRole`. Server/application-root lifecycle modules use `authoritative-server` and PostgreSQL. Client/native modules use `client-local` and SQLite. One module `MUST NOT` claim both roles.
- Every baseline and migration tree `MUST` be engine-pure. Files under `ddl/baseline/postgres` or `migrations/postgres` may contain only PostgreSQL DDL and may be materialized only from PostgreSQL sources; SQLite trees follow the equivalent SQLite rule. Bootstrap and consolidation tools `MUST` fail closed when a source glob, include, or provenance marker crosses engine boundaries. Copying both dialects into one baseline is forbidden even when individual statements appear portable.
- Every physical table in a shared PostgreSQL schema `MUST` have exactly one application/module owner. Application roots `MUST` use an ownership-specific prefix declared consistently by `database.manifest.json#tablePrefix`, `contract/schema.yaml#table_prefix`, and `contract/prefix-registry.json`; broad domain prefixes such as `ai_` are forbidden when independent modules share the schema. A bootstrap `MUST` fail closed on an existing same-name table whose column/type contract does not match its owner contract. It `MUST NOT` mutate the foreign table into compatibility.
- Workspace lifecycle `MUST` run in the shared PostgreSQL database and schema selected by the active environment in `ENVIRONMENT_SPEC.md` section 7.1. Development uses `sdkwork_ai_dev`; tests use `sdkwork_ai_test` or workspace-scoped ephemeral `sdkwork_ai_test_<run_id>`; staging uses `sdkwork_ai_staging`; production uses `sdkwork_ai_prod`. Application-specific or module-specific databases and schemas such as `sdkwork_<application-code>_dev`, `<application_code>_test_<run_id>`, or `<module_id>_schema` are forbidden.
- Application baselines, migrations, seeds, bootstrap commands, test runners, and dev runners `MUST` manage only module-owned objects inside the already-provisioned shared schema for the active environment. They `MUST NOT` issue `CREATE DATABASE`, `DROP DATABASE`, `ALTER DATABASE`, `CREATE SCHEMA`, `DROP SCHEMA`, or `ALTER SCHEMA`, and they `MUST NOT` switch to a new database/schema after an ownership or drift failure.
- Lifecycle orchestration `MUST` pin each PostgreSQL migration, seed, bootstrap, history, and drift transaction to the canonical schema only. Unqualified object discovery and DDL `MUST NOT` fall through to `public` or another writable schema; extension-owned objects outside the canonical schema are schema-qualified.
- Table and column semantics `MUST` still follow `DATABASE_SPEC.md`. Lifecycle assets `MUST NOT` redefine naming or logical-type rules.
- All connection pools `MUST` still be created through `sdkwork-database` as defined in `DATABASE_SPEC.md` section 32.
- Every application ingress, internal service, or worker process `MUST` install one PostgreSQL process-local pool per normalized database identity before module lifecycle bootstrap. Embedded modules reuse that pool and do not own independent capacity. See `DATABASE_SPEC.md` section 33.5 and `DATABASE_SPEC_PROCESS_SHARED_POOL.md`.
- A temporary `sqlx::AnyPool` compatibility driver is fail-closed by default. When an approved process-pool contract and ADR declare the exception, `SDKWORK_DATABASE_TEMPORARY_ANY_POOL_EXCEPTION=true` permits the framework to install one identity-checked compatibility pool; every compatibility consumer reuses that handle until driver migration removes the exception.
- IM's current sqlx plus r2d2 bundle is migration infrastructure, not strict single-pool compliance. New adapters use the canonical process driver; remaining incompatible adapters require a governed temporary exception and removal milestone.
- Application-specific lifecycle behavior `MUST` extend the framework through SPI traits defined in `sdkwork-database-spi`. Applications `MUST NOT` fork lifecycle orchestration into ad-hoc installers unless an approved exception exists.
- The canonical database framework repository is `sdkwork-database`. Business repositories `MAY` ship `database/` assets and SPI implementations; they `MUST NOT` ship competing lifecycle engines.
- Java and other non-Rust runtimes `SHOULD` consume the same `database/` asset dictionary and manifest contracts. Their first-party reference implementation is Rust in `sdkwork-database`; parity tests `MUST` validate asset compatibility even when runtime orchestration differs.

## 2. Design Goals

| Goal | Requirement |
| --- | --- |
| Contract-first | Expected schema comes from `database/contract/` before migrations or ORM code |
| PostgreSQL-first | Authoritative server lifecycle, migrations, drift, release gates, and recovery use PostgreSQL without a SQLite feature ceiling |
| Role-explicit | PostgreSQL server assets and SQLite client-local assets have separate manifests, contracts, histories, tests, and owners |
| Upgrade-safe | Forward migrations are idempotent, tracked, checksum-verified, and release-gated |
| Initialization-safe | Seed data is locale-aware, profile-aware, idempotent, and auditable |
| Observable | Running services expose drift status through backend ops APIs |
| Extensible | Applications plug in through SPI instead of copying framework code |
| Standard-reducing | Default assets + default SPI adapters minimize custom code; extensions are explicit and bounded |
| Industry-aligned | Migration history, checksum, ordering, and drift semantics align with Flyway/Liquibase/Atlas practice without binding to one vendor tool |

## 3. Normative Levels

This document uses RFC-style terms:

| Term | Meaning |
| --- | --- |
| MUST | Mandatory. Non-compliance fails validation. |
| MUST NOT | Forbidden. |
| SHOULD | Strong recommendation. Deviations require documented rationale and exception when enforced by gates. |
| MAY | Optional capability. |

Compliance tiers:

| Tier | Name | Minimum requirement |
| --- | --- | --- |
| L1 | Lifecycle Ready | Standard `database/` layout, manifest, migrations, bootstrap via framework |
| L2 | Contract Governed | `contract/schema.yaml`, registry files, CI validate + migrate + seed smoke |
| L3 | Drift Observable | Drift engine, ops API, release drift gate, seed locale governance |

New authoritative server database work `MUST` reach L2 on PostgreSQL before production release. Platform, IAM, commerce, billing, and multi-tenant shared databases `SHOULD` reach L3. Client-local SQLite modules `MUST` meet the client-local contract and test gates in sections 5, 6, and 13 before client release.

## 4. Lifecycle Model

### 4.1 Phases

| Phase | Purpose | Primary inputs | Primary outputs |
| --- | --- | --- | --- |
| `design` | Define portable schema contract | domain requirements, `DATABASE_SPEC.md` | `contract/schema.yaml`, registries |
| `materialize` | Produce or validate DDL | contract, engine profile | `ddl/generated/`, CI diff |
| `bootstrap` | Create empty database state | baseline or first migration | empty schema at target version |
| `migrate` | Apply versioned schema changes | `migrations/{engine}/` | updated schema, history row |
| `seed` | Load initialization/reference data | `seeds/common`, `seeds/locales/{locale}` | seeded rows, seed history |
| `operate` | Serve application traffic | `sdkwork-database` pool | runtime queries |
| `observe` | Compare expected vs actual schema | contract + applied migrations + introspection | drift report |
| `govern` | Gate release and upgrades | drift/migration/seed evidence | pass/fail, audit trail |

### 4.2 Lifecycle State Machine

Applications `MUST` treat database state as explicit, not implicit:

```text
UNINITIALIZED
  -> BOOTSTRAPPED        (database reachable, no app schema)
  -> SCHEMA_CURRENT      (all required migrations applied)
  -> SEEDED              (required seed sets applied for selected locale/profile)
  -> OPERATIONAL         (service accepting traffic)
  -> DRIFT_DETECTED      (observed schema differs from expected)
  -> MIGRATING           (migration in progress)
  -> SEEDING             (seed in progress)
  -> FAILED              (migration/seed/bootstrap failed; service must not silently continue in prod)
```

Rules:

- Production services `MUST NOT` enter `OPERATIONAL` when lifecycle state is `FAILED`.
- `AUTO_MIGRATE=true` `MAY` be used in development and controlled staging. Production `SHOULD` use explicit migrate commands or installer orchestration with evidence.
- Seed execution `MUST` be separate from migration execution. Migrations define structure; seeds define initialization data.
- Drift detection `MUST NOT` mutate schema. Repair is a separate governed operation.

### 4.3 Startup Sequence

Default service bootstrap order:

1. Resolve the `authoritative-server` PostgreSQL config from env/TOML per `DATABASE_SPEC.md` section 33.2.
2. Create the PostgreSQL connection pool through `sdkwork-database-sqlx`.
3. Discover registered `DatabaseModule` SPI providers for the service.
4. Resolve lifecycle policy from `database/database.manifest.json` and runtime env.
5. If enabled, run pending migrations through lifecycle orchestrator.
6. If enabled and not yet seeded for target locale/profile, run seed pipeline.
7. Refresh drift snapshot or schedule background refresh.
8. Expose health and ops endpoints.

Applications with multiple bounded database modules `MAY` register multiple SPI modules. The orchestrator `MUST` execute them in manifest-declared order.

### 4.4 Embedded Dependency Auto-Discovery (Federated Hosts)

Applications that embed dependency surfaces (platform gateways, federated
assemblies) `MUST NOT` require hand-run SQL or per-module manual bootstrap
wiring to bring embedded database modules online. The host `MUST` implement
startup-sequence steps 3-6 through framework-driven discovery:

- Each enabled dependency surface declares its application root through
  `SDKWORK_<MODULE>_APP_ROOT` (workspace `sdkwork-course` ->
  `SDKWORK_COURSE_APP_ROOT`). Hosts resolve discovery inputs from these
  variables, never from a hardcoded module list.
- A surface root that ships no `database/database.manifest.json` is skipped
  (API-only dependency). A root that *declares* database assets but fails to
  load or parse `MUST` fail closed.
- The host `MUST` run lifecycle through `sdkwork-database-lifecycle`
  (`discover_database_modules` + `RegistryLifecycleOrchestrator` /
  per-module `LifecycleOrchestrator`) on the process-shared pool. Hosts
  `MUST NOT` import dependency-owned `*-database-host` crates to do this.
- Lifecycle policy comes from each module manifest plus the
  `SDKWORK_DATABASE_AUTO_MIGRATE` / `SDKWORK_DATABASE_SEED_ON_BOOT` /
  `SDKWORK_DATABASE_SEED_LOCALE` / `SDKWORK_DATABASE_SEED_PROFILE` env keys.
- Explicit migrate commands (e.g. `--migrate-databases` process mode,
  installer orchestration, container migrate-on-start) `MUST` migrate every
  discovered module regardless of `SDKWORK_DATABASE_AUTO_MIGRATE`: the
  explicit command is the authorization, the env key governs only implicit
  serve-time bootstrap.
- Any discovery or bootstrap failure `MUST` fail closed: the process `MUST`
  abort startup (serve mode) or exit non-zero (migrate mode) with a
  structured `ERROR` event naming the workspace, module id, and failure
  stage (`init` / `migrate` / `seed`). Silent continuation is forbidden.

### 4.5 Embedded Dependency Server-Error Surfacing

Hosts that proxy or compose embedded dependency routers `MUST` surface
dependency 5xx failures in host logs. When an embedded dependency returns a
server error, the host `MUST` emit a structured `ERROR` event containing at
minimum: method, path, status, and the problem-details envelope fields
(`code`, `detail`, `operationId`, `i18nKey`, `traceId`) when present. The
gateway access log's `status`/`failure_class` alone is not sufficient for
triage; failing to log the underlying cause defers incident triage to
manual container log archaeology and is a spec violation.

## 5. Application Directory Dictionary

### 5.1 Authoritative Server Layout

Every SDKWork application root or standalone backend service root that owns authoritative relational data `MUST` include:

**Ownership predicate.** A repository *owns* authoritative relational data only when it holds persistence assets of its own:

- a `database/` root; or
- an in-repository migration directory; or
- a persistence crate declared as a workspace member or a repository-local path dependency (for example `crates/sdkwork-account-repository-sqlx`).

A path dependency whose target escapes the repository (`../<sibling>-<module>/crates/<name>-repository-sqlx`) is **consumption** of another module's persistence crate. It `MUST NOT` be treated as ownership, and it `MUST NOT` cause the consuming repository to be required to declare `database/` or the `db:*` script surface. A repository that owns no authoritative relational data `MUST NOT` declare a `database/` root or the `db:*` script surface; its persistence needs are satisfied through the owning module's SDK or RPC facade.

Tools that enumerate database owners `MUST` derive ownership from this predicate rather than from a raw `repository-sqlx` substring match, which cannot distinguish ownership from consumption.

```text
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
tests/
  contract/
    database-framework.contract.test.*
```

Rules:

- `database/` is the only authoritative source for lifecycle assets. Crate-local `migrations/` directories `MUST` migrate into `database/migrations/` or be referenced through SPI asset locators during a compatibility window.
- `database/README.md` `MUST` document owner, `authoritative-server` role, PostgreSQL version/extension support, bootstrap commands, verification commands, related specs, and a `## Initialization state` section recording the `baselineStrategy`, the committed primary baseline path or the `migrations-only` bootstrap set, the ordered migration range, and the consolidation level defined in section 7.5.
- Authoritative `database/` roots `MUST NOT` contain `migrations/sqlite/` or `ddl/baseline/sqlite/`. SQLite assets belong to a client/native module under section 5.2.
- `fixtures/` is test-only. Production bootstrap `MUST NOT` read from `fixtures/`.
- Generated artifacts under `ddl/generated/` `MUST NOT` be hand-edited.

### 5.2 Client-Local SQLite Layout

A desktop, tablet, mobile, or native client module with a concrete local persistence requirement `MUST` own a separate client-local database root:

```text
<client-module>/
  database/
    README.md
    database.manifest.json
    contract/
      schema.yaml
    ddl/
      baseline/
        sqlite/
    migrations/
      sqlite/
    local-data-policy.yaml
    fixtures/
  tests/
    contract/
      client-local-database.contract.test.*
```

Rules:

- The client module manifest `MUST` declare `databaseRole: "client-local"`, `engines: ["sqlite"]`, and `defaultEngine: "sqlite"`.
- Client-local assets `MUST` be owned by the native/client persistence module that opens the SQLite file. They `MUST NOT` be placed in an authoritative server database root merely to claim engine parity.
- `local-data-policy.yaml` `MUST` declare data mode (`cache`, `offline-projection`, or `local-only`), profile/environment/origin/account isolation, authoritative source, sync contract reference when applicable, encryption/key storage, backup inclusion, retention, logout/account-switch purge, corruption recovery, disk-full behavior, and schema downgrade policy.
- `offline-projection` requires a versioned sync contract and tests for identity mapping, outbox/inbox idempotency, ordering, tombstones, conflicts, rejection, retry, and reconciliation.
- `local-only` data `MUST` name the device-local business boundary and prove that no shared server, cross-device, tenant, entitlement, billing, ledger, or audit authority depends on it.
- Client-local seeds, when needed, `MUST` be deterministic and local-role specific. They `MUST NOT` reuse the authoritative server seed history as if the physical schemas were interchangeable.

### 5.3 Optional Extensions

Applications `MAY` add bounded extensions when declared in `database.manifest.json`:

| Path | Use |
| --- | --- |
| `database/modules/{module-id}/` | Additional bounded database modules within one application root |
| `database/backfill/` | Resumable data backfill scripts separate from schema migrations |
| `database/reports/` | Generated drift or migration reports for CI artifacts |
| `database/tools/` | Thin wrappers only; reusable tooling belongs in repository `tools/` |

Extensions `MUST NOT` replace the core directories in section 5.1.

### 5.4 Workspace Integration

`SDKWORK_WORKSPACE_SPEC.md` `MUST` treat `database/` as a standard application-root directory alongside `apis/`, `sdks/`, `etc/`, and `deployments/`.

Repository verification `SHOULD` include a shared validator:

```bash
pnpm run db:validate
```

## 6. Manifest Contracts

### 6.1 `database.manifest.json`

Required manifest for lifecycle discovery:

```json
{
  "schemaVersion": 2,
  "kind": "sdkwork.database.module",
  "databaseRole": "authoritative-server",
  "moduleId": "forum",
  "serviceCode": "FORUM",
  "displayName": "Forum Database",
  "owner": "forum-platform",
  "engines": ["postgres"],
  "defaultEngine": "postgres",
  "tablePrefix": "forum_",
  "contractVersion": "1.4.0",
  "baselineStrategy": "migrations-only",
  "modules": [],
  "lifecycle": {
    "autoMigrate": false,
    "seedOnBoot": false,
    "defaultSeedLocale": "zh-CN",
    "defaultSeedProfile": "standard",
    "supportedSeedLocales": ["zh-CN", "en-US", "ja-JP", "de-DE", "fr-FR", "ru-RU", "ko-KR"],
    "activeSeedLocales": ["zh-CN"],
    "driftCheckIntervalSec": 60
  },
  "paths": {
    "contract": "contract/schema.yaml",
    "migrations": "migrations",
    "seeds": "seeds",
    "driftPolicy": "drift/policy.yaml"
  },
  "spi": {
    "provider": "default",
    "hooks": []
  }
}
```

Rules:

- `schemaVersion` `MUST` be `2` for new or migrated modules. Schema version 1 is an L0 migration input and requires the migration record defined by `MIGRATION_SPEC.md`.
- `databaseRole` `MUST` be `authoritative-server` for an application/service root or `client-local` for a native/client module root.
- An `authoritative-server` manifest `MUST` declare exactly `engines: ["postgres"]` and `defaultEngine: "postgres"`.
- A `client-local` manifest `MUST` declare exactly `engines: ["sqlite"]` and `defaultEngine: "sqlite"`; it `MUST` also declare `clientLocal.mode`, `clientLocal.scope`, and `clientLocal.authoritativeSource`, plus `clientLocal.syncContract` for `offline-projection`.
- `moduleId` `MUST` be stable, lowercase, kebab-case or snake_case, and unique within the application root.
- `serviceCode` identifies module ownership, lifecycle history, logs, and diagnostics. It `MUST NOT` create an environment-variable prefix or redefine database connection, schema, pool, migration, seed, or drift settings; those settings use only `SDKWORK_DATABASE_*` per `ENVIRONMENT_SPEC.md` section 7.1.
- `contractVersion` `MUST` be a valid semantic version aligned with `DATABASE_SPEC.md` section 22 and `MUST` exactly match `contract/schema.yaml#contract_version`.
- `lifecycle.autoMigrate` `MUST` be an explicit boolean. Authoritative PostgreSQL modules `MUST` default it to `false`; a production override to `true` requires a single elected migrator, advisory/lease coordination, a dedicated migrator role, bounded lock and statement timeouts, failure isolation, and accepted release evidence. Client-local SQLite modules `MAY` use `true` when migrations are atomic and interruption recovery is tested.
- `activeSeedLocales` controls which locale directories are eligible for execution. Directories for inactive locales `MUST` still exist once declared in `supportedSeedLocales`.
- `baselineStrategy` `MUST` be one of: `migrations-only`, `baseline-plus-migrations`, `baseline-only-dev`.
- `migrations-only` `MUST` provide at least one ordered `.up.sql` migration that can initialize an empty database; a baseline snapshot is optional and is not an alternate production bootstrap path.
- `baseline-plus-migrations` and `baseline-only-dev` `MUST` provide an engine-specific baseline SQL file. Post-baseline migrations may be empty until the contract evolves.
- `baseline-only-dev` `MUST NOT` be selected by a production, staging, upgrade, or release profile.
- An `authoritative-server` manifest `MUST` declare `lifecycle.activeSeedLocales` as a non-empty array.

Single-prefix, multi-prefix, and multi-module roots:

- A root that owns one prefix family `MUST` declare a non-empty `tablePrefix`. A root that owns several prefix families inside the same shared schema `MUST` declare `tablePrefixes` instead: a non-empty array of distinct, ownership-specific prefixes, where the first entry is the primary prefix.
- `tablePrefix` and `tablePrefixes` `MUST NOT` both be declared. A root that declares neither is not an ownership-scoped database root and does not satisfy this standard.
- The primary prefix (`tablePrefix`, or `tablePrefixes[0]`) `MUST` exactly equal `contract/schema.yaml#table_prefix`.
- `contract/prefix-registry.json` `MUST` list every declared prefix family with its owner; additional per-family attributes such as a domain label `MAY` be added. Declaring a prefix in the manifest without registering it is non-compliant.
- `modules` lists the module ids the root owns and `MUST` be `[]` when the root is a single-module root. A multi-module root `MUST` list every owned module id, and `serviceCode` identifies the primary module.
- The broad-domain prefix prohibition in section 1 still applies: a shared prefix family such as `ai_` is only compliant when one application owns every table that uses it.

Client-local manifest profile:

```json
{
  "schemaVersion": 2,
  "kind": "sdkwork.database.module",
  "databaseRole": "client-local",
  "moduleId": "forum-desktop-local",
  "serviceCode": "FORUM_DESKTOP_LOCAL",
  "displayName": "Forum Desktop Local Database",
  "owner": "forum-client",
  "engines": ["sqlite"],
  "defaultEngine": "sqlite",
  "contractVersion": "1.0.0",
  "baselineStrategy": "migrations-only",
  "clientLocal": {
    "mode": "offline-projection",
    "scope": "environment-profile-origin-account",
    "authoritativeSource": "forum-app-api",
    "syncContract": "specs/forum-offline-sync.spec.json"
  },
  "lifecycle": {
    "autoMigrate": true,
    "seedOnBoot": false
  },
  "paths": {
    "contract": "contract/schema.yaml",
    "migrations": "migrations",
    "localDataPolicy": "local-data-policy.yaml"
  }
}
```

### 6.2 `contract/schema.yaml`

The portable schema contract `MUST` declare:

```yaml
schema_version: 1
kind: sdkwork.database.schema
database_role: authoritative-server
module_id: forum
contract_version: 1.4.0
owner_team: forum-platform
compliance_level: L2
engines:
  - postgres
table_prefix: forum_
tables: []
```

Rules:

- `kind` and `schema_version` are required framework metadata.
- `database_role` `MUST` exactly match `database.manifest.json#databaseRole`.
- `engines` `MUST` contain only `postgres` for `authoritative-server` and only `sqlite` for `client-local`.
- `contract_version` `MUST` be a valid semantic version and `MUST` exactly match `database.manifest.json#contractVersion`.
- Table definitions `MUST` follow `DATABASE_SPEC.md` sections 4–21.
- Contract is the semantic source of truth. Migrations `MUST` implement contract evolution.

### 6.2.1 `organization_id` Column Contract

The framework checker enforces the `DATABASE_SPEC.md` §6.10 and DB089–DB093
rules on every authoritative baseline and migration:

- Every `organization_id` column definition in baseline DDL `MUST` declare
  `NOT NULL` together with the platform sentinel default:
  - `BIGINT`/`INTEGER` → `NOT NULL DEFAULT 0`
  - `TEXT`/`VARCHAR(n)` → `NOT NULL DEFAULT '0'`
  - `UUID` → `NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'`
- Nullable `organization_id` definitions (no `NOT NULL`) fail the module
  contract check, including columns added by `ALTER TABLE ... ADD COLUMN`.
- Column names that are different fields (`parent_organization_id`,
  `merchant_organization_id`, `definition_organization_id`, ...) are scoped
  by their own domain contract and are not covered by this rule.
- The check applies to every database module root's
  `ddl/baseline/<engine>/` SQL files. Multi-module databases
  (`database/modules/*`) are validated through their own module entrypoint
  (`--layout module`), which applies the same contract to their baselines.

### 6.3 Registry Files

`prefix-registry.json` and `table-registry.json` `MUST` list owned prefixes/tables, owner team, compliance level, and lifecycle status (`active`, `deprecated`, `legacy-compat`).

### 6.4 `seeds/seed.manifest.json`

```json
{
  "schemaVersion": 1,
  "kind": "sdkwork.database.seed",
  "i18nVersion": "1.0.0",
  "defaultLocale": "zh-CN",
  "fallbackLocale": "zh-CN",
  "supportedLocales": ["zh-CN", "en-US", "ja-JP", "de-DE", "fr-FR", "ru-RU", "ko-KR"],
  "activeLocales": ["zh-CN"],
  "localeSets": {
    "zh-CN": {
      "version": "1.0.0",
      "required": true,
      "checksum": "sha256:<checksum>",
      "files": ["locales/zh-CN/001_roles.sql", "locales/zh-CN/002_menus.sql"]
    }
  },
  "profiles": {
    "minimal": {
      "common": ["001_system_parameters.sql"],
      "locales": {
        "zh-CN": ["001_roles.sql", "002_menus.sql"]
      }
    },
    "standard": {
      "common": ["001_system_parameters.sql", "002_reference_codes.sql"],
      "locales": {
        "zh-CN": ["001_roles.sql", "002_menus.sql", "003_dictionary.sql"]
      }
    }
  }
}
```

Rules:

- Seed order is explicit in manifest arrays. Directory lexical order alone `MUST NOT` define execution order.
- Locale-specific content `MUST` live under `seeds/locales/{locale}/`.
- Language-neutral reference data `MUST` live under `seeds/common/`.
- A seed file `MUST NOT` mix multiple locales.
- Seed manifests that contain locale-specific data `MUST` declare `i18nVersion`, `defaultLocale`, `fallbackLocale`, `supportedLocales`, `activeLocales`, and `localeSets`.
- `activeLocales` `MUST` be a subset of `supportedLocales`; `defaultLocale` and `fallbackLocale` `MUST` be members of `supportedLocales`.
- `localeSets.{locale}.version` and `checksum` `MUST` change when the locale seed content changes.
- Locale set files `MUST` reference files under `seeds/locales/{locale}/` for the same locale only.
- `localeSets` `MUST` declare an entry for every locale listed in `activeLocales`. An active locale that has no locale-specific seed content yet declares `version`, `checksum`, and an empty `files` array rather than being omitted. A locale that must not execute is reserved by removing it from `activeLocales` (section 8.1) and from `profiles.*.locales`, not by leaving `localeSets` undeclared.
- `database.manifest.json#lifecycle.activeSeedLocales` `MUST` list the same locales as `seeds/seed.manifest.json#activeLocales`.

## 7. Migration Standard

### 7.1 File Naming

Migration files `MUST` use sortable names:

```text
migrations/postgres/0001_create_forum_space.up.sql
migrations/postgres/0001_create_forum_space.down.sql  # optional when safely reversible
```

Rules:

- Version prefix `MUST` be zero-padded numeric or ISO-like sortable token.
- Every `.up.sql` migration `MUST` declare its rollback strategy in metadata. A paired `.down.sql` file is optional and allowed only for a tested, bounded, data-preserving reversal. Irreversible or lossy migrations declare `reversible: false` and a `rollback` token of `forward-fix` or `restore-cutover`. Conversely, a migration that ships a `.down.sql` `MUST` declare `reversible: true` and a `rollback` token of `down-migration`; a `.down.sql` whose `.up.sql` declares an irreversible strategy is contradictory and `MUST` be removed or recorded through the historical metadata sidecar of section 7.2.
- Authoritative server migrations `MUST` live only under `migrations/postgres/` and may use PostgreSQL-native syntax required by the contract.
- Client-local migrations `MUST` live only in the owning client module under `migrations/sqlite/` and implement that module's separate client-local contract.
- PostgreSQL and SQLite migrations `MUST NOT` be copied, mechanically transliterated, or selected by runtime branching inside one SQL file. Cross-role data movement belongs in an explicit sync/projection contract.

### 7.2 Migration Metadata Header

Each migration `SHOULD` begin with a structured comment block:

```sql
-- sdkwork:migration
-- id: 0001_create_forum_space
-- engine: postgres
-- module: forum
-- purpose: Create forum_space foundation table
-- reversible: true
-- rollback: down-migration
-- transactional: true
-- lock: lightweight
-- lock_timeout: 2s
-- statement_timeout: 30s
-- contract_version: 1.1.0
```

Metadata rules:

- `transactional`, `lock`, `lock_timeout`, `statement_timeout`, `reversible`, and `rollback` `MUST` be explicit for production PostgreSQL migrations.
- Non-trivial migrations `MUST` also declare rewrite expectation, replication/WAL impact, backfill plan, observability, cancellation point, and recovery command in the migration plan or structured header.
- `transactional: false` is required for operations such as `CREATE INDEX CONCURRENTLY`; the lifecycle runner `MUST` not wrap them in an implicit transaction.
- The structured comment block is part of the checksum-covered migration content. Authors `MUST` complete it before the migration enters the Git index or can be consumed by another workspace.
- A tracked historical migration `MUST NOT` be rewritten to add, repair, reorder, or reformat metadata. Missing historical metadata `MUST` be recorded in `migrations/{engine}/metadata.json` with `kind: sdkwork.database.migration-metadata` and `sourcePolicy: historical-immutable`; the next schema change uses a new forward migration.
- The sidecar is the authoritative machine-readable record for a history-immutable migration. It `MAY` record a value for any metadata field, including a field the structured header already declares. Every field the sidecar overrides `MUST` carry a non-empty `correctionReason`, and the recorded value `MUST` itself be valid under this standard. The migration SQL remains byte-for-byte unchanged and remains checksum-covered; only the recorded metadata is corrected.
- The effective metadata — header values with sidecar corrections applied — `MUST` satisfy every metadata rule that applies to a newly authored migration: `engine` equal to the containing engine directory, `reversible` exactly `true` or `false`, `rollback` beginning with one of the three strategy tokens below, and defined `transactional`, `lock`, `lock_timeout`, and `statement_timeout` for PostgreSQL. This is what makes a malformed historical header repairable without rewriting history.
- `rollback` `MUST` begin with exactly one of `down-migration`, `forward-fix`, or `restore-cutover`. A parenthetical explanation `MAY` follow the token, for example `forward-fix (sentinel backfill is the canonical fix)`. The leading token is the machine-readable strategy; the explanation is documentation and `MUST NOT` replace the token. A value that does not begin with a token — raw SQL, or prose such as `drops both columns` — is malformed and `MUST` be corrected through the sidecar.
- A `.down.sql` is permitted only for a bounded, data-preserving reversal (section 7.1). When a paired `.down.sql` performs a lossy reversal, the effective strategy `MUST` be `reversible: false` with `rollback` token `forward-fix` or `restore-cutover`, and the `.down.sql` `MUST` be removed; the reversal prose belongs in the migration `purpose` and the release rollback plan.
- Automated metadata alignment `MAY` add headers to newly authored, untracked migration files or maintain the historical metadata sidecar. It `MUST` leave tracked migration SQL byte-for-byte unchanged.

### 7.3 History Tables

The framework `MUST` maintain:

| Table | Purpose |
| --- | --- |
| `ops_schema_migration_history` | Applied migration version, checksum, engine, module, applied_at, applied_by, execution_ms |
| `ops_seed_history` | Applied seed id, locale, profile, i18n version, checksum, applied_at, applied_by |
| `ops_database_installation_state` | Overall module install state, schema version, seed locale/profile, i18n version, environment, status |

Rules:

- Applications `MUST NOT` invent competing history tables without an exception record.
- Migration checksum `MUST` be recorded. Changed migration content after apply `MUST` fail validation in CI and drift ops. Comments, headers, whitespace, encoding, and line endings are checksum-covered content and are not exempt from immutability.

### 7.4 Migration Governance

Rules aligned with `MIGRATION_SPEC.md` and `DATABASE_SPEC.md` section 22:

- Destructive migrations `MUST` use expand/backfill/verify/contract/shrink flow.
- Backfills `MUST` be idempotent and resumable.
- Tenant-sensitive backfills `MUST` include isolation tests.
- Migration plans `MUST` be linked in release evidence for MAJOR contract changes.
- PostgreSQL migrations `MUST` be tested on the minimum and maximum supported PostgreSQL major versions when version-specific DDL, planner, extension, or fast-path behavior is used.
- A release rollback `MUST` prefer compatible application rollback or forward-fix. Automated execution of every available `.down.sql` in reverse order is forbidden.
- Shared-schema drift or an existing incompatible object `MUST` be repaired with a reviewed forward migration owned by the affected module. Replaying a changed baseline over a non-empty shared schema, deleting lifecycle history, or creating an application-specific database/schema to obtain a clean bootstrap is forbidden.
- Migration tests `MUST` include a fallback schema containing a same-named decoy object when a migration uses unqualified object discovery or DDL. The migration must operate only on the first canonical schema and leave the fallback object unchanged. Production lifecycle execution uses `SDKWORK_DATABASE_SCHEMA_FALLBACK_PUBLIC=false`; temporary compatibility requires a dated exception and removal milestone.

### 7.5 Initialization State And Baseline Consolidation

*Initialization state* means a database root can be bootstrapped from its committed assets without replaying superseded history, and that every committed asset is accounted for by the contract. It is a property of the **asset set**, not a requirement that the migration tree be empty.

Canonical baseline:

- An authoritative-server root whose `baselineStrategy` is `baseline-plus-migrations` or `baseline-only-dev` `MUST` commit exactly one primary baseline at `ddl/baseline/postgres/0001_<moduleId>_baseline.sql`, where `<moduleId>` is `database.manifest.json#moduleId`.
- A `migrations-only` root `MUST NOT` be required to commit a baseline; its ordered `migrations/postgres/*.up.sql` set is the bootstrap source defined in section 6.1.
- Additional `.sql` files under `ddl/baseline/postgres/` `MUST` be retired stubs. A retired stub `MAY` retain provenance comments but `MUST NOT` contain `CREATE TABLE`; a second competing definition of the same table is forbidden.

Post-baseline migrations:

- Ordered post-baseline migrations `MUST` be retained as the upgrade path. They are lifecycle history under section 7.3 and `MUST NOT` be deleted, folded away, or classified as debt solely because the current baseline already expresses the same end state (section 7.4 forbids deleting lifecycle history and requires a reviewed forward migration to repair an existing object).
- The primary baseline is an **immutable bootstrap anchor**. It `MUST NOT` be rewritten to absorb later migrations. A fresh install applies the baseline followed by every ordered migration, so the baseline alone is not the complete active table inventory; the baseline README `SHOULD` state that explicitly rather than implying it is the whole schema.
- A post-baseline migration is therefore load-bearing for every deployment, including a fresh install, and not only for databases created before the baseline. A migration whose effect the baseline happens to already contain remains valid: it is idempotent by construction, not redundant debt.
- Migration content is checksum-immutable under section 7.3, so the baseline and the migration files jointly define the contract; do not rewrite either to make the other "complete".

Initialization-state debt is limited to:

| Debt | Definition |
| --- | --- |
| `loose-migration` | A `.sql` file placed directly under `database/migrations/` instead of an engine directory such as `migrations/postgres/`. |
| `engine-mismatch` | A migration whose `engine` metadata or containing directory disagrees with `database.manifest.json#engines`. |
| `missing-metadata` | A migration that omits metadata required by section 7.2. |
| `competing-baseline` | More than one `0001_*_baseline.sql`, a primary baseline whose name is not `0001_<moduleId>_baseline.sql`, or a baseline supplement that is not a retired stub. |
| `undocumented-state` | `database/README.md` omits the `## Initialization state` section required by section 5.1. |

The presence of an ordered `migrations/postgres/*.up.sql` file is **not** by itself initialization-state debt.

## 8. Seed And Locale Standard

### 8.1 Locale Matrix

| Locale directory | Language | Initial execution |
| --- | --- | --- |
| `zh-CN` | Chinese (Simplified) | **Yes — default** |
| `en-US` | English | Reserved |
| `ja-JP` | Japanese | Reserved |
| `de-DE` | German | Reserved |
| `fr-FR` | French | Reserved |
| `ru-RU` | Russian | Reserved |
| `ko-KR` | Korean | Reserved |

Rules:

- Default deployment `MUST` initialize `common` plus `zh-CN` only unless runtime config explicitly selects another active locale.
- Reserved locales `MUST` keep directory placeholders and manifest entries so future activation does not require structural migration.
- Runtime/frontend i18n rules in `I18N_SPEC.md` are separate from database seed locale rules. Seed locale governs persisted initialization data, not frontend message catalogs, SDK locale providers, or request locale negotiation.
- Production deployments `MUST` fail seed planning when the selected seed locale is not declared in `activeLocales`.
- Additional locales `SHOULD` be activated by updating the seed manifest and running `db:seed` for that locale/profile; activation should not require schema migration when translation tables already exist.

### 8.2 Seed Categories

| Category | Location | Examples |
| --- | --- | --- |
| Language-neutral reference | `seeds/common/` | country codes, currency codes, permission codes, config keys |
| Locale-specific display/init data | `seeds/locales/{locale}/` | role names, menu labels, dictionary labels, default templates |
| Environment-only | `database/fixtures/` or test harness | demo users, synthetic load data |

### 8.3 Seed Idempotency

Every seed script `MUST` be safe to re-run:

- Prefer upsert semantics.
- Use deterministic primary keys for bootstrap rows where possible.
- Record execution in `ops_seed_history`.
- Record locale, profile, `i18nVersion`, locale set version, and checksum for locale-specific seed execution.
- Partial failure `MUST` roll back the seed transaction when transactional engine support exists.

### 8.4 Runtime Configuration

Environment variables `MUST` follow:

```bash
SDKWORK_DATABASE_SEED_LOCALE=zh-CN
SDKWORK_DATABASE_SEED_PROFILE=standard
SDKWORK_DATABASE_SEED_I18N_VERSION=1.0.0
SDKWORK_DATABASE_SEED_ON_BOOT=false
SDKWORK_DATABASE_AUTO_MIGRATE=false
SDKWORK_DATABASE_DRIFT_INTERVAL_SEC=60
```

Rules:

- Config resolution `MUST` be documented in `ENVIRONMENT_SPEC.md` and surfaced through typed runtime config in `CONFIG_SPEC.md`.
- `DATABASE_SEED_LOCALE` and `DATABASE_SEED_I18N_VERSION` configure database initialization only. They `MUST NOT` be treated as frontend runtime locale or API request locale.
- Secrets, credentials, and tenant-private seed values `MUST NOT` be committed in seed SQL.

## 9. Drift Observation Standard

### 9.1 Purpose

Drift observation compares **expected schema** with **actual live schema** without applying changes.

Expected schema sources, in order:

1. `database/contract/schema.yaml`
2. Applied entries in `ops_schema_migration_history`
3. Optional module-specific SPI contract overlays

Actual schema source:

- Engine introspection (`information_schema`, `pg_catalog`, `sqlite_master`, index/constraint catalogs)

### 9.2 Diff Taxonomy

| Diff code | Severity default | Meaning |
| --- | --- | --- |
| `missing_table` | error | Expected table absent in database |
| `extra_table` | warn | Database table not declared in expected model |
| `missing_column` | error | Expected column absent |
| `extra_column` | warn | Unexpected column present |
| `type_mismatch` | error | Column type/nullability/default mismatch |
| `missing_index` | warn | Expected index absent |
| `extra_index` | info | Unexpected index present |
| `missing_constraint` | error | Expected PK/UK/check/FK absent |
| `migration_pending` | error | Files pending apply |
| `migration_unknown` | error | Database history contains unknown version |
| `checksum_mismatch` | error | Applied migration content changed after apply |
| `ownership_conflict` | error | Existing object identity or contract conflicts with the declared module owner |

Severity may be overridden in `drift/policy.yaml`.

### 9.3 Drift Report Shape

```json
{
  "schemaVersion": 1,
  "kind": "sdkwork.database.drift-report",
  "checkedAt": "2026-06-20T12:00:00Z",
  "moduleId": "forum",
  "serviceCode": "FORUM",
  "engine": "postgres",
  "status": "drift_detected",
  "summary": {
    "error": 2,
    "warn": 1,
    "info": 0
  },
  "pendingMigrations": [],
  "diffs": []
}
```

### 9.4 Ops API Exposure

Backend services `SHOULD` expose read-only ops endpoints through `backend-api`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/backend/v3/ops/database/status` | Pool, lifecycle state, migration version, seed locale/profile |
| `GET` | `/backend/v3/ops/database/drift` | Latest drift report; `?refresh=true` forces introspection |
| `GET` | `/backend/v3/ops/database/migrations` | Applied and pending migrations |
| `GET` | `/backend/v3/ops/database/seeds` | Applied and pending seed sets |

Rules:

- Endpoints `MUST` require backend/admin authorization per `SECURITY_SPEC.md`.
- Reference implementation: `DatabaseOpsAuth` in `sdkwork-database-ops-http`; private bootstrap bearer via unified `SDKWORK_ACCESS_TOKEN` (never app-scoped or browser-visible env names).
- Responses `MUST NOT` expose connection secrets, raw credentials, or business row data.
- Production exposure `SHOULD` be internal or gateway-restricted.
- Drift refresh `SHOULD` be rate-limited to protect database metadata queries.

## 10. SPI Architecture

All lifecycle SPI traits live in `sdkwork-database-spi`. Applications implement or configure SPI providers; the framework orchestrates execution.

### 10.1 Design Principles

| Principle | Rule |
| --- | --- |
| Assets over code | Default behavior reads `database/` manifests and SQL files. SPI is for boundaries, hooks, and exceptional engines |
| Compose, don't fork | Multiple modules compose through registry order |
| Stable trait surface | SPI version increments follow semver; breaking SPI changes require migration notes |
| Zero custom by default | Applications with only standard assets `MAY` use built-in `DefaultDatabaseModule` without custom Rust code |
| Explicit extension | Any non-default behavior `MUST` be declared in manifest `spi` section |

### 10.2 Core SPI Traits

Normative Rust trait names below are authoritative for the reference implementation. Other languages `SHOULD` mirror the same responsibilities.

#### `DatabaseModuleDescriptor`

Static module identity.

```rust
pub trait DatabaseModuleDescriptor {
    fn module_id(&self) -> &str;
    fn service_code(&self) -> &str;
    fn table_prefix(&self) -> &str;
    fn supported_engines(&self) -> &[DatabaseEngine];
}
```

#### `DatabaseAssetProvider`

Resolves lifecycle asset locations.

```rust
pub trait DatabaseAssetProvider {
    fn manifest_path(&self) -> PathBuf;
    fn contract_path(&self) -> PathBuf;
    fn migrations_dir(&self, engine: DatabaseEngine) -> PathBuf;
    fn seeds_dir(&self) -> PathBuf;
    fn drift_policy_path(&self) -> PathBuf;
}
```

Default implementation: load paths from `database.manifest.json`.

#### `DatabaseContractProvider`

Loads expected schema contract.

```rust
pub trait DatabaseContractProvider {
    fn load_contract(&self) -> Result<DatabaseContract, ContractError>;
    fn contract_version(&self) -> Result<Version, ContractError>;
}
```

Default implementation: parse `contract/schema.yaml`.

#### `MigrationProvider`

Supplies migration sets and optional custom execution hooks.

```rust
pub trait MigrationProvider {
    fn list_migrations(&self, engine: DatabaseEngine) -> Result<Vec<MigrationSpec>, MigrationError>;
    fn before_migration(&self, ctx: &MigrationContext) -> Result<(), MigrationError> { Ok(()) }
    fn after_migration(&self, ctx: &MigrationContext) -> Result<(), MigrationError> { Ok(()) }
}
```

Default implementation: scan `migrations/{engine}/*.up.sql`.

#### `SeedProvider`

Supplies seed plans by locale/profile.

```rust
pub trait SeedProvider {
    fn resolve_seed_plan(
        &self,
        locale: &LocaleTag,
        profile: &SeedProfile,
    ) -> Result<SeedPlan, SeedError>;
    fn before_seed(&self, ctx: &SeedContext) -> Result<(), SeedError> { Ok(()) }
    fn after_seed(&self, ctx: &SeedContext) -> Result<(), SeedError> { Ok(()) }
}
```

Default implementation: read `seeds/seed.manifest.json`.

#### `DriftPolicyProvider`

Supplies drift policy overlays.

```rust
pub trait DriftPolicyProvider {
    fn load_policy(&self) -> Result<DriftPolicy, DriftError>;
}
```

#### `SchemaIntrospector`

Optional override for engine-specific introspection.

```rust
pub trait SchemaIntrospector {
    fn introspect(&self, pool: &DatabasePoolHandle) -> Result<LiveSchema, DriftError>;
}
```

Default authoritative implementation: PostgreSQL introspection in `sdkwork-database-drift`. SQLite introspection is used only by the client-local validator/adapter for a declared `client-local` module.

#### `DatabaseLifecycleListener`

Cross-cutting hooks.

```rust
pub trait DatabaseLifecycleListener {
    fn on_state_change(&self, event: LifecycleStateEvent) -> Result<(), LifecycleError> { Ok(()) }
    fn on_failure(&self, event: LifecycleFailureEvent) -> Result<(), LifecycleError> { Ok(()) }
}
```

Use for metrics, audit logs, admin notifications, and app-specific pre/post checks.

#### `DatabaseModule`

Composite registration unit exposed to applications.

```rust
pub trait DatabaseModule:
    DatabaseModuleDescriptor
    + DatabaseAssetProvider
    + DatabaseContractProvider
    + MigrationProvider
    + SeedProvider
    + DriftPolicyProvider
{
    fn listeners(&self) -> Vec<Box<dyn DatabaseLifecycleListener>> { Vec::new() }
}
```

Built-in type:

```rust
pub struct DefaultDatabaseModule {
    /* manifest-driven */
}
```

Applications `MAY` register:

- one `DefaultDatabaseModule` when standard assets are sufficient
- one custom `DatabaseModule` implementation
- multiple module instances when using `database/modules/{module-id}/`

### 10.3 SPI Registry

Applications bootstrap lifecycle with a module and orchestrator:

```rust
use std::sync::Arc;

use sdkwork_database_lifecycle::LifecycleOrchestrator;
use sdkwork_database_spi::{DefaultDatabaseModule, LocaleTag, SeedProfile};

let module = Arc::new(DefaultDatabaseModule::from_app_root(".")?);
let orchestrator = LifecycleOrchestrator::new(pool, module);
orchestrator.bootstrap(&LocaleTag::zh_cn(), &SeedProfile::standard()).await?;
```

Multi-module registry orchestration is the canonical lifecycle path for an integrated process. Each module retains its own `DatabaseModule` and assets, while one `RegistryLifecycleOrchestrator` executes them sequentially against clones of the process pool. Cross-module **schema registry** composition is governed by `SCHEMA_REGISTRY_SPEC.md` and implemented in `sdkwork-web-framework` (`sdkwork-web-schema-registry`, `tools/schema_registry/`). Application `database.manifest.json#modules[]` `SHOULD` align with schema registry dependency order.

```rust
let registry = DatabaseModuleRegistry::builder()
    .register(DefaultDatabaseModule::from_manifest(".", "database/database.manifest.json")?)?
    .build();
let orchestrator = RegistryLifecycleOrchestrator::new(process_pool.clone(), registry);
orchestrator.bootstrap_all_from_env().await?;
```

Rules:

- Registry order `MUST` be deterministic and manifest-declared.
- All modules in one registry `MUST` receive clones of the same process pool handle.
- Registry assembly `MUST NOT` call per-module pool constructors.
- A module `MUST NOT` mutate another module's tables inside hooks unless explicitly documented and tested.
- Custom modules `MUST` still store assets under standard `database/` layout unless an approved exception allows external asset paths via `DatabaseAssetProvider`.

### 10.4 Standard Reduction Path

To minimize application custom code:

| Need | Preferred approach |
| --- | --- |
| Standard single-module app | `DefaultDatabaseModule` only |
| Multiple bounded modules | `database/modules/*` + default providers |
| Custom seed selection | manifest profiles/locales, not code |
| Ignore legacy drift tables | `drift/policy.yaml` |
| Special pre-migrate check | `DatabaseLifecycleListener` |
| Nonstandard engine | new `SchemaIntrospector` SPI impl in framework or app adapter crate |

Applications `SHOULD NOT` implement custom migration runners, custom history tables, or custom drift engines.

## 11. Framework Crate Responsibilities

| Crate | Responsibility |
| --- | --- |
| `sdkwork-database-spi` | Traits, registry, manifest/seed parsing, `DefaultDatabaseModule`, seed plan resolution |
| `sdkwork-database-history` | Ops history DDL, applied migration/seed queries, checksum helpers |
| `sdkwork-database-contract` | Contract parsing, registry validation, expected table names |
| `sdkwork-database-lifecycle` | `LifecycleOrchestrator`, migrate/seed/bootstrap, `LifecycleOptions::from_env` |
| `sdkwork-database-drift` | Introspection, diff engine, report serialization |
| `sdkwork-database-ops` | Ops status/migrations/seeds/drift read models for backend handlers |
| `sdkwork-database-ops-http` | Reference Axum router for `/backend/v3/ops/database/*` |
| `sdkwork-database-config` | Existing env/TOML config; extended with seed/drift/lifecycle options |
| `sdkwork-database-sqlx` | Existing pool creation |
| `sdkwork-database-repository` | Repository layer; legacy inline migration macro only — use lifecycle |
| `sdkwork-database-cli` | Reference CLI (`sdkwork-db`) for validate/plan/init/migrate/seed/drift |

## 12. Command Surface

Application roots `MUST` expose standard commands per `PNPM_SCRIPT_SPEC.md`:

| Command | Purpose |
| --- | --- |
| `db:validate` | Validate manifests, contracts, directories, naming, and registry consistency |
| `db:plan` | Show pending migrations, seed plans, and drift summary without applying changes |
| `db:init` | Bootstrap an empty database through baseline or first migration |
| `db:migrate` | Apply pending migrations |
| `db:seed` | Apply seed plan for selected locale/profile |
| `db:status` | Print lifecycle/installation state |
| `db:drift` | Print drift report |
| `db:drift:check` | Exit non-zero on error-level drift or pending migrations |
| `db:materialize:contract` | Materialize L2 contract registries and manifest fields from committed DDL (the baseline, or the ordered migration set for `migrations-only`) |
| `db:bootstrap` | `db:migrate` then `db:seed` for development/bootstrap flows |

Desktop or Tauri hosts with a declared `client-local` module `MAY` package that module's SQLite baseline and migrations into the native runtime. They `MUST NOT` mirror or mechanically convert the PostgreSQL authoritative baseline. Server CI and shared environments `MUST` use `sdkwork-database-cli` against the PostgreSQL `SDKWORK_DATABASE_*` profile; client-local CI validates its own SQLite contract separately.

Every `db:*` command `MUST` operate on the application root that declares it. A command `MUST NOT` delegate to another repository's database root through a directory change, a workspace filter, or an `--app-root` value pointing outside the repository: a delegated lifecycle command validates, migrates, seeds, or reports on the wrong schema while appearing to succeed, leaving the declaring root ungated. Cross-repository convenience aliases that intentionally operate on another module's root `MAY` exist, but they `MUST` be named for that module (for example `db:migrate:iam`) and `MUST NOT` occupy a standard `db:*` command name from the table above.

`db:materialize:contract` `MUST` materialize the L2 contract registries and manifest fields for its own application root from its own committed DDL source, resolved as in section 7.5: the canonical baseline for `baseline-plus-migrations` and `baseline-only-dev`, or the ordered `migrations/{engine}/*.up.sql` set for `migrations-only`. It `MUST NOT` delegate to another repository's database root or baseline, and the delegated materializer `MUST` resolve the canonical source path itself rather than depending on the exact script text.

## 13. Verification And Quality Gates

### 13.1 Required Tests

| Test | Purpose |
| --- | --- |
| `database-framework.contract.test.*` | Directory/manifest/SPI registration contract |
| PostgreSQL migration smoke | Empty PostgreSQL database/schema -> latest authoritative schema |
| PostgreSQL upgrade smoke | Previous supported contract version -> latest, including lock/rewrite/backfill assertions |
| seed smoke | `common` + default locale/profile idempotency |
| drift clean | Fresh bootstrap yields zero error-level drift |
| checksum immutability | Changed applied migration fails CI |
| PostgreSQL repository/concurrency | Constraints, isolation, SQLSTATE mapping, tenant denial, idempotency, and transaction retry on real PostgreSQL |
| PostgreSQL plan evidence | Representative P0/P1 plans and buffers satisfy declared budgets |
| client-local SQLite contract | Required only when a `client-local` module exists; verifies PRAGMAs, schema migration, isolation, purge, corruption/disk-full recovery, and sync/conflict behavior |

### 13.2 Gate Matrix

| Gate | Requirement |
| --- | --- |
| Merge | `db:validate` passes; authoritative changes pass PostgreSQL migration/repository tests; optional client-local changes pass their separate SQLite tests |
| Staging deploy | PostgreSQL `db:migrate`, `db:seed`, `db:drift:check`; migration lock/backfill observation active |
| Release | PostgreSQL drift and query-plan evidence archived; MAJOR contract changes linked to migration plan; client-local sync evidence attached when applicable |
| Production | PostgreSQL has no error-level drift or pending migrations; backup/restore readiness and connection budget are current |

### 13.3 Documentation

`database/README.md` and service runbooks `MUST` follow `DOCUMENTATION_SPEC.md` and link to this standard.

## 14. Security And Operations

Rules:

- Ops endpoints `MUST` follow `SECURITY_SPEC.md` and `WEB_BACKEND_SPEC.md`.
- Drift and migration status `MAY` expose schema metadata but `MUST NOT` expose secrets or row-level production data.
- Seed scripts `MUST NOT` embed production credentials.
- Migration failures in production `MUST` emit structured logs and metrics per `OBSERVABILITY_SPEC.md`.
- Backup/restore expectations for destructive migrations `MUST` follow `MIGRATION_SPEC.md`.

## 15. Legacy Adoption

Existing repositories with crate-local migrations, bespoke installers, or application-specific bootstrap code `MUST` converge on this standard through a migration plan:

1. Move assets into `database/`.
2. Add manifests and contract files.
3. Register `DefaultDatabaseModule` or adapter module.
4. Replace bespoke installer entrypoints with lifecycle orchestrator calls.
5. Add contract tests and drift gate.
6. Remove legacy bootstrap paths after compatibility window.

Known legacy patterns to converge:

- crate-local `migrations/`
- application-local `DatabaseInstaller`
- TypeScript/Rust ad-hoc schema bootstrap without history tables
- seed data embedded in application code instead of `seeds/`
- service-side SQLite or mixed PostgreSQL/SQLite parity manifests
- PostgreSQL baselines copied or text-converted into SQLite baselines
- mandatory generic down migrations that are not proven data-preserving

## 16. Extension And Future Evolution

Future extensions `SHOULD` be added through:

- new manifest fields with `schemaVersion` bump
- new SPI traits rather than changing orchestrator internals
- new diff codes documented in framework profile
- new seed profiles/locales declared in manifests

Potential future capabilities (non-normative roadmap):

- auto-repair plans for selected warn-level drift
- Java lifecycle orchestrator parity crate
- contract-to-migration generator
- admin UI drift dashboard
- multi-database module federation in integrated mode

Extensions `MUST NOT` weaken L1 requirements without governance approval.

## 17. Compliance Checklist

Application database lifecycle is compliant when:

- [ ] `database/` directory matches section 5
- [ ] `database.manifest.json` and `seeds/seed.manifest.json` exist and validate
- [ ] `contract/schema.yaml` and registries exist for L2+
- [ ] Authoritative manifest declares `databaseRole=authoritative-server`, `engines=[postgres]`, and `defaultEngine=postgres`
- [ ] PostgreSQL migrations are ordered, checksum-tracked, history-backed, metadata-complete, and use safe forward/rollback strategy
- [ ] Initialization state matches section 7.5: one canonical `0001_<moduleId>_baseline.sql` (or a `migrations-only` bootstrap set), no loose or metadata-incomplete migrations, no competing baseline, and the state documented in `database/README.md`
- [ ] Seeds split `common` vs locale directories; default seed locale is `zh-CN`
- [ ] Locale seed manifests declare `i18nVersion`, fallback/default/supported/active locales, locale set versions, and checksums.
- [ ] Connection pool uses `sdkwork-database`
- [ ] Lifecycle bootstrap uses `sdkwork-database` orchestrator and SPI registry
- [ ] Drift ops endpoints or CLI are available for L3
- [ ] Standard `db:*` commands exist at application root
- [ ] Contract tests and release gates are wired in CI
- [ ] PostgreSQL authoritative tests run against real PostgreSQL and include transaction, constraint, isolation, migration, plan, and recovery evidence
- [ ] Any SQLite module is owned by a client/native module, declares `databaseRole=client-local`, and passes separate local-data/sync/security gates

## 18. Summary

SDKWork database lifecycle is PostgreSQL-first, role-explicit, contract-first, migration-governed, seed-locale-aware, and drift-observable. Authoritative applications ship PostgreSQL `database/` assets and use the shared lifecycle framework. Client/native modules may ship a separate SQLite `client-local` contract when a real local-data requirement exists. Physical parity between those roles is neither required nor allowed to weaken the PostgreSQL design.
