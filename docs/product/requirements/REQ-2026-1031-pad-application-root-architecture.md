# REQ-2026-1031 Pad Application Root Architecture

```yaml
id: REQ-2026-1031
title: Pad application root architecture and tablet adaptation standard
owner: SDKWork platform
status: accepted
source: governance
problem: SDKWork defines PC, H5/Capacitor, Flutter, mini program, native Android/iOS/HarmonyOS, uni-app, Unity, and static web client roots, but the pad/tablet root has no single architecture standard. Tablet delivery is split between PC-root tablet package targets and a `-pad` root that existing application text maps to per-target mobile standards. That split leaves tablet adaptation optional and makes tablet UX, packaging, and verification inconsistent.
goals:
  - Define `apps/sdkwork-<application-code>-pad/` as a tablet-first application root whose architecture is aligned with the PC application standard.
  - Define one `pad-tauri` tablet host package, the `pad` package segment, and app/console/admin package roles.
  - Define a mandatory tablet adaptation contract covering window classes, multitasking, input, safe areas, accessibility, performance, and evidence.
  - Make the same adaptation contract apply to PC-root tablet package targets so tablet work is consistent regardless of delivery path.
  - Keep the existing tablet runtime targets, deployment profiles, SDK surfaces, and appbase IAM boundary unchanged.
  - Register the new root standard in the global index, cross-client alignment, UI selection, manifest/config, naming, command, and test authorities.
non_goals:
  - Adding a new runtime target, deployment profile, or app type.
  - Replacing PC-root tablet package targets for products where tablet is only a package target.
  - Changing Flutter, H5, mini program, or native mobile root standards.
  - Adding HarmonyOS tablet or Windows tablet pad targets in this change.
  - Requiring a pad root where the PC root already satisfies the tablet product need.
users:
  - application architects choosing a tablet delivery path
  - frontend engineers implementing tablet layouts
  - release engineers packaging iPadOS and Android tablet artifacts
  - standards reviewers and agents validating client-root compliance
acceptance_criteria:
  - `APP_PAD_ARCHITECTURE_SPEC.md` exists, is listed in `README.md`, and is referenced by the affected client, UI, naming, manifest, config, command, and test standards.
  - A pad root uses `apps/sdkwork-<application-code>-pad/`, `sdkwork-<application-code>-pad-*` packages, and exactly one `sdkwork-<application-code>-pad-tauri` host package.
  - Pad runtime targets are limited to `tablet-ipados` and `tablet-android`; `clientArchitectures` is `["tauri"]`; no browser, desktop, server, container, Electron, Capacitor, or mobile-framework target is declared.
  - The tablet adaptation contract requires all four window classes, both orientations, Split View/Slide Over/Stage Manager, Android multi-window/freeform, pointer/trackpad/keyboard parity, safe areas, accessibility, performance, and evidence.
  - `specs/tablet-adaptation.spec.json` is required for pad roots and PC roots that enable tablet targets, and its shape, matrix coverage, and evidence rules are executable through `schemas/sdkwork.tablet-adaptation.spec.schema.v1.json` and `tools/check-tablet-adaptation.mjs`.
  - Existing PC-root tablet rules no longer contradict the pad root: PC tablet targets remain valid, apply the shared adaptation contract, and are not silently reclassified as pad roots.
  - No surviving authority maps a `-pad` root to a per-target mobile architecture standard.
  - Client-root tooling recognizes `-pad` roots and `-pad-tauri` host packages.
non_functional_requirements:
  security: Tokens and refresh tokens use iPadOS Keychain or Android Keystore through the tablet host adapter; signing material stays in the approved secret store.
  privacy: Tablet screenshots, store media, and diagnostics follow APP_ASSETS_SPEC.md and PRIVACY_SPEC.md; no secrets in capture or logs.
  performance: Tablet scrolling, resize, and split-view transitions hold the platform refresh rate; long collections virtualize; media is rendered-size.
  reliability: Multi-window shares one authenticated session and one TokenManager; logout, account switch, and tenant switch clear all windows and secure storage.
affected_surfaces:
  - pad
  - pc
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
    - APP_PAD_ARCHITECTURE_SPEC.md
    - APP_PC_ARCHITECTURE_SPEC.md
    - APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md
    - UI_ARCHITECTURE_SPEC.md
    - APPLICATION_SPEC.md
    - APP_MANIFEST_SPEC.md
    - CONFIG_SPEC.md
    - NAMING_SPEC.md
    - TEST_SPEC.md
  components:
    - apps/sdkwork-<application-code>-pad/
    - apps/sdkwork-<application-code>-pad/packages/sdkwork-<application-code>-pad-tauri/
verification:
  - node tools/check-repository-docs-standard.mjs --root .
  - node tools/check-client-host-packages.mjs --root .
  - node tools/check-tablet-adaptation.mjs --root .
  - node --test tools/check-tablet-adaptation.test.mjs
  - node tools/check-apps-directory-index.mjs --root .
  - git diff --check
```
