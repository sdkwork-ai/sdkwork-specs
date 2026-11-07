#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';

const REQUIRED_AGENT_SECTIONS = [
  'SDKWORK Soul',
  'SDKWORK Standards',
  'Application Identity',
  'Local Dictionary Structure',
  'Spec Resolution Order',
  'Required Specs By Task Type',
  'Code Style Rules',
  'Build, Test, and Verification',
  'Agent Execution Rules',
  'Human Review Rules',
];

const SPEC_REFERENCES = [
  'sdkwork-specs/README.md',
  'sdkwork-specs/SOUL.md',
  'sdkwork-specs/AGENTS_SPEC.md',
];

const LANGUAGE_SPEC_REFERENCES = [
  'RUST_CODE_SPEC.md',
  'JAVA_CODE_SPEC.md',
  'TYPESCRIPT_CODE_SPEC.md',
  'FRONTEND_CODE_SPEC.md',
];

const SHIM_FILES = ['CLAUDE.md', 'GEMINI.md', 'CODEX.md', 'agent.md', 'AGENT.md', 'agents.md'];
const IGNORED_DIRS = new Set([
  '.git',
  '.pnpm',
  '.vite',
  '.tmp',
  'node_modules',
  'target',
  'dist',
  'generated',
  'artifacts',
]);
const FORBIDDEN_PACKAGE_WORKFLOW_NAMES = new Set([
  'release-package.yml',
  'release-package.yaml',
  'package-release.yml',
  'package-release.yaml',
]);

// Reusable workflow entrypoints. Every application repository calls exactly these
// two framework workflows; a repository never re-implements their jobs.
const FRAMEWORK_REPOSITORY = 'sdkwork-ai/sdkwork-github-workflow';
const REUSABLE_PACKAGE_WORKFLOW = 'sdkwork-package.yml';
const REUSABLE_CI_WORKFLOW = 'sdkwork-ci.yml';
// Rust-only repositories have no package scripts, so their verification
// entrypoint calls the framework's Rust workflow instead. Both are thin callers
// of the same framework and the same `config_path` contract.
const REUSABLE_CI_RUST_WORKFLOW = 'sdkwork-ci-rust.yml';
// `v1`, `v1.2.3`, or a 40-character commit SHA. Branch names and moving aliases
// are rejected: a pipeline must name the framework revision it ran.
const PINNED_REF_PATTERN = /^(?:v?\d+(?:\.\d+){0,2}(?:[-+][A-Za-z0-9.-]+)?|[0-9a-f]{40})$/iu;
// Toolchain selectors are channels, not action versions: `dtolnay/rust-toolchain`
// installs whichever Rust release the repository pins in `rust-toolchain.toml`
// or its `toolchain:` input, so `@stable`, `@beta`, and `@nightly` are the
// action's intended refs. Every other action must name a version or commit.
const TOOLCHAIN_CHANNEL_REFERENCES = new Set([
  'dtolnay/rust-toolchain@stable',
  'dtolnay/rust-toolchain@beta',
  'dtolnay/rust-toolchain@nightly',
]);
// Repository roles that decide which entrypoints the standard requires.
const WORKFLOW_ROLES = new Set(['application', 'ci-only', 'fork-upstream', 'third-party', 'framework']);
// Verification entrypoint inputs the framework's `sdkwork-ci.yml` declares. A
// caller selects filters here instead of adding local steps.
const VERIFICATION_INPUTS = new Set([
  'config_path',
  'scripts',
  'install_command',
  'os_matrix',
  'framework_ref',
  'dependency_refs_json',
  'timeout_minutes',
]);
const VERIFICATION_LOCAL_STEP_PATTERN = /runs-on\s*:|\bsteps\s*:|\bstrategy\s*:|\bmatrix\s*:|actions\/checkout@|pnpm\/action-setup@|actions\/setup-node@|^\s{6,}run\s*:/imu;
const DEPLOYMENT_PROFILES = new Set(['standalone', 'cloud']);
const RUNTIME_TARGETS = new Set([
  'browser',
  'desktop',
  'tablet-ipados',
  'tablet-android',
  'capacitor-ios',
  'capacitor-android',
  'flutter-ios',
  'flutter-android',
  'android-native',
  'ios-native',
  'harmony-native',
  'mini-program',
  'server',
  'container',
  'test-runner',
]);
const CLIENT_RUNTIME_TARGETS = new Set([
  'browser', 'desktop', 'tablet-ipados', 'tablet-android',
  'capacitor-ios', 'capacitor-android', 'flutter-ios', 'flutter-android',
  'android-native', 'ios-native', 'harmony-native', 'mini-program',
]);
const PACKAGE_PROFILES = new Set([
  'browser',
  'desktop',
  'mobile',
  'tablet',
  'mini-program',
  'server',
  'container',
  'worker',
  'library',
  'test',
]);

function usage() {
  return [
    'Usage:',
    '  node tools/check-agent-workflow-standard.mjs --root <repo> [--entrypoints]',
    '  node tools/check-agent-workflow-standard.mjs --workspace-root <parent> [--report] [--json]',
    '',
    'Validates SDKWork AGENTS.md and the reusable GitHub workflow entrypoints:',
    '  package.yml      thin sdkwork-package.yml caller, pinned framework ref',
    '  verify.yml       thin sdkwork-ci.yml caller, pinned framework ref',
    '  references       every action and reusable workflow pinned to a version or SHA',
    '  matrix jobs      each lane named from its matrix entry',
    '',
    '--entrypoints  require verify.yml even when the repository declares no package contract.',
    '--report       audit mode: print every violation and exit 0 (workspace audits use this).',
  ].join('\n');
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function repositoryKind(root) {
  const readmePath = path.join(root, 'README.md');
  if (!fs.existsSync(readmePath)) {
    return 'application';
  }
  const match = readText(readmePath).match(/^repository-kind:\s*([a-z0-9-]+)\s*$/imu);
  return match?.[1] || 'application';
}

function fail(message, details = []) {
  console.error(`agent/workflow standard failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function toPosix(filePath) {
  return filePath.replaceAll(path.sep, '/');
}

function relative(root, filePath) {
  return toPosix(path.relative(root, filePath)) || path.basename(filePath);
}

function hasHeading(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^##\\s+${escaped}\\s*$`, 'imu').test(text);
}

// Repository .gitignore excludes scratch directories whose name starts with
// `target-` (temporary app/agent test fixtures). Those directories are not
// repository roots and must never be validated for an AGENTS.md entrypoint;
// walking them produces phantom violations that no change can resolve.
function isIgnoredDirectoryName(name) {
  return IGNORED_DIRS.has(name) || name.startsWith('target-');
}

function walkFiles(root, predicate) {
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName(entry.name)) continue;
        walk(entryPath);
        continue;
      }
      if (predicate(entryPath, entry.name)) {
        files.push(entryPath);
      }
    }
  }

  walk(root);
  return files;
}

function collectApplicationRoots(root) {
  const roots = new Set([root]);
  for (const manifestPath of walkFiles(root, (_file, name) => name === 'agent.app.config.json')) {
    const posixPath = toPosix(manifestPath);
    // Generated SDK output and ephemeral build staging (e.g. docker
    // build-context staging under .sdkwork/runtime/) are not application roots.
    if (posixPath.includes('/generated/')) continue;
    if (posixPath.includes('/.sdkwork/runtime/')) continue;
    roots.add(path.dirname(manifestPath));
  }
  return [...roots].sort();
}

function resolveReferencedSpecs(agentDir, text) {
  const resolved = new Map();
  const relativePathPattern = /[`'"]((?:\.\.\/)+sdkwork-specs\/(?:README\.md|SOUL\.md|AGENTS_SPEC\.md))[`'"]/giu;
  let match;
  while ((match = relativePathPattern.exec(text)) !== null) {
    const normalized = match[1].replaceAll('/', path.sep);
    resolved.set(toPosix(match[1]), path.resolve(agentDir, normalized));
  }
  return resolved;
}

function validateAgents(root) {
  const issues = [];
  const agentRoots = collectApplicationRoots(root);
  let shimCount = 0;

  for (const agentRoot of agentRoots) {
    const agentPath = path.join(agentRoot, 'AGENTS.md');
    const label = relative(root, agentPath);

    if (!fs.existsSync(agentPath)) {
      issues.push(`${label} must exist at repository/application root`);
      continue;
    }

    const text = readText(agentPath);
    for (const section of REQUIRED_AGENT_SECTIONS) {
      if (!hasHeading(text, section)) {
        issues.push(`${label} missing required section "${section}"`);
      }
    }

    for (const specRef of SPEC_REFERENCES) {
      if (!text.includes(specRef)) {
        issues.push(`${label} must reference ${specRef} by relative path`);
      }
    }

    const referencedSpecs = resolveReferencedSpecs(agentRoot, text);
    for (const specRef of ['README.md', 'SOUL.md', 'AGENTS_SPEC.md']) {
      const refEntry = [...referencedSpecs.entries()].find(([key]) => key.endsWith(`sdkwork-specs/${specRef}`));
      if (!refEntry) {
        issues.push(`${label} must include a relative path to sdkwork-specs/${specRef}`);
        continue;
      }
      if (!fs.existsSync(refEntry[1])) {
        issues.push(`${label} relative path does not resolve: ${refEntry[0]}`);
      }
    }

    if (/##\s+Existing Local Guidance\b/iu.test(text)) {
      issues.push(`${label} must not retain "Existing Local Guidance"; move durable rules into local specs or link root standards`);
    }
    if (!/(dynamic|动态)[\s\S]{0,80}(progressive|渐进)|(progressive|渐进)[\s\S]{0,80}(loading|加载)/iu.test(text)) {
      issues.push(`${label} must describe dynamic progressive loading before implementation files`);
    }
    if (!/on-demand|按需|only the touched language|language-specific specs are on-demand|language specs are on-demand/iu.test(text)) {
      issues.push(`${label} must require language-specific specs to load on demand only`);
    }
    if (!text.includes('PNPM_SCRIPT_SPEC.md')) {
      issues.push(`${label} must reference PNPM_SCRIPT_SPEC.md for command standardization`);
    }
    if (!text.includes('GITHUB_WORKFLOW_SPEC.md')) {
      issues.push(`${label} must reference GITHUB_WORKFLOW_SPEC.md for packaging workflow changes`);
    }
    if (!/PAGINATION_SPEC\.md/u.test(text)) {
      issues.push(`${label} must reference PAGINATION_SPEC.md for list/search pagination work`);
    }
    if (!/check-pagination\.mjs/u.test(text)) {
      issues.push(`${label} must reference check-pagination.mjs verification for list/search pagination work`);
    }
    if (fs.existsSync(path.join(agentRoot, 'etc'))) {
      if (!text.includes('SOURCE_CONFIG_SPEC.md')) {
        issues.push(`${label} must reference SOURCE_CONFIG_SPEC.md when the root owns etc/`);
      }
      if (!text.includes('`etc/`')) {
        issues.push(`${label} must identify etc/ as deployable-root source configuration`);
      }
    }
    for (const duplicatedHeading of [
      'App SDK Consumer Imports',
      'HTTP API Response Envelope',
      'List And Search Pagination',
    ]) {
      // AGENTS_SPEC.md mandates these canonical sections; only a DUPLICATED
      // section (a stale re-insert next to the managed block) is a violation.
      const headingPattern = new RegExp(
        `^##\\s+${duplicatedHeading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*$`,
        'gimu',
      );
      const headingOccurrences = Array.from(text.matchAll(headingPattern)).length;
      if (headingOccurrences > 1) {
        issues.push(`${label} must route ${duplicatedHeading} work to global specs instead of copying the normative body`);
      }
    }
    if (LANGUAGE_SPEC_REFERENCES.every((spec) => !text.includes(spec))) {
      issues.push(`${label} must map at least one language-specific spec and state it is loaded on demand`);
    }

    const actualShimNames = fs
      .readdirSync(agentRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== 'AGENTS.md' && SHIM_FILES.includes(entry.name))
      .map((entry) => entry.name);

    for (const shimName of actualShimNames) {
      const shimPath = path.join(agentRoot, shimName);
      shimCount += 1;
      const shimText = readText(shimPath);
      const shimLabel = relative(root, shimPath);
      if (!shimText.includes('AGENTS.md')) {
        issues.push(`${shimLabel} must point to AGENTS.md`);
      }
      if (!shimText.includes('sdkwork-specs/README.md') && !shimText.includes('sdkwork-specs/SOUL.md')) {
        issues.push(`${shimLabel} must cite the relative sdkwork-specs path`);
      }
      if (/##\s+Build, Test, and Verification\b/iu.test(shimText) || /##\s+Required Specs By Task Type\b/iu.test(shimText)) {
        issues.push(`${shimLabel} must remain a shim and not duplicate AGENTS.md sections`);
      }
    }
  }

  if (issues.length > 0) {
    fail('AGENTS.md entrypoints are not compliant', issues);
  }

  return { agentRootCount: agentRoots.length, shimCount };
}

function getWorkflowFiles(root) {
  const workflowsDir = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(workflowsDir)) return [];
  return fs
    .readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => path.join(workflowsDir, name));
}

function dependencyRefInputName(refInput) {
  return refInput.toLowerCase();
}

function collectDependencyRefInputs(workflow) {
  const refInputs = new Set();
  for (const collectionName of ['dependencies', 'verificationDependencies']) {
    const entries = workflow?.[collectionName];
    if (!Array.isArray(entries)) continue;
    for (const [index, entry] of entries.entries()) {
      if (typeof entry?.refInput !== 'string' || entry.refInput.trim() === '') continue;
      refInputs.add({
        pointer: `${collectionName}.${index}.refInput`,
        value: entry.refInput,
        inputName: dependencyRefInputName(entry.refInput),
      });
    }
  }
  return [...refInputs].sort((left, right) => left.value.localeCompare(right.value));
}

function validatePackageWorkflow(root) {
  const issues = [];
  const workflowConfigPath = path.join(root, 'agent.workflow.json');
  const packageWorkflowPath = path.join(root, '.github', 'workflows', 'package.yml');
  const workflowFiles = getWorkflowFiles(root);
  const packageWorkflowText = fs.existsSync(packageWorkflowPath) ? readText(packageWorkflowPath) : '';

  if (!fs.existsSync(workflowConfigPath)) {
    issues.push('agent.workflow.json must exist for SDKWork packaging workflow integration');
  }
  if (!fs.existsSync(packageWorkflowPath)) {
    issues.push('.github/workflows/package.yml must exist as the thin packaging workflow entrypoint');
  }

  for (const workflowPath of workflowFiles) {
    const name = path.basename(workflowPath);
    const text = readText(workflowPath);
    if (FORBIDDEN_PACKAGE_WORKFLOW_NAMES.has(name)) {
      issues.push(`${relative(root, workflowPath)} copied packaging workflow is forbidden; use .github/workflows/package.yml`);
    }
    if (
      workflowPath !== packageWorkflowPath
      && /gh\s+release\s+upload|softprops\/action-gh-release|actions\/attest-build-provenance|download-artifact|dependency_refs_json|sdkwork-package\.yml/iu.test(text)
    ) {
      issues.push(`${relative(root, workflowPath)} appears to copy packaging/release framework logic`);
    }
  }

  if (fs.existsSync(packageWorkflowPath)) {
    const workflowText = packageWorkflowText;
    const packageLabel = relative(root, packageWorkflowPath);
    const reusableMatch = workflowText.match(
      /uses:\s*sdkwork-ai\/sdkwork-github-workflow\/\.github\/workflows\/sdkwork-package\.yml@([^\s]+)/u,
    );
    if (!reusableMatch) {
      issues.push(`${packageLabel} must call the SDKWork reusable package workflow`);
    } else if (!PINNED_REF_PATTERN.test(reusableMatch[1])) {
      issues.push(`${packageLabel} must use a pinned sdkwork-github-workflow ref, not "${reusableMatch[1]}"`);
    }
    if (!/config_path:\s*agent\.workflow\.json/u.test(workflowText)) {
      issues.push(`${packageLabel} must pass config_path: agent.workflow.json`);
    }
    if (/runs-on:\s|steps:\s|actions\/checkout|gh\s+release\s+|npm\s+test|pnpm\s+verify/iu.test(workflowText)) {
      issues.push(`${packageLabel} must stay thin and must not copy local job steps`);
    }
    for (const inputName of ['tag', 'package_version', 'platform', 'architecture', 'profile', 'format']) {
      if (!workflowText.includes(inputName)) {
        issues.push(`${packageLabel} should expose workflow_dispatch input ${inputName}`);
      }
    }
  }

  if (fs.existsSync(workflowConfigPath)) {
    const workflow = readJson(workflowConfigPath);
    if (!workflow.schemaVersion) {
      issues.push('agent.workflow.json must declare schemaVersion');
    }
    if (!workflow.app?.id) {
      issues.push('agent.workflow.json must declare app.id');
    }
    if (!workflow.release?.artifactPrefix) {
      issues.push('agent.workflow.json must declare release.artifactPrefix');
    }
    if (!Array.isArray(workflow.targets) || workflow.targets.length === 0) {
      issues.push('agent.workflow.json must declare at least one target');
    } else {
      const targetIds = new Set();
      for (const [index, target] of workflow.targets.entries()) {
        const pointer = `targets.${index}`;
        if (!target.id) issues.push(`${pointer} must declare id`);
        if (target.id && targetIds.has(target.id)) issues.push(`${pointer} duplicates target id ${target.id}`);
        if (target.id) targetIds.add(target.id);
        const profileBinding = target.profileBinding
          ?? (target.deploymentProfile ? 'fixed' : undefined);
        if (profileBinding === 'fixed') {
          if (!DEPLOYMENT_PROFILES.has(target.deploymentProfile)) {
            issues.push(`${pointer} fixed binding must declare deploymentProfile as standalone or cloud`);
          }
          if (target.supportedDeploymentProfiles !== undefined) {
            issues.push(`${pointer} fixed binding forbids supportedDeploymentProfiles`);
          }
        } else if (profileBinding === 'runtime-configurable') {
          const supported = target.supportedDeploymentProfiles;
          if (!CLIENT_RUNTIME_TARGETS.has(target.runtimeTarget)) {
            issues.push(`${pointer} runtime-configurable binding is limited to client targets`);
          }
          if (target.deploymentProfile !== undefined) {
            issues.push(`${pointer} runtime-configurable binding forbids deploymentProfile`);
          }
          if (!Array.isArray(supported) || supported.length !== 2
            || new Set(supported).size !== supported.length
            || supported.some((profile) => !DEPLOYMENT_PROFILES.has(profile))) {
            issues.push(`${pointer} must declare valid unique supportedDeploymentProfiles`);
          }
          if (!supported?.includes(target.defaultDeploymentProfile)) {
            issues.push(`${pointer} defaultDeploymentProfile must be supported`);
          }
          if (!String(target.id ?? '').split('-').includes('dual')) {
            issues.push(`${pointer} runtime-configurable id must include dual`);
          }
        } else {
          issues.push(`${pointer} must declare profileBinding as fixed or runtime-configurable`);
        }
        if (!RUNTIME_TARGETS.has(target.runtimeTarget)) {
          issues.push(`${pointer} must declare runtimeTarget from CONFIG_SPEC.md`);
        }
        if (!PACKAGE_PROFILES.has(target.profile)) {
          issues.push(`${pointer} must declare a valid package profile`);
        }
        if (['standalone', 'cloud', 'web', 'docker'].includes(target.profile)) {
          issues.push(`${pointer} profile must not be deployment profile or runtime ecosystem alias`);
        }
        if (!target.platform) issues.push(`${pointer} must declare platform`);
        if (!target.architecture) issues.push(`${pointer} must declare architecture`);
        if (!Array.isArray(target.formats) || target.formats.length === 0) {
          issues.push(`${pointer} must declare non-empty formats`);
        } else if (new Set(target.formats).size !== target.formats.length) {
          issues.push(`${pointer} must not declare duplicate formats`);
        }
        if (!target.runner) issues.push(`${pointer} must declare runner`);
        if (!Array.isArray(target.outputGlobs) || target.outputGlobs.length === 0) {
          issues.push(`${pointer} must declare outputGlobs`);
        }
      }
    }

    if (fs.existsSync(packageWorkflowPath)) {
      const packageLabel = relative(root, packageWorkflowPath);
      // The dispatch-input budget is shared across every dependency (GitHub
      // rejects a workflow above 25 workflow_dispatch inputs), so only a
      // dependency pinned to a fixed ref (`entry.ref`) gets an override input;
      // unpinned dependencies resolve through their repository variable
      // (`vars.<REF_INPUT>`), mirroring
      // check-github-workflow-integration.mjs.
      const pinnedRefInputs = new Set();
      for (const collectionName of ['dependencies', 'verificationDependencies']) {
        const entries = workflow?.[collectionName];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (
            typeof entry?.refInput === 'string'
            && entry.refInput.trim() !== ''
            && typeof entry?.ref === 'string'
            && entry.ref.trim() !== ''
          ) {
            pinnedRefInputs.add(entry.refInput);
          }
        }
      }
      for (const refInput of collectDependencyRefInputs(workflow)) {
        const pinned = pinnedRefInputs.has(refInput.value);
        if (pinned) {
          const inputPattern = new RegExp(`^\\s{6}${refInput.inputName}:\\s*$`, 'mu');
          if (!inputPattern.test(packageWorkflowText)) {
            issues.push(
              `${packageLabel} must expose workflow_dispatch input ${refInput.inputName} for ${refInput.pointer} ${refInput.value}`,
            );
          }
          if (!packageWorkflowText.includes(`github.event.inputs.${refInput.inputName}`)) {
            issues.push(
              `${packageLabel} dependency_refs_json must read github.event.inputs.${refInput.inputName} for ${refInput.value}`,
            );
          }
        }
        if (!packageWorkflowText.includes('dependency_refs_json')) {
          issues.push(`${packageLabel} must pass dependency_refs_json when dependency refInput values are declared`);
        } else if (!packageWorkflowText.includes(`"${refInput.value}"`)) {
          issues.push(
            `${packageLabel} dependency_refs_json must pass ${refInput.value} from github.event.inputs.${refInput.inputName} or vars.${refInput.value}`,
          );
        } else if (!packageWorkflowText.includes(`vars.${refInput.value}`)) {
          issues.push(
            `${packageLabel} dependency_refs_json must fall back to vars.${refInput.value} for ${refInput.value}`,
          );
        }
      }
    }
  }

  return issues;
}

/**
 * Resolve the repository's role in the workflow system.
 *
 * `agent.workflow.json` owns the declaration; the framework repository is
 * detected structurally because it publishes the reusable workflows themselves.
 * @param {string} root - Repository root.
 * @returns {string} Declared or detected role.
 */
function readWorkflowRole(root) {
  const configPath = path.join(root, 'agent.workflow.json');
  if (fs.existsSync(configPath)) {
    const config = readJson(configPath);
    if (typeof config.workflowRole === 'string' && config.workflowRole.trim() !== '') {
      return config.workflowRole.trim();
    }
    // A configuration that declares no package target has nothing to package:
    // its only workflow contract is the verification entrypoint.
    if (!Array.isArray(config.targets) || config.targets.length === 0) {
      return 'ci-only';
    }
  }
  const workflowsDir = path.join(root, '.github', 'workflows');
  const publishesFramework = fs.existsSync(path.join(workflowsDir, REUSABLE_PACKAGE_WORKFLOW))
    || fs.existsSync(path.join(workflowsDir, REUSABLE_CI_WORKFLOW));
  if (publishesFramework) return 'framework';
  // A library family that declares no package contract only owns verification;
  // the packaging contract stays with the applications that consume it.
  const kind = repositoryKind(root);
  const hasPackageContract = fs.existsSync(path.join(root, 'agent.workflow.json'))
    || fs.existsSync(path.join(workflowsDir, 'package.yml'));
  if (!hasPackageContract && (kind === 'foundation-dependency' || kind === 'shared-package-family')) {
    return 'ci-only';
  }
  return 'application';
}

/**
 * Return the `with:` input names one reusable workflow call passes.
 * @param {string} text - Workflow YAML.
 * @returns {Set<string>} Declared input names.
 */
function reusableInputNames(text) {
  const names = new Set();
  const block = /^ {6}with:\s*$\n((?: {8,}.*\n)+)/mu.exec(text);
  if (!block) return names;
  for (const line of block[1].split(/\r?\n/u)) {
    const name = /^ {8}([A-Za-z0-9_-]+):/u.exec(line)?.[1];
    if (name) names.add(name);
  }
  return names;
}

/**
 * Split a workflow's `jobs:` mapping into per-job text blocks.
 * @param {string} text - Workflow YAML.
 * @returns {Array<{ id: string, text: string }>} Job id and body, in file order.
 */
function jobBlocks(text) {
  const lines = text.split(/\r?\n/u);
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/u.test(line));
  if (jobsIndex < 0) return [];
  const blocks = [];
  let current = null;
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const jobMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(lines[index]);
    if (jobMatch) {
      current = { id: jobMatch[1], text: '' };
      blocks.push(current);
      continue;
    }
    if (current) current.text += `${lines[index]}\n`;
  }
  return blocks;
}

/**
 * Validate one repository's verification entrypoint.
 *
 * The verification entrypoint is the second half of the same contract the
 * packaging entrypoint follows: triggers and a gate list only, with runner
 * setup, dependency checkout, toolchain versions, and install owned by the
 * reusable workflow and `agent.workflow.json`.
 * @param {string} root - Repository root.
 * @returns {string[]} Violations.
 */
function validateVerificationWorkflow(root) {
  const issues = [];
  const verifyPath = path.join(root, '.github', 'workflows', 'verify.yml');
  const label = '.github/workflows/verify.yml';
  if (!fs.existsSync(verifyPath)) {
    return [`${label} must exist as the thin verification workflow entrypoint`];
  }
  const text = readText(verifyPath);
  const call = new RegExp(
    `uses:\\s*${FRAMEWORK_REPOSITORY.replaceAll('/', '\\/')}\\/\\.github\\/workflows\\/(${REUSABLE_CI_WORKFLOW}|${REUSABLE_CI_RUST_WORKFLOW})@([^\\s]+)`,
    'u',
  ).exec(text);
  if (!call) {
    issues.push(`${label} must call ${FRAMEWORK_REPOSITORY}/.github/workflows/${REUSABLE_CI_WORKFLOW} (or ${REUSABLE_CI_RUST_WORKFLOW} for a Rust-only repository)`);
  } else if (!PINNED_REF_PATTERN.test(call[2])) {
    issues.push(`${label} must use a pinned ${call[1]} ref, not "${call[2]}"`);
  }
  if (!/config_path:\s*agent\.workflow\.json/u.test(text)) {
    issues.push(`${label} must pass config_path: agent.workflow.json`);
  }
  if (VERIFICATION_LOCAL_STEP_PATTERN.test(text)) {
    issues.push(`${label} must stay thin: runner setup, install, and gate commands belong to the reusable workflow`);
  }
  for (const inputName of reusableInputNames(text)) {
    if (!VERIFICATION_INPUTS.has(inputName)) {
      issues.push(`${label} passes unknown verification input ${inputName}`);
    }
  }
  return issues;
}

/**
 * Require every remote action and reusable workflow reference to name a pinned
 * revision, so a pipeline cannot change under an unrelated push.
 * @param {string} root - Repository root.
 * @param {string[]} workflowFiles - Workflow files to scan.
 * @returns {string[]} Violations.
 */
function validatePinnedReferences(root, workflowFiles) {
  const issues = [];
  for (const workflowPath of workflowFiles) {
    const label = relative(root, workflowPath);
    const text = readText(workflowPath);
    // Definitions-from-base is the one sanctioned moving ref: a
    // `pull_request_target` workflow must run its checks from the trusted
    // default branch, not from the pull request head. Every other moving ref
    // makes the pipeline's behavior depend on someone else's next commit.
    const definitionsFromBase = /^\s{0,4}pull_request_target:/mu.test(text);
    for (const match of text.matchAll(/uses:\s*([^\s#]+)/gu)) {
      const reference = match[1];
      if (reference.startsWith('./') || reference.startsWith('docker://')) continue;
      if (TOOLCHAIN_CHANNEL_REFERENCES.has(reference)) continue;
      const at = reference.lastIndexOf('@');
      if (at < 0) {
        issues.push(`${label} references ${reference} without a pinned revision`);
        continue;
      }
      const revision = reference.slice(at + 1);
      if (!PINNED_REF_PATTERN.test(revision) && !definitionsFromBase) {
        issues.push(`${label} references ${reference} with a moving revision; pin a version or commit SHA`);
      }
    }
  }
  return issues;
}

/**
 * Require matrix fan-out to be attributable: a job whose failure is reported by
 * matrix index alone cannot be identified, retried, or reasoned about.
 * @param {string} root - Repository root.
 * @param {string[]} workflowFiles - Workflow files to scan.
 * @returns {string[]} Violations.
 */
function validateLaneAttribution(root, workflowFiles) {
  const issues = [];
  for (const workflowPath of workflowFiles) {
    const label = relative(root, workflowPath);
    for (const job of jobBlocks(readText(workflowPath))) {
      if (!/^\s+matrix:/mu.test(job.text)) continue;
      // A planner-provided matrix (`matrix: ${{ ... }}`) is named by the planner
      // that builds its entries; a static matrix has no such owner.
      if (/^\s+matrix:\s*\$\{\{/mu.test(job.text)) continue;
      if (!/^\s+name:.*matrix\./mu.test(job.text)) {
        issues.push(`${label} job "${job.id}" fans out through a matrix without naming the lane from it`);
      }
    }
  }
  return issues;
}

/**
 * Validate the whole workflow contract of one repository for its declared role.
 * @param {string} root - Repository root.
 * @param {{ entrypoints?: boolean }} [options] - Whether the reusable-entrypoint contract applies without a package contract.
 * @returns {{ role: string, roleIssue: string|null, package: string[], verification: string[], pins: string[], lanes: string[] }} Repository result.
 */
function validateRepositoryWorkflows(root, options = {}) {
  const role = readWorkflowRole(root);
  const workflowFiles = getWorkflowFiles(root);
  const entrypoints = options.entrypoints === true;
  const kind = repositoryKind(root);
  const hasPackageContract = fs.existsSync(path.join(root, 'agent.workflow.json'))
    || fs.existsSync(path.join(root, '.github', 'workflows', 'package.yml'));

  const result = { role, roleIssue: null, package: [], verification: [], pins: [], lanes: [] };
  if (!WORKFLOW_ROLES.has(role)) {
    result.roleIssue = `agent.workflow.json workflowRole "${role}" must be one of ${[...WORKFLOW_ROLES].join(', ')}`;
  }
  if (kind === 'standards') {
    result.pins = validatePinnedReferences(root, workflowFiles);
    return result;
  }
  if (role === 'framework' || role === 'fork-upstream' || role === 'third-party') {
    // The framework owns the reusable workflows, and a fork mirrors an upstream
    // project's job graph — including its action pins, which this repository
    // does not own. Fork-added workflows are reviewed against §2.2 instead.
    if (role === 'framework') {
      result.pins = validatePinnedReferences(root, workflowFiles);
    }
    return result;
  }

  for (const workflowPath of workflowFiles) {
    if (FORBIDDEN_PACKAGE_WORKFLOW_NAMES.has(path.basename(workflowPath))) {
      result.package.push(`${relative(root, workflowPath)} copied packaging workflow is forbidden; use .github/workflows/package.yml`);
    }
  }
  if (role === 'application') {
    result.package.push(...validatePackageWorkflow(root));
  }
  result.pins = validatePinnedReferences(root, workflowFiles);
  result.lanes = validateLaneAttribution(root, workflowFiles);
  if (role === 'ci-only' || entrypoints || hasPackageContract) {
    result.verification = validateVerificationWorkflow(root);
  }
  return result;
}

/**
 * Validate one repository's application configuration with the framework planner.
 *
 * The planner is the authority for `agent.workflow.json`; the audit only records
 * whether the repository can package at all, so an aligned workflow over a
 * placeholder configuration is never reported as release-ready.
 * @param {string} root - Repository root.
 * @returns {{ valid: boolean, issues: number, firstIssue: string|null } | null} Result, or null when the repository declares no config or the framework is absent.
 */
function validateApplicationConfig(root) {
  const configPath = path.join(root, 'agent.workflow.json');
  if (!fs.existsSync(configPath)) return null;
  const planner = path.resolve(import.meta.dirname, '..', '..', 'sdkwork-github-workflow', 'scripts', 'agent-workflow.mjs');
  if (!fs.existsSync(planner)) return null;
  try {
    execFileSync(process.execPath, [planner, 'validate', '--config', configPath], { stdio: 'pipe' });
    return { valid: true, issues: 0, firstIssue: null };
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    const issues = text.split(/\r?\n/u)
      .filter((line) => /\] {3}/u.test(line))
      .map((line) => line.replace(/^.*?\] {3}/u, '').trim());
    // The first issue is the one the owner acts on; later issues usually cascade
    // from a missing or placeholder declaration.
    return { valid: false, issues: issues.length, firstIssue: issues[0] ?? null };
  }
}

/** Fields an exception register entry must carry before it can defer anything. */
const REQUIRED_EXCEPTION_FIELDS = ['reason', 'ownerAction', 'owner', 'issue', 'expiresAt'];

/**
 * Remaining days before an exception expires; negative when overdue.
 * @param {{ expiresAt?: unknown }} entry - Register entry.
 * @param {number} now - Current epoch milliseconds.
 * @returns {number|null} Days left, or null when the date is not a valid ISO date.
 */
function exceptionDaysLeft(entry, now) {
  const expiresAt = typeof entry.expiresAt === 'string' ? Date.parse(`${entry.expiresAt}T23:59:59Z`) : Number.NaN;
  if (Number.isNaN(expiresAt)) return null;
  return Math.ceil((expiresAt - now) / 86_400_000);
}

/**
 * Validate one register entry. An exception is debt with a due date: it may defer
 * findings only while it is complete and unexpired.
 * @param {object} entry - Register entry.
 * @param {number} now - Current epoch milliseconds.
 * @returns {string[]} Violations that count against conformance.
 */
function validateExceptionEntry(entry, now) {
  const issues = [];
  for (const field of REQUIRED_EXCEPTION_FIELDS) {
    if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') {
      issues.push(`exception register entry ${entry?.issue ?? entry?.repository} is missing ${field}`);
    }
  }
  const daysLeft = exceptionDaysLeft(entry, now);
  if (daysLeft === null) {
    issues.push(`exception register entry ${entry.issue} has an invalid expiresAt (expected YYYY-MM-DD)`);
  } else if (daysLeft < 0) {
    issues.push(`exception register entry ${entry.issue} expired ${Math.abs(daysLeft)} day(s) ago; clear the debt or re-justify the entry`);
  }
  return issues;
}

/**
 * Flatten one repository result into the issues a report or gate prints.
 * @param {{ roleIssue: string|null, package: string[], verification: string[], pins: string[], lanes: string[] }} result - Repository result.
 * @returns {string[]} Violations in report order.
 */
function reportRepository(result) {
  return [
    ...(result.roleIssue === null ? [] : [result.roleIssue]),
    ...result.package,
    ...result.verification,
    ...result.pins,
    ...result.lanes,
  ];
}

const parsed = parseArgs({
  options: {
    root: { type: 'string' },
    'workspace-root': { type: 'string' },
    entrypoints: { type: 'boolean', default: false },
    'workflows-only': { type: 'boolean', default: false },
    exceptions: { type: 'string' },
    report: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
});

if (parsed.values.help) {
  console.log(usage());
  process.exit(0);
}

if (parsed.values['workspace-root']) {
  const workspaceRoot = path.resolve(parsed.values['workspace-root']);
  const exceptionPath = parsed.values.exceptions === undefined
    ? path.join(import.meta.dirname, 'github-workflow-exceptions.json')
    : path.resolve(parsed.values.exceptions);
  const exceptions = fs.existsSync(exceptionPath)
    ? new Map((readJson(exceptionPath).exceptions ?? []).map((entry) => [entry.repository, entry]))
    : new Map();
  const repositories = fs
    .readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) =>
      entry.isDirectory()
      && !entry.name.startsWith('.')
      && (fs.existsSync(path.join(workspaceRoot, entry.name, '.github', 'workflows'))
        || fs.existsSync(path.join(workspaceRoot, entry.name, 'agent.workflow.json'))))
    .map((entry) => entry.name)
    .sort();

  const audit = [];
  const now = Date.now();
  for (const repository of repositories) {
    let result;
    try {
      result = validateRepositoryWorkflows(path.join(workspaceRoot, repository), { entrypoints: true });
    } catch (error) {
      audit.push({ repository, role: 'unknown', issues: [error instanceof Error ? error.message : String(error)] });
      continue;
    }
    const issues = reportRepository(result);
    const exception = exceptions.get(repository);
    const debt = exception === undefined ? [] : validateExceptionEntry(exception, now);
    // Planner validity is a packaging requirement. A fork, a vendored third-party
    // project, and the framework itself do not package through the framework, so
    // their configuration documents provenance rather than a pipeline.
    const configApplicable = !['fork-upstream', 'third-party', 'framework'].includes(result.role);
    audit.push({
      repository,
      role: result.role,
      // Workflow alignment is only half of release readiness: the application's
      // `agent.workflow.json` must also pass the framework planner, or its own
      // package run fails before any lane starts.
      config: configApplicable ? validateApplicationConfig(path.join(workspaceRoot, repository)) : null,
      // A registered exception keeps its findings visible; it must not hide a new
      // violation in a repository that has no entry. An expired or incomplete
      // entry is itself a violation, so the register can only defer debt.
      exception: exception === undefined ? undefined : {
        reason: exception.reason,
        ownerAction: exception.ownerAction,
        owner: exception.owner,
        issue: exception.issue,
        expiresAt: exception.expiresAt,
        daysLeft: exceptionDaysLeft(exception, now),
        debt,
      },
      issues: exception === undefined ? issues : debt,
      trackedIssues: exception === undefined ? [] : issues,
    });
  }

  if (parsed.values.json) {
    console.log(JSON.stringify({ repositories: audit }, null, 2));
  } else {
    for (const entry of audit) {
      const status = entry.issues.length > 0 ? 'FAIL' : entry.exception === undefined ? 'ok  ' : 'EXC ';
      console.log(`${status} ${entry.repository.padEnd(26)} ${entry.role}`);
      for (const issue of entry.issues) console.log(`     - ${issue}`);
      if (entry.exception !== undefined) {
        const days = entry.exception.daysLeft === null ? 'invalid date' : `${entry.exception.daysLeft} day(s) left`
        console.log(`     tracked ${entry.exception.issue} · owner ${entry.exception.owner} · expires ${entry.exception.expiresAt} (${days})`);
        console.log(`     tracked: ${entry.exception.reason}`);
        console.log(`     owner action: ${entry.exception.ownerAction}`);
        for (const issue of entry.trackedIssues) console.log(`     - (tracked) ${issue}`);
      }
      if (entry.config !== null && !entry.config.valid) {
        console.log(`     config: ${entry.config.issues} planner issue(s); first: ${entry.config.firstIssue}`);
      }
    }
    const failing = audit.filter((entry) => entry.issues.length > 0).length;
    const tracked = audit.filter((entry) => entry.exception !== undefined && entry.exception.debt.length === 0).length;
    const expired = audit.filter((entry) => entry.exception !== undefined && entry.exception.debt.length > 0).length;
    const aligned = audit.length - failing - tracked - expired;
    const configs = audit.filter((entry) => entry.config !== null);
    const configsValid = configs.filter((entry) => entry.config.valid).length;
    const soonest = audit
      .filter((entry) => entry.exception !== undefined && Number.isFinite(entry.exception.daysLeft))
      .map((entry) => entry.exception.daysLeft)
      .sort((left, right) => left - right)[0];
    console.log(`\n${aligned}/${audit.length} repositories aligned; ${tracked} tracked exception(s); ${expired} expired/incomplete exception(s); ${failing} need alignment`);
    if (soonest !== undefined) console.log(`earliest exception expiry: ${soonest} day(s)`);
    console.log(`${configsValid}/${configs.length} application configurations pass planner validation`);
    // Group the invalid configurations by their first planner error so the debt
    // is triaged in one place instead of per repository.
    const classes = new Map();
    for (const entry of configs.filter((candidate) => !candidate.config.valid)) {
      const first = entry.config.firstIssue ?? 'unknown';
      const label = /targets must be an array|targets must contain at least/u.test(first) ? 'placeholder targets'
        : /\.id must be|packageId/u.test(first) ? 'non-canonical package id'
          : /runtimeTarget|platform must be one of|cannot produce|is not a .* artifact/u.test(first) ? 'mode/platform mismatch'
            : /not supported/u.test(first) ? 'legacy field'
              : /must be a string|must be an array|must be an object/u.test(first) ? 'wrong value type'
                : /requires lifecycle/u.test(first) ? 'missing lifecycle phase'
                  : 'other';
      classes.set(label, (classes.get(label) ?? 0) + 1);
    }
    if (classes.size > 0) {
      const summary = [...classes].sort((left, right) => right[1] - left[1])
        .map(([label, count]) => `${count} ${label}`).join('; ');
      console.log(`config debt: ${summary}`);
    }
  }
  const failing = audit.filter((entry) => entry.issues.length > 0).length;
  process.exit(parsed.values.report || failing === 0 ? 0 : 1);
}

const root = path.resolve(parsed.values.root || process.cwd());

const agentResult = parsed.values['workflows-only']
  ? { agentRootCount: 0, shimCount: 0 }
  : validateAgents(root);
const result = validateRepositoryWorkflows(root, { entrypoints: parsed.values.entrypoints });
const issues = reportRepository(result);

if (issues.length > 0) {
  fail('GitHub workflow contract is not aligned', issues);
}

console.log(
  `agent and workflow standard ok: ${root} (${agentResult.agentRootCount} AGENTS roots, ${agentResult.shimCount} shims, role ${result.role})`,
);
