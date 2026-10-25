import fs from 'node:fs';
import path from 'node:path';

import { bootstrapRepositoryDocs } from './bootstrap-repository-docs-lib.mjs';
import { validateRepositoryDocsStandard } from './check-repository-docs-standard.mjs';
import {
  ensureCanonDirReadmes,
  migrateLegacyCanonPaths,
} from './migrate-legacy-canon-paths-lib.mjs';
import { CANON_PATHS, LEGACY_CANON_PATHS, REQUIRED_CANON_LINKS, TECH_SHARD_PATTERN } from './repository-docs-paths.mjs';

const TECH_ENTRY_FILE = 'TECH_ARCHITECTURE.md';
const TECH_SHARD_DIR = 'docs/architecture/tech';
const PRD_ENTRY_FILE = 'PRD.md';
const CANON_LINKS = REQUIRED_CANON_LINKS;

const CANON_SECTION = `## Documentation Canon

- [docs/README.md](docs/README.md)
- [docs/product/prd/PRD.md](docs/product/prd/PRD.md)
- [docs/architecture/tech/TECH_ARCHITECTURE.md](docs/architecture/tech/TECH_ARCHITECTURE.md)
`;

const FOUNDATION_REPOSITORY_NAMES = new Set([
  'sdkwork-appbase',
  'sdkwork-core',
  'sdkwork-database',
  'sdkwork-discovery',
  'sdkwork-fs',
  'sdkwork-github-workflow',
  'sdkwork-id',
  'sdkwork-kernel',
  'sdkwork-rpc-framework',
  'sdkwork-sdk-commons',
  'sdkwork-sdk-generator',
  'sdkwork-utils',
  'sdkwork-web-framework',
  'sdkwork-deployments',
  'sdkwork-app-topology',
  'sdkwork-models',
]);

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

function containsAllCanonLinks(text) {
  return CANON_LINKS.every((target) => (
    text.includes(target)
    || text.includes(target.replace(/^docs\//u, ''))
  ));
}

function isStubCanonContent(text) {
  if (!text.trim()) {
    return true;
  }
  if (/Reserved per SDKWORK_WORKSPACE_SPEC\.md/iu.test(text)) {
    return true;
  }
  if (!/Status:\s*(draft|active|deprecated)/iu.test(text)) {
    return true;
  }
  if (!/Owner:\s*.+/iu.test(text)) {
    return true;
  }
  return false;
}

function listCanonShardFiles(root, dirRelativePath, entryFileName) {
  const absoluteDir = path.join(root, dirRelativePath);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }
  return fs.readdirSync(absoluteDir)
    .filter((name) => name.endsWith('.md') && name !== entryFileName && name !== 'README.md')
    .sort();
}

function canonicalTechShardName(fileName) {
  if (TECH_SHARD_PATTERN.test(fileName)) {
    return fileName;
  }
  const stem = fileName.replace(/\.md$/iu, '');
  return `TECH-${stem.toLowerCase().replace(/_/gu, '-').replace(/[^a-z0-9-]+/gu, '-').replace(/-+/gu, '-')}.md`;
}

function replaceMarkdownReferences(root, oldName, newName) {
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.md')) {
        continue;
      }
      const text = readText(full);
      if (!text.includes(oldName)) {
        continue;
      }
      writeText(full, text.replaceAll(oldName, newName));
    }
  }
  const docsDir = path.join(root, 'docs');
  if (fs.existsSync(docsDir)) {
    walk(docsDir);
  }
}

function alignTechShardFilenames(root) {
  const changed = [];
  for (const fileName of listCanonShardFiles(root, TECH_SHARD_DIR, TECH_ENTRY_FILE)) {
    const canonical = canonicalTechShardName(fileName);
    if (canonical === fileName) {
      continue;
    }
    const from = path.join(root, TECH_SHARD_DIR, fileName);
    const to = path.join(root, TECH_SHARD_DIR, canonical);
    if (fs.existsSync(to)) {
      continue;
    }
    fs.renameSync(from, to);
    replaceMarkdownReferences(root, fileName, canonical);
    changed.push(`${TECH_SHARD_DIR}/${fileName} -> ${canonical}`);
  }
  return changed;
}

function ensureTechArchitectureCompliance(root) {
  const relativePath = CANON_PATHS.techArchitecture;
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  let text = readText(filePath);
  let changed = false;

  if (!/ARCHITECTURE_DECISION_SPEC\.md/iu.test(text)) {
    if (/^Specs:\s*.+$/mu.test(text)) {
      text = text.replace(/^Specs:\s*.+$/mu, (line) => (
        line.includes('ARCHITECTURE_DECISION_SPEC') ? line : `${line.trimEnd()}, ARCHITECTURE_DECISION_SPEC.md`
      ));
    } else {
      text = text.replace(/^(#[^\n]+\n)/u, `$1Specs: ARCHITECTURE_DECISION_SPEC.md, DOCUMENTATION_SPEC.md\n`);
    }
    changed = true;
  }

  if (!/##\s+.*(Technology|Architecture|Overview|Module|Boundary)/iu.test(text)) {
    const overview = '\n## 1. Architecture Overview\n\nDescribe the repository/application architecture.\n\n';
    const firstSection = text.search(/\n##\s+/u);
    if (firstSection === -1) {
      text = `${text.replace(/\s*$/u, '')}${overview}`;
    } else {
      text = `${text.slice(0, firstSection)}${overview}${text.slice(firstSection)}`;
    }
    changed = true;
  }

  const shards = listCanonShardFiles(root, TECH_SHARD_DIR, TECH_ENTRY_FILE)
    .filter((fileName) => TECH_SHARD_PATTERN.test(fileName));
  const missing = shards.filter((shard) => !text.includes(shard));
  if (missing.length > 0) {
    const links = missing.map((shard) => `- [${shard}](${shard})`).join('\n');
    if (/##\s+8\.\s+Architecture Decision Index/mu.test(text)) {
      text = text.replace(
        /(##\s+8\.\s+Architecture Decision Index\s*\n)/mu,
        `$1\n${links}\n`,
      );
    } else if (/##\s+Document Map/mu.test(text)) {
      text = text.replace(/(##\s+Document Map\s*\n)/mu, `$1\n${links}\n`);
    } else {
      text = `${text.replace(/\s*$/u, '')}\n\n## 8. Architecture Decision Index\n\n${links}\n`;
    }
    changed = true;
  }

  if (changed) {
    writeText(filePath, text);
  }
  return changed;
}

function ensurePrdCompliance(root) {
  const relativePath = CANON_PATHS.prd;
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  let text = readText(filePath);
  if (/REQUIREMENTS_SPEC\.md/iu.test(text)) {
    return false;
  }
  if (/^Specs:\s*.+$/mu.test(text)) {
    text = text.replace(/^Specs:\s*.+$/mu, (line) => (
      line.includes('REQUIREMENTS_SPEC') ? line : `${line.trimEnd()}, REQUIREMENTS_SPEC.md`
    ));
  } else {
    text = text.replace(/^(#[^\n]+\n)/u, `$1Specs: REQUIREMENTS_SPEC.md, DOCUMENTATION_SPEC.md\n`);
  }
  writeText(filePath, text);
  return true;
}

function alignCanonShardCompliance(root) {
  const changed = [];
  for (const item of alignTechShardFilenames(root)) {
    changed.push(item);
  }
  if (ensureTechArchitectureCompliance(root)) {
    changed.push(CANON_PATHS.techArchitecture);
  }
  if (ensurePrdCompliance(root)) {
    changed.push(CANON_PATHS.prd);
  }
  return changed;
}

function titleCaseFromRepo(repoName) {
  return repoName
    .replace(/^sdkwork-/u, '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function resolveRepositoryIdentity(root) {
  const repoName = path.basename(root);
  const manifestPath = path.join(root, 'agent.app.config.json');
  let applicationCode = repoName.replace(/^sdkwork-/u, '');
  let productName = titleCaseFromRepo(repoName);
  let owner = 'SDKWork maintainers';

  if (repoName === 'sdkwork-specs' || fs.existsSync(path.join(root, 'DOCUMENTATION_SPEC.md'))) {
    return {
      profile: 'standards',
      repoName,
      applicationCode: 'sdkwork-specs',
      productName: 'SDKWork Standards',
      owner: 'SDKWork standards maintainers',
    };
  }

  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readText(manifestPath));
      productName = manifest.app?.displayName || productName;
      applicationCode = manifest.app?.key || applicationCode;
    } catch {
      // keep defaults
    }
    return {
      profile: 'application',
      repoName,
      applicationCode,
      productName,
      owner,
    };
  }

  if (FOUNDATION_REPOSITORY_NAMES.has(repoName)) {
    return {
      profile: 'narrow-tool',
      repoName,
      applicationCode,
      productName,
      owner,
    };
  }

  return {
    profile: 'application',
    repoName,
    applicationCode,
    productName,
    owner,
  };
}

function governancePrd(values) {
  return `# ${values.productName} PRD

Status: draft
Owner: ${values.owner}
Updated: ${new Date().toISOString().slice(0, 10)}
Specs: REQUIREMENTS_SPEC.md, DOCUMENTATION_SPEC.md, GOVERNANCE_SPEC.md

## 1. Background And Problem

${values.repoName} must remain discoverable, reviewable, and aligned with SDKWork standards.

## 2. Goals And Scope

Govern standards evolution, repository documentation layout, and consumer alignment for SDKWork repositories.

## 3. Goals And Non-Goals

### Goals

- Keep canonical standards authoritative and linkable.
- Make repository documentation layout consistent across SDKWork roots.

### Non-Goals

- End-user product behavior owned by application repositories.

## 8. Linked Requirements
`;
}

function narrowToolPrd(values) {
  return `# ${values.productName} PRD

Status: draft
Owner: ${values.owner}
Application: ${values.applicationCode}
Updated: ${new Date().toISOString().slice(0, 10)}
Specs: REQUIREMENTS_SPEC.md, DOCUMENTATION_SPEC.md

## 1. Background And Problem

${values.repoName} is a foundation repository, not an end-user product.

## 2. Goals And Scope

Provide reusable platform capabilities consumed by SDKWork applications and document integration boundaries for operators and integrators.

## 3. Goals And Non-Goals

### Goals

- Keep public contracts, package boundaries, and verification discoverable.
- Document how application repositories consume this repository.

### Non-Goals

- End-user workflows, product packaging, or tenant-facing application behavior.

## 8. Linked Requirements
`;
}

function applicationPrd(values) {
  return `# ${values.productName} PRD

Status: draft
Owner: ${values.owner}
Application: ${values.applicationCode}
Updated: ${new Date().toISOString().slice(0, 10)}
Specs: REQUIREMENTS_SPEC.md, DOCUMENTATION_SPEC.md

## 1. Background And Problem

Describe the product problem ${values.productName} solves.

## 2. Target Users

## 3. Goals And Non-Goals

## 4. Scope

## 5. User Scenarios

## 6. Success Metrics

## 7. Phases

## 8. Linked Requirements

## 9. Open Questions
`;
}

function techArchitecture(values, extraSpecs = []) {
  const specs = ['ARCHITECTURE_DECISION_SPEC.md', 'DOCUMENTATION_SPEC.md', 'SDKWORK_WORKSPACE_SPEC.md', ...extraSpecs];
  return `# ${values.productName} Technical Architecture

Status: draft
Owner: ${values.owner}
Updated: ${new Date().toISOString().slice(0, 10)}
Specs: ${[...new Set(specs)].join(', ')}

## 1. Architecture Overview

Describe the repository/application architecture for ${values.productName}.

## 2. Technology Choices

| Category | Choice | Rationale | Root spec |
| --- | --- | --- | --- |
| Repository layout | SDKWork standard directories | Workspace interoperability | SDKWORK_WORKSPACE_SPEC.md |

## 3. System Boundaries And Modules

## 4. Directory And Package Layout

## 5. API, SDK, And Data Ownership

## 6. Security, Privacy, And Observability

## 7. Deployment And Runtime Topology

## 8. Architecture Decision Index

## 9. Verification

\`\`\`bash
node ../sdkwork-specs/tools/check-repository-docs-standard.mjs --root .
\`\`\`
`;
}

function ensureIndexYaml(root, identity) {
  const indexPath = path.join(root, 'docs/INDEX.yaml');
  const canonBlock = `canon:
  prd: ${CANON_PATHS.prd}
  techArchitecture: ${CANON_PATHS.techArchitecture}`;

  if (!fs.existsSync(indexPath)) {
    writeText(indexPath, [
      'schemaVersion: 1',
      'kind: sdkwork.docs.index',
      `repository: ${identity.applicationCode}`,
      canonBlock,
      'entries: []',
      'domains: []',
      '',
    ].join('\n'));
    return true;
  }

  let text = readText(indexPath);
  const original = text;
  text = text.replaceAll(LEGACY_CANON_PATHS.prd, CANON_PATHS.prd);
  text = text.replaceAll(LEGACY_CANON_PATHS.techArchitecture, CANON_PATHS.techArchitecture);
  if (!/kind:\s*sdkwork\.docs\.index/iu.test(text)) {
    text = `schemaVersion: 1\nkind: sdkwork.docs.index\n${text}`;
  }
  if (!/canon:/iu.test(text)) {
    text = `${text.replace(/\s*$/u, '')}\n${canonBlock}\n`;
  }
  if (!/repository:/iu.test(text)) {
    text = text.replace(/kind:\s*sdkwork\.docs\.index\s*\n/iu, `kind: sdkwork.docs.index\nrepository: ${identity.applicationCode}\n`);
  }
  if (text !== original) {
    writeText(indexPath, text);
    return true;
  }
  return false;
}

function ensureProfileCanonCompliance(root, identity) {
  const prdPath = path.join(root, CANON_PATHS.prd);
  if (!fs.existsSync(prdPath)) {
    return false;
  }
  const text = readText(prdPath);
  if (identity.profile === 'narrow-tool'
    && !/not an end-user product|non-product|tool repository|foundation repository/iu.test(text)) {
    writeText(prdPath, narrowToolPrd(identity));
    return true;
  }
  if (identity.profile === 'standards'
    && !/standards|governance|sdkwork-specs/iu.test(text)) {
    writeText(prdPath, governancePrd(identity));
    return true;
  }
  return false;
}

function canonPrdContent(identity) {
  if (identity.profile === 'standards') {
    return governancePrd(identity);
  }
  if (identity.profile === 'narrow-tool') {
    return narrowToolPrd(identity);
  }
  return applicationPrd(identity);
}

function upgradeStaleCanonLinks(text) {
  let updated = text;
  const replacements = [
    ['docs/product/PRD.md', 'docs/product/prd/PRD.md'],
    ['docs/architecture/TECH_ARCHITECTURE.md', 'docs/architecture/tech/TECH_ARCHITECTURE.md'],
    ['product/PRD.md', 'product/prd/PRD.md'],
    ['architecture/TECH_ARCHITECTURE.md', 'architecture/tech/TECH_ARCHITECTURE.md'],
    ['(product/PRD.md)', '(product/prd/PRD.md)'],
    ['(architecture/TECH_ARCHITECTURE.md)', '(architecture/tech/TECH_ARCHITECTURE.md)'],
  ];
  for (const [from, to] of replacements) {
    updated = updated.replaceAll(from, to);
  }
  return updated;
}

function ensureDocsReadme(root, identity) {
  const readmePath = path.join(root, 'docs/README.md');
  let text = readText(readmePath);
  if (!text.trim()) {
    bootstrapRepositoryDocs(root, {
      applicationCode: identity.applicationCode,
      productName: identity.productName,
      owner: identity.owner,
      force: false,
    });
    return;
  }
  const upgraded = upgradeStaleCanonLinks(text);
  if (upgraded !== text) {
    writeText(readmePath, upgraded);
    text = upgraded;
  }
  if (containsAllCanonLinks(text)) {
    return;
  }
  const appendix = [
    '',
    '## Canon Documents',
    '',
    '| Document | Path |',
    '| --- | --- |',
    '| Product PRD | [product/prd/PRD.md](product/prd/PRD.md) |',
    '| Technical architecture | [architecture/tech/TECH_ARCHITECTURE.md](architecture/tech/TECH_ARCHITECTURE.md) |',
    '',
    `- [docs/product/prd/PRD.md](product/prd/PRD.md)`,
    `- [docs/architecture/tech/TECH_ARCHITECTURE.md](architecture/tech/TECH_ARCHITECTURE.md)`,
    '',
  ].join('\n');
  writeText(readmePath, `${text.replace(/\s*$/u, '')}\n${appendix}`);
}

function upsertCanonSection(text, sectionMarkdown) {
  if (containsAllCanonLinks(text)) {
    return text;
  }
  if (/##\s+Documentation Canon\b/iu.test(text)) {
    return text.replace(
      /##\s+Documentation Canon[\s\S]*?(?=\n##\s+|\n$)/iu,
      `${sectionMarkdown.trim()}\n`,
    );
  }
  const anchors = [
    '\n## Spec Resolution Order',
    '\n## Build, Test, and Verification',
    '\n## Agent Execution Rules',
  ];
  for (const anchor of anchors) {
    if (text.includes(anchor)) {
      return text.replace(anchor, `\n${sectionMarkdown}${anchor}`);
    }
  }
  return `${text.replace(/\s*$/u, '')}\n\n${sectionMarkdown}`;
}

function ensureCanonLinksInFile(root, relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const original = readText(filePath);
  const updated = upsertCanonSection(original, CANON_SECTION);
  if (updated === original) {
    return false;
  }
  writeText(filePath, updated);
  return true;
}

function ensureCanonFiles(root, identity, options = {}) {
  bootstrapRepositoryDocs(root, {
    applicationCode: identity.applicationCode,
    productName: identity.productName,
    owner: identity.owner,
    force: false,
  });

  migrateLegacyCanonPaths(root);
  ensureCanonDirReadmes(root);

  const prdPath = path.join(root, CANON_PATHS.prd);
  const techPath = path.join(root, CANON_PATHS.techArchitecture);
  const prdText = readText(prdPath);
  const techText = readText(techPath);
  const replaceCanon = Boolean(options.forceCanon) || isStubCanonContent(prdText) || isStubCanonContent(techText);

  if (replaceCanon) {
    writeText(prdPath, canonPrdContent(identity));
    writeText(techPath, techArchitecture(identity));
  }

  ensureProfileCanonCompliance(root, identity);
  ensureIndexYaml(root, identity);
  ensureDocsReadme(root, identity);
}

export function alignRepositoryDocs(root, options = {}) {
  const identity = resolveRepositoryIdentity(root);
  const changed = [];

  if (!fs.existsSync(path.join(root, 'docs'))) {
    changed.push('docs/');
  }

  ensureCanonFiles(root, identity, options);
  if (ensureIndexYaml(root, identity)) {
    changed.push('docs/INDEX.yaml');
  }
  if (ensureProfileCanonCompliance(root, identity)) {
    changed.push(CANON_PATHS.prd);
  }
  if (ensureCanonLinksInFile(root, 'AGENTS.md')) {
    changed.push('AGENTS.md');
  }
  if (ensureCanonLinksInFile(root, 'README.md')) {
    changed.push('README.md');
  }

  for (const item of alignCanonShardCompliance(root)) {
    changed.push(item);
  }

  const validation = validateRepositoryDocsStandard(root, {
    profile: identity.profile === 'standards' ? 'standards' : identity.profile,
  });

  return {
    root,
    identity,
    changed,
    validation,
  };
}

export function listWorkspaceRepositories(workspaceRoot, options = {}) {
  const prefix = options.prefix || 'sdkwork-';
  return fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((repoRoot) => fs.existsSync(path.join(repoRoot, 'AGENTS.md')))
    .sort();
}
