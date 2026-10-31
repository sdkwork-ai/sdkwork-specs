# App PC React UI Standard

- Version: 1.1
- Scope: app/user-facing PC React packages, PC browser/desktop/tablet renderer UI packages, pad React tablet packages, appbase PC modules, service-to-app-SDK integration
- Related: `API_SPEC.md`, `APPLICATION_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_PAD_ARCHITECTURE_SPEC.md`, `COMPONENT_SPEC.md`, `DESKTOP_APP_ARCHITECTURE_SPEC.md`, `DOMAIN_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `I18N_SPEC.md`, `MODULE_SPEC.md`, `SDK_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`

This standard defines how SDKWork app-side PC React UI is packaged and integrated. PC React app UI is user-facing product UI. It must be independent from `backend-admin` UI packages and must consume app API capabilities through the generated app SDK or approved appbase wrappers.

For a complete PC browser/desktop/tablet application root, first apply `APP_PC_ARCHITECTURE_SPEC.md`. That standard owns `apps/sdkwork-<application-code>-pc/`, normalized package names such as `sdkwork-<application-code>-pc-<capability>`, user-facing console package names such as `sdkwork-<application-code>-pc-console-<capability>`, company-internal admin package names such as `sdkwork-<application-code>-pc-admin-<capability>`, and the shared web/desktop/tablet renderer boundary. This file owns the detailed app-side React UI rules inside those packages.

This standard is selected through `UI_ARCHITECTURE_SPEC.md` and applies only to app/user-facing PC React packages. A pad root applies this standard with the `pad` package segment and the tablet overrides in `APP_PAD_ARCHITECTURE_SPEC.md`; its tablet adaptation rules take precedence over the PC interaction assumptions in section 5. PC user-facing console packages may reuse these React UI layering rules after `APP_PC_ARCHITECTURE_SPEC.md`, but internal admin packages must also follow `BACKEND_UI_SPEC.md`.

Use `DESKTOP_APP_ARCHITECTURE_SPEC.md` for desktop shell, Tauri host, native capability adapter, session/bootstrap, desktop packaging, and release boundaries. This file owns PC React UI packages and app-facing interaction rules.

Use `IAM_LOGIN_INTEGRATION_SPEC.md` for sdkwork-iam login/session integration, AuthGate behavior, generated app SDK token wiring, logout clearing, and Rust protected API validation. This file owns PC React package placement and user-facing UI rules.

Use `APP_SDK_INTEGRATION_SPEC.md` when PC React apps compose generated TypeScript app SDKs, appbase IAM runtime, dependency SDKs, and product service facades.

Canonical app PC React package shape:

```text
apps/sdkwork-appbase/
  packages/
    pc-react/
      iam/
        sdkwork-auth-pc-react/
        sdkwork-user-pc-react/
      foundation/
        sdkwork-appbase-pc-react/
        sdkwork-shell-pc-react/
        sdkwork-workspace-pc-react/
      commerce/
      communication/
      content/
      intelligence/
      system/
```

## 1. Surface Boundary

| Surface | Package family | API surface | SDK source | Typical users |
| --- | --- | --- | --- | --- |
| App PC React UI | `sdkwork-<capability>-pc-react` or `sdkwork-<application-code>-pc-<capability>` | `/app/v3/api` | generated app SDK or approved appbase wrapper | end users and app users |
| PC user console React UI | `sdkwork-<application-code>-pc-console-<capability>` | `/app/v3/api` or approved console-facing app SDK surface | generated app SDK or approved appbase wrapper | customers, tenants, app owners, business users managing their own resources |
| PC internal admin React UI | `sdkwork-<application-code>-pc-admin-<capability>` | `/backend/v3/api` | generated backend SDK or approved backend wrapper | internal staff, operators, support, auditors (`backend-admin`) |
| Standalone backend UI | `@sdkwork/react-backend-*` | `/backend/v3/api` | generated backend SDK or approved backend wrapper for `backend-admin` | admins and operators in standalone backend console hosts |

Rules:

- App PC React UI `MUST` live in app-side packages such as `sdkwork-<capability>-pc-react` or normalized PC application packages such as `sdkwork-<application-code>-pc-<capability>`.
- App PC React UI `MUST NOT` be placed in `@sdkwork/react-backend-*` packages.
- PC packages without `pc-console` or `pc-admin` are app/user modules by default.
- PC user console modules `MUST` be named `sdkwork-<application-code>-pc-console-<capability>` and must not be treated as company-internal admin modules.
- App PC React services `MUST` consume `/app/v3/api` through generated app SDK clients or approved appbase service wrappers.
- App PC React UI `MUST NOT` call backend-api or backend SDK for user-facing workflows.
- App PC React packages and PC user console packages are non-admin unless their package boundary is explicitly `backend-admin`. They `MUST` use generated app SDK clients or approved app SDK wrappers and `MUST NOT` import, export, construct, proxy, or route through backend SDK clients, appbase backend SDK clients, backend wrapper functions, backend generated SDK packages, or backend base URL resolvers.
- Login, registration, sessions, OAuth, password reset, QR login, current user flows, and messaging-owned verification-code delivery belong to app UI and app-api.
- Operator-only resource management, tenant administration, platform settings, and audit consoles belong to `backend-admin` backend UI.
- New internal admin modules inside a PC application root `MUST NOT` use legacy names such as `sdkwork-<domain>-<capability>-pc-react` or `@sdkwork/<domain>-<capability>-pc-react`. Use `sdkwork-<application-code>-pc-admin-<capability>` and follow `BACKEND_UI_SPEC.md`.
- PC user console modules `MUST NOT` be named `pc-admin-*`. Console and admin surfaces are different users, routes, SDK clients, and permission models.

## 2. Package Split

App PC React packages are split by user-facing capability and domain.

| Package type | Naming | Owns | Must not own |
| --- | --- | --- | --- |
| app shell/runtime | app-specific `src/` or runtime package | providers, client navigation, SDK bootstrap, token store, deployment profile, runtime target, host integration | reusable domain pages and services |
| appbase foundation | `sdkwork-<foundation>-pc-react` | reusable shell, workspace, command palette, search, appbase utilities | business-domain API shortcuts |
| domain feature package | `sdkwork-<capability>-pc-react` or `sdkwork-<application-code>-pc-<capability>` | user-facing pages, components, services, hooks, i18n, route metadata | concrete SDK construction, backend admin logic |
| user console package | `sdkwork-<application-code>-pc-console-<capability>` | user-facing management console pages, components, services, hooks, i18n, route metadata | company-internal admin workflows, backend-only operation center behavior |
| contracts/service package | common IAM or domain service packages | typed SDK ports, domain orchestration, API DTO adaptation | React rendering and app shell state |

Rules:

- Every package `MUST` declare one primary capability.
- New IAM/user/auth work `MUST` use `iam` naming, not `identity`.
- Business UI `MUST` be placed under the closest domain family such as `iam`, `commerce`, `communication`, `content`, `intelligence`, `system`, `device`, or `ecosystem`.
- Appbase foundation packages `MUST` use `<foundation>` tokens `shell`, `workspace`, `command`, `search`, or `appbase` in `sdkwork-<foundation>-pc-react`.
- App PC React packages `MUST` not become catch-all app modules. Split independent domains into separate packages.
- PC console packages `MUST` not become catch-all management modules. Split independent customer/tenant/app-owner management capabilities into `sdkwork-<application-code>-pc-console-<capability>` packages.
- A shared UI primitive package may exist only for domain-neutral PC React primitives. It must not include business workflows.

## 3. Internal Shape

Recommended package structure:

```text
apps/sdkwork-<application-code>-pc/packages/<package>/
  package.json
  src/
    index.ts
    pages/
    components/
    hooks/
    services/
    state/
    i18n/
    types/
    routes/
  tests/
  specs/
```

Rules:

- `src/index.ts` is the public export boundary.
- `pages/` owns route-level feature composition.
- `components/` owns reusable or domain-specific UI pieces.
- `services/` owns SDK orchestration through injected app SDK ports.
- `hooks/` owns React integration around services and state.
- `state/` owns view/cache state only, not backend invariants.
- `i18n/` owns package-local user-facing locale fragments, thin aggregation exports, and locale fallback wiring through the provider. React TypeScript packages `MUST` use the `src/i18n/<locale>/<domain>/<capability>/<fragment>.ts|json` layout from `I18N_SPEC.md` section 6.1. It must not contain an authored whole-app or whole-package locale monolith.
- `types/` owns local view models only. API DTOs come from generated app SDKs or shared contracts.
- `routes/` owns route metadata when the package contributes routes to an app shell.
- `specs/` follows `COMPONENT_SPEC.md` when the package is an authored app/component package.

## 4. SDK Integration

Rules:

- Services `MUST` accept app SDK clients or narrow SDK port interfaces.
- Runtime/bootstrap `MUST` construct generated TypeScript app SDK clients, appbase app SDK clients, one global token manager, appbase IAM runtime, and product service providers. It may construct appbase backend SDK clients only inside a `backend-admin` runtime boundary.
- The PC React IAM runtime `MUST` use `@sdkwork/iam-runtime` / `@sdkwork/iam-react` or an approved wrapper with the same `createIamRuntime` semantics.
- `appbaseApp`, optional `backend-admin` `appbaseBackend`, downstream app-api SDK clients, and explicit `backend-admin` backend-api SDK clients `MUST` share the same global token manager through `setTokenManager` or equivalent generated SDK credential APIs.
- Login, registration, current session, refresh, logout, OAuth, QR auth, password reset, runtime metadata, and current-user profile reads `MUST` use `@sdkwork/iam-app-sdk` resources or appbase PC React auth wrappers built on those resources. Verification-code delivery and verification `MUST` use the generated messaging app SDK surface or an appbase auth wrapper that delegates to an injected messaging client.
- Contacts, address books, workspace navigation, organization trees, department trees, memberships, assignments, positions, and role-binding read views in app PC React or PC user console packages `MUST` use appbase app SDK resources or approved app SDK wrappers. They `MUST NOT` use appbase backend SDK, application-owned backend SDK, backend wrapper functions, or backend base URL resolvers.
- App/user-facing PC React core exports `MUST` keep the application-owned app SDK and appbase app SDK wrappers available to frontend app integration. Removing app SDK exports to avoid backend SDK leakage is forbidden; move backend wrappers to a `backend-admin` export boundary instead.
- Backend SDK and appbase backend SDK wrappers may be constructed only by `backend-admin` packages or their admin-core providers. App auth runtime and user-facing app/console packages `MUST NOT` construct them.
- Application PC React packages `MUST NOT` create local auth SDK ports such as `auth.login`, `auth.refreshToken`, `auth.register`, `user.getUserProfile`, or user-center session clients when the standard appbase resource exists.
- UI components `MUST NOT` construct SDK clients, call raw HTTP, manually attach auth/API key headers, or parse JWTs for authorization.
- Missing app SDK methods `MUST` be fixed in the owning app-api OpenAPI authority and generator inputs before integration. Legacy Java Plus app-api authorities may be used only under registered L0 migration exceptions.
- App PC React packages `MUST NOT` import generated SDK internals just to bypass an appbase wrapper gap.
- Tests `SHOULD` use fake clients implementing the same generated app SDK resource surface.

Example surface:

```ts
export interface AuthAppClientPort {
  auth: {
    sessions: {
      create(body: unknown): Promise<unknown>;
      refresh(body: unknown): Promise<unknown>;
    };
  };
  messaging: {
    verificationCodes: {
      create(body: unknown): Promise<unknown>;
      verify(body: unknown): Promise<unknown>;
    };
  };
}
```

## 5. PC Interaction And Design

Rules:

- PC React UI should prioritize keyboard, pointer, large-screen density, route persistence, and multitasking.
- PC React UI `MUST` support adaptive large-screen tablet layouts when the PC root enables iPadOS or Android tablet packaging through Tauri.
- Pad React UI `MUST` apply `APP_PAD_ARCHITECTURE_SPEC.md` section 5: tablet window classes, navigation rail/sidebar, master-detail and split panes, multitasking, input parity, safe areas, accessibility, and performance. It `MUST NOT` inherit a fixed PC viewport assumption or a phone-first shell.
- Complex workflows `SHOULD` use tabs, drawers, side panels, step flows, and table/filter patterns that fit desktop use.
- Feature pages `MUST` provide loading, empty, validation-error, permission-denied, unavailable, and unknown-error states.
- Text must fit responsive PC and tablet widths without overlap.
- Icon-only controls `MUST` have accessible names and tooltips when the icon is not universally obvious.
- App PC UI `MUST` use the app design system and tokens instead of redefining global themes per package.
- Tablet-enabled PC UI `MUST` handle safe areas, orientation changes, virtual keyboard overlap, touch/stylus input, pointer input, hardware keyboard shortcuts, split view or multi-window where supported, and platform back/close affordances.
- Tablet-enabled PC UI `MUST NOT` replace the large-screen workflow with phone-first navigation. Phone-first H5 belongs to `APP_H5_ARCHITECTURE_SPEC.md` and `APP_MOBILE_REACT_UI_SPEC.md`.

## 6. Auth And Security

Rules:

- App PC auth state must clear sensitive state on logout, token refresh failure, tenant switch, and account switch.
- PC React app shells that require login `MUST` provide an AuthGate or equivalent route guard using appbase IAM auth routes and the session rules in `IAM_LOGIN_INTEGRATION_SPEC.md`.
- Session commit, token persistence, AppContext propagation, refresh-token continuation, stale context clearing, logout clearing, and refresh failure behavior `MUST` follow `APP_SDK_INTEGRATION_SPEC.md` and `IAM_LOGIN_INTEGRATION_SPEC.md`.
- Frontend permission checks are hints only. App-api authorization remains mandatory.
- Verification codes, refresh tokens, access tokens, OAuth codes, QR keys, and password reset tokens `MUST NOT` be logged or displayed.
- OAuth and QR login UI must show only user-safe state and must not expose provider secrets or raw callback payloads.

## 7. Testing

Required coverage for new App PC React capabilities:

- service test with a fake generated app SDK client;
- UI/page test for the main success and failure states;
- route contribution test when adding app shell routes;
- i18n directory/static scan and fallback test for user-facing text when new copy is added;
- typecheck for the changed package.

Acceptance checklist:

- [ ] Package belongs to the correct app-side domain/capability.
- [ ] UI calls services, services call injected app SDK clients.
- [ ] Runtime/bootstrap wires appbase IAM runtime, appbase SDK clients, product SDK clients, and one global token manager according to `APP_SDK_INTEGRATION_SPEC.md`.
- [ ] No backend-api, backend SDK, raw HTTP, manual auth/API key headers, or generated SDK edits were introduced.
- [ ] Auth/session/token-sensitive state is handled safely.
- [ ] Appbase IAM login/session integration follows `IAM_LOGIN_INTEGRATION_SPEC.md` when protected app routes are present.
- [ ] Tests cover SDK orchestration and representative UI states.
