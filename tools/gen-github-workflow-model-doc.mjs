#!/usr/bin/env node

/**
 * Render the normative runtime-target matrix from the workflow model and verify
 * that the specification, the framework, and the model agree.
 *
 * The model (`specs/github-workflow/model.json`) is the single source of truth
 * for the matrix. `GITHUB_WORKFLOW_SPEC.md` carries the generated block between
 * markers; `--write` regenerates it, `--check` fails on drift. The same run
 * compares the framework planner's `PACKAGE_MODE_REQUIREMENTS` against the
 * model, so a framework change that is not reflected in the standard fails here.
 *
 * Usage: node tools/gen-github-workflow-model-doc.mjs [--write|--check] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');
const MODEL_PATH = path.join(ROOT, 'specs', 'github-workflow', 'model.json');
const SPEC_PATH = path.join(ROOT, 'GITHUB_WORKFLOW_SPEC.md');
const FRAMEWORK_PLANNER = path.resolve(ROOT, '..', 'sdkwork-github-workflow', 'scripts', 'agent-workflow.mjs');
const BEGIN = '<!-- BEGIN GENERATED: runtime-target-matrix -->';
const END = '<!-- END GENERATED: runtime-target-matrix -->';

function readModel() {
  return JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
}

/** Render the matrix table the specification publishes. */
function renderMatrix(model) {
  const lines = [
    BEGIN,
    '',
    '| Runtime target | Host platform | Formats | Runner | Toolchains |',
    '|---|---|---|---|---|',
  ];
  for (const target of model.runtimeTargets) {
    lines.push(`| \`${target.id}\` | ${target.platforms.map((p) => `\`${p}\``).join(', ')} | ${target.formats.map((f) => `\`${f}\``).join(', ')} | ${target.runnerPrefixes.map((p) => `${p}*`).join(' / ')} | ${target.toolchains.length === 0 ? '—' : target.toolchains.map((t) => `\`${t}\``).join(', ')} |`);
  }
  lines.push('', END);
  return lines.join('\n');
}

function currentBlock(specText) {
  const start = specText.indexOf(BEGIN);
  const end = specText.indexOf(END);
  if (start < 0 || end < start) return null;
  return specText.slice(start, end + END.length);
}

const parsed = parseArgs({
  options: {
    write: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
});

if (parsed.values.help) {
  console.log('Usage: node tools/gen-github-workflow-model-doc.mjs [--write] [--json]\n\nRegenerates the specification\'s runtime-target matrix from specs/github-workflow/model.json and checks it against the framework planner.');
  process.exit(0);
}

const problems = [];
const model = readModel();
const generated = renderMatrix(model);
const specText = fs.readFileSync(SPEC_PATH, 'utf8');
const existing = currentBlock(specText);
if (existing === null) {
  problems.push('GITHUB_WORKFLOW_SPEC.md is missing the generated runtime-target matrix block markers');
} else if (publishedBlock(existing) !== publishedBlock(generated)) {
  problems.push('GITHUB_WORKFLOW_SPEC.md runtime-target matrix does not match the model');
}

function publishedBlock(block) {
  return block
    .split(/\r?\n/u)
    .filter((line) => !line.includes('<!--') && line.trim() !== '')
    .join('\n');
}

if (fs.existsSync(FRAMEWORK_PLANNER)) {
  const framework = await import(pathToFileURL(FRAMEWORK_PLANNER).href);
  const planner = framework.PACKAGE_MODE_REQUIREMENTS ?? {};
  for (const target of model.runtimeTargets) {
    const row = planner[target.id];
    if (row === undefined) {
      problems.push(`framework planner has no package mode ${target.id}`);
      continue;
    }
    if (row.platforms.join(',') !== target.platforms.join(',')) {
      problems.push(`${target.id}: platform vocabulary differs between model and framework`);
    }
    if (row.formats.join(',') !== target.formats.join(',')) {
      problems.push(`${target.id}: format vocabulary differs between model and framework`);
    }
    if (row.runnerPrefixes.join(',') !== target.runnerPrefixes.join(',')) {
      problems.push(`${target.id}: runner prefixes differ between model and framework`);
    }
  }
  for (const id of Object.keys(planner)) {
    if (!model.runtimeTargets.some((target) => target.id === id)) {
      problems.push(`framework planner declares package mode ${id} that the model does not`);
    }
  }
} else {
  problems.push(`framework planner not found at ${FRAMEWORK_PLANNER}`);
}

if (problems.length === 0 && parsed.values.write) {
  fs.writeFileSync(SPEC_PATH, specText.replace(existing, generated), 'utf8');
  console.log('[github-workflow-model] specification matrix regenerated from the model');
} else if (problems.length === 0) {
  console.log(`[github-workflow-model] ok: ${model.runtimeTargets.length} runtime targets match specification and framework`);
} else if (parsed.values.write && problems.every((problem) => problem.startsWith('GITHUB_WORKFLOW_SPEC.md'))) {
  // A drifted specification block is exactly what --write exists for; a model or
  // framework disagreement is not, because rewriting prose would hide it.
  fs.writeFileSync(SPEC_PATH, specText.replace(existing, generated), 'utf8');
  console.log('[github-workflow-model] specification matrix regenerated from the model');
} else if (parsed.values.write) {
  console.error('[github-workflow-model] cannot regenerate while the model and framework disagree:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.error('[github-workflow-model] drift detected:');
  for (const problem of problems) console.error(`- ${problem}`);
  console.error('Fix the model, the specification, or the framework so all three agree; run with --write only to regenerate the specification block.');
  process.exitCode = 1;
}

if (parsed.values.json) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems, targets: model.runtimeTargets.length }, null, 2));
}
