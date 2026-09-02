#!/usr/bin/env node
/**
 * Ensure every `ApiModuleRegistry::try_compose` result is actually consumed.
 *
 * `try_compose(title)` returns `Result<ComposedApiAssembly, String>`. The
 * web-module codemod converted
 *     ComposedApiAssembly::try_compose(title, vec![...])?
 * into
 *     module_registry.try_compose(title)
 * and in a few hosts dropped the `?` entirely, leaving a bare `Result` that the
 * following code dereferences as if it were the composed assembly:
 *
 *     let composed = module_registry.try_compose("SDKWork ModelKit API");
 *     ... composed.route_manifest.clone()            // E0609
 *     ... composed.into_hosted(framework)            // E0599
 *
 * This tool scans every modified Rust file, finds `try_compose(` chains that
 * have no error handling at all (`?`, `.map_err`, `.expect`, `.unwrap`,
 * `.unwrap_or*`) and appends `?`, which is the form the surrounding hosts used
 * before the migration.
 *
 * Usage:
 *   node repair-try-compose-propagation.mjs [--workspace <dir>] [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { workspace: process.cwd(), dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--workspace") args.workspace = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (["target", "node_modules", ".git", ".workbuddy", "target-win", ".sdkwork"].includes(entry.name))
      continue;
    if (entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".rs")) out.push(full);
  }
  return out;
}

const HANDLED = /^\s*\.(map_err|expect|unwrap|unwrap_or|unwrap_or_else|unwrap_or_default)\b/;
const HANDLED_SAME_LINE = /\.(map_err|expect|unwrap|unwrap_or|unwrap_or_else|unwrap_or_default)\b/;

function repairFile(file, dryRun) {
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes("try_compose(")) return null;
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);

  const touched = [];
  let changed = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/\.try_compose\(/.test(line)) continue;

    // Find the end of this call chain: the last consecutive line that starts
    // with '.' or ends with an unclosed '('.
    let end = i;
    let depth = 0;
    for (let j = i; j < lines.length; j += 1) {
      const text = lines[j];
      for (const ch of text) {
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
      }
      end = j;
      if (depth <= 0) break;
    }

    const tail = lines[end].trimEnd();
    if (tail.endsWith("?")) continue;
    if (HANDLED_SAME_LINE.test(lines[end])) continue;
    // look at the following non-blank line for a Result combinator
    let k = end + 1;
    while (k < lines.length && lines[k].trim() === "") k += 1;
    if (k < lines.length && HANDLED.test(lines[k])) continue;
    // a closing line such as `);` or `}` right after means the Result is dropped
    // on the floor; those hosts used `?` before the migration. The `?` belongs
    // before the statement terminator, not after it.
    lines[end] = tail.endsWith(";") ? `${tail.slice(0, -1)}?;` : `${tail}?`;
    changed = true;
    touched.push({ line: end + 1, text: tail });
  }

  if (!changed) return null;
  if (!dryRun) fs.writeFileSync(file, lines.join(eol), "utf8");
  return touched;
}

const args = parseArgs(process.argv.slice(2));
let files = 0;
let sites = 0;

for (const file of walk(args.workspace)) {
  if (!/[/\\]crates[/\\]/.test(file)) continue;
  const touched = repairFile(file, args.dryRun);
  if (!touched) continue;
  files += 1;
  sites += touched.length;
  const rel = path.relative(args.workspace, file).replace(/\\/g, "/");
  console.log(`[${args.dryRun ? "dry" : "fix"}] ${rel}`);
  for (const site of touched) console.log(`      line ${site.line}: ${site.text}?`);
}

console.log(
  `\ntry_compose propagation repair: ${sites} site(s) across ${files} file(s)${
    args.dryRun ? " (dry run, nothing written)" : ""
  }`,
);
