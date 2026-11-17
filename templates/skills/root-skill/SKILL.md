---
name: <module-token>-<outcome>
description: Use when <situation that should trigger this skill> across this repository in order to <concrete outcome>.
owner: <repository-or-application-maintainer>
standards: <comma-separated root spec file names this skill follows>
---

# <Skill Title>

## When to use

Use this skill when <cross-module trigger>.

Do not use this skill when <module-scoped situation that belongs in that module's skills/>.

## Inputs

- <user request, change description, or release intent>
- <repository-wide files the skill reads>

## Workflow

1. <read the governing repository/application files>
2. <step naming exact paths or commands>
3. <verification step>
4. <report>

## Rules

- Follow `<root spec>.md` §<section>.
- <repository-wide prohibition>
- Do not <forbidden alternative>.

## Verification

```bash
<exact command that proves the workflow completed>
```

## Output

Report <what the agent reports> and leave <artifacts, or "no artifacts">.
