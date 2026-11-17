import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_SECTIONS = [
  'When to use',
  'Inputs',
  'Workflow',
  'Rules',
  'Verification',
  'Output',
];

export const HOST_DISCOVERY_DIRECTORIES = [
  '.agents/skills',
  'agent/skills',
  '.claude/skills',
];

const DECLARATION_MARKER = 'AGENT_SKILLS_SPEC.md';
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
const MAX_SKILL_NAME_CHARS = 64;
const MAX_DESCRIPTION_CHARS = 1024;
const MAX_SKILL_LINES = 500;
const MAX_SKILL_BYTES = 32 * 1024;
const MAX_HOST_POINTER_LINES = 12;
const REQUIRED_FRONTMATTER_KEYS = ['name', 'description'];
const OPTIONAL_FRONTMATTER_KEYS = ['license', 'allowed-tools', 'owner', 'module', 'standards'];
const MODULE_MARKERS = ['package.json', 'Cargo.toml', 'pubspec.yaml', 'specs/component.spec.json'];
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bsk-[A-Za-z0-9]{20,}\b/u,
  /\bghp_[A-Za-z0-9]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u,
];
const MACHINE_ABSOLUTE_PATTERN = /(^|[\s`'"(\[])([A-Za-z]:\\|\/(Users|home|root|opt|usr|var|tmp|mnt)\/)/u;
const FORBIDDEN_SKILL_DIRECTORIES = new Set([
  '.cache',
  '.git',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'target',
]);
const SKIP_DIRECTORIES = new Set([
  '.cache',
  '.claude',
  '.dart_tool',
  '.git',
  '.gradle',
  '.next',
  '.output',
  '.pnpm',
  '.pnpm-store',
  '.sdkwork',
  '.tmp',
  '.workbuddy',
  '.agents',
  'build',
  'coverage',
  'dist',
  'external',
  'generated',
  'node_modules',
  'target',
  'templates',
  'third_party',
  'tmp',
  'vendor',
]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function issue(kind, target, detail, severity = 'error') {
  return { kind, path: toPosix(target), detail, severity };
}

function readIfFile(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function listDirectories(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function stripValueComment(value) {
  if (value.startsWith('"') || value.startsWith("'")) return value;
  const commentIndex = value.indexOf(' #');
  return commentIndex === -1 ? value : value.slice(0, commentIndex).trimEnd();
}

function unquote(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parses the flat YAML frontmatter block required by AGENT_SKILLS_SPEC.md §4.
 * Nested mappings, lists, block scalars, and multi-line values are reported as violations
 * because the standard deliberately narrows the Agent Skills frontmatter to flat scalars.
 */
export function parseSkillFrontmatter(content) {
  const errors = [];
  const normalized = content.replace(/^\uFEFF/u, '');
  const lines = normalized.split(/\r?\n/u);
  if (lines[0]?.trim() !== '---') {
    return { fields: {}, body: normalized, errors: ['missing-frontmatter'] };
  }
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) {
    return { fields: {}, body: '', errors: ['unterminated-frontmatter'] };
  }

  const fields = Object.create(null);
  for (const rawLine of lines.slice(1, closingIndex)) {
    if (rawLine.trim() === '' || rawLine.trimStart().startsWith('#')) continue;
    if (/^[ \t]/u.test(rawLine)) {
      errors.push('non-flat-frontmatter');
      continue;
    }
    const separatorIndex = rawLine.indexOf(':');
    if (separatorIndex === -1) {
      errors.push('malformed-frontmatter');
      continue;
    }
    const key = rawLine.slice(0, separatorIndex).trim();
    const rawValue = rawLine.slice(separatorIndex + 1).trim();
    const value = unquote(stripValueComment(rawValue)).trim();
    if (!key) {
      errors.push('malformed-frontmatter');
      continue;
    }
    if (value.startsWith('[') || value.startsWith('{') || value === '|' || value === '>') {
      errors.push('non-flat-frontmatter');
      continue;
    }
    if (Object.hasOwn(fields, key)) {
      errors.push('duplicate-frontmatter-key');
      continue;
    }
    fields[key] = value;
  }

  return { fields, body: lines.slice(closingIndex + 1).join('\n'), errors };
}

function parseSections(body) {
  const headings = [];
  for (const line of body.split(/\r?\n/u)) {
    const match = /^##\s+(.+?)\s*$/u.exec(line);
    if (match) headings.push(match[1]);
  }
  return headings;
}

function validateSkillContent(skill, content) {
  const issues = [];
  const bytes = Buffer.byteLength(content, 'utf8');
  const lineCount = content.split(/\r?\n/u).length;
  if (bytes > MAX_SKILL_BYTES) {
    issues.push(issue('skill-too-large-bytes', skill.relPath, `${bytes} bytes > ${MAX_SKILL_BYTES}`));
  }
  if (lineCount > MAX_SKILL_LINES) {
    issues.push(issue('skill-too-many-lines', skill.relPath, `${lineCount} lines > ${MAX_SKILL_LINES}`));
  }

  const { fields, body, errors } = parseSkillFrontmatter(content);
  for (const error of errors) issues.push(issue(error, skill.relPath, 'frontmatter violates AGENT_SKILLS_SPEC.md §4'));

  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!fields[key]) issues.push(issue(`missing-frontmatter-${key}`, skill.relPath, `frontmatter must define ${key}`));
  }
  for (const key of Object.keys(fields)) {
    if (REQUIRED_FRONTMATTER_KEYS.includes(key) || OPTIONAL_FRONTMATTER_KEYS.includes(key)) continue;
    issues.push(issue('unknown-frontmatter-key', skill.relPath, `unknown frontmatter key: ${key}`, 'warning'));
  }

  const name = fields.name ?? '';
  if (name) {
    if (!SKILL_NAME_PATTERN.test(name) || name.length > MAX_SKILL_NAME_CHARS) {
      issues.push(issue('invalid-skill-name', skill.relPath, `name must be lowercase kebab-case, 1-${MAX_SKILL_NAME_CHARS} chars: ${name}`));
    }
    if (name !== skill.name) {
      issues.push(issue('skill-name-mismatch', skill.relPath, `frontmatter name "${name}" differs from directory "${skill.name}"`));
    }
  }

  const description = fields.description ?? '';
  if (description) {
    if (description.length > MAX_DESCRIPTION_CHARS) {
      issues.push(issue('description-too-long', skill.relPath, `${description.length} chars > ${MAX_DESCRIPTION_CHARS}`));
    }
    if (!/use when/u.test(description.toLowerCase())) {
      issues.push(issue('description-missing-trigger', skill.relPath, 'description must contain a "Use when" trigger sentence'));
    }
  }

  const bodyLines = body.split(/\r?\n/u);
  const firstContentLine = bodyLines.find((line) => line.trim() !== '') ?? '';
  if (!/^#\s+\S/u.test(firstContentLine)) {
    issues.push(issue('missing-title', skill.relPath, 'body must start with a level-1 heading'));
  }

  const headings = parseSections(body);
  for (const section of REQUIRED_SECTIONS) {
    if (!headings.includes(section)) {
      issues.push(issue('missing-section', skill.relPath, `missing "## ${section}"`));
    }
  }
  const positions = headings
    .map((heading) => ({ heading, index: REQUIRED_SECTIONS.indexOf(heading) }))
    .filter((entry) => entry.index !== -1);
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index].index < positions[index - 1].index) {
      issues.push(issue('section-order', skill.relPath, 'required sections must keep AGENT_SKILLS_SPEC.md §4 order', 'warning'));
      break;
    }
  }

  if (MACHINE_ABSOLUTE_PATTERN.test(content)) {
    issues.push(issue('machine-absolute-path', skill.relPath, 'skill must not contain machine-absolute paths'));
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    issues.push(issue('possible-secret', skill.relPath, 'skill must not contain secrets or credentials'));
  }

  return { issues, fields, body };
}

function collectSkills(directory, baseRelPath) {
  const skills = [];
  for (const name of listDirectories(directory)) {
    const skillPath = path.join(directory, name);
    const relPath = `${baseRelPath}/${name}`;
    const content = readIfFile(path.join(skillPath, 'SKILL.md'));
    skills.push({
      name,
      dir: skillPath,
      relPath,
      content,
    });
  }
  return skills;
}

function validateSkill(skill) {
  const issues = [];
  if (!SKILL_NAME_PATTERN.test(skill.name) || skill.name.length > MAX_SKILL_NAME_CHARS) {
    issues.push(issue('invalid-skill-name', skill.relPath, `directory must be lowercase kebab-case, 1-${MAX_SKILL_NAME_CHARS} chars`));
  }
  issues.push(...validateSkillPackageDirectories(skill));
  if (skill.content === null) {
    issues.push(issue('missing-skill-file', skill.relPath, 'SKILL.md is required'));
    skill.fields = {};
    skill.body = '';
    return issues;
  }
  const result = validateSkillContent(skill, skill.content);
  skill.fields = result.fields;
  skill.body = result.body;
  return [...issues, ...result.issues];
}

function validateSkillPackageDirectories(skill) {
  const issues = [];
  const queue = [skill.dir];
  while (queue.length > 0) {
    const current = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(current, entry.name);
      if (FORBIDDEN_SKILL_DIRECTORIES.has(entry.name)) {
        issues.push(issue(
          'forbidden-skill-content',
          `${skill.relPath}/${toPosix(path.relative(skill.dir, child))}`,
          `skill package must not contain ${entry.name}/`,
        ));
        continue;
      }
      queue.push(child);
    }
  }
  return issues;
}

function hasAnyMarker(moduleRoot) {
  return MODULE_MARKERS.some((marker) => fs.existsSync(path.join(moduleRoot, marker)));
}

function hasSkillEntries(skillsDirectory) {
  return listDirectories(skillsDirectory)
    .some((name) => fs.existsSync(path.join(skillsDirectory, name, 'SKILL.md')));
}

function isDeclaredSkillsDirectory(skillsDirectory) {
  const readmeContent = readIfFile(path.join(skillsDirectory, 'README.md'));
  return readmeContent !== null && readmeContent.includes(DECLARATION_MARKER);
}

function validateModuleIndex(moduleRoot, skills, skillsRelPath) {
  const issues = [];
  const readmeContent = readIfFile(path.join(moduleRoot, 'skills', 'README.md'));
  if (readmeContent === null) {
    issues.push(issue('missing-skills-readme', `${skillsRelPath}/README.md`, 'skills/README.md is required when the module ships skills'));
    return issues;
  }
  for (const skill of skills) {
    if (!readmeContent.includes(skill.name)) {
      issues.push(issue('skill-not-indexed', skill.relPath, 'skills/README.md must list every skill'));
    }
  }
  return issues;
}

/**
 * Validates every `skills/` container in one repository or application root.
 * A repository/application root is itself a module; its `skills/` is the authoritative
 * repository-wide container. `.sdkwork/skills/` is a retired location and only warns.
 * Returns issues sorted by path, then kind. `severity` is 'error' or 'warning'.
 */
export function validateAgentSkills(root, options = {}) {
  const checkHostLayer = options.checkHostLayer === true;
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    return [issue('missing-root', resolvedRoot, 'root must be an existing directory')];
  }

  const issues = [];
  const { modules, layoutIssues } = discoverModules(resolvedRoot);
  issues.push(...layoutIssues);

  const rootContainer = validateSkillsContainer(resolvedRoot, '');
  issues.push(...rootContainer.issues);

  const moduleSkills = [];
  for (const module of modules) {
    const container = validateSkillsContainer(module.root, module.relPath);
    issues.push(...container.issues);
    moduleSkills.push(...container.skills);
  }

  if (fs.existsSync(path.join(resolvedRoot, '.sdkwork', 'skills'))) {
    issues.push(issue(
      'legacy-sdkwork-skills',
      '.sdkwork/skills',
      'retired workspace skills location; migrate each skill to <module-root>/skills/',
      'warning',
    ));
  }

  const allSkills = [...rootContainer.skills, ...moduleSkills];
  const names = new Map();
  for (const skill of allSkills) {
    const existing = names.get(skill.name);
    if (existing) {
      issues.push(issue('duplicate-skill-name', skill.relPath, `skill name "${skill.name}" is also used by ${existing.relPath}`));
    } else {
      names.set(skill.name, skill);
    }
  }

  for (const hostRelPath of checkHostLayer ? HOST_DISCOVERY_DIRECTORIES : []) {
    const hostDirectory = path.join(resolvedRoot, hostRelPath);
    if (!fs.existsSync(hostDirectory)) continue;
    for (const name of listDirectories(hostDirectory)) {
      const skillPath = path.join(hostDirectory, name);
      const relPath = `${hostRelPath}/${name}`;
      const content = readIfFile(path.join(skillPath, 'SKILL.md'));
      if (content === null) {
        issues.push(issue('host-entry-missing-skill', relPath, 'host discovery entry must contain SKILL.md'));
        continue;
      }
      const { fields, body } = parseSkillFrontmatter(content);
      const authoritative = names.get(fields.name ?? name);
      if (!authoritative) {
        issues.push(issue('orphan-host-skill', relPath, 'host discovery entry has no authoritative skill'));
        continue;
      }
      if ((fields.name ?? '') !== authoritative.name) {
        issues.push(issue('host-skill-name-mismatch', relPath, `frontmatter name must equal ${authoritative.name}`));
      }
      if (normalizeDescription(fields.description) !== normalizeDescription(authoritative.fields?.description)) {
        issues.push(issue('host-skill-description-mismatch', relPath, 'frontmatter description must equal the authoritative skill'));
      }
      const bodyLines = body.split(/\r?\n/u).filter((line) => line.trim() !== '').length;
      if (bodyLines > MAX_HOST_POINTER_LINES) {
        issues.push(issue('host-skill-duplicated-body', relPath, `body is ${bodyLines} lines; a host entry must be a pointer, not a copy`, 'warning'));
      }
      if (!body.includes(authoritative.relPath)) {
        issues.push(issue('host-skill-missing-pointer', relPath, `body must name the authoritative path ${authoritative.relPath}`, 'warning'));
      }
    }
  }

  return issues.sort((left, right) => (
    left.path.localeCompare(right.path, 'en') || left.kind.localeCompare(right.kind, 'en')
  ));
}

function normalizeDescription(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function validateSkillsContainer(moduleRoot, moduleRelPath) {
  const issues = [];
  const skillsDirectory = path.join(moduleRoot, 'skills');
  const skillsRelPath = moduleRelPath ? `${moduleRelPath}/skills` : 'skills';
  const skills = collectSkills(skillsDirectory, skillsRelPath);
  if (!fs.existsSync(skillsDirectory)) return { issues, skills: [] };

  const readmeContent = readIfFile(path.join(skillsDirectory, 'README.md'));
  const declared = readmeContent !== null && readmeContent.includes(DECLARATION_MARKER);

  if (!declared) {
    if (skills.length > 0) {
      issues.push(issue(
        'module-skills-not-declared',
        skillsRelPath,
        `skills/README.md must cite ${DECLARATION_MARKER} to declare agent skills; treated as product data`,
        'warning',
      ));
    } else if (readmeContent === null) {
      issues.push(issue('missing-skills-readme', `${skillsRelPath}/README.md`, 'skills/ must contain README.md or be removed'));
    }
    return { issues, skills: [] };
  }

  if (skills.length === 0) {
    issues.push(issue('empty-skills-directory', skillsRelPath, 'declared skills/ contains no <skill-name>/SKILL.md entries'));
    return { issues, skills: [] };
  }

  for (const skill of skills) {
    issues.push(...validateSkill(skill));
  }
  issues.push(...validateModuleIndex(moduleRoot, skills, skillsRelPath));
  return { issues, skills };
}

function discoverModules(root) {
  const modules = [];
  const layoutIssues = [];

  function walk(currentDirectory, currentRelPath) {
    for (const name of listDirectories(currentDirectory)) {
      if (SKIP_DIRECTORIES.has(name)) continue;
      const childPath = path.join(currentDirectory, name);
      const childRelPath = currentRelPath ? `${currentRelPath}/${name}` : name;

      if (name === 'skills') {
        // The root-level skills/ container is handled by validateSkillsContainer for the root
        // module itself; the walker only classifies nested module containers.
        if (currentRelPath === '') continue;
        // A directory named `skills` is an agent skills directory only when it holds
        // `<skill-name>/SKILL.md` entries or declares the standard. A product catalog that
        // happens to be named `skills` is not an agent skill scope.
        const declared = isDeclaredSkillsDirectory(childPath);
        if (!declared && !hasSkillEntries(childPath)) continue;
        if (HOST_DISCOVERY_DIRECTORIES.includes(childRelPath)) continue;
        if (!hasAnyMarker(currentDirectory)) {
          layoutIssues.push(issue(
            'skills-directory-outside-module',
            childRelPath,
            'skills/ is only valid under an authored module root; a product skill catalog belongs to application data, not repository knowledge',
            'warning',
          ));
          continue;
        }
        modules.push({ root: currentDirectory, relPath: currentRelPath });
        continue;
      }

      walk(childPath, childRelPath);
    }
  }

  walk(root, '');
  return { modules, layoutIssues };
}

export function summarizeIssues(issues) {
  const errors = issues.filter((entry) => entry.severity === 'error');
  const warnings = issues.filter((entry) => entry.severity === 'warning');
  return { errors, warnings };
}
