#!/usr/bin/env node
/**
 * Convert degenerate `ApiAssembly { router }` bootstrap files into real
 * `ApiAssemblyContribution` owners so that `web_module()` is well typed.
 *
 * Applications declared with `"apiMode": "none"` and an empty `routeCrates`
 * list (audio, video, tts, terminal, codebox, ...) had no contribution at all:
 * the web-module codemod emitted
 *
 *     pub struct ApiAssembly { pub router: Router }
 *     pub fn web_module() -> Result<WebModule, String> {
 *         Ok(WebModule::from_contribution(assemble_api_router()))   // E0308
 *     }
 *
 * which cannot compile: `WebModule::from_contribution` needs an
 * `ApiAssemblyContribution`. This tool rewrites those files to the
 * sdkwork-birdcoder2 shape — an empty but fully formed contribution carrying
 * owner, title, manifest, permission catalog and OpenAPI document — while
 * preserving the public `assemble_api_router() -> ApiAssembly` signature so no
 * caller changes are required.
 *
 * Usage:
 *   node repair-empty-api-assembly-modules.mjs [--workspace <dir>] [--dry-run]
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
    if (entry.name === ".git" || entry.name === "target" || entry.name === "node_modules") continue;
    if (entry.name === "target-win" || entry.name === ".workbuddy") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".rs")) out.push(full);
  }
  return out;
}

const DEGENERATE = /pub struct ApiAssembly \{\s*pub router: Router,\s*\}/;
const FROM_CONTRIBUTION = /WebModule::from_contribution\(assemble_api_router\(\)\)/;

function findOwner(repoDir) {
  const roots = [path.join(repoDir, "crates")];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith("-assembly")) continue;
      const manifest = path.join(root, entry.name, "assembly-manifest.json");
      if (!fs.existsSync(manifest)) continue;
      const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (parsed.applicationCode) return `sdkwork-${parsed.applicationCode}`;
    }
  }
  return null;
}

function findTitle(repoDir, owner) {
  const crates = path.join(repoDir, "crates");
  if (!fs.existsSync(crates)) return null;
  for (const entry of fs.readdirSync(crates, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const main = path.join(crates, entry.name, "src", "main.rs");
    if (!fs.existsSync(main)) continue;
    const source = fs.readFileSync(main, "utf8");
    const match = source.match(/try_compose\(\s*"([^"]+)"/);
    if (match) return match[1];
  }
  const code = owner.replace(/^sdkwork-/, "");
  return `SDKWork ${code} API`;
}

function rewrite(file, owner, title, dryRun) {
  const source = fs.readFileSync(file, "utf8");
  if (!DEGENERATE.test(source) || !FROM_CONTRIBUTION.test(source)) return null;

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  let next = source
    .replace(
      /use sdkwork_web_bootstrap::WebModule;/,
      "use sdkwork_web_bootstrap::{ApiAssemblyContribution, WebModule};",
    )
    .replace(DEGENERATE, "pub type ApiAssembly = ApiAssemblyContribution;")
    .replace(
      /pub fn assemble_api_router\(\) -> ApiAssembly \{[\s\S]*?\n\}/,
      [
        "pub fn assemble_api_router() -> ApiAssembly {",
        `    ApiAssemblyContribution::from_manifest(`,
        `        "${owner}",`,
        `        "${title}",`,
        "        Router::new(),",
        "        HttpRouteManifest::from_owned_routes(Vec::new()),",
        "        Vec::new(),",
        "        std::sync::Arc::new(sdkwork_web_bootstrap::AlwaysReady),",
        "    )",
        `    .unwrap_or_else(|error| panic!("${owner} API assembly failed: {error}"))`,
        "}",
      ].join("\n"),
    );

  if (!next.includes("use sdkwork_web_core::") && !/use sdkwork_web_bootstrap::\{[^}]*HttpRouteManifest/.test(next)) {
    // HttpRouteManifest is re-exported by sdkwork_web_bootstrap (pub use sdkwork_web_core::*)
    // so no import change is strictly required; keep the file as is.
  }

  if (next === source) return null;
  // `next` is derived from `source` by replacements, so it already carries the
  // original line endings. Re-splitting on "\n" here would double every "\r".
  if (!dryRun) fs.writeFileSync(file, next, "utf8");
  return true;
}

const args = parseArgs(process.argv.slice(2));
const files = walk(args.workspace);
let rewritten = 0;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (!DEGENERATE.test(source) || !FROM_CONTRIBUTION.test(source)) continue;
  const rel = path.relative(args.workspace, file).replace(/\\/g, "/");
  const repoDir = file.slice(0, file.indexOf(path.sep, args.workspace.length + 1));
  const owner = findOwner(repoDir);
  if (!owner) {
    console.log(`[skip] ${rel}: owner not found`);
    continue;
  }
  const title = findTitle(repoDir, owner);
  const ok = rewrite(file, owner, title, args.dryRun);
  if (!ok) {
    console.log(`[skip] ${rel}: no rewrite applied`);
    continue;
  }
  rewritten += 1;
  console.log(`[${args.dryRun ? "dry" : "fix"}] ${rel} -> ${owner} / ${title}`);
}

console.log(
  `\nempty ApiAssembly repair: ${rewritten} file(s)${
    args.dryRun ? " (dry run, nothing written)" : ""
  }`,
);
