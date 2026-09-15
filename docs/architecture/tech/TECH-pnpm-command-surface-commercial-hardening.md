# TECH-pnpm-command-surface-commercial-hardening

- Version: 1.1
- Status: Implemented
- Canon shard for: `PNPM_SCRIPT_SPEC.md`
- Related: `DESKTOP_APP_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `RELEASE_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `PNPM_WORKSPACE_DEPENDENCY_SPEC.md`, `tools/check-pnpm-script-standard.mjs`

## 1. Scope

`PNPM_SCRIPT_SPEC.md` stayed at v1.0 through three architecture waves
(native mobile roots, PC desktop host profiles, H5 Capacitor platform
profiles). Each wave added commands to the architecture standards while the
command-name standard grew only by suffix-level patches, so the two drifted.
This shard records the audit that found the drift, the four decisions that
closed it, and the debt that remains.

## 2. Audit findings

Measured against the whole workspace (100 repository-root `package.json`
files) and against the architecture standards.

| # | Finding | Evidence |
| --- | --- | --- |
| F1 | The browser build environment-alias enum disagreed with its own checker | `PNPM_SCRIPT_SPEC.md` §5 listed four aliases; `check-pnpm-script-standard.mjs` accepted five. §4.2 body already documented `demo`, so the §5 enum was the incomplete side. |
| F2 | The desktop host family axis list disagreed with §4.1 and its checker | §4.1.1 documented `development/staging/prod/local`; the checker carried `production` as well, and neither side listed `test` or `demo`. |
| F3 | Seven namespaces were pure whitelist entries with no contract | `nginx`, `perf`, `migrate`, `models`, `downloads`, `skills`, and `app-store` each appeared **only** inside the allowed-first-segment fence — no rule, no scope, no axis limit anywhere in the spec. `app-store:<anything>` passed. |
| F4 | Commercial distribution had zero command vocabulary | `notarize`, `codesign`, `archive`, `installer`, `testflight`, `aab`, `msi`, `dmg`, `appimage`, `submit`, `attest`, and `provenance` each occurred **0** times in the spec. `release:publish` was one sentence: "registers or uploads validated artifacts". |
| F5 | The PC three-host wave left `check:*-config` commands ungoverned | `check:tauri-config`, `check:electron-config`, and `check:capacitor-config[:ios|:android]` are normative in `DESKTOP_APP_ARCHITECTURE_SPEC.md` and `APP_H5_ARCHITECTURE_SPEC.md`, but the command standard never named them. |
| F6 | Generated native host projects were audited as SDKWork-authored scripts | `IGNORED_DIRS` held no `src-tauri/`, `electron/`, `ios/`, `android/`, or `CapacitorApp/`. The approved Capacitor Electron provider scaffolds `electron/package.json` with upstream-tool script names, so the gate would report violations against a file nobody may edit. |
| F7 | pnpm runtime and dependency-install policy had zero coverage | `packageManager`, `corepack`, `frozen-lockfile`, `lockfile`, `npmrc`, `onlyBuiltDependencies`, `ignore-scripts`, and `engines` each occurred **0** times. The standard governed command names but not the manager those names run under. |
| F8 | A release-lane helper name shadowed a lifecycle phase | `release:sign-installers` reads as either phase `sign` or helper `sign-installers`; automation cannot tell which. |
| F9 | A tool-namespace action encoded process history | `perf:materialize-step-11-capacity-evidence` and `perf:refresh-step-11-capacity-evidence-index` name a sprint step in a script that is meant to outlive the sprint. |

## 3. Decisions

**D1 — Two parallel host families under one parent.** §4.1 became `Host
Families` with `§4.1.1 Desktop Host Family` (unchanged grammar) and `§4.1.2
Mobile Host Family` (new). `mobile:<action>[:<platform>][:<deploymentProfile>]`
mirrors `desktop:<action>[:<host>][:<deploymentProfile>]`; the platform axis is
`ios`, `ipados`, or `android`.

The family is deliberately **not** a per-platform package split. Capacitor's own
model is one host project serving several platform directories, which is why
`-h5-capacitor` stays a single package (see
`TECH-h5-capacitor-platform-profiles-design.md`). A root owning more than one
mobile host `MUST NOT` expose the family, because a single omitted axis value
can no longer identify the host; such roots keep action-first runtime-target
names.

**D2 — Commercial distribution is a release phase, not a new namespace.**
`release:sign`, `release:notarize`, and `release:submit` joined the release
phase set in §8, keeping the existing grammar
`release:<phase>[:runtimeTarget]:<deploymentProfile>` (or
`:runtime-configurable`). The store lane, track, and rollout percentage are
deployment inputs selected by flags or declared store configuration — never
script-name segments — because §5 forbids process-layout values in public names.

Signing key custody, decoded-material handling, and per-runtime-target evidence
obligations were **not** restated: `SUPPLY_CHAIN_SECURITY_SPEC.md` §5 and §5.1
own them, and artifact formats and package ids stay with
`GITHUB_WORKFLOW_SPEC.md` §5. This standard contributes only the command
vocabulary that reaches those rules.

**D3 — `app-store:*` is the catalog namespace, not a store lane.** This
corrects the premise the change was originally scoped under. `app-store:seed:check`,
`app-store:seed:update`, and `app-store:update-create` already exist in
`sdkwork-agentstudio`, `sdkwork-cloudrouter`, and `sdkwork-notes`, where
`app-store` means the SDKWork application-store catalog. Defining
`app-store:*` as Apple/Google store submission would have created a same-name
collision. §4 therefore defines `app-store:*` as the catalog namespace and
states explicitly that third-party store submission is `release:submit`.

**D4 — §4.5 Tool Namespace Contracts.** Every tool namespace now carries an
owning authority, a purpose, and a normative action vocabulary, enumerated from
the complete workspace scan rather than invented. The gate enforces one rule
from it: a tool namespace's second segment is an action, never a deployment
profile, runtime target, or database alias.

Quality tiers and environment aliases were **excluded** from that forbidden set
on purpose. `docs:dev`, `docs:check`, `docs:debug`, and `sbom:check` are real
scripts whose action token collides with an axis vocabulary; rejecting them
would gate real commands with no replacement, and an unactionable gate stops
being read.

## 4. Landed touchpoints

| File | Change |
| --- | --- |
| `PNPM_SCRIPT_SPEC.md` | v1.1. §3 capability row; §4 host-family, tool-namespace, and phase-shadow rules; **§4.1 retitled with §4.1.1/§4.1.2**; **§4.5 Tool Namespace Contracts (new)**; §5 `demo` alias, mobile platform axes, build variants; §8 distribution phases and their rules; §10 new validated surfaces; **§12 pnpm Runtime And Dependency Policy (new)**; §13 checklist (`+7` items). |
| `tools/check-pnpm-script-standard.mjs` | `mobile` first segment; `RELEASE_PHASES` + `sign`/`notarize`/`submit`; `HOST_FAMILIES` registry replacing the desktop-only predicate; `pushHostFamilyIssues`; `pushToolNamespaceIssues`; `pushReleasePhaseModifierIssues`; generated native host directories in `IGNORED_DIRS`; new sets exported for the mirror tests. |
| `tools/check-pnpm-script-standard.test.mjs` | 8 new tests: release-phase mirror, environment-alias mirror, mobile family accept/reject, tool-namespace axis-first accept/reject, phase-shadowing, distribution grammar, generated-host-directory scope. |
| `tools/align-app-release-deploy-facade.mjs`, `tools/audit-pnpm-lifecycle-framework.mjs` | Release phase sets aligned to §8 so the three tools cannot disagree about what a phase is. |
| `README.md` | Spec index row; three new task-matrix rows (store submission, pnpm runtime pinning, tool namespace / host family). |
| `AGENTS.md` | Task-matrix row extended to cover host-family commands and the runtime policy. |
| `DESKTOP_APP_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md` | Host-family pointer corrected to §4.1.1; H5 records the `mobile:*` alias and the single-mobile-host precondition. |

## 5. Corrections Recorded

Two premises held at the start of this work were wrong and are corrected here,
not silently dropped.

**The release phase list is not the release phase vocabulary.** A gate requiring
`release:<phase>` to be an exact phase name was drafted and then rejected: the
workspace has **28** `release:<verb-phrase>` scripts (`release:assert-ready`,
`release:sbom-evidence`, `release:verify-packed-install`, ...). Free-form
release-lane helpers are an established, valid shape. The rule that survives is
narrow: a helper must not begin with a phase name plus `-`.

**`release:sign` already existed.** `sdkwork-memory` exposes
`release:sign` → `scripts/release/workflow-supply-chain-evidence.mjs sign`, so
the new phase matched reality rather than inventing it.

The mirror test added for §8 immediately caught a third drift: the spec's phase
fence listed `release:package:check` among bare phases, while the checker's set
holds phase tokens only. `release:package:check` is real and widespread
(`sdkwork-canvas`, `sdkwork-cloudrouter`, `sdkwork-im`, `sdkwork-settings`), so
the fence was corrected to phase tokens and the `:check` detail form documented
as the lifecycle's only phase-detail form.

## 6. Remaining Debt

Recorded, deliberately not forced into a gate this turn.

| Item | Count | Why not gated |
| --- | --- | --- |
| Root `package.json` without `packageManager` | 21 of 100 | A gate would turn 21 repositories red on day one for a policy whose baseline is not yet aligned. §12 states the rule and marks per-repository enforcement as a declared follow-up. |
| Root without `pnpm-lock.yaml` | 22 of 100 | Same roll-out reason. |
| `pnpm-workspace.yaml` without `onlyBuiltDependencies` | 100 of 100 | pnpm blocks unreviewed dependency build scripts by default; every repository currently relies on that default rather than an explicit approval list. |
| `release:sign-installers` (`sdkwork-video-cut`) | 1 | Gated. Migration: `release:sign:<runtimeTarget>`. |
| `release:package-sbom` | 1 | Gated. Migration: `release:package:sbom` or `release:sbom-evidence`. |
| `perf:materialize-step-11-*`, `perf:refresh-step-11-*` | 2 | Not gated: the replacement suite id is the owner's call, so the gate could not offer a mechanical fix. §4.5 states the rule. |
| `build:sidecar:release` (`sdkwork-video-cut`) | 1 | Not gated: `sidecar` is a real Tauri build sub-surface, not a runtime target, and tightening the build axis first requires a declared sub-surface vocabulary. |
| `test:*` axis values are wholly free-form | ~thousands | Not gated, and `instrumented` was not added to `QUALITY_TIERS` on speculation; the architecture standards mention it but no repository uses it. |

## 7. Verification

```bash
node --test tools/check-pnpm-script-standard.test.mjs
node --test tools/align-app-release-deploy-facade.test.mjs tools/audit-pnpm-lifecycle-framework.test.mjs
node tools/check-repository-docs-standard.mjs --root .
```

Full-suite result at landing: **990 tests, 956 pass, 34 fail**, with the failure
set byte-identical to the pre-change baseline. The 34 are environmental
(`yaml` not installed in a sibling checkout, tools defaulting to a workspace
path that moved from `E:` to `D:`, temporary worktrees rejected as outside the
declared workspace).
