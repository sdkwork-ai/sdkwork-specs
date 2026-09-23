#!/usr/bin/env node
/**
 * Validates that every `tools/*.mjs` invocation written into a normative document is one the named
 * tool actually accepts.
 *
 * A spec or AGENTS.md is a contract with the reader: `node ../sdkwork-specs/tools/<tool>.mjs --flag`
 * is an instruction. Written against a `node:util` parser, an unknown flag throws
 * `ERR_PARSE_ARGS_UNKNOWN_OPTION`; written against a hand-rolled loop — the shape three of the first
 * four real defects used — it is skipped in silence, so the command runs and validates a different
 * target than the document promised. Either way the reader patches the command by hand or drops the
 * gate. Two defect classes are reported:
 *
 *   1. a document names a tool that exists in no `tools/` directory, and
 *   2. a document passes a flag the named tool never mentions.
 *
 * Scope is normative documents only. Directories that hold records of work already done rather than
 * instructions to the reader are listed in `RECORD_DIRS` below, derived from the documentation
 * layers in `DOCUMENTATION_SPEC.md` section 2.1. A plan naming a tool that was later implemented
 * under a different name is history, not a broken instruction, and rewriting it would falsify the
 * record. A document that records a retirement should therefore name the retired module without a
 * `tools/` path, the way `TECH-sdkwork-standards-alignment-20260612.md` does: a runnable-looking path
 * is what this gate — and the reader — reads as an instruction.
 *
 * Ownership follows the tree: a module repository's gate answers for that repository's own documents,
 * and the specs repository's gate answers for every spec it ships. Running `--root` inside a module
 * repository therefore does not fail that repository's build over a defect in a spec. Tool resolution
 * still spans the workspace, because documents in this workspace name tools across repository
 * boundaries; a document that legitimately invokes a sibling or `../sdkwork-specs/tools/<tool>.mjs`
 * resolves and its flags are judged.
 *
 * Usage:
 *   node tools/check-doc-tool-invocation-contract.mjs --root <repository-root>   # --root . inside it
 *   node tools/check-doc-tool-invocation-contract.mjs --workspace <workspace-root>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ROOT = path.dirname(SPECS_ROOT);
const DOC_NAMES = ['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'GEMINI.md'];
const TOOL_RE = /(?:^|[\s"'`(=])((?:[\w.@-]+\/)*[\w.@-]+\.(?:mjs|cjs|js))(?=[\s"'`);|]|$)/g;
const FLAG_RE = /--[A-Za-z0-9][A-Za-z0-9-]*/g;
// Where this command's arguments end: a backtick, a table cell, a shell separator, or the next tool.
// Without this a line holding two commands attributes the second one's flags to the first.
const BOUNDARY_RE = /[`|]|&&|\|\||;|\S*\.(?:mjs|cjs|js)\b/;
// `node_modules`, `.git`, and build output are not documents a repository ships. `.tmp`, `tmp`, and
// `.zcode` hold generated scratch and agent session plans by convention — `sdkwork-cloudrouter`
// git-ignores `.zcode/plans/`, `sdkwork-webserver` git-ignores `tmp/` — so a stale command in one is
// not a contract with any reader. Skipping by name is deliberately coarse: this is a documentation
// gate, and a directory named `tmp` is not where normative content lives.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'target',
  'dist',
  'generated',
  'coverage',
  '.tmp',
  'tmp',
  '.zcode',
]);
// Record layers of `DOCUMENTATION_SPEC.md` section 2.1. The Working layer answers "what work is in
// flight?" and "why was it decided?"; changelogs, migrations, and releases answer "what shipped?";
// Archive is "retired history". A plan or a review that names a tool renamed since is a record of
// what was true then, and rewriting it would falsify the record. Canon, Guides, runbooks, and
// Extension stay in scope: those are read as instructions.
//
// `docs/audit/` and `docs/superpowers/` are outside the section 2.5 skeleton but are record roots in
// practice — `DESTRUCTIVE_OPERATION_SPEC.md` section 10 cites `sdkwork-cloudrouter/docs/audit/...` as
// an evidence location — so they are treated as records rather than instructions.
const RECORD_DIRS = [
  'docs/engineering/',
  'docs/product/requirements/',
  'docs/architecture/decisions/',
  'docs/changelogs/',
  'docs/migrations/',
  'docs/releases/',
  'docs/archive/',
  'docs/audit/',
  'docs/superpowers/',
  'examples/',
  '.workbuddy/',
];

function usage() {
  return [
    'Usage:',
    '  node tools/check-doc-tool-invocation-contract.mjs --root <repository-root>',
    '  node tools/check-doc-tool-invocation-contract.mjs --workspace <workspace-root>',
    '',
    'Checks that every tools/*.mjs invocation in a normative document names a tool that exists and',
    'passes only flags that tool accepts. --root scopes the documents to one tree and is what a',
    'repository wires into its own gate; --workspace audits every sdkwork-* repository at once.',
  ].join('\n');
}

function fail(message, details = []) {
  console.error(`doc tool invocation contract failed: ${message}`);
  for (const detail of details.slice(0, 200)) console.error(`- ${detail}`);
  if (details.length > 200) console.error(`- ... and ${details.length - 200} more`);
  process.exit(1);
}

function walk(dir, keep, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}

function isRecordDoc(file, root) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  return RECORD_DIRS.some((prefix) => rel.startsWith(prefix));
}

/** Tools resolvable from anywhere in the workspace, keyed by basename. */
function indexTools(roots) {
  const byBasename = new Map();
  for (const root of [SPECS_ROOT, ...roots]) {
    for (const file of walk(root, (p) => isToolFile(p, root))) {
      const name = path.basename(file);
      if (!byBasename.has(name)) byBasename.set(name, []);
      byBasename.get(name).push(file);
    }
  }
  return byBasename;
}

/**
 * A tool named by a path that reaches outside the tree under inspection.
 *
 * Documents in this workspace name tools across repository boundaries and spell the path from
 * wherever they stand: `../sdkwork-models/tools/validate-catalog.mjs` from a sibling,
 * `sdkwork-agents/tools/check_...mjs` from the workspace root, or a bare `tools/drive_sdk_generate.mjs`
 * whose prose on the same line reads "from `sdkwork-drive`". Resolve the written path against the
 * workspace rather than reporting a tool that exists as missing.
 *
 * Resolution by probe, not by index: walking every sibling tree for each repository's gate would cost
 * as much as the fleet audit, while a companion repository is a handful of `existsSync` calls.
 */
const siblingToolCache = new Map();
function siblingTool(rel) {
  if (siblingToolCache.has(rel)) return siblingToolCache.get(rel);

  const segments = rel.split(/[\\/]+/).filter((segment) => segment && segment !== '.');
  while (segments[0] === '..') segments.shift();

  let found = null;
  if (segments.length >= 2) {
    const fromWorkspace = path.join(WORKSPACE_ROOT, ...segments);
    if (fs.existsSync(fromWorkspace)) {
      found = fromWorkspace;
    } else if (!/^sdkwork-[a-z0-9-]+$/.test(segments[0])) {
      for (const name of workspaceRepoNames()) {
        const candidate = path.join(WORKSPACE_ROOT, name, ...segments);
        if (fs.existsSync(candidate)) {
          found = candidate;
          break;
        }
      }
    }
  }

  siblingToolCache.set(rel, found);
  return found;
}

/** Sibling repository names, read once; empty when the tool is not beside a workspace. */
let repoNames = null;
function workspaceRepoNames() {
  if (repoNames === null) {
    try {
      repoNames = fs
        .readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdkwork-'))
        .map((entry) => entry.name);
    } catch {
      repoNames = [];
    }
  }
  return repoNames;
}

/**
 * Whether a file under `root` lives in a tool directory.
 *
 * A repository may host tool directories away from its root — `sdkwork-terminal` keeps its smoke
 * probes in `apps/sdkwork-terminal-pc/tools/smoke/` — so indexing only `<root>/tools` reports probes
 * that exist as missing. Any `tools` or `scripts` directory in the tree counts.
 */
function isToolFile(file, root) {
  if (!/\.(mjs|cjs|js)$/.test(file)) return false;
  const dirs = path.relative(root, file).split(path.sep).slice(0, -1);
  return dirs.includes('tools') || dirs.includes('scripts');
}

const flagCache = new Map();
function toolFlags(file) {
  if (flagCache.has(file)) return flagCache.get(file);
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    /* unreadable; the caller reports the tool as absent */
  }
  const flags = new Set(text.match(FLAG_RE) || []);
  // A `parseArgs` key generates `--key` at runtime and the literal need never appear in the source.
  // Quoted keys are the common spelling in this workspace, and a regex accepting only bare
  // identifiers reports every such flag as unknown.
  for (const m of text.matchAll(/^\s{2,}['"`]?([A-Za-z][\w-]*)['"`]?\s*:\s*\{\s*type:/gm)) {
    flags.add(`--${m[1]}`);
  }
  // An option set assembled elsewhere (a spread, or an options object imported from a shared module)
  // cannot be judged from this file. Stay silent rather than reporting the whole flag set as unknown.
  const dynamic =
    /options\s*:\s*\{[\s\S]{0,400}?\.\.\./.test(text) ||
    /import\s*\{[^}]*\b(options|commonOptions|standardOptions)\b[^}]*\}\s*from/.test(text) ||
    forwardsArgv(text);
  const result = { flags, dynamic };
  flagCache.set(file, result);
  return result;
}

/**
 * Whether a tool forwards its own arguments to another command.
 *
 * A wrapper accepts whatever the command it delegates to accepts, so its flag surface cannot be
 * judged from its own source. `scripts/run-tauri-cli.mjs` builds an argv array and hands it to the
 * Tauri CLI, which is why `--config` and `--bundles` appear nowhere in it, and
 * `tools/generations_sdk_generate.mjs` assigns `process.argv.slice(2)` to a passthrough. Reporting
 * those documents would blame the document for a flag its reader can in fact pass.
 */
function forwardsArgv(text) {
  return (
    /process\.argv\.slice\(2\)/.test(text) && /\b(spawn|spawnSync|execFile|execFileSync)\s*\(/.test(text)
  );
}

/**
 * A document may spell a command the way a reader would run it from the repository root, which is not
 * the way this process would. Resolve `../sdkwork-specs/tools/x.mjs` and `../../tools/x.mjs` the
 * same way: by the tool's own name.
 */
function invocationTargets(line) {
  const found = [];
  for (const match of line.matchAll(TOOL_RE)) {
    const rel = match[1];
    if (!/tools[\/\\]/.test(rel)) continue;
    const after = line.slice(match.index + match[0].length);
    const cut = after.search(BOUNDARY_RE);
    const args = cut === -1 ? after : after.slice(0, cut);
    found.push({
      rel,
      base: path.basename(rel),
      flags: [...new Set(args.match(FLAG_RE) || [])],
    });
  }
  return found;
}

/**
 * A tree's normative documents: its agent entrypoints (and their compatibility shims) plus every
 * markdown file it ships, with record directories excluded. See the header for why the tree, not the
 * workspace, decides the scope.
 */
function docsFor(root) {
  const docs = [];
  for (const name of DOC_NAMES) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) docs.push(p);
  }
  for (const file of walk(root, (p) => p.endsWith('.md'))) {
    if (!isRecordDoc(file, root)) docs.push(file);
  }
  return docs;
}

function checkDocuments(docs, byBasename) {
  const missing = [];
  const badFlag = [];
  let invocations = 0;

  for (const doc of docs) {
    let text;
    try {
      text = fs.readFileSync(doc, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      // Join a shell line-continuation onto the line it continues, so a wrapped command is read as
      // one; the reported line number stays the physical first line of the command.
      let line = lines[i];
      let consumed = 0;
      while (/\\\s*$/.test(line) && i + 1 + consumed < lines.length) {
        line = line.replace(/\\\s*$/, ' ') + lines[i + 1 + consumed];
        consumed += 1;
      }
      if (!/tools[\/\\]/.test(line)) {
        i += consumed;
        continue;
      }
      for (const target of invocationTargets(line)) {
        // `node --test tools/x.test.mjs` is a node invocation, not the tool's own CLI contract.
        if (/\.test\.(mjs|cjs|js)$/.test(target.base)) continue;
        invocations += 1;
        const candidates = byBasename.get(target.base) || [];
        const resolved =
          candidates.find((c) => c.startsWith(SPECS_ROOT)) ||
          candidates[0] ||
          siblingTool(target.rel);
        if (!resolved) {
          missing.push({ doc, line: i + 1, tool: target.rel });
          continue;
        }
        const { flags: known, dynamic } = toolFlags(resolved);
        if (dynamic) continue;
        for (const flag of target.flags) {
          if (!known.has(flag)) {
            badFlag.push({ doc, line: i + 1, tool: target.base, flag });
          }
        }
      }
      i += consumed;
    }
  }
  return { missing, badFlag, invocations };
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      workspace: { type: 'string' },
    },
  });
  if (!values.root && !values.workspace) {
    console.error(usage());
    process.exit(2);
  }
  if (values.root && values.workspace) {
    console.error(usage());
    process.exit(2);
  }

  let roots;
  let docs;
  if (values.root) {
    const root = path.resolve(values.root);
    roots = [root];
    docs = docsFor(root);
  } else {
    const workspace = path.resolve(values.workspace);
    roots = fs
      .readdirSync(workspace, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^sdkwork-[a-z0-9-]+$/.test(e.name))
      .map((e) => path.join(workspace, e.name));
    docs = [];
    for (const root of roots) docs.push(...docsFor(root));
  }

  const byBasename = indexTools(roots);
  const { missing, badFlag, invocations } = checkDocuments([...new Set(docs)], byBasename);

  const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/');
  if (missing.length > 0) {
    fail(
      `${missing.length} invocation(s) name a tool that exists in no tools/ directory`,
      missing.map((h) => `${rel(h.doc)}:${h.line} names ${h.tool}`),
    );
  }
  if (badFlag.length > 0) {
    fail(
      `${badFlag.length} invocation(s) pass a flag the named tool does not accept`,
      badFlag.map((h) => `${rel(h.doc)}:${h.line} ${h.tool} ${h.flag}`),
    );
  }
  console.log(
    `[doc-tool-invocation-contract] ok: ${invocations} invocations across ${new Set(docs).size} documents`,
  );
}

main();
