/**
 * Conformance suite for GITHUB_WORKFLOW_SPEC.
 *
 * The standard is only a standard when its rules have executable fixtures: each
 * case below builds a minimal repository, runs the canonical validator, and
 * asserts the verdict. A rule change that breaks a fixture fails here, which is
 * the repository-level equivalent of a specification's test suite.
 *
 * Run: node --test tools/test-github-workflow-standard.mjs
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const CHECKER = path.join(ROOT, 'tools', 'check-agent-workflow-standard.mjs')
const MODEL_TOOL = path.join(ROOT, 'tools', 'gen-github-workflow-model-doc.mjs')
const FRAMEWORK_TEMPLATES = path.resolve(ROOT, '..', 'sdkwork-github-workflow', 'templates')

// The fixtures use the framework's own templates: a conformance case must test
// the contract the generator actually emits, not a hand-written lookalike.
const PACKAGE_WORKFLOW = readFileSync(path.join(FRAMEWORK_TEMPLATES, 'app-package.workflow.yml'), 'utf8')
const VERIFY_WORKFLOW = readFileSync(path.join(FRAMEWORK_TEMPLATES, 'app-verify.workflow.yml'), 'utf8')

const CONFIG = {
  schemaVersion: '2026-06-06.agent.workflow.v1',
  app: { id: 'fixture-app', repository: 'sdkwork-ai/fixture-app' },
  release: { artifactPrefix: 'fixture-app' },
  targets: [{
    id: 'linux-x64-standalone-server-tar-gz',
    profileBinding: 'fixed',
    deploymentProfile: 'standalone',
    runtimeTarget: 'server',
    profile: 'server',
    platform: 'linux',
    architecture: 'x64',
    formats: ['tar.gz'],
    runner: 'ubuntu-24.04',
    outputGlobs: ['dist/server/*.tar.gz'],
  }],
}

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'workflow-conformance-'))
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'fixture-app', scripts: { verify: 'node -e "process.exit(0)"' } }, null, 2)}\n`)
  writeFileSync(path.join(root, 'README.md'), '# fixture\n\nrepository-kind: application\n')
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return root
}

function runChecker(root, extra = []) {
  try {
    execFileSync(process.execPath, [CHECKER, '--root', root, '--entrypoints', '--workflows-only', ...extra], { encoding: 'utf8', stdio: 'pipe' })
    return { ok: true, output: '' }
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

test('a thin two-entrypoint application is conformant', () => {
  const root = fixture({
    'agent.workflow.json': `${JSON.stringify(CONFIG, null, 2)}\n`,
    '.github/workflows/package.yml': PACKAGE_WORKFLOW,
    '.github/workflows/verify.yml': VERIFY_WORKFLOW,
  })
  try {
    const result = runChecker(root)
    assert.equal(result.ok, true, result.output)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a bespoke verification workflow is non-conformant', () => {
  const root = fixture({
    'agent.workflow.json': `${JSON.stringify(CONFIG, null, 2)}\n`,
    '.github/workflows/package.yml': PACKAGE_WORKFLOW,
    '.github/workflows/verify.yml': [
      'name: verify',
      'on: [push]',
      'jobs:',
      '  verify:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - run: pnpm verify',
      '',
    ].join('\n'),
  })
  try {
    const result = runChecker(root)
    assert.equal(result.ok, false)
    assert.match(result.output, /must stay thin/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unpinned action reference is non-conformant outside the sanctioned moving-ref patterns', () => {
  const root = fixture({
    'agent.workflow.json': `${JSON.stringify(CONFIG, null, 2)}\n`,
    '.github/workflows/package.yml': PACKAGE_WORKFLOW,
    '.github/workflows/verify.yml': VERIFY_WORKFLOW,
    '.github/workflows/extra.yml': [
      'name: extra',
      'on: [push]',
      'jobs:',
      '  extra:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: some/action@main',
      '',
    ].join('\n'),
  })
  try {
    const result = runChecker(root)
    assert.equal(result.ok, false)
    assert.match(result.output, /moving revision/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a static matrix lane must name itself', () => {
  const root = fixture({
    'agent.workflow.json': `${JSON.stringify(CONFIG, null, 2)}\n`,
    '.github/workflows/package.yml': PACKAGE_WORKFLOW,
    '.github/workflows/verify.yml': VERIFY_WORKFLOW,
    '.github/workflows/extra.yml': [
      'name: extra',
      'on: [push]',
      'jobs:',
      '  extra:',
      '    runs-on: ubuntu-latest',
      '    strategy:',
      '      matrix:',
      '        os: [ubuntu-latest, windows-latest]',
      '    steps:',
      '      - run: echo hi',
      '',
    ].join('\n'),
  })
  try {
    const result = runChecker(root)
    assert.equal(result.ok, false)
    assert.match(result.output, /without naming the lane/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a fork role keeps upstream CI but still pins what it owns', () => {
  const config = { ...CONFIG, workflowRole: 'fork-upstream', targets: [] }
  const root = fixture({
    'agent.workflow.json': `${JSON.stringify(config, null, 2)}\n`,
    '.github/workflows/upstream.yml': [
      'name: upstream',
      'on: [push]',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '',
    ].join('\n'),
  })
  try {
    const result = runChecker(root)
    assert.equal(result.ok, true, result.output)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the specification matrix, model, and framework stay in agreement', () => {
  const output = execFileSync(process.execPath, [MODEL_TOOL, '--json'], { encoding: 'utf8' })
  const report = JSON.parse(output.slice(output.indexOf('{')))
  assert.deepEqual(report.problems, [])
  assert.ok(report.targets >= 15)
})
