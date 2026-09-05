#!/usr/bin/env node
/**
 * Theme conformance checker for THEME_DARKMODE_SPEC.md (mechanism-level checks).
 *
 * Usage: node tools/check-theme-conformance.mjs <repo-root>
 * Exit: 0 = no P0 findings, 1 = P0 findings present.
 *
 * Checks:
 *  F1  prefers-color-scheme read outside allowlisted theme-provider paths
 *  F2  documentElement mode-class writes (dark/light-mode/data-sdk-color-mode)
 *      outside allowlisted theme-owner paths
 *  F4  Tailwind CSS entry compiling `dark:` utilities without a class-bound
 *      `@custom-variant dark` / `@variant dark` declaration
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = process.argv[2]
if (!root) {
  console.error('usage: node check-theme-conformance.mjs <repo-root>')
  process.exit(2)
}

// Theme-owner allowlist: files that may resolve OS preference or write the
// mode root (theme providers, boot scripts, host theme surfaces/presenters).
const OWNER_ALLOWLIST = [
  /theme-provider\./i,
  /ThemeProvider\./i,
  /ThemeContext\./i,
  /useTheme\./i,
  /(^|\/)theme\.(ts|tsx|js)$/i,
  /[Tt]heme[Rr]untime|theme[-.]runtime|boot[-.]theme|theme[-.]presenter/i,
  /SdkworkHostThemeSurface/i,
  /shell-bridge-provider\./i,
  /sdkwork-theme\.(ts|js)$/i,
  /theme-service/i,
  /hostAppearanceBridge/i,
  /[Tt]hemeManager\./i,
  /startupAppearance\./i,
  /[Tt]hemeInitializer\./i,
  /settingsModalUi\./i,
  /settingsPreferences\./i,
  /createHostManagedKnowledgebaseRuntime|hostLanguageBridge|KnowledgeView\./i,
]

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'lib', 'coverage',
  '.workbuddy', '.pnpm-store', 'vendor', 'external', 'target',
])

const SKIP_DIR_PATTERNS = [/^dist[-.\d]*$/, /^dist-/, /^\.tmp/]

function walk(dir, files = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.agents') continue
    if (SKIP_DIRS.has(entry.name)) continue
    if (SKIP_DIR_PATTERNS.some((re) => re.test(entry.name))) continue
    const full = join(dir, entry.name)
    if (statSync(full).isDirectory()) walk(full, files)
    else files.push(full)
  }
  return files
}

const rel = (p) => relative(root, p).split(sep).join('/')
const isOwner = (p) => OWNER_ALLOWLIST.some((re) => re.test(p))
// Files carrying the spec's single-writer arbitration guard (§7.2) are conformant arbiters.
const isArbitrated = (text) => text.includes('THEME_DARKMODE_SPEC')

const files = walk(root)
const codeFiles = files.filter((f) => /\.(tsx?|jsx?|mjs|css)$/.test(f))
const findings = []
let darkUtilityUsed = false
const cssEntries = []

for (const file of codeFiles) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const path = rel(file)

  if (/dark:\s*["'`\s]/.test(text) && /\.(tsx|jsx)$/.test(file)) darkUtilityUsed = true

  if (/\.css$/.test(file)) {
    if (/@import\s+["']tailwindcss["']/.test(text)) cssEntries.push({ file, text })
    continue
  }

  // F1: OS preference reads outside theme owners (component code only).
  if (!isOwner(path) && !isArbitrated(text) && /prefers-color-scheme/.test(text) && !/\.d\.ts$/.test(file)) {
    findings.push({ severity: 'P0', rule: 'F1', path, hint: 'prefers-color-scheme outside theme owner — resolve mode in the theme provider' })
  }

  // F2: mode-root writes outside theme owners.
  if (!isOwner(path) && !isArbitrated(text)) {
    const writes = text.match(/documentElement\.classList\.(add|remove|toggle)\([^)]*\)|documentElement\.setAttribute\(\s*['"]data-sdk-color-mode|html\.classList\.(add|remove|toggle)\([^)]*\)/g) ?? []
    for (const w of writes) {
      if (/dark|light|mode|theme/i.test(w)) {
        findings.push({ severity: 'P0', rule: 'F2', path, hint: `mode-root write outside theme owner: ${w.slice(0, 90)}` })
      }
    }
  }
}

// F4: Tailwind entries must bind the dark variant to a class when dark: is used.
for (const { file, text } of cssEntries) {
  const hasBinding = /@custom-variant\s+dark|@variant\s+dark/.test(text)
  if (darkUtilityUsed && !hasBinding) {
    findings.push({ severity: 'P0', rule: 'F4', path: rel(file), hint: 'Tailwind entry lacks @custom-variant dark class binding while sources use dark: utilities' })
  }
}

if (findings.length === 0) {
  console.log(`theme-conformance: OK (${codeFiles.length} files scanned)`)
  process.exit(0)
}

for (const f of findings) console.log(`${f.severity} ${f.rule} ${f.path} — ${f.hint}`)
console.log(`theme-conformance: ${findings.length} finding(s)`)
process.exit(1)
