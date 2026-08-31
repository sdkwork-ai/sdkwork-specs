# Dart Code Standard

- Version: 1.0
- Scope: Dart packages, Flutter mobile packages, generated Dart app SDK facades, Dart services, Dart tests, and pubspec/manifest tooling
- Related: `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_FLUTTER_UI_SPEC.md`, `APPLICATION_LAYERED_ARCHITECTURE_SPEC.md`, `FRONTEND_SPEC.md`, `FRONTEND_CODE_SPEC.md`, `I18N_SPEC.md`, `TEST_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `OBSERVABILITY_SPEC.md`

This standard applies only when Dart source, `pubspec.yaml`, Flutter package code, generated Dart SDK facades, or Dart tests are touched. Flutter application-root architecture follows `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`; Flutter UI package rules follow `APP_FLUTTER_UI_SPEC.md`. This standard owns the Dart language-level discipline (types, null safety, errors, async, widgets, tooling) that those specs assume.

This standard targets industry-best Dart/Flutter practice as published by the Dart language tour, the Dart style guide, `package:lints`/`package:flutter_lints`, and the Flutter documentation, narrowed to SDKWork's workspace.

## 1. Baseline

Rules:

- Every Dart package `MUST` run with null safety (`sdk: '>=3.x'`, sound null safety). Legacy
  non-null-safe code is forbidden.
- Every package `MUST` depend on `lints` (or `flutter_lints` for Flutter packages) and follow its
  rules; `dart analyze` `MUST` be clean before merge.
- `dart format` is the only accepted style; formatting is enforced by CI.
- Generated Dart SDK output under generator-owned directories must not be hand-edited; custom
  code lives in approved generated `custom/` roots or composed facades.
- Public package APIs `MUST` be typed; `dynamic` in public signatures is forbidden without a
  reviewed boundary.

## 2. Package And Module Shape

Rules:

- `lib/` is the public library root; `lib/<package_name>.dart` is the barrel that exports the
  public API. `MUST NOT` export private implementation files through the barrel.
- Keep `lib/` shallow and cohesive: group by domain/feature (`lib/src/<feature>/...` + selective
  exports), not by layer. `src/` holds implementation; `src/` files are importable only within
  the package (`package:` imports of another package's `src/` are forbidden).
- Barrel files export types and constants only; they `MUST NOT` contain logic.
- A file grows beyond ~300 lines → review cohesion; beyond ~500 lines → strong signal to split.
  Genuinely cohesive contracts, state machines, and fixture data may stay large with a cohesion
  note.
- High cohesion, low coupling: keep related types/functions together, minimize cross-file
  coupling, and split when responsibilities diverge (same framework as
  `TYPESCRIPT_CODE_SPEC.md` section 2).

## 3. Naming

Rules:

- Package names use lowercase snake_case, for example `sdkwork_appbase_flutter` (see
  `NAMING_SPEC.md` section 3 and `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`).
- Dart source files and directories use lowercase snake_case (`app.dart`, `user_profile/`).
- Classes, mixins, enums, and extension names use PascalCase.
- Functions, methods, variables, and parameters use lowerCamelCase.
- Constants use lowerCamelCase; private constants conventionally prefix with `_` or `k`
  consistently within the package.
- Private library members prefix with `_`; public API must not leak `_`-prefixed names.
- Boolean variables read as predicates (`isLoading`, `hasError`, `canSubmit`).
- Widget constructors use named parameters for options; positional parameters only for the
  required, unambiguous value (e.g. `Text('...')`).

## 4. Type And Null Safety

Rules:

- Prefer `final` for local variables and fields that never change; prefer `const` for
  compile-time constants and widget constructors where possible.
- Fields are private (`_`) by default; expose only the public API the package needs.
- Avoid `late` unless initialization is genuinely deferred (dependency injection, controllers);
  `late` fields that can be read before write are a bug source — document the invariant.
- Prefer immutable data: mark collections `final`/`unmodifiable` (`List.unmodifiable`,
  `Map.unmodifiable`) when the owner must not mutate them.
- Model closed variant sets with `sealed class` hierarchies (Dart 3) and exhaustive `switch`
  patterns; a boolean flag that switches shape is a smell.
- Use `enum`/enhanced enums for fixed enumerations; prefer sealed classes when variants carry
  data.
- Avoid `dynamic` and `Object?` casts; use typed generics and pattern matching. A cast (`as T`)
  `MUST` be guarded or documented.
- `null` handling: use `?`, `??`, and `?.`; avoid nullable lists/`!` assertions in library code
  unless the invariant is documented. `!` on a nullable value is forbidden in public API paths.
- Do not store `DateTime.now()` or other time sources as injectable defaults in constructors;
  accept a `clock`/`now` function for testability when time matters.

## 5. Errors And Exceptions

Rules:

- Business failures are typed exceptions or result types, never bare `Exception('...')`/`throw
  '...'`. Prefer a package `Exception` hierarchy (`sealed class` + concrete variants) or a
  `Result<T, E>` for fallible operations where the codebase established the pattern.
- Exceptions `MUST` carry a stable `code`/message that maps to the UI/API problem-detail at the
  boundary; never surface raw SDK/provider exceptions to widgets or API responses.
- Catch only what you handle: `on SpecificException catch (e)`; a bare `catch (e)` that swallows
  is forbidden. `rethrow` after logging when the caller must handle it.
- Async errors: `Future`/`Stream` errors `MUST` be handled (`try/await`, `.catchError`, or
  `onError`); an unhandled async error is a bug.
- Do not use exceptions for control flow; validate input and return typed failures.
- Logging exceptions `MUST` include the type, message, and stack where relevant; never log
  secrets, tokens, or PII.

## 6. Async And Concurrency

Rules:

- Prefer `async/await` over raw `.then` chains for readability; use `Stream` for event streams,
  `Future` for one-shot work.
- Every `Future` `MUST` be awaited or handled. Use `unawaited()` only with a documented reason
  (fire-and-forget that cannot fail or whose failure is logged elsewhere).
- Timeouts `MUST` wrap external awaits (HTTP, platform channels, file IO): `Future.timeout`
  with a typed `onTimeout` that maps to a domain failure.
- Concurrency limits: bound parallel work (`Future.wait` with a pool or chunking); do not fan out
  unbounded.
- Avoid `async` in `build()` and hot paths; CPU-bound or blocking work moves to
  `compute`/`Isolate.run` with a documented result type.
- Cancellation: prefer `StreamSubscription`/`CancelableOperation`-style handles for long-running
  work; check cancellation between steps.
- Shared mutable state across isolates is forbidden; pass immutable copies or messages.
- UI-thread discipline: no blocking IO, no `sleep`, no heavy synchronous work in the widget
  layer (see section 7).

## 7. Widget Discipline (Flutter)

Rules:

- `build()` `MUST` be a pure function of the widget's state and constraints: no IO, no network,
  no timers, no `setState` from within `build`.
- Prefer `const` constructors for widgets whose subtree is constant; this enables Flutter's
  element reuse and reduces rebuild cost.
- Widget `key`s: stable, unique keys on lists; `ValueKey`/`ObjectKey` from stable identity, never
  `index` on reorderable/filterable lists.
- Prefer small, focused widgets; extract a widget when a subtree has local state, callbacks, or
  exceeds a readable size.
- State lives as low as possible: `StatefulWidget` only when local state exists; lift state to a
  controller/store only when multiple widgets share it.
- Callbacks to parents are typed function parameters; `MUST NOT` reach into ancestor state via
  `GlobalKey` gymnastics (accept the key in documented narrow cases like form submit focus).
- Use `MediaQuery`/`LayoutBuilder` for responsive behavior; avoid hardcoded pixel sizes in
  reusable widgets (design-token driven).
- `Text`/widgets with user-facing copy use `AppLocalizations`/i18n (see `I18N_SPEC.md`), never
  hardcoded strings in reusable packages.
- Animations: prefer implicit animations and design-system motion; honor
  `MediaQuery.disableAnimations`/`prefers-reduced-motion`.
- Platform channels and plugins stay behind typed adapters (`FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`);
  widgets `MUST NOT` call platform channels directly.

## 8. State Management

Rules:

- Follow the state-management baseline established in `APP_FLUTTER_UI_SPEC.md` (provider/bloc
  per application); do not mix multiple global state solutions in one app.
- Server data flows through generated Dart app SDK clients via services; controllers/notifiers
  normalize loading/empty/error/permission-denied/validation states.
- Controllers/notifiers `MUST` dispose their subscriptions and controllers (`dispose()`);
  leaking `StreamSubscription`/`TextEditingController` is a bug.
- State objects are immutable where practical; publish new instances, not mutations.
- Do not mirror server state into long-lived client state that a cache layer owns.

## 9. API Design And Semver

Rules:

- Public API is a semver contract: removing/renaming an export or changing a signature is
  breaking; follow the repository release policy and `MIGRATION_SPEC.md`.
- Public API `MUST` be documented (`///` on every public class, method, and field).
- Mark deprecated API with `@Deprecated('reason')` and remove on the next major.
- Do not leak implementation types through public signatures (no `_`-prefixed types, no internal
  service objects).
- Prefer named parameters for public constructors with optional configuration; validate in
  constructors/asserts where cheap, and in factory/parse methods for external input.

## 10. Documentation

Rules:

- Every public declaration `MUST` have `///` doc comments describing the contract, error
  conditions, and invariants.
- Document `@param`/`@returns`/`@throws` where behavior is non-obvious; include `{@template}`/
  `{@macro}` reuse only when it reduces duplication without hiding meaning.
- Public APIs `SHOULD` include a `/// Example:` runnable snippet where the API is non-trivial.
- Internal `//` comments explain *why*; do not restate code. `TODO`/`FIXME` `MUST` reference a
  tracking issue id.

## 11. Testing

Rules:

- Unit tests cover pure logic (parsers, mappers, validators, services with fake ports) in
  `test/` mirroring `lib/`.
- Flutter widget tests (`flutter_test`) cover rendered behavior: loading/empty/error/
  permission-denied/success states, interaction via `tester.tap`/`tester.enterText`, and
  `pumpAndSettle`/`pump` with fake time — never real network or timers.
- Golden tests are allowed only for stable, generated fixtures; `MUST` run on a pinned image
  baseline and be reviewed on change.
- Name tests as behavior sentences (`rejects_negative_amount`,
  `renders_empty_state_when_list_is_empty`).
- Tests `MUST` be isolated and order-independent: no shared mutable globals, deterministic
  time/clock, cleaned-up resources.
- Mock at boundaries: fake injected SDK clients/ports; do not mock the framework.
- Regression tests `MUST` accompany bug fixes: reproduce, fix, lock with a failing-on-old-code
  test.
- Test-only helpers live under `test/` or a `dev_dependencies`-only support package; `MUST NOT`
  be reachable from `lib/` production paths.

## 12. Toolchain And Linting

Rules:

- `pubspec.yaml`: name in snake_case, `environment.sdk` with the workspace MSRV, `dependencies`
  minimal and declared, `dev_dependencies` for test/lint only.
- `analysis_options.yaml` `MUST` include `include: package:flutter_lints/flutter.yaml` (Flutter
  packages) or `package:lints/recommended.yaml` (pure Dart), plus SDKWork workspace additions:
  `avoid_dynamic_calls`, `prefer_final_locals`, `unawaited_futures`, `discarded_futures`
  (or the repository baseline), `strict-casts: true`, `strict-raw-types: true`.
- `dart format --output=none --set-exit-if-changed` and `dart analyze` run in CI and `MUST` be
  clean.
- Lockfile (`pubspec.lock`) is generated output: commit it in the same change as dependency
  edits for application roots; library packages follow the repository lockfile policy.

## 13. Dependencies

Rules:

- Third-party packages keep their upstream names and versions exactly as published; SDKWork
  never renames or re-cases them (`NAMING_SPEC.md` section 3 rules apply to authored packages).
- Versions `SHOULD` be centralized per `DEPENDENCY_MANAGEMENT_SPEC.md`; do not invent divergent
  versions for governed packages.
- Prefer small, well-maintained packages; a new dependency `MUST` be justified and `MUST NOT`
  duplicate a capability an SDKWork sibling Dart package provides.
- Generated Dart SDKs `MUST` be consumed through their package-root facade, never deep imports
  into generated internals.

## 14. Anti-Patterns

Forbidden:

- `dynamic` in public APIs; `as T` casts without guards; `!` assertions in public API paths.
- Bare `Exception('...')`/`throw '...'` for business failures; swallowed `catch` blocks.
- Unawaited futures and unhandled stream errors.
- `build()` with IO/network/timers; `setState` from `build`.
- `key: index` on reorderable/filterable lists.
- Leaked `StreamSubscription`/controllers without `dispose`.
- Global mutable state shared across widgets without a documented store/controller.
- Blocking the UI thread with synchronous heavy work.
- Hardcoded user-facing strings in reusable packages instead of i18n.
- Hand-editing generated Dart SDK output; importing another package's `src/`.

## 15. Verification

Rules:

- Run `dart format --output=none --set-exit-if-changed`, `dart analyze`, and `flutter analyze`
  (Flutter packages) before completion.
- Run the narrowest `flutter test <path>` first, then the package suite; run `dart test` for
  pure Dart packages.
- Run `node ../sdkwork-specs/tools/check-application-layering.mjs --root .` when Dart/Flutter
  service, SDK injection, or runtime/bootstrap boundaries are touched in an application
  repository.
- Generated Dart SDK changes are verified through the generator pipeline, not by hand-editing
  output.

## 16. Acceptance Checklist

- [ ] Package uses sound null safety; `dart analyze`/`flutter analyze` clean; `dart format`
      applied.
- [ ] `lib/<package>.dart` barrel exports only public API; no `src/` leaks.
- [ ] Errors are typed; no bare exceptions, swallowed catches, or unhandled futures.
- [ ] `build()` is pure; `const` constructors used where possible; stable list keys.
- [ ] Controllers/subscriptions disposed; no UI-thread blocking work.
- [ ] Public API is documented and semver-clean; `@Deprecated` where applicable.
- [ ] Tests cover loading/empty/error/permission-denied/success for changed surfaces.
- [ ] `pubspec.lock` committed with dependency edits (per repository policy).
