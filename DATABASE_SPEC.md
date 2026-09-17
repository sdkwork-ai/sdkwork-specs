# SDKWork Database Contract Standard

- Version: 3.1
- Scope: PostgreSQL-first authoritative server persistence, SQLite client-local persistence, relational database contracts, schema registry inputs, table naming, logical data types, tenant and subject isolation, indexes, transactions, schema evolution, repository access, lifecycle orchestration, and database readiness for SDKWork-owned systems
- Related: `API_SPEC.md`, `PAGINATION_SPEC.md`, `SUBJECT_ID_SPEC.md`, `DATABASE_FRAMEWORK_SPEC.md`, `DATABASE_SPEC_PROCESS_SHARED_POOL.md`, `SCHEMA_REGISTRY_SPEC.md`, `MIGRATION_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `WEB_BACKEND_SPEC.md`, `RUST_CODE_SPEC.md`, `TEST_SPEC.md`
- Canonical location: `DATABASE_SPEC.md` in the `sdkwork-specs` standards root

This standard defines the database contract for SDKWork. It is independent of Java, Rust, TypeScript, Python, Go, PHP, C#, ORM choice, and migration tool, but it is intentionally not database-product neutral at the physical implementation boundary:

- PostgreSQL is the mandatory authoritative relational implementation for SDKWork services, server processes, containers, cloud workloads, shared business state, and system-of-record data.
- SQLite is the embedded client-local implementation for desktop, tablet, mobile, or other native client data that is device-scoped and non-authoritative outside its declared local boundary.

Portability means that logical identity, ownership, tenant isolation, API/SDK serialization, lineage, and lifecycle semantics remain explicit. It does not mean reducing PostgreSQL schema, transaction, indexing, integrity, observability, or migration design to the SQLite feature set.

This repository owns global standards only. Repository-specific table inventories, ORM scan results, migration evidence, and rename plans belong in the consuming repository `specs/`, migration plans, or generated audit evidence. They `MUST NOT` be embedded in this global standard.

## 1. Normative Language

The words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are used with RFC-style meaning.

| Term | Meaning |
| --- | --- |
| `MUST` | Required. A contract that violates this rule is not SDKWork-standard. |
| `MUST NOT` | Forbidden. Do not bypass this with local convention. |
| `SHOULD` | Strong recommendation. Deviation requires a documented reason, risk, and exit path. |
| `SHOULD NOT` | Strong negative recommendation. Deviation requires documented justification. |
| `MAY` | Optional capability decided by product, compliance, or deployment needs. |

Standard levels:

| Level | Name | Minimum bar |
| --- | --- | --- |
| L0 | Legacy Compatible | Existing shipped systems with an owner, mapping, risk register, compatibility window, and migration or retirement plan. |
| L1 | Portable Core | Standard names, identity, audit fields, logical types, required constraints, and basic indexes. |
| L2 | Service Ready | Tenant/subject isolation, idempotency, API/SDK serialization, bounded pagination, schema evolution, and contract tests. |
| L3 | Enterprise Grade | Least privilege, privacy classification, audit and ledger evidence, retention, disaster recovery, drift controls, and formal release gates. |

New business tables `MUST` target L1 or higher. Tenant, IAM, permission, account, payment, billing, entitlement, file, message, AI execution, and cross-service write tables `MUST` target L2 or higher. Money, credentials, privacy-sensitive data, legal hold, and critical audit records `SHOULD` target L3. L1+ authoritative server tables `MUST` run on PostgreSQL.

## 2. Scope

This standard applies to:

- relational tables, schema registry fragments, DDL, migrations, seeds, drift reports, and database review evidence;
- SQL-backed services in Rust, Java/Kotlin, TypeScript/Node.js, Python, Go, PHP, C#, Ruby, and other SDKWork-owned runtimes;
- generated DTOs, OpenAPI schemas, SDK serialization, and repository contracts derived from database fields;
- database-backed read models, projections, indexes, search mirrors, data warehouse exports, and CDC/event materialization;
- database lifecycle bootstrap, migration, seed, health, readiness, and drift orchestration.

This standard does not require one ORM, one language, one schema migration tool, or database foreign keys on every table. It does require PostgreSQL for authoritative server persistence, SQLite only for declared client-local persistence, and a logical contract that the selected tools can validate.

## 3. Core Principles

1. PostgreSQL first: authoritative server behavior is designed, implemented, tested, tuned, migrated, and recovered on PostgreSQL before optional client-local work is considered complete.
2. Storage role before engine: every database contract declares whether it is `authoritative-server` or `client-local`; a connection string does not decide data authority.
3. Data contract first: field names, logical types, constraints, and semantics are more stable than ORM annotations or language class names.
4. Explicit ownership: every core table has a business domain, bounded context, system of record, and write owner.
5. Explicit subject scope: tenant, organization, user, owner, and data-scope predicates must be stored and indexed when they affect access control.
6. API/SDK-safe serialization: `int64`, decimal, timestamps, enum values, and JSON must have a cross-language representation.
7. Bounded query cost: list/search contracts define filters, sort, pagination, and indexes before implementation.
8. Evolution by expand and contract: breaking database changes require compatibility, backfill, validation, cutover, and cleanup.
9. Native capability without accidental coupling: PostgreSQL-native constraints, indexes, locking, JSONB, RLS, and operational features are allowed when they improve correctness or operability and are declared in the contract.
10. Tool-checkable rules: schema linters, repository tests, OpenAPI generation, SDK generation, CI, and drift checks should validate the standard.
11. Legacy is migration-only: L0 compatibility is not an alternate standard for new or pre-launch applications.

### 3.1 Storage Authority And Engine Policy

| Database role | Required engine | Allowed responsibility | Forbidden responsibility |
| --- | --- | --- | --- |
| `authoritative-server` | PostgreSQL | Service and platform systems of record, shared tenant/business state, server-side transactions, ledgers, audit, jobs, integration state | SQLite fallback, SQLite-only release evidence, or lowest-common-denominator design |
| `client-local` | SQLite | Device/profile/account-scoped cache, offline projection, draft, local preference, local search index, resumable client queue, or explicitly local-only user data | Server authorization authority, shared multi-user truth, cross-device uniqueness authority, billing/ledger truth, tenant entitlement truth, or a substitute for the server system of record |
| `server-test` | PostgreSQL | Authoritative schema, repository, migration, concurrency, query-plan, backup, and recovery verification | Claiming server compatibility from SQLite tests |
| `client-local-test` | SQLite | Client schema migration, corruption recovery, profile isolation, purge, offline/sync, and concurrency verification | Replacing PostgreSQL integration coverage |

Rules:

- Every relational database manifest and schema contract `MUST` declare one database role.
- Every service, gateway, RPC host, worker, scheduled job, server CLI, server process started by a desktop host, standalone server/container, and cloud workload that owns relational state `MUST` use PostgreSQL for `authoritative-server` persistence.
- Server startup `MUST` fail closed when PostgreSQL configuration is absent or invalid. It `MUST NOT` silently or automatically fall back to SQLite.
- A PostgreSQL-compatible managed service `MAY` be used only when an accepted ADR records the provider, supported PostgreSQL version and extensions, transaction and locking compatibility, collation behavior, backup/restore behavior, observability gaps, failover semantics, and conformance evidence. Marketing compatibility alone is not sufficient.
- SQLite `MUST` be embedded in a client/native persistence adapter and scoped to one installation plus the declared profile, environment, origin, and account boundary. It `MUST NOT` be exposed as a shared network database or used from a network filesystem.
- Client-local rows copied from a server remain projections of the PostgreSQL authority. A client-local table may be authoritative only for data whose business scope is explicitly device-local and never claims cross-device, cross-user, tenant, billing, entitlement, audit, or shared service authority.
- Offline mutation requires an explicit sync contract defining local identity, server identity mapping, idempotency key, ordering, tombstones, conflict detection, conflict resolution, retry, rejection handling, and user-visible recovery. A generic `updated_at` last-write-wins rule is not sufficient for money, permissions, ledgers, inventories, quotas, or collaborative edits.
- Server APIs `MUST` re-authenticate, re-authorize, revalidate, and reapply invariants for every client-local mutation. Local tenant, role, permission, price, quota, or entitlement values are untrusted inputs.
- PostgreSQL and SQLite physical schemas `MUST NOT` be treated as interchangeable mirrors. When both roles exist, each owns a separate contract and migration history, with an explicit projection/sync mapping where data crosses the boundary.

### 3.2 Implementation Priority And Completion Order

For any feature with persistent server data, the required completion order is:

1. Define the logical data ownership, invariants, PostgreSQL physical schema, transaction boundary, query contracts, indexes, migration, retention, backup/recovery, and observability.
2. Pass PostgreSQL contract, migration, repository, concurrency, isolation, query-plan, and recovery gates.
3. Add SQLite client-local storage only when the client has a concrete local-data or offline requirement.
4. Validate the client-local schema, security, lifecycle, and sync mapping independently.

Rules:

- A server feature `MUST NOT` be declared complete from SQLite unit or integration tests.
- Optional SQLite support `MUST NOT` delay, weaken, or remove a PostgreSQL constraint, index, transaction rule, data type, RLS policy, JSONB query, generated column, partitioning decision, or operational control required by the authoritative design.
- New server SQL `MUST` be authored and reviewed as PostgreSQL SQL. SQLite DDL or migrations `MUST NOT` be produced through regex replacement, type-name substitution, or other blind transliteration of PostgreSQL SQL.
- Cross-engine repository abstractions `MAY` share logical interfaces, but engine-specific implementations `MUST` remain explicit. An abstraction that hides locking, isolation, constraint, query-plan, or error-code differences is non-compliant.

## 4. Portable Data Contract

A database table contract `MUST` describe the table independently of any one ORM or database dialect.

| Contract element | Requirement |
| --- | --- |
| `table_name` | Standard physical table name, business domain, and owner. |
| `table_profile` | Primary table profile from section 5. |
| `columns` | Column names, logical types, nullability, defaults, constraints, and serialization. |
| `constraints` | Primary key, unique keys, check constraints, foreign keys, or application-level integrity rules. |
| `indexes` | Query purpose, ordered columns, uniqueness, partial predicates, and lifecycle ownership. |
| `ownership` | Tenant, organization, user, owner, shared-platform, or public-data scope. |
| `security` | Sensitivity, encryption, masking, retention, export, and access rules. |
| `evolution` | Contract version, compatibility window, migration state, rollback or forward-fix plan. |
| `lineage` | Upstream source, downstream consumers, CDC/topic/search/cache/export flows. |
| `quality` | Completeness, uniqueness, validity, consistency, freshness, and drift checks. |

Rules:

- `apis/`, OpenAPI, SDK DTOs, ORM entities, generated repositories, and migrations `SHOULD` be generated from or validated against the contract.
- A core business table `SHOULD` have a single write owner. Multi-writer tables require a command gateway, transactional boundary, or documented concurrency control.
- Shared tables `MUST` declare a system of record and downstream notification mechanism.
- Read models, search indexes, cache tables, and warehouse tables `MUST` declare source tables and rebuild strategy.
- Services `MUST NOT` write another service's owned table only because they can connect to the database.

## 5. Table Profiles

Each authored table `MUST` choose one primary profile and may add secondary profiles.

| Profile | Applies to | Required semantics |
| --- | --- | --- |
| `core_entity` | Stable business object | `id`, `uuid`, audit fields, lifecycle state, version. |
| `tenant_entity` | Tenant-scoped object | `tenant_id`, tenant-leading indexes, audit fields. |
| `user_entity` | User-owned object | `tenant_id`, `user_id`, subject-scope indexes. |
| `owner_entity` | Object owned by variable subject type | `owner_type`, `owner_id`, owner indexes. |
| `relation_entity` | Many-to-many or assignment table | source/target ids, uniqueness, optional audit fields. |
| `tree_entity` | Hierarchy | `parent_id`, path or closure strategy, depth/cycle constraints. |
| `ledger_event` | Financial or immutable ledger fact | append-only semantics, amount/currency, reversal/adjustment model. |
| `audit_event` | Audit or compliance record | actor, action, target, timestamp, trace id, retention. |
| `outbox_event` | Reliable event publication | idempotency, event version, payload hash, dispatch state. |
| `read_model` | Projection or list view | source lineage, rebuild strategy, freshness, query contract. |
| `search_index` | Search mirror | source lineage, analyzer/version, rebuild strategy. |
| `reference_data` | Seed, lookup, or stable dictionary | stable code, semantic version, idempotent seed. |
| `localized_reference_data` | Localized seed, lookup, label, template, or display dictionary | stable base code plus locale-specific translation rows. |
| `operational_state` | Runtime state, locks, jobs, cursors | owner, TTL, concurrency, cleanup. |

## 6. Standard Field Dictionary

### 6.1 `id`

Rules:

- Runtime business tables `MUST` use a stable `int64` logical primary identifier named `id` unless a documented external standard requires another shape.
- Runtime business table DDL `MUST` use `BIGINT NOT NULL PRIMARY KEY` or the database-equivalent non-auto-allocated `int64` primary key.
- The value of `id` `MUST` be generated by an approved SDKWork ID provider before insert. SQL fragments, repositories, mappers, jobs, event consumers, and migrations `MUST NOT` allocate ad hoc ids.
- SDKWork Rust implementations `MUST` reuse the approved SDKWork platform ID service when available instead of creating local snowflake variants.
- Runtime inserts `MUST` explicitly list and bind the `id` column. `RETURNING id` may return the already-bound id; it must not prove that the database allocated the id.
- Runtime business tables `MUST NOT` rely on `BIGSERIAL`, `SERIAL`, `AUTOINCREMENT`, `GENERATED ... AS IDENTITY`, `DEFAULT nextval(...)`, `last_insert_rowid()`, `MAX(id)+1`, random hashes, or database rowid allocation for primary key assignment.
- Snowflake or time-ordered id profiles `MUST` define node id source, clock rollback behavior, sequence overflow behavior, restart behavior, capacity, and monitoring.

### 6.2 `uuid`

Rules:

- Core business tables `SHOULD` expose a stable `uuid` or equivalent public identifier when resources are referenced outside one database boundary.
- `uuid` `SHOULD` be unique within the table and should not reveal creation volume or sequence.
- Public APIs `SHOULD` expose `uuid`, ULID, KSUID, slug, or domain number instead of exposing sequential internal `id` unless the API has an explicit reason.

### 6.3 SQL Primary Key And Insert Binding

Rules:

- Standard runtime tables `MUST` have a primary key.
- SQLite client-local business tables `MUST NOT` use `INTEGER PRIMARY KEY` for SDKWork business ids because that has rowid auto-allocation semantics.
- PostgreSQL authoritative DDL and SQLite client-local DDL examples `MUST` preserve explicit id binding semantics.
- Generated repositories `MUST` accept already-generated ids or inject the approved ID provider before insert.
- Bulk imports and backfills `MUST` preserve existing stable ids or use a documented deterministic remap table.

### 6.4 Reserved Seed IDs And Stable References

Rules:

- Official installation seeds, built-in directories, platform roles, standard configuration, and records referenced by stable `target_id` values `MUST` use reserved stable ids or stable UUIDs.
- Seed ids `MUST` be deterministic across installations, upgrades, and retries.
- Runtime snowflake ids `MUST NOT` replace reserved ids for built-in records when that would break upgrade idempotency or reference repair.

### 6.4.1 Localized Seed And Translation Tables

Persisted localized data `MUST` keep stable machine fields separate from translated display values.

Recommended shape:

```text
<module>_<resource>
  id
  code
  tenant_id / app_id when scoped
  status
  machine fields

<module>_<resource>_translation
  id
  resource_id or resource_code
  locale
  message_key or field_name
  value
  version
  created_at / updated_at
```

Rules:

- Base tables `MUST` store stable ids, codes, tenant/app scope, status, ordering, and other non-localized machine fields.
- Translation tables `SHOULD` store locale-specific display names, descriptions, labels, templates, and help text.
- Translation tables `MUST` use normalized BCP 47 locale tags according to `I18N_SPEC.md`.
- Translation table uniqueness `MUST` prevent duplicate effective translations, normally `(resource_id, locale, message_key)` or `(resource_code, locale, field_name)`.
- Locale seed scripts `MUST` upsert translations idempotently and record locale/version/checksum through `DATABASE_FRAMEWORK_SPEC.md` seed history.
- Business logic, permission checks, and API machine fields `MUST NOT` depend on localized values. Use stable ids, codes, enums, or translation keys.
- Adding a locale `SHOULD` add translation rows or locale seed files, not schema columns such as `name_en`, `name_zh`, `description_de`, or equivalent per-language column sprawl, unless an approved analytics or legacy compatibility exception exists.

### 6.5 Audit Fields

Standard audit fields:

| Field | Type | Rule |
| --- | --- | --- |
| `created_at` | `instant` | Required on L1+ business tables. |
| `updated_at` | `instant` | Required on mutable L1+ business tables. |
| `created_by` | `int64` | Required when actor audit is needed. |
| `updated_by` | `int64` | Required when mutable actor audit is needed. |
| `trace_id` | `string` | Server-owned request correlation id when persisted. |

Audit times `MUST` be UTC instants. Business code `MUST NOT` write local-time ambiguous values.

### 6.6 Lifecycle Fields

Common lifecycle fields:

| Field | Type | Rule |
| --- | --- | --- |
| `status` | enum/int/string | Required for stateful business resources. |
| `version` | `int64` | Required when optimistic concurrency is used. |
| `deleted_at` | `instant` | Soft delete timestamp. |
| `deleted_by` | `int64` | Soft delete actor. |
| `archived_at` | `instant` | Archive timestamp. |
| `retention_until` | `instant` | Legal, privacy, or lifecycle retention boundary. |

Soft-delete tables `MUST` define how uniqueness behaves for deleted rows.

### 6.7 Ownership Fields

`owner_type` and `owner_id` represent variable ownership across users, organizations, tenants, apps, projects, devices, or service accounts.

Rules:

- `owner_type` values `MUST` come from a documented enum.
- `owner_id` `MUST` be an `int64` subject id when the owner is an SDKWork subject.
- Owner-based access control `MUST` have supporting indexes.

### 6.8 Idempotency And External Event Fields

Common fields:

| Field | Rule |
| --- | --- |
| `idempotency_key` | Client or integration retry key scoped by tenant, actor, method, and resource. |
| `external_provider` | External source system id. |
| `external_id` | External id unique within provider and domain. |
| `external_event_id` | External event unique id for webhook/event dedupe. |
| `payload_hash` | Canonical hash used to detect conflicting duplicate retries. |

Rules:

- Retriable create/command/payment/webhook flows `MUST` have a uniqueness boundary that prevents duplicate side effects.
- Third-party ids `MUST` use provider plus external id boundaries; a bare `external_id` unique across all providers is not sufficient unless the provider is single-valued by contract.

### 6.9 Data Scope Fields

`data_scope` may encode standard visibility or ABAC scope, but it `MUST` be documented and indexed when used for access checks.

ABAC/RLS fields used in policies `MUST` be first-class columns. They `MUST NOT` live only inside JSON.

### 6.10 Tenant, User, And Organization Subject Scope

Runtime business tables follow `SUBJECT_ID_SPEC.md` for subject id semantics.

Rules:

- `tenant_id`, `organization_id`, `user_id`, `created_by`, `updated_by`, `deleted_by`, `owner_id`, and equivalent SDKWork subject references `MUST` be SQL `BIGINT` / logical `int64` when they reference SDKWork IAM, tenant, organization, app, or user subjects.
- These fields `MUST` store resolved numeric subject ids from the trusted request context, not client-provided opaque strings.
- Tenant-scoped tables `MUST` include `tenant_id` and tenant-leading indexes for list/search paths.
- Organization-scoped tables `MUST` include both `tenant_id` and `organization_id`; organization isolation must never depend on an optional payload field, inferred join, process-global state, or post-query filtering.
- `organization_id` `MUST` be declared `NOT NULL` with the platform sentinel default (`BIGINT ... DEFAULT 0`; `TEXT`/`VARCHAR`/`UUID` columns use the sentinel `'0'` / zero-UUID default). Nullable `organization_id` columns are a contract violation.
- The platform sentinel `organization_id = '0'` (zero) is the single representation of platform-wide or "no organization" rows. `NULL` must never be used for that meaning.
- Runtime SQL that reads organization-scoped data `MUST` resolve a missing IAM organization context (`organization_id = None`) to the sentinel (`organization_id = '0'`) or match it explicitly (`organization_id = $n OR organization_id = '0'`); a predicate that only matches `organization_id IS NULL` is a contract violation.
- Migration of a legacy nullable `organization_id` column `MUST` backfill the sentinel (`UPDATE ... SET organization_id = '0' WHERE organization_id IS NULL`) before `SET NOT NULL`, and `MUST` be idempotent.
- Unique indexes and constraints on `organization_id` `MUST` reference the column directly; `COALESCE(organization_id, '0')` expressions are only tolerated as legacy migration facts, never in new DDL.
- User-owned tables `SHOULD` include `user_id` when user ownership affects authorization, listing, or audit.
- Cross-tenant platform tables `MUST` document why `tenant_id` is absent or nullable and how access is authorized.

## 7. Naming Standard

Rules:

- Table and column names `MUST` use lowercase `snake_case`.
- New business table names `MUST` follow `<module_prefix>_<entity_name>`.
- `<module_prefix>` `MUST` be a registered business module or bounded-context prefix, not a product name, company name, deployment name, programming language, or legacy project prefix.
- A platform infrastructure layer that owns a bounded context `MAY` register a descriptive prefix naming that context (for example `framework_` for the web framework layer). Such a prefix `MUST` be registered in `tools/database-module-registry.json` before first use, and that registry entry is the sole authority for ownership. See `docs/architecture/decisions/ADR-20260917-web-framework-table-prefix.md`.
- Entity names `SHOULD` use singular nouns. Collection semantics should be represented by relation tables or child entities.
- Standard suffixes include `_history`, `_event`, `_snapshot`, `_detail`, `_item`, `_relation`, `_binding`, `_assignment`, `_outbox`, `_inbox`, `_read_model`, and `_audit`.
- Foreign key-like fields `SHOULD` use `<entity>_id` or a domain-specific subject field name such as `tenant_id` and `organization_id`.
- Index names `SHOULD` follow `idx_<table>_<purpose_or_columns>`, unique constraints `uk_<table>_<columns>`, and foreign keys `fk_<table>_<target>`.
- Existing project-level prefixes may be registered only as L0 migration facts. New/pre-launch tables `MUST NOT` keep them.

## 8. Logical Types

### 8.1 Type Mapping

| Logical type | PostgreSQL `authoritative-server` | SQLite `client-local` | API/SDK shape |
| --- | --- | --- | --- |
| `int64` | `BIGINT` | `BIGINT`/integer affinity with explicit application binding; not `INTEGER PRIMARY KEY` | string in JSON HTTP contracts when precision matters. |
| `uuid` | native `UUID` | canonical lowercase UUID text | UUID string. |
| `decimal` | `NUMERIC(p,s)` | canonical decimal text or documented scaled integer; never `REAL` for precise values | string or structured `{ units, nanos }`; never float/double for money. |
| `instant` | `TIMESTAMPTZ` | canonical ISO 8601 UTC text or integer epoch with declared unit | ISO 8601 UTC string. |
| `date` | `DATE` | ISO date text | ISO date string. |
| `boolean` | `BOOLEAN` | integer constrained to `0` or `1` | boolean. |
| `enum` | constrained short text or integer dictionary | constrained text or integer dictionary | typed enum, tolerant reader for unknown values. |
| `json` | `JSONB` by default | canonical JSON text validated before write | typed object or documented extension map. |
| `binary` | `BYTEA` | `BLOB` | base64 or object-storage reference. |

Rules:

- `int64` and decimal wire behavior must align with `API_SPEC.md` and SDK generation.
- Money, tax, exchange rate, balance, quota, credit, points, and usage-billing values `MUST NOT` use float/double.
- Enums `MUST` document values, meanings, lifecycle, compatibility behavior, and unknown-value handling.

### 8.1.1 TEXT-Stored `instant` Compatibility

Some L0/L1 SQLite or legacy tables store logical `instant` values as TEXT. This is allowed only when the format is canonical ISO 8601 UTC and lexical ordering matches chronological ordering.

Rules:

- TEXT-stored instants `MUST` use a single normalized UTC format.
- PostgreSQL queries comparing TEXT-stored logical instants `MUST` use explicit casts such as `expires_at::timestamptz > $1::timestamptz` when the physical column type is text.
- Rust sqlx queries `MUST NOT` bind `chrono::DateTime<Utc>` directly against TEXT instant columns without the required cast or adapter.
- New L2+ PostgreSQL tables `MUST` use `TIMESTAMPTZ` for instants instead of TEXT.

### 8.2 PostgreSQL Physical Type Profile

Rules:

- PostgreSQL authoritative schemas `MUST` use native `UUID`, `BOOLEAN`, `DATE`, `TIMESTAMPTZ`, `NUMERIC`, `JSONB`, and `BYTEA` where their logical types apply. Encoding these values as generic text for cross-engine convenience is non-compliant for new L2+ tables.
- `TIMESTAMP WITHOUT TIME ZONE` `MAY` represent an intentional local wall-clock value only when the contract also declares the business timezone/calendar semantics. It `MUST NOT` represent an instant.
- `VARCHAR(n)` `MUST` have a domain or wire-contract reason for the limit. Arbitrary storage-oriented lengths such as `VARCHAR(255)` `SHOULD NOT` be copied by habit; use `TEXT` plus a meaningful `CHECK` when a business maximum is required.
- `NUMERIC(p,s)` precision and scale `MUST` be derived from domain range, rounding, aggregation, and overflow requirements. Unlimited `NUMERIC` is not a substitute for a capacity decision on financial write paths.
- `JSONB` is the default PostgreSQL JSON storage type. Plain `JSON` requires a documented need to preserve input text, whitespace, or duplicate-key behavior.
- PostgreSQL arrays, range types, generated columns, domains, and extensions `MAY` be used when they simplify a declared invariant or query contract. Extension use `MUST` be versioned, schema-qualified, allow-listed, and verified in bootstrap, backup, restore, and managed-service profiles.
- Collation-sensitive equality, ordering, and uniqueness `MUST` declare normalization and collation behavior. Locale-dependent database defaults `MUST NOT` silently define public identifiers, email/domain uniqueness, cursor order, or signature inputs.

### 8.3 SQLite Client-Local Type Profile

Rules:

- SQLite affinity does not replace logical type validation. Client-local adapters `MUST` validate decimal, instant, UUID, boolean, enum, and JSON values before binding and `MUST` add `CHECK` constraints where SQLite can enforce the invariant.
- A client-local schema `MUST` choose one canonical representation per logical type and keep it stable across migrations. Mixed instant formats, mixed decimal encodings, and mixed boolean encodings in one column are forbidden.
- SQLite `STRICT` tables `SHOULD` be used when the supported SQLite runtime version and platform bindings provide consistent behavior.
- Client-local money, quota, permission, entitlement, and server-owned status values are cached/projection values only. The server `MUST` ignore them as authority when processing a mutation.

## 9. Standard DDL Templates

A standard table DDL `SHOULD` include:

- explicit `id BIGINT NOT NULL PRIMARY KEY`;
- `uuid` when externally referenced;
- tenant/subject fields required by the profile;
- audit and lifecycle fields;
- unique constraints and supporting indexes;
- comments or schema registry metadata for non-obvious semantics;
- migration identity and contract version evidence.

DDL `MUST NOT` hide required columns behind ORM-only defaults that are absent from the actual database contract.

## 10. Index Standard

Rules:

- Every index `MUST` serve a named query, uniqueness, integrity, lifecycle, or migration purpose.
- Tenant-scoped list indexes `MUST` lead with `tenant_id` unless a documented query plan proves a different order is required.
- Stable list ordering `SHOULD` include a unique tie-breaker such as `id`.
- PostgreSQL B-tree is the default for equality, range, and ordered access. GIN, GiST, SP-GiST, BRIN, hash, expression, partial, covering (`INCLUDE`), full-text, vector, or extension-owned indexes `MUST` name the operator/query they accelerate and why B-tree is insufficient.
- Composite index order `MUST` be derived from equality predicates, range predicates, sort order, selectivity, tenant isolation, and keyset pagination. Copying all filter fields into one wide index is not a design method.
- Partial indexes `MUST` use predicates that the query can prove, such as `deleted_at IS NULL`; parameterized or mutable predicates that PostgreSQL cannot match reliably are forbidden.
- Index-only scan assumptions `MUST` account for visibility-map behavior, write amplification, and vacuum health. `INCLUDE` columns `MUST` be justified by measured read benefit.
- JSONB GIN indexes `MUST` select `jsonb_ops` or `jsonb_path_ops` from the actual containment/key query contract. A blanket GIN index on every JSONB column is forbidden.
- Large-table PostgreSQL indexes `MUST` document online creation, lock impact, statement/lock timeouts, invalid-index cleanup, rollback/forward-fix, and monitoring. Production creation should use `CREATE INDEX CONCURRENTLY` when blocking writes exceeds the declared budget.
- P0/P1 and high-growth queries `MUST` have representative PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` evidence before release. Evidence records cardinality assumptions, scanned versus returned rows, execution time, buffer reads, sort/hash spill, and selected index; it `MUST NOT` pin an exact planner node tree as a brittle test.
- Duplicate, unused, or queryless indexes `SHOULD` enter cleanup review.
- Index removal `MUST` account for constraint ownership, replica/query consumers, seasonal traffic, and observation-window length. A zero counter after restart is not sufficient removal evidence.

## 11. Constraints And Referential Integrity

Rules:

- Business uniqueness `MUST` be enforced by a database unique constraint, partial unique constraint, or documented serializing write boundary.
- Foreign key columns `SHOULD` be indexed.
- Database foreign keys are recommended when they match ownership and lifecycle boundaries; cross-service ownership may use application-level integrity with audit and repair jobs.
- Case-insensitive unique fields such as email or domain names `MUST` define normalization, collation, and uniqueness strategy.
- Required values `MUST` use `NOT NULL`; application-language non-null types are not database evidence.
- Defaults `MUST` be deterministic and semantically owned by either the database or application. A default `MUST NOT` conceal a missing tenant, actor, currency, status transition, or externally supplied business value.
- PostgreSQL `CHECK` constraints `SHOULD` enforce row-local invariants such as non-negative amounts, range ordering, state-dependent nullability, and bounded enum values.
- New foreign keys and checks on large PostgreSQL tables `SHOULD` use a staged `NOT VALID` plus `VALIDATE CONSTRAINT` flow when immediate validation would exceed the lock or availability budget.
- Deferrable constraints `MAY` be used only when the transaction contract requires end-of-transaction validation. They `MUST NOT` hide routine write-order bugs.

## 12. Enum Standard

Rules:

- Enums `MUST` document code, label, meaning, lifecycle, default, unknown-value handling, and compatibility behavior.
- Persisted enum values `SHOULD` avoid reusing retired values for new meanings.
- API and SDK enum representations `MUST` stay compatible with persisted values.

## 13. JSON And Semi-Structured Data

Rules:

- JSON fields `MAY` store extensions, provider payloads, sparse metadata, or low-frequency attributes.
- JSON fields `MUST` have a schema, version, validation strategy, and migration policy when used by production code.
- JSON `MUST NOT` be the only storage for tenant, owner, permission, amount, status, idempotency, lifecycle, or high-frequency filter/sort fields.
- Generated DTOs and OpenAPI schemas `SHOULD` represent stable JSON shapes.
- PostgreSQL production JSON uses `JSONB` by default and `MUST` be bound as a typed parameter. Dynamic JSON-path fragments, operators, or keys derived from user input require an allow-list and parameterized values.
- Frequently filtered or joined JSON properties `MUST` graduate to first-class columns or generated columns when query plans, integrity, or statistics require it.

## 14. Money, Measurement, And Precision

Rules:

- Money fields `MUST` store amount and currency. Currency `SHOULD` follow ISO 4217 unless a domain-specific unit is documented.
- Decimal precision, scale, rounding mode, tax basis, discount basis, and exchange-rate source `MUST` be documented for financial tables.
- Usage, quota, token, point, and unit balances `MUST` document unit, precision, reset or settlement semantics, and overflow behavior.

## 15. Time Standard

Rules:

- Runtime timestamps `MUST` use UTC semantics.
- API/SDK timestamp values `MUST` serialize as ISO 8601 UTC strings unless a specific external protocol says otherwise.
- Timezone-specific business dates `MUST` store both the date and the timezone or business calendar when required.
- Expiration, TTL, and legal-retention logic `MUST` define clock source, grace period, and cleanup ownership.

## 16. Multi-Tenant And Permission Filtering

Rules:

- Access-control predicates `MUST` be derived from trusted request context, not client-writable table fields or request bodies.
- Ordinary runtime SQL that reads or mutates an organization-scoped table `MUST` bind both `tenant_id` and `organization_id` from typed trusted context. Inserts `MUST` bind both columns; reads, updates, and deletes `MUST` constrain both predicates in the database operation before rows are returned or changed.
- Joins, CTEs, subqueries, aggregate replay, background workers, and batch paths do not weaken the scope rule. Every organization-scoped table reference that can expand the visible or mutable row set `MUST` remain tenant- and organization-bounded.
- Cross-organization system operations `MUST` be exposed as explicitly typed operations rather than generic repository methods. Each operation `MUST` have an independently authorized service or worker identity, a fixed and bounded SQL shape, an audit record or security-grade operational event, and repository-local machine-contract ownership. It `MUST NOT` be reachable from ordinary user/API query paths.
- Repository-local machine contracts `MUST` inventory organization-scoped tables and every approved cross-organization operation. An operation marker, SQL comment, method name, or static-check suppression is never authorization and `MUST NOT` create an open-ended allowlist.
- Static repository isolation gates `MUST` fail on every unscoped executable statement, unknown operation marker, or SQL shape outside the exact repository-local contract. The release threshold is zero unresolved violations; known-debt allowances are forbidden for pre-launch and commercial releases.
- Platform-level cross-tenant queries `MUST` require explicit admin/service authorization and audit evidence.
- Permission, role, and ABAC condition fields used by policies `MUST` be first-class indexed columns when they affect online access.
- Tests `MUST` cover cross-tenant and cross-user denial cases for security-sensitive repositories.
- PostgreSQL Row Level Security `SHOULD` be used as defense in depth for high-risk shared tables when request/session context can be set safely. RLS policy, `BYPASSRLS` ownership, connection-pool context reset, migrations, background jobs, and negative tests `MUST` be explicit.
- Runtime roles `MUST NOT` own application tables or have `BYPASSRLS`, superuser, database-create, role-create, or schema-create privileges unless a narrower capability is technically impossible and governed.
- Client-local SQLite filters are UX and data-minimization controls only; they are not a server authorization boundary.

## 17. Idempotency And Consistency

Rules:

- Retriable create, payment, webhook, message delivery, outbox, and command operations `MUST` define idempotency behavior.
- A duplicate idempotency key with the same request fingerprint `SHOULD` return the original result or current operation state.
- A duplicate idempotency key with a different fingerprint `MUST` be rejected as a conflict.
- Outbox/inbox tables `SHOULD` include event version, aggregate id, payload hash, dispatch state, retry count, and next retry time.
- Cross-aggregate writes `SHOULD` use events, sagas, or explicit transaction boundaries with retry behavior.
- Every write workflow `MUST` declare its PostgreSQL transaction boundary and isolation expectation. `READ COMMITTED` is the default only when statement-level snapshots preserve the invariant; stronger isolation or explicit locking is required otherwise.
- Serializable transactions and deadlock victims `MUST` retry only the complete idempotent transaction on PostgreSQL SQLSTATE `40001` or `40P01`, with bounded jittered backoff and an attempt budget. Retrying an arbitrary failed statement inside an already-aborted transaction is forbidden.
- Lock acquisition order `MUST` be stable for multi-row/multi-table writes. A transaction `MUST NOT` hold database locks while performing remote HTTP/RPC calls, user interaction, long computation, or unbounded iteration.
- Optimistic writes `MUST` perform a conditional update such as `WHERE id = $id AND version = $expected`, increment the version atomically, and distinguish not-found from concurrency conflict without a race.
- Queue claimers `MAY` use `FOR UPDATE SKIP LOCKED` when at-least-once processing, lease expiry, retry, poison-message, fairness, and reconciliation semantics are declared. `SKIP LOCKED` is not a general consistency shortcut.
- PostgreSQL advisory locks `MAY` coordinate rare coarse-grained operations only when lock-key derivation, session/transaction scope, collision analysis, timeout, and crash release are documented. Durable business invariants still require durable state or constraints.
- Read-replica use `MUST` declare read-after-write behavior, acceptable lag, stale authorization risk, failover behavior, and primary-read escalation. Security, entitlement, and immediate post-write reads `MUST` use the primary unless the contract proves a safe alternative.

## 18. Logs, Audit, And Ledger

Rules:

- Audit events `MUST` include actor, action, target, timestamp, trace id, and outcome when used for compliance or security.
- Ledger facts `MUST` be append-only or must use explicit reversal/adjustment records.
- Sensitive values such as passwords, tokens, private keys, verification codes, OAuth codes, and raw credentials `MUST NOT` be stored in logs, audit text, error messages, or unrestricted JSON blobs.
- Audit and ledger retention `MUST` align with privacy, legal hold, and regional requirements.

## 19. Security And Compliance

Rules:

- Sensitive columns `MUST` declare sensitivity, encryption, masking, retention, export, and access rules.
- High-sensitivity fields `SHOULD` use envelope encryption, tokenization, or an approved secret store when raw storage is not required.
- Data export paths `SHOULD` log actor, target, scope, reason, expiration, and destination.
- Data residency and cross-border synchronization `MUST` be reviewed for regulated data.
- Privacy deletion and retention workflows `MUST` document hard delete, anonymization, archive, and legal hold behavior.

## 20. API And SDK Contract

### 20.1 Field Naming

Database fields use `snake_case`. API/SDK fields follow `API_SPEC.md` and language-specific SDK conventions. Mapping must be deterministic and documented when names differ.

### 20.2 Serialization Rules

Rules:

- `int64` values that may exceed JavaScript safe integer range `MUST` serialize as strings in JSON HTTP APIs.
- Decimal values `MUST` serialize as strings or an approved structured decimal representation.
- Instants `MUST` serialize as ISO 8601 UTC strings.
- Enums `MUST` preserve unknown-value compatibility in generated SDKs.

### 20.3 Version And Concurrency

Rules:

- Mutable tables `SHOULD` use `version`, ETag, or equivalent revision fields when concurrent updates are possible.
- Failed optimistic concurrency checks `MUST` map to standard API precondition/conflict errors.

### 20.4 OpenAPI, GraphQL, gRPC

Rules:

- OpenAPI schemas `MUST` preserve database logical type semantics.
- gRPC/protobuf schemas `SHOULD` use `int64`, string decimal, and `google.protobuf.Timestamp` or equivalent safe representations.
- Generated SDKs `MUST` not hide precision, nullability, or enum compatibility problems.

### 20.5 Query, Sort, And Pagination Contract

Indexes must serve an explicit query contract before implementation.

Each list/search contract `MUST` declare:

| Field | Requirement |
| --- | --- |
| Filters | Allowed `WHERE` fields and their tenant/subject predicates. |
| Sort | Allowed sort fields, default sort, and unique tie-breaker. |
| Pagination | `cursor`/keyset or bounded `offset`. |
| Max page size | Public APIs `MUST` cap `page_size`; default `20`, max `200` unless a documented exception exists. |
| Scope | Tenant, organization, user, owner, or data-scope predicate. |
| Consistency | Primary/read-replica and freshness expectation. |

Rules:

- Large or fast-growing lists `MUST` use keyset/seek pagination on an indexed stable sort with a unique tie-breaker, for example `(updated_at, id)`.
- Offset pagination is allowed only for small tables, low-frequency admin lists, or capped page ranges.
- Persisted table lists `MUST` paginate in SQL with `LIMIT` or keyset predicates.
- Repository `find_all` followed by service `skip`/`take`/`slice` is forbidden.
- Projection/read-model lists `MUST` use incrementally maintained sorted indexes; rebuilding an unbounded collection per request and slicing it is forbidden.
- Query-shape changes require schema/index review because they affect API, SDK, and runtime cost.
- Cross-layer pagination authority is `PAGINATION_SPEC.md`.

## 21. Multi-Language Implementation Contract

Rules:

- Language models, ORM entities, SQL mappers, generated repositories, DTOs, and SDK schemas `MUST` preserve the portable contract.
- A language-specific default value or annotation `MUST NOT` replace a database constraint when the constraint is required for integrity.
- Rust sqlx, Java JPA, TypeScript query builders, Python ORMs, Go database access, and C# data layers `MUST` use parameter binding.
- Generated code `SHOULD` be regenerated from the contract rather than hand-edited.
- Language-specific packages `MUST` not fork ID generation, tenant filtering, pagination, or lifecycle behavior when a standard SDKWork utility exists.

## 22. Structure Evolution Standard

Rules:

- Schema changes `MUST` be versioned and reviewable.
- Breaking changes `MUST` use expand/backfill/compatible-read/cutover/contract flow.
- Field deletion `MUST` verify API, SDK, warehouse, search, cache, event, and consumer usage has migrated.
- Backfills `MUST` be resumable, observable, bounded, and safe to retry.
- Rollback or forward-fix strategy `MUST` be documented before release.
- Schema drift checks `SHOULD` compare contracts, migrations, live schema, ORM entities, and generated SDK/OpenAPI outputs.
- L0 compatibility windows `MUST` have owner, risk, and removal milestone.
- PostgreSQL production migrations are forward-first. A `.down.sql` file is optional and `MUST` exist only when reversal is demonstrably data-preserving, operationally bounded, and tested. Irreversible or lossy changes `MUST` declare `reversible: false` and a forward-fix plus restore/cutover strategy instead of a misleading down migration.
- Every PostgreSQL migration `MUST` declare transaction mode, expected lock level, lock timeout, statement timeout, estimated table/index size, write-traffic impact, replication impact, observability, cancellation behavior, and recovery action when any item is non-trivial.
- Metadata-only or fast-default assumptions `MUST` be validated against the minimum supported PostgreSQL version. A migration `MUST NOT` assume that adding a default, changing a type, or attaching a constraint is non-rewriting without version-specific evidence.
- Large backfills `MUST` run outside one unbounded schema transaction, process deterministic resumable chunks, rate-limit load, record progress, tolerate retries, and validate counts/checksums before cutover.
- Column renames and type changes on live contracts `MUST` use additive columns or compatibility views/adapters until all writers, readers, SDKs, CDC, reports, search, and exports migrate.
- PostgreSQL enum types `MAY` be used only when their evolution constraints fit the domain. Frequently changing public enums `SHOULD` use constrained text plus a registry/dictionary rather than requiring unsafe enum surgery.
- SQLite client-local migrations own a separate history and may rebuild tables when SQLite requires it, but they `MUST` preserve user-local data atomically, verify free disk space, support interrupted-upgrade recovery, and never be derived blindly from PostgreSQL migrations.

## 23. Data Lifecycle

Rules:

- Stateful resources `MUST` document state machine, valid transitions, terminal states, and audit behavior.
- Archive, TTL, purge, legal hold, anonymization, and export flows `MUST` document ownership and scheduling.
- Cold/hot separation `MUST` define query entry points so applications do not assume the hot table contains full history.
- Backups and recovery objectives `SHOULD` be documented for L2 and `MUST` be documented for L3.
- PostgreSQL L2/L3 owners `MUST` define backup method, retention, encryption, restore target, point-in-time recovery coverage where required, RPO, RTO, and a scheduled restore exercise. A successful backup job without a verified restore is not recovery evidence.
- High-write or high-churn PostgreSQL tables `MUST` monitor dead tuples, autovacuum/analyze recency, transaction-id age, long-running transactions, bloat indicators, and replication/WAL pressure. Per-table autovacuum or fillfactor tuning requires measured evidence and rollback.
- Partitioning `MUST` solve a declared retention, pruning, maintenance, or size problem. It `MUST` define partition key, uniqueness implications, partition creation, default-partition handling, retention detach/drop, global query behavior, and recovery. Partitioning by tenant by default is forbidden.

## 24. Derived Data And Read Models

Rules:

- Derived tables `MUST` declare source tables/events, transform version, rebuild procedure, freshness expectation, and drift detection.
- Read models `MUST` be rebuildable or have a documented recovery strategy.
- Search and cache mirrors `MUST` preserve permission and tenant filtering semantics.
- Data lineage `SHOULD` cover warehouse, lakehouse, CDC, topics, search indexes, caches, and reports.

## 25. Non-Relational Database Adaptation

Rules:

- Document stores, search engines, column stores, object stores, and event streams `MUST` preserve identity, tenant scope, lifecycle, security, and lineage semantics from this standard.
- Non-relational systems `MUST` define the equivalent of primary identity, uniqueness, query shape, pagination, retention, and rebuild strategy.
- A non-relational optimization `MUST NOT` become the sole source of truth for fields whose authoritative contract is relational unless explicitly approved.

## 26. Automated Check Rules

CI, schema linters, migration tools, or repository audits `SHOULD` implement these rule identifiers.

| Rule | Level | Requirement |
| --- | --- | --- |
| DB001 | MUST | Table and column names use lowercase `snake_case`. |
| DB002 | MUST | Persistent business tables have primary keys. |
| DB003 | MUST | L1+ business tables have `id`, `created_at`, and `updated_at` where mutable. |
| DB004 | SHOULD | Core business tables have unique `uuid` or equivalent external id. |
| DB005 | MUST | Tenant-scoped tables have `tenant_id`. |
| DB006 | MUST | Tenant-scoped list indexes lead with `tenant_id` unless justified. |
| DB007 | MUST | Money and precise numeric fields do not use float/double. |
| DB008 | MUST | `int64` API serialization strategy is declared. |
| DB009 | SHOULD | Status fields have enum documentation or dictionary. |
| DB010 | MUST | Idempotent flows have a unique dedupe boundary. |
| DB011 | SHOULD | JSON fields have schema or typed DTO. |
| DB012 | MUST | Sensitive fields have classification and storage strategy. |
| DB013 | MUST | Breaking schema changes have expand/contract plan. |
| DB014 | SHOULD | Foreign-key-like columns have supporting indexes. |
| DB015 | SHOULD | Large-table index changes document online strategy. |
| DB016 | MUST | Time fields use UTC/ISO 8601 strategy. |
| DB017 | SHOULD | Soft-delete tables define uniqueness behavior. |
| DB018 | MUST | L3 tables have audit, retention, recovery, and validation plan. |
| DB019 | SHOULD | Derived tables declare source object and sync version. |
| DB020 | MUST | Platform cross-tenant queries are explicitly authorized. |
| DB021 | MUST | Shared tables have system of record and write owner. |
| DB022 | SHOULD | Contracts have version and compatibility window. |
| DB023 | MUST | Case-insensitive unique fields define normalization strategy. |
| DB024 | SHOULD | Large tables document partitioning, sharding, or growth plan. |
| DB025 | MUST | Critical concurrent writes have locks, versions, conditional updates, or unique constraints. |
| DB026 | SHOULD | List queries have sort and pagination contracts. |
| DB027 | MUST | Public APIs cap maximum `page_size`. |
| DB027A | MUST | Persistent lists paginate in SQL/keyset or maintained indexes; in-process full-load slicing is forbidden. |
| DB028 | SHOULD | L3 tables have RPO/RTO and recovery exercise evidence. |
| DB029 | SHOULD | CDC downstream compatibility is included in schema evolution. |
| DB030 | MUST | Field deletion verifies SDK, warehouse, search, cache, and consumers have migrated. |
| DB031 | SHOULD | Data quality covers completeness, uniqueness, validity, and consistency. |
| DB032 | SHOULD | Critical tables expose slow-query, lock-wait, CDC-delay, and data-quality metrics. |
| DB033 | MUST | Passwords, tokens, private keys, and verification codes never appear in logs/audit/error text. |
| DB034 | SHOULD | Object-storage resources have metadata table or manifest. |
| DB035 | MUST | Event schema has version and unknown-field compatibility policy. |
| DB036 | SHOULD | Text unique fields declare charset, collation, and normalization. |
| DB037 | MUST | Core tables declare business domain and write owner. |
| DB038 | SHOULD | Shared semantics declare bounded context. |
| DB039 | SHOULD | Snapshot and denormalized fields declare source and schema version. |
| DB040 | MUST | EAV/JSON does not carry amount, status, tenant, permission, idempotency, or lifecycle core fields. |
| DB041 | SHOULD | L2/L3 tables have capacity model and index forecast. |
| DB042 | SHOULD | Duplicate or queryless indexes enter cleanup review. |
| DB043 | MUST | High-sensitivity fields declare sensitivity and masking rule. |
| DB044 | SHOULD | Data export paths have audit and expiration strategy. |
| DB045 | SHOULD | Warehouse, search, cache, and topic fields have lineage. |
| DB046 | SHOULD | L3 critical fields declare freshness SLO. |
| DB047 | MUST | ABAC/RLS policy fields are not JSON-only. |
| DB048 | SHOULD | Policy-as-code has version, tests, and rollback plan. |
| DB049 | MUST | ID generation declares clock rollback, node conflict, and failure behavior. |
| DB050 | SHOULD | Public ids do not expose sequential internal ids by default. |
| DB051 | MUST | Third-party ids use provider plus external id uniqueness boundary. |
| DB052 | MUST | Money fields declare currency, precision, and rounding mode. |
| DB053 | SHOULD | Tax, discount, and exchange-rate fields declare calculation basis and source. |
| DB054 | MUST | L3 tables declare read consistency and replica-delay strategy. |
| DB055 | MUST | Data residency and cross-border sync enter security review. |
| DB056 | SHOULD | Reference/seed/lookup data is managed by idempotent scripts or controlled release. |
| DB057 | MUST | Published reference codes are not reused with new meanings. |
| DB058 | SHOULD | CI or scheduled audits execute schema drift checks. |
| DB059 | MUST | ORM, DDL, schema registry, API, and SDK contract changes stay synchronized. |
| DB060 | SHOULD | L3 tables have operational runbook and exercise record. |
| DB061 | MUST | New business table first segment is a registered business module prefix. |
| DB062 | MUST | Table prefixes do not use product, project, company, or technology names as default business prefix. |
| DB063 | SHOULD | Product/deployment namespace lives at schema/catalog/database layer, not table-name prefix. |
| DB064 | MUST | Module prefix registers owner, bounded context, and example tables. |
| DB065 | MUST | Cross-module shared tables use the source-of-record module prefix. |
| DB066 | SHOULD | Legacy project-level prefixes have target module prefix mapping and cleanup plan. |
| DB067 | MUST | Multiple entity contracts mapped to one physical table have shared-semantics proof or conflict remediation. |
| DB068 | MUST | Legacy table-prefix gaps are classified by priority and risk. |
| DB069 | MUST | Owner-review tables confirm system-of-record owner before target name approval. |
| DB070 | SHOULD | External channel, connector, and provider account tables use `integration_` or a more specific approved prefix. |
| DB071 | SHOULD | Workspace, project, application, and template design-time assets use `studio_` or a more specific approved prefix. |
| DB072 | SHOULD | Entity annotations, DDL, migrations, audit files, and schema linter rules share the same prefix registry. |
| DB073 | MUST | Authoritative server relational persistence declares `databaseRole=authoritative-server` and uses PostgreSQL. |
| DB074 | MUST | SQLite declares `databaseRole=client-local` and is not used by a server, shared-state, or system-of-record runtime. |
| DB075 | MUST | PostgreSQL-native correctness and operability are not weakened to preserve SQLite physical parity. |
| DB076 | MUST | Server database release evidence includes real PostgreSQL migration and repository integration tests. |
| DB077 | MUST | SQLite DDL/migrations are not generated by blind transliteration of PostgreSQL SQL. |
| DB078 | MUST | P0/P1 or high-growth PostgreSQL queries have representative plan and buffer evidence. |
| DB079 | MUST | Non-trivial PostgreSQL migrations declare lock, timeout, rewrite, replication, backfill, observation, and recovery behavior. |
| DB080 | MUST | Offline mutation declares identity mapping, idempotency, ordering, tombstones, conflict resolution, retry, and rejection behavior. |
| DB081 | MUST | Client-local SQLite is isolated by profile/environment/origin/account and has logout/removal purge behavior. |
| DB082 | MUST | PostgreSQL owner, migrator, runtime, read-only/analytics, and backup roles follow least privilege with a fixed safe `search_path`. |
| DB083 | MUST | PostgreSQL serialization failures and deadlocks retry the complete idempotent transaction with a bounded budget. |
| DB084 | MUST | Lossy or irreversible migrations use forward-fix/restore strategy rather than an unsafe generic down migration. |
| DB085 | SHOULD | L2/L3 PostgreSQL recovery evidence includes a scheduled restore or point-in-time recovery exercise. |
| DB086 | MUST | Organization-scoped tables include both `tenant_id` and `organization_id`. |
| DB087 | MUST | Ordinary runtime SQL binds tenant and organization scope for every organization-scoped read or mutation. |
| DB088 | MUST | Cross-organization operations are typed, independently authorized, bounded, audited, machine-inventoried, and rejected when their exact SQL shape is not approved. |
| DB089 | MUST | `organization_id` columns are `NOT NULL` with the platform sentinel default (`0` / `'0'` / zero-UUID); nullable `organization_id` is a contract violation. |
| DB090 | MUST | Platform-wide or "no organization" rows use the sentinel `organization_id = '0'`; `NULL` is never a valid organization scope. |
| DB091 | MUST | Runtime queries resolve a missing IAM organization context to the sentinel or match it explicitly; predicates matching only `organization_id IS NULL` are contract violations. |
| DB092 | MUST | Legacy nullable `organization_id` migrations backfill the sentinel before `SET NOT NULL` and are idempotent. |
| DB093 | MUST | New DDL references `organization_id` directly in unique indexes/constraints; `COALESCE(organization_id, '0')` is a legacy migration fact only. |

## 27. Design Review Checklist

New table review:

- [ ] Business domain, bounded context, and write owner are declared.
- [ ] Database role is explicit: PostgreSQL `authoritative-server` or SQLite `client-local`.
- [ ] Table profile and standard fields are selected.
- [ ] Tenant, organization, user, owner, and data-scope semantics are correct.
- [ ] Organization-scoped tables and ordinary runtime SQL bind both tenant and organization scope; approved cross-organization operations are typed, bounded, authorized, audited, and machine-inventoried.
- [ ] ID generation, UUID/public id, and seed id behavior are documented.
- [ ] Localized persisted values, when present, are modeled with stable base rows plus translation rows and deterministic locale seed history.
- [ ] Query shapes, indexes, sort, pagination, and page-size limits are documented.
- [ ] API/SDK serialization for `int64`, decimal, instant, enum, and JSON is safe.
- [ ] Sensitive fields, retention, export, deletion, and audit behavior are documented.
- [ ] Migration, backfill, rollback/forward-fix, and drift checks are ready.
- [ ] PostgreSQL transaction isolation, locks, SQLSTATE retry behavior, query plans, role privileges, backup/restore, and operational budgets are reviewed.
- [ ] SQLite, when present, has a separate client-local contract, profile/account isolation, local security/purge policy, and sync/conflict evidence.
- [ ] Repository tests cover isolation, pagination, conflicts, and idempotency where relevant.

## 28. Anti-Patterns

Forbidden or migration-only patterns:

- New runtime tables using database auto-increment ids for SDKWork business identity.
- Project-level table prefixes for new business tables.
- Catch-all `common`, `system`, `data`, or `misc` tables without bounded context.
- JSON/EAV as the only storage for core query, permission, amount, status, lifecycle, or idempotency fields.
- Unbounded repository `find_all` followed by service/client pagination.
- Direct pool construction in handlers, services, repositories, or background jobs.
- Raw SQL string concatenation with user input.
- Generic or globally callable cross-organization repository methods, including unbounded journal replay, export, search, or mutation.
- SQL comments, markers, lint suppressions, or method names treated as authorization for an unscoped query.
- Manual production schema edits without reconciliation into migrations and schema registry.
- SQLite used by a service, server, container, cloud workload, shared gateway module, shared worker, or server-side system of record.
- Server completion or compatibility claims based only on SQLite tests.
- One physical DDL/migration tree copied between PostgreSQL and SQLite or converted with regex/type substitution.
- Avoiding PostgreSQL constraints, types, indexes, RLS, locks, or query features only to keep SQLite parity.
- SQLite files on shared/network filesystems or concurrently shared as a multi-user server database.
- Trusting client-local tenant, permission, price, quota, entitlement, ledger, or audit values as server authority.
- Blind `down.sql` execution for lossy migrations or production rollback without data-preservation evidence.

## 29. Adoption Route

New systems:

- Declare `databaseRole` before selecting assets or drivers.
- Define the PostgreSQL authoritative schema contract before DDL, ORM entities, repositories, and SDKs.
- Register module prefixes and ownership before creating tables.
- Wire schema validation, migration tests, repository tests, and API/SDK generation into CI.
- Add a separate SQLite client-local contract only when a client-local requirement exists.

Existing systems:

- Register L0 compatibility facts in the owning repository.
- Classify every existing database as PostgreSQL `authoritative-server`, SQLite `client-local`, or non-compliant mixed/ambiguous storage before changing DDL.
- Map legacy names, ids, timestamps, tenant fields, table prefixes, and engine roles to the standard.
- Classify gaps by risk and prioritize P0 conflict fixes before renames.
- Migrate through expand/backfill/validate/cutover/contract; do not rename physical tables without a separate plan.

## 30. Legacy Compatibility And Migration Boundaries

Legacy compatibility exists only to migrate already-launched systems. It is not an alternate design path for new or pre-launch applications.

Rules:

- New applications and new modules `MUST` implement this standard directly.
- Existing server-side SQLite implementations are L0 migration inputs only. They `MUST` migrate authoritative data and runtime behavior to PostgreSQL or be reclassified and isolated as client-local data with an accepted ADR and sync/ownership contract.
- Existing mixed PostgreSQL/SQLite service repositories `MUST` split authoritative server assets from client-local assets. Continuing to require feature-equivalent DDL on both engines is not an approved compatibility strategy.
- Legacy Java/JPA base classes, historical table prefixes, ORM filters, and old migration scripts `MAY` be mapped to this standard only as registered L0 compatibility inputs.
- An L0 database exception `MUST` record owner, affected tables, compatibility window, risk, target standard name, migration or retirement plan, and validation evidence.
- Global standard files `MUST NOT` hard-code consumer repository paths, one-off scan counts, physical table inventories, or consumer-specific rename backlogs.
- Physical table rename work `MUST` be handled by a separate migration plan with expand/backfill/validate/cutover/contract steps, rollback or forward-fix strategy, and release evidence.

Generic compatibility mapping examples:

| Legacy concept | Standard target |
| --- | --- |
| historical base entity with tenant fields | `tenant_entity` plus audit and lifecycle fields. |
| historical base entity without tenant fields | `core_entity` plus audit and lifecycle fields. |
| historical user-owned entity | `user_entity` with `tenant_id`, `user_id`, and subject-scope indexes. |
| historical tree entity | `tree_entity` with parent id, path, level, sort order, and cycle/depth constraints. |
| historical owner fields | `owner_scope` with `owner_type`, `owner_id`, and indexed ownership predicates. |
| historical short version field | `version` with optimistic concurrency semantics. |
| historical creation/update time fields | `created_at`, `updated_at` with UTC serialization. |
| ORM tenant filters | standard tenant, organization, user, owner, and data-scope predicates enforced before repository access. |

## 31. Minimum Compliance Example

An L2 multi-tenant business table `MUST` declare stable identity, tenant scope, audit fields, lifecycle fields, optimistic concurrency, and query-serving indexes.

```sql
CREATE TABLE content_document (
    id BIGINT NOT NULL,
    uuid UUID NOT NULL,
    tenant_id BIGINT NOT NULL,
    organization_id BIGINT NOT NULL DEFAULT 0,
    user_id BIGINT NOT NULL,
    data_scope INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    status INTEGER NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by BIGINT,
    PRIMARY KEY (id),
    CONSTRAINT uk_content_document_uuid UNIQUE (uuid),
    CONSTRAINT ck_content_document_title_length
        CHECK (char_length(title) BETWEEN 1 AND 200),
    CONSTRAINT ck_content_document_status
        CHECK (status IN (0, 1, 2, 3))
);

CREATE INDEX idx_content_document_tenant_user_status_updated
    ON content_document (tenant_id, organization_id, user_id, status, updated_at, id);
```

The table contract `MUST` state the ID provider, external id policy, subject scope source, status enum, JSON schema, HTTP/SDK serialization, delete/archive policy, optimistic concurrency field, and list/search contract.

## 32. Database Connection Pool Standard

SDKWork-owned runtime services `MUST` create database pools through `sdkwork-database`, the approved database framework, or an approved adapter with equivalent configuration, telemetry, and lifecycle behavior.

Rules:

- Production runtime code `MUST NOT` call low-level pool constructors such as `SqlitePoolOptions::new()`, `PgPoolOptions::new()`, or equivalent constructors directly from handlers, services, repositories, background jobs, or migrations.
- Pool construction `MUST` be centralized in the database lifecycle layer, application bootstrap, or `sdkwork-database` adapter.
- A process that embeds two or more database-backed modules `MUST` follow `DATABASE_SPEC_PROCESS_SHARED_POOL.md`: enable or create one process pool before module bootstrap and inject/reuse cloned handles.
- `MAX_CONNECTIONS` is a process-level budget for an integrated database identity. It `MUST NOT` be multiplied by independently constructed module pools.
- Compatibility constructors such as `*_from_env()` `MUST` resolve the installed process pool before creating a new pool and `MUST` fail closed when the normalized identity differs.
- Pool configuration `MUST` be environment/profile driven and must not hard-code credentials, hostnames, pool sizes, or table prefixes in business code.
- Every production pool `MUST` expose health, readiness, latency, acquire timeout, active/idle connection, and migration/drift status metrics.
- Tests `MAY` use simplified in-memory or temporary database helpers, but those helpers must stay under test code.
- Authoritative server integration and release tests `MUST` use PostgreSQL. In-memory SQLite and temporary SQLite helpers are allowed only for a declared `client-local` adapter and do not satisfy server database evidence.
- Embedded client-local SQLite access `MUST` be owned by one native persistence adapter per local database identity. The adapter `MUST` serialize writes or otherwise prove safe concurrent access; it is not a server process-pool substitute.

## 33. Database Lifecycle Framework Integration

### 33.1 Overview

Database bootstrap, migration, seed data, drift observation, lifecycle SPI, and standard `db:*` commands follow `DATABASE_FRAMEWORK_SPEC.md` and `PNPM_SCRIPT_SPEC.md`.

### 33.2 Configuration

Database-owning processes `MUST` use the workspace-scoped pool and lifecycle keys:

```text
SDKWORK_DATABASE_SQLITE_URL
SDKWORK_DATABASE_MAX_CONNECTIONS
SDKWORK_DATABASE_MIN_CONNECTIONS
SDKWORK_DATABASE_ACQUIRE_TIMEOUT
SDKWORK_DATABASE_IDLE_TIMEOUT
SDKWORK_DATABASE_MAX_LIFETIME
SDKWORK_DATABASE_AUTO_MIGRATE
SDKWORK_DATABASE_AUTO_SEED
```

Client-local SQLite connection identity is owned by `SDKWORK_DATABASE_SQLITE_URL` alone (see `ENVIRONMENT_SPEC.md` §7.2). It is a `sqlite:` URL scoped to one installation plus its declared profile, environment, origin, and account boundary; it is not a PostgreSQL alias and `MUST NOT` be derived from or merged with the `SDKWORK_DATABASE_URL`/structured PostgreSQL fields. Desktop and native client processes resolve SQLite through this key; server/container processes resolve the authoritative PostgreSQL profile and `MUST NOT` set it.

Workspace PostgreSQL connection identity and process pool/lifecycle policy come from `SDKWORK_DATABASE_*` according to `ENVIRONMENT_SPEC.md` section 7.1. Service-scoped keys `MUST NOT` redefine or alias these fields. In particular, SDKWork workspace development uses database `sdkwork_ai_dev` and schema `sdkwork_ai_dev`, tests use `sdkwork_ai_test` or workspace-scoped ephemeral `sdkwork_ai_test_<run_id>`, staging uses `sdkwork_ai_staging`, and production uses `sdkwork_ai_prod`. Application-specific identities such as `sdkwork_<application-code>_dev`, `<application_code>_test_<run_id>`, or per-module schemas are forbidden.

The concrete manifest shape, directory layout, and lifecycle hooks are owned by `DATABASE_FRAMEWORK_SPEC.md`.

### 33.3 PostgreSQL Authoritative Server Profile

Rules:

- PostgreSQL profiles `MUST` configure `application_name`, TLS/SSL mode, connect/acquire timeout, statement timeout, lock timeout, idle-in-transaction timeout, idle timeout, maximum lifetime, minimum/maximum pool bounds, and a fixed safe `search_path` explicitly.
- Production PostgreSQL `sslmode=disable` is forbidden. `verify-full` is preferred; weaker modes require a documented network and certificate trust model.
- PostgreSQL versions `MUST` be within upstream or approved managed-provider support. The minimum/maximum supported major versions, required extensions, collation/locale, encoding, timezone, and upgrade path `MUST` be declared and tested.
- Database ownership and runtime access `MUST` be separated into least-privilege roles where supported: owner/bootstrap, migrator, application runtime, read-only/analytics, and backup/replication. Runtime credentials `MUST` not own schema objects.
- Connections `MUST` set UTC timezone and a controlled, canonical-only `search_path`; application schemas and extension schemas `MUST` be explicit. Writable fallback schemas such as `public` `MUST NOT` appear anywhere in the normal application or lifecycle search path. A temporary fallback requires a dated governance exception, collision tests, and a removal milestone; extension objects outside the canonical schema are schema-qualified.
- Poolers `MAY` be used only with a declared session/transaction pooling mode and compatibility evidence for prepared statements, session variables, advisory locks, RLS context, listen/notify, temp tables, and migration connections.
- Every database-owning process follows `DATABASE_SPEC_PROCESS_SHARED_POOL.md`; its IM section owns the migration from dual sqlx/r2d2 pools.

### 33.4 SQLite Client-Local Profile

Rules:

- SQLite profiles `MUST` declare `databaseRole=client-local` and apply `PRAGMA foreign_keys=ON`, WAL journal mode where the platform supports it safely, a bounded busy timeout, and an explicit synchronous policy through the approved adapter. Durability-critical local-only data should use `synchronous=FULL`; rebuildable caches may use `NORMAL` with a documented loss model.
- The adapter `SHOULD` configure and verify `journal_size_limit`, `wal_autocheckpoint` or explicit checkpoints, page/cache sizing, and `PRAGMA optimize` from measured workload needs. It `MUST` monitor or recover from unbounded WAL growth.
- One writer coordinator `SHOULD` own mutations. Transactions `MUST` be short, bounded, and free of remote calls. `SQLITE_BUSY` retry uses bounded backoff and must surface a recoverable error after the budget.
- SQLite files, WAL, shared-memory files, backups, and temporary copies `MUST` stay in the platform-approved user/app-private directory with restrictive permissions. They `MUST NOT` be placed beside the executable, in source trees, browser-public storage, shared/network storage, or server data directories.
- Sensitive local data `MUST` declare encryption-at-rest, key storage, lock-screen/background behavior, backup inclusion, export, logout/account-switch purge, uninstall behavior, and incident response. Access/refresh tokens, private keys, and raw credentials belong in OS secure storage or an approved secret store, not ordinary SQLite columns.
- Local databases `MUST` be isolated by lifecycle environment, deployment profile, API origin, tenant/account, and application profile. Switching any identity boundary `MUST NOT` reuse rows, WAL files, offline queues, or encryption keys implicitly.
- SQLite integrity recovery `MUST` define startup checks, migration backup or atomic replacement, corruption handling, disk-full behavior, schema-version compatibility, and a rebuild path for projections/caches.
- Client-local runtime business IDs `MUST` still use the approved SDKWork ID provider or a declared temporary local identifier with deterministic server-id mapping. SQLite rowid allocation is not SDKWork business identity.

### 33.5 Deployment Profiles

Rules:

- `standalone` workspace development: all application services use the shared `sdkwork_ai_dev` database and `sdkwork_ai_dev` schema. Each service or module owns only its declared tables, indexes, constraints, seeds, and migrations; it `MUST NOT` provision a per-application or per-module database or schema.
- `test` server profile: all server modules in one test run use one workspace-scoped PostgreSQL database and schema: `sdkwork_ai_test` or ephemeral `sdkwork_ai_test_<run_id>`. Test isolation `MUST NOT` be expressed as `<application_code>_test`, `<module_id>_test`, or a private schema per dependency module.
- `staging` and `production` profiles: all modules in the same deployed workspace use the deployment-managed workspace PostgreSQL identity (`sdkwork_ai_staging` or `sdkwork_ai_prod` by default) unless a governed multi-tenant or regional database split is approved in deployment architecture. Module boundaries remain table/registry/migration boundaries, not schema/database boundaries.
- `cloud` profile: database configuration comes from managed deployment configuration and must expose lifecycle/drift health.
- Embedded modules in the same OS process `MUST` share the approved process-level pool for the same normalized database identity and `MUST NOT` open independent pools against the same DSN/schema/driver.
- External upstream services and worker processes own their lifecycle bootstrap and must not assume local process sharing.
- `standalone` server/container, cloud server/container, worker, CLI host, and desktop-started backend service profiles `MUST` use PostgreSQL.
- `test` server profile `MUST` use an isolated PostgreSQL workspace database or schema for contract/integration evidence. SQLite test databases are allowed only for client-local contracts.
- Desktop/tablet/mobile client profiles `MAY` use SQLite only for their client-local database role; selecting a desktop runtime target does not authorize a colocated backend service to use SQLite.

## 34. Repository Standard

Repositories are the persistence boundary. They translate domain query contracts into bounded database operations and must not become business-service or API-controller substitutes.

Rules:

- Repository interfaces `SHOULD` be named by aggregate/domain intent, not by generic table CRUD alone.
- Repository methods `MUST` accept typed filters, typed sort options, pagination input, request scope, and transaction context where relevant.
- Repository methods `MUST` enforce tenant, organization, user, owner, and data-scope predicates before returning business data.
- Ordinary repository methods over organization-scoped data `MUST` require explicit tenant and organization inputs and bind both in the database statement. A cross-organization system operation belongs behind a separate typed port and `MUST NOT` reuse an unscoped ordinary repository method.
- Repository methods `MUST NOT` load unbounded rows and rely on service-layer `skip`/`take`/`slice` pagination.
- `find_all`, `list_all`, or equivalent helpers `MUST NOT` be used on P0/P1 interactive or public API paths unless the data set is statically bounded and documented.
- Entity/record structs `MUST` remain persistence data shapes; business workflows, authorization decisions, and API response assembly belong in service or handler layers.
- Raw SQL is allowed only when the query shape, indexes, pagination, tenant predicates, parameters, and result mapping remain explicit and reviewed.
- Repository code `MUST` use parameter binding and must not concatenate user input into SQL.
- PostgreSQL repositories `MUST` classify expected SQLSTATE outcomes such as unique violation, foreign-key violation, check violation, serialization failure, deadlock, lock timeout, statement timeout, and connection failure into stable domain/framework errors. Matching localized database message text is forbidden.
- Queries `SHOULD` select explicit columns. `SELECT *` is forbidden in stable production mappings, migrations/backfills, public projections, and CDC contracts where column addition or order can change behavior.

Repository tests `MUST` cover negative tenant and organization isolation for organization-scoped data. They `SHOULD` also cover sorting, pagination boundaries, optimistic concurrency conflicts, idempotency behavior, and L0 registered table compatibility.

## 35. Database Health, Migration, And Lifecycle

Database health checks and lifecycle operations are part of production readiness, not optional documentation.

Rules:

- Every database-owning service `SHOULD` expose database health and readiness signals through the standard application health surface.
- Readiness `MUST` fail when required migrations are missing, the pool cannot acquire a connection within the configured timeout, or the schema drift state blocks writes.
- Health signals `SHOULD` include latency, acquire timeout, pool size, active connections, idle connections, migration version, and drift status.
- PostgreSQL health and operations `SHOULD` include server version, recovery/primary role, replica lag when used, transaction-id age, long transactions, blocked/locking sessions, deadlocks, statement/lock timeouts, temporary-file spill, WAL/replication pressure, autovacuum/analyze freshness, and backup/restore evidence without exposing SQL text or secrets.
- `pg_stat_statements` or an approved managed equivalent `SHOULD` support normalized query performance analysis. Raw SQL, bind values, tenant ids, tokens, secrets, and sensitive payloads `MUST NOT` become unbounded metric labels or logs.
- Schema changes `MUST` use managed migrations or an approved lifecycle framework; ad hoc manual SQL is allowed only as a documented incident action with post-incident reconciliation.
- Application roots with relational databases `MUST` provide the standard `database/` asset structure required by `DATABASE_FRAMEWORK_SPEC.md`.
- Lifecycle orchestration `MUST` use `sdkwork-database` or an approved compatible adapter; applications must not maintain a competing lifecycle engine.
- The executable L1 framework profile is defined by `../sdkwork-database/specs/DATABASE_FRAMEWORK_STANDARD.md`.

## 36. Summary

This standard keeps logical data semantics portable while making the physical implementation boundary unambiguous: PostgreSQL is the authoritative server database, and SQLite is a client-local embedded database.

A compliant SDKWork database design keeps these contracts stable:

- `id` and `uuid` define internal identity, external references, and cross-store synchronization.
- `created_at`, `updated_at`, and `version` define audit and concurrency semantics.
- `tenant_id`, `organization_id`, `user_id`, `owner_type`, `owner_id`, and `data_scope` define isolation and ownership.
- `status`, `deleted_at`, `archived_at`, and `retention_until` define lifecycle state.
- `idempotency_key`, `external_event_id`, and `payload_hash` define retry and event consistency.
- Query contracts, indexes, and pagination prevent unbounded runtime scans.
- PostgreSQL-native constraints, transactions, plans, roles, migrations, backup/restore, and observability protect authoritative data.
- SQLite profile isolation, local security, short transactions, corruption recovery, and explicit sync contracts protect client-local data without pretending it is server authority.
- Structure evolution, schema registry, drift checks, and review evidence keep the standard enforceable over time.
