# Documentation Standard

- Version: 2.1
- Scope: repository documentation layout, module README, product PRD, technical architecture, requirements, architecture decisions, API examples, runbooks, changelogs, release notes, migration plans, quality evidence, supply-chain evidence, spec references
- Related: all specs, including `SOUL.md`, `AGENTS_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `REQUIREMENTS_SPEC.md`, `ARCHITECTURE_DECISION_SPEC.md`, `ENGINEERING_WORKFLOW_SPEC.md`, `CODE_REVIEW_SPEC.md`, `QUALITY_GATE_SPEC.md`, `RELEASE_SPEC.md`, `MIGRATION_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, and `SDK_SPEC.md`

This standard defines the documentation required for reusable SDKWork capabilities. Documentation must make a module installable and operable by another application without reading its internals.

## 1. Documentation Source Rules

Rules:

- Global `sdkwork-specs/*_SPEC.md` files are the platform source of truth for standards.
- Repository/application machine contracts live in root `specs/` and module `specs/component.spec.json` per `SOUL.md` section 2.
- README files and `docs/` are discovery and narrative layers per `SOUL.md` section 2.1. They `MUST NOT` become a second copy of global standards or module contracts.
- App-local docs may extend global standards only by linking to the relevant global spec or recording an approved local narrowing spec under module `specs/`.
- Repository/application `AGENTS.md` is the agent execution entrypoint. It must link to root specs by relative path and must not duplicate root spec bodies.
- Tool-specific files such as `CLAUDE.md`, `GEMINI.md`, and `CODEX.md` are compatibility shims. They must point to `AGENTS.md` and must not become a second copy of repository rules.
- `SOUL.md` defines shared agent behavior. Local docs may cite it, but must not replace it with a local agent philosophy.
- Repository/application `.sdkwork/README.md` and `.sdkwork/plugins/README.md`, and
  `skills/README.md` when the root ships agent skills, are local documentation entrypoints governed
  by `SDKWORK_WORKSPACE_SPEC.md` and, for skills, `AGENT_SKILLS_SPEC.md`.
- Repository/application README files `MUST` document the active top-level project directories from
  `SDKWORK_WORKSPACE_SPEC.md` when the root omits inactive reserved directories or uses both source
  and generated boundaries such as `apis/` and `sdks/`. README `MUST` link to authoritative specs and
  machine contracts instead of restating normative rules in prose.
- Requirements, acceptance criteria, architecture decisions, workflow checkpoints, review evidence, quality gates, release evidence, migration plans, and supply-chain evidence `MUST` link to their governing root spec instead of inventing local-only lifecycle vocabulary.
- Lifecycle documentation `MUST` be traceable: requirement -> architecture decision when applicable -> implementation/change -> verification -> review -> release or migration evidence.
- API examples `MUST` match the OpenAPI contract and generated SDK method shape.
- Database docs `MUST` match migrations/entities/schema contracts.
- Generated documentation `MUST` identify the generator and source contract.
- Source/build dependency path examples `MUST` follow `DEPENDENCY_MANAGEMENT_SPEC.md`: use relative paths or placeholders such as `<workspace-root>` and `<release-root>`, not one developer's absolute machine path.
- Repository and application human documentation `MUST` follow section 2 of this file. Machine contracts remain in local `specs/`, `apis/`, and manifests; they must not be duplicated as prose in `docs/`.

## 2. Repository Documentation Layout

Every independent SDKWork git repository root and every independent SDKWork application root `MUST` use the repository documentation layout in this section when `docs/` is active.

`sdkwork-specs/` is a standards repository. It `MUST` still provide the Canon documents in section 2.2, but `docs/product/prd/PRD.md` describes standards governance and platform documentation goals instead of an end-user product.

### 2.1 Documentation Layers

Repository documentation is organized in six layers:

| Layer | Path prefix | Answers | Primary readers | Change rate |
| --- | --- | --- | --- | --- |
| Canon | `docs/product/`, `docs/architecture/` | What is this product? How is it built? | Everyone onboarding, review entry | Low |
| Working | `docs/product/requirements/`, `docs/architecture/decisions/`, `docs/engineering/` | What work is in flight? Why was it decided? | PM, architects, engineering leads | High |
| Guides | `docs/guides/` | How do I develop, operate, or integrate? | Developers, operators, integrators | Medium |
| Evidence | `docs/runbooks/`, `docs/changelogs/`, `docs/migrations/`, `docs/releases/` | What shipped? How do we recover? | Release, operations, audit | Event-driven |
| Extension | `docs/domains/`, `docs/sites/` | What domain-specific depth exists? | Domain owners | On demand |
| Archive | `docs/archive/` | What retired history remains discoverable? | Historians, migration readers | Append-only |

Rules:

- `docs/README.md` is the human index and audience router. It `MUST` link to the Canon documents and explain active versus archived documentation.
- `docs/INDEX.yaml` `SHOULD` register Canon paths, Working document ids, and `docs/domains/` entries for validators, portals, and agents.
- Canon documents `MUST NOT` grow unbounded appendices. Material that exceeds one reviewable screen `MUST` split into Working, Extension, or Archive documents and link back.
- Competing top-level documentation directories such as `docs/adr/`, `docs/架构/`, `docs/step/`, or numbered design roots `MUST NOT` be introduced for new work. Existing historical directories `MAY` remain under `docs/archive/` or `docs/domains/` with redirect notes in `docs/README.md`.
- `specs/` stores machine contracts. `docs/` stores human narrative. Do not duplicate OpenAPI, `component.spec.json`, or migration SQL as the only source of truth inside `docs/`.

Traceability chain:

```text
docs/product/prd/PRD.md
  -> docs/product/requirements/REQ-*
    -> docs/architecture/decisions/ADR-* (when boundaries change)
      -> docs/engineering/plans/PLAN-*
        -> implementation and contract changes
          -> verification, review, release, migration, and changelog evidence
```

### 2.2 Canon Directories

Canon documents live in fixed directories with fixed entry filenames:

| Canon area | Directory | Fixed entry | Purpose |
| --- | --- | --- | --- |
| Documentation index | `docs/` | `README.md` | Audience routing, documentation map, active/archive policy |
| Product PRD | `docs/product/prd/` | `PRD.md` | Product vision, users, scope, phases, success metrics |
| Technical architecture | `docs/architecture/tech/` | `TECH_ARCHITECTURE.md` | Technology choices, module boundaries, runtime topology, root-spec alignment |

Rules:

- Repository root `README.md` and `AGENTS.md` `MUST` link to `docs/README.md`, `docs/product/prd/PRD.md`, and `docs/architecture/tech/TECH_ARCHITECTURE.md` by relative path.
- `docs/product/README.md`, `docs/product/prd/README.md`, `docs/architecture/README.md`, and `docs/architecture/tech/README.md` `MUST` exist and explain Canon boundaries and shard splitting rules.
- `docs/product/prd/PRD.md` `MUST` be the product Canon entry. It `MAY` stay self-contained or act as an index linking PRD shards in the same directory.
- `docs/architecture/tech/TECH_ARCHITECTURE.md` `MUST` be the technical architecture Canon entry. It `MAY` stay self-contained or act as an index linking architecture shards in the same directory.
- Product Canon entry content `MUST` describe product behavior and outcomes. It `MUST NOT` become the authoritative place for API paths, table names, package names, or implementation steps.
- Technical architecture Canon entry content `MUST` describe repository-specific technology choices and boundaries. It `MUST` cite the relevant `sdkwork-specs` architecture, API, SDK, database, security, and deployment standards instead of restating them.
- Multi-application repositories `MUST` keep repository-level Canon directories for the shared product and platform shape. Each independently built, distributed, or launched application root under `apps/<application-root>/` `MUST` also provide `docs/product/prd/PRD.md` and `docs/architecture/tech/TECH_ARCHITECTURE.md`, or explicitly narrow a section inside the repository-level Canon and link to it from the application root `README.md`.
- Narrow-purpose tool repositories `MAY` use a short `docs/product/prd/PRD.md` stub that states the repository is not an end-user product and identifies the consuming applications or capabilities.

Retired flat Canon paths:

- `docs/product/prd/PRD.md`
- `docs/architecture/tech/TECH_ARCHITECTURE.md`

These paths `MAY` remain only as redirect stubs after migration. They `MUST NOT` hold active Canon content.

Shard splitting rules:

- Product shards `MUST` live beside the entry as `docs/product/prd/PRD-<kebab-topic>.md`.
- Architecture shards `MUST` live beside the entry as `docs/architecture/tech/TECH-<kebab-topic>.md`.
- Every shard `MUST` be linked from the Canon entry document.
- When Canon content exceeds one reviewable screen, split it into shards instead of growing unbounded appendices inside the entry file.

Recommended `docs/product/prd/PRD.md` sections:

```md
# <Product Name> PRD

Status: draft | active | deprecated
Owner: <team-or-person>
Application: <application-code>
Updated: YYYY-MM-DD
Specs: REQUIREMENTS_SPEC.md, DOCUMENTATION_SPEC.md

## 1. Background And Problem
## 2. Target Users
## 3. Goals And Non-Goals
## 4. Scope
## 5. User Scenarios
## 6. Success Metrics
## 7. Phases
## 8. Linked Requirements
## 9. Open Questions
```

Recommended `docs/architecture/tech/TECH_ARCHITECTURE.md` sections:

```md
# <Product Name> Technical Architecture

Status: draft | active | deprecated
Owner: <team-or-person>
Updated: YYYY-MM-DD
Specs: ARCHITECTURE_DECISION_SPEC.md, <selected architecture standards>

## 1. Architecture Overview
## 2. Technology Choices
## 3. System Boundaries And Modules
## 4. Directory And Package Layout
## 5. API, SDK, And Data Ownership
## 6. Security, Privacy, And Observability
## 7. Deployment And Runtime Topology
## 8. Architecture Decision Index
## 9. Verification
```

### 2.3 Working Documents

Working documents use stable ids and semantic directories:

| Prefix | Directory | Purpose |
| --- | --- | --- |
| `REQ-` | `docs/product/requirements/` | Engineering requirements governed by `REQUIREMENTS_SPEC.md` |
| `ADR-` | `docs/architecture/decisions/` | Architecture decisions governed by `ARCHITECTURE_DECISION_SPEC.md` |
| `PLAN-` | `docs/engineering/plans/` | Implementation or iteration plans |
| `REVIEW-` | `docs/engineering/reviews/` | Design, code, or release review records |

Filename pattern: `<PREFIX><id>-<kebab-slug>.md`

Examples:

- `docs/product/requirements/REQ-2026-0042-drive-upload-quota.md`
- `docs/architecture/decisions/ADR-20260623-postgres-primary-store.md`
- `docs/engineering/plans/PLAN-2026-0010-im-topology-v2.md`

Rules:

- `docs/product/requirements/README.md` and `docs/architecture/decisions/README.md` `SHOULD` exist.
- `docs/engineering/README.md` `SHOULD` exist when plans or reviews are authored.
- `docs/architecture/views/` `MAY` hold standard architecture views such as `context.md`, `components.md`, `deployment.md`, and `security.md`.
- `docs/product/roadmap/` `MAY` hold phase roadmaps that are not part of the PRD body.

### 2.4 Guides, Evidence, Extension, And Archive

Guides:

```text
docs/guides/
  README.md
  developer/
  operator/
  integrator/
  user/                 # optional
```

Evidence:

```text
docs/runbooks/RUNBOOK-<topic>.md
docs/changelogs/CHANGELOG.md
docs/migrations/MIG-YYYY-NNNN-<slug>.md
docs/releases/RELEASE-vX.Y.Z.md
```

Extension:

```text
docs/domains/<domain>/README.md
docs/sites/                         # optional external docs site source
```

Archive:

```text
docs/archive/README.md
docs/archive/<topic-or-yyyy-mm>/    # read-only historical material
```

Each Guides, Evidence, Extension, or Archive subdirectory `MUST` have `README.md` when it contains tracked documents beyond placeholders.

### 2.5 Recommended Repository `docs/` Skeleton

```text
docs/
  README.md
  INDEX.yaml
  product/
    README.md
    prd/
      README.md
      PRD.md
    requirements/
      README.md
    roadmap/
      README.md
  architecture/
    README.md
    tech/
      README.md
      TECH_ARCHITECTURE.md
    decisions/
      README.md
    views/
      README.md
  engineering/
    README.md
    plans/
      README.md
    reviews/
      README.md
  guides/
    README.md
    developer/
      README.md
    operator/
      README.md
    integrator/
      README.md
  runbooks/
    README.md
  changelogs/
    README.md
  migrations/
    README.md
  releases/
    README.md
  domains/
    README.md
  archive/
    README.md
```

### 2.6 `docs/INDEX.yaml`

Repositories `SHOULD` maintain `docs/INDEX.yaml`:

```yaml
schemaVersion: 1
kind: sdkwork.docs.index
repository: sdkwork-example
canon:
  prd: docs/product/prd/PRD.md
  techArchitecture: docs/architecture/tech/TECH_ARCHITECTURE.md
entries:
  - id: REQ-2026-0001
    path: docs/product/requirements/REQ-2026-0001-example.md
    layer: work
    audience: [product, engineering]
    status: ready
domains:
  - name: schema-registry
    path: docs/domains/schema-registry/
    owner: data-team
```

Rules:

- `canon.prd` and `canon.techArchitecture` `MUST` match the fixed Canon paths.
- New `REQ-*`, `ADR-*`, `PLAN-*`, and `REVIEW-*` documents `SHOULD` be added to `entries` when created.
- `docs/INDEX.yaml` is a registry, not a second source of truth for contracts or requirements content.

### 2.7 Repository Documentation Acceptance

- [ ] `docs/README.md` links to `docs/product/prd/PRD.md` and `docs/architecture/tech/TECH_ARCHITECTURE.md`.
- [ ] Root `README.md` and `AGENTS.md` link to the Canon documents.
- [ ] `docs/product/prd/PRD.md` and `docs/architecture/tech/TECH_ARCHITECTURE.md` exist and declare `Status`, `Owner`, and governing specs.
- [ ] Engineering requirements live under `docs/product/requirements/` with `REQ-*` ids.
- [ ] Architecture decisions live under `docs/architecture/decisions/` with `ADR-*` ids; `docs/adr/` is not used for new ADRs.
- [ ] Implementation plans and review evidence use `docs/engineering/` when present.
- [ ] Domain-specific depth uses `docs/domains/<domain>/` or `docs/archive/`, not ad hoc top-level `docs/` folders.
- [ ] `docs/INDEX.yaml` exists or the repository documents why it is not yet adopted.

New repositories `SHOULD` scaffold the layout with:

```bash
node ../sdkwork-specs/tools/bootstrap-repository-docs.mjs --root .
node ../sdkwork-specs/tools/migrate-legacy-canon-paths.mjs --root .
```

## 3. Required Module README

Every reusable module `MUST` have a README with:

- Capability and domain.
- Package type and architecture support.
- Public exports.
- Required SDK client surface.
- Initialization/configuration example.
- Standalone/cloud deployment profile and runtime target notes.
- Security and tenant assumptions.
- Extension points.
- Verification command.
- Owner and status.
- Agent skills: when the module ships `<module-root>/skills/`, the README `MUST` list each skill name, its trigger, and its relative path, and `skills/README.md` `MUST` cite `AGENT_SKILLS_SPEC.md` as its declaration.

Template:

```md
# <module-name>

Domain: iam
Capability: sessions
Package type: service
Status: standard

## Public API
## Required SDK Surface
## Configuration
## Deployment Profile And Runtime Target Behavior
## Security
## Extension Points
## Agent Skills
## Verification
```

## 3.1 Required Workspace README

Every git repository root and SDKWork application root `MUST` document its
source-controlled `.sdkwork/` workspace.

Rules:

- `AGENTS.md` `MUST` cite `AGENTS_SPEC.md`, `SOUL.md`, and the relative root `sdkwork-specs/README.md` path.
- Tool compatibility shims such as `CLAUDE.md`, `GEMINI.md`, and `CODEX.md`, when present, `MUST` cite the same-root `AGENTS.md` and the relative root `sdkwork-specs/README.md` path.
- `.sdkwork/README.md` `MUST` explain that the directory stores repository or
  application development metadata, not runtime state.
- `skills/README.md` `MUST` explain where skills live, how a new skill declares its `SKILL.md`
  entrypoint, and `MUST` cite `AGENT_SKILLS_SPEC.md` for the skill contract.
- `.sdkwork/plugins/README.md` `MUST` explain where repository/application
  plugins live and when `.codex-plugin/plugin.json` is required.
- Workspace READMEs `MUST` cite `SDKWORK_WORKSPACE_SPEC.md`.
- Workspace READMEs should point to `AGENTS.md` for execution order and to `SOUL.md` for shared agent behavior.
- Workspace READMEs `MUST NOT` duplicate root standards, include secrets, or
  document user-private runtime paths as committed source directories.

## 3.2 Required Root Layout Documentation

Every independent SDKWork git repository root and every independent SDKWork application root `MUST`
make its active root layout discoverable from its root README or an explicitly linked document.

Rules:

- Root layout documentation `MUST` cite `SDKWORK_WORKSPACE_SPEC.md` for the standard directory dictionary.
- If the root omits inactive reserved directories, the README `MUST` state which capabilities are active and which standard directories are intentionally absent.
- Each standard top-level directory README `MUST` document purpose, owner, allowed content, forbidden content, related specs, and verification command or checklist. For `apps/`, use `apps/README.md` and follow section 3.3.
- If both `apis/` and `sdks/` exist, the README `MUST` explain that `apis/` contains authored API contracts and API review inputs, while `sdks/` contains SDK family workspaces, materialized authority OpenAPI, derived `sdkgen` inputs, and generated SDK output.
- If both `plugins/` and `.sdkwork/plugins/` exist, the README `MUST` distinguish application/runtime plugin source from repository/application agent plugin workspaces.
- If `etc/`, architecture-local `config/`, or runtime config paths are documented, the README `MUST` distinguish source-controlled safe profiles/templates from user-private or environment-private runtime config governed by `RUNTIME_DIRECTORY_SPEC.md`.

## 3.3 Required apps/ Directory Index

Every independent SDKWork application git repository `MUST` keep `apps/README.md` as the human
directory index for application roots under `apps/`.

Rules:

- `apps/` `MUST` exist at the repository root for every independent SDKWork application git
  repository.
- `apps/README.md` `MUST` exist whenever `apps/` exists.
- `apps/README.md` `MUST` cite `APPLICATION_SPEC.md` and `SDKWORK_WORKSPACE_SPEC.md`.
- `apps/README.md` `MUST` index every direct child `apps/sdkwork-<application-code>-*` application root.
- Root `README.md` `MUST` declare `repository-kind:` for every SDKWork git repository root.
- `apps/README.md` `MUST` include a directory index that lists every direct child directory under
  `apps/`, excluding hidden directories and placeholder-only files such as `.gitkeep`.
- For each indexed child directory, `apps/README.md` `MUST` document:
  - directory name;
  - surface role, such as `common`, `pc`, `h5`, `flutter-mobile`, `mini-program`,
    `android-mobile`, `ios-mobile`, `harmony-mobile`, `backend-react-web`, `demo`, or another
    approved client architecture from `APPLICATION_SPEC.md`;
  - whether the child is runnable, a shared package-family root, or a secondary shell/demo;
  - one-line purpose;
  - relative link to the child root `README.md` when that child is an active application root.
- When `apps/` has no child directories, `apps/README.md` `MUST` state that explicitly and explain
  where the primary app surface lives.
- Stale index entries `MUST NOT` remain after a child application root is removed or renamed.
- Repository root `README.md` `MUST` link to `apps/README.md` when `apps/` exists.

Template:

```md
# apps/

Application: <application-code>
Status: active
Owner: <team>
Specs: APPLICATION_SPEC.md, SDKWORK_WORKSPACE_SPEC.md

## Primary App Surface

The repository root is / is not the primary runnable app surface.
When the repository root is primary, it follows <architecture-standard>.

## Directory Index

| Directory | Surface role | Runnable | Purpose | Entry |
| --- | --- | --- | --- | --- |
| sdkwork-<application-code>-common | common | no | Cross-architecture shared packages | [README](sdkwork-<application-code>-common/README.md) |
| sdkwork-<application-code>-pc | pc | yes | PC browser/desktop app root | [README](sdkwork-<application-code>-pc/README.md) |

## Verification

node ../sdkwork-specs/tools/check-apps-directory-index.mjs --root .
```

## 4. API Documentation

Rules:

- API docs `MUST` be generated from or checked against OpenAPI.
- SDK examples `MUST` use resource-style calls such as `client.auth.sessions.create(body)`.
- Error examples `MUST` use `application/problem+json`.
- Auth examples `MUST` show both `Authorization: Bearer <JWT auth_token>` and `Access-Token: <JWT access_token>` for protected APIs.
- Backend API docs `MUST NOT` show login/session creation endpoints.

## 4.1 RPC SDK Documentation

RPC SDK documentation follows `RPC_SDK_WORKSPACE_SPEC.md`.

Rules:

- RPC SDK READMEs MUST identify proto packages, service catalog, generated languages, endpoint configuration, TLS/mTLS configuration, metadata auth, deadline and cancellation behavior, idempotent write example, error/status mapping, and verification commands.
- RPC SDK examples for protected methods MUST use metadata provider setup instead of hard-coded tokens or manually assembled business-module metadata.
- RPC SDK docs MUST state that `sdkgen` orchestrates SDKWork package layout and Buf/protoc-compatible generation configuration; it does not replace Protocol Buffers, Buf, protoc, or language-specific gRPC plugins.

## 5. Requirements Documentation

Rules:

- Product scope and outcomes live in `docs/product/prd/PRD.md`.
- Business and engineering requirements `MUST` follow `REQUIREMENTS_SPEC.md`.
- Engineering requirement records `MUST` live under `docs/product/requirements/` unless an approved local spec documents a temporary migration path.
- Requirement docs `MUST` include owner, status, priority, acceptance criteria, non-functional requirements when relevant, affected specs/components, and verification evidence.
- Requirement changes `MUST` preserve traceability to the original requirement id or explicitly supersede it.
- Requirement docs `MUST NOT` hide breaking contract, security, privacy, release, or migration impact inside informal notes.

## 6. Architecture Decisions

Architecture decisions are governed by `ARCHITECTURE_DECISION_SPEC.md`.

Repository baseline architecture lives in `docs/architecture/tech/TECH_ARCHITECTURE.md`. Point-in-time decisions live in `docs/architecture/decisions/`.

Reusable foundation changes `MUST` record decisions when they affect:

- domain boundary or naming.
- API path, operationId, or schema shape.
- database table prefix or ownership.
- security model.
- SDK generator behavior.
- Java/Rust parity.
- deployment profile and runtime target switching.
- client architecture alignment, route identity, or package family ownership.
- release, migration, security, privacy, or supply-chain posture.

Decision records `MUST` include context, decision, alternatives, consequences, verification, and supersession when replacing an earlier decision.

## 7. Runbooks

L3 foundation domains `MUST` have operational runbooks for:

- token/key rotation.
- tenant isolation incident response.
- migration rollback.
- provider outage when integrations are involved.
- rate-limit/quota incidents.
- audit log investigation.

Runbooks `SHOULD` include signals, dashboards, commands, rollback steps, and escalation owner.

## 8. Release, Migration, And Supply-Chain Docs

Rules:

- Release notes and changelog entries `MUST` follow `RELEASE_SPEC.md` and identify version, artifacts, compatibility impact, rollout/rollback posture, and verification evidence.
- Migration docs `MUST` follow `MIGRATION_SPEC.md` and identify scope, compatibility window, sequencing, rollback, affected consumers, and owner.
- Supply-chain evidence docs `MUST` follow `SUPPLY_CHAIN_SECURITY_SPEC.md` and identify dependency sources, build inputs, generated artifact authority, SBOM/provenance/signing/checksum/attestation locations, and exceptions.
- Quality gate evidence `MUST` follow `QUALITY_GATE_SPEC.md` and cite requirement, review, verification, release, migration, and supply-chain evidence when applicable.
- Code/spec review evidence `MUST` follow `CODE_REVIEW_SPEC.md` and record outcomes without copying generated SDK output into authored documentation.

## 9. Changelog

Rules:

- API, SDK, database, and module contract changes `MUST` be recorded.
- Breaking changes `MUST` include migration instructions or explicit no-compatibility approval.
- SDK generator version and OpenAPI version `SHOULD` be recorded for SDK releases.
- Release changelog entries `MUST` identify the release version or tag used by packaging and publication workflows.
- Standards changelog entries `SHOULD` identify affected requirement, ADR, review, quality gate, migration, or supply-chain evidence when applicable.
- Spec changes `SHOULD` reference affected validation tooling.

## 10. Acceptance Checklist

- [ ] `docs/README.md`, `docs/product/prd/PRD.md`, and `docs/architecture/tech/TECH_ARCHITECTURE.md` exist for repository and application roots with active `docs/`.
- [ ] Root specs are linked from local docs.
- [ ] `AGENTS.md` links to root `sdkwork-specs`, `SOUL.md`, `AGENTS_SPEC.md`, and the Canon documentation paths by relative path.
- [ ] Tool compatibility files such as `CLAUDE.md`, `GEMINI.md`, and `CODEX.md` point to `AGENTS.md` and do not duplicate divergent rules.
- [ ] Repository/application `.sdkwork/` README files exist and cite `SDKWORK_WORKSPACE_SPEC.md`.
- [ ] Repository/application root README documents the active standard top-level directories, including `apis/` versus `sdks/` when API contracts and generated SDK workspaces both exist.
- [ ] Independent application repositories provide `apps/README.md` that indexes every direct child application root and states primary app surface placement.
- [ ] `docs/product/requirements/` uses `REQ-*` ids and links to `REQUIREMENTS_SPEC.md` when non-trivial behavior is documented.
- [ ] `docs/architecture/decisions/` uses `ADR-*` ids, links to `ARCHITECTURE_DECISION_SPEC.md`, and records supersession when decisions change.
- [ ] Module README includes public API, SDK surface, config, security, and verification.
- [ ] API examples match OpenAPI and generated SDK.
- [ ] RPC SDK READMEs include proto packages, service catalog, endpoint/TLS/mTLS, metadata auth, deadline, idempotency, status mapping, and verification commands when RPC SDKs are touched.
- [ ] Review and quality gate evidence link to `CODE_REVIEW_SPEC.md` and `QUALITY_GATE_SPEC.md` when work is reviewed or gated.
- [ ] Release notes, migration plans, and supply-chain evidence link to `RELEASE_SPEC.md`, `MIGRATION_SPEC.md`, and `SUPPLY_CHAIN_SECURITY_SPEC.md` when applicable.
- [ ] Operationally critical modules include runbooks.
- [ ] Contract changes have changelog entries.
