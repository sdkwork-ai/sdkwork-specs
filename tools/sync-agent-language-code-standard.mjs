#!/usr/bin/env node
// sync-agent-language-code-standard.mjs
//
// Propagates a concise language code standard block from the corresponding
// sdkwork-specs language spec into the AGENTS.md of every module that owns code
// in that language:
//
//   --language typescript  -> TYPESCRIPT_CODE_SPEC.md (SDKWORK-TYPESCRIPT-CODE-STANDARD)
//   --language dart        -> DART_CODE_SPEC.md        (SDKWORK-DART-CODE-STANDARD)
//   --language frontend    -> FRONTEND_CODE_SPEC.md    (SDKWORK-FRONTEND-CODE-STANDARD)
//
// Detection is per language so modules without that language stay untouched,
// keeping language specs on-demand (AGENTS_SPEC.md section 4).
//
// The block is managed between SDKWORK-<LANG>-CODE-STANDARD markers, so the tool
// is idempotent: re-running it replaces the previous copy instead of duplicating it.
//
// Usage:
//   node sync-agent-language-code-standard.mjs --language typescript --workspace E:/sdkwork-space --check
//   node sync-agent-language-code-standard.mjs --language dart --workspace E:/sdkwork-space --apply
//   node sync-agent-language-code-standard.mjs --language frontend --root E:/sdkwork-space/sdkwork-order --apply
//
// Exit codes: 0 = aligned, 1 = one or more modules are out of date.

import { readdirSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index < 0) return fallback;
  const hit = args[index];
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const next = args[index + 1];
  return next && !next.startsWith('--') ? next : fallback;
};

const WORKSPACE = getArg('workspace', 'E:/sdkwork-space');
const ROOT = getArg('root', null);
const LANGUAGE = getArg('language', null);
const APPLY = args.includes('--apply');
const CHECK = args.includes('--check');

if (!LANGUAGE || !['typescript', 'dart', 'frontend'].includes(LANGUAGE)) {
  console.error('missing --language typescript|dart|frontend');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Block definitions
// ---------------------------------------------------------------------------
const BLOCKS = {
  typescript: {
    marker: 'SDKWORK-TYPESCRIPT-CODE-STANDARD',
    version: 'v1',
    title: 'TypeScript Code Standard',
    body: `Authority: \`../sdkwork-specs/TYPESCRIPT_CODE_SPEC.md\` (v2, industry-best baseline).

- \`tsconfig\` runs \`strict: true\` and the strict family; public APIs are typed and \`any\`-free.
  \`import type\` is required for type-only imports (\`verbatimModuleSyntax\`).
- Errors are typed at package/service boundaries; no empty catches, no swallowed promise
  rejections, no bare \`throw new Error('...')\` for business failures.
- Async: every promise is settled; external awaits have timeouts; \`AbortSignal\` accepted for
  cancellable work; bounded concurrency; no unbounded \`Promise.all\`.
- Public API is minimal, JSDoc-documented, \`@deprecated\` where applicable, and semver-clean.
- Discriminated unions model closed variant sets; no \`as\`/\`@ts-ignore\` bypasses without a guard.
- Node/build runners verify build-critical sources and self-heal from git (CODE_STYLE_SPEC §7);
  \`pnpm clean\` never deletes git-tracked build-critical files.

Verification:

\`\`\`bash
pnpm typecheck && pnpm test && pnpm lint
node ../sdkwork-specs/tools/check-application-layering.mjs --root .
\`\`\``,
  },
  dart: {
    marker: 'SDKWORK-DART-CODE-STANDARD',
    version: 'v1',
    title: 'Dart Code Standard',
    body: `Authority: \`../sdkwork-specs/DART_CODE_SPEC.md\` (v1); Flutter root/UI rules follow
\`../sdkwork-specs/FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md\` and \`../sdkwork-specs/APP_FLUTTER_UI_SPEC.md\`.

- Sound null safety; \`lints\`/\`flutter_lints\` baseline; \`dart analyze\` and \`dart format\` clean.
- \`lib/<package>.dart\` barrel exports only public API; no \`src/\` imports across packages.
- Errors are typed exceptions or results; no bare \`Exception('...')\`, swallowed catches, or
  unhandled futures (\`unawaited\` only with a documented reason).
- \`build()\` is pure (no IO/network/timers); \`const\` constructors where possible; stable list
  keys; controllers/subscriptions disposed.
- Null safety discipline: no \`!\` assertions or \`as\` casts in public API paths; sealed classes
  for closed variant sets.
- External awaits have timeouts; blocking work moves to \`compute\`/isolates; no UI-thread blocking.

Verification:

\`\`\`bash
dart analyze && dart format --output=none --set-exit-if-changed
flutter test   # or: dart test for pure Dart packages
node ../sdkwork-specs/tools/check-application-layering.mjs --root .
\`\`\``,
  },
  frontend: {
    marker: 'SDKWORK-FRONTEND-CODE-STANDARD',
    version: 'v1',
    title: 'Frontend Code Standard',
    body: `Authority: \`../sdkwork-specs/FRONTEND_CODE_SPEC.md\` (v2); language rules follow
\`../sdkwork-specs/TYPESCRIPT_CODE_SPEC.md\` (React/TS) or \`../sdkwork-specs/DART_CODE_SPEC.md\` (Flutter).

- UI -> service -> injected SDK flow is preserved; components never construct SDK clients or
  assemble raw HTTP/auth headers.
- React: hooks rules clean (\`react-hooks\`), \`useEffect\` with full deps and cleanup, stable
  list keys, error boundaries at route/page level, derived state during render (not in effects).
- State: server state behind services/query layer; client state local or minimal typed store;
  no duplication of server state in client stores.
- Accessibility: accessible names, keyboard behavior, visible focus, color is never the only
  signal; error states announced.
- i18n for all user-facing copy in reusable/user-facing packages (I18N_SPEC §6.1).
- PC/H5 \`outDir\` uses \`dist/{standalone,cloud}/{dev,test,staging,prod}\`.

Verification:

\`\`\`bash
pnpm typecheck && pnpm test && pnpm lint
node ../sdkwork-specs/tools/check-application-layering.mjs --root .
node ../sdkwork-specs/tools/check-browser-dist-layout.mjs --root .   # PC/H5 apps
\`\`\``,
  },
};

const conf = BLOCKS[LANGUAGE];
const MARKER_START = `<!-- ${conf.marker}: ${conf.version} -->`;
const MARKER_END = `<!-- /${conf.marker}: ${conf.version} -->`;
const BLOCK = `${MARKER_START}
## ${conf.title}

${conf.body}
${MARKER_END}`;

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set([
  'node_modules', 'target', '.git', 'external', 'dist', 'build', '.next', 'vendor', 'third_party',
  '.tmp', '.dart_tool', 'build', '.sdkwork', '.workbuddy',
]);

function hasAny(dir, pred, depth = 0, maxDepth = 6) {
  if (depth > maxDepth || !existsSync(dir)) return false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (hasAny(join(dir, e.name), pred, depth + 1, maxDepth)) return true;
    } else if (pred(e.name)) {
      return true;
    }
  }
  return false;
}

function hasLanguage(repo) {
  switch (LANGUAGE) {
    case 'typescript':
      if (existsSync(join(repo, 'tsconfig.json'))) return true;
      if (existsSync(join(repo, 'pnpm-workspace.yaml'))) return true;
      return hasAny(repo, (n) => n.endsWith('.ts') && !n.endsWith('.d.ts'));
    case 'dart':
      if (existsSync(join(repo, 'pubspec.yaml'))) return true;
      return hasAny(repo, (n) => n.endsWith('.dart'));
    case 'frontend':
      return hasAny(repo, (n) => n.endsWith('.tsx'));
    default:
      return false;
  }
}

function targetRepos() {
  if (ROOT) return [ROOT.replace(/\\/g, '/')];
  const out = [];
  for (const e of readdirSync(WORKSPACE, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith('sdkwork-')) continue;
    const repo = join(WORKSPACE, e.name);
    if (existsSync(join(repo, '.git'))) out.push(repo);
  }
  return out.sort();
}

function blockRegion(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const start = normalized.indexOf(MARKER_START);
  if (start < 0) return null;
  const end = normalized.indexOf(MARKER_END, start);
  if (end < 0) return null;
  return normalized.slice(start, end + MARKER_END.length);
}

function isAligned(text) {
  const region = blockRegion(text);
  return !!region && region === BLOCK;
}

function applyBlock(text) {
  const start = text.indexOf(MARKER_START);
  if (start < 0) {
    const trimmed = text.replace(/\s+$/, '');
    return `${trimmed}\n\n${BLOCK}\n`;
  }
  const end = text.indexOf(MARKER_END, start);
  if (end < 0) {
    // Corrupted marker pair: replace from the start marker to the end of file.
    return `${text.slice(0, start).replace(/\s+$/, '')}\n\n${BLOCK}\n`;
  }
  const before = text.slice(0, start).replace(/\s+$/, '');
  const after = text.slice(end + MARKER_END.length).replace(/^\s+/, '');
  return after ? `${before}\n\n${BLOCK}\n\n${after}` : `${before}\n\n${BLOCK}\n`;
}

const repos = targetRepos();
const langRepos = repos.filter(hasLanguage);
const skipped = repos.filter((r) => !hasLanguage(r)).map((r) => basename(r));
const missing = [];
const outdated = [];
const ok = [];

for (const repo of langRepos) {
  const agentsPath = join(repo, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    missing.push(basename(repo));
    continue;
  }
  const current = readFileSync(agentsPath, 'utf8');
  if (isAligned(current)) {
    ok.push(basename(repo));
    continue;
  }
  const next = applyBlock(current);
  if (next === current) {
    ok.push(basename(repo));
    continue;
  }
  outdated.push(basename(repo));
  if (APPLY) writeFileSync(agentsPath, next);
}

const mode = APPLY ? 'applied' : CHECK ? 'check' : 'dry-run';
console.log(`language  : ${LANGUAGE}`);
console.log(`mode      : ${mode}`);
console.log(`lang repos: ${langRepos.length} (${skipped.length} other repos skipped)`);
console.log(`aligned   : ${ok.length}`);
console.log(`updated   : ${outdated.length}`);
console.log(`no AGENTS : ${missing.length}`);
if (missing.length) console.log(`  missing: ${missing.join(', ')}`);
if (outdated.length && !APPLY) console.log(`  needs update: ${outdated.join(', ')}`);
if (outdated.length && APPLY) console.log(`  updated: ${outdated.join(', ')}`);

process.exit(outdated.length > 0 || missing.length > 0 ? 1 : 0);
