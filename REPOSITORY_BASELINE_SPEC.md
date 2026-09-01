# SDKWork Repository Baseline Standard

- Version: 1.0
- Scope: default git branch, repository L1 baseline metadata, and workspace compliance auditing for every SDKWork git repository root
- Related: `SOUL.md`, `AGENTS_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `ENGINEERING_WORKFLOW_SPEC.md`, `QUALITY_GATE_SPEC.md`, `GOVERNANCE_SPEC.md`

This standard defines the minimum source-controlled baseline every SDKWork git repository root must satisfy before it is considered standardized.

## 1. Default Branch

Rules:

- Every SDKWork git repository default branch `MUST` be `main`.
- New repositories `MUST` be initialized with `main` as the initial branch.
- Historical `master` branches `MUST` be renamed to `main` and removed from the remote after the GitHub default branch is updated.
- Repository automation, dependency checkout refs, reusable workflow inputs, and documentation examples `MUST` use `main` unless pinning an explicit tag or commit SHA.
- `master` `MUST NOT` be used as a new default branch name.

## 2. L1 Baseline (All Git Repository Roots)

Every git repository root `MUST` contain:

```text
<repo-root>/
  AGENTS.md
  README.md
  CLAUDE.md
  GEMINI.md
  CODEX.md
  .gitignore
  .sdkwork/
    README.md
    .gitignore
    skills/README.md
    plugins/README.md
```

Rules:

- Root `README.md` `MUST` declare `repository-kind:` per `SDKWORK_WORKSPACE_SPEC.md` section 1.1.2.
- `AGENTS.md` follows `AGENTS_SPEC.md`.
- `CLAUDE.md`, `GEMINI.md`, and `CODEX.md` are compatibility shims that point to `AGENTS.md`; they must not duplicate standards.
- Root `.gitignore` `MUST` ignore build artifacts, local env files, and ignored `.sdkwork/` local state.
- A repository `MUST NOT` track compiler emit that sits beside its source. Running `tsc` without
  `--noEmit` or an `outDir` drops `.js`, `.d.ts`, `.js.map`, and `.d.ts.map` next to every `.ts`
  input, and those stale copies then shadow the source in two distinct ways: bundlers resolve `.js`
  before `.ts` (Vite's default `resolve.extensions`), so the application silently runs pre-rename
  code; and `tsc` treats a `.d.ts` inside an `include`d directory as a program input, so a
  declaration left behind after a rename reports symbols that no longer exist anywhere in the
  source tree. Root `.gitignore` `MUST` therefore ignore `*.js.map` and `*.d.ts.map`, plus
  `*.js` and `*.d.ts` under source directories, with negations for authored ambient declarations
  (`vite-env.d.ts`, `global.d.ts`, and similar). Because emit and source share a filename, cleanup
  `MUST` delete only files that are untracked, carry an emit extension, and have a sibling source
  of the same name: `git clean` without `-X` also removes untracked source files, including
  in-progress work that was never committed.
- `.sdkwork/` follows `SDKWORK_WORKSPACE_SPEC.md`.
- `.sdkwork/.gitignore` `MUST` ignore `local/`, `tmp/`, `cache/`, `secrets/`, and `manual-backups/`.

## 3. L2 Engineering Baseline (Domain And Capability Repositories)

Repositories that own APIs, apps, crates, sdks, jobs, or database modules `SHOULD` also contain:

- `docs/README.md`
- `docs/product/prd/PRD.md`
- `docs/architecture/tech/TECH_ARCHITECTURE.md`

Rules:

- L2 docs follow `DOCUMENTATION_SPEC.md` and `ENGINEERING_WORKFLOW_SPEC.md`.
- Missing L2 docs are allowed only for intentionally narrow utility repositories until their first non-trivial feature change.

## 4. L3 Release Baseline (Publishable Application Roots)

Repositories or application roots with `sdkwork.app.config.json` that are packaged or deployed `SHOULD` also contain:

- `etc/README.md` and a typed source configuration entrypoint per `SOURCE_CONFIG_SPEC.md`.
- Environment/deployment profile instances under `etc/`, not concrete environment values in the app manifest.
- `sdkwork.workflow.json`
- `.github/workflows/package.yml`

Rules:

- L3 release wiring follows `GITHUB_WORKFLOW_SPEC.md`, `APP_MANIFEST_SPEC.md`, and `RELEASE_SPEC.md`.
- Shared libraries, specs-only repositories, and narrow utility repositories may remain L1/L2 without L3 release surfaces.

## 5. Compliance Audit

Rules:

- Run `node tools/audit-repository-baseline.mjs --root <repo>` from `sdkwork-specs/` before claiming repository baseline completion.
- Baseline audits `MUST` report branch name, L1 file presence, and forbidden tracked paths such as `node_modules/`, `target/`, `dist/`, and `.env`.
- Baseline audits `MUST` report tracked compiler emit beside source (section 2). A repository that
  has not adopted the whole L1 baseline `MAY` enforce that rule alone with
  `--only tracked-compiler-emit`, which accepts a repeatable or comma-separated list of check names;
  this lets an unrelated repository adopt one rule without first satisfying the rest.
- Repositories with corrupt git objects `MUST` stop baseline migration until the repository is restored from a healthy remote clone.

## 6. Acceptance Checklist

- [ ] Default branch is `main` locally and on GitHub.
- [ ] L1 baseline files exist and shims point to `AGENTS.md`.
- [ ] Root `.gitignore` and `.sdkwork/.gitignore` ignore local-only state.
- [ ] No compiler emit is tracked beside source files, and root `.gitignore` ignores it.
- [ ] L2 docs exist or an explicit exception is recorded for narrow utility repositories.
- [ ] L3 release surfaces exist for publishable application roots when packaging is in scope.
- [ ] `audit-repository-baseline.mjs` passes for the repository root.
