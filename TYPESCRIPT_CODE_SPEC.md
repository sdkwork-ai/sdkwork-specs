# TypeScript Code Standard

- Version: 2.0
- Scope: TypeScript, JavaScript, Node tooling, package exports, service facades, generated TypeScript SDK composition, and TypeScript tests
- Related: `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `FRONTEND_SPEC.md`, `FRONTEND_CODE_SPEC.md`, `I18N_SPEC.md`, `TEST_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `OBSERVABILITY_SPEC.md`

This standard applies only when TypeScript, JavaScript, Node scripts, package manifests, or TypeScript SDK facades are touched. TypeScript service, adapter, and runtime/bootstrap boundaries follow `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`.

This standard targets industry-best TypeScript practice as published by the TypeScript Handbook, the Google TypeScript Style Guide, and the ESLint/TypeScript-ESLint ecosystem, narrowed to SDKWork's multi-repository, multi-package workspace. Where a rule is not machine-checkable, the standard states the review evidence required.

## 1. Baseline

Rules:

- Every TypeScript project `MUST` run with `strict: true` (and the extended strict family:
  `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitReturns`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables` where the
  toolchain supports them). A `tsconfig` that disables strictness for new code is a review failure.
- Prefer strict typing at public boundaries. Public APIs `MUST NOT` expose `any`.
- Do not introduce implicit `any` in public APIs. `any` in authored code is forbidden unless a
  reviewed boundary requires it (untyped third-party interop) and the escape is documented.
- Generated TypeScript SDK output under generator-owned directories must not be hand-edited.
- Handwritten customizations belong in generated `custom/` roots or approved composed facades.
- Prefer `unknown` over `any` for values whose type is not yet known; narrow with type guards.

## 2. Source File Design Principles

TypeScript source files should be designed for maintainability, readability, and logical coherence. The following principles guide file organization:

### 2.1 Core Principles: High Cohesion, Low Coupling

Every source file should adhere to these fundamental design principles:

| Principle | Definition | Application |
| --- | --- | --- |
| **Single Responsibility** | A file should have one reason to change | Files focused on a single domain, capability, or concern |
| **High Cohesion** | Related code belongs together | All functions/types in a file work toward a common purpose |
| **Low Coupling** | Minimize dependencies between files | Changes to one file don't cascade to many others |
| **Clear Boundaries** | File boundaries reflect logical boundaries | Split when responsibilities diverge, not when lines accumulate |

**When to split a file:**
- It contains multiple unrelated responsibilities (e.g., user management AND order processing)
- Changes to one part frequently require unrelated changes to another
- Different stakeholders need to modify different sections
- Testing requires mocking unrelated dependencies
- Understanding the file requires navigating multiple conceptual domains

**When NOT to split a file:**
- The code serves a single, cohesive purpose
- Splitting would force readers to jump between files to understand one concept
- The file represents a natural unit of domain knowledge
- Splitting would create artificial boundaries that harm maintainability

### 2.2 Size as a Signal, Not a Rule

File size is a **symptom indicator**, not a compliance target. Use these signals thoughtfully:

| Size Signal | Likely Meaning | Action |
| --- | --- | --- |
| Growing beyond ~300 lines | Possible responsibility creep | Review: does this file have multiple concerns? |
| Approaching ~500 lines | Strong signal to evaluate | Check cohesion: can parts evolve independently? |
| Exceeding ~1000 lines | High signal for review | Justify: is the cohesion genuine or accidental? |

**Important:** These signals are NOT limits. A well-structured 2000-line file with genuine cohesion is preferable to artificially splitting related code across multiple files that readers must jump between.

### 2.3 Examples of Valid Large Files

The following patterns commonly produce larger files that maintain high cohesion:

| Pattern | Why It's Valid | Cohesion Justification |
| --- | --- | --- |
| **Schema/Contract Definitions** | OpenAPI schemas, protobuf types, API contracts | Single source of truth for a contract surface |
| **Route/Endpoint Collections** | Many routes for one API surface | One domain's routing knowledge in one place |
| **State Machine Definitions** | Complex state transitions | All states and transitions visible together |
| **Enum/Constant Collections** | Domain constants, error codes | Complete enumeration without fragmentation |
| **Generated Type Aggregations** | Re-exporting generated types | Thin aggregation layer over external source |
| **Test Fixtures** | Inline test data | Test locality improves understanding |

When a large file genuinely reflects a cohesive unit, document the rationale:

```typescript
// Cohesion note: This file defines all OpenAPI schemas for the BirdCoder API.
// Schemas are interdependent (references, shared types) and reviewed together.
// Splitting would fragment knowledge and harm API contract visibility.
```

### 2.4 Barrel Files and Re-exports

Barrel files (`index.ts`) serve as public API boundaries:

- Barrel files that only re-export from other modules have **no size constraint**
- Barrel files **MUST NOT** contain business logic, implementations, or type definitions
- A barrel file with logic is no longer a barrel—it's a module that needs its own responsibility analysis

### 2.5 Decision Framework

When evaluating whether to split a file, ask:

1. **Cohesion Test**: Do all parts of this file change together? If one part changes, do others typically need updates?
2. **Coupling Test**: Would splitting create circular dependencies or force readers to jump between files?
3. **Responsibility Test**: Can you name the single responsibility? Would a new team member understand it?
4. **Evolution Test**: Do different parts evolve at different rates or by different teams?
5. **Testing Test**: Does the file require complex setup or mocking for unrelated functionality?

If the answers favor cohesion, keep the file together regardless of size. If they favor separation, split regardless of size.

## 3. Package Shape

Recommended authored package shape:

```text
src/
  index.ts
  contracts/
  services/
  adapters/
  runtime/
  config/
  errors/
  i18n/        # present when the package owns messages or key contracts
  tests/
```

Rules:

- `src/index.ts` is the public export boundary.
- Keep package root exports stable and small.
- Do not import another package through `src/` internals.
- Service modules accept SDK clients through typed ports.
- Runtime/bootstrap constructs concrete SDK clients and injects token managers.
- UI-facing TypeScript packages preserve the UI -> service -> injected SDK/client-port flow from `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`.
- Node scripts should be deterministic, fail fast, and avoid hidden global state.
- TypeScript packages that own user-facing copy, operator-facing copy, backend message resources, or i18n key contracts `MUST` use the `src/i18n/<locale>/<domain>/<capability>/<fragment>.ts|json` or `src/i18n/keys/<domain>/<capability>.ts|json` layouts from `I18N_SPEC.md` section 6.1. `src/i18n/index.ts` and `manifest.ts` remain thin exports or generated aggregators.
- A package `MUST` declare its public surface explicitly: `package.json#exports` with `types` +
  `import`/`require` conditions; `src/index.ts` exports only stable, documented items.

### 2.1 `@sdkwork/utils` Package Exports

Rules:

- The canonical TypeScript utility npm package is `@sdkwork/utils` from
  `sdkwork-utils/packages/sdkwork-utils-typescript`.
- `package.json#exports` must expose every contract module as `./<module>` with paired `types` and
  `import` entries pointing at built artifacts under `dist/`.
- Do not publish or consume retired `@sdkwork/utils-typescript`.
- Application repositories must resolve `@sdkwork/utils` through package exports. Vite aliases and
  `tsconfig` path overrides are compatibility shims only and must not replace missing export maps.
- When adding a module to `specs/utils.contract.json`, update
  `scripts/check-typescript-exports.mjs` coverage by keeping `package.json#exports` in sync.

## 4. Type Discipline

Rules:

- Prefer `interface` for public object contracts and structural extension; prefer `type` for
  unions, intersections, mapped types, and tuples. Do not mix both for the same shape.
- Model closed variant sets with discriminated unions: a shared `kind`/`type` literal field and
  `switch`/exhaustive narrowing. A boolean flag that switches shape is a smell.
- Do not use `as` casts to bypass the type system. `as` is allowed only at reviewed boundaries
  (JSON from untyped external sources, DOM interop) and `MUST` be paired with a runtime guard or
  a comment explaining why the cast is safe.
- Prefer `satisfies` over `as` when the goal is to keep the inferred literal type while checking
  a constraint.
- Branded/nominal types: use a brand field (`type UserId = string & { __brand: 'UserId' }`) for
  ids and units that must not be mixed; `MUST NOT` pass a bare `string` where a branded id is
  expected.
- Object literals and arrays `MUST` be `readonly` (`Readonly<T>`, `readonly` tuple elements,
  `as const` for constants) unless mutation is a documented requirement.
- `null` vs `undefined` discipline: prefer `undefined` for optional values and `null` for
  intentional "no value" sentinels; pick one per boundary and document it. Do not return `null |
  undefined` unions.
- Optional properties use `?`; with `exactOptionalPropertyTypes`, do not assign `undefined`
  explicitly where the property is optional.
- Enums: prefer string-literal unions (`type Status = 'active' | 'inactive'`) over
  `enum` for data values; `const enum` is forbidden (isolatedModules incompatibility). Numeric
  enums are allowed only at a legacy/API boundary with an explicit comment.
- Function signatures `MUST` type parameters and return values explicitly at public boundaries;
  rely on inference internally only when it is unambiguous.
- Do not use `Function` as a type; use a specific `(...args) => R` signature.
- Promises `MUST` be awaited or handled; `void`-returning callbacks that initiate work
  `MUST` handle rejection (see section 6).

## 5. Errors And Results

Rules:

- Define typed error classes or error unions at package/service boundaries. A generic
  `throw new Error('...')` for business failures is a review failure; prefer
  `err-code`-style codes or a `ProblemDetails`-shaped error for API-facing failures.
- Service/business modules `MUST` surface failures as typed results (custom `Result<T, E>`,
  `Either`, or thrown typed errors) consistently within the package; do not mix styles.
- Business code `MUST NOT` throw raw SDK/client exceptions outward; map them to domain errors at
  the adapter boundary, preserving the cause and a stable `code`.
- API-facing failures `MUST` follow `API_SPEC.md` Problem Details; the mapping lives in one
  module per package (e.g. `errors/problem.ts`), not scattered across call sites.
- `MUST NOT` swallow errors with empty `catch {}` or `catch (e) { /* ignore */ }`. If an error is
  intentionally ignored, log it at `debug` with a reason.
- `try/catch` `MUST` catch the narrowest scope; do not wrap an entire request handler in one
  `catch` and re-type everything.
- Async failures `MUST` be awaited inside `try`; an unhandled promise rejection is a bug.
- Logging errors `MUST` include the error chain and stable code; never log secrets, tokens, or
  PII (see `OBSERVABILITY_SPEC.md`).

## 6. Async And Concurrency

Rules:

- Prefer `async/await` over promise chains for readability; a promise chain is acceptable when it
  expresses a pipeline and has a single rejection handler.
- Every promise `MUST` be settled: awaited, `.then`/`.catch` handled, or passed to a documented
  sink. Enable `no-floating-promises` / `@typescript-eslint/no-floating-promises`.
- `Promise.all` for independent parallel work; `Promise.allSettled` when partial failure is
  acceptable and each result is inspected; `Promise.all` `MUST NOT` be used when one rejection
  must not cancel independent work.
- Long-running or cancellable work `MUST` accept an `AbortSignal`; pass the signal to
  `fetch`/SDK calls and check it between steps. `MUST NOT` start work the caller cannot stop.
- Add timeouts to external awaits (`Promise.race` with a timer or an SDK timeout); no unbounded
  external await is allowed.
- Bound concurrency for fan-out (`p-limit` or a small worker pool); do not `Promise.all` over an
  unbounded input list.
- Avoid `async` in places that serialize: hot loops over `await` run sequentially — restructure
  with `Promise.all` when independent.
- Shared mutable state across awaits `MUST` be avoided; if needed, use a documented lock or queue
  primitive, never unguarded mutation between awaits.
- Event handlers and timers `MUST` be cleaned up (`addEventListener`/`setInterval` pairs removed
  on dispose); leaked timers are a bug.

## 7. API Design And Semver

Rules:

- Public API is a semver contract: removing/renaming an exported item, changing a signature, or
  tightening types is breaking and `MUST` follow the repository release policy and
  `MIGRATION_SPEC.md`.
- Keep the exported surface minimal: export only what consumers use; prefer `@internal` or
  `src/internal/` for plumbing.
- Mark deprecated exports with `@deprecated` (JSDoc tag), which emits `deprecated` diagnostics
  under lint; remove deprecated exports on the next major.
- Generic discipline: bound type parameters to the minimum; prefer inference over explicit
  parameterization at call sites; use `const` type parameters (`<const T>`) only when literal
  preservation is required.
- Do not expose implementation types (`tsc` output paths, internal classes) through public
  signatures; export contracts, not internals.
- Public functions `MUST` validate their input and throw/return typed errors; do not assume
  callers pre-validate.
- Use `unknown` in catch clauses (`useUnknownInCatchVariables`) and narrow with guards; never
  treat a caught value as `Error` without a check.

## 8. Naming

Rules:

- Packages use lowercase kebab-case or approved scoped package names such as `@sdkwork/<name>`.
- Files use repository convention; new utility/service files should use kebab-case or camelCase consistently with nearby files.
- Types, interfaces, classes, and React components use PascalCase.
- Functions, variables, and hooks use camelCase.
- Hooks start with `use`.
- Boolean variables read as predicates (`isLoading`, `hasError`, `canSubmit`); avoid
  non-boolean names for booleans (`loading` alone is ambiguous).
- Test files use the local pattern, commonly `*.test.ts`, `*.test.tsx`, or `*.test.mjs`.

## 9. Documentation

Rules:

- Public exports `MUST` carry JSDoc comments describing the contract: what, when it fails, and
  invariants. `@param`, `@returns`, and `@throws`/`@returns-error` are required for non-obvious
  behavior.
- Document error conditions: which inputs produce which failures, and whether the operation is
  retryable.
- Use `@example` for non-trivial public functions; examples `MUST` be runnable.
- Internal comments explain *why*; do not restate code. Comment invariants, trade-offs, and
  historical constraints.
- `TODO`/`FIXME` `MUST` reference a tracking issue id; a bare `TODO` is forbidden.
- Generated code `MUST NOT` be hand-documented; suppress docs only at generator-owned files with
  a documented rationale.

## 10. Testing

Rules:

- Every package `MUST` have tests covering its public behavior: unit tests for pure logic and
  integration tests for service/port boundaries. Use `vitest` or `jest` per repository baseline.
- Name tests as behavior sentences (`returns_conflict_on_duplicate_key`,
  `renders_empty_state_when_list_is_empty`); no `test_` prefixes and no "test does X" names.
- Tests `MUST` be isolated and order-independent: no shared mutable module state, no dependence
  on other tests, and deterministic time (fake timers where timing matters).
- Mock at boundaries: fake injected SDK clients/ports rather than deep-mocking internals; `MUST
  NOT` mock what a real, cheap implementation provides.
- Async tests `MUST` await all promises and handle rejections; enable fake timers explicitly per
  test.
- Coverage of the changed path is required; a test that does not assert is a liability.
- Regression tests `MUST` accompany bug fixes: reproduce, fix, lock with a failing-on-old-code
  test.
- Test-only code `MUST NOT` be reachable from production paths (no production import of test
  helpers, no `if (import.meta.env.MODE === 'test')` behavior branches in shipped logic).

## 11. Node Script And Build Runner Resilience

Node scripts under `scripts/` that orchestrate builds, dev servers, or dependency preparation must follow `CODE_STYLE_SPEC.md` §7 (Build Source Integrity And Self-Healing).

Rules:

- Build runners `MUST` verify build-critical source files before invoking `vite build`, `tsc`, or equivalent build commands.
- When a build-critical source file is missing, the runner `MUST` attempt `git checkout HEAD -- <path>` self-healing before failing.
- Verification and self-healing functions `SHOULD` accept injected `fileExists` and `runProcess` hooks for testability.
- Error messages from failed self-healing `MUST` name the missing files and provide the exact recovery command.
- `pnpm clean` scripts `MUST NOT` delete git-tracked `build/` directories, config helper modules, or any file that is imported by `vite.config.ts`, `tsconfig.json`, or build scripts at load time.
- Dev-server startup scripts `MUST NOT` assume that sibling workspace `dist/` directories are the only missing artifact; they `MUST` also verify sibling workspace build-critical source files when they invoke cross-repository builds.
- Node runners `MUST` place PID/heartbeat state and disposable generated config outside the source tree by using the shared SDKWork runtime-state resolver or `os.tmpdir()` plus a unique `mkdtemp` directory. Repository/application `.runtime/` is forbidden.
- Temporary files and decoded signing material `MUST` use restrictive permissions where supported and `finally`/signal-safe cleanup. A fixed shared temp filename is forbidden when concurrent runs can collide.

## 12. Toolchain And Linting

Rules:

- `tsconfig` baseline: `strict: true`, `target`/`module` per repository baseline, `moduleResolution:
  bundler` (Vite) or `node16`/`nodenext` (Node packages), `verbatimModuleSyntax: true` (use
  `import type` for type-only imports), `isolatedModules: true`, `noUncheckedIndexedAccess: true`,
  `skipLibCheck: false` for authored dependencies. Enable `noUnusedLocals`/`noUnusedParameters`.
- Type-only imports `MUST` use `import type { ... }` so `isolatedModules`-safe transpilers never
  emit runtime imports for types.
- ESLint baseline: enable `@typescript-eslint` recommended + `no-explicit-any`,
  `no-floating-promises`, `no-unused-vars`, `consistent-type-imports`, and `ban-ts-comment`.
  Fix warnings; do not blanket-disable rules.
- Path aliases: `@/*` or package-relative aliases are allowed only when declared in both
  `tsconfig` paths and the bundler config; prefer relative imports inside a package and export
  maps across packages.
- No `require`/`module.exports` in ESM-authored packages; `"type": "module"` per repository
  baseline. `__dirname` interop uses `import.meta.url` in ESM.
- Node scripts `MUST` be deterministic: no reliance on ambient env beyond documented config, no
  hidden global mutation, explicit failure on missing input.

## 13. Cross-Repository Source Federation Strictness

When a repository resolves a sibling repository's package to its `src/index.ts` — through a
`pnpm-workspace.yaml` `packages:` entry, a `tsconfig` `compilerOptions.paths` mapping, or a package
`exports` map that points `types` at source — the sibling's TypeScript **source** joins the
consumer's `tsc` program and is compiled with the **consumer's** flags, not the supplier's. A
supplier that is lax under its own `tsconfig` therefore fails only inside a build its owners never
run, and the consumer's team inherits defects it cannot fix at the source.

Rules:

- The strictness floor is `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, and `noFallthroughCasesInSwitch`.
  Every federated repository `MUST` enable all seven in the tsconfig that governs each federated
  directory.
- `verbatimModuleSyntax`, `isolatedModules`, and `skipLibCheck` are `NOT` part of the floor: they
  are emit, module, and declaration-file decisions that repositories may legitimately differ on.
- A consumer `MUST NOT` relax a floor flag to accommodate a supplier. The fix belongs in the
  supplier's source or its tsconfig, never in the consumer's compiler options.
- Every federated repository `MUST` expose a `typecheck` script so it detects its own drift instead
  of waiting for a stricter consumer. It `SHOULD` run
  `node ../sdkwork-specs/tools/typecheck-strict.mjs --root .`, which forces the floor regardless of
  what the local tsconfig declares and separates `own` errors from `external` errors contributed by
  that repository's own suppliers.
- A repository `MAY` declare a wider strictness set than the floor. The consumer baseline is a
  minimum for suppliers, never a maximum.
- `extends` chains `MUST` be honoured: a leaf project that inherits the floor from a shared base
  satisfies this section, and a base that declares the floor does not excuse a leaf that turns a
  flag back off.
- Newly federated repositories `MUST` comply before the federation entry is added. There is no grace
  period for new coupling.
- Pre-existing non-compliant suppliers `MAY` be recorded in
  `specs/typescript-federation-migration.json` with a reason, an owner, and an `expires` date; the
  gate then reports them as warnings instead of failures until that date. Entries whose repository
  becomes compliant or stops being federated `MUST` be removed, and the gate fails on stale or
  expired entries, so the list can only shrink. The file `MUST` live under version control: a list
  stored in a gitignored state directory such as `.sdkwork/` silently turns every warning back into
  a failure on another machine.
- Fix the supplier at its source: widen authored optional members to `?: T | undefined`; express
  invariants in the type, such as a non-empty tuple `readonly [T, ...T[]]` instead of
  `readonly T[]` plus a non-null assertion; destructure instead of indexing
  (`const [first] = items; if (!first) return ...`); and bridge generated SDK types with a
  runtime-guarded mapping or a conditional spread (`...(value === undefined ? {} : { value })`)
  rather than an `as` cast or a hand-edit of generated output (section 15).
- Federation is transitive: a repository that federates others inherits their defects in its own
  `own`-scope gate. Fix the layer you own and record the rest.
- Read-only upstream trees — `vendor/`, `third_party/`, and `external/` (AGENTS_SPEC) — are
  upstream source boundaries, not SDKWork-authored modules, and agents `MUST NOT` modify them
  (DEPENDENCY_MANAGEMENT_SPEC). The floor therefore does not apply inside them: their diagnostics
  are upstream debt whose only legal remedy is a vendored-sync. `typecheck-strict.mjs` excludes
  those trees by default and reports them under a separate `vendored` counter with
  `--include-vendored`; vendored diagnostics never fail a run. Only root-level trees qualify — a
  nested `packages/<pkg>/vendor/` directory is authored code and stays inside the contract.

Verification:

- `node ../sdkwork-specs/tools/check-typescript-federation-strictness.mjs --root .` fails when the
  consumer relaxes the floor, when a federated supplier's governing tsconfig is below the consumer
  baseline, when a supplier has no `typecheck` script, or when a migration entry is stale or
  expired.
- `--write-migration-list` regenerates the migration list from the current scan; `--expires-days`
  sets the grace period; `--strict` treats migration warnings as failures.
- `node ../sdkwork-specs/tools/typecheck-strict.mjs --root .` fails only on `own` errors. Use
  `--scope all` to surface federated sibling errors and `--include-vendored` to survey read-only
  upstream trees without failing on them.

## 14. Dependencies

Rules:

- Third-party packages keep their upstream names and versions exactly as published; SDKWork
  never renames or re-cases them (`NAMING_SPEC.md` section 3 rules apply to authored packages).
- Dependencies `MUST` be declared per package (`pnpm-workspace` + `package.json`); the
  application-root hoist is not a declaration point (see `DEPENDENCY_MANAGEMENT_SPEC.md`).
- Versions `SHOULD` come from the workspace catalog (`catalog:` in `pnpm-workspace.yaml` synced
  from `configs/dependency-catalog.yaml`); do not hand-edit divergent versions for governed
  packages.
- Prefer small, well-maintained packages; a new dependency `MUST` be justified in the change and
  `MUST NOT` duplicate a capability an SDKWork sibling package already provides.
- Lockfile (`pnpm-lock.yaml`) is generated output: commit it in the same change as any
  dependency edit; do not hand-edit it.

## 15. Anti-Patterns

Forbidden:

- `any` in public APIs and `as any` casts; `@ts-ignore`/`@ts-expect-error` without a documented
  reason.
- Implicit `any` from untyped parameters, catch variables, or untyped arrays.
- `enum`/`const enum` where a string-literal union expresses the domain.
- Throwing bare `Error('...')` or strings for business failures instead of typed errors.
- Empty catch blocks and silently swallowed promise rejections.
- Floating promises (`void someAsyncFn()` without a documented reason).
- Unbounded `Promise.all` over user-controlled input; unbounded concurrency.
- Shared mutable module-level state (`let` at module scope mutated across modules).
- Public exports of internal/implementation types; barrel files containing logic.
- Raw HTTP/auth header assembly in business modules where generated SDK methods exist.
- Hand-editing generated TypeScript SDK output.
- `require()` in ESM packages; `import type` violations under `isolatedModules`.

## 16. Verification

Rules:

- Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, or the package-specific wrapper when present.
- Run narrow package tests first, then workspace verification for shared package exports, SDK facades, or codegen changes.
- Run `node ../sdkwork-specs/tools/check-typescript-federation-strictness.mjs --root .` when a sibling repository is federated, un-federated, or changes its `tsconfig`, so strictness drift is caught at the boundary (section 13).
- Run `node ../sdkwork-specs/tools/check-application-layering.mjs --root .` when TypeScript UI, service, SDK injection, or runtime/bootstrap boundaries are touched in an application repository.
- Static scans should fail on raw SDKWork HTTP calls, manual auth headers, and cross-package `/src/` imports when those boundaries are governed.
- Build runner tests `SHOULD` verify that missing build-critical source files trigger self-healing, not an immediate crash.

## 17. Acceptance Checklist

- [ ] `tsconfig` uses `strict: true` and the strict family; public APIs are typed and `any`-free.
- [ ] `src/index.ts` is a stable export boundary; `package.json#exports` declares `types` +
      `import`/`require`.
- [ ] Authored TypeScript i18n messages or key contracts, when present, use `src/i18n/<locale>/<domain>/<capability>/` or `src/i18n/keys/<domain>/<capability>`.
- [ ] SDK clients are injected through typed ports; raw HTTP did not replace generated SDK calls.
- [ ] TypeScript UI/service/runtime boundaries follow `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md` when the package is part of an application.
- [ ] Discriminated unions model closed variant sets; no `as` bypasses without a guard or comment.
- [ ] Errors are typed and mapped at boundaries; no swallowed rejections or empty catches.
- [ ] Public API is documented (JSDoc), `@deprecated` where applicable, and semver-clean.
- [ ] Generated TypeScript output was not hand-edited.
- [ ] Typecheck/test/lint commands are documented and pass.
- [ ] Federated sibling sources compile under this repository's strictness: no consumer flag was relaxed to accommodate a supplier, and every federated supplier declares the floor and exposes `typecheck` (section 13).
- [ ] Build runners verify build-critical source files and self-heal from git when missing.
- [ ] `pnpm clean` does not delete git-tracked build-critical source files.
