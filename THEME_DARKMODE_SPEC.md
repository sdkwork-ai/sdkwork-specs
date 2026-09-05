# Theme and Dark Mode Standard

- Version: 2.0
- Scope: All SDKWork user-facing surfaces across every client architecture — Web PC (React), H5 (mobile web), Flutter mobile/console, mini programs, desktop compositions, and every host-embedded SDKWork plugin — covering design tokens, light/dark color modes, brand theme-color switching, and integration flexibility
- Related: `TAILWIND_CSS_INTEGRATION_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `COMPONENT_SPEC.md`, `FRONTEND_CODE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `I18N_SPEC.md`, `TEST_SPEC.md`
- Changelog v2.0: §10 brand-switching exposure for every surface (embedded optional channel, standalone provider API); §11 cross-platform token single source and platform generators; §12 module alignment drill; §9 allowlist policy expanded to registered theme-owner modules (`hostAppearanceBridge`, `ThemeManager`, `startupAppearance`); F11/F12 added.

This standard defines the canonical SDKWork theme system: a three-layer design-token architecture, a single color-mode contract that every platform maps onto its native primitives, a brand theme-color switching system with an 11-step tonal ramp, and the integration contract that keeps host-embedded surfaces adaptive without fighting the host. Reference implementation: `sdkwork-ui` (`theme/sdkwork-theme.ts`, `theme/theme-provider.tsx`, `theme/shell-bridge-provider.tsx`, `styles/sdkwork-ui.css`). Reference host composition: the BirdCoder harness theme runtime.

Industry alignment: this model follows the same architecture as Material Design 3 tonal palettes + `ColorScheme`, Tailwind CSS v4 `@theme`/`@custom-variant`, and shadcn/ui CSS-variable theming — one semantic token layer consumed by all components, mode and brand resolved at a single root, never per component.

## 1. Design Principles

Rules:

- **Single source of truth.** Each surface has exactly one color-mode owner and one brand-color owner. Components `MUST NOT` resolve mode or brand themselves.
- **Semantic consumption.** Components consume semantic tokens (`--sdk-color-*`) or token-mapped Tailwind classes. Raw palette hex values `MUST NOT` appear in component code except: media surfaces (photo/video canvases, PDF paper), deliberate brand-neutral artwork, and the token definition files themselves.
- **Dual-mode completeness.** Every semantic token `MUST` define both a light value and a dark value. A token set that only defines one mode `MUST NOT` ship (dark-first token sets with no light block, and vice versa, are conformance violations).
- **No `prefers-color-scheme` in components.** OS preference is resolved exactly once, inside the platform theme provider (§6). Component styles, embedded surfaces, and feature CSS `MUST NOT` read `prefers-color-scheme` — the user's explicit in-app choice (or the host's choice for embedded surfaces) supersedes the OS.
- **Single writer on shared roots.** The mode-bearing root attribute/class is owned by one writer per surface (§3). Embedded surfaces `MUST NOT` add/remove mode classes on `documentElement`/page root except through the approved host bridge (§7).
- **Re-theme without remount.** Switching color mode or brand color `MUST` be a CSS custom-property swap on an existing root; it `MUST NOT` require remounting the tree, and components `MUST NOT` cache resolved color strings in ways that break a live swap.

## 2. Token Architecture

Three layers. A component may consume layer 2 or layer 3; layer 1 exists only to feed layer 2.

| Layer | Name pattern | Example | Defined by | May vary by |
| --- | --- | --- | --- | --- |
| 1. Primitive (reference) | `--sdk-ref-<palette>-<step>` | `--sdk-ref-zinc-900` | token definition file only | brand preset (for brand ramp) |
| 2. Semantic (alias) | `--sdk-color-<role>` | `--sdk-color-surface-panel` | token definition file, dual-mode | color mode, brand |
| 3. Component (specific) | `--sdk-comp-<component>-<part>` | `--sdk-comp-toast-border` | feature CSS, optional | color mode |

### 2.1 Semantic token set (required minimum)

Every UI library and application surface `MUST` provide these semantic roles; additional roles are allowed:

| Role group | Tokens |
| --- | --- |
| Brand | `--sdk-color-brand-primary`, `--sdk-color-brand-primary-hover`, `--sdk-color-brand-primary-soft`, `--sdk-color-brand-accent` |
| Surface | `--sdk-color-surface-canvas`, `--sdk-color-surface-panel`, `--sdk-color-surface-panel-muted`, `--sdk-color-surface-elevated`, `--sdk-color-surface-overlay` |
| Text | `--sdk-color-text-primary`, `--sdk-color-text-secondary`, `--sdk-color-text-muted`, `--sdk-color-text-inverse` |
| Border | `--sdk-color-border-subtle`, `--sdk-color-border-default`, `--sdk-color-border-strong`, `--sdk-color-border-focus` |
| State | `--sdk-color-state-success`, `--sdk-color-state-warning`, `--sdk-color-state-danger`, `--sdk-color-state-info` |
| Shape/elevation (mode-agnostic) | `--sdk-radius-*`, `--sdk-shadow-*` |

### 2.2 Dual-mode declaration shape

Semantic tokens `MUST` be declared twice — once for light mode, once for dark mode — scoped by the mode root (§3):

```css
:root,
[data-sdk-color-mode='light'] {
  --sdk-color-surface-canvas: #ffffff;
  --sdk-color-text-primary: #18181b;
  /* ...light values */
}

[data-sdk-color-mode='dark'] {
  --sdk-color-surface-canvas: #09090b;
  --sdk-color-text-primary: #fafafa;
  /* ...dark values */
}
```

Rules:

- The dark block `MUST` restyle only tokens, not components.
- Legacy feature-local variables (for example a feature's own `--theme-panel`) are allowed as layer-2 aliases provided they (a) are re-declared under both mode roots, and (b) are mapped into the Tailwind `@theme` so components consume them as token classes, not hex literals.
- State colors `SHOULD` shift one tonal step lighter in dark mode (for example red-600 → red-400) to preserve contrast on dark surfaces.

## 3. Color Mode Contract

### 3.1 Mode root

The color mode is expressed on each surface's root element with two co-applied markers:

- `data-sdk-color-mode="light" | "dark"` — the normative marker for CSS variable scoping, host reads, and tests.
- the `dark` class — co-applied on the same element so Tailwind `dark:` utilities (§4) resolve.

Standalone roots (application shells) apply both to `documentElement` or the app root. Embedded surfaces apply both to their own surface root element (§7).

### 3.2 Mode resolution ownership

| Context | Mode owner | Resolution input |
| --- | --- | --- |
| Standalone app | Platform theme provider (`SdkworkThemeProvider` / Flutter `ThemeMode` resolver / mini-program theme service) | user preference (`light` / `dark` / `system`); `system` resolves OS `prefers-color-scheme` (Flutter: `MediaQuery.platformBrightnessOf`) |
| Host-embedded surface | Host theme bridge (§7) | host appearance settings |
| Mini program | Page-root theme service | `wx.onThemeChange` / `theme.json` when `darkmode: true` |

Rules:

- Exactly one component per surface listens to OS preference changes and republishes the resolved mode.
- Feature components, pages, and embedded adapters `MUST NOT` call `window.matchMedia('(prefers-color-scheme: ...)')`, `MediaQuery.of(context).platformBrightness` for theming decisions, or `wx.getSystemInfoSync().theme` directly. They consume the resolved mode through the mode root or the provider context.
- On mode change the owner updates the mode root in place. Uncontrolled legacy readers that must react to `documentElement` changes `MAY` observe the attribute, but `MUST` not write it.

### 3.3 Boot anti-flash (web roots)

Web application roots `MUST` inline a boot script (or equivalent pre-paint mechanism) that sets the mode root and `color-scheme` before first paint from the persisted preference, so a dark-mode user never sees a white flash.

## 4. Tailwind v4 Integration (Web PC / H5)

Every CSS entry that compiles `dark:` utilities `MUST` declare the class-based variant binding — otherwise Tailwind v4 falls back to a `prefers-color-scheme` media query, which breaks explicit mode switching:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

Rules:

- The variant declaration lives in the application/shell `index.css` (per `TAILWIND_CSS_INTEGRATION_SPEC.md` ownership). Host-composed feature packages `MUST NOT` re-declare it; they rely on the compiled output of the single engine bootstrap.
- Build pipelines that compile a feature's Tailwind independently (for example plugin bundlers embedding an SDK `index.css`) `MUST` ensure the source CSS carries the `@custom-variant` declaration before compilation.
- Semantic tokens `SHOULD` be projected into Tailwind colors via `@theme` (`--color-kb-panel: var(--theme-panel)` style) so components write `bg-panel`/`text-primary` instead of `dark:`-paired raw utilities.
- **Pairing rule:** when a component styles with a raw light palette utility (`bg-white`, `bg-gray-50`, `text-gray-900`, `border-gray-200`, `bg-[#f…]`, …), the same declaration `MUST` carry the `dark:` counterpart in the same class list — or the element must consume a semantic token class. Unpaired light utilities are the most common dark-mode defect and are a conformance violation (P1).
- `sdk-dark:`-style custom variants keyed on `data-sdk-color-mode` are permitted as an alias but `MUST` be declared alongside the `dark` variant in the same entry.

## 5. Brand Theme-Color System

### 5.1 Tonal ramp

A brand color is an 11-step tonal ramp (50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950), following the Material 3 / Tailwind ramp convention. Step 500 is the canonical brand primary; hover uses 600 (light mode) or 400 (dark mode); soft fills use the primary at low alpha or steps ≤ 100.

### 5.2 Presets

The standard ships six named brand presets (values owned by `sdkwork-ui`): `zinc`, `tech-blue`, `lobster`, `green-tech`, `violet`, `rose`. Each preset `MUST` provide the full ramp; a preset with a partial ramp `MUST NOT` ship.

### 5.3 Switching and custom brands

- Brand selection is expressed by the preset attribute (`data-theme="<preset>"`) on the same root as the mode attribute, or programmatically through the provider API (`SdkworkThemeProvider themeColor` / `ShellBridge preferences.themeColor`).
- Integrators `MAY` inject a **custom brand** by overriding the ramp variables (all 11 steps) or the semantic brand tokens via the provider `overrides` contract, or by CSS custom properties on the surface root at higher specificity than the preset block. Custom brands `MUST` provide the full ramp — patching one or two ad-hoc hex values over a preset is forbidden (it breaks derived hovers/softs).
- Precedence: runtime override (inline custom properties from the provider) > preset attribute > default preset.
- Brand switching `MUST NOT` be implemented by rewriting component classes, reloading stylesheets, or remounting the tree.

## 6. Platform Mapping

| Platform | Mode root | Brand root | OS resolution | Notes |
| --- | --- | --- | --- | --- |
| Web PC / H5 (React) | `documentElement` or app root: `data-sdk-color-mode` + `.dark` | same root `data-theme` | theme provider only | boot anti-flash script required (§3.3) |
| Host-embedded plugin surface | plugin surface root element | surface root | host bridge (§7) | `MUST NOT` write page-level roots (§7 isolation) |
| Flutter | `MaterialApp.themeMode` + `ThemeData(brightness: …)` built from `ColorScheme.fromSeed(seedColor: brand500, brightness: …)` | seed color from the same preset table | one `ThemeMode.system` resolver at app root | `MUST NOT` read `platformBrightnessOf` in widgets; components consume `Theme.of(context).colorScheme` roles mapped from the semantic token table |
| Mini program (WeChat et al.) | page root class (`theme-dark` when `data-sdk-color-mode` attribute is unavailable) + `theme.json` `darkmode: true` | app-level CSS variables on page root | `wx.onThemeChange` in the single theme service | wxss `MUST` use CSS variables re-declared under the page-root dark class; `@media (prefers-color-scheme)` in wxss is forbidden except inside the theme service's `darkmode` auto path |
| Desktop composition | host `documentElement` | host root | host theme runtime | embedded surfaces follow §7 |

Flutter semantic mapping requirement: the 11-step brand ramp `MUST` be materialized as `MaterialColor` (swatch index 500 = primary) and the semantic roles (§2.1) mapped to `ColorScheme` fields (`surface`, `onSurface`, `outline`, `error`, …) in one theme builder module.

## 7. Embedded / Host Integration Contract

SDKWork surfaces are composed as plugins into hosts (harness, super-apps, third-party shells). The integration contract keeps them adaptive and non-invasive:

### 7.1 Host theme bridge

The host provides a minimal bridge (reference: `HostThemeBridge` in the harness; `ShellBridge preferences` in sdkwork-ui):

```ts
interface HostThemeBridge {
  getColorScheme(): 'light' | 'dark'
  subscribe(listener: () => void): () => void
}
```

Rules:

- The embedded surface `MUST` render its content under a surface root that carries `data-sdk-color-mode` + `.dark` (or platform equivalent), driven by the bridge.
- The surface root `SHOULD` mirror the mode onto `documentElement` **only when** the host grants it — and the mirror `MUST` snapshot and restore the previous root state on unmount (reference: `SdkworkHostThemeSurface`). Surfaces whose CSS is fully scoped to the surface root `SHOULD NOT` mirror at all.
- The surface `MUST NOT` register its own OS-preference listener, persist its own theme preference, or write `documentElement.style.colorScheme` while a host bridge is connected.

### 7.2 Single-writer arbitration (legacy standalone entries)

Standalone entries that historically applied mode themselves (settings-modal `applyTheme` paths, auth shells) `MUST` arbitrate: when a host-managed marker (`data-sdk-color-mode`, or the mode root class) is present, the embedded surface treats it as authoritative and `MUST NOT` add/remove mode classes on the same root. An embedded surface deleting the host's `.dark` class (the "light OS preference removes host dark mode" failure) is a P0 conformance violation.

### 7.3 Style isolation

Embedded feature CSS `MUST NOT`:

- restyle `body`, `html`, or host chrome elements outside its surface root (the standalone `body { background: … }` blocks of an embedded SDK `index.css` `MUST` be neutralized or scoped when compiled for embedding);
- override host token names;
- use `!important` to win theme cascade fights — fix the ownership instead.

Style tag injection for embedded bundles `MUST` be idempotent (deduplicate by a stable tag id).

### 7.4 Flexibility

- The contract is transport-agnostic: a host may implement the bridge over any runtime (settings store, URL, postMessage, FFI), as long as `getColorScheme`/`subscribe` semantics hold.
- Hosts without a bridge default to standalone behavior (provider-owned, `system`).
- Custom host brands are delivered by overriding ramp variables on the surface root (§5.3) — the surface requires no code change.

## 8. Forbidden Patterns (conformance violations)

| # | Pattern | Severity |
| --- | --- | --- |
| F1 | `prefers-color-scheme` read outside the platform theme provider for styling/theming | P0 |
| F2 | Embedded surface adding/removing mode classes on `documentElement` without host grant, or removing a host-written `.dark`/`data-sdk-color-mode` | P0 |
| F3 | Semantic token set with only one mode's values | P0 |
| F4 | CSS entry compiling `dark:` utilities without `@custom-variant dark` class binding | P0 |
| F5 | Unpaired raw light utility (`bg-white`, `text-gray-900`, …) in a component with no `dark:` counterpart and no token class | P1 |
| F6 | Hardcoded hex in component `className`/`style` for a themeable role (outside media/PDF/export surfaces) | P1 |
| F7 | Brand preset with a partial ramp; custom brand injected as ad-hoc hex patches | P1 |
| F8 | Embedded CSS restyling `body`/host chrome, or `!important` theme cascade fights | P1 |
| F9 | Theme switch requiring remount or stylesheet reload | P2 |
| F10 | Mode-dependent logic reading `matchMedia` per component (N listeners instead of 1) | P2 |
| F11 | A standalone surface exposing a mode switch but no brand-color switch, after its §10 rollout deadline recorded in the matrix | P2 |
| F12 | A platform mapping (Flutter/mini-program) hardcoding palette values instead of consuming the §11 token export | P2 |

## 9. Conformance and Verification

- Mechanical checks: `tools/check-theme-conformance.mjs <repo-root>` — scans for F1 (`prefers-color-scheme` escapes outside allowlisted theme-provider paths), F2 (non-theme `documentElement` class writes for dark mode), F4 (missing `@custom-variant dark` where `dark:` utilities are compiled). The tool is advisory gate input; F5/F6 pairing review is handled by the conformance matrix and code review per `CODE_REVIEW_SPEC.md`.
- Allowlist policy: theme-provider files may read OS preference and write the mode root. Registered owner shapes: framework provider files (`theme-provider`, `ThemeProvider`, `ThemeContext`, `useTheme`, `theme.ts`, `theme-runtime`, `theme-service`, `shell-bridge-provider`, `SdkworkHostThemeSurface`, `sdkwork-theme.ts`), host bridge implementations (`hostAppearanceBridge`), surface theme managers (`ThemeManager`), boot anti-flash scripts (`startupAppearance`), settings presenters (`settingsModalUi`, `settingsPreferences`), and files carrying the §7.2 arbitration guard comment (`THEME_DARKMODE_SPEC`). A file that resolves OS preference but is not an owner `MUST` either delegate to an owner module or be renamed/registered as the owner — inlining reads is never the fix.
- The per-module status matrix lives in `THEME_CONFORMANCE_MATRIX.md` (one row per module: mode contract, token completeness, brand support, tailwind binding, platform notes, open gaps). The matrix `MUST` be updated whenever a module lands or changes its theme mechanism.
- New UI modules `MUST` pass the checker and register a matrix row before release per `RELEASE_SPEC.md`.
- Exemption policy: media/export surfaces (PDF, image croppers, wechat-article simulations, print sheets) are exempt from F6 with a documented reason in the matrix.

## 10. Brand-Switching Exposure (v2)

Every user-facing surface `MUST` eventually expose brand theme-color switching; the depth is staged by surface kind, but the **contract is identical everywhere** so a host or product can turn switching on per surface without code changes.

### 10.1 Contract

- Brand selection rides the same root as the mode: `data-theme="<brand-id>"` (§5.3), resolved by the surface's existing single owner — never by components.
- Standalone apps expose it through the platform provider API (`SdkworkThemeProvider themeColor` / Flutter seed parameter / mini-program theme service `setThemeColor`), persisted beside the mode preference.
- Embedded surfaces consume an **optional** channel on the host bridge:

```ts
interface HostThemeBridge {
  getColorScheme(): 'light' | 'dark'
  subscribe(listener: () => void): () => void
  getThemeColor?(): string | null | undefined   // v2 optional channel
}
```

When present, the surface root carries `data-theme="<id>"`; when absent, the surface keeps its default brand. Hosts adopt brand switching per surface with **zero plugin changes** — this is the integration flexibility requirement.

- Brand attribute mirroring follows §7.1: mode may mirror to `documentElement` under host grant; brand `MUST` stay scoped to the surface root (mirroring brand to page roots leaks preset variables into host chrome).

### 10.2 Rollout stages (recorded per module in the matrix)

| Stage | Meaning |
| --- | --- |
| `contract-ready` | Surface renders `data-theme` from the bridge/provider; no presets UI yet |
| `presets` | ≥ the six §5.2 presets selectable in the surface's settings |
| `custom` | Integrator/custom brand injectable via §5.3 overrides (full ramp required, F7) |

A surface at `contract-ready` or later satisfies F11; a surface with no `data-theme` path after its recorded deadline is F11.

## 11. Cross-Platform Token Single Source (v2)

One token table feeds every platform so brand ramps, semantic roles, and dual-mode values cannot drift:

- **Source of truth:** `sdkwork-ui`'s theme module (`sdkwork-theme.ts` + `sdkwork-ui.css`) — the 11-step brand ramps ×6 presets, the §2.1 semantic set, and both mode blocks.
- **Generators/mappers per platform** (no hand-copied palettes, F12):
  - Web PC/H5: CSS custom properties (authoritative, consumed directly or projected into Tailwind `@theme`).
  - Flutter: one theme-builder module materializing each preset as `MaterialColor` (swatch 500 = primary) and mapping semantic roles onto `ColorScheme.fromSeed`/`ColorScheme` fields (§6). The builder imports the token table from the generated export; it `MUST NOT` restate hex values.
  - Mini program: wxss variables re-declared under the page-root dark class, generated from the same table; `theme.json` `darkmode: true` for the auto path.
  - Native (Android/iOS/HarmonyOS): consume the exported JSON token file via the platform design-token toolchain; semantic role names are stable across platforms.
- **Export shape:** the token table is published as a typed module plus a JSON sidecar (`sdkwork-theme-tokens.json`: `{ presets: { <id>: { ramp: {50…950}, semantic: { light: {...}, dark: {...} } } } }`) so non-TS platforms (Flutter/Dart, Kotlin, Swift, ArkTS) consume one artifact.
- **Change flow:** a ramp or semantic-value change lands in the source table first; platform mappings update in the same change set; the matrix rows of affected modules note the version they consumed.

## 12. Module Alignment Drill (v2)

New and existing modules walk this drill when onboarding or after any theme-affecting change; results land in the matrix:

1. **Register the owner.** Exactly one theme owner module per surface (§3.2); the checker passes with the owner allowlisted or guard-commented (§9).
2. **Bind the variant.** Every CSS entry compiling `dark:` utilities declares `@custom-variant dark` (§4).
3. **Dual-mode completeness.** Every semantic/alias token set defines both mode blocks (§2.2); the dark block restyles tokens only.
4. **Pair audit.** No unpaired raw light utilities (F5); no themeable hex (F6) outside documented exemptions.
5. **Brand path.** Standalone: provider `themeColor` API + persisted preference. Embedded: optional `getThemeColor` channel + `data-theme` on the surface root (§10).
6. **Isolation.** Embedded CSS restyles nothing outside its surface root; no `!important` cascade fights; style injection idempotent (§7.3).
7. **Anti-flash.** Web roots inline the boot mode script (§3.3).
8. **Register the matrix row** with stage, exemptions, and open gaps (§9).
