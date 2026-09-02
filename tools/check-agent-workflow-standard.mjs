#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

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
    'Usage: node tools/check-agent-workflow-standard.mjs --root <repo>',
    '',
    'Validates SDKWork AGENTS.md and GitHub packaging workflow entrypoints.',
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

function walkFiles(root, predicate) {
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
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
  for (const manifestPath of walkFiles(root, (_file, name) => name === 'sdkwork.app.config.json')) {
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
      if (hasHeading(text, duplicatedHeading)) {
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
  const workflowConfigPath = path.join(root, 'sdkwork.workflow.json');
  const packageWorkflowPath = path.join(root, '.github', 'workflows', 'package.yml');
  const workflowFiles = getWorkflowFiles(root);
  const packageWorkflowText = fs.existsSync(packageWorkflowPath) ? readText(packageWorkflowPath) : '';

  if (!fs.existsSync(workflowConfigPath)) {
    issues.push('sdkwork.workflow.json must exist for SDKWork packaging workflow integration');
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
    } else if (!/^[0-9a-f]{40}$/iu.test(reusableMatch[1]) && !/^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(reusableMatch[1])) {
      issues.push(`${packageLabel} must use a pinned sdkwork-github-workflow ref, not "${reusableMatch[1]}"`);
    }
    if (!/config_path:\s*sdkwork\.workflow\.json/u.test(workflowText)) {
      issues.push(`${packageLabel} must pass config_path: sdkwork.workflow.json`);
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
      issues.push('sdkwork.workflow.json must declare schemaVersion');
    }
    if (!workflow.app?.id) {
      issues.push('sdkwork.workflow.json must declare app.id');
    }
    if (!workflow.release?.artifactPrefix) {
      issues.push('sdkwork.workflow.json must declare release.artifactPrefix');
    }
    if (!Array.isArray(workflow.targets) || workflow.targets.length === 0) {
      issues.push('sdkwork.workflow.json must declare at least one target');
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
      for (const refInput of collectDependencyRefInputs(workflow)) {
        const inputPattern = new RegExp(`^\\s{6}${refInput.inputName}:\\s*$`, 'mu');
        if (!inputPattern.test(packageWorkflowText)) {
          issues.push(
            `${packageLabel} must expose workflow_dispatch input ${refInput.inputName} for ${refInput.pointer} ${refInput.value}`,
          );
        }
        if (!packageWorkflowText.includes('dependency_refs_json')) {
          issues.push(`${packageLabel} must pass dependency_refs_json when dependency refInput values are declared`);
        } else if (!packageWorkflowText.includes(`"${refInput.value}"`)) {
          issues.push(
            `${packageLabel} dependency_refs_json must pass ${refInput.value} from github.event.inputs.${refInput.inputName} or vars.${refInput.value}`,
          );
        } else if (!packageWorkflowText.includes(`github.event.inputs.${refInput.inputName}`)) {
          issues.push(
            `${packageLabel} dependency_refs_json must read github.event.inputs.${refInput.inputName} for ${refInput.value}`,
          );
        } else if (!packageWorkflowText.includes(`vars.${refInput.value}`)) {
          issues.push(
            `${packageLabel} dependency_refs_json must fall back to vars.${refInput.value} for ${refInput.value}`,
          );
        }
      }
    }
  }

  if (issues.length > 0) {
    fail('GitHub packaging workflow is not compliant', issues);
  }

  return { workflowCount: workflowFiles.length };
}

const parsed = parseArgs({
  options: {
    root: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
});

if (parsed.values.help) {
  console.log(usage());
  process.exit(0);
}

const root = path.resolve(parsed.values.root || process.cwd());

const agentResult = validateAgents(root);
const kind = repositoryKind(root);
const workflowFiles = getWorkflowFiles(root);
const hasPackageContract =
  fs.existsSync(path.join(root, 'sdkwork.workflow.json')) ||
  fs.existsSync(path.join(root, '.github', 'workflows', 'package.yml'));
const requiresPackageContract = kind === 'application' || hasPackageContract;
let workflowResult;
if (kind === 'standards' || !requiresPackageContract) {
  const copiedWorkflows = workflowFiles.filter((workflowPath) =>
    FORBIDDEN_COPIED_WORKFLOW_NAMES.has(path.basename(workflowPath)),
  );
  if (copiedWorkflows.length > 0) {
    fail(
      'GitHub packaging workflow is not compliant',
      copiedWorkflows.map((workflowPath) =>
        `${relative(root, workflowPath)} copied packaging workflow is forbidden; use .github/workflows/package.yml`,
      ),
    );
  }
  workflowResult = { workflowCount: workflowFiles.length };
} else {
  workflowResult = validatePackageWorkflow(root);
}

console.log(
  `agent and workflow standard ok: ${root} (${agentResult.agentRootCount} AGENTS roots, ${agentResult.shimCount} shims, ${workflowResult.workflowCount} workflow files scanned)`,
);
