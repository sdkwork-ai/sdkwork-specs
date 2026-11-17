# SDKWork Workspace Metadata

This directory follows `SDKWORK_WORKSPACE_SPEC.md`.

It stores repository-local SDKWork development knowledge:

- `plugins/` contains repository-local plugins or plugin placeholders.
- Agent skills are not stored here. They live in the repository-root `skills/` directory.

Do not store secrets, API keys, runtime files, generated SDK transport output, or user-private `~/.sdkwork` data here. Generated SDK output may have its own `.sdkwork/sdkwork-generator-*.json` control-plane files under generated package directories; those are owned by `sdkgen` and are not repository workspace metadata.

## Execution References

- Agent entrypoint: `../AGENTS.md`
- Shared execution soul: `../SOUL.md`
- Workspace metadata standard: `../SDKWORK_WORKSPACE_SPEC.md`
