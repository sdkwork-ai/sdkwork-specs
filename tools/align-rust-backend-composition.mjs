#!/usr/bin/env node

// Aligns member Cargo.toml sibling SDKWork path dependencies to `workspace = true`
// per rust-backend-composition rules. Requires root Cargo.toml [workspace.dependencies]
// to declare the sibling path once.

import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', '.tmp', 'target', 'node_modules', 'dist', 'build', 'external']);

function parseArgs(argv) {
  const args = { root: process.cwd(), workspace: null, write: false, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = path.resolve(argv[++i]);
    else if (arg === '--workspace') args.workspace = path.resolve(argv[++i]);
    else if (arg === '--write') args.write = true;
    else if (arg === '--dry-run') args.dryRun = true;
  }
  return args;
}

function listCargoTomls(repoRoot) {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.name === 'Cargo.toml') files.push(full);
    }
  };
  walk(repoRoot);
  return files.sort((a, b) => a.localeCompare(b));
}

// Normalized key match (Cargo treats - and _ as equivalent).
function normKey(rawName) {
  return String(rawName ?? '').replaceAll('-', '_');
}

function parseWorkspaceDependenciesKeys(rootCargoPath) {
  if (!fs.existsSync(rootCargoPath)) return { exact: new Map(), text: null };
  const text = fs.readFileSync(rootCargoPath, 'utf8');
  const exact = new Map(); // normKey -> exactKey string
  let section = null;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== 'workspace.dependencies') continue;
    const depMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=/u);
    if (depMatch) exact.set(normKey(depMatch[1]), depMatch[1]);
  }
  return { exact, text };
}

function isWorkspaceTrueLine(depLine) {
  return /^[A-Za-z0-9_.-]+\s*=\s*\{\s*workspace\s*=\s*true/u.test(depLine);
}

function isDirectSiblingSdkworkPath(depLine) {
  return /^[A-Za-z0-9_.-]+\s*=\s*\{\s*path\s*=\s*"(?:\.\.(?:\/|\\))+sdkwork-/u.test(depLine);
}

function extractPathSpec(depLine) {
  const m = depLine.match(/^[A-Za-z0-9_.-]+\s*=\s*\{\s*path\s*=\s*"([^"]+)"/u);
  return m ? m[1] : null;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Inject missing [workspace.dependencies] entries into root Cargo.toml.
function addRootWorkspaceDeps(rootCargoPath, additions) {
  if (additions.length === 0) return 0;
  const text = fs.readFileSync(rootCargoPath, 'utf8');
  const lines = text.split(/\r?\n/u);
  const sectionIdx = lines.findIndex((l) => /^\s*\[workspace\.dependencies\]\s*$/u.test(l));
  let insertAt = -1;
  if (sectionIdx !== -1) {
    // find end of section (next [section] or EOF)
    for (let i = sectionIdx + 1; i < lines.length; i += 1) {
      if (/^\s*\[[^\]]+\]\s*$/u.test(lines[i])) {
        insertAt = i;
        break;
      }
      insertAt = i + 1;
    }
  }
  const block = additions.map((a) => `${a.key} = { path = "${a.path}", package = "${a.package}" }`);
  if (sectionIdx !== -1 && insertAt !== -1) {
    lines.splice(insertAt, 0, ...block);
  } else {
    lines.push('', '[workspace.dependencies]', ...block);
  }
  fs.writeFileSync(rootCargoPath, lines.join('\n'), 'utf8');
  return block.length;
}

function alignRepo(repoRoot, writeOptions) {
  const rootCargo = path.join(repoRoot, 'Cargo.toml');
  const { exact } = parseWorkspaceDependenciesKeys(rootCargo);
  const changes = [];
  const rootAdditions = new Map(); // normalized key -> { key, path, package }
  const files = listCargoTomls(repoRoot).filter((p) => path.resolve(p) !== path.resolve(rootCargo));
  for (const cargoPath of files) {
    const rel = path.relative(repoRoot, cargoPath);
    const text = fs.readFileSync(cargoPath, 'utf8');
    const lines = text.split(/\r?\n/u);
    let dirty = false;
    const next = lines.map((rawLine) => {
      const line = rawLine.trim();
      const keyMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=/u);
      const key = keyMatch ? keyMatch[1] : null;
      if (!key) return rawLine;
      const nk = normKey(key);
      const indent = rawLine.match(/^\s*/u)[0];

      // Already workspace=true: align the key form to the root's exact key.
      if (isWorkspaceTrueLine(line)) {
        const rootExact = exact.get(nk);
        if (rootExact && rootExact !== key) {
          dirty = true;
          return `${indent}${rootExact} = { workspace = true }`;
        }
        return rawLine;
      }

      if (!isDirectSiblingSdkworkPath(line)) return rawLine;
      if (exact.has(nk)) {
        dirty = true;
        return `${indent}${exact.get(nk)} = { workspace = true }`;
      }
      // undeclared sibling/cross-repo path: resolve target dir relative to repo root
      const targetRaw = extractPathSpec(line);
      if (!targetRaw) return rawLine;
      const memberDir = path.dirname(cargoPath);
      const targetAbs = path.resolve(memberDir, targetRaw);
      // Sibling/cross-repo SDKWork crate must exist as a cargo package to declare in root.
      if (!fs.existsSync(path.join(targetAbs, 'Cargo.toml'))) return rawLine;
      const relTarget = toPosix(path.relative(repoRoot, targetAbs));
      rootAdditions.set(nk, {
        key, // member natural key; root + member must share the same exact key
        path: relTarget,
        package: path.basename(path.normalize(targetAbs)),
      });
      dirty = true;
      return `${indent}${key} = { workspace = true }`;
    });
    if (!dirty) continue;
    if (writeOptions.write && !writeOptions.dryRun) {
      fs.writeFileSync(cargoPath, next.join('\n'), 'utf8');
    }
    changes.push({ rel, kind: 'workspace-true' });
  }
  if (rootAdditions.size > 0 && writeOptions.write && !writeOptions.dryRun) {
    const added = addRootWorkspaceDeps(rootCargo, [...rootAdditions.values()]);
    changes.push({ rel: 'Cargo.toml', kind: `root-workspace-deps+${added}` });
  }
  return changes;
}

function listWorkspaceRepos(workspaceRoot) {
  if (!fs.existsSync(workspaceRoot)) return [];
  return fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((repoRoot) => fs.existsSync(path.join(repoRoot, 'Cargo.toml')));
}

function main() {
  const args = parseArgs(process.argv);
  const writeOptions = { write: args.write, dryRun: args.dryRun };
  const roots = args.workspace ? listWorkspaceRepos(args.workspace) : [args.root];
  let total = 0;
  for (const root of roots) {
    const changes = alignRepo(root, writeOptions);
    for (const change of changes) {
      total += 1;
      console.log(`align cargo ${path.basename(root)}:${change.rel} (${change.kind})`);
    }
  }
  console.log(`cargo workspace-true alignment complete (${total} member file(s) changed)`);
  process.exit(0);
}

main();