# SDKWork Agent Soul

- Version: 1.5
- Scope: shared execution principles for SDKWork agents, automation, human-assisted AI workflows, and repository-local `AGENTS.md` files
- Related: `AGENTS_SPEC.md`, `COMPONENT_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `ENGINEERING_WORKFLOW_SPEC.md`, `GOVERNANCE_SPEC.md`, `TEST_SPEC.md`, `CODE_STYLE_SPEC.md`, `DESTRUCTIVE_OPERATION_SPEC.md`, `ROLLBACK_RESTRICTION_SPEC.md` (load each only when the task makes it applicable)

This file defines the operating soul for SDKWork agents. It is not a style guide and it is not a prompt library. It is the minimum behavior contract that keeps long-running AI work precise, recoverable, and governed by SDKWork standards.

## 1. Core Principles

Rules:

- Specs before memory. When a relevant SDKWork spec exists, load it by relative path instead of relying on remembered rules.
- Dictionary before context. Resolve the nearest `AGENTS.md`, the applicable repository/application root, and the relative `sdkwork-specs` path before loading broad source context. Probe the presence and location of `sdkwork.app.config.json`, module `specs/`, repository/application root `specs/`, and `.sdkwork/`; load an entry's contents only when the task or an already-loaded contract makes it applicable.
- Exact source before inference. Prefer application manifests, family-root `sdk-manifest.json`, OpenAPI, route manifests, package manifests, and component specs over natural-language guesses.
- Native authority before parallel manifests. Use pnpm/Cargo/Gradle/Maven/pubspec/OpenAPI and existing package manifests as dependency authority; do not introduce a second manifest that restates the same dependency graph.
- Minimal context first. Start with the routing entry or exact section needed for the current task, then expand deliberately when evidence requires it. An index, directory listing, or cross-reference identifies the next candidate; it is not a reason to load every linked file.
- Plan, execute, verify, fix, retry. Long tasks must be resumable from checkpoints and must not depend on one uninterrupted context window.
- Evidence before completion. Do not claim a task is complete until the relevant verification command or checklist has run and the result has been read.
- Stop on ambiguity. When two possible specs, app roots, SDK families, API authorities, or components match a task, stop and disambiguate before editing.
- Local conventions cannot override global standards. Module-local and repository-local specs may narrow SDKWork rules, but they must not contradict global `sdkwork-specs`.
- One module, one specs directory. Every authored module owns its own `specs/` system; do not centralize module contracts in repository READMEs, `AGENTS.md` bodies, or copied global spec files.
- README and docs are discovery, not standards. Repository README, `docs/`, and `sdkwork-specs/README.md` are indexes and narrative; normative platform rules live in global `*_SPEC.md` files and this `SOUL.md`, while machine contracts live in `specs/`.
- Generated code is not hand-edited. Fix the source contract, generator input, or approved facade, then regenerate.
- No pattern-driven deletion. Delete by explicitly enumerated path, never by wildcard, glob, brace expansion, recursive walk, or unbounded expansion. `git rm -r`, `git rm` over a directory or pattern, and `git clean -f*` are forbidden. Wildcards are for read-only commands only. A destructive command is never combined in one shell invocation with a build, install, or publish step, and is never batched beyond the limits in `DESTRUCTIVE_OPERATION_SPEC.md`.
- Human review owns irreversible direction. Agents can execute, but humans approve unclear product direction, breaking standards changes, security exceptions, migrations, and destructive operations.
- Fix forward, never rewind. A `git reset`, `git checkout -f`, `git switch -f`, `git restore` toward an earlier state, reflex `git revert`, stash discard, ref deletion, `git rebase`, `git commit --amend` on pushed history, or force push is never the remedy for a defect. Repair by adding, editing, or restoring content in a new commit. Discarding work requires a separate, explicit human instruction that names the operation, the target ref, and the discarded span, and the authorization is recorded in the commit message (authority: `ROLLBACK_RESTRICTION_SPEC.md`).

## 2. Spec System Hierarchy

SDKWork separates **global standards** from **local spec systems**. Agents must respect layer boundaries and must not copy global standards into consuming repositories or module directories.

| Layer | Location | Owner | Responsibility |
| --- | --- | --- | --- |
| Global standards | `sdkwork-specs/*_SPEC.md`, `sdkwork-specs/SOUL.md` | SDKWork platform maintainers | Platform-wide rules: API, SDK, naming, security, architecture, verification. Single source of truth. Referenced by relative path only. |
| Repository/application contracts | `<git-repo-root>/specs/` or `<application-root>/specs/` | Repository or application maintainers | Repository-wide machine-readable contracts that span modules, such as `topology.spec.json`, deployment profile manifests, or application composition metadata. Not a substitute for global standards. |
| Module-local specs | `<module-root>/specs/` | Module maintainers | Each authored app, package, crate, service, SDK family, or host adapter owns an independent local spec system per `COMPONENT_SPEC.md`. |

Module-local spec system requirements:

- Every authored module `MUST` maintain `<module-root>/specs/component.spec.json`.
- Module `<module-root>/specs/README.md` `MAY` exist as a human index for that module's spec system. It is not a normative standard file; machine authority is `component.spec.json`.
- `component.spec.json` is the machine-readable integration contract: identity, surface, `canonicalSpecs` links, SDK/route/runtime contracts, and verification commands.
- Module `specs/` `MAY` add narrowing extension files such as `FRONTEND_SPEC.md` or `RELEASE_SPEC.md` only when the module needs rules beyond global standards.
- Module `specs/` `MUST NOT` copy, fork, or paraphrase global `*_SPEC.md` bodies. Link through `canonicalSpecs` instead.
- Durable module rules belong in module `specs/`, not in `AGENTS.md` preserved-guidance blocks or repository README prose.

### 2.1 Discovery Layer (README And Docs)

README files and `docs/` belong to the **discovery and documentation layer**. They are not part of the normative specs hierarchy above.

| Artifact | Role | Authority |
| --- | --- | --- |
| `sdkwork-specs/README.md` | Global standards index and task matrix | Navigation only; load specific `*_SPEC.md` for rules |
| Repository/application `README.md`, `apps/README.md` | Directory index and onboarding | Link to specs, docs, and manifests; no normative rule bodies |
| `docs/**` | PRD, architecture Canon, ADRs, runbooks | Human narrative per `DOCUMENTATION_SPEC.md` |
| `AGENTS.md` | Agent execution entrypoint | Index and boundaries, plus only canonical excerpts required by `AGENTS_SPEC.md`; no independently maintained or divergent global spec bodies |
| Module `specs/README.md` | Module spec human index | `component.spec.json` remains machine authority |

Rules:

- README and docs `MUST` link to authoritative specs and contracts instead of duplicating their normative bodies.
- Validators and agents `MUST NOT` treat README prose as a substitute for global specs or `component.spec.json`.
- When README and a spec disagree, the global spec or machine contract wins unless a governance exception exists.

Authority and cleanup rules:

- Global `sdkwork-specs` wins on conflict unless an approved governance exception exists.
- Repository/application `specs/` may declare cross-module topology and release facts; they must not redefine platform contracts already owned by global specs.
- Closer module `specs/` define integration boundaries for that module only; they must not become a second global standards tree.
- If a convenience copy of a global spec exists locally, the global `sdkwork-specs` version remains authoritative.

Detailed module spec shape and discovery: `COMPONENT_SPEC.md`. Repository workspace dictionary and `.sdkwork/` boundaries: `SDKWORK_WORKSPACE_SPEC.md`. Agent entrypoint and progressive loading: `AGENTS_SPEC.md`.

## 3. Standard Execution Order

Every agent follows this task-scoped order. A higher-priority applicable local instruction may add or narrow steps only when it does not weaken global authority, bypass an applicable contract, or replace the declared relative standards path.

For this order, **resolve** means identify a path, owner, and applicability. **Read** means load only the file or section needed for the current step. Neither action authorizes recursive repository scanning or eager loading of linked standards.

1. Read the routing portion of the nearest `AGENTS.md`; resolve an enclosing repository or application entrypoint when it governs the selected root, following `SDKWORK_WORKSPACE_SPEC.md` section 7.
2. Classify the task, selected root, owned surface, and likely contract boundary before opening implementation files.
3. Read `sdkwork.app.config.json` only when the task touches application identity, behavior, runtime configuration, SDK wiring, release metadata, or app-owned capabilities.
4. Read the nearest module `specs/component.spec.json` only when the task touches that authored module. Read its `specs/README.md` only when it adds integration context absent from the manifest.
5. Read repository/application root `specs/` only when the task is repository-wide or application-wide rather than module-local.
6. Read local `.sdkwork/README.md` and only the matching local skills/plugins when the task needs their workflow, tooling, or workspace metadata.
7. Resolve the relative path to `sdkwork-specs/README.md`, then read only the relevant task-matrix row or navigation heading. Do not load the whole index as a startup bundle.
8. Read only the task-specific global specs selected by that matrix, the nearest `AGENTS.md`, or module `canonicalSpecs`; open additional sections only when evidence exposes a new contract boundary or ambiguity.
9. Inspect implementation files.
10. Edit narrowly.
11. Run the narrowest relevant verification, then broaden only when the change crosses a contract boundary.
12. Report evidence, gaps, and residual risk.

## 4. List And Search Pagination

When a task changes a list/search API, repository, projection read model, SDK list helper, or interactive list UI, load `PAGINATION_SPEC.md` and the task-matrix dependencies before editing. Apply its store-level pagination and verification requirements, including `node <sdkwork-specs>/tools/check-pagination.mjs --workspace <root>` when implementation changes. This is a task trigger, not a startup requirement.

Task matrix authority: `README.md` list/search pagination row, `PAGINATION_SPEC.md`, `AGENTS_SPEC.md` API changes row.

## 5. Destructive Operation Gate

When a task will delete, move, overwrite, reset, or force-check-out files, version-control state, database rows, or deployed artifacts, load `DESTRUCTIVE_OPERATION_SPEC.md` before issuing the command, and apply its enumeration, containment, batching, confirmation, and recovery requirements. This is a task trigger, not a startup requirement.

Rules:

- Deletion targets `MUST` be enumerated as exact paths before the command runs; a target derived from a wildcard, glob, brace expansion, recursive walk, or unbounded expansion is forbidden.
- `git rm -r`, `git rm` over a directory or pattern, and `git clean -f*` are forbidden in every SDKWork repository, including inside scripts, hooks, and workflows.
- Prefer `rm <exact/path>` plus tracked `git status`/`git add <paths>` over version-control-driven deletion, so the deletion is recorded rather than executed as one bulk transaction.
- A destructive command `MUST NOT` be combined in one shell invocation with a build, install, network, or publish step.
- Human confirmation is required before deleting git-tracked paths, directory trees, paths outside the active repository root, or more than 20 entries.

Task matrix authority: `DESTRUCTIVE_OPERATION_SPEC.md`, `README.md` destructive-operation row, `AGENTS_SPEC.md` destructive-operation row, `CODE_STYLE_SPEC.md` §8.

### 5.1 Rollback Restriction Gate

When a task responds to a defect — a build failure, a type error, a lint failure, a failing test, a merge conflict, a regression, a bad refactor, or an unclear diff — or when it must restore content lost to an earlier revert, load `ROLLBACK_RESTRICTION_SPEC.md` before touching version-control state. This is a task trigger, not a startup requirement.

Rules:

- Errors are fixed forward. A rollback `MUST NOT` be the remedy for a defect; the repair is a new commit that adds, edits, or restores content, and every prior revision stays reachable.
- `git reset --hard`, `git reset --merge`/`--keep`, `git reset <ref>` that discards staged or working-tree content, `git checkout -f`, `git switch -f`, `git restore --source=<ref> --worktree .`, reflex `git revert`, `git stash drop`/`clear`, `git branch -D` on unmerged work, `git update-ref -d`, direct `.git/refs/` edits, `git reflog expire`, `git gc --prune=now`, `git prune`, `git commit --amend` on pushed history, `git rebase`, `git filter-branch`, and `git push --force`/`--force-with-lease`/`--delete` are forbidden.
- A rollback `MUST NOT` be inferred from context or tone. "Fix it", "it's broken", "this is a mess", "start over", "just revert it", and "退回" are not authorizations. Stop and ask, including whether the instruction means to *discard* work or to *restore lost* work — that distinction decides which operation is permissible.
- Recovery is additive: `git restore --worktree --source=<ref> -- <exact paths>` or `git checkout <good-ref> --pathspec-from-file=<repo-relative-list>`. The pathspec `MUST` be an explicit enumerated list, never a directory, glob, brace expansion, or the repository root.
- Before a bulk restore: commit a checkpoint; create and verify a backup branch, a backup tag, and a patch file; and produce the written three-snapshot blob comparison that separates replaced files from files the damaged revision legitimately authored. Restore the relative complement, not the whole tree, and keep what the damaged revision added. Never treat a local tracking ref as evidence about a remote — confirm with `git ls-remote`.

Task matrix authority: `ROLLBACK_RESTRICTION_SPEC.md`, `README.md` rollback-restriction row, `AGENTS_SPEC.md` rollback-restriction row, `CODE_STYLE_SPEC.md` §8.

## 6. On-Demand Language Loading

After the task is classified, language-specific specs are loaded only when it touches that language or framework:

- Rust source, Cargo workspace, Tauri Rust, Rust route crate, or Rust RPC work loads `RUST_CODE_SPEC.md`.
- Java source, Spring backend, Maven module, or Java SDK work loads `JAVA_CODE_SPEC.md`.
- TypeScript, JavaScript, Node tooling, generated TypeScript SDK facade, or package export work loads `TYPESCRIPT_CODE_SPEC.md`.
- React, Flutter, mobile UI, PC UI, desktop renderer, or backend/admin UI work loads `FRONTEND_CODE_SPEC.md` plus the relevant UI architecture spec.

Do not load language, runtime, UI, deployment, or SDK standards merely because the repository contains those files. This keeps context small and makes the active rules obvious.

## 7. Agent Refusal Points

Agents must stop rather than continue when:

- The required relative path to `sdkwork-specs` cannot be resolved.
- A required app identity file, module `specs/component.spec.json`, or repository contract spec is missing for a task that depends on it.
- A module lacks its own `specs/` directory but the task requires an integration or verification contract for that module.
- The task requires an SDK method that cannot be traced to OpenAPI, generated SDK output, or an approved composed facade.
- A code change would bypass generated SDKs, route manifests, appbase IAM, Drive Uploader, global security standards, or workspace federation (`file:` / `link:` sibling SDKWork sources in member `package.json`; authority: `DEPENDENCY_MANAGEMENT_SPEC.md` section 3, `check-workspace-member-protocol.mjs`).
- A file appears generated but the source contract or generator command is unknown.
- A requested change conflicts with global specs and no governance exception exists.
- The task requires a deletion whose targets cannot be enumerated as exact paths, or whose command would use `git rm -r`, `git rm` over a directory or pattern, `git clean -f*`, or a wildcard in a mutating argument position.
- The task requires deleting git-tracked paths, a directory tree, or a path that resolves outside the active repository root without explicit human confirmation.
- The task would fix a defect by moving version-control state — a `git reset`, `git checkout -f`, `git switch -f`, `git restore` toward an earlier state, a reflex `git revert`, a stash discard, a ref deletion, a `git rebase`, or a force push — and no explicit human instruction names the operation, the target ref, and the span to be discarded.
- A request to "fix", "clean up", "undo", "go back", or "restore the old version" could mean discarding the current work or restoring lost work, and the requester has not disambiguated which.
- A pre-existing gate failure would be claimed without evidence from the prior revision, or a repair is about to be landed with `--force`, `--no-verify`, or `--no-gpg-sign` instead of by fixing the cause.

## 8. Long-Running Stability

Agents running multi-step work should record a task-scoped checkpoint:

- task objective and current plan.
- resolved app/repository root.
- relative path to `sdkwork-specs`.
- specs read for the current step.
- files modified.
- verification commands and outputs.
- unresolved ambiguity or pending human review.

Checkpoints are task-scoped metadata, not copies of source or standards content.

After interruption, re-read the nearest `AGENTS.md` and revalidate only the task-scoped identity, local contracts, and global standards recorded in the checkpoint that govern the next step. Load additional material only when the resumed step crosses a new contract boundary. Do not assume the recorded files or standards are unchanged.

