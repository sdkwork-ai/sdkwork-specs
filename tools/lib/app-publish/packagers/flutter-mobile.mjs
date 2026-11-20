/**
 * Flutter mobile application packager.
 *
 * Build targets:
 *  - `android`: `flutter build appbundle` → `.aab`
 *  - `ios`:     `flutter build ipa`      → `.ipa`
 *  - `harmony`: `flutter build hap`      → `.hap` (OpenHarmony Flutter fork)
 *
 * Artifacts:
 *  - android: `build/app/outputs/bundle/release/*.aab`
 *  - ios:     `build/ios/ipa/*.ipa`
 *  - harmony: `*.hap` under `build/ohos`, `ohos/`, or `harmony/`
 *
 * HarmonyOS is opt-in: stock Flutter has no `hap` target, so the platform is
 * added only when the app declares it through `runtime.targetPlatforms` or
 * `publish.platforms`, and the build fails with guidance when the OpenHarmony
 * Flutter fork (or DevEco/hvigor) is not on PATH.
 *
 * App-store upload (Play Console / App Store Connect / AppGallery Connect) is
 * intentionally out of scope here; artifacts are published to a release
 * destination and a store submission plan consumes them. See
 * FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md and APP_MANIFEST_SPEC.md.
 */
import fs from 'node:fs';
import path from 'node:path';

import { collectFiles, readJson, runCommand } from '../util.mjs';
import { artifactPackages } from './shared.mjs';

export const architecture = 'flutter-mobile';
export const defaultPlatforms = ['android', 'ios'];
export const registry = 'github';

const HARMONY_DIRS = ['build/ohos', 'ohos', 'harmony/build', 'harmony', 'build/app/outputs/hap'];

/**
 * @returns {{ appKey: string, version: string, appRoot: string, platforms: string[] } | null}
 */
export function detect(appRoot, appConfig, { platformFilter } = {}) {
  // A Flutter app owns a pubspec.yaml at its root.
  if (!fs.existsSync(path.join(appRoot, 'pubspec.yaml'))) return null;

  const pkg = readJson(path.join(appRoot, 'package.json')) ?? {};
  const appKey = appConfig?.app?.key ?? path.basename(appRoot);
  const version = pkg.version || appConfig?.release?.currentVersion || '0.0.0';

  const declared = new Set(
    artifactPackages(appConfig)
      .map((p) => String(p.platform || '').toLowerCase().replace(/^app_/, ''))
      .filter((p) => p === 'android' || p === 'ios' || p === 'harmony'),
  );
  const runtimeTargets = Array.isArray(appConfig?.runtime?.targetPlatforms)
    ? appConfig.runtime.targetPlatforms.map((value) => String(value).toLowerCase())
    : [];
  const publishPlatforms = Array.isArray(appConfig?.publish?.platforms)
    ? appConfig.publish.platforms
    : [];
  if (runtimeTargets.includes('harmony') || publishPlatforms.includes('APP_HARMONY')) declared.add('harmony');
  if (runtimeTargets.includes('android') || publishPlatforms.includes('APP_ANDROID')) declared.add('android');
  if (runtimeTargets.includes('ios') || publishPlatforms.includes('APP_IOS')) declared.add('ios');

  let platforms = [...declared];
  if (platforms.length === 0) platforms = defaultPlatforms.slice();

  if (platformFilter) {
    platforms = platforms.filter((p) => p === platformFilter);
    if (platforms.length === 0) return null;
  }

  return { appKey, version, appRoot, platforms };
}

/**
 * @returns {{ ok: boolean, detail: string }}
 */
export function build(appRoot, { skipBuild, platform, env } = {}) {
  if (skipBuild) return { ok: true, detail: 'skipped build' };

  const args = platform === 'ios'
    ? ['build', 'ipa']
    : platform === 'android'
      ? ['build', 'appbundle']
      : platform === 'harmony'
        ? ['build', 'hap', '--release']
        : null;
  if (!args) return { ok: false, detail: `unknown flutter platform: ${platform}` };

  const r = runCommand('flutter', args, { cwd: appRoot, env });
  if (r.error || r.status !== 0) {
    const hint = platform === 'harmony'
      ? ' (harmony requires the OpenHarmony Flutter fork plus DevEco/ohpm on PATH)'
      : '';
    return { ok: false, detail: `flutter ${args.join(' ')} failed (status ${r.status ?? 'null'})${hint}` };
  }
  return { ok: true, detail: `${platform} built` };
}

/**
 * @returns {Array<{ path: string, name: string, platform: string, packageId?: string, label?: string, format?: string }>}
 */
export function collectArtifacts(appRoot, { platform, appConfig } = {}) {
  if (platform === 'android') {
    const found = collectFiles(path.join(appRoot, 'build', 'app', 'outputs', 'bundle'), /\.aab$/i);
    if (found.length === 0) return [];
    const pkg = artifactPackages(appConfig, 'android')[0];
    return [{ path: found[0], name: 'android.aab', platform: 'android', packageId: pkg?.id, label: 'Android App Bundle', format: 'AAB' }];
  }
  if (platform === 'ios') {
    const found = collectFiles(path.join(appRoot, 'build', 'ios'), /\.ipa$/i);
    if (found.length === 0) return [];
    const pkg = artifactPackages(appConfig, 'ios')[0];
    return [{ path: found[0], name: 'ios.ipa', platform: 'ios', packageId: pkg?.id, label: 'iOS App Package', format: 'IPA' }];
  }
  if (platform === 'harmony') {
    const found = [];
    for (const relative of HARMONY_DIRS) {
      found.push(...collectFiles(path.join(appRoot, relative), /\.hap$/i));
    }
    if (found.length === 0) return [];
    const pkg = artifactPackages(appConfig, 'harmony')[0];
    return [{ path: found[0], name: 'harmony.hap', platform: 'harmony', packageId: pkg?.id, label: 'HarmonyOS App Package', format: 'HAP' }];
  }
  return [];
}
