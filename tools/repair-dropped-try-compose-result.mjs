#!/usr/bin/env node
/**
 * Re-attach `?` to `ApiModuleRegistry::try_compose` calls whose Result the
 * web-module codemod silently dropped.
 *
 * The codemod turned
 *     let composed = ComposedApiAssembly::try_compose(title, vec![...])?;
 * into
 *     let composed = module_registry.try_compose(title);
 *
 * in a handful of hosts, so the following lines dereference a
 * `Result<ComposedApiAssembly, String>` as if it were the assembly itself:
 *
 *     crates/.../bootstrap.rs:20: error[E0609]: no field `route_manifest` on
 *       type `Result<ComposedApiAssembly, String>`
 *     crates/.../bootstrap.rs:23: error[E0599]: no method named `into_hosted`
 *       found for enum `Result<T, E>`
 *
 * This repair is driven by the compiler logs: every E0609/E0599 that names
 * `Result<ComposedApiAssembly, String>` (or a bare `Result<T, E>` on a binding
 * assigned from `try_compose`) makes the tool append `?` to the `try_compose`
 * call in the same file.
 *
 * Usage:
 *   node repair-dropped-try-compose-result.mjs [--logs <dir>] [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    logs: "E:/sdkwork-space/sdkwork-specs/.wm-cargo-check",
    workspace: "E:/sdkwork-space",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--logs") args.logs = argv[++i];
    else if (argv[i] === "--workspace") args.workspace = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

const DROPPED =
  /^([^\s:][^:]*):(\d+):(\d+): error\[E0(?:609|599)\]: (?:no field `[\w]+` on type|no method named `[\w]+` found for enum) `Result<ComposedApiAssembly, String>|Result<T, E>/;

function collect(logDir) {
  const files = new Set();
  for (const entry of fs.readdirSync(logDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".log")) continue;
    const repo = path.basename(entry.name, ".log");
    const text = fs.readFileSync(path.join(logDir, entry.name), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(DROPPED);
      if (!match) continue;
      files.add(`${repo}|${match[1]}`);
    }
  }
  return files;
}

const HANDLED_NEXT = /^\s*\.(map_err|expect|unwrap|unwrap_or|unwrap_or_else|unwrap_or_default)\b/;

function repair(repo, relative, workspace, dryRun) {
  const file = path.join(workspace, repo, relative);
  if (!fs.existsSync(file)) return { ok: false, reason: "file not found" };

  const source = fs.readFileSync(file, "utf8");
  if (!source.includes("try_compose(")) return { ok: false, reason: "no try_compose" };
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);

  let changed = false;
  const at = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/\.try_compose\(/.test(lines[i])) continue;
    const tail = lines[i].trimEnd();
    if (tail.endsWith("?")) continue;
    if (/\.(map_err|expect|unwrap|unwrap_or|unwrap_or_else|unwrap_or_default)\b/.test(tail)) continue;
    let k = i + 1;
    while (k < lines.length && lines[k].trim() === "") k += 1;
    if (k < lines.length && HANDLED_NEXT.test(lines[k])) continue;
    // Insert `?` before the statement terminator, not after it.
    if (tail.endsWith(";")) {
      lines[i] = `${tail.slice(0, -1)}?;`;
    } else {
      lines[i] = `${tail}?`;
    }
    changed = true;
    at.push(i + 1);
  }

  if (!changed) return { ok: false, reason: "already propagated" };
  if (!dryRun) fs.writeFileSync(file, lines.join(eol), "utf8");
  return { ok: true, file, at };
}

const args = parseArgs(process.argv.slice(2));
const targets = collect(args.logs);
let fixed = 0;

for (const key of targets) {
  const [repo, relative] = key.split("|");
  const result = repair(repo, relative, args.workspace, args.dryRun);
  if (!result.ok) {
    console.log(`[skip] ${repo} ${relative}: ${result.reason}`);
    continue;
  }
  fixed += 1;
  const rel = path.relative(args.workspace, result.file).replace(/\\/g, "/");
  console.log(`[${args.dryRun ? "dry" : "fix"}] ${rel}: attached '?' at line ${result.at.join(", ")}`);
}

console.log(
  `\ndropped try_compose result repair: ${fixed}/${targets.size} file(s)${
    args.dryRun ? " (dry run, nothing written)" : ""
  }`,
);
