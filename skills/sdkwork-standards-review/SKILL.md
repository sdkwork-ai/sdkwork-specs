# SDKWork Standards Review

Use this skill before changing SDKWork standards, application roots, API contracts, SDK generation rules, repository workspace metadata, or component specs in this repository.

## Inputs

- The user request or change summary.
- The affected spec files under the repository root.
- The current git diff.

## Workflow

1. Read `README.md` to identify the required canonical specs.
2. Read only the specific spec files affected by the change.
3. Check whether the change affects repository/application `.sdkwork/` rules, API route/path rules, SDK generation, runtime directories, security, or tests.
4. Update cross-references when a new standard becomes required reading.
5. Run verification:
   - `git diff --check`
   - a Markdown trailing-whitespace scan
   - targeted `rg` scans for the changed terminology
6. Report the changed standards, verification evidence, and any remaining gaps.

## Rules

- Root `specs/` files remain authoritative.
- Repository/application `.sdkwork/` rules follow `SDKWORK_WORKSPACE_SPEC.md`.
- Generated SDK output `.sdkwork/sdkwork-generator-*.json` remains generator-owned.
- Runtime `~/.sdkwork/<application-code>` remains user-private runtime state governed by `RUNTIME_DIRECTORY_SPEC.md`.
- Do not add secrets, local runtime data, generated transport output, or user-private files to `.sdkwork/`.
