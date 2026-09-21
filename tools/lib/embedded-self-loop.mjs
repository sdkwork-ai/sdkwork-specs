// Embedded self-loop validation (APPLICATION_GATEWAY_SPEC §2.3).
//
// An application that composes a dependency in-process must never reach that
// dependency over HTTP, and must in particular never call back into its own
// listener. This module is the shared library; `check-embedded-self-loop.mjs`
// is the thin CLI wrapper.
import fs from 'node:fs';
import path from 'node:path';

const LOOPBACK_HOSTS = new Set(['0.0.0.0', '127.0.0.1', 'localhost', '[::]', '::', '[::1]', '::1']);
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'build', 'coverage', '.wm-cargo-check']);
const SERVER_PREFIX = /^SDKWORK_/;
// Runtime TOML profiles declare the ingress as `bind = "127.0.0.1:3900"` rather
// than an environment variable. Reading them matters: the platform gateway
// declares its ingress this way, so an env-only scan sees no owner at all and
// silently skips the repository.
const TOML_BIND = /^\s*bind\s*=\s*"([^"]+)"/;
// Compose files declare deployment environment inline. A gateway composition
// that embeds a dependency and still points a base URL at its own bind is the
// same self-loop as an `etc/topology/*.env` entry.
const COMPOSE_ENV_BLOCK = /^\s{2,}environment:\s*$/;
const BROWSER_MARKER = /_(BROWSER|DEV_PROXY|H5|PC|MOBILE|MINI_PROGRAM|DESKTOP)_/;
export const DEP_URL = /^SDKWORK_[A-Z0-9_]*_(APP_API_BASE_URL|BACKEND_API_BASE_URL|OPEN_API_BASE_URL|ADMIN_API_BASE_URL|API_ORIGIN|APP_API_ORIGIN|BACKEND_API_ORIGIN|OPEN_API_ORIGIN|ADMIN_API_ORIGIN)$/;
export const INGRESS_BIND = /^SDKWORK_[A-Z0-9_]*_APPLICATION_PUBLIC_INGRESS_BIND$/;
export const INGRESS_ORIGIN = /^SDKWORK_[A-Z0-9_]*_(APPLICATION_PUBLIC_INGRESS_ORIGIN|APPLICATION_ORIGIN)$/;

function listFiles(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, filter, out);
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

function isEnvFile(name) {
  return name.endsWith('.env') || name === 'demo.env' || name.endsWith('.env.example');
}

export function parseEnv(source) {
  const entries = [];
  // Split on both EOL styles: the workspace carries CRLF and LF profiles, and
  // re-splitting an already-CRLF source on "\n" would leave a stray "\r".
  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.push({ key, value, line: index + 1 });
  });
  return entries;
}

// Compose files declare values as `${GATEWAY_X:-http://127.0.0.1:3900}`. The
// default is what actually runs when the operator overrides nothing, so that is
// the value a self-loop audit must inspect.
export function expandShellDefault(value) {
  const expanded = value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:-([^}]*)\}/g, '$1');
  return expanded.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '');
}

// `http://127.0.0.1:3905/backend/v3/api` -> `loopback:3905`
export function authorityOf(rawValue) {
  const value = expandShellDefault(rawValue);
  const match = /^[a-z]+:\/\/([^/?#]+)/i.exec(value);
  if (!match) return null;
  const raw = match[1];
  const separator = raw.lastIndexOf(':');
  const host = separator > 0 ? raw.slice(0, separator) : raw;
  const port = separator > 0 ? raw.slice(separator + 1) : '';
  if (!LOOPBACK_HOSTS.has(host.toLowerCase())) return null;
  return `loopback:${port}`;
}

export function bindAuthority(value) {
  const trimmed = value.trim();
  if (/^[a-z]+:\/\//i.test(trimmed)) return authorityOf(trimmed);
  const separator = trimmed.lastIndexOf(':');
  if (separator <= 0) return null;
  const host = trimmed.slice(0, separator);
  const port = trimmed.slice(separator + 1);
  if (!LOOPBACK_HOSTS.has(host.toLowerCase())) return null;
  return `loopback:${port}`;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// Everything the repository compiles in-process, read from its Cargo manifests.
export function inProcessDependencies(repoRoot) {
  const deps = new Set();
  const manifests = [
    path.join(repoRoot, 'Cargo.toml'),
    ...listFiles(path.join(repoRoot, 'crates'), (name) => name === 'Cargo.toml'),
  ];
  for (const manifest of manifests) {
    const text = readText(manifest);
    for (const match of text.matchAll(/sdkwork-api-([a-z0-9-]+)-assembly/g)) {
      deps.add(match[1]);
    }
  }
  return deps;
}

// `sdkwork-cloudrouter` -> `cloudrouter`
export function moduleOfRepo(repoName) {
  return repoName.startsWith('sdkwork-') ? repoName.slice('sdkwork-'.length) : null;
}

// Rust backend sources of a repository. `listFiles` already skips `target`,
// `node_modules`, and VCS output, so this is authored source only.
//
// Test scaffolding is excluded: an integration test that spawns a server and
// then dials it over loopback is a legitimate client/server test, and reporting
// it would teach the gate's readers to ignore the rule that matters.
function isRustTestPath(file) {
  const parts = file.split(/[\\/]/);
  if (parts.includes('tests')) return true;
  // Match a `test`/`tests` segment anywhere in the stem, not only the whole
  // stem: fixtures live in `src/test_helper.rs` and `src/bind_test.rs` just as
  // often as in `src/tests.rs`, and a file-wide miss reports scaffolding.
  const stem = path.basename(file).replace(/\.rs$/, '');
  return /(?:^|[._-])tests?(?:[._-]|$)/.test(stem);
}

export function rustSources(repoRoot) {
  return [
    ...listFiles(path.join(repoRoot, 'crates'), (name) => name.endsWith('.rs')),
    ...listFiles(path.join(repoRoot, 'services'), (name) => name.endsWith('.rs')),
    ...listFiles(path.join(repoRoot, 'apps'), (name) => name.endsWith('.rs')),
    ...listFiles(path.join(repoRoot, 'src'), (name) => name.endsWith('.rs')),
  ].filter((file) => !isRustTestPath(file));
}

// A Rust source derives a loopback origin from this process's own listener when
// it builds a loopback origin **for use as an outbound client base URL**.
//
// Judging this per file does not work: a single file commonly contains both an
// inbound bind resolver and an outbound client, and a file-wide marker would
// report the whole file. The decision is therefore made per line, using the
// line that composes the origin plus a small window around it. Three legitimate
// shapes compose a loopback origin and must never be reported:
//   - a listener bind: the value flows into `bind_address` / `SocketAddr` /
//     `.bind()` / `addr()`;
//   - a CORS allow-list entry: it flows into an `origins` / `allowed_origins`
//     collection;
//   - test scaffolding that records a spawned server's bind.
// The violation is a `base_url` / `endpoint` / client value, or an injected
// environment variable, that names this process's own listener.
const RUST_OWN_LISTENER_KEY =
  /SDKWORK_[A-Z0-9_]*_APPLICATION_(?:PUBLIC_INGRESS_BIND|PUBLIC_HTTP_URL|OPEN_HTTP_URL|BACKEND_HTTP_URL)/;

// A composed loopback origin: the scheme or a `{port}` placeholder must be
// present, so a bare language attribute like `#[serde(rename)]` cannot match.
// The scheme is captured when present so a finding quotes the origin in full —
// a bare `127.0.0.1:{port}` reads like a bind and hides that it is a URL.
const RUST_COMPOSED_LOOPBACK_ORIGIN = /((?:https?:\/\/)?127\.0\.0\.1:\{[a-z_][a-z0-9_]*\})/i;

// A loopback origin with no scheme is a listener bind, never an outbound base
// URL: `env::set_var("..._INGRESS_BIND", format!("127.0.0.1:{port}"))` seeds the
// process's own listener, and `format!("{host}:{port}")` style bind resolvers
// produce the same shape. Only a scheme-bearing origin can be dialled.
const RUST_SCHEMED_LOOPBACK_ORIGIN = /https?:\/\/127\.0\.0\.1:\{[a-z_][a-z0-9_]*\}/i;

// Markers, checked over the composing line and its neighbourhood.
const RUST_OUTBOUND_MARKER =
  /\bbase_url\b|\bbase_uri\b|\bendpoint\b|\bapi_url\b|\bgateway_url\b|\bclient\b|sdk\b|_url\b|set_var/i;
const RUST_INBOUND_OR_ALLOWLIST_MARKER =
  /\bbind\b|\bbind_address\b|\bbind_addr\b|\baddr\b|\blisten\b|\borigins\b|allowed_origins|allow_origin|cors|Access-Control-Allow-Origin|SocketAddr|\bport\s*:/i;

// How far around a composing line to look for the marker that classifies it.
const RUST_CONTEXT_LINES = 6;

// A line that is entirely a comment. Documentation that *names* the prohibited
// pattern while explaining why it is forbidden is not a violation — a rule that
// reports its own rationale teaches readers to delete the rationale. Rust has
// three comment forms (`//`, `///`, `//!`), all starting with `//`.
function isRustCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//');
}

// Line ranges covered by an inline `#[cfg(test)]` module. Brace counting is
// enough for Rust's grammar here: a `mod tests { ... }` block is delimited by
// balanced braces, and string/comment handling does not change that balance
// materially for this purpose. Test-only scaffolding is excluded from the rule
// so the gate keeps reporting only production call paths.
function inlineTestRanges(lines) {
  const ranges = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/#\[cfg\(test\)\]/.test(lines[index])) continue;
    // Walk forward to the opening brace, then count to its match.
    let cursor = index;
    let depth = 0;
    let opened = false;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      for (const ch of line) {
        if (ch === '{') {
          depth += 1;
          opened = true;
        } else if (ch === '}') {
          depth -= 1;
        }
      }
      if (opened && depth <= 0) break;
    }
    ranges.push([index, Math.min(cursor, lines.length - 1)]);
    index = cursor;
  }
  return ranges;
}

// The key a composing line is assigning into, when the line itself names a bind
// variable. A test fixture that supplies `..._INGRESS_BIND` its value is
// building a listener configuration, never an outbound base URL.
const RUST_ASSIGNS_BIND_KEY = /_INGRESS_BIND/;

// Returns the loopback origin a Rust file derives from its own listener as an
// outbound base URL, or null. Reports at most the first offending origin.
//
// The reported fragment is widened to the enclosing string literal when the
// origin is composed inside one. `format!("http://127.0.0.1:{port}/backend")`
// otherwise reports only `127.0.0.1:{port}`, which reads like a bind and hides
// that the value is a URL.
function quotedLiteralContaining(line, index, length) {
  let quoteStart = -1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const ch = line[cursor];
    if (ch === '"') {
      quoteStart = cursor;
      break;
    }
    if (ch !== '{' && ch !== ' ') break;
  }
  if (quoteStart < 0) return null;
  const quoteEnd = line.indexOf('"', index + length);
  if (quoteEnd < 0) return null;
  return line.slice(quoteStart + 1, quoteEnd);
}

export function derivedLoopbackInRust(source) {
  const lines = source.split(/\r?\n/);
  const fileTouchesOwnListener = RUST_OWN_LISTENER_KEY.test(source);
  const testRanges = inlineTestRanges(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const composed = RUST_COMPOSED_LOOPBACK_ORIGIN.exec(line);
    if (!composed) continue;
    // A comment naming the pattern is documentation, not a call path: this
    // includes the doc comments that explain why the pattern is prohibited.
    if (isRustCommentLine(line)) continue;
    // Scaffolding inside an inline `#[cfg(test)] mod tests { ... }` block.
    if (testRanges.some(([start, end]) => index >= start && index <= end)) continue;
    // The composing line itself assigns a `*_INGRESS_BIND` value: this is a
    // listener configuration (typically a test fixture or a bind resolver), not
    // an outbound client target.
    if (RUST_ASSIGNS_BIND_KEY.test(line)) continue;
    // A bind-shaped literal is not dialable, so it is out of scope. This has to
    // be checked on the *literal*, not the line: a multi-line `set_var` puts the
    // bind key on one line and its value on the next, so the line-level
    // `RUST_ASSIGNS_BIND_KEY` above cannot see it.
    if (!RUST_SCHEMED_LOOPBACK_ORIGIN.test(line)) continue;
    // A composing line inside a `#[cfg(test)]` module or a test file is
    // scaffolding: it spawns a server on an ephemeral port and records the bind.
    const window = lines
      .slice(Math.max(0, index - RUST_CONTEXT_LINES), index + RUST_CONTEXT_LINES + 1)
      .join('\n');
    if (RUST_INBOUND_OR_ALLOWLIST_MARKER.test(window) && !RUST_OUTBOUND_MARKER.test(window)) {
      continue;
    }
    // An outbound base URL is only a violation when the code also consults this
    // process's own listener variable, or injects it for another module. A
    // hard-coded loopback client target with no relation to the ingress bind is
    // a different (and separately owned) concern, not this rule's subject.
    const consultsOwnListener =
      fileTouchesOwnListener
      || RUST_OWN_LISTENER_KEY.test(window)
      || /env::var(?:_os)?\s*\(\s*"[A-Z_]*INGRESS_BIND"/.test(window);
    if (!consultsOwnListener) continue;
    return quotedLiteralContaining(line, composed.index, composed[0].length)
      ?? composed[0]
      ?? '127.0.0.1';
  }
  return null;
}

// --- Rule E: base-URL / bind resolution must not be re-implemented -----------
//
// `APP_SDK_INTEGRATION_SPEC.md` §5.2 requires the profile->mode classification,
// the override/authored/default precedence, and the listener-bind port parse to
// live once in `sdkwork-utils-rust::service_base_url`. A per-call-site copy is
// what let `standalone` and `cloud` drift apart in the first place, so the gate
// has to see the copy, not just its consequences.
//
// The component itself is exempt: it is the one legitimate implementation.
export const SHARED_BASE_URL_COMPONENT = 'sdkwork-utils-rust/src/service_base_url.rs';

// A re-implemented resolution *decision*.
//
// These regexes are deliberately narrow. A wide net here is worse than no rule:
// the workspace contains many legitimate `.or_else(...)` chains (URL path
// extraction, JSON record field merges, localhost desktop endpoints, SDK
// generator clients, HH:MM:SS timestamp parsing), and reporting them would
// teach readers to ignore the rule that matters. Each pattern therefore
// requires the distinguishing token of the *deployment* resolver, not merely
// an `or_else` or a `split(':')`.
const RUST_PROFILE_MODE_CLASSIFICATION =
  /(?:deployment_)?profile[^\n]{0,60}(?:==|eq\(|contains\(|starts_with|matches!)[^\n]{0,60}"standalone"/i;

// The precedence chain must move between an authored *public* URL and a split
// default while a profile decides the mode — the shape `service_base_url`
// owns. Requiring the public-URL token is what separates it from the unrelated
// `.or_else` chains found across the workspace.
const RUST_RESOLUTION_PRECEDENCE =
  /(?:APPLICATION_PUBLIC_HTTP_URL|APPLICATION_OPEN_HTTP_URL|APPLICATION_BACKEND_HTTP_URL|PUBLIC_HTTP_URL)[^\n]{0,80}(?:or_else|or\(|unwrap_or|\.or\b)|(?:or_else|or\(|unwrap_or)[^\n]{0,80}(?:APPLICATION_PUBLIC_HTTP_URL|APPLICATION_OPEN_HTTP_URL|PUBLIC_HTTP_URL)/i;

// Parsing a listener bind into a port. Requires a bind-typed variable name
// within a short distance of a `split(':')` and a port parse: a generic
// `split(':')` matches HH:MM:SS timestamp parsing and must not fire.
//
// The distance matters. A full 13-line window lets unrelated lines in one
// function contribute one token each — a `bind` parameter in the signature, a
// `split(':')` three lines down, a `u16` six lines further — and reports a
// parse that does not exist. Requiring all three tokens inside a tight block
// keeps the rule to code that really parses a bind.
const RUST_BIND_PARSE_BLOCK_LINES = 5;
const RUST_BIND_NAME = /\b(?:[a-z_]*bind[a-z_]*|[a-z_]*ingress[a-z_]*)\b/i;

// A `:` inside a string literal is data, never a bind split. Rust SQL and
// format strings routinely contain `:` (`AND c.id = $3`), so the colon must be
// the split call's *own argument* to count.
//
// The normalization pins that argument to a marker before the general literal
// stripping runs. Order matters: the colon literal is itself a string literal,
// so an unpinned `(':')` would be erased by the very next rule and the real
// parse would stop matching.
const RUST_SPLIT_MARKER = 'SDKWORK_COLON_SEP';
const RUST_SPLIT_CALL =
  new RegExp(
    `\\b[a-z_][a-z0-9_]*\\s*\\.\\s*(?:split_once|rsplit_once|split|rsplit|rfind)\\s*\\(\\s*${RUST_SPLIT_MARKER}\\s*\\)`,
    'i',
  );
const RUST_PORT_PARSE = /(?:\.parse(?:::<u16>)?\(\)|\bu16\b)/;

function normalizeForBindParse(line) {
  return line
    // Raw strings are data.
    .replace(/r#*"[\s\S]*?"#*/g, '""')
    // Pin the split call's colon argument, in both quote styles.
    .replace(
      new RegExp(
        `\\b([a-z_][a-z0-9_]*)\\s*\\.\\s*(split_once|rsplit_once|split|rsplit|rfind)\\s*\\(\\s*['"]:['"]\\s*\\)`,
        'gi',
      ),
      `$1.$2(${RUST_SPLIT_MARKER})`,
    )
    // Everything else literal is data.
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

// A tight block around a line, used for the bind-parse rule.
function blockAround(lines, index, radius) {
  return lines
    .slice(Math.max(0, index - radius), index + radius + 1)
    .join('\n');
}

// Whether the *current* line sits inside a bind parse. The colon-split and the
// port parse must appear together in one tight block around this line; the
// bind-typed name may sit in the enclosing signature, so it is checked over the
// wider window the caller already computed.
//
// Scanning the whole file here instead would fire on any file that contains a
// `:` inside a string literal (SQL placeholders, format strings) anywhere near
// a type mention of `u16`, which is most of the workspace.
function lineParsesBind(lines, index) {
  const block = normalizeForBindParse(blockAround(lines, index, RUST_BIND_PARSE_BLOCK_LINES));
  return RUST_SPLIT_CALL.test(block) && RUST_PORT_PARSE.test(block);
}

export function reimplementedBaseUrlResolution(source, file) {
  const normalized = file.split(/[\\/]/).join('/');
  if (normalized.endsWith(SHARED_BASE_URL_COMPONENT)) return null;
  const lines = source.split(/\r?\n/);
  const testRanges = inlineTestRanges(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isRustCommentLine(line)) continue;
    if (testRanges.some(([start, end]) => index >= start && index <= end)) continue;
    // A file whose window merely *uses* the shared component is a consumer, not
    // a second implementation.
    const window = lines
      .slice(Math.max(0, index - RUST_CONTEXT_LINES), index + RUST_CONTEXT_LINES + 1)
      .join('\n');
    if (/service_base_url/.test(window)) continue;

    if (RUST_PROFILE_MODE_CLASSIFICATION.test(line)) {
      return `profile-to-mode classification (${line.trim().slice(0, 90)})`;
    }
    if (RUST_RESOLUTION_PRECEDENCE.test(line)) {
      return `base-URL resolution precedence (${line.trim().slice(0, 90)})`;
    }
    // The bind-parse check needs care: the split and the port parse are often
    // on separate lines, so a single-line test misses the real shape, while a
    // wide window invents parses that do not exist. The rule therefore requires
    // the colon-split and the port parse to sit inside one tight statement
    // block, with a bind-typed name in the enclosing window.
    if (RUST_BIND_NAME.test(window) && lineParsesBind(lines, index)) {
      return `inline listener-bind port parse (${line.trim().slice(0, 90)})`;
    }
  }
  return null;
}

// Resolves the dependency a variable names, scanning right-to-left so the
// surface suffix and the consumer application never shadow the real dependency.
// `SDKWORK_FEEDS_COMMUNITY_OPEN_API_BASE_URL` names `community`, not the
// `feeds` consumer that declares it. `selfModule` is excluded: a repository
// embedding itself is the normal case, and its own name in the consumer
// position is not a dependency reference.
export function dependencyNamedBy(key, embedded, selfModule) {
  const tokens = key.replace(/^SDKWORK_/, '').split('_');
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index].toLowerCase();
    if (!token || !embedded.has(token)) continue;
    if (selfModule && token === selfModule) continue;
    return token;
  }
  return null;
}

function isComposeFile(name) {
  return /^docker-compose.*\.ya?ml$/.test(name) || name === 'compose.yaml' || name === 'compose.yml';
}

// Extracts the `environment:` block of a compose file without a YAML parser:
// the block ends at the first line indented no deeper than `environment:` itself.
//
// Compose supports two spellings and they do not share a separator, which is
// easy to get wrong: the mapping form is `KEY: value` (colon) while the list
// form is `- KEY=value` (equals). Comment lines carry `=` constantly ("Empty =
// accept all Host headers"), so they must be dropped before any separator scan.
export function parseComposeEnvironment(source) {
  const entries = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!COMPOSE_ENV_BLOCK.test(lines[index])) continue;
    const blockIndent = lines[index].match(/^\s*/)[0].length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim()) continue;
      if (line.match(/^\s*/)[0].length <= blockIndent) break;
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      const unquote = (value) => value.trim().replace(/^'([\s\S]*)'$/, '$1').replace(/^"([\s\S]*)"$/, '$1');
      const listed = /^-\s*([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*)$/.exec(trimmed);
      if (listed) {
        entries.push({ key: listed[1], value: unquote(listed[2]) });
        continue;
      }
      const mapped = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]*)$/.exec(trimmed);
      if (mapped) entries.push({ key: mapped[1], value: unquote(mapped[2]) });
    }
  }
  return entries;
}

// Reads the ingress binds a repository's runtime TOML profiles declare.
export function tomlBinds(repoRoot) {
  const authorities = new Set();
  for (const file of [
    ...listFiles(path.join(repoRoot, 'etc'), (name) => name.endsWith('.toml')),
    ...listFiles(path.join(repoRoot, 'deployments'), (name) => name.endsWith('.toml')),
  ]) {
    for (const line of readText(file).split(/\r?\n/)) {
      const match = TOML_BIND.exec(line);
      if (!match) continue;
      const authority = bindAuthority(match[1]);
      if (authority) authorities.add(authority);
    }
  }
  return authorities;
}

// Every deployment profile of a repository: env files first, then compose
// files (which carry inline `environment:` blocks).
export function envFilesFor(repoRoot) {
  return [
    ...listFiles(path.join(repoRoot, 'etc'), isEnvFile),
    ...listFiles(path.join(repoRoot, 'docker'), isEnvFile),
    ...listFiles(path.join(repoRoot, 'deployments'), isEnvFile),
    ...listFiles(path.join(repoRoot, 'container'), isEnvFile),
    ...listFiles(repoRoot, (name) => name === 'demo.env'),
    ...listFiles(repoRoot, isComposeFile),
  ];
}

// A profile is one file's worth of `KEY=VALUE` entries. Compose files need
// their own parser; everything else is dotenv syntax.
function profileEntries(file) {
  const source = fs.readFileSync(file, 'utf8');
  return isComposeFile(path.basename(file)) ? parseComposeEnvironment(source) : parseEnv(source);
}

function listRepos(workspace) {
  if (!fs.existsSync(workspace)) return [];
  return fs.readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(workspace, name, 'Cargo.toml')));
}

function indexRepositories(workspace, repoNames) {
  const index = new Map();
  for (const repoName of repoNames) {
    const repoRoot = path.join(workspace, repoName);
    const files = envFilesFor(repoRoot);
    const authorities = new Set();
    for (const file of files) {
      for (const { key, value } of profileEntries(file)) {
        if (INGRESS_BIND.test(key)) {
          const authority = bindAuthority(value);
          if (authority) authorities.add(authority);
        } else if (INGRESS_ORIGIN.test(key)) {
          const authority = authorityOf(value);
          if (authority) authorities.add(authority);
        }
      }
    }
    // Runtime TOML profiles declare `bind = "host:port"` instead of an env var.
    for (const authority of tomlBinds(repoRoot)) authorities.add(authority);
    index.set(repoName, { authorities, embedded: inProcessDependencies(repoRoot), files });
  }
  return index;
}

/**
 * Validates APPLICATION_GATEWAY_SPEC §2.3 for every SDKWork repository under
 * `workspace`. Pass `onlyRepo` (a repository directory name) to keep the
 * workspace-wide ingress index while reporting a single repository.
 *
 * @returns {{ findings: string[], repositories: number, profiles: number }}
 */
export function validateEmbeddedSelfLoop(workspace, { onlyRepo = null } = {}) {
  const repoNames = onlyRepo ? [onlyRepo] : listRepos(workspace);
  const repoIndex = indexRepositories(workspace, repoNames);

  // authority -> repository names that bind it
  const authorityOwners = new Map();
  for (const [repoName, info] of repoIndex) {
    for (const authority of info.authorities) {
      if (!authorityOwners.has(authority)) authorityOwners.set(authority, []);
      authorityOwners.get(authority).push(repoName);
    }
  }

  const findings = [];
  let profiles = 0;

  for (const [repoName, info] of repoIndex) {
    const selfModule = moduleOfRepo(repoName);
    for (const file of info.files) {
      profiles += 1;
      const relative = path.relative(workspace, file).replaceAll('\\', '/');

      for (const { key, value } of profileEntries(file)) {
        if (!SERVER_PREFIX.test(key) || !DEP_URL.test(key)) continue;
        if (BROWSER_MARKER.test(key)) continue;
        const authority = authorityOf(value);
        if (!authority) continue; // a routable external origin is a real separate process

        // Rule A: the URL points back at this application's own listener.
        if (info.authorities.has(authority)) {
          findings.push(`SELF-LOOP ${relative}: ${key}=${value} targets this application's own public ingress`);
          continue;
        }

        // Rule B: the URL points at another SDKWork module that this repository
        // already composes in-process.
        //
        // The owner must also be the dependency the variable *names*. Several
        // repositories share loopback ports across dev profiles, so authority
        // alone is ambiguous: `SDKWORK_CLOUDROUTER_OPEN_API_BASE_URL` pointing
        // at a port another module happens to bind is a cross-process call, not
        // an embedded self-call.
        const namedDep = dependencyNamedBy(key, info.embedded, selfModule);
        let reportedByRuleB = false;
        for (const owner of authorityOwners.get(authority) ?? []) {
          const ownerModule = moduleOfRepo(owner);
          if (!ownerModule || ownerModule === selfModule) continue;
          if (!info.embedded.has(ownerModule)) continue;
          // Require the variable to name this owner. Dev profiles reuse
          // loopback ports across applications (sdkwork-deployments and the
          // platform gateway both bind 3900), so authority alone misattributes
          // a cross-process call to whichever module happens to share the port.
          if (namedDep !== ownerModule) continue;
          findings.push(`EMBEDDED-LOCAL-DEP ${relative}: ${key}=${value} reaches ${owner} over HTTP although it is composed in-process (APPLICATION_GATEWAY_SPEC §2.3)`);
          reportedByRuleB = true;
          break;
        }
        if (reportedByRuleB) continue;

        // Rule C: a loopback URL naming a module this repository composes
        // in-process. Fallback for URLs that do not resolve to a known ingress,
        // so it only fires when rule B could not name the remote owner.
        const dep = namedDep;
        if (dep) {
          findings.push(`EMBEDDED-DECLARED-URL ${relative}: ${key}=${value} declares an HTTP base URL for ${dep} although it is composed in-process (APPLICATION_GATEWAY_SPEC §2.3)`);
        }
      }
    }

    // Rule D: the same violation in code form. A profile-only scan cannot see a
    // base URL that Rust builds at runtime from the process's own ingress bind,
    // so the declaration rules above pass while the process still talks to
    // itself over loopback. `APP_SDK_INTEGRATION_SPEC.md` §5.2 makes this
    // explicit; without this rule the gate has a structural blind spot.
    for (const file of rustSources(path.join(workspace, repoName))) {
      const derived = derivedLoopbackInRust(readText(file));
      if (!derived) continue;
      const relative = path.relative(workspace, file).replaceAll('\\', '/');
      findings.push(
        `EMBEDDED-DERIVED-LOOPBACK ${relative}: backend source derives a loopback origin (${derived}) from this process's own ingress/bind; consume the in-process port or take an authored topology value (APPLICATION_GATEWAY_SPEC §2.3, APP_SDK_INTEGRATION_SPEC §5.2)`,
      );
    }

    // Rule E: `APP_SDK_INTEGRATION_SPEC.md` §5.2 requires base-URL and bind
    // resolution to exist once, in `sdkwork-utils-rust::service_base_url`. A
    // second copy is the defect that makes standalone and cloud deployments
    // drift, so the gate must see the copy rather than only its symptoms.
    for (const file of rustSources(path.join(workspace, repoName))) {
      const duplicate = reimplementedBaseUrlResolution(readText(file), file);
      if (!duplicate) continue;
      const relative = path.relative(workspace, file).replaceAll('\\', '/');
      findings.push(
        `BASE-URL-RESOLUTION-DUPLICATED ${relative}: repository re-implements ${duplicate}; delegate to sdkwork-utils-rust::service_base_url so standalone and cloud cannot drift (APP_SDK_INTEGRATION_SPEC §5.2)`,
      );
    }
  }

  // An empty scan is a configuration error, never a pass. A mis-pointed
  // `--workspace` (for example the repository itself instead of the workspace
  // root) finds nothing and would otherwise silently mask every rule above.
  if (repoNames.length === 0) {
    findings.push(
      `SCAN-ROOT-EMPTY ${path.resolve(workspace)}: no repository with a Cargo.toml was found; point --workspace at the workspace root, not a single repository`,
    );
  } else if (profiles === 0) {
    findings.push(
      `SCAN-PROFILES-EMPTY ${path.resolve(workspace)}: no deployment profile was found under ${repoNames.length} repositories; the scan cannot prove anything and must not pass`,
    );
  }

  return { findings: [...new Set(findings)], repositories: repoNames.length, profiles };
}
