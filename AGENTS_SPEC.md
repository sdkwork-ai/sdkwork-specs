# AGENTS.md Standard

- Version: 1.1
- Scope: repository, application, and component-level `AGENTS.md` files used by SDKWork agents and AI-assisted development tools, plus tool compatibility shims such as `CLAUDE.md`, `GEMINI.md`, and `CODEX.md`
- Related: `SOUL.md`, `SDKWORK_WORKSPACE_SPEC.md`, `APP_MANIFEST_SPEC.md`, `COMPONENT_SPEC.md`, `DOCUMENTATION_SPEC.md`, `GOVERNANCE_SPEC.md`, `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, `TEST_SPEC.md`

This standard defines `AGENTS.md` as the execution entrypoint for SDKWork repositories and applications. `AGENTS.md` is the nearest human- and agent-readable index for the convention-based dictionary: local app identity, local specs, `.sdkwork/`, root `sdkwork-specs`, build commands, verification rules, and human review boundaries.

Tool-specific files such as `CLAUDE.md`, `GEMINI.md`, and `CODEX.md` exist only to route tools to `AGENTS.md`. They are compatibility shims, not independent standards.

## 1. File Naming And Placement

Rules:

- The authoritative file name is `AGENTS.md`.
- `agent.md`, `AGENT.md`, or `agents.md` may exist only as compatibility shims that point to `AGENTS.md`. They must not contain a second copy of the rules.
- `CLAUDE.md` `MUST` exist at SDKWork-managed repository and application roots when Claude Code compatibility is required.
- `GEMINI.md` `MUST` exist at SDKWork-managed repository and application roots when Gemini CLI compatibility is required.
- `CODEX.md` `MUST` exist at SDKWork-managed repository and application roots when Codex-specific compatibility is required.
- Tool compatibility shims `MUST` point to the nearest `AGENTS.md`, cite the relative `sdkwork-specs` path, and must not contain a divergent rule body.
- Every git repository root `MUST` have `AGENTS.md`.
- Every SDKWork application root `MUST` have `AGENTS.md`.
- Every independently built, distributed, generated, or long-lived component root `SHOULD` have `AGENTS.md` when its relative path to `sdkwork-specs` or local execution rules differ from the repository root.
- Generated SDK transport output must not own `AGENTS.md`; the SDK family root may own one when it has authored facade or generation rules.

## 2. Required Sections

Each authored `AGENTS.md` must include these sections, with local details filled in:

```md
# Repository Guidelines

## SDKWORK Soul
## SDKWORK Standards
## Application Identity
## Local Dictionary Structure
## Spec Resolution Order
## Required Specs By Task Type
## Code Style Rules
## Build, Test, and Verification
## Agent Execution Rules
## App SDK Consumer Imports
## HTTP API Response Envelope
## Human Review Rules
```

Sections may be brief, but they must be actionable and must use repository-relative paths.

`## HTTP API Response Envelope` is mandatory for every repository or application root that owns, serves, generates, or consumes SDKWork HTTP `app-api`, `backend-api`, or SDKWork-owned business `open-api` contracts. Omitted `x-sdkwork-wire-protocol` means SDKWork-owned custom API (`sdkwork-v3`); only operation-level `x-sdkwork-wire-protocol: external` plus `x-sdkwork-external-protocol-id` identifies a third-party compatibility `open-api` operation. The section must also reference the standard operation matrix for retrieve/list/search/create/update/delete/command/async/bulk patterns and the `check-api-operation-patterns.mjs` validator. Use `node ../sdkwork-specs/tools/align-agents-http-response-standard.mjs --workspace ..` to refresh the canonical section text from `API_SPEC.md` section 4.5 and sections 14-16. Do not paraphrase or weaken the input/output rules locally.

`## App SDK Consumer Imports` is mandatory for every repository or application root that owns or consumes generated HTTP SDK clients in `apps/`, `packages/`, bootstrap, services, UI, or integration contract tests. Copy the canonical section text from `APP_SDK_INTEGRATION_SPEC.md` section 9. Do not paraphrase or weaken the scoped `@sdkwork/*-app-sdk` / `@sdkwork/*-backend-sdk` rules locally. Verify with `node ../sdkwork-specs/tools/check-app-sdk-consumer-imports.mjs --workspace ..`.

## 3. Relative Path Rules

Rules:

- `AGENTS.md` must reference root standards by relative path.
- Do not copy root spec content into `AGENTS.md`.
- If `sdkwork-specs` moves or the relative path is broken, agents must stop and report the unresolved path.
- Top-level sibling repositories in the standard workspace use paths such as `../sdkwork-specs/README.md`.
- Nested components must use the accurate relative path from the component root, for example `../../../sdkwork-specs/README.md`.
- When a repository can be checked out alone, `AGENTS.md` should state the expected workspace layout and fallback instruction for locating `sdkwork-specs`.

Example:

```md
Canonical SDKWORK specs path from this repository:

- `../sdkwork-specs/README.md`
- `../sdkwork-specs/SOUL.md`
- `../sdkwork-specs/AGENTS_SPEC.md`
- `../sdkwork-specs/CODE_STYLE_SPEC.md`
- `../sdkwork-specs/NAMING_SPEC.md`
```

## 4. Spec Resolution Order

`AGENTS.md` must require agents to resolve standards in this order:

1. Current or nearest `AGENTS.md`.
2. `sdkwork.app.config.json` when present.
3. Nearest module `specs/README.md` and `specs/component.spec.json` when the task touches an authored module.
4. Repository/application root `specs/` when the task is repository-wide or application-wide.
5. Local `.sdkwork/README.md`, `.sdkwork/skills/`, and `.sdkwork/plugins/` when relevant.
6. Global `sdkwork-specs/README.md` through the declared relative path.
7. Task-specific global specs referenced by the task matrix, nearest `AGENTS.md`, or module `canonicalSpecs`.
8. Implementation files.

Local files may narrow the task, but global `sdkwork-specs` remain authoritative.

The three-layer spec system is defined in `SOUL.md` section 2:

- global standards in `sdkwork-specs/*_SPEC.md`
- repository/application contracts in `<repo-or-app-root>/specs/`
- module-local spec systems in `<module-root>/specs/` per `COMPONENT_SPEC.md`

Rules:

- Loading is dynamic and progressive. Agents `MUST` load the nearest
  `AGENTS.md` and dictionary entries first, then only the root specs required
  by the current task.
- Agents `MUST NOT` eagerly load all language, runtime, UI, deployment, or SDK
  specs for unrelated work.
- `sdkwork.app.config.json`, local `specs/`, and local `.sdkwork/` are loaded
  when the task touches the application identity, component contract, local
  skills/plugins, runtime, SDK wiring, release, or packaging behavior they
  govern. They are not a reason to scan the entire repository first.
- Durable local rules belong in module `specs/`, repository/application `specs/`, README/runbooks, manifests, or
  task-specific documentation. `AGENTS.md` `MUST NOT` keep an "Existing Local
  Guidance" block or preserved legacy command list that competes with global
  SDKWork standards.
- Every authored module `MUST` maintain its own `specs/` directory. Do not centralize module contracts in repository `AGENTS.md` or README prose when `COMPONENT_SPEC.md` applies.

### 4.1 Managed Sync Blocks

Some cross-repository disciplines are propagated into every repository `AGENTS.md` as managed sync blocks. A managed block:

- is wrapped in paired HTML-comment markers of the form `<!-- SDKWORK-<NAME>-STANDARD: vN -->` and `<!-- /SDKWORK-<NAME>-STANDARD: vN -->`,
- is written and refreshed only by its owning sync tool under `sdkwork-specs/tools/sync-agent-<name>-standard.mjs` with `--check` or `--apply`,
- is idempotent: re-running the sync tool replaces the previous copy instead of duplicating it,
- must not be hand-edited between markers; edit the owning sync tool (and its authority spec) and re-run the tool instead.

Existing managed blocks include `SDKWORK-NAMING-STANDARD` (Rust naming and dependency declaration) and `SDKWORK-SDK-GENERATION-STANDARD` (generated SDK output is generator-owned; never hand-edit `sdks/` generated output). Validators and agents may rely on these markers to detect stale or missing disciplines.

## 5. Required Specs By Task Type

`AGENTS.md` must map common task types to the minimum specs agents read before editing.

| Task | Required specs |
| --- | --- |
| Agent/workflow rules | `SOUL.md`, `AGENTS_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md` |
| Any code change | `CODE_STYLE_SPEC.md`, `NAMING_SPEC.md`, plus only the touched language/framework spec |
| Build scripts / dev runners / dependency preparation | `CODE_STYLE_SPEC.md` §7 (Build Source Integrity), `TYPESCRIPT_CODE_SPEC.md` §5 (Node Script Resilience), `PNPM_SCRIPT_SPEC.md` §11 (Clean Command Boundary) |
| Rust code | `RUST_CODE_SPEC.md`, plus `RUST_RPC_SPEC.md`, `RPC_FRAMEWORK_SPEC.md`, `DISCOVERY_SPEC.md`, and `RPC_RESILIENCE_SPEC.md` when RPC is touched |
| Java/Spring code | `JAVA_CODE_SPEC.md`, `WEB_BACKEND_SPEC.md` when HTTP backend code is touched, `RPC_FRAMEWORK_SPEC.md` when gRPC is touched |
| TypeScript/Node code | `TYPESCRIPT_CODE_SPEC.md` |
| Dart/Flutter code | `DART_CODE_SPEC.md`, plus `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md` and `APP_FLUTTER_UI_SPEC.md` when Flutter packages or app roots are touched |
| Frontend/UI code | `COMPOSABLE_ARCHITECTURE_SPEC.md` when reusable package boundaries or SDK composition are touched, `FRONTEND_CODE_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, and exactly one detailed UI architecture spec |
| API changes | `API_SPEC.md`, `PAGINATION_SPEC.md` when list/search pagination is touched, `WEB_FRAMEWORK_SPEC.md` when Rust HTTP runtime is touched, `WEB_BACKEND_SPEC.md`, `SDK_SPEC.md`, `TEST_SPEC.md` |
| Rust HTTP route crates / gateways / migration-only API servers | `COMPOSABLE_ARCHITECTURE_SPEC.md`, `API_SPEC.md`, `SUBJECT_ID_SPEC.md` when SQL subject scope is involved, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `RUST_CODE_SPEC.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md` |
| Database changes | `DATABASE_SPEC.md`, `SUBJECT_ID_SPEC.md` when tenant/user subject columns are involved, `PRIVACY_SPEC.md`, `TEST_SPEC.md` |
| SDK generation/consumption | `COMPOSABLE_ARCHITECTURE_SPEC.md` when dependency SDKs, runtime surfaces, or component ports are touched, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md` when RPC SDKs are touched, `API_SPEC.md`, `TEST_SPEC.md` |
| Read-only upstream source under `external/`, `third_party/`, or `vendor/` | `DEPENDENCY_MANAGEMENT_SPEC.md`, `INTEGRATION_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `TEST_SPEC.md`, plus only the touched language/framework spec |
| Composable module or dependency integration | `COMPOSABLE_ARCHITECTURE_SPEC.md`, `COMPONENT_SPEC.md`, `MODULE_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `APP_PERMISSION_COMPOSITION_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `TEST_SPEC.md`, plus the touched frontend/Rust/API specs |
| RPC contracts / gRPC services | `RPC_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, `RPC_FRAMEWORK_SPEC.md`, `DISCOVERY_SPEC.md`, `RPC_RESILIENCE_SPEC.md`, `SECURITY_SPEC.md`, `OBSERVABILITY_SPEC.md`, `TEST_SPEC.md` |
| Service discovery / dynamic RPC resolution | `DISCOVERY_SPEC.md`, `RPC_FRAMEWORK_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `ENVIRONMENT_SPEC.md`, `DEPLOYMENT_SPEC.md`, `TEST_SPEC.md` |
| App identity/release | `APP_MANIFEST_SPEC.md`, `CONFIG_SPEC.md`, `DEPLOYMENT_SPEC.md` |
| Source config, environment profiles, or deployable-root `etc/` | `SOURCE_CONFIG_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `DEPLOYMENT_SPEC.md`, `TEST_SPEC.md` |
| Security/auth | `IAM_SPEC.md`, `SUBJECT_ID_SPEC.md` when principal ids or SQL subject mapping is involved, `IAM_LOGIN_INTEGRATION_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md` |

Language specs are on-demand. Do not require agents to load Rust, Java, TypeScript, and frontend specs for unrelated tasks.

## 6. Local Dictionary Structure

`AGENTS.md` must identify the local convention dictionary:

- `AGENTS.md`: agent execution rules and relative spec entrypoint.
- `sdkwork.app.config.json`: application identity, app metadata, release surfaces, and owned capabilities.
- `etc/`: safe source-controlled deployment/runtime configuration for independently deployable roots; load it for environment, Base URL, bind, topology, or packaging-input work.
- `.sdkwork/`: local skills, plugins, manifests, and repository/application AI workspace metadata.
- `specs/`: module-local spec systems (`README.md`, `component.spec.json`, optional narrowing extensions) for authored apps, packages, crates, services, and SDK families; repository/application root `specs/` for cross-module machine contracts such as topology manifests.
- `docs/`: repository/application documentation layout; Canon entrypoints are `docs/product/prd/PRD.md` and `docs/architecture/tech/TECH_ARCHITECTURE.md`.
- `sdks/`: SDK families, family manifests, OpenAPI authorities, derived generator inputs, route manifests, and generated outputs. Generated SDK output is produced by `../sdkwork-sdk-generator/bin/sdkgen.js` (`@sdkwork/sdk-generator`) and `MUST NOT` be hand-edited; fix the generation chain and regenerate instead.
- `external/`, `third_party/`, `vendor/`: optional read-only upstream source dependencies; native build tools may consume them, but agents and SDKWork tooling must never modify them.
- language manifests such as `package.json`, `Cargo.toml`, `pom.xml`, `pyproject.toml`, or `pubspec.yaml`.

## 7. Template

Minimal repository template:

```md
# Repository Guidelines

## SDKWORK Soul

Read `../sdkwork-specs/SOUL.md` before executing repository tasks.

## SDKWORK Standards

This repository follows `../sdkwork-specs/README.md`. Do not copy root standards locally.

## Application Identity

Read `sdkwork.app.config.json` for application identity, registration, SDK/API inventory, release metadata, or app-owned capabilities. Read `etc/` for concrete environment, runtime, Base URL, bind, topology, and deployment values. Do not treat the app manifest as runtime configuration authority.

## Local Dictionary Structure

- `AGENTS.md`: agent execution rules.
- `.sdkwork/`: local skills, plugins, and manifests.
- `specs/`: module-local spec systems for authored packages, crates, services, and SDK families; repository/application root `specs/` for cross-module machine contracts.
- `docs/`: Canon documentation at `docs/product/prd/PRD.md` and `docs/architecture/tech/TECH_ARCHITECTURE.md`.
- `sdks/`: OpenAPI authorities and SDK generation artifacts. Generated output is generator-owned (`../sdkwork-sdk-generator`); never hand-edit it.
- `external/`, `third_party/`, `vendor/`: optional read-only upstream source dependencies; consume through native build tools and never modify their contents.
- `etc/`: deployable-root source configuration; required only for independently deployable applications and process hosts.

## Spec Resolution Order

Read local identity and specs first, then task-specific files from `../sdkwork-specs/`, then implementation files.

## Required Specs By Task Type

Code changes require `../sdkwork-specs/CODE_STYLE_SPEC.md`, `../sdkwork-specs/NAMING_SPEC.md`, and only the language/framework spec for the touched files.

## Build, Test, and Verification

Use this repository's package manifest scripts. Record commands and outputs.

## Task-Specific Standards

Keep task triggers concise. API work loads `API_SPEC.md`; list/search work loads `PAGINATION_SPEC.md`; source config work loads `SOURCE_CONFIG_SPEC.md`. Link the authority and validator instead of copying its normative body into `AGENTS.md`.
```

## 8. Compatibility Shim Templates

Recommended `CLAUDE.md` shape:

```md
# Claude Code Entry

This file is a compatibility shim for Claude Code. The authoritative SDKWork agent entrypoint is `AGENTS.md`.

Read in this order:

1. `AGENTS.md`
2. `../sdkwork-specs/SOUL.md`
3. `../sdkwork-specs/AGENTS_SPEC.md`
4. Task-specific files from `../sdkwork-specs/README.md`

Do not duplicate or override SDKWork rules here.
```

Recommended `GEMINI.md` and `CODEX.md` shape follows the same rule: change only the title and tool name, keep `AGENTS.md` as the authority, and keep relative `sdkwork-specs` references accurate from the shim location.

## 9. Verification

Validation should check:

- `AGENTS.md` exists at each repository root and application root.
- Compatibility shim files, including `CLAUDE.md`, `GEMINI.md`, and `CODEX.md`, point to `AGENTS.md` when present.
- Relative `sdkwork-specs` paths resolve.
- Required sections are present.
- Required task-to-spec mappings include language-on-demand behavior.
- `AGENTS.md` states dynamic progressive loading and does not require loading
  every language/framework spec for unrelated tasks.
- `AGENTS.md` references `PNPM_SCRIPT_SPEC.md` and `GITHUB_WORKFLOW_SPEC.md`
  when command or GitHub packaging workflows exist in the repository.
- `AGENTS.md` does not retain "Existing Local Guidance" or legacy preserved
  rule blocks; durable local rules are moved to local specs or linked docs.
- `AGENTS.md` does not duplicate root spec bodies or embed secrets.
- `AGENTS.md` references `CODE_STYLE_SPEC.md` §7 build source integrity rules
  when the repository owns build scripts, dev runners, or cross-repository
  dependency preparation tooling.
- `AGENTS.md` uses a concise task-specific routing section and does not copy API,
  pagination, SDK integration, source config, or other global normative bodies.
- Deployable roots reference `SOURCE_CONFIG_SPEC.md` and identify `etc/` as the
  concrete environment/runtime configuration authority.
- When `docs/` is active, `AGENTS.md` and root `README.md` link to `docs/README.md`, `docs/product/prd/PRD.md`, and `docs/architecture/tech/TECH_ARCHITECTURE.md`.

Application repositories may call the canonical validators with:

```text
node ../sdkwork-specs/tools/check-agent-workflow-standard.mjs --root .
node ../sdkwork-specs/tools/check-repository-docs-standard.mjs --root .
```
