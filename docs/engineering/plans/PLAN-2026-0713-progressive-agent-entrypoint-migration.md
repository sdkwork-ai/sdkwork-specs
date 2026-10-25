# PLAN-2026-0713 Progressive Agent Entrypoint Migration

Status: in-progress
Requirement: [REQ-2026-0713](../../product/requirements/REQ-2026-0713-progressive-agent-entrypoints.md)

## Scope

The migration covers the workspace root, direct SDKWork git repositories, and
independent application roots identified by `agent.app.config.json`. It does
not recursively adopt vendored, external, generated, fixture, runtime, or
user-modified paths.

## Execution

1. Discover managed targets and record each target's repository root, kind,
   relative `sdkwork-specs` path, entrypoint path, and dirty-file status.
2. Add a standards-owned, manifest-scoped audit and alignment workflow with a
   deterministic dry-run mode and target-level error reporting.
3. Apply the progressive-loading route to clean workspace, repository, and
   application entrypoints while preserving local sections and canonical
   excerpts.
4. Create a minimal compliant entrypoint only for a managed application root
   that lacks one; do not infer module roots from arbitrary nested directories.
5. Validate each migrated target, inspect each repository diff, and record
   owner-facing exceptions for dirty, ambiguous, or non-standard paths.
6. Run broad workspace evidence only after target-level validation succeeds.

## Rollback And Recovery

- Dry-run before every write wave.
- Limit every write to a manifest target with a resolved repository owner.
- Do not overwrite dirty entrypoints.
- Revert an individual target through that target repository's git history if a
  local owner rejects the routing update.
- Keep the tool idempotent so an interrupted wave can resume from its manifest
  and exception report.

## Evidence

- Target manifest and dry-run summary.
- Tool unit tests and target-level validator output.
- Per-repository changed-file and clean/dirty reports.
- Final residual-debt and human-review list.
