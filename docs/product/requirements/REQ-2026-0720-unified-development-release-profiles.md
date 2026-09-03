# REQ-2026-0720 Unified Development, Release, And Deployment Profiles

Status: in-progress
Owner: SDKWork platform
Date: 2026-07-19
Source: platform

## Problem

SDKWork applications already use `standalone` and `cloud` as deployment
profiles, but repository commands do not provide one uniform contract for
local development, artifact release, and environment deployment. In
particular, a cloud development profile can still clone local API processes,
and release commands can omit the profile that determines artifact and
rollback behavior.

## Goals

- Every pnpm-managed SDKWork application root exposes deterministic
  `dev:standalone` and `dev:cloud` entrypoints.
- Bare `pnpm dev` delegates to `pnpm dev:standalone`.
- `dev:cloud` starts local development clients against already deployed cloud
  API surfaces and does not bootstrap local API, gateway, or database
  processes.
- Release and deployment command families select `standalone` or `cloud`
  explicitly while preserving lifecycle phases.
- Application manifests, workflow matrices, topology profiles, package ids,
  release evidence, and deployment plans carry one normalized fixed profile or
  an explicit runtime-configurable supported-profile binding as appropriate.
- `standalone` resolves application APIs through
  `sdkwork-api-<application-code>-standalone-gateway` and the corresponding API assembly.
- Cloud development consumes explicit deployed surface URLs and starts no
  standalone or platform gateway. Cloud host implementation is outside the
  application topology contract.
- Browser, desktop, tablet, H5/Capacitor, Flutter, native Android/iOS/Harmony,
  and mini-program artifacts can represent fixed or runtime-configurable
  profile support without creating duplicate deployment modes.
- Deployment manifests expose typed delivery, driver, ownership, tenancy,
  isolation, exposure, rollout, and availability dimensions and side-effecting
  operations require immutable artifact selection.
- The lifecycle is implemented as reusable framework components: topology and
  local development in `sdkwork-app-topology`, packaging and publication in
  `sdkwork-github-workflow`, and deployment apply/rollback in `deployctl`.
- Application roots expose only thin public script aliases; application-specific
  commands remain private `_sdkwork:*` hooks and are never a second public
  lifecycle vocabulary.

## Non-Goals

- Adding a third deployment profile or aliases such as `remote`, `saas`, or
  `self-hosted`.
- Requiring byte-identical client binaries to be produced twice only to change
  API endpoints. Fixed server/gateway artifacts remain profile-specific.
- Making release packaging automatically deploy to staging or production.
- Storing credentials or concrete private endpoints in application manifests,
  workflow config, or release artifacts.

## Users

- Application developers switching between local and deployed APIs.
- Release engineers producing standalone and cloud artifacts.
- Operators planning, applying, validating, and rolling back deployments.
- Validators and agents maintaining application repositories.

## Acceptance Criteria

- `PNPM_SCRIPT_SPEC.md` requires `dev`, `dev:standalone`, and `dev:cloud`, and
  defines canonical release/deploy profile command order.
- `APP_RUNTIME_TOPOLOGY_SPEC.md` defines `cloud.development` as remote API
  consumption with no local API-plane autostart.
- Topology schema v5 declares explicit remote cloud surfaces without embedding
  platform gateway implementation identity; edge ingress requires ADR evidence.
- `SOURCE_CONFIG_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, and
  `DEPLOYMENT_SPEC.md` keep profile, environment, runtime target, and Base URL
  selection separate.
- `RELEASE_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `APP_MANIFEST_SPEC.md`, and
  `SDKWORK_DEPLOY_SPEC.md` preserve phase gates, artifact identity, explicit
  deployment selection, and per-profile rollback evidence.
- The script-standard checker rejects missing profile entrypoints, a non-standalone bare
  `dev`, profile-first release/deploy command names, and incomplete profile
  variants for exposed lifecycle phases.
- The topology checker rejects a `cloud.development` profile that autostarts
  local API/gateway processes or lacks explicit remote surface URLs.
- Targeted checker tests cover positive and negative cases.
- App manifest checks enforce fixed versus runtime-configurable package
  binding, and deploy v2 checks enforce canonical profile ids, typed dimensions,
  explicit artifact digest, and rollback selection.
- Desktop supervision and installed-client tests cover scoped gateway process
  lifecycle, loopback binding, profile namespace isolation, and re-authentication.
- A workspace audit reports migration waves and coverage before consumer
  migration is enabled; the framework phase does not bulk-edit application roots.

## Non-Functional Requirements

- Security: publishing and deployment credentials remain in protected CI
  environments, OIDC configuration, or secret managers.
- Reliability: publish/apply/rollback actions fail before side effects when
  profile, environment, target selection, health evidence, or rollback input
  is ambiguous.
- Supply chain: released artifacts remain traceable to source, version,
  package id, runtime target, deployment profile, checksum, signature, SBOM,
  and provenance policy.
- Artifact evidence names a safe relative artifact path; package and deploy
  gates recompute its SHA-256 from actual bytes and reject version/source-commit
  drift. Aggregate Release selection excludes non-deployable test artifacts.
- Compatibility: adoption follows a validator-visible migration window; old
  commands are removed only after canonical entrypoints exist.

## Affected Surfaces

- application root script surfaces
- runtime topology and source configuration
- application manifests and workflow matrices
- release, publication, deployment, and rollback automation
- standards validators and tests

## Trace

Specs:

- `PNPM_SCRIPT_SPEC.md`
- `APP_RUNTIME_TOPOLOGY_SPEC.md`
- `CONFIG_SPEC.md`
- `ENVIRONMENT_SPEC.md`
- `SOURCE_CONFIG_SPEC.md`
- `DEPLOYMENT_SPEC.md`
- `RELEASE_SPEC.md`
- `GITHUB_WORKFLOW_SPEC.md`
- `APP_MANIFEST_SPEC.md`
- `SDKWORK_DEPLOY_SPEC.md`
- `MIGRATION_SPEC.md`
- `SUPPLY_CHAIN_SECURITY_SPEC.md`
- `TEST_SPEC.md`

Decision:

- `ADR-20260719-unified-development-release-profiles`
- Gateway composition supersession: `ADR-20260720-api-assembly-gateway-hosting`

## Verification

```text
node --test tools/check-pnpm-script-standard.test.mjs
node --test tools/check-topology-deployment-profiles.test.mjs
node tools/check-pnpm-script-standard.mjs --root <application-root>
node tools/check-topology-deployment-profiles.mjs --workspace <workspace-root>

The release/deployment closure also requires:

```bash
node --test tools/resolve-app-runtime-plan.test.mjs
node --test tools/check-app-manifest-standard.test.mjs
node --test tools/check-deploy-standard.test.mjs
```

Deployment evidence must validate against
`schemas/sdkwork.artifact-evidence.schema.v1.json`; nginx apply and rollback
must prove atomic replacement and restoration after `nginx -t` or reload
failure.
```
