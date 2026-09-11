# Internationalization Standard

- Version: 2.1
- Scope: cross-stack locale negotiation, frontend and backend user-facing messages, API problem localization metadata, SDK locale propagation, database seed localization, runtime config, deployment defaults, generated locale resources, accessibility text, and reusable SDKWork packages across browser, mobile, native, server, and gateway runtimes
- Related: `WEB_FRAMEWORK_SPEC.md`, `API_SPEC.md`, `SDK_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `FRONTEND_SPEC.md`, `DATABASE_FRAMEWORK_SPEC.md`, `DATABASE_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `MODULE_SPEC.md`, `IAM_SPEC.md`, `SECURITY_SPEC.md`, `DOCUMENTATION_SPEC.md`, `TEST_SPEC.md`, `NAMING_SPEC.md`, `DOMAIN_SPEC.md`

This standard defines how SDKWork systems handle language, locale, translated user-facing copy, backend messages, localized API error metadata, SDK locale propagation, and database initialization data. It is the cross-stack authority for internationalization. Framework, API, SDK, frontend, database, config, and environment standards own their runtime-specific enforcement details and must link back to this standard instead of restating it.

## 0. Normative Model

Rules:

- **LocaleTag** means a normalized BCP 47 language tag such as `zh-CN`, `en-US`, `ja-JP`, `de-DE`, `fr-FR`, `ru-RU`, or `ko-KR`.
- `defaultLocale` is the application or deployment default display locale.
- `fallbackLocale` is the explicit final locale used when a requested or effective locale cannot provide a required message.
- `supportedLocales` is the product-approved locale list.
- `activeLocales` is the deployment-enabled and verified locale list. `activeLocales` `MUST` be a subset of `supportedLocales`.
- `seedLocale` is the database initialization locale selected for `DATABASE_FRAMEWORK_SPEC.md` seed execution. It is not the same setting as frontend runtime locale.
- `i18nVersion` identifies versioned database initialization localization data.
- `catalogVersion`, `messageBundleVersion`, and `backendMessageBundleVersion` identify generated or deployed message resources.
- A locale tag on an API request or response describes language negotiation only. It `MUST NOT` be used as authorization, tenant, data residency, or permission evidence.

Runtime locale, message catalog locale, and database seed locale are related but distinct:

| Concept | Owner | Purpose | Default rule |
| --- | --- | --- | --- |
| Runtime locale | application bootstrap and `sdkwork-web-framework` | choose user-facing language for one runtime/request | explicit config or request context |
| Message catalog locale | frontend/backend message bundle provider | resolve translated text by key | explicit fallback chain |
| Database seed locale | database lifecycle framework | initialize persisted display/reference text | `zh-CN` by default unless configured |

## 1. Core Rules

Rules:

- User-facing text `MUST` come from message catalogs, backend message bundles, typed translation keys, or injected text providers.
- Reusable modules `MUST NOT` hard-code application-specific copy.
- Locale resources `MUST` be package-owned and split by domain, capability, route/screen, workflow, or component state.
- A client root, backend root, admin root, reusable package, or native platform project `MUST NOT` keep all authored messages for one locale in a single large file.
- Login, registration, password reset, token validation, tenant selection, permission denial, session-expired states, admin/operator errors, validation messages, and accessibility names `MUST` be internationalized.
- Localized text `MUST` preserve security boundaries: do not expose tokens, stack traces, SQL, provider internals, account enumeration hints, permission internals, raw exception messages, hostnames, or secret paths.
- SDKWork first-party reusable packages `SHOULD` support at least `zh-CN` and `en-US` unless a product or platform spec narrows the supported locale set.

## 2. Locale Selection And Fallback

Locale selection belongs in runtime/bootstrap or the web framework request boundary, not in feature components or business handlers.

Standard fallback order:

1. Authenticated user preference.
2. Tenant, organization, or application preference.
3. SDK runtime locale provider or trusted host runtime locale.
4. Standard `Accept-Language`.
5. Application `defaultLocale`.
6. Explicit `fallbackLocale`.

Rules:

- Locale tags `MUST` be normalized before comparison.
- Unsupported requested locales `MUST` resolve to the configured fallback chain; they must not produce handler-local ad hoc behavior.
- `fallbackLocale` `MUST` be explicit in runtime config for production and production-like deployments.
- Individual catalog fragments `MUST NOT` import another locale just to implement fallback. Fallback is owned by the provider or runtime registry.
- Components and handlers `MUST` react to locale changes or request locale context without reconstructing unrelated auth, tenant, or SDK state.
- Date, time, number, currency, relative time, collation, pluralization, and list formatting `SHOULD` use locale-aware APIs or approved SDKWork utilities.
- Layouts and native screens `MUST` tolerate text expansion without overlapping or truncating critical actions.

## 3. Framework Locale Context

Every SDKWork HTTP request served by `sdkwork-web-framework` or an equivalent runtime profile `MUST` receive a framework-resolved locale context before handler/controller logic runs.

Required logical context:

```text
WebLocaleContext {
  requestedLocale?: LocaleTag
  effectiveLocale: LocaleTag
  fallbackLocale: LocaleTag
  supportedLocales: LocaleTag[]
  activeLocales: LocaleTag[]
  source: user-preference | tenant-preference | app-default | accept-language | system-default
  catalogVersion?: string
  messageBundleVersion?: string
  timezone?: string
  numberingSystem?: string
}
```

Rules:

- `WebRequestContext` `MUST` include `locale: WebLocaleContext` for public and protected SDKWork HTTP operations.
- Public, login, registration, password reset, OAuth, refresh-token, open-api, app-api, backend-api, gateway, and admin/control-plane routes `MUST` receive locale context.
- `LocaleResolution` is a framework responsibility. Handlers and controllers `MUST NOT` parse `Accept-Language`, locale cookies, query parameters, or user-agent headers directly.
- Production requests `MUST NOT` trust arbitrary query parameters for locale selection unless the route is an explicitly documented preview/test route and the route manifest declares that behavior.
- The framework `MUST` expose centralized extension points for user preference lookup, tenant/application preference lookup, message bundle resolution, localized problem mapping, and validation message resolution.
- Rust is the reference runtime. Java/Spring and other server runtimes `MUST` preserve equivalent context vocabulary, request-stage semantics, headers, and problem-detail behavior.

## 4. HTTP Locale Headers

Locale negotiation uses standard HTTP headers only. SDKWork `MUST NOT` define, send,
trust, or document a custom locale request header.

Rules:

- Clients and SDK transports `MUST` send standard `Accept-Language` for locale negotiation, including when a runtime locale provider selects the locale explicitly: the provider owns the `Accept-Language` value.
- A custom locale request header such as `X-SdkWork-Locale` is retired. It `MUST NOT` be sent by any client, SDK transport, or runtime wrapper, `MUST NOT` be parsed by any handler, controller, or framework locale stage, and `MUST NOT` be added to a CORS request-header allowlist. Client locale selection is expressed through `Accept-Language`; in-process preference lookup is an extension point (section 3), not a wire header.
- Feature packages and UI components `MUST NOT` assemble locale request headers manually; propagation goes through the approved runtime locale provider.
- Responses whose body or problem detail is locale-sensitive `MUST` include `Content-Language: <effectiveLocale>`.
- Responses whose representation varies by language `MUST` include `Vary: Accept-Language`.
- Responses `MUST NOT` invent an SDKWork diagnostic i18n header (for example a
  `X-SdkWork-I18n-Version` / message-bundle-version family). Catalog and bundle versions are
  build/observability metadata, not wire protocol: expose them through the build manifest, logs,
  tracing attributes, or a documented standard mechanism instead of a bespoke response header.
- Headers `MUST NOT` contain translated message content.

## 5. Message Keys

Message keys are stable semantic identifiers. They describe meaning, not a visual label.

Examples:

```text
iam.auth.login.title
iam.auth.login.submit
iam.auth.login.validation.emailRequired
iam.auth.register.validation.passwordPolicy
iam.session.expired.message
iam.permission.denied.message
errors.result.40101
validation.iam.user.email.invalid
```

Rules:

- Key scope starts with canonical domain and capability, such as `iam.auth`.
- Error result keys `MUST` use `errors.result.<numericCode>` when mapping `ProblemDetail.code`.
- Field validation keys `SHOULD` use `validation.<domain>.<resourceOrWorkflow>.<field>.<rule>` or a documented narrower package convention.
- Key prefixes `MUST` align with the owning package and catalog fragment.
- A fragment that owns `iam.auth.login.*` keys `MUST NOT` also own unrelated `billing.invoice.*` or `admin.audit.*` keys.
- Reusable appbase keys `MUST NOT` contain application names such as `birdcoder`, `cloud`, or `magic-studio`.
- Validation, loading, empty, error, success, tooltip, aria label, placeholder, confirmation, and operator-facing strings need keys when user-facing.

## 6. Catalog Ownership And Fragmentation

Message catalogs must remain small enough to review, translate, validate, and merge without routine conflicts.

Recommended package-local shape for React and TypeScript packages:

```text
src/
  i18n/
    index.ts              # thin public export or generated aggregation only
    manifest.ts           # optional fragment manifest
    en-US/
      auth/
        login.ts
        register.ts
      session/
        expired.ts
    zh-CN/
      auth/
        login.ts
        register.ts
      session/
        expired.ts
```

Equivalent native or non-TypeScript packages may use platform resource formats, but the logical split is the same: locale -> domain -> capability -> route/screen/workflow/state fragment.

Rules:

- Authored locale files `MUST` be split by owning package and feature fragment. Do not create or grow files such as `en-US.ts`, `zh-CN.ts`, `messages.json`, `strings.xml`, `Localizable.strings`, or `arb/app_en.arb` that contain the whole application or whole client root copy.
- `src/i18n/index.*`, `manifest.*`, `locale.*`, `locales.*`, `registry.*`, `runtime.*`, `types.*`, provider files, app bootstrap locale registries, native resource aggregators, tests, and platform resource indexes `MUST` remain thin. They may export, register, type, test, or import fragments; they must not become the place where feature copy is authored.
- A reusable package owns its own default fragments. Consuming applications may override those fragments during bootstrap or provider composition, but application-line overrides `MUST` keep the same fragment boundaries.
- A fragment should normally map to one route/screen, dialog, form, table, workflow, command result, or reusable component family.
- If a fragment starts mixing unrelated workflows, split it before adding more keys.
- Cross-client implementations of the same workflow `SHOULD` reuse stable logical key names, while each architecture keeps authored locale resources in its own package-local i18n boundary unless an approved non-UI i18n contract package exists.
- Generated or build-time merged locale bundles `MUST` identify their source fragments and `MUST NOT` be hand-edited.
- If a platform requires monolithic runtime resources, the monolith `MUST` be generated from package-local fragments and excluded from authored-message review except for generated-artifact integrity checks.
- Vendored or third-party source trees such as `external/`, `third_party/`, and `vendor/` are not SDKWork-authored i18n sources. SDKWork wrappers around those integrations `MUST` provide any required localized copy through SDKWork package-local fragments.

### 6.1 Language And Framework Directory Standards

The following layouts define the authored source-of-truth directory shape for SDKWork i18n resources. Platform-native resource files and framework-specific aggregate bundles are projections unless this section explicitly marks them as authored fragments.

General rules:

- Authored source fragments `MUST` live in the package, crate, module, or app-surface component that owns the workflow.
- Locale directory names in authored sources `MUST` use normalized BCP 47 tags such as `zh-CN` and `en-US`. Platform suffixes such as Android `values-zh-rCN`, iOS `zh-Hans.lproj`, or generated Flutter `app_zh.arb` are projections, not the logical SDKWork source layout.
- Fragment paths `MUST` follow `locale -> domain -> capability -> route/screen/workflow/state fragment`.
- Root application shells `MAY` keep bootstrap registries, generated bundle manifests, or provider setup, but they `MUST NOT` author business-domain copy there.
- Generated aggregate directories `MUST` keep a source-fragment manifest or deterministic source map so reviews can trace every runtime key back to an owning package fragment.
- Repository-root `i18n/` directories are forbidden for application or backend message copy unless the repository is a dedicated i18n contract/package repository with its own `specs/component.spec.json`.

Canonical authored layouts:

| Language or framework | Authored source-of-truth layout | Generated or thin-only projection |
| --- | --- | --- |
| React TypeScript, Vite, Next-style frontend, backend/admin React | `src/i18n/<locale>/<domain>/<capability>/<fragment>.ts` or `.json`; optional thin `src/i18n/index.ts` and `src/i18n/manifest.ts` | Generated runtime bundles under build output or `src/i18n/generated/**`; no hand-authored `en-US.ts`, `zh-CN.ts`, `messages.json`, or app-wide locale file |
| Mini program TypeScript source packages | `src/i18n/<locale>/<domain>/<capability>/<page-or-component>.ts` or `.json` | Platform page/subpackage resources under `platform/generated/i18n/**`, `miniprogram/generated/i18n/**`, or equivalent generated output only |
| Flutter/Dart packages | `lib/src/i18n/<locale>/<domain>/<capability>/<screen-or-widget>.arb` or `.json`; optional thin `lib/src/i18n/manifest.dart` | `lib/l10n/generated/**`, root `lib/l10n/app_*.arb`, or framework localization delegates only when generated from fragments |
| Android Kotlin/Java packages | `src/main/i18n/<locale>/<domain>/<capability>/<screen-or-component>.json`, `.xml`, or `.properties`; optional thin Kotlin registry under `src/main/kotlin/**/i18n/` | `src/main/res/values*/strings.xml`, plurals, and resource ids only as generated or thin platform projections |
| iOS Swift packages | `Sources/<Module>/I18n/<locale>/<domain>/<capability>/<screen-or-view>.json` or `.strings.json` | `Sources/<Module>/Resources/*.lproj/Localizable.strings`, `.stringsdict`, or Xcode localized resources only as generated or thin projections |
| Harmony ArkTS packages | `src/main/ets/i18n/<locale>/<domain>/<capability>/<page-or-component>.json` or `.ts` | `src/main/resources/**/element/string.json` and platform resource indexes only as generated or thin projections |
| Rust backend, route, gateway, worker, or native-host crates | `resources/i18n/<locale>/<domain>/<capability>/<bundle>.ftl`, `.json`, or `.toml`; optional thin `src/i18n.rs` or `src/i18n/mod.rs` registry | Embedded/generated bundle tables under `OUT_DIR`, `generated/i18n/**`, or framework message registries only |
| Java/Spring backend modules | `src/main/resources/i18n/<locale>/<domain>/<capability>/<bundle>.properties`, `.yaml`, or `.json` | Spring `MessageSource`, validation bundles, or generated classpath aggregate files only as thin framework adapters |
| Shared key or contract packages | `i18n/keys/<domain>/<capability>.json` or `src/i18n/keys/<domain>/<capability>.ts` for key/type declarations | Generated TypeScript/Dart/Kotlin/Swift/ArkTS key constants; translated copy only when the package itself owns reusable default messages |
| Database lifecycle assets | `database/seeds/locales/<locale>/<domain>/<capability>/<seed>.sql` or `.json` | Generated seed reports, checksums, and seed history records; database seed locale data is not a runtime message catalog |

Additional rules:

- Native platform resource files such as `strings.xml`, `Localizable.strings`, `string.json`, or `app_*.arb` `MAY` contain platform-required app names, accessibility metadata, or generated projections, but they `MUST NOT` become the hand-authored source for feature copy.
- When a platform tool requires a single file per locale, the single file `MUST` be generated during build or release from package-local fragments.
- A fragment file named `common`, `shared`, `global`, or `messages` is allowed only for a domain-neutral package and `MUST NOT` mix unrelated business workflows.
- Cross-language implementations of the same route or screen `SHOULD` use the same logical key names even when file formats differ.
- Build, translation, and release tooling `SHOULD` validate active locales against the same logical fragment manifest before producing platform projections.

## 7. Frontend Runtime Rules

Rules:

- App/bootstrap code `MUST` create one runtime i18n provider or language-equivalent registry for the application shell.
- Feature packages `MUST` consume the injected provider, typed key helpers, or message catalog ports. They `MUST NOT` parse browser language, native platform locale, cookies, or SDK headers independently.
- UI error presentation `SHOULD` use `ProblemDetail.i18nKey` when present, otherwise map numeric `ProblemDetail.code` to `errors.result.<code>`.
- Backend-provided localized `ProblemDetail.title` or `detail` `MAY` be displayed as a fallback, but UI state and branching `MUST` use stable numeric code, operation result, or field error metadata.
- Application-line overrides `MUST` be colocated by application package, locale, domain, capability, and fragment. Do not maintain one application-wide override file per locale.
- Duplicate keys across fragments are allowed only when they intentionally override through declared precedence. Accidental duplicate keys in the same precedence layer `MUST` fail static validation.
- Missing required keys for active locales `MUST` fail release preflight for first-party critical flows.

## 8. Backend Message Rules

Backend messages are for safe presentation and diagnostics. They do not replace stable machine fields.

Rules:

- Backend handlers, services, repositories, validators, and framework adapters `MUST NOT` branch on localized strings.
- Backend code `MUST` use stable codes, enums, permission strings, domain states, or translation keys as machine state.
- `ProblemDetail.code`, `traceId`, `status`, `type`, `operationId`, permission codes, audit action codes, and metric names `MUST NOT` be localized.
- Backend `ProblemDetail.title` and `detail` `MAY` be localized only through framework-managed message resolution and safe templates.
- Backend validation errors `SHOULD` include stable field paths, numeric subcodes when applicable, `i18nKey`, and sanitized interpolation params.
- Logs, metrics, traces, audit records, and support tooling `SHOULD` record `locale` as diagnostic context when useful, but their primary machine fields remain non-localized.
- Hard-coded Chinese, English, or other human display strings in backend business logic are forbidden for user-facing or operator-facing responses.

## 9. API Problem Detail Localization

SDKWork-owned custom HTTP APIs continue to use `SdkWorkApiResponse` for success and RFC 9457 `ProblemDetail` for failure per `API_SPEC.md`. Internationalization adds optional localization metadata; it does not change the wire success/error model.

Problem detail extensions:

```json
{
  "code": 40101,
  "traceId": "0195f2a0-7c44-7b2e-9f3a-2a6f5d8e91ab",
  "i18nKey": "errors.result.40101",
  "locale": "zh-CN"
}
```

Validation error extension example:

```json
{
  "field": "email",
  "code": 40011,
  "i18nKey": "validation.iam.user.email.invalid",
  "params": { "maxLength": 128 }
}
```

Rules:

- `i18nKey` `SHOULD` be present on SDKWork-owned problem details when a safe user-facing message exists.
- `locale` `SHOULD` match `WebRequestContext.locale.effectiveLocale` when the framework resolves locale context.
- `errors[].i18nKey` `SHOULD` be present for field-level validation errors intended for UI display.
- `errors[].params` `MUST` contain sanitized values only. It must not include secrets, tokens, raw SQL, stack traces, or unescaped user HTML.
- SDKWork-owned APIs `MUST NOT` use HTTP 2xx with non-zero `code`, `success`, or localized `message` to represent business failure.
- Vendor compatibility operations declared with `x-sdkwork-wire-protocol: external` follow the upstream wire protocol and are exempt only to the extent allowed by `API_SPEC.md`.

## 10. SDK Locale Propagation

Rules:

- Generated SDK runtimes `SHOULD` support a `localeProvider`, `i18nProvider`, or language-equivalent request option supplied at client construction or bootstrap.
- SDK transports `MUST` serialize the current locale exclusively through the standard `Accept-Language` header (section 4). They `MUST NOT` synthesize a custom SDKWork locale header, and `MUST NOT` require a target runtime profile to allow one.
- SDK transports `MUST NOT` expose feature-level manual locale header construction as the normal integration path.
- Generated SDK error types `MUST` expose numeric `ProblemDetail.code` and `traceId`, and `SHOULD` expose `i18nKey`, `locale`, and field validation entries when the API returns them.
- SDK examples `SHOULD` show locale provider wiring in bootstrap, not per-call header mutation.
- App SDKs, backend SDKs, and business open/domain SDKs `SHOULD` follow the same locale propagation model. External wire-protocol SDK operations preserve upstream behavior.

## 11. Database Initialization Internationalization

Database lifecycle i18n is governed by `DATABASE_FRAMEWORK_SPEC.md`. This section defines cross-stack semantics.

Rules:

- Language-neutral reference data `MUST` live under `seeds/common/`.
- Locale-specific persisted initialization data `MUST` live under `seeds/locales/{locale}/`.
- A seed file `MUST NOT` mix multiple locales.
- Default database deployment `MUST` initialize `common` plus `zh-CN` unless runtime/database lifecycle config explicitly selects another active seed locale.
- Reserved locale directories `SHOULD` exist for `zh-CN`, `en-US`, `ja-JP`, `de-DE`, `fr-FR`, `ru-RU`, and `ko-KR` when the module declares them as supported seed locales.
- Seed manifests `MUST` record `i18nVersion`, `defaultLocale`, `fallbackLocale`, `supportedLocales`, `activeLocales`, locale set versions, and checksums when locale-specific seed content exists.
- Seed execution `MUST` be idempotent, versioned, and auditable through seed history including locale, profile, `i18nVersion`, checksum, and applied timestamp.
- Adding or activating a locale `SHOULD NOT` require a schema migration when the base schema already supports localized records.
- Persisted localized data `SHOULD` use a base table for stable machine fields plus a translation table keyed by stable resource identity, locale, message key or field name, and version.
- Tenant/application default locale rows may be initialized by seeds, but tenant/user preferences remain runtime configuration or user data, not hard-coded application copy.

## 12. Config And Environment Rules

Rules:

- Runtime config may contain locale strategy and resource pointers only: `defaultLocale`, `supportedLocales`, `activeLocales`, `fallbackLocale`, loading strategy, catalog manifest URL, and bundle versions.
- Environment variables may expose locale strategy values and manifest URLs when classified public, but they `MUST NOT` embed translated messages, generated bundles, L1 brand/store copy, validation copy, or override content.
- `defaultLocale`, `fallbackLocale`, and `activeLocales` `MUST` be resolved before SDK clients, i18n providers, and framework bootstrap are constructed.
- Seed locale env keys configure database initialization only. They `MUST NOT` be treated as frontend runtime locale or API request locale.
- Production startup `SHOULD` fail closed when configured `defaultLocale`, `fallbackLocale`, or `activeLocales` are not subsets of `supportedLocales`.

## 13. Multi-Platform Resource Rules

SDKWork supports React/TypeScript, Flutter/Dart, mini program TypeScript, Android/Kotlin or Java, iOS/Swift, Harmony/ArkTS, Rust, Java/Spring, server/container runtimes, and desktop/native hosts.

Rules:

- Platforms may use native resource formats, but authored source directories `MUST` follow section 6.1 and logical ownership remains package -> locale -> domain -> capability -> route/screen/workflow/state fragment.
- Generated platform bundles `MUST` retain source fragment traceability.
- Cross-client implementations of the same workflow `SHOULD` share route id, title key, permission hint key, validation key, error key, SDK surface, and service contract.
- Platform host adapters may provide system locale, timezone, numbering system, and calendar preferences, but feature packages consume them through the runtime i18n provider.
- Server-side rendering, backend/admin UI, and desktop/native shells `MUST` use the same logical key and fallback model as browser/mobile clients.

## 14. Security And Privacy

Rules:

- Localized messages `MUST NOT` leak account existence, credential validity, permission internals, tenant identifiers, API keys, tokens, file paths, database names, provider error bodies, stack traces, or raw exception details.
- Interpolation values `MUST` be escaped or rendered safely by the target framework.
- Rich text or HTML translations `MUST` declare an allowlist of permitted tags and attributes and `MUST` default to escaping unknown content.
- Translator-facing source files `SHOULD` avoid secrets, production identifiers, and private customer data.
- Audit logs, metrics, and alert routing `MUST` remain machine-stable and non-localized.

## 15. Testing

Rules:

- Static scans `MUST` reject authored app-wide, backend-root-wide, admin-root-wide, or package-wide locale monoliths.
- Static scans `MUST` verify authored i18n directories match the language and framework layouts in section 6.1 and that generated platform resources are not treated as source-of-truth copy.
- Static scans `MUST` reject any custom locale request header literal (section 4) in authored source, including runtime locale providers, framework locale stages, and CORS request-header allowlists.
- Static scans `MUST` reject any retained member of the retired locale-source vocabulary (section 3): the `source` enum is closed, and a repository that stopped sending the header `MUST NOT` keep the enum member that documented it. The check `MUST` match the value in its declared forms only — a quoted compact-array member sitting beside the live members, a quoted member alone on its line, or a bare enum variant — so that an unrelated stylesheet class or UI component that happens to share the name is not flagged.
- Static scans `MUST` judge authored source only. Two derived surfaces `MUST NOT` be reported as i18n violations: a compiler artifact sitting beside the authored file it was produced from (`.js`, `.jsx`, or `.d.ts` next to a `.ts`/`.tsx` twin), and any path the repository's own ignore rules exclude, such as a bundler output directory. Both are copies of a file that is scanned in authored form, and neither is a copy a developer can fix — the remedy for a stale artifact is to delete or regenerate it. The decision `MUST` come from the repository rather than from a directory name: `lib/` is derived output for a TypeScript package and authored source for a Flutter package. Standalone JavaScript with no TypeScript twin and no ignore rule is authored source and remains in scope.
- Static scans `MUST` cover every language the workspace ships, not only the languages that author locale resources. A retired wire header does not care whether the file that still sends it is TypeScript, ArkTS, Kotlin, Swift, Go, or Python.
- Static scans `MUST NOT` treat documentation that names a retired or forbidden header in order to prohibit it as a violation. A prohibition has to be able to name what it forbids, so prose in `I18N_SPEC.md`, `AGENTS.md`, and audit records stays out of literal scans.
- `tools/check-i18n-standard.mjs` is the canonical static check for repository/workspace i18n source layout, locale monolith rejection, generated/thin platform projection boundaries, Rust/Java backend message bundle placement, database locale seed path shape, and the retired custom locale request header.
- Static scans `MUST` exclude vendored or third-party source trees from SDKWork-authored i18n layout enforcement; integration wrappers remain subject to this standard.
- Fragment manifest or aggregation tests `MUST` verify every registered fragment has required keys for active locales unless the missing key is explicitly optional.
- Duplicate keys in the same precedence layer `MUST` fail validation.
- Reusable UI modules `SHOULD` test at least one non-default locale for critical flows.
- Auth forms `MUST` verify labels, validation messages, and submit actions use translation keys or providers.
- Backend and framework tests `MUST` prove locale context is injected, `Content-Language` is emitted for localized responses, `Vary: Accept-Language` is emitted when needed, and handlers do not parse locale headers directly.
- API contract tests `SHOULD` prove SDKWork-owned problem details expose stable numeric `code`, `traceId`, and optional `i18nKey`/`locale` without legacy localized `message` failure envelopes.
- SDK tests `SHOULD` prove locale provider values propagate through generated transports and generated error types expose localization metadata.
- Database seed smoke tests `MUST` prove `seeds/common` plus default seed locale `zh-CN` are idempotent and that locale seed history records version/checksum evidence.
- Config/env tests `MUST` prove locale config contains strategy and manifest/version references only, not translated content.

## 16. Gates

| Gate | Command | Enforces |
| --- | --- | --- |
| Workspace literal scan | `node tools/check-i18n-standard.mjs --workspace <workspace-root>` | Section 4 across every repository root: no authored source in any scanned language reintroduces the retired custom locale request header, plus the layout rules of section 6. |
| Repository literal scan | `node tools/check-i18n-standard.mjs --root .` | The same rules for one repository root, without scanning sibling checkouts. Fails closed per section 16.2. |
| Composition verifier | `node tools/verify-repo.mjs --root .` | Section 4 transitively, by calling the repository literal scan alongside composition, layering, routing, and API-assembly closure checks. |
| Unit | `node --test tools/check-i18n-standard.test.mjs` | Section 4 header retirement, section 6 layout rules, ignored-output and skipped-directory handling, and the fail-closed contract of section 16.2. |

### 16.1 Gate Wiring (Normative)

1. A repository that ships authored source in any scanned language `MUST` be able
   to detect a reintroduced retired locale header from its own aggregate. The
   preferred step is the composition verifier, because one invocation then covers
   locale, composition, layering, and API-assembly closure:

   ```json
   "check:app-composition": "node ../sdkwork-specs/tools/verify-repo.mjs --root ."
   ```

   A repository that instead declares the locale gate directly `MUST` use

   ```json
   "check:i18n-standard": "node ../sdkwork-specs/tools/check-i18n-standard.mjs --root ."
   ```

2. It `MUST` reference one of those steps from the aggregate that `pnpm verify`
   runs, in this preference order: `_sdkwork:verify`, then `verify`, then `check`.
   The aggregate is the merge-ready gate; a repository that never runs the step
   cannot detect a retired-header regression.
3. A repository with none of `_sdkwork:verify`, `verify`, `check` is reported as a
   **warning**, not a failure: the missing aggregate is a `PNPM_SCRIPT_SPEC.md`
   gap owned by that specification, and the workspace literal scan still audits
   its sources.
4. A repository `MUST NOT` run `--workspace <workspace-root>` from inside its own
   aggregate. The repository aggregate is the merge-ready unit; a workspace-wide
   scan inside a single checkout couples unrelated repositories and makes one
   checkout's verification depend on its sibling checkout state.
5. The workspace root `@sdkwork/workspace-root` runs the workspace literal scan
   through `pnpm check:all`.

### 16.2 Fail Closed (Normative)

Retiring the custom locale header is a wire contract, so a gate that reports
success without reading source is worse than no gate at all: it occupies the
contract slot while enforcing nothing.

1. A non-existent, non-directory, or empty scan root `MUST` exit non-zero.
   Reporting a pass in that state is forbidden.
2. A passing run `MUST` state how many files it scanned, so a reviewer can
   distinguish a wired gate from a no-op.
3. A workspace scan that enumerates zero repositories `MUST` fail rather than
   report a pass.

## 17. Acceptance Checklist

- [ ] Runtime, message catalog, and database seed locale responsibilities are documented separately.
- [ ] `defaultLocale`, `fallbackLocale`, `supportedLocales`, and `activeLocales` are explicit for production-like deployments.
- [ ] User-facing strings in reusable modules are keyed or injected.
- [ ] Locale resources are split by package, locale, domain, capability, and route/screen/workflow/state fragment.
- [ ] Language and framework i18n directories follow section 6.1, with platform-native aggregate resources generated or thin only.
- [ ] App-level and package-level i18n indexes are thin exports, registries, or generated aggregators, not authored monolithic catalogs.
- [ ] `WebRequestContext` includes framework-resolved locale context for SDKWork HTTP APIs.
- [ ] Handlers/controllers do not parse locale headers or query parameters directly.
- [ ] Locale negotiation uses standard `Accept-Language` only; no custom SDKWork locale request header exists in source, requests, or CORS header allowlists, and no stale compiler artifact or ignored build copy still emits one.
- [ ] Login, registration, session, validation, permission-denied, backend/admin, and operator-facing states are localized safely.
- [ ] API errors preserve numeric `ProblemDetail.code` and `traceId`; localized metadata uses `i18nKey` and `locale`.
- [ ] Generated SDKs support bootstrap-level locale propagation and expose problem localization metadata where returned.
- [ ] Database seeds split `common` and locale data, record `i18nVersion`, and remain idempotent.
- [ ] Runtime config and env values contain only locale strategy, manifest URLs, and versions, not message content.
- [ ] Application-line overrides preserve package-local fragment boundaries.
- [ ] Duplicate keys, missing required keys, monolithic locale files, and unsafe interpolation are covered by validation or tests.
- [ ] Text expansion does not break responsive or native layouts.
- [ ] A repository shipping scanned-language source can detect a reintroduced retired locale header from its own aggregate (section 16.1), and it does not run a workspace-wide scan from inside that aggregate.
- [ ] Locale gates fail closed: a missing, non-directory, or empty root exits non-zero, and a passing run reports its scanned file count (section 16.2).
