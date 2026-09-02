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
  }

  return { findings: [...new Set(findings)], repositories: repoNames.length, profiles };
}
