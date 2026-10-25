import fs from 'node:fs';
import path from 'node:path';
import {
  FORBIDDEN_PACKAGE_NAMES,
  INSTALL_LAYOUTS,
  PACKAGE_ALIASES,
  PACKAGE_NAMES,
} from './constants.mjs';
import { resolveApiSurfaces, detectApiPrefixConflicts, resolveWebsocketPath, resolveUpstreams, upstreamForSurface } from './api.mjs';
import { loadAppConfig, loadDeployManifest, loadTopology, resolveProfileBlock } from './load-manifest.mjs';
import { resolveAppId, resolveRuntimeCode, packagePath, surfaceExists } from './identity.mjs';
import { nginxSiteFile, webRoots } from './paths.mjs';
import { resolveWebMode, normalizeWeb } from './web.mjs';
import { loadProfileEnv, resolveDomainSurfaceId, registeredEnvironmentHosts } from './topology-env.mjs';
import { validateDeploySchema } from './schema-validate.mjs';

function normalizePackageList(packages) {
  if (!packages) return [];
  if (Array.isArray(packages)) {
    return packages.map((item) => {
      if (typeof item === 'string') {
        return PACKAGE_ALIASES[item] ?? item;
      }
      if (item && typeof item === 'object' && item.name) {
        return PACKAGE_ALIASES[item.name] ?? item.name;
      }
      throw new Error(`invalid packages entry: ${JSON.stringify(item)}`);
    });
  }
  if (typeof packages === 'object') {
    const out = [];
    for (const group of Object.values(packages)) {
      if (!Array.isArray(group)) continue;
      for (const item of group) {
        out.push(PACKAGE_ALIASES[item] ?? item);
      }
    }
    return out;
  }
  throw new Error('packages must be an array or grouped object');
}

function inferLayout(workflow, overrides, explicit) {
  if (overrides?.install?.layout) return overrides.install.layout;
  if (explicit?.layout) return explicit.layout;
  if (!workflow?.targets) return 'binary-package';
  for (const target of workflow.targets) {
    const formats = target.formats ?? [];
    if (formats.some((f) => f === 'deb' || f === 'rpm')) {
      return 'binary-package';
    }
  }
  return 'binary-package';
}

function loadWorkflow(repoRoot) {
  const workflowPath = path.join(repoRoot, 'agent.workflow.json');
  if (!fs.existsSync(workflowPath)) return null;
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function isProductionProfile(profileId) {
  return /\.production$/i.test(profileId ?? '');
}

export function buildDeployContext(repoRoot, profileId, options = {}) {
  const { doc } = loadDeployManifest(repoRoot);
  const topology = loadTopology(repoRoot);
  const appConfig = loadAppConfig(repoRoot);
  const workflow = loadWorkflow(repoRoot);
  const { profileId: selectedProfile, block } = resolveProfileBlock(doc, profileId);

  const errors = [...validateDeploySchema(doc)];
  const { appId, errors: appIdErrors } = resolveAppId(repoRoot, topology);
  const { runtimeCode, errors: runtimeErrors } = resolveRuntimeCode(topology);

  errors.push(...appIdErrors, ...runtimeErrors);
  const warnings = [];

  if (!topology.profileFiles?.[selectedProfile] && !topology.profiles?.[selectedProfile]) {
    if (!Object.keys(topology.profileFiles ?? {}).includes(selectedProfile)) {
      warnings.push(`profile "${selectedProfile}" not listed in topology.profileFiles`);
    }
  }

  const layout = inferLayout(workflow, block.overrides, block.install);
  if (!INSTALL_LAYOUTS.has(layout)) {
    errors.push(`invalid install.layout "${layout}"`);
  }

  const exposeList = block.expose ?? [];
  const packages = normalizePackageList(block.packages);
  const overrides = block.overrides ?? {};
  const apiSurfaces = resolveApiSurfaces(appConfig, repoRoot);
  const wsPath = resolveWebsocketPath(topology);

  for (const pkg of packages) {
    if (FORBIDDEN_PACKAGE_NAMES.has(pkg)) {
      errors.push(`packages must not include "${pkg}"`);
    } else if (!PACKAGE_NAMES.has(pkg)) {
      warnings.push(`unknown package name "${pkg}"`);
    }
  }

  errors.push(...detectApiPrefixConflicts(apiSurfaces));

  const profileEnv = loadProfileEnv(path.resolve(repoRoot), topology, selectedProfile);
  const upstreams = resolveUpstreams(topology, overrides, profileEnv);

  const exposePlans = [];
  const environment = selectedProfile.split('.')[1] ?? '';
  const deploymentProfile = block?.deployment?.deploymentProfile
    ?? selectedProfile.split('.')[0] ?? '';
  const registeredHosts = registeredEnvironmentHosts(topology);
  for (const [surfaceId, config] of Object.entries(topology?.cloudPublicHosts ?? {})) {
    const hosts = config?.httpHosts ?? [];
    if (Array.isArray(hosts) && hosts.length > 0 && config?.httpHost && !hosts.includes(config.httpHost)) {
      errors.push(
        `cloudPublicHosts.${surfaceId}: httpHost "${config.httpHost}" must be an element of httpHosts`,
      );
    }
    for (const [environment, variant] of Object.entries(config?.environments ?? {})) {
      const variantHosts = variant?.httpHosts ?? [];
      if (Array.isArray(variantHosts) && variantHosts.length > 0 && variant?.httpHost
        && !variantHosts.includes(variant.httpHost)) {
        errors.push(
          `cloudPublicHosts.${surfaceId}.environments.${environment}:`
          + ` httpHost "${variant.httpHost}" must be an element of httpHosts`,
        );
      }
    }
  }
  for (const item of exposeList) {
    const domain = item?.domain;
    if (!domain || typeof domain !== 'string') {
      errors.push('each expose item requires domain');
      continue;
    }

    const bareDomain = domain.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(bareDomain)) {
      errors.push(`domain "${domain}": must be a bare hostname without scheme, port, or path`);
    }
    if (/^(?:dev|test|staging|prod)[.-]/u.test(bareDomain.split('.')[0] ?? '')
      || /-prod\./u.test(bareDomain)) {
      errors.push(
        `domain "${domain}": prefix-style (test-im.*) and production-suffixed (*-prod.*) hosts`
        + ' are retired (APP_RUNTIME_TOPOLOGY_NAMING.md section 9.1)',
      );
    }

    if (deploymentProfile === 'cloud' && registeredHosts.all.size > 0) {
      const expected = registeredHosts.byEnvironment.get(environment);
      if (!expected?.has(bareDomain)) {
        if (registeredHosts.all.has(bareDomain)) {
          errors.push(
            `domain "${domain}": registered for a different environment in topology cloudPublicHosts;`
            + ` expected one of [${[...(expected ?? [])].join(', ')}]`,
          );
        } else if (/\.sdkwork\.com$/i.test(bareDomain)) {
          errors.push(
            `domain "${domain}": not registered in topology cloudPublicHosts for profile "${selectedProfile}"`
            + ` (APP_RUNTIME_TOPOLOGY_NAMING.md section 9)`,
          );
        } else {
          warnings.push(
            `domain "${domain}": not in the SDKWork host registry;`
            + ' customer-managed base domain requires release metadata',
          );
        }
      }
    }

    for (const alias of item.aliases ?? []) {
      const bareAlias = String(alias ?? '').trim().toLowerCase();
      if (!bareAlias) {
        errors.push(`domain "${domain}": aliases must contain non-empty bare hostnames`);
        continue;
      }
      if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(bareAlias)) {
        errors.push(`domain "${domain}": alias "${alias}" must be a bare hostname without scheme, port, or path`);
        continue;
      }
      if (deploymentProfile === 'cloud' && registeredHosts.all.size > 0) {
        const expected = registeredHosts.byEnvironment.get(environment);
        if (!expected?.has(bareAlias)) {
          if (registeredHosts.all.has(bareAlias)) {
            errors.push(
              `domain "${domain}": alias "${alias}" is registered for a different environment`
              + ` (expected one of [${[...(expected ?? [])].join(', ')}])`,
            );
          } else if (/\.sdkwork\.com$/i.test(bareAlias)) {
            errors.push(
              `domain "${domain}": alias "${alias}" is not registered in topology cloudPublicHosts`
              + ` for profile "${selectedProfile}"`,
            );
          } else {
            warnings.push(
              `domain "${domain}": alias "${alias}" is not in the SDKWork host registry;`
              + ' customer-managed base domain requires release metadata',
            );
          }
        }
      }
    }

    const mode = item.mode ?? 'web+api';
    const tls = item.tls ?? (isProductionProfile(selectedProfile) ? 'managed' : 'off');
    const webSpec = item.web;
    const siteFile = nginxSiteFile(domain, overrides);

    if (mode === 'api' && webSpec) {
      errors.push(`domain "${domain}": mode api forbids web`);
    }
    if ((mode === 'web' || mode === 'web+api') && !webSpec) {
      errors.push(`domain "${domain}": mode ${mode} requires web`);
    }

    if (isProductionProfile(selectedProfile) && tls === 'off' && !overrides.allowInsecureTls) {
      errors.push(`domain "${domain}": production forbids tls: off without overrides.allowInsecureTls`);
    }

    if (mode === 'api' || mode === 'web+api') {
      const surfaceId = resolveDomainSurfaceId(topology, domain);
      const upstream = upstreamForSurface(upstreams, surfaceId);
      if (!upstream) {
        errors.push(`domain "${domain}": no upstream resolved for surface "${surfaceId}"`);
      } else if (/127\.0\.0\.1:8080/.test(upstream)) {
        errors.push(`domain "${domain}": placeholder upstream "${upstream}" is forbidden`);
      }
    }

    let webPlan = null;
    if (webSpec && mode !== 'api') {
      webPlan = resolveWebMode(repoRoot, appId, webSpec, { overrides });
      if (webPlan.errors?.length) {
        errors.push(...webPlan.errors.map((e) => `domain "${domain}": ${e}`));
      }
      warnings.push(...(webPlan.warnings ?? []).map((w) => `domain "${domain}": ${w}`));

      if (webPlan.mode === 'static-fallback') {
        const root = webPlan.staticRoot;
        if (layout === 'binary-package' && root.includes('/usr/share/sdkwork-space/')) {
          errors.push(`domain "${domain}": binary-package must not use sdkwork-space web root`);
        }
      } else {
        for (const surface of webPlan.surfaces ?? []) {
          const root = webRoots({
            appId,
            runtimeCode,
            layout,
            surface,
            repoRoot: path.resolve(repoRoot),
            dev: options.dev,
          });
          if (layout === 'binary-package' && root.includes('/usr/share/sdkwork-space/')) {
            errors.push(`domain "${domain}": binary-package must not use sdkwork-space web root`);
          }
          if (layout === 'source-tree' && root.includes(`/usr/share/sdkwork/${runtimeCode}/web/`)) {
            errors.push(`domain "${domain}": source-tree must not use /usr/share/sdkwork/{runtimeCode}/web/`);
          }
        }
      }
    }

    exposePlans.push({
      domain,
      tls,
      mode,
      aliases: item.aliases ?? [],
      apiPathStyle: item.apiPathStyle ?? 'full-prefix',
      siteFile,
      web: webPlan,
    });
  }

  for (const pkg of packages) {
    const rel = packagePath(appId, pkg);
    if (rel && !fs.existsSync(path.join(repoRoot, rel)) && !fs.existsSync(path.join(repoRoot, path.dirname(rel)))) {
      warnings.push(`package "${pkg}" path not found: ${rel}`);
    }
  }

  if (containsPlaintextSecrets(block)) {
    errors.push('deploy.yaml must not contain plaintext secret keys (password, token, privateKey, secret)');
  }

  return {
    repoRoot: path.resolve(repoRoot),
    profileId: selectedProfile,
    appId,
    runtimeCode,
    layout,
    deployment: block.deployment ?? null,
    expose: exposePlans,
    packages,
    apiSurfaces,
    websocketPath: wsPath,
    topology,
    overrides,
    errors,
    warnings,
  };
}

function containsPlaintextSecrets(value, keyPath = '') {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    if (/secret|password|token|privatekey|privkey/i.test(keyPath) && !keyPath.includes('secret://')) {
      return value.length > 0 && !value.startsWith('secret://');
    }
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item, index) => containsPlaintextSecrets(item, `${keyPath}[${index}]`));
  }
  if (typeof value === 'object') {
    return Object.entries(value).some(([key, val]) =>
      containsPlaintextSecrets(val, keyPath ? `${keyPath}.${key}` : key),
    );
  }
  return false;
}

export function validateDeploy(repoRoot, profileId, options = {}) {
  const context = buildDeployContext(repoRoot, profileId, options);
  return {
    ok: context.errors.length === 0,
    ...context,
  };
}
