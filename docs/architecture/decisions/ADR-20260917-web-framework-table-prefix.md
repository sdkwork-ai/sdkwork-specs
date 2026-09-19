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

Second, it **collided**. `sdkwork-webserver` also declares `web_` for its own business tables (26 of them, including `web_audit_log`). One prefix therefore had two owners: live framework infrastructure on one side, and business tables scheduled for retirement on the other. Any prefix-scoped operation — bulk rename, bulk drop, ownership audit — becomes ambiguous and unsafe, because the two sets cannot be told apart by prefix alone. (**Resolved by Amendment 2, 2026-09-18**: `sdkwork-webserver` vacated `web_`, so the prefix has no owner at all. Its legacy table count was 25 by then — 26 before `0009_retire_web_health_result` dropped `web_health_result`.)

`DATABASE_SPEC.md` §7 requires `<module_prefix>` to be a registered business module or bounded-context prefix. The unregistered, doubly-claimed `web_` satisfied neither half.

## Decision

The eight `sdkwork-web-framework` tables use **`framework_`** as their module prefix.

`framework_` names the bounded context this module owns — the host application's web-framework layer: ingress governance, rate limiting, idempotency, CORS, audit and security events, tenant runtime profiles, and control-node registration. It names the context, not a technology choice.

The prefix is registered in `tools/database-module-registry.json` (`repo: sdkwork-web-framework`, `moduleId: framework`, `ownerTeam: web-framework-platform`), and that registry entry is the sole authority for ownership.

To admit this case without weakening the rule, §7 drops `framework` from its prohibited-word list and gains one clause: a platform infrastructure layer that owns a bounded context `MAY` register a descriptive prefix naming that context, provided the prefix is registered before first use.

This section originally scoped the decision to the **table prefix only**, leaving `moduleId`, the baseline filename, and `serviceCode` untouched. **Amendment 1** extends it to `moduleId` and the baseline filename, because the baseline filename is mechanically derived from `moduleId` (`0001_${moduleId}_baseline.sql`) and the two cannot be allowed to disagree. `serviceCode` (`WEB_STORE`) and the crate name (`sdkwork-web-store-sqlx`) remain unchanged: they are release-contract and package-identity surfaces consumed by release tooling and cross-repository references, and no gate derives them from the prefix.

## Alternatives

- **Keep `web_` and make webserver give way**: rejected. `web_` is unregistered, so nothing can be ceded; and the webserver tables under it are business tables already marked for retirement. Handing a registered identity to an unregistered prefix deepens the double ownership instead of resolving it. **Partially superseded by Amendment 2**: webserver did give way, but by vacating the prefix rather than being handed it — the amendment explains why those are not the same move, and why the "already marked for retirement" premise turned out to be false.
- **Use the already-registered `webstore_`**: rejected. `webstore` is this module's legacy product name, still visible in its crate name (`sdkwork-web-store-sqlx`) and `serviceCode` (`WEB_STORE`), but it does not express the bounded context the tables serve. A table prefix must let a reader tell framework-layer infrastructure apart from business repository tables at a glance; `webstore_rate_limit_bucket` still reads like a store's table.
- **Keep the table prefix decision but leave `moduleId: webstore`**: rejected (see Amendment 1). `moduleId` is not a free-floating label here — it is the input from which the baseline filename and the `db:materialize:contract --module-id` argument are derived. Leaving it at `webstore` would ship `moduleId: webstore` beside `tablePrefix: framework_` and a `0001_webstore_baseline.sql` that creates only `framework_*` tables: three surfaces describing one module in two vocabularies.
- **Rename the crate (`sdkwork-web-store-sqlx`) and `serviceCode` (`WEB_STORE`) too**: rejected. Those are package-identity and publishing-contract surfaces referenced from other repositories and from release tooling; the benefit does not justify the blast radius, and no prefix gate reads them.
- **Keep `web_` and merely register it**: rejected. It would legalise the double claim, and §7 forbids keeping a project-level prefix on pre-launch tables. **Amendment 2 applies the same reasoning to `sdkwork-webserver`**: registering `web_` for the second claimant was never the answer; both repositories had to stop using a project-level prefix.

## Consequences

- Eight tables, 19 indexes, and 8 primary keys are renamed from `web_*`/`idx_web_*` to `framework_*`/`idx_framework_*` (counted from the PostgreSQL baseline, `database/ddl/baseline/postgres/0001_framework_baseline.sql`).
- `web_` disappears entirely from `sdkwork-web-framework`. **Superseded by Amendment 2**: the webserver `web_*` tables were not left untouched — they were renamed to `webserver_*`, so the double ownership is resolved rather than relocated.
- `moduleId` becomes `framework`, so the baseline filename becomes `0001_framework_baseline.sql` in both the PostgreSQL baseline and the SQLite test fixture, and the `db:materialize:contract` call carries `--module-id framework --prefixes framework_`. `serviceCode` stays `WEB_STORE` and the crate stays `sdkwork-web-store-sqlx`.
- Synchronised surfaces: the module registry, PostgreSQL and SQLite baseline DDL (including filenames), the contract trio (`schema.yaml`, `table-registry.json`, `prefix-registry.json`), `database.manifest.json`, the `db:materialize:contract` arguments in `package.json`, the legacy SQL migrations and Rust SQL constants under `crates/sdkwork-web-store-sqlx`, the architecture test that guards migration contents, and out-of-repo consumers (`sdkwork-knowledgebase`, `sdkwork-database`).
- The live development database needs one idempotent, reversible rename migration (`database/migrations/postgres/0001_rename_table_prefix_to_framework.{up,down}.sql`).
- The module registry keeps `moduleId: framework` and `tablePrefix: framework_` on the same entry; the repository-to-prefix mapping and the module identity now agree in vocabulary instead of diverging.

## Verification

- `pnpm db:validate` passes: manifest, schema, prefix-registry, and table-registry agree on `moduleId: framework` and `tablePrefix: framework_`.
- `pnpm db:materialize:contract` regenerates cleanly and is idempotent; every table name in `table-registry.json` starts with `framework_`.
- The specs gate `tools/check-database-framework-standard.mjs --root .` passes.
- `pnpm db:drift:check` reports `status: clean`, `error: 0`, and no pending migrations against the development database.
- The workspace prefix-ownership gate reports no `web_` finding for `sdkwork-web-framework`. **Extended by Amendment 2**: after the webserver rename the gate reports no `web_` finding for any repository in the workspace.
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

**Migration safety**: `sdkwork-web-framework` runs a `baseline-plus-migrations` lifecycle and had **no** rows in `ops_schema_migration_history` (only `sdkwork-webserver` had a `web` record), because a module that has never taken an incremental migration records nothing. The rename therefore carries no migration-history baggage — there is no recorded baseline filename to disagree with.

**Additional consequence discovered during live application**: because the lifecycle runs the baseline before the migrations, applying the rename migration to a live database first created an empty `framework_*` twin of every table (`CREATE TABLE IF NOT EXISTS`), and a naive `CONTINUE`-on-existing-table rename then left **both** table families in place. The shipped migration therefore detects an empty twin, drops it, and renames; if the twin holds rows it raises instead of dropping. Verified: after the fix the lifecycle reports `applied 1 migration(s)`, row counts are preserved, and the original `web_*` tables are gone.

## Amendment 2 — `sdkwork-webserver` vacates `web_` for `webserver_` (2026-09-18)

Completes the prefix's removal by extending it from one claimant to both.

**Trigger**: the original decision renamed `sdkwork-web-framework`'s eight tables and left the other claimant untouched, so `web_` still had a declared owner. `DATABASE_SPEC.md` §7's closing rule — existing project-level prefixes may be registered only as L0 migration facts, and new/pre-launch tables `MUST NOT` keep them — applies to `sdkwork-webserver` exactly as it applied to `sdkwork-web-framework`.

The alternative above that kept `web_` on the webserver side rested on two premises, and both were withdrawn. First, "make webserver give way" was read as "hand `web_` to webserver"; vacating the prefix is a different move that leaves `web_` with no owner at all. Second, the webserver tables were described as "already marked for retirement" — but the repository is pre-launch, no application is live, and all 25 tables are still read by live code (verified table by table), so the tables are being kept, not retired. It is only the prefix that goes away.

**Decision**: `sdkwork-webserver` renames its 25 business tables from `web_*` to `webserver_*` and its `moduleId` from `web` to `webserver` (so the baseline becomes `0001_webserver_baseline.sql`), and is registered as the 33rd entry of `tools/database-module-registry.json` (`moduleId: webserver`, `tablePrefix: webserver_`, `ownerTeam: web-platform`). That entry is the sole authority for ownership.

**Why `webserver_` satisfies §7 where `web_` did not**:

- `webserver` is the identity this module is already registered under (`moduleId` in `database/database.manifest.json`, repository `sdkwork-webserver`, `ownerTeam: web-platform`), so prefix and owner are the same word by construction — the property §7's product-name prohibition exists to guarantee. Contrast `webstore_`, rejected in the original decision because it was `sdkwork-web-framework`'s *legacy product name*, i.e. a name the module no longer answers to.
- It names the bounded context the tables serve — the web-server control plane: sites, domains, certificates, nginx configuration, deployments and runtime assignment.
- It is not a deployment name, a programming language, or a legacy project prefix. `web` remains prohibited for that last reason: it is the project-level prefix being migrated away from, not a bounded context.

**Scope of the rename**, beyond the DDL: the baseline filename, six migration files (`0005`, `0007`, `0008` and their down pairs), the contract trio and `database.manifest.json` (regenerated, not hand-edited), the hard-coded `--baseline / --module-id / --prefixes` arguments of `db:materialize:contract` in `package.json`, the Rust SQL constants, and the repository's documentation and runbooks. `0006_organization_id_not_null` and `0009_retire_web_health_result` deliberately keep both their filenames and their bytes: `0009` retires a table under the legacy name, which is an L0 historical fact.

Two surfaces are easy to miss and were both hit here:

- **The baseline filename appears in executable code, not only in prose.** `scripts/webserver-release.mjs`, `scripts/postgres-ha-verify.mjs`, `scripts/postgres-ci-verify.mjs`, `scripts/database-recovery-verify.mjs` and `tests/contract/release-archive.contract.test.mjs` all name it, so a rename that only touches the DDL silently breaks release packaging and the CI harness.
- **The migration ledger is keyed on the old module identity.** See below.

**Live database reconciliation.** The lifecycle keys migration state on `(module_id, version, engine)`, and the pending set is decided before any migration statement runs. Rows recorded under `web` are therefore invisible to a `webserver` run, which would replay `0005`–`0008` against a database that already carries their effects — and no migration can repair that from inside itself. The reconciliation is an out-of-band step run before `pnpm db:migrate`: re-key the ledger rows (`module_id = 'webserver'`, `name` following the renamed file) and refresh `checksum` to `sha256(current .up.sql bytes)`. Refreshing the checksum is mandatory rather than cosmetic: the drift engine hashes raw file bytes with no end-of-line normalisation and reports error-level `checksum_mismatch` for any difference against a migration it considers applied. The method was validated against a recorded value: the pre-change row for `0005` stored `3f1acd0d…`, which is exactly `sha256(CRLF form of the HEAD blob of 0005_web_application.up.sql)`. `database/migrations/postgres/README.md` carries the procedure.

**A trap Amendment 1 did not cover.** The lifecycle applies the baseline before the migrations, and the baseline's `CREATE TABLE IF NOT EXISTS` materialises a full set of empty `webserver_*` twins. Those twins declare foreign keys against each other, so the plain `DROP TABLE twin` of Amendment 1 fails with `cannot drop table webserver_certificate because other objects depend on it`. `0010_rename_table_prefix_to_webserver.{up,down}.sql` therefore drops the empty twins with `DROP TABLE … CASCADE`, guarded by a pre-flight assertion that every foreign key referencing a `webserver_*` table itself sits on a `webserver_*` table — which proves CASCADE cannot reach outside the discard set. The per-twin zero-row check is retained, so a twin that holds rows still raises instead of being dropped.

**Amendment 1's rename missed its sequences.** `0001_rename_table_prefix_to_framework` renamed tables, indexes and constraints but not the sequences PostgreSQL creates implicitly for `BIGSERIAL` columns, so the live database still carried `web_audit_event_id_seq` and `web_security_event_id_seq`, owned by `framework_audit_event` and `framework_security_event`. A fresh install of the same baseline creates `framework_audit_event_id_seq` and `framework_security_event_id_seq`, so a migrated database and a fresh database disagreed on a surface no drift rule inspects — sequences are not part of the compared surface. `0002_rename_sequences_to_framework.{up,down}.sql` closes the gap; renaming a sequence preserves its ownership and value, and the owning column's `DEFAULT` follows because a `regclass` reference is stored by object identity.

**Consequences**:

- No repository declares `web_` any more, and the live development database holds zero `web_` tables, zero `web_` indexes and zero `web_` sequences.
- The `webserver_` prefix has exactly one registered owner, which removes the ambiguity that motivated this ADR rather than relocating it.
- `webserver_` grows identifier lengths by five characters. Renamed `*_not_null` names that cross PostgreSQL's 63-byte limit are truncated by the server; these names are generated by the engine, are not compared by the drift gate, and truncate identically on a fresh baseline install, so migrated and fresh databases still agree.
- IAM permission names are a separate surface and are untouched here: `web.applications.*` still guards 32 live backend-api routes and may only be renamed through the four-step alias procedure in `API_SPEC.md` §4.2/§5.1.

**Verification**:

- `pnpm db:validate` passes and `db:materialize:contract` is idempotent (identical digests across two runs).
- `pnpm db:migrate` reports `applied 1 migration(s)` — not 2, which would mean the double-table trap was hit — and `pnpm db:drift:check` reports `drift check passed`.
- Row counts are preserved: `web_audit_log` held 1216 rows before the rename and `webserver_audit_log` holds 1216 after; the other 24 tables were empty before and after.
- Live object census after the rename: 25 `webserver_*` tables and 137 indexes, with no legacy objects left behind.
- The prefix-ownership gate drops from 45 to 44 findings and reports no `web_` finding for any repository.
- `cargo check --workspace --all-targets` is clean.

## Supersedes / Superseded By

Supersedes the implicit `web_` prefix declared by the `sdkwork-web-framework` database baseline and module manifest, and (per Amendment 1) the `webstore` module identity that the baseline filename and `tablePrefix` were derived from. Supersedes (per Amendment 2) the implicit `web_` prefix declared by the `sdkwork-webserver` database baseline and module manifest, and the `web` module identity it derived its baseline filename from — including the two sentences in this ADR's Context and Consequences sections that described the webserver tables as untouched or as scheduled for retirement. No prior ADR is removed.
