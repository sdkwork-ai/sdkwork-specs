# ADR-20260917 Web Framework Table Prefix

Status: accepted
Requirement: REQ-2026-0917
Owner: web-framework-platform
Date: 2026-09-17
Specs: `DATABASE_SPEC.md`

## Context

`sdkwork-web-framework` owns eight platform-infrastructure tables that serve every hosted application: rate-limit buckets, rate-limit policies, idempotency records, CORS policies, audit events, security events, tenant runtime profiles, and control nodes. They historically used the `web_` prefix.

That prefix was wrong for two independent reasons.

First, it was **not registered**. `tools/database-module-registry.json` registered `sdkwork-web-framework` under `moduleId: webstore`, so the registry-authorised prefix for this repository was `webstore_`, while the shipped DDL, manifest, and contract all declared `web_`.

Second, it **collided**. `sdkwork-webserver` also declares `web_` for its own business tables (26 of them, including `web_audit_log`). One prefix therefore had two owners: live framework infrastructure on one side, and business tables scheduled for retirement on the other. Any prefix-scoped operation — bulk rename, bulk drop, ownership audit — becomes ambiguous and unsafe, because the two sets cannot be told apart by prefix alone.

`DATABASE_SPEC.md` §7 requires `<module_prefix>` to be a registered business module or bounded-context prefix. The unregistered, doubly-claimed `web_` satisfied neither half.

## Decision

The eight `sdkwork-web-framework` tables use **`framework_`** as their module prefix.

`framework_` names the bounded context this module owns — the host application's web-framework layer: ingress governance, rate limiting, idempotency, CORS, audit and security events, tenant runtime profiles, and control-node registration. It names the context, not a technology choice.

The prefix is registered in `tools/database-module-registry.json` (`repo: sdkwork-web-framework`, `moduleId: framework`, `ownerTeam: web-framework-platform`), and that registry entry is the sole authority for ownership.

To admit this case without weakening the rule, §7 drops `framework` from its prohibited-word list and gains one clause: a platform infrastructure layer that owns a bounded context `MAY` register a descriptive prefix naming that context, provided the prefix is registered before first use.

This section originally scoped the decision to the **table prefix only**, leaving `moduleId`, the baseline filename, and `serviceCode` untouched. **Amendment 1** extends it to `moduleId` and the baseline filename, because the baseline filename is mechanically derived from `moduleId` (`0001_${moduleId}_baseline.sql`) and the two cannot be allowed to disagree. `serviceCode` (`WEB_STORE`) and the crate name (`sdkwork-web-store-sqlx`) remain unchanged: they are release-contract and package-identity surfaces consumed by release tooling and cross-repository references, and no gate derives them from the prefix.

## Alternatives

- **Keep `web_` and make webserver give way**: rejected. `web_` is unregistered, so nothing can be ceded; and the webserver tables under it are business tables already marked for retirement. Handing a registered identity to an unregistered prefix deepens the double ownership instead of resolving it.
- **Use the already-registered `webstore_`**: rejected. `webstore` is this module's legacy product name, still visible in its crate name (`sdkwork-web-store-sqlx`) and `serviceCode` (`WEB_STORE`), but it does not express the bounded context the tables serve. A table prefix must let a reader tell framework-layer infrastructure apart from business repository tables at a glance; `webstore_rate_limit_bucket` still reads like a store's table.
- **Keep the table prefix decision but leave `moduleId: webstore`**: rejected (see Amendment 1). `moduleId` is not a free-floating label here — it is the input from which the baseline filename and the `db:materialize:contract --module-id` argument are derived. Leaving it at `webstore` would ship `moduleId: webstore` beside `tablePrefix: framework_` and a `0001_webstore_baseline.sql` that creates only `framework_*` tables: three surfaces describing one module in two vocabularies.
- **Rename the crate (`sdkwork-web-store-sqlx`) and `serviceCode` (`WEB_STORE`) too**: rejected. Those are package-identity and publishing-contract surfaces referenced from other repositories and from release tooling; the benefit does not justify the blast radius, and no prefix gate reads them.
- **Keep `web_` and merely register it**: rejected. It would legalise the double claim, and §7 forbids keeping a project-level prefix on pre-launch tables.

## Consequences

- Eight tables, 19 indexes, and 8 primary keys are renamed from `web_*`/`idx_web_*` to `framework_*`/`idx_framework_*` (counted from the PostgreSQL baseline, `database/ddl/baseline/postgres/0001_framework_baseline.sql`).
- `web_` disappears entirely from `sdkwork-web-framework`; the webserver `web_*` tables are untouched, so the double ownership is resolved rather than relocated.
- `moduleId` becomes `framework`, so the baseline filename becomes `0001_framework_baseline.sql` in both the PostgreSQL baseline and the SQLite test fixture, and the `db:materialize:contract` call carries `--module-id framework --prefixes framework_`. `serviceCode` stays `WEB_STORE` and the crate stays `sdkwork-web-store-sqlx`.
- Synchronised surfaces: the module registry, PostgreSQL and SQLite baseline DDL (including filenames), the contract trio (`schema.yaml`, `table-registry.json`, `prefix-registry.json`), `database.manifest.json`, the `db:materialize:contract` arguments in `package.json`, the legacy SQL migrations and Rust SQL constants under `crates/sdkwork-web-store-sqlx`, the architecture test that guards migration contents, and out-of-repo consumers (`sdkwork-knowledgebase`, `sdkwork-database`).
- The live development database needs one idempotent, reversible rename migration (`database/migrations/postgres/0001_rename_table_prefix_to_framework.{up,down}.sql`).
- The module registry keeps `moduleId: framework` and `tablePrefix: framework_` on the same entry; the repository-to-prefix mapping and the module identity now agree in vocabulary instead of diverging.

## Verification

- `pnpm db:validate` passes: manifest, schema, prefix-registry, and table-registry agree on `moduleId: framework` and `tablePrefix: framework_`.
- `pnpm db:materialize:contract` regenerates cleanly and is idempotent; every table name in `table-registry.json` starts with `framework_`.
- The specs gate `tools/check-database-framework-standard.mjs --root .` passes.
- `pnpm db:drift:check` reports `status: clean`, `error: 0`, and no pending migrations against the development database.
- The workspace prefix-ownership gate reports no `web_` finding for `sdkwork-web-framework`.
- Live database: the eight tables exist under `framework_*` with unchanged row counts and no data loss; the down migration rebuilds the `web_*` objects inside a transaction and rolls back cleanly.

## Amendment 1 — `moduleId` and baseline filename (2026-09-17)

Extends the decision from the table prefix to `moduleId` and the baseline filename.

**Trigger**: the original decision left `moduleId: webstore`, which meant the repository would ship `moduleId: webstore` + `tablePrefix: framework_` + a `0001_webstore_baseline.sql` containing only `framework_*` statements. The baseline filename is derived mechanically:

```
0001_${moduleConfig.moduleId}_baseline.sql        # tools/bootstrap-database-module.mjs
```

```json
"db:materialize:contract": "... --baseline database/ddl/baseline/postgres/0001_framework_baseline.sql --module-id framework --prefixes framework_"
```

**Decision**: `moduleId` becomes `framework`, and the baseline file is renamed to `0001_framework_baseline.sql` in the PostgreSQL baseline and in the SQLite test fixture. `serviceCode` (`WEB_STORE`) and the crate name (`sdkwork-web-store-sqlx`) are explicitly **not** renamed.

**Why the filename cannot be left behind**: it is not a display string. It is simultaneously the file on disk, the `--baseline` path argument, and the identifier written into `ops_schema_migration_history`. Leaving it at `webstore` while `moduleId` moved to `framework` would make the next `bootstrap-database-module.mjs` run emit a second, differently-named baseline for a module that already has one.

**Migration safety**: `sdkwork-web-framework` runs a `baseline-plus-migrations` lifecycle and had **no** rows in `ops_schema_migration_history` (only `sdkwork-webserver` had a `web` record), because a module that has never taken an incremental migration records nothing. The rename therefore carries no migration-history包袱 — there is no recorded baseline filename to disagree with.

**Additional consequence discovered during live application**: because the lifecycle runs the baseline before the migrations, applying the rename migration to a live database first created an empty `framework_*` twin of every table (`CREATE TABLE IF NOT EXISTS`), and a naive `CONTINUE`-on-existing-table rename then left **both** table families in place. The shipped migration therefore detects an empty twin, drops it, and renames; if the twin holds rows it raises instead of dropping. Verified: after the fix the lifecycle reports `applied 1 migration(s)`, row counts are preserved, and the original `web_*` tables are gone.

## Supersedes / Superseded By

Supersedes the implicit `web_` prefix declared by the `sdkwork-web-framework` database baseline and module manifest, and (per Amendment 1) the `webstore` module identity that the baseline filename and `tablePrefix` were derived from. No prior ADR is removed.
