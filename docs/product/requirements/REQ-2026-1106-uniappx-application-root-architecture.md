# REQ-2026-1106 uni-app x Application Root Architecture

```yaml
id: REQ-2026-1106
title: uni-app x application root architecture with Vapor and VDOM modes
owner: SDKWork platform
status: accepted
source: governance
problem: SDKWork defines PC, pad/tablet, H5/Capacitor, Flutter, mini program, native Android/iOS/HarmonyOS, uni-app, Unity, and static web client roots, but the next-generation uni-app x framework has no architecture root. uni-app x is not a version bump of uni-app: it uses `.uvue` pages, an HBuilderX-owned project model, native rendering on App targets, and two Vue runtimes (蒸汽模式/Vapor without a virtual DOM, and 非蒸汽模式/VDOM). Without a root standard, teams will either bolt uni-app x onto the uni-app root with incompatible source rules, or invent local layouts that bypass the shared package taxonomy, SDK/IAM boundary, host adapter boundary, and verification evidence.
goals:
  - Define `apps/sdkwork-<application-code>-uniappx/` as the uni-app x application root, aligned with the other client architecture roots.
  - Define first-class support for both Vue modes: `vapor` (蒸汽模式) and `vdom` (非蒸汽模式).
  - Define the mode declaration, mode-portable source contract, mode-specific rendering rules, and mode-aware minimum platform versions.
  - Define `sdkwork-<application-code>-uniappx-*`, `-uniappx-console-*`, `-uniappx-admin-*`, and `-uniappx-host` package taxonomy, `.uvue` page ownership, and `pages.json` route projection.
  - Register the root in the application, alignment, naming, manifest, UI, SDK, config, icon, asset, release, and test authorities.
  - Define executable verification through `tools/check-uniappx-architecture.mjs` and `TEST_SPEC.md` section 2.4.12.
  - Keep shared components reusable across the two modes: `sdkwork-appbase` and `sdkwork-iam` ship uni-app x component packages instead of application-local copies.
non_goals:
  - Adding a new runtime target, deployment profile, or deployment topology.
  - Replacing the existing uni-app root for projects that remain on the Vue 3/Vite uni-app framework.
  - Replacing native Android, iOS, or HarmonyOS roots when a product needs platform-idiomatic UI.
  - Introducing a second business source authority for the same delivery target.
users:
  - application architects choosing between uni-app, uni-app x, and native mobile roots
  - frontend engineers writing `.uvue` pages, components, and host adapters
  - shared-component maintainers in `sdkwork-appbase` and `sdkwork-iam`
  - release engineers packaging App, mini program, web, and HarmonyOS targets
  - standards reviewers and agents validating client-root compliance
acceptance_criteria:
  - `UNIAPP_X_APP_ARCHITECTURE_SPEC.md` exists, is listed in `README.md`, and is referenced by the affected client, UI, naming, manifest, config, SDK, asset, command, and test standards.
  - A uni-app x root uses `apps/sdkwork-<application-code>-uniappx/` and `sdkwork-<application-code>-uniappx-*` packages; the segment is one kebab-case token and is never written as `uniapp-x`, `uni-app-x`, or `uni_app_x` in a path or package name.
  - The root declares exactly one Vue mode in `agent.app.config.json` `runtime.uniappxMode` (`vapor` or `vdom`), mirrored by `manifest.json` `uni-app-x.vapor`; the mode is an architecture axis, never an environment, deployment profile, or runtime target.
  - `vapor` is the default for new roots; `vdom` requires a recorded reason and satisfies the same source, package, route, SDK/IAM, and verification contract.
  - Pages are `.uvue` files; `.vue` pages are forbidden. `#ifdef VUE3-VAPOR` stays in the host package and root bootstrap.
  - App minimum platform versions satisfy the selected mode: `vapor` requires Android 6+, iOS 15+, HarmonyOS API 20+; `vdom` requires Android 5+, iOS 12+, HarmonyOS API 14+.
  - The root uses only Composition API (`<script setup>`); Options API, mixins, `this`, and Vuex are forbidden in both modes.
  - App package, console package, and admin package routes follow `<surface>.<domain>.<capability>.<screen>` and `pages.json` remains a projection of route contributions.
  - `check-uniappx-architecture.mjs` proves root naming, package taxonomy, mode declaration agreement, `.uvue` page ownership, mode-specific minimum versions, and secrets-free config; its tests cover each rule.
  - `sdkwork-appbase` exposes a uni-app x component package and `sdkwork-iam` exposes uni-app x auth/runtime packages that consume generated app SDKs through one TokenManager and one host adapter boundary.
non_functional_requirements:
  security: Session tokens stay in the token manager and platform secure storage through host adapters; no token, private key, or API key enters template, config, or build evidence.
  privacy: Permission prompts, push, camera, media, and location requests go through typed host adapters; privacy manifests follow platform store rules.
  performance: `vapor` roots must verify release-mode rendering; list virtualization, flatten usage, package-size budgets, and bytecode output are recorded as build evidence.
  reliability: Both modes must clear token, session, context, and sensitive state on logout, refresh failure, account switch, and tenant switch; mode switching never changes the business source authority.
affected_surfaces:
  - uniappx
  - uniapp
  - h5
  - flutter-mobile
  - mini-program
  - android-native
  - ios-native
  - harmony-native
  - sdk
  - release
trace:
  specs:
    - UNIAPP_X_APP_ARCHITECTURE_SPEC.md
    - UNIAPP_APP_ARCHITECTURE_SPEC.md
    - APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md
    - APPLICATION_SPEC.md
    - NAMING_SPEC.md
    - APP_MANIFEST_SPEC.md
    - UI_ARCHITECTURE_SPEC.md
    - APP_SDK_INTEGRATION_SPEC.md
    - APP_ASSETS_SPEC.md
    - ICON_SPEC.md
    - ENVIRONMENT_SPEC.md
    - TEST_SPEC.md
  components:
    - apps/sdkwork-<application-code>-uniappx/
    - apps/sdkwork-<application-code>-uniappx/packages/sdkwork-<application-code>-uniappx-host/
    - sdkwork-appbase packages/uni-app-x/
    - sdkwork-iam apps/sdkwork-iam-uniappx/
verification:
  - node tools/check-uniappx-architecture.mjs --root .
  - node --test tools/check-uniappx-architecture.test.mjs
  - node tools/check-repository-docs-standard.mjs --root .
  - node tools/check-client-host-packages.mjs --root .
  - git diff --check
```
