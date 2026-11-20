/**
 * Store submission plans for the publish-app orchestrator.
 *
 * `agent.app.config.json#publish.stores[]` declares the market lanes and points
 * at `configRef` documents (for example `etc/store-publishing/google-play.json`).
 * Each market document declares one or more submission targets (Apple: iOS;
 * Google Play: Android; AppGallery: Android *and* HarmonyOS), and each target
 * becomes its own plan so an unavailable package on one platform never blocks
 * the other platform's submission.
 *
 * A plan maps one target to the provider request a credentialed runner would
 * send: endpoint, method, body, credential references, the local artifact it
 * consumes, and the external console steps no API can perform.
 *
 * The orchestrator only reports plans; live network submission stays in the
 * credentialed release runner. A plan never contains a secret value.
 */
import fs from 'node:fs';
import path from 'node:path';

export const SUPPORTED_STORE_MARKETS = ['APPLE_APP_STORE', 'GOOGLE_PLAY', 'HUAWEI_APPGALLERY'];

const ARTIFACT_EXTENSION_BY_FORMAT = {
  AAB: '.aab',
  APK: '.apk',
  IPA: '.ipa',
  HAP: '.hap',
};

export function readStorePublishing(appRoot, appConfig) {
  const lanes = Array.isArray(appConfig?.publish?.stores) ? appConfig.publish.stores : [];
  const configs = [];
  const issues = [];
  for (const lane of lanes) {
    const marketId = lane?.marketId;
    if (!SUPPORTED_STORE_MARKETS.includes(marketId)) {
      issues.push(`${String(marketId)}: no store submission adapter`);
      continue;
    }
    const configRef = String(lane.configRef ?? '');
    const absolute = configRef ? path.resolve(appRoot, configRef) : '';
    const root = path.resolve(appRoot);
    if (!configRef || !absolute.startsWith(`${root}${path.sep}`)) {
      issues.push(`${marketId}: publish.stores[].configRef must resolve inside the app root`);
      continue;
    }
    if (!fs.existsSync(absolute)) {
      issues.push(`${marketId}: ${configRef} does not exist`);
      continue;
    }
    let config;
    try {
      config = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch (error) {
      issues.push(`${marketId}: ${configRef} is not valid JSON (${error.message})`);
      continue;
    }
    if (config.marketId !== marketId) {
      issues.push(`${marketId}: ${configRef} declares marketId ${String(config.marketId)}`);
      continue;
    }
    configs.push({ lane, config, configRef });
  }
  return { configs, issues, lanes: lanes.length };
}

/**
 * @param {object} input
 * @param {string} input.appRoot
 * @param {object} input.appConfig parsed agent.app.config.json
 * @param {Array<{name: string, path: string, format?: string}>} [input.artifacts]
 * @param {string} [input.marketFilter]
 * @param {boolean} [input.requireArtifacts]
 * @returns {{plans: object[], issues: string[]}}
 */
export function buildStoreSubmissionPlans({
  appRoot,
  appConfig,
  artifacts = [],
  marketFilter,
  requireArtifacts = false,
}) {
  const { configs, issues, lanes } = readStorePublishing(appRoot, appConfig);
  if (lanes === 0) {
    if (marketFilter) {
      issues.push(`agent.app.config.json declares no publish.stores lane for ${marketFilter}`);
    }
    return { plans: [], issues };
  }
  const plans = [];
  for (const { config, configRef } of configs) {
    if (marketFilter && config.marketId !== marketFilter) continue;
    const targets = submissionTargets(config);
    if (targets.length === 0) {
      issues.push(`${config.marketId}: submission declares no target`);
      continue;
    }
    for (const target of targets) {
      const artifact = matchArtifact(target, artifacts);
      const blockers = [];
      if (requireArtifacts && !artifact) {
        blockers.push(`no built ${target.packageFormat} artifact for ${target.artifactName ?? config.marketId}`);
      }
      plans.push({
        ...planForTarget(config, configRef, target, artifact, appConfig?.release?.currentVersion ?? '0.0.0'),
        blockers,
        externalSteps: externalStepsFor(config),
      });
    }
  }
  return { plans, issues };
}

/** Normalizes the market document's submission targets. */
export function submissionTargets(config) {
  const submission = config?.submission ?? {};
  if (Array.isArray(submission.targets)) {
    return submission.targets;
  }
  if (Array.isArray(submission.artifacts)) {
    return submission.artifacts;
  }
  return submission.artifact ? [submission.artifact] : [];
}

function matchArtifact(target, artifacts) {
  const extension = ARTIFACT_EXTENSION_BY_FORMAT[target.packageFormat];
  return artifacts.find((artifact) => artifact.name === target.artifactName)
    ?? artifacts.find((artifact) => String(artifact.format ?? '').toUpperCase() === target.packageFormat)
    ?? (extension
      ? artifacts.find((artifact) => String(artifact.path ?? artifact.name ?? '').endsWith(extension))
      : undefined);
}

function externalStepsFor(config) {
  if (config.marketId === 'APPLE_APP_STORE' && !config.identifiers?.appleId) {
    return ['Create the app record once in App Store Connect, then store its numeric id as identifiers.appleId'];
  }
  if (config.marketId === 'HUAWEI_APPGALLERY' && !config.identifiers?.appId) {
    return ['Create the AppGallery Connect app once, then store its numeric id as identifiers.appId'];
  }
  if (config.marketId === 'GOOGLE_PLAY' && !config.identifiers?.applicationId) {
    return ['Create the Play Console app once, then store its applicationId'];
  }
  return [];
}

function planForTarget(config, configRef, target, artifact, version) {
  const base = {
    marketId: config.marketId,
    targetId: target.id ?? target.platform,
    platform: target.platform,
    packageFormat: target.packageFormat,
    displayName: config.displayName ?? config.marketId,
    configRef,
    version,
    track: config.release?.track,
    countries: config.release?.countries ?? [],
    rolloutPercent: config.release?.rolloutPercent,
    credentials: Object.values(config.submission?.credentialRefs ?? {}),
    artifacts: artifact ? [artifact.name ?? artifact.path] : [],
  };
  switch (config.marketId) {
    case 'APPLE_APP_STORE': {
      const appleId = config.identifiers?.appleId;
      return {
        ...base,
        provider: 'app-store-connect',
        method: 'POST',
        endpoint: appleId
          ? `https://api.appstoreconnect.apple.com/v1/apps/${appleId}/appStoreVersions`
          : 'https://api.appstoreconnect.apple.com/v1/appStoreVersions',
        body: {
          data: {
            type: 'appStoreVersions',
            attributes: {
              platform: 'IOS',
              versionString: version,
              releaseType: config.release?.releaseType ?? 'MANUAL',
            },
          },
        },
      };
    }
    case 'GOOGLE_PLAY': {
      const applicationId = config.identifiers?.applicationId;
      return {
        ...base,
        provider: 'google-play-developer-api',
        method: 'POST',
        endpoint: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${applicationId}/edits`,
        body: {
          track: config.release?.track,
          releaseStatus: config.release?.releaseType === 'STAGED_ROLLOUT' ? 'inProgress' : 'completed',
          userFraction: config.release?.phasedRelease ? (config.release?.rolloutPercent ?? 100) / 100 : undefined,
          countries: config.release?.countries ?? [],
        },
      };
    }
    case 'HUAWEI_APPGALLERY':
      return {
        ...base,
        provider: 'appgallery-connect-api',
        method: 'POST',
        endpoint: 'https://connect-api.cloud.huawei.com/api/publish/v2/app-file-upload',
        body: {
          appId: config.identifiers?.appId ?? null,
          packageType: target.packageFormat === 'HAP' ? 'HARMONY' : 'ANDROID',
          track: config.release?.track,
          releaseType: config.release?.releaseType,
          countries: config.release?.countries ?? [],
        },
      };
    default:
      return { ...base, provider: 'unknown', method: 'POST', endpoint: '', body: {} };
  }
}
