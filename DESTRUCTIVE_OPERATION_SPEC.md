# Destructive Operation Standard

- Version: 1.0
- Scope: every agent, automation, script, shell invocation, and operator action that can delete, move, overwrite, or reset files, version-control state, database rows, or deployed artifacts inside an SDKWork workspace
- Related: `SOUL.md`, `AGENTS_SPEC.md`, `CODE_STYLE_SPEC.md` §7, `PNPM_SCRIPT_SPEC.md` §11, `PORTABILITY_SPEC.md`, `MODULE_BIN_SPEC.md`, `OPERATIONS_SPEC.md`, `DATABASE_SPEC.md`, `GOVERNANCE_SPEC.md`, `TEST_SPEC.md`

This standard exists because a single interrupted recursive version-control deletion destroyed 183 working-tree entries in one SDKWork repository, of which 117 were unintended. The failure mode is not "the command was wrong"; it is that pattern-driven deletion is performed as one non-atomic bulk transaction whose partial failure is indistinguishable from a deliberate partial delete.

The rule is therefore absolute: **deletion must be explicit, enumerated, and reviewable. Deleting by pattern instead of by named path is forbidden.**

## 1. Core Prohibition

Rules:

- A deletion target `MUST` be an explicitly enumerated path list written before the command runs.
- A deletion command or script `MUST NOT` derive its targets from a wildcard, glob, brace expansion, recursive directory walk, or unbounded variable expansion.
- Wildcards `MAY` be used for **read-only** operations only: listing, searching, hashing, diffing, status inspection, and counting. Wildcards `MUST NOT` appear in any argument position of a mutating command.
- An operation is *destructive* when it unlinks, overwrites, resets, truncates, force-moves, or force-checks-out files or version-control state. Destructive operations carry the same gating as deletion even when the final file count is zero.
- "It is only generated output" and "it is only a cache" are not exemptions. Generated state and caches `MUST` still be removed through the owning tool's exact-path contract, never through an ad-hoc workspace-wide pattern.

## 2. Prohibited Version-Control Deletion

The following are forbidden in every SDKWork repository, by an agent or by a human-issued command:

- `git rm -r`, `git rm -rf`, `git rm -rq`, or any `git rm` carrying `-r`/`--recursive`.
- `git rm --cached -r` and `git rm --cached` over a directory or pattern.
- `git rm` whose pathspec is a directory, a glob (`*`, `?`, `[...]`), a brace expansion, or a shell-expanded list.
- `git clean -f`, `git clean -fd`, `git clean -fdx`, `git clean -x`, or any `git clean` form that removes files rather than reporting them.
- `git rm -r` composed with `.` or a repository root.
- Bulk discard used as a substitute for deletion decisions: `git reset --hard`, `git checkout -f`, or `git restore .` without an explicit path list.

Rationale (normative, not background): a recursive `git rm` stages a large number of deletions inside a single index transaction. When the process is terminated between the working-tree unlink phase and the index write phase — SIGTERM, an agent timeout, a sandbox kill, or a crash — the repository is left with entries already removed from disk and a partially written index, plus a stale `.git/index.lock`. The result is silent, non-atomic mass data loss that no single `git restore` scope obviously covers.

Required replacement:

1. Delete each intended path with `rm <file>` (the exact path), so the working tree records the deletion naturally.
2. Let `git status --short` show the `D` entries as the review artifact.
3. Stage only the enumerated paths, for example `git add -A <path> <path> ...`.
4. Commit the deletion separately from functional code changes.

## 3. Prohibited Shell And Script Deletion

Forbidden in agent-issued shell commands, ad-hoc scripts, `bin/` scripts, `scripts/`, `tools/`, `package.json` scripts, and CI steps:

- `rm -rf`, `rm -r`, `rm -f`, or `rm` with a wildcard, glob, brace expansion, recursive walk result, or unbounded variable expansion.
- `find ... -delete`, `find ... -exec rm ...`, `find ... -execdir rm ...`, or `find ... | xargs rm`.
- Loops whose body deletes: `for f in *; do rm -rf "$f"; done`, `Get-ChildItem | Remove-Item`, `dir | ForEach-Object { rm $_ }`.
- Unbounded piped deletion: `xargs rm`, `xargs -I{} rm {}`, or `xargs` over an unpinned list.
- Windows deletion forms with wildcards or recursion: `del /S /Q`, `del /F /Q *`, `rd /S /Q`, `rmdir /S /Q`.
- PowerShell deletion forms with wildcards: `Remove-Item -Recurse -Force` on a glob, `Remove-Item * -Force`, `Clear-Content` over a glob.
- Node/Python deletion of trees or globs: `fs.rm(dir, { recursive: true, force: true })` over a glob-expanded root, `rimraf` over a glob, `shutil.rmtree` over a computed or workspace-wide root, `os.remove` in a glob loop.
- `git clean` invoked from a script, `prepare` hook, `clean` hook, or workflow step.
- Any deletion whose target root is a workspace root, a repository root, `apps/`, `crates/`, `packages/`, `sdks/`, `docs/`, `database/`, `deployments/`, `.git/`, a user home directory, or a path outside the active repository root.

Additional rules:

- A script `MUST NOT` compute a deletion root from an argument, environment variable, or configuration value that it has not validated to be inside the owning module root.
- A deletion `MUST NOT` be combined in one shell invocation with a build, install, network, or publish operation. The combined command hides which step failed and makes recovery ambiguous.
- Temporary path-list files used for a deletion or a restore `MUST` live inside the repository (see section 6). Writing them to `/tmp` is forbidden on Windows, where the Git Bash path space and the native tool path space disagree and the tool reports `No such file or directory`.

## 4. Permitted Narrow Deletion

The following remain allowed, and are the required forms:

- `rm <exact/path>` and `rm -f <exact/path>` for a single named file that the task explicitly decided to remove.
- Deleting a short, literal, code-owned path list, where each entry is an exact path written in the source of the tool that owns those paths and the list is scoped to that module.
- Removing a module's own generated artifacts through its owning tool, per `CODE_STYLE_SPEC.md` §7 and `PNPM_SCRIPT_SPEC.md` §11: `pnpm clean`, `cargo clean`, or the equivalent native tool whose output directory is tool-native and explicitly declared.
- `git restore --worktree --source=HEAD -- <exact paths>` for recovery of known paths.
- `git show HEAD:<path>` for read-only baseline comparison, used instead of `git stash` (stash is a mutating, hard-to-audit operation in a multi-repository workspace).
- Read-only enumeration and verification: `ls`, `find -print`, `git status`, `git diff --stat`, `wc`, `sha256sum`, `node tools/*-check.mjs`.

Rules:

- A narrow deletion `MUST` be reported in the task result: which exact paths were removed and which task decision authorized it.
- A tool that legitimately owns a deletion list `MUST` keep the list as literals or as module-root-relative constants, `MUST` assert that every resolved path stays inside its module root, and `MUST` fail rather than proceed when a path escapes the root.

## 5. Required Sequence Before Any Deletion

Every deletion, including narrow ones, follows this sequence:

1. **Enumerate.** Write down the exact target paths before running anything. If the list cannot be written without a wildcard, the deletion is forbidden.
2. **Contain.** Verify every path resolves inside the active repository or module root. Resolve and normalize symlinks and `..` segments before deciding.
3. **Classify.** Determine whether each path is git-tracked, generated, cached, or unknown. Unknown paths are not deletion candidates; investigate first.
4. **Plan the replacement.** Prefer `rm` plus `git status`/`git add <paths>` over `git rm`, so version control records the deletion instead of performing it.
5. **Batch.** Delete at most 20 paths per batch, running `git status --short` (or the platform equivalent listing) between batches.
6. **Confirm.** Request explicit human confirmation before deleting any git-tracked path, any directory tree, any path that resolves outside the active repository root, any path list longer than 20 entries, or any target whose classification is uncertain.
7. **Report.** State the removed paths and the authorizing decision in the task result, and record the change in the daily work log when the deletion is part of repository work.

A destructive command `MUST NOT` be composed with `&&`, `;`, or a pipeline that also performs another mutating step.

## 6. Batch Recovery Contract

When an accidental or interrupted mass deletion has already occurred, the recovery `MUST` follow this contract. The naive recovery — one version-control invocation per file — is itself interrupted by the same termination cause and only partially completes.

1. Clear any stale lock left by the interrupted process (for example `.git/index.lock`) before running further version-control commands.
2. Collect the current deletion set with a read-only command, for example `git status --short | grep '^ D'`.
3. Subtract the deletions that were intended, producing the true recovery list.
4. Write the recovery list to a file **inside the repository** (a repository-relative path such as `_tmp_restore_paths.txt`). Do not write it to `/tmp`, a system temporary directory, or an OS path that the native tool chain resolves differently from the shell.
5. Perform the restore as **one** invocation over that file, for example `git restore --worktree --pathspec-from-file=<repo-relative-list>`.
6. Re-run the read-only status command and confirm the remaining deletion set equals exactly the intended deletions.
7. Report the intended-versus-unintended deletion counts, the recovered paths, and any path that could not be recovered.

Constraints:

- The recovery file `MUST` be deleted after the restore completes, using its exact path, and `MUST NOT` be committed.
- Batch-restore helpers `MUST NOT` wrap the restore in a per-path loop.
- After recovery, verify the affected surface compiles or type-checks before continuing the original task.

## 7. Build, Clean, And Operator Script Boundary

Rules:

- `pnpm clean` and equivalent cleanup commands `MUST NOT` delete git-tracked build-critical source files (`CODE_STYLE_SPEC.md` §7.1).
- `clean` implementations `MUST` delete only their own declared artifact directories, by exact path derived from the owning package or module root.
- `bin/` scripts, `deploy.sh`, `release.sh`, and `prepare-envs.sh` `MUST` follow `MODULE_BIN_SPEC.md` and `PORTABILITY_SPEC.md`, and `MUST NOT` perform pattern-driven deletion of a workspace, a repository root, or a shared install prefix.
- Operator recovery runbooks follow `OPERATIONS_SPEC.md`; a runbook step that removes deployed state `MUST` name the exact paths and state the backup precondition.
- Database and migration cleanup follows `DATABASE_SPEC.md` and `MIGRATION_SPEC.md`; destructive SQL in migration or repair scripts `MUST` be scoped by explicit predicates, never by an unqualified pattern, and `MUST` be verified inside a transaction that is rolled back during investigation.

## 8. Exceptions And Approval

Rules:

- An exception to this standard is requested and recorded through `GOVERNANCE_SPEC.md` §3 as a named compatibility or operational exception with an owner and an expiry.
- Even under an approved exception, pattern-driven deletion of a workspace root, a repository root, or a git-tracked path set is not permitted. An exception may authorize a longer **enumerated** list, a wider **named** path scope, or an automated tool that deletes a **literal** declared list — never a wildcard.
- Destructive operations on production data, deployed artifacts, or shared infrastructure always require human approval, per `SOUL.md` §1.
- A tool introduced to automate deletion `MUST` itself comply with sections 1–6 and `MUST` be reviewed under `CODE_REVIEW_SPEC.md`.

## 9. Verification

The managed discipline is propagated into every repository `AGENTS.md` by its owning sync tool, between `SDKWORK-DESTRUCTIVE-OPERATION-STANDARD` markers.

Repository compliance:

```bash
node ../sdkwork-specs/tools/sync-agent-destructive-operation-standard.mjs --root . --check
```

Workspace sweep:

```bash
node ../sdkwork-specs/tools/sync-agent-destructive-operation-standard.mjs --workspace .. --check
```

Exit code `0` means every targeted `AGENTS.md` carries the current canonical block; exit code `1` means the block is missing, stale, or the marker pair is corrupted. Refresh with `--apply`.

Pattern audit over operator scripts:

```bash
node ../sdkwork-specs/tools/check-destructive-operation-patterns.mjs --workspace ..
```

The audit is read-only and exits `0` only when no forbidden pattern is found. It scans shell, PowerShell, and cmd scripts under `bin/`, `scripts/`, `tools/`, `deployments/`, and `docker/`, plus `run:` steps in `.github/workflows/` and `package.json` scripts, and reports wildcard, glob, brace-expansion, positional-parameter, `find`-driven, `xargs`-driven, recursive `git rm`, and `git clean -f*` deletion. Use `--json` for machine-readable output.

The audit intentionally does not flag literal exact-path artifact removal. A clean run therefore means "no pattern-driven deletion", not "no deletion at all"; variable-trust questions (`rm -rf "$SOME_VAR"`) are the reviewer's responsibility under sections 3 and 5.

Additional evidence for a change that touches deletion behavior:

- A read-only audit listing every remaining destructive pattern in the touched `bin/`, `scripts/`, `tools/`, or `package.json` scripts.
- The exact replacement command for each removed pattern.
- The enumerated path list for each deletion the change introduces.

## 10. Acceptance Checklist

- [ ] Every deletion target was enumerated as an exact path before execution.
- [ ] No deletion argument position contains a wildcard, glob, brace expansion, or unbounded expansion.
- [ ] No `git rm -r` / `git rm` over a directory or pattern was issued.
- [ ] No `git clean -f*` was issued.
- [ ] `rm` plus tracked `git status`/`git add` was preferred over version-control-driven deletion.
- [ ] Batches stayed at 20 paths or fewer with a status check between batches.
- [ ] Human confirmation was obtained for tracked paths, directory trees, out-of-root paths, or lists longer than 20 entries.
- [ ] Every deleted path resolved inside the active repository or module root.
- [ ] `node ../sdkwork-specs/tools/sync-agent-destructive-operation-standard.mjs --root . --check` passes.
- [ ] The task result states the removed paths and the authorizing decision.
