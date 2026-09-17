# Component Specs Standard

- Version: 1.1
- Scope: local `specs/` directories for apps, reusable packages, language modules, SDK families, services, host adapters, and componentized integration units under `apps/`
- Related: `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `COMPOSABLE_ARCHITECTURE_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `AGENTS_SPEC.md`, `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, `MODULE_SPEC.md`, `APPLICATION_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `WEB_BACKEND_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, `BACKEND_UI_SPEC.md`, `SDK_SPEC.md`, `CONFIG_SPEC.md`, `DOCUMENTATION_SPEC.md`, `TEST_SPEC.md`, `GOVERNANCE_SPEC.md`

This standard defines the local specification boundary for every authored SDKWork module. Global standards live in `sdkwork-specs/*_SPEC.md`; each module owns an independent local spec system under `<module-root>/specs/` that makes the module discoverable, maintainable, and safe to integrate without reading its internals first.

Repository roots and application roots also carry the checked-in `.sdkwork/` workspace required by `SDKWORK_WORKSPACE_SPEC.md`. Component roots do not need their own `.sdkwork/` unless the component root is also a git repository root or an independently built/distributed application root.

## 1. Authority Chain

Rules:

- Global `sdkwork-specs/*_SPEC.md` files are the platform source of truth.
- Repository/application root `specs/` may hold cross-module machine contracts such as `topology.spec.json`; they do not replace global standards.
- Module-local `specs/` may narrow, document, or add module-specific constraints for the owning module only.
- Module-local specs must not contradict global specs.
- If a module needs an exception, record it according to `GOVERNANCE_SPEC.md`.
- Generated language outputs should not each maintain independent standards; the SDK family root owns the module spec unless a generated output becomes a hand-maintained composed package.
- Module-local specs may reference repository/application `.sdkwork/skills` or `.sdkwork/plugins` for workflows, but they must not redefine those workspace rules.
- Module-local `AGENTS.md`, when present, must follow `AGENTS_SPEC.md` and use relative paths to global `sdkwork-specs`.

## 2. Required Local Directory

Every authored module `MUST` contain:

```text
<component-root>/
  specs/
    component.spec.json
    README.md                 # optional human index; recommended
```

Rules:

- `component.spec.json` is the machine-readable contract used by validators and `MUST` exist.
- `README.md` is the optional human index for the module spec system. It `MUST NOT` duplicate global spec bodies or replace `component.spec.json`.
- Local extension files such as `FRONTEND_SPEC.md`, `RUST_SPEC.md`, `DART_SPEC.md`, `I18N_SPEC.md`, or `RELEASE_SPEC.md` may be added only when the module has extra rules beyond global specs.
- Do not copy global `sdkwork-specs/*_SPEC.md` files into module folders.

## 3. Component Manifest

`component.spec.json` `MUST` use:

```json
{
  "schemaVersion": 1,
  "kind": "sdkwork.component.spec",
  "component": {
    "name": "@sdkwork/example",
    "displayName": "SDKWork Example",
    "version": "0.1.0",
    "type": "react-package",
    "root": "sdkwork-iam/apps/sdkwork-iam-pc/packages/example",
    "domain": "iam",
    "capability": "auth",
    "surface": "app",
    "languages": ["typescript"],
    "generated": false,
    "manifests": ["package.json"]
  },
  "canonicalSpecs": [
    {
      "file": "MODULE_SPEC.md",
      "path": "../../../../specs/MODULE_SPEC.md",
      "purpose": "Reusable package contract and dependency direction."
    }
  ],
  "contracts": {
    "layerRole": "frontend-feature",
    "publicExports": ["."],
    "providedPorts": [{ "name": "exampleServices", "export": "." }],
    "requiredPorts": [{ "name": "appSdk", "export": ".", "provider": "@sdkwork/example-app-sdk" }],
    "runtimeEntrypoints": ["package.json#scripts.typecheck"],
    "routeManifest": null,
    "sdkClients": [],
    "sdkDependencies": [],
    "permissionComposition": {},
    "dependencyApiExports": [],
    "dependencyApiSurfaces": [],
    "events": [],
    "configKeys": ["package.json#sdkwork"]
  },
  "verification": {
    "commands": ["pnpm --filter @sdkwork/example typecheck"]
  }
}
```

Rules:

- `component.name`, `component.type`, `component.root`, `component.domain`, `component.capability`, and `component.languages` are required.
- `component.domain` uses canonical root domain names such as `iam`, not legacy group aliases such as `identity`.
- `component.surface` is required when SDK surface access, route exposure, or package visibility
  depends on whether the component is app-side, console-side, backend-admin, public/open-api,
  backend service, host/native, or generated SDK infrastructure.
- `component.surface: "backend-admin"` is the machine-readable backend/admin UI boundary. PC React
  internal admin packages named with the `pc-admin` segment, such as
  `sdkwork-<application-code>-pc-admin-<capability>`, `MUST` declare this surface before importing product
  backend SDKs or appbase backend SDKs.
- Route paths, menu groups, page titles, and navigation labels are not component surfaces. A route
  under `/admin` is still non-admin unless its owning package/component declares the backend-admin
  surface and follows the backend UI package rules.
- `canonicalSpecs` must link to actual root spec files.
- `canonicalSpecs` must include `CODE_STYLE_SPEC.md` and `NAMING_SPEC.md` when the component owns authored source code.
- `canonicalSpecs` must include language-specific specs only for languages declared in `component.languages`.
- `contracts.publicExports` lists supported integration entrypoints owned and actually exported by
  the current component, not internal source paths or dependency-owned entrypoints. A Rust
  component `MUST NOT` list `other_crate::symbol` as its own public export; dependency assembly,
  SDK, service, and host exports belong in `requiredPorts`.
- `contracts.layerRole` classifies the component in the L0-L6 application layering profile from
  `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md` and the composable architecture profile from
  `COMPOSABLE_ARCHITECTURE_SPEC.md`: for example `frontend-core`, `frontend-feature`,
  `backend-route`, `backend-service`, `backend-domain`, `backend-repository`, `runtime-composition`,
  `runtime-gateway`, `runtime-service-host`, `sdk-facade`, or `tooling`. New composable modules `MUST` declare it;
  legacy manifests should add it during the next module touch.
- `contracts.providedPorts` lists named public integration ports offered by the component. Each
  object `MUST` include `name` and `export`, and `export` must reference `contracts.publicExports`.
- `contracts.requiredPorts` lists named SDK, service, host, runtime, or provider ports the component
  needs from its composition root or dependency modules. Each object `MUST` include `name` and
  `export`; it should include `provider` when the provider cannot be inferred from the qualified
  export or a matching `dependencyApiSurfaces[].cargoDependency`. A provider-qualified export
  `MUST` resolve to the provider component's `publicExports` or `providedPorts` contract. Legacy
  binding-form aliases such as `crate-root`, `binary`, or a component path are not provider export
  identities and remain compatibility inputs until their component contracts are normalized. A
  required port does not become a public export of the consuming component unless that component
  implements and exports its own adapter under its own entrypoint.
- `contracts.runtimeEntrypoints` lists executable integration entrypoints, service builders, router
  builders, scripts, or host adapters that a consumer can actually run or mount. Route metadata,
  OpenAPI files, and README examples are not executable runtime entrypoints.
- `contracts.routeManifest` is used only by Rust HTTP route crate components. It points to the
  route crate manifest entrypoint or normalized `sdks/_route-manifests/<surface>/<packageName>.route-manifest.json`
  artifact, and it is not an SDK client list. Route manifest paths participate in route registry
  collision validation.
- `contracts.sdkClients` lists generated SDK client classes or public SDK client exports only when the component owns a generated SDK family. It is not a runtime credential-injection list and `MUST NOT` be used as an IAM token-manager list, app/backend SDK injection list, or open-api credential provider list.
- `contracts.sdkDependencies` lists dependency SDK families consumed by this component, SDK family,
  or composed facade. It `MUST` be an explicit array for every authored SDK family, composed facade,
  application core package, or runtime component that consumes dependency SDKs; use `[]` when there
  are no dependency SDKs.
- `contracts.permissionComposition` defines permission inheritance and explicit override policy for
  the owning app surface or core package. It is required whenever HTTP `contracts.sdkDependencies`
  include protected app-api, backend-api, or SDKWork-owned open-api dependencies. Core packages
  `SHOULD` point to the app-root manifest with a relative path when the app surface owns the
  permission composition object.
- `contracts.dependencyApiExports` lists dependency-owned API capabilities intentionally exposed by
  this component's public exports, composed wrappers, service ports, or application core surface.
  It `MUST` be explicit for authored SDK families and composed facades. The default is `[]`, which
  means dependency APIs are not re-exported by this component.
- `contracts.dependencyApiSurfaces` lists dependency-owned HTTP API surfaces that this runtime
  component serves, proxies, or requires as an external service. It is required for app shells,
  web-backend services, and Rust/native runtimes that declare HTTP `sdkDependencies`.
- `dependencyApiSurfaces[].sameOriginAllowed` declares capability only. It does not select an
  embedded runtime. Only a normalized same-origin/embedded `runtimeMode` (or its governed legacy
  alias during migration) activates executable `requiredPorts`, standalone profile coverage, and
  no-external-base-URL validation.
- Runtime gateway components may add native integration evidence to each dependency surface, such as
  `cargoFeature`, `cargoDependency`, and `embeddedExecutableExport`, when a Rust Cargo workspace
  owns the executable mount. These fields supplement native build-tool metadata; they must not
  duplicate into a standalone gateway catalog.
- Runtime SDK injection and credential wiring `MUST` follow `CONFIG_SPEC.md`, `SDK_SPEC.md`, and `IAM_LOGIN_INTEGRATION_SPEC.md`: app-api/backend-api SDKs receive the global token manager, while protected open-api SDKs receive credentials through a separate open-api credential provider matching their declared auth mode.
- `verification.commands` must include at least one command that validates the component or the component specs inventory.

## 4. Component Types

| Type | Description | Required root specs |
| --- | --- | --- |
| `react-app`, `react-tauri-app`, `pc-app`, `h5-app`, `flutter-app`, `mini-program-app`, `android-native-app`, `ios-native-app`, `harmony-native-app`, `app` | Application shell or client app root | `APPLICATION_SPEC.md`, `APP_MANIFEST_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` for client roots, matching root architecture spec, architecture UI spec when applicable, `CONFIG_SPEC.md`, `DEPLOYMENT_SPEC.md` |
| `react-package`, `react-tauri-package`, `flutter-package`, `dart-package`, `android-native-package`, `ios-native-package`, `harmony-native-package`, `node-package` | Frontend or reusable UI/service package | `MODULE_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, architecture UI spec when UI is present, `SDK_SPEC.md`, `I18N_SPEC.md` when user-facing |
| `rust-route-crate` | Rust HTTP route/path source package named `sdkwork-routes-<capability>-<surface>` | `API_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `SDK_SPEC.md`, `DOMAIN_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md` |
| `rust-api-assembly` | Host-neutral application API assembly named `sdkwork-api-<application-code>-assembly` | `API_ASSEMBLY_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `RUST_CODE_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `TEST_SPEC.md` |
| `rust-api-standalone-gateway` | Rust standalone application ingress crate named `sdkwork-api-<application-code>-standalone-gateway` | `API_ASSEMBLY_SPEC.md`, `APPLICATION_GATEWAY_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `RUST_CODE_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `TEST_SPEC.md` |
| `rust-platform-cloud-gateway` | Rust platform cloud ingress crate named `sdkwork-api-cloud-gateway` | `APPLICATION_GATEWAY_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `RUST_CODE_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `TEST_SPEC.md` |
| `web-backend-service` | Java/Rust HTTP backend service, controller module, handler/service/repository package, or runtime API composition unit | `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `API_SPEC.md`, `DOMAIN_SPEC.md`, `SECURITY_SPEC.md`, `DATABASE_SPEC.md` when persistent, `SDK_SPEC.md`, `TEST_SPEC.md` |
| `rust-crate`, `tauri-host`, `go-module`, `java-module`, `python-package`, `csharp-project`, `swift-package` | Language-native runtime, service, SDK, or host unit | `MODULE_SPEC.md`, `CONFIG_SPEC.md`, `DEPLOYMENT_SPEC.md`, `TEST_SPEC.md` |
| `sdk-family` | Multi-language generated SDK family rooted by `sdk-manifest.json` | `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `API_SPEC.md`, `TEST_SPEC.md`, `DOCUMENTATION_SPEC.md` |

Language-specific root specs are on-demand:

| `component.languages` value | Required language spec when authored source exists |
| --- | --- |
| `rust` | `RUST_CODE_SPEC.md` |
| `java` | `JAVA_CODE_SPEC.md` |
| `typescript`, `javascript`, `node` | `TYPESCRIPT_CODE_SPEC.md` |
| `react`, `tsx`, `flutter`, `dart`, `arkts`, `android-ui`, `ios-ui`, `harmony-ui`, `ui` | `FRONTEND_CODE_SPEC.md` plus the matching UI architecture spec |

Rules:

- Components must not list unrelated language specs in `canonicalSpecs` just because the repository is polyglot.
- Generated language outputs inherit the SDK family root spec unless they contain an authored composed facade.
- Authored composed facades must declare their language and code style specs in the SDK family or facade component spec.

Architecture UI spec selection:

| Component root pattern | Required architecture spec |
| --- | --- |
| `apps/sdkwork-<application-code>-common/**` | `APPLICATION_SPEC.md`, `MODULE_SPEC.md` |
| `apps/sdkwork-<application-code>-common/packages/sdkwork-<capability>` | `APPLICATION_SPEC.md`, `MODULE_SPEC.md` |
| `apps/sdkwork-<application-code>-pc/**` | `APP_PC_ARCHITECTURE_SPEC.md` |
| `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-<capability>` without `pc-console` or `pc-admin` | `APP_PC_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md` |
| `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-console-*` | `APP_PC_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md` |
| `apps/sdkwork-<application-code>-pc/packages/sdkwork-<application-code>-pc-admin-*` | `APP_PC_ARCHITECTURE_SPEC.md`, `BACKEND_UI_SPEC.md` |
| `packages/pc-react/**` | `APP_PC_REACT_UI_SPEC.md` (legacy migration-only; do not add new components) |
| `apps/sdkwork-<application-code>-h5/**` | `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md` |
| `apps/sdkwork-<application-code>-h5/packages/sdkwork-<application-code>-h5-*` | `APP_H5_ARCHITECTURE_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md` |
| `apps/sdkwork-<application-code>-flutter-mobile/**` | `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md` |
| `apps/sdkwork-<application-code>-flutter-mobile/packages/sdkwork_<application_code>_flutter_mobile_*` | `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_FLUTTER_UI_SPEC.md` |
| `apps/sdkwork-<application-code>-mini-program/**` | `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md` |
| `apps/sdkwork-<application-code>-mini-program/packages/sdkwork-<application-code>-mp-*` | `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md` |
| `apps/sdkwork-<application-code>-android-mobile/**` | `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md` |
| `apps/sdkwork-<application-code>-android-mobile/packages/sdkwork-<application-code>-android-mobile-*` | `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md` |
| `apps/sdkwork-<application-code>-ios-mobile/**` | `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md` |
| `apps/sdkwork-<application-code>-ios-mobile/packages/sdkwork-<application-code>-ios-mobile-*` | `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md` |
| `apps/sdkwork-<application-code>-harmony-mobile/**` | `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md` |
| `apps/sdkwork-<application-code>-harmony-mobile/packages/sdkwork-<application-code>-harmony-mobile-*` | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md` |
| `packages/mobile-react/**` | `APP_MOBILE_REACT_UI_SPEC.md` (legacy migration-only; do not add new components) |
| `packages/mobile-flutter/**` | `APP_FLUTTER_UI_SPEC.md` (legacy migration-only; do not add new components) |
| `packages/mini-program/**` | `APP_MINI_PROGRAM_UI_SPEC.md` (legacy migration-only; do not add new components) |
| `packages/android-native/**` | `APP_ANDROID_NATIVE_UI_SPEC.md` (legacy migration-only; do not add new components) |
| `packages/ios-native/**` | `APP_IOS_NATIVE_UI_SPEC.md` (legacy migration-only; do not add new components) |
| `packages/harmony-native/**` | `APP_HARMONY_NATIVE_UI_SPEC.md` (legacy migration-only; do not add new components) |
| `packages/common/**` | `APPLICATION_SPEC.md`, `MODULE_SPEC.md` (legacy migration-only; canonical target is `apps/sdkwork-<application-code>-common/packages/`) |
| `apps/sdkwork-backend-react-web/**` or `packages/sdkwork-react-backend-*` | `BACKEND_UI_SPEC.md` |

Rules:

- A UI component manifest `MUST` include `UI_ARCHITECTURE_SPEC.md` and the matching architecture UI spec in `canonicalSpecs`.
- PC user console component manifests `MUST` use `sdkwork-<application-code>-pc-console-<capability>` and must not declare internal admin ownership.
- PC internal admin component manifests `MUST` use `sdkwork-<application-code>-pc-admin-<capability>` and must include `BACKEND_UI_SPEC.md`.
- H5 component manifests under app roots `MUST` use `sdkwork-<application-code>-h5-<capability>` or the reserved H5 mobile package roles from `APP_H5_ARCHITECTURE_SPEC.md`.
- Flutter mobile component manifests under app roots `MUST` use lower snake case Dart package names such as `sdkwork_<application_code>_flutter_mobile_<capability>`.
- Mini program component manifests under app roots `MUST` use SDKWork source packages such as `sdkwork-<application-code>-mp-<capability>` and include `APP_MINI_PROGRAM_UI_SPEC.md` when they own pages, components, services, state, or route projection inputs. They must not treat platform `pages` or `subpackages` as the source component boundary.
- Android native component manifests under app roots `MUST` use SDKWork source packages such as `sdkwork-<application-code>-android-mobile-<capability>` and include `APP_ANDROID_NATIVE_UI_SPEC.md` when they own screens, components, view models/controllers, services, state, or route inputs.
- iOS native component manifests under app roots `MUST` use SDKWork source packages such as `sdkwork-<application-code>-ios-mobile-<capability>` and include `APP_IOS_NATIVE_UI_SPEC.md` when they own screens, views, view models/controllers, services, state, or route inputs.
- Harmony native component manifests under app roots `MUST` use SDKWork source packages such as `sdkwork-<application-code>-harmony-mobile-<capability>` and include `APP_HARMONY_NATIVE_UI_SPEC.md` when they own pages, components, view models/controllers, services, state, or route inputs.
- Standalone backend/admin UI component manifests `MUST` use a backend domain package root, not a generic all-in-one backend package root.
- App UI component manifests `MUST` reference app-side package roots and must not declare backend SDK clients for user-facing workflows.
- A UI component manifest `MUST NOT` list more than one architecture-specific UI spec unless it is an explicit multi-package SDK family root with no UI implementation.
- A `rust-route-crate` component `MUST` use a component name and Cargo package name that follow
  `sdkwork-routes-<capability>-open-api`, `sdkwork-routes-<capability>-app-api`, or
  `sdkwork-routes-<capability>-backend-api`.
- A `rust-route-crate` component root `MUST` follow
  `crates/sdkwork-routes-<capability>-<surface>/`.
- A `rust-route-crate` component `MUST` declare `contracts.routeManifest` and must not declare
  generated SDK clients in `contracts.sdkClients`.
- A `rust-route-crate` component manifest `MUST` include `API_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`,
  `SDK_WORKSPACE_GENERATION_SPEC.md`, and `TEST_SPEC.md` in `canonicalSpecs`.
- A `rust-api-assembly` component `MUST` use component and Cargo package name
  `sdkwork-api-<application-code>-assembly`, live under
  `crates/sdkwork-api-<application-code>-assembly/`, declare
  `component.surface: "api-assembly"`, declare
  `contracts.layerRole: "runtime-composition"`, and own
  `assembly-manifest.json`. `api-assembly` is the component type, capability,
  and surface vocabulary; it is not a composable layer role.
- A `rust-api-standalone-gateway` component `MUST` use component and Cargo package name
  `sdkwork-api-<application-code>-standalone-gateway`, live under
  `crates/sdkwork-api-<application-code>-standalone-gateway/`, and declare
  `component.surface: "gateway-api"`.
- A `rust-api-assembly` or `rust-api-standalone-gateway` component manifest `MUST` include
  `API_ASSEMBLY_SPEC.md`, `APPLICATION_GATEWAY_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`,
  `RUST_CODE_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, and `TEST_SPEC.md` in `canonicalSpecs`.
- A `rust-api-assembly` component declares its complete route inventory. A
  `rust-api-standalone-gateway` declares every API assembly it hosts and must
  not duplicate their route/service/repository dependencies.
- A `rust-api-assembly` owns the complete runtime building block behind one public bootstrap:
  database lifecycle, service/repository/provider construction, complete API contribution,
  readiness, and owner-retained handles. Its standalone and cloud consumers use the same export.
- A `rust-platform-cloud-gateway` component `MUST` use component and Cargo package name
  `sdkwork-api-cloud-gateway`, live under `crates/sdkwork-api-cloud-gateway/`, and declare
  `component.domain: "platform"`.
- A `rust-platform-cloud-gateway` component manifest `MUST` include the same gateway canonical
  specs as application gateway components.
- A `rust-platform-cloud-gateway` component `MUST` declare
  `gatewayIntegration.assemblyIntegrationPoint`. Its `databaseLifecycleOwner` is
  `sdkwork-api-<application-code>-assembly`; every selected dependency surface aligns one Cargo
  feature, one owner assembly dependency, and one executable export. Direct dependency-owned
  route, service, service-host, repository, provider implementation, or database-host entries are
  forbidden.
- A `web-backend-service` component `MUST` include `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `API_SPEC.md`, and
  `TEST_SPEC.md` in `canonicalSpecs`.
- A `web-backend-service` component that owns persistence `MUST` also include
  `DATABASE_SPEC.md`; one that publishes events `MUST` include `EVENT_SPEC.md`; one that uses cache
  `MUST` include `CACHE_SPEC.md`.
- A `web-backend-service` component `MUST` document its API authority, owned surface, and generated
  SDK family or explicitly state that it is an implementation-only module with no HTTP authority.
- A `web-backend-service`, `rust-crate`, `tauri-host`, `electron-host`, `capacitor-host`, `h5-capacitor-host`, or app shell that mounts dependency APIs
  `MUST` declare `contracts.dependencyApiSurfaces` with dependency workspace, SDK family, API
  authority, surface, `apiPrefix`, runtime mode, executable public export, and coverage evidence.
  A dependency route manifest alone does not satisfy this runtime contract.
- A shared API gateway component that integrates foundation APIs for multiple applications `MUST`
  make its executable integration discoverable from the native build-tool manifest, such as Cargo
  workspace dependencies and Cargo features, and align that evidence with `component.spec.json`.
  It `MUST NOT` maintain a separate gateway catalog file when native build metadata and existing
  SDKWork specs already carry the dependency facts.
- A shared API gateway component with overlapping dependency API prefixes `MUST` document route
  precedence in `component.spec.json`, either on the affected `apiSurfaces` entries or in a
  `routeRegistry.rules` section. Fixed routes and more specific dependency prefixes must be listed
  before broad fallback prefixes, including appbase IAM, Drive, Notary, RTC, Agent/Kernel, AIoT,
  Memory, Knowledgebase, News, Notes, Music, Generations, Community, Search, Voice, Image, Comments,
  Course, and Messaging ahead of broad app/backend fallback surfaces. Split-only upstream surfaces
  must not declare `cargoFeature`,
  `cargoDependency`, or `embeddedExecutableExport` until a compatible executable integration exists.
- A platform cloud gateway component `MUST` add a split-only dependency surface only from existing
  SDKWork semantic evidence: SDK family or component/runtime manifest metadata plus materialized
  OpenAPI paths, derived SDK generation inputs, or normalized route manifests that prove a stable
  route prefix. Empty SDK manifests and generic-only API roots are inventory candidates and must
  not become required gateway startup upstreams.
- If one dependency SDK family owns multiple stable route prefixes, the platform cloud gateway component `MUST`
  list each prefix under `apiSurfaces` while keeping the same dependency service id and upstream
  base URL key. Component specs may summarize those prefixes on the service dependency entry with
  an `apiPrefixes` array, but must not invent prefix-specific service ids that do not correspond to
  a real upstream service boundary.
- When a dependency entry declares `apiPrefixes`, that array and all
  `apiSurfaces[].prefix` values with the matching `dependencyServiceId` `MUST`
  be equal as sets. Missing, additional, duplicate, synthetic, or rewritten
  prefixes are invalid. Verification uses
  `tools/check-component-api-surface-prefixes.mjs`; successful router assembly
  does not waive this machine-contract check.
- Application component specs that consume platform foundation APIs `MUST`
  declare those SDKs through `contracts.sdkDependencies` and their runtime
  availability through `dependencyApiSurfaces`. The application topology owns
  `platform.api-gateway` URL/env provenance; component specs do not identify a
  platform gateway process, repository, bind key, or autostart behavior.
- `integration.foundationApiGateway` is a retired parallel contract. New or
  aligned component specs `MUST NOT` declare it. Existing values must be
  decomposed into topology surface provenance, `sdkDependencies`,
  `dependencyApiSurfaces`, and explicit per-SDK overrides before the legacy
  field is removed; no replacement gateway-identity field is introduced.
- Existing governed application-local foundation adapters in component specs
  `MUST` be marked as removal-bound exceptions and must not be declared as
  default same-origin dependency surface coverage when the platform API
  surface is the target runtime.

## 5. Discovery Rules

Authored component roots are discovered from standard language manifests:

- JavaScript/TypeScript: `package.json`
- Flutter/Dart: `pubspec.yaml`
- Android/Gradle: `build.gradle.kts`, `build.gradle`, or `settings.gradle.kts`
- Rust: `Cargo.toml`
- Go: `go.mod`
- Java: `pom.xml`
- C#: `*.csproj`
- Swift: `Package.swift`
- HarmonyOS/ohpm: `oh-package.json5` or `hvigorfile.ts`
- Python: `pyproject.toml`
- PHP: `composer.json`
- Ruby: `*.gemspec`
- SDK families: `sdk-manifest.json`
- SDKWork apps: `sdkwork.app.config.json`

The standard tooling excludes archived, generated, and third-party paths such as `backup`, `external`, `vendor`, `generated`, `node_modules`, `dist`, `target`, `tmp`, `.worktrees`, and deprecated removed projects.

Repository and application workspace discovery is separate from component discovery. `SDKWORK_WORKSPACE_SPEC.md` validates `.sdkwork/` at git repository roots and application roots; this component spec validates component-local `specs/` directories below those roots.

## 6. Integration Rules

Rules:

- Component implementation follows `CODE_STYLE_SPEC.md` and public naming follows `NAMING_SPEC.md`.
- Component roots should split source by responsibility. A single file containing public exports, business logic, persistence, provider adapters, and tests is not an acceptable component boundary.
- Rust components must keep `src/lib.rs` as a module assembly and re-export boundary according to `RUST_CODE_SPEC.md`.
- Consumers integrate through package root exports, generated SDK clients, documented adapters, or runtime entrypoints declared in `component.spec.json`.
- Reusable UI and service components must not require app-local globals, concrete app names, hard-coded base URLs, hard-coded tenant IDs, or manual token/API key headers.
- SDK clients must be injected through service/runtime boundaries according to `SDK_SPEC.md` and `FRONTEND_SPEC.md`.
- Component-level dependency API exports `MUST` follow `SDK_SPEC.md`: dependency APIs are not
  exported by default, `contracts.dependencyApiExports: []` is the no-export state, and any
  `composed-wrapper` or `service-port` export must point to authored public code outside generated
  SDK transport.
- Runtime components that expose Rust HTTP integration `SHOULD` provide stable surface-specific
  public modules or files such as `sdkwork_<component>_open_api`,
  `sdkwork_<component>_app_api`, and `sdkwork_<component>_backend_api`. Each mounted surface
  `SHOULD` expose a public router/controller/service builder such as
  `build_sdkwork_<component>_<surface>_router` or a documented service builder with equivalent
  semantics.
- A consuming application integrates a dependency component by importing the declared public
  surface entrypoint, dependency SDK family, or composed facade. It `MUST NOT` deep-import private
  source files, copy dependency handlers, copy dependency OpenAPI, or infer executable coverage from
  route metadata.
- If a component exposes only route contracts or manifests and no executable router/controller or
  service builder, consumers `MUST` treat its HTTP SDK as an external dependency surface for runtime
  base URL configuration.
- App-specific visual identity may be passed as configuration or design tokens, not embedded as a dependency from shared component packages to consuming applications.
- Component specs should make extension points explicit when the component is intended for reuse by multiple applications.

## 7. Verification

Rules:

- Run `node ../sdkwork-specs/tools/check-component-port-bindings.mjs --root .` before declaring
  component specs or composable architecture component contracts complete. Use `--strict` when
  onboarding new modules or finishing migration of existing modules.
- Run `node ../sdkwork-specs/tools/check-application-layering.mjs --root .` when component specs or source changes affect API/service/domain/repository/adapter/runtime/frontend boundaries.
- Run `node ../sdkwork-specs/tools/check-permission-composition.mjs --root .` when component specs declare HTTP `sdkDependencies`.
- Run `node ../sdkwork-specs/tools/check-route-path-collisions.mjs --root .` when component specs declare route manifests or materialize OpenAPI authorities.
- Run `node ../sdkwork-specs/tools/check-api-assembly-integration-closure.mjs --root .` when an API
  assembly, standalone gateway, platform gateway, Cargo composition feature, module database
  lifecycle, or dependency surface executable export changes.
- Standard changes require tests for the discovery and validation tooling.
- Component-local README examples and verification commands should stay aligned with the package manifest and generated SDK surface.

## 8. Acceptance Checklist

- [ ] Component has `specs/README.md`.
- [ ] Component has `specs/component.spec.json`.
- [ ] If the component root is also a git repository root or application root, it has `.sdkwork/skills/` and `.sdkwork/plugins/` according to `SDKWORK_WORKSPACE_SPEC.md`.
- [ ] Manifest links to root canonical specs.
- [ ] Manifest includes `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, and only the language-specific specs required by `component.languages`.
- [ ] UI component manifests link to `UI_ARCHITECTURE_SPEC.md` and exactly one architecture-specific UI spec.
- [ ] Manifest uses canonical domain names.
- [ ] Public integration entrypoints are declared.
- [ ] Composable layer role and provided/required ports are declared for new modules, and legacy
  modules are not left with partial or invalid port declarations.
- [ ] Dependency SDK consumption is declared through `contracts.sdkDependencies`, including `[]`
  when there are no dependency SDKs.
- [ ] Permission inheritance is declared through `contracts.permissionComposition` whenever HTTP
  SDK dependencies require protected permission catalogs.
- [ ] Dependency API export policy is declared through `contracts.dependencyApiExports`, including
  `[]` when the component does not re-export dependency capabilities.
- [ ] Runtime dependency API mounting or external-service requirements are declared through
  `contracts.dependencyApiSurfaces` when the component serves, proxies, or depends on dependency
  HTTP APIs.
- [ ] Gateway components align dependency surfaces with native build-tool evidence such as Cargo
  features/dependencies and do not require a parallel gateway catalog.
- [ ] Gateway components consume each owner only through its API assembly building-block entrypoint
  and contain no direct owner route/service/repository/provider-adapter/database-host dependencies.
- [ ] Nested owner assembly dependencies declare a provider-qualified `requiredPorts` entry,
  same-origin surface or lifecycle ordering, shared host context, and executable bootstrap evidence.
- [ ] Rust/runtime components expose executable surface-specific integration entrypoints when they
  claim same-origin dependency API coverage.
- [ ] Generated SDK language outputs are represented at the SDK family root.
- [ ] Verification commands are present and runnable from the repository root or the component root.
- [ ] Authored source is split by responsibility and does not hide component behavior in a catch-all entrypoint file.
- [ ] Local specs do not copy or contradict root specs.
