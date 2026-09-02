#!/usr/bin/env node
/**
 * Restore assembly re-exports that standalone gateways import but the generated
 * `lib.rs` never published.
 *
 * Assembly crates are materialized from a template that only re-exports the
 * canonical names (`assemble_api_router`, `ApiAssembly`, and now `web_module*`).
 * Hand-written standalone hosts frequently import additional factory functions
 * (`assemble_api_router_from_env`, `assemble_api_router_runtime`,
 * `build_router_from_business`, ...), so `cargo check --workspace` fails with
 * E0432 / E0425 even though the functions exist in `bootstrap.rs`.
 *
 * This tool reads the cargo check logs produced by `wsl-cargo-check-repos.sh`
 * and re-publishes every missing name that really exists in the assembly crate,
 * preserving the `// SDKWORK-ASSEMBLY-LIB-CUSTOM:` marker contract.
 *
 * Usage:
 *   node repair-missing-assembly-exports.mjs [--logs <dir>] [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    logs: "E:/sdkwork-space/sdkwork-specs/.wm-cargo-check",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--logs") args.logs = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

function walk(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Collect `crate::name` pairs the compiler could not resolve. */
function collectMissing(logDir) {
  const missing = new Map(); // `${repo}|${crate}` -> Set(name)
  const repoOf = new Map(); // log file -> repo name

  for (const log of walk(logDir, ".log")) {
    const repo = path.basename(log, ".log");
    repoOf.set(log, repo);
    const source = fs.readFileSync(log, "utf8");

    let match;
    // Each unresolved name is fully qualified in its own backtick pair, e.g.
    //   unresolved imports `a::b::Foo`, `a::b::Bar`
    // so scan every `crate::Name` occurrence on an E0432 line instead of
    // stopping at the first closing backtick.
    const importLineRe = /error\[E0432\]: unresolved import[^\n]*/g;
    while ((match = importLineRe.exec(source))) {
      const pairRe = /`([a-z_][a-z0-9_]*)::([A-Za-z_][\w]*)`/g;
      let pair;
      while ((pair = pairRe.exec(match[0]))) {
        addMissing(missing, repo, pair[1], pair[2]);
      }
    }

    const findRe =
      /error\[E0425\]: cannot find (?:function|value|struct|type|enum) `([A-Za-z_][\w]*)` in crate `([a-z_][a-z0-9_]*)`/g;
    while ((match = findRe.exec(source))) {
      addMissing(missing, repo, match[2], match[1]);
    }
  }
  return missing;
}

function addMissing(map, repo, crate, name) {
  const key = `${repo}|${crate}`;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(name);
}

function findAssemblyCrate(repoDir, crateName) {
  // sdkwork_api_foo_assembly -> crates/sdkwork-api-foo-assembly
  const kebab = crateName.replace(/_/g, "-");
  const candidate = path.join(repoDir, "crates", kebab);
  if (fs.existsSync(path.join(candidate, "Cargo.toml"))) return candidate;
  if (!fs.existsSync(path.join(repoDir, "crates"))) return null;
  for (const entry of fs.readdirSync(path.join(repoDir, "crates"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cargo = path.join(repoDir, "crates", entry.name, "Cargo.toml");
    if (!fs.existsSync(cargo)) continue;
    const text = fs.readFileSync(cargo, "utf8");
    if (new RegExp(`name\\s*=\\s*"${crateName}"`).test(text)) {
      return path.join(repoDir, "crates", entry.name);
    }
  }
  return null;
}

function definedInAssembly(assemblyDir, name) {
  const src = path.join(assemblyDir, "src");
  if (!fs.existsSync(src)) return false;
  for (const file of walk(src, ".rs")) {
    const text = fs.readFileSync(file, "utf8");
    const re = new RegExp(`pub\\s+(?:async\\s+)?(?:fn|struct|enum|type|const|static)\\s+${name}\\b`);
    if (re.test(text)) return true;
  }
  return false;
}

function addExports(libPath, names, dryRun) {
  const source = fs.readFileSync(libPath, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const flat = source.replace(/\r\n/g, "\n");

  const single = flat.match(/pub use bootstrap::\{([^}]*)\};/);
  const multi = flat.match(/pub use bootstrap::\{([\s\S]*?)\};/);
  const block = single || multi;
  if (!block) return { ok: false, reason: "no pub use bootstrap block" };

  const existing = block[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const toAdd = names.filter((name) => !existing.includes(name));
  if (toAdd.length === 0) return { ok: false, reason: "already exported" };

  const merged = [...existing, ...toAdd];
  const inner = merged.length > 4 ? `\n    ${merged.join(", ")},\n` : ` ${merged.join(", ")} `;
  const next = flat.replace(block[0], `pub use bootstrap::{${inner}};`);

  if (!dryRun) fs.writeFileSync(libPath, next.split("\n").join(eol), "utf8");
  return { ok: true, added: toAdd };
}

const args = parseArgs(process.argv.slice(2));
const missing = collectMissing(args.logs);
let fixed = 0;
let skipped = 0;

for (const [key, names] of missing) {
  const [repo, crate] = key.split("|");
  const repoDir = path.join("E:/sdkwork-space", repo);
  if (!fs.existsSync(repoDir)) {
    console.log(`[skip] ${repo}: ${crate} — repo not found`);
    continue;
  }
  const assemblyDir = findAssemblyCrate(repoDir, crate);
  if (!assemblyDir) {
    console.log(`[skip] ${repo}: ${crate} — assembly crate not found`);
    continue;
  }
  const candidates = [...names].filter((name) => definedInAssembly(assemblyDir, name));
  if (candidates.length === 0) {
    console.log(`[skip] ${repo}: ${crate} — no missing name is defined in the assembly`);
    skipped += 1;
    continue;
  }
  const libPath = path.join(assemblyDir, "src", "lib.rs");
  if (!fs.existsSync(libPath)) {
    console.log(`[skip] ${repo}: ${crate} — lib.rs missing`);
    continue;
  }
  const result = addExports(libPath, candidates, args.dryRun);
  if (!result.ok) {
    console.log(`[skip] ${repo}: ${crate} — ${result.reason}`);
    continue;
  }
  fixed += 1;
  const rel = path.relative("E:/sdkwork-space", libPath).replace(/\\/g, "/");
  console.log(`[${args.dryRun ? "dry" : "fix"}] ${rel} += ${result.added.join(", ")}`);
}

console.log(
  `\nmissing assembly export repair: ${fixed} lib.rs updated, ${skipped} unresolvable${
    args.dryRun ? " (dry run, nothing written)" : ""
  }`,
);
