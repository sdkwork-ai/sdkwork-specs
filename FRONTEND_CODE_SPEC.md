# Frontend Code Standard

- Version: 2.0
- Scope: React, PC browser UI, PC desktop renderer UI, H5 mobile React, Flutter UI, mini program UI, native Android UI, native iOS UI, native HarmonyOS UI, backend/admin UI, frontend services, state, i18n, and UI tests
- Related: `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `TAILWIND_CSS_INTEGRATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, `BACKEND_UI_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`, `DART_CODE_SPEC.md`, `I18N_SPEC.md`, `TEST_SPEC.md`

This standard applies only when frontend, renderer, UI, React, Flutter, mini program UI, native Android/iOS/Harmony UI, or backend/admin UI code is touched. Application-wide UI-service-SDK dependency direction follows `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`.

Language-level rules live in `TYPESCRIPT_CODE_SPEC.md` (React/TS), `DART_CODE_SPEC.md` (Flutter), and the native language specs; this standard owns the UI-level discipline shared across surfaces. It targets industry-best React practice (React docs, ESLint react-hooks rules, Testing Library guidance) narrowed to SDKWork's architecture.

## 1. Architecture Selection

Rules:

- Read `UI_ARCHITECTURE_SPEC.md` before creating or moving UI packages.
- Client app roots also follow `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` and their matching root standard: `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, or `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`.
- Then load exactly one detailed UI/package spec for the touched surface: `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, or `BACKEND_UI_SPEC.md`.
- Do not import UI components, routes, host adapters, or runtime wrappers across architecture families.

## 2. UI-Service-SDK Flow

Required flow:

```text
UI component
  -> hook or page service
  -> domain service
  -> injected generated SDK client or approved composed wrapper
```

Rules:

- UI components must not construct SDK clients.
- UI components must not manually assemble raw HTTP requests or auth headers.
- User-facing UI uses app SDK surfaces.
- `backend-admin` UI uses backend SDK surfaces.
- Frontend services normalize loading, empty, permission-denied, validation, and problem-detail error states.

## 3. Component Organization

Recommended package shape:

```text
src/
  index.ts
  components/
  pages/
  hooks/
  services/
  state/
  i18n/
  routes/
  tests/
```

Architecture-specific standards may replace `src/`, `index.ts`, and package manifests with Dart, Kotlin/Gradle, Swift Package, ArkTS/ohpm, mini program, or React equivalents. The logical responsibilities stay aligned: public export, screens/pages, components/widgets/views, services, state, i18n, routes/navigation, host adapter contracts, tests, and component specs.

Rules:

- Components focus on rendering and local interaction.
- Pages compose components, hooks, and services.
- Services own SDK calls and business orchestration.
- Route/menu metadata stays in the owning package family.
- User-facing text uses i18n/message catalogs when the package is reusable or user-facing.
- `i18n/` owns package-local locale fragments and thin exports only. Do not author a whole app, whole client root, or whole package locale in one large file; follow `I18N_SPEC.md` section 6.1 for the selected language/framework directory layout and catalog fragmentation rules.

## 4. React Component Discipline

Rules:

- Prefer function components; class components are allowed only at legacy boundaries with a
  documented migration note.
- Hooks `MUST` follow the Rules of Hooks (top-level, unconditional, and `use`-prefixed). The
  `react-hooks` ESLint plugin (`rules-of-hooks`, `exhaustive-deps`) is mandatory and `MUST` be
  clean.
- A component `MUST` be a pure function of its props and state: no side effects in the render
  body. Side effects belong in `useEffect` or event handlers.
- `useEffect` `MUST` declare every dependency (`exhaustive-deps`); effects `MUST` return a
  cleanup for subscriptions, timers, and event listeners.
- Do not derive state in `useEffect` from props when `useMemo`/direct derivation during render is
  correct; effects are for synchronization with the outside world, not state derivation.
- Keep props minimal and explicit; destructure props at the top of the component. Prefer
  primitive props over passing whole store slices.
- Lists `MUST` have stable, unique `key`s (id-based, never index when the list can reorder or
  filter); keys must be stable across renders.
- Controlled inputs: value + onChange always paired; uncontrolled inputs are the exception for
  performant one-off forms and must be documented.
- Error boundaries: route/page-level error boundaries `MUST` exist so a render error surfaces a
  recoverable state instead of a blank screen; boundary boundaries should reset on navigation.
- Lazy-load route pages with `React.lazy`/`Suspense` for code splitting; `MUST NOT` lazy-load
  small, critical-above-the-fold components.
- Do not spread props into DOM elements blindly (`<div {...props}>`) when the props may carry
  event handlers with stale closures; spread only the documented subset.
- Render lists of UI via components, not inline JSX maps with heavy logic; extract an item
  component when the item has state or callbacks.

## 5. State Management

Rules:

- Split server state from client state: server data goes through services/SDK clients and a
  query/cache layer (React Query or approved equivalent); client state stays local or in the
  store.
- Prefer local state (`useState`/`useReducer`) for component-scoped state; promote to a global
  store (Zustand per repository baseline) only when multiple unrelated components share it.
- Stores `MUST` be minimal and typed: slice per domain, actions as typed functions, and no
  store module with mixed domains.
- Global state `MUST NOT` duplicate server state that a query layer already caches; stale
  duplication causes sync bugs.
- Store updates `MUST` be immutable; use structured update helpers, not `store.x.push()`.
- Avoid storing derived data in state; derive with selectors/`useMemo` from source state.
- `MUST NOT` put tokens/credentials in UI state, session storage mirrors, or browser public
  runtime env (see section 6 of the FRONTEND data rules and `SECURITY_SPEC.md`).

## 6. Performance

Rules:

- `useMemo`/`useCallback` only where they measurably prevent re-render storms or unstable
  dependency churn; do not sprinkle them by default. Profile before optimizing.
- `React.memo` on expensive list items and stable presentational components; `MUST NOT` memo
  components whose props change identity every render.
- Lists beyond ~100 rows `MUST` virtualize (react-window or equivalent) when the list is
  scrollable and data-driven.
- Code splitting at route/page granularity; large charts, editors, and media viewers lazy-load.
- Avoid layout thrash: batch state updates (`startTransition` for non-urgent updates), do not
  read layout synchronously in a loop.
- Debounce search/filter inputs that hit the network; cancel in-flight requests on unmount
  (`AbortController`).
- Bundle hygiene: no duplicate React copies, no huge dependency pulled into the entry chunk
  without `import()` splitting; verify with the bundler analyzer in CI when budgets are set.

## 7. UX And Accessibility

Rules:

- `backend-admin` UI should optimize for dense operational workflows: tables, filters, drawers, dialogs, tabs, and repeated actions.
- App UI should match the selected product architecture and not import `backend-admin` UI packages.
- Buttons, inputs, tabs, menus, toggles, sliders, and dialogs should use the design system or established local primitives.
- Loading, empty, error, permission-denied, and validation states must be explicit.
- Interactive elements need accessible names and keyboard behavior where applicable:
  - Every interactive element has an accessible name (`aria-label`/`aria-labelledby` or visible
    text); icons alone are not enough.
  - Focus is visible and follows a logical tab order; dialogs trap focus and restore focus on
    close.
  - Form errors are announced (`aria-describedby`, `role="alert"`) and keyboard-reachable.
  - Color is not the only signal for state (loading, error, selection); pair with text/icon.
  - Images have `alt`; decorative images are `alt=""`.
- Respect user preference: honor `prefers-reduced-motion` for animations, and `prefers-contrast`
  where the design system supports it.

## 8. State And Data

Rules:

- Keep server state behind services, generated SDK clients, or established query/cache libraries.
- Do not persist presigned URLs, object keys, `File` objects, raw provider URLs, or upload part lists as business identity.
- Drive-backed media and upload behavior follow `DRIVE_SPEC.md` and `MEDIA_RESOURCE_SPEC.md`.
- Tokens and credentials must not enter browser public runtime env, i18n catalogs, screenshots, logs, or frontend bundles.

## 9. Styling And Tailwind CSS

Rules:

- PC and H5 Vite applications `MUST` follow `TAILWIND_CSS_INTEGRATION_SPEC.md`.
- Application shell CSS owns the single `@import "tailwindcss"` bootstrap.
- Feature packages use Tailwind utility classes in components; they do not re-bootstrap the Tailwind engine in host-composed CSS.
- Shared UI libraries may bootstrap Tailwind only for standalone library build stylesheets documented in `TAILWIND_CSS_INTEGRATION_SPEC.md`.
- Component styles use the design-token system; do not hardcode brand colors/spacings that tokens
  already define (see `design-token` conventions in the repo).

## 10. Browser PC/H5 Build Output Layout

Authority: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1.

```text
apps/sdkwork-<code>-pc/dist/{standalone,cloud}/{dev,test,staging,prod}/
apps/sdkwork-<code>-h5/dist/{standalone,cloud}/{dev,test,staging,prod}/
```

- `build.outDir` = `dist/<deploymentProfile>/<envAlias>` — for example
  `dist/standalone/prod`, `dist/cloud/dev`
  (`development`→`dev` … `production`→`prod`; `standalone` is the default
  profile). The profile subtree keeps standalone (same-origin) and cloud
  (unified `api-*` edge) builds coexisting without overwriting each other.
- PC and H5 `MUST NOT` share an `outDir`; bare `dist/` and environment-only
  `dist/<envAlias>/` layouts are forbidden.
- Repository roots `MUST` expose `build:pc:<env>` / `build:h5:<env>` plus the
  `:cloud` variants; app surfaces `MUST` expose `build:<env>` and
  `build:<env>:cloud` per `PNPM_SCRIPT_SPEC.md` §4.2.
- Check: `node tools/check-browser-dist-layout.mjs --root <module>` and `node tools/check-browser-build-scripts.mjs --root <module>`.

## 11. Frontend Testing

Rules:

- Component tests use Testing Library (`@testing-library/react`) and `vitest`/`jest` per
  repository baseline. Test through user-visible behavior: `getByRole`/`getByLabelText`/`findBy`,
  not implementation queries (`getByTestId` only for genuinely non-semantic hooks).
- Prefer testing rendered behavior and user interactions over snapshot tests; snapshots are
  allowed only for stable, generated fixtures.
- Cover the five UI states per surface: loading, empty, error, permission-denied, and success.
- Async component tests use `findBy*`/`waitFor` with fake timers controlled explicitly; `MUST
  NOT` rely on real timers or network.
- Mock SDK clients at the service boundary (fake client injection), never mock the component's
  DOM library.
- Service tests use fake generated SDK clients or generated SDK clients (see section 8 of the
  FRONTEND verification rules).
- Visual or browser verification is required for substantial UI changes when a runnable app
  exists.

## 12. Anti-Patterns

Forbidden:

- Components that call SDKs, fetch raw HTTP, or assemble auth headers.
- State stored in module-level mutable singletons mutated from components.
- `useEffect` that sets state derived from props (derived-during-render is correct).
- `key={index}` on reorderable/filterable lists.
- Deeply nested prop drilling beyond ~3 levels without a context/store; context used for
  high-frequency updates without memoized value.
- Giant components (> ~300 lines of JSX) that render, orchestrate, and manage state together.
- Inline `onClick={() => fn(a, b)}` in hot lists where stable callbacks matter, unless
  measured; `useCallback` + `data-*` delegation preferred in virtualized rows.
- Uncaught render errors without an error boundary.
- Duplicating server state into client stores.
- Hardcoded strings for user-facing copy outside i18n catalogs in reusable/user-facing packages.

## 13. Verification

Rules:

- Service tests use fake generated SDK clients or generated SDK clients.
- UI tests cover key loading, empty, error, permission-denied, and success states.
- Architecture scans must prove the package family uses the correct SDK surface and does not import forbidden UI/runtime packages.
- Application layering scans `MUST` prove UI components do not call raw HTTP and services do not construct SDK clients locally.
- Visual or browser verification is required for substantial UI changes when a runnable app exists.
- Tailwind integration changes `MUST` run `check-tailwind-integration.mjs`.
- Adaptive Web PC/H5 Vite builds `MUST` pass `check-browser-dist-layout.mjs`.
- React hook-rule and accessibility linting `MUST` be clean (`react-hooks`,
  `jsx-a11y` per repository baseline).

## 14. Acceptance Checklist

- [ ] Correct UI architecture spec was loaded.
- [ ] UI -> service -> SDK flow is preserved.
- [ ] Components do not construct SDK clients or raw HTTP requests.
- [ ] `check-application-layering.mjs` passes when package services, UI, or SDK injection code is touched.
- [ ] Text, errors, and permissions are surfaced intentionally.
- [ ] Package family naming and SDK surface checks pass.
- [ ] PC/H5 `outDir` uses `dist/{standalone,cloud}/{dev,test,staging,prod}` (`check-browser-dist-layout.mjs`).
- [ ] React hooks rules are clean; no index keys on reorderable lists; error boundaries present.
- [ ] Accessibility: interactive elements have accessible names and keyboard behavior; color is
      not the only signal.
- [ ] UI tests cover loading/empty/error/permission-denied/success states for changed surfaces.
