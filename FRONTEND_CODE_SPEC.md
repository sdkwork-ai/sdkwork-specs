# Frontend Code Standard

- Version: 1.0
- Scope: React, PC browser UI, PC desktop renderer UI, H5 mobile React, Flutter UI, mini program UI, native Android UI, native iOS UI, native HarmonyOS UI, backend/admin UI, frontend services, state, i18n, and UI tests
- Related: `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `TAILWIND_CSS_INTEGRATION_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_PC_REACT_UI_SPEC.md`, `APP_MOBILE_REACT_UI_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APP_MINI_PROGRAM_UI_SPEC.md`, `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`, `BACKEND_UI_SPEC.md`, `I18N_SPEC.md`, `TEST_SPEC.md`

This standard applies only when frontend, renderer, UI, React, Flutter, mini program UI, native Android/iOS/Harmony UI, or backend/admin UI code is touched. Application-wide UI-service-SDK dependency direction follows `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`.

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

## 4. UX And Accessibility

Rules:

- `backend-admin` UI should optimize for dense operational workflows: tables, filters, drawers, dialogs, tabs, and repeated actions.
- App UI should match the selected product architecture and not import `backend-admin` UI packages.
- Buttons, inputs, tabs, menus, toggles, sliders, and dialogs should use the design system or established local primitives.
- Loading, empty, error, permission-denied, and validation states must be explicit.
- Interactive elements need accessible names and keyboard behavior where applicable.

## 5. State And Data

Rules:

- Keep server state behind services, generated SDK clients, or established query/cache libraries.
- Do not persist presigned URLs, object keys, `File` objects, raw provider URLs, or upload part lists as business identity.
- Drive-backed media and upload behavior follow `DRIVE_SPEC.md` and `MEDIA_RESOURCE_SPEC.md`.
- Tokens and credentials must not enter browser public runtime env, i18n catalogs, screenshots, logs, or frontend bundles.

## 6. Styling And Tailwind CSS

Rules:

- PC and H5 Vite applications `MUST` follow `TAILWIND_CSS_INTEGRATION_SPEC.md`.
- Application shell CSS owns the single `@import "tailwindcss"` bootstrap.
- Feature packages use Tailwind utility classes in components; they do not re-bootstrap the Tailwind engine in host-composed CSS.
- Shared UI libraries may bootstrap Tailwind only for standalone library build stylesheets documented in `TAILWIND_CSS_INTEGRATION_SPEC.md`.

## 7. Browser PC/H5 Build Output Layout

Authority: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1.

```text
apps/sdkwork-<code>-pc/dist/{dev,test,staging,prod}/
apps/sdkwork-<code>-h5/dist/{dev,test,staging,prod}/
```

- `build.outDir` = `dist/<envAlias>` (`development`→`dev` … `production`→`prod`).
- PC and H5 `MUST NOT` share an `outDir`; bare `dist/` is forbidden.
- Repository roots `MUST` expose `build:pc:<env>` / `build:h5:<env>`; app surfaces `MUST` expose `build:<env>` per `PNPM_SCRIPT_SPEC.md` §4.2.
- Check: `node tools/check-browser-dist-layout.mjs --root <module>` and `node tools/check-browser-build-scripts.mjs --root <module>`.

## 8. Verification

Rules:

- Service tests use fake generated SDK clients or generated SDK clients.
- UI tests cover key loading, empty, error, permission-denied, and success states.
- Architecture scans must prove the package family uses the correct SDK surface and does not import forbidden UI/runtime packages.
- Application layering scans `MUST` prove UI components do not call raw HTTP and services do not construct SDK clients locally.
- Visual or browser verification is required for substantial UI changes when a runnable app exists.
- Tailwind integration changes `MUST` run `check-tailwind-integration.mjs`.
- Adaptive Web PC/H5 Vite builds `MUST` pass `check-browser-dist-layout.mjs`.

## 9. Acceptance Checklist

- [ ] Correct UI architecture spec was loaded.
- [ ] UI -> service -> SDK flow is preserved.
- [ ] Components do not construct SDK clients or raw HTTP requests.
- [ ] `check-application-layering.mjs` passes when package services, UI, or SDK injection code is touched.
- [ ] Text, errors, and permissions are surfaced intentionally.
- [ ] Package family naming and SDK surface checks pass.
- [ ] PC/H5 `outDir` uses `dist/{dev,test,staging,prod}` (`check-browser-dist-layout.mjs`).
