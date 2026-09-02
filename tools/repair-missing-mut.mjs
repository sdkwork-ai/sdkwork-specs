#!/usr/bin/env node
/**
 * Restore `mut` on bindings the web-module codemod demoted.
 *
 * The codemod rewrote
 *     let mut composed = ComposedApiAssembly::try_compose(...)?;
 * into
 *     let composed = module_registry.try_compose(...)?;
 *
 * dropping `mut` whenever the host still assigns a field afterwards
 * (`composed.readiness_check = ...`), which fails with E0594.
 *
 * The repair is driven by the compiler: every
 *   error[E0594]: cannot assign to `X.field`, as `X` is not declared as mutable
 * in the cargo check logs is turned into `let X =` -> `let mut X =` in the
 * reported file. Driving it from the compiler keeps the change surgical instead
 * of guessing from source text.
 *
 * Usage:
 *   node repair-missing-mut.mjs [--logs <dir>] [--dry-run]
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

const E0594 =
  /^([^\s:][^:]*):(\d+):\d+: error\[E0594\]: cannot assign to `([A-Za-z_][\w]*)\.[\w]+`, as `\3` is not declared as mutable/m;

function collect(logDir) {
  const sites = [];
  for (const entry of fs.readdirSync(logDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".log")) continue;
    const repo = path.basename(entry.name, ".log");
    const text = fs.readFileSync(path.join(logDir, entry.name), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(E0594);
      if (!match) continue;
      sites.push({ repo, file: match[1], line: Number(match[2]), binding: match[3] });
    }
  }
  return sites;
}

function repair(site, workspace, dryRun) {
  // The log path is relative to the repo root (cargo prints workspace-relative
  // paths for members), so try the repo root first and fall back to the workspace.
  const candidates = [
    path.join(workspace, site.repo, site.file),
    path.join(workspace, site.file),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) return { ok: false, reason: "file not found" };

  const source = fs.readFileSync(file, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);

  // Search upwards from the offending assignment for the binding declaration.
  for (let i = site.line - 1; i >= 0; i -= 1) {
    const decl = lines[i].match(new RegExp(`\\blet\\s+(mut\\s+)?${site.binding}\\s*=`));
    if (!decl) continue;
    if (decl[1]) return { ok: false, reason: "already mut" };
    lines[i] = lines[i].replace(
      new RegExp(`\\blet\\s+${site.binding}\\s*=`),
      `let mut ${site.binding} =`,
    );
    if (!dryRun) fs.writeFileSync(file, lines.join(eol), "utf8");
    return { ok: true, file, line: i + 1 };
  }
  return { ok: false, reason: "declaration not found" };
}

const args = parseArgs(process.argv.slice(2));
const sites = collect(args.logs);
let fixed = 0;

for (const site of sites) {
  const result = repair(site, args.workspace, args.dryRun);
  if (!result.ok) {
    console.log(`[skip] ${site.repo} ${site.file}: ${result.reason}`);
    continue;
  }
  fixed += 1;
  const rel = path.relative(args.workspace, result.file).replace(/\\/g, "/");
  console.log(
    `[${args.dryRun ? "dry" : "fix"}] ${rel}:${result.line} -> let mut ${site.binding}`,
  );
}

console.log(
  `\nmissing mut repair: ${fixed}/${sites.length} site(s)${
    args.dryRun ? " (dry run, nothing written)" : ""
  }`,
);
