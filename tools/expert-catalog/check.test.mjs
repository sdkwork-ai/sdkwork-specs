/**
 * Contract tests for the expert-catalog validator: every structural rule must
 * reject the shape it exists to catch, and the committed catalog must pass.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { structuralViolations } from './check.mjs'
import { ARTIFACTS } from './generate.mjs'

/** The committed catalog, deep-cloned per test so a case cannot leak. */
function committed() {
  return JSON.parse(readFileSync(ARTIFACTS.CATALOG_PATH, 'utf8'))
}

/**
 * Mutate one catalog property and return the violations.
 * @param mutate - receives the cloned catalog.
 * @returns the structural violations.
 */
function violationsAfter(mutate) {
  const catalog = committed()
  mutate(catalog)
  return structuralViolations(catalog)
}

describe('expert catalog', () => {
  it('accepts the committed catalog', () => {
    const catalog = committed()
    assert.equal(catalog.experts.length, 331)
    assert.equal(catalog.taxonomy.divisions.length, 22)
    assert.equal(catalog.teams.length, 5)
    assert.deepEqual(structuralViolations(catalog), [])
  })

  it('rejects a duplicate expert slug', () => {
    assert.ok(violationsAfter(catalog => catalog.experts.push(catalog.experts[0])).some(message => message.startsWith('duplicate expert slug')))
  })

  it('rejects an unknown division reference', () => {
    assert.ok(violationsAfter(catalog => { catalog.experts[0].divisionCode = 'nonexistent' }).some(message => message.includes('unknown division')))
  })

  it('rejects a team member outside the roster', () => {
    assert.ok(violationsAfter(catalog => { catalog.teams[0].members[0].expertSlug = 'ghost-expert' }).some(message => message.includes('unknown expert')))
  })

  it('rejects a team with fewer than two members', () => {
    assert.ok(violationsAfter(catalog => { catalog.teams[0].members = catalog.teams[0].members.slice(0, 1) }).some(message => message.includes('2-8 members')))
  })

  it('rejects a missing locale description', () => {
    assert.ok(violationsAfter(catalog => { delete catalog.experts[0].descriptionEn }).some(message => message.includes('has no descriptionEn')))
  })

  it('rejects a missing persona locale', () => {
    assert.ok(violationsAfter(catalog => { delete catalog.experts[0].personas['en-US'] }).some(message => message.includes('persona locale')))
  })

  it('rejects a duplicate team id', () => {
    assert.ok(violationsAfter(catalog => catalog.teams.push(catalog.teams[0])).some(message => message.startsWith('duplicate team id')))
  })

  it('rejects a changed schema version', () => {
    assert.ok(violationsAfter(catalog => { catalog.schemaVersion = '2.0.0' }).some(message => message.includes('schemaVersion')))
  })
})
