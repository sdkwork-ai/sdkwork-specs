# IAM Module Manifest Standard

- Version: 1.0
- Scope: machine-readable IMF declarations for permissions, roles, directory templates, and module dependencies
- Related: `IAM_RBAC_FEDERATION_SPEC.md`, `IAM_DIRECTORY_TEMPLATE_SPEC.md`, `IAM_CATALOG_GOVERNANCE_SPEC.md`, `COMPONENT_SPEC.md`, `NAMING_SPEC.md`

Each IMF-capable module `MUST` publish:

```text
<module-root>/
  specs/iam.module.manifest.json
```

Applications may additionally ship:

```text
iam/registry/iam-registry.config.json
```

## 1. Module Discovery

A module manifest that ships in the bundle `MUST` be materialized on startup
without editing a hand-maintained enable list; a new module therefore reaches
existing sessions through the authorization epoch without a user re-login
(`AUTHORIZATION_STATE_SPEC.md` 3.4 and 3.8).

- `iam/modules/<moduleId>/iam.module.manifest.json` present in the bundle is
  enabled by default.
- `optionalModules` names shipped modules that stay disabled; listing one of
  them in `enabledModules` opts it back in.
- `enabledModules` remains the explicit intent record and is unioned with the
  discovered manifests.
- Discovery `MUST` be deterministic (sorted, deduplicated) and `MUST` fail
  startup when a discovered manifest cannot be read or parsed.
- A module whose routes are served by the application MUST NOT be left in
  `optionalModules`; silently shipping a served module without its catalog is a
  defect, not a deployment choice.

Verification: `node <sdkwork-specs>/tools/check-authz-state-standard.mjs --root <iam-root>`.

## 2. Top-Level Shape

```json
{
  "schemaVersion": 1,
  "kind": "sdkwork.iam.module",
  "moduleId": "iot",
  "catalogVersion": "1.0.0",
  "domain": "iot",
  "owner": "sdkwork-aiot",
  "displayName": "IoT Platform Module",
  "permissions": { "catalog": [], "openapiAuthorities": [] },
  "roles": {
    "domainStandardRoles": [],
    "roleGrantExtensions": [],
    "roleExclusions": [],
    "assignability": [],
    "bootstrapDefaults": []
  },
  "directory": {
    "organizationTemplates": [],
    "departmentTemplates": [],
    "positionTemplates": [],
    "membershipTemplates": []
  },
  "policyConditions": { "supportedAttributes": [] },
  "oauthScopeMappings": [],
  "dependencies": { "requiresModules": ["iam-kernel"] }
}
```

Rules:

- `moduleId` uses lower kebab-case.
- `domain` must match the permission code prefix for all permissions in the module.
- `catalogVersion` follows semantic versioning for catalog-breaking changes.
- `dependencies.requiresModules` must form an acyclic graph.

## 3. Permission Entries

```json
{
  "code": "iot.devices.read",
  "name": "Read IoT devices",
  "resource": "devices",
  "action": "read",
  "status": "active",
  "since": "1.0.0",
  "replacementCode": null
}
```

Rules:

- `code` format: `{domain}.{resource}.{action}`.
- `status`: `active`, `deprecated`, `retired`.
- `deprecated` entries must set `replacementCode` unless an approved governance exception exists.
- Retired permissions must not appear in new role grants.

## 4. Role Entries

### 3.1 Platform standard roles

Declared only in `iam-kernel`. Other modules must not redefine platform role codes.

### 3.2 Domain standard roles

```json
{
  "code": "iot_field_operator",
  "name": "IoT Field Operator",
  "surface": "organization",
  "scope": "organization",
  "standard": true,
  "assignable": true,
  "bindingPrincipalKind": "organization_membership",
  "permissionPatterns": ["iot.devices.read", "iot.commands.create"],
  "grantableBy": ["org_admin"],
  "sensitive": false
}
```

Rules:

- Domain role codes must be namespaced by the owning domain.
- `permissionPatterns` must expand only to permissions owned by the same module unless an approved cross-domain exception exists.
- `assignable` must be false for roles that are system-only, seed-only, or platform break-glass.
- `bindingPrincipalKind` must match the role scope: `tenant_member`, `organization_membership`, `service_account`, or `platform_staff`.
- `grantableBy` must reference roles or permission codes from the merged catalog; omitted `grantableBy` means no runtime grant API may assign the role.
- `sensitive = true` requires MFA or recent reauthentication for grant, revoke, and update operations.

### 3.3 Role grant extensions

```json
{
  "roleCode": "org_operations",
  "patterns": ["iot.*"]
}
```

Rules:

- `roleCode` must reference a platform standard role or a domain standard role already discovered in the merged catalog.
- Patterns use the permission wildcard grammar from `PERMISSION_STANDARD_SPEC.md`.
- Extensions must not grant permissions outside the declaring module's owned domain unless `dependencies.requiresModules` names the owner and governance approves the cross-domain extension.

### 3.4 Assignability And Bootstrap Defaults

Modules may declare role relationship metadata separately when the role entry is owned by another module:

```json
{
  "roleCode": "org_operations",
  "scope": "organization",
  "assignable": true,
  "grantableBy": ["org_admin"],
  "bindingPrincipalKind": "organization_membership",
  "sensitive": false,
  "excludes": []
}
```

Bootstrap defaults are seed-time bindings, not permanent bypasses:

```json
{
  "profile": "dev",
  "principalRef": "seed:organization.owner",
  "roleCode": "org_admin",
  "scopeRef": "seed:organization.root",
  "allowInProduction": false
}
```

Rules:

- `bootstrapDefaults[]` must be idempotent and keyed by stable `principalRef`, `roleCode`, and `scopeRef`.
- Production bootstrap defaults must be least-privilege and must not create live `platform_super_admin` accounts or static super-admin passwords.
- Seed profiles must distinguish dev/test demo users from production owner or operator subjects.
- Bootstrap defaults must not replace runtime role binding authorization; they only initialize known subjects for an environment profile.

## 5. Component Registration

`component.spec.json` `contracts` should include:

```json
"iamModuleManifest": "specs/iam.module.manifest.json"
```

## 6. Validation Rules

| Id | Rule |
| --- | --- |
| R1 | Namespace ownership: module owns only its `domain.*` permissions |
| R2 | No duplicate permission codes across merged modules |
| R3 | Grant patterns must expand against merged permission catalog |
| R4 | Directory refs must resolve |
| R5 | Directory graph must be acyclic |
| R6 | `requiresModules` order must be satisfiable |
| R7 | Disabled modules are excluded from seed materialization |
| R8 | OpenAPI permissions must be subset of manifest permissions |
| R9 | Role assignability metadata must resolve target roles, grantable roles/permissions, binding principal kind, and scope |
| R10 | Sensitive role operations require MFA/reauth policy and audit event mapping |
| R11 | Bootstrap defaults must be idempotent, profile-scoped, and must not seed production super-admin credentials |
