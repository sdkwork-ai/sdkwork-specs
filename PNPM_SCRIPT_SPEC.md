# SDKWork pnpm Script Standard

- Version: 1.0
- Scope: public `package.json#scripts` command names for SDKWork application repositories, application roots, app surface roots, and TypeScript/JavaScript packages
- Related: `README.md`, `SOUL.md`, `SDKWORK_WORKSPACE_SPEC.md`, `NAMING_SPEC.md`, `APPLICATION_GATEWAY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_NAMING.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `DEPLOYMENT_SPEC.md`, `RELEASE_SPEC.md`, `APP_MANIFEST_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `SDKWORK_DEPLOY_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `TEST_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`

This standard defines the public `pnpm` command surface for SDKWork. It prevents each application from inventing application-code-prefixed or locally ordered commands such as `drive:dev`, `cloudrouter:dev`, or `im:dev`.

The command name must describe the action and standard runtime axis. Product-specific implementation belongs behind a standard dispatcher, manifest, topology profile, workflow config, or internal runner script.

## 1. Goals

Rules:

- SDKWork automation `MUST` be able to run common application tasks without knowing the product name.
- Repository root commands `MUST` use one public vocabulary across applications.
- Application-code tokens `MUST NOT` be the first segment of public root scripts.
- Application differences `MUST` be expressed through `runtimeTarget`, `database`, `deploymentProfile`, `environment`, manifests, and topology profiles, not through application-code-prefixed script names.
- Command examples in standards, README files, agent instructions, and runbooks `MUST` use this standard vocabulary.

## 2. Command Layers

SDKWork uses four command layers.

| Layer | Owner | Purpose | Public automation surface |
| --- | --- | --- | --- |
| Repository root | application repository | Cross-application development, build, release, deployment, verification orchestration | Yes |
| App surface root | PC, H5, Flutter, native, mini program, backend/admin UI, docs, or equivalent app surface | Local renderer/package development and build | Yes, but scoped to that app surface |
| Package root | feature package, SDK wrapper, docs package, native host package | Package-local typecheck, test, build, lint | Package-local only |
| Internal runner | `scripts/`, `tools/`, package CLI, Rust/Cargo, Gradle, Flutter, Tauri, Vite | Implementation details | No |

Rules:

- Repository root commands are the stable automation contract.
- App surface and package commands may be narrower, but they should still use standard base names such as `dev`, `build`, `typecheck`, `lint`, `test`, and `clean`.
- Internal runner names may contain product names when the file is application-owned, but those names `MUST NOT` leak into public root script names.
- Root commands `SHOULD` call a standard dispatcher such as
  `node scripts/sdkwork-command.mjs ...` or a thin equivalent wrapper, unless
  the task-specific standard requires direct canonical-tool delegation. The
  `api:assembly:*` commands in section 7 are such an exception.
- Vendored upstream source trees under `external/`, `third_party/`, and `vendor/` are excluded from application-owned script-name validation. SDKWork-owned wrappers and workspace packages around them remain in scope.
- Historical release records under `docs/release/` and tool-owned scratch plans such as `.mimocode/` are not active command documentation and are excluded. Current README, AGENTS, guides, references, runbooks, architecture decisions, and migration instructions remain in scope.

## 2.1 Shared Application Lifecycle Framework

SDKWork application roots `SHOULD` compose the lifecycle from the three shared
framework authorities instead of copying orchestration logic into each project:

| Authority | Responsibility |
| --- | --- |
| `sdkwork-app-topology` | Local `sdkwork-app` facade, topology v5 validation, resolved runtime plans, environment loading, and development process orchestration |
| `sdkwork-github-workflow` | Build, package, sign, SBOM, publish, release matrix, and reusable GitHub workflow planning |
| `sdkwork-specs/tools/deployctl.mjs` | Typed deployment plan validation, immutable artifact evidence, apply, health verification, and rollback |

Rules:

- Public root scripts `MUST` remain thin aliases to the shared facade or an
  equally thin repository wrapper. They `MUST NOT` duplicate topology process
  ordering, profile selection, artifact matrix calculation, publication, or
  deployment side effects.
- Applications using `pnpm exec sdkwork-app` `MUST` declare a pinned
  `@sdkwork/app-topology` workspace or release dependency. They `MUST NOT`
  depend on an undeclared globally installed CLI or a fixed parent-directory
  checkout layout.
- The shared framework `MUST` resolve the existing application manifest,
  topology, workflow, source-config, and deploy declarations. It `MUST NOT`
  introduce a second application identity or parallel deployment-mode manifest.
- Application-specific implementation commands `MAY` remain in the private
  `_sdkwork:*` namespace. These hooks are consumed by the shared facade and are
  not public automation commands, release documentation, or a replacement for
  the standard lifecycle contract.
- Topology process hooks use responsibility-specific private namespaces:
  `_sdkwork:client:*` for local client processes, `_sdkwork:gateway:*` only for
  canonical API gateway processes, and `_sdkwork:runtime:*` for workers,
  protocol ingress, realtime hosts, simulators, or other non-gateway runtime
  processes. A device or realtime edge runtime `MUST NOT` be placed under the
  gateway namespace.
- The canonical root facade is:

```json
{
  "dev": "pnpm dev:standalone",
  "dev:standalone": "pnpm exec sdkwork-app dev --deployment-profile standalone",
  "dev:cloud": "pnpm exec sdkwork-app dev --deployment-profile cloud",
  "stop": "pnpm exec sdkwork-app stop",
  "build": "pnpm exec sdkwork-app build",
  "test": "pnpm exec sdkwork-app test",
  "check": "pnpm exec sdkwork-app check",
  "verify": "pnpm exec sdkwork-app verify",
  "clean": "pnpm exec sdkwork-app clean"
}
```

- A private hook `MUST` be named `_sdkwork:<phase>` or
  `_sdkwork:dev:<standalone|cloud>`. The public command `MUST` select the
  profile; the private hook supplies only application-specific tool commands.
- Applications `MUST NOT` implement private `_sdkwork:stop` process-selection
  logic. The shared facade owns stop semantics through its scoped heartbeat
  registry plus topology-declared `bindEnv` and managed-resource drivers.
  Private development runners remain migration-only and `MUST` declare their
  owned TCP bindings in topology until they are replaced by generic topology
  processes.
- Release and deployment public scripts `MUST` delegate to the workflow or
  deploy framework and preserve phase-first profile order. Product packaging
  hooks may be called by `sdkwork.workflow.json` lifecycle steps, but a public
  release script `MUST NOT` invoke `_sdkwork:release:*` directly and bypass the
  workflow matrix, validation, or evidence gates.
- `pnpm dev` remains exactly equivalent to `pnpm dev:standalone`; adding a
  private hook must never change that default.

## 3. Required Root Commands

Every SDKWork application repository root `MUST` expose these commands:

```text
pnpm dev
pnpm dev:standalone
pnpm dev:cloud
pnpm build
pnpm test
pnpm check
pnpm verify
pnpm clean
```

Meanings:

| Command | Meaning |
| --- | --- |
| `dev` | Delegate to `dev:standalone` as the transparent default development workflow |
| `dev:standalone` | Start `standalone.development`, including the local application deployment unit and declared local dependencies |
| `dev:cloud` | Start local developer-facing clients against already deployed `cloud.development` API surfaces without starting local API, gateway, or database processes |
| `stop` | Stop only the processes attributable to this repository's development workflow |
| `build` | Build the default production artifact or default app surface |
| `test` | Run the default stable test subset for the repository |
| `check` | Run static standards, generated-artifact, dependency, config, or policy checks without packaging a release |
| `verify` | Run the merge-ready verification aggregate for the repository |
| `clean` | Remove reproducible local build/test artifacts (`dist/`, tool-native cache directories, and framework-owned temporary state) without deleting git-tracked source files, build-critical source contracts (see `CODE_STYLE_SPEC.md` §7), checked-in config, secrets, databases, or user-private runtime files |

When a repository root exposes `dev`, it `MUST` also expose `stop`. A `stop` command
MUST scope process selection to the owning repository or its explicitly configured
runtime bindings. It MUST NOT terminate processes merely because they share a generic
executable name such as `node`, `cargo`, `java`, or `python`.

Development profile rules:

- Root `dev` `MUST` directly delegate to `dev:standalone` through `pnpm
  dev:standalone` or `pnpm run dev:standalone`; it must not independently
  reproduce the standalone flags.
- `dev:standalone` `MUST` resolve to `deploymentProfile = standalone` and
  `environment = development` through its delegation chain.
- `dev:cloud` `MUST` resolve to `deploymentProfile = cloud` and
  `environment = development` through its delegation chain.
- `dev:cloud` `MUST NOT` select a local database, run database bootstrap, or
  autostart application/platform API processes. It loads explicit remote
  surface URLs from `cloud.development` source config and fails before client
  startup when a required URL is absent.
- `dev:cloud` `MUST NOT` fall back to `standalone.development`, loopback API
  defaults, or `cloud.production`. An approved local tunnel remains explicit
  topology config rather than an implicit command fallback.
- `stop` after `dev:cloud` stops only processes created by the local
  development session and never operates on deployed cloud services.

When the capability exists, the repository root `MUST` expose the matching command family:

| Capability | Required commands |
| --- | --- |
| Runtime start, stop, or preview | `start`, `stop`, `preview` |
| TypeScript/JavaScript package verification | `typecheck`, `lint`, `format`, `format:check` |
| Release packaging | `release:plan`, `release:build`, `release:stage`, `release:package`, `release:validate`, `release:publish` as applicable |
| Deployment | `deploy:plan`, `deploy:apply`, `deploy:rollback`, `deploy:validate` as applicable |
| API materialization | `api:materialize`, `api:materialize:check`, `api:check` |
| SDK generation | `sdk:generate`, `sdk:generate:check`, `sdk:check` |
| Database operations | `db:plan`, `db:init`, `db:migrate`, `db:seed`, `db:status`, `db:validate`, `db:materialize:contract`, `db:bootstrap`, `db:drift`, `db:drift:check`, `db:postgres:plan`, `db:postgres:init`, `db:postgres:migrate` when PostgreSQL is used |
| IAM application bootstrap | `admin:bootstrap:app`, `check:iam-application-bootstrap`, `test:contract:iam-application-bootstrap` when bootstrap tooling exists |
| Gateway operations | `gateway:run`, `gateway:plan`, `gateway:build`, `gateway:package`, `gateway:validate`, `gateway:matrix` |
| Topology | `topology:validate`, `topology:plan` as applicable |
| Supply-chain evidence | `sbom:generate`, `sbom:check` as applicable |

## 4. Script Name Grammar

Repository root script names `MUST` follow:

```text
<command>[:runtimeTarget][:database][:deploymentProfile][:tier]
```

The first segment `MUST` be a standard command or standard tool namespace.

Allowed command or namespace first segments:

```text
dev
start
stop
preview
build
test
check
verify
clean
typecheck
lint
format
release
deploy
desktop
db
api
sdk
gateway
topology
workflow
sbom
nginx
docs
perf
migrate
install
admin
models
downloads
skills
app-store
smoke
```

Rules:

- Use `api`, not `apis`, for new root scripts.
- Use `sdk`, not application-specific SDK prefixes such as `file-sdk`, for cross-application SDK generation and verification commands. Domain-specific package commands may keep narrower names inside the owning package.
- Runtime targets `MUST` be exposed through action-first scripts such as `dev:browser`,
  `dev:desktop`, `build:desktop`, `build:container`, `build:android-native`,
  `build:ios-native`, `dev:flutter-android`, and `release:package:mini-program`.
  Desktop hosts additionally expose the `desktop:*` host family (section 4.1) as
  equivalent aliases.
- Root `dev:browser` and `dev:desktop` are normalized development defaults.
  When present, each `MUST` resolve to `database = postgres`,
  `deploymentProfile = standalone`, and `environment = development`,
  either by delegating to `dev:<target>:postgres:standalone`
  or by passing equivalent explicit flags such as `--database postgres`,
  `--deployment-profile standalone`, and `--environment development`.
  Cloud development variants use explicit suffixed scripts such as
  `dev:browser:cloud` or `dev:desktop:cloud`. A client/native module may expose
  `dev:desktop:sqlite` only to validate its declared client-local SQLite store;
  that suffix does not select SQLite for an application gateway, backend
  service, worker, or other server process. `dev:browser:sqlite` is forbidden
  because a browser bundle does not own an embedded SQLite database.
- Root `dev:standalone` and `dev:cloud` are deployment-profile shortcuts that
  select the repository's default developer-facing runtime target. More
  specific commands retain the grammar
  `dev:<runtimeTarget>[:database]:<deploymentProfile>`.
- Every supported developer-facing client target `SHOULD` expose both profile
  variants, for example `dev:desktop:standalone` / `dev:desktop:cloud`,
  `dev:capacitor-ios:standalone` / `dev:capacitor-ios:cloud`,
  `dev:flutter-android:standalone` / `dev:flutter-android:cloud`, and
  `dev:ios-native:standalone` / `dev:ios-native:cloud`. Cloud variants never
  include a database axis or start a local gateway.
- Desktop hosts with Electron packaging `SHOULD` expose `dev:desktop:electron`
  and `build:desktop:electron` (and optional `build:desktop:electron:prod`);
  these select the Electron host while keeping the same renderer dev server,
  profile defaults, and PostgreSQL database rules as the Tauri host.
- Client build commands are profile-neutral by default, such as
  `build:desktop`, `build:capacitor-ios`, `build:flutter-android`, and
  `build:ios-native`. A profile-specific client build is allowed only when
  code, permissions, signing identity, entitlement, or store identity differs;
  endpoint selection alone is not sufficient reason to duplicate an artifact.
- Tool or platform names such as `browser:*`, `tauri:*`, `electron:*`, `docker:*`,
  `android:*`, `ios:*`, `harmony:*`, `flutter:*`, and `mini-program:*` `MUST NOT`
  be public root, app surface, or package-local script names when they represent
  a runtime target or tool. The tool remains an internal runner detail behind the
  standard action-first script or the `desktop:*` host family.
- `desktop:*` is the reserved desktop host-family prefix (section 4.1). It `MUST`
  be followed by an allowed action and optional host/profile axes; other
  `desktop:*` forms are rejected.
- `tauri` and `electron` `MUST NOT` appear as public script runtime target
  suffixes such as `dev:tauri` or `dev:electron`; use `dev:desktop`, `build:desktop`,
  or `desktop:dev` instead. When a specific native host must be selected, use an
  explicit host suffix such as `dev:desktop:electron`, `build:desktop:electron`,
  or `desktop:dev:electron`; the default `dev:desktop` / `desktop:dev` remains
  the Tauri host.
- Docker-compatible runtime artifacts `MUST` map to `runtimeTarget = container`,
  not to a public `docker:*` command family.

### 4.1 Desktop Host Family

PC desktop roots expose a `desktop:*` command family as the top-level developer
entry for native desktop hosts. The family is host-aware: it defaults to the
Tauri host and selects the Electron host with an explicit `electron` axis.

Grammar:

```text
desktop:<action>[:<host>][:<deploymentProfile>]
```

Allowed actions: `dev`, `build`, `check`, `test`, `release`, `package`,
`preview`, and `smoke`.

Allowed host axes: `tauri` (default) and `electron`.

Allowed profile axes: `standalone` and `cloud` (plus `postgres`/`sqlite`
database and `development`/`staging`/`prod`/`local` environment suffixes where
the action accepts them).

Examples:

```text
pnpm desktop:dev                 # 默认宿主 tauri，等价 pnpm dev:desktop
pnpm desktop:dev:electron        # Electron 宿主，等价 pnpm dev:desktop:electron
pnpm desktop:dev:standalone      # standalone profile（默认宿主 tauri）
pnpm desktop:dev:cloud
pnpm desktop:build               # 默认宿主 tauri，等价 pnpm build:desktop
pnpm desktop:build:electron
pnpm desktop:build:electron:prod
pnpm desktop:check               # 默认宿主校验（tauri config）
pnpm desktop:test
pnpm desktop:release
```

Rules:

- `desktop:dev` / `desktop:build` `MUST` resolve to the same defaults as
  `dev:desktop` / `build:desktop` (PostgreSQL, standalone, development) and are
  their equivalent aliases, not separate semantics.
- `desktop:*` commands with no host axis use the Tauri host; the Electron host
  is always explicit (`desktop:dev:electron`).
- The `desktop:*` family applies to root, app-surface, and package-local scripts
  under the same constraints as `dev:desktop` / `build:desktop`.
- `desktop:*` is a native-host family. It is not a web/browser alias; use
  `dev:browser` for browser development.

### 4.2 Browser Client Build Family (PC And H5)

Adaptive Web browser clients (`apps/sdkwork-<code>-pc`, `apps/sdkwork-<code>-h5`)
expose a standard environment-scoped build command family at the **repository
root** and at each **browser app surface root**.

Grammar:

```text
build:<clientArchitecture>:<environment>[:<deploymentProfile>]
```

Repository root examples:

```text
pnpm build:pc:dev
pnpm build:pc:test
pnpm build:pc:staging
pnpm build:pc:prod
pnpm build:h5:dev
pnpm build:h5:test
pnpm build:h5:staging
pnpm build:h5:prod
pnpm build:pc:prod:cloud
pnpm build:h5:dev:standalone
```

App surface root examples (same lifecycle environments, no architecture axis):

```text
pnpm build:dev
pnpm build:test
pnpm build:staging
pnpm build:prod
pnpm build:prod:cloud
```

Rules:

- `<clientArchitecture>` `MUST` be `pc` or `h5`. These identify Adaptive Web
  surface roots, not generic runtime targets.
- `<environment>` `MUST` use lifecycle aliases from `ENVIRONMENT_SPEC.md`:
  `dev`, `test`, `staging`, or `prod`. They normalize to
  `development`, `test`, `staging`, and `production` before Vite mode and
  runtime config selection.
- `<deploymentProfile>` `MAY` be omitted; omitted means `standalone`.
  Explicit values are `standalone` or `cloud`.
- Vite `build.outDir` `MUST` resolve to `dist/<environmentAlias>/` where
  `<environmentAlias>` is `dev`, `test`, `staging`, or `prod`. Bare `dist/`
  is forbidden (`FRONTEND_CODE_SPEC.md` §7,
  `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1).
- Repository roots that own a PC or H5 browser app surface `MUST` expose the
  matching `build:pc:*` and/or `build:h5:*` commands for every lifecycle
  environment the product ships.
- App surface roots `MUST` expose `build:dev`, `build:test`, `build:staging`,
  and `build:prod` when the surface is a Vite browser client.
- Root and app-surface build commands `MUST` delegate to the shared canonical
  runner `node <sdkwork-specs>/tools/build-browser-client.mjs` or a thin
  repository wrapper that forwards equivalent flags. They `MUST NOT` invent
  local Vite mode or output-directory conventions.
- `build:pc:*` and `build:h5:*` are build-only commands. They `MUST NOT`
  start dev servers, databases, or gateways.
- Container and Docker workflows `MAY` invoke the same runner against a cloned
  module checkout under `SDKWORK_SPACE_ROOT` so each sibling application can
  be built independently without rebuilding the whole workspace.
- Legacy profile-only browser build names such as bare `build:standalone` remain
  migration input at app surfaces until replaced; new automation `MUST` use the
  environment-scoped family above.

Validation:

- `node tools/check-browser-dist-layout.mjs --root <repo>`
- `node tools/check-browser-build-scripts.mjs --root <repo>`
- `node tools/check-pnpm-script-standard.mjs --root <repo>`

### 4.3 Container Module Browser Build Family

Standalone gateway containers mount one shared `sdkwork-space` checkout and
build sibling module browser clients without rebuilding the whole workspace.
Host-side module repositories use the same canonical runner as section 4.2.

Grammar:

```text
build:container:module:browser
build:container:standalone
```

Repository root examples (`sdkwork-webserver` operator surface):

```text
pnpm build:container:module -- --module sdkwork-im --architecture all --environment dev --reload
pnpm build:container:module -- --module sdkwork-im --architecture pc --environment prod --deployment-environment production --in-container
pnpm build:container:module:browser -- --module sdkwork-im --architecture pc --environment dev
pnpm build:container:standalone
```

`build:container:module` is the preferred operator entrypoint. It rebuilds every
owned PC/H5 surface by default (`--architecture all`), selects the lifecycle
mode through `--environment` / `--deployment-environment`, supports host or
in-container toolchains, and may `--reload` the matching webserver service after
the dist output is written.

Container entrypoint examples (same runner, resolved under
`$SDKWORK_SPACE_ROOT/sdkwork-space/<module>`):

```text
build-browser --module sdkwork-im --architecture all --environment dev --reload-static
docker compose run --rm webserver build-browser --module sdkwork-im --architecture pc --environment dev
```

Rules:

- Host module builds `MUST` use `pnpm build:pc:<env>` / `pnpm build:h5:<env>`
  at the module repository root, or delegate to
  `node <sdkwork-specs>/tools/build-browser-client.mjs` with equivalent
  flags. They `MUST NOT` invent local Vite modes or bare `dist/` outputs.
- Container module builds `MUST` delegate to
  `scripts/docker/build-module-browser.mjs`, which forwards to
  `build-browser-client.mjs` against the mounted checkout.
- `<module>` `MUST` be a sibling repository directory name such as
  `sdkwork-im`, not an application-code alias.
- `<environment>` accepts lifecycle aliases (`dev`, `test`, `staging`, `prod`)
  and normalizes to runtime config before Vite mode selection.
- Built artifacts `MUST` land in
  `apps/sdkwork-<code>-{pc,h5}/dist/<envAlias>/` so Docker entrypoints and
  Adaptive Web static delivery can resolve `dist/dev`, `dist/prod`, and the
  other lifecycle aliases without profile-specific path forks.
- Legacy `docker:build:*` / `docker:up:*` script names remain migration
  aliases in operator repositories only. New automation `MUST` use
  `build:container:*`, `up:container:*`, and `down:container:*`.

Workspace verification:

- `node tools/sweep-browser-build-workspace.mjs --workspace <sdkwork-space-root>`
- `node tools/align-browser-build-scripts.mjs --workspace <sdkwork-space-root>`

## 5. Axis Values

Script suffixes use canonical values from `APP_RUNTIME_TOPOLOGY_NAMING.md`, `CONFIG_SPEC.md`, and `ENVIRONMENT_SPEC.md`.

Runtime targets:

```text
browser
desktop
server
container
tablet-ipados
tablet-android
capacitor-ios
capacitor-android
flutter-ios
flutter-android
android-native
ios-native
harmony-native
mini-program
test-runner
```

Database aliases:

```text
postgres
sqlite
```

`postgres` is the command alias for the PostgreSQL runtime engine. Runtime config may normalize it to `postgresql`.
`sqlite` is allowed only as an explicit client-local native/desktop database alias. It `MUST NOT` be accepted for `server`, `container`, gateway, worker, server CLI, or authoritative database commands.

Deployment profiles:

```text
standalone
cloud
```

Quality or execution tiers:

```text
fast
precommit
full
parallel
smoke
debug
local
check
required
docker
```

Browser client architecture axes (build family only; section 4.2):

```text
pc
h5
```

Environment profile aliases accepted on browser build commands (section 4.2):

```text
dev
test
staging
prod
```

Rules:

- `self-hosted`, `cloud-hosted`, `hosting`, and `deploymentMode` `MUST NOT` appear in new public script names or standard command examples.
- Root default dev scripts `dev:browser` and `dev:desktop` `MUST NOT` pass
  retired topology flags such as `--hosting self-hosted` or
  `--hosting cloud-hosted`; use `--deployment-profile standalone|cloud` plus
  `--environment <tier>`.
- Public script names and command values `MUST NOT` include internal process
  layout values. Process decomposition is selected by the active topology
  profile and deployment manifests behind `standalone` or `cloud`.
- `web`, `mobile`, `native`, and `docker` `MUST NOT` be used as deployment profile or runtime-target aliases.
- `dev`, `test`, `staging`, and `prod` may appear only as script/file profile aliases. Runtime config must normalize them to `development`, `test`, `staging`, and `production`.

## 6. Forbidden Application-Code Prefixes

Repository root public scripts `MUST NOT` start with a product or repository-specific token.

Forbidden examples:

```text
drive:dev
drive:build
im:dev
im:dev:desktop
cloudrouter:dev
cloudrouter:plan
<application-code>:dev
<application-code>:build
<application-code>:release
```

Migration examples:

| Legacy command | Standard command |
| --- | --- |
| `drive:dev` | `dev` |
| `drive:dev:desktop` | `dev:desktop` |
| `drive:build` | `build` |
| `drive:build:self-hosted` | `build:standalone` |
| `cloudrouter:dev` | `dev` |
| `cloudrouter:dev:postgres` | `dev:server:postgres` or `dev:browser:postgres` based on the orchestrated target |
| `cloudrouter:dev:cloud:split` | `dev:browser:cloud` |
| `browser:dev` | `dev:browser` |
| `tauri:dev` | `dev:desktop` |
| `dev:tauri` | `dev:desktop` |
| `electron:dev` | `dev:desktop:electron` |
| `dev:electron` | `dev:desktop:electron` |
| `docker:build` | `build:container` |
| `android:build` | `build:android-native` |
| `ios:build` | `build:ios-native` |
| `harmony:dev` | `dev:harmony-native` |
| `flutter:dev` | `dev:flutter-android` or `dev:flutter-ios` based on the selected target |
| `mini-program:build` | `build:mini-program` |
| `im:dev` | `dev` |
| `im:dev:desktop` | `dev:desktop` |

Unreleased applications `MUST` delete legacy application-code-prefixed scripts rather than preserve compatibility aliases. A temporary migration branch may use `legacy:<application-code>:<command>` only when a migration plan names the removal date and validation emits a warning.

## 7. API Assembly And Gateway Commands

Application API composition uses:

```text
api:assembly:materialize
api:assembly:validate
```

These commands target `sdkwork-api-<application-code>-assembly` and follow
`API_ASSEMBLY_SPEC.md`. Retired `gateway:assembly:*` commands are migration
input only and are not release evidence.

Gateway root scripts `MUST` use action before deployment profile:

```text
gateway:<action>[:deploymentProfile]
```

Examples:

```text
gateway:run:standalone
gateway:plan:standalone
gateway:build:standalone
gateway:package:standalone
gateway:validate:standalone
gateway:matrix
gateway:matrix:standalone
gateway:route-composition:audit
```

Rules:

- Use `gateway:package:cloud`, not `gateway:cloud:bundle`.
- Use `gateway:package:standalone`, not `gateway:standalone:pack`.
- Use `gateway:validate:<deploymentProfile>` for package/bundle validation.
- Application `gateway:*:standalone` commands `MUST` target
  `sdkwork-api-<application-code>-standalone-gateway` when the repository owns an application
  standalone gateway crate.
- `gateway:*` and `_sdkwork:gateway:*` commands `MUST NOT` build, run, validate,
  or package `*-edge-runtime` processes. Edge runtimes participate through
  `_sdkwork:runtime:*` topology hooks and application-level build/release
  composition.
- Application roots `MUST NOT` expose `gateway:*:cloud`; those commands are
  owned only by the `sdkwork-api-cloud-gateway` repository.
- Platform `gateway:*:cloud` commands `MUST` target `sdkwork-api-cloud-gateway`.
- Retired gateway script names `gateway:bundle:*` and `gateway:bundle:validate:*` `MUST` be
  renamed to `gateway:package:*` and `gateway:validate:*`.
- `api:assembly:materialize` and `api:assembly:validate` `MUST` delegate to
  the canonical tools from `API_ASSEMBLY_SPEC.md` and target
  `crates/sdkwork-api-<application-code>-assembly/`. These two commands are an
  explicit exception to the general thin-wrapper allowance: each command
  `MUST` directly invoke its matching `sdkwork-specs/tools/materialize-api-assembly.mjs`
  or `sdkwork-specs/tools/validate-api-assembly.mjs` tool with `--root .`.
  It `MUST NOT` delegate through an application-owned script, dispatcher, shell
  wrapper, or a different canonical tool. The bootstrap command computes the
  correct workspace-relative path; consumers do not hand-author it.
- Workspace roots `SHOULD` expose `gateway:route-composition:audit` through a thin wrapper around
  `sdkwork-specs/tools/audit-gateway-route-composition-workspace.mjs` to detect infrastructure probe
  duplication, empty assemblies, and platform cloud-host composition violations
  across repositories.
- Every pnpm-based application root exposes both `api:assembly:*` commands.
  Applications without HTTP routes materialize and validate `apiMode: none`;
  they do not omit the assembly contract.

## 8. Release And Deployment Commands

Release scripts `MUST` use lifecycle phases:

```text
release:plan
release:build
release:stage
release:package
release:package:check
release:validate
release:publish
release:preflight
```

Profile-aware release scripts use:

```text
release:<phase>[:runtimeTarget]:<deploymentProfile>
```

Runtime-configurable client artifacts use the explicit artifact-binding token:

```text
release:<phase>:<runtimeTarget>:runtime-configurable
```

`runtime-configurable` is valid only as a release artifact-binding token and `MUST NOT` be
accepted as a deploymentProfile by runtime, topology, config, or deploy tools.

Examples:

```text
release:plan:standalone
release:package:standalone
release:validate:standalone
release:publish:standalone
release:plan:cloud
release:package:container:cloud
release:validate:cloud
release:publish:cloud
```

Rules:

- Bare `release` is not a canonical required command. Repositories may keep it only as a documented aggregate that calls canonical `release:*` phases.
- Use `release:build:desktop` or `release:package:desktop`, not `release:desktop`.
- Environment selection belongs in config/profile flags or runtime config, not in application-specific release command names.
- Every exposed profile-sensitive release phase `MUST` provide both its
  `:standalone` and `:cloud` variants when the application release authority
  supports both profiles. Individual runtime targets remain constrained by
  `APP_MANIFEST_SPEC.md` rather than being duplicated into invalid artifacts.
- A single runtime-configurable client release lane may satisfy both profile
  capabilities when its manifest and workflow target declare
  `profileBinding = runtime-configurable`. It must not be cloned into two
  byte-identical signed artifacts solely to vary API endpoints.
- `release:package:*` produces immutable candidate artifacts;
  `release:publish:*` registers or uploads validated artifacts. Neither phase
  applies an artifact to a deployment environment.
- A side-effecting `release:publish` aggregate `MUST` require an explicit
  deployment profile or an explicitly approved all-profile release plan. It
  must not infer a target from `runtime.defaultDeploymentProfile`.
- `release:<deploymentProfile>:<phase>` is forbidden. Lifecycle phase always
  precedes runtime target and deployment profile.

Deploy scripts `MUST` use:

```text
deploy:plan
deploy:apply
deploy:rollback
deploy:validate
```

Profile-aware deploy scripts use:

```text
deploy:<phase>:<deploymentProfile>[:provider]
```

Examples:

```text
deploy:plan:standalone
deploy:apply:standalone
deploy:rollback:standalone
deploy:plan:cloud:kubernetes
deploy:apply:cloud:kubernetes
deploy:rollback:cloud:kubernetes
```

Provider-specific wrappers may add a provider suffix only after the phase, such as `deploy:plan:kubernetes`, when a deployment standard or runbook owns that provider.

Deployment rules:

- Every exposed deploy phase `MUST` provide both `:standalone` and `:cloud`
  variants when the application owns both deployment architectures.
- `deploy:apply:*` and `deploy:rollback:*` `MUST` require an explicit lifecycle
  environment in runtime config or CLI input and fail before side effects when
  it is absent or ambiguous.
- `deploy:apply:*` consumes an already validated immutable artifact identity;
  it must not rebuild a different artifact during deployment.
- Provider suffixes follow the deployment profile. Profile-first forms such as
  `deploy:cloud:apply` and phase/provider/profile ambiguity are forbidden.

## 9. Dispatcher Standard

Application repositories `SHOULD` provide:

```text
scripts/sdkwork-command.mjs
```

Rules:

- The dispatcher `MUST` parse standard command names or explicit flags and map them to product implementation scripts.
- The dispatcher `MUST` print or pass normalized `deploymentProfile`, `runtimeTarget`, database profile, and lifecycle environment when they affect runtime behavior.
- The dispatcher `MUST` fail fast on unknown standard commands.
- The dispatcher `MUST NOT` accept retired public axis values such as `self-hosted` or `cloud-hosted`.
- Existing product runners such as `scripts/<application-code>-dev.mjs` may remain as internal implementation details.

## 10. Validation

pnpm script validation `MUST` check:

- Required repository root commands, including `dev:standalone` and
  `dev:cloud`, exist.
- Bare `dev` directly delegates to `dev:standalone`; standalone and cloud
  entrypoints resolve to their matching `development` profiles.
- `dev:cloud` does not select a local database or retired/local API bootstrap
  axis.
- Product-prefixed public root scripts are absent.
- Retired deployment words and flags are absent from new script names, script
  command values, standard command examples, and command-bearing manifests.
- New root scripts use allowed first segments.
- `api:*` is preferred over new `apis:*` root scripts.
- Application `api:assembly:materialize` and `api:assembly:validate` command
  values exactly match the direct canonical delegation generated for that
  application root; wrapper delegation and swapped or substitute tools fail.
- `gateway:*` commands use action before deployment profile.
- Release and deploy commands use phase before deployment profile, expose
  profile-paired variants for supported phases, and keep provider suffixes
  after the deploy profile.
- Runtime target command aliases use action-first names or the `desktop:*`
  host family (section 4.1); `browser:*`, `tauri:*`, `electron:*`, `docker:*`,
  `android:*`, `ios:*`, `harmony:*`, `flutter:*`, `mini-program:*`, and `*:tauri`
  are absent from root, app surface, and package-local scripts.
- App surface and package scripts use standard local names where applicable, and do not keep
  retired public namespaces such as `server:*`, `service:*`, `portal:*`, `product:*`,
  `alignment:*`, `apis:*`, `file-sdk:*`, or `prepare:*`.
- Standards, `README.md`, `AGENTS.md`, active runbook examples, `sdkwork.app.config.json`,
  `sdkwork.workflow.json`, active `specs/*.json`, and Tauri config command hooks do not
  introduce application-code-prefixed public root commands, platform/tool-first runtime aliases,
  retired deployment flags such as `--hosting self-hosted`, or retired command
  order such as `gateway:cloud:bundle`.
- Active runner scripts under `scripts/` and `tools/` do not invoke or
  document retired public `pnpm` commands such as `browser:dev`,
  `server:dev`, `tauri:dev`, `dev:tauri`,
  `dev:portal`, or `dev:service`; internal implementation may still call
  native tools such as Vite, Tauri, Cargo, Docker, Flutter, Gradle, Xcode, or
  hvigor behind the standard action-first `pnpm` surface.
- Root `dev:browser` and `dev:desktop` resolve through their direct command
  value or root-script delegation chain to PostgreSQL, standalone, and
  `development` defaults, and fail when they resolve to SQLite, cloud, retired
  process-layout flags, or retired `--hosting` flags.

Validation SHOULD provide a migration suggestion for every rejected script name.

## 11. Clean Command Boundary

The `pnpm clean` command removes reproducible local artifacts. It `MUST NOT` delete:

- Git-tracked source files of any kind.
- Build-critical source files as defined in `CODE_STYLE_SPEC.md` §7.1 (e.g., `build/package-contract.ts`, config helper modules imported by `vite.config.ts` or `tsconfig.json`).
- Checked-in config, manifests, specs, or documentation.
- Secrets, databases, or user-private runtime files governed by `RUNTIME_DIRECTORY_SPEC.md`.

Allowed deletion targets:

- `dist/` directories (build output).
- `node_modules/.cache/`, `node_modules/.vite/`, and similar tool caches.
- Cargo `target/` or an explicitly isolated `target/sdkwork/<purpose>/` build directory.
- Framework-owned OS/CI temporary state resolved through the shared runtime-state helper.

Rules:

- `clean` scripts `MUST` enumerate the exact paths they delete. Glob-based deletion `MUST NOT` match git-tracked paths.
- `clean` scripts `MUST NOT` create or depend on repository/application `.runtime/` directories.
- When `clean` deletes a directory, it `MUST NOT` use patterns that could match a `build/` directory containing git-tracked source files.
- Build runners invoked after `clean` `MUST` be able to recover without manual intervention through the self-healing pattern in `CODE_STYLE_SPEC.md` §7.3.

## 12. Acceptance Checklist

- [ ] Repository root exposes `dev`, `dev:standalone`, `dev:cloud`, `build`, `test`, `check`, `verify`, and `clean`.
- [ ] `dev` directly delegates to `dev:standalone`; both profile entrypoints resolve to the matching `development` profile.
- [ ] `dev:cloud` consumes explicit deployed cloud API surfaces without starting a local API, gateway, or database.
- [ ] Capability-specific root commands exist for release, deploy, API, SDK, database, gateway, topology, and supply-chain workflows when those capabilities exist.
- [ ] No repository root public script starts with a application-code prefix such as `drive`, `im`, or `cloudrouter`.
- [ ] Runtime-target commands are action-first, for example `dev:browser`, `dev:desktop`, `build:desktop`, `build:container`, `build:android-native`, `build:ios-native`, and `build:mini-program`; the `desktop:*` host family uses only section 4.1 actions/axes; no public script uses platform/tool-first aliases such as `browser:*`, `tauri:*`, `electron:*`, `docker:*`, `android:*`, `ios:*`, `harmony:*`, `flutter:*`, `mini-program:*`, or `*:tauri`.
- [ ] Browser Adaptive Web repositories expose `build:pc:*` and/or `build:h5:*` for owned surfaces; app surfaces expose `build:dev|test|staging|prod`; outputs land in `dist/{dev,test,staging,prod}` via `build-browser-client.mjs`.
- [ ] Root `dev:browser` and `dev:desktop` default to
      `postgres:standalone` with `environment = development`; cloud variants
      are explicit suffixed commands, and `dev:desktop:sqlite` is client-local
      only when such a module exists.
- [ ] Script suffixes use canonical runtime target, database, deployment profile, and tier values.
- [ ] API assembly commands use `api:assembly:materialize|validate` and directly
      invoke their matching canonical `sdkwork-specs` tool with `--root .`.
- [ ] Application gateway commands use `gateway:<action>:standalone`; only the
      platform gateway repository exposes `gateway:<action>:cloud`.
- [ ] Release commands use `release:<phase>[:runtimeTarget]:<deploymentProfile>` and deployment commands use `deploy:<phase>:<deploymentProfile>[:provider]`.
- [ ] Publish, apply, and rollback do not infer an ambiguous deployment profile or lifecycle environment.
- [ ] Root public scripts call a standard dispatcher or thin wrapper, except
      commands whose task-specific standard requires direct canonical-tool
      delegation, including `api:assembly:*`.
- [ ] App surface/package scripts remain package-local and do not become a second root automation standard.
- [ ] `pnpm clean` does not delete git-tracked build-critical source files (see `CODE_STYLE_SPEC.md` §7).
- [ ] `README.md`, related architecture specs, and `TEST_SPEC.md` reference this standard.
