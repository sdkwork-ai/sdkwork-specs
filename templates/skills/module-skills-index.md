# <Module> Agent Skills

Agent skills owned by `<module-root>` (a repository/application root or a nested authored module).
Contract: `AGENT_SKILLS_SPEC.md`.

Skills are declared and indexed here. Each entry states the skill name, when it triggers, and its relative path. A `skills/` directory without this declaration is read as product data, not agent skills.

| Skill | Use when | Path |
| --- | --- | --- |
| `<skill-name>` | <trigger> | `skills/<skill-name>/` |

Rules:

- Each skill directory has a `SKILL.md` entrypoint with flat frontmatter (`name`, `description`) and the six required sections.
- This file lists skills; it does not copy their bodies.
- The index must cite `AGENT_SKILLS_SPEC.md`; this template does.
- New skills start here, not at a host discovery path such as `.agents/skills/`, and not under `.sdkwork/`.
