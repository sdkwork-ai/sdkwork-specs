# IAM RBAC Federation Standard

- Version: 1.0
- Scope: distributed permission catalogs, role catalogs, directory templates, module discovery, registry materialization, and RBAC evaluation boundaries
- Related: `IAM_SPEC.md`, `PERMISSION_STANDARD_SPEC.md`, `IAM_MODULE_MANIFEST_SPEC.md`, `IAM_DIRECTORY_TEMPLATE_SPEC.md`, `IAM_CATALOG_GOVERNANCE_SPEC.md`, `DATABASE_SPEC.md`, `DATABASE_FRAMEWORK_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `API_SPEC.md`, `SECURITY_SPEC.md`, `APP_MANIFEST_SPEC.md`

SDKWork adopts **IAM Module Federation (IMF)**. Platform kernel capabilities stay in `sdkwork-iam` (`iam-kernel` module). Product domains declare permissions, domain-standard roles, role-grant extensions, and directory tree templates through `iam.module.manifest.json`. Applications compose enabled modules; the registry orchestrator discovers, validates, merges, and materializes catalogs into `iam_*` tables.

## 1. Layer Model

| Layer | Name | Owner | Primary tables |
| --- | --- | --- | --- |
| L1 | Subject directory | Kernel skeleton + module templates | `iam_tenant`, `iam_organization`, `iam_department`, `iam_position`, memberships, assignments, closure tables |
| L2 | Capability catalog | Each module | `iam_permission`, `iam_module_registry_*` |
| L3 | Assignment | Kernel roles + module extensions | `iam_role`, `iam_role_permission`, `iam_role_binding`, `iam_role_exclusion` |
| L4 | Policy | Kernel + module condition vocabulary | `iam_policy`, binding `condition_json` |
| L5 | Surface | Kernel only | Derived `userSurface`, token `permission_scope`, backend surface gate |

Authorization chain:

```text
subject -> role_binding (allow/deny) -> role -> role_permission -> permission -> policy (optional) -> surface gate
```

Rules:

- UI permission checks are hints only. Server-side authorization is mandatory.
- Deny bindings override allow bindings when both match.
- Custom tenant roles cannot exceed the assigner's effective `permission_scope`.
- Product domains must not fork RBAC evaluation engines.
- Role grant, revoke, and update operations `MUST` evaluate the assignability policy from the merged IMF catalog before writing `iam_role_binding`.
- Cross-domain grants are allowed only when the target module declares the permission or role relationship in IMF and the assigning principal has the required effective scope.

## 2. Ownership Boundaries

| Artifact | `sdkwork-iam` / `iam-kernel` | Domain module | Application root |
| --- | --- | --- | --- |
| RBAC evaluation / wildcard semantics | yes | no | no |
| Eight platform standard roles | yes | no | no |
| `iam.*` permissions | yes | no | no |
| `{domain}.*` permissions | no | yes | no |
| Domain standard roles | no | yes | no |
| Role grant extensions for platform roles | kernel base only | yes | no |
| Root org / general dept / member position skeleton | yes | no | no |
| Domain dept/position subtree templates | no | yes | no |
| Enabled module set | default bundled list | no | yes (`sdkwork.app.config.json`) |
| Tenant custom roles | no | no | runtime only |

## 2.1 Role Relationship And Grant Governance

The merged RBAC catalog is a relationship graph, not just a permission list. Each role catalog entry `MUST` materialize:

- `assignable`: whether the role may be granted through runtime APIs.
- `bindingPrincipalKind`: user, tenant member, organization membership, service account, or platform staff binding.
- `scope`: tenant, organization, service, or platform.
- `grantableBy`: explicit role or permission requirements for grant and revoke operations.
- `exclusions`: separation-of-duty rules that prevent conflicting grants.
- `sensitive`: whether grant/revoke/update requires MFA or recent reauthentication.

Rules:

- `platform_super_admin` `MUST` be platform-owned, non-tenant-assignable, and protected by break-glass governance: MFA, recent reauthentication, reason, audit event, and expiry policy when temporary grants are supported.
- `platform_system_admin` and `platform_super_admin` `MUST NOT` be granted by organization admins, tenant custom roles, application bootstrap scripts, or dependency modules.
- `org_admin` may grant only roles in the same organization whose permission set is within the assigner's effective scope and assignability ceiling.
- Deny bindings and role exclusions `MUST` take precedence over role grant extensions.
- Role grant extensions `MUST` name the target role and permission patterns; they must not silently expand a platform role into a domain-wide wildcard unless the module owns the domain and governance approves the extension.
- Every sensitive role operation `MUST` emit an audit event containing assigner, assignee, target role, scope, organization/service/platform context, reason, and trace id.

## 3. Discovery And Materialization

Discovery sources, in priority order:

1. `specs/iam.module.manifest.json` — authoritative catalog
2. OpenAPI / route manifest `x-sdkwork-permission` — reconciliation input
3. `component.spec.json` `contracts.iamModuleManifest` — component registration
4. Generated lock artifact `iam-registry.lock.json` — release audit snapshot

Commands (application root):

```bash
pnpm run admin:iam-modules:reconcile
pnpm run admin:iam-modules:validate
pnpm run admin:iam-modules:materialize:manifests
```

Materialization writes:

- `iam_permission`, `iam_role`, `iam_role_permission`
- directory entities and closure rows from templates
- `iam_module_registry_entry`, `iam_module_registry_snapshot`, `iam_catalog_materialization`

`db:seed` profile `operational` must invoke IMF materialization after SQL subject seed.

## 4. Industry Alignment

| Concept | SDKWork mapping |
| --- | --- |
| Permission | `iam_permission.code` |
| Role | `iam_role` with `role_class` |
| Role assignment | `iam_role_binding` |
| Resource hierarchy | tenant → organization → department → position |
| Group | `iam_group` / `iam_group_member` |
| Service account | `iam_service_account` |
| Deny | `iam_role_binding.effect = deny` (evaluated in `sdkwork-iam-bootstrap::rbac_scope`) |
| SoD | `iam_role_exclusion` (materialized from module manifests) |
| ABAC | `iam_policy`, binding `condition_json` |
| Managed catalog registry | `iam_module_registry_*` |

## 5. Acceptance Checklist

- [x] Every bundled domain permission is declared in an `iam.module.manifest.json` owned by that domain.
- [x] `sdkwork-iam-bootstrap` no longer owns non-`iam.*` permission seeds directly.
- [x] `pnpm run admin:iam-modules:validate` passes in CI.
- [x] `import_postgres_default_iam_seed` delegates to the module registry orchestrator.
- [x] OpenAPI protected operations reconcile to manifest permissions.
- [x] Registry snapshots are written on every materialization.
- [x] Backend role binding and role-permission grants enforce assigner `permission_scope` coverage and block retired permissions.
- [x] Backend directory APIs expose tenant-scoped `iam_group`, `iam_group_member`, and `iam_service_account` CRUD aligned with kernel permissions.
- [x] Nested department templates resolve `parentRef`, persist hierarchy paths, and materialize `iam_department_closure` rows.
- [x] Operational `zh-CN` locale seed overlays apply IMF display labels after catalog materialization.
- [x] Deprecated permissions declare `replacementCode` (enforced by `iam:modules:validate` and registry validation).
