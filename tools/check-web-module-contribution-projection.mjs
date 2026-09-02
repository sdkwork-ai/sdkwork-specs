#!/usr/bin/env node
// Flags `web_module*` factories that feed a struct-shaped assembly result into
// `WebModule::from_contribution` without unwrapping it first.
//
// Two shapes exist in the workspace:
//
//  1. `pub struct ApiAssembly { contribution, .. }` — the factory must project
//     `.contribution`:
//         WebModule::from_contribution(assemble_api_router(..).await?.contribution)
//
//  2. `pub struct ApiAssembly { router }` — a degenerate shape produced for
//     applications declared with `"apiMode": "none"`. It carries no manifest,
//     OpenAPI document or permission catalog, so it cannot become a module at
//     all; the crate must alias `ApiAssembly` to `ApiAssemblyContribution` and
//     build it through `ApiAssemblyContribution::from_manifest` (the
//     sdkwork-birdcoder2 shape).
//
// Both are compile errors, so this gate exists to catch them before the
// compiler gets there.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE = process.argv[2] || 'E:/sdkwork-space';

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (['target', 'target-win', 'node_modules', '.git', '.workbuddy', '.sdkwork', 'dist'].includes(entry.name))
      continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.name.endsWith('.rs')) yield abs;
  }
}

const problems = [];

for (const file of walk(WORKSPACE)) {
  if (!/[/\\]crates[/\\]/.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  if (!/WebModule::from_contribution/.test(source)) continue;

  // Is `ApiAssembly` in this file a struct at all, or already an alias to
  // `ApiAssemblyContribution`? The closing brace may sit at column 0 with CRLF
  // endings, so do not anchor on a bare "\n}".
  const structMatch = source.match(
    /pub\s+struct\s+ApiAssembly\s*(?:<[^>]*>)?\s*\{([\s\S]*?)\r?\n\}/,
  );
  if (!structMatch) continue;

  const hasContributionField = /(^|\n)\s*pub\s+contribution\s*:/.test(structMatch[1]);
  // A flat `ApiAssembly { router, route_manifest, openapi, ... }` is still valid
  // when the factory projects it into a contribution explicitly. That is the
  // third shape in the workspace: no `contribution` field, but the fields are
  // handed to `ApiAssemblyContribution::try_new`/`from_manifest` at the call
  // site (the sdkwork-birdcoder shape).
  const buildsContributionExplicitly = /ApiAssemblyContribution::(try_new|from_manifest)\s*\(/.test(source);

  // The trailing `,?` matters: rustfmt puts the argument on its own line and
  // ends it with a comma, so without it the non-greedy body backtracks past
  // `.contribution` and reports a false positive on correct code.
  const factoryRe =
    /WebModule::from_contribution\(\s*([A-Za-z_][\w:]*)\(([\s\S]*?)\)\s*(\.await)?\s*(\?)?\s*(\.contribution)?\s*,?\s*\)/g;
  let match;
  while ((match = factoryRe.exec(source))) {
    const [, , , , , projected] = match;
    const line = source.slice(0, match.index).split('\n').length;
    const rel = path.relative(WORKSPACE, file).replace(/\\/g, '/');
    if (hasContributionField && !projected) {
      problems.push(
        `${rel}:${line}: needs '.contribution' projection before from_contribution`,
      );
    } else if (!hasContributionField && !buildsContributionExplicitly) {
      problems.push(
        `${rel}:${line}: 'ApiAssembly' has no 'contribution' field — alias it to ` +
          `ApiAssemblyContribution and build it with from_manifest, or project the ` +
          `flat fields through ApiAssemblyContribution::try_new`,
      );
    }
  }

  // A struct-shaped ApiAssembly also breaks every other factory that hands the
  // assembly straight to `WebModule::from_contribution` via a local binding.
  const boundRe =
    /WebModule::from_contribution\(\s*([a-z_][\w]*)\s*,?\s*\)/g;
  let bound;
  while ((bound = boundRe.exec(source))) {
    const [, binding] = bound;
    const declRe = new RegExp(
      `let\\s+(?:mut\\s+)?${binding}\\s*=\\s*[A-Za-z_][\\w:]*\\([\\s\\S]*?\\)\\s*\\.await\\s*\\?\\s*;`,
    );
    if (!declRe.test(source)) continue;
    const line = source.slice(0, bound.index).split('\n').length;
    const rel = path.relative(WORKSPACE, file).replace(/\\/g, '/');
    if (hasContributionField) {
      problems.push(`${rel}:${line}: binding '${binding}' needs '.contribution' projection`);
    } else if (!buildsContributionExplicitly) {
      problems.push(
        `${rel}:${line}: binding '${binding}' is a struct-shaped ApiAssembly without a contribution`,
      );
    }
  }
}

if (problems.length === 0) {
  console.log('Web module contribution projection check passed');
} else {
  console.log(`${problems.length} projection problem(s):`);
  for (const item of problems) console.log(`  ${item}`);
  process.exitCode = 1;
}
