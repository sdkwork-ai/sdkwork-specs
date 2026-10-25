# ADR: Native Composition Architecture Without Parallel Dependency Manifest

- Status: Accepted
- Date: 2026-06-29
- Scope: client application composition, workspace dependency governance, permission composition metadata placement
- Supersedes: dependency-composition manifest model centered on `specs/dependency.composition.json`

## Context

SDKWork repositories currently keep a parallel semantic manifest (`specs/dependency.composition.json`) in many client app roots. This created drift against native build-tool authority (`pnpm-workspace.yaml`, Cargo workspace), duplicate maintenance burden, and repeated runtime adapters that import composition JSON directly.

The workspace is pre-launch. No production migration compatibility window is required.

## Decision

Adopt a native-authority composition architecture:

1. Remove `specs/dependency.composition.json` as a required standard artifact.
2. Keep dependency graph authority in native build-tool files only.
3. Keep runtime composition and policy metadata in existing component/app manifests:
   - core SDK inventory in `*-core/specs/component.spec.json#contracts.sdkDependencies`
   - permission inheritance in app-surface `specs/component.spec.json#contracts.permissionComposition`
   - backend/release dependency inventory in `agent.app.config.json#sdkDependencies`
4. Standardize core package public import surface through `package.json#exports` (`.`, `./sdk`, `./modules`, `./host`, `./session`, `./composition`).
5. Enforce with centralized tooling in `sdkwork-specs/tools`:
   - `sync-workspace.mjs`
   - `verify-repo.mjs` and sub-checks
6. Remove old composition-specific tools and checks.

## Consequences

- Standards must not require `dependency.composition.json`.
- Existing source files that import composition JSON must switch to component/app manifest readers.
- Nested app-level `pnpm-workspace.yaml` files are prohibited; one workspace manifest per git repository root.
- Workspace convergence must complete before Phase B application repository migration.

## Alternatives Rejected

1. Keep composition manifest but mark optional — rejected due to continued dual-authority drift.
2. Introduce new custom dependency registry manifest in each repo — rejected as another parallel system.
3. Keep current model and automate sync only — rejected because source-of-truth ambiguity remains.

## Verification

- `SOUL.md` includes native-authority principle.
- `APP_DEPENDENCY_COMPOSITION_SPEC.md` removed and replaced with `APP_COMPOSITION_SPEC.md`.
- Specs and tooling no longer mandate `dependency.composition.json`.
