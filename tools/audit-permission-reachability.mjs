#!/usr/bin/env node
/**
 * Permission reachability audit (AUTHORIZATION_STATE_SPEC 3.4, 3.5, 3.8).
 *
 * Answers one question per permission code: which non-break-glass role can
 * authorize it? A code is reachable when a standard-role grant pattern
 * (role_catalog.rs and module roleGrantExtensions) or an assignable domain role
 * matches it. `platform_super_admin` `*` is reported separately because it is
 * break-glass and never the answer for "can a normal admin operate this".
 *
 * Route manifests across the space are scanned so the report distinguishes
 * "catalogued but unused" from "enforced but unreachable".
 *
 * Usage: node audit-permission-reachability.mjs --workspace <D:\sdkwork-space>
 *        [--json] [--uncovered-only]
 * Exit codes: 0 always (report), 2 unusable input.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: '' },
    json: { type: 'boolean', default: false },
    'uncovered-only': { type: 'boolean', default: false },
    'fail-on-uncovered-enforced': { type: 'boolean', default: false },
  },
});

const specsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(values.workspace || path.join(specsRoot, '..'));
const iamRoot = path.join(workspace, 'sdkwork-iam');
const modulesRoot = path.join(iamRoot, 'iam/modules');

if (!fs.existsSync(modulesRoot)) {
  process.stderr.write(`modules root not found: ${modulesRoot}\n`);
  process.exit(2);
}

function permissionMatches(granted, required) {
  const grant = String(granted ?? '').trim().toLowerCase();
  const need = String(required ?? '').trim().toLowerCase();
  if (!grant || !need) return false;
  if (grant === '*' || grant === need) return true;
  if (grant.endsWith('.*')) {
    const prefix = grant.slice(0, -2).replace(/\.+$/, '');
    return need === prefix || need.startsWith(`${prefix}.`);
  }
  if (grant.startsWith('*.')) {
    const action = grant.slice(2).replace(/^\.+/, '');
    return need.endsWith(action) && need.split('.').at(-1) === action;
  }
  return false;
}

function parseKernelRoleGrants() {
  const source = fs.readFileSync(
    path.join(iamRoot, 'crates/sdkwork-iam-bootstrap/src/role_catalog.rs'),
    'utf8',
  );
  const roleConstMap = {
    APP_USER_ROLE_CODE: 'app_user',
    ORG_ADMIN_ROLE_CODE: 'org_admin',
    ORG_ASSISTANT_ROLE_CODE: 'org_assistant',
    ORG_AUDITOR_ROLE_CODE: 'org_auditor',
    ORG_FINANCE_ROLE_CODE: 'org_finance',
    ORG_OPERATIONS_ROLE_CODE: 'org_operations',
    PLATFORM_SYSTEM_ADMIN_ROLE_CODE: 'platform_system_admin',
    PLATFORM_SUPER_ADMIN_ROLE_CODE: 'platform_super_admin',
  };
  const grants = new Map();
  const blockPattern = /StandardRoleGrant\s*\{\s*role_code:\s*([A-Z_]+),\s*patterns:\s*&\[([\s\S]*?)\],\s*\}/g;
  for (const match of source.matchAll(blockPattern)) {
    const code = roleConstMap[match[1]];
    if (!code) continue;
    const patterns = [...match[2].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    if (!grants.has(code)) grants.set(code, new Set());
    for (const pattern of patterns) grants.get(code).add(pattern);
  }
  return grants;
}

const roleGrants = parseKernelRoleGrants();
const permissions = new Map();
const modules = new Map();

for (const entry of fs.readdirSync(modulesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(modulesRoot, entry.name, 'iam.module.manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  modules.set(manifest.moduleId, {
    moduleId: manifest.moduleId,
    domain: manifest.domain,
    permissions: (manifest.permissions?.catalog ?? []).map((item) => item.code),
    grantRoles: [...roleGrants.keys()],
    domainRoles: (manifest.roles?.domainStandardRoles ?? []).map((role) => ({
      code: role.code,
      assignable: role.assignable !== false,
      grantableBy: role.grantableBy,
      patterns: role.permissionPatterns ?? [],
    })),
  });
  for (const permission of manifest.permissions?.catalog ?? []) {
    permissions.set(permission.code, manifest.moduleId);
  }
  for (const grant of manifest.roles?.roleGrantExtensions ?? []) {
    if (!roleGrants.has(grant.roleCode)) roleGrants.set(grant.roleCode, new Set());
    for (const pattern of grant.patterns ?? []) roleGrants.get(grant.roleCode).add(pattern);
  }
}

function coveringRoles(code) {
  const covering = [];
  for (const [role, patterns] of roleGrants) {
    if (role === 'platform_super_admin') continue;
    if ([...patterns].some((pattern) => permissionMatches(pattern, code))) covering.push(role);
  }
  for (const [moduleId, module] of modules) {
    for (const role of module.domainRoles) {
      if (!role.assignable) continue;
      if (role.patterns.some((pattern) => permissionMatches(pattern, code))) {
        covering.push(`${moduleId}:${role.code}`);
      }
    }
  }
  return [...new Set(covering)];
}

function routeManifests() {
  const found = [];
  for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) continue;
    const sdks = path.join(workspace, entry.name, 'sdks/_route-manifests');
    if (!fs.existsSync(sdks)) continue;
    const walk = (dir) => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, item.name);
        if (item.isDirectory()) walk(absolute);
        else if (item.name.endsWith('.route-manifest.json')) found.push(absolute);
      }
    };
    walk(sdks);
  }
  return found;
}

function routePermissions() {
  const required = new Map();
  for (const manifestPath of routeManifests()) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    const normalized = manifestPath.replace(/\\/g, '/');
    const surface = normalized.includes('/backend-api/')
      ? 'backend'
      : normalized.includes('/open-api/')
        ? 'open'
        : 'app';
    for (const route of parsed.routes ?? []) {
      const permission = route.auth?.permission;
      if (!permission || permission === 'authenticated') continue;
      if (!required.has(permission)) required.set(permission, new Set());
      const operation = (route.operationId ?? `${route.method} ${route.path}`).toString();
      required.get(permission).add(`${surface}:${operation}`);
    }
  }
  return required;
}

const routes = routePermissions();

/**
 * Permission-like string literals that appear in non-test Rust sources. This is
 * evidence that a code is referenced by a handler-side guard or constant even
 * when no route manifest names it; it is not proof of enforcement.
 */
function sourcePermissionLiterals() {
  const literals = new Map();
  const codePattern = /"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)"/g;
  const walk = (dir, repo) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'target' || entry.name === 'tests' || entry.name === 'generated') continue;
        walk(absolute, repo);
      } else if (entry.isFile() && entry.name.endsWith('.rs')) {
        const text = fs.readFileSync(absolute, 'utf8');
        for (const match of text.matchAll(codePattern)) {
          if (!literals.has(match[1])) literals.set(match[1], new Set());
          literals.get(match[1]).add(repo);
        }
      }
    }
  };
  for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) continue;
    for (const crateDir of ['crates', 'services']) {
      walk(path.join(workspace, entry.name, crateDir), entry.name);
    }
  }
  return literals;
}

const sourceLiterals = sourcePermissionLiterals();

/**
 * Permissions enforced by hand-written Rust route manifests and handler guards
 * (`with_required_permission`, `authenticated_actor`, `require_permission`).
 * Machine-readable route manifests are authoritative, but many applications
 * still build their route tables in Rust.
 */
function rustEnforcedPermissions() {
  const enforced = new Map();
  const patterns = [
    /\.with_required_permission\(\s*"([a-z][a-z0-9_]*\.[a-z0-9_.]+)"\s*\)/g,
    /authenticated_actor\(\s*&[^,]+,\s*"([a-z][a-z0-9_]*\.[a-z0-9_.]+)"\s*\)/g,
    /require_permission\(\s*&?[A-Za-z0-9_.]+,\s*"([a-z][a-z0-9_]*\.[a-z0-9_.]+)"\s*\)/g,
    /required_permission\s*[:=]\s*Some\(\s*"([a-z][a-z0-9_]*\.[a-z0-9_.]+)"\s*\)/g,
  ];
  const walk = (dir, repo) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'target' || entry.name === 'tests' || entry.name === 'generated') continue;
        walk(absolute, repo);
      } else if (entry.isFile() && entry.name.endsWith('.rs')) {
        const source = fs.readFileSync(absolute, 'utf8').split(/(?:^|\n)#\[cfg\(test\)\]/)[0];
        for (const pattern of patterns) {
          for (const match of source.matchAll(pattern)) {
            if (!enforced.has(match[1])) enforced.set(match[1], new Set());
            enforced
              .get(match[1])
              .add(`${repo}:${path.basename(absolute)}`);
          }
        }
      }
    }
  };
  for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('sdkwork-')) continue;
    for (const crateDir of ['crates', 'services']) {
      walk(path.join(workspace, entry.name, crateDir), entry.name);
    }
  }
  return enforced;
}

const rustEnforced = rustEnforcedPermissions();

const report = [];
for (const [code, moduleId] of [...permissions.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  // `*` is the break-glass grant itself, not a capability.
  if (code === '*') continue;
  const covering = coveringRoles(code);
  const operations = [...(routes.get(code) ?? [])];
  const rustGuards = [...(rustEnforced.get(code) ?? [])];
  const enforced = operations.length > 0 || rustGuards.length > 0;
  if (values['uncovered-only'] && covering.length > 0) continue;
  report.push({
    code,
    moduleId,
    covering,
    enforcedBy: operations.slice(0, 4),
    rustGuards: rustGuards.slice(0, 4),
    enforced,
    referencedBy: [...(sourceLiterals.get(code) ?? [])].slice(0, 4),
  });
}

const uncovered = report.filter((item) => item.covering.length === 0);
const uncoveredEnforced = uncovered.filter((item) => item.enforced);
const uncoveredReferenced = uncovered.filter(
  (item) => !item.enforced && item.referencedBy.length > 0,
);
const modulesWithoutReachableGrants = [...modules.values()]
  .filter((module) => module.permissions.length > 0)
  .filter((module) =>
    module.permissions.every((code) => coveringRoles(code).length === 0),
  )
  .map((module) => module.moduleId);

if (values.json) {
  process.stdout.write(
    `${JSON.stringify({ total: report.length, uncovered: uncovered.length, uncoveredEnforced, modulesWithoutReachableGrants, report }, null, 2)}\n`,
  );
} else {
  process.stdout.write(
    `permissions=${report.length} uncovered=${uncovered.length} uncovered-and-enforced=${uncoveredEnforced.length} uncovered-and-referenced=${uncoveredReferenced.length}\n`,
  );
  for (const item of uncovered) {
    const evidence = item.enforced
      ? ` enforced by ${item.enforcedBy.join(', ')}`
      : item.referencedBy.length > 0
        ? ` referenced in ${item.referencedBy.join(', ')}`
        : '';
    process.stdout.write(`UNCOVERED ${item.code} (${item.moduleId})${evidence}\n`);
  }
  process.stdout.write(
    `modules with no reachable non-break-glass grant: ${modulesWithoutReachableGrants.join(', ')}\n`,
  );
}
if (values['fail-on-uncovered-enforced'] && uncoveredEnforced.length > 0) {
  process.stderr.write(
    `audit-permission-reachability: ${uncoveredEnforced.length} enforced permission(s) have no non-break-glass grant\n`,
  );
  process.exit(1);
}
process.exit(0);
