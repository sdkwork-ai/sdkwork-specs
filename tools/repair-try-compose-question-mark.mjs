#!/usr/bin/env node
/**
 * Repair codemod damage at `ApiModuleRegistry::try_compose` sites.
 *
 * `ApiModuleRegistry::try_compose(title)` returns `Result<ComposedApiAssembly, String>`.
 * The web-module codemod (migrate-web-modules.mjs Pass C) sometimes emitted a
 * trailing `?` while ALSO keeping the original error-handling combinator on the
 * following line:
 *
 *     let composed = module_registry
 *         .try_compose("SDKWork AppStore API")?
 *         .expect("appstore gateway composition failed");   // E0599
 *
 * `?` already unwraps the Result, so `.expect` / `.map_err` / `.unwrap` can never
 * apply afterwards. This tool removes the stray `?` whenever the next
 * non-blank line starts with a Result combinator, restoring the original
 * single-handler form.
 *
 * Usage:
 *   node repair-try-compose-question-mark.mjs [--workspace <dir>] [--dry-run]
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

const RESULT_COMBINATOR = /^\s*\.(map_err|expect|unwrap|unwrap_or|unwrap_or_else|unwrap_or_default)\b/;

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "target" || entry.name === "node_modules") continue;
    if (entry.name === "target-win" || entry.name === ".workbuddy") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".rs")) out.push(full);
  }
  return out;
}

function repairFile(file, dryRun) {
  const source = fs.readFileSync(file, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  let changed = false;
  const touched = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes(".try_compose(")) continue;
    if (!line.trimEnd().endsWith("?")) continue;
    // find the next non-blank line
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j += 1;
    if (j >= lines.length) continue;
    if (!RESULT_COMBINATOR.test(lines[j])) continue;

    lines[i] = line.trimEnd().slice(0, -1);
    changed = true;
    touched.push({ line: i + 1, next: lines[j].trim() });
  }

  if (!changed) return null;
  if (!dryRun) fs.writeFileSync(file, lines.join(eol), "utf8");
  return touched;
}

const args = parseArgs(process.argv.slice(2));
const files = walk(args.workspace);
let repairedFiles = 0;
let repairedSites = 0;

for (const file of files) {
  const touched = repairFile(file, args.dryRun);
  if (!touched) continue;
  repairedFiles += 1;
  repairedSites += touched.length;
  const rel = path.relative(args.workspace, file).replace(/\\/g, "/");
  console.log(`${args.dryRun ? "[dry]" : "[fix]"} ${rel}`);
  for (const site of touched) {
    console.log(`      line ${site.line}: dropped '?' before ${site.next}`);
  }
}

console.log(
  `\ntry_compose repair: ${repairedSites} site(s) across ${repairedFiles} file(s)${
    args.dryRun ? " (dry run, nothing written)" : ""
  }`,
);
