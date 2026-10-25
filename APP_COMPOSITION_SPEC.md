# App Composition Standard

- Version: 1.2
- Scope: client application composition using native build-tool authority, core-package import entrypoints, and component-spec runtime metadata
- Related: `COMPOSABLE_ARCHITECTURE_SPEC.md`, `APPLICATION_SPEC.md`, `APP_INTEGRATION_CONVENTIONS.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_PERMISSION_COMPOSITION_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `COMPONENT_SPEC.md`, `MODULE_SPEC.md`, `TEST_SPEC.md`

This standard defines application composition without a parallel dependency manifest. Native build-tool files own dependency graphs; component and app manifests own runtime semantics.

## 1. Authority Model

| Concern | Authority |
| --- | --- |
| Source dependency paths and versions | Native build-tool roots (`pnpm-workspace.yaml`, Cargo workspace, etc.) |
| Frontend SDK inventory (per surface) | `*-core/specs/component.spec.json#contracts.sdkDependencies` |
| Permission inheritance/overrides | App-surface `specs/component.spec.json#contracts.permissionComposition` |
| Backend/release SDK inventory | App Standard v3 root `specs/component.spec.json#contracts.sdkDependencies`; legacy v2 `agent.app.config.json#sdkDependencies` only during migration |
| Dependency API export/runtime policy | `component.spec.json#contracts.dependencyApiExports`; runtime mount/base-url facts derived by composition resolver |
| Integration defaults | Dependency `sdk-manifest.json`, dependency `component.spec.json#integration`, and the consuming component's `contracts.sdkDependencies` |
| Cross-stack resolved graph | generated `generated/composition.resolved.json#architecture` from `resolve-composition.mjs` |

Rules:

- Consumer repositories should converge on three authoritative files: `agent.app.config.json`, `specs/topology.spec.json`, and `*-core/specs/component.spec.json`.
- Integration prefixes, planes, runtime modes, permission manifest refs, and bootstrap env defaults are derived by `APP_INTEGRATION_CONVENTIONS.md` and `resolve-composition.mjs`.
- Consumer-side hand-maintained `specs/dependency-api-surfaces.json` is migration-only input under an approved exception; new or pre-launch consumers must not add one.
- Do not introduce `specs/dependency.composition.json` or equivalent parallel manifest.
- A client repository must declare sibling source paths once at the repository workspace root.
- Feature packages must import SDK access only through core package public exports.
- Dependency modules are composable building blocks. Consumers declare dependency intent once, then inherit SDK facade, route registry entries, permission catalogs, and runtime defaults by reference.
- Consumers must not copy dependency-owned routes, permission catalogs, or SDK transport packages into local feature packages.
- `generated/composition.resolved.json` is generated evidence only. It summarizes components,
  frontend packages, Rust crates, route manifests, permission inheritance, dependency API surfaces,
  and runtime integration facts; it must not be hand-edited or used as a parallel source manifest.

## 2. Composition Layers

```text
Feature packages (L2)
  -> Core package public exports (L1)
  -> Native workspace dependencies + app/component manifests (L0)
```

Allowed direction:

- feature/service -> `@sdkwork/<application-code>-<arch>-core/*`
- bootstrap -> core runtime factory
- core sdk registry -> generated SDK clients / approved facades

Forbidden:

- feature package direct imports of generated SDK packages
- app/console surface using backend-admin SDK inventory
- member package-local sibling path declarations

## 3. Core Package Conventions

Core packages (`-core`, `-console-core`, `-admin-core`) must expose:

- `.`
- `./sdk`
- `./modules`
- `./host`
- `./session`
- `./composition`

Rules:

- `./composition` is for bootstrap and verification only, not feature imports.
- `-admin-core` may expose backend-admin SDK helpers; app/console packages must not import them.
- Core `composition/` directory must include SDK registry, module registry, and host registry implementation.

## 4. Surface Metadata Placement

Rules:

- App-surface root or core-package `specs/component.spec.json` must include `contracts.permissionComposition` when HTTP `sdkDependencies` or modular permissions apply.
- Core package `component.spec.json` must include `contracts.sdkDependencies` with explicit `surface` and `credentialMode`.
- Protected open-api dependencies use the credential mode matching the authority contract: `protected-open-api-api-key`, `protected-open-api-oauth`, `protected-open-api-flexible` for API-key-or-OAuth, or `protected-open-api-api-key-or-dual-token` for the mutually exclusive API-key/dual-token profile.
- Backend-only App Standard v3 roots must declare release/runtime SDK inventory through root
  `specs/component.spec.json#contracts.sdkDependencies`; they must not restore the retired top-level
  manifest field. Legacy v2 roots may retain `agent.app.config.json#sdkDependencies` only until
  their v3 migration moves that inventory to the component contract.
- Bootstrap runtime must derive SDK wiring from core composition and component manifests; no second handwritten inventory.

## 5. Cross-Repository Package Consumption

When one SDKWork repository consumes another repository's feature packages during local development, consumption must follow native workspace and public export boundaries.

Rules:

- The consuming repository `MUST` register sibling packages once in its repository-root `pnpm-workspace.yaml` through `sdkwork-specs/workspace/consumers/<repo>.json` and `sync-workspace.mjs`.
- Cross-repository imports `MUST` use workspace package names and declared `exports` entrypoints. Example: `@sdkwork/knowledgebase-pc-knowledge`, not `../../sdkwork-knowledgebase/.../src`.
- The consumed sibling package `MUST` self-declare its direct third-party npm dependencies in its own `package.json`.
- Host applications `MUST` depend on the domain facade package (for example `@sdkwork/knowledgebase-pc-knowledge`) rather than importing deep sibling implementation packages unless that implementation package is explicitly registered and exported for host composition.
- Tailwind `@source`, Vite alias, and TypeScript path mappings `MAY` point at sibling source trees only when the consuming repository can resolve the scanned package's declared npm dependencies.
- Tailwind bootstrap ownership `MUST` follow `TAILWIND_CSS_INTEGRATION_SPEC.md`. Host applications own the single `@import "tailwindcss"` entry and integrated `@source` registry; host-composed feature packages must not re-bootstrap Tailwind in imported CSS.
- Forbidden:
  - relative imports into another repository's `src/` tree
  - using app-root dependency hoisting to compensate for missing member `dependencies`
  - duplicate sibling path declarations in member packages

## 6. Verification

Required checks:

- `verify-workspace`: one workspace file per repository root; no nested app-level workspace files
- `verify-import-boundaries`: no feature direct generated SDK imports
- `verify-import-closure`: workspace member imports match declared package dependencies
- `verify-package-exports`: required core export subpaths
- `verify-sdk-dependencies`: surface segregation and package resolvability
- `verify-component-port-bindings`: component layer roles, ports, and executable runtime entrypoints
- `verify-frontend-composition`: core/feature/host dependency direction and SDK import boundaries
- `verify-rust-backend-composition`: Rust service/route/repository Cargo dependency boundaries
- `verify-permission-composition`: app-surface permission composition integrity
- `verify-route-path-collisions`: normalized `(surface, method, path)` uniqueness across OpenAPI authorities and route manifests

Workspace commands:

```bash
node sdkwork-specs/tools/verify-repo.mjs --root <repo>
node sdkwork-specs/tools/check-component-port-bindings.mjs --root <repo>
node sdkwork-specs/tools/check-frontend-composition.mjs --root <repo>
node sdkwork-specs/tools/check-rust-backend-composition.mjs --root <repo>
node sdkwork-specs/tools/resolve-composition.mjs --root <repo> --write
node sdkwork-specs/tools/check-composition-resolver.mjs --root <repo>
node sdkwork-specs/tools/check-permission-composition.mjs --root <repo>
node sdkwork-specs/tools/check-route-path-collisions.mjs --root <repo>
node sdkwork-specs/tools/verify-repo.mjs --root <repo> --strict-import-closure
node sdkwork-specs/tools/sweep-verify-repo.mjs
node sdkwork-specs/tools/audit-app-composition.mjs
```

`verify-repo.mjs` always enforces cross-package relative import boundaries (including package-to-app-root `src/` imports). Import-closure (`verify-import-closure`) is opt-in via `--strict-import-closure` or `VERIFY_IMPORT_CLOSURE_STRICT=1` until each repository completes member `package.json` alignment.

Acceptance:

- [ ] No `dependency.composition.json` in target repository
- [ ] Core imports are the only dependency entry for feature packages
- [ ] Runtime and permission metadata are resolved from existing manifest authorities
- [ ] Route registry uniqueness is verified before dependency routes are mounted
- [ ] Cross-repository imports use workspace package names and public exports only
- [ ] Consumed sibling packages self-declare direct third-party dependencies
