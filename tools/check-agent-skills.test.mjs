import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseSkillFrontmatter, validateAgentSkills } from './lib/agent-skills.mjs';

const SECTIONS = [
  '## When to use',
  'trigger',
  '## Inputs',
  '- a request',
  '## Workflow',
  '1. do the work',
  '## Rules',
  '- follow the spec',
  '## Verification',
  '```bash',
  'node tools/check-agent-skills.mjs --root .',
  '```',
  '## Output',
  'report the result',
].join('\n');

function skillSource(name, { description = `Use when testing ${name} in order to prove the validator works.`, extraFrontmatter = '', sections = SECTIONS } = {}) {
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    extraFrontmatter,
    '---',
    '',
    `# ${name}`,
    '',
    sections,
    '',
  ].filter((line) => line !== '').join('\n');
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-agent-skills-'));
}

function skillsReadme(names) {
  const list = names.map((name) => `- ${name}`).join('\n');
  return `# Skills\n\nContract: \`AGENT_SKILLS_SPEC.md\`.\n\n${list}\n`;
}

function declareSkills(root, names = []) {
  const directory = path.join(root, 'skills');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'README.md'), skillsReadme(names));
  return directory;
}

function addSkill(root, name, options) {
  const directory = path.join(root, 'skills');
  fs.mkdirSync(directory, { recursive: true });
  const readmePath = path.join(directory, 'README.md');
  if (!fs.existsSync(readmePath)) fs.writeFileSync(readmePath, skillsReadme([]));
  fs.mkdirSync(path.join(directory, name), { recursive: true });
  fs.writeFileSync(path.join(directory, name, 'SKILL.md'), skillSource(name, options));
  const readme = fs.readFileSync(readmePath, 'utf8');
  if (!readme.includes(name)) fs.writeFileSync(readmePath, `${readme}- ${name}\n`);
  return directory;
}

function addRawSkill(directory, name, options) {
  fs.mkdirSync(path.join(directory, name), { recursive: true });
  fs.writeFileSync(path.join(directory, name, 'SKILL.md'), skillSource(name, options));
}

function makeModule(root, moduleRelPath, skillNames) {
  const moduleRoot = path.join(root, moduleRelPath);
  fs.mkdirSync(path.join(moduleRoot, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'package.json'), '{ "name": "demo" }\n');
  const moduleSkills = path.join(moduleRoot, 'skills');
  fs.mkdirSync(moduleSkills, { recursive: true });
  fs.writeFileSync(path.join(moduleSkills, 'README.md'), skillsReadme(skillNames));
  for (const name of skillNames) addRawSkill(moduleSkills, name);
  return moduleRoot;
}

function kinds(root, options) {
  return validateAgentSkills(root, options).map((entry) => entry.kind);
}

test('accepts a declared root skill and a declared module skill', () => {
  const root = temporaryDirectory();
  addSkill(root, 'workspace-audit');
  makeModule(root, 'apps/demo', ['demo-sdk-generation']);

  assert.deepEqual(validateAgentSkills(root), []);
});

test('accepts a root with no skills directory', () => {
  const root = temporaryDirectory();

  assert.deepEqual(validateAgentSkills(root), []);
});

test('rejects a skills directory without README or skills', () => {
  const root = temporaryDirectory();
  fs.mkdirSync(path.join(root, 'skills'));

  assert.ok(kinds(root).includes('missing-skills-readme'));
});

test('rejects a declared skills directory that holds no skill', () => {
  const root = temporaryDirectory();
  declareSkills(root, []);

  assert.ok(kinds(root).includes('empty-skills-directory'));
});

test('warns when skills exist without a declaration', () => {
  const root = temporaryDirectory();
  fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
  addRawSkill(path.join(root, 'skills'), 'workspace-audit');

  const issues = validateAgentSkills(root);
  assert.equal(issues.filter((entry) => entry.severity === 'error').length, 0);
  assert.ok(issues.some((entry) => entry.kind === 'module-skills-not-declared'));
  assert.ok(!issues.some((entry) => entry.kind === 'missing-section'));
});

test('warns about the retired .sdkwork/skills location', () => {
  const root = temporaryDirectory();
  fs.mkdirSync(path.join(root, '.sdkwork', 'skills', 'legacy-skill'), { recursive: true });
  fs.writeFileSync(path.join(root, '.sdkwork', 'skills', 'legacy-skill', 'SKILL.md'), skillSource('legacy-skill'));

  const issues = validateAgentSkills(root);
  assert.equal(issues.filter((entry) => entry.severity === 'error').length, 0);
  assert.ok(issues.some((entry) => entry.kind === 'legacy-sdkwork-skills'));
  assert.ok(!issues.some((entry) => entry.kind === 'duplicate-skill-name'));
});

test('warns about a skills directory outside an authored module', () => {
  const root = temporaryDirectory();
  addRawSkill(path.join(root, 'scratch', 'skills'), 'demo-helper');
  fs.mkdirSync(path.join(root, 'scratch', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scratch', 'skills', 'demo-helper', 'SKILL.md'), skillSource('demo-helper'));

  assert.ok(kinds(root).includes('skills-directory-outside-module'));
});

test('ignores a business module named skills without SKILL.md entries', () => {
  const root = temporaryDirectory();
  fs.mkdirSync(path.join(root, 'iam', 'modules', 'skills', 'app-api'), { recursive: true });

  assert.deepEqual(validateAgentSkills(root), []);
});

test('rejects a skill directory without SKILL.md', () => {
  const root = temporaryDirectory();
  declareSkills(root, ['workspace-audit']);
  fs.mkdirSync(path.join(root, 'skills', 'workspace-audit'));

  assert.ok(kinds(root).includes('missing-skill-file'));
});

test('rejects invalid skill names and name mismatches', () => {
  const root = temporaryDirectory();
  const directory = declareSkills(root, ['Workspace_Audit', 'workspace-audit']);
  addRawSkill(directory, 'Workspace_Audit');
  fs.mkdirSync(path.join(directory, 'workspace-mismatch'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'workspace-mismatch', 'SKILL.md'), skillSource('workspace-audit'));

  const found = kinds(root);
  assert.ok(found.includes('invalid-skill-name'));
  assert.ok(found.includes('skill-name-mismatch'));
});

test('rejects a description without a Use when trigger', () => {
  const root = temporaryDirectory();
  addSkill(root, 'workspace-audit', { description: 'Audits the workspace.' });

  assert.ok(kinds(root).includes('description-missing-trigger'));
});

test('rejects a missing required section', () => {
  const root = temporaryDirectory();
  addSkill(root, 'workspace-audit', { sections: SECTIONS.replace('## Output', '## Result') });

  assert.ok(kinds(root).includes('missing-section'));
});

test('rejects machine-absolute paths and secrets', () => {
  const root = temporaryDirectory();
  addSkill(root, 'workspace-audit', {
    sections: SECTIONS.replace('do the work', 'read D:\\private\\workspace\\file.md'),
  });
  addSkill(root, 'workspace-secret', {
    sections: SECTIONS.replace('do the work', 'use ghp_012345678901234567890123456789012345'),
  });

  const found = kinds(root);
  assert.ok(found.includes('machine-absolute-path'));
  assert.ok(found.includes('possible-secret'));
});

test('rejects duplicate skill names across root and module containers', () => {
  const root = temporaryDirectory();
  addSkill(root, 'demo-sdk-generation');
  makeModule(root, 'apps/demo', ['demo-sdk-generation']);

  assert.ok(kinds(root).includes('duplicate-skill-name'));
});

test('rejects a declared module index that omits a skill', () => {
  const root = temporaryDirectory();
  const moduleRoot = makeModule(root, 'apps/demo', ['demo-sdk-generation']);
  fs.writeFileSync(
    path.join(moduleRoot, 'skills', 'README.md'),
    '# Module Skills\n\nContract: `AGENT_SKILLS_SPEC.md`.\n',
  );

  assert.ok(kinds(root).includes('skill-not-indexed'));
});

test('warns when a module ships skills without declaring the standard', () => {
  const root = temporaryDirectory();
  const moduleRoot = path.join(root, 'packages', 'agent-preset');
  fs.mkdirSync(path.join(moduleRoot, 'skills', 'preset-skill'), { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'package.json'), '{ "name": "agent-preset" }\n');
  fs.writeFileSync(
    path.join(moduleRoot, 'skills', 'preset-skill', 'SKILL.md'),
    skillSource('preset-skill', { sections: '# product preset' }),
  );

  const issues = validateAgentSkills(root);
  assert.equal(issues.filter((entry) => entry.severity === 'error').length, 0);
  assert.ok(issues.some((entry) => entry.kind === 'module-skills-not-declared'));
  assert.ok(!issues.some((entry) => entry.kind === 'missing-section'));
});

test('accepts a host discovery pointer and rejects an orphan', () => {
  const root = temporaryDirectory();
  addSkill(root, 'workspace-audit');
  const hostSkill = path.join(root, '.agents', 'skills', 'workspace-audit');
  fs.mkdirSync(hostSkill, { recursive: true });
  fs.writeFileSync(path.join(hostSkill, 'SKILL.md'), [
    '---',
    'name: workspace-audit',
    'description: Use when testing workspace-audit in order to prove the validator works.',
    '---',
    '',
    'Read `skills/workspace-audit/SKILL.md`.',
    '',
  ].join('\n'));
  assert.deepEqual(validateAgentSkills(root, { checkHostLayer: true }), []);

  const orphan = path.join(root, '.agents', 'skills', 'retired-skill');
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(path.join(orphan, 'SKILL.md'), skillSource('retired-skill'));
  assert.ok(kinds(root, { checkHostLayer: true }).includes('orphan-host-skill'));
});

test('ignores the host discovery layer unless explicitly requested', () => {
  const root = temporaryDirectory();
  const orphan = path.join(root, '.agents', 'skills', 'retired-skill');
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(path.join(orphan, 'SKILL.md'), skillSource('retired-skill'));

  assert.deepEqual(validateAgentSkills(root), []);
});

test('warns when a host entry duplicates the full body', () => {
  const root = temporaryDirectory();
  addSkill(root, 'workspace-audit');
  const hostSkill = path.join(root, '.agents', 'skills', 'workspace-audit');
  fs.mkdirSync(hostSkill, { recursive: true });
  fs.writeFileSync(path.join(hostSkill, 'SKILL.md'), skillSource('workspace-audit'));

  const warnings = validateAgentSkills(root, { checkHostLayer: true })
    .filter((entry) => entry.severity === 'warning');
  assert.ok(warnings.some((entry) => entry.kind === 'host-skill-duplicated-body'));
});

test('rejects forbidden directories inside a skill package', () => {
  const root = temporaryDirectory();
  const directory = addSkill(root, 'workspace-audit');
  fs.mkdirSync(path.join(directory, 'workspace-audit', 'node_modules', 'demo'), { recursive: true });

  assert.ok(kinds(root).includes('forbidden-skill-content'));
});

test('parses flat frontmatter and reports nested syntax', () => {
  const flat = parseSkillFrontmatter([
    '---',
    'name: demo-sdk-generation',
    'description: "Use when a description contains a colon: like this."',
    'owner: demo-team',
    '---',
    '',
    '# Demo',
    '',
  ].join('\n'));
  assert.equal(flat.fields.name, 'demo-sdk-generation');
  assert.equal(flat.fields.description, 'Use when a description contains a colon: like this.');
  assert.deepEqual(flat.errors, []);

  const nested = parseSkillFrontmatter([
    '---',
    'name: demo-sdk-generation',
    'metadata:',
    '  owner: demo-team',
    '---',
    '',
  ].join('\n'));
  assert.ok(nested.errors.includes('non-flat-frontmatter'));
});
