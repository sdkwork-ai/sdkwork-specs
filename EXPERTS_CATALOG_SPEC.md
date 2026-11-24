# Experts Catalog Spec

Authority: `SOUL.md` section 5 (data ownership), `DOMAIN_SPEC.md` section 2 (domain ownership), `DATABASE_SPEC.md` (table ownership), `API_SPEC.md` (catalog read contracts), and this spec for the expert catalog's data and initialization.

## 1. Purpose and scope

SDKWork's expert market presents 331 domain experts grouped into 22 divisions, plus a set of built-in expert teams. These are product data, not presentation data: the same expert catalog feeds the `sdkwork-agents` managed-agent tables, the SDKWork Agents App API, the DSH expert market surface, and any future channel that lists experts.

This spec fixes **who owns that data and how it is initialized**:

| Concern | Owner |
| --- | --- |
| Expert catalog data (divisions, experts, teams, persona bodies) | `sdkwork-specs` — this repository, under `specs/expert-catalog/` |
| Catalog initialization tooling (generate, validate) | `sdkwork-specs`, under `tools/expert-catalog/` |
| Persistent expert and expert-team tables, seeds, read APIs | `sdkwork-agents` |
| Expert market presentation, summoning tools and settings | The DSH expert market package (`packages/client/ui-sdkwork-experts` in BirdCoder), as a consumer only |

A consumer MUST NOT author expert data of its own. A consumer that needs a new expert, a new division, a changed persona or a new built-in team changes the catalog here, then regenerates its own seeds from the catalog.

## 2. Canonical data

`specs/expert-catalog/expert-catalog.v1.json` is the machine authority; `specs/expert-catalog/personas/<locale>/<division>/<slug>.md` carries the persona bodies.

```text
specs/expert-catalog/
  expert-catalog.v1.json     # divisions, experts, teams
  personas/
    zh-CN/<division>/<slug>.md
    en-US/<division>/<slug>.md
  README.md
```

The catalog object:

| Field | Type | Rule |
| --- | --- | --- |
| `schemaVersion` | string | Always `1.0.0` for this shape. |
| `catalogVersion` | string | Catalog data version; changes when the data changes. |
| `owner` | string | Always `SDKWork`. |
| `source` | object | The authoring package and upstream roster this data came from. |
| `taxonomy.divisions[]` | array | `code` (lowercase kebab), `name` (Chinese), `nameEn`; `code` is unique and stable. |
| `experts[]` | array | `slug`, `divisionCode`, `name`, `nameEn`, `emoji`, `description`, `descriptionEn`, `personas`. `slug` is unique and stable; `divisionCode` must name a division. |
| `experts[].personas` | object | Locale id to asset-relative persona path. Every expert carries one persona per supported catalog locale. |
| `teams[]` | array | `id` (`team-<template>`), `name`, `nameEn`, `description`, `descriptionEn`, `tags`, `tagsEn`, `goal`, `goalEn`, `constraints`, `deliveryRequirements`, `deliveryRequirementsEn`, `examples`, `examplesEn`, `coordinator`, `members[]`. |
| `teams[].members[]` | array | `expertSlug`, `duty`, `dutyEn`, `instructions`, `instructionsEn`; 2–8 distinct experts, each named in `experts[]`. |
| `teams[].coordinator` | object | `mode` (`template`), `templateId`, `templateVersion`. |

Rules:

1. **Slugs and division codes are stable identities.** They are the join keys of every downstream table, saved-user preference and URL. Renaming one is a data migration, never an edit in place.
2. **Both locales are mandatory for catalog rows.** A missing `name`/`description`/`duty`/`instructions` in either locale fails validation; presentation locale coverage (more languages) is a consumer concern.
3. **Persona bodies are markdown with YAML frontmatter** (`name`, `description`, `emoji`). The frontmatter must agree with the catalog row; the body is the expert's system persona and is not truncated by the catalog.
4. **No consumer-local expert data.** A hard-coded expert list, a per-deployment roster file or a hand-written seed row outside this repository's catalog is a defect.
5. **Change the data here first.** A new expert requires a catalog row, both persona bodies and, when it joins a team, a team member row; then regenerate and re-validate.

## 3. Database mapping in `sdkwork-agents`

An expert is an ordinary managed agent, so it lands in `ai_agent`; the catalog adds only the aggregates an agent cannot express.

| Catalog | Table | Mapping |
| --- | --- | --- |
| `taxonomy.divisions[]` | `ai_agent_category` | `category_code = expert-<division.code>` (the `expert-` prefix keeps the expert taxonomy distinct from the managed-agent taxonomy), `name`/`nameEn` per locale seed, `sort_order = 10 × (catalog order + 1)`, `parent_id = NULL`, `status = 1`. |
| `experts[]` | `ai_agent` | `agent_id = agent.expert.<slug>`, `code = expert-<slug>`, `agent_kind = conversation`, `category_code = expert-<divisionCode>`, `implementation_type = sdkwork-native`, `implementation_kind = NULL`, `visibility = 3`, `status = 1`, `tags_json = [expert, conversation, <division>, official, commercial]`; `manifest_json` carries `domain = experts` and `expert = {slug, division_code, emoji, roster_version, persona_locales}`. |
| `experts[].personas` | `ai_expert_persona` | One row per `(expert_agent_id, locale)` with the markdown body (frontmatter stripped) and its SHA-256 in `content_sha256`. Persona text never lands in `ai_agent.manifest_json` or `default_code_task_intent_json`. |
| `experts[]` | `ai_agent_version` | One version row per expert: `version_id = version.expert-<slug>.1`, `version_number = 1`, the same manifest, no composition slots. |
| `teams[]` | `ai_expert_team` | `team_id = team-<template>`, both display locales on the row (`name`/`name_en`, `description`/`description_en`, `goal`/`goal_en`, `delivery_requirements`/`_en`, `tags_json`/`tags_en_json`, `examples_json`/`examples_en_json`), `constraints_text`, `coordinator_mode = template`, `coordinator_template_id`, `coordinator_template_version`, `sort_order = 10 × (catalog order + 1)`. |
| `teams[].members[]` | `ai_expert_team_member` | `team_id`, `expert_agent_id = agent.expert.<slug>`, `position` (catalog order), localized `duty`/`duty_en` and `instructions`/`instructions_en`. The member references the agent by its stable id rather than a cross-table foreign key. |

Seeding rules:

1. **Deterministic identity.** Seed row ids and UUIDs derive from the stable catalog keys (`sdkwork-agents/scripts/generate-expert-seeds.mjs`), never from iteration order or wall-clock time.
2. **One seed source.** `sdkwork-agents` renders its expert seeds from this repository's `expert-catalog.v1.json`; the generated SQL is committed and the drift gate (`pnpm check:expert-catalog`) fails when it no longer matches. Hand-edited seed SQL is a defect.
3. **Locale seeds carry display and personas.** `locales/zh-CN/002_expert_catalog.sql` and `locales/en-US/002_expert_catalog.sql` update category/agent display and insert the `ai_expert_persona` rows; `common/003_expert_catalog.sql` carries the neutral categories, agents, versions, teams and members.
4. **Idempotent by stable key.** Every insert upserts on its natural key (`category_code`, `agent_id`, `(agent_id, version_id)`, `team_id`, `(team_id, expert_agent_id)`, `(expert_agent_id, locale)`).
5. **Read APIs serve the catalog; they do not own it.** The App API lists divisions, experts and teams; writes go through the management surface, never through a seed.
6. **Custom experts stay user data.** A user-created expert is an ordinary managed agent owned by its user; it is not written into the catalog tables and does not change this repository.
7. **Consumer fallback is presentation only.** A consumer may keep a bundled offline copy of the catalog for a deployment without the Agents service; that copy is generated from this repository's catalog and may not drift.

## 4. Read API contract (`sdkwork-agents` App API)

The catalog is served under `/app/v3/api/ai/` in the standard API envelope (`ResourceData` / `PageData`). Locale resolves from `Accept-Language` (falling back to `zh-CN`); active catalog locales are `zh-CN` and `en-US`.

| Method and path | Purpose |
| --- | --- |
| `GET /app/v3/api/ai/expert_divisions` | The 22 divisions ordered by `sort_order`, each with `code`, `name`, `nameEn`, `expertCount`. |
| `GET /app/v3/api/ai/experts?division=&q=&page=&pageSize=` | Paged expert summaries: `slug`, `agentId`, `name`, `nameEn`, `description`, `descriptionEn`, `emoji`, `divisionCode`, `tags`. `q` matches localized names and descriptions. |
| `GET /app/v3/api/ai/experts/{slug}` | One expert summary plus its `persona` for the active locale and its `personaLocales`. |
| `GET /app/v3/api/ai/expert_teams` | Every team with localized name/description/goal/delivery/examples, coordinator and ordered members (`expertSlug`, `duty`, `instructions`). |
| `GET /app/v3/api/ai/expert_teams/{teamId}` | One team with the same shape. |
| `GET /app/v3/api/ai/expert_personas?locale=&page=&pageSize=` | Every expert persona body for one locale: `expertSlug`, `agentId`, `locale`, `persona`, `contentSha256`. A consumer uses it to keep an offline catalog copy in sync. |

Rules:

1. Read-only; no expert write endpoint is part of this contract. User custom experts are managed agents.
2. Only `status = 1`, `deleted_at IS NULL` rows are visible; visibility follows the caller's tenant scope.
3. Personas and teams are served per requested locale (`zh-CN` default, `en-US` supported) with a `zh-CN` fallback for a missing persona. Expert and division display follows the locale the seed was applied with: the managed-agent display columns are single-valued, so a deployment seeds the locale it serves.
4. The DSH expert market consumes these endpoints and keeps its bundled roster only as an offline fallback.

## 5. Initialization workflow

```sh
# 1. Edit the catalog here (data, persona bodies, divisions, teams).
# 2. Regenerate from the DSH authoring package when the roster changed upstream:
node tools/expert-catalog/generate.mjs
# 3. Validate structure, references, persona presence and source drift:
node tools/expert-catalog/check.mjs
# 4. Regenerate the Agents seeds and validate the database contract:
#    (sdkwork-agents) pnpm gen-expert-seeds
#    (sdkwork-agents) pnpm check:expert-catalog
#    (sdkwork-agents) pnpm db:validate
# 5. Seed a database and run the live checks:
#    (sdkwork-agents) pnpm db:seed
#    psql "$SDKWORK_DATABASE_URL" -f database/verification/expert_catalog_checks.sql
```

The checkers run in CI and in any release that carries the catalog. A catalog that no longer matches the authoring package source, a missing persona, an unknown division or team member, a locale gap, or stale generated seeds fails the gate.

## 6. Verification

- `tools/expert-catalog/check.mjs` validates the committed catalog: 22 divisions, unique stable slugs, both locales, persona files present, team membership and bounded field lengths.
- When the authoring package is checked out, the same run compares the committed catalog with a fresh build and reports every added, removed or changed expert, team and division.
- `sdkwork-agents` verifies the seed pipeline statically (`scripts/verify-expert-catalog.mjs`, `tests/contract/expert-catalog.contract.test.mjs`), the database contract (`pnpm db:validate`, `pnpm db:materialize:contract`), and the seeded rows (`database/verification/expert_catalog_checks.sql`).

## 7. Non-goals

- This spec does not define the expert market's presentation (gallery layout, filters, statistics). That surface belongs to its consumer.
- It does not define task routing, model selection or the team execution engine; those are runtime behavior of the consuming application.
- It does not define how many experts a deployment enables; enablement is user or tenant state, not catalog data.
