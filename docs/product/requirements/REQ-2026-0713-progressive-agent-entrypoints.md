# REQ-2026-0713 Progressive Agent Entrypoint Migration

Status: in-progress
Owner: SDKWork platform
Source: governance

## Problem

SDKWork-managed workspace, repository, and application `AGENTS.md` files have
inconsistent progressive-loading guidance. Some entrypoints still direct agents
to read broad dictionaries, full README indexes, or large command catalogs
before the task boundary is known. Recursive workspace scans also include
third-party, generated, fixture, and runtime paths that are not SDKWork-owned
entrypoints.

## Goals

- Give every managed workspace root, git repository root, and independent
  application root a task-scoped progressive-loading route.
- Preserve existing global API, SDK, pagination, permission, security, release,
  and local repository rules; this migration changes entrypoint routing only.
- Keep third-party, generated, fixture, runtime, and user-modified paths out of
  automated writes.
- Make target discovery, alignment, verification, exceptions, and evidence
  repeatable from `sdkwork-specs`.

## Non-Goals

- Do not alter domain, API, SDK, persistence, security, release, or deployment
  contracts.
- Do not rewrite vendor or upstream `AGENTS.md` files below `external/`,
  `vendor/`, third-party, generated, fixture, or runtime trees.
- Do not replace repository-local instructions that narrow global rules without
  first preserving their ownership and relative-path boundaries.
- Do not overwrite an already modified `AGENTS.md`; record it as an exception
  for owner resolution.

## Acceptance Criteria

- Managed targets are discovered from the workspace root, direct SDKWork git
  repositories, and non-excluded `agent.app.config.json` application roots.
- Each managed target has an `AGENTS.md` that resolves its relative
  `sdkwork-specs` authority and includes the progressive-loading route.
- The route distinguishes path discovery from content loading, reads only the
  relevant README task-matrix entry, loads local identity/contracts/skills only
  when applicable, and selects the narrowest verification first.
- Existing task-specific canonical excerpts and repository-local rules remain
  intact unless an authoritative global requirement makes them obsolete.
- Alignment skips dirty entrypoints, reports the skipped paths, and leaves
  unrelated changes untouched.
- A manifest-scoped audit and validator pass for every migrated target, with
  target-level evidence and an explicit residual-debt list.

## Non-Functional Requirements

- Security: none beyond root standards; no credentials or runtime state may be
  read into or written by the migration.
- Privacy: no customer or user data is in scope.
- Performance: target discovery and validation must avoid recursive scans of
  excluded dependency and generated trees.
- Reliability: repeated dry-runs must be deterministic; writes must be
  idempotent and limited to managed entrypoints.

## Affected Surfaces

- workspace governance
- repository and application agent entrypoints
- standards-owned validation and alignment tooling
- standards documentation and review evidence

## Trace

Specs:

- `SOUL.md`
- `AGENTS_SPEC.md`
- `SDKWORK_WORKSPACE_SPEC.md`
- `DOCUMENTATION_SPEC.md`
- `TEST_SPEC.md`
- `GOVERNANCE_SPEC.md`
- `ENGINEERING_WORKFLOW_SPEC.md`
- `QUALITY_GATE_SPEC.md`
- `CODE_REVIEW_SPEC.md`

## Verification

- Manifest-scoped dry-run and write-mode reports.
- Target-level progressive-loading validation.
- Existing agent-entrypoint and repository-documentation validators for each
  affected repository or application root where applicable.
- Focused tests for the standards-owned alignment and validation tooling.
- Workspace inventory and dirty-file exception report.
