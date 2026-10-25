#!/usr/bin/env node

/**
 * Safely aligns marker-owned progressive-loading guidance in explicitly listed
 * AGENTS.md files. This tool never discovers targets by walking a workspace.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { AGENTS_SECTION_BODY as APP_SDK_SECTION_BODY } from './lib/app-sdk-consumer-import-patterns.mjs';
import {
  AGENTS_SECTION_BODY as HTTP_SECTION_BODY,
  upsertAgentsEnvelopeSection,
} from './lib/http-response-envelope-patterns.mjs';
import {
  AGENTS_PAGINATION_SECTION_BODY as PAGINATION_SECTION_BODY,
  upsertAgentsPaginationSection,
} from './lib/pagination-patterns.mjs';

const TOOL_PATH = fileURLToPath(import.meta.url);
const PROGRESSIVE_MARKER = 'SDKWORK-PROGRESSIVE-LOADING: v1';
const VERIFICATION_MARKER = 'SDKWORK-VERIFICATION-ROUTING: v1';
const TARGET_ROOT_KINDS = new Set(['workspace', 'repository', 'application', 'component']);
const EXCLUDED_PATH_SEGMENTS = new Set([
  '.git',
  '.next',
  '.pnpm',
  '.turbo',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'external',
  'fixture',
  'fixtures',
  'gen',
  'generated',
  'node_modules',
  'out',
  'target',
  'test',
  'test-data',
  'testdata',
  'tests',
  'third-party',
  'third_party',
  'upstream',
  'vendor',
  '__fixtures__',
  '__tests__',
]);

const SECTION_HEADINGS = {
  soul: 'SDKWORK Soul',
  standards: 'SDKWORK Standards',
  identity: 'Application Identity',
  localDictionary: 'Local Dictionary Structure',
  specResolution: 'Spec Resolution Order',
  requiredSpecs: 'Required Specs By Task Type',
  codeStyle: 'Code Style Rules',
  verification: 'Build, Test, and Verification',
  execution: 'Agent Execution Rules',
  humanReview: 'Human Review Rules',
};
const REQUIRED_AGENT_SECTION_HEADINGS = Object.values(SECTION_HEADINGS);
const PROTECTED_CANONICAL_SECTIONS = new Set([
  'App SDK Consumer Imports',
  'HTTP API Response Envelope',
  'List And Search Pagination',
]);

class AlignmentError extends Error {}

function usage() {
  return [
    'Usage: node tools/align-agents-progressive-loading.mjs --manifest <path> [--workspace <path>] [--repair-http-envelope] [--ensure-pagination] [--write]',
    '',
    'Applies only manifest-listed AGENTS.md targets. Dry-run is the default; --write is required to modify files.',
    '',
    'Manifest target fields:',
    '- rootPath: workspace-relative root path',
    '- agentPath: must be AGENTS.md relative to rootPath',
    '- relativeSpecsPath: path from rootPath to the sdkwork-specs root',
    '- action: update or create',
    '- beforeSha256: current SHA-256 for update, null for create',
    '- rootKind: workspace, repository, application, or component',
    '- repairHttpEnvelope: true enables --repair-http-envelope for this update target only',
    '- ensurePagination: true enables --ensure-pagination for this update target only',
  ].join('\n');
}

function fail(message) {
  throw new AlignmentError(message);
}

function toPosix(filePath) {
  return filePath.replaceAll(path.sep, '/');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathSegments(filePath) {
  return filePath.split(/[\\/]+/u).filter(Boolean);
}

function assertNoExcludedSegments(workspace, candidate, label) {
  const relative = path.relative(workspace, candidate);
  for (const segment of pathSegments(relative)) {
    if (EXCLUDED_PATH_SEGMENTS.has(segment.toLowerCase())) {
      fail(`${label} uses excluded directory segment "${segment}"`);
    }
  }
}

function assertRelativePath(value, label, { allowDot = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a non-empty relative path`);
  }
  if (path.isAbsolute(value)) {
    fail(`${label} must be relative, not absolute`);
  }
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    fail(`${label} must not escape its base directory`);
  }
  if (!allowDot && (normalized === '.' || normalized === '')) {
    fail(`${label} must name a file or directory`);
  }
  return normalized;
}

function resolveWithin(parent, value, label, options) {
  const normalized = assertRelativePath(value, label, options);
  const resolved = path.resolve(parent, normalized);
  if (!isWithin(parent, resolved)) {
    fail(`${label} resolves outside its base directory`);
  }
  return resolved;
}

function assertDirectory(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} does not exist: ${filePath}`);
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    fail(`${label} must not be a symbolic link: ${filePath}`);
  }
  if (!stat.isDirectory()) {
    fail(`${label} must be a directory: ${filePath}`);
  }
}

function assertRegularFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} does not exist: ${filePath}`);
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    fail(`${label} must not be a symbolic link: ${filePath}`);
  }
  if (!stat.isFile()) {
    fail(`${label} must be a regular file: ${filePath}`);
  }
}

function assertNoSymlinksBetween(base, candidate, label) {
  if (!isWithin(base, candidate)) {
    fail(`${label} resolves outside ${base}`);
  }
  assertDirectory(base, 'workspace root');
  const relative = path.relative(base, candidate);
  let current = base;
  for (const segment of pathSegments(relative)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      break;
    }
    if (fs.lstatSync(current).isSymbolicLink()) {
      fail(`${label} traverses a symbolic link: ${current}`);
    }
  }
}

function gitRepositoryRoot(root, workspace, label) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'not a Git worktree';
    fail(`${label} must be inside a Git worktree: ${detail}`);
  }
  const repositoryRoot = path.resolve(result.stdout.trim());
  if (!isWithin(workspace, repositoryRoot) || !isWithin(repositoryRoot, root)) {
    fail(`${label} Git worktree must remain inside the declared workspace`);
  }
  assertNoSymlinksBetween(workspace, repositoryRoot, `${label} Git worktree`);
  return repositoryRoot;
}

function assertGitClean(repositoryRoot, agentPath, label) {
  const relativeAgentPath = path.relative(repositoryRoot, agentPath);
  const result = spawnSync(
    'git',
    ['-C', repositoryRoot, 'status', '--porcelain=v1', '--untracked-files=all', '--', relativeAgentPath],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'git status failed';
    fail(`${label} Git status check failed: ${detail}`);
  }
  if (result.stdout.trim() !== '') {
    fail(`${label} is dirty and must be clean before alignment`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function lineEnding(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function markerStart(marker) {
  return `<!-- ${marker} -->`;
}

function markerEnd(marker) {
  return `<!-- /${marker} -->`;
}

function markerBlock(marker, body, eol) {
  return [markerStart(marker), body.trim().replace(/\r?\n/gu, eol), markerEnd(marker)].join(eol);
}

function specFile(specsPath, fileName) {
  return specsPath === '.' ? fileName : `${specsPath}/${fileName}`;
}

function allLevelTwoSections(text) {
  const headings = [...text.matchAll(/^##[ \t]+(.+?)[ \t]*\r?$/gmu)];
  return headings.map((match, index) => ({
    heading: match[1].trim(),
    start: match.index,
    contentStart: (match.index ?? 0) + match[0].length,
    end: headings[index + 1]?.index ?? text.length,
  }));
}

function sectionRange(text, heading) {
  const matches = allLevelTwoSections(text).filter((section) => section.heading === heading);
  if (matches.length === 0) {
    fail(`update target is missing required section "${heading}"`);
  }
  if (matches.length > 1) {
    fail(`update target has duplicate required section "${heading}"`);
  }
  return matches[0];
}

function validateRequiredSectionUniqueness(text) {
  const sections = allLevelTwoSections(text);
  for (const heading of REQUIRED_AGENT_SECTION_HEADINGS) {
    const count = sections.filter((section) => section.heading === heading).length;
    if (count > 1) {
      fail(`update target has duplicate required section "${heading}"`);
    }
  }
}

function countOccurrences(text, value) {
  if (value === '') return 0;
  return text.split(value).length - 1;
}

function validateMarkerLocations(text) {
  const sections = allLevelTwoSections(text);
  const allowed = new Map([
    [
      PROGRESSIVE_MARKER,
      new Set([SECTION_HEADINGS.standards, SECTION_HEADINGS.specResolution, SECTION_HEADINGS.execution]),
    ],
    [VERIFICATION_MARKER, new Set([SECTION_HEADINGS.verification])],
  ]);

  for (const [marker, allowedHeadings] of allowed) {
    const markerPattern = new RegExp(`${escapeRegExp(markerStart(marker))}|${escapeRegExp(markerEnd(marker))}`, 'gu');
    let match;
    while ((match = markerPattern.exec(text)) !== null) {
      const containingSection = sections.find(
        (section) => (section.start ?? 0) <= (match.index ?? 0) && (match.index ?? 0) < section.end,
      );
      if (!containingSection || !allowedHeadings.has(containingSection.heading)) {
        fail(`${marker} appears outside its owned routing section`);
      }
    }
  }
}

function upsertMarkerBlock(text, heading, marker, body) {
  const section = sectionRange(text, heading);
  const sectionBody = text.slice(section.contentStart, section.end);
  const start = markerStart(marker);
  const end = markerEnd(marker);
  const starts = countOccurrences(sectionBody, start);
  const ends = countOccurrences(sectionBody, end);
  if (starts !== ends || starts > 1) {
    fail(`${heading} has malformed or duplicate ${marker} markers`);
  }

  const eol = lineEnding(text);
  const replacement = markerBlock(marker, body, eol);
  let nextBody;
  if (starts === 1) {
    const startIndex = sectionBody.indexOf(start);
    const endIndex = sectionBody.indexOf(end, startIndex);
    if (endIndex < startIndex) {
      fail(`${heading} has malformed ${marker} markers`);
    }
    nextBody = `${sectionBody.slice(0, startIndex)}${replacement}${sectionBody.slice(endIndex + end.length)}`;
  } else {
    const existingBody = sectionBody.replace(/^(?:\r?\n)+/u, '');
    nextBody = `${eol}${eol}${replacement}${existingBody ? `${eol}${eol}${existingBody}` : eol}`;
  }

  return `${text.slice(0, section.contentStart)}${nextBody}${text.slice(section.end)}`;
}

function progressiveSpecResolutionBody(specsPath) {
  return [
    'Use dynamic progressive loading for the current task: resolve the selected root and task category before reading broad source context.',
    '',
    '1. Read this `AGENTS.md` routing material and classify the owned surface.',
    '2. Read `agent.app.config.json`, module `specs/`, repository/application `specs/`, and `.sdkwork/` only when the task reaches the contract each item governs.',
    `3. Locate only the relevant task-matrix row or navigation heading in \`${specFile(specsPath, 'README.md')}\`; do not load the full catalog.`,
    '4. Read only the task-specific global spec sections selected by that route, then inspect implementation files.',
  ].join('\n');
}

function progressiveExecutionBody(specsPath) {
  return [
    'Use dynamic progressive loading for the current task; treat indexes and cross-references as discovery, not as a startup bundle.',
    `Keep \`${specFile(specsPath, 'SOUL.md')}\` and the task-selected standards authoritative; expand context only when evidence exposes a new contract boundary.`,
    `Language-specific specs are on-demand: only the touched language loads \`${specFile(specsPath, 'RUST_CODE_SPEC.md')}\`, \`${specFile(specsPath, 'JAVA_CODE_SPEC.md')}\`, \`${specFile(specsPath, 'TYPESCRIPT_CODE_SPEC.md')}\`, or \`${specFile(specsPath, 'FRONTEND_CODE_SPEC.md')}\`.`,
    `Package command standardization loads \`${specFile(specsPath, 'PNPM_SCRIPT_SPEC.md')}\` only when the current task changes package commands or scripts; GitHub packaging work loads \`${specFile(specsPath, 'GITHUB_WORKFLOW_SPEC.md')}\` only when it reaches that workflow boundary.`,
    'Do not infer a recursive workspace scan or a broad validation suite from the presence of a path alone.',
  ].join('\n');
}

function soulSectionBody(specsPath) {
  return `Read \`${specFile(specsPath, 'SOUL.md')}\` before executing tasks. Start with the sections that route the current task; related-spec references are not a startup bundle.`;
}

function applicationIdentitySectionBody() {
  return 'Read `agent.app.config.json` for application identity, registration, SDK/API inventory, release metadata, or app-owned capabilities. Read `etc/` for concrete environment, Base URL, bind, topology, and deployment values; the app manifest is not runtime configuration authority.';
}

function localDictionarySectionBody() {
  return 'Use `AGENTS.md` as the local routing entrypoint; read `.sdkwork/`, `specs/`, `etc/`, and `docs/` only when the current task reaches the workflow, contract, source configuration, or documentation each location governs. Only independently deployable roots own `etc/`.';
}

function requiredSpecsSectionBody(specsPath) {
  return `Select only the current task authorities from \`${specFile(specsPath, 'README.md')}\` and \`${specFile(specsPath, 'AGENTS_SPEC.md')}\`; expand to adjacent specs only when a new contract boundary is reached.`;
}

function codeStyleSectionBody(specsPath) {
  return `Use \`${specFile(specsPath, 'CODE_STYLE_SPEC.md')}\` and \`${specFile(specsPath, 'NAMING_SPEC.md')}\` for authored changes, then load only the language or framework authority touched by the current task.`;
}

function humanReviewSectionBody() {
  return 'Require human review for breaking standards, security exceptions, naming migrations, public contract changes, destructive operations, and changes that affect all repositories or application roots.';
}

function verificationRoutingBody() {
  return [
    'Choose only the narrowest verification selected by the changed surface. This is not a default full-suite command list.',
    'Run workspace-wide checks only when the change crosses that boundary.',
    '`bootstrap-*`, `align-*`, `sync-*`, `--write`, and other mutating repair commands are not verification defaults; use them only for an explicitly scoped repair, migration, bootstrap, or alignment task and inspect the resulting diff.',
  ].join('\n');
}

function authorityPathsBody(specsPath) {
  return [
    'Resolve this standards root once and use it as the global authority for the current task:',
    '',
    `- \`${specFile(specsPath, 'README.md')}\``,
    `- \`${specFile(specsPath, 'SOUL.md')}\``,
    `- \`${specFile(specsPath, 'AGENTS_SPEC.md')}\``,
    '',
    'Read only the relevant README task-matrix row or navigation heading, then load the selected authority sections.',
  ].join('\n');
}

function normalizeRelativeSpecsPathsOutsideCanonicalSections(text, specsPath) {
  if (specsPath === '.') {
    return text;
  }
  const replacePrefix = (value) => value.replace(/(?:\.\.[\\/])+sdkwork-specs[\\/]/gu, `${specsPath}/`);
  const sections = allLevelTwoSections(text);
  if (sections.length === 0) {
    return replacePrefix(text);
  }
  let cursor = 0;
  let normalized = '';
  for (const section of sections) {
    normalized += replacePrefix(text.slice(cursor, section.start));
    const sectionText = text.slice(section.start, section.end);
    normalized += PROTECTED_CANONICAL_SECTIONS.has(section.heading) ? sectionText : replacePrefix(sectionText);
    cursor = section.end;
  }
  return `${normalized}${replacePrefix(text.slice(cursor))}`;
}

function ensureAuthorityPathBlock(text, specsPath) {
  const standardSections = allLevelTwoSections(text).filter((section) => section.heading === SECTION_HEADINGS.standards);
  if (standardSections.length > 1) {
    fail(`update target has duplicate required section "${SECTION_HEADINGS.standards}"`);
  }
  if (standardSections.length === 1) {
    return upsertMarkerBlock(text, SECTION_HEADINGS.standards, PROGRESSIVE_MARKER, authorityPathsBody(specsPath));
  }

  const eol = lineEnding(text);
  const sectionText = [
    `## ${SECTION_HEADINGS.standards}`,
    '',
    markerBlock(PROGRESSIVE_MARKER, authorityPathsBody(specsPath), eol),
    '',
  ].join(eol);
  const sections = allLevelTwoSections(text);
  const soulSection = sections.find((section) => section.heading === 'SDKWORK Soul');
  const insertionPoint = soulSection?.end ?? sections.find((section) => section.heading === 'Application Identity')?.start ?? sections[0]?.start ?? text.length;
  const before = text.slice(0, insertionPoint).replace(/\s*$/u, '');
  const after = text.slice(insertionPoint).replace(/^\s*/u, '');
  return `${before}${before ? `${eol}${eol}` : ''}${sectionText}${after ? `${eol}${eol}${after}` : ''}`;
}

function plainSectionText(heading, body, eol) {
  return [`## ${heading}`, '', body].join(eol);
}

function insertPlainSection(text, heading, body, insertionPoint) {
  const eol = lineEnding(text);
  const before = text.slice(0, insertionPoint).replace(/\s*$/u, '');
  const after = text.slice(insertionPoint).replace(/^\s*/u, '');
  const addition = plainSectionText(heading, body, eol);
  return `${before}${before ? `${eol}${eol}` : ''}${addition}${after ? `${eol}${eol}${after}` : ''}`;
}

function removeDeprecatedCopiedStandardSections(text) {
  const retiredHeadings = new Set([
    'App SDK Consumer Imports',
    'HTTP API Response Envelope',
    'List And Search Pagination',
  ]);
  const sections = allLevelTwoSections(text);
  let updated = text;
  for (const section of [...sections].reverse()) {
    if (!retiredHeadings.has(section.heading)) {
      continue;
    }
    updated = `${updated.slice(0, section.start).replace(/\s*$/u, '')}\n\n${updated.slice(section.end).replace(/^\s*/u, '')}`;
  }
  return updated;
}

function ensureTaskSpecificStandardsSection(text, specsPath) {
  const heading = 'Task-Specific Standards';
  if (allLevelTwoSections(text).some((section) => section.heading === heading)) {
    return text;
  }
  const humanReview = allLevelTwoSections(text).find(
    (section) => section.heading === SECTION_HEADINGS.humanReview,
  );
  const body = `API work loads \`${specFile(specsPath, 'API_SPEC.md')}\` and its validators. List/search work loads \`${specFile(specsPath, 'PAGINATION_SPEC.md')}\` and \`check-pagination.mjs\`. Source configuration work loads \`${specFile(specsPath, 'SOURCE_CONFIG_SPEC.md')}\` and \`check-source-config-standard.mjs\`. Link these authorities instead of copying their normative bodies into \`AGENTS.md\`.`;
  return insertPlainSection(text, heading, body, humanReview?.start ?? text.length);
}

function supportingInsertionPoint(text, heading) {
  const sections = allLevelTwoSections(text);
  const find = (candidate) => sections.find((section) => section.heading === candidate);
  const first = sections[0];
  const standards = find(SECTION_HEADINGS.standards);
  const identity = find(SECTION_HEADINGS.identity);
  const dictionary = find(SECTION_HEADINGS.localDictionary);
  const specResolution = find(SECTION_HEADINGS.specResolution);
  const requiredSpecs = find(SECTION_HEADINGS.requiredSpecs);
  const codeStyle = find(SECTION_HEADINGS.codeStyle);
  const verification = find(SECTION_HEADINGS.verification);

  switch (heading) {
    case SECTION_HEADINGS.soul:
      return standards?.start ?? identity?.start ?? dictionary?.start ?? first?.start ?? 0;
    case SECTION_HEADINGS.identity:
      return dictionary?.start ?? specResolution?.start ?? standards?.end ?? first?.start ?? text.length;
    case SECTION_HEADINGS.localDictionary:
      return specResolution?.start ?? identity?.end ?? standards?.end ?? first?.start ?? text.length;
    case SECTION_HEADINGS.requiredSpecs:
      return codeStyle?.start ?? verification?.start ?? specResolution?.end ?? text.length;
    case SECTION_HEADINGS.codeStyle:
      return verification?.start ?? requiredSpecs?.end ?? specResolution?.end ?? text.length;
    case SECTION_HEADINGS.humanReview:
      return text.length;
    default:
      return text.length;
  }
}

function ensureSupportingRequiredSections(text, specsPath, headings) {
  const bodies = new Map([
    [SECTION_HEADINGS.soul, soulSectionBody(specsPath)],
    [SECTION_HEADINGS.identity, applicationIdentitySectionBody()],
    [SECTION_HEADINGS.localDictionary, localDictionarySectionBody()],
    [SECTION_HEADINGS.requiredSpecs, requiredSpecsSectionBody(specsPath)],
    [SECTION_HEADINGS.codeStyle, codeStyleSectionBody(specsPath)],
    [SECTION_HEADINGS.humanReview, humanReviewSectionBody()],
  ]);
  let updated = text;
  for (const heading of headings) {
    const body = bodies.get(heading);
    const matches = allLevelTwoSections(updated).filter((section) => section.heading === heading);
    if (matches.length > 1) {
      fail(`update target has duplicate required section "${heading}"`);
    }
    if (matches.length === 0) {
      updated = insertPlainSection(updated, heading, body, supportingInsertionPoint(updated, heading));
    }
  }
  return updated;
}

function routingSectionText(heading, marker, body, eol) {
  return [`## ${heading}`, '', markerBlock(marker, body, eol)].join(eol);
}

function ensureRoutingSections(text, specsPath) {
  const definitions = [
    [SECTION_HEADINGS.specResolution, PROGRESSIVE_MARKER, progressiveSpecResolutionBody(specsPath)],
    [SECTION_HEADINGS.verification, VERIFICATION_MARKER, verificationRoutingBody()],
    [SECTION_HEADINGS.execution, PROGRESSIVE_MARKER, progressiveExecutionBody(specsPath)],
  ];
  const sections = allLevelTwoSections(text);
  const missing = [];
  for (const definition of definitions) {
    const matches = sections.filter((section) => section.heading === definition[0]);
    if (matches.length > 1) {
      fail(`update target has duplicate required section "${definition[0]}"`);
    }
    if (matches.length === 0) {
      missing.push(definition);
    }
  }
  if (missing.length === 0) {
    return text;
  }

  const eol = lineEnding(text);
  const standards = sections.find((section) => section.heading === SECTION_HEADINGS.standards);
  const localDictionary = sections.find((section) => section.heading === 'Local Dictionary Structure');
  const humanReview = sections.find((section) => section.heading === 'Human Review Rules');
  const preferredAnchor = localDictionary ?? standards;
  const insertionPoint = humanReview && (!preferredAnchor || preferredAnchor.start > humanReview.start)
    ? humanReview.start
    : preferredAnchor?.end ?? humanReview?.start ?? sections[0]?.start ?? text.length;
  const addition = missing
    .map(([heading, marker, body]) => routingSectionText(heading, marker, body, eol))
    .join(`${eol}${eol}`);
  const before = text.slice(0, insertionPoint).replace(/\s*$/u, '');
  const after = text.slice(insertionPoint).replace(/^\s*/u, '');
  return `${before}${before ? `${eol}${eol}` : ''}${addition}${after ? `${eol}${eol}${after}` : ''}`;
}

function updateAgentsText(text, specsPath) {
  const withoutCopiedStandards = removeDeprecatedCopiedStandardSections(text);
  const normalized = normalizeRelativeSpecsPathsOutsideCanonicalSections(withoutCopiedStandards, specsPath);
  validateRequiredSectionUniqueness(normalized);
  validateMarkerLocations(normalized);
  let updated = ensureAuthorityPathBlock(normalized, specsPath);
  updated = ensureSupportingRequiredSections(updated, specsPath, [
    SECTION_HEADINGS.soul,
    SECTION_HEADINGS.identity,
    SECTION_HEADINGS.localDictionary,
  ]);
  updated = ensureRoutingSections(updated, specsPath);
  updated = ensureSupportingRequiredSections(updated, specsPath, [
    SECTION_HEADINGS.requiredSpecs,
    SECTION_HEADINGS.codeStyle,
    SECTION_HEADINGS.humanReview,
  ]);
  updated = upsertMarkerBlock(updated, SECTION_HEADINGS.specResolution, PROGRESSIVE_MARKER, progressiveSpecResolutionBody(specsPath));
  updated = upsertMarkerBlock(updated, SECTION_HEADINGS.verification, VERIFICATION_MARKER, verificationRoutingBody());
  updated = upsertMarkerBlock(updated, SECTION_HEADINGS.execution, PROGRESSIVE_MARKER, progressiveExecutionBody(specsPath));
  updated = ensureTaskSpecificStandardsSection(updated, specsPath);
  return updated;
}

function canonicalSection(body, specsPath) {
  return body.trim().replaceAll('<sdkwork-specs>', specsPath);
}

function createAgentsText({ rootKind, specsPath }) {
  const eol = '\n';
  return [
    '# Repository Guidelines',
    '',
    '## SDKWORK Soul',
    '',
    `Read \`${specFile(specsPath, 'SOUL.md')}\` before executing ${rootKind} tasks. Start with the sections that route the current task; do not treat related-spec references as a startup bundle.`,
    '',
    '## SDKWORK Standards',
    '',
    `The canonical global standards index is \`${specFile(specsPath, 'README.md')}\`. Read the relevant task-matrix row or navigation heading first, then the selected authority. Do not copy global \`*_SPEC.md\` bodies locally.`,
    '',
    '## Spec System Hierarchy',
    '',
    `Global standards live under \`${specsPath === '.' ? './' : `${specsPath}/`}\`. Repository/application contracts live in \`specs/\`; authored modules own their nearest \`specs/component.spec.json\`. Local contracts may narrow but must not contradict global standards.`,
    '',
    '## Application Identity',
    '',
    'Read `agent.app.config.json` for application identity, registration, SDK/API inventory, release metadata, or app-owned capabilities. Read `etc/` for concrete environment, Base URL, bind, topology, and deployment values.',
    '',
    '## Local Dictionary Structure',
    '',
    '- `AGENTS.md`: local agent execution entrypoint.',
    '- `.sdkwork/`: repository/application skills, plugins, and workspace metadata; read only the matching workflow.',
    '- `specs/`: repository/application contracts or module-local component contracts.',
    '- `etc/`: source configuration for independently deployable roots; it is not required for libraries or SDK packages.',
    '- `docs/`: Canon documentation and discovery material.',
    '',
    '## Spec Resolution Order',
    '',
    markerBlock(PROGRESSIVE_MARKER, progressiveSpecResolutionBody(specsPath), eol),
    '',
    '## Required Specs By Task Type',
    '',
    `Agent or entrypoint changes load \`${specFile(specsPath, 'SOUL.md')}\`, \`${specFile(specsPath, 'AGENTS_SPEC.md')}\`, \`${specFile(specsPath, 'SDKWORK_WORKSPACE_SPEC.md')}\`, \`${specFile(specsPath, 'DOCUMENTATION_SPEC.md')}\`, and \`${specFile(specsPath, 'TEST_SPEC.md')}\`.`,
    '',
    `Code changes load \`${specFile(specsPath, 'CODE_STYLE_SPEC.md')}\`, \`${specFile(specsPath, 'NAMING_SPEC.md')}\`, and only the touched language/framework authority. Package-command work also loads \`${specFile(specsPath, 'PNPM_SCRIPT_SPEC.md')}\`; packaging workflow work also loads \`${specFile(specsPath, 'GITHUB_WORKFLOW_SPEC.md')}\`.`,
    '',
    '## Code Style Rules',
    '',
    `Use \`${specFile(specsPath, 'CODE_STYLE_SPEC.md')}\` and \`${specFile(specsPath, 'NAMING_SPEC.md')}\`. Load Rust, Java, TypeScript, or frontend standards only when the task touches that language or framework.`,
    '',
    '## Build, Test, and Verification',
    '',
    markerBlock(VERIFICATION_MARKER, verificationRoutingBody(), eol),
    '',
    `Run the applicable validation from \`${specFile(specsPath, 'TEST_SPEC.md')}\` and record the command and result.`,
    '',
    '## Agent Execution Rules',
    '',
    markerBlock(PROGRESSIVE_MARKER, progressiveExecutionBody(specsPath), eol),
    '',
    '## Task-Specific Standards',
    '',
    `API work loads \`${specFile(specsPath, 'API_SPEC.md')}\` and its validators. List/search work loads \`${specFile(specsPath, 'PAGINATION_SPEC.md')}\` and \`check-pagination.mjs\`. Source configuration work loads \`${specFile(specsPath, 'SOURCE_CONFIG_SPEC.md')}\` and \`check-source-config-standard.mjs\`. Link these authorities instead of copying their normative bodies into \`AGENTS.md\`.`,
    '',
    '## Human Review Rules',
    '',
    'Human review is required for breaking standards changes, security exceptions, naming migrations, public contract changes, destructive operations, and changes that affect all repositories or application roots.',
    '',
  ].join(eol);
}

function loadManifest(manifestPath) {
  assertRegularFile(manifestPath, 'manifest');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`manifest must contain valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('manifest must be a JSON object');
  }

  const hasAlignment = Object.prototype.hasOwnProperty.call(parsed, 'alignment');
  const manifest = hasAlignment ? parsed.alignment : parsed;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('manifest.alignment must be a JSON object when provided');
  }
  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0) {
    fail(hasAlignment ? 'manifest.alignment.targets must be a non-empty array' : 'manifest.targets must be a non-empty array');
  }
  return {
    ...manifest,
    workspaceRoot: manifest.workspaceRoot ?? parsed.workspaceRoot,
  };
}

function resolveWorkspace(manifestPath, manifest, workspaceOption) {
  const supplied = workspaceOption ?? manifest.workspaceRoot ?? '.';
  if (typeof supplied !== 'string' || supplied.trim() === '') {
    fail('workspace path must be a non-empty string');
  }
  const workspace = path.resolve(
    workspaceOption ? process.cwd() : path.dirname(manifestPath),
    supplied,
  );
  assertDirectory(workspace, 'workspace root');
  return workspace;
}

function validateRelativeSpecsPath(workspace, root, target) {
  const supplied = target.relativeSpecsPath;
  if (typeof supplied !== 'string' || supplied.trim() === '' || path.isAbsolute(supplied)) {
    fail(`${target.rootPath} relativeSpecsPath must be a non-empty relative path`);
  }
  const specsRoot = path.resolve(root, supplied);
  if (!isWithin(workspace, specsRoot)) {
    fail(`${target.rootPath} relativeSpecsPath resolves outside the workspace`);
  }
  if (path.basename(specsRoot).toLowerCase() !== 'sdkwork-specs') {
    fail(`${target.rootPath} relativeSpecsPath must resolve to a sdkwork-specs root`);
  }
  assertNoSymlinksBetween(workspace, specsRoot, `${target.rootPath} relativeSpecsPath`);
  assertDirectory(specsRoot, `${target.rootPath} sdkwork-specs root`);
  for (const authority of ['README.md', 'SOUL.md', 'AGENTS_SPEC.md']) {
    const authorityPath = path.join(specsRoot, authority);
    assertNoSymlinksBetween(workspace, authorityPath, `${target.rootPath} ${authority}`);
    assertRegularFile(authorityPath, `${target.rootPath} ${authority}`);
  }
  return toPosix(path.relative(root, specsRoot)) || '.';
}

function validateTarget(workspace, target, targetIndex, options) {
  const label = `targets[${targetIndex}]`;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    fail(`${label} must be an object`);
  }
  if (!TARGET_ROOT_KINDS.has(target.rootKind)) {
    fail(`${label}.rootKind must be one of ${[...TARGET_ROOT_KINDS].join(', ')}`);
  }
  if (!['update', 'create'].includes(target.action)) {
    fail(`${label}.action must be update or create`);
  }
  for (const field of ['repairHttpEnvelope', 'ensurePagination']) {
    if (target[field] !== undefined && typeof target[field] !== 'boolean') {
      fail(`${label}.${field} must be a boolean when provided`);
    }
  }

  const root = resolveWithin(workspace, target.rootPath, `${label}.rootPath`, { allowDot: true });
  assertNoExcludedSegments(workspace, root, `${label}.rootPath`);
  assertNoSymlinksBetween(workspace, root, `${label}.rootPath`);
  assertDirectory(root, `${label}.rootPath`);

  const normalizedAgentPath = assertRelativePath(target.agentPath, `${label}.agentPath`);
  if (normalizedAgentPath !== 'AGENTS.md') {
    fail(`${label}.agentPath must be exactly AGENTS.md relative to rootPath`);
  }
  const agentPath = resolveWithin(root, normalizedAgentPath, `${label}.agentPath`);
  assertNoExcludedSegments(workspace, agentPath, `${label}.agentPath`);
  assertNoSymlinksBetween(workspace, agentPath, `${label}.agentPath`);
  const repositoryRoot = gitRepositoryRoot(root, workspace, `${label}.rootPath`);
  const specsPath = validateRelativeSpecsPath(workspace, root, target);
  const exists = fs.existsSync(agentPath);

  if (target.action === 'update') {
    if (typeof target.beforeSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(target.beforeSha256)) {
      fail(`${label}.beforeSha256 must be a lowercase SHA-256 string for update`);
    }
    assertRegularFile(agentPath, `${label}.agentPath`);
    const before = fs.readFileSync(agentPath);
    const actualHash = sha256(before);
    if (actualHash !== target.beforeSha256) {
      fail(`${label}.agentPath hash changed since manifest creation`);
    }
    assertGitClean(repositoryRoot, agentPath, `${label}.agentPath`);
    let source = before.toString('utf8');
    if (options.repairHttpEnvelope && target.repairHttpEnvelope === true) {
      source = upsertAgentsEnvelopeSection(source);
    }
    if (options.ensurePagination && target.ensurePagination === true) {
      source = upsertAgentsPaginationSection(source);
    }
    const after = updateAgentsText(source, specsPath);
    return {
      action: 'update',
      agentPath,
      beforeHash: actualHash,
      changed: after !== before.toString('utf8'),
      after,
      label,
      repositoryRoot,
      root,
      specsPath,
      workspace,
    };
  }

  if (target.beforeSha256 !== null) {
    fail(`${label}.beforeSha256 must be null for create`);
  }
  if (exists) {
    fail(`${label}.agentPath already exists; create must not overwrite it`);
  }
  assertGitClean(repositoryRoot, agentPath, `${label}.agentPath`);
  return {
    action: 'create',
    agentPath,
    changed: true,
    after: createAgentsText({ rootKind: target.rootKind, specsPath }),
    label,
    repositoryRoot,
    root,
    specsPath,
    workspace,
  };
}

function revalidateBeforeWrite(prepared) {
  assertNoSymlinksBetween(prepared.workspace, prepared.root, `${prepared.label}.rootPath`);
  assertGitClean(prepared.repositoryRoot, prepared.agentPath, `${prepared.label}.agentPath`);
  if (prepared.action === 'create') {
    if (fs.existsSync(prepared.agentPath)) {
      fail(`${prepared.label}.agentPath appeared after validation`);
    }
    return;
  }
  assertRegularFile(prepared.agentPath, `${prepared.label}.agentPath`);
  const actualHash = sha256(fs.readFileSync(prepared.agentPath));
  if (actualHash !== prepared.beforeHash) {
    fail(`${prepared.label}.agentPath hash changed before write`);
  }
}

export function alignManifest({
  manifestPath,
  workspace: workspaceOption,
  write = false,
  repairHttpEnvelope = false,
  ensurePagination = false,
}) {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifest = loadManifest(resolvedManifestPath);
  const workspace = resolveWorkspace(resolvedManifestPath, manifest, workspaceOption);
  const prepared = [];
  const seenAgents = new Set();

  for (const [index, target] of manifest.targets.entries()) {
    const preparedTarget = validateTarget(workspace, target, index, { repairHttpEnvelope, ensurePagination });
    if (seenAgents.has(preparedTarget.agentPath)) {
      fail(`manifest lists the same agent target more than once: ${preparedTarget.agentPath}`);
    }
    seenAgents.add(preparedTarget.agentPath);
    prepared.push(preparedTarget);
  }

  if (write) {
    for (const preparedTarget of prepared.filter((target) => target.changed)) {
      revalidateBeforeWrite(preparedTarget);
    }
    for (const preparedTarget of prepared.filter((target) => target.changed)) {
      if (preparedTarget.action === 'create') {
        fs.writeFileSync(preparedTarget.agentPath, preparedTarget.after, { encoding: 'utf8', flag: 'wx' });
      } else {
        fs.writeFileSync(preparedTarget.agentPath, preparedTarget.after, 'utf8');
      }
    }
  }

  return {
    changed: prepared.filter((target) => target.changed).length,
    prepared,
    workspace,
    wrote: write,
  };
}

function runCli() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        'dry-run': { type: 'boolean', default: false },
        'ensure-pagination': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        manifest: { type: 'string' },
        'repair-http-envelope': { type: 'boolean', default: false },
        workspace: { type: 'string' },
        write: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
    if (values.help) {
      console.log(usage());
      return;
    }
    if (!values.manifest) {
      fail('--manifest is required');
    }
    if (values.write && values['dry-run']) {
      fail('--write and --dry-run cannot be combined');
    }
    const result = alignManifest({
      manifestPath: values.manifest,
      workspace: values.workspace,
      write: values.write,
      repairHttpEnvelope: values['repair-http-envelope'],
      ensurePagination: values['ensure-pagination'],
    });
    for (const target of result.prepared) {
      const relativeAgentPath = toPosix(path.relative(result.workspace, target.agentPath));
      const verb = !target.changed
        ? 'unchanged'
        : values.write
          ? target.action === 'create'
            ? 'created'
            : 'updated'
          : target.action === 'create'
            ? 'would create'
            : 'would update';
      console.log(`${verb} ${relativeAgentPath}`);
    }
    console.log(`${values.write ? 'aligned' : 'would align'} ${result.changed} AGENTS.md target(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`agents progressive-loading alignment failed: ${message}`);
    console.error(usage());
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(TOOL_PATH)) {
  runCli();
}
