# Quality Gate Standard

- Version: 1.1
- Scope: definition of ready, definition of done, merge gates, release gates, gate wiring, evidence bundles, exceptions
- Related: `REQUIREMENTS_SPEC.md`, `ARCHITECTURE_DECISION_SPEC.md`, `ENGINEERING_WORKFLOW_SPEC.md`, `CODE_REVIEW_SPEC.md`, `RELEASE_SPEC.md`, `MIGRATION_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `COMPOSABLE_ARCHITECTURE_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_PERMISSION_COMPOSITION_SPEC.md`, `API_SPEC.md`, `RPC_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, `SDK_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `PERFORMANCE_SPEC.md`, `OBSERVABILITY_SPEC.md`, `TEST_SPEC.md`, `GOVERNANCE_SPEC.md`

This standard defines when SDKWork work is allowed to start, merge, and release.

## 1. Gate Model

SDKWork uses four quality gates:

| Gate | Purpose |
| --- | --- |
| Ready | work is clear enough to implement |
| Merge | source change is safe to integrate |
| Release | artifact or deployment is safe to ship |
| Exception | controlled deviation with owner and expiry |

Rules:

- Passing tests alone is not enough when requirements, architecture, migration, release, security, or documentation evidence is missing.
- A gate must name evidence, not confidence.
- Gate exceptions follow `GOVERNANCE_SPEC.md`.

### 1.1 Gate Wiring Contract

A gate that no one executes is not a control; it is prose. Every spec that requires a verification step `MUST` name the entry point that executes it.

- **Reachability.** A gate `MUST` be reachable from the workspace gate registry — a `check:*` or `test:*` script in the `@sdkwork/workspace-root` `package.json` — or explicitly registered in `sdkwork-specs/gates.manifest.json` with a recorded baseline. A gate that is reachable from neither is unenforced and `MUST` be reported as such rather than assumed to hold.
- **Fail closed.** A gate pointed at a nonexistent, misspelled, or empty root `MUST` exit non-zero. Reporting success after examining zero files is prohibited: it occupies a contract slot while checking nothing, which is worse than being unwired because it manufactures confidence. A gate `MUST` state how many units it examined so vacuous passes are visible.
- **No hardcoded targets.** A gate that asserts one fixed repository `MUST` declare itself as such (registry scope `fixed`) and `MUST NOT` be described as workspace-wide or fleet coverage.
- **Measurement.** `check:all` joins gates with `&&` and therefore stops at the first failure: it records the contract but cannot answer how many gates are red. Regression measurement `MUST` use `pnpm run check:matrix`, which runs every gate in its own process, reports per-gate exit codes and item counts, and compares guardrail gates against their recorded baseline in `sdkwork-specs/gates.manifest.json`. A baseline `MUST` be produced by the counter the matrix itself compares against, never by hand or by re-implementing the count in a second tool: `node tools/measure-gate-items.mjs <tool-file> [args...]` refreshes one gate's number without paying for the whole tier. A gate that crashed `MUST NOT` be recorded as a baseline — a stack trace is not a debt count.
- **Debt may only shrink.** A guardrail baseline is a debt ceiling. Lowering it is expected whenever debt is paid down; raising it requires an explicit recorded decision.

Gap found 2026-09-11: of 79 fleet gates, 20 were wired in no repository and no root script — including the pattern audit that `DESTRUCTIVE_OPERATION_SPEC.md` section 9 already mandated, whose first fleet run immediately reported three violations that had been present unobserved (a `find ... -exec rm -rf`, a `find -delete`, and a wildcard `rm`). Two of the twenty additionally ignored every root argument and asserted a hardcoded target, so they could never have provided fleet coverage; three were fail-open and reported success after examining nothing. The gates that *are* wired — including the `check-i18n-standard` rule enforcing the retired `X-SdkWork-Locale` header in favour of `Accept-Language` — were confirmed green and are the reason that retirement has held. Evidence: `sdkwork-cloudrouter/docs/audit/WORKSPACE-ALIGNMENT-REGRESSION-2026-09-11.md` section 5.

## 2. Definition Of Ready

Work is ready only when:

- Requirement or task source is clear.
- Affected repository, app, component, API authority, SDK family, data owner, and release target are known when relevant.
- Relevant root specs are identified.
- Acceptance criteria and non-goals are explicit.
- Architecture decisions, migration plans, release plans, and security/privacy review needs are known.
- Verification commands or review evidence are planned.

## 3. Definition Of Done

Work is done only when:

- Acceptance criteria are satisfied.
- Relevant tests, static scans, build/typecheck, generated SDK checks, config checks, and documentation checks have been run or explicitly marked not applicable.
- Review findings are resolved.
- Required ADRs, migration notes, release notes, changelog entries, and runbooks are updated.
- No generated output was hand-edited.
- Completion evidence records commands, outcomes, gaps, and residual risk.

## 4. Merge Gate

Merge gate evidence should include:

- requirement or task reference.
- changed component/package list.
- spec checklist.
- verification command output.
- review approval.
- security/privacy impact result.
- migration and compatibility result when relevant.
- generated artifact provenance when generated inputs changed.

Rules:

- Public API/RPC/SDK/database/config changes require contract verification.
- Authoritative database changes require real PostgreSQL migration, repository, constraint, transaction/concurrency, query-plan, role/search-path, and recovery evidence. SQLite-only evidence is a blocking failure for server persistence.
- SQLite changes require a declared `client-local` manifest and separate local-data isolation, security, migration recovery, purge, and sync/conflict evidence; an authoritative or mixed-role SQLite manifest is a blocking failure.
- UI architecture changes require package placement and SDK boundary verification.
- Composable module, dependency SDK, route, permission, frontend package, or Rust backend composition changes `MUST` include applicable `COMPOSABLE_ARCHITECTURE_SPEC.md` closure evidence: `check-component-port-bindings.mjs`, `check-frontend-composition.mjs`, `check-rust-backend-composition.mjs`, `check-permission-composition.mjs`, `check-route-path-collisions.mjs`, `resolve-composition.mjs --write`, `check-composition-resolver.mjs`, and `verify-repo.mjs`.
- Merge evidence `MUST` name every closure-matrix row that is not applicable. Silence is not evidence for skipping login/session, permissions, route ownership, API input/output, frontend package, Rust crate, or resolved composition checks.
- Security-sensitive changes require negative tests or static scans.
- Database-owning repositories with organization-scoped data require a zero-threshold static SQL isolation gate plus negative tenant/organization repository tests. Approved cross-organization operations require exact machine-contract, authorization, bounded-execution, and audit evidence.
- Root standard changes require README/index and `TEST_SPEC.md` updates when executable behavior changes.

## 5. Release Gate

Release gate evidence should include:

- manifest active/supported deployment profile, fixed/runtime-configurable
  package binding, runtime target, target platform, client architecture, and
  package target validation.
- application mode matrix coverage for every browser, desktop, server,
  container/Docker-compatible, mobile, tablet, mini program, or test-runner
  artifact in the release.
- version and changelog evidence.
- build artifact checksums.
- signing evidence when required.
- SBOM and provenance evidence when required.
- migration readiness and rollback path.
- PostgreSQL authoritative database evidence: supported major version/extensions, migration lock/rewrite/backfill plan, drift, representative query plans, least-privilege roles, connection budget, backup/restore exercise, RPO/RTO, and no server SQLite fallback.
- Client-local SQLite evidence when applicable: role-specific contract, file/profile/account isolation, encryption/key policy, migration/corruption/disk-full recovery, purge, and offline reconciliation.
- deployment/rollout plan that names `standalone` or `cloud` and the affected
  runtime targets.
- immutable artifact identity and independent publish/deploy/rollback evidence
  for every selected standalone or cloud release lane.
- API assembly evidence proving every application-owned app/backend/open route
  is assembled exactly once, gateway hosts are thin, and application roots
  have zero `sdkwork-api-cloud-gateway` ownership/operation findings and zero
  `integration.foundationApiGateway` parallel contracts.
- API hosting integration evidence includes
  `audit-gateway-alignment-repo.mjs --root . --strict`; successful assembly
  bootstrap alone is not standalone-host or cloud-composition completion.
- shared lifecycle framework evidence proving public pnpm scripts are thin
  aliases, application-specific work is isolated under `_sdkwork:*` hooks, and
  `sdkwork-app-topology`, `sdkwork-github-workflow`, and `deployctl` versions are
  pinned or otherwise reproducibly resolved.
- deploy manifest v2 typed dimensions and explicit profile/environment,
  artifact digest, artifact evidence, approval, and rollback target for
  side-effecting jobs. Evidence must bind the selected package, profile,
  checksum, SBOM, provenance, and signature.
- installed-client profile/origin credential and mutable-state isolation tests
  when a signed client supports both profiles.
- smoke test and monitoring plan.
- owner approval for production or customer-impacting releases.

Rules:

- Release gate follows `RELEASE_SPEC.md`.
- Supply-chain evidence follows `SUPPLY_CHAIN_SECURITY_SPEC.md`.
- Pre-launch release gates `MUST` block pagination and HTTP operation-pattern technical debt. The evidence bundle must show `node <sdkwork-specs>/tools/check-pagination.mjs --workspace <workspace-root>`, `node <sdkwork-specs>/tools/check-api-operation-patterns.mjs --workspace <workspace-root>`, and `node <sdkwork-specs>/tools/check-api-response-envelope.mjs --workspace <workspace-root>` passing without `--allow-known-debt`, and any pagination or operation-pattern debt register must be empty.
- Pre-launch and commercial release gates for composable applications `MUST` block unresolved building-block architecture debt. The evidence bundle must show all applicable composition validators passing without known-debt allowance: `check-component-port-bindings.mjs`, `check-frontend-composition.mjs`, `check-rust-backend-composition.mjs`, `check-permission-composition.mjs`, `check-route-path-collisions.mjs`, `resolve-composition.mjs --write`, `check-composition-resolver.mjs`, and `verify-repo.mjs`.
- Pre-launch and commercial release gates `MUST` block every unresolved tenant/organization SQL isolation violation. Marker-only bypasses, unknown cross-organization operations, and allow-known-debt thresholds are forbidden release evidence.
- Release evidence for SDKWork-owned list/search APIs `MUST NOT` contain HTTP query aliases (`pageSize`, `limit`, `page_no`, `pageNo`, `per_page`, `size`), numeric cursor offsets, in-process pagination, client-side `slice` pagination, or missing `PageInfo.mode`.
- Release evidence for SDKWork-owned create/update/delete/search/command/bulk APIs `MUST NOT` contain create `200` success, delete JSON success bodies, command `accepted: false` success bodies, `batch_*` URL aliases, or frontend/local SDK aliases that bypass generated SDK operation methods.
- Release evidence for route and URL composition `MUST NOT` contain duplicate normalized `(surface, method, path)` ownership, generic capability paths such as `/status`, `/health`, `/ready`, `/system/health`, or `/system/ready`, or dependency-owned paths copied into application-owned route authorities.
- Workflow automation follows `GITHUB_WORKFLOW_SPEC.md`.
- Side-effecting publication, apply, and rollback gates `MUST` reject an
  implicit deployment profile, missing lifecycle environment, mutable-only
  artifact reference, or absent rollback/forward-fix target before protected
  credentials are acquired.

## 6. Risk Levels

| Risk | Gate expectation |
| --- | --- |
| Low | targeted verification and owner review |
| Medium | tests plus review |
| High | tests, static checks, owner review, docs, rollback notes |
| Critical | governance approval, migration/release plan, security/privacy review, production evidence |

Risk is high or critical when work touches authentication, authorization,
tenant isolation, generated SDK ownership, database migrations, public APIs,
release artifacts, deployment profile/topology, root standards, or
cross-repository behavior.

Additional RPC SDK risk mapping:

- Public RPC SDK generation changes are High risk.
- Streaming RPC, auth metadata changes, package naming changes, or generator-owned output boundary changes are Critical risk.
- RPC SDK generator changes must include HTTP/OpenAPI SDK non-regression evidence before merge.

## 7. Acceptance Checklist

- [ ] Ready gate was satisfied before implementation.
- [ ] Merge gate has evidence, not assumptions.
- [ ] Release gate is satisfied when artifacts or deployments are produced.
- [ ] Composable architecture closure evidence is present for every touched login/session, permission, frontend, Rust backend, route, API, and resolved composition concern.
- [ ] Exceptions have owner, expiry, risk, and removal plan.
- [ ] Completion evidence records commands and outcomes.
