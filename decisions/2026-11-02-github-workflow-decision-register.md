# GitHub Workflow Decision Register

Status: open decisions with a default each

This register holds the product decisions the workflow standard cannot make for an
application owner. Each entry names the default the framework recommends, the
owner who must confirm it, and the effect of confirming it. A decided entry moves
to `docs/decisions/` (or an ADR in the owning repository) and the corresponding
exception register entry (`.github-workflow-exceptions.json`) is deleted in the
same change.

Format: `PDR-<n>` · status · owner · decision · consequence · follow-up.

## PDR-001 — Fill placeholder packaging contracts from the application manifest

- **Status:** recommended default, awaiting owner confirmation per repository.
- **Owner:** each application owner (26 repositories).
- **Context:** these configurations declare `targets: {}` while
  `agent.app.config.json` already lists the shipped package ids, formats, and
  runtime targets; the workflow cannot package until the two agree.
- **Default decision:** generate the targets from the manifest — canonical
  package id, deployment profile, runtime target, package format, architecture,
  and profile binding — then use the mode starter's runner and output globs.
  Regenerate with
  `node ../sdkwork-github-workflow/scripts/agent-workflow.mjs init-app --runtime-targets <csv>`
  when a repository has no manifest packages.
- **Consequence:** the repository gains a planner-valid package contract in one
  commit; the only owner review is the output globs, which the mode starter sets
  to its conventional path.
- **Follow-up:** confirm the globs in the pull request; delete the repository's
  entry from the exception register if it had one.

## PDR-002 — Produce SBOM evidence through `ci.setup`

- **Status:** recommended default.
- **Owner:** security/release owner per repository.
- **Context:** several configurations require an SBOM (`security.sbomRequired`)
  without a `lifecycle.sbom` phase, so the planner rejects them.
- **Default decision:** keep `sbomRequired: true` and declare a `ci.setup` step
  that installs syft (or the repository's generator) and a `lifecycle.sbom` step
  that writes SPDX into the artifact directory.
- **Consequence:** evidence is produced by the same pipeline that packages;
  no policy is weakened to make the planner pass.
- **Alternative:** set `sbomRequired: false` with an explicit release-policy
  exception — acceptable only with the security owner's signed-off note.

## PDR-003 — Add a Rust verification profile to the framework

- **Status:** recommended default.
- **Owner:** framework owner.
- **Context:** Rust-only repositories (for example `sdkwork-rpc-framework`) have
  no `package.json`, so their cargo gates cannot become package scripts.
- **Default decision:** publish a reusable `sdkwork-ci-rust.yml` alongside
  `sdkwork-ci.yml` that runs `cargo fmt --check`, `cargo clippy -- -D warnings`,
  and `cargo test`, driven by `toolchains.rust`; the application's `verify.yml`
  calls it with `config_path`.
- **Consequence:** one more reusable workflow, no bespoke CI YAML; the entrypoint
  contract (§2.1) extends to a second reusable file with the same thin-caller
  rule.

## PDR-004 — Map `sdkwork-agentstudio` targets to the mode matrix

- **Status:** awaiting owner confirmation.
- **Owner:** agentstudio owner.
- **Context:** the legacy configuration lacks ids, runners, and output globs for
  five targets (web bundle, Windows desktop, macOS desktop, tray, and a fourth
  bundle variant).
- **Default decision:** web bundle → `browser`/`web`/`zip` on `ubuntu-24.04`;
  Windows desktop → `desktop`/`windows`/`msi` on `windows-2022`; macOS desktop →
  `desktop`/`macos`/`dmg` on `macos-14`; tray → part of the desktop target's
  output globs rather than a separate package; the remaining bundle follows the
  same platform/format table.
- **Follow-up:** once confirmed, regenerate the configuration and retire the
  exception entry.

## PDR-005 — Migrate legacy release pipelines into lifecycle phases

- **Status:** recommended default, ordered by risk.
- **Owner:** `sdkwork-terminal`, `sdkwork-codebox`, `sdkwork-dsh-bot`, `sdkwork-tts`.
- **Context:** these repositories keep bespoke release workflows that duplicate
  the framework's packaging, upload, or update-metadata logic.
- **Default decision and order:** (1) `sdkwork-terminal` — declare its Rust CLI
  targets and move build/publish into `lifecycle.package` + `lifecycle.publish`,
  then replace the local reusable release workflow with the framework caller;
  (2) `sdkwork-dsh-bot` — add a `verify` script and migrate verification first,
  packaging second; (3) `sdkwork-tts` — declare `workflowRole: ci-only` plus
  `ci.setup` while its packaging contract is decided; (4) `sdkwork-codebox` —
  move the Tauri build, signing, and `latest.json` assembly into lifecycle
  phases last, because it carries multi-OS signing.
- **Consequence:** four exception entries disappear; each migration is a normal
  pull request against that repository with the framework as the only pipeline.
- **Alternative:** keep a documented, time-boxed exception with a renewed expiry
  date — never an indefinite waiver.

## Delivery status (2026-11-02)

| Decision | Status | Evidence |
|---|---|---|
| PDR-001 placeholder/legacy contracts | **done** | Targets derived from each repository's `agent.app.config.json`; every application configuration now passes `agent-workflow.mjs validate` (84/84). |
| PDR-002 SBOM lifecycle | **done** | `ci.setup` installs syft and `lifecycle.sbom` writes SPDX for every configuration that sets `security.sbomRequired`. |
| PDR-003 Rust verification profile | **done** | `sdkwork-ci-rust.yml` + `templates/app-verify-rust.workflow.yml`; `sdkwork-rpc-framework` and `sdkwork-tts` migrated, their register entries deleted. |
| PDR-004 agentstudio targets | **partial** | Configuration rebuilt and planner-valid; the desktop release pipeline migration remains as register entry WF-013. |
| PDR-005 legacy release pipelines | **partial** | Remaining register entries: `sdkwork-agentstudio` (WF-013), `sdkwork-codebox` (WF-010), `sdkwork-terminal` (WF-011), `sdkwork-dsh-bot` (WF-004). |

Residual work is recorded in `../tools/github-workflow-exceptions.json` with an
owner, a register id, and an expiry date; the workspace audit reports it as
`tracked` and will fail once an entry expires.
