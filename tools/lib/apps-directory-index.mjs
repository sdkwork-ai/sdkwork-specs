import fs from 'node:fs';
import path from 'node:path';

import { resolveRepositoryIdentity } from '../align-repository-docs-lib.mjs';

const STANDARD_TOP_LEVEL = new Set([
  'apis', 'apps', 'crates', 'sdks', 'jobs', 'tools', 'plugins', 'examples',
  'configs', 'deployments', 'scripts', 'docs', 'tests', '.sdkwork', '.github',
  'assets', 'database', 'specs', 'sdks', 'packages', 'src', 'src-tauri',
  'flatpak', 'skills', 'codebox-main',
]);

const SURFACE_RULES = [
  { suffix: '-common', role: 'common', runnable: false, architecture: 'APPLICATION_SPEC.md and MODULE_SPEC.md' },
  { suffix: '-flutter-mobile', role: 'flutter-mobile', runnable: true, architecture: 'FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md' },
  { suffix: '-mini-program', role: 'mini-program', runnable: true, architecture: 'MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md' },
  { suffix: '-android-mobile', role: 'android-mobile', runnable: true, architecture: 'ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md' },
  { suffix: '-ios-mobile', role: 'ios-mobile', runnable: true, architecture: 'IOS_APP_MOBILE_ARCHITECTURE_SPEC.md' },
  { suffix: '-harmony-mobile', role: 'harmony-mobile', runnable: true, architecture: 'HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md' },
  { suffix: '-h5', role: 'h5', runnable: true, architecture: 'APP_H5_ARCHITECTURE_SPEC.md' },
  { suffix: '-pc', role: 'pc', runnable: true, architecture: 'APP_PC_ARCHITECTURE_SPEC.md' },
  { suffix: '-backend-react-web', role: 'backend-react-web', runnable: true, architecture: 'BACKEND_UI_SPEC.md' },
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

function isDirectory(absolutePath) {
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();
}

function isFile(absolutePath) {
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
}

function hasApplicationManifest(absoluteDir) {
  return isFile(path.join(absoluteDir, 'agent.app.config.json'));
}

export function isStandardsRepository(root) {
  return (
    fs.existsSync(path.join(root, 'DOCUMENTATION_SPEC.md'))
    || (fs.existsSync(path.join(root, 'AGENTS.md'))
      && /standards repository/iu.test(readText(path.join(root, 'AGENTS.md'))))
  );
}

export function hasAnyApplicationManifest(root) {
  if (hasApplicationManifest(root)) {
    return true;
  }
  for (const childName of listAppsChildDirectories(root)) {
    if (hasApplicationManifest(path.join(root, 'apps', childName))) {
      return true;
    }
  }
  return listRootLevelAppSurfaces(root).length > 0;
}

export function shouldValidateAppsDirectoryIndex(root) {
  if (isStandardsRepository(root)) {
    return false;
  }

  const identity = resolveRepositoryIdentity(root);
  const appsDir = path.join(root, 'apps');

  if (hasAnyApplicationManifest(root)) {
    return true;
  }
  if (listAppsChildDirectories(root).length > 0) {
    return true;
  }
  if (isDirectory(appsDir)) {
    return true;
  }
  if (identity.profile === 'application') {
    return true;
  }

  return false;
}

export function inferSurfaceRole(directoryName) {
  for (const rule of SURFACE_RULES) {
    if (directoryName.endsWith(rule.suffix)) {
      return rule;
    }
  }
  if (directoryName.includes('-pc-') || directoryName.endsWith('-pc-react')) {
    return { suffix: '-pc', role: 'pc', runnable: true, architecture: 'APP_PC_ARCHITECTURE_SPEC.md' };
  }
  return { role: 'app', runnable: true, architecture: 'APPLICATION_SPEC.md' };
}

function readManifestDisplayName(absoluteDir) {
  const manifestPath = path.join(absoluteDir, 'agent.app.config.json');
  if (!isFile(manifestPath)) {
    return '';
  }
  try {
    const manifest = JSON.parse(readText(manifestPath));
    return manifest.app?.displayName || manifest.app?.name || '';
  } catch {
    return '';
  }
}

function readChildPurpose(absoluteDir, directoryName, surfaceRole) {
  const displayName = readManifestDisplayName(absoluteDir);
  if (displayName) {
    return `${displayName} ${surfaceRole.role} application root.`;
  }
  const readmePath = path.join(absoluteDir, 'README.md');
  if (isFile(readmePath)) {
    const heading = readText(readmePath).match(/^#\s+(.+)$/mu);
    if (heading?.[1]) {
      return heading[1].trim();
    }
  }
  return `${directoryName} ${surfaceRole.role} application root.`;
}

export function listAppsChildDirectories(root) {
  const appsDir = path.join(root, 'apps');
  if (!isDirectory(appsDir)) {
    return [];
  }
  return fs.readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

export function listRootLevelAppSurfaces(root) {
  const surfaces = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || STANDARD_TOP_LEVEL.has(entry.name)) {
      continue;
    }
    const absoluteDir = path.join(root, entry.name);
    if (hasApplicationManifest(absoluteDir)) {
      surfaces.push(entry.name);
    }
  }
  return surfaces.sort();
}

export function detectPrimarySurface(root) {
  if (hasApplicationManifest(root)) {
    return {
      repositoryRootIsPrimary: true,
      rootLevelSurfaces: [],
    };
  }
  const rootLevelSurfaces = listRootLevelAppSurfaces(root);
  return {
    repositoryRootIsPrimary: false,
    rootLevelSurfaces,
  };
}

function renderPrimarySurfaceSection(primary) {
  const lines = ['## Primary App Surface', ''];
  if (primary.repositoryRootIsPrimary) {
    lines.push(
      'The repository root is the primary runnable app surface.',
      'The repository root `agent.app.config.json` governs the primary application manifest.',
    );
    return lines;
  }
  lines.push('The repository root is not the primary runnable app surface.');
  if (primary.rootLevelSurfaces.length > 0) {
    lines.push(
      'This repository uses a hybrid layout. Primary runnable app surfaces currently live outside `apps/`:',
      '',
      ...primary.rootLevelSurfaces.map((surface) => `- \`${surface}/\` with \`${surface}/agent.app.config.json\``),
    );
  } else {
    lines.push('Runnable application roots live under `apps/<application-root>/`.');
  }
  return lines;
}

function renderDirectoryIndexRows(root, children) {
  if (children.length === 0) {
    return [
      '| _none_ | n/a | no | No child application roots are checked in under `apps/` yet. | n/a |',
    ];
  }
  return children.map((childName) => {
    const childDir = path.join(root, 'apps', childName);
    const surface = inferSurfaceRole(childName);
    const runnable = hasApplicationManifest(childDir) || (surface.runnable && surface.role !== 'common');
    const purpose = readChildPurpose(childDir, childName, surface);
    const entryLink = isFile(path.join(childDir, 'README.md'))
      ? `[README](${childName}/README.md)`
      : `\`${childName}/\``;
    return `| ${childName} | ${surface.role} | ${runnable ? 'yes' : 'no'} | ${purpose} | ${entryLink} |`;
  });
}

export function renderAppsReadme(root, identity) {
  const children = listAppsChildDirectories(root);
  const primary = detectPrimarySurface(root);
  const owner = identity.owner || 'SDKWork maintainers';
  const lines = [
    '# apps/',
    '',
    `Application: ${identity.applicationCode}`,
    'Status: active',
    `Owner: ${owner}`,
    'Specs: APPLICATION_SPEC.md, SDKWORK_WORKSPACE_SPEC.md',
    '',
    ...renderPrimarySurfaceSection(primary),
    '',
    '## Directory Index',
    '',
    '| Directory | Surface role | Runnable | Purpose | Entry |',
    '| --- | --- | --- | --- | --- |',
    ...renderDirectoryIndexRows(root, children),
    '',
    '## Allowed Content',
    '',
    '- Selected language/architecture application roots with `README.md`, `AGENTS.md`, `.sdkwork/`, and `specs/` when authored packages exist.',
    '- Architecture-local `packages/`, `config/`, `src/`, `lib/`, `App/`, or `entry/` directories required by the owning architecture standard.',
    '',
    '## Forbidden Content',
    '',
    '- Repository-root API contracts, generated SDK workspaces, Rust crates, or deployment descriptors moved under `apps/`.',
    '- Runtime secrets, user-private state, generated SDK transport output, or cross-application copied business logic.',
    '',
    '## Related Specs',
    '',
    '- `../sdkwork-specs/APPLICATION_SPEC.md`',
    '- `../sdkwork-specs/SDKWORK_WORKSPACE_SPEC.md`',
    '- `../sdkwork-specs/APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`',
    '',
    '## Verification',
    '',
    '```bash',
    'node ../sdkwork-specs/tools/check-apps-directory-index.mjs --root .',
    '```',
    '',
  ];
  return `${lines.join('\n')}`;
}

const APPS_INDEX_LINK = '- [apps directory index](apps/README.md)';

export function ensureRootReadmeAppsLink(root) {
  const readmePath = path.join(root, 'README.md');
  if (!isFile(readmePath)) {
    writeText(readmePath, `# ${path.basename(root)}\n\n${APPS_INDEX_LINK}\n`);
    return true;
  }
  const original = readText(readmePath);
  if (
    original.includes('apps/README.md')
    || original.includes('(apps/README.md)')
  ) {
    return false;
  }
  const section = ['## Application Roots', '', APPS_INDEX_LINK, ''].join('\n');
  writeText(readmePath, `${original.replace(/\s*$/u, '')}\n\n${section}`);
  return true;
}

export function alignAppsDirectoryIndex(root) {
  const identity = resolveRepositoryIdentity(root);
  const changed = [];

  if (!shouldValidateAppsDirectoryIndex(root)) {
    return { root, identity, changed, skipped: true };
  }

  const appsDir = path.join(root, 'apps');
  if (!isDirectory(appsDir)) {
    fs.mkdirSync(appsDir, { recursive: true });
    changed.push('apps/');
  }

  const appsReadmePath = path.join(appsDir, 'README.md');
  const nextAppsReadme = renderAppsReadme(root, identity);
  if (readText(appsReadmePath) !== nextAppsReadme) {
    writeText(appsReadmePath, nextAppsReadme);
    changed.push('apps/README.md');
  }

  if (ensureRootReadmeAppsLink(root)) {
    changed.push('README.md');
  }

  return { root, identity, changed, skipped: false };
}
