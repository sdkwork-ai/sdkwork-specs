# Agent Skill Templates

Scaffold a skill from these templates and then follow `AGENT_SKILLS_SPEC.md`.

Two containers exist. Pick the owning module; never author the same skill in two places.

| Container | Location | Use for |
| --- | --- | --- |
| Repository/application root module | `<repo-or-app-root>/skills/<skill-name>/` | Repository-wide workflows: standards review, SDK generation, release, deployment, repository audit |
| Nested module | `<module-root>/skills/<skill-name>/` | Workflows owned by one authored app, package, crate, service, SDK family, or host adapter |

Files:

- `root-skill/SKILL.md`: copy to `<repo-or-app-root>/skills/<skill-name>/SKILL.md`.
- `module-skill/SKILL.md`: copy to `<module-root>/skills/<skill-name>/SKILL.md`.
- `module-skills-index.md`: copy to the owning module `skills/README.md`.

After copying:

1. Rename the directory to the skill name. It must match `^[a-z0-9]+(-[a-z0-9]+)*$` and the frontmatter `name`.
2. Replace every `<...>` placeholder.
3. Keep `description` on one line and include a `Use when` trigger sentence.
4. Keep `SKILL.md` at or below 500 lines and 32 KiB; move detail into `references/`.
5. Declare the skill by writing `skills/README.md` in the owning module that cites `AGENT_SKILLS_SPEC.md` and lists the skill.
6. Verify with `node <sdkwork-specs>/tools/check-agent-skills.mjs --root .`.
