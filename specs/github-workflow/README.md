# GitHub Workflow Standard — artifacts and how to run them

This directory and its neighbours hold the workflow standard as four linked
artifacts. Each one is runnable, and each one fails loudly when it drifts from the
others.

| Artifact | Path | What it owns |
|---|---|---|
| Normative model | `specs/github-workflow/model.json` | Roles, entrypoint contract, runtime-target matrix, client-architecture pairing, lane rule, pin rule, conformance statuses and exception policy |
| Specification | `GITHUB_WORKFLOW_SPEC.md` | Prose semantics; the runtime-target matrix is a generated block owned by the model |
| Conformance suite | `tools/test-github-workflow-standard.mjs` | Executable fixtures for every rule (thin entrypoints, bespoke workflow, unpinned reference, unnamed matrix lane, fork role, model agreement) |
| Workspace audit | `tools/check-agent-workflow-standard.mjs` | Per-repository verdict, configuration validity, exception register with expiry |
| Alignment tool | `tools/align-github-workflows.mjs` | Idempotent, behavior-preserving rendering of the thin entrypoints |
| Exception register | `tools/github-workflow-exceptions.json` | Debt with `reason`, `ownerAction`, `owner`, `issue`, `expiresAt` |
| Decision register | `decisions/2026-11-02-github-workflow-decision-register.md` | The product decisions the standard cannot make for a repository owner |

## Commands

```text
# 1. Model ↔ specification ↔ framework agreement (fails on drift)
node tools/gen-github-workflow-model-doc.mjs
node tools/gen-github-workflow-model-doc.mjs --write

# 2. Rule conformance (fixtures)
node --test tools/test-github-workflow-standard.mjs

# 3. Workspace verdict and debt
node tools/check-agent-workflow-standard.mjs --workspace-root .. --report
node tools/check-agent-workflow-standard.mjs --workspace-root .. --json

# 4. Align one repository (dry run first)
node tools/align-github-workflows.mjs --workspace-root .. --repo sdkwork-example
node tools/align-github-workflows.mjs --workspace-root .. --repo sdkwork-example --write

# 5. Render an application's entrypoints from its configuration
node ../sdkwork-github-workflow/scripts/render-app-workflows.mjs --root ..\\sdkwork-example --write
```

## Reading the verdict

- `aligned` — every applicable rule passes and the configuration passes the
  framework planner.
- `tracked` — a complete, unexpired register entry defers the remaining findings;
  the report prints `issue · owner · expiresAt · days left`.
- `expired/incomplete` — the entry itself is a conformance failure; renew the
  justification or clear the debt.
- `need alignment` — an unregistered deviation; the report prints the rule.

Configuration debt is reported separately from workflow alignment: a repository
can have aligned entrypoints and still be unable to package because its
`agent.workflow.json` is a placeholder. Both counts are printed on every run.

## Conformance model

A repository is conformant when its applicable profiles pass
(`core`, `packaging` where it ships artifacts, `release` where it publishes, and
`practices` for the documentation entrypoints). A new application mode is a row
in the model's `runtimeTargets` plus a framework toolchain hook — never a new
workflow.
