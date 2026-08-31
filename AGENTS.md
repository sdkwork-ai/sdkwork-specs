# Repository Guidelines

## SDKWORK Soul

Read `SOUL.md` before changing SDKWork standards. It governs agent behavior, ambiguity handling, task-scoped checkpoints, and verification. Start with the sections that route the current task; do not treat its related-spec list as a startup bundle.

## SDKWORK Standards


<!-- SDKWORK-PROGRESSIVE-LOADING: v1 -->
Resolve this standards root once and use it as the global authority for the current task:

- `README.md`
- `SOUL.md`
- `AGENTS_SPEC.md`

Read only the relevant README task-matrix row or navigation heading, then load the selected authority sections.
<!-- /SDKWORK-PROGRESSIVE-LOADING: v1 -->

This repository is the canonical **global standards** home for SDKWork. `README.md` is the global standards index and task matrix; the normative authorities are the relevant local `*_SPEC.md` file and `SOUL.md`. Consuming repositories and modules must reference these files by relative path; they must not copy global `*_SPEC.md` bodies locally.

When this repository is checked out inside the parent SDKWork workspace, it is the workspace `sdkwork-specs/` self-root. From this root, use `README.md`, `SOUL.md`, and local `*_SPEC.md` files directly. The parent-workspace aliases below resolve to the same authority for validators and compatibility shims; resolve them once and do not load both paths.

Parent workspace relative aliases resolve to this same self-root for validators and tool shims:

- `../sdkwork-specs/README.md`
- `../sdkwork-specs/SOUL.md`
- `../sdkwork-specs/AGENTS_SPEC.md`

## Spec System Hierarchy

This is the layer-1 standards self-root. `SOUL.md` section 2, `COMPONENT_SPEC.md` section 1, and `AGENTS_SPEC.md` section 4 define the complete three-layer hierarchy. Repository/application and module `specs/` belong to consumer roots; do not inspect them from this repository unless the task explicitly targets their standard integration.

## Application Identity

This repository is a standards repository, not an SDKWork application. If a future standards portal or app is added, its `sdkwork.app.config.json` owns identity/release declarations and its `etc/` owns concrete environment/runtime/deployment values.

## Local Dictionary Structure

- `AGENTS.md`: agent execution rules for the standards repository.
- `CLAUDE.md`: Claude Code compatibility shim that points to `AGENTS.md` and must not duplicate rules.
- `GEMINI.md`: Gemini CLI compatibility shim that points to `AGENTS.md` and must not duplicate rules.
- `CODEX.md`: Codex compatibility shim that points to `AGENTS.md` and must not duplicate rules.
- `SOUL.md`: shared agent execution soul.
- `README.md`: global standards index and task matrix; read only the relevant row or navigation heading first.
- `docs/`: Canon documentation; see [docs/README.md](docs/README.md), [docs/product/prd/PRD.md](docs/product/prd/PRD.md), and [docs/architecture/tech/TECH_ARCHITECTURE.md](docs/architecture/tech/TECH_ARCHITECTURE.md).
- `*_SPEC.md`: global platform standards owned by this repository.
- `SOURCE_CONFIG_SPEC.md`: deployable-root source `etc/`, app manifest/config ownership, runtime materialization, and retired `configs/` migration.
- `.sdkwork/`: repository-local skills, plugins, and manifests for standards maintenance. Read `.sdkwork/README.md` and only the skill or plugin that matches the task, such as `.sdkwork/skills/sdkwork-standards-review/` for standards changes.

## Spec Resolution Order


<!-- SDKWORK-PROGRESSIVE-LOADING: v1 -->
Use dynamic progressive loading for the current task: resolve the selected root and task category before reading broad source context.

1. Read this `AGENTS.md` routing material and classify the owned surface.
2. Read `sdkwork.app.config.json`, module `specs/`, repository/application `specs/`, and `.sdkwork/` only when the task reaches the contract each item governs.
3. Locate only the relevant task-matrix row or navigation heading in `README.md`; do not load the full catalog.
4. Read only the task-specific global spec sections selected by that route, then inspect implementation files.
<!-- /SDKWORK-PROGRESSIVE-LOADING: v1 -->

This repository maintains global standards only. Use dynamic progressive loading before implementation files. Resolve a path or task category before reading its contents; read the exact section needed for the current step, then expand only when evidence exposes a new contract boundary.

1. Read this `AGENTS.md` routing material and confirm that this directory is the standards self-root.
2. Read the applicable `SOUL.md` sections. For standards or entrypoint work, begin with sections 1, 2, 3, and 7.
3. Read `.sdkwork/README.md`, then only a local skill or plugin whose declared trigger matches the task.
4. Locate the relevant row or heading in `README.md`; do not load the whole task matrix or unrelated standards catalog.
5. Read the relevant sections of the task-specific global specs named by that row and the required-spec mapping below.
6. Read implementation or validation files only after the applicable authority is clear. Use the narrowest relevant verification, and widen the scope only when the change crosses a contract boundary.

This standards root has no application identity or authored consumer module to load. When editing a consumer repository or module instead, follow `SOUL.md` section 3 and `SDKWORK_WORKSPACE_SPEC.md` section 7: resolve the nearest `AGENTS.md`, task-scoped module or repository contracts, and then the relative global standards path.

## Required Specs By Task Type

The following are task gates, not a startup bundle. Read the relevant sections of the selected set in the order the task reveals them; do not load unrelated language, runtime, UI, SDK, or release standards.

| Task | Read before editing | Load when the task reaches the condition |
| --- | --- | --- |
| Agent or repository-entry change | `SOUL.md`, `AGENTS_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `DOCUMENTATION_SPEC.md`, `TEST_SPEC.md` | `GOVERNANCE_SPEC.md` when the change is breaking, cross-root, or needs an exception |
| Code style or naming change | `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md` | Only the touched language/framework spec: `RUST_CODE_SPEC.md`, `JAVA_CODE_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`, or `FRONTEND_CODE_SPEC.md`; `PNPM_SCRIPT_SPEC.md` for package command standardization, package scripts, or root lifecycle commands |
| Contract or platform change | `README.md`, `REQUIREMENTS_SPEC.md`, `ARCHITECTURE_DECISION_SPEC.md`, `ENGINEERING_WORKFLOW_SPEC.md`, `CODE_REVIEW_SPEC.md`, `QUALITY_GATE_SPEC.md`, the affected domain spec, `GOVERNANCE_SPEC.md`, and `TEST_SPEC.md` | Read the applicable sections in lifecycle order rather than loading every full file at startup |
| Release, migration, or supply-chain standard change | `RELEASE_SPEC.md`, `MIGRATION_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `QUALITY_GATE_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `GOVERNANCE_SPEC.md`, and `TEST_SPEC.md` | Read the applicable sections in release, migration, and supply-chain sequence rather than loading every full file at startup |

## Int64 Wire Contract (API_SPEC §13.6)

- OpenAPI `int64` fields and parameters `MUST` be `type: string`, `format: int64`,
  a decimal `pattern` such as `^-?[0-9]+$`, and `x-sdkwork-int64-string: true`.
  `type: integer, format: int64` is a contract violation: generated TypeScript
  SDKs then emit `number`, and browsers silently round ids past
  `Number.MAX_SAFE_INTEGER` (2^53), replaying wrong ids into lookups.
- Rust response DTOs `MUST` serialize `i64` wire fields with
  `#[serde(with = "sdkwork_utils_rust::serde_int64")]` (or `::option`); request
  boundaries parse inbound strings with the same helper.
- Generated TypeScript SDKs keep `int64` as `string`; frontend code `MUST NOT`
  convert ids/snowflake ids/sequence ids to `number` for storage, comparison,
  or submission.
- Verification: `node <sdkwork-specs>/tools/check-api-operation-patterns.mjs --workspace .`

## Code Style Rules

Spec files use concise Markdown, RFC-style `MUST`/`SHOULD`/`MAY` language where rules are normative, and examples only when they make validation clearer. Do not duplicate large sections across specs; cross-link instead.

Build scripts, dev runners, and `pnpm clean` must follow `CODE_STYLE_SPEC.md` §7 (Build Source Integrity And Self-Healing). Git-tracked build-critical source files must be verified before builds and self-healed from git when missing; `clean` must not delete them.

## Build, Test, and Verification

<!-- SDKWORK-VERIFICATION-ROUTING: v1 -->
Choose only the narrowest verification selected by the changed surface. This is not a default full-suite command list.
Run workspace-wide checks only when the change crosses that boundary.
`bootstrap-*`, `align-*`, `sync-*`, `--write`, and other mutating repair commands are not verification defaults; use them only for an explicitly scoped repair, migration, bootstrap, or alignment task and inspect the resulting diff.
<!-- /SDKWORK-VERIFICATION-ROUTING: v1 -->

This repository contains Markdown standards. Before completion, verify that a new spec is listed in `README.md`, linked from affected authorities, and referenced by `TEST_SPEC.md` when it defines executable rules.

Choose only the narrowest commands selected by the changed standard; this is not a default full-suite command list. Run workspace-wide checks only after the task crosses that boundary. `bootstrap-*`, `align-*`, `sync-*`, `--write`, and other mutating repair commands are not verification defaults: use them only for an explicitly scoped bootstrap, alignment, migration, or repair task, then inspect the resulting diff.

| Change scope | Minimum verification |
| --- | --- |
| `SOUL.md`, `AGENTS.md`, compatibility shim, or documentation entrypoint | `node tools/check-agent-workflow-standard.mjs --root .`, `node tools/check-repository-docs-standard.mjs --root .`, `node --test tools/check-agent-workflow-standard.test.mjs`, `node --test tools/check-repository-docs-standard.test.mjs` |
| Documentation debt or Canon layout | `node tools/audit-repository-docs-debt.mjs --root .` and the affected documentation checker or its test |
| Repository/generated-state layout | `node tools/check-workspace-layout.mjs --root .` and `node --test tools/check-workspace-layout.test.mjs` |
| Validator or tool implementation | The matching `node --test tools/<tool>.test.mjs` and the tool's narrow `--root .` check |
| API, SDK, composition, workspace, runtime, or other domain standard | The validator and test command required by the affected authority and `TEST_SPEC.md`; use `--workspace ..` only when the change actually crosses repository roots |
| Broad cross-contract change | `node tools/verify-repo.mjs --root .` after the narrow checks pass |

Run `git diff --check` and inspect the relevant terminology and cross-references before completion.

## Agent Execution Rules

<!-- SDKWORK-PROGRESSIVE-LOADING: v1 -->
Use dynamic progressive loading for the current task; treat indexes and cross-references as discovery, not as a startup bundle.
Keep `SOUL.md` and the task-selected standards authoritative; expand context only when evidence exposes a new contract boundary.
Language-specific specs are on-demand: only the touched language loads `RUST_CODE_SPEC.md`, `JAVA_CODE_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`, or `FRONTEND_CODE_SPEC.md`.
Package command standardization loads `PNPM_SCRIPT_SPEC.md` only when the current task changes package commands or scripts; GitHub packaging work loads `GITHUB_WORKFLOW_SPEC.md` only when it reaches that workflow boundary.
Do not infer a recursive workspace scan or a broad validation suite from the presence of a path alone.
<!-- /SDKWORK-PROGRESSIVE-LOADING: v1 -->

Do not invent standards from memory. Follow this file's dynamic progressive resolution order, read only the current task's authoritative files or sections, edit narrowly, and keep compatibility with existing SDKWork terminology. Language-specific specs are loaded only when the task touches that language or framework.

When changing HTTP input/output rules, first update `API_SPEC.md` section 4.5 and sections 14-16. Then load and update the affected downstream authorities: `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `SDK_SPEC.md`, `FRONTEND_SPEC.md`, `MIGRATION_SPEC.md`, `TEST_SPEC.md`, `AGENTS_SPEC.md`, and shared templates under `templates/openapi/`. Run `node tools/align-agents-http-response-standard.mjs --workspace ..` only for that resolved HTTP-standard propagation task.

The task-specific sections below are not startup requirements. Read only the matching section after the task category is known. Their canonical excerpts remain discoverable under `AGENTS_SPEC.md`; do not create independent or divergent copies of the underlying global rules.

## Permission Composition And Route Registry

When a task changes SDK dependency integration, permission catalogs, route manifests, OpenAPI authorities, or API assembly, load `APP_PERMISSION_COMPOSITION_SPEC.md`, `PERMISSION_STANDARD_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `API_ASSEMBLY_SPEC.md`, `APPLICATION_GATEWAY_SPEC.md`, `API_SPEC.md`, and the relevant `TEST_SPEC.md` sections. Before completion, run:

```bash
node <sdkwork-specs>/tools/check-permission-composition.mjs --workspace <workspace-root>
node <sdkwork-specs>/tools/check-route-path-collisions.mjs --workspace <workspace-root>
```

Those authorities define the permission-inheritance and normalized route-collision rules; this entrypoint is only the task trigger and verification route.

## Task-Specific Standards

API work loads `API_SPEC.md` and its validators. List/search work loads `PAGINATION_SPEC.md` and `check-pagination.mjs`. Source configuration work loads `SOURCE_CONFIG_SPEC.md` and `check-source-config-standard.mjs`. Web server configuration work loads `SDKWORK_WEBSERVER_SPEC.md` and `check-webserver-toml-standard.mjs`. Link these authorities instead of copying their normative bodies into `AGENTS.md`.

## Human Review Rules

Human review is required for new root standards, breaking standard changes, security exceptions, naming migrations, and changes that affect all repositories or application roots.

<!-- SDKWORK-NAMING-STANDARD: v1 -->
## Rust Naming And Dependency Declaration

Authority: `../sdkwork-specs/NAMING_SPEC.md` section 3.1 and section 3.2.

Two identifier planes exist in every Rust crate and they MUST NOT be mixed: the package plane
(Cargo, filesystem, lock file) uses kebab-case, and the crate plane (lib target, modules, source
imports) uses snake_case.

- `[package].name`, the crate directory, `[features]` keys, and `[[bin]].name` use kebab-case.
- `[lib].name`, module files, module directories, and Rust imports use snake_case.
- A crate whose `[package].name` contains a hyphen SHOULD declare `[lib].name` explicitly
  (default: package name with every `-` replaced by `_`). A shorter lib name is allowed only
  when declared explicitly and used consistently by every consumer.
- Cargo dependency keys, `[workspace.dependencies]` keys, and `Cargo.lock` entries use the
  dependency package name. Use `package = "..."` when an alias is required.
- Every external crate referenced by `src/` MUST be declared in that crate's `[dependencies]`.
  Test-only crates belong in `[dev-dependencies]`; `build.rs` crates belong in
  `[build-dependencies]`.
- Never delete a dependency line, and never demote one from `[dependencies]` to
  `[dev-dependencies]`, while `src/` still imports it. Verify manifest cleanups with the
  command below before committing them.
- Regenerate and commit `Cargo.lock` in the same change as any dependency table edit.

Verification:

```bash
node ../sdkwork-specs/tools/check-rust-crate-naming-standard.mjs --root .
```
<!-- /SDKWORK-NAMING-STANDARD: v1 -->

<!-- SDKWORK-PNPM-WORKSPACE-STANDARD: v1 -->
## pnpm Workspace Dependency And Package Import

Authority: `../sdkwork-specs/PNPM_WORKSPACE_DEPENDENCY_SPEC.md` (companion to
`../sdkwork-specs/DEPENDENCY_MANAGEMENT_SPEC.md`).

Sibling SDKWork repositories are consumed through a dual-track model that MUST stay consistent:

- **Local development** (`pnpm dev`, `pnpm build`): pnpm workspace protocol. Each sibling
  package is declared ONCE in this repository root `pnpm-workspace.yaml` `packages:` as a
  `../sdkwork-*` relative path, and consumed with `workspace:*` in `package.json`. Never use
  `file:`/`link:`/git-URL specifiers for SDKWork sibling packages in any environment.
- **CI / release packaging**: git-repository dependency checkout. Every sibling referenced by the
  local workspace MUST have a matching `dependencies[]` entry in `sdkwork.workflow.json` so CI
  clones the sibling into the same `../sdkwork-*` relative layout (`GITHUB_WORKFLOW_SPEC.md`).
  `package.json` is never rewritten for CI.

Import rules for sibling SDKWork packages:

- Import by package name only: `import { X } from "@sdkwork/package-name"`. The specifier MUST
  equal the target package's `package.json` `name` exactly - no shortening, renaming, or alias.
- Forbidden: relative imports that cross a package boundary into another SDKWork repository or
  another workspace package's `src/` (for example `import ... from "../../sdkwork-appbase/.../src/..."`).
- Consume only the public `exports` surface of a package; never deep-import sibling `src/` internals.
- Every non-relative import in a workspace member MUST resolve to that member's own
  `dependencies`/`devDependencies`/`peerDependencies` (import closure).
- Vite aliases MUST NOT rename or redirect `@sdkwork/*` packages, MUST NOT be added to make a
  resolution error pass, and are allowed only for documented bootstrap/SDK-generation entrypoints.
- Fix a resolution failure by correcting the workspace declaration or the package `exports`,
  not by adding an alias.

Verification:

```bash
node ../sdkwork-specs/tools/verify-repo.mjs --root .
node ../sdkwork-specs/tools/check-workspace-member-protocol.mjs --root .
node ../sdkwork-specs/tools/check-dependency-list-completeness.mjs --target <repo-name>
```
<!-- /SDKWORK-PNPM-WORKSPACE-STANDARD: v1 -->
