#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    baseline: '',
    moduleId: '',
    owner: '',
    tablePrefix: '',
    prefixes: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      args.root = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (token === '--baseline') {
      args.baseline = argv[index + 1] ?? '';
      index += 1;
    } else if (token === '--module-id') {
      args.moduleId = argv[index + 1] ?? '';
      index += 1;
    } else if (token === '--owner') {
      args.owner = argv[index + 1] ?? '';
      index += 1;
    } else if (token === '--table-prefix') {
      args.tablePrefix = argv[index + 1] ?? '';
      index += 1;
    } else if (token === '--prefixes') {
      args.prefixes = (argv[index + 1] ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
    }
  }
  return args;
}

function collectTableNames(sql) {
  const seen = new Set();
  const tableNames = [];
  for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? ([a-z0-9_]+)/gi)) {
    const name = match[1];
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    tableNames.push(name);
  }
  return tableNames;
}

function collectPrefixes(tableNames) {
  const prefixes = new Set();
  for (const tableName of tableNames) {
    const match = tableName.match(/^([a-z]+_)/);
    if (match) {
      prefixes.add(match[1]);
    }
  }
  return [...prefixes].sort();
}

/**
 * Top-level keys the generator owns and rewrites on every run.
 */
const MANAGED_SCHEMA_KEYS = new Set([
  'schema_version', 'kind', 'database_role', 'module_id', 'contract_version',
  'owner_team', 'compliance_level', 'engines', 'table_prefix', 'table_prefixes', 'tables',
]);

/**
 * Carry forward every top-level key of the existing contract header that the
 * generator does not own — scalars *and* multi-line blocks, together with their
 * indented children. Modules author real policy here (`id_strategy`,
 * `amount_strategy`, `account_taxonomy`, `forbidden_asset_codes`, `subject_columns`,
 * `compliance`, `write_owner`, `ddl_authority`). Rebuilding the header from the
 * generator's fixed list deletes all of it, which makes
 * `db:materialize:contract` destructive for every module that carries such content
 * and can never be shown idempotent.
 */
function readUnmanagedHeaderLines(text) {
  const tablesOffset = text.search(/^tables:\s*$/m);
  const header = tablesOffset < 0 ? text : text.slice(0, tablesOffset);
  const lines = header.split(/\r?\n/u);
  const isChild = (line) => /^\s+\S/u.test(line);
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const key = /^([a-z_][a-z0-9_]*):/u.exec(lines[index])?.[1];
    if (!key) {
      continue;
    }
    const ownsKey = MANAGED_SCHEMA_KEYS.has(key);
    if (!ownsKey) {
      kept.push(lines[index]);
    }
    while (index + 1 < lines.length && isChild(lines[index + 1])) {
      index += 1;
      if (!ownsKey) {
        kept.push(lines[index]);
      }
    }
  }
  return kept;
}

/**
 * Registry artifacts carry authored governance metadata that this generator does
 * not model: `capability`, `description`, `table_examples`, `forbidden_aliases`,
 * `status`, `valid_from`, and per-table `profile` / `write_owner` /
 * `system_of_record`. Those fields are REQUIRED by the fleet validators (see
 * `sdkwork-agents/tools/database/materialize-agents-database-contract.mjs`), so a
 * regenerate MUST merge into the existing entry rather than replace it — replacing
 * silently destroys the registry contract and makes the command non-idempotent.
 *
 * Key order is preserved so a regenerate produces no cosmetic diff. `domain` is
 * authored when present (it is a taxonomy dimension such as `intelligence` or
 * `game`, not the module id) and only falls back to the module id for a prefix that
 * has no entry yet.
 */
function mergeRegistryEntry(existing, generated) {
  if (!existing) {
    return { ...generated };
  }
  const merged = {};
  for (const [key, value] of Object.entries(existing)) {
    merged[key] = Object.hasOwn(generated, key) ? generated[key] : value;
  }
  for (const [key, value] of Object.entries(generated)) {
    if (!Object.hasOwn(merged, key)) {
      merged[key] = value;
    }
  }
  return merged;
}

function readExistingJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readExistingSchema(schemaPath) {
  if (!fs.existsSync(schemaPath)) {
    return { contractVersion: '', complianceLevel: '', tableBlocks: new Map(), unmanagedKeys: [] };
  }

  const text = fs.readFileSync(schemaPath, 'utf8');
  const contractVersion = text.match(/^contract_version:\s*(\S+)/m)?.[1] ?? '';
  // A generated `compliance_level: L2` must never overwrite an authored higher level:
  // sdkwork-account, sdkwork-drama and sdkwork-settings declare L3, and a regenerate
  // would silently downgrade the declaration.
  const complianceLevel = text.match(/^compliance_level:\s*(\S+)/m)?.[1] ?? '';
  const unmanagedKeys = readUnmanagedHeaderLines(text);
  const tableBlocks = new Map();
  const tablesOffset = text.search(/^tables:\s*$/m);
  if (tablesOffset < 0) {
    return { contractVersion, complianceLevel, tableBlocks, unmanagedKeys };
  }

  const tablesText = text.slice(tablesOffset).replace(/^tables:\s*\r?\n/, '');
  const matches = [...tablesText.matchAll(/^  - name:\s*([a-z0-9_]+)\s*$/gm)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index;
    const end = matches[index + 1]?.index ?? tablesText.length;
    tableBlocks.set(match[1], tablesText.slice(start, end).trimEnd());
  }
  return { contractVersion, complianceLevel, tableBlocks, unmanagedKeys };
}

function resolveContractVersion(manifest, existingSchema) {
  const manifestVersion = manifest.contractVersion ?? '';
  const schemaVersion = existingSchema.contractVersion;
  if (manifestVersion && schemaVersion && manifestVersion !== schemaVersion) {
    throw new Error(
      `database contract version mismatch: manifest=${manifestVersion}, schema=${schemaVersion}`,
    );
  }
  return manifestVersion || schemaVersion || '1.0.0';
}

function renderPrefixContract(prefixes, fallbackPrefix) {
  const resolvedPrefixes = prefixes.length > 0 ? prefixes : [fallbackPrefix].filter(Boolean);
  if (resolvedPrefixes.length <= 1) {
    return [`table_prefix: ${resolvedPrefixes[0] ?? ''}`];
  }
  return ['table_prefixes:', ...resolvedPrefixes.map((prefix) => `  - ${prefix}`)];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseline || !args.moduleId || !args.owner) {
    throw new Error('usage: --root <dir> --baseline <relative-postgres-sql> --module-id <id> --owner <team> [--table-prefix p_] [--prefixes p1_,p2_]');
  }

  const baselinePath = path.join(args.root, args.baseline);
  const sql = fs.readFileSync(baselinePath, 'utf8');
  const tableNames = collectTableNames(sql);
  const prefixes =
    args.prefixes.length > 0
      ? args.prefixes
      : args.tablePrefix
      ? [args.tablePrefix]
      : collectPrefixes(tableNames);

  const schemaPath = path.join(args.root, 'database/contract/schema.yaml');
  const manifestPath = path.join(args.root, 'database/database.manifest.json');
  const existingSchema = readExistingSchema(schemaPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.databaseRole !== 'authoritative-server') {
    throw new Error('contract materialization requires databaseRole=authoritative-server');
  }
  if (JSON.stringify(manifest.engines) !== JSON.stringify(['postgres']) || manifest.defaultEngine !== 'postgres') {
    throw new Error('authoritative contract materialization requires engines=[postgres] and defaultEngine=postgres');
  }
  const contractVersion = resolveContractVersion(manifest, existingSchema);

  const existingTableRegistry = readExistingJson(
    path.join(args.root, 'database/contract/table-registry.json'),
  );
  const existingPrefixRegistry = readExistingJson(
    path.join(args.root, 'database/contract/prefix-registry.json'),
  );
  const existingTableByName = new Map(
    (existingTableRegistry?.tables ?? []).map((entry) => [entry.table_name, entry]),
  );
  const existingPrefixByName = new Map(
    (existingPrefixRegistry?.prefixes ?? []).map((entry) => [entry.prefix, entry]),
  );

  /**
   * Keep the authored order for entries the artifact already declares and append
   * newly discovered ones. Re-sorting by baseline discovery order would rewrite the
   * whole list on every run, producing a large diff for unchanged content and
   * hiding real drift in the noise. `schema.yaml` and `table-registry.json` are
   * ordered independently — each keeps its own authored sequence.
   */
  const orderedTableNames = [
    ...existingSchema.tableBlocks.keys(),
    ...tableNames.filter((name) => !existingSchema.tableBlocks.has(name)),
  ];
  const registryTableNames = [
    ...(existingTableRegistry?.tables ?? []).map((entry) => entry.table_name),
    ...tableNames.filter(
      (name) => !(existingTableRegistry?.tables ?? []).some((entry) => entry.table_name === name),
    ),
  ];

  const tableRegistry = {
    schemaVersion: 1,
    kind: 'sdkwork.database.table-registry',
    tables: registryTableNames.map((table_name) => {
      const merged = mergeRegistryEntry(existingTableByName.get(table_name), {
        table_name,
        owner: args.owner,
      });
      // Authored values win; the defaults only seed an entry that does not exist
      // yet. Forcing them would overwrite a declared level or lifecycle.
      merged.compliance_level ??= existingSchema.complianceLevel || 'L2';
      merged.lifecycle_status ??= 'active';
      return merged;
    }),
  };

  const prefixRegistry = {
    schemaVersion: 1,
    kind: 'sdkwork.database.prefix-registry',
    prefixes: prefixes.map((prefix) => {
      const merged = mergeRegistryEntry(existingPrefixByName.get(prefix), {
        prefix,
        owner: args.owner,
      });
      // `domain` is a taxonomy dimension when authored (`intelligence`, `game`);
      // the module id is only the fallback for a prefix with no entry yet.
      if (merged.domain === undefined) {
        merged.domain = args.moduleId;
      }
      return merged;
    }),
  };

  const schemaYaml = [
    'schema_version: 1',
    'kind: sdkwork.database.schema',
    'database_role: authoritative-server',
    `module_id: ${args.moduleId}`,
    `contract_version: ${contractVersion}`,
    `owner_team: ${args.owner}`,
    `compliance_level: ${existingSchema.complianceLevel || 'L2'}`,
    'engines:',
    '  - postgres',
    ...renderPrefixContract(prefixes, args.tablePrefix),
    ...existingSchema.unmanagedKeys,
    'tables:',
    ...orderedTableNames.map((name) =>
      existingSchema.tableBlocks.get(name)
      ?? `  - name: ${name}\n    lifecycle_status: active\n    owner: ${args.owner}`,
    ),
    '',
  ].join('\n');

  fs.writeFileSync(
    path.join(args.root, 'database/contract/table-registry.json'),
    `${JSON.stringify(tableRegistry, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(args.root, 'database/contract/prefix-registry.json'),
    `${JSON.stringify(prefixRegistry, null, 2)}\n`,
  );
  fs.writeFileSync(schemaPath, schemaYaml);

  manifest.contractVersion = contractVersion;
  manifest.schemaVersion = 2;
  manifest.databaseRole = 'authoritative-server';
  manifest.engines = ['postgres'];
  manifest.defaultEngine = 'postgres';
  manifest.lifecycle ??= {};
  manifest.lifecycle.autoMigrate ??= false;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  process.stdout.write(
    `materialized ${tableNames.length} tables (${prefixes.length} prefixes) into ${args.moduleId} database contract\n`,
  );
}

main();
