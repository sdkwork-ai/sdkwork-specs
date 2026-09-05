# Theme Conformance Matrix

- Version: 2.0
- Authority: `THEME_DARKMODE_SPEC.md` (v2.0)
- Evidence: `tools/check-theme-conformance.mjs` runs (mechanism checks F1/F2/F4) plus module style audits (class-pair review F5/F6)

One row per SDKWork UI module family. Status values: **aligned** (spec-conformant), **aligned\*** (aligned with documented exemptions), **gap** (open violations). Brand column records the §10 rollout stage: `none` → `contract-ready` → `presets` → `custom`. Update this matrix whenever a module lands or changes its theme mechanism (`THEME_DARKMODE_SPEC.md` §9).

## Web PC / H5 (React, Tailwind v4)

| Module | Mode contract | Token completeness | Brand switching (§10 stage) | Tailwind dark binding | Checker | Open gaps |
| --- | --- | --- | --- | --- | --- | --- |
| `sdkwork-ui` (shared UI library) | aligned — `SdkworkThemeProvider` owns resolution, `ShellBridge` carries host preferences | aligned — `--sdk-color-*` semantic set + 11-step brand ramps ×6 presets + attribute-scoped dual-mode blocks (2026-09-05) | **`custom`** — presets + `overrides` contract (reference implementation) | aligned | OK (589 files) | historical unscoped default stays dark-first for backward compatibility (documented) |
| `sdkwork-agents` (chat / creative 生成 / presentation) | aligned — `ThemeContext` is the single resolver (`resolvedTheme`); host surfaces bridge via `SdkworkHostThemeSurface` | partial — feature-local `dark:` pairs instead of semantic tokens | `contract-ready` — embedded surface carries `data-theme` channel (2026-09-05); settings UI stage target: next minor | aligned (`@custom-variant dark` in shell CSS) | OK (897) | Light-mode fallbacks for settings dropdowns landed 2026-09-05; iframe/editor themes read `resolvedTheme` |
| `sdkwork-knowledgebase` (知识库) | aligned — host bridge + `html.dark` mirror with MutationObserver sync; `AppShell`/`KnowledgebaseAuthShell` arbitrated (§7.2 guard) | aligned — `--theme-*` aliases mapped to `kb-*` Tailwind colors, dual-mode | `contract-ready` — embedded channel live; standalone settings stage target: next minor | aligned | OK (1696) | Standalone `AppShell` keeps its own localStorage preference (standalone-only path) |
| `sdkwork-drive` (网盘) | aligned — `ThemeProvider` owner; `DriveAuthShell` arbitrated | partial — `dark:` pairs, no semantic layer | `contract-ready` — embedded channel live; standalone settings stage target: next minor | aligned (`@variant dark` class binding) | OK (969) | — |
| `sdkwork-appstore` (应用商店) | aligned — `ThemeProvider` owner; `AppstoreAuthShell` arbitrated | partial — dark-first auth variables + `html.dark body` | `contract-ready` — embedded channel live; standalone settings stage target: next minor | aligned | OK (750) | — |
| `sdkwork-course` (课程) | aligned — shell CSS `@custom-variant dark` added 2026-09-05; H5 `bootstrap/theme.ts` is the standalone owner | partial — page-level `dark:` pairs landed 2026-09-05 | `contract-ready` — embedded channel live | aligned | OK (329) | Plugin-composed surface renders `course-pc-course` only (player-stage design, mode-agnostic by intent) |
| `sdkwork-im` (IM H5 + PC) | aligned (2026-09-05) — H5 shell owner extracted to `im-h5-shell/src/theme/theme.ts` (§3.2 single writer, OS-change sync); settings page routes writes through `im-h5-user/src/theme/theme.ts`; PC auth shell resolves system mode via `hostAppearanceBridge.resolveSystemAppearanceMode()` | partial — page-level `dark:` pairs | `none` — no brand path yet; stage target: after standalone settings work | aligned | OK (1778) | F2/F1 fixes landed 2026-09-05; brand rollout open |
| `sdkwork-notes` (笔记 PC) | aligned (2026-09-05 audit) — `ThemeManager` owns root writes + OS sync; `startupAppearance` is the §3.3 boot anti-flash resolver; both registered as checker owners | aligned — themeMode + themeColor (default/forest/amber/ink) persisted store | **`presets`** — 4 brand colors switchable at provider level | aligned | OK (523) | Brand palette is notes-local, not yet the §5.2 six-preset table — migrate to §11 token export |
| `sdkwork-generations` (生成服务后端面) | n/a (no UI surface) | — | — | — | OK (216) | — |
| `sdkwork-iam` (auth forms) | aligned — host theme frame mirrors mode; form styles are token/inline-style based | aligned — `--sdk-color-*` projection in host shell | not exposed (host-frame brand) | aligned | OK (899) | — |
| `sdkwork-community` (圈子 H5) | aligned (2026-09-05 audit) — `bootstrap/themeInitializer.ts` is the owner (shared `clawchat_app_settings.darkMode` key with IM H5; X5 legacy `addListener` fallback) | partial — page-level `dark:` pairs | `none` — stage target after standalone settings work | aligned | OK (302) | — |
| `sdkwork-order` (订单 PC) | aligned (2026-09-05) — boot resolver extracted to `bootstrap/theme.ts` (§3.3 anti-flash owner); `main.tsx` consumes the resolved mode | partial — `dark:` pairs | `none` — stage target after standalone settings work | aligned | OK (596) | — |
| BirdCoder harness host (`sdkwork-birdcoder2`) | reference host — `ui-theme` ThemeRuntime + `data-ds-dark-theme` | reference (`--dsw-*` 3-layer) | host settings | reference | out of scope per host repo | — |

## Embedded plugin surfaces (host composition)

All BirdCoder-embedded SDKWork plugins go through `SdkworkHostThemeSurface` (per-package copy): surface root gets `data-sdk-color-mode` + `.dark`, optional documentElement mirror with snapshot/restore. Checker-verified module families: agents, knowledgebase, drive, appstore, course, generations.

**v2 (2026-09-05):** all 7 copies (`appstore`, `drive`, `knowledge`, `course`, `generations-assets/image/video`) now carry the §10 optional brand channel — `HostThemeBridge.getThemeColor?()` → surface-root `data-theme` — and the 4 host adapters (`appstoreHost`, `driveHost`, `knowledgebaseHost`, `courseHost`) declare the optional method. Hosts adopt brand switching per surface with zero plugin changes; bundles rebuilt for all 7 packages.

Known structural outlier (P2, deferred by agreement): `ui-sdkwork-token-plan` performs its own bridge-driven mirror with snapshot/restore (behaviorally §7-equivalent, brand hardcoded `tech-blue` via `SdkworkThemeProvider`). Migrate to the standard surface copy before its next feature change.

## Flutter / mini-program / native

| Platform family | Status | Notes |
| --- | --- | --- |
| Flutter (`APP_FLUTTER_UI_SPEC.md` scope) | gap — spec + §11 generator contract written, no module audited yet | When the first Flutter UI module lands: one theme-builder module consuming the §11 token export (`MaterialColor` ramp, `ColorScheme` role mapping, single `ThemeMode` resolver); hardcoded palettes are F12; register a matrix row |
| Mini program (`APP_MINI_PROGRAM_UI_SPEC.md` scope) | gap — spec + §11 generator contract written, no module audited yet | Page-root dark class + `theme.json` `darkmode: true`; wxss variables generated from the token export; no `@media (prefers-color-scheme)` outside the theme service |
| HarmonyOS / Android / iOS native | gap — reserved | Map onto platform-native mode primitives; brand ramps shared via the §11 JSON token sidecar |

## Exemptions (documented F6/F5 waivers)

| Surface | Reason |
| --- | --- |
| PDF viewer / document export / print sheets | paper-white is the medium, not a theme state |
| WeChat article/cropper/preview simulations | replicate the WeChat client look; the simulated chrome is content |
| Photo/video player stages, poster overlays, editor canvases (Monaco `vs-dark`) | media surfaces are mode-agnostic by design |
| Switch knobs, carousel dots, badges on colored fills | deliberate accent elements readable in both modes |
