# PLAN-2026-0629: Composition Architecture Execution Plan

- Status: **Completed**
- Date: 2026-06-29
- Owner: sdkwork-space maintainers
- Authority: v2.1 composition architecture (native authority, convention over configuration)
- Related ADR: `docs/architecture/decisions/ADR-20260629-native-composition-architecture.md` (created in Phase 1)
- Related specs (target end state): `SOUL.md`, `APP_COMPOSITION_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `COMPONENT_SPEC.md`, `APP_PERMISSION_COMPOSITION_SPEC.md`

## 0. Purpose

This plan is the **only** execution sequence for removing `dependency.composition.json`, converging on native build-tool authority, and rolling out workspace registry tooling across SDKWork git repositories.

**Checkout-root note:** Multi-repository checkout roots such as `sdkwork-space/` hold governance only (catalog, sync tools, consumer overlays). Each git repository owns its own `pnpm-workspace.yaml`, lockfile, `pnpm install`, and `pnpm dev`. Do not declare child application packages in the checkout-root workspace manifest.

### Phase A — `sdkwork-specs` first (mandatory)

**All normative standards and verification tooling must land in `sdkwork-specs` before any consumer repository is migrated.**

Order within Phase A:

1. **Step 0** — Baseline audit (read-only; may run in parallel with Step 1)
2. **Step 1** — Governance foundation (ADR, SOUL, spec rewrites, delete old spec)
3. **Step 2** — Tooling foundation (`workspace/` registry + `sync-workspace` + `verify-repo`)

**Phase A gate:** Step 1 and Step 2 evaluations both pass. No `sdkwork-*` application repository edits until Phase A is complete.

Phase B (Steps 3–9) migrates consumer repositories against the finalized `sdkwork-specs` authority.

Rules:

- Work **must** follow step order. Do not skip steps.
- A step is **complete** only when every item in that step's **Gate Checklist** is satisfied and recorded in **Progress Log** (section 8).
- Moving to the next step **requires** a short **Step Evaluation** (section 7 template) with evidence links or command output summaries.
- If a gate fails, fix within the current step. Do not advance with known failures.
- No compatibility window, no deprecated artifacts, no parallel old/new tooling after Phase 11.

## 1. Target End State (Reminder)

| Item | End state |
| --- | --- |
| `dependency.composition.json` | Zero files workspace-wide |
| Nested `apps/**/pnpm-workspace.yaml` | Zero files |
| `dependencyComposition` field | Removed from all `component.spec.json` |
| Workspace authority | One `pnpm-workspace.yaml` per git repo root |
| Sibling dependencies | Declared via `sdkwork-specs/workspace/consumers/<repo>.yaml` + `sync-workspace.mjs` |
| Frontend SDK inventory | `*-core/specs/component.spec.json#contracts.sdkDependencies` |
| Permission inheritance | App surface root `specs/component.spec.json#contracts.permissionComposition` |
| Backend/release SDK inventory | `agent.app.config.json#sdkDependencies` |
| Verification | `pnpm verify` → `verify-repo.mjs` suite passes per repo |

## 2. Repository Batches

| Batch | Type | Repos (initial) |
| --- | --- | --- |
| Pilot | A | `sdkwork-im` |
| Foundation | C/D | `sdkwork-iam`, `sdkwork-appbase`, `sdkwork-core`, `sdkwork-ui`, `sdkwork-utils`, `sdkwork-sdk-commons` |
| Client wave 1 | A | `sdkwork-mall`, `sdkwork-mcp`, `sdkwork-cloudrouter`, `sdkwork-agents`, `sdkwork-terminal`, `sdkwork-birdcoder` |
| Client wave 2 | A | Remaining `sdkwork-*` client repos with `apps/sdkwork-*-{pc,h5,flutter-mobile,mini-program}/` |
| Backend wave | B | `sdkwork-api-cloud-gateway`, `sdkwork-webserver`, other backend-only roots |
| Legacy decision | E | `sdkwork-notes`, `magic-studio`, `claw-studio`, `magic-studio-v2` — isolate or restructure |

## 3. Execution Steps

### Step 0 — Baseline Audit (read-only)

**Objective:** Capture measurable starting point. No source changes.

**Tasks:**

1. Run workspace inventory scripts (or manual counts recorded in progress log):
   - Count `dependency.composition.json`
   - Count nested `apps/**/pnpm-workspace.yaml`
   - Count `dependencyComposition` in `component.spec.json`
   - Count TS/Dart files importing `dependency.composition.json`
2. Save baseline report to `sdkwork-specs/docs/engineering/plans/evidence/PLAN-20260629-step0-baseline.md`

**Gate Checklist:**

- [ ] Baseline report exists with counts and sample paths
- [ ] Repository batch list confirmed (section 2)
- [ ] No implementation changes in this step

---

### Step 1 — Governance Foundation (specs + ADR + SOUL)

**Objective:** Authoritative standards describe the target architecture before code/tool changes.

**Tasks:**

1. Add ADR `ADR-20260629-native-composition-architecture.md` (Accepted)
2. Update `SOUL.md` — native authority principle
3. Create `APP_COMPOSITION_SPEC.md`
4. Delete `APP_DEPENDENCY_COMPOSITION_SPEC.md`
5. Update `DEPENDENCY_MANAGEMENT_SPEC.md`, `COMPONENT_SPEC.md` (schema v2 fields), `APP_PERMISSION_COMPOSITION_SPEC.md`, `MODULE_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `TEST_SPEC.md`, `README.md` task matrix
6. Remove all references to `dependency.composition.json` from `sdkwork-specs/*.md`

**Gate Checklist:**

- [ ] ADR status = Accepted
- [ ] `APP_DEPENDENCY_COMPOSITION_SPEC.md` deleted
- [ ] `rg dependency\.composition sdkwork-specs` returns zero hits in normative spec text (tools/changelogs excluded)
- [ ] `APP_COMPOSITION_SPEC.md` defines core exports, directory conventions, authority matrix
- [ ] Peer review: specs internally consistent (no MUST requiring deleted files)

**Verification:**

```bash
cd sdkwork-specs
rg "dependency\.composition" --glob "*.md"
```

---

### Step 2 — Tooling Foundation (`sync-workspace` + `verify-repo`)

**Objective:** Build the automation that enforces the new model before mass repo edits.

**Tasks:**

1. Create `sdkwork-specs/workspace/catalog.base.yaml`
2. Create `sdkwork-specs/workspace/paths.foundation.pnpm.yaml` (from `iam-workspace-paths.mjs` + foundation paths)
3. Create `sdkwork-specs/workspace/consumers/` directory + README
4. Implement `tools/sync-workspace.mjs`
5. Implement `tools/verify-repo.mjs` orchestrator and sub-checkers:
   - `verify-workspace.mjs`
   - `verify-catalog.mjs`
   - `verify-package-exports.mjs`
   - `verify-import-boundaries.mjs`
   - `verify-sdk-dependencies.mjs`
   - `verify-permission-composition.mjs`
   - `verify-sdk-closure.mjs`
6. Wire existing `check-iam-workspace-paths.mjs` into verify suite
7. Delete `align-dependency-composition.mjs`, `check-dependency-composition.mjs`, `lib/dependency-composition.mjs`
8. Add `sdkwork-specs` self-test for new tools

**Gate Checklist:**

- [ ] `sync-workspace.mjs --repo sdkwork-im --dry-run` runs without error
- [ ] `verify-repo.mjs` runs on a scratch fixture repo and detects intentional violations
- [ ] Old composition tools deleted
- [ ] Tool unit tests pass: `node --test sdkwork-specs/tools/*.test.mjs` (or documented subset)
- [ ] `sdkwork-specs/docs/engineering/plans/evidence/PLAN-20260629-step2-tools.md` records commands + outputs

---

### Step 3 — Pilot: `sdkwork-im` (end-to-end)

**Objective:** Prove the full loop on one high-fanout client repo before scaling.

**Tasks:**

1. Add `sdkwork-specs/workspace/consumers/sdkwork-im.yaml`
2. Run `sync-workspace.mjs --repo sdkwork-im` → update root `pnpm-workspace.yaml`
3. Delete `apps/sdkwork-im-pc/pnpm-workspace.yaml` and any other nested workspace under `sdkwork-im`
4. Delete all `dependency.composition.json` under `sdkwork-im`
5. Migrate permission + SDK metadata to `component.spec.json` (surface roots + cores) for pc/h5/flutter surfaces
6. Update `*-core` `dependency-manifest.ts`, `sdk-inventory.ts`, `permission-composition.ts` to read `component.spec.json`
7. Consolidate core `package.json#exports` to standard subpaths; remove `./sdk/*` granular exports
8. Remove shim packages if present
9. Update bootstrap to derive SDK inventory from core only
10. `pnpm install && pnpm verify` from `sdkwork-im`

**Gate Checklist:**

- [ ] `rg dependency\.composition sdkwork-im` → zero hits
- [ ] `glob apps/**/pnpm-workspace.yaml` under `sdkwork-im` → zero files
- [ ] `pnpm verify` passes in `sdkwork-im`
- [ ] `pnpm dev` (pc surface) starts and HMR works against sibling edits (manual smoke noted in evidence)
- [ ] Evidence file: `PLAN-20260629-step3-pilot-im.md`

---

### Step 4 — Foundation Repos

**Objective:** Stabilize shared siblings consumed by most client repos.

**Repos:** `sdkwork-iam`, `sdkwork-appbase`, `sdkwork-core`, `sdkwork-ui`, `sdkwork-utils`, `sdkwork-sdk-commons`

**Tasks:** Per repo — sync workspace, delete nested workspaces, delete composition files, align component specs, verify.

**Gate Checklist (per repo):**

- [ ] Zero `dependency.composition.json`
- [ ] Zero nested `pnpm-workspace.yaml`
- [ ] `pnpm verify` passes (or repo-type-appropriate verify profile for pure library repos)

**Gate Checklist (step):**

- [ ] All six foundation repos meet per-repo gates
- [ ] `consumers/*.yaml` foundation paths match `paths.foundation.pnpm.yaml`
- [ ] Evidence: `PLAN-20260629-step4-foundation.md`

---

### Step 5 — Client Wave 1

**Objective:** Scale to high-fanout client repos.

**Repos:** `sdkwork-mall`, `sdkwork-mcp`, `sdkwork-cloudrouter`, `sdkwork-agents`, `sdkwork-terminal`, `sdkwork-birdcoder`

**Tasks:** Same pattern as Step 3 per repo; add `consumers/<repo>.yaml` each.

**Gate Checklist:**

- [ ] Each repo: zero composition files, zero nested workspace, `pnpm verify` pass
- [ ] Workspace audit: `node sdkwork-specs/tools/verify-workspace.mjs --workspace ..` records zero nested-workspace violations for completed repos
- [ ] Evidence: `PLAN-20260629-step5-client-wave1.md`

---

### Step 6 — Client Wave 2 (remaining type A)

**Objective:** Complete all standard client application repositories.

**Tasks:**

1. Generate remaining `consumers/*.yaml` from current root `pnpm-workspace.yaml` sibling lists
2. Apply Step 3 pattern to every remaining type A repo
3. Delete repo-local `check_dependency_composition*.mjs` scripts; use central verify only

**Gate Checklist:**

- [ ] Workspace-wide: `rg -l dependency\.composition\.json` → zero outside `sdkwork-specs/docs` evidence/history
- [ ] Workspace-wide: nested `apps/**/pnpm-workspace.yaml` → zero
- [ ] Every type A repo: `pnpm verify` pass
- [ ] Evidence: `PLAN-20260629-step6-client-wave2.md` with repo checklist table

---

### Step 7 — Backend / Gateway Wave (type B)

**Objective:** Align backend-only repos (Cargo + `agent.app.config.json`; no client core pattern).

**Repos:** `sdkwork-api-cloud-gateway`, `sdkwork-webserver`, others identified in Step 0

**Tasks:**

1. Add/align `consumers/*.yaml` cargo fragments where applicable
2. Ensure `agent.app.config.json#sdkDependencies` is authoritative for backend
3. Remove any client-style composition artifacts if present
4. `verify-repo.mjs` with backend profile

**Gate Checklist:**

- [ ] No `dependency.composition.json` in type B repos
- [ ] Cargo `[workspace.dependencies]` centralized at repo root
- [ ] Verify profile passes per repo
- [ ] Evidence: `PLAN-20260629-step7-backend.md`

---

### Step 8 — Legacy / Non-standard Repos (type E)

**Objective:** Either bring to standard layout or explicitly isolate from registry.

**Repos:** `sdkwork-notes`, `magic-studio`, `claw-studio`, `magic-studio-v2`, others flagged in Step 0

**Tasks:**

1. Per repo decision recorded in ADR addendum or step evidence: **Restructure** or **Isolate**
2. Restructure: move under `apps/` standard layout, then apply type A/B rules
3. Isolate: exclude from `sync-workspace` consumers; document in `consumers/README.md` with reason

**Gate Checklist:**

- [ ] Every type E repo has written decision (Restructure | Isolate)
- [ ] No type E repo blocks workspace-wide zero-composition gate
- [ ] Evidence: `PLAN-20260629-step8-legacy.md`

---

### Step 9 — Workspace Closeout Audit

**Objective:** Prove global completion.

**Tasks:**

1. Run full workspace verification suite
2. Update `sdkwork-specs/README.md` and root `AGENTS.md` task matrix if needed
3. Update agent skills that reference composition (if any in workspace)
4. Mark plan Status = Completed

**Gate Checklist:**

- [ ] `rg dependency\.composition` workspace-wide → only historical evidence docs / git history
- [ ] `rg dependencyComposition` workspace-wide → zero in `component.spec.json`
- [ ] All type A/B/D repos in registry have `consumers/*.yaml`
- [ ] Spot-check 3 repos: sibling edit → dev HMR without publish
- [ ] Final evidence: `PLAN-20260629-step9-closeout.md`
- [ ] Plan Status updated to **Completed**

**Verification:**

```bash
cd sdkwork-space
rg "dependency\.composition" --glob "!**/.git/**" --glob "!**/docs/**/evidence/**"
find . -path "*/apps/*/pnpm-workspace.yaml" 2>/dev/null | wc -l   # expect 0
```

---

## 4. Progress Dashboard (update after each step)

**Current phase:** Completed — native composition architecture aligned workspace-wide (2026-06-29)

| Step | Name | Phase | Status | Completed Date | Evidence File |
| --- | --- | --- | --- | --- | --- |
| 0 | Baseline Audit | A | Completed | 2026-06-29 | `evidence/PLAN-20260629-step0-baseline.md` |
| 1 | Governance Foundation (`sdkwork-specs`) | A | Completed | 2026-06-29 | `evidence/PLAN-20260629-step1-evaluation.md` |
| 2 | Tooling Foundation (`sdkwork-specs`) | A | Completed | 2026-06-29 | `evidence/PLAN-20260629-step2-evaluation.md` |
| — | **Phase A gate** | A | Completed | 2026-06-29 | Step 1 + Step 2 evaluations |
| 3 | Pilot sdkwork-im | B | Completed | 2026-06-29 | `evidence/PLAN-20260629-step3-pilot-im.md` |
| 4 | Foundation Repos | B | Completed | 2026-06-29 | `evidence/PLAN-20260629-step4-foundation.md` |
| 5 | Client Wave 1 | B | Completed | 2026-06-29 | `evidence/PLAN-20260629-step5-client-wave1.md` |
| 6 | Client Wave 2 | B | Completed | 2026-06-29 | `evidence/PLAN-20260629-step6-client-wave2.md` |
| 7 | Backend Wave | B | Completed | 2026-06-29 | `evidence/PLAN-20260629-step7-backend.md` |
| 8 | Legacy Repos | B | Completed | 2026-06-29 | `evidence/PLAN-20260629-step8-legacy.md` |
| 9 | Closeout Audit | B | Completed | 2026-06-29 | `evidence/PLAN-20260629-step9-closeout.md` |

Status values: `Not Started` | `In Progress` | `Blocked` | `Gate Review` | `Completed`

## 5. Per-Repo Checklist (copy for each repo during Steps 3–7)

```markdown
### <repo-name>

- [ ] consumers/<repo>.yaml created/updated
- [ ] sync-workspace.mjs applied
- [ ] nested pnpm-workspace.yaml removed
- [ ] dependency.composition.json removed
- [ ] component.spec.json migrated (surface + cores)
- [ ] core composition TS/Dart imports updated
- [ ] core exports standardized
- [ ] bootstrap inventory derived from core
- [ ] pnpm verify pass
- [ ] dev smoke (if type A)
```

## 6. Blocked Step Protocol

When **Blocked**:

1. Record blocker in Progress Log with owner and required decision
2. Set step Status = `Blocked`
3. Do not start next step
4. Unblock only after written resolution in evidence file

## 7. Step Evaluation Template (required before advancing)

Copy into `sdkwork-specs/docs/engineering/plans/evidence/PLAN-20260629-step<N>-evaluation.md`:

```markdown
# Step <N> Evaluation

- Plan: PLAN-20260629
- Step: <N> — <name>
- Date:
- Evaluator:

## Gate Results

| Gate item | Pass/Fail | Evidence |
| --- | --- | --- |
| ... | | |

## Commands Run

\`\`\`bash
# paste commands and summarized output
\`\`\`

## Residual Risks

- None | <list>

## Decision

- [ ] **Advance to Step <N+1>**
- [ ] **Remain on Step <N>** — reason:

## Sign-off

Evaluator:
```

## 8. Progress Log

| Date | Step | Action | Result | Next |
| --- | --- | --- | --- | --- |
| 2026-06-29 | — | Plan created | Active | Step 0 Baseline Audit |
| 2026-06-29 | 0 | Baseline audit completed with evidence + evaluation | Gate passed | Step 1 Governance Foundation |
| 2026-06-29 | 1 | Started governance foundation updates (ADR, SOUL, composition spec replacement, normative reference cleanup) | In progress | Continue Step 1 spec convergence + gate evaluation |

---

## 9. Agent Execution Rules

When an agent works on this plan:

1. Read this file first.
2. Identify current step from Progress Dashboard (section 4).
3. Execute only tasks for the current step.
4. Produce evidence + Step Evaluation before marking step Completed.
5. Update sections 4 and 8 in this file when step completes.
6. Ask human only when Blocked protocol triggers or repo type E decision needed.
