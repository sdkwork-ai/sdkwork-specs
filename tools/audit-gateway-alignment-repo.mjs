#!/usr/bin/env node
/**
 * Per-repository gateway dependency-management alignment report.
 * Authority: API_ASSEMBLY_SPEC.md and APPLICATION_GATEWAY_SPEC.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  assemblyCrateDir,
  assemblyPackageName,
  discoverRouteCrates,
  findGatewaySourceFiles,
  readText,
  resolveApplicationCode,
  scanForbiddenGatewayMerges,
} from './api-assembly-lib.mjs';
import { validateApiAssembly } from './validate-api-assembly.mjs';
import { scanDuplicateGatewayApiDepsRepo } from './scan-duplicate-gateway-api-deps.mjs';

function hasPackageScript(root, name) {
  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return false;
  }
  try {
    const pkg = JSON.parse(readText(packagePath).replace(/^\uFEFF/u, ''));
    return Boolean(pkg.scripts?.[name]);
  } catch {
    return false;
  }
}

function hasWorkspaceMember(root, applicationCode) {
  const cargoToml = readText(path.join(root, 'Cargo.toml'));
  if (!cargoToml.includes('[workspace]')) {
    return null;
  }
  return cargoToml.includes(`"${assemblyCrateDir(applicationCode)}"`);
}

function findStandaloneGateways(root, applicationCode) {
  const candidates = [
    path.join(root, 'crates', `sdkwork-api-${applicationCode}-standalone-gateway`),
    path.join(root, 'crates', `sdkwork-${applicationCode}-standalone-gateway`),
    path.join(root, 'services', `sdkwork-${applicationCode}-standalone-gateway`),
  ];
  const found = {};
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      found[path.basename(candidate)] = true;
    }
  }
  return found;
}

function cargoDependsOnAssembly(cargo, applicationCode) {
  const packageName = assemblyPackageName(applicationCode);
  const dependencyKey = packageName.replaceAll('-', '_');
  return cargo.includes(packageName)
    || new RegExp(`^\\s*${dependencyKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*(?:=|\\.)`, 'mu').test(cargo);
}

function bootstrapHasTodoMacro(bootstrapSource) {
  return bootstrapSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .some((line) => /todo!\s*\(/u.test(line));
}

function topologyIngressWarnings(root) {
  const topologyPath = path.join(root, 'specs', 'topology.spec.json');
  if (!fs.existsSync(topologyPath)) {
    return [];
  }
  const warnings = [];
  const text = readText(topologyPath);
  const decomposedPattern =
    /(?:^|[-_])(?:app-api|backend-api|open-api|admin-api|api-server)(?:[-_.]|$)/u;
  for (const line of text.split('\n')) {
    if (!line.includes('application.public-ingress')) {
      continue;
    }
    const processMatch = /"process(?:Id|Name)"\s*:\s*"([^"]+)"/u.exec(line)
      ?? /"binary"\s*:\s*"([^"]+)"/u.exec(line);
    if (processMatch && decomposedPattern.test(processMatch[1])) {
      warnings.push(`topology uses decomposed ingress process: ${processMatch[1]}`);
    }
  }
  return [...new Set(warnings)];
}

function countStubMounts(routeCrates) {
  return routeCrates.filter((crate) => crate.hasDescriptorOnlyGatewayMount).length;
}

export function auditGatewayAlignmentRepo(root) {
  if (path.basename(path.resolve(root)) === 'sdkwork-api-cloud-gateway') {
    return {
      applicationCode: null,
      category: 'platform-cloud-host',
      routeCrates: 0,
      score: 'skip',
      issues: [],
      warnings: [],
    };
  }
  let applicationCode;
  try {
    applicationCode = resolveApplicationCode(root);
  } catch (error) {
    return {
      applicationCode: null,
      category: 'invalid-application-root',
      routeCrates: 0,
      score: 'fail',
      issues: [error.message],
      warnings: [],
    };
  }
  const routeCrates = discoverRouteCrates(root, applicationCode);
  const issues = [];
  const warnings = [];
  const isApplicationRoot = fs.existsSync(path.join(root, 'agent.app.config.json'));
  const hasAssembly = fs.existsSync(path.join(root, assemblyCrateDir(applicationCode)));

  if (routeCrates.length === 0 && !isApplicationRoot && !hasAssembly) {
    return {
      applicationCode,
      category: 'non-application-no-route-crates',
      routeCrates: 0,
      score: 'skip',
      issues,
      warnings,
    };
  }

  const validation = validateApiAssembly(root);
  issues.push(...validation.errors);
  warnings.push(...validation.warnings);

  const assemblyDir = path.join(root, assemblyCrateDir(applicationCode));
  if (!fs.existsSync(assemblyDir)) {
    issues.push(`missing ${assemblyCrateDir(applicationCode)}`);
  }
  if (!fs.existsSync(path.join(assemblyDir, 'assembly-manifest.json'))) {
    issues.push('missing assembly-manifest.json');
  }

  const workspaceMember = hasWorkspaceMember(root, applicationCode);
  if (workspaceMember === false) {
    issues.push('api-assembly not in Cargo workspace members');
  }

  if (fs.existsSync(path.join(root, 'package.json'))) {
    if (!hasPackageScript(root, 'api:assembly:materialize')) {
      warnings.push('missing pnpm api:assembly:materialize');
    }
    if (!hasPackageScript(root, 'api:assembly:validate')) {
      warnings.push('missing pnpm api:assembly:validate');
    }
  }

  const gatewayCrates = findStandaloneGateways(root, applicationCode);
  const canonicalGateway = `sdkwork-api-${applicationCode}-standalone-gateway`;
  if (isApplicationRoot && !gatewayCrates[canonicalGateway]) {
    warnings.push(`missing canonical standalone gateway ${canonicalGateway}`);
  }
  const hasAssemblyDep = Object.keys(gatewayCrates).some((name) => {
    if (!name.includes('gateway')) {
      return false;
    }
    const cargoPath = path.join(
      root,
      fs.existsSync(path.join(root, 'crates', name)) ? 'crates' : 'services',
      name,
      'Cargo.toml',
    );
    const cargo = readText(cargoPath);
    return cargoDependsOnAssembly(cargo, applicationCode);
  });

  if (Object.keys(gatewayCrates).length > 0 && !hasAssemblyDep) {
    warnings.push('standalone gateway crate does not depend on api-assembly');
  }

  const mergeHits = scanForbiddenGatewayMerges(
    findGatewaySourceFiles(root, applicationCode),
    assemblyCrateDir(applicationCode),
  );
  for (const hit of mergeHits) {
    issues.push(`forbidden hand route merge: ${hit}`);
  }

  const stubCount = countStubMounts(routeCrates);
  if (stubCount > 0) {
    warnings.push(`${stubCount} route crates use stub gateway_mount (Router::new())`);
  }

  const bootstrapPath = path.join(assemblyDir, 'src', 'bootstrap.rs');
  if (fs.existsSync(bootstrapPath)) {
    const bootstrap = readText(bootstrapPath);
    if (bootstrapHasTodoMacro(bootstrap)) {
      issues.push('api-assembly bootstrap.rs still contains todo!()');
    }
  } else if (routeCrates.some((crate) => crate.hasGatewayMount)) {
    const allStub = stubCount === routeCrates.length;
    if (allStub) {
      warnings.push('no bootstrap.rs; all route mounts are stubs');
    }
  }

  warnings.push(...topologyIngressWarnings(root));

  const duplicateReport = scanDuplicateGatewayApiDepsRepo(root);
  issues.push(...duplicateReport.issues);
  warnings.push(...duplicateReport.warnings);

  const uniqueIssues = [...new Set(issues)];
  const uniqueWarnings = [...new Set(warnings)];
  const score = uniqueIssues.length === 0
    ? (uniqueWarnings.length === 0 ? 'perfect' : 'warn')
    : 'fail';

  return {
    applicationCode,
    category: routeCrates.length > 0 ? 'route-crates' : 'application-api-mode-none',
    routeCrates: routeCrates.length,
    gatewayCrates: Object.keys(gatewayCrates),
    score,
    issues: uniqueIssues,
    warnings: uniqueWarnings,
  };
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      root: { type: 'string' },
      strict: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log('Usage: node tools/audit-gateway-alignment-repo.mjs [--root <application>] [--strict]');
    return;
  }
  if (values.root && positionals.length > 0) {
    console.error('Use either --root <application> or one legacy positional root, not both');
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(
    values.root
    || positionals[0]
    || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
  );
  const report = auditGatewayAlignmentRepo(root);
  console.log(JSON.stringify(report, null, 2));
  if (report.score === 'fail' || (values.strict && report.score === 'warn')) {
    process.exit(1);
  }
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  main();
}
