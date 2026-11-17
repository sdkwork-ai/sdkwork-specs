# ADR-20261117 Design-Time Table Prefix

Status: accepted
Requirement: standards correction (no product requirement)
Owner: sdkwork-specs
Date: 2026-11-17
Specs: `DATABASE_SPEC.md`

## Context

`DATABASE_SPEC.md` DB071 recommended `studio_` for workspace, project, application, and template design-time assets. That recommendation contradicts three binding rules in the same Naming Standard section:

1. §7 requires `<module_prefix>` to be a registered business module or bounded-context prefix (DB061, DB062, DB064).
2. §7 states that existing project-level prefixes are L0 migration facts and that new or pre-launch tables `MUST NOT` keep them (DB066, DB068).
3. `tools/database-module-registry.json` registers 34 prefixes — `forum_`, `iam_`, `appstore_`, `deploy_`, `framework_`, and others — but neither `studio_` nor a `studio` module.

`studio_` is precisely the retired project prefix of the old Studio product. The IAM baseline dropped its 13 `studio_*` tables, and both `IAM_SPEC.md` (§142) and `IAM_APPLICATION_BOOTSTRAP_SPEC.md` (§11, §487) forbid reintroducing `studio_*` in IAM database ownership. A rule that recommends a retired, unregistered prefix therefore invites the exact legacy debt DB061/DB066/DB068 exist to prevent, and it cannot be satisfied by any consuming repository without first creating a new module.

## Decision

DB071 becomes registry-first:

- Design-time assets (workspace, project, application, template) use the **source-of-record module prefix** (DB065).
- A shared design-time prefix is permitted only when it is registered in `tools/database-module-registry.json` before first use (DB064, DB072).
- `studio_` `MUST NOT` name a new table; it remains an L0 migration fact.

The Naming Standard section gains a matching clause, and `DATABASE_SPEC.md` moves from version 3.1 to 3.2.

Concrete naming for the in-flight application-model unification, using only already-registered prefixes:

| Concept | Tables |
| --- | --- |
| Application identity, version, SKU, listing, deployment binding, scaffold | `appstore_application*` |
| Runtime blueprint, tenant installation, surface, installation credential | `iam_application*` |
| Deployment unit and marketplace template | `deploy_application*` |

No new prefix is registered by this decision.

## Alternatives

- **Register `studio_` as a module prefix.** Rejected. It legalises a retired project prefix and requires a new module id, owner team, contract, and deployment surface; that is the opposite of the application-model consolidation this correction supports.
- **Delete DB071 and rely on §7 alone.** Rejected. The rule carries a non-obvious classification — design-time assets follow DB065 like any other table and are not a special case — and that pointer would be lost.
- **Keep DB071 and exempt design-time assets from DB061.** Rejected. Carving an asset class out of the prefix registry is how unregistered prefixes come back.

## Consequences

- Design-time tables are covered by the same prefix gate as business tables; DB071 can now be satisfied without a new module.
- `DATABASE_SPEC.md` version 3.1 → 3.2; no consuming repository changes, because every prefix the current design uses (`iam_`, `appstore_`, `deploy_`) is already registered.
- Future design-time asset families that genuinely deserve their own prefix must register it first (DB064, DB072) instead of inheriting `studio_`.
