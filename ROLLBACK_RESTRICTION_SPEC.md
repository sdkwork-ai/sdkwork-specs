# Rollback Restriction Standard

- Version: 1.0
- Scope: every agent, automation, script, hook, workflow, exception, and operator action that can move, restore, reset, or discard version-control state — refs, branches, tags, the index, the working tree, stashes, reflogs, and remote refs — inside an SDKWork workspace
- Related: `SOUL.md`, `AGENTS_SPEC.md`, `DESTRUCTIVE_OPERATION_SPEC.md`, `CODE_STYLE_SPEC.md`, `ENGINEERING_WORKFLOW_SPEC.md`, `MIGRATION_SPEC.md`, `RELEASE_SPEC.md`, `QUALITY_GATE_SPEC.md`, `CODE_REVIEW_SPEC.md`, `GOVERNANCE_SPEC.md`, `TEST_SPEC.md`

This standard exists because a single repository lost multiple days of accumulated work to a **rollback**, not to a deletion. A stale `origin/main` baseline was fetched, `HEAD` was reset onto it, and a bulk `git add -A` committed the stale snapshot back into history — replacing the current tree with an older one while the commit message described an unrelated refactor. Nothing was "deleted" in the obvious sense; the work was simply overwritten by an earlier state. The recovery then carried a second hazard: repairing the damage by resetting to the parent revision would have discarded that commit's legitimate additions as well.

The rule is therefore absolute: **an error is fixed forward. Version-control history is never rewound to make an error disappear.**

## 1. Core Prohibition

Rules:

- A rollback — any operation that moves a ref, resets the index or the working tree to an earlier state, discards uncommitted or committed work, or rewrites published history — `MUST NOT` be used as the remedy for a defect. Defects include a build failure, a type error, a lint failure, a failing test, a merge conflict, a runtime regression, a bad refactor, and an unclear diff.
- A defect `MUST` be repaired forward, by adding, editing, or restoring content. History `MUST NOT` be rewound to remove the revision or the edit that introduced the defect.
- "The change is wrong, so undo it" is not an authorization. Discarding work requires a separate, explicit, human-issued instruction that names the target ref and the discarded span (section 8). Absent that instruction, the default is unambiguous: keep the content and add a corrective commit.
- An agent `MUST NOT` infer a rollback instruction from context or tone. "Fix it", "it's broken", "this is a mess", "start over", "clean this up", "get back to a working state", "just revert it", and "退回" are not rollback instructions. If the intent is ambiguous, the agent `MUST` stop and ask before touching version-control state (section 8).
- The distinction is mechanical, not stylistic: a **corrective commit** adds a revision on top of the existing work and keeps every prior revision reachable; a **rollback** removes revisions from the reachable graph. Only the first is permitted by default.
- A failing gate is evidence to be investigated, not a trigger to be silenced. An agent that cannot explain *why* a gate fails `MUST` report the failure and stop, rather than making it disappear by moving the tree.

## 2. Prohibited Operations

Forbidden in every SDKWork repository, by an agent or by a human-issued command, unless section 8 applies. This list is deliberately broader than `DESTRUCTIVE_OPERATION_SPEC.md` section 2, which governs deletion, not state movement.

Local state movement:

- `git reset --hard` in any form, with any target.
- `git reset --merge`, `git reset --keep`, and `git reset <ref>` used to discard staged or working-tree content.
- `git reset` whose target is already discarded, superseded, or is not an ancestor of the current `HEAD`.
- `git checkout -f`, `git checkout --force <ref>`, `git switch --force <ref>`, `git switch -f <ref>`, and `git switch --discard-changes`.
- `git restore --source=<ref> --worktree .`, `git restore --staged` used to unstage toward a discarded ref, and any `git restore` / `git checkout <ref> -- <path>` whose pathspec is a directory, a glob, a brace expansion, or the repository root.
- `git revert` used as a reflex remedy for a defect. It is permitted only as a reviewed, intentional, separately committed decision under section 8, because it discards a reviewed change wholesale instead of repairing it.
- `git stash` used to park work so that a failure stops being visible, `git stash drop`, `git stash clear`, and `git stash pop` over a conflict whose resolution is unresolved.
- `git branch -D`, `git branch -d` on a branch carrying unmerged work, and `git branch -m` used to move a ref out of the way.
- `git update-ref -d`, `git symbolic-ref` rewriting, and direct edits to the ref files under `.git/refs/` or `.git/packed-refs`.
- `git reflog expire`, `git gc --prune=now`, `git gc --aggressive` on a repository under investigation, and `git prune`. These destroy the recovery surface that a restore depends on.

History rewriting:

- `git commit --amend` over a commit that is already pushed or that is the base of another branch.
- `git rebase`, `git rebase -i`, `git rebase --onto`, and `git rebase --root`.
- `git filter-branch`, `git filter-repo`, and any scripted equivalent that rewrites existing commits.
- `git cherry-pick` used to construct a replacement history in place of the existing one.

Remote state movement:

- `git push --force` and `git push --force-with-lease` to any shared or protected branch.
- `git push --delete`, `git push origin :<branch>`, and tag deletion on the remote.
- `git fetch --prune` or `git remote prune` immediately followed by a reset or checkout onto the newly pruned ref.

Working-tree/state hybrids already governed elsewhere:

- `git clean -f`, `git clean -fd`, `git clean -fdx`, `git worktree remove --force`, and `git rm -r` remain forbidden per `DESTRUCTIVE_OPERATION_SPEC.md` section 2 and section 3. This standard does not relax them.

Rationale (normative, not background): each of the operations above removes reachable content in one step that no later reader can distinguish from a deliberate decision. The damage is silent precisely because the resulting tree is *valid* — it builds, it tests, it commits. Only a blob-level comparison against an earlier snapshot reveals that days of work were replaced by an older state. An agent cannot detect this by inspecting the diff it is about to write; it can only avoid producing it.

## 3. Permitted Recovery Direction

Recovery `MUST` move content *into* the working tree, never out of it. The permitted direction is additive and enumerable:

- `git restore --worktree --source=HEAD -- <exact enumerated paths>` — recover tracked files from the current commit.
- `git restore --worktree --source=<good-ref> -- <exact enumerated paths>` — reintroduce known-good content from a named revision.
- `git checkout <good-ref> --pathspec-from-file=<repo-relative-list>` — the bulk form of the same operation, and the only permitted bulk form. The path list `MUST` be written to a file **inside the repository** before the command runs.
- `git show <ref>:<path> > <path>` and `git cat-file blob <oid> > <path>` for a single file whose source revision is known.
- A new corrective commit authored on top of the current tip.

Rules:

- Every one of these forms is additive with respect to the index and the ref graph: it writes file content and leaves every existing revision reachable. This is what distinguishes it from section 2.
- The pathspec `MUST` be an explicit enumerated list. A directory, a glob, a brace expansion, or the repository root is forbidden even in the permitted forms, because the same non-atomic bulk hazard described in `DESTRUCTIVE_OPERATION_SPEC.md` section 2 applies.
- A restore `MUST NOT` be performed per-path in a shell loop. Loop one version-control call per path only when the list is short and the failure mode cannot leave a half-restored tree; otherwise use a single `--pathspec-from-file` invocation.
- Temporary path-list files `MUST` live inside the repository. Writing them to `/tmp` is forbidden on Windows, where the Git Bash path space and the native tool path space disagree (see `DESTRUCTIVE_OPERATION_SPEC.md` section 6).
- A path list written by a script `MUST` be normalized to LF line endings before it is consumed. A CRLF-terminated list makes the final entry unmatchable and the tool reports `pathspec ... did not match`.
- A restore `MUST NOT` be combined in one shell invocation with a build, install, network, publish, or commit step.
- After a restore, the recovered paths `MUST` be re-verified against the source revision by object hash, not by visual inspection (section 9).

## 4. Evidence Requirement Before Any Restore

A bulk restore is itself a bulk state change. It `MUST NOT` be issued on suspicion.

Rules:

- Before restoring, the operator `MUST` establish which revision is good, which revision is damaged, and by what mechanism. Assumption, intuition, and "it looks older" are not evidence.
- The required evidence is a three-snapshot blob comparison: for each suspect file, compare the content hash of the damaged revision against (a) its parent revision and (b) the candidate older snapshot.
  - A file that is byte-identical to the **older snapshot** and different from the **parent** was *replaced* by the snapshot. Its change did not originate in the damaged commit.
  - A file that differs from both was *authored* in the damaged revision and is a legitimate change. Restoring it would destroy real work.
  - A file present in the parent and absent from the damaged revision was *deleted* by it.
- The classification `MUST` be produced as a written report listing the reverted, deleted, added, and normally-edited sets, with counts, before any restore command runs. The report is the review artifact.
- The restore surface is the **relative complement**, not the whole tree: `changed_by_the_damage` minus `changed_by_legitimate_work_after_it`, intersected with the paths that actually carry the lost behavior. Restoring the whole tree wholesale is forbidden, because it discards every legitimate addition the damaged revision made.
- Files the damaged revision *added* and that are not themselves rollback artifacts `MUST` be kept. Reviving a snapshot must not be implemented as "check out the old commit everywhere".
- The good revision `MUST` be identified by ref, not by working-tree appearance. Where a remote head is the question, the answer `MUST` come from a live remote query (`git ls-remote`), never from a local tracking ref, which in a sandbox or a stale clone may be arbitrarily behind.
- If the evidence does not cleanly resolve the three snapshots, the operator `MUST` stop and report rather than restore.

## 5. Mandatory Protection Before Any Restore

Loss of work `MUST` be impossible before the first restore command runs.

Rules:

- Uncommitted local modifications `MUST` be committed before any restore. A checkpoint commit is the mechanism: it makes the current state a reachable revision, so no subsequent operation can orphan it. A restore that begins on a dirty tree with no checkpoint is forbidden.
- The pre-restore state `MUST` additionally be captured as a named branch **and** a tag, so that a later divergence in branch naming cannot hide it. Suggested naming: `backup/pre-<operation>-<short-sha>` and `<operation>-<YYYYMMDD>`.
- A machine-readable patch of the pre-restore diff `MUST` be written to disk before the restore, so the change set survives even if the branch and tag are lost.
- The backup `MUST` be verified to exist and to point at the intended commit before the restore proceeds. "I created it earlier" is not verification.
- The backup branch and tag `MUST NOT` be deleted as part of the restore, the corrective commit, or the push that follows. Cleaning up a backup is a separate, later, explicitly authorized action.
- If a pre-existing backup already covers the same commit, it `MUST` be reused rather than recreated under a new name, so that repeated operations do not accumulate indistinguishable refs.

## 6. Fix Forward On Defect

The default response to any defect found after a restore, a merge, or a normal change is to fix it forward.

Rules:

- A defect introduced by a restore `MUST` be repaired by writing the correct code, not by un-restoring. Un-restoring is a rollback and falls under section 1.
- Where a repair existed before the restore and the restore did not carry it, the repair `MUST` be re-applied forward — as a new commit — rather than being recovered by moving refs back.
- A repair that is needed but whose original losing revision is unknown `MUST` be reconstructed from evidence (the backup patch, the pre-restore branch, a sibling repository, a log), and the reconstruction committed with a message that names the source of truth.
- A gate that fails after a restore `MUST` be triaged into "caused by the restore" and "pre-existing". The second class `MUST` be reported and left untouched; it is not evidence that the restore was wrong, and it is never grounds for rolling the restore back.
  - `MUST NOT` assume a failing gate is pre-existing. Each pre-existing claim `MUST` be backed by showing the same failure at the revision before the operation (for example by reading the file and the test at that revision with `git show <ref>:<path>`), not by reasoning about intent.
- A `--force` / `--no-verify` / `--no-gpg-sign` bypass of a hook, a signature, or a gate in order to land a repair is forbidden without the section 8 authorization, and is never a substitute for the repair.

## 7. Branch And Remote Discipline

Rules:

- The current branch `MUST NOT` be changed to a detached state, to an older ref, or to a different branch in order to "get a clean starting point". Work continues on the branch that owns the work.
- A published branch `MUST` be corrected by adding commits. Its existing commits are immutable; forcing the remote to match a rewritten local history is forbidden (section 2).
- When the local branch and the remote head disagree, the operator `MUST` first determine which side is ahead and whether the remote already carries the damage or the fix.
  - If the remote carries the damage, the fix `MUST` be pushed as a new commit on top (a normal fast-forward), after explicit confirmation.
  - If a rewrite would be the only way to publish, the operator `MUST` stop and request authorization; it is never the agent's decision.
- A `git fetch` whose ref writes are discarded by the environment (a sandbox that reports success but leaves local tracking refs stale) `MUST NOT` be treated as evidence about the remote. The operator `MUST` confirm with `git ls-remote <remote> <branch>` and record the returned object id.
- A merge `MUST` produce a real merge commit. Squashing an upstream or cross-repository merge, or rebasing it, is a history rewrite under section 2.

## 8. Exception And Approval

The prohibitions in section 2 are not waived by the requester's frustration, urgency, or confidence. They are waived only by an explicit, attributable, human-issued instruction.

A valid rollback authorization `MUST` satisfy all of the following:

- It is issued by a human, not inferred by an agent, from a non-interactive context, or reconstructed from an earlier conversation.
- It names the operation (for example "reset the branch to `<ref>`" or "drop the last commit"), the target ref, and the span of history or work to be discarded.
- It states the reason, and the reason is a decision about the content (the work is unwanted), not a reaction to a failure (the work is broken).
- It explicitly acknowledges the loss.

Rules:

- The authorization `MUST` be recorded in the commit message or the operation log that follows, quoting the instruction and naming its issuer and time. An unrecorded rollback is indistinguishable from an accident.
- Section 5 protection applies to an authorized rollback as well. Authorization removes the prohibition; it does not remove the requirement to be able to recover.
- An exception `MUST` be a single, bounded operation against named refs. A standing authorization ("you may roll back when needed") `MUST NOT` be accepted or honoured.
- If the request is ambiguous — "go back", "undo that", "restore the old version" — the agent `MUST` ask precisely: which ref, which commit range, which files, and does the instruction intend to *discard* the work or to *restore lost* work. The last distinction decides whether section 3 or section 2 applies.
- Confirmed destructive operations `MUST` follow `GOVERNANCE_SPEC.md` section 3 and be logged as exceptions when the standard is otherwise applicable.

## 9. Verification

Verification after a restore `MUST` be object-level, not visual.

- The recovery `MUST` be checked by file accounting against the source revision: the set of files differing from the good revision `MUST` equal the intended restore surface, and the intended restore surface `MUST` have no missing entries.
- Each restored path `MUST` be confirmed identical to the good revision by content hash (`git hash-object <path>` compared with `git ls-tree <ref> -- <path>`), not by reading the file.
- The set of files changed relative to the good revision `MUST` be enumerated and explained before the work is declared complete. An unexplained file is an unverified restore.
- The gates that cover the restored surface `MUST` be re-run, and each remaining failure classified per section 6.
- The repository `MUST` be left with: the checkpoint commit, the backup branch and tag, the restore commit, and the forward-fix commits, all reachable. A restore that leaves an orphaned or detached intermediate state is not complete.
- No rewrite or rollback operation `MUST` appear in the operation transcript of the session. The correct transcript for a repair reads: diagnose, checkpoint, protect, restore additively, commit, fix forward, verify.

## 10. Acceptance Checklist

Before any work touching version-control state is declared complete:

- [ ] No section 2 operation was issued, or a section 8 authorization exists, is quoted, and is recorded in the commit message.
- [ ] Local modifications were committed before the operation.
- [ ] A backup branch, a backup tag, and a patch file exist and were verified to point at the pre-operation state.
- [ ] The three-snapshot evidence report exists and names the good, damaged, and snapshot revisions with counts per class.
- [ ] The restore used an explicit enumerated path list, applied additively, with no directory, glob, or root pathspec.
- [ ] Files added by the damaged revision were kept rather than discarded.
- [ ] Every defect found afterwards was fixed forward with a new commit.
- [ ] Every claim that a failing gate is pre-existing was verified at the prior revision.
- [ ] The corrective state was published without a force push, or a force push was separately and explicitly authorized.
- [ ] The final state is reachable from the branch tip, and no revision carrying original work was orphaned.

Verify the propagated block in a repository with:

```bash
node ../sdkwork-specs/tools/sync-agent-rollback-restriction-standard.mjs --root . --check
```
