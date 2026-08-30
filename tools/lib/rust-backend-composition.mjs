import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './app-composition.mjs';

const SKIP_DIRS = new Set(['.git', '.tmp', 'target', 'node_modules', 'dist', 'build']);

const HTTP_FRAMEWORK_CRATES = new Set([
  'axum',
  'actix-web',
  'poem',
  'rocket',
  'hyper',
  'tower-http',
  'sdkwork-web-framework',
]);

function listCargoTomls(repoRoot) {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.name === 'Cargo.toml') files.push(full);
    }
  };
  walk(repoRoot);
  return files.sort((a, b) => a.localeCompare(b));
}

function stripInlineComment(line) {
  const quoteCount = (line.match(/"/gu) ?? []).length;
  if (quoteCount % 2 !== 0) return line;
  return line.replace(/\s+#.*$/u, '');
}

function parseCargoManifest(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  let section = null;
  let packageName = null;
  const dependencies = [];

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section === 'package') {
      const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/u);
      if (nameMatch) packageName = nameMatch[1];
      continue;
    }
    if (!['dependencies', 'dev-dependencies', 'build-dependencies'].includes(section)) continue;
    const depMatch = line.match(/^([A-Za-z0-9_-]+)(?:\.workspace)?\s*=\s*(.+)$/u);
    if (!depMatch) continue;
    dependencies.push({
      name: depMatch[1].replaceAll('_', '-'),
      rawName: depMatch[1],
      spec: depMatch[2],
    });
  }

  return { filePath, packageName, dependencies, text };
}

function crateRole(packageName) {
  if (!packageName) return 'unknown';
  if (/^sdkwork-routes-.+-(?:open|app|backend)-api$/u.test(packageName)) return 'route';
  if (/-repository-sqlx$/u.test(packageName)) return 'repository-sqlx';
  if (/-service$/u.test(packageName)) return 'service';
  if (/-standalone-gateway$/u.test(packageName) || /-cloud-gateway$/u.test(packageName) || packageName === 'sdkwork-api-cloud-gateway') return 'gateway';
  if (/-api-server$/u.test(packageName)) return 'api-server';
  if (/-service-host$/u.test(packageName)) return 'service-host';
  return 'rust-crate';
}

function routeCrateParts(packageName) {
  const match = packageName?.match(/^sdkwork-routes-(.+)-(open|app|backend)-api$/u);
  if (!match) return null;
  return {
    capability: match[1],
    surface: `${match[2]}-api`,
    sdkToken: `${match[2]}-sdk`,
  };
}

function isSameSurfaceGeneratedSdkDependency(routePackageName, depName) {
  const parts = routeCrateParts(routePackageName);
  if (!parts) return false;
  if (!depName.includes(parts.sdkToken)) return false;
  return depName === `sdkwork-${parts.capability}-${parts.sdkToken}`
    || depName.includes(`-${parts.capability}-${parts.sdkToken}`)
    || depName.startsWith(`${parts.capability}-${parts.sdkToken}`);
}

function isDirectSiblingSdkworkPath(dep) {
  if (!dep.name.startsWith('sdkwork-')) return false;
  if (!/\bpath\s*=/u.test(dep.spec)) return false;
  return /\.\.(?:\/|\\)sdkwork-/u.test(dep.spec);
}

export function validateRustBackendComposition(repoRoot) {
  const issues = [];
  const rootCargoPath = path.resolve(path.join(repoRoot, 'Cargo.toml'));

  for (const cargoPath of listCargoTomls(repoRoot)) {
    const manifest = parseCargoManifest(cargoPath);
    const rel = toPosix(path.relative(repoRoot, cargoPath));
    const role = crateRole(manifest.packageName);

    if (
      /^sdkwork-[a-z0-9-]+-cloud-gateway$/u.test(manifest.packageName ?? '')
      && manifest.packageName !== 'sdkwork-api-cloud-gateway'
    ) {
      issues.push(`${rel}: generic application cloud gateway ${manifest.packageName} is retired; host the application API assembly from sdkwork-api-cloud-gateway or use an ADR-governed responsibility-specific edge ingress`);
    }

    if (role === 'service') {
      for (const dep of manifest.dependencies) {
        if (/-repository-sqlx$/u.test(dep.name)) {
          issues.push(`${rel}: service crate must not depend on concrete repository crate ${dep.name}; depend on service ports and inject repository implementations at runtime`);
        }
      }
    }

    if (role === 'route') {
      for (const dep of manifest.dependencies) {
        if (isSameSurfaceGeneratedSdkDependency(manifest.packageName, dep.name)) {
          issues.push(`${rel}: route crate must not depend on generated SDK for the same surface (${dep.name}); route crates implement the API and call service ports`);
        }
      }
    }

    if (role === 'repository-sqlx') {
      for (const dep of manifest.dependencies) {
        if (HTTP_FRAMEWORK_CRATES.has(dep.name)) {
          issues.push(`${rel}: repository crate must not depend on HTTP framework crate ${dep.name}; HTTP context belongs in route/service layers`);
        }
      }
    }

    if (path.resolve(cargoPath) !== rootCargoPath) {
      for (const dep of manifest.dependencies) {
        if (isDirectSiblingSdkworkPath(dep)) {
          issues.push(`${rel}: member Cargo dependency ${dep.name} must use workspace = true; declare sibling SDKWork path once in root Cargo.toml [workspace.dependencies]`);
        }
      }
    }
  }

  return issues;
}

export function parseRustCargoManifest(filePath) {
  return parseCargoManifest(filePath);
}
