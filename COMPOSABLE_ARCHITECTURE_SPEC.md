# Composable Architecture Standard

- Version: 1.1
- Scope: cross-stack frontend/backend module composition, component port contracts, Rust crate dependency boundaries, route ownership, permission inheritance, and resolved architecture graphs
- Related: `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `APPLICATION_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `FRONTEND_SPEC.md`, `RUST_CODE_SPEC.md`, `WEB_BACKEND_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `APP_PERMISSION_COMPOSITION_SPEC.md`, `TEST_SPEC.md`

This standard is the thin cross-stack profile for SDKWork building-block architecture. It does not replace the existing application layering, frontend, backend, SDK, route, permission, or dependency standards. It defines how those standards close into one composable system. `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md` owns the application-wide L0-L6 layer model and dependency direction; this file owns cross-stack composition closure.

## 1. Core Principles

Rules:

- Native build tools remain dependency authority. `pnpm`, Cargo, Gradle, Maven, pubspec, OpenAPI, and lockfiles own package paths, versions, and generated contract inputs.
- `specs/component.spec.json` owns integration meaning: public exports, layer role, ports, SDK dependencies, route manifests, permission composition, dependency API exports, dependency API surfaces, and runtime entrypoints.
- A module is a building block only when it can be installed, understood, tested, and replaced through public exports and declared ports without reading private source files.
- Composition roots wire modules together; feature packages, service crates, route crates, repository crates, and host adapters do not discover each other through globals, copied DTOs, copied routes, hard-coded URLs, or private source imports.
- Within one gateway process, embedded dependency capabilities are consumed through declared in-process ports wired by the composition root. Consumers `MUST NOT` loop back HTTP requests to the process's own listener, and same-process consumption `MUST NOT` require dependency base URL variables or IAM service credentials that exist only to authenticate that loopback (`APPLICATION_GATEWAY_SPEC.md` section 2.3).
- Generated SDKs, route manifests, OpenAPI authority documents, IAM catalogs, and topology specs are owned artifacts. Consumers reference them by contract and must not fork them locally.
- Missing SDK/API behavior is fixed at the owner contract and generator input. Consumers must not add raw HTTP fallbacks, local DTO forks, hidden proxy routes, or ad hoc route constants.

### 1.1 Standard Closure Matrix

Composable architecture is complete only when the normative spec, machine contract, generated evidence, and validator all agree. Each concern below `MUST` close through the listed authorities instead of local README prose or copied dependency files.

| Concern | Primary standards | Machine contract | Required evidence and checks |
| --- | --- | --- | --- |
| Application L0-L6 layering | `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `APPLICATION_SPEC.md`, `WEB_BACKEND_SPEC.md`, `FRONTEND_SPEC.md` | `contracts.layerRole`, route manifest/OpenAPI authority, package/crate manifests, runtime/core bootstrap | `check-application-layering.mjs`, `check-component-port-bindings.mjs`, handler/service/repository tests, frontend service tests |
| Login, session, and auth context | `IAM_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `SECURITY_SPEC.md` | OpenAPI `security`, `x-sdkwork-auth-mode`, `x-sdkwork-forbid-credential-headers`; route manifest `auth.mode`; runtime session/token wiring | Login/session tests, credential-header rejection tests, `check-api-operation-patterns.mjs`, `check-api-response-envelope.mjs` |
| Actor, role, and permission inheritance | `PERMISSION_STANDARD_SPEC.md`, `IAM_RBAC_FEDERATION_SPEC.md`, `APP_PERMISSION_COMPOSITION_SPEC.md` | `contracts.permissionComposition`, `moduleCatalogRefs[]`, OpenAPI `x-sdkwork-permission`, IMF module manifests | `check-permission-composition.mjs`, IMF manifest validation, route/menu permission hint tests |
| Frontend module composition | `FRONTEND_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md` | `contracts.layerRole`, `publicExports`, `providedPorts`, `requiredPorts`, `sdkDependencies`, package `exports` | `check-frontend-composition.mjs`, `check-component-port-bindings.mjs`, `check-app-sdk-consumer-imports.mjs`, package typecheck |
| Rust backend layering | `RUST_CODE_SPEC.md`, `WEB_BACKEND_SPEC.md`, `WEB_FRAMEWORK_SPEC.md` | Cargo workspace dependencies, crate names, `contracts.layerRole`, `routeManifest`, `runtimeEntrypoints`, `dependencyApiSurfaces` | `check-rust-backend-composition.mjs`, route manifest tests, handler/service/repository boundary tests |
| Route and URL ownership | `API_SPEC.md`, `APPLICATION_GATEWAY_SPEC.md`, `HEALTH_CHECK_SPEC.md` | Route manifest owner/surface/path, OpenAPI `x-sdkwork-owner`, `x-sdkwork-api-authority`, `x-sdkwork-api-surface` | `check-route-path-collisions.mjs`, API assembly validation, OpenAPI materialization tests |
| API input/output contract | `API_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md` | OpenAPI schemas, operationId, `SdkWorkApiResponse`, `ProblemDetail`, SDK generation manifest | `check-api-response-envelope.mjs`, `check-api-operation-patterns.mjs`, generated SDK compile and facade tests |
| Resolved composition graph | `APP_COMPOSITION_SPEC.md`, `APP_INTEGRATION_CONVENTIONS.md`, this standard | Generated `generated/composition.resolved.json#architecture` | `resolve-composition.mjs --write`, `check-composition-resolver.mjs`, `verify-repo.mjs` |

Rules:

- A new module is not production-ready until every applicable row above has a machine contract and a passing validator.
- README files, runbooks, and examples may explain integration, but they `MUST NOT` replace `component.spec.json`, route manifests, OpenAPI extensions, SDK manifests, IAM module manifests, or native build-tool dependency declarations.
- A dependency SDK, route manifest, or permission catalog `MUST` remain owned by its source module. Consumers compose it by reference through SDK dependencies, ports, runtime entrypoints, or permission catalog refs.
- If a validator cannot express a rule yet, the owning standard `MUST` name the temporary manual evidence and the follow-up validator requirement in `TEST_SPEC.md` or `QUALITY_GATE_SPEC.md`.

## 2. Layer Roles

Authored components `SHOULD` declare `contracts.layerRole`; new composable modules `MUST` declare it.

Allowed roles:

| Role | Owner |
| --- | --- |
| `contract` | Shared types, schemas, protocol contracts, route metadata without runtime implementation |
| `frontend-core` | SDK registry, module registry, host contracts, session/runtime composition |
| `frontend-shell` | Navigation, layout, route contribution assembly, AuthGate placement |
| `frontend-feature` | One capability's screens/pages, services, state, i18n, route contributions |
| `frontend-commons` | Domain-neutral UI primitives and helpers |
| `frontend-host` | Platform/native/browser host adapters |
| `backend-route` | HTTP route/controller/handler adapter and route manifest |
| `backend-service` | Application service/use-case, domain policy, service ports |
| `backend-domain` | Domain model, value objects, policies, repository/provider ports |
| `backend-repository` | Persistence adapter implementation |
| `backend-provider` | External provider, dependency SDK, RPC, cache, event, or storage adapter |
| `runtime-api-server` | Migration-only HTTP listener role for retired `*-api-server` crates; new ingress uses `runtime-gateway` |
| `runtime-service-host` | In-process service container without HTTP listener |
| `runtime-composition` | Host-neutral API assembly or runtime contribution graph without listener ownership |
| `runtime-gateway` | Standalone/cloud ingress and dependency surface proxying |
| `runtime-native-host` | Tauri/native command boundary and local runtime bridge |
| `sdk-facade` | Authored composed SDK wrapper or consumer facade |
| `sdk-generated` | Generated SDK transport output |
| `tooling` | Repository tooling, validators, generators, migration scripts |

## 3. Ports And Public Contracts

Rules:

- `contracts.publicExports` lists supported integration entrypoints; consumers must not import private `src/**` files across package/crate boundaries.
- `contracts.providedPorts` lists named public ports a component offers. Each object `MUST` include `name` and `export`; `export` must reference `contracts.publicExports`.
- `contracts.requiredPorts` lists named public ports a component needs from runtime/core/dependencies. Each object `MUST` include `name` and `export` or an approved SDK/service/host adapter reference.
- Frontend feature packages `MUST` make SDK, service, host, feature flag, and route contribution inputs explicit through ports or public composition helpers.
- Rust runtime and gateway components that claim same-origin dependency API coverage `MUST` expose executable public builders through `contracts.runtimeEntrypoints`; route manifests, path constants, and OpenAPI files are metadata only.

Example:

```json
{
  "contracts": {
    "layerRole": "frontend-feature",
    "publicExports": ["."],
    "providedPorts": [{ "name": "chatServices", "export": "." }],
    "requiredPorts": [{ "name": "appSdk", "export": "." }]
  }
}
```

## 4. Frontend Composition

Rules:

- Client roots are composition roots. App entry code stays thin: bootstrap, providers, route assembly, environment selection, SDK client construction, IAM runtime wiring, and host adapter registration.
- `core`, `console-core`, and `admin-core` own SDK/module/host/session/composition registries and must expose `.`, `./sdk`, `./modules`, `./host`, `./session`, and `./composition`.
- Feature packages consume SDK and service capabilities through core public exports, injected SDK clients, or declared ports. They must not import generated SDK packages directly.
- `core` and `commons` packages must not depend on capability packages. Shell packages compose route contributions and layout; they do not own business SDK orchestration. Host packages must not depend on business API SDKs.
- Cross-architecture reuse happens through SDKs, service ports, route metadata, i18n keys, design tokens, host adapter contracts, and test fixtures, not through UI/runtime imports.

Verification:

```bash
node sdkwork-specs/tools/check-frontend-composition.mjs --root <repo>
node sdkwork-specs/tools/check-component-port-bindings.mjs --root <repo> [--strict]
```

## 5. Rust Backend Composition

Allowed dependency direction:

```text
route/controller adapter
  -> service/use-case
  -> domain model and ports
  -> repository/provider adapters

gateway/service-host
  -> route/service/repository/provider construction
```

Rules:

- Service crates own business rules, authorization decisions, transactions, idempotency, domain events, and repository/provider ports. They must not depend on concrete `*-repository-sqlx` crates or HTTP framework request/response types.
- Repository crates implement ports and own SQL/schema/row mapping. They must not depend on `sdkwork-web-framework`, `axum`, or other HTTP framework crates.
- Route crates implement one capability and one surface. They must not depend on generated SDKs for the same API authority and must not depend on concrete repository crates.
- Service host, native host, worker, standalone gateway, and cloud gateway crates are runtime composition units. They construct dependencies and mount public entrypoints; they do not own business rules. Retired `*-api-server` crates may appear only as migration evidence and must move to the gateway role before release.
- For HTTP capabilities, the owner API assembly is the indivisible runtime building block. It owns
  database lifecycle plus service/repository/provider construction and returns the complete
  contribution/runtime bundle. Standalone and cloud gateways supply process context and compose
  that public entrypoint; they do not import owner implementation crates.
- Cargo features for composition must be additive and named by adapter, runtime, or surface. Broad default features must not hide dependency API mounts or provider integrations.
- Member `Cargo.toml` files must consume sibling SDKWork crates with `{ workspace = true }`; root `[workspace.dependencies]` owns sibling paths.

Verification:

```bash
node sdkwork-specs/tools/check-rust-backend-composition.mjs --root <repo>
node sdkwork-specs/tools/check-api-assembly-integration-closure.mjs --root <repo>
```

## 6. Backend Layer Contract

SDKWork web backends use the L0-L6 profile from `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`:

| Layer | Owns | Must not own |
| --- | --- | --- |
| L0 API authority | OpenAPI, route manifest, operationId, request/response schema, auth mode | Runtime-only path invention |
| L1 Route/controller adapter | HTTP method/path mount, handler binding, request/response mapping | Business rules, SQL, provider calls |
| L2 Service/use-case | Business policy, authorization decisions, transactions, idempotency, events/cache orchestration | HTTP response objects, raw headers |
| L3 Domain/ports | Domain models, policies, repository/provider traits | Infrastructure implementation |
| L4 Infrastructure adapter | SQLx repositories, provider clients, generated dependency SDK/RPC adapters | HTTP routing, API DTO ownership |
| L5 Runtime composition | gateway, service host, dependency construction, preflight | Business policy, API ownership |
| L6 Runtime operations | Config, topology, observability, health, deployment profile | Feature behavior |

## 7. Routes And Permissions

Rules:

- Every normalized `(surface, method, path)` has one owner. `{id}`, `:id`, and `<id>` are the same parameter segment.
- Dependency-owned routes stay dependency-owned. Consumers mount dependency executable entrypoints, proxy external upstreams, or call dependency SDKs; they do not copy dependency routes into local authorities.
- Standard health/readiness paths such as `/app/v3/api/system/health`, `/app/v3/api/system/ready`, `/backend/v3/api/system/health`, and `/backend/v3/api/system/ready` are reserved for the standard health route owner. Business capability modules must use capability-specific paths.
- HTTP `sdkDependencies` that require protected app-api, backend-api, or SDKWork-owned open-api permissions must declare `contracts.permissionComposition` and inherit dependency permission catalogs by reference.

Verification:

```bash
node sdkwork-specs/tools/check-route-path-collisions.mjs --root <repo>
node sdkwork-specs/tools/check-permission-composition.mjs --root <repo>
```

## 8. Resolved Composition

`tools/resolve-composition.mjs --root <repo> --write` materializes `generated/composition.resolved.json`.

The resolver output is generated evidence only. It must not become a hand-edited source of truth.

Required output groups:

- `integrations`: dependency SDK runtime mode, surface, prefix, env key, and platform gateway requirements.
- `permissions`: inherited permission manifest refs and permission composition mode.
- `architecture.components`: component layer roles, public exports, ports, route manifests, SDK dependencies, runtime entrypoints, and dependency API surfaces.
- `architecture.frontend.packages`: client package role graph.
- `architecture.rust.crates`: Cargo crate graph summary.
- `architecture.routes.manifests`: route manifest inventory.
- `architecture.runtime.dependencyApiSurfaces`: runtime dependency surface declarations.

## 9. Golden Paths

Adding a frontend module:

1. Create one capability package under the selected client root.
2. Add `specs/component.spec.json` with `layerRole: "frontend-feature"`, public exports, provided/required ports, route/i18n contributions, and verification commands.
3. Consume SDKs only through core public exports or injected ports.
4. Run frontend composition, component port, SDK import, permission, route, and repo verification.

Adding a Rust backend capability:

1. Create service/domain ports first.
2. Add repository/provider adapters only when needed.
3. Add route crate for one capability and one API surface.
4. Aggregate route manifests into owner-only API authority and generated SDK family.
5. Run Rust backend composition, route collision, API operation, API envelope, SDK, and repo verification.

Adding a full-stack module:

1. Establish backend API authority and generated SDK first.
2. Wire frontend feature through injected SDK/service ports.
3. Declare permission composition and route ownership.
4. Materialize `composition.resolved.json`.
5. Run all cross-stack validators.

Consuming a dependency API:

1. Declare `contracts.sdkDependencies`.
2. Declare `dependencyApiExports: []` unless deliberately exposing a public facade.
3. Use `dependencyApiSurfaces` for same-origin mount, external service, or intentionally not-mounted runtime behavior.
4. Same-origin mode requires executable public runtime entrypoints and coverage evidence.
5. External mode requires dependency-specific base URL/upstream config and fail-fast preflight.

## 10. Required Checks

Before claiming composable architecture alignment:

```bash
node sdkwork-specs/tools/check-component-port-bindings.mjs --root <repo>
node sdkwork-specs/tools/check-application-layering.mjs --root <repo>
node sdkwork-specs/tools/check-frontend-composition.mjs --root <repo>
node sdkwork-specs/tools/check-rust-backend-composition.mjs --root <repo>
node sdkwork-specs/tools/check-api-assembly-integration-closure.mjs --root <repo>
node sdkwork-specs/tools/resolve-composition.mjs --root <repo> --write
node sdkwork-specs/tools/check-composition-resolver.mjs --root <repo>
node sdkwork-specs/tools/check-permission-composition.mjs --root <repo>
node sdkwork-specs/tools/check-route-path-collisions.mjs --root <repo>
node sdkwork-specs/tools/verify-repo.mjs --root <repo>
```
