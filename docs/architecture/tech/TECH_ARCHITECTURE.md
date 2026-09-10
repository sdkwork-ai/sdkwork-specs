# SDKWork Standards Technical Architecture

Status: active
Owner: SDKWork standards maintainers
Updated: 2026-07-30
Specs: ARCHITECTURE_DECISION_SPEC.md, DOCUMENTATION_SPEC.md, SDKWORK_WORKSPACE_SPEC.md, GOVERNANCE_SPEC.md

## 1. Architecture Overview

`sdkwork-specs` is a standards repository, not a deployable application. Its architecture is a layered standards dictionary plus executable validators that keep consumer repositories aligned with the same rules.

```text
sdkwork-specs/
  *_SPEC.md              # normative standards
  README.md              # task matrix and standards index
  tools/                 # executable validators
  templates/             # scaffolding for consumer repositories
  docs/                  # human Canon and working documentation
```

## 2. Technology Choices

| Area | Choice | Reason | Governing spec |
| --- | --- | --- | --- |
| Standards format | Markdown with RFC-style MUST/SHOULD/MAY | Reviewable in git, agent-friendly | `DOCUMENTATION_SPEC.md` |
| Validation | Node `.mjs` tools under `tools/` | Cross-platform, no app runtime dependency | `TEST_SPEC.md` |
| Repository layout authority | `SDKWORK_WORKSPACE_SPEC.md` | One project-root dictionary | `SDKWORK_WORKSPACE_SPEC.md` |
| Generated-state boundary | Native tool directories plus private OS/CI runtime paths | Keeps source trees minimal and separates build, process, test, and secret lifecycles | `RUNTIME_DIRECTORY_SPEC.md` |
| Documentation layout authority | `DOCUMENTATION_SPEC.md` section 2 | Canon PRD and technical architecture | `DOCUMENTATION_SPEC.md` |
| Governance | `GOVERNANCE_SPEC.md` | Controlled standards evolution | `GOVERNANCE_SPEC.md` |

## 3. System Boundaries And Modules

- Root `*_SPEC.md` files own normative platform rules.
- `tools/` owns executable checks; it must remain application-neutral.
- `docs/` owns human narrative, Canon entrypoints, ADRs, and contributor guides.
- Consumer repositories link back to `sdkwork-specs` by relative path; they must not fork standard bodies locally.

## 4. Directory And Package Layout

This repository follows `SDKWORK_WORKSPACE_SPEC.md` for active capabilities:

- `tools/`: validators and scaffolds
- `templates/`: database and documentation scaffolds
- `docs/`: Canon and working documentation
- `.sdkwork/`: repository-local skills and plugins

Inactive reserved directories may remain absent because this repository is a narrow standards root.

## 5. API, SDK, And Data Ownership

- No application HTTP API or SDK families are owned by this repository.
- Contract standards for APIs, SDKs, databases, and runtime behavior are defined in the corresponding `*_SPEC.md` files.

## 6. Security, Privacy, And Observability

- No production tenant or end-user data is processed by this repository.
- Standards docs and validators must not embed secrets, live tokens, or private environment endpoints.
- Security rules for consumer repositories remain in `SECURITY_SPEC.md` and `PRIVACY_SPEC.md`.

## 7. Deployment And Runtime Topology

- Distribution happens through git checkout in the parent SDKWork workspace.
- Validators run locally or in CI from consumer repositories via `node ../sdkwork-specs/tools/<checker>.mjs`.
- Repository/application `.runtime/` is forbidden. Lifecycle state is resolved outside source by
  canonical repository identity; native build caches remain with their owning tools.

## 8. Architecture Decision Index

- [ADR-20260719 Process-Shared Database Pool](../decisions/ADR-20260719-process-shared-database-pool.md)
- [ADR-20260719 Unified Development, Release, And Deployment Profiles](../decisions/ADR-20260719-unified-development-release-profiles.md)
- [ADR-20260720 API Assembly And Gateway Hosting](../decisions/ADR-20260720-api-assembly-gateway-hosting.md)
- [ADR-20260724 PostgreSQL Authority And SQLite Client-Local Storage](../decisions/ADR-20260724-postgresql-authority-sqlite-client-local.md)
- [ADR-20260730 Repository Generated-State Boundary](../decisions/ADR-20260730-repository-generated-state-boundary.md)
- Record future standards architecture changes under [../decisions/](../decisions/) as `ADR-*` documents.
- Design shard: [TECH-desktop-dual-host-design.md](TECH-desktop-dual-host-design.md) — desktop dual-host (Tauri/Electron) design detail supporting `DESKTOP_APP_ARCHITECTURE_SPEC.md`.

## 9. Verification

```bash
node tools/check-repository-docs-standard.mjs --root .
node --test tools/check-repository-docs-standard.test.mjs
```
