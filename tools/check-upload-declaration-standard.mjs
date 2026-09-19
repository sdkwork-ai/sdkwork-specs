#!/usr/bin/env node
// DRIVE_SPEC.md §18 (Application Upload Declaration Contract) checker.
//
// Upload is a platform capability, not an application feature: every application
// that uploads declares its upload identity once, and its call sites consume that
// declaration instead of inventing local literals. The obligation was prose until
// section 18 defined a home and a shape; this checker is what makes it executable.
//
// What it verifies, per §18.1/§18.2/§18.4:
//   1. Every application root that performs an upload ships
//      `<application-root>/specs/upload.declaration.json`.
//   2. The file parses, uses `schemaVersion` 1, and carries no unknown field
//      (§18.1: unknown fields must be rejected, not ignored).
//   3. `appId` equals the root's `sdkwork.app.config.json` `backend.appId`.
//   4. Every entry has the required fields with the right types; `retention` is
//      `long_term` or `temporary`, and a `temporary` entry declares its TTL.
//   5. `appResourceType` is dotted lowercase with >= 2 segments, `scene` and
//      `source` are lowercase kebab-case, `source` is not a package name or
//      import path, and `scene` is not the reserved Drive scene `im`.
//   6. `uploadProfileCode` is a DRIVE_SPEC §8.1 standard profile.
//   7. Every entry declares a distinct
//      `(appResourceType, scene, uploadProfileCode)` triple.
//   8. No upload call site passes a `source`, `scene`, or `appResourceType`
//      value absent from the declaration (§18.4 call-site conformance).
//
// Usage: node tools/check-upload-declaration-standard.mjs [--workspace <root>]
// Exit code 0 = pass, 1 = violations, 2 = invocation error.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DECLARATION_RELATIVE_PATH = 'specs/upload.declaration.json';
const APP_CONFIG_NAME = 'sdkwork.app.config.json';

/** DRIVE_SPEC.md §8.1 standard upload profiles. */
const STANDARD_UPLOAD_PROFILES = new Set([
  'generic', 'video', 'image', 'audio', 'document', 'archive',
  'text', 'dataset', 'attachment', 'avatar', 'thumbnail',
]);

/** DRIVE_SPEC.md §9.4 reserves `im` for Drive; an application must not send it. */
const RESERVED_SCENES = new Set(['im']);

/** The only keys a declaration entry may carry (DRIVE_SPEC.md §18.1 field table). */
const ENTRY_FIELDS = new Set([
  'appResourceType', 'appResourceIdKind', 'scene', 'source',
  'uploadProfileCode', 'retention', 'retentionTtlSeconds', 'purpose',
]);
const TOP_LEVEL_FIELDS = new Set(['schemaVersion', 'appId', 'declarations']);
const APP_RESOURCE_ID_KINDS = new Set(['application', 'entity', 'draft']);
const RETENTION_MODES = new Set(['long_term', 'temporary']);

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const APP_RESOURCE_TYPE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/u;

/**
 * Upload call syntax for the Drive Uploader SDK (`DRIVE_SPEC.md` §9). Three shapes occur in the
 * fleet, so all three are matched:
 *   - a direct call, `uploader.uploadByProfile('archive', {...})`;
 *   - a profile-implied call, `uploader.uploadImage({...})`;
 *   - a bound reference collected for later invocation, `uploader.uploadImage.bind(uploader)`.
 * Kept narrow enough that the scan reports source files, not bundled output or prose.
 */
const UPLOAD_CALL_PATTERN = /\.upload(?:ByProfile|Image|Video|Audio|Document|Archive|Text|Dataset|Attachment|Avatar|Thumbnail)?\s*(?:\?\.)?\s*(?:\(|\.\s*bind\b)/u;

/** Directories that never hold authored source. */
const IGNORED_DIRECTORIES = new Set([
  'node_modules', 'dist', 'build', 'target', 'coverage', '.git', '.turbo',
  '.next', '.output', '.sdkwork', 'lib', '__pycache__', 'vendor',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function readDirectorySafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Discover `<repo>/apps/<app-root>/` application roots across the workspace.
 *
 * APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md §2 notes an `apps/` child may be a runnable
 * client surface or a shared `-common` package-family root; both are application roots for
 * declaration purposes, so both are returned.
 */
function discoverAppRoots(workspaceRoot) {
  const roots = [];
  for (const repo of readDirectorySafe(workspaceRoot)) {
    if (!repo.isDirectory() || repo.name.startsWith('.')) continue;
    const appsDir = path.join(workspaceRoot, repo.name, 'apps');
    if (!fs.existsSync(appsDir)) continue;
    for (const child of readDirectorySafe(appsDir)) {
      if (!child.isDirectory()) continue;
      roots.push({
        repository: repo.name,
        name: child.name,
        dir: path.join(appsDir, child.name),
        relative: `${repo.name}/apps/${child.name}`,
      });
    }
  }
  return roots;
}

/** Walk one application root's authored source, skipping build and vendor output. */
function listAuthoredSources(rootDir) {
  const files = [];
  function walk(dir, depth) {
    if (depth > 12) return;
    for (const entry of readDirectorySafe(dir)) {
      if (entry.name.startsWith('.') && entry.name !== '.') {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      // A `.d.ts` is a declaration file, never a call site.
      if (entry.name.endsWith('.d.ts')) continue;
      files.push(full);
    }
  }
  walk(rootDir, 0);
  return files;
}

/** A minified bundle is output, not an authored call site; long lines are the tell. */
function isBundledOutput(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  let longest = 0;
  for (const line of text.split('\n')) {
    if (line.length > longest) longest = line.length;
    if (longest > 2000) return true;
  }
  return false;
}

/**
 * Strip block and line comments before pattern matching.
 *
 * The fleet contains prose such as "(the standard IM H5 pattern: `uploader.uploadImage` -> ...)",
 * which is documentation of a call site rather than one. Matching raw text would report the
 * documenting file as an uploader, so comments are removed for detection purposes only; the
 * original text is still used for value extraction.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gu, '$1 ');
}

/** Collect `uploader.upload*(...)` call sites in one file. */
function findUploadCallSites(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  if (!UPLOAD_CALL_PATTERN.test(stripComments(text))) return [];
  if (isBundledOutput(file)) return [];
  return [file];
}

function grabStringLiterals(text, propertyName) {
  const values = new Set();
  const pattern = new RegExp(`\\b${propertyName}\\s*:\\s*[\`"']([^\`"']+)[\`"']`, 'gu');
  for (const match of text.matchAll(pattern)) values.add(match[1]);
  return values;
}

/**
 * Resolve file-local string constants so a value cannot hide behind an identifier.
 *
 * A call site may pass `appResourceType: CHAT_DRIVE_APP_RESOURCE_TYPE` instead of a literal. An
 * argument-region scan alone sees only an identifier and reports nothing, which is exactly how a
 * reserved `scene = 'im'` survived in one root while its sibling was being fixed. This collects
 * every `const NAME = 'value'` in the file and maps name -> value so the sent-value scan can
 * resolve such references.
 *
 * Only single-quoted/double-quoted/template literals with no interpolated expression are
 * collected; a computed value stays unresolved and is reported as such rather than guessed.
 */
function collectLocalStringConstants(text) {
  const constants = new Map();
  const pattern = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*[`'"]([^`'"]*)[`'"]\s*[;,)]/gu;
  for (const match of text.matchAll(pattern)) {
    constants.set(match[1], match[2]);
  }
  return constants;
}

/**
 * Collect the literal `appResourceType`/`scene`/`source` values a root actually passes to an
 * upload call, resolving file-local constants.
 *
 * Scoping matters: `source` is also a field of the returned `MediaResource` (where it states that
 * the resource lives in Drive), so scanning a whole file would report non-upload literals and
 * drive a "fix" that corrupts unrelated code. Only the argument region of each upload call is
 * inspected.
 */
function collectSentValues(callSites) {
  const sent = { appResourceType: new Set(), scene: new Set(), source: new Set() };
  for (const file of callSites) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    const constants = collectLocalStringConstants(text);
    for (const region of uploadCallArgumentRegions(text)) {
      for (const key of Object.keys(sent)) {
        for (const value of grabStringLiterals(region, key)) sent[key].add(value);
        // Resolve `key: SOME_LOCAL_CONSTANT` so a hidden value is still audited.
        const identifierPattern = new RegExp(
          `\\b${key}\\s*:\\s*([A-Za-z_$][A-Za-z0-9_$]*)\\b`,
          'gu',
        );
        for (const match of region.matchAll(identifierPattern)) {
          const resolved = constants.get(match[1]);
          if (resolved !== undefined) sent[key].add(resolved);
        }
      }
    }
  }
  return sent;
}

/**
 * Return the argument text of every upload call in `text`.
 *
 * Balanced-delimiter scan from each `upload*(` open paren. Unbalanced input ends the region at
 * the end of the file rather than throwing, so a partially written file is reported, not crashed.
 */
function uploadCallArgumentRegions(text) {
  const regions = [];
  const opener = /\.upload(?:ByProfile|Image|Video|Audio|Document|Archive|Text|Dataset|Attachment|Avatar|Thumbnail)?\s*(?:\?\.)?\s*\(/gu;
  for (const match of text.matchAll(opener)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let index = start;
    let inString = null;
    while (index < text.length && depth > 0) {
      const char = text[index];
      if (inString) {
        if (char === '\\') index += 1;
        else if (char === inString) inString = null;
      } else if (char === '"' || char === "'" || char === '`') {
        inString = char;
      } else if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
      }
      index += 1;
    }
    regions.push(text.slice(start, depth === 0 ? index - 1 : text.length));
  }
  return regions;
}

function validateDeclarationShape(root, declaration, issues) {
  const label = `${root.relative}/${DECLARATION_RELATIVE_PATH}`;

  if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) {
    issues.push(`${label}: declaration must be a JSON object`);
    return false;
  }

  for (const key of Object.keys(declaration)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      issues.push(`${label}: unknown top-level field "${key}" (DRIVE_SPEC §18.1 rejects unknown fields)`);
    }
  }

  if (declaration.schemaVersion !== 1) {
    issues.push(`${label}: schemaVersion must be 1, found ${JSON.stringify(declaration.schemaVersion)}`);
  }

  let ok = true;

  const canonicalAppId = readCanonicalAppId(root, issues);
  if (canonicalAppId !== null && declaration.appId !== canonicalAppId) {
    issues.push(
      `${label}: appId "${declaration.appId}" does not equal ${APP_CONFIG_NAME} backend.appId "${canonicalAppId}" (DRIVE_SPEC §18.1)`,
    );
    ok = false;
  }

  if (!Array.isArray(declaration.declarations) || declaration.declarations.length === 0) {
    issues.push(`${label}: declarations must be a non-empty array`);
    return false;
  }

  const triples = new Set();
  const identities = new Set();
  for (const [index, entry] of declaration.declarations.entries()) {
    const where = `${label} declarations[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      issues.push(`${where}: entry must be a JSON object`);
      ok = false;
      continue;
    }

    for (const key of Object.keys(entry)) {
      if (!ENTRY_FIELDS.has(key)) {
        issues.push(`${where}: unknown field "${key}" (DRIVE_SPEC §18.1 rejects unknown fields)`);
        ok = false;
      }
    }

    for (const field of ['appResourceType', 'appResourceIdKind', 'scene', 'source', 'uploadProfileCode', 'retention', 'purpose']) {
      if (!entry[field]) {
        issues.push(`${where}: missing required field "${field}"`);
        ok = false;
      }
    }

    if (entry.appResourceType && !APP_RESOURCE_TYPE.test(entry.appResourceType)) {
      issues.push(
        `${where}: appResourceType "${entry.appResourceType}" is not a dotted lowercase <domain>.<resource> type (DRIVE_SPEC §18.2)`,
      );
      ok = false;
    }

    if (entry.appResourceIdKind && !APP_RESOURCE_ID_KINDS.has(entry.appResourceIdKind)) {
      issues.push(
        `${where}: appResourceIdKind "${entry.appResourceIdKind}" must be one of application|entity|draft (DRIVE_SPEC §18.1)`,
      );
      ok = false;
    }

    if (entry.scene) {
      if (!KEBAB_CASE.test(entry.scene)) {
        issues.push(`${where}: scene "${entry.scene}" is not lowercase kebab-case (DRIVE_SPEC §18.2)`);
        ok = false;
      }
      if (RESERVED_SCENES.has(entry.scene)) {
        issues.push(`${where}: scene "${entry.scene}" is reserved by Drive and must not be declared (DRIVE_SPEC §9.4)`);
        ok = false;
      }
    }

    if (entry.source) {
      if (!KEBAB_CASE.test(entry.source)) {
        issues.push(`${where}: source "${entry.source}" is not lowercase kebab-case (DRIVE_SPEC §18.2)`);
        ok = false;
      }
      if (entry.source.includes('/') || entry.source.includes('@')) {
        issues.push(
          `${where}: source "${entry.source}" looks like a package name or import path, which is forbidden (DRIVE_SPEC §18.2)`,
        );
        ok = false;
      }
    }

    if (entry.uploadProfileCode && !STANDARD_UPLOAD_PROFILES.has(entry.uploadProfileCode)) {
      issues.push(
        `${where}: uploadProfileCode "${entry.uploadProfileCode}" is not a DRIVE_SPEC §8.1 standard profile`,
      );
      ok = false;
    }

    if (entry.retention) {
      if (!RETENTION_MODES.has(entry.retention)) {
        issues.push(`${where}: retention "${entry.retention}" must be long_term or temporary (DRIVE_SPEC §18.1)`);
        ok = false;
      }
      if (entry.retention === 'temporary' && !entry.retentionTtlSeconds) {
        issues.push(`${where}: temporary retention must also declare retentionTtlSeconds (DRIVE_SPEC §18.1)`);
        ok = false;
      }
    }

    if (entry.appResourceType && entry.scene && entry.uploadProfileCode) {
      // §18.4: a triple identifies one upload purpose. Two surfaces of one
      // application may share a purpose and differ only by `source`; that is a
      // legitimate pair, not a duplicate. A duplicate is therefore the same
      // triple *and* the same `source`. The triple+source pair stays unique, so
      // this cannot be used to give one purpose two names on one surface.
      const triple = `${entry.appResourceType}|${entry.scene}|${entry.uploadProfileCode}`;
      const identity = `${triple}|${entry.source ?? ''}`;
      if (identities.has(identity)) {
        issues.push(
          `${where}: duplicate (appResourceType, scene, uploadProfileCode, source) entry "${identity}" (DRIVE_SPEC §18.4)`,
        );
        ok = false;
      }
      identities.add(identity);
      triples.add(triple);
    }
  }

  return ok;
}

/**
 * §18.1: `appId` must equal this root's canonical config appId.
 *
 * Authority order, because the fleet is not uniform:
 *   1. the root's own `sdkwork.app.config.json`, `backend.appId`;
 *   2. the root's own config `app.key`, when `backend` is declared but empty;
 *   3. the repository's `sdkwork.app.config.json`, `backend.appId` then `app.key`;
 *   4. the hosting runnable sibling root's value, for a shared `-common` root
 *      (`APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2 makes `-common` a shared
 *      package-family root rather than a runnable surface, so it inherits the app identity
 *      of the surface it serves).
 *
 * Returns `null` when no authority exists, so the caller reports the gap rather than
 * inventing a value.
 */
function readCanonicalAppId(root, issues) {
  const ownConfig = readConfigIdentity(path.join(root.dir, APP_CONFIG_NAME));
  if (ownConfig?.invalid) {
    issues.push(`${root.relative}/${APP_CONFIG_NAME}: not valid JSON (${ownConfig.error})`);
    return null;
  }
  if (ownConfig?.appId) return ownConfig.appId;

  const repoConfig = readConfigIdentity(path.join(root.dir, '..', '..', APP_CONFIG_NAME));
  if (repoConfig?.appId) return repoConfig.appId;

  if (root.name.endsWith('-common')) {
    const appsDir = path.join(root.dir, '..');
    for (const sibling of readDirectorySafe(appsDir)) {
      if (!sibling.isDirectory() || sibling.name === root.name) continue;
      const siblingConfig = readConfigIdentity(path.join(appsDir, sibling.name, APP_CONFIG_NAME));
      if (siblingConfig?.appId) return siblingConfig.appId;
    }
  }

  return null;
}

/** Read one config file's identity, tolerating a missing file. */
function readConfigIdentity(file) {
  if (!fs.existsSync(file)) return null;
  let config;
  try {
    config = readJson(file);
  } catch (error) {
    return { invalid: true, error: error.message };
  }
  for (const candidate of [config?.backend?.appId, config?.app?.key]) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return { appId: candidate };
    }
  }
  return {};
}

/** §18.4: no call site may send a value absent from the declaration. */
function validateCallSiteConformance(root, declaration, callSites, issues) {
  if (callSites.length === 0) return;
  const declared = {
    appResourceType: new Set(declaration.declarations?.map((e) => e?.appResourceType).filter(Boolean) ?? []),
    scene: new Set(declaration.declarations?.map((e) => e?.scene).filter(Boolean) ?? []),
    source: new Set(declaration.declarations?.map((e) => e?.source).filter(Boolean) ?? []),
  };
  const sent = collectSentValues(callSites);
  const sentToDeclarationFile = path.join(root.dir, DECLARATION_RELATIVE_PATH);

  for (const key of Object.keys(declared)) {
    for (const value of sent[key]) {
      if (declared[key].has(value)) continue;
      // A root may legitimately re-export its own declaration constants; the values still
      // have to be declared, so an undeclared value is always a finding.
      issues.push(
        `${root.relative}: upload call site sends ${key} "${value}", which is not declared in ${path.relative(root.dir, sentToDeclarationFile).replace(/\\/gu, '/')} (DRIVE_SPEC §18.4)`,
      );
    }
  }
}

export function validateUploadDeclarations(workspaceRoot) {
  const issues = [];
  const roots = discoverAppRoots(workspaceRoot);
  let declaringRoots = 0;
  let uploadingRoots = 0;

  for (const root of roots) {
    const declarationPath = path.join(root.dir, DECLARATION_RELATIVE_PATH);
    const hasDeclaration = fs.existsSync(declarationPath);

    const callSites = listAuthoredSources(root.dir)
      .flatMap((file) => findUploadCallSites(file));
    const uploads = callSites.length > 0;
    if (uploads) uploadingRoots += 1;

    if (!hasDeclaration) {
      // §18.4: an upload feature is not complete while the declaration is missing.
      if (uploads) {
        issues.push(
          `${root.relative}: performs an upload but has no ${DECLARATION_RELATIVE_PATH} (DRIVE_SPEC §18.1)`,
        );
      }
      continue;
    }

    declaringRoots += 1;
    let declaration;
    try {
      declaration = readJson(declarationPath);
    } catch (error) {
      issues.push(`${root.relative}/${DECLARATION_RELATIVE_PATH}: not valid JSON (${error.message})`);
      continue;
    }

    if (validateDeclarationShape(root, declaration, issues)) {
      validateCallSiteConformance(root, declaration, callSites, issues);
    }
  }

  return { issues, roots: roots.length, uploadingRoots, declaringRoots };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      workspace: { type: 'string', short: 'w', default: '.' },
      strict: { type: 'boolean', default: false },
    },
  });
  const workspaceRoot = path.resolve(values.workspace);
  if (!fs.existsSync(workspaceRoot)) {
    console.error(`check-upload-declaration-standard: workspace root does not exist: ${workspaceRoot}`);
    return 2;
  }

  const { issues, roots, uploadingRoots, declaringRoots } = validateUploadDeclarations(workspaceRoot);

  if (issues.length === 0) {
    console.log(
      `check-upload-declaration-standard: PASS (${declaringRoots}/${uploadingRoots} uploading application roots declared, ${roots} roots scanned)`,
    );
    return 0;
  }

  for (const issue of issues) console.error(`- ${issue}`);
  console.error(
    `check-upload-declaration-standard: ${issues.length} violation(s) across ${uploadingRoots} uploading application roots (${declaringRoots} declared, ${roots} scanned)`,
  );
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
