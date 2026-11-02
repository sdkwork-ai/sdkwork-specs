# Backend UI Package Standard

- Version: 1.1
- Scope: backend/admin React console, backend UI workspace packages, domain pages, backend SDK integration, menu and route composition
- Related: `API_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `DOMAIN_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `ICON_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `I18N_SPEC.md`, `MODULE_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines how SDKWork backend/admin UI is packaged and integrated. Backend UI is the UI implementation of the `backend-admin` surface. `backend-admin` means admin-only backend UI/API/SDK use for internal company staff, operators, support, auditors, platform administrators, and trusted backend services acting for those admin workflows. It must be independent from app/user-facing UI packages, must use backend API and backend SDK contracts, and must be split by business domain instead of being placed into one large package.

For client application roots, internal admin modules use the normalized `admin-<capability>` package family defined by `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` and the matching root architecture standard, such as `sdkwork-<application-code>-pc-admin-<capability>`, `sdkwork-<application-code>-h5-admin-<capability>`, `sdkwork_<application_code>_flutter_mobile_admin_<capability>`, `sdkwork-<application-code>-mp-admin-<capability>`, `sdkwork-<application-code>-android-mobile-admin-<capability>`, `sdkwork-<application-code>-ios-mobile-admin-<capability>`, or `sdkwork-<application-code>-harmony-mobile-admin-<capability>`. This file defines the backend/admin UI layering, SDK, permission, route, and operational design rules that those client admin modules must follow. The standalone backend React workspace keeps the `@sdkwork/react-backend-<domain>` package family.

The canonical implementation shape is the backend React workspace:

```text
apps/sdkwork-backend-react-web/
  src/                         # backend console host
  packages/
    sdkwork-react-backend-core/
    sdkwork-react-backend-ui/
    sdkwork-react-backend-auth/
    sdkwork-react-backend-user/
    sdkwork-react-backend-tenant/
    sdkwork-react-backend-org/
    sdkwork-react-backend-system/
    sdkwork-react-backend-resource/
    ...
```

## 1. Surface Boundary

Backend UI packages are not app UI packages.

| Surface | Package family | API surface | SDK source | Typical users |
| --- | --- | --- | --- | --- |
| App UI | `sdkwork-*-pc-react`, `sdkwork-*-mobile-react`, appbase packages | `/app/v3/api` | generated app SDK or approved appbase wrapper | end users, customer apps, desktop/mobile clients |
| User console UI | architecture-specific `*-console-*` or Dart `_console_` packages | `/app/v3/api` or approved console-facing app SDK surface | generated app SDK or approved appbase wrapper | customers, tenants, app owners, business users managing their own resources |
| Client internal admin UI | architecture-specific `*-admin-*` or Dart `_admin_` packages | `/backend/v3/api` | generated backend SDK or approved backend wrapper | `backend-admin`: company-internal staff, support, auditors, operators |
| Standalone backend UI | `@sdkwork/react-backend-*` | `/backend/v3/api` | generated backend SDK or approved backend wrapper | `backend-admin`: company-internal platform admins, support staff, auditors, operators |

Rules:

- Standalone backend UI `MUST` live in backend console packages named `@sdkwork/react-backend-<domain>`.
- Internal admin UI inside a client application root `MUST` live in the matching architecture-specific `admin-<capability>` package family.
- User-facing management console UI inside a client application root `MUST` live in the matching architecture-specific `console-<capability>` package family and is not the same surface as internal admin UI.
- Backend UI is `backend-admin` and `MUST NOT` be added to appbase app UI packages, customer app pages, default app packages, user console packages, or app SDK wrappers.
- App login, registration, session creation, OAuth callback, verification-code login, password reset, and user-facing QR login flows `MUST NOT` be implemented as backend UI capabilities. They belong to app-api and app UI.
- Backend UI may manage internal configuration, templates, audit records, provider bindings, feature flags, moderation, support, and operational resources through backend-api only.
- Backend UI `MUST` use `/backend/v3/api` through the generated backend SDK or approved backend service wrapper. It `MUST NOT` call `/app/v3/api` for operator features.

## 2. Package Split Rule

Backend UI cannot be placed into one universal business package.

| Package type | Naming | Owns | Must not own |
| --- | --- | --- | --- |
| Host shell | `apps/sdkwork-backend-react-web/src` | app bootstrap, providers, layout, top-level router, menu assembly, environment selection | domain business pages, domain repositories, SDK resource orchestration |
| SDK/runtime core | `@sdkwork/react-backend-core` | `BackendSdkProvider`, `useBackendSdkClient()`, SDK bootstrap helpers, shared response normalization | domain pages, domain copy, domain workflow logic |
| Common UI primitives | `@sdkwork/react-backend-ui` | buttons, tables, forms, drawers, dialogs, layout primitives with no business meaning | user management, tenant management, email code management, OAuth provider management, resource CRUD |
| Domain package | `@sdkwork/react-backend-<domain>` | domain pages, components, services, repositories, hooks, route/menu metadata, i18n | unrelated domains, concrete SDK construction, raw HTTP |
| Client admin domain package | architecture-specific `*-admin-<capability>` or Dart `_admin_<capability>` package | internal staff pages, components, services, hooks, route/menu metadata, i18n, permission constants | app/user pages, user console workflows, app SDK login/session creation |
| Cross-domain composition package | `@sdkwork/react-backend-<capability>` only when approved | a workflow that intentionally composes multiple published domain services | becoming a dumping ground for unrelated pages |

Rules:

- Every new backend feature `MUST` choose one owning business domain before files are created.
- A backend domain package `MUST` be named `@sdkwork/react-backend-<domain>` where `<domain>` is canonical kebab-case derived from `DOMAIN_SPEC.md`.
- A client application internal admin package `MUST` use the matching root architecture package family, such as `sdkwork-<application-code>-pc-admin-<capability>`, `sdkwork-<application-code>-h5-admin-<capability>`, `sdkwork_<application_code>_flutter_mobile_admin_<capability>`, `sdkwork-<application-code>-mp-admin-<capability>`, `sdkwork-<application-code>-android-mobile-admin-<capability>`, `sdkwork-<application-code>-ios-mobile-admin-<capability>`, or `sdkwork-<application-code>-harmony-mobile-admin-<capability>`.
- Business pages, business components, domain services, repositories, hooks, route records, menu records, permission constants, and domain i18n `MUST` stay in the owning domain package.
- `@sdkwork/react-backend-ui` `MUST` remain domain-neutral. It may expose visual primitives, not business workflows.
- `@sdkwork/react-backend-core` `MUST` remain SDK/runtime infrastructure. It may expose backend SDK provider hooks, not business repositories.
- A file named `common`, `misc`, `manager`, `base`, or `core` cannot own business behavior unless its bounded context is explicitly defined by a spec.
- If a backend feature touches multiple domains, split the implementation into domain-owned packages and compose them at route/page level through published service contracts.

### 2.1 Catch-All Package Ban

Rules:

- `@sdkwork/react-backend-ui` `MUST NOT` contain business pages, business services, repositories, route records, menu records, permission constants, or domain i18n.
- `@sdkwork/react-backend-core` `MUST NOT` contain business pages, business services, repositories, route records, menu records, permission constants, or domain i18n.
- Packages named `@sdkwork/react-backend-admin`, `@sdkwork/react-backend-console`, `@sdkwork/react-backend-manager`, `@sdkwork/react-backend-common`, or `@sdkwork/react-backend-business` are forbidden for new business UI.
- If an existing backend package has become a catch-all, new work must first choose the owning `@sdkwork/react-backend-<domain>` target and leave a migration note for the old package.
- A cross-domain backend workflow may have a composition package only when each domain still owns its service and page fragments through public exports.

### 2.2 Forbidden Client Admin Naming

Forbidden for new client-side admin modules (inside application roots):

| Forbidden pattern | Example | Use instead |
| --- | --- | --- |
| `sdkwork-<domain>-<capability>-pc-react` under `apps/sdkwork-<application-code>-pc/packages/` | `sdkwork-iam-oauth-pc-react` | `sdkwork-<application-code>-pc-admin-<capability>` |
| `@sdkwork/<domain>-<capability>-pc-react` for operator UI | `@sdkwork/iam-tenant-pc-react` | `@sdkwork/<application-code>-pc-admin-<capability>` |
| `sdkwork-<application-code>-admin-<capability>` without architecture segment | `sdkwork-iam-admin-oauth` | `sdkwork-<application-code>-pc-admin-<capability>` |
| User console workflow in `pc-admin-*` | tenant self-service in admin package | `sdkwork-<application-code>-pc-console-<capability>` |

Rules:

- Client internal admin UI `MUST` declare `backend-admin` surface metadata in `component.spec.json` and `package.json#sdkwork.surface`.
- Client internal admin capability packages `MUST` use the internal shape from `APP_PC_ARCHITECTURE_SPEC.md` §5: `pages/`, `components/`, `services/`, `types/`, `routes/`, thin `src/index.ts(x)`.
- Static verification in application repositories `SHOULD` fail when legacy admin directory names remain under the PC application root packages tree.

## 3. Standard Backend Domain Packages

The following backend package names are standard for the current backend console. New packages should align with this catalog or extend it through `DOMAIN_SPEC.md`.

| Package | Domain owner | Examples |
| --- | --- | --- |
| `@sdkwork/react-backend-auth` | `iam` operator auth/security administration | admin account security, access tokens, password reset operations, provider bindings |
| `@sdkwork/react-backend-user` | `iam` user administration | users, profiles, credentials, identity links |
| `@sdkwork/react-backend-tenant` | `iam` tenant administration | tenants, tenant settings, tenant audit |
| `@sdkwork/react-backend-org` | `iam` organization administration | departments, staff, roles, permissions |
| `@sdkwork/react-backend-system` | `system` | system settings, templates, notifications, diagnostics |
| `@sdkwork/react-backend-resource` | `integration` or resource governance | channel accounts, provider resources, proxy resources |
| `@sdkwork/react-backend-app` | `platform` | app registry, app instances, app settings, marketplace administration |
| `@sdkwork/react-backend-drive` | `drive` | storage providers, spaces, nodes, upload sessions, quotas, retention, file diagnostics |
| `@sdkwork/react-backend-cms` | `content` | articles, pages, assets, media publishing |
| `@sdkwork/react-backend-content` | `content` | content resources, editors, media publishing workflows that reference Drive files |
| `@sdkwork/react-backend-im` | `communication` | conversations, groups, contacts, messages |
| `@sdkwork/react-backend-rtc` | `communication` | calls, rooms, RTC access rules |
| `@sdkwork/react-backend-message` | `communication` | notices, notification messages, inbox administration |
| `@sdkwork/react-backend-llm` | `intelligence` | models, prompts, agents, skills, tool configuration |
| `@sdkwork/react-backend-model` | `intelligence` | AI model catalog and pricing support |
| `@sdkwork/react-backend-trade` | `commerce` | orders, refunds, settlement |
| `@sdkwork/react-backend-finance` | `commerce` | finance records, invoices, payouts |
| `@sdkwork/react-backend-vip` | `commerce` | memberships, benefit packs, recharge packages |
| `@sdkwork/react-backend-points` | `commerce` | points accounts, points records, rules |
| `@sdkwork/react-backend-shop` | `commerce` | shop configuration, brands, categories, shop staff |
| `@sdkwork/react-backend-merchandise` | `commerce` | merchandise catalog, SKU, attributes |
| `@sdkwork/react-backend-marketing` | `commerce` | campaigns, coupons, distribution |
| `@sdkwork/react-backend-iot` | `device` | device and IoT administration |
| `@sdkwork/react-backend-desktop` | `device` | desktop preferences, release/update administration |
| `@sdkwork/react-backend-notary` | app/domain extension | notary workflows and records |
| `@sdkwork/react-backend-notes` | content extension | notes administration |
| `@sdkwork/react-backend-stats` | observability/read model | dashboards and aggregated statistics |

Rules:

- One package can contain multiple closely related capabilities only when they share the same domain owner and permission prefix.
- One domain can have multiple packages when the capability is large enough to justify independent build, route, or release ownership.
- New package names `MUST` be added to this table or a local extension catalog before implementation.
- Backend packages that map to an existing domain `MUST` reuse that domain's API tag, SDK namespace, permission prefix, and i18n namespace.

## 4. Package Internal Shape

Backend domain packages should use this shape:

```text
packages/sdkwork-react-backend-<domain>/
  package.json
  src/
    index.ts
    components/
    pages/
    services/
    repository/       # or repositories/, choose one per package
    hooks/
    routes/
    i18n/
    types/
    permissions.ts
  tests/              # optional when tests are not colocated
```

Rules:

- `src/index.ts` `MUST` be the public export boundary.
- `pages/` owns route-level composition and can call hooks/services.
- `components/` owns domain-specific visual pieces and must receive data through props.
- `services/` owns domain orchestration and error normalization.
- `repository/` or `repositories/` owns thin SDK resource calls when the package uses repository naming. Do not use both names in new packages.
- `hooks/` owns React integration around services and state.
- `routes/` owns exported route records and menu metadata when the host shell composes package routes.
- `i18n/` owns package-local operator-facing locale fragments and thin aggregation exports. Backend/admin React packages `MUST` use the `src/i18n/<locale>/<domain>/<capability>/<fragment>.ts|json` layout from `I18N_SPEC.md` section 6.1. It must not contain an authored whole-backend, whole-domain, or whole-package locale monolith.
- `types/` owns view models only. API DTOs come from the generated backend SDK.
- `permissions.ts` owns permission constants that match backend permission codes such as `iam.users.read`.

## 5. Dependency Direction

Allowed dependency flow:

```text
host shell -> domain package routes/pages
domain package pages -> domain hooks
domain package hooks -> domain services
domain package services/repositories -> backend SDK client surface
domain package components -> backend UI primitives
domain package -> backend core only for provider hooks/types
```

Rules:

- Domain packages may depend on `@sdkwork/react-backend-core`, `@sdkwork/react-backend-ui`, and stable shared utility packages.
- Domain packages `MUST NOT` depend on the host shell `src/` internals.
- Domain packages `MUST NOT` import another domain package's `/src/...` internals.
- Cross-domain usage `MUST` go through public exports from `src/index.ts`.
- Cyclic dependencies between backend domain packages are forbidden.
- The host shell may compose routes and menus, but business logic must remain in domain packages.

## 6. Backend SDK Rule

Backend UI is a generated backend SDK consumer.

Rules:

- React entry points `SHOULD` use `BackendSdkProvider` and `useBackendSdkClient()`.
- Non-React services and repositories may use an injected backend SDK client or `getBackendSdkClient()` where the package standard already uses that pattern.
- New services `SHOULD` accept a client dependency so tests can supply a fake generated-SDK-compatible client.
- Missing backend SDK methods `MUST` be fixed by updating the owning backend API and regenerating the backend SDK through the `SDK_SPEC.md` SDK model and the generator flow defined by `SDK_WORKSPACE_GENERATION_SPEC.md`. Do not add raw HTTP as a workaround.
- Application-owned backend SDKs `MUST` use the `sdkwork-<domain>-backend-sdk` family and `sdkwork-<domain>-backend-api` authority naming from `SDK_SPEC.md`; their physical `sdks/` workspace, OpenAPI authority location, derived generator inputs, and generated output placement follow `SDK_WORKSPACE_GENERATION_SPEC.md`.
- Backend SDK and appbase backend SDK wrapper exports `MUST` live in `backend-admin` boundaries, such as `@sdkwork/react-backend-core`, a backend service module acting for admin workflows, architecture-specific `*-admin-core` packages, or Dart `_admin_core` packages. They `MUST NOT` be re-exported from app/user-facing frontend core packages or user console packages.
- Backend UI and client internal admin packages may use appbase backend SDK for `backend-admin` IAM management. User-facing contacts, address books, workspace navigation, and customer-owned IAM directory read views remain app SDK capabilities and must not be moved into backend UI merely to access backend SDK resources.
- Backend UI `MUST NOT` use `fetch`, `axios`, manual auth/API key headers, string-built backend URLs, or `getBackendSdkClient().http` to bypass missing SDK methods.
- Backend UI `MUST NOT` hand-edit generated backend SDK output.
- File upload/download exceptions must use generated Drive backend/app SDK methods or approved backend-core helpers around Drive contracts when the API explicitly returns Drive grants, presigned URLs, or stable file content URLs. Backend UI must not create app-local upload clients around missing SDK methods.

## 7. API And Permission Mapping

Rules:

- Backend UI packages `MUST` call backend-api operations under `/backend/v3/api`.
- Backend UI packages `MUST NOT` expose or consume backend login/session creation endpoints. Backend login/session creation is forbidden by `API_SPEC.md`.
- Operator authentication state may be displayed by backend UI, but session creation belongs to app-api or the existing approved backend console bootstrap flow.
- Every protected page or action `SHOULD` map to a backend permission code.
- Permission prefixes `MUST` match the owning domain, such as `iam.users.read`, `system.email_templates.update`, or `integration.providers.manage`.
- Frontend permission checks are navigation and affordance hints only. Backend authorization remains mandatory.

## 8. UI Design Boundary

Rules:

- Backend UI should be dense, flat, operational, and optimized for repeated administrative work.
- Backend UI `MUST` use shared backend UI primitives or the host design system for tables, forms, drawers, dialogs, filters, tabs, and command buttons.
- Domain packages `MUST NOT` redefine global theme tokens, global layout, global reset CSS, or application shell navigation styles.
- The operator sidebar and any admin navigation rail `MUST` follow `ICON_SPEC.md` section 3.3: the active destination renders the filled icon variant, every inactive destination renders the outline variant of the same glyph, and a group header fills only when it contains the active route. Selection `MUST NOT` rely on color alone; the active row `SHOULD` also carry a selected surface or indicator.
- `@sdkwork/react-backend-ui` primitives `MUST` be visually neutral and domain-agnostic.
- Business components may contain domain labels and domain-specific formatting, but must not contain transport or authorization logic.

## 9. Configuration And I18n

Rules:

- Backend domain packages `MUST NOT` read `.env` files, `process.env`, local storage, or global runtime config directly.
- Runtime config belongs to the host shell and backend core provider.
- Feature flags that hide or reveal backend pages `MUST` be passed through typed config or route metadata.
- Operator-facing text `SHOULD` live in the domain package `i18n/` folder as domain/capability/route fragments following `I18N_SPEC.md` section 6.1, not in a shared backend-wide locale file.
- App/user-facing login copy `MUST NOT` be reused as backend operator copy unless the text is truly surface-neutral.

## 10. Testing And Governance

Every backend package change should include focused tests.

Required coverage for new backend UI capabilities:

- service/repository test using a fake backend SDK client;
- page or hook test for loading, empty, permission-denied, validation-error, and failure states where relevant;
- route/menu registration test when adding a new package route;
- operator sidebar icon state test proving the active destination renders the filled variant and every inactive destination renders the outline variant of the same glyph, including light and dark themes (`ICON_SPEC.md` section 3.3);
- i18n directory/static scan proving operator-facing fragments stay under `src/i18n/<locale>/<domain>/<capability>/` and no backend-wide locale monolith is authored;
- SDK compliance scan proving no raw HTTP fallback was introduced;
- typecheck for the changed package.

Acceptance checklist:

- [ ] Feature is placed in the correct `@sdkwork/react-backend-<domain>` package.
- [ ] No business behavior was added to `@sdkwork/react-backend-ui` or `@sdkwork/react-backend-core`.
- [ ] Host shell only composes routes, menus, providers, and layout.
- [ ] Services call generated backend SDK surfaces or approved backend-core helpers.
- [ ] No raw HTTP, manual auth/API key headers, generated SDK edits, or app-api calls exist in backend UI business code.
- [ ] Permissions, i18n namespace, API tag, SDK namespace, and domain owner align.
- [ ] Tests cover SDK orchestration and representative UI behavior.
