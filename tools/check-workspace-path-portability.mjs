#!/usr/bin/env node

/**
 * Validate that no source, configuration, or documentation file binds to a
 * machine-specific absolute path into the SDKWork workspace.
 *
 * Authority: `DEPENDENCY_MANAGEMENT_SPEC.md` section 1 — "Source/build
 * dependency paths `MUST` be repository-relative, workspace-relative, or native
 * package-manager coordinates. They must be portable across Windows, macOS, and
 * Linux" / "`MUST NOT` be machine-specific absolute paths" — and section 9's
 * checklist item "Source/build config contains no machine-specific absolute
 * paths".
 *
 * Those clauses described the requirement but no gate executed it, which is the
 * structural reason the fleet accumulated several hundred stale absolute paths:
 * when the workspace was relocated to a different drive every one of them broke
 * at once and nothing failed up front. This tool is that missing executor.
 *
 * Usage:
 *   node tools/check-workspace-path-portability.mjs --workspace <dir>
 *   node tools/check-workspace-path-portability.mjs --root <dir> [--root <dir2> ...]
 *   [--workspace-name sdkwork-space] [--exclude dir,dir] [--workspace-only]
 *
 * Rules (all are errors; the process exits 1 when any is reported)
 *
 *   WORKSPACE-ABS     An absolute path whose segment chain contains the
 *                     workspace directory basename (`--workspace-name`, which
 *                     defaults to `sdkwork-space`), whatever the volume prefix
 *                     is: `<drive>:\<workspace-name>\...`,
 *                     `<drive>:/<workspace-name>/...`,
 *                     `/mnt/<drive>/<workspace-name>/...`,
 *                     `/<drive>/<workspace-name>/...`,
 *                     `/home/<user>/<workspace-name>/...`, and the URL form
 *                     `file:///<drive>/<workspace-name>/...`.
 *                     The workspace root is relocatable by definition, so any
 *                     absolute reference to it is a defect.
 *
 *   SIBLING-REPO-ABS  An absolute path whose segment chain contains a
 *                     `sdkwork-<name>` repository segment, e.g.
 *                     `<drive>:\some-other-root\sdkwork-<name>\...`. Sibling
 *                     repositories are resolved through the consuming workspace
 *                     mechanism (`DEPENDENCY_MANAGEMENT_SPEC.md` section 3),
 *                     never by absolute location.
 *
 *   MACHINE-ABS       Any machine-rooted absolute path outside the runtime
 *                     install roots: a drive-rooted toolchain or installer-cache
 *                     directory, a POSIX home directory (`/home` or `/Users`
 *                     followed by a user name), a Windows profile directory, or
 *                     an MSYS-style drive mount. Reported by default: a
 *                     hardcoded home directory, toolchain root, or installer
 *                     cache path is exactly what breaks when the same tree is
 *                     built on another machine or another operating system,
 *                     which is the defect this gate exists to catch.
 *                     `--workspace-only` narrows the run to the two workspace
 *                     rules for a quick check of one touch.
 *                     `--include-machine-paths` is retained as a compatibility
 *                     alias: it used to be the opt-in for this rule and is now
 *                     the default, so passing it changes nothing.
 *
 * Exemption, line scope: a line is exempt when it, or a comment up to
 * `MARKER_WINDOW` lines above it, carries `WORKSPACE-PATH:allow` — use it only
 * for a path that is genuinely not a source/build binding (for example a
 * documented runtime target path, or the literal a normalisation assertion
 * pins). The window spans a statement rather than one physical line, because
 * rustfmt and prettier wrap a single call across several lines.
 *
 * Exemption, file scope: `WORKSPACE-PATH:allow-fixture` within the first
 * `FIXTURE_MARKER_HEADER_LINES` lines exempts a whole **test** file. A fixture
 * that simulates a foreign checkout root names that root in its own data, and
 * the `sdkwork-<name>` segment is frequently the value under assertion — a
 * chunk name derived from the path, a project code derived from the directory,
 * a simulated shell prompt — so neither genericizing the fixture nor exempting
 * it line by line is the right remedy, and SIBLING-REPO-ABS cannot by itself
 * tell such a fixture from a real reference to a sibling checkout. The marker
 * is honoured only in a test file; elsewhere it has no effect and every finding
 * still fails the gate, so it can never conceal a production binding. The
 * files it exempts are always listed in the output.
 *
 * Exemption, directory scope: a test-scoped directory containing a marker file
 * named `.workspace-path-fixture` exempts the scannable files beneath it. This
 * exists because a `.json` conformance corpus or a `.txt` expected-output
 * snapshot is fixture data with nowhere to put a comment, and its value under
 * assertion is precisely the foreign absolute path. As with the file-scope
 * marker, the directory must be test-scoped, so the marker cannot exempt
 * production source; the exempt files are listed in the output.
 *
 * Scanned: source, configuration, and documentation files by extension, plus a
 * small set of well-known extensionless files. Directories that are dependency,
 * build-output, or agent-scratch state are skipped, matching the exclusion
 * table in `PORTABILITY_SPEC.md` section 5.1; a gate that reports hundreds of
 * phantom hits is a gate nobody reads.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const MARKER = 'WORKSPACE-PATH:allow';
// A statement, not a physical line. rustfmt and prettier wrap one call across
// several lines, so a two-line window reported the literals inside a multi-line
// `assert_eq!` even when the author had marked them — the marker was read as
// absent because the assertion's first line sat more than two rows below it.
const MARKER_WINDOW = 8;
const FIXTURE_MARKER = 'WORKSPACE-PATH:allow-fixture';
// The file-scope marker has to be a comment, which a `.json` conformance corpus
// or a `.txt` expected-output snapshot cannot carry — yet those are exactly the
// fixtures whose value under assertion is a foreign absolute path. A marker file
// of this name in a test-scoped directory exempts the directory's subtree, so the
// reason lives in a file a reviewer can read instead of in a format that has no
// place to put it.
const FIXTURE_DIR_MARKER = '.workspace-path-fixture';
// Rust keeps its unit tests in the same file as the code, behind `#[cfg(test)]`.
// Those modules are fixtures by construction — measured 2026-09-15, 205 of the
// fleet's 218 `.rs` findings sit below a `#[cfg(test)]` attribute — and the file
// is not a test file by path, so neither the file-scope nor the directory-scope
// marker reaches them. This marker declares that the file's trailing `#[cfg(test)]`
// module is fixture data: it exempts that module and nothing above it. See
// fixtureBlockRange for why the region is located from the file's last real
// `#[cfg(test)]` rather than from the marker's own line.
const FIXTURE_BLOCK_MARKER = 'WORKSPACE-PATH:allow-fixture-block';
// `#[cfg(test)]` with optional interior whitespace: Rust accepts `#[cfg( test )]`,
// and rustfmt never reflows an attribute, so the looser form costs nothing and
// avoids a marker that silently stops working under a hand-edit.
const FIXTURE_BLOCK_ANCHOR_RE = /#\[\s*cfg\s*\(\s*test\s*\)\s*\]/;
// The file-scope marker belongs in the header, so a reviewer reads the reason
// next to the file's own description instead of next to one fixture line.
const FIXTURE_MARKER_HEADER_LINES = 20;
const MAX_BYTES = 512 * 1024;
const DEFAULT_WORKSPACE_NAME = 'sdkwork-space';

// Directory names never scanned: dependency state, build output, agent scratch.
// Kept identical to `check-shell-portability.mjs` so the two gates agree on what
// "our source" means.
const DEFAULT_EXCLUDES = Object.freeze([
  'node_modules', '.git', 'target',
  'external', 'vendor',
  'dist', 'build', 'out', 'bak', 'coverage', '.next',
  // `obj/` and `.vs/` were added 2026-09-15 alongside the PORTABILITY_SPEC.md
  // section 5.1 table. `obj/` is the .NET/MSBuild intermediate output directory
  // — the exact counterpart of `target/`, which was already excluded — and it
  // is where NuGet restore writes `project.assets.json` /
  // `*.csproj.nuget.dgspec.json` full of the generating machine's absolute
  // paths. `.vs/` is Visual Studio's per-user IDE state. Both are regenerated
  // locally, so auditing them only produces phantom findings.
  'obj', '.vs',
  // `.dart_tool/` was added 2026-09-15. It is Dart/Flutter's tool state
  // directory — the counterpart of `node_modules/` and `target/` — and
  // `dart pub get` writes the generating machine's package-cache path into
  // `.dart_tool/package_config.json` for every dependency, spelled as a
  // `file:///` URL that names the drive letter of the generating machine.
  // Three committed copies in `sdkwork-agents` carried 113 such entries.
  // Regenerated by `pub get`, so auditing them only produces phantom findings.
  '.dart_tool',
  '.workbuddy', '.sdkwork', '.tmp', 'tmp', '.wsl-tmp',
]);

const CODE_EXT = new Set([
  '.sh', '.bash', '.zsh', '.ksh', '.ps1', '.psm1', '.bat', '.cmd',
  '.mjs', '.cjs', '.js', '.ts', '.mts', '.cts', '.tsx', '.jsx',
  '.py', '.rs', '.java', '.kt', '.kts', '.gradle', '.dart', '.go',
  '.rb', '.php', '.lua', '.pl', '.swift', '.cs', '.c', '.cc', '.cpp',
  '.h', '.hpp', '.mm', '.vue', '.svelte',
]);

const CONFIG_EXT = new Set([
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.conf', '.properties', '.env', '.example', '.xml', '.tf', '.tfvars',
  '.mod', '.csproj', '.props', '.targets', '.sln', '.sql',
]);

const DOC_EXT = new Set([
  '.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc', '.html', '.htm',
]);

// Extensionless files whose name alone identifies a scannable text artifact.
const NAMED_FILES = new Set([
  'dockerfile', 'makefile', 'gnumakefile', 'procfile', 'vagrantfile',
  '.gitmodules', '.gitignore', '.gitattributes', '.npmrc', '.nvmrc',
  '.dockerignore', '.editorconfig', '.env', '.env.example', '.tool-versions',
]);

// Generated lockfiles are excluded: they are machine-produced, regenerated on
// every install, and a stale entry there is fixed by reinstalling rather than by
// editing. Their absence from this gate is a deliberate scoping choice.
const LOCKFILE_NAMES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'npm-shrinkwrap.json',
  'cargo.lock', 'pubspec.lock', 'poetry.lock', 'pipfile.lock', 'composer.lock',
  'gemfile.lock', 'gradle.lockfile',
]);

// A machine-rooted absolute path. Requires a named volume, home, or mount anchor
// so that an ordinary HTTP route or URL path is NOT mistaken for a filesystem
// path.
//
// The single-letter branch (`/x/`) was REMOVED 2026-09-15. It was there to catch
// MSYS drive mounts, but measured across the fleet it produced 52 findings and
// every one was a false positive: HTTP route patterns (`/c/:conversationId` in
// the cloudrouter schema registry), URI-normalisation examples (`/a/../b`,
// `//a///b`, `/a/%2e%2e/b` in webserver's canonical-URI spec, ADR, and its own
// unit tests), and POSIX-path test data (`/a/b/..` in birdcoder2's webworker
// path shims). A one-character root directory is not a real filesystem root; the
// only real convention is the MSYS drive mount, and this fleet's occurrences of
// that form (`/c/Users/<user>`) sit inside fixture-marked test files, which the
// file-scope marker already covers.
//
// Scope note — why POSIX system roots (`/opt`, `/srv`, `/data`, `/workspace`,
// `/var`, `/usr`, `/etc`, `/tmp`) are deliberately NOT anchors here. Measured
// 2026-09-15: adding them took the fleet from 268 to 630 findings, and the 362
// additions were dominated by paths that are correct *by design* on a different
// host than the one this gate audits — container-internal paths inside
// Dockerfiles (`/workspace/sdkwork-agents/target/release/...`, `/data/sdkwork-models`),
// container run files (`/var/run/sdkwork-postgres-tls`) and the deploy host's
// own documented checkout (`/opt/deploy/sdkwork-space`, `/srv/sdkwork-space`,
// both overridable through `SDKWORK_SPACE_ROOT`). Those are runtime target
// contracts, not relocatable developer bindings, and a gate that reports them is
// the phantom-finding gate this registry already has a cautionary example of.
// The case that matters is still covered: a developer checkout on Linux lives
// under `/home/<user>/<workspace-name>` and IS anchored, as is
// `/mnt/<drive>/<workspace-name>`. If a future change wants the wider net, it
// needs a per-class exemption for container and deploy roots first, not just a
// looser regex.
const MACHINE_ROOT_RE = /^(?:[A-Za-z]:\/|\/(?:mnt\/[A-Za-z]|media\/[^/]+|Volumes\/[^/]+|home\/[^/]+|Users\/[^/]+)\/)/;

// Absolute path candidates: a drive-rooted token or a token that starts a path.
// The drive branch is guarded by `(?<![\w])` so the tail of a URL scheme is not
// read as a volume: without it the `s` of `https` followed by a colon and two
// slashes reads as a drive, which reported every `https` line in the fleet.
// The slash branch excludes a preceding slash for the same class of reason: a
// relative path that happens to contain a doubled separator (`a//b/c/`, a
// normalisation fixture in `sdkwork-utils`) would otherwise offer its SECOND
// slash as a path start and be read as the absolute path `/b/c/`. The first
// slash of a `file:///` URL is still the token start, because the character in
// front of it is the scheme's colon.
// An angle-bracket placeholder is consumed as one unit. Without that, the scan
// stopped at the closing bracket because the body class excludes it, so the
// documented form the spec asks authors to write arrived as a token cut in the
// middle of its placeholder — a final segment with no closing bracket, which
// TEMPLATE_SEGMENT_RE therefore refused, and the gate reported the placeholder
// instead of the binding it stands in for. Measured 2026-09-15: the gate's own
// comment that documents this rule was the only finding it produced against
// itself.
const CANDIDATE_RE = /(?:(?<![\w])[A-Za-z]:[\\/]{1,2}|(?<![\w./-])\/)(?:<[^<>\s]*>|[^\s"'`;,)\]}>|])*/g;

// Runtime install roots are the actual target system contract per
// `DEPENDENCY_MANAGEMENT_SPEC.md` section 1, so they are exempt from the
// MACHINE-ABS rule.
//
// Only the Windows branches are reachable, and that is not an oversight: the
// POSIX targets this exemption was written for (`/etc/`, `/var/lib/`, `/var/log/`,
// `/usr/`, `/opt/`, `/srv/`) are never candidates in the first place, because
// MACHINE_ROOT_RE does not anchor them — see the scope note there. Keeping those
// alternatives would have been dead code that reads as a live exemption, so they
// were removed 2026-09-15 rather than left to mislead the next reader. A
// drive-rooted install root does need the exemption, because the drive branch of
// MACHINE_ROOT_RE matches `C:/Program Files/...` and the sibling-repo heuristic
// would otherwise read `C:/Program Files/sdkwork-tts` as a checkout reference.
// The trailing separator is optional. A real binding is usually
// `C:/Program Files/app/...`, but the runtime default a program falls back to is
// the bare root — `"C:/ProgramData"` in the cloudrouter config crate,
// `"C:\\ProgramData"` in webserver's config_paths, `D:\Windows` in a deploy
// guide — and requiring the separator reported those as machine bindings, which
// is the opposite of what the exemption is for.
const RUNTIME_ROOT_RE = new RegExp(
  '^(?:'
  + '[A-Za-z]:/(?:Program Files(?: \\(x86\\))?|Windows|ProgramData|Users/Public)(?=/|$)'
  + ')',
  'i',
);

// An angle-bracket segment is a documented template, not a machine binding:
// `<workspace-root>`, `<drive>`, `<user>`, `<appId>`. No filesystem on any
// platform accepts `<` in a name, so a path carrying one cannot be the literal
// this gate is looking for, and `DEPENDENCY_MANAGEMENT_SPEC.md` section 1
// requires documentation to use exactly this form.
const TEMPLATE_SEGMENT_RE = /^<[^<>]+>$/;

// An ellipsis segment is the other spelling of the same idea: a drive-rooted path
// or an MSYS mount truncated with `...`. A segment of nothing but dots is a
// documentation truncation — no filesystem resolves a three-dot name as a child,
// and a path written with one is incomplete by construction, so it can never be
// the working binding this gate exists to catch. Measured 2026-09-15: this
// spelling, not the angle-bracket one, was the residual form in the fleet's
// tool-catalog prompt text and snapshot files after the concrete paths had been
// fixed. Three dots minimum so a genuine two-dot path component is still scanned.
const ELLIPSIS_SEGMENT_RE = /^(?:\.{3,}|…)$/;

function isScannable(fileName) {
  const lower = fileName.toLowerCase();
  if (LOCKFILE_NAMES.has(lower)) return false;
  if (NAMED_FILES.has(lower)) return true;
  const ext = path.extname(lower);
  return CODE_EXT.has(ext) || CONFIG_EXT.has(ext) || DOC_EXT.has(ext);
}

function classify(kindOf, ext) {
  if (DOC_EXT.has(ext)) return 'doc';
  if (CODE_EXT.has(ext)) return 'code';
  return 'config';
}

function walk(dir, excludes, out = [], markedDirs = null) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  if (markedDirs) {
    for (const entry of entries) {
      if (entry.isFile() && entry.name === FIXTURE_DIR_MARKER) {
        if (isTestFile(dir)) markedDirs.push(dir);
        break;
      }
    }
  }
  for (const entry of entries) {
    if (excludes.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, excludes, out, markedDirs);
    else if (entry.isFile() && isScannable(entry.name)) out.push(p);
  }
  return out;
}

/**
 * True when `file` sits inside a directory that declared the directory-scope
 * fixture marker. The directory must itself be test-scoped, so dropping the
 * marker file at a repository root — where it would exempt production source —
 * buys nothing.
 */
function isUnderFixtureDir(file, markedDirs) {
  for (const dir of markedDirs) {
    if (file === dir || file.startsWith(dir + path.sep)) return true;
  }
  return false;
}

/**
 * The line-scope marker. A line carrying the file-scope marker is deliberately
 * NOT line-exempt: outside a test file the file-scope marker is reported as
 * FIXTURE-MARKER-NOT-APPLICABLE, and granting it an eight-line line exemption at
 * the same time would let the wrong marker buy silence. Keep the exclusion — a
 * note that documents the file-scope marker therefore has to spell it out rather
 * than quote it, which is why `gates.manifest.json` writes it as a suffix.
 */
function isLineMarker(line) {
  return line.includes(MARKER) && !line.includes(FIXTURE_MARKER);
}

function isExempt(lines, idx) {
  for (let back = 0; back <= MARKER_WINDOW; back += 1) {
    const i = idx - back;
    if (i < 0) break;
    if (isLineMarker(lines[i])) return true;
  }
  return false;
}

/**
 * A test file is one the repository designates as test code by name or by
 * location. Keeping the predicate narrow is what makes the file-scope fixture
 * marker safe: it exempts fixtures, never source.
 */
function isTestFile(file) {
  const posix = file.replace(/\\/g, '/').toLowerCase();
  const name = posix.slice(posix.lastIndexOf('/') + 1);
  if (/\.(test|spec)\.[a-z0-9]+$/.test(name)) return true;
  // Rust's convention for a test submodule is a file named `tests.rs` or
  // `test_<subject>.rs`, which carries no path segment the rule below can see.
  if (/^tests?\.rs$/.test(name) || /^test_[a-z0-9_]+\.rs$/.test(name)) return true;
  return /(^|\/)(tests?|__tests__)(\/|$)/.test(posix);
}

/**
 * Split one source line into the text that executes and the text that is
 * comment. Only the two delimiters that decide whether `#[cfg(test)]` is code or
 * prose are modelled: a `//` outside a double-quoted literal opens a comment, and
 * a `"` outside a comment opens a literal. Char literals and multi-line raw
 * strings are deliberately NOT modelled — nothing here depends on them.
 */
function splitExecutableAndComment(line) {
  let code = '';
  let comment = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (comment) { comment += ch; continue; }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '/' && line[i + 1] === '/') { comment = '//'; i += 1; continue; }
    code += ch;
  }
  return { code, comment };
}

/**
 * True when `line` declares the block marker inside a comment, rather than merely
 * spelling it inside a string literal.
 *
 * The marker's own position in the file is deliberately unconstrained. It is a
 * declaration ABOUT the file's trailing test module, and authors place it wherever
 * the declaration reads best: on the `#[cfg(test)]` attribute (55 files), and, in
 * `paths.rs`, on the fixture expression inside the module. A first revision
 * required the marker to share the anchor's line; that rejected `paths.rs` and
 * turned three ordinary `PathBuf::from("C:/Users/<user>")` test values into
 * findings, so the requirement was dropped. What the marker may not be is a
 * string literal, which is the one shape that lets a passing mention act as a
 * declaration.
 */
function declaresFixtureBlock(line) {
  const { comment } = splitExecutableAndComment(line);
  return comment.includes(FIXTURE_BLOCK_MARKER);
}

/**
 * Line indices of the file's real `#[cfg(test)]` declarations, ignoring any that
 * appear only inside a string literal or a comment.
 */
function realAnchorLines(lines) {
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (FIXTURE_BLOCK_ANCHOR_RE.test(splitExecutableAndComment(lines[i]).code)) hits.push(i);
  }
  return hits;
}

/**
 * Extent of a marker-declared fixture block, or null.
 *
 * The block is the file's own trailing `#[cfg(test)]` module, located as the
 * file's LAST real `#[cfg(test)]` declaration — NOT as the marker's own line. The
 * distinction is the whole point. The committed gate anchored the block to the
 * marker line, so a marker written anywhere exempted everything below it; it took
 * only a marker on line 100 of a file whose test module opens at line 900 to put
 * 800 lines of production out of scope. Anchoring to the last real declaration
 * makes that impossible: the exemption can never begin above the trailing fixture
 * region, whatever line the marker sits on.
 *
 * Last rather than first for the mirror-image reason: a file may carry an interior
 * `#[cfg(test)]` (an attribute on a single item) above its test module, and
 * anchoring to the first would start the exemption too high. `paths.rs` does
 * exactly this — real declarations at 435 and 748.
 *
 * A brace-counting revision of this function was withdrawn as unsound. A line-based
 * scanner counts braces inside multi-line raw strings (`r#"..."#`) and char
 * literals, and the two ways of counting disagree with each other AND with the
 * files. Measured 2026-09-15 on three files that provably do end with their test
 * module: `layout.rs` raw 0 / string-masked -2, `policy.rs` 0 / -4, `parser.rs`
 * +3 / -5. Raw is wrong because it counts `set $brace a\{b;` inside a raw string;
 * masked is worse, because masking a lone `"` (a char literal) opens a phantom
 * literal that then swallows real code. Locating the last declaration needs no
 * brace accounting at all.
 */
function fixtureBlockRange(lines) {
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last -= 1;
  const anchors = realAnchorLines(lines);
  if (!anchors.length) return null;
  if (!lines.some((line) => declaresFixtureBlock(line))) return null;
  return { start: anchors[anchors.length - 1], end: last };
}

/**
 * The file-scope marker, matched with a boundary because `allow-fixture` is a
 * prefix of `allow-fixture-block`. A bare `includes` read the block-scope marker
 * as a file-scope declaration, so a production Rust file that had correctly
 * marked its own `#[cfg(test)]` module was reported as misusing the file-scope
 * marker. Measured 2026-09-15: both FIXTURE-MARKER-NOT-APPLICABLE reports in the
 * fleet were this collision, not a real misuse.
 */
const FIXTURE_MARKER_RE = /WORKSPACE-PATH:allow-fixture(?![\w-])/;

function hasFixtureMarker(lines) {
  const limit = Math.min(lines.length, FIXTURE_MARKER_HEADER_LINES);
  for (let i = 0; i < limit; i += 1) {
    if (FIXTURE_MARKER_RE.test(lines[i])) return true;
  }
  return false;
}

/**
 * A regular-expression literal, not a filesystem path.
 *
 * Normalising `\` to `/` turns a regex escape into a directory separator, so a
 * pattern such as `/\s/`, `/\n/g`, `/\D/` or `/t\(/` reaches the classifier as
 * if it began with a one-letter directory name, and lands on the single-letter
 * POSIX branch as a `/s`, `/n`, `/D` or `/t` root. Measured 2026-09-15: that one
 * artefact produced 526 of the fleet's machine-path findings, none of them a
 * path — `^/\` (423) and `^/<letter>\` (103).
 *
 * The predicate reads the RAW token, because after normalisation the escape is
 * indistinguishable from a separator. A leading `/\` is a regex escape with no
 * path meaning at all; a leading `/<letter>\` is the same thing behind a literal
 * first character. An MSYS drive mount is spelled `/<letter>/` and is therefore
 * untouched by this guard.
 */
const REGEX_LITERAL_RE = /^\/(?:\\|[A-Za-z]\\)/;

// A backslash-escaped forward slash cannot occur in a filesystem path literal on
// any platform, so a candidate carrying one is a slice of a regular expression
// rather than a path. This is the guard for the SECOND and later alternatives of
// an anchored pattern: `/\b[A-Z]:[\\/]|\/home\/[^/\s]+/` opens with `\b`, so the
// leading-token guard above finds no regex there, while `/home\/[^/\s` is still
// handed to the scanner as a POSIX home path. Suppressing only the first
// alternative left exactly that residue. Measured 2026-09-15: both candidates the
// fleet had in this shape were regex alternatives inside one test file.
const REGEX_ESCAPED_SLASH_RE = /\\\//;

/** True when the candidate is a slice of a regular expression, not a path. */
function isRegexFragment(raw) {
  return REGEX_LITERAL_RE.test(raw) || REGEX_ESCAPED_SLASH_RE.test(raw);
}

// A three-digit octal escape (`\002`) is how a C or Java string literal spells a
// non-printable byte, and protobuf serialises message bytes through exactly that
// spelling — so a generated `.java` descriptor offers the scanner a token such as
// `e:` followed by `\0028\001\`, which normalises into something that looks like
// a drive-rooted path. No filesystem path contains an octal escape, so the token
// is a byte literal. Measured 2026-09-15: the one such candidate in the fleet was
// this, in a generated protobuf `Context.java`.
const OCTAL_ESCAPE_RE = /\\0[0-7]{2}/;

/**
 * Return the rule id for one absolute-path candidate, or null when the
 * candidate is not a machine-specific binding this gate owns.
 */
function normalizeCandidate(raw) {
  // A module/`file:` URL such as `file:///<drive>:/<workspace-name>/...` reaches
  // the scanner with its scheme gone and the back-to-back slashes kept, so the
  // candidate begins `///...` and no absolute-root form matches. That silently
  // lost every `file:///` + absolute URL in the fleet — exactly the form a
  // browser or a module loader breaks on once the checkout moves. Collapse the
  // leading slash run, then drop the one slash the URL authority separator
  // leaves in front of a drive letter.
  //
  // The collapse runs over the WHOLE token, not just its head, because a Windows
  // separator written in source is escaped: `'C:\\Windows\\System32\\tar.exe'`
  // reaches the scanner with two backslashes per separator, normalises to
  // `C://Windows//System32//tar.exe`, and then matched neither the drive-root
  // form nor the runtime-root exemption — the exemption was unreachable for the
  // exact spelling a Windows script uses. A doubled separator carries no meaning
  // in a file path, so collapsing it is lossless.
  let norm = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (/^\/[A-Za-z]:\//.test(norm)) norm = norm.slice(1);
  return norm;
}

// `Program Files` contains a space and the candidate scan ends a path at the first
// whitespace, so `C:/Program Files/sdkwork-tts` arrives as `C:/Program` and the
// runtime-root exemption below can never fire — it was unreachable for exactly the
// root the spec names as legitimate. Widen the char class to tolerate spaces would
// instead swallow the sentence that follows a path in prose, so the truncation is
// recognised here and ignored rather than reported as a half path.
const TRUNCATED_RUNTIME_ROOT_RE = /^[A-Za-z]:\/(?:Program|Program Files|Program Files \(x86\))$/i;

function classifyCandidate(raw, workspaceName) {
  if (isRegexFragment(raw)) return null;
  if (OCTAL_ESCAPE_RE.test(raw)) return null;
  const norm = normalizeCandidate(raw);
  if (!MACHINE_ROOT_RE.test(norm)) return null;
  if (TRUNCATED_RUNTIME_ROOT_RE.test(norm)) return null;
  const body = /^[A-Za-z]:\//.test(norm) ? norm.slice(2) : norm;
  const segments = body.split('/').filter(Boolean);
  const wanted = workspaceName.toLowerCase();

  // A documented template is portable by construction — see TEMPLATE_SEGMENT_RE.
  // Tested first, so `/home/<user>/<workspace-name>` and `C:/Users/<user>/...`
  // are recognised as the placeholders the spec asks for rather than flagged as
  // the machine paths they stand in for.
  if (segments.some((s) => TEMPLATE_SEGMENT_RE.test(s))) return null;
  if (segments.some((s) => ELLIPSIS_SEGMENT_RE.test(s))) return null;

  // Order matters. WORKSPACE-ABS is tested first and unconditionally, so a
  // path that names the relocatable workspace root is reported even when it also
  // sits under a runtime install root — `C:/Program Files/sdkwork-space/...`
  // would otherwise be swallowed by the exemption below, and it is precisely the
  // binding that breaks when the workspace moves.
  if (segments.some((s) => s.toLowerCase() === wanted)) return 'WORKSPACE-ABS';

  // A path anchored at a runtime install root is a deployment target, not a
  // source/build dependency — the spec's own example of a legitimate literal
  // ("a documented runtime target path"). It is tested before the sibling-repo
  // heuristic so an install directory that merely shares a repository's name
  // (`C:\Program Files\sdkwork-tts`, matching the `sdkwork-tts` repository) is
  // not misreported as an absolute reference to a sibling checkout.
  if (RUNTIME_ROOT_RE.test(norm)) return null;

  if (segments.some((s) => /^sdkwork-[a-z0-9][a-z0-9-]*$/.test(s.toLowerCase()))) return 'SIBLING-REPO-ABS';
  return 'MACHINE-ABS';
}

function lintFile(file, workspaceName, includeMachinePaths, markedDirs = []) {
  const result = { findings: [], markerSites: 0, fixtureExempt: false };
  let text;
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_BYTES) return result;
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return result;
  }
  if (text.includes('\u0000')) return result; // binary masquerading as text

  const ext = path.extname(file).toLowerCase();
  const kind = classify('', ext);
  const lines = text.split('\n');
  const seen = new Set();
  const testFile = isTestFile(file);

  result.markerSites = lines.filter(isLineMarker).length;

  // A file-scope marker outside a test file is not an exemption, it is a
  // mistake: the author expected the whole file to be skipped and it is not.
  // Say so, and then keep scanning — returning here would let the marker
  // suppress the very findings it cannot legitimately exempt, which is the one
  // thing it must never do. Documentation files are excluded from this check
  // because this rule is documented in one.
  if (!testFile && !DOC_EXT.has(ext) && hasFixtureMarker(lines)) {
    result.findings.push(
      `${file}:1: FIXTURE-MARKER-NOT-APPLICABLE [${kind}]: ${FIXTURE_MARKER} exempts a test file only; this file is not one, so it must be fixed instead`,
    );
  }

  if (testFile && hasFixtureMarker(lines)) {
    result.fixtureExempt = true;
    return result;
  }

  // Directory-scope form of the same exemption, for a fixture whose format has
  // nowhere to put a comment.
  if (testFile && isUnderFixtureDir(file, markedDirs)) {
    result.fixtureExempt = true;
    return result;
  }

  // Block-scope form: the file's own `#[cfg(test)]` module, bounded by
  // fixtureBlockRange so a production region that follows the test module is
  // still scanned. The exemption is granted only when the block actually hides a
  // finding — that is, when a candidate inside it survives classifyCandidate.
  // Testing CANDIDATE_RE alone is not enough: its bare-slash branch matches every
  // URL and route string, so a Rust unit test full of `"/downloads/report.pdf"`
  // or `"/app/v3/api/..."` used to exempt the whole file while containing no
  // machine path at all. Measured 2026-09-15: six production `src/*.rs` files
  // were exempt on exactly that basis, with zero real absolute paths between them.
  const block = fixtureBlockRange(lines);
  const blockStart = block ? block.start : -1;
  if (block) {
    const hidesAFinding = lines.slice(block.start, block.end + 1).some((l) => {
      CANDIDATE_RE.lastIndex = 0;
      let candidate;
      while ((candidate = CANDIDATE_RE.exec(l)) !== null) {
        if (candidate[0].length < 4) continue;
        if (classifyCandidate(candidate[0], workspaceName)) return true;
      }
      return false;
    });
    if (hidesAFinding) result.fixtureExempt = true;
  }

  lines.forEach((line, idx) => {
    if (block && idx >= block.start && idx <= block.end) return;
    if (isExempt(lines, idx)) return;
    CANDIDATE_RE.lastIndex = 0;
    let match;
    while ((match = CANDIDATE_RE.exec(line)) !== null) {
      const raw = match[0];
      // A bare `/` or a token with no further content is never a path binding.
      if (raw.length < 4) continue;
      const rule = classifyCandidate(raw, workspaceName);
      if (!rule) continue;
      if (rule === 'MACHINE-ABS' && !includeMachinePaths) continue;
      const key = `${idx + 1}:${rule}:${raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.findings.push(`${file}:${idx + 1}: ${rule} [${kind}]: ${raw}`);
    }
  });
  return result;
}

function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      workspace: { type: 'string' },
      root: { type: 'string', multiple: true, default: [] },
      'workspace-name': { type: 'string', default: DEFAULT_WORKSPACE_NAME },
      exclude: { type: 'string', default: '' },
      'include-machine-paths': { type: 'boolean', default: false },
      'workspace-only': { type: 'boolean', default: false },
    },
  });

  const roots = [...(values.workspace ? [values.workspace] : []), ...values.root];
  if (values.help || roots.length === 0) {
    console.log('Usage: node tools/check-workspace-path-portability.mjs --workspace <dir> | --root <dir> [--root <dir2> ...] [--workspace-name sdkwork-space] [--exclude dir,dir] [--workspace-only]');
    process.exit(values.help ? 0 : 2);
  }

  const workspaceName = values['workspace-name'];
  // Machine-rooted paths are in scope by default. `--include-machine-paths` is
  // kept as a no-op alias because it used to be the opt-in for this rule, and a
  // fleet that has to fix its bindings should not have to learn a new flag to
  // keep the behaviour it just adopted.
  const includeMachinePaths = !values['workspace-only'];
  const excludes = new Set([...DEFAULT_EXCLUDES, ...values.exclude.split(',').filter(Boolean)]);
  const findings = [];
  const fixtureExemptFiles = [];
  const markedDirs = [];
  let fileCount = 0;
  let markerSites = 0;

  for (const root of roots) {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs)) {
      findings.push(`${abs}: root does not exist`);
      continue;
    }
    const files = walk(abs, excludes, [], markedDirs);
    fileCount += files.length;
    for (const file of files) {
      const result = lintFile(file, workspaceName, includeMachinePaths, markedDirs);
      findings.push(...result.findings);
      markerSites += result.markerSites;
      if (result.fixtureExempt) fixtureExemptFiles.push(file);
    }
  }

  // Exemptions are always printed, never silent: a reviewer has to see how much
  // of the fleet sits behind a marker without running the gate twice, and an
  // exempted file nobody notices is a hole.
  const tally = `${fileCount} files, ${markerSites} line exemption(s) declared, ${fixtureExemptFiles.length} fixture-exempt test file(s)`;

  if (findings.length > 0) {
    console.error(`workspace path portability failed (${findings.length} findings across ${fileCount} files; ${markerSites} line exemption(s) declared)`);
    findings.forEach((f) => console.error(`- ${f}`));
    fixtureExemptFiles.forEach((f) => console.error(`fixture-exempt: ${f}`));
    process.exitCode = 1;
    return;
  }
  console.log(`workspace path portability passed: ${tally}`);
  fixtureExemptFiles.forEach((f) => console.log(`fixture-exempt test file: ${f}`));
}

main();
