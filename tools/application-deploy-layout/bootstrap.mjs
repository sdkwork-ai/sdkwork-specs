import { envPrefixFromCode } from './discover.mjs';
import { expandSurfaceMultiBase, PLATFORM_GATEWAY_ROLE } from '../webserver/host-registry.mjs';

const PROFILE_IDS = [
  'standalone.development',
  'standalone.test',
  'standalone.staging',
  'standalone.production',
  'cloud.development',
  'cloud.test',
  'cloud.staging',
  'cloud.production',
];

export function renderMinimalAppConfig(appId, runtimeCode) {
  const displayName = appId
    .replace(/^sdkwork-/u, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return `${JSON.stringify(
    {
      schemaVersion: 3,
      kind: 'sdkwork.app',
      app: {
        key: appId,
        name: displayName,
        displayName: `SDKWork ${displayName}`,
        description: `SDKWork ${displayName} application (bootstrap deploy layout).`,
        appType: 'SDK',
      },
      backend: {
        primaryLanguage: 'rust',
        framework: 'axum',
        appId,
        serviceId: appId,
        owner: appId,
        domain: runtimeCode.replace(/_/gu, '-'),
      },
      runtime: {
        family: 'server',
        framework: 'rust-axum',
        supportedDeploymentProfiles: ['standalone', 'cloud'],
        defaultDeploymentProfile: 'standalone',
      },
    },
    null,
    2,
  )}\n`;
}

export function renderMinimalTopology(appId, runtimeCode) {
  const prefix = envPrefixFromCode(runtimeCode);
  const roleHost = runtimeCode.replace(/_/gu, '-');
  const profileFiles = Object.fromEntries(
    PROFILE_IDS.map((profileId) => [profileId, `etc/topology/${profileId}.env`]),
  );
  return {
    schemaVersion: 5,
    kind: 'sdkwork.app.topology',
    appId,
    applicationCode: runtimeCode,
    archetype: 'application-http-gateway',
    profileRoot: 'etc/topology',
    profilePattern: '{deploymentProfile}.{environment}.env',
    vocabulary: {
      deploymentProfile: { allowed: ['standalone', 'cloud'] },
      environment: { allowed: ['development', 'test', 'staging', 'production'] },
    },
    defaults: {
      developmentProfileId: 'standalone.development',
      productionProfileId: 'cloud.production',
      gatewayBind: '127.0.0.1:3900',
    },
    profileFiles,
    envKeys: {
      deploymentProfile: `SDKWORK_${prefix}_DEPLOYMENT_PROFILE`,
      environment: `SDKWORK_${prefix}_ENVIRONMENT`,
      profileId: `SDKWORK_${prefix}_PROFILE_ID`,
      standaloneGatewayBind: `SDKWORK_${prefix}_APPLICATION_PUBLIC_INGRESS_BIND`,
      apiGatewayBaseUrl: `SDKWORK_${prefix}_PLATFORM_API_GATEWAY_HTTP_URL`,
    },
    surfaces: {
      'application.public-ingress': {
        connectivityPlane: 'application',
        protocols: ['http'],
        bindEnv: `SDKWORK_${prefix}_APPLICATION_PUBLIC_INGRESS_BIND`,
        httpUrlEnv: `SDKWORK_${prefix}_APPLICATION_PUBLIC_HTTP_URL`,
      },
      'platform.api-gateway': {
        connectivityPlane: 'platform',
        protocols: ['http'],
        httpUrlEnv: `SDKWORK_${prefix}_PLATFORM_API_GATEWAY_HTTP_URL`,
      },
    },
    cloudPublicHosts: {
      'application.public-ingress': expandSurfaceMultiBase({}, roleHost),
      'platform.api-gateway': expandSurfaceMultiBase({}, PLATFORM_GATEWAY_ROLE),
    },
  };
}

export function renderMinimalDeploymentIndex(appId) {
  const profiles = Object.fromEntries(
    PROFILE_IDS.map((profileId) => [profileId, { config: `topology/${profileId}.env` }]),
  );
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: 'sdkwork.deployment-index',
      application: appId,
      topology: '../specs/topology.spec.json',
      defaultProfile: 'standalone.development',
      profiles,
    },
    null,
    2,
  )}\n`;
}

export function renderMinimalProfileEnv(profileId, runtimeCode) {
  const [deploymentProfile, environment] = profileId.split('.');
  const prefix = envPrefixFromCode(runtimeCode);
  const roleHost = runtimeCode.replace(/_/gu, '-');
  const suffix =
    environment === 'production'
      ? ''
      : environment === 'development'
        ? '-dev'
        : `-${environment}`;
  const appHost = `https://${roleHost}${suffix}.sdkwork.com`;
  const apiHost = `https://api${suffix}.sdkwork.com`;
  return [
    `# Bootstrap profile ${profileId} — replace with application-specific values.`,
    `SDKWORK_${prefix}_DEPLOYMENT_PROFILE=${deploymentProfile}`,
    `SDKWORK_${prefix}_ENVIRONMENT=${environment}`,
    `SDKWORK_${prefix}_PROFILE_ID=${profileId}`,
    `SDKWORK_${prefix}_APPLICATION_PUBLIC_HTTP_URL=${appHost}`,
    `SDKWORK_${prefix}_PLATFORM_API_GATEWAY_HTTP_URL=${apiHost}`,
    '',
  ].join('\n');
}

export { PROFILE_IDS };
