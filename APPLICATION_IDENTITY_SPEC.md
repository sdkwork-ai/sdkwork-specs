# SDKWork Application Identity Standard

- Version: 1.0
- Scope: application identity anchor, one-to-one relations across deployment/identity/commerce modules, access-token application binding, tenant isolation dimension, lifecycle state vocabulary, naming and conformance
- Related: `IAM_SPEC.md`, `IAM_OAUTH_SPEC.md`, `IAM_APPLICATION_BOOTSTRAP_SPEC.md`, `DATABASE_SPEC.md`, `DATABASE_FRAMEWORK_SPEC.md`, `API_SPEC.md`, `NAMING_SPEC.md`, `SECURITY_SPEC.md`, `MIGRATION_SPEC.md`, `TEST_SPEC.md`
- Canonical location: `APPLICATION_IDENTITY_SPEC.md` in the `sdkwork-specs` standards root

This standard defines what "an application" means in SDKWork, which module owns which layer of it, and how an access token binds to one tenant's running application. It exists because deployment, identity, and commerce each grew their own notion of "application" and template, and the only thing joining them was a free-form document.

## 1. Concepts And Vocabulary

Exactly one word per concept. A word listed in the third column `MUST NOT` be used to mean the concept in the second column.

| Term | Meaning | `MUST NOT` mean |
| --- | --- | --- |
| Deploy application | The runtime identity anchor: the deployed, running application of one tenant | product identity, OAuth client, installation record |
| Installation | One tenant's installed instance of a product, bound one-to-one to a deploy application | the product itself, the OAuth client |
| Blueprint | The identity slice of one product version: OAuth relying party metadata, scopes, domains, packages, frozen at install time | a standalone third application definition, a commerce listing, a scaffold |
| Product application | The cross-tenant product identity that is developed and published | a tenant installation, a deployed unit |
| Listing | The commerce and distribution surface, including price | the runtime or identity definition |
| SKU | One independently describable, deliverable variant of a product | a version number, an optimistic-lock column |
| Scaffold | Design-time generator input used to create a product application | a runtime definition |
| Client credential | The OAuth client id and secret of one installation | the application identity |

Terms `template`, `app`, and `version` are retired as application-identity vocabulary. Where they survive as physical names, they refer to the specific subordinate concept above and `MUST` be documented as such.

A `template` `MUST NOT` name a first-class application definition in a new contract. The only surviving template concept is the design-time scaffold (§1 Scaffold), which is a generator input rather than an application definition.

## 2. Identity Anchor

- The runtime application identity `MUST` be the deploy application. `MUST NOT` be the product application id, the installation id, or the OAuth client id.
- The anchor identity `MUST` be a stable string on the wire per `API_SPEC.md` §13.6 (int64 identifiers are serialized as strings; consumers `MUST NOT` convert them to numbers).
- The anchor `MUST` be scoped to exactly one tenant. A cross-tenant "application" is the product application, not the anchor.

## 3. One-to-One Relations

| Relation | Cardinality | Rule |
| --- | --- | --- |
| Installation ↔ deploy application | exactly 1:1 | one install record per anchor, one anchor per install record |
| Product application ↔ deploy application | exactly 1:1 per tenant | a tenant's copy of a product has one anchor |
| Product version ↔ installation | 1:N | one immutable version serves many installs; the install freezes the identity slice it was created from |

Rules:

- Every one-to-one relation `MUST` be enforced by a database unique constraint. It `MUST NOT` be enforced only in a client, a console form, or a name-matching heuristic.
- Name, slug, or display-text matching `MUST NOT` be used to resolve an application across modules.
- A nullable or list-valued link `MAY` exist only during a dated migration, `MUST` carry an owner and an exit milestone, and `MUST NOT` be read as the authority.
- Cross-module links `MUST` be stored in a normalized relation owned by the anchor's module, with the linked module's prefix absent from the table name only when the relation is anchor-owned (see §7).
- A standalone blueprint table `MUST NOT` be introduced. The identity slice belongs to the product version (the definition that is authored and published) and to the installation (the resolved domain and the client credential created at install time); a third copy is a third source of truth.

## 4. Access Token Binding

An access token issued for an application instance `MUST` carry:

| Claim | Meaning |
| --- | --- |
| `sub` | subject: user or service account |
| `tid` | tenant |
| `oid` | organization, when the session is organization-scoped |
| `app_id` | **deploy application identity**, in every token family |
| `aud` | equal to `app_id` for deployment credentials; equal to the authorized client id for OAuth authorization-server tokens |
| `azp` | OAuth authorization-server tokens: the authorized client id. Deployment session tokens omit it, because `IAM_SPEC` §5.2 admits a closed claim list that does not include it |
| `env`, `dlv` | environment and deployment mode |
| `scp` | granted scopes (resolved server side; `IAM_SPEC` §5.2 forbids signing permission scope) |
| `sid`, `jti`, `iat`, `exp`, `kid` | session, token, and signing metadata |

Invariants:

1. `aud` `MUST` equal `app_id` for a deployment credential, and `MUST` equal the authorized client id for an OAuth authorization-server token. In both families `app_id` is the anchor and a token `MUST NOT` be accepted by another application.
2. The anchor named by `app_id` `MUST` belong to `tid`. Issuance and validation `MUST` both prove this.
3. Data-plane queries `MUST` filter by `(tenant_id, app_id)`. Cross-tenant access `MUST` require an explicit platform scope.
4. A token `MUST NOT` carry a second installation claim beside `app_id`: the installation is one-to-one with the anchor, so a second claim can only disagree with it.
5. A token `MUST NOT` be issued for a client id that is not bound to an enabled installation.

Retired: using the OAuth client id as the token `app_id`, and using an `iam_*` tenant-application row as the application identity. Both `MUST NOT` appear in new contracts.

Two token families share the anchor but not the audience:

- **Deployment credential** (local session and access tokens): `aud = app_id`, `azp` omitted.
- **OAuth authorization-server token** (authorization code and refresh grants): `app_id =` the deployment anchor, `aud = azp =` the authorized client id. A deployment that presents such a token to another application is rejected by the audience check that compares `aud` against its own client identifiers.

## 5. Cross-Module References

- Each concept has exactly one source-of-record module (§7 prefix). Other modules `MUST` store identifiers, not copies of identity fields.
- Cross-module foreign keys are `MUST NOT` be created. Integrity is provided by the owning relation plus a reconciliation job.
- A reconciliation job `MUST` exist for every governed soft reference and `MUST` report dangling identifiers. Silently ignoring a dangling reference `MUST NOT` be treated as a valid state.
- A reference that cannot be validated at write time `MUST` be validated asynchronously and surfaced as an operational alert.

## 6. Lifecycle States

- Application lifecycle `MUST` use one vocabulary: `draft`, `pending_review`, `approved`, `published`, `deprecated`, `retired`.
- A domain `MAY` add sub-states (for example a deployment or distribution sub-state), but `MUST` publish a mapping table from its sub-state to the canonical state, and `MUST NOT` invent a second top-level vocabulary.
- State transitions `MUST` be enforced in one place per concept; a client `MUST NOT` be the only guard against an invalid transition.
- `retired` `MUST` be reachable only through an approved forward migration, never by deleting history.

## 7. Naming And Ownership

- Physical names `MUST` satisfy `DATABASE_SPEC.md` §7: `<module_prefix>_<entity_name>`, singular entity, registered prefix, `uk_`/`idx_`/`fk_` constraint naming.
- The retired `studio_` prefix `MUST NOT` name a new table (`DATABASE_SPEC.md` DB071, as amended).
- Recommended ownership of the concepts in §1:

| Concept | Owner prefix |
| --- | --- |
| deploy application, anchor relation, scaffold, build recipe | `deploy_` |
| installation, client credential | `iam_` |
| product application, version (including its identity slice), SKU, listing, price | `appstore_` |

The scaffold family is owned by the module that owns the deploy application. Exactly one scaffold family `MUST` exist in the platform; a second scaffold in another module `MUST NOT` be introduced.

- A new prefix `MUST` be registered in `tools/database-module-registry.json` before first use; borrowing a prefix that belongs to another module `MUST NOT` be used as a shortcut.

## 8. Migration Requirements

Pre-launch, a breaking change `MUST` still satisfy:

1. **Duplicate scan before uniqueness**: before adding a one-to-one constraint, scan for existing duplicate links and resolve them explicitly. `MUST NOT` add the constraint by deleting rows silently.
2. **Orphan scan**: linked identifiers that no longer exist `MUST` be reported and recorded, not dropped.
3. **Backfill reconciliation**: the backfilled relation `MUST` be reconciled against its legacy source with an exact count report.
4. **Dual-issue window**: token semantics changes `MUST` accept the legacy and the new claim during the window, with one consumer switched over per release.
5. **No compatibility layer at the schema level pre-launch**: no parallel old/new tables, no dual-write to both schemas; a switch-over plus a forward fix is required instead.

## 9. Supersedes

This standard supersedes the following behaviours once a consumer migrates:

- `iam_tenant_application.app_id` acting as both runtime identity and OAuth client id.
- `iam_application_template` / `iam_application_template_package` acting as a third application definition beside the product and the installation.
- `deploy_app_template` / `deploy_app_template_version` / `deploy_app_template_category` acting as a second commerce authority beside the product listing and its price.
- `deploy_build_template` being read as an application template; it is a build recipe (toolchain, commands, artifact outputs, quality gates).
- `appstore_app_template` / `appstore_app_template_version` / `appstore_app_template_usage` acting as a second scaffold beside the deploy-owned scaffold.
- A free-form JSON document (for example a deployment application's `metadata`) acting as the authority for cross-system application links.
- Display-name or slug matching used to resolve one module's application to another's.
- Commerce price fields held in more than one module.
- `studio_` as an approved design-time prefix.

## 10. Conformance Checklist

- [ ] Application identity is the deploy application and is serialized as a string.
- [ ] Installation ↔ anchor and product ↔ anchor relations are enforced by unique constraints.
- [ ] No display-name matching resolves an application across modules.
- [ ] Access tokens carry `app_id` as the anchor, `aud == app_id`, and no second installation claim.
- [ ] Data queries filter by `(tenant_id, app_id)`; cross-tenant access requires a platform scope.
- [ ] One price authority per application.
- [ ] Every cross-module soft reference has a reconciliation job.
- [ ] Table, index, and constraint names satisfy `DATABASE_SPEC.md` §7 and use registered prefixes only.
