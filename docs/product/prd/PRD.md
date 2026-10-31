# SDKWork Standards PRD

Status: active
Owner: SDKWork standards maintainers
Application: n/a
Updated: 2026-07-19
Specs: REQUIREMENTS_SPEC.md, DOCUMENTATION_SPEC.md, GOVERNANCE_SPEC.md

## 1. Background And Problem

SDKWork repositories need one canonical standards entrypoint. Without a shared documentation layout, product intent, technical boundaries, and engineering requirements fragment across ad hoc Markdown files and tribal knowledge.

## 2. Target Users

- SDKWork application and platform engineers
- Standards maintainers and reviewers
- Agents and automation that execute against repository standards

## 3. Goals And Non-Goals

Goals:

- Keep `sdkwork-specs` the single authoritative standards dictionary for SDKWork repositories.
- Provide a stable repository documentation layout with Canon PRD and technical architecture entrypoints.
- Make requirements, architecture decisions, guides, and release evidence discoverable and traceable.

Non-goals:

- Replacing root `*_SPEC.md` normative rules with local prose copies.
- Hosting application-specific product requirements for consumer repositories inside this standards repository.

## 4. Scope

- Root standards files (`*_SPEC.md`, `README.md`, `SOUL.md`, `AGENTS.md`)
- Executable validators under `tools/`
- Repository documentation layout rules in `DOCUMENTATION_SPEC.md`
- Governance, migration, and release evidence for standards changes

## 5. User Scenarios

- A new repository maintainer reads `docs/product/prd/PRD.md` and `docs/architecture/tech/TECH_ARCHITECTURE.md`, then follows `README.md` task matrix entries.
- A standards change author records a `REQ-*` requirement, updates affected specs, and adds verification in `tools/` or `TEST_SPEC.md`.

## 6. Success Metrics

- Every SDKWork repository can adopt the Canon documentation layout without inventing local directory schemes.
- Standards changes include traceable requirement, spec, test, and review evidence.
- Validators in `tools/` enforce the documented layout and prevent retired documentation paths from returning.

## 7. Phases

1. Canon documentation layout and validators in `sdkwork-specs`
2. Consumer repository migration to `docs/product/prd/PRD.md` and `docs/architecture/tech/TECH_ARCHITECTURE.md`
3. CI adoption through `check-repository-docs-standard.mjs`

## 8. Linked Requirements

- [REQ-2026-0719 Process-Shared Database Pools](../requirements/REQ-2026-0719-process-shared-database-pools.md)
- [REQ-2026-0720 Unified Development, Release, And Deployment Profiles](../requirements/REQ-2026-0720-unified-development-release-profiles.md)
- [REQ-2026-0724 PostgreSQL-First Database Contract](../requirements/REQ-2026-0724-postgresql-first-database-contract.md)
- [REQ-2026-1031 Pad Application Root Architecture](../requirements/REQ-2026-1031-pad-application-root-architecture.md)
- Add `REQ-*` records under [../requirements/](../requirements/) for future standards changes.

## 9. Open Questions

- None for the initial Canon documentation layout release.
