#!/usr/bin/env node
/**
 * Surface Authorization Tiers gate — PERMISSION_STANDARD_SPEC.md
 * §"Surface Authorization Tiers And Consumer Default-Open Policy".
 *
 * Contract-level rule enforced here:
 *   - `apis/app-api/**` OpenAPI operations default to authorization tier 1
 *     (consumer-authenticated). Tier 0 (public) and tier 2 (ownership) are
 *     refinements enforced by route/service layers, not contract metadata.
 *   - An app-api operation MAY declare `x-sdkwork-permission` only when it also
 *     declares `x-sdkwork-auth-tier: 3` (role/scope gated: sensitive consumer
 *     operations such as payments or org administration).
 *   - backend-api / open-api contracts are out of scope for this gate; they keep
 *     the full permission-catalog model.
 *
 * Usage:
 *   node check-app-permission-tiers.mjs --workspace <repoRoot> [--fix] [--json]
 *   node check-app-permission-tiers.mjs --workspaces-root <dir> [--fix] [--json]
 *
 * `--fix` removes `x-sdkwork-permission` keys from violating app-api operations
 * (contract metadata only; runtime enforcement lives in route/service layers).
 * Generated JSON stays valid: a trailing comma is repaired when the removed key
 * was the last key of its object. Files are only rewritten when content changes.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OPENAPI_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

function parseArgs(argv) {
  const options = { workspaces: [], fix: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      options.workspaces.push(path.resolve(argv[++index] ?? '.'));
    } else if (arg === '--workspaces-root') {
      options.workspacesRoot = path.resolve(argv[++index] ?? '.');
    } else if (arg === '--fix') {
      options.fix = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function listWorkspaceRoots(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((workspace) => statSync(path.join(workspace, 'apis', 'app-api'), { throwIfNoEntry: false }) !== undefined);
}

function walkOpenApiAppApiFiles(directory) {
  const files = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(yaml|yml|json)$/u.test(entry.name)) {
        files.push(full);
      }
    }
  }
  return files.sort();
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Extract operations (path/method/operationId/x-sdkwork-* auth markers) from YAML text. */
function yamlOperations(text) {
  const lines = text.split(/\r?\n/u);
  const operations = [];
  let currentPath = null;
  let currentEntry = null;
  let inPaths = false;

  for (const line of lines) {
    if (/^\S/u.test(line)) {
      inPaths = /^paths:\s*$/u.test(line);
      currentPath = null;
      currentEntry = null;
      continue;
    }
    if (!inPaths) continue;

    const pathMatch = line.match(/^ {2}(.+):\s*$/u);
    if (pathMatch && unquote(pathMatch[1]).startsWith('/')) {
      currentPath = unquote(pathMatch[1]);
      currentEntry = null;
      continue;
    }
    const methodMatch = line.match(/^ {4}(get|post|put|patch|delete|head|options|trace):\s*$/u);
    if (methodMatch && currentPath) {
      currentEntry = { routePath: currentPath, method: methodMatch[1], operation: {} };
      operations.push(currentEntry);
      continue;
    }
    if (!currentEntry) continue;

    // Anything deeper than the method key belongs to the operation object until
    // the next path/method key at indent 2/4.
    if (/^ {2,4}\S/u.test(line)) {
      currentEntry = null;
      continue;
    }
    const keyMatch = line.match(/^\s*"?(x-sdkwork-permission|x-sdkwork-auth-tier|operationId)"?\s*:\s*(.+?)\s*,?\s*$/u);
    if (keyMatch) {
      currentEntry.operation[unquote(keyMatch[1])] = unquote(keyMatch[2]);
    }
  }
  return operations;
}

function jsonOperations(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    return { operations: [], invalid: true };
  }
  const operations = [];
  const paths = document?.paths ?? {};
  for (const [routePath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!OPENAPI_METHODS.has(method) || !operation || typeof operation !== 'object') continue;
      operations.push({
        routePath,
        method,
        operation: {
          operationId: operation.operationId,
          'x-sdkwork-permission': operation['x-sdkwork-permission'],
          'x-sdkwork-auth-tier': operation['x-sdkwork-auth-tier'],
        },
      });
    }
  }
  return { operations, invalid: false };
}

function isTierThree(operation) {
  return String(operation['x-sdkwork-auth-tier'] ?? '').trim() === '3';
}

/** Remove `x-sdkwork-permission` key lines from text (JSON + YAML line-surgical).
 * A line is only rewritten when the key/value is the sole content on the line
 * (apart from JSON/YAML separators); mixed lines are reported, never edited. */
function stripPermissionAnnotations(text) {
  const lines = text.split(/\r?\n/u);
  const kept = [];
  let removed = 0;
  let skippedMixed = 0;
  const permissionKey = /("(?:x-sdkwork-permission)"|(?:x-sdkwork-permission))\s*:/u;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!permissionKey.test(line)) {
      kept.push(line);
      continue;
    }
    const residue = line
      .replace(permissionKey, '')
      .replace(/("[^"]*"\s*:\s*)?("[^"]*"|'[^']*'|[^,:{}\s])+\s*,?/u, '')
      .replace(/[\s,{}]/gu, '');
    if (residue.length > 0) {
      skippedMixed += 1;
      kept.push(line);
      continue;
    }
    const nextLine = lines[index + 1] ?? '';
    const lastKeyOfObject = !/,/u.test(line.trimEnd()) && /^\}/u.test(nextLine.trim());
    if (lastKeyOfObject && kept.length > 0 && /,\s*$/u.test(kept[kept.length - 1])) {
      kept[kept.length - 1] = kept[kept.length - 1].replace(/,\s*$/u, '');
    }
    removed += 1;
  }
  return { text: kept.join('\n'), removed, skippedMixed };
}

function evaluateWorkspace(workspace) {
  const appApiDir = path.join(workspace, 'apis', 'app-api');
  const findings = [];
  // Repositories without an app-api contract surface (no `apis/app-api/`) have no
  // tier-3 candidates to audit; skipping keeps `--workspace` as forgiving as
  // `listWorkspaceRoots`, which already filters roots by the same directory.
  if (statSync(appApiDir, { throwIfNoEntry: false }) === undefined) {
    return findings;
  }
  for (const file of walkOpenApiAppApiFiles(appApiDir)) {
    const text = readFileSync(file, 'utf8');
    const rel = path.relative(workspace, file).split(path.sep).join('/');
    const isJson = /\.json$/u.test(file);
    const { operations, invalid } = isJson ? jsonOperations(text) : { operations: yamlOperations(text), invalid: false };
    if (invalid) {
      findings.push({ file: rel, kind: 'unparseable-json', detail: 'file is not valid JSON' });
      continue;
    }
    for (const entry of operations) {
      const permission = entry.operation['x-sdkwork-permission'];
      if (!permission) continue;
      if (!isTierThree(entry.operation)) {
        findings.push({
          file: rel,
          kind: 'app-api-permission-without-tier-3',
          operation: entry.operation.operationId ?? `${entry.method.toUpperCase()} ${entry.routePath}`,
          permission,
          detail: `app-api operation declares x-sdkwork-permission: ${permission} without x-sdkwork-auth-tier: 3`,
        });
      }
    }
  }
  return findings;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || (options.workspaces.length === 0 && !options.workspacesRoot)) {
    console.error('Usage: check-app-permission-tiers.mjs --workspace <repoRoot> [--fix] [--json]');
    console.error('       check-app-permission-tiers.mjs --workspaces-root <dir> [--fix] [--json]');
    process.exitCode = options.help ? 0 : 2;
    return;
  }

  let workspaces = options.workspaces;
  if (options.workspacesRoot) {
    workspaces = workspaces.concat(listWorkspaceRoots(options.workspacesRoot));
  }

  const report = [];
  for (const workspace of workspaces) {
    const findings = evaluateWorkspace(workspace);
    if (options.fix) {
      const filesToFix = [...new Set(findings.filter((f) => f.kind === 'app-api-permission-without-tier-3').map((f) => f.file))];
      for (const rel of filesToFix) {
        const absolute = path.join(workspace, rel);
        const before = readFileSync(absolute, 'utf8');
        const { text, removed, skippedMixed } = stripPermissionAnnotations(before);
        if (skippedMixed > 0) {
          report.push({ workspace: path.basename(workspace), file: rel, kind: 'fix-rejected', detail: `${skippedMixed} mixed-content line(s) need manual edits` });
        }
        if (removed === 0) continue;
        if (/\.json$/u.test(absolute)) {
          try {
            JSON.parse(text);
          } catch {
            report.push({ workspace: path.basename(workspace), file: rel, kind: 'fix-rejected', detail: 'fix would break JSON; manual edit required' });
            continue;
          }
        }
        writeFileSync(absolute, text);
        report.push({ workspace: path.basename(workspace), file: rel, fixedKeys: removed });
      }
      const remaining = evaluateWorkspace(workspace);
      report.push({ workspace: path.basename(workspace), violationsBefore: findings.length, violationsAfterFix: remaining.length });
    } else {
      for (const finding of findings) {
        report.push({ workspace: path.basename(workspace), ...finding });
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const row of report) {
      if (row.kind === 'app-api-permission-without-tier-3') {
        console.log(`${row.workspace}/${row.file}: ${row.detail} (${row.operation})`);
      } else if (row.kind === 'unparseable-json') {
        console.log(`${row.workspace}/${row.file}: ${row.detail}`);
      } else if (row.kind === 'fix-rejected') {
        console.log(`${row.workspace}/${row.file}: ${row.detail}`);
      } else {
        console.log(`${row.workspace}: violations ${row.violationsBefore} -> ${row.violationsAfterFix}${row.fixedKeys ? ` (removed ${row.fixedKeys} keys)` : ''}`);
      }
    }
  }

  if (!options.fix) {
    const violationCount = report.filter((row) => row.kind === 'app-api-permission-without-tier-3' || row.kind === 'unparseable-json').length;
    if (violationCount > 0) {
      console.error(`\n${violationCount} app-api contract violation(s): consumer operations must not declare x-sdkwork-permission without x-sdkwork-auth-tier: 3.`);
      console.error('See PERMISSION_STANDARD_SPEC.md §Surface Authorization Tiers. Run with --fix to strip legacy annotations.');
      process.exitCode = 1;
    }
  } else {
    const remaining = report.reduce((sum, row) => sum + (typeof row.violationsAfterFix === 'number' ? row.violationsAfterFix : 0), 0);
    if (remaining > 0) {
      console.error(`\n${remaining} violation(s) remain after fix (tier-3 annotations are kept; fix-rejected files need manual edits).`);
      process.exitCode = 1;
    }
  }
}

main();
