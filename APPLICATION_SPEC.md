# Application Module Standard

- Version: 1.0
- Scope: all SDKWork standalone/cloud, desktop, web, and mobile applications
- Related: `SDKWORK_WORKSPACE_SPEC.md`, `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `DOMAIN_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MODULE_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, `BACKEND_UI_SPEC.md`, `CONFIG_SPEC.md`, `APP_MANIFEST_SPEC.md`, `API_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `SDK_SPEC.md`, `IAM_SPEC.md`, `DEPLOYMENT_SPEC.md`, `TEST_SPEC.md`

This standard defines how applications are assembled from reusable modules. The goal is to make applications thin composition layers and keep shared capabilities reusable across standalone/cloud backends, Rust-enabled runtimes, and different frontend architectures.

Use `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md` for application-wide L0-L6 API/service/domain/repository/adapter/runtime/frontend layering, dependency direction, and open-closed extension rules. Use `COMPOSABLE_ARCHITECTURE_SPEC.md` for cross-stack building-block architecture, layer roles, ports, frontend package composition, Rust crate dependency boundaries, route ownership, permission inheritance, and resolved architecture graphs. Use `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` for cross-client package taxonomy, route identity, component boundaries, dependency direction, host adapter boundaries, and SDK/IAM/runtime alignment. Use `APP_COMPOSITION_SPEC.md` for native-authority composition, core-package import entrypoints, and runtime metadata placement. Use `APP_SDK_INTEGRATION_SPEC.md` for cross-architecture generated SDK wiring, dependency SDK composition, appbase IAM runtime, global TokenManager, and Rust backend composition. Use `APP_PC_ARCHITECTURE_SPEC.md` for PC browser/desktop application roots, `APP_H5_ARCHITECTURE_SPEC.md` for H5/Capacitor application roots, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md` for Flutter mobile roots, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md` for mini program roots, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md` for native Android roots, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md` for native iOS roots, and `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md` for native HarmonyOS roots. Use the matching UI/package standard for detailed UI package rules, including `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, and `APP_MINI_PROGRAM_UI_SPEC.md` for their package-local UI rules. Use `MODULE_SPEC.md` for reusable package contracts, `FRONTEND_SPEC.md` for architecture-neutral UI-service-SDK rules, `WEB_FRAMEWORK_SPEC.md` for mandatory SDKWork HTTP `*-api` framework integration, `WEB_BACKEND_SPEC.md` for Java/Rust web backend implementation boundaries, `CONFIG_SPEC.md` for environment and SDK client bootstrap, and `APP_MANIFEST_SPEC.md` for `sdkwork.app.config.json`.

Every application root `MUST` contain the source-controlled `.sdkwork/` workspace required by `SDKWORK_WORKSPACE_SPEC.md`, including `.sdkwork/skills/` and `.sdkwork/plugins/`. This directory stores local development knowledge and repository/application extensions; it is separate from generated SDK output `.sdkwork/` control-plane files and user-private runtime `~/.sdkwork/<application-code>` directories.

Independent SDKWork application roots `MUST` use the standard project root directory dictionary from `SDKWORK_WORKSPACE_SPEC.md`: `apis/`, `apps/`, `crates/`, `sdks/`, `jobs/`, `tools/`, `plugins/`, `examples/`, `etc/`, `deployments/`, `scripts/`, `docs/`, and `tests/`. A directory becomes required when the application owns that capability. Independently deployable roots `MUST` create `etc/`; reusable packages and SDKs `MUST NOT` duplicate it. Narrow-purpose roots may omit inactive capability directories when the root README documents the active layout.

Application root placement rules:

- API contracts, API examples, and API materialization inputs belong in `apis/`; generated SDK family workspaces and generated SDK output belong in `sdks/`.
- Runnable app shells, application surfaces, and independently packaged app compositions belong under `apps/`. Even a single-surface repository `MUST` use `apps/sdkwork-<application-code>-<client-arch>/` as the architecture-specific application root rather than treating the git repository root as the package-family root.
- Every independent SDKWork application git repository `MUST` keep `apps/README.md` at the repository root. That file is the human directory index for application roots under `apps/` and `MUST` follow `DOCUMENTATION_SPEC.md` section 3.3.
- `apps/` is a collection of application roots. Each child directory under `apps/` is the root for one selected application language/architecture or shared package-family surface, for example `apps/sdkwork-<application-code>-common/`, `apps/sdkwork-<application-code>-pc/`, `apps/sdkwork-<application-code>-h5/`, `apps/sdkwork-<application-code>-flutter-mobile/`, `apps/sdkwork-<application-code>-mini-program/`, `apps/sdkwork-<application-code>-android-mobile/`, `apps/sdkwork-<application-code>-ios-mobile/`, `apps/sdkwork-<application-code>-harmony-mobile/`, or `apps/sdkwork-<application-code>-pad/`.
- Architecture-local directories such as `src/`, `lib/`, `App/`, `entry/`, `packages/`, and `config/` belong inside that selected application root. They do not belong directly under `apps/` and must not be used to mix multiple language/architecture implementations into one ambiguous application root.
- Every independent module that exposes browser UI on a public web origin `MUST` ship both `apps/sdkwork-<application-code>-pc/` and `apps/sdkwork-<application-code>-h5/` as the default Adaptive Web pair. Runtime selection is mobile → H5 (fallback PC), desktop → PC (fallback H5); when neither surface is packaged the public origin uses nginx/`deployments/webserver/` ordinary static serving (`static-fallback`). Authority: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1, `SDKWORK_DEPLOY_SPEC.md` §8 / §8.1, `APP_RUNTIME_TOPOLOGY_SPEC.md` §8.2, `SDKWORK_WEBSERVER_SPEC.md` §11.3.
- Rust route, service, repository, API server, service host, native/Tauri host, worker, gateway, and reusable Rust crates belong in `crates/` for new independent roots.
- Job schedules, queue bindings, batch descriptors, maintenance runbooks, and non-Rust job packages belong in `jobs/`; Rust worker implementations belong in `crates/sdkwork-<domain>-<capability>-worker/`.
- Source-controlled safe runtime/deployment profiles and templates belong in the owning deployable root's `etc/`; config schemas and invariants belong in `specs/`; user-private runtime config remains outside source according to `RUNTIME_DIRECTORY_SPEC.md`.
- Architecture-local `config/` belongs only inside the selected app surface root, such as `apps/sdkwork-<application-code>-pc/config/` or `apps/sdkwork-<application-code>-h5/config/`.
- Architecture-local `packages/` belongs only inside the selected app surface root or the matching common root. It is not a generic project-root directory. Cross-architecture contracts, service ports, runtime, bootstrap, and domain RPC proto packages belong in `apps/sdkwork-<application-code>-common/packages/`. Client-architecture UI and host packages belong in `apps/sdkwork-<application-code>-<client-arch>/packages/`. Repository-root `packages/` is forbidden for application repositories per `SDKWORK_WORKSPACE_SPEC.md`.
- Deployment descriptors, packaging handoff files, and environment topology documentation belong in `deployments/`.
- Thin automation entrypoints belong in `scripts/`; reusable developer/operator tools belong in `tools/`.
- Application/runtime plugin source belongs in `plugins/`; agent plugin workspaces remain under `.sdkwork/plugins/`.

Application UI work must also pass the `UI_ARCHITECTURE_SPEC.md` selection gate before files are created. Each client application root first applies its root architecture standard, then selects the detailed UI package standard for app, console, or admin packages:

| UI architecture | Required standard | Package family |
| --- | --- | --- |
| Cross-architecture shared packages | `APPLICATION_SPEC.md`, `MODULE_SPEC.md` | `apps/sdkwork-<application-code>-common/packages/sdkwork-<capability>` |
| PC browser/desktop app root | `APP_PC_ARCHITECTURE_SPEC.md` | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-*`, `sdkwork-<application-code>-pc-console-*`, `sdkwork-<application-code>-pc-admin-*` |
| App PC React packages | `APP_PC_REACT_UI_SPEC.md` | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-<capability>` |
| PC user console React | `APP_PC_ARCHITECTURE_SPEC.md` and `APP_PC_REACT_UI_SPEC.md` | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-console-<capability>` |
| H5 React application root | `APP_H5_ARCHITECTURE_SPEC.md` and `APP_MOBILE_REACT_UI_SPEC.md`; H5 admin packages also apply `BACKEND_UI_SPEC.md` | `apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-*`, `sdkwork-<application-code>-h5-console-*`, `sdkwork-<application-code>-h5-admin-*` |
| Shared app mobile React packages | `APP_MOBILE_REACT_UI_SPEC.md` | `apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-<capability>` when owned by the application root, or `apps/sdkwork-<domain>-h5/packages/` in a domain repository that publishes reusable H5 modules |
| Flutter mobile app root | `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md` and `APP_FLUTTER_UI_SPEC.md`; Flutter admin packages also apply `BACKEND_UI_SPEC.md` | `apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_*`, `sdkwork_<application_code>_flutter_mobile_console_*`, `sdkwork_<application_code>_flutter_mobile_admin_*` |
| Shared app Flutter packages | `APP_FLUTTER_UI_SPEC.md` | `apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_<capability>` |
| Mini program app root | `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md` and `APP_MINI_PROGRAM_UI_SPEC.md`; mini program admin packages also apply `BACKEND_UI_SPEC.md` | `apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-*`, `sdkwork-<application-code>-mp-console-*`, `sdkwork-<application-code>-mp-admin-*` |
| Shared app mini program packages | `APP_MINI_PROGRAM_UI_SPEC.md` | `apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-<capability>` |
| Android native mobile app root | `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md` and `APP_ANDROID_NATIVE_UI_SPEC.md`; Android admin packages also apply `BACKEND_UI_SPEC.md` | `apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-*`, `sdkwork-<application-code>-android-mobile-console-*`, `sdkwork-<application-code>-android-mobile-admin-*` |
| Shared app Android native packages | `APP_ANDROID_NATIVE_UI_SPEC.md` | `apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-<capability>` |
| iOS native mobile app root | `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md` and `APP_IOS_NATIVE_UI_SPEC.md`; iOS admin packages also apply `BACKEND_UI_SPEC.md` | `apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-*`, `sdkwork-<application-code>-ios-mobile-console-*`, `sdkwork-<application-code>-ios-mobile-admin-*` |
| Shared app iOS native packages | `APP_IOS_NATIVE_UI_SPEC.md` | `apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-<capability>` |
| Harmony native mobile app root | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md` and `APP_HARMONY_NATIVE_UI_SPEC.md`; Harmony admin packages also apply `BACKEND_UI_SPEC.md` | `apps/sdkwork-<application-code>-harmony-mobile/packages/sdkwork-<application-code>-harmony-mobile-*`, `sdkwork-<application-code>-harmony-mobile-console-*`, `sdkwork-<application-code>-harmony-mobile-admin-*` |
| Shared app Harmony native packages | `APP_HARMONY_NATIVE_UI_SPEC.md` | `apps/sdkwork-<application-code>-harmony-mobile/packages/sdkwork-<application-code>-harmony-mobile-<capability>` |
| Pad tablet app root | Per-target standard: iPadOS → `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, Android tablet → `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, HarmonyOS tablet → `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, Flutter tablet → `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md` | `apps/sdkwork-<application-code>-pad/packages/sdkwork-<application-code>-pad-*`, `sdkwork-<application-code>-pad-console-*`, `sdkwork-<application-code>-pad-admin-*` |
| PC internal admin React | `APP_PC_ARCHITECTURE_SPEC.md` and `BACKEND_UI_SPEC.md` | `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-admin-<capability>` |
| Standalone backend/admin React | `BACKEND_UI_SPEC.md` | `apps/sdkwork-backend-react-web/packages/sdkwork-react-backend-<domain>` |

Rules:

- App/user-facing packages consume app-api through app SDKs or approved appbase wrappers.
- `backend-admin` packages consume backend-api through backend SDKs or approved backend wrappers.
- Every package outside an explicit `backend-admin` boundary `MUST` consume SDKWork remote capabilities through generated app SDKs or approved app SDK wrappers. Non-admin packages `MUST NOT` import, export, construct, proxy, or route through backend SDK packages, appbase backend SDK clients, backend wrapper functions, backend generated SDK clients, or backend base URL resolvers.
- Packages without a `console` or `admin` role segment are default app/user packages. `console` packages are user-facing management console modules built on the same app-side architecture and app-api/app SDK boundary. `admin` packages are internal operator modules mapped to `backend-admin` and backend-api/backend SDK boundaries.
- Every SDKWork application root `MUST` have `.sdkwork/README.md`, `.sdkwork/skills/README.md`, and `.sdkwork/plugins/README.md`.
- Independent application repositories under `apps/` that include Rust backend
  services, Tauri hosts, native/Tauri host crates, route crates, repository
  crates, service crates, or worker crates `MUST` declare `sdkwork-appbase` as
  a foundation dependency.
- Those Rust-enabled independent apps `MUST` integrate the relevant appbase Rust crates and generated appbase SDK families, including appbase app SDKs for user-facing app-api capabilities and appbase backend SDKs for `backend-admin` capabilities when those surfaces are used.
- Applications `MUST NOT` copy, fork, or regenerate appbase-owned IAM, session, workspace, bootstrap, tenant, organization, user, verification, or backend management APIs into the application repository. They consume appbase through dependencies and approved composed wrappers.
- UI packages from different architecture families must not import each other's pages, components, routes, host adapters, or runtime globals.
- PC application roots `MUST` follow `APP_PC_ARCHITECTURE_SPEC.md`. Packages without `pc-console` or `pc-admin` are app/user modules by default; `pc-console` modules are user-facing management console modules; `pc-admin` modules are company-internal admin modules.
- H5/Capacitor application roots `MUST` follow `APP_H5_ARCHITECTURE_SPEC.md`. H5 packages use `sdkwork-<application-code>-h5-*`, `sdkwork-<application-code>-h5-console-*`, or `sdkwork-<application-code>-h5-admin-*`, and Capacitor host behavior belongs in `sdkwork-<application-code>-h5-capacitor`.
- Flutter mobile roots `MUST` follow `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`. Flutter mobile packages use lower snake case names such as `sdkwork_<application_code>_flutter_mobile_<capability>`, `sdkwork_<application_code>_flutter_mobile_console_<capability>`, or `sdkwork_<application_code>_flutter_mobile_admin_<capability>`.
- Mini program roots `MUST` follow `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, then `APP_MINI_PROGRAM_UI_SPEC.md` for package-local UI/service/state/route rules. SDKWork packages define source/dependency boundaries through `sdkwork-<application-code>-mp-*`, `sdkwork-<application-code>-mp-console-*`, and `sdkwork-<application-code>-mp-admin-*`; platform `pages` and `subpackages` are runtime projections.
- Native Android mobile roots `MUST` follow `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_ANDROID_NATIVE_UI_SPEC.md` for package-local UI/service/state/route rules. Android packages use `sdkwork-<application-code>-android-mobile-*`, `sdkwork-<application-code>-android-mobile-console-*`, or `sdkwork-<application-code>-android-mobile-admin-*`; Kotlin namespaces must preserve the SDKWork package identity through legal Android identifiers.
- Native iOS mobile roots `MUST` follow `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_IOS_NATIVE_UI_SPEC.md` for package-local UI/service/state/route rules. iOS packages use `sdkwork-<application-code>-ios-mobile-*`, `sdkwork-<application-code>-ios-mobile-console-*`, or `sdkwork-<application-code>-ios-mobile-admin-*`; Swift targets/modules must preserve the SDKWork package identity through legal Swift identifiers.
- Native HarmonyOS mobile roots `MUST` follow `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, then `APP_HARMONY_NATIVE_UI_SPEC.md` for package-local UI/service/state/route rules. Harmony packages use `sdkwork-<application-code>-harmony-mobile-*`, `sdkwork-<application-code>-harmony-mobile-console-*`, or `sdkwork-<application-code>-harmony-mobile-admin-*`; ohpm/ArkTS module identifiers must preserve the SDKWork package identity.
- Pad tablet roots `MUST` use `apps/sdkwork-<application-code>-pad/` as the single tablet application root and `sdkwork-<application-code>-pad-*`, `sdkwork-<application-code>-pad-console-*`, or `sdkwork-<application-code>-pad-admin-*` package naming. A pad root `MUST` target one deliverable per target OS (iPadOS, Android tablet, or HarmonyOS tablet) while keeping the shared tablet surface identity; framework choices mirror the mobile standards (native Swift/Kotlin/ArkTS, Flutter, React Native, uni-app). Pad application kinds/platforms follow the deploy contract vocabulary `PAD_APP`/`PAD` (`sdkwork-deploy-contract`), with the `bundleId` reverse-domain identity required before release.
- `backend-admin` UI must be split by business domain and permission prefix. It must not be placed into one catch-all backend package.
- Shared cross-architecture logic must be extracted into contract, service, i18n, token, or generated SDK packages that have no UI runtime dependency. Those packages belong in `apps/sdkwork-<application-code>-common/packages/` for multi-surface domain repositories.
- Domain repositories that own multiple client surfaces `MUST NOT` create or retain repository-root `packages/common/<domain>/`, `packages/pc-react/<domain>/`, or similar legacy families after migration cutover.

## 1. Architecture Principle

Applications are assembled from stable capability modules.

```text
app shell
  -> route/layout/bootstrap
  -> feature UI package
  -> service/facade package
  -> generated SDK client
  -> appbase IAM runtime and dependency SDKs
  -> app-api/backend-api/open-api/local-api
```

Rules:

- App shells `MUST` stay thin: routing, layout, providers, bootstrap, native host binding, environment selection.
- App shells `MUST` keep top-level application responsibilities in the standard project root directories from `SDKWORK_WORKSPACE_SPEC.md`; they must not hide API contracts, generated SDK workspaces, jobs, config templates, deployment descriptors, or tests under app-local catch-all folders.
- PC app shells `MUST` follow `APP_PC_ARCHITECTURE_SPEC.md` for root layout, `packages/` taxonomy, app/console/admin route ownership, and browser/desktop renderer reuse.
- H5 mobile, Flutter mobile, mini program, native Android, native iOS, and native HarmonyOS app shells `MUST` follow `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` and their root architecture standards for package taxonomy, route identity, host adapters, and renderer/platform packaging boundaries.
- Rust-enabled independent app shells `MUST` compose `sdkwork-appbase` Rust runtime crates and appbase generated SDK clients before application-owned domain modules so login/session/context/bootstrap behavior stays shared.
- App shells `MUST` follow `APP_SDK_INTEGRATION_SPEC.md` when wiring generated SDK clients, dependency SDKs, appbase IAM runtime, open-api credential providers, host adapters, and global token/session state.
- Application shells and modules that own, serve, develop, proxy, or compose `open-api`, `app-api`, `backend-api`, or any SDKWork HTTP `*-api` surface `MUST` follow `WEB_FRAMEWORK_SPEC.md` before route/controller implementation. Rust HTTP runtimes `MUST` integrate `sdkwork-web-framework`; Java/Spring runtimes `MUST` preserve the same typed `WebRequestContext`, interceptor, route metadata, and problem-detail semantics.
- Applications `MUST` compose other applications and reusable capabilities through generated SDK packages, declared `sdkDependencies`, component specs, package root exports, service ports, or approved composed facades.
- Applications `MUST` preserve the composable architecture contract from
  `COMPOSABLE_ARCHITECTURE_SPEC.md`: component layer roles, public exports, ports, runtime
  entrypoints, route ownership, permission inheritance, and native build-tool dependency authority.
- Applications `MUST` preserve the L0-L6 dependency direction from
  `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`: interface adapters call services, services depend on
  domain ports, infrastructure implements ports, and runtime/bootstrap constructs dependencies.
- Applications `MUST NOT` copy another app's private `src` files, generated SDK output, DTO shims, route constants, auth UI, token stores, or appbase-owned API routes.
- Web backend application shells `MUST` compose Rust route crates, Java controllers, authority OpenAPI materialization, and generated SDK families through `API_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, and the SDK standards. They `MUST NOT` let UI packages or service facades depend directly on route crate internals.
- Shared business behavior `MUST` live in reusable packages, not app-local pages.
- UI packages `MUST NOT` build raw HTTP requests or auth headers.
- Services `MUST` receive SDK clients by dependency injection.
- SDK clients may differ by app, package, or environment, but service method shape must stay stable.
- Login, registration, current session, refresh, logout, verification, OAuth, QR auth, password reset, runtime metadata, current-user self-service, and appbase IAM management `MUST` use `sdkwork-appbase` packages and generated appbase SDKs according to `APP_SDK_INTEGRATION_SPEC.md` and `IAM_LOGIN_INTEGRATION_SPEC.md`.
- Reusable module contracts `MUST` follow `MODULE_SPEC.md`.
- Frontend implementation `MUST` follow `FRONTEND_SPEC.md`.
- Runtime config and SDK client construction `MUST` follow `CONFIG_SPEC.md`.

### 1.0 App SDK Composition

Different app architectures share capabilities through SDKs and service ports, not through UI/runtime imports.

| Runtime or architecture | Generated SDK family | IAM/session dependency |
| --- | --- | --- |
| PC React app | TypeScript app SDKs and appbase PC wrappers | appbase IAM runtime and one global TokenManager |
| Mobile React app | TypeScript app SDKs and mobile host adapters | appbase IAM runtime or approved mobile IAM adapter with one global TokenManager |
| Flutter app | Dart/Flutter app SDKs and platform adapters | generated Dart/Flutter appbase SDK or approved appbase Flutter wrapper |
| Mini program app | TypeScript app SDKs adapted for mini program runtime and mini program host adapters | appbase mini program wrapper or approved appbase IAM runtime adapter with one global TokenManager equivalent |
| Android native app | Kotlin/Java app SDKs and Android host adapters | generated Kotlin/Java appbase SDK or approved appbase Android wrapper with one global token-manager equivalent |
| iOS native app | Swift app SDKs and iOS host adapters | generated Swift appbase SDK or approved appbase iOS wrapper with one global token-manager equivalent |
| Harmony native app | ArkTS/TypeScript app SDKs adapted for Harmony runtime and HarmonyOS host adapters | appbase Harmony wrapper or approved appbase ArkTS adapter with one global token-manager equivalent |
| Desktop/Tauri renderer | TypeScript app SDKs injected by renderer bootstrap | appbase IAM runtime; native storage only through host adapters |
| Rust backend/runtime | Rust SDKs, route crates, service traits | appbase Rust context/auth/bootstrap crates and generated appbase SDKs when calling appbase APIs |
| Backend/admin React | TypeScript backend SDKs for `backend-admin` | appbase backend SDK for IAM administration, no app login session creation |

Rules:

- Architecture-specific UI packages `MUST` use the generated SDK language that matches the architecture.
- A React package `MUST NOT` import Flutter, Android, iOS, or Harmony SDK/UI implementations; Flutter packages `MUST NOT` import TypeScript React wrappers; native Android/iOS/Harmony packages `MUST NOT` import another client architecture's UI/runtime wrappers.
- Rust services `MUST NOT` embed frontend SDK wrappers. Rust code that calls HTTP APIs directly uses Rust SDKs or approved Rust service clients.
- App-api SDK clients and explicit `backend-admin` backend-api SDK clients `MUST` share the authenticated TokenManager created by the application runtime. Protected open-api SDK clients use their declared open-api credential provider (`api-key`, `oauth`, or `open-api-flexible`).
- Independent `apps/` repositories with Rust, Tauri, native runtime, or
  backend capability `MUST` declare `sdkwork-appbase` before publishing
  application-owned SDK families.

### 1.1 Web Backend API Composition

Web backend development uses a three-layer API model:

```text
Rust route crate or Java controller module
  -> aggregated API authority OpenAPI
  -> generated SDK family
  -> service facade and UI/backend-admin integration
```

Rust route crate examples:

```text
sdkwork-routes-merchandise-app-api
sdkwork-routes-cart-app-api
sdkwork-routes-order-backend-api
```

Aggregated authority and SDK examples:

```text
sdkwork-routes-merchandise-app-api
sdkwork-routes-cart-app-api
sdkwork-routes-order-app-api
  -> sdkwork-shop-app-api
  -> sdkwork-shop-app-sdk
```

Rules:

- Rust route crates that define SDKWork HTTP routes `MUST` follow `API_SPEC.md` and be named `sdkwork-routes-<capability>-open-api`, `sdkwork-routes-<capability>-app-api`, or `sdkwork-routes-<capability>-backend-api`.
- Every application repository or module that develops any SDKWork HTTP `*-api` surface `MUST` integrate the framework architecture from `WEB_FRAMEWORK_SPEC.md`; application-local route/controller frameworks are not allowed to replace it.
- Web backend implementation layers, including controller/router, handler, service/use-case, repository, provider adapter, request context, and route materialization boundaries, `MUST` follow `WEB_BACKEND_SPEC.md`.
- Every API operation exposed by an application module `MUST` consume or project `WebRequestContext`: route manifests declare `requestContext: WebRequestContext` and `apiSurface`, materialized OpenAPI declares `x-sdkwork-request-context: WebRequestContext` and `x-sdkwork-api-surface`, and handlers/controllers consume the typed context before service code.
- Route crates own route/path configuration for one capability and one API surface. They do not own SDK package names, generated SDK output, frontend service ports, or final OpenAPI authority names.
- The application or backend shell owns route aggregation. It combines same-surface, same-owner route manifests into the project/domain authority such as `sdkwork-shop-app-api` or `sdkwork-shop-backend-api`.
- Applications consume generated application-owned SDK families such as `sdkwork-shop-app-sdk` and `sdkwork-shop-backend-sdk`. UI and service modules `MUST NOT` import route crates or build requests from route constants.
- App-api is for application development and user-facing app clients through app SDKs. Backend-api is for `backend-admin` and operator clients through backend SDKs. Open-api is for external/public integration through open-api/domain SDKs.
- Route aggregation `MUST` subtract dependency-owned routes before SDK generation. Appbase, Drive, provider, and other dependency-owned routes remain dependency SDKs or approved composed wrappers.
- Route crate capability names should be small business units such as merchandise, cart, order, payment, catalog, shipment, wallet, tenant, report, or audit. Aggregated authorities use the broader project/domain such as commerce.

## 2. Module Taxonomy

| Layer | Responsibility | Example |
| --- | --- | --- |
| `foundation` | Shell, client navigation, command palette, search, workspace primitives | `sdkwork-shell-pc-react`, `sdkwork-workspace-pc-react` |
| `host` | Tauri/browser/mobile/native host boundaries | `sdkwork-host-tauri-pc-react` |
| `iam` | Tenant, organization, user, auth, permissions, security settings | `sdkwork-iam-core-pc-react` |
| `system` | Settings, notifications, docs, dashboard, support | `sdkwork-settings-pc-react` |
| `communication` | IM, contacts, channels, social, notifications | `sdkwork-im-pc-react` |
| `intelligence` | AI models, agents, prompts, tools, workflows | `sdkwork-agent-pc-react` |
| `drive` | Drive spaces, nodes, upload/download, file picker, storage-backed resource selection | `sdkwork-drive-pc-react` |
| `content` | Documents, assets, media publishing, editor workflows built on Drive-backed files | `sdkwork-content-pc-react` |
| `commerce` | Billing, wallet, payment, subscription, entitlement | `sdkwork-billing-pc-react` |
| `device` | Install, distribution, device bridge, local runtime | `sdkwork-device-pc-react` |
| `ecosystem` | Plugin, marketplace, app store | `sdkwork-plugin-pc-react` |

Rules:

- API and database domain names `MUST` use canonical domain names such as `iam`, not vague names such as `identity`.
- Canonical domain ownership and naming `MUST` follow `DOMAIN_SPEC.md`.
- Existing package grouping names may remain during migration, but new standard contracts must use canonical domains.
- Each package `MUST` have one clear capability and one public root export.
- Cross-package imports `MUST` use package root exports, not package-internal `src` paths.
- Shared modules `SHOULD` be framework-specific only where UI/runtime requires it; pure contracts should be framework-neutral when practical.

## 3. Package Shape

Recommended frontend package structure:

```text
packages/<architecture>/<domain>/<package>/
  package.json
  README.md
  src/
    index.ts
    services/
    types/
    components/
    pages/
    hooks/
  tests/
```

Rules:

- `src/index.ts` `MUST` be the public API.
- Business services `SHOULD` be in `src/services`.
- DTOs should come from generated SDKs or shared contract packages, not local copies.
- Package README `MUST` document capability, dependencies, integration inputs, and verification command.
- Host/native code `MUST` stay in host packages or native subdirectories.

## 4. Composition Inputs

Reusable modules `MUST` accept explicit inputs.

```ts
export type AppModuleRuntimeTarget =
  | "browser"
  | "desktop"
  | "tablet-ipados"
  | "tablet-android"
  | "capacitor-ios"
  | "capacitor-android"
  | "flutter-ios"
  | "flutter-android"
  | "android-native"
  | "ios-native"
  | "harmony-native"
  | "mini-program"
  | "server"
  | "container"
  | "test-runner";

export interface AppModuleRuntime<TAppClient, TBackendClient> {
  appClient: TAppClient;
  backendClient?: TBackendClient;
  environment: "development" | "test" | "staging" | "demo" | "production";
  deploymentProfile: "standalone" | "cloud";
  runtimeTarget?: AppModuleRuntimeTarget;
}
```

Rules:

- No shared module may hard-code a cloud base URL, loopback port, tenant ID,
  token, or generated SDK package.
- `AppModuleRuntimeTarget` `MUST` stay aligned with the
  `SdkworkRuntimeTarget` vocabulary in `CONFIG_SPEC.md`; shared modules may
  branch only on capability-relevant runtime differences.
- Environment differences belong in bootstrap/config.
- Runtime inputs `SHOULD` be serializable where they cross host/native boundaries.
- Feature flags `SHOULD` be capability-scoped.

## 5. Frontend Boundaries

| Boundary | Allowed | Forbidden |
| --- | --- | --- |
| UI | render, form state, accessibility, local view state | direct SDK transport, token parsing |
| Service | SDK calls, validation mapping, cache invalidation, orchestration | raw HTTP, hidden global client |
| SDK | typed API transport | application UI decisions |
| Host | native filesystem/process/window/device access | business authorization |

Rules:

- UI modules may call services, not raw SDK clients, when reusable business behavior exists.
- Services may expose domain-friendly methods but should preserve generated SDK semantics.
- Host adapters must not become business service layers.

## 6. Acceptance Checklist

- [ ] Module has one domain and one capability.
- [ ] Application root has `.sdkwork/skills/` and `.sdkwork/plugins/` according to `SDKWORK_WORKSPACE_SPEC.md`.
- [ ] Independent application root uses the standard project root directory dictionary from `SDKWORK_WORKSPACE_SPEC.md`; new templates contain the full dictionary with tracked placeholders, and narrow roots document intentionally omitted inactive directories.
- [ ] `apps/README.md` indexes every direct child application root, states primary app surface placement, and follows `DOCUMENTATION_SPEC.md` section 3.3.
- [ ] API contracts live in `apis/` when authored by the application, and generated SDK family workspaces live in `sdks/`.
- [ ] Architecture-local `config/` and `packages/` appear only inside the selected app surface root, or at repository root only when the repository root itself is that app surface root.
- [ ] Job schedules, queue bindings, and runbooks live in `jobs/`; Rust worker implementations live in `crates/sdkwork-<domain>-<capability>-worker/`.
- [ ] Domain name is registered or accepted by `DOMAIN_SPEC.md`.
- [ ] Public exports are stable and documented.
- [ ] Reusable module contract follows `MODULE_SPEC.md`.
- [ ] Application L0-L6 layering follows `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md` and is verified with `check-application-layering.mjs` when API/service/repository/frontend/runtime boundaries are touched.
- [ ] The correct architecture-specific UI standard is selected when the module has UI.
- [ ] UI-service-SDK layering is respected.
- [ ] SDK clients are injected at initialization.
- [ ] Runtime config and SDK construction follow `CONFIG_SPEC.md`.
- [ ] No raw HTTP or manual auth headers in business UI modules.
- [ ] Standalone/cloud differences and runtime-target differences are isolated in bootstrap.
- [ ] Tests cover service contract and module integration.
