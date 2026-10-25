import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  alignRepositoryDocs,
  listWorkspaceRepositories,
  resolveRepositoryIdentity,
} from './align-repository-docs-lib.mjs';
import { bootstrapRepositoryDocs } from './bootstrap-repository-docs-lib.mjs';
import { validateRepositoryDocsStandard } from './check-repository-docs-standard.mjs';
import { CANON_PATHS, LEGACY_CANON_PATHS, PRD_SHARD_PATTERN, TECH_SHARD_PATTERN } from './repository-docs-paths.mjs';

const LEGACY_LINK_REPLACEMENTS = [
  ['docs/product/PRD.md', 'docs/product/prd/PRD.md'],
  ['docs/architecture/TECH_ARCHITECTURE.md', 'docs/architecture/tech/TECH_ARCHITECTURE.md'],
  ['product/PRD.md', 'product/prd/PRD.md'],
  ['architecture/TECH_ARCHITECTURE.md', 'architecture/tech/TECH_ARCHITECTURE.md'],
  ['(product/PRD.md)', '(product/prd/PRD.md)'],
  ['(architecture/TECH_ARCHITECTURE.md)', '(architecture/tech/TECH_ARCHITECTURE.md)'],
];

const LEGACY_ARCH_DIRS = ['docs/架构', 'docs/step'];
const LEGACY_NUMBERED_DOC = /^(\d{2})[-_.](.+)\.md$/u;

const PRODUCT_HINTS = [
  /^01[-_.]?/u,
  /PRD/iu,
  /executive-summary/iu,
  /ui-ux-functional/iu,
  /product-design/iu,
  /产品设计/iu,
  /产品与需求/iu,
  /产品与技术架构全景评估/iu,
];

const ARCHITECTURE_HINTS = [
  /^0[2-9][-_.]/u,
  /^1[0-9][-_.]/u,
  /architecture/iu,
  /arch-/iu,
  /架构/iu,
  /模块规划/iu,
  /技术选型/iu,
  /tech-stack/iu,
  /framework-foundation/iu,
  /design-index/iu,
];

const SLUG_WORD_MAP = [
  [/产品/iu, 'product'],
  [/架构/iu, 'architecture'],
  [/模块/iu, 'modules'],
  [/技术选型/iu, 'tech-stack'],
  [/功能/iu, 'features'],
  [/安全/iu, 'security'],
  [/性能/iu, 'performance'],
  [/实施/iu, 'implementation'],
  [/规划/iu, 'planning'],
  [/边界/iu, 'boundaries'],
  [/设计/iu, 'design'],
  [/需求/iu, 'requirements'],
  [/总体/iu, 'overview'],
  [/标准/iu, 'standard'],
  [/业务流程/iu, 'business-flow'],
  [/部署/iu, 'deployment'],
  [/发布/iu, 'release'],
  [/测试/iu, 'testing'],
  [/安装/iu, 'installation'],
  [/离线/iu, 'offline'],
  [/搜索/iu, 'search'],
  [/同步/iu, 'sync'],
  [/评估/iu, 'assessment'],
  [/演进/iu, 'evolution'],
  [/集成/iu, 'integration'],
  [/治理/iu, 'governance'],
  [/审计/iu, 'audit'],
  [/现状/iu, 'baseline'],
  [/路线图/iu, 'roadmap'],
  [/范围/iu, 'scope'],
  [/与/iu, ''],
  [/及/iu, ''],
];

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function posixRelative(root, absolutePath) {
  return path.relative(root, absolutePath).replace(/\\/g, '/');
}

function walkMarkdownFiles(root, relativeDir, results = []) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) {
    return results;
  }
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const rel = path.posix.join(relativeDir.replace(/\\/g, '/'), entry.name);
    if (entry.isDirectory()) {
      if (rel.startsWith('docs/archive/migrated-legacy')) {
        continue;
      }
      if (rel === 'docs/product/prd' || rel === 'docs/architecture/tech') {
        continue;
      }
      walkMarkdownFiles(root, rel, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(rel);
    }
  }
  return results;
}

function applyLinkReplacements(text) {
  let updated = text;
  for (const [from, to] of LEGACY_LINK_REPLACEMENTS) {
    updated = updated.replaceAll(from, to);
  }
  return updated;
}

function dedupeCanonSections(text) {
  const marker = '## Canon Documents';
  const first = text.indexOf(marker);
  if (first === -1) {
    return text;
  }
  const second = text.indexOf(marker, first + marker.length);
  if (second === -1) {
    return text;
  }
  return `${text.slice(0, second).replace(/\s*$/u, '')}\n${text.slice(second).replace(/^[\s\S]*?(?=\n##\s+|\n$|$)/u, '')}`.replace(/\n{3,}/gu, '\n\n');
}

export function fixLegacyCanonLinks(root, options = {}) {
  const changed = [];
  const scanRoots = options.scanRoots || ['docs', 'AGENTS.md', 'README.md'];
  const files = new Set();
  for (const scanRoot of scanRoots) {
    if (scanRoot.endsWith('.md')) {
      const filePath = path.join(root, scanRoot);
      if (fs.existsSync(filePath)) {
        files.add(scanRoot);
      }
      continue;
    }
    for (const rel of walkMarkdownFiles(root, scanRoot)) {
      files.add(rel);
    }
  }

  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    const original = readText(absolutePath);
    let updated = applyLinkReplacements(original);
    if (relativePath === CANON_PATHS.index) {
      updated = dedupeCanonSections(updated);
    }
    if (updated !== original) {
      writeText(absolutePath, updated);
      changed.push(relativePath);
    }
  }
  return changed;
}

function slugifySegment(segment) {
  let working = segment
    .replace(/^\d{1,3}[A-Z]?[-_.]/u, '')
    .replace(/\.md$/u, '');

  for (const [pattern, replacement] of SLUG_WORD_MAP) {
    working = working.replace(pattern, replacement);
  }

  return working
    .replace(/[^\w\s-]/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
}

export function slugFromLegacyFilename(basename) {
  const numbered = LEGACY_NUMBERED_DOC.exec(basename);
  if (numbered) {
    const [, number, rest] = numbered;
    const body = slugifySegment(rest);
    if (body) {
      return `${number}-${body}`.slice(0, 80);
    }
    return `legacy-${number}`;
  }

  const body = slugifySegment(basename.replace(/\.md$/u, ''));
  if (body) {
    return body.slice(0, 80);
  }

  const hash = crypto.createHash('sha1').update(basename).digest('hex').slice(0, 8);
  return `legacy-${hash}`;
}

export function classifyLegacyDoc(basename, content = '') {
  const probe = `${basename}\n${content.slice(0, 400)}`;
  if (PRODUCT_HINTS.some((pattern) => pattern.test(probe))) {
    return 'product';
  }
  if (ARCHITECTURE_HINTS.some((pattern) => pattern.test(probe))) {
    return 'architecture';
  }
  if (/^00[-_.]/u.test(basename) && /index|索引|audit|审计|基线/iu.test(probe)) {
    return 'architecture';
  }
  return 'architecture';
}

function shardBasename(kind, slug) {
  const prefix = kind === 'product' ? 'PRD' : 'TECH';
  const safe = slug.replace(/[^a-z0-9-]/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
  return `${prefix}-${safe || 'legacy'}.md`;
}

function ensureUniqueShardName(root, targetDir, basename) {
  let candidate = basename;
  let index = 2;
  while (fs.existsSync(path.join(root, targetDir, candidate))) {
    const ext = path.extname(basename);
    const stem = path.basename(basename, ext);
    candidate = `${stem}-${index}${ext}`;
    index += 1;
  }
  return candidate;
}

function migrationProvenanceBlock(sourceRelPath, identity) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `> Migrated from \`${sourceRelPath}\` on ${today}.`,
    `> Owner: ${identity.owner}`,
    '',
  ].join('\n');
}

function stripLeadingH1(text) {
  return text.replace(/^#\s+.+\n+/u, '');
}

export function ingestLegacyDocAsShard(root, identity, sourceRelPath, kind, options = {}) {
  const sourcePath = path.join(root, sourceRelPath);
  if (!fs.existsSync(sourcePath)) {
    return null;
  }
  const content = readText(sourcePath);
  if (content.trim().length < 40 && !options.force) {
    return null;
  }

  const basename = path.basename(sourceRelPath);
  const slug = slugFromLegacyFilename(basename);
  const targetDir = kind === 'product' ? 'docs/product/prd' : 'docs/architecture/tech';
  const shardName = ensureUniqueShardName(root, targetDir, shardBasename(kind, slug));
  const targetRel = path.posix.join(targetDir, shardName);

  if (fs.existsSync(path.join(root, targetRel)) && !options.force) {
    return targetRel;
  }

  const body = [
    migrationProvenanceBlock(sourceRelPath, identity),
    stripLeadingH1(content).trimStart(),
    '',
  ].join('\n');
  writeText(path.join(root, targetRel), body);
  return targetRel;
}

function listShards(root, dirRelativePath, pattern) {
  const absoluteDir = path.join(root, dirRelativePath);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }
  return fs.readdirSync(absoluteDir)
    .filter((name) => pattern.test(name))
    .sort();
}

function upsertDocumentMap(entryText, sectionTitle, shardNames) {
  const lines = shardNames.map((name) => `- [${name}](${name})`);
  const block = [
    `## ${sectionTitle}`,
    '',
    ...lines,
    '',
  ].join('\n');

  if (new RegExp(`##\\s+${sectionTitle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u').test(entryText)) {
    return entryText.replace(
      new RegExp(`##\\s+${sectionTitle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[\\s\\S]*?(?=\\n##\\s+|\\n$)`, 'u'),
      `${block.trim()}\n`,
    );
  }

  const anchor = entryText.search(/\n##\s+1\./u);
  if (anchor !== -1) {
    return `${entryText.slice(0, anchor)}\n${block}${entryText.slice(anchor)}`;
  }
  return `${entryText.replace(/\s*$/u, '')}\n\n${block}`;
}

function isEmptyApplicationCanon(text) {
  if (!/Status:\s*draft/iu.test(text)) {
    return false;
  }
  const body = text.replace(/^[\s\S]*?##\s+Document Map[\s\S]*?(?=\n##\s+|\n$|$)/u, '');
  const sections = body.match(/^##\s+.+/gmu) || [];
  const substantive = sections.filter((heading) => {
    const start = body.indexOf(heading);
    const next = body.indexOf('\n## ', start + 1);
    const sectionBody = body.slice(start + heading.length, next === -1 ? body.length : next).trim();
    return sectionBody.length > 20;
  });
  return substantive.length <= 1;
}

export function updateCanonDocumentMaps(root, identity) {
  const changed = [];
  const prdPath = path.join(root, CANON_PATHS.prd);
  const techPath = path.join(root, CANON_PATHS.techArchitecture);
  const prdShards = listShards(root, 'docs/product/prd', PRD_SHARD_PATTERN);
  const techShards = listShards(root, 'docs/architecture/tech', TECH_SHARD_PATTERN);

  if (fs.existsSync(prdPath) && prdShards.length > 0) {
    let prdText = readText(prdPath);
    prdText = upsertDocumentMap(prdText, 'Document Map', prdShards);
    if (isEmptyApplicationCanon(prdText) && identity.profile === 'application') {
      prdText = prdText.replace(/Status:\s*draft/iu, 'Status: active');
      prdText = prdText.replace(
        /##\s+1\.\s+Background And Problem[\s\S]*?(?=\n##\s+Document Map|\n##\s+9\.|\n$)/u,
        '## 1. Background And Problem\n\nProduct detail lives in the linked PRD shards below.\n\n',
      );
    } else if (prdShards.length > 0) {
      prdText = prdText.replace(/Status:\s*draft/iu, 'Status: active');
    }
    writeText(prdPath, prdText);
    changed.push(CANON_PATHS.prd);
  }

  if (fs.existsSync(techPath) && techShards.length > 0) {
    let techText = readText(techPath);
    techText = upsertDocumentMap(techText, 'Document Map', techShards);
    if (isEmptyApplicationCanon(techText)) {
      techText = techText.replace(/Status:\s*draft/iu, 'Status: active');
      techText = techText.replace(
        /##\s+1\.\s+Architecture Overview[\s\S]*?(?=\n##\s+Document Map|\n##\s+2\.|\n$)/u,
        '## 1. Architecture Overview\n\nArchitecture detail lives in the linked TECH shards below.\n\n',
      );
    } else {
      techText = techText.replace(/Status:\s*draft/iu, 'Status: active');
    }
    writeText(techPath, techText);
    changed.push(CANON_PATHS.techArchitecture);
  }

  return changed;
}

function discoverLegacyMarkdownSources(root) {
  const sources = [];
  const skipDirs = new Set([
    'docs/product',
    'docs/architecture',
    'docs/archive',
    'docs/engineering',
    'docs/guides',
    'docs/runbooks',
    'docs/changelogs',
    'docs/migrations',
    'docs/releases',
    'docs/domains',
  ]);

  for (const rel of walkMarkdownFiles(root, 'docs')) {
    const top = rel.split('/')[1];
    if (skipDirs.has(`docs/${top}`)) {
      continue;
    }
    if (rel === CANON_PATHS.index) {
      continue;
    }
    if (rel.startsWith('docs/product/') || rel.startsWith('docs/architecture/')) {
      continue;
    }
    if (Object.values(LEGACY_CANON_PATHS).includes(rel)) {
      continue;
    }
    if (rel.endsWith('/README.md')) {
      continue;
    }
    sources.push(rel);
  }
  return sources;
}

function migrateLegacySources(root, identity, options = {}) {
  const ingested = [];
  const sources = discoverLegacyMarkdownSources(root);
  for (const sourceRel of sources) {
    const basename = path.basename(sourceRel);
    const content = readText(path.join(root, sourceRel));
    const kind = classifyLegacyDoc(basename, content);
    const target = ingestLegacyDocAsShard(root, identity, sourceRel, kind, options);
    if (target) {
      ingested.push({ source: sourceRel, target, kind });
    }
  }
  return ingested;
}

function writeArchiveIndex(root, archiveRootRel, movedEntries) {
  if (movedEntries.length === 0) {
    return;
  }
  const indexPath = path.join(root, archiveRootRel, 'README.md');
  const lines = movedEntries
    .sort((a, b) => a.localeCompare(b))
    .map((entry) => `- \`${entry}\``);
  writeText(indexPath, [
    '# Migrated Legacy Documentation',
    '',
    'Legacy documentation trees were ingested into Canon shards and archived here for stable history.',
    '',
    '## Archived Paths',
    '',
    ...lines,
    '',
    'Do not add new Canon content under this directory.',
    '',
  ].join('\n'));
}

function moveDirectory(root, sourceRel, targetRel) {
  const sourcePath = path.join(root, sourceRel);
  const targetPath = path.join(root, targetRel);
  if (!fs.existsSync(sourcePath)) {
    return false;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
  fs.renameSync(sourcePath, targetPath);
  return true;
}

export function archiveLegacyTrees(root) {
  const archiveBase = 'docs/archive/migrated-legacy';
  const moved = [];
  for (const legacyDir of LEGACY_ARCH_DIRS) {
    const archiveTarget = path.posix.join(archiveBase, path.basename(legacyDir));
    if (moveDirectory(root, legacyDir, archiveTarget)) {
      moved.push(legacyDir);
    }
  }

  const docsRoot = path.join(root, 'docs');
  if (fs.existsSync(docsRoot)) {
    for (const entry of fs.readdirSync(docsRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }
      if (!LEGACY_NUMBERED_DOC.test(entry.name)) {
        continue;
      }
      const sourceRel = path.posix.join('docs', entry.name);
      const targetRel = path.posix.join(archiveBase, 'numbered-docs', entry.name);
      const sourcePath = path.join(root, sourceRel);
      const targetPath = path.join(root, targetRel);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.renameSync(sourcePath, targetPath);
      moved.push(sourceRel);
    }
  }

  writeArchiveIndex(root, archiveBase, moved);
  return moved;
}

function findApplicationRoots(repoRoot) {
  const appsDir = path.join(repoRoot, 'apps');
  if (!fs.existsSync(appsDir)) {
    return [];
  }
  return fs.readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsDir, entry.name))
    .filter((appRoot) => fs.existsSync(path.join(appRoot, 'agent.app.config.json')));
}

function resolveApplicationIdentity(appRoot) {
  const manifest = JSON.parse(readText(path.join(appRoot, 'agent.app.config.json')));
  const repoName = path.basename(path.dirname(path.dirname(appRoot)));
  return {
    profile: 'application',
    repoName,
    applicationCode: manifest.app?.key || path.basename(appRoot),
    productName: manifest.app?.displayName || path.basename(appRoot),
    owner: 'SDKWork maintainers',
  };
}

export function migrateApplicationDocumentation(repoRoot, options = {}) {
  const changed = [];
  for (const appRoot of findApplicationRoots(repoRoot)) {
    const identity = resolveApplicationIdentity(appRoot);
    bootstrapRepositoryDocs(appRoot, {
      applicationCode: identity.applicationCode,
      productName: identity.productName,
      owner: identity.owner,
      force: false,
    });
    changed.push(...fixLegacyCanonLinks(appRoot));
    const ingested = migrateLegacySources(appRoot, identity, options);
    if (ingested.length > 0) {
      changed.push(...ingested.map((item) => item.target));
      updateCanonDocumentMaps(appRoot, identity);
      changed.push(...archiveLegacyTrees(appRoot));
    }
  }
  return changed;
}

export function completeRepositoryDocsMigration(root, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const changed = [];

  alignRepositoryDocs(root, { forceCanon: false });
  if (dryRun) {
    return {
      root,
      identity: resolveRepositoryIdentity(root),
      changed: ['dry-run'],
      validation: validateRepositoryDocsStandard(root, { profile: 'auto' }),
      ingested: discoverLegacyMarkdownSources(root),
    };
  }

  changed.push(...fixLegacyCanonLinks(root));
  const identity = resolveRepositoryIdentity(root);
  const ingested = migrateLegacySources(root, identity, options);
  changed.push(...ingested.map((item) => item.target));
  changed.push(...updateCanonDocumentMaps(root, identity));
  changed.push(...archiveLegacyTrees(root));
  changed.push(...migrateApplicationDocumentation(root, options));
  changed.push(...fixLegacyCanonLinks(root));

  const validation = validateRepositoryDocsStandard(root, { profile: 'auto' });
  return {
    root,
    identity,
    changed: [...new Set(changed)],
    ingested,
    validation,
  };
}

export function listAllWorkspaceRepositories(workspaceRoot) {
  const prefixed = listWorkspaceRepositories(workspaceRoot, { prefix: 'sdkwork-' });
  const extras = fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('sdkwork-'))
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((repoRoot) => fs.existsSync(path.join(repoRoot, 'AGENTS.md')));
  return [...new Set([...prefixed, ...extras])].sort();
}

export function auditRepositoryDocsDebt(root) {
  const issues = [];
  const identity = resolveRepositoryIdentity(root);

  for (const rel of walkMarkdownFiles(root, 'docs')) {
    const text = readText(path.join(root, rel));
    for (const [from] of LEGACY_LINK_REPLACEMENTS) {
      if (text.includes(from)) {
        issues.push(`stale canon link in ${rel}: ${from}`);
      }
    }
  }

  for (const legacyDir of LEGACY_ARCH_DIRS) {
    if (fs.existsSync(path.join(root, legacyDir))) {
      issues.push(`legacy documentation tree still active: ${legacyDir}`);
    }
  }

  const docsRoot = path.join(root, 'docs');
  if (fs.existsSync(docsRoot)) {
    for (const entry of fs.readdirSync(docsRoot, { withFileTypes: true })) {
      if (entry.isFile() && LEGACY_NUMBERED_DOC.test(entry.name)) {
        issues.push(`numbered legacy doc still at docs root: docs/${entry.name}`);
      }
    }
  }

  const prdText = readText(path.join(root, CANON_PATHS.prd));
  const prdShards = listShards(root, 'docs/product/prd', PRD_SHARD_PATTERN);
  if (identity.profile === 'application' && /Status:\s*draft/iu.test(prdText) && prdShards.length > 0) {
    issues.push('PRD entry still draft while product shards exist');
  }
  if (identity.profile === 'application' && isEmptyApplicationCanon(prdText) && prdShards.length === 0) {
    const legacySources = discoverLegacyMarkdownSources(root);
    const productSources = legacySources.filter((source) => (
      classifyLegacyDoc(path.basename(source), readText(path.join(root, source))) === 'product'
    ));
    if (productSources.length > 0) {
      issues.push(`empty PRD entry with unmigrated product sources (${productSources.length})`);
    }
  }

  for (const appRoot of findApplicationRoots(root)) {
    if (!fs.existsSync(path.join(appRoot, CANON_PATHS.prd))) {
      const appDocs = path.join(appRoot, 'docs');
      if (fs.existsSync(appDocs) && walkMarkdownFiles(appRoot, 'docs').length > 1) {
        issues.push(`application root missing Canon docs: ${posixRelative(root, appRoot)}`);
      }
    }
  }

  return {
    root,
    identity,
    issues,
  };
}
