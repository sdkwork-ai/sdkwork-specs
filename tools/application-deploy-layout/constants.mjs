export const FRAMEWORK_REPOS = new Set([
  'sdkwork-utils',
  'sdkwork-web-framework',
  'sdkwork-rpc-framework',
  'sdkwork-database',
  'sdkwork-id',
  'sdkwork-catalog',
  'sdkwork-log',
  'sdkwork-github-workflow',
]);

export const LAYOUT_MARKER_START = '<!-- SDKWORK-DEPLOY-LAYOUT: v1 -->';
export const LAYOUT_MARKER_END = '<!-- /SDKWORK-DEPLOY-LAYOUT -->';

export const REQUIRED_ARTIFACTS = [
  'sdkwork.app.config.json',
  'specs/topology.spec.json',
  'etc',
  'deployments/deploy.yaml',
];

export const WEBSERVER_FILES = [
  'deployments/webserver/server.common.toml',
  'deployments/webserver/server.development.toml',
  'deployments/webserver/server.test.toml',
  'deployments/webserver/server.staging.toml',
  'deployments/webserver/server.production.toml',
  'deployments/webserver/server.standalone.toml',
  'deployments/webserver/server.cloud.toml',
];
