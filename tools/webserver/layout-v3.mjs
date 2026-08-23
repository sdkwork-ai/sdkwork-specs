// Layout v3 merge: common → environment → profile (SDKWORK_WEBSERVER_SPEC.md §2).

import { mergeConfigs } from './merge.mjs';

export const LIFECYCLE_ENVIRONMENTS = ['development', 'test', 'staging', 'production'];
export const DEPLOYMENT_PROFILES = ['standalone', 'cloud'];

export const ENVIRONMENT_FILE_NAMES = Object.fromEntries(
  LIFECYCLE_ENVIRONMENTS.map((environment) => [environment, `server.${environment}.toml`]),
);

export const PROFILE_FILE_NAMES = {
  standalone: 'server.standalone.toml',
  cloud: 'server.cloud.toml',
};

export const LAYOUT_V3_FILES = [
  'server.common.toml',
  ...LIFECYCLE_ENVIRONMENTS.map((environment) => ENVIRONMENT_FILE_NAMES[environment]),
  ...Object.values(PROFILE_FILE_NAMES),
];

/** Strip file-role metadata keys before merge. */
export function stripRoleKeys(doc) {
  const next = { ...doc };
  delete next.profile;
  delete next.environment;
  return next;
}

/**
 * effective(profile, environment) = merge(common, server.<environment>.toml, server.<profile>.toml)
 */
export function mergeEffective(common, environmentDoc, profileDoc) {
  return mergeConfigs(mergeConfigs(common, stripRoleKeys(environmentDoc)), stripRoleKeys(profileDoc));
}

export function sidecarFileName(confBase, profile, environment) {
  const stem = confBase.replace(/\.conf$/u, '');
  return `${stem}.${profile}.${environment}.conf`;
}
