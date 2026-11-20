#!/usr/bin/env node

/**
 * Make the load-bearing claims of APPLICATION_FACTORY_DEPLOYMENT_SPEC.md executable.
 *
 * The standard is the umbrella contract for the application factory (one deploy application,
 * one installation, one hosting carrier, one scaffold, one remix source) and until this tool
 * existed it had no machine gate at all: every claim below was only ever checked by a human
 * re-reading the text. The gate is deliberately scoped to the claims whose falsity has an
 * observable artifact, so it cannot drift into a second authority for the schema or the API.
 *
 *   node tools/check-application-factory-standard.mjs [--root <standards-root>] [--workspace <workspace-root>]
 *
 * `--root` defaults to the current directory. `--workspace` defaults to `<root>/..`, because
 * the module repositories the standard cites are siblings of the standards repository. A
 * missing module repository is a `[skip]` (only the standards repository is checked out); a
 * module repository that exists but lacks the named artifact is a failure.
 *
 * Exit codes: 0 clean, 1 violations, 2 unusable configuration.
 *
 * The pure check functions are exported so `check-application-factory-standard.test.mjs` can
 * assert against fixtures without spawning a process.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const FACTORY_SPEC = 'APPLICATION_FACTORY_DEPLOYMENT_SPEC.md';
const IDENTITY_SPEC = 'APPLICATION_IDENTITY_SPEC.md';

/**
 * Section headings the standard's own structure depends on. Sections 2, 3, 9 and 13 carry the
 * concept/authority matrix, the lifecycle, the compensation semantics, and the landing (gap)
 * table; removing one silently orphans every cross-reference that names it.
 */
export const REQUIRED_HEADINGS = [
  '## 2. Concept And Unique Authority Matrix',
  '## 3. Lifecycle: Publish To Uninstall',
  '## 9. Failure And Compensation Semantics',
  '## 13. Landing Status And Known Gaps',
];

export const SECTION_13_HEADING = '## 13. Landing Status And Known Gaps';

/** A landing row is only evidence if it carries the date the evidence was last re-read. */
export const MIN_SECTION_13_ROWS = 6;
export const REVIEWED_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const SECTION_13_CELLS = 4;

/**
 * Vocabulary the factory standard must keep using. `Product application` is retired for the
 * runtime identity (it survives in APPLICATION_IDENTITY_SPEC.md only as the commerce-side
 * artifact owner, and even there not capitalized); `deploy_app_source_spec` is the delivery-source
 * boundary recorded in section 13, which is easy to erase by "tidying" the row.
 */
const FACTORY_REQUIRED_TERMS = [
  'Deploy application',
  'Installation',
  'Hosting carrier',
  'Scaffold',
  'deploy_app_source_spec',
];

/**
 * Terms retired from the identity standard. Matched case-sensitively: the active prose still
 * says "product application" in lower case as a common noun, while the capitalized `Product
 * application` label and the `Blueprint` concept are the retired identities.
 */
const IDENTITY_FORBIDDEN_TERMS = ['Product application', 'Blueprint'];

/**
 * Every database artifact named by section 2 (concept anchors), section 6 (source boundary) and
 * section 13 (evidence rows). `deploy_app_source` is allowed to live in the remix migration
 * instead of the baseline, because the baseline was split after the table was first authored.
 */
const DATABASE_ARTIFACTS = [
  {
    module: 'sdkwork-deployments',
    file: 'database/ddl/baseline/postgres/0001_deploy_baseline.sql',
    tokens: [
      { token: 'CREATE TABLE IF NOT EXISTS deploy_app' },
      {
        token: 'deploy_app_source',
        alternates: ['database/migrations/postgres/0011_deploy_app_remix_source.up.sql'],
      },
      { token: 'deploy_app_platform_target' },
      { token: 'deploy_app_environment' },
      { token: 'deploy_application_scaffold' },
      { token: 'chk_deploy_app_status' },
      { token: 'chk_deploy_app_app_kind' },
      { token: 'chk_deploy_deployment_environment' },
      { token: 'chk_deploy_app_uninstall_status' },
      { token: 'chk_deploy_app_environment_env_key' },
    ],
  },
  {
    module: 'sdkwork-deployments',
    file: 'database/migrations/postgres/0011_deploy_app_remix_source.up.sql',
    tokens: [
      { token: 'uk_deploy_app_source_app' },
      { token: 'chk_deploy_app_source_kind' },
      { token: 'chk_deploy_app_source_pointer' },
    ],
  },
  {
    module: 'sdkwork-deployments',
    file: 'database/migrations/postgres/0015_application_factory_lifecycle_guards.up.sql',
    tokens: [
      { token: 'chk_deploy_deployment_environment' },
      { token: 'chk_deploy_app_environment_env_key' },
      { token: 'chk_deploy_app_uninstall_status' },
      { token: 'chk_deploy_app_app_surface' },
    ],
  },
  {
    module: 'sdkwork-iam',
    glob: 'database/migrations/postgres/0043_*.up.sql',
    tokens: [{ token: 'uk_iam_application_installation_deploy' }],
  },
  {
    module: 'sdkwork-iam',
    glob: 'database/migrations/postgres/0044_*.up.sql',
    tokens: [
      { token: 'chk_iam_application_installation_ownership_scope' },
      { token: 'chk_iam_application_installation_ownership_alignment' },
    ],
  },
  {
    module: 'sdkwork-webserver',
    file: 'database/migrations/postgres/0031_webserver_application_deploy_application_id.up.sql',
    tokens: [{ token: 'uk_webserver_application_deploy_application_id' }],
  },
];

/** A backticked spec filename: `SOME_SPEC.md`. Artifact paths in backticks do not match. */
const SPEC_REFERENCE_PATTERN = /`([A-Z][A-Z0-9_]+\.md)`/g;

function group(name, label) {
  return { name, label, checked: 0, failures: [], skips: [] };
}

function fail(target, file, message) {
  target.failures.push({ file, message });
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

/**
 * Split one markdown table row into cells. Escaped pipes (`\|`) stay inside their cell, and the
 * leading/trailing delimiter is dropped without touching an escaped one.
 */
function splitTableRow(line) {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

/**
 * Parse the landing-status table between `## 13.` and the next `## ` heading (or EOF).
 *
 * Returns the header cells plus one entry per data row (`line` is 1-based so a failure can point
 * at the exact row). Blank lines and non-table prose are not rows; a table that is interrupted
 * by a heading ends the section.
 */
export function parseSection13Rows(text) {
  const lines = text.split('\n');
  const headingIndex = lines.findIndex(
    (line) => line.replace(/\r$/, '').trimEnd() === SECTION_13_HEADING,
  );
  if (headingIndex < 0) return { headingIndex, headerCells: null, rows: [] };

  let headerCells = null;
  const rows = [];
  let tableStarted = false;
  let separatorSeen = false;

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '');
    if (/^##\s/.test(line)) break;
    // The landing table is the first table in the section: a blank line after its rows closes it,
    // so a later illustration table cannot be mistaken for landing rows.
    if (tableStarted && line.trim() === '') break;
    if (!line.trimStart().startsWith('|')) continue;

    const cells = splitTableRow(line);
    if (!tableStarted) {
      // The first pipe row after the heading is the header row of the landing table.
      tableStarted = true;
      headerCells = cells;
      continue;
    }
    if (!separatorSeen && isSeparatorRow(cells)) {
      separatorSeen = true;
      continue;
    }
    rows.push({ line: index + 1, cells });
  }

  return { headingIndex, headerCells, rows };
}

/**
 * Collect every distinct backticked spec filename the factory standard references. Used to prove
 * that the standard does not point at a renamed or deleted authority.
 */
export function collectSpecReferences(text) {
  const names = new Set();
  for (const match of text.matchAll(SPEC_REFERENCE_PATTERN)) names.add(match[1]);
  return [...names].sort();
}

/** (a) The factory standard exists and still carries the four load-bearing section headings. */
function checkHeadings(root) {
  const result = group('headings', 'section headings');
  const abs = path.join(root, FACTORY_SPEC);
  const text = readText(abs);
  if (text === null) {
    fail(result, FACTORY_SPEC, 'factory standard is missing');
    return result;
  }
  const lines = new Set(text.split('\n').map((line) => line.replace(/\r$/, '').trimEnd()));
  for (const heading of REQUIRED_HEADINGS) {
    result.checked += 1;
    if (!lines.has(heading)) fail(result, FACTORY_SPEC, `missing section heading \`${heading}\``);
  }
  return result;
}

/** (b) Every landing row carries four cells and a real `reviewed` date; the table is not short. */
function checkSection13(root) {
  const result = group('section-13', 'landing status table');
  const abs = path.join(root, FACTORY_SPEC);
  const text = readText(abs);
  if (text === null) {
    fail(result, FACTORY_SPEC, 'factory standard is missing');
    return result;
  }

  const { headingIndex, headerCells, rows } = parseSection13Rows(text);
  if (headingIndex < 0) {
    fail(result, FACTORY_SPEC, `missing section heading \`${SECTION_13_HEADING}\``);
    return result;
  }
  if (headerCells === null) {
    fail(result, FACTORY_SPEC, 'section 13 has no landing-status table');
    return result;
  }
  if (headerCells.length !== SECTION_13_CELLS) {
    fail(
      result,
      FACTORY_SPEC,
      `section 13 header has ${headerCells.length} cells, expected ${SECTION_13_CELLS}`,
    );
  }
  const reviewedHeader = headerCells[headerCells.length - 1] ?? '';
  if (!/^reviewed$/i.test(reviewedHeader)) {
    fail(
      result,
      FACTORY_SPEC,
      `section 13 last column is \`${reviewedHeader}\`, expected \`Reviewed\``,
    );
  }

  for (const row of rows) {
    result.checked += 1;
    if (row.cells.length !== SECTION_13_CELLS) {
      fail(
        result,
        FACTORY_SPEC,
        `section 13 line ${row.line}: row has ${row.cells.length} cells, expected ${SECTION_13_CELLS}`,
      );
      continue;
    }
    const reviewed = row.cells[row.cells.length - 1];
    if (!REVIEWED_DATE_PATTERN.test(reviewed)) {
      fail(
        result,
        FACTORY_SPEC,
        `section 13 line ${row.line}: reviewed cell \`${reviewed}\` is not a YYYY-MM-DD date`,
      );
    }
  }

  if (rows.length < MIN_SECTION_13_ROWS) {
    fail(
      result,
      FACTORY_SPEC,
      `section 13 carries ${rows.length} data row(s), expected at least ${MIN_SECTION_13_ROWS}`,
    );
  }
  return result;
}

/** Minimal single-`*` glob: `0043_*.up.sql` matches `0043_x.up.sql`, never a nested path. */
function matchGlob(dir, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const matcher = new RegExp(`^${escaped}$`);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => matcher.test(name)).sort();
}

/** (c) The artifacts section 2/6/13 name still exist in the owning module repositories. */
function checkDatabaseArtifacts(workspace) {
  const result = group('database-artifacts', 'database artifacts');
  if (!isDirectory(workspace)) {
    fail(result, workspace, 'workspace root is not a directory; pass --workspace <workspace-root>');
    return result;
  }

  // One read per file even when a file backs several claims.
  const texts = new Map();
  const textOf = (abs) => {
    if (!texts.has(abs)) texts.set(abs, readText(abs));
    return texts.get(abs);
  };

  // Read every module baseline/migration once, then evaluate the claims against memory.
  const modulePresence = new Map();
  for (const artifact of DATABASE_ARTIFACTS) {
    if (!modulePresence.has(artifact.module)) {
      const moduleRoot = path.join(workspace, artifact.module);
      const present = isDirectory(moduleRoot);
      modulePresence.set(artifact.module, present);
      if (!present) result.skips.push(`${artifact.module} repository not present`);
    }
    if (!modulePresence.get(artifact.module)) continue;

    const moduleRoot = path.join(workspace, artifact.module);
    if (artifact.file) {
      const rel = toPosix(path.join(artifact.module, artifact.file));
      const text = textOf(path.join(moduleRoot, artifact.file));
      if (text === null) {
        fail(result, rel, 'missing artifact file');
        continue;
      }
      for (const requirement of artifact.tokens) {
        result.checked += 1;
        if (text.includes(requirement.token)) continue;
        const alternateHit = (requirement.alternates ?? []).some((alternate) => {
          const alternateText = textOf(path.join(moduleRoot, alternate));
          if (alternateText === null) return false;
          return alternateText.includes(requirement.token);
        });
        if (alternateHit) continue;
        const alternateNote = requirement.alternates?.length
          ? ` (not found in the baseline or in ${requirement.alternates.join(', ')})`
          : '';
        fail(result, rel, `missing \`${requirement.token}\`${alternateNote}`);
      }
      continue;
    }

    const rel = toPosix(path.join(artifact.module, artifact.glob));
    const dir = path.join(moduleRoot, path.dirname(artifact.glob));
    const matches = matchGlob(dir, path.basename(artifact.glob));
    if (matches.length === 0) {
      fail(result, rel, 'no file matching the migration glob');
      continue;
    }
    const text = matches.map((name) => textOf(path.join(dir, name)) ?? '').join('\n');
    for (const requirement of artifact.tokens) {
      result.checked += 1;
      if (!text.includes(requirement.token)) {
        fail(result, rel, `missing \`${requirement.token}\` (searched ${matches.join(', ')})`);
      }
    }
  }
  return result;
}

/** (d) Retired vocabulary stays out of the identity standard, and the factory keeps its own. */
function checkVocabulary(root) {
  const result = group('vocabulary', 'vocabulary');
  const identityPath = path.join(root, IDENTITY_SPEC);
  const identityText = readText(identityPath);
  if (identityText === null) {
    fail(result, IDENTITY_SPEC, 'identity standard is missing');
  } else {
    for (const term of IDENTITY_FORBIDDEN_TERMS) {
      result.checked += 1;
      if (identityText.includes(term)) {
        fail(result, IDENTITY_SPEC, `retired term \`${term}\` is still present`);
      }
    }
  }

  const factoryText = readText(path.join(root, FACTORY_SPEC));
  if (factoryText === null) {
    fail(result, FACTORY_SPEC, 'factory standard is missing');
    return result;
  }
  for (const term of FACTORY_REQUIRED_TERMS) {
    result.checked += 1;
    if (!factoryText.includes(term)) {
      fail(result, FACTORY_SPEC, `missing required vocabulary \`${term}\``);
    }
  }
  return result;
}

/** (e) Every spec filename the factory standard cites resolves inside the standards root. */
function checkCrossReferences(root) {
  const result = group('cross-references', 'cross-references');
  const text = readText(path.join(root, FACTORY_SPEC));
  if (text === null) {
    fail(result, FACTORY_SPEC, 'factory standard is missing');
    return result;
  }
  for (const name of collectSpecReferences(text)) {
    result.checked += 1;
    const abs = path.join(root, name);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      fail(result, FACTORY_SPEC, `references missing spec \`${name}\``);
    }
  }
  return result;
}

/**
 * Run every group against a standards root and an optional workspace root.
 * Returns the per-group results, the flattened failures, and the skips for reporting.
 */
export function runChecks({ root, workspace = path.resolve(root, '..') }) {
  const groups = [
    checkHeadings(root),
    checkSection13(root),
    checkDatabaseArtifacts(workspace),
    checkVocabulary(root),
    checkCrossReferences(root),
  ];
  return {
    root,
    workspace,
    groups,
    failures: groups.flatMap((entry) => entry.failures),
    skips: groups.flatMap((entry) => entry.skips),
    ok: groups.every((entry) => entry.failures.length === 0),
  };
}

function usage() {
  return [
    'Usage: node tools/check-application-factory-standard.mjs [--root <standards-root>] [--workspace <workspace-root>]',
    '',
    `  --root       standards root holding ${FACTORY_SPEC} (default: cwd)`,
    '  --workspace  workspace root holding the sdkwork-* module repositories (default: <root>/..)',
    '',
    'Exit codes: 0 clean, 1 violations, 2 unusable configuration.',
  ].join('\n');
}

function report(outcome) {
  for (const entry of outcome.groups) {
    for (const skip of entry.skips) console.log(`[skip] ${skip}`);
    if (entry.failures.length === 0) {
      console.log(`[ok] ${entry.label}: ${entry.checked} check(s) passed`);
      continue;
    }
    for (const failure of entry.failures) {
      console.log(`[fail] ${failure.file}: ${failure.message}`);
    }
  }
  if (outcome.ok) {
    const passed = outcome.groups.length;
    console.log(`\napplication factory standard ok (${passed} group(s), ${outcome.failures.length} failure(s))`);
    return 0;
  }
  console.log(`\napplication factory standard failed (${outcome.failures.length} failure(s))`);
  return 1;
}

function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(entry) === normalize(self);
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        root: { type: 'string' },
        workspace: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    // An unknown flag or a bare positional is unusable configuration, not a standards violation.
    console.error(`application factory standard: ${error.message}`);
    console.error(usage());
    return 2;
  }

  if (values.help) {
    console.log(usage());
    return 0;
  }

  const root = path.resolve(values.root ?? process.cwd());
  const workspace = values.workspace ? path.resolve(values.workspace) : path.resolve(root, '..');

  if (!isDirectory(root)) {
    console.error(`application factory standard: standards root is not a directory: ${root}`);
    return 2;
  }
  if (!isDirectory(workspace)) {
    // A typo in --workspace would otherwise be reported as three missing module artifacts.
    console.error(`application factory standard: workspace root is not a directory: ${workspace}`);
    return 2;
  }

  return report(runChecks({ root, workspace }));
}

if (isDirectInvocation()) {
  process.exitCode = main();
}
