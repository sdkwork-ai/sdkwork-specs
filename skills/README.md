# SDKWork Skills

Repository-wide agent skills for `sdkwork-specs` live under:

```text
skills/<skill-name>/SKILL.md
```

Each skill follows `../AGENT_SKILLS_SPEC.md` and `../SDKWORK_WORKSPACE_SPEC.md`.
Names use lowercase kebab-case and equal the frontmatter `name`. This file is the declaration index:
it cites the standard and lists every skill. Skills may include `references/`, `scripts/`, or
`assets/` when those files are part of the workflow.

Current skills:

- `sdkwork-standards-review` - review workflow for changes to SDKWork standards, repository workspace metadata, API/SDK rules, and related cross-references.

Verify with:

```bash
node tools/check-agent-skills.mjs --root .
```
