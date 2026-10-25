# PLAN-20260629 Step 7 — Backend / Gateway Wave Evidence

- Date: 2026-06-29
- Step: 7 — Backend and gateway repository alignment
- Status: **Completed**

## Scope

Type B backend/gateway repositories:

- `sdkwork-api-cloud-gateway`
- `sdkwork-webserver`
- `sdkwork-database`
- `sdkwork-app-topology`

Plus backend-only application roots with `apps/` metadata but no standard client surfaces (manifest at repo root).

## Actions

1. Extended `validateBackendReleaseComposition` in `tools/lib/app-composition.mjs`:
   - Backend-only roots must declare `agent.app.config.json#sdkDependencies` when `backend` section exists
   - Skipped when standard client app surfaces exist under `apps/`
2. Added `sdkDependencies: []` to ten backend-only manifests missing the field:
   - `sdkwork-audio`, `sdkwork-codebox`, `sdkwork-discovery`, `sdkwork-github-workflow`, `sdkwork-kernel`, `sdkwork-llm`, `sdkwork-memory`, `sdkwork-sdk-generator`, `sdkwork-tts`, `sdkwork-video-cut`

## Verification

```text
node sdkwork-specs/tools/verify-repo.mjs --root sdkwork-api-cloud-gateway  → pass
node sdkwork-specs/tools/verify-repo.mjs --root sdkwork-webserver         → pass
node sdkwork-specs/tools/verify-repo.mjs --root sdkwork-database           → pass
node sdkwork-specs/tools/verify-repo.mjs --root sdkwork-app-topology       → pass
```

## Gate checklist

- [x] No `dependency.composition.json` in type B repos
- [x] Backend manifests declare `sdkDependencies` array
- [x] `verify-repo.mjs` passes for gateway/backend wave samples
