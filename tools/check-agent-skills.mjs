#!/usr/bin/env node

import path from 'node:path';

import { summarizeIssues, validateAgentSkills } from './lib/agent-skills.mjs';
import { listWorkspaceRepositoryRoots } from './lib/workspace-layout.mjs';

function parseArgs(argv) {
  const args = { scope: 'root', target: process.cwd(), json: false, strict: false, hostLayer: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      args.scope = 'root';
      args.target = path.resolve(argv[++index]);
    } else if (arg === '--workspace') {
      args.scope = 'workspace';
      args.target = path.resolve(argv[++index]);
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--host-layer') {
      args.hostLayer = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      args.unknown = arg;
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node tools/check-agent-skills.mjs --root <repository-root>',
    '  node tools/check-agent-skills.mjs --workspace <workspace-root>',
    '',
    'Options:',
    '  --json         print errors and warnings as JSON',
    '  --host-layer   also validate .agents/skills, agent/skills, and .claude/skills pointers',
    '  --strict       treat warnings as errors; use after a migration window closes',
    '',
    'Validates AGENT_SKILLS_SPEC.md for every module skills/ container, including',
    'the repository/application root, and reports the retired .sdkwork/skills/',
    'location. Exit code 1 means at least one error; warnings alone exit 0.',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.unknown) {
    console.error(`check-agent-skills: unknown argument ${args.unknown}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const roots = args.scope === 'workspace'
    ? listWorkspaceRepositoryRoots(args.target)
    : [args.target];

  if (roots.length === 0) {
    console.error(`agent skills failed: no repository roots under ${args.target}`);
    process.exitCode = 1;
    return;
  }

  const results = roots.map((root) => {
    const issues = validateAgentSkills(root, { checkHostLayer: args.hostLayer });
    return { repository: path.basename(root), root, ...summarizeIssues(issues) };
  });
  const errors = results.flatMap((result) => result.errors.map((entry) => ({ ...entry, repository: result.repository })));
  let warnings = results.flatMap((result) => result.warnings.map((entry) => ({ ...entry, repository: result.repository })));
  if (args.strict && warnings.length > 0) {
    errors.push(...warnings);
    warnings = [];
  }

  if (args.json) {
    console.log(JSON.stringify({
      roots: roots.map((root) => path.basename(root)),
      errors,
      warnings,
    }, null, 2));
  } else {
    if (errors.length > 0) {
      console.error(`agent skills failed (${errors.length} error(s), ${warnings.length} warning(s)):`);
      for (const entry of errors) {
        console.error(`- [${entry.repository}] ${entry.kind}: ${entry.path} - ${entry.detail}`);
      }
    } else {
      console.log(`agent skills passed (${roots.length} root(s))`);
    }
    for (const entry of warnings) {
      console.warn(`warning [${entry.repository}] ${entry.kind}: ${entry.path} - ${entry.detail}`);
    }
  }

  if (errors.length > 0) process.exitCode = 1;
}

main();
