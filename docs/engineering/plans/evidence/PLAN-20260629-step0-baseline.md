# PLAN-20260629 Step 0 Baseline Audit

- Date: 2026-06-29
- Scope: Workspace-wide read-only baseline for Phase A kickoff
- Commands:
  - `rg --files -g "**/dependency.composition.json" "<workspace-root>" | Measure-Object`
  - `rg --files -g "**/apps/**/pnpm-workspace.yaml" "<workspace-root>" | Measure-Object`
  - `rg -l "dependencyComposition" -g "**/component.spec.json" "<workspace-root>" | Measure-Object`
  - `rg -l "dependency\.composition\.json" -g "**/*.{ts,tsx,dart,mjs}" "<workspace-root>" | Measure-Object`

## Baseline Counts

| Metric | Count |
| --- | ---: |
| `dependency.composition.json` files | 80 |
| Nested `apps/**/pnpm-workspace.yaml` files | 33 |
| `component.spec.json` containing `dependencyComposition` | 124 |
| TS/TSX/Dart/MJS files referencing `dependency.composition.json` | 120 |

## Sample Paths

- `sdkwork-im/apps/sdkwork-im-pc/specs/dependency.composition.json`
- `sdkwork-mcp/apps/sdkwork-mcp-h5/specs/dependency.composition.json`
- `sdkwork-iam/apps/sdkwork-iam-pc/specs/dependency.composition.json`
- `sdkwork-cloudrouter/apps/sdkwork-cloudrouter-pc/packages/sdkwork-cloudrouter-pc-core/src/composition/permission-composition.ts`
- `sdkwork-knowledgebase/tools/check_dependency_composition_standard.mjs`
- `sdkwork-im/apps/sdkwork-im-pc/pnpm-workspace.yaml`

## Batch Confirmation

Repository batches in plan section 2 remain valid relative to baseline distribution:

- Pilot: `sdkwork-im`
- Foundation: `sdkwork-iam`, `sdkwork-appbase`, `sdkwork-core`, `sdkwork-ui`, `sdkwork-utils`, `sdkwork-sdk-commons`
- Client wave 1 and wave 2: required due to broad spread of composition artifacts
- Backend and legacy waves still needed for complete closure

## Step 0 Gate Checklist

- [x] Baseline report exists with counts and sample paths
- [x] Repository batch list confirmed (plan section 2)
- [x] No implementation changes in this step
