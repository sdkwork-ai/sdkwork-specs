---
name: sdkwork-standards-review
description: Use when changing SDKWork standards, application roots, API contracts, SDK generation rules, repository workspace metadata, or component specs in this repository.
owner: sdkwork-specs maintainers
standards: SDKWORK_WORKSPACE_SPEC.md, COMPONENT_SPEC.md, API_SPEC.md, SDK_SPEC.md, GOVERNANCE_SPEC.md, AGENT_SKILLS_SPEC.md
---

# SDKWork Standards Review

## When to use

Use this skill before changing SDKWork standards, application roots, API contracts, SDK generation rules, repository workspace metadata, or component specs in this repository.

Do not use it for a consumer application's feature work unless that change alters a standard or a cross-repository contract.

## Inputs

- The user request or change summary.
- The affected spec files under the repository root.
- The current git diff.

## Workflow

1. Read `README.md` to identify the required canonical specs.
2. Read only the specific spec files affected by the change.
3. Check whether the change affects repository/application `.sdkwork/` rules, agent skills, API route/path rules, SDK generation, runtime directories, security, or tests.
4. Update cross-references when a new standard becomes required reading, including the README layer table, the README required-standards table, the development entry matrix, and the acceptance checklists of the affected specs.
5. Run verification.

## Rules

- Root `specs/` files remain authoritative.
- Repository/application `.sdkwork/` rules follow `SDKWORK_WORKSPACE_SPEC.md`.
- Agent skill packages, registration, and discovery follow `AGENT_SKILLS_SPEC.md`.
- Generated SDK output `.sdkwork/sdkwork-generator-*.json` remains generator-owned.
- Runtime `~/.sdkwork/<application-code>` remains user-private runtime state governed by `RUNTIME_DIRECTORY_SPEC.md`.
- Do not add secrets, local runtime data, generated transport output, or user-private files to `.sdkwork/`.

## Verification

```bash
git diff --check
node tools/check-agent-skills.mjs --root .
```

Then run the targeted terminology scans for the changed standard and report their output.

## Output

Report the changed standards, the verification commands and their output, and any remaining gap or unresolved ownership question.
