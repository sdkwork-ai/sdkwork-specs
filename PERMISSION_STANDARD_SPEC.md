# Permission Standard Specification

> Canonical permission, role, and authorization standard for SDKWork IAM.

## Scope

This spec defines:

- User surface classification (app vs organization member)
- Eight immutable standard roles
- Permission code naming and operation mapping
- Server-side authorization enforcement
- OpenAPI contract extensions

Related specs: `IAM_SPEC.md` §7, `API_SPEC.md` §18.

## User Surface

| Field | Rule |
| --- | --- |
| `userSurface.app` | Active `iam_tenant_member` |
| `userSurface.organizationMember` | Active `iam_organization_membership` |

Surfaces may overlap. Backend API requires `loginScope = "ORGANIZATION"` with a non-zero `organizationId` plus route permission. Persistent `userSurface.organizationMember = true` alone does not authorize backend-api access while the active session is personal (`loginScope = "TENANT"`).

### Actor, Surface, Role, And Scope Matrix

SDKWork implementations `MUST` distinguish actor category, login surface, role assignment scope, and grant authority. A user row in IAM is not itself an authorization grant.

| Actor category | Login/session surface | Binding principal | Allowed role scope | Notes |
| --- | --- | --- | --- | --- |
| Consumer app user | app-api, C-end UI | `iam_tenant_member` | tenant/personal | Receives `app_user` or application-owned tenant roles only. Must not receive organization or platform roles without an organization membership or platform staff binding. |
| Organization member | app-api plus organization context selection | `iam_organization_membership` | organization | May hold organization roles for the selected organization only. Personal login remains tenant scope even if memberships exist. |
| Enterprise admin console user | backend-api, admin/console UI | `iam_organization_membership` | organization | Requires `loginScope = "ORGANIZATION"` and per-route permission. `org_admin` is not platform authority. |
| Enterprise assistant/auditor/operator/finance user | backend-api, admin/console UI | `iam_organization_membership` | organization | Receives least-privilege standard or custom roles; cannot grant roles outside explicit assignability policy. |
| Platform system admin | internal platform/admin surface | platform staff binding | tenant/platform operational | May operate platform support workflows. Must not bypass tenant data isolation except through audited support tools. |
| Platform super admin | break-glass platform/admin surface | platform staff binding plus super-admin grant | platform break-glass | Highest privilege. Must be rare, MFA protected, reauth gated, time-bounded when possible, and audited. |
| Service account/API key | open-api, backend jobs, integration runtime | service principal/API key binding | service/application/organization as declared | Permissions come from explicit service-principal grants or API key scopes, never from human default roles. |

Rules:

- A session `MUST` carry exactly one active authorization scope: personal tenant, organization, service principal, or platform staff. Mixed implicit scopes are forbidden.
- Backend-admin access for enterprise users `MUST` be derived from organization membership plus active organization session, not from C-end app login alone.
- Platform staff and super-admin roles `MUST NOT` be assignable by tenant custom roles, application owners, or ordinary `org_admin` users.
- Service accounts and API keys `MUST` use explicit scope materialization and audit identity; they must not inherit broad human bootstrap roles.

### Actor Initialization And Default Grant Matrix

User and principal initialization `MUST` follow the same actor/surface/scope separation as runtime authorization. Bootstrap, registration, invite, API-key issuance, and test seed flows `MUST NOT` share one implicit "default admin" path.

| Actor category | Creation authority | Default grant | Forbidden during initialization | Mandatory evidence |
| --- | --- | --- | --- | --- |
| Consumer app user | App registration, invite, OAuth, QR, or credential-entry flow after IAM tenant binding | `app_user` or application-owned tenant role only | Organization roles, platform roles, backend-admin access, wildcard permission scope | Login/session test proves `loginScope = TENANT`; seed/bootstrap test proves no org/platform role binding |
| Organization member | Organization invite, membership API, or approved bootstrap owner binding | Organization-scoped standard/custom role within assigner scope | Cross-organization grants, platform roles, permissions outside assigner effective scope | Role binding test proves membership, assignability, exclusion, and audit event |
| Enterprise admin console user | Organization admin grant by an authorized assigner | `org_admin` or narrower organization-admin role | Platform authority, tenant-wide hidden admin, personal-login backend access | Backend-api test proves `loginScope = ORGANIZATION`, non-zero organization id, and route permission |
| Enterprise assistant/auditor/operator/finance user | Organization admin or delegated role manager | Least-privilege organization role such as `org_assistant`, `org_auditor`, `org_operations`, or `org_finance` | Role grants unless the catalog explicitly delegates them; broad write/admin permissions by default | Permission-scope test proves allowed operations and denial of role escalation |
| Platform system admin | Platform staff governance workflow | Platform operational role with bounded support/data scope | Tenant bootstrap scripts, organization admin grants, silent cross-tenant data access, `platform_super_admin` | Staff binding, MFA/reauth policy when required, support-scope audit event |
| Platform super admin | Break-glass platform governance only | Temporary or explicitly approved `platform_super_admin` | Application bootstrap creation, default passwords, unbounded permanent grants, unaudited activation | MFA, recent reauth, reason, approver or policy reference, expiry when temporary grants are supported, audit/security event |
| Service account/API key | Service-account or API-key issuance API | Explicit service/API-key permission scope and app/environment audience | Human default roles, refresh tokens, browser session state, wildcard scopes unless platform-owned and approved | Key/service-principal record with hash/encryption, expiry/revocation policy, permission-scope and audit tests |

Rules:

- Registration flows `MUST` create only the actor category they are designed for. A C-end registration path must not create organization admin or platform staff bindings as a side effect.
- Application bootstrap may create or bind an application bootstrap owner only as an ordinary tenant or organization subject. It `MUST NOT` create `platform_system_admin` or `platform_super_admin` grants.
- Default role bindings created by seed/bootstrap code `MUST` pass the same assignability, separation-of-duty, tenant/organization boundary, and audit checks as runtime role grants unless a seed-only exception is declared in `IAM_MODULE_MANIFEST_SPEC.md` and approved by governance.
- Service principals and API keys `MUST` use service/API-key subject records and permission scopes. They must not reuse human login sessions, human refresh tokens, or browser TokenManager state.

## Standard Roles

| Code | Scope | Surface |
| --- | --- | --- |
| `app_user` | tenant | app |
| `org_admin` | organization | organization |
| `org_assistant` | organization | organization |
| `org_auditor` | organization | organization |
| `org_finance` | organization | organization |
| `org_operations` | organization | organization |
| `platform_system_admin` | platform | platform |
| `platform_super_admin` | platform | platform |

The role code `owner` is migration-only and `MUST NOT` be introduced in new role catalogs or role bindings. Existing `owner` bindings migrate to `org_admin` through a governed migration.

### Role Assignability

Role relationship management `MUST` be explicit in IAM module manifests or platform policy. The following defaults apply unless a narrower policy is declared:

| Assigner effective role | May assign | Must not assign |
| --- | --- | --- |
| `app_user` | no administrative roles | any organization or platform role |
| `org_assistant`, `org_auditor`, `org_finance`, `org_operations` | no roles by default | `org_admin`, platform roles, custom roles outside an approved delegation policy |
| `org_admin` | organization-scoped standard/custom roles within the same organization and below its own assignability ceiling | platform roles, super-admin roles, cross-organization grants, roles with permissions outside its effective scope |
| `platform_system_admin` | approved operational platform roles and support-scoped organization grants | `platform_super_admin` unless break-glass governance explicitly allows it |
| `platform_super_admin` | platform roles and emergency organization grants under break-glass workflow | silent grants without MFA, reauth, reason, expiry policy, and audit record |

Rules:

- Grant, revoke, role edit, role exclusion, and role assignability changes `MUST` be authorized as sensitive operations with MFA or recent reauthentication when the target role is administrative.
- Assignability checks `MUST` use the assigner's effective permission scope, target role scope, organization boundary, and separation-of-duty exclusions.
- A role `MUST NOT` be granted when any active exclusion matches the assignee, assigner, organization, or target role.
- Wildcard permissions in a custom role `MUST` be rejected unless the role is platform-owned and approved by governance.

## Permission Codes

Format: `{domain}.{resource}.{action}`

Examples: `iam.users.read`, `iam.oauth.manage`, `commerce.orders.approve`

Wildcard grants:

- `*` — global
- `{domain}.*` — domain-wide
- `*.{action}` — action-wide (e.g. `*.read`)

## Operation Mapping (Backend API)

Backend `operationId` maps to permission codes by convention:

| Operation suffix | Permission action |
| --- | --- |
| `list`, `retrieve`, `tree` | `read` |
| `create` | `create` |
| `update` | `update` |
| `delete`, `revoke` | `delete` / `revoke` |
| `iam.oauth.*` list/retrieve | `iam.oauth.read` |
| `iam.oauth.*` mutations | `iam.oauth.manage` |

Authoritative implementations:

- Rust: `sdkwork-routes-iam-backend-api/src/operation_permissions.rs`
- TypeScript: `@sdkwork/iam-contracts` `backend-operation-permissions.ts`

## Authorization Pipeline

1. `WebRequestContextResolver` — credentials → principal + `permissionScope`
2. Backend surface gate — `loginScope = ORGANIZATION` and non-zero `organizationId` required
3. `ManifestAuthorizationPolicy` — route `required_permission` vs `permissionScope`
4. `IamAuthorizationPolicy` — IAM org/login-scope gate + manifest policy
5. Handler/service — `data_scope` filtering using active `loginScope` and `organizationId`

UI `can()` checks are hints only. Server enforcement is mandatory.

## OpenAPI Extensions

| Extension | Meaning |
| --- | --- |
| `x-sdkwork-permission` | Required permission code (backend-api / open-api; app-api only with `x-sdkwork-auth-tier: 3`) |
| `x-sdkwork-required-surface` | `organizationMember` for backend protected routes |
| `x-sdkwork-auth-tier` | Surface authorization tier `0`–`3` (see §Surface Authorization Tiers). App-api default is `1` when absent. |

## Extension Rules

- Tenants may define custom roles (`standard = false`)
- Custom role grants cannot exceed assigner's effective `permissionScope`
- Product permissions register under `{product}.{resource}.{action}` through `IAM_MODULE_MANIFEST_SPEC.md` and IMF discovery
- Platform kernel permissions remain in `iam-kernel`; product domains must not be seeded from `sdkwork-iam-bootstrap` monolith catalogs

## Surface Authorization Tiers And Consumer Default-Open Policy

> Motivation: consumer-facing (C-end) products `MUST` deliver a usable end-to-end experience
> with **zero per-feature permission configuration**. OAuth-style per-route scopes are a
> delegation mechanism for third-party open-api and service principals, not an access-control
> model for first-party consumer features. Requiring `appstore.catalog.read`-style scopes on
> consumer reads (or organization login scope on personal operations) forces every deployment
> to seed, grant, and maintain large permission catalogs and produces systemic 40301/40304
> failures. This section is normative for all app surfaces.

### Authorization Tiers

Every operation is classified into exactly one tier. The tier `MUST` be derived from the
operation's exposure and data ownership, not from the domain's permission catalog.

| Tier | Gate | Typical operations | Scope / permission requirement |
| --- | --- | --- | --- |
| 0 — public | none (principal optional) | store catalog browsing, charts, events, featured/recommendation content, public listings | `MUST NOT` require any scope or permission code |
| 1 — consumer-authenticated | any authenticated principal (personal tenant session) | search suggestions/trending, personalized feeds, creating personal resources (personal knowledge spaces, drafts) | `MUST NOT` require per-route scopes; authentication only |
| 2 — ownership / membership | authenticated + resource ownership or membership ACL (`app_user`) | reading/updating/deleting one's own history, spaces, drafts, memberships | `MUST` be enforced by ownership checks or resource ACLs, never by domain scopes |
| 3 — role / scope gated | explicit permission code or OAuth scope | publisher listing writes, moderation decisions, market channel admin, analytics dashboards, enterprise backend-api, platform operations | `x-sdkwork-permission` / scope checks allowed and expected |

Rules:

- First-party app-api (`/app/v3/api/...`) consumer operations `MUST` default to tier 0–2.
  Declaring `x-sdkwork-permission` on, or enforcing service-level scope checks for, tier 0–2
  operations is a contract violation.
- **Zero-config consumer journeys (framework execution rule)**: route-manifest
  `required_permission` gates `MUST NOT` block requests on app-api surfaces. The shared
  web-framework `ManifestAuthorizationPolicy` enforces manifest permissions on backend-api
  and open-api only; on app-api a signed-in principal without the declared code proceeds
  and access is decided by service-layer ownership/ACL checks. A product feature is
  considered done when it works for a freshly registered `app_user` with **zero** IAM
  catalog seeding, role grants, or per-feature permission toggles — "implement the API,
  then configure permissions before users can call it" is a delivery defect, not a
  deployment step.
- Per-route OAuth-style scopes (`{domain}.{resource}.{action}`) exist for third-party open-api
  delegation, service accounts/API keys, and enterprise backend-api routes — not for first-party
  C-end consumers. Open-api surfaces `MUST` still enforce their own authentication (API key,
  service principal) independently of tier classification.
- The standard `app_user` role `MUST` provide the full consumer experience out of the box: no
  domain read scopes need to be seeded, granted, or toggled for tier 0–2 operations, and
  applications `MUST NOT` require operators to enable per-feature scopes after deployment.
- Organization login scope (`loginScope = "ORGANIZATION"`) is required only for
  organization-shared resources and backend-api surfaces. A personal tenant session `MUST` be
  able to create and operate personal resources (for example personal knowledge spaces) on
  deployments with a configured runtime organization; persistence layers `MUST` accept the
  normalized organization `0` for personal resources (see §Tenant-Default Organization Context).
- Organization-scoped sessions that actively claim an organization context `MUST` still be
  validated against the deployment organization (fail-closed on mismatch).
- Consumer operations that touch money, real-name/personal-data export beyond the actor's own
  data, or administrative capabilities remain tier 3 regardless of surface.
- Service-layer scope helpers `SHOULD` distinguish these tiers; a shared service consumed by
  both app-api and open-api `MUST NOT` apply tier-3 scope gating to tier 0–2 operations of the
  consumer surface.

Migration rule: existing app-api operations that fail this classification (40301
`Missing required scope` / 40304 `organization context is required` on first-party consumer
features) `MUST` be migrated to the tier model: remove the scope requirement (tier 0/1) or
replace it with an ownership/ACL check (tier 2). Backend-api and open-api declarations are
unchanged.

### Tenant-Default Organization Context

Tenant-level (personal) login is the default session model for all business surfaces.
Organization context is optional enrichment, never a precondition.

Normative rules (apply to app-api, backend-api, open-api, and embedded service surfaces):

- **Normalization**: a session `organization_id` that is absent, `null`, blank, or `0`
  `MUST` be normalized to `0` (tenant scope) at context resolution. `null` and `0` are
  equivalent and both mean "no organization claimed".
- **No missing-context rejection**: business operations `MUST NOT` fail because the session
  lacks an organization context. Rejecting with 40304 `OrganizationAccessDenied`, a
  `missing_organization_id` problem, or a validation error such as
  `organizationId is required` derived from the *session context* is a contract violation.
  Explicit request-body organization fields `MAY` still be validated as ordinary data, and
  tier-3 permission/membership checks remain in force.
- **40304 semantics**: `OrganizationAccessDenied` (40304) is reserved for a session that
  actively claims organization `X` while the operation requires organization `Y`
  (fail-closed mismatch). It `MUST NOT` be emitted for an absent organization context.
- **Persistence**: resources created by a personal session are persisted with organization
  `0` (tenant-scoped personal resources). Persistence layers `MUST NOT` rewrite the actor's
  organization to a deployment runtime value.
- **Scope helpers**: shared context/scope helpers (for example
  `unwrap_or("0")` on `organization_id`) are the reference implementation pattern;
  `ok_or_else(... "organization context is required" ...)` on session organization is the
  forbidden anti-pattern.

Forbidden examples (all observed in the wild and removed during the 2026-09 regression):
`organization context is required for this operation` (40304 on `POST /app/v3/api/knowledge/spaces`),
`organization_id is required` on app-api handlers,
`organization scope is required in request context`.
Required behavior: normalize to `0` and let ownership/ACL/permission layers decide.

## Consumer Permission Composition

Consumer applications compose dependency modules as building blocks. See `APP_PERMISSION_COMPOSITION_SPEC.md`.

Rules:

- Consumers inherit dependency permission catalogs through app-surface `component.spec.json` `contracts.permissionComposition.moduleCatalogRefs[]`.
- Consumers **must not** duplicate dependency permission code lists in local TypeScript/Rust constants or feature-package catalogs.
- Consumers **may** declare application-owned permissions in their own `specs/iam.module.manifest.json`.
- Explicit **overrides** (aliases, route hints, bootstrap supplements) must be listed in `permissionComposition`; hidden local overrides are forbidden.
- Frontend route/menu hints may reference inherited codes; server enforcement remains mandatory per the Authorization Pipeline above.
- Client application roots with HTTP `sdkDependencies` `MUST` run `check-permission-composition.mjs` directly or through `verify-repo.mjs`.
- OpenAPI `x-sdkwork-permission` values `MUST` resolve to either an inherited dependency module catalog or the application's own IMF manifest.

## IMF Commands

Application roots with IAM Module Federation enabled must run:

```bash
pnpm run admin:iam-modules:validate
```

Materialization is performed by `sdkwork-iam-module-registry` during database bootstrap and `import_postgres_default_iam_seed`.

Related: `IAM_RBAC_FEDERATION_SPEC.md`, `IAM_CATALOG_GOVERNANCE_SPEC.md`

## Verification

```bash
node ../sdkwork-specs/tools/check-app-permission-tiers.mjs --workspace .
```

The gate fails when any `apis/app-api/**` operation declares `x-sdkwork-permission`
without `x-sdkwork-auth-tier: 3`. Application roots with HTTP `sdkDependencies` must
additionally run `check-permission-composition.mjs` (declared codes must resolve to a
module catalog).

## Acceptance

- [ ] All protected backend manifest routes declare `required_permission`
- [ ] Backend-api and open-api OpenAPI operations include matching `x-sdkwork-permission`
- [ ] `check-app-permission-tiers.mjs` passes: no app-api operation declares a
      per-route scope without an explicit `x-sdkwork-auth-tier: 3` classification
- [ ] App-api consumer operations are classified into surface authorization tiers and no
      tier 0–2 operation declares or enforces a per-route scope
- [ ] A freshly registered `app_user` can complete the core consumer journey with zero
      additional permission configuration (no 40301/40304 on tier 0–2 operations)
- [ ] Standard roles seeded with permission matrix
- [ ] Frontend uses `@sdkwork/iam-contracts` permission helpers (no raw HTTP auth)
