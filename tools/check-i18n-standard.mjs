#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collectWorkspaceValidationIssues } from './lib/workspace-check-runner.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  // Dot-prefixed scratch (`.tmp/`) holds generated manifests and throwaway
  // inspection dumps, never authored i18n source.
  //
  // NOTE: `lib/` must NOT be skipped — Flutter/Dart authors i18n fragments under
  // `lib/src/i18n/<locale>/...`, so skipping it would silently disable Dart
  // validation across every Flutter app in the workspace.
  '.tmp',
  'external',
  'third_party',
  'vendor',
  // `.sdkwork/` is the local AI workspace metadata directory (AGENTS.md local
  // dictionary: skills, plugins, manifests, scratch). It is not application
  // source, and i18n resource-layout rules govern application packages only.
  '.sdkwork',
]);

/**
 * Extensions the authored i18n resource-layout rules apply to. These are the
 * languages SDKWork authors locale resources in; the layout rules judge *where*
 * a file lives, so they must only see files a human placed there deliberately.
 */
const SOURCE_EXTENSIONS = new Set([
  '.arb',
  '.dart',
  '.ftl',
  '.json',
  '.properties',
  '.strings',
  '.stringsdict',
  '.toml',
  '.ts',
  '.xml',
  '.yaml',
  '.yml',
  '.rs',
]);

/**
 * Extensions scanned for forbidden literal protocol surface (the retired locale
 * request header). These rules are pure "this token must not exist" checks with
 * no layout judgement, so they scan every language the workspace ships —
 * including languages the layout rules do not model (JS/TSX, Java/Kotlin,
 * Swift, HarmonyOS ArkTS, Go, Python, Vue/Svelte).
 *
 * Rationale: the retirement is a workspace-wide wire contract. Leaving JS/TSX or
 * a mobile runtime unscanned is exactly how a retired header survives in one of
 * a hundred repositories.
 */
const LITERAL_SCAN_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  '.cjs',
  '.cs',
  '.ets',
  '.go',
  '.gradle',
  '.groovy',
  '.h',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.mjs',
  '.mm',
  '.php',
  '.py',
  '.rb',
  '.scala',
  '.svelte',
  '.swift',
  '.tsx',
  '.vue',
]);

const GENERATED_MARKERS = [
  'sdkwork-i18n-generated',
  'Generated from SDKWork i18n fragments',
  '@generated',
];

const LOCALE_FILE_RE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?(?:-(?:[a-z0-9]{5,8}|\d[a-z0-9]{3}))*$/u;
const SOURCE_LOCALE_MONOLITH_RE = /^(?:[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?|messages)\.(?:ts|json|arb|properties|xml|yaml|yml|toml|ftl)$/u;

function usage() {
  return [
    'Usage:',
    '  node tools/check-i18n-standard.mjs [--root <repo>]',
    '  node tools/check-i18n-standard.mjs --workspace <sdkwork-space-root>',
    '',
    'Validates SDKWork i18n source directory layouts and generated platform resource boundaries.',
  ].join('\n');
}

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/');
}

function isScannableTextFile(filePath) {
  return LITERAL_SCAN_EXTENSIONS.has(path.extname(filePath));
}

/** Whether the authored i18n resource-layout rules apply to this file. */
function isI18nSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

function isIgnoredDirectory(entryName) {
  return SKIP_DIRS.has(entryName);
}

/**
 * Git's ignore rules are the workspace's own authority on "this is not authored
 * source". A bundler's `lib/` output (tsdown/rolldown `window.__ModuleLoader__`
 * bundles), a `dist/` tree, or a hand-compiled `.js` dropped beside its `.ts`
 * source are all derived copies of files that are scanned in their authored
 * form; the artifact is also, by construction, whatever the last build left
 * behind, so a finding in one is a finding no developer can fix in source.
 *
 * A name-based skip list cannot express this: `lib/` is derived output for a
 * TypeScript package and authored source for a Flutter package, so the decision
 * has to come from the repository rather than from the directory name.
 *
 * One `git` call per repository, collapsed with `--directory` so large ignored
 * trees stay a single entry. A missing git binary, a directory that is not a
 * repository, or a repository whose index cannot be read degrades to "no ignore
 * rules" instead of failing the check — the static rules still run, they are
 * just not narrowed.
 */
function readGitIgnoredPaths(repoRoot) {
  const ignored = new Set();
  try {
    const result = spawnSync('git', [
      '-C', repoRoot,
      'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z',
    ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 128 * 1024 * 1024 });
    if (result.status !== 0 || !result.stdout) return ignored;
    for (const entry of result.stdout.split('\0')) {
      if (!entry) continue;
      ignored.add(toPosix(entry).replace(/\/$/u, ''));
    }
  } catch {
    return ignored;
  }
  return ignored;
}

function walkFiles(rootDir, ignoredPaths = new Set()) {
  const files = [];
  if (!fs.existsSync(rootDir)) return files;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const parentRel = toPosix(path.relative(rootDir, current));
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = parentRel ? `${parentRel}/${entry.name}` : entry.name;
      // Tracked ignored files are not reported by `--ignored`, so an ignore rule
      // can never hide committed authoring; only genuinely derived copies drop out.
      if (ignoredPaths.has(childRel)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }
      if (entry.isFile() && isScannableTextFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function afterSequence(segments, sequence) {
  for (let index = 0; index <= segments.length - sequence.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (segments[index + offset] !== sequence[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return segments.slice(index + sequence.length);
    }
  }
  return null;
}

function hasGeneratedMarker(text) {
  return GENERATED_MARKERS.some((marker) => text.includes(marker));
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function isGitkeep(relativeSegments) {
  return relativeSegments[relativeSegments.length - 1] === '.gitkeep';
}

/**
 * `I18N_SPEC.md` section 4: locale negotiation uses the standard `Accept-Language`
 * header only. SDKWork `MUST NOT` define, send, trust, or document a custom locale
 * request header, and `MUST NOT` keep an identifier or locale-source value whose
 * only purpose was to carry one.
 *
 * Three rules, all literal token checks — no layout judgement, so they run against
 * every language the workspace ships (see `LITERAL_SCAN_EXTENSIONS`):
 *
 * 1. Any SDKWork-invented locale or language request header, including
 *    spellings the workspace has never used: the pattern is anchored on the
 *    SDKWork header prefix, so a future variant cannot slip in by picking a
 *    synonym. Anchoring on that prefix also means third-party contract headers
 *    are never matched — Stainless' SDK runtime header, for instance, is a
 *    documented external contract rather than SDKWork protocol surface, and
 *    must not be "cleaned up".
 * 2. Identifiers that only exist to carry the retired header.
 * 3. The retired locale-*source* value (`I18N_SPEC.md` section 3 removed
 *    `sdk-header` from the closed `source` enum). A repository can stop sending
 *    the header and still keep the enum member that documented it, which is why
 *    this is separate from rule 1.
 *
 * A file that must name the retired surface on purpose (a rejection/strip list, a
 * regression test proving the header is ignored, this rule definition itself)
 * marks the line with the allow marker so the exemption stays visible in review.
 */
const RETIRED_LOCALE_REQUEST_HEADER_ALLOW_MARKER = 'i18n-retired-locale-header-allow';

const LOCALE_REQUEST_HEADER_RE = /x-sdkwork-(?:locale|lang|language)[a-z0-9-]*/iu;
const LOCALE_HEADER_SYMBOL_RE = /SdkLocaleHeader|SDK_LOCALE_HEADER/u; // i18n-retired-locale-header-allow: this rule definition

/**
 * The live members of the `source` enum in `I18N_SPEC.md` section 3. Rule 3 uses
 * them as the tell that a line is a locale-source enum definition: a bare
 * `sdk-header` token is only a violation when it is listed *as a locale source*,
 * never when a stylesheet defines `.sdk-header` or a UI package exports a
 * `SdkHeader` header-bar component.
 */
const LIVE_LOCALE_SOURCE_VALUES = [
  'accept-language',
  'app-default',
  'system-default',
  'tenant-preference',
  'user-preference',
];

/** The two shapes the retired locale-source member actually took in the fleet. */
function offendsRetiredLocaleSourceValue(line) {
  // Rust/TypeScript enum variant written as a bare `SdkHeader,` member.
  if (/^\s*SdkHeader\s*,/u.test(line)) return true;
  // Pretty-printed enum member: the quoted value alone on its line.
  if (/^\s*['"]sdk-header['"]\s*,?\s*$/u.test(line)) return true;
  // Compact enum array: the quoted value sits beside the live members on one
  // line, which is how `specs/web-request-context.schema.json` declared it. The
  // live-member guard is what keeps `class="sdk-header"` out.
  if (/['"]sdk-header['"]/iu.test(line)) {
    const lower = line.toLowerCase();
    return LIVE_LOCALE_SOURCE_VALUES.some((value) => lower.includes(value));
  }
  return false;
}

/**
 * `prescan` is a cheap whole-file filter (never line-anchored — anchoring it
 * would make it match only the first line of the file); `offends` judges a single
 * line. Keeping them separate is what lets a rule be both line-precise and cheap.
 */
const RETIRED_LOCALE_SURFACE_RULES = [
  {
    prescan: LOCALE_REQUEST_HEADER_RE,
    offends: (line) => LOCALE_REQUEST_HEADER_RE.test(line),
    detail: 'custom locale request header is retired; negotiate locale with the standard Accept-Language header (I18N_SPEC.md section 4)',
  },
  {
    prescan: LOCALE_HEADER_SYMBOL_RE,
    offends: (line) => LOCALE_HEADER_SYMBOL_RE.test(line),
    detail: 'identifier named after the retired locale request header; the request-side signal is the standard Accept-Language header (I18N_SPEC.md section 4)',
  },
  {
    prescan: /sdk-header|SdkHeader/iu,
    offends: offendsRetiredLocaleSourceValue,
    detail: 'locale source enum member retained after the header retirement; the source enum is closed and locale negotiation is the standard Accept-Language header (I18N_SPEC.md section 3)',
  },
];

function validateRetiredLocaleRequestHeader({ rel, text, issues }) {
  const lines = text.split(/\r?\n/u);
  for (const rule of RETIRED_LOCALE_SURFACE_RULES) {
    if (!rule.prescan.test(text)) continue;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!rule.offends(line)) continue;
      if (line.includes(RETIRED_LOCALE_REQUEST_HEADER_ALLOW_MARKER)) continue;
      issues.push(`${rel}:${index + 1}: ${rule.detail}`);
    }
  }
}

function isThinI18nBoundaryFile(fileName) {
  return /^(?:(?:index|manifest|locale|locales|registry|runtime|types|provider|hostLanguageBridge)(?:\.(?:test|spec))?|[^.]+\.(?:test|spec))\.(?:ts|js|mjs|json|dart|rs)$/u.test(fileName);
}

/**
 * TypeScript declaration output (`*.d.ts`) is compiler-generated and lands next
 * to the source that produced it, so it can appear beside authored fragments
 * under any directory layout. It is never authored i18n source, and the
 * authored-placement rules below must not judge a build artifact.
 */
function isGeneratedDeclarationFile(fileName) {
  return /\.d\.ts$/u.test(fileName);
}

const DECLARATION_FILE_RE = /\.d\.ts$/u;

/**
 * Compiled output that lands next to the TypeScript source that produced it — a
 * `.js`/`.jsx`/`.d.ts` file with an authored `.ts`/`.tsx` twin of the same stem.
 *
 * Package `exports` maps resolve to the `.ts` source, and this workspace's
 * `.gitignore` classifies the PC-package form as "build droppings", so such a
 * file is unreachable derived output: nothing imports it, no bundle includes it,
 * and regenerating it is a `tsc` side effect rather than a source change. A
 * finding a developer cannot fix in source is noise, and noise is what makes a
 * gate get switched off. The authored `.ts` twin stays fully scanned, so the
 * retired-header rule still sees every line a human can actually edit.
 */
function isDerivedTypeScriptOutput(filePath) {
  const isDeclaration = DECLARATION_FILE_RE.test(filePath);
  const ext = path.extname(filePath);
  if (!isDeclaration && ext !== '.js' && ext !== '.jsx') return false;
  const stem = isDeclaration ? filePath.slice(0, -'.d.ts'.length) : filePath.slice(0, -ext.length);
  return fs.existsSync(`${stem}.ts`) || fs.existsSync(`${stem}.tsx`);
}

function hasLikelyAuthoredMessageCopy(text) {
  return /[\u3400-\u9FFF]/u.test(text)
    || /\b(?:title|label|message|error|submit|placeholder|description|tooltip|empty|loading|success|cancel|confirm)\b\s*[:=]/iu.test(text);
}

function validateLocaleSourceLayout({ rel, after, allowedExtensions, label, allowKeys = false, text = '', issues }) {
  if (after.length === 0) return;
  if (isGitkeep(after)) return;
  if (after[0] === 'generated') return;
  if (allowKeys && after[0] === 'keys') {
    if (after.length < 3) {
      issues.push(`${rel}: ${label} i18n key contracts must use keys/<domain>/<capability>`);
    }
    return;
  }

  const fileName = after[after.length - 1];
  if (isGeneratedDeclarationFile(fileName)) return;
  if (after.length === 1 && isThinI18nBoundaryFile(fileName)) {
    if (hasLikelyAuthoredMessageCopy(text)) {
      issues.push(`${rel}: thin i18n registry files must not contain authored message copy`);
    }
    return;
  }
  if (SOURCE_LOCALE_MONOLITH_RE.test(fileName) && after.length <= 2) {
    issues.push(`${rel}: locale monolith is forbidden; split authored messages by <locale>/<domain>/<capability>/<fragment>`);
    return;
  }

  const locale = after[0];
  if (!LOCALE_FILE_RE.test(locale)) {
    issues.push(`${rel}: authored i18n source directory must start with a normalized BCP 47 locale such as zh-CN or en-US`);
    return;
  }

  if (after.length < 4) {
    issues.push(`${rel}: ${label} i18n fragments must use <locale>/<domain>/<capability>/<fragment>`);
    return;
  }

  const ext = path.extname(fileName);
  if (!allowedExtensions.has(ext)) {
    issues.push(`${rel}: ${label} i18n fragment extension ${ext || '<none>'} is not part of the standard source layout`);
  }
}

function validateDatabaseSeedLayout({ rel, after, issues }) {
  if (after.length === 0 || isGitkeep(after)) return;
  const locale = after[0];
  if (!LOCALE_FILE_RE.test(locale)) {
    issues.push(`${rel}: database locale seed directory must start with normalized BCP 47 locale`);
    return;
  }
  if (after.length < 4) {
    issues.push(`${rel}: database locale seed files must use locales/<locale>/<domain>/<capability>/<seed>`);
  }
}

function countAndroidStrings(text) {
  return [...text.matchAll(/<string\b/gu)].length;
}

function countIosStrings(text) {
  return [...text.matchAll(/^\s*"[^"]+"\s*=/gmu)].length;
}

function countJsonLikeMessages(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.keys(parsed).filter((key) => !key.startsWith('@')).length;
    }
  } catch {
    return [...text.matchAll(/"[^"]+"\s*:/gu)].length;
  }
  return 0;
}

function platformAggregateIssue(rel, text) {
  const normalized = rel;
  const basename = path.posix.basename(normalized);
  let messageCount = 0;

  if (/\/src\/main\/res\/values[^/]*\/strings\.xml$/u.test(normalized)) {
    messageCount = countAndroidStrings(text);
  } else if (/\.lproj\/Localizable\.strings$/u.test(normalized)) {
    messageCount = countIosStrings(text);
  } else if (/\/src\/main\/resources\/.*\/element\/string\.json$/u.test(normalized)) {
    messageCount = countJsonLikeMessages(text);
  } else if (/\/lib\/l10n\/app_[A-Za-z0-9_-]+\.arb$/u.test(normalized)) {
    messageCount = countJsonLikeMessages(text);
  } else if (
    (normalized.includes('/platform/') || normalized.includes('/miniprogram/'))
    && normalized.includes('/i18n/')
    && /\.(?:json|ts|js)$/u.test(basename)
  ) {
    messageCount = countJsonLikeMessages(text);
  } else {
    return null;
  }

  if (messageCount > 2 && !hasGeneratedMarker(text)) {
    return `${rel}: platform aggregate i18n resource contains ${messageCount} messages without a generated marker; author source fragments under the SDKWork i18n layout`;
  }
  return null;
}

function hasLikelyAuthoredRustMessage(text) {
  return /[\u3400-\u9FFF]/u.test(text) || /\b[A-Z0-9_]*(?:TITLE|LABEL|MESSAGE|ERROR|SUBMIT)[A-Z0-9_]*\b\s*:/u.test(text);
}

function validateBackendLegacyMessageLocations({ filePath, rel, text, issues }) {
  if (/(?:^|\/)crates\/[^/]+\/src\/i18n\.rs$/u.test(rel) && hasLikelyAuthoredRustMessage(text)) {
    issues.push(`${rel}: Rust backend message resources must be authored under resources/i18n/<locale>/<domain>/<capability>/; src/i18n.rs may only be a thin registry`);
  }
  if (/\/src\/main\/resources\/messages(?:_[A-Za-z0-9_]+)?\.(?:properties|yaml|yml|json)$/u.test(rel)) {
    issues.push(`${rel}: Java/Spring backend message resources must be authored under src/main/resources/i18n/<locale>/<domain>/<capability>/`);
  }
  if (path.basename(filePath) === 'Localizable.strings' && !rel.includes('.lproj/')) {
    issues.push(`${rel}: iOS localization files must be generated platform projections under .lproj or authored fragments under I18n/<locale>/<domain>/<capability>/`);
  }
}

function validateRootI18nDirectory({ segments, rel, issues }) {
  if (segments[0] !== 'i18n') return;
  if (segments[1] === 'keys') {
    if (segments.length < 4 && !isGitkeep(segments)) {
      issues.push(`${rel}: root i18n key contracts must use i18n/keys/<domain>/<capability>`);
    }
    return;
  }
  if (segments[1] === 'generated') return;
  issues.push(`${rel}: repository-root i18n directories are forbidden for application/backend message copy; use package-local i18n fragments`);
}

function validateI18nPath(filePath, repoRoot, issues) {
  const rel = toPosix(path.relative(repoRoot, filePath));
  const text = readText(filePath);

  // Forbidden literal protocol surface is scanned in every language the
  // workspace ships. Retiring the custom locale request header is a
  // workspace-wide wire contract (`I18N_SPEC.md` section 4), so a JS/TSX,
  // Java/Kotlin, Swift, ArkTS, Go, or Python file counts exactly as much as a
  // Rust or TypeScript one — leaving any of them unscanned is how a retired
  // header survives in one of a hundred repositories.
  //
  // Two surfaces are deliberately outside this scan:
  //
  // - Markdown is not scanned, because a prohibition has to be able to name
  //   what it forbids: `I18N_SPEC.md` section 4 and every `AGENTS.md` restating
  //   it say "a custom locale request header such as ... is retired", which is
  //   correct specification writing. Adding `.md` here would punish the spec for
  //   being explicit and push the rule back into ambiguity.
  // - Derived compiler output next to its `.ts` source is skipped (see
  //   `isDerivedTypeScriptOutput`): the authored twin carries the same token and
  //   is the file a developer can actually fix.
  if (!isDerivedTypeScriptOutput(filePath)) {
    validateRetiredLocaleRequestHeader({ rel, text, issues });
  }

  // Authored i18n resource-layout rules judge *where a human placed a file*,
  // so they only apply to the languages SDKWork authors locale resources in.
  if (!isI18nSourceFile(filePath)) return;

  const segments = rel.split('/');

  validateRootI18nDirectory({ segments, rel, issues });

  const platformIssue = platformAggregateIssue(rel, text);
  if (platformIssue) {
    issues.push(platformIssue);
  }
  validateBackendLegacyMessageLocations({ filePath, rel, text, issues });

  const flutterAfter = afterSequence(segments, ['lib', 'src', 'i18n']);
  if (flutterAfter) {
    validateLocaleSourceLayout({
      rel,
      after: flutterAfter,
      allowedExtensions: new Set(['.arb', '.json']),
      label: 'Flutter/Dart',
      text,
      issues,
    });
  }

  const javaAfter = afterSequence(segments, ['src', 'main', 'resources', 'i18n']);
  if (javaAfter) {
    validateLocaleSourceLayout({
      rel,
      after: javaAfter,
      allowedExtensions: new Set(['.properties', '.yaml', '.yml', '.json']),
      label: 'Java/Spring',
      text,
      issues,
    });
  }

  const tsAfter = afterSequence(segments, ['src', 'i18n']);
  if (tsAfter && !flutterAfter) {
    validateLocaleSourceLayout({
      rel,
      after: tsAfter,
      allowedExtensions: new Set(['.ts', '.json']),
      label: 'TypeScript',
      allowKeys: true,
      text,
      issues,
    });
  }

  const androidAfter = afterSequence(segments, ['src', 'main', 'i18n']);
  if (androidAfter) {
    validateLocaleSourceLayout({
      rel,
      after: androidAfter,
      allowedExtensions: new Set(['.json', '.xml', '.properties']),
      label: 'Android',
      text,
      issues,
    });
  }

  const iosAfter = (() => {
    const sourcesIndex = segments.indexOf('Sources');
    if (sourcesIndex >= 0 && segments[sourcesIndex + 2] === 'I18n') {
      return segments.slice(sourcesIndex + 3);
    }
    return null;
  })();
  if (iosAfter) {
    validateLocaleSourceLayout({
      rel,
      after: iosAfter,
      allowedExtensions: new Set(['.json', '.strings.json']),
      label: 'iOS/Swift',
      text,
      issues,
    });
  }

  const harmonyAfter = afterSequence(segments, ['src', 'main', 'ets', 'i18n']);
  if (harmonyAfter) {
    validateLocaleSourceLayout({
      rel,
      after: harmonyAfter,
      allowedExtensions: new Set(['.json', '.ts']),
      label: 'Harmony/ArkTS',
      text,
      issues,
    });
  }

  const rustAfter = afterSequence(segments, ['resources', 'i18n']);
  if (rustAfter && !javaAfter) {
    validateLocaleSourceLayout({
      rel,
      after: rustAfter,
      allowedExtensions: new Set(['.ftl', '.json', '.toml']),
      label: 'Rust',
      text,
      issues,
    });
  }

  const databaseAfter = afterSequence(segments, ['database', 'seeds', 'locales']);
  if (databaseAfter) {
    validateDatabaseSeedLayout({ rel, after: databaseAfter, issues });
  }
}

/**
 * Validate one repository root.
 *
 * `stats` is an optional accumulator. A gate that can report "passed" without
 * having read anything is indistinguishable from a gate that is not wired at
 * all (`QUALITY_GATE_SPEC.md` section 1.1, "Fail closed"), so callers need the
 * scanned-unit count to prove the check was not vacuous. The return value stays
 * a plain issue array so existing callers keep working unchanged.
 */
export function validateI18nStandard(repoRoot, stats = {}) {
  const issues = [];
  const ignoredPaths = readGitIgnoredPaths(repoRoot);
  const files = walkFiles(repoRoot, ignoredPaths);
  stats.scannedFiles = (stats.scannedFiles ?? 0) + files.length;
  for (const filePath of files) {
    validateI18nPath(filePath, repoRoot, issues);
  }
  return issues;
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: SPECS_ROOT },
      workspace: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const stats = {};
  const root = path.resolve(values.root);

  // A non-existent or non-directory root used to scan zero files and print
  // "passed", which reads as a green gate while enforcing nothing. When a
  // repository wires this check, a moved or renamed root must fail loudly
  // instead of silently retiring the locale contract.
  if (!values.workspace && (!fs.existsSync(root) || !fs.statSync(root).isDirectory())) {
    console.error(`i18n standard check cannot run: not a directory: ${root}`);
    process.exit(2);
  }

  const issues = values.workspace
    ? collectWorkspaceValidationIssues(
      path.resolve(values.workspace),
      (repoRoot) => validateI18nStandard(repoRoot, stats),
    )
    : validateI18nStandard(root, stats);

  if (issues.length > 0) {
    console.error('i18n standard check failed: violations found');
    for (const issue of issues.slice(0, 200)) {
      console.error(`- ${issue}`);
    }
    if (issues.length > 200) {
      console.error(`- ... and ${issues.length - 200} more`);
    }
    process.exit(1);
  }

  // Refuse to certify an empty scan: "passed" over zero files is a fail-open
  // gate, not a green one.
  if ((stats.scannedFiles ?? 0) === 0) {
    console.error('i18n standard check cannot run: scanned 0 files, refusing to report success on an empty scan');
    process.exit(2);
  }

  console.log(`i18n standard check passed (${stats.scannedFiles} file(s) scanned)`);
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main();
}
