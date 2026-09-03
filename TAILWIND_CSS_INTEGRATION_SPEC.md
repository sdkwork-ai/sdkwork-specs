# Tailwind CSS Integration Standard

- Version: 1.0
- Scope: Tailwind CSS v4 integration for SDKWork Vite React PC/H5 application roots, UI library builds, and host-composed sibling feature packages
- Related: `DEPENDENCY_MANAGEMENT_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FRONTEND_CODE_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `TEST_SPEC.md`

This standard defines the canonical Tailwind CSS v4 integration model for SDKWork frontends. Tailwind is a build-time CSS engine; integration must preserve import closure, avoid duplicate engine bootstraps, and keep host composition deterministic.

## 1. Authority

| Concern | Authority |
| --- | --- |
| Third-party versions | Governance catalog `configs/dependency-catalog.yaml` synced into repository-root `pnpm-workspace.yaml` `catalog:` |
| App dependency declarations | Application-root or app-surface `package.json` |
| CSS bootstrap entry | Application shell `src/index.css` (or documented shell package stylesheet for standalone renderer packages) |
| Cross-repository scan roots | Host application shell `src/index.css` `@source` directives |
| Verification | `sdkwork-specs/tools/check-tailwind-integration.mjs` |

## 2. Required Dependencies

Application roots and standalone renderer shells that compile Tailwind `MUST` declare these packages in `dependencies` using `catalog:`:

```json
{
  "dependencies": {
    "@tailwindcss/vite": "catalog:",
    "@tailwindcss/typography": "catalog:",
    "tailwindcss": "catalog:"
  }
}
```

Rules:

- `tailwindcss` `MUST NOT` be declared only in `devDependencies` when the shell CSS entry imports it.
- Optional plugins such as `@tailwindcss/typography` `MUST` be declared where `@plugin` references them.
- Versions `MUST NOT` be hand-pinned when the repository catalog already governs the package.

## 3. Integration Modes

| Mode | Bootstrap CSS entry | `@import "tailwindcss"` | `@source` owner |
| --- | --- | --- | --- |
| Standalone PC/H5 app | `apps/sdkwork-<application-code>-<client-arch>/src/index.css` | allowed only here | app shell |
| Host composition app | host `src/index.css` | allowed only in host shell | host shell registers all integrated sibling `src` trees |
| UI library build | `sdkwork-ui-*/src/styles/*.css` | allowed only for library build output | library package |
| Standalone renderer shell package | `packages/*-shell/src/styles/index.css` | allowed only when the shell is the runnable app entry | shell package |

## 4. CSS Ownership Rules

Rules:

- Exactly one Tailwind engine bootstrap is allowed per runnable application graph.
- Host-composed feature packages `MUST NOT` contain `@import "tailwindcss"` in CSS files imported during host dev/build.
- Feature package CSS `MAY` contain `@source`, `@theme`, `@layer`, `@custom-variant`, and plain CSS.
- Shell renderer packages (`*-shell`) `MAY` bootstrap Tailwind in `src/styles/index.css`; the runnable app root that registers `@tailwindcss/vite` `MUST` declare Tailwind dependencies in `dependencies`.
- Vendor trees under `external/` are excluded from SDKWork Tailwind integration verification.
- UI library stylesheets `MAY` bootstrap Tailwind for standalone library builds. Host applications that already bootstrap Tailwind `MUST NOT` import library bootstrap stylesheets when shell `@source` already scans the UI package `src` tree.

Forbidden:

- `@import "tailwindcss"` in host-composed feature package CSS such as `packages/**/src/**/*.css`
- Hard-coded Vite aliases to `node_modules/tailwindcss/**`
- Vite aliases of bare specifier `tailwindcss` in host applications after bootstrap migration is complete
- Using app-root dependency hoisting to compensate for missing member package declarations

## 5. Vite Configuration

Standard Vite plugin wiring:

```typescript
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

Rules:

- `@tailwindcss/vite` `MUST` be registered after React plugin setup and before app-specific local API plugins when both are present.
- Host applications `MUST NOT` add bare-specifier `tailwindcss` Vite aliases.
- Cross-repository Vite aliases `MAY` continue to target workspace package source entrypoints per `APP_COMPOSITION_SPEC.md`; they must not substitute for Tailwind bootstrap ownership.

## 6. Host Composition And Import Closure

When a host application scans sibling repositories through Tailwind `@source`, Vite aliases, or TypeScript path mappings:

- The host `MUST` declare the full Tailwind toolchain in `dependencies`.
- Scanned feature packages `MUST NOT` re-bootstrap Tailwind in CSS imported by the host.
- Scanned packages `MUST` self-declare other direct npm imports they use in source code per `DEPENDENCY_MANAGEMENT_SPEC.md` section 1.3.
- Tailwind bootstrap is host-owned; it is not satisfied by transitive dependencies of `@tailwindcss/vite`.

## 7. Package Install Boundary For Large Composite Apps

Some large PC application roots keep an app-local `.npmrc` and app-local `pnpm-lock.yaml` to isolate Windows reinstall behavior.

Rules:

- Install and release build steps for those apps `MUST` run with the app directory as cwd so the package manager honors the app-local `.npmrc`.
- Repository-root lockfile authority remains the default for normal SDKWork repositories without an documented app-local install exception.
- Tailwind dependency declarations remain in app `package.json`; install cwd does not change CSS bootstrap ownership.

## 8. Verification

Required command:

```bash
node sdkwork-specs/tools/check-tailwind-integration.mjs --root <repository-root>
node sdkwork-specs/tools/check-tailwind-integration.mjs --workspace <multi-repo-checkout-root>
node sdkwork-specs/tools/align-tailwind-integration.mjs --workspace <multi-repo-checkout-root> --fix
```

Workspace checkout roots `SHOULD` expose `check:tailwind-integration` and `align:tailwind-integration` through the multi-repository root `package.json`.

The checker `MUST` fail when:

- A host-composed feature package CSS file contains `@import "tailwindcss"`
- A host application `vite.config.*` hard-codes `node_modules/tailwindcss`
- A host application `vite.config.*` aliases bare specifier `tailwindcss`
- A Tailwind-enabled app shell lacks required catalog dependencies in `dependencies`

## 9. Migration Checklist

- [ ] Move `tailwindcss` to `dependencies` on affected app roots
- [ ] Remove duplicate `@import "tailwindcss"` from host-composed feature CSS
- [ ] Ensure host shell `src/index.css` owns all integrated `@source` paths
- [ ] Remove bare-specifier `tailwindcss` Vite aliases from host apps
- [ ] Run `check-tailwind-integration.mjs` and application dev/build verification
