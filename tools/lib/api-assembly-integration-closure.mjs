import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'build', 'dist', 'node_modules', 'target']);
const ASSEMBLY_DEPENDENCY = /^sdkwork-api-[a-z0-9-]+-assembly$/u;
const FORBIDDEN_GATEWAY_DEPENDENCY = [
  /^sdkwork-routes-/u,
  /^sdkwork-.+-database-host$/u,
  /^sdkwork-.+-repository(?:-|$)/u,
  /^sdkwork-.+-service$/u,
  /^sdkwork-.+-service-host$/u,
  /^sdkwork-.+-provider-.+-adapter$/u,
];
const FORBIDDEN_GATEWAY_SOURCE_CALL = [
  /sdkwork_[a-z0-9_]+_database_host::/gu,
  /sdkwork_[a-z0-9_]+_service_host::/gu,
  /sdkwork_[a-z0-9_]+_repository_[a-z0-9_]*::/gu,
  /sdkwork_routes_[a-z0-9_]+::/gu,
  /sdkwork_[a-z0-9_]+_provider_[a-z0-9_]+_adapter::/gu,
];
const FORBIDDEN_ASSEMBLY_HOSTING_CALL = [
  /\bservice_router\s*\(/u,
];

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function readJson(filePath) {
  return JSON.parse(readText(filePath).replace(/^\uFEFF/u, ''));
}

function listCargoManifests(root) {
  const manifests = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(target);
      } else if (entry.name === 'Cargo.toml') {
        manifests.push(target);
      }
    }
  };
  visit(root);
  return manifests;
}

function packageName(cargo) {
  const packageSection = /\[package\]([\s\S]*?)(?:\n\[|$)/u.exec(cargo)?.[1] ?? '';
  return /^\s*name\s*=\s*"([^"]+)"/mu.exec(packageSection)?.[1] ?? null;
}

function runtimeDependencies(cargo) {
  const dependencies = new Set();
  let section = '';
  for (const rawLine of cargo.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, '').trim();
    const header = /^\[([^\]]+)\]$/u.exec(line)?.[1];
    if (header) {
      section = header;
      continue;
    }
    if (section !== 'dependencies' && !/^target\..+\.dependencies$/u.test(section)) continue;
    const name = /^([A-Za-z0-9_-]+)(?:\.workspace)?\s*=/u.exec(line)?.[1];
    if (name) dependencies.add(name.replaceAll('_', '-'));
  }
  return dependencies;
}

export function parseCargoFeatures(cargo) {
  const features = new Map();
  const section = /\[features\]([\s\S]*?)(?:\n\[[^\]]+\]|$)/u.exec(cargo)?.[1] ?? '';
  const lines = section.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const start = /^\s*([A-Za-z0-9_-]+)\s*=\s*\[(.*)$/u.exec(lines[index]);
    if (!start) continue;
    let body = start[2];
    while (!body.includes(']') && index + 1 < lines.length) {
      index += 1;
      body += `\n${lines[index]}`;
    }
    const close = body.indexOf(']');
    if (close >= 0) body = body.slice(0, close);
    const values = [...body.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
    features.set(start[1], values);
  }
  return features;
}

function isGatewayPackage(name) {
  return name === 'sdkwork-api-cloud-gateway'
    || /^sdkwork-api-[a-z0-9-]+-standalone-gateway$/u.test(name ?? '');
}

function gatewaySources(cargoPath) {
  const sourceRoot = path.join(path.dirname(cargoPath), 'src');
  const sources = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith('.rs')) sources.push(readText(target));
    }
  };
  visit(sourceRoot);
  return sources.join('\n');
}

function singleArgumentCallOffsets(source, name) {
  const offsets = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const offset = source.indexOf(name, searchFrom);
    if (offset < 0) break;
    searchFrom = offset + name.length;
    const prefix = source.slice(Math.max(0, offset - 48), offset);
    if (/\bfn\s+$/u.test(prefix)) continue;
    let cursor = offset + name.length;
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
    if (source[cursor] !== '(') continue;
    let depth = 1;
    let argumentsCount = 1;
    let hasContent = false;
    let quote = '';
    for (cursor += 1; cursor < source.length && depth > 0; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (character === '\\') cursor += 1;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        hasContent = true;
      } else if (character === '(' || character === '[' || character === '{') {
        depth += 1;
        hasContent = true;
      } else if (character === ')' || character === ']' || character === '}') {
        depth -= 1;
      } else if (character === ',' && depth === 1) {
        argumentsCount += 1;
      } else if (!/\s/u.test(character)) {
        hasContent = true;
      }
    }
    if (hasContent && argumentsCount === 1) offsets.push(offset);
  }
  return offsets;
}

function validateAssemblyHostingBoundary(root, cargoPath) {
  const issues = [];
  const sourceRoot = path.join(path.dirname(cargoPath), 'src');
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(target);
        continue;
      }
      if (!entry.name.endsWith('.rs')) continue;
      const source = readText(target);
      const lines = source.split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (/\bfn\s+(?:service_router|wrap_router_with_web_framework(?:_from_env)?)\s*\(/u.test(line)) {
          continue;
        }
        if (FORBIDDEN_ASSEMBLY_HOSTING_CALL.some((pattern) => pattern.test(line))) {
          const relative = path.relative(root, target).replaceAll('\\', '/');
          issues.push(`${relative}:${index + 1}: owner assembly must return host-neutral business routes and must not install Web Framework or process service-router infrastructure`);
        }
      }
      for (const functionName of [
        'wrap_router_with_web_framework',
        'wrap_router_with_web_framework_from_env',
      ]) {
        for (const offset of singleArgumentCallOffsets(source, functionName)) {
          const lineNumber = source.slice(0, offset).split(/\r?\n/u).length;
          const relative = path.relative(root, target).replaceAll('\\', '/');
          issues.push(`${relative}:${lineNumber}: owner assembly must return host-neutral business routes and must not install Web Framework or process service-router infrastructure`);
        }
      }
    }
  };
  visit(sourceRoot);
  return issues;
}

function componentIntegrations(component) {
  const rows = Array.isArray(component?.dependencies)
    ? component.dependencies
    : component?.contracts?.dependencyApiSurfaces ?? [];
  const integrations = new Map();
  const issues = [];
  for (const row of rows) {
    const feature = row?.cargoFeature;
    const dependency = row?.cargoDependency;
    const executableExport = row?.executableExport ?? row?.embeddedExecutableExport;
    if (!feature || !ASSEMBLY_DEPENDENCY.test(dependency ?? '')) continue;
    if (!executableExport) {
      issues.push(`${feature}: owner assembly ${dependency} requires executableExport`);
      continue;
    }
    const current = integrations.get(feature);
    if (current && (
      current.cargoDependency !== dependency
      || current.executableExport !== executableExport
    )) {
      issues.push(`${feature}: component dependency surfaces disagree on one owner assembly integration point`);
      continue;
    }
    integrations.set(feature, {
      workspace: row?.workspace,
      cargoDependency: dependency,
      executableExport,
    });
  }
  return { integrations, issues };
}

function validateCloudGatewayContract(root, manifest, component) {
  const issues = [];
  const cargo = manifest.cargo;
  const features = parseCargoFeatures(cargo);
  const source = gatewaySources(manifest.path);
  const { integrations, issues: componentIssues } = componentIntegrations(component);
  issues.push(...componentIssues);

  const integrationPoint = component?.gatewayIntegration?.assemblyIntegrationPoint;
  if (!integrationPoint || integrationPoint.databaseLifecycleOwner !== 'sdkwork-api-<application-code>-assembly') {
    issues.push('specs/component.spec.json: platform cloud gateway must declare gatewayIntegration.assemblyIntegrationPoint with owner assembly database lifecycle');
  }

  for (const pattern of FORBIDDEN_GATEWAY_SOURCE_CALL) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) {
      issues.push(`gateway source calls owner implementation ${match[0]} directly; use the owner API assembly entrypoint`);
    }
  }

  for (const [feature, integration] of integrations) {
    const values = features.get(feature);
    if (!values) {
      issues.push(`${feature}: component contract references a missing Cargo feature`);
      continue;
    }
    const directAssemblies = values
      .filter((value) => value.startsWith('dep:'))
      .map((value) => value.slice(4))
      .filter((value) => ASSEMBLY_DEPENDENCY.test(value));
    if (directAssemblies.length !== 1 || directAssemblies[0] !== integration.cargoDependency) {
      issues.push(`${feature}: must depend directly on exactly owner assembly ${integration.cargoDependency}`);
    }
    const [crateName, exportName] = integration.executableExport.split('::');
    if (!crateName || !exportName || !source.includes(`${crateName}::${exportName}`)) {
      issues.push(`${feature}: gateway source must call declared owner entrypoint ${integration.executableExport}`);
    }
  }

  const poolContractPath = path.join(root, 'specs', 'process-database-pool.spec.json');
  if (fs.existsSync(poolContractPath)) {
    const poolContract = readJson(poolContractPath);
    const processContract = (poolContract.processes ?? [])
      .find((process) => process?.id === 'sdkwork-api-cloud-gateway');
    const consumers = new Map(
      (processContract?.consumers ?? []).map((consumer) => [consumer?.module, consumer]),
    );
    const selectedWorkspaces = new Set();
    for (const [feature, integration] of integrations) {
      if (!integration.workspace) {
        issues.push(`${feature}: component dependency surface must declare its owner workspace`);
        continue;
      }
      selectedWorkspaces.add(integration.workspace);
      const consumer = consumers.get(integration.workspace);
      if (!consumer) {
        issues.push(`${feature}: process database pool contract lacks assembly consumer ${integration.workspace}`);
        continue;
      }
      if (consumer.ownerAssembly !== integration.cargoDependency) {
        issues.push(`${feature}: process database pool ownerAssembly must be ${integration.cargoDependency}`);
      }
      if (!(consumer.evidence ?? []).includes('crates/sdkwork-api-cloud-gateway/src/embedded_dependency_routes.rs')) {
        issues.push(`${feature}: process database pool evidence must point to the owner assembly bootstrap`);
      }
    }
    for (const module of consumers.keys()) {
      if (!selectedWorkspaces.has(module)) {
        issues.push(`process database pool declares unselected assembly consumer ${module}`);
      }
    }

    for (const relation of processContract?.nestedLifecycleDependencies ?? []) {
      const ownerWorkspace = String(relation.ownerAssembly ?? '')
        .replace(/^sdkwork-api-/u, 'sdkwork-')
        .replace(/-assembly$/u, '');
      if (!selectedWorkspaces.has(ownerWorkspace)) {
        issues.push(`nested lifecycle owner ${relation.ownerAssembly ?? '<unknown>'} is not a selected platform assembly`);
      }
      const evidence = path.resolve(root, relation.evidence ?? '');
      if (!relation.evidence || !fs.existsSync(evidence) || !fs.statSync(evidence).isFile()) {
        issues.push(`nested lifecycle dependency ${relation.dependencyAssembly ?? '<unknown>'} lacks executable evidence`);
        continue;
      }
      const dependencyCrate = String(relation.dependencyAssembly ?? '').replaceAll('-', '_');
      if (!dependencyCrate || !readText(evidence).includes(`${dependencyCrate}::`)) {
        issues.push(`nested lifecycle evidence must call ${relation.dependencyAssembly ?? '<unknown>'}`);
      }
    }
  }

  for (const [feature, values] of features) {
    if (!feature.startsWith('foundation-')) continue;
    const assemblies = values
      .filter((value) => value.startsWith('dep:'))
      .map((value) => value.slice(4))
      .filter((value) => ASSEMBLY_DEPENDENCY.test(value));
    if (assemblies.length > 1) {
      issues.push(`${feature}: foundation feature must expose at most one direct owner assembly`);
    }
    for (const assembly of assemblies) {
      if (integrations.get(feature)?.cargoDependency !== assembly) {
        issues.push(`${feature}: Cargo owner assembly ${assembly} is absent from component dependency surfaces`);
      }
    }
    for (const value of values.filter((item) => item.startsWith('dep:')).map((item) => item.slice(4))) {
      if (FORBIDDEN_GATEWAY_DEPENDENCY.some((pattern) => pattern.test(value))) {
        issues.push(`${feature}: forbidden direct implementation dependency ${value}; integrate it through the owner API assembly`);
      }
    }
  }

  return issues.map((issue) => `${path.relative(root, manifest.path).replaceAll('\\', '/')}: ${issue}`);
}

function validateStandaloneGatewayContract(root, manifest, assemblyDependencies) {
  const issues = [];
  const source = gatewaySources(manifest.path);
  const componentPath = path.join(path.dirname(manifest.path), 'specs', 'component.spec.json');
  if (!fs.existsSync(componentPath)) {
    issues.push('standalone gateway requires crate-local specs/component.spec.json');
  } else {
    try {
      const component = readJson(componentPath);
      if (component?.component?.name !== manifest.name) {
        issues.push(`standalone component name must be ${manifest.name}`);
      }
      if (component?.component?.type !== 'rust-api-standalone-gateway') {
        issues.push('standalone component type must be rust-api-standalone-gateway');
      }
      const requiredPorts = component?.contracts?.requiredPorts ?? [];
      for (const dependency of assemblyDependencies) {
        const crateName = dependency.replaceAll('-', '_');
        const declaredPort = requiredPorts.find((port) => [port?.export, port?.target, port?.provider]
          .some((value) => typeof value === 'string'
            && (value.includes(dependency) || value.includes(crateName))));
        if (!declaredPort) {
          issues.push(`standalone component requiredPorts must declare owner assembly ${dependency}`);
          continue;
        }
        const executableExport = [declaredPort?.target, declaredPort?.export]
          .find((value) => typeof value === 'string' && value.startsWith(`${crateName}::`));
        if (!executableExport) {
          issues.push(`standalone component requiredPorts must declare an executable ${crateName}:: entrypoint`);
        } else if (!source.includes(executableExport)) {
          issues.push(`standalone gateway source must call component-declared owner entrypoint ${executableExport}`);
        }
      }
      if (!Array.isArray(component?.contracts?.runtimeEntrypoints)
        || component.contracts.runtimeEntrypoints.length === 0) {
        issues.push('standalone component must declare its runtimeEntrypoints');
      }
    } catch (error) {
      issues.push(`standalone specs/component.spec.json is invalid JSON (${error.message})`);
    }
  }
  for (const pattern of FORBIDDEN_GATEWAY_SOURCE_CALL) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) {
      issues.push(`gateway source calls owner implementation ${match[0]} directly; use the owner API assembly entrypoint`);
    }
  }
  for (const dependency of assemblyDependencies) {
    const crateName = dependency.replaceAll('-', '_');
    if (!source.includes(`${crateName}::`)) {
      issues.push(`standalone gateway must call owner assembly ${dependency}`);
    }
  }
  const usesModuleRegistry = source.includes('ApiModuleRegistry')
    && source.includes('.add_module')
    && source.includes('.try_compose(');
  const usesDirectCompose = source.includes('ComposedApiAssembly::try_compose');
  if (!usesModuleRegistry && !usesDirectCompose) {
    issues.push('standalone gateway must validate the complete owner contribution with ApiModuleRegistry add_module/try_compose or ComposedApiAssembly::try_compose');
  }
  if (!source.includes('.into_hosted(')) {
    issues.push('standalone gateway must retain manifest, OpenAPI, permissions, injectors, and readiness through into_hosted');
  }
  return issues.map((issue) => `${path.relative(root, manifest.path).replaceAll('\\', '/')}: ${issue}`);
}

function validateSelectedStandaloneParity(root, component) {
  const issues = [];
  const { integrations } = componentIntegrations(component);
  const workspaces = new Set(
    [...integrations.values()]
      .map((integration) => integration.workspace)
      .filter((workspace) => typeof workspace === 'string' && workspace.trim()),
  );
  for (const workspace of workspaces) {
    const ownerRoot = path.resolve(root, '..', workspace);
    if (!fs.existsSync(ownerRoot)) {
      issues.push(`${workspace}: selected owner workspace is missing at ${ownerRoot}`);
      continue;
    }
    const hasStandaloneGateway = listCargoManifests(ownerRoot).some((cargoPath) => (
      /^sdkwork-api-[a-z0-9-]+-standalone-gateway$/u.test(packageName(readText(cargoPath)) ?? '')
    ));
    if (!hasStandaloneGateway) {
      issues.push(`${workspace}: selected owner workspace has no sdkwork-api-<application-code>-standalone-gateway`);
      continue;
    }
    const ownerIssues = validateApiAssemblyIntegrationClosure(ownerRoot, {
      strictStandaloneHosting: true,
    });
    issues.push(...ownerIssues.map((issue) => `${workspace}: ${issue}`));
  }
  return issues;
}

export function validateApiAssemblyIntegrationClosure(root, options = {}) {
  const issues = [];
  const componentPath = path.join(root, 'specs', 'component.spec.json');
  let component = null;
  if (fs.existsSync(componentPath)) {
    try {
      component = readJson(componentPath);
    } catch (error) {
      return [`specs/component.spec.json: invalid JSON (${error.message})`];
    }
  }

  const cargoManifests = listCargoManifests(root);
  if (options.strictStandaloneHosting === true) {
    for (const cargoPath of cargoManifests) {
      const cargo = readText(cargoPath);
      if (ASSEMBLY_DEPENDENCY.test(packageName(cargo) ?? '')) {
        issues.push(...validateAssemblyHostingBoundary(root, cargoPath));
      }
    }
  }

  for (const cargoPath of cargoManifests) {
    const cargo = readText(cargoPath);
    const name = packageName(cargo);
    if (!isGatewayPackage(name)) continue;
    const rel = path.relative(root, cargoPath).replaceAll('\\', '/');
    const dependencies = runtimeDependencies(cargo);
    const assemblyDependencies = [...dependencies].filter((dependency) => ASSEMBLY_DEPENDENCY.test(dependency));
    if (assemblyDependencies.length === 0) {
      issues.push(`${rel}: gateway must consume at least one sdkwork-api-<application-code>-assembly`);
    }
    for (const dependency of dependencies) {
      if (FORBIDDEN_GATEWAY_DEPENDENCY.some((pattern) => pattern.test(dependency))) {
        issues.push(`${rel}: gateway must not depend directly on ${dependency}; use the owner API assembly integration point`);
      }
    }
    if (name === 'sdkwork-api-cloud-gateway') {
      if (!component) {
        issues.push(`${rel}: platform cloud gateway requires specs/component.spec.json`);
      } else {
        issues.push(...validateCloudGatewayContract(root, { path: cargoPath, cargo }, component));
        if (options.strictSelectedStandaloneParity === true) {
          issues.push(...validateSelectedStandaloneParity(root, component));
        }
      }
    } else if (options.strictStandaloneHosting === true) {
      issues.push(...validateStandaloneGatewayContract(
        root,
        { path: cargoPath, cargo, name },
        assemblyDependencies,
      ));
    }
  }
  return [...new Set(issues)];
}
