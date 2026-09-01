# SDK Workspace And OpenAPI Generation Detail Standard

- Version: 1.0
- Scope: project-level HTTP/OpenAPI `sdks/` workspace layout, SDK family directory placement, OpenAPI 3.x authority documents, derived generator inputs, generated output boundaries, backend API SDK generation workflow
- Related: `SDKWORK_WORKSPACE_SPEC.md`, `API_SPEC.md`, `WEB_BACKEND_SPEC.md`, `SDK_SPEC.md`, `SDK_PACKAGE_NAMING_SPEC.md`, `SDK_MANIFEST_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, `COMPONENT_SPEC.md`, `DOMAIN_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `BACKEND_UI_SPEC.md`, `FRONTEND_SPEC.md`, `CONFIG_SPEC.md`, `TEST_SPEC.md`, `GOVERNANCE_SPEC.md`

This detail standard implements the HTTP/OpenAPI SDK workspace and OpenAPI generation parts of `SDK_SPEC.md`. It defines how an application keeps HTTP SDK generation work in the `sdks/` directory under its application root while preserving one common SDKWork architecture. RPC SDK family layout, proto inputs, RPC manifests, and generated RPC output placement are governed by `RPC_SDK_WORKSPACE_SPEC.md`. The application root may live in any repository or product directory; this standard does not assume any fixed parent directory structure. It is intentionally independent of Craw Chat, IM, Java, Rust, React, Flutter, Tauri, standalone/cloud deployment profiles, deployment ownership, or runtime targets.

The standard project-root `apis/` directory from `SDKWORK_WORKSPACE_SPEC.md` is the authoring location for API contract sources and API materialization inputs when a repository or application owns API contracts. This file governs what happens after those inputs are materialized into SDK family workspaces under `sdks/`. `apis/` and `sdks/` are different boundaries: `apis/` stores API source and review inputs; `sdks/` stores SDK families, authority OpenAPI files used for generation, derived `sdkgen` inputs, generated language workspaces, and SDK component metadata.

`SDK_SPEC.md` is the primary SDK standard and owns the SDK system model, canonical naming vocabulary, package semantics, generated client surface, auth handling, service facade boundary, integration rules, and generated client quality rules. This file is subordinate to `SDK_SPEC.md`; it owns only the physical application-root HTTP/OpenAPI `sdks/` structure, SDK family directory placement, OpenAPI authority document materialization, derived generator inputs, generated output placement, and backend API SDK generation workflow.

The canonical SDK generator is defined by `SDK_SPEC.md`: workspace sibling repository `../sdkwork-sdk-generator`, package `@sdkwork/sdk-generator`, CLI `sdkgen`, and executable `../sdkwork-sdk-generator/bin/sdkgen.js`. Repository-local generation scripts are allowed only as thin wrappers that derive input OpenAPI, pass standardized generator arguments, and route output into the application `sdks/` workspace. They must not substitute another generator, use copied generator source, call ad hoc OpenAPI client tools, present `sdkwork-code-generator` as a separate standard, or silently fall back to local stubs for committed SDK output. `sdkwork-code-generator` is only an alias/wrapper name when a repository explicitly documents that it executes this canonical `sdkgen.js` entrypoint; it is not an independent SDKWork HTTP SDK generator.

If this file appears to conflict with `SDK_SPEC.md`, follow `SDK_SPEC.md` for SDK semantics and package/client behavior. Use this file for repository layout and generation artifact placement only when consistent with `SDK_SPEC.md`.

Repository/application root `.sdkwork/` skills and plugins are defined by `SDKWORK_WORKSPACE_SPEC.md`. The generated SDK output `.sdkwork/sdkwork-generator-*.json` files described here are a separate `sdkgen` control plane and must not be used as repository workspace metadata.

## 1. Principles

Rules:

- `SDK_SPEC.md` is the primary SDK standard. This file operationalizes its workspace and generation requirements for repositories and CI.
- API contract authoring may start in the project-root `apis/` directory. SDK generation authority, derived generator inputs, and generated output still live in `sdks/`.
- Every application that owns generated SDKs `MUST` create `sdks/` under the application root.
- Every application root that owns generated SDKs also `MUST` satisfy `SDKWORK_WORKSPACE_SPEC.md` by providing root `.sdkwork/skills/` and `.sdkwork/plugins/`; those directories live beside `sdks/`, not inside generated SDK output.
- The `sdks/` directory `MUST` be organized by SDK family directories. API authority documents live inside the owning SDK family; API authority names are not top-level SDK family directories.
- OpenAPI 3.x documents are the authority for HTTP SDK generation.
- HTTP SDK generation `MUST` call `../sdkwork-sdk-generator/bin/sdkgen.js` or the equivalent package-managed `sdkgen` executable.
- RPC SDK generation is separate and `MUST` follow `RPC_SDK_WORKSPACE_SPEC.md`. Existing HTTP SDK generation commands MUST NOT require proto roots, RPC manifests, Buf, protoc, or RPC-specific flags.
- Generated SDK output `MUST NOT` be hand-edited. Fix the runtime API, OpenAPI authority, generator profile, or composed facade, then regenerate. When generated or compiled output fails a contract or standard, repair the generation chain (authored contract, route manifest, authority OpenAPI, derived inputs, generator profile, or `custom/` build scripts) and rerun the standard generation command; do not patch generated files in place.
- Generated HTTP SDK output `MUST` retain the `sdkgen` control plane: `sdkwork-sdk.json`, `.sdkwork/sdkwork-generator-manifest.json`, `.sdkwork/sdkwork-generator-changes.json`, `.sdkwork/sdkwork-generator-report.json`, and the regeneration-safe `custom/` root.
- Generated output `.sdkwork/` directories are generator-owned. They `MUST NOT` contain repository/application skills, plugins, root workspace manifests, local caches, runtime databases, logs, or secrets.
- Generated HTTP SDK files under `generated/server-openapi` `MUST` remain canonical `sdkgen` output. SDK ownership and dependency standard fields such as `sdkOwner`, `apiAuthority`, `sdkFamily`, `generationInputSpec`, `sdkDependencies`, `dependencyApiExports`, `dependencyApiSurfaces`, `ownerOnlyOperationCount`, `standardProfile`, and `standardVersion` belong in family-root `sdk-manifest.json`, `specs/component.spec.json`, or approved wrapper/composed package metadata outside `generated/server-openapi`; they `MUST NOT` be synced into generated `sdkwork-sdk.json`, generated `package.json`, generated `sdk-manifest.json`, generator `.sdkwork/*` reports, or generated source `sdkMetadata`. Parallel SDK registries are forbidden.
- Handwritten extensions belong only in generated `custom/` roots or approved `composed/` facades outside generated ownership.
- SDK family wrapper scripts `MUST` fail fast when the canonical generator is missing. Stub generators are allowed only as isolated tooling fixtures, not as official SDK family output producers.
- SDK family wrapper scripts, READMEs, manifests, and CI jobs `MUST` identify the generator as `@sdkwork/sdk-generator` / `sdkgen` and record the canonical path or resolved package location plus the generator version or commit.
- Consumer code `MUST` use generated SDK packages or approved composed wrappers. It `MUST NOT` replace missing SDK methods with raw HTTP, manual auth headers, local DTO forks, or package-local OpenAPI forks.
- Backend API SDKs `MUST` be generated from backend OpenAPI contracts and consumed only by explicit `backend-admin` integrations.
- App/user-facing UI `MUST NOT` call backend SDKs or `/backend/v3/api`.
- SDK generation is local-owner-only. A repository/application `sdks/` workspace generates only the
  API authorities owned by that repository/application. APIs owned by dependency repos, Rust crate
  dependencies, reusable appbase modules, provider repos, or other applications are declared as
  `sdkDependencies` and consumed as dependency SDKs, not copied into the consuming SDK authority.
- Any SDK family directory containing `openapi/*.sdkgen.json`, `openapi/*.sdkgen.yaml`, or
  `openapi/*.sdkgen.yml` `MUST` declare `sdk-manifest.json` in the same family root. A
  generated SDK family without family manifest metadata is not a valid SDKWork family and must fail global
  ownership checks.
- `apis/` `MUST NOT` contain SDK family directories, generated language workspaces, `generated/server-openapi`, or generated SDK control-plane `.sdkwork/` files.

## 2. Standard Workspace Shape

Recommended application-root shape:

```text
<application-root>/
  .sdkwork/
    README.md
    skills/
      README.md
    plugins/
      README.md
  apis/
    open-api/
    app-api/
    backend-api/
    rpc/
    async/
  crates/
    sdkwork-routes-merchandise-open-api/
    sdkwork-routes-catalog-open-api/
    sdkwork-routes-merchandise-app-api/
    sdkwork-routes-cart-app-api/
    sdkwork-routes-order-app-api/
    sdkwork-routes-merchandise-backend-api/
    sdkwork-routes-order-backend-api/
  sdks/
    README.md
    materialize-<domain>-v<major>-openapi-boundaries.mjs
    workspace-*.mjs
    _route-manifests/
      app-api/
        sdkwork-routes-merchandise-app-api.route-manifest.json
        sdkwork-routes-cart-app-api.route-manifest.json
      backend-api/
      open-api/
    _shared/
    test/
    sdkwork-<domain>-sdk/
      README.md
      openapi/
        sdkwork-<domain>-open-api.openapi.yaml
        sdkwork-<domain>-open-api.sdkgen.yaml
        sdkwork-<domain>-open-api.flutter.sdkgen.yaml
      sdkwork-<domain>-sdk-typescript/
        generated/server-openapi/
        composed/                 # optional semantic facade
      sdkwork-<domain>-sdk-flutter/
      sdkwork-<domain>-sdk-rust/
      sdkwork-<domain>-sdk-java/
      sdkwork-<domain>-sdk-csharp/
      sdkwork-<domain>-sdk-swift/
      sdkwork-<domain>-sdk-kotlin/
      sdkwork-<domain>-sdk-go/
      sdkwork-<domain>-sdk-python/
      specs/
        README.md
        component.spec.json
    sdkwork-<domain>-app-sdk/
      openapi/
        sdkwork-<domain>-app-api.openapi.yaml
        sdkwork-<domain>-app-api.sdkgen.yaml
        sdkwork-<domain>-app-api.flutter.sdkgen.yaml
      ...
    sdkwork-<domain>-backend-sdk/
      openapi/
        sdkwork-<domain>-backend-api.openapi.yaml
        sdkwork-<domain>-backend-api.sdkgen.yaml
      ...
    sdkwork-<domain>-internal-sdk/
      openapi/
        sdkwork-<domain>-internal-api.openapi.yaml
        sdkwork-<domain>-internal-api.sdkgen.yaml
      ...
    sdkwork-<sdk-family-stem>-rpc-sdk/
      rpc/
        sdkwork-<sdk-family-stem>-rpc.manifest.json
      ...                       # governed by RPC_SDK_WORKSPACE_SPEC.md
```

Rules:

- `apis/` is optional only when the application does not author API contracts. When present, it follows `API_SPEC.md`, `RPC_SPEC.md`, `EVENT_SPEC.md`, and the project-root directory rules in `SDKWORK_WORKSPACE_SPEC.md`.
- API contracts authored under `apis/` may be copied, normalized, or materialized into the owning SDK family `openapi/` directory only through a deterministic materialization command.
- Authority OpenAPI files below `sdks/sdkwork-<domain>-*/openapi/` remain the SDK generation source of truth. They must trace back to authored API contracts, route manifests, controller scans, or reviewed materialization inputs.
- Rust HTTP route crates that define SDKWork HTTP API paths, route constants, route manifests,
  router mount points, or handler bindings belong under the application root's Rust workspace, not
  under `sdks/`. The standard path is
  `crates/sdkwork-routes-<capability>-<surface>/`.
- Application-root `.sdkwork/` is validated by `SDKWORK_WORKSPACE_SPEC.md`; it is not an SDK family,
  not an OpenAPI authority, and not a generated transport output.
- `<surface>` in Rust route crate placement `MUST` be exactly `open-api`, `app-api`, `backend-api`, or `internal-api`.
- Rust route crate package names `MUST` follow `API_SPEC.md`:
  `sdkwork-routes-<capability>-open-api`, `sdkwork-routes-<capability>-app-api`, or
  `sdkwork-routes-<capability>-backend-api`.
- `sdkwork-<domain>-sdk` is the public/open domain SDK family.
- `sdkwork-<domain>-app-sdk` is the app/client SDK family for app-api contracts.
- `sdkwork-<domain>-backend-sdk` is the `backend-admin` SDK family for backend-api contracts.
- `sdkwork-<domain>-internal-sdk` is the application ingress internal SDK family for `internal-api` contracts on `application.public-ingress`.
- `sdkwork-<sdk-family-stem>-rpc-sdk` is the RPC SDK family for proto/gRPC contracts and is governed
  by `RPC_SDK_WORKSPACE_SPEC.md`.
- `<domain>` is the application domain model, in kebab-case. It should match `DOMAIN_SPEC.md` unless the product has an approved local domain alias.
- Non-OpenAPI SDKs are allowed only when they are declared as provider/runtime SDKs, for example `sdkwork-rtc-sdk`. They `MUST` document that they are not route-generated HTTP SDKs.
- Support directories such as `_shared/` and `test/` may exist under `sdks/` when they serve multiple SDK families.
- Generated language output belongs below the owning SDK family. Do not place generated SDK packages at random application roots.
- The family root is the ownership boundary. `openapi/`, generated language workspaces,
  family-root `sdk-manifest.json`, and `specs/component.spec.json`
  belong under that same family root. Ownership and dependency metadata must not be moved into
  generated transport output to make discovery work. Multi-family generation scripts `MUST`
  discover family-root `sdk-manifest.json` files directly and `MUST NOT` add a parallel registry.
- Rust route crates are source inputs to authority materialization. They `MUST NOT` be placed inside
  generated SDK family directories, and generated SDK code `MUST NOT` import route crate internals.
- Normalized route manifest artifacts, when produced for materialization or CI, belong under
  `<application-root>/sdks/_route-manifests/<surface>/`. They are intermediate authority inputs, not
  SDK families, not generated transport, and not public SDK package roots.

## 3. SDK Family Directory Placement

The following table repeats the canonical SDK/API naming model from `SDK_SPEC.md` only to show where those families and authority documents live in the application-root `sdks/` workspace. `SDK_SPEC.md` remains authoritative for SDK family semantics, API authority semantics, generated package names, generated metadata, manifests, and generator `--sdk-name` values.

| SDK family directory | API authority name | API prefix | Audience |
| --- | --- | --- | --- |
| `sdkwork-<domain>-sdk` | `sdkwork-<domain>-open-api` | Domain-defined, commonly `/im/v3/api` for IM | Public/domain integrations |
| `sdkwork-<domain>-app-sdk` | `sdkwork-<domain>-app-api` | `/app/v3/api` | App, desktop, mobile, H5, and user-facing clients |
| `sdkwork-<domain>-backend-sdk` | `sdkwork-<domain>-backend-api` | `/backend/v3/api` | `backend-admin` console, operators, control plane, admin integrations |
| `sdkwork-<domain>-internal-sdk` | `sdkwork-<domain>-internal-api` | `/internal/v3/api` | First-party kernel UI, embedded consoles, trusted in-app automation on application ingress |
| `sdkwork-<sdk-family-stem>-rpc-sdk` | `sdkwork.rpc.manifest` plus proto packages | gRPC endpoint policy | Distributed backend, native host, private/local, and service-to-service integrations |

Rules:

- The SDK family name and API authority name `MUST` be declared in the family README and component manifest.
- The authority name is the logical API authority. Physical OpenAPI filenames may include an application prefix during migration, but the declared authority name must stay standard.
- SDK family names and API authority names `MUST NOT` be conflated. `sdkwork-<domain>-open-api`, `sdkwork-<domain>-app-api`, and `sdkwork-<domain>-backend-api` are API authority names only; they are forbidden as directories directly below `sdks/`, as generated language workspace prefixes, as generated package names, as `sdkMetadata.name`, as `sdk-manifest.json.sdkName`, as generator `SDK_NAME`, and as generator `--sdk-name`.
- The SDK family generated from an `open-api` authority is always `sdkwork-<domain>-sdk`, not `sdkwork-<domain>-open-api` and not `sdkwork-<domain>-open-sdk`.
- Generated language workspaces `MUST` inherit the SDK family name exactly: `sdkwork-<domain>-sdk-{language}`, `sdkwork-<domain>-app-sdk-{language}`, and `sdkwork-<domain>-backend-sdk-{language}`.
- RPC generated language workspaces inherit the RPC SDK family name exactly, for example
  `sdkwork-im-rpc-sdk-typescript` and `sdkwork-im-rpc-sdk-rust`.
- Generated package names `MUST` trace to the SDK family, not the API authority: `sdkwork-<domain>-sdk-generated-{language}`, `sdkwork-<domain>-app-sdk-generated-{language}`, and `sdkwork-<domain>-backend-sdk-generated-{language}` unless a documented public package alias is declared in the family manifest.
- Public package names may be shorter than workspace names, for example `@sdkwork/im-sdk`, but the package must trace back to the SDK family and authority OpenAPI.
- App SDKs may depend on public/domain SDKs or provider SDKs only through public package entrypoints. They `MUST NOT` import generated transport internals from another family.
- Backend SDKs `MUST NOT` depend on app UI packages, app route guards, or user-facing shell runtime.

Example mapping:

| Route crate | Aggregated API authority | SDK family | Prefix |
| --- | --- | --- | --- |
| `sdkwork-routes-conversation-open-api` | `sdkwork-im-open-api` | `sdkwork-im-sdk` | `/im/v3/api` |
| `sdkwork-routes-merchandise-app-api` | `sdkwork-shop-app-api` | `sdkwork-shop-app-sdk` | `/app/v3/api` |
| `sdkwork-routes-order-backend-api` | `sdkwork-shop-backend-api` | `sdkwork-shop-backend-sdk` | `/backend/v3/api` |

### 3.1 Rust Route Crate Placement

Rust HTTP route crates are capability-level source packages. They configure paths and routers; they do not own generated SDK output.

Recommended source shape:

```text
crates/sdkwork-routes-merchandise-app-api/
  Cargo.toml
  src/lib.rs
  src/paths.rs
  src/routes.rs
  src/handlers.rs
  src/manifest.rs

crates/sdkwork-routes-order-backend-api/
  Cargo.toml
  src/lib.rs
  src/paths.rs
  src/routes.rs
  src/handlers.rs
  src/manifest.rs
```

Rules:

- Route crates `MUST` expose route/path definitions through a package root export or Rust public module; consumers must not import private files.
- Route crates `MUST` expose or feed a route manifest that records package name, API surface, owner, domain, capability, prefix, paths, methods, operationIds, tags, `requestContext: WebRequestContext`, route-level `apiSurface`, auth requirements, and handler binding metadata.
- Route manifests `MUST` be deterministic and suitable for OpenAPI materialization.
- A route crate `MUST` provide one stable manifest entrypoint, for example `src/manifest.rs`
  exporting a framework-neutral manifest structure, a build script emitting JSON, or a checked-in
  `sdkwork.route.manifest.json` file. The normalized artifact consumed by SDK workspace tooling
  `MUST` follow `API_SPEC.md` `kind: sdkwork.route.manifest`.
- Route crates `MUST` validate their surface prefix locally. `sdkwork-routes-merchandise-app-api` cannot mount `/backend/v3/api` or any open-api domain prefix such as `/im/v3/api`.
- Route crates `MUST` not generate SDK code, vendor generated SDK packages, or define final SDK package names.
- Route crates may depend on runtime/service traits and appbase context helpers, but they `MUST NOT` depend on generated app/backend SDKs for the same application authority. Generated SDKs call the API; route crates implement the API.
- Route crate names should use the business capability, for example merchandise, cart, order, payment, catalog, shipment, wallet, tenant, report, or audit. The aggregated authority uses the project/domain, for example commerce.

### 3.1.1 API Assembly Materialization

Repositories that own `crates/sdkwork-routes-<application-code>-*` members `MUST` materialize
`sdkwork-api-<application-code>-assembly` through `pnpm api:assembly:materialize`
per `API_ASSEMBLY_SPEC.md`.

Rules:

- Assembly materialization is a sibling pipeline to route-manifest normalization: it discovers route
  crates from Cargo workspace membership, reads `gateway_route_manifest` / `gateway_mount` exports,
  and writes deterministic `assembly-manifest.json` plus generated dependency wiring.
- Assembly output `MUST` be checked in. CI `MUST` run `pnpm api:assembly:validate` to prove the
  manifest matches workspace discovery.
- Route manifest materialization `MUST NOT` require a parallel HTTP-plane JSON
  catalog. Component specs and route manifests are ownership authority; Cargo
  membership verifies physical inclusion and package naming is diagnostic only.

### 3.2 Route Manifest Artifact Placement

Route manifest source may live inside the Rust route crate, but the SDK workspace needs one normalized view for materialization, ownership checks, and CI diffs.

Recommended normalized output:

```text
<application-root>/sdks/_route-manifests/
  app-api/
    sdkwork-routes-merchandise-app-api.route-manifest.json
    sdkwork-routes-cart-app-api.route-manifest.json
    sdkwork-routes-order-app-api.route-manifest.json
  backend-api/
    sdkwork-routes-order-backend-api.route-manifest.json
  open-api/
    sdkwork-routes-conversation-open-api.route-manifest.json
```

Rules:

- The normalized file name `MUST` be `<packageName>.route-manifest.json`.
- The normalized directory name `MUST` match manifest `surface`.
- The file `packageName`, `surface`, `owner`, `domain`, `capability`, `apiAuthority`,
  `sdkFamily`, `prefix`, route list, route-level `requestContext`, and route-level `apiSurface`
  `MUST` match the source route crate and `API_SPEC.md` route manifest shape.
- Route manifest artifacts are materialization inputs. They `MUST NOT` be placed below
  `generated/server-openapi`, committed as generated SDK control-plane metadata, or imported by UI
  packages and generated SDK consumers.
- If the repository does not commit normalized manifests, the materialization command `MUST` produce
  them before authority OpenAPI generation and the verification command `MUST` compare the produced
  artifacts against the route crate source declarations.
- Normalized manifests `SHOULD` be sorted deterministically by package name, then method, then path,
  then operationId.

## 4. OpenAPI Authority And Derived Inputs

Each OpenAPI-generated SDK family has two contract layers.

| Layer | File pattern | Ownership |
| --- | --- | --- |
| Authority OpenAPI | `openapi/<api-authority>.openapi.yaml` | Human-reviewed source of truth aligned with runtime routes/controllers |
| Derived generator input | `openapi/<api-authority>.sdkgen.yaml`, optional `openapi/<api-authority>.flutter.sdkgen.yaml` | Materialized, deterministic generator input |

Rules:

- Authority OpenAPI documents `MUST` use the OpenAPI 3.x profile in `API_SPEC.md`.
- Authority OpenAPI documents may be materialized from multiple route crate manifests for the same
  owner, domain, and API surface. For example, `sdkwork-shop-app-api` may aggregate
  `sdkwork-routes-merchandise-app-api`, `sdkwork-routes-cart-app-api`, `sdkwork-routes-order-app-api`,
  and `sdkwork-routes-payment-app-api`.
- Route crate manifests `MUST` be aggregated by surface. An `app-api` authority may consume only
  `sdkwork-routes-*-app-api` manifests; a `backend-api` authority may consume only
  `sdkwork-routes-*-backend-api` manifests; an `open-api` authority may consume only
  `sdkwork-routes-*-open-api` manifests.
- Route crate manifests `MUST` also be aggregated by owner, domain, API authority, SDK family, and
  prefix. A materializer `MUST` fail instead of guessing when two candidate manifests disagree on
  any of those fields.
- The aggregated authority name `MUST` follow `SDK_SPEC.md`: `sdkwork-<domain>-open-api`,
  `sdkwork-<domain>-app-api`, or `sdkwork-<domain>-backend-api`. The route crate name
  `sdkwork-routes-<capability>-<surface>` `MUST NOT` be used as an authority filename except as an
  internal route manifest input.
- Authority OpenAPI documents materialized from route manifests `MUST` copy operation ownership,
  source traceability, and framework metadata into `x-sdkwork-owner`,
  `x-sdkwork-api-authority`, `x-sdkwork-source`, `x-sdkwork-source-route-crate`,
  `x-sdkwork-request-context`, `x-sdkwork-api-surface`, and `x-sdkwork-rate-limit-tier` when
  present.
- Authority OpenAPI and derived `*.sdkgen.*` inputs `MUST` use canonical kebab-case
  `x-sdkwork-api-surface` values such as `open-api`, `app-api`, and `backend-api`; camelCase
  framework enum labels such as `openApi`, `appApi`, and `backendApi` are invalid SDK generation
  inputs.
- The materializer `MUST` reject missing route manifest fields, duplicate method/path pairs after
  path-template normalization, wrong surface suffixes, wrong prefixes, dependency-owned routes
  declared as consumer-owned routes, missing or mismatched `requestContext`/`apiSurface`, and
  operationId/tag/domain mismatches.
- Derived generator inputs `MUST` be reproducible from the authority document and materialization script.
- Derived generator inputs `MUST NOT` introduce operations, schemas, security, or paths that are absent from the authority document.
- Generator-specific normalization, language quirks, and Flutter-specific adjustments belong in derived inputs, not runtime API code.
- Authority and derived inputs `MUST` preserve operationId, tag, path, schema, security, problem-detail semantics, `x-sdkwork-request-context`, `x-sdkwork-api-surface`, `x-sdkwork-rate-limit-tier`, `x-sdkwork-wire-protocol`, `x-sdkwork-external-protocol-id`, `x-sdkwork-idempotent`, and the effective `Idempotency-Key` parameter.
- Materialization `MUST` fail when `x-sdkwork-idempotent: true`, the required bounded `Idempotency-Key` parameter, route-manifest idempotency metadata, or generated SDK parameter requirements disagree. Derived inputs `MUST NOT` add idempotency from operationId naming heuristics.
- OpenAPI documents for app-api and backend-api `MUST` use dual-token security where required by `API_SPEC.md` and `IAM_LOGIN_INTEGRATION_SPEC.md`.
- Credential-suppressed SDK-generated operations `MUST` preserve `security: []`, `x-sdkwork-forbid-credential-headers: true`, and the declared `x-sdkwork-auth-mode` into every derived `*.sdkgen.*` input so SDK transport can suppress stored credentials for `anonymous`, `bootstrap-body`, and body-proof `refresh-token` operations.
- Credential-entry operations backed by `HttpRoute::credential_entry_bootstrap` (or its migration alias) `MUST` preserve `security: [{ AccessToken: [] }]`, `x-sdkwork-auth-mode: credential-entry-bootstrap`, and `x-sdkwork-forbid-credential-headers: true` into every derived `*.sdkgen.*` input. Runtime verification proves the route requires bootstrap `Access-Token` and rejects every non-profile credential/context header.
- OpenAPI documents `MUST NOT` expose `X-Request-Id`, wire field `requestId`, generated `xRequestId` parameters, or other client-supplied correlation IDs for app/backend SDKs. Correlation uses server-owned `traceId` only per `API_SPEC.md` §15–§17.
- Authority OpenAPI `MUST` declare shared `SdkWorkApiResponse`, `SdkWorkPlatformErrorCode`, `SdkWorkListQuery`, `ProblemDetail`, `PageInfo`, and helper payloads through `$ref` to `../sdkwork-specs/templates/openapi/components/` or an equivalent inlined copy that preserves required fields.
- Success operation responses for L2+ `app-api`, `backend-api`, and SDKWork-owned `open-api` `MUST` use `SdkWorkApiResponse` with required `code`, `data`, and `traceId`. Legacy envelopes such as `PlusApiResult`, `AppbaseApiResult`, bare domain DTO roots, and top-level `{ items, pageInfo, traceId }` without `data` are forbidden.
- Authority OpenAPI and derived `*.sdkgen.*` inputs `MUST` preserve `API_SPEC.md` section 15.4 operation patterns: create `201`, update `200`, delete `204` without JSON body, async `202`, and `bulk<Action>` typed results.
- SDKWork-owned custom API is the default: omitted `x-sdkwork-wire-protocol` means `sdkwork-v3` and `MUST` follow SDKWork v3 request, response, error, and pagination rules.
- SDKWork-owned business open-api request bodies, list/search input, and command input `MUST` follow `API_SPEC.md` section 14 and section 14.1 the same way as app-api and backend-api. Vendor compatibility open-api operations declared with operation-level `x-sdkwork-wire-protocol: external` plus `x-sdkwork-external-protocol-id` per section 4.5.2 are exempt from section 14 and section 15 wire rules.
- Error responses `MUST` use RFC 9457 `application/problem+json` with `ProblemDetail` including required machine-readable `code` and `traceId`.
- SDK generation for L2+ surfaces `MUST` use `--standard-profile sdkwork-v3` so generated clients unwrap `SdkWorkApiResponse.data` by default and expose `.raw` for full envelope access per `SDK_SPEC.md` §4.2.
- Authority OpenAPI and derived `*.sdkgen.*` inputs `MUST NOT` expose current-tenant selectors named `tenant_id`, `tenantId`, `tenant`, `tenant-id`, `X-Tenant-Id`, or equivalent in path, query, header, cookie, or client-writable request bodies. Tenant context is resolved by dual-token, API-key, or typed request-context infrastructure.
- List/search operations in authority OpenAPI and derived `*.sdkgen.*` inputs `MUST` follow `PAGINATION_SPEC.md`: HTTP GET page-size wire name is `page_size`, forbidden query aliases (`pageSize`, `limit`, `page_no`, `pageNo`, `per_page`, `size`) are absent, `page_size.maximum` is `200` or lower, list outputs include `PageInfo.mode`, and generated transport serializes language-level `pageSize` options as `page_size`.

## 4.1 Dependency Authority Exclusion

Materialization is responsible for converting broad runtime route catalogs into owner-only SDK
authorities. If a repository/application depends on another SDKWork API authority, the consuming
SDK family must subtract that dependency authority before generation.

Rules:

- Materialization scripts `MUST` load or otherwise know every dependency authority that overlaps
  the consuming API prefix.
- Dependency-owned paths `MUST` be removed from the consuming authority and every derived
  `*.sdkgen.*` input before generation. Normalization must compare path templates with parameter
  names canonicalized, for example `{userId}` and `{id}` both compare as `{}`. If ownership differs
  per method, the comparison must include HTTP method.
- The consuming authority `info.description`, README, family-root `sdk-manifest.json`, and component spec
  should state that the authority is owner-only and that dependency capabilities are consumed
  through `sdkDependencies`.
- Dependency SDKs are declared in the consuming SDK family's generation config, family-root `sdk-manifest.json`,
  and family-root `specs/component.spec.json` with matching `sdkDependencies` arrays.
- Independent application roots under `apps/` that include Rust services, Tauri hosts,
  native/Tauri host crates, route crates, repository crates, service crates, or worker crates `MUST`
  declare `sdkwork-appbase` SDK dependencies before generating application-owned SDKs. At minimum,
  app/user-facing app-api consumers declare
  `sdkwork-iam/sdks/sdkwork-iam-app-sdk`; `backend-admin` consumers also declare
  `sdkwork-iam/sdks/sdkwork-iam-backend-sdk`.
- Those Rust-enabled independent apps `MUST` include the Rust package mapping for each required
  appbase SDK dependency when Rust code consumes appbase HTTP SDKs, and their Rust workspace
  manifests must depend on the appbase Rust runtime crates needed for shared context, auth,
  bootstrap, token/session validation, and standalone route behavior.
- Every authored SDK family `MUST` have `specs/component.spec.json` at the family root. Its
  `contracts.sdkDependencies` field `MUST` be present as an explicit array and `MUST` mirror the
  union of family-root `sdk-manifest.json` `sdkDependencies` plus generation-config SDK dependencies.
  SDK families with no dependencies `MUST` declare `contracts.sdkDependencies: []`.
- Dependency SDK families themselves `MUST` be discoverable by the same standards checker as
  consuming SDK families. For example, `sdkwork-iam/sdks/sdkwork-iam-app-sdk` and
  `sdkwork-iam/sdks/sdkwork-iam-backend-sdk` declare their own family manifest metadata and
  operation ownership; applications only reference them through `sdkDependencies`.
- Any committed or materialized `generated/server-openapi` output `MUST` belong to a discoverable
  SDK family with family-root `sdk-manifest.json`. Existing generated output without family manifest metadata is
  not grandfathered; add the family manifest or remove the stale generated output before it can pass
  the global SDK ownership check.
- Each dependency declaration `MUST` include `workspace`, `role`, `required: true`,
  `dependencyMode: "consumer-sdk"`, exact `apiPrefix` or `null` for non-HTTP SDKs,
  `generatedTransportImportPolicy: "forbidden"`, and supported language package names.
- `sdkDependencies[].workspace` `MUST` be unique within each dependency list in generation config,
  family-root `sdk-manifest.json`, per-surface declarations, and
  `specs/component.spec.json`. Duplicate references to the same dependency SDK family are a standards
  failure; merge the package-language metadata into one dependency entry instead.
- Each dependency declaration's `workspace` `MUST` resolve to exactly one SDK family discovered by
  the same global ownership check. Global checks therefore include both consuming application roots
  and dependency SDK roots, for example app roots plus sibling repositories such as
  `../sdkwork-drive` and `../sdkwork-knowledgebase`.
- If a dependency declaration includes `owner`, `apiOwner`, `apiAuthority`, `authoritySpec`, or
  `apiPrefix`, those values `MUST` match the referenced SDK family. `apiPrefix: null` is valid only
  when the referenced SDK family has no HTTP API prefix; it cannot be used to bypass app/backend/open
  prefix matching. Historical authority aliases such as `sdkwork-appbase.app` and
  `sdkwork-iam-app-api` may normalize to the same authority, but app/backend/open authority
  mismatches are invalid.
- Generated transport output `MUST NOT` import dependency SDK packages, vendor their generated
  transport code, re-export dependency SDK clients, or retain stale API/model/doc files for
  dependency-owned routes.
- Generated transport output, generated docs, generated manifests, and generated package/build
  metadata `MUST NOT` reference package names declared in `sdkDependencies[].packageByLanguage`.
  Dependency package names are consumed by composed wrappers, runtime bootstrap, or application
  integration code outside `generated/server-openapi`.
- A generation wrapper `MUST` delete stale generated-owned files that disappeared from the current
  input. A generator that only overwrites files is not sufficient for owner-only SDKs.
- Verification `MUST` compare the consuming authority, derived inputs, and generated output against
  dependency route sets and fail on overlap.
- Dependency authority exclusion is not runtime mount proof. If a consuming application serves or
  intends to serve dependency-owned routes through the same app/backend origin, it `MUST` also
  declare a `dependencyApiSurfaces` runtime integration manifest as required by `SDK_SPEC.md`.
- `dependencyApiSurfaces` entries `MUST` mirror the relevant `sdkDependencies` by workspace,
  consuming SDK family, surface, role, dependency mode, and `apiPrefix`, then add runtime-only
  evidence such as `mode`, `sameOriginAllowed`, required dependency base URL env names, Rust route
  contract crate, executable router export, and mount coverage status.
- A route contract crate or normalized route manifest may be used to compute expected coverage, but
  same-origin dependency SDK base URL inheritance is valid only when the runtime integration entry
  records executable router/controller coverage for all dependency-owned method/path pairs consumed
  by that dependency SDK surface.
- When coverage is absent or partial, SDK workspace verification `MUST` require explicit dependency
  SDK base URL configuration and fail on application app/backend base URL fallbacks such as using the
  application `/app/v3/api` or `/backend/v3/api` default for dependency-owned SDK clients.

### 4.2 Dependency API Export Metadata

Dependency API export configuration is authored composition metadata. It is not OpenAPI generation
input and it does not change owner-only SDK materialization.

Rules:

- Every authored SDK family, authored composed facade, and application core package that depends on
  dependency SDK families `MUST` declare `dependencyApiExports` explicitly in the same ownership
  metadata layer that declares `sdkDependencies`: family-root `sdk-manifest.json` and
  `specs/component.spec.json` under `contracts`.
- `dependencyApiExports` defaults to an empty array. `dependencyApiExports: []` means dependency
  API capabilities are not re-exported by the current SDK family, component, or facade.
- `dependencyApiExports` entries `MUST NOT` be written into authority OpenAPI documents, derived
  `*.sdkgen.*` inputs, generated `sdkwork-sdk.json`, generated package manifests, generated source
  files, or generator `.sdkwork/*` reports.
- Each export entry `MUST` reference a declared `sdkDependencies[].workspace` and repeat the
  dependency SDK family, API authority, surface, and `apiPrefix` or `null` so validators can compare
  dependency ownership without loading generated transport internals.
- Each export entry `MUST` declare:
  - `exportMode`: `none`, `dependency-sdk`, `composed-wrapper`, `service-port`, or
    `documentation-only`.
  - `visibility`: `internal`, `app`, `backend-admin`, `public`, or another visibility value defined
    by the local component spec.
  - `methods` or `methodSelector`: the dependency SDK method ids or approved selector being exposed.
  - `packageExport`, `servicePort`, or `documentationRef` when `exportMode` exposes a symbol or
    documented integration path.
  - `runtimeRequired`: `true` when the exported capability needs a dependency HTTP API to be served
    or proxied by the consuming runtime.
- `dependencyApiExports[].methods` `MUST` use stable dependency SDK method ids or operationIds owned
  by the dependency authority. Wildcards are allowed only when the dependency component spec marks
  the whole surface exportable and the consuming component accepts that blast radius explicitly.
- `dependencyApiExports[].exportMode: "composed-wrapper"` `MUST` point to authored code under
  `composed/`, an application core package, or another approved facade outside
  `generated/server-openapi`.
- `dependencyApiExports[].exportMode: "dependency-sdk"` means the consuming bootstrap may construct
  and inject the dependency SDK client, but the current SDK family does not re-export dependency
  methods.
- `dependencyApiExports[].exportMode: "service-port"` is for runtime/native integration surfaces.
  It `MUST` name the service trait, interface, or port and the dependency runtime/service that
  implements it.
- `dependencyApiExports` verification `MUST` fail when an export references an undeclared
  dependency, uses an unsupported export mode, points to generated transport ownership, or causes
  derived SDK generation input to include dependency-owned operations.
- When `runtimeRequired: true`, SDK workspace checks `MUST` require a matching
  `dependencyApiSurfaces` entry or explicit dependency SDK base URL config. Missing evidence is a
  configuration error, not a runtime `502`/`404` discovery mechanism.

Example metadata:

```json
{
  "sdkDependencies": [
    {
      "workspace": "../sdkwork-iam/sdks/sdkwork-iam-app-sdk",
      "sdkFamily": "sdkwork-iam-app-sdk",
      "apiAuthority": "sdkwork-iam-app-api",
      "surface": "app-api",
      "apiPrefix": "/app/v3/api",
      "required": true,
      "dependencyMode": "consumer-sdk",
      "generatedTransportImportPolicy": "forbidden"
    }
  ],
  "dependencyApiExports": [
    {
      "workspace": "../sdkwork-iam/sdks/sdkwork-iam-app-sdk",
      "sdkFamily": "sdkwork-iam-app-sdk",
      "apiAuthority": "sdkwork-iam-app-api",
      "surface": "app-api",
      "apiPrefix": "/app/v3/api",
      "exportMode": "composed-wrapper",
      "visibility": "app",
      "methods": ["openPlatform.qrAuth.sessions.create", "auth.sessions.create"],
      "packageExport": "./composed/appbase-auth",
      "runtimeRequired": true
    }
  ]
}
```

Example:

If `sdkwork-im` depends on `sdkwork-appbase`, then `sdkwork-im/sdks/sdkwork-im-app-sdk` and
`sdkwork-im/sdks/sdkwork-im-backend-sdk` generate only Craw Chat-owned app/backend APIs.
`sdkwork-appbase` app/backend auth, IAM, session, QR auth, and backend management APIs remain in
`sdkwork-iam/sdks/sdkwork-iam-app-sdk` and
`sdkwork-iam/sdks/sdkwork-iam-backend-sdk`. Craw Chat records those SDKs as dependencies
and consumes them at the composition layer.

For an independent Rust-enabled app under `apps/`, the same dependency rule applies even when the
local Rust runtime starts appbase-owned routes in the same process. The application's `sdks/`
workspace still generates only application-owned authorities, records appbase SDKs in
`sdkDependencies`, and wires appbase Rust crates through the Rust workspace rather than copying
appbase OpenAPI, SDK output, request-context code, or IAM/session logic.

## 5. Backend API OpenAPI 3.x Standard

Backend API is the operator/control-plane contract. It must be SDK-generation ready before UI or automation consumers depend on it.

Rules:

- Backend authority OpenAPI `MUST` live under `<application-root>/sdks/sdkwork-<domain>-backend-sdk/openapi/`.
- Backend runtime paths `MUST` start with `/backend/v3/api`.
- Backend OpenAPI `MUST` use `openapi: 3.1.x` when the toolchain supports it, or a documented OpenAPI 3.x fallback only when generator compatibility requires it.
- Backend OpenAPI `MUST` include stable `info.title`, `info.version`, `servers`, `paths`, `components.schemas`, `components.securitySchemes`, and RFC 9457 `application/problem+json` errors.
- Backend operations `MUST` use the tag and dotted `operationId` rules in `API_SPEC.md` so generated clients expose resource-style methods.
- Backend APIs `MUST NOT` expose login, registration, token refresh, logout, verification code, OAuth callback, password reset, MFA challenge, or device authorization endpoints.
- Backend APIs `MUST NOT` expose an `auth` namespace for user-facing IAM session flows. Those flows belong to app-api and are integrated through appbase IAM.
- Backend operations `SHOULD` declare permission, tenant scope, data scope, and audit metadata through SDKWork OpenAPI extensions.
- Backend SDKs are consumed only by explicit `backend-admin` UI, automation, operator tooling, and control-plane integrations. App/user-facing clients `MUST NOT` consume them.

## 6. Generation Workflow

Standard workflow:

```text
authored API contract in apis/ or runtime API/controller/route crate manifest
  -> normalized route manifest artifacts
  -> authority OpenAPI
  -> materialized sdkgen OpenAPI
  -> ..\sdkwork-sdk-generator\bin\sdkgen.js
  -> generated language SDK
  -> composed facade when needed
  -> consumer service integration
```

Rules:

- Add or change the runtime API route crate/controller manifest and authority OpenAPI in the same
  change set.
- Add or change authored API contracts under `apis/` and the corresponding materialized SDK family
  authority OpenAPI in the same change set when `apis/` is the source contract location.
- Rust route crate manifest changes `MUST` be followed by authority materialization before SDK
  generation.
- Materialization `MUST` load normalized route manifests from
  `<application-root>/sdks/_route-manifests/<surface>/` or produce that normalized view from the
  route crate manifest entrypoints before creating authority OpenAPI.
- Run the family materialization script before SDK generation.
- Generate language packages from derived `*.sdkgen.yaml` inputs, not from ad hoc Swagger UI output.
- Generate language packages with the canonical `sdkgen.js` entrypoint from the SDK generator repository or package resolved through the repository's native build-tool dependency setup; do not use PATH-resolved generators unless the wrapper first proves they are the same canonical generator installation.
- Before calling `sdkgen`, materialize owner-only OpenAPI inputs and subtract dependency-owned
  authority routes. Do not pass a runtime-wide or dependency-inclusive OpenAPI document directly to
  `sdkgen`.
- Before calling `sdkgen`, materialization `MUST` fail if the derived input would generate a current-tenant method argument, `params` field, per-call option, or client-writable body field named `tenant_id` or `tenantId`. Fix the authored API contract or route manifest to use token/API-key context instead of post-processing generated SDK output.
- Before calling `sdkgen`, materialization `MUST` fail if any HTTP operation in the authority OpenAPI or derived `*.sdkgen.*` input omits `x-sdkwork-request-context: WebRequestContext` or `x-sdkwork-api-surface`.
- Put generated transport code under `generated/server-openapi`.
- Put handwritten semantic facades under `composed` only when the SDK family intentionally owns a composed layer.
- Composed code must import generated transport through package root entrypoints, not private generated source paths.
- Generator package, canonical path or resolved package location, generator version or commit, commands, input spec paths, output paths, package names, SDK type, language targets, profile, and wrapper name when present `MUST` be captured in a manifest or README.
- SDK family ownership/dependency manifests `MUST` be generated or checked outside `generated/server-openapi`. Do not make generation idempotency depend on post-processing generated `sdkwork-sdk.json`, generated `package.json`, generated `sdk-manifest.json`, `.sdkwork/sdkwork-generator-manifest.json`, or generated source files with ownership standard fields. Runtime operation maps or composed metadata belong in `composed/` outside generated output.
- Family-root `sdk-manifest.json` is required for SDK family ownership metadata. Generation or materialization tooling `MUST`
  keep it synchronized with generation config and family-root `specs/component.spec.json`.
  It must mirror `sdkOwner`, `apiAuthority`, `sdkFamily`/`sdkName`, `generationInputSpec`, and an
  explicit `sdkDependencies` array. Empty dependencies are represented as `sdkDependencies: []`.
  Authored composed facades or application core packages that use the family manifest `MUST` also
  mirror `dependencyApiExports`; no dependency API exports are represented as
  `dependencyApiExports: []`.
- Re-running materialization and generation without contract changes `SHOULD` be idempotent.
- Re-running generation after a dependency-owned route is removed from the consuming authority
  `MUST` remove stale generated-owned files for that route from source, dist, docs, manifests, and
  language model indexes.

## 7. Language Baseline

The standard OpenAPI HTTP SDK language set is:

- TypeScript
- Dart
- Python
- Go
- Java
- Kotlin
- Swift
- C#
- Flutter
- Rust
- PHP
- Ruby

Rules:

- A product may generate fewer languages only when its README declares the supported subset and no consumer expects the missing package.
- TypeScript and Flutter may use layered generated-plus-composed workspaces.
- Dart, Python, Go, Java, Kotlin, Swift, C#, Rust, PHP, Ruby, and similar targets should keep handwritten helpers thin and outside generated output.
- Android requests route to Kotlin as the generator target unless a separate Android wrapper is explicitly approved.
- iOS requests route to Swift as the generator target unless a separate iOS wrapper is explicitly approved.
- IAM-owned reusable SDK families `sdkwork-iam-app-sdk` and `sdkwork-iam-backend-sdk` `MUST` generate the full language baseline unless a governance exception explicitly narrows the supported consumer set.
- Independent Rust-enabled app repositories under `apps/` that consume appbase capabilities `MUST`
  declare the Rust-language package names for the required appbase SDK dependencies and must not
  omit Rust simply because TypeScript/React is the primary UI language.

## 8. Application Integration Rules

Rules:

- UI code calls services. Services call injected SDK clients. SDK clients own transport.
- App-side PC React, H5 mobile React, Flutter, mini program, native Android, native iOS, native HarmonyOS, desktop, and Tauri renderers use app SDKs for user-facing remote business capability.
- `backend-admin` UI uses backend SDKs for operator capability and follows `BACKEND_UI_SPEC.md`.
- IAM login/session integration follows `IAM_LOGIN_INTEGRATION_SPEC.md`; do not regenerate application-local login SDKs for appbase-owned auth flows.
- Rust implementations must expose the same OpenAPI paths, operationIds,
  schemas, errors, and security semantics as the Java contract for shared APIs
  across standalone/cloud profiles.
- Rust appbase implementations must wrap protected routers with the standard
  appbase request context framework so generated app/backend SDK consumers
  observe the same auth, tenant, organization, user, trace id, and
  problem-detail behavior.
- Tauri commands should validate local/native capability and then call Rust services or injected SDK clients through approved boundaries. They must not become a hidden raw HTTP SDK replacement.

## 9. Verification

Every SDK family change should verify the relevant subset:

- OpenAPI validates under `API_SPEC.md`, including section 4.5 business open-api input/output parity, section 15.4 operation patterns, `SdkWorkApiResponse` success envelopes, and `ProblemDetail` errors for L2+ surfaces (`node ../sdkwork-specs/tools/check-api-operation-patterns.mjs --root .` or `--workspace ..`; `node ../sdkwork-specs/tools/check-api-response-envelope.mjs --root .` or `--workspace ..`).
- When `apis/` is present, authored API contract sources trace to the materialized authority OpenAPI
  under the owning SDK family in `sdks/`.
- `apis/` contains no generated SDK transport output, SDK family directories, or generated SDK
  control-plane `.sdkwork/` files.
- Application-root `.sdkwork/skills/` and `.sdkwork/plugins/` validate under
  `SDKWORK_WORKSPACE_SPEC.md`.
- HTTP SDK generation uses `@sdkwork/sdk-generator` / `sdkgen` from `..\sdkwork-sdk-generator`.
- No official SDK generation command, manifest, README, or CI job uses copied generator code, local stubs, generic OpenAPI generators, application-local aliases, or an independent `sdkwork-code-generator`. `sdkwork-code-generator` is only an alias/wrapper name for the canonical `..\sdkwork-sdk-generator\bin\sdkgen.js` entrypoint.
- The application root has no forbidden SDK family directories matching `sdks/sdkwork-<domain>-open-api`, `sdks/sdkwork-<domain>-app-api`, `sdks/sdkwork-<domain>-backend-api`, `sdks/<domain>-open-sdk`, `sdks/<domain>-app-sdk`, or `sdks/<domain>-backend-sdk`.
- Rust route crates, when present, follow
  `crates/sdkwork-routes-<capability>-<surface>/` and are not placed under `sdks/`.
- Route crate package names start with `sdkwork-routes-` and end with exactly one of `open-api`,
  `app-api`, or `backend-api`.
- Generated language workspace directories, generated package names, `sdkMetadata.name`, `sdk-manifest.json.sdkName`, generator `SDK_NAME`, and generator `--sdk-name` all use the SDK family name, not the API authority name.
- Generated HTTP/OpenAPI output retains `sdkwork-sdk.json`, `.sdkwork/sdkwork-generator-manifest.json`, `.sdkwork/sdkwork-generator-changes.json`, `.sdkwork/sdkwork-generator-report.json`, and `custom/`.
- Generated `sdkwork-sdk.json`, generated `package.json`, generated `sdk-manifest.json` when present, and generated source files remain generator-owned and do not carry ownership/dependency standard fields or `sdkwork` ownership metadata blocks.
- Materialization script produces deterministic authority-to-derived output.
- Materialization script produces deterministic route-manifest-to-authority output when Rust route
  crates participate in the API.
- Materialization script rejects route manifests whose crate name, declared surface, and path prefix
  disagree.
- Materialization script rejects route manifests whose package name, capability, surface,
  `apiAuthority`, `sdkFamily`, prefix, route ownership, route auth mode, `requestContext`, or
  `apiSurface` does not match `API_SPEC.md`.
- Materialized authority operations produced from route manifests include `x-sdkwork-owner`,
  `x-sdkwork-api-authority`, `x-sdkwork-source`, `x-sdkwork-source-route-crate`,
  `x-sdkwork-request-context`, `x-sdkwork-api-surface`, and `x-sdkwork-rate-limit-tier` when
  present.
- Derived `*.sdkgen.*` inputs preserve `x-sdkwork-request-context`, `x-sdkwork-api-surface`, and
  `x-sdkwork-rate-limit-tier` from the authority OpenAPI.
- Route manifest to authority materialization and authority to `*.sdkgen.*` derivation `MUST`
  preserve operation-level `x-sdkwork-wire-protocol` and `x-sdkwork-external-protocol-id`.
  Missing wire protocol remains `sdkwork-v3`; materializers `MUST NOT` infer third-party
  compatibility from path prefixes alone.
- Materialization script excludes dependency-owned authority routes from consuming SDK inputs.
- Materialization script rejects authority or derived inputs that would generate `tenant_id` or `tenantId` current-tenant SDK inputs.
- `sdkDependencies` in generation config, family-root `sdk-manifest.json`, and family-root
  `specs/component.spec.json` match exactly. Families with no dependencies still declare
  `contracts.sdkDependencies: []`.
- `dependencyApiExports` in generation config, family-root
  `sdk-manifest.json`, and `specs/component.spec.json` match where authored facades or
  application core packages re-export dependency capability. Families and facades with no
  dependency API exports still declare `dependencyApiExports: []`.
- Family-root `sdk-manifest.json` declares owner, authority, SDK family/name, generation input,
  and `sdkDependencies`, and matches generation config plus family-root `specs/component.spec.json`.
- Generated transport contains no dependency-owned routes, operationIds, DTOs, API classes,
  language package names, stale docs, stale dist bundles, or generated model indexes.
- Enabling `dependencyApiExports` does not change generated application-owned SDK methods, schemas,
  namespaces, generated docs, imports, package metadata, or generated model indexes.
- Generated TypeScript compiles when TypeScript is supported.
- Generated SDK exposes nested resource methods from `tag + dotted operationId`.
- Generated clients handle `Authorization` and `Access-Token` through SDK/bootstrap infrastructure.
- Generated clients unwrap `SdkWorkApiResponse.data` by default for `--standard-profile sdkwork-v3` and expose `.raw` for `code`/`traceId` when needed.
- Generated clients do not expose legacy unwrap helpers for `PlusApiResult`, `AppbaseApiResult`, `StoreApiResult`, `SdkWorkResponse`, or per-domain `*ApiResult`.
- Generated clients do not expose `tenant_id` or `tenantId` as current-tenant method arguments, `params` fields, credential options, per-call options, or client-writable request body fields.
- Problem-detail errors map to generated SDK error metadata where the language supports it.
- App consumers contain no raw app/backend HTTP fallback, manual auth headers, or local SDK forks.
- `backend-admin` consumers contain no `fetch`, `axios`, string-built backend URLs, `getBackendSdkClient().http`, or generated-output edits.
- Component specs validate for each authored SDK family.

Example verification commands:

```powershell
# Run from <application-root>.
node .\sdks\materialize-<domain>-v3-openapi-boundaries.mjs
node .\sdks\sdkwork-<domain>-sdk\bin\verify-sdk.mjs
node .\sdks\sdkwork-<domain>-app-sdk\bin\verify-sdk.mjs
node .\sdks\sdkwork-<domain>-backend-sdk\bin\verify-sdk.mjs
```

## 10. Acceptance Checklist

- [ ] `<application-root>/sdks/` exists.
- [ ] `<application-root>/apis/` exists when the application authors API contracts, and its contents
  trace to the materialized SDK family authority OpenAPI when SDK generation is required.
- [ ] `<application-root>/.sdkwork/skills/` and `<application-root>/.sdkwork/plugins/` exist and follow `SDKWORK_WORKSPACE_SPEC.md`.
- [ ] HTTP SDK generation uses the canonical `@sdkwork/sdk-generator` / `sdkgen` from `..\sdkwork-sdk-generator`.
- [ ] Authority OpenAPI declares section 15.4 operation patterns, `SdkWorkApiResponse` success schemas, section 14 list/search input for business open-api operations, and `ProblemDetail` errors; wire field `requestId` is absent.
- [ ] Authority OpenAPI, derived `sdkgen` inputs, and generated transport pass `node <sdkwork-specs>/tools/check-pagination.mjs --workspace <workspace-root>` for canonical `page_size`, `PageInfo.mode`, and forbidden alias checks.
- [ ] Omitted `x-sdkwork-wire-protocol` is treated as SDKWork-owned custom API (`sdkwork-v3`) in authority OpenAPI, derived `sdkgen` inputs, generated SDKs, and runtime mapping.
- [ ] Vendor compatibility open-api operations, when present, declare operation-level `x-sdkwork-wire-protocol: external` and `x-sdkwork-external-protocol-id`; they do not mix upstream wire with `SdkWorkApiResponse` on the same operation.
- [ ] L2+ SDK generation uses `--standard-profile sdkwork-v3` and frontend/backend consumers use generated unwrap behavior instead of local envelope parsers.
- [ ] Generated HTTP/OpenAPI output retains `sdkwork-sdk.json`, `.sdkwork/sdkwork-generator-manifest.json`, `.sdkwork/sdkwork-generator-changes.json`, `.sdkwork/sdkwork-generator-report.json`, and `custom/`.
- [ ] Generated control-plane and source metadata stays canonical: `sdkwork-sdk.json`, generated package manifests, generated `sdk-manifest.json` when present, and generated source files do not contain owner/dependency overlay fields.
- [ ] SDK families use `sdkwork-<domain>-sdk`, `sdkwork-<domain>-app-sdk`, and `sdkwork-<domain>-backend-sdk` where those surfaces exist.
- [ ] Rust route crates, when present, use `sdkwork-routes-<capability>-open-api`,
  `sdkwork-routes-<capability>-app-api`, or `sdkwork-routes-<capability>-backend-api` and live
  outside `sdks/`.
- [ ] Route manifest artifacts, when present, use `kind: sdkwork.route.manifest`, normalize to
  `sdks/_route-manifests/<surface>/<packageName>.route-manifest.json`, and pass package name,
  surface, prefix, authority, SDK family, auth-mode, ownership, and duplicate-route validation.
- [ ] No `sdks/sdkwork-<domain>-open-api`, `sdks/sdkwork-<domain>-app-api`, `sdks/sdkwork-<domain>-backend-api`, `sdks/<domain>-open-sdk`, `sdks/<domain>-app-sdk`, or `sdks/<domain>-backend-sdk` directory exists.
- [ ] Generated SDK metadata, manifests, package names, language workspace names, and generator arguments use the SDK family name and do not use API authority names as SDK names.
- [ ] Family README declares SDK family, API authority name, API prefix, audience, generated languages, and verification commands.
- [ ] Every SDK family root containing `openapi/*.sdkgen.{json,yaml,yml}` declares family-root `sdk-manifest.json`; no SDK family is invisible to global ownership checks.
- [ ] Every SDK family root containing `generated/server-openapi` output declares family-root `sdk-manifest.json`; stale or legacy generated output is not invisible to global ownership checks.
- [ ] `specs/component.spec.json` exists for every authored SDK family.
- [ ] Every SDK family `specs/component.spec.json` declares `contracts.sdkDependencies` explicitly,
  including `[]` for no dependencies.
- [ ] Every family-root `sdk-manifest.json` declares explicit `sdkDependencies` and
  matches generation config plus `specs/component.spec.json` for owner, authority, SDK family/name, and generation input.
- [ ] Authority OpenAPI and derived `sdkgen` inputs are separated.
- [ ] Route crate manifests, when present, aggregate into authority OpenAPI by matching owner,
  domain, surface, API authority, SDK family, and prefix.
- [ ] Authority OpenAPI operations materialized from route manifests declare `x-sdkwork-owner`,
  `x-sdkwork-api-authority`, `x-sdkwork-source`, `x-sdkwork-source-route-crate`,
  `x-sdkwork-request-context`, `x-sdkwork-api-surface`, and `x-sdkwork-rate-limit-tier` when
  present.
- [ ] Authority OpenAPI and derived `sdkgen` inputs contain only owner application/repository API
  routes; dependency authorities are subtracted before generation.
- [ ] Dependency SDKs are recorded in matching `sdkDependencies` entries across generation config,
  family-root `sdk-manifest.json`, and family-root `specs/component.spec.json`.
- [ ] Dependency API export policy is recorded in matching `dependencyApiExports` entries across
  generation config, family-root `sdk-manifest.json`, and
  family-root `specs/component.spec.json`; use `[]` when no dependency capability is re-exported.
- [ ] Every `dependencyApiExports` entry references a declared dependency SDK family, uses an
  approved export mode, and points only to authored composed/application/service-port/documentation
  surfaces outside generated transport.
- [ ] Independent Rust-enabled `apps/` repositories declare `sdkwork-appbase` dependencies, required
  appbase Rust crates, `sdkwork-iam-app-sdk`, and `sdkwork-iam-backend-sdk` when `backend-admin`
  appbase capabilities are used.
- [ ] Every `sdkDependencies[].workspace` resolves to exactly one SDK family in the same global
  ownership check, is unique within its dependency list, and declared owner, authority, authority
  spec, and API prefix values match the referenced dependency family.
- [ ] Generated transport does not copy, import, vendor, or retain stale files for dependency-owned
  APIs.
- [ ] Enabling `dependencyApiExports` does not change the generated application-owned SDK method surface or add
  dependency-owned schemas, API classes, docs, imports, or package metadata.
- [ ] Generated transport output, generated docs, generated manifests, and generated package/build
  metadata do not reference package names declared in `sdkDependencies[].packageByLanguage`.
- [ ] Generated output is under `generated/server-openapi`.
- [ ] Handwritten facades are outside generated output.
- [ ] Backend API OpenAPI uses `/backend/v3/api` and has no login/session namespace.
- [ ] Consumers use generated SDKs or approved composed wrappers only.
- [ ] Verification commands are recorded in the change or release notes.
