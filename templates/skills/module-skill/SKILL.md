---
name: <module-token>-<outcome>
description: Use when <situation that should trigger this skill> in order to <concrete outcome>.
owner: <team-or-owner>
module: <component name from specs/component.spec.json>
standards: <comma-separated root spec file names this skill follows>
---

# <Skill Title>

## When to use

Use this skill when <trigger>.

Do not use this skill when <situation the skill must not handle>.

## Inputs

- <user request, issue, plan, or change description>
- <files the skill reads>
- <configuration or environment it needs>

## Workflow

1. <read the governing files>
2. <make the change or run the command, naming exact paths>
3. <verify>
4. <report>

## Rules

- Follow `<root spec>.md` §<section>.
- <module-specific prohibition>
- Do not <forbidden alternative>.

## Verification

```bash
<exact command that proves the workflow completed>
```

## Output

Report <what the agent reports> and leave <artifacts, or "no artifacts">.
