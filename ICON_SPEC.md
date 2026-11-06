# UI Iconography Standard

- Version: 1.0
- Scope: in-product UI icons on every SDKWork client surface, including mobile bottom tab bars, PC/pad/admin sidebars, navigation rails, drawers, toolbars, icon-only actions, stateful toggles, and status glyphs, plus icon family, sizing, theme, accessibility, asset delivery, and verification contracts; excludes application launcher/store icons
- Related: `APP_ASSETS_SPEC.md`, `APP_MANIFEST_SPEC.md`, `THEME_DARKMODE_SPEC.md`, `FRONTEND_SPEC.md`, `FRONTEND_CODE_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, `APP_PAD_ARCHITECTURE_SPEC.md`, `BACKEND_UI_SPEC.md`, `UNIAPP_APP_ARCHITECTURE_SPEC.md`, `TEST_SPEC.md`, `GOVERNANCE_SPEC.md`
- Changelog v1.0: initial standard; extracts the mobile tab-bar selected-filled/unselected-outline rule from the three mobile UI specs into one cross-architecture authority, extends the same rule to PC/pad/admin sidebars and navigation rails, and adds icon family, metadata, sizing, theme, accessibility, delivery, and verification rules.

This standard is the single authority for how SDKWork product UI draws, names, sizes, themes, and switches icons. Architecture UI standards reference this file and keep only their platform-specific mapping; they `MUST NOT` restate a divergent icon rule. Application launcher icons, store listing icons, and catalog artwork remain owned by `APP_ASSETS_SPEC.md` and `APP_MANIFEST_SPEC.md`.

## 1. Scope And Icon Roles

| Role | Examples | State pairing |
| --- | --- | --- |
| Navigation | bottom tab item, sidebar row, navigation rail destination, drawer item, top-level menu entry | REQUIRED: selected applies the filled variant; unselected applies the outline variant of the same glyph |
| Toggle | favorite, bookmark, like, follow, star, mute, expand | REQUIRED: on applies the filled variant; off applies the outline variant of the same glyph |
| Action | toolbar button, inline command, icon-only control | Not paired; a family may use filled artwork consistently, but fill `MUST NOT` mean hover, pressed, or focus |
| Status | success, warning, error, info, offline, syncing | Fixed glyph; `MUST NOT` be reused as a navigation or toggle icon |
| Decorative | section ornament, illustration accent | Not interactive; hidden from assistive technology |

Rules:

- An icon `MUST` be classified into exactly one role before it is added to a surface.
- Navigation and toggle roles `MUST` have a state pair. An icon that cannot supply both variants `MUST` use the fill fallback in section 3.1 or be replaced.
- A role `MUST NOT` change with state: a navigation icon `MUST NOT` become a status glyph when selected, and a status glyph `MUST NOT` be reused as an unselected navigation icon.
- Application identity media (`media.icons.*`) is not a UI icon and `MUST NOT` be consumed as one in navigation, toolbars, or empty states.

## 2. Icon Family

Rules:

- An application shell `MUST` use one primary icon family for all product UI icons. Capability packages `MUST NOT` introduce a second family for their screens.
- The primary family `MUST` provide outline and filled variants for every navigation and toggle glyph the product ships, or document the fill fallback used for a missing pair.
- Outline artwork `SHOULD` use a 24 x 24 grid, 2 px stroke, at least 2 px internal padding, and consistent round caps, joins, and corner radii across the family.
- The filled variant `MUST` share the outline variant's silhouette, optical bounds, and visual center of mass. A filled icon that is visibly larger, shifted, or shaped differently from its outline counterpart is a review failure.
- A filled asset whose rendered glyph is pixel-identical to its outline asset is not a filled variant, even when the icon font exposes a distinct codepoint. Icon-set review and tests `MUST` compare the rendered shapes, not only the asset or codepoint ids.
- A platform-native symbol family `MAY` be used where the platform owns the chrome (iOS tab bars, Android navigation bars, HarmonyOS system symbols). The selected-filled/unselected-outline semantics in section 3 still apply.
- The following are forbidden as product UI icons: emoji, text characters and ligature stand-ins, raster screenshots, CSS-drawn approximations of a glyph, and mixed stroke and filled families inside one navigation set.
- Brand and third-party product marks `MAY` use supplied official artwork and are exempt from the fill pairing rule, but they `MUST NOT` stand in for a navigation state pair and `MUST NOT` be recolored beyond the monochrome treatment the brand allows.

## 3. Navigation And Toggle State Pairing

### 3.1 Universal Rule

For every navigation and toggle destination:

- The **selected** (or on) state `MUST` render the **filled** variant.
- Every **unselected** (or off) state `MUST` render the **outline** (unfilled) variant of the **same glyph**.
- Selected and unselected variants `MUST` represent the same base glyph (its outline asset and its filled counterpart), with identical optical box, size, alignment, and baseline. Only the fill treatment changes.
- Selection `MUST NOT` be conveyed by color alone. The fill treatment is the primary non-color signal; a visible label, selected surface or indicator, or selected semantic role `SHOULD` reinforce it.
- The selected state `MUST NOT` be simulated by increasing stroke width, adding a shadow, scaling the glyph, or applying a glow. A stroke-only family that has no filled asset `MUST` fill the same closed path(s) with `currentColor`; open-path glyphs that cannot be filled `MUST` ship a real filled counterpart.
- Hover, pressed, and focus states `MUST NOT` change the icon fill. They use surface, color, or focus-ring treatment instead.
- A navigation set `MUST NOT` mix conventions: selected outline, unselected filled, two different glyph shapes, or a color-only selection are all review failures.
- A disabled destination keeps its state variant and applies the disabled token. A disabled selected destination stays filled and disabled.
- A badge, count, or dot `MUST NOT` replace the state pair.

### 3.2 Mobile Bottom Tab Bar

Every mobile application surface that renders a bottom tab bar `MUST` apply section 3.1: the selected tab uses the filled icon and every unselected tab uses the outline icon of the same glyph. This applies to H5/Capacitor React, Flutter, mini program, native Android, native iOS, native HarmonyOS, uni-app, and uni-app x roots.

Rules:

- A bottom tab bar `MUST NOT` ship an icon set with only one variant. A single-variant tab bar is a review failure.
- Tab labels `MUST` remain visible and localized. The filled icon reinforces selection; it `MUST NOT` replace the label.
- The platform's native selected-icon slot `MUST` be used when one exists (section 4).
- A custom tab bar that replaces a native one `MUST` preserve the same pair, label, selected semantics, and touch target.
- Light and dark themes `MUST` both render a legible pair. A native tab bar that cannot theme separate raster assets `MUST` use theme-neutral monochrome assets that remain legible on both surfaces, or a custom tab bar with theme-aware assets.
- Tab-bar visibility remains a shell/composition concern owned by the root UI standard; this standard owns only the icon state pair.

### 3.3 PC, Pad, And Admin Sidebar And Navigation Rail

Every PC sidebar, pad navigation rail, backend/admin operator sidebar, and collapsible side navigation `MUST` apply section 3.1.

Rules:

- The active destination row `MUST` render the filled variant. Every inactive row `MUST` render the outline variant of the same glyph.
- The active row `SHOULD` also carry a selected surface, leading indicator bar, or equivalent selected container treatment. The filled icon is required independently of that treatment.
- A parent or group header icon `MUST` render the filled variant when the group contains the active destination and the outline variant otherwise. Group expansion state `MUST NOT` be encoded by icon fill; the chevron or disclosure indicator rotates instead.
- A collapsed rail `MUST` keep the filled active variant plus a selected indicator, and `MUST` expose the destination name through a tooltip and an accessible name. Collapsing or expanding the rail `MUST NOT` change which variant is filled.
- Hovering a sidebar row or the sidebar itself `MUST NOT` fill the icon or the icon set. Hover uses the row surface only.
- A pad root at `medium` width and above follows this section through its navigation rail or sidebar. A bottom tab bar stretched across a tablet `MUST NOT` replace this pattern (`APP_PAD_ARCHITECTURE_SPEC.md` section 5.2).
- Backend/admin operator navigation follows the same rule; operator surfaces are not exempt from product icon quality.

### 3.4 Other Navigation And Toggle Surfaces

- Drawers, top navigation bars, segmented navigation, and tree navigation `MUST` use the same selected-filled/unselected-outline pairing for their destination icons.
- A disclosure chevron, caret, or expand arrow indicates direction or expansion only. It `MUST NOT` change fill to signal selection.
- Breadcrumb separators, overflow menus, and context-menu affordances are action or decorative icons and `MUST NOT` be filled to imply the current page.
- Toggle controls (favorite, bookmark, like, follow, mute) `MUST` use filled when on and outline when off, including inside lists and cards.

## 4. Platform Mapping

| Surface | Native selected slot or mechanism | Required implementation |
| --- | --- | --- |
| H5 / PC / pad / admin React | shared shell icon component with an explicit selected prop | Render the pair from one component (`<NavIcon outline={...} filled={...} selected={...} />` or equivalent). Inline SVG with `currentColor`; no CSS filter, font ligature, or opacity trick to fake the filled state. |
| Flutter | `NavigationDestination(icon:, selectedIcon:)` and `NavigationRailDestination(icon:, selectedIcon:)` | Pass the outline icon to `icon` and the filled icon to `selectedIcon`. Do not render one icon and rely on a color or opacity branch for selection. |
| Mini program | `tabBar.list[].iconPath` and `selectedIconPath`, or a custom tab bar | Declare both paths for every tab. Native tab icons use the platform's required square PNG size (for example 81 x 81 on WeChat) within the platform size limit; a custom tab bar consumes the same pair. |
| Native Android | Material 3 `NavigationBarItem` / `NavigationRailItem` icon slot | Render `Icons.Filled.*` when selected and `Icons.Outlined.*` otherwise. Legacy Views use a state-list drawable whose selected state is the filled vector. |
| Native iOS | `UITabBarItem(title:image:selectedImage:)`, `UITabBarAppearance`, or SwiftUI symbol variant | Use `selectedImage` where available; with SwiftUI use `Image(systemName:)` plus `.symbolVariant(selected ? .fill : .none)` in a selected-aware tab item, or a custom tab bar that renders the pair. SF Symbols pairs such as `house` / `house.fill`. |
| Native HarmonyOS | `TabContent.tabBar(builder)` driven by the selected index, or the shell's navigation component | Render the filled symbol or resource for the active index and the outline symbol for every other index. A side navigation uses the same selected-state input. |
| uni-app | `pages.json` `tabBar.list[].iconPath` and `selectedIconPath`, or a custom tab bar | Declare both paths for every tab on every target that renders the native tab bar; custom tab bars consume the same pair. |
| uni-app x | `pages.json` `tabBar.list[].iconPath` and `selectedIconPath`, or a custom tab bar in `.uvue` | Declare both paths for every tab on every target that renders the native tab bar; custom tab bars consume the same pair. App tab icons use the platform asset rules, and a `vapor` root `MUST NOT` replace the pair with a dynamic recolored glyph. |
| Unity (when a tab or rail is shipped) | sprite pair driven by the selected index | Use the outline sprite for unselected and the filled sprite for selected; do not tint the same sprite as the only state change. |

Rules:

- When the platform exposes a native selected-icon slot, it `MUST` be used instead of a custom color-only workaround.
- A platform `MUST NOT` use a color-only selected state because another platform supports a fill swap; the pair is mandatory everywhere.
- Platform symbol naming `MUST` stay explicit: outline and filled variants `MUST` be different named assets, not one asset with a runtime filter.
- If a platform's native component cannot express the pair (for example a tab bar API with one image slot), the surface `MUST` use a custom tab bar that does, or the closest native selected-image mechanism. Falling back to one outline icon for both states is forbidden.

## 5. Route And Menu Metadata

Stateful navigation entries `MUST` declare both variants in metadata, not just at the render call site.

```ts
export interface SdkworkNavIcon {
  outline: string;
  filled: string;
}

export interface SdkworkNavigationEntry {
  id: string;
  titleKey: string;
  icon: SdkworkNavIcon;
}

const ordersTab: SdkworkNavigationEntry = {
  id: "app.commerce.orders.list",
  titleKey: "commerce.orders.tab",
  icon: { outline: "receipt", filled: "receipt-filled" },
};
```

Rules:

- A tab-bar, sidebar, navigation-rail, drawer, or toggle destination `MUST` declare an `icon` object with both `outline` and `filled`. A single icon id is not a valid stateful navigation declaration.
- Icon ids `MUST` be lowercase kebab-case glyph names (`home`, `shopping-cart`, `chart-line`). The filled asset `MUST` be identified by the `filled` field or the `-filled` suffix (`home-filled`); asset names `MUST NOT` use `active`, `selected`, `inactive`, `normal`, `hover`, `on`, or `off`.
- A destination `MUST` use one stable glyph pair across PC, pad, H5, Flutter, mini program, native mobile, uni-app, and uni-app x implementations of the same workflow.
- The application shell/foundation package `MUST` own the icon registry and the mapping from id to rendered asset. Capability packages `MUST` reference registry ids and `MUST NOT` ship one-off navigation icons that bypass the registry.
- A missing filled counterpart is a defect. The capability `MUST` add the asset, use the section 3.1 fill fallback, or fall back to a text-only destination; it `MUST NOT` render a single-variant icon that misrepresents state.
- Route metadata `MUST NOT` declare raw SVG markup, inline path data, remote icon URLs, or per-platform icon overrides that contradict the shared pair.

## 6. Size, Grid, And Spacing

| Context | Glyph box | Touch/click target |
| --- | --- | --- |
| Bottom tab bar | 24 | At least 44 x 44 on iOS and 48 x 48 on Android/touch surfaces |
| Expanded sidebar row | 20 | Row height at least 36 desktop and 44 touch |
| Collapsed sidebar rail | 24 | At least 44 x 44 |
| Pad navigation rail | 24 | At least 48 x 48 |
| Toolbar / icon-only button | 20 | At least 32 x 32 pointer and 44 x 44 touch |
| Inline with text | 16 | Not interactive; aligned to the text baseline |
| Empty state / illustration | 32-48 | Not interactive |

Rules:

- 24 is the default UI icon size. 20 is the compact navigation size. 16 is reserved for inline text adornment. A navigation destination `MUST NOT` use 16.
- A family `MUST` provide optical sizes for the sizes a surface uses. Scaling a 16 px asset up to 32 px, or a 24 px asset down to 16 px with a thinning stroke, is a review failure.
- Outline and filled variants `MUST` occupy the identical box. The filled variant `MUST NOT` overflow the outline bounds or change the icon's apparent size when selected.
- Icon-only touch targets `MUST` meet the platform minimum even when the visible glyph is smaller. The target may be larger than the glyph through padding.
- A badge or count `MUST` be anchored in an overlay layer at the top-right of the icon box. It `MUST NOT` shift, clip, or resize the icon. A dot is at least 8 px with a 2 px surface ring; a count badge is at least 16 px tall with readable text.
- Label spacing `MUST` stay constant across states. A tab label or sidebar label `MUST NOT` reflow when the icon fill changes.
- Icons `MUST` be optically centered in their box; clipping, uneven padding, and baseline drift against the label are review failures.

## 7. Color And Theme

Icons consume semantic tokens; they `MUST NOT` hardcode palette values.

| Token | Role |
| --- | --- |
| `--sdk-color-icon-primary` | Default icon on standard surfaces |
| `--sdk-color-icon-secondary` | Unselected navigation and secondary actions |
| `--sdk-color-icon-selected` | Selected navigation and on-state toggle |
| `--sdk-color-icon-disabled` | Disabled icon |
| `--sdk-color-icon-on-brand` | Icon on a brand-filled surface |
| `--sdk-color-icon-danger` | Destructive action or error status |

Rules:

- The token set `MUST` be declared in both light and dark mode by the theme owner (`THEME_DARKMODE_SPEC.md` section 2.1). A component `MUST NOT` resolve mode or brand itself.
- SVG icons `MUST` use `currentColor` or a token-backed color. Raw hex values, per-state literal colors, CSS filters, and opacity-only state swaps are forbidden inside icon components.
- Selected and unselected icons `MUST` each meet the WCAG 1.4.11 non-text contrast threshold (3:1) against their immediate background. When an icon is the only carrier of text-equivalent information, it `MUST` meet 4.5:1.
- Disabled icons are exempt from the contrast minimum but `MUST` remain distinguishable from enabled icons and `MUST NOT` be the only signal that a control is unavailable.
- Both modes `MUST` render both variants. A pair that is legible in light mode and invisible or muddy in dark mode is a review failure.
- Mini program and other raster tab assets `MUST` be monochrome, theme-neutral artwork or ship theme-specific assets through a custom tab bar. A light-only raster pair is a review failure.
- In forced-colors and high-contrast modes the label, selected indicator, or selected semantic role `MUST` still convey selection when the fill flattens.

## 8. Accessibility

Rules:

- An icon-only control `MUST` have an accessible name (`aria-label`, `contentDescription`, `accessibilityLabel`, or the platform equivalent) and a tooltip when the glyph is not universally understood.
- A decorative icon `MUST` be hidden from assistive technology (`aria-hidden="true"`, `contentDescription = null`, or the platform equivalent).
- A tab bar destination `MUST` expose role, label, and selected state (`aria-selected`, native tab selected trait). A sidebar destination `MUST` expose the current page (`aria-current="page"` or the platform equivalent).
- A collapsed sidebar rail `MUST` expose the destination name to assistive technology and on hover/focus, not only through the glyph.
- Selection `MUST NOT` be conveyed by color alone; the filled variant, label, selected indicator, and selected semantic state provide redundant cues.
- Focus `MUST` be visible and `MUST NOT` be hidden by the icon or its selected background. The focus ring `MUST` meet the contrast requirements of `FRONTEND_CODE_SPEC.md` section 7.
- Directional glyphs `MUST` mirror in right-to-left locales: back/forward, chevrons, arrows, indent/outdent, undo/redo, and reply/forward. Brand marks, media transport controls, checkmarks, clocks, search, and plus/minus `MUST NOT` mirror.
- Animated icon transitions `MUST` respect reduced-motion preferences (section 9).
- An icon `MUST NOT` be the only signal for a destructive, irreversible, or permission-sensitive action; pair it with text or an accessible confirmation.

## 9. Motion

- A state transition `MAY` crossfade or morph between the outline and filled variants over 120-200 ms.
- The selected state `MUST` be committed immediately in the data and accessibility tree; motion `MUST NOT` delay feedback or block interaction.
- The transition `MUST NOT` shift layout, scale the glyph, or animate the label.
- `prefers-reduced-motion` or the platform equivalent `MUST` reduce the transition to an instant swap.
- Navigation icons `MUST NOT` loop, pulse, bounce, or autoplay animation. A loading or syncing status glyph is a status icon and follows the platform progress convention.

## 10. Asset Delivery And Naming

Rules:

- Web and React surfaces `MUST` deliver icons as inline SVG components or a tree-shakeable sprite, sanitized at build time, with no `<script>`, external `href`, embedded raster, or base64 payload.
- Icon fonts `MUST NOT` be the only delivery mechanism. When a platform symbol font is used, it `MUST` be subset, declared with accessible names, and never rely on ligature text as the only label.
- Icons `MUST` be bundled with the application or design-system package. Runtime network fetches, CDN icon URLs, and remote sprite services are forbidden for product navigation icons.
- One of these layouts `MUST` be used consistently per surface: `icons/<glyph>.svg` plus `icons/<glyph>-filled.svg`, or `icons/<glyph>/outline.svg` plus `icons/<glyph>/filled.svg`.
- Raster assets are allowed only where the platform requires them (mini program tab icons, native notification/status assets). They `MUST` be exported at the platform size from the vector source and optimized.
- The build `MUST` include both variants for every declared navigation entry. A production bundle that resolves only one variant is a release blocker.
- Icon asset versions follow the application version; no independent remote icon version channel is allowed.

## 11. Exceptions And Migration

- A deviation from this standard `MUST` be recorded through `GOVERNANCE_SPEC.md` section 3 with an owner, reason, risk, expiry, and removal plan.
- A missing filled counterpart `MUST NOT` be recorded as an exception. Add the asset, use the section 3.1 fill fallback, or ship a text-only destination.
- A new surface `MUST` comply from its first release. An existing surface with a legacy single-variant set `MUST` migrate when that surface is next changed for an unrelated reason, and `MUST` record the remaining gap.
- A platform that cannot express the pair natively `MUST` use a custom shell component rather than an exception that preserves the defect.

## 12. Verification

Verification evidence for an icon change `MUST` include:

- a component or widget test proving the selected state renders the filled variant and every unselected state renders the outline variant of the same glyph for each navigation and toggle destination;
- a metadata test proving every stateful navigation entry declares both `outline` and `filled`, and failing when only one id is present;
- an accessibility test proving icon-only names, decorative hiding, and programmatic selected/current state;
- a light-mode and dark-mode render for both variants, or a visual regression snapshot covering them;
- a rendered-shape comparison proving the selected filled glyph differs from the outline glyph in pixels, not only in codepoint or asset id;
- a platform test proving mini program/uni-app/uni-app x `iconPath` and `selectedIconPath` both exist and native mobile tab/rail items use the platform selected slot;
- a static scan or review proving no color-only, stroke-thickening, scaling, or filter-based fill substitute was introduced.

`TEST_SPEC.md` section 4 defines the executable frontend obligations; a repository `MUST` wire the equivalent gate into its verify aggregate when it ships navigation icons.

## 13. Acceptance Checklist

- [ ] Every product surface uses one primary icon family.
- [ ] Every navigation and toggle destination declares an outline/filled pair.
- [ ] The selected tab-bar destination is filled; every unselected destination is outline.
- [ ] The active PC/pad/admin sidebar or rail destination is filled; every inactive destination is outline.
- [ ] A group header fills only when it contains the active destination.
- [ ] Selection is never conveyed by color alone and never faked by stroke width, scale, shadow, or filter.
- [ ] The platform's native selected-icon slot is used when available.
- [ ] Route/menu metadata declares both variants with stable kebab-case ids.
- [ ] Icon sizes, touch targets, badges, and label spacing follow section 6.
- [ ] Icons consume theme tokens and render correctly in light and dark mode.
- [ ] Icon-only controls have accessible names; decorative icons are hidden; selected state is exposed.
- [ ] Directional icons mirror in RTL; non-directional icons do not.
- [ ] Reduced motion produces an instant state swap.
- [ ] SVG/raster assets are sanitized, bundled, and complete for both variants.
- [ ] Tests or visual evidence cover selected and unselected states in both themes.
- [ ] Any deviation is recorded with an owner and expiry.
