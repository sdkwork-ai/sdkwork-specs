# ADR: SDK Family Manifest As The Single Metadata Authority

- Status: Accepted, requires human review before merge
- Date: 2026-07-16
- Scope: SDK family discovery, generation metadata, application SDK composition, workspace validation
- Supersedes: the legacy parallel SDK registry at family, application, and repository SDK roots

## Context

SDKWork had two overlapping metadata authorities for generated SDK families. Family-root
`sdk-manifest.json` already carried naming, ownership, generation, discovery, dependency, and
language layout data, while a legacy parallel registry repeated some or all of the same fields.
Some repositories also used a repository-level `surfaces[]` registry to orchestrate multiple
families. The duplicated model produced drift, extra files, stale readers, and generators that
could recreate a retired artifact after it was deleted.

## Decision

1. `sdks/<sdkFamily>/sdk-manifest.json` is the only SDK family metadata authority.
2. Multi-family generation discovers family manifests directly from the `sdks/` directory.
3. Application dependency composition uses existing `agent.app.config.json`, package manifests,
   and `specs/component.spec.json` contracts.
4. No family, application, or repository SDK root may keep a parallel SDK registry.
5. Standard validation reports the removed file as a hard violation. `--fix` does not merge,
   recreate, or silently delete it.
6. Generated transport metadata remains generator-owned and is not used as the family authority.

## Consequences

- Generators and validators must read and update `sdk-manifest.json` without dropping existing
  naming, discovery, dependency, language, or composed-facade fields.
- Repositories that previously orchestrated `surfaces[]` must derive plans from family manifests.
- H5, Flutter, and other consuming applications declare SDK dependencies through existing app,
  component, and native package manifests.
- Historical design documents may describe the retired model, but active code, tests, current
  documentation, skills, and component contracts must not depend on it.

## Alternatives Rejected

1. Keep a repository-level exception for multi-family generation: rejected because it preserves a
   second authority and encourages new special cases.
2. Rename the registry and retain the same schema: rejected because it changes the filename but
   not the duplication.
3. Let standard tooling merge legacy files indefinitely: rejected because compatibility code would
   continue to recreate and legitimize the retired convention.

## Verification

- Workspace file scan reports zero removed registry files.
- Active source and current-contract scan reports zero legacy filename references.
- All family and component JSON contracts parse successfully.
- SDK standard checks pass for SDKWork Specs, Agents, Drive, IM, and BirdCoder.
- BirdCoder manifest discovery, IM authority, CloudRouter guardian/standardizer, Kernel structure,
  and SDK integration skill contract tests pass.

## Review And Rollback

Human review is required before merge because this changes global SDK standards and generation
contracts across repositories. Rollback must restore the previous standard, readers, writers, and
files together; restoring only the files would reintroduce dual authority and is not supported.
