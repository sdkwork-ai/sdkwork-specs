const PACKAGE_NAMES = new Set([
  'flutter-mobile',
  'harmony-mobile',
  'android-mobile',
  'ios-mobile',
  'mini-program-weixin',
  'mini-program-alipay',
  'desktop-windows',
  'desktop-macos',
  'desktop-linux',
]);

const WEB_VALUES_V1 = new Set(['adaptive', 'auto', 'pc', 'h5']);
const WEB_VALUES_V2 = new Set(['adaptive', 'pc', 'h5']);
const EXPOSE_MODES = new Set(['web', 'api', 'web+api']);
const LAYOUTS = new Set(['source-tree', 'binary-package']);
/**
 * Profile ids a deployment manifest (`deployments/deploy.yaml`) may declare.
 *
 * `development` and `demo` are lifecycle environments and remain valid
 * topology profiles (`etc/topology/<profile>.env`, `specs/topology.spec.json`
 * `profileFiles`), but they are not deployable targets: the deploy toolchain
 * only ever selects test, staging or production (tools/deploy/init.mjs,
 * tools/deploy/selection.mjs), and check-deploy-standard.test.mjs locks this
 * rejection in ("deploy manifest rejects development ... profile drift").
 *
 * Any generator that materialises a deploy manifest MUST filter to this set —
 * exporting it here keeps that rule in one place.
 */
export const PROFILE_ID_PATTERN = /^(standalone|cloud)\.(test|staging|production)$/u;

const DEPLOYMENT_ENUMS = {
  deploymentProfile: new Set(['standalone', 'cloud']),
  environment: new Set(['test', 'staging', 'production']),
  deliveryKind: new Set(['host-package', 'container-image', 'static-web', 'platform-package', 'configuration-bundle']),
  deploymentDriver: new Set(['host-service', 'container-runtime', 'kubernetes', 'static-host', 'application-store', 'mini-program-platform', 'nginx']),
  managementModel: new Set(['sdkwork-managed', 'customer-managed', 'platform-managed', 'end-user-managed']),
  tenancyModel: new Set(['single-tenant', 'multi-tenant']),
  isolationModel: new Set(['shared', 'dedicated']),
  networkExposure: new Set(['public', 'private', 'internal', 'offline']),
  rolloutStrategy: new Set(['recreate', 'rolling', 'blue-green', 'canary', 'platform-staged']),
  availabilityMode: new Set(['single-instance', 'high-availability', 'multi-region']),
};

function push(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function validateExposeItem(item, path, errors, version) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    push(errors, path, 'must be an object');
    return;
  }
  for (const key of Object.keys(item)) {
    if (
      !['domain', 'tls', 'mode', 'web', 'aliases', 'apiPathStyle'].includes(key)
    ) {
      push(errors, path, `unknown property "${key}"`);
    }
  }
  if (typeof item.domain !== 'string' || !item.domain.trim()) {
    push(errors, `${path}.domain`, 'is required');
  }
  if (item.mode !== undefined && !EXPOSE_MODES.has(item.mode)) {
    push(errors, `${path}.mode`, 'must be web, api, or web+api');
  }
  if (item.apiPathStyle !== undefined && !['full-prefix', 'strip-prefix'].includes(item.apiPathStyle)) {
    push(errors, `${path}.apiPathStyle`, 'must be full-prefix or strip-prefix');
  }
  if (item.web !== undefined) {
    if (typeof item.web === 'string') {
      const webValues = version === 2 ? WEB_VALUES_V2 : WEB_VALUES_V1;
      if (!webValues.has(item.web)) {
        push(errors, `${path}.web`, 'invalid web surface selector');
      }
    } else if (Array.isArray(item.web)) {
      if (item.web.length < 1 || item.web.length > 2) {
        push(errors, `${path}.web`, 'array must contain 1 or 2 surfaces');
      }
      for (const [index, surface] of item.web.entries()) {
        if (surface !== 'pc' && surface !== 'h5') {
          push(errors, `${path}.web[${index}]`, 'must be pc or h5');
        }
      }
    } else {
      push(errors, `${path}.web`, 'must be a string or array');
    }
  }
  if (item.aliases !== undefined) {
    if (!Array.isArray(item.aliases)) {
      push(errors, `${path}.aliases`, 'must be an array');
    } else {
      for (const [index, alias] of item.aliases.entries()) {
        if (typeof alias !== 'string' || !alias.trim()) {
          push(errors, `${path}.aliases[${index}]`, 'must be a non-empty string');
        }
      }
    }
  }
}

function validatePackages(packages, path, errors) {
  if (packages === undefined) {
    return;
  }
  if (Array.isArray(packages)) {
    for (const [index, item] of packages.entries()) {
      if (typeof item !== 'string' || !PACKAGE_NAMES.has(item)) {
        push(errors, `${path}[${index}]`, 'unknown package name');
      }
    }
    return;
  }
  if (typeof packages === 'object') {
    for (const [group, items] of Object.entries(packages)) {
      if (!Array.isArray(items)) {
        push(errors, `${path}.${group}`, 'must be an array');
        continue;
      }
      for (const [index, item] of items.entries()) {
        if (typeof item !== 'string') {
          push(errors, `${path}.${group}[${index}]`, 'must be a string');
        }
      }
    }
    return;
  }
  push(errors, path, 'must be an array or grouped object');
}

function validateInstall(install, path, errors) {
  if (install === undefined) {
    return;
  }
  if (!install || typeof install !== 'object' || Array.isArray(install)) {
    push(errors, path, 'must be an object');
    return;
  }
  for (const key of Object.keys(install)) {
    if (key !== 'layout') {
      push(errors, path, `unknown property "${key}"`);
    }
  }
  if (install.layout !== undefined && !LAYOUTS.has(install.layout)) {
    push(errors, `${path}.layout`, 'must be source-tree or binary-package');
  }
}

function validateDeployment(deployment, path, errors, profileId) {
  if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)) {
    push(errors, path, 'is required and must be an object');
    return;
  }
  const optional = new Set(['infrastructureProvider', 'providerRegion', 'availabilityZones', 'driverConfigRef', 'exceptionRef']);
  for (const key of Object.keys(deployment)) {
    if (!DEPLOYMENT_ENUMS[key] && !optional.has(key)) {
      push(errors, path, `unknown property "${key}"`);
    }
  }
  for (const [key, allowed] of Object.entries(DEPLOYMENT_ENUMS)) {
    if (!allowed.has(deployment[key])) {
      push(errors, `${path}.${key}`, `must be one of ${[...allowed].join(', ')}`);
    }
  }
  const match = PROFILE_ID_PATTERN.exec(profileId ?? '');
  if (match && (deployment.deploymentProfile !== match[1] || deployment.environment !== match[2])) {
    push(errors, path, `must match profile id "${profileId}"`);
  }
  validateDeploymentCombination(deployment, path, errors, profileId);
}

function validateDeploymentCombination(deployment, path, errors, profileId) {
  const { deliveryKind, deploymentDriver, networkExposure, rolloutStrategy, availabilityMode } = deployment;
  const allowedDrivers = {
    'host-package': new Set(['host-service', 'nginx']),
    'container-image': new Set(['container-runtime', 'kubernetes']),
    'static-web': new Set(['static-host', 'nginx']),
    'platform-package': new Set(['application-store', 'mini-program-platform']),
    'configuration-bundle': new Set(['host-service', 'container-runtime', 'kubernetes', 'nginx']),
  }[deliveryKind];
  if (allowedDrivers && !allowedDrivers.has(deploymentDriver)) {
    push(errors, path, `${deliveryKind} cannot use deploymentDriver ${deploymentDriver}`);
  }
  if (networkExposure === 'offline' && deployment.deploymentProfile === 'cloud') {
    push(errors, path, 'cloud deployment cannot use networkExposure offline');
  }
  if (availabilityMode === 'multi-region') {
    if (!deployment.infrastructureProvider || !deployment.providerRegion) {
      push(errors, path, 'multi-region requires infrastructureProvider and providerRegion');
    }
    if (!Array.isArray(deployment.availabilityZones) || deployment.availabilityZones.length < 2) {
      push(errors, path, 'multi-region requires at least two availabilityZones');
    }
  }
  if (rolloutStrategy === 'canary' && !['container-runtime', 'kubernetes', 'static-host'].includes(deploymentDriver)) {
    push(errors, path, `canary rollout is not supported by ${deploymentDriver}`);
  }
  if (rolloutStrategy === 'platform-staged' && !['application-store', 'mini-program-platform'].includes(deploymentDriver)) {
    push(errors, path, 'platform-staged rollout requires an application or mini-program platform driver');
  }
}

function validateProfileBlock(block, path, errors, version, profileId) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    push(errors, path, 'must be an object');
    return;
  }
  for (const key of Object.keys(block)) {
    if (!['deployment', 'install', 'expose', 'packages', 'overrides'].includes(key)) {
      push(errors, path, `unknown property "${key}"`);
    }
  }
  if (version === 1 && block.deployment !== undefined) {
    push(errors, `${path}.deployment`, 'is available only in version 2');
  }
  if (version === 2) validateDeployment(block.deployment, `${path}.deployment`, errors, profileId);
  validateInstall(block.install, `${path}.install`, errors);
  if (block.expose !== undefined) {
    if (!Array.isArray(block.expose)) {
      push(errors, `${path}.expose`, 'must be an array');
    } else {
      for (const [index, item] of block.expose.entries()) {
        validateExposeItem(item, `${path}.expose[${index}]`, errors, version);
      }
    }
  }
  validatePackages(block.packages, `${path}.packages`, errors);
}

export function validateDeploySchema(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['deploy manifest must be a YAML object'];
  }

  for (const key of Object.keys(doc)) {
    if (
      ![
        'version',
        'profile',
        'defaultProfile',
        'profiles',
        'deployment',
        'install',
        'expose',
        'packages',
        'overrides',
      ].includes(key)
    ) {
      push(errors, key, 'unknown root property');
    }
  }

  if (doc.version !== 1 && doc.version !== 2) {
    push(errors, 'version', 'must be 1 or 2');
  }
  const version = doc.version;
  if (version === 1 && doc.deployment !== undefined) {
    push(errors, 'deployment', 'is available only in version 2');
  }

  const hasProfiles = doc.profiles !== undefined;
  if (hasProfiles) {
    if (typeof doc.profiles !== 'object' || Array.isArray(doc.profiles)) {
      push(errors, 'profiles', 'must be an object');
    } else if (Object.keys(doc.profiles).length === 0) {
      push(errors, 'profiles', 'must contain at least one profile');
    } else {
      for (const [profileId, block] of Object.entries(doc.profiles)) {
        if (!PROFILE_ID_PATTERN.test(profileId)) {
          push(errors, `profiles.${profileId}`, 'profile id must use <standalone|cloud>.<test|staging|production>');
        }
        validateProfileBlock(block, `profiles.${profileId}`, errors, version, profileId);
      }
    }
    if (typeof doc.defaultProfile !== 'string' || !doc.defaultProfile.trim()) {
      push(errors, 'defaultProfile', 'is required in profiles mode');
    } else if (doc.profiles && !doc.profiles[doc.defaultProfile]) {
      push(errors, 'defaultProfile', `unknown profile "${doc.defaultProfile}"`);
    }
    for (const forbidden of ['profile', 'deployment', 'install', 'expose', 'packages', 'overrides']) {
      if (doc[forbidden] !== undefined) {
        push(errors, forbidden, 'forbidden in profiles mode');
      }
    }
  } else {
    if (typeof doc.profile !== 'string' || !doc.profile.trim()) {
      push(errors, 'profile', 'is required in simple mode');
    } else if (!PROFILE_ID_PATTERN.test(doc.profile)) {
      push(errors, 'profile', 'must use <standalone|cloud>.<test|staging|production>');
    }
    if (version === 2) validateDeployment(doc.deployment, 'deployment', errors, doc.profile);
    if (!Array.isArray(doc.expose)) {
      push(errors, 'expose', 'is required in simple mode');
    } else {
      for (const [index, item] of doc.expose.entries()) {
        validateExposeItem(item, `expose[${index}]`, errors, version);
      }
    }
    validateInstall(doc.install, 'install', errors);
    validatePackages(doc.packages, 'packages', errors);
  }

  const profileBlocks = hasProfiles ? Object.entries(doc.profiles ?? {}) : [[doc.profile, doc]];
  for (const [profileId, block] of profileBlocks) {
    const layout = block?.overrides?.install?.layout ?? block?.install?.layout;
    const exceptionRef = block?.deployment?.exceptionRef;
    if (/\.production$/u.test(profileId ?? '') && layout === 'source-tree' && !exceptionRef) {
      push(errors, `${hasProfiles ? `profiles.${profileId}.` : ''}install.layout`, 'production source-tree requires deployment.exceptionRef');
    }
    const deployment = block?.deployment;
    const expose = block?.expose;
    if (deployment?.networkExposure === 'offline' && Array.isArray(expose) && expose.length > 0) {
      push(errors, `${hasProfiles ? `profiles.${profileId}.` : ''}expose`, 'offline deployment cannot declare public expose domains');
    }
  }

  return errors;
}
