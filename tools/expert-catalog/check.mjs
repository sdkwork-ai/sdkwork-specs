#!/usr/bin/env node
/**
 * Validate the canonical SDKWork expert catalog.
 *
 * Two layers run:
 *
 * 1. **Structural checks** always run: schema version, unique slugs and
 *    division codes, referential integrity of team members, bounded field
 *    lengths, and one persona body per expert per locale under
 *    `specs/expert-catalog/personas/`.
 * 2. **Drift check** runs when the DSH expert package checkout is present: the
 *    catalog must equal what `generate.mjs` produces from that checkout, so a
 *    roster change that skips this repository fails here instead of shipping a
 *    stale catalog.
 *
 * Usage:
 *   node tools/expert-catalog/check.mjs [--source <dsh-experts-package>]
 *
 * The command prints one line per violation and exits non-zero when any check
 * fails.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARTIFACTS, buildCatalog, defaultSource } from './generate.mjs'

/** Persona locales every expert must carry. */
const REQUIRED_PERSONA_LOCALES = ['zh-CN', 'en-US']

/** The committed catalog, or undefined with a reason. */
function readCatalog() {
  if (!existsSync(ARTIFACTS.CATALOG_PATH)) {
    return { error: `missing ${ARTIFACTS.CATALOG_PATH}` }
  }
  try {
    return { catalog: JSON.parse(readFileSync(ARTIFACTS.CATALOG_PATH, 'utf8')) }
  } catch (error) {
    return { error: `unreadable ${ARTIFACTS.CATALOG_PATH}: ${error.message}` }
  }
}

/**
 * Validate the catalog's shape and referential integrity.
 * @param catalog - the parsed catalog.
 * @returns one message per violation.
 */
export function structuralViolations(catalog) {
  const found = []
  if (catalog.schemaVersion !== '1.0.0') found.push(`schemaVersion must be 1.0.0, got ${catalog.schemaVersion}`)
  if (typeof catalog.catalogVersion !== 'string' || catalog.catalogVersion.length === 0) {
    found.push('catalogVersion must be a non-empty string')
  }
  if (catalog.owner !== 'SDKWork') found.push(`owner must be SDKWork, got ${catalog.owner}`)
  const divisions = catalog.taxonomy?.divisions
  if (!Array.isArray(divisions) || divisions.length === 0) {
    found.push('taxonomy.divisions must be a non-empty array')
    return found
  }
  const divisionCodes = new Set()
  for (const division of divisions) {
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(String(division.code))) {
      found.push(`division code is invalid: ${division.code}`)
    }
    if (divisionCodes.has(division.code)) found.push(`duplicate division code: ${division.code}`)
    divisionCodes.add(division.code)
    if (typeof division.name !== 'string' || division.name.trim() === '') {
      found.push(`division ${division.code} has no Chinese name`)
    }
    if (typeof division.nameEn !== 'string' || division.nameEn.trim() === '') {
      found.push(`division ${division.code} has no English name`)
    }
  }

  const experts = catalog.experts
  if (!Array.isArray(experts) || experts.length === 0) {
    found.push('experts must be a non-empty array')
    return found
  }
  const slugs = new Set()
  const locales = new Set()
  for (const expert of experts) {
    if (typeof expert.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,127}$/u.test(expert.slug)) {
      found.push(`expert slug is invalid: ${expert.slug}`)
    }
    if (slugs.has(expert.slug)) found.push(`duplicate expert slug: ${expert.slug}`)
    slugs.add(expert.slug)
    if (!divisionCodes.has(expert.divisionCode)) {
      found.push(`expert ${expert.slug} names unknown division ${expert.divisionCode}`)
    }
    for (const field of ['name', 'nameEn', 'description', 'descriptionEn']) {
      if (typeof expert[field] !== 'string' || expert[field].trim() === '') {
        found.push(`expert ${expert.slug} has no ${field}`)
      }
    }
    if (typeof expert.name === 'string' && Array.from(expert.name).length > 64) {
      found.push(`expert ${expert.slug} name exceeds 64 characters`)
    }
    if (typeof expert.description === 'string' && Array.from(expert.description).length > 600) {
      found.push(`expert ${expert.slug} description exceeds 600 characters`)
    }
    if (typeof expert.emoji !== 'string' || expert.emoji.trim() === '') {
      found.push(`expert ${expert.slug} has no emoji`)
    }
    const personas = expert.personas ?? {}
    const personaLocales = Object.keys(personas)
    for (const required of REQUIRED_PERSONA_LOCALES) {
      if (!personaLocales.includes(required)) found.push(`expert ${expert.slug} has no ${required} persona locale`)
    }
    for (const locale of personaLocales) {
      locales.add(locale)
      const file = join(ARTIFACTS.PERSONAS_DIR, locale, personas[locale].split('/').slice(1).join('/'))
      if (!existsSync(file)) found.push(`expert ${expert.slug} is missing persona ${locale}: ${file}`)
    }
  }

  const teams = catalog.teams
  if (!Array.isArray(teams)) {
    found.push('teams must be an array')
    return found
  }
  const teamIds = new Set()
  for (const team of teams) {
    if (!/^team-[a-z]+$/u.test(String(team.id))) found.push(`team id is invalid: ${team.id}`)
    if (teamIds.has(team.id)) found.push(`duplicate team id: ${team.id}`)
    teamIds.add(team.id)
    for (const field of ['name', 'nameEn', 'description', 'descriptionEn', 'goal', 'goalEn', 'constraints', 'deliveryRequirements', 'deliveryRequirementsEn']) {
      if (typeof team[field] !== 'string' || team[field].trim() === '') {
        found.push(`team ${team.id} has no ${field}`)
      }
    }
    if (!Array.isArray(team.members) || team.members.length < 2 || team.members.length > 8) {
      found.push(`team ${team.id} must have 2-8 members`)
      continue
    }
    const memberSlugs = new Set()
    for (const member of team.members) {
      if (!slugs.has(member.expertSlug)) {
        found.push(`team ${team.id} references unknown expert ${member.expertSlug}`)
      }
      if (memberSlugs.has(member.expertSlug)) {
        found.push(`team ${team.id} repeats expert ${member.expertSlug}`)
      }
      memberSlugs.add(member.expertSlug)
      for (const field of ['duty', 'dutyEn', 'instructions', 'instructionsEn']) {
        if (typeof member[field] !== 'string' || member[field].trim() === '') {
          found.push(`team ${team.id} member ${member.expertSlug} has no ${field}`)
        }
      }
    }
    if (!team.coordinator || team.coordinator.mode !== 'template' || team.coordinator.templateId === undefined) {
      found.push(`team ${team.id} has no template coordinator`)
    }
  }

  return found
}

/**
 * Compare the committed catalog with a fresh build from the DSH package.
 * @param catalog - the committed catalog.
 * @param source - the package directory.
 * @returns one message per difference, or undefined when the source is absent.
 */
export function driftViolations(catalog, source) {
  if (!existsSync(source)) return undefined
  const fresh = buildCatalog(source)
  if (JSON.stringify(fresh) === JSON.stringify(catalog)) return []
  const found = []
  if (fresh.experts.length !== catalog.experts.length) {
    found.push(`expert count drifted: ${catalog.experts.length} committed, ${fresh.experts.length} in source`)
  }
  if (fresh.teams.length !== catalog.teams.length) {
    found.push(`team count drifted: ${catalog.teams.length} committed, ${fresh.teams.length} in source`)
  }
  const committed = new Set(catalog.experts.map(expert => expert.slug))
  const current = new Set(fresh.experts.map(expert => expert.slug))
  for (const slug of current) if (!committed.has(slug)) found.push(`expert ${slug} is missing from the catalog`)
  for (const slug of committed) if (!current.has(slug)) found.push(`expert ${slug} is no longer in the source`)
  if (found.length === 0) found.push('catalog content drifted from the DSH package source; run generate.mjs')
  return found
}

/** Run the CLI: read the committed catalog, then check structure and drift. */
function main() {
  const index = process.argv.indexOf('--source')
  const source = index === -1 ? defaultSource() : process.argv[index + 1]
  const { catalog, error } = readCatalog()
  if (error !== undefined) {
    console.error(`expert-catalog: ${error}`)
    process.exit(1)
  }
  const violations = structuralViolations(catalog)
  const drift = driftViolations(catalog, source)
  if (drift === undefined) {
    console.log(`expert-catalog: source checkout not found at ${source}; structural checks only`)
  } else {
    violations.push(...drift)
  }
  if (violations.length > 0) {
    for (const violation of violations) console.error(`expert-catalog: ${violation}`)
    process.exit(1)
  }
  console.log(`expert-catalog: ${catalog.experts.length} experts across ${catalog.taxonomy.divisions.length} divisions, ${catalog.teams.length} teams, all checks pass`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
