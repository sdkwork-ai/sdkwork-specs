# IAM Catalog Governance Standard

- Version: 1.0
- Scope: permission and role catalog versioning, deprecation, registry snapshots, and migration control
- Related: `IAM_RBAC_FEDERATION_SPEC.md`, `GOVERNANCE_SPEC.md`, `MIGRATION_SPEC.md`, `RELEASE_SPEC.md`, `SECURITY_SPEC.md`

## 1. Change Types

| Type | Examples | Requirement |
| --- | --- | --- |
| Clarification | Display name, docs | Validate only |
| Additive | New permission, new domain role, new dept template | `iam:modules:validate` + materialize |
| Deprecating | Rename permission, narrow role grant | `replacementCode`, deprecation window, migration note |
| Breaking | Remove permission, change binding semantics | ADR, migration plan, release gate |

## 2. Registry Artifacts

Every materialization must produce:

- Database rows in `iam_module_registry_snapshot`
- Database rows in `iam_catalog_materialization`
- File artifact `iam/registry/iam-registry.lock.json` at the application root

Lock file minimum shape:

```json
{
  "schemaVersion": 1,
  "kind": "sdkwork.iam.registry.lock",
  "materializedAt": "2026-06-21T00:00:00Z",
  "profile": "operational",
  "modules": [
    { "moduleId": "iam-kernel", "catalogVersion": "1.0.0", "manifestSha256": "..." }
  ],
  "permissionCount": 0,
  "roleCount": 0
}
```

## 3. Deprecation Rules

- `status = deprecated` requires `replacementCode` or an approved exception.
- Deprecated permissions remain readable in authorization evaluation until the published retirement date.
- `status = retired` permissions must fail closed for new grants and should fail closed for evaluation after retirement unless an exception is recorded.

## 4. Security Rules

- Catalog changes that broaden `platform_super_admin` grants require security review.
- Deny bindings take precedence over allow bindings.
- Materialization is not a substitute for bootstrap operator creation; credentials must not be synthesized by catalog seed.
- Role assignment APIs must reject `iam_role_exclusion` conflicts before persisting allow bindings.

## 5. Verification

Application roots with IMF must run:

```bash
pnpm run admin:iam-modules:validate
pnpm run test:iam-standard-governance
```

Release gates should include lock file drift checks when IMF is enabled.
