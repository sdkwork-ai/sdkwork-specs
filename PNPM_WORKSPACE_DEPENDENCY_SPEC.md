# SDKWork pnpm Workspace Dependency Standard

- Version: 1.0
- Scope: pnpm workspace dependency protocol, sibling-repository source layout, import rules for `@sdkwork/*` packages, Vite alias boundaries, and the local-workspace vs CI-git dual-track model
- Related: `DEPENDENCY_MANAGEMENT_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `CONFIG_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`, `FRONTEND_CODE_SPEC.md`, `NAMING_SPEC.md`

This standard defines how TypeScript/React packages inside SDKWork repositories depend on sibling SDKWork repositories through pnpm, and how application code imports those packages. It is the pnpm-specific companion to `DEPENDENCY_MANAGEMENT_SPEC.md`; where both apply, the stricter rule wins.

## 1. Dual-Track Dependency Model

SDKWork consumes sibling repositories through exactly **two** tracks that must stay consistent and must never be mixed inside one manifest:

| Track | Environment | Mechanism | Authority |
| --- | --- | --- | --- |
| Local development | Developer machine, `pnpm dev`, `pnpm build`, local tests | pnpm workspace protocol: sibling packages declared once in the consuming repository root `pnpm-workspace.yaml` `packages:` as `../sdkwork-*` relative paths; consumer `package.json` references them with `workspace:*` | `pnpm-workspace.yaml`, root `package.json`, `pnpm-lock.yaml` |
| CI / release packaging | GitHub Actions, release runners | Git repository dependency: every sibling repository referenced by the local workspace is checked out from its git repository (via `sdkwork.workflow.json` `dependencies[]` and the reusable SDKWork workflow framework) into the **same relative layout** the local workspace expects | `sdkwork.workflow.json`, reusable workflow, `GITHUB_WORKFLOW_SPEC.md` §dependency checkout |

Rules:

- The dependency declaration in `package.json` is **always** `workspace:*` for SDKWork sibling packages. It is never rewritten for CI, never swapped to a git URL, and never swapped to `file:`/`link:`.
- CI "git dependency" means **git checkout of the sibling repositories**, not a git-URL package specifier. `package.json` must not contain `git+ssh://`, `git+https://`, or `github:` specifiers for SDKWork sibling packages.
- `file:` and `link:` are forbidden for SDKWork sibling packages in every environment (`DEPENDENCY_MANAGEMENT_SPEC.md` §1.3, §3).
- The relative sibling layout (`../sdkwork-*`) is the single source of truth for both tracks. CI materializes that layout with git; local development resolves it from disk. A repository that can be checked out alone `SHOULD` document the expected sibling layout and the fallback behavior.
- Release checkout layout `MUST` mirror local sibling paths so `workspace:*` resolves identically in both environments (`DEPENDENCY_MANAGEMENT_SPEC.md` §4, `GITHUB_WORKFLOW_SPEC.md` §dependency checkout).

### 1.1 Why `workspace:*` + git checkout beats git-URL specifiers

- One declaration set works unchanged in local dev, CI, and release packaging; there is no per-environment rewrite of `package.json`.
- `pnpm-lock.yaml` stays stable because the resolution target is the same workspace path in both tracks.
- The pnpm store deduplicates the sibling packages once, and `pnpm dev` hot-reloads sibling source directly.
- Supply-chain evidence (pinned refs, tokens, SBOM) is produced by the workflow framework at checkout time, not by the package manager at install time.

## 2. Local Workspace Layout

Rules:

- Every SDKWork git repository with TypeScript/React packages `MUST` own exactly one repository-root `pnpm-workspace.yaml`; nested `apps/**/pnpm-workspace.yaml` are forbidden.
- Sibling SDKWork source packages `MUST` be declared **exactly once** in the consuming root `pnpm-workspace.yaml` `packages:`. Member `package.json` files `MUST NOT` redeclare sibling source paths.
- Sibling entries `MUST` be relative paths from the consuming repository root, for example `../sdkwork-ui/sdkwork-ui-pc-react`, and `MUST` use POSIX `/` separators.
- Consumer `package.json` `MUST` reference sibling packages with `workspace:*` in `dependencies` (runtime), `devDependencies` (build/test only), or `peerDependencies` (singleton runtime packages provided by the app shell such as `react`, `react-dom`, `react-i18next`, `i18next`).
- The consuming repository `MUST` keep and commit its own `pnpm-lock.yaml`.
- Versioned references to sibling packages `MUST NOT` be used as a substitute for `workspace:*` unless the package is intentionally resolved from a registry with separate supply-chain evidence.
- The workspace catalog (`catalog:` in `pnpm-workspace.yaml`) is for third-party versions, synced from the governance catalog; SDKWork sibling packages are always `workspace:*`, never catalog entries.

Example:

```yaml
# <repo-root>/pnpm-workspace.yaml  (sibling packages declared ONCE here)
packages:
  - "apps/*"
  - "packages/*"
  - "../sdkwork-ui/sdkwork-ui-pc-react"
  - "../sdkwork-utils/packages/sdkwork-utils-typescript"
  - "../sdkwork-sdk-commons/sdkwork-sdk-common-typescript"

catalog:
  react: ^19.2.8
  vite: ^8.0.3
```

```jsonc
// <repo-root>/packages/my-feature/package.json  (consumes by protocol only)
{
  "name": "@sdkwork/my-feature",
  "dependencies": {
    "@sdkwork/ui-pc-react": "workspace:*",
    "@sdkwork/utils": "workspace:*"
  }
}
```

## 3. CI / Release Git Dependency Track

Rules:

- Every sibling repository referenced by the repository-root workspace (`pnpm-workspace.yaml` `../sdkwork-*` members) `MUST` have a matching `dependencies[]` entry in `sdkwork.workflow.json` so CI checkouts materialize the same `../<id>` layout that local development resolves (`DEPENDENCY_MANAGEMENT_SPEC.md` §4).
- `dependencies[]` entries `MUST` declare stable `id`, `repository` (owner/repo form), pinned `ref` or validated `refInput`, and `tokenSecret`.
- The checkout path `MUST` resolve to the relative path expected by the consuming workspace root (`../sdkwork-<id>`). When the framework uses a different checkout directory, it `MUST` redirect the workspace-root declared path to the checkout (symlink, junction, or workspace-root path rewrite) without editing member `package.json` files.
- Dependency refs `MUST` be pinned commit SHAs or validated safe Git refs before checkout; unsafe refs fail the job.
- Tokens `MUST NOT` appear in clone URLs; use credential headers or first-party checkout actions.
- Completeness `MUST` be verified with `node ../sdkwork-specs/tools/check-dependency-list-completeness.mjs --target <repo-name>`; a missing sibling entry is a release-blocking defect.

## 4. Package Import Rules

Every import of an SDKWork sibling package in TypeScript/React source `MUST` go through the package name declared in that package's `package.json`, resolved by the pnpm workspace. Source-level relative paths into sibling repositories are forbidden.

Rules:

- Import by package name only: `import { Button } from "@sdkwork/ui-pc-react"`. The imported specifier `MUST` equal the dependency's `package.json` `name` exactly — no shortening, no renaming, no alias.
- Forbidden: `import ... from "../../sdkwork-appbase/packages/common/foundation/.../src/..."` or any relative path that crosses a package boundary into another SDKWork repository or another workspace package's `src/`.
- Import only public exports: consume the package through its `exports` field (`"exports"` in `package.json`). Do not deep-import `src/` internals of another package.
- Every non-relative import in a workspace member `MUST` resolve to a `dependencies`/`devDependencies`/`peerDependencies` entry in that member's own manifest (import closure, `DEPENDENCY_MANAGEMENT_SPEC.md` §1.3).
- Subpath imports (`@sdkwork/utils/id`) are allowed when the owning package declares that subpath in its `exports` map and the consumer declares the parent package dependency.
- Workspace member source `MUST NOT` import the repository root's `node_modules`-hoisted packages as a substitute for declaring the dependency in the member manifest.

### 4.1 Vite Alias Boundaries

Vite aliases must not be used to solve dependency resolution errors, to shorten package names, or to bypass package `exports`.

Rules:

- `resolve.alias` in Vite/Vitest config `MUST NOT` map an SDKWork sibling package name (`@sdkwork/*`) to a sibling source path. The workspace link already resolves the package name; an alias duplicates or bypasses it.
- `resolve.alias` `MUST NOT` rename an SDKWork package (`@sdkwork/foo` → `@sdkwork/bar` or `@sdkwork/foo` → `./src/...`).
- Aliases are allowed only for approved bootstrap/SDK-generation entrypoints or documented facade paths, and only when the alias target preserves the package's public `exports` surface. Every approved alias `MUST` be documented in the repository README or component spec and justified; aliases added "to make the build pass" without that documentation are forbidden.
- If a package cannot be resolved by name, fix the workspace declaration or the package's `exports`; do not paper over it with an alias.
- Tailwind `@source` and `tsconfig` `paths` follow the same boundary: they may point at workspace packages, but must not replace package-name imports with cross-package `src/` relative paths.

## 5. Package Naming Consistency

Rules:

- The import specifier, the `dependencies` key, and the target `package.json` `name` must be the same string. A package is always imported by its real name.
- SDKWork TypeScript packages use the `@sdkwork/<kebab-case-name>` scope. Renaming a package is a breaking change that `MUST` update every consumer import and every workspace declaration in the same change.
- Do not create local "re-export" packages solely to shorten import paths; if a facade is needed, follow `SDK_SPEC.md` / `APP_COMPOSITION_SPEC.md` composed-facade rules.
- Generated SDK packages keep their generator-assigned names (`SDK_WORKSPACE_GENERATION_SPEC.md`, `SDK_PACKAGE_NAMING_SPEC.md`).

## 6. Verification

```bash
# Import closure, workspace shape, member protocol, and composition (repository scope)
node sdkwork-specs/tools/verify-repo.mjs --root <repository-root>
node sdkwork-specs/tools/verify-repo.mjs --root <repository-root> --strict-import-closure

# Member package.json must use workspace:* (never file:/link:/git URL) for SDKWork siblings
node sdkwork-specs/tools/check-workspace-member-protocol.mjs --root <repository-root>

# Workspace sibling packages: must match sdkwork-specs/workspace/consumers/<repo>.json
node sdkwork-specs/tools/sync-workspace.mjs --repo <repo-name> --root <repository-root> --check

# CI release dependency completeness: every ../sdkwork-* sibling must have a dependencies[] entry
node sdkwork-specs/tools/check-dependency-list-completeness.mjs --target <repo-name>
```

Failures are defects, not warnings: an undeclared sibling, a `file:`/`link:`/git-URL specifier for an SDKWork sibling, a cross-package relative import, or an undocumented Vite alias must be fixed before merge.

## 7. Acceptance Checklist

- [ ] Repository root owns one `pnpm-workspace.yaml`; no nested workspace files.
- [ ] Every `../sdkwork-*` sibling appears exactly once in `pnpm-workspace.yaml packages:`.
- [ ] Consumer `package.json` uses `workspace:*` for SDKWork siblings; no `file:`/`link:`/git URL.
- [ ] Source imports use `@sdkwork/*` package names; no cross-package relative `src/` imports.
- [ ] Imports resolve only through declared `exports`; no deep `src/` internals of sibling packages.
- [ ] Vite aliases do not rename or redirect SDKWork packages; any approved alias is documented.
- [ ] `sdkwork.workflow.json` `dependencies[]` covers every sibling; refs pinned or validated.
- [ ] `pnpm-lock.yaml` committed with dependency changes.
