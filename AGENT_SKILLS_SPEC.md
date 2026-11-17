# Agent Skills Standard

- Version: 1.1
- Scope: every authored SDKWork module, repository root, and application root that stores agent skills, and every agent, harness, or CI job that reads them
- Related: `SDKWORK_WORKSPACE_SPEC.md`, `COMPONENT_SPEC.md`, `AGENTS_SPEC.md`, `NAMING_SPEC.md`, `TEST_SPEC.md`, `DOCUMENTATION_SPEC.md`, `CODE_REVIEW_SPEC.md`, `GOVERNANCE_SPEC.md`, `DESTRUCTIVE_OPERATION_SPEC.md`, `SOUL.md`

This standard defines where an SDKWork agent skill is authored, what a skill package contains, how
`SKILL.md` is written, how a skill is declared and discovered, and how it is verified.

A skill lives in the `skills/` directory of the module that owns it. A repository root and an
application root are themselves authored modules, so repository-wide skills live in
`<repo-or-application-root>/skills/`. The former `.sdkwork/skills/` location is retired.

The format follows the open Agent Skills format: a directory per skill, a `SKILL.md` entrypoint, and
YAML frontmatter carrying `name` and `description`. SDKWork narrows that format; it does not replace
it.

## 1. One Skill Container

Rules:

- An **SDKWork skill** is source-controlled agent knowledge: a reusable workflow that tells an agent
  when to use it, what it reads, what it may run, and which standards it follows.
- A skill `MUST` live at `<module-root>/skills/<skill-name>/SKILL.md`. There is exactly one
  authoritative container: the `skills/` directory of the owning module.
- A repository root and an application root are authored modules. Their `skills/` holds
  repository-wide or application-wide workflows: standards review, SDK generation, release,
  deployment, repository audit.
- A nested authored module — package, crate, service, SDK family, host adapter, static web root —
  holds its own workflows in its own `skills/` directory.
- A skill `MUST NOT` exist in two places at once. The authoritative copy is in the owning module;
  harness discovery paths are pointers only (section 8).
- `.sdkwork/` is repository/application workspace metadata: plugins, manifests, and local state. It
  `MUST NOT` contain agent skills. `.sdkwork/skills/` is a retired location; existing copies migrate
  to `<module-root>/skills/` (section 9).
- A product feature that ships skill packages as application data — a builtin skill catalog, a
  marketplace asset tree, or an app-managed pack under `assets/skills/` — is not an agent skill
  scope. It stays governed by the application asset and product contracts, and its index `MUST NOT`
  cite this standard (section 2).
- Skills `MUST NOT` become a second source of truth. A skill describes how to execute work;
  contracts stay in `sdkwork-specs/*_SPEC.md`, module `specs/`, and manifests.

## 2. Skills Directory

Every module that ships agent workflows `MUST` contain:

```text
<module-root>/
  specs/
    component.spec.json
  skills/
    README.md              # required when skills/ exists
    <skill-name>/
      SKILL.md             # required entrypoint
      references/          # optional, deep detail
      scripts/             # optional, deterministic helpers
      assets/              # optional, workflow-only assets
```

Rules:

- `skills/` sits beside `specs/` and has a distinct job: `specs/` declares the module contract,
  `skills/` declares how an agent works on the module. Neither replaces the other.
- `skills/README.md` is the declaration and index for the owning module. It `MUST` cite
  `AGENT_SKILLS_SPEC.md`, list every skill with its trigger and relative path, and `MUST NOT` copy
  skill bodies.
- A module `skills/` directory whose `README.md` does not cite this standard is read as product data,
  not as agent skills. The verifier reports a directory that holds `SKILL.md` entries without that
  declaration as a warning.
- A module with no agent workflows `MUST NOT` create an empty `skills/` directory.
- A module `MAY` ship several skills. Each skill directory is one job; a directory that bundles
  unrelated workflows `MUST` be split.
- Repository-wide and nested-module skills are each listed in their owning module
  `skills/README.md`. There is no separate workspace-level skills index.
- Generated SDK output, vendored upstream trees under `external/`, `third_party/`, or `vendor/`, and
  build output roots `MUST NOT` contain authored skills.

## 3. Skill Package Naming

Rules:

- A skill directory name is the skill name. It `MUST` match `^[a-z0-9]+(-[a-z0-9]+)*$`, `MUST` be 1 to
  64 characters, and `MUST` equal the frontmatter `name`.
- A skill name `MUST` be unique inside the owning repository or application across every module
  `skills/` directory. Ambiguous duplicates are a defect, not a specialization.
- A skill owned by a nested module `SHOULD` start with that module or domain token, such as
  `cloudrouter-sdk-generation` or `iam-login-bootstrap`.
- Forbidden names: `skill`, `skills`, `helper`, `utils`, `util`, `common`, `misc`, `module`, `agent`,
  and any single generic word that does not name an outcome.
- Renaming a skill is a public-discovery change. It follows `NAMING_SPEC.md` §5.1 and requires
  updating every `skills/README.md` that lists the old name in the same change.
- Naming authority: `NAMING_SPEC.md` §5.1. This section states the skill-specific application of
  that rule set.

## 4. SKILL.md Contract

`SKILL.md` `MUST` begin with a YAML frontmatter block delimited by `---` lines:

```yaml
---
name: cloudrouter-sdk-generation
description: Use when regenerating the SDKWork CloudRouter OpenAPI specs and generated TypeScript SDK packages from the project API contract manifest.
license: Apache-2.0
allowed-tools: Read, Grep, Glob, Bash
owner: cloudrouter-team
module: sdkwork-cloudrouter
standards: SDK_SPEC.md, SDK_WORKSPACE_GENERATION_SPEC.md
---
```

Rules:

- `name` is required. It `MUST` equal the skill directory name.
- `description` is required. It `MUST` be one line, at most 1024 characters, written in the third
  person, and `MUST` contain a `Use when` trigger sentence that states the situation and the outcome.
- `license`, `allowed-tools`, `owner`, `module`, and `standards` are optional. `allowed-tools` is a
  harness hint and carries no authority.
- Frontmatter `MUST` use flat `key: value` scalars only. Nested maps, YAML lists, block scalars,
  anchors, and multi-line values are forbidden, so that every harness and validator reads the same
  fields.
- Values `MAY` be quoted with single or double quotes. A value that contains `:` `#` or a leading `-`
  `MUST` be quoted.
- The body `MUST` start with a single level-1 heading naming the skill, followed by these level-2
  sections in this order: `When to use`, `Inputs`, `Workflow`, `Rules`, `Verification`, `Output`.
- `When to use` states the trigger and the situations where the skill `MUST NOT` be used.
- `Inputs` lists the request material, files, and configuration the skill reads.
- `Workflow` is an ordered, executable sequence. Steps that mutate files or run commands `MUST` name
  the exact paths or commands.
- `Rules` cites the governing root specs by relative path and lists the prohibitions specific to this
  workflow. It `MUST NOT` restate a root spec body.
- `Verification` lists the exact commands that prove the workflow completed.
- `Output` states what the agent reports and what artifacts, if any, it leaves behind.

## 5. Content, Size, And Progressive Disclosure

Rules:

- `SKILL.md` `MUST` stay at or below 500 lines and at or below 32 KiB. Frontmatter plus the level-1
  heading is what a harness may preload; the rest is loaded only after the skill triggers.
- Detail that would exceed the limit `MUST` move into `references/`. Each referenced file `MUST` be
  listed in `SKILL.md` with the condition that makes it worth reading.
- `references/` holds prose and examples. It `MUST NOT` hold executable logic.
- `scripts/` holds deterministic helpers only: same input, same output, no hidden state, no
  interactive prompt, and no network call unless `SKILL.md` documents the service, the credential
  source, and a dry-run path.
- Shell scripts under a skill's `scripts/` follow `PORTABILITY_SPEC.md`. Node scripts follow
  `TYPESCRIPT_CODE_SPEC.md`. Rust or Python helpers keep their file header comments and documented
  invocation.
- `assets/` holds files the workflow needs at run time: templates, prompt fragments, fixture inputs.
  It `MUST NOT` hold product media, generated SDK output, or build artifacts.
- A skill `MUST` be usable without reading any file outside the repository except the root
  `sdkwork-specs/` standards it cites.
- A skill `MUST NOT` copy a root spec body, a module README body, or a generated OpenAPI document. It
  cites the path and states only the decision the agent must make.

## 6. Safety And Boundary Rules

Rules:

- A skill `MUST NOT` contain secrets, tokens, API keys, private certificates, provider account IDs,
  local credential paths, or environment dumps.
- A skill `MUST NOT` contain machine-absolute paths. Repository-relative paths, documented SDKWork
  canonical paths, and `sdkwork-specs/` relative paths are the only allowed path forms.
- A skill `MUST NOT` contain product or application source code, generated SDK output, runtime
  databases, logs, caches, or user-private files.
- A skill `MUST NOT` weaken a root spec, bypass SDK generation, replace a generated SDK client with
  raw HTTP, or redefine API, security, privacy, runtime, deployment, or naming rules.
- A skill `MUST NOT` instruct an agent to run a destructive command outside
  `DESTRUCTIVE_OPERATION_SPEC.md`. When a workflow deletes files, it enumerates the exact paths and
  keeps the deletion separate from build, install, or publish steps.
- A skill `MUST NOT` instruct an agent to bypass a quality gate, hook, signature, review, or evidence
  requirement, or to use `--force`, `--no-verify`, or `--no-gpg-sign` to land a change.
- A skill that reads tenant, personal, or regulated data follows `PRIVACY_SPEC.md` and states the
  minimization and retention behavior in `Rules`.
- A skill `MUST NOT` assume a user-global skill, plugin, or machine-specific tool exists. Required
  tooling is declared in `Inputs`.

## 7. Discovery And Precedence

Agents resolve skills in this order:

1. Nearest `AGENTS.md`.
2. `agent.app.config.json` when present.
3. Nearest module `specs/README.md` and `specs/component.spec.json` when the task touches an authored
   module.
4. Nearest owning module `skills/` when the task touches that module's workflow. At a repository or
   application root, this is the root `skills/` directory and it applies repository-wide.
5. Repository or application root `specs/`.
6. Global `sdkwork-specs/` standards referenced by relative path.
7. User-global skills or plugins.

Rules:

- Module-scope skills apply only inside their module. They `MUST NOT` override a repository-wide
  skill, and a repository-wide skill `MUST NOT` redefine a module-specific workflow.
- A skill `MUST` be listed in its owning module `skills/README.md`. A skill that no index points at
  is not discoverable and is a defect.
- `AGENTS.md` names the skill location generically, such as `skills/`. It does not enumerate every
  skill name, because skills change more often than entrypoints.
- When a task matches no indexed skill, the agent proceeds with the governing specs. A missing skill
  is not permission to invent a workflow.
- Two skills with the same name are an error, not a precedence rule. Resolve by renaming with a
  module token.
- `.sdkwork/skills/` is not a discovery layer. It is retired and must migrate.

## 8. Host Discovery Compatibility Layer

Some agent harnesses load skills only from a fixed repository-relative path such as
`.agents/skills/`, `.claude/skills/`, or `agent/skills/`.

Rules:

- Those paths are a **host discovery layer**, never an authoritative skill location. The
  authoritative copy remains `<module-root>/skills/`.
- A compatibility entry `MAY` exist at a host path. When it exists, its frontmatter `name` and
  `description` `MUST` match the authoritative skill exactly, and its body `MUST` be a short pointer,
  at most 12 non-empty lines, that names the authoritative repository-relative path.
- A compatibility entry `MUST NOT` carry a workflow body that the authoritative copy does not carry.
  Duplicated bodies drift and are treated as an unapproved second standard.
- A compatibility entry without a matching authoritative skill is an orphan and `MUST` be removed in
  the change that retires the skill.
- Repositories with pre-existing full-body mirrors get a migration window recorded through
  `GOVERNANCE_SPEC.md` §3. The verifier reports them as warnings during that window and as errors
  under `--strict` after it.
- The verifier checks the host layer only when `--host-layer` is passed, because a skills-marketplace
  product legitimately stores skill packages as application data.
- A repository `MUST NOT` introduce a new authoritative skill at a host path. New skills start at the
  canonical location.

## 9. Lifecycle, Ownership, And Migration

Rules:

- The module owner owns its skills. A repository-wide skill is owned by the repository or application
  maintainer named in `owner`.
- A skill `MUST` change in the same commit as the workflow it describes. A skill that contradicts the
  code it describes is a defect, not documentation debt.
- Review of a skill change follows `CODE_REVIEW_SPEC.md`. A skill that weakens a standard requires the
  same approval as the standard change.
- There is no `version` field. Git history is the version, and the frontmatter stays minimal so
  harnesses can preload it.
- Retiring a skill happens in the same change that removes its index entry, its compatibility entry,
  and its directory. Deletion follows `DESTRUCTIVE_OPERATION_SPEC.md` §5: enumerate exact paths,
  delete with `rm <exact/path>`, and commit the deletion separately.
- Migrating `.sdkwork/skills/<skill-name>/` to `<module-root>/skills/<skill-name>/` is one repository
  at a time. The migration moves the directory, updates the owning `skills/README.md`, removes the
  retired `.sdkwork/skills/README.md`, records the old and new paths, and runs the verifier.
- Migrating a full-body `.agents/skills/` mirror follows section 8: the authoritative body moves to
  `<module-root>/skills/` and the host path becomes a pointer.
- A migration `MUST NOT` leave the same skill at both the old and the new location.

## 10. Verification

Verify a repository or application root:

```bash
node <sdkwork-specs>/tools/check-agent-skills.mjs --root .
```

Verify every repository root in a multi-repository checkout:

```bash
node <sdkwork-specs>/tools/check-agent-skills.mjs --workspace ..
```

The checker reports:

- A `skills/` directory with no `README.md` and no skill entries, or a `skills/` directory that holds
  `SKILL.md` entries without a `README.md` citing this standard. The first is an error; the second is
  a warning because the directory may be product data.
- A declared `skills/` directory with no `<skill-name>/SKILL.md` entries.
- A skill directory whose name is not lowercase kebab-case, that lacks `SKILL.md`, or whose name is
  used by another module.
- A `SKILL.md` with missing, malformed, or non-flat frontmatter, a `name` that differs from the
  directory, or a `description` without a `Use when` trigger.
- A `SKILL.md` over the line or byte limit, or missing a required section.
- A `skills/` directory under a root that is not an authored module.
- A declared `skills/` directory whose index omits a skill.
- A retired `.sdkwork/skills/` directory. This is a warning during the migration window and an error
  under `--strict`.
- `--host-layer`: a host compatibility entry that mismatches or orphans its authoritative skill.
- Prohibited content: secrets, machine-absolute paths, and vendored dependency, build, generated, or
  cache directories inside the skill package.

Exit code is `1` when any error is reported and `0` when only warnings are reported. `--strict`
promotes warnings to errors; use it after a recorded migration window in `GOVERNANCE_SPEC.md` §3 has
closed. `--json` prints the same result as machine-readable JSON.

## 11. Acceptance Checklist

- [ ] Every skill lives at `<module-root>/skills/<skill-name>/SKILL.md` in its owning module.
- [ ] No skill exists at `.sdkwork/skills/`, at a host discovery path as an authoritative copy, or in
  two modules at once.
- [ ] Every `skills/` directory that ships agent skills has a `README.md` citing this standard and
  listing every skill.
- [ ] A `skills/` directory used as product data has an index that says so and does not cite this
  standard.
- [ ] Every skill directory name is lowercase kebab-case, at most 64 characters, and equals its
  frontmatter `name`.
- [ ] Every `SKILL.md` has flat frontmatter with `name` and a `Use when` description, plus the six
  required body sections.
- [ ] Every `SKILL.md` is at or below 500 lines and 32 KiB, with detail moved into `references/`.
- [ ] Every host compatibility entry is a pointer with matching frontmatter, and no orphan remains.
- [ ] No skill contains secrets, machine-absolute paths, generated output, runtime state, build
  artifacts, or product source.
- [ ] No skill weakens a root spec, bypasses SDK generation, or removes a quality gate.
- [ ] `node <sdkwork-specs>/tools/check-agent-skills.mjs --root .` passes.
