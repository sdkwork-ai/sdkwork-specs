# ADR-20261106 uni-app x Application Root Architecture

Status: accepted
Requirement: REQ-2026-1106
Owner: SDKWork platform
Date: 2026-11-06
Specs: `UNIAPP_X_APP_ARCHITECTURE_SPEC.md`, `UNIAPP_APP_ARCHITECTURE_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APPLICATION_SPEC.md`, `NAMING_SPEC.md`, `APP_MANIFEST_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_ASSETS_SPEC.md`, `ICON_SPEC.md`, `ENVIRONMENT_SPEC.md`, `TEST_SPEC.md`

## Context

SDKWork has explicit application-root standards for PC, pad/tablet, H5/Capacitor,
Flutter, mini program, native Android, native iOS, native HarmonyOS, uni-app,
Unity, and static web. The `-uniapp` root covers the Vue 3 + Vite uni-app
framework. DCloud has shipped uni-app x as its successor framework:

- Pages are `.uvue` files (`App.uvue`, `main.uts`), not `.vue` pages.
- Projects are created and compiled by HBuilderX/HBuilderV, not by a CLI
  scaffold; CI drives the HBuilderX CLI for packaging.
- `manifest.json` carries a mandatory `uni-app-x` node; without it the project
  is treated as uni-app.
- App targets render natively (Kotlin/Swift/ArkTS), and Web/mini program targets
  compile to JavaScript with framework-specific compatibility.
- Two Vue modes exist. 蒸汽模式 (`vapor`) removes the virtual DOM and, on App
  targets, uses a new native rendering pipeline; 非蒸汽模式 (`vdom`) keeps the
  virtual DOM and the older UTS-driven pipeline.

The two modes have different source constraints, minimum platform versions, and
CSS behavior. A uni-app x project can be built in either mode, and a project that
was authored for VDOM can run in Vapor through UTS-to-JS compatibility, but a
Vapor-authored project may not compile back under VDOM.

Treating uni-app x as a variant of the `-uniapp` root would force `.uvue` and
`.vue` rules, Vite-based and HBuilderX-based toolchains, and Vapor and VDOM
constraints into one standard. Splitting the root keeps each framework's
contract explicit and lets both share the same package taxonomy, SDK/IAM
boundary and verification model.

## Decision

Add `UNIAPP_X_APP_ARCHITECTURE_SPEC.md` as the uni-app x root architecture
standard and register it across the client, UI, application, manifest, config,
naming, asset, release and test authorities.

- A uni-app x root is `apps/sdkwork-<application-code>-uniappx/` with
  `sdkwork-<application-code>-uniappx-*`,
  `sdkwork-<application-code>-uniappx-console-*`,
  `sdkwork-<application-code>-uniappx-admin-*`, and exactly one
  `sdkwork-<application-code>-uniappx-host` package.
- The architecture token is `uniappx` (single kebab-case segment). The framework
  value is `uni-app-x`; the client architecture value is `uniappx`.
- The Vue mode is a first-class architecture axis. `runtime.uniappxMode` in
  `agent.app.config.json` is `vapor` or `vdom`, mirrored by the `manifest.json`
  `uni-app-x.vapor` setting. `vapor` is the default for new roots. The mode is
  never an environment, deployment profile, or runtime target.
- Both modes share one source contract: Composition API only, `.uvue` pages,
  typed host adapters, generated SDK clients, one global TokenManager, and
  `pages.json` as a projection of route contributions. Mode-specific behavior is
  isolated behind the host package and the root bootstrap, including the
  `VUE3-VAPOR` conditional compilation token.
- `vapor` roots declare the mode's minimum platform versions (Android 6+,
  iOS 15+, HarmonyOS API 20+); `vdom` roots may retain the lower versions
  (Android 5+, iOS 12+, HarmonyOS API 14+). A mode that cannot satisfy a target's
  minimum version must be changed or the target dropped.
- Shared components come from `sdkwork-appbase` (`packages/uni-app-x/`) and
  `sdkwork-iam` (`apps/sdkwork-iam-uniappx/`); an application root must not
  fork them.
- The existing `-uniapp` root remains valid for uni-app projects and is not
  reclassified. New App-first cross-platform products should choose `uniappx`
  unless an existing uni-app dependency or a VDOM-only plugin blocks it.
- `.vue` pages remain a uni-app concept and are forbidden in a uni-app x root.
  `.vue` components imported explicitly remain allowed only when a documented
  dependency requires them.

## Alternatives

- **Extend the `-uniapp` root with a "uni-app x mode".** Rejected: `.uvue` vs
  `.vue` pages, HBuilderX vs Vite project ownership, and Vapor vs VDOM source
  constraints would produce one root with contradictory rules.
- **Map uni-app x to the native Android/iOS/HarmonyOS roots.** Rejected: those
  roots own Kotlin/Swift/ArkTS source trees, not Vue pages and a shared
  JavaScript core, and would duplicate the same business code three times.
- **Support only Vapor.** Rejected: VDOM is still required for legacy plugins,
  older devices below the Vapor minimum versions, and projects that must stay
  backward compatible during migration.
- **Support only VDOM.** Rejected: DCloud positions Vapor as the successor path
  and will keep the older pipeline for compatibility only; new roots would
  inherit a dead end.
- **Keep shared components inside the application root.** Rejected: it
  duplicates auth, session and base UI behavior per application and breaks the
  documented `sdkwork-appbase` / `sdkwork-iam` reuse boundary.

## Consequences

- SDKWork gains one more client root with explicit dual-mode semantics, and the
  alignment table, naming registry, manifest schema guidance, UI selection table
  and test authority each gain one row.
- Applications choose a root and a mode explicitly. Moving between `uniapp` and
  `uniappx`, or between `vdom` and `vapor`, is an architectural change requiring
  evidence; it is not a build flag.
- The shared component packages in `sdkwork-appbase` and `sdkwork-iam` become
  the only supported component source, which adds cross-repository dependency
  management but prevents divergent auth and base-UI behavior.
- HBuilderX is a required toolchain for App packaging. CI cannot replace it with
  a plain Vite build, so release pipelines must provision the HBuilderX CLI and
  record its version in artifact evidence.
- Web and mini program targets still run VDOM behavior when built from a Vapor
  root; the standard states this explicitly so teams do not claim Vapor rendering
  performance for those targets.
- Existing uni-app roots are unaffected. The `-uniapp` root gains a pointer to
  the new standard and a migration note for App-first products.

## Verification

- `UNIAPP_X_APP_ARCHITECTURE_SPEC.md` is listed in `README.md` and cited by
  `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APPLICATION_SPEC.md`,
  `UI_ARCHITECTURE_SPEC.md`, `NAMING_SPEC.md`, `APP_MANIFEST_SPEC.md`,
  `APP_SDK_INTEGRATION_SPEC.md`, `APP_ASSETS_SPEC.md`, `ICON_SPEC.md`,
  `ENVIRONMENT_SPEC.md`, and `TEST_SPEC.md`.
- `node tools/check-uniappx-architecture.mjs --root .` proves root naming,
  package taxonomy, mode declaration agreement, `.uvue` page ownership, and
  mode-aware minimum versions.
- `node --test tools/check-uniappx-architecture.test.mjs` covers every rule with
  fixture roots.
- `node tools/check-client-host-packages.mjs --root .` recognizes
  `sdkwork-<code>-uniappx-host` as the single host package of the root.
- `node tools/check-repository-docs-standard.mjs --root .` and
  `git diff --check` pass.

## Supersedes / Superseded By

None. This decision adds a root alongside `UNIAPP_APP_ARCHITECTURE_SPEC.md`; it
does not replace the uni-app root.
