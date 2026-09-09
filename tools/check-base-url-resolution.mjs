#!/usr/bin/env node
/**
 * Browser base-URL resolution debt checker per ENVIRONMENT_SPEC.md section 6.3.
 *
 * Flags browser-reachable app code that resolves SDK base URLs without going
 * through `resolveBaseUrl` from `@sdkwork/sdk-common`:
 *   - env-base-url-chain: reads a *_BASE_URL env/config key without resolveBaseUrl
 *   - host-rewrite-derivation: derives an API host from window.location
 *   - hardcoded-api-domain: hardcodes api[-env].brand / im[-env].brand edge domains
 *   - manual-candidate-split: hand-splits a comma/semicolon candidate list
 *   - protocol-alignment-missing: rewrites a parsed URL host without http/https
 *     page-protocol alignment (§6.3 protocol adaptation; checked even in
 *     compliant wrappers)
 *
 * A file that imports or calls `resolveBaseUrl` is compliant. Test files,
 * generated SDK output, docs, and Node-side dev scripts are out of scope.
 * Heuristic per the checker conventions of check-pagination.mjs; not a
 * substitute for review.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SPECS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHECKED_EXTENSIONS = new Set(['.ts', '.tsx', '.vue', '.js', '.jsx', '.mts', '.cts', '.mjs']);
const PRUNED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.svn',
  'docs', 'doc', 'scripts', 'crates', 'tests', 'test', '__tests__',
  '.sdkwork', '.agents', 'deployments', 'external', 'bin', 'tools',
  'generated', '__generated__', 'server-openapi', 'fixtures', 'mocks',
  'target', '.turbo', '.output', '.nuxt', 'storybook-static',
]);

const ENV_KEY_PATTERN = /\b(?:VITE_|PORTAL_PUBLIC_)?SDKWORK_[A-Z0-9_]*BASE_URL\b/g;
const LOCATION_PATTERN = /(?:window\.)?location\.(?:hostname|host\b|origin)/;
const API_HOST_BUILD_PATTERN = /['"`]https?:\/\/api(?:-[a-z0-9]+)?\.(?:sdkwork|birdcoder)[a-z.]*|['"`]api\.[a-z0-9.-]*sdkwork[a-z.]*|api-[a-z0-9]+\.(?:sdkwork|birdcoder)[a-z.]*\s*['"`]|\.replace\(\s*\/?['"`][^'"`]*\b(?:api|im)\b[^'"`]*\.(?:sdkwork|birdcoder)|['"`]https?:\/\/\$\{[^}]*location/;
const HARDCODED_DOMAIN_PATTERN = /['"`]https?:\/\/(?:api|im)(?:-[a-z0-9]+)?\.(?:sdkwork|birdcoder)[a-z0-9.-]+/g;
const SPLIT_PATTERN = /split\s*\(\s*\/\s*\[?[,;]/;

// §6.3 protocol adaptation: wrappers mutating parsed URL hosts must handle the
// page protocol (window.location.protocol, or a parameter named for it).
const PROTOCOL_HANDLING_PATTERN = /location\.protocol|\bpageProtocol\b|\bcurrentProtocol\b/u;

function isTestLikePath(rel) {
  const normalized = rel.replace(/\\/gu, '/');
  return /(?:^|\/)(?:tests?|__tests__|testing)(?:\/|$)/u.test(normalized)
    || /\.(?:test|spec)\.[jt]sx?$/u.test(normalized)
    || /\.stories\.[jt]sx?$/u.test(normalized);
}

function isCandidateSourcePath(repoDir, fullPath) {
  const rel = path.relative(repoDir, fullPath);
  if (!CHECKED_EXTENSIONS.has(path.extname(fullPath))) return false;
  if (fullPath.endsWith('.d.ts')) return false;
  if (/\.generated\.tsx?$/u.test(fullPath)) return false;
  // Skip build-artifact .js twins of tracked .ts sources.
  if (/\.(js|mjs)$/u.test(fullPath)
    && (fs.existsSync(fullPath.replace(/\.(js|mjs)$/u, '.ts'))
      || fs.existsSync(fullPath.replace(/\.(js|mjs)$/u, '.tsx')))) return false;
  if (isTestLikePath(rel)) return false;
  return isScopedSourceFile(rel);
}

/**
 * Discover tracked source files via `git ls-files` so generated/untracked
 * build artifacts (bundled runtimes, emitted env docs) are never flagged.
 * Falls back to a pruned filesystem walk outside git repos.
 */
function listRepoSourceFiles(repoDir) {
  try {
    const out = execFileSync('git', ['-C', repoDir, 'ls-files', '-z'], {
      maxBuffer: 256 * 1024 * 1024,
    }).toString();
    const files = [];
    for (const entry of out.split('\0')) {
      if (!entry) continue;
      const fullPath = path.join(repoDir, entry);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (isCandidateSourcePath(repoDir, fullPath)) files.push(fullPath);
    }
    return files;
  } catch {
    const files = [];
    walkSourceFiles(repoDir, repoDir, files);
    return files;
  }
}

function isScopedSourceFile(rel) {
  const normalized = rel.replace(/\\/gu, '/');
  return normalized.startsWith('src/')
    || normalized.includes('/src/')
    || /^apps\/[^/]+\/src\//u.test(normalized)
    || /^packages\/[^/]+\/src\//u.test(normalized);
}

function walkSourceFiles(rootDir, repoDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.vite') continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (PRUNED_DIRS.has(entry.name)) continue;
      walkSourceFiles(fullPath, repoDir, out);
    } else if (entry.isFile()) {
      if (!CHECKED_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      if (/\.generated\.tsx?$/u.test(entry.name)) continue;
      // Skip build-artifact .js twins of tracked .ts sources.
      if (/\.(js|mjs)$/u.test(entry.name)
        && (fs.existsSync(fullPath.replace(/\.(js|mjs)$/u, '.ts'))
          || fs.existsSync(fullPath.replace(/\.(js|mjs)$/u, '.tsx')))) continue;
      const rel = path.relative(repoDir, fullPath);
      if (!isScopedSourceFile(rel)) continue;
      if (isTestLikePath(rel)) continue;
      out.push(fullPath);
    }
  }
}

// Functions from @sdkwork/sdk-common whose use marks a module as a compliant
// resolution wrapper (ENVIRONMENT_SPEC.md §6.3 single-implementation family).
const SDK_COMMON_RESOLUTION_IMPORT = /from\s+['"]@sdkwork\/sdk-common['"]/u;
const SDK_COMMON_RESOLUTION_FNS = [
  'resolveBaseUrl', 'resolveApiHost', 'resolveApiPort',
  'getApiHostForEnvironment', 'getEnvironmentLabel', 'splitBaseUrls',
];

function collectCompliantWrapperNames(repoDir, files) {
  const fileContents = new Map();
  const exportsByFile = new Map();
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    fileContents.set(file, content);
    const names = new Set();
    for (const match of content.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gu)) {
      names.add(match[1]);
    }
    for (const match of content.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*=/gu)) {
      names.add(match[1]);
    }
    exportsByFile.set(file, names);
  }

  // Seed: modules that directly use the @sdkwork/sdk-common resolution family.
  const compliantFiles = new Set();
  for (const [file, content] of fileContents) {
    const isWrapperSource = /\bresolveBaseUrl\b/u.test(content)
      || (SDK_COMMON_RESOLUTION_IMPORT.test(content)
        && SDK_COMMON_RESOLUTION_FNS.some((fn) => new RegExp(`\\b${fn}\\b`, 'u').test(content)));
    if (isWrapperSource) {
      compliantFiles.add(file);
    }
  }

  // Transitive closure: a module delegating to a compliant wrapper export is
  // itself a compliant wrapper (A -> B -> @sdkwork/sdk-common).
  let changed = true;
  while (changed) {
    changed = false;
    for (const [file, content] of fileContents) {
      if (compliantFiles.has(file)) continue;
      for (const name of namesUnion(compliantFiles, exportsByFile)) {
        if (new RegExp(`\\b${name}\\s*\\(`, 'u').test(content)) {
          compliantFiles.add(file);
          changed = true;
          break;
        }
      }
    }
  }

  const names = new Set();
  for (const file of compliantFiles) {
    for (const name of exportsByFile.get(file) ?? []) {
      names.add(name);
    }
  }
  return names;
}

function namesUnion(compliantFiles, exportsByFile) {
  const all = new Set();
  for (const file of compliantFiles) {
    for (const name of exportsByFile.get(file) ?? []) {
      all.add(name);
    }
  }
  return all;
}

function findDebtInFile(content, wrapperNames) {
  const debt = [];
  const lines = content.split('\n');
  const exemptLine = (zeroBased) =>
    [/base-url-check:\s*exempt/u.test(lines[zeroBased - 2] ?? ''),
      /base-url-check:\s*exempt/u.test(lines[zeroBased - 1] ?? ''),
      /base-url-check:\s*exempt/u.test(lines[zeroBased] ?? ''),
      /base-url-check:\s*exempt/u.test(lines[zeroBased + 1] ?? ''),
      /base-url-check:\s*exempt/u.test(lines[zeroBased + 2] ?? '')].some(Boolean);
  // §6.3 protocol adaptation (normative): a browser wrapper that rewrites a
  // parsed URL's host components MUST also handle the page protocol
  // (http ↔ https alignment). Checked independently of wrapper delegation so
  // compliant resolution wrappers cannot bypass it.
  if (!/base-url-check:\s*exempt/u.test(content)) {
    for (const match of content.matchAll(/\.hostname\s*=(?!=)/gu)) {
      const lineIndex = content.slice(0, match.index).split('\n').length - 1;
      if (/^\s*(?:\/\/|\/\*|\*)/u.test(lines[lineIndex] ?? '')) continue;
      if (!PROTOCOL_HANDLING_PATTERN.test(content)) {
        debt.push({
          id: 'protocol-alignment-missing',
          message: 'rewrites a parsed URL host without page-protocol alignment (§6.3 protocol adaptation)',
          line: lineIndex + 1,
        });
        break;
      }
    }
  }
  const delegates = [...wrapperNames].some((name) =>
    new RegExp(`\\b${name}\\s*\\(`, 'u').test(content),
  );
  if (/\bresolveBaseUrl\b/u.test(content) || delegates) {
    return debt;
  }
  const envMatches = [];
  for (const match of content.matchAll(ENV_KEY_PATTERN)) {
    if (match[0].includes('DATABASE_URL')) continue;
    const zeroBased = content.slice(0, match.index).split('\n').length - 1;
    if (exemptLine(zeroBased)) continue;
    envMatches.push({ id: match[0], line: zeroBased + 1 });
  }
  const hasLocation = LOCATION_PATTERN.test(content);
  const hasApiHostBuild = API_HOST_BUILD_PATTERN.test(content);
  if (envMatches.length > 0) {
    debt.push({
      id: 'env-base-url-chain',
      message: `reads base-url env/config key(s) ${[...new Set(envMatches.map((m) => m.id))].join(', ')} without resolveBaseUrl (§6.3)`,
      line: envMatches[0].line,
    });
  }
  if (hasLocation && hasApiHostBuild && !content.includes('base-url-check: exempt')) {
    debt.push({
      id: 'host-rewrite-derivation',
      message: 'derives an API host from window.location without resolveBaseUrl (§6.3)',
      line: 0,
    });
  }
  const hardcoded = [...content.matchAll(HARDCODED_DOMAIN_PATTERN)].filter(
    (match) => !exemptLine(content.slice(0, match.index).split('\n').length - 1),
  );
  if (hardcoded.length > 0) {
    const line = content.slice(0, hardcoded[0].index).split('\n').length;
    debt.push({
      id: 'hardcoded-api-domain',
      message: `hardcoded environment edge domain(s) ${[...new Set(hardcoded.map((m) => m[0].replace(/['"]/g, '')))].join(', ')} — candidates belong in SDKWORK_API_BASE_URL config (§6.3)`,
      line,
    });
  }
  if (envMatches.length > 0 && SPLIT_PATTERN.test(content)) {
    debt.push({
      id: 'manual-candidate-split',
      message: 'hand-splits a base-url candidate list; use splitBaseUrls/resolveBaseUrl (§6.3)',
      line: 0,
    });
  }
  return debt;
}

function collectRepos(workspaceRoot) {
  const repos = [];
  let entries;
  try {
    entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot read workspace root ${workspaceRoot}: ${error.message}`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) continue;
    if (entry.name === 'sdkwork-specs') continue;
    repos.push(path.join(workspaceRoot, entry.name));
  }
  return repos;
}

function usage() {
  return [
    'Usage:',
    '  node tools/check-base-url-resolution.mjs --workspace <sdkwork-space-or-repo-root>',
    'Options:',
    '  --repo <name>   Check a single sdkwork-* repository only',
    '  --json          Emit machine-readable JSON',
  ].join('\n');
}

function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      repo: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.workspace) {
    console.log(usage());
    process.exit(values.help ? 0 : 1);
  }
  const workspaceRoot = path.resolve(values.workspace);
  const repos = values.repo
    ? [path.join(workspaceRoot, values.repo)]
    : collectRepos(workspaceRoot);
  const report = [];
  let debtTotal = 0;
  for (const repo of repos) {
    if (!fs.existsSync(repo)) continue;
    const files = listRepoSourceFiles(repo);
    const wrapperNames = collectCompliantWrapperNames(repo, files);
    const repoDebt = [];
    for (const file of files) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const findings = findDebtInFile(content, wrapperNames);
      if (findings.length > 0) {
        const rel = path.relative(repo, file).replace(/\\/gu, '/');
        for (const finding of findings) {
          repoDebt.push({ repo: path.basename(repo), file: rel, ...finding });
        }
      }
    }
    debtTotal += repoDebt.length;
    report.push({ repo: path.basename(repo), files: files.length, debt: repoDebt });
  }
  if (values.json) {
    console.log(JSON.stringify({ ok: debtTotal === 0, debtTotal, repos: report }, null, 2));
  } else {
    for (const entry of report) {
      if (entry.debt.length === 0) continue;
      console.error(`\n${entry.repo} (${entry.debt.length} findings)`);
      for (const finding of entry.debt) {
        console.error(`- ${finding.file}${finding.line ? `:${finding.line}` : ''} ${finding.id}: ${finding.message}`);
      }
    }
    if (debtTotal > 0) {
      console.error(`\nbase-url resolution check failed: ${debtTotal} finding(s) across ${report.filter((r) => r.debt.length > 0).length} repo(s)`);
      console.error('Resolve SDK base origins through resolveBaseUrl from @sdkwork/sdk-common (ENVIRONMENT_SPEC.md §6.3).');
    } else {
      console.log('base-url resolution check passed: no resolution debt found.');
    }
  }
  process.exit(debtTotal === 0 ? 0 : 1);
}

try {
  main();
} catch (error) {
  console.error(`base-url resolution check failed: ${error.message}`);
  process.exit(1);
}
