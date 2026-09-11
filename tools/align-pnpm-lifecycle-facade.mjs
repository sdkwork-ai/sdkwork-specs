#!/usr/bin/env node
/**
 * Align application repository roots with the PNPM_SCRIPT_SPEC.md section 2
 * lifecycle facade.
 *
 * The canonical shape is a public verb that delegates to the shared facade plus
 * a private `_sdkwork:<verb>` hook that holds the repository's own tool command:
 *
 *   "build": "pnpm exec sdkwork-app build",
 *   "_sdkwork:build": "cargo build --workspace --release",
 *
 * The conversion is behaviour preserving. It never invents a tool command for a
 * repository:
 *
 *   - an existing public verb is MOVED verbatim into the matching private hook;
 *   - a missing verb is derived only from something the repository already
 *     ships (its own `check:*` gates) or from the documented fleet convention
 *     (`cargo clean` for a Rust workspace);
 *   - anything else is reported as an owner decision instead of being filled
 *     with a placeholder, because a synthesised command that does not do the
 *     right thing is worse than a missing one: it would occupy the contract
 *     slot while doing nothing.
 *
 * Edits are applied as a textual splice of the affected JSON object rather than
 * a full re-serialisation, so every unrelated byte survives. This matters for
 * repositories with mixed or CRLF line endings: re-serialising would silently
 * rewrite line endings and trip the deployment drift gates.
 *
 * Usage:
 *   node align-pnpm-lifecycle-facade.mjs --workspace <dir> [--apply] [--json]
 *   node align-pnpm-lifecycle-facade.mjs --root <repo> [--apply] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  API_ASSEMBLY_SCRIPT_TOOLS,
  WORKSPACE_WIDE_STOP_PATTERN,
  canonicalApiAssemblyCommand,
  defaultDevRuntimeIssues,
  isApplicationRepositoryRoot,
  supportedDeploymentProfiles,
} from './check-pnpm-script-standard.mjs';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WORKSPACE = path.resolve(SPECS_ROOT, '..');
const APP_TOPOLOGY_PACKAGE = '@sdkwork/app-topology';
const FACADE = 'pnpm exec sdkwork-app';

export const LIFECYCLE_COMMANDS = ['build', 'test', 'check', 'verify', 'clean'];
export const DEVELOPMENT_COMMANDS = ['dev', 'dev:standalone', 'dev:cloud'];
export const CANONICAL_ORDER = [...DEVELOPMENT_COMMANDS, ...LIFECYCLE_COMMANDS];

// ---------------------------------------------------------------------------
// JSON object span discovery
// ---------------------------------------------------------------------------

function findObjectSpan(raw, keyName) {
  const keyIndex = raw.indexOf(`"${keyName}"`);
  if (keyIndex === -1) throw new Error(`missing "${keyName}" key`);
  const openIndex = raw.indexOf('{', keyIndex);
  if (openIndex === -1) throw new Error(`missing object body for "${keyName}"`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = openIndex; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return { openIndex, closeIndex: index };
    }
  }
  throw new Error(`unterminated object body for "${keyName}"`);
}

function detectEol(raw) {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

function closingIndentOf(raw, closeIndex) {
  return /([ \t]*)$/u.exec(raw.slice(0, closeIndex))[1];
}

/**
 * Index an object body's existing entries so their own indentation and line
 * ending can be reused verbatim. Line endings differ inside a single file in
 * several repositories, and normalising them would rewrite bytes the drift
 * gates checksum.
 */
function indexEntries(body) {
  const entries = new Map();
  let firstEol = null;
  for (const chunk of body.split(/(?<=\r?\n)/u)) {
    const match = /^([ \t]*)"((?:[^"\\]|\\.)*)"\s*:/u.exec(chunk);
    if (!match) continue;
    const eolMatch = /(\r?\n)$/u.exec(chunk);
    entries.set(JSON.parse(`"${match[2]}"`), {
      indent: match[1],
      eol: eolMatch ? eolMatch[1] : '',
    });
    if (firstEol === null && eolMatch) firstEol = eolMatch[1];
  }
  return { entries, firstEol };
}

/** Rebuild one JSON object's body in the given order, reusing each line's own formatting. */
function spliceObjectBody(raw, keyName, orderedEntries, eol) {
  const { openIndex, closeIndex } = findObjectSpan(raw, keyName);
  const closingIndent = closingIndentOf(raw, closeIndex);
  const body = raw.slice(openIndex + 1, closeIndex);
  const { entries, firstEol } = indexEntries(body);
  const defaultIndent = `${closingIndent}${detectIndentUnit(raw)}`;
  const keys = Object.keys(orderedEntries);
  let out = firstEol ?? eol;
  keys.forEach((key, index) => {
    const meta = entries.get(key);
    const indent = meta?.indent ?? defaultIndent;
    const lineEol = meta?.eol || eol;
    out += `${indent}${JSON.stringify(key)}: ${JSON.stringify(orderedEntries[key])}`;
    if (index < keys.length - 1) out += ',';
    out += lineEol;
  });
  out += closingIndent;
  return raw.slice(0, openIndex + 1) + out + raw.slice(closeIndex);
}

function detectIndentUnit(raw) {
  const match = /^([ \t]+)"/mu.exec(raw);
  const indent = match ? match[1] : '  ';
  // The entry indent is one level deeper than the parent key indent; derive the
  // unit from the difference when both are visible, otherwise guess two spaces.
  return indent;
}

/** Append entries to an existing JSON object without reformatting the rest. */
function appendObjectEntries(raw, keyName, additions, eol) {
  const { openIndex, closeIndex } = findObjectSpan(raw, keyName);
  const closingIndent = closingIndentOf(raw, closeIndex);
  const body = raw.slice(openIndex + 1, closeIndex);
  const entryMatch = /^([ \t]+)"/mu.exec(body);
  const entryIndent = entryMatch ? entryMatch[1] : `${closingIndent}  `;
  const trimmedBody = body.replace(/(?:\r?\n)?[ \t]*$/u, '');
  const separator = trimmedBody.trim() === '' ? '' : ',';
  const rendered = Object.keys(additions)
    .map((key) => `${entryIndent}${JSON.stringify(key)}: ${JSON.stringify(additions[key])}`)
    .join(`,${eol}`);
  const nextBody = `${trimmedBody}${separator}${eol}${rendered}${eol}${closingIndent}`;
  return raw.slice(0, openIndex + 1) + nextBody + raw.slice(closeIndex);
}

/** Insert a whole new top-level JSON object directly after an existing one. */
function insertTopLevelObject(raw, anchorKey, keyName, entries, eol) {
  const { closeIndex } = findObjectSpan(raw, anchorKey);
  const closingIndent = closingIndentOf(raw, closeIndex);
  const anchorIndent = /([ \t]*)$/u.exec(raw.slice(0, raw.indexOf(`"${anchorKey}"`)))[1];
  const entryIndent = `${anchorIndent}${detectIndentUnit(raw)}`;
  const block = `${JSON.stringify(keyName)}: {${eol}${Object.keys(entries)
    .map((key) => `${entryIndent}${JSON.stringify(key)}: ${JSON.stringify(entries[key])}`)
    .join(`,${eol}`)}${eol}${anchorIndent}}`;
  let probe = closeIndex + 1;
  while (probe < raw.length && /\s/u.test(raw[probe])) probe += 1;
  if (raw[probe] === ',') {
    // The anchor already owns the separator for whatever follows it, so the new
    // block takes over that separator and must supply its own trailing comma.
    return `${raw.slice(0, probe + 1)}${eol}${anchorIndent}${block},${raw.slice(probe + 1)}`;
  }
  // The anchor was the last member: it needs a comma of its own now.
  return `${raw.slice(0, closeIndex + 1)},${eol}${anchorIndent}${block}${raw.slice(closeIndex + 1)}`;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function facadeCommand(command) {
  return `${FACADE} ${command}`;
}

function isFacadeLifecycle(command, verb) {
  return new RegExp(`\\bsdkwork-app\\s+${verb}(?![\\w:-])`, 'u').test(command);
}

function isFacadeDev(command, profile) {
  return /\bsdkwork-app\s+dev(?![\w:-])/u.test(command)
    && new RegExp(`--deployment-profile\\s+${profile}(?![\\w-])`, 'u').test(command);
}

function isBareDevDelegation(command) {
  return /^pnpm\s+(?:run\s+)?dev:standalone$/u.test(String(command).trim());
}

// The order in which the fleet composes client surfaces into one build: the PC
// console first, then the mobile web surface, then the remaining targets. It
// matches how the aligned repositories spell their own build command.
const CLIENT_SURFACE_ORDER = [
  'pc',
  'h5',
  'mini-program',
  'tablet-ipados',
  'tablet-android',
  'browser',
  'desktop',
  'server',
  'container',
];

/**
 * The buildable client surfaces of a repository.
 * `apps/<app>-common` is the shared library tier rather than a runtime surface,
 * so it is excluded; a surface with no package.json belongs to another toolchain
 * (Flutter, native) and cannot be driven from the repository root.
 */
function clientSurfaces(repoRoot) {
  const appsRoot = path.join(repoRoot, 'apps');
  if (!fs.existsSync(appsRoot)) return [];
  return fs
    .readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.endsWith('-common'))
    .map((entry) => {
      const manifestPath = path.join(appsRoot, entry.name, 'package.json');
      if (!fs.existsSync(manifestPath)) return { name: entry.name, scripts: null };
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/u, ''));
        return { name: entry.name, scripts: parsed.scripts ?? {} };
      } catch {
        return { name: entry.name, scripts: null };
      }
    });
}

function surfaceRank(name) {
  const suffix = name.replace(/^sdkwork-[a-z0-9-]+?-(?=[a-z])/u, '');
  const index = CLIENT_SURFACE_ORDER.indexOf(suffix);
  return index === -1 ? CLIENT_SURFACE_ORDER.length : index;
}

/**
 * Derive the build command from what the repository already ships: its Rust
 * workspace plus each client surface's own production build. The `build:prod`
 * script is preferred over the bare `build` script because the repository build
 * is the production artefact, which is how the aligned repositories spell it.
 */
function deriveBuildParts(repoRoot) {
  const parts = [];
  if (fs.existsSync(path.join(repoRoot, 'Cargo.toml'))) {
    parts.push('cargo build --workspace --release');
  }
  const surfaces = clientSurfaces(repoRoot);
  const buildable = surfaces
    .filter((surface) => surface.scripts && (surface.scripts['build:prod'] || surface.scripts.build))
    .sort((a, b) => surfaceRank(a.name) - surfaceRank(b.name) || a.name.localeCompare(b.name));
  for (const surface of buildable) {
    parts.push(
      surface.scripts['build:prod']
        ? `pnpm --dir apps/${surface.name} run build:prod`
        : `pnpm --dir apps/${surface.name} build`,
    );
  }
  const skipped = surfaces
    .filter((surface) => !surface.scripts || !(surface.scripts['build:prod'] || surface.scripts.build))
    .map((surface) => surface.name);
  return { parts, skipped };
}

/**
 * Derive the check command by composing the verification commands the
 * repository already exposes, in the fleet's canonical order.
 */
function deriveCheckParts(repoRoot, scripts) {
  const parts = [];
  const push = (name) => {
    if (typeof scripts[name] !== 'string' || scripts[name].trim() === '') return;
    const command = `pnpm run ${name}`;
    if (!parts.includes(command)) parts.push(command);
  };
  push('check:app-composition');
  push('check:cors-standard');
  for (const name of Object.keys(scripts).filter((key) => /^check:[^:]+$/u.test(key)).sort()) push(name);
  for (const name of ['db:validate', 'api:assembly:validate', 'sdk:check', 'typecheck']) push(name);
  if (fs.existsSync(path.join(repoRoot, 'Cargo.toml'))) parts.push('cargo check --workspace');
  return parts;
}

/**
 * Section 7 requires an application root that owns
 * `crates/sdkwork-api-<application-code>-assembly/` to expose
 * `api:assembly:materialize` and `api:assembly:validate`, each directly invoking
 * its canonical sdkwork-specs tool. Both the requirement and the canonical
 * command text come from `check-pnpm-script-standard.mjs`, so the derived value
 * is byte-identical to what the gate accepts. A wrapped or drifted command is a
 * finding the standard explicitly forbids, so it is replaced rather than kept.
 */
function deriveApiAssemblyScripts(repoRoot, scripts) {
  const cratesDirectory = path.join(repoRoot, 'crates');
  if (!fs.existsSync(cratesDirectory)) return [];
  const ownsAssemblyCrate = fs.readdirSync(cratesDirectory)
    .some((entry) => /^sdkwork-api-[\w-]+-assembly$/u.test(entry));
  if (!ownsAssemblyCrate) return [];

  const derived = [];
  for (const [scriptName, toolName] of API_ASSEMBLY_SCRIPT_TOOLS) {
    const expected = canonicalApiAssemblyCommand(repoRoot, toolName);
    const current = scripts[scriptName];
    if (typeof current === 'string' && current.trim() === expected) continue;
    derived.push({ scriptName, expected, current });
  }
  return derived;
}

/**
 * Section 2 normalizes the default development runtimes to
 * `database = postgres` and `deploymentProfile = standalone`. The aligner mirrors
 * the gate's own predicate and, when it fires, moves the repository's existing
 * command into the profile-suffixed script and points the default at it — the
 * sanctioned `pnpm dev:<runtimeTarget>:postgres:standalone` delegation. The
 * command itself is never rewritten, only re-homed, so behaviour is preserved.
 */
function deriveDefaultDevRuntime(target, nextScripts, changes, decisions) {
  if (defaultDevRuntimeIssues(target, nextScripts).length === 0) return;
  const suffixed = `${target}:postgres:standalone`;
  const current = nextScripts[target];
  if (typeof nextScripts[suffixed] === 'string' && nextScripts[suffixed].trim() !== '') {
    // A profile-suffixed script already exists, so the repository shipped two
    // competing definitions and only the author can say which one wins.
    decisions.push(
      `${target}: must resolve to postgres/standalone; "${suffixed}" already exists, so the outdated default "${current}" is reported instead of being dropped`,
    );
    return;
  }
  nextScripts[suffixed] = current;
  nextScripts[target] = `pnpm ${suffixed}`;
  changes.push(`${target} <= pnpm ${suffixed}, which carries the previous command verbatim`);
}

/** Order script keys: keep the original order, pull the lifecycle block to the anchor, append hooks. */
export function orderScriptKeys(scripts, hooks) {
  const hookNames = Object.keys(hooks);
  const canonicalPublics = CANONICAL_ORDER.filter((command) => command in scripts);
  const ordered = {};
  let inserted = false;
  const emitCanonical = () => {
    for (const command of canonicalPublics) {
      ordered[command] = scripts[command];
    }
    inserted = true;
  };
  for (const key of Object.keys(scripts)) {
    if (key in ordered) continue;
    ordered[key] = scripts[key];
    if (!inserted && (key === 'stop' || key === 'dev')) emitCanonical();
  }
  if (!inserted) {
    const prefixed = {};
    for (const command of canonicalPublics) prefixed[command] = scripts[command];
    for (const key of Object.keys(ordered)) if (!(key in prefixed)) prefixed[key] = ordered[key];
    for (const hookName of hookNames) prefixed[hookName] = hooks[hookName];
    return prefixed;
  }
  for (const hookName of hookNames) ordered[hookName] = hooks[hookName];
  return ordered;
}

export function planRepositoryLifecycleFacade(repoRoot) {
  const packagePath = path.join(repoRoot, 'package.json');
  const raw = fs.readFileSync(packagePath, 'utf8').replace(/^\uFEFF/u, '');
  const manifest = JSON.parse(raw);
  const scripts = manifest.scripts ?? {};
  const hooks = {};
  const decisions = [];
  const changes = [];
  const nextScripts = { ...scripts };

  const profiles = supportedDeploymentProfiles(repoRoot);
  const applicationRoot = isApplicationRepositoryRoot(repoRoot);
  const stopNeedsWork = applicationRoot
    && (typeof scripts.stop !== 'string' || scripts.stop.trim() === ''
      || WORKSPACE_WIDE_STOP_PATTERN.test(scripts.stop));
  const invokesFacade = (source) => Object.values(source).some(
    (command) => typeof command === 'string' && /\bsdkwork-app\s/u.test(command),
  );
  // Only a repository that is incomplete against the required root commands, or
  // that already invokes the facade, is a conversion target. A repository that
  // exposes every required command with its own implementation conforms to the
  // standard's required-command contract; adopting the facade there is a
  // separate, deliberate decision rather than an alignment fix.
  //
  // A missing or unscoped `stop` deliberately does NOT make a repository a
  // conversion target. Handing `stop` to the facade only works when the facade
  // also owns `dev`, because the facade stops the process tree it recorded; for a
  // repository that keeps its own development runner, escalating a stop-only gap
  // into a wholesale lifecycle conversion would replace working lifecycle scripts
  // to fix a command that still could not find the processes it must stop. That
  // case is reported as an owner decision instead.
  const required = [
    ...DEVELOPMENT_COMMANDS.filter((command) => command !== 'dev:cloud' || profiles.has('cloud')),
    ...LIFECYCLE_COMMANDS,
  ];
  const incomplete = required.some(
    (command) => !(typeof scripts[command] === 'string' && scripts[command].trim() !== ''),
  );
  const facadeTarget = incomplete || invokesFacade(scripts);

  // Section 7 assembly commands and the section 2 default dev runtimes are
  // independent of the lifecycle facade, so they are aligned for every
  // application root — including one whose lifecycle is already complete. They
  // run before the lifecycle loop so that a newly derived `api:assembly:validate`
  // is visible to the `_sdkwork:check` composition, which keeps a second run a
  // no-op instead of a second edit.
  if (applicationRoot) {
    for (const entry of deriveApiAssemblyScripts(repoRoot, nextScripts)) {
      nextScripts[entry.scriptName] = entry.expected;
      changes.push(
        entry.current === undefined
          ? `${entry.scriptName} <= canonical sdkwork-specs tool (assembly crate present)`
          : `${entry.scriptName} <= replaced a non-canonical command with the canonical sdkwork-specs tool`,
      );
    }
    for (const target of ['dev:browser', 'dev:desktop']) {
      deriveDefaultDevRuntime(target, nextScripts, changes, decisions);
    }
  }

  if (!facadeTarget && changes.length === 0 && !stopNeedsWork) {
    return { packagePath, raw, manifest, scripts, nextScripts, hooks, addDependency: false, decisions, changes, skipped: 'complete' };
  }

  for (const command of facadeTarget ? LIFECYCLE_COMMANDS : []) {
    const hookName = `_sdkwork:${command}`;
    const current = scripts[command];
    const existingHook = scripts[hookName];
    if (typeof existingHook === 'string' && existingHook.trim() !== '') continue;

    if (typeof current === 'string' && current.trim() !== '' && !isFacadeLifecycle(current, command)) {
      hooks[hookName] = current;
      nextScripts[command] = facadeCommand(command);
      changes.push(`${hookName} <= moved verbatim from "${command}"`);
      continue;
    }
    if (typeof current === 'string' && isFacadeLifecycle(current, command)) {
      decisions.push(`${hookName}: "${command}" already delegates to the facade but no hook carries the real command`);
      continue;
    }
    if (command === 'check') {
      const parts = deriveCheckParts(repoRoot, scripts);
      if (parts.length > 0) {
        hooks[hookName] = parts.join(' && ');
        nextScripts[command] = facadeCommand(command);
        changes.push(`${hookName} <= composed from ${parts.length} existing verification commands`);
        continue;
      }
    }
    if (command === 'clean' && fs.existsSync(path.join(repoRoot, 'Cargo.toml'))) {
      hooks[hookName] = 'cargo clean';
      nextScripts[command] = facadeCommand(command);
      changes.push(`${hookName} <= derived "cargo clean" (Rust workspace)`);
      continue;
    }
    if (command === 'test' && fs.existsSync(path.join(repoRoot, 'Cargo.toml'))) {
      hooks[hookName] = 'cargo test --workspace';
      nextScripts[command] = facadeCommand(command);
      changes.push(`${hookName} <= derived "cargo test --workspace" (Rust workspace)`);
      continue;
    }
    if (command === 'build') {
      const { parts, skipped } = deriveBuildParts(repoRoot);
      if (parts.length > 0) {
        hooks[hookName] = parts.join(' && ');
        nextScripts[command] = facadeCommand(command);
        changes.push(`${hookName} <= composed from ${parts.length} existing build targets`);
        for (const surface of skipped) {
          decisions.push(`${hookName}: client surface apps/${surface} has no build script and is not covered by the composed build`);
        }
        continue;
      }
    }
    decisions.push(`${hookName}: "${command}" is absent and no tool command can be derived`);
  }

  // `verify` composes the aggregate the repository already exposes, once check
  // and test are settled. This mirrors how the aligned repositories define it.
  if (nextScripts.verify === undefined && !scripts['_sdkwork:verify']) {
    const hasCheck = nextScripts.check !== undefined && (hooks['_sdkwork:check'] ?? scripts['_sdkwork:check']);
    const hasTest = nextScripts.test !== undefined && (hooks['_sdkwork:test'] ?? scripts['_sdkwork:test']);
    if (hasCheck || hasTest) {
      const parts = [];
      if (hasCheck) parts.push('pnpm run check');
      if (hasTest) parts.push('pnpm run test');
      hooks['_sdkwork:verify'] = parts.join(' && ');
      nextScripts.verify = facadeCommand('verify');
      changes.push(`_sdkwork:verify <= composed from ${parts.join(' + ')}`);
      const index = decisions.findIndex((entry) => entry.startsWith('_sdkwork:verify:'));
      if (index !== -1) decisions.splice(index, 1);
    }
  }

  // Section 3 requires the public stop to be scoped to this application's own
  // development session: it must never operate on every process in the checkout.
  // Only a repository whose development session is started by the facade can
  // hand stop back to it, because that is the process tree the facade records in
  // its heartbeat registry. A repository with a bespoke development runner keeps
  // its own stop, and the gap is reported instead of replaced with a command
  // that would not find the processes it is supposed to stop.
  if (applicationRoot) {
    const stop = scripts.stop;
    // When dev:standalone is absent it is about to be added as the facade form,
    // so the facade will own this repository's development session.
    const standaloneScript = nextScripts['dev:standalone']
      ?? `${facadeCommand('dev')} --deployment-profile standalone`;
    const facadeOwnsDev = isFacadeDev(standaloneScript, 'standalone');
    if (facadeOwnsDev) {
      if (typeof stop !== 'string' || stop.trim() === '') {
        nextScripts.stop = facadeCommand('stop');
        changes.push('stop <= facade session-scoped stop');
      } else if (WORKSPACE_WIDE_STOP_PATTERN.test(stop)) {
        nextScripts.stop = facadeCommand('stop');
        changes.push('stop <= replaced the workspace-wide process killer with the facade session-scoped stop');
      }
    } else if (typeof stop === 'string' && WORKSPACE_WIDE_STOP_PATTERN.test(stop)) {
      decisions.push(
        'stop: a workspace-wide process killer is not scoped to this application, but a bespoke development runner stops nothing the facade recorded; the repository needs its own session-scoped stop',
      );
    } else if (typeof stop !== 'string' || stop.trim() === '') {
      decisions.push(
        'stop: "dev" is exposed but no scoped stop exists; the repository keeps its own development runner, so it must add a session-scoped stop rather than delegate to a facade that never started it',
      );
    }
  }

  for (const profile of ['standalone', 'cloud']) {
    const command = `dev:${profile}`;
    // The required-command contract makes `dev` and `dev:standalone`
    // unconditional and gates only `dev:cloud` on the declared profiles, because
    // section 2 keeps `pnpm dev` permanently equivalent to `pnpm dev:standalone`.
    // A repository that declares cloud-only profiles therefore still receives
    // dev:standalone; the profile declaration is the anomaly to resolve, not
    // this script.
    if (profile === 'cloud' && !profiles.has('cloud')) continue;
    const current = scripts[command];
    if (typeof current === 'string' && isFacadeDev(current, profile)) continue;
    if (typeof current === 'string' && current.trim() !== '') {
      decisions.push(`${command} exists with a non-facade value: ${current}`);
      continue;
    }
    nextScripts[command] = `${facadeCommand('dev')} --deployment-profile ${profile}`;
    changes.push(`${command} <= facade delegation`);
  }

  if (nextScripts.dev === undefined) {
    nextScripts.dev = 'pnpm dev:standalone';
    changes.push('dev <= pnpm dev:standalone');
  } else if (!isBareDevDelegation(nextScripts.dev)) {
    const hookName = '_sdkwork:dev:standalone';
    if (scripts[hookName] === undefined || scripts[hookName] === '') {
      // Section 2 sanctions the previous development runner as a migration-only
      // private hook until generic topology processes replace it.
      hooks[hookName] = nextScripts.dev;
      changes.push(`${hookName} <= moved verbatim from "dev"`);
    }
    nextScripts.dev = 'pnpm dev:standalone';
    changes.push('dev <= pnpm dev:standalone');
  }

  const declared =
    manifest.dependencies?.[APP_TOPOLOGY_PACKAGE]
    ?? manifest.devDependencies?.[APP_TOPOLOGY_PACKAGE];
  const usesFacade = Object.values(nextScripts).some(
    (command) => typeof command === 'string' && /\bsdkwork-app\s/u.test(command),
  );
  const addDependency = usesFacade && declared === undefined;

  return { packagePath, raw, manifest, scripts, nextScripts, hooks, addDependency, decisions, changes };
}

export function applyRepositoryLifecycleFacade(repoRoot, { dryRun = true } = {}) {
  const plan = planRepositoryLifecycleFacade(repoRoot);
  if (plan.changes.length === 0 && !plan.addDependency) return { ...plan, written: false };

  const eol = detectEol(plan.raw);
  const newHooks = {};
  for (const [hookName, value] of Object.entries(plan.hooks)) {
    if (plan.scripts[hookName] === undefined) newHooks[hookName] = value;
  }

  let next = spliceObjectBody(plan.raw, 'scripts', orderScriptKeys(plan.nextScripts, newHooks), eol);
  if (plan.addDependency) {
    const dependency = { [APP_TOPOLOGY_PACKAGE]: 'workspace:*' };
    next = plan.manifest.devDependencies === undefined
      ? insertTopLevelObject(next, 'scripts', 'devDependencies', dependency, eol)
      : appendObjectEntries(next, 'devDependencies', dependency, eol);
  }

  if (dryRun) return { ...plan, serialized: next, written: false };

  const before = fs.statSync(plan.packagePath).size;
  fs.writeFileSync(plan.packagePath, next, 'utf8');
  // Prove the write landed rather than trusting the call's return value.
  const reread = JSON.parse(fs.readFileSync(plan.packagePath, 'utf8').replace(/^\uFEFF/u, ''));
  const expectedScripts = orderScriptKeys(plan.nextScripts, newHooks);
  const landed = JSON.stringify(reread.scripts) === JSON.stringify(expectedScripts)
    && (!plan.addDependency || reread.devDependencies?.[APP_TOPOLOGY_PACKAGE] === 'workspace:*');
  if (!landed) throw new Error(`write verification failed for ${plan.packagePath}`);
  return { ...plan, serialized: next, written: true, bytesBefore: before, bytesAfter: next.length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function listWorkspaceRoots(workspaceRoot) {
  return fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith('sdkwork-'))
    .map((name) => path.join(workspaceRoot, name))
    .filter((root) => fs.existsSync(path.join(root, 'package.json')))
    // Only application roots owe the facade contract. sdkwork-specs, the Rust
    // libraries, and the topology framework itself are not applications, and
    // converting them would add a delegation that no standard asks for.
    .filter((root) => isApplicationRepositoryRoot(root))
    .sort();
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      root: { type: 'string', multiple: true },
      apply: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const roots = values.root?.length
    ? values.root
    : listWorkspaceRoots(values.workspace ?? DEFAULT_WORKSPACE);

  const report = [];
  for (const repoRoot of roots) {
    const result = applyRepositoryLifecycleFacade(repoRoot, { dryRun: !values.apply });
    // Repositories with nothing to convert are not targets; reporting their
    // unrelated gaps would bury the repositories that do need work.
    if (result.changes.length === 0) continue;
    report.push({
      repository: path.basename(path.resolve(repoRoot)),
      changes: result.changes,
      decisions: result.decisions,
      wrote: result.written,
    });
  }

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  for (const entry of report) {
    process.stdout.write(`${entry.repository}${entry.wrote ? '  (applied)' : ''}\n`);
    for (const change of entry.changes) process.stdout.write(`  + ${change}\n`);
    for (const decision of entry.decisions) process.stdout.write(`  ? ${decision}\n`);
  }
  process.stdout.write(
    `\n[align-pnpm-lifecycle-facade] repositories: ${roots.length}  touched: ${report.length}`
    + `  applied: ${report.filter((entry) => entry.wrote).length}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
