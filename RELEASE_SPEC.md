# Release Standard

- Version: 1.0
- Scope: release trains, versioning, release candidates, artifacts, signing, SBOM, provenance, changelog, staged rollout, rollback, release evidence
- Related: `APP_MANIFEST_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `DEPLOYMENT_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `QUALITY_GATE_SPEC.md`, `COMPOSABLE_ARCHITECTURE_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_PERMISSION_COMPOSITION_SPEC.md`, `MIGRATION_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `DOCUMENTATION_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `OBSERVABILITY_SPEC.md`, `TEST_SPEC.md`, `GOVERNANCE_SPEC.md`

This standard defines how SDKWork applications, services, SDKs, and reusable packages become releasable artifacts.

## 1. Release Authority

Rules:

- Application identity, package targets, media, install metadata, and release notes are governed by `APP_MANIFEST_SPEC.md`.
- GitHub packaging and deployment automation follows `GITHUB_WORKFLOW_SPEC.md`.
- Runtime and deployment behavior follows `DEPLOYMENT_SPEC.md`, `CONFIG_SPEC.md`, and `ENVIRONMENT_SPEC.md`.
- Supply-chain evidence follows `SUPPLY_CHAIN_SECURITY_SPEC.md`.
- A release is not valid without release gate evidence from `QUALITY_GATE_SPEC.md`.

## 2. Release Types

| Type | Use |
| --- | --- |
| Development build | internal validation, no production claims |
| Release candidate | complete candidate awaiting final validation |
| Production release | customer/operator-facing artifact or deployment |
| Hotfix | urgent correction with narrowed scope and explicit rollback |
| SDK release | generated or composed SDK package release |
| Standard release | root standard version/change publication |

Rules:

- Production releases must be reproducible enough to trace source, config, dependency refs, build workflow, and artifact evidence.
- Production releases must record whether each artifact is fixed to
  `standalone`/`cloud` or is a runtime-configurable client supporting both, and
  the `runtimeTarget` it serves. Every rollout still selects one active
  deployment profile.
- Hotfixes must still satisfy security, generated SDK, migration, and rollback rules for touched surfaces.
- SDK releases must trace to OpenAPI/proto/generator inputs and generated output boundaries.

### 2.1 Deployment-Profile Release Lanes

An application may produce standalone and cloud artifacts from one source
version, but each profile is an independently verifiable release lane.

| Lane | Typical artifacts | Publication boundary |
| --- | --- | --- |
| `standalone` | Standalone gateways, server archives, single-unit containers, fixed private/offline clients | Artifact registry, GitHub Release, private distribution, or download catalog |
| `cloud` | Cloud services, containers, charts/manifests, gateway config bundles, fixed cloud Web/platform packages | Artifact/container registry, CDN/edge, GitHub Release, platform upload, or deployment catalog |
| `runtime-configurable` artifact binding | Browser, desktop, tablet, Capacitor, Flutter, native mobile, or approved platform clients supporting both profiles | Signed installer/store/Web artifact with a declared supported-profile set; not a third deployment profile |

Rules:

- The canonical command order is
  `release:<phase>[:runtimeTarget]:<deploymentProfile>`.
- Runtime-configurable clients use
  `release:<phase>:<runtimeTarget>:runtime-configurable`; this release token never
  authorizes a deploy operation, which must select standalone or cloud.
- `release:package:*` creates immutable candidate artifacts and
  `release:publish:*` publishes already validated artifact identities. Neither
  phase deploys those artifacts to staging or production.
- A side-effecting publish operation `MUST` select `standalone` or `cloud`
  explicitly, or reference an approved all-profile release plan that lists
  every artifact. It must not infer a profile from a default download target.
- One logical SemVer release `MAY` contain both lanes. Evidence, compatibility,
  signing, SBOM, provenance, rollout, and rollback remain attributable to each
  package id and runtime target.
- Releasing both profiles at one version does not require an invalid duplicate
  of every runtime target or byte-identical signed client. Target validity and
  profile binding follow `APP_MANIFEST_SPEC.md`.

## 3. Versioning

Rules:

- Released artifacts must have a stable version before packaging.
- Version resolution must be consistent across manifest, workflow matrix, lifecycle env, changelog, package names, and published artifacts.
- Public API, SDK, database, manifest, and package breaking changes must include migration or explicit no-compatibility approval.
- Version tags should be immutable after publication. If a tag must be replaced, governance approval and release notes must explain the correction.

## 4. Release Evidence

Production release evidence should include:

- requirement ids or release scope.
- release version, tag, commit, workflow run, deployment profile, runtime
  target, and package targets.
- manifest validation.
- build and test output.
- artifact names, checksums, and storage locations.
- canonical artifact evidence document binding artifact id, digest, version,
  source commit, package id, profile support, SBOM, provenance, and signature.
- signing evidence where required.
- SBOM and provenance where required.
- migration plan and status when relevant.
- composable architecture closure evidence when the release contains module, dependency SDK, route, permission, frontend package, Rust backend, or resolved composition changes.
- rollout and rollback plan for each deployment profile and runtime target.
- release notes and user/operator impact.
- post-release smoke checks and monitoring signals.

Rules:

- Release notes must not be stale or copied from a mismatched version.
- Releases for composable applications `MUST` include the applicable `COMPOSABLE_ARCHITECTURE_SPEC.md` closure-matrix evidence required by `QUALITY_GATE_SPEC.md`; skipped rows must be named as not applicable with reason.
- Required composition evidence includes the applicable outputs from `check-component-port-bindings.mjs`, `check-frontend-composition.mjs`, `check-rust-backend-composition.mjs`, `check-permission-composition.mjs`, `check-route-path-collisions.mjs`, `resolve-composition.mjs --write`, `check-composition-resolver.mjs`, and `verify-repo.mjs`.
- Release artifacts must not contain secrets, private keys, local env overrides, or user-private runtime state.
- Release artifacts must not contain `cloud.development` endpoints, developer
  origins, local tunnel config, or development credentials. Public production
  runtime config is a versioned deployment/publication input with its own
  provenance.
- Production-publishable `server` and `container` artifacts that embed runtime
  config templates `MUST` use an explicit production-safe allowlist and `MUST NOT` include development, test, staging, or demo templates. Non-production profiles
  remain source/deployment inputs and are supplied through external config
  mounts, a controlled environment overlay, or a separately identified
  non-production artifact; they are not bundled as operator reference files in
  the production artifact.
- Release artifacts must not encode retired deployment profile values such as
  `saas`, `private`, `local`, `server`, `container`, or `desktop`; `server`,
  `container`, and `desktop` are runtime targets only.
- Store submissions and private distribution records are release evidence, not replacement for source-controlled release metadata.

### 4.1 Runtime Target Release Evidence

Release records `MUST` describe evidence by runtime target, not only by product
version.

| Runtime target class | Required release evidence | Rollback expectation |
| --- | --- | --- |
| `browser` / H5 web | Static asset or web URL package id, asset checksums when packaged, public runtime config version, CDN/edge host, cache invalidation plan | Previous asset version or host route can be restored without changing API contracts. |
| `desktop` | Installer/app bundle package id, OS/signing evidence, update channel, user data compatibility notes | Previous installer/update channel can be restored; user data migrations are reversible or forward-fix approved. |
| `tablet-ipados`, `tablet-android` | Tablet package id, signing/store/private distribution evidence, large-screen target metadata | Store/private rollout can be paused or reverted according to platform constraints. |
| `capacitor-*`, `flutter-*`, native mobile | App package id, signing/provisioning evidence, store/private track, minimum supported version, staged rollout status | Store rollout can be halted, superseded, or force-updated with documented user impact. |
| `mini-program` | Platform package id, platform app id, upload/review/release record, platform version, subpackage evidence | Platform release can be rolled back, disabled, or superseded according to platform rules. |
| `server` | Archive/service package id, runtime config version, database/Redis compatibility, service health checks | Previous service package/config can be restored or forward-fix plan is approved. |
| `container` | Image/bundle package id, immutable digest, SBOM/provenance, orchestration manifest/chart version, probes | Previous digest/manifest can be redeployed and data migrations are covered. |
| `test-runner` | Test artifact id or workflow run evidence only | Not a production rollback target. |

Test-runner evidence uses `profileBinding = non-deployable`; it is retained for
traceability and quality gates, but is excluded from publish, deploy, and
rollback artifact selectors.

Rules:

- A release that includes more than one runtime target `MUST` record evidence
  and rollback for each target separately.
- Client runtime releases `MUST` name the SDK/API surface versions they expect
  and the minimum compatible backend/runtime version when compatibility matters.
- Container/Docker-compatible releases `MUST` record immutable image digests;
  the canonical artifact evidence digest is the remote registry digest, not a
  local daemon image id and not the checksum of a metadata JSON file. The
  evidence retains that metadata file only to re-verify the digest locator.
  Mutable tags are convenience labels, not release identity.

## 5. Rollout And Rollback

Rules:

- Risky releases should use staged rollout, limited tenant exposure, feature flags, or canary deployment when supported.
- Rollback must identify which deployment-profile-specific artifacts, runtime
  target packages, database migrations, config changes, SDK versions, and
  feature flags are reversible.
- A migration that cannot be rolled back must have a forward-fix plan and explicit approval.
- Rollout must define monitoring signals and stop conditions.

## 6. Release Freeze

Rules:

- Release candidates may enter freeze when only release blockers, documentation corrections, and approved hotfixes are allowed.
- Scope changes during freeze require owner approval and renewed release gate evidence.
- Freeze does not waive security or migration checks.

## 7. Post-Release

Rules:

- Production releases should record smoke test results, incident links, rollout status, and known issues.
- If a release causes incident response, the release record must link to the incident and follow-up actions.
- Release evidence should be retained according to `DOCUMENTATION_SPEC.md` and the repository retention policy.

## 8. Acceptance Checklist

- [ ] Release scope, version, tag, deployment profile, runtime target, and artifacts are known.
- [ ] Manifest, workflow, config, deployment profiles, runtime targets, and deployment targets are validated.
- [ ] Tests and quality gate evidence are recorded.
- [ ] Composable architecture closure evidence is recorded when module, SDK dependency, route, permission, frontend, Rust backend, or resolved composition behavior changed.
- [ ] Signing, SBOM, and provenance are present when required.
- [ ] Migration, rollout, rollback, and monitoring plans are present when relevant.
- [ ] Release notes match the version and artifact set.
