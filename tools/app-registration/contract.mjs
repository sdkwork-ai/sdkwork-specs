#!/usr/bin/env node

/**
 * Registration contract: identities, deterministic idempotency keys, provision
 * body, and fail-closed configuration.
 *
 * Everything here is pure and synchronous, so the rules that decide *what* the
 * registrar asks Deploy and IAM for can be tested without a socket.
 *
 * # Identity model
 *
 * - The deploy application is the installation identity. Deploy mints both the
 *   BIGINT `id` and the `uuid` server side; `apps.retrieve` addresses the row by
 *   `uuid` (`deploy_app.uuid`), while IAM binds its installation through
 *   `iam_installation.deploy_application_id`, which Deploy's own identity
 *   provisioning port writes as the decimal BIGINT (`deploy_app.id`).
 * - The app API returns both on every list/retrieve/create/update response:
 *   `AppResponse.id` is the uuid and `AppResponse.deployApplicationId` is the
 *   decimal anchor (`sdkwork-deployments` commit `7471031`). The anchor is read
 *   from that field and never derived from the uuid or the slug.
 * - The public application access token carries that same anchor as `app_id` and
 *   `aud` (`access_token_issue.rs`: "the installation's deploy application id").
 *   The anchor is therefore never synthesized, never the slug, and never another
 *   surface's value.
 * - Because the two identifiers are different facts, every result records both:
 *   `deployApplicationUuid` (addressable on the app API) and
 *   `deployApplicationId` (the anchor IAM and the token carry).
 *
 * # Installation and environment model
 *
 * - One deploy application has one IAM installation: `uk_iam_application_installation_deploy`
 *   makes `iam_application_installation.deploy_application_id` one-to-one, and
 *   `provision_installation` reconciles deploy-application-first
 *   (`resolve_installation_by_deploy_application_id`). The deploy
 *   `uk_deploy_app_tenant_slug` slug is environment-independent, so the same
 *   repository registered for `development` and `production` keeps one deploy
 *   app, one anchor, and one installation.
 * - A lifecycle is **not** a second installation. It is one
 *   `iam_application_installation_environment` row under that installation
 *   (`env_key`, `primary_domain`, `env_status`), written through
 *   `PUT /backend/v3/api/iam/tenants/{tenantId}/installations/{installationId}/environments/{envKey}`.
 *   Token issuance then requires the requested environment's row to exist and be
 *   `active`; an installation whose rows it could not write must not be enabled.
 *
 * # Idempotency model
 *
 * - `apps.create` uses `Idempotency-Key: sdkwork-app-register:<environment>:<slug>`.
 *   The key and the body depend only on the app slug, the environment, and the
 *   app's own manifest fields, so a retry replays the first row instead of
 *   colliding on `uk_deploy_app_tenant_slug`.
 * - Every body-carrying command also sends `X-Content-SHA256` (lowercase hex
 *   SHA-256 of the exact request bytes). The idempotency middleware rejects a
 *   command with a body that omits it, so the `Idempotency-Key` alone is not a
 *   valid request.
 * - The installation-environment upsert uses
 *   `Idempotency-Key: sdkwork-app-register:env:<tenant>:<installation>:<envKey>`
 *   keyed by the row identity, so several surfaces of one installation converge
 *   on one row.
 * - `iam.installations.create` uses
 *   `provisioningIdempotencyKey = iam-bootstrap-<sha256(...)[0..40]>` over the
 *   same identity tuple the framework derives it from
 *   (`@sdkwork/iam-application-bootstrap` `deriveProvisioningIdempotencyKey`), so
 *   the registrar and the runtime bootstrap converge on one installation.
 *
 * @module app-registration/contract
 */

import { createHash } from 'node:crypto';

/** Environment variable that carries the registration anchor. */
export const DEPLOY_APPLICATION_ID_ENV = 'SDKWORK_DEPLOY_APPLICATION_ID';

/** Prefix of the deterministic `apps.create` idempotency key. */
export const DEPLOY_APP_CREATE_IDEMPOTENCY_KEY_PREFIX = 'sdkwork-app-register:';

/** Prefix of the deterministic IAM provisioning key (framework-compatible). */
export const IAM_PROVISIONING_IDEMPOTENCY_KEY_PREFIX = 'iam-bootstrap-';

/** Longest `Idempotency-Key` the deploy route accepts. */
export const DEPLOY_IDEMPOTENCY_KEY_MAX_LEN = 128;

/** Longest `primaryDomain` IAM stores (`iam_application_installation_environment.primary_domain`). */
export const PRIMARY_DOMAIN_MAX_LEN = 253;

/** Longest deploy application slug (`deploy_app.slug VARCHAR(120)`). */
export const DEPLOY_APP_SLUG_MAX_LEN = 120;

/** Longest deploy application name accepted by `apps.create`. */
export const DEPLOY_APP_NAME_MAX_LEN = 200;

/**
 * Product-semantic tenant-application types IAM provisioning accepts.
 *
 * This is the ten-value vocabulary of the IAM runtime and its
 * `@sdkwork/iam-application-bootstrap` framework (endpoint, not rendering
 * technology): the web surfaces, Flutter, the two mini-program providers, the
 * three native mobile kinds, desktop, API, and the `other` fallback. The
 * registrar sends the endpoint it proved, never a collapsed subset.
 */
export const IAM_TENANT_APPLICATION_TYPES = [
  'api',
  'h5',
  'pc',
  'flutter',
  'miniprogram',
  'ios',
  'android',
  'harmonyos',
  'desktop',
  'other',
];

/** Canonical registration environments. */
export const REGISTRATION_ENVIRONMENTS = [
  'development',
  'test',
  'staging',
  'demo',
  'production',
];

/** Environment aliases accepted on the command line. */
const ENVIRONMENT_ALIASES = new Map([
  ['dev', 'development'],
  ['local', 'development'],
  ['development', 'development'],
  ['test', 'test'],
  ['staging', 'staging'],
  ['demo', 'demo'],
  ['prod', 'production'],
  ['production', 'production'],
]);

/** Deployment profile that serves each environment when none is passed. */
const DEFAULT_DEPLOYMENT_PROFILE_BY_ENVIRONMENT = new Map([
  ['development', 'standalone'],
  ['test', 'standalone'],
  ['staging', 'cloud'],
  ['demo', 'cloud'],
  ['production', 'cloud'],
]);

/**
 * Required and optional environment variables per side.
 *
 * The Deploy names are the ones the shipped installer already reads
 * (`deploy_application.rs`), so one deployment configures both tools; the IAM
 * names are the canonical bootstrap-operator names from
 * `IAM_APPLICATION_BOOTSTRAP_SPEC` §5.2.
 */
export const REGISTRATION_SETTINGS_ENV = Object.freeze({
  deploy: Object.freeze({
    baseUrl: 'SDKWORK_DEPLOY_BACKEND_API_BASE_URL',
    accessToken: 'SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN',
    authToken: 'SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN',
    timeoutMs: 'SDKWORK_DEPLOY_BACKEND_TIMEOUT_MS',
  }),
  iam: Object.freeze({
    baseUrlCandidates: ['SDKWORK_IAM_BACKEND_API_BASE_URL', 'SDKWORK_BACKEND_BASE_URL'],
    authTokenCandidates: [
      'SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN',
      'SDKWORK_IAM_BOOTSTRAP_AUTH_TOKEN',
    ],
    usernameCandidates: [
      'SDKWORK_IAM_BOOTSTRAP_OPERATOR_USERNAME',
      'SDKWORK_IAM_BOOTSTRAP_USERNAME',
    ],
    passwordCandidates: [
      'SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD',
      'SDKWORK_IAM_BOOTSTRAP_PASSWORD',
    ],
    timeoutMs: 'SDKWORK_IAM_BACKEND_TIMEOUT_MS',
  }),
  tenantId: 'SDKWORK_TENANT_ID',
  organizationId: 'SDKWORK_ORGANIZATION_ID',
});

/**
 * Optional dual-token credentials for the IAM installation-management surface.
 *
 * `installations.environments.update` is a `dual-token` route, unlike the
 * bootstrap-body provision/enable routes, so the environment row cannot be
 * written with the operator body credentials. When these are absent the client
 * mints a session from the bootstrap operator username + password instead; when
 * neither exists the registrar fails the item before enabling an installation
 * whose environment row it could not write.
 */
export const IAM_MANAGEMENT_SETTINGS_ENV = Object.freeze({
  accessTokenCandidates: [
    'SDKWORK_IAM_MANAGEMENT_ACCESS_TOKEN',
    'SDKWORK_IAM_BACKEND_ACCESS_TOKEN',
  ],
  authTokenCandidates: [
    'SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN',
    'SDKWORK_IAM_BACKEND_AUTH_TOKEN',
    'SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN',
    'SDKWORK_IAM_BOOTSTRAP_AUTH_TOKEN',
  ],
});

/** Raised when registration cannot start because configuration is missing. */
export class RegistrationConfigurationError extends Error {
  /**
   * @param message - operator-facing message
   * @param details - structured detail (missing variables, offending values)
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'RegistrationConfigurationError';
    this.details = details;
  }
}

function trimToValue(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : '';
}

/**
 * Normalize a lifecycle environment name.
 * @param value - raw environment (`dev`, `prod`, `production`, ...)
 * @returns the canonical environment
 * @throws {RegistrationConfigurationError} when the value is not a lifecycle
 */
export function normalizeEnvironment(value) {
  const normalized = ENVIRONMENT_ALIASES.get(trimToValue(value).toLowerCase());
  if (!normalized) {
    throw new RegistrationConfigurationError(
      `unsupported environment ${JSON.stringify(String(value ?? ''))}; expected one of `
      + `${REGISTRATION_ENVIRONMENTS.join(', ')} (aliases: dev, local, prod)`,
      { value },
    );
  }
  return normalized;
}

/**
 * Deployment profile that serves one environment when none is requested.
 * @param environment - canonical environment
 * @returns `standalone` or `cloud`
 */
export function defaultDeploymentProfile(environment) {
  return DEFAULT_DEPLOYMENT_PROFILE_BY_ENVIRONMENT.get(normalizeEnvironment(environment));
}

/** Deploy application kinds (`deploy_app.app_kind`, Deploy's `AppKind` enum). */
export const DEPLOY_APP_KINDS = Object.freeze([
  'H5_WEB',
  'PC_WEB',
  'WECHAT_MINIPROGRAM',
  'DOUYIN_MINIPROGRAM',
  'FLUTTER_APP',
  'IOS_APP',
  'ANDROID_APP',
  'HARMONYOS_APP',
  'API_SERVICE',
  'DESKTOP_APP',
  'STATIC_WEB',
  'SPA_WEB',
]);

/**
 * Kinds a new registration may select.
 *
 * `SPA_WEB` is a retired rendering-model value: pre-existing rows may still
 * carry it, but a new registration MUST NOT produce it
 * (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §5).
 */
export const NEW_REGISTRATION_DEPLOY_APP_KINDS = Object.freeze(
  DEPLOY_APP_KINDS.filter((kind) => kind !== 'SPA_WEB'),
);

/** Manifest `app.appType` values (`PlusProjectType`, `APP_MANIFEST_SPEC.md` §4). */
export const MANIFEST_APP_TYPES = Object.freeze([
  'NONE',
  'SDK',
  'PPT',
  'APP_HTML',
  'APP_VUE',
  'APP_FLUTTER',
  'APP_UNIAPP',
  'APP_REACT',
  'APP_UNITY',
  'APP_HARMONY',
  'VIDEO',
  'POSTER',
]);

/**
 * IAM `applicationType` implied by one deploy kind.
 *
 * IAM's vocabulary names the endpoint the installation serves, the deploy kind is
 * the delivery shape; this table is the only place the two are related
 * (`IAM_APPLICATION_BOOTSTRAP_SPEC.md` §2.1). Both vocabularies carry the
 * mini-program, native-mobile, and desktop members, so the IAM leg keeps the
 * proven endpoint instead of collapsing to `other`/`pc`. The two legacy web kinds
 * cannot name one endpoint, so they keep IAM's `pc` web default.
 */
const IAM_APPLICATION_TYPE_BY_DEPLOY_KIND = Object.freeze({
  H5_WEB: 'h5',
  PC_WEB: 'pc',
  STATIC_WEB: 'pc',
  DESKTOP_APP: 'desktop',
  FLUTTER_APP: 'flutter',
  API_SERVICE: 'api',
  WECHAT_MINIPROGRAM: 'miniprogram',
  DOUYIN_MINIPROGRAM: 'miniprogram',
  IOS_APP: 'ios',
  ANDROID_APP: 'android',
  HARMONYOS_APP: 'harmonyos',
});

/**
 * Manifest `app.appType` a deploy kind forces, when the closed set has one.
 *
 * The closed set has no member for H5, PC, native mobile, or mini program
 * delivery (`APP_UNIAPP` covers uni-app only), so those kinds do not force a
 * value: the declared type cannot be proven wrong from the kind alone.
 */
const FORCED_MANIFEST_APP_TYPE_BY_DEPLOY_KIND = Object.freeze({
  FLUTTER_APP: 'APP_FLUTTER',
  HARMONYOS_APP: 'APP_HARMONY',
});

/** Client architecture family of each `publish.platforms` value. */
const PLATFORM_ARCHITECTURE = new Map([
  ['WEB', 'web'],
  ['H5', 'web'],
  ['H5_WEIXIN', 'web'],
  ['DESKTOP', 'desktop'],
  ['DESKTOP_WINDOWS', 'desktop'],
  ['DESKTOP_MACOS', 'desktop'],
  ['DESKTOP_LINUX', 'desktop'],
  ['WINDOWS', 'desktop'],
  ['MACOS', 'desktop'],
  ['LINUX', 'desktop'],
  ['MP', 'mini-program'],
  ['MP_WEIXIN', 'mini-program'],
  ['MP_ALIPAY', 'mini-program'],
  ['MP_BAIDU', 'mini-program'],
  ['MP_TOUTIAO', 'mini-program'],
  ['MP_LARK', 'mini-program'],
  ['MP_QQ', 'mini-program'],
  ['MP_KUAISHOU', 'mini-program'],
  ['MP_JD', 'mini-program'],
  ['MP_360', 'mini-program'],
  ['MP_DINGTALK', 'mini-program'],
  ['MP_ALI', 'mini-program'],
  ['MP_DOUYIN', 'mini-program'],
  ['MP_WEIXIN_GAME', 'mini-program'],
  ['MP_QQ_GAME', 'mini-program'],
  ['MP_BAIDU_GAME', 'mini-program'],
  ['MP_TOUTIAO_GAME', 'mini-program'],
  ['APP', 'mobile'],
  ['APP_PLUS', 'mobile'],
  ['APP_IOS', 'mobile'],
  ['APP_ANDROID', 'mobile'],
  ['APP_HARMONY', 'mobile'],
  ['IOS', 'mobile'],
  ['ANDROID', 'mobile'],
  ['HARMONYOS', 'mobile'],
  ['API', 'api'],
  ['OTHER', 'other'],
]);

/** Architecture families one deploy kind can deliver (`§5` platform matrix). */
const DEPLOY_KIND_ARCHITECTURES = Object.freeze({
  H5_WEB: ['web', 'mobile'],
  PC_WEB: ['web', 'desktop'],
  STATIC_WEB: ['web'],
  DESKTOP_APP: ['desktop'],
  FLUTTER_APP: ['mobile', 'web', 'desktop'],
  WECHAT_MINIPROGRAM: ['mini-program'],
  DOUYIN_MINIPROGRAM: ['mini-program'],
  IOS_APP: ['mobile'],
  ANDROID_APP: ['mobile'],
  HARMONYOS_APP: ['mobile'],
  API_SERVICE: ['api'],
});

/** Native application kinds of one App-target platform. */
const MOBILE_APP_KIND_BY_PLATFORM = Object.freeze({
  APP_IOS: 'IOS_APP',
  IOS: 'IOS_APP',
  APP_ANDROID: 'ANDROID_APP',
  ANDROID: 'ANDROID_APP',
  APP_HARMONY: 'HARMONYOS_APP',
  HARMONYOS: 'HARMONYOS_APP',
});

/** Frameworks whose delivery is a desktop host executable. */
const DESKTOP_HOST_FRAMEWORKS = new Set([
  'electron',
  'tauri',
  'react-tauri',
  'react-electron',
  'vue-tauri',
  'vue-electron',
]);

/** Frameworks that are a plain browser build, never a native package. */
const BROWSER_FRAMEWORKS = new Set([
  'react',
  'react-vite',
  'react-vite-h5',
  'react-pc',
  'react-workspace',
  'vue',
  'vue-vite',
  'next',
  'nuxt',
  'svelte',
  'angular',
  'web',
]);

/** Server runtimes; a root with these families is an API deployment, not a UI. */
const SERVER_RUNTIME_FAMILIES = new Set(['server', 'cli', 'library', 'plugin']);

/** `runtimeTarget` values that mean a browser artifact was built. */
const BROWSER_RUNTIME_TARGETS = new Set(['browser', 'web', 'h5', 'capacitor-ios', 'capacitor-android']);

/** `runtimeTarget` values that mean the Mobile/H5 lane rather than a PC browser. */
const H5_RUNTIME_TARGETS = new Set(['h5', 'capacitor-ios', 'capacitor-android']);

/** `runtimeTarget` values that mean a server-side artifact only. */
const SERVER_RUNTIME_TARGETS = new Set(['server', 'container']);

function asUpperList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => trimToValue(entry).toUpperCase())
    .filter((entry) => entry.length > 0);
}

function asLowerList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => trimToValue(entry).toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Resolve the deploy application kind and the IAM application type of one
 * application root from its manifest facts.
 *
 * The registrar MUST NOT infer the kind from `app.appType` alone (or from a
 * mapped `applicationType`): `APP_REACT` covers both an H5 and a PC root, and a
 * declared value can be stale or absent (a native mini program root has no
 * closed-set member). `APP_MANIFEST_SPEC.md` §6.1 makes `runtime.family`,
 * `runtime.framework`, `clientArchitectures`, and `publish.platforms` the surface
 * authority, so this function reads those facts, derives the IAM type from the
 * proven endpoint, and fails closed instead of defaulting.
 *
 * @param input - manifest surface facts
 * @param input.appType - declared `app.appType`
 * @param input.runtimeFamily - `runtime.family`
 * @param input.runtimeFramework - `runtime.framework`
 * @param input.clientArchitectures - `runtime.clientArchitectures`
 * @param input.publishPlatforms - `publish.platforms`
 * @param input.runtimeTargets - `artifacts.installConfig.packages[].runtimeTarget`
 * @returns the resolved kind/type, the forced app type, and every defect
 */
export function resolveDeployAppSurface(input = {}) {
  const appType = trimToValue(input.appType).toUpperCase();
  const family = trimToValue(input.runtimeFamily).toLowerCase();
  const framework = trimToValue(input.runtimeFramework).toLowerCase();
  const architectures = new Set(asLowerList(input.clientArchitectures));
  const platforms = new Set(asUpperList(input.publishPlatforms));
  const runtimeTargets = new Set(asLowerList(input.runtimeTargets));
  const defects = [];
  const notes = [];

  const hasArchitecture = (...names) => names.some((name) => architectures.has(name));
  const hasPlatform = (...names) => names.some((name) => platforms.has(name));
  const platformArchitectures = new Set(
    [...platforms]
      .map((platform) => PLATFORM_ARCHITECTURE.get(platform))
      .filter((architecture) => architecture !== undefined && architecture !== 'other'),
  );

  // The `runtime.framework` string is the decisive fact; `clientArchitectures`
  // corroborates it. Only a manifest that declares no framework falls back to the
  // architecture list, because a multi-surface repository lists every architecture
  // it ships (for example a web root whose `clientArchitectures` also mentions
  // flutter and mini-program) and must not be classified by the widest member.
  const frameworkDecides = framework !== '';
  const byFrameworkOrArchitecture = (name) => framework === name
    || (!frameworkDecides && hasArchitecture(name));

  const isFlutter = byFrameworkOrArchitecture('flutter');
  const isHarmonyNative = framework === 'harmony-native'
    || framework === 'arkts'
    || (!frameworkDecides && hasArchitecture('harmony-native'));
  const isAndroidNative = byFrameworkOrArchitecture('android-native');
  const isIosNative = byFrameworkOrArchitecture('ios-native');
  const isDesktopHost = DESKTOP_HOST_FRAMEWORKS.has(framework)
    || (!frameworkDecides && hasArchitecture('tauri', 'electron'));
  const isStaticWeb = framework === 'static-html'
    || (!frameworkDecides && hasArchitecture('static-web'));
  const isUniApp = framework === 'uni-app'
    || framework === 'uni-app-x'
    || (!frameworkDecides && hasArchitecture('uniapp', 'uniappx'));
  const miniProgramFramework = framework === 'mp-weixin'
    || framework.startsWith('mp-')
    || /(^|-)mini-program$/u.test(framework);
  const miniProgramDelivery = family === 'mini-program' || miniProgramFramework;
  const hasH5Evidence = framework === 'react-h5'
    || framework === 'react-capacitor'
    || framework === 'vue-h5'
    || framework === 'vue-capacitor'
    || hasArchitecture('h5', 'capacitor')
    || hasPlatform('H5', 'H5_WEIXIN')
    || [...runtimeTargets].some((target) => H5_RUNTIME_TARGETS.has(target));
  // An H5-only delivery is an H5 endpoint even when the manifest kept the coarse
  // `web` family: the declared delivery platform is more specific than the
  // family, and a root that also declares WEB is primarily the browser surface.
  const h5OnlyDelivery = hasPlatform('H5', 'H5_WEIXIN') && !hasPlatform('WEB');
  const browserTargeted = [...runtimeTargets].some((target) => BROWSER_RUNTIME_TARGETS.has(target));
  const serverTargetedOnly = runtimeTargets.size > 0
    && [...runtimeTargets].every((target) => SERVER_RUNTIME_TARGETS.has(target));

  const nativeMarkers = [
    isFlutter && 'flutter',
    isHarmonyNative && 'harmony-native',
    isAndroidNative && 'android-native',
    isIosNative && 'ios-native',
  ].filter(Boolean);
  if (nativeMarkers.length > 1) {
    defects.push(
      `runtime declares ${nativeMarkers.join(' and ')} at once; one manifest root is one endpoint `
      + 'surface, so split the implementations into their own roots',
    );
  }

  /** Mini program kind from the declared MP platform. */
  const miniProgramKind = () => {
    const declared = [...platforms].filter((platform) => platform.startsWith('MP_'));
    if (hasPlatform('MP_WEIXIN')) {
      return 'WECHAT_MINIPROGRAM';
    }
    if (hasPlatform('MP_DOUYIN')) {
      return 'DOUYIN_MINIPROGRAM';
    }
    if (declared.length > 0) {
      defects.push(
        `mini program platform ${declared.join(', ')} has no canonical deploy application kind; `
        + 'Deploy can represent WeChat and Douyin mini programs only',
      );
      return '';
    }
    defects.push(
      'a mini program root must declare its delivery platform (MP_WEIXIN or MP_DOUYIN) in '
      + 'publish.platforms so the deploy application kind can be resolved',
    );
    return '';
  };

  let deployAppKind = '';
  let source = '';

  if (defects.length === 0) {
    if (isFlutter) {
      deployAppKind = 'FLUTTER_APP';
      source = 'runtime.framework=flutter';
    } else if (isHarmonyNative) {
      deployAppKind = 'HARMONYOS_APP';
      source = 'runtime.framework=harmony-native';
    } else if (isAndroidNative && isIosNative) {
      defects.push(
        'runtime declares both android-native and ios-native; a native mobile root is one '
        + 'platform surface, so split Android and iOS into their own roots',
      );
    } else if (isAndroidNative) {
      deployAppKind = 'ANDROID_APP';
      source = 'runtime.framework=android-native';
    } else if (isIosNative) {
      deployAppKind = 'IOS_APP';
      source = 'runtime.framework=ios-native';
    } else if (miniProgramDelivery) {
      deployAppKind = miniProgramKind();
      source = 'publish.platforms=MP_*';
    } else if (isUniApp) {
      const declared = [...platforms].filter((platform) => platform.startsWith('APP_'));
      const kinds = [...new Set(declared.map((platform) => MOBILE_APP_KIND_BY_PLATFORM[platform]))];
      if (kinds.length > 1) {
        defects.push(
          `uni-app delivers ${declared.join(', ')} in one root; each of those platforms is its own `
          + 'deploy application surface, so split them into separate application roots',
        );
      } else if (kinds.length === 1 && kinds[0]) {
        deployAppKind = kinds[0];
        source = `publish.platforms=${declared.join(',')}`;
      } else if (hasPlatform('H5', 'H5_WEIXIN')) {
        deployAppKind = 'H5_WEB';
        source = 'publish.platforms=H5';
      } else if (hasPlatform('WEB')) {
        deployAppKind = 'PC_WEB';
        source = 'publish.platforms=WEB';
      } else {
        defects.push(
          'a uni-app root must declare its delivery surface (MP_*, APP_*, H5, or WEB) in '
          + 'publish.platforms',
        );
      }
    } else if (isStaticWeb) {
      deployAppKind = 'STATIC_WEB';
      source = 'runtime.framework=static-html';
    } else if (isDesktopHost) {
      deployAppKind = 'DESKTOP_APP';
      source = 'runtime.framework=desktop host';
    } else if (
      hasH5Evidence
      && (
        family === 'mobile'
        || family === ''
        || framework.includes('h5')
        || framework.includes('capacitor')
        || h5OnlyDelivery
      )
    ) {
      deployAppKind = 'H5_WEB';
      source = hasArchitecture('h5') || framework.includes('h5')
        ? 'runtime.framework=h5'
        : 'publish.platforms/runtimeTargets=H5|browser';
    } else if (family === 'web') {
      deployAppKind = BROWSER_FRAMEWORKS.has(framework) || framework === ''
        ? 'PC_WEB'
        : serverTargetedOnly
          ? 'API_SERVICE'
          : 'PC_WEB';
      source = deployAppKind === 'API_SERVICE'
        ? 'runtime.family=web with server-only runtime targets'
        : 'runtime.family=web';
    } else if (family === 'desktop') {
      deployAppKind = hasPlatform('WEB') || browserTargeted ? 'PC_WEB' : 'DESKTOP_APP';
      source = deployAppKind === 'PC_WEB' ? 'runtime.family=desktop + WEB' : 'runtime.family=desktop';
    } else if (SERVER_RUNTIME_FAMILIES.has(family)) {
      deployAppKind = 'API_SERVICE';
      source = `runtime.family=${family}`;
    } else if (family === 'mobile') {
      deployAppKind = 'H5_WEB';
      source = 'runtime.family=mobile without a native framework';
      notes.push(
        'runtime.family=mobile declares no native framework (android-native, ios-native, '
        + 'harmony-native, flutter); the root is registered as an H5 delivery — declare the '
        + 'framework to make the surface explicit',
      );
    } else {
      defects.push(
        `cannot derive the deploy application kind: runtime.family=${JSON.stringify(family)} and `
        + `runtime.framework=${JSON.stringify(framework)} match no surface. Declare the manifest `
        + 'runtime metadata per APP_MANIFEST_SPEC.md §6.1 or pass --deploy-app-kind explicitly',
      );
    }
  }

  if (deployAppKind) {
    const accepted = DEPLOY_KIND_ARCHITECTURES[deployAppKind] ?? [];
    const foreign = [...platformArchitectures].filter((architecture) => !accepted.includes(architecture));
    if (foreign.length > 0) {
      const article = /^[AEIOU]/u.test(deployAppKind) ? 'an' : 'a';
      notes.push(
        `publish.platforms also declares ${[...platforms]
          .filter((platform) => foreign.includes(PLATFORM_ARCHITECTURE.get(platform)))
          .join(', ')}; ${article} ${deployAppKind} deploy application serves `
        + `${accepted.join('/')} only — the other surface needs its own deploy application`,
      );
    }
  }

  // Only a kind whose closed-set member is unambiguous forces the declared type.
  // Mini program delivery has no member of its own (`APP_UNIAPP` covers a uni-app
  // project, not a native WXML root), so a wrong mini program `appType` is a
  // warning, not a proven contradiction.
  const canonicalAppType = FORCED_MANIFEST_APP_TYPE_BY_DEPLOY_KIND[deployAppKind]
    ?? (isUniApp && deployAppKind !== '' ? 'APP_UNIAPP' : '');
  const applicationType = IAM_APPLICATION_TYPE_BY_DEPLOY_KIND[deployAppKind] ?? '';
  const appTypeWarning = appType === ''
    || appType === 'NONE'
    || !MANIFEST_APP_TYPES.includes(appType);
  if (appTypeWarning) {
    notes.push(
      `app.appType=${JSON.stringify(appType)} is not a client application type; the surface is `
      + 'classified from the runtime facts, but catalog/store projection reads app.appType — set it '
      + `to one of ${MANIFEST_APP_TYPES.join('|')} that matches the surface`,
    );
  }

  return {
    deployAppKind,
    deployAppKindSource: source,
    applicationType,
    canonicalAppType,
    appTypeDeclared: appType,
    appTypeWarning,
    defects,
    notes,
  };
}

/**
 * Lowercase DNS-label form of an application key or name.
 * @param value - candidate slug source
 * @returns the slug, possibly empty when the value has no ASCII alphanumeric
 */
export function slugifyAppKey(value) {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '');
  return slug.slice(0, DEPLOY_APP_SLUG_MAX_LEN).replace(/-+$/u, '');
}

/**
 * Deterministic deploy slug for one application root.
 *
 * The manifest identity wins (`app.key`, then `app.name`), and the directory
 * name is the fallback. Two application roots that would derive the same slug
 * (a fork that kept its upstream key) are disambiguated with the repository
 * name, so the plan is stable and two apps never fight over
 * `uk_deploy_app_tenant_slug`.
 * @param entry - inventory entry (`appKey`, `appName`, `slug`, `repo`, `id`)
 * @param allEntries - every inventory entry taking part in this run
 * @returns the slug and how it was derived
 */
export function resolveDeploySlug(entry, allEntries) {
  const directorySlug = slugifyAppKey(
    entry.appDir && entry.appDir !== '.' ? entry.appDir.split(/[\\/]/u).pop() : entry.repo,
  );
  const base = slugifyAppKey(entry.appKey) || slugifyAppKey(entry.appName) || directorySlug;
  if (!base) {
    throw new RegistrationConfigurationError(
      `${entry.id}: cannot derive a deploy application slug from app.key=${JSON.stringify(entry.appKey)} `
      + `or app.name=${JSON.stringify(entry.appName)}; set app.key in agent.app.config.json`,
      { entry: entry.id },
    );
  }
  const collisions = (allEntries ?? []).filter((candidate) => {
    const candidateDirectorySlug = slugifyAppKey(
      candidate.appDir && candidate.appDir !== '.'
        ? candidate.appDir.split(/[\\/]/u).pop()
        : candidate.repo,
    );
    const candidateBase = slugifyAppKey(candidate.appKey) || slugifyAppKey(candidate.appName)
      || candidateDirectorySlug;
    return candidateBase === base && candidate.id !== entry.id;
  });
  if (collisions.length === 0) {
    return { slug: base, slugSource: 'app.key', disambiguated: false };
  }
  const repoSlug = slugifyAppKey(entry.repo);
  const qualified = `${repoSlug}-${base}`.slice(0, DEPLOY_APP_SLUG_MAX_LEN).replace(/-+$/u, '');
  return { slug: qualified, slugSource: 'repo+app.key', disambiguated: true };
}

/**
 * Deterministic `apps.create` `Idempotency-Key`.
 *
 * One key per (environment, slug): a retry after a timeout replays the first row
 * rather than creating a second application, and a different app never shares a
 * key because the slug is unique in the tenant.
 * @param environment - canonical environment
 * @param slug - deploy application slug
 * @returns the idempotency key, within the route's 128-character limit
 */
export function deployAppCreateIdempotencyKey(environment, slug) {
  const key = `${DEPLOY_APP_CREATE_IDEMPOTENCY_KEY_PREFIX}${environment}:${slug}`;
  if (key.length <= DEPLOY_IDEMPOTENCY_KEY_MAX_LEN) {
    return key;
  }
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return `${DEPLOY_APP_CREATE_IDEMPOTENCY_KEY_PREFIX}${environment}:${digest}`;
}

/**
 * Stable per-installation instance key, mirroring the embedded and Node bootstrap.
 * @param anchor - deploy application anchor
 * @param environment - canonical environment
 * @returns the derived instance key
 */
export function tenantApplicationInstanceKey(anchor, environment) {
  const normalized = trimToValue(anchor).replace(/-/gu, '_');
  const lifecycle = normalizeEnvironment(environment);
  if (lifecycle === 'development') {
    return `${normalized}_dev`;
  }
  if (lifecycle === 'production') {
    return `${normalized}_prod`;
  }
  return `${normalized}_${lifecycle.replace(/-/gu, '_')}`;
}

/**
 * Expand `{env}` / `{slug}` placeholders in a `--primary-domain` pattern.
 *
 * The placeholder set is closed on purpose: an unknown token is a typo that
 * would otherwise reach IAM as a literal domain label.
 * @param pattern - authored pattern, e.g. `im.{env}.sdkwork.com`
 * @param values - canonical environment and the deploy slug
 * @returns the expanded value
 * @throws {RegistrationConfigurationError} on an unknown placeholder or empty slug use
 */
export function expandPrimaryDomainPattern(pattern, values = {}) {
  const raw = trimToValue(pattern);
  if (!raw) {
    throw new RegistrationConfigurationError('--primary-domain pattern is empty');
  }
  return raw.replace(/\{([a-zA-Z0-9_-]+)\}/gu, (match, token) => {
    if (token === 'env') {
      return normalizeEnvironment(values.environment);
    }
    if (token === 'slug') {
      const slug = trimToValue(values.slug);
      if (!slug) {
        throw new RegistrationConfigurationError(
          `--primary-domain pattern ${JSON.stringify(raw)} uses {slug}, but this item has no deploy `
          + 'slug yet; fix the manifest identity before using the placeholder',
        );
      }
      return slug;
    }
    throw new RegistrationConfigurationError(
      `--primary-domain pattern ${JSON.stringify(raw)} uses unsupported placeholder ${match}; only `
      + '{env} and {slug} are substituted',
    );
  });
}

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

/**
 * Normalize an authored domain into the absolute hostname IAM stores.
 *
 * IAM's `normalize_primary_domain`
 * (`crates/sdkwork-iam-web-adapter/src/installation_lifecycle.rs:352`) accepts any
 * non-blank value without whitespace or a wildcard, and lowercases it; the
 * installation environment table additionally treats the value as an absolute
 * host. A manifest `accessUrl` is a URL (`http://127.0.0.1:4734`), so the scheme,
 * port, path, query, userinfo, and trailing dot are removed here — a URL stored
 * verbatim would become a domain no host can match.
 * @param raw - authored value (URL or hostname)
 * @param label - who supplied it (for the diagnostic)
 * @returns the lowercase hostname
 * @throws {RegistrationConfigurationError} when the value is not an absolute hostname
 */
export function normalizePrimaryDomain(raw, label = 'primaryDomain') {
  const authored = trimToValue(raw);
  const invalid = (reason) =>
    new RegistrationConfigurationError(
      `${label}=${JSON.stringify(authored)} is not an absolute hostname (${reason}); IAM stores the `
      + 'installation environment domain verbatim, and enable refuses an installation without one',
      { value: authored, label },
    );
  if (!authored) {
    throw invalid('the value is blank');
  }
  let host = authored;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(host)) {
    let parsed;
    try {
      parsed = new URL(host);
    } catch {
      throw invalid('not a parseable absolute URL');
    }
    host = parsed.hostname;
  } else if (host.startsWith('//')) {
    try {
      host = new URL(`http:${host}`).hostname;
    } catch {
      throw invalid('not a parseable scheme-relative URL');
    }
  }
  host = host.split('/')[0].split('?')[0].split('#')[0];
  const userinfo = host.lastIndexOf('@');
  if (userinfo >= 0) {
    host = host.slice(userinfo + 1);
  }
  if (host.startsWith('[')) {
    throw invalid('an IPv6 literal is not a hostname IAM can store');
  }
  const port = host.lastIndexOf(':');
  if (port >= 0) {
    host = host.slice(0, port);
  }
  host = host.trim().toLowerCase().replace(/\.+$/u, '');
  if (!host) {
    throw invalid('no host component');
  }
  if (host.length > PRIMARY_DOMAIN_MAX_LEN) {
    throw invalid(`longer than ${PRIMARY_DOMAIN_MAX_LEN} characters`);
  }
  if (/[\s*]/u.test(host)) {
    throw invalid('contains whitespace or a wildcard');
  }
  for (const labelPart of host.split('.')) {
    if (labelPart.length === 0 || labelPart.length > 63 || !HOSTNAME_LABEL.test(labelPart)) {
      throw invalid(`label ${JSON.stringify(labelPart)} is not a DNS label`);
    }
  }
  return host;
}

/** Sources a primary domain is read from, highest precedence first. */
export const PRIMARY_DOMAIN_SOURCES = Object.freeze([
  '--primary-domain',
  'environments.<environment>.accessUrl',
  'environments.<environment>.deployUrl',
  'backend.primaryDomain',
  'backend.domain',
]);

/**
 * Resolve one item's primary domain.
 *
 * Precedence: the `--primary-domain` pattern (`{env}`/`{slug}` expanded), then the
 * lifecycle `accessUrl`, then `deployUrl`, then the manifest-wide
 * `backend.primaryDomain`, then `backend.domain`. An authored value that is
 * present but invalid fails the item instead of falling through: silently using a
 * lower-precedence domain would anchor the installation to a host nobody
 * intended.
 * @param input - entry, environment, slug, and the optional CLI pattern
 * @returns the hostname, its source, and every source that was consulted
 * @throws {RegistrationConfigurationError} when a present source is not a hostname
 */
export function resolvePrimaryDomain(input = {}) {
  const environment = normalizeEnvironment(input.environment);
  const entry = input.entry ?? {};
  const section = entry.environments?.[environment] ?? {};
  const pattern = trimToValue(input.pattern);
  const candidates = [];
  if (pattern) {
    candidates.push({
      source: '--primary-domain',
      value: expandPrimaryDomainPattern(pattern, { environment, slug: input.slug }),
    });
  }
  candidates.push({
    source: `environments.${environment}.accessUrl`,
    value: section.accessUrl,
  });
  candidates.push({
    source: `environments.${environment}.deployUrl`,
    value: section.deployUrl,
  });
  candidates.push({ source: 'backend.primaryDomain', value: entry.backendPrimaryDomain });
  candidates.push({ source: 'backend.domain', value: entry.backendDomain });
  const checked = candidates.map((candidate) => candidate.source);
  for (const candidate of candidates) {
    if (!trimToValue(candidate.value)) {
      continue;
    }
    return {
      domain: normalizePrimaryDomain(candidate.value, candidate.source),
      source: candidate.source,
      checked,
    };
  }
  return { domain: '', source: '', checked };
}

/**
 * Deterministic `Idempotency-Key` for one installation-environment upsert.
 *
 * Keyed by the row identity (`installation`, `env_key`), not by the surface: a
 * repository whose several surfaces map to one installation must not create a
 * second row per surface, and a retry after a timeout must replay the first.
 * @param tenantId - tenant scope
 * @param installationId - IAM installation id
 * @param envKey - canonical environment key
 * @returns the idempotency key, within the route's 128-character limit
 */
export function environmentUpsertIdempotencyKey(tenantId, installationId, envKey) {
  const key = `sdkwork-app-register:env:${trimToValue(tenantId)}:${trimToValue(installationId)}:`
    + `${trimToValue(envKey)}`;
  if (key.length <= DEPLOY_IDEMPOTENCY_KEY_MAX_LEN) {
    return key;
  }
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return `sdkwork-app-register:env:${digest}`;
}

/**
 * Deterministic IAM provisioning idempotency key.
 *
 * Byte-compatible with `@sdkwork/iam-application-bootstrap`
 * `deriveProvisioningIdempotencyKey`: `sha256` over the same six newline-joined
 * fields, truncated to 40 hex characters. Re-running either implementation
 * therefore reconciles one installation.
 * @param command - provisioning identity tuple
 * @returns `iam-bootstrap-<digest>`
 */
export function deriveProvisioningIdempotencyKey(command) {
  const identity = [
    command.tenantId,
    command.organizationId,
    command.deployApplicationId,
    command.applicationType,
    command.instanceKey,
    command.environment,
  ]
    .map((value) => trimToValue(value))
    .join('\n');
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 40);
  return `${IAM_PROVISIONING_IDEMPOTENCY_KEY_PREFIX}${digest}`;
}

/**
 * Refuse anything that is not a decimal application id.
 *
 * The anchor reaches a URL segment, an IAM link column, and a token claim; a
 * uuid, a slug, a blank, or a newline in that position silently binds an
 * installation to the wrong identity.
 * @param value - candidate anchor
 * @param label - who supplied it (for the diagnostic)
 * @returns the normalized decimal anchor
 * @throws {RegistrationConfigurationError} when the value is not decimal digits
 */
export function assertDeployApplicationAnchor(value, label = DEPLOY_APPLICATION_ID_ENV) {
  const anchor = trimToValue(value);
  if (!anchor) {
    throw new RegistrationConfigurationError(
      `${label} is empty; expected the decimal deploy application id`,
      { value },
    );
  }
  if (!/^[0-9]+$/u.test(anchor)) {
    throw new RegistrationConfigurationError(
      `${label}=${JSON.stringify(anchor)} is not a deploy application id: the anchor is the `
      + 'decimal `deploy_app.id` IAM binds (`deploy_application_id`) and that every access token '
      + 'carries as `app_id`/`aud`. A uuid or slug in this position binds the installation to a '
      + 'different identity than the deploy row that owns it.',
      { value: anchor },
    );
  }
  return anchor;
}

/**
 * Refuse anything that is not one URL path segment / identity value.
 *
 * Used for the `deploy-application-uuid` anchor kind, where the deployment binds
 * the addressable uuid on purpose. The value still reaches a URL segment and a
 * token claim, so it must not carry `/`, `?`, `#`, `%`, whitespace, or control
 * characters.
 * @param value - candidate anchor
 * @param label - who supplied it (for the diagnostic)
 * @returns the normalized anchor
 * @throws {RegistrationConfigurationError} when the value is not one segment
 */
export function assertDeployApplicationUuid(value, label = DEPLOY_APPLICATION_ID_ENV) {
  const anchor = trimToValue(value);
  if (!anchor) {
    throw new RegistrationConfigurationError(
      `${label} is empty; expected the deploy application uuid`,
      { value },
    );
  }
  if (anchor.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(anchor)) {
    throw new RegistrationConfigurationError(
      `${label}=${JSON.stringify(anchor)} is not a single application identity segment `
      + "(allowed: ascii letters, digits, '-', '_', '.', ':' up to 128 characters)",
      { value: anchor },
    );
  }
  return anchor;
}

/**
 * Validate an anchor against the selected anchor kind.
 * @param value - candidate anchor
 * @param label - who supplied it (for the diagnostic)
 * @param anchorKind - `deploy-application-id` (decimal) or `deploy-application-uuid`
 * @returns the normalized anchor
 * @throws {RegistrationConfigurationError} when the value does not match the kind
 */
export function assertDeployApplicationIdForKind(value, label, anchorKind) {
  return anchorKind === 'deploy-application-uuid'
    ? assertDeployApplicationUuid(value, label)
    : assertDeployApplicationAnchor(value, label);
}

/**
 * Deterministic `apps.create` body.
 *
 * Every persisted field is derived from the application identity only, so a
 * retried create produces the same `request_sha256` and replays the recorded row
 * instead of being rejected as "key reused with a different body".
 *
 * `appKind` is required and MUST come from {@link resolveDeployAppSurface}. The
 * retired fallback (`API_SERVICE`) is deliberately gone: it silently registered
 * every surface the old mapping did not know (Flutter, mini program, native
 * mobile, HarmonyOS) as an API service.
 * @param input - slug plus manifest identity
 * @returns the request body
 * @throws {RegistrationConfigurationError} when the kind is missing or not a deploy kind
 */
export function buildDeployAppCreateBody(input) {
  const slug = trimToValue(input.slug);
  if (!slug) {
    throw new RegistrationConfigurationError('deploy application slug is required to create an app');
  }
  const appKind = trimToValue(input.appKind).toUpperCase();
  if (!appKind) {
    throw new RegistrationConfigurationError(
      'appKind is required to create a deploy application; resolve it from the manifest surface '
      + 'facts with resolveDeployAppSurface (runtime.family/framework, clientArchitectures, '
      + 'publish.platforms) instead of relying on a default',
      { slug },
    );
  }
  if (!NEW_REGISTRATION_DEPLOY_APP_KINDS.includes(appKind)) {
    throw new RegistrationConfigurationError(
      `appKind=${JSON.stringify(input.appKind)} is not a deploy application kind a new registration `
      + `may select; expected one of ${NEW_REGISTRATION_DEPLOY_APP_KINDS.join('|')} `
      + '(SPA_WEB is legacy-only)',
      { slug, appKind },
    );
  }
  const name = (
    trimToValue(input.displayName)
    || trimToValue(input.name)
    || slug
  ).slice(0, DEPLOY_APP_NAME_MAX_LEN);
  const body = {
    name,
    slug,
    appKind,
  };
  const ownerType = trimToValue(input.ownerType).toUpperCase();
  if (ownerType) {
    if (!['PLATFORM', 'TENANT', 'ORGANIZATION', 'USER'].includes(ownerType)) {
      throw new RegistrationConfigurationError(
        `ownerType=${JSON.stringify(input.ownerType)} is not PLATFORM, TENANT, ORGANIZATION, or USER`,
      );
    }
    body.ownerType = ownerType;
  }
  const environment = trimToValue(input.environment).toLowerCase();
  if (environment) {
    body.defaultEnvironment = environment.slice(0, 16);
  }
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : null;
  if (metadata) {
    body.metadata = metadata;
  }
  return body;
}

/**
 * Verify an existing deploy application row still carries the resolved kind.
 *
 * `app_kind` is immutable (`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §5): a row
 * created by an older registration whose surface was mis-detected cannot be
 * repaired in place. The registrar therefore fails closed with the corrective
 * action instead of adopting the wrong row and wiring a token to it.
 * @param item - deploy application item (`readDeployAppItem` output)
 * @param expectedKind - kind resolved from the manifest
 * @param label - operator-facing item label
 * @returns `''` when the row agrees or cannot be proven, else a defect message
 */
export function verifyDeployAppKind(item, expectedKind, label = 'application') {
  const stored = trimToValue(item?.appKind).toUpperCase();
  const expected = trimToValue(expectedKind).toUpperCase();
  if (!stored || !expected || stored === expected) {
    return '';
  }
  return `${label}: deploy application ${JSON.stringify(item?.slug || item?.uuid || '')} is stored as `
    + `${stored}, but the manifest surface resolves to ${expected}. app_kind is immutable, so an `
    + 'existing row cannot be corrected in place: archive that draft row (it has no release yet) '
    + 'and re-run the registration, or restore the manifest to the surface the row was created '
    + 'with';
}

/**
 * IAM application type implied by one deploy kind.
 *
 * Used when an operator resolves an ambiguous surface with an explicit
 * `--deploy-app-kind` override, so the IAM provisioning type still follows the
 * deploy kind instead of an unrelated declared value.
 * @param deployAppKind - deploy `AppKind`
 * @returns the IAM application type, or `''` when the kind is unknown
 */
export function applicationTypeForDeployKind(deployAppKind) {
  return IAM_APPLICATION_TYPE_BY_DEPLOY_KIND[trimToValue(deployAppKind).toUpperCase()] ?? '';
}

/**
 * Default `runtime_target` claim for a public application token of one deploy
 * kind (`APP_ACCESS_TOKEN_SPEC.md` §3.2).
 *
 * The value describes the artifact the surface ships, not the endpoint kind, and
 * a surface's own declaration (`etc/client-env.materialization.json`
 * `runtimeTarget`) always wins over this table. Kinds whose store target is not
 * implied by the kind itself return `''` so a caller must name it — a Flutter
 * token must say which store build it belongs to, and a native iOS/Android root
 * must name its target rather than inheriting a Web claim.
 * @param deployAppKind - deploy `AppKind`
 * @returns the default runtime target, or `''` when it must be supplied
 */
export function defaultRuntimeTargetForDeployKind(deployAppKind) {
  switch (trimToValue(deployAppKind).toUpperCase()) {
    case 'H5_WEB':
    case 'PC_WEB':
    case 'STATIC_WEB':
      return 'browser';
    case 'WECHAT_MINIPROGRAM':
    case 'DOUYIN_MINIPROGRAM':
      return 'mini-program';
    case 'HARMONYOS_APP':
      return 'harmony-native';
    case 'DESKTOP_APP':
      return 'desktop';
    case 'API_SERVICE':
      return 'server';
    default:
      return '';
  }
}

/**
 * Surface tokens an application directory name may encode.
 *
 * This is a consistency check, not a classifier: a root named
 * `sdkwork-<product>-flutter-mobile` whose manifest claims a server runtime (the
 * usual symptom of a surface manifest copied from the repository root) is called
 * out instead of being registered under the wrong kind without a trace.
 */
const DIRECTORY_SURFACE_KINDS = Object.freeze([
  { token: 'flutter', kinds: ['FLUTTER_APP'] },
  { token: 'harmony', kinds: ['HARMONYOS_APP'] },
  { token: 'mini-program', kinds: ['WECHAT_MINIPROGRAM', 'DOUYIN_MINIPROGRAM'] },
  { token: 'miniprogram', kinds: ['WECHAT_MINIPROGRAM', 'DOUYIN_MINIPROGRAM'] },
  { token: 'uniapp', kinds: ['WECHAT_MINIPROGRAM', 'DOUYIN_MINIPROGRAM', 'H5_WEB', 'PC_WEB', 'ANDROID_APP', 'IOS_APP'] },
  { token: 'h5', kinds: ['H5_WEB'] },
  { token: 'pc', kinds: ['PC_WEB', 'DESKTOP_APP'] },
  { token: 'web', kinds: ['PC_WEB', 'H5_WEB', 'STATIC_WEB'] },
  { token: 'desktop', kinds: ['DESKTOP_APP'] },
  { token: 'ios', kinds: ['IOS_APP', 'FLUTTER_APP'] },
  { token: 'android', kinds: ['ANDROID_APP', 'FLUTTER_APP'] },
]);

/**
 * Warn when the application directory name and the resolved kind disagree.
 * @param appDir - application directory (relative or a bare name)
 * @param deployAppKind - kind resolved from the manifest surface
 * @returns the warning, or `''` when they agree or the name names no surface
 */
export function describeSurfaceNameMismatch(appDir, deployAppKind) {
  const kind = trimToValue(deployAppKind).toUpperCase();
  if (!kind) {
    return '';
  }
  const name = trimToValue(appDir).toLowerCase().replace(/[\\/]+$/u, '');
  const base = name.split(/[\\/]/u).pop() ?? '';
  if (!base || base === '.') {
    return '';
  }
  const segments = base.split(/[^a-z0-9]+/u).filter(Boolean);
  for (const entry of DIRECTORY_SURFACE_KINDS) {
    const present = entry.token.includes('-')
      ? base.includes(entry.token)
      : segments.includes(entry.token);
    if (present && !entry.kinds.includes(kind)) {
      return `the application directory ${JSON.stringify(base)} names a ${entry.token} surface, `
        + `but the manifest surface resolves to ${kind}; the manifest runtime facts and the root `
        + 'identity disagree, so verify the surface manifest before releasing this application';
    }
  }
  return '';
}

/**
 * Replace `app.appType` in an authored manifest while preserving its formatting.
 *
 * The registrar never edits a manifest implicitly. This helper exists for the
 * explicit `--fix-app-types` repair: the declared type contradicts the surface
 * the runtime facts prove (for example `APP_HTML` on a Flutter root), and the
 * operator asked for the derivation to be written back. Only the `appType`
 * string token inside the top-level `app` object is rewritten, so key order,
 * indentation, and every unrelated authored value survive byte-for-byte; the
 * result is re-parsed and compared before it is returned.
 * @param manifestText - authored `agent.app.config.json` text
 * @param nextAppType - canonical `app.appType` to write
 * @returns the new text and the previous value, or `null` when it cannot be patched
 */
export function replaceManifestAppType(manifestText, nextAppType) {
  const source = String(manifestText ?? '');
  const expected = trimToValue(nextAppType).toUpperCase();
  if (!source || !expected) {
    return null;
  }
  const appMatch = /"app"\s*:\s*\{/u.exec(source);
  if (!appMatch) {
    return null;
  }
  const appStart = appMatch.index + appMatch[0].length - 1;
  let depth = 0;
  let appEnd = -1;
  let inString = false;
  let escaped = false;
  for (let index = appStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        appEnd = index + 1;
        break;
      }
    }
  }
  if (appEnd < 0) {
    return null;
  }
  const appSlice = source.slice(appStart, appEnd);
  const typeMatch = /("appType"\s*:\s*")([^"\\]*)(")/u.exec(appSlice);
  if (!typeMatch) {
    return null;
  }
  const previous = typeMatch[2];
  const patchedSlice = appSlice.slice(0, typeMatch.index)
    + typeMatch[1]
    + expected
    + typeMatch[3]
    + appSlice.slice(typeMatch.index + typeMatch[0].length);
  const patched = source.slice(0, appStart) + patchedSlice + source.slice(appEnd);
  try {
    const before = JSON.parse(source.replace(/^\uFEFF/u, ''));
    const after = JSON.parse(patched.replace(/^\uFEFF/u, ''));
    if (after?.app?.appType !== expected || before?.app?.appType !== previous) {
      return null;
    }
    const expectedObject = JSON.parse(JSON.stringify(before));
    expectedObject.app.appType = expected;
    if (JSON.stringify(expectedObject) !== JSON.stringify(after)) {
      return null;
    }
  } catch {
    return null;
  }
  return { text: patched, previous };
}

/**
 * Build the IAM `installations.create` body.
 *
 * The bootstrap operator credentials travel in the body (that is the route's
 * declared auth mode), and the anchor is the deploy application id — never the
 * manifest's runtime `backend.appId` fallback, which is the retired identity the
 * token must not carry.
 * @param input - anchor, application identity, tenant scope, and operator auth
 * @returns the request body
 */
export function buildInstallationProvisionBody(input) {
  const anchorKind = trimToValue(input.anchorKind) || 'deploy-application-id';
  if (!['deploy-application-id', 'deploy-application-uuid'].includes(anchorKind)) {
    throw new RegistrationConfigurationError(
      `unsupported anchorKind ${JSON.stringify(input.anchorKind)}`,
    );
  }
  const deployApplicationId = assertDeployApplicationIdForKind(
    input.deployApplicationId,
    DEPLOY_APPLICATION_ID_ENV,
    anchorKind,
  );
  const applicationType = trimToValue(input.applicationType).toLowerCase();
  if (!IAM_TENANT_APPLICATION_TYPES.includes(applicationType)) {
    throw new RegistrationConfigurationError(
      `applicationType=${JSON.stringify(input.applicationType)} is not a tenant application type `
      + `(expected one of ${IAM_TENANT_APPLICATION_TYPES.join('|')})`,
    );
  }
  const environment = normalizeEnvironment(input.environment);
  const tenantId = trimToValue(input.tenantId);
  const organizationId = trimToValue(input.organizationId);
  if (!tenantId) {
    throw new RegistrationConfigurationError(
      'tenantId is required to provision a tenant application',
    );
  }
  if (!organizationId) {
    throw new RegistrationConfigurationError(
      'organizationId is required to provision a tenant application',
    );
  }
  const instanceKey = trimToValue(input.instanceKey)
    || tenantApplicationInstanceKey(deployApplicationId, environment);
  const command = {
    deployApplicationId,
    applicationType,
    tenantId,
    organizationId,
    instanceKey,
    displayName: (trimToValue(input.displayName) || trimToValue(input.appKey) || instanceKey)
      .slice(0, 200),
    environment,
    provisioningIdempotencyKey: trimToValue(input.provisioningIdempotencyKey)
      || deriveProvisioningIdempotencyKey({
        tenantId,
        organizationId,
        deployApplicationId,
        applicationType,
        instanceKey,
        environment,
      }),
  };
  if (Array.isArray(input.accessPermissions)) {
    // An empty array is an explicit "no API scope" choice (IAM_APPLICATION_BOOTSTRAP_SPEC §4)
    // and must survive as-is rather than fall back to a default.
    command.accessPermissions = input.accessPermissions.filter(
      (entry) => typeof entry === 'string' && entry.trim().length > 0,
    );
  } else if (input.accessPermissions === null) {
    command.accessPermissions = [];
  }
  const runtimeConfig = input.runtimeConfig;
  if (runtimeConfig && typeof runtimeConfig === 'object' && !Array.isArray(runtimeConfig)) {
    command.runtimeConfig = runtimeConfig;
  }
  const primaryDomain = trimToValue(input.primaryDomain);
  if (primaryDomain) {
    command.primaryDomain = primaryDomain;
  }
  const ownershipScope = trimToValue(input.ownershipScope).toUpperCase();
  if (ownershipScope) {
    if (!['TENANT', 'ORGANIZATION', 'USER'].includes(ownershipScope)) {
      throw new RegistrationConfigurationError(
        `ownershipScope=${JSON.stringify(input.ownershipScope)} is not TENANT, ORGANIZATION, or USER`,
      );
    }
    command.ownershipScope = ownershipScope;
    if (ownershipScope === 'USER') {
      const ownerUserId = trimToValue(input.ownerUserId);
      if (!/^[1-9][0-9]*$/u.test(ownerUserId)) {
        throw new RegistrationConfigurationError(
          'a USER-owned installation requires a positive decimal ownerUserId',
        );
      }
      command.ownerUserId = ownerUserId;
    }
  }
  return command;
}

/**
 * Extract the anchor facts out of one deploy application item.
 *
 * `id` is the addressable uuid (`AppResponse.id` maps `deploy_app.uuid`) and
 * `deployApplicationId` is the decimal anchor (`deploy_app.id`); both are read
 * from the same row. A response that omits the anchor or carries a non-decimal
 * value is refused, so the uuid is never promoted into the anchor position.
 * @param item - `data.item` of a deploy response
 * @returns uuid, decimal anchor, slug, status, tenant
 * @throws {RegistrationConfigurationError} when the uuid or the decimal anchor is missing
 */
export function readDeployAppItem(item) {
  if (!item || typeof item !== 'object') {
    throw new RegistrationConfigurationError('deploy response has no data.item application');
  }
  const uuid = trimToValue(item.id) || trimToValue(item.uuid);
  if (!uuid) {
    throw new RegistrationConfigurationError('deploy application item has no id (uuid)');
  }
  const anchor = trimToValue(item.deployApplicationId);
  if (!anchor) {
    throw new RegistrationConfigurationError(
      `deploy application ${uuid} carried no deployApplicationId; the app API returns the decimal `
      + '`deploy_app.id` anchor on every response, and IAM binds that value rather than the uuid',
      { uuid },
    );
  }
  return {
    uuid,
    deployApplicationId: assertDeployApplicationAnchor(
      anchor,
      'deploy response deployApplicationId',
    ),
    slug: trimToValue(item.slug),
    name: trimToValue(item.name),
    appKind: trimToValue(item.appKind).toUpperCase(),
    appStatus: trimToValue(item.appStatus),
    tenantId: trimToValue(item.tenantId),
    raw: item,
  };
}

/**
 * Extract the installation facts out of one tenant-application item.
 * @param item - `data.item` of a provision/enable response
 * @returns installation id, anchor, status, runtime app id
 */
export function readInstallationItem(item) {
  if (!item || typeof item !== 'object') {
    throw new RegistrationConfigurationError('IAM response has no tenant application item');
  }
  const installationId = trimToValue(item.installationId) || trimToValue(item.id);
  return {
    installationId,
    deployApplicationId: trimToValue(item.deployApplicationId),
    status: trimToValue(item.status),
    appId: trimToValue(item.appId),
    instanceKey: trimToValue(item.instanceKey),
    applicationType: trimToValue(item.applicationType),
    raw: item,
  };
}

function readFirstEnv(env, candidates) {
  for (const key of candidates) {
    const value = trimToValue(env[key]);
    if (value) {
      return { key, value };
    }
  }
  return { key: candidates[0], value: '' };
}

function assertHttpBaseUrl(value, label) {
  if (!/^https?:\/\//iu.test(value)) {
    throw new RegistrationConfigurationError(
      `${label} must be an absolute http(s) URL such as http://127.0.0.1:3902, got `
      + `${JSON.stringify(value)}`,
      { value },
    );
  }
  return value.replace(/\/+$/u, '');
}

/**
 * Resolve the deploy and IAM connection settings from the environment.
 *
 * Every missing value is collected before failing, and every message names the
 * exact variable, so an operator is never told "credentials missing" without
 * being told which ones.
 * @param env - process environment bag
 * @returns deploy/IAM base URLs, credentials, tenant scope, timeouts
 * @throws {RegistrationConfigurationError} naming every missing variable
 */
export function resolveRegistrationSettings(env = process.env) {
  const missing = [];
  const deployBase = readFirstEnv(env, [REGISTRATION_SETTINGS_ENV.deploy.baseUrl]);
  if (!deployBase.value) {
    missing.push(deployBase.key);
  }
  const deployAccess = readFirstEnv(env, [REGISTRATION_SETTINGS_ENV.deploy.accessToken]);
  if (!deployAccess.value) {
    missing.push(deployAccess.key);
  }
  const deployAuth = readFirstEnv(env, [REGISTRATION_SETTINGS_ENV.deploy.authToken]);
  if (!deployAuth.value) {
    missing.push(deployAuth.key);
  }
  const iamBase = readFirstEnv(env, REGISTRATION_SETTINGS_ENV.iam.baseUrlCandidates);
  if (!iamBase.value) {
    missing.push(iamBase.key);
  }
  const iamAuthToken = readFirstEnv(env, REGISTRATION_SETTINGS_ENV.iam.authTokenCandidates);
  const iamUsername = readFirstEnv(env, REGISTRATION_SETTINGS_ENV.iam.usernameCandidates);
  const iamPassword = readFirstEnv(env, REGISTRATION_SETTINGS_ENV.iam.passwordCandidates);
  if (!iamAuthToken.value && !(iamUsername.value && iamPassword.value)) {
    missing.push(
      `${REGISTRATION_SETTINGS_ENV.iam.authTokenCandidates[0]} or `
      + `${REGISTRATION_SETTINGS_ENV.iam.usernameCandidates[0]} + `
      + `${REGISTRATION_SETTINGS_ENV.iam.passwordCandidates[0]}`,
    );
  }
  if (missing.length > 0) {
    throw new RegistrationConfigurationError(
      `registration cannot start: ${missing.length} required setting(s) are missing or blank:\n`
      + missing.map((name) => `  - ${name}`).join('\n')
      + '\nSet them in the deployment profile environment; the registrar never invents a '
      + 'credential, a base URL, or an application identity.',
      { missing },
    );
  }

  const tenantId = trimToValue(env[REGISTRATION_SETTINGS_ENV.tenantId]);
  const organizationId = trimToValue(env[REGISTRATION_SETTINGS_ENV.organizationId]);
  const iamAuth = iamAuthToken.value
    ? { authToken: iamAuthToken.value }
    : { username: iamUsername.value, password: iamPassword.value };
  const managementAccessToken = readFirstEnv(env, IAM_MANAGEMENT_SETTINGS_ENV.accessTokenCandidates);
  const managementAuthToken = readFirstEnv(env, IAM_MANAGEMENT_SETTINGS_ENV.authTokenCandidates);

  return {
    deploy: {
      baseUrl: assertHttpBaseUrl(deployBase.value, deployBase.key),
      accessToken: deployAccess.value,
      authToken: deployAuth.value,
      timeoutMs: readTimeout(env, REGISTRATION_SETTINGS_ENV.deploy.timeoutMs),
    },
    iam: {
      baseUrl: assertHttpBaseUrl(iamBase.value, iamBase.key),
      transport: trimToValue(env.SDKWORK_IAM_TRANSPORT) || 'auto',
      auth: iamAuth,
      timeoutMs: readTimeout(env, REGISTRATION_SETTINGS_ENV.iam.timeoutMs),
      // The installation-environment route is dual-token; these credentials are
      // optional because the client can mint a session from the operator
      // username + password, and because `--no-register-environments` opts out.
      management: {
        accessToken: managementAccessToken.value,
        authToken: managementAuthToken.value,
        username: iamUsername.value,
        password: iamPassword.value,
      },
    },
    tenantId,
    organizationId,
  };
}

function readTimeout(env, key) {
  const raw = trimToValue(env[key]);
  if (!raw) {
    return 10_000;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 500 || parsed > 60_000) {
    throw new RegistrationConfigurationError(
      `${key}=${JSON.stringify(raw)} must be an integer number of milliseconds in 500..60000`,
      { key, value: raw },
    );
  }
  return parsed;
}

/**
 * Console label for one registration item.
 * @param entry - inventory entry
 * @param environment - canonical environment
 * @returns `repo/appdir@environment`
 */
export function formatRegistrationItemLabel(entry, environment) {
  const appDir = entry.appDir && entry.appDir !== '.' ? `/${entry.appDir}` : '';
  return `${entry.repo}${appDir}@${environment}`;
}
