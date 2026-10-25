/**
 * Read-only discovery and diagnostics for SDKWork AGENTS.md progressive loading.
 *
 * The workspace manifest is deliberately rooted in tracked Git data rather than
 * a recursive filesystem walk. That keeps vendor trees, generated output, and
 * runtime state outside the migration scope.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const REQUIRED_SPEC_FILES = ['README.md', 'SOUL.md', 'AGENTS_SPEC.md'];

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

const CANONICAL_SECTION_HEADINGS = [
  'App SDK Consumer Imports',
  'HTTP API Response Envelope',
  'List And Search Pagination',
];

const ALIGNMENT_ROOT_KINDS = {
  'component-root': 'component',
  'workspace-root': 'workspace',
  'repository-root': 'repository',
  'application-root': 'application',
};

const EXCLUDED_PATH_SEGMENTS = new Map([
  ['.git', 'git-metadata'],
  ['.pnpm', 'package-manager-state'],
  ['.pnpm-store', 'package-manager-state'],
  ['.runtime', 'runtime-state'],
  ['.tmp', 'temporary-state'],
  ['artifacts', 'generated-artifact'],
  ['build', 'generated-build-output'],
  ['coverage', 'generated-test-output'],
  ['dist', 'generated-build-output'],
  ['external', 'external-source'],
  ['generated', 'generated-source'],
  ['node_modules', 'dependency-installation'],
  ['runtime', 'runtime-state'],
  ['target', 'generated-build-output'],
  ['third-party', 'external-source'],
  ['third_party', 'external-source'],
  ['vendor', 'external-source'],
]);

function toPosix(value) {
  return value.replaceAll(path.sep, '/').replaceAll('\\', '/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function comparePath(left, right) {
  return left.localeCompare(right, 'en');
}

function isPathInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function realpathIfExists(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function realpathIfFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? fs.realpathSync(filePath) : null;
  } catch {
    return null;
  }
}

function directoryState(directoryPath) {
  try {
    const stat = fs.lstatSync(directoryPath);
    if (stat.isSymbolicLink()) {
      return 'unsafe-symlink';
    }
    return stat.isDirectory() ? 'available' : 'unsafe-non-directory';
  } catch {
    return 'missing';
  }
}

function normalizeWorkspacePath(workspaceRoot, absolutePath) {
  if (!isPathInside(absolutePath, workspaceRoot)) {
    return '<outside-workspace>';
  }
  const relative = path.relative(workspaceRoot, absolutePath);
  return relative === '' ? '.' : toPosix(relative);
}

function normalizeRepoPath(repoRoot, absolutePath) {
  const relative = path.relative(repoRoot, absolutePath);
  return relative === '' ? '.' : toPosix(relative);
}

function runGit(cwd, args) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function gitAgentPathState(repositoryRoot, agentPath) {
  const relativeAgentPath = path.relative(repositoryRoot, agentPath);
  if (relativeAgentPath === '' || relativeAgentPath === '..' || relativeAgentPath.startsWith(`..${path.sep}`)) {
    return { clean: false, reason: 'agent-path-outside-repository' };
  }
  const result = runGit(repositoryRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    relativeAgentPath,
  ]);
  if (result.status !== 0) {
    return { clean: false, reason: 'git-status-failed' };
  }
  return result.stdout.trim() === ''
    ? { clean: true, reason: null }
    : { clean: false, reason: 'dirty-agent-path' };
}

function gitTopLevel(root) {
  const result = runGit(root, ['rev-parse', '--show-toplevel']);
  if (result.status !== 0) {
    return null;
  }
  const output = result.stdout.trim();
  return output ? realpathIfExists(path.resolve(root, output)) : null;
}

function trackedFiles(repoRoot) {
  const result = runGit(repoRoot, ['ls-files', '-z']);
  if (result.status !== 0) {
    throw new Error(`Unable to list tracked files for ${repoRoot}: ${String(result.stderr ?? '').trim()}`);
  }
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map((filePath) => toPosix(filePath))
    .sort(comparePath);
}

function excludedPathReason(relativePath) {
  const segments = toPosix(relativePath).split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  for (const segment of segments) {
    if (EXCLUDED_PATH_SEGMENTS.has(segment)) {
      return EXCLUDED_PATH_SEGMENTS.get(segment);
    }
    if (/^target[-_].+/u.test(segment)) {
      return 'generated-build-output';
    }
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === 'data' && segments[index + 1] === 'drive-objects') {
      return 'runtime-drive-objects';
    }
  }
  return null;
}

function directSdkworkGitmodulePath(value) {
  const normalized = toPosix(value).replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (
    normalized === ''
    || normalized.startsWith('../')
    || normalized.includes('/../')
    || normalized.includes('/')
    || path.isAbsolute(normalized)
    || /^[A-Za-z]:/u.test(normalized)
  ) {
    return null;
  }
  return /^sdkwork-[a-z0-9][a-z0-9-]*$/iu.test(normalized) ? normalized : null;
}

function gitmodulePaths(workspaceRoot) {
  const gitmodulesPath = path.join(workspaceRoot, '.gitmodules');
  if (!fs.existsSync(gitmodulesPath)) {
    return [];
  }

  const result = runGit(workspaceRoot, [
    'config',
    '--file',
    gitmodulesPath,
    '--get-regexp',
    '^submodule\\..*\\.path$',
  ]);
  if (result.status === 1) {
    return [];
  }
  if (result.status !== 0) {
    throw new Error(`Unable to parse ${gitmodulesPath}: ${String(result.stderr ?? '').trim()}`);
  }

  return result.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const match = /^submodule\..*\.path\s+(.+)$/u.exec(line);
      return match?.[1]?.trim() ?? null;
    })
    .filter(Boolean)
    .sort(comparePath);
}

function hasHeading(text, heading) {
  const escaped = escapeRegExp(heading);
  return new RegExp(`^##\\s+${escaped}\\s*$`, 'imu').test(text);
}

function headingCount(text, heading) {
  const escaped = escapeRegExp(heading);
  return [...text.matchAll(new RegExp(`^##\\s+${escaped}\\s*$`, 'gimu'))].length;
}

function lineIndicators(text) {
  const eagerLoading = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const normalized = line.trim();
    const negative = /\b(?:do not|don't|must not|never|avoid)\b.{0,30}\b(?:read|load)\b/iu.test(normalized);
    const eagerEnglish = /\b(?:read|load)\s+(?:all|every|the entire|the whole)\b.{0,80}\b(?:spec|specs|standards)\b/iu.test(normalized);
    if (!negative && eagerEnglish) {
      eagerLoading.push({ line: index + 1, text: normalized });
    }
  }
  return eagerLoading;
}

function progressiveLoadingSignals(text) {
  const dynamicProgressiveLoading =
    /dynamic[\s\S]{0,100}progressive|progressive[\s\S]{0,100}loading/iu.test(text);
  const onDemandLanguageLoading =
    /on-demand|only the touched language|language-specific specs are on-demand|language specs are on-demand/iu.test(text);
  const taskScopedRouting =
    /task-specific|current task|when (?:the )?task (?:touches|requires)|only when (?:the )?task|task-scoped/iu.test(text);
  const eagerLoadingIndicators = lineIndicators(text);
  return {
    dynamicProgressiveLoading,
    onDemandLanguageLoading,
    taskScopedRouting,
    eagerLoadingIndicators,
    status: dynamicProgressiveLoading && onDemandLanguageLoading && taskScopedRouting && eagerLoadingIndicators.length === 0
      ? 'aligned'
      : 'needs-attention',
  };
}

function addReference(references, fileName, value) {
  const current = references.get(fileName) ?? [];
  if (!current.some((entry) => entry.path === value.path && entry.kind === value.kind)) {
    current.push(value);
    references.set(fileName, current);
  }
}

function inspectSpecReferences({ text, agentRoot, standardsRoot, workspaceRoot }) {
  const references = new Map(REQUIRED_SPEC_FILES.map((fileName) => [fileName, []]));
  const declaredPattern = /(?<![A-Za-z0-9_.\\/:-])((?:(?:\.{1,2}[\\/])+)?sdkwork-specs[\\/](README\.md|SOUL\.md|AGENTS_SPEC\.md))(?![A-Za-z0-9_.-])/giu;
  let match;
  while ((match = declaredPattern.exec(text)) !== null) {
    const rawPath = toPosix(match[1]);
    const fileName = match[2];
    const candidate = path.resolve(agentRoot, rawPath.replaceAll('/', path.sep));
    const resolved = realpathIfFile(candidate);
    const expected = realpathIfFile(path.join(standardsRoot, fileName));
    addReference(references, fileName, {
      kind: 'declared-sdkwork-specs-path',
      path: rawPath,
      resolvesTo: resolved ? normalizeWorkspacePath(workspaceRoot, resolved) : null,
      valid: Boolean(resolved && expected && resolved === expected),
    });
  }

  if (agentRoot === standardsRoot) {
    for (const fileName of REQUIRED_SPEC_FILES) {
      if ((references.get(fileName) ?? []).length > 0) {
        continue;
      }
      const localPattern = new RegExp(`(?<![A-Za-z0-9_.\\/:-])${escapeRegExp(fileName)}(?![A-Za-z0-9_.\\/:-])`, 'gu');
      if (!localPattern.test(text)) {
        continue;
      }
      addReference(references, fileName, {
        kind: 'standards-self-root-path',
        path: fileName,
        resolvesTo: normalizeWorkspacePath(workspaceRoot, path.join(standardsRoot, fileName)),
        valid: true,
      });
    }
  }

  const relativeSpecsPath = toPosix(path.relative(agentRoot, standardsRoot)) || '.';
  const files = {};
  for (const fileName of REQUIRED_SPEC_FILES) {
    const entries = (references.get(fileName) ?? []).sort((left, right) => comparePath(left.path, right.path));
    const expectedPath = relativeSpecsPath === '.' ? fileName : `${relativeSpecsPath}/${fileName}`;
    files[fileName] = {
      expectedPath,
      references: entries,
      valid: entries.some((entry) => entry.valid),
    };
  }

  return {
    relativeSpecsPath,
    files,
    valid: REQUIRED_SPEC_FILES.every((fileName) => files[fileName].valid),
  };
}

function inspectAgent({ agentRoot, repoRoot, standardsRoot, workspaceRoot, trackedFilesSet }) {
  const agentPath = path.join(agentRoot, 'AGENTS.md');
  const relativeToRepo = normalizeRepoPath(repoRoot, agentPath);
  const base = {
    path: normalizeWorkspacePath(workspaceRoot, agentPath),
    tracked: trackedFilesSet.has(relativeToRepo),
  };

  let stat;
  try {
    stat = fs.lstatSync(agentPath);
  } catch {
    return { ...base, state: 'missing' };
  }
  if (stat.isSymbolicLink()) {
    return { ...base, state: 'unsafe-symlink' };
  }
  if (!stat.isFile()) {
    return { ...base, state: 'unsafe-non-file' };
  }

  const text = fs.readFileSync(agentPath, 'utf8');
  const requiredSections = {
    present: REQUIRED_AGENT_SECTIONS.filter((heading) => hasHeading(text, heading)),
    missing: REQUIRED_AGENT_SECTIONS.filter((heading) => !hasHeading(text, heading)),
  };
  const requiredSectionHeadingCounts = Object.fromEntries(
    REQUIRED_AGENT_SECTIONS.map((heading) => [heading, headingCount(text, heading)]),
  );
  const canonicalSections = Object.fromEntries(
    CANONICAL_SECTION_HEADINGS.map((heading) => [heading, hasHeading(text, heading)]),
  );
  const sectionHeadingCounts = Object.fromEntries(
    CANONICAL_SECTION_HEADINGS.map((heading) => [heading, headingCount(text, heading)]),
  );
  return {
    ...base,
    state: 'existing',
    requiredSections,
    requiredSectionHeadingCounts,
    canonicalSections,
    sectionHeadingCounts,
    progressiveLoading: progressiveLoadingSignals(text),
    relativeSpecReferences: inspectSpecReferences({ text, agentRoot, standardsRoot, workspaceRoot }),
  };
}

function addCandidate(candidates, absolutePath, classification, reason) {
  const key = path.resolve(absolutePath);
  const current = candidates.get(key) ?? {
    absolutePath: key,
    classification,
    discoveryReasons: new Set(),
  };
  if (classification === 'application-root' || current.classification === 'repository-root') {
    current.classification = classification;
  }
  current.discoveryReasons.add(reason);
  candidates.set(key, current);
}

function addExcluded(excluded, workspaceRoot, repoPath, reason) {
  const pathValue = normalizeWorkspacePath(workspaceRoot, repoPath);
  const key = `${pathValue}:${reason}`;
  excluded.set(key, { path: pathValue, reason });
}

function discoverRepositoryTargets({ repoRoot, repoPath, source, workspaceRoot, standardsRoot, excluded }) {
  const allTrackedFiles = trackedFiles(repoRoot);
  const trackedFilesSet = new Set(allTrackedFiles);
  const candidates = new Map();
  const rootClassification = repoPath === '.' ? 'workspace-root' : 'repository-root';
  addCandidate(candidates, repoRoot, rootClassification, source);

  const nonExcludedFiles = [];
  for (const relativePath of allTrackedFiles) {
    const reason = excludedPathReason(relativePath);
    if (reason) {
      if (path.posix.basename(relativePath) === 'AGENTS.md' || path.posix.basename(relativePath) === 'agent.app.config.json') {
        addExcluded(excluded, workspaceRoot, path.join(repoRoot, relativePath), reason);
      }
      continue;
    }
    nonExcludedFiles.push(relativePath);
  }

  for (const relativePath of nonExcludedFiles) {
    if (path.posix.basename(relativePath) !== 'agent.app.config.json') {
      continue;
    }
    const appRoot = path.dirname(path.join(repoRoot, relativePath));
    if (path.resolve(appRoot) === path.resolve(repoRoot)) {
      addCandidate(candidates, repoRoot, rootClassification, 'tracked-root-app-config');
    } else {
      addCandidate(candidates, appRoot, 'application-root', 'tracked-agent-app-config');
    }
  }

  const directApps = new Set();
  for (const relativePath of nonExcludedFiles) {
    const segments = relativePath.split('/');
    if (segments.length >= 3 && segments[0] === 'apps' && segments[1]) {
      directApps.add(path.join(repoRoot, 'apps', segments[1]));
    }
  }
  for (const appRoot of [...directApps].sort(comparePath)) {
    addCandidate(candidates, appRoot, 'application-root', 'tracked-direct-apps-child');
  }

  const targetAgentPaths = new Set();
  const targets = [...candidates.values()]
    .map((candidate) => {
      const rootState = directoryState(candidate.absolutePath);
      const agent = rootState === 'available'
        ? inspectAgent({
          agentRoot: candidate.absolutePath,
          repoRoot,
          standardsRoot,
          workspaceRoot,
          trackedFilesSet,
        })
        : {
          path: normalizeWorkspacePath(workspaceRoot, path.join(candidate.absolutePath, 'AGENTS.md')),
          tracked: false,
          state: rootState === 'missing' ? 'root-missing' : rootState,
        };
      targetAgentPaths.add(normalizeRepoPath(repoRoot, path.join(candidate.absolutePath, 'AGENTS.md')));
      return {
        repo: repoPath,
        agentRoot: normalizeWorkspacePath(workspaceRoot, candidate.absolutePath),
        classification: candidate.classification,
        discoveryReasons: [...candidate.discoveryReasons].sort(comparePath),
        rootState,
        agent,
      };
    })
    .sort((left, right) => comparePath(left.agentRoot, right.agentRoot));

  const unscopedAgents = allTrackedFiles
    .filter((relativePath) => path.posix.basename(relativePath) === 'AGENTS.md')
    .filter((relativePath) => !excludedPathReason(relativePath))
    .filter((relativePath) => !targetAgentPaths.has(relativePath))
    .map((relativePath) => ({
      repo: repoPath,
      path: normalizeWorkspacePath(workspaceRoot, path.join(repoRoot, relativePath)),
      reason: 'not-a-managed-repository-or-application-root',
    }))
    .sort((left, right) => comparePath(left.path, right.path));

  return {
    repository: { path: repoPath, source },
    targets,
    unscopedAgents,
  };
}

function discoverManagedRepositories(workspaceRoot, excluded) {
  const workspaceGitRoot = gitTopLevel(workspaceRoot);
  if (!workspaceGitRoot || workspaceGitRoot !== workspaceRoot) {
    throw new Error(`Workspace root must be an independent Git root: ${workspaceRoot}`);
  }

  const repositories = [{ path: '.', absolutePath: workspaceRoot, source: 'workspace-root' }];
  for (const rawPath of gitmodulePaths(workspaceRoot)) {
    const directPath = directSdkworkGitmodulePath(rawPath);
    if (!directPath) {
      addExcluded(excluded, workspaceRoot, path.resolve(workspaceRoot, rawPath), 'unmanaged-or-nested-gitmodule');
      continue;
    }
    const candidate = path.resolve(workspaceRoot, directPath);
    const candidateRealpath = realpathIfExists(candidate);
    if (!candidateRealpath) {
      addExcluded(excluded, workspaceRoot, candidate, 'uninitialized-gitmodule');
      continue;
    }
    const candidateGitRoot = gitTopLevel(candidateRealpath);
    if (!candidateGitRoot || candidateGitRoot !== candidateRealpath) {
      addExcluded(excluded, workspaceRoot, candidateRealpath, 'not-independent-git-root');
      continue;
    }
    repositories.push({
      path: directPath,
      absolutePath: candidateRealpath,
      source: 'direct-sdkwork-gitmodule',
    });
  }

  return repositories.sort((left, right) => {
    if (left.path === '.') return -1;
    if (right.path === '.') return 1;
    return comparePath(left.path, right.path);
  });
}

function alignmentDeferReason(target) {
  if (target.rootState !== 'available') {
    return `root-${target.rootState}`;
  }
  if (!['existing', 'missing'].includes(target.agent.state)) {
    return `agent-${target.agent.state}`;
  }
  return null;
}

function alignmentRecord(target, workspaceRoot, standardsRoot) {
  const rootKind = ALIGNMENT_ROOT_KINDS[target.classification] ?? null;
  const action = target.agent.state === 'existing'
    ? 'update'
    : target.agent.state === 'missing'
      ? 'create'
      : null;
  const agentRoot = path.resolve(workspaceRoot, target.agentRoot);
  const agentPath = path.join(agentRoot, 'AGENTS.md');
  const repositoryRoot = path.resolve(workspaceRoot, target.repo);
  const relativeSpecsPath = toPosix(path.relative(agentRoot, standardsRoot)) || '.';
  const base = {
    rootPath: target.agentRoot,
    agentPath: 'AGENTS.md',
    relativeSpecsPath,
    rootKind,
    action,
    beforeSha256: null,
  };

  const stateReason = alignmentDeferReason(target);
  if (stateReason) {
    return { deferred: { ...base, reason: stateReason } };
  }
  if (!rootKind) {
    return { deferred: { ...base, reason: 'unsupported-root-kind' } };
  }

  if (action === 'update') {
    const duplicateRequiredSection = Object.entries(target.agent.requiredSectionHeadingCounts ?? {})
      .find(([, count]) => count > 1)?.[0];
    if (duplicateRequiredSection) {
      return { deferred: { ...base, reason: `duplicate-required-section:${duplicateRequiredSection}` } };
    }
    if (!target.agent.tracked) {
      return { deferred: { ...base, reason: 'agent-not-tracked' } };
    }
    try {
      const stat = fs.lstatSync(agentPath);
      if (stat.isSymbolicLink()) {
        return { deferred: { ...base, reason: 'agent-unsafe-symlink' } };
      }
      if (!stat.isFile()) {
        return { deferred: { ...base, reason: 'agent-unsafe-non-file' } };
      }
      base.beforeSha256 = sha256File(agentPath);
      if ((target.agent.sectionHeadingCounts?.['HTTP API Response Envelope'] ?? 0) > 1) {
        base.repairHttpEnvelope = true;
      }
      if ((target.agent.sectionHeadingCounts?.['List And Search Pagination'] ?? 0) === 0) {
        base.ensurePagination = true;
      }
    } catch {
      return { deferred: { ...base, reason: 'agent-unavailable' } };
    }
  } else if (fs.existsSync(agentPath)) {
    return { deferred: { ...base, reason: 'agent-appeared-after-discovery' } };
  }

  const gitState = gitAgentPathState(repositoryRoot, agentPath);
  if (!gitState.clean) {
    return { deferred: { ...base, reason: gitState.reason } };
  }
  return { target: base };
}

function buildAlignment(targets, workspaceRoot, standardsRoot) {
  const alignmentTargets = [];
  const deferred = [];
  for (const target of targets) {
    const record = alignmentRecord(target, workspaceRoot, standardsRoot);
    if (record.target) {
      alignmentTargets.push(record.target);
    } else {
      deferred.push(record.deferred);
    }
  }
  alignmentTargets.sort((left, right) => comparePath(left.rootPath, right.rootPath));
  deferred.sort((left, right) => {
    const rootOrder = comparePath(left.rootPath, right.rootPath);
    return rootOrder === 0 ? comparePath(left.reason, right.reason) : rootOrder;
  });

  return {
    workspaceRoot: '.',
    targets: alignmentTargets,
    deferred,
    summary: {
      candidateCount: targets.length,
      targetCount: alignmentTargets.length,
      updateCount: alignmentTargets.filter((target) => target.action === 'update').length,
      createCount: alignmentTargets.filter((target) => target.action === 'create').length,
      deferredCount: deferred.length,
      dirtyDeferredCount: deferred.filter((target) => target.reason === 'dirty-agent-path').length,
      unsafeDeferredCount: deferred.filter((target) => /(?:^root-unsafe|^agent-unsafe|^root-missing|^agent-unavailable)/u.test(target.reason)).length,
      structuralDeferredCount: deferred.filter((target) => target.reason.startsWith('duplicate-required-section:')).length,
      repairHttpEnvelopeCount: alignmentTargets.filter((target) => target.repairHttpEnvelope === true).length,
      ensurePaginationCount: alignmentTargets.filter((target) => target.ensurePagination === true).length,
    },
  };
}

function summarizeTargets(targets) {
  const summary = {
    targetCount: targets.length,
    existingAgentCount: 0,
    missingAgentCount: 0,
    unsafeAgentCount: 0,
    rootMissingCount: 0,
    progressiveLoadingAlignedCount: 0,
    progressiveLoadingNeedsAttentionCount: 0,
    relativeSpecsValidCount: 0,
    relativeSpecsInvalidCount: 0,
  };
  for (const target of targets) {
    if (target.agent.state === 'existing') {
      summary.existingAgentCount += 1;
      if (target.agent.progressiveLoading.status === 'aligned') {
        summary.progressiveLoadingAlignedCount += 1;
      } else {
        summary.progressiveLoadingNeedsAttentionCount += 1;
      }
      if (target.agent.relativeSpecReferences.valid) {
        summary.relativeSpecsValidCount += 1;
      } else {
        summary.relativeSpecsInvalidCount += 1;
      }
    } else if (target.agent.state === 'missing') {
      summary.missingAgentCount += 1;
    } else if (target.agent.state === 'root-missing') {
      summary.rootMissingCount += 1;
    } else {
      summary.unsafeAgentCount += 1;
    }
  }
  return summary;
}

/**
 * Builds a deterministic, portable manifest without changing the audited roots.
 */
export function auditAgentsProgressiveLoading(workspace) {
  const workspaceRoot = realpathIfExists(path.resolve(workspace));
  if (!workspaceRoot) {
    throw new Error(`Workspace root does not exist: ${workspace}`);
  }
  const standardsRoot = realpathIfExists(path.join(workspaceRoot, 'sdkwork-specs'));
  if (!standardsRoot || !isPathInside(standardsRoot, workspaceRoot)) {
    throw new Error(`Workspace must contain sdkwork-specs: ${workspaceRoot}`);
  }
  for (const fileName of REQUIRED_SPEC_FILES) {
    if (!realpathIfFile(path.join(standardsRoot, fileName))) {
      throw new Error(`sdkwork-specs is missing required authority: ${fileName}`);
    }
  }

  const excluded = new Map();
  const repositories = discoverManagedRepositories(workspaceRoot, excluded);
  const results = repositories.map((repository) => discoverRepositoryTargets({
    repoRoot: repository.absolutePath,
    repoPath: repository.path,
    source: repository.source,
    workspaceRoot,
    standardsRoot,
    excluded,
  }));
  const targets = results.flatMap((result) => result.targets).sort((left, right) => {
    const repoOrder = comparePath(left.repo, right.repo);
    return repoOrder === 0 ? comparePath(left.agentRoot, right.agentRoot) : repoOrder;
  });
  const unscopedAgents = results.flatMap((result) => result.unscopedAgents).sort((left, right) => {
    const repoOrder = comparePath(left.repo, right.repo);
    return repoOrder === 0 ? comparePath(left.path, right.path) : repoOrder;
  });
  const excludedPaths = [...excluded.values()].sort((left, right) => {
    const pathOrder = comparePath(left.path, right.path);
    return pathOrder === 0 ? comparePath(left.reason, right.reason) : pathOrder;
  });
  const alignment = buildAlignment(targets, workspaceRoot, standardsRoot);

  return {
    schemaVersion: 1,
    workspaceRoot: '.',
    standardsRoot: normalizeWorkspacePath(workspaceRoot, standardsRoot),
    repositories: results.map((result) => result.repository),
    targets,
    unscopedAgents,
    excludedPaths,
    alignment,
    summary: {
      repositoryCount: results.length,
      unscopedAgentCount: unscopedAgents.length,
      excludedPathCount: excludedPaths.length,
      ...summarizeTargets(targets),
    },
  };
}
