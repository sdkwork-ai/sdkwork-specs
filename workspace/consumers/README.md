# Workspace consumer overlays

Each file `consumers/<repo-name>.json` declares repo-specific sibling `pnpm-workspace.yaml` entries and optional `catalog` overrides for **that git repository only**. Consumer overlays are input to `sync-workspace.mjs`; the consuming repository root `pnpm-workspace.yaml` remains the workspace authority.

Foundation paths are owned by `tools/lib/workspace-registry.mjs` (`FOUNDATION_PNPM_PACKAGES`). Consumer overlays must list only paths unique to that repository.

Multi-repository checkout roots such as `sdkwork-space/` must not declare child application packages in an umbrella `pnpm-workspace.yaml`. Develop from the target git repository root:

```bash
cd sdkwork-im
node ../sdkwork-specs/tools/sync-workspace.mjs --repo sdkwork-im --root .
pnpm install
pnpm dev
```

```bash
node tools/extract-consumer-overlay.mjs --repo <repo-name> --root <path-to-repo> --write
node tools/sync-workspace.mjs --repo <repo-name> --root <path-to-repo> [--dry-run]
node tools/verify-repo.mjs --root <path-to-repo>
node tools/sweep-verify-repo.mjs
node tools/audit-app-composition.mjs
node tools/wire-app-composition-check.mjs --workspace ..
node tools/wire-verify-app-composition.mjs --workspace ..
```

## Isolated repositories (Step 8)

These roots are **excluded** from the composition registry until restructured under standard `apps/` layout:

| Repository | Decision | Reason |
| --- | --- | --- |
| `magic-studio` | Isolate | Legacy monolith layout; no `apps/sdkwork-*-{pc,h5,...}` standard |
| `magic-studio-v2` | Isolate | Same as magic-studio |
| `claw-studio` | Isolate | Product fork layout (`packages/sdkwork-cloudrouter-*`); not SDKWork app taxonomy |

Hybrid client roots (for example `sdkwork-notes-pc-react/`) are verified through `listClientAppRoots()` when they declare `sdkwork.app.config.json` at the app root. They must still use a single repository-root `pnpm-workspace.yaml`.

Authority: `APP_COMPOSITION_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, ADR-20260629.
