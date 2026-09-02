#!/usr/bin/env node
// Migrates an SDKWork workspace to the Web Module integration standard
// (API_ASSEMBLY_SPEC §4.1.1).
//
// Pass A — module definitions: appends canonical `web_module()` /
// `web_module_with_pool()` / `web_module_with_context()` factories to every
// `crates/sdkwork-api-*-assembly/src/bootstrap.rs` and exports them from the
// crate `lib.rs`.
//
// Pass B — host integration: rewrites
// `ComposedApiAssembly::try_compose(title, vec![...])?…` in standalone gateways
// into the registry form (`ApiModuleRegistry::new()` + `add_modules` +
// `try_compose` + existing hosting chain).
//
// Pass C — module factory call sites: swaps `assemble_api_router_from_env()` /
// `assemble_api_router_with_pool(pool)` in migrated hosts for the assembly's
// canonical `web_module()` / `web_module_with_pool(pool)` factory.
//
// Usage:
//   node tools/migrate-web-modules.mjs --workspace ..            # apply
//   node tools/migrate-web-modules.mjs --workspace .. --dry      # report only
//   node tools/migrate-web-modules.mjs --workspace .. --repos sdkwork-cms,sdkwork-iam

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: '.' },
    repos: { type: 'string' },
    dry: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log('Usage: node tools/migrate-web-modules.mjs --workspace <root> [--repos a,b] [--dry]');
  process.exit(0);
}

const workspace = path.resolve(values.workspace);
const onlyRepos = values.repos
  ? new Set(values.repos.split(',').map((value) => value.trim()).filter(Boolean))
  : null;
const dry = Boolean(values.dry);
const report = { modules: [], hosts: [], callsites: [], skipped: [] };

// ---------------------------------------------------------------------------
// Rust signature scanning (tolerates generics, multi-line params, where clauses)
// ---------------------------------------------------------------------------

function matchDelimited(source, start, open, close) {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function findFunction(source, name) {
  const header = new RegExp(`pub (async )?fn ${name}\\b`, 'g');
  let match;
  while ((match = header.exec(source)) !== null) {
    const isAsync = Boolean(match[1]);
    let cursor = match.index + match[0].length;
    if (source[cursor] === '<') {
      const close = source.indexOf('>', cursor);
      if (close === -1) continue;
      cursor = close + 1;
    }
    while (/\s/.test(source[cursor] ?? '')) cursor += 1;
    if (source[cursor] !== '(') continue;
    const closeParen = matchDelimited(source, cursor, '(', ')');
    if (closeParen === -1) continue;
    const params = source.slice(cursor + 1, closeParen).trim();
    const tail = source.slice(closeParen + 1, closeParen + 400);
    const arrow = /^\s*->\s*([\s\S]*?)\{/.exec(tail);
    if (!arrow) {
      // No return type: `-> ()` style or a `where` clause we cannot model.
      const where = /^\s*where\b/.exec(tail);
      if (where) return null;
      continue;
    }
    const returnType = arrow[1].trim().replace(/\s+/g, ' ');
    if (/\bwhere\b/.test(returnType)) return null;
    return { isAsync, params, returnType };
  }
  return null;
}

function unwrapExpression(call, returnType) {
  if (!/^(anyhow::)?Result\s*</.test(returnType)) return call;
  if (/,\s*String\s*>$/.test(returnType)) return `${call}?`;
  return `${call}.map_err(|error| error.to_string())?`;
}

// ---------------------------------------------------------------------------
// Pass A — module definition factories
// ---------------------------------------------------------------------------

const ZERO_ARG_ROUTER_ENTRIES = ['assemble_api_router'];
const ZERO_ARG_ENV_ENTRIES = [
  'assemble_api_router_from_env',
  'assemble_api_router_from_environment',
  'assemble_business_routes_from_env',
];

function contextBootstrapFunction(source) {
  const pattern =
    /(?:pub )?(?:async )?fn (\w+)\s*\(\s*\)\s*->\s*Result<\s*ApiAssemblyContext\s*,/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    return match[1];
  }
  return null;
}

function findZeroArg(source, candidates) {
  for (const name of candidates) {
    const signature = findFunction(source, name);
    if (signature && signature.params.length === 0) return { name, ...signature };
  }
  return null;
}

const MODULE_DOC = [
  '/// Canonical Web Module definition for this application',
  '/// (API_ASSEMBLY_SPEC §4.1.1): the complete HTTP surface — every route,',
  '/// manifest, and OpenAPI document of this owner — as one installable module.',
];

function buildModuleFactory(source) {
  const router = findZeroArg(source, ZERO_ARG_ROUTER_ENTRIES);
  if (router) {
    const call = router.isAsync ? 'assemble_api_router().await' : 'assemble_api_router()';
    return {
      name: 'web_module',
      block: [
        ...MODULE_DOC,
        `pub ${router.isAsync ? 'async ' : ''}fn web_module() -> Result<WebModule, String> {`,
        `    Ok(WebModule::from_contribution(${unwrapExpression(call, router.returnType)}))`,
        '}',
      ].join('\n'),
    };
  }

  const env = findZeroArg(source, ZERO_ARG_ENV_ENTRIES);
  if (env) {
    const invocation = env.isAsync ? `${env.name}().await` : `${env.name}()`;
    return {
      name: 'web_module',
      block: [
        ...MODULE_DOC,
        `pub ${env.isAsync ? 'async ' : ''}fn web_module() -> Result<WebModule, String> {`,
        `    Ok(WebModule::from_contribution(${unwrapExpression(invocation, env.returnType)}))`,
        '}',
      ].join('\n'),
    };
  }

  const contextEntry = findFunction(source, 'assemble_api_router');
  if (contextEntry && /ApiAssemblyContext/.test(contextEntry.params)) {
    const bootstrap = contextBootstrapFunction(source);
    if (bootstrap) {
      const contextCall = contextEntry.isAsync
        ? 'assemble_api_router(context).await'
        : 'assemble_api_router(context)';
      return {
        name: 'web_module',
        block: [
          ...MODULE_DOC,
          'pub async fn web_module() -> Result<WebModule, String> {',
          `    let context = ${bootstrap}().await?;`,
          `    Ok(WebModule::from_contribution(${unwrapExpression(contextCall, contextEntry.returnType)}))`,
          '}',
        ].join('\n'),
      };
    }
  }
  return null;
}

function buildContextModuleFactory(source) {
  const contextEntry = findFunction(source, 'assemble_api_router');
  if (!contextEntry || !/ApiAssemblyContext/.test(contextEntry.params)) return null;
  const call = contextEntry.isAsync
    ? 'assemble_api_router(context).await'
    : 'assemble_api_router(context)';
  return {
    name: 'web_module_with_context',
    block: [
      '/// Installs this application as a Web Module with a caller-supplied assembly',
      '/// context (API_ASSEMBLY_SPEC §4.1.1).',
      `pub ${contextEntry.isAsync ? 'async ' : ''}fn web_module_with_context(`,
      '    context: ApiAssemblyContext,',
      ') -> Result<WebModule, String> {',
      `    Ok(WebModule::from_contribution(${unwrapExpression(call, contextEntry.returnType)}))`,
      '}',
    ].join('\n'),
  };
}

function buildPoolModuleFactory(source) {
  const poolEntry = findFunction(source, 'assemble_api_router_with_pool');
  if (!poolEntry) return null;
  const poolParam = /^(\w+)\s*:/.exec(poolEntry.params)?.[1] ?? 'pool';
  const poolType =
    /^(\w+)\s*:\s*([^,]+)$/.exec(poolEntry.params)?.[2]?.trim() ?? 'DatabasePool';
  const call = poolEntry.isAsync
    ? `assemble_api_router_with_pool(${poolParam}).await`
    : `assemble_api_router_with_pool(${poolParam})`;
  return {
    name: 'web_module_with_pool',
    block: [
      '/// Same as [`web_module`] but composed on a process-shared database pool',
      '/// (platform gateways, API_ASSEMBLY_SPEC §4.1.1).',
      `pub ${poolEntry.isAsync ? 'async ' : ''}fn web_module_with_pool(${poolParam}: ${poolType}) -> Result<WebModule, String> {`,
      `    Ok(WebModule::from_contribution(${unwrapExpression(call, poolEntry.returnType)}))`,
      '}',
    ].join('\n'),
  };
}

// A generated assembly context that carries only injectors and a readiness
// check can be defaulted, which yields the canonical zero-argument factory.
function buildDefaultContextModuleFactory(source) {
  const struct = /pub struct ApiAssemblyContext\s*\{([^}]*)\}/.exec(source);
  if (!struct) return null;
  const fields = struct[1]
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean)
    .map((field) => field.split(':')[0].trim().replace(/^pub\s+/, ''));
  const expected = ['domain_context_injectors', 'readiness_check'];
  if (fields.length !== expected.length) return null;
  if (!expected.every((field) => fields.includes(field))) return null;
  return {
    name: 'web_module',
    block: [
      ...MODULE_DOC,
      'pub async fn web_module() -> Result<WebModule, String> {',
      '    web_module_with_context(ApiAssemblyContext {',
      '        domain_context_injectors: Vec::new(),',
      '        readiness_check: Arc::new(sdkwork_web_bootstrap::AlwaysReady),',
      '    })',
      '    .await',
      '}',
    ].join('\n'),
  };
}

// Plans the module factories for one assembly crate. Entrypoints may live in
// `bootstrap.rs`, `environment.rs`, or `lib.rs`, so the whole crate is scanned
// and each factory is appended next to the entrypoint it wraps.
export function planModuleFactories(srcDir) {
  const files = collectSources(srcDir).map((file) => ({
    path: file,
    text: fs.readFileSync(file, 'utf8'),
  }));
  const rank = (file) => (path.basename(file.path) === 'bootstrap.rs' ? 0 : 1);
  const ordered = [...files].sort((a, b) => rank(a) - rank(b));
  const definedAnywhere = (name) =>
    files.some((file) => new RegExp(`pub (?:async )?fn ${name}\\b`).test(file.text));

  const wanted = [
    { name: 'web_module', build: buildModuleFactory },
    { name: 'web_module_with_pool', build: buildPoolModuleFactory },
    { name: 'web_module_with_context', build: buildContextModuleFactory },
    { name: 'web_module', build: buildDefaultContextModuleFactory },
  ];

  const byPath = new Map();
  const names = [];
  for (const factory of wanted) {
    if (definedAnywhere(factory.name)) continue;
    const target = ordered.find((file) => factory.build(file.text));
    if (!target) continue;
    const produced = factory.build(target.text);
    const bucket = byPath.get(target.path) ?? { file: target, blocks: [] };
    bucket.blocks.push(produced.block);
    byPath.set(target.path, bucket);
    names.push(factory.name);
  }

  return { plans: [...byPath.values()], names, files };
}

function ensureWebModuleImport(source) {
  if (
    /use\s+sdkwork_web_bootstrap::\{[^}]*\bWebModule\b/.test(source) ||
    /use\s+sdkwork_web_bootstrap::WebModule\b/.test(source)
  ) {
    return source;
  }
  if (/use sdkwork_web_bootstrap::\{([^}]*)\};/.test(source)) {
    return source.replace(/use sdkwork_web_bootstrap::\{([^}]*)\};/, (full, names) => {
      const list = names
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      list.push('WebModule');
      list.sort((a, b) => a.localeCompare(b));
      return `use sdkwork_web_bootstrap::{${list.join(', ')}};`;
    });
  }
  return insertAfterModuleHeader(source, 'use sdkwork_web_bootstrap::WebModule;');
}

function insertAfterModuleHeader(source, statement) {
  const lines = source.split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*(\/\/!|#!\[)/.test(line) || line.trim() === '') index += 1;
    else break;
  }
  lines.splice(index, 0, statement);
  return lines.join('\n');
}

function appendBlocks(source, blocks) {
  let updated = ensureWebModuleImport(source);
  const marker = '\n#[cfg(test)]';
  const insertAt = updated.includes(marker) ? updated.indexOf(marker) : updated.length;
  const separator = updated.slice(insertAt).startsWith('\n') ? '' : '\n';
  updated = `${updated.slice(0, insertAt)}\n${blocks.join('\n\n')}${separator}${updated.slice(insertAt)}`;
  return updated;
}

export function applyModuleFactories(srcDir, libPath) {
  const { plans, names } = planModuleFactories(srcDir);
  if (plans.length === 0) return { status: 'manual-entrypoint', names: [] };
  for (const plan of plans) {
    const updated = appendBlocks(plan.file.text, plan.blocks);
    fs.writeFileSync(plan.file.path, updated);
  }
  const exported = exportFromLib(libPath, names);
  if (exported.status !== 'none') fs.writeFileSync(libPath, exported.source);
  return { status: 'added', names };
}

function exportFromLib(libPath, names) {
  if (names.length === 0) return { status: 'none', source: fs.readFileSync(libPath, 'utf8') };
  const source = fs.readFileSync(libPath, 'utf8');
  const missing = names.filter((name) => !new RegExp(`\\b${name}\\b`).test(source));
  if (missing.length === 0) return { status: 'already', source };
  const blockPattern = /pub use bootstrap::\{([^}]*)\};/;
  if (blockPattern.test(source)) {
    const updated = source.replace(blockPattern, (full, list) => {
      const entries = [
        ...list
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        ...missing,
      ];
      const [first, ...rest] = entries;
      const sorted = [first, ...rest.sort((a, b) => a.localeCompare(b))];
      return `pub use bootstrap::{${sorted.join(', ')}};`;
    });
    return { status: 'exported', source: updated };
  }
  const updated = `${source.replace(/\s+$/, '')}\n\npub use bootstrap::{${missing.join(', ')}};\n`;
  return { status: 'exported', source: updated };
}

// ---------------------------------------------------------------------------
// Pass B — standalone host integration
// ---------------------------------------------------------------------------

const COMPOSE_CALL = 'ComposedApiAssembly::try_compose(';

export function migrateStandaloneHost(source) {
  const start = source.indexOf(COMPOSE_CALL);
  if (start === -1) return { status: 'no-compose', source };
  if (/ApiModuleRegistry/.test(source)) return { status: 'already', source };

  // The statement may wrap across lines: `let mut composed =\n    ComposedApiAssembly::…`.
  const letMatch = /(^|\n)([ \t]*)let\s+(?:mut\s+)?(\w+)\s*=\s*$/.exec(source.slice(0, start));
  if (!letMatch) return { status: 'manual-statement', source };
  const statementStart = letMatch.index + letMatch[1].length;
  const indent = letMatch[2];
  const variable = letMatch[3];

  const openParen = start + COMPOSE_CALL.length - 1;
  const closeParen = matchDelimited(source, openParen, '(', ')');
  if (closeParen === -1) return { status: 'manual-args', source };
  const args = source.slice(openParen + 1, closeParen);
  const split = topLevelSplit(args);
  if (!split) return { status: 'manual-args', source };
  const [title, contributions] = split.map((part) => part.trim());

  const semicolon = source.indexOf(';', closeParen);
  if (semicolon === -1) return { status: 'manual-tail', source };

  // The original call ends with `?`, optionally followed by an error-conversion
  // step (`.map_err(..)?`) that must now be attached to the registry compose.
  let rest = source.slice(closeParen + 1, semicolon).replace(/^\s*\?/, '');
  let errorConversion = '';
  const mapErr = /^\s*\.map_err\(/.exec(rest);
  if (mapErr) {
    const open = rest.indexOf('(', mapErr.index ?? 0);
    const close = matchDelimited(rest, open, '(', ')');
    if (close !== -1) {
      const after = rest.slice(close + 1);
      if (/^\s*\?/.test(after)) {
        errorConversion = rest.slice(0, close + 1) + '?';
        rest = after.replace(/^\s*\?/, '');
      }
    }
  }
  const chain = rest;

  const replacement = [
    `${indent}let mut module_registry = ApiModuleRegistry::new();`,
    `${indent}module_registry.add_modules(${contributions});`,
    `${indent}let ${variable} = module_registry`,
    `${indent}    .try_compose(${title})${errorConversion}${chain};`,
  ].join('\n');

  return {
    status: 'migrated',
    source: `${source.slice(0, statementStart)}${replacement}${source.slice(semicolon + 1)}`,
  };
}

// ---------------------------------------------------------------------------
// Pass D — hosts that project `.router` straight off an assembly contribution
// ---------------------------------------------------------------------------

function findLetStatements(source) {
  const statements = [];
  const header = /(^|\n)([ \t]*)let\s+(?:mut\s+)?(\w+)\s*=/g;
  let match;
  while ((match = header.exec(source)) !== null) {
    const start = match.index + match[1].length;
    const equals = match.index + match[0].length;
    let depth = 0;
    let end = -1;
    for (let i = equals; i < source.length; i += 1) {
      const char = source[i];
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') depth -= 1;
      else if (char === ';' && depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) continue;
    statements.push({
      start,
      end: end + 1,
      indent: match[2],
      variable: match[3],
      expression: source.slice(equals, end).trim(),
    });
  }
  return statements;
}

function enclosingFunctionReturnsResult(source, index) {
  const head = source.slice(0, index);
  const pattern = /\b(?:pub\s+)?(?:async\s+)?fn\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*\)(\s*->\s*[^{]*)?\{/g;
  let last = null;
  let match;
  while ((match = pattern.exec(head)) !== null) last = match;
  if (!last) return false;
  return /->\s*(?:[\w:]*\bResult\b|[\w:<>, ]*\bResult\b)/.test(last[1] ?? '');
}

export function titleForCrate(crateName) {
  const app = crateName
    .replace(/^sdkwork-api-/, '')
    .replace(/-(standalone-gateway|standalone)$/, '');
  const words = app
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return `SDKWork ${words.join(' ')} API`;
}

export function migrateDirectRouterHost(source, title) {
  if (/ApiModuleRegistry/.test(source)) return { status: 'already', source };
  const statements = findLetStatements(source);
  for (const statement of statements) {
    const { expression, variable } = statement;
    if (!/assemble_\w*router/.test(expression)) continue;
    if (/\btry_compose\b/.test(expression)) continue;
    const projected = /\.(router|route_manifest|readiness_check|openapi)$/.test(expression);
    const inner = projected ? expression.replace(/\.\w+$/, '') : expression;
    if (!projected && !new RegExp(`\\b${variable}\\s*\\.\\s*router\\b`).test(source)) continue;
    const suffix = projected ? expression.slice(inner.length) : '';
    const propagation = enclosingFunctionReturnsResult(source, statement.start) ? '?' : '';
    const composed = propagation
      ? `module_registry.try_compose("${title}")?`
      : `module_registry\n${statement.indent}    .try_compose("${title}")\n${statement.indent}    .unwrap_or_else(|error| panic!("${title} module composition failed: {error}"))`;
    const replacement = [
      `${statement.indent}let mut module_registry = ApiModuleRegistry::new();`,
      `${statement.indent}module_registry.add_module(${inner});`,
      `${statement.indent}let ${variable} = ${composed}${suffix};`,
    ].join('\n');
    return {
      status: 'migrated',
      source: `${source.slice(0, statement.start)}${replacement}${source.slice(statement.end)}`,
    };
  }
  return { status: 'manual-shape', source };
}

function topLevelSplit(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if ('([{'.includes(char)) depth += 1;
    else if ('}])'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) {
      return [text.slice(0, i), text.slice(i + 1)];
    }
  }
  return null;
}

// Hosts that return the composed profile directly, e.g.
// `Ok(ComposedApiAssembly::try_compose(TITLE, vec![assembly])?.into_hosted(fw).router)`.
export function migrateExpressionComposeHost(source) {
  const start = source.indexOf(COMPOSE_CALL);
  if (start === -1) return { status: 'no-compose', source };
  const openParen = start + COMPOSE_CALL.length - 1;
  const closeParen = matchDelimited(source, openParen, '(', ')');
  if (closeParen === -1) return { status: 'manual-args', source };
  const split = topLevelSplit(source.slice(openParen + 1, closeParen));
  if (!split) return { status: 'manual-args', source };
  const [title, contributions] = split.map((part) => part.trim());

  // Preserve the original error handling verbatim: an optional `?` and an
  // optional `.map_err(..)?` conversion that follows the compose call.
  let cursor = closeParen + 1;
  let propagation = '';
  const whitespace = /^\s*/.exec(source.slice(cursor))[0];
  if (source[cursor + whitespace.length] === '?') {
    propagation = '?';
    cursor += whitespace.length + 1;
  }
  let errorConversion = '';
  const mapErr = /^\s*\.map_err\(/.exec(source.slice(cursor));
  if (mapErr) {
    const open = cursor + mapErr[0].length - 1;
    const close = matchDelimited(source, open, '(', ')');
    const after = /^\s*\?/.exec(source.slice(close + 1));
    if (close !== -1 && after) {
      errorConversion = source.slice(cursor, close + 1) + after[0];
      cursor = close + 1 + after[0].length;
    }
  }
  if (!propagation && !errorConversion) return { status: 'manual-expression', source };

  // Hoist the registry above the enclosing statement.
  let depth = 0;
  let statementStart = 0;
  for (let i = start; i >= 0; i -= 1) {
    const char = source[i];
    if (char === ')' || char === '}' || char === ']') depth += 1;
    else if (char === '(' || char === '{' || char === '[') {
      if (depth === 0) continue;
      depth -= 1;
    } else if (depth === 0 && (char === ';' || char === '{' || char === '}')) {
      statementStart = i + 1;
      break;
    }
  }
  const indent = /^[ \t]*/.exec(source.slice(statementStart))[0] ?? '';
  const leading = /^\s*/.exec(source.slice(statementStart))[0] ?? '';
  const insertAt = statementStart + leading.length;

  const replacement = [
    `let mut module_registry = ApiModuleRegistry::new();`,
    `${indent}module_registry.add_modules(${contributions});`,
    `${indent}`,
  ].join('\n');

  const updated =
    source.slice(0, insertAt) +
    replacement +
    source.slice(insertAt, start) +
    `module_registry\n${indent}    .try_compose(${title})${propagation}${errorConversion}` +
    source.slice(cursor);

  return { status: 'migrated', source: updated };
}

export function dropUnusedImport(source, name) {
  const usage = new RegExp(`\\b${name}\\b`, 'g');
  const occurrences = source.match(usage);
  if (!occurrences) return source;
  const body = source.replace(
    new RegExp(`^use\\s+([\\w:]*)\\{([^}]*)\\b${name}\\b([^}]*)\\};\\s*$`, 'gm'),
    (full, path, before, after) => {
      const keep = `${before}${after}`
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => !new RegExp(`^${name}$`).test(item.replace(/^pub\\s+/, '')));
      if (keep.length === 0) return '';
      keep.sort((a, b) => a.localeCompare(b));
      return `use ${path}{${keep.join(', ')}};`;
    },
  );
  if (body !== source) return body;
  if (occurrences.length > 1) return source;
  return source.replace(new RegExp(`^use\\s+[\\w:]+${name}\\s*;\\s*\\n`, 'm'), '');
}

export function ensureRegistryImport(source) {
  if (!/ApiModuleRegistry/.test(source)) return source;
  source = dropUnusedImport(source, 'ComposedApiAssembly');
  if (/use\s+sdkwork_web_bootstrap::\{[^}]*ApiModuleRegistry[^}]*\};/.test(source)) return source;
  if (/use sdkwork_web_bootstrap::\{([^}]*)\};/.test(source)) {
    return source.replace(/use sdkwork_web_bootstrap::\{([^}]*)\};/, (full, names) => {
      const list = names
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      list.push('ApiModuleRegistry');
      list.sort((a, b) => a.localeCompare(b));
      return `use sdkwork_web_bootstrap::{${list.join(', ')}};`;
    });
  }
  if (/use sdkwork_web_bootstrap::ComposedApiAssembly;/.test(source)) {
    return source.replace(
      /use sdkwork_web_bootstrap::ComposedApiAssembly;/,
      'use sdkwork_web_bootstrap::ApiModuleRegistry;',
    );
  }
  return source.replace(
    /^(use [^\n;]*;\n)/m,
    (full) => `${full}use sdkwork_web_bootstrap::ApiModuleRegistry;\n`,
  );
}

// ---------------------------------------------------------------------------
// Pass C — module factory call sites
// ---------------------------------------------------------------------------

function assemblyCrateFor(repoRoot, hostSource) {
  const imports = [...hostSource.matchAll(/use\s+(sdkwork_api_[a-z0-9_]+)::/g)].map(
    (match) => match[1],
  );
  for (const crate of imports) {
    const bootstrapPath = path.join(
      repoRoot,
      'crates',
      crate.replace(/^sdkwork_/, 'sdkwork-').replace(/_/g, '-'),
      'src',
      'bootstrap.rs',
    );
    if (fs.existsSync(bootstrapPath)) return bootstrapPath;
  }
  return null;
}

export function migrateCallSites(source, bootstrapSource) {
  if (!bootstrapSource) return { status: 'no-assembly', source };
  let updated = source;
  let changed = false;
  const swaps = [
    ['assemble_api_router_with_pool', 'web_module_with_pool'],
    ['assemble_api_router_from_env', 'web_module'],
  ];
  for (const [from, to] of swaps) {
    if (!new RegExp(`pub (?:async )?fn ${to}\\b`).test(bootstrapSource)) continue;
    const pattern = new RegExp(`\\b${from}\\s*\\(`, 'g');
    if (!pattern.test(updated)) continue;
    updated = updated.replace(new RegExp(`\\b${from}\\s*\\(`, 'g'), (full) => {
      changed = true;
      return full.startsWith(from) ? `${to}(` : full;
    });
  }
  return changed ? { status: 'swapped', source: updated } : { status: 'unchanged', source };
}

// ---------------------------------------------------------------------------
// Walk the workspace
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', '.git', '.workbuddy', '.sdkwork']);

function collectSources(root) {
  if (!fs.existsSync(root)) return [];
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...collectSources(full));
    else if (entry.isFile() && entry.name.endsWith('.rs')) results.push(full);
  }
  return results;
}

const passes = {
  modules: process.env.WM_PASS_MODULES !== '0',
  hosts: process.env.WM_PASS_HOSTS !== '0',
  callsites: process.env.WM_PASS_CALLSITES !== '0',
};

for (const repo of fs.readdirSync(workspace, { withFileTypes: true })) {
  if (!repo.isDirectory() || SKIP_DIRS.has(repo.name)) continue;
  if (onlyRepos && !onlyRepos.has(repo.name)) continue;
  const repoRoot = path.join(workspace, repo.name);
  const cratesRoot = path.join(repoRoot, 'crates');
  if (!fs.existsSync(cratesRoot)) continue;

  const bootstrapSources = new Map();

  for (const crate of fs.readdirSync(cratesRoot, { withFileTypes: true })) {
    if (!crate.isDirectory()) continue;
    const crateDir = path.join(cratesRoot, crate.name);

    if (passes.modules && crate.name.startsWith('sdkwork-api-') && crate.name.endsWith('-assembly')) {
      const srcDir = path.join(crateDir, 'src');
      const libPath = path.join(srcDir, 'lib.rs');
      if (!fs.existsSync(srcDir) || !fs.existsSync(libPath)) {
        report.skipped.push(`${repo.name}/${crate.name}: no src/lib`);
        continue;
      }
      if (dry) {
        const { names } = planModuleFactories(srcDir);
        if (names.length === 0) report.skipped.push(`${repo.name}/${crate.name}: manual-entrypoint`);
        else report.modules.push(`${repo.name}/${crate.name}: ${names.join('+')}`);
        continue;
      }
      const result = applyModuleFactories(srcDir, libPath);
      if (result.status !== 'added') {
        report.skipped.push(`${repo.name}/${crate.name}: ${result.status}`);
        continue;
      }
      report.modules.push(`${repo.name}/${crate.name}: ${result.names.join('+')}`);
      continue;
    }

    if (passes.hosts && /standalone/.test(crate.name)) {
      for (const filePath of collectSources(path.join(crateDir, 'src'))) {
        const file = path.basename(filePath);
        let source = fs.readFileSync(filePath, 'utf8');
        if (!/ComposedApiAssembly|assemble_/.test(source)) continue;
        let result = migrateStandaloneHost(source);
        if (result.status === 'no-compose' || result.status.startsWith('manual-')) {
          const direct = migrateExpressionComposeHost(source);
          if (direct.status === 'migrated') result = direct;
        }
        if (result.status === 'no-compose' || result.status.startsWith('manual-')) {
          const direct = migrateDirectRouterHost(source, titleForCrate(crate.name));
          if (direct.status === 'migrated') result = direct;
        }
        if (result.status !== 'migrated') {
          report.skipped.push(`${repo.name}/${crate.name}: ${result.status}`);
          continue;
        }
        let updated = ensureRegistryImport(result.source);
        if (passes.callsites) {
          const bootstrapPath = assemblyCrateFor(repoRoot, updated);
          const bootstrapSource =
            bootstrapPath && bootstrapSources.has(bootstrapPath)
              ? bootstrapSources.get(bootstrapPath)
              : bootstrapPath && fs.existsSync(bootstrapPath)
                ? fs.readFileSync(bootstrapPath, 'utf8')
                : null;
          const swapped = migrateCallSites(updated, bootstrapSource);
          if (swapped.status === 'swapped') {
            updated = swapped.source;
            report.callsites.push(`${repo.name}/${crate.name}`);
          }
        }
        if (!dry) fs.writeFileSync(filePath, updated);
        report.hosts.push(`${repo.name}/${crate.name}: ${result.status}`);
      }
    }
  }
}

console.log(`Web module migration (dry=${dry}) for ${workspace}`);
console.log(`  module factories added: ${report.modules.length}`);
console.log(`  standalone hosts migrated: ${report.hosts.length}`);
console.log(`  module factory call sites swapped: ${report.callsites.length}`);
for (const line of report.modules) console.log(`  + ${line}`);
for (const line of report.hosts) console.log(`  ~ ${line}`);
for (const line of report.skipped) console.log(`  . ${line}`);
