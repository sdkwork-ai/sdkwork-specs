import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// Resolve the checker relative to this test file, not the caller's cwd: the
// suite must behave the same whether it is run from `sdkwork-specs/` or from
// the workspace root via a `node --test sdkwork-specs/tools/...` invocation.
const CHECKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-i18n-standard.mjs');

function write(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

function makeRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-i18n-check-'));
  write(root, 'AGENTS.md', '# Repository Guidelines\n');
  write(root, 'package.json', '{"name":"sdkwork-i18n-check"}\n');
  return root;
}

function runChecker(args) {
  return spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: path.dirname(CHECKER),
    encoding: 'utf8',
  });
}

function hasGit() {
  return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
}

describe('check-i18n-standard', () => {
  it('accepts package-local source fragments and generated platform projections', () => {
    const root = makeRepo();
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-auth/src/i18n/zh-CN/iam/auth/login.ts', 'export default { title: "登录" };\n');
    write(root, 'apps/sdkwork-demo-h5/packages/sdkwork-demo-h5-auth/src/i18n/en-US/iam/auth/login.json', '{ "title": "Login" }\n');
    write(root, 'apps/sdkwork-demo-flutter-mobile/packages/sdkwork_demo_flutter_mobile_auth/lib/src/i18n/zh-CN/iam/auth/login.arb', '{ "title": "登录" }\n');
    write(root, 'apps/sdkwork-demo-android-mobile/packages/sdkwork-demo-android-mobile-auth/src/main/i18n/zh-CN/iam/auth/login.json', '{ "title": "登录" }\n');
    write(root, 'apps/sdkwork-demo-android-mobile/packages/sdkwork-demo-android-mobile-auth/src/main/res/values-zh-rCN/strings.xml', '<!-- sdkwork-i18n-generated -->\n<resources><string name="iam_auth_login_title">登录</string></resources>\n');
    write(root, 'apps/sdkwork-demo-ios-mobile/packages/sdkwork-demo-ios-mobile-auth/Sources/SdkworkDemoIosMobileAuth/I18n/zh-CN/iam/auth/login.json', '{ "title": "登录" }\n');
    write(root, 'apps/sdkwork-demo-harmony-mobile/packages/sdkwork-demo-harmony-mobile-auth/src/main/ets/i18n/zh-CN/iam/auth/login.json', '{ "title": "登录" }\n');
    write(root, 'crates/sdkwork-iam-auth-service/resources/i18n/zh-CN/iam/auth/login.ftl', 'iam-auth-login-title = 登录\n');
    write(root, 'services/iam-auth/src/main/resources/i18n/zh-CN/iam/auth/login.properties', 'iam.auth.login.title=登录\n');
    write(root, 'database/seeds/locales/zh-CN/iam/auth/001_auth_seed.sql', '-- locale seed\n');
    write(root, 'packages/sdkwork-i18n-contract/src/i18n/keys/iam/auth.ts', 'export const loginTitle = "iam.auth.login.title";\n');

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /i18n standard check passed/u);
  });

  it('rejects authored TypeScript locale monoliths and platform locale directory names as source roots', () => {
    const root = makeRepo();
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-auth/src/i18n/zh-CN.ts', 'export default { loginTitle: "登录" };\n');
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-auth/src/i18n/values-zh-rCN/iam/auth/login.ts', 'export default { title: "登录" };\n');

    const result = runChecker(['--root', root]);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /locale monolith/u);
    assert.match(result.stderr, /normalized BCP 47 locale/u);
  });

  it('rejects authored platform aggregate resources without generated markers', () => {
    const root = makeRepo();
    write(root, 'apps/sdkwork-demo-android-mobile/packages/sdkwork-demo-android-mobile-auth/src/main/res/values/strings.xml', `
<resources>
  <string name="iam_auth_login_title">Login</string>
  <string name="iam_auth_login_submit">Submit</string>
  <string name="iam_auth_login_error">Error</string>
</resources>
`);
    write(root, 'apps/sdkwork-demo-flutter-mobile/packages/sdkwork_demo_flutter_mobile_auth/lib/l10n/app_en.arb', `
{
  "loginTitle": "Login",
  "loginSubmit": "Submit",
  "loginError": "Error"
}
`);

    const result = runChecker(['--root', root]);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /platform aggregate/u);
    assert.match(result.stderr, /generated marker/u);
  });

  it('rejects backend message bundles outside the standard Rust and Java layouts', () => {
    const root = makeRepo();
    write(root, 'crates/sdkwork-iam-auth-service/src/i18n.rs', 'pub const LOGIN_TITLE: &str = "登录";\n');
    write(root, 'services/iam-auth/src/main/resources/messages_zh_CN.properties', 'iam.auth.login.title=登录\n');

    const result = runChecker(['--root', root]);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /Rust backend message resources/u);
    assert.match(result.stderr, /Java\/Spring backend message resources/u);
  });

  it('scans child repositories with --workspace', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-i18n-workspace-'));
    const repoRoot = path.join(workspace, 'sdkwork-demo');
    write(repoRoot, 'AGENTS.md', '# Repository Guidelines\n');
    write(repoRoot, 'package.json', '{"name":"sdkwork-demo"}\n');
    write(repoRoot, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-auth/src/i18n/messages.json', '{ "loginTitle": "Login" }\n');

    const result = runChecker(['--workspace', workspace]);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /sdkwork-demo/u);
    assert.match(result.stderr, /locale monolith/u);
  });

  it('ignores external vendored source trees', () => {
    const root = makeRepo();
    write(root, 'external/upstream-app/src/i18n/en.ts', 'export default { loginTitle: "Login" };\n');

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /i18n standard check passed/u);
  });

  it('allows thin package-local i18n registries without message copy', () => {
    const root = makeRepo();
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-core/src/i18n/locale.ts', 'export const defaultLocale = "zh-CN";\n');
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-core/src/i18n/types.ts', 'export type LocaleCode = "zh-CN" | "en-US";\n');

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /i18n standard check passed/u);
  });

  it('rejects the retired custom locale request header in authored source', () => {
    const root = makeRepo();
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-core/src/sdk-locale.ts', [
      "const headers = { 'Accept-Language': locale, 'X-SdkWork-Locale': locale };", // i18n-retired-locale-header-allow: detection fixture
      '',
    ].join('\n'));

    const result = runChecker(['--root', root]);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /custom locale request header is retired/u);
    assert.match(result.stderr, /sdk-locale\.ts:1/u);
  });

  it('allows the retired-header marker on absence assertions and rejection lists', () => {
    const root = makeRepo();
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-core/src/sdk-locale.test.ts', [
      "const retired = new Set(['x-sdkwork-locale']); // i18n-retired-locale-header-allow",
      '',
    ].join('\n'));

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /i18n standard check passed/u);
  });

  it('ignores compiler-generated declaration output inside i18n directories', () => {
    const root = makeRepo();
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-core/src/i18n/index.d.ts', 'export declare const defaultLocale: string;\n');
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-core/src/i18n/rtcCallI18n.d.ts', 'export declare const callTitle: string;\n');

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /i18n standard check passed/u);
  });

  it('rejects the retired locale source value listed beside the live ones', () => {
    const root = makeRepo();
    // The shape the fleet actually had: `specs/web-request-context.schema.json`
    // declared the source enum as one compact array, retired member included.
    write(root, 'specs/web-request-context.schema.json', [
      '{',
      '  "$defs": {',
      '    "WebLocaleSource": {',
      '      "type": "string",',
      '      "enum": ["user-preference", "tenant-preference", "app-default", "accept-language", "sdk-header", "system-default"]', // i18n-retired-locale-header-allow: detection fixture
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'));

    const result = runChecker(['--root', root]);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /locale source enum member retained/u);
    assert.match(result.stderr, /web-request-context\.schema\.json:5/u);
  });

  it('rejects a locale source enum member named after the retired header', () => {
    const root = makeRepo();
    write(root, 'crates/sdkwork-web-core/src/request_context.rs', [
      'pub enum WebLocaleSource {',
      '    UserPreference,',
      '    SdkHeader,',
      '    SystemDefault,',
      '}',
      '',
    ].join('\n'));

    const result = runChecker(['--root', root]);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /locale source enum member retained/u);
    assert.match(result.stderr, /request_context\.rs:3/u);
  });

  it('accepts a UI header component and a stylesheet class that merely share the name', () => {
    const root = makeRepo();
    // A "SdkHeader" header-bar component and a `.sdk-header` CSS rule are ordinary
    // names, not locale sources — the rule must not punish them.
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-shell/src/SdkHeader.tsx', 'export function SdkHeader() { return null; }\n');
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-shell/src/shell.css', '.sdk-header { display: flex; }\n');
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-shell/src/styles.ts', "export const cls = 'sdk-header';\n");

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /i18n standard check passed/u);
  });

  it('skips derived compiler output that sits beside its authored TypeScript twin', () => {
    const root = makeRepo();
    const stem = 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-core/src/sdk-locale';
    // The authored source is the file a developer edits and can fix.
    write(root, `${stem}.ts`, "export const localeRequestHeader = 'Accept-Language';\n");
    // `tsc` dropped a compiled twin next to it; the retired token only survives
    // there because the artifact has not been recompiled since the retirement.
    write(root, `${stem}.js`, "const headers = { 'X-SdkWork-Locale': locale };\n"); // i18n-retired-locale-header-allow: derived-output fixture
    write(root, `${stem}.d.ts`, 'export declare const retiredLocaleHeader: string;\n');

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /i18n standard check passed/u);
  });

  it('still rejects retired protocol surface in authored standalone JavaScript', () => {
    const root = makeRepo();
    // No `.ts` twin, so this is authored JavaScript rather than a compiler
    // artifact, and the workspace-wide wire contract still applies to it.
    write(root, 'apps/sdkwork-demo-pc/packages/sdkwork-demo-pc-core/src/legacy-boundary.js', "fetch(url, { headers: { 'X-SdkWork-Locale': locale } });\n"); // i18n-retired-locale-header-allow: authored-JavaScript fixture

    const result = runChecker(['--root', root]);

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /custom locale request header is retired/u);
  });

  it('skips derived bundles under a git-ignored output directory', (t) => {
    if (!hasGit()) return t.skip('git is not available');
    const root = makeRepo();
    const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    // `lib/` is bundler output for a TypeScript package and authored source for a
    // Flutter package, so only the repository can say which one this is.
    write(root, '.gitignore', 'lib/\n');
    write(root, 'packages/client/demo/src/index.ts', "export const localeHeader = 'Accept-Language';\n");
    write(root, 'packages/client/demo/lib/client.js', "const headers = { 'X-SdkWork-Locale': locale };\n"); // i18n-retired-locale-header-allow: ignored-output fixture

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /i18n standard check passed/u);
  });

  it('ignores the local .sdkwork workspace metadata directory', () => {
    const root = makeRepo();
    write(root, '.sdkwork/tmp/order_app_web_bootstrap.rs', 'const HEADERS: [&str; 1] = ["x-sdkwork-locale"];\n'); // i18n-retired-locale-header-allow: skipped-directory fixture

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /i18n standard check passed/u);
  });

  it('reports how many files it scanned, so a pass is never vacuous', () => {
    const root = makeRepo();
    write(root, 'packages/sdkwork-i18n-contract/src/i18n/keys/iam/auth.ts', 'export const loginTitle = "iam.auth.login.title";\n');

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 0, result.stderr);
    // The unit count is what distinguishes a wired gate from a no-op.
    assert.match(result.stdout, /i18n standard check passed \(\d+ file\(s\) scanned\)/u);
  });

  it('fails closed on a root that does not exist instead of reporting a pass', () => {
    const missing = path.join(os.tmpdir(), 'sdkwork-i18n-check-absent-root');

    const result = runChecker(['--root', missing]);

    // A moved or renamed root must not silently retire the locale contract.
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /not a directory/u);
  });

  it('fails closed on an empty repository instead of reporting a pass', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-i18n-check-empty-'));

    const result = runChecker(['--root', root]);

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /refusing to report success on an empty scan/u);
  });
});
