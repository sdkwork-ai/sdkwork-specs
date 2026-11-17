# Standards Governance

- Version: 1.0
- Scope: spec ownership, changes, exceptions, compatibility, lifecycle gates, release, migration, supply-chain governance
- Related: `SOUL.md`, `AGENTS_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `REQUIREMENTS_SPEC.md`, `ARCHITECTURE_DECISION_SPEC.md`, `ENGINEERING_WORKFLOW_SPEC.md`, `CODE_REVIEW_SPEC.md`, `QUALITY_GATE_SPEC.md`, `RELEASE_SPEC.md`, `MIGRATION_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, all specs

This document defines how SDKWork standards evolve without fragmenting across applications.

## 1. Authority

Global `sdkwork-specs/*_SPEC.md` files are the platform source of truth for SDKWork standards.

Repository/application machine contracts live in root `specs/` and module `specs/component.spec.json`.
README files and `docs/` are discovery layers per `SOUL.md` section 2.1; they are not competing standards.

Rules:

- Local app standards may extend global standards, but must not contradict them.
- `SOUL.md` defines shared SDKWork agent behavior. Local agent instructions may narrow execution for a repository, but they must not weaken the soul principles.
- `AGENTS_SPEC.md` defines `AGENTS.md` and compatibility shims such as `CLAUDE.md`, `GEMINI.md`, and `CODEX.md`. Local agent entrypoints must link to root standards instead of becoming competing standards.
- Repository/application `skills/` and `.sdkwork/plugins/` may automate or explain standards, but they
  must not become competing standards. Skills follow `AGENT_SKILLS_SPEC.md`; plugins follow `SDKWORK_WORKSPACE_SPEC.md`.
- If two specs conflict, the more specific root spec wins for its domain.
- If root specs conflict, the conflict must be fixed before implementation continues.

## 2. Change Types

| Change type | Examples | Requirement |
| --- | --- | --- |
| Clarification | Better wording, examples | Review and update affected docs |
| Additive | New optional extension, new recommended module | Tests if executable behavior changes |
| Breaking | Rename operationId, change token header, change required DB field | Migration plan and explicit approval |
| Lifecycle gate | Change Definition of Ready, Definition of Done, review rule, merge gate, release gate, or exception gate | `QUALITY_GATE_SPEC.md` evidence and reviewer approval |
| Release-affecting | Change versioning, artifact, rollout, rollback, changelog, signing, or publication policy | `RELEASE_SPEC.md` and `SUPPLY_CHAIN_SECURITY_SPEC.md` review |
| Supply-chain | Change dependency source, generator authority, build integrity, signing, SBOM, provenance, or attestation policy | Security review, supply-chain evidence, and exception expiry when policy is weakened |
| Composable architecture | Change module layer roles, ports, dependency SDK composition, permission inheritance, route ownership, frontend package boundaries, Rust crate dependency boundaries, or composition resolver behavior | `COMPOSABLE_ARCHITECTURE_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_PERMISSION_COMPOSITION_SPEC.md`, and `QUALITY_GATE_SPEC.md` closure evidence |
| Exception | Temporary legacy deviation | Exception record with owner and expiry |

## 3. Exception Record

Every exception must include:

```yaml
id: EX-2026-0001
spec: API_SPEC.md
rule: operationId dotted resource style
owner: team-name
reason: legacy generated SDK migration
risk: inconsistent SDK surface
expires_at: 2026-06-30
removal_plan: regenerate app SDK with sdkwork-v3 profile
```

## 4. Compatibility Rules

- API compatibility follows `API_SPEC.md`.
- Database compatibility follows `DATABASE_SPEC.md`.
- SDK compatibility follows `SDK_SPEC.md`.
- RPC compatibility follows `RPC_SPEC.md`.
- RPC framework compatibility follows `RPC_FRAMEWORK_SPEC.md`.
- Discovery compatibility follows `DISCOVERY_SPEC.md`.
- Domain naming and ownership follows `DOMAIN_SPEC.md`.
- Reusable module compatibility follows `MODULE_SPEC.md`.
- App manifest compatibility follows `APP_MANIFEST_SPEC.md`.
- Repository/application workspace compatibility follows `SDKWORK_WORKSPACE_SPEC.md`.
- Agent skill compatibility follows `AGENT_SKILLS_SPEC.md`; a skill may narrow a workflow but cannot weaken a standard, move an authoritative skill to a host discovery path, or duplicate a skill body as a second standard.
- Repository baseline compatibility follows `REPOSITORY_BASELINE_SPEC.md`.
- Agent entrypoint compatibility follows `AGENTS_SPEC.md`.
- Code style compatibility follows `CODE_STYLE_SPEC.md` and the relevant language-specific spec only for touched languages.
- Naming compatibility follows `NAMING_SPEC.md`.
- Requirements compatibility follows `REQUIREMENTS_SPEC.md`; requirement changes must preserve traceability to acceptance criteria and verification evidence.
- Architecture decision compatibility follows `ARCHITECTURE_DECISION_SPEC.md`; superseded decisions must stay discoverable until affected implementations and docs migrate.
- Engineering workflow compatibility follows `ENGINEERING_WORKFLOW_SPEC.md`; local workflow automation may narrow checkpoints but must not remove clarification, verification, review, or evidence requirements.
- Code review compatibility follows `CODE_REVIEW_SPEC.md`; local review rules may add stricter ownership but must not treat generated artifacts, security changes, or standards changes as review-free.
- Quality gate compatibility follows `QUALITY_GATE_SPEC.md`; local gates may add checks but must not weaken Definition of Ready, Definition of Done, merge gates, release gates, or exception evidence.
- Release compatibility follows `RELEASE_SPEC.md`; release trains, versioning, changelog, rollout, rollback, and freeze rules must remain aligned with app manifests and workflow packaging.
- Migration compatibility follows `MIGRATION_SPEC.md`; breaking or compatibility-sensitive changes require migration plan, compatibility window, rollback, and owner approval.
- Supply-chain compatibility follows `SUPPLY_CHAIN_SECURITY_SPEC.md`; dependency, build, generated artifact, SBOM, provenance, signing, checksum, and attestation rules cannot be weakened without explicit security exception.
- Composable architecture compatibility follows `COMPOSABLE_ARCHITECTURE_SPEC.md`; local standards may narrow module boundaries but cannot skip component ports, SDK dependency composition, permission inheritance, route uniqueness, frontend package boundaries, Rust crate dependency boundaries, or resolver evidence without an approved exception.
- UI architecture compatibility follows `UI_ARCHITECTURE_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, and `BACKEND_UI_SPEC.md`.
- Security rules cannot be weakened by local exception without explicit owner approval and compensating control.

UI architecture boundary exceptions are breaking architecture exceptions. They must include a migration plan back to the correct package family and SDK surface. In particular, new PC application packages may not omit the `pc` segment; PC user console modules may not be named as admin modules; PC internal admin modules may not be named as user console or app modules; backend/admin UI may not use a single catch-all backend package as an exception unless the record names every affected domain package that will receive the split before expiry.

## 5. Review Checklist

- [ ] Correct spec files were consulted.
- [ ] Requirements and acceptance criteria were added or updated when behavior, contract, runtime, security, release, or migration intent changed.
- [ ] Architecture decisions were recorded or superseded when boundaries, ownership, runtime topology, or cross-client alignment changed.
- [ ] Composable architecture closure evidence was updated when module ports, dependency SDK composition, permission inheritance, route ownership, frontend package boundaries, Rust crate boundaries, or resolver behavior changed.
- [ ] `SOUL.md`, `AGENTS_SPEC.md`, `CODE_STYLE_SPEC.md`, and `NAMING_SPEC.md` were updated or cited when agent behavior, execution entrypoints, code structure, or public naming changed.
- [ ] Repository/application `skills/` or `.sdkwork/` plugins do not contradict root standards.
- [ ] Agent skills follow `AGENT_SKILLS_SPEC.md` in every module, are declared and indexed, and host compatibility entries remain pointers rather than competing copies.
- [ ] Repository/application `AGENTS.md` files do not contradict root standards or copy stale spec bodies.
- [ ] Tool compatibility files such as `CLAUDE.md`, `GEMINI.md`, and `CODEX.md` point to `AGENTS.md` and do not become competing standards.
- [ ] Changes do not create conflicting standards.
- [ ] Review evidence follows `CODE_REVIEW_SPEC.md`, and merge/release/exception evidence follows `QUALITY_GATE_SPEC.md`.
- [ ] Release-affecting changes cite `RELEASE_SPEC.md` and supply-chain-affecting changes cite `SUPPLY_CHAIN_SECURITY_SPEC.md`.
- [ ] Compatibility-sensitive changes include a `MIGRATION_SPEC.md` migration plan with rollback and owner.
- [ ] Any exception is documented with owner and expiry.
- [ ] Tooling or tests were updated when a standard becomes executable.
- [ ] AGENTS.md references still point to global `sdkwork-specs` and local machine contracts under `specs/`.
