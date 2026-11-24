#!/usr/bin/env node
/**
 * Generate the canonical SDKWork expert catalog from the authoritative DSH
 * package source.
 *
 * The catalog is the data contract every consumer seeds from:
 *
 * - `sdkwork-agents` renders its `ai_agent` / `ai_agent_category` /
 *   `ai_expert_team` / `ai_expert_team_member` seeds from
 *   `specs/expert-catalog/expert-catalog.v1.json`.
 * - The DSH expert market package (`packages/client/ui-sdkwork-experts` in the
 *   BirdCoder checkout) reads the same divisions, experts and teams.
 *
 * The generator is the one-way bridge from the package's authored sources
 * (`src/client/roster.ts`, `src/names.ts`, `src/team-contract.ts` and
 * `src/team-content-en.ts`) plus its persona markdown assets into this
 * repository's catalog JSON, and copies the persona bodies under
 * `specs/expert-catalog/personas/` so this repository owns the data.
 *
 * Usage:
 *   node tools/expert-catalog/generate.mjs [--source <dsh-experts-package>]
 *
 * `--source` defaults to `../../sdkwork-birdcoder2/packages/client/ui-sdkwork-experts`.
 * The generator is idempotent: it writes the JSON and persona copies from the
 * source every run, and the checker rejects a catalog that drifted from them.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_SOURCE = resolve(ROOT, '..', 'sdkwork-birdcoder2', 'packages', 'client', 'ui-sdkwork-experts')

/** Where the generated catalog and persona copies live. */
const OUTPUT_DIR = join(ROOT, 'specs', 'expert-catalog')
const CATALOG_PATH = join(OUTPUT_DIR, 'expert-catalog.v1.json')
const PERSONAS_DIR = join(OUTPUT_DIR, 'personas')

/** Locales whose persona bodies the catalog carries. */
const PERSONA_LOCALES = [
  { locale: 'zh-CN', directory: 'agency-agents-zh' },
  { locale: 'en-US', directory: 'agency-agents' },
]

/**
 * Read the source argument, if any.
 * @returns the absolute package directory.
 */
function sourceArgument() {
  const index = process.argv.indexOf('--source')
  if (index === -1) return DEFAULT_SOURCE
  const value = process.argv[index + 1]
  if (value === undefined || value === '') throw new Error('generate: --source requires a directory')
  return resolve(value)
}

/**
 * Return the text between a balanced pair of delimiters, starting at the first
 * occurrence of `needle` after `from`.
 * @param source - the whole file text.
 * @param needle - literal prefix; the opener must follow it.
 * @param opener - opening character.
 * @param closer - closing character.
 * @returns the inner text, delimiters excluded.
 */
function balanced(source, needle, opener, closer) {
  const start = source.indexOf(needle)
  if (start === -1) throw new Error(`generate: missing ${JSON.stringify(needle)}`)
  let cursor = source.indexOf(opener, start + needle.length)
  if (cursor === -1) throw new Error(`generate: ${JSON.stringify(needle)} has no ${opener}`)
  const begin = cursor + 1
  let depth = 1
  let quote
  for (cursor = begin; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (quote !== undefined) {
      if (character === '\\') cursor += 1
      else if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'" || character === '`') quote = character
    else if (character === opener) depth += 1
    else if (character === closer) {
      depth -= 1
      if (depth === 0) return source.slice(begin, cursor)
    }
  }
  throw new Error(`generate: unterminated ${opener} after ${JSON.stringify(needle)}`)
}

/**
 * Evaluate a JavaScript array/object literal written in a source file.
 * @param text - the literal text, without its outer delimiters.
 * @param kind - `array` or `object`.
 * @param args - optional evaluated bindings for the literal's free identifiers.
 * @returns the evaluated value.
 */
function evaluate(text, kind, args = {}) {
  const names = Object.keys(args)
  const values = Object.values(args)
  const body = kind === 'array' ? `return [${text}]` : `return ({${text}})`
  const factory = new Function(...names, body)
  return factory(...values)
}

/**
 * Read the roster index (slug, English name, emoji, division, both descriptions).
 * @param source - package directory.
 * @returns the roster entries.
 */
function readRoster(source) {
  const text = readFileSync(join(source, 'src', 'client', 'roster.ts'), 'utf8')
  return evaluate(balanced(text, 'export const ROSTER', '[', ']'), 'array')
}

/**
 * Read the division display names and the expert display-name overrides.
 * @param source - package directory.
 * @returns `{ divisions: { zh, en }, zhNames }` maps.
 */
function readDivisions(source) {
  const text = readFileSync(join(source, 'src', 'names.ts'), 'utf8')
  return {
    zh: evaluate(balanced(text, 'export const ZH_DIVISION', '{', '}'), 'object'),
    en: evaluate(balanced(text, 'export const EN_DIVISION', '{', '}'), 'object'),
    zhNames: evaluate(balanced(text, 'export const ZH_NAME', '{', '}'), 'object'),
  }
}

/**
 * Rebuild the built-in team records from the package's `define` / `member`
 * helpers, including their Chinese display content.
 * @param source - package directory.
 * @returns the Chinese team records.
 */
function readBuiltinTeams(source) {
  const text = readFileSync(join(source, 'src', 'team-contract.ts'), 'utf8')
  const descriptions = evaluate(balanced(text, 'const TEAM_DESCRIPTIONS', '{', '}'), 'object')
  const teams = balanced(text, 'export const BUILTIN_TEAMS: readonly ExpertTeam[] = ', '[', ']')
  const member = (expertSlug, duty, instructions) => ({ expertSlug, duty, instructions })
  const define = (id, name, goal, tags, members, deliveryRequirements, examples) => ({
    id: `team-${id}`,
    builtin: true,
    name,
    description: descriptions[id],
    tags,
    members,
    goal,
    constraints: '仅进行分析评审；依据不足时明确说明，不擅自修改或发布。',
    deliveryRequirements,
    examples,
    coordinatorMode: 'template',
    coordinatorTemplateId: id,
    coordinatorTemplateVersion: 1,
    coordinatorPrompt: '',
  })
  return evaluate(teams, 'array', { define, member, TEAM_DESCRIPTIONS: descriptions })
}

/**
 * Read the English team display content.
 * @param source - package directory.
 * @returns the English content keyed by team id.
 */
function readEnglishTeamContent(source) {
  const text = readFileSync(join(source, 'src', 'team-content-en.ts'), 'utf8')
  return evaluate(balanced(text, 'export const TEAM_CONTENT_EN', '{', '}'), 'object')
}

/**
 * Locate one expert's persona markdown in a locale directory.
 * @param assets - assets root.
 * @param directory - locale directory name.
 * @param division - division code.
 * @param slug - expert slug.
 * @returns the asset-relative path.
 */
function personaPath(assets, directory, division, slug) {
  const relative = join(directory, division, `${slug}.md`)
  if (!existsSync(join(assets, relative))) {
    throw new Error(`generate: missing persona ${relative}`)
  }
  return relative.split('\\').join('/')
}

/**
 * Read the `name` and `description` fields of one persona's YAML frontmatter.
 * @param assets - assets root.
 * @param relative - asset-relative persona path.
 * @returns the parsed fields; missing fields are undefined.
 */
function readPersonaFrontmatter(assets, relative) {
  const text = readFileSync(join(assets, relative), 'utf8')
  const end = text.indexOf('\n---', 3)
  const frontmatter = end === -1 ? '' : text.slice(3, end)
  const field = name => {
    const match = new RegExp(`^${name}:\\s*(.+)$`, 'mu').exec(frontmatter)
    if (match === null) return undefined
    return match[1].trim().replace(/^['"]|['"]$/gu, '')
  }
  return { name: field('name'), description: field('description') }
}

/**
 * Whether a value carries ideographic text, used to tell a Chinese tagline from
 * an English one in the roster's mixed columns.
 * @param value - candidate text.
 * @returns true when the text contains a CJK ideograph.
 */
function hasCjk(value) {
  return /\p{Script=Han}/u.test(value)
}

/**
 * Build the catalog object from the package sources.
 * @param source - package directory.
 * @returns the catalog, ready to serialize.
 */
export function buildCatalog(source) {
  const assets = join(source, 'assets')
  const roster = readRoster(source)
  const { zh: zhDivisions, en: enDivisions, zhNames } = readDivisions(source)
  const divisions = { zh: zhDivisions, en: enDivisions }
  const teams = readBuiltinTeams(source)
  const englishTeams = readEnglishTeamContent(source)

  const codes = [...new Set(roster.map(entry => entry.division))]
  const ordered = codes
    .map(code => ({ code, name: divisions.zh[code], nameEn: divisions.en[code] }))
    .sort((left, right) => left.code.localeCompare(right.code))
  const missing = ordered.filter(division => division.name === undefined || division.nameEn === undefined)
  if (missing.length > 0) throw new Error(`generate: divisions without display names: ${missing.map(item => item.code).join(', ')}`)

  const experts = roster
    .map(entry => {
      const personas = {}
      for (const { locale, directory } of PERSONA_LOCALES) {
        personas[locale] = personaPath(assets, directory, entry.division, entry.slug)
      }
      const name = zhNames[entry.slug]
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error(`generate: expert ${entry.slug} has no Chinese display name in ZH_NAME`)
      }
      // A few roster rows carry the English tagline in `description` and leave
      // `descriptionEn` empty; the persona frontmatter is the complete source.
      const zhFrontmatter = readPersonaFrontmatter(assets, personas['zh-CN'])
      const enFrontmatter = readPersonaFrontmatter(assets, personas['en-US'])
      const description = hasCjk(entry.description) ? entry.description : zhFrontmatter.description
      const descriptionEn = entry.descriptionEn !== '' ? entry.descriptionEn : enFrontmatter.description
      if (typeof description !== 'string' || !hasCjk(description)) {
        throw new Error(`generate: expert ${entry.slug} has no Chinese description`)
      }
      if (typeof descriptionEn !== 'string' || descriptionEn.trim() === '') {
        throw new Error(`generate: expert ${entry.slug} has no English description`)
      }
      return {
        slug: entry.slug,
        divisionCode: entry.division,
        name,
        nameEn: entry.nameEn,
        emoji: entry.emoji,
        description,
        descriptionEn,
        personas,
      }
    })
    .sort((left, right) => left.slug.localeCompare(right.slug))

  const catalogTeams = teams.map(team => {
    const english = englishTeams[team.id]
    if (english === undefined) throw new Error(`generate: team ${team.id} has no English content`)
    if (english.assignments.length !== team.members.length) {
      throw new Error(`generate: team ${team.id} English assignments do not cover its members`)
    }
    return {
      id: team.id,
      name: team.name,
      nameEn: english.name,
      description: team.description,
      descriptionEn: english.description,
      tags: team.tags,
      tagsEn: english.tags,
      goal: team.goal,
      goalEn: english.goal,
      constraints: team.constraints,
      deliveryRequirements: team.deliveryRequirements,
      deliveryRequirementsEn: english.deliveryRequirements,
      examples: team.examples,
      examplesEn: english.examples,
      coordinator: {
        mode: team.coordinatorMode,
        templateId: team.coordinatorTemplateId,
        templateVersion: team.coordinatorTemplateVersion,
      },
      members: team.members.map((member, index) => ({
        expertSlug: member.expertSlug,
        duty: member.duty,
        dutyEn: english.assignments[index][0],
        instructions: member.instructions,
        instructionsEn: english.assignments[index][1],
      })),
    }
  })

  const knownExperts = new Set(experts.map(expert => expert.slug))
  for (const team of catalogTeams) {
    for (const member of team.members) {
      if (!knownExperts.has(member.expertSlug)) {
        throw new Error(`generate: team ${team.id} references unknown expert ${member.expertSlug}`)
      }
    }
  }

  return {
    schemaVersion: '1.0.0',
    catalogVersion: '1.0.0',
    owner: 'SDKWork',
    source: {
      package: '@deepseek-ai/dsh-client-ui-sdkwork-experts',
      upstream: 'The Agency roster (331 experts, 22 divisions)',
    },
    taxonomy: { divisions: ordered },
    experts,
    teams: catalogTeams,
  }
}

/**
 * Copy every persona body into the catalog so this repository owns the data.
 * @param source - package directory.
 * @param catalog - the built catalog.
 */
export function copyPersonas(source, catalog) {
  rmSync(PERSONAS_DIR, { recursive: true, force: true })
  mkdirSync(PERSONAS_DIR, { recursive: true })
  for (const expert of catalog.experts) {
    for (const [locale, relative] of Object.entries(expert.personas)) {
      const target = join(PERSONAS_DIR, locale, relative.split('/').slice(1).join('/'))
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(source, 'assets', relative), target)
    }
  }
  const files = readdirSync(PERSONAS_DIR, { recursive: true })
  if (files.length === 0) throw new Error('generate: no persona bodies were copied')
}

/** Write the catalog JSON and persona copies for one source checkout. */
export function writeCatalog(source = sourceArgument()) {
  const catalog = buildCatalog(source)
  mkdirSync(OUTPUT_DIR, { recursive: true })
  copyPersonas(source, catalog)
  writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  return catalog
}

/**
 * The default source directory the checker and generator use.
 * @returns the absolute package directory.
 */
export function defaultSource() {
  return DEFAULT_SOURCE
}

/** Absolute paths of the generated artifacts. */
export const ARTIFACTS = { OUTPUT_DIR, CATALOG_PATH, PERSONAS_DIR }

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = writeCatalog()
  console.log(`expert-catalog: wrote ${catalog.experts.length} experts, ${catalog.taxonomy.divisions.length} divisions, ${catalog.teams.length} teams, ${statSync(CATALOG_PATH).size} bytes`)
  console.log(`expert-catalog: personas under ${PERSONAS_DIR}`)
}

